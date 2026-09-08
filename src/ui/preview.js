// ============================================================
// 3D-Vorschau fuer Waffen-Skins im Menue (eigener kleiner Renderer)
// ============================================================

import * as THREE from 'three';
import { mergeBoxes } from '../fx/geom.js';
import { makePropMaterial, makeSkyMaterial, buildEnvironment } from '../fx/materials.js';
import { applySkin } from '../game/skins.js';

const PREVIEW_SKY = {
  skyTop: 0x3f7cc4, skyBottom: 0xf0d9ac, sunDir: [0.52, 0.74, 0.42], sunColor: 0xfff2d6,
};

export class SkinPreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = null;
    this.running = false;
    this.mesh = null;
    this.weapon = null;
    this.skinId = 'default';
    this.angle = 0;
    this.last = 0;
    this.dragging = false;
    this.dragVel = 0;
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
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.05, 20);
    this.camera.position.set(0, 0.35, 2.6);
    this.camera.lookAt(0, 0, 0);

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

    this.mat = makePropMaterial({ envMapIntensity: 0.9 });
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);

    // Ziehen mit der Maus dreht die Waffe
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

  show(weapon, skinId) {
    if (!this.renderer) return;
    this.weapon = weapon;
    this.skinId = skinId || 'default';
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
    this.pivot.add(this.mesh);
    // Lange Waffen leicht schraeg von der Seite zeigen
    this.pivot.rotation.set(0.18, 0, 0);
    this.angle = weapon.melee ? 0.9 : 1.2;
    this._frame(performance.now());
  }

  _resize() {
    const w = this.canvas.clientWidth || 400, h = this.canvas.clientHeight || 260;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio()) || this.canvas.height !== Math.floor(h * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  _frame(now) {
    if (!this.renderer || !this.mesh) return;
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.dragging) {
      this.angle += dt * 0.55 + this.dragVel;
      this.dragVel *= Math.exp(-dt * 4);
    }
    this.pivot.rotation.y = this.angle;
    this.pivot.position.y = Math.sin(now * 0.0012) * 0.03;
    this._resize();
    this.renderer.render(this.scene, this.camera);
  }

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
