// ============================================================
// Ego-Waffenansicht (eigene Szene -> kein Clipping durch Waende)
//
// root (Sway/Bob/Rueckstoss/Animation)
//   -> mesh   (Waffe als EIN PBR-Mesh, Haltungsrotation)
//   -> armR/armL (Unterarme, Mini-IK von der Schulter zum Griff)
//   -> flash + light (Muendungsfeuer + kurzes Punktlicht)
// Messer und Katana werden mit der Klinge nach oben gehalten
// (CS:GO/Valorant); Schlaege, Stiche, Zueck-Animationen sind Kurven.
// ============================================================

import * as THREE from 'three';
import { clamp, damp, lerp, rand } from '../core/utils.js';
import { settings } from '../core/settings.js';
import { mergeBoxes } from '../fx/geom.js';
import { makePropMaterial } from '../fx/materials.js';

const VM_SCALE = 0.53;
const MELEE_SCALE = 0.80;

const HIP_POS = {
  rifle: [0.185, -0.155, -0.72], pistol: [0.145, -0.15, -0.62], akimbo: [0.0, -0.2, -0.62],
  launcher: [0.21, -0.13, -0.62], knife: [0.30, -0.31, -0.52], katana: [0.30, -0.40, -0.58],
  nade: [0.2, -0.2, -0.5],
};
const ADS_Z = -0.74;

const SHOULDER_R = new THREE.Vector3(0.42, -0.70, -0.04);
const SHOULDER_L = new THREE.Vector3(-0.42, -0.70, -0.04);
const SLEEVE_MAX = 0.40;
const FREE_HAND_L = new THREE.Vector3(-0.26, -0.36, -0.44);

const MAG_POINT = {
  rifle: [0, -0.36, -0.22], pistol: [0, -0.38, 0.02], akimbo: [0, -0.38, 0.02],
  launcher: [0.02, -0.06, -1.3],
};

// ---- Animationskurven: [[t, wert], ...] mit weicher Interpolation ----
function curve(t, keys) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i];
      let k = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      k = k * k * (3 - 2 * k);
      return a[1] + (b[1] - a[1]) * k;
    }
  }
  return keys[keys.length - 1][1];
}
const K = (px, py, pz, rx, ry, rz) => ({ px, py, pz, rx, ry, rz });

// Alle Kurven sind Offsets auf die Ruhehaltung (Klinge zeigt nach oben).
const SWINGS = {
  // Messer: schneller Schnitt von oben rechts nach unten links
  slash: K(
    [[0, 0], [0.18, 0.08], [0.5, -0.30], [1, 0]],
    [[0, 0], [0.18, 0.06], [0.5, -0.14], [1, 0]],
    [[0, 0], [0.18, 0.06], [0.45, -0.26], [1, 0]],
    [[0, 0], [0.18, 0.30], [0.5, -1.45], [0.7, -1.2], [1, 0]],
    [[0, 0], [0.18, -0.40], [0.5, 0.75], [1, 0]],
    [[0, 0], [0.18, 0.25], [0.5, -0.90], [1, 0]]),
  // Messer: Rueckhand von links nach rechts
  slash2: K(
    [[0, 0], [0.18, -0.24], [0.5, 0.16], [1, 0]],
    [[0, 0], [0.18, -0.02], [0.5, -0.10], [1, 0]],
    [[0, 0], [0.18, 0.04], [0.45, -0.26], [1, 0]],
    [[0, 0], [0.18, 0.20], [0.5, -1.35], [0.7, -1.1], [1, 0]],
    [[0, 0], [0.18, 0.55], [0.5, -0.55], [1, 0]],
    [[0, 0], [0.18, -0.55], [0.5, 0.60], [1, 0]]),
  // Messer: schwerer Stich (Rechtsklick)
  stab: K(
    [[0, 0], [0.3, 0.08], [0.5, -0.20], [0.7, -0.18], [1, 0]],
    [[0, 0], [0.3, -0.04], [0.5, 0.02], [1, 0]],
    [[0, 0], [0.3, 0.22], [0.5, -0.60], [0.7, -0.52], [1, 0]],
    [[0, 0], [0.3, -0.55], [0.5, -1.25], [0.7, -1.2], [1, 0]],
    [[0, 0], [0.3, -0.25], [0.5, 0.42], [0.7, 0.4], [1, 0]],
    [[0, 0], [0.3, 0.35], [0.5, -0.10], [1, 0]]),
  // Katana: horizontaler Schwung von rechts nach links
  sweep: K(
    [[0, 0], [0.22, 0.16], [0.55, -0.48], [1, 0]],
    [[0, 0], [0.22, 0.06], [0.55, -0.10], [1, 0]],
    [[0, 0], [0.22, 0.10], [0.5, -0.32], [1, 0]],
    [[0, 0], [0.22, -0.30], [0.55, -1.35], [0.75, -1.1], [1, 0]],
    [[0, 0], [0.22, -0.80], [0.55, 1.15], [1, 0]],
    [[0, 0], [0.22, 0.30], [0.55, -0.60], [1, 0]]),
  // Katana: Rueckhand von links nach rechts
  sweep2: K(
    [[0, 0], [0.22, -0.34], [0.55, 0.20], [1, 0]],
    [[0, 0], [0.22, 0.02], [0.55, -0.12], [1, 0]],
    [[0, 0], [0.22, 0.08], [0.5, -0.32], [1, 0]],
    [[0, 0], [0.22, -0.40], [0.55, -1.30], [0.75, -1.05], [1, 0]],
    [[0, 0], [0.22, 0.85], [0.55, -0.95], [1, 0]],
    [[0, 0], [0.22, -0.45], [0.55, 0.55], [1, 0]]),
  // Katana: Ueberkopfhieb (Rechtsklick)
  overhead: K(
    [[0, 0], [0.35, 0.12], [0.58, -0.10], [1, 0]],
    [[0, 0], [0.35, 0.30], [0.58, -0.34], [0.75, -0.28], [1, 0]],
    [[0, 0], [0.35, 0.14], [0.58, -0.50], [0.75, -0.42], [1, 0]],
    [[0, 0], [0.35, 0.45], [0.58, -2.05], [0.75, -1.85], [1, 0]],
    [[0, 0], [0.35, 0.15], [0.58, 0.20], [1, 0]],
    [[0, 0], [0.35, -0.30], [0.58, 0.15], [1, 0]]),
  // Kolbenschlag mit Schusswaffe
  bash: K(
    [[0, 0], [0.3, 0.06], [0.55, -0.14], [1, 0]],
    [[0, 0], [0.3, -0.04], [0.55, 0.02], [1, 0]],
    [[0, 0], [0.3, 0.12], [0.55, -0.40], [1, 0]],
    [[0, 0], [0.3, 0.30], [0.55, -0.60], [1, 0]],
    [[0, 0], [0.3, -0.20], [0.55, 0.25], [1, 0]],
    [[0, 0], [0.3, 0.30], [0.55, 0.80], [1, 0]]),
  // Granatenwurf
  throw: K(
    [[0, 0], [0.3, 0.12], [0.6, -0.05], [1, 0]],
    [[0, 0], [0.3, 0.14], [0.6, -0.06], [1, 0]],
    [[0, 0], [0.3, 0.16], [0.6, -0.30], [1, 0]],
    [[0, 0], [0.3, 0.55], [0.6, -0.40], [1, 0]],
    [[0, 0], [0.3, -0.25], [0.6, 0.15], [1, 0]],
    [[0, 0], [0.3, 0.20], [0.6, -0.20], [1, 0]]),
};

// Zueck-Animationen (t: 0 -> 1)
const EQUIP = {
  raise: K(
    [[0, 0.04], [1, 0]], [[0, -0.42], [1, 0]], [[0, 0.06], [1, 0]],
    [[0, 0.95], [1, 0]], [[0, -0.30], [1, 0]], [[0, 0.35], [1, 0]]),
  // Messer kommt von unten und ueberschlaegt sich in der Hand (Valorant-Stil)
  flip: Object.assign(K(
    [[0, -0.06], [0.5, -0.08], [1, 0]], [[0, -0.10], [0.45, 0.06], [1, 0]], [[0, -0.08], [0.5, -0.12], [1, 0]],
    [[0, -0.10], [0.7, 0.08], [1, 0]], [[0, 0.20], [1, 0]], [[0, 0.30], [0.7, -0.06], [1, 0]]),
    { spin: [[0, -6.28], [0.72, -0.10], [1, 0]] }),
  // Katana wird gezogen: liegt erst quer, schwingt dann nach oben in die Haltung
  unsheathe: K(
    [[0, -0.08], [0.5, 0.0], [1, 0]], [[0, -0.22], [0.5, -0.16], [1, 0]], [[0, 0.0], [1, 0]],
    [[0, -1.05], [0.5, -0.85], [0.85, 0.10], [1, 0]],
    [[0, -0.95], [0.5, -0.75], [0.82, 0.22], [1, 0]],
    [[0, 0.40], [0.55, 0.28], [1, 0]]),
};

const RELOAD = {
  rx: [[0, 0], [0.15, 0.45], [0.75, 0.50], [0.9, -0.08], [1, 0]],
  ry: [[0, 0], [0.15, -0.25], [0.75, -0.20], [1, 0]],
  rz: [[0, 0], [0.15, 0.55], [0.75, 0.50], [0.9, -0.10], [1, 0]],
  py: [[0, 0], [0.15, -0.14], [0.75, -0.12], [0.88, -0.02], [1, 0]],
  pz: [[0, 0], [0.15, 0.06], [0.75, 0.06], [1, 0]],
  hand: [[0, 0], [0.25, 1], [0.7, 1], [0.85, 0]],
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class ViewModel {
  constructor(scene) {
    this.scene = scene;

    this.root = new THREE.Group();
    scene.add(this.root);

    this.mat = makePropMaterial({ envMapIntensity: 0.55 });
    this.weapon = null;
    this.mesh = null;
    this.armR = null;
    this.armL = null;
    this.skin = 0;

    // Muendungsfeuer + Licht
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    this.flashMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(2.4, 2.1, 1.6), transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(flashGeo, this.flashMat);
    this.flash.renderOrder = 30;
    this.flash.visible = false;
    this.root.add(this.flash);
    this.flashLife = 0;
    this.light = new THREE.PointLight(0xffc27a, 0, 2.6, 2);
    this.root.add(this.light);
    this.lightT = 0;

    this.time = 0;
    this.bobPhase = 0;
    this.bob = new THREE.Vector3();
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.velLag = 0;
    this.recoilPos = 0;
    this.recoilRot = 0;
    this.recoilRoll = 0;
    this.recoilVel = 0;
    this.ads = 0;
    this.sprintT = 0;
    this.reloadT = 0;
    this.reloadDur = 1;
    this.switchT = 0;
    this.switchDur = 1;
    this.landT = 0;
    this.swingT = 0;
    this.swingDur = 0.34;
    this.swingKind = 'bash';
    this.swingSide = 0;
    this.equipKind = 'raise';
    this.hidden = false;

    this._basePos = new THREE.Vector3();
    this._adsPos = new THREE.Vector3();
    this._baseRot = new THREE.Euler();
    this._tmp = new THREE.Vector3();
    this._hand = new THREE.Vector3();
  }

  _buildArm(skin) {
    const g = new THREE.Group();
    const geo = mergeBoxes([
      { x: 0, y: 0, z: 0.0, w: 0.085, h: 0.095, d: 0.13, color: { c: skin, m: 0, r: 0.62 } },
      { x: 0, y: 0, z: 0.10, w: 0.10, h: 0.10, d: 0.05, color: { c: 0x2a3040, m: 0.1, r: 0.8 } },
    ], { chamfer: 0.012 });
    const hand = new THREE.Mesh(geo, this.mat);
    const sleeveGeo = mergeBoxes([{ x: 0, y: 0, z: 0.5, w: 0.09, h: 0.09, d: 1.0, color: { c: 0x3b4152, m: 0, r: 0.88 } }], { chamfer: 0.012 });
    const sleeve = new THREE.Mesh(sleeveGeo, this.mat);
    sleeve.position.z = 0.1;
    g.add(hand, sleeve);
    g.userData.sleeve = sleeve;
    g.userData.geos = [geo, sleeveGeo];
    return g;
  }

  setWeapon(weapon, skinColor) {
    if (this.mesh) {
      this.root.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    const skin = skinColor || 0xe0b090;
    if (!this.armR || this.skin !== skin) {
      if (this.armR) {
        this.root.remove(this.armR, this.armL);
        for (const a of [this.armR, this.armL]) a.userData.geos.forEach(g => g.dispose());
      }
      this.skin = skin;
      this.armR = this._buildArm(skin);
      this.armL = this._buildArm(skin);
      this.root.add(this.armR, this.armL);
    }

    this.weapon = weapon;
    this.mesh = new THREE.Mesh(mergeBoxes(weapon.parts || [], { chamfer: 0.0045 }), this.mat);
    this.mesh.scale.setScalar(weapon.melee ? VM_SCALE * MELEE_SCALE : VM_SCALE);
    this.root.add(this.mesh);

    const hold = weapon.hold || 'rifle';
    const vp = weapon.vmPos || HIP_POS[hold] || HIP_POS.rifle;
    this._basePos.set(vp[0], vp[1], vp[2]);
    const vr = weapon.vmRot || [0, 0, 0];
    this._baseRot.set(vr[0], vr[1], vr[2]);

    const sy = weapon.sightY !== undefined ? weapon.sightY : 0.11;
    this._adsPos.set(0, -sy * VM_SCALE, ADS_Z);
    this.equipKind = weapon.equip || 'raise';

    const mz = weapon.muzzle || [0, 0, -1];
    this.flash.position.set(mz[0] * VM_SCALE, mz[1] * VM_SCALE, (mz[2] - 0.05) * VM_SCALE);
    this.light.position.copy(this.flash.position);
    this.flash.visible = false;
    this.flashLife = 0;

    this.reloadT = 0;
    this.swingT = 0;
    this.armL.visible = true;
    this.startSwitch(weapon.switchTime || 0.4);
  }

  startSwitch(dur) { this.switchT = dur; this.switchDur = dur; }
  startReload(dur) { this.reloadT = dur; this.reloadDur = dur; }
  cancelReload() { this.reloadT = 0; }

  fire(strength) {
    const w = this.weapon;
    const s = strength === undefined ? 1 : strength;
    const k = w ? w.kick / 0.05 : 1;
    // Rueckstoss als Impuls auf eine Feder -> weicher Kick statt Sprung
    this.recoilVel += 1.6 * s * k;
    this.recoilRot = Math.min(0.5, this.recoilRot + 0.07 * s * k * 0.55);
    this.recoilRoll += rand(-0.04, 0.04) * s;

    if (w && !w.melee && !w.projectile) this._showFlash(rand(0.22, 0.36));
    else if (w && w.projectile && w.id !== 'grenade') this._showFlash(rand(0.32, 0.5));
  }

  melee(kind, dur) {
    const w = this.weapon;
    let k = kind;
    if (!k) {
      if (w && w.swing === 'sweep') k = this.swingSide ? 'sweep2' : 'sweep';
      else if (w && w.swing === 'slash') k = this.swingSide ? 'slash2' : 'slash';
      else k = 'bash';
      this.swingSide ^= 1;
    }
    this.swingKind = SWINGS[k] ? k : 'bash';
    this.swingDur = dur || ((w && w.melee && w.swingTime) ? w.swingTime : 0.34);
    if (k === 'throw') this.swingDur = 0.45;
    this.swingT = this.swingDur;
    this.switchT = 0;
  }

  hitKick(heavy) {
    this.recoilVel += heavy ? 2.4 : 1.3;
    this.recoilRot = Math.max(-0.5, this.recoilRot - (heavy ? 0.22 : 0.10));
    this.recoilRoll += rand(-0.14, 0.14);
  }

  _showFlash(scale) {
    this.flash.visible = true;
    this.flash.scale.setScalar(scale);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flashMat.opacity = 1;
    this.flashLife = 0.045;
    this.lightT = 1;
  }

  setFlashTexture(tex) { this.flashMat.map = tex; this.flashMat.needsUpdate = true; }

  setHidden(v) { this.hidden = v; this.root.visible = !v; }

  muzzleLocal(out) {
    const mz = this.weapon ? (this.weapon.muzzle || [0, 0, -1]) : [0, 0, -1];
    out.set(mz[0], mz[1], mz[2]);
    if (!this.mesh) return out;
    this.mesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  _placeArm(arm, handWorld, shoulderWorld) {
    _v.copy(handWorld);
    this.root.worldToLocal(_v);
    arm.position.copy(_v);
    _v2.copy(shoulderWorld);
    this.root.worldToLocal(_v2);
    _dir.subVectors(_v2, _v);
    const len = _dir.length();
    if (len > 1e-4) {
      _dir.multiplyScalar(1 / len);
      arm.quaternion.setFromUnitVectors(Z_AXIS, _dir);
      arm.userData.sleeve.scale.z = Math.max(0.15, Math.min(len * 0.95, SLEEVE_MAX));
    }
  }

  /**
   * s: {adsTarget, moveSpeed, grounded, sprint, crouch, slide, firing, lookDX, lookDY, velY, landImpact}
   */
  update(dt, s) {
    if (!this.weapon || !this.mesh) return;
    const w = this.weapon;
    const hold = w.hold || 'rifle';
    this.time += dt;

    // ---- ADS ----
    const adsRate = 1 / Math.max(0.05, w.adsTime);
    const targetAds = s.adsTarget ? 1 : 0;
    this.ads += clamp(targetAds - this.ads, -dt * adsRate, dt * adsRate);
    this.ads = clamp(this.ads, 0, 1);
    const adsK = w.melee ? 0 : this.ads;

    // ---- Sprint-Pose ----
    const sprinting = s.sprint && s.moveSpeed > 4 && s.grounded && !s.firing && this.ads < 0.05 && this.swingT <= 0;
    this.sprintT = damp(this.sprintT, sprinting ? 1 : 0, 11, dt);

    // ---- Sway (Nahkampfwaffen reagieren traeger und staerker) ----
    const swayMul = w.melee ? 2.4 : 1;
    const swayRate = w.melee ? 7 : 10;
    this.swayTarget.x = clamp(-(s.lookDX || 0) * 0.012 * swayMul, -0.09, 0.09);
    this.swayTarget.y = clamp((s.lookDY || 0) * 0.012 * swayMul, -0.09, 0.09);
    this.sway.x = damp(this.sway.x, this.swayTarget.x, swayRate, dt);
    this.sway.y = damp(this.sway.y, this.swayTarget.y, swayRate, dt);
    const velY = clamp((s.velY || 0) * 0.005, -0.07, 0.07) * (w.melee ? 1.6 : 1);
    this.velLag = damp(this.velLag, velY, 9, dt);

    // ---- Bob ----
    const bobScale = settings.viewBob * lerp(1, 0.25, adsK);
    const spd = s.grounded && !s.slide ? clamp(s.moveSpeed, 0, 16) : 0;
    this.bobPhase += dt * spd * 1.15;
    const bobA = clamp(spd / 11, 0, 1) * 0.022 * bobScale;
    const bx = Math.cos(this.bobPhase) * bobA;
    const by = -Math.abs(Math.sin(this.bobPhase)) * bobA * 1.15;
    this.bob.x = damp(this.bob.x, bx, 14, dt);
    this.bob.y = damp(this.bob.y, by, 14, dt);

    // ---- Landung ----
    if (s.landImpact) this.landT = Math.min(1, this.landT + s.landImpact);
    this.landT = damp(this.landT, 0, 9, dt);

    // ---- Rueckstoss als gedaempfte Feder ----
    const KS = 260, KD = 18;
    this.recoilVel += (-this.recoilPos * KS - this.recoilVel * KD) * dt;
    this.recoilPos = clamp(this.recoilPos + this.recoilVel * dt, -0.05, 0.3);
    this.recoilRot = damp(this.recoilRot, 0, 11, dt);
    this.recoilRoll = damp(this.recoilRoll, 0, 9, dt);

    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);
    if (this.switchT > 0) this.switchT = Math.max(0, this.switchT - dt);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);

    // ---- Zielposition zusammensetzen ----
    const p = this._tmp;
    p.copy(this._basePos).lerp(this._adsPos, adsK);
    p.x += this.bob.x + this.sway.x;
    p.y += this.bob.y + this.sway.y - this.landT * 0.09 - this.velLag;
    p.z += this.recoilPos;

    let rx = -this.recoilRot + this.sway.y * 1.4 + this.landT * 0.22 + this.velLag * 1.5;
    let ry = -this.sway.x * 2.2;
    let rz = this.recoilRoll + this.bob.x * 0.9 + (w.melee ? -this.sway.x * 1.6 : 0);
    let meshSpin = 0;

    // Atmen / Idle
    const breath = Math.sin(this.time * 1.7) * (1 - adsK * 0.8);
    p.y += breath * 0.0025;
    rx += breath * 0.004;
    if (w.melee) {
      // Ruhige Achterbewegung wie in CS:GO
      rx += Math.sin(this.time * 1.1) * 0.02;
      ry += Math.sin(this.time * 0.7) * 0.03;
      rz += Math.cos(this.time * 0.9) * 0.015;
    }

    // Sprint
    if (this.sprintT > 0.001) {
      const st = this.sprintT;
      if (hold === 'knife' || hold === 'katana') {
        p.x += st * 0.06; p.y += st * -0.12; p.z += st * 0.05;
        rx += st * -0.35; ry += st * 0.45; rz += st * 0.35;
      } else if (hold === 'pistol' || hold === 'akimbo') {
        p.x += st * 0.05; p.y += st * -0.07; p.z += st * 0.08;
        rx += st * 0.30; ry += st * 0.40; rz += st * 0.25;
      } else {
        p.x += st * 0.06; p.y += st * -0.05; p.z += st * 0.10;
        rx += st * 0.18; ry += st * 0.62; rz += st * 0.42;
      }
    }

    // Nachladen
    let magK = 0;
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT / this.reloadDur;
      if (w.reloadType === 'single') {
        const c = Math.sin(clamp(t, 0, 1) * Math.PI);
        p.y -= c * 0.06; rx += c * 0.25; rz += c * 0.2;
        magK = c;
      } else {
        p.y += curve(t, RELOAD.py);
        p.z += curve(t, RELOAD.pz);
        rx += curve(t, RELOAD.rx);
        ry += curve(t, RELOAD.ry);
        rz += curve(t, RELOAD.rz);
        magK = curve(t, RELOAD.hand);
      }
    }

    // Zuecken
    if (this.switchT > 0) {
      const t = 1 - this.switchT / this.switchDur;
      const eq = EQUIP[this.equipKind] || EQUIP.raise;
      p.x += curve(t, eq.px); p.y += curve(t, eq.py); p.z += curve(t, eq.pz);
      rx += curve(t, eq.rx); ry += curve(t, eq.ry); rz += curve(t, eq.rz);
      if (eq.spin) meshSpin = curve(t, eq.spin);
    }

    // Nahkampfschlag / Wurf
    if (this.swingT > 0) {
      const t = 1 - this.swingT / this.swingDur;
      const sw = SWINGS[this.swingKind] || SWINGS.bash;
      p.x += curve(t, sw.px); p.y += curve(t, sw.py); p.z += curve(t, sw.pz);
      rx += curve(t, sw.rx); ry += curve(t, sw.ry); rz += curve(t, sw.rz);
    }

    this.root.position.copy(p);
    this.root.rotation.set(rx, ry, rz);

    const br = this._baseRot;
    this.mesh.rotation.set(br.x * (1 - adsK) + meshSpin, br.y * (1 - adsK), br.z * (1 - adsK));

    // ---- Arme per Mini-IK ----
    this.root.updateMatrixWorld(true);
    const gr = w.grips && w.grips.r;
    const gl = w.grips && w.grips.l;
    if (gr) {
      this._hand.set(gr[0], gr[1], gr[2]);
      this.mesh.localToWorld(this._hand);
      this._placeArm(this.armR, this._hand, SHOULDER_R);
    }
    if (gl) {
      this._hand.set(gl[0], gl[1], gl[2]);
      const mp = MAG_POINT[hold];
      if (magK > 0 && mp) {
        this._hand.x = lerp(this._hand.x, mp[0], magK);
        this._hand.y = lerp(this._hand.y, mp[1], magK);
        this._hand.z = lerp(this._hand.z, mp[2], magK);
      }
      this.mesh.localToWorld(this._hand);
      this._placeArm(this.armL, this._hand, SHOULDER_L);
    } else {
      this._hand.copy(FREE_HAND_L);
      if (magK > 0 && MAG_POINT[hold]) {
        const mp = MAG_POINT[hold];
        _v.set(mp[0], mp[1], mp[2]);
        this.mesh.localToWorld(_v);
        this._hand.lerp(_v, magK);
      }
      this._placeArm(this.armL, this._hand, SHOULDER_L);
    }

    // ---- Muendungsfeuer + Licht ausblenden ----
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashMat.opacity = clamp(this.flashLife / 0.045, 0, 1);
      if (this.flashLife <= 0) this.flash.visible = false;
    }
    if (this.lightT > 0) {
      this.lightT = Math.max(0, this.lightT - dt / 0.07);
      this.light.intensity = 9 * this.lightT;
    } else if (this.light.intensity !== 0) {
      this.light.intensity = 0;
    }
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    for (const a of [this.armR, this.armL]) if (a) a.userData.geos.forEach(g => g.dispose());
    this.scene.remove(this.root);
    this.flash.geometry.dispose();
    this.flashMat.dispose();
    this.mat.dispose();
  }
}
