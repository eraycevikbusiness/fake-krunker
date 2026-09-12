// ============================================================
// Lobby: Verbindungen, Raeume, Schnellbeitritt und Raumcodes.
// Ein Client ist eine WebSocket-Verbindung mit Profil (Name, Klasse,
// Kosmetik); er steckt in hoechstens einem Raum.
// ============================================================

import { Room, MAX_HUMANS, sanitizeSettings } from './room.mjs';
import { PROTO_VERSION, cleanName } from '../src/net/protocol.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_MS = 30000;
const SKIN_TONES = [0xd4a985, 0xbd8d63, 0x9a6a42, 0x6e4a2c, 0xcdb090];
const HAIR_COLORS = [0x2a1e14, 0x120c08, 0x6b4a2c, 0xc9a55a, 0x8a2a1a, 0x3a3a40];
const pick = (a) => a[(Math.random() * a.length) | 0];

export class Lobby {
  constructor(opts) {
    this.rooms = new Map();
    this.clients = new Set();
    this.quiet = !!(opts && opts.quiet);
    this.maxRooms = (opts && opts.maxRooms) || 32;
    this.timer = setInterval(() => this.cleanup(), 5000);
  }

  log(msg) { if (!this.quiet) console.log('  [lobby] ' + msg); }

  makeCode() {
    for (let tries = 0; tries < 100; tries++) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
      if (!this.rooms.has(c)) return c;
    }
    return String(Date.now()).slice(-5);
  }

  /** Neue WebSocket-Verbindung */
  connection(ws, req) {
    const client = {
      ws, name: 'Player', profile: null, room: null, actor: null, ping: 0,
      lastSeen: Date.now(), hello: false, lastChat: 0,
      skinTone: pick(SKIN_TONES), hairColor: pick(HAIR_COLORS),
      ip: (req && req.socket && req.socket.remoteAddress) || '',
    };
    this.clients.add(client);
    ws.on('message', (data) => {
      client.lastSeen = Date.now();
      let msg;
      try { msg = JSON.parse(String(data)); } catch (e) { return; }
      try {
        if (Array.isArray(msg)) { for (const m of msg.slice(0, 64)) this.handle(client, m); }
        else this.handle(client, msg);
      } catch (e) { this.log('Fehler bei Nachricht von ' + client.name + ': ' + (e && e.stack || e)); }
    });
    ws.on('close', () => this.drop(client));
    ws.on('error', () => this.drop(client));
  }

  drop(client) {
    if (!this.clients.has(client)) return;
    this.leave(client);
    this.clients.delete(client);
    try { client.ws.terminate(); } catch (e) {}
  }

  handle(client, m) {
    if (!m || typeof m.t !== 'string') return;
    if (m.t === 'hello') {
      if (m.v !== PROTO_VERSION) {
        this.send(client, { t: 'error', code: 'version', msg: 'Der Server hat eine andere Spielversion. Bitte Seite neu laden.' });
        setTimeout(() => this.drop(client), 200);
        return;
      }
      client.hello = true;
      client.name = cleanName(m.name);
      client.profile = { cls: m.cls, att: m.att, outfit: m.outfit, hat: m.hat, fx: m.fx, icon: m.icon, skins: m.skins, stickers: m.stickers };
      this.send(client, { t: 'hi', name: client.name, online: this.clients.size, rooms: this.list() });
      return;
    }
    if (m.t === 'ping') { this.send(client, { t: 'pong', c: m.c, s: client.room ? client.room.sim.time : 0 }); client.ping = Math.max(0, Math.min(999, Number(m.p) || 0)); return; }
    if (!client.hello) return;
    switch (m.t) {
      case 'quick': this.quickJoin(client); break;
      case 'create': this.create(client, m); break;
      case 'join': this.join(client, m.code); break;
      case 'list': this.send(client, { t: 'rooms', rooms: this.list(), online: this.clients.size }); break;
      case 'leave': this.leave(client); break;
      default: if (client.room) client.room.handle(client, m); break;
    }
  }

  quickJoin(client) {
    this.leave(client);
    let best = null;
    for (const r of this.rooms.values()) {
      if (r.private || r.clients.size >= MAX_HUMANS) continue;
      if (!best || r.clients.size > best.clients.size) best = r;
    }
    if (!best) best = this.createRoom({ private: false, name: 'Öffentlich', settings: {} });
    if (!best) { this.send(client, { t: 'error', msg: 'Server voll.' }); return; }
    best.addClient(client);
  }

  createRoom(opts) {
    if (this.rooms.size >= this.maxRooms) return null;
    const id = this.makeCode();
    const room = new Room(this, { id, name: opts.name, private: opts.private, settings: sanitizeSettings(opts.settings) });
    this.rooms.set(id, room);
    this.log('Raum ' + id + ' erstellt (' + (room.private ? 'privat' : 'öffentlich') + ')');
    return room;
  }

  create(client, m) {
    this.leave(client);
    const room = this.createRoom({ private: !!m.private, name: (client.name + 's Raum').slice(0, 24), settings: m.settings || {} });
    if (!room) { this.send(client, { t: 'error', msg: 'Zu viele Räume auf dem Server.' }); return; }
    room.addClient(client);
  }

  join(client, code) {
    const room = this.rooms.get(String(code || '').toUpperCase().trim());
    if (!room) { this.send(client, { t: 'error', msg: 'Raum nicht gefunden.' }); return; }
    if (room.clients.size >= MAX_HUMANS) { this.send(client, { t: 'error', msg: 'Der Raum ist voll.' }); return; }
    this.leave(client);
    room.addClient(client);
  }

  leave(client) {
    if (client.room) client.room.removeClient(client);
  }

  list() {
    const out = [];
    for (const r of this.rooms.values()) if (!r.private) out.push(r.info());
    return out;
  }

  cleanup() {
    const now = Date.now();
    for (const [id, r] of this.rooms) {
      if (r.clients.size === 0 && now - r.emptySince > EMPTY_ROOM_MS) {
        r.destroy();
        this.rooms.delete(id);
        this.log('Raum ' + id + ' geschlossen (leer)');
      }
    }
  }

  send(client, msg) { this.sendRaw(client, JSON.stringify(msg)); }
  sendRaw(client, s) {
    const ws = client.ws;
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(s); } catch (e) { /* Verbindung weg */ }
  }

  stats() {
    let humans = 0;
    for (const r of this.rooms.values()) humans += r.clients.size;
    return { rooms: this.rooms.size, players: humans, connections: this.clients.size };
  }

  close() {
    clearInterval(this.timer);
    for (const r of this.rooms.values()) r.destroy();
    this.rooms.clear();
  }
}
