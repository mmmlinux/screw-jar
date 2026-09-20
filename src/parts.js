// Built-in part shapes and bin presets. Units: millimetres.
//
// Every shape carries: colliders() (fresh Rapier collider descs for one part), points (a point
// set whose extent equals the part's extent, used by the fits-inside test), reach (bounding
// radius), volume (solid volume) and pieces (collider count).
//
// Fasteners use this body frame: +Y points from the shank toward the top of the head,
// with the underside of the head at y = 0.

export const PARTS = [
  {
    id: "pan", group: "Fasteners", label: "Pan head screw", note: "Default is ISO 7045 M3 × 5 at maximum head size.",
    fields: [["headD", "Head Ø", 5.6], ["headH", "Head height", 2.4], ["shankD", "Thread Ø", 3], ["len", "Length under head", 5]],
  },
  {
    id: "flat", group: "Fasteners", label: "Flat head (countersunk) screw",
    note: "Default is ISO 7046 M4 × 12. Length is overall, because countersunk screws are measured including the head.",
    fields: [["headD", "Head Ø", 8], ["headH", "Head height", 2.2], ["shankD", "Thread Ø", 4], ["len", "Overall length", 12]],
  },
  {
    id: "socket", group: "Fasteners", label: "Socket head cap screw", note: "Default is ISO 4762 M4 × 10.",
    fields: [["headD", "Head Ø", 7], ["headH", "Head height", 4], ["shankD", "Thread Ø", 4], ["len", "Length under head", 10]],
  },
  {
    id: "hex", group: "Fasteners", label: "Hex head bolt", note: "Default is ISO 4017 M6 × 20 (10 mm across the flats).",
    fields: [["flats", "Across flats", 10], ["headH", "Head height", 4], ["shankD", "Thread Ø", 6], ["len", "Length under head", 20]],
  },
  {
    id: "nut", group: "Fasteners", label: "Hex nut", note: "Default is ISO 4032 M6 (10 mm across the flats). The hole is modelled, so nuts can nest on bolts.",
    fields: [["flats", "Across flats", 10], ["height", "Height", 5.2], ["holeD", "Hole Ø", 6]],
  },
  { id: "cube", group: "Shapes", label: "Cube or box", note: "", fields: [["x", "Length", 10], ["y", "Height", 10], ["z", "Width", 10]] },
  { id: "cylinder", group: "Shapes", label: "Cylinder", note: "", fields: [["dia", "Diameter", 8], ["len", "Length", 20]] },
  { id: "sphere", group: "Shapes", label: "Sphere", note: "", fields: [["dia", "Diameter", 8]] },
];

export const PART_BY_ID = Object.fromEntries(PARTS.map((p) => [p.id, p]));

export function partDefaults(id) {
  const d = {};
  for (const [k, , v] of PART_BY_ID[id].fields) d[k] = v;
  return d;
}

// Harbor Freight STOREHOUSE portable parts cases: listed "Container Size" per compartment,
// converted from inches. These are nominal opening sizes; the real bins taper toward the
// bottom and have rounded corners, so treat counts as a slight overestimate.
const IN = 25.4;
export const BINS = [
  { id: "custom", label: "Custom size" },
  { id: "stl", label: "Custom STL file" },
  { id: "hf8-large", label: "HF 8-bin case, large bin: 6⅛ × 4¼ × 3⅞ in", L: 6.125 * IN, W: 4.25 * IN, H: 3.875 * IN },
  { id: "hf8-small", label: "HF 8-bin case, small bin: 4⅛ × 3 × 3⅞ in", L: 4.125 * IN, W: 3 * IN, H: 3.875 * IN },
  { id: "hf20-large", label: "HF 20-bin case, large bin: 4¼ × 3 × 1⅞ in", L: 4.25 * IN, W: 3 * IN, H: 1.875 * IN },
  { id: "hf-mid", label: "HF 20- and 15-bin cases, medium bin: 3 × 2 × 1⅞ in", L: 3 * IN, W: 2 * IN, H: 1.875 * IN },
  { id: "hf-small", label: "HF 20- and 15-bin cases, small bin: 2 × 1⅜ × 1⅞ in", L: 2 * IN, W: 1.375 * IN, H: 1.875 * IN },
];

export const BIN_NOTE = "Harbor Freight's listed compartment size. Real bins taper slightly and have rounded corners, so the true count will be a little lower.";

const TAU = Math.PI * 2;

function ring(out, r, y, n = 24, phase = 0) {
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * TAU;
    out.push(r * Math.cos(a), y, r * Math.sin(a));
  }
}

// Points spread evenly over a sphere so the extent test sees its true radius.
function spherePoints(out, r, n = 160) {
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * i + 1) / n, rr = Math.sqrt(Math.max(0, 1 - y * y)), a = g * i;
    out.push(r * rr * Math.cos(a), r * y, r * rr * Math.sin(a));
  }
  // include the exact poles and equator extremes
  out.push(0, r, 0, 0, -r, 0, r, 0, 0, -r, 0, 0, 0, 0, r, 0, 0, -r);
}

// Hexagon with a vertex on +X, flats facing ±Z; `af` is the across-flats size.
function hexPrism(af, y0, y1) {
  const r = af / Math.sqrt(3), pts = [];
  ring(pts, r, y0, 6); ring(pts, r, y1, 6);
  return pts;
}

// Validate and clamp user-entered dimensions so shapes stay buildable.
export function cleanDims(id, d) {
  const o = { ...partDefaults(id), ...d };
  for (const k of Object.keys(o)) o[k] = Math.max(0.3, Math.min(300, +o[k] || partDefaults(id)[k]));
  if ("headD" in o && "shankD" in o) o.shankD = Math.min(o.shankD, o.headD - 0.2);
  if (id === "hex") o.shankD = Math.min(o.shankD, o.flats - 0.2);
  if (id === "nut") o.holeD = Math.min(o.holeD, o.flats - 1);
  if (id === "flat") o.len = Math.max(o.len, o.headH + 0.5);
  return o;
}

export function builtinShape(R, id, dims) {
  const d = cleanDims(id, dims);
  const pts = [];
  let colliders, volume, pieces = 1;

  switch (id) {
    case "pan": {
      const r0 = d.headD / 2, rs = d.shankD / 2;
      const b = Math.max(0.05, Math.min(0.6, d.headH / 2 - 0.05, r0 - 0.05));
      colliders = () => [
        R.ColliderDesc.roundCylinder(d.headH / 2 - b, r0 - b, b).setTranslation(0, d.headH / 2, 0),
        R.ColliderDesc.cylinder(d.len / 2, rs).setTranslation(0, -d.len / 2, 0),
      ];
      pieces = 2;
      ring(pts, rs, -d.len); ring(pts, rs, 0); ring(pts, r0, 0); ring(pts, r0, d.headH - b);
      for (let k = 1; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); ring(pts, r0 - b + b * Math.cos(a), d.headH - b + b * Math.sin(a)); }
      volume = Math.PI * r0 * r0 * d.headH + Math.PI * rs * rs * d.len;
      break;
    }
    case "flat": {
      // Head: frustum from headD at y = 0 (the flat top) down to the shank at y = -headH.
      const r0 = d.headD / 2, rs = d.shankD / 2, shank = d.len - d.headH;
      const head = [];
      ring(head, r0, 0); ring(head, rs, -d.headH);
      const headV = new Float32Array(head);
      colliders = () => [
        R.ColliderDesc.convexHull(headV),
        R.ColliderDesc.cylinder(shank / 2, rs).setTranslation(0, -d.headH - shank / 2, 0),
      ];
      pieces = 2;
      pts.push(...head); ring(pts, rs, -d.len);
      volume = (Math.PI * d.headH / 3) * (r0 * r0 + r0 * rs + rs * rs) + Math.PI * rs * rs * shank;
      break;
    }
    case "socket": {
      const r0 = d.headD / 2, rs = d.shankD / 2;
      colliders = () => [
        R.ColliderDesc.cylinder(d.headH / 2, r0).setTranslation(0, d.headH / 2, 0),
        R.ColliderDesc.cylinder(d.len / 2, rs).setTranslation(0, -d.len / 2, 0),
      ];
      pieces = 2;
      ring(pts, rs, -d.len); ring(pts, rs, 0); ring(pts, r0, 0); ring(pts, r0, d.headH);
      volume = Math.PI * r0 * r0 * d.headH + Math.PI * rs * rs * d.len;
      break;
    }
    case "hex": {
      const rs = d.shankD / 2;
      const head = hexPrism(d.flats, 0, d.headH), headV = new Float32Array(head);
      colliders = () => [
        R.ColliderDesc.convexHull(headV),
        R.ColliderDesc.cylinder(d.len / 2, rs).setTranslation(0, -d.len / 2, 0),
      ];
      pieces = 2;
      pts.push(...head); ring(pts, rs, 0); ring(pts, rs, -d.len);
      volume = (Math.sqrt(3) / 2) * d.flats * d.flats * d.headH + Math.PI * rs * rs * d.len;
      break;
    }
    case "nut": {
      // Six convex wedges around a hexagonal bore, so the hole is really open.
      const R0 = d.flats / Math.sqrt(3), ri = d.holeD / 2 / Math.cos(Math.PI / 6), h = d.height / 2;
      const wedges = [];
      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TAU, a1 = ((i + 1) / 6) * TAU, v = [];
        for (const y of [-h, h]) for (const [r, a] of [[ri, a0], [ri, a1], [R0, a0], [R0, a1]]) v.push(r * Math.cos(a), y, r * Math.sin(a));
        wedges.push(new Float32Array(v));
      }
      colliders = () => wedges.map((v) => R.ColliderDesc.convexHull(v));
      pieces = 6;
      pts.push(...hexPrism(d.flats, -h, h));
      volume = (Math.sqrt(3) / 2) * d.flats * d.flats * d.height - (3 * Math.sqrt(3) / 2) * ri * ri * d.height;
      break;
    }
    case "cube": {
      colliders = () => [R.ColliderDesc.cuboid(d.x / 2, d.y / 2, d.z / 2)];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(sx * d.x / 2, sy * d.y / 2, sz * d.z / 2);
      volume = d.x * d.y * d.z;
      break;
    }
    case "cylinder": {
      const r = d.dia / 2;
      colliders = () => [R.ColliderDesc.cylinder(d.len / 2, r)];
      ring(pts, r, -d.len / 2, 48); ring(pts, r, d.len / 2, 48);
      volume = Math.PI * r * r * d.len;
      break;
    }
    case "sphere": {
      const r = d.dia / 2;
      colliders = () => [R.ColliderDesc.ball(r)];
      spherePoints(pts, r);
      volume = (4 / 3) * Math.PI * r * r * r;
      break;
    }
    default:
      throw new Error(`Unknown part "${id}"`);
  }

  const points = new Float32Array(pts);
  return { kind: "builtin", id, dims: d, colliders, points, reach: boundingRadius(points), volume, pieces };
}

export function boundingRadius(pts) {
  let r = 0;
  for (let i = 0; i < pts.length; i += 3) r = Math.max(r, Math.hypot(pts[i], pts[i + 1], pts[i + 2]));
  return r;
}
