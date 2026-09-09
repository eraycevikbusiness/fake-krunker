// ============================================================
// Spielmodi mit Zielen: Capture the Flag, Hardpoint, Gun Game.
// Jeder Modus haengt am Spiel (game.modeCtl), bekommt update(dt),
// Kill-/Spawn-Ereignisse und liefert Bots ein Ziel (objectiveFor).
// ============================================================

import * as THREE from 'three';
import { GUNGAME_ORDER, WEAPONS } from './weapons.js';
import { audio } from '../core/audio.js';
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

const TEAM_COLOR = { red: 0xd94a4a, blue: 0x4a86d9 };
const ZOMBIE_COLOR = 0x4ad95a;

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
      this.flags[team] = { team, home: { x: d.x, y, z: d.z }, x: d.x, y, z: d.z, state: 'home', carrier: null, dropT: 0, mesh: null };
      this._buildFlagMesh(this.flags[team]);
    }
    this._msgT = 0;
  }

  _buildFlagMesh(f) {
    const col = TEAM_COLOR[f.team];
    const g = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), new THREE.MeshStandardMaterial({ color: 0xd8dde3, roughness: 0.4, metalness: 0.7 }));
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.9, 0.06), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.35, roughness: 0.8 }));
    cloth.position.set(0.8, 2.7, 0);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 0.16, 24), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.5, transparent: true, opacity: 0.55 }));
    base.position.y = 0.08;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 20;
    pole.castShadow = true; cloth.castShadow = true;
    g.add(pole, cloth, beam);
    f.mesh = g; f.cloth = cloth; f.beam = beam;
    // Basismarkierung bleibt immer an der Heimatposition
    const home = new THREE.Group();
    home.add(base);
    home.position.set(f.home.x, f.home.y, f.home.z);
    f.homeMesh = home;
    this.game.scene.add(g, home);
  }

  _say(text, small) { this.game.hud.toast(text, small); }

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
      // Mesh nachziehen
      const m = f.mesh;
      if (f.state === 'carried') {
        const c = f.carrier;
        m.position.set(c.pos.x + Math.sin(c.yaw) * 0.45, c.pos.y + 0.4, c.pos.z + Math.cos(c.yaw) * 0.45);
        m.rotation.set(0.35, c.yaw, 0);
        m.scale.setScalar(0.75);
        f.beam.visible = true;
      } else {
        m.position.set(f.x, f.y, f.z);
        m.rotation.set(0, g.time * 0.6, 0);
        m.scale.setScalar(1);
        f.beam.visible = f.state === 'dropped';
      }
      f.cloth.rotation.y = Math.sin(g.time * 3 + (team === 'red' ? 0 : 1)) * 0.15;
    }
  }

  _pickup(f, a) {
    f.state = 'carried'; f.carrier = a;
    a.carrying = f; a.carryMult = 0.86;
    const g = this.game;
    if (a.isLocal) { this._say('FLAGGE GENOMMEN! ZURÜCK ZUR BASIS'); audio.objective('pickup'); }
    else if (a.team === g.player.team) { this._say(a.name + ' hat die gegnerische Flagge', true); audio.objective('pickup'); }
    else { this._say('GEGNER HAT UNSERE FLAGGE!', true); audio.objective('lost'); }
    if (a.isBot) { a.objectiveDirty = true; g.botChat(a, 'flag'); }
  }

  _drop(f) {
    const c = f.carrier;
    if (c) { c.carrying = null; c.carryMult = 1; }
    f.carrier = null;
    f.state = 'dropped';
    f.dropT = 25;
    const g = this.game;
    f.y = g.world.groundAt(f.x, f.z, f.y + 2) ;
    if (f.team === g.player.team) this._say('FLAGGE FALLEN GELASSEN', true);
    else this._say('GEGNERISCHE FLAGGE LIEGT AM BODEN', true);
  }

  _return(f, by) {
    f.state = 'home'; f.carrier = null;
    f.x = f.home.x; f.y = f.home.y; f.z = f.home.z;
    const g = this.game;
    if (by && by.isLocal) { this._say('FLAGGE ZURÜCKGEBRACHT', true); audio.objective('return'); }
    else if (f.team === g.player.team) { this._say('UNSERE FLAGGE IST ZURÜCK', true); audio.objective('return'); }
  }

  _capture(f, c) {
    const g = this.game;
    c.carrying = null; c.carryMult = 1;
    c.score += 250;
    g.scores[c.team]++;
    f.state = 'home'; f.carrier = null;
    f.x = f.home.x; f.y = f.home.y; f.z = f.home.z;
    if (c.isLocal) { this._say('FLAGGE EROBERT! +250'); audio.objective('capture'); }
    else if (c.team === g.player.team) { this._say(c.name + ' erobert die Flagge!'); audio.objective('capture'); }
    else { this._say('GEGNER EROBERN UNSERE FLAGGE'); audio.objective('lost'); }
    if (g.effects) g.effects.spawnFlash(f.home.x, f.home.y, f.home.z, TEAM_COLOR[c.team]);
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

  dispose() {
    for (const team of ['red', 'blue']) {
      const f = this.flags[team];
      this.game.scene.remove(f.mesh, f.homeMesh);
      f.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
      f.homeMesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
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
    this._buildMesh();
    this._moveTo(0);
  }

  _buildMesh() {
    const g = new THREE.Group();
    this.discMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, 0.3, 32, 1, false), this.discMat);
    disc.position.y = 0.15;
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(this.radius, this.radius, 2.4, 40, 1, true), this.ringMat);
    ring.position.y = 1.2;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    beam.position.y = 30;
    this.beam = beam;
    g.add(disc, ring, beam);
    this.mesh = g;
    this.game.scene.add(g);
  }

  _moveTo(i) {
    this.idx = i % this.points.length;
    const p = this.points[this.idx];
    this.mesh.position.set(p.x, p.y, p.z);
    this.rotateT = 60;
    this.owner = null;
  }

  get zone() { return this.points[this.idx]; }

  update(dt) {
    const g = this.game;
    this.rotateT -= dt;
    if (this.rotateT <= 0) {
      this._moveTo(this.idx + 1);
      g.hud.toast('HARDPOINT WANDERT', true);
      audio.objective('zone');
    }
    const z = this.zone;
    let red = 0, blue = 0, meIn = false;
    for (const a of g.actors) {
      if (!a.alive) continue;
      if (Math.hypot(a.pos.x - z.x, a.pos.z - z.z) > this.radius || Math.abs(a.pos.y - z.y) > 3.5) continue;
      if (a.team === 'red') red++; else blue++;
      if (a.isLocal) meIn = true;
    }
    this.contested = red > 0 && blue > 0;
    const owner = this.contested ? null : red > 0 ? 'red' : blue > 0 ? 'blue' : null;
    if (owner !== this.owner) {
      this.owner = owner;
      if (owner === g.player.team) { g.hud.toast('ZONE GEHALTEN', true); audio.objective('pickup'); }
      else if (owner) { g.hud.toast('GEGNER HALTEN DIE ZONE', true); audio.objective('lost'); }
    }
    this.meIn = meIn;
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
    const col = this.contested ? 0xffcc00 : this.owner === 'red' ? 0xff4444 : this.owner === 'blue' ? 0x4499ff : 0xffffff;
    this.discMat.color.setHex(col); this.ringMat.color.setHex(col); this.beam.material.color.setHex(col);
    // Von innen fast unsichtbar, sonst faerbt der Ring das ganze Bild
    this.ringMat.opacity = meIn ? 0.07 : 0.4;
    this.discMat.opacity = meIn ? 0.06 : 0.2;
    this.mesh.rotation.y += dt * 0.4;
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

  hudText(player) {
    const who = this.contested ? 'UMKÄMPFT' : this.owner === player.team ? 'DEIN TEAM HÄLT' : this.owner ? 'GEGNER HALTEN' : 'FREI';
    const z = this.zone;
    const d = Math.round(Math.hypot(player.pos.x - z.x, player.pos.z - z.z));
    return { line: `HARDPOINT · ${this.game.scores.red} : ${this.game.scores.blue} · Ziel ${this.limit}`, sub: `${who} · wandert in ${Math.ceil(this.rotateT)} s · ${d} m`, inZone: this.meIn };
  }

  minimapItems(out) {
    const z = this.zone;
    out.push({ x: z.x, z: z.z, color: this.contested ? '#ffcc00' : this.owner === 'red' ? '#ff5a5a' : this.owner === 'blue' ? '#5a9aff' : '#ffffff', label: 'HP', zone: this.radius });
  }

  onDeath() {}

  dispose() {
    this.game.scene.remove(this.mesh);
    this.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
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
    const humiliation = causeId === 'knife' || causeId === 'melee' || causeId === 'katana' || causeId === 'tknife';
    if (humiliation && victim.ggLevel > 0 && WEAPONS[causeId] && (causeId === 'knife' || causeId === 'melee')) {
      victim.ggLevel--;
      this.applyLevel(victim);
      if (victim.isLocal) g.hud.toast('STUFE VERLOREN (MESSER)', true);
    }
    const last = this.order.length - 1;
    if (attacker.ggLevel >= last) {
      return true;   // Kill mit der letzten Waffe -> Sieg
    }
    attacker.ggLevel++;
    this.applyLevel(attacker);
    if (attacker.isLocal) {
      g.hud.toast('STUFE ' + (attacker.ggLevel + 1) + '/' + this.order.length + ' · ' + WEAPONS[this.order[attacker.ggLevel]].name.toUpperCase(), true);
      audio.objective('level');
    }
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
  dispose() {}
}

// ------------------------------------------------------------
// Sprite mit Buchstabe (Bombenplaetze A/B), durch Waende sichtbar
// ------------------------------------------------------------
function letterSprite(text, colorHex) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.fill();
  g.lineWidth = 6; g.strokeStyle = colorHex; g.stroke();
  g.font = 'bold 72px Rajdhani, Segoe UI, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = colorHex;
  g.fillText(text, 64, 68);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const sp = new THREE.Sprite(mat);
  sp.renderOrder = 26;
  sp.scale.set(2.2, 2.2, 1);
  return sp;
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
    this.growlT = 0;
    this._lastCount = -1;
  }

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
    if (a.pendingZombie) { a.pendingZombie = false; this._makeZombie(a, false); }
  }

  _makeZombie(a, announce) {
    const g = this.game;
    a.team = 'red';
    a.zombie = true;
    a.setLoadout(['claws']);
    a.maxHp = 130; a.hp = Math.min(a.hp > 0 ? a.hp : 130, 130);
    a.maxArmor = 0; a.armor = 0;
    a.speedMult = a.classDef.speed * 1.22;
    a.maxJumps = Math.max(2, a.maxJumps);
    a.canDash = true;
    g.rebuildActorModel(a);
    if (a.isBot) { a.preferDist = 2; a.objectiveDirty = true; a.target = null; }
    if (a.isLocal) { g.hud.setMyTeam('red'); g.hud.toast('DU BIST INFIZIERT!', false, 'red'); g.hud.toast('Jage die Überlebenden mit den Klauen', true); }
    else if (announce) g.hud.toast(a.name + ' wurde infiziert', true);
    if (announce) audio.growl({ x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z });
  }

  update(dt) {
    const g = this.game;
    if (!this.started) {
      this.startT -= dt;
      const s = Math.ceil(this.startT);
      if (s !== this._lastCount && s > 0 && s <= 5) { this._lastCount = s; g.hud.toast('INFEKTION IN ' + s, true); audio.countdown(s === 1); }
      if (this.startT <= 0) {
        this.started = true;
        const alive = g.actors.slice();
        const n = alive.length >= 10 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const pick = alive.splice((Math.random() * alive.length) | 0, 1)[0];
          this._makeZombie(pick, true);
          g.respawn(pick, true);
        }
        g.hud.toast('DIE INFEKTION BEGINNT', false, 'red');
      }
      return;
    }
    this.roundLen -= dt;
    g.timeLeft = Math.max(0, this.roundLen);
    if (g.over) return;
    // Zombie-Knurren in der Naehe
    this.growlT -= dt;
    if (this.growlT <= 0) {
      this.growlT = 3 + Math.random() * 4;
      const p = g.player;
      const z = g.actors.find(a => a.zombie && a.alive && a !== p && Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 30);
      if (z) audio.growl({ x: z.pos.x, y: z.pos.y + 1.5, z: z.pos.z });
    }
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
      if (victim.isLocal) this.game.hud.toast('DU WIRST ZUM ZOMBIE', true);
    }
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
    this.phase = 'start';       // start | live | end
    this.phaseT = 0;
    this.roundTime = 110;
    this.sites = (mapDef.bombsites && mapDef.bombsites.length ? mapDef.bombsites : (mapDef.hardpoints || []).slice(0, 2).map((p, i) => ({ name: i ? 'B' : 'A', x: p.x, z: p.z })))
      .map((s) => ({ name: s.name, x: s.x, z: s.z, y: game.world.groundAt(s.x, s.z, 60) }));
    if (!this.sites.length) this.sites.push({ name: 'A', x: 0, z: 0, y: game.world.groundAt(0, 0, 60) });
    this.bomb = null;           // { site, x, y, z, t, mesh }
    this.plant = { actor: null, t: 0 };
    this.defuse = { actor: null, t: 0 };
    this.swapped = false;
    this._tickT = 0;
    this._buildMeshes();
    this._startRound();
  }

  _buildMeshes() {
    const g = this.game;
    this.siteMeshes = [];
    for (const s of this.sites) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.5, 0.2, 28), new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false }));
      disc.position.set(s.x, s.y + 0.1, s.z);
      const sp = letterSprite(s.name, '#ffcc00');
      sp.position.set(s.x, s.y + 3.2, s.z);
      g.scene.add(disc, sp);
      this.siteMeshes.push(disc, sp);
    }
    const bm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.5), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.6 }));
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.2), toneMapped: false }));
    led.position.set(0.2, 0.2, 0);
    bm.add(led);
    bm.visible = false;
    this.bombMesh = bm; this.bombLed = led;
    g.scene.add(bm);
  }

  _say(t, small, team) { this.game.hud.toast(t, small, team); }

  _startRound() {
    const g = this.game;
    this.round++;
    this.phase = 'start';
    this.phaseT = 4;
    this.roundTime = 110;
    this.bomb = null;
    this.bombMesh.visible = false;
    this.plant.actor = null; this.plant.t = 0;
    this.defuse.actor = null; this.defuse.t = 0;
    // Seitenwechsel zur Halbzeit
    if (!this.swapped && this.round === this.roundsToWin) {
      this.swapped = true;
      for (const a of g.actors) { a.team = a.team === 'red' ? 'blue' : 'red'; g.rebuildActorModel(a); }
      const s = g.scores.red; g.scores.red = g.scores.blue; g.scores.blue = s;
      g.hud.setMyTeam(g.player.team);
      this._say('SEITENWECHSEL', false, g.player.team);
    }
    for (const a of g.actors) { a.respawnTimer = 0; g.respawn(a, true); a.spawnProtect = 4; }
    this._say('RUNDE ' + this.round, false);
    this._say(g.player.team === 'red' ? 'Lege die Bombe bei A oder B (E halten)' : 'Verteidige A und B', true);
    if (g.player.isLocal) g.hud.hideDeath();
  }

  _endRound(winner, reason) {
    const g = this.game;
    if (this.phase === 'end') return;
    this.phase = 'end';
    this.phaseT = 4;
    g.scores[winner]++;
    for (const a of g.actors) if (a.team === winner && a.alive) a.score += 100;
    const mine = winner === g.player.team;
    this._say((mine ? 'RUNDE GEWONNEN' : 'RUNDE VERLOREN') + ' · ' + reason, false, winner);
    if (mine) audio.objective('capture'); else audio.objective('lost');
    if (this.bomb && reason !== 'BOMBE EXPLODIERT') this.bombMesh.visible = false;
    if (g.scores[winner] >= this.roundsToWin) { this.phase = 'over'; g.endMatch(winner); }
  }

  update(dt) {
    const g = this.game;
    g.timeLeft = Math.max(0, this.phase === 'live' ? (this.bomb ? this.bomb.t : this.roundTime) : this.phaseT);
    if (this.phase === 'over') return;
    if (this.phase === 'start') {
      this.phaseT -= dt;
      for (const a of g.actors) a.spawnProtect = Math.max(a.spawnProtect, 0.05);
      if (this.phaseT <= 0) { this.phase = 'live'; this._say('LOS!', true); audio.countdown(true); }
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
      if (this._tickT <= 0) { this._tickT = rate; audio.bomb('tick', { x: this.bomb.x, y: this.bomb.y + 0.5, z: this.bomb.z }); this.bombLed.visible = !this.bombLed.visible; }
      if (this.bomb.t <= 0) {
        g.explode(this.bomb.x, this.bomb.y + 0.5, this.bomb.z, { radius: 14, damage: 300, minMult: 0.3, force: 18, selfMult: 1 }, null, null, null, 'bomb');
        this.bombMesh.visible = false;
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
    if ((pl.t * 6 | 0) !== ((pl.t - dt) * 6 | 0)) audio.bomb('plant', { x: actor.pos.x, y: actor.pos.y + 1, z: actor.pos.z });
    actor.intent.fwd = 0; actor.intent.side = 0;
    if (pl.t >= 3) {
      const s = this._nearSite(actor);
      this.bomb = { site: s, x: s.x + (actor.pos.x - s.x) * 0.5, y: s.y, z: s.z + (actor.pos.z - s.z) * 0.5, t: 35 };
      this.bombMesh.position.set(this.bomb.x, this.bomb.y + 0.18, this.bomb.z);
      this.bombMesh.visible = true;
      pl.actor = null; pl.t = 0;
      actor.score += 100;
      this._say('BOMBE GELEGT BEI ' + s.name, false, 'red');
      audio.bomb('planted');
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
    if ((df.t * 4 | 0) !== ((df.t - dt) * 4 | 0)) audio.bomb('defuse', { x: actor.pos.x, y: actor.pos.y + 1, z: actor.pos.z });
    actor.intent.fwd = 0; actor.intent.side = 0;
    if (df.t >= 5) {
      this.bombMesh.visible = false;
      this.bomb = null;
      df.actor = null; df.t = 0;
      actor.score += 150;
      audio.bomb('defused');
      this._endRound('blue', 'BOMBE ENTSCHÄRFT');
    }
  }

  /** Keine Respawns waehrend der Runde */
  blocksRespawn(actor) { return this.phase === 'live' || this.phase === 'end'; }

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

  dispose() {
    const g = this.game;
    for (const m of this.siteMeshes) { g.scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) { if (m.material.map) m.material.map.dispose(); m.material.dispose(); } }
    g.scene.remove(this.bombMesh);
  }
}

export function createMode(id, game, mapDef, scoreLimit, timeLimit) {
  if (id === 'ctf') return new CTFMode(game, mapDef, scoreLimit);
  if (id === 'hardpoint') return new HardpointMode(game, mapDef, scoreLimit);
  if (id === 'gungame') return new GunGameMode(game);
  if (id === 'infection') return new InfectionMode(game, mapDef, scoreLimit, timeLimit);
  if (id === 'sd') return new SearchDestroyMode(game, mapDef, scoreLimit);
  return null;
}
