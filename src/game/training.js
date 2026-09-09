// ============================================================
// Trainingsmodus: Aim-Trainer auf dem Schiessstand.
// Drills: Gridshot (3 Ziele), Flick (1 Ziel, weit verteilt),
// Reaktion (Ziel erscheint nach Pause, Zeit bis zum Treffer),
// Tracking (bewegtes Ziel, Zeit mit Fadenkreuz auf dem Ziel).
// Zielscheiben sind Kugeln mit eigener Treffererkennung (rayHit).
// ============================================================

import * as THREE from 'three';
import { audio } from '../core/audio.js';
import { clamp, rand } from '../core/utils.js';

export const DRILLS = [
  { id: 'gridshot', name: 'Gridshot', icon: '🎯', dur: 60, simultaneous: 3,
    desc: 'Drei Ziele gleichzeitig. Triff in 60 Sekunden so viele wie möglich.' },
  { id: 'flick', name: 'Flick', icon: '⚡', dur: 45, simultaneous: 1,
    desc: 'Ein Ziel nach dem anderen, weit auseinander. Schnell umschwenken und treffen.' },
  { id: 'reaction', name: 'Reaktion', icon: '⏱️', rounds: 15,
    desc: 'Das Ziel erscheint nach zufälliger Pause. 15 Runden, gemessen wird die Reaktionszeit.' },
  { id: 'tracking', name: 'Tracking', icon: '🔄', dur: 45,
    desc: 'Ein bewegtes Ziel. Halte das Fadenkreuz 45 Sekunden lang darauf.' },
];
export const DRILL_BY_ID = {};
for (const d of DRILLS) DRILL_BY_ID[d.id] = d;

export const TARGET_SIZES = [['small', 'Klein', 0.34], ['medium', 'Mittel', 0.55], ['large', 'Groß', 0.85]];
export const TARGET_DISTS = [['near', 'Nah (14 m)', 14], ['mid', 'Mittel (24 m)', 24], ['far', 'Weit (38 m)', 38]];

const LS_KEY = 'fragstorm.training.v1';
const COUNTDOWN = 3;
const TARGET_COLOR = 0xff7a1f;
const TARGET_CORE = 0xfff2d0;

function bestKey(cfg) { return cfg.drill + '|' + cfg.size + '|' + cfg.dist; }
export function loadBests() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; }
}
function saveBest(cfg, score) {
  try {
    const all = loadBests();
    all[bestKey(cfg)] = score;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch (e) {}
}

// ------------------------------------------------------------
class Target {
  constructor(scene, geo, coreGeo) {
    this.scene = scene;
    this.mat = new THREE.MeshStandardMaterial({
      color: TARGET_COLOR, emissive: TARGET_COLOR, emissiveIntensity: 0.75, roughness: 0.45, metalness: 0.1,
      transparent: true, opacity: 1,
    });
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.2), transparent: true, opacity: 1, toneMapped: false });
    this.group = new THREE.Group();
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.castShadow = true;
    this.core = new THREE.Mesh(coreGeo, this.coreMat);
    this.group.add(this.mesh, this.core);
    this.group.visible = false;
    scene.add(this.group);
    this.active = false;
    this.x = 0; this.y = 0; this.z = 0;
    this.r = 0.5;
    this.spawnK = 0;
    this.popT = 0;
    this.bornAt = 0;
    this.motion = null;
  }

  show(x, y, z, r, now) {
    this.x = x; this.y = y; this.z = z; this.r = r;
    this.active = true;
    this.spawnK = 0;
    this.popT = 0;
    this.bornAt = now;
    this.group.visible = true;
    this.group.position.set(x, y, z);
    this.group.scale.setScalar(0.01);
    this.mat.opacity = 1; this.coreMat.opacity = 1;
  }

  pop() {
    this.active = false;
    this.popT = 0.16;
  }

  hide() { this.active = false; this.popT = 0; this.group.visible = false; }

  update(dt) {
    if (this.popT > 0) {
      this.popT -= dt;
      const k = clamp(this.popT / 0.16, 0, 1);
      this.group.scale.setScalar(this.r * (1 + (1 - k) * 0.9));
      this.mat.opacity = k; this.coreMat.opacity = k;
      if (this.popT <= 0) this.group.visible = false;
      return;
    }
    if (!this.active) return;
    this.spawnK = Math.min(1, this.spawnK + dt / 0.11);
    const s = this.spawnK < 1 ? this.r * (1.25 - 0.25 * this.spawnK) * this.spawnK : this.r;
    this.group.scale.setScalar(Math.max(0.01, s));
    this.group.position.set(this.x, this.y, this.z);
  }

  /** Strahl gegen die Kugel: t oder -1 */
  rayT(ox, oy, oz, dx, dy, dz, maxT) {
    const mx = this.x - ox, my = this.y - oy, mz = this.z - oz;
    const proj = mx * dx + my * dy + mz * dz;
    if (proj < 0 || proj - this.r > maxT) return -1;
    const px = mx - dx * proj, py = my - dy * proj, pz = mz - dz * proj;
    const d2 = px * px + py * py + pz * pz;
    const r2 = this.r * this.r;
    if (d2 > r2) return -1;
    const t = proj - Math.sqrt(r2 - d2);
    return t >= 0 && t <= maxT ? t : -1;
  }

  dispose() {
    this.scene.remove(this.group);
    this.mat.dispose(); this.coreMat.dispose();
  }
}

// ------------------------------------------------------------
export class Training {
  /** cfg: { drill, size, dist } */
  constructor(game, cfg) {
    this.game = game;
    this.cfg = Object.assign({ drill: 'gridshot', size: 'medium', dist: 'mid' }, cfg || {});
    this.drill = DRILL_BY_ID[this.cfg.drill] || DRILLS[0];
    const sz = TARGET_SIZES.find(s => s[0] === this.cfg.size) || TARGET_SIZES[1];
    const ds = TARGET_DISTS.find(s => s[0] === this.cfg.dist) || TARGET_DISTS[1];
    this.radius = sz[2];
    this.dist = ds[2];

    // Schuetzenstand bei z = 11, Ziele davor
    const sp = game.world.map.spawnsFfa[0] || { x: 0, z: 11 };
    this.ox = sp.x; this.oz = sp.z;
    this.planeZ = this.oz - this.dist;
    this.xr = clamp(this.dist * 0.42, 5, 13);
    this.y0 = 1.3;
    this.y1 = clamp(1.6 + this.dist * 0.16, 3.5, 6.8);

    this.geo = new THREE.SphereGeometry(1, 20, 14);
    this.coreGeo = new THREE.SphereGeometry(0.38, 12, 8);
    this.targets = [];
    for (let i = 0; i < 6; i++) this.targets.push(new Target(game.scene, this.geo, this.coreGeo));

    this.time = 0;
    this.countdown = COUNTDOWN;
    this.started = false;
    this.done = false;
    this.timeLeft = this.drill.dur || 0;
    this.shots = 0;
    this.hits = 0;
    this.hitShots = 0;
    this.lastShotHit = false;
    this.reactions = [];
    this.falseStarts = 0;
    this.round = 0;
    this.waitT = 0;
    this.shownAt = -1;
    this.onTarget = 0;
    this.trackTotal = 0;
    this.msg = '';
    this.msgT = 0;
    this.results = null;
    this.trackTarget = null;
    this._motion = { t: 0, ax: 6, ay: 1.2, fx: 0.7, fy: 1.1, px: 0, py: 0, nextChange: 3 };
    this._eye = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }

  start() {
    this.game.hud.setTraining(this.drill.name.toUpperCase());
    this._say(String(COUNTDOWN), 1);
    audio.countdown(false);
  }

  _say(text, dur) { this.msg = text; this.msgT = dur || 1; }

  _freeTarget() { return this.targets.find(t => !t.active && t.popT <= 0) || null; }

  _randomPos(avoid) {
    const minSep = this.radius * 3.2;
    for (let tries = 0; tries < 30; tries++) {
      const x = this.ox + rand(-this.xr, this.xr);
      const y = rand(this.y0, this.y1);
      const z = this.planeZ + rand(-1.5, 1.5);
      let ok = true;
      for (const t of this.targets) {
        if (!t.active) continue;
        if (Math.hypot(t.x - x, t.y - y) < minSep) { ok = false; break; }
      }
      if (ok && avoid && Math.hypot(avoid.x - x, avoid.y - y) < this.xr * 0.8) ok = false;   // Flick: weit weg vom letzten
      if (ok) return { x, y, z };
    }
    return { x: this.ox + rand(-this.xr, this.xr), y: rand(this.y0, this.y1), z: this.planeZ };
  }

  _spawn(avoid) {
    const t = this._freeTarget();
    if (!t) return null;
    const p = this._randomPos(avoid);
    t.show(p.x, p.y, p.z, this.radius, this.time);
    audio.targetSpawn({ x: p.x, y: p.y, z: p.z });
    return t;
  }

  _begin() {
    this.started = true;
    this._say('LOS!', 0.7);
    audio.countdown(true);
    const d = this.drill.id;
    if (d === 'gridshot') for (let i = 0; i < this.drill.simultaneous; i++) this._spawn();
    else if (d === 'flick') this._spawn();
    else if (d === 'reaction') this._nextReaction();
    else if (d === 'tracking') {
      const t = this._freeTarget();
      t.show(this.ox, (this.y0 + this.y1) / 2, this.planeZ, this.radius, this.time);
      this.trackTarget = t;
      this._motion.px = this.ox; this._motion.py = (this.y0 + this.y1) / 2;
    }
  }

  _nextReaction() {
    this.round++;
    this.waitT = rand(0.9, 2.6);
    this.shownAt = -1;
  }

  /** Vom Spiel aufgerufen, wenn der Spieler schiesst */
  onShot() {
    if (!this.started || this.done) return;
    this.shots++;
    this.lastShotHit = false;
    if (this.drill.id === 'reaction' && this.shownAt < 0) {
      this.falseStarts++;
      this._say('ZU FRÜH!', 0.8);
    }
  }

  /** Strahl gegen alle aktiven Ziele: {t, target} oder null (Objekt wird wiederverwendet) */
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, bt = null;
    for (const t of this.targets) {
      if (!t.active || t.spawnK < 0.3) continue;
      const tt = t.rayT(ox, oy, oz, dx, dy, dz, best);
      if (tt >= 0 && tt < best) { best = tt; bt = t; }
    }
    if (!bt) return null;
    const r = this._hitRes || (this._hitRes = { t: 0, target: null });
    r.t = best; r.target = bt;
    return r;
  }

  /** Treffer auf ein Ziel (durch Schuss) */
  hit(target, hx, hy, hz) {
    if (!this.started || this.done || !target.active) return;
    this.hits++;
    if (!this.lastShotHit) { this.lastShotHit = true; this.hitShots++; }
    const g = this.game;
    const d = this.drill.id;
    // Wie mittig? (fuer den Sound)
    const off = Math.hypot(hx - target.x, hy - target.y, hz - target.z) / Math.max(0.01, target.r);
    if (g.effects) g.effects.targetPop(target.x, target.y, target.z, TARGET_COLOR, target.r);
    audio.targetHit({ x: target.x, y: target.y, z: target.z }, off < 0.45 ? 'perfect' : 'hit');

    if (d === 'gridshot') {
      target.pop();
      this._spawn();
    } else if (d === 'flick') {
      const last = { x: target.x, y: target.y };
      target.pop();
      this._spawn(last);
    } else if (d === 'reaction') {
      const ms = Math.round((this.time - this.shownAt) * 1000);
      this.reactions.push(ms);
      this._say(ms + ' ms', 1.0);
      target.pop();
      if (this.round >= this.drill.rounds) this._finish();
      else this._nextReaction();
    } else if (d === 'tracking') {
      // Ziel bleibt, kurzer Flash
      target.mat.emissiveIntensity = 2.2;
    }
  }

  update(dt) {
    if (this.done) return;
    this.time += dt;
    if (this.msgT > 0) { this.msgT -= dt; if (this.msgT <= 0) this.msg = ''; }
    for (const t of this.targets) t.update(dt);

    if (!this.started) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      if (after !== before && after > 0) { this._say(String(after), 1); audio.countdown(false); }
      if (this.countdown <= 0) this._begin();
      this._hud();
      return;
    }

    const d = this.drill.id;
    if (d === 'gridshot' || d === 'flick' || d === 'tracking') {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) { this.timeLeft = 0; this._finish(); return; }
      const tl = Math.ceil(this.timeLeft);
      if (tl <= 3 && tl !== this._lastTick) { this._lastTick = tl; audio.countdown(tl === 1); }
    }

    if (d === 'reaction' && this.shownAt < 0) {
      this.waitT -= dt;
      if (this.waitT <= 0) {
        this._spawn();
        this.shownAt = this.time;
      }
    } else if (d === 'reaction' && this.shownAt >= 0 && this.time - this.shownAt > 3.0) {
      // Zu langsam: Runde zaehlt als 3000 ms
      this.reactions.push(3000);
      this._say('ZU LANGSAM', 0.9);
      for (const t of this.targets) if (t.active) t.pop();
      if (this.round >= this.drill.rounds) { this._finish(); return; }
      this._nextReaction();
    }

    if (d === 'tracking' && this.trackTarget) {
      const m = this._motion;
      m.t += dt;
      m.nextChange -= dt;
      if (m.nextChange <= 0) {
        m.nextChange = rand(2.2, 4.5);
        m.ax = rand(0.5, 1) * this.xr; m.fx = rand(0.35, 0.9);
        m.ay = rand(0.3, 1) * (this.y1 - this.y0) * 0.5; m.fy = rand(0.5, 1.4);
      }
      const cx = this.ox, cy = (this.y0 + this.y1) / 2;
      const tx = cx + Math.sin(m.t * m.fx * 2) * m.ax;
      const ty = cy + Math.sin(m.t * m.fy * 2 + 1.3) * m.ay;
      // weich nachziehen, damit Parameterwechsel keine Spruenge machen
      m.px += (tx - m.px) * Math.min(1, dt * 4);
      m.py += (ty - m.py) * Math.min(1, dt * 4);
      const t = this.trackTarget;
      t.x = m.px; t.y = m.py; t.z = this.planeZ;
      t.mat.emissiveIntensity += (0.75 - t.mat.emissiveIntensity) * Math.min(1, dt * 10);
      // Fadenkreuz auf dem Ziel?
      const p = this.game.player;
      p.eyePos(this._eye); p.lookDir(this._dir);
      const on = t.rayT(this._eye.x, this._eye.y, this._eye.z, this._dir.x, this._dir.y, this._dir.z, 200) >= 0;
      this.trackTotal += dt;
      if (on) this.onTarget += dt;
      t.coreMat.color.setRGB(on ? 0.6 : 1.6, on ? 2.2 : 1.5, on ? 0.8 : 1.2);
    }

    this._hud();
  }

  _hud() {
    const g = this.game;
    const d = this.drill.id;
    let stats = '';
    const acc = this.shots > 0 ? Math.round(this.hitShots / this.shots * 100) : 0;
    if (d === 'gridshot' || d === 'flick') {
      const elapsed = Math.max(0.001, this.drill.dur - this.timeLeft);
      stats = `TREFFER ${this.hits} · GENAUIGKEIT ${acc}% · ${(this.hits / elapsed).toFixed(2)}/s`;
      g.timeLeft = this.timeLeft;
    } else if (d === 'reaction') {
      const avg = this.reactions.length ? Math.round(this.reactions.reduce((a, b) => a + b, 0) / this.reactions.length) : 0;
      const best = this.reactions.length ? Math.min(...this.reactions) : 0;
      stats = `RUNDE ${Math.min(this.round, this.drill.rounds)}/${this.drill.rounds} · Ø ${avg} ms · BESTE ${best} ms` + (this.falseStarts ? ` · FEHLSTARTS ${this.falseStarts}` : '');
      g.timeLeft = this.time;
    } else if (d === 'tracking') {
      const pct = this.trackTotal > 0 ? Math.round(this.onTarget / this.trackTotal * 100) : 0;
      stats = `AUF ZIEL ${pct}% · TREFFER ${this.hits} · GENAUIGKEIT ${acc}%`;
      g.timeLeft = this.timeLeft;
    }
    g.hud.updateTraining(stats, this.msg);
  }

  _finish() {
    if (this.done) return;
    this.done = true;
    for (const t of this.targets) if (t.active) t.pop();
    const d = this.drill.id;
    const acc = this.shots > 0 ? Math.round(this.hitShots / this.shots * 100) : 0;
    const bests = loadBests();
    const prev = bests[bestKey(this.cfg)];
    let score, scoreText, lowerBetter = false, lines;
    if (d === 'gridshot' || d === 'flick') {
      score = this.hits;
      scoreText = this.hits + ' Treffer';
      lines = [['Treffer', this.hits], ['Schüsse', this.shots], ['Genauigkeit', acc + '%'], ['Treffer pro Sekunde', (this.hits / Math.max(1, this.drill.dur)).toFixed(2)]];
    } else if (d === 'reaction') {
      const n = this.reactions.length || 1;
      const avg = Math.round(this.reactions.reduce((a, b) => a + b, 0) / n);
      score = avg; lowerBetter = true;
      scoreText = avg + ' ms';
      lines = [['Ø Reaktionszeit', avg + ' ms'], ['Beste Runde', (this.reactions.length ? Math.min(...this.reactions) : 0) + ' ms'],
               ['Runden', this.reactions.length], ['Fehlstarts', this.falseStarts]];
    } else {
      const pct = this.trackTotal > 0 ? Math.round(this.onTarget / this.trackTotal * 100) : 0;
      score = pct;
      scoreText = pct + '% auf dem Ziel';
      lines = [['Zeit auf dem Ziel', pct + '%'], ['Treffer', this.hits], ['Schüsse', this.shots], ['Genauigkeit', acc + '%']];
    }
    const isBest = prev === undefined || (lowerBetter ? score < prev : score > prev);
    if (isBest) saveBest(this.cfg, score);
    this.results = {
      drill: this.drill, cfg: this.cfg, score, scoreText, lines, isBest, lowerBetter,
      prevBest: prev, prevBestText: prev === undefined ? '—' : (d === 'reaction' ? prev + ' ms' : d === 'tracking' ? prev + '%' : prev + ' Treffer'),
    };
    this.game.hud.updateTraining('', '');
    this.game.endTraining(this.results);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.targets.length = 0;
    this.geo.dispose(); this.coreGeo.dispose();
  }
}
