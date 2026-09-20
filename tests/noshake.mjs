import R from "@dimforge/rapier3d-compat";
import { ScrewSim, DEFAULTS, autoFill, autoFillPartial, mixShape } from "../src/sim.js";
import { builtinShape, partDefaults } from "../src/parts.js";
import { jarPool, JAR_DEFAULT } from "../src/sizes.js";
await R.init();
const shape = mixShape(jarPool(JAR_DEFAULT).map(e => ({ ...builtinShape(R, e.part, e.dims), render: e })));
let sim = new ScrewSim(R, { ...DEFAULTS }, shape);
let g = autoFillPartial(sim, 300), r, seen = new Set();
while (!(r = g.next()).done) { seen.add(r.value.replace(/\d+/g, "#")); for (let i = 0; i < 10; i++) sim.step(); }
console.log("partial (jar, 300 in 8-bin small):", [...seen].join(", "), "| over rim", sim.overRim(), "inside", r.value);
sim = new ScrewSim(R, { ...DEFAULTS, container: { L: 40, W: 20, H: 20, wall: 3 } }, builtinShape(R, "pan", partDefaults("pan")));
g = autoFill(sim, 3); seen = new Set();
while (!(r = g.next()).done) { seen.add(r.value.split(": ")[1]); for (let i = 0; i < 10; i++) sim.step(); }
console.log("full fill (pan, 40x20x20):", [...seen].join(", "), "| count", r.value);
