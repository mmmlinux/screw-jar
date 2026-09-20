const R = (await import(process.env.RAPIER || "@dimforge/rapier3d-compat")).default;
import { ScrewSim, DEFAULTS, autoFill, mixShape, planSection } from "../src/sim.js";
import { builtinShape, BINS } from "../src/parts.js";
import { jarPool, JAR_DEFAULT } from "../src/sizes.js";
await R.init();
Math.random = (() => { let s = +(process.env.SEED || 777); return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
const pool = jarPool(JAR_DEFAULT);
const shape = mixShape(pool.map(e => ({ ...builtinShape(R, e.part, e.dims), render: e })));
const b = BINS.find(x => x.id === "hf-mid");
const sim = new ScrewSim(R, { ...DEFAULTS, freeze: process.env.FREEZE !== "0", container: { L: b.L, W: b.W, H: b.H, wall: 3 } }, shape);
const g = autoFill(sim, 3); let r; const t0 = performance.now();
while (!(r = g.next()).done) for (let i = 0; i < 10; i++) sim.step();
const counts = {};
for (const x of sim.classify()) if (x.inside) { const k = pool[x.sc.v].part; counts[k] = (counts[k] || 0) + 1; }
console.log("inside", r.value, "poured", sim.poured, "by type", JSON.stringify(counts), ((performance.now() - t0) / 1000).toFixed(0) + "s");
