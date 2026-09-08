// ============================================================
// Audio: alle Sounds werden zur Laufzeit synthetisiert.
//
// Schuesse: Transient (2 ms) + kurzer Crack (40-90 ms Bandpass-Rauschen
// mit fallender Frequenz) + Body (Sinus mit steilem Pitch-Drop) + Sub
// + resonanter Tiefpass-Sweep, alles durch eine Saettigungsstufe
// (Waveshaper) -> Biss und Druck. Danach Mechanik-Klicks und ein
// Nachhall-Schwanz ueber ein Delay-Netz, das mit der Entfernung
// lauter wird. Jede Waffenklasse hat ein eigenes Preset.
// ============================================================

import { settings } from './settings.js';
import { clamp, rand } from './utils.js';

// [f0, f1, dur, vol] fuer crack/body/sub/sweep; mech: [delay, vol, double]; tail: [dur, vol]
const PRESETS = {
  rifle:    { crack: [7000, 900, 0.050, 1.00], body: [210, 55, 0.13, 0.90], sub: [70, 38, 0.14, 0.50], sweep: [4200, 260, 0.06, 0.60], mech: [0.055, 0.70, false], tail: [0.42, 0.22], drive: 3.2 },
  smg:      { crack: [8000, 1200, 0.035, 0.85], body: [260, 80, 0.09, 0.70], sub: [80, 45, 0.09, 0.30], sweep: [4800, 400, 0.04, 0.50], mech: [0.040, 0.45, false], tail: [0.28, 0.15], drive: 2.6 },
  pistol:   { crack: [7500, 1100, 0.045, 1.00], body: [240, 70, 0.11, 0.80], sub: [75, 40, 0.11, 0.35], sweep: [5000, 350, 0.05, 0.60], mech: [0.050, 0.55, false], tail: [0.35, 0.20], drive: 3.0 },
  revolver: { crack: [6000, 700, 0.070, 1.10], body: [170, 45, 0.17, 1.00], sub: [65, 34, 0.18, 0.60], sweep: [3600, 220, 0.08, 0.70], mech: [0.080, 0.50, false], tail: [0.60, 0.30], drive: 3.6 },
  sniper:   { crack: [5000, 500, 0.090, 1.20], body: [140, 36, 0.24, 1.10], sub: [55, 30, 0.26, 0.80], sweep: [3000, 160, 0.10, 0.80], mech: [0.300, 0.90, true], tail: [0.90, 0.38], drive: 4.0 },
  shotgun:  { crack: [4200, 380, 0.090, 1.10], body: [120, 40, 0.20, 1.10], sub: [55, 32, 0.22, 0.80], sweep: [2600, 180, 0.09, 0.90], mech: [0.320, 0.80, true], tail: [0.70, 0.35], drive: 3.8 },
  lmg:      { crack: [6000, 700, 0.060, 1.00], body: [160, 45, 0.15, 1.00], sub: [60, 36, 0.16, 0.60], sweep: [3600, 240, 0.07, 0.70], mech: [0.050, 0.60, false], tail: [0.50, 0.26], drive: 3.4 },
  rpg:      { crack: [3000, 300, 0.120, 0.80], body: [110, 30, 0.35, 1.10], sub: [50, 28, 0.40, 0.90], sweep: [2000, 150, 0.14, 0.80], mech: null, tail: [1.10, 0.40], drive: 3.0, whoosh: true },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.busSfx = null;
    this.busSteps = null;
    this.busUi = null;
    this.busVerb = null;
    this.noiseBuf = null;
    this.ready = false;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.listenerFwd = { x: 0, y: 0, z: -1 };
    this.listenerRight = { x: 1, y: 0, z: 0 };
    this._curves = new Map();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = settings.volMaster;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 8;
    comp.attack.value = 0.002;
    comp.release.value = 0.14;
    this.master.connect(comp);
    comp.connect(c.destination);

    const mk = (v) => { const g = c.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.busSfx = mk(settings.volSfx);
    this.busSteps = mk(settings.volSteps);
    this.busUi = mk(settings.volUi);

    // Raum-Hall: drei rueckgekoppelte Delays mit Tiefpass
    this.busVerb = c.createGain();
    this.busVerb.gain.value = 0.5;
    const verbOut = c.createGain();
    verbOut.gain.value = 0.85;
    for (const [dl, fb, lp] of [[0.079, 0.40, 2400], [0.121, 0.36, 1700], [0.187, 0.30, 1200]]) {
      const d = c.createDelay(0.5);
      d.delayTime.value = dl;
      const f = c.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp;
      const g = c.createGain();
      g.gain.value = fb;
      this.busVerb.connect(d);
      d.connect(f); f.connect(g); g.connect(d);
      f.connect(verbOut);
    }
    verbOut.connect(this.busSfx);

    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    this.ready = true;
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  applySettings() {
    if (!this.ready) return;
    this.master.gain.value = settings.volMaster;
    this.busSfx.gain.value = settings.volSfx;
    this.busSteps.gain.value = settings.volSteps;
    this.busUi.gain.value = settings.volUi;
  }

  setListener(pos, fwd, right) {
    this.listenerPos.x = pos.x; this.listenerPos.y = pos.y; this.listenerPos.z = pos.z;
    this.listenerFwd.x = fwd.x; this.listenerFwd.y = fwd.y; this.listenerFwd.z = fwd.z;
    this.listenerRight.x = right.x; this.listenerRight.y = right.y; this.listenerRight.z = right.z;
  }

  /** Ausgangskette: Distanz-Daempfung + Tiefpass + Panning + Hall-Send */
  _out(bus, pos, refDist = 14, maxDist = 110, verbSend = 0.18) {
    const c = this.ctx;
    const g = c.createGain();
    if (!pos) {
      g.connect(bus);
      if (verbSend > 0 && bus !== this.busUi) {
        const s = c.createGain(); s.gain.value = verbSend; g.connect(s); s.connect(this.busVerb);
      }
      return { node: g, gain: 1, dist: 0 };
    }
    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxDist) return null;

    let att = refDist / (refDist + Math.max(0, dist - refDist) * 1.35);
    att *= clamp(1 - dist / maxDist, 0, 1);

    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(20000 - dist * 150, 900, 20000);

    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan && dist > 0.001) {
      const rx = this.listenerRight.x, rz = this.listenerRight.z;
      pan.pan.value = clamp((dx * rx + dz * rz) / dist, -1, 1) * 0.85;
    }
    g.connect(lp);
    if (pan) { lp.connect(pan); pan.connect(bus); } else { lp.connect(bus); }
    if (verbSend > 0) {
      const s = c.createGain();
      s.gain.value = verbSend * (0.6 + clamp(dist / 40, 0, 1) * 1.2);
      lp.connect(s); s.connect(this.busVerb);
    }
    return { node: g, gain: att, dist };
  }

  _noise(dur, rate) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate || rand(0.85, 1.15);
    src.start(this.ctx.currentTime, Math.random() * 1.5);
    src.stop(this.ctx.currentTime + dur + 0.05);
    return src;
  }

  _burst(dest, t, dur, type, f0, f1, q, vol, attack = 0.003) {
    const n = this._noise(dur + 0.05);
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(dest);
  }

  _osc(dest, t, dur, type, f0, f1, vol, attack = 0.005) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }

  /** Sinus mit schnellem Pitch-Drop (Body eines Schusses) */
  _bodyOsc(dest, t, dur, f0, f1, vol) {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + Math.min(0.06, dur * 0.45));
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
    g.gain.exponentialRampToValueAtTime(vol * 0.35, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.03);
  }

  /** Saettigung (tanh-Kurve) - gibt dem Knall Biss */
  _shaper(drive) {
    const key = Math.round(drive * 10);
    let curve = this._curves.get(key);
    if (!curve) {
      const N = 512;
      curve = new Float32Array(N);
      const k = Math.tanh(drive);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * drive) / k;
      }
      this._curves.set(key, curve);
    }
    const ws = this.ctx.createWaveShaper();
    ws.curve = curve;
    ws.oversample = '2x';
    return ws;
  }

  // --------------------------------------------------------
  // Schuss
  // --------------------------------------------------------
  shot(pos, opt = {}) {
    if (!this.ready) return;
    if (opt.kind === 'energy') { this._energyShot(pos, opt); return; }
    const P = PRESETS[opt.kind] || PRESETS.rifle;
    const vol = opt.vol !== undefined ? opt.vol : 1;
    const pitch = opt.pitch || 1;
    const out = this._out(this.busSfx, pos, 16, 160, 0.26);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = vol * out.gain;
    const far = pos ? clamp(out.dist / 60, 0, 1) : 0;
    out.node.gain.value = 1;

    // Kern des Knalls laeuft durch die Saettigung
    const drive = this._shaper(P.drive);
    const pre = this.ctx.createGain();
    pre.gain.value = 1.0;
    const post = this.ctx.createGain();
    post.gain.value = v * 0.75;
    pre.connect(drive); drive.connect(post); post.connect(out.node);

    // 1) Transient: 2 ms heller Klick
    this._burst(pre, t, 0.012, 'highpass', 5500 * pitch, 5500 * pitch, 0.5, 1.4 * (1 - far * 0.6), 0.0008);
    // 2) Crack: kurzes Bandpass-Rauschen, Frequenz faellt
    const [cf0, cf1, cd, cv] = P.crack;
    this._burst(pre, t, cd, 'bandpass', cf0 * pitch, cf1 * pitch, 1.1, cv * (1 - far * 0.35), 0.002);
    // 3) Body: Sinus mit steilem Pitch-Drop
    const [bf0, bf1, bd, bv] = P.body;
    this._bodyOsc(pre, t, bd, bf0 * pitch, bf1 * pitch, bv * (1 + far * 0.3));
    // 4) Sub
    const [sf0, sf1, sd, sv] = P.sub;
    this._bodyOsc(pre, t + 0.004, sd, sf0, sf1, sv);
    // 5) Resonanter Tiefpass-Sweep ("thoomp")
    const [wf0, wf1, wd, wv] = P.sweep;
    this._burst(pre, t, wd, 'lowpass', wf0 * pitch, wf1 * pitch, 6.0, wv, 0.002);

    // 6) Mechanik: Verschluss / Repetieren (nicht gesaettigt)
    if (P.mech) {
      const [md, mv, dbl] = P.mech;
      const tm = t + md;
      this._burst(out.node, tm, 0.028, 'bandpass', 2800, 1500, 2.5, v * 0.32 * mv, 0.002);
      this._osc(out.node, tm + 0.006, 0.035, 'square', 2100, 800, v * 0.10 * mv, 0.002);
      if (dbl) {
        this._burst(out.node, tm + 0.10, 0.05, 'lowpass', 2400, 600, 0.9, v * 0.42 * mv, 0.002);
        this._osc(out.node, tm + 0.10, 0.05, 'square', 1100, 500, v * 0.12 * mv, 0.002);
      }
    }
    // 7) Schwanz (Nachhall), entfernt laenger und lauter
    const [td, tv] = P.tail;
    this._burst(out.node, t + 0.015, td + far * 0.5, 'lowpass', 1500, 280, 0.6, v * tv * (1 + far * 1.2), 0.02);
    // 8) Rakete: abziehendes Zischen
    if (P.whoosh) this._burst(out.node, t + 0.05, 0.9, 'bandpass', 900, 260, 1.2, v * 0.45, 0.05);
  }

  _energyShot(pos, opt) {
    const out = this._out(this.busSfx, pos, 14, 120, 0.25);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = (opt.vol || 0.8) * out.gain;
    const drive = this._shaper(2.5);
    const post = this.ctx.createGain();
    post.gain.value = v * 0.7;
    drive.connect(post); post.connect(out.node);
    this._osc(drive, t, 0.14, 'sawtooth', 1600, 160, 0.5, 0.002);
    this._osc(drive, t, 0.2, 'square', 800, 90, 0.35, 0.002);
    this._osc(drive, t, 0.1, 'sine', 3000, 500, 0.4, 0.001);
    this._burst(out.node, t, 0.05, 'highpass', 5000, 5000, 0.6, v * 0.6, 0.001);
    this._burst(out.node, t + 0.02, 0.3, 'bandpass', 1400, 300, 1.5, v * 0.2, 0.02);
  }

  click(pos, freq = 2200, vol = 0.35, dur = 0.05) {
    if (!this.ready) return;
    const out = this._out(pos ? this.busSfx : this.busUi, pos, 10, 55, 0);
    if (!out) return;
    this._osc(out.node, this.ctx.currentTime, dur, 'square', freq, freq * 0.4, vol * out.gain, 0.003);
  }

  tone(freq, dur = 0.1, vol = 0.3, type = 'sine', bus = null, slideTo = null) {
    if (!this.ready) return;
    this._osc(bus || this.busUi, this.ctx.currentTime, dur, type, freq, slideTo || freq, vol, 0.008);
  }

  /**
   * Trefferbestaetigung: knackiger Tick, Kopfschuss = heller Ping, Kill = Doppelklick.
   * dist: Entfernung zum Treffer - weit weg klingt es duenner, leiser und kommt
   * mit "Schalllaufzeit" etwas spaeter an.
   */
  hitmarker(headshot, kill, dist = 0) {
    if (!this.ready) return;
    const far = clamp((dist - 18) / 70, 0, 1);
    const t = this.ctx.currentTime + clamp(dist / 360, 0, 0.15);
    const d = this.busUi;
    const vol = 1 - far * 0.35;
    const pitch = 1 + far * 0.35;
    if (headshot) {
      this._osc(d, t, 0.10, 'sine', 2600 * pitch, 2500 * pitch, 0.22 * vol, 0.002);
      this._osc(d, t, 0.14, 'sine', 3900 * pitch, 3800 * pitch, 0.10 * vol, 0.002);
      this._burst(d, t, 0.02, 'highpass', 4000, 4000, 0.6, 0.25 * vol, 0.001);
    } else {
      this._burst(d, t, 0.025, 'bandpass', 1800 * pitch, 1200 * pitch, 1.5 + far, 0.35 * vol, 0.001);
      this._osc(d, t, 0.045 - far * 0.015, 'sine', 1100 * pitch, 750 * pitch, 0.22 * vol * (1 - far * 0.4), 0.002);
      if (far < 0.5) this._bodyOsc(d, t, 0.05, 320, 140, 0.12 * (1 - far * 2));   // nah: mit Koerper
    }
    if (kill) {
      this._burst(d, t + 0.05, 0.03, 'bandpass', 1500, 900, 1.5, 0.3, 0.001);
      this._osc(d, t + 0.05, 0.06, 'sine', 900, 600, 0.2, 0.002);
    }
  }

  /** Dash: kurzer Luftstoss */
  dash(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.24, 'bandpass', 380, 2200, 1.4, 0.45 * out.gain, 0.02);
    this._bodyOsc(out.node, t, 0.12, 160, 60, 0.25 * out.gain);
  }

  /** Wandlauf-Start: Schleifen an der Wand */
  wallrun(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 8, 40, 0.1);
    if (!out) return;
    this._burst(out.node, this.ctx.currentTime, 0.18, 'bandpass', 700, 1600, 1.0, 0.3 * out.gain, 0.03);
  }

  /** Waffe inspizieren: leises Metall-/Stoff-Ticken */
  inspect(hold) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const d = this.busUi;
    if (hold === 'knife' || hold === 'katana') {
      this._burst(d, t, 0.08, 'bandpass', 3000, 7000, 3.0, 0.12, 0.01);
      this._osc(d, t + 0.02, 0.16, 'sine', 4200, 4000, 0.05, 0.004);
    } else {
      this._burst(d, t, 0.05, 'bandpass', 1400, 900, 1.5, 0.14, 0.003);
      this._burst(d, t + 0.02, 0.12, 'bandpass', 500, 350, 1.0, 0.06, 0.02);
    }
  }

  kill() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._osc(this.busUi, t, 0.10, 'triangle', 740, 740, 0.22, 0.005);
    this._osc(this.busUi, t + 0.07, 0.10, 'triangle', 990, 990, 0.22, 0.005);
    this._osc(this.busUi, t + 0.14, 0.18, 'triangle', 1320, 1320, 0.22, 0.005);
    this._bodyOsc(this.busUi, t, 0.16, 160, 50, 0.25);
  }

  // --------------------------------------------------------
  // Waffe zuecken
  // --------------------------------------------------------
  draw(pos, hold) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 45, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    const d = out.node;
    if (hold === 'knife') {
      this._burst(d, t, 0.14, 'bandpass', 2600, 9000, 3.0, v * 0.45, 0.01);
      this._osc(d, t + 0.02, 0.24, 'sine', 4200, 3950, v * 0.16, 0.004);
      this._osc(d, t + 0.02, 0.18, 'sine', 6300, 6000, v * 0.08, 0.004);
      this._burst(d, t + 0.18, 0.03, 'bandpass', 2200, 1200, 2.0, v * 0.25, 0.002);
      this._burst(d, t + 0.30, 0.03, 'bandpass', 1800, 1000, 2.0, v * 0.2, 0.002);
    } else if (hold === 'katana') {
      this._burst(d, t, 0.42, 'bandpass', 1400, 7800, 2.2, v * 0.55, 0.02);
      this._burst(d, t, 0.34, 'highpass', 3000, 6500, 0.7, v * 0.18, 0.02);
      this._osc(d, t + 0.32, 0.6, 'sine', 2900, 2760, v * 0.2, 0.005);
      this._osc(d, t + 0.32, 0.5, 'sine', 4350, 4200, v * 0.1, 0.005);
      this._osc(d, t + 0.34, 0.3, 'triangle', 1450, 1400, v * 0.08, 0.005);
    } else if (hold === 'pistol' || hold === 'akimbo') {
      this._burst(d, t, 0.05, 'bandpass', 2400, 1200, 1.5, v * 0.35, 0.002);
      this._osc(d, t, 0.04, 'square', 1700, 900, v * 0.1, 0.002);
      this._burst(d, t + 0.09, 0.05, 'lowpass', 1800, 600, 0.8, v * 0.4, 0.002);
      this._osc(d, t + 0.09, 0.05, 'square', 900, 500, v * 0.12, 0.002);
    } else if (hold === 'launcher') {
      this._burst(d, t, 0.12, 'lowpass', 1200, 500, 0.8, v * 0.45, 0.01);
      this._osc(d, t + 0.1, 0.08, 'square', 600, 350, v * 0.15, 0.003);
    } else {
      this._burst(d, t, 0.06, 'bandpass', 1800, 2600, 1.8, v * 0.3, 0.003);
      this._osc(d, t, 0.04, 'square', 1500, 800, v * 0.1, 0.002);
      this._burst(d, t + 0.12, 0.06, 'lowpass', 2200, 700, 0.8, v * 0.5, 0.002);
      this._osc(d, t + 0.12, 0.06, 'square', 1000, 450, v * 0.16, 0.002);
      this._burst(d, t + 0.02, 0.2, 'bandpass', 600, 400, 1.0, v * 0.08, 0.03);
    }
  }

  impact(pos, hard = true) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 65, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.07, hard ? 'highpass' : 'bandpass', hard ? 2600 : 800, hard ? 2600 : 800, 1.0, 0.38 * out.gain, 0.002);
    if (hard) this._osc(out.node, t, 0.04, 'triangle', 1200, 300, 0.12 * out.gain, 0.002);
  }

  flesh(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 50, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.10, 'lowpass', 700, 700, 1.0, 0.45 * out.gain, 0.003);
    this._bodyOsc(out.node, t, 0.08, 220, 60, 0.25 * out.gain);
  }

  meleeHit(pos, kind, heavy) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 55, 0.18);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain * (heavy ? 1.3 : 1);
    this._burst(out.node, t, 0.14, 'lowpass', 600, 400, 1.0, 0.7 * v, 0.003);
    this._bodyOsc(out.node, t, 0.12, 200, 50, 0.45 * v);
    this._burst(out.node, t, 0.05, 'bandpass', 1400, 900, 1.5, 0.3 * v, 0.002);
    if (kind === 'katana') {
      this._osc(out.node, t + 0.01, 0.38, 'sine', 3100, 2950, 0.14 * v, 0.003);
      this._burst(out.node, t, 0.2, 'bandpass', 3000, 6000, 3.0, 0.2 * v, 0.005);
    } else if (kind === 'knife') {
      this._burst(out.node, t, 0.08, 'bandpass', 2500, 5000, 2.5, 0.18 * v, 0.003);
    }
  }

  /** Schritt auf Untergrund: sand | dirt | stone | wood | metal | grate */
  step(pos, loud = 1, surface = 'stone') {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 6, 42, surface === 'metal' || surface === 'grate' ? 0.16 : 0.08);
    if (!out) return;
    const t = this.ctx.currentTime;
    const d = out.node;
    const v = 0.32 * loud * out.gain;
    switch (surface) {
      case 'sand':
        this._burst(d, t, 0.11, 'lowpass', 1000, 380, 0.7, v * 0.95, 0.01);
        this._burst(d, t + 0.02, 0.07, 'bandpass', 2200, 1400, 0.8, v * 0.22, 0.012);
        break;
      case 'dirt':
        this._burst(d, t, 0.09, 'lowpass', 800, 300, 0.8, v * 0.9, 0.006);
        this._burst(d, t, 0.04, 'bandpass', 1500, 900, 1.0, v * 0.2, 0.004);
        break;
      case 'wood':
        this._burst(d, t, 0.07, 'lowpass', 1300, 500, 0.9, v * 0.85, 0.003);
        this._bodyOsc(d, t, 0.09, 240, 110, v * 0.55);
        break;
      case 'metal':
        this._burst(d, t, 0.05, 'bandpass', 1500, 1100, 3.0, v * 0.7, 0.002);
        this._osc(d, t, 0.16, 'sine', 2300 * rand(0.95, 1.05), 2200, v * 0.22, 0.002);
        this._osc(d, t, 0.10, 'sine', 3400, 3300, v * 0.10, 0.002);
        this._bodyOsc(d, t, 0.07, 170, 80, v * 0.4);
        break;
      case 'grate':
        this._burst(d, t, 0.05, 'bandpass', 2400, 1600, 3.0, v * 0.6, 0.002);
        this._burst(d, t + 0.03, 0.05, 'bandpass', 1900, 1400, 2.5, v * 0.3, 0.002);   // Rappeln
        this._osc(d, t, 0.2, 'sine', 3100 * rand(0.95, 1.05), 3000, v * 0.18, 0.002);
        this._bodyOsc(d, t, 0.06, 150, 70, v * 0.3);
        break;
      default: {
        const f = rand(800, 1100);
        this._burst(d, t, 0.06, 'bandpass', f, f * 0.65, 1.2, v, 0.003);
        this._burst(d, t, 0.025, 'highpass', 3000, 3000, 0.7, v * 0.3, 0.002);
      }
    }
  }

  jump(pos) { this.click(pos, 480, 0.18, 0.07); }

  land(pos, hard, surface = 'stone') {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 8, 55, 0.12);
    if (!out) return;
    const t = this.ctx.currentTime;
    const d = out.node;
    const v = (hard ? 0.6 : 0.3) * out.gain;
    if (surface === 'metal' || surface === 'grate') {
      this._burst(d, t, 0.08, 'bandpass', 900, 600, 1.5, v * 0.9, 0.003);
      this._osc(d, t, 0.28, 'sine', 1500, 1450, v * 0.3, 0.003);
      this._osc(d, t, 0.2, 'sine', 2400, 2350, v * 0.15, 0.003);
      this._bodyOsc(d, t, 0.14, 130, 50, v * 0.6);
    } else if (surface === 'wood') {
      this._burst(d, t, 0.12, 'lowpass', 900, 350, 0.9, v * 0.9, 0.004);
      this._bodyOsc(d, t, 0.16, 160, 60, v * 0.7);
    } else if (surface === 'sand' || surface === 'dirt') {
      this._burst(d, t, 0.16, 'lowpass', 500, 220, 0.8, v * 1.0, 0.008);
    } else {
      this._burst(d, t, 0.14, 'lowpass', hard ? 380 : 600, hard ? 380 : 600, 1.0, v, 0.006);
      if (hard) this._bodyOsc(d, t, 0.12, 120, 40, 0.3 * out.gain);
    }
  }

  reloadStep(pos, kind) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40, 0.12);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    const d = out.node;
    if (kind === 0) {
      this._osc(d, t, 0.05, 'square', 1300, 600, v * 0.12, 0.002);
      this._burst(d, t + 0.02, 0.09, 'bandpass', 900, 400, 1.2, v * 0.3, 0.005);
    } else if (kind === 1) {
      this._burst(d, t, 0.06, 'lowpass', 1400, 400, 0.8, v * 0.5, 0.002);
      this._osc(d, t, 0.06, 'triangle', 420, 180, v * 0.25, 0.002);
      this._osc(d, t + 0.03, 0.04, 'square', 1100, 700, v * 0.1, 0.002);
    } else {
      this._burst(d, t, 0.05, 'bandpass', 2200, 1200, 1.6, v * 0.3, 0.002);
      this._osc(d, t, 0.04, 'square', 1600, 800, v * 0.12, 0.002);
      this._burst(d, t + 0.08, 0.05, 'lowpass', 1800, 600, 0.8, v * 0.45, 0.002);
      this._osc(d, t + 0.08, 0.05, 'square', 900, 450, v * 0.14, 0.002);
    }
  }

  explosion(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 22, 200, 0.45);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    const drive = this._shaper(3.5);
    const post = this.ctx.createGain();
    post.gain.value = v * 0.8;
    drive.connect(post); post.connect(out.node);
    this._burst(drive, t, 0.03, 'highpass', 2500, 2500, 0.5, 1.2, 0.001);
    this._burst(drive, t, 0.7, 'lowpass', 3800, 150, 0.6, 1.1, 0.006);
    this._bodyOsc(drive, t, 0.6, 150, 26, 1.0);
    this._burst(out.node, t + 0.1, 1.6, 'lowpass', 800, 180, 0.5, v * 0.35, 0.05);
  }

  whizz(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 4, 20, 0);
    if (!out) return;
    this._burst(out.node, this.ctx.currentTime, 0.12, 'bandpass', 3200, 900, 4, 0.3 * out.gain, 0.015);
  }

  swing(pos, kind, heavy) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40, 0.12);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    if (kind === 'katana') {
      const dur = heavy ? 0.34 : 0.24;
      this._burst(out.node, t, dur, 'bandpass', heavy ? 380 : 520, heavy ? 2200 : 2800, 2.2, v * (heavy ? 0.5 : 0.4), 0.04);
      this._burst(out.node, t + 0.03, dur, 'highpass', 2500, 5000, 0.8, v * 0.12, 0.04);
    } else if (kind === 'knife') {
      const dur = heavy ? 0.2 : 0.13;
      this._burst(out.node, t, dur, 'bandpass', 1100, 3800, 2.6, v * 0.3, 0.02);
    } else {
      this._burst(out.node, t, 0.16, 'bandpass', 700, 2600, 2.4, v * 0.28, 0.03);
    }
  }

  death(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 70, 0.2);
    if (!out) return;
    const t = this.ctx.currentTime;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    f.connect(out.node);
    this._osc(f, t, 0.5, 'sawtooth', 300, 60, 0.3 * out.gain, 0.02);
  }

  uiHover() { this.tone(620, 0.03, 0.09, 'sine'); }
  uiClick() { this.tone(880, 0.05, 0.16, 'square'); }
  countdown(last) { this.tone(last ? 1400 : 900, 0.14, 0.3, 'square'); }
  win()  { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.26, 'triangle'), i * 130)); }
  lose() { [520, 440, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 0.24, 'triangle'), i * 150)); }
}

export const audio = new AudioEngine();
