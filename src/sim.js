// Physics core. Units: millimetres, seconds. Gravity is real (9810 mm/s^2).
// The part being poured is a "shape" (see parts.js): collision pieces, a point set used to
// measure its extent for the fits-inside test, a bounding radius and a solid volume.
import { Vector3 } from "three";
import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { boundingRadius } from "./parts.js";
import { fillAt, cellPoint } from "./bin-mesh.js";

// Copy settings without copying a loaded bin mesh (big, and never changed).
function cloneParams(p) {
  const mesh = p.container && p.container.mesh;
  const q = structuredClone({ ...p, container: { ...p.container, mesh: undefined } });
  if (mesh) q.container.mesh = mesh;
  return q;
}

const FREEZE_EVERY = 25;   // steps between checks
const FREEZE_AFTER = 8;    // checks in a row a part must be still before it can freeze

export const DEFAULTS = {
  // Default: a random screw-jar parts list poured into the small bin of Harbor Freight's 8-bin
  // case (4-1/8 × 3 × 3-7/8 in).
  container: { L: 4.125 * 25.4, W: 3 * 25.4, H: 3.875 * 25.4, wall: 3 },
  bin: "hf8-small",
  part: "pan",         // part type shown in the "add a part" editor
  dims: {},            // per-part dimensions, keyed by part id
  friction: 0.35,
  restitution: 0.1,
  pourRate: 25,        // parts per second for the Pour button
  autoRate: 60,        // parts per second while auto fill pours
  pourMode: "spread",  // "spread" or "spot"
  shakeTime: 0.5,      // seconds of shaking per settle (0 = no shaking)
  maxSim: 700,         // the most parts auto fill will simulate
  bigBin: "partial",   // bins that hold more than maxSim: "section" (scale up) or "partial" (full bin, part-filled)
  partUnits: "mm", binUnits: "mm",  // display units for the settings only; everything inside is mm
  // STL options
  units: 1, collision: "pieces", maxPieces: 8,
  // Solver settings. Stiff contacts matter: soft ones let the pile compress and spring back,
  // which undercounts by a lot.
  dt: 1 / 500,
  iters: 3,
  lengthUnit: 4,
  contactHz: 150,
  ccd: true,
  // Speed-up: parts buried well below the surface that have stopped moving are frozen in place,
  // so the solver only works on the parts that can still move. Shaking unfreezes everything.
  freeze: true,
};

// Arbitrary mesh (e.g. from an STL), in mm. It is re-centred on its bounding-box centre.
// mode "hull": one convex piece (fastest). mode "pieces": convex decomposition for concave parts.
export function meshShape(R, vertices, indices, { mode = "pieces", maxPieces = 8, resolution = 64 } = {}) {
  const v = new Float32Array(vertices);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], v[i + k]); max[k] = Math.max(max[k], v[i + k]); }
  const ctr = min.map((m, k) => (m + max[k]) / 2);
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) v[i + k] -= ctr[k];

  const hull = convexHullPart(v);
  let parts;
  if (mode === "hull") {
    parts = [hull];
  } else {
    const desc = R.ColliderDesc.convexDecomposition(v, indices, { maxConvexHulls: maxPieces, resolution });
    if (!desc) throw new Error("couldn't build a collision shape from this mesh");
    const sh = desc.shape;
    parts = (sh.shapes || [sh]).map((p, i) => ({
      vertices: new Float32Array(p.vertices),
      indices: p.indices ? new Uint32Array(p.indices) : null,
      pos: sh.positions ? sh.positions[i] : { x: 0, y: 0, z: 0 },
      rot: sh.rotations ? sh.rotations[i] : { x: 0, y: 0, z: 0, w: 1 },
    }));
  }
  // The hull's vertices have the same extent as the whole mesh in any orientation, and there
  // are far fewer of them, which keeps the per-frame fits-inside test cheap.
  const points = hull.vertices;

  // Solid volume from the closed mesh (divergence theorem).
  let vol = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1])
      - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c])
      + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return {
    kind: "mesh",
    colliders: () => parts.map((p) => {
      const d = p.indices ? R.ColliderDesc.convexMesh(p.vertices, p.indices) : R.ColliderDesc.convexHull(p.vertices);
      return d.setTranslation(p.pos.x, p.pos.y, p.pos.z).setRotation(p.rot);
    }),
    points,
    reach: boundingRadius(points),
    volume: Math.abs(vol),
    pieces: parts.length,
    size: max.map((m, k) => m - min[k]),
    offset: ctr,
  };
}

// Convex hull as an indexed triangle mesh, computed once so each spawned part skips the hull step.
function convexHullPart(v) {
  const n = v.length / 3, stride = Math.max(1, Math.floor(n / 20000));
  const pts = [];
  for (let i = 0; i < n; i += stride) pts.push(new Vector3(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]));
  const hull = new ConvexHull().setFromPoints(pts);
  const map = new Map(), verts = [], idx = [];
  const id = (p) => {
    let k = map.get(p);
    if (k === undefined) { k = verts.length / 3; map.set(p, k); verts.push(p.x, p.y, p.z); }
    return k;
  };
  for (const face of hull.faces) {
    const loop = [];
    let e = face.edge;
    do { loop.push(id(e.head().point)); e = e.next; } while (e !== face.edge);
    for (let k = 1; k + 1 < loop.length; k++) idx.push(loop[0], loop[k], loop[k + 1]);
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx), pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0, w: 1 } };
}

// A mix of several part shapes (the parts list). Each poured part is one variant, picked at random
// in proportion to its weight. reach and points come from the biggest variant; volume is the
// weighted average, for rough counts.
export function mixShape(variants, weights) {
  let big = variants[0];
  for (const v of variants) if (v.reach > big.reach) big = v;
  const mix = { kind: "mix", variants, points: big.points, reach: big.reach, pieces: Math.max(...variants.map((v) => v.pieces)) };
  setMixWeights(mix, weights);
  return mix;
}

// Change how often each variant is picked. Safe to call mid-pour: it only affects new parts.
export function setMixWeights(mix, weights) {
  const n = mix.variants.length;
  let w = (weights && weights.length === n ? weights : new Array(n).fill(1)).map((x) => Math.max(0, +x || 0));
  if (!w.some((x) => x > 0)) w = new Array(n).fill(1);
  const total = w.reduce((a, b) => a + b, 0);
  mix.weights = w;
  mix.total = total;
  mix.volume = mix.variants.reduce((a, v, i) => a + v.volume * w[i], 0) / total;
}

function pickVariant(mix) {
  let r = Math.random() * mix.total;
  for (let i = 0; i < mix.weights.length; i++) { r -= mix.weights[i]; if (r < 0) return i; }
  return mix.weights.length - 1;
}

// Rough count if the bin were filled (used for pour amounts and deciding whether to scale).
export const binVolume = (c) => c.volume ?? c.L * c.W * c.H;
export function roughCount(container, shape, fraction = 0.5) {
  return (binVolume(container) * fraction) / Math.max(1e-6, shape.volume);
}

// Longest side of the part's own bounding box (its "length" for wall-effect purposes).
export function partSpan(shape) {
  const P = shape.points, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], P[i + k]); mx[k] = Math.max(mx[k], P[i + k]); }
  return Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
}

// If the bin would hold more than maxParts, pick a smaller box to simulate. The height is kept
// where possible (depth affects how parts settle); length and width shrink first. Every side
// stays at least a few part-lengths wide so the section still behaves like a bin.
//
// The count is scaled up by volume. Against full-size runs this came out 4% low for pan head
// screws and 9% high for cubes (which line up in layers against walls), so wall effects depend
// on the shape and no single correction fits; the page says to expect about 10%.
export function planSection(container, shape, maxParts) {
  const est = roughCount(container, shape);
  const c = { ...container };
  if (est <= maxParts) return { container: c, ratio: 1 };
  const minSide = Math.max(6 * shape.reach, 12);
  const s = Math.sqrt(maxParts / est);
  c.L = Math.min(container.L, Math.max(container.L * s, minSide));
  c.W = Math.min(container.W, Math.max(container.W * s, minSide));
  const est2 = roughCount(c, shape);
  if (est2 > maxParts) c.H = Math.min(container.H, Math.max(container.H * (maxParts / est2), Math.max(4 * shape.reach, 10)));
  for (const k of ["L", "W", "H"]) c[k] = Math.round(c[k] * 10) / 10;
  const ratio = (container.L * container.W * container.H) / (c.L * c.W * c.H);
  return { container: c, ratio, volumeRatio: ratio };
}

export class ScrewSim {
  constructor(R, params, shape) {
    this.R = R;
    this.p = cloneParams(params);
    this.shape = shape;
    this.build();
  }

  build() {
    const R = this.R, p = this.p, c = p.container;
    this.world = new R.World({ x: 0, y: -9810, z: 0 });
    this.dt = p.dt;
    this.world.timestep = this.dt;
    this.world.integrationParameters.numSolverIterations = p.iters;
    this.world.integrationParameters.lengthUnit = p.lengthUnit;
    this.world.integrationParameters.contact_natural_frequency = p.contactHz;

    this.time = 0;
    this.stepCount = 0;
    this.screws = [];     // { body, id }
    this.nextId = 0;
    this.poured = 0;
    this.spilled = 0;
    this.struck = 0;
    this.pouring = false;
    this.pourAcc = 0;
    this.pourLimit = Infinity;
    this.autoPour = false;   // true while auto fill is pouring (uses autoRate instead of pourRate)
    this.shakeUntil = 0;
    this.shakeT = 0;
    this.frozen = 0;

    // Ground under the container
    const ground = this.world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -c.wall - 5, 0));
    this.world.createCollider(R.ColliderDesc.cuboid(2000, 5, 2000).setFriction(0.6), ground);

    // Container: kinematic so it can be shaken. Inside floor top at y = 0.
    this.box = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, 0));
    if (c.mesh) {
      // STL bin: the mesh itself, sitting on the ground (its lowest point is at y = 0).
      const flags = R.TriMeshFlags.MERGE_DUPLICATE_VERTICES | R.TriMeshFlags.DELETE_DEGENERATE_TRIANGLES;
      this.world.createCollider(
        R.ColliderDesc.trimesh(c.mesh.vertices, c.mesh.indices, flags).setFriction(p.friction).setRestitution(p.restitution),
        this.box
      );
      return;
    }
    const t = c.wall, hx = c.L / 2, hz = c.W / 2, H = c.H;
    const parts = [
      [hx + t, 6, hz + t, 0, -6, 0],                      // floor (12 mm thick so nothing pushes through)
      [t / 2, H / 2, hz + t, -hx - t / 2, H / 2, 0],      // -x wall
      [t / 2, H / 2, hz + t, hx + t / 2, H / 2, 0],       // +x wall
      [hx, H / 2, t / 2, 0, H / 2, -hz - t / 2],          // -z wall
      [hx, H / 2, t / 2, 0, H / 2, hz + t / 2],           // +z wall
    ];
    for (const [a, b, d, x, y, z] of parts) {
      this.world.createCollider(
        R.ColliderDesc.cuboid(a, b, d).setTranslation(x, y, z).setFriction(p.friction).setRestitution(p.restitution),
        this.box
      );
    }
  }

  reset(params, shape) {
    if (params) this.p = cloneParams(params);
    if (shape) this.shape = shape;
    this.world.free();
    this.build();
  }

  // Shape of one poured part (its variant, for a mix).
  shapeOf(sc) {
    return this.shape.kind === "mix" ? this.shape.variants[sc.v] : this.shape;
  }

  addPart(x, y, z, q, v = 0) {
    const R = this.R;
    const body = this.world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .setTranslation(x, y, z)
        .setRotation(q)
        .setLinvel((Math.random() - 0.5) * 60, -250, (Math.random() - 0.5) * 60)
        .setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 20, z: (Math.random() - 0.5) * 20 })
        .setAngularDamping(0.1)
        .setCcdEnabled(!!this.p.ccd)
    );
    const fr = this.p.friction, re = this.p.restitution;
    const sc = { body, id: this.nextId++, v, still: 0, frozen: false };
    for (const d of this.shapeOf(sc).colliders()) {
      this.world.createCollider(d.setFriction(fr).setRestitution(re).setDensity(7.85), body);
    }
    this.screws.push(sc);
    this.poured++;
  }

  trySpawn() {
    const c = this.p.container;
    const mix = this.shape.kind === "mix";
    const v = mix ? pickVariant(this.shape) : 0;
    const reach = (mix ? this.shape.variants[v].reach : this.shape.reach) + 0.5;
    const maxReach = this.shape.reach + 0.5;
    // Spawn above whatever is highest right now (rim or heap).
    let top = c.H;
    for (const sc of this.screws) { const ty = sc.body.translation().y; if (ty > top && ty < c.H + 60 + 4 * reach) top = ty; }
    const y = top + maxReach * 2 + 6;
    let x, z;
    if (c.mesh) {
      const m = c.mesh;
      [x, z] = this.p.pourMode === "spot"
        ? cellPoint(m, m.spot).map((u) => u + (Math.random() - 0.5) * 4)
        : cellPoint(m, m.cells[Math.floor(Math.random() * m.cells.length)]);
    } else if (this.p.pourMode === "spot") {
      x = -c.L / 4 + (Math.random() - 0.5) * 4;
      z = (Math.random() - 0.5) * 4;
    } else {
      x = (Math.random() - 0.5) * Math.max(0, c.L - 2 * reach);
      z = (Math.random() - 0.5) * Math.max(0, c.W - 2 * reach);
    }
    const minD = reach + maxReach + 0.5;
    for (const sc of this.screws) {
      const t = sc.body.translation();
      if (t.y < y - 3 * maxReach) continue;
      const dx = t.x - x, dy = t.y - y, dz = t.z - z;
      if (dx * dx + dy * dy + dz * dz < minD * minD) return false;
    }
    // uniform random rotation
    const u1 = Math.random(), u2 = Math.random() * 2 * Math.PI, u3 = Math.random() * 2 * Math.PI;
    const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
    this.addPart(x, y, z, { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) }, v);
    return true;
  }

  step() {
    const c = this.p.container;
    if (this.pouring) {
      // Read the rate every step, so changing it on the page takes effect immediately.
      this.pourAcc += (this.autoPour ? this.p.autoRate : this.p.pourRate) * this.dt;
      let tries = 0;
      while (this.pourAcc >= 1 && this.poured < this.pourLimit && tries++ < 4) {
        if (!this.trySpawn()) break;
        this.pourAcc -= 1;
      }
      if (this.pourAcc > 3) this.pourAcc = 3;
      if (this.poured >= this.pourLimit) this.pouring = false;
    }
    if (this.time < this.shakeUntil) {
      this.shakeT += this.dt;
      const w = 2 * Math.PI * 22;
      const A = Math.min(2, Math.max(0.3, 0.1 * this.shape.reach));
      this.box.setNextKinematicTranslation({
        x: A * Math.sin(w * this.shakeT),
        y: 0.6 * A * Math.sin(w * this.shakeT * 1.13 + 1),
        z: A * Math.sin(w * this.shakeT * 0.87 + 2),
      });
    } else if (this.shakeT !== 0) {
      this.box.setNextKinematicTranslation({ x: 0, y: 0, z: 0 });
      this.shakeT = 0;
    }
    this.world.step();
    this.time += this.dt;
    this.stepCount++;
    if (this.p.freeze && this.stepCount % FREEZE_EVERY === 0) this.freezeSettled();

    // Remove parts that fell out onto the ground.
    if (this.stepCount % 20 === 0) {
      for (let i = this.screws.length - 1; i >= 0; i--) {
        const t = this.screws[i].body.translation();
        const outFoot = Math.abs(t.x) > c.L / 2 + c.wall + 1 || Math.abs(t.z) > c.W / 2 + c.wall + 1;
        if ((outFoot && t.y < c.H / 2) || t.y < -c.wall - 1) {
          this.world.removeRigidBody(this.screws[i].body);
          this.screws.splice(i, 1);
          this.spilled++;
        }
      }
    }
  }

  // Freeze parts that have been still for a while and are buried under the resting pile.
  freezeSettled() {
    if (this.time < this.shakeUntil) return;
    const R = this.R;
    let top = -Infinity;
    const slow = [];
    for (const sc of this.screws) {
      if (sc.frozen) continue;
      const v = sc.body.linvel(), w = sc.body.angvel();
      const still = v.x * v.x + v.y * v.y + v.z * v.z < 8 * 8 && w.x * w.x + w.y * w.y + w.z * w.z < 0.5 * 0.5;
      sc.still = still ? sc.still + 1 : 0;
      if (still) { const y = sc.body.translation().y; if (y > top) top = y; slow.push(sc); }
    }
    for (const sc of this.screws) if (sc.frozen) { const y = sc.body.translation().y; if (y > top) top = y; }
    // Buried: at least the part's own size plus 10 mm below the highest resting part.
    for (const sc of slow) {
      if (sc.still >= FREEZE_AFTER && sc.body.translation().y < top - this.shapeOf(sc).reach - 10) {
        sc.body.setBodyType(R.RigidBodyType.Fixed, false);
        sc.frozen = true;
        this.frozen++;
      }
    }
  }

  unfreezeAll() {
    const R = this.R;
    for (const sc of this.screws) {
      if (!sc.frozen) continue;
      sc.body.setBodyType(R.RigidBodyType.Dynamic, true);
      sc.frozen = false; sc.still = 0;
    }
    this.frozen = 0;
  }

  // Classify every part: `inside` means within the walls and entirely at or below the rim.
  // The walls are solid, so a part whose centre is between them can only poke into a wall by
  // the solver's small contact overlap (a few tenths of a mm under a heavy pile). Testing the
  // centre avoids miscounting those parts; the rim test uses the part's full extent.
  classify() {
    const c = this.p.container;
    const top = c.H + 0.1;
    const res = [];
    for (const sc of this.screws) {
      const P = this.shapeOf(sc).points, n = P.length;
      const t = sc.body.translation(), q = sc.body.rotation();
      const { x, y, z, w } = q;
      const m10 = 2 * (x * y + w * z), m11 = 1 - 2 * (x * x + z * z), m12 = 2 * (y * z - w * x);
      let maxY = -Infinity;
      for (let i = 0; i < n; i += 3) {
        const px = P[i], py = P[i + 1], pz = P[i + 2];
        const wy = m10 * px + m11 * py + m12 * pz;
        if (wy > maxY) maxY = wy;
      }
      maxY += t.y;
      let inside;
      if (c.mesh) {
        // STL bin: over the hollow, and below the level that part of the bin fills to.
        const lev = fillAt(c.mesh, t.x, t.z);
        inside = lev === lev && maxY <= lev + 0.1;
      } else {
        inside = Math.abs(t.x) < c.L / 2 && Math.abs(t.z) < c.W / 2 && maxY <= top;
      }
      res.push({ sc, inside, maxY });
    }
    return res;
  }

  countInside() {
    return this.classify().filter((r) => r.inside).length;
  }

  strikeOff() {
    let n = 0;
    for (const r of this.classify()) {
      if (!r.inside) {
        this.world.removeRigidBody(r.sc.body);
        this.screws.splice(this.screws.indexOf(r.sc), 1);
        n++;
      }
    }
    this.struck += n;
    return n;
  }

  // Height of the settled pile's top surface: the mean top of the highest tenth of the parts
  // inside the bin. Rough, because a random pile has a bumpy surface.
  fillLevel() {
    const tops = this.classify().filter((r) => r.inside).map((r) => r.maxY).sort((a, b) => b - a);
    if (!tops.length) return 0;
    const k = Math.max(3, Math.ceil(tops.length * 0.1));
    const top = tops.slice(0, k);
    return Math.min(this.p.container.H, top.reduce((a, b) => a + b, 0) / top.length);
  }

  // Parts resting with some part above the rim. Shaking only helps when there are some, since it
  // settles the heap down into the bin. Parts still falling or bouncing don't count.
  overRim() {
    let n = 0;
    for (const r of this.classify()) {
      if (r.inside) continue;
      const v = r.sc.body.linvel();
      if (Math.hypot(v.x, v.y, v.z) < 30) n++;
    }
    return n;
  }

  shake(seconds) {
    if (seconds > 0) this.unfreezeAll();
    this.shakeUntil = this.time + Math.max(0, seconds || 0);
  }

  maxSpeed() {
    let m = 0;
    for (const sc of this.screws) {
      const v = sc.body.linvel();
      m = Math.max(m, Math.hypot(v.x, v.y, v.z));
    }
    return m;
  }
}

// Auto fill: pour in batches until the pile rises above the rim, settle, shake, settle, strike
// off; then top up the same way and repeat until a round stops adding parts. A generator that
// yields a status string whenever it wants the caller to advance the simulation by about 20 ms.
export function* autoFill(sim, rounds = 3) {
  const c = sim.p.container;
  let best = 0;
  for (let r = 1; r <= rounds; r++) {
    const label = `Round ${r} of ${rounds}`;
    for (let batch = 0; batch < 15; batch++) {
      const inside = sim.countInside();
      const amount = r === 1 && batch === 0
        ? Math.max(10, Math.ceil(roughCount(c, sim.shape, 0.5)))       // first guess at a full bin
        : Math.max(8, Math.ceil(0.12 * Math.max(inside, 60)));          // then top up in batches
      sim.pourLimit = sim.poured + amount;
      sim.autoPour = true;
      sim.pouring = true;
      const pourStart = sim.time;
      while (sim.pouring && sim.time - pourStart < 600) yield `${label}: pouring`;
      sim.pouring = false;
      let settle = 0;
      while (settle < 1.2 && (settle < 0.3 || sim.maxSpeed() > 60)) { settle += 0.02; yield `${label}: settling`; }
      // Heaped once a few parts sit above the rim.
      const over = sim.screws.length - sim.countInside();
      if (over >= Math.max(3, 0.03 * sim.screws.length)) break;
    }
    if (sim.overRim() > 0) {
      sim.shake(sim.p.shakeTime);
      while (sim.time < sim.shakeUntil) yield `${label}: shaking`;
    }
    let settle = 0;
    while (settle < 1.5 && (settle < 0.3 || sim.maxSpeed() > 40)) { settle += 0.02; yield `${label}: settling`; }
    sim.strikeOff();
    const n = sim.countInside();
    if (r > 1 && n <= best) break;
    best = Math.max(best, n);
  }
  sim.pourLimit = Infinity;
  sim.autoPour = false;
  return sim.countInside();
}

// Partial fill for bins too big to fill: pour a fixed number of parts into the full-size bin and
// let them settle. It only shakes if the pile pokes above the rim; nothing is struck off.
export function* autoFillPartial(sim, count) {
  sim.pourLimit = sim.poured + count;
  sim.autoPour = true;
  sim.pouring = true;
  const pourStart = sim.time;
  while (sim.pouring && sim.time - pourStart < 600) yield `Pouring ${Math.min(sim.poured, count)} of ${count}`;
  sim.pouring = false;
  let settle = 0;
  while (settle < 1.5 && (settle < 0.4 || sim.maxSpeed() > 40)) { settle += 0.02; yield "Settling"; }
  if (sim.overRim() > 0) {   // only when the pile reaches above the rim
    sim.shake(sim.p.shakeTime);
    while (sim.time < sim.shakeUntil) yield "Shaking";
    settle = 0;
    while (settle < 1.5 && (settle < 0.3 || sim.maxSpeed() > 40)) { settle += 0.02; yield "Settling"; }
  }
  sim.pourLimit = Infinity;
  sim.autoPour = false;
  return sim.countInside();
}
