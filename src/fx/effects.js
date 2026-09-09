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

// Eckige Partikel (Konfetti, Wuerfel): leichte Schattierung nach Position
const SQUARE_FS = `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 d = gl_PointCoord - vec2(0.5);
  if (abs(d.x) > 0.42 || abs(d.y) > 0.42) discard;
  float shade = 0.82 + 0.36 * smoothstep(-0.4, 0.4, -d.y - d.x * 0.5);
  gl_FragColor = vec4(vColor * shade, vAlpha);
}
`;

class ParticleSystem {
  constructor(scene, capacity, additive, square) {
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
      fragmentShader: square ? SQUARE_FS : PARTICLE_FS,
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

/** Blutspritzer: mehrere dunkelrote Flecken mit Tropfen */
function makeBloodTexture(seed) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, S, S);
  let s = seed || 7;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const blobs = [];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2;
    const d = rnd() * rnd() * S * 0.34;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const r = (5 + rnd() * 15) * (1.1 - d / (S * 0.4));
    blobs.push([x, y, r]);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(110,6,10,0.96)');
    grd.addColorStop(0.55, 'rgba(96,4,8,0.85)');
    grd.addColorStop(1, 'rgba(70,2,6,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  // Tropfen nach unten
  g.strokeStyle = 'rgba(96,4,8,0.8)';
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const b = blobs[(rnd() * blobs.length) | 0];
    g.lineWidth = 1.5 + rnd() * 2.5;
    g.beginPath();
    g.moveTo(b[0], b[1]);
    g.lineTo(b[0] + (rnd() - 0.5) * 4, Math.min(S - 2, b[1] + b[2] + 6 + rnd() * 26));
    g.stroke();
  }
  // Feine Spritzer
  g.fillStyle = 'rgba(120,8,12,0.9)';
  for (let i = 0; i < 40; i++) {
    const a = rnd() * Math.PI * 2, d = S * 0.2 + rnd() * S * 0.28;
    g.beginPath(); g.arc(S / 2 + Math.cos(a) * d, S / 2 + Math.sin(a) * d, 0.6 + rnd() * 1.6, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------
// Effekt-Manager
// ------------------------------------------------------------
const MAX_DECALS = 90;
const MAX_BLOOD = 64;
const MAX_TRACERS = 80;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.sparks = new ParticleSystem(scene, 1400, true);
    this.smoke = new ParticleSystem(scene, 900, false);
    this.bits = new ParticleSystem(scene, 900, false, true);     // eckige Teilchen (Konfetti, Wuerfel, Muenzen)

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

    // ---- Blut-Decals (an Waenden und am Boden) ----
    this.bloodTex = [makeBloodTexture(7), makeBloodTexture(23), makeBloodTexture(91)];
    this.bloods = [];
    this.bloodIdx = 0;
    this.bloodGroup = new THREE.Group();
    scene.add(this.bloodGroup);
    for (let i = 0; i < MAX_BLOOD; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: this.bloodTex[i % 3], transparent: true, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 1,
      });
      const m = new THREE.Mesh(this.decalGeo, mat);
      m.visible = false;
      m.renderOrder = 6;
      this.bloodGroup.add(m);
      this.bloods.push({ mesh: m, life: 0, max: 1 });
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
        color: new THREE.Color(2.4, 1.5, 0.5), transparent: true, opacity: 0.8,
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
        color: new THREE.Color(1.5, 1.35, 1.1),
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
    m.material.color.setHex(color || 0xffe08a).multiplyScalar(2.6);   // HDR -> leuchtet im Bloom
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

  /** Blutspritzer auf einer Flaeche (Normale n), size in Welteinheiten */
  bloodSplat(x, y, z, nx, ny, nz, size) {
    if (!settings.blood) return;
    const d = this.bloods[this.bloodIdx];
    this.bloodIdx = (this.bloodIdx + 1) % this.bloods.length;
    const m = d.mesh;
    m.visible = true;
    m.position.set(x + nx * 0.015, y + ny * 0.015, z + nz * 0.015);
    this._v.set(nx, ny, nz);
    m.quaternion.setFromUnitVectors(this._fwd, this._v);
    m.rotateZ(Math.random() * Math.PI * 2);
    m.scale.set(size * rand(0.85, 1.25), size * rand(0.85, 1.25), 1);
    m.material.opacity = 0.95;
    d.life = d.max = 40;
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

  // --------------------------------------------------------
  // Kill-Effekte (am Opfer; x,y,z = Fusspunkt)
  // --------------------------------------------------------
  killEffect(kind, x, y, z, bodyColor) {
    const amt = this.amount;
    if (amt <= 0) return;
    const cy = y + 1.3;
    switch (kind) {
      case 'confetti': {
        const cols = [[1, 0.2, 0.3], [1, 0.85, 0.1], [0.2, 0.9, 0.4], [0.2, 0.6, 1], [0.9, 0.3, 1], [1, 1, 1], [1, 0.55, 0.1]];
        const n = Math.round(150 * amt);
        for (let i = 0; i < n; i++) {
          const c = cols[(Math.random() * cols.length) | 0];
          const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-0.3, 1));
          const sp = rand(4, 13);
          this.bits.spawn(x + rand(-0.3, 0.3), y + rand(0.3, 2.2), z + rand(-0.3, 0.3),
            Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp + 3, Math.sin(e) * Math.sin(a) * sp,
            { r: c[0], g: c[1], b: c[2], life: rand(1.4, 2.6), size0: rand(0.09, 0.16), size1: rand(0.06, 0.12), gravity: 5.5, drag: 2.2, alpha: 1 });
        }
        // Knall-Wolke
        for (let i = 0; i < 8 * amt; i++) {
          this.smoke.spawn(x, cy, z, rand(-2, 2), rand(0, 2), rand(-2, 2),
            { r: 1, g: 0.95, b: 0.9, life: 0.5, size0: 0.4, size1: 1.4, gravity: -0.5, drag: 3, alpha: 0.35 });
        }
        break;
      }
      case 'fireworks': {
        const hue = Math.random();
        const c1 = this._col.setHSL(hue, 1, 0.6), c2 = new THREE.Color().setHSL((hue + 0.33) % 1, 1, 0.65);
        const n = Math.round(160 * amt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-1, 1));
          const sp = rand(9, 18);
          const c = i % 3 === 0 ? c2 : c1;
          this.sparks.spawn(x, cy, z,
            Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp + 2, Math.sin(e) * Math.sin(a) * sp,
            { r: c.r * 1.6, g: c.g * 1.6, b: c.b * 1.6, life: rand(0.7, 1.5), size0: rand(0.1, 0.18), size1: 0.02, gravity: 9, drag: 1.8, alpha: 1 });
        }
        // Zweite Stufe: Glitzer
        for (let i = 0; i < 60 * amt; i++) {
          const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-1, 1));
          const sp = rand(2, 6);
          this.sparks.spawn(x, cy + 0.4, z, Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp, Math.sin(e) * Math.sin(a) * sp,
            { r: 2, g: 1.9, b: 1.5, life: rand(1.2, 2.2), size0: 0.06, size1: 0.0, gravity: 3, drag: 1.2, alpha: 1 });
        }
        const b = this.blasts[this.blastIdx];
        this.blastIdx = (this.blastIdx + 1) % this.blasts.length;
        b.mesh.visible = true; b.mesh.position.set(x, cy, z); b.mesh.scale.setScalar(0.3);
        b.mesh.material.opacity = 0.9; b.radius = 2.4; b.life = b.maxLife = 0.28;
        break;
      }
      case 'voxel': {
        const c = this._col.setHex(bodyColor === undefined ? 0x4a86d9 : bodyColor);
        const n = Math.round(120 * amt);
        for (let i = 0; i < n; i++) {
          const px = x + rand(-0.45, 0.45), py = y + rand(0.05, 2.35), pz = z + rand(-0.25, 0.25);
          const shade = rand(0.6, 1.25);
          const skin = py > y + 1.8 && Math.random() < 0.6;
          this.bits.spawn(px, py, pz, (px - x) * rand(3, 9) + rand(-1.5, 1.5), rand(1, 6), (pz - z) * rand(3, 9) + rand(-1.5, 1.5),
            { r: (skin ? 0.85 : c.r) * shade, g: (skin ? 0.65 : c.g) * shade, b: (skin ? 0.5 : c.b) * shade,
              life: rand(0.9, 1.8), size0: rand(0.16, 0.26), size1: 0.02, gravity: 14, drag: 0.6, alpha: 1 });
        }
        for (let i = 0; i < 30 * amt; i++) {
          this.sparks.spawn(x, y + rand(0.2, 2.2), z, rand(-3, 3), rand(0, 4), rand(-3, 3),
            { r: 0.4, g: 1.8, b: 2.4, life: rand(0.3, 0.7), size0: 0.08, size1: 0, gravity: 0, drag: 2, alpha: 1 });
        }
        break;
      }
      case 'soul': {
        const n = Math.round(70 * amt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, r = rand(0, 0.35);
          this.sparks.spawn(x + Math.cos(a) * r, y + rand(0.3, 1.9), z + Math.sin(a) * r,
            Math.cos(a) * 0.3, rand(1.2, 2.8), Math.sin(a) * 0.3,
            { r: 0.7, g: 1.3, b: 1.8, life: rand(1.6, 2.8), size0: rand(0.12, 0.3), size1: 0.04, gravity: -0.6, drag: 0.4, alpha: 0.7 });
        }
        for (let i = 0; i < 14 * amt; i++) {
          this.smoke.spawn(x + rand(-0.3, 0.3), y + rand(0.5, 2), z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(0.8, 1.6), rand(-0.3, 0.3),
            { r: 0.75, g: 0.9, b: 1, life: rand(1.5, 2.5), size0: 0.3, size1: 1.0, gravity: -0.8, drag: 0.8, alpha: 0.28 });
        }
        break;
      }
      case 'coins': {
        const n = Math.round(90 * amt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(1.5, 5);
          const sh = rand(0.75, 1.15);
          this.bits.spawn(x + rand(-0.2, 0.2), y + rand(0.8, 2.2), z + rand(-0.2, 0.2), Math.cos(a) * sp, rand(4, 10), Math.sin(a) * sp,
            { r: 1.0 * sh, g: 0.8 * sh, b: 0.2 * sh, life: rand(1.2, 2.2), size0: rand(0.1, 0.15), size1: rand(0.08, 0.12), gravity: 16, drag: 0.4, alpha: 1 });
        }
        for (let i = 0; i < 24 * amt; i++) {
          this.sparks.spawn(x, y + rand(0.5, 2.2), z, rand(-2, 2), rand(1, 4), rand(-2, 2),
            { r: 2.2, g: 1.8, b: 0.6, life: rand(0.3, 0.8), size0: 0.08, size1: 0, gravity: 2, drag: 1, alpha: 1 });
        }
        break;
      }
      case 'gore': {
        const n = Math.round(110 * amt);
        for (let i = 0; i < n; i++) {
          const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-0.2, 1));
          const sp = rand(3, 12);
          this.sparks.spawn(x, y + rand(0.8, 2.0), z, Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp + 2, Math.sin(e) * Math.sin(a) * sp,
            { r: 0.8, g: 0.06, b: 0.08, life: rand(0.4, 1.1), size0: rand(0.08, 0.2), size1: 0.02, gravity: 15, drag: 1.2, alpha: 0.95 });
        }
        break;
      }
      default: break;
    }
  }

  /** Flammenwerfer-Strahl (pro Tick) */
  flame(x, y, z, dx, dy, dz) {
    const amt = this.amount;
    if (amt <= 0) return;
    const n = Math.max(1, Math.round(4 * amt));
    for (let i = 0; i < n; i++) {
      const sp = rand(10, 16);
      const hot = Math.random() < 0.5;
      this.sparks.spawn(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3,
        dx * sp + rand(-1.6, 1.6), dy * sp + rand(-0.8, 2.0), dz * sp + rand(-1.6, 1.6),
        { r: hot ? 2.2 : 1.6, g: hot ? 1.3 : 0.5, b: hot ? 0.3 : 0.08, life: rand(0.28, 0.5), size0: rand(0.16, 0.26), size1: rand(0.5, 0.9), gravity: -4, drag: 3.2, alpha: 0.85 });
    }
    if (Math.random() < 0.5 * amt) {
      this.smoke.spawn(x + dx * 1.5, y + dy * 1.5, z + dz * 1.5, dx * 4 + rand(-0.5, 0.5), 1.5, dz * 4 + rand(-0.5, 0.5),
        { r: 0.15, g: 0.13, b: 0.12, life: rand(0.6, 1.1), size0: 0.3, size1: 1.2, gravity: -1.8, drag: 2.2, alpha: 0.28 });
    }
  }

  /** Brennender Akteur: kleine Flammen am Koerper */
  burn(x, y, z) {
    const amt = this.amount;
    if (amt <= 0) return;
    const n = Math.max(1, Math.round(3 * amt));
    for (let i = 0; i < n; i++) {
      this.sparks.spawn(x + rand(-0.35, 0.35), y + rand(0.2, 2.2), z + rand(-0.35, 0.35), rand(-0.4, 0.4), rand(1.5, 3.5), rand(-0.4, 0.4),
        { r: 2.0, g: 0.9, b: 0.2, life: rand(0.25, 0.5), size0: rand(0.12, 0.22), size1: 0.02, gravity: -3, drag: 1.5, alpha: 0.9 });
    }
    if (Math.random() < 0.4) {
      this.smoke.spawn(x, y + 2.2, z, rand(-0.3, 0.3), 1.6, rand(-0.3, 0.3),
        { r: 0.12, g: 0.11, b: 0.1, life: 0.9, size0: 0.25, size1: 0.9, gravity: -1.5, drag: 2, alpha: 0.3 });
    }
  }

  /** Holzsplitter (Kiste zerstoert) */
  splinters(x, y, z, colorHex, size) {
    const amt = this.amount;
    if (amt <= 0) return;
    const c = this._col.setHex(colorHex === undefined ? 0xa8703a : colorHex);
    const n = Math.round(40 * amt);
    const s = size || 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-0.3, 1));
      const sp = rand(3, 9);
      const sh = rand(0.6, 1.2);
      this.bits.spawn(x + rand(-0.5, 0.5) * s, y + rand(-0.4, 0.6) * s, z + rand(-0.5, 0.5) * s,
        Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp + 2, Math.sin(e) * Math.sin(a) * sp,
        { r: c.r * sh, g: c.g * sh, b: c.b * sh, life: rand(0.8, 1.6), size0: rand(0.08, 0.2), size1: 0.04, gravity: 15, drag: 0.8, alpha: 1 });
    }
    for (let i = 0; i < 10 * amt; i++) {
      this.smoke.spawn(x, y, z, rand(-2, 2), rand(0.5, 2), rand(-2, 2),
        { r: 0.6, g: 0.5, b: 0.4, life: rand(0.5, 1.0), size0: 0.3, size1: 1.2, gravity: -0.8, drag: 2.5, alpha: 0.3 });
    }
  }

  /** Glasscherben */
  glass(x, y, z, nx, ny, nz, w, h) {
    const amt = this.amount;
    if (amt <= 0) return;
    const n = Math.round(50 * amt);
    for (let i = 0; i < n; i++) {
      const px = x + (nx === 0 ? rand(-w / 2, w / 2) : 0), py = y + rand(-h / 2, h / 2), pz = z + (nz === 0 ? rand(-w / 2, w / 2) : 0);
      const sh = rand(0.8, 1.6);
      this.bits.spawn(px, py, pz, nx * rand(1, 5) + rand(-1.5, 1.5), rand(-1, 2), nz * rand(1, 5) + rand(-1.5, 1.5),
        { r: 0.75 * sh, g: 0.9 * sh, b: 1.0 * sh, life: rand(0.7, 1.4), size0: rand(0.06, 0.16), size1: 0.03, gravity: 16, drag: 0.5, alpha: 0.85 });
    }
    for (let i = 0; i < 14 * amt; i++) {
      this.sparks.spawn(x, y + rand(-h / 2, h / 2), z, rand(-2, 2), rand(0, 2), rand(-2, 2),
        { r: 1.6, g: 1.9, b: 2.2, life: rand(0.2, 0.5), size0: 0.08, size1: 0, gravity: 4, drag: 2, alpha: 1 });
    }
  }

  /** Luftschlag-Markierung: rote Rauchsaeule */
  markSmoke(x, y, z) {
    const amt = this.amount;
    if (amt <= 0) return;
    for (let i = 0; i < 3; i++) {
      this.smoke.spawn(x + rand(-0.3, 0.3), y + 0.2, z + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(2.5, 4.5), rand(-0.3, 0.3),
        { r: 1.0, g: 0.15, b: 0.1, life: rand(1.2, 2.0), size0: 0.4, size1: 1.6, gravity: -2.5, drag: 1.2, alpha: 0.5 });
    }
  }

  // --------------------------------------------------------
  // Regen: Linien-Segmente um die Kamera, werden jeden Frame verschoben
  // --------------------------------------------------------
  setRain(on) {
    if (on && !this.rain) {
      const N = 700;
      const pos = new Float32Array(N * 6);
      const geo = new THREE.BufferGeometry();
      this.rainAttr = new THREE.BufferAttribute(pos, 3);
      this.rainAttr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', this.rainAttr);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mat = new THREE.LineBasicMaterial({ color: 0xbcd0e6, transparent: true, opacity: 0.38, fog: true, toneMapped: false });
      this.rain = new THREE.LineSegments(geo, mat);
      this.rain.frustumCulled = false;
      this.rain.renderOrder = 7;
      this.rainDrops = new Float32Array(N * 4);   // x,y,z,speed
      for (let i = 0; i < N; i++) this._rainReset(i, null, true);
      this.scene.add(this.rain);
    } else if (!on && this.rain) {
      this.scene.remove(this.rain);
      this.rain.geometry.dispose(); this.rain.material.dispose();
      this.rain = null;
    }
  }

  _rainReset(i, cam, initial) {
    const d = this.rainDrops;
    const cx = cam ? cam.x : 0, cy = cam ? cam.y : 10, cz = cam ? cam.z : 0;
    d[i * 4] = cx + rand(-18, 18);
    d[i * 4 + 1] = initial ? cy + rand(-8, 14) : cy + rand(9, 15);
    d[i * 4 + 2] = cz + rand(-18, 18);
    d[i * 4 + 3] = rand(19, 26);
  }

  _rainUpdate(dt, cam) {
    const d = this.rainDrops, p = this.rainAttr.array;
    const N = d.length / 4;
    for (let i = 0; i < N; i++) {
      d[i * 4 + 1] -= d[i * 4 + 3] * dt;
      if (d[i * 4 + 1] < cam.y - 9 || Math.abs(d[i * 4] - cam.x) > 20 || Math.abs(d[i * 4 + 2] - cam.z) > 20) this._rainReset(i, cam, false);
      const x = d[i * 4], y = d[i * 4 + 1], z = d[i * 4 + 2];
      p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x + 0.15; p[i * 6 + 4] = y + 0.55; p[i * 6 + 5] = z;
    }
    this.rainAttr.needsUpdate = true;
  }

  /** Trainings-Zielscheibe zerplatzt */
  targetPop(x, y, z, colorHex, radius) {
    const amt = this.amount;
    if (amt <= 0) return;
    const c = this._col.setHex(colorHex === undefined ? 0xff8a1f : colorHex);
    const n = Math.round(26 * amt);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.acos(rand(-1, 1));
      const sp = rand(3, 9) * (radius || 0.6) / 0.6;
      this.sparks.spawn(x, y, z, Math.sin(e) * Math.cos(a) * sp, Math.cos(e) * sp, Math.sin(e) * Math.sin(a) * sp,
        { r: c.r * 1.8, g: c.g * 1.8, b: c.b * 1.8, life: rand(0.25, 0.55), size0: rand(0.07, 0.14), size1: 0.01, gravity: 8, drag: 2, alpha: 1 });
    }
    for (let i = 0; i < 8 * amt; i++) {
      this.bits.spawn(x, y, z, rand(-4, 4), rand(0, 5), rand(-4, 4),
        { r: c.r, g: c.g, b: c.b, life: rand(0.5, 1.0), size0: rand(0.08, 0.14), size1: 0.03, gravity: 12, drag: 1, alpha: 1 });
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
    this.bits.update(dt);
    if (this.rain && camera) this._rainUpdate(dt, camera.position);

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

    for (let i = 0; i < this.bloods.length; i++) {
      const d = this.bloods[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      if (d.life < 4) d.mesh.material.opacity = d.life / 4 * 0.95;
    }
  }

  clear() {
    this.sparks.clear();
    this.smoke.clear();
    this.bits.clear();
    for (const d of this.decals) { d.life = 0; d.mesh.visible = false; }
    for (const d of this.bloods) { d.life = 0; d.mesh.visible = false; }
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const b of this.blasts) { b.life = 0; b.mesh.visible = false; }
    for (const f of this.flashes) { f.life = 0; f.mesh.visible = false; }
  }

  dispose() {
    this.setRain(false);
    this.scene.remove(this.sparks.points, this.smoke.points, this.bits.points, this.decalGroup, this.tracerGroup, this.bloodGroup);
    this.sparks.points.material.dispose(); this.sparks.geo.dispose();
    this.smoke.points.material.dispose(); this.smoke.geo.dispose();
    this.bits.points.material.dispose(); this.bits.geo.dispose();
    for (const d of this.decals) d.mesh.material.dispose();
    for (const d of this.bloods) d.mesh.material.dispose();
    for (const t of this.bloodTex) t.dispose();
    for (const t of this.tracers) t.mesh.material.dispose();
    for (const b of this.blasts) { this.scene.remove(b.mesh); b.mesh.material.dispose(); }
    for (const f of this.flashes) { this.scene.remove(f.mesh); f.mesh.material.dispose(); }
    this.decalGeo.dispose(); this.tracerGeo.dispose(); this.blastGeo.dispose(); this.flashGeo.dispose();
    this.holeTex.dispose(); this.flashTex.dispose(); this.decalMat.dispose();
  }
}
