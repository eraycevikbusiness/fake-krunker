// ============================================================
// Touch-Steuerung (Handy/Tablet): linker Joystick = Laufen,
// rechte Haelfte = Umsehen (Ziehen), Buttons fuer Feuer, Springen,
// Ducken, Nachladen, Waffe, Zielen, Granate, E (Interaktion/Dash),
// X (Enterhaken), Pause. Schreibt direkt in das Input-Objekt.
// ============================================================

import { settings } from './settings.js';

const BUTTONS = [
  { id: 'fire', label: 'FEUER', cls: 'tb-fire', hold: true },
  { id: 'jump', label: 'SPRUNG', cls: 'tb-jump', key: 'Space', hold: true },
  { id: 'ads', label: 'ZIEL', cls: 'tb-ads', toggle: true },
  { id: 'reload', label: 'R', cls: 'tb-small tb-reload', key: 'KeyR' },
  { id: 'weapon', label: 'WAFFE', cls: 'tb-small tb-weapon' },
  { id: 'crouch', label: 'DUCKEN', cls: 'tb-small tb-crouch', key: 'KeyC', toggle: true },
  { id: 'nade', label: 'G', cls: 'tb-small tb-nade', key: 'KeyG' },
  { id: 'use', label: 'E', cls: 'tb-small tb-use', key: 'KeyE' },
  { id: 'hook', label: 'X', cls: 'tb-small tb-hook', key: 'KeyX' },
  { id: 'melee', label: 'F', cls: 'tb-small tb-melee', key: 'KeyF' },
  { id: 'pause', label: '≡', cls: 'tb-small tb-pause' },
];

export function wantsTouch() {
  const s = settings.touch || 'auto';
  if (s === 'on') return true;
  if (s === 'off') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || (('ontouchstart' in window) && navigator.maxTouchPoints > 0 && !window.matchMedia('(pointer: fine)').matches);
}

export class TouchControls {
  constructor(input, handlers) {
    this.input = input;
    this.h = handlers || {};
    this.enabled = false;
    this.move = { x: 0, y: 0 };
    this.lookId = null; this.lookX = 0; this.lookY = 0;
    this.stickId = null; this.stickX0 = 0; this.stickY0 = 0;
    this.adsOn = false; this.crouchOn = false;
    this._build();
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'touch-ui';
    root.className = 'hidden';
    root.innerHTML =
      `<div class="tz tz-left"><div class="stick"><div class="knob"></div></div></div>` +
      `<div class="tz tz-right"></div>` +
      `<div class="tbtns">${BUTTONS.map(b => `<div class="tb ${b.cls}" data-id="${b.id}">${b.label}</div>`).join('')}</div>`;
    document.body.appendChild(root);
    this.root = root;
    this.zoneL = root.querySelector('.tz-left');
    this.zoneR = root.querySelector('.tz-right');
    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.knob');
    const opts = { passive: false };

    // ---- Joystick ----
    this.zoneL.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      this.stickId = e.pointerId;
      const r = this.zoneL.getBoundingClientRect();
      this.stickX0 = e.clientX - r.left; this.stickY0 = e.clientY - r.top;
      this.stick.style.left = this.stickX0 + 'px'; this.stick.style.top = this.stickY0 + 'px';
      this.stick.classList.add('active');
      this.zoneL.setPointerCapture(e.pointerId);
      e.preventDefault();
    }, opts);
    this.zoneL.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickId) return;
      const r = this.zoneL.getBoundingClientRect();
      let dx = (e.clientX - r.left - this.stickX0) / 55, dy = (e.clientY - r.top - this.stickY0) / 55;
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.move.x = dx; this.move.y = -dy;
      this.knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      e.preventDefault();
    }, opts);
    const stickEnd = (e) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.move.x = 0; this.move.y = 0;
      this.knob.style.transform = '';
      this.stick.classList.remove('active');
    };
    this.zoneL.addEventListener('pointerup', stickEnd);
    this.zoneL.addEventListener('pointercancel', stickEnd);

    // ---- Umsehen ----
    this.zoneR.addEventListener('pointerdown', (e) => {
      if (this.lookId !== null) return;
      this.lookId = e.pointerId; this.lookX = e.clientX; this.lookY = e.clientY;
      this.zoneR.setPointerCapture(e.pointerId);
      e.preventDefault();
    }, opts);
    this.zoneR.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.lookId) return;
      const k = 2.4;
      this.input.dx += (e.clientX - this.lookX) * k;
      this.input.dy += (e.clientY - this.lookY) * k;
      this.lookX = e.clientX; this.lookY = e.clientY;
      e.preventDefault();
    }, opts);
    const lookEnd = (e) => { if (e.pointerId === this.lookId) this.lookId = null; };
    this.zoneR.addEventListener('pointerup', lookEnd);
    this.zoneR.addEventListener('pointercancel', lookEnd);

    // ---- Buttons ----
    root.querySelectorAll('.tb').forEach((el) => {
      const b = BUTTONS.find(x => x.id === el.dataset.id);
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this._press(b, el, true); }, opts);
      const up = (e) => { e.preventDefault(); this._press(b, el, false); };
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('pointerleave', up);
    });
  }

  _press(b, el, down) {
    const inp = this.input;
    if (b.id === 'fire') { inp.mouse[0] = down; if (down) inp.mousePressed[0] = true; else inp.mouseReleased[0] = true; el.classList.toggle('on', down); return; }
    if (b.id === 'pause') { if (down) this.h.onPause && this.h.onPause(); return; }
    if (b.id === 'weapon') { if (down) inp.wheel += 1; return; }
    if (b.id === 'ads') {
      if (!down) return;
      this.adsOn = !this.adsOn;
      inp.mouse[2] = this.adsOn; if (this.adsOn) inp.mousePressed[2] = true; else inp.mouseReleased[2] = true;
      el.classList.toggle('on', this.adsOn);
      return;
    }
    if (b.toggle) {
      if (!down) return;
      this.crouchOn = !this.crouchOn;
      inp.keys[b.key] = this.crouchOn; if (this.crouchOn) inp.pressed[b.key] = true;
      el.classList.toggle('on', this.crouchOn);
      return;
    }
    if (down) { if (!inp.keys[b.key]) inp.pressed[b.key] = true; inp.keys[b.key] = true; el.classList.add('on'); }
    else { inp.keys[b.key] = false; el.classList.remove('on'); }
  }

  enable(v) {
    this.enabled = !!v;
    this.root.classList.toggle('hidden', !v);
    this.input.virtualLock = !!v;
    this.input.touchMove = v ? this.move : null;
    if (!v) { this.move.x = this.move.y = 0; }
  }

  /** Waehrend Menues ausblenden, im Spiel zeigen */
  setVisible(v) { if (this.enabled) this.root.classList.toggle('hidden', !v); }
}
