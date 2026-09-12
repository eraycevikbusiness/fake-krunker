// ============================================================
// Simulation: Match-Logik, Kampfsystem, Projektile, Pickups,
// Zerstoerbares, Killstreaks, liegende Waffen, Interaktionen, Bots.
// Kennt keine Darstellung: alles Sichtbare/Hoerbare wird als Ereignis
// ueber emit() gemeldet. Laeuft identisch
//   - offline im Browser (Game erbt und stellt dar),
//   - autoritativ auf dem Server (ServerSim erbt und verteilt Ereignisse),
//   - als Spiegel im Online-Client (online = true: Server entscheidet).
// ============================================================

import * as THREE from 'three';
import { CollisionWorld } from '../world/collision.js';
import { buildMap } from '../world/mapdata.js';
import { applyWeather } from '../world/weather.js';
import { Bot } from './bot.js';
import { WEAPONS, CLASSES } from './weapons.js';
import { KILL_EFFECT_BY_ID, KILL_ICON_BY_ID } from './cosmetics.js';
import { createMode, MODE_BY_ID } from './modes.js';
import { clamp, lerp, rand, pick, makeBotNames } from '../core/utils.js';

// Killstreak-Belohnungen: Kills -> Belohnung
export const STREAK_REWARDS = { 3: 'uav', 5: 'shield', 7: 'airstrike' };
export const UAV_TIME = 14;
export const SHIELD_AMOUNT = 80;
export const SHIELD_TIME = 14;
export const RESPAWN_HUMAN = 3.6;        // Sekunden bis zum Respawn (Killcam 3 s + Standbild)
const AIRSTRIKE_EX = { radius: 7.5, damage: 135, minMult: 0.25, force: 16, selfMult: 0.5 };
const BARREL_EX = { radius: 7.5, damage: 115, minMult: 0.25, force: 13, selfMult: 1 };
export const TEAM_NAME = { red: 'ROT', blue: 'BLAU' };

// Bot-Sprueche (Chat)
export const CHAT = {
  start: ['gl hf', 'los gehts', 'gg incoming', 'let\'s go', 'heute wird gefarmt', 'alle bereit?'],
  kill: ['gg ez', 'zu langsam', 'nice try', 'sit', 'get good', 'ez clap', 'nächster bitte', 'der war frei'],
  killed: ['nice shot', 'wtf', 'lag!', 'wie?!', 'ok das war gut', 'hax', 'bruh', 'meine maus spinnt', 'wo kam der her'],
  help: ['halte durch, komme!', 'bin auf dem weg', 'deck dich, ich komme', 'hold on!'],
  lowhp: ['brauche hilfe!', 'hp low, wo seid ihr', 'help pls', 'einer hier?'],
  flag: ['flagge! deckt mich', 'hab die flagge, go go', 'bringt sie heim!'],
  streak: ['unaufhaltsam', 'wer stoppt mich?', 'on fire 🔥', 'nobody can stop me'],
  headshot: ['headshot!', 'boom, kopf', 'one tap'],
  win: ['gg', 'gg wp', 'ez', 'good game'],
  lose: ['gg', 'gg wp', 'next round', 'unlucky'],
  zombie: ['braaains', 'ich rieche euch', 'lauft!', 'grrr'],
  welcome: ['hi', 'willkommen', 'hey', 'o/', 'gl hf'],
};

export const STREAK_NAMES = {
  2: 'DOPPELKILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL', 5: 'AMOKLAUF',
  7: 'UNAUFHALTSAM', 10: 'GOTTGLEICH', 15: 'LEGENDÄR', 20: 'UNSTERBLICH',
};

const MELEE_RAYS = [
  [0, 0], [-0.18, 0], [0.18, 0], [-0.36, -0.05], [0.36, -0.05],
  [0, -0.22], [0, 0.18], [-0.2, -0.25], [0.2, -0.25],
];

const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;

export function falloff(w, dist) {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}

/** Anzeigename einer Todesursache (Killfeed) */
export function causeName(causeId) {
  const w = WEAPONS[causeId];
  if (w) return w.short;
  return causeId === 'fall' ? 'STURZ' : causeId === 'void' ? 'ABGRUND'
    : causeId === 'melee' ? 'MELEE' : causeId === 'airstrike' ? 'LUFTSCHLAG'
    : causeId === 'barrel' ? 'FASS' : causeId === 'bomb' ? 'BOMBE' : 'EXPLOSION';
}

export class Sim {
  constructor() {
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.over = false;
    this.online = false;          // Client-Spiegel: der Server ist die Autoritaet
    this.server = false;          // headless auf dem Server
    this.actors = [];
    this.projectiles = [];
    this.pickups = [];
    this.jumpPads = [];
    this.pendingMelee = [];
    this.scores = { red: 0, blue: 0 };
    this.modeCtl = null;
    this.teamMode = true;
    this.mode = 'tdm';
    this.airstrikes = [];
    this.pendingDestr = [];
    this._destrList = [];
    this.ziplines = [];
    this.drops = [];
    this.world = null;
    this.weather = null;
    this.mapDef = null;
    this.mapId = 'sandstorm';
    this.weatherId = 'clear';
    this.player = null;           // lokaler Spieler (Client); auf dem Server null
    this.training = null;
    this.winner = null;
    this.rules = { killstreaks: true, autoReload: true, killEffects: true, dropWeapons: true };
    this.events = null;           // optionaler Puffer fuer emit()
    this.difficulty = 1;
    this.scoreLimit = 40;
    this.timeLimit = 600;
    this.timeLeft = 600;
    this._matchId = 0;
    this._chatGlobalT = -9;
    this._nextDropId = 1;
    this._nextProjId = 1;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._dmgAcc = new Map();
  }

  // --------------------------------------------------------
  // Erweiterungspunkte (Game / ServerSim ueberschreiben sie)
  // --------------------------------------------------------
  emit(ev) { if (this.events) this.events.push(ev); }
  createWorld(mapDef) { return new CollisionWorld(mapDef); }
  makeBot(opts) { return new Bot(this, opts); }
  rebuildActorModel(a) {}
  afterStep(dt) {}
  onMatchEnd(winner) {
    // Ein Bot sagt "gg" (Sieger- oder Verlierer-Spruch)
    const talker = this.actors.find(a => a.isBot);
    if (!talker) return;
    this._chatGlobalT = -9; talker._chatT = -99;
    const won = this.teamMode ? talker.team === winner : talker === winner;
    this._forceChat = true;
    this.botChat(talker, won ? 'win' : 'lose');
    this._forceChat = false;
  }
  /** Online-Client: Schaden wird dem Server gemeldet, nicht selbst angewendet */
  remoteDamage(victim, attacker, amount, causeId, hit) { return null; }
  remoteWorldDamage(col, dmg) {}
  remoteInteract(actor, ia) {}
  remoteAirstrike(actor, eye, dir) {}

  /** Muendungsposition (Client: Ego-Waffe / Modell; hier: Auge + Blickrichtung) */
  muzzleWorld(actor, out) {
    const d = actor.lookDir(this._v4);
    out.set(actor.pos.x + d.x * 0.6, actor.pos.y + actor.eyeHeight() - 0.15 + d.y * 0.6, actor.pos.z + d.z * 0.6);
    return out;
  }

  actorById(id) {
    const list = this.actors;
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  teamName(team) {
    const m = this.modeCtl;
    if (m && m.teamNames && m.teamNames[team]) return m.teamNames[team];
    return TEAM_NAME[team] || String(team).toUpperCase();
  }

  /** Skin-Id fuer eine Waffe eines Akteurs */
  skinFor(actor, weapon) {
    const w = weapon || actor.weapon;
    return (actor.skins && actor.skins[w.id]) || 'default';
  }
  stickerFor(actor, weapon) {
    const w = weapon || actor.weapon;
    return (actor.stickers && actor.stickers[w.id]) || 'none';
  }

  /** Bot-Chat mit Abklingzeit pro Bot und global */
  botChat(bot, kind) {
    if (!bot || !bot.isBot || (!this.running && !this._forceChat)) return;
    const now = this.time;
    if (!this._forceChat) {
      if (now - (this._chatGlobalT || -9) < 2.2) return;
      if (now - (bot._chatT || -99) < 10) return;
    }
    const list = CHAT[kind];
    if (!list) return;
    const chance = kind === 'start' ? 0.35 : kind === 'killed' ? 0.4 : kind === 'help' || kind === 'flag' ? 0.85 : kind === 'welcome' ? 0.7 : 0.5;
    if (!this._forceChat && Math.random() > chance) return;
    this._chatGlobalT = now; bot._chatT = now;
    this.emit({ t: 'chat', a: bot.id, text: pick(list) });
  }

  // --------------------------------------------------------
  // Match aufsetzen
  // --------------------------------------------------------
  /** Karte, Welt, Pickups; Akteure legt createActors() an */
  setupMatch(cfg) {
    const training = !!cfg.training;
    this._matchId++;
    this._chatGlobalT = -9;
    this.mode = training ? 'training' : (MODE_BY_ID[cfg.mode] ? cfg.mode : 'tdm');
    this.teamMode = !training && !!MODE_BY_ID[this.mode].team;
    this.scoreLimit = cfg.scoreLimit || 40;
    this.timeLimit = (cfg.timeLimit || 10) * 60;
    this.timeLeft = this.timeLimit;
    this.difficulty = clamp(cfg.difficulty | 0, 0, 3);
    this.over = false;
    this.winner = null;
    this.time = 0;
    this.scores.red = 0;
    this.scores.blue = 0;
    this.airstrikes = [];
    this.pendingDestr = [];
    this.projectiles = [];
    this.pendingMelee = [];
    this.drops = [];
    this.actors = [];
    this.mapId = training ? 'range' : (cfg.map || 'sandstorm');
    this.weatherId = training ? 'clear' : (cfg.weather || 'clear');
    const wx = applyWeather(buildMap(this.mapId), this.weatherId);
    this.mapDef = wx.map;
    this.weather = wx;
    this.world = this.createWorld(wx.map);
    if (!this.online) {
      this.world.onDestrChange = (c, dead) => this.emit({ t: dead ? 'destr' : 'restore', i: c._d, k: c.destr.type, x: c.cx, y: c.cy, z: c.cz });
    }
    this.jumpPads = wx.map.jumpPads || [];
    this.ziplines = wx.map.ziplines || [];
    this.pickups = (wx.map.pickups || []).map((p, i) => this._makePickup(p, i));
  }

  _makePickup(p, i) {
    return { i, x: p.x, y: p.y, z: p.z, type: p.type, active: true, respawn: 0 };
  }

  /** Team mit weniger Mitgliedern (FFA: eindeutiger Name) */
  pickTeam() {
    if (!this.teamMode) return 'ffa';
    let red = 0, blue = 0;
    for (const a of this.actors) { if (a.team === 'red') red++; else if (a.team === 'blue') blue++; }
    return red <= blue ? 'red' : 'blue';
  }

  /** Bots anlegen (Namen eindeutig, zufaellige Klassen) */
  addBots(count) {
    const names = makeBotNames(count, this.actors.map(a => a.name));
    const classIds = CLASSES.map(c => c.id);
    const out = [];
    for (let i = 0; i < count; i++) {
      const bot = this.makeBot({ name: names[i], team: this.pickTeam(), classId: pick(classIds), difficulty: this._botDifficulty() });
      if (!this.teamMode) bot.team = 'ffa' + bot.id;
      this.actors.push(bot);
      out.push(bot);
    }
    return out;
  }

  _botDifficulty() {
    const base = this.difficulty;
    const r = Math.random();
    if (r < 0.2) return clamp(base - 1, 0, 3);
    if (r > 0.85) return clamp(base + 1, 0, 3);
    return base;
  }

  /** Modus anlegen und Akteure vorbereiten (nach createActors) */
  setupMode() {
    this.modeCtl = this.mode === 'training' ? null : createMode(this.mode, this, this.mapDef, this.scoreLimit, this.timeLimit);
    if (this.modeCtl && this.modeCtl.setupActor) for (const a of this.actors) this.modeCtl.setupActor(a);
  }

  cleanup() {
    this.running = false;
    if (this.modeCtl) { this.modeCtl.dispose(); this.modeCtl = null; }
    this.airstrikes = [];
    this.pendingDestr = [];
    this.ziplines = [];
    this.drops = [];
    this.actors = [];
    this.projectiles = [];
    this.pendingMelee = [];
    this.pickups = [];
    if (this.world) { this.world.dispose(); this.world = null; }
    this._dmgAcc.clear();
  }

  // --------------------------------------------------------
  sameTeam(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (!this.teamMode) return false;
    return a.team === b.team;
  }

  enemySpawnsFor(actor) {
    const m = this.world.map;
    if (!this.teamMode) return m.spawnsFfa;
    return actor.team === 'red' ? m.spawnsBlue : m.spawnsRed;
  }

  autoReloadFor(actor) { return actor.isBot ? true : this.rules.autoReload; }

  // --------------------------------------------------------
  // Spawn / Respawn
  // --------------------------------------------------------
  spawnPointsFor(actor) {
    const m = this.world.map;
    if (this.modeCtl && this.modeCtl.spawnPointsFor) return this.modeCtl.spawnPointsFor(actor);
    if (!this.teamMode) return m.spawnsFfa;
    const list = actor.team === 'red' ? m.spawnsRed : m.spawnsBlue;
    return list.length ? list : m.spawnsFfa;
  }

  /** Spawnpunkt waehlen: weit weg von Gegnern, nahe bei Freunden, frei */
  findSpawn(actor) {
    const points = this.spawnPointsFor(actor);
    let best = points[0], bestScore = -Infinity;
    for (const p of points) {
      let score = Math.random() * 12;
      let minEnemy = Infinity;
      for (const o of this.actors) {
        if (o === actor || !o.alive) continue;
        const d = Math.hypot(o.pos.x - p.x, o.pos.z - p.z);
        if (this.sameTeam(o, actor)) { score += clamp(20 - d, 0, 12) * 0.25; }
        else minEnemy = Math.min(minEnemy, d);
      }
      if (minEnemy < 22) score -= (22 - minEnemy) * 6;
      else score += Math.min(minEnemy, 60) * 0.35;
      if (score > bestScore) { bestScore = score; best = p; }
    }

    let sx = best.x, sz = best.z;
    let sy = this.world.groundAt(sx, sz, 60) + 0.05;
    if (!this.world.isFree(sx, sy, sz, actor.radius, actor.height)) {
      const R = [1.2, 2.4, 3.6, 5];
      let found = false;
      for (const r of R) {
        for (let a = 0; a < 8 && !found; a++) {
          const ang = (a / 8) * Math.PI * 2;
          const tx = best.x + Math.cos(ang) * r;
          const tz = best.z + Math.sin(ang) * r;
          const ty = this.world.groundAt(tx, tz, 60) + 0.05;
          if (this.world.isFree(tx, ty, tz, actor.radius, actor.height)) {
            sx = tx; sz = tz; sy = ty; found = true;
          }
        }
        if (found) break;
      }
    }
    return { x: sx, y: sy, z: sz, yaw: best.yaw || 0 };
  }

  respawn(actor, initial) {
    if (actor.pendingClassId) {
      actor.setClass(actor.pendingClassId);
      actor.pendingClassId = null;
    }
    if (this.modeCtl && this.modeCtl.beforeRespawn) this.modeCtl.beforeRespawn(actor);
    const pt = this.findSpawn(actor);
    actor.spawn(pt);
    if (this.training && actor.isLocal) {
      for (const s of actor.slots) if (s.w.mag !== Infinity) s.reserve = 9999;
    }
    this.emit({ t: 'spawn', a: actor.id, x: r2(pt.x), y: r2(pt.y), z: r2(pt.z), yaw: Math.round(pt.yaw * 1000) / 1000, cls: actor.classDef.id, init: !!initial });
  }

  // --------------------------------------------------------
  // Waffenwirkung
  // --------------------------------------------------------
  fireWeapon(actor, heavy, power) {
    const w = actor.weapon;
    // Schallgedaempft: Bots hoeren den Schuss nur ganz kurz (0.3 s statt 1.2 s Fenster)
    actor.lastLoudTime = w.suppressed ? this.time - 0.9 : this.time;
    const pw = power === undefined ? 1 : power;

    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);
    if (actor.isBot && actor.onShotFired) actor.onShotFired(w);

    if (w.melee) {
      const h = heavy && w.heavy ? w.heavy : null;
      const def = h ? Object.assign({ id: w.id, headMult: w.headMult, knockback: w.knockback }, h) : w;
      const swingTime = def.swingTime || 0.32;
      const delay = swingTime * (h ? (h.hitAt || 0.45) : 0.3);
      this.pendingMelee.push({ actor, w: def, t: delay, kind: w.hold, heavy: !!h });
      const lunge = h ? h.lunge : w.lunge;
      if (lunge) this._meleeLunge(actor, (def.meleeRange || 3.4) * 1.8, lunge);
      this.emit({ t: 'swing', a: actor.id, w: w.id, k: w.hold, h: !!h, st: swingTime, sw: h ? h.swing : w.swing });
      return;
    }

    actor.lastShotTime = this.time;
    if (this.training && actor.isLocal) this.training.onShot();

    const ev = { t: 'shot', a: actor.id, w: w.id, p: r2(pw), h: !!heavy, o: [r2(eye.x), r2(eye.y), r2(eye.z)], d: [r2(dir.x), r2(dir.y), r2(dir.z)], e: null, f: !!w.flame };

    if (w.projectile) {
      this.emit(ev);
      if (this.online) return;             // der Server erzeugt das Projektil
      this.spawnProjectile(actor, w, this.muzzleWorld(actor, this._muzzle), dir, w.projectile, pw);
      return;
    }

    const spread = actor.currentSpread();
    const pellets = w.pellets || 1;
    let anyHit = false, hitDist = 0, trainingHit = false;
    const acc = this._dmgAcc;
    acc.clear();
    const ends = w.flame ? null : [];

    for (let i = 0; i < pellets; i++) {
      const d = this._spreadDir(dir, spread, this._v3);
      const r = this._hitscan(actor, eye, d, w, acc, !!w.flame);
      if (r.actorHit) {
        anyHit = true;
        if (r.kind === 4) trainingHit = true;
        hitDist = Math.hypot(r.x - eye.x, r.y - eye.y, r.z - eye.z);
        // Brandschaden: brennt nach dem Treffer weiter
        if (w.burn && r.victim && r.victim.alive && !this.online) {
          r.victim.burnT = w.burn.time;
          r.victim.burnFrom = actor;
          r.victim.burnDps = w.burn.dps;
        }
      }
      if (ends) ends.push([r2(r.x), r2(r.y), r2(r.z), r.kind, r.nx, r.ny, r.nz]);
    }
    ev.e = ends;
    this.emit(ev);

    // Zusammenfassung fuer den Schuetzen (Popups, Hitmarker) - nur lokal relevant
    if (!this.server) {
      const hits = [];
      acc.forEach((v, victim) => hits.push([victim.id, Math.round(v.dmg), r2(v.x), r2(v.y), r2(v.z), v.head ? 1 : 0, v.killed ? 1 : 0]));
      if (hits.length || anyHit) this.emit({ t: 'hits', a: actor.id, v: hits, d: r1(hitDist), tr: trainingHit, loc: true });
    }
    acc.clear();
  }

  _spreadDir(dir, spread, out) {
    out.copy(dir);
    if (spread > 0.00001) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const up = Math.abs(dir.y) > 0.95 ? this._tmpUpX || (this._tmpUpX = new THREE.Vector3(1, 0, 0))
                                        : this._tmpUpY || (this._tmpUpY = new THREE.Vector3(0, 1, 0));
      const rx = (this._sx || (this._sx = new THREE.Vector3())).crossVectors(dir, up).normalize();
      const ry = (this._sy || (this._sy = new THREE.Vector3())).crossVectors(rx, dir).normalize();
      out.addScaledVector(rx, Math.cos(a) * r);
      out.addScaledVector(ry, Math.sin(a) * r);
      out.normalize();
    }
    return out;
  }

  /**
   * Hitscan mit Durchschlag. Rueckgabe (wiederverwendetes Objekt):
   * {x,y,z, kind: 0 Luft | 1 Wand | 2 Koerper | 3 Kopf | 4 Zielscheibe, nx,ny,nz, actorHit, head, killed, victim}
   */
  _hitscan(shooter, eye, dir, w, acc, quiet) {
    let remaining = w.pierce || 0;
    let ox = eye.x, oy = eye.y, oz = eye.z;
    let maxDist = w.range;
    let travelled = 0;
    const ignored = shooter._pierceIgnore || (shooter._pierceIgnore = new Set());
    ignored.clear();
    ignored.add(shooter);

    const out = this._hsOut || (this._hsOut = { x: 0, y: 0, z: 0, kind: 0, nx: 0, ny: 0, nz: 0, actorHit: false, head: false, killed: false, victim: null });
    out.actorHit = false; out.head = false; out.killed = false; out.victim = null; out.kind = 0; out.nx = out.ny = out.nz = 0;

    for (let pass = 0; pass <= remaining; pass++) {
      const wallHit = this.world.raycast(ox, oy, oz, dir.x, dir.y, dir.z, maxDist);
      const wallT = wallHit ? wallHit.t : maxDist;

      let bestT = wallT, bestActor = null, bestZone = null;
      for (const a of this.actors) {
        if (!a.alive || ignored.has(a)) continue;
        if (this.sameTeam(a, shooter)) continue;
        if (a.spawnProtect > 0) continue;
        const h = a.rayHit(ox, oy, oz, dir.x, dir.y, dir.z, bestT, 0);
        if (h && h.t >= 0 && h.t < bestT) { bestT = h.t; bestActor = a; bestZone = h.zone; }
      }

      // Trainings-Zielscheiben
      if (this.training && shooter.isLocal) {
        const th = this.training.rayHit(ox, oy, oz, dir.x, dir.y, dir.z, bestT);
        if (th) {
          const hx = ox + dir.x * th.t, hy = oy + dir.y * th.t, hz = oz + dir.z * th.t;
          out.x = hx; out.y = hy; out.z = hz;
          out.actorHit = true; out.head = false; out.killed = false; out.kind = 4;
          this.training.hit(th.target, hx, hy, hz);
          break;
        }
      }

      if (bestActor) {
        const hx = ox + dir.x * bestT, hy = oy + dir.y * bestT, hz = oz + dir.z * bestT;
        const dist = travelled + bestT;
        const head = bestZone === 'head';
        const mult = head ? w.headMult : bestZone === 'legs' ? w.legMult : 1.0;
        const dmg = w.damage * mult * falloff(w, dist);

        const res = this.damageActor(bestActor, shooter, dmg, w.id, {
          x: hx, y: hy, z: hz, dirx: dir.x, diry: dir.y, dirz: dir.z, head, legs: bestZone === 'legs', noPopup: !!acc, quiet, dist,
        });

        out.x = hx; out.y = hy; out.z = hz;
        out.actorHit = true;
        out.victim = bestActor;
        out.kind = head ? 3 : 2;
        if (head) out.head = true;
        if (res && res.killed) out.killed = true;
        if (acc && res) {
          let e = acc.get(bestActor);
          if (!e) { e = { dmg: 0, x: hx, y: hy, z: hz, head: false, killed: false }; acc.set(bestActor, e); }
          e.dmg += res.damage;
          if (head) e.head = true;
          if (res.killed) e.killed = true;
        }

        ignored.add(bestActor);
        travelled += bestT + 0.05;
        maxDist -= bestT + 0.05;
        ox = hx + dir.x * 0.05; oy = hy + dir.y * 0.05; oz = hz + dir.z * 0.05;
        if (maxDist <= 0.1) break;
        continue;
      }

      if (wallHit) {
        out.x = wallHit.x; out.y = wallHit.y; out.z = wallHit.z;
        out.kind = 1; out.nx = wallHit.nx; out.ny = wallHit.ny; out.nz = wallHit.nz;
        this._damageWorld(wallHit, w.damage * (w.pellets > 1 ? 1 : 1.5), shooter);
      } else {
        out.x = ox + dir.x * maxDist;
        out.y = oy + dir.y * maxDist;
        out.z = oz + dir.z * maxDist;
        out.kind = 0;
      }
      break;
    }
    return out;
  }

  // --------------------------------------------------------
  // Zerstoerbare Objekte
  // --------------------------------------------------------
  /** Treffer an der Welt: Kisten, Faesser, Glas beschaedigen */
  _damageWorld(hit, dmg, attacker) {
    if (!hit || !hit.col || !hit.col.destr || !this.world) return false;
    const c = hit.col;
    if (this.online) { this.remoteWorldDamage(c, dmg); return false; }
    if (!this.world.damageDestructible(c, dmg)) return false;
    this._destroyed(c, attacker);
    return true;
  }

  /** Nach der Zerstoerung: Faesser explodieren (Effekte kommen ueber das destr-Ereignis) */
  _destroyed(c, attacker) {
    const d = c.destr;
    if (d.type === 'barrel') {
      const cx = (c.minx + c.maxx) / 2, cy = (c.miny + c.maxy) / 2, cz = (c.minz + c.maxz) / 2;
      this.explode(cx, cy + 0.3, cz, BARREL_EX, attacker || null, null, null, 'barrel');
    }
  }

  _updatePendingDestr(dt) {
    for (let i = this.pendingDestr.length - 1; i >= 0; i--) {
      const p = this.pendingDestr[i];
      p.t -= dt;
      if (p.t > 0) continue;
      this.pendingDestr.splice(i, 1);
      if (p.c.dead) continue;
      if (this.world.damageDestructible(p.c, p.dmg)) this._destroyed(p.c, p.owner);
    }
  }

  // --------------------------------------------------------
  // Brandschaden
  // --------------------------------------------------------
  _updateBurning(dt) {
    for (const a of this.actors) {
      if (!a.alive || a.burnT <= 0) continue;
      a.burnT -= dt;
      a.burnTick -= dt;
      if (a.burnTick <= 0) {
        a.burnTick = 0.25;
        const from = a.burnFrom;
        this.damageActor(a, from && from !== a ? from : null, (a.burnDps || 8) * 0.25, 'flame', {
          x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z, dirx: 0, diry: 0.4, dirz: 0, head: false, noPopup: Math.random() < 0.5, strength: 4, quiet: true,
        });
      }
      if (a.burnT <= 0) { a.burnT = 0; a.burnFrom = null; }
    }
  }

  // --------------------------------------------------------
  // Killstreaks
  // --------------------------------------------------------
  _onStreak(a) {
    if (this.rules.killstreaks === false) return;
    const reward = STREAK_REWARDS[a.streak];
    if (!reward) return;
    if (reward === 'uav') a.uavUntil = this.time + UAV_TIME;
    else if (reward === 'shield') { a.shield = SHIELD_AMOUNT; a.shieldT = SHIELD_TIME; }
    else if (reward === 'airstrike') a.airstrikes++;
    this.emit({ t: 'streak', a: a.id, r: reward });
  }

  /** Luftschlag auf den Blickpunkt (Rueckgabe: ausgeloest?) */
  callAirstrike(actor, eyeIn, dirIn) {
    const eye = eyeIn || actor.eyePos(this._v1);
    const dir = dirIn || actor.lookDir(this._v2);
    if (this.online) { this.remoteAirstrike(actor, eye, dir); return true; }
    const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 160);
    let x, y, z;
    if (hit) { x = hit.x; y = hit.y; z = hit.z; }
    else { x = eye.x + dir.x * 60; z = eye.z + dir.z * 60; y = this.world.groundAt(x, z, 60); }
    // Linie quer zur Blickrichtung
    const l = Math.max(0.001, Math.hypot(dir.x, dir.z));
    const px = -dir.z / l, pz = dir.x / l;
    this.airstrikes.push({ x, y, z, px, pz, owner: actor, t: 1.8, next: 0, i: 0 });
    this.emit({ t: 'strike', a: actor.id, x: r2(x), y: r2(y), z: r2(z), px: r2(px), pz: r2(pz) });
    return true;
  }

  _updateAirstrikes(dt) {
    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const s = this.airstrikes[i];
      s.t -= dt;
      if (s.t > 0) continue;
      // Sechs Einschlaege entlang der Linie, 0.1 s Abstand
      s.next -= dt;
      if (s.next <= 0) {
        s.next = 0.1;
        const k = s.i - 2.5;
        const ex = s.x + s.px * k * 4.5, ez = s.z + s.pz * k * 4.5;
        const ey = this.world.groundAt(ex, ez, s.y + 30) + 0.6;
        this.explode(ex, ey, ez, AIRSTRIKE_EX, s.owner, null, null, 'airstrike');
        s.i++;
        if (s.i >= 6) this.airstrikes.splice(i, 1);
      }
    }
  }

  // --------------------------------------------------------
  // Nahkampf
  // --------------------------------------------------------
  _meleeLunge(actor, range, power) {
    let best = null, bestD = Infinity;
    const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
    for (const a of this.actors) {
      if (a === actor || !a.alive || this.sameTeam(a, actor)) continue;
      const dx = a.pos.x - actor.pos.x, dz = a.pos.z - actor.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range || d < 0.3) continue;
      if ((dx * fx + dz * fz) / d < 0.6) continue;
      if (Math.abs(a.pos.y - actor.pos.y) > 3) continue;
      if (d < bestD) { bestD = d; best = a; }
    }
    if (!best) return;
    const dx = best.pos.x - actor.pos.x, dz = best.pos.z - actor.pos.z;
    const d = Math.max(0.3, Math.hypot(dx, dz));
    const push = Math.min(power, Math.max(0, d - 1.6) * 4);
    if (push <= 0) return;
    actor.vel.x += (dx / d) * push;
    actor.vel.z += (dz / d) * push;
    if (actor.grounded) { actor.vel.y = Math.max(actor.vel.y, 1.2); actor.grounded = false; actor.coyote = 0; }
  }

  /** Stoss auf einen Akteur: Netz-Spieler bekommen ihn als Ereignis (ihr Client bewegt sich selbst) */
  pushActor(a, vx, vy, vz) {
    if (a.isNet) { this.emit({ t: 'push', a: a.id, v: [r2(vx), r2(vy), r2(vz)], to: a.id }); return; }
    a.vel.x += vx; a.vel.y += vy; a.vel.z += vz;
    a.grounded = false;
    a.coyote = 0;
  }

  meleeAttack(actor, w, kind, heavy) {
    if (!actor.alive) return;
    const range = w.meleeRange || 3.4;
    const eye = actor.eyePos(this._v1);
    let hit = null, bestD = Infinity, bestZone = null;
    const hx = this._v4;

    for (let i = 0; i < MELEE_RAYS.length; i++) {
      const yaw = actor.yaw + MELEE_RAYS[i][0];
      const pitch = clamp(actor.pitch + MELEE_RAYS[i][1], -1.5, 1.5);
      const cp = Math.cos(pitch);
      const dx = -Math.sin(yaw) * cp, dy = Math.sin(pitch), dz = -Math.cos(yaw) * cp;
      const wall = this.world.raycast(eye.x, eye.y, eye.z, dx, dy, dz, range);
      const maxT = wall ? wall.t : range;
      for (const a of this.actors) {
        if (a === actor || !a.alive || this.sameTeam(a, actor) || a.spawnProtect > 0) continue;
        const h = a.rayHit(eye.x, eye.y, eye.z, dx, dy, dz, maxT, 0.22);
        if (h && h.t < bestD) {
          bestD = h.t; hit = a; bestZone = h.zone;
          hx.set(eye.x + dx * h.t, eye.y + dy * h.t, eye.z + dz * h.t);
        }
      }
    }
    if (!hit) {
      const dir = actor.lookDir(this._v2);
      for (const a of this.actors) {
        if (a === actor || !a.alive || this.sameTeam(a, actor) || a.spawnProtect > 0) continue;
        const ddx = a.pos.x - actor.pos.x, ddz = a.pos.z - actor.pos.z;
        const ddy = (a.pos.y + a.height * 0.5) - eye.y;
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (d > range * 0.55) continue;
        const l = Math.max(0.001, d);
        const dot = (ddx / l) * dir.x + (ddz / l) * dir.z;
        if (dot < 0.2) continue;
        if (d < bestD) { bestD = d; hit = a; bestZone = 'body'; hx.set(a.pos.x, a.pos.y + a.height * 0.6, a.pos.z); }
      }
    }

    // Kisten / Faesser / Glas mit dem Nahkampf
    if (!hit) {
      const dir = actor.lookDir(this._v2);
      const wh = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, range + 0.3);
      if (wh && wh.col && wh.col.destr) {
        this._damageWorld(wh, heavy ? 90 : 45, actor);
        this.emit({ t: 'mwall', a: actor.id, x: r2(wh.x), y: r2(wh.y), z: r2(wh.z), n: [wh.nx, wh.ny, wh.nz], h: !!heavy, loc: true });
      }
    }

    // Trainings-Zielscheiben auch mit Nahkampf
    if (!hit && this.training && actor.isLocal) {
      const dir = actor.lookDir(this._v2);
      const th = this.training.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, range + 0.5);
      if (th) {
        this.training.hit(th.target, eye.x + dir.x * th.t, eye.y + dir.y * th.t, eye.z + dir.z * th.t);
        this.emit({ t: 'mhit', a: actor.id, v: 0, x: 0, y: 0, z: 0, d: [dir.x, dir.y, dir.z], h: !!heavy, k: kind, dist: th.t, head: false, killed: false, tr: true, loc: true });
      }
    }

    if (hit) {
      const dir = actor.lookDir(this._v2);
      const fx = -Math.sin(hit.yaw), fz = -Math.cos(hit.yaw);
      const facing = fx * dir.x + fz * dir.z;
      const back = facing > 0.45;
      const head = bestZone === 'head';
      let dmg = w.damage * (back ? (w.meleeBackstab || 1) : 1);
      if (head && !back) dmg *= (w.headMult || 1);
      const res = this.damageActor(hit, actor, dmg, w.id, {
        x: hx.x, y: hx.y, z: hx.z,
        dirx: dir.x, diry: dir.y, dirz: dir.z, head, strength: heavy ? 12 : 8, quiet: true, dist: bestD, back, heavy: !!heavy,
      });
      const kb = (w.knockback || 4) * (heavy ? 1.6 : 1);
      if (hit.alive && !this.online) this.pushActor(hit, dir.x * kb, kb * 0.35, dir.z * kb);
      this.emit({
        t: 'mhit', a: actor.id, v: hit.id, x: r2(hx.x), y: r2(hx.y), z: r2(hx.z), d: [r2(dir.x), r2(dir.y), r2(dir.z)],
        h: !!heavy, k: kind, dist: r1(bestD), head: back || head, killed: !!(res && res.killed), n: Math.round(dmg),
      });
    }
  }

  quickMelee(actor) {
    this.emit({ t: 'swing', a: actor.id, w: 'melee', k: 'bash', h: false, st: 0.34, sw: 'bash' });
    this.pendingMelee.push({
      actor, t: 0.1, kind: 'bash', heavy: false,
      w: { damage: 45, meleeRange: 3.2, meleeArc: 0.5, meleeBackstab: 2, headMult: 1, id: 'melee', knockback: 3 },
    });
  }

  _updatePendingMelee(dt) {
    for (let i = this.pendingMelee.length - 1; i >= 0; i--) {
      const m = this.pendingMelee[i];
      m.t -= dt;
      if (m.t <= 0) {
        this.pendingMelee.splice(i, 1);
        if (m.actor.alive) this.meleeAttack(m.actor, m.w, m.kind, m.heavy);
      }
    }
  }

  // --------------------------------------------------------
  // Projektile
  // --------------------------------------------------------
  spawnProjectile(actor, weapon, origin, dir, def, power) {
    const spread = actor.currentSpread();
    const d = this._spreadDir(dir, spread, this._v4);
    const pw = power === undefined ? 1 : power;
    const speed = def.speed * (weapon.charge ? lerp(0.5, 1, pw) : 1);

    const p = {
      id: this._nextProjId++,
      x: origin.x, y: origin.y, z: origin.z,
      vx: d.x * speed + actor.vel.x * 0.25,
      vy: d.y * speed + actor.vel.y * 0.25,
      vz: d.z * speed + actor.vel.z * 0.25,
      def, weapon, owner: actor,
      life: def.fuse !== undefined ? def.fuse : 6,
      isGrenade: def.fuse !== undefined,
      dmgMult: weapon.charge ? lerp(0.35, 1, pw) : 1,
      spin: def.knife ? 0 : null,
    };
    this.projectiles.push(p);
    return p;
  }

  throwGrenade(actor, originIn, dirIn) {
    const w = WEAPONS.grenade;
    let origin, d;
    if (originIn) { origin = this._v3.set(originIn.x, originIn.y, originIn.z); d = this._v4.set(dirIn.x, dirIn.y, dirIn.z).normalize(); }
    else {
      const eye = actor.eyePos(this._v1);
      const dir = actor.lookDir(this._v2);
      origin = this._v3.set(eye.x + dir.x * 0.7, eye.y + dir.y * 0.7 + 0.1, eye.z + dir.z * 0.7);
      d = this._v4.set(dir.x, dir.y + 0.22, dir.z).normalize();
    }
    this.emit({ t: 'throw', a: actor.id, o: [r2(origin.x), r2(origin.y), r2(origin.z)], d: [r2(d.x), r2(d.y), r2(d.z)] });
    if (this.online) return;                // der Server wirft
    this.spawnProjectile(actor, w, origin, d, w.projectile);
  }

  updateProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;

      const def = p.def;
      p.vy -= (def.gravity || 0) * dt;

      let steps = 1;
      const speed = Math.hypot(p.vx, p.vy, p.vz);
      if (speed * dt > 1.2) steps = Math.min(6, Math.ceil(speed * dt / 1.2));
      const sdt = dt / steps;

      let exploded = false;
      for (let s = 0; s < steps && !exploded; s++) {
        const nx = p.x + p.vx * sdt, ny = p.y + p.vy * sdt, nz = p.z + p.vz * sdt;
        const dx = nx - p.x, dy = ny - p.y, dz = nz - p.z;
        const len = Math.hypot(dx, dy, dz);

        if (len > 1e-5) {
          const ux = dx / len, uy = dy / len, uz = dz / len;

          let hitActor = null, hitT = len, hitZone = null;
          for (const a of this.actors) {
            if (a === p.owner || !a.alive) continue;
            if (this.sameTeam(a, p.owner) && !p.isGrenade) continue;
            if (a.spawnProtect > 0) continue;
            const h = a.rayHit(p.x, p.y, p.z, ux, uy, uz, hitT, def.radius);
            if (h && h.t >= 0 && h.t < hitT) { hitT = h.t; hitActor = a; hitZone = h.zone; }
          }

          const wall = this.world.raycast(p.x, p.y, p.z, ux, uy, uz, len);

          // Trainings-Zielscheiben (Raketen, Blaster-Bolzen)
          if (this.training && p.owner && p.owner.isLocal && !p.isGrenade) {
            const th = this.training.rayHit(p.x, p.y, p.z, ux, uy, uz, wall ? Math.min(wall.t, len) : len);
            if (th && (!hitActor || th.t < hitT)) {
              const hx = p.x + ux * th.t, hy = p.y + uy * th.t, hz = p.z + uz * th.t;
              this.training.hit(th.target, hx, hy, hz);
              this._projectileHit(p, hx, hy, hz, ux, uy, uz, null, null);
              exploded = true;
              break;
            }
          }

          if (hitActor && (!wall || hitT < wall.t)) {
            const hx = p.x + ux * hitT, hy = p.y + uy * hitT, hz = p.z + uz * hitT;
            if (p.isGrenade) {
              p.vx *= -0.3; p.vy *= 0.3; p.vz *= -0.3;
              p.x = hx - ux * 0.2; p.y = hy; p.z = hz - uz * 0.2;
            } else {
              this._projectileHit(p, hx, hy, hz, ux, uy, uz, hitActor, hitZone);
              exploded = true;
            }
            break;
          }

          if (wall) {
            const hx = p.x + ux * wall.t, hy = p.y + uy * wall.t, hz = p.z + uz * wall.t;
            if (wall.col && wall.col.destr && !def.explode) this._damageWorld(wall, p.weapon.damage * (p.dmgMult || 1), p.owner);
            if (def.bounce) {
              const dot = p.vx * wall.nx + p.vy * wall.ny + p.vz * wall.nz;
              p.vx = (p.vx - 2 * dot * wall.nx) * def.bounce;
              p.vy = (p.vy - 2 * dot * wall.ny) * def.bounce;
              p.vz = (p.vz - 2 * dot * wall.nz) * def.bounce;
              p.x = hx + wall.nx * 0.12;
              p.y = hy + wall.ny * 0.12;
              p.z = hz + wall.nz * 0.12;
              if (Math.abs(dot) > 2) this.emit({ t: 'bounce', x: r2(hx), y: r2(hy), z: r2(hz) });
              continue;
            }
            this._projectileHit(p, hx, hy, hz, ux, uy, uz, null, null);
            exploded = true;
            break;
          }
        }
        p.x = nx; p.y = ny; p.z = nz;
      }

      if (exploded) { this.projectiles.splice(i, 1); continue; }
      if (p.spin !== null && p.spin !== undefined) p.spin += dt * 18;

      if (p.life <= 0) {
        this._projectileHit(p, p.x, p.y, p.z, 0, 1, 0, null, null);
        this.projectiles.splice(i, 1);
      }
    }
  }

  _projectileHit(p, x, y, z, ux, uy, uz, directActor, zone) {
    const def = p.def;
    let killed = false;
    if (directActor && !def.explode) {
      const head = zone === 'head';
      const w = p.weapon;
      const dmg = w.damage * (head ? w.headMult : 1) * (p.dmgMult || 1);
      const res = this.damageActor(directActor, p.owner, dmg, w.id, {
        x, y, z, dirx: ux, diry: uy, dirz: uz, head, strength: def.arrow ? 9 : 7, quiet: true,
        dist: p.owner ? Math.hypot(x - p.owner.pos.x, z - p.owner.pos.z) : 0,
      });
      killed = !!(res && res.killed);
    }
    if (def.explode) {
      this.explode(x, y, z, def.explode, p.owner, p.weapon, directActor);
    } else {
      this.emit({
        t: 'pimp', x: r2(x), y: r2(y), z: r2(z), d: [r2(ux), r2(uy), r2(uz)], c: def.color, w: p.weapon.id,
        kn: def.knife ? 1 : 0, ar: def.arrow ? 1 : 0, v: directActor ? directActor.id : 0, a: p.owner ? p.owner.id : 0,
        head: zone === 'head', killed,
      });
    }
  }

  /** ex: {radius, damage, minMult, force, selfMult}; cause: Waffen-Id fuer den Killfeed */
  explode(x, y, z, ex, owner, weapon, directActor, cause) {
    if (this.online) return;
    this.emit({ t: 'explode', x: r2(x), y: r2(y), z: r2(z), r: ex.radius, c: cause || (weapon ? weapon.id : 'explosion') });

    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.spawnProtect > 0 && a !== owner) continue;
      const cx = a.pos.x, cy = a.pos.y + a.height * 0.5, cz = a.pos.z;
      const dist = Math.hypot(cx - x, cy - y, cz - z);
      if (dist > ex.radius) continue;
      if (dist > 1.2 && !this.world.losClear(x, y, z, cx, cy, cz)) continue;

      const isSelf = a === owner;
      const isFriend = owner && this.sameTeam(a, owner) && !isSelf;
      if (isFriend && cause !== 'barrel') continue;

      const f = clamp(1 - dist / ex.radius, 0, 1);
      let dmg = ex.damage * lerp(ex.minMult, 1, f * f);
      if (directActor === a) dmg = Math.max(dmg, ex.damage * 0.85);
      if (isSelf) dmg *= ex.selfMult;

      const l = Math.max(0.6, dist);
      const push = ex.force * f * (isSelf ? 1.5 : 1);
      this.pushActor(a, ((cx - x) / l) * push, ((cy - y) / l) * push + push * 0.35, ((cz - z) / l) * push);

      // Fass-Explosionen treffen auch Teamkollegen des Schuetzen (ohne Gutschrift)
      const attacker = isFriend ? null : owner;
      this.damageActor(a, attacker, dmg, cause || (weapon ? weapon.id : 'explosion'), {
        x: cx, y: cy, z: cz, dirx: (cx - x) / l, diry: (cy - y) / l, dirz: (cz - z) / l, head: false,
        strength: 8 + push * 0.6, quiet: true,
      });
    }

    // Kettenreaktion: Faesser und Kisten im Umkreis (leicht verzoegert)
    const near = this.world.destructiblesNear(x, y, z, ex.radius * 0.85, this._destrList);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (this.pendingDestr.some(p => p.c === c)) continue;
      this.pendingDestr.push({ c, dmg: 250, t: 0.1 + rand(0, 0.2), owner });
    }
  }

  // --------------------------------------------------------
  // Schaden & Tod
  // --------------------------------------------------------
  damageActor(victim, attacker, amount, causeId, hit) {
    if (!victim.alive || this.over) return null;
    if (attacker && attacker !== victim) {
      if (this.sameTeam(attacker, victim)) return null;
      if (victim.spawnProtect > 0) return null;
    }
    amount = Math.max(0, amount);
    if (amount <= 0) return null;
    if (this.online) return this.remoteDamage(victim, attacker, amount, causeId, hit);

    const before = victim.hp + victim.armor;
    const died = victim.applyDamage(amount);
    const actualDmg = before - Math.max(0, victim.hp) - Math.max(0, victim.armor);

    victim.lastDamageFrom = attacker;
    victim.lastDamageTime = this.time;
    victim.lastDamageCause = causeId;
    if (attacker && attacker !== victim) attacker.damageDealt += actualDmg;

    if (victim.isBot && victim.hp > 0 && attacker && attacker !== victim) {
      if (!victim.target || Math.random() < 0.6) {
        victim.target = attacker;
        victim.targetSeenAt = this.time;
        victim.targetLastPos.x = attacker.pos.x;
        victim.targetLastPos.y = attacker.pos.y;
        victim.targetLastPos.z = attacker.pos.z;
      }
    }

    const hx = hit ? hit.x : victim.pos.x, hy = hit ? hit.y : victim.pos.y + 1.2, hz = hit ? hit.z : victim.pos.z;
    this.emit({
      t: 'dmg', v: victim.id, a: attacker ? attacker.id : 0, n: Math.round(actualDmg), h: !!(hit && hit.head), c: causeId,
      x: r2(hx), y: r2(hy), z: r2(hz), d: hit ? [r2(hit.dirx), r2(hit.diry), r2(hit.dirz)] : [0, 0.3, 1],
      q: !!(hit && hit.noPopup), s: hit && hit.strength ? hit.strength : 0, k: died,
    });

    if (died) this.handleKill(victim, attacker, causeId, hit);
    return { killed: died, damage: actualDmg };
  }

  handleKill(victim, attacker, causeId, hit) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.intent.fire = false;
    victim.sliding = false;
    victim.wallrun = null;
    victim.burnT = 0;
    victim.chargeT = 0;
    victim.spinT = 0;
    if (victim.grapple) victim._releaseGrapple(false);
    if (victim.zip) victim._detachZip(false);
    if (victim.onDeath) victim.onDeath(attacker);
    if (this.modeCtl) this.modeCtl.onDeath(victim, attacker);
    this._dropWeapon(victim);

    const suicide = !attacker || attacker === victim;
    victim.respawnTimer = victim.isBot ? rand(2.2, 4.5) : RESPAWN_HUMAN;
    const noRespawn = !!(this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(victim));
    if (noRespawn) victim.respawnTimer = 99999;

    // Bot-Chat: Mensch getoetet / von Mensch getoetet / Kopfschuss / Serie
    if (!suicide) {
      if (attacker.isBot && !victim.isBot) this.botChat(attacker, hit && hit.head ? 'headshot' : 'kill');
      else if (victim.isBot && !attacker.isBot) this.botChat(victim, 'killed');
      else if (attacker.isBot && attacker.streak === 4) this.botChat(attacker, 'streak');
    }

    // Kill-Effekt des Killers (Konfetti, Feuerwerk ...) am Opfer
    const fx = (!suicide && this.rules.killEffects !== false) ? KILL_EFFECT_BY_ID[attacker.killEffect] : null;
    const fxKind = fx && fx.id !== 'none' ? fx.id : null;
    const icon = !suicide && KILL_ICON_BY_ID[attacker.killIcon] ? KILL_ICON_BY_ID[attacker.killIcon].icon : '';

    let ggWin = false;
    let points = 0;
    if (!suicide) {
      attacker.kills++;
      attacker.streak++;
      attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
      points = 100 + (hit && hit.head ? 50 : 0) + (victim.carrying ? 50 : 0);
      attacker.score += points;
      if (this.teamMode && this.mode === 'tdm') this.scores[attacker.team]++;
      this._onStreak(attacker);
      if (this.modeCtl && this.modeCtl.id === 'gungame') ggWin = this.modeCtl.onKill(victim, attacker, causeId);
      else if (this.modeCtl && this.modeCtl.onKill) this.modeCtl.onKill(victim, attacker, causeId);
    } else {
      victim.score = Math.max(0, victim.score - 50);
      if (this.teamMode && this.mode === 'tdm') this.scores[victim.team] = Math.max(0, this.scores[victim.team] - 1);
    }

    this.emit({
      t: 'kill', v: victim.id, a: suicide ? 0 : attacker.id, c: causeId, h: !!(hit && hit.head), sui: suicide, icon,
      fx: fxKind, hb: !!(fx && fx.hideBody), st: suicide ? 0 : attacker.streak, pts: points,
      hit: { x: r2(victim.pos.x), y: r2(victim.pos.y), z: r2(victim.pos.z), yaw: Math.round(victim.yaw * 1000) / 1000,
        vx: r1(victim.vel.x), vy: r1(victim.vel.y), vz: r1(victim.vel.z),
        dx: hit ? r2(hit.dirx) : 0, dy: hit ? r2(hit.diry) : 0.3, dz: hit ? r2(hit.dirz) : 1, s: (hit && hit.strength) || 8,
        hx: hit ? r2(hit.x) : r2(victim.pos.x), hy: hit ? r2(hit.y) : r2(victim.pos.y + 1.2), hz: hit ? r2(hit.z) : r2(victim.pos.z) },
      rt: noRespawn ? -1 : r1(victim.respawnTimer), ah: suicide ? 0 : Math.round(attacker.hp + attacker.armor),
      sc: [this.scores.red, this.scores.blue], ak: suicide ? 0 : attacker.kills, vd: victim.deaths,
    });

    if (ggWin) { this.endMatch(attacker); return; }
    this._checkMatchEnd();
  }

  _checkMatchEnd() {
    if (this.over) return;
    if (this.mode === 'training') return;
    if (this.mode === 'gungame') return;          // wird ueber den letzten Kill entschieden
    if (!this.teamMode) {
      for (const a of this.actors) {
        if (a.kills >= this.scoreLimit) { this.endMatch(a); return; }
      }
      return;
    }
    if (this.modeCtl && this.modeCtl.winner) {
      const w = this.modeCtl.winner();
      if (w) { this.endMatch(w); return; }
      return;
    }
    if (this.scores.red >= this.scoreLimit) { this.endMatch('red'); return; }
    if (this.scores.blue >= this.scoreLimit) { this.endMatch('blue'); return; }
  }

  /** Rangfolge (FFA / Gun Game): beste zuerst */
  ranking() {
    return this.actors.slice().sort((a, b) => (this.mode === 'gungame' ? b.ggLevel - a.ggLevel : 0) || b.kills - a.kills || b.score - a.score);
  }

  endMatch(winner) {
    if (this.over) return;
    this.over = true;
    this.running = false;
    let w = winner;
    if (!this.teamMode && !(winner && typeof winner === 'object')) w = this.ranking()[0] || null;
    this.winner = w;
    this.emit({ t: 'end', w: w && typeof w === 'object' ? w.id : (w || null), sc: [this.scores.red, this.scores.blue] });
    this.onMatchEnd(w);
  }

  // --------------------------------------------------------
  // Pickups
  // --------------------------------------------------------
  updatePickups(dt) {
    for (const p of this.pickups) {
      if (!p.active) {
        p.respawn -= dt;
        if (p.respawn <= 0) {
          p.active = true;
          this.emit({ t: 'pkon', i: p.i });
        }
        continue;
      }
      for (const a of this.actors) {
        if (!a.alive) continue;
        const dx = a.pos.x - p.x, dz = a.pos.z - p.z;
        const dy = (a.pos.y + a.height * 0.5) - p.y;
        if (dx * dx + dz * dz > 2.6 || Math.abs(dy) > 2.2) continue;

        let used = false;
        if (p.type === 'health' && a.hp < a.maxHp) { a.heal(40); used = true; }
        else if (p.type === 'armor' && a.armor < 50) { a.addArmor(50); used = true; }
        else if (p.type === 'ammo') {
          const s = a.ammo;
          if (a.isNet || s.reserve < s.w.reserve || a.nades < a.maxNades) { a.addAmmo(); used = true; }
        }
        if (used) {
          p.active = false;
          p.respawn = 22;
          this.emit({ t: 'pickup', i: p.i, a: a.id, k: p.type });
          break;
        }
      }
    }
  }

  // --------------------------------------------------------
  // Interaktion, liegende Waffen
  // --------------------------------------------------------
  /** Verfuegbare Interaktion fuer einen Akteur: {type:'zip'|'drop'|'bomb', ...} oder null */
  interactionFor(actor) {
    if (!actor.alive || !this.world) return null;
    if (!actor.zip && actor.zipCooldown <= 0) {
      for (const z of this.ziplines) {
        for (const [end, fromA] of [[z.a, true], [z.b, false]]) {
          const dx = actor.pos.x - end.x, dz = actor.pos.z - end.z;
          if (dx * dx + dz * dz > 2.6 * 2.6) continue;
          if (actor.pos.y < end.y - 3.6 || actor.pos.y > end.y + 0.6) continue;
          return { type: 'zip', z, fromA, label: 'SEILBAHN' };
        }
      }
    }
    for (const d of this.drops) {
      const dx = actor.pos.x - d.x, dz = actor.pos.z - d.z;
      if (dx * dx + dz * dz < 1.9 * 1.9 && Math.abs(actor.pos.y - d.y) < 2.2) return { type: 'drop', d, label: d.w.name.toUpperCase() + ' AUFHEBEN' };
    }
    if (this.modeCtl && this.modeCtl.interactionFor) {
      const ia = this.modeCtl.interactionFor(actor);
      if (ia) return ia;
    }
    return null;
  }

  _processInteractions() {
    for (const a of this.actors) {
      if (!a.intent.interact) continue;
      a.intent.interact = false;
      const ia = this.interactionFor(a);
      if (!ia) continue;
      if (ia.type === 'zip') { a.attachZip(ia.z, ia.fromA); continue; }
      if (this.online) { this.remoteInteract(a, ia); continue; }
      if (ia.type === 'drop') this.pickupDrop(a, ia.d);
      else if (ia.type === 'bomb' && this.modeCtl.interact) this.modeCtl.interact(a, ia);
    }
  }

  /** Beim Tod: Primaerwaffe fallen lassen */
  _dropWeapon(victim) {
    if (!this.rules.dropWeapons || this.training || this.mode === 'gungame') return;
    const s = victim.slots[0];
    if (!s || !s.w || s.w.melee || s.w.mag === Infinity) return;
    if (s.mag <= 0 && s.reserve <= 0) return;
    const y = this.world.groundAt(victim.pos.x, victim.pos.z, victim.pos.y + 1.5);
    const d = {
      id: this._nextDropId++, w: s.w, mag: s.mag, reserve: Math.max(s.reserve, Math.floor(s.w.mag * 1.5)),
      x: r2(victim.pos.x + rand(-0.4, 0.4)), y: r2(y), z: r2(victim.pos.z + rand(-0.4, 0.4)), rot: r2(rand(0, Math.PI * 2)), t: 30,
      skin: this.skinFor(victim, s.w), sticker: this.stickerFor(victim, s.w),
    };
    this.drops.push(d);
    this.emit(this.dropEvent(d));
    while (this.drops.length > 12) this._removeDrop(0);
  }

  dropEvent(d) {
    const w = d.w;
    return { t: 'dadd', id: d.id, w: w.base ? w.base.id : w.id, att: w.attachments || [], mag: d.mag, res: d.reserve, x: d.x, y: d.y, z: d.z, rot: d.rot, skin: d.skin, sticker: d.sticker, life: r1(d.t) };
  }

  _removeDrop(i) {
    const d = this.drops[i];
    this.drops.splice(i, 1);
    this.emit({ t: 'drm', id: d.id });
  }

  pickupDrop(actor, d) {
    const i = this.drops.indexOf(d);
    if (i < 0) return;
    const idx = d.w.slot === 1 ? 1 : 0;
    // Aktuelle Waffe an derselben Stelle liegen lassen
    const cur = actor.slots[idx];
    actor.slots[idx] = { w: d.w, mag: d.mag, reserve: d.reserve, pendingSingle: 0 };
    if (actor.skins) actor.skins[d.w.id] = d.skin;
    if (actor.stickers) actor.stickers[d.w.id] = d.sticker;
    this._removeDrop(i);
    if (cur && cur.w && !cur.w.melee && cur.w.mag !== Infinity && (cur.mag > 0 || cur.reserve > 0)) {
      const saved = actor.slots[0]; actor.slots[0] = cur;
      this._dropWeapon(actor);
      actor.slots[0] = saved;
    }
    const w = d.w;
    this.emit({ t: 'dtake', id: d.id, a: actor.id, w: w.base ? w.base.id : w.id, att: w.attachments || [], mag: d.mag, res: d.reserve, skin: d.skin, sticker: d.sticker, slot: idx, cur: actor.slot === idx });
    if (actor.slot === idx) {
      actor.reloadTimer = 0; actor.chargeT = 0; actor.spinT = 0; actor.switchTimer = d.w.switchTime || 0.4;
      this.onWeaponSwitch(actor);
    }
    if (typeof actor._updatePreferredRange === 'function') actor._updatePreferredRange();
  }

  _updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t -= dt;
      if (d.t <= 0) this._removeDrop(i);
    }
  }

  // --------------------------------------------------------
  // Rueckmeldungen aus Actor (Bewegung, Waffen) -> Ereignisse
  // --------------------------------------------------------
  onJump(a) { this.emit({ t: 'jump', a: a.id }); }
  onDoubleJump(a) { this.emit({ t: 'djump', a: a.id }); }
  onLand(a, impact, surface) { if (impact >= 4) this.emit({ t: 'land', a: a.id, i: r1(impact), sf: surface }); }
  onFootstep(a, speed, surface) {
    if (!a.isLocal && !(a.classDef && a.classDef.id === 'ninja')) a.lastLoudTime = this.time - 0.6;
    if (!this.server) this.emit({ t: 'step', a: a.id, sp: r1(speed), sf: surface, loc: true });
  }
  onSlide(a) { this.emit({ t: 'slide', a: a.id, sf: a.surface }); }
  onDash(a) { this.emit({ t: 'dash', a: a.id }); }
  onWallrunStart(a) { this.emit({ t: 'wallrun', a: a.id }); }
  onGrappleStart(a) { this.emit({ t: 'grap', a: a.id, k: 'shoot', p: a.grapple ? [r2(a.grapple.x), r2(a.grapple.y), r2(a.grapple.z)] : null }); }
  onGrappleEnd(a) { this.emit({ t: 'grap', a: a.id, k: 'retract' }); }
  onGrappleMiss(a) { this.emit({ t: 'grap', a: a.id, k: 'miss' }); }
  onZipStart(a) { this.emit({ t: 'zip', a: a.id, k: 'start' }); }
  onZipEnd(a) { this.emit({ t: 'zip', a: a.id, k: 'end' }); }
  onJumpPad(a) { this.emit({ t: 'pad', a: a.id }); }
  onDryFire(a) { this.emit({ t: 'dry', a: a.id, loc: true }); }
  onSpin(a, k, up) { this.emit({ t: 'spin', a: a.id, k: r2(k), up: !!up, loc: true }); }
  onChargeStart(a) { this.emit({ t: 'charge', a: a.id }); }
  onReloadStart(a) { this.emit({ t: 'reload', a: a.id, k: 0, tot: r2(a.reloadTotal) }); }
  onReloadTick(a) { this.emit({ t: 'reload', a: a.id, k: 1, tot: r2(a.reloadTotal), more: a.reloadTimer > 0 }); }
  onReloadEnd(a) { this.emit({ t: 'reload', a: a.id, k: 2 }); }
  onReloadCancel(a) { this.emit({ t: 'reload', a: a.id, k: 3, loc: true }); }
  onWeaponSwitch(a) {
    this.emit({ t: 'wsw', a: a.id, w: a.weapon.id, loc: true });
    if (typeof a._updatePreferredRange === 'function') a._updatePreferredRange();
  }

  // --------------------------------------------------------
  // Hauptschleife
  // --------------------------------------------------------
  step(dt) {
    if (!this.running || !this.world) return;
    this.time += dt;

    const blocks = (a) => this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(a);
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (a.alive) a.update(dt, this.world);
      else if (!this.online && !blocks(a)) {
        a.respawnTimer -= dt;
        if (a.respawnTimer <= 0) this.respawn(a);
      }
    }

    this._updatePendingMelee(dt);
    if (!this.online) {
      this.updateProjectiles(dt);
      this.updatePickups(dt);
      this._updateBurning(dt);
      this._updatePendingDestr(dt);
      this._updateAirstrikes(dt);
    }
    this._processInteractions();
    if (!this.online) {
      this._updateDrops(dt);
      this.world.updateDestructibles(dt, this.actors);
    }
    this.afterStep(dt);

    if (this.training) {
      this.training.update(dt);
      return;
    }
    if (this.online) return;

    if (this.modeCtl && !this.over) this.modeCtl.update(dt);

    if (!this.over && !(this.modeCtl && this.modeCtl.ownsClock)) {
      this.timeLeft -= dt;
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        if (!this.teamMode) this.endMatch(null);
        else this.endMatch(this.scores.red === this.scores.blue ? 'draw'
          : this.scores.red > this.scores.blue ? 'red' : 'blue');
      }
    }
  }
}
