// ============================================================
// Spielerfigur: klotziges Low-Poly-Modell + Animation + Nametag
// Gesamthoehe 2.4 Einheiten (siehe actor.js -> PHYS.HEIGHT)
//
// Performance: alle Koerperteile sind zu wenigen Meshes verschmolzen
// (Vertexfarben, ein geteiltes Material), Geometrien werden gecacht.
// Pro Figur: 2 Beine, Rumpf, Kopf, 2 Arme, Waffe, Nametag = 8 Draw-Calls.
// Arme werden per Mini-IK von der Schulter zum Griffpunkt der Waffe
// ausgerichtet -> jede Waffe wird korrekt gehalten (Messer, Katana, ...).
// ============================================================

import * as THREE from 'three';
import { clamp, damp, lerp } from '../core/utils.js';

export const CHAR = {
  HEIGHT: 2.4,
  LEG_H: 0.92,
  TORSO_H: 0.88,
  HEAD_H: 0.6,
  SHOULDER: 0.86,
  DEPTH: 0.46,
  CROUCH_SCALE: 0.646,       // = PHYS.CROUCH_HEIGHT / PHYS.HEIGHT
};

// Geteiltes Material fuer alle Figuren und Waffen (Vertexfarben)
export const MAT_VC = new THREE.MeshLambertMaterial({ vertexColors: true });

const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3();
const _col = new THREE.Color();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/** Mehrere Boxen {x,y,z,w,h,d,color,rot} zu einer Geometrie mit Vertexfarben verschmelzen */
export function mergeBoxes(parts) {
  const pos = [], nor = [], col = [], idx = [];
  let base = 0;
  for (const p of parts) {
    const g = new THREE.BoxGeometry(p.w, p.h, p.d);
    const r = p.rot || null;
    _e.set(r ? (r.x || 0) : 0, r ? (r.y || 0) : 0, r ? (r.z || 0) : 0);
    _m.compose(_p.set(p.x, p.y, p.z), _q.setFromEuler(_e), _one);
    g.applyMatrix4(_m);
    const pa = g.attributes.position.array, na = g.attributes.normal.array;
    _col.setHex(p.color);
    const n = g.attributes.position.count;
    for (let i = 0; i < n; i++) {
      pos.push(pa[i * 3], pa[i * 3 + 1], pa[i * 3 + 2]);
      nor.push(na[i * 3], na[i * 3 + 1], na[i * 3 + 2]);
      col.push(_col.r, _col.g, _col.b);
    }
    const ia = g.index.array;
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + base);
    base += n;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

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
function legGeo(pants, shoe) {
  return cached('leg|' + pants + '|' + shoe, () => mergeBoxes([
    { x: 0, y: -C.LEG_H / 2, z: 0, w: 0.32, h: C.LEG_H, d: 0.34, color: pants },
    { x: 0, y: -C.LEG_H + 0.08, z: -0.06, w: 0.34, h: 0.16, d: 0.48, color: shoe },
  ]));
}
function torsoGeo(body, accent) {
  return cached('torso|' + body + '|' + accent, () => mergeBoxes([
    { x: 0, y: C.TORSO_H / 2, z: 0, w: C.SHOULDER, h: C.TORSO_H, d: C.DEPTH, color: body },
    { x: 0, y: C.TORSO_H - 0.28, z: 0, w: C.SHOULDER + 0.04, h: 0.3, d: C.DEPTH + 0.04, color: accent },
    { x: 0, y: 0.26, z: 0, w: C.SHOULDER + 0.02, h: 0.1, d: C.DEPTH + 0.02, color: 0x1c1f26 },   // Guertel
  ]));
}
function headGeo(skin, body) {
  return cached('head|' + skin + '|' + body, () => mergeBoxes([
    { x: 0, y: C.HEAD_H / 2, z: 0, w: C.HEAD_H, h: C.HEAD_H, d: C.HEAD_H, color: skin },
    { x: 0, y: C.HEAD_H / 2 + 0.04, z: -C.HEAD_H / 2 - 0.02, w: C.HEAD_H * 0.72, h: C.HEAD_H * 0.3, d: 0.04, color: 0x241f1c },
    { x: 0, y: C.HEAD_H - 0.02, z: 0, w: C.HEAD_H + 0.06, h: 0.16, d: C.HEAD_H + 0.06, color: body },
    { x: 0, y: C.HEAD_H - 0.06, z: -C.HEAD_H / 2 - 0.06, w: C.HEAD_H, h: 0.07, d: 0.24, color: body },
  ]));
}
// Arm: Pivot an der Schulter, zeigt entlang +Z; Hand am Ende
const ARM_LEN = 0.80;
function darken(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f), g = Math.round(((hex >> 8) & 255) * f), b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}
function armGeo(body, skin) {
  return cached('arm|' + body + '|' + skin, () => mergeBoxes([
    { x: 0, y: 0, z: 0.29, w: 0.24, h: 0.26, d: 0.58, color: darken(body, 0.78) },
    { x: 0, y: 0, z: 0.60, w: 0.22, h: 0.24, d: 0.06, color: 0x2a3040 },
    { x: 0, y: 0, z: 0.72, w: 0.21, h: 0.22, d: 0.18, color: skin },
  ]));
}
function weaponGeo(weapon) {
  return cached('wpn|' + weapon.id, () => mergeBoxes(weapon.parts || []));
}

// Haltungen (Position der rechten Hand im Figurenraum, Rotation des Halters)
const POSE = {
  rifle:    { pos: [0.30, 1.52, -0.38], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  pistol:   { pos: [0.20, 1.60, -0.58], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  akimbo:   { pos: [0.00, 1.58, -0.55], rot: [0.00, 0.00, 0.00], follow: 1.0 },
  launcher: { pos: [0.34, 1.78, -0.22], rot: [0.00, 0.00, 0.00], follow: 0.8 },
  knife:    { pos: [0.50, 1.28, -0.36], rot: [0.30, 0.35, 0.15], follow: 0.3 },
  katana:   { pos: [0.28, 1.40, -0.46], rot: [0.75, 0.10, -0.25], follow: 0.3 },
  nade:     { pos: [0.48, 1.40, -0.30], rot: [0.00, 0.00, 0.00], follow: 0.3 },
};

/** Schlagkurve: -1 = Ausholen, +1 = Schlagende, 0 = Ruhe */
function swingCurve(t) {
  if (t < 0.28) return -smooth(t / 0.28);
  if (t < 0.62) return -1 + 2 * smooth((t - 0.28) / 0.34);
  return 1 - smooth((t - 0.62) / 0.38);
}
function smooth(x) { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); }

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

    // Name
    g.font = 'bold 34px Rajdhani, Segoe UI, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(0,0,0,0.85)';
    g.strokeText(name, W / 2, 26);
    g.fillStyle = colorHex;
    g.fillText(name, W / 2, 26);

    // HP-Balken
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

// ------------------------------------------------------------
// Waffenmodell (ein Mesh, fuer Weltansicht)
// ------------------------------------------------------------
export function buildWeaponMesh(weapon, scale = 1) {
  const m = new THREE.Mesh(weaponGeo(weapon), MAT_VC);
  m.castShadow = true;
  m.scale.setScalar(scale);
  return m;
}

// ------------------------------------------------------------
export class CharacterModel {
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;

    const skin = opts.skin || 0xe0b090;
    const body = opts.color || 0x3366cc;
    const pants = opts.pants || 0x2a3040;
    const shoe = 0x15171c;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();      // fuer Todes-Animation + Ducken
    this.root.add(this.pivot);

    // Beine
    this.legL = new THREE.Mesh(legGeo(pants, shoe), MAT_VC);
    this.legR = new THREE.Mesh(legGeo(pants, shoe), MAT_VC);
    this.legL.position.set(-0.2, C.LEG_H, 0);
    this.legR.position.set(0.2, C.LEG_H, 0);
    this.pivot.add(this.legL, this.legR);

    // Torso (+ Weste + Guertel)
    this.torso = new THREE.Mesh(torsoGeo(body, opts.accent || 0xffffff), MAT_VC);
    this.torso.position.set(0, C.LEG_H, 0);
    this.pivot.add(this.torso);

    // Kopf (eigener Pivot fuer Pitch)
    this.neck = new THREE.Group();
    this.neck.position.set(0, C.LEG_H + C.TORSO_H, 0);
    this.pivot.add(this.neck);
    this.head = new THREE.Mesh(headGeo(skin, body), MAT_VC);
    this.neck.add(this.head);

    // Arme (Pivot = Schulter, +Z zeigt zur Hand)
    this.shoulderY = C.LEG_H + C.TORSO_H - 0.10;
    this.armL = new THREE.Mesh(armGeo(body, skin), MAT_VC);
    this.armR = new THREE.Mesh(armGeo(body, skin), MAT_VC);
    this.armL.position.set(-(C.SHOULDER / 2 + 0.12), this.shoulderY, 0);
    this.armR.position.set(C.SHOULDER / 2 + 0.12, this.shoulderY, 0);
    this.pivot.add(this.armL, this.armR);

    // Waffe haengt an einem eigenen Knoten (Ursprung = rechte Hand)
    this.weaponHolder = new THREE.Group();
    this.pivot.add(this.weaponHolder);
    this.weaponMesh = null;
    this.currentWeapon = null;
    this.pose = POSE.rifle;

    for (const m of [this.legL, this.legR, this.torso, this.head, this.armL, this.armR]) {
      m.castShadow = true;
      m.receiveShadow = false;
    }

    // Nametag
    this.tag = new NameTag();
    this.tag.sprite.position.set(0, C.HEIGHT + 0.62, 0);
    this.root.add(this.tag.sprite);

    scene.add(this.root);

    // Animationszustand
    this.phase = 0;
    this.legSwing = 0;
    this.headPitch = 0;
    this.recoilT = 0;
    this.swingT = 0;
    this.swingDur = 0.35;
    this.crouchT = 0;
    this.deathT = 0;
    this.deathDir = 0;
    this.lastYaw = 0;
    this.visible = true;

    this._handR = new THREE.Vector3();
    this._handL = new THREE.Vector3();
  }

  setWeapon(weapon) {
    if (this.weaponMesh) this.weaponHolder.remove(this.weaponMesh);   // Geometrie ist gecacht
    this.weaponMesh = buildWeaponMesh(weapon, 0.9);
    this.currentWeapon = weapon;
    this.pose = POSE[weapon.hold] || POSE.rifle;
    // Waffe so verschieben, dass der rechte Griffpunkt im Halter-Ursprung liegt
    const g = (weapon.grips && weapon.grips.r) || [0, 0, 0];
    this.weaponMesh.position.set(-g[0] * 0.9, -g[1] * 0.9, -g[2] * 0.9);
    this.weaponHolder.add(this.weaponMesh);
  }

  /** Weltposition der Muendung */
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

  /** Nahkampfschlag (Messer/Katana/Kolben) */
  triggerSwing(dur) {
    this.swingDur = dur || 0.35;
    this.swingT = this.swingDur;
  }

  startDeath(dirX, dirZ) {
    this.deathT = 0.0001;
    // Fallrichtung relativ zur Blickrichtung der Figur
    this.deathDir = Math.atan2(dirX, dirZ) - this.lastYaw;
  }

  resetDeath() {
    this.deathT = 0;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.root.scale.setScalar(1);
  }

  /** Richtet einen Arm (Pivot = Schulter) auf einen Zielpunkt im Pivot-Raum aus */
  _aimArm(arm, target) {
    _dir.subVectors(target, arm.position);
    const len = _dir.length();
    if (len < 1e-4) return;
    _dir.multiplyScalar(1 / len);
    arm.quaternion.setFromUnitVectors(Z_AXIS, _dir);
    arm.scale.z = clamp(len / ARM_LEN, 0.55, 1.15);
  }

  /**
   * state: {x,y,z, yaw, pitch, speed, grounded, crouch, dead, name, hp, maxHp, color, enemy}
   */
  update(dt, s, camPos) {
    const r = this.root;
    r.position.set(s.x, s.y, s.z);
    this.lastYaw = s.yaw;

    // ---- Tod ----
    if (s.dead) {
      if (this.deathT === 0) this.startDeath(Math.sin(s.yaw), Math.cos(s.yaw));
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.55);
      const e = 1 - (1 - t) * (1 - t);
      this.pivot.rotation.x = e * Math.PI * 0.48 * Math.cos(this.deathDir);
      this.pivot.rotation.z = e * Math.PI * 0.48 * Math.sin(this.deathDir);
      this.pivot.position.y = -e * 0.25;
      this.tag.sprite.visible = false;
      if (this.deathT > 3.2) {
        const f = clamp(1 - (this.deathT - 3.2) / 0.8, 0, 1);
        this.root.scale.setScalar(f);
      }
      return;
    }
    if (this.deathT !== 0) this.resetDeath();

    // ---- Blickrichtung ----
    r.rotation.y = s.yaw;
    this.headPitch = damp(this.headPitch, clamp(s.pitch, -0.9, 0.9), 22, dt);
    this.neck.rotation.x = this.headPitch;

    // ---- Ducken ----
    this.crouchT = damp(this.crouchT, s.crouch ? 1 : 0, 16, dt);
    this.pivot.scale.y = 1 - this.crouchT * (1 - C.CROUCH_SCALE);
    this.pivot.position.y = 0;

    // ---- Laufanimation ----
    const spd = s.speed || 0;
    const moving = spd > 0.6 && s.grounded;
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

    // In der Luft: Beine anziehen
    if (!s.grounded) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -0.55, 0.35);
      this.legR.rotation.x = lerp(this.legR.rotation.x, 0.3, 0.35);
    }
    // Beim Sliden: Beine nach vorn strecken
    if (s.slide) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -1.1, 0.4);
      this.legR.rotation.x = lerp(this.legR.rotation.x, -0.9, 0.4);
    }

    // ---- Waffe halten ----
    this.recoilT = damp(this.recoilT, 0, 12, dt);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);
    const pose = this.pose;
    const w = this.currentWeapon;
    const hold = w ? w.hold : 'rifle';
    const holder = this.weaponHolder;

    let hx = pose.pos[0], hy = pose.pos[1] - bodyDip, hz = pose.pos[2];
    let rx = pose.rot[0] + this.headPitch * pose.follow, ry = pose.rot[1], rz = pose.rot[2];

    // Rueckstoss: Waffe zuckt zurueck und hoch
    hz += this.recoilT * 0.12;
    rx += this.recoilT * 0.22;

    // Nahkampfschlag
    if (this.swingT > 0) {
      const sc = swingCurve(1 - this.swingT / this.swingDur);
      if (hold === 'katana') {
        ry += sc * 1.25;
        rx -= Math.max(0, sc) * 0.55;
        rz += sc * 0.35;
        hx -= Math.max(0, sc) * 0.30;
        hz -= Math.max(0, sc) * 0.28;
      } else if (hold === 'knife') {
        rx += sc * -0.6;
        ry += sc * 0.95;
        rz -= Math.max(0, sc) * 0.5;
        hx -= Math.max(0, sc) * 0.25;
        hz -= Math.max(0, sc) * 0.22;
        hy += Math.min(0, sc) * -0.12;
      } else {
        // Kolbenschlag mit Schusswaffe
        hz -= Math.max(0, sc) * 0.35;
        rx += sc * 0.4;
        rz += Math.max(0, sc) * 0.6;
      }
    }

    holder.position.set(hx, hy, hz);
    holder.rotation.set(rx, ry, rz);

    // ---- Arme per Mini-IK zu den Griffpunkten ----
    if (this.weaponMesh && w) {
      // Griffpunkte in den Pivot-Raum transformieren
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
        // Linker Arm haengt locker und schwingt mit
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

    // ---- Nametag ----
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
    // Geometrien und das Material sind geteilt/gecacht -> nur Nametag freigeben
    this.tag.tex.dispose();
    this.tag.mat.dispose();
  }
}
