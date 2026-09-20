// Standard fastener sizes. Head sizes are the standards' maximum dimensions (rounded), which is
// what matters for how many fit. All values end up in millimetres.
//
// Metric: ISO 7045 (pan), ISO 7046 (countersunk), ISO 4762 (socket head cap), ISO 4017 (hex
// bolt), ISO 4032 (hex nut).
// Inch: ASME B18.6.3 (pan and 82° flat machine screws), ASME B18.3 (socket head cap), ASME
// B18.2.1 (hex bolt), ASME B18.2.2 (hex and machine screw nuts).

const IN = 25.4;

const METRIC_LEN = [3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 90, 100, 110, 120];
const INCH_LEN = [
  [1 / 8, "1/8"], [3 / 16, "3/16"], [1 / 4, "1/4"], [5 / 16, "5/16"], [3 / 8, "3/8"], [1 / 2, "1/2"],
  [5 / 8, "5/8"], [3 / 4, "3/4"], [7 / 8, "7/8"], [1, "1"], [1.25, "1-1/4"], [1.5, "1-1/2"], [1.75, "1-3/4"],
  [2, "2"], [2.5, "2-1/2"], [3, "3"], [3.5, "3-1/2"], [4, "4"],
];

const metricLens = (min, max) => METRIC_LEN.filter((l) => l >= min && l <= max).map((l) => [l, `${l} mm`]);
const inchLens = (min, max) => INCH_LEN.filter(([v]) => v >= min - 1e-9 && v <= max + 1e-9).map(([v, s]) => [v * IN, `${s} in`]);

// Build entries. Metric rows are in mm, inch rows in inches (converted here).
function metric(rows, keys) {
  return rows.map(([label, ...v]) => {
    const dims = {};
    keys.forEach((k, i) => (dims[k] = v[i]));
    const [min, max] = v.slice(keys.length);
    return { id: label, label, system: "metric", dims, lengths: min ? metricLens(min, max) : null };
  });
}
function inch(rows, keys) {
  return rows.map(([label, ...v]) => {
    const dims = {};
    keys.forEach((k, i) => (dims[k] = v[i] * IN));
    const [min, max] = v.slice(keys.length);
    return { id: label, label, system: "inch", dims, lengths: min ? inchLens(min, max) : null };
  });
}

export const SIZES = {
  // head Ø, head height, thread Ø, shortest and longest common length
  pan: [
    ...metric([
      ["M2", 4.0, 1.6, 2, 3, 20], ["M2.5", 5.0, 2.1, 2.5, 3, 25], ["M3", 5.6, 2.4, 3, 4, 30],
      ["M4", 8.0, 3.1, 4, 5, 40], ["M5", 9.5, 3.7, 5, 6, 50], ["M6", 12, 4.6, 6, 8, 60],
      ["M8", 16, 6.0, 8, 10, 60], ["M10", 20, 7.5, 10, 12, 60],
    ], ["headD", "headH", "shankD"]),
    ...inch([
      ["#2-56", 0.167, 0.062, 0.086, 1 / 8, 3 / 4], ["#4-40", 0.219, 0.080, 0.112, 1 / 8, 1],
      ["#6-32", 0.270, 0.097, 0.138, 1 / 8, 1.5], ["#8-32", 0.322, 0.115, 0.164, 1 / 4, 2],
      ["#10-24", 0.373, 0.133, 0.190, 1 / 4, 2], ["#10-32", 0.373, 0.133, 0.190, 1 / 4, 2],
      ["1/4-20", 0.492, 0.175, 0.250, 1 / 4, 2],
    ], ["headD", "headH", "shankD"]),
  ],
  // head Ø, head height, thread Ø; length is overall, since countersunk screws are measured that way
  flat: [
    ...metric([
      ["M2", 3.8, 1.2, 2, 3, 20], ["M2.5", 4.7, 1.5, 2.5, 4, 25], ["M3", 5.5, 1.65, 3, 5, 30],
      ["M4", 8.4, 2.7, 4, 6, 40], ["M5", 9.3, 2.7, 5, 8, 50], ["M6", 11.3, 3.3, 6, 8, 60],
      ["M8", 15.8, 4.65, 8, 10, 60], ["M10", 18.3, 5.0, 10, 12, 60],
    ], ["headD", "headH", "shankD"]),
    ...inch([
      ["#2-56", 0.172, 0.051, 0.086, 1 / 8, 3 / 4], ["#4-40", 0.225, 0.067, 0.112, 3 / 16, 1],
      ["#6-32", 0.279, 0.083, 0.138, 1 / 4, 1.5], ["#8-32", 0.332, 0.100, 0.164, 1 / 4, 2],
      ["#10-24", 0.385, 0.116, 0.190, 3 / 8, 2], ["#10-32", 0.385, 0.116, 0.190, 3 / 8, 2],
      ["1/4-20", 0.507, 0.153, 0.250, 3 / 8, 2],
    ], ["headD", "headH", "shankD"]),
  ],
  // head Ø, head height (equal to the thread Ø), thread Ø
  socket: [
    ...metric([
      ["M2", 3.8, 2, 2, 4, 20], ["M2.5", 4.5, 2.5, 2.5, 5, 25], ["M3", 5.5, 3, 3, 5, 35],
      ["M4", 7, 4, 4, 6, 45], ["M5", 8.5, 5, 5, 8, 50], ["M6", 10, 6, 6, 10, 60],
      ["M8", 13, 8, 8, 12, 80], ["M10", 16, 10, 10, 16, 100], ["M12", 18, 12, 12, 20, 120],
    ], ["headD", "headH", "shankD"]),
    ...inch([
      ["#2-56", 0.140, 0.086, 0.086, 1 / 8, 3 / 4], ["#4-40", 0.183, 0.112, 0.112, 3 / 16, 1],
      ["#6-32", 0.226, 0.138, 0.138, 1 / 4, 1.5], ["#8-32", 0.270, 0.164, 0.164, 1 / 4, 2],
      ["#10-24", 0.312, 0.190, 0.190, 1 / 4, 2], ["#10-32", 0.312, 0.190, 0.190, 1 / 4, 2],
      ["1/4-20", 0.375, 0.250, 0.250, 1 / 4, 3], ["5/16-18", 0.469, 0.3125, 0.3125, 3 / 8, 3],
      ["3/8-16", 0.5625, 0.375, 0.375, 1 / 2, 4], ["1/2-13", 0.750, 0.500, 0.500, 3 / 4, 4],
    ], ["headD", "headH", "shankD"]),
  ],
  // across flats, head height, thread Ø
  hex: [
    ...metric([
      ["M4", 7, 2.8, 4, 8, 40], ["M5", 8, 3.5, 5, 10, 50], ["M6", 10, 4, 6, 10, 60],
      ["M8", 13, 5.3, 8, 16, 80], ["M10", 16, 6.4, 10, 20, 100], ["M12", 18, 7.5, 12, 25, 120],
    ], ["flats", "headH", "shankD"]),
    ...inch([
      ["1/4-20", 0.4375, 0.163, 0.250, 1 / 2, 3], ["5/16-18", 0.500, 0.211, 0.3125, 1 / 2, 3],
      ["3/8-16", 0.5625, 0.243, 0.375, 3 / 4, 4], ["7/16-14", 0.625, 0.291, 0.4375, 1, 4],
      ["1/2-13", 0.750, 0.323, 0.500, 1, 4],
    ], ["flats", "headH", "shankD"]),
  ],
  // across flats, height, hole Ø
  nut: [
    ...metric([
      ["M2", 4, 1.6, 2], ["M2.5", 5, 2, 2.5], ["M3", 5.5, 2.4, 3], ["M4", 7, 3.2, 4], ["M5", 8, 4.7, 5],
      ["M6", 10, 5.2, 6], ["M8", 13, 6.8, 8], ["M10", 16, 8.4, 10], ["M12", 18, 10.8, 12],
    ], ["flats", "height", "holeD"]),
    ...inch([
      ["#4-40", 0.250, 0.094, 0.112], ["#6-32", 0.3125, 0.109, 0.138], ["#8-32", 0.34375, 0.125, 0.164],
      ["#10-24", 0.375, 0.125, 0.190], ["#10-32", 0.375, 0.125, 0.190], ["1/4-20", 0.4375, 0.219, 0.250],
      ["5/16-18", 0.500, 0.266, 0.3125], ["3/8-16", 0.5625, 0.328, 0.375], ["1/2-13", 0.750, 0.438, 0.500],
    ], ["flats", "height", "holeD"]),
  ],
};

export const SIZE_NOTE = {
  pan: "Head sizes are the maximums from ISO 7045 (metric) and ASME B18.6.3 (inch).",
  flat: "Head sizes are the maximums from ISO 7046 (metric) and ASME B18.6.3 82° (inch). Length is overall, because countersunk screws are measured including the head.",
  socket: "Head sizes are the maximums from ISO 4762 (metric) and ASME B18.3 (inch).",
  hex: "Head sizes are from ISO 4017 (metric) and ASME B18.2.1 (inch).",
  nut: "Sizes are from ISO 4032 (metric) and ASME B18.2.2 (inch). The hole is modelled, so nuts can nest on each other.",
};

// Default pick for each type: size id and length in mm.
export const DEFAULT_SIZES = {
  pan: { size: "M3", len: 5 },
  flat: { size: "M4", len: 12 },
  socket: { size: "M4", len: 10 },
  hex: { size: "M6", len: 20 },
  nut: { size: "M6" },
};

export const findSize = (part, id) => (SIZES[part] || []).find((s) => s.id === id);

// Nearest standard length to `mm` for a size (so switching sizes keeps a similar length).
export function nearestLength(entry, mm) {
  if (!entry.lengths || !entry.lengths.length) return undefined;
  let best = entry.lengths[0][0];
  for (const [v] of entry.lengths) if (Math.abs(v - mm) < Math.abs(best - mm)) best = v;
  return best;
}

// ---------- screw jar ----------
export const JAR_TYPES = [["pan", "Pan head"], ["flat", "Flat head"], ["socket", "Socket head"], ["hex", "Hex bolts"], ["nut", "Hex nuts"]];
const NOUN = { pan: "pan head", flat: "flat head", socket: "socket head", hex: "hex bolt", nut: "hex nut" };
// Finishes: socket heads are usually black oxide; the rest a mix of zinc and stainless.
const FINISH = { socket: [0x3a3d42], other: [0xeef1f4, 0xcfd3d7, 0xd8e0ea, 0xbfc4c9] };

export const JAR_DEFAULT = { types: JAR_TYPES.map(([t]) => t), systems: "both", maxDia: 6.35, maxLen: 25.4, variety: 16 };

// Every standard size and length allowed by the jar settings, grouped by fastener type.
function jarCombos(o) {
  const byType = {};
  for (const part of o.types) {
    const list = [];
    for (const e of SIZES[part] || []) {
      if (o.systems !== "both" && e.system !== o.systems) continue;
      const dia = e.dims.shankD ?? e.dims.holeD;
      if (dia > o.maxDia + 1e-6) continue;
      if (!e.lengths) { list.push({ part, dims: { ...e.dims }, label: `${e.label} ${NOUN[part]}` }); continue; }
      for (const [len, lab] of e.lengths) {
        if (len <= o.maxLen + 1e-6) list.push({ part, dims: { ...e.dims, len }, label: `${e.label} × ${lab} ${NOUN[part]}` });
      }
    }
    if (list.length) byType[part] = list;
  }
  return byType;
}

// Pick `variety` different sizes at random. Types are picked evenly first, so nuts (one size
// each) aren't swamped by screws (many lengths each). Returns [] if nothing matches.
export function jarPool(o) {
  const byType = jarCombos(o), pool = [];
  const pick = (arr) => arr.splice(Math.floor(Math.random() * arr.length), 1)[0];
  while (pool.length < o.variety) {
    const types = Object.keys(byType).filter((t) => byType[t].length);
    if (!types.length) break;
    const t = types[Math.floor(Math.random() * types.length)];
    const c = pick(byType[t]);
    const f = t === "socket" ? FINISH.socket : FINISH.other;
    c.finish = f[Math.floor(Math.random() * f.length)];
    pool.push(c);
  }
  return pool;
}
