// ============================================================
// RemoteActor: Figur eines anderen Spielers im Online-Match.
// Bewegt sich nicht per Physik, sondern interpoliert zwischen den
// Snapshots des Servers (mit kleiner Verzoegerung, damit es fluessig
// bleibt). Schrittgeraeusche werden lokal aus der Bewegung abgeleitet.
// ============================================================

import { Actor, PHYS } from './actor.js';
import { WEAPONS, applyAttachments } from './weapons.js';
import { WEAPON_IDS, F, INTERP_DELAY } from '../net/protocol.js';
import { clamp, lerp, angleLerp } from '../core/utils.js';

const MAX_BUF = 16;

export class RemoteActor extends Actor {
  constructor(game, opts) {
    super(game, opts);
    this.isRemote = true;
    this.buf = [];
    this.renderT = -1;
    this.flags = 0;
    this._wallSide = 0;
    this.stepDist = 0;
    this.alive = false;
  }

  /** Snapshot-Eintrag einreihen: t = Serverzeit, e = gepackter Zustand */
  pushSnapshot(t, e) {
    const b = this.buf;
    if (b.length && t <= b[b.length - 1].t) return;
    b.push({ t, x: e[1], y: e[2], z: e[3], yaw: e[4], pitch: e[5], vx: e[6], vy: e[7], vz: e[8], f: e[9], w: e[10], hp: e[11], ar: e[12], sh: e[13], gx: e[14], gy: e[15], gz: e[16] });
    while (b.length > MAX_BUF) b.shift();
    // Sofort uebernehmen, was nicht interpoliert wird
    this.hp = e[11]; this.armor = e[12]; this.shield = e[13];
    this._applyFlags(e[9], e);
    this._applyWeapon(e[10]);
  }

  /** Teleport (Spawn): Puffer leeren */
  spawnAt(x, y, z, yaw) {
    this.buf.length = 0;
    this.renderT = -1;
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.yaw = yaw || 0; this.pitch = 0;
    this.alive = true;
    this.hp = this.maxHp; this.armor = this.maxArmor;
    this.height = PHYS.HEIGHT;
    this.spawnProtect = 1.4;
    this.burnT = 0; this.shield = 0; this.grapple = null; this.zip = null; this.wallrun = null;
    if (this.model) this.model.resetDeath();
  }

  _applyFlags(f, e) {
    this.flags = f;
    const wasAlive = this.alive;
    this.alive = !!(f & F.ALIVE);
    if (!this.alive && wasAlive) this.hp = 0;
    this.crouching = !!(f & F.CROUCH);
    this.grounded = !!(f & F.GROUND);
    this.sliding = !!(f & F.SLIDE);
    this.sprinting = !!(f & F.SPRINT);
    this.adsAmount = (f & F.ADS) ? 1 : 0;
    this.zip = (f & F.ZIP) ? (this.zip || { def: null, t: 0, dir: 1 }) : null;
    if (f & F.GRAPPLE) {
      if (e && e.length >= 17) { if (!this.grapple) this.grapple = { x: 0, y: 0, z: 0 }; this.grapple.x = e[14]; this.grapple.y = e[15]; this.grapple.z = e[16]; }
      else if (!this.grapple) this.grapple = { x: this.pos.x, y: this.pos.y + 6, z: this.pos.z };
    } else this.grapple = null;
    this.burnT = (f & F.BURN) ? 1 : 0;
    if (!(f & F.SHIELD)) this.shield = 0;
    this._wallSide = (f & F.WALL_L) ? 1 : (f & F.WALL_R) ? -1 : 0;
    this.reloadTimer = (f & F.RELOAD) ? 1 : 0;
    this.dashT = (f & F.DASH) ? 1 : 0;
    this.intent.interactHold = !!(f & F.HOLD);
    this.intent.fire = !!(f & F.FIRE);
    this.spawnProtect = (f & F.SPAWNPROT) ? 1 : 0;
  }

  _applyWeapon(widx) {
    const id = WEAPON_IDS[widx] || 'ar';
    if (this.weapon.id === id) return;
    let idx = -1;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].w.id === id) { idx = i; break; }
    if (idx < 0) {
      const base = WEAPONS[id] || WEAPONS.ar;
      const w = this.attachments && this.attachments[id] ? applyAttachments(base, this.attachments[id]) : base;
      const slot = base.slot === 1 ? 1 : (base.melee ? 2 : 0);
      idx = Math.min(slot, this.slots.length - 1);
      this.slots[idx] = { w, mag: w.mag, reserve: w.reserve, pendingSingle: 0 };
    }
    this.slot = idx;
    this.game.onWeaponSwitch && this.game.onWeaponSwitch(this);
  }

  // --------------------------------------------------------
  update(dt, world) {
    const b = this.buf;
    if (!b.length) return;
    const latest = b[b.length - 1];
    const target = latest.t - INTERP_DELAY;
    if (this.renderT < 0) this.renderT = target;
    else {
      this.renderT += dt;
      // Drift ausgleichen: zu weit hinten -> aufholen, zu weit vorn -> bremsen
      const err = target - this.renderT;
      if (err > 0.25 || err < -0.2) this.renderT = target;
      else this.renderT += err * Math.min(1, dt * 3);
    }
    const rt = this.renderT;

    let i = b.length - 1;
    while (i > 0 && b[i].t > rt) i--;
    const a = b[i];
    const c = b[Math.min(i + 1, b.length - 1)];
    let x, y, z, yaw, pitch;
    if (c !== a && c.t > a.t) {
      const k = clamp((rt - a.t) / (c.t - a.t), 0, 1);
      x = lerp(a.x, c.x, k); y = lerp(a.y, c.y, k); z = lerp(a.z, c.z, k);
      yaw = angleLerp(a.yaw, c.yaw, k); pitch = lerp(a.pitch, c.pitch, k);
      this.vel.x = lerp(a.vx, c.vx, k); this.vel.y = lerp(a.vy, c.vy, k); this.vel.z = lerp(a.vz, c.vz, k);
    } else {
      // Kein neuerer Snapshot: kurz mit der letzten Geschwindigkeit weiterlaufen
      const ahead = clamp(rt - latest.t, 0, 0.12);
      x = latest.x + latest.vx * ahead; y = latest.y + latest.vy * ahead; z = latest.z + latest.vz * ahead;
      yaw = latest.yaw; pitch = latest.pitch;
      this.vel.x = latest.vx; this.vel.y = latest.vy; this.vel.z = latest.vz;
    }
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.yaw = yaw; this.pitch = pitch;

    // Hoehe (Ducken) weich
    const targetH = this.crouching ? PHYS.CROUCH_HEIGHT : PHYS.HEIGHT;
    this.height += (targetH - this.height) * Math.min(1, dt * 12);

    // Wandlauf-Normale aus der Seite ableiten (fuer die Animation)
    if (this._wallSide) {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      if (!this.wallrun) this.wallrun = { nx: 0, nz: 0 };
      this.wallrun.nx = rx * this._wallSide; this.wallrun.nz = rz * this._wallSide;
    } else this.wallrun = null;

    // Schrittgeraeusche aus der Bewegung
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.alive && (this.grounded || this.wallrun) && hs > 1.5 && !this.sliding && !this.zip) {
      this.stepDist += hs * dt;
      const interval = this.crouching ? 3.2 : (this.wallrun ? 1.9 : 2.35);
      if (this.stepDist > interval) {
        this.stepDist = 0;
        this.surface = world ? world.surfaceAt(this.pos.x, this.pos.y, this.pos.z, this.radius * 0.8) : 'stone';
        this.game.onFootstep && this.game.onFootstep(this, hs, this.surface);
      }
    } else if (!this.grounded) this.stepDist = 1.6;
    if (this.spawnProtect > 0 && !(this.flags & F.SPAWNPROT)) this.spawnProtect = 0;
  }
}
