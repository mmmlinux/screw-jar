import R from "@dimforge/rapier3d-compat";
import { ScrewSim, DEFAULTS, autoFillPartial } from "../src/sim.js";
import { builtinShape, partDefaults, BINS } from "../src/parts.js";
await R.init();
const b = BINS.find(x => x.id === "hf20-large");
const shape = builtinShape(R, "pan", partDefaults("pan"));
const sim = new ScrewSim(R, { ...DEFAULTS, container: { L: b.L, W: b.W, H: b.H, wall: 3 } }, shape);
const g = autoFillPartial(sim, 700); let r; const t0 = performance.now();
while (!(r = g.next()).done) for (let i = 0; i < 10; i++) sim.step();
const lvl = sim.fillLevel();
console.log("inside", r.value, "poured", sim.poured, "fill", lvl.toFixed(1), "of", b.H.toFixed(1), "=> full guess", Math.round(r.value / (lvl / b.H)), ((performance.now() - t0) / 1000).toFixed(0) + "s");
const c = sim.p.container;
for (const x of sim.classify().filter(r => !r.inside).slice(0, 8)) { const t = x.sc.body.translation(); console.log(t.x.toFixed(1), t.y.toFixed(1), t.z.toFixed(1), "maxY", x.maxY.toFixed(1), "half", (c.L/2).toFixed(1), (c.W/2).toFixed(1)); }
console.log("spilled", sim.spilled, "bodies", sim.screws.length);
