// ============================================================
// Game: Renderer, Match-Logik, Kampfsystem, Projektile, Pickups
// ============================================================

import * as THREE from 'three';
import { World } from '../world/world.js';
import { buildMap } from '../world/mapdata.js';
import { Effects } from '../fx/effects.js';
import { LocalPlayer } from './player.js';
import { Bot } from './bot.js';
import { CharacterModel, MAT_VC } from './character.js';
import { ViewModel } from './viewmodel.js';
import { WEAPONS, CLASSES } from './weapons.js';
import { settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { clamp, lerp, rand, pick, makeBotNames, damp, deg } from '../core/utils.js';

const TEAM_COLOR = { red: 0xd94a4a, blue: 0x4a86d9 };
const TEAM_HEX = { red: '#ff6b6b', blue: '#7ab4ff' };
const SHADOW_SIZE = { off: 0, low: 1024, high: 2048, ultra: 4096 };
const SKINS = [0xe8c39e, 0xd2a071, 0xa9764c, 0x7a5433, 0xf0d0b0];

const STREAK_NAMES = {
  2: 'DOPPELKILL', 3: 'TRIPLE KILL', 4: 'QUAD KILL', 5: 'AMOKLAUF',
  7: 'UNAUFHALTSAM', 10: 'GOTTGLEICH', 15: 'LEGENDÄR', 20: 'UNSTERBLICH',
};

// Nahkampf: Strahlenfaecher (Yaw-/Pitch-Versatz) fuer die Trefferpruefung
const MELEE_RAYS = [
  [0, 0], [-0.18, 0], [0.18, 0], [-0.36, -0.05], [0.36, -0.05],
  [0, -0.22], [0, 0.18], [-0.2, -0.25], [0.2, -0.25],
];

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

    this._initRenderer();

    this.actors = [];
    this.projectiles = [];
    this.pickups = [];
    this.jumpPads = [];
    this.pendingMelee = [];
    this.scores = { red: 0, blue: 0 };

    this._v1 = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._v3 = new THREE.Vector3();
    this._v4 = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._dmgAcc = new Map();

    this.onMatchEnd = null;
  }

  // --------------------------------------------------------
  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: settings.antialias,
      powerPreference: 'high-performance',
      stencil: false,
      // Nur fuer automatisierte Tests: erlaubt das Auslesen des Bildinhalts
      preserveDrawingBuffer: location.search.indexOf('pixeltest') >= 0,
    });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // Statistik manuell zuruecksetzen: zwei render()-Aufrufe pro Bild
    // (Welt + Waffenansicht) sollen zusammen gezaehlt werden.
    this.renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.06, 900);
    this.camera.rotation.order = 'YXZ';

    // Eigene Szene fuer die Waffenansicht
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 12);
    const vmKey = new THREE.DirectionalLight(0xffffff, 1.5);
    vmKey.position.set(-0.6, 1.2, 0.8);
    const vmFill = new THREE.DirectionalLight(0x88aaff, 0.55);
    vmFill.position.set(0.9, -0.3, 0.5);
    this.vmScene.add(vmKey, vmFill, new THREE.AmbientLight(0xffffff, 0.55));

    this.viewmodel = new ViewModel(this.vmScene);

    this.applyGraphicsSettings();
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  /** Effektiver Pixelratio: Geraet x Einstellung x dynamische Skalierung */
  _pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    return clamp(dpr * clamp(settings.renderScale, 0.5, 2) * this.dynScale, 0.4, 4);
  }

  /** Dynamische Aufloesung (wird von der Hauptschleife anhand der FPS gesetzt) */
  setDynScale(s) {
    s = clamp(s, 0.5, 1);
    if (Math.abs(s - this.dynScale) < 0.01) return;
    this.dynScale = s;
    this.renderer.setPixelRatio(this._pixelRatio());
  }

  applyGraphicsSettings() {
    if (!settings.autoQuality) this.dynScale = 1;
    this.renderer.setPixelRatio(this._pixelRatio());

    const ss = SHADOW_SIZE[settings.shadows] || 0;
    const type = settings.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (this.renderer.shadowMap.type !== type) {
      this.renderer.shadowMap.type = type;
      MAT_VC.needsUpdate = true;
      if (this.world && this.world.meshSolid) this.world.meshSolid.material.needsUpdate = true;
    }
    this.renderer.shadowMap.enabled = ss > 0;
    if (this.sun) {
      this.sun.castShadow = ss > 0;
      if (ss > 0 && this.sun.shadow.mapSize.width !== ss) {
        this.sun.shadow.mapSize.set(ss, ss);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
    }
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
  // Match aufsetzen
  // --------------------------------------------------------
  start(cfg) {
    this.cleanup();

    this.mode = cfg.mode || 'tdm';
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

    // ---- Welt ----
    const mapDef = buildMap(cfg.map || 'sandstorm');
    this.world = new World(this.scene, mapDef);
    this.jumpPads = mapDef.jumpPads || [];
    this._applyFog();
    this._setupLights(mapDef);
    this.minimap.build(mapDef);

    this.effects = new Effects(this.scene);
    this.viewmodel.setFlashTexture(this.effects.flashTex);

    // ---- Pickups ----
    this.pickups = (mapDef.pickups || []).map((p) => this._makePickup(p));

    // ---- Spieler ----
    const localTeam = 'red';
    this.player = new LocalPlayer(this, {
      name: (cfg.name || 'Player').slice(0, 16) || 'Player',
      team: this.mode === 'ffa' ? 'ffa0' : localTeam,
      classId: cfg.classId || 'triggerman',
    });
    this.player.thirdPerson = settings.thirdPerson;
    this.player.model = this._makeModel(this.player);
    this.actors = [this.player];

    // ---- Bots ----
    const botCount = clamp(cfg.bots | 0, 1, 15);
    const names = makeBotNames(botCount);
    const classIds = CLASSES.map(c => c.id);
    for (let i = 0; i < botCount; i++) {
      let team;
      if (this.mode === 'ffa') team = 'ffa' + (i + 1);
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

    // Spawnen
    for (const a of this.actors) this.respawn(a, true);

    this.viewmodel.setWeapon(this.player.weapon, this.player.skin);
    // Kamera einmal setzen, damit Muendungspositionen ab dem ersten Frame stimmen
    this.player.applyCamera(this.camera, this.world, 0.016);
    this.camera.updateMatrixWorld();

    this.hud.clearFloating();
    this.hud.show(true);
    this.hud.hideDeath();
    this.hud.setMinimapVisible(settings.showMinimap);
    this.running = true;
    this.paused = false;

    this.hud.toast('MATCH GESTARTET', true);
  }

  _botDifficulty(i, n) {
    // Leichte Streuung um den gewaehlten Grad -> lebendigeres Match
    const base = this.difficulty;
    const r = Math.random();
    if (r < 0.2) return clamp(base - 1, 0, 3);
    if (r > 0.85) return clamp(base + 1, 0, 3);
    return base;
  }

  _setupLights(mapDef) {
    if (this.sun) { this.scene.remove(this.sun); this.scene.remove(this.sun.target); this.sun.dispose(); }
    if (this.hemi) { this.scene.remove(this.hemi); this.hemi.dispose(); }
    if (this.amb) { this.scene.remove(this.amb); this.amb.dispose(); }

    const d = mapDef.sunDir;
    this.sun = new THREE.DirectionalLight(mapDef.sunColor, mapDef.sunIntensity);
    this.sun.position.set(d[0] * 120, d[1] * 120, d[2] * 120);
    this.sun.target.position.set(0, 0, 0);

    const half = (mapDef.size || 120) * 0.62;
    const sc = this.sun.shadow.camera;
    sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
    sc.near = 10; sc.far = 320;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;

    this.hemi = new THREE.HemisphereLight(mapDef.ambTop, mapDef.ambBottom, mapDef.ambIntensity);
    this.amb = new THREE.AmbientLight(0xffffff, 0.16);

    this.scene.add(this.sun, this.sun.target, this.hemi, this.amb);
    this.applyGraphicsSettings();
  }

  _makeModel(actor) {
    const isTeam = this.mode !== 'ffa';
    const color = isTeam ? TEAM_COLOR[actor.team] : this._ffaColor(actor);
    actor.skin = pick(SKINS);
    const m = new CharacterModel(this.scene, {
      color,
      accent: isTeam ? (actor.team === 'red' ? 0xffb0b0 : 0xb0d0ff) : 0xffffff,
      pants: 0x2a3040,
      skin: actor.skin,
    });
    m.setWeapon(actor.weapon);
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
    const mat = new THREE.MeshLambertMaterial({
      color: colors[p.type], emissive: colors[p.type], emissiveIntensity: 0.45,
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
    this._dmgAcc.clear();
  }

  // --------------------------------------------------------
  // Hilfen fuer Actor-Callbacks
  // --------------------------------------------------------
  sameTeam(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (this.mode === 'ffa') return false;
    return a.team === b.team;
  }

  enemySpawnsFor(actor) {
    const m = this.world.map;
    if (this.mode === 'ffa') return m.spawnsFfa;
    return actor.team === 'red' ? m.spawnsBlue : m.spawnsRed;
  }

  autoReloadFor(actor) { return actor.isBot ? true : settings.autoReload; }

  // --------------------------------------------------------
  // Spawn / Respawn
  // --------------------------------------------------------
  spawnPointsFor(actor) {
    const m = this.world.map;
    if (this.mode === 'ffa') return m.spawnsFfa;
    const list = actor.team === 'red' ? m.spawnsRed : m.spawnsBlue;
    return list.length ? list : m.spawnsFfa;
  }

  respawn(actor, initial) {
    // Klassenwechsel aus dem Pausenmenue wird beim naechsten Spawn wirksam
    if (actor.isLocal && this.pendingClassId) {
      actor.setClass(this.pendingClassId);
      this.pendingClassId = null;
    }

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

    // Sicherheitsnetz: falls der Punkt in Geometrie liegt, in der Umgebung suchen
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
    if (actor.model) {
      actor.model.setWeapon(actor.weapon);
      actor.model.resetDeath();
      actor.model.setVisible(true);
    }
    if (this.effects) {
      const col = this.mode === 'ffa' ? this._ffaColor(actor) : TEAM_COLOR[actor.team];
      this.effects.spawnFlash(actor.pos.x, actor.pos.y, actor.pos.z, col);
    }
    if (actor.isLocal) {
      this.hud.hideDeath();
      this.viewmodel.setWeapon(actor.weapon, actor.skin);
      this.viewmodel.setHidden(false);
      if (!initial) { audio.tone(540, 0.09, 0.2, 'sine'); audio.draw(null, actor.weapon.hold); }
    }
  }

  // --------------------------------------------------------
  // Waffenwirkung
  // --------------------------------------------------------
  /** Weltposition der Muendung des Akteurs */
  muzzleWorld(actor, out) {
    if (actor.isLocal && !actor.thirdPerson && !settings.thirdPerson) {
      // Aus dem AKTUELLEN Spielerzustand aufbauen statt aus der Kameramatrix:
      // die wird erst nach der Simulation aktualisiert und haengt sonst
      // ein Bild hinterher.
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

  fireWeapon(actor, heavy) {
    const w = actor.weapon;
    actor.lastLoudTime = this.time;

    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);

    // Muendung
    this.muzzleWorld(actor, this._muzzle);

    // Audio
    const soundPos = actor.isLocal ? null : { x: actor.pos.x, y: actor.pos.y + 1.6, z: actor.pos.z };
    if (w.melee) {
      const h = heavy && w.heavy ? w.heavy : null;
      const def = h ? Object.assign({ id: w.id, headMult: w.headMult, knockback: w.knockback }, h) : w;
      const swingTime = def.swingTime || 0.32;
      audio.swing(soundPos, w.hold, !!h);
      // Treffer landet passend zur Schwunganimation verzoegert
      const delay = swingTime * (h ? (h.hitAt || 0.45) : 0.3);
      this.pendingMelee.push({ actor, w: def, t: delay, kind: w.hold, heavy: !!h });
      // Ausfallschritt zum Gegner, wenn einer in Reichweite steht
      const lunge = h ? h.lunge : w.lunge;
      if (lunge) this._meleeLunge(actor, (def.meleeRange || 3.4) * 1.8, lunge);
      if (actor.isLocal) this.viewmodel.melee(h ? h.swing : null, swingTime);
      if (actor.model) actor.model.triggerSwing(swingTime, h ? h.swing : w.swing);
      return;
    }

    audio.shot(soundPos, w.sound);

    if (actor.isLocal) {
      this.viewmodel.fire(1);
      actor.addRecoil(
        deg(w.recoilV) * rand(0.75, 1.15),
        deg(w.recoilH) * rand(-1, 1)
      );
      actor.addShake(w.kick * 1.6);
      // Huelse auswerfen
      if (!w.projectile && this.effects) {
        const right = this._v3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        this.effects.shell(
          this._muzzle.x - dir.x * 0.9 + right.x * 0.12,
          this._muzzle.y - dir.y * 0.9 + 0.05,
          this._muzzle.z - dir.z * 0.9 + right.z * 0.12,
          right.x * rand(2, 4) + actor.vel.x, rand(2, 4) + actor.vel.y, right.z * rand(2, 4) + actor.vel.z
        );
      }
    } else {
      if (actor.model) actor.model.triggerRecoil(0.8);
      if (this.effects) {
        this.effects.muzzleFlash(this._muzzle.x, this._muzzle.y, this._muzzle.z, dir.x, dir.y, dir.z, 0.7);
      }
    }

    // Projektilwaffen
    if (w.projectile) {
      this.spawnProjectile(actor, w, this._muzzle, dir, w.projectile);
      return;
    }

    // Hitscan
    const spread = actor.currentSpread();
    const pellets = w.pellets || 1;
    let anyHit = false, anyKill = false, anyHead = false;
    const acc = this._dmgAcc;
    acc.clear();

    for (let i = 0; i < pellets; i++) {
      const d = this._spreadDir(dir, spread, this._v3);
      const r = this._hitscan(actor, eye, d, w, acc);
      if (r.actorHit) { anyHit = true; if (r.head) anyHead = true; if (r.killed) anyKill = true; }
      // Tracer nur fuer einen Teil der Schrotkugeln
      if (this.effects && (pellets === 1 || i % 2 === 0)) {
        this.effects.tracer(
          this._muzzle.x, this._muzzle.y, this._muzzle.z,
          r.x, r.y, r.z, w.tracer, w.tracerWidth
        );
      }
    }

    // Schadenszahlen: pro Ziel EINE Zahl (statt neun bei der Schrotflinte)
    if (actor.isLocal) {
      acc.forEach((v) => {
        if (v.dmg > 0) this.hud.popup(v.x, v.y, v.z, Math.round(v.dmg), v.killed ? 'kill' : v.head ? 'head' : '');
      });
      if (anyHit) {
        this.hud.hitmarker(anyKill ? 'kill' : anyHead ? 'head' : 'hit');
        audio.hitmarker(anyHead);
      }
    }
    acc.clear();
  }

  /** Richtung mit Kegel-Streuung */
  _spreadDir(dir, spread, out) {
    out.copy(dir);
    if (spread > 0.00001) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      // Orthonormalbasis
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
   * Einzelner Hitscan-Strahl.
   * @returns {x,y,z, actorHit, head, killed}
   */
  _hitscan(shooter, eye, dir, w, acc) {
    let remaining = w.pierce || 0;
    let ox = eye.x, oy = eye.y, oz = eye.z;
    let maxDist = w.range;
    let travelled = 0;
    const ignored = shooter._pierceIgnore || (shooter._pierceIgnore = new Set());
    ignored.clear();
    ignored.add(shooter);

    const out = this._hsOut || (this._hsOut = { x: 0, y: 0, z: 0, actorHit: false, head: false, killed: false });
    out.actorHit = false; out.head = false; out.killed = false;

    for (let pass = 0; pass <= remaining; pass++) {
      const wallHit = this.world.raycast(ox, oy, oz, dir.x, dir.y, dir.z, maxDist);
      const wallT = wallHit ? wallHit.t : maxDist;

      // Naechster Akteur im Strahl (orientierte Trefferzonen)
      let bestT = wallT, bestActor = null, bestZone = null;
      for (const a of this.actors) {
        if (!a.alive || ignored.has(a)) continue;
        if (this.sameTeam(a, shooter)) continue;
        if (a.spawnProtect > 0) continue;
        const h = a.rayHit(ox, oy, oz, dir.x, dir.y, dir.z, bestT, 0);
        if (h && h.t >= 0 && h.t < bestT) { bestT = h.t; bestActor = a; bestZone = h.zone; }
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
        if (head) out.head = true;
        if (res && res.killed) out.killed = true;
        if (acc && res) {
          let e = acc.get(bestActor);
          if (!e) { e = { dmg: 0, x: hx, y: hy, z: hz, head: false, killed: false }; acc.set(bestActor, e); }
          e.dmg += res.damage;
          if (head) e.head = true;
          if (res.killed) e.killed = true;
        }

        if (this.effects) this.effects.blood(hx, hy, hz, dir.x, dir.y, dir.z, head);
        audio.flesh({ x: hx, y: hy, z: hz });

        ignored.add(bestActor);
        // Weiter durchschlagen
        travelled += bestT + 0.05;
        maxDist -= bestT + 0.05;
        ox = hx + dir.x * 0.05; oy = hy + dir.y * 0.05; oz = hz + dir.z * 0.05;
        if (maxDist <= 0.1) break;
        continue;
      }

      // Wand getroffen
      if (wallHit) {
        out.x = wallHit.x; out.y = wallHit.y; out.z = wallHit.z;
        if (this.effects) this.effects.impact(wallHit.x, wallHit.y, wallHit.z, wallHit.nx, wallHit.ny, wallHit.nz);
        audio.impact({ x: wallHit.x, y: wallHit.y, z: wallHit.z });
        // Vorbeiflug-Geraeusch fuer den lokalen Spieler
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

  /** Kugel fliegt nah am lokalen Spieler vorbei? */
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
  /** Kurzer Vorstoss Richtung naechstem Gegner im Blickkegel */
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
    // Nicht ueber das Ziel hinausschiessen
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

    // Strahlenfaecher gegen die Trefferzonen (mit "dicken" Strahlen)
    const cp0 = Math.cos(actor.pitch);
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
    // Sehr nah dran (z.B. Gegner "im Gesicht"): grosszuegiger Naehe-Test
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
    void cp0;

    if (hit) {
      const dir = actor.lookDir(this._v2);
      // Rueckenangriff: Angreifer schaut in dieselbe Richtung wie das Opfer
      const fx = -Math.sin(hit.yaw), fz = -Math.cos(hit.yaw);
      const facing = fx * dir.x + fz * dir.z;
      const back = facing > 0.45;
      const head = bestZone === 'head';
      let dmg = w.damage * (back ? (w.meleeBackstab || 1) : 1);
      if (head && !back) dmg *= (w.headMult || 1);
      const res = this.damageActor(hit, actor, dmg, w.id, {
        x: hx.x, y: hx.y, z: hx.z,
        dirx: dir.x, diry: dir.y, dirz: dir.z, head,
      });
      // Wucht: Opfer wird weggestossen
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
      audio.meleeHit(actor.isLocal ? null : { x: hx.x, y: hx.y, z: hx.z }, kind, heavy);
      if (actor.isLocal) {
        this.hud.hitmarker(res && res.killed ? 'kill' : (back || head) ? 'head' : 'hit');
        audio.hitmarker(back || head);
        actor.addShake(heavy ? 0.5 : 0.25);
        this.viewmodel.hitKick(heavy);
      }
    }
  }

  /** Schneller Nahkampfschlag mit F, ohne Waffenwechsel */
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
  spawnProjectile(actor, weapon, origin, dir, def) {
    if (!this._projGeo) this._projGeo = new Map();
    let geo = this._projGeo.get(weapon.id);
    if (!geo) {
      geo = new THREE.BoxGeometry(def.radius * 2, def.radius * 2, def.radius * 3);
      this._projGeo.set(weapon.id, geo);
    }
    const mat = new THREE.MeshBasicMaterial({ color: def.color, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    this.scene.add(mesh);

    const spread = actor.currentSpread();
    const d = this._spreadDir(dir, spread, this._v4);

    this.projectiles.push({
      x: origin.x, y: origin.y, z: origin.z,
      vx: d.x * def.speed + actor.vel.x * 0.25,
      vy: d.y * def.speed + actor.vel.y * 0.25,
      vz: d.z * def.speed + actor.vel.z * 0.25,
      def, weapon, owner: actor, mesh,
      life: def.fuse !== undefined ? def.fuse : 6,
      trailT: 0,
      isGrenade: def.fuse !== undefined,
    });
  }

  throwGrenade(actor) {
    const w = WEAPONS.grenade;
    const eye = actor.eyePos(this._v1);
    const dir = actor.lookDir(this._v2);
    const origin = this._v3.set(
      eye.x + dir.x * 0.7, eye.y + dir.y * 0.7 + 0.1, eye.z + dir.z * 0.7
    );
    // Leichter Bogen nach oben
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

          // Akteure treffen
          let hitActor = null, hitT = len, hitZone = null;
          for (const a of this.actors) {
            if (a === p.owner || !a.alive) continue;
            if (this.sameTeam(a, p.owner) && !p.isGrenade) continue;
            if (a.spawnProtect > 0) continue;
            const h = a.rayHit(p.x, p.y, p.z, ux, uy, uz, hitT, def.radius);
            if (h && h.t >= 0 && h.t < hitT) { hitT = h.t; hitActor = a; hitZone = h.zone; }
          }

          const wall = this.world.raycast(p.x, p.y, p.z, ux, uy, uz, len);

          if (hitActor && (!wall || hitT < wall.t)) {
            const hx = p.x + ux * hitT, hy = p.y + uy * hitT, hz = p.z + uz * hitT;
            if (p.isGrenade) {
              // Granate prallt an Spielern ab
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
            if (def.bounce) {
              // Reflektieren
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

      // Rauchspur
      p.trailT -= dt;
      if (p.trailT <= 0 && this.effects) {
        p.trailT = 0.016;
        this.effects.trail(p.x, p.y, p.z, def.glow ? def.color : 0x9a9a9a);
      }

      if (p.mesh) {
        p.mesh.position.set(p.x, p.y, p.z);
        const sp = Math.hypot(p.vx, p.vy, p.vz);
        if (sp > 0.01) {
          p.mesh.lookAt(p.x + p.vx / sp, p.y + p.vy / sp, p.z + p.vz / sp);
        }
        if (p.isGrenade) p.mesh.rotation.x += dt * 9;
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
    // Direkter Treffer
    if (directActor && !def.explode) {
      const head = zone === 'head';
      const w = p.weapon;
      this.damageActor(directActor, p.owner, w.damage * (head ? w.headMult : 1), w.id, {
        x, y, z, dirx: ux, diry: uy, dirz: uz, head,
      });
    }
    if (def.explode) {
      this.explode(x, y, z, def.explode, p.owner, p.weapon, directActor);
    } else if (this.effects) {
      this.effects.impact(x, y, z, -ux, -uy, -uz, def.color);
    }
  }

  explode(x, y, z, ex, owner, weapon, directActor) {
    if (this.effects) this.effects.explosion(x, y, z, ex.radius * 0.55);
    audio.explosion({ x, y, z });

    for (const a of this.actors) {
      if (!a.alive) continue;
      if (a.spawnProtect > 0 && a !== owner) continue;
      const cx = a.pos.x, cy = a.pos.y + a.height * 0.5, cz = a.pos.z;
      const dist = Math.hypot(cx - x, cy - y, cz - z);
      if (dist > ex.radius) continue;
      // Sichtlinie (Waende schuetzen)
      if (dist > 1.2 && !this.world.losClear(x, y, z, cx, cy, cz)) continue;

      const isSelf = a === owner;
      const isFriend = this.sameTeam(a, owner) && !isSelf;
      if (isFriend) continue;

      const f = clamp(1 - dist / ex.radius, 0, 1);
      let dmg = ex.damage * lerp(ex.minMult, 1, f * f);
      if (directActor === a) dmg = Math.max(dmg, ex.damage * 0.85);
      if (isSelf) dmg *= ex.selfMult;

      // Rueckstoss
      const l = Math.max(0.6, dist);
      const push = ex.force * f * (isSelf ? 1.5 : 1);
      a.vel.x += ((cx - x) / l) * push;
      a.vel.y += ((cy - y) / l) * push + push * 0.35;
      a.vel.z += ((cz - z) / l) * push;
      a.grounded = false;
      a.coyote = 0;

      this.damageActor(a, owner, dmg, weapon ? weapon.id : 'explosion', {
        x: cx, y: cy, z: cz, dirx: (cx - x) / l, diry: (cy - y) / l, dirz: (cz - z) / l, head: false,
      });
    }

    // Screenshake
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

    // ---- Feedback fuer den lokalen Spieler ----
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
      // Getroffener Bot dreht sich zum Angreifer
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

  handleKill(victim, attacker, causeId, hit) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.streak = 0;
    victim.respawnTimer = victim.isLocal ? 3.2 : rand(2.2, 4.5);
    victim.intent.fire = false;
    victim.sliding = false;
    if (victim.onDeath) victim.onDeath(attacker);

    if (victim.model) victim.model.startDeath(hit ? hit.dirx : 0, hit ? hit.dirz : 1);
    audio.death({ x: victim.pos.x, y: victim.pos.y + 1.4, z: victim.pos.z });

    const w = WEAPONS[causeId];
    const wName = w ? w.short : causeId === 'fall' ? 'STURZ' : causeId === 'void' ? 'ABGRUND'
                 : causeId === 'melee' ? 'MELEE' : 'EXPLOSION';
    const suicide = !attacker || attacker === victim;

    if (!suicide) {
      attacker.kills++;
      attacker.streak++;
      attacker.bestStreak = Math.max(attacker.bestStreak, attacker.streak);
      attacker.score += 100 + (hit && hit.head ? 50 : 0);
      if (this.mode !== 'ffa') this.scores[attacker.team]++;

      if (attacker.isLocal) {
        this.hud.hitmarker('kill');
        audio.kill();
        const name = STREAK_NAMES[attacker.streak];
        if (name) this.hud.toast(name);
        else if (hit && hit.head) this.hud.toast('KOPFSCHUSS', true);
        this.hud.toast('+' + (100 + (hit && hit.head ? 50 : 0)) + ' Punkte', true);
      }
      if (victim.isLocal) {
        // Killer-Info fuer den Todesbildschirm
        this._deathInfo = { name: attacker.name, weapon: w ? w.name : wName, hp: attacker.hp + attacker.armor };
      }
    } else {
      victim.score = Math.max(0, victim.score - 50);
      if (this.mode !== 'ffa') this.scores[victim.team] = Math.max(0, this.scores[victim.team] - 1);
      if (victim.isLocal) this._deathInfo = { name: null, weapon: wName, hp: null };
    }

    const isMe = victim.isLocal ? 'victim' : (attacker && attacker.isLocal ? 'killer' : null);
    this.hud.addKillfeed(
      suicide ? '' : attacker.name, suicide ? '' : attacker.team,
      victim.name, victim.team, wName, hit ? hit.head : false, isMe, suicide
    );

    if (victim.isLocal) {
      this.hud.showDeath(this._deathInfo.name, this._deathInfo.weapon, this._deathInfo.hp, victim.respawnTimer);
      this.viewmodel.setHidden(true);
      this.hud.setScope(false);
    }

    this._checkMatchEnd();
  }

  _checkMatchEnd() {
    if (this.over) return;
    if (this.mode === 'ffa') {
      for (const a of this.actors) {
        if (a.kills >= this.scoreLimit) { this.endMatch(a); return; }
      }
    } else {
      if (this.scores.red >= this.scoreLimit) { this.endMatch('red'); return; }
      if (this.scores.blue >= this.scoreLimit) { this.endMatch('blue'); return; }
    }
  }

  endMatch(winner) {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.viewmodel.setHidden(true);
    this.hud.setScope(false);
    this.input.exitLock();

    let won = false;
    if (this.mode === 'ffa') {
      const sorted = this.actors.slice().sort((a, b) => b.kills - a.kills || b.score - a.score);
      won = sorted[0] === this.player;
      winner = sorted[0];
    } else {
      won = winner === this.player.team;
    }
    if (won) audio.win(); else audio.lose();
    if (this.onMatchEnd) this.onMatchEnd(winner, won);
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
  onLand(a, impact) {
    if (impact < 4) return;
    audio.land(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, impact > 18);
    if (this.effects && impact > 10) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, clamp(impact / 24, 0.2, 1.2));
    if (a.isLocal && impact > 16) a.addShake(clamp(impact / 60, 0, 0.5));
  }
  onFootstep(a, speed) {
    const quiet = a.classDef && a.classDef.id === 'ninja';
    audio.step(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, (quiet ? 0.35 : 1) * clamp(speed / 11, 0.4, 1.2));
    if (!a.isLocal && !quiet) a.lastLoudTime = this.time - 0.6;
  }
  onSlide(a) {
    audio.land(a.isLocal ? null : { x: a.pos.x, y: a.pos.y, z: a.pos.z }, false);
    if (this.effects) this.effects.dust(a.pos.x, a.pos.y, a.pos.z, 0.8);
  }
  onJumpPad(a) {
    audio.tone(420, 0.2, 0.3, 'sine', null, 1200);
    if (this.effects) this.effects.spawnFlash(a.pos.x, a.pos.y, a.pos.z, 0x2ee6a8);
  }
  onDryFire(a) { audio.click(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.5, z: a.pos.z }, 1600, 0.2, 0.04); }
  onReloadStart(a) {
    if (a.isLocal) this.viewmodel.startReload(a.reloadTotal);
    const pos = a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z };
    audio.reloadStep(pos, 0);
    const tok = this.time;
    setTimeout(() => { if (this.running && a.alive && a.reloadTimer > 0) audio.reloadStep(pos, 2); }, a.reloadTotal * 400);
    void tok;
  }
  onReloadTick(a) {
    audio.reloadStep(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, 1);
    if (a.isLocal && a.reloadTimer > 0) this.viewmodel.startReload(a.reloadTotal);
  }
  onReloadEnd(a) { audio.reloadStep(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, 1); }
  onReloadCancel(a) { if (a.isLocal) this.viewmodel.cancelReload(); }
  onWeaponSwitch(a) {
    if (a.isLocal) { this.viewmodel.setWeapon(a.weapon, a.skin); this.viewmodel.setHidden(false); }
    if (a.model) a.model.setWeapon(a.weapon);
    audio.draw(a.isLocal ? null : { x: a.pos.x, y: a.pos.y + 1.4, z: a.pos.z }, a.weapon.hold);
    if (a.isBot) a._updatePreferredRange();
  }

  // --------------------------------------------------------
  // Hauptschleife
  // Aufteilung: readInput (1x/Frame) -> step (n Teilschritte) -> postUpdate (1x)
  // Damit wird die Maus-Bewegung nicht mehrfach angewendet.
  // --------------------------------------------------------
  readInput(dt) {
    if (!this.running || !this.world) return;
    this.player.handleInput(this.input, dt);
  }

  step(dt) {
    if (!this.running || !this.world) return;
    this.time += dt;

    // ---- Lokaler Spieler ----
    if (this.player.alive) {
      this.player.update(dt, this.world);
    } else {
      this.player.respawnTimer -= dt;
      if (this.player.respawnTimer <= 0) this.respawn(this.player);
    }

    // ---- Bots ----
    for (const a of this.actors) {
      if (a === this.player) continue;
      if (a.alive) a.update(dt, this.world);
      else {
        a.respawnTimer -= dt;
        if (a.respawnTimer <= 0) this.respawn(a);
      }
    }

    this._updatePendingMelee(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);

    // ---- Match-Zeit ----
    if (!this.over) {
      this.timeLeft -= dt;
      const t = Math.ceil(this.timeLeft);
      if (t <= 5 && t > 0 && t !== this._lastCountdown) {
        this._lastCountdown = t;
        audio.countdown(t === 1);
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        if (this.mode === 'ffa') this.endMatch(null);
        else this.endMatch(this.scores.red === this.scores.blue ? 'draw'
          : this.scores.red > this.scores.blue ? 'red' : 'blue');
      }
    }
  }

  postUpdate(dt) {
    if (!this.world) return;

    // ---- Kamera ----
    this.player.applyCamera(this.camera, this.world, dt);
    const fov = this.player.alive ? this.player.targetFov() : settings.fov;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = damp(this.camera.fov, fov, 22, dt);
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();

    // ---- Modelle ----
    this._updateModels(dt);

    // ---- Viewmodel ----
    const p = this.player;
    const w = p.weapon;
    const scoped = w.scope && p.adsAmount > 0.72 && p.alive;
    this.viewmodel.setHidden(!p.alive || scoped || (p.thirdPerson || settings.thirdPerson));
    this.hud.setScope(scoped);
    if (!this.viewmodel.hidden) {
      this.viewmodel.update(dt, {
        adsTarget: p.ads,
        moveSpeed: Math.hypot(p.vel.x, p.vel.z),
        grounded: p.grounded,
        sprint: p.sprinting,
        slide: p.sliding,
        crouch: p.crouching,
        firing: p.intent.fire,
        lookDX: p.lookDX,
        lookDY: p.lookDY,
        velY: p.vel.y,
        landImpact: p.landImpact > 0.35 ? p.landImpact * 0.4 : 0,
      });
    }

    // ---- Effekte ----
    if (this.effects) this.effects.update(dt, this.camera);

    // ---- Schatten folgen dem Spieler ----
    if (this.sun && this.sun.castShadow) {
      const d = this.world.map.sunDir;
      this.sun.position.set(
        p.pos.x + d[0] * 110,
        p.pos.y + d[1] * 110,
        p.pos.z + d[2] * 110
      );
      this.sun.target.position.set(p.pos.x, p.pos.y, p.pos.z);
      this.sun.target.updateMatrixWorld();
    }

    // ---- Audio-Listener ----
    const fwd = this._v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = this._v2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    audio.setListener(this.camera.position, fwd, right);

    // ---- HUD ----
    this._updateHud(dt);
  }

  _updateModels(dt) {
    const camPos = this.camera.position;
    for (const a of this.actors) {
      if (!a.model) continue;
      // In der Egoperspektive wird das eigene Modell ausgeblendet,
      // nach dem Tod aber wieder gezeigt (Leiche).
      const firstPerson = a.isLocal && !(a.thirdPerson || settings.thirdPerson) && a.alive;
      const faded = !a.alive && a.model.deathT > 4.2;
      if (firstPerson || faded) { a.model.setVisible(false); continue; }
      a.model.setVisible(true);

      a.model.update(dt, {
        x: a.pos.x, y: a.pos.y, z: a.pos.z,
        yaw: a.yaw, pitch: a.pitch,
        speed: Math.hypot(a.vel.x, a.vel.z),
        grounded: a.grounded,
        crouch: a.crouching || a.sliding,
        slide: a.sliding,
        dead: !a.alive,
        name: a.name,
        hp: a.hp, maxHp: a.maxHp,
        enemy: !this.sameTeam(a, this.player),
        tagColor: this.mode === 'ffa'
          ? '#ffffff'
          : (a.team === 'red' ? TEAM_HEX.red : TEAM_HEX.blue),
        showTag: !a.isLocal && a.alive,
      }, camPos);
    }
  }

  _updateHud(dt) {
    const p = this.player;
    this.hud.updateStatus(p, dt);
    this.hud.updateWeapon(p);
    this.hud.updateStats(p);
    this.hud.updateMatch(this.mode, this.scores.red, this.scores.blue, this.timeLeft);
    if (!p.alive) this.hud.updateDeathTimer(p.respawnTimer);

    // Fadenkreuz: Streuung in Pixel
    const spread = p.currentSpread();
    const px = settings.dynCross
      ? Math.tan(spread) / Math.tan(deg(this.camera.fov) / 2) * (window.innerHeight / 2)
      : 0;
    const scoped = p.weapon.scope && p.adsAmount > 0.72;
    this.hud.updateCrosshair(clamp(px, 0, 90), !p.alive || scoped, false);

    this.hud.updateFloating(dt, this.camera);

    if (settings.showMinimap) {
      this.minimap.draw(
        { x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, actor: p, pickups: this.pickups },
        this.actors, (a, b) => this.sameTeam(a, b), this.time
      );
    }
  }

  render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    r.render(this.scene, this.camera);
    if (!this.viewmodel.hidden) {
      r.clearDepth();
      r.render(this.vmScene, this.vmCamera);
    }
  }
}

// ------------------------------------------------------------
// Hilfsfunktionen
// ------------------------------------------------------------
function falloff(w, dist) {
  if (dist <= w.falloffStart) return 1;
  if (dist >= w.falloffEnd) return w.falloffMin;
  const t = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
  return 1 + (w.falloffMin - 1) * t;
}
