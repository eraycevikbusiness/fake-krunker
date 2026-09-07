// ============================================================
// Spielerfigur: klotziges Low-Poly-Modell + Animation + Nametag
// Gesamthoehe 2.4 Einheiten (siehe player.js -> HEIGHT)
// ============================================================

import * as THREE from 'three';
import { clamp, damp, angleDelta, lerp } from '../core/utils.js';

export const CHAR = {
  HEIGHT: 2.4,
  LEG_H: 0.92,
  TORSO_H: 0.88,
  HEAD_H: 0.6,
  SHOULDER: 0.86,
  DEPTH: 0.46,
};

const shared = {
  geoHead: null, geoTorso: null, geoArm: null, geoLeg: null, geoFoot: null,
};

function ensureGeo() {
  if (shared.geoHead) return;
  shared.geoHead = new THREE.BoxGeometry(CHAR.HEAD_H, CHAR.HEAD_H, CHAR.HEAD_H);
  shared.geoTorso = new THREE.BoxGeometry(CHAR.SHOULDER, CHAR.TORSO_H, CHAR.DEPTH);
  shared.geoArm = new THREE.BoxGeometry(0.24, 0.78, 0.26);
  shared.geoLeg = new THREE.BoxGeometry(0.32, CHAR.LEG_H, 0.34);
  shared.geoFoot = new THREE.BoxGeometry(0.34, 0.16, 0.48);
  // Pivot der Gliedmassen nach oben verschieben, damit sie schwingen
  shared.geoArm.translate(0, -0.39, 0);
  shared.geoLeg.translate(0, -CHAR.LEG_H / 2, 0);
}

function mat(color, flat) {
  return new THREE.MeshLambertMaterial({ color, flatShading: !!flat });
}

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
// Waffenmodell (klein, fuer Weltansicht)
// ------------------------------------------------------------
export function buildWeaponMesh(weapon, scale = 1) {
  const g = new THREE.Group();
  const parts = weapon.parts || [];
  for (const p of parts) {
    const geo = new THREE.BoxGeometry(p.w, p.h, p.d);
    const m = new THREE.Mesh(geo, mat(p.color));
    m.position.set(p.x, p.y, p.z);
    if (p.rot) m.rotation.set(p.rot.x || 0, p.rot.y || 0, p.rot.z || 0);
    m.castShadow = true;
    g.add(m);
  }
  g.scale.setScalar(scale);
  return g;
}

// ------------------------------------------------------------
export class CharacterModel {
  constructor(scene, opts) {
    ensureGeo();
    this.scene = scene;
    this.opts = opts;

    const skin = opts.skin || 0xe0b090;
    const body = opts.color || 0x3366cc;
    const pants = opts.pants || 0x2a3040;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();      // fuer Todes-Animation
    this.root.add(this.pivot);

    // Beine
    this.legL = new THREE.Mesh(shared.geoLeg, mat(pants));
    this.legR = new THREE.Mesh(shared.geoLeg, mat(pants));
    this.legL.position.set(-0.2, CHAR.LEG_H, 0);
    this.legR.position.set(0.2, CHAR.LEG_H, 0);
    this.pivot.add(this.legL, this.legR);

    // Torso
    this.torso = new THREE.Mesh(shared.geoTorso, mat(body));
    this.torso.position.set(0, CHAR.LEG_H + CHAR.TORSO_H / 2, 0);
    this.pivot.add(this.torso);

    // Weste / Team-Streifen
    const vest = new THREE.Mesh(
      new THREE.BoxGeometry(CHAR.SHOULDER + 0.04, 0.3, CHAR.DEPTH + 0.04),
      mat(opts.accent || 0xffffff)
    );
    vest.position.set(0, CHAR.LEG_H + CHAR.TORSO_H - 0.28, 0);
    this.pivot.add(vest);

    // Kopf (eigener Pivot fuer Pitch)
    this.neck = new THREE.Group();
    this.neck.position.set(0, CHAR.LEG_H + CHAR.TORSO_H, 0);
    this.pivot.add(this.neck);
    this.head = new THREE.Mesh(shared.geoHead, mat(skin));
    this.head.position.set(0, CHAR.HEAD_H / 2, 0);
    this.neck.add(this.head);

    // Gesicht (dunkle Front) + Muetze
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(CHAR.HEAD_H * 0.72, CHAR.HEAD_H * 0.3, 0.04),
      mat(0x241f1c)
    );
    face.position.set(0, CHAR.HEAD_H / 2 + 0.04, -CHAR.HEAD_H / 2 - 0.02);
    this.neck.add(face);
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(CHAR.HEAD_H + 0.06, 0.16, CHAR.HEAD_H + 0.06),
      mat(body)
    );
    cap.position.set(0, CHAR.HEAD_H - 0.02, 0);
    this.neck.add(cap);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(CHAR.HEAD_H, 0.07, 0.24), mat(body));
    brim.position.set(0, CHAR.HEAD_H - 0.06, -CHAR.HEAD_H / 2 - 0.06);
    this.neck.add(brim);

    // Arme
    this.armL = new THREE.Mesh(shared.geoArm, mat(skin));
    this.armR = new THREE.Mesh(shared.geoArm, mat(skin));
    this.armL.position.set(-(CHAR.SHOULDER / 2 + 0.12), CHAR.LEG_H + CHAR.TORSO_H - 0.06, 0);
    this.armR.position.set(CHAR.SHOULDER / 2 + 0.12, CHAR.LEG_H + CHAR.TORSO_H - 0.06, 0);
    this.pivot.add(this.armL, this.armR);

    // Waffe haengt an einem eigenen Knoten am Oberkoerper (nicht am
    // rotierten Arm) - sonst zeigt der Lauf in die Armachse statt nach vorn.
    this.weaponHolder = new THREE.Group();
    this.weaponHolder.position.set(0.48, CHAR.LEG_H + CHAR.TORSO_H - 0.06, -0.62);
    this.pivot.add(this.weaponHolder);
    this.weaponMesh = null;

    for (const m of [this.legL, this.legR, this.torso, this.head, this.armL, this.armR, vest, cap, brim, face]) {
      m.castShadow = true;
      m.receiveShadow = false;
    }

    // Nametag
    this.tag = new NameTag();
    this.tag.sprite.position.set(0, CHAR.HEIGHT + 0.62, 0);
    this.root.add(this.tag.sprite);

    scene.add(this.root);

    // Animationszustand
    this.phase = 0;
    this.legSwing = 0;
    this.bodyYaw = 0;
    this.headPitch = 0;
    this.recoilT = 0;
    this.crouchT = 0;
    this.deathT = 0;
    this.deathDir = 0;
    this.visible = true;
  }

  setWeapon(weapon) {
    if (this.weaponMesh) {
      this.weaponHolder.remove(this.weaponMesh);
      this.weaponMesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    this.weaponMesh = buildWeaponMesh(weapon, 0.9);
    // Griff ungefaehr auf Handhoehe legen
    this.weaponMesh.position.set(0, 0.14, -0.12);
    this.weaponHolder.add(this.weaponMesh);
    this.currentWeapon = weapon;
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

  startDeath(dirX, dirZ) {
    this.deathT = 0.0001;
    this.deathDir = Math.atan2(dirX, dirZ);
  }

  resetDeath() {
    this.deathT = 0;
    this.pivot.rotation.set(0, 0, 0);
    this.pivot.position.set(0, 0, 0);
    this.root.scale.setScalar(1);
  }

  /**
   * state: {x,y,z, yaw, pitch, speed, grounded, crouch, dead, name, hp, maxHp, color, enemy}
   */
  update(dt, s, camPos) {
    const r = this.root;
    r.position.set(s.x, s.y, s.z);

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
    this.pivot.scale.y = 1 - this.crouchT * 0.32;
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
    this.legL.position.y = CHAR.LEG_H + Math.abs(sw) * 0.03;
    this.legR.position.y = CHAR.LEG_H + Math.abs(sw) * 0.03;
    this.torso.rotation.z = sw2 * 0.5;
    this.torso.position.y = CHAR.LEG_H + CHAR.TORSO_H / 2 - Math.abs(sw) * 0.045;
    this.neck.position.y = CHAR.LEG_H + CHAR.TORSO_H - Math.abs(sw) * 0.045;

    // In der Luft: Beine anziehen
    if (!s.grounded) {
      this.legL.rotation.x = lerp(this.legL.rotation.x, -0.55, 0.35);
      this.legR.rotation.x = lerp(this.legR.rotation.x, 0.3, 0.35);
    }

    // ---- Arme: Waffe nach vorn halten ----
    this.recoilT = damp(this.recoilT, 0, 12, dt);
    const isMelee = this.currentWeapon && this.currentWeapon.melee;
    // +PI/2 dreht den nach unten haengenden Arm nach VORNE (-Z).
    // Groesserer Winkel = weiter nach oben, passend zum Blickwinkel.
    const aimX = Math.PI / 2 + this.headPitch * 0.95 - this.recoilT * 0.35;

    if (isMelee) {
      this.armR.rotation.set(1.15 + this.recoilT * 1.5, 0, -0.25);
      this.armL.rotation.set(0.45 + sw * 0.4, 0, 0.2);
      this.weaponHolder.rotation.set(1.1 + this.recoilT * 1.4, 0, 0);
      this.weaponHolder.position.set(0.42, CHAR.LEG_H + CHAR.TORSO_H - 0.1, -0.5);
    } else {
      this.armR.rotation.set(aimX, -0.12, -0.16);
      this.armL.rotation.set(aimX + 0.08, 0.34, 0.42);
      // Waffe folgt dem Blickwinkel und weicht beim Schuss zurueck
      this.weaponHolder.rotation.set(this.headPitch * 0.95, 0, 0);
      this.weaponHolder.position.set(
        0.48, CHAR.LEG_H + CHAR.TORSO_H - 0.06 - Math.abs(sw) * 0.04,
        -0.62 + this.recoilT * 0.14
      );
    }
    this.armL.position.y = CHAR.LEG_H + CHAR.TORSO_H - 0.06 - Math.abs(sw) * 0.045;
    this.armR.position.y = this.armL.position.y;

    // ---- Nametag ----
    if (s.showTag !== false) {
      this.tag.sprite.visible = true;
      this.tag.draw(s.name, s.hp / s.maxHp, s.tagColor || '#ffffff', s.enemy);
      if (camPos) {
        const d = Math.hypot(camPos.x - s.x, camPos.y - s.y, camPos.z - s.z);
        const sc = clamp(d * 0.055, 0.9, 3.4);
        this.tag.sprite.scale.set(sc * 1.15, sc * 0.31, 1);
        this.tag.sprite.position.y = CHAR.HEIGHT * (1 - this.crouchT * 0.32) + 0.55;
      }
    } else {
      this.tag.sprite.visible = false;
    }
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry && o.geometry !== shared.geoHead && o.geometry !== shared.geoTorso &&
          o.geometry !== shared.geoArm && o.geometry !== shared.geoLeg) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.tag.tex.dispose();
    this.tag.mat.dispose();
  }
}
