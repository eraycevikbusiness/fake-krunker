// ============================================================
// Eingabe: Tastatur, Maus, Pointer-Lock
// ============================================================

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
    this.enabled = true;
    this._onLockChange = null;

    addEventListener('keydown', (e) => this._key(e, true));
    addEventListener('keyup', (e) => this._key(e, false));
    addEventListener('blur', () => this.releaseAll());

    canvas.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button < 3) { this.mouse[e.button] = true; this.mousePressed[e.button] = true; }
    });
    addEventListener('mouseup', (e) => {
      if (e.button < 3) { this.mouse[e.button] = false; this.mouseReleased[e.button] = true; }
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    addEventListener('wheel', (e) => {
      if (this.locked) { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.releaseAll();
      this._onLockChange && this._onLockChange(this.locked);
    });
    document.addEventListener('pointerlockerror', () => {
      this.locked = false;
      this._onLockChange && this._onLockChange(false);
    });
  }

  onLockChange(fn) { this._onLockChange = fn; }

  _key(e, down) {
    const code = e.code;
    // Browser-Defaults abfangen, die im Spiel stören
    if (['Space', 'Tab', 'F1', 'F3', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'Digit1','Digit2','Digit3','Digit4','Digit5','Digit6','Digit7','Digit8','Digit9'].includes(code)) {
      if (this.locked || code === 'Tab') e.preventDefault();
    }
    if (e.repeat) return;
    if (down && !this.keys[code]) this.pressed[code] = true;
    this.keys[code] = down;
  }

  releaseAll() {
    for (const k in this.keys) this.keys[k] = false;
    this.mouse[0] = this.mouse[1] = this.mouse[2] = false;
  }

  requestLock() {
    if (this.locked) return;
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    // Chrome liefert ein Promise; Firefox/Safari nicht.
    if (p && typeof p.catch === 'function') {
      p.catch(() => { try { this.canvas.requestPointerLock(); } catch (e) {} });
    }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

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
