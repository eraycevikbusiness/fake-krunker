// ============================================================
// Audio: alle Sounds werden zur Laufzeit synthetisiert
// (keine externen Dateien nötig -> funktioniert offline)
// ============================================================

import { settings } from './settings.js';
import { clamp, rand } from './utils.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.busSfx = null;
    this.busSteps = null;
    this.busUi = null;
    this.noiseBuf = null;
    this.ready = false;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.listenerFwd = { x: 0, y: 0, z: -1 };
    this.listenerRight = { x: 1, y: 0, z: 0 };
    this._voices = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();

    this.master = this.ctx.createGain();
    this.master.gain.value = settings.volMaster;
    // Sanfter Limiter, damit viele gleichzeitige Schüsse nicht clippen
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const mk = (v) => { const g = this.ctx.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.busSfx = mk(settings.volSfx);
    this.busSteps = mk(settings.volSteps);
    this.busUi = mk(settings.volUi);

    // Weißes Rauschen als wiederverwendbarer Puffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
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

  /**
   * Erstellt eine Ausgangskette mit Distanz-Dämpfung + Stereo-Panning.
   * pos == null -> 2D (z.B. eigene Waffe / UI)
   */
  _out(bus, pos, refDist = 14, maxDist = 110) {
    const g = this.ctx.createGain();
    if (!pos) { g.connect(bus); return { node: g, gain: 1 }; }

    const dx = pos.x - this.listenerPos.x;
    const dy = pos.y - this.listenerPos.y;
    const dz = pos.z - this.listenerPos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > maxDist) return null;

    // Inverse Distanzdämpfung
    let att = refDist / (refDist + Math.max(0, dist - refDist) * 1.35);
    att *= clamp(1 - dist / maxDist, 0, 1);

    // Entfernte Sounds klingen dumpfer
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = clamp(20000 - dist * 150, 900, 20000);

    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan && dist > 0.001) {
      const rx = this.listenerRight.x, rz = this.listenerRight.z;
      pan.pan.value = clamp((dx * rx + dz * rz) / dist, -1, 1) * 0.85;
    }

    g.connect(lp);
    if (pan) { lp.connect(pan); pan.connect(bus); } else { lp.connect(bus); }
    return { node: g, gain: att };
  }

  _noise(dur) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = rand(0.85, 1.15);
    src.start(this.ctx.currentTime, Math.random() * 1.5);
    src.stop(this.ctx.currentTime + dur + 0.05);
    return src;
  }

  // --------------------------------------------------------
  // Schuss: Rausch-Knall + tiefer Body-Sinus + Transient-Klick
  // --------------------------------------------------------
  shot(pos, opt = {}) {
    if (!this.ready) return;
    const {
      vol = 1, lowCut = 180, hiCut = 5200, dur = 0.18,
      body = 90, punch = 1, refDist = 16, maxDist = 140,
    } = opt;
    const out = this._out(this.busSfx, pos, refDist, maxDist);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = vol * out.gain;
    out.node.gain.value = 1;

    // Rauschanteil
    const n = this._noise(dur);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(hiCut, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(120, lowCut), t + dur);
    bp.Q.value = 0.7;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(v * 0.9, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(bp); bp.connect(ng); ng.connect(out.node);

    // Body (tiefer Punch)
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(body * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(body * 0.5, t + dur * 0.8);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v * 0.75 * punch, t + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
    o.connect(og); og.connect(out.node);
    o.start(t); o.stop(t + dur + 0.05);

    // Tail / Nachhall bei entfernten Schüssen
    if (pos) {
      const tail = this._noise(0.35);
      const tf = this.ctx.createBiquadFilter();
      tf.type = 'lowpass'; tf.frequency.value = 1400;
      const tg = this.ctx.createGain();
      tg.gain.setValueAtTime(0.0001, t + 0.02);
      tg.gain.exponentialRampToValueAtTime(v * 0.16, t + 0.05);
      tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      tail.connect(tf); tf.connect(tg); tg.connect(out.node);
    }
  }

  /** Kurzer, heller Klick (Trockenschuss, UI-Tick) */
  click(pos, freq = 2200, vol = 0.35, dur = 0.05) {
    if (!this.ready) return;
    const out = this._out(pos ? this.busSfx : this.busUi, pos, 10, 55);
    if (!out) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.4, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol * out.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out.node);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Ton mit Hüllkurve (für Hitmarker, Level-Up, Countdown) */
  tone(freq, dur = 0.1, vol = 0.3, type = 'sine', bus = null, slideTo = null) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.busUi);
    o.start(t); o.stop(t + dur + 0.02);
  }

  hitmarker(headshot) {
    if (headshot) { this.tone(1500, 0.07, 0.28, 'square'); this.tone(2300, 0.09, 0.22, 'square'); }
    else this.tone(1150, 0.055, 0.22, 'square');
  }

  kill() {
    this.tone(720, 0.09, 0.26, 'triangle');
    setTimeout(() => this.tone(980, 0.09, 0.26, 'triangle'), 55);
    setTimeout(() => this.tone(1320, 0.14, 0.24, 'triangle'), 110);
  }

  /** Einschlag in Geometrie */
  impact(pos, hard = true) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 65);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.09);
    const f = this.ctx.createBiquadFilter();
    f.type = hard ? 'highpass' : 'bandpass';
    f.frequency.value = hard ? 2200 : 800;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * out.gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  /** Treffer am Körper (fleischiger) */
  flesh(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 50);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.11);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 700;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.45 * out.gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  step(pos, loud = 1) {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 6, 42);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.08);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rand(320, 620);
    f.Q.value = 1.1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * loud * out.gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  jump(pos) { this.click(pos, 480, 0.18, 0.07); }

  land(pos, hard) {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 8, 55);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.14);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = hard ? 380 : 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((hard ? 0.6 : 0.3) * out.gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  reloadStep(pos, kind) {
    const f = kind === 0 ? 900 : kind === 1 ? 1400 : 620;
    this.click(pos, f, 0.3, 0.06);
  }

  explosion(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 22, 200);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;

    const n = this._noise(0.9);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v * 1.1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    n.connect(f); f.connect(g); g.connect(out.node);

    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(24, t + 0.6);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(v * 1.0, t + 0.012);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    o.connect(og); og.connect(out.node);
    o.start(t); o.stop(t + 0.7);
  }

  /** Vorbeifliegendes Projektil */
  whizz(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 4, 20);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.13);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(3000, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.13);
    f.Q.value = 4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * out.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  swing(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40);
    if (!out) return;
    const t = this.ctx.currentTime;
    const n = this._noise(0.16);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(700, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.14);
    f.Q.value = 2.4;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28 * out.gain, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(out.node);
  }

  death(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 70);
    if (!out) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(300, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.45);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3 * out.gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 1200;
    o.connect(f); f.connect(g); g.connect(out.node);
    o.start(t); o.stop(t + 0.55);
  }

  uiHover() { this.tone(620, 0.03, 0.09, 'sine'); }
  uiClick() { this.tone(880, 0.05, 0.16, 'square'); }
  countdown(last) { this.tone(last ? 1400 : 900, 0.14, 0.3, 'square'); }
  win()  { [660, 880, 1100, 1320].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 0.26, 'triangle'), i * 130)); }
  lose() { [520, 440, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, 0.26, 0.24, 'triangle'), i * 150)); }
}

export const audio = new AudioEngine();
