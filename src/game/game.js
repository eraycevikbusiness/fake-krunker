// ============================================================
// Game: Renderer + Post-Processing, Match-Logik, Kampfsystem,
// Projektile, Pickups, Killcam (Replay der letzten 3 Sekunden),
// Blut-Decals, Ragdolls, Skins, Dash/Wandlauf-Callbacks
// ============================================================

import * as THREE from 'three';
import { World } from '../world/world.js';
import { buildMap } from '../world/mapdata.js';
import { Effects } from '../fx/effects.js';
import { PostFX } from '../fx/post.js';
import { refreshMaterials } from '../fx/materials.js';
import { LocalPlayer } from './player.js';
import { Bot } from './bot.js';
import { Actor } from './actor.js';
import { CharacterModel, buildWeaponMesh } from './character.js';
import { ViewModel } from './viewmodel.js';
import { makePropMaterial } from '../fx/materials.js';
import { WEAPONS, CLASSES } from './weapons.js';
import { PHYS } from './actor.js';
import { Training } from './training.js';
import { figureColors, KILL_EFFECT_BY_ID, KILL_ICON_BY_ID } from './cosmetics.js';
import { createMode, MODE_BY_ID } from './modes.js';
import { applyWeather } from '../world/weather.js';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { teamHex, teamCss, teamAccent, applyTeamCss } from '../core/teams.js';
import { clamp, lerp, rand, pick, makeBotNames, damp, deg, angleLerp } from '../core/utils.js';

// Killstreak-Belohnungen: Kills -> Belohnung
const STREAK_REWARDS = { 3: 'uav', 5: 'shield', 7: 'airstrike' };
const UAV_TIME = 14;
const SHIELD_AMOUNT = 80;
const SHIELD_TIME = 14;
const AIRSTRIKE_EX = { radius: 7.5, damage: 135, minMult: 0.25, force: 16, selfMult: 0.5 };
const BARREL_EX = { radius: 7.5, damage: 115, minMult: 0.25, force: 13, selfMult: 1 };
const TEAM_NAME = { red: 'ROT', blue: 'BLAU' };

// Bot-Sprueche (Chat)
const CHAT = {
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
};
const HAIR_COLORS = [0x2a1e14, 0x120c08, 0x6b4a2c, 0xc9a55a, 0x8a2a1a, 0x3a3a40];
const SHADOW_SIZE = { off: 0, low: 1024, high: 2048, ultra: 4096 };
const SKINS_TONE = [0xd4a985, 0xbd8d63, 0x9a6a42, 0x6e4a2c, 0xcdb090];

const STREAK_NAMES = {
  2: 'DOPPELKILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL', 5: 'AMOKLAUF',
  7: 'UNAUFHALTSAM', 10: 'GOTTGLEICH', 15: 'LEGENDÄR', 20: 'UNSTERBLICH',
};

const MELEE_RAYS = [
  [0, 0], [-0.18, 0], [0.18, 0], [-0.36, -0.05], [0.36, -0.05],
  [0, -0.22], [0, 0.18], [-0.2, -0.25], [0.2, -0.25],
];

const KILLCAM_LEN = 3.0;        // Sekunden Replay vor dem Tod
const HIST_RATE = 1 / 60;       // Aufzeichnungsrate
const HIST_CAP = 260;           // ~4.3 s Ringpuffer

export class Game {
  constructor(canvas, hud, minimap, input) {
    this.canvas = canvas;
    this.hud = hud;
    this.minimap = minimap;
    this.input = input;

    this.time = 0;
    this.running = false;
    this.paused = false;
    this.over = false;
    this.dynScale = 1;
    this.pendingClassId = null;
    this.frameDt = 0.016;

    this._initRenderer();

    this.actors = [];
    this.projectiles = [];
    this.pickups = [];
    this.jumpPads = [];
    this.pendingMelee = [];
    this.scores = { red: 0, blue: 0 };
    this.hist = { frames: [], head: 0, count: 0, cap: HIST_CAP, lastT: -1 };
    this.killcam = null;
    this.training = null;
    this.modeCtl = null;          // CTF / Hardpoint / Gun Game / Infection / S&D
    this.teamMode = true;
    this.weather = null;
    this.lamps = [];
    this.airstrikes = [];
    this.pendingDestr = [];
    this._destrList = [];
    this._boardT = 0;
    this._lightningT = 0;
    this._spinSoundT = new Map();
    this.ziplines = [];
    this.zipMeshes = [];
    this.ropes = new Map();        // Akteur -> Seil-Mesh (Enterhaken)
    this.drops = [];               // liegende Waffen
    this._zipSoundT = 0;
    this._prompt = '';
    this.rec = null;               // Match-Aufzeichnung (Replay)
    this.replay = null;            // laufende Wiedergabe
    this.replaying = false;

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._dmgAcc = new Map();
    this._hitTint = 0;
    this.muzzleLightT = 0;

    this.onMatchEnd = null;
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
  teamName(team) {
    const m = this.modeCtl;
    if (m && m.teamNames && m.teamNames[team]) return m.teamNames[team];
    return TEAM_NAME[team] || String(team).toUpperCase();
  }
  _applyTeamCss() {
    const m = this.modeCtl;
    const ov = m && m.teamHex ? { red: { css: m.teamHex.red, bg: 'rgba(60,160,60,0.55)' }, blue: { css: m.teamHex.blue, bg: 'rgba(50,110,200,0.55)' } } : null;
    applyTeamCss(document.documentElement, ov);
  }

  /** Bot-Chat mit Abklingzeit pro Bot und global */
  botChat(bot, kind) {
    if (!bot || bot.isLocal || !this.running) return;
    if (settings.botChat === false) return;
    const now = this.time;
    if (now - (this._chatGlobalT || -9) < 2.2) return;
    if (now - (bot._chatT || -99) < 10) return;
    const list = CHAT[kind];
    if (!list) return;
    const chance = kind === 'start' ? 0.35 : kind === 'killed' ? 0.4 : kind === 'help' || kind === 'flag' ? 0.85 : 0.5;
    if (Math.random() > chance) return;
    this._chatGlobalT = now; bot._chatT = now;
    this.hud.chat(bot.name, pick(list), this.teamMode ? bot.team : null, false);
    audio.chat();
  }

  /** Modell eines Akteurs neu bauen (Teamwechsel, Outfit) */
  rebuildActorModel(a) {
    if (a.model) a.model.dispose();
    a.model = this._makeModel(a);
    if (!a.alive) a.model.setVisible(false);
    if (a.isLocal) {
      this._applyPlayerOutfitToViewmodel();
      this.viewmodel.setWeapon(a.weapon, a.skin, this.skinFor(a), this.stickerFor(a));
    }
  }

  /** Skin-Id fuer eine Waffe eines Akteurs */
  skinFor(actor, weapon) {
    const w = weapon || actor.weapon;
    return (actor.skins && actor.skins[w.id]) || 'default';
  }
  /** Sticker-Id fuer eine Waffe eines Akteurs */
  stickerFor(actor, weapon) {
    const w = weapon || actor.weapon;
    return (actor.stickers && actor.stickers[w.id]) || 'none';
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

  // --------------------------------------------------------
  // Match aufsetzen
  // --------------------------------------------------------
  start(cfg) {
    this.cleanup();

    const training = !!cfg.training;
    this._matchId = (this._matchId || 0) + 1;
    this._chatGlobalT = -9;
    this.mode = training ? 'training' : (MODE_BY_ID[cfg.mode] ? cfg.mode : 'tdm');
    this.teamMode = !training && !!MODE_BY_ID[this.mode].team;
    this.scoreLimit = cfg.scoreLimit || 40;
    this.timeLimit = (cfg.timeLimit || 10) * 60;
    this.timeLeft = this.timeLimit;
    this.difficulty = clamp(cfg.difficulty | 0, 0, 3);
    this.over = false;
    this.time = 0;
    this.scores.red = 0;
    this.scores.blue = 0;
    this._lastCountdown = 0;
    this.pendingClassId = null;
    this.hist = { frames: [], head: 0, count: 0, cap: HIST_CAP, lastT: -1 };
    this.killcam = null;
    this.airstrikes = [];
    this.pendingDestr = [];

    // Karte + Wetter/Tageszeit
    const wx = applyWeather(buildMap(training ? 'range' : (cfg.map || 'sandstorm')), training ? 'clear' : (cfg.weather || 'clear'));
    const mapDef = wx.map;
    this.weather = wx;
    this.world = new World(this.scene, mapDef, this.renderer);
    this.vmScene.environment = this.scene.environment;
    this.jumpPads = mapDef.jumpPads || [];
    this._applyFog();
    this._setupLights(mapDef);
    this._setupWeather(wx);
    this._buildZiplines(mapDef);
    this.minimap.build(mapDef);

    this.effects = new Effects(this.scene);
    this.viewmodel.setFlashTexture(this.effects.flashTex);
    this.effects.setRain(!!wx.rain);
    audio.rain(!!wx.rain);

    this.pickups = (mapDef.pickups || []).map((p) => this._makePickup(p));

    const localTeam = 'red';
    this.player = new LocalPlayer(this, {
      name: (cfg.name || 'Player').slice(0, 16) || 'Player',
      team: this.teamMode ? localTeam : 'ffa0',
      classId: cfg.classId || 'triggerman',
      attachments: cfg.attachments || {},
    });
    this.player.thirdPerson = settings.thirdPerson;
    this.player.skins = cfg.skins || {};
    this.player.stickers = cfg.stickers || {};
    this.player.outfit = cfg.outfit || 'team';
    this.player.hat = cfg.hat || 'none';
    this.player.killEffect = cfg.killEffect || 'none';
    this.player.killIcon = cfg.killIcon || 'none';
    this.player.model = this._makeModel(this.player);
    this.actors = [this.player];

    const botCount = training ? 0 : clamp(cfg.bots | 0, 1, 15);
    const names = makeBotNames(Math.max(1, botCount));
    const classIds = CLASSES.map(c => c.id);
    for (let i = 0; i < botCount; i++) {
      let team;
      if (!this.teamMode) team = 'ffa' + (i + 1);
      else team = (i % 2 === 0) ? 'blue' : 'red';
      const bot = new Bot(this, {
        name: names[i],
        team,
        classId: pick(classIds),
        difficulty: this._botDifficulty(i, botCount),
      });
      bot.model = this._makeModel(bot);
      this.actors.push(bot);
    }

    if (training) this.training = new Training(this, cfg.training);

    // Modus mit Zielen (CTF, Hardpoint, Gun Game, Infection, S&D)
    this.modeCtl = training ? null : createMode(this.mode, this, mapDef, this.scoreLimit, this.timeLimit);
    if (this.modeCtl && this.modeCtl.setupActor) {
      for (const a of this.actors) this.modeCtl.setupActor(a);
      // Teamfarben koennen sich geaendert haben (Infection) -> Modelle neu
      for (const a of this.actors) { if (a.model) a.model.dispose(); a.model = this._makeModel(a); }
    }
    this._applyTeamCss();

    for (const a of this.actors) this.respawn(a, true);

    this.player.applyCamera(this.camera, this.world, 0.016);
    this.camera.updateMatrixWorld();

    this.hud.clearFloating();
    this.hud.show(true);
    this.hud.hideDeath();
    this.hud.setKillcam(null);
    this.hud.setTraining(null);
    this.hud.setMyTeam(this.teamMode ? this.player.team : null);
    this.hud.setMinimapVisible(settings.showMinimap);
    this.running = true;
    this.paused = false;

    // Aufzeichnung fuer das Replay (20 Hz, alle Akteure)
    this.rec = training ? null : {
      rate: 1 / 20, lastT: -1, frames: [],
      meta: {
        map: cfg.map || 'sandstorm', weather: cfg.weather || 'clear', mode: this.mode, scoreLimit: this.scoreLimit,
        weaponIds: Object.keys(WEAPONS),
        actors: this.actors.map(a => ({
          name: a.name, team: a.team, classId: a.classDef.id, isLocal: !!a.isLocal,
          outfit: a.outfit || 'team', hat: a.hat || 'none', skin: a.skin, hair: a.hair,
          skins: Object.assign({}, a.skins || {}), stickers: Object.assign({}, a.stickers || {}),
        })),
      },
    };

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

  // --------------------------------------------------------
  // Seilbahnen, Enterhaken-Seile, liegende Waffen, Interaktion
  // --------------------------------------------------------
  _buildZiplines(mapDef) {
    for (const m of this.zipMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.zipMeshes = [];
    this.ziplines = mapDef.ziplines || [];
    if (!this._zipMat) this._zipMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.5, metalness: 0.8 });
    for (const z of this.ziplines) {
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
      if (ia.type === 'zip') a.attachZip(ia.z, ia.fromA);
      else if (ia.type === 'drop') this.pickupDrop(a, ia.d);
      else if (ia.type === 'bomb' && this.modeCtl.interact) this.modeCtl.interact(a, ia);
    }
  }

  /** Beim Tod: Primaerwaffe fallen lassen */
  _dropWeapon(victim) {
    if (this.training || this.mode === 'gungame') return;
    const s = victim.slots[0];
    if (!s || !s.w || s.w.melee || s.w.mag === Infinity) return;
    if (s.mag <= 0 && s.reserve <= 0) return;
    if (!this._dropMat) this._dropMat = makePropMaterialDrop();
    const y = this.world.groundAt(victim.pos.x, victim.pos.z, victim.pos.y + 1.5);
    const mesh = buildWeaponMesh(s.w, 1.0, this._dropMat, this.skinFor(victim, s.w), this.stickerFor(victim, s.w));
    mesh.position.set(victim.pos.x + rand(-0.4, 0.4), y + 0.16, victim.pos.z + rand(-0.4, 0.4));
    mesh.rotation.set(0, rand(0, Math.PI * 2), Math.PI / 2);
    this.scene.add(mesh);
    const ring = new THREE.Mesh(this._ringGeo || (this._ringGeo = new THREE.BoxGeometry(1.5, 0.06, 1.5)),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.3 }));
    ring.position.set(mesh.position.x, y + 0.03, mesh.position.z);
    this.scene.add(ring);
    this.drops.push({ w: s.w, mag: s.mag, reserve: Math.max(s.reserve, Math.floor(s.w.mag * 1.5)), x: mesh.position.x, y, z: mesh.position.z, t: 30, mesh, ring, skin: this.skinFor(victim, s.w), sticker: this.stickerFor(victim, s.w) });
    while (this.drops.length > 12) this._removeDrop(0);
  }

  _removeDrop(i) {
    const d = this.drops[i];
    this.scene.remove(d.mesh, d.ring);
    d.ring.material.dispose();
    this.drops.splice(i, 1);
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
    if (actor.slot === idx) {
      actor.reloadTimer = 0; actor.chargeT = 0; actor.spinT = 0; actor.switchTimer = d.w.switchTime || 0.4;
      this.onWeaponSwitch(actor);
    } else if (actor.model) {
      actor.model.setWeapon(actor.weapon, this.skinFor(actor), this.stickerFor(actor));
    }
    if (actor.isLocal) { audio.pickupWeapon(); this.hud.toast(d.w.name.toUpperCase() + ' AUFGEHOBEN', true); }
    if (actor.isBot) actor._updatePreferredRange();
  }

  _updateDrops(dt) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t -= dt;
      if (d.t <= 0) { this._removeDrop(i); continue; }
      d.mesh.position.y = d.y + 0.16 + Math.sin(this.time * 2.5 + i) * 0.04;
      d.ring.rotation.y += dt * 0.9;
      d.ring.material.opacity = 0.2 + Math.sin(this.time * 3) * 0.08;
      if (d.t < 4) d.mesh.visible = (this.time * 6 | 0) % 2 === 0;
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
      setTimeout(() => { if (this.running) audio.thunder(); }, d * 1000);
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

  /** Spielfigur des lokalen Spielers neu bauen (Outfit/Hut im Menue geaendert) */
  rebuildPlayerModel() {
    if (!this.player || !this.world) return;
    this.rebuildActorModel(this.player);
  }

  /** Aufsaetze des Spielers im Menue geaendert */
  setPlayerAttachments(att) {
    const p = this.player;
    if (!p || !this.world) return;
    p.attachments = att || {};
    p.refreshAttachments();
    if (p.alive && !this.killcam) this.onWeaponSwitch(p);
    else if (p.model) p.model.setWeapon(p.weapon, this.skinFor(p), this.stickerFor(p));
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

  _botDifficulty(i, n) {
    const base = this.difficulty;
    const r = Math.random();
    if (r < 0.2) return clamp(base - 1, 0, 3);
    if (r > 0.85) return clamp(base + 1, 0, 3);
    return base;
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
    return palette[(actor.id - 1) % palette.length];
  }

  _makePickup(p) {
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

    const ring = new THREE.Mesh(
      this._ringGeo,
      new THREE.MeshBasicMaterial({ color: colors[p.type], transparent: true, opacity: 0.35 })
    );
    ring.position.set(p.x, p.y - 0.75, p.z);
    this.scene.add(ring);

    return { x: p.x, y: p.y, z: p.z, type: p.type, mesh, ring, active: true, respawn: 0 };
  }

  cleanup() {
    this.running = false;
    this.killcam = null;
    if (this.training) { this.training.dispose(); this.training = null; }
    if (this.modeCtl) { this.modeCtl.dispose(); this.modeCtl = null; }
    for (const l of this.lamps) this.scene.remove(l);
    this.lamps = [];
    this.airstrikes = [];
    this.pendingDestr = [];
    for (const m of this.zipMeshes) { this.scene.remove(m); m.geometry.dispose(); }
    this.zipMeshes = [];
    this.ziplines = [];
    for (const m of this.ropes.values()) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); }
    this.ropes.clear();
    while (this.drops.length) this._removeDrop(0);
    audio.rain(false);
    if (this.hud) { this.hud.setKillcam(null); this.hud.setTraining(null); this.hud.setMyTeam(null); this.hud.updateObjective(null); this.hud.updateStreaks(null); this.hud.updateBoard(null); }
    for (const a of this.actors || []) if (a.model) a.model.dispose();
    this.actors = [];
    for (const p of this.projectiles || []) if (p.mesh) { this.scene.remove(p.mesh); p.mesh.material.dispose(); }
    this.projectiles = [];
    this.pendingMelee = [];
    for (const p of this.pickups || []) {
      this.scene.remove(p.mesh); this.scene.remove(p.ring);
      p.mesh.material.dispose(); p.ring.material.dispose();
    }
    this.pickups = [];
    if (this.effects) { this.effects.dispose(); this.effects = null; }
    if (this.world) { this.world.dispose(); this.world = null; }
    this.vmScene.environment = null;
    this._dmgAcc.clear();
    this.muzzleLightT = 0;
    this.muzzleLight.visible = false;
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

  autoReloadFor(actor) { return actor.isBot ? true : settings.autoReload; }

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

  respawn(actor, initial) {
    if (actor.isLocal && this.pendingClassId) {
      actor.setClass(this.pendingClassId);
      this.pendingClassId = null;
    }
    if (this.modeCtl && this.modeCtl.beforeRespawn) this.modeCtl.beforeRespawn(actor);
    if (actor.isLocal) this.endKillcam();

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
    actor.spawn({ x: sx, y: sy, z: sz, yaw: best.yaw });
    if (this.training && actor.isLocal) {
      // Unbegrenzte Reserve im Training
      for (const s of actor.slots) if (s.w.mag !== Infinity) s.reserve = 9999;
    }
    if (actor.model) {
      actor.model.resetDeath();
      actor.model.setWeapon(actor.weapon, this.skinFor(actor), this.stickerFor(actor));
      actor.model.setVisible(true);
    }
    if (this.effects) {
      const col = !this.teamMode ? this._ffaColor(actor) : this.teamColor(actor.team);
      this.effects.spawnFlash(actor.pos.x, actor.pos.y, actor.pos.z, col);
    }
    if (actor.isLocal) {
      this.hud.hideDeath();
      this._applyPlayerOutfitToViewmodel();     // nach der Killcam wieder die eigenen Aermel
      this.viewmodel.setWeapon(actor.weapon, actor.skin, this.skinFor(actor), this.stickerFor(actor));
      this.viewmodel.setHidden(false);
      if (!initial) { audio.tone(540, 0.09, 0.2, 'sine'); audio.draw(null, actor.weapon.hold); }
    }
  }

  // --------------------------------------------------------
  // Waffenwirkung
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
    out.set(actor.pos.x, actor.pos.y + actor.eyeHeight(), actor.pos.z);
    return out;
  }

  fireWeapon(actor, heavy, power) {
    const w = actor.weapon;
    // Schallgedaempft: Bots hoeren den Schuss nur ganz kurz (0.3 s statt 1.2 s Fenster)
    actor.lastLoudTime = w.suppressed ? this.time - 0.9 : this.time;
    const pw = power === undefined ? 1 : power;

    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);
    this.muzzleWorld(actor, this._muzzle);

    const soundPos = actor.isLocal ? null : { x: actor.pos.x, y: actor.pos.y + 1.6, z: actor.pos.z };
    if (actor.isBot && actor.onShotFired) actor.onShotFired(w);
    if (w.melee) {
      const h = heavy && w.heavy ? w.heavy : null;
      const def = h ? Object.assign({ id: w.id, headMult: w.headMult, knockback: w.knockback }, h) : w;
      const swingTime = def.swingTime || 0.32;
      audio.swing(soundPos, w.hold, !!h);
      const delay = swingTime * (h ? (h.hitAt || 0.45) : 0.3);
      this.pendingMelee.push({ actor, w: def, t: delay, kind: w.hold, heavy: !!h });
      const lunge = h ? h.lunge : w.lunge;
      if (lunge) this._meleeLunge(actor, (def.meleeRange || 3.4) * 1.8, lunge);
      if (actor.isLocal) this.viewmodel.melee(h ? h.swing : null, swingTime);
      if (actor.model) actor.model.triggerSwing(swingTime, h ? h.swing : w.swing);
      return;
    }

    actor.lastShotTime = this.time;
    audio.shot(soundPos, w.charge ? Object.assign({ power: pw }, w.sound) : w.sound);
    if (actor.isLocal && this.training) this.training.onShot();

    if (actor.isLocal) {
      if (w.throwWeapon) this.viewmodel.throwKnife(w.reloadTime);
      else this.viewmodel.fire(w.flame ? 0.15 : 1);
      actor.addRecoil(
        deg(w.recoilV) * rand(0.75, 1.15) * pw,
        deg(w.recoilH) * rand(-1, 1)
      );
      actor.addShake(w.kick * 1.4);
      if (!w.flame && !w.throwWeapon && !w.charge && !w.suppressed) {
        this.muzzleLight.position.copy(this._muzzle);
        this.muzzleLight.visible = true;
        this.muzzleLightT = 1;
      }
      if (!w.projectile && !w.flame && this.effects) {
        const right = this._v3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        this.effects.shell(
          this._muzzle.x - dir.x * 0.9 + right.x * 0.12,
          this._muzzle.y - dir.y * 0.9 + 0.05,
          this._muzzle.z - dir.z * 0.9 + right.z * 0.12,
          right.x * rand(2, 4) + actor.vel.x, rand(2, 4) + actor.vel.y, right.z * rand(2, 4) + actor.vel.z
        );
      }
    } else {
      if (actor.model) actor.model.triggerRecoil(w.flame ? 0.1 : 0.8);
      if (this.effects && !w.flame && !w.throwWeapon && !w.charge && !w.suppressed) {
        this.effects.muzzleFlash(this._muzzle.x, this._muzzle.y, this._muzzle.z, dir.x, dir.y, dir.z, 0.7);
      }
    }

    if (w.projectile) {
      this.spawnProjectile(actor, w, this._muzzle, dir, w.projectile, pw);
      return;
    }

    const spread = actor.currentSpread();
    const pellets = w.pellets || 1;
    let anyHit = false, anyKill = false, anyHead = false, hitDist = 0;
    const acc = this._dmgAcc;
    acc.clear();

    if (w.flame && this.effects) this.effects.flame(this._muzzle.x, this._muzzle.y, this._muzzle.z, dir.x, dir.y, dir.z);

    for (let i = 0; i < pellets; i++) {
      const d = this._spreadDir(dir, spread, this._v3);
      const r = this._hitscan(actor, eye, d, w, acc, !!w.flame);
      if (r.actorHit) {
        anyHit = true; if (r.head) anyHead = true; if (r.killed) anyKill = true;
        hitDist = Math.hypot(r.x - eye.x, r.y - eye.y, r.z - eye.z);
        // Brandschaden: brennt nach dem Treffer weiter
        if (w.burn && r.victim && r.victim.alive) {
          r.victim.burnT = w.burn.time;
          r.victim.burnFrom = actor;
          r.victim.burnDps = w.burn.dps;
        }
      }
      if (this.effects && !w.flame && (pellets === 1 || i % 2 === 0)) {
        this.effects.tracer(
          this._muzzle.x, this._muzzle.y, this._muzzle.z,
          r.x, r.y, r.z, w.tracer, w.tracerWidth
        );
      }
    }

    if (actor.isLocal) {
      // Flammenwerfer: Zahlen und Ticks nur alle 0.2 s, sonst Dauerfeuer im HUD
      const throttle = w.flame && (this.time - (actor._lastHitmark || -9)) < 0.2 && !anyKill;
      if (!throttle) {
        acc.forEach((v) => {
          if (v.dmg > 0) this.hud.popup(v.x, v.y, v.z, Math.round(v.dmg), v.killed ? 'kill' : v.head ? 'head' : '');
        });
        if (anyHit) {
          actor._lastHitmark = this.time;
          this.hud.hitmarker(anyKill ? 'kill' : anyHead ? 'head' : 'hit');
          audio.hitmarker(anyHead, anyKill, hitDist);
          this._hitTint = 0.14;
        }
      }
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

  _hitscan(shooter, eye, dir, w, acc, quiet) {
    let remaining = w.pierce || 0;
    let ox = eye.x, oy = eye.y, oz = eye.z;
    let maxDist = w.range;
    let travelled = 0;
    const ignored = shooter._pierceIgnore || (shooter._pierceIgnore = new Set());
    ignored.clear();
    ignored.add(shooter);

    const out = this._hsOut || (this._hsOut = { x: 0, y: 0, z: 0, actorHit: false, head: false, killed: false, victim: null });
    out.actorHit = false; out.head = false; out.killed = false; out.victim = null;

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
          out.actorHit = true; out.head = false; out.killed = false;
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
          x: hx, y: hy, z: hz, dirx: dir.x, diry: dir.y, dirz: dir.z, head, noPopup: !!acc,
        });

        out.x = hx; out.y = hy; out.z = hz;
        out.actorHit = true;
        out.victim = bestActor;
        if (head) out.head = true;
        if (res && res.killed) out.killed = true;
        if (acc && res) {
          let e = acc.get(bestActor);
          if (!e) { e = { dmg: 0, x: hx, y: hy, z: hz, head: false, killed: false }; acc.set(bestActor, e); }
          e.dmg += res.damage;
          if (head) e.head = true;
          if (res.killed) e.killed = true;
        }

        if (!quiet) {
          if (this.effects) this.effects.blood(hx, hy, hz, dir.x, dir.y, dir.z, head);
          this._bloodOnWorld(hx, hy, hz, dir.x, dir.y, dir.z, dmg, head || (res && res.killed));
          audio.flesh({ x: hx, y: hy, z: hz });
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
        if (!quiet) {
          if (this.effects) this.effects.impact(wallHit.x, wallHit.y, wallHit.z, wallHit.nx, wallHit.ny, wallHit.nz);
          audio.impact({ x: wallHit.x, y: wallHit.y, z: wallHit.z });
        }
        this._damageWorld(wallHit, w.damage * (w.pellets > 1 ? 1 : 1.5), shooter);
        this._whizzCheck(eye, dir, travelled + wallHit.t, shooter);
      } else {
        out.x = ox + dir.x * maxDist;
        out.y = oy + dir.y * maxDist;
        out.z = oz + dir.z * maxDist;
        this._whizzCheck(eye, dir, travelled + maxDist, shooter);
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
    if (!this.world.damageDestructible(c, dmg)) return false;
    this._destroyed(c, attacker);
    return true;
  }

  _destroyed(c, attacker) {
    const d = c.destr;
    const cx = (c.minx + c.maxx) / 2, cy = (c.miny + c.maxy) / 2, cz = (c.minz + c.maxz) / 2;
    if (d.type === 'glass') {
      const w = Math.max(d.w, d.d), nx = d.w < d.d ? 1 : 0, nz = nx ? 0 : 1;
      if (this.effects) this.effects.glass(cx, cy, cz, nx, 0, nz, w, d.h);
      audio.breakGlass({ x: cx, y: cy, z: cz });
    } else if (d.type === 'barrel') {
      if (this.effects) this.effects.splinters(cx, cy, cz, 0x6a2a20, 0.8);
      audio.breakWood({ x: cx, y: cy, z: cz });
      this.explode(cx, cy + 0.3, cz, BARREL_EX, attacker || null, null, null, 'barrel');
    } else {
      if (this.effects) this.effects.splinters(cx, cy, cz, d.color, d.w / 2.4);
      audio.breakWood({ x: cx, y: cy, z: cz });
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
        const from = a.burnFrom && a.burnFrom.alive ? a.burnFrom : a.burnFrom;
        this.damageActor(a, from && from !== a ? from : null, (a.burnDps || 8) * 0.25, 'flame', {
          x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z, dirx: 0, diry: 0.4, dirz: 0, head: false, noPopup: !(a.burnTick === 0.25 && Math.random() < 0.5), strength: 4,
        });
        if (this.effects) this.effects.burn(a.pos.x, a.pos.y, a.pos.z);
        if (Math.random() < 0.35) audio.burn({ x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
      }
      if (a.burnT <= 0) { a.burnT = 0; a.burnFrom = null; }
    }
  }

  // --------------------------------------------------------
  // Killstreaks
  // --------------------------------------------------------
  _onStreak(a) {
    if (settings.killstreaks === false) return;
    const reward = STREAK_REWARDS[a.streak];
    if (!reward) return;
    if (reward === 'uav') {
      a.uavUntil = this.time + UAV_TIME;
      if (a.isLocal) { this.hud.toast('UAV AKTIV · GEGNER AUF DEM RADAR'); audio.reward(3); }
    } else if (reward === 'shield') {
      a.shield = SHIELD_AMOUNT; a.shieldT = SHIELD_TIME;
      if (a.isLocal) { this.hud.toast('SCHILD AKTIV · +' + SHIELD_AMOUNT); audio.reward(5); }
    } else if (reward === 'airstrike') {
      a.airstrikes++;
      if (a.isLocal) { this.hud.toast('LUFTSCHLAG BEREIT · TASTE 4'); audio.reward(7); }
    }
    if (!a.isLocal && this.sameTeam(a, this.player)) this.hud.toast(a.name + ': ' + (reward === 'uav' ? 'UAV' : reward === 'shield' ? 'SCHILD' : 'LUFTSCHLAG'), true);
  }

  /** Luftschlag auf den Blickpunkt (Rueckgabe: ausgeloest?) */
  callAirstrike(actor) {
    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);
    const hit = this.world.raycast(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 160);
    let x, y, z;
    if (hit) { x = hit.x; y = hit.y; z = hit.z; }
    else { x = eye.x + dir.x * 60; z = eye.z + dir.z * 60; y = this.world.groundAt(x, z, 60); }
    // Linie quer zur Blickrichtung
    const l = Math.max(0.001, Math.hypot(dir.x, dir.z));
    const px = -dir.z / l, pz = dir.x / l;
    this.airstrikes.push({ x, y, z, px, pz, owner: actor, t: 1.8, next: 0, i: 0, jet: false });
    if (actor.isLocal) this.hud.toast('LUFTSCHLAG ANGEFORDERT', true);
    return true;
  }

  _updateAirstrikes(dt) {
    for (let i = this.airstrikes.length - 1; i >= 0; i--) {
      const s = this.airstrikes[i];
      s.t -= dt;
      if (s.t > 0) {
        s.next -= dt;
        if (s.next <= 0 && this.effects) { s.next = 0.12; this.effects.markSmoke(s.x, s.y, s.z); }
        if (!s.jet && s.t < 1.1) { s.jet = true; audio.jet({ x: s.x, y: s.y + 30, z: s.z }); }
        continue;
      }
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

  _whizzCheck(eye, dir, dist, shooter) {
    const p = this.player;
    if (!p || !p.alive || shooter === p) return;
    const cx = p.pos.x - eye.x, cy = p.pos.y + 1.4 - eye.y, cz = p.pos.z - eye.z;
    const proj = cx * dir.x + cy * dir.y + cz * dir.z;
    if (proj < 1 || proj > dist) return;
    const px = cx - dir.x * proj, py = cy - dir.y * proj, pz = cz - dir.z * proj;
    const d2 = px * px + py * py + pz * pz;
    if (d2 < 6.25) {
      audio.whizz({ x: eye.x + dir.x * proj, y: eye.y + dir.y * proj, z: eye.z + dir.z * proj });
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
        if (this.effects) this.effects.impact(wh.x, wh.y, wh.z, wh.nx, wh.ny, wh.nz);
        if (actor.isLocal) this.viewmodel.hitKick(heavy);
      }
    }

    // Trainings-Zielscheiben auch mit Nahkampf
    if (!hit && this.training && actor.isLocal) {
      const dir = actor.lookDir(this._v2);
      const th = this.training.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, range + 0.5);
      if (th) {
        this.training.hit(th.target, eye.x + dir.x * th.t, eye.y + dir.y * th.t, eye.z + dir.z * th.t);
        this.hud.hitmarker('hit');
        audio.hitmarker(false, false, th.t);
        this.viewmodel.hitKick(heavy);
        this._hitTint = 0.16;
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
        dirx: dir.x, diry: dir.y, dirz: dir.z, head, strength: heavy ? 12 : 8,
      });
      const kb = (w.knockback || 4) * (heavy ? 1.6 : 1);
      if (hit.alive) {
        hit.vel.x += dir.x * kb;
        hit.vel.z += dir.z * kb;
        hit.vel.y += kb * 0.35;
        hit.grounded = false;
        hit.coyote = 0;
      }
      if (this.effects) {
        this.effects.blood(hx.x, hx.y, hx.z, dir.x, dir.y, dir.z, true);
        if (heavy) this.effects.blood(hx.x, hx.y, hx.z, dir.x, dir.y + 0.4, dir.z, true);
      }
      this._bloodOnWorld(hx.x, hx.y, hx.z, dir.x, dir.y, dir.z, dmg, true);
      audio.meleeHit(actor.isLocal ? null : { x: hx.x, y: hx.y, z: hx.z }, kind, heavy);
      if (actor.isLocal) {
        this.hud.hitmarker(res && res.killed ? 'kill' : (back || head) ? 'head' : 'hit');
        audio.hitmarker(back || head, res && res.killed, bestD);
        actor.addShake(heavy ? 0.5 : 0.25);
        this.viewmodel.hitKick(heavy);
        this._hitTint = 0.16;
      }
    }
  }

  quickMelee(actor) {
    audio.swing(actor.isLocal ? null : { x: actor.pos.x, y: actor.pos.y + 1.5, z: actor.pos.z }, 'bash', false);
    if (actor.isLocal) this.viewmodel.melee('bash', 0.34);
    if (actor.model) actor.model.triggerSwing(0.34, 'bash');
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
    if (!this._projGeo) this._projGeo = new Map();
    let geo = this._projGeo.get(weapon.id);
    if (!geo) {
      if (def.arrow) geo = new THREE.BoxGeometry(0.05, 0.05, 1.0);
      else if (def.knife) geo = new THREE.BoxGeometry(0.06, 0.16, 0.5);
      else geo = new THREE.BoxGeometry(def.radius * 2, def.radius * 2, def.radius * 3);
      this._projGeo.set(weapon.id, geo);
    }
    const c = new THREE.Color(def.color);
    if (def.glow) c.multiplyScalar(2.5);
    const mat = def.knife || def.arrow
      ? new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: def.knife ? 0.9 : 0.2 })
      : new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const spread = actor.currentSpread();
    const d = this._spreadDir(dir, spread, this._v4);
    const pw = power === undefined ? 1 : power;
    const speed = def.speed * (weapon.charge ? lerp(0.5, 1, pw) : 1);

    this.projectiles.push({
      x: origin.x, y: origin.y, z: origin.z,
      vx: d.x * speed + actor.vel.x * 0.25,
      vy: d.y * speed + actor.vel.y * 0.25,
      vz: d.z * speed + actor.vel.z * 0.25,
      def, weapon, owner: actor, mesh,
      life: def.fuse !== undefined ? def.fuse : 6,
      trailT: 0,
      isGrenade: def.fuse !== undefined,
      dmgMult: weapon.charge ? lerp(0.35, 1, pw) : 1,
      spin: def.knife ? 0 : null,
    });
  }

  throwGrenade(actor) {
    const w = WEAPONS.grenade;
    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);
    const origin = this._v3.set(
      eye.x + dir.x * 0.7, eye.y + dir.y * 0.7 + 0.1, eye.z + dir.z * 0.7
    );
    const d = this._v4.set(dir.x, dir.y + 0.22, dir.z).normalize();
    this.spawnProjectile(actor, w, origin, d, w.projectile);
    audio.click(actor.isLocal ? null : { x: actor.pos.x, y: actor.pos.y + 1.5, z: actor.pos.z }, 700, 0.25, 0.08);
    if (actor.isLocal) this.viewmodel.melee('throw');
    if (actor.model) actor.model.triggerSwing(0.4);
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
              if (Math.abs(dot) > 2) audio.impact({ x: hx, y: hy, z: hz }, false);
              continue;
            }
            this._projectileHit(p, hx, hy, hz, ux, uy, uz, null, null);
            exploded = true;
            break;
          }
        }
        p.x = nx; p.y = ny; p.z = nz;
      }

      if (exploded) { this._removeProjectile(i); continue; }

      p.trailT -= dt;
      if (p.trailT <= 0 && this.effects && !def.noTrail) {
        p.trailT = 0.016;
        this.effects.trail(p.x, p.y, p.z, def.glow ? def.color : 0x9a9a9a);
      }

      if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        if (sp > 0.01) p.mesh.lookAt(p.x + p.vx / sp, p.y + p.vy / sp, p.z + p.vz / sp);
        if (p.isGrenade) p.mesh.rotation.x += dt * 9;
        if (p.spin !== null && p.spin !== undefined) { p.spin += dt * 18; p.mesh.rotateX(p.spin * 0.05); }
      }

      if (p.life <= 0) {
        this._projectileHit(p, p.x, p.y, p.z, 0, 1, 0, null, null);
        this._removeProjectile(i);
      }
    }
  }

  _removeProjectile(i) {
    const p = this.projectiles[i];
    if (p.mesh) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.projectiles.splice(i, 1);
  }

  _projectileHit(p, x, y, z, ux, uy, uz, directActor, zone) {
    const def = p.def;
    if (directActor && !def.explode) {
      const head = zone === 'head';
      const w = p.weapon;
      const dmg = w.damage * (head ? w.headMult : 1) * (p.dmgMult || 1);
      const res = this.damageActor(directActor, p.owner, dmg, w.id, {
        x, y, z, dirx: ux, diry: uy, dirz: uz, head, strength: def.arrow ? 9 : 7,
      });
      if (this.effects) this.effects.blood(x, y, z, ux, uy, uz, head);
      this._bloodOnWorld(x, y, z, ux, uy, uz, dmg, head || (res && res.killed));
      audio.flesh({ x, y, z });
      if (p.owner && p.owner.isLocal) {
        this.hud.hitmarker(res && res.killed ? 'kill' : head ? 'head' : 'hit');
        audio.hitmarker(head, res && res.killed, Math.hypot(x - p.owner.pos.x, z - p.owner.pos.z));
        this._hitTint = 0.14;
      }
    }
    if (def.explode) {
      this.explode(x, y, z, def.explode, p.owner, p.weapon, directActor);
    } else if (this.effects) {
      this.effects.impact(x, y, z, -ux, -uy, -uz, def.color);
      if (!directActor && (def.knife || def.arrow)) audio.impact({ x, y, z }, true);
    }
  }

  /** ex: {radius, damage, minMult, force, selfMult}; cause: Waffen-Id fuer den Killfeed */
  explode(x, y, z, ex, owner, weapon, directActor, cause) {
    if (this.effects) this.effects.explosion(x, y, z, ex.radius * 0.55);
    audio.explosion({ x, y, z });
    this.muzzleLight.position.set(x, y + 0.5, z);
    this.muzzleLight.visible = true;
    this.muzzleLightT = 2.2;

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
      a.vel.x += ((cx - x) / l) * push;
      a.vel.y += ((cy - y) / l) * push + push * 0.35;
      a.vel.z += ((cz - z) / l) * push;
      a.grounded = false;
      a.coyote = 0;

      // Fass-Explosionen treffen auch Teamkollegen des Schuetzen (ohne Gutschrift)
      const attacker = isFriend ? null : owner;
      this.damageActor(a, attacker, dmg, cause || (weapon ? weapon.id : 'explosion'), {
        x: cx, y: cy, z: cz, dirx: (cx - x) / l, diry: (cy - y) / l, dirz: (cz - z) / l, head: false,
        strength: 8 + push * 0.6,
      });
    }

    // Kettenreaktion: Faesser und Kisten im Umkreis (leicht verzoegert)
    const near = this.world.destructiblesNear(x, y, z, ex.radius * 0.85, this._destrList);
    for (let i = 0; i < near.length; i++) {
      const c = near[i];
      if (this.pendingDestr.some(p => p.c === c)) continue;
      this.pendingDestr.push({ c, dmg: 250, t: 0.1 + rand(0, 0.2), owner });
    }

    if (this.player && this.player.alive) {
      const d = Math.hypot(this.player.pos.x - x, this.player.pos.y - y, this.player.pos.z - z);
      if (d < ex.radius * 3.5) this.player.addShake(clamp(1.4 - d / (ex.radius * 3.5), 0, 1) * 1.1);
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

    const before = victim.hp + victim.armor;
    const died = victim.applyDamage(amount);
    const actualDmg = before - Math.max(0, victim.hp) - Math.max(0, victim.armor);

    victim.lastDamageFrom = attacker;
    victim.lastDamageTime = this.time;
    victim.lastDamageCause = causeId;
    if (attacker && attacker !== victim) attacker.damageDealt += actualDmg;

    if (victim.model && !victim.isLocal) victim.model.flash(died ? 1.2 : clamp(0.35 + actualDmg / 60, 0.35, 0.9), died);

    if (attacker === this.player && victim !== this.player && hit && !hit.noPopup) {
      this.hud.popup(hit.x, hit.y, hit.z, Math.round(actualDmg),
        died ? 'kill' : hit.head ? 'head' : '');
    }
    if (victim === this.player) {
      this.hud.damageFlash(clamp(actualDmg / 55, 0.18, 0.75));
      this.player.addShake(clamp(actualDmg / 90, 0.05, 0.5));
      if (attacker && attacker !== victim) {
        const dx = attacker.pos.x - victim.pos.x;
        const dz = attacker.pos.z - victim.pos.z;
        const ang = Math.atan2(dx, -dz) - victim.yaw;
        this.hud.damageDir(-ang);
      }
    }
    if (victim.isBot && victim.hp > 0 && attacker && attacker !== victim) {
      if (!victim.target || Math.random() < 0.6) {
        victim.target = attacker;
        victim.targetSeenAt = this.time;
        victim.targetLastPos.x = attacker.pos.x;
        victim.targetLastPos.y = attacker.pos.y;
        victim.targetLastPos.z = attacker.pos.z;
      }
    }

    if (died) this.handleKill(victim, attacker, causeId, hit);
    return { killed: died, damage: actualDmg };
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
      // Koerper "explodiert": kein Ragdoll, sofort unsichtbar
      m.startDeath(info.hit.dirx, info.hit.dirz);
      m.deathT = 99;
      m.setVisible(false);
      return;
    }
    if (settings.ragdolls) m.startRagdoll(info.s, info.hit);
    else m.startDeath(info.hit.dirx, info.hit.dirz);
  }

  /** Ragdoll-Startdaten fuer das Modell */
  _ragdollInfo(victim, hit) {
    return {
      s: { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z, yaw: victim.yaw, vx: victim.vel.x, vy: victim.vel.y, vz: victim.vel.z },
      hit: { dirx: hit ? hit.dirx : 0, diry: hit ? hit.diry : 0.3, dirz: hit ? hit.dirz : 1, head: !!(hit && hit.head), strength: (hit && hit.strength) || 8 },
    };
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
    let killcam = false;
    if (victim.isLocal && !suicide && settings.killcam) killcam = this.startKillcam(attacker);
    victim.respawnTimer = victim.isLocal ? (killcam ? KILLCAM_LEN + 0.9 : 3.2) : rand(2.2, 4.5);
    const noRespawn = this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(victim);
    if (noRespawn) victim.respawnTimer = 99999;

    // Bot-Chat: Spieler getoetet / vom Spieler getoetet / Kopfschuss
    if (!suicide) {
      if (attacker.isBot && victim.isLocal) this.botChat(attacker, hit && hit.head ? 'headshot' : 'kill');
      else if (victim.isBot && attacker.isLocal) this.botChat(victim, 'killed');
      else if (attacker.isBot && attacker.streak === 5) this.botChat(attacker, 'streak');
    }

    // Kill-Effekt des Killers (Konfetti, Feuerwerk ...) am Opfer
    const fx = (!suicide && settings.killEffects !== false) ? KILL_EFFECT_BY_ID[attacker.killEffect] : null;
    const fxKind = fx && fx.id !== 'none' ? fx.id : null;
    const bodyColor = victim.model ? this._figureColors(victim).body : 0x4a86d9;

    if (victim.model) {
      const info = this._ragdollInfo(victim, hit);
      info.fx = fxKind; info.hideBody = !!(fx && fx.hideBody); info.bodyColor = bodyColor;
      if (killcam) this.killcam.pendingRagdoll = info;      // erst nach dem Replay umfallen
      else this._applyDeathVisual(victim, info);
    }
    audio.death({ x: victim.pos.x, y: victim.pos.y + 1.4, z: victim.pos.z });
    if (hit) this._bloodOnWorld(hit.x, hit.y, hit.z, hit.dirx, hit.diry, hit.dirz, 90, true);

    const w = WEAPONS[causeId];
    const wName = w ? w.short : causeId === 'fall' ? 'STURZ' : causeId === 'void' ? 'ABGRUND'
                 : causeId === 'melee' ? 'MELEE' : causeId === 'airstrike' ? 'LUFTSCHLAG'
                 : causeId === 'barrel' ? 'FASS' : 'EXPLOSION';
    const icon = !suicide && KILL_ICON_BY_ID[attacker.killIcon] ? KILL_ICON_BY_ID[attacker.killIcon].icon : '';

    let ggWin = false;
    if (!suicide) {
      attacker.kills++;
      attacker.streak++;
      attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
      attacker.score += 100 + (hit && hit.head ? 50 : 0) + (victim.carrying ? 50 : 0);
      if (this.teamMode && this.mode === 'tdm') this.scores[attacker.team]++;
      this._onStreak(attacker);
      if (this.modeCtl && this.modeCtl.id === 'gungame') ggWin = this.modeCtl.onKill(victim, attacker, causeId);
      else if (this.modeCtl && this.modeCtl.onKill) this.modeCtl.onKill(victim, attacker, causeId);

      if (attacker.isLocal) {
        this.hud.hitmarker('kill');
        audio.kill();
        const name = STREAK_NAMES[attacker.streak];
        if (name) this.hud.toast((icon ? icon + ' ' : '') + name);
        else if (hit && hit.head) this.hud.toast((icon ? icon + ' ' : '') + 'KOPFSCHUSS', true);
        else if (icon) this.hud.toast(icon + ' ELIMINIERT', true);
        this.hud.toast('+' + (100 + (hit && hit.head ? 50 : 0)) + ' Punkte', true);
      }
      if (victim.isLocal) {
        this._deathInfo = { name: attacker.name, weapon: w ? w.name : wName, hp: attacker.hp + attacker.armor };
      }
    } else {
      victim.score = Math.max(0, victim.score - 50);
      if (this.teamMode && this.mode === 'tdm') this.scores[victim.team] = Math.max(0, this.scores[victim.team] - 1);
      if (victim.isLocal) this._deathInfo = { name: null, weapon: wName, hp: null };
    }

    const isMe = victim.isLocal ? 'victim' : (attacker && attacker.isLocal ? 'killer' : null);
    this.hud.addKillfeed(
      suicide ? '' : attacker.name, suicide ? '' : attacker.team,
      victim.name, victim.team, wName, hit ? hit.head : false, isMe, suicide, icon
    );

    if (victim.isLocal) {
      this.hud.showDeath(this._deathInfo.name, this._deathInfo.weapon, this._deathInfo.hp, noRespawn ? Infinity : victim.respawnTimer);
      if (!killcam) { this.viewmodel.setHidden(true); this.hud.setScope(false); }
    }

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

  endMatch(winner) {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.endKillcam();
    this.viewmodel.setHidden(true);
    this.hud.setScope(false);
    this.input.exitLock();

    let won = false;
    if (!this.teamMode) {
      if (winner && typeof winner === 'object') {
        won = winner === this.player;
      } else {
        const sorted = this.actors.slice().sort((a, b) => (this.mode === 'gungame' ? b.ggLevel - a.ggLevel : 0) || b.kills - a.kills || b.score - a.score);
        won = sorted[0] === this.player;
        winner = sorted[0];
      }
    } else {
      won = winner === this.player.team;
    }
    if (won) audio.win(); else audio.lose();
    const talker = this.actors.find(a => a.isBot);
    if (talker) { this._chatGlobalT = -9; talker._chatT = -99; this.botChat(talker, won ? 'lose' : 'win'); }
    if (this.onMatchEnd) this.onMatchEnd(winner, won);
  }

  // --------------------------------------------------------
  // Killcam: Aufzeichnung + Wiedergabe
  // --------------------------------------------------------
  _recordHistory() {
    const h = this.hist;
    if (this.time - h.lastT < HIST_RATE) return;
    h.lastT = this.time;
    const f = h.frames[h.head] || (h.frames[h.head] = { t: 0, s: [] });
    f.t = this.time;
    const n = this.actors.length;
    for (let i = 0; i < n; i++) {
      const a = this.actors[i];
      const st = f.s[i] || (f.s[i] = {});
      st.x = a.pos.x; st.y = a.pos.y; st.z = a.pos.z;
      st.yaw = a.yaw; st.pitch = a.pitch;
      st.alive = a.alive; st.crouch = a.crouching || a.sliding;
      st.wid = a.weapon.id;
      st.shot = (this.time - (a.lastShotTime !== undefined ? a.lastShotTime : -9)) < HIST_RATE + 1e-4;
      st.speed = Math.hypot(a.vel.x, a.vel.z); st.grounded = a.grounded;
    }
    f.s.length = n;
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
      frames.push({ t: f.t, s: f.s.map(st => Object.assign({}, st)) });
    }
    if (frames.length < 6) return false;
    const killerIdx = this.actors.indexOf(killer);
    if (killerIdx < 0) return false;
    this.killcam = {
      killer, killerIdx, frames, t0: frames[0].t, t1, play: 0, fi: 0, lastFrame: -1,
      wid: null, cur: frames[0].s.map(st => Object.assign({}, st)), frozen: false, pendingRagdoll: null,
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
    for (let j = 0; j < kc.cur.length; j++) {
      const sa = a.s[j], sb = b.s[j] || sa, c = kc.cur[j];
      if (!sa) continue;
      c.x = lerp(sa.x, sb.x, k); c.y = lerp(sa.y, sb.y, k); c.z = lerp(sa.z, sb.z, k);
      c.yaw = angleLerp(sa.yaw, sb.yaw, k); c.pitch = lerp(sa.pitch, sb.pitch, k);
      c.alive = k < 0.5 ? sa.alive : sb.alive; c.crouch = sa.crouch; c.wid = sa.wid;
      c.speed = lerp(sa.speed, sb.speed, k); c.grounded = sa.grounded;
    }
    // Schuesse der uebersprungenen Frames abspielen
    const upto = frozen ? fr.length - 1 : i;
    for (let j = kc.lastFrame + 1; j <= upto; j++) {
      const f = fr[j];
      for (let n = 0; n < f.s.length; n++) {
        if (!f.s[n] || !f.s[n].shot) continue;
        const actor = this.actors[n];
        const w = WEAPONS[f.s[n].wid] || actor.weapon;
        if (n === kc.killerIdx) {
          this.viewmodel.fire(1);
          audio.shot(null, w.sound);
          this.muzzleLight.position.set(f.s[n].x, f.s[n].y + PHYS.EYE, f.s[n].z);
          this.muzzleLight.visible = true;
          this.muzzleLightT = 1;
        } else if (actor && actor.model && this.effects) {
          audio.shot({ x: f.s[n].x, y: f.s[n].y + 1.6, z: f.s[n].z }, w.sound);
          actor.model.getMuzzleWorld(this._v3);
          const cp = Math.cos(f.s[n].pitch);
          this.effects.muzzleFlash(this._v3.x, this._v3.y, this._v3.z, -Math.sin(f.s[n].yaw) * cp, Math.sin(f.s[n].pitch), -Math.cos(f.s[n].yaw) * cp, 0.7);
        }
      }
    }
    kc.lastFrame = upto;

    // Kamera aus den Augen des Killers
    const ks = kc.cur[kc.killerIdx];
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
  _recordReplay() {
    const r = this.rec;
    if (!r || this.time - r.lastT < r.rate) return;
    if (r.frames.length > 30000) return;             // ~25 Minuten
    r.lastT = this.time;
    const s = [];
    const wids = r.meta.weaponIds;
    for (const a of this.actors) {
      const flags = (a.alive ? 1 : 0) | ((a.crouching || a.sliding) ? 2 : 0) | (a.grounded ? 4 : 0) |
                    ((this.time - (a.lastShotTime !== undefined ? a.lastShotTime : -9)) < r.rate + 1e-4 ? 8 : 0) | (a.zip ? 16 : 0);
      s.push(Math.round(a.pos.x * 100) / 100, Math.round(a.pos.y * 100) / 100, Math.round(a.pos.z * 100) / 100,
        Math.round(a.yaw * 1000) / 1000, Math.round(a.pitch * 1000) / 1000, flags, Math.max(0, wids.indexOf(a.weapon.id)),
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
    this.replaying = true;
    this.mode = meta.mode || 'tdm';
    this.teamMode = !!(MODE_BY_ID[this.mode] && MODE_BY_ID[this.mode].team);
    const wx = applyWeather(buildMap(meta.map || 'sandstorm'), meta.weather || 'clear');
    this.weather = wx;
    this.world = new World(this.scene, wx.map, this.renderer);
    this.vmScene.environment = this.scene.environment;
    this.jumpPads = [];
    this._applyFog();
    this._setupLights(wx.map);
    this._setupWeather(wx);
    this._buildZiplines(wx.map);
    this.effects = new Effects(this.scene);
    this.effects.setRain(!!wx.rain);
    audio.rain(!!wx.rain);
    this.pickups = [];
    this.actors = [];
    for (const m of meta.actors) {
      const a = new Actor(this, { name: m.name, team: m.team, classId: m.classId });
      a.outfit = m.outfit; a.hat = m.hat; a.skin = m.skin; a.hair = m.hair;
      a.skins = m.skins || {}; a.stickers = m.stickers || {};
      a.alive = true;
      a.replayLocal = !!m.isLocal;
      a.model = this._makeModel(a);
      this.actors.push(a);
    }
    this.player = this.actors.find(a => a.replayLocal) || this.actors[0];
    this._applyTeamCss();
    const wids = meta.weaponIds || Object.keys(WEAPONS);
    const n = this.actors.length;
    const f0 = data.frames[0];
    const cur = [];
    for (let i = 0; i < n; i++) cur.push({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, alive: true, crouch: false, wid: 'ar', speed: 0, grounded: true, zip: false, shot: false });
    const px = f0[1 + 0 * 8], py = f0[2 + 0 * 8], pz = f0[3 + 0 * 8];
    const li = this.actors.indexOf(this.player);
    const lx = f0[1 + li * 8], ly = f0[2 + li * 8], lz = f0[3 + li * 8], lyaw = f0[4 + li * 8];
    this.replay = {
      data, wids, n, t: 0, total: data.frames[data.frames.length - 1][0] - f0[0], t0: f0[0],
      speed: 1, paused: false, fi: 0, lastFrame: -1, cur,
      cam: { x: lx + Math.sin(lyaw) * 6, y: ly + 4, z: lz + Math.cos(lyaw) * 6, yaw: lyaw, pitch: -0.3 },
    };
    void px; void py; void pz;
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
    const up = (input.down('KeyE') || input.down('Space') && false ? 1 : 0) - (input.down('KeyC') || input.down('ControlLeft') ? 1 : 0) + (input.down('KeyQ') ? 1 : 0);
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
      const c = r.cur[j];
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
    this._updateModels(r.paused ? 0.0001 : dt, r.cur, { hideIdx: -1, deadFromState: true });
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
    r.fi = 0;
    r.lastFrame = 1e9;   // keine Schuesse beim Springen
    // lastFrame wird beim naechsten Update korrekt gesetzt, wenn i >= 0
    const tr = r.t0 + r.t;
    let i = 0;
    while (i < r.data.frames.length - 2 && r.data.frames[i + 1][0] <= tr) i++;
    r.fi = i; r.lastFrame = i;
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
          p.mesh.visible = true;
          p.ring.visible = true;
          if (this.effects) this.effects.spawnFlash(p.x, p.y - 0.6, p.z, p.mesh.material.color.getHex());
        }
        continue;
      }
      p.mesh.rotation.y += dt * 1.6;
      p.mesh.rotation.x = Math.sin(this.time * 1.4) * 0.2;
      p.mesh.position.y = p.y + Math.sin(this.time * 2.2) * 0.18;
      p.ring.rotation.y -= dt * 0.8;
      p.ring.material.opacity = 0.24 + Math.sin(this.time * 3) * 0.1;

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
          if (s.reserve < s.w.reserve || a.nades < a.maxNades) { a.addAmmo(); used = true; }
        }
        if (used) {
          p.active = false;
          p.mesh.visible = false;
          p.ring.visible = false;
          p.respawn = 22;
          if (a.isLocal) {
            audio.tone(880, 0.09, 0.26, 'sine', null, 1320);
            this.hud.toast(p.type === 'health' ? '+40 LEBEN' : p.type === 'armor' ? '+50 RÜSTUNG' : 'MUNITION', true);
          } else {
            audio.tone(700, 0.06, 0.08, 'sine');
          }
          break;
        }
      }
    }
  }

  // --------------------------------------------------------
  // Audio-/Animations-Callbacks aus Actor
  // --------------------------------------------------------
  onJump(a) { audio.jump(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }); }
  onDoubleJump(a) {
    audio.click(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z }, 700, 0.22, 0.09);
    if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.5);
  }
  onLand(a, impact, surface) {
    if (impact < 4) return;
    audio.land(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, impact > 18, surface);
    if (this.effects && impact > 10) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, clamp(impact / 24, 0.2, 1.2));
    if (a.isLocal && impact > 16) a.addShake(clamp(impact / 60, 0, 0.5));
  }
  onFootstep(a, speed, surface) {
    const quiet = a.classDef && a.classDef.id === 'ninja';
    audio.step(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, (quiet ? 0.35 : 1) * clamp(speed / 11, 0.4, 1.2), surface);
    if (!a.isLocal && !quiet) a.lastLoudTime = this.time - 0.6;
  }
  onSlide(a) {
    audio.land(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, false, a.surface);
    if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.8);
  }
  onDash(a) {
    audio.dash(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
    if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.9);
    if (a.isLocal) { this.viewmodel.dash(); a.addShake(0.12); }
  }
  onWallrunStart(a) {
    audio.wallrun(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
  }
  onGrappleStart(a) {
    const pos = a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z };
    audio.grapple(pos, 'shoot');
    setTimeout(() => { if (this.running && a.grapple) audio.grapple(a.isLocal ? null : { x: a.grapple.x, y: a.grapple.y, z: a.grapple.z }, 'hit'); }, 90);
    if (a.isLocal) { this.viewmodel.dash(); a.addShake(0.08); }
  }
  onGrappleEnd(a) { audio.grapple(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, 'retract'); }
  onGrappleMiss(a) { audio.grapple(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, 'miss'); }
  onZipStart(a) { audio.zip(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 2, z: a.pos.z }, 'start'); if (a.isLocal) this._zipSoundT = 0; }
  onZipEnd(a) { audio.zip(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 2, z: a.pos.z }, 'end'); }
  onJumpPad(a) {
    audio.tone(420, 0.2, 0.3, 'sine', null, 1200);
    if (this.effects) this.effects.spawnFlash(a.pos.x, a.pos.y, a.pos.z, 0x2ee6a8);
  }
  onDryFire(a) { audio.click(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, 1600, 0.2, 0.04); }
  /** Minigun laeuft an / aus (k = 0..1) */
  onSpin(a, k, up) {
    const last = this._spinSoundT.get(a) || -1;
    if (this.time - last < 0.09) return;
    this._spinSoundT.set(a, this.time);
    audio.spin(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, k, up);
  }
  onChargeStart(a) { audio.bowDraw(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }); }
  onReloadStart(a) {
    if (a.isLocal) this.viewmodel.startReload(a.reloadTotal);
    const pos = a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z };
    audio.reloadStep(pos, 0);
    setTimeout(() => { if (this.running && a.alive && a.reloadTimer > 0) audio.reloadStep(pos, 2); }, a.reloadTotal * 400);
  }
  onReloadTick(a) {
    audio.reloadStep(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, 1);
    if (a.isLocal && a.reloadTimer > 0) this.viewmodel.startReload(a.reloadTotal);
  }
  onReloadEnd(a) { audio.reloadStep(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, 1); }
  onReloadCancel(a) { if (a.isLocal) this.viewmodel.cancelReload(); }
  onWeaponSwitch(a) {
    if (a.isLocal && !this.killcam) { this.viewmodel.setWeapon(a.weapon, a.skin, this.skinFor(a), this.stickerFor(a)); this.viewmodel.setHidden(false); }
    if (a.model && !this.killcam) a.model.setWeapon(a.weapon, this.skinFor(a), this.stickerFor(a));
    audio.draw(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, a.weapon.hold);
    if (a.isBot) a._updatePreferredRange();
  }

  // --------------------------------------------------------
  // Hauptschleife
  // --------------------------------------------------------
  readInput(dt) {
    if (!this.running || !this.world) return;
    this.player.handleInput(this.input, dt);
  }

  step(dt) {
    if (!this.running || !this.world) return;
    this.time += dt;

    const blocks = (a) => this.modeCtl && this.modeCtl.blocksRespawn && this.modeCtl.blocksRespawn(a);
    if (this.player.alive) {
      this.player.update(dt, this.world);
    } else if (!blocks(this.player)) {
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer <= 0) this.respawn(this.player);
    }

    for (const a of this.actors) {
      if (a === this.player) continue;
      if (a.alive) a.update(dt, this.world);
      else if (!blocks(a)) {
        a.respawnTimer -= dt;
        if (a.respawnTimer <= 0) this.respawn(a);
      }
    }

    this._updatePendingMelee(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this._updateBurning(dt);
    this._updatePendingDestr(dt);
    this._updateAirstrikes(dt);
    this._processInteractions();
    this._updateDrops(dt);
    this.world.updateDestructibles(dt, this.actors);
    this._recordHistory();
    this._recordReplay();

    if (this.training) {
      this.training.update(dt);
      return;
    }

    if (this.modeCtl && !this.over) this.modeCtl.update(dt);

    if (!this.over && !(this.modeCtl && this.modeCtl.ownsClock)) {
      this.timeLeft -= dt;
      const t = Math.ceil(this.timeLeft);
      if (t <= 5 && t > 0 && t !== this._lastCountdown) {
        this._lastCountdown = t;
        audio.countdown(t === 1);
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        if (!this.teamMode) this.endMatch(null);
        else this.endMatch(this.scores.red === this.scores.blue ? 'draw'
          : this.scores.red > this.scores.blue ? 'red' : 'blue');
      }
    }
  }

  postUpdate(dt) {
    if (!this.world) return;
    this.frameDt = dt;
    const p = this.player;

    if (this.killcam) {
      // Replay aus den Augen des Killers
      this._killcamUpdate(dt);
      const fov = settings.fov;
      if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = damp(this.camera.fov, fov, 22, dt); this.camera.updateProjectionMatrix(); }
      this.camera.updateMatrixWorld();
      this._updateModels(dt, this.killcam.cur, { hideIdx: this.killcam.killerIdx, frozen: this.killcam.frozen });
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
   * replay: Array interpolierter Zustaende (Killcam / Replay) oder null fuer Live.
   * ctx: { hideIdx, frozen, deadFromState }
   */
  _updateModels(dt, replay, ctx) {
    const camPos = this.camera.position;
    const cx = ctx || {};
    for (let i = 0; i < this.actors.length; i++) {
      const a = this.actors[i];
      if (!a.model) continue;
      const st = replay ? replay[i] : null;
      let hidden;
      if (st) {
        hidden = i === cx.hideIdx;
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

function makePropMaterialDrop() { return makePropMaterial({ envMapIntensity: 0.6 }); }

function falloff(w, dist) {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}
