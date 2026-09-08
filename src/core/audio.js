// ============================================================
// Audio: alle Sounds werden zur Laufzeit synthetisiert
// (keine externen Dateien noetig -> funktioniert offline)
//
// Schuesse bestehen aus mehreren Schichten: scharfer Transient,
// Mittel-"Crack", tiefer Body, Mechanik-Klick (Verschluss/Repetieren)
// und Nachhall-Schwanz. Dazu ein kleiner Raum-Hall-Bus (Delay-Netz),
// in den entfernte Geraeusche staerker gemischt werden.
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
    this.busVerb = null;
    this.noiseBuf = null;
    this.ready = false;
    this.listenerPos = { x: 0, y: 0, z: 0 };
    this.listenerFwd = { x: 0, y: 0, z: -1 };
    this.listenerRight = { x: 1, y: 0, z: 0 };
    this._lastShot = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = settings.volMaster;
    // Sanfter Limiter, damit viele gleichzeitige Schuesse nicht clippen
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 14;
    comp.ratio.value = 10;
    comp.attack.value = 0.002;
    comp.release.value = 0.16;
    this.master.connect(comp);
    comp.connect(c.destination);

    const mk = (v) => { const g = c.createGain(); g.gain.value = v; g.connect(this.master); return g; };
    this.busSfx = mk(settings.volSfx);
    this.busSteps = mk(settings.volSteps);
    this.busUi = mk(settings.volUi);

    // Raum-Hall: zwei rueckgekoppelte Delays mit Tiefpass
    this.busVerb = c.createGain();
    this.busVerb.gain.value = 0.55;
    const verbOut = c.createGain();
    verbOut.gain.value = 0.9;
    for (const [dl, fb, lp] of [[0.083, 0.42, 2200], [0.127, 0.36, 1600], [0.191, 0.28, 1100]]) {
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

    // Weisses Rauschen als wiederverwendbarer Puffer
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

  /**
   * Erstellt eine Ausgangskette mit Distanz-Daempfung + Stereo-Panning + Hall-Send.
   * pos == null -> 2D (z.B. eigene Waffe / UI)
   */
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

    // Inverse Distanzdaempfung
    let att = refDist / (refDist + Math.max(0, dist - refDist) * 1.35);
    att *= clamp(1 - dist / maxDist, 0, 1);

    // Entfernte Sounds klingen dumpfer
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
    // Weiter weg -> mehr Hallanteil
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

  /** Gefilterter Rausch-Burst mit Huellkurve */
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

  /** Oszillator mit Frequenz-Sweep und Huellkurve */
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

  // --------------------------------------------------------
  // Schuss
  // --------------------------------------------------------
  shot(pos, opt = {}) {
    if (!this.ready) return;
    if (opt.kind === 'energy') { this._energyShot(pos, opt); return; }
    const {
      vol = 1, lowCut = 180, hiCut = 5200, dur = 0.18,
      body = 90, punch = 1, crack = 1, mech = 0.5, mechDelay = 0.06, tail = 1,
      refDist = 16, maxDist = 150, whoosh = 0,
    } = opt;
    const out = this._out(this.busSfx, pos, refDist, maxDist, 0.22);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = vol * out.gain;
    const near = pos ? clamp(1 - out.dist / 40, 0.2, 1) : 1;
    out.node.gain.value = 1;

    // 1) Transient: extrem kurzer, heller Knall
    this._burst(out.node, t, 0.018, 'highpass', 3500, 3500, 0.5, v * 1.1 * near, 0.001);
    // 2) Crack: Bandpass-Rauschen, Frequenz faellt ueber die Dauer
    this._burst(out.node, t, dur, 'bandpass', hiCut, Math.max(120, lowCut), 0.7, v * 0.85 * crack, 0.004);
    // 3) Body: tiefer Sinus-Punch + Sub
    this._osc(out.node, t, dur * 0.85, 'sine', body * 2.6, body * 0.5, v * 0.8 * punch, 0.004);
    this._osc(out.node, t, dur * 0.5, 'triangle', body * 1.2, body * 0.4, v * 0.35 * punch, 0.003);
    // 4) Mechanik: Verschluss / Repetieren
    if (mech > 0) {
      const tm = t + mechDelay;
      this._burst(out.node, tm, 0.03, 'bandpass', 2600, 1400, 2.5, v * 0.35 * mech, 0.002);
      this._osc(out.node, tm + 0.01, 0.04, 'square', 1900, 700, v * 0.12 * mech, 0.002);
      if (mechDelay > 0.15) {
        // Repetierwaffen: zweiter Klick beim Schliessen
        this._burst(out.node, tm + 0.11, 0.035, 'bandpass', 1800, 900, 2.0, v * 0.3 * mech, 0.002);
      }
    }
    // 5) Schwanz / Nachhall (bei Entfernung laenger und lauter)
    if (tail > 0) {
      const tl = 0.32 + (pos ? clamp(out.dist / 60, 0, 1) * 0.5 : 0.08);
      this._burst(out.node, t + 0.02, tl, 'lowpass', 1600, 300, 0.5, v * 0.22 * tail, 0.03);
    }
    // 6) Rakete: abziehendes Zischen
    if (whoosh > 0) {
      this._burst(out.node, t + 0.04, 0.9, 'bandpass', 900, 260, 1.2, v * 0.5 * whoosh, 0.05);
    }
  }

  _energyShot(pos, opt) {
    const out = this._out(this.busSfx, pos, 14, 120, 0.25);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = (opt.vol || 0.75) * out.gain;
    this._osc(out.node, t, 0.16, 'sawtooth', 1400, 180, v * 0.5, 0.003);
    this._osc(out.node, t, 0.22, 'square', 700, 90, v * 0.3, 0.003);
    this._osc(out.node, t, 0.12, 'sine', 2600, 400, v * 0.35, 0.002);
    this._burst(out.node, t, 0.08, 'highpass', 4000, 4000, 0.6, v * 0.5, 0.001);
    this._burst(out.node, t + 0.02, 0.3, 'bandpass', 1200, 300, 1.5, v * 0.2, 0.02);
  }

  /** Kurzer, heller Klick (Trockenschuss, UI-Tick) */
  click(pos, freq = 2200, vol = 0.35, dur = 0.05) {
    if (!this.ready) return;
    const out = this._out(pos ? this.busSfx : this.busUi, pos, 10, 55, 0);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._osc(out.node, t, dur, 'square', freq, freq * 0.4, vol * out.gain, 0.003);
  }

  /** Ton mit Huellkurve (fuer Hitmarker, Level-Up, Countdown) */
  tone(freq, dur = 0.1, vol = 0.3, type = 'sine', bus = null, slideTo = null) {
    if (!this.ready) return;
    this._osc(bus || this.busUi, this.ctx.currentTime, dur, type, freq, slideTo || freq, vol, 0.008);
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
      // "Shing": heller Stahl-Sweep + kurzes Klingen-Klingeln
      this._burst(d, t, 0.14, 'bandpass', 2600, 9000, 3.0, v * 0.45, 0.01);
      this._osc(d, t + 0.02, 0.22, 'sine', 4200, 3900, v * 0.16, 0.004);
      this._osc(d, t + 0.02, 0.16, 'sine', 6300, 6000, v * 0.08, 0.004);
      this._burst(d, t + 0.16, 0.03, 'bandpass', 2200, 1200, 2.0, v * 0.25, 0.002);   // Griff-Klick (Flip)
    } else if (hold === 'katana') {
      // Ziehen aus der Scheide: langer Stahl-Sweep, dann Klingen-Resonanz
      this._burst(d, t, 0.38, 'bandpass', 1500, 7500, 2.2, v * 0.55, 0.02);
      this._burst(d, t, 0.30, 'highpass', 3000, 6000, 0.7, v * 0.18, 0.02);
      this._osc(d, t + 0.28, 0.55, 'sine', 2900, 2750, v * 0.2, 0.005);
      this._osc(d, t + 0.28, 0.45, 'sine', 4350, 4200, v * 0.1, 0.005);
      this._osc(d, t + 0.30, 0.3, 'triangle', 1450, 1400, v * 0.08, 0.005);
    } else if (hold === 'pistol' || hold === 'akimbo') {
      // Schlitten zurueck / vor
      this._burst(d, t, 0.05, 'bandpass', 2400, 1200, 1.5, v * 0.35, 0.002);
      this._osc(d, t, 0.04, 'square', 1700, 900, v * 0.1, 0.002);
      this._burst(d, t + 0.09, 0.05, 'lowpass', 1800, 600, 0.8, v * 0.4, 0.002);
      this._osc(d, t + 0.09, 0.05, 'square', 900, 500, v * 0.12, 0.002);
    } else if (hold === 'launcher') {
      this._burst(d, t, 0.12, 'lowpass', 1200, 500, 0.8, v * 0.45, 0.01);
      this._osc(d, t + 0.1, 0.08, 'square', 600, 350, v * 0.15, 0.003);
    } else {
      // Gewehr: Ladegriff ziehen + zurueckschnappen + Gurt-Rascheln
      this._burst(d, t, 0.06, 'bandpass', 1800, 2600, 1.8, v * 0.3, 0.003);
      this._osc(d, t, 0.04, 'square', 1500, 800, v * 0.1, 0.002);
      this._burst(d, t + 0.12, 0.06, 'lowpass', 2200, 700, 0.8, v * 0.5, 0.002);
      this._osc(d, t + 0.12, 0.06, 'square', 1000, 450, v * 0.16, 0.002);
      this._burst(d, t + 0.02, 0.2, 'bandpass', 600, 400, 1.0, v * 0.08, 0.03);
    }
  }

  /** Einschlag in Geometrie */
  impact(pos, hard = true) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 65, 0.15);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.09, hard ? 'highpass' : 'bandpass', hard ? 2200 : 800, hard ? 2200 : 800, 1.0, 0.35 * out.gain, 0.003);
    if (hard) this._osc(out.node, t, 0.05, 'triangle', 900, 300, 0.12 * out.gain, 0.002);
  }

  /** Treffer am Koerper (fleischiger) */
  flesh(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 50, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.11, 'lowpass', 700, 700, 1.0, 0.45 * out.gain, 0.004);
    this._osc(out.node, t, 0.08, 'sine', 180, 60, 0.25 * out.gain, 0.003);
  }

  /** Nahkampf-Treffer: Fleisch + (Katana) Stahlklingeln */
  meleeHit(pos, kind, heavy) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 10, 55, 0.18);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain * (heavy ? 1.3 : 1);
    this._burst(out.node, t, 0.14, 'lowpass', 600, 400, 1.0, 0.7 * v, 0.003);
    this._osc(out.node, t, 0.12, 'sine', 160, 50, 0.4 * v, 0.003);
    this._burst(out.node, t, 0.05, 'bandpass', 1400, 900, 1.5, 0.3 * v, 0.002);
    if (kind === 'katana') {
      this._osc(out.node, t + 0.01, 0.35, 'sine', 3100, 2950, 0.14 * v, 0.003);
      this._burst(out.node, t, 0.2, 'bandpass', 3000, 6000, 3.0, 0.2 * v, 0.005);
    } else if (kind === 'knife') {
      this._burst(out.node, t, 0.08, 'bandpass', 2500, 5000, 2.5, 0.18 * v, 0.003);
    }
  }

  step(pos, loud = 1) {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 6, 42, 0.08);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.08, 'bandpass', rand(320, 620), rand(320, 620), 1.1, 0.32 * loud * out.gain, 0.005);
  }

  jump(pos) { this.click(pos, 480, 0.18, 0.07); }

  land(pos, hard) {
    if (!this.ready) return;
    const out = this._out(this.busSteps, pos, 8, 55, 0.1);
    if (!out) return;
    const t = this.ctx.currentTime;
    this._burst(out.node, t, 0.14, 'lowpass', hard ? 380 : 600, hard ? 380 : 600, 1.0, (hard ? 0.6 : 0.3) * out.gain, 0.006);
  }

  /** Nachladen: 0 = Magazin raus, 1 = Magazin rein, 2 = Verschluss */
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
    this._burst(out.node, t, 0.05, 'highpass', 2500, 2500, 0.5, v * 0.9, 0.001);
    this._burst(out.node, t, 0.9, 'lowpass', 4200, 180, 0.6, v * 1.1, 0.01);
    this._osc(out.node, t, 0.65, 'sine', 120, 24, v * 1.0, 0.012);
    this._burst(out.node, t + 0.1, 1.4, 'lowpass', 900, 200, 0.5, v * 0.35, 0.05);   // Grollen
  }

  /** Vorbeifliegendes Projektil */
  whizz(pos) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 4, 20, 0);
    if (!out) return;
    this._burst(out.node, this.ctx.currentTime, 0.13, 'bandpass', 3000, 900, 4, 0.3 * out.gain, 0.02);
  }

  /** Nahkampf-Schwung: kind = knife | katana | bash, heavy = schwerer Angriff */
  swing(pos, kind, heavy) {
    if (!this.ready) return;
    const out = this._out(this.busSfx, pos, 8, 40, 0.12);
    if (!out) return;
    const t = this.ctx.currentTime;
    const v = out.gain;
    if (kind === 'katana') {
      const dur = heavy ? 0.34 : 0.24;
      this._burst(out.node, t, dur, 'bandpass', heavy ? 380 : 520, heavy ? 2200 : 2800, 2.2, v * (heavy ? 0.5 : 0.4), 0.04);
      this._burst(out.node, t + 0.03, dur, 'highpass', 2500, 5000, 0.8, v * 0.12, 0.04);      // Klingenpfeifen
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
