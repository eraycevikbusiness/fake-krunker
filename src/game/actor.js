// ============================================================
// Actor: gemeinsame Basis fuer Spieler und Bots
// Bewegung im Quake-Stil (Bunny-Hop / Air-Strafe), Slide,
// Mehrfachsprung, Waffen-Zustandsautomat, Trefferzonen
// ============================================================

import { clamp, damp, rand, gauss } from '../core/utils.js';
import { WEAPONS, CLASS_BY_ID, fireDelay } from './weapons.js';
import { CHAR } from './character.js';

export const PHYS = {
  HEIGHT: CHAR.HEIGHT,          // 2.4
  CROUCH_HEIGHT: 1.55,
  EYE: 2.08,
  CROUCH_EYE: 1.28,
  RADIUS: 0.55,
  STEP: 1.16,

  BASE_SPEED: 11.6,
  CROUCH_MULT: 0.48,
  SPRINT_MULT: 1.32,
  BACK_MULT: 0.86,

  GROUND_ACCEL: 95,
  AIR_ACCEL: 24,
  AIR_WISH_CAP: 3.6,            // ermoeglicht Air-Strafe-Beschleunigung
  FRICTION: 8.6,
  STOP_SPEED: 2.2,

  GRAVITY: 36,
  JUMP_VEL: 13.6,
  DOUBLE_JUMP_VEL: 12.2,
  MAX_FALL: 62,

  SLIDE_BOOST: 4.2,
  SLIDE_TIME: 0.85,
  SLIDE_FRICTION: 1.9,
  SLIDE_MIN_SPEED: 7.5,

  FALL_DMG_START: 22,           // Fallgeschwindigkeit ab der Schaden entsteht
  FALL_DMG_SCALE: 3.2,
};

// Trefferzonen relativ zur Fusshoehe (bei voller Hoehe)
export const HITBOX = {
  head:  { y0: 1.80, y1: 2.42, r: 0.34, mult: 'head' },
  torso: { y0: 0.90, y1: 1.80, r: 0.48, mult: 'body' },
  legs:  { y0: 0.00, y1: 0.90, r: 0.42, mult: 'legs' },
};

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
    this.jumpsLeft = 1;
    this.height = PHYS.HEIGHT;
    this.radius = PHYS.RADIUS;
    this.landImpact = 0;
    this.stepDist = 0;
    this.airTime = 0;

    this.alive = false;
    this.hp = 100;
    this.maxHp = 100;
    this.armor = 0;
    this.maxArmor = 0;
    this.respawnTimer = 0;
    this.spawnProtect = 0;
    this.lastDamageFrom = null;
    this.lastDamageTime = -99;

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
    this.wantFire = false;
    this.ads = false;
    this.adsAmount = 0;
    this.pendingSwitch = -1;
    this.nadeCooldown = 0;

    this.intent = {
      fwd: 0, side: 0, jump: false, jumpPressed: false,
      crouch: false, sprint: false, fire: false, ads: false,
      reload: false, nade: false, melee: false, switchTo: -1,
    };

    this.model = null;
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
    this.slots = [
      this._mkSlot(WEAPONS[cls.primary]),
      this._mkSlot(WEAPONS[cls.secondary]),
      this._mkSlot(WEAPONS[cls.melee]),
    ];
    this.slot = 0;
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
    this.height = PHYS.HEIGHT;
    this.jumpsLeft = this.maxJumps;
    this.grounded = false;
    this.airTime = 0;
    this.spawnProtect = 1.4;
    this.nades = this.maxNades;
    this.fireTimer = 0;
    this.reloadTimer = 0;
    this.switchTimer = 0;
    this.burstLeft = 0;
    this.spread = 0;
    this.slot = 0;
    this.lastSlot = 1;
    for (const s of this.slots) {
      s.mag = s.w.mag === Infinity ? Infinity : s.w.mag;
      s.reserve = s.w.reserve;
      s.pendingSingle = 0;
    }
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

  /** Trefferzonen als AABBs (skaliert mit Duckhoehe) */
  getHitboxes(out) {
    const scale = this.height / PHYS.HEIGHT;
    out.length = 0;
    for (const key in HITBOX) {
      const h = HITBOX[key];
      out.push({
        zone: key,
        minx: this.pos.x - h.r, maxx: this.pos.x + h.r,
        minz: this.pos.z - h.r, maxz: this.pos.z + h.r,
        miny: this.pos.y + h.y0 * scale, maxy: this.pos.y + h.y1 * scale,
      });
    }
    return out;
  }

  /** Grobe Kugel fuer Vorabtests */
  boundsCenter(out) {
    out.x = this.pos.x;
    out.y = this.pos.y + this.height * 0.5;
    out.z = this.pos.z;
    return out;
  }
  get boundsRadius() { return this.height * 0.62; }

  // --------------------------------------------------------
  // Physik
  // --------------------------------------------------------
  updatePhysics(dt, world) {
    const P = PHYS;
    const it = this.intent;

    // ---- Ducken / Slide ----
    const wantCrouch = it.crouch;
    const speed2 = Math.hypot(this.vel.x, this.vel.z);

    if (wantCrouch && !this.crouching && this.grounded && speed2 > P.SLIDE_MIN_SPEED && this.slideT <= 0) {
      // Slide starten
      this.sliding = true;
      this.slideT = P.SLIDE_TIME;
      const l = Math.max(0.001, speed2);
      this.vel.x += (this.vel.x / l) * P.SLIDE_BOOST;
      this.vel.z += (this.vel.z / l) * P.SLIDE_BOOST;
      this.game.onSlide && this.game.onSlide(this);
    }
    if (this.sliding) {
      this.slideT -= dt;
      if (!wantCrouch || this.slideT <= 0 || !this.grounded || speed2 < 3.5) {
        this.sliding = false;
        this.slideT = Math.min(this.slideT, 0);
      }
    }

    this.crouching = wantCrouch;
    const targetH = (this.crouching || this.sliding) ? P.CROUCH_HEIGHT : P.HEIGHT;
    if (targetH > this.height) {
      // Nur aufstehen, wenn Platz ist
      if (world.isFree(this.pos.x, this.pos.y, this.pos.z, this.radius, targetH)) {
        this.height = Math.min(targetH, this.height + dt * 7);
      }
    } else {
      this.height = Math.max(targetH, this.height - dt * 9);
    }

    // ---- Wunschrichtung ----
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    let wx = -sin * it.fwd + cos * it.side;
    let wz = -cos * it.fwd - sin * it.side;
    const wl = Math.hypot(wx, wz);
    if (wl > 0.0001) { wx /= wl; wz /= wl; }

    // ---- Maximalgeschwindigkeit ----
    let maxSpeed = P.BASE_SPEED * this.speedMult * (this.weapon.moveMult || 1);
    if (this.adsAmount > 0.05) {
      maxSpeed *= 1 - this.adsAmount * (1 - (this.weapon.adsMoveMult || 0.45));
    }
    if (this.crouching && !this.sliding) maxSpeed *= P.CROUCH_MULT;
    else if (it.sprint && it.fwd > 0.2 && !this.ads) maxSpeed *= P.SPRINT_MULT;
    if (it.fwd < -0.2) maxSpeed *= P.BACK_MULT;
    const wishSpeed = wl > 0.0001 ? maxSpeed * Math.min(1, wl) : 0;

    // ---- Reibung / Beschleunigung ----
    if (this.grounded) {
      const fr = this.sliding ? P.SLIDE_FRICTION : P.FRICTION;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0.001) {
        const control = Math.max(sp, P.STOP_SPEED);
        let drop = control * fr * dt;
        if (this.sliding) drop *= 0.55;
        const ns = Math.max(0, sp - drop) / sp;
        this.vel.x *= ns;
        this.vel.z *= ns;
      }
      if (!this.sliding) {
        this._accelerate(wx, wz, wishSpeed, P.GROUND_ACCEL, dt);
      } else {
        this._accelerate(wx, wz, wishSpeed * 0.4, P.GROUND_ACCEL * 0.25, dt);
      }
    } else {
      // Luft: begrenzte Wunschgeschwindigkeit -> Air-Strafe funktioniert
      this._accelerate(wx, wz, Math.min(wishSpeed, P.AIR_WISH_CAP), P.AIR_ACCEL, dt);
    }

    // ---- Springen ----
    if (it.jumpPressed) {
      if (this.grounded) {
        this.vel.y = P.JUMP_VEL;
        this.grounded = false;
        this.jumpsLeft = this.maxJumps - 1;
        this.sliding = false;
        this.game.onJump && this.game.onJump(this);
      } else if (this.jumpsLeft > 0) {
        this.jumpsLeft--;
        this.vel.y = P.DOUBLE_JUMP_VEL;
        // Doppelsprung lenkt die Bewegung in Blickrichtung
        if (wl > 0.001) {
          const cur = Math.hypot(this.vel.x, this.vel.z);
          const keep = Math.max(cur * 0.6, 6.5);
          this.vel.x = wx * keep;
          this.vel.z = wz * keep;
        }
        this.game.onDoubleJump && this.game.onDoubleJump(this);
      }
      it.jumpPressed = false;
    }

    // ---- Schwerkraft ----
    this.vel.y -= P.GRAVITY * dt;
    if (this.vel.y < -P.MAX_FALL) this.vel.y = -P.MAX_FALL;

    // ---- Bewegen + Kollision ----
    this.wasGrounded = this.grounded;
    const before = this.vel.y;
    const res = world.moveActor(
      this.pos, this.vel.x * dt, this.vel.y * dt, this.vel.z * dt,
      this.radius, this.height, this.grounded || this.vel.y <= 0 ? PHYS.STEP : 0
    );

    if (res.wallX) this.vel.x = 0;
    if (res.wallZ) this.vel.z = 0;
    if (res.ceiling && this.vel.y > 0) this.vel.y = 0;

    this.grounded = res.ground;
    if (this.grounded) {
      if (this.vel.y < 0) this.vel.y = 0;
      if (!this.wasGrounded) {
        // Landung
        const impact = Math.abs(before);
        this.landImpact = clamp(impact / 26, 0, 1);
        this.jumpsLeft = this.maxJumps;
        this.airTime = 0;
        this.game.onLand && this.game.onLand(this, impact);
        if (impact > PHYS.FALL_DMG_START) {
          const dmg = (impact - PHYS.FALL_DMG_START) * PHYS.FALL_DMG_SCALE;
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
        if (dx * dx + dz * dz < p.r * p.r && this.pos.y < 1.5) {
          this.vel.y = p.power;
          this.grounded = false;
          this.jumpsLeft = this.maxJumps;
          this.game.onJumpPad && this.game.onJumpPad(this, p);
          break;
        }
      }
    }

    // ---- Ausserhalb der Karte? ----
    if (this.pos.y < -30) this.game.damageActor(this, null, 9999, 'void', null);

    // ---- Schrittgeraeusche ----
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hs > 1.5 && !this.sliding) {
      this.stepDist += hs * dt;
      const interval = this.crouching ? 3.2 : 2.35;
      if (this.stepDist > interval) {
        this.stepDist = 0;
        this.game.onFootstep && this.game.onFootstep(this, hs);
      }
    } else if (!this.grounded) {
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

    // Nahkampf-Schlag mit F (unabhaengig von der Waffe)
    if (it.melee) {
      it.melee = false;
      if (this.fireTimer <= 0 && this.switchTimer <= 0) {
        this.fireTimer = 0.55;
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
      } else {
        return;
      }
    }

    if (this.switchTimer > 0) return;

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
    this.fireTimer = fireDelay(w);

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
      if (s.mag < w.mag && s.reserve > 0 && this.intent.reloadContinue !== false) {
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
      if (s.reserve === undefined || s.w.mag === Infinity) continue;
      s.reserve = Math.min(s.w.reserve * 1.5, s.reserve + s.w.mag * 2);
    }
    this.nades = Math.min(this.maxNades, this.nades + 1);
  }
}
