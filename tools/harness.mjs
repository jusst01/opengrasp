// OpenGrasp v2 playthrough harness — extracts the SHIPPED logic from
// v2/app.js verbatim (IK, fly-to, game rules) and plays every level
// end-to-end in Node against the real MuJoCo WASM model.
// Regenerates its extraction on every run, so it always tests current code.
// Usage: node tools/harness.mjs [levelIndex ...]   (default: all levels)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'v2');
const appSrc = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

// ---------- extract shipped code ----------
function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  const lineStart = src.lastIndexOf('\n', i) + 1;
  let depth = 0, k = src.indexOf('{', i);
  const start = k;
  while (true) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    k++;
  }
  return src.slice(lineStart, k + 1);
}
function extractConst(src, name) {
  const i = src.indexOf('const ' + name);
  if (i < 0) throw new Error('const not found: ' + name);
  let depth = 0, k = i, started = false;
  while (k < src.length) {
    const c = src[k];
    if ('[{('.includes(c)) { depth++; started = true; }
    else if (']})'.includes(c)) depth--;
    else if (c === ';' && depth === 0) break;
    k++;
  }
  return src.slice(i, k + 1);
}
let consts = '';
consts += extractConst(appSrc, 'clamp') + '\n';
consts += extractConst(appSrc, 'HOME_Q') + '\n';
consts += extractConst(appSrc, 'LEVELS') + '\n';
consts += 'let levelIdx = 0, L = LEVELS[0], runMode = "certified";\nlet RELIC_START = L.propStart;\nlet VAULT = L.goal;\n';
consts += extractConst(appSrc, 'WS') + '\n';
let code = '';
for (const fn of ['sitePos', 'handQuat', 'quatMul', 'quatRotVec', 'invert6', 'ikStep',
  'relicPos', 'relicVel', 'fingerOpen', 'propTilt', 'beep', 'toast',
  'setStep', 'refreshSteps', 'resetWorld', 'startPlay', 'endPlay', 'gameStep',
  'startFly', 'stepFly', 'certifyLevel', 'saveProgress']) code += extractFn(appSrc, fn) + '\n';

// ---------- browser stubs ----------
const fakeEl = () => ({
  textContent: '', innerHTML: '', value: '1',
  style: new Proxy({}, { get: () => '', set: () => true }),
  classList: { add() {}, remove() {}, toggle() {} },
  dataset: {},
});
const els = {};
const $ = (id) => els[id] || (els[id] = fakeEl());
const documentStub = { querySelectorAll: () => [], querySelector: () => fakeEl() };
const store = new Map();
const localStorageStub = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };

// ---------- globals the shipped code expects ----------
const prelude = `
let mujoco, model, data;
let siteId = 0, handBody = 0, relicBody = 0;
let armJoints = [], armDofs = [], armRanges = [], fingerQpos = [];
let relicQposAdr = 0, relicDofAdr = 0, guardianAct = -1;
const targetPos = new Float64Array(3), desiredPos = new Float64Array(3), targetVel = new Float64Array(3);
let targetQuat = [1,0,0,0], qTarget = [...HOME_Q];
let gripGoal = 255, gripCtrl = 255;
const keys = new Set(); let precision = false, sensitivity = 1.0;
let phase = 'attract', lastRunSuccess = false;
let simTime = 0, playTime = 0, integrity = 100, guardianCtrl = 0, guardianAwake = false;
let held = false, everGrasped = false, placedDwell = 0, failed = null;
let frames = [], lastSample = -1, prevRelicVel = [0,0,0], lastImpactAt = -9;
let prevEE = null, eeVelPrev = null, eeAccPrev = null, jerkSum = 0, jerkN = 0;
const events = [];
let audioCtx = null, toastTimer = null;
let fly = null, flyToUses = 0;
let finalTilt = 0;
let progress = { stars: {}, points: 0 };
const _ee = new Float64Array(3);
`;

// ---------- physics boot (Node version of initPhysics' tail) ----------
const driver = `
async function bootPhysics(mujocoMod, sceneFile) {
  mujoco = mujocoMod;
  try { mujoco.FS.mkdir('/working'); mujoco.FS.mkdir('/working/assets'); } catch (e) {}
  const fsx = await import('node:fs');
  const pathx = await import('node:path');
  mujoco.FS.writeFile('/working/panda.xml', fsx.readFileSync(pathx.join(ROOT, 'panda.xml')));
  mujoco.FS.writeFile('/working/scene.xml', fsx.readFileSync(pathx.join(ROOT, sceneFile)));
  const pandaText = fsx.readFileSync(pathx.join(ROOT, 'panda.xml'), 'utf8');
  const files = [...new Set([...pandaText.matchAll(/file="([^"]+)"/g)].map(m => m[1]))];
  for (const f of files) mujoco.FS.writeFile('/working/assets/' + f, fsx.readFileSync(pathx.join(ROOT, 'assets', f)));
  model = mujoco.MjModel.mj_loadXML('/working/scene.xml');
  data = new mujoco.MjData(model);
  const OBJ = mujoco.mjtObj;
  siteId = mujoco.mj_name2id(model, OBJ.mjOBJ_SITE.value, 'grasp');
  handBody = mujoco.mj_name2id(model, OBJ.mjOBJ_BODY.value, 'hand');
  relicBody = mujoco.mj_name2id(model, OBJ.mjOBJ_BODY.value, 'relic');
  armJoints = []; armDofs = []; armRanges = []; fingerQpos = [];
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
}

const DT = () => model.opt.timestep;
function stepSim() {
  if (fly) stepFly();
  const maxSpeed = precision ? 0.14 : 0.40, frameDt = DT();
  for (let k = 0; k < 3; k++) {
    const want = clamp((desiredPos[k] - targetPos[k]) * 9, -maxSpeed, maxSpeed);
    targetVel[k] += clamp(want - targetVel[k], -1.8 * frameDt, 1.8 * frameDt);
    targetPos[k] += targetVel[k] * frameDt;
  }
  ikStep(DT());
  mujoco.mj_step(model, data);
  simTime += DT();
  gameStep(DT());
}
function runFor(sec) { const t0 = simTime; while (simTime - t0 < sec && phase !== 'done') stepSim(); }
function runUntil(cond, maxSec) { const t0 = simTime; while (!cond() && simTime - t0 < maxSec && phase !== 'done') stepSim(); }

async function playLevel(mujocoMod, idx) {
  levelIdx = idx; L = LEVELS[idx]; runMode = 'certified';
  RELIC_START = L.propStart; VAULT = L.goal;
  progress = { stars: {}, points: 0 };
  await bootPhysics(mujocoMod, L.scene);
  startPlay();
  runFor(0.6);
  const P = L.propStart, G = L.goal;
  const off = L.graspOffset || [0, 0, 0], hang = L.hangOffset || 0;
  const GP = [P[0] + off[0], P[1] + off[1], P[2] + off[2]];
  // --- grasp, with a test lift and wrist-yaw retries (what a player does) ---
  startFly([[GP[0], GP[1], 0.45], [GP[0], GP[1], GP[2]]], null, 'harness: to prop');
  runUntil(() => !fly, 25);
  desiredPos[0] = GP[0]; desiredPos[1] = GP[1]; desiredPos[2] = GP[2];
  runFor(1.5); // settle onto the prop before closing — fly arrival stops up to 4 cm short
  gripGoal = 0;
  runUntil(() => held, 8);
  runFor(0.8);
  let lifted = false, attempts = 0;
  for (let a = 0; a < 4 && !lifted; a++) {
    attempts = a + 1;
    if (process.env.OG_VERBOSE) console.log('  attempt ' + attempts + ': finger=' + fingerOpen().toFixed(4) + ' held=' + held + ' relic=' + relicPos().map(v => v.toFixed(3)).join(',') + ' ee=' + _ee.map(v => v.toFixed(3)).join(','));
    const zBefore = relicPos()[2];
    desiredPos[0] = GP[0]; desiredPos[1] = GP[1]; desiredPos[2] = GP[2] + 0.12;
    runFor(2.0);
    if (process.env.OG_VERBOSE) console.log('    after lift: relic=' + relicPos().map(v => v.toFixed(3)).join(',') + ' tilt=' + (propTilt() * 57.2958).toFixed(0));
    if (relicPos()[2] > zBefore + 0.05) { lifted = true; break; }
    desiredPos[0] = GP[0]; desiredPos[1] = GP[1]; desiredPos[2] = GP[2];
    runFor(1.2); gripGoal = 255; runFor(0.6);
    const h = (30 * Math.PI / 180) / 2;
    targetQuat = quatMul([Math.cos(h), 0, 0, Math.sin(h)], targetQuat);
    runFor(1.0); gripGoal = 0; runFor(1.2);
  }
  const graspInfo = { held, lifted, attempts, finger: +fingerOpen().toFixed(4), integrity: Math.round(integrity) };
  if (!lifted) return { idx, pass: false, stage: 'lift', ...graspInfo, relic: relicPos().map(v => +v.toFixed(3)) };
  // --- carry in precision mode, like a careful player ---
  precision = true;
  let carryZ = Math.max(0.42, G.z + hang + 0.12);
  if (L.guardian) carryZ = Math.min(carryZ, 0.36); // prop + hand stay under the beam
  const arrive = (maxSec) => runUntil(() => Math.hypot(targetPos[0] - desiredPos[0], targetPos[1] - desiredPos[1], targetPos[2] - desiredPos[2]) < 0.03, maxSec);
  desiredPos[0] = GP[0]; desiredPos[1] = GP[1]; desiredPos[2] = carryZ; arrive(25);
  if (L.guardian) {
    // NO staging hover: a friction grip creeps under a static hold, so cross
    // in one continuous motion (the guardian may brush the arm — survivable).
    desiredPos[0] = G.x; desiredPos[1] = G.y; desiredPos[2] = Math.max(carryZ, G.z + hang + 0.10); arrive(35);
  } else {
    desiredPos[0] = G.x; desiredPos[1] = G.y; desiredPos[2] = Math.max(carryZ, G.z + hang + 0.10); arrive(30);
  }
  desiredPos[0] = G.x; desiredPos[1] = G.y; desiredPos[2] = G.z + hang + 0.10; arrive(25);
  runFor(1.2); // hover: let the swing die before the final descent
  desiredPos[0] = G.x; desiredPos[1] = G.y; desiredPos[2] = G.z + hang; arrive(25);
  runFor(1.2);
  const preDrop = { relic: relicPos().map(v => +v.toFixed(3)), tiltDeg: +(propTilt() * 57.2958).toFixed(1), integrity: Math.round(integrity) };
  // --- release + retreat ---
  gripGoal = 255;
  runFor(0.6);
  precision = false;
  desiredPos[0] = G.x; desiredPos[1] = G.y; desiredPos[2] = G.z + hang + 0.30;
  runUntil(() => phase === 'done', 25);
  const done = events.some(e => e.type === 'expedition_complete');
  return { idx, pass: done && phase === 'done', stage: 'complete', ...graspInfo, preDrop,
           final: { phase, failed, integrity: Math.round(integrity), tiltDeg: +(propTilt() * 57.2958).toFixed(1),
                    relic: relicPos().map(v => +v.toFixed(3)), goal: [G.x, G.y, G.z], stars: progress.stars[idx] ?? null, points: progress.points } };
}
`;

// ---------- assemble + run ----------
const load_mujoco = (await import(path.join(root, 'vendor', 'mujoco', 'mujoco.js'))).default;
const mujocoMod = await load_mujoco({ locateFile: (p, prefix) => p.endsWith('.wasm') ? path.join(root, 'vendor', 'mujoco', 'mujoco.wasm') : prefix + p });

const factory = new Function('$', 'document', 'localStorage', 'ROOT',
  consts + '\n' + prelude + '\n' + code + '\n' + driver + '\nreturn { playLevel, LEVELS };');
const { playLevel, LEVELS } = factory($, documentStub, localStorageStub, root);

if (process.env.OG_TRACE3) {
  const factory5 = new Function('$', 'document', 'localStorage', 'ROOT',
    consts + '\n' + prelude + '\n' + code + '\n' + driver + '\nreturn { bootPhysics, LEVELS, ctx: { setLevel(i) { levelIdx = i; L = LEVELS[i]; RELIC_START = L.propStart; VAULT = L.goal; }, startPlay, relicPos, relicVel, fingerOpen, setGrip: (v) => { gripGoal = v; }, setPrecision: (v) => { precision = v; }, setDesired: (a) => { desiredPos[0] = a[0]; desiredPos[1] = a[1]; desiredPos[2] = a[2]; }, get held() { return held; }, relicQuat: () => [data.xquat[relicBody * 4], data.xquat[relicBody * 4 + 1], data.xquat[relicBody * 4 + 2], data.xquat[relicBody * 4 + 3]], get guardianCtrl() { return guardianCtrl; }, get ee() { return [..._ee]; }, get simTime() { return simTime; }, runFor, runUntil, startFly, get fly() { return fly; } } };');
  const { bootPhysics: bp, ctx: api } = factory5($, documentStub, localStorageStub, root);
  const LV = LEVELS[2];
  api.setLevel(2);
  await bp(mujocoMod, LV.scene);
  api.startPlay();
  api.runFor(0.6);
  const P = LV.propStart, G = LV.goal;
  const off = LV.graspOffset || [0, 0, 0];
  const GP = [P[0] + off[0], P[1] + off[1], P[2] + off[2]];
  api.startFly([[GP[0], GP[1], 0.45], [GP[0], GP[1], GP[2]]], null, 'trace');
  api.runUntil(() => !api.fly, 25);
  api.setDesired([GP[0], GP[1], GP[2]]); api.runFor(1.5);
  api.setGrip(0); api.runUntil(() => api.held, 8); api.runFor(0.8);
  console.log('grasped: held=' + api.held + ' vial=' + api.relicPos().map(v => v.toFixed(3)).join(','));
  const tiltDeg = () => { const q = api.relicQuat(); const upZ = 1 - 2 * (q[1] * q[1] + q[2] * q[2]); return (Math.acos(Math.max(-1, Math.min(1, upZ))) * 57.2958).toFixed(0); };
  api.setDesired([GP[0], GP[1], GP[2] + 0.12]);
  for (let k = 0; k < 6; k++) { api.runFor(0.4); console.log('lift t=' + api.simTime.toFixed(1) + ' tilt=' + tiltDeg() + ' vial=' + api.relicPos().map(v => v.toFixed(2)).join(',')); }
  api.setPrecision(true);
  const tiltDeg2 = () => { const q = api.relicQuat(); const upZ = 1 - 2 * (q[1] * q[1] + q[2] * q[2]); return (Math.acos(Math.max(-1, Math.min(1, upZ))) * 57.2958).toFixed(0); };
  const carryZ = 0.36;
  api.setDesired([GP[0], GP[1], carryZ]);
  for (let k = 0; k < 8; k++) { api.runFor(0.5); console.log('rise t=' + api.simTime.toFixed(1) + ' tilt=' + tiltDeg2() + ' vial=' + api.relicPos().map(v => v.toFixed(2)).join(',') + ' held=' + api.held); }
  api.setDesired([0.08, -0.02, carryZ]);
  for (let k = 0; k < 14; k++) { api.runFor(0.4); console.log('stage t=' + api.simTime.toFixed(1) + ' tilt=' + tiltDeg2() + ' vial=' + api.relicPos().map(v => v.toFixed(2)).join(',') + ' gCtrl=' + api.guardianCtrl.toFixed(2) + ' held=' + api.held); }
  api.runUntil(() => api.guardianCtrl < -0.20, 14);
  console.log('crossing now, gCtrl=' + api.guardianCtrl.toFixed(2));
  api.setDesired([G.x, G.y, carryZ]);
  for (let k = 0; k < 20; k++) { api.runFor(0.4); const v = api.relicPos(); console.log('cross t=' + api.simTime.toFixed(1) + ' tilt=' + tiltDeg2() + ' vial=' + v.map(x => x.toFixed(2)).join(',') + ' vel=' + api.relicVel().map(x => x.toFixed(2)).join(',') + ' gCtrl=' + api.guardianCtrl.toFixed(2) + ' held=' + api.held + ' ee=' + api.ee.map(x => x.toFixed(2)).join(',')); if (v[2] < 0.2) break; }
  process.exit(0);
}

const wanted = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
const idxs = wanted.length ? wanted : LEVELS.map((_, i) => i);
let allPass = true;
for (const i of idxs) {
  try {
    const r = await playLevel(mujocoMod, i);
    console.log(`LEVEL ${i + 1} ${LEVELS[i].task}: ${r.pass ? 'PASS' : 'FAIL'}`, JSON.stringify(r));
    if (!r.pass) allPass = false;
  } catch (e) {
    console.log(`LEVEL ${i + 1} ${LEVELS[i].task}: ERROR`, e.message);
    allPass = false;
  }
}
console.log(allPass ? 'ALL LEVELS PASS' : 'SOME LEVELS FAILED');
process.exit(allPass ? 0 : 1);
