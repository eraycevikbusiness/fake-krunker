// ============================================================
// Room: ein Match-Raum mit eigener Simulation, Spielern und Bots.
// Fuellt leere Plaetze mit Bots auf, laeuft in einer Endlosschleife
// (Match -> Endbildschirm -> naechstes Match mit Rotation).
// ============================================================

import { performance } from 'node:perf_hooks';
import { ServerSim } from './simserver.mjs';
import { MODE_BY_ID } from '../src/game/modes.js';
import { MAP_LIST } from '../src/world/mapdata.js';
import { WEATHERS } from '../src/world/weather.js';
import { describeActor, rosterEntry, SERVER_TICK, SNAP_RATE, cleanText, MAX_CHAT } from '../src/net/protocol.js';
import { clamp } from '../src/core/utils.js';

export const MAX_HUMANS = 12;
export const MAX_ACTORS = 16;
const END_SCREEN_SECS = 12;
const CLIENT_TIMEOUT_MS = 30000;
const ROTATE_MODES = ['tdm', 'ffa', 'ctf', 'hardpoint', 'gungame', 'tdm', 'infection', 'sd'];
const ROTATE_WEATHER = ['clear', 'dusk', 'clear', 'rain', 'night', 'fog', 'storm'];

export function sanitizeSettings(s) {
  s = s || {};
  const out = {
    mode: (s.mode === 'rotate' || MODE_BY_ID[s.mode]) ? s.mode : 'rotate',
    map: (s.map === 'rotate' || MAP_LIST.some(m => m.id === s.map)) ? s.map : 'rotate',
    weather: (s.weather === 'rotate' || WEATHERS.some(w => w.id === s.weather)) ? s.weather : 'rotate',
    players: clamp(Math.round(Number(s.players) || 8), 2, MAX_ACTORS),
    difficulty: clamp(Math.round(Number(s.difficulty) || 0), 0, 3),
    scoreLimit: clamp(Math.round(Number(s.scoreLimit) || 40), 10, 100),
    timeLimit: clamp(Math.round(Number(s.timeLimit) || 8), 3, 20),
  };
  if (s.difficulty === undefined) out.difficulty = 1;
  return out;
}

export class Room {
  constructor(lobby, opts) {
    this.lobby = lobby;
    this.id = opts.id;
    this.name = String(opts.name || 'Raum ' + opts.id).slice(0, 24);
    this.private = !!opts.private;
    this.settings = sanitizeSettings(opts.settings);
    this.clients = new Set();
    this.sim = new ServerSim(this);
    this.phase = 'lobby';
    this.endT = 0;
    this.matchNo = 0;
    this.emptySince = Date.now();
    this.acc = 0;
    this.snapAcc = 0;
    this.rosterAcc = 0;
    this.last = performance.now();
    this.startMatch();
    this.timer = setInterval(() => this.tick(), 1000 / 60);
  }

  /** Konkrete Einstellungen fuer das naechste Match (Rotation aufloesen) */
  resolveSettings() {
    const s = this.settings, n = this.matchNo;
    return {
      mode: s.mode === 'rotate' ? ROTATE_MODES[n % ROTATE_MODES.length] : s.mode,
      map: s.map === 'rotate' ? MAP_LIST[(n * 3 + 1) % MAP_LIST.length].id : s.map,
      weather: s.weather === 'rotate' ? ROTATE_WEATHER[(n * 5 + 2) % ROTATE_WEATHER.length] : s.weather,
      difficulty: s.difficulty, scoreLimit: s.scoreLimit, timeLimit: s.timeLimit,
    };
  }

  startMatch() {
    const sim = this.sim;
    const cfg = this.resolveSettings();
    this.matchNo++;
    sim.cleanup();
    sim.setupMatch(cfg);
    // Menschen zuerst (gleiche Ids behalten), dann Bots auffuellen
    for (const c of this.clients) {
      c.actor = sim.addHuman(c, c.profile, c.actor ? c.actor.id : 0);
    }
    const want = clamp(this.settings.players - this.clients.size, 0, MAX_ACTORS - this.clients.size);
    if (want > 0) sim.addBots(want);
    sim.setupMode();
    sim.running = true;
    const pending = sim.outbox.splice(0, sim.outbox.length);   // Spawn-Ereignisse erst nach der Match-Nachricht
    for (const a of sim.actors) sim.respawn(a, true);
    const spawns = sim.outbox.splice(0, sim.outbox.length);
    this.phase = 'playing';
    for (const c of this.clients) this.send(c, this.welcomeFor(c, 'match'));
    sim.outbox.push(...spawns);
    void pending;
    const talker = sim.actors.find(a => a.isBot);
    if (talker) setTimeout(() => { if (sim.running && this.phase === 'playing') sim.botChat(talker, 'start'); }, 1500);
  }

  welcomeFor(client, type) {
    const sim = this.sim;
    return Object.assign({
      t: type || 'welcome', id: client.actor.id,
      room: { code: this.id, name: this.name, private: this.private, settings: this.settings, humans: this.clients.size },
      actors: sim.actors.map(describeActor),
      end: this.phase === 'ending',
    }, sim.fullState());
  }

  // --------------------------------------------------------
  addClient(client) {
    if (client.room) client.room.removeClient(client);
    client.room = this;
    this.clients.add(client);
    this.fillBots(true);
    client.actor = this.sim.addHuman(client, client.profile);
    this.send(client, this.welcomeFor(client, 'welcome'));
    this.broadcast({ t: 'join', a: describeActor(client.actor) }, client);
    const talker = this.sim.actors.find(a => a.isBot);
    if (talker && this.sim.running) setTimeout(() => { if (this.sim.running) this.sim.botChat(talker, 'welcome'); }, 900);
    this.lobby.log(`+ ${client.name} -> Raum ${this.id} (${this.clients.size} Spieler)`);
  }

  removeClient(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    if (client.actor) {
      this.sim.removeActor(client.actor);
      this.broadcast({ t: 'leave', id: client.actor.id });
    }
    client.actor = null;
    client.room = null;
    this.fillBots(false);
    if (!this.clients.size) this.emptySince = Date.now();
    this.lobby.log(`- ${client.name} <- Raum ${this.id} (${this.clients.size} Spieler)`);
  }

  /** Bots so anpassen, dass Spieler + Bots = gewuenschte Spielerzahl */
  fillBots(joining) {
    const sim = this.sim;
    const humans = this.clients.size + (joining ? 0 : 0);
    const want = clamp(this.settings.players - humans, 0, MAX_ACTORS - humans);
    let bots = sim.actors.filter(a => a.isBot).length;
    while (bots > want) {
      const b = sim.removeOneBot();
      if (!b) break;
      this.broadcast({ t: 'leave', id: b.id });
      bots--;
    }
    while (bots < want) {
      const [b] = sim.addBots(1);
      if (sim.modeCtl) {
        if (sim.modeCtl.setupLateActor) sim.modeCtl.setupLateActor(b);
        else if (sim.modeCtl.setupActor) sim.modeCtl.setupActor(b);
      }
      const blocked = sim.modeCtl && sim.modeCtl.blocksRespawn && sim.modeCtl.blocksRespawn(b);
      if (sim.running && !blocked) sim.respawn(b, true);
      this.broadcast({ t: 'join', a: describeActor(b) });
      bots++;
    }
  }

  // --------------------------------------------------------
  tick() {
    const now = performance.now();
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    let n = 0;
    try {
      while (this.acc >= SERVER_TICK && n < 6) { this.sim.step(SERVER_TICK); this.acc -= SERVER_TICK; n++; }
    } catch (e) {
      this.lobby.log('Fehler in Raum ' + this.id + ': ' + (e && e.stack || e));
      this.acc = 0;
    }
    if (n >= 6) this.acc = 0;

    if (this.phase === 'ending') {
      this.endT -= dt;
      if (this.endT <= 0) this.startMatch();
    }

    this.flushEvents();
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / SNAP_RATE) {
      this.snapAcc -= 1 / SNAP_RATE;
      if (this.snapAcc > 0.5) this.snapAcc = 0;
      if (this.clients.size) this.broadcast(this.sim.snapshot());
    }
    this.rosterAcc += dt;
    if (this.rosterAcc >= 1) {
      this.rosterAcc = 0;
      for (const c of this.clients) if (c.actor) c.actor.ping = c.ping | 0;
      if (this.clients.size) this.broadcast({ t: 'roster', r: this.sim.actors.map(rosterEntry) });
      const t = Date.now();
      for (const c of Array.from(this.clients)) {
        if (t - c.lastSeen > CLIENT_TIMEOUT_MS) { this.lobby.log('Timeout: ' + c.name); this.lobby.drop(c); }
      }
    }
  }

  flushEvents() {
    const evs = this.sim.outbox;
    if (!evs.length) return;
    if (this.clients.size) {
      for (const c of this.clients) {
        const id = c.actor ? c.actor.id : -1;
        const mine = [];
        for (const ev of evs) {
          if (ev.to !== undefined && ev.to !== id) continue;
          if (ev.ex !== undefined && ev.ex === id) continue;
          mine.push(ev);
        }
        if (mine.length) this.send(c, { t: 'ev', e: mine });
      }
    }
    evs.length = 0;
  }

  onMatchEnd(winner) {
    this.phase = 'ending';
    this.endT = END_SCREEN_SECS;
    this.flushEvents();
    this.broadcast({
      t: 'end', w: winner && typeof winner === 'object' ? winner.id : (winner || null),
      r: this.sim.actors.map(rosterEntry), next: END_SCREEN_SECS,
    });
  }

  // --------------------------------------------------------
  handle(client, m) {
    const a = client.actor;
    const sim = this.sim;
    switch (m.t) {
      case 's': sim.onClientState(a, m); break;
      case 'hit': sim.onClientHit(a, m); break;
      case 'hurt': sim.onClientHurt(a, m); break;
      case 'wdmg': sim.onClientWdmg(a, m); break;
      case 'use': sim.onClientUse(a, m); break;
      case 'strike': sim.onClientStrike(a, m); break;
      case 'cls': sim.onClientClass(a, m); break;
      case 'cos': sim.onClientCosmetics(a, m); break;
      case 'chat': {
        const text = cleanText(m.text, MAX_CHAT);
        if (!text || !a) break;
        const now = Date.now();
        if (now - (client.lastChat || 0) < 700) break;
        client.lastChat = now;
        sim.outbox.push({ t: 'chat', a: a.id, text });
        break;
      }
      default: break;
    }
  }

  send(client, msg) { this.lobby.send(client, msg); }

  broadcast(msg, except) {
    if (!this.clients.size) return;
    const s = JSON.stringify(msg);
    for (const c of this.clients) { if (c !== except) this.lobby.sendRaw(c, s); }
  }

  info() {
    const s = this.sim;
    return {
      code: this.id, name: this.name, private: this.private,
      mode: s.mode, map: s.mapId, weather: s.weatherId, humans: this.clients.size, bots: s.actors.filter(a => a.isBot).length,
      players: this.settings.players, phase: this.phase, timeLeft: Math.round(s.timeLeft),
    };
  }

  destroy() {
    clearInterval(this.timer);
    for (const c of Array.from(this.clients)) this.removeClient(c);
    this.sim.cleanup();
  }
}
