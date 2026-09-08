// ============================================================
// Ego-Waffenansicht (eigene Szene -> kein Clipping durch Waende)
//
// Aufbau: root (Sway/Bob/Rueckstoss/Animationen)
//           -> mesh  (Waffe als EIN Mesh, Haltungsrotation, Massstab)
//           -> armR / armL (Unterarme, per Mini-IK von der Schulter zum Griff)
// Jede Waffe bringt Griffpunkte (grips) und eine Haltung (hold/vmPos/vmRot)
// mit. Messer und Katana haben eigene Schlag-Animationen (Kurven).
// ============================================================

import * as THREE from 'three';
import { clamp, damp, lerp, rand } from '../core/utils.js';
import { settings } from '../core/settings.js';
import { mergeBoxes, MAT_VC } from './character.js';

// Massstab des Waffenmodells in der Egoansicht. Ohne Verkleinerung
// stehen die hinteren Teile fast in der Kamera -> extreme Perspektive.
const VM_SCALE = 0.53;

// Standard-Ablage der Waffe (Hueftposition) je Haltungstyp
const HIP_POS = {
  rifle: [0.185, -0.155, -0.72], pistol: [0.145, -0.15, -0.62], akimbo: [0.0, -0.2, -0.62],
  launcher: [0.21, -0.13, -0.62], knife: [0.27, -0.25, -0.50], katana: [0.22, -0.27, -0.46],
  nade: [0.2, -0.2, -0.5],
};
const ADS_Z = -0.74;

// Hoehe der Visierlinie im Waffen-Koordinatensystem.
// Beim Zielen wird die Waffe so verschoben, dass sie exakt auf der Bildmitte liegt.
const SIGHT_Y = {
  ar: 0.118, smg: 0.102, sniper: 0.146, shotgun: 0.108, lmg: 0.128,
  marksman: 0.112, burst: 0.112, revolver: 0.078, pistol: 0.072,
  rpg: 0.132, crossbow: 0.102, akimbo: 0.02,
};

// Schultern im Kameraraum (Kamera im Ursprung, Blick -Z). Sie liegen unter
// und knapp vor der Kamera, damit der Unterarm schraeg nach unten verlaeuft
// und nicht durch die Nahebene rauscht.
const SHOULDER_R = new THREE.Vector3(0.42, -0.70, -0.04);
const SHOULDER_L = new THREE.Vector3(-0.42, -0.70, -0.04);
const SLEEVE_MAX = 0.40;                 // sichtbarer Unterarm, Rest ist ausserhalb des Bildes
// Position der linken Hand, wenn die Waffe einhaendig gehalten wird
const FREE_HAND_L = new THREE.Vector3(-0.26, -0.36, -0.44);
// Nahkampfwaffen etwas kleiner darstellen (sie sind lang und nah an der Kamera)
const MELEE_SCALE = 0.80;

// Magazin-Position (Waffenraum) fuer die Nachlade-Handbewegung
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

const SWINGS = {
  // Messer: schneller Diagonalschnitt von oben rechts nach unten links
  slash: {
    px: [[0, 0], [0.2, 0.10], [0.55, -0.30], [1, 0]],
    py: [[0, 0], [0.2, 0.08], [0.55, -0.10], [1, 0]],
    pz: [[0, 0], [0.2, 0.05], [0.5, -0.28], [1, 0]],
    rx: [[0, 0], [0.2, 0.35], [0.55, -0.45], [1, 0]],
    ry: [[0, 0], [0.2, -0.55], [0.55, 0.75], [1, 0]],
    rz: [[0, 0], [0.2, 0.25], [0.55, -0.95], [1, 0]],
  },
  // Messer, Rueckhand
  slash2: {
    px: [[0, 0], [0.2, -0.22], [0.55, 0.18], [1, 0]],
    py: [[0, 0], [0.2, -0.06], [0.55, 0.06], [1, 0]],
    pz: [[0, 0], [0.2, 0.04], [0.5, -0.26], [1, 0]],
    rx: [[0, 0], [0.2, -0.2], [0.55, 0.25], [1, 0]],
    ry: [[0, 0], [0.2, 0.6], [0.55, -0.55], [1, 0]],
    rz: [[0, 0], [0.2, -0.6], [0.55, 0.55], [1, 0]],
  },
  // Katana: weiter horizontaler Schwung von rechts nach links
  sweep: {
    px: [[0, 0], [0.25, 0.18], [0.6, -0.42], [1, 0]],
    py: [[0, 0], [0.25, 0.10], [0.6, -0.06], [1, 0]],
    pz: [[0, 0], [0.25, 0.10], [0.6, -0.30], [1, 0]],
    rx: [[0, 0], [0.25, 0.25], [0.6, -0.15], [1, 0]],
    ry: [[0, 0], [0.25, -0.75], [0.6, 1.05], [1, 0]],
    rz: [[0, 0], [0.25, 0.30], [0.6, -0.85], [1, 0]],
  },
  // Katana: Ueberkopfhieb
  sweep2: {
    px: [[0, 0], [0.25, 0.05], [0.6, -0.10], [1, 0]],
    py: [[0, 0], [0.25, 0.24], [0.6, -0.22], [1, 0]],
    pz: [[0, 0], [0.25, 0.12], [0.6, -0.34], [1, 0]],
    rx: [[0, 0], [0.25, 0.95], [0.6, -0.80], [1, 0]],
    ry: [[0, 0], [0.25, 0.10], [0.6, 0.35], [1, 0]],
    rz: [[0, 0], [0.25, -0.25], [0.6, 0.15], [1, 0]],
  },
  // Kolbenschlag mit Schusswaffe
  bash: {
    px: [[0, 0], [0.3, 0.06], [0.55, -0.14], [1, 0]],
    py: [[0, 0], [0.3, -0.04], [0.55, 0.02], [1, 0]],
    pz: [[0, 0], [0.3, 0.12], [0.55, -0.40], [1, 0]],
    rx: [[0, 0], [0.3, 0.30], [0.55, -0.60], [1, 0]],
    ry: [[0, 0], [0.3, -0.20], [0.55, 0.25], [1, 0]],
    rz: [[0, 0], [0.3, 0.30], [0.55, 0.80], [1, 0]],
  },
  // Granatenwurf
  throw: {
    px: [[0, 0], [0.3, 0.12], [0.6, -0.05], [1, 0]],
    py: [[0, 0], [0.3, 0.14], [0.6, -0.06], [1, 0]],
    pz: [[0, 0], [0.3, 0.16], [0.6, -0.30], [1, 0]],
    rx: [[0, 0], [0.3, 0.55], [0.6, -0.40], [1, 0]],
    ry: [[0, 0], [0.3, -0.25], [0.6, 0.15], [1, 0]],
    rz: [[0, 0], [0.3, 0.20], [0.6, -0.20], [1, 0]],
  },
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

    this.root = new THREE.Group();          // Sway / Bob / Rueckstoss / Animation
    scene.add(this.root);

    this.weapon = null;
    this.mesh = null;
    this.armR = null;
    this.armL = null;
    this.skin = 0;

    // Muendungsfeuer
    const flashGeo = new THREE.PlaneGeometry(1, 1);
    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      toneMapped: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Mesh(flashGeo, this.flashMat);
    this.flash.renderOrder = 30;
    this.flash.visible = false;
    this.root.add(this.flash);
    this.flashLife = 0;

    // Animationszustand
    this.time = 0;
    this.bobPhase = 0;
    this.bob = new THREE.Vector3();
    this.sway = new THREE.Vector2();
    this.swayTarget = new THREE.Vector2();
    this.recoilPos = 0;
    this.recoilRot = 0;
    this.recoilRoll = 0;
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
    this.hidden = false;

    this._basePos = new THREE.Vector3();
    this._adsPos = new THREE.Vector3();
    this._baseRot = new THREE.Euler();
    this._tmp = new THREE.Vector3();
    this._hand = new THREE.Vector3();
    this._sh = new THREE.Vector3();
  }

  // --------------------------------------------------------
  _buildArm(skin) {
    const g = new THREE.Group();
    const geo = mergeBoxes([
      { x: 0, y: 0, z: 0.0, w: 0.085, h: 0.095, d: 0.13, color: skin },          // Hand
      { x: 0, y: 0, z: 0.10, w: 0.10, h: 0.10, d: 0.05, color: 0x2a3040 },       // Manschette
    ]);
    const hand = new THREE.Mesh(geo, MAT_VC);
    const sleeveGeo = mergeBoxes([{ x: 0, y: 0, z: 0.5, w: 0.09, h: 0.09, d: 1.0, color: 0x3b4152 }]);
    const sleeve = new THREE.Mesh(sleeveGeo, MAT_VC);
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
    this.mesh = new THREE.Mesh(mergeBoxes(weapon.parts || []), MAT_VC);
    this.mesh.scale.setScalar(weapon.melee ? VM_SCALE * MELEE_SCALE : VM_SCALE);
    this.root.add(this.mesh);

    const hold = weapon.hold || 'rifle';
    const vp = weapon.vmPos || HIP_POS[hold] || HIP_POS.rifle;
    this._basePos.set(vp[0], vp[1], vp[2]);
    const vr = weapon.vmRot || [0, 0, 0];
    this._baseRot.set(vr[0], vr[1], vr[2]);

    // Visier auf Bildmitte: x = 0, y = -Visierhoehe * Massstab
    const sy = SIGHT_Y[weapon.id] !== undefined ? SIGHT_Y[weapon.id] : 0.11;
    this._adsPos.set(0, -sy * VM_SCALE, ADS_Z);

    // Das Muendungsfeuer haengt am ungescalten Knoten -> Position mitskalieren
    const mz = weapon.muzzle || [0, 0, -1];
    this.flash.position.set(mz[0] * VM_SCALE, mz[1] * VM_SCALE, (mz[2] - 0.05) * VM_SCALE);
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
    this.recoilPos = Math.min(0.28, this.recoilPos + 0.055 * s * (w ? w.kick / 0.05 : 1) * 0.9);
    this.recoilRot = Math.min(0.5, this.recoilRot + 0.09 * s * (w ? w.kick / 0.05 : 1) * 0.55);
    this.recoilRoll += rand(-0.045, 0.045) * s;

    // Muendungsfeuer
    if (w && !w.melee && !w.projectile) {
      this._showFlash(rand(0.22, 0.36));
    } else if (w && w.projectile && w.id !== 'grenade') {
      this._showFlash(rand(0.32, 0.5));
    }
  }

  /** Nahkampf-Animation der aktuellen Waffe (oder Kolbenschlag / Wurf) */
  melee(kind) {
    const w = this.weapon;
    let k = kind;
    if (!k) {
      if (w && w.swing === 'sweep') k = this.swingSide ? 'sweep2' : 'sweep';
      else if (w && w.swing === 'slash') k = this.swingSide ? 'slash2' : 'slash';
      else k = 'bash';
    }
    this.swingSide ^= 1;
    this.swingKind = k;
    this.swingDur = (w && w.melee && w.swingTime) ? w.swingTime : 0.34;
    if (k === 'throw') this.swingDur = 0.45;
    this.swingT = this.swingDur;
  }

  _showFlash(scale) {
    this.flash.visible = true;
    this.flash.scale.setScalar(scale);
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flashMat.opacity = 1;
    this.flashLife = 0.045;
  }

  setFlashTexture(tex) { this.flashMat.map = tex; this.flashMat.needsUpdate = true; }

  setHidden(v) { this.hidden = v; this.root.visible = !v; }

  /** Weltposition der Muendung in der VM-Szene */
  muzzleLocal(out) {
    const mz = this.weapon ? (this.weapon.muzzle || [0, 0, -1]) : [0, 0, -1];
    out.set(mz[0], mz[1], mz[2]);
    if (!this.mesh) return out;
    this.mesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  // --------------------------------------------------------
  /** Arm (Kind von root) auf eine Hand-Weltposition setzen und zur Schulter ausrichten */
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
   * s: {adsTarget, moveSpeed, grounded, sprint, crouch, slide, firing, lookDX, lookDY, landImpact}
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

    // ---- Sprint-Pose ----
    const sprinting = s.sprint && s.moveSpeed > 4 && s.grounded && !s.firing && this.ads < 0.05 && this.swingT <= 0;
    this.sprintT = damp(this.sprintT, sprinting ? 1 : 0, 11, dt);

    // ---- Sway ----
    this.swayTarget.x = clamp(-(s.lookDX || 0) * 0.012, -0.05, 0.05);
    this.swayTarget.y = clamp((s.lookDY || 0) * 0.012, -0.05, 0.05);
    this.sway.x = damp(this.sway.x, this.swayTarget.x, 10, dt);
    this.sway.y = damp(this.sway.y, this.swayTarget.y, 10, dt);

    // ---- Bob ----
    const bobScale = settings.viewBob * lerp(1, 0.25, this.ads);
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

    // ---- Rueckstoss abklingen ----
    this.recoilPos = damp(this.recoilPos, 0, 13, dt);
    this.recoilRot = damp(this.recoilRot, 0, 11, dt);
    this.recoilRoll = damp(this.recoilRoll, 0, 9, dt);

    // ---- Nachladen / Wechsel / Melee ----
    if (this.reloadT > 0) this.reloadT = Math.max(0, this.reloadT - dt);
    if (this.switchT > 0) this.switchT = Math.max(0, this.switchT - dt);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt);

    // ---- Zielposition zusammensetzen ----
    const p = this._tmp;
    const adsK = w.melee ? 0 : this.ads;
    p.copy(this._basePos).lerp(this._adsPos, adsK);
    p.x += this.bob.x + this.sway.x;
    p.y += this.bob.y + this.sway.y - this.landT * 0.09;
    p.z += this.recoilPos;

    let rx = -this.recoilRot + this.sway.y * 1.4 + this.landT * 0.22;
    let ry = -this.sway.x * 2.2;
    let rz = this.recoilRoll + this.bob.x * 0.9;

    // Atmen (Idle)
    const breath = Math.sin(this.time * 1.7) * (1 - adsK * 0.8);
    p.y += breath * 0.0025;
    rx += breath * 0.004;

    // Sprint
    if (this.sprintT > 0.001) {
      const st = this.sprintT;
      if (hold === 'knife' || hold === 'katana') {
        p.x += st * 0.05; p.y += st * -0.10; p.z += st * 0.06;
        rx += st * -0.25; ry += st * 0.5; rz += st * 0.3;
      } else if (hold === 'pistol' || hold === 'akimbo') {
        p.x += st * 0.05; p.y += st * -0.07; p.z += st * 0.08;
        rx += st * 0.30; ry += st * 0.40; rz += st * 0.25;
      } else {
        p.x += st * 0.06; p.y += st * -0.05; p.z += st * 0.10;
        rx += st * 0.18; ry += st * 0.62; rz += st * 0.42;
      }
    }

    // Nachladen: Waffe kippen, Hand zum Magazin
    let magK = 0;
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT / this.reloadDur;     // 0..1
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

    // Waffenwechsel: von unten hochziehen
    if (this.switchT > 0) {
      const t = this.switchT / this.switchDur;         // 1 -> 0
      p.y -= t * 0.42;
      rx += t * 0.95;
      rz += t * 0.3;
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

    // Haltungsrotation der Waffe (beim Zielen gerade)
    const br = this._baseRot;
    this.mesh.rotation.set(br.x * (1 - adsK), br.y * (1 - adsK), br.z * (1 - adsK));

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
      // Einhaendig: linke Hand locker unten links, beim Nachladen zum Magazin
      this._hand.copy(FREE_HAND_L);
      if (magK > 0 && MAG_POINT[hold]) {
        const mp = MAG_POINT[hold];
        _v.set(mp[0], mp[1], mp[2]);
        this.mesh.localToWorld(_v);
        this._hand.lerp(_v, magK);
      }
      this._placeArm(this.armL, this._hand, SHOULDER_L);
    }

    // ---- Muendungsfeuer ausblenden ----
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashMat.opacity = clamp(this.flashLife / 0.045, 0, 1);
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  dispose() {
    if (this.mesh) this.mesh.geometry.dispose();
    for (const a of [this.armR, this.armL]) if (a) a.userData.geos.forEach(g => g.dispose());
    this.scene.remove(this.root);
    this.flash.geometry.dispose();
    this.flashMat.dispose();
  }
}
