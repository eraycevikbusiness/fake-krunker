// ============================================================
// Eingabe: Tastatur, Maus, Pointer-Lock, Vollbild + Keyboard-Lock
// Funktioniert in Chrome/Edge/Firefox/Safari auf Windows, Linux, macOS.
// ============================================================

// Tasten, deren Browser-Standardverhalten im Spiel stoert
const BLOCK_IN_GAME = new Set([
  'Space', 'Tab', 'F1', 'F3', 'F5', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'Slash', 'Quote', 'Backspace',
]);

// Tasten, die bei aktivem Vollbild per Keyboard-Lock-API abgefangen werden.
// Damit schliesst z.B. Strg+W (Ducken + Vorwaerts) nicht mehr den Tab.
const LOCK_KEYS = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyC', 'KeyR', 'KeyQ', 'KeyF', 'KeyG', 'KeyV', 'KeyP',
  'KeyT', 'KeyN', 'KeyE', 'KeyX', 'Tab', 'Space', 'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight',
  'AltLeft', 'AltRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
];

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = Object.create(null);       // gedrückt (dauerhaft)
    this.pressed = Object.create(null);    // in diesem Frame neu gedrückt
    this.mouse = [false, false, false];
    this.mousePressed = [false, false, false];
    this.mouseReleased = [false, false, false];
    this.dx = 0; this.dy = 0;
    this.wheel = 0;
    this.locked = false;
    this.virtualLock = false;              // Touch-Steuerung: kein Pointer-Lock noetig
    this.touchMove = null;                 // {x,y} vom Touch-Joystick
    this.enabled = true;
    this.gameActive = false;               // wird von main.js gesetzt: Spiel laeuft
    this._onLockChange = null;

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 1) e.preventDefault();      // mittlere Maustaste: Enterhaken, kein Autoscroll
      if (e.button < 3) { this.mouse[e.button] = true; this.mousePressed[e.button] = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button < 3) { this.mouse[e.button] = false; this.mouseReleased[e.button] = true; }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const mx = e.movementX || 0, my = e.movementY || 0;
      // Ausreisser (Treiber-Glitches beim Lock-Wechsel) verwerfen
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx;
      this.dy += my;
    });
    addEventListener('wheel', (e) => {
      if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      this._onLockChange && this._onLockChange(this.locked, false);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this._onLockChange && this._onLockChange(false, true);
    });

    document.addEventListener('fullscreenchange', () => this._syncKeyboardLock());
  }

  onLockChange(fn) { this._onLockChange = fn; }

  _key(e, down) {
    const code = e.code;
    // Waehrend der Eingabe in Textfeldern nichts abfangen
    const t = e.target;
    const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (!typing && (this.locked || this.gameActive) && BLOCK_IN_GAME.has(code)) e.preventDefault();
    if (e.repeat) return;
    if (typing && down) return;
    if (down && !this.keys[code]) this.pressed[code] = true;
    this.keys[code] = down;
  }

  releaseAll() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouse[0] = this.mouse[1] = this.mouse[2] = false;
  }

  requestLock() {
    if (this.locked) return;
    let p = null;
    try {
      p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    } catch (e) {
      // Aeltere Browser kennen die Options-Signatur nicht
      try { p = this.canvas.requestPointerLock(); } catch (e2) {}
    }
    // Chrome liefert ein Promise; Firefox/Safari nicht.
    if (p && typeof p.catch === 'function') {
      p.catch((err) => {
        // unadjustedMovement wird nicht ueberall unterstuetzt -> ohne erneut versuchen
        if (err && err.name === 'NotSupportedError') {
          try { this.canvas.requestPointerLock(); } catch (e) {}
        }
      });
    }
  }

  exitLock() { if (document.pointerLockElement) { try { document.exitPointerLock(); } catch (e) {} } }

  // ---------------- Vollbild ----------------
  get fullscreen() { return !!document.fullscreenElement; }

  toggleFullscreen() {
    if (this.fullscreen) {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    } else {
      const el = document.documentElement;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn) {
        try {
          const r = fn.call(el, { navigationUI: 'hide' });
          if (r && r.catch) r.catch(() => {});
        } catch (e) {}
      }
    }
  }

  _syncKeyboardLock() {
    const kb = navigator.keyboard;
    if (!kb || typeof kb.lock !== 'function') return;
    try {
      if (this.fullscreen) kb.lock(LOCK_KEYS).catch(() => {});
      else kb.unlock();
    } catch (e) {}
  }

  down(code)     { return !!this.keys[code] && this.enabled; }
  justDown(code) { return !!this.pressed[code] && this.enabled; }
  mouseDown(b)   { return this.mouse[b] && this.enabled; }
  mouseJust(b)   { return this.mousePressed[b] && this.enabled; }
  mouseUp(b)     { return this.mouseReleased[b] && this.enabled; }

  /** Am Ende jedes Frames aufrufen */
  endFrame() {
    for (const k in this.pressed) this.pressed[k] = false;
    this.mousePressed[0] = this.mousePressed[1] = this.mousePressed[2] = false;
    this.mouseReleased[0] = this.mouseReleased[1] = this.mouseReleased[2] = false;
    this.dx = 0; this.dy = 0; this.wheel = 0;
  }
}
