// ============================================================
// Netzprotokoll (Client + Server): Versionsnummer, Zustandsbits,
// Packen/Entpacken der Akteur-Zustaende, Beschreibung eines Akteurs.
// Alles JSON; heisse Pfade (Snapshots, Eingabezustand) als Arrays.
// ============================================================

import { WEAPONS } from '../game/weapons.js';

export const PROTO_VERSION = 3;
export const SNAP_RATE = 20;          // Snapshots pro Sekunde (Server -> Client)
export const STATE_RATE = 30;         // Zustandsmeldungen pro Sekunde (Client -> Server)
export const INTERP_DELAY = 0.1;      // Sekunden Verzoegerung fuer die Interpolation
export const SERVER_TICK = 1 / 60;    // Simulationsschritt auf dem Server
export const MAX_NAME = 16;
export const MAX_CHAT = 120;

export const WEAPON_IDS = Object.keys(WEAPONS);
export const WEAPON_IDX = {};
WEAPON_IDS.forEach((id, i) => { WEAPON_IDX[id] = i; });

/** Zustandsbits eines Akteurs */
export const F = {
  ALIVE: 1, CROUCH: 2, GROUND: 4, SLIDE: 8, SPRINT: 16, ADS: 32, ZIP: 64, GRAPPLE: 128,
  BURN: 256, SHIELD: 512, WALL_L: 1024, WALL_R: 2048, RELOAD: 4096, DASH: 8192,
  HOLD: 16384, FIRE: 32768, CARRY: 65536, SPAWNPROT: 131072,
};

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const r1 = (v) => Math.round(v * 10) / 10;

/** Basis-Id einer Waffe (ohne Aufsatz-Variante) */
export function baseWeaponId(w) { return w ? (w.base ? w.base.id : w.id) : 'ar'; }

/** Zustandsbits aus einem Akteur */
export function flagsOf(a) {
  let f = 0;
  if (a.alive) f |= F.ALIVE;
  if (a.crouching) f |= F.CROUCH;
  if (a.grounded) f |= F.GROUND;
  if (a.sliding) f |= F.SLIDE;
  if (a.sprinting) f |= F.SPRINT;
  if (a.adsAmount > 0.5) f |= F.ADS;
  if (a.zip) f |= F.ZIP;
  if (a.grapple) f |= F.GRAPPLE;
  if (a.burnT > 0) f |= F.BURN;
  if (a.shield > 0) f |= F.SHIELD;
  if (a.wallrun) {
    const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
    f |= (a.wallrun.nx * rx + a.wallrun.nz * rz) > 0 ? F.WALL_L : F.WALL_R;
  }
  if (a.reloadTimer > 0) f |= F.RELOAD;
  if (a.dashT > 0) f |= F.DASH;
  if (a.intent && a.intent.interactHold) f |= F.HOLD;
  if (a.intent && a.intent.fire) f |= F.FIRE;
  if (a.carrying) f |= F.CARRY;
  if (a.spawnProtect > 0) f |= F.SPAWNPROT;
  return f;
}

/**
 * Akteur-Zustand fuer einen Snapshot:
 * [id, x, y, z, yaw, pitch, vx, vy, vz, flags, widx, hp, armor, shield, (gx, gy, gz)]
 */
export function packActor(a) {
  const out = [a.id, r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r3(a.yaw), r3(a.pitch),
    r1(a.vel.x), r1(a.vel.y), r1(a.vel.z), flagsOf(a), WEAPON_IDX[baseWeaponId(a.weapon)] | 0,
    Math.round(a.hp), Math.round(a.armor), Math.round(a.shield || 0)];
  if (a.grapple) out.push(r2(a.grapple.x), r2(a.grapple.y), r2(a.grapple.z));
  return out;
}

/**
 * Eigener Zustand (Client -> Server):
 * [x, y, z, yaw, pitch, vx, vy, vz, flags, widx, height, (gx, gy, gz)]
 */
export function packSelf(a) {
  const out = [r2(a.pos.x), r2(a.pos.y), r2(a.pos.z), r3(a.yaw), r3(a.pitch),
    r1(a.vel.x), r1(a.vel.y), r1(a.vel.z), flagsOf(a), WEAPON_IDX[baseWeaponId(a.weapon)] | 0, r2(a.height)];
  if (a.grapple) out.push(r2(a.grapple.x), r2(a.grapple.y), r2(a.grapple.z));
  return out;
}

/** Beschreibung eines Akteurs beim Beitritt / Roster */
export function describeActor(a) {
  return {
    id: a.id, name: a.name, team: a.team, cls: a.classDef ? a.classDef.id : 'triggerman',
    bot: !!a.isBot, outfit: a.outfit || 'team', hat: a.hat || 'none', skin: a.skin || 0, hair: a.hair || 0,
    fx: a.killEffect || 'none', icon: a.killIcon || 'none',
    skins: a.skins || {}, stickers: a.stickers || {}, att: a.attachments || {},
    kills: a.kills, deaths: a.deaths, score: a.score, streak: a.streak, ping: a.ping | 0,
    gg: a.ggLevel | 0, zombie: !!a.zombie, alive: !!a.alive, hp: Math.round(a.hp), wid: baseWeaponId(a.weapon),
    loadout: a.loadout ? a.loadout.slice() : null, persona: a.personaId || null,
  };
}

/** Kurzer Roster-Eintrag (1 Hz): Punkte, Team, Ping */
export function rosterEntry(a) {
  return [a.id, a.team, a.kills, a.deaths, a.score, a.streak, a.ping | 0, a.ggLevel | 0, a.zombie ? 1 : 0, a.bestStreak | 0, Math.round(a.damageDealt || 0)];
}

/** Namen bereinigen: Laenge, Steuerzeichen */
export function cleanName(s) {
  s = String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME);
  return s || 'Player';
}

export function cleanText(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || MAX_CHAT);
}
