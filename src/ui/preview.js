// ============================================================
// 3D-Vorschauen im Menue (eigener kleiner Renderer pro Canvas):
//   SkinPreview  - Waffe mit Skin und Sticker
//   CharPreview  - Spielfigur mit Outfit, Kopfbedeckung und Waffe
// ============================================================

import * as THREE from 'three';
import { mergeBoxes } from '../fx/geom.js';
import { makePropMaterial, makeSkyMaterial, buildEnvironment } from '../fx/materials.js';
import { applySkin } from '../game/skins.js';
import { buildStickerGroup } from '../game/stickers.js';
import { CharacterModel } from '../game/character.js';
import { figureColors, KILL_EFFECT_BY_ID } from '../game/cosmetics.js';
import { WEAPONS } from '../game/weapons.js';
import { Effects } from '../fx/effects.js';
import { audio } from '../core/audio.js';

const PREVIEW_SKY = {
  skyTop: 0x3f7cc4, skyBottom: 0xf0d9ac, sunDir: [0.52, 0.74, 0.42], sunColor: 0xfff2d6,
};

class PreviewBase {
  constructor(canvas, camPos, lookAt, fov) {
    this.canvas = canvas;
    this.renderer = null;
    this.running = false;
    this.angle = 0;
    this.last = 0;
    this.dragging = false;
    this.dragVel = 0;
    this._camPos = camPos;
    this._lookAt = lookAt;
    this._fov = fov || 32;
    this._init();
  }

  _init() {
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) {
      this.renderer = null;
      return;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this._fov, 1, 0.05, 40);
    this.camera.position.set(this._camPos[0], this._camPos[1], this._camPos[2]);
    this.camera.lookAt(this._lookAt[0], this._lookAt[1], this._lookAt[2]);

    const key = new THREE.DirectionalLight(0xfff1de, 2.6);
    key.position.set(-1.2, 1.6, 1.4);
    const fill = new THREE.DirectionalLight(0x9fb8ff, 1.0);
    fill.position.set(1.4, -0.4, 0.8);
    const rim = new THREE.DirectionalLight(0xffffff, 1.2);
    rim.position.set(0.4, 0.8, -1.6);
    this.scene.add(key, fill, rim, new THREE.AmbientLight(0xffffff, 0.3));

    const sky = makeSkyMaterial(PREVIEW_SKY);
    this.envRT = buildEnvironment(this.renderer, sky);
    this.scene.environment = this.envRT.texture;
    sky.dispose();

    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    // Ziehen mit der Maus dreht das Objekt
    this.canvas.addEventListener('pointerdown', (e) => { this.dragging = true; this.lastX = e.clientX; this.canvas.setPointerCapture(e.pointerId); });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.angle += dx * 0.012;
      this.dragVel = dx * 0.012;
    });
    const up = () => { this.dragging = false; };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  _resize() {
    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 260;
    const pr = this.renderer.getPixelRatio();
    if (this.canvas.width !== Math.floor(w * pr) || this.canvas.height !== Math.floor(h * pr)) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  _frame(now) {
    if (!this.renderer || !this._hasContent()) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.dragging) {
      this.angle += dt * this._autoSpin() + this.dragVel;
      this.dragVel *= Math.exp(-dt * 4);
    }
    this._tick(dt, now);
    this._resize();
    this.renderer.render(this.scene, this.camera);
  }

  _hasContent() { return true; }
  _autoSpin() { return 0.55; }
  _tick() {}

  start() {
    if (this.running || !this.renderer) return;
    this.running = true;
    this.last = 0;
    const loop = (now) => {
      if (!this.running) return;
      this._frame(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }
}

// ------------------------------------------------------------
export class SkinPreview extends PreviewBase {
  constructor(canvas) {
    super(canvas, [0, 0.35, 2.6], [0, 0, 0], 32);
    this.mesh = null;
    this.weapon = null;
    this.skinId = 'default';
    this.stickerId = 'none';
    if (this.renderer) this.mat = makePropMaterial({ envMapIntensity: 0.9 });
  }

  _hasContent() { return !!this.mesh; }

  show(weapon, skinId, stickerId) {
    if (!this.renderer) return;
    this.weapon = weapon;
    this.skinId = skinId || 'default';
    this.stickerId = stickerId || 'none';
    if (this.mesh) { this.pivot.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh = null; }
    const geo = mergeBoxes(applySkin(weapon.parts || [], this.skinId), { chamfer: 0.0045 });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const size = new THREE.Vector3();
    bb.getSize(size);
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const scale = 1.55 / maxDim;
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.copy(center).multiplyScalar(-scale);
    this.mesh.scale.setScalar(scale);
    const st = buildStickerGroup(weapon, this.stickerId);
    if (st) this.mesh.add(st);
    this.pivot.add(this.mesh);
    // Lange Waffen leicht schraeg von der Seite zeigen
    this.pivot.rotation.set(0.18, 0, 0);
    this.angle = weapon.melee ? 0.9 : 1.2;
    this._frame(performance.now());
  }

  _tick(dt, now) {
    this.pivot.rotation.y = this.angle;
    this.pivot.position.y = Math.sin(now * 0.0012) * 0.03;
  }
}

// ------------------------------------------------------------
export class CharPreview extends PreviewBase {
  constructor(canvas) {
    super(canvas, [0, 1.6, 7.4], [0, 1.25, 0], 30);
    this.model = null;
    this.key = '';
    this._state = {
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, grounded: true, crouch: false, slide: false, wallrun: 0,
      dead: false, name: '', hp: 100, maxHp: 100, enemy: false, tagColor: '#fff', showTag: false,
    };
    this.angle = 0.35;
    this.walk = false;
    this.walkT = 0;
    this.hideT = 0;
    this.bodyColor = 0xd94a4a;
    if (this.renderer) {
      // Bodenplatte
      const g = new THREE.CylinderGeometry(1.1, 1.1, 0.08, 32);
      const m = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.8, metalness: 0.1 });
      const disc = new THREE.Mesh(g, m);
      disc.position.y = -0.04;
      this.scene.add(disc);
      this.disc = disc;
      // Partikel fuer die Kill-Effekt-Vorschau
      this.fx = new Effects(this.scene);
    }
  }

  /** Kill-Effekt an der Figur abspielen (Vorschau im Menue) */
  playEffect(id) {
    if (!this.renderer || !this.model || !this.fx) return;
    const def = KILL_EFFECT_BY_ID[id];
    if (!def || def.id === 'none') return;
    this.fx.killEffect(id, 0, 0, 0, this.bodyColor);
    audio.init(); audio.resume();
    audio.killEffect(id, null);
    if (def.hideBody) { this.model.setVisible(false); this.hideT = 1.6; }
    this.start();
  }

  _hasContent() { return !!this.model; }
  _autoSpin() { return 0.4; }

  /** cfg: { outfit, hat, weaponId, skinId, stickerId } */
  show(cfg) {
    if (!this.renderer) return;
    const key = [cfg.outfit, cfg.hat, cfg.weaponId, cfg.skinId, cfg.stickerId].join('|');
    if (key === this.key && this.model) return;
    this.key = key;
    if (this.model) { this.model.dispose(); this.model = null; }
    const c = figureColors(cfg.outfit || 'team', 0xd94a4a, false, 0xff8a8a);
    this.bodyColor = c.body;
    this.hideT = 0;
    this.model = new CharacterModel(this.scene, {
      color: c.body, accent: c.accent, pants: c.pants, cuff: c.cuff,
      skin: 0xd4a985, hair: 0x2a1e14, hat: cfg.hat || 'none', hatPrimary: c.hatPrimary, hatSecondary: c.hatSecondary,
      world: null, effects: null,
    });
    const w = WEAPONS[cfg.weaponId] || WEAPONS.ar;
    this.model.setWeapon(w, cfg.skinId || 'default', cfg.stickerId || 'none');
    this.model.setTagVisible(false);
    this._frame(performance.now());
  }

  _tick(dt, now) {
    const s = this._state;
    s.yaw = this.angle;
    // Leichte Laufanimation alle paar Sekunden
    this.walkT += dt;
    const cycle = this.walkT % 7;
    s.speed = cycle > 4.5 && cycle < 6.5 ? 6 : 0;
    s.pitch = Math.sin(now * 0.0009) * 0.12;
    this.model.update(dt, s, null);
    if (this.disc) this.disc.rotation.y = this.angle;
    if (this.fx) this.fx.update(dt, this.camera);
    if (this.hideT > 0) { this.hideT -= dt; if (this.hideT <= 0) this.model.setVisible(true); }
  }
}
