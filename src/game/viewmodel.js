// ============================================================
// Ego-Waffenansicht (eigene Szene -> kein Clipping durch Waende)
// ============================================================

import * as THREE from 'three';
import { clamp, damp, lerp, rand } from '../core/utils.js';
import { settings } from '../core/settings.js';

// Massstab des Waffenmodells in der Egoansicht. Ohne Verkleinerung
// stehen die hinteren Teile fast in der Kamera -> extreme Perspektive.
const VM_SCALE = 0.53;

// Standard-Ablage der Waffe (Hueftposition) und ADS-Abstand
const HIP_POS = { rifle: [0.185, -0.155, -0.72], pistol: [0.145, -0.15, -0.62], melee: [0.16, -0.17, -0.54] };
const ADS_Z = -0.74;

// Hoehe der Visierlinie im Waffen-Koordinatensystem.
// Beim Zielen wird die Waffe so verschoben, dass sie exakt auf der Bildmitte liegt.
const SIGHT_Y = {
  ar: 0.118, smg: 0.102, sniper: 0.146, shotgun: 0.108, lmg: 0.128,
  marksman: 0.112, burst: 0.112, revolver: 0.078, pistol: 0.072,
  rpg: 0.132, crossbow: 0.102, akimbo: 0.02,
};

function mkMat(color) {
  return new THREE.MeshLambertMaterial({ color });
}

export class ViewModel {
  constructor(scene) {
    this.scene = scene;

    this.root = new THREE.Group();          // Sway / Bob / Sprint
    this.recoilNode = new THREE.Group();    // Rueckstoss
    this.weaponNode = new THREE.Group();    // Waffenmodell + Arme
    this.root.add(this.recoilNode);
    this.recoilNode.add(this.weaponNode);
    scene.add(this.root);

    this.weapon = null;
    this.mesh = null;
    this.arms = null;

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
    this.weaponNode.add(this.flash);
    this.flashLife = 0;

    // Animationszustand
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
    this.meleeT = 0;
    this.hidden = false;

    this._basePos = new THREE.Vector3();
    this._adsPos = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  // --------------------------------------------------------
  setWeapon(weapon, skinColor) {
    if (this.mesh) {
      this.weaponNode.remove(this.mesh);
      this.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.weapon = weapon;
    this.mesh = new THREE.Group();

    for (const p of weapon.parts) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(p.w, p.h, p.d), mkMat(p.color));
      m.position.set(p.x, p.y, p.z);
      if (p.rot) m.rotation.set(p.rot.x || 0, p.rot.y || 0, p.rot.z || 0);
      this.mesh.add(m);
    }

    // Haende / Arme
    const skin = skinColor || 0xe0b090;
    const sleeve = 0x3b4152;
    const addArm = (x, y, z, rx, ry, rz, len) => {
      const g = new THREE.Group();
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.125, len, 0.125), mkMat(sleeve));
      upper.position.set(0, -len / 2, 0);
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.06, 0.135), mkMat(0x2a3040));
      cuff.position.set(0, -0.045, 0);
      const hand = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.13, 0.15), mkMat(skin));
      hand.position.set(0, 0.035, 0);
      g.add(upper, cuff, hand);
      g.position.set(x, y, z);
      g.rotation.set(rx, ry, rz);
      this.mesh.add(g);
      return g;
    };

    // Unterarme zeigen nach unten-hinten (zur Schulter), nicht nach vorn.
    // rx < 0 kippt Richtung +Z (zur Kamera), rz > 0 kippt nach rechts.
    if (weapon.melee) {
      addArm(0.03, -0.05, 0.14, -0.5, 0, 0.28, 0.52);
    } else if (weapon.id === 'akimbo') {
      addArm(-0.13, -0.09, 0.04, -0.6, 0, -0.26, 0.46);
      addArm(0.13, -0.09, 0.04, -0.6, 0, 0.26, 0.46);
    } else if (weapon.slot === 1) {
      addArm(0.01, -0.10, 0.02, -0.6, 0, 0.30, 0.50);
      addArm(-0.05, -0.11, -0.01, -0.66, 0, -0.14, 0.48);
    } else {
      addArm(0.02, -0.09, 0.10, -0.55, 0, 0.34, 0.55);       // Griffhand
      addArm(-0.02, -0.08, -0.52, -0.78, 0, -0.46, 0.62);    // Stuetzhand
    }

    this.weaponNode.add(this.mesh);

    this.mesh.scale.setScalar(VM_SCALE);

    const kind = weapon.melee ? 'melee' : weapon.slot === 1 ? 'pistol' : 'rifle';
    const vp = weapon.vmPos || HIP_POS[kind];
    this._basePos.set(vp[0], vp[1], vp[2]);

    // Visier auf Bildmitte: x = 0, y = -Visierhoehe * Massstab
    const sy = SIGHT_Y[weapon.id] !== undefined ? SIGHT_Y[weapon.id] : 0.11;
    this._adsPos.set(0, -sy * VM_SCALE, ADS_Z);

    // Das Muendungsfeuer haengt am ungescalten Knoten -> Position mitskalieren
    const mz = weapon.muzzle || [0, 0, -1];
    this.flash.position.set(mz[0] * VM_SCALE, mz[1] * VM_SCALE, (mz[2] - 0.05) * VM_SCALE);
    this.flash.visible = false;
    this.flashLife = 0;

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

  melee() { this.meleeT = 0.34; }

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
    this.mesh.updateWorldMatrix(true, false);
    return out.applyMatrix4(this.mesh.matrixWorld);
  }

  // --------------------------------------------------------
  /**
   * s: {dt, adsTarget, moveSpeed, grounded, sprint, crouch, lookDX, lookDY, landImpact}
   */
  update(dt, s) {
    if (!this.weapon) return;
    const w = this.weapon;

    // ---- ADS ----
    const adsRate = 1 / Math.max(0.05, w.adsTime);
    const targetAds = s.adsTarget ? 1 : 0;
    this.ads += clamp(targetAds - this.ads, -dt * adsRate, dt * adsRate);
    this.ads = clamp(this.ads, 0, 1);

    // ---- Sprint-Pose ----
    const sprinting = s.sprint && s.moveSpeed > 4 && s.grounded && !s.firing && this.ads < 0.05;
    this.sprintT = damp(this.sprintT, sprinting ? 1 : 0, 11, dt);

    // ---- Sway ----
    const swayAmt = lerp(1, 0.25, this.ads);
    this.swayTarget.x = clamp(-(s.lookDX || 0) * 0.012, -0.05, 0.05);
    this.swayTarget.y = clamp((s.lookDY || 0) * 0.012, -0.05, 0.05);
    this.sway.x = damp(this.sway.x, this.swayTarget.x, 10, dt);
    this.sway.y = damp(this.sway.y, this.swayTarget.y, 10, dt);

    // ---- Bob ----
    const bobScale = settings.viewBob * lerp(1, 0.25, this.ads);
    const spd = s.grounded ? clamp(s.moveSpeed, 0, 16) : 0;
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
    if (this.meleeT > 0) this.meleeT = Math.max(0, this.meleeT - dt);

    // ---- Zielposition zusammensetzen ----
    const p = this._tmp;
    p.copy(this._basePos).lerp(this._adsPos, this.ads);
    p.x += this.bob.x + this.sway.x;
    p.y += this.bob.y + this.sway.y - this.landT * 0.09;
    p.z += this.recoilPos;

    let rx = -this.recoilRot + this.sway.y * 1.4 + this.landT * 0.22;
    let ry = -this.sway.x * 2.2;
    let rz = this.recoilRoll + this.bob.x * 0.9;

    // Sprint
    if (this.sprintT > 0.001) {
      p.x += this.sprintT * 0.06;
      p.y += this.sprintT * -0.05;
      p.z += this.sprintT * 0.10;
      rx += this.sprintT * 0.18;
      ry += this.sprintT * 0.62;
      rz += this.sprintT * 0.42;
    }

    // Nachladen: absenken + drehen
    if (this.reloadT > 0) {
      const t = 1 - this.reloadT / this.reloadDur;     // 0..1
      const curve = Math.sin(clamp(t, 0, 1) * Math.PI);
      p.y -= curve * 0.16;
      p.z += curve * 0.06;
      rx += curve * 0.55;
      rz += curve * 0.45;
      ry += Math.sin(t * Math.PI * 6) * 0.06 * curve;
    }

    // Waffenwechsel: von unten hochziehen
    if (this.switchT > 0) {
      const t = this.switchT / this.switchDur;         // 1 -> 0
      p.y -= t * 0.42;
      rx += t * 0.95;
    }

    // Nahkampf-Schlag
    if (this.meleeT > 0) {
      const t = 1 - this.meleeT / 0.34;
      const c = Math.sin(t * Math.PI);
      p.z -= c * 0.42;
      p.x -= c * 0.14;
      rx -= c * 0.65;
      rz += c * 0.9;
    }

    this.root.position.copy(p);
    this.root.rotation.set(rx, ry, rz);

    // ---- Muendungsfeuer ausblenden ----
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashMat.opacity = clamp(this.flashLife / 0.045, 0, 1);
      if (this.flashLife <= 0) this.flash.visible = false;
    }
  }

  dispose() {
    if (this.mesh) {
      this.mesh.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    this.scene.remove(this.root);
    this.flash.geometry.dispose();
    this.flashMat.dispose();
  }
}
