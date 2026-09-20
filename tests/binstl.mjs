const R = (await import("@dimforge/rapier3d-simd-compat")).default;
import { ScrewSim, DEFAULTS, autoFill } from "../src/sim.js";
import { builtinShape } from "../src/parts.js";
import { prepareBinMesh } from "../src/bin-mesh.js";
await R.init();
// Z-up cuboids -> triangle soup (like an STL)
function cuboids(list) {
  const v = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1] of list) {
    const b = v.length / 3;
    for (const z of [z0, z1]) for (const y of [y0, y1]) for (const x of [x0, x1]) v.push(x, y, z);
    const f = [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]];
    for (const [a, bb, c, d] of f) idx.push(b+a, b+bb, b+c, b+a, b+c, b+d);
  }
  return [new Float32Array(v), new Uint32Array(idx)];
}
const t = 1.5, L = 40, W = 20, H = 20, divider = process.argv[2] === "div";
const parts = [[-L/2-t, -W/2-t, 0, L/2+t, W/2+t, t],             // floor
  [-L/2-t, -W/2-t, 0, -L/2, W/2+t, H+t], [L/2, -W/2-t, 0, L/2+t, W/2+t, H+t],
  [-L/2, -W/2-t, 0, L/2, -W/2, H+t], [-L/2, W/2, 0, L/2, W/2+t, H+t],
  [-L/2-t-8, -W/2-t-8, 0, L/2+t+8, W/2+t+8, 1]];                // base flange outside (must not count)
if (divider) parts.push([-0.6, -W/2, 0, 0.6, W/2, 12]);            // low divider in the middle
const [v, idx] = cuboids(parts);
const t0 = performance.now();
const mesh = prepareBinMesh(v, idx, { up: "z" });
console.log("prep", (performance.now() - t0).toFixed(0), "ms; grid", mesh.nx, "x", mesh.nz, "cell", mesh.cell.toFixed(2), "volume", mesh.volume.toFixed(0), "expected", divider ? (L*W*H - 1.2*W*(12-t)).toFixed(0) : (L*W*H), "rim", mesh.rim.toFixed(2), "H", mesh.H.toFixed(2));
const container = { L: mesh.L, W: mesh.W, H: mesh.H, wall: 0, volume: mesh.volume, mesh };
const shape = builtinShape(R, "pan", { headD: 5.6, headH: 2.4, shankD: 3, len: 5 });
const sim = new ScrewSim(R, { ...DEFAULTS, freeze: false, container }, shape);
const g = autoFill(sim, 3); let r; const t1 = performance.now();
while (!(r = g.next()).done) for (let i = 0; i < 10; i++) sim.step();
console.log(divider ? "divided" : "plain", "inside", r.value, "poured", sim.poured, "spilled", sim.spilled, "struck", sim.struck, ((performance.now() - t1) / 1000).toFixed(0) + "s");
