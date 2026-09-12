// ============================================================
// Welt (Client): Geometrie-Bau (abgeschraegte Boxen, PBR-Material),
// Himmel mit Sonne, Umgebungslicht, Meshes fuer zerstoerbare Objekte.
// Kollision, Raycast und Navigation liegen in collision.js und laufen
// identisch auf dem Server.
// ============================================================

import * as THREE from 'three';
import { clamp, makeRng } from '../core/utils.js';
import { chamferBox } from '../fx/geom.js';
import { makeWorldMaterial, makeSkyMaterial, buildEnvironment, unregisterMaterial } from '../fx/materials.js';
import { CollisionWorld } from './collision.js';

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

// ============================================================
export class World extends CollisionWorld {
  constructor(scene, mapDef, renderer) {
    super(mapDef);
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.envRT = null;
    this._buildMeshes();
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
    this.onDestrChange = null;
  }

  // --------------------------------------------------------
  _buildMeshes() {
    const map = this.map;
    const solid = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const glow = { pos: [], nor: [], col: [], uv: [], idx: [] };
    const rng = makeRng(1337);

    const matSolid = makeWorldMaterial();
    // Collider je Box (fuer die Meshes zerstoerbarer Objekte)
    const colOf = new Map();
    for (const c of this.colliders) colOf.set(c.box, c);

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
      if (box.destr) {
        const c = colOf.get(box);
        const mesh = this._buildDestructible(box, min, max, matSolid);
        if (c && c.destr) { c.destr.mesh = mesh; mesh.visible = !c.dead; }
      }
      else if (box.alpha) this._buildTranslucent(box, min, max);
      else if (box.emissive) pushBox(glow, min, max, box.color, 0.25, false, box.by <= 0.001, chamfer * 0.5, 1.4 + box.emissive * 1.6);
      else pushBox(solid, min, max, color, 0.25, true, box.by <= 0.001, chamfer, 1);
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
}
