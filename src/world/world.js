// ============================================================
// Welt: Geometrie-Bau, Kollision, Raycast, Navigation
// ============================================================

import * as THREE from 'three';
import { clamp, makeRng } from '../core/utils.js';

const EPS = 1e-4;

// Flaechen-Tint fuer den typischen Blockstil (oben hell, unten dunkel)
const FACE_TINT = { px: 0.90, nx: 0.82, py: 1.0, ny: 0.62, pz: 0.95, nz: 0.75 };

// ------------------------------------------------------------
// Prozedurale Textur: leichte Kante + Rauschen -> Blockoptik
// ------------------------------------------------------------
function makeBlockTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  // Rauschen
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = 246 + Math.random() * 9;
    d[i] = d[i + 1] = d[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  // Kanten
  g.strokeStyle = 'rgba(0,0,0,0.14)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  g.strokeStyle = 'rgba(0,0,0,0.05)';
  g.lineWidth = 1;
  g.strokeRect(4, 4, S - 8, S - 8);

  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ------------------------------------------------------------
// Box-Geometrie in Arrays anhaengen
// ------------------------------------------------------------
const FACES = [
  // dir, normal, 4 Eckpunkte (als Vorzeichen-Kombis), uv-Achsen
  { k: 'px', n: [1, 0, 0], v: [[1,0,1],[1,0,0],[1,1,0],[1,1,1]], ua: 'z', va: 'y' },
  { k: 'nx', n: [-1, 0, 0], v: [[0,0,0],[0,0,1],[0,1,1],[0,1,0]], ua: 'z', va: 'y' },
  { k: 'py', n: [0, 1, 0], v: [[0,1,1],[1,1,1],[1,1,0],[0,1,0]], ua: 'x', va: 'z' },
  { k: 'ny', n: [0, -1, 0], v: [[0,0,0],[1,0,0],[1,0,1],[0,0,1]], ua: 'x', va: 'z' },
  { k: 'pz', n: [0, 0, 1], v: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], ua: 'x', va: 'y' },
  { k: 'nz', n: [0, 0, -1], v: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], ua: 'x', va: 'y' },
];

function pushBox(A, min, max, color, uvScale, tint) {
  const size = { x: max.x - min.x, y: max.y - min.y, z: max.z - min.z };
  for (const f of FACES) {
    const t = tint ? FACE_TINT[f.k] : 1;
    const r = ((color >> 16) & 255) / 255 * t;
    const g = ((color >> 8) & 255) / 255 * t;
    const b = (color & 255) / 255 * t;
    const base = A.pos.length / 3;
    for (const v of f.v) {
      A.pos.push(
        v[0] ? max.x : min.x,
        v[1] ? max.y : min.y,
        v[2] ? max.z : min.z
      );
      A.nor.push(f.n[0], f.n[1], f.n[2]);
      A.col.push(r, g, b);
      A.uv.push(0, 0); // wird gleich ueberschrieben
    }
    // UVs in Weltmass
    const uSize = size[f.ua] * uvScale;
    const vSize = size[f.va] * uvScale;
    const uvIdx = base * 2;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      A.uv[uvIdx + i * 2] = corners[i][0] * uSize;
      A.uv[uvIdx + i * 2 + 1] = corners[i][1] * vSize;
    }
    A.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

function buildGeometry(arrays) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arrays.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(arrays.col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  g.setIndex(arrays.idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------
// Binaerer Min-Heap fuer A*
// ------------------------------------------------------------
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  clear() { this.a.length = 0; }
  push(node, f) {
    const a = this.a;
    a.push({ node, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t;
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let s = i;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        const t = a[s]; a[s] = a[i]; a[i] = t;
        i = s;
      }
    }
    return top.node;
  }
}

// ============================================================
export class World {
  constructor(scene, mapDef) {
    this.scene = scene;
    this.map = mapDef;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.colliders = [];   // {minx,miny,minz,maxx,maxy,maxz, cx,cy,cz, rad}
    this.cell = 8;         // Broadphase-Zellgroesse
    this.grid = new Map();

    this.navCell = 1.8;
    this.nav = null;

    this._buildMeshes();
    this._buildBroadphase();
    this._buildNav();
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
    this.scene.remove(this.group);
  }

  // --------------------------------------------------------
  _buildMeshes() {
    const map = this.map;
    const solid = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const glow = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const rng = makeRng(1337);

    for (const box of map.boxes) {
      const min = { x: box.cx - box.w / 2, y: box.by, z: box.cz - box.d / 2 };
      const max = { x: box.cx + box.w / 2, y: box.by + box.h, z: box.cz + box.d / 2 };

      // Leichte Farbvariation je Box
      let color = box.color;
      if (!box.emissive) {
        const j = 0.94 + rng() * 0.12;
        const r = clamp(Math.round(((color >> 16) & 255) * j), 0, 255);
        const g = clamp(Math.round(((color >> 8) & 255) * j), 0, 255);
        const b = clamp(Math.round((color & 255) * j), 0, 255);
        color = (r << 16) | (g << 8) | b;
      }

      if (box.emissive) pushBox(glow, min, max, box.color, 0.25, false);
      else pushBox(solid, min, max, color, 0.25, true);

      if (!box.noCollide) {
        this.colliders.push({
          minx: min.x, miny: min.y, minz: min.z,
          maxx: max.x, maxy: max.y, maxz: max.z,
          cx: box.cx, cy: box.by + box.h / 2, cz: box.cz,
          rad: Math.sqrt(box.w * box.w + box.h * box.h + box.d * box.d) * 0.5,
        });
      }
    }

    this.blockTex = makeBlockTexture();

    const matSolid = new THREE.MeshLambertMaterial({
      vertexColors: true, map: this.blockTex,
    });
    this.meshSolid = new THREE.Mesh(buildGeometry(solid), matSolid);
    this.meshSolid.castShadow = true;
    this.meshSolid.receiveShadow = true;
    this.group.add(this.meshSolid);

    if (glow.pos.length) {
      const matGlow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      this.meshGlow = new THREE.Mesh(buildGeometry(glow), matGlow);
      this.group.add(this.meshGlow);
    }

    this._buildSky();
    this._buildSkyline();
  }

  _buildSky() {
    const map = this.map;
    const geo = new THREE.SphereGeometry(600, 24, 16);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const top = new THREE.Color(map.skyTop);
    const bot = new THREE.Color(map.skyBottom);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = clamp((pos.getY(i) / 600) * 0.5 + 0.5, 0, 1);
      c.copy(bot).lerp(top, Math.pow(t, 0.65));
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    });
    this.sky = new THREE.Mesh(geo, mat);
    this.sky.renderOrder = -1000;
    this.group.add(this.sky);
  }

  /** Ferne Silhouetten ausserhalb der Arena fuer Tiefenwirkung */
  _buildSkyline() {
    const map = this.map;
    const rng = makeRng(4242);
    const A = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const half = (map.size || 120) / 2;
    const base = new THREE.Color(map.fogColor);
    for (let i = 0; i < 90; i++) {
      const ang = (i / 90) * Math.PI * 2 + rng() * 0.05;
      const dist = half + 40 + rng() * 130;
      const x = Math.cos(ang) * dist;
      const z = Math.sin(ang) * dist;
      const w = 14 + rng() * 40;
      const h = 12 + rng() * 62;
      const shade = 0.55 + rng() * 0.3;
      const col = new THREE.Color(base.r * shade, base.g * shade, base.b * shade);
      const hex = (Math.round(col.r * 255) << 16) | (Math.round(col.g * 255) << 8) | Math.round(col.b * 255);
      pushBox(A, { x: x - w / 2, y: -6, z: z - w / 2 }, { x: x + w / 2, y: h, z: z + w / 2 }, hex, 0.15, true);
    }
    const mesh = new THREE.Mesh(
      buildGeometry(A),
      new THREE.MeshBasicMaterial({ vertexColors: true, fog: true })
    );
    mesh.renderOrder = -900;
    this.group.add(mesh);
  }

  // --------------------------------------------------------
  // Broadphase
  // --------------------------------------------------------
  _key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }

  _buildBroadphase() {
    const cs = this.cell;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      const x0 = Math.floor(c.minx / cs), x1 = Math.floor(c.maxx / cs);
      const z0 = Math.floor(c.minz / cs), z1 = Math.floor(c.maxz / cs);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = this._key(ix, iz);
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(c);
        }
      }
    }
    this._queryMark = new Int32Array(this.colliders.length);
    for (let i = 0; i < this.colliders.length; i++) this.colliders[i]._i = i;
    this._queryStamp = 0;
  }

  /** Alle Collider, die die AABB beruehren koennten */
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const cs = this.cell;
    const stamp = ++this._queryStamp;
    const x0 = Math.floor(minx / cs), x1 = Math.floor(maxx / cs);
    const z0 = Math.floor(minz / cs), z1 = Math.floor(maxz / cs);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (this._queryMark[c._i] === stamp) continue;
          this._queryMark[c._i] = stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  // --------------------------------------------------------
  // Raycast gegen alle Weltboxen (Slab-Test)
  // --------------------------------------------------------
  /**
   * @returns null oder {t, x,y,z, nx,ny,nz}
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let bestT = maxDist;
    let bnx = 0, bny = 0, bnz = 0;
    let hit = false;

    const invx = dx !== 0 ? 1 / dx : Infinity;
    const invy = dy !== 0 ? 1 / dy : Infinity;
    const invz = dz !== 0 ? 1 / dz : Infinity;

    const list = this.colliders;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      // Schnellverwerfung: Abstand Strahl <-> Boxmittelpunkt
      const mx = c.cx - ox, my = c.cy - oy, mz = c.cz - oz;
      const proj = mx * dx + my * dy + mz * dz;
      if (proj < -c.rad || proj > bestT + c.rad) continue;
      const px = mx - dx * proj, py = my - dy * proj, pz = mz - dz * proj;
      if (px * px + py * py + pz * pz > c.rad * c.rad) continue;

      let tmin = 0, tmax = bestT;
      let ax = -1, sgn = 0;

      let t1 = (c.minx - ox) * invx, t2 = (c.maxx - ox) * invx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; ax = 0; sgn = dx > 0 ? -1 : 1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      t1 = (c.miny - oy) * invy; t2 = (c.maxy - oy) * invy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; ax = 1; sgn = dy > 0 ? -1 : 1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      t1 = (c.minz - oz) * invz; t2 = (c.maxz - oz) * invz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) { tmin = t1; ax = 2; sgn = dz > 0 ? -1 : 1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;

      if (tmin >= 0 && tmin < bestT) {
        bestT = tmin;
        bnx = ax === 0 ? sgn : 0;
        bny = ax === 1 ? sgn : 0;
        bnz = ax === 2 ? sgn : 0;
        hit = true;
      }
    }

    if (!hit) return null;
    return {
      t: bestT,
      x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT,
      nx: bnx, ny: bny, nz: bnz,
    };
  }

  /** Freie Sichtlinie zwischen zwei Punkten? */
  losClear(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-5) return true;
    const h = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 0.05);
    return h === null;
  }

  // --------------------------------------------------------
  // Kollision fuer Akteure (AABB, Achse fuer Achse)
  // --------------------------------------------------------
  /**
   * Ist der Box-Raum frei?
   * eps toleriert winzige Ueberlappungen (Stufenkanten ueberlappen sich
   * bewusst leicht, damit keine Ritzen entstehen).
   */
  isFree(x, y, z, r, h, eps) {
    const list = this._tmpList || (this._tmpList = []);
    this.query(x - r, z - r, x + r, z + r, list);
    return this._freeIn(list, x, y, z, r, h, eps);
  }

  /**
   * Bewegt eine Akteur-AABB um delta und loest Kollisionen auf.
   * actor: {x,y,z} wird mutiert.
   * @returns {ground:boolean, ceiling:boolean, wallX:boolean, wallZ:boolean, stepped:number}
   */
  moveActor(p, dx, dy, dz, r, h, stepH) {
    const res = { ground: false, ceiling: false, wallX: false, wallZ: false, stepped: 0 };
    const list = this._tmpList2 || (this._tmpList2 = []);

    // ---------- X ----------
    if (dx !== 0) {
      p.x += dx;
      this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1, list);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (p.x + r <= c.minx + EPS || p.x - r >= c.maxx - EPS) continue;
        if (p.y + h <= c.miny + EPS || p.y >= c.maxy - EPS) continue;
        if (p.z + r <= c.minz + EPS || p.z - r >= c.maxz - EPS) continue;
        // Stufe hochsteigen?
        const rise = c.maxy - p.y;
        if (stepH > 0 && rise > 0.01 && rise <= stepH && this.isFree(p.x, c.maxy + 0.02, p.z, r, h)) {
          p.y = c.maxy + 0.02; res.stepped = rise; res.ground = true; continue;
        }
        p.x = dx > 0 ? c.minx - r - EPS : c.maxx + r + EPS;
        res.wallX = true;
      }
    }

    // ---------- Z ----------
    if (dz !== 0) {
      p.z += dz;
      this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1, list);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (p.z + r <= c.minz + EPS || p.z - r >= c.maxz - EPS) continue;
        if (p.y + h <= c.miny + EPS || p.y >= c.maxy - EPS) continue;
        if (p.x + r <= c.minx + EPS || p.x - r >= c.maxx - EPS) continue;
        const rise = c.maxy - p.y;
        if (stepH > 0 && rise > 0.01 && rise <= stepH && this.isFree(p.x, c.maxy + 0.02, p.z, r, h)) {
          p.y = c.maxy + 0.02; res.stepped = rise; res.ground = true; continue;
        }
        p.z = dz > 0 ? c.minz - r - EPS : c.maxz + r + EPS;
        res.wallZ = true;
      }
    }

    // ---------- Y ----------
    if (dy !== 0) {
      p.y += dy;
      this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1, list);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (p.y + h <= c.miny + EPS || p.y >= c.maxy - EPS) continue;
        if (p.x + r <= c.minx + EPS || p.x - r >= c.maxx - EPS) continue;
        if (p.z + r <= c.minz + EPS || p.z - r >= c.maxz - EPS) continue;
        if (dy < 0) { p.y = c.maxy + EPS; res.ground = true; }
        else { p.y = c.miny - h - EPS; res.ceiling = true; }
      }
    }

    // Bodenkontakt auch ohne Abwaertsbewegung pruefen
    if (!res.ground) {
      if (!this.isFree(p.x, p.y - 0.08, p.z, r, 0.06)) res.ground = true;
    }
    return res;
  }

  /** Hoehe des Bodens unter einem Punkt (fuer Spawns / Nav) */
  groundAt(x, z, fromY = 80) {
    const h = this.raycast(x, fromY, z, 0, -1, 0, fromY + 20);
    return h ? h.y : 0;
  }

  // --------------------------------------------------------
  // Navigation: mehrstoeckiges Gitter + A*
  // --------------------------------------------------------
  /**
   * Kopffreiheit ueber einer Standflaeche.
   * Alles, dessen Oberkante hoechstens stepUp ueber der Flaeche liegt, ist
   * ersteigbar und damit KEIN Hindernis - genau das braucht man auf Treppen,
   * wo die naechste Stufe sonst jeden Knoten verwerfen wuerde.
   */
  _headFree(list, x, y, z, r, h, stepUp, eps) {
    const e = eps === undefined ? EPS : eps;
    const minx = x - r, maxx = x + r, minz = z - r, maxz = z + r;
    const miny = y + stepUp, maxy = y + h;
    if (maxy <= miny) return true;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxy <= y + stepUp) continue;              // ersteigbar
      if (maxx > c.minx + e && minx < c.maxx - e &&
          maxy > c.miny + e && miny < c.maxy - e &&
          maxz > c.minz + e && minz < c.maxz - e) return false;
    }
    return true;
  }

  headFree(x, y, z, r, h, stepUp, eps) {
    const list = this._tmpList3 || (this._tmpList3 = []);
    this.query(x - r, z - r, x + r, z + r, list);
    return this._headFree(list, x, y, z, r, h, stepUp, eps);
  }

  /** isFree-Variante, die eine bereits abgefragte Collider-Liste nutzt */
  _freeIn(list, x, y, z, r, h, eps) {
    const e = eps === undefined ? EPS : eps;
    const minx = x - r, maxx = x + r, minz = z - r, maxz = z + r;
    const miny = y, maxy = y + h;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (maxx > c.minx + e && minx < c.maxx - e &&
          maxy > c.miny + e && miny < c.maxy - e &&
          maxz > c.minz + e && minz < c.maxz - e) return false;
    }
    return true;
  }

  _buildNav() {
    const cs = this.navCell;
    const half = (this.map.size || 120) / 2 - 1.5;
    const n = Math.floor((half * 2) / cs);
    const AGENT_H = 2.1;
    const AGENT_R = 0.5;
    // Drei verschiedene Radien, sonst funktionieren Treppen nicht:
    //  SURF_R  - nur die Flaeche direkt unter der Zellmitte finden
    //  CLEAR_R - Kopffreiheit ueber dieser Flaeche (schmal, damit die
    //            naechsthoehere Stufe den Knoten nicht verwirft)
    //  LINK_R  - Durchgangsbreite zwischen zwei Knoten (voller Spielerradius)
    const SURF_R = 0.18;
    const CLEAR_R = 0.45;
    const LINK_R = 0.5;
    const NAV_EPS = 0.07;
    const MAX_LEVELS = 3;
    const STEP_UP = 1.2;
    const MAX_DROP = 7.5;

    const nodes = [];
    const cellNodes = new Array(n * n);
    const list = [];
    const tops = [];

    // ---- Knoten: begehbare Oberflaechen je Zelle (mehrstoeckig) ----
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -half + cs * (ix + 0.5);
        const z = -half + cs * (iz + 0.5);
        // Eine Abfrage pro Zelle; die Freiraumtests nutzen dieselbe Liste.
        this.query(x - AGENT_R, z - AGENT_R, x + AGENT_R, z + AGENT_R, list);

        tops.length = 0;
        tops.push(0);
        for (let i = 0; i < list.length; i++) {
          const c = list[i];
          if (x + SURF_R <= c.minx || x - SURF_R >= c.maxx) continue;
          if (z + SURF_R <= c.minz || z - SURF_R >= c.maxz) continue;
          if (c.maxy > 0.05 && c.maxy < 60) tops.push(c.maxy);
        }
        tops.sort((a, b) => b - a);

        const cellArr = [];
        let last = Infinity;
        for (let k = 0; k < tops.length; k++) {
          const y = tops[k];
          if (last - y < 0.6) continue;
          last = y;
          // Nicht in Geometrie stecken ...
          if (!this._freeIn(list, x, y + 0.05, z, SURF_R, 0.4, 0.02)) continue;
          // ... und genug Platz nach oben (Stufen bis STEP_UP zaehlen nicht)
          if (!this._headFree(list, x, y, z, CLEAR_R, AGENT_H, STEP_UP, NAV_EPS)) continue;
          // Echte Standflaeche? (direkt darunter muss etwas sein)
          if (y > 0.05 && this._freeIn(list, x, y - 0.14, z, SURF_R, 0.1, 0.02)) continue;
          const node = { id: nodes.length, x, y, z, ix, iz, nb: [], links: null };
          nodes.push(node);
          cellArr.push(node);
          if (cellArr.length >= MAX_LEVELS) break;
        }
        cellNodes[iz * n + ix] = cellArr;
      }
    }

    // ---- Durchgang zwischen zwei Knoten frei? ----
    const passable = (a, b) => {
      const dy = b.y - a.y;
      if (dy > STEP_UP || dy < -MAX_DROP) return -1;
      const my = Math.max(a.y, b.y);
      if (!this.headFree((a.x + b.x) / 2, my, (a.z + b.z) / 2, LINK_R, AGENT_H, STEP_UP, NAV_EPS)) return -1;
      return Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(dy) * 1.4 + (dy < -1.5 ? 2.5 : 0);
    };

    // ---- Durchgang 1: gerade Nachbarn ----
    const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      a.links = new Set();
      for (let d = 0; d < 4; d++) {
        const jx = a.ix + ORTHO[d][0], jz = a.iz + ORTHO[d][1];
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        const arr = cellNodes[jz * n + jx];
        if (!arr || !arr.length) continue;
        for (let k = 0; k < arr.length; k++) {
          const cost = passable(a, arr[k]);
          if (cost < 0) continue;
          a.nb.push({ n: arr[k], c: cost });
          a.links.add(jz * n + jx);
        }
      }
    }

    // ---- Durchgang 2: Diagonalen nur, wenn beide geraden Wege offen sind ----
    const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let d = 0; d < 4; d++) {
        const ox = DIAG[d][0], oz = DIAG[d][1];
        const jx = a.ix + ox, jz = a.iz + oz;
        if (jx < 0 || jz < 0 || jx >= n || jz >= n) continue;
        if (!a.links.has(a.iz * n + jx)) continue;
        if (!a.links.has(jz * n + a.ix)) continue;
        const arr = cellNodes[jz * n + jx];
        if (!arr || !arr.length) continue;
        for (let k = 0; k < arr.length; k++) {
          const cost = passable(a, arr[k]);
          if (cost < 0) continue;
          a.nb.push({ n: arr[k], c: cost * 0.99 });
        }
      }
      a.links = null;
    }

    this.nav = {
      nodes, cellNodes, n, cs, half,
      gScore: new Float32Array(nodes.length),
      fScore: new Float32Array(nodes.length),
      came: new Int32Array(nodes.length),
      state: new Int32Array(nodes.length),
      stamp: 0,
      heap: new Heap(),
    };
  }

  /** Naechstgelegener Nav-Knoten */
  nearestNode(x, y, z) {
    const nav = this.nav;
    if (!nav) return null;
    const ix = clamp(Math.floor((x + nav.half) / nav.cs), 0, nav.n - 1);
    const iz = clamp(Math.floor((z + nav.half) / nav.cs), 0, nav.n - 1);
    let best = null, bestD = Infinity;
    for (let r = 0; r <= 3 && !best; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const jx = ix + dx, jz = iz + dz;
          if (jx < 0 || jz < 0 || jx >= nav.n || jz >= nav.n) continue;
          const arr = nav.cellNodes[jz * nav.n + jx];
          if (!arr) continue;
          for (const nd of arr) {
            const d = (nd.x - x) ** 2 + (nd.z - z) ** 2 + (nd.y - y) ** 2 * 3;
            if (d < bestD) { bestD = d; best = nd; }
          }
        }
      }
      if (best && r >= 1) break;
    }
    return best;
  }

  /**
   * A*-Pfad. Gibt Array von {x,y,z} zurueck (ohne Startknoten) oder null.
   */
  findPath(sx, sy, sz, tx, ty, tz, maxNodes = 2600) {
    const nav = this.nav;
    if (!nav) return null;
    const start = this.nearestNode(sx, sy, sz);
    const goal = this.nearestNode(tx, ty, tz);
    if (!start || !goal) return null;
    if (start === goal) return [{ x: tx, y: ty, z: tz }];

    const { gScore, came, state, heap } = nav;
    const stamp = ++nav.stamp;
    heap.clear();

    const H = (a) => Math.hypot(a.x - goal.x, a.z - goal.z) + Math.abs(a.y - goal.y) * 1.2;

    gScore[start.id] = 0;
    came[start.id] = -1;
    state[start.id] = stamp;
    heap.push(start, H(start));

    let expanded = 0;
    const closed = nav.state2 || (nav.state2 = new Int32Array(nav.nodes.length));

    while (heap.size) {
      const cur = heap.pop();
      if (closed[cur.id] === stamp) continue;
      closed[cur.id] = stamp;
      if (cur === goal) break;
      if (++expanded > maxNodes) break;

      for (let i = 0; i < cur.nb.length; i++) {
        const e = cur.nb[i];
        const nb = e.n;
        if (closed[nb.id] === stamp) continue;
        const g = gScore[cur.id] + e.c;
        if (state[nb.id] === stamp && gScore[nb.id] <= g) continue;
        state[nb.id] = stamp;
        gScore[nb.id] = g;
        came[nb.id] = cur.id;
        heap.push(nb, g + H(nb));
      }
    }

    if (closed[goal.id] !== stamp) return null;

    const path = [];
    let id = goal.id;
    let guard = 0;
    while (id !== -1 && guard++ < 4000) {
      const nd = nav.nodes[id];
      path.push({ x: nd.x, y: nd.y, z: nd.z });
      if (id === start.id) break;
      id = came[id];
    }
    path.reverse();
    path.shift();                       // Startknoten weglassen
    path.push({ x: tx, y: ty, z: tz }); // exaktes Ziel anhaengen
    return path;
  }

  /** Zufaellige, begehbare Position (fuer Bot-Wandern) */
  randomNavPoint() {
    const nav = this.nav;
    if (!nav || !nav.nodes.length) return { x: 0, y: 0, z: 0 };
    const nd = nav.nodes[(Math.random() * nav.nodes.length) | 0];
    return { x: nd.x, y: nd.y, z: nd.z };
  }
}
