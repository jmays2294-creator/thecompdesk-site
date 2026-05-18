/* MTG Anatomy Picker — Three.js scene with ~30 named body-region meshes.
 *
 * Public API (window.CD.MTGAnatomy):
 *   mount(containerEl)       — attach renderer to a DOM node
 *   unmount()                — tear down and free GPU resources
 *   setSelected(regionIds[]) — programmatically select regions (e.g. deep link)
 *   getSelected()            — current selection array
 *   rotateTo('front'|'back') — camera preset
 *
 * Emits on the container element:
 *   'mtg:region-toggled'   { detail: { region, selected, all } }
 *   'mtg:region-hovered'   { detail: { region } }   (region may be null on leave)
 *
 * Region IDs match tools/mtg/regions.py REGIONS exactly.
 */
(function (global) {
  'use strict';
  if (!global.CD) global.CD = {};

  // --- Region geometry table -----------------------------------------------
  // Each entry: { id, type, args, position, rotation? }
  // type ∈ {'sphere','box','cylinder'}. args are the geometry constructor args.
  // position/rotation in Three units (1 unit ≈ 0.5 meters of body height).
  // The figure is centered at origin, total height ~2 units, head up Y+.
  // Front torso meshes sit at z ≈ +0.04; back meshes at z ≈ -0.04 so that the
  // camera can rotate around the Y axis to switch front/back without overlap.
  const REGIONS = [
    // Head & neck
    { id: 'head',           type: 'sphere',   args: [0.13, 24, 18], position: [0, 1.75, 0] },
    { id: 'neck',           type: 'cylinder', args: [0.05, 0.05, 0.10, 16], position: [0, 1.62, 0] },

    // Torso — front
    { id: 'chest',          type: 'box', args: [0.36, 0.34, 0.16, 4, 4, 2], position: [0, 1.40, 0.04] },
    { id: 'abdomen',        type: 'box', args: [0.32, 0.20, 0.15, 4, 3, 2], position: [0, 1.15, 0.04] },
    { id: 'pelvis',         type: 'box', args: [0.34, 0.18, 0.22, 4, 3, 3], position: [0, 0.97, 0] },

    // Torso — back
    { id: 'upper_back',     type: 'box', args: [0.36, 0.34, 0.16, 4, 4, 2], position: [0, 1.40, -0.04] },
    { id: 'lower_back',     type: 'box', args: [0.32, 0.20, 0.15, 4, 3, 2], position: [0, 1.15, -0.04] },

    // Arms — shoulders are joint spheres above the upper arms
    { id: 'left_shoulder',  type: 'sphere',   args: [0.075, 18, 14], position: [+0.21, 1.55, 0] },
    { id: 'right_shoulder', type: 'sphere',   args: [0.075, 18, 14], position: [-0.21, 1.55, 0] },
    { id: 'left_upper_arm', type: 'cylinder', args: [0.055, 0.06, 0.32, 14], position: [+0.27, 1.32, 0] },
    { id: 'right_upper_arm',type: 'cylinder', args: [0.055, 0.06, 0.32, 14], position: [-0.27, 1.32, 0] },
    { id: 'left_elbow',     type: 'sphere',   args: [0.055, 14, 12], position: [+0.30, 1.15, 0] },
    { id: 'right_elbow',    type: 'sphere',   args: [0.055, 14, 12], position: [-0.30, 1.15, 0] },
    { id: 'left_forearm',   type: 'cylinder', args: [0.045, 0.055, 0.30, 14], position: [+0.32, 0.97, 0] },
    { id: 'right_forearm',  type: 'cylinder', args: [0.045, 0.055, 0.30, 14], position: [-0.32, 0.97, 0] },
    { id: 'left_wrist',     type: 'sphere',   args: [0.04, 12, 10], position: [+0.33, 0.81, 0] },
    { id: 'right_wrist',    type: 'sphere',   args: [0.04, 12, 10], position: [-0.33, 0.81, 0] },
    { id: 'left_hand',      type: 'box',      args: [0.07, 0.13, 0.04, 2, 3, 1], position: [+0.34, 0.73, 0] },
    { id: 'right_hand',     type: 'box',      args: [0.07, 0.13, 0.04, 2, 3, 1], position: [-0.34, 0.73, 0] },

    // Legs — hips are joint spheres
    { id: 'left_hip',       type: 'sphere',   args: [0.080, 18, 14], position: [+0.10, 0.85, 0] },
    { id: 'right_hip',      type: 'sphere',   args: [0.080, 18, 14], position: [-0.10, 0.85, 0] },
    { id: 'left_thigh',     type: 'cylinder', args: [0.075, 0.08, 0.45, 14], position: [+0.10, 0.58, 0] },
    { id: 'right_thigh',    type: 'cylinder', args: [0.075, 0.08, 0.45, 14], position: [-0.10, 0.58, 0] },
    { id: 'left_knee',      type: 'sphere',   args: [0.072, 14, 12], position: [+0.10, 0.32, 0] },
    { id: 'right_knee',     type: 'sphere',   args: [0.072, 14, 12], position: [-0.10, 0.32, 0] },
    { id: 'left_shin',      type: 'cylinder', args: [0.055, 0.07, 0.40, 14], position: [+0.10, 0.10, 0] },
    { id: 'right_shin',     type: 'cylinder', args: [0.055, 0.07, 0.40, 14], position: [-0.10, 0.10, 0] },
    { id: 'left_ankle',     type: 'sphere',   args: [0.05, 12, 10], position: [+0.10, -0.13, 0] },
    { id: 'right_ankle',    type: 'sphere',   args: [0.05, 12, 10], position: [-0.10, -0.13, 0] },
    { id: 'left_foot',      type: 'box',      args: [0.10, 0.05, 0.20, 2, 1, 2], position: [+0.10, -0.18, +0.05] },
    { id: 'right_foot',     type: 'box',      args: [0.10, 0.05, 0.20, 2, 1, 2], position: [-0.10, -0.18, +0.05] },
  ];

  // Material state colors (kept in sync with main.css CSS variables).
  const COLOR_BASE      = 0x2a3b5c;  // muted blue-grey, idle
  const COLOR_EMISSIVE  = 0x1e3a5f;  // base subtle glow
  const COLOR_HOVER     = 0x4a6da8;  // brighter on hover
  const COLOR_SELECTED  = 0x3b82f6;  // accent blue (matches --ac)

  // --- Scene state (singleton; the picker is a single instance app-wide) ---
  let THREE = null;
  let renderer, scene, camera, raycaster, pointer;
  let meshes = [];                  // array of THREE.Mesh, each with userData.regionId
  const selected = new Set();       // region IDs currently selected
  let hovered = null;               // currently hovered region id
  let container = null;
  let resizeObserver = null;
  let rafHandle = null;
  let cameraTarget = { theta: 0 };  // 0 = front (looking at +Z), Math.PI = back

  function mkGeometry(type, args) {
    if (type === 'sphere')   return new THREE.SphereGeometry(...args);
    if (type === 'box')      return new THREE.BoxGeometry(...args);
    if (type === 'cylinder') return new THREE.CylinderGeometry(...args);
    throw new Error('Unknown geometry type: ' + type);
  }

  function buildFigure() {
    const group = new THREE.Group();
    meshes = [];
    for (const r of REGIONS) {
      const geo = mkGeometry(r.type, r.args);
      const mat = new THREE.MeshStandardMaterial({
        color: COLOR_BASE,
        emissive: COLOR_EMISSIVE,
        emissiveIntensity: 0.35,
        roughness: 0.55,
        metalness: 0.25,
        transparent: true,
        opacity: 0.96,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(...r.position);
      if (r.rotation) mesh.rotation.set(...r.rotation);
      mesh.userData.regionId = r.id;
      mesh.userData.baseColor = COLOR_BASE;
      mesh.userData.baseEmissive = COLOR_EMISSIVE;
      group.add(mesh);
      meshes.push(mesh);
    }
    return group;
  }

  function applyMaterialState(mesh) {
    const id = mesh.userData.regionId;
    const isSelected = selected.has(id);
    const isHovered = hovered === id;
    const mat = mesh.material;
    if (isSelected) {
      mat.color.setHex(COLOR_SELECTED);
      mat.emissive.setHex(COLOR_SELECTED);
      mat.emissiveIntensity = isHovered ? 0.95 : 0.75;
    } else if (isHovered) {
      mat.color.setHex(COLOR_HOVER);
      mat.emissive.setHex(COLOR_HOVER);
      mat.emissiveIntensity = 0.6;
    } else {
      mat.color.setHex(COLOR_BASE);
      mat.emissive.setHex(COLOR_EMISSIVE);
      mat.emissiveIntensity = 0.35;
    }
  }

  function updateAllMaterials() {
    for (const m of meshes) applyMaterialState(m);
  }

  function setupLights() {
    scene.add(new THREE.AmbientLight(0xcfd8e3, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 0.85);
    key.position.set(2, 3, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4a6da8, 0.45);
    rim.position.set(-3, 2, -2);
    scene.add(rim);
    // Soft uplight from below — mimics the reference image's glow-from-feet look
    const up = new THREE.PointLight(0x3b82f6, 0.7, 5);
    up.position.set(0, -0.6, 0.8);
    scene.add(up);
  }

  function setCameraTheta(theta) {
    // Camera orbits around Y axis at fixed radius/height
    const radius = 2.4;
    const height = 0.85;
    camera.position.set(Math.sin(theta) * radius, height, Math.cos(theta) * radius);
    camera.lookAt(0, 0.85, 0);
  }

  function animate() {
    rafHandle = requestAnimationFrame(animate);
    // Smoothly ease camera toward target theta
    const current = Math.atan2(camera.position.x, camera.position.z);
    const target = cameraTarget.theta;
    let delta = target - current;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (Math.abs(delta) > 0.001) {
      setCameraTheta(current + delta * 0.15);
    }
    renderer.render(scene, camera);
  }

  function onPointerMove(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    const newHovered = hits.length ? hits[0].object.userData.regionId : null;
    if (newHovered !== hovered) {
      hovered = newHovered;
      updateAllMaterials();
      container.style.cursor = hovered ? 'pointer' : 'default';
      container.dispatchEvent(new CustomEvent('mtg:region-hovered', { detail: { region: hovered } }));
    }
  }

  function onPointerLeave() {
    if (hovered !== null) {
      hovered = null;
      updateAllMaterials();
      container.style.cursor = 'default';
      container.dispatchEvent(new CustomEvent('mtg:region-hovered', { detail: { region: null } }));
    }
  }

  function onPointerDown(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length) return;
    const id = hits[0].object.userData.regionId;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updateAllMaterials();
    container.dispatchEvent(new CustomEvent('mtg:region-toggled', {
      detail: { region: id, selected: selected.has(id), all: Array.from(selected) },
    }));
  }

  function fitToContainer() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  // --- Public API ----------------------------------------------------------
  function mount(el) {
    if (!window.THREE) {
      console.error('[MTGAnatomy] THREE not loaded. Add three.min.js before this module.');
      return;
    }
    THREE = window.THREE;
    if (container) unmount();
    container = el;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0a0f1a);

    camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    setCameraTheta(0);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    setupLights();
    scene.add(buildFigure());

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
  }

  function unmount() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    if (resizeObserver) resizeObserver.disconnect();
    else window.removeEventListener('resize', fitToContainer);
    if (renderer) {
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
    }
    for (const m of meshes) {
      m.geometry.dispose();
      m.material.dispose();
    }
    meshes = [];
    selected.clear();
    hovered = null;
    container = null;
  }

  function setSelected(ids) {
    selected.clear();
    for (const id of ids || []) selected.add(id);
    if (meshes.length) updateAllMaterials();
  }

  function getSelected() {
    return Array.from(selected);
  }

  function rotateTo(view) {
    if (view === 'back')       cameraTarget.theta = Math.PI;
    else if (view === 'right') cameraTarget.theta = Math.PI / 2;
    else if (view === 'left')  cameraTarget.theta = -Math.PI / 2;
    else                       cameraTarget.theta = 0; // front
  }

  global.CD.MTGAnatomy = {
    mount,
    unmount,
    setSelected,
    getSelected,
    rotateTo,
    REGION_IDS: REGIONS.map(r => r.id),
  };
})(window);
