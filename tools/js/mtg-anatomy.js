/* MTG 3D Anatomy — Three.js (ESM) loader for the marketing site.
 *
 * ES module. Loaded via <script type="module"> with an import map that
 * resolves "three" + "three/addons/" to the official ESM CDN bundle. This
 * avoids the UMD compatibility headaches with Three.js >= 0.150.
 *
 * Loads /data/mtg/anatomy/skeleton.glb (AnatomyTOOL Open3DModel,
 * CC BY-SA 4.0) — a half-skeleton with 144 named bone meshes (right side
 * + midline). We mirror the right-side bones at runtime to produce a
 * complete bilateral figure. Each mesh is mapped to one of the canonical
 * MTG body regions, and a raycaster drives hover-highlight + click-to-
 * search.
 *
 * Exposes window.MTGAnatomy3D once loaded:
 *   mount(container, { onRegionClick(regionId, boneName), onRegionHover(regionId), onReady, onError })
 *   unmount()
 *   setHighlight(regionId)
 *   clearHighlight()
 *   rotateTo('front'|'back'|'left'|'right')
 *
 * Also exposes window.MTGAnatomy3DReady (a Promise) so mtg-tool.js can
 * await the module before calling mount().
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// The AnatomyTOOL skeleton GLB declares KHR_draco_mesh_compression in
// extensionsRequired, so GLTFLoader needs a DRACOLoader instance to decode
// the meshes. We point it at the WASM decoder shipped alongside three@0.160
// (matches the import map version above).
const DRACO_DECODER_PATH = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/';

// ── Bone-name → canonical region ID mapping ─────────────────────────────
// Patterns are evaluated in order; first match wins. ".r"/".l" suffixes
// are stripped before matching. The matchSide() helper decides left vs
// right from the original mesh name.
//
// Region IDs match the canonical list in tools/mtg/regions.py.
const REGION_RULES = [
  [/^(frontal bone|parietal bone( left| right)?|occipital bone|temporal bone|sphenoid bone|ethmoid bone|mandible bone|maxilla bone|nasal bone|vomer|zygomatic bone|inferior nasal concha bone|lacrimal bone|palatine bone|.*tooth|.*incisor|.*canine|.*molar|.*premolar)/i, 'head'],
  [/^(atlas|axis|cervical vertebrae)/i, 'neck'],
  [/^(thoracic vertebrae|rib(\s|\b)|costal cart of)/i, 'upper_back'],
  [/^(body of sternum|manubrium of sternum)/i, 'chest'],
  [/^lumbar vertebrae/i, 'lower_back'],
  [/^(sacrum|coccyx|hip bone)/i, 'pelvis'],
  [/^(clavicle|scapula)/i, 'SIDE_shoulder'],
  [/^humerus/i, 'SIDE_upper_arm'],
  [/^(radius|ulna)/i, 'SIDE_forearm'],
  [/^(scaphoid|lunate|triquetrum|pisiform|hamate|capitate|trapezoid|trapezium)/i, 'SIDE_wrist'],
  // Foot first — the "of foot" suffix distinguishes toes from fingers.
  [/^.*phalanx of \w+ finger of foot/i, 'SIDE_foot'],
  [/^.*metatarsal bone/i, 'SIDE_foot'],
  [/^sesamoid[ _]bones[ _]of[ _]foot/i, 'SIDE_foot'],
  // Hand — \w+ covers all ordinal variants the model uses ("1st", "2d", "3d",
  // "3rd", "4th", "5th") that the previous narrower regex was missing. The
  // negative lookahead prevents matching toe phalanges (... of foot).
  [/^.*phalanx of \w+ finger(?! of foot)/i, 'SIDE_hand'],
  [/^.*metacarpal bone/i, 'SIDE_hand'],
  [/^sesamoid[ _]bones[ _]of[ _]hand/i, 'SIDE_hand'],
  [/^femur/i, 'SIDE_thigh'],
  [/^patella/i, 'SIDE_knee'],
  [/^(tibia|fibula)/i, 'SIDE_shin'],
  [/^(talus|calcaneus|navicular bone|cuboid bone|medial cuneiform|intermediate cuneiform|lateral cuneiform)/i, 'SIDE_ankle'],
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
  if (/\.l\.?$/i.test(meshName)) return 'left';
  if (/\.r\.?$/i.test(meshName)) return 'right';
  return 'mid';
}

// Scene state (singleton)
let renderer, scene, camera, raycaster, pointer;
let originalGroup, mirroredGroup;
let allMeshes = [];
const meshByRegion = new Map();
let highlighted = null;
let hovered = null;
let container = null;
let resizeObserver = null;
let rafHandle = null;
const cameraTarget = { theta: 0 };
let onRegionClickCb = null;
let onRegionHoverCb = null;
let modelLoaded = false;

const COLOR_BONE         = 0xe8edf5;
const COLOR_BONE_EMIT    = 0x1e3a5f;
const COLOR_HOVER        = 0x60a5fa;
const COLOR_HIGHLIGHT    = 0x3b82f6;

function applyMaterialState(mesh) {
  const region = mesh.userData.regionId;
  const isHighlight = region && region === highlighted;
  const isHover     = region && region === hovered && !isHighlight;
  const mat = mesh.material;
  if (isHighlight) {
    mat.color.setHex(COLOR_HIGHLIGHT);
    mat.emissive.setHex(COLOR_HIGHLIGHT);
    mat.emissiveIntensity = 0.75;
  } else if (isHover) {
    mat.color.setHex(COLOR_HOVER);
    mat.emissive.setHex(COLOR_HOVER);
    mat.emissiveIntensity = 0.5;
  } else {
    mat.color.setHex(COLOR_BONE);
    mat.emissive.setHex(COLOR_BONE_EMIT);
    mat.emissiveIntensity = 0.18;
  }
}
function updateAllMaterials() { allMeshes.forEach(applyMaterialState); }

function setupLights() {
  scene.add(new THREE.AmbientLight(0xcfd8e3, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(2, 4, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4a6da8, 0.55);
  rim.position.set(-3, 2, -3);
  scene.add(rim);
  const up = new THREE.PointLight(0x3b82f6, 0.8, 6);
  up.position.set(0, -0.8, 1);
  scene.add(up);
}

function makeBoneMaterial(side) {
  return new THREE.MeshStandardMaterial({
    color: COLOR_BONE,
    emissive: COLOR_BONE_EMIT,
    emissiveIntensity: 0.18,
    roughness: 0.55,
    metalness: 0.15,
    side: side === 'left' ? THREE.DoubleSide : THREE.FrontSide,
  });
}

function prepareMesh(mesh, side) {
  if (!mesh.isMesh) return;
  mesh.material = makeBoneMaterial(side);
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

function mirrorRightSideToLeft() {
  if (!originalGroup) return;

  // Find the right-side subtrees in the loaded model. The AnatomyTOOL
  // skeleton ships as a half-skeleton: midline bones live under a top-level
  // "Bones" group, and right-side bones + cartilages live under "Bones_right"
  // / "Cartilages_right". The model's viewing convention is to mirror the
  // right subtree at render-time to reconstitute the full skeleton.
  let bonesRight = null, cartilagesRight = null;
  originalGroup.traverse(n => {
    if (n.name === 'Bones_right') bonesRight = n;
    else if (n.name === 'Cartilages_right') cartilagesRight = n;
  });

  // Parent group with scale.x = -1 mirrors all descendant positions AND
  // geometries through the origin in one shot — far simpler and more correct
  // than per-mesh transforms. Added as a child of originalGroup so it
  // inherits the same scale/centering that loadModel() applied.
  mirroredGroup = new THREE.Group();
  mirroredGroup.name = 'MirroredLeft';
  mirroredGroup.scale.x = -1;

  if (bonesRight) {
    const clonedBones = bonesRight.clone();  // recursive clone
    clonedBones.name = 'Bones_left';
    mirroredGroup.add(clonedBones);
  } else {
    // Fallback if the model structure changes: clone every .r mesh individually.
    originalGroup.traverse(node => {
      if (node.isMesh && /\.r\.?$/i.test(node.name || '')) {
        const c = node.clone();
        mirroredGroup.add(c);
      }
    });
  }
  if (cartilagesRight) {
    const clonedCart = cartilagesRight.clone();
    clonedCart.name = 'Cartilages_left';
    mirroredGroup.add(clonedCart);
  }

  // Walk the cloned hierarchy: fresh materials (originals are shared by
  // default after Object3D.clone()), rename .r → .l, assign region+side.
  mirroredGroup.traverse(node => {
    if (!node.isMesh) return;
    node.material = makeBoneMaterial('left');
    const oldName = node.name || '';
    const newName = oldName.replace(/\.r(\.)?$/i, '.l');
    node.name = newName;
    const region = inferRegion(newName, 'left');
    node.userData.regionId = region;
    node.userData.boneName = newName;
    node.userData.side = 'left';
    if (region) {
      if (!meshByRegion.has(region)) meshByRegion.set(region, new Set());
      meshByRegion.get(region).add(node);
    }
    allMeshes.push(node);
  });

  // Add as child of originalGroup so the mirror inherits the same world
  // scale/centering. Inverted-X normal winding gets handled by the materials
  // having side: DoubleSide (see makeBoneMaterial('left')).
  originalGroup.add(mirroredGroup);
}

function setCameraTheta(theta) {
  const radius = 3.0;
  const height = 1.0;
  camera.position.set(Math.sin(theta) * radius, height, Math.cos(theta) * radius);
  camera.lookAt(0, 0, 0);
}

function animate() {
  rafHandle = requestAnimationFrame(animate);
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
    if (typeof onRegionHoverCb === 'function') onRegionHoverCb(hovered, mesh && mesh.userData.boneName);
  }
}

function onPointerLeave() {
  if (hovered !== null) {
    hovered = null;
    updateAllMaterials();
    container.style.cursor = 'default';
    if (typeof onRegionHoverCb === 'function') onRegionHoverCb(null, null);
  }
}

function onPointerDown(ev) {
  const mesh = pickAtPointer(ev);
  if (!mesh || !mesh.userData.regionId) return;
  highlighted = mesh.userData.regionId;
  updateAllMaterials();
  if (typeof onRegionClickCb === 'function') {
    onRegionClickCb(mesh.userData.regionId, mesh.userData.boneName);
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

function loadModel(onReady, onError) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  // Use the JS decoder by default (more compatible). DRACOLoader will swap
  // to WASM automatically if available. Calling preload primes the decoder
  // before the first decodeGeometry() call.
  draco.preload();
  loader.setDRACOLoader(draco);
  loader.load(
    '/data/mtg/anatomy/skeleton.glb',
    (gltf) => {
      try {
        originalGroup = gltf.scene;
        scene.add(originalGroup);

        const box = new THREE.Box3().setFromObject(originalGroup);
        const size = new THREE.Vector3(); box.getSize(size);
        const center = new THREE.Vector3(); box.getCenter(center);
        const targetHeight = 1.85;
        const scaleFactor = targetHeight / Math.max(0.01, size.y);
        originalGroup.scale.multiplyScalar(scaleFactor);
        box.setFromObject(originalGroup);
        box.getCenter(center);
        originalGroup.position.x -= center.x;
        originalGroup.position.y -= center.y;
        originalGroup.position.z -= center.z;

        originalGroup.traverse(child => {
          if (!child.isMesh) return;
          const side = inferSide(child.name || '');
          prepareMesh(child, side);
        });

        mirrorRightSideToLeft();
        // mirroredGroup is now a child of originalGroup with its own
        // scale.x = -1, so it automatically inherits originalGroup's scale
        // and centering. The previous "scale.copy / position.copy" step
        // was overwriting the scale.x = -1 (that's why only half the
        // skeleton was rendering — the clones ended up overlapping the
        // originals on the right side instead of mirroring to the left).

        // Diagnostic: log any mesh that ended up without a regionId so we
        // can quickly spot future name-pattern misses.
        const unmapped = allMeshes.filter(m => !m.userData.regionId).map(m => m.userData.boneName);
        if (unmapped.length) {
          console.warn('[MTGAnatomy3D] ' + unmapped.length + ' mesh(es) without regionId:', unmapped);
        }

        modelLoaded = true;
        if (onReady) onReady();
      } catch (e) {
        console.error('[MTGAnatomy3D] Post-load setup failed:', e);
        if (onError) onError(e);
      }
    },
    undefined,
    (err) => {
      console.error('[MTGAnatomy3D] GLB fetch/parse failed:', err);
      if (onError) onError(err);
    }
  );
}

// Public API
function mount(el, opts) {
  opts = opts || {};
  if (container) unmount();
  container = el;
  onRegionClickCb = opts.onRegionClick;
  onRegionHoverCb = opts.onRegionHover;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f1a);

  camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  setCameraTheta(0);

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
  onRegionClickCb = null;
  onRegionHoverCb = null;
  originalGroup = null;
  mirroredGroup = null;
}

function setHighlight(regionId) { highlighted = regionId || null; if (modelLoaded) updateAllMaterials(); }
function clearHighlight() { highlighted = null; if (modelLoaded) updateAllMaterials(); }
function rotateTo(view) {
  if (view === 'back')       cameraTarget.theta = Math.PI;
  else if (view === 'right') cameraTarget.theta = Math.PI / 2;
  else if (view === 'left')  cameraTarget.theta = -Math.PI / 2;
  else                       cameraTarget.theta = 0;
}

window.MTGAnatomy3D = { mount, unmount, setHighlight, clearHighlight, rotateTo };

// Resolve the readiness promise so mtg-tool.js (a classic script that
// loads before this module finishes) can await us.
if (window.MTGAnatomy3DReadyResolve) {
  window.MTGAnatomy3DReadyResolve();
} else {
  window.MTGAnatomy3DReady = Promise.resolve();
}
