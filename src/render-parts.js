// Display meshes for the built-in parts. These match the collision shapes in parts.js in size and
// body frame; threads and drive recesses are visual only.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { cleanDims } from "./parts.js";

const V2 = (x, y) => new THREE.Vector2(x, y);

// Clean up a piece so pieces can be merged: non-indexed, position + normal only.
function prep(g) {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== "position" && k !== "normal") n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}
const merge = (...gs) => mergeGeometries(gs.map(prep));

// Threaded shank profile from y0 (tip) up to y1, as lathe points.
// Threads are off by default: they are purely visual and multiply the triangle count.
let drawThreads = false;
export function setDrawThreads(on) { drawThreads = !!on; }

function threadProfile(pts, r, y0, y1) {
  if (!drawThreads) { pts.push(V2(r, y0 + Math.min(0.3, r * 0.15))); return; }   // plain shank, small tip chamfer
  const rMin = r * 0.82, pitch = Math.max(0.35, r * 0.33);
  let y = y0 + pitch * 0.5, out = true;
  while (y < y1 - pitch * 0.3) { pts.push(V2(out ? r : rMin, y)); y += pitch / 2; out = !out; }
}

function lathe(pts, seg = 24) {
  const g = new THREE.LatheGeometry(pts, seg);
  g.computeVertexNormals();
  return g;
}

function hexCylinder(af, h, y0) {
  const g = new THREE.CylinderGeometry(af / Math.sqrt(3), af / Math.sqrt(3), h, 6, 1);
  g.rotateY(Math.PI / 6);   // put a vertex on +X, matching the collider in parts.js
  g.translate(0, y0 + h / 2, 0);
  return g;
}

function cross(size, width, depth, top) {
  const a = new THREE.BoxGeometry(size, depth, width), b = new THREE.BoxGeometry(width, depth, size);
  const g = merge(a, b);
  g.translate(0, top - depth / 2 + 0.02, 0);
  return g;
}

// Returns { body, recess } geometries. `recess` is drawn dark (drive slot / socket / nut bore edge).
export function partGeometry(id, dims) {
  const d = cleanDims(id, dims);
  const empty = new THREE.BufferGeometry();
  switch (id) {
    case "pan": {
      const r0 = d.headD / 2, rs = d.shankD / 2, b = Math.max(0.05, Math.min(0.6, d.headH / 2 - 0.05, r0 - 0.05));
      const pts = [V2(0.001, -d.len), V2(rs * 0.82, -d.len)];
      threadProfile(pts, rs, -d.len, 0);
      pts.push(V2(rs, 0), V2(r0, 0), V2(r0, d.headH - b));
      for (let i = 1; i <= 6; i++) { const a = (i / 6) * (Math.PI / 2); pts.push(V2(r0 - b + b * Math.cos(a), d.headH - b + b * Math.sin(a))); }
      pts.push(V2(0.001, d.headH));
      return { body: lathe(pts), recess: cross(d.headD * 0.42, Math.max(0.35, d.headD * 0.09), 0.25, d.headH) };
    }
    case "flat": {
      const r0 = d.headD / 2, rs = d.shankD / 2;
      const pts = [V2(0.001, -d.len), V2(rs * 0.82, -d.len)];
      threadProfile(pts, rs, -d.len, -d.headH);
      pts.push(V2(rs, -d.headH), V2(r0, 0), V2(0.001, 0));
      return { body: lathe(pts), recess: cross(d.headD * 0.5, Math.max(0.35, d.headD * 0.09), 0.25, 0) };
    }
    case "socket": {
      const r0 = d.headD / 2, rs = d.shankD / 2, ch = Math.min(0.3, d.headH * 0.1);
      const pts = [V2(0.001, -d.len), V2(rs * 0.82, -d.len)];
      threadProfile(pts, rs, -d.len, 0);
      pts.push(V2(rs, 0), V2(r0, 0), V2(r0, d.headH - ch), V2(r0 - ch, d.headH), V2(0.001, d.headH));
      const sock = hexCylinder(d.headD * 0.43, 0.3, d.headH - 0.28);
      return { body: lathe(pts, 32), recess: sock };
    }
    case "hex": {
      const rs = d.shankD / 2;
      const pts = [V2(0.001, -d.len), V2(rs * 0.82, -d.len)];
      threadProfile(pts, rs, -d.len, 0);
      pts.push(V2(rs, 0), V2(0.001, 0));
      return { body: merge(lathe(pts), hexCylinder(d.flats, d.headH, 0)), recess: empty };
    }
    case "nut": {
      const R0 = d.flats / Math.sqrt(3), h = d.height;
      const shape = new THREE.Shape();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; shape[i ? "lineTo" : "moveTo"](R0 * Math.cos(a), R0 * Math.sin(a)); }
      const hole = new THREE.Path();
      hole.absarc(0, 0, d.holeD / 2, 0, Math.PI * 2, true);
      shape.holes.push(hole);
      const g = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false, curveSegments: 24 });
      g.rotateX(-Math.PI / 2);   // extrude along +Y, keeping the hexagon's vertex on +X
      g.translate(0, -h / 2, 0);
      return { body: g, recess: empty };
    }
    case "cube": return { body: new THREE.BoxGeometry(d.x, d.y, d.z), recess: empty };
    case "cylinder": return { body: new THREE.CylinderGeometry(d.dia / 2, d.dia / 2, d.len, 32), recess: empty };
    case "sphere": return { body: new THREE.SphereGeometry(d.dia / 2, 24, 16), recess: empty };
  }
  throw new Error(`Unknown part "${id}"`);
}
