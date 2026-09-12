// ============================================================
// Game (Client): Renderer + Post-Processing, Darstellung der
// Simulation (Sim): Modelle, Effekte, Sounds, HUD, Killcam, Replay,
// Blut-Decals, Ragdolls. Alle Spielereignisse kommen als Ereignisse
// aus der Simulation (offline) oder vom Server (online) und werden
// hier in _present() sichtbar und hoerbar gemacht.
// ============================================================

import * as THREE from 'three';
import { Sim, STREAK_NAMES, causeName } from './sim.js';
import { World } from '../world/world.js';
import { Effects } from '../fx/effects.js';
import { PostFX } from '../fx/post.js';
import { refreshMaterials, makePropMaterial } from '../fx/materials.js';
import { LocalPlayer } from './player.js';
import { RemoteActor } from './remote.js';
import { Actor, PHYS } from './actor.js';
import { CharacterModel, buildWeaponMesh } from './character.js';
import { ViewModel } from './viewmodel.js';
import { WEAPONS, applyAttachments } from './weapons.js';
import { Training } from './training.js';
import { figureColors } from './cosmetics.js';
import { MODE_BY_ID, createMode } from './modes.js';
import { ModeFx } from './modefx.js';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { teamHex, teamCss, teamAccent, applyTeamCss } from '../core/teams.js';
import { clamp, lerp, rand, pick, damp, deg, angleLerp } from '../core/utils.js';
import { WEAPON_IDS, F } from '../net/protocol.js';

const HAIR_COLORS = [0x2a1e14, 0x120c08, 0x6b4a2c, 0xc9a55a, 0x8a2a1a, 0x3a3a40];
const SHADOW_SIZE = { off: 0, low: 1024, high: 2048, ultra: 4096 };
const SKINS_TONE = [0xd4a985, 0xbd8d63, 0x9a6a42, 0x6e4a2c, 0xcdb090];

const KILLCAM_LEN = 3.0;        // Sekunden Replay vor dem Tod
const HIST_RATE = 1 / 60;       // Aufzeichnungsrate
const HIST_CAP = 260;           // ~4.3 s Ringpuffer

// Ereignisse des eigenen Spielers, die im Online-Match an die anderen weitergereicht werden
const RELAY = new Set(['shot', 'swing', 'throw', 'mhit', 'jump', 'djump', 'land', 'slide', 'dash', 'wallrun', 'grap', 'zip', 'pad', 'reload', 'charge']);

const r1 = (v) => Math.round(v * 10) / 10;

export class Game extends Sim {
  constructor(canvas, hud, minimap, input) {
    super();
    this.canvas = canvas;
    this.hud = hud;
    this.minimap = minimap;
    this.input = input;
    this.net = null;
    this.myId = 0;

    this.dynScale = 1;
    this.frameDt = 0.016;

    this._initRenderer();

    this.hist = { frames: [], head: 0, count: 0, cap: HIST_CAP, lastT: -1 };
    this.killcam = null;
    this.lamps = [];
    this.zipMeshes = [];
    this.ropes = new Map();        // Akteur -> Seil-Mesh (Enterhaken)
    this.dropMeshes = new Map();   // Drop-Id -> {mesh, ring}
    this.projMeshes = new Map();   // Projektil-Id -> Mesh
    this.strikes = [];             // Luftschlag-Markierungen (Rauch, Jet)
    this.modeFx = null;
    this._boardT = 0;
    this._lightningT = 0;
    this._spinSoundT = new Map();
    this._zipSoundT = 0;
    this._prompt = '';
    this._lastCountdown = 0;
    this._hitTint = 0;
    this.muzzleLightT = 0;
    this.rec = null;               // Match-Aufzeichnung (Replay)
    this.replay = null;            // laufende Wiedergabe
    this.replaying = false;
    this._deathInfo = null;
    this._netSendT = 0;

    this.onEnd = null;             // (winner, won) -> main.js
    this.onTrainingEnd = null;
  }

  // --------------------------------------------------------
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      preserveDrawingBuffer: location.search.indexOf('pixeltest') >= 0,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.06, 900);
    this.camera.rotation.order = 'YXZ';

    this.muzzleLight = new THREE.PointLight(0xffb070, 0, 16, 2);
    this.muzzleLight.visible = false;
    this.scene.add(this.muzzleLight);

    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 12);
    const vmKey = new THREE.DirectionalLight(0xfff1de, 2.4);
    vmKey.position.set(-0.6, 1.2, 0.8);
    const vmFill = new THREE.DirectionalLight(0x9fb8ff, 0.9);
    vmFill.position.set(0.9, -0.3, 0.5);
    const vmRim = new THREE.DirectionalLight(0xffffff, 0.8);
    vmRim.position.set(0.2, 0.4, -1.0);
    this.vmScene.add(vmKey, vmFill, vmRim, new THREE.AmbientLight(0xffffff, 0.25));

    this.viewmodel = new ViewModel(this.vmScene);
    this.viewmodel.onInspectLoop = () => { if (this.player) audio.inspect(this.player.weapon.hold); };
    this.post = new PostFX(this.renderer);

    this.applyGraphicsSettings();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  _pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return clamp(dpr * clamp(settings.renderScale, 0.5, 2) * this.dynScale, 0.4, 4);
  }

  setDynScale(s) {
    s = clamp(s, 0.5, 1);
    if (Math.abs(s - this.dynScale) < 0.01) return;
    this.dynScale = s;
    this.renderer.setPixelRatio(this._pixelRatio());
  }

  applyGraphicsSettings() {
    if (!settings.autoQuality) this.dynScale = 1;
    this.renderer.setPixelRatio(this._pixelRatio());

    this.post.enabled = settings.postfx !== false;
    this.post.ssao = settings.ssao !== false;
    this.post.bloom = settings.bloom !== false;
    const tm = this.post.enabled ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    let dirty = false;
    if (this.renderer.toneMapping !== tm) { this.renderer.toneMapping = tm; dirty = true; }

    const ss = SHADOW_SIZE[settings.shadows] || 0;
    const type = settings.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type) { this.renderer.shadowMap.type = type; dirty = true; }
    if (this.renderer.shadowMap.enabled !== (ss > 0)) { this.renderer.shadowMap.enabled = ss > 0; dirty = true; }
    if (this.sun) {
      this.sun.castShadow = ss > 0;
      if (ss > 0 && this.sun.shadow.mapSize.width !== ss) {
        this.sun.shadow.mapSize.set(ss, ss);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
    if (dirty) refreshMaterials();
    if (this.scene) this._applyFog();
    if (this.camera) this.resize();
  }

  _applyFog() {
    const m = this.world && this.world.map;
    if (!m) return;
    if (settings.fog) {
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(m.fogColor, m.fogNear, m.fogFar);
      else { this.scene.fog.color.setHex(m.fogColor); this.scene.fog.near = m.fogNear; this.scene.fog.far = m.fogFar; }
    } else {
      this.scene.fog = null;
    }
  }

  resize() {
    if (!this.camera) return;
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    if (this.minimap) this.minimap.zoom = 1;
  }

  _applyRules() {
    this.rules.killstreaks = settings.killstreaks !== false;
    this.rules.autoReload = !!settings.autoReload;
    this.rules.killEffects = settings.killEffects !== false;
    this.rules.dropWeapons = true;
  }

  // --------------------------------------------------------
  // Teamfarben / -namen (Modus kann sie ueberschreiben, z.B. Infection)
  // --------------------------------------------------------
  teamColor(team) {
    const m = this.modeCtl;
    if (m && m.teamColors && m.teamColors[team]) return m.teamColors[team];
    return teamHex(team);
  }
  teamCssColor(team) {
    const m = this.modeCtl;
    if (m && m.teamHex && m.teamHex[team]) return m.teamHex[team];
    return teamCss(team);
  }
  _applyTeamCss() {
    const m = this.modeCtl;
    const ov = m && m.teamHex ? { red: { css: m.teamHex.red, bg: 'rgba(60,160,60,0.55)' }, blue: { css: m.teamHex.blue, bg: 'rgba(50,110,200,0.55)' } } : null;
    applyTeamCss(document.documentElement, ov);
  }

  /** Modell eines Akteurs neu bauen (Teamwechsel, Outfit) */
  rebuildActorModel(a) {
    if (!this.world) return;
    if (a.model) a.model.dispose();
    a.model = this._makeModel(a);
    if (!a.alive) a.model.setVisible(false);
    if (a.isLocal) {
      this._applyPlayerOutfitToViewmodel();
      this.viewmodel.setWeapon(a.weapon, a.skin, this.skinFor(a), this.stickerFor(a));
    }
  }

  /**
   * Farben der Spielfigur aus Team, Modus und Outfit.
   * Im Teammodus bleibt das Schulterband, der Aermelbund und die
   * Kopfbedeckung in Teamfarbe, damit Gegner erkennbar bleiben.
   */
  _figureColors(actor) {
    const isTeam = this.teamMode;
    const teamCol = isTeam ? this.teamColor(actor.team) : this._ffaColor(actor);
    return figureColors(actor.outfit, teamCol, isTeam, teamAccent(actor.team));
  }

  /** Waffe eines Akteurs (mit seinen Aufsaetzen) fuer eine Waffen-Id */
  weaponOf(a, wid) {
    for (const s of a.slots) if (s.w.id === wid) return s.w;
    const base = WEAPONS[wid] || WEAPONS.ar;
    return a.attachments && a.attachments[wid] ? applyAttachments(base, a.attachments[wid]) : base;
  }

  // --------------------------------------------------------
  // Match aufsetzen (offline, gegen Bots)
  // --------------------------------------------------------
  createWorld(mapDef) { return new World(this.scene, mapDef, this.renderer); }

  start(cfg) {
    this.cleanup();
    this.online = false;
    this.net = null;
    this.myId = 0;
    this._applyRules();
    const training = !!cfg.training;
    this.setupMatch(cfg);
    this._setupScene();

    this.player = new LocalPlayer(this, {
      name: (cfg.name || 'Player').slice(0, 16) || 'Player',
      team: this.teamMode ? 'red' : 'ffa0',
      classId: cfg.classId || 'triggerman',
      attachments: cfg.attachments || {},
    });
    this._applyCosmetics(this.player, cfg);
    if (!this.teamMode) this.player.team = 'ffa' + this.player.id;
    this.actors = [this.player];
    this.myId = this.player.id;

    if (!training) this.addBots(clamp(cfg.bots | 0, 1, 15));
    if (training) this.training = new Training(this, cfg.training);

    this.setupMode();
    this._finishSetup();
    for (const a of this.actors) this.respawn(a, true);
    this._afterStart(cfg, training);

    if (this.training) this.training.start();
    else {
      this.hud.toast('MATCH GESTARTET', true);
      if (this.teamMode) this.hud.toast('DU BIST TEAM ' + this.teamName(this.player.team), false, this.player.team);
      if (this.modeCtl && MODE_BY_ID[this.mode]) this.hud.toast(MODE_BY_ID[this.mode].name.toUpperCase(), true);
      const talker = this.actors.find(a => a.isBot);
      const mid = this._matchId;
      if (talker) setTimeout(() => { if (this._matchId === mid && this.running) this.botChat(talker, 'start'); }, 1500);
    }
  }

  _applyCosmetics(a, cfg) {
    a.thirdPerson = settings.thirdPerson;
    a.skins = cfg.skins || {};
    a.stickers = cfg.stickers || {};
    a.outfit = cfg.outfit || 'team';
    a.hat = cfg.hat || 'none';
    a.killEffect = cfg.killEffect || 'none';
    a.killIcon = cfg.killIcon || 'none';
  }

  /** Szene fuer die Karte: Licht, Wetter, Seilbahnen, Effekte, Minimap */
  _setupScene() {
    const mapDef = this.mapDef, wx = this.weather;
    this.vmScene.environment = this.scene.environment;
    this._applyFog();
    this._setupLights(mapDef);
    this._setupWeather(wx);
    this._buildZiplines(mapDef);
    this.minimap.build(mapDef);
    this.effects = new Effects(this.scene);
    this.viewmodel.setFlashTexture(this.effects.flashTex);
    this.effects.setRain(!!wx.rain);
    audio.rain(!!wx.rain);
    for (const p of this.pickups) this._buildPickupMesh(p);
  }

  /** Modelle, Teamfarben, Modus-Darstellung */
  _finishSetup() {
    for (const a of this.actors) { if (a.model) a.model.dispose(); a.model = this._makeModel(a); }
    this._applyTeamCss();
    if (this.modeFx) this.modeFx.dispose();
    this.modeFx = this.modeCtl ? new ModeFx(this, this.modeCtl) : null;
  }

  _afterStart(cfg, training) {
    this.player.applyCamera(this.camera, this.world, 0.016);
    this.camera.updateMatrixWorld();
    this.hist = { frames: [], head: 0, count: 0, cap: HIST_CAP, lastT: -1 };
    this.killcam = null;
    this._deathInfo = null;
    this.hud.clearFloating();
    this.hud.show(true);
    this.hud.hideDeath();
    this.hud.setKillcam(null);
    this.hud.setTraining(null);
    this.hud.setMyTeam(this.teamMode ? this.player.team : null);
    this.hud.setMinimapVisible(settings.showMinimap);
    this.running = true;
    this.paused = false;
    this._lastCountdown = 0;

    // Aufzeichnung fuer das Replay (20 Hz, alle Akteure)
    this.rec = training ? null : {
      rate: 1 / 20, lastT: -1, frames: [],
      meta: { map: this.mapId, weather: this.weatherId, mode: this.mode, scoreLimit: this.scoreLimit, weaponIds: WEAPON_IDS, actors: [] },
    };
    if (this.rec) for (const a of this.actors) this._recAddActor(a);
  }

  // --------------------------------------------------------
  // Online-Match: der Server ist die Autoritaet
  // --------------------------------------------------------
  /** w = welcome/match-Nachricht des Servers */
  startOnline(net, w) {
    this.cleanup();
    this.online = true;
    this.net = net;
    this.myId = w.id;
    this._applyRules();
    const m = w.match;
    this.setupMatch({ mode: m.mode, map: m.map, weather: m.weather, scoreLimit: m.scoreLimit, timeLimit: m.timeLimit / 60 });
    this.timeLeft = m.timeLeft;
    this.scores.red = m.scores[0]; this.scores.blue = m.scores[1];
    this._setupScene();

    this.actors = [];
    for (const d of w.actors) this._addNetActor(d, true);
    this.player = this.actorById(this.myId);
    if (!this.player) throw new Error('Eigener Spieler fehlt in der Willkommensnachricht');
    this.player.alive = false;

    this.modeCtl = createMode(this.mode, this, this.mapDef, this.scoreLimit, this.timeLimit);
    for (const d of w.actors) this._applyDescriptorMode(this.actorById(d.id), d);
    if (this.modeCtl && w.mode) this.modeCtl.applyNetState(w.mode);
    for (const i of w.pickupsOff || []) if (this.pickups[i]) this.pickups[i].active = false;
    for (const ev of w.drops || []) this._applyNetEvent(ev);
    for (const i of w.destr || []) if (this.world.destructibles[i]) this.world.setDestroyed(this.world.destructibles[i], true);
    this._finishSetup();
    for (const a of this.actors) if (a.model) a.model.setVisible(a.alive);
    this.viewmodel.setHidden(true);
    // Bis zum ersten Spawn an einem Spawnpunkt des Teams stehen (Kamera nicht im Nichts)
    const sp = this.findSpawn(this.player);
    this.player.pos.x = sp.x; this.player.pos.y = sp.y; this.player.pos.z = sp.z; this.player.yaw = sp.yaw;
    this.player.applyCamera(this.camera, this.world, 0.016);
    this._afterStart({}, false);
    if (this.rec) this.rec.online = true;
    // Runde laeuft ohne Respawn (S&D): bis zur naechsten Runde zuschauen
    if (!w.end && this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(this.player)) {
      this.player.respawnTimer = 99999;
      this.hud.showDeath(null, 'Beigetreten · du spielst ab der nächsten Runde mit', null, Infinity);
    }
    this.hud.toast('MATCH BEIGETRETEN', true);
    if (this.teamMode) this.hud.toast('DU BIST TEAM ' + this.teamName(this.player.team), false, this.player.team);
    if (this.modeCtl && MODE_BY_ID[this.mode]) this.hud.toast(MODE_BY_ID[this.mode].name.toUpperCase(), true);
    if (w.end) { this.over = true; this.running = false; }
  }

  /** Akteur aus einer Server-Beschreibung anlegen (lokal oder entfernt) */
  _addNetActor(d, initial) {
    if (this.actorById(d.id)) return this.actorById(d.id);
    const opts = { id: d.id, name: d.name, team: d.team, classId: d.cls, attachments: d.att || {} };
    let a;
    if (d.id === this.myId) { a = new LocalPlayer(this, opts); a.thirdPerson = settings.thirdPerson; }
    else { a = new RemoteActor(this, opts); a.isBot = !!d.bot; }
    a.skins = d.skins || {}; a.stickers = d.stickers || {};
    a.outfit = d.outfit || 'team'; a.hat = d.hat || 'none';
    a.skin = d.skin || pick(SKINS_TONE); a.hair = d.hair || pick(HAIR_COLORS);
    a.killEffect = d.fx || 'none'; a.killIcon = d.icon || 'none';
    a.kills = d.kills | 0; a.deaths = d.deaths | 0; a.score = d.score | 0; a.streak = d.streak | 0; a.ping = d.ping | 0;
    a.ggLevel = d.gg | 0; a.zombie = !!d.zombie; a.personaId = d.persona || null;
    a.alive = false;
    this.actors.push(a);
    if (!initial) {
      if (this.modeCtl) this._applyDescriptorMode(a, d);
      a.model = this._makeModel(a);
      a.model.setVisible(false);
      if (this.rec) this._recAddActor(a);
      this.hud.toast(a.name + ' ist beigetreten', true);
    }
    return a;
  }

  /** Modus-Zustand eines Akteurs aus der Beschreibung (Gun-Game-Stufe, Zombie) */
  _applyDescriptorMode(a, d) {
    if (!a || !this.modeCtl) return;
    if (this.modeCtl.id === 'gungame') { a.ggLevel = d.gg | 0; this.modeCtl.applyLevel(a); }
    else if (this.modeCtl.id === 'infection') { a.zombie = false; if (d.zombie) this.modeCtl.makeZombie(a, false); else a.team = 'blue'; }
    if (d.loadout && this.modeCtl.id !== 'gungame' && this.modeCtl.id !== 'infection') a.setLoadout(d.loadout);
  }

  _removeNetActor(id) {
    const a = this.actorById(id);
    if (!a) return;
    if (a.model) a.model.dispose();
    const rope = this.ropes.get(a);
    if (rope) { this.scene.remove(rope); this.ropes.delete(a); }
    if (a.carrying) { a.carrying.carrier = null; a.carrying = null; }
    this.actors.splice(this.actors.indexOf(a), 1);
    this.hud.toast(a.name + ' hat das Match verlassen', true);
  }

  /** Nachricht vom Server */
  onNet(msg) {
    switch (msg.t) {
      case 'snap': this._applySnapshot(msg); break;
      case 'ev': for (const ev of msg.e) { this._applyNetEvent(ev); this._present(ev); } break;
      case 'join': this._addNetActor(msg.a, false); break;
      case 'leave': this._removeNetActor(msg.id); break;
      case 'roster': this._applyRoster(msg.r); break;
      case 'end': this._netEnd(msg); break;
      default: break;
    }
  }

  _applySnapshot(s) {
    if (!this.world) return;
    this.timeLeft = s.tl;
    this.scores.red = s.sc[0]; this.scores.blue = s.sc[1];
    for (const e of s.a) {
      const a = this.actorById(e[0]);
      if (!a) continue;
      if (a === this.player) {
        a.hp = e[11]; a.armor = e[12]; a.shield = e[13];
        if (a.armor > a.maxArmor) a.maxArmor = a.armor;
      } else if (a.isRemote) {
        a.pushSnapshot(s.s, e);
      }
    }
    // Killstreak-Zustand (UAV, Luftschlaege, Schild)
    if (s.k) {
      for (const k of s.k) {
        const a = this.actorById(k[0]);
        if (!a) continue;
        a.uavUntil = k[1] > 0 ? this.time + k[1] : -1;
        a.airstrikes = k[2] | 0;
        if (k[3] > 0) a.shieldT = k[3];
      }
    }
    // Projektile spiegeln
    if (s.p) {
      for (const e of s.p) {
        let p = null;
        for (const q of this.projectiles) if (q.id === e[0]) { p = q; break; }
        if (!p) {
          const w = WEAPONS[WEAPON_IDS[e[1]]] || WEAPONS.grenade;
          p = { id: e[0], weapon: w, def: w.projectile, x: e[2], y: e[3], z: e[4], vx: 0, vy: 0, vz: 0, spin: w.projectile && w.projectile.knife ? 0 : null, isGrenade: !!(w.projectile && w.projectile.fuse !== undefined), owner: null };
          this.projectiles.push(p);
        }
        p.tx = e[2]; p.ty = e[3]; p.tz = e[4]; p.vx = e[5]; p.vy = e[6]; p.vz = e[7];
        p.seen = true;
      }
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i];
        if (!p.seen) this.projectiles.splice(i, 1); else p.seen = false;
      }
    }
    if (this.modeCtl && s.m !== undefined) this.modeCtl.applyNetState(s.m);
  }

  _applyRoster(rows) {
    let teamChanged = false;
    for (const r of rows) {
      const a = this.actorById(r[0]);
      if (!a) continue;
      if (a.team !== r[1]) { a.team = r[1]; teamChanged = true; if (a.model) this.rebuildActorModel(a); }
      a.kills = r[2]; a.deaths = r[3]; a.score = r[4]; a.streak = r[5]; a.ping = r[6];
      a.ggLevel = r[7]; a.zombie = !!r[8]; a.bestStreak = r[9]; a.damageDealt = r[10];
    }
    if (teamChanged && this.player) this.hud.setMyTeam(this.teamMode ? this.player.team : null);
  }

  /** Zustand aus einem Server-Ereignis spiegeln (vor der Darstellung) */
  _applyNetEvent(ev) {
    const g = this;
    switch (ev.t) {
      case 'spawn': {
        const a = g.actorById(ev.a);
        if (!a) break;
        if (a === g.player) {
          if (ev.cls && a.classDef.id !== ev.cls) a.setClass(ev.cls);
          a.pendingClassId = null;
          if (g.modeCtl && g.modeCtl.id === 'gungame') g.modeCtl.applyLevel(a);
          a.spawn({ x: ev.x, y: ev.y, z: ev.z, yaw: ev.yaw });
        } else if (a.isRemote) {
          if (ev.cls && a.classDef.id !== ev.cls) a.setClass(ev.cls);
          a.spawnAt(ev.x, ev.y, ev.z, ev.yaw);
        }
        break;
      }
      case 'kill': {
        const v = g.actorById(ev.v), a = ev.a ? g.actorById(ev.a) : null;
        g.scores.red = ev.sc[0]; g.scores.blue = ev.sc[1];
        if (a) { a.kills = ev.ak; a.streak = ev.st; a.bestStreak = Math.max(a.bestStreak, ev.st); a.score += ev.pts; }
        if (!v) break;
        v.deaths = ev.vd; v.streak = 0;
        if (v === g.player) {
          v.alive = false; v.hp = 0;
          v.respawnTimer = ev.rt < 0 ? 99999 : ev.rt;
          v.intent.fire = false; v.sliding = false; v.wallrun = null; v.burnT = 0; v.chargeT = 0; v.spinT = 0;
          if (v.grapple) v._releaseGrapple(false);
          if (v.zip) v._detachZip(false);
          if (v.onDeath) v.onDeath(a);
        } else {
          v.alive = false; v.hp = 0;
          if (v.grapple) v.grapple = null;
          v.zip = null;
        }
        if (v.carrying) { v.carrying.carrier = null; v.carrying = null; v.carryMult = 1; }
        break;
      }
      case 'pickup': {
        const p = g.pickups[ev.i];
        if (p) p.active = false;
        const a = g.actorById(ev.a);
        if (a === g.player) {
          if (ev.k === 'ammo') a.addAmmo();
          else if (ev.k === 'armor') a.maxArmor = Math.max(a.maxArmor, 50);
        }
        break;
      }
      case 'pkon': { const p = g.pickups[ev.i]; if (p) p.active = true; break; }
      case 'dadd': {
        if (g.drops.some(d => d.id === ev.id)) break;
        const base = WEAPONS[ev.w] || WEAPONS.ar;
        const w = ev.att && ev.att.length ? applyAttachments(base, ev.att) : base;
        g.drops.push({ id: ev.id, w, mag: ev.mag, reserve: ev.res, x: ev.x, y: ev.y, z: ev.z, rot: ev.rot, t: ev.life, skin: ev.skin, sticker: ev.sticker });
        break;
      }
      case 'drm': case 'dtake': {
        const i = g.drops.findIndex(d => d.id === ev.id);
        if (i >= 0) g.drops.splice(i, 1);
        if (ev.t === 'dtake') {
          const a = g.actorById(ev.a);
          if (!a) break;
          const base = WEAPONS[ev.w] || WEAPONS.ar;
          const w = ev.att && ev.att.length ? applyAttachments(base, ev.att) : base;
          if (a.skins) a.skins[w.id] = ev.skin;
          if (a.stickers) a.stickers[w.id] = ev.sticker;
          if (a === g.player) {
            a.slots[ev.slot] = { w, mag: ev.mag, reserve: ev.res, pendingSingle: 0 };
            if (ev.cur) { a.reloadTimer = 0; a.chargeT = 0; a.spinT = 0; a.switchTimer = w.switchTime || 0.4; g.onWeaponSwitch(a); }
          }
        }
        break;
      }
      case 'destr': { const c = g.world.destructibles[ev.i]; if (c) g.world.setDestroyed(c, true); break; }
      case 'restore': { const c = g.world.destructibles[ev.i]; if (c) g.world.setDestroyed(c, false); break; }
      case 'push': {
        const a = g.actorById(ev.a);
        if (a === g.player && a.alive) { a.vel.x += ev.v[0]; a.vel.y += ev.v[1]; a.vel.z += ev.v[2]; a.grounded = false; a.coyote = 0; }
        break;
      }
      case 'streak': {
        const a = g.actorById(ev.a);
        if (!a) break;
        if (ev.r === 'uav') a.uavUntil = g.time + 14;
        else if (ev.r === 'shield') { a.shield = 80; a.shieldT = 14; }
        else if (ev.r === 'airstrike') a.airstrikes++;
        break;
      }
      case 'mode': {
        const m = g.modeCtl;
        if (!m) break;
        if (ev.m === 'gg' && (ev.k === 'level' || ev.k === 'lost')) {
          const a = g.actorById(ev.a);
          if (a) { a.ggLevel = ev.lvl; if (a === g.player) m.applyLevel(a); }
        } else if (ev.m === 'inf' && ev.k === 'infect') {
          const a = g.actorById(ev.a);
          if (a && !a.zombie) m.makeZombie(a, false);
        } else if (ev.m === 'inf' && ev.k === 'start') {
          m.started = true;
        } else if (ev.m === 'sd' && ev.k === 'swap') {
          for (const [id, team] of ev.teams) { const a = g.actorById(id); if (a && a.team !== team) { a.team = team; g.rebuildActorModel(a); } }
          g.scores.red = ev.sc[0]; g.scores.blue = ev.sc[1];
          m.swapped = true;
        } else if (ev.m === 'sd' && ev.k === 'end') {
          g.scores.red = ev.sc[0]; g.scores.blue = ev.sc[1];
        } else if (ev.m === 'ctf' && ev.k === 'capture') {
          g.scores.red = ev.sc[0]; g.scores.blue = ev.sc[1];
        }
        break;
      }
      default: break;
    }
  }

  /** Match zu Ende (Server) */
  _netEnd(msg) {
    this.over = true;
    this.running = false;
    this._applyRoster(msg.r || []);
    let winner = msg.w;
    if (typeof winner === 'number') winner = this.actorById(winner);
    const won = !this.teamMode ? winner === this.player : winner === this.player.team;
    this.winner = winner;
    this.onMatchEnd(winner, won);
  }

  // ---- Online: Meldungen an den Server ----
  remoteDamage(victim, attacker, amount, causeId, hit) {
    if (!this.net) return null;
    if (attacker === this.player) {
      this.net.queue({
        t: 'hit', v: victim.id, w: causeId, h: hit && hit.head ? 1 : 0, n: r1(amount),
        p: hit ? [r1(hit.x), r1(hit.y), r1(hit.z)] : [r1(victim.pos.x), r1(victim.pos.y + 1.2), r1(victim.pos.z)],
        d: hit ? [r1(hit.dirx), r1(hit.diry), r1(hit.dirz)] : [0, 0, 1], b: hit && hit.back ? 1 : 0,
        l: hit && hit.legs ? 1 : 0, hv: hit && hit.heavy ? 1 : 0,
      });
      // Vorhersage fuer Trefferanzeige und Schadenszahlen
      const before = victim.hp + victim.armor + (victim.shield || 0);
      const predicted = Math.round(Math.min(amount, Math.max(0, before)));
      const killed = before - amount <= 0.5;
      const hx = hit ? hit.x : victim.pos.x, hy = hit ? hit.y : victim.pos.y + 1.2, hz = hit ? hit.z : victim.pos.z;
      this._present({
        t: 'dmg', v: victim.id, a: attacker.id, n: predicted, h: !!(hit && hit.head), c: causeId, x: hx, y: hy, z: hz,
        d: hit ? [hit.dirx, hit.diry, hit.dirz] : [0, 0.3, 1], q: !!(hit && hit.noPopup), s: hit && hit.strength ? hit.strength : 0, k: killed, pred: true,
      });
      // Lebenspunkte lokal mitfuehren, damit Folgetreffer (Schrot) den Kill richtig vorhersagen
      victim.applyDamage(amount);
      if (victim.hp < 0) victim.hp = 0;
      return { killed, damage: predicted };
    }
    if (victim === this.player && !attacker) {
      this.net.queue({ t: 'hurt', n: Math.round(amount), c: causeId });
      return null;
    }
    return null;
  }
  remoteWorldDamage(col, dmg) { if (this.net) this.net.queue({ t: 'wdmg', i: col._d, n: Math.round(dmg) }); }
  remoteInteract(actor, ia) {
    if (!this.net || actor !== this.player) return;
    if (ia.type === 'drop') this.net.queue({ t: 'use', k: 'drop', id: ia.d.id });
  }
  remoteAirstrike(actor, eye, dir) {
    if (!this.net || actor !== this.player) return;
    this.net.queue({ t: 'strike', o: [r1(eye.x), r1(eye.y), r1(eye.z)], d: [Math.round(dir.x * 1000) / 1000, Math.round(dir.y * 1000) / 1000, Math.round(dir.z * 1000) / 1000] });
  }
  sendChat(text) { if (this.net) this.net.send({ t: 'chat', text }); }

  /** Klasse beim naechsten Spawn wechseln (offline lokal, online per Server) */
  setPendingClass(id) {
    if (!this.player) return;
    this.player.pendingClassId = id;
    if (this.online && this.net) this.net.send({ t: 'cls', cls: id, att: this.player.attachments || {} });
  }

  /** Zustand des eigenen Spielers senden (30 Hz) */
  netUpdate(dt) {
    if (!this.online || !this.net || !this.player) return;
    this._netSendT -= dt;
    if (this._netSendT <= 0) {
      this._netSendT = 1 / 30;
      this.net.sendState(this.player);
    }
    this.net.flush();
  }

  // --------------------------------------------------------
  // Ereignisse: emit() aus der Simulation -> Darstellung (+ Weiterleitung online)
  // --------------------------------------------------------
  emit(ev) {
    this._present(ev);
    if (this.online && this.net && this.player && ev.a === this.player.id && RELAY.has(ev.t)) this.net.relay(ev);
  }

  _soundPos(a, h) { return a === this.player ? null : { x: a.pos.x, y: a.pos.y + (h === undefined ? 1.5 : h), z: a.pos.z }; }

  _present(ev) {
    if (!this.world) return;
    const me = this.player;
    const byId = (id) => this.actorById(id);
    switch (ev.t) {
      // ---------------- Waffen ----------------
      case 'shot': {
        const a = byId(ev.a);
        if (!a) break;
        const w = this.weaponOf(a, ev.w);
        const local = a === me;
        a.lastShotTime = this.time;
        audio.shot(this._soundPos(a, 1.6), w.charge ? Object.assign({ power: ev.p }, w.sound) : w.sound);
        const muzzle = this.muzzleWorld(a, this._muzzle);
        const dx = ev.d[0], dy = ev.d[1], dz = ev.d[2];
        if (local) {
          if (w.throwWeapon) this.viewmodel.throwKnife(w.reloadTime);
          else this.viewmodel.fire(w.flame ? 0.15 : 1);
          a.addRecoil(deg(w.recoilV) * rand(0.75, 1.15) * ev.p, deg(w.recoilH) * rand(-1, 1));
          a.addShake(w.kick * 1.4);
          if (!w.flame && !w.throwWeapon && !w.charge && !w.suppressed) {
            this.muzzleLight.position.copy(muzzle);
            this.muzzleLight.visible = true;
            this.muzzleLightT = 1;
          }
          if (!w.projectile && !w.flame && this.effects) {
            const right = this._v3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
            this.effects.shell(
              muzzle.x - dx * 0.9 + right.x * 0.12, muzzle.y - dy * 0.9 + 0.05, muzzle.z - dz * 0.9 + right.z * 0.12,
              right.x * rand(2, 4) + a.vel.x, rand(2, 4) + a.vel.y, right.z * rand(2, 4) + a.vel.z
            );
          }
        } else {
          if (a.model) a.model.triggerRecoil(w.flame ? 0.1 : 0.8);
          if (this.effects && !w.flame && !w.throwWeapon && !w.charge && !w.suppressed) {
            this.effects.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, dx, dy, dz, 0.7);
          }
        }
        if (ev.f && this.effects) this.effects.flame(muzzle.x, muzzle.y, muzzle.z, dx, dy, dz);
        if (ev.e) {
          const pellets = ev.e.length;
          for (let i = 0; i < pellets; i++) {
            const e = ev.e[i];
            if (this.effects && (pellets === 1 || i % 2 === 0)) this.effects.tracer(muzzle.x, muzzle.y, muzzle.z, e[0], e[1], e[2], w.tracer, w.tracerWidth);
            const ddx = e[0] - ev.o[0], ddy = e[1] - ev.o[1], ddz = e[2] - ev.o[2];
            const len = Math.hypot(ddx, ddy, ddz) || 1;
            if (e[3] === 1) {
              if (this.effects) this.effects.impact(e[0], e[1], e[2], e[4], e[5], e[6]);
              audio.impact({ x: e[0], y: e[1], z: e[2] });
            } else if (e[3] === 2 || e[3] === 3) {
              if (this.effects) this.effects.blood(e[0], e[1], e[2], ddx / len, ddy / len, ddz / len, e[3] === 3);
              this._bloodOnWorld(e[0], e[1], e[2], ddx / len, ddy / len, ddz / len, w.damage, e[3] === 3);
              audio.flesh({ x: e[0], y: e[1], z: e[2] });
            }
            if (!local) this._whizzCheck(ev.o, ddx / len, ddy / len, ddz / len, len);
          }
        }
        break;
      }
      case 'hits': {
        const a = byId(ev.a);
        if (a !== me) break;
        const w = a.weapon;
        const anyKill = ev.v.some(v => v[6]);
        const anyHead = ev.v.some(v => v[5]);
        const throttle = w.flame && (this.time - (a._lastHitmark || -9)) < 0.2 && !anyKill;
        if (throttle) break;
        for (const v of ev.v) if (v[1] > 0) this.hud.popup(v[2], v[3], v[4], v[1], v[6] ? 'kill' : v[5] ? 'head' : '');
        a._lastHitmark = this.time;
        this.hud.hitmarker(anyKill ? 'kill' : anyHead ? 'head' : 'hit');
        audio.hitmarker(anyHead, anyKill, ev.d);
        this._hitTint = 0.14;
        break;
      }
      case 'swing': {
        const a = byId(ev.a);
        if (!a) break;
        audio.swing(this._soundPos(a), ev.k, ev.h);
        if (a === me) this.viewmodel.melee(ev.w === 'melee' ? 'bash' : (ev.h ? ev.sw : null), ev.st);
        if (a.model) a.model.triggerSwing(ev.st, ev.sw);
        break;
      }
      case 'throw': {
        const a = byId(ev.a);
        if (!a) break;
        audio.click(this._soundPos(a), 700, 0.25, 0.08);
        if (a === me) this.viewmodel.melee('throw');
        if (a.model) a.model.triggerSwing(0.4);
        break;
      }
      case 'dmg': {
        // Online: eigene Hitscan-/Nahkampftreffer sind schon vorhergesagt
        if (this.online && !ev.pred && ev.a === this.myId) {
          const wc = WEAPONS[ev.c];
          if (wc && !wc.projectile) break;
          if (ev.c === 'melee' || ev.c === 'flame') break;
        }
        const v = byId(ev.v), a = ev.a ? byId(ev.a) : null;
        if (!v) break;
        if (v.model && v !== me) v.model.flash(ev.k ? 1.2 : clamp(0.35 + ev.n / 60, 0.35, 0.9), ev.k);
        if (a === me && v !== me && !ev.q) this.hud.popup(ev.x, ev.y, ev.z, ev.n, ev.k ? 'kill' : ev.h ? 'head' : '');
        if (v === me) {
          this.hud.damageFlash(clamp(ev.n / 55, 0.18, 0.75));
          me.addShake(clamp(ev.n / 90, 0.05, 0.5));
          if (a && a !== v) {
            const ang = Math.atan2(a.pos.x - v.pos.x, -(a.pos.z - v.pos.z)) - v.yaw;
            this.hud.damageDir(-ang);
          }
        }
        break;
      }
      case 'mhit': {
        const a = byId(ev.a);
        if (!a) break;
        if (ev.tr) {
          if (a === me) { this.hud.hitmarker('hit'); audio.hitmarker(false, false, ev.dist); this.viewmodel.hitKick(ev.h); this._hitTint = 0.16; }
          break;
        }
        if (this.effects) {
          this.effects.blood(ev.x, ev.y, ev.z, ev.d[0], ev.d[1], ev.d[2], true);
          if (ev.h) this.effects.blood(ev.x, ev.y, ev.z, ev.d[0], ev.d[1] + 0.4, ev.d[2], true);
        }
        this._bloodOnWorld(ev.x, ev.y, ev.z, ev.d[0], ev.d[1], ev.d[2], ev.n || 60, true);
        audio.meleeHit(a === me ? null : { x: ev.x, y: ev.y, z: ev.z }, ev.k, ev.h);
        if (a === me) {
          this.hud.hitmarker(ev.killed ? 'kill' : ev.head ? 'head' : 'hit');
          audio.hitmarker(ev.head, ev.killed, ev.dist);
          a.addShake(ev.h ? 0.5 : 0.25);
          this.viewmodel.hitKick(ev.h);
          this._hitTint = 0.16;
        }
        break;
      }
      case 'mwall': {
        if (this.effects) this.effects.impact(ev.x, ev.y, ev.z, ev.n[0], ev.n[1], ev.n[2]);
        if (ev.a === this.myId) this.viewmodel.hitKick(ev.h);
        break;
      }
      case 'kill': this._presentKill(ev); break;
      case 'spawn': {
        const a = byId(ev.a);
        if (!a) break;
        if (a.model) {
          a.model.resetDeath();
          a.model.setWeapon(a.weapon, this.skinFor(a), this.stickerFor(a));
          a.model.setVisible(!a.isLocal || a.thirdPerson || settings.thirdPerson);
        }
        if (this.effects) {
          const col = !this.teamMode ? this._ffaColor(a) : this.teamColor(a.team);
          this.effects.spawnFlash(a.pos.x, a.pos.y, a.pos.z, col);
        }
        if (a === me) {
          this.endKillcam();
          this.hud.hideDeath();
          this._applyPlayerOutfitToViewmodel();
          this.viewmodel.setWeapon(a.weapon, a.skin, this.skinFor(a), this.stickerFor(a));
          this.viewmodel.setHidden(false);
          if (!ev.init) { audio.tone(540, 0.09, 0.2, 'sine'); audio.draw(null, a.weapon.hold); }
        }
        break;
      }
      case 'explode': {
        if (this.effects) this.effects.explosion(ev.x, ev.y, ev.z, ev.r * 0.55);
        audio.explosion({ x: ev.x, y: ev.y, z: ev.z });
        this.muzzleLight.position.set(ev.x, ev.y + 0.5, ev.z);
        this.muzzleLight.visible = true;
        this.muzzleLightT = 2.2;
        if (me && me.alive) {
          const d = Math.hypot(me.pos.x - ev.x, me.pos.y - ev.y, me.pos.z - ev.z);
          if (d < ev.r * 3.5) me.addShake(clamp(1.4 - d / (ev.r * 3.5), 0, 1) * 1.1);
        }
        break;
      }
      case 'pimp': {
        if (ev.v) {
          if (this.effects) this.effects.blood(ev.x, ev.y, ev.z, ev.d[0], ev.d[1], ev.d[2], ev.head);
          this._bloodOnWorld(ev.x, ev.y, ev.z, ev.d[0], ev.d[1], ev.d[2], 60, ev.head || ev.killed);
          audio.flesh({ x: ev.x, y: ev.y, z: ev.z });
          if (ev.a === this.myId && me) {
            this.hud.hitmarker(ev.killed ? 'kill' : ev.head ? 'head' : 'hit');
            audio.hitmarker(ev.head, ev.killed, Math.hypot(ev.x - me.pos.x, ev.z - me.pos.z));
            this._hitTint = 0.14;
          }
        } else {
          if (this.effects) this.effects.impact(ev.x, ev.y, ev.z, -ev.d[0], -ev.d[1], -ev.d[2], ev.c);
          if (ev.kn || ev.ar) audio.impact({ x: ev.x, y: ev.y, z: ev.z }, true);
        }
        break;
      }
      case 'bounce': audio.impact({ x: ev.x, y: ev.y, z: ev.z }, false); break;
      case 'destr': {
        const c = this.world.destructibles[ev.i];
        if (!c) break;
        const d = c.destr;
        if (ev.k === 'glass') {
          const w = Math.max(d.w, d.d), nx = d.w < d.d ? 1 : 0, nz = nx ? 0 : 1;
          if (this.effects) this.effects.glass(ev.x, ev.y, ev.z, nx, 0, nz, w, d.h);
          audio.breakGlass({ x: ev.x, y: ev.y, z: ev.z });
        } else if (ev.k === 'barrel') {
          if (this.effects) this.effects.splinters(ev.x, ev.y, ev.z, 0x6a2a20, 0.8);
          audio.breakWood({ x: ev.x, y: ev.y, z: ev.z });
        } else {
          if (this.effects) this.effects.splinters(ev.x, ev.y, ev.z, d.color, d.w / 2.4);
          audio.breakWood({ x: ev.x, y: ev.y, z: ev.z });
        }
        break;
      }
      case 'restore': break;
      case 'streak': {
        const a = byId(ev.a);
        if (!a) break;
        const r = ev.r;
        if (a === me) {
          if (r === 'uav') { this.hud.toast('UAV AKTIV · GEGNER AUF DEM RADAR'); audio.reward(3); }
          else if (r === 'shield') { this.hud.toast('SCHILD AKTIV · +80'); audio.reward(5); }
          else { this.hud.toast('LUFTSCHLAG BEREIT · TASTE 4'); audio.reward(7); }
        } else if (this.sameTeam(a, me)) {
          this.hud.toast(a.name + ': ' + (r === 'uav' ? 'UAV' : r === 'shield' ? 'SCHILD' : 'LUFTSCHLAG'), true);
        }
        break;
      }
      case 'strike': {
        this.strikes.push({ x: ev.x, y: ev.y, z: ev.z, t: 1.8, next: 0, jet: false });
        if (ev.a === this.myId) this.hud.toast('LUFTSCHLAG ANGEFORDERT', true);
        break;
      }
      case 'pickup': {
        const p = this.pickups[ev.i];
        if (p && p.mesh) { p.mesh.visible = false; p.ring.visible = false; }
        if (ev.a === this.myId) {
          audio.tone(880, 0.09, 0.26, 'sine', null, 1320);
          this.hud.toast(ev.k === 'health' ? '+40 LEBEN' : ev.k === 'armor' ? '+50 RÜSTUNG' : 'MUNITION', true);
        } else audio.tone(700, 0.06, 0.08, 'sine');
        break;
      }
      case 'pkon': {
        const p = this.pickups[ev.i];
        if (p && p.mesh) { p.mesh.visible = true; p.ring.visible = true; if (this.effects) this.effects.spawnFlash(p.x, p.y - 0.6, p.z, p.mesh.material.color.getHex()); }
        break;
      }
      case 'dadd': this._buildDropMesh(ev.id); break;
      case 'drm': this._removeDropMesh(ev.id); break;
      case 'dtake': {
        this._removeDropMesh(ev.id);
        const a = byId(ev.a);
        if (!a) break;
        if (a === me) { audio.pickupWeapon(); this.hud.toast((WEAPONS[ev.w] ? WEAPONS[ev.w].name.toUpperCase() : 'WAFFE') + ' AUFGEHOBEN', true); }
        else if (a.model && !ev.cur) a.model.setWeapon(a.weapon, this.skinFor(a), this.stickerFor(a));
        break;
      }
      case 'chat': {
        const a = byId(ev.a);
        if (a && a.isBot && settings.botChat === false) break;
        const name = a ? a.name : (ev.name || '?');
        const team = a ? a.team : (ev.team || null);
        this.hud.chat(name, ev.text, this.teamMode ? team : null, a === me);
        audio.chat();
        break;
      }
      case 'mode': this._presentMode(ev); break;
      // ---------------- Bewegung ----------------
      case 'jump': { const a = byId(ev.a); if (a) audio.jump(this._soundPos(a, 1)); break; }
      case 'djump': {
        const a = byId(ev.a); if (!a) break;
        audio.click(this._soundPos(a, 1), 700, 0.22, 0.09);
        if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.5);
        break;
      }
      case 'land': {
        const a = byId(ev.a); if (!a) break;
        audio.land(this._soundPos(a, 0), ev.i > 18, ev.sf);
        if (this.effects && ev.i > 10) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, clamp(ev.i / 24, 0.2, 1.2));
        if (a === me && ev.i > 16) a.addShake(clamp(ev.i / 60, 0, 0.5));
        break;
      }
      case 'step': {
        const a = byId(ev.a); if (!a) break;
        const quiet = a.classDef && a.classDef.id === 'ninja';
        audio.step(this._soundPos(a, 0), (quiet ? 0.35 : 1) * clamp(ev.sp / 11, 0.4, 1.2), ev.sf);
        break;
      }
      case 'slide': {
        const a = byId(ev.a); if (!a) break;
        audio.land(this._soundPos(a, 0), false, ev.sf);
        if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.8);
        break;
      }
      case 'dash': {
        const a = byId(ev.a); if (!a) break;
        audio.dash(this._soundPos(a, 1));
        if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.9);
        if (a === me) { this.viewmodel.dash(); a.addShake(0.12); }
        break;
      }
      case 'wallrun': { const a = byId(ev.a); if (a) audio.wallrun(this._soundPos(a, 1)); break; }
      case 'grap': {
        const a = byId(ev.a); if (!a) break;
        if (ev.k === 'shoot') {
          audio.grapple(this._soundPos(a), 'shoot');
          const p = ev.p;
          setTimeout(() => { if (this.world && a.grapple) audio.grapple(a === me ? null : (p ? { x: p[0], y: p[1], z: p[2] } : this._soundPos(a)), 'hit'); }, 90);
          if (a === me) { this.viewmodel.dash(); a.addShake(0.08); }
        } else audio.grapple(this._soundPos(a), ev.k);
        break;
      }
      case 'zip': {
        const a = byId(ev.a); if (!a) break;
        audio.zip(this._soundPos(a, 2), ev.k);
        if (a === me && ev.k === 'start') this._zipSoundT = 0;
        break;
      }
      case 'pad': {
        const a = byId(ev.a); if (!a) break;
        audio.tone(420, 0.2, 0.3, 'sine', null, 1200);
        if (this.effects) this.effects.spawnFlash(a.pos.x, a.pos.y, a.pos.z, 0x2ee6a8);
        break;
      }
      case 'dry': { const a = byId(ev.a); if (a) audio.click(this._soundPos(a), 1600, 0.2, 0.04); break; }
      case 'spin': {
        const a = byId(ev.a); if (!a) break;
        const last = this._spinSoundT.get(a) || -1;
        if (this.time - last < 0.09) break;
        this._spinSoundT.set(a, this.time);
        audio.spin(this._soundPos(a, 1.4), ev.k, ev.up);
        break;
      }
      case 'charge': { const a = byId(ev.a); if (a) audio.bowDraw(this._soundPos(a, 1.4)); break; }
      case 'reload': {
        const a = byId(ev.a); if (!a) break;
        const pos = this._soundPos(a, 1.4);
        if (ev.k === 0) {
          if (a === me) this.viewmodel.startReload(ev.tot);
          audio.reloadStep(pos, 0);
          setTimeout(() => { if (this.world && a.alive && (a !== me || a.reloadTimer > 0)) audio.reloadStep(pos, 2); }, ev.tot * 400);
        } else if (ev.k === 1) {
          audio.reloadStep(pos, 1);
          if (a === me && ev.more) this.viewmodel.startReload(ev.tot);
        } else if (ev.k === 2) audio.reloadStep(pos, 1);
        else if (a === me) this.viewmodel.cancelReload();
        break;
      }
      case 'wsw': {
        const a = byId(ev.a); if (!a) break;
        if (a === me && !this.killcam) { this.viewmodel.setWeapon(a.weapon, a.skin, this.skinFor(a), this.stickerFor(a)); this.viewmodel.setHidden(false); }
        if (a.model && !this.killcam) a.model.setWeapon(a.weapon, this.skinFor(a), this.stickerFor(a));
        audio.draw(this._soundPos(a, 1.4), a.weapon.hold);
        break;
      }
      default: break;
    }
  }

  _presentKill(ev) {
    const me = this.player;
    const v = this.actorById(ev.v), a = ev.a ? this.actorById(ev.a) : null;
    if (!v) return;
    const suicide = ev.sui || !a;
    const wName = causeName(ev.c);

    // Tod sichtbar: Kill-Effekt, Ragdoll oder Umkippen
    let killcam = false;
    if (v.model) {
      const info = {
        s: { x: ev.hit.x, y: ev.hit.y, z: ev.hit.z, yaw: ev.hit.yaw, vx: ev.hit.vx, vy: ev.hit.vy, vz: ev.hit.vz },
        hit: { dirx: ev.hit.dx, diry: ev.hit.dy, dirz: ev.hit.dz, head: ev.h, strength: ev.hit.s || 8 },
        fx: ev.fx, hideBody: ev.hb, bodyColor: this._figureColors(v).body,
      };
      if (v === me) {
        if (!suicide && settings.killcam) killcam = this.startKillcam(a);
        if (killcam) this.killcam.pendingRagdoll = info;
        else this._applyDeathVisual(v, info);
      } else this._applyDeathVisual(v, info);
    }
    audio.death({ x: v.pos.x, y: v.pos.y + 1.4, z: v.pos.z });
    this._bloodOnWorld(ev.hit.hx, ev.hit.hy, ev.hit.hz, ev.hit.dx, ev.hit.dy, ev.hit.dz, 90, true);

    if (a === me) {
      this.hud.hitmarker('kill');
      audio.kill();
      const name = STREAK_NAMES[ev.st];
      const icon = ev.icon;
      if (name) this.hud.toast((icon ? icon + ' ' : '') + name);
      else if (ev.h) this.hud.toast((icon ? icon + ' ' : '') + 'KOPFSCHUSS', true);
      else if (icon) this.hud.toast(icon + ' ELIMINIERT', true);
      this.hud.toast('+' + ev.pts + ' Punkte', true);
    }

    const isMe = v === me ? 'victim' : (a === me ? 'killer' : null);
    this.hud.addKillfeed(suicide ? '' : a.name, suicide ? '' : a.team, v.name, v.team, wName, ev.h, isMe, suicide, ev.icon || '');

    if (v === me) {
      const w = WEAPONS[ev.c];
      this._deathInfo = suicide ? { name: null, weapon: wName, hp: null } : { name: a.name, weapon: w ? w.name : wName, hp: ev.ah };
      this.hud.showDeath(this._deathInfo.name, this._deathInfo.weapon, this._deathInfo.hp, ev.rt < 0 ? Infinity : ev.rt);
      if (!killcam) { this.viewmodel.setHidden(true); this.hud.setScope(false); }
    }
  }

  _presentMode(ev) {
    const me = this.player;
    const myTeam = me ? me.team : null;
    const a = ev.a ? this.actorById(ev.a) : null;
    const local = a === me;
    const hud = this.hud;
    if (ev.m === 'ctf') {
      if (ev.k === 'pickup') {
        if (local) { hud.toast('FLAGGE GENOMMEN! ZURÜCK ZUR BASIS'); audio.objective('pickup'); }
        else if (a && a.team === myTeam) { hud.toast(a.name + ' hat die gegnerische Flagge', true); audio.objective('pickup'); }
        else { hud.toast('GEGNER HAT UNSERE FLAGGE!', true); audio.objective('lost'); }
      } else if (ev.k === 'drop') {
        hud.toast(ev.f === myTeam ? 'FLAGGE FALLEN GELASSEN' : 'GEGNERISCHE FLAGGE LIEGT AM BODEN', true);
      } else if (ev.k === 'return') {
        if (local) { hud.toast('FLAGGE ZURÜCKGEBRACHT', true); audio.objective('return'); }
        else if (ev.f === myTeam) { hud.toast('UNSERE FLAGGE IST ZURÜCK', true); audio.objective('return'); }
      } else if (ev.k === 'capture') {
        if (local) { hud.toast('FLAGGE EROBERT! +250'); audio.objective('capture'); }
        else if (a && a.team === myTeam) { hud.toast(a.name + ' erobert die Flagge!'); audio.objective('capture'); }
        else { hud.toast('GEGNER EROBERN UNSERE FLAGGE'); audio.objective('lost'); }
        const f = this.modeCtl && this.modeCtl.flags ? this.modeCtl.flags[ev.f] : null;
        if (f && this.effects && a) this.effects.spawnFlash(f.home.x, f.home.y, f.home.z, this.teamColor(a.team));
      }
    } else if (ev.m === 'hp') {
      if (ev.k === 'move') { hud.toast('HARDPOINT WANDERT', true); audio.objective('zone'); }
      else if (ev.k === 'owner') {
        if (ev.o === myTeam) { hud.toast('ZONE GEHALTEN', true); audio.objective('pickup'); }
        else if (ev.o) { hud.toast('GEGNER HALTEN DIE ZONE', true); audio.objective('lost'); }
      }
    } else if (ev.m === 'gg') {
      if (!local || !this.modeCtl) return;
      const order = this.modeCtl.order;
      if (ev.k === 'level') { hud.toast('STUFE ' + (ev.lvl + 1) + '/' + order.length + ' · ' + WEAPONS[order[ev.lvl]].name.toUpperCase(), true); audio.objective('level'); }
      else hud.toast('STUFE VERLOREN (MESSER)', true);
    } else if (ev.m === 'inf') {
      if (ev.k === 'count') { hud.toast('INFEKTION IN ' + ev.n, true); audio.countdown(ev.n === 1); }
      else if (ev.k === 'start') hud.toast('DIE INFEKTION BEGINNT', false, 'red');
      else if (ev.k === 'infect') {
        if (local) { hud.setMyTeam('red'); hud.toast('DU BIST INFIZIERT!', false, 'red'); hud.toast('Jage die Überlebenden mit den Klauen', true); }
        else if (ev.ann && a) hud.toast(a.name + ' wurde infiziert', true);
        if (ev.ann && a) audio.growl({ x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z });
      } else if (ev.k === 'doomed' && local) hud.toast('DU WIRST ZUM ZOMBIE', true);
    } else if (ev.m === 'sd') {
      if (ev.k === 'round') {
        hud.toast('RUNDE ' + ev.n, false);
        hud.toast(myTeam === 'red' ? 'Lege die Bombe bei A oder B (E halten)' : 'Verteidige A und B', true);
        hud.hideDeath();
      } else if (ev.k === 'live') { hud.toast('LOS!', true); audio.countdown(true); }
      else if (ev.k === 'end') {
        const mine = ev.w === myTeam;
        hud.toast((mine ? 'RUNDE GEWONNEN' : 'RUNDE VERLOREN') + ' · ' + ev.r, false, ev.w);
        audio.objective(mine ? 'capture' : 'lost');
      } else if (ev.k === 'planted') { hud.toast('BOMBE GELEGT BEI ' + ev.site, false, 'red'); audio.bomb('planted'); }
      else if (ev.k === 'defused') audio.bomb('defused');
      else if (ev.k === 'planting' && a) audio.bomb('plant', { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
      else if (ev.k === 'defusing' && a) audio.bomb('defuse', { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
      else if (ev.k === 'tick') audio.bomb('tick', { x: ev.x, y: ev.y + 0.5, z: ev.z });
      else if (ev.k === 'swap') { hud.setMyTeam(myTeam); this._applyTeamCss(); hud.toast('SEITENWECHSEL', false, myTeam); }
    }
  }

  onMatchEnd(winner, wonIn) {
    this.endKillcam();
    this.viewmodel.setHidden(true);
    this.hud.setScope(false);
    this.input.exitLock();
    const won = wonIn !== undefined ? wonIn : (!this.teamMode ? winner === this.player : winner === this.player.team);
    if (won) audio.win(); else audio.lose();
    if (!this.online) super.onMatchEnd(winner);
    if (this.onEnd) this.onEnd(winner, won);
  }

  // --------------------------------------------------------
  // Seilbahnen, Enterhaken-Seile, liegende Waffen, Pickups, Projektile
  // --------------------------------------------------------
  _buildZiplines(mapDef) {
    for (const m of this.zipMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.zipMeshes = [];
    if (!this._zipMat) this._zipMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.8 });
    for (const z of mapDef.ziplines || []) {
      const len = Math.hypot(z.b.x - z.a.x, z.b.y - z.a.y, z.b.z - z.a.z);
      const geo = new THREE.CylinderGeometry(0.05, 0.05, len, 6, 1);
      geo.rotateX(Math.PI / 2);                 // Laenge entlang +Z
      const mesh = new THREE.Mesh(geo, this._zipMat);
      mesh.position.set((z.a.x + z.b.x) / 2, (z.a.y + z.b.y) / 2, (z.a.z + z.b.z) / 2);
      mesh.lookAt(z.b.x, z.b.y, z.b.z);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.zipMeshes.push(mesh);
    }
  }

  _buildDropMesh(id) {
    const d = this.drops.find(x => x.id === id);
    if (!d || this.dropMeshes.has(id)) return;
    if (!this._dropMat) this._dropMat = makePropMaterial({ envMapIntensity: 0.6 });
    const mesh = buildWeaponMesh(d.w, 1.0, this._dropMat, d.skin, d.sticker);
    mesh.position.set(d.x, d.y + 0.16, d.z);
    mesh.rotation.set(0, d.rot || 0, Math.PI / 2);
    this.scene.add(mesh);
    const ring = new THREE.Mesh(this._ringGeo || (this._ringGeo = new THREE.BoxGeometry(1.5, 0.06, 1.5)),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.3 }));
    ring.position.set(d.x, d.y + 0.03, d.z);
    this.scene.add(ring);
    this.dropMeshes.set(id, { mesh, ring, d });
  }

  _removeDropMesh(id) {
    const m = this.dropMeshes.get(id);
    if (!m) return;
    this.scene.remove(m.mesh, m.ring);
    m.ring.material.dispose();
    this.dropMeshes.delete(id);
  }

  _updateDropMeshes(dt) {
    let i = 0;
    for (const [, m] of this.dropMeshes) {
      const d = m.d;
      if (this.online) d.t -= dt;
      m.mesh.position.y = d.y + 0.16 + Math.sin(this.time * 2.5 + i) * 0.04;
      m.ring.rotation.y += dt * 0.9;
      m.ring.material.opacity = 0.2 + Math.sin(this.time * 3) * 0.08;
      m.mesh.visible = d.t >= 4 || (this.time * 6 | 0) % 2 === 0;
      i++;
    }
  }

  _buildPickupMesh(p) {
    const colors = { health: 0x3fdc5c, armor: 0x4a9bff, ammo: 0xffc21f };
    if (!this._pickupGeo) {
      this._pickupGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
      this._ringGeo = new THREE.BoxGeometry(1.5, 0.06, 1.5);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: colors[p.type], emissive: colors[p.type], emissiveIntensity: 1.2, roughness: 0.35, metalness: 0.6,
    });
    const mesh = new THREE.Mesh(this._pickupGeo, mat);
    mesh.castShadow = true;
    mesh.position.set(p.x, p.y, p.z);
    this.scene.add(mesh);
    const ring = new THREE.Mesh(this._ringGeo, new THREE.MeshBasicMaterial({ color: colors[p.type], transparent: true, opacity: 0.35 }));
    ring.position.set(p.x, p.y - 0.75, p.z);
    this.scene.add(ring);
    p.mesh = mesh; p.ring = ring;
    mesh.visible = ring.visible = p.active;
  }

  _updatePickupMeshes(dt) {
    for (const p of this.pickups) {
      if (!p.mesh) continue;
      if (p.mesh.visible !== p.active) { p.mesh.visible = p.active; p.ring.visible = p.active; }
      if (!p.active) continue;
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.rotation.x = Math.sin(this.time * 1.4) * 0.2;
      p.mesh.position.y = p.y + Math.sin(this.time * 2.2) * 0.18;
      p.ring.rotation.y -= dt * 0.8;
      p.ring.material.opacity = 0.24 + Math.sin(this.time * 3) * 0.1;
    }
  }

  _projMesh(p) {
    let mesh = this.projMeshes.get(p.id);
    if (mesh) return mesh;
    const def = p.def;
    if (!this._projGeo) this._projGeo = new Map();
    let geo = this._projGeo.get(p.weapon.id);
    if (!geo) {
      if (def.arrow) geo = new THREE.BoxGeometry(0.05, 0.05, 1.0);
      else if (def.knife) geo = new THREE.BoxGeometry(0.06, 0.16, 0.5);
      else geo = new THREE.BoxGeometry(def.radius * 2, def.radius * 2, def.radius * 3);
      this._projGeo.set(p.weapon.id, geo);
    }
    const c = new THREE.Color(def.color);
    if (def.glow) c.multiplyScalar(2.5);
    const mat = def.knife || def.arrow
      ? new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: def.knife ? 0.9 : 0.2 })
      : new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, p.y, p.z);
    this.scene.add(mesh);
    this.projMeshes.set(p.id, mesh);
    return mesh;
  }

  _updateProjMeshes(dt) {
    const alive = this._projAlive || (this._projAlive = new Set());
    alive.clear();
    for (const p of this.projectiles) {
      alive.add(p.id);
      if (this.online) {
        // Zwischen Snapshots mit der Geschwindigkeit weiterbewegen, weich zur Serverposition
        if (p.tx !== undefined) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const k = Math.min(1, dt * 10);
          p.x += (p.tx - p.x) * k; p.y += (p.ty - p.y) * k; p.z += (p.tz - p.z) * k;
          p.tx += p.vx * dt; p.ty += p.vy * dt; p.tz += p.vz * dt;
        }
        if (p.spin !== null && p.spin !== undefined) p.spin += dt * 18;
      }
      const mesh = this._projMesh(p);
      mesh.position.set(p.x, p.y, p.z);
      const sp = Math.hypot(p.vx, p.vy, p.vz);
      if (sp > 0.01) mesh.lookAt(p.x + p.vx / sp, p.y + p.vy / sp, p.z + p.vz / sp);
      if (p.isGrenade) mesh.rotation.x += dt * 9;
      if (p.spin !== null && p.spin !== undefined) mesh.rotateX(p.spin * 0.05);
      if (this.effects && !p.def.noTrail) this.effects.trail(p.x, p.y, p.z, p.def.glow ? p.def.color : 0x9a9a9a);
    }
    for (const [id, mesh] of this.projMeshes) {
      if (alive.has(id)) continue;
      this.scene.remove(mesh);
      mesh.material.dispose();
      this.projMeshes.delete(id);
    }
  }

  /** Luftschlag-Markierung: Rauch und Jet-Sound vor den Einschlaegen */
  _updateStrikes(dt) {
    for (let i = this.strikes.length - 1; i >= 0; i--) {
      const s = this.strikes[i];
      s.t -= dt;
      s.next -= dt;
      if (s.next <= 0 && this.effects) { s.next = 0.12; this.effects.markSmoke(s.x, s.y, s.z); }
      if (!s.jet && s.t < 1.1) { s.jet = true; audio.jet({ x: s.x, y: s.y + 30, z: s.z }); }
      if (s.t <= 0) this.strikes.splice(i, 1);
    }
  }

  /** Brennende Akteure: Flammen und Knistern */
  _updateBurnFx(dt) {
    this._burnFxT = (this._burnFxT || 0) - dt;
    if (this._burnFxT > 0) return;
    this._burnFxT = 0.25;
    for (const a of this.actors) {
      if (!a.alive || a.burnT <= 0) continue;
      if (this.effects) this.effects.burn(a.pos.x, a.pos.y, a.pos.z);
      if (Math.random() < 0.35) audio.burn({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
    }
  }

  /** Enterhaken-Seile zeichnen */
  _updateRopes() {
    for (const a of this.actors) {
      const g = a.alive ? a.grapple : null;
      let m = this.ropes.get(a);
      if (!g) { if (m) { m.visible = false; } continue; }
      if (!m) {
        m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1), new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.7, metalness: 0.3 }));
        m.frustumCulled = false;
        this.scene.add(m);
        this.ropes.set(a, m);
      }
      m.visible = true;
      let sx, sy, sz;
      if (a.isLocal && !(a.thirdPerson || settings.thirdPerson) && !this.killcam) {
        const c = this.camera;
        const r = this._v3.set(1, 0, 0).applyQuaternion(c.quaternion);
        sx = c.position.x + r.x * 0.32; sy = c.position.y - 0.22; sz = c.position.z + r.z * 0.32;
      } else {
        sx = a.pos.x; sy = a.pos.y + 1.55; sz = a.pos.z;
      }
      const len = Math.hypot(g.x - sx, g.y - sy, g.z - sz);
      m.position.set((sx + g.x) / 2, (sy + g.y) / 2, (sz + g.z) / 2);
      m.lookAt(g.x, g.y, g.z);
      m.scale.set(1, 1, Math.max(0.01, len));
    }
  }

  /** Wetter: Laternen (Punktlichter) fuer die Nacht, nasse Oberflaechen, Gewitter */
  _setupWeather(wx) {
    for (const l of this.lamps) { this.scene.remove(l); l.dispose && l.dispose(); }
    this.lamps = [];
    for (const p of wx.lamps || []) {
      const light = new THREE.PointLight(0xffd9a0, 48, 32, 1.7);
      light.position.set(p.x, p.y + 4.4, p.z);
      this.scene.add(light);
      this.lamps.push(light);
    }
    if (wx.wet && this.world && this.world.meshSolid) {
      const m = this.world.meshSolid.material;
      m.roughness = 0.55;
      m.envMapIntensity = 0.75;
    }
    this._lightningT = wx.lightning ? rand(4, 10) : 0;
    this._flashT = 0;
  }

  _updateWeather(dt) {
    if (!this.weather || !this.weather.lightning || !this.sun) return;
    this._lightningT -= dt;
    if (this._lightningT <= 0) {
      this._lightningT = rand(7, 20);
      this._flashT = 0.16;
      const d = rand(0.4, 1.8);
      setTimeout(() => { if (this.world) audio.thunder(); }, d * 1000);
    }
    if (this._flashT > 0) {
      this._flashT -= dt;
      const k = this._flashT > 0 ? (0.5 + Math.random() * 0.5) : 0;
      this.sun.intensity = this.world.map.sunIntensity * 2.0 + k * 9;
      this.hemi.intensity = this.world.map.ambIntensity * 0.85 + k * 2.5;
      if (this._flashT <= 0) { this.sun.intensity = this.world.map.sunIntensity * 2.0; this.hemi.intensity = this.world.map.ambIntensity * 0.85; }
    }
  }

  _applyPlayerOutfitToViewmodel() {
    const c = this._figureColors(this.player);
    this.viewmodel.setOutfit(c.sleeve, c.cuff);
  }

  _sendCosmetics() {
    if (!this.online || !this.net || !this.player) return;
    const p = this.player;
    this.net.send({ t: 'cos', outfit: p.outfit, hat: p.hat, fx: p.killEffect, icon: p.killIcon, skins: p.skins, stickers: p.stickers });
  }

  /** Spielfigur des lokalen Spielers neu bauen (Outfit/Hut im Menue geaendert) */
  rebuildPlayerModel() {
    if (!this.player || !this.world) return;
    this.rebuildActorModel(this.player);
    this._sendCosmetics();
  }

  /** Skin/Sticker einer Waffe im Match geaendert */
  setPlayerSkin(weaponId, skinId, stickerId) {
    const p = this.player;
    if (!p || !this.world) return;
    if (skinId !== undefined) p.skins[weaponId] = skinId;
    if (stickerId !== undefined) p.stickers[weaponId] = stickerId;
    if (p.weapon.id === weaponId) {
      this.viewmodel.setWeapon(p.weapon, p.skin, this.skinFor(p), this.stickerFor(p));
      if (p.model) p.model.setWeapon(p.weapon, this.skinFor(p), this.stickerFor(p));
    }
    this._sendCosmetics();
  }

  /** Aufsaetze des Spielers im Menue geaendert */
  setPlayerAttachments(att) {
    const p = this.player;
    if (!p || !this.world) return;
    p.attachments = att || {};
    p.refreshAttachments();
    if (p.alive && !this.killcam) this.onWeaponSwitch(p);
    else if (p.model) p.model.setWeapon(p.weapon, this.skinFor(p), this.stickerFor(p));
    if (this.online && this.net) this.net.send({ t: 'cls', cls: p.pendingClassId || p.classDef.id, att: p.attachments, keep: !p.pendingClassId });
  }

  /** Teamfarben-Einstellung geaendert: alle Figuren und das HUD neu faerben */
  refreshTeamColors() {
    if (!this.world) return;
    this._applyTeamCss();
    for (const a of this.actors) this.rebuildActorModel(a);
  }

  /** Trainings-Drill beendet: Ergebnis nach aussen melden */
  endTraining(results) {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.viewmodel.setHidden(true);
    this.hud.setScope(false);
    this.input.exitLock();
    audio.win();
    if (this.onTrainingEnd) this.onTrainingEnd(results);
  }

  _setupLights(mapDef) {
    if (this.sun) { this.scene.remove(this.sun); this.scene.remove(this.sun.target); this.sun.dispose(); }
    if (this.hemi) { this.scene.remove(this.hemi); this.hemi.dispose(); }

    const d = mapDef.sunDir;
    this.sun = new THREE.DirectionalLight(mapDef.sunColor, mapDef.sunIntensity * 2.0);
    this.sun.position.set(d[0] * 120, d[1] * 120, d[2] * 120);
    this.sun.target.position.set(0, 0, 0);

    const half = (mapDef.size || 120) * 0.62;
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 10; sc.far = 320;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.radius = 2;

    this.hemi = new THREE.HemisphereLight(mapDef.ambTop, mapDef.ambBottom, mapDef.ambIntensity * 0.85);

    this.scene.add(this.sun, this.sun.target, this.hemi);
    this.applyGraphicsSettings();
  }

  _makeModel(actor) {
    if (!actor.skin) actor.skin = pick(SKINS_TONE);
    if (!actor.hair) actor.hair = pick(HAIR_COLORS);
    const c = this._figureColors(actor);
    const m = new CharacterModel(this.scene, {
      color: c.body,
      accent: c.accent,
      pants: c.pants,
      cuff: c.cuff,
      arm: c.arm,
      skin: actor.skin,
      hair: actor.hair,
      hat: actor.hat || 'none',
      hatPrimary: c.hatPrimary,
      hatSecondary: c.hatSecondary,
      world: this.world,
      effects: this.effects,
    });
    m.setWeapon(actor.weapon, this.skinFor(actor), this.stickerFor(actor));
    return m;
  }

  _ffaColor(actor) {
    const palette = [0xd94a4a, 0x4a86d9, 0x4ad98a, 0xd9a84a, 0xa64ad9, 0x4ad9d0,
                     0xd94a9c, 0x8ad94a, 0xd9704a, 0x6a4ad9, 0x4ad95a, 0xd9d44a,
                     0x4a6ad9, 0xd94a6a, 0x9ad9d0, 0xc0c0c0];
    return palette[Math.abs(actor.id - 1) % palette.length];
  }

  cleanup() {
    this.running = false;
    this.killcam = null;
    if (this.training) { this.training.dispose(); this.training = null; }
    if (this.modeFx) { this.modeFx.dispose(); this.modeFx = null; }
    for (const l of this.lamps) this.scene.remove(l);
    this.lamps = [];
    this.strikes = [];
    for (const m of this.zipMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.zipMeshes = [];
    for (const m of this.ropes.values()) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.ropes.clear();
    for (const id of Array.from(this.dropMeshes.keys())) this._removeDropMesh(id);
    for (const [, mesh] of this.projMeshes) { this.scene.remove(mesh); mesh.material.dispose(); }
    this.projMeshes.clear();
    audio.rain(false);
    if (this.hud) { this.hud.setKillcam(null); this.hud.setTraining(null); this.hud.setMyTeam(null); this.hud.updateObjective(null); this.hud.updateStreaks(null); this.hud.updateBoard(null); }
    for (const a of this.actors || []) if (a.model) { a.model.dispose(); a.model = null; }
    for (const p of this.pickups || []) {
      if (!p.mesh) continue;
      this.scene.remove(p.mesh); this.scene.remove(p.ring);
      p.mesh.material.dispose(); p.ring.material.dispose();
    }
    if (this.effects) { this.effects.dispose(); this.effects = null; }
    super.cleanup();
    this.vmScene.environment = null;
    this.muzzleLightT = 0;
    this.muzzleLight.visible = false;
    this._spinSoundT.clear();
  }

  // --------------------------------------------------------
  // Muendung, Blut, Vorbeifliegen
  // --------------------------------------------------------
  muzzleWorld(actor, out) {
    if (actor.isLocal && !actor.thirdPerson && !settings.thirdPerson && !this.killcam) {
      this.viewmodel.muzzleLocal(out);
      const e = this._camE || (this._camE = new THREE.Euler(0, 0, 0, 'YXZ'));
      const q = this._camQ || (this._camQ = new THREE.Quaternion());
      e.set(actor.pitch, actor.yaw, 0, 'YXZ');
      out.applyQuaternion(q.setFromEuler(e));
      out.x += actor.pos.x;
      out.y += actor.pos.y + actor.eyeHeight();
      out.z += actor.pos.z;
      return out;
    }
    if (actor.model) return actor.model.getMuzzleWorld(out);
    return super.muzzleWorld(actor, out);
  }

  /** Blutspritzer hinter dem Getroffenen (Wand) und darunter (Boden) */
  _bloodOnWorld(hx, hy, hz, dx, dy, dz, dmg, big) {
    if (!this.effects || !settings.blood) return;
    const size = (big ? 0.7 : 0.4) + Math.min(1.3, dmg / 55);
    const wh = this.world.raycast(hx, hy, hz, dx, dy, dz, big ? 9 : 6);
    if (wh) this.effects.bloodSplat(wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz, size * clamp(1.3 - wh.t / 9, 0.5, 1.2));
    if (big || Math.random() < 0.55) {
      const fh = this.world.raycast(hx + dx * 0.4, hy, hz + dz * 0.4, 0, -1, 0, 3.5);
      if (fh) this.effects.bloodSplat(fh.x, fh.y, fh.z, fh.nx, fh.ny, fh.nz, size * 0.75);
    }
  }

  _whizzCheck(o, dx, dy, dz, dist) {
    const p = this.player;
    if (!p || !p.alive) return;
    const cx = p.pos.x - o[0], cy = p.pos.y + 1.4 - o[1], cz = p.pos.z - o[2];
    const proj = cx * dx + cy * dy + cz * dz;
    if (proj < 1 || proj > dist) return;
    const px = cx - dx * proj, py = cy - dy * proj, pz = cz - dz * proj;
    if (px * px + py * py + pz * pz < 6.25) audio.whizz({ x: o[0] + dx * proj, y: o[1] + dy * proj, z: o[2] + dz * proj });
  }

  /** Tod sichtbar machen: Kill-Effekt, Ragdoll oder Umkippen */
  _applyDeathVisual(victim, info) {
    const m = victim.model;
    if (!m) return;
    if (info.fx) {
      if (this.effects) this.effects.killEffect(info.fx, info.s.x, info.s.y, info.s.z, info.bodyColor);
      audio.killEffect(info.fx, { x: info.s.x, y: info.s.y + 1.3, z: info.s.z });
    }
    if (info.hideBody) {
      m.startDeath(info.hit.dirx, info.hit.dirz);
      m.deathT = 99;
      m.setVisible(false);
      return;
    }
    if (settings.ragdolls) m.startRagdoll(info.s, info.hit);
    else m.startDeath(info.hit.dirx, info.hit.dirz);
  }

  // --------------------------------------------------------
  // Killcam: Aufzeichnung + Wiedergabe
  // --------------------------------------------------------
  _recordHistory() {
    const h = this.hist;
    if (this.time - h.lastT < HIST_RATE) return;
    h.lastT = this.time;
    const f = h.frames[h.head] || (h.frames[h.head] = { t: 0, s: new Map() });
    f.t = this.time;
    f.s.clear();
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      f.s.set(a.id, {
        x: a.pos.x, y: a.pos.y, z: a.pos.z, yaw: a.yaw, pitch: a.pitch,
        alive: a.alive, crouch: a.crouching || a.sliding, wid: a.weapon.id,
        shot: (this.time - (a.lastShotTime !== undefined ? a.lastShotTime : -9)) < HIST_RATE + 1e-4,
        speed: Math.hypot(a.vel.x, a.vel.z), grounded: a.grounded, zip: !!a.zip,
      });
    }
    h.head = (h.head + 1) % h.cap;
    if (h.count < h.cap) h.count++;
  }

  startKillcam(killer) {
    const h = this.hist;
    const t1 = this.time, t0 = t1 - KILLCAM_LEN;
    const frames = [];
    for (let k = 0; k < h.count; k++) {
      const idx = (h.head - h.count + k + h.cap) % h.cap;
      const f = h.frames[idx];
      if (!f || f.t < t0 - 0.05) continue;
      const s = new Map();
      for (const [id, st] of f.s) s.set(id, Object.assign({}, st));
      frames.push({ t: f.t, s });
    }
    if (frames.length < 6 || !killer) return false;
    if (!frames[frames.length - 1].s.has(killer.id)) return false;
    const cur = new Map();
    for (const [id, st] of frames[0].s) cur.set(id, Object.assign({}, st));
    this.killcam = {
      killer, killerId: killer.id, frames, t0: frames[0].t, t1, play: 0, fi: 0, lastFrame: -1,
      wid: null, cur, frozen: false, pendingRagdoll: null,
    };
    this.hud.setKillcam(killer.name);
    this.hud.setScope(false);
    this.viewmodel.setHidden(false);
    return true;
  }

  endKillcam() {
    if (!this.killcam) return;
    const kc = this.killcam;
    this.killcam = null;
    this.hud.setKillcam(null);
    for (const a of this.actors) if (a.model && a.alive) a.model.setWeapon(a.weapon, this.skinFor(a), this.stickerFor(a));
    if (kc.pendingRagdoll && this.player.model && !this.player.alive) {
      this._applyDeathVisual(this.player, kc.pendingRagdoll);
    }
  }

  /** Replay-Zustand fuer die aktuelle Wiedergabezeit interpolieren */
  _killcamUpdate(dt) {
    const kc = this.killcam;
    kc.play += dt;
    const tr = kc.t0 + kc.play;
    const fr = kc.frames;
    let i = kc.fi;
    while (i < fr.length - 2 && fr[i + 1].t <= tr) i++;
    kc.fi = i;
    const a = fr[i], b = fr[Math.min(i + 1, fr.length - 1)];
    let k = b.t > a.t ? clamp((tr - a.t) / (b.t - a.t), 0, 1) : 1;
    const frozen = tr >= fr[fr.length - 1].t;
    if (frozen) k = 1;
    for (const [id, sa] of a.s) {
      const sb = b.s.get(id) || sa;
      let c = kc.cur.get(id);
      if (!c) { c = Object.assign({}, sa); kc.cur.set(id, c); }
      c.x = lerp(sa.x, sb.x, k); c.y = lerp(sa.y, sb.y, k); c.z = lerp(sa.z, sb.z, k);
      c.yaw = angleLerp(sa.yaw, sb.yaw, k); c.pitch = lerp(sa.pitch, sb.pitch, k);
      c.alive = k < 0.5 ? sa.alive : sb.alive; c.crouch = sa.crouch; c.wid = sa.wid;
      c.speed = lerp(sa.speed, sb.speed, k); c.grounded = sa.grounded; c.zip = sa.zip;
    }
    // Schuesse der uebersprungenen Frames abspielen
    const upto = frozen ? fr.length - 1 : i;
    for (let j = kc.lastFrame + 1; j <= upto; j++) {
      const f = fr[j];
      for (const [id, st] of f.s) {
        if (!st.shot) continue;
        const actor = this.actorById(id);
        const w = WEAPONS[st.wid] || (actor ? actor.weapon : WEAPONS.ar);
        if (id === kc.killerId) {
          this.viewmodel.fire(1);
          audio.shot(null, w.sound);
          this.muzzleLight.position.set(st.x, st.y + PHYS.EYE, st.z);
          this.muzzleLight.visible = true;
          this.muzzleLightT = 1;
        } else if (actor && actor.model && this.effects) {
          audio.shot({ x: st.x, y: st.y + 1.6, z: st.z }, w.sound);
          actor.model.getMuzzleWorld(this._v3);
          const cp = Math.cos(st.pitch);
          this.effects.muzzleFlash(this._v3.x, this._v3.y, this._v3.z, -Math.sin(st.yaw) * cp, Math.sin(st.pitch), -Math.cos(st.yaw) * cp, 0.7);
        }
      }
    }
    kc.lastFrame = upto;

    // Kamera aus den Augen des Killers
    const ks = kc.cur.get(kc.killerId);
    if (ks) {
      const eye = ks.crouch ? PHYS.CROUCH_EYE : PHYS.EYE;
      this.camera.position.set(ks.x, ks.y + eye, ks.z);
      this.camera.rotation.order = 'YXZ';
      this.camera.rotation.set(ks.pitch, ks.yaw, 0);

      // Waffe des Killers in der Egoansicht
      if (kc.wid !== ks.wid) {
        kc.wid = ks.wid;
        const w = WEAPONS[ks.wid] || kc.killer.weapon;
        const kc2 = this._figureColors(kc.killer);
        this.viewmodel.setOutfit(kc2.sleeve, kc2.cuff);
        this.viewmodel.setWeapon(w, kc.killer.skin, this.skinFor(kc.killer, w), this.stickerFor(kc.killer, w));
        this.viewmodel.setHidden(false);
      }
      this.viewmodel.update(dt, {
        adsTarget: false, moveSpeed: ks.speed, grounded: ks.grounded, sprint: false, slide: false,
        crouch: ks.crouch, firing: false, lookDX: 0, lookDY: 0, velY: 0, landImpact: 0,
      });
    }

    if (frozen && !kc.frozen) {
      kc.frozen = true;
      if (kc.pendingRagdoll && this.player.model) {
        this._applyDeathVisual(this.player, kc.pendingRagdoll);
        kc.pendingRagdoll = null;
      }
    }
    return frozen;
  }

  // --------------------------------------------------------
  // Replay: Aufzeichnung des ganzen Matches + Wiedergabe mit freier Kamera
  // --------------------------------------------------------
  _recAddActor(a) {
    const r = this.rec;
    if (!r || r.meta.actors.some(m => m.id === a.id)) return;
    r.meta.actors.push({
      id: a.id, name: a.name, team: a.team, classId: a.classDef.id, isLocal: !!a.isLocal,
      outfit: a.outfit || 'team', hat: a.hat || 'none', skin: a.skin, hair: a.hair,
      skins: Object.assign({}, a.skins || {}), stickers: Object.assign({}, a.stickers || {}),
    });
  }

  _recordReplay() {
    const r = this.rec;
    if (!r || this.time - r.lastT < r.rate) return;
    if (r.frames.length > 30000) return;             // ~25 Minuten
    r.lastT = this.time;
    const s = [];
    for (const m of r.meta.actors) {
      const a = this.actorById(m.id);
      if (!a) { s.push(0, 0, 0, 0, 0, 0, 0, 0); continue; }
      const flags = (a.alive ? 1 : 0) | ((a.crouching || a.sliding) ? 2 : 0) | (a.grounded ? 4 : 0) |
                    ((this.time - (a.lastShotTime !== undefined ? a.lastShotTime : -9)) < r.rate + 1e-4 ? 8 : 0) | (a.zip ? 16 : 0);
      s.push(Math.round(a.pos.x * 100) / 100, Math.round(a.pos.y * 100) / 100, Math.round(a.pos.z * 100) / 100,
        Math.round(a.yaw * 1000) / 1000, Math.round(a.pitch * 1000) / 1000, flags, Math.max(0, WEAPON_IDS.indexOf(a.weapon.id)),
        Math.round(Math.hypot(a.vel.x, a.vel.z) * 10) / 10);
    }
    r.frames.push([Math.round(this.time * 1000) / 1000].concat(s));
  }

  /** Aufzeichnung als serialisierbares Objekt (nach dem Match) */
  getReplayData() {
    if (!this.rec || this.rec.frames.length < 10) return null;
    return { v: 1, meta: this.rec.meta, frames: this.rec.frames };
  }

  /** Wiedergabe starten: Welt aus dem Replay bauen, Geister-Akteure, freie Kamera */
  startReplay(data) {
    if (!data || !data.meta || !data.frames || data.frames.length < 2) return false;
    this.cleanup();
    const meta = data.meta;
    this.online = false;
    this.net = null;
    this.replaying = true;
    this.setupMatch({ mode: meta.mode || 'tdm', map: meta.map || 'sandstorm', weather: meta.weather || 'clear' });
    this.pickups = [];
    this.jumpPads = [];
    this._setupScene();
    this.actors = [];
    for (const m of meta.actors) {
      const a = new Actor(this, { id: m.id, name: m.name, team: m.team, classId: m.classId });
      a.outfit = m.outfit; a.hat = m.hat; a.skin = m.skin; a.hair = m.hair;
      a.skins = m.skins || {}; a.stickers = m.stickers || {};
      a.alive = true;
      a.replayLocal = !!m.isLocal;
      a.model = this._makeModel(a);
      this.actors.push(a);
    }
    this.player = this.actors.find(a => a.replayLocal) || this.actors[0];
    this._applyTeamCss();
    const wids = meta.weaponIds || WEAPON_IDS;
    const n = this.actors.length;
    const f0 = data.frames[0];
    const cur = new Map();
    for (const a of this.actors) cur.set(a.id, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, crouch: false, wid: 'ar', speed: 0, grounded: true, zip: false, shot: false });
    const li = Math.max(0, this.actors.indexOf(this.player));
    const lx = f0[1 + li * 8], ly = f0[2 + li * 8], lz = f0[3 + li * 8], lyaw = f0[4 + li * 8];
    this.replay = {
      data, wids, n, t: 0, total: data.frames[data.frames.length - 1][0] - f0[0], t0: f0[0],
      speed: 1, paused: false, fi: 0, lastFrame: -1, cur,
      cam: { x: lx + Math.sin(lyaw) * 6, y: ly + 4, z: lz + Math.cos(lyaw) * 6, yaw: lyaw, pitch: -0.3 },
    };
    this.viewmodel.setHidden(true);
    this.hud.show(false);
    this.hud.showReplay(true);
    this.running = false;
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    return true;
  }

  stopReplay() {
    if (!this.replaying) return;
    this.replaying = false;
    this.replay = null;
    this.hud.showReplay(false);
    this.cleanup();
  }

  /** Wiedergabe: Steuerung (Pause, Suchen, Tempo, Flugkamera) und Zustand fuer die Modelle */
  replayUpdate(dt, input) {
    const r = this.replay;
    if (!r) return;
    // ---- Steuerung ----
    if (input.justDown('Space')) r.paused = !r.paused;
    if (input.justDown('ArrowLeft')) this._replaySeek(r.t - 5);
    if (input.justDown('ArrowRight')) this._replaySeek(r.t + 5);
    if (input.justDown('Digit1')) r.speed = 0.25;
    if (input.justDown('Digit2')) r.speed = 0.5;
    if (input.justDown('Digit3')) r.speed = 1;
    if (input.justDown('Digit4')) r.speed = 2;
    if (input.justDown('KeyR')) this._replaySeek(0);
    const sens = settings.sens * 0.0022;
    r.cam.yaw -= input.dx * sens;
    r.cam.pitch = clamp(r.cam.pitch - input.dy * (settings.invertY ? -1 : 1) * sens, -1.5, 1.5);
    input.dx = 0; input.dy = 0;
    const tm = input.touchMove;
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0) + (tm ? tm.y : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) + (tm ? tm.x : 0);
    const up = (input.down('KeyE') ? 1 : 0) - (input.down('KeyC') || input.down('ControlLeft') ? 1 : 0) + (input.down('KeyQ') ? 1 : 0);
    const spd = (input.down('ShiftLeft') || input.down('ShiftRight') ? 46 : 16) * dt;
    const cp = Math.cos(r.cam.pitch);
    const fx = -Math.sin(r.cam.yaw) * cp, fy = Math.sin(r.cam.pitch), fz = -Math.cos(r.cam.yaw) * cp;
    const rx = Math.cos(r.cam.yaw), rz = -Math.sin(r.cam.yaw);
    r.cam.x += (fx * f + rx * s) * spd; r.cam.y += (fy * f + up) * spd; r.cam.z += (fz * f + rz * s) * spd;

    // ---- Zeit ----
    if (!r.paused) r.t = Math.min(r.total, r.t + dt * r.speed);
    const tr = r.t0 + r.t;
    const fr = r.data.frames;
    let i = r.fi;
    while (i < fr.length - 2 && fr[i + 1][0] <= tr) i++;
    r.fi = i;
    const a = fr[i], b = fr[Math.min(i + 1, fr.length - 1)];
    const k = b[0] > a[0] ? clamp((tr - a[0]) / (b[0] - a[0]), 0, 1) : 1;
    for (let j = 0; j < r.n; j++) {
      const o = 1 + j * 8;
      const c = r.cur.get(this.actors[j].id);
      if (!c) continue;
      c.x = lerp(a[o], b[o], k); c.y = lerp(a[o + 1], b[o + 1], k); c.z = lerp(a[o + 2], b[o + 2], k);
      c.yaw = angleLerp(a[o + 3], b[o + 3], k); c.pitch = lerp(a[o + 4], b[o + 4], k);
      const flags = k < 0.5 ? a[o + 5] : b[o + 5];
      c.alive = !!(flags & 1); c.crouch = !!(flags & 2); c.grounded = !!(flags & 4); c.zip = !!(flags & 16);
      c.wid = r.wids[a[o + 6]] || 'ar';
      c.speed = lerp(a[o + 7], b[o + 7], k);
    }
    // Schuesse der uebersprungenen Frames (nur vorwaerts)
    if (!r.paused && r.speed <= 2) {
      for (let j = r.lastFrame + 1; j <= i; j++) {
        const fjs = fr[j];
        for (let n2 = 0; n2 < r.n; n2++) {
          if (!(fjs[1 + n2 * 8 + 5] & 8)) continue;
          const act = this.actors[n2];
          const w = WEAPONS[r.wids[fjs[1 + n2 * 8 + 6]]] || WEAPONS.ar;
          if (!act || !act.model || w.melee) continue;
          act.model.getMuzzleWorld(this._v3);
          audio.shot({ x: fjs[1 + n2 * 8], y: fjs[2 + n2 * 8] + 1.6, z: fjs[3 + n2 * 8] }, w.sound);
          if (this.effects && !w.suppressed) {
            const yaw = fjs[4 + n2 * 8], pitch = fjs[5 + n2 * 8], cpp = Math.cos(pitch);
            this.effects.muzzleFlash(this._v3.x, this._v3.y, this._v3.z, -Math.sin(yaw) * cpp, Math.sin(pitch), -Math.cos(yaw) * cpp, 0.7);
          }
        }
      }
    }
    r.lastFrame = i;

    // ---- Kamera + Modelle ----
    this.camera.position.set(r.cam.x, r.cam.y, r.cam.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(r.cam.pitch, r.cam.yaw, 0);
    this.camera.updateMatrixWorld();
    this._updateModels(r.paused ? 0.0001 : dt, r.cur, { hideId: -1, deadFromState: true });
    if (this.effects) this.effects.update(dt, this.camera);
    this._updateWeather(dt);
    const fwd = this._v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.setListener(this.camera.position, fwd, right);
    this.hud.updateReplay(r.t, r.total, r.speed, r.paused);
  }

  _replaySeek(t) {
    const r = this.replay;
    r.t = clamp(t, 0, r.total);
    const tr = r.t0 + r.t;
    let i = 0;
    while (i < r.data.frames.length - 2 && r.data.frames[i + 1][0] <= tr) i++;
    r.fi = i; r.lastFrame = i;
  }

  // --------------------------------------------------------
  // Hauptschleife
  // --------------------------------------------------------
  readInput(dt) {
    if (!this.running || !this.world || !this.player) return;
    this.player.handleInput(this.input, dt);
  }

  afterStep(dt) {
    // Online: Respawn-Anzeige herunterzaehlen (den Spawn selbst schickt der Server)
    if (this.online && this.player && !this.player.alive && this.player.respawnTimer < 1000) {
      this.player.respawnTimer = Math.max(0, this.player.respawnTimer - dt);
    }
    this._recordHistory();
    this._recordReplay();
  }

  postUpdate(dt) {
    if (!this.world || !this.player) return;
    this.frameDt = dt;
    const p = this.player;

    if (this.killcam) {
      // Replay aus den Augen des Killers
      this._killcamUpdate(dt);
      const fov = settings.fov;
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = damp(this.camera.fov, fov, 22, dt); this.camera.updateProjectionMatrix(); }
      this.camera.updateMatrixWorld();
      this._updateModels(dt, this.killcam.cur, { hideId: this.killcam.killerId, frozen: this.killcam.frozen });
      this.hud.setScope(false);
    } else {
      p.applyCamera(this.camera, this.world, dt);
      const fov = p.alive ? p.targetFov() : settings.fov;
      if (Math.abs(this.camera.fov - fov) > 0.01) {
        this.camera.fov = damp(this.camera.fov, fov, 22, dt);
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();

      this._updateModels(dt, null);

      const w = p.weapon;
      const scoped = w.scope && p.adsAmount > 0.72 && p.alive;
      this.viewmodel.setHidden(!p.alive || scoped || (p.thirdPerson || settings.thirdPerson));
      this.hud.setScope(scoped);
      if (!this.viewmodel.hidden) {
        this.viewmodel.setInspect(p.intent.inspect && p.alive);
        this.viewmodel.update(dt, {
          adsTarget: p.ads,
          moveSpeed: Math.hypot(p.vel.x, p.vel.z),
          grounded: p.grounded,
          sprint: p.sprinting,
          slide: p.sliding,
          crouch: p.crouching,
          firing: p.intent.fire || p.chargeT > 0,
          lookDX: p.lookDX,
          lookDY: p.lookDY,
          velY: p.vel.y,
          landImpact: p.landImpact > 0.35 ? p.landImpact * 0.4 : 0,
          charge: w.charge ? p.chargeT / w.charge.time : 0,
          arrowReady: p.ammo.mag > 0,
        });
      }
    }

    if (this.modeFx) this.modeFx.update(dt);
    this._updateDropMeshes(dt);
    this._updatePickupMeshes(dt);
    this._updateProjMeshes(dt);
    this._updateStrikes(dt);
    this._updateBurnFx(dt);
    if (this.effects) this.effects.update(dt, this.camera);
    this._updateWeather(dt);
    this._updateRopes();
    if (p.zip && p.alive) {
      this._zipSoundT -= dt;
      if (this._zipSoundT <= 0) { this._zipSoundT = 0.17; audio.zip(null, 'run'); }
    }

    if (this.muzzleLightT > 0) {
      this.muzzleLightT = Math.max(0, this.muzzleLightT - dt / 0.07);
      this.muzzleLight.intensity = 55 * Math.min(1, this.muzzleLightT);
      if (this.muzzleLightT <= 0) this.muzzleLight.visible = false;
    }
    if (this._hitTint > 0) this._hitTint -= dt;

    if (this.sun && this.sun.castShadow) {
      const d = this.world.map.sunDir;
      const cx = this.camera.position.x, cy = this.camera.position.y, cz = this.camera.position.z;
      this.sun.position.set(cx + d[0] * 110, cy + d[1] * 110, cz + d[2] * 110);
      this.sun.target.position.set(cx, cy, cz);
      this.sun.target.updateMatrixWorld();
    }

    const fwd = this._v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.setListener(this.camera.position, fwd, right);

    this._updateHud(dt);
  }

  /**
   * states: Map(id -> interpolierter Zustand) fuer Killcam / Replay oder null fuer Live.
   * ctx: { hideId, frozen, deadFromState }
   */
  _updateModels(dt, states, ctx) {
    const camPos = this.camera.position;
    const cx = ctx || {};
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (!a.model) continue;
      const st = states ? states.get(a.id) : null;
      let hidden;
      if (states) {
        hidden = a.id === cx.hideId || !st;
      } else {
        const firstPerson = a.isLocal && !(a.thirdPerson || settings.thirdPerson) && a.alive;
        const faded = !a.alive && a.model.deathT > 4.2;
        hidden = firstPerson || faded;
      }
      if (hidden) { a.model.setVisible(false); continue; }
      a.model.setVisible(true);

      if (st) {
        // Im Replay: Waffe der aufgezeichneten Zeit zeigen
        if (a.model.currentWeapon && a.model.currentWeapon.id !== st.wid && WEAPONS[st.wid]) {
          a.model.setWeapon(WEAPONS[st.wid], this.skinFor(a, WEAPONS[st.wid]), this.stickerFor(a, WEAPONS[st.wid]));
        }
        const victim = a.isLocal && !cx.deadFromState;
        const dead = cx.deadFromState ? !st.alive : (victim ? !!cx.frozen : !a.alive);
        a.model.update(dt, {
          x: st.x, y: st.y, z: st.z, yaw: st.yaw, pitch: st.pitch,
          speed: st.speed, grounded: st.grounded, crouch: st.crouch, slide: false, wallrun: 0, zipline: !!st.zip,
          dead,
          name: a.name, hp: cx.deadFromState ? a.maxHp : a.hp, maxHp: a.maxHp,
          enemy: !this.sameTeam(a, this.player),
          tagColor: !this.teamMode ? '#ffffff' : this.teamCssColor(a.team),
          showTag: !victim && !dead,
          marker: this.teamMode && !a.isLocal && this.sameTeam(a, this.player) ? 'friend' : null,
        }, camPos);
        continue;
      }

      let wallSide = 0;
      if (a.wallrun) {
        const rx = Math.cos(a.yaw), rz = -Math.sin(a.yaw);
        wallSide = a.wallrun.nx * rx + a.wallrun.nz * rz;
      }
      const friend = this.teamMode && !a.isLocal && this.sameTeam(a, this.player);
      const radar = !friend && !a.isLocal && this.player.uavUntil > this.time;
      a.model.update(dt, {
        x: a.pos.x, y: a.pos.y, z: a.pos.z,
        yaw: a.yaw, pitch: a.pitch,
        speed: Math.hypot(a.vel.x, a.vel.z),
        grounded: a.grounded,
        crouch: a.crouching || a.sliding,
        slide: a.sliding,
        wallrun: wallSide,
        zipline: !!a.zip,
        dead: !a.alive,
        name: a.name,
        hp: a.hp, maxHp: a.maxHp,
        enemy: !this.sameTeam(a, this.player),
        tagColor: !this.teamMode ? '#ffffff' : this.teamCssColor(a.team),
        showTag: !a.isLocal && a.alive,
        marker: friend ? 'friend' : radar ? 'enemy' : null,
        burning: a.burnT > 0,
        shield: a.shield > 0,
      }, camPos);
    }
  }

  _updateHud(dt) {
    const p = this.player;
    this.hud.updateStatus(p, dt);
    this.hud.updateWeapon(p);
    this.hud.updateStats(p);
    this.hud.updateDash(p, PHYS.DASH_COOLDOWN);
    this.hud.updateMatch(this.teamMode ? this.mode : 'ffa', this.scores.red, this.scores.blue, this.timeLeft);
    if (!p.alive) this.hud.updateDeathTimer(p.respawnTimer);

    // Countdown-Piepen der Matchuhr
    if (this.running && !this.over && !(this.modeCtl && this.modeCtl.ownsClock)) {
      const t = Math.ceil(this.timeLeft);
      if (t <= 5 && t > 0 && t !== this._lastCountdown) { this._lastCountdown = t; audio.countdown(t === 1); }
    }

    // Interaktions-Hinweis ([E] Seilbahn / Waffe / Bombe)
    const ia = p.alive ? this.interactionFor(p) : null;
    const prompt = ia ? ia.label : '';
    if (prompt !== this._prompt) { this._prompt = prompt; this.hud.setPrompt(prompt); }

    // Missionsziel, Killstreaks, Bestenliste
    this.hud.updateObjective(this.modeCtl ? this.modeCtl.hudText(p) : null);
    this.hud.updateStreaks(this.training ? null : p, this.time);
    this._boardT -= dt;
    if (this._boardT <= 0) {
      this._boardT = 0.5;
      this.hud.updateBoard(!this.teamMode && !this.training ? this : null);
    }

    const spread = p.currentSpread();
    const px = settings.dynCross
      ? Math.tan(spread) / Math.tan(deg(this.camera.fov) / 2) * (window.innerHeight / 2)
      : 0;
    const scoped = p.weapon.scope && p.adsAmount > 0.72;
    this.hud.updateCrosshair(clamp(px, 0, 90), !p.alive || scoped || !!this.killcam, this._hitTint > 0);

    this.hud.updateFloating(dt, this.camera);

    if (settings.showMinimap) {
      const items = this._mmItems || (this._mmItems = []);
      items.length = 0;
      if (this.modeCtl) this.modeCtl.minimapItems(items);
      this.minimap.draw(
        { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, actor: p, pickups: this.pickups, uav: p.uavUntil > this.time, items, teamMode: this.teamMode,
          teamCss: { red: this.teamCssColor('red'), blue: this.teamCssColor('blue') } },
        this.actors, (a, b) => this.sameTeam(a, b), this.time
      );
    }
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    if (this.post.enabled) {
      this.post.render(this.scene, this.camera,
        { scene: this.vmScene, camera: this.vmCamera, visible: !this.viewmodel.hidden }, this.frameDt);
      return;
    }
    r.setRenderTarget(null);
    r.clear();
    r.render(this.scene, this.camera);
    if (!this.viewmodel.hidden) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}
