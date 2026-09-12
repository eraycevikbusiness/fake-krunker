// ============================================================
// Netzwerk-Client: WebSocket-Verbindung zum FRAGSTORM-Server,
// Nachrichten buendeln, eigenen Zustand senden, Ping messen.
// ============================================================

import { PROTO_VERSION, packSelf } from './protocol.js';

export class NetClient {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.id = 0;
    this.ping = 0;
    this.serverTime = 0;
    this.outbox = [];           // gebuendelte Nachrichten (pro Frame ein Paket)
    this.relayed = [];          // Ereignisse des eigenen Spielers fuer die anderen
    this.onMessage = null;
    this.onClose = null;
    this._pingTimer = null;
    this._pingSent = 0;
    this._lastRecv = 0;
    this.url = '';
  }

  /** Standard-Adresse: derselbe Host wie die Seite */
  static defaultUrl() {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    return proto + location.host + '/ws';
  }

  connect(url, hello) {
    this.url = url || NetClient.defaultUrl();
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(this.url); } catch (e) { reject(e); return; }
      this.ws = ws;
      let settled = false;
      const fail = (err) => { if (!settled) { settled = true; reject(err || new Error('Keine Verbindung zum Server')); } };
      ws.onopen = () => {
        this.connected = true;
        this._lastRecv = performance.now();
        this.send(Object.assign({ t: 'hello', v: PROTO_VERSION }, hello || {}));
        this._pingTimer = setInterval(() => this._ping(), 2000);
        this._ping();
        if (!settled) { settled = true; resolve(); }
      };
      ws.onerror = () => fail(new Error('Verbindung fehlgeschlagen'));
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
        fail();
        if (was && this.onClose) this.onClose();
      };
      ws.onmessage = (ev) => {
        this._lastRecv = performance.now();
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (Array.isArray(msg)) { for (const m of msg) this._handle(m); }
        else this._handle(msg);
      };
    });
  }

  _handle(m) {
    if (m.t === 'pong') {
      this.ping = Math.round(performance.now() - m.c);
      this.serverTime = m.s;
      return;
    }
    if (m.t === 'welcome') this.id = m.id;
    if (this.onMessage) this.onMessage(m);
  }

  _ping() {
    if (!this.connected) return;
    this.send({ t: 'ping', c: Math.round(performance.now()), p: this.ping });
  }

  /** Sofort senden */
  send(msg) {
    if (!this.connected || this.ws.readyState !== 1) return;
    try { this.ws.send(JSON.stringify(msg)); } catch (e) { /* Verbindung weg */ }
  }

  /** In das naechste Paket einreihen */
  queue(msg) { this.outbox.push(msg); }

  /** Ereignis des eigenen Spielers fuer die anderen vormerken */
  relay(ev) {
    const e = Object.assign({}, ev);
    delete e.a;
    this.relayed.push(e);
  }

  /** Eigenen Zustand (Position, Blick, Flags) plus vorgemerkte Ereignisse senden */
  sendState(player) {
    const msg = { t: 's', d: packSelf(player) };
    if (this.relayed.length) { msg.e = this.relayed; this.relayed = []; }
    this.outbox.push(msg);
  }

  /** Gebuendelte Nachrichten abschicken */
  flush() {
    if (!this.outbox.length) return;
    if (this.connected && this.ws.readyState === 1) {
      try { this.ws.send(JSON.stringify(this.outbox.length === 1 ? this.outbox[0] : this.outbox)); } catch (e) { /* ignorieren */ }
    }
    this.outbox.length = 0;
  }

  close() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    this.onClose = null;
    if (this.ws) { try { this.ws.close(); } catch (e) {} }
    this.ws = null;
    this.connected = false;
    this.outbox.length = 0;
    this.relayed.length = 0;
  }
}
