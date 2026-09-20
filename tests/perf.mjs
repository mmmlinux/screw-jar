import R from "@dimforge/rapier3d-compat";
import { ScrewSim, DEFAULTS, autoFillPartial, mixShape } from "../src/sim.js";
import { builtinShape, BINS } from "../src/parts.js";
import { jarPool, JAR_DEFAULT } from "../src/sizes.js";
await R.init();
const cfg = JSON.parse(process.argv[2] || "{}");
Math.random = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pool = jarPool(JAR_DEFAULT);
const shape = mixShape(pool.map(e => builtinShape(R, e.part, e.dims)));
const b = BINS.find(x => x.id === "hf8-small");
const sim = new ScrewSim(R, { ...DEFAULTS, ...cfg, container: { L: b.L, W: b.W, H: b.H, wall: 3 } }, shape);
const g = autoFillPartial(sim, 700); let r; const t0 = performance.now(); let phys = 0, cls = 0, steps = 0;
while (!(r = g.next()).done) { const a = performance.now(); for (let i = 0; i < Math.round(0.02 / sim.dt); i++) { sim.step(); steps++; } phys += performance.now() - a; const c = performance.now(); sim.classify(); cls += performance.now() - c; }
// then time steady state with a full pile, awake
const a = performance.now(); for (let i = 0; i < 200; i++) sim.step(); const settled = (performance.now() - a) / 200;
sim.shake(1); const s0 = performance.now(); for (let i = 0; i < 200; i++) sim.step(); const shaking = (performance.now() - s0) / 200;
const c0 = performance.now(); for (let i = 0; i < 50; i++) sim.classify(); const clsOne = (performance.now() - c0) / 50;
console.log(JSON.stringify(cfg), "inside", sim.countInside(), "simT", sim.time.toFixed(2), "wall", ((performance.now() - t0) / 1000).toFixed(1) + "s", "ms/step avg", (phys / steps).toFixed(2), "settled", settled.toFixed(2), "shaking", shaking.toFixed(2), "classify", clsOne.toFixed(2), "ms");
