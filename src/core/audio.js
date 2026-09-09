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
    if (opt.kind === 'bow') { this._bowShot(pos, opt); return; }
    if (opt.kind === 'flame') { this._flameTick(pos, opt); return; }
    if (opt.kind === 'throw') { this._throw(pos, opt); return; }
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

  /** Bogen: Sehne schnalzt, Pfeil zischt ab */
  _bowShot(pos, opt) {
    const out = this._out(this.busSfx, pos, 10, 70, 0.2);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = (opt.vol || 0.8) * out.gain * (opt.power !== undefined ? 0.6 + opt.power * 0.5 : 1);
    this._burst(out.node, t, 0.03, 'bandpass', 900, 500, 1.5, 0.7 * v, 0.001);
    this._osc(out.node, t, 0.16, 'triangle', 240, 160, 0.35 * v, 0.002);
    this._osc(out.node, t, 0.09, 'sine', 620, 380, 0.2 * v, 0.002);
    this._burst(out.node, t + 0.01, 0.22, 'bandpass', 2400, 900, 2.0, 0.25 * v, 0.01);   // Pfeil zischt
  }

  /** Bogen spannen: Sehne knarzt */
  bowDraw(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.45, 'bandpass', 500, 900, 3.0, 0.16 * out.gain, 0.08);
    this._osc(out.node, t, 0.5, 'sawtooth', 90, 130, 0.04 * out.gain, 0.1);
  }

  /** Flammenwerfer: kurzer Rausch-Stoss pro Tick -> wirkt durchgehend */
  _flameTick(pos, opt) {
    const out = this._out(this.busSfx, pos, 10, 60, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = (opt.vol || 0.5) * out.gain;
    this._burst(out.node, t, 0.16, 'lowpass', 900 * rand(0.8, 1.2), 500, 0.8, 0.5 * v, 0.02);
    this._burst(out.node, t, 0.12, 'bandpass', 2200 * rand(0.8, 1.2), 1500, 1.0, 0.16 * v, 0.02);
    this._bodyOsc(out.node, t, 0.1, 110 * rand(0.9, 1.1), 70, 0.14 * v);
  }

  /** Wurfmesser: kurzer Wurf-Whoosh */
  _throw(pos, opt) {
    const out = this._out(this.busSfx, pos, 8, 40, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = (opt.vol || 0.6) * out.gain;
    this._burst(out.node, t, 0.14, 'bandpass', 900, 3200, 2.5, 0.4 * v, 0.02);
    this._osc(out.node, t + 0.02, 0.1, 'sine', 3800, 4200, 0.06 * v, 0.004);
  }

  /** Minigun: Laeufe laufen an (k = 0..1), pro Aufruf ein kurzer Ton */
  spin(pos, k, up) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 50, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    const f = 180 + k * 520;
    this._osc(out.node, t, 0.11, 'sawtooth', f, f * (up ? 1.08 : 0.94), 0.06 * out.gain, 0.01);
    this._burst(out.node, t, 0.1, 'bandpass', 1200 + k * 1800, 1200 + k * 1800, 3.0, 0.06 * out.gain, 0.01);
  }

  /** Brennen: leises Knistern */
  burn(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 6, 30, 0.05);
    if (!out) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._burst(out.node, t + Math.random() * 0.2, 0.02, 'highpass', 3000, 3000, 0.6, 0.12 * out.gain, 0.002);
    this._burst(out.node, t, 0.25, 'lowpass', 800, 500, 0.8, 0.12 * out.gain, 0.05);
  }

  /** Holz splittert / Fass birst */
  breakWood(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 60, 0.2);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    this._burst(out.node, t, 0.12, 'lowpass', 1500, 400, 0.9, 0.7 * v, 0.002);
    this._bodyOsc(out.node, t, 0.1, 260, 90, 0.4 * v);
    for (let i = 0; i < 5; i++) this._burst(out.node, t + 0.03 + i * 0.04, 0.03, 'bandpass', 1800 - i * 200, 900, 2.0, 0.25 * v, 0.002);
  }

  /** Glas zerspringt */
  breakGlass(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 60, 0.25);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    this._burst(out.node, t, 0.05, 'highpass', 4000, 4000, 0.6, 0.7 * v, 0.001);
    for (let i = 0; i < 9; i++) {
      const f = 3000 + Math.random() * 5000;
      this._osc(out.node, t + Math.random() * 0.25, 0.08, 'sine', f, f * 0.97, 0.08 * v, 0.001);
    }
    this._burst(out.node, t + 0.05, 0.35, 'bandpass', 5000, 3000, 1.5, 0.2 * v, 0.02);
  }

  /** Luftschlag: Jet-Vorbeiflug, danach kommen die Explosionen ueber explosion() */
  jet(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 30, 260, 0.3);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 1.4, 'bandpass', 300, 2600, 0.8, 0.5 * out.gain, 0.5);
    this._osc(out.node, t, 1.3, 'sawtooth', 140, 420, 0.08 * out.gain, 0.4);
  }

  /** Enterhaken: Abschuss (Druckluft + Klick), Einrasten, Seil laeuft */
  grapple(pos, kind) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 55, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    if (kind === 'shoot') {
      this._burst(out.node, t, 0.06, 'highpass', 2500, 2500, 0.6, 0.5 * v, 0.001);
      this._bodyOsc(out.node, t, 0.08, 400, 120, 0.3 * v);
      this._burst(out.node, t + 0.03, 0.25, 'bandpass', 1800, 900, 1.5, 0.15 * v, 0.02);   // Seil zischt
    } else if (kind === 'hit') {
      this._osc(out.node, t, 0.06, 'square', 2200, 900, 0.14 * v, 0.002);
      this._burst(out.node, t, 0.04, 'bandpass', 3000, 1500, 2.0, 0.35 * v, 0.001);
      this._burst(out.node, t + 0.05, 0.4, 'bandpass', 600, 1400, 1.2, 0.12 * v, 0.05);   // Winde
    } else if (kind === 'miss') {
      this._burst(out.node, t, 0.05, 'highpass', 2500, 2500, 0.6, 0.3 * v, 0.001);
      this._osc(out.node, t + 0.08, 0.05, 'square', 700, 400, 0.08 * v, 0.002);
    } else {
      this._burst(out.node, t, 0.08, 'bandpass', 1400, 700, 1.5, 0.2 * v, 0.005);
    }
  }

  /** Seilbahn: Rolle surrt (wird waehrend der Fahrt periodisch aufgerufen) */
  zip(pos, kind) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 50, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    if (kind === 'start') { this._burst(out.node, t, 0.06, 'bandpass', 2000, 1200, 2.0, 0.3 * v, 0.002); this._osc(out.node, t, 0.05, 'square', 1500, 700, 0.1 * v, 0.002); }
    else if (kind === 'end') { this._burst(out.node, t, 0.05, 'lowpass', 1200, 500, 1.0, 0.3 * v, 0.002); }
    else { this._burst(out.node, t, 0.16, 'bandpass', 2600 * rand(0.95, 1.05), 2400, 4.0, 0.09 * v, 0.02); this._osc(out.node, t, 0.16, 'sawtooth', 240, 250, 0.03 * v, 0.02); }
  }

  /** Kopfbedeckung gewechselt (Menue): Stoffrascheln + Plopp */
  hatSwap() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._burst(this.busUi, t, 0.12, 'bandpass', 1800, 900, 1.2, 0.18, 0.01);
    this._bodyOsc(this.busUi, t + 0.08, 0.07, 500, 220, 0.2);
  }

  /** Bombe (S&D): Legen-Piepen, Ticken, Entschaerft */
  bomb(kind, pos) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (kind === 'plant' || kind === 'defuse') {
      const out = this._out(this.busSfx, pos, 10, 60, 0.1);
      if (!out) return;
      this._osc(out.node, t, 0.05, 'square', kind === 'plant' ? 1800 : 1400, kind === 'plant' ? 1800 : 1400, 0.1 * out.gain, 0.002);
    } else if (kind === 'planted') {
      [900, 1200, 900, 1200].forEach((f, i) => this._osc(this.busUi, t + i * 0.12, 0.1, 'square', f, f, 0.14, 0.003));
    } else if (kind === 'tick') {
      const out = this._out(this.busSfx, pos, 14, 120, 0.2);
      if (!out) return;
      this._osc(out.node, t, 0.06, 'square', 2400, 2400, 0.12 * out.gain, 0.002);
    } else if (kind === 'defused') {
      [1200, 900, 700].forEach((f, i) => this._osc(this.busUi, t + i * 0.1, 0.14, 'triangle', f, f, 0.18, 0.003));
    }
  }

  /** Zombie-Knurren (Infection) */
  growl(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 45, 0.2);
    if (!out) return;
    const t = this.ctx.currentTime;
    const drive = this._shaper(2.5);
    const post = this.ctx.createGain(); post.gain.value = 0.35 * out.gain;
    drive.connect(post); post.connect(out.node);
    this._osc(drive, t, 0.5, 'sawtooth', 90 * rand(0.85, 1.15), 60, 0.5, 0.05);
    this._burst(drive, t, 0.45, 'lowpass', 700, 300, 1.0, 0.5, 0.05);
  }

  /** Chat-Ping (UI) */
  chat() { if (this.ready) this._osc(this.busUi, this.ctx.currentTime, 0.05, 'sine', 1500, 1500, 0.08, 0.003); }

  /** Waffe aufgehoben */
  pickupWeapon() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._burst(this.busUi, t, 0.05, 'bandpass', 1500, 900, 1.5, 0.25, 0.002);
    this._osc(this.busUi, t + 0.04, 0.08, 'square', 900, 1300, 0.12, 0.003);
  }

  /** Killstreak / Objective-Meldungen (UI) */
  reward(level) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const base = level >= 7 ? 660 : level >= 5 ? 560 : 480;
    this._osc(this.busUi, t, 0.12, 'triangle', base, base, 0.2, 0.005);
    this._osc(this.busUi, t + 0.1, 0.12, 'triangle', base * 1.25, base * 1.25, 0.2, 0.005);
    this._osc(this.busUi, t + 0.2, 0.24, 'triangle', base * 1.5, base * 1.5, 0.22, 0.005);
  }
  uavPing() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._osc(this.busUi, t, 0.18, 'sine', 1400, 1380, 0.1, 0.005);
  }
  objective(kind) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (kind === 'pickup') { this._osc(this.busUi, t, 0.1, 'square', 700, 900, 0.14, 0.005); this._osc(this.busUi, t + 0.1, 0.12, 'square', 1000, 1100, 0.14, 0.005); }
    else if (kind === 'capture') { [520, 660, 780, 1040].forEach((f, i) => this._osc(this.busUi, t + i * 0.09, 0.16, 'triangle', f, f, 0.22, 0.005)); }
    else if (kind === 'lost') { [700, 520, 400].forEach((f, i) => this._osc(this.busUi, t + i * 0.12, 0.18, 'triangle', f, f, 0.2, 0.005)); }
    else if (kind === 'return') { this._osc(this.busUi, t, 0.16, 'sine', 900, 1200, 0.18, 0.005); }
    else if (kind === 'zone') { this._osc(this.busUi, t, 0.12, 'square', 600, 600, 0.12, 0.005); this._osc(this.busUi, t + 0.14, 0.12, 'square', 600, 600, 0.12, 0.005); }
    else if (kind === 'level') { this._osc(this.busUi, t, 0.08, 'square', 880, 880, 0.14, 0.004); this._osc(this.busUi, t + 0.08, 0.14, 'square', 1320, 1320, 0.16, 0.004); }
  }

  /** Regen als Dauerrauschen an/aus */
  rain(on) {
    if (!this.ready) return;
    if (on && !this._rain) {
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500;
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      const g = c.createGain(); g.gain.value = 0.0001;
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(this.busSfx);
      src.start();
      g.gain.exponentialRampToValueAtTime(0.11, c.currentTime + 1.5);
      this._rain = { src, g };
    } else if (!on && this._rain) {
      const r = this._rain; this._rain = null;
      r.g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.8);
      setTimeout(() => { try { r.src.stop(); } catch (e) {} }, 900);
    }
  }
  thunder() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const drive = this._shaper(2.5);
    const post = this.ctx.createGain(); post.gain.value = 0.5;
    drive.connect(post); post.connect(this.busSfx);
    this._burst(drive, t, 0.5, 'lowpass', 900, 120, 0.7, 0.9, 0.05);
    this._burst(this.busSfx, t + 0.2, 2.2, 'lowpass', 400, 100, 0.6, 0.3, 0.3);
    this._bodyOsc(drive, t, 0.8, 90, 30, 0.6);
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
    const kind = settings.hitSound || 'classic';
    if (kind === 'none') return;
    const far = clamp((dist - 18) / 70, 0, 1);
    const t = this.ctx.currentTime + clamp(dist / 360, 0, 0.15);
    const d = this.busUi;
    const hv = settings.volHit !== undefined ? settings.volHit : 1;
    const vol = (1 - far * 0.35) * hv;
    const pitch = 1 + far * 0.35;
    const hs = headshot ? 1.35 : 1;

    switch (kind) {
      case 'click':
        // Trockener Mausklick-Tick
        this._osc(d, t, 0.018, 'square', 3200 * pitch * hs, 1400 * pitch, 0.22 * vol, 0.0008);
        this._burst(d, t, 0.012, 'highpass', 6000, 6000, 0.5, 0.3 * vol, 0.0006);
        if (headshot) this._osc(d, t + 0.03, 0.018, 'square', 4200 * pitch, 1800 * pitch, 0.2 * vol, 0.0008);
        break;
      case 'ping':
        this._osc(d, t, 0.13, 'sine', 1900 * pitch * hs, 1850 * pitch * hs, 0.26 * vol, 0.002);
        this._osc(d, t, 0.09, 'sine', 3800 * pitch * hs, 3700 * pitch * hs, 0.08 * vol, 0.002);
        this._burst(d, t, 0.012, 'highpass', 5000, 5000, 0.6, 0.18 * vol, 0.001);
        break;
      case 'bass':
        this._bodyOsc(d, t, 0.11, 240 * hs, 60, 0.5 * vol);
        this._burst(d, t, 0.02, 'lowpass', 1200, 500, 0.8, 0.35 * vol, 0.001);
        if (headshot) this._osc(d, t, 0.07, 'sine', 900 * pitch, 850 * pitch, 0.16 * vol, 0.002);
        break;
      case 'retro': {
        // 8-Bit: kurzes Rechteck-Arpeggio
        const base = (headshot ? 1180 : 880) * pitch;
        this._osc(d, t, 0.035, 'square', base, base, 0.14 * vol, 0.001);
        this._osc(d, t + 0.035, 0.035, 'square', base * 1.5, base * 1.5, 0.14 * vol, 0.001);
        if (headshot) this._osc(d, t + 0.07, 0.05, 'square', base * 2, base * 2, 0.12 * vol, 0.001);
        break;
      }
      case 'wood':
        this._burst(d, t, 0.05, 'lowpass', 1400 * hs, 500, 0.9, 0.5 * vol, 0.001);
        this._bodyOsc(d, t, 0.06, 520 * hs, 190, 0.32 * vol);
        if (headshot) { this._burst(d, t + 0.06, 0.05, 'lowpass', 1700, 600, 0.9, 0.4 * vol, 0.001); this._bodyOsc(d, t + 0.06, 0.05, 640, 240, 0.25 * vol); }
        break;
      case 'bell':
        this._osc(d, t, 0.28, 'triangle', 2400 * hs, 2380 * hs, 0.2 * vol, 0.002);
        this._osc(d, t, 0.2, 'sine', 3600 * hs, 3580 * hs, 0.08 * vol, 0.002);
        this._osc(d, t, 0.12, 'sine', 1200 * hs, 1190 * hs, 0.06 * vol, 0.002);
        break;
      default:
        if (headshot) {
          this._osc(d, t, 0.10, 'sine', 2600 * pitch, 2500 * pitch, 0.22 * vol, 0.002);
          this._osc(d, t, 0.14, 'sine', 3900 * pitch, 3800 * pitch, 0.10 * vol, 0.002);
          this._burst(d, t, 0.02, 'highpass', 4000, 4000, 0.6, 0.25 * vol, 0.001);
        } else {
          this._burst(d, t, 0.025, 'bandpass', 1800 * pitch, 1200 * pitch, 1.5 + far, 0.35 * vol, 0.001);
          this._osc(d, t, 0.045 - far * 0.015, 'sine', 1100 * pitch, 750 * pitch, 0.22 * vol * (1 - far * 0.4), 0.002);
          if (far < 0.5) this._bodyOsc(d, t, 0.05, 320, 140, 0.12 * (1 - far * 2) * hv);   // nah: mit Koerper
        }
    }
    if (kill) {
      this._burst(d, t + 0.05, 0.03, 'bandpass', 1500, 900, 1.5, 0.3 * hv, 0.001);
      this._osc(d, t + 0.05, 0.06, 'sine', 900, 600, 0.2 * hv, 0.002);
    }
  }

  /** Vorschau im Menue: Treffer, Kopfschuss, Kill nacheinander */
  previewHitsound() {
    if (!this.ready) return;
    this.hitmarker(false, false, 0);
    setTimeout(() => this.hitmarker(true, false, 0), 260);
    setTimeout(() => this.hitmarker(false, true, 0), 560);
  }

  /** Trainings-Zielscheibe getroffen (pop + Ping) */
  targetHit(pos, kind) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 14, 120, 0.2);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    this._burst(out.node, t, 0.03, 'bandpass', 2600, 1200, 1.2, 0.5 * v, 0.001);
    this._bodyOsc(out.node, t, 0.08, 480, 160, 0.3 * v);
    const f = kind === 'perfect' ? 1760 : 1320;
    this._osc(out.node, t + 0.01, 0.16, 'sine', f, f * 0.98, 0.22 * v, 0.002);
    this._osc(out.node, t + 0.01, 0.1, 'sine', f * 2, f * 1.96, 0.06 * v, 0.002);
  }

  /** Zielscheibe erscheint */
  targetSpawn(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 14, 120, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._osc(out.node, t, 0.06, 'sine', 700, 1100, 0.12 * out.gain, 0.004);
  }

  /** Kill-Effekt-Sound am Opfer */
  killEffect(kind, pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 14, 90, 0.25);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    const d = out.node;
    switch (kind) {
      case 'confetti':
        // Partyknaller: Knall + Papierrascheln
        this._burst(d, t, 0.05, 'highpass', 1800, 1800, 0.6, 0.9 * v, 0.001);
        this._bodyOsc(d, t, 0.12, 300, 70, 0.5 * v);
        this._burst(d, t + 0.05, 0.5, 'bandpass', 3500, 5500, 1.2, 0.18 * v, 0.05);
        this._osc(d, t + 0.02, 0.12, 'square', 900, 1400, 0.06 * v, 0.01);
        break;
      case 'fireworks':
        // Aufsteigendes Pfeifen, dann Knall und Knistern
        this._osc(d, t, 0.22, 'sine', 600, 2200, 0.12 * v, 0.01);
        this._burst(d, t + 0.22, 0.08, 'lowpass', 3000, 400, 0.7, 1.0 * v, 0.002);
        this._bodyOsc(d, t + 0.22, 0.3, 200, 40, 0.6 * v);
        for (let i = 0; i < 9; i++) {
          this._burst(d, t + 0.3 + i * 0.045 + Math.random() * 0.03, 0.02, 'highpass', 3000, 3000, 0.5, (0.35 - i * 0.03) * v, 0.001);
        }
        break;
      case 'voxel':
        // Digitales Zerfallen
        this._osc(d, t, 0.18, 'square', 1800, 200, 0.16 * v, 0.002);
        this._osc(d, t, 0.12, 'sawtooth', 900, 120, 0.12 * v, 0.002);
        for (let i = 0; i < 6; i++) this._osc(d, t + 0.05 + i * 0.03, 0.025, 'square', 2400 - i * 300, 2000 - i * 300, 0.06 * v, 0.001);
        this._burst(d, t, 0.1, 'bandpass', 2000, 600, 2.0, 0.3 * v, 0.002);
        break;
      case 'soul':
        // Sanfter Akkord
        this._osc(d, t, 0.9, 'sine', 660, 660, 0.12 * v, 0.05);
        this._osc(d, t + 0.1, 0.9, 'sine', 990, 990, 0.09 * v, 0.05);
        this._osc(d, t + 0.2, 1.1, 'sine', 1320, 1320, 0.07 * v, 0.05);
        this._burst(d, t, 1.0, 'bandpass', 800, 2400, 1.5, 0.05 * v, 0.2);
        break;
      case 'coins':
        for (let i = 0; i < 6; i++) {
          const tt = t + i * 0.07 + Math.random() * 0.03;
          const f = 2600 + Math.random() * 1400;
          this._osc(d, tt, 0.12, 'sine', f, f * 0.99, 0.12 * v, 0.001);
          this._osc(d, tt, 0.06, 'sine', f * 1.5, f * 1.48, 0.05 * v, 0.001);
          this._burst(d, tt, 0.015, 'highpass', 5000, 5000, 0.6, 0.1 * v, 0.001);
        }
        break;
      case 'gore':
        this._burst(d, t, 0.18, 'lowpass', 900, 300, 0.9, 0.8 * v, 0.003);
        this._bodyOsc(d, t, 0.14, 200, 50, 0.4 * v);
        this._burst(d, t + 0.05, 0.3, 'bandpass', 600, 1800, 1.2, 0.2 * v, 0.05);
        break;
      default:
        break;
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
      case 'water':
        this._burst(d, t, 0.16, 'bandpass', 1800 * rand(0.9, 1.1), 700, 0.9, v * 1.1, 0.01);   // Platschen
        this._burst(d, t + 0.04, 0.12, 'highpass', 3000, 3000, 0.6, v * 0.3, 0.02);
        this._bodyOsc(d, t, 0.08, 300, 120, v * 0.3);
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
