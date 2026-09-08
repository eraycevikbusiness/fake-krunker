// ============================================================
// Visuelle Effekte: Partikel, Tracer, Decals, Explosionen
// ============================================================

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { rand, clamp } from '../core/utils.js';

// ------------------------------------------------------------
// Partikelsystem (GPU-Points, CPU-Simulation)
// ------------------------------------------------------------
const PARTICLE_VS = `
attribute float psize;
attribute float palpha;
attribute vec3 pcolor;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pcolor;
  vAlpha = palpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize * 620.0 / max(0.001, -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const PARTICLE_FS = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  float r2 = dot(d, d);
  if (r2 > 0.25) discard;
  float edge = smoothstep(0.25, 0.06, r2);
  gl_FragColor = vec4(vColor, vAlpha * edge);
}
`;

class ParticleSystem {
  constructor(scene, capacity, additive) {
    this.cap = capacity;
    this.count = 0;
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.a0 = new Float32Array(capacity);

    const g = new THREE.BufferGeometry();
    this.attrPos = new THREE.BufferAttribute(this.pos, 3);
    this.attrCol = new THREE.BufferAttribute(this.col, 3);
    this.attrSize = new THREE.BufferAttribute(this.size, 1);
    this.attrAlpha = new THREE.BufferAttribute(this.alpha, 1);
    for (const a of [this.attrPos, this.attrCol, this.attrSize, this.attrAlpha]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.attrPos);
    g.setAttribute('pcolor', this.attrCol);
    g.setAttribute('psize', this.attrSize);
    g.setAttribute('palpha', this.attrAlpha);
    g.setDrawRange(0, 0);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const m = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.geo = g;
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.maxTouched = 0;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, o) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0;   // aeltesten ueberschreiben (grob)

    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i3] = o.r; this.col[i3 + 1] = o.g; this.col[i3 + 2] = o.b;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size0[i] = o.size0;
    this.size1[i] = o.size1 !== undefined ? o.size1 : 0;
    this.size[i] = o.size0;
    this.a0[i] = o.alpha !== undefined ? o.alpha : 1;
    this.alpha[i] = this.a0[i];
    this.grav[i] = o.gravity !== undefined ? o.gravity : 0;
    this.drag[i] = o.drag !== undefined ? o.drag : 0;
  }

  update(dt) {
    if (this.count === 0 && this.maxTouched === 0) return;
    // Achtung: this.count schrumpft im Schleifenkoerper -> nicht cachen
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        // Slot am Ende einsammeln
        const last = this.count - 1;
        if (i !== last) this._swap(i, last);
        this.count--;
        i--;
        continue;
      }
      const i3 = i * 3;
      const d = 1 - this.drag[i] * dt;
      this.vel[i3] *= d;
      this.vel[i3 + 1] = this.vel[i3 + 1] * d - this.grav[i] * dt;
      this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;

      const t = 1 - this.life[i] / this.maxLife[i];
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      this.alpha[i] = this.a0[i] * (1 - t * t);
    }
    // Nur den benutzten Bereich zur GPU schicken
    const n = Math.max(this.count, this.maxTouched);
    this.maxTouched = this.count;
    this.geo.setDrawRange(0, this.count);
    if (n > 0) {
      this._flag(this.attrPos, n * 3);
      this._flag(this.attrCol, n * 3);
      this._flag(this.attrSize, n);
      this._flag(this.attrAlpha, n);
    }
  }

  _flag(attr, count) {
    if (attr.clearUpdateRanges) { attr.clearUpdateRanges(); attr.addUpdateRange(0, count); }
    attr.needsUpdate = true;
  }

  _swap(a, b) {
    const a3 = a * 3, b3 = b * 3;
    for (let k = 0; k < 3; k++) {
      let t = this.pos[a3 + k]; this.pos[a3 + k] = this.pos[b3 + k]; this.pos[b3 + k] = t;
      t = this.vel[a3 + k]; this.vel[a3 + k] = this.vel[b3 + k]; this.vel[b3 + k] = t;
      t = this.col[a3 + k]; this.col[a3 + k] = this.col[b3 + k]; this.col[b3 + k] = t;
    }
    const arrs = ['size', 'alpha', 'life', 'maxLife', 'grav', 'drag', 'size0', 'size1', 'a0'];
    for (let j = 0; j < arrs.length; j++) {
      const k = arrs[j];
      const t = this[k][a]; this[k][a] = this[k][b]; this[k][b] = t;
    }
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
}

// ------------------------------------------------------------
// Texturen
// ------------------------------------------------------------
function makeHoleTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(0,0,0,0.95)');
  grd.addColorStop(0.35, 'rgba(10,10,10,0.75)');
  grd.addColorStop(0.62, 'rgba(40,35,30,0.30)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.fill();
  // Ein paar Splitter
  g.strokeStyle = 'rgba(0,0,0,0.4)';
  g.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = 8 + Math.random() * 4;
    const r1 = r0 + 5 + Math.random() * 10;
    g.beginPath();
    g.moveTo(S / 2 + Math.cos(a) * r0, S / 2 + Math.sin(a) * r0);
    g.lineTo(S / 2 + Math.cos(a) * r1, S / 2 + Math.sin(a) * r1);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeFlashTexture() {
  const S = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grd.addColorStop(0, 'rgba(255,255,240,1)');
  grd.addColorStop(0.22, 'rgba(255,225,130,0.92)');
  grd.addColorStop(0.55, 'rgba(255,150,30,0.35)');
  grd.addColorStop(1, 'rgba(255,120,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  // Sternzacken
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,240,190,0.8)';
  g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.lineTo(S / 2 + Math.cos(a) * S * 0.48, S / 2 + Math.sin(a) * S * 0.48);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------
// Effekt-Manager
// ------------------------------------------------------------
const MAX_DECALS = 90;
const MAX_TRACERS = 80;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticleSystem(scene, 1400, true);
    this.smoke = new ParticleSystem(scene, 900, false);

    this.holeTex = makeHoleTexture();
    this.flashTex = makeFlashTexture();

    // ---- Decals ----
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalMat = new THREE.MeshBasicMaterial({
      map: this.holeTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      opacity: 1,
    });
    this.decals = [];
    this.decalIdx = 0;
    this.decalGroup = new THREE.Group();
    scene.add(this.decalGroup);
    for (let i = 0; i < MAX_DECALS; i++) {
      const m = new THREE.Mesh(this.decalGeo, this.decalMat.clone());
      m.visible = false;
      m.renderOrder = 5;
      this.decalGroup.add(m);
      this.decals.push({ mesh: m, life: 0 });
    }

    // ---- Tracer ----
    this.tracerGeo = new THREE.BoxGeometry(1, 1, 1);
    this.tracers = [];
    this.tracerGroup = new THREE.Group();
    scene.add(this.tracerGroup);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe08a, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const m = new THREE.Mesh(this.tracerGeo, mat);
      m.visible = false;
      m.renderOrder = 8;
      this.tracerGroup.add(m);
      this.tracers.push({ mesh: m, life: 0, maxLife: 1 });
    }
    this.tracerIdx = 0;

    // ---- Explosions-Sphaere ----
    this.blastGeo = new THREE.SphereGeometry(1, 14, 10);
    this.blasts = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffaa33, transparent: true, opacity: 0.8,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      });
      const m = new THREE.Mesh(this.blastGeo, mat);
      m.visible = false;
      scene.add(m);
      this.blasts.push({ mesh: m, life: 0, maxLife: 1, radius: 1 });
    }
    this.blastIdx = 0;

    // ---- Muendungsfeuer (Welt, fuer andere Spieler) ----
    this.flashGeo = new THREE.PlaneGeometry(1, 1);
    this.flashes = [];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(this.flashGeo, mat);
      m.visible = false;
      m.renderOrder = 9;
      scene.add(m);
      this.flashes.push({ mesh: m, life: 0 });
    }
    this.flashIdx = 0;

    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._up = new THREE.Vector3(0, 1, 0);
    this._fwd = new THREE.Vector3(0, 0, 1);
    this._col = new THREE.Color();
  }

  get amount() { return settings.particles; }

  // --------------------------------------------------------
  tracer(fx, fy, fz, tx, ty, tz, color, width) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const dx = tx - fx, dy = ty - fy, dz = tz - fz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.05) return;
    const m = t.mesh;
    m.visible = true;
    m.position.set((fx + tx) / 2, (fy + ty) / 2, (fz + tz) / 2);
    this._v.set(dx / len, dy / len, dz / len);
    m.quaternion.setFromUnitVectors(this._fwd, this._v);
    m.scale.set(width || 0.05, width || 0.05, len);
    m.material.color.setHex(color || 0xffe08a);
    m.material.opacity = 0.85;
    t.life = t.maxLife = 0.055 + len * 0.0006;
  }

  /** Einschlag in Geometrie */
  impact(x, y, z, nx, ny, nz, colorHex) {
    const amt = this.amount;
    if (amt <= 0) return;
    const c = this._col.setHex(colorHex === undefined ? 0xbba97a : colorHex);
    const n = Math.round(7 * amt);
    for (let i = 0; i < n; i++) {
      const sx = nx + rand(-0.8, 0.8), sy = ny + rand(-0.4, 1.0), sz = nz + rand(-0.8, 0.8);
      const sp = rand(2.5, 9);
      this.sparks.spawn(x + nx * 0.03, y + ny * 0.03, z + nz * 0.03,
        sx * sp, sy * sp, sz * sp,
        { r: 1, g: 0.78, b: 0.33, life: rand(0.14, 0.34), size0: rand(0.03, 0.07), size1: 0.005, gravity: 16, drag: 2.2, alpha: 1 });
    }
    const m = Math.round(4 * amt);
    for (let i = 0; i < m; i++) {
      this.smoke.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05,
        nx * rand(0.4, 2) + rand(-1, 1), ny * rand(0.4, 2) + rand(0, 1.4), nz * rand(0.4, 2) + rand(-1, 1),
        { r: c.r, g: c.g, b: c.b, life: rand(0.3, 0.7), size0: rand(0.06, 0.14), size1: rand(0.2, 0.4), gravity: -1.2, drag: 2.4, alpha: 0.42 });
    }
    if (settings.decals) this.decal(x, y, z, nx, ny, nz, rand(0.16, 0.26));
  }

  /** Blut / Treffer am Koerper */
  blood(x, y, z, dx, dy, dz, big) {
    const amt = this.amount;
    if (amt <= 0) return;
    const n = Math.round((big ? 16 : 9) * amt);
    for (let i = 0; i < n; i++) {
      const sp = rand(2, big ? 12 : 7);
      this.sparks.spawn(x, y, z,
        dx * sp * 0.5 + rand(-3, 3), dy * sp * 0.5 + rand(0.5, 4), dz * sp * 0.5 + rand(-3, 3),
        { r: 0.85, g: 0.09, b: 0.11, life: rand(0.2, 0.5), size0: rand(0.05, 0.12), size1: 0.01, gravity: 14, drag: 1.4, alpha: 0.95 });
    }
  }

  decal(x, y, z, nx, ny, nz, size) {
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    const m = d.mesh;
    m.visible = true;
    m.position.set(x + nx * 0.012, y + ny * 0.012, z + nz * 0.012);
    this._v.set(nx, ny, nz);
    m.quaternion.setFromUnitVectors(this._fwd, this._v);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.material.opacity = 1;
    d.life = 22;
  }

  muzzleFlash(x, y, z, dirx, diry, dirz, scale) {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    const m = f.mesh;
    m.visible = true;
    m.position.set(x + dirx * 0.15, y + diry * 0.15, z + dirz * 0.15);
    m.scale.setScalar((scale || 1) * rand(0.55, 0.85));
    m.material.opacity = 1;
    f.life = 0.055;

    const amt = this.amount;
    const n = Math.round(3 * amt);
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(x, y, z,
        dirx * rand(3, 12) + rand(-2, 2), diry * rand(3, 12) + rand(-2, 2), dirz * rand(3, 12) + rand(-2, 2),
        { r: 1, g: 0.8, b: 0.4, life: rand(0.05, 0.14), size0: rand(0.04, 0.08), size1: 0, gravity: 6, drag: 5, alpha: 1 });
    }
    if (amt > 0) {
      this.smoke.spawn(x + dirx * 0.3, y + diry * 0.3, z + dirz * 0.3,
        dirx * 2 + rand(-0.6, 0.6), diry * 2 + rand(0.2, 1), dirz * 2 + rand(-0.6, 0.6),
        { r: 0.7, g: 0.68, b: 0.62, life: 0.5, size0: 0.1, size1: 0.55, gravity: -1.5, drag: 2.5, alpha: 0.2 });
    }
  }

  shell(x, y, z, vx, vy, vz) {
    if (this.amount <= 0) return;
    this.sparks.spawn(x, y, z, vx, vy, vz,
      { r: 0.95, g: 0.75, b: 0.3, life: 0.9, size0: 0.045, size1: 0.03, gravity: 22, drag: 0.5, alpha: 1 });
  }

  explosion(x, y, z, radius) {
    const b = this.blasts[this.blastIdx];
    this.blastIdx = (this.blastIdx + 1) % this.blasts.length;
    b.mesh.visible = true;
    b.mesh.position.set(x, y, z);
    b.mesh.scale.setScalar(0.4);
    b.mesh.material.opacity = 0.95;
    b.radius = radius;
    b.life = b.maxLife = 0.42;

    const amt = this.amount;
    const n = Math.round(40 * amt);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(rand(-1, 1));
      const sp = rand(6, 26);
      const dx = Math.sin(e) * Math.cos(a), dy = Math.cos(e), dz = Math.sin(e) * Math.sin(a);
      this.sparks.spawn(x, y, z, dx * sp, dy * sp + 4, dz * sp,
        { r: 1, g: rand(0.5, 0.85), b: rand(0.1, 0.35), life: rand(0.25, 0.7), size0: rand(0.08, 0.2), size1: 0.01, gravity: 16, drag: 1.6, alpha: 1 });
    }
    const m = Math.round(26 * amt);
    for (let i = 0; i < m; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(1, 9);
      this.smoke.spawn(x + rand(-1, 1), y + rand(-0.5, 1.5), z + rand(-1, 1),
        Math.cos(a) * sp, rand(1, 5), Math.sin(a) * sp,
        { r: 0.22, g: 0.2, b: 0.19, life: rand(0.8, 1.8), size0: rand(0.4, 0.9), size1: rand(1.6, 3.2), gravity: -1.4, drag: 1.5, alpha: 0.55 });
    }
    if (settings.decals) {
      this.decal(x, y, z, 0, 1, 0, radius * 0.9);
    }
  }

  /** Rauchspur fuer Projektile */
  trail(x, y, z, color) {
    if (this.amount <= 0) return;
    const c = this._col.setHex(color === undefined ? 0x999999 : color);
    this.smoke.spawn(x, y, z, rand(-0.4, 0.4), rand(0.1, 0.8), rand(-0.4, 0.4),
      { r: c.r, g: c.g, b: c.b, life: rand(0.35, 0.7), size0: 0.12, size1: 0.5, gravity: -0.8, drag: 2.2, alpha: 0.35 });
  }

  /** Aufprall-Staub beim Landen */
  dust(x, y, z, power) {
    if (this.amount <= 0) return;
    const n = Math.round(clamp(power * 6, 2, 14) * this.amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.8, 3.5) * power;
      this.smoke.spawn(x, y + 0.1, z, Math.cos(a) * sp, rand(0.2, 1.2), Math.sin(a) * sp,
        { r: 0.72, g: 0.66, b: 0.55, life: rand(0.3, 0.7), size0: 0.1, size1: rand(0.4, 0.8), gravity: -0.5, drag: 3, alpha: 0.3 });
    }
  }

  /** Teleport-/Spawn-Effekt */
  spawnFlash(x, y, z, colorHex) {
    const c = this._col.setHex(colorHex);
    const n = Math.round(26 * this.amount);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rand(0, 0.8);
      this.sparks.spawn(x + Math.cos(a) * r, y + rand(0, 1.8), z + Math.sin(a) * r,
        Math.cos(a) * rand(0.5, 3), rand(2, 7), Math.sin(a) * rand(0.5, 3),
        { r: c.r, g: c.g, b: c.b, life: rand(0.3, 0.7), size0: rand(0.06, 0.14), size1: 0, gravity: 3, drag: 1.5, alpha: 1 });
    }
  }

  // --------------------------------------------------------
  update(dt, camera) {
    this.sparks.update(dt);
    this.smoke.update(dt);

    for (let i = 0; i < this.tracers.length; i++) {
      const t = this.tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) { t.mesh.visible = false; continue; }
      t.mesh.material.opacity = 0.9 * (t.life / t.maxLife);
    }

    for (let i = 0; i < this.blasts.length; i++) {
      const b = this.blasts[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) { b.mesh.visible = false; continue; }
      const p = 1 - b.life / b.maxLife;
      b.mesh.scale.setScalar(b.radius * (0.25 + p * 0.95));
      b.mesh.material.opacity = 0.95 * (1 - p) * (1 - p);
    }

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.mesh.visible = false; continue; }
      if (camera) f.mesh.quaternion.copy(camera.quaternion);
      f.mesh.material.opacity = f.life / 0.055;
    }

    for (let i = 0; i < this.decals.length; i++) {
      const d = this.decals[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      if (d.life < 2) d.mesh.material.opacity = d.life / 2;
    }
  }

  clear() {
    this.sparks.clear();
    this.smoke.clear();
    for (const d of this.decals) { d.life = 0; d.mesh.visible = false; }
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const b of this.blasts) { b.life = 0; b.mesh.visible = false; }
    for (const f of this.flashes) { f.life = 0; f.mesh.visible = false; }
  }

  dispose() {
    this.scene.remove(this.sparks.points, this.smoke.points, this.decalGroup, this.tracerGroup);
    this.sparks.points.material.dispose(); this.sparks.geo.dispose();
    this.smoke.points.material.dispose(); this.smoke.geo.dispose();
    for (const d of this.decals) d.mesh.material.dispose();
    for (const t of this.tracers) t.mesh.material.dispose();
    for (const b of this.blasts) { this.scene.remove(b.mesh); b.mesh.material.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.mesh); f.mesh.material.dispose(); }
    this.decalGeo.dispose(); this.tracerGeo.dispose(); this.blastGeo.dispose(); this.flashGeo.dispose();
    this.holeTex.dispose(); this.flashTex.dispose(); this.decalMat.dispose();
  }
}
