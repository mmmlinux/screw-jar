import RStd from "@dimforge/rapier3d-compat";
import RSimd from "@dimforge/rapier3d-simd-compat";
// The SIMD build is about 2.5x faster on big piles; older browsers without Wasm SIMD get the plain build.
const HAS_SIMD = (() => {
  try { return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])); }
  catch { return false; }
})();
let R = HAS_SIMD ? RSimd : RStd;
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ScrewSim, DEFAULTS, autoFill, autoFillPartial, meshShape, mixShape, setMixWeights, planSection, roughCount, binVolume } from "./sim.js";
import { prepareBinMesh } from "./bin-mesh.js";
import { PARTS, PART_BY_ID, BINS, BIN_NOTE, partDefaults, builtinShape } from "./parts.js";
import { partGeometry, setDrawThreads } from "./render-parts.js";
import { SIZES, SIZE_NOTE, DEFAULT_SIZES, findSize, nearestLength, JAR_TYPES, JAR_DEFAULT, jarPool } from "./sizes.js";

const $ = (id) => document.getElementById(id);
const MAX_BODIES = 3500;

let sim, scene, camera, renderer, controls, boxGroup;
let meshSets = [];         // one { body, recess, finish } per part variant (several for the screw jar)
let params = structuredClone(DEFAULTS);
let shape = null;          // current part shape (built-in or STL)
let stl = null;            // { geom, vertices, indices, name, tris, scale }
let binStl = null;         // bin STL as loaded: { vertices, indices, name, tris }
let binMesh = null;        // binStl prepared for the physics (see bin-mesh.js), for the current units and up axis
let section = { ratio: 1, container: params.container };  // what is actually being simulated
let auto = null;           // running auto-fill generator
let trials = [];            // counts, or fill heights in mm for partial fills
let trialsKind = "count";   // "count" or "level"
let quietFor = 0;          // seconds with nothing moving (lets the sim idle to save battery)

params.sizes = structuredClone(DEFAULT_SIZES);   // chosen standard size per fastener type (editor)
params.jar = structuredClone(JAR_DEFAULT);        // screw jar settings (sizes in mm)
params.list = [];                                 // parts to pour: { part, dims, label, finish, weight }
let applied = [];     // the list the current simulation was built from
let listDirty = false; // the list has been edited since the last Apply

const NOUN1 = { pan: "pan head", flat: "flat head", socket: "socket head", hex: "hex bolt", nut: "hex nut" };
const PLURAL = { pan: "screws", flat: "screws", socket: "screws", hex: "bolts", nut: "nuts", cube: "pieces", cylinder: "pieces", sphere: "pieces", stl: "parts" };
const SCREWS = ["pan", "flat", "socket"];
// Word for what's being poured, based on the list in use: "screws", "nuts", "fasteners", "parts"...
const partWord = () => {
  const types = [...new Set(applied.map((e) => e.part))];
  if (types.length === 1) return PLURAL[types[0]] || "parts";
  if (types.length && types.every((t) => SCREWS.includes(t))) return "screws";
  if (types.length && types.every((t) => NOUN1[t])) return "fasteners";
  return "parts";
};
function partName() {
  return applied.length === 1 ? applied[0].label : `${applied.length} kinds of ${partWord()}`;
}

// Dimensions for a part in the editor: from the chosen standard size, or the custom values typed in.
function dimsFor(id) {
  const sel = params.sizes[id], e = sel && sel.size !== "custom" && findSize(id, sel.size);
  if (e) return { ...partDefaults(id), ...e.dims, ...(e.lengths ? { len: sel.len ?? e.lengths[0][0] } : {}) };
  return { ...partDefaults(id), ...(params.dims[id] || {}) };
}
// Name for a part being added from the editor, e.g. "M3 × 5 mm pan head" or "Sphere Ø8 mm".
function editorLabel(id, d) {
  const u = radio("partUnits"), unit = u === "in" ? " in" : " mm";
  const L = (mm) => (u === "in" ? String(+(mm / 25.4).toFixed(3)) : fmt(mm));
  const sel = params.sizes[id], e = sel && sel.size !== "custom" && findSize(id, sel.size);
  if (e) {
    const lenLabel = e.lengths ? (e.lengths.find(([v]) => Math.abs(v - sel.len) < 1e-6) || [0, ""])[1] : "";
    return `${e.label}${lenLabel ? " × " + lenLabel : ""} ${NOUN1[id]}`;
  }
  switch (id) {
    case "nut": return `Custom hex nut, ${L(d.flats)}${unit} across flats`;
    case "cube": return `Box ${L(d.x)} × ${L(d.y)} × ${L(d.z)}${unit}`;
    case "cylinder": return `Cylinder Ø${L(d.dia)} × ${L(d.len)}${unit}`;
    case "sphere": return `Sphere Ø${L(d.dia)}${unit}`;
    default: return `Custom ${NOUN1[id]}, Ø${L(d.shankD)} × ${L(d.len)}${unit}`;
  }
}
// Finish for parts added by hand: black oxide for socket heads, zinc/stainless tones for the rest.
function finishFor(id) {
  if (id === "socket") return 0x3a3d42;
  if (id === "stl") return 0xffffff;
  const tones = [0xeef1f4, 0xcfd3d7, 0xd8e0ea, 0xbfc4c9];
  return tones[params.list.length % tones.length];
}

// ---------- theme ----------
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function applyThemeToScene() {
  if (!scene) return;
  scene.background = new THREE.Color(cssVar("--scene"));
  buildContainerMesh();
}

// ---------- part meshes ----------
function buildPartMeshes() {
  for (const s of meshSets) {
    scene.remove(s.body, s.recess);
    s.body.geometry.dispose(); s.recess.geometry.dispose();
  }
  meshSets = [];
  const parts = [];   // { body, recess, finish } geometries, one per list entry
  for (const v of shape.variants) {
    if (v.render.part === "stl") {
      const k = stl.scale, body = stl.geom.clone();
      body.scale(k, k, k);
      body.translate(-v.offset[0], -v.offset[1], -v.offset[2]);
      parts.push({ body, recess: new THREE.BufferGeometry(), finish: v.render.finish });
    } else {
      parts.push({ ...partGeometry(v.render.part, v.render.dims), finish: v.render.finish });
    }
  }
  const steel = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.9, roughness: 0.32 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202428, metalness: 0.5, roughness: 0.6 });
  for (const p of parts) {
    const body = new THREE.InstancedMesh(p.body, steel, MAX_BODIES);
    body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    body.setColorAt(0, new THREE.Color(1, 1, 1));
    body.count = 0;
    const recess = new THREE.InstancedMesh(p.recess, dark, MAX_BODIES);
    recess.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    recess.count = 0;
    scene.add(body, recess);
    meshSets.push({ body, recess, finish: new THREE.Color(p.finish) });
  }
}

// ---------- container mesh ----------
function buildContainerMesh() {
  if (boxGroup) scene.remove(boxGroup);
  boxGroup = new THREE.Group();
  const c = section.container, t = c.wall;
  const wallMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cssVar("--bin")), transparent: true, opacity: 0.22,
    roughness: 0.2, metalness: 0, depthWrite: false, side: THREE.DoubleSide,
  });
  const floorMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cssVar("--bin")), roughness: 0.6 });
  const edgeMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar("--bin-edge")) });
  const rimMat = new THREE.LineBasicMaterial({ color: new THREE.Color(cssVar("--accent")) });
  const add = (w, h, d, x, y, z, mat) => {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.renderOrder = 2;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat); e.position.copy(m.position);
    boxGroup.add(m, e);
  };
  const L = c.L, W = c.W, H = c.H;
  if (c.mesh) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(c.mesh.vertices, 3));
    g.setIndex(new THREE.BufferAttribute(c.mesh.indices, 1));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, wallMat); m.renderOrder = 2;
    boxGroup.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), edgeMat));
  } else {
  add(L + 2 * t, t, W + 2 * t, 0, -t / 2, 0, floorMat);
  add(t, H, W + 2 * t, -L / 2 - t / 2, H / 2, 0, wallMat);
  add(t, H, W + 2 * t, L / 2 + t / 2, H / 2, 0, wallMat);
  add(L, H, t, 0, H / 2, -W / 2 - t / 2, wallMat);
  add(L, H, t, 0, H / 2, W / 2 + t / 2, wallMat);
  // inner rim: the fill level that counts
  const rim = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-L / 2, H, -W / 2), new THREE.Vector3(L / 2, H, -W / 2),
    new THREE.Vector3(L / 2, H, W / 2), new THREE.Vector3(-L / 2, H, W / 2), new THREE.Vector3(-L / 2, H, -W / 2),
  ]);
  boxGroup.add(new THREE.Line(rim, rimMat));
  }
  // No fog: the scene stays crisp at any zoom. Instead, zooming out is capped, and the ground
  // plane is made far wider than the camera can ever see past, so its edge never shows.
  const span = Math.max(L, W, H, 40);
  const maxDist = 10 * span;
  const gm = new THREE.Mesh(new THREE.CircleGeometry(40 * span, 64), new THREE.MeshStandardMaterial({ color: new THREE.Color(cssVar("--ground")), roughness: 0.95 }));
  gm.rotation.x = -Math.PI / 2; gm.position.y = -t - 0.01;
  boxGroup.add(gm);
  let cell = Math.pow(10, Math.round(Math.log10(Math.max(L, W) / 4)));
  while ((2.5 * maxDist) / cell > 120) cell *= 2;   // keep the line count sensible
  const gridSize = Math.ceil((2.5 * maxDist) / cell) * cell;
  const grid = new THREE.GridHelper(gridSize, Math.round(gridSize / cell), new THREE.Color(cssVar("--grid")), new THREE.Color(cssVar("--grid")));
  grid.position.y = -t; boxGroup.add(grid);
  scene.add(boxGroup);
  scene.fog = null;
  if (controls) controls.maxDistance = maxDist;
  if (camera) { camera.far = 100 * span; camera.near = Math.max(0.1, span / 400); camera.updateProjectionMatrix(); }
}

// ---------- scene ----------
function initScene() {
  const view = $("view");
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  view.prepend(renderer.domElement);
  scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(40, 90, 60); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.5));
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  applyThemeToScene();
  buildPartMeshes();
  new ResizeObserver(resize).observe(view);
  resize();
  frameCamera();
}
function frameCamera() {
  const c = section.container;
  const rs = 0.5 * Math.hypot(c.L + 2 * c.wall, c.W + 2 * c.wall, c.H + 12) * 1.08;
  const v = (camera.fov * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
  const d = rs / Math.sin(Math.min(v, h) / 2);
  const dir = new THREE.Vector3(1.1, 1.25, 1.9).normalize();
  const target = new THREE.Vector3(0, c.H * 0.4, 0);
  camera.position.copy(target).addScaledVector(dir, d);
  camera.lookAt(target);
  controls.target.copy(target);
  controls.update();
}
let lastAspect = 0;
function resize() {
  const v = $("view"), w = v.clientWidth, h = v.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  // refit when the view shape changes a lot (first layout, phone rotation)
  if (Math.abs(camera.aspect - lastAspect) > 0.15) { lastAspect = camera.aspect; frameCamera(); }
}

// ---------- sync physics -> render ----------
const m4 = new THREE.Matrix4(), qv = new THREE.Quaternion(), pv = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
const colIn = new THREE.Color(1, 1, 1), colOut = new THREE.Color();
let lastStats = { inside: 0, above: 0, insideVol: 0, byVariant: [] };
function syncMeshes() {
  colOut.set(cssVar("--accent"));
  const cls = sim.classify();
  const box = sim.box.translation();
  let inside = 0, insideVol = 0;
  const counts = meshSets.map(() => 0), byVariant = meshSets.map(() => 0);
  for (const r of cls) {
    const v = r.sc.v || 0, set = meshSets[v];
    if (!set) continue;
    if (r.inside) { inside++; insideVol += sim.shapeOf(r.sc).volume; byVariant[v]++; }
    const i = counts[v];
    if (i >= MAX_BODIES) continue;
    const b = r.sc.body, t = b.translation(), q = b.rotation();
    pv.set(t.x, t.y, t.z); qv.set(q.x, q.y, q.z, q.w);
    m4.compose(pv, qv, one);
    set.body.setMatrixAt(i, m4); set.recess.setMatrixAt(i, m4);
    set.body.setColorAt(i, r.inside ? set.finish : colOut);
    counts[v] = i + 1;
  }
  meshSets.forEach((s, k) => {
    s.body.count = s.recess.count = counts[k];
    s.body.instanceMatrix.needsUpdate = s.recess.instanceMatrix.needsUpdate = true;
    if (s.body.instanceColor) s.body.instanceColor.needsUpdate = true;
  });
  boxGroup.position.set(box.x, box.y, box.z);
  lastStats = { inside, above: cls.length - inside, insideVol, byVariant };
}

const scaled = () => section.ratio > 1.001;
const partial = () => !!section.partial;
// Freezing settled parts makes counts a few percent low when filling to the rim (a frozen pile
// can't compact under new parts), so it's only used when the bin is too big to fill.
const freezeOn = () => params.freeze !== false && partial();

// ---------- units ----------
// Everything inside is millimetres; inches only change what the settings fields show.
const UNIT = { mm: 1, in: 25.4 };
const radio = (name) => document.querySelector(`input[name="${name}"]:checked`).value;
const setRadio = (name, v) => { const el = document.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
const toUnit = (mm, u) => (u === "in" ? +(mm / 25.4).toFixed(3) : Math.round(mm * 100) / 100);
const lenText = (mm, u = radio("binUnits")) => (u === "in" ? `${(mm / 25.4).toFixed(2)} in` : `${fmt(mm)} mm`);
const boxText = (c, u = radio("binUnits")) => (u === "in"
  ? `${(c.L / 25.4).toFixed(2)} × ${(c.W / 25.4).toFixed(2)} × ${(c.H / 25.4).toFixed(2)} in`
  : `${fmt(c.L)} × ${fmt(c.W)} × ${fmt(c.H)} mm`);

// What to simulate for these settings: the whole bin, a scaled section, or the whole bin part-filled.
function planFor(p, s) {
  if (p.bin === "stl" && binMesh) {
    // STL bins are always simulated whole (a section of an arbitrary shape isn't meaningful).
    const c = { ...p.container, mesh: binMesh };
    return { container: c, ratio: 1, partial: roughCount(c, s) > p.maxSim };
  }
  if (p.bigBin === "partial") {
    return { container: { ...p.container }, ratio: 1, partial: roughCount(p.container, s) > p.maxSim };
  }
  return planSection(p.container, s, p.maxSim);
}
const fullBinCount = (n) => Math.round(n * section.ratio);

function updateReadout() {
  $("count").textContent = scaled() ? `≈${fullBinCount(lastStats.inside).toLocaleString()}` : lastStats.inside.toLocaleString();
  $("siminside").textContent = lastStats.inside.toLocaleString();
  $("above").textContent = lastStats.above;
  $("spilled").textContent = sim.spilled + sim.struck;
  $("poured").textContent = sim.poured;
  const c = section.container;
  const pct = lastStats.insideVol / binVolume(c);
  $("packing").textContent = shape.volume > 0 ? `${Math.round(pct * 100)}%` : "–";
  // Per-entry counts in the parts list (only meaningful while the list matches what's poured).
  params.list.forEach((e, i) => {
    const el = document.getElementById(`inbin-${i}`);
    if (el) { const t = listDirty ? "–" : String(lastStats.byVariant[i] || 0); if (el.textContent !== t) el.textContent = t; }
  });
}

function updateCaption(level) {
  if (partial()) {
    $("cap").textContent = level
      ? `${partWord()} fill the bin to about ${lenText(level)} of ${lenText(params.container.rim ?? params.container.H)}`
      : `${partWord()} in the full-size bin, pouring at most ${params.maxSim}`;
  } else {
    $("cap").textContent = scaled()
      ? `${partWord()} estimated for the full bin, scaled up from the section shown`
      : `${partWord()} fit below the rim`;
  }
}
const fmt = (x) => (Math.round(x * 10) / 10).toString();

// ---------- loop ----------
let autoPending = 0;
const STEPS_PER_YIELD = () => Math.max(1, Math.round(0.02 / sim.dt));
// ---------- debug stats ----------
// Timings are smoothed averages; the panel refreshes four times a second to stay cheap.
const dbg = { on: false, last: 0, prevFrame: 0, frameMs: 16, physMs: 0, syncMs: 0, renderMs: 0, stepsPerFrame: 0, simRate: 0 };
const ema = (a, b, k = 0.1) => a + (b - a) * k;
function updateDebug(now) {
  if (!dbg.on || now - dbg.last < 250) return;
  dbg.last = now;
  const info = renderer.info, mem = performance.memory;
  let colliders = 0;
  try { colliders = sim.world.colliders.len(); } catch { /* not available */ }
  const tris = info.render.triangles, fmtN = (n) => Math.round(n).toLocaleString();
  const kinds = shape.kind === "mix" ? shape.variants.length : 1;
  let meshTris = 0;
  for (const s of meshSets) {
    const g = s.body.geometry;
    meshTris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  const rows = [
    ["Frame rate", `${(1000 / dbg.frameMs).toFixed(0)} fps (${dbg.frameMs.toFixed(1)} ms)`],
    ["Physics per frame", `${dbg.physMs.toFixed(1)} ms, ${dbg.stepsPerFrame.toFixed(0)} steps`],
    ["Sim speed", `${dbg.simRate.toFixed(2)}× real time`],
    ["Count + sync", `${dbg.syncMs.toFixed(1)} ms`],
    ["Render", `${dbg.renderMs.toFixed(1)} ms`],
    ["Triangles drawn", fmtN(tris)],
    ["Draw calls", fmtN(info.render.calls)],
    ["Part mesh", `${fmtN(meshTris / kinds)} triangles${kinds > 1 ? ` avg, ${kinds} kinds` : ""}`],
    ["Bodies / colliders", `${fmtN(sim.screws.length)} / ${fmtN(colliders)}`],
    ["Frozen (settled)", sim.p.freeze ? `${fmtN(sim.frozen || 0)} of ${fmtN(sim.screws.length)}` : (partial() ? "off" : "off while filling to the rim")],
    ["Physics build", HAS_SIMD ? "Rapier SIMD" : "Rapier (no SIMD)"],
    ["Pieces per part", String(shape.pieces)],
    ["GPU geometries / textures", `${info.memory.geometries} / ${info.memory.textures}`],
    ["Shader programs", String((info.programs || []).length)],
    ["JS heap", mem ? `${(mem.usedJSHeapSize / 1048576).toFixed(0)} of ${(mem.jsHeapSizeLimit / 1048576).toFixed(0)} MB` : "not reported by this browser"],
    ["Sim time", `${sim.time.toFixed(2)} s at ${(sim.dt * 1000).toFixed(1)} ms steps`],
    ["Canvas", `${renderer.domElement.width} × ${renderer.domElement.height} px (×${renderer.getPixelRatio()})`],
  ];
  $("debug").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
}

function frame() {
  requestAnimationFrame(frame);
  const start = performance.now();
  if (dbg.prevFrame) dbg.frameMs = ema(dbg.frameMs, start - dbg.prevFrame);
  dbg.prevFrame = start;
  const simBefore = sim.time;
  let stepsThisFrame = 0;
  const budget = 12; // ms of physics per frame
  const busy = auto || sim.pouring || sim.time < sim.shakeUntil;
  if (busy || quietFor < 2) {
    const maxSteps = auto ? 400 : Math.ceil((1 / 60) / sim.dt); // manual actions run in real time
    let steps = 0;
    // One physics step at a time, so a big pile never blocks a frame for long; auto fill's
    // pending steps carry over to the next frame.
    while (performance.now() - start < budget && steps < maxSteps) {
      if (auto && autoPending === 0) {
        const r = auto.next();
        if (r.done) { finishAuto(); break; }
        setStatus(r.value);
        autoPending = STEPS_PER_YIELD();
      }
      sim.step(); steps++;
      if (auto) autoPending--;
    }
    stepsThisFrame = steps;
    const moving = sim.maxSpeed() > 2;
    quietFor = busy || moving ? 0 : quietFor + 1 / 60;
    if (!auto && !busy && quietFor > 0 && $("status").dataset.kind === "run") setStatus("Settled", "idle");
  }
  const t1 = performance.now();
  syncMeshes();
  updateReadout();
  const t2 = performance.now();
  controls.update();
  renderer.render(scene, camera);
  const t3 = performance.now();
  if (dbg.on) {
    dbg.physMs = ema(dbg.physMs, t1 - start);
    dbg.syncMs = ema(dbg.syncMs, t2 - t1);
    dbg.renderMs = ema(dbg.renderMs, t3 - t2);
    dbg.stepsPerFrame = ema(dbg.stepsPerFrame, stepsThisFrame);
    dbg.simRate = ema(dbg.simRate, (sim.time - simBefore) / Math.max(1e-3, dbg.frameMs / 1000));
    updateDebug(t3);
  }
}

// ---------- UI ----------
function setStatus(text, kind = "run") {
  const el = $("status");
  if (el.textContent !== text) el.textContent = text;
  el.dataset.kind = kind;
}
function wake() { quietFor = 0; }

function setManualEnabled(on) {
  for (const id of ["pour", "shake", "strike", "reset", "apply", "apply2", "stlfile", "binfile"]) $(id).disabled = !on;
}

function startAuto() {
  if (auto) { // stop
    auto = null; autoPending = 0; sim.pouring = false; sim.pourLimit = Infinity; sim.autoPour = false;
    $("auto").textContent = "Auto fill";
    setManualEnabled(true); setStatus("Stopped", "idle");
    return;
  }
  sim.reset();
  updateCaption();
  autoPending = 0;
  auto = partial() ? autoFillPartial(sim, params.maxSim) : autoFill(sim, 3);
  $("auto").textContent = "Stop";
  $("pour").textContent = "Pour";
  setManualEnabled(false);
  wake();
}
function finishAuto() {
  auto = null;
  $("auto").textContent = "Auto fill";
  setManualEnabled(true);
  syncMeshes();
  if (partial()) {
    const n = lastStats.inside, level = sim.fillLevel(), H = params.container.H, frac = level / H;
    trials.push(level); trialsKind = "level";
    renderTrials();
    updateCaption(level);
    const guess = frac > 0.15 ? ` At that density a full bin would take very roughly ${(Math.round(n / frac / 10) * 10).toLocaleString()}.` : "";
    setStatus(`Done: ${n.toLocaleString()} ${partWord()} fill the bin to about ${lenText(level)} of ${lenText(H)} (${Math.round(frac * 100)}%).${guess}`, "done");
    return;
  }
  const n = scaled() ? fullBinCount(lastStats.inside) : lastStats.inside;
  trials.push(n); trialsKind = "count";
  renderTrials();
  setStatus(scaled()
    ? `Done: about ${n.toLocaleString()} ${partWord()} fit (${lastStats.inside} in the simulated section, scaled by ${section.ratio.toFixed(2)})`
    : `Done: ${n} ${partWord()} fit`, "done");
}
function renderTrials() {
  const ol = $("trials");
  ol.innerHTML = "";
  const show = (v) => (trialsKind === "level" ? lenText(v) : v.toLocaleString());
  trials.forEach((n, i) => {
    const li = document.createElement("li");
    li.textContent = `Run ${i + 1}: ${show(n)}`;
    ol.appendChild(li);
  });
  const box = $("trial-summary");
  if (!trials.length) { box.textContent = "Run auto fill a few times; packing is random, so results vary."; return; }
  if (trialsKind === "level") {
    const avg = trials.reduce((a, b) => a + b, 0) / trials.length;
    box.textContent = trials.length === 1
      ? `Fill height for ${params.maxSim} ${partWord()}: ${lenText(trials[0])}. Run it again to see the spread.`
      : `Average fill height for ${params.maxSim} ${partWord()}: ${lenText(avg)} over ${trials.length} runs, range ${lenText(Math.min(...trials))} to ${lenText(Math.max(...trials))}. Heights are rough because the top of a pile is bumpy.`;
    return;
  }
  const avg = trials.reduce((a, b) => a + b, 0) / trials.length;
  let text = trials.length === 1
    ? `One run so far: ${trials[0].toLocaleString()}. Run it again to see the spread.`
    : `Average ${avg.toFixed(1)} over ${trials.length} runs, range ${Math.min(...trials).toLocaleString()} to ${Math.max(...trials).toLocaleString()}.`;
  if (scaled()) text += " These are scaled up by volume from a smaller section, so treat them as good to within about 10%. For an exact count, raise the max or choose the full-bin option.";
  box.textContent = text;
}

// ---------- settings form ----------
function buildPartSelect() {
  const sel = $("part");
  sel.innerHTML = "";
  const groups = {};
  for (const p of PARTS) {
    if (!groups[p.group]) { groups[p.group] = document.createElement("optgroup"); groups[p.group].label = p.group; sel.appendChild(groups[p.group]); }
    groups[p.group].appendChild(new Option(p.label, p.id));
  }
  const g = document.createElement("optgroup"); g.label = "Your file";
  g.appendChild(new Option("STL file", "stl"));
  sel.appendChild(g);
}
function buildBinSelect() {
  const sel = $("bin");
  sel.innerHTML = "";
  for (const b of BINS) sel.appendChild(new Option(b.label, b.id));
}

// Show the dimension fields for the selected part. Values the user typed are kept per part.
function renderPartFields() {
  const id = $("part").value, box = $("part-fields");
  box.innerHTML = "";
  $("stl-opts").hidden = id !== "stl";
  $("part-note").textContent = id === "stl" ? "" : (SIZE_NOTE[id] || PART_BY_ID[id].note);
  renderSizePickers(id);
  if (id === "stl") return;
  const d = dimsFor(id), u = radio("partUnits");
  box.dataset.units = u;
  for (const [k, label] of PART_BY_ID[id].fields) {
    const l = document.createElement("label");
    l.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number"; inp.step = u === "in" ? "0.005" : "0.1"; inp.min = u === "in" ? "0.01" : "0.3";
    inp.dataset.key = k; inp.value = toUnit(d[k], u);
    inp.dataset.mm = d[k]; inp.dataset.shown = inp.value;   // exact value, used if left unedited
    // Typing a dimension turns a standard size into a custom one.
    inp.addEventListener("input", () => {
      const sel = params.sizes[id];
      if (sel && sel.size !== "custom") {
        sel.size = "custom";
        $("psize").value = "custom";
        const len = $("plen"); if (len) len.closest("label").remove();
      }
    });
    l.appendChild(inp);
    box.appendChild(l);
  }
}
// Screw jar settings: which types and systems, the largest size, and how many different sizes.
function renderJarFields() {
  const box = $("jar-fields"), o = params.jar, u = radio("partUnits");
  box.dataset.units = u;
  box.innerHTML = "";
  const types = document.createElement("div");
  types.className = "span2 checks";
  types.setAttribute("role", "group"); types.setAttribute("aria-label", "Fastener types in the jar");
  for (const [t, label] of JAR_TYPES) {
    const l = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = t; cb.checked = o.types.includes(t); cb.dataset.jar = "type";
    l.append(cb, " " + label);
    types.appendChild(l);
  }
  box.appendChild(types);
  const sys = document.createElement("label");
  sys.className = "span2";
  sys.textContent = "Sizes";
  const s = document.createElement("select");
  s.dataset.jar = "systems";
  for (const [v, t] of [["both", "Metric and inch"], ["metric", "Metric only"], ["inch", "Inch only"]]) s.appendChild(new Option(t, v));
  s.value = o.systems;
  sys.appendChild(s);
  box.appendChild(sys);
  const num = (key, label, mm, isLen = true) => {
    const l = document.createElement("label");
    l.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number"; inp.dataset.jar = key;
    if (isLen) {
      inp.step = u === "in" ? "0.0625" : "0.5"; inp.min = "0";
      inp.value = toUnit(mm, u); inp.dataset.mm = mm; inp.dataset.shown = inp.value;
    } else { inp.step = "1"; inp.min = "1"; inp.max = "40"; inp.value = mm; }
    l.appendChild(inp);
    box.appendChild(l);
  };
  num("maxDia", "Largest thread Ø", o.maxDia);
  num("maxLen", "Longest length", o.maxLen);
  num("variety", "Different sizes", o.variety, false);
}
function readJarFields(u = $("jar-fields").dataset.units || "mm") {
  const box = $("jar-fields"), o = { ...params.jar };
  if (!box.querySelector("[data-jar]")) return o;
  o.types = [...box.querySelectorAll('[data-jar="type"]:checked')].map((c) => c.value);
  o.systems = box.querySelector('[data-jar="systems"]').value;
  for (const k of ["maxDia", "maxLen"]) {
    const el = box.querySelector(`[data-jar="${k}"]`);
    const v = el.value === el.dataset.shown ? +el.dataset.mm : parseFloat(el.value) * UNIT[u];
    if (Number.isFinite(v) && v > 0) o[k] = v;
  }
  const n = parseInt(box.querySelector('[data-jar="variety"]').value, 10);
  if (Number.isFinite(n)) o.variety = Math.min(40, Math.max(1, n));
  return o;
}

// Size and length dropdowns for fasteners with standard sizes.
function renderSizePickers(id) {
  const box = $("part-size");
  box.innerHTML = "";
  const list = SIZES[id];
  box.hidden = !list;
  if (!list) return;
  const sel = params.sizes[id] || (params.sizes[id] = { size: "custom" });
  // The mm / inches setting picks which sizes are listed: metric sizes for mm, inch sizes for inches.
  const system = radio("partUnits") === "in" ? "inch" : "metric";
  const shown = list.filter((x) => x.system === system);
  // If the chosen size is from the other system, swap to the closest one in this system
  // (nearest thread diameter, then nearest length), so switching units keeps a similar part.
  const cur = sel.size !== "custom" && findSize(id, sel.size);
  if (cur && cur.system !== system) {
    const dia = (x) => x.dims.shankD ?? x.dims.holeD;
    const best = shown.reduce((a, b) => (Math.abs(dia(b) - dia(cur)) < Math.abs(dia(a) - dia(cur)) ? b : a));
    sel.size = best.id;
    if (best.lengths) sel.len = nearestLength(best, sel.len ?? best.lengths[0][0]);
  }

  const l1 = document.createElement("label");
  l1.textContent = "Size";
  const s1 = document.createElement("select");
  s1.id = "psize";
  for (const e of shown) s1.appendChild(new Option(e.label, e.id));
  s1.appendChild(new Option("Custom size", "custom"));
  s1.value = sel.size;
  s1.onchange = () => {
    const e = findSize(id, s1.value);
    if (e) {
      sel.len = e.lengths ? nearestLength(e, sel.len ?? dimsFor(id).len ?? 10) : undefined;
    } else {
      params.dims[id] = readPartFields(id);   // custom starts from the size that was showing
    }
    sel.size = s1.value;
    renderPartFields();
  };
  l1.appendChild(s1);
  box.appendChild(l1);

  const e = findSize(id, sel.size);
  if (e && e.lengths) {
    const l2 = document.createElement("label");
    l2.textContent = id === "flat" ? "Overall length" : "Length";
    const s2 = document.createElement("select");
    s2.id = "plen";
    for (const [v, label] of e.lengths) s2.appendChild(new Option(label, String(v)));
    sel.len = nearestLength(e, sel.len ?? e.lengths[0][0]);
    s2.value = String(sel.len);
    s2.onchange = () => { sel.len = +s2.value; renderPartFields(); };
    l2.appendChild(s2);
    box.appendChild(l2);
  }
}

function readPartFields(id, u = $("part-fields").dataset.units || "mm") {
  const d = {};
  for (const inp of $("part-fields").querySelectorAll("input")) {
    const v = inp.value === inp.dataset.shown ? +inp.dataset.mm : parseFloat(inp.value) * UNIT[u];
    d[inp.dataset.key] = Number.isFinite(v) && v > 0 ? v : partDefaults(id)[inp.dataset.key];
  }
  return d;
}

function onBinChange() {
  const b = BINS.find((x) => x.id === $("bin").value);
  if (b && b.L) showContainer(b, radio("binUnits"));
  $("bin-note").textContent = b && b.L ? BIN_NOTE : "";
  showBinKind();
}
function showBinKind() {
  const isStl = $("bin").value === "stl";
  $("bin-dims").hidden = isStl;
  $("bin-stl").hidden = !isStl;
}

// Bin STL: prepare it for the current units and up axis, and describe what was found.
function prepareBin() {
  binMesh = null;
  const el = $("bininfo");
  if (!binStl) { el.textContent = ""; return false; }
  try {
    binMesh = prepareBinMesh(binStl.vertices, binStl.indices, { scale: parseFloat($("binunits").value) || 1, up: $("binup").value });
  } catch (e) {
    el.textContent = `${binStl.name}: ${e.message}.`;
    return false;
  }
  const u = radio("binUnits"), m = binMesh;
  const cap = u === "in" ? `${(m.volume / 16387.064).toFixed(1)} in³` : `${(m.volume / 1000).toFixed(1)} cm³`;
  el.textContent = `${binStl.name}: ${boxText(m, u)} outside, ${binStl.tris.toLocaleString()} triangles. Holds about ${cap} up to ${lenText(m.rim, u)} high.`;
  return true;
}

async function loadBinStl(file) {
  setStatus(`Reading ${file.name}…`, "run");
  try {
    const g = new STLLoader().parse(await file.arrayBuffer());
    if (!g.attributes.position || g.attributes.position.count < 4) throw new Error("the file has no triangles");
    const tris = g.attributes.position.count / 3;
    let ig = g.clone();
    ig.deleteAttribute("normal");
    ig = mergeVertices(ig, 1e-4);
    binStl = { vertices: new Float32Array(ig.attributes.position.array), indices: new Uint32Array(ig.index.array), name: file.name, tris };
  } catch (e) {
    setStatus(`Couldn't read ${file.name}: ${e.message}. Check that it's a binary or ASCII STL.`, "error");
    return;
  }
  $("bin").value = "stl"; showBinKind();
  if (prepareBin()) setStatus(`Loaded ${file.name}. Press Apply and empty to pour into it.`, "idle");
  else setStatus(`Loaded ${file.name}, but it can't be used as a bin yet. See the note under the file.`, "error");
}

function showContainer(c, u) {
  for (const [id, k] of [["cL", "L"], ["cW", "W"], ["cH", "H"]]) {
    $(id).value = toUnit(c[k], u);
    $(id).dataset.mm = c[k]; $(id).dataset.shown = $(id).value;
    $(id).step = u === "in" ? "0.125" : "0.5";
  }
  $("cL").dataset.units = u;
}
function readContainer(u = $("cL").dataset.units || "mm") {
  const len = (id, lo, hi, def) => {
    const el = $(id);
    const v = el.value === el.dataset.shown ? +el.dataset.mm : parseFloat(el.value) * UNIT[u];
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  };
  return { L: len("cL", 5, 600, 40), W: len("cW", 5, 600, 20), H: len("cH", 3, 400, 20) };
}

function readParams() {
  const num = (id, lo, hi, def) => {
    const v = parseFloat($(id).value);
    return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  };
  const p = structuredClone(params);
  p.bin = $("bin").value;
  if (p.bin === "stl" && binMesh) {
    const m = binMesh;
    p.container = { L: m.L, W: m.W, H: m.H, wall: 0, volume: m.volume, rim: m.rim };
  } else {
    p.container = { ...readContainer(), wall: 3 };
  }
  p.partUnits = radio("partUnits"); p.binUnits = radio("binUnits");
  p.bigBin = $("bigbin").value;
  p.part = $("part").value;
  p.jar = readJarFields();
  if (p.part !== "stl") p.dims[p.part] = readPartFields(p.part);
  p.friction = num("fr", 0, 1.2, 0.35);
  p.pourRate = num("rate", 1, 500, 25);
  p.autoRate = num("autorate", 1, 500, 60);
  p.pourMode = $("mode").value;
  p.maxSim = Math.round(num("maxsim", 100, 3000, 700));
  p.shakeTime = num("shaketime", 0, 10, 0.5);
  p.units = parseFloat($("units").value);
  p.collision = $("coll").value;
  p.maxPieces = Math.round(num("maxp", 1, 32, 8));
  return p;
}
function writeParams(p) {
  setRadio("partUnits", p.partUnits); setRadio("binUnits", p.binUnits);
  if (p.bin !== "stl") showContainer(p.container, p.binUnits);
  $("bigbin").value = p.bigBin;
  $("bin").value = p.bin || "custom";
  $("bin-note").textContent = p.bin && p.bin !== "custom" && p.bin !== "stl" ? BIN_NOTE : "";
  showBinKind();
  $("part").value = p.part;
  $("fr").value = p.friction; $("rate").value = p.pourRate; $("autorate").value = p.autoRate; $("mode").value = p.pourMode; $("maxsim").value = p.maxSim; $("shaketime").value = p.shakeTime;
  $("units").value = String(p.units); $("coll").value = p.collision; $("maxp").value = p.maxPieces;
  renderPartFields();
  renderJarFields();
  renderList();
}

// Build the collision shape for the parts list. Throws with a readable message on failure.
function buildShape(p) {
  if (!p.list.length) throw new Error("The parts list is empty. Add a part, or fill it from the screw jar.");
  let stlShape = null;
  const variants = p.list.map((e) => {
    if (e.part === "stl") {
      if (!stl) throw new Error("The STL file isn't loaded any more. Choose it again, or remove it from the list.");
      stlShape = stlShape || buildStlShape(p);
      return { ...stlShape, render: e };
    }
    return { ...builtinShape(R, e.part, e.dims), render: e };
  });
  return mixShape(variants, p.list.map((e) => e.weight));
}
function buildStlShape(p) {
  const k = p.units || 1;
  const v = new Float32Array(stl.vertices.length);
  for (let i = 0; i < v.length; i++) v[i] = stl.vertices[i] * k;
  stl.scale = k;
  return meshShape(R, v, stl.indices, { mode: p.collision, maxPieces: p.maxPieces });
}

// ---------- parts list ----------
function renderList() {
  const ul = $("plist");
  ul.innerHTML = "";
  if (!params.list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Empty. Add a part under Add parts and settings, or fill it from the screw jar.";
    ul.appendChild(li);
  } else {
    const head = document.createElement("li");
    head.className = "plist-head";
    head.innerHTML = "<span>Part</span><span>Share</span><span>In bin</span><span></span>";
    ul.appendChild(head);
  }
  params.list.forEach((e, i) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    const sw = document.createElement("span");
    sw.className = "swatch";
    sw.style.background = "#" + e.finish.toString(16).padStart(6, "0");
    const t = document.createElement("span");
    t.textContent = e.label; t.title = e.label;
    name.append(sw, t);
    const share = document.createElement("input");
    share.type = "number"; share.min = "0"; share.step = "1"; share.value = e.weight; share.className = "share";
    share.setAttribute("aria-label", `Share of ${e.label}`);
    // Shares apply straight away when the list itself hasn't changed: they only affect new parts.
    share.addEventListener("input", () => {
      const v = parseFloat(share.value);
      if (!Number.isFinite(v) || v < 0) return;
      e.weight = v;
      if (!listDirty && applied.length === params.list.length) {
        applied[i].weight = v;
        setMixWeights(shape, params.list.map((x) => x.weight));
      }
    });
    const inbin = document.createElement("span");
    inbin.className = "inbin"; inbin.id = `inbin-${i}`; inbin.textContent = "–";
    const rm = document.createElement("button");
    rm.className = "remove"; rm.textContent = "×"; rm.setAttribute("aria-label", `Remove ${e.label}`);
    rm.onclick = () => { params.list.splice(i, 1); markDirty(); renderList(); };
    li.append(name, share, inbin, rm);
    ul.appendChild(li);
  });
  updateListStatus();
}
function markDirty() { listDirty = true; updateListStatus(); }
function updateListStatus() {
  $("plist-status").textContent = listDirty ? "The list has changed. Press Apply and empty to pour it." : "";
}
function addFromEditor() {
  const id = $("part").value;
  let entry;
  if (id === "stl") {
    if (!stl) { setStatus("Choose an STL file first.", "error"); return; }
    entry = { part: "stl", label: stl.name, weight: 1, finish: finishFor("stl") };
  } else {
    const d = readPartFields(id);
    if (params.sizes[id]?.size === "custom" || !SIZES[id]) params.dims[id] = d;
    entry = { part: id, dims: d, label: editorLabel(id, d), weight: 1, finish: finishFor(id) };
  }
  const same = params.list.find((x) => x.label === entry.label);
  if (same) {
    same.weight += 1;
    setStatus(`${entry.label} is already in the list, so its share went up to ${same.weight}.`, "idle");
  } else {
    params.list.push(entry);
    setStatus(`Added ${entry.label}. Press Apply and empty to pour the new list.`, "idle");
  }
  markDirty();
  renderList();
}
function fillFromJar() {
  params.jar = readJarFields();
  const pool = jarPool(params.jar);
  if (!pool.length) { setStatus("No standard sizes match the screw jar settings. Tick more types or allow larger sizes.", "error"); return; }
  params.list = pool.map((c) => ({ part: c.part, dims: c.dims, label: c.label, finish: c.finish, weight: 1 }));
  markDirty();
  renderList();
  setStatus(`Filled the list with ${pool.length} random sizes. Press Apply and empty to pour them.`, "idle");
}

// Apply settings: rebuild the shape, choose the simulated section, and empty the bin.
async function applySetup() {
  if ($("bin").value === "stl" && !binMesh) {
    setStatus(binStl ? "This STL can't be used as a bin. See the note under the file." : "Choose an STL file for the bin first, or pick another preset.", "error");
    return;
  }
  const p = readParams();
  if (p.list.some((e) => e.part === "stl")) {
    setStatus("Building the collision shape…", "run");
    await new Promise((r) => setTimeout(r, 40)); // let the message paint before the heavy work
  }
  let s;
  try {
    s = buildShape(p);
  } catch (e) {
    setStatus(e.message.endsWith(".") ? e.message : `Couldn't use this STL: ${e.message}.`, "error");
    return;
  }
  params = p; shape = s;
  applied = structuredClone(params.list);
  listDirty = false;
  section = planFor(params, shape);
  writeParams(params);
  sim.reset({ ...params, container: section.container, freeze: freezeOn() }, shape);
  sim.pouring = false; $("pour").textContent = "Pour";
  trials = []; trialsKind = "count"; renderTrials();
  buildPartMeshes(); buildContainerMesh(); frameCamera();
  updateCaption();
  setStatus(partial()
    ? `This bin would hold more than ${params.maxSim} ${partWord()}, so auto fill pours ${params.maxSim} into the full-size bin and reports how high they reach.`
    : scaled()
      ? `This bin would hold more than ${params.maxSim} ${partWord()}, so auto fill simulates a ${boxText(section.container)} section and scales the count by ${section.ratio.toFixed(2)}.`
      : `Ready: ${partName()}. Container is empty.`, "idle");
  wake();
}

function describeStl() {
  const el = $("stlinfo");
  if (!stl) { el.textContent = ""; return; }
  const k = parseFloat($("units").value) || 1, v = stl.vertices;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let j = 0; j < 3; j++) { mn[j] = Math.min(mn[j], v[i + j]); mx[j] = Math.max(mx[j], v[i + j]); }
  const [x, y, z] = mx.map((m2, j) => ((m2 - mn[j]) * k).toFixed(1));
  const heavy = stl.tris > 60000 ? " This mesh is detailed, so drawing many copies may be slow on a phone." : "";
  el.textContent = `${stl.name}: ${x} × ${y} × ${z} mm, ${stl.tris.toLocaleString()} triangles. Press Add to list to pour it.${heavy}`;
}

async function loadStl(file) {
  setStatus(`Reading ${file.name}…`, "run");
  try {
    const buf = await file.arrayBuffer();
    const g = new STLLoader().parse(buf);
    if (!g.attributes.position || g.attributes.position.count < 4) throw new Error("the file has no triangles");
    g.computeVertexNormals();
    const tris = g.attributes.position.count / 3;
    let ig = g.clone();
    ig.deleteAttribute("normal");
    ig = mergeVertices(ig, 1e-4);
    stl = { geom: g, vertices: new Float32Array(ig.attributes.position.array), indices: new Uint32Array(ig.index.array), name: file.name, tris, scale: 1 };
  } catch (e) {
    setStatus(`Couldn't read ${file.name}: ${e.message}. Check that it's a binary or ASCII STL.`, "error");
    return;
  }
  $("part").value = "stl";
  renderPartFields();
  describeStl();
  setStatus(`Loaded ${file.name}. Press Add to list to include it in the pour.`, "idle");
}

function bindUI() {
  $("auto").onclick = startAuto;
  $("pour").onclick = () => {
    sim.pouring = !sim.pouring; sim.pourLimit = Infinity;
    $("pour").textContent = sim.pouring ? "Stop pouring" : "Pour";
    $("pour").setAttribute("aria-pressed", sim.pouring);
    setStatus(sim.pouring ? "Pouring" : "Settling"); wake();
  };
  $("shake").onclick = () => { sim.shake(params.shakeTime || 0.5); setStatus("Shaking"); wake(); };
  // Pour rates and shake time apply straight away, without emptying the bin.
  const live = (id, key, lo, hi, def) => {
    const apply = (commit) => {
      const v = parseFloat($(id).value);
      if (!Number.isFinite(v)) { if (commit) $(id).value = params[key]; return; }
      params[key] = Math.min(hi, Math.max(lo, v));
      sim.p[key] = params[key];
      if (commit) $(id).value = params[key];
    };
    $(id).addEventListener("input", () => apply(false));
    $(id).addEventListener("change", () => apply(true));
    if (!Number.isFinite(params[key])) params[key] = def;
  };
  live("rate", "pourRate", 1, 500, 25);
  live("autorate", "autoRate", 1, 500, 60);
  live("shaketime", "shakeTime", 0, 10, 0.5);
  $("strike").onclick = () => { const n = sim.strikeOff(); setStatus(`Removed ${n} above the rim`); wake(); };
  $("reset").onclick = () => {
    sim.reset(); sim.pouring = false; $("pour").textContent = "Pour";
    setStatus("Empty. Pour or run auto fill.", "idle"); wake();
  };
  $("apply").onclick = applySetup;
  $("apply2").onclick = applySetup;
  $("addpart").onclick = addFromEditor;
  $("jarfill").onclick = fillFromJar;
  $("clearlist").onclick = () => { params.list = []; markDirty(); renderList(); };
  $("units").addEventListener("change", describeStl);
  // Threads are visual only, so toggling them just rebuilds the part models; the pour carries on.
  $("showthreads").addEventListener("change", () => {
    setDrawThreads($("showthreads").checked);
    buildPartMeshes();
  });
  // Freezing is a speed-up only; turning it off lets every buried part move again straight away.
  $("freeze").addEventListener("change", () => {
    params.freeze = $("freeze").checked;
    sim.p.freeze = freezeOn();
    if (!sim.p.freeze) { sim.unfreezeAll(); wake(); }
  });
  $("showdebug").addEventListener("change", () => {
    dbg.on = $("showdebug").checked;
    $("debug").hidden = !dbg.on;
    dbg.last = 0;
  });
  $("defaults").onclick = () => { const d = structuredClone(DEFAULTS); d.dims = {}; params.dims = {}; params.sizes = structuredClone(DEFAULT_SIZES); d.sizes = params.sizes; params.jar = structuredClone(JAR_DEFAULT); d.jar = params.jar; params.list = defaultList(); d.list = params.list; markDirty(); writeParams(d); };
  $("part").onchange = () => {
    // remember what was typed for the previous part before switching
    const prev = $("part-fields").dataset.part;
    if (prev && prev !== "stl") params.dims[prev] = readPartFields(prev);
    renderPartFields();
    $("part-fields").dataset.part = $("part").value;
  };
  $("bin").onchange = onBinChange;
  for (const r of document.querySelectorAll('input[name="partUnits"]')) r.onchange = () => {
    const id = $("part").value;
    params.jar = readJarFields();                              // read in the old units
    if (id !== "stl") params.dims[id] = readPartFields(id);
    renderPartFields();                                        // redraw in the new ones
    renderJarFields();
  };
  for (const r of document.querySelectorAll('input[name="binUnits"]')) r.onchange = () => {
    showContainer(readContainer(), radio("binUnits"));
    if (binStl) prepareBin();
  };
  for (const id of ["cL", "cW", "cH"]) $(id).addEventListener("input", () => { $("bin").value = "custom"; $("bin-note").textContent = ""; });
  $("binfile").onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) loadBinStl(f); };
  $("binunits").onchange = $("binup").onchange = () => { if (binStl) prepareBin(); };
  $("stlfile").onchange = (e) => { const f = e.target.files && e.target.files[0]; if (f) loadStl(f); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", applyThemeToScene);
  new MutationObserver(applyThemeToScene).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

// The starting list: a random screw jar.
function defaultList() {
  return jarPool(JAR_DEFAULT).map((c) => ({ part: c.part, dims: c.dims, label: c.label, finish: c.finish, weight: 1 }));
}

async function main() {
  params.list = defaultList();
  buildPartSelect();
  buildBinSelect();
  writeParams(params);
  $("part-fields").dataset.part = params.part;
  renderTrials();
  try {
    await R.init();
  } catch (e) {
    setStatus(`The physics engine couldn't start: this browser blocked WebAssembly (${e.message}). Try a current Chrome, Firefox or Safari.`, "error");
    return;
  }
  shape = buildShape(params);
  applied = structuredClone(params.list);
  section = planFor(params, shape);
  sim = new ScrewSim(R, { ...params, container: section.container, freeze: freezeOn() }, shape);
  initScene();
  bindUI();
  updateCaption();
  setStatus(`Ready: ${partName()}. Container is empty.`, "idle");
  frame();
}
main();
