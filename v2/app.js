// OpenGrasp Expedition v2 — MuJoCo-WASM + Franka Panda prototype.
// Game layer: Rescue the Relic. Physics/rendering adapted from the zalo/mujoco_wasm
// demo approach (official MuJoCo WASM bindings + three.js). Panda model: MuJoCo
// Menagerie (Apache-2.0, see PANDA-LICENSE.txt).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import load_mujoco from './vendor/mujoco/mujoco.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = (a) => new THREE.Vector3(a[0], a[2], -a[1]); // MuJoCo -> three.js

// ---------------------------------------------------------------- loading
const loadbar = document.querySelector('#loadbar > i');
const loadmsg = $('loadmsg');
function setProgress(frac, msg) { loadbar.style.width = `${Math.round(frac * 100)}%`; if (msg) loadmsg.textContent = msg; }

async function fetchInto(mujoco, url, vfsPath, binary = false) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  const buf = await res.arrayBuffer();
  mujoco.FS.writeFile(vfsPath, new Uint8Array(buf));
  return new TextDecoder().decode(buf);
}

let mujoco, model, data;
let siteId = 0, handBody = 0, relicBody = 0;
let armJoints = [], armDofs = [], armRanges = [], fingerQpos = [];
let relicQposAdr = 0, relicDofAdr = 0, guardianAct = -1;
const HOME_Q = [0, 0, 0, -1.57079, 0, 1.57079, -0.7853];
// ---------------------------------------------------------------- levels
// One engine, three expeditions. Every level reuses the same control,
// recording and scoring core; only the scene, the goal, the hazard rules
// and the story change. Progress (verified runs, best stars, points) lives
// in the hub and persists in localStorage; each task accepts up to
// MAX_VERIFIED verified runs per explorer — every certified run starts
// from a slightly shifted prop position, so no two trajectories are
// alike — and practice stays open forever.
const LEVELS = [
  {
    task: 'rescue_relic', scene: 'scene.xml', no: '01', title: 'Rescue the Relic',
    kick: 'EXPEDITION 01 · THE SUNKEN SHRINE',
    story: 'A golden idol rests on a cracked pedestal. Your golem crane is the only way out — but the idol cracks if you slam it around, and the moment you lift it, the Guardian wakes.',
    outro: 'The relic hums softly in its cradle. One treasure recovered — and one clean, gentle trajectory in the expedition log.',
    sub: 'The golden idol is fragile. Lift it gently, slip past the Guardian, and set it in the vault cradle.',
    steps: ['Reach the relic', 'Grasp it — hold Space', 'Carry it gently past the Guardian', 'Release it in the vault'],
    propStart: [0.05, -0.30, 0.238], jitter: { xy: 0.02, yaw: 0.30 }, goal: { x: 0.26, y: 0.28, z: 0.198, r: 0.052, zTol: 0.032 }, goalFlyZ: 0.203,
    frag: { thresh: 0.55, scale: 26 }, guardian: { park: -0.30, amp: 0.30, speed: 1.05 }, upright: 0, graspW: 0.030,
    meterLabel: 'Relic integrity', meterMode: 'integrity', guardianNote: 'The Guardian sleeps… for now.',
    par: 75, base: 200, startToast: 'Rescue the relic — gently!', failNote: 'The relic fell from the shrine.',
    doneTitle: 'The relic is safe.',
  },
  {
    task: 'restore_monolith', scene: 'scene2.xml', no: '02', title: 'Restore the Monolith',
    kick: 'EXPEDITION 02 · THE FALLEN PILLAR',
    story: 'The shrine\'s great pillar lost a drum when the quake hit. The drum still stands on its plinth across the court — heavy, awkward, and missed by its pillar. Carry it home tall and set it true.',
    outro: 'The drum stands true again, gem catching the torchlight. The shrine is one step closer to whole.',
    sub: 'The pillar drum is heavy stone: it will not crack, but it must arrive on the pillar UPRIGHT, gem up. Watch the tilt meter — a toppled drum in the socket is no restoration.',
    steps: ['Reach the drum', 'Grasp it — hold Space', 'Carry it tall to the pillar', 'Stand it in the socket, gem up'],
    propStart: [-0.02, -0.30, 0.266], jitter: { xy: 0.006, yaw: 0 }, goal: { x: 0.30, y: 0.26, z: 0.406, r: 0.045, zTol: 0.035 }, goalFlyZ: 0.45,
    frag: null, guardian: null, upright: 0.35, graspW: 0.030,
    meterLabel: 'Drum tilt', meterMode: 'tilt', guardianNote: 'No Guardian stirs here. The pillar itself is the test.',
    par: 90, base: 250, startToast: 'Restore the monolith — keep it tall!', failNote: 'The drum crashed off the dais.',
    doneTitle: 'The drum stands true.',
  },
  {
    task: 'restock_vial', scene: 'scene3.xml', no: '03', title: 'Restock the Potion Shelf',
    kick: 'EXPEDITION 03 · THE ALCHEMIST\'S SHELF',
    story: 'One vial of dawnwater potion survived the quake, and the alchemist wants it back on her shelf. Glass is far less forgiving than gold — and the Guardian patrols the shelf road.',
    outro: 'The vial glows on the shelf, potion unspilled. The alchemist owes the expedition a favour.',
    sub: 'The glass vial is very fragile — softer hands than the relic demanded. Grip it by the twine band so it hangs plumb, slip past the Guardian, and slot it onto the shelf.',
    steps: ['Reach the vial', 'Grip the twine band — hold Space', 'Carry it softly past the Guardian', 'Slot it onto the shelf'],
    propStart: [0.05, -0.30, 0.245], jitter: { xy: 0.01, yaw: 0.15 }, goal: { x: 0.34, y: 0.30, z: 0.314, r: 0.038, zTol: 0.030 }, goalFlyZ: 0.34,
    frag: { thresh: 0.35, scale: 38 }, guardian: { park: -0.30, amp: 0.30, speed: 1.05 }, upright: 0, graspW: 0.032, graspOffset: [0, 0, 0.008], hangOffset: 0.008,
    meterLabel: 'Vial integrity', meterMode: 'integrity', guardianNote: 'The Guardian sleeps… for now.',
    par: 75, base: 250, startToast: 'Restock the vial — softer than soft!', failNote: 'The vial fell from the shrine.',
    doneTitle: 'The vial is shelved, unspilled.',
  },
];
let levelIdx = 0, L = LEVELS[0], runMode = 'certified'; // 'certified' | 'practice'
let RELIC_START = L.propStart;
let VAULT = L.goal;
let runJitter = { dx: 0, dy: 0, yaw: 0 }; // per-certified-run prop offset (data variety)
let runVerifiedNo = null; // 1..MAX_VERIFIED for certified runs, null in practice
const WS = { x: [-0.38, 0.66], y: [-0.52, 0.52], z: [0.17, 0.88] };

async function initPhysics(sceneFile) {
  setProgress(0.02, 'Loading MuJoCo physics engine…');
  if (!mujoco) {
    mujoco = await load_mujoco({ locateFile: (p, prefix) => p.endsWith('.wasm') ? './vendor/mujoco/mujoco.wasm' : prefix + p });
    try { mujoco.FS.mkdir('/working'); mujoco.FS.mkdir('/working/assets'); } catch (e) { /* already there */ }
  }
  if (data) { try { data.delete(); } catch (e) {} data = null; }
  if (model) { try { model.delete(); } catch (e) {} model = null; }
  armJoints = []; armDofs = []; armRanges = []; fingerQpos = [];
  const pandaText = await fetchInto(mujoco, './panda.xml', '/working/panda.xml');
  await fetchInto(mujoco, './' + sceneFile, '/working/scene.xml');
  const files = [...new Set([...pandaText.matchAll(/file="([^"]+)"/g)].map(m => m[1]))];
  let done = 0;
  const pool = [...files];
  async function worker() {
    while (pool.length) {
      const f = pool.shift();
      await fetchInto(mujoco, './assets/' + f, '/working/assets/' + f, true);
      done++; setProgress(0.05 + 0.75 * (done / files.length), `Loading arm & shrine assets… ${done}/${files.length}`);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
  setProgress(0.84, 'Compiling the world…');
  model = mujoco.MjModel.mj_loadXML('/working/scene.xml');
  data = new mujoco.MjData(model);
  const OBJ = mujoco.mjtObj;
  siteId = mujoco.mj_name2id(model, OBJ.mjOBJ_SITE.value, 'grasp');
  handBody = mujoco.mj_name2id(model, OBJ.mjOBJ_BODY.value, 'hand');
  relicBody = mujoco.mj_name2id(model, OBJ.mjOBJ_BODY.value, 'relic');
  for (let i = 1; i <= 7; i++) {
    const j = mujoco.mj_name2id(model, OBJ.mjOBJ_JOINT.value, 'joint' + i);
    armJoints.push(j); armDofs.push(model.jnt_dofadr[j]);
    armRanges.push([model.jnt_range[j * 2], model.jnt_range[j * 2 + 1]]);
  }
  for (const n of ['finger_joint1', 'finger_joint2']) {
    const j = mujoco.mj_name2id(model, OBJ.mjOBJ_JOINT.value, n);
    fingerQpos.push(model.jnt_qposadr[j]);
  }
  const rj = mujoco.mj_name2id(model, OBJ.mjOBJ_JOINT.value, 'relic_joint');
  relicQposAdr = model.jnt_qposadr[rj]; relicDofAdr = model.jnt_dofadr[rj];
  guardianAct = mujoco.mj_name2id(model, OBJ.mjOBJ_ACTUATOR.value, 'guardian_act');
  setProgress(0.9, 'World compiled: ' + model.nbody + ' bodies, ' + model.ngeom + ' geoms');
}

// ---------------------------------------------------------------- three.js scene
let renderer, scene3, camera, controls, bodies3 = {};
let handleMesh, targetMesh, targetLine, vaultRing;
const CAM_HOME = { pos: new THREE.Vector3(1.02, 0.98, 1.28), tgt: new THREE.Vector3(-0.02, 0.34, -0.02) };

function nameOf(arr, adr) {
  let end = adr; const bytes = new Uint8Array(arr);
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder().decode(bytes.subarray(adr, end));
}
function swizzlePos(buf, idx, target) { return target.set(buf[idx * 3], buf[idx * 3 + 2], -buf[idx * 3 + 1]); }
function swizzleQuat(buf, idx, target) { return target.set(-buf[idx * 4 + 1], -buf[idx * 4 + 3], buf[idx * 4 + 2], -buf[idx * 4]); }

let worldRoot = null, glowLight = null;
function buildThree() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $('scene').appendChild(renderer.domElement);

  scene3 = new THREE.Scene();
  scene3.background = new THREE.Color(0x0a1420);
  scene3.fog = new THREE.Fog(0x0a1420, 4.5, 9);
  camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.01, 60);
  camera.position.set(2.3, 1.7, 2.5);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(CAM_HOME.tgt);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.45; controls.minDistance = 0.5; controls.maxDistance = 4;
  controls.enablePan = false; controls.enableZoom = true; // wheel = camera zoom only (never gripper height)

  scene3.add(new THREE.AmbientLight(0xbdd6e6, 0.55));
  const key = new THREE.DirectionalLight(0xfff1d6, 2.2);
  key.position.set(1.4, 2.4, -0.8); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -1.4; key.shadow.camera.right = 1.4;
  key.shadow.camera.top = 1.4; key.shadow.camera.bottom = -1.4;
  key.shadow.camera.far = 6; key.shadow.bias = -0.0004;
  scene3.add(key);
  const rim = new THREE.DirectionalLight(0x6fd8ff, 0.7); rim.position.set(-1.6, 1.2, 1.4); scene3.add(rim);
  glowLight = new THREE.PointLight(0x2ee6c8, 3.5, 1.6); glowLight.position.copy(V3([VAULT.x, VAULT.y, 0.45])); scene3.add(glowLight);
}

function buildBodies() {
  if (worldRoot) scene3.remove(worldRoot);
  bodies3 = {};
  // Build one three.js group per MuJoCo body, one mesh per geom (groups 0-2).
  const root = new THREE.Group(); root.name = 'MuJoCo Root'; worldRoot = root; scene3.add(root);
  const meshGeoms = {};
  for (let b = 0; b < model.nbody; b++) { bodies3[b] = new THREE.Group(); bodies3[b].name = nameOf(model.names, model.name_bodyadr[b]); root.add(bodies3[b]); }
  for (let g = 0; g < model.ngeom; g++) {
    if (model.geom_group[g] >= 3) continue; // collision-only geoms stay invisible
    const b = model.geom_bodyid[g], type = model.geom_type[g];
    const size = [model.geom_size[g * 3], model.geom_size[g * 3 + 1], model.geom_size[g * 3 + 2]];
    let geo = null;
    if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) geo = new THREE.PlaneGeometry(16, 16);
    else if (type === mujoco.mjtGeom.mjGEOM_SPHERE.value) geo = new THREE.SphereGeometry(size[0], 24, 18);
    else if (type === mujoco.mjtGeom.mjGEOM_CAPSULE.value) geo = new THREE.CapsuleGeometry(size[0], size[1] * 2, 6, 14);
    else if (type === mujoco.mjtGeom.mjGEOM_CYLINDER.value) geo = new THREE.CylinderGeometry(size[0], size[0], size[1] * 2, 28);
    else if (type === mujoco.mjtGeom.mjGEOM_BOX.value) geo = new THREE.BoxGeometry(size[0] * 2, size[2] * 2, size[1] * 2);
    else if (type === mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) { geo = new THREE.SphereGeometry(1, 24, 18); }
    else if (type === mujoco.mjtGeom.mjGEOM_MESH.value) {
      const mid = model.geom_dataid[g];
      if (!meshGeoms[mid]) {
        const nv = model.mesh_vertnum[mid], na = model.mesh_vertadr[mid];
        const vert = Float32Array.from(model.mesh_vert.subarray(na * 3, (na + nv) * 3));
        const norm = Float32Array.from(model.mesh_normal.subarray(model.mesh_normaladr[mid] * 3, (model.mesh_normaladr[mid] + model.mesh_normalnum[mid]) * 3));
        for (let v = 0; v < vert.length; v += 3) { const t = vert[v + 1]; vert[v + 1] = vert[v + 2]; vert[v + 2] = -t; const u = norm[v + 1]; norm[v + 1] = norm[v + 2]; norm[v + 2] = -u; }
        const nf = model.mesh_facenum[mid], fa = model.mesh_faceadr[mid];
        const face = new Uint32Array(model.mesh_face.subarray(fa * 3, (fa + nf) * 3));
        const gg = new THREE.BufferGeometry();
        gg.setAttribute('position', new THREE.BufferAttribute(vert, 3));
        gg.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
        gg.setIndex(new THREE.BufferAttribute(face, 1));
        meshGeoms[mid] = gg;
      }
      geo = meshGeoms[mid];
    }
    if (!geo) continue;
    let rgba = [model.geom_rgba[g * 4], model.geom_rgba[g * 4 + 1], model.geom_rgba[g * 4 + 2], model.geom_rgba[g * 4 + 3]];
    let tex = null, shin = 0.3, matName = '';
    const matId = model.geom_matid[g];
    if (matId >= 0) {
      rgba = [model.mat_rgba[matId * 4], model.mat_rgba[matId * 4 + 1], model.mat_rgba[matId * 4 + 2], model.mat_rgba[matId * 4 + 3]];
      shin = model.mat_shininess[matId];
      matName = nameOf(model.names, model.name_matadr[matId]);
      const texId = model.mat_texid[matId * 10 + 1]; // mjTEXROLE_RGB
      if (texId >= 0) {
        const w = model.tex_width[texId], h = model.tex_height[texId], ch = model.tex_nchannel[texId];
        const off = Number(model.tex_adr[texId]), src = model.tex_data;
        const px = new Uint8Array(w * h * 4);
        for (let p = 0; p < w * h; p++) { px[p * 4] = src[off + p * ch]; px[p * 4 + 1] = ch > 1 ? src[off + p * ch + 1] : px[p * 4]; px[p * 4 + 2] = ch > 2 ? src[off + p * ch + 2] : px[p * 4]; px[p * 4 + 3] = ch > 3 ? src[off + p * ch + 3] : 255; }
        tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(model.mat_texrepeat[matId * 2] || 1, model.mat_texrepeat[matId * 2 + 1] || 1);
        tex.needsUpdate = true;
      }
    }
    const emissive = /glow|gem|flame/.test(matName) ? new THREE.Color(rgba[0], rgba[1], rgba[2]) : new THREE.Color(0x000000);
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(rgba[0], rgba[1], rgba[2]), map: tex,
      roughness: clamp(0.95 - shin * 0.75, 0.15, 0.95),
      metalness: /gold/.test(matName) ? 0.75 : 0.06,
      transparent: rgba[3] < 1, opacity: rgba[3],
      emissive, emissiveIntensity: emissive.r + emissive.g + emissive.b > 0 ? 0.55 : 0,
    });
    const mesh = new THREE.Mesh(geo, mat);
    if (type === mujoco.mjtGeom.mjGEOM_PLANE.value) mesh.rotation.x = -Math.PI / 2;
    else { swizzlePos(model.geom_pos, g, mesh.position); swizzleQuat(model.geom_quat, g, mesh.quaternion); }
    if (type === mujoco.mjtGeom.mjGEOM_ELLIPSOID.value) mesh.scale.set(size[0], size[2], size[1]);
    mesh.castShadow = type !== mujoco.mjtGeom.mjGEOM_PLANE.value;
    mesh.receiveShadow = true;
    bodies3[b].add(mesh);
  }

  // Gripper handle (drag target), desired-target marker, tether line, vault ring.
  handleMesh = new THREE.Mesh(new THREE.SphereGeometry(0.020, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x2ee6c8, transparent: true, opacity: 0.85 }));
  scene3.add(handleMesh);
  targetMesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.016),
    new THREE.MeshBasicMaterial({ color: 0xf5b93f, transparent: true, opacity: 0.9 }));
  scene3.add(targetMesh);
  targetLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0x2ee6c8, transparent: true, opacity: 0.4 }));
  scene3.add(targetLine);
  vaultRing = new THREE.Mesh(new THREE.RingGeometry(0.085, 0.105, 40),
    new THREE.MeshBasicMaterial({ color: 0x2ee6c8, transparent: true, opacity: 0.65, side: THREE.DoubleSide }));
  vaultRing.rotation.x = -Math.PI / 2;
  scene3.add(vaultRing);

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function placeGoalHelpers() {
  vaultRing.position.copy(V3([VAULT.x, VAULT.y, VAULT.z - 0.026]));
  if (glowLight) glowLight.position.copy(V3([VAULT.x, VAULT.y, VAULT.z + 0.25]));
  gripHit = [handleMesh];
  for (let b = 0; b < model.nbody; b++) if (bodies3[b] && ['hand', 'left_finger', 'right_finger'].includes(bodies3[b].name)) gripHit.push(bodies3[b]);
}

function syncBodies() {
  for (let b = 0; b < model.nbody; b++) {
    if (!bodies3[b]) continue;
    swizzlePos(data.xpos, b, bodies3[b].position);
    swizzleQuat(data.xquat, b, bodies3[b].quaternion);
  }
}

// ---------------------------------------------------------------- control (Cartesian IK)
const targetPos = new Float64Array(3);      // smoothed target (MuJoCo coords)
const desiredPos = new Float64Array(3);     // raw user target
const targetVel = new Float64Array(3);
let targetQuat = [1, 0, 0, 0];              // desired hand orientation (w,x,y,z)
let qTarget = [...HOME_Q];
let gripGoal = 255, gripCtrl = 255;         // 255 = open, 0 = closed
const keys = new Set();
let precision = false;

function sitePos(out) { out[0] = data.site_xpos[siteId * 3]; out[1] = data.site_xpos[siteId * 3 + 1]; out[2] = data.site_xpos[siteId * 3 + 2]; return out; }
function handQuat() { const o = handBody * 4; return [data.xquat[o], data.xquat[o + 1], data.xquat[o + 2], data.xquat[o + 3]]; }
function quatMul(a, b) { return [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]; }
function quatRotVec(q) { // rotation vector of q (w,x,y,z), shortest arc
  let [w, x, y, z] = q; if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.hypot(x, y, z); if (s < 1e-8) return [2 * x, 2 * y, 2 * z];
  const ang = 2 * Math.atan2(s, w), k = ang / s; return [x * k, y * k, z * k];
}
function solve6(A, b) { // Gaussian elimination with partial pivot, A: 6x6 row-major
  const M = A.slice(), x = b.slice();
  for (let c = 0; c < 6; c++) {
    let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(M[r * 6 + c]) > Math.abs(M[piv * 6 + c])) piv = r;
    if (piv !== c) { for (let k = 0; k < 6; k++) { const t = M[c * 6 + k]; M[c * 6 + k] = M[piv * 6 + k]; M[piv * 6 + k] = t; } const t = x[c]; x[c] = x[piv]; x[piv] = t; }
    const d = M[c * 6 + c] || 1e-9;
    for (let r = 0; r < 6; r++) { if (r === c) continue; const f = M[r * 6 + c] / d; for (let k = c; k < 6; k++) M[r * 6 + k] -= f * M[c * 6 + k]; x[r] -= f * x[c]; }
  }
  for (let i = 0; i < 6; i++) x[i] /= (M[i * 6 + i] || 1e-9);
  return x;
}
function invert6(A) {
  const M = A.slice(), I = new Array(36).fill(0); for (let i = 0; i < 6; i++) I[i * 6 + i] = 1;
  for (let c = 0; c < 6; c++) {
    let piv = c; for (let r = c + 1; r < 6; r++) if (Math.abs(M[r * 6 + c]) > Math.abs(M[piv * 6 + c])) piv = r;
    if (piv !== c) for (let k = 0; k < 6; k++) { let t = M[c * 6 + k]; M[c * 6 + k] = M[piv * 6 + k]; M[piv * 6 + k] = t; t = I[c * 6 + k]; I[c * 6 + k] = I[piv * 6 + k]; I[piv * 6 + k] = t; }
    const d = M[c * 6 + c] || 1e-9;
    for (let k = 0; k < 6; k++) { M[c * 6 + k] /= d; I[c * 6 + k] /= d; }
    for (let r = 0; r < 6; r++) { if (r === c) continue; const f = M[r * 6 + c]; for (let k = 0; k < 6; k++) { M[r * 6 + k] -= f * M[c * 6 + k]; I[r * 6 + k] -= f * I[c * 6 + k]; } }
  }
  return I;
}

const _ee = new Float64Array(3);
function ikStep(dt) {
  sitePos(_ee);
  // Build the 6x7 geometric Jacobian from MuJoCo's world joint anchors/axes.
  const J = new Float64Array(6 * 7);
  for (let i = 0; i < 7; i++) {
    const j = armJoints[i], o = j * 3;
    const ax = data.xaxis[o], ay = data.xaxis[o + 1], az = data.xaxis[o + 2];
    const px = _ee[0] - data.xanchor[o], py = _ee[1] - data.xanchor[o + 1], pz = _ee[2] - data.xanchor[o + 2];
    J[0 * 7 + i] = ay * pz - az * py; J[1 * 7 + i] = az * px - ax * pz; J[2 * 7 + i] = ax * py - ay * px;
    J[3 * 7 + i] = ax; J[4 * 7 + i] = ay; J[5 * 7 + i] = az;
  }
  // Desired task velocity: position first; orientation is a soft preference
  // (weighted down, and relaxed further while position error is large).
  const posErr = [targetPos[0] - _ee[0], targetPos[1] - _ee[1], targetPos[2] - _ee[2]];
  const posErrMag = Math.hypot(posErr[0], posErr[1], posErr[2]);
  const ow = posErrMag > 0.08 ? 0.22 : 0.45;
  const v = new Float64Array(6);
  for (let k = 0; k < 3; k++) v[k] = clamp(posErr[k] * 2.6, -0.45, 0.45);
  const qc = handQuat(), qe = quatMul(targetQuat, [qc[0], -qc[1], -qc[2], -qc[3]]);
  const rv = quatRotVec(qe);
  for (let k = 0; k < 3; k++) v[3 + k] = clamp(rv[k] * 1.6, -1.0, 1.0) * ow;
  for (let i = 0; i < 7; i++) { J[3 * 7 + i] *= ow; J[4 * 7 + i] *= ow; J[5 * 7 + i] *= ow; }
  // Damped least squares: dq = J^T (J J^T + l^2 I)^-1 v
  const A = new Float64Array(36);
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { let sm = 0; for (let i = 0; i < 7; i++) sm += J[r * 7 + i] * J[c * 7 + i]; A[r * 6 + c] = sm + (r === c ? 0.01 : 0); }
  const Ainv = invert6(A);
  const y = new Float64Array(6);
  for (let r = 0; r < 6; r++) { let sm = 0; for (let c = 0; c < 6; c++) sm += Ainv[r * 6 + c] * v[c]; y[r] = sm; }
  const dq = new Float64Array(7);
  for (let i = 0; i < 7; i++) { let sm = 0; for (let r = 0; r < 6; r++) sm += J[r * 7 + i] * y[r]; dq[i] = sm; }
  // Null-space posture pull toward HOME so the elbow behaves naturally.
  const pinv = new Float64Array(7 * 6);
  for (let i = 0; i < 7; i++) for (let c = 0; c < 6; c++) { let sm = 0; for (let r = 0; r < 6; r++) sm += J[r * 7 + i] * Ainv[r * 6 + c]; pinv[i * 6 + c] = sm; }
  const post = new Float64Array(7);
  for (let i = 0; i < 7; i++) post[i] = clamp((HOME_Q[i] - data.qpos[model.jnt_qposadr[armJoints[i]]]) * 0.5, -0.35, 0.35);
  const Jpost = new Float64Array(6);
  for (let r = 0; r < 6; r++) { let sm = 0; for (let i = 0; i < 7; i++) sm += J[r * 7 + i] * post[i]; Jpost[r] = sm; }
  for (let i = 0; i < 7; i++) { let np = 0; for (let c = 0; c < 6; c++) np += pinv[i * 6 + c] * Jpost[c]; dq[i] += clamp(post[i] - np, -0.35, 0.35); }
  // Integrate joint position targets, with anti-windup: never let a target run
  // more than 0.30 rad ahead of the actual joint (prevents whip after contact).
  let nrm = 0; for (let i = 0; i < 7; i++) nrm += dq[i] * dq[i]; nrm = Math.sqrt(nrm);
  const scale = nrm > 1.5 ? 1.5 / nrm : 1;
  for (let i = 0; i < 7; i++) {
    const d = clamp(dq[i] * scale, -1.1, 1.1);
    qTarget[i] = clamp(qTarget[i] + d * dt, armRanges[i][0], armRanges[i][1]);
    const qa = data.qpos[model.jnt_qposadr[armJoints[i]]];
    qTarget[i] = clamp(qTarget[i], qa - 0.30, qa + 0.30);
    data.ctrl[i] = qTarget[i];
  }
  gripCtrl += clamp(gripGoal - gripCtrl, -900 * dt, 900 * dt);
  data.ctrl[7] = gripCtrl;
  if (guardianAct >= 0) data.ctrl[guardianAct] = guardianCtrl;
}

// ---------------------------------------------------------------- game state
let phase = 'attract'; // attract | playing | done
let lastRunSuccess = false;
let simTime = 0, playTime = 0, integrity = 100, guardianCtrl = -0.30, guardianAwake = false;
let held = false, everGrasped = false, placedDwell = 0, failed = null;
let frames = [], lastSample = -1, prevRelicVel = [0, 0, 0], lastImpactAt = -9;
let prevEE = null, eeVelPrev = null, eeAccPrev = null, jerkSum = 0, jerkN = 0;
const events = [];
let audioCtx = null;
function beep(freq, dur = 0.08, gain = 0.05, type = 'sine') {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq; g.gain.value = gain;
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g).connect(audioCtx.destination); o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio is garnish */ }
}
let toastTimer = null;
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function setStep(name, cls) {
  document.querySelectorAll('#steps li').forEach(li => {
    if (li.dataset.step === name) li.className = cls;
  });
}
function refreshSteps() {
  const rp = relicPos();
  const nearRelic = Math.hypot(rp[0] - RELIC_START[0], rp[1] - RELIC_START[1]) < 0.05 && !everGrasped;
  setStep('reach', everGrasped ? 'done' : 'active');
  setStep('grasp', everGrasped ? 'done' : (nearRelic ? 'active' : ''));
  setStep('carry', held ? 'active' : (everGrasped ? 'done' : ''));
  setStep('place', phase === 'done' && !failed ? 'done' : (everGrasped && !held ? 'active' : ''));
}
function relicPos() { const o = relicBody * 3; return [data.xpos[o], data.xpos[o + 1], data.xpos[o + 2]]; }
function relicVel() { const o = relicDofAdr; return [data.qvel[o], data.qvel[o + 1], data.qvel[o + 2]]; }
function fingerOpen() { return (data.qpos[fingerQpos[0]] + data.qpos[fingerQpos[1]]) / 2; }
let finalTilt = 0;
function propTilt() { // angle between the prop's local +Z and world +Z, radians
  const o = relicBody * 4;
  const w = data.xquat[o], x = data.xquat[o + 1], y = data.xquat[o + 2];
  const upZ = 1 - 2 * (x * x + y * y);
  return Math.acos(clamp(upZ, -1, 1));
}

function resetWorld() {
  mujoco.mj_resetData(model, data);
  data.qpos.set([...HOME_Q, 0.04, 0.04], 0);
  const rq = relicQposAdr;
  data.qpos[rq] = RELIC_START[0]; data.qpos[rq + 1] = RELIC_START[1]; data.qpos[rq + 2] = RELIC_START[2];
  const pq = L.propQuat || [1, 0, 0, 0];
  data.qpos[rq + 3] = pq[0]; data.qpos[rq + 4] = pq[1]; data.qpos[rq + 5] = pq[2]; data.qpos[rq + 6] = pq[3];
  // Certified runs start from a slightly shifted prop pose (±2 cm, ±0.3 rad
  // yaw) so each verified trajectory is genuinely different training data.
  runJitter = { dx: 0, dy: 0, yaw: 0 };
  if (runMode === 'certified') {
    const J = L.jitter || { xy: 0.02, yaw: 0.3 };
    const dx = (Math.random() * 2 - 1) * J.xy, dy = (Math.random() * 2 - 1) * J.xy, yaw = (Math.random() * 2 - 1) * J.yaw;
    data.qpos[rq] += dx; data.qpos[rq + 1] += dy;
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
    const w = data.qpos[rq + 3], x = data.qpos[rq + 4], y = data.qpos[rq + 5], z = data.qpos[rq + 6];
    data.qpos[rq + 3] = cy * w - sy * z; data.qpos[rq + 4] = cy * x - sy * y;
    data.qpos[rq + 5] = cy * y + sy * x; data.qpos[rq + 6] = cy * z + sy * w;
    runJitter = { dx: +dx.toFixed(3), dy: +dy.toFixed(3), yaw: +yaw.toFixed(3) };
  }
  data.ctrl.set([...HOME_Q, 255], 0);
  if (guardianAct >= 0) data.ctrl[guardianAct] = L.guardian ? L.guardian.park : 0;
  mujoco.mj_forward(model, data);
  qTarget = [...HOME_Q]; gripCtrl = 255; gripGoal = 255;
  sitePos(targetPos); desiredPos.set(targetPos); targetVel.fill(0);
  targetQuat = handQuat();
  integrity = 100; held = false; everGrasped = false; placedDwell = 0; failed = null;
  frames = []; events.length = 0; jerkSum = 0; jerkN = 0; prevEE = null; eeVelPrev = null; eeAccPrev = null; flyToUses = 0; fly = null;
  playTime = 0; guardianAwake = false; guardianCtrl = L.guardian ? L.guardian.park : 0; lastImpactAt = -9;
  prevRelicVel = [0, 0, 0]; finalTilt = 0;
  $('meterLabel').textContent = L.meterLabel;
  $('integrityVal').textContent = L.meterMode === 'tilt' ? '0°' : '100%';
  document.querySelector('#integrityMeter > i').style.width = '100%';
  $('integrityMeter').classList.remove('bad');
  $('guardianNote').textContent = L.guardianNote;
  $('guardianNote').classList.remove('awake');
  $('stars').textContent = '';
  refreshSteps();
}

function applyLevelTexts() {
  $('missionTitle').textContent = L.title;
  $('missionSub').textContent = L.sub;
  document.querySelectorAll('#steps li').forEach((li, i) => { if (L.steps[i]) li.textContent = L.steps[i]; });
  $('scoreLab').textContent = 'PAR ' + L.par + 's';
  $('introKick').textContent = L.kick + (runMode === 'practice' ? ' · PRACTICE' : '');
  $('introTitle').textContent = L.title;
  $('introStory').textContent = L.story;
  $('introMode').textContent = runMode === 'practice'
    ? 'Practice run: no points, nothing locks — learn the route freely.'
    : 'Certified run: a verified success counts toward this site\'s ' + MAX_VERIFIED + ' runs — fail, and nothing is consumed. Each certified run starts from a slightly shifted prop position.';
  document.title = 'OpenGrasp Expedition — ' + L.title;
}
function showIntro() { applyLevelTexts(); $('hub').classList.add('hidden'); $('intro').classList.remove('hidden'); }

async function loadLevel(i, mode) {
  levelIdx = i; L = LEVELS[i]; runMode = mode || 'certified';
  RELIC_START = L.propStart; VAULT = L.goal;
  $('hub').classList.add('hidden'); $('result').classList.add('hidden'); $('intro').classList.add('hidden');
  $('loading').classList.remove('hidden');
  setProgress(0.02, 'Sailing to the next site…');
  try {
    await initPhysics(L.scene);
    buildBodies(); placeGoalHelpers(); applyLevelTexts(); resetWorld();
    phase = 'attract';
    setProgress(1, 'Ready.');
    setTimeout(() => { $('loading').classList.add('hidden'); showIntro(); }, 300);
  } catch (err) {
    console.error(err);
    loadmsg.textContent = 'Failed to load this expedition: ' + (err.message || err);
  }
}

// ---------------------------------------------------------------- hub & progress
// The hub is the adventure map: the shrine restores as sites are explored,
// the expedition log fills in, and each site accepts up to MAX_VERIFIED
// verified runs per explorer before it is complete. Practice never locks.
const MAX_VERIFIED = 5;
let progress = { stars: {}, points: 0, attempts: {} };
try {
  const raw = JSON.parse(localStorage.getItem('opengrasp_progress') || 'null');
  if (raw && raw.stars) {
    progress = raw;
    if (!progress.attempts) { // migrate pre-map saves: a certified task had 1 verified run
      progress.attempts = {};
      for (const k in progress.stars) progress.attempts[k] = 1;
    }
  }
} catch (e) { /* fresh expedition */ }
function saveProgress() { try { localStorage.setItem('opengrasp_progress', JSON.stringify(progress)); } catch (e) { /* private mode */ } }
function verifiedCount(i) { return progress.attempts[i] || 0; }
function siteComplete(i) { return verifiedCount(i) >= MAX_VERIFIED; }
function certifyLevel(stars, points) {
  const n = verifiedCount(levelIdx) + 1;
  progress.attempts[levelIdx] = n;
  if (progress.stars[levelIdx] == null || stars > progress.stars[levelIdx]) progress.stars[levelIdx] = stars;
  progress.points += points;
  saveProgress();
  return n;
}
const RESTORE_LINES = [
  'The shrine sleeps in ruin. Three tasks await.',
  'The relic glows in the vault — the restoration has begun.',
  'Relic safe and monolith standing — the shrine is waking.',
  'The shrine is whole again. Dawnwater glows on the shelf. The expedition is legend.',
];
const MAP_POS = [{ x: 15, y: 58 }, { x: 50, y: 30 }, { x: 85, y: 58 }]; // % positions on the expedition map
// Season 1 sites: charted on the map, locked. Deliberately OUTSIDE LEVELS —
// decorative only; no game logic, save data, or stat counter ever reads this.
const FUTURE_SITES = [
  { x: 13, y: 14.5, title: 'The Sunken Forge', kick: 'EXPEDITION 04 · THE DROWNED SMITHY', sub: 'A precision task is being charted for the drowned smithy.' },
  { x: 87, y: 14.5, title: 'The Sky Observatory', kick: 'EXPEDITION 05 · THE TELESCOPE TOWER', sub: 'A long-reach task is being charted for the telescope tower.' },
];
function renderHub() {
  const restored = LEVELS.filter((_, i) => verifiedCount(i) > 0).length;
  $('hubPoints').textContent = progress.points;
  if ($('hubVerified')) $('hubVerified').textContent = LEVELS.reduce((s, _, i) => s + verifiedCount(i), 0) + ' / ' + (MAX_VERIFIED * LEVELS.length);
  if ($('hubStars')) $('hubStars').textContent = LEVELS.reduce((s, _, i) => s + (progress.stars[i] || 0), 0) + ' / ' + (3 * LEVELS.length);
  $('hubRestore').textContent = RESTORE_LINES[restored];
  $('hubLog').innerHTML = LEVELS.map((lv, i) => verifiedCount(i) > 0
    ? '<div class="logline">📜 <b>' + lv.title + ':</b> ' + lv.outro + '</div>' : '').join('') || '<div class="logline dim">No log entries yet — complete your first verified run.</div>';
  const nodes = LEVELS.map((lv, i) => {
    const n = verifiedCount(i), st = progress.stars[i], complete = siteComplete(i);
    const pips = Array.from({ length: MAX_VERIFIED }, (_, k) => '<i class="' + (k < n ? 'on' : '') + '"></i>').join('');
    return '<div class="mapnode' + (complete ? ' complete' : '') + '" style="left:' + MAP_POS[i].x + '%;top:' + MAP_POS[i].y + '%">' +
      '<div class="nodekick">' + lv.kick + '</div>' +
      '<div class="nodebadge">' + lv.no + '</div>' +
      '<div class="nodename">' + lv.title + '</div>' +
      '<div class="nodesub">' + lv.sub + '</div>' +
      '<div class="nodestars">' + (st != null ? '★'.repeat(st) + '☆'.repeat(3 - st) : '☆☆☆') + '</div>' +
      '<div class="pips">' + pips + '</div>' +
      '<div class="nodestatus">' + (complete ? 'SITE COMPLETE ✓' : 'OPEN · ' + n + '/' + MAX_VERIFIED + ' verified') + '</div>' +
      '<div class="nodebtns">' +
      (complete ? '' : '<button class="btn" data-act="play" data-level="' + i + '">' + (n === 0 ? 'Begin Certified Run' : 'Verified Run ' + (n + 1) + ' of ' + MAX_VERIFIED) + '</button>') +
      '<button class="btn ghost" data-act="practice" data-level="' + i + '">Practice</button>' +
      '</div></div>';
  }).join('');
  const futureNodes = FUTURE_SITES.map((s) =>
    '<div class="mapnode locked" style="left:' + s.x + '%;top:' + s.y + '%">' +
    '<div class="nodekick">' + s.kick + '</div>' +
    '<div class="nodebadge">🔒</div>' +
    '<div class="nodename">' + s.title + '</div>' +
    '<div class="nodesub">' + s.sub + '</div>' +
    '<div class="nodetag">SEASON 1 · LOCKED</div></div>').join('');
  $('hubCards').innerHTML = '<div class="mapwrap">' +
    '<svg class="mapsvg" viewBox="0 0 1000 600" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M500 545 C 400 480, 240 440, 150 355" />' +
    '<path d="M500 545 C 500 450, 500 290, 500 188" />' +
    '<path d="M500 545 C 600 480, 760 440, 850 355" />' +
    '<path class="futuretrail" d="M500 545 C 430 430, 240 250, 132 92" />' +
    '<path class="futuretrail" d="M500 545 C 570 430, 760 250, 868 92" />' +
    '</svg>' +
    '<div class="shrinepin">⛩<span>THE SUNKEN SHRINE</span></div>' +
    nodes + futureNodes + '</div>';
}
function showHub() { renderHub(); $('hub').classList.remove('hidden'); }

function startPlay() {
  resetWorld();
  runVerifiedNo = runMode === 'certified' ? verifiedCount(levelIdx) + 1 : null;
  phase = 'playing'; lastSample = -1;
  events.push({ t: 0, type: 'expedition_start', task: L.task, level: levelIdx + 1, mode: runMode, verified_run: runVerifiedNo, prop_jitter: runJitter });
  toast((runMode === 'practice' ? 'PRACTICE · ' : '') + L.startToast, 2400);
  beep(660, 0.09, 0.04);
}

function endPlay(success, note) {
  phase = 'done';
  let quality = 0, points = 0, stars = 0;
  if (success) {
    const meanJerk = jerkN ? jerkSum / jerkN : 0;
    const smooth = clamp(1 - meanJerk / 60, 0, 1);
    const speed = clamp(1 - playTime / L.par, 0, 1);
    const tail = L.meterMode === 'tilt' ? 10 * clamp(1 - finalTilt / 0.45, 0, 1) : 10 * (integrity / 100);
    quality = Math.round(40 + 30 * smooth + 20 * speed + tail);
    if (L.frag && integrity <= 0) quality = Math.min(quality, 45);
    stars = quality >= 85 ? 3 : quality >= 70 ? 2 : 1;
    points = Math.round(L.base * quality / 100);
    events.push({ t: playTime, type: 'expedition_complete', quality, points, meanJerk: +meanJerk.toFixed(2), mode: runMode });
    if (runMode === 'certified') runVerifiedNo = certifyLevel(stars, points);
    beep(523, 0.12, 0.05); setTimeout(() => beep(784, 0.16, 0.05), 130);
  } else {
    events.push({ t: playTime, type: 'expedition_failed', reason: note });
    beep(196, 0.25, 0.05, 'sawtooth');
  }
  $('resultKick').textContent = success
    ? (runMode === 'certified' ? 'EXPEDITION COMPLETE · TASK CERTIFIED' : 'PRACTICE COMPLETE')
    : 'EXPEDITION FAILED';
  $('resultStars').textContent = success && runMode === 'certified' ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '☆☆☆';
  $('resultTitle').textContent = success ? L.doneTitle : note;
  $('stQuality').textContent = quality;
  $('stTime').textContent = playTime.toFixed(1) + 's';
  $('stIntegrityLab').textContent = L.meterMode === 'tilt' ? 'FINAL TILT' : 'INTEGRITY';
  $('stIntegrity').textContent = L.meterMode === 'tilt' ? Math.round(finalTilt * 57.2958) + '°' : Math.round(integrity) + '%';
  $('stPoints').textContent = runMode === 'certified' ? points : 0;
  $('resultNote').textContent = success
    ? (runMode === 'certified'
        ? L.outro + ' This run was recorded as a Franka Panda trajectory (30 Hz) — smooth carries like this are exactly the data robots learn from. ' + (runVerifiedNo >= MAX_VERIFIED ? 'That was verified run ' + MAX_VERIFIED + ' of ' + MAX_VERIFIED + ' — this site is now complete on the expedition map; practice stays open.' : 'Verified run ' + runVerifiedNo + ' of ' + MAX_VERIFIED + ' recorded — ' + (MAX_VERIFIED - runVerifiedNo) + ' more verified run' + (MAX_VERIFIED - runVerifiedNo === 1 ? '' : 's') + ' fit this site, each from a fresh prop position. Practice stays open.')
        : 'Practice run — no points, nothing locked. The trajectory was still recorded and labelled as practice.')
    : 'The trajectory was still recorded — recovery and failure data are valuable too. The task stays open: try again.';
  $('againBtn').textContent = success ? '🏕 Return to Hub' : 'Try Again';
  lastRunSuccess = success;
  $('result').classList.remove('hidden');
  refreshSteps();
}

function gameStep(dt) {
  if (phase !== 'playing') return;
  playTime += dt;
  const rp = relicPos(), rv = relicVel();
  sitePos(_ee);
  const finger = fingerOpen();
  const distEE = Math.hypot(rp[0] - _ee[0], rp[1] - _ee[1], rp[2] - _ee[2]);
  const wasHeld = held;
  held = gripCtrl < 60 && finger < L.graspW + 0.010 && finger > 0.003 && distEE < 0.095 && Math.hypot(rv[0], rv[1], rv[2]) < 1.2;
  if (held && !wasHeld) {
    everGrasped = true; events.push({ t: playTime, type: 'grasp' });
    beep(880, 0.06, 0.035);
    if (!guardianAwake) {
      guardianAwake = true;
      $('guardianNote').textContent = 'The Guardian is awake. Time your crossing.';
      $('guardianNote').classList.add('awake');
      toast('The Guardian wakes!', 1800);
    }
  }
  if (!held && wasHeld) events.push({ t: playTime, type: 'release', relic: rp.map(v => +v.toFixed(3)) });
  if (guardianAwake && L.guardian) guardianCtrl = L.guardian.amp * Math.sin(playTime * L.guardian.speed);
  // Fragility: sudden relic velocity changes = impacts / rough handling.
  const dv = Math.hypot(rv[0] - prevRelicVel[0], rv[1] - prevRelicVel[1], rv[2] - prevRelicVel[2]);
  if (L.frag && dv > L.frag.thresh && playTime - lastImpactAt > 0.25) {
    lastImpactAt = playTime;
    const dmg = Math.min(24, (dv - L.frag.thresh) * L.frag.scale);
    integrity = Math.max(0, integrity - dmg);
    events.push({ t: playTime, type: 'impact', dv: +dv.toFixed(2), damage: +dmg.toFixed(1), integrity: Math.round(integrity) });
    $('flash').style.opacity = 1; setTimeout(() => $('flash').style.opacity = 0, 130);
    beep(140, 0.1, 0.06, 'triangle');
    if (integrity <= 0) toast('It cracked! Finish gently — score capped.', 2400);
    $('integrityVal').textContent = Math.round(integrity) + '%';
    const bar = document.querySelector('#integrityMeter > i');
    bar.style.width = integrity + '%';
    $('integrityMeter').classList.toggle('bad', integrity < 45);
  }
  prevRelicVel = rv;
  if (L.meterMode === 'tilt') {
    const td = Math.round(propTilt() * 57.2958);
    $('integrityVal').textContent = td + '°';
    const bar = document.querySelector('#integrityMeter > i');
    bar.style.width = clamp(100 - td * 1.8, 0, 100) + '%';
    $('integrityMeter').classList.toggle('bad', td > 35);
  }
  // Fell off the dais?
  if (rp[2] < 0.085 && Math.abs(rp[0]) < 2) { failed = L.failNote; endPlay(false, failed); return; }
  // Success: resting at the goal, released, calm — and upright, on levels that ask for it.
  const inVault = Math.hypot(rp[0] - VAULT.x, rp[1] - VAULT.y) < VAULT.r && Math.abs(rp[2] - VAULT.z) < VAULT.zTol;
  const calm = Math.hypot(rv[0], rv[1], rv[2]) < 0.09;
  finalTilt = propTilt();
  const uprightOk = !L.upright || finalTilt < L.upright;
  if (inVault && calm && uprightOk && gripCtrl > 200 && distEE > 0.13) {
    placedDwell += dt;
    if (placedDwell > 1.0) { endPlay(true); return; }
  } else placedDwell = 0;
  // Record at 30 Hz + accumulate EE jerk for the smoothness score.
  if (playTime - lastSample >= 1 / 30 || lastSample < 0) {
    const dtS = lastSample < 0 ? 1 / 30 : playTime - lastSample;
    lastSample = playTime;
    const ee = [_ee[0], _ee[1], _ee[2]];
    if (prevEE) {
      const vel = ee.map((v, i) => (v - prevEE[i]) / dtS);
      if (eeVelPrev) {
        const acc = vel.map((v, i) => (v - eeVelPrev[i]) / dtS);
        if (eeAccPrev) { const jerk = acc.map((v, i) => (v - eeAccPrev[i]) / dtS); jerkSum += Math.hypot(jerk[0], jerk[1], jerk[2]); jerkN++; }
        eeAccPrev = acc;
      }
      eeVelPrev = vel;
    }
    prevEE = ee;
    frames.push({
      t: +playTime.toFixed(3),
      qpos: Array.from(data.qpos).map(v => +v.toFixed(5)),
      qvel: Array.from(data.qvel).map(v => +v.toFixed(5)),
      ctrl: Array.from(data.ctrl).map(v => +v.toFixed(4)),
      ee: ee.map(v => +v.toFixed(4)), relic: rp.map(v => +v.toFixed(4)),
      target: Array.from(targetPos).map(v => +v.toFixed(4)),
      grip: gripGoal < 128 ? 1 : 0, held: held ? 1 : 0,
    });
  }
  $('timer').textContent = playTime.toFixed(1) + 's';
  refreshSteps();
}

function downloadLog() {
  const meanJerk = jerkN ? jerkSum / jerkN : 0;
  const payload = {
    format: 'opengrasp-episode', version: 2, task: L.task, level: levelIdx + 1, mode: runMode, certified: runMode === 'certified',
    verified_run: runVerifiedNo, max_verified: MAX_VERIFIED, prop_jitter: runJitter,
    embodiment: 'franka_emika_panda_mujoco_menagerie', dof: 7, gripper: 'parallel_2f',
    physics: { engine: 'MuJoCo WASM 3.12', timestep: model.opt.timestep, integrator: 'implicitfast' },
    control: { mode: 'cartesian_ik_dls', recordHz: 30, assists: { cartesian_ik: true, posture_nullspace: true, fly_to: flyToUses > 0 }, fly_to_uses: flyToUses, sensitivity: +sensitivity.toFixed(2) },
    par_seconds: L.par, base_points: L.base,
    result: { phase, integrity: Math.round(integrity), final_tilt_deg: +(finalTilt * 57.2958).toFixed(1), duration: +playTime.toFixed(2), mean_ee_jerk: +meanJerk.toFixed(2) },
    events, frames,
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'opengrasp_' + L.task + '_episode.json';
  a.click(); URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- input
addEventListener('keydown', (e) => {
  if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') fly = null; // manual input takes over
  if (e.code === 'Space') { gripGoal = 0; e.preventDefault(); }
  keys.add(e.code); precision = e.shiftKey;
  if (e.code === 'KeyR') desiredPos[2] = clamp(desiredPos[2] + 0.0016, WS.z[0], WS.z[1]); // handled in loop via keys too
});
addEventListener('keyup', (e) => { if (e.code === 'Space') gripGoal = 255; keys.delete(e.code); precision = e.shiftKey; });
addEventListener('blur', () => { keys.clear(); gripGoal = 255; fly = null; dragging = false; dragAnchor = null; if (controls) controls.enabled = true; });

let dragging = false, dragAnchor = null;
let sensitivity = 1.0;
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
function setPtr(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
}
/* v1-style mouse control: grab the gripper (handle, hand or fingers) and pull it
   through 3D on a camera-facing plane — vertical included, sensitivity-scaled. */
let gripHit = [];
function castHandle(e) {
  setPtr(e);
  return ray.intersectObjects(gripHit, true).length > 0;
}
const dragPlane = new THREE.Plane();
function dragStart(e) {
  setPtr(e);
  const n = new THREE.Vector3(); camera.getWorldDirection(n);
  const anchor = V3(targetPos);
  dragPlane.setFromNormalAndCoplanarPoint(n, anchor);
  const p0 = new THREE.Vector3();
  dragAnchor = ray.ray.intersectPlane(dragPlane, p0) ? { plane: p0.clone(), start: [...desiredPos] } : null;
}
function dragMove(e) {
  if (!dragAnchor) return;
  setPtr(e);
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(dragPlane, hit)) {
    const d = hit.sub(dragAnchor.plane); // three-space delta -> MuJoCo (x, -z, y)
    desiredPos[0] = clamp(dragAnchor.start[0] + d.x * sensitivity, WS.x[0], WS.x[1]);
    desiredPos[1] = clamp(dragAnchor.start[1] - d.z * sensitivity, WS.y[0], WS.y[1]);
    desiredPos[2] = clamp(dragAnchor.start[2] + d.y * sensitivity, WS.z[0], WS.z[1]);
  }
}
/* double-click flight (v1 favourite): scripted desiredPos waypoints; the
   accel-limited target smoothing turns them into a smooth arc. Any key or
   drag cancels. Uses are counted and declared in the episode metadata. */
let fly = null, flyToUses = 0;
function startFly(waypoints, onDone, label) {
  fly = { queue: waypoints.map(w => [...w]), onDone: onDone || null, t0: simTime };
  if (phase === 'playing') { flyToUses++; events.push({ t: +playTime.toFixed(2), type: 'fly_to', label: label || '' }); }
  if (label) toast(label);
}
function stepFly() {
  if (!fly) return;
  if (simTime - fly.t0 > 14) { fly = null; toast('⚠ Flight stopped short — take manual control'); return; }
  const w = fly.queue[0];
  desiredPos[0] = w[0]; desiredPos[1] = w[1]; desiredPos[2] = w[2];
  sitePos(_ee);
  const dT = Math.hypot(targetPos[0] - w[0], targetPos[1] - w[1], targetPos[2] - w[2]);
  const dE = Math.hypot(_ee[0] - w[0], _ee[1] - w[1], _ee[2] - w[2]);
  // a waypoint counts as reached only when the hand itself is there — the
  // auto-grab must never fire while the gripper is still centimetres above.
  if (dT < 0.025 && dE < 0.045) { fly.queue.shift(); if (!fly.queue.length) { const f = fly.onDone; fly = null; if (f) f(); } }
}
function onDblClick(e) {
  if (!bodies3[relicBody]) return;
  setPtr(e);
  if (ray.intersectObject(bodies3[relicBody], true).length) {
    if (held) { toast('Already carrying — double-click the goal to fly there'); return; }
    const rp = relicPos();
    const go = L.graspOffset || [0, 0, 0];
    startFly([[rp[0] + go[0], rp[1] + go[1], 0.45], [rp[0] + go[0], rp[1] + go[1], Math.max(rp[2] + go[2], WS.z[0])]],
      () => { gripGoal = 0; toast('✊ Auto-grab — carry it gently'); }, '✈ Flying to the relic…');
    return;
  }
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.10); // dais top
  const hit = new THREE.Vector3();
  if (ray.ray.intersectPlane(floor, hit)) {
    const mx = hit.x, my = -hit.z;
    if (Math.hypot(mx - VAULT.x, my - VAULT.y) < 0.14) {
      startFly([[VAULT.x, VAULT.y, Math.max(0.45, L.goalFlyZ + 0.12)], [VAULT.x, VAULT.y, L.goalFlyZ]], null, '✈ Flying to the goal — Space releases');
    } else if (mx > WS.x[0] - 0.1 && mx < WS.x[1] + 0.1 && my > WS.y[0] - 0.1 && my < WS.y[1] + 0.1) {
      startFly([[mx, my, 0.45]], null, '✈ Flying…');
    }
  }
}
function bindInput() {
  const el = renderer.domElement;
  gripHit = [handleMesh];
  for (let b = 0; b < model.nbody; b++) if (bodies3[b] && ['hand', 'left_finger', 'right_finger'].includes(bodies3[b].name)) gripHit.push(bodies3[b]);
  el.addEventListener('pointerdown', (e) => { if (castHandle(e)) { fly = null; dragging = true; controls.enabled = false; el.setPointerCapture(e.pointerId); dragStart(e); dragMove(e); } });
  el.addEventListener('pointermove', (e) => { if (dragging) dragMove(e); });
  const endDrag = () => { dragging = false; dragAnchor = null; controls.enabled = true; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', onDblClick);
  const sens = $('sensSlider');
  if (sens) sens.addEventListener('input', () => { sensitivity = parseFloat(sens.value); $('sensVal').textContent = Math.round(sensitivity * 100) + '%'; });
  const hold = (id, on, off) => {
    const b = $(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); on(); });
    b.addEventListener('pointerup', off); b.addEventListener('pointerleave', off);
  };
  hold('gripBtn', () => gripGoal = 0, () => gripGoal = 255);
  hold('upBtn', () => keys.add('KeyR'), () => keys.delete('KeyR'));
  hold('downBtn', () => keys.add('KeyF'), () => keys.delete('KeyF'));
  $('resetBtn').onclick = () => { if (phase === 'playing') startPlay(); else resetWorld(); };
  $('camBtn').onclick = () => { camera.position.copy(CAM_HOME.pos); controls.target.copy(CAM_HOME.tgt); };
  $('beginBtn').onclick = () => { $('intro').classList.add('hidden'); startPlay(); };
  $('hubCards').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const i = +b.dataset.level;
    if (b.dataset.act === 'play') loadLevel(i, 'certified');
    else if (b.dataset.act === 'practice') loadLevel(i, 'practice');
  });
  $('againBtn').onclick = () => { $('result').classList.add('hidden'); if (lastRunSuccess) showHub(); else startPlay(); };
  $('hubBtn').onclick = () => { $('result').classList.add('hidden'); showHub(); };
  $('introHubBtn').onclick = () => { $('intro').classList.add('hidden'); showHub(); };
  $('hubBtnTop').onclick = () => { if (phase !== 'playing') showHub(); };
  $('dlBtn').onclick = downloadLog;
}

function keyboardDrive(dt) {
  // Camera-relative planar movement in MuJoCo coords.
  const fwd3 = new THREE.Vector3(); camera.getWorldDirection(fwd3);
  let fx = fwd3.x, fy = -fwd3.z; // three dir -> MuJoCo (x, y)
  const fl = Math.hypot(fx, fy) || 1; fx /= fl; fy /= fl;
  const rx = -fy, ry = fx; // right vector
  let mx = 0, my = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += fx; my += fy; }
  if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= fx; my -= fy; }
  if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += rx; my += ry; }
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= rx; my -= ry; }
  const sp = (precision ? 0.13 : 0.42) * sensitivity * dt;
  const ml = Math.hypot(mx, my); if (ml > 0) { desiredPos[0] += mx / ml * sp; desiredPos[1] += my / ml * sp; }
  if (keys.has('KeyR')) desiredPos[2] += sp * 0.8;
  if (keys.has('KeyF')) desiredPos[2] -= sp * 0.8;
  desiredPos[0] = clamp(desiredPos[0], WS.x[0], WS.x[1]);
  desiredPos[1] = clamp(desiredPos[1], WS.y[0], WS.y[1]);
  desiredPos[2] = clamp(desiredPos[2], WS.z[0], WS.z[1]);
  // Wrist yaw with Q/E: rotate desired orientation about world Z.
  let yaw = 0;
  if (keys.has('KeyQ')) yaw += 1.6 * dt;
  if (keys.has('KeyE')) yaw -= 1.6 * dt;
  if (yaw) { const h = yaw / 2, qz = [Math.cos(h), 0, 0, Math.sin(h)]; targetQuat = quatMul(qz, targetQuat); }
}

// ---------------------------------------------------------------- main loop
let lastMs = -1, accumulator = 0, camIntro = 0;
function loop(ms) {
  requestAnimationFrame(loop);
  if (!model) return;
  if (lastMs < 0) lastMs = ms;
  const frameDt = Math.min((ms - lastMs) / 1000, 0.06); lastMs = ms;
  if (fly) stepFly(); else keyboardDrive(frameDt);
  // Smooth the user target (accel-limited) so commands — and data — stay clean.
  const maxSpeed = precision ? 0.14 : 0.40;
  for (let k = 0; k < 3; k++) {
    const want = clamp((desiredPos[k] - targetPos[k]) * 9, -maxSpeed, maxSpeed);
    targetVel[k] += clamp(want - targetVel[k], -1.8 * frameDt, 1.8 * frameDt);
    targetPos[k] += targetVel[k] * frameDt;
  }
  const dt = model.opt.timestep;
  accumulator += frameDt;
  if (accumulator > 0.05) accumulator = 0.05;
  while (accumulator >= dt) {
    ikStep(dt);
    mujoco.mj_step(model, data);
    simTime += dt; accumulator -= dt;
    gameStep(dt);
    if (phase !== 'playing' && phase !== 'attract') { /* keep simulating in done for a lively scene */ }
    if (phase === 'attract') guardianCtrl = L.guardian ? L.guardian.park : 0;
  }
  syncBodies();
  sitePos(_ee);
  handleMesh.position.copy(V3(_ee));
  const s = 1 + 0.18 * Math.sin(ms / 240);
  handleMesh.scale.setScalar(held ? 1.25 : s);
  handleMesh.material.color.setHex(gripGoal < 128 ? 0xf5b93f : 0x2ee6c8);
  targetMesh.position.copy(V3(desiredPos));
  targetMesh.rotation.y = ms / 600;
  const pts = [V3(_ee), V3(desiredPos)];
  targetLine.geometry.setFromPoints(pts);
  vaultRing.material.opacity = 0.45 + 0.3 * Math.sin(ms / 420);
  if (camIntro < 1) { camIntro = Math.min(1, camIntro + frameDt / 2.4); const e = 1 - Math.pow(1 - camIntro, 3); camera.position.lerp(CAM_HOME.pos, e * 0.12 + 0.02); }
  controls.update();
  renderer.render(scene3, camera);
}

// ---------------------------------------------------------------- boot
(async () => {
  try {
    await initPhysics(L.scene);
    buildThree();
    buildBodies(); placeGoalHelpers();
    bindInput();
    applyLevelTexts();
    resetWorld();
    phase = 'attract';
    setProgress(1, 'Ready.');
    setTimeout(() => { $('loading').classList.add('hidden'); renderHub(); $('hub').classList.remove('hidden'); }, 350);
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    loadmsg.textContent = 'Failed to load: ' + (err.message || err) + ' — check your connection and reload.';
  }
})();
