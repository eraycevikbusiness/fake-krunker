// ============================================================
// NetActor (Server): die Figur eines verbundenen Spielers.
// Bewegung kommt vom Client (client-autoritativ, mit Plausibilitaets-
// pruefung), Leben, Munition-Pickups, Kills und Punkte verwaltet der Server.
// ============================================================

import { Actor, PHYS } from '../src/game/actor.js';
import { WEAPON_IDS, F } from '../src/net/protocol.js';
import { clamp } from '../src/core/utils.js';

const HIST_LEN = 0.6;          // Sekunden Positionsverlauf (fuer Trefferpruefung)
const MAX_SPEED = 95;          // Einheiten/s, darueber gilt es als Teleport

export class NetActor extends Actor {
  constructor(sim, opts) {
    super(sim, opts);
    this.isNet = true;
    this.client = opts.client || null;
    this.hist = [];
    this.lastStateAt = -1;
    this.hitBudget = 4;
    this.hitBudgetT = 0;
    this.shotBudget = 6;
    this.shotBudgetT = 0;
    this.suspicious = 0;
    this.alive = false;
    this.ping = 0;
  }

  /** Zustand vom Client: [x,y,z,yaw,pitch,vx,vy,vz,flags,widx,height,(gx,gy,gz)] */
  applyState(d, now) {
    if (!this.alive || !Array.isArray(d) || d.length < 11) return;
    for (let i = 0; i < 11; i++) if (typeof d[i] !== 'number' || !isFinite(d[i])) return;
    const x = d[0], y = d[1], z = d[2];
    const half = (this.game.mapDef && this.game.mapDef.size ? this.game.mapDef.size : 120) / 2 + 20;
    if (Math.abs(x) > half || Math.abs(z) > half || y < -40 || y > 200) return;
    if (this.lastStateAt >= 0) {
      const dt = Math.max(1 / 60, now - this.lastStateAt);
      const dist = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (dist / dt > MAX_SPEED && dist > 6) { this.suspicious++; if (this.suspicious < 8) return; }
      else if (this.suspicious > 0) this.suspicious--;
    }
    this.pos.x = x; this.pos.y = y; this.pos.z = z;
    this.yaw = d[3]; this.pitch = clamp(d[4], -1.6, 1.6);
    this.vel.x = d[5]; this.vel.y = d[6]; this.vel.z = d[7];
    const f = d[8] | 0;
    this.crouching = !!(f & F.CROUCH);
    this.grounded = !!(f & F.GROUND);
    this.sliding = !!(f & F.SLIDE);
    this.sprinting = !!(f & F.SPRINT);
    this.adsAmount = (f & F.ADS) ? 1 : 0;
    this.zip = (f & F.ZIP) ? (this.zip || { def: null, t: 0, dir: 1 }) : null;
    if (f & F.GRAPPLE) {
      if (!this.grapple) this.grapple = { x: 0, y: 0, z: 0 };
      if (d.length >= 14) { this.grapple.x = d[11]; this.grapple.y = d[12]; this.grapple.z = d[13]; }
    } else this.grapple = null;
    this.dashT = (f & F.DASH) ? 0.1 : 0;
    this.reloadTimer = (f & F.RELOAD) ? 1 : 0;
    if (f & F.WALL_L || f & F.WALL_R) {
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw), s = (f & F.WALL_L) ? 1 : -1;
      if (!this.wallrun) this.wallrun = { nx: 0, nz: 0 };
      this.wallrun.nx = rx * s; this.wallrun.nz = rz * s;
    } else this.wallrun = null;
    this.intent.interactHold = !!(f & F.HOLD);
    this.intent.fire = !!(f & F.FIRE);
    this.height = clamp(d[10], PHYS.CROUCH_HEIGHT, PHYS.HEIGHT);
    // Waffe: nur, was der Spieler tatsaechlich hat
    const wid = WEAPON_IDS[d[9] | 0];
    if (wid && this.weapon.id !== wid) {
      for (let i = 0; i < this.slots.length; i++) if (this.slots[i].w.id === wid) { this.slot = i; break; }
    }
    this.hist.push({ t: now, x, y, z });
    while (this.hist.length > 2 && this.hist[0].t < now - HIST_LEN) this.hist.shift();
    this.lastStateAt = now;
  }

  spawn(point) {
    super.spawn(point);
    this.hist.length = 0;
    this.lastStateAt = -1;
  }

  /** Nur Zeitgeber: die Physik laeuft beim Client */
  update(dt) {
    if (this.spawnProtect > 0) this.spawnProtect -= dt;
    if (this.shieldT > 0) { this.shieldT -= dt; if (this.shieldT <= 0) this.shield = 0; }
    if (this.nadeCooldown > 0) this.nadeCooldown -= dt;
    if (this.zipCooldown > 0) this.zipCooldown -= dt;
    if (this.dashT > 0) this.dashT -= dt;
    if (this.pos.y < -30 && this.alive) this.game.damageActor(this, null, 9999, 'void', null);
  }

  /** War das Opfer in den letzten Sekundenbruchteilen nahe an diesem Punkt? */
  wasNear(px, py, pz, r) {
    const check = (x, y, z) => Math.hypot(px - x, pz - z) < r && py > y - 0.6 && py < y + this.height + 0.8;
    if (check(this.pos.x, this.pos.y, this.pos.z)) return true;
    for (let i = 0; i < this.hist.length; i++) { const h = this.hist[i]; if (check(h.x, h.y, h.z)) return true; }
    return false;
  }
}
