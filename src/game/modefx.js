// ============================================================
// Darstellung der Spielmodi (Client): Flaggen und Basen (CTF),
// Zone mit Ring und Lichtsaeule (Hardpoint), Bombenplaetze mit
// Buchstaben und die Bombe (S&D), Zombie-Knurren (Infection).
// Liest nur den Zustand des Modus-Objekts, aendert ihn nie.
// ============================================================

import * as THREE from 'three';
import { TEAM_COLOR } from './modes.js';
import { audio } from '../core/audio.js';

function disposeObj(o) {
  o.traverse((c) => {
    if (c.geometry) c.geometry.dispose();
    if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }
  });
}

/** Sprite mit Buchstabe (Bombenplaetze A/B), durch Waende sichtbar */
function letterSprite(text, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = colorHex; g.stroke();
  g.font = 'bold 72px Rajdhani, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = colorHex;
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 26;
  sp.scale.set(2.2, 2.2, 1);
  return sp;
}

export class ModeFx {
  constructor(game, mode) {
    this.game = game;
    this.mode = mode;
    this.scene = game.scene;
    this.objs = [];
    this.growlT = 3;
    const id = mode.id;
    if (id === 'ctf') this._buildCtf();
    else if (id === 'hardpoint') this._buildHardpoint();
    else if (id === 'sd') this._buildSd();
  }

  // ---- CTF ----
  _buildCtf() {
    this.flags = {};
    for (const team of ['red', 'blue']) {
      const f = this.mode.flags[team];
      const col = TEAM_COLOR[team];
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.7 }));
      pole.position.y = 1.6;
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.06), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.8 }));
      cloth.position.set(0.8, 2.7, 0);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.16, 24), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, transparent: true, opacity: 0.55 }));
      base.position.y = 0.08;
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      beam.position.y = 20;
      pole.castShadow = true; cloth.castShadow = true;
      g.add(pole, cloth, beam);
      const home = new THREE.Group();
      home.add(base);
      home.position.set(f.home.x, f.home.y, f.home.z);
      this.scene.add(g, home);
      this.objs.push(g, home);
      this.flags[team] = { mesh: g, cloth, beam };
    }
  }

  _updateCtf(dt) {
    const g = this.game;
    for (const team of ['red', 'blue']) {
      const f = this.mode.flags[team], v = this.flags[team];
      const m = v.mesh;
      if (f.state === 'carried' && f.carrier) {
        const c = f.carrier;
        m.position.set(c.pos.x + Math.sin(c.yaw) * 0.45, c.pos.y + 0.4, c.pos.z + Math.cos(c.yaw) * 0.45);
        m.rotation.set(0.35, c.yaw, 0);
        m.scale.setScalar(0.75);
        v.beam.visible = true;
      } else {
        m.position.set(f.x, f.y, f.z);
        m.rotation.set(0, g.time * 0.6, 0);
        m.scale.setScalar(1);
        v.beam.visible = f.state === 'dropped';
      }
      v.cloth.rotation.y = Math.sin(g.time * 3 + (team === 'red' ? 0 : 1)) * 0.15;
    }
  }

  // ---- Hardpoint ----
  _buildHardpoint() {
    const m = this.mode;
    const g = new THREE.Group();
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(m.radius, m.radius, 0.3, 32, 1, false), this.discMat);
    disc.position.y = 0.15;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(m.radius, m.radius, 2.4, 40, 1, true), this.ringMat);
    ring.position.y = 1.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 30;
    this.beam = beam;
    g.add(disc, ring, beam);
    this.zoneMesh = g;
    this.scene.add(g);
    this.objs.push(g);
  }

  _updateHardpoint(dt) {
    const m = this.mode, g = this.game;
    const z = m.zone;
    this.zoneMesh.position.set(z.x, z.y, z.z);
    const p = g.player;
    const meIn = !!(p && p.alive && m.inZone(p));
    const col = m.contested ? 0xffcc00 : m.owner === 'red' ? 0xff4444 : m.owner === 'blue' ? 0x4499ff : 0xffffff;
    this.discMat.color.setHex(col); this.ringMat.color.setHex(col); this.beam.material.color.setHex(col);
    // Von innen fast unsichtbar, sonst faerbt der Ring das ganze Bild
    this.ringMat.opacity = meIn ? 0.07 : 0.4;
    this.discMat.opacity = meIn ? 0.06 : 0.2;
    this.zoneMesh.rotation.y += dt * 0.4;
  }

  // ---- Search & Destroy ----
  _buildSd() {
    const m = this.mode;
    for (const s of m.sites) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.2, 28), new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
      disc.position.set(s.x, s.y + 0.1, s.z);
      const sp = letterSprite(s.name, '#ffcc00');
      sp.position.set(s.x, s.y + 3.2, s.z);
      this.scene.add(disc, sp);
      this.objs.push(disc, sp);
    }
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 }));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), toneMapped: false }));
    led.position.set(0.2, 0.2, 0);
    bm.add(led);
    bm.visible = false;
    this.bombMesh = bm; this.bombLed = led;
    this.scene.add(bm);
    this.objs.push(bm);
    this._blinkT = 0;
  }

  _updateSd(dt) {
    const b = this.mode.bomb;
    this.bombMesh.visible = !!b;
    if (!b) return;
    this.bombMesh.position.set(b.x, b.y + 0.18, b.z);
    const rate = b.t < 10 ? 0.25 : b.t < 20 ? 0.5 : 1;
    this._blinkT -= dt;
    if (this._blinkT <= 0) { this._blinkT = rate; this.bombLed.visible = !this.bombLed.visible; }
  }

  // ---- Infection: Knurren in der Naehe ----
  _updateInfection(dt) {
    const g = this.game;
    if (!this.mode.started) return;
    this.growlT -= dt;
    if (this.growlT > 0) return;
    this.growlT = 3 + Math.random() * 4;
    const p = g.player;
    if (!p) return;
    const z = g.actors.find(a => a.zombie && a.alive && a !== p && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 30);
    if (z) audio.growl({ x: z.pos.x, y: z.pos.y + 1.5, z: z.pos.z });
  }

  update(dt) {
    const id = this.mode.id;
    if (id === 'ctf') this._updateCtf(dt);
    else if (id === 'hardpoint') this._updateHardpoint(dt);
    else if (id === 'sd') this._updateSd(dt);
    else if (id === 'infection') this._updateInfection(dt);
  }

  dispose() {
    for (const o of this.objs) { this.scene.remove(o); disposeObj(o); }
    this.objs = [];
  }
}
