// ============================================================
// Spielmodi mit Zielen: Capture the Flag, Hardpoint, Gun Game,
// Infection, Search & Destroy. Jeder Modus haengt an der Simulation
// (sim.modeCtl), bekommt update(dt), Kill-/Spawn-Ereignisse und liefert
// Bots ein Ziel (objectiveFor). Keine Darstellung: Meldungen laufen als
// Ereignisse ueber sim.emit({t:'mode', m:<modus>, k:<art>, ...}), die
// Meshes baut modefx.js aus dem Zustand. netState()/applyNetState()
// spiegeln den Zustand vom Server auf den Client.
// ============================================================

import { GUNGAME_ORDER, WEAPONS } from './weapons.js';
import { clamp } from '../core/utils.js';

export const MODES = [
  { id: 'tdm', name: 'Team Deathmatch', team: true, desc: 'Zwei Teams, Kills zaehlen.' },
  { id: 'ffa', name: 'Free For All', team: false, desc: 'Jeder gegen jeden, Bestenliste im HUD.' },
  { id: 'gungame', name: 'Gun Game', team: false, desc: 'Jeder Kill schaltet zur naechsten Waffe. Wer mit dem Katana trifft, gewinnt.' },
  { id: 'ctf', name: 'Capture the Flag', team: true, desc: 'Gegnerische Flagge holen und zur eigenen Basis bringen.' },
  { id: 'hardpoint', name: 'Hardpoint', team: true, desc: 'Eine wandernde Zone halten. Nur ein Team in der Zone = Punkte.' },
  { id: 'infection', name: 'Infection', team: true, desc: 'Ein Zombie mit Klauen jagt die Ueberlebenden. Wer stirbt, wird Zombie. Ueberlebe bis zum Ende.' },
  { id: 'sd', name: 'Search & Destroy', team: true, desc: 'Runden ohne Respawn. Angreifer legen die Bombe bei A oder B (E halten), Verteidiger entschaerfen.' },
];
export const MODE_BY_ID = {};
for (const m of MODES) MODE_BY_ID[m.id] = m;

export const TEAM_COLOR = { red: 0xd94a4a, blue: 0x4a86d9 };
export const ZOMBIE_COLOR = 0x4ad95a;

const r2 = (v) => Math.round(v * 100) / 100;

// ------------------------------------------------------------
// Capture the Flag
// ------------------------------------------------------------
export class CTFMode {
  constructor(game, mapDef, scoreLimit) {
    this.game = game;
    this.id = 'ctf';
    this.limit = clamp(Math.round((scoreLimit || 40) / 10), 3, 10);
    this.flags = {};
    const defs = mapDef.flags || {};
    for (const team of ['red', 'blue']) {
      let d = defs[team];
      if (!d) {
        const sp = team === 'red' ? mapDef.spawnsRed[0] : mapDef.spawnsBlue[0];
        d = { x: sp.x * 0.85, z: sp.z * 0.85 };
      }
      const y = game.world.groundAt(d.x, d.z, 60);
      this.flags[team] = { team, home: { x: d.x, y, z: d.z }, x: d.x, y, z: d.z, state: 'home', carrier: null, dropT: 0 };
    }
  }

  _ev(k, extra) { this.game.emit(Object.assign({ t: 'mode', m: 'ctf', k }, extra || {})); }

  update(dt) {
    const g = this.game;
    for (const team of ['red', 'blue']) {
      const f = this.flags[team];
      const enemyTeam = team === 'red' ? 'blue' : 'red';
      if (f.state === 'carried') {
        const c = f.carrier;
        if (!c || !c.alive) { this._drop(f); continue; }
        f.x = c.pos.x; f.y = c.pos.y; f.z = c.pos.z;
        // Traeger beruehrt eigene Basis mit Flagge daheim -> Punkt
        const own = this.flags[enemyTeam];
        if (own.state === 'home' && Math.hypot(c.pos.x - own.home.x, c.pos.z - own.home.z) < 2.4 && Math.abs(c.pos.y - own.home.y) < 2.5) {
          this._capture(f, c);
        }
      } else {
        if (f.state === 'dropped') {
          f.dropT -= dt;
          if (f.dropT <= 0) this._return(f, null);
        }
        // Beruehrung
        for (const a of g.actors) {
          if (!a.alive || a.spawnProtect > 0) continue;
          if (Math.hypot(a.pos.x - f.x, a.pos.z - f.z) > 1.7 || Math.abs(a.pos.y - f.y) > 2.5) continue;
          if (a.team === team) {
            if (f.state === 'dropped') { this._return(f, a); break; }
          } else if (!a.carrying) {
            this._pickup(f, a);
            break;
          }
        }
      }
    }
  }

  _pickup(f, a) {
    f.state = 'carried'; f.carrier = a;
    a.carrying = f; a.carryMult = 0.86;
    this._ev('pickup', { a: a.id, f: f.team });
    if (a.isBot) { a.objectiveDirty = true; this.game.botChat(a, 'flag'); }
  }

  _drop(f) {
    const c = f.carrier;
    if (c) { c.carrying = null; c.carryMult = 1; }
    f.carrier = null;
    f.state = 'dropped';
    f.dropT = 25;
    f.y = this.game.world.groundAt(f.x, f.z, f.y + 2);
    this._ev('drop', { f: f.team, x: r2(f.x), y: r2(f.y), z: r2(f.z) });
  }

  _return(f, by) {
    f.state = 'home'; f.carrier = null;
    f.x = f.home.x; f.y = f.home.y; f.z = f.home.z;
    this._ev('return', { f: f.team, a: by ? by.id : 0 });
  }

  _capture(f, c) {
    const g = this.game;
    c.carrying = null; c.carryMult = 1;
    c.score += 250;
    g.scores[c.team]++;
    f.state = 'home'; f.carrier = null;
    f.x = f.home.x; f.y = f.home.y; f.z = f.home.z;
    this._ev('capture', { f: f.team, a: c.id, sc: [g.scores.red, g.scores.blue] });
    g._checkMatchEnd();
  }

  /** Tod eines Traegers */
  onDeath(victim) {
    if (victim.carrying) this._drop(victim.carrying);
  }

  /** Bot-Ziel: {x,y,z,kind} */
  objectiveFor(bot) {
    const enemyTeam = bot.team === 'red' ? 'blue' : 'red';
    const enemyFlag = this.flags[enemyTeam], ownFlag = this.flags[bot.team];
    if (bot.carrying) return { x: ownFlag.home.x, y: ownFlag.home.y, z: ownFlag.home.z, kind: 'home' };
    // Rolle: gerade Bot-Ids verteidigen, ungerade greifen an
    const defender = (bot.id % 2) === 0;
    if (ownFlag.state === 'dropped') return { x: ownFlag.x, y: ownFlag.y, z: ownFlag.z, kind: 'return' };
    if (ownFlag.state === 'carried' && ownFlag.carrier) {
      const c = ownFlag.carrier;
      if (defender || Math.random() < 0.4) return { x: c.pos.x, y: c.pos.y, z: c.pos.z, kind: 'hunt' };
    }
    if (defender && enemyFlag.state !== 'carried') {
      const a = bot.id * 1.7;
      return { x: ownFlag.home.x + Math.cos(a) * 7, y: ownFlag.home.y, z: ownFlag.home.z + Math.sin(a) * 7, kind: 'defend' };
    }
    if (enemyFlag.state === 'carried') {
      // Traeger eskortieren
      const c = enemyFlag.carrier;
      return { x: c.pos.x + Math.cos(bot.id) * 4, y: c.pos.y, z: c.pos.z + Math.sin(bot.id) * 4, kind: 'escort' };
    }
    return { x: enemyFlag.x, y: enemyFlag.y, z: enemyFlag.z, kind: 'attack' };
  }

  winner() {
    const s = this.game.scores;
    if (s.red >= this.limit) return 'red';
    if (s.blue >= this.limit) return 'blue';
    return null;
  }

  hudText(player) {
    const own = this.flags[player.team], en = this.flags[player.team === 'red' ? 'blue' : 'red'];
    if (!own || !en) return null;
    const st = (f) => f.state === 'home' ? 'in der Basis' : f.state === 'carried' ? (f.carrier ? 'bei ' + f.carrier.name : 'unterwegs') : 'am Boden';
    return { line: `CTF · ${this.game.scores.red} : ${this.game.scores.blue} · Ziel ${this.limit}`, sub: `Eigene Flagge ${st(own)} · Gegnerflagge ${st(en)}`, carry: !!player.carrying };
  }

  minimapItems(out) {
    for (const team of ['red', 'blue']) {
      const f = this.flags[team];
      out.push({ x: f.x, z: f.z, color: team === 'red' ? '#ff5a5a' : '#5a9aff', label: 'F', big: f.state !== 'home' });
      out.push({ x: f.home.x, z: f.home.z, color: team === 'red' ? 'rgba(255,90,90,0.5)' : 'rgba(90,154,255,0.5)', label: '', ring: true });
    }
  }

  /** Netz: Zustand beider Flaggen */
  netState() {
    const s = (f) => [f.state === 'home' ? 0 : f.state === 'carried' ? 1 : 2, r2(f.x), r2(f.y), r2(f.z), f.carrier ? f.carrier.id : 0, r2(f.dropT)];
    return [s(this.flags.red), s(this.flags.blue)];
  }
  applyNetState(s) {
    if (!s) return;
    const teams = ['red', 'blue'];
    for (let i = 0; i < 2; i++) {
      const f = this.flags[teams[i]], v = s[i];
      if (!v) continue;
      const prevCarrier = f.carrier;
      f.state = v[0] === 0 ? 'home' : v[0] === 1 ? 'carried' : 'dropped';
      f.x = v[1]; f.y = v[2]; f.z = v[3];
      f.carrier = v[4] ? this.game.actorById(v[4]) : null;
      f.dropT = v[5];
      if (prevCarrier && prevCarrier !== f.carrier) { prevCarrier.carrying = null; prevCarrier.carryMult = 1; }
      if (f.carrier) { f.carrier.carrying = f; f.carrier.carryMult = 0.86; }
    }
  }

  dispose() {
    for (const team of ['red', 'blue']) {
      const f = this.flags[team];
      if (f.carrier) { f.carrier.carrying = null; f.carrier.carryMult = 1; }
    }
  }
}

// ------------------------------------------------------------
// Hardpoint: wandernde Zone
// ------------------------------------------------------------
export class HardpointMode {
  constructor(game, mapDef, scoreLimit) {
    this.game = game;
    this.id = 'hardpoint';
    this.limit = Math.max(30, Math.round((scoreLimit || 40) * 2));
    this.points = (mapDef.hardpoints && mapDef.hardpoints.length ? mapDef.hardpoints : [{ x: 0, z: 0 }]).map((p) => ({
      x: p.x, z: p.z, y: game.world.groundAt(p.x, p.z, 60),
    }));
    this.radius = 5.5;
    this.idx = 0;
    this.rotateT = 60;
    this.owner = null;          // Team, das die Zone allein haelt
    this.contested = false;
    this.tick = 0;
  }

  _ev(k, extra) { this.game.emit(Object.assign({ t: 'mode', m: 'hp', k }, extra || {})); }

  _moveTo(i, silent) {
    this.idx = i % this.points.length;
    this.rotateT = 60;
    this.owner = null;
    if (!silent) this._ev('move', { i: this.idx });
  }

  get zone() { return this.points[this.idx]; }

  update(dt) {
    const g = this.game;
    this.rotateT -= dt;
    if (this.rotateT <= 0) this._moveTo(this.idx + 1);
    const z = this.zone;
    let red = 0, blue = 0;
    for (const a of g.actors) {
      if (!a.alive) continue;
      if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) > this.radius || Math.abs(a.pos.y - z.y) > 3.5) continue;
      if (a.team === 'red') red++; else blue++;
    }
    this.contested = red > 0 && blue > 0;
    const owner = this.contested ? null : red > 0 ? 'red' : blue > 0 ? 'blue' : null;
    if (owner !== this.owner) {
      this.owner = owner;
      this._ev('owner', { o: owner });
    }
    this.tick += dt;
    if (this.tick >= 1) {
      this.tick -= 1;
      if (this.owner) {
        g.scores[this.owner]++;
        for (const a of g.actors) {
          if (a.alive && a.team === this.owner && Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= this.radius) a.score += 5;
        }
        g._checkMatchEnd();
      }
    }
  }

  objectiveFor(bot) {
    const z = this.zone;
    const a = bot.id * 2.1;
    const r = 1 + (bot.id % 3) * 1.4;
    return { x: z.x + Math.cos(a) * r, y: z.y, z: z.z + Math.sin(a) * r, kind: 'zone' };
  }

  winner() {
    const s = this.game.scores;
    if (s.red >= this.limit) return 'red';
    if (s.blue >= this.limit) return 'blue';
    return null;
  }

  /** Ist der Akteur in der Zone? */
  inZone(a) {
    const z = this.zone;
    return Math.hypot(a.pos.x - z.x, a.pos.z - z.z) <= this.radius && Math.abs(a.pos.y - z.y) <= 3.5;
  }

  hudText(player) {
    const who = this.contested ? 'UMKÄMPFT' : this.owner === player.team ? 'DEIN TEAM HÄLT' : this.owner ? 'GEGNER HALTEN' : 'FREI';
    const z = this.zone;
    const d = Math.round(Math.hypot(player.pos.x - z.x, player.pos.z - z.z));
    return { line: `HARDPOINT · ${this.game.scores.red} : ${this.game.scores.blue} · Ziel ${this.limit}`, sub: `${who} · wandert in ${Math.ceil(this.rotateT)} s · ${d} m`, inZone: player.alive && this.inZone(player) };
  }

  minimapItems(out) {
    const z = this.zone;
    out.push({ x: z.x, z: z.z, color: this.contested ? '#ffcc00' : this.owner === 'red' ? '#ff5a5a' : this.owner === 'blue' ? '#5a9aff' : '#ffffff', label: 'HP', zone: this.radius });
  }

  netState() { return [this.idx, this.owner === 'red' ? 1 : this.owner === 'blue' ? 2 : 0, this.contested ? 1 : 0, r2(this.rotateT)]; }
  applyNetState(s) {
    if (!s) return;
    this.idx = s[0] % this.points.length;
    this.owner = s[1] === 1 ? 'red' : s[1] === 2 ? 'blue' : null;
    this.contested = !!s[2];
    this.rotateT = s[3];
  }

  onDeath() {}
  dispose() {}
}

// ------------------------------------------------------------
// Gun Game: Waffenleiter
// ------------------------------------------------------------
export class GunGameMode {
  constructor(game) {
    this.game = game;
    this.id = 'gungame';
    this.order = GUNGAME_ORDER.filter(id => WEAPONS[id]);
  }

  /** Bewaffnung nach Stufe setzen */
  applyLevel(actor) {
    const lvl = clamp(actor.ggLevel | 0, 0, this.order.length - 1);
    actor.ggLevel = lvl;
    const wid = this.order[lvl];
    const w = WEAPONS[wid];
    actor.setLoadout(w.melee ? [wid] : [wid, 'knife']);
    // volle Munition
    for (const s of actor.slots) { s.mag = s.w.mag === Infinity ? Infinity : s.w.mag; s.reserve = s.w.reserve; }
    if (actor.alive && this.game.onWeaponSwitch) this.game.onWeaponSwitch(actor);
  }

  setupActor(actor) {
    actor.ggLevel = 0;
    this.applyLevel(actor);
  }

  /** Kill verarbeitet: true wenn das Match entschieden ist */
  onKill(victim, attacker, causeId) {
    const g = this.game;
    if (!attacker || attacker === victim) return false;
    const humiliation = causeId === 'knife' || causeId === 'melee';
    if (humiliation && victim.ggLevel > 0) {
      victim.ggLevel--;
      this.applyLevel(victim);
      g.emit({ t: 'mode', m: 'gg', k: 'lost', a: victim.id, lvl: victim.ggLevel });
    }
    const last = this.order.length - 1;
    if (attacker.ggLevel >= last) {
      return true;   // Kill mit der letzten Waffe -> Sieg
    }
    attacker.ggLevel++;
    this.applyLevel(attacker);
    g.emit({ t: 'mode', m: 'gg', k: 'level', a: attacker.id, lvl: attacker.ggLevel });
    return false;
  }

  update() {}
  objectiveFor() { return null; }
  onDeath() {}
  winner() { return null; }

  hudText(player) {
    const n = this.order.length;
    const next = player.ggLevel < n - 1 ? WEAPONS[this.order[player.ggLevel + 1]].short : '—';
    return { line: `GUN GAME · STUFE ${player.ggLevel + 1}/${n}`, sub: `Nächste Waffe: ${next}` };
  }
  minimapItems() {}
  netState() { return null; }
  applyNetState() {}
  dispose() {}
}

// ------------------------------------------------------------
// Infection: Zombies (rot/gruen, Klauen) gegen Ueberlebende (blau)
// ------------------------------------------------------------
export class InfectionMode {
  constructor(game, mapDef, scoreLimit, timeLimit) {
    this.game = game;
    this.id = 'infection';
    this.ownsClock = true;      // Rundenzeit verwaltet der Modus selbst
    this.teamNames = { red: 'ZOMBIES', blue: 'ÜBERLEBENDE' };
    this.teamColors = { red: ZOMBIE_COLOR, blue: TEAM_COLOR.blue };
    this.teamHex = { red: '#5aff6a', blue: '#7ab4ff' };
    this.startT = 8;            // Sekunden bis zur ersten Infektion
    this.started = false;
    this.roundLen = Math.min(timeLimit || 240, 240);
    this._lastCount = -1;
  }

  _ev(k, extra) { this.game.emit(Object.assign({ t: 'mode', m: 'inf', k }, extra || {})); }

  /** Alle starten als Ueberlebende */
  setupActor(a) {
    a.team = 'blue';
    a.zombie = false;
    a.pendingZombie = false;
    a.setLoadout(null);
  }

  spawnPointsFor(actor) {
    const m = this.game.world.map;
    return actor.team === 'red' ? (m.spawnsRed.length ? m.spawnsRed : m.spawnsFfa) : m.spawnsFfa;
  }

  /** Vor dem Respawn: Infizierte werden zu Zombies */
  beforeRespawn(a) {
    if (a.pendingZombie) { a.pendingZombie = false; this.makeZombie(a, false); }
  }

  /** Spieler zum Zombie machen (auch als Spiegel auf dem Client) */
  makeZombie(a, announce) {
    const g = this.game;
    a.team = 'red';
    a.zombie = true;
    a.pendingZombie = false;
    a.setLoadout(['claws']);
    a.maxHp = 130; a.hp = Math.min(a.hp > 0 ? a.hp : 130, 130);
    a.maxArmor = 0; a.armor = 0;
    a.speedMult = a.classDef.speed * 1.22;
    a.maxJumps = Math.max(2, a.maxJumps);
    a.canDash = true;
    g.rebuildActorModel(a);
    if (a.isBot) { a.preferDist = 2; a.objectiveDirty = true; a.target = null; }
    if (!g.online) this._ev('infect', { a: a.id, ann: !!announce });
  }

  update(dt) {
    const g = this.game;
    if (!this.started) {
      this.startT -= dt;
      const s = Math.ceil(this.startT);
      if (s !== this._lastCount && s > 0 && s <= 5) { this._lastCount = s; this._ev('count', { n: s }); }
      if (this.startT <= 0) {
        this.started = true;
        const alive = g.actors.slice();
        const n = alive.length >= 10 ? 2 : 1;
        for (let i = 0; i < n && alive.length; i++) {
          const pick = alive.splice((Math.random() * alive.length) | 0, 1)[0];
          this.makeZombie(pick, true);
          g.respawn(pick, true);
        }
        this._ev('start');
      }
      return;
    }
    this.roundLen -= dt;
    g.timeLeft = Math.max(0, this.roundLen);
    if (g.over) return;
    const humans = g.actors.filter(a => a.team === 'blue').length;
    if (humans === 0) { g.endMatch('red'); return; }
    if (this.roundLen <= 0) {
      for (const a of g.actors) if (a.team === 'blue') a.score += 300;
      g.endMatch('blue');
    }
  }

  onKill(victim, attacker) {
    if (attacker && attacker.zombie && victim.team === 'blue') attacker.score += 150;
  }

  onDeath(victim, attacker) {
    if (victim.team === 'blue' && this.started) {
      victim.pendingZombie = true;
      this._ev('doomed', { a: victim.id });
    }
  }

  /** Neuer Spieler mitten im Match: nach dem Start als Zombie */
  setupLateActor(a) {
    this.setupActor(a);
    if (this.started) this.makeZombie(a, false);
  }

  objectiveFor(bot) {
    const g = this.game;
    if (bot.zombie) {
      // Naechster Ueberlebender
      let best = null, bd = Infinity;
      for (const a of g.actors) {
        if (!a.alive || a.team !== 'blue') continue;
        const d = Math.hypot(a.pos.x - bot.pos.x, a.pos.z - bot.pos.z);
        if (d < bd) { bd = d; best = a; }
      }
      return best ? { x: best.pos.x, y: best.pos.y, z: best.pos.z, kind: 'hunt' } : null;
    }
    // Ueberlebende: zusammenbleiben, weg von Zombies
    let mate = null, bd = Infinity;
    for (const a of g.actors) {
      if (a === bot || !a.alive || a.team !== 'blue') continue;
      const d = Math.hypot(a.pos.x - bot.pos.x, a.pos.z - bot.pos.z);
      if (d < bd) { bd = d; mate = a; }
    }
    if (mate && bd > 10) return { x: mate.pos.x + Math.cos(bot.id) * 3, y: mate.pos.y, z: mate.pos.z + Math.sin(bot.id) * 3, kind: 'group' };
    return null;
  }

  winner() { return null; }
  interactionFor() { return null; }

  hudText(player) {
    const g = this.game;
    const humans = g.actors.filter(a => a.team === 'blue').length, zombies = g.actors.length - humans;
    if (!this.started) return { line: 'INFECTION', sub: `Die Infektion beginnt in ${Math.ceil(this.startT)} s` };
    return { line: `ÜBERLEBENDE ${humans} · ZOMBIES ${zombies}`, sub: player.zombie ? 'Jage die Überlebenden' : 'Überlebe bis zum Ende der Runde' };
  }
  minimapItems() {}
  netState() { return [this.started ? 1 : 0, r2(this.startT), r2(this.roundLen)]; }
  applyNetState(s) { if (!s) return; this.started = !!s[0]; this.startT = s[1]; this.roundLen = s[2]; }
  dispose() {}
}

// ------------------------------------------------------------
// Search & Destroy: Runden ohne Respawn, Bombe bei A oder B
// ------------------------------------------------------------
export class SearchDestroyMode {
  constructor(game, mapDef, scoreLimit) {
    this.game = game;
    this.id = 'sd';
    this.ownsClock = true;      // Rundenuhr statt Matchzeit
    this.teamNames = { red: 'ANGREIFER', blue: 'VERTEIDIGER' };
    this.roundsToWin = clamp(Math.round((scoreLimit || 40) / 10), 3, 8);
    this.round = 0;
    this.phase = 'start';       // start | live | end | over
    this.phaseT = 0;
    this.roundTime = 110;
    this.sites = (mapDef.bombsites && mapDef.bombsites.length ? mapDef.bombsites : (mapDef.hardpoints || []).slice(0, 2).map((p, i) => ({ name: i ? 'B' : 'A', x: p.x, z: p.z })))
      .map((s) => ({ name: s.name, x: s.x, z: s.z, y: game.world.groundAt(s.x, s.z, 60) }));
    if (!this.sites.length) this.sites.push({ name: 'A', x: 0, z: 0, y: game.world.groundAt(0, 0, 60) });
    this.bomb = null;           // { site, x, y, z, t }
    this.plant = { actor: null, t: 0 };
    this.defuse = { actor: null, t: 0 };
    this.swapped = false;
    this._tickT = 0;
    if (!game.online) this._startRound();
  }

  _ev(k, extra) { this.game.emit(Object.assign({ t: 'mode', m: 'sd', k }, extra || {})); }

  _startRound() {
    const g = this.game;
    this.round++;
    this.phase = 'start';
    this.phaseT = 4;
    this.roundTime = 110;
    this.bomb = null;
    this.plant.actor = null; this.plant.t = 0;
    this.defuse.actor = null; this.defuse.t = 0;
    // Seitenwechsel zur Halbzeit
    if (!this.swapped && this.round === this.roundsToWin) {
      this.swapped = true;
      for (const a of g.actors) { a.team = a.team === 'red' ? 'blue' : 'red'; g.rebuildActorModel(a); }
      const s = g.scores.red; g.scores.red = g.scores.blue; g.scores.blue = s;
      this._ev('swap', { teams: g.actors.map(a => [a.id, a.team]), sc: [g.scores.red, g.scores.blue] });
    }
    for (const a of g.actors) { a.respawnTimer = 0; g.respawn(a, true); a.spawnProtect = 4; }
    this._ev('round', { n: this.round });
  }

  _endRound(winner, reason) {
    const g = this.game;
    if (this.phase === 'end' || this.phase === 'over') return;
    this.phase = 'end';
    this.phaseT = 4;
    g.scores[winner]++;
    for (const a of g.actors) if (a.team === winner && a.alive) a.score += 100;
    this._ev('end', { w: winner, r: reason, sc: [g.scores.red, g.scores.blue] });
    if (reason !== 'BOMBE EXPLODIERT') this.bomb = null;
    if (g.scores[winner] >= this.roundsToWin) { this.phase = 'over'; g.endMatch(winner); }
  }

  update(dt) {
    const g = this.game;
    g.timeLeft = Math.max(0, this.phase === 'live' ? (this.bomb ? this.bomb.t : this.roundTime) : this.phaseT);
    if (this.phase === 'over') return;
    if (this.phase === 'start') {
      this.phaseT -= dt;
      for (const a of g.actors) a.spawnProtect = Math.max(a.spawnProtect, 0.05);
      if (this.phaseT <= 0) { this.phase = 'live'; this._ev('live'); }
      return;
    }
    if (this.phase === 'end') {
      this.phaseT -= dt;
      if (this.phaseT <= 0) this._startRound();
      return;
    }
    // ---- live ----
    const red = g.actors.filter(a => a.team === 'red' && a.alive).length;
    const blue = g.actors.filter(a => a.team === 'blue' && a.alive).length;
    if (!this.bomb) {
      this.roundTime -= dt;
      if (blue === 0) { this._endRound('red', 'VERTEIDIGER ELIMINIERT'); return; }
      if (red === 0) { this._endRound('blue', 'ANGREIFER ELIMINIERT'); return; }
      if (this.roundTime <= 0) { this._endRound('blue', 'ZEIT ABGELAUFEN'); return; }
      this._updatePlant(dt);
    } else {
      this.bomb.t -= dt;
      this._tickT -= dt;
      const rate = this.bomb.t < 10 ? 0.25 : this.bomb.t < 20 ? 0.5 : 1;
      if (this._tickT <= 0) { this._tickT = rate; this._ev('tick', { x: r2(this.bomb.x), y: r2(this.bomb.y), z: r2(this.bomb.z) }); }
      if (this.bomb.t <= 0) {
        const b = this.bomb;
        g.explode(b.x, b.y + 0.5, b.z, { radius: 14, damage: 300, minMult: 0.3, force: 18, selfMult: 1 }, null, null, null, 'bomb');
        this.bomb = null;
        this._endRound('red', 'BOMBE EXPLODIERT');
        return;
      }
      if (blue === 0) { this._endRound('red', 'VERTEIDIGER ELIMINIERT'); return; }
      this._updateDefuse(dt);
    }
  }

  _nearSite(a) {
    for (const s of this.sites) {
      if (Math.hypot(a.pos.x - s.x, a.pos.z - s.z) < 3.6 && Math.abs(a.pos.y - s.y) < 2.5) return s;
    }
    return null;
  }

  _updatePlant(dt) {
    const g = this.game;
    const pl = this.plant;
    let actor = null;
    for (const a of g.actors) {
      if (!a.alive || a.team !== 'red' || !a.intent.interactHold) continue;
      if (!this._nearSite(a)) continue;
      actor = a; break;
    }
    if (actor !== pl.actor) { pl.actor = actor; pl.t = 0; }
    if (!actor) return;
    pl.t += dt;
    if ((pl.t * 6 | 0) !== ((pl.t - dt) * 6 | 0)) this._ev('planting', { a: actor.id });
    actor.intent.fwd = 0; actor.intent.side = 0;
    if (pl.t >= 3) {
      const s = this._nearSite(actor);
      this.bomb = { site: s, x: s.x + (actor.pos.x - s.x) * 0.5, y: s.y, z: s.z + (actor.pos.z - s.z) * 0.5, t: 35 };
      pl.actor = null; pl.t = 0;
      actor.score += 100;
      this._ev('planted', { a: actor.id, site: s.name });
      for (const b of g.actors) if (b.isBot) b.objectiveDirty = true;
    }
  }

  _updateDefuse(dt) {
    const g = this.game;
    const df = this.defuse;
    let actor = null;
    for (const a of g.actors) {
      if (!a.alive || a.team !== 'blue' || !a.intent.interactHold) continue;
      if (Math.hypot(a.pos.x - this.bomb.x, a.pos.z - this.bomb.z) > 2.6 || Math.abs(a.pos.y - this.bomb.y) > 2.5) continue;
      actor = a; break;
    }
    if (actor !== df.actor) { df.actor = actor; df.t = 0; }
    if (!actor) return;
    df.t += dt;
    if ((df.t * 4 | 0) !== ((df.t - dt) * 4 | 0)) this._ev('defusing', { a: actor.id });
    actor.intent.fwd = 0; actor.intent.side = 0;
    if (df.t >= 5) {
      this.bomb = null;
      df.actor = null; df.t = 0;
      actor.score += 150;
      this._ev('defused', { a: actor.id });
      this._endRound('blue', 'BOMBE ENTSCHÄRFT');
    }
  }

  /** Keine Respawns waehrend der Runde */
  blocksRespawn(actor) { return this.phase === 'live' || this.phase === 'end'; }

  /** Spaeter Beitritt: bis zur naechsten Runde zuschauen */
  setupLateActor(a) { a.respawnTimer = 99999; }

  interactionFor(actor) {
    if (this.phase !== 'live') return null;
    if (actor.team === 'red' && !this.bomb) {
      const s = this._nearSite(actor);
      if (s) return { type: 'bomb', action: 'plant', label: this.plant.actor === actor ? 'BOMBE LEGEN ' + Math.round(this.plant.t / 3 * 100) + '%' : 'BOMBE LEGEN (E HALTEN)' };
    }
    if (actor.team === 'blue' && this.bomb) {
      if (Math.hypot(actor.pos.x - this.bomb.x, actor.pos.z - this.bomb.z) < 2.6) return { type: 'bomb', action: 'defuse', label: this.defuse.actor === actor ? 'ENTSCHÄRFEN ' + Math.round(this.defuse.t / 5 * 100) + '%' : 'ENTSCHÄRFEN (E HALTEN)' };
    }
    return null;
  }
  interact() {}

  onDeath(victim) {
    if (this.plant.actor === victim) { this.plant.actor = null; this.plant.t = 0; }
    if (this.defuse.actor === victim) { this.defuse.actor = null; this.defuse.t = 0; }
  }

  objectiveFor(bot) {
    if (this.phase !== 'live') return null;
    if (bot.team === 'red') {
      if (this.bomb) return { x: this.bomb.x + Math.cos(bot.id) * 5, y: this.bomb.y, z: this.bomb.z + Math.sin(bot.id) * 5, kind: 'guard' };
      const s = this.sites[bot.id % this.sites.length];
      return { x: s.x + Math.cos(bot.id * 2) * 1.2, y: s.y, z: s.z + Math.sin(bot.id * 2) * 1.2, kind: 'plant' };
    }
    if (this.bomb) return { x: this.bomb.x, y: this.bomb.y, z: this.bomb.z, kind: 'defuse' };
    const s = this.sites[(bot.id + ((this.game.time / 25) | 0)) % this.sites.length];
    return { x: s.x + Math.cos(bot.id * 1.3) * 5, y: s.y, z: s.z + Math.sin(bot.id * 1.3) * 5, kind: 'defend' };
  }

  winner() { return null; }

  hudText(player) {
    const g = this.game;
    const sc = `${g.scores.red} : ${g.scores.blue} · Ziel ${this.roundsToWin}`;
    let sub;
    if (this.phase === 'start') sub = 'Runde startet …';
    else if (this.bomb) sub = `BOMBE GELEGT BEI ${this.bomb.site.name} · ${Math.ceil(this.bomb.t)} s`;
    else sub = player.team === 'red' ? 'Bombe bei A oder B legen (E halten)' : 'A und B verteidigen';
    return { line: `S&D · RUNDE ${this.round} · ${sc}`, sub, inZone: !!this.bomb };
  }

  minimapItems(out) {
    for (const s of this.sites) out.push({ x: s.x, z: s.z, color: '#ffcc00', label: s.name });
    if (this.bomb) out.push({ x: this.bomb.x, z: this.bomb.z, color: '#ff4444', label: '💣', big: true });
  }

  netState() {
    const b = this.bomb;
    return {
      p: this.phase, t: r2(this.phaseT), n: this.round, rt: r2(this.roundTime),
      b: b ? [this.sites.indexOf(b.site), r2(b.x), r2(b.y), r2(b.z), r2(b.t)] : null,
      pl: this.plant.actor ? [this.plant.actor.id, r2(this.plant.t)] : null,
      df: this.defuse.actor ? [this.defuse.actor.id, r2(this.defuse.t)] : null,
      sw: this.swapped ? 1 : 0,
    };
  }
  applyNetState(s) {
    if (!s) return;
    const g = this.game;
    this.phase = s.p; this.phaseT = s.t; this.round = s.n; this.roundTime = s.rt; this.swapped = !!s.sw;
    if (s.b) {
      if (!this.bomb) this.bomb = { site: this.sites[s.b[0]] || this.sites[0], x: s.b[1], y: s.b[2], z: s.b[3], t: s.b[4] };
      else { this.bomb.t = s.b[4]; this.bomb.x = s.b[1]; this.bomb.y = s.b[2]; this.bomb.z = s.b[3]; }
    } else this.bomb = null;
    this.plant.actor = s.pl ? g.actorById(s.pl[0]) : null; this.plant.t = s.pl ? s.pl[1] : 0;
    this.defuse.actor = s.df ? g.actorById(s.df[0]) : null; this.defuse.t = s.df ? s.df[1] : 0;
    g.timeLeft = Math.max(0, this.phase === 'live' ? (this.bomb ? this.bomb.t : this.roundTime) : this.phaseT);
  }

  dispose() {}
}

export function createMode(id, game, mapDef, scoreLimit, timeLimit) {
  if (id === 'ctf') return new CTFMode(game, mapDef, scoreLimit);
  if (id === 'hardpoint') return new HardpointMode(game, mapDef, scoreLimit);
  if (id === 'gungame') return new GunGameMode(game);
  if (id === 'infection') return new InfectionMode(game, mapDef, scoreLimit, timeLimit);
  if (id === 'sd') return new SearchDestroyMode(game, mapDef, scoreLimit);
  return null;
}
