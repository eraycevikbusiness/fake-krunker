// ============================================================
// Actor: gemeinsame Basis fuer Spieler und Bots
// Bewegung: Quake-/Source-artig mit endlicher Beschleunigung, sauberer
// Reibung, Air-Strafe mit Soft-Cap, Jump-Buffer + Coyote-Time,
// Auto-Bunnyhop, Slide mit Cooldown, Boden-Snapping auf Treppen.
// Trefferzonen: an der Blickrichtung ausgerichtete Boxen (OBB),
// die exakt zum Charaktermodell passen.
// ============================================================

import { clamp, damp } from '../core/utils.js';
import { WEAPONS, CLASS_BY_ID, fireDelay } from './weapons.js';
import { CHAR } from './character.js';

export const PHYS = {
  HEIGHT: CHAR.HEIGHT,          // 2.4
  CROUCH_HEIGHT: 1.55,
  EYE: 2.08,
  CROUCH_EYE: 1.28,
  RADIUS: 0.55,
  STEP: 1.16,                   // maximale Stufenhoehe
  SNAP_DOWN: 0.9,               // Boden-Snapping beim Treppen-Abwaertsgehen

  BASE_SPEED: 11.6,
  CROUCH_MULT: 0.5,
  SPRINT_MULT: 1.28,
  BACK_MULT: 0.85,

  GROUND_ACCEL: 11,             // volle Geschwindigkeit nach ~0.1 s
  FRICTION: 7.2,
  STOP_SPEED: 3.5,

  AIR_ACCEL: 12,
  AIR_WISH_CAP: 2.6,            // ermoeglicht Air-Strafe-Beschleunigung
  AIR_CONTROL: 7,               // Lenkung in der Luft mit nur W/S (CPM-Stil)
  BHOP_SOFTCAP: 1.6,            // x Grundtempo, darueber bremst Luftwiderstand

  GRAVITY: 40,
  JUMP_VEL: 13.2,
  DOUBLE_JUMP_VEL: 11.8,
  MAX_FALL: 60,
  JUMP_BUFFER: 0.12,            // Sprung kurz vor der Landung wird gemerkt
  COYOTE: 0.08,                 // Sprung kurz nach dem Kantenverlassen erlaubt

  SLIDE_BOOST: 3.0,
  SLIDE_TIME: 0.8,
  SLIDE_FRICTION: 2.4,
  SLIDE_MIN_SPEED: 9.0,
  SLIDE_COOLDOWN: 0.7,
  SLIDE_MAX: 1.5,               // x Grundtempo

  FALL_DMG_START: 24,           // Fallgeschwindigkeit ab der Schaden entsteht
  FALL_DMG_SCALE: 3.0,

  CROUCH_RATE: 10,
  STAND_RATE: 8,

  DASH_SPEED: 27,               // Klassen-Perk: kurzer Sprint-Stoss (Taste E)
  DASH_TIME: 0.20,
  DASH_COOLDOWN: 2.4,

  WALLRUN_TIME: 1.3,            // Klassen-Perk: an der Wand entlanglaufen
  WALLRUN_MIN_SPEED: 5.5,
  WALLRUN_GRAVITY: 0.22,        // Anteil der Schwerkraft waehrend des Wandlaufs
  WALLJUMP_OUT: 8.5,
};

// Trefferzonen im lokalen Raum (x rechts, y hoch, -z vorn), volle Hoehe.
// Zahlen entsprechen dem Blockmodell in character.js.
export const HITBOX = [
  { zone: 'head', x0: -0.32, x1: 0.32, y0: 1.80, y1: 2.42, z0: -0.32, z1: 0.32 },
  { zone: 'body', x0: -0.46, x1: 0.46, y0: 0.92, y1: 1.82, z0: -0.26, z1: 0.26 },
  { zone: 'body', x0: 0.40, x1: 0.68, y0: 1.48, y1: 1.84, z0: -0.82, z1: 0.10 },   // rechter Arm (haelt Waffe)
  { zone: 'body', x0: -0.68, x1: -0.40, y0: 1.48, y1: 1.84, z0: -0.82, z1: 0.10 }, // linker Arm
  { zone: 'legs', x0: -0.38, x1: 0.38, y0: 0.00, y1: 0.92, z0: -0.26, z1: 0.26 },
];

let NEXT_ID = 1;

export class Actor {
  constructor(game, opts) {
    this.game = game;
    this.id = NEXT_ID++;
    this.name = opts.name || 'Player';
    this.team = opts.team || 'red';
    this.isBot = !!opts.isBot;
    this.isLocal = !!opts.isLocal;

    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.yaw = 0;
    this.pitch = 0;

    this.grounded = false;
    this.wasGrounded = false;
    this.crouching = false;
    this.sliding = false;
    this.slideT = 0;
    this.slideCooldown = 0;
    this.jumpsLeft = 1;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.sinceJump = 10;
    this.height = PHYS.HEIGHT;
    this.radius = PHYS.RADIUS;
    this.landImpact = 0;
    this.stepDist = 0;
    this.airTime = 0;
    this.surface = 'stone';

    // Klassen-Perks: Dash und Wandlauf
    this.canDash = false;
    this.canWallrun = false;
    this.dashT = 0;
    this.dashCooldown = 0;
    this.wallrun = null;          // { nx, nz } Wandnormale waehrend des Wandlaufs
    this.wallrunT = 0;
    this.wallrunCooldown = 0;

    this.alive = false;
    this.hp = 100;
    this.maxHp = 100;
    this.armor = 0;
    this.maxArmor = 0;
    this.respawnTimer = 0;
    this.spawnProtect = 0;
    this.lastDamageFrom = null;
    this.lastDamageTime = -99;
    this.lastLoudTime = -99;

    this.kills = 0;
    this.deaths = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.damageDealt = 0;
    this.ping = 12 + ((Math.random() * 60) | 0);

    // Waffen
    this.slots = [];
    this.slot = 0;
    this.lastSlot = 1;
    this.nades = 0;
    this.maxNades = 2;

    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.reloadTotal = 0;
    this.switchTimer = 0;
    this.burstLeft = 0;
    this.burstTimer = 0;
    this.spread = 0;
    this.triggerHeld = false;
    this.altHeld = false;
    this.ads = false;
    this.adsAmount = 0;
    this.nadeCooldown = 0;

    this.intent = {
      fwd: 0, side: 0, jump: false, jumpPressed: false, autoJump: false,
      crouch: false, sprint: false, fire: false, ads: false,
      reload: false, nade: false, melee: false, switchTo: -1,
      dash: false, inspect: false,
    };

    this.model = null;
    this._hit = { t: 0, zone: 'body' };
    this.setClass(opts.classId || 'triggerman');
  }

  // --------------------------------------------------------
  setClass(classId) {
    const cls = CLASS_BY_ID[classId] || CLASS_BY_ID.triggerman;
    this.classDef = cls;
    this.maxHp = cls.hp;
    this.maxArmor = cls.armor;
    this.maxNades = cls.nades;
    this.speedMult = cls.speed;
    this.maxJumps = cls.jumps;
    this.canDash = !!cls.dash;
    this.canWallrun = !!cls.wallrun;
    this.slots = [
      this._mkSlot(WEAPONS[cls.primary]),
      this._mkSlot(WEAPONS[cls.secondary]),
      this._mkSlot(WEAPONS[cls.melee]),
    ];
    this.slot = 0;
    this.lastSlot = 1;
  }

  _mkSlot(w) {
    return { w, mag: w.mag === Infinity ? Infinity : w.mag, reserve: w.reserve, pendingSingle: 0 };
  }

  get weapon() { return this.slots[this.slot].w; }
  get ammo() { return this.slots[this.slot]; }

  // --------------------------------------------------------
  spawn(point) {
    this.pos.x = point.x; this.pos.y = point.y; this.pos.z = point.z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = point.yaw || 0;
    this.pitch = 0;
    this.alive = true;
    this.hp = this.maxHp;
    this.armor = this.maxArmor;
    this.crouching = false;
    this.sliding = false;
    this.slideT = 0;
    this.slideCooldown = 0;
    this.jumpBuffer = 0;
    this.coyote = 0;
    this.sinceJump = 10;
    this.height = PHYS.HEIGHT;
    this.jumpsLeft = this.maxJumps;
    this.grounded = false;
    this.wasGrounded = false;
    this.airTime = 0;
    this.landImpact = 0;
    this.dashT = 0;
    this.dashCooldown = 0;
    this.wallrun = null;
    this.wallrunT = 0;
    this.wallrunCooldown = 0;
    this.spawnProtect = 1.4;
    this.nades = this.maxNades;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.switchTimer = 0;
    this.burstLeft = 0;
    this.spread = 0;
    this.ads = false;
    this.adsAmount = 0;
    this.triggerHeld = false;
    this.altHeld = false;
    this.nadeCooldown = 0;
    this.slot = 0;
    this.lastSlot = 1;
    for (const s of this.slots) {
      s.mag = s.w.mag === Infinity ? Infinity : s.w.mag;
      s.reserve = s.w.reserve;
      s.pendingSingle = 0;
    }
    const it = this.intent;
    it.fire = it.reload = it.nade = it.melee = it.jumpPressed = it.dash = it.inspect = false;
    it.switchTo = -1;
    if (this.model) this.model.resetDeath();
  }

  // --------------------------------------------------------
  eyeHeight() {
    const t = clamp((PHYS.HEIGHT - this.height) / (PHYS.HEIGHT - PHYS.CROUCH_HEIGHT), 0, 1);
    return PHYS.EYE + (PHYS.CROUCH_EYE - PHYS.EYE) * t;
  }

  eyePos(out) {
    out.x = this.pos.x;
    out.y = this.pos.y + this.eyeHeight();
    out.z = this.pos.z;
    return out;
  }

  /** Blickrichtung als Einheitsvektor */
  lookDir(out) {
    const cp = Math.cos(this.pitch);
    out.x = -Math.sin(this.yaw) * cp;
    out.y = Math.sin(this.pitch);
    out.z = -Math.cos(this.yaw) * cp;
    return out;
  }

  /** Grobe Kugel fuer Vorabtests */
  boundsCenter(out) {
    out.x = this.pos.x;
    out.y = this.pos.y + this.height * 0.5;
    out.z = this.pos.z;
    return out;
  }
  get boundsRadius() { return this.height * 0.62 + 0.2; }

  /**
   * Strahl gegen die orientierten Trefferzonen.
   * Rueckgabe: null oder {t, zone} (Objekt wird wiederverwendet -> sofort kopieren).
   * pad = zusaetzlicher Radius (z.B. Projektilgroesse)
   */
  rayHit(ox, oy, oz, dx, dy, dz, maxT, pad) {
    // Grobtest: Kugel um die Koerpermitte
    const cy = this.pos.y + this.height * 0.5;
    const R = this.boundsRadius + (pad || 0);
    const mx = this.pos.x - ox, my = cy - oy, mz = this.pos.z - oz;
    const proj = mx * dx + my * dy + mz * dz;
    if (proj < -R || proj > maxT + R) return null;
    const px = mx - dx * proj, py = my - dy * proj, pz = mz - dz * proj;
    if (px * px + py * py + pz * pz > R * R) return null;

    // In den lokalen Raum (um -yaw drehen)
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const wx = ox - this.pos.x, wy = oy - this.pos.y, wz = oz - this.pos.z;
    const lox = wx * c - wz * s, loy = wy, loz = wx * s + wz * c;
    const ldx = dx * c - dz * s, ldy = dy, ldz = dx * s + dz * c;
    const invx = ldx !== 0 ? 1 / ldx : 1e30;
    const invy = ldy !== 0 ? 1 / ldy : 1e30;
    const invz = ldz !== 0 ? 1 / ldz : 1e30;
    const sc = this.height / PHYS.HEIGHT;
    const p = pad || 0;

    let bestT = maxT, bestZone = null;
    for (let i = 0; i < HITBOX.length; i++) {
      const b = HITBOX[i];
      let tmin = 0, tmax = bestT;
      let t1 = (b.x0 - p - lox) * invx, t2 = (b.x1 + p - lox) * invx;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      t1 = (b.y0 * sc - p - loy) * invy; t2 = (b.y1 * sc + p - loy) * invy;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      t1 = (b.z0 - p - loz) * invz; t2 = (b.z1 + p - loz) * invz;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) continue;
      if (tmin < bestT) { bestT = tmin; bestZone = b.zone; }
    }
    if (bestZone === null) return null;
    this._hit.t = bestT;
    this._hit.zone = bestZone;
    return this._hit;
  }

  // --------------------------------------------------------
  // Physik
  // --------------------------------------------------------
  updatePhysics(dt, world) {
    const P = PHYS;
    const it = this.intent;
    const w = this.weapon;
    const baseSpeed = P.BASE_SPEED * this.speedMult;

    if (this.slideCooldown > 0) this.slideCooldown -= dt;
    if (this.jumpBuffer > 0) this.jumpBuffer -= dt;
    if (this.coyote > 0) this.coyote -= dt;
    if (this.sinceJump < 10) this.sinceJump += dt;
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.dashT > 0) this.dashT -= dt;
    if (this.wallrunCooldown > 0) this.wallrunCooldown -= dt;
    if (it.jumpPressed) { this.jumpBuffer = P.JUMP_BUFFER; it.jumpPressed = false; }

    let speed2 = Math.hypot(this.vel.x, this.vel.z);

    // ---- Ducken / Slide ----
    const wantCrouch = it.crouch;
    if (wantCrouch && !this.crouching && !this.sliding && this.grounded &&
        this.slideCooldown <= 0 && speed2 > P.SLIDE_MIN_SPEED * this.speedMult && it.fwd > 0.1) {
      this.sliding = true;
      this.slideT = P.SLIDE_TIME;
      const target = Math.min(speed2 + P.SLIDE_BOOST, baseSpeed * P.SLIDE_MAX);
      const k = target / Math.max(0.001, speed2);
      this.vel.x *= k; this.vel.z *= k;
      speed2 = target;
      this.game.onSlide && this.game.onSlide(this);
    }
    if (this.sliding) {
      this.slideT -= dt;
      if (!wantCrouch || this.slideT <= 0 || !this.grounded || speed2 < 4) {
        this.sliding = false;
        this.slideCooldown = P.SLIDE_COOLDOWN;
      }
    }

    this.crouching = wantCrouch || this.sliding;
    const targetH = this.crouching ? P.CROUCH_HEIGHT : P.HEIGHT;
    if (targetH > this.height) {
      // Nur aufstehen, wenn Platz ist
      if (world.isFree(this.pos.x, this.pos.y, this.pos.z, this.radius, targetH)) {
        this.height = Math.min(targetH, this.height + dt * P.STAND_RATE);
      } else {
        this.crouching = true;
      }
    } else if (targetH < this.height) {
      this.height = Math.max(targetH, this.height - dt * P.CROUCH_RATE);
    }

    // ---- Wunschrichtung ----
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * it.fwd + cos * it.side;
    let wz = -cos * it.fwd - sin * it.side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.0001) { wx /= wl; wz /= wl; }

    // ---- Maximalgeschwindigkeit ----
    let maxSpeed = baseSpeed * (w.moveMult || 1);
    if (this.adsAmount > 0.05) {
      maxSpeed *= 1 - this.adsAmount * (1 - (w.adsMoveMult || 0.45));
    }
    const sprinting = it.sprint && it.fwd > 0.2 && !this.ads && !this.crouching;
    if (this.crouching && !this.sliding) maxSpeed *= P.CROUCH_MULT;
    else if (sprinting) maxSpeed *= P.SPRINT_MULT;
    if (it.fwd < -0.2) maxSpeed *= P.BACK_MULT;
    this.sprinting = sprinting;
    const wishSpeed = wl > 0.0001 ? maxSpeed * Math.min(1, wl) : 0;

    // ---- Dash (Klassen-Perk): kurzer Stoss in Wunschrichtung, auch in der Luft ----
    if (it.dash) {
      it.dash = false;
      if (this.canDash && this.dashCooldown <= 0 && !this.sliding) {
        let dx = wx, dz = wz;
        if (wl < 0.001) { dx = -sin; dz = -cos; }
        this.vel.x = dx * P.DASH_SPEED;
        this.vel.z = dz * P.DASH_SPEED;
        if (!this.grounded) this.vel.y = Math.max(this.vel.y, 0);
        this.dashT = P.DASH_TIME;
        this.dashCooldown = P.DASH_COOLDOWN;
        this.wallrun = null;
        this.game.onDash && this.game.onDash(this);
      }
    }
    const dashing = this.dashT > 0;

    // ---- Springen (vor der Reibung, damit Bunny-Hop keine Geschwindigkeit verliert) ----
    let didJump = false;
    const wantJump = this.jumpBuffer > 0 || (it.jump && it.autoJump);
    if (this.wallrun && this.jumpBuffer > 0) {
      // Wandsprung: von der Wand weg und nach oben, Doppelsprung bleibt erhalten
      const wr = this.wallrun;
      this.vel.x += wr.nx * P.WALLJUMP_OUT;
      this.vel.z += wr.nz * P.WALLJUMP_OUT;
      this.vel.y = P.JUMP_VEL * 0.95;
      this.wallrun = null;
      this.wallrunCooldown = 0.35;
      this.jumpBuffer = 0;
      this.sinceJump = 0;
      didJump = true;
      this.game.onJump && this.game.onJump(this);
    } else if (wantJump && (this.grounded || this.coyote > 0)) {
      this.vel.y = P.JUMP_VEL;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuffer = 0;
      this.sinceJump = 0;
      this.jumpsLeft = this.maxJumps - 1;
      if (this.sliding) { this.sliding = false; this.slideCooldown = P.SLIDE_COOLDOWN; }
      didJump = true;
      this.game.onJump && this.game.onJump(this);
    } else if (this.jumpBuffer > 0 && !this.grounded && this.jumpsLeft > 0 && this.sinceJump > 0.16) {
      // Doppel-/Dreifachsprung: nur bei frischem Tastendruck
      this.jumpBuffer = 0;
      this.jumpsLeft--;
      this.sinceJump = 0;
      this.vel.y = P.DOUBLE_JUMP_VEL;
      // Doppelsprung lenkt die Bewegung in Wunschrichtung
      if (wl > 0.001) {
        const cur = Math.hypot(this.vel.x, this.vel.z);
        const keep = Math.max(cur * 0.7, 7);
        this.vel.x = wx * keep;
        this.vel.z = wz * keep;
      }
      this.game.onDoubleJump && this.game.onDoubleJump(this);
    }

    // ---- Reibung / Beschleunigung ----
    if (dashing) {
      // Waehrend des Dashs: keine Reibung, keine Lenkung, Schwerkraft reduziert
    } else if (this.wallrun) {
      // Wandlauf: Tempo entlang der Wand halten, leicht an die Wand druecken
      const wr = this.wallrun;
      this._accelerate(wx, wz, Math.min(wishSpeed, P.AIR_WISH_CAP), P.AIR_ACCEL * 0.6, dt);
      this.vel.x += -wr.nx * 1.5;
      this.vel.z += -wr.nz * 1.5;
    } else if (this.grounded && !didJump) {
      const fr = this.sliding ? P.SLIDE_FRICTION : P.FRICTION;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.001) {
        const control = Math.max(sp, P.STOP_SPEED);
        const drop = control * fr * dt;
        const ns = Math.max(0, sp - drop) / sp;
        this.vel.x *= ns;
        this.vel.z *= ns;
      }
      if (!this.sliding) this._accelerate(wx, wz, wishSpeed, P.GROUND_ACCEL, dt);
      else this._accelerate(wx, wz, wishSpeed * 0.35, P.GROUND_ACCEL * 0.2, dt);
    } else {
      // Luft: begrenzte Wunschgeschwindigkeit -> Air-Strafe funktioniert
      this._accelerate(wx, wz, Math.min(wishSpeed, P.AIR_WISH_CAP), P.AIR_ACCEL, dt);
      // Luftkontrolle: mit nur W/S laesst sich die Flugbahn sanft lenken
      if (wl > 0.001 && it.side === 0 && it.fwd !== 0) {
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > 0.5) {
          const dot = (this.vel.x * wx + this.vel.z * wz) / sp;
          if (dot > 0) {
            const k = P.AIR_CONTROL * dot * dot * dt;
            let nx = this.vel.x + wx * k * sp, nz = this.vel.z + wz * k * sp;
            const nl = Math.hypot(nx, nz) || 1;
            this.vel.x = nx / nl * sp; this.vel.z = nz / nl * sp;
          }
        }
      }
      // Soft-Cap fuer Bunny-Hop
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const cap = baseSpeed * P.BHOP_SOFTCAP;
      if (sp > cap) {
        const k = 1 - Math.min(1, (sp - cap) / sp * 3 * dt);
        this.vel.x *= k; this.vel.z *= k;
      }
    }

    // ---- Schwerkraft ----
    if (this.wallrun) {
      this.vel.y -= P.GRAVITY * P.WALLRUN_GRAVITY * dt;
      if (this.vel.y < -3) this.vel.y = -3;
    } else {
      this.vel.y -= P.GRAVITY * (dashing ? 0.3 : 1) * dt;
    }
    if (this.vel.y < -P.MAX_FALL) this.vel.y = -P.MAX_FALL;

    // ---- Bewegen + Kollision ----
    this.wasGrounded = this.grounded;
    const before = this.vel.y;
    const preVx = this.vel.x, preVz = this.vel.z;
    const res = world.moveActor(
      this.pos, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt,
      this.radius, this.height, (this.grounded || this.vel.y <= 0) ? P.STEP : 0
    );

    if (res.wallX) this.vel.x = 0;
    if (res.wallZ) this.vel.z = 0;
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;
    if (res.stepped > 0.02 && this.onStep) this.onStep(res.stepped);

    let grounded = res.ground;

    // ---- Wandlauf: Start / Ende ----
    if (this.wallrun) {
      const wr = this.wallrun;
      this.wallrunT += dt;
      const tangential = Math.hypot(this.vel.x, this.vel.z);
      const wallStillThere = !world.isFree(
        this.pos.x - wr.nx * (this.radius + 0.22), this.pos.y + 0.4, this.pos.z - wr.nz * (this.radius + 0.22),
        this.radius * 0.5, this.height * 0.5);
      const pushingAway = wl > 0.001 && (wx * wr.nx + wz * wr.nz) > 0.7;
      const reason = grounded ? 'ground' : !wallStillThere ? 'nowall' : this.wallrunT > P.WALLRUN_TIME ? 'time'
        : tangential < P.WALLRUN_MIN_SPEED * 0.6 ? 'slow' : pushingAway ? 'away' : null;
      if (reason) {
        this.wallrun = null;
        this.wallrunEnd = reason;
        this.wallrunCooldown = 0.3;
      }
    } else if (this.canWallrun && !grounded && !dashing && this.wallrunCooldown <= 0 && (res.wallX || res.wallZ) &&
               this.vel.y < 9 && this.sinceJump > 0.08) {
      let nx = 0, nz = 0;
      if (res.wallX && Math.abs(preVx) > 0.5) nx = -Math.sign(preVx);
      else if (res.wallZ && Math.abs(preVz) > 0.5) nz = -Math.sign(preVz);
      const tangential = Math.hypot(this.vel.x, this.vel.z);
      if ((nx !== 0 || nz !== 0) && tangential > P.WALLRUN_MIN_SPEED) {
        this.wallrun = { nx, nz };
        this.wallrunT = 0;
        this.vel.y = Math.max(this.vel.y, 3.2);
        this.game.onWallrunStart && this.game.onWallrunStart(this);
      }
    }

    // Boden-Snapping: beim Abwaertsgehen auf Treppen/Rampen nicht abheben
    if (!grounded && this.wasGrounded && !didJump && this.vel.y <= 0.01 && this.sinceJump > 0.1) {
      const h = world.raycast(this.pos.x, this.pos.y + 0.05, this.pos.z, 0, -1, 0, P.SNAP_DOWN + 0.05);
      if (h && world.isFree(this.pos.x, h.y + 0.01, this.pos.z, this.radius, this.height)) {
        const drop = this.pos.y - h.y;
        this.pos.y = h.y + 0.0001;
        grounded = true;
        this.vel.y = 0;
        if (drop > 0.02 && this.onStep) this.onStep(-drop);
      }
    }

    this.grounded = grounded;
    if (this.grounded) {
      if (this.vel.y < 0) this.vel.y = 0;
      this.coyote = P.COYOTE;
      if (!this.wasGrounded) {
        // Landung
        const impact = Math.abs(before);
        this.landImpact = clamp(impact / 26, 0, 1);
        this.jumpsLeft = this.maxJumps;
        this.airTime = 0;
        this.surface = world.surfaceAt(this.pos.x, this.pos.y, this.pos.z, this.radius * 0.8);
        this.game.onLand && this.game.onLand(this, impact, this.surface);
        if (this.onLanded) this.onLanded(impact);
        if (impact > P.FALL_DMG_START) {
          const dmg = (impact - P.FALL_DMG_START) * P.FALL_DMG_SCALE;
          if (dmg > 1) this.game.damageActor(this, null, dmg, 'fall', null);
        }
      }
    } else {
      this.airTime += dt;
    }

    // ---- Sprungpads ----
    const pads = this.game.jumpPads;
    if (pads && this.grounded) {
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        const dx = this.pos.x - p.x, dz = this.pos.z - p.z;
        if (dx * dx + dz * dz < p.r * p.r && Math.abs(this.pos.y - (p.y || 0)) < 1.5) {
          this.vel.y = p.power;
          this.grounded = false;
          this.coyote = 0;
          this.sinceJump = 0;
          this.jumpsLeft = this.maxJumps;
          this.game.onJumpPad && this.game.onJumpPad(this, p);
          break;
        }
      }
    }

    // ---- Ausserhalb der Karte? ----
    if (this.pos.y < -30) this.game.damageActor(this, null, 9999, 'void', null);

    // ---- Schrittgeraeusche (nach Untergrund) ----
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if ((this.grounded || this.wallrun) && hs > 1.5 && !this.sliding) {
      this.stepDist += hs * dt;
      const interval = this.crouching ? 3.2 : (this.wallrun ? 1.9 : 2.35);
      if (this.stepDist > interval) {
        this.stepDist = 0;
        if (this.wallrun) {
          const wr = this.wallrun;
          this.surface = world.surfaceAt(this.pos.x - wr.nx * (this.radius + 0.25), this.pos.y + 0.8, this.pos.z - wr.nz * (this.radius + 0.25), 0.3);
        } else {
          this.surface = world.surfaceAt(this.pos.x, this.pos.y, this.pos.z, this.radius * 0.8);
        }
        this.game.onFootstep && this.game.onFootstep(this, hs, this.surface);
      }
    } else if (!this.grounded && !this.wallrun) {
      this.stepDist = 1.6;
    }

    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    this.landImpact = damp(this.landImpact, 0, 8, dt);
  }

  _accelerate(wx, wz, wishSpeed, accel, dt) {
    if (wishSpeed <= 0) return;
    const cur = this.vel.x * wx + this.vel.z * wz;
    const add = wishSpeed - cur;
    if (add <= 0) return;
    let a = accel * wishSpeed * dt;
    if (a > add) a = add;
    this.vel.x += wx * a;
    this.vel.z += wz * a;
  }

  // --------------------------------------------------------
  // Waffen-Zustandsautomat
  // --------------------------------------------------------
  updateWeapons(dt) {
    const it = this.intent;
    const s = this.ammo;
    const w = this.weapon;

    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (this.switchTimer > 0) this.switchTimer -= dt;
    if (this.nadeCooldown > 0) this.nadeCooldown -= dt;

    // ADS
    const canAds = !w.melee && !this.sliding;
    this.ads = canAds && it.ads && this.reloadTimer <= 0 && this.switchTimer <= 0;
    const adsRate = dt / Math.max(0.05, w.adsTime);
    this.adsAmount = clamp(this.adsAmount + (this.ads ? adsRate : -adsRate), 0, 1);

    // Waffenwechsel
    if (it.switchTo >= 0 && it.switchTo !== this.slot && it.switchTo < this.slots.length) {
      this.lastSlot = this.slot;
      this.slot = it.switchTo;
      this.switchTimer = this.slots[this.slot].w.switchTime;
      this.reloadTimer = 0;
      this.burstLeft = 0;
      this.spread = 0;
      this.adsAmount = 0;
      this.triggerHeld = true;      // kein Sofortschuss nach dem Wechsel
      this.game.onWeaponSwitch && this.game.onWeaponSwitch(this);
      it.switchTo = -1;
      return;
    }
    it.switchTo = -1;

    // Granate (Anforderung wird immer verbraucht, damit sie nicht "haengen bleibt")
    if (it.nade) {
      it.nade = false;
      if (this.nades > 0 && this.nadeCooldown <= 0 && this.switchTimer <= 0) {
        this.nades--;
        this.nadeCooldown = 0.85;
        this.game.throwGrenade(this);
      }
    }

    // Schwerer Nahkampfangriff mit Rechtsklick (Messer: Stich, Katana: Ueberkopfhieb)
    if (w.melee && w.heavy) {
      if (it.ads && !this.altHeld && this.fireTimer <= 0 && this.switchTimer <= 0) {
        this.fireTimer = w.heavy.swingTime;
        this.triggerHeld = true;
        this.game.fireWeapon(this, true);
      }
      this.altHeld = it.ads;
    }

    // Nahkampf-Schlag mit F (unabhaengig von der Waffe)
    if (it.melee) {
      it.melee = false;
      if (this.fireTimer <= 0 && this.switchTimer <= 0) {
        this.fireTimer = 0.55;
        this.reloadTimer = 0;
        this.game.quickMelee(this);
      }
    }

    // Nachladen
    if (this.reloadTimer > 0) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this._finishReload();
      else if (w.reloadType === 'single' && it.fire && s.mag > 0) {
        // Nachladen abbrechen und schiessen
        this.reloadTimer = 0;
        this.game.onReloadCancel && this.game.onReloadCancel(this);
      } else {
        this.triggerHeld = it.fire;
        return;
      }
    }

    if (this.switchTimer > 0) { this.triggerHeld = it.fire; return; }

    // Nachladen anstossen
    const needReload = s.mag !== Infinity && s.mag <= 0;
    if ((it.reload || (needReload && this.game.autoReloadFor(this))) &&
        s.mag !== Infinity && s.mag < w.mag && s.reserve > 0) {
      it.reload = false;
      this._startReload();
      return;
    }
    it.reload = false;

    // Feuern
    const auto = w.auto;
    let triggered = false;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) triggered = true;
    } else if (it.fire) {
      if (auto) triggered = this.fireTimer <= 0;
      else if (!this.triggerHeld) triggered = this.fireTimer <= 0;
    }

    if (triggered) {
      if (s.mag !== Infinity && s.mag <= 0) {
        if (!this.triggerHeld) this.game.onDryFire && this.game.onDryFire(this);
        this.burstLeft = 0;
      } else {
        this._doFire();
      }
    }

    this.triggerHeld = it.fire;

    // Streuung erholt sich
    const rec = w.spreadRecover;
    this.spread = Math.max(0, this.spread - rec * dt * 5);
  }

  _doFire() {
    const w = this.weapon;
    const s = this.ammo;

    if (w.burst > 0 && this.burstLeft <= 0) this.burstLeft = w.burst;

    if (s.mag !== Infinity) s.mag--;
    // Restzeit des letzten Intervalls mitnehmen -> exakte Feuerrate
    // unabhaengig von der Bildrate (kein Zittern im Rhythmus)
    const carry = (this.fireTimer < 0 && this.fireTimer > -0.05) ? this.fireTimer : 0;
    this.fireTimer = fireDelay(w) + carry;

    if (this.burstLeft > 0) {
      this.burstLeft--;
      this.burstTimer = w.burstDelay;
      if (this.burstLeft > 0) this.fireTimer = w.burstDelay;
    }

    this.spread = Math.min(w.spreadMax, this.spread + w.spreadPerShot);
    this.game.fireWeapon(this);
  }

  _startReload() {
    const w = this.weapon;
    const s = this.ammo;
    if (s.reserve <= 0 || s.mag >= w.mag) return;
    this.reloadTotal = w.reloadTime;
    this.reloadTimer = w.reloadTime;
    this.adsAmount = 0;
    this.game.onReloadStart && this.game.onReloadStart(this);
  }

  _finishReload() {
    const w = this.weapon;
    const s = this.ammo;
    if (w.reloadType === 'single') {
      if (s.mag < w.mag && s.reserve > 0) { s.mag++; s.reserve--; }
      this.game.onReloadTick && this.game.onReloadTick(this);
      if (s.mag < w.mag && s.reserve > 0) {
        this.reloadTimer = w.reloadTime;
        this.reloadTotal = w.reloadTime;
        return;
      }
    } else {
      const need = w.mag - s.mag;
      const take = Math.min(need, s.reserve);
      s.mag += take;
      s.reserve -= take;
      this.game.onReloadEnd && this.game.onReloadEnd(this);
    }
    this.reloadTimer = 0;
  }

  /** Aktuelle Gesamtstreuung in Radiant */
  currentSpread() {
    const w = this.weapon;
    let sp = w.spread + this.spread;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded) sp += w.spreadAir;
    else if (hs > 1.5) sp += w.spreadMove * clamp(hs / 11, 0, 1.3);
    if (this.crouching && this.grounded) sp += w.spreadCrouch || 0;
    if (this.adsAmount > 0) sp *= 1 - this.adsAmount * (1 - w.spreadAds);
    return Math.max(0, sp);
  }

  // --------------------------------------------------------
  // Schaden
  // --------------------------------------------------------
  applyDamage(amount) {
    if (this.armor > 0) {
      const toArmor = Math.min(this.armor, amount * 0.6);
      this.armor -= toArmor;
      amount -= toArmor;
    }
    this.hp -= amount;
    return this.hp <= 0;
  }

  heal(amount) {
    this.hp = Math.min(this.maxHp, this.hp + amount);
  }
  addArmor(amount) {
    this.maxArmor = Math.max(this.maxArmor, 50);
    this.armor = Math.min(this.maxArmor, this.armor + amount);
  }
  addAmmo() {
    for (const s of this.slots) {
      if (s.w.mag === Infinity) continue;
      s.reserve = Math.min(s.w.reserve * 1.5, s.reserve + s.w.mag * 2);
    }
    this.nades = Math.min(this.maxNades, this.nades + 1);
  }
}
