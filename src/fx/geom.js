// ============================================================
// Geometrie-Helfer: Boxen mit abgeschraegten Kanten (Chamfer) und
// Verschmelzen vieler Boxen zu einer Geometrie mit Vertexfarben und
// per-Vertex PBR-Parametern (Metalness, Roughness, Emissive).
//
// Die Fasen fangen Licht an den Kanten ein - damit sehen Klotzmodelle
// nach echten Objekten aus statt nach Wuerfeln.
// ============================================================

import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _n = new THREE.Matrix3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _col = new THREE.Color();

// Flaechen: Normale n, Tangenten u, v mit u x v = n (CCW von aussen)
const FACES = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];
// Kanten: Paare von Achsen (a,b) mit Vorzeichen, dritte Achse ist die Kantenrichtung
const EDGES = [];
for (const [a, b, c] of [[0, 1, 2], [0, 2, 1], [1, 2, 0]]) {
  for (const sa of [1, -1]) for (const sb of [1, -1]) EDGES.push({ a, b, c, sa, sb });
}
const CORNERS = [];
for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) CORNERS.push([sx, sy, sz]);

/**
 * Box mit Fase, zentriert im Ursprung.
 * Rueckgabe: { pos: number[], nor: number[], idx: number[] }
 */
export function chamferBox(w, h, d, c) {
  const out = { pos: [], nor: [], idx: [] };
  const half = [w / 2, h / 2, d / 2];
  c = Math.min(c || 0, Math.min(w, h, d) * 0.32);

  const quad = (a, b, cc, dd, n) => {
    const base = out.pos.length / 3;
    for (const v of [a, b, cc, dd]) { out.pos.push(v[0], v[1], v[2]); out.nor.push(n[0], n[1], n[2]); }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const tri = (a, b, cc, n) => {
    const base = out.pos.length / 3;
    for (const v of [a, b, cc]) { out.pos.push(v[0], v[1], v[2]); out.nor.push(n[0], n[1], n[2]); }
    out.idx.push(base, base + 1, base + 2);
  };
  // Windung pruefen: geometrische Normale soll in Richtung n zeigen
  const orient = (pts, n) => {
    const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
    const bx = pts[2][0] - pts[0][0], by = pts[2][1] - pts[0][1], bz = pts[2][2] - pts[0][2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) pts.reverse();
    return pts;
  };

  // ---- Seitenflaechen (eingerueckt um c) ----
  for (const f of FACES) {
    const n = f.n, u = f.u, v = f.v;
    const axN = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const axU = u[0] !== 0 ? 0 : u[1] !== 0 ? 1 : 2;
    const axV = v[0] !== 0 ? 0 : v[1] !== 0 ? 1 : 2;
    const hu = half[axU] - c, hv = half[axV] - c, hn = half[axN];
    const P = (su, sv) => [
      n[0] * hn + u[0] * hu * su + v[0] * hv * sv,
      n[1] * hn + u[1] * hu * su + v[1] * hv * sv,
      n[2] * hn + u[2] * hu * su + v[2] * hv * sv,
    ];
    quad(P(-1, -1), P(1, -1), P(1, 1), P(-1, 1), n);
  }
  if (c <= 1e-6) return out;

  // ---- Kantenfasen ----
  for (const e of EDGES) {
    const { a, b, c: ax3, sa, sb } = e;
    const n = [0, 0, 0]; n[a] = sa; n[b] = sb;
    const l = Math.SQRT1_2; n[a] *= l; n[b] *= l;
    const hc = half[ax3] - c;
    const mk = (onA, s) => {   // Punkt auf Flaeche a (onA) oder b
      const p = [0, 0, 0];
      p[a] = onA ? sa * half[a] : sa * (half[a] - c);
      p[b] = onA ? sb * (half[b] - c) : sb * half[b];
      p[ax3] = s * hc;
      return p;
    };
    const pts = orient([mk(true, -1), mk(true, 1), mk(false, 1), mk(false, -1)], n);
    quad(pts[0], pts[1], pts[2], pts[3], n);
  }

  // ---- Eckdreiecke ----
  for (const s of CORNERS) {
    const n = [s[0] / Math.sqrt(3), s[1] / Math.sqrt(3), s[2] / Math.sqrt(3)];
    const px = [s[0] * half[0], s[1] * (half[1] - c), s[2] * (half[2] - c)];
    const py = [s[0] * (half[0] - c), s[1] * half[1], s[2] * (half[2] - c)];
    const pz = [s[0] * (half[0] - c), s[1] * (half[1] - c), s[2] * half[2]];
    const pts = orient([px, py, pz], n);
    tri(pts[0], pts[1], pts[2], n);
  }
  return out;
}

/** Farbe + PBR aus einem Teil lesen (Hex oder Materialobjekt {c,m,r,e}) */
export function partMaterial(color, defaults) {
  if (color !== null && typeof color === 'object') {
    return {
      c: color.c, m: color.m !== undefined ? color.m : 0, r: color.r !== undefined ? color.r : 0.8, e: color.e || 0,
    };
  }
  return { c: color, m: defaults ? defaults.m : 0, r: defaults ? defaults.r : 0.8, e: 0 };
}

/**
 * Mehrere Boxen {x,y,z,w,h,d,color,rot} zu einer Geometrie verschmelzen.
 * Attribute: position, normal, color (linear), aPBR (metalness, roughness, emissive)
 * opts: { chamfer: Fasenbreite, defaults: {m, r} }
 */
export function mergeBoxes(parts, opts) {
  const chamfer = opts && opts.chamfer !== undefined ? opts.chamfer : 0.006;
  const defaults = opts && opts.defaults;
  const pos = [], nor = [], col = [], pbr = [], idx = [];
  let base = 0;
  for (const p of parts) {
    const g = chamferBox(p.w, p.h, p.d, p.chamfer !== undefined ? p.chamfer : chamfer);
    const r = p.rot || null;
    _e.set(r ? (r.x || 0) : 0, r ? (r.y || 0) : 0, r ? (r.z || 0) : 0);
    _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e), _one);
    _n.getNormalMatrix(_m);
    const mat = partMaterial(p.color, defaults);
    _col.setHex(mat.c);
    const n = g.pos.length / 3;
    for (let i = 0; i < n; i++) {
      _v.set(g.pos[i * 3], g.pos[i * 3 + 1], g.pos[i * 3 + 2]).applyMatrix4(_m);
      pos.push(_v.x, _v.y, _v.z);
      _v.set(g.nor[i * 3], g.nor[i * 3 + 1], g.nor[i * 3 + 2]).applyMatrix3(_n).normalize();
      nor.push(_v.x, _v.y, _v.z);
      col.push(_col.r, _col.g, _col.b);
      pbr.push(mat.m, mat.r, mat.e);
    }
    for (let i = 0; i < g.idx.length; i++) idx.push(g.idx[i] + base);
    base += n;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aPBR', new THREE.Float32BufferAttribute(pbr, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
