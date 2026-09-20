import R from "@dimforge/rapier3d-compat";
import { SIZES } from "../src/sizes.js";
import { builtinShape, cleanDims } from "../src/parts.js";
import { partGeometry } from "../src/render-parts.js";
await R.init();
let n = 0, issues = [];
for (const [part, list] of Object.entries(SIZES)) for (const e of list) for (const len of (e.lengths || [[undefined]]).map(x => x[0])) {
  const d = { ...e.dims, ...(len ? { len } : {}) };
  const c = cleanDims(part, d);
  for (const k of Object.keys(d)) if (Math.abs(c[k] - d[k]) > 1e-9) issues.push(`${part} ${e.id} ${len}: ${k} ${d[k]} -> ${c[k]}`);
  const s = builtinShape(R, part, d); partGeometry(part, d);
  if (!(s.volume > 0)) issues.push(`${part} ${e.id} bad volume`);
  n++;
}
console.log("combos", n, "issues", issues.length, issues.slice(0, 5));
for (const [p, l] of Object.entries(SIZES)) console.log(p, l.filter(e=>e.system=="metric").length, "metric,", l.filter(e=>e.system=="inch").length, "inch");
