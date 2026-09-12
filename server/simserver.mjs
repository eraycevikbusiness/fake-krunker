// ============================================================
// ServerSim: die autoritative Simulation eines Raums.
// Bots laufen komplett hier; Spieler schicken Bewegung, Schuesse und
// Treffer, der Server prueft sie und verteilt Schaden, Kills, Punkte,
// Pickups, Projektile, Zerstoerung und den Modus an alle Clients.
// ============================================================

import { Sim, falloff } from '../src/game/sim.js';
import { Bot } from '../src/game/bot.js';
import { WEAPONS, ATTACHMENT_BY_ID, MAX_ATTACHMENTS, CLASS_BY_ID } from '../src/game/weapons.js';
import { SKINS } from '../src/game/skins.js';
import { STICKERS } from '../src/game/stickers.js';
import { OUTFITS, HATS, KILL_EFFECTS, KILL_ICONS } from '../src/game/cosmetics.js';
import { packActor, WEAPON_IDX, baseWeaponId } from '../src/net/protocol.js';
import { NetActor } from './netactor.mjs';

const RELAY_OK = new Set(['shot', 'swing', 'throw', 'mhit', 'jump', 'djump', 'land', 'slide', 'dash', 'wallrun', 'grap', 'zip', 'pad', 'reload', 'charge']);
const r2 = (v) => Math.round(v * 100) / 100;

function num(v, lo, hi, def) {
  if (typeof v !== 'number' || !isFinite(v)) return def;
  return v < lo ? lo : v > hi ? hi : v;
}
function vec3(v, lim) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const out = [num(v[0], -lim, lim, NaN), num(v[1], -lim, lim, NaN), num(v[2], -lim, lim, NaN)];
  return out.some(x => Number.isNaN(x)) ? null : out;
}

export class ServerSim extends Sim {
  constructor(room) {
    super();
    this.server = true;
    this.room = room;
    this.outbox = [];
    this.nextId = 1;
    this.rules.dropWeapons = true;
  }

  emit(ev) { if (ev.loc) return; this.outbox.push(ev); }
  makeBot(opts) { return new Bot(this, Object.assign({ id: this.nextId++ }, opts)); }
  onMatchEnd(winner) { super.onMatchEnd(winner); this.room.onMatchEnd(winner); }

  // --------------------------------------------------------
  // Spieler
  // --------------------------------------------------------
  /** Cosmetics/Klasse aus der Hello-Nachricht pruefen und uebernehmen */
  applyProfile(a, p) {
    if (!p) return;
    if (p.cls && CLASS_BY_ID[p.cls]) a.pendingClassId = p.cls;
    a.attachments = this.cleanAttachments(p.att);
    a.refreshAttachments();
    a.outfit = OUTFITS.some(o => o.id === p.outfit) ? p.outfit : 'team';
    a.hat = HATS.some(o => o.id === p.hat) ? p.hat : 'none';
    a.killEffect = KILL_EFFECTS.some(o => o.id === p.fx) ? p.fx : 'none';
    a.killIcon = KILL_ICONS.some(o => o.id === p.icon) ? p.icon : 'none';
    a.skins = {}; a.stickers = {};
    if (p.skins && typeof p.skins === 'object') for (const k of Object.keys(p.skins)) if (WEAPONS[k] && SKINS.some(s => s.id === p.skins[k])) a.skins[k] = p.skins[k];
    if (p.stickers && typeof p.stickers === 'object') for (const k of Object.keys(p.stickers)) if (WEAPONS[k] && STICKERS.some(s => s.id === p.stickers[k])) a.stickers[k] = p.stickers[k];
  }

  cleanAttachments(att) {
    const out = {};
    if (!att || typeof att !== 'object') return out;
    for (const k of Object.keys(att)) {
      if (!WEAPONS[k] || !Array.isArray(att[k])) continue;
      const ids = att[k].filter(id => typeof id === 'string' && ATTACHMENT_BY_ID[id]).slice(0, MAX_ATTACHMENTS);
      if (ids.length) out[k] = ids;
    }
    return out;
  }

  /** Neuer Spieler: Figur anlegen, in den Modus einfuegen, spawnen */
  addHuman(client, profile, keepId) {
    const a = new NetActor(this, {
      id: keepId || this.nextId++, name: client.name, team: this.pickTeam(),
      classId: profile && CLASS_BY_ID[profile.cls] ? profile.cls : 'triggerman', attachments: {}, client,
    });
    if (!this.teamMode) a.team = 'ffa' + a.id;
    a.skin = client.skinTone; a.hair = client.hairColor;
    this.applyProfile(a, profile);
    a.pendingClassId = null;
    a.ping = client.ping | 0;
    this.actors.push(a);
    if (this.modeCtl) {
      if (this.modeCtl.setupLateActor) this.modeCtl.setupLateActor(a);
      else if (this.modeCtl.setupActor) this.modeCtl.setupActor(a);
    }
    const blocked = this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(a);
    if (this.running && !blocked) this.respawn(a, true);
    else a.respawnTimer = blocked ? 99999 : 0.1;
    return a;
  }

  removeActor(a) {
    const i = this.actors.indexOf(a);
    if (i < 0) return;
    if (a.carrying && this.modeCtl && this.modeCtl.onDeath) this.modeCtl.onDeath(a, null);
    if (this.modeCtl && this.modeCtl.onDeath && a.alive) this.modeCtl.onDeath(a, null);
    for (const b of this.actors) if (b.isBot && b.target === a) b.target = null;
    for (const p of this.projectiles) if (p.owner === a) p.owner = null;
    this.actors.splice(i, 1);
  }

  /** Bot entfernen: bevorzugt tote Bots aus dem staerkeren Team */
  removeOneBot() {
    const bots = this.actors.filter(a => a.isBot);
    if (!bots.length) return null;
    let red = 0, blue = 0;
    for (const a of this.actors) { if (a.team === 'red') red++; else if (a.team === 'blue') blue++; }
    const big = red > blue ? 'red' : 'blue';
    bots.sort((a, b) => ((a.alive ? 1 : 0) - (b.alive ? 1 : 0)) || ((a.team === big ? 0 : 1) - (b.team === big ? 0 : 1)));
    const bot = bots[0];
    this.removeActor(bot);
    return bot;
  }

  // --------------------------------------------------------
  // Nachrichten eines Clients
  // --------------------------------------------------------
  onClientState(a, msg) {
    if (!a) return;
    a.applyState(msg.d, this.time);
    if (Array.isArray(msg.e)) for (const ev of msg.e.slice(0, 12)) this._relay(a, ev);
  }

  _relay(a, ev) {
    if (!ev || typeof ev.t !== 'string' || !RELAY_OK.has(ev.t) || !a.alive) return;
    const out = { t: ev.t, a: a.id, ex: a.id };
    if (ev.t === 'shot') {
      const w = a.weapon;
      if (typeof ev.w !== 'string' || ev.w !== w.id) return;
      if (!this._shotBudget(a, w)) return;
      a.lastShotTime = this.time;
      a.lastLoudTime = w.suppressed ? this.time - 0.9 : this.time;
      const o = vec3(ev.o, 400), d = vec3(ev.d, 1.01);
      if (!o || !d) return;
      const p = num(ev.p, 0, 1, 1);
      out.w = w.id; out.p = p; out.h = !!ev.h; out.o = o; out.d = d; out.f = !!w.flame;
      out.e = null;
      if (Array.isArray(ev.e) && !w.flame) {
        out.e = [];
        for (const e of ev.e.slice(0, (w.pellets || 1) + 1)) {
          const pt = vec3(e, 400);
          if (!pt) continue;
          const k = num(e[3], 0, 4, 0) | 0;
          out.e.push([pt[0], pt[1], pt[2], k, num(e[4], -1, 1, 0), num(e[5], -1, 1, 0), num(e[6], -1, 1, 0)]);
        }
      }
      if (w.projectile) {
        // Projektil vom Server (Muendung ~ Auge + Blickrichtung)
        const origin = this._v3.set(o[0] + d[0] * 0.6, o[1] - 0.15 + d[1] * 0.6, o[2] + d[2] * 0.6);
        const eye = a.eyePos(this._v1);
        if (Math.hypot(origin.x - eye.x, origin.y - eye.y, origin.z - eye.z) > 3) return;
        const dir = this._v2.set(d[0], d[1], d[2]).normalize();
        this.spawnProjectile(a, w, origin, dir, w.projectile, p);
      }
    } else if (ev.t === 'throw') {
      if (a.nades <= 0 || a.nadeCooldown > 0) return;
      const o = vec3(ev.o, 400), d = vec3(ev.d, 1.01);
      if (!o || !d) return;
      const eye = a.eyePos(this._v1);
      if (Math.hypot(o[0] - eye.x, o[1] - eye.y, o[2] - eye.z) > 3) return;
      a.nades--; a.nadeCooldown = 0.85;
      this.throwGrenade(a, { x: o[0], y: o[1], z: o[2] }, { x: d[0], y: d[1], z: d[2] });
      return;                       // throwGrenade meldet das Ereignis selbst
    } else if (ev.t === 'swing') {
      out.w = typeof ev.w === 'string' ? ev.w : 'melee'; out.k = String(ev.k || 'bash').slice(0, 12); out.h = !!ev.h;
      out.st = num(ev.st, 0.1, 2, 0.34); out.sw = typeof ev.sw === 'string' ? ev.sw.slice(0, 12) : null;
      a.lastLoudTime = this.time - 0.6;
    } else if (ev.t === 'mhit') {
      const p = vec3([ev.x, ev.y, ev.z], 400), d = vec3(ev.d, 1.01);
      if (!p || !d) return;
      out.v = ev.v | 0; out.x = p[0]; out.y = p[1]; out.z = p[2]; out.d = d; out.h = !!ev.h; out.k = String(ev.k || 'knife').slice(0, 12);
      out.dist = num(ev.dist, 0, 10, 2); out.head = !!ev.head; out.killed = !!ev.killed; out.n = num(ev.n, 0, 300, 45);
    } else if (ev.t === 'land') { out.i = num(ev.i, 0, 80, 5); out.sf = String(ev.sf || 'stone').slice(0, 10); }
    else if (ev.t === 'slide') out.sf = String(ev.sf || 'stone').slice(0, 10);
    else if (ev.t === 'grap') { out.k = String(ev.k || 'shoot').slice(0, 8); out.p = vec3(ev.p, 400); }
    else if (ev.t === 'zip') out.k = String(ev.k || 'start').slice(0, 6);
    else if (ev.t === 'reload') { out.k = num(ev.k, 0, 3, 0) | 0; out.tot = num(ev.tot, 0, 10, 2); out.more = !!ev.more; if (out.k === 3) return; }
    this.outbox.push(out);
  }

  _shotBudget(a, w) {
    const rate = w.melee ? 4 : Math.max(2, (w.rpm / 60) * 1.35 + 0.5);
    a.shotBudget = Math.min(rate * 0.5 + 3, a.shotBudget + (this.time - a.shotBudgetT) * rate);
    a.shotBudgetT = this.time;
    if (a.shotBudget < 1) return false;
    a.shotBudget -= 1;
    return true;
  }

  /** Treffer-Meldung: {v, w, h, n, p:[x,y,z], d:[x,y,z], b, hv} */
  onClientHit(a, m) {
    if (!a || !a.alive || this.over || !m) return;
    const v = this.actorById(m.v | 0);
    if (!v || !v.alive || v === a || this.sameTeam(a, v) || v.spawnProtect > 0) return;
    const p = vec3(m.p, 400), d = vec3(m.d, 1.01);
    if (!p || !d) return;
    const w = a.weapon;
    const wid = m.w;
    let dmg, range, cause, melee = false, kb = 0, strength = 0;
    if (wid === 'melee') {
      melee = true; dmg = 45 * (m.b ? 2 : 1); range = 4.2; cause = 'melee'; kb = 3; strength = 8;
    } else {
      if (typeof wid !== 'string' || wid !== w.id) return;
      if (w.projectile) return;
      if (w.melee) {
        melee = true;
        const heavy = !!m.hv && w.heavy;
        const def = heavy ? w.heavy : w;
        dmg = def.damage * (m.b ? (w.meleeBackstab || 1) : 1);
        if (m.h && !m.b) dmg *= (w.headMult || 1);
        range = (def.meleeRange || w.meleeRange || 3.4) + 1.2;
        kb = (w.knockback || 4) * (heavy ? 1.6 : 1); strength = heavy ? 12 : 8;
      } else {
        const eye = a.eyePos(this._v1);
        const dist = Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z);
        const mult = m.h ? w.headMult : (m.l ? w.legMult : 1);
        dmg = w.damage * mult * falloff(w, dist);
        range = w.range + 4;
      }
      cause = w.id;
    }
    // Rate: nicht mehr Treffer als die Waffe hergibt
    const rate = melee ? 4 : (w.rpm / 60) * (w.pellets || 1) * 1.35 + 1;
    a.hitBudget = Math.min(rate * 0.5 + 3, a.hitBudget + (this.time - a.hitBudgetT) * rate);
    a.hitBudgetT = this.time;
    if (a.hitBudget < 1) return;
    a.hitBudget -= 1;
    // Ort plausibel: nahe am Opfer (jetzt oder gerade eben), in Reichweite, ohne dicke Wand dazwischen
    const near = v.isNet ? v.wasNear(p[0], p[1], p[2], 2.6) : (Math.hypot(p[0] - v.pos.x, p[2] - v.pos.z) < 3.2 && p[1] > v.pos.y - 0.6 && p[1] < v.pos.y + v.height + 0.8);
    if (!near) return;
    const eye = a.eyePos(this._v1);
    const dist = Math.hypot(p[0] - eye.x, p[1] - eye.y, p[2] - eye.z);
    if (dist > range) return;
    if (dist > 0.5) {
      const dx = (p[0] - eye.x) / dist, dy = (p[1] - eye.y) / dist, dz = (p[2] - eye.z) / dist;
      const wall = this.world.raycast(eye.x, eye.y, eye.z, dx, dy, dz, dist);
      if (wall && wall.t < dist - 2.2) return;
    }
    if (kb > 0 && v.alive) this.pushActor(v, d[0] * kb, kb * 0.35, d[2] * kb);
    const res = this.damageActor(v, a, dmg, cause, { x: p[0], y: p[1], z: p[2], dirx: d[0], diry: d[1], dirz: d[2], head: !!m.h, strength, quiet: true, noPopup: true, back: !!m.b, dist });
    if (res && w.burn && v.alive) { v.burnT = w.burn.time; v.burnFrom = a; v.burnDps = w.burn.dps; }
  }

  onClientHurt(a, m) {
    if (!a || !a.alive || !m) return;
    const cause = m.c === 'void' ? 'void' : 'fall';
    const n = cause === 'void' ? 9999 : num(m.n, 0, 120, 0);
    if (n > 0) this.damageActor(a, null, n, cause, null);
  }

  onClientWdmg(a, m) {
    if (!a || !a.alive || !m) return;
    const c = this.world.destructibles[m.i | 0];
    if (!c || c.dead) return;
    const dist = Math.hypot(c.cx - a.pos.x, c.cz - a.pos.z);
    if (dist > 120) return;
    if (this.world.damageDestructible(c, num(m.n, 0, 200, 10))) this._destroyed(c, a);
  }

  onClientUse(a, m) {
    if (!a || !a.alive || !m) return;
    if (m.k === 'drop') {
      const d = this.drops.find(x => x.id === (m.id | 0));
      if (!d) return;
      if (Math.hypot(a.pos.x - d.x, a.pos.z - d.z) > 3 || Math.abs(a.pos.y - d.y) > 3) return;
      this.pickupDrop(a, d);
    }
  }

  onClientStrike(a, m) {
    if (!a || !a.alive || !m || a.airstrikes <= 0) return;
    const o = vec3(m.o, 400), d = vec3(m.d, 1.01);
    if (!o || !d) return;
    a.airstrikes--;
    this.callAirstrike(a, this._v1.set(o[0], o[1], o[2]), this._v2.set(d[0], d[1], d[2]).normalize());
  }

  onClientClass(a, m) {
    if (!a || !m) return;
    if (m.att) { a.attachments = this.cleanAttachments(m.att); a.refreshAttachments(); }
    if (m.keep) return;
    if (typeof m.cls === 'string' && CLASS_BY_ID[m.cls] && m.cls !== a.classDef.id) a.pendingClassId = m.cls;
  }

  onClientCosmetics(a, m) {
    if (!a || !m) return;
    this.applyProfile(a, { cls: null, att: a.attachments, outfit: m.outfit, hat: m.hat, fx: m.fx, icon: m.icon, skins: m.skins, stickers: m.stickers });
    this.outbox.push({ t: 'cos', a: a.id, outfit: a.outfit, hat: a.hat, fx: a.killEffect, icon: a.killIcon, skins: a.skins, stickers: a.stickers });
  }

  // --------------------------------------------------------
  // Snapshot
  // --------------------------------------------------------
  snapshot() {
    const s = {
      t: 'snap', s: r2(this.time), tl: r2(this.timeLeft), sc: [this.scores.red, this.scores.blue],
      a: this.actors.map(packActor),
    };
    if (this.projectiles.length) {
      s.p = this.projectiles.map(p => [p.id, WEAPON_IDX[p.weapon.id] | 0, r2(p.x), r2(p.y), r2(p.z), r2(p.vx), r2(p.vy), r2(p.vz)]);
    }
    const k = [];
    for (const a of this.actors) {
      const uav = a.uavUntil > this.time ? r2(a.uavUntil - this.time) : 0;
      if (uav > 0 || a.airstrikes > 0 || a.shieldT > 0) k.push([a.id, uav, a.airstrikes, r2(Math.max(0, a.shieldT))]);
    }
    if (k.length) s.k = k;
    if (this.modeCtl) s.m = this.modeCtl.netState();
    return s;
  }

  /** Vollstaendiger Zustand fuer einen Beitritt */
  fullState() {
    const off = [];
    for (const p of this.pickups) if (!p.active) off.push(p.i);
    return {
      match: {
        mode: this.mode, map: this.mapId, weather: this.weatherId, scoreLimit: this.scoreLimit, timeLimit: this.timeLimit,
        timeLeft: r2(this.timeLeft), scores: [this.scores.red, this.scores.blue], time: r2(this.time),
      },
      mode: this.modeCtl ? this.modeCtl.netState() : null,
      pickupsOff: off,
      drops: this.drops.map(d => this.dropEvent(d)),
      destr: this.world ? this.world.deadDestructibles() : [],
    };
  }
}

export { baseWeaponId };
