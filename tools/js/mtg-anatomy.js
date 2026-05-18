/* MTG 3D Anatomy — Three.js GLTF loader for the marketing site.
 *
 * Loads /data/mtg/anatomy/skeleton.glb (AnatomyTOOL Open3DModel, CC BY-SA 4.0)
 * — a half-skeleton with 144 named bone meshes (right side + midline). We
 * mirror the right-side bones at runtime to produce a complete bilateral
 * figure. Each mesh is mapped to one of the canonical MTG body regions, and
 * a raycaster drives hover-highlight + click-to-search.
 *
 * Loaded after Three.js + GLTFLoader UMD scripts in
 * medical-treatment-guidelines.html. Exposes window.MTGAnatomy3D with:
 *   mount(container, { onRegionClick(regionId, boneName), onRegionHover(regionId) })
 *   unmount()
 *   setHighlight(regionId)            — programmatic highlight
 *   clearHighlight()
 *   rotateTo('front'|'back'|'left'|'right')
 */
(function (global) {
  'use strict';

  // ── Bone-name → canonical region ID mapping ─────────────────────────────
  // Patterns are evaluated in order; first match wins. ".r"/".l" suffixes
  // are stripped before matching so a single rule covers both sides.
  // The matchSide() helper decides left vs right from the original name.
  //
  // Region IDs match the canonical list in tools/mtg/regions.py / regions.js.
  const REGION_RULES = [
    // Skull (single region — no side split for head)
    [/^(frontal bone|parietal bone( left| right)?|occipital bone|temporal bone|sphenoid bone|ethmoid bone|mandible bone|maxilla bone|nasal bone|vomer|zygomatic bone|inferior nasal concha bone|lacrimal bone|palatine bone|.*tooth|.*incisor|.*canine|.*molar|.*premolar)/i, 'head'],

    // Neck — cervical vertebrae C1-C7 + atlas/axis
    [/^(atlas|axis|cervical vertebrae)/i, 'neck'],

    // Upper back — thoracic vertebrae + ribs + sternum
    [/^(thoracic vertebrae|rib(\s|\b)|costal cart of)/i, 'upper_back'],
    [/^(body of sternum|manubrium of sternum)/i, 'chest'],

    // Lower back — lumbar vertebrae
    [/^lumbar vertebrae/i, 'lower_back'],

    // Pelvis
    [/^(sacrum|coccyx|hip bone)/i, 'pelvis'],

    // Shoulder girdle
    [/^(clavicle|scapula)/i, 'SIDE_shoulder'],

    // Arm
    [/^humerus/i, 'SIDE_upper_arm'],
    [/^(radius|ulna)/i, 'SIDE_forearm'],

    // Wrist — carpal bones
    [/^(scaphoid|lunate|triquetrum|pisiform|hamate|capitate|trapezoid|trapezium)/i, 'SIDE_wrist'],

    // Hand — metacarpals + finger phalanges + sesamoids
    [/^(\d.. metacarpal bone|.*phalanx of \dd? finger|.*phalanx of \dst finger|.*phalanx of \dth finger|sesamoid_bones_of_hand|sesamoid bones of hand)/i, 'SIDE_hand'],

    // Leg
    [/^femur/i, 'SIDE_thigh'],
    [/^patella/i, 'SIDE_knee'],
    [/^(tibia|fibula)/i, 'SIDE_shin'],

    // Ankle — tarsals (talus, calcaneus, navicular, cuboid, cuneiforms)
    [/^(talus|calcaneus|navicular bone|cuboid bone|medial cuneiform|intermediate cuneiform|lateral cuneiform)/i, 'SIDE_ankle'],

    // Foot — metatarsals + toe phalanges + sesamoids
    [/^(first metatarsal|second metatarsal|third metatarsal|fourth metatarsal|fifth metatarsal|.*finger of foot|sesamoid bones of foot)/i, 'SIDE_foot'],
  ];

  function inferRegion(meshName, side) {
    const clean = meshName.replace(/\.[lr]\.?$/i, '').trim();
    for (const [pat, base] of REGION_RULES) {
      if (pat.test(clean)) {
        if (base.startsWith('SIDE_')) {
          return (side === 'left' ? 'left_' : 'right_') + base.slice(5);
        }
        return base;
      }
    }
    return null;
  }

  function inferSide(meshName) {
    // Mesh names use .r/.r./.l suffix; midline bones have no suffix.
    if (/\.l\.?$/i.test(meshName)) return 'left';
    if (/\.r\.?$/i.test(meshName)) return 'right';
    return 'mid';
  }

  // ── Scene state (singleton — the picker is single-instance app-wide) ────
  let THREE = null;
  let renderer, scene, camera, raycaster, pointer;
  let originalGroup;            // Right-side + midline (as loaded)
  let mirroredGroup;            // Left-side (programmatically mirrored)
  let allMeshes = [];           // Flattened list of every clickable mesh
  let meshByRegion = new Map(); // regionId -> Set<Mesh>
  let highlighted = null;       // currently highlighted region id
  let hovered = null;
  let container = null;
  let resizeObserver = null;
  let rafHandle = null;
  let cameraTarget = { theta: 0, lookY: 0 };
  let onRegionClick = null;
  let onRegionHover = null;
  let modelLoaded = false;

  // Idle / hover / highlight colors
  const COLOR_BONE         = 0xe2e8f0;  // soft off-white
  const COLOR_BONE_EMIT    = 0x1e3a5f;  // base subtle blue glow
  const COLOR_HOVER        = 0x60a5fa;  // light blue
  const COLOR_HIGHLIGHT    = 0x3b82f6;  // accent blue

  function applyMaterialState(mesh) {
    const region = mesh.userData.regionId;
    const isHighlight = region && region === highlighted;
    const isHover     = region && region === hovered && !isHighlight;
    const mat = mesh.material;
    if (isHighlight) {
      mat.color.setHex(COLOR_HIGHLIGHT);
      mat.emissive.setHex(COLOR_HIGHLIGHT);
      mat.emissiveIntensity = 0.7;
    } else if (isHover) {
      mat.color.setHex(COLOR_HOVER);
      mat.emissive.setHex(COLOR_HOVER);
      mat.emissiveIntensity = 0.45;
    } else {
      mat.color.setHex(COLOR_BONE);
      mat.emissive.setHex(COLOR_BONE_EMIT);
      mat.emissiveIntensity = 0.18;
    }
  }
  function updateAllMaterials() { allMeshes.forEach(applyMaterialState); }

  function setupLights() {
    scene.add(new THREE.AmbientLight(0xcfd8e3, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 0.95);
    key.position.set(2, 4, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4a6da8, 0.55);
    rim.position.set(-3, 2, -3);
    scene.add(rim);
    const up = new THREE.PointLight(0x3b82f6, 0.8, 6);
    up.position.set(0, -0.8, 1);
    scene.add(up);
  }

  function prepareMesh(mesh, side) {
    if (!mesh.isMesh) return;
    // Override material with a fresh MeshStandardMaterial we control entirely
    const mat = new THREE.MeshStandardMaterial({
      color: COLOR_BONE,
      emissive: COLOR_BONE_EMIT,
      emissiveIntensity: 0.18,
      roughness: 0.55,
      metalness: 0.15,
      side: side === 'left' ? THREE.DoubleSide : THREE.FrontSide,
    });
    mesh.material = mat;
    const region = inferRegion(mesh.name || '', side);
    mesh.userData.regionId = region;
    mesh.userData.boneName = mesh.name;
    mesh.userData.side = side;
    if (region) {
      if (!meshByRegion.has(region)) meshByRegion.set(region, new Set());
      meshByRegion.get(region).add(mesh);
    }
    allMeshes.push(mesh);
  }

  function walkAndPrep(node, defaultSide) {
    node.traverse(child => {
      if (child.isMesh) {
        const side = inferSide(child.name || '') === 'mid' ? defaultSide : inferSide(child.name || '');
        prepareMesh(child, side);
      }
    });
  }

  function mirrorRightSideToLeft() {
    // Clone Bones_right and Cartilages_right groups, flip x, rename .r→.l
    if (!originalGroup) return;
    mirroredGroup = new THREE.Group();
    mirroredGroup.name = 'MirroredLeft';
    originalGroup.traverse(node => {
      // We only mirror nodes that explicitly have .r in their name; midline
      // bones (no .r/.l suffix) stay un-mirrored.
      if (node.isMesh && /\.r\.?$/i.test(node.name || '')) {
        const clone = node.clone();
        clone.material = node.material.clone();
        // Mirror across the X axis. Use scale.x = -1 + invert face winding.
        // Apply on the clone's matrix so the clone keeps its world position.
        clone.scale.x *= -1;
        // Rename
        clone.name = (node.name || '').replace(/\.r(\.)?$/i, '.l');
        // Prep with side=left
        const fresh = new THREE.MeshStandardMaterial({
          color: COLOR_BONE,
          emissive: COLOR_BONE_EMIT,
          emissiveIntensity: 0.18,
          roughness: 0.55,
          metalness: 0.15,
          side: THREE.DoubleSide,
        });
        clone.material = fresh;
        const region = inferRegion(clone.name, 'left');
        clone.userData.regionId = region;
        clone.userData.boneName = clone.name;
        clone.userData.side = 'left';
        if (region) {
          if (!meshByRegion.has(region)) meshByRegion.set(region, new Set());
          meshByRegion.get(region).add(clone);
        }
        allMeshes.push(clone);
        mirroredGroup.add(clone);
      }
    });
    scene.add(mirroredGroup);
  }

  function loadModel(onReady, onError) {
    const Loader = THREE.GLTFLoader || (THREE.Loaders && THREE.Loaders.GLTFLoader);
    if (!Loader) {
      console.error('[MTGAnatomy3D] GLTFLoader not found. Make sure GLTFLoader script is loaded.');
      if (onError) onError(new Error('GLTFLoader missing'));
      return;
    }
    const loader = new Loader();
    loader.load(
      '/data/mtg/anatomy/skeleton.glb',
      (gltf) => {
        originalGroup = gltf.scene;
        scene.add(originalGroup);
        // Center + normalize size: compute bounding box, scale to fit ~1.8 units tall
        const box = new THREE.Box3().setFromObject(originalGroup);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);
        const targetHeight = 1.85;
        const scaleFactor = targetHeight / Math.max(0.01, size.y);
        originalGroup.scale.multiplyScalar(scaleFactor);
        // Re-center: subtract the (now-scaled) center
        box.setFromObject(originalGroup);
        box.getCenter(center);
        originalGroup.position.x -= center.x;
        originalGroup.position.y -= center.y;
        originalGroup.position.z -= center.z;

        // Prep each mesh — assign region by name + side
        originalGroup.traverse(child => {
          if (!child.isMesh) return;
          const side = inferSide(child.name || '');
          prepareMesh(child, side);
        });

        // Mirror right-side bones to produce left side
        mirrorRightSideToLeft();
        if (mirroredGroup) {
          // Apply same transform to mirrored group so it lines up
          mirroredGroup.scale.copy(originalGroup.scale);
          mirroredGroup.position.copy(originalGroup.position);
        }

        modelLoaded = true;
        if (onReady) onReady();
      },
      undefined,  // progress
      (err) => {
        console.error('[MTGAnatomy3D] GLB load failed:', err);
        if (onError) onError(err);
      }
    );
  }

  function setCameraTheta(theta, lookY) {
    const radius = 3.0;
    const height = 1.0;
    camera.position.set(Math.sin(theta) * radius, height, Math.cos(theta) * radius);
    camera.lookAt(0, typeof lookY === 'number' ? lookY : 0, 0);
  }

  function animate() {
    rafHandle = requestAnimationFrame(animate);
    // Tween camera toward targetTheta
    const currentTheta = Math.atan2(camera.position.x, camera.position.z);
    let delta = cameraTarget.theta - currentTheta;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) > 0.001) setCameraTheta(currentTheta + delta * 0.15);
    renderer.render(scene, camera);
  }

  function pickAtPointer(ev) {
    if (!modelLoaded) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(allMeshes, false);
    return hits.length ? hits[0].object : null;
  }

  function onPointerMove(ev) {
    const mesh = pickAtPointer(ev);
    const newHovered = mesh && mesh.userData.regionId ? mesh.userData.regionId : null;
    if (newHovered !== hovered) {
      hovered = newHovered;
      updateAllMaterials();
      container.style.cursor = hovered ? 'pointer' : 'default';
      if (typeof onRegionHover === 'function') onRegionHover(hovered, mesh && mesh.userData.boneName);
    }
  }

  function onPointerLeave() {
    if (hovered !== null) {
      hovered = null;
      updateAllMaterials();
      container.style.cursor = 'default';
      if (typeof onRegionHover === 'function') onRegionHover(null, null);
    }
  }

  function onPointerDown(ev) {
    const mesh = pickAtPointer(ev);
    if (!mesh || !mesh.userData.regionId) return;
    highlighted = mesh.userData.regionId;
    updateAllMaterials();
    if (typeof onRegionClick === 'function') {
      onRegionClick(mesh.userData.regionId, mesh.userData.boneName);
    }
  }

  function fitToContainer() {
    if (!container || !renderer) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // ── Public API ──────────────────────────────────────────────────────────
  function mount(el, opts) {
    if (!window.THREE) {
      console.error('[MTGAnatomy3D] THREE not loaded.');
      return;
    }
    THREE = window.THREE;
    if (container) unmount();
    container = el;
    onRegionClick = opts && opts.onRegionClick;
    onRegionHover = opts && opts.onRegionHover;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1a);

    camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    setCameraTheta(0, 1.0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);
    setupLights();

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerleave', onPointerLeave);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    fitToContainer();
    if (window.ResizeObserver) {
      resizeObserver = new ResizeObserver(fitToContainer);
      resizeObserver.observe(container);
    } else {
      window.addEventListener('resize', fitToContainer);
    }

    animate();

    // Load the GLB asynchronously
    loadModel(
      () => { if (typeof opts.onReady === 'function') opts.onReady(); },
      (err) => { if (typeof opts.onError === 'function') opts.onError(err); }
    );
  }

  function unmount() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener('resize', fitToContainer);
    if (renderer) {
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
    }
    allMeshes.forEach(m => { try { m.geometry && m.geometry.dispose(); m.material && m.material.dispose(); } catch (_) {} });
    allMeshes = [];
    meshByRegion.clear();
    highlighted = null;
    hovered = null;
    modelLoaded = false;
    container = null;
    onRegionClick = null;
    onRegionHover = null;
    originalGroup = null;
    mirroredGroup = null;
  }

  function setHighlight(regionId) { highlighted = regionId || null; updateAllMaterials(); }
  function clearHighlight() { highlighted = null; updateAllMaterials(); }
  function rotateTo(view) {
    if (view === 'back')       cameraTarget.theta = Math.PI;
    else if (view === 'right') cameraTarget.theta = Math.PI / 2;
    else if (view === 'left')  cameraTarget.theta = -Math.PI / 2;
    else                       cameraTarget.theta = 0;
  }

  global.MTGAnatomy3D = { mount, unmount, setHighlight, clearHighlight, rotateTo };
})(window);
