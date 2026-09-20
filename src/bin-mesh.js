// A container loaded from an STL. Units: millimetres, +Y up.
//
// Physics uses the mesh itself (a triangle-mesh collider). For counting, the mesh is turned into
// a height map seen from above, and the space it can hold is found the way water would fill it:
// flooding in from the edges, each spot's fill level is the lowest wall it would have to climb
// over to get out. So compartments, dividers, a low front lip or a scoop all count correctly,
// and anything resting outside the bin (on a base flange, say) doesn't.

// vertices: Float32Array in file units; scale: mm per file unit; up: "z" or "y".
// Returns the mesh centred over the origin with its lowest point at y = 0, plus the fill map.
export function prepareBinMesh(src, indices, { scale = 1, up = "z" } = {}) {
  const n = src.length / 3, v = new Float32Array(src.length);
  for (let i = 0; i < n; i++) {
    const x = src[3 * i] * scale, y = src[3 * i + 1] * scale, z = src[3 * i + 2] * scale;
    if (up === "z") { v[3 * i] = x; v[3 * i + 1] = z; v[3 * i + 2] = -y; }   // Z-up (CAD, 3D printing) to Y-up
    else { v[3 * i] = x; v[3 * i + 1] = y; v[3 * i + 2] = z; }
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[i + k]); mx[k] = Math.max(mx[k], v[i + k]); }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (let i = 0; i < v.length; i += 3) { v[i] -= cx; v[i + 1] -= mn[1]; v[i + 2] -= cz; }
  const L = mx[0] - mn[0], H = mx[1] - mn[1], W = mx[2] - mn[2];
  const map = fillMap(v, indices, L, W);
  return { vertices: v, indices: new Uint32Array(indices), L, W, H, ...map };
}

function fillMap(v, idx, L, W) {
  // Grid over the footprint, with a one-cell empty border so flooding starts outside the bin.
  const cell = Math.max(0.25, Math.sqrt((L * W) / 160000));
  const nx = Math.ceil(L / cell) + 3, nz = Math.ceil(W / cell) + 3;
  const x0 = -L / 2 - 1.5 * cell, z0 = -W / 2 - 1.5 * cell;
  const top = new Float32Array(nx * nz).fill(-1);   // highest surface in each column; -1 = nothing (ground)
  const put = (x, z, y) => {
    const i = Math.floor((x - x0) / cell), k = Math.floor((z - z0) / cell);
    if (i < 0 || k < 0 || i >= nx || k >= nz) return;
    const j = k * nx + i;
    if (y > top[j]) top[j] = y;
  };
  const step = cell * 0.5;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
    const ax = v[a], ay = v[a + 1], az = v[a + 2], bx = v[b], by = v[b + 1], bz = v[b + 2], qx = v[c], qy = v[c + 1], qz = v[c + 2];
    // Edges, sampled finely: this catches thin walls whose tops are narrower than a cell.
    for (const [px, py, pz, ex, ey, ez] of [[ax, ay, az, bx, by, bz], [bx, by, bz, qx, qy, qz], [qx, qy, qz, ax, ay, az]]) {
      const len = Math.hypot(ex - px, ez - pz), m = Math.max(1, Math.ceil(len / step));
      for (let s = 0; s <= m; s++) { const f = s / m; put(px + (ex - px) * f, pz + (ez - pz) * f, py + (ey - py) * f); }
    }
    // Interior: every cell centre the triangle covers, seen from above.
    const d = (bz - qz) * (ax - qx) + (qx - bx) * (az - qz);
    if (Math.abs(d) < 1e-9) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, qx) - x0) / cell)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, qx) - x0) / cell));
    const k0 = Math.max(0, Math.floor((Math.min(az, bz, qz) - z0) / cell)), k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, qz) - z0) / cell));
    for (let k = k0; k <= k1; k++) {
      const z = z0 + (k + 0.5) * cell;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + (i + 0.5) * cell;
        const l1 = ((bz - qz) * (x - qx) + (qx - bx) * (z - qz)) / d;
        const l2 = ((qz - az) * (x - qx) + (ax - qx) * (z - qz)) / d;
        const l3 = 1 - l1 - l2;
        if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
        const y = l1 * ay + l2 * by + l3 * qy, j = k * nx + i;
        if (y > top[j]) top[j] = y;
      }
    }
  }

  // Water fill: a priority flood from the border. level[j] is the height this column fills to.
  const N = nx * nz, level = new Float32Array(N), seen = new Uint8Array(N);
  const heap = new Int32Array(N); let hn = 0;
  const less = (a, b) => level[heap[a]] < level[heap[b]];
  const push = (j) => {
    let p = hn++; heap[p] = j;
    while (p > 0) { const q = (p - 1) >> 1; if (!less(p, q)) break; [heap[p], heap[q]] = [heap[q], heap[p]]; p = q; }
  };
  const pop = () => {
    const r = heap[0]; heap[0] = heap[--hn];
    let p = 0;
    for (;;) {
      const l = 2 * p + 1, rr = l + 1; let m = p;
      if (l < hn && less(l, m)) m = l;
      if (rr < hn && less(rr, m)) m = rr;
      if (m === p) break;
      [heap[p], heap[m]] = [heap[m], heap[p]]; p = m;
    }
    return r;
  };
  for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    if (i && k && i < nx - 1 && k < nz - 1) continue;
    const j = k * nx + i; level[j] = top[j]; seen[j] = 1; push(j);
  }
  while (hn) {
    const j = pop(), i = j % nx, k = (j - i) / nx;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const q = b * nx + a;
      if (seen[q]) continue;
      seen[q] = 1; level[q] = Math.max(top[q], level[j]); push(q);
    }
  }

  // Columns that hold at least half a millimetre count as inside the bin.
  const fill = new Float32Array(N).fill(NaN), cells = [];
  let volume = 0, rim = 0, sx = 0, sz = 0;
  for (let j = 0; j < N; j++) {
    const depth = level[j] - top[j];
    if (depth > 0.5 && top[j] >= 0) {
      fill[j] = level[j]; cells.push(j);
      volume += depth * cell * cell;
      rim = Math.max(rim, level[j]);
      sx += j % nx; sz += Math.floor(j / nx);
    }
  }
  if (!cells.length) throw new Error("this mesh doesn't hold anything: it needs an open top and a floor. Check the up axis");
  // A spot near the middle of the hollow for "pour from one spot".
  const ci = sx / cells.length, ck = sz / cells.length;
  let spot = cells[0], best = Infinity;
  for (const j of cells) { const d2 = (j % nx - ci) ** 2 + (Math.floor(j / nx) - ck) ** 2; if (d2 < best) { best = d2; spot = j; } }
  return { cell, nx, nz, x0, z0, fill, floor: top, cells: Int32Array.from(cells), volume, rim, spot };
}

// Fill level of the hollow at (x, z), or NaN if that point isn't over the inside of the bin.
export function fillAt(m, x, z) {
  const i = Math.floor((x - m.x0) / m.cell), k = Math.floor((z - m.z0) / m.cell);
  if (i < 0 || k < 0 || i >= m.nx || k >= m.nz) return NaN;
  return m.fill[k * m.nx + i];
}

// Centre of a cell, with a random offset inside it.
export function cellPoint(m, j, jitter = true) {
  const i = j % m.nx, k = (j - i) / m.nx;
  const r = () => (jitter ? Math.random() - 0.5 : 0) * m.cell;
  return [m.x0 + (i + 0.5) * m.cell + r(), m.z0 + (k + 0.5) * m.cell + r()];
}
