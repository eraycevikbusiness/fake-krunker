// ============================================================
// Spielerfigur: Low-Poly-Modell mit Fasen und PBR-Material,
// Animation, Mini-IK fuer die Arme, Treffer-Flash, Nametag,
// Waffen-Skins und ein physikalisches Ragdoll beim Tod
// (positionsbasierte Dynamik mit 7 Massepunkten).
// Gesamthoehe 2.4 Einheiten (siehe actor.js -> PHYS.HEIGHT)
// ============================================================

import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';
import { mergeBoxes } from '../fx/geom.js';
import { makePropMaterial, unregisterMaterial } from '../fx/materials.js';
import { applySkin } from './skins.js';

export const CHAR = {
  HEIGHT: 2.4,
  LEG_H: 0.92,
  TORSO_H: 0.88,
  HEAD_H: 0.6,
  SHOULDER: 0.86,
  DEPTH: 0.46,
  CROUCH_SCALE: 0.646,
};

export { mergeBoxes };

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const NY_AXIS = new THREE.Vector3(0, -1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

const CLOTH = { m: 0.0, r: 0.85 };
const SKIN = { m: 0.0, r: 0.62 };
const M = (c, m, r) => ({ c, m, r });

// ------------------------------------------------------------
// Geometrie-Caches (werden ueber Matches hinweg wiederverwendet)
// ------------------------------------------------------------
const geoCache = new Map();
function cached(key, build) {
  let g = geoCache.get(key);
  if (!g) { g = build(); geoCache.set(key, g); }
  return g;
}

const C = CHAR;
function darken(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f), g = Math.round(((hex >> 8) & 255) * f), b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}
function legGeo(pants, shoe) {
  return cached('leg|' + pants + '|' + shoe, () => mergeBoxes([
    { x: 0, y: -C.LEG_H / 2, z: 0, w: 0.32, h: C.LEG_H, d: 0.34, color: M(pants, 0, 0.9) },
    { x: 0, y: -0.36, z: 0, w: 0.33, h: 0.06, d: 0.35, color: M(darken(pants, 0.7), 0, 0.9) },
    { x: 0, y: -C.LEG_H + 0.08, z: -0.06, w: 0.34, h: 0.16, d: 0.48, color: M(shoe, 0.1, 0.6) },
  ], { chamfer: 0.025, defaults: CLOTH }));
}
function torsoGeo(body, accent) {
  return cached('torso|' + body + '|' + accent, () => mergeBoxes([
    { x: 0, y: C.TORSO_H / 2, z: 0, w: C.SHOULDER, h: C.TORSO_H, d: C.DEPTH, color: M(body, 0, 0.85) },
    { x: 0, y: C.TORSO_H - 0.28, z: 0, w: C.SHOULDER + 0.04, h: 0.3, d: C.DEPTH + 0.04, color: M(accent, 0.1, 0.7) },
    { x: 0, y: 0.26, z: 0, w: C.SHOULDER + 0.02, h: 0.1, d: C.DEPTH + 0.02, color: M(0x1c1f26, 0.3, 0.6) },
    { x: 0, y: 0.26, z: -C.DEPTH / 2 - 0.01, w: 0.08, h: 0.08, d: 0.03, color: M(0x8a929e, 1.0, 0.35) },
    { x: 0.22, y: 0.5, z: -C.DEPTH / 2 - 0.02, w: 0.16, h: 0.18, d: 0.05, color: M(darken(body, 0.75), 0, 0.8) },
    { x: -0.22, y: 0.5, z: -C.DEPTH / 2 - 0.02, w: 0.16, h: 0.18, d: 0.05, color: M(darken(body, 0.75), 0, 0.8) },
  ], { chamfer: 0.03, defaults: CLOTH }));
}
function headGeo(skin, body) {
  return cached('head|' + skin + '|' + body, () => mergeBoxes([
    { x: 0, y: C.HEAD_H / 2, z: 0, w: C.HEAD_H, h: C.HEAD_H, d: C.HEAD_H, color: M(skin, 0, 0.62) },
    { x: 0, y: C.HEAD_H / 2 + 0.04, z: -C.HEAD_H / 2 - 0.02, w: C.HEAD_H * 0.72, h: C.HEAD_H * 0.3, d: 0.04, color: M(0x141618, 0.6, 0.15) },
    { x: 0, y: C.HEAD_H - 0.02, z: 0, w: C.HEAD_H + 0.06, h: 0.16, d: C.HEAD_H + 0.06, color: M(body, 0, 0.8) },
    { x: 0, y: C.HEAD_H - 0.06, z: -C.HEAD_H / 2 - 0.06, w: C.HEAD_H, h: 0.07, d: 0.24, color: M(body, 0, 0.8) },
    { x: C.HEAD_H / 2 + 0.01, y: C.HEAD_H / 2, z: 0.02, w: 0.05, h: 0.12, d: 0.12, color: M(0x1c1f26, 0.4, 0.5) },
    { x: -C.HEAD_H / 2 - 0.01, y: C.HEAD_H / 2, z: 0.02, w: 0.05, h: 0.12, d: 0.12, color: M(0x1c1f26, 0.4, 0.5) },
  ], { chamfer: 0.025, defaults: SKIN }));
}
const ARM_LEN = 0.80;
function armGeo(body, skin) {
  return cached('arm|' + body + '|' + skin, () => mergeBoxes([
    { x: 0, y: 0, z: 0.29, w: 0.24, h: 0.26, d: 0.58, color: M(darken(body, 0.78), 0, 0.85) },
    { x: 0, y: 0, z: 0.60, w: 0.22, h: 0.24, d: 0.06, color: M(0x2a3040, 0.1, 0.8) },
    { x: 0, y: 0, z: 0.72, w: 0.21, h: 0.22, d: 0.18, color: M(skin, 0, 0.62) },
  ], { chamfer: 0.025, defaults: CLOTH }));
}
function weaponGeo(weapon, skinId) {
  const sid = skinId || 'default';
  return cached('wpn|' + weapon.id + '|' + sid, () => mergeBoxes(applySkin(weapon.parts || [], sid), { chamfer: 0.004 }));
}

// Haltungen (Position der rechten Hand im Figurenraum, Rotation des Halters)
const POSE = {
  rifle:    { pos: [0.30, 1.52, -0.38], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  pistol:   { pos: [0.20, 1.60, -0.58], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  akimbo:   { pos: [0.00, 1.58, -0.55], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  launcher: { pos: [0.34, 1.78, -0.22], rot: [0.00, 0.00, 0.00], follow: 0.8 },
  knife:    { pos: [0.50, 1.30, -0.30], rot: [1.15, 0.25, 0.10], follow: 0.2 },
  katana:   { pos: [0.32, 1.28, -0.36], rot: [1.25, 0.10, -0.20], follow: 0.2 },
  nade:     { pos: [0.48, 1.40, -0.30], rot: [0.00, 0.00, 0.00], follow: 0.3 },
};

function swingCurve(t) {
  if (t < 0.28) return -smooth(t / 0.28);
  if (t < 0.62) return -1 + 2 * smooth((t - 0.28) / 0.34);
  return 1 - smooth((t - 0.62) / 0.38);
}
function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

// ------------------------------------------------------------
// Ragdoll: Punkte hips(0) neck(1) head(2) handL(3) handR(4) footL(5) footR(6)
// ------------------------------------------------------------
const RAG_R = 0.16;
const RAG_H = 1 / 120;
const RAG_LINKS = [
  [0, 1, 0.85, 1.0], [1, 2, 0.30, 1.0], [0, 5, 0.92, 1.0], [0, 6, 0.92, 1.0],
  [1, 3, 0.95, 1.0], [1, 4, 0.95, 1.0], [2, 0, 1.12, 0.35],
];
const RAG_MIN = [[5, 6, 0.28], [3, 4, 0.45], [3, 0, 0.55], [4, 0, 0.55], [2, 3, 0.5], [2, 4, 0.5]];
const RAG_MAX = [[0, 3, 1.25], [0, 4, 1.25], [1, 5, 1.75], [1, 6, 1.75], [2, 5, 2.2], [2, 6, 2.2]];

// ------------------------------------------------------------
// Nametag
// ------------------------------------------------------------
class NameTag {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = 320; this.cv.height = 88;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.SpriteMaterial({
      map: this.tex, transparent: true, depthTest: true, depthWrite: false,
      sizeAttenuation: true, toneMapped: false,
    });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.scale.set(3.0, 0.82, 1);
    this.sprite.renderOrder = 20;
    this._key = '';
  }

  draw(name, hpFrac, colorHex, isEnemy) {
    const key = name + '|' + Math.round(hpFrac * 24) + '|' + colorHex;
    if (key === this._key) return;
    this._key = key;
    const g = this.ctx;
    const W = this.cv.width, H = this.cv.height;
    g.clearRect(0, 0, W, H);
    g.font = 'bold 34px Rajdhani, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(name, W / 2, 26);
    g.fillStyle = colorHex;
    g.fillText(name, W / 2, 26);
    const bw = 190, bh = 12, bx = (W - bw) / 2, by = 54;
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    const f = clamp(hpFrac, 0, 1);
    g.fillStyle = isEnemy
      ? (f > 0.5 ? '#ff5555' : f > 0.25 ? '#ff9933' : '#ffdd33')
      : (f > 0.5 ? '#55dd55' : f > 0.25 ? '#ffcc33' : '#ff5555');
    g.fillRect(bx, by, bw * f, bh);
    this.tex.needsUpdate = true;
  }
}

/** Waffenmodell (ein Mesh, fuer Weltansicht) */
export function buildWeaponMesh(weapon, scale, material, skinId) {
  const m = new THREE.Mesh(weaponGeo(weapon, skinId), material);
  m.castShadow = true;
  m.scale.setScalar(scale || 1);
  return m;
}

// ------------------------------------------------------------
export class CharacterModel {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.world = opts.world || null;
    this.effects = opts.effects || null;

    const skin = opts.skin || 0xe0b090;
    const body = opts.color || 0x3366cc;
    const pants = opts.pants || 0x2a3040;
    const shoe = 0x15171c;

    this.mat = makePropMaterial();
    this.flashT = 0;
    this.flashColor = new THREE.Color(1, 1, 1);

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);

    this.legL = new THREE.Mesh(legGeo(pants, shoe), this.mat);
    this.legR = new THREE.Mesh(legGeo(pants, shoe), this.mat);
    this.legL.position.set(-0.2, C.LEG_H, 0);
    this.legR.position.set(0.2, C.LEG_H, 0);
    this.pivot.add(this.legL, this.legR);

    this.torso = new THREE.Mesh(torsoGeo(body, opts.accent || 0xffffff), this.mat);
    this.torso.position.set(0, C.LEG_H, 0);
    this.pivot.add(this.torso);

    this.neck = new THREE.Group();
    this.neck.position.set(0, C.LEG_H + C.TORSO_H, 0);
    this.pivot.add(this.neck);
    this.head = new THREE.Mesh(headGeo(skin, body), this.mat);
    this.neck.add(this.head);

    this.shoulderY = C.LEG_H + C.TORSO_H - 0.10;
    this.armL = new THREE.Mesh(armGeo(body, skin), this.mat);
    this.armR = new THREE.Mesh(armGeo(body, skin), this.mat);
    this.armL.position.set(-(C.SHOULDER / 2 + 0.12), this.shoulderY, 0);
    this.armR.position.set(C.SHOULDER / 2 + 0.12, this.shoulderY, 0);
    this.pivot.add(this.armL, this.armR);

    this.weaponHolder = new THREE.Group();
    this.pivot.add(this.weaponHolder);
    this.weaponMesh = null;
    this.currentWeapon = null;
    this.currentSkin = 'default';
    this.pose = POSE.rifle;

    for (const m of [this.legL, this.legR, this.torso, this.head, this.armL, this.armR]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }

    this.tag = new NameTag();
    this.tag.sprite.position.set(0, C.HEIGHT + 0.62, 0);
    this.root.add(this.tag.sprite);

    scene.add(this.root);

    this.phase = 0;
    this.legSwing = 0;
    this.headPitch = 0;
    this.recoilT = 0;
    this.swingT = 0;
    this.swingDur = 0.35;
    this.swingKind = null;
    this.drawT = 0;
    this.drawDur = 0.4;
    this.crouchT = 0;
    this.deathT = 0;
    this.deathDir = 0;
    this.lastYaw = 0;
    this.visible = true;
    this.rag = null;

    this._handR = new THREE.Vector3();
    this._handL = new THREE.Vector3();
  }

  setWeapon(weapon, skinId) {
    const sid = skinId || 'default';
    if (this.weaponMesh && this.currentWeapon === weapon && this.currentSkin === sid) return;
    if (this.weaponMesh) this.weaponHolder.remove(this.weaponMesh);
    this.weaponMesh = buildWeaponMesh(weapon, 0.9, this.mat, sid);
    this.currentWeapon = weapon;
    this.currentSkin = sid;
    this.pose = POSE[weapon.hold] || POSE.rifle;
    const g = (weapon.grips && weapon.grips.r) || [0, 0, 0];
    this.weaponMesh.position.set(-g[0] * 0.9, -g[1] * 0.9, -g[2] * 0.9);
    this.weaponHolder.add(this.weaponMesh);
    if (!this.rag) this.triggerDraw(weapon.switchTime || 0.4);
  }

  getMuzzleWorld(out) {
    if (!this.weaponMesh || !this.currentWeapon) {
      return out.set(this.root.position.x, this.root.position.y + 1.9, this.root.position.z);
    }
    const mz = this.currentWeapon.muzzle || [0, 0, -1];
    out.set(mz[0], mz[1], mz[2]);
    this.weaponMesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.weaponMesh.matrixWorld);
  }

  setVisible(v) {
    if (this.visible === v) return;
    this.visible = v;
    this.root.visible = v;
  }

  setTagVisible(v) { this.tag.sprite.visible = v; }

  triggerRecoil(amount) { this.recoilT = Math.min(1, this.recoilT + (amount || 0.6)); }

  flash(strength, kill) {
    this.flashT = Math.min(1.5, (this.flashT || 0) + (strength || 0.6));
    if (kill) this.flashColor.setRGB(1.6, 0.35, 0.25); else this.flashColor.setRGB(1, 1, 1);
  }

  triggerSwing(dur, kind) {
    this.swingDur = dur || 0.35;
    this.swingT = this.swingDur;
    this.swingKind = kind || null;
    this.drawT = 0;
  }

  triggerDraw(dur) {
    this.drawDur = Math.max(0.15, dur || 0.4);
    this.drawT = this.drawDur;
  }

  startDeath(dirX, dirZ) {
    this.deathT = 0.0001;
    this.deathDir = Math.atan2(dirX, dirZ) - this.lastYaw;
  }

  // --------------------------------------------------------
  // Ragdoll
  // --------------------------------------------------------
  /**
   * s: {x,y,z,yaw,vx,vy,vz}  hit: {dirx,diry,dirz,head,strength}
   */
  startRagdoll(s, hit) {
    if (!this.world) return;
    this.deathT = 0.0001;
    const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
    const L = (lx, ly, lz) => ({
      x: s.x + lx * c + lz * sn, y: s.y + ly, z: s.z - lx * sn + lz * c, px: 0, py: 0, pz: 0,
    });
    const pts = [
      L(0, 0.95, 0), L(0, 1.80, 0), L(0, 2.10, 0),
      L(-0.55, 1.55, -0.55), L(0.55, 1.55, -0.55),
      L(-0.2, 0.06, 0), L(0.2, 0.06, 0),
    ];
    const str = (hit && hit.strength) || 8;
    let dx = hit ? hit.dirx : 0, dy = hit ? hit.diry * 0.4 + 0.35 : 0.5, dz = hit ? hit.dirz : 1;
    const dl = Math.hypot(dx, dy, dz) || 1;
    dx = dx / dl * str; dy = dy / dl * str; dz = dz / dl * str;
    const head = hit && hit.head;
    const W = head ? [0.7, 1.1, 1.6, 0.7, 0.7, 0.6, 0.6] : [1.1, 1.2, 0.9, 0.8, 0.8, 0.6, 0.6];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const vx = s.vx * 0.5 + dx * W[i] + (Math.random() - 0.5) * 1.2;
      const vy = s.vy * 0.5 + dy * W[i] + (Math.random() - 0.5) * 0.6;
      const vz = s.vz * 0.5 + dz * W[i] + (Math.random() - 0.5) * 1.2;
      p.px = p.x - vx * RAG_H; p.py = p.y - vy * RAG_H; p.pz = p.z - vz * RAG_H;
    }
    this.rag = { pts, acc: 0, t: 0, sleeping: false, pooled: false };
    // Halter/Pivot fuer Weltposen zuruecksetzen
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.root.rotation.set(0, 0, 0);
    this.tag.sprite.visible = false;
  }

  _ragStep(dt) {
    const rag = this.rag;
    const world = this.world;
    rag.t += dt;
    if (rag.sleeping) return;
    rag.acc = Math.min(rag.acc + dt, RAG_H * 8);
    const pts = rag.pts;
    let energy = 0;
    while (rag.acc >= RAG_H) {
      rag.acc -= RAG_H;
      // Verlet-Integration
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const vx = (p.x - p.px) * 0.992, vy = (p.y - p.py) * 0.992, vz = (p.z - p.pz) * 0.992;
        p.sx = p.x; p.sy = p.y; p.sz = p.z;
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.x += vx; p.y += vy - 30 * RAG_H * RAG_H; p.z += vz;
      }
      // Abstandsbeschraenkungen
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < RAG_LINKS.length; k++) this._link(pts[RAG_LINKS[k][0]], pts[RAG_LINKS[k][1]], RAG_LINKS[k][2], RAG_LINKS[k][3], 0);
        for (let k = 0; k < RAG_MIN.length; k++) this._link(pts[RAG_MIN[k][0]], pts[RAG_MIN[k][1]], RAG_MIN[k][2], 1, -1);
        for (let k = 0; k < RAG_MAX.length; k++) this._link(pts[RAG_MAX[k][0]], pts[RAG_MAX[k][1]], RAG_MAX[k][2], 1, 1);
      }
      // Kollision mit der Welt (Sweep vom Startpunkt des Schritts)
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const mx = p.x - p.sx, my = p.y - p.sy, mz = p.z - p.sz;
        const len = Math.sqrt(mx * mx + my * my + mz * mz);
        if (len > 1e-6) {
          const ux = mx / len, uy = my / len, uz = mz / len;
          const h = world.raycast(p.sx, p.sy, p.sz, ux, uy, uz, len + RAG_R);
          if (h && h.t < len + RAG_R) {
            const tt = Math.max(0, h.t - RAG_R);
            p.x = p.sx + ux * tt; p.y = p.sy + uy * tt; p.z = p.sz + uz * tt;
            // Geschwindigkeit: Normalanteil daempfen, Tangente mit Reibung
            const vx = p.x - p.px, vy = p.y - p.py, vz = p.z - p.pz;
            const vn = vx * h.nx + vy * h.ny + vz * h.nz;
            const tx = vx - h.nx * vn, ty = vy - h.ny * vn, tz = vz - h.nz * vn;
            const nx = tx * 0.55 - h.nx * vn * 0.15, ny = ty * 0.55 - h.ny * vn * 0.15, nz = tz * 0.55 - h.nz * vn * 0.15;
            p.px = p.x - nx; p.py = p.y - ny; p.pz = p.z - nz;
          }
        }
        if (p.y < RAG_R - 0.5) { p.y = RAG_R - 0.5; p.py = p.y; }
        const ex = p.x - p.px, ey = p.y - p.py, ez = p.z - p.pz;
        energy += ex * ex + ey * ey + ez * ez;
      }
    }
    if (rag.t > 1.2 && energy < 1e-6) rag.sleeping = true;
    // Blutlache, sobald der Koerper liegt
    if (!rag.pooled && rag.t > 0.9 && this.effects) {
      rag.pooled = true;
      const hp = pts[0];
      const gy = world.groundAt(hp.x, hp.z, hp.y + 0.5);
      if (hp.y - gy < 0.6) this.effects.bloodSplat(hp.x, gy + 0.01, hp.z, 0, 1, 0, 1.7);
    }
  }

  /** Abstandsbeschraenkung; mode 0 = fest, -1 = mindestens, 1 = hoechstens */
  _link(a, b, len, stiff, mode) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1e-5) return;
    if (mode === -1 && d >= len) return;
    if (mode === 1 && d <= len) return;
    const diff = (d - len) / d * 0.5 * stiff;
    a.x += dx * diff; a.y += dy * diff; a.z += dz * diff;
    b.x -= dx * diff; b.y -= dy * diff; b.z -= dz * diff;
  }

  _poseRagdoll() {
    const pts = this.rag.pts;
    const r = this.root;
    const loc = (p, out) => out.set(p.x - r.position.x, p.y - r.position.y, p.z - r.position.z);
    const hips = loc(pts[0], _v), neck = loc(pts[1], _v2), head = loc(pts[2], _v3);

    // Rumpf: von der Huefte zum Hals
    this.torso.position.copy(hips);
    _dir.subVectors(neck, hips).normalize();
    this.torso.quaternion.setFromUnitVectors(Y_AXIS, _dir);
    this.torso.rotation.z = this.torso.rotation.z;   // (Euler aus Quaternion synchron halten)
    const up = _dir.clone();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.torso.quaternion);

    // Kopf
    this.neck.position.copy(neck);
    _dir.subVectors(head, neck).normalize();
    this.neck.quaternion.setFromUnitVectors(Y_AXIS, _dir);

    // Beine: Hueftgelenke seitlich, Richtung Fuss
    const hipL = hips.clone().addScaledVector(right, -0.2);
    const hipR = hips.clone().addScaledVector(right, 0.2);
    this.legL.position.copy(hipL);
    this.legR.position.copy(hipR);
    _dir.copy(loc(pts[5], this._handL)).sub(hipL).normalize();
    this.legL.quaternion.setFromUnitVectors(NY_AXIS, _dir);
    _dir.copy(loc(pts[6], this._handL)).sub(hipR).normalize();
    this.legR.quaternion.setFromUnitVectors(NY_AXIS, _dir);
    this.legL.scale.set(1, 1, 1); this.legR.scale.set(1, 1, 1);

    // Arme: Schultern am Rumpf oben, Richtung Hand
    const shL = neck.clone().addScaledVector(right, -0.55).addScaledVector(up, -0.1);
    const shR = neck.clone().addScaledVector(right, 0.55).addScaledVector(up, -0.1);
    this.armL.position.copy(shL);
    this.armR.position.copy(shR);
    loc(pts[3], this._handL);
    loc(pts[4], this._handR);
    this._aimArm(this.armL, this._handL);
    this._aimArm(this.armR, this._handR);

    // Waffe bleibt in der rechten Hand
    this.weaponHolder.position.copy(this._handR);
    this.weaponHolder.quaternion.copy(this.armR.quaternion).multiply(_qy);
  }

  resetDeath() {
    this.deathT = 0;
    this.rag = null;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.pivot.scale.set(1, 1, 1);
    this.root.scale.setScalar(1);
    this.torso.position.set(0, C.LEG_H, 0);
    this.torso.quaternion.identity();
    this.neck.position.set(0, C.LEG_H + C.TORSO_H, 0);
    this.neck.quaternion.identity();
    this.legL.position.set(-0.2, C.LEG_H, 0);
    this.legR.position.set(0.2, C.LEG_H, 0);
    this.legL.quaternion.identity();
    this.legR.quaternion.identity();
    this.armL.position.set(-(C.SHOULDER / 2 + 0.12), this.shoulderY, 0);
    this.armR.position.set(C.SHOULDER / 2 + 0.12, this.shoulderY, 0);
    this.weaponHolder.quaternion.identity();
  }

  _aimArm(arm, target) {
    _dir.subVectors(target, arm.position);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.multiplyScalar(1 / len);
    arm.quaternion.setFromUnitVectors(Z_AXIS, _dir);
    arm.scale.z = clamp(len / ARM_LEN, 0.55, 1.15);
  }

  update(dt, s, camPos) {
    const r = this.root;
    if (!this.rag) r.position.set(s.x, s.y, s.z);
    this.lastYaw = s.yaw;

    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - dt * 9);
      this.mat.emissive.copy(this.flashColor).multiplyScalar(this.flashT * 0.9);
    } else if (this.mat.emissive.r !== 0) {
      this.mat.emissive.setScalar(0);
    }

    if (s.dead) {
      this.deathT += dt;
      this.tag.sprite.visible = false;
      if (this.rag) {
        this._ragStep(dt);
        this._poseRagdoll();
      } else {
        if (this.deathT <= dt * 1.5) this.startDeath(Math.sin(s.yaw), Math.cos(s.yaw));
        const t = Math.min(1, this.deathT / 0.55);
        const e = 1 - (1 - t) * (1 - t);
        r.rotation.y = s.yaw;
        this.pivot.rotation.x = e * Math.PI * 0.48 * Math.cos(this.deathDir);
        this.pivot.rotation.z = e * Math.PI * 0.48 * Math.sin(this.deathDir);
        this.pivot.position.y = -e * 0.25;
      }
      if (this.deathT > 3.2) {
        const f = clamp(1 - (this.deathT - 3.2) / 0.8, 0, 1);
        this.root.scale.setScalar(f);
      }
      return;
    }
    if (this.deathT !== 0) this.resetDeath();

    r.rotation.y = s.yaw;
    this.headPitch = damp(this.headPitch, clamp(s.pitch, -0.9, 0.9), 22, dt);
    this.neck.rotation.x = this.headPitch;

    this.crouchT = damp(this.crouchT, s.crouch ? 1 : 0, 16, dt);
    this.pivot.scale.y = 1 - this.crouchT * (1 - C.CROUCH_SCALE);
    this.pivot.position.y = 0;

    const spd = s.speed || 0;
    const moving = spd > 0.6 && (s.grounded || s.wallrun);
    const rate = clamp(spd * 0.85, 0, 16);
    if (moving) this.phase += dt * rate;
    else this.phase = damp(this.phase % (Math.PI * 2), 0, 8, dt);

    const target = moving ? clamp(spd / 9, 0.15, 1.05) : 0;
    this.legSwing = damp(this.legSwing, target, 12, dt);
    const sw = Math.sin(this.phase) * this.legSwing;
    const sw2 = Math.cos(this.phase * 2) * this.legSwing * 0.12;

    this.legL.rotation.x = sw * 0.95;
    this.legR.rotation.x = -sw * 0.95;
    this.torso.rotation.z = sw2 * 0.5;
    const bodyDip = Math.abs(sw) * 0.045;
    this.torso.position.y = C.LEG_H - bodyDip;
    this.neck.position.y = C.LEG_H + C.TORSO_H - bodyDip;

    if (!s.grounded && !s.wallrun) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -0.55, 0.35);
      this.legR.rotation.x = lerp(this.legR.rotation.x, 0.3, 0.35);
    }
    if (s.slide) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -1.1, 0.4);
      this.legR.rotation.x = lerp(this.legR.rotation.x, -0.9, 0.4);
    }
    // Wandlauf: Koerper neigt sich von der Wand weg
    this.pivot.rotation.z = damp(this.pivot.rotation.z, s.wallrun ? s.wallrun * 0.35 : 0, 10, dt);

    // ---- Waffe halten ----
    this.recoilT = damp(this.recoilT, 0, 12, dt);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    const pose = this.pose;
    const w = this.currentWeapon;
    const hold = w ? w.hold : 'rifle';
    const holder = this.weaponHolder;

    let hx = pose.pos[0], hy = pose.pos[1] - bodyDip, hz = pose.pos[2];
    let rx = pose.rot[0] + this.headPitch * pose.follow, ry = pose.rot[1], rz = pose.rot[2];

    hz += this.recoilT * 0.12;
    rx += this.recoilT * 0.22;

    if (this.drawT > 0) {
      this.drawT = Math.max(0, this.drawT - dt);
      const k = this.drawT / this.drawDur;
      hy -= k * 0.5;
      rx += k * 1.1;
      ry -= k * 0.4;
    }

    if (this.swingT > 0) {
      const sc = swingCurve(1 - this.swingT / this.swingDur);
      const sk = this.swingKind;
      const fwd = Math.max(0, sc);
      if (sk === 'stab') {
        rx -= 1.2 * Math.max(0.35, fwd) * (sc > -0.9 ? 1 : 0.3);
        hz -= fwd * 0.55;
        hx -= fwd * 0.25;
      } else if (sk === 'overhead') {
        rx += sc < 0 ? -sc * 0.45 : -sc * 2.2;
        hy += sc < 0 ? -sc * 0.30 : -sc * 0.30;
        hz -= fwd * 0.4;
      } else if (hold === 'katana') {
        rx -= 1.15 * (0.5 + 0.5 * Math.abs(sc));
        ry += sc * 1.3;
        hx -= fwd * 0.35;
        hz -= fwd * 0.3;
      } else if (hold === 'knife') {
        rx -= sc > 0 ? sc * 1.7 : sc * -0.3;
        ry += sc * 0.9;
        rz -= fwd * 0.5;
        hx -= fwd * 0.28;
        hz -= fwd * 0.25;
      } else {
        hz -= fwd * 0.35;
        rx += sc * 0.4;
        rz += fwd * 0.6;
      }
    }

    holder.position.set(hx, hy, hz);
    holder.rotation.set(rx, ry, rz);

    if (this.weaponMesh && w) {
      this.pivot.updateMatrixWorld(true);
      const gr = w.grips && w.grips.r;
      const gl = w.grips && w.grips.l;
      if (gr) {
        _v.set(gr[0], gr[1], gr[2]);
        this.weaponMesh.localToWorld(_v);
        this.pivot.worldToLocal(_v);
        this._handR.copy(_v);
      } else {
        this._handR.set(hx, hy, hz);
      }
      this._aimArm(this.armR, this._handR);

      if (gl) {
        _v2.set(gl[0], gl[1], gl[2]);
        this.weaponMesh.localToWorld(_v2);
        this.pivot.worldToLocal(_v2);
        this._handL.copy(_v2);
      } else {
        this._handL.set(-(C.SHOULDER / 2 + 0.12), this.shoulderY - ARM_LEN + 0.05, -sw * 0.35);
      }
      this._aimArm(this.armL, this._handL);
    } else {
      this._handR.set(C.SHOULDER / 2 + 0.12, this.shoulderY - ARM_LEN + 0.05, sw * 0.35);
      this._handL.set(-(C.SHOULDER / 2 + 0.12), this.shoulderY - ARM_LEN + 0.05, -sw * 0.35);
      this._aimArm(this.armR, this._handR);
      this._aimArm(this.armL, this._handL);
    }
    this.armL.position.y = this.shoulderY - bodyDip;
    this.armR.position.y = this.armL.position.y;

    if (s.showTag !== false) {
      this.tag.sprite.visible = true;
      this.tag.draw(s.name, s.hp / s.maxHp, s.tagColor || '#ffffff', s.enemy);
      if (camPos) {
        const d = Math.hypot(camPos.x - s.x, camPos.y - s.y, camPos.z - s.z);
        const sc = clamp(d * 0.055, 0.9, 3.4);
        this.tag.sprite.scale.set(sc * 1.15, sc * 0.31, 1);
        this.tag.sprite.position.y = C.HEIGHT * (1 - this.crouchT * (1 - C.CROUCH_SCALE)) + 0.55;
      }
    } else {
      this.tag.sprite.visible = false;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    unregisterMaterial(this.mat);
    this.mat.dispose();
    this.tag.tex.dispose();
    this.tag.mat.dispose();
  }
}
