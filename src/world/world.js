// ============================================================
// Welt: Geometrie-Bau (abgeschraegte Boxen, PBR-Material), Himmel mit
// Sonne, Umgebungslicht, Kollision, Raycast (Grid-DDA), Navigation
// ============================================================

import * as THREE from 'three';
import { clamp, makeRng } from '../core/utils.js';
import { chamferBox } from '../fx/geom.js';
import { makeWorldMaterial, makeSkyMaterial, buildEnvironment, unregisterMaterial } from '../fx/materials.js';

const EPS = 1e-4;
const _col = new THREE.Color();

// ------------------------------------------------------------
// Box (mit Fase) in Arrays anhaengen: Weltkoordinaten, Farbtint nach
// Normale (oben hell, unten dunkel), UVs planar in Weltmass
// ------------------------------------------------------------
function pushBox(A, min, max, color, uvScale, tint, skipBottom, chamfer, hdr) {
  const w = max.x - min.x, h = max.y - min.y, d = max.z - min.z;
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
  const g = chamferBox(w, h, d, chamfer);
  _col.setHex(color);
  const mul = hdr || 1;
  const base = A.pos.length / 3;
  const n = g.pos.length / 3;
  const ny = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const px = g.pos[i * 3] + cx, py = g.pos[i * 3 + 1] + cy, pz = g.pos[i * 3 + 2] + cz;
    const nx = g.nor[i * 3], nyy = g.nor[i * 3 + 1], nz = g.nor[i * 3 + 2];
    ny[i] = nyy;
    A.pos.push(px, py, pz);
    A.nor.push(nx, nyy, nz);
    const t = tint ? (0.80 + 0.20 * nyy) : 1;
    A.col.push(_col.r * t * mul, _col.g * t * mul, _col.b * t * mul);
    const ax = Math.abs(nx), ay = Math.abs(nyy), az = Math.abs(nz);
    if (ax >= ay && ax >= az) A.uv.push(pz * uvScale, py * uvScale);
    else if (ay >= az) A.uv.push(px * uvScale, pz * uvScale);
    else A.uv.push(px * uvScale, py * uvScale);
  }
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = g.idx[i], b = g.idx[i + 1], c = g.idx[i + 2];
    if (skipBottom && ny[a] < -0.99 && ny[b] < -0.99 && ny[c] < -0.99) continue;
    A.idx.push(a + base, b + base, c + base);
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
  g.computeBoundingBox();
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
  constructor(scene, mapDef, renderer) {
    this.scene = scene;
    this.map = mapDef;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.colliders = [];   // {minx,miny,minz,maxx,maxy,maxz, cx,cy,cz, rad, dead, destr}
    this.destructibles = [];   // Collider mit destr-Daten (Kisten, Faesser, Glas)
    this.cell = 8;         // Broadphase-Zellgroesse
    this.grid = new Map();

    this.navCell = 1.8;
    this.nav = null;
    this.envRT = null;

    this._buildMeshes();
    this._buildBroadphase();
    this._buildNav();
  }

  // --------------------------------------------------------
  // Zerstoerbare Objekte: eigene Meshes, Collider werden per `dead` abgeschaltet
  // --------------------------------------------------------
  _buildDestructible(box, min, max, material) {
    const A = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const glass = box.destr.type === 'glass';
    const minDim = Math.min(box.w, box.h, box.d);
    pushBox(A, min, max, box.color, 0.25, !glass, false, clamp(minDim * 0.08, 0.01, 0.06), 1);
    let mat = material;
    if (glass) {
      if (!this._glassMat) {
        this._glassMat = new THREE.MeshStandardMaterial({
          vertexColors: true, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.15,
          envMapIntensity: 0.9, depthWrite: false, side: THREE.DoubleSide,
        });
      }
      mat = this._glassMat;
    }
    const mesh = new THREE.Mesh(buildGeometry(A), mat);
    mesh.castShadow = !glass;
    mesh.receiveShadow = true;
    if (glass) mesh.renderOrder = 4;
    this.group.add(mesh);
    return mesh;
  }

  /** Durchscheinende Box (Wasser, Wasserfall): eigenes Mesh mit Transparenz */
  _buildTranslucent(box, min, max) {
    const A = { pos: [], nor: [], col: [], uv: [], idx: [] };
    pushBox(A, min, max, box.color, 0.25, false, false, 0.01, 1 + (box.emissive || 0) * 1.2);
    const key = box.alpha + '|' + (box.emissive || 0);
    if (!this._transMats) this._transMats = new Map();
    let mat = this._transMats.get(key);
    if (!mat) {
      mat = new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: box.alpha, roughness: 0.15, metalness: 0.05,
        envMapIntensity: 0.8, depthWrite: false, side: THREE.DoubleSide,
        emissive: new THREE.Color(0xffffff), emissiveIntensity: (box.emissive || 0) * 0.4,
      });
      this._transMats.set(key, mat);
    }
    const mesh = new THREE.Mesh(buildGeometry(A), mat);
    mesh.renderOrder = 3;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Schaden an einem zerstoerbaren Collider; true, wenn er dabei zerstoert wurde */
  damageDestructible(c, dmg) {
    if (!c || !c.destr || c.dead) return false;
    c.destr.hp -= dmg;
    if (c.destr.hp > 0) return false;
    c.dead = true;
    c.destr.mesh.visible = false;
    c.destr.respawnT = c.destr.respawn;
    return true;
  }

  /** Zerstoerte Objekte nach einer Weile wieder aufbauen (wenn niemand drinsteht) */
  updateDestructibles(dt, actors) {
    for (let i = 0; i < this.destructibles.length; i++) {
      const c = this.destructibles[i];
      if (!c.dead) continue;
      c.destr.respawnT -= dt;
      if (c.destr.respawnT > 0) continue;
      let blocked = false;
      for (const a of actors) {
        if (!a.alive) continue;
        if (a.pos.x + a.radius > c.minx && a.pos.x - a.radius < c.maxx &&
            a.pos.z + a.radius > c.minz && a.pos.z - a.radius < c.maxz &&
            a.pos.y + a.height > c.miny && a.pos.y < c.maxy) { blocked = true; break; }
      }
      if (blocked) { c.destr.respawnT = 2; continue; }
      c.dead = false;
      c.destr.hp = c.destr.maxHp;
      c.destr.mesh.visible = true;
    }
  }

  /** Zerstoerbare Objekte im Umkreis (fuer Explosionen) */
  destructiblesNear(x, y, z, r, out) {
    out.length = 0;
    for (let i = 0; i < this.destructibles.length; i++) {
      const c = this.destructibles[i];
      if (c.dead) continue;
      const dx = Math.max(c.minx - x, 0, x - c.maxx), dy = Math.max(c.miny - y, 0, y - c.maxy), dz = Math.max(c.minz - z, 0, z - c.maxz);
      if (dx * dx + dy * dy + dz * dz <= r * r) out.push(c);
    }
    return out;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (!o.material.userData.sharedTextures) {
          if (o.material.map) o.material.map.dispose();
          if (o.material.normalMap) o.material.normalMap.dispose();
          if (o.material.roughnessMap) o.material.roughnessMap.dispose();
        }
        unregisterMaterial(o.material);
        o.material.dispose();
      }
    });
    this.scene.remove(this.group);
    if (this._glassMat) { this._glassMat.dispose(); this._glassMat = null; }
    if (this._transMats) { for (const m of this._transMats.values()) m.dispose(); this._transMats = null; }
    if (this.envRT) { this.envRT.dispose(); this.envRT = null; }
    this.scene.environment = null;
  }

  // --------------------------------------------------------
  _buildMeshes() {
    const map = this.map;
    const solid = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const glow = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const rng = makeRng(1337);

    const matSolid = makeWorldMaterial();
    const pendingDestr = [];

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

      const minDim = Math.min(box.w, box.h, box.d);
      const chamfer = clamp(minDim * 0.08, 0.02, 0.09);
      if (box.destr) { /* eigenes Mesh, siehe unten */ }
      else if (box.alpha) this._buildTranslucent(box, min, max);
      else if (box.emissive) pushBox(glow, min, max, box.color, 0.25, false, box.by <= 0.001, chamfer * 0.5, 1.4 + box.emissive * 1.6);
      else pushBox(solid, min, max, color, 0.25, true, box.by <= 0.001, chamfer, 1);

      if (!box.noCollide) {
        const c = {
          minx: min.x, miny: min.y, minz: min.z,
          maxx: max.x, maxy: max.y, maxz: max.z,
          cx: box.cx, cy: box.by + box.h / 2, cz: box.cz,
          rad: Math.sqrt(box.w * box.w + box.h * box.h + box.d * box.d) * 0.5,
          surface: box.surface || 'stone',
          dead: false, destr: null,
          _i: 0,
        };
        if (box.destr) {
          c.destr = {
            type: box.destr.type, hp: box.destr.hp, maxHp: box.destr.hp, explode: !!box.destr.explode,
            respawn: box.destr.respawn || 40, respawnT: 0, color: box.color,
            w: box.w, h: box.h, d: box.d, mesh: this._buildDestructible(box, min, max, matSolid),
          };
          this.destructibles.push(c);
        }
        this.colliders.push(c);
      }
    }

    this.meshSolid = new THREE.Mesh(buildGeometry(solid), matSolid);
    this.meshSolid.castShadow = true;
    this.meshSolid.receiveShadow = true;
    this.meshSolid.frustumCulled = false;
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
    const geo = new THREE.SphereGeometry(600, 32, 20);
    this.skyMat = makeSkyMaterial(map);
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    // Umgebungslicht aus dem Himmel (Reflexionen auf Metall, weiches Licht)
    if (this.renderer) {
      this.envRT = buildEnvironment(this.renderer, this.skyMat);
      this.scene.environment = this.envRT.texture;
    }
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
      const shade = 0.45 + rng() * 0.3;
      const col = new THREE.Color(base.r * shade, base.g * shade, base.b * shade);
      const hex = (Math.round(col.r * 255) << 16) | (Math.round(col.g * 255) << 8) | Math.round(col.b * 255);
      pushBox(A, { x: x - w / 2, y: -6, z: z - w / 2 }, { x: x + w / 2, y: h, z: z + w / 2 }, hex, 0.15, true, true, 0, 1);
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
    let gx0 = Infinity, gx1 = -Infinity, gz0 = Infinity, gz1 = -Infinity;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      c._i = i;
      const x0 = Math.floor(c.minx / cs), x1 = Math.floor(c.maxx / cs);
      const z0 = Math.floor(c.minz / cs), z1 = Math.floor(c.maxz / cs);
      if (x0 < gx0) gx0 = x0; if (x1 > gx1) gx1 = x1;
      if (z0 < gz0) gz0 = z0; if (z1 > gz1) gz1 = z1;
      for (let ix = x0; ix <= x1; ix++) {
        for (let iz = z0; iz <= z1; iz++) {
          const k = this._key(ix, iz);
          let arr = this.grid.get(k);
          if (!arr) { arr = []; this.grid.set(k, arr); }
          arr.push(c);
        }
      }
    }
    this.gx0 = gx0; this.gx1 = gx1; this.gz0 = gz0; this.gz1 = gz1;
    this._queryMark = new Int32Array(this.colliders.length);
    this._queryStamp = 0;
    this._rayMark = new Int32Array(this.colliders.length);
    this._rayStamp = 0;
  }

  /** Alle Collider, die die AABB beruehren koennten */
  query(minx, minz, maxx, maxz, out) {
    out.length = 0;
    const cs = this.cell;
    const stamp = ++this._queryStamp;
    const mark = this._queryMark;
    const x0 = Math.max(this.gx0, Math.floor(minx / cs)), x1 = Math.min(this.gx1, Math.floor(maxx / cs));
    const z0 = Math.max(this.gz0, Math.floor(minz / cs)), z1 = Math.min(this.gz1, Math.floor(maxz / cs));
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const arr = this.grid.get(this._key(ix, iz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          if (mark[c._i] === stamp) continue;
          mark[c._i] = stamp;
          if (c.dead) continue;
          out.push(c);
        }
      }
    }
    return out;
  }

  // --------------------------------------------------------
  // Raycast: 2D-Grid-Traversal (DDA) ueber die Broadphase-Zellen
  // --------------------------------------------------------
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let bestT = maxDist;
    let bnx = 0, bny = 0, bnz = 0;
    let hit = false;
    let bestC = null;

    const invx = dx !== 0 ? 1 / dx : 1e30;
    const invy = dy !== 0 ? 1 / dy : 1e30;
    const invz = dz !== 0 ? 1 / dz : 1e30;

    const cs = this.cell;
    const grid = this.grid;
    const mark = this._rayMark;
    const stamp = ++this._rayStamp;
    const gx0 = this.gx0, gx1 = this.gx1, gz0 = this.gz0, gz1 = this.gz1;

    let ix = Math.floor(ox / cs), iz = Math.floor(oz / cs);
    const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepX !== 0 ? cs / Math.abs(dx) : Infinity;
    const tDeltaZ = stepZ !== 0 ? cs / Math.abs(dz) : Infinity;
    let tMaxX = stepX > 0 ? ((ix + 1) * cs - ox) / dx : stepX < 0 ? (ix * cs - ox) / dx : Infinity;
    let tMaxZ = stepZ > 0 ? ((iz + 1) * cs - oz) / dz : stepZ < 0 ? (iz * cs - oz) / dz : Infinity;

    for (let guard = 0; guard < 512; guard++) {
      if (ix >= gx0 && ix <= gx1 && iz >= gz0 && iz <= gz1) {
        const arr = grid.get(this._key(ix, iz));
        if (arr) {
          for (let i = 0; i < arr.length; i++) {
            const c = arr[i];
            if (mark[c._i] === stamp) continue;
            mark[c._i] = stamp;
            if (c.dead) continue;

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
              bestC = c;
            }
          }
        }
      }

      const tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
      if (bestT <= tExit) break;
      if (tExit >= maxDist) break;
      if (tMaxX < tMaxZ) { ix += stepX; tMaxX += tDeltaX; }
      else { iz += stepZ; tMaxZ += tDeltaZ; }
      if ((ix < gx0 && stepX <= 0) || (ix > gx1 && stepX >= 0) ||
          (iz < gz0 && stepZ <= 0) || (iz > gz1 && stepZ >= 0)) break;
    }

    if (!hit) return null;
    return {
      t: bestT,
      x: ox + dx * bestT, y: oy + dy * bestT, z: oz + dz * bestT,
      nx: bnx, ny: bny, nz: bnz,
      col: bestC,
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
  isFree(x, y, z, r, h, eps) {
    const list = this._tmpList || (this._tmpList = []);
    this.query(x - r, z - r, x + r, z + r, list);
    return this._freeIn(list, x, y, z, r, h, eps);
  }

  moveActor(p, dx, dy, dz, r, h, stepH) {
    const res = this._moveRes || (this._moveRes = { ground: false, ceiling: false, wallX: false, wallZ: false, stepped: 0 });
    res.ground = false; res.ceiling = false; res.wallX = false; res.wallZ = false; res.stepped = 0;
    const list = this._tmpList2 || (this._tmpList2 = []);

    if (dx !== 0) {
      p.x += dx;
      this.query(p.x - r - 1, p.z - r - 1, p.x + r + 1, p.z + r + 1, list);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (p.x + r <= c.minx + EPS || p.x - r >= c.maxx - EPS) continue;
        if (p.y + h <= c.miny + EPS || p.y >= c.maxy - EPS) continue;
        if (p.z + r <= c.minz + EPS || p.z - r >= c.maxz - EPS) continue;
        const rise = c.maxy - p.y;
        if (stepH > 0 && rise > 0.01 && rise <= stepH && this.isFree(p.x, c.maxy + 0.02, p.z, r, h)) {
          p.y = c.maxy + 0.02; res.stepped += rise; res.ground = true; continue;
        }
        p.x = dx > 0 ? c.minx - r - EPS : c.maxx + r + EPS;
        res.wallX = true;
      }
    }

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
          p.y = c.maxy + 0.02; res.stepped += rise; res.ground = true; continue;
        }
        p.z = dz > 0 ? c.minz - r - EPS : c.maxz + r + EPS;
        res.wallZ = true;
      }
    }

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

    if (!res.ground) {
      if (!this.isFree(p.x, p.y - 0.08, p.z, r, 0.06)) res.ground = true;
    }
    return res;
  }

  groundAt(x, z, fromY = 80) {
    const h = this.raycast(x, fromY, z, 0, -1, 0, fromY + 20);
    return h ? h.y : 0;
  }

  /** Oberflaechentyp unter den Fuessen (fuer Schrittgeraeusche) */
  surfaceAt(x, y, z, r) {
    const list = this._tmpList4 || (this._tmpList4 = []);
    this.query(x - r, z - r, x + r, z + r, list);
    let best = null, bestY = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxy > y + 0.12 || c.maxy < y - 0.4) continue;
      if (x + r <= c.minx || x - r >= c.maxx || z + r <= c.minz || z - r >= c.maxz) continue;
      if (c.maxy > bestY) { bestY = c.maxy; best = c; }
    }
    return best ? best.surface : 'stone';
  }

  // --------------------------------------------------------
  // Navigation: mehrstoeckiges Gitter + A*
  // --------------------------------------------------------
  _headFree(list, x, y, z, r, h, stepUp, eps) {
    const e = eps === undefined ? EPS : eps;
    const minx = x - r, maxx = x + r, minz = z - r, maxz = z + r;
    const miny = y + stepUp, maxy = y + h;
    if (maxy <= miny) return true;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.maxy <= y + stepUp) continue;
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

    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -half + cs * (ix + 0.5);
        const z = -half + cs * (iz + 0.5);
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
          if (!this._freeIn(list, x, y + 0.05, z, SURF_R, 0.4, 0.02)) continue;
          if (!this._headFree(list, x, y, z, CLEAR_R, AGENT_H, STEP_UP, NAV_EPS)) continue;
          if (y > 0.05 && this._freeIn(list, x, y - 0.14, z, SURF_R, 0.1, 0.02)) continue;
          const node = { id: nodes.length, x, y, z, ix, iz, nb: [], links: null };
          nodes.push(node);
          cellArr.push(node);
          if (cellArr.length >= MAX_LEVELS) break;
        }
        cellNodes[iz * n + ix] = cellArr;
      }
    }

    const passable = (a, b) => {
      const dy = b.y - a.y;
      if (dy > STEP_UP || dy < -MAX_DROP) return -1;
      const my = Math.max(a.y, b.y);
      if (!this.headFree((a.x + b.x) / 2, my, (a.z + b.z) / 2, LINK_R, AGENT_H, STEP_UP, NAV_EPS)) return -1;
      return Math.hypot(b.x - a.x, b.z - a.z) + Math.abs(dy) * 1.4 + (dy < -1.5 ? 2.5 : 0);
    };

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
      state2: new Int32Array(nodes.length),
      stamp: 0,
      heap: new Heap(),
    };
  }

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
          for (let k = 0; k < arr.length; k++) {
            const nd = arr[k];
            const d = (nd.x - x) ** 2 + (nd.z - z) ** 2 + (nd.y - y) ** 2 * 3;
            if (d < bestD) { bestD = d; best = nd; }
          }
        }
      }
      if (best && r >= 1) break;
    }
    return best;
  }

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
    const closed = nav.state2;

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
    path.shift();
    path.push({ x: tx, y: ty, z: tz });
    return path;
  }

  randomNavPoint() {
    const nav = this.nav;
    if (!nav || !nav.nodes.length) return { x: 0, y: 0, z: 0 };
    const nd = nav.nodes[(Math.random() * nav.nodes.length) | 0];
    return { x: nd.x, y: nd.y, z: nd.z };
  }
}
