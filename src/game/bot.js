// ============================================================
// Bot-KI: Wahrnehmung mit Blickfeld und Reaktionszeit, menschliches
// Zielen (Einschwingen, begrenzte Drehgeschwindigkeit, Nachziehfehler,
// Rueckstoss), Pfadfindung, Deckung suchen, Granaten, Klassentaktik,
// Missionsziele (CTF, Hardpoint) und Killstreaks.
//
// Warum kein "Aimbot": Der Bot zielt nicht auf die exakte Position,
// sondern auf einen Punkt, der (a) dem Ziel hinterherlaeuft (Nachzieh-
// verzoegerung), (b) nach jedem Neuerfassen erst einschwingen muss,
// (c) mit einem langsam wandernden Fehler belegt ist, der mit
// Entfernung, Zieltempo und eigenem Tempo waechst, und (d) durch den
// Rueckstoss der eigenen Waffe nach oben getrieben wird.
// ============================================================

import { Actor } from './actor.js';
import { WEAPONS, CLASS_BY_ID, randomAttachments } from './weapons.js';
import { randomSkinId } from './skins.js';
import { randomStickerId } from './stickers.js';
import { randomOutfitId, randomHatId, randomKillEffectId, randomKillIconId } from './cosmetics.js';
import { clamp, rand, randSign, angleDelta, pick, gauss } from '../core/utils.js';

export const DIFFICULTY = [
  {
    name: 'Einfach', react: 0.75, turnRate: 3.2, aimK: 6, aimD: 4.5, settle: 1.1, drift: 0.075, lag: 0.28,
    hsChance: 0.03, fireAngle: 0.10, strafeSkill: 0.3, burst: [2, 5], pause: [0.35, 1.0], recoilComp: 0.35,
    memory: 1.6, jumpiness: 0.08, nadeChance: 0.06, hearRange: 20, sightRange: 85, fov: 1.05, reloadSmart: 0.3, cover: 0.3,
  },
  {
    name: 'Normal', react: 0.45, turnRate: 5.0, aimK: 10, aimD: 5.5, settle: 0.8, drift: 0.045, lag: 0.19,
    hsChance: 0.09, fireAngle: 0.075, strafeSkill: 0.55, burst: [3, 7], pause: [0.2, 0.6], recoilComp: 0.55,
    memory: 2.6, jumpiness: 0.2, nadeChance: 0.12, hearRange: 28, sightRange: 110, fov: 1.2, reloadSmart: 0.6, cover: 0.55,
  },
  {
    name: 'Schwer', react: 0.28, turnRate: 7.5, aimK: 15, aimD: 6.5, settle: 0.55, drift: 0.028, lag: 0.12,
    hsChance: 0.18, fireAngle: 0.06, strafeSkill: 0.8, burst: [4, 9], pause: [0.12, 0.4], recoilComp: 0.75,
    memory: 3.6, jumpiness: 0.4, nadeChance: 0.18, hearRange: 36, sightRange: 135, fov: 1.35, reloadSmart: 0.85, cover: 0.75,
  },
  {
    name: 'Albtraum', react: 0.16, turnRate: 11, aimK: 22, aimD: 8, settle: 0.35, drift: 0.016, lag: 0.07,
    hsChance: 0.3, fireAngle: 0.05, strafeSkill: 1.0, burst: [6, 14], pause: [0.06, 0.25], recoilComp: 0.88,
    memory: 5.0, jumpiness: 0.55, nadeChance: 0.25, hearRange: 44, sightRange: 165, fov: 1.5, reloadSmart: 1.0, cover: 0.9,
  },
];

const STATE = { WANDER: 0, HUNT: 1, FIGHT: 2, RETREAT: 3, COVER: 4, OBJECTIVE: 5 };
const STATE_NAME = ['wander', 'hunt', 'fight', 'retreat', 'cover', 'objective'];

// Persoenlichkeiten: veraendern Wunschdistanz, Deckung, Dash, Strafen, Streifzuege
export const PERSONAS = {
  rusher:  { name: 'Rusher',  dist: 0.6, cover: 0.4, dash: 2.2, strafe: 1.0, camp: 0,  desc: 'draengt nach vorn, sucht kaum Deckung' },
  camper:  { name: 'Camper',  dist: 1.5, cover: 1.4, dash: 0.4, strafe: 0.6, camp: 1,  desc: 'sucht Ueberblick und wartet' },
  flanker: { name: 'Flanker', dist: 1.0, cover: 1.0, dash: 1.4, strafe: 1.3, camp: 0,  desc: 'laeuft ueber die Seiten' },
  support: { name: 'Support', dist: 1.1, cover: 1.1, dash: 1.0, strafe: 0.9, camp: 0,  desc: 'bleibt beim Team und hilft' },
};
const PERSONA_IDS = ['rusher', 'rusher', 'camper', 'flanker', 'flanker', 'support', 'support'];

export class Bot extends Actor {
  constructor(game, opts) {
    // Zufaellige Aufsaetze auf Primaer- und Sekundaerwaffe der Klasse
    const cls = CLASS_BY_ID[opts.classId] || CLASS_BY_ID.triggerman;
    const attachments = {};
    for (const wid of [cls.primary, cls.secondary]) {
      const w = WEAPONS[wid];
      if (w) { const a = randomAttachments(w); if (a.length) attachments[wid] = a; }
    }
    super(game, Object.assign({ isBot: true, attachments }, opts));

    this.diff = DIFFICULTY[clamp(opts.difficulty | 0, 0, 3)];
    this.state = STATE.WANDER;

    this.target = null;
    this.targetSeenAt = -99;
    this.targetLastPos = { x: 0, y: 0, z: 0 };
    this.targetAcquiredAt = -99;    // seit wann das aktuelle Ziel "im Visier" ist (Einschwingen)
    this.targetLostAt = -99;
    this.reactTimer = 0;
    this.pendingTarget = null;

    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.goal = null;
    this.moveGoal = null;
    this.coverGoal = null;
    this.coverT = 0;
    this.objective = null;
    this.objectiveT = 0;

    // Zielen: gedaempfte Feder auf Yaw/Pitch + wandernder Fehler
    this.aimVelYaw = 0;
    this.aimVelPitch = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.errTargetYaw = 0;
    this.errTargetPitch = 0;
    this.errT = 0;
    this.recoilUp = 0;
    this.trackX = 0; this.trackY = 0; this.trackZ = 0;   // nachgezogener Zielpunkt
    this.noiseT = rand(0, 100);

    this.strafeDir = randSign();
    this.strafeTimer = 0;
    this.jumpTimer = rand(1, 4);
    this.burstLeftAI = 0;
    this.pauseTimer = 0;
    this.nadeAimT = 0;
    this.peekT = 0;

    this.stuckTimer = 0;
    this.lastPos = { x: 0, y: 0, z: 0 };
    this.unstuckTimer = 0;

    this.thinkTimer = rand(0, 0.15);
    this.preferDist = 18;
    this.intent.autoJump = false;
    this.objectiveDirty = false;

    // Persoenlichkeit
    this.personaId = opts.persona || pick(PERSONA_IDS);
    this.persona = PERSONAS[this.personaId];
    this.campT = 0;
    this.helpTarget = null;
    this.helpT = -99;
    this.lowHpSaidT = -99;

    // Zufaellige Kosmetik
    this.skins = {};
    this.stickers = {};
    for (const s of this.slots) {
      this.skins[s.w.id] = randomSkinId();
      this.stickers[s.w.id] = randomStickerId();
    }
    this.outfit = randomOutfitId();
    this.hat = randomHatId();
    this.killEffect = randomKillEffectId();
    this.killIcon = randomKillIconId();
  }

  spawn(point) {
    super.spawn(point);
    this.state = STATE.WANDER;
    this.target = null;
    this.pendingTarget = null;
    this.path = null;
    this.goal = null;
    this.moveGoal = null;
    this.coverGoal = null;
    this.objective = null;
    this.repathTimer = 0;
    this.burstLeftAI = 0;
    this.pauseTimer = 0;
    this.stuckTimer = 0;
    this.recoilUp = 0;
    this.aimVelYaw = this.aimVelPitch = 0;
    this.errYaw = this.errPitch = 0;
    this.lastPos.x = point.x; this.lastPos.y = point.y; this.lastPos.z = point.z;
    this._updatePreferredRange();
  }

  get stateName() { return STATE_NAME[this.state]; }

  _updatePreferredRange() {
    const w = this.weapon;
    if (w.melee) this.preferDist = 2.2;
    else if (w.id === 'shotgun') this.preferDist = rand(5, 10);
    else if (w.id === 'flame') this.preferDist = rand(4, 7.5);
    else if (w.id === 'sniper') this.preferDist = rand(38, 65);
    else if (w.id === 'marksman' || w.id === 'bow') this.preferDist = rand(24, 42);
    else if (w.id === 'smg' || w.id === 'akimbo') this.preferDist = rand(7, 15);
    else if (w.id === 'tknife') this.preferDist = rand(8, 15);
    else if (w.id === 'rpg') this.preferDist = rand(16, 30);
    else if (w.id === 'lmg' || w.id === 'minigun') this.preferDist = rand(14, 30);
    else this.preferDist = rand(13, 26);
    if (!w.melee && this.persona) this.preferDist *= this.persona.dist;
  }

  /** Teamkamerad in Not in der Naehe? (wenig Leben, gerade getroffen) */
  _mateInNeed() {
    const g = this.game;
    if (!g.teamMode) return null;
    let best = null, bd = 30;
    for (const a of g.actors) {
      if (a === this || !a.alive || !g.sameTeam(a, this)) continue;
      if (a.hp > a.maxHp * 0.4 || g.time - a.lastDamageTime > 2.5) continue;
      const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  // --------------------------------------------------------
  update(dt, world) {
    if (!this.alive) return;

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = 0.08 + Math.random() * 0.07;
      this._think(world);
    }

    this._aim(dt, world);
    this._move(dt, world);
    this._combat(dt, world);

    this.updateWeapons(dt);
    this.updatePhysics(dt, world);

    // Steckengeblieben?
    const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z);
    const wantsMove = Math.abs(this.intent.fwd) + Math.abs(this.intent.side) > 0.1;
    if (wantsMove && moved < 0.035) this.stuckTimer += dt;
    else this.stuckTimer = Math.max(0, this.stuckTimer - dt * 2);
    this.lastPos.x = this.pos.x; this.lastPos.y = this.pos.y; this.lastPos.z = this.pos.z;

    if (this.stuckTimer > 0.6) {
      this.stuckTimer = 0;
      this.unstuckTimer = 0.55;
      this.intent.jumpPressed = true;
      this.path = null;
      this.repathTimer = 0;
      this.strafeDir = -this.strafeDir;
    }
    if (this.unstuckTimer > 0) this.unstuckTimer -= dt;
  }

  // --------------------------------------------------------
  // Wahrnehmung + Zustandslogik
  // --------------------------------------------------------
  _think(world) {
    const g = this.game;
    const d = this.diff;
    const uav = this.uavUntil > g.time;

    // ---- Sichtbare Gegner suchen ----
    let best = null, bestScore = -Infinity, bestLos = false;
    const eye = this._eye();

    for (const a of g.actors) {
      if (a === this || !a.alive) continue;
      if (g.sameTeam(a, this)) continue;
      if (a.spawnProtect > 0) continue;

      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const dy = a.pos.y - this.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > d.sightRange) continue;

      // Blickfeld: nur im Sichtkegel, sehr nahe Gegner werden "gehoert",
      // laute Gegner (Schuesse) in Hoerweite ebenfalls; UAV kennt alle
      const ang = Math.abs(angleDelta(this.yaw, Math.atan2(-dx, -dz)));
      const inFov = ang < d.fov || dist < d.hearRange * 0.35;
      const noisy = (g.time - (a.lastLoudTime || -99)) < 1.2 && dist < d.hearRange;
      if (!inFov && !noisy && !uav) continue;

      // Sichtlinie zur Brust (UAV liefert nur die Position, kein Schussrecht)
      const ty = a.pos.y + a.height * 0.62;
      const los = world.losClear(eye.x, eye.y, eye.z, a.pos.x, ty, a.pos.z);
      if (!los && !uav) continue;

      // Bewertung: nah + zentral + angeschlagen + Flaggentraeger
      let score = 400 - dist * 3 - ang * 40 + (a.hp < 40 ? 60 : 0) + (a.carrying ? 120 : 0);
      if (a === this.target) score += 90;
      if (a.isLocal) score += 15;
      if (!los) score -= 250;
      if (score > bestScore) { bestScore = score; best = a; bestLos = los; }
    }

    // ---- Reaktionszeit (auch beim Wiederauftauchen nach Deckung) ----
    if (best) {
      if (best !== this.target) {
        if (this.pendingTarget !== best) {
          this.pendingTarget = best;
          this.reactTimer = d.react * rand(0.75, 1.3);
        }
        this.reactTimer -= 0.1;
        if (this.reactTimer <= 0) {
          this.target = best;
          this.pendingTarget = null;
          this.targetAcquiredAt = g.time;
          this._updatePreferredRange();
        }
      } else {
        this.pendingTarget = null;
        // Ziel war laenger weg (Deckung) -> neu einschwingen
        if (g.time - this.targetSeenAt > 0.6) this.targetAcquiredAt = g.time + d.react * 0.5;
      }
      if (this.target === best && bestLos) {
        this.targetSeenAt = g.time;
        this.targetLastPos.x = best.pos.x;
        this.targetLastPos.y = best.pos.y;
        this.targetLastPos.z = best.pos.z;
      } else if (this.target === best && uav) {
        this.targetLastPos.x = best.pos.x;
        this.targetLastPos.y = best.pos.y;
        this.targetLastPos.z = best.pos.z;
      }
    } else {
      this.pendingTarget = null;
    }

    if (this.target && (!this.target.alive || g.sameTeam(this.target, this))) this.target = null;

    const sinceSeen = g.time - this.targetSeenAt;
    const visible = this.target && sinceSeen < 0.15;

    // ---- Zustand waehlen ----
    const hpFrac = (this.hp + this.armor) / (this.maxHp + this.maxArmor + 0.001);
    let objective = g.modeCtl ? g.modeCtl.objectiveFor(this) : null;
    const reloading = this.reloadTimer > 0.35;
    const P = this.persona;

    // Teamkamerad in Not: hinlaufen (Support immer, andere manchmal)
    if (!this.target || !visible) {
      if (this.helpTarget && (!this.helpTarget.alive || g.time - this.helpTarget.lastDamageTime > 6)) this.helpTarget = null;
      if (!this.helpTarget && (this.personaId === 'support' || Math.random() < 0.25)) {
        const mate = this._mateInNeed();
        if (mate && g.time - this.helpT > 12) {
          this.helpTarget = mate; this.helpT = g.time;
          g.botChat(this, 'help');
        }
      }
      if (this.helpTarget) objective = { x: this.helpTarget.pos.x, y: this.helpTarget.pos.y, z: this.helpTarget.pos.z, kind: 'assist' };
    }
    // Selbst in Not: um Hilfe rufen
    if (hpFrac < 0.3 && g.time - this.lowHpSaidT > 20 && g.teamMode) { this.lowHpSaidT = g.time; g.botChat(this, 'lowhp'); }
    this.objective = objective;

    if (this.state === STATE.COVER && this.coverT > 0) {
      // In Deckung bleiben, bis nachgeladen / erholt oder Zeit abgelaufen
      this.coverT -= 0.1;
      if (!reloading && (hpFrac > 0.45 || this.coverT <= 0) && visible) this.state = STATE.FIGHT;
      else if (this.coverT <= 0) this.state = visible ? STATE.FIGHT : STATE.HUNT;
    } else if (this.target && visible) {
      const wantCover = (reloading || hpFrac < 0.3) && Math.random() < d.cover * P.cover;
      if (wantCover && this._findCover(world)) { this.state = STATE.COVER; this.coverT = reloading ? 2.2 : 3.5; }
      else if (hpFrac < 0.28 && Math.random() < 0.5 * P.cover && d.reloadSmart > 0.5) this.state = STATE.RETREAT;
      else this.state = STATE.FIGHT;
    } else if (this.target && sinceSeen < d.memory) {
      this.state = STATE.HUNT;
    } else {
      this.target = null;
      // Ohne Gegner: Missionsziel (70 %) oder Streifzug; Camper bleiben auf ihrem Posten
      if (objective && (this.state === STATE.OBJECTIVE || Math.random() < 0.7 || objective.kind === 'home' || objective.kind === 'return' || objective.kind === 'assist')) this.state = STATE.OBJECTIVE;
      else this.state = STATE.WANDER;
    }

    // ---- Ziel fuer Pfadfindung ----
    this.repathTimer -= 0.1;
    if (this.objectiveDirty) { this.objectiveDirty = false; this.repathTimer = 0; }
    if (this.repathTimer <= 0 || !this.path) {
      this.repathTimer = rand(0.45, 0.95);
      let gx, gy, gz;

      if (this.state === STATE.FIGHT) {
        const t = this.target;
        const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        // Auf Wunschdistanz zugehen / zurueckweichen; Flaggentraeger laufen weiter
        const want = this.preferDist;
        const move = clamp((dist - want) / Math.max(dist, 1), -1, 1);
        if (this.carrying && objective) { gx = objective.x; gy = objective.y; gz = objective.z; }
        else { gx = this.pos.x - dx * move * 0.9; gz = this.pos.z - dz * move * 0.9; gy = t.pos.y; }
      } else if (this.state === STATE.COVER && this.coverGoal) {
        gx = this.coverGoal.x; gy = this.coverGoal.y; gz = this.coverGoal.z;
      } else if (this.state === STATE.RETREAT) {
        const t = this.target;
        const c = this._findCover(world);
        if (c) { gx = c.x; gy = c.y; gz = c.z; }
        else {
          const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
          const l = Math.hypot(dx, dz) || 1;
          gx = this.pos.x + (dx / l) * 22; gz = this.pos.z + (dz / l) * 22; gy = this.pos.y;
        }
      } else if (this.state === STATE.HUNT) {
        gx = this.targetLastPos.x; gy = this.targetLastPos.y; gz = this.targetLastPos.z;
      } else if (this.state === STATE.OBJECTIVE && objective) {
        gx = objective.x; gy = objective.y; gz = objective.z;
      } else {
        const atGoal = this.goal && Math.hypot(this.pos.x - this.goal.x, this.pos.z - this.goal.z) < 5;
        if (atGoal && this.persona.camp) {
          // Camper: am Posten bleiben (12-25 s), dann neuen suchen
          this.campT -= 0.5;
          if (this.campT <= 0) { this.goal = this._pickWanderGoal(world); this.campT = rand(12, 25); }
        } else if (!this.goal || atGoal) {
          this.goal = this._pickWanderGoal(world);
          this.campT = rand(12, 25);
        }
        gx = this.goal.x; gy = this.goal.y; gz = this.goal.z;
      }

      const half = (world.map.size || 120) / 2 - 3;
      gx = clamp(gx, -half, half);
      gz = clamp(gz, -half, half);

      // Direktes Ziel merken: falls kein Pfad existiert, wird darauf zugesteuert
      this.moveGoal = { x: gx, y: gy, z: gz };

      const p = world.findPath(this.pos.x, this.pos.y, this.pos.z, gx, gy, gz);
      if (p && p.length) { this.path = p; this.pathIdx = 0; }
      else {
        this.path = null;
        if (this.state === STATE.WANDER) this.goal = null;
      }
    }
  }

  /**
   * Deckung: Navigationspunkt in der Naehe, den das Ziel nicht sieht.
   * Rueckgabe {x,y,z} oder null (setzt this.coverGoal).
   */
  _findCover(world) {
    const t = this.target;
    if (!t || !world.nav) return null;
    const tx = t.pos.x, ty = t.pos.y + t.height * 0.8, tz = t.pos.z;
    let best = null, bestD = Infinity;
    const nodes = world.nav.nodes;
    const tries = 26;
    for (let i = 0; i < tries; i++) {
      const nd = nodes[(Math.random() * nodes.length) | 0];
      const dx = nd.x - this.pos.x, dz = nd.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 2 || d > 16 || Math.abs(nd.y - this.pos.y) > 4) continue;
      // Nicht auf den Gegner zulaufen
      const ddx = nd.x - tx, ddz = nd.z - tz;
      if (Math.hypot(ddx, ddz) < 5) continue;
      if (world.losClear(tx, ty, tz, nd.x, nd.y + 1.4, nd.z)) continue;   // sichtbar -> keine Deckung
      if (d < bestD) { bestD = d; best = nd; }
    }
    if (!best) { this.coverGoal = null; return null; }
    this.coverGoal = { x: best.x, y: best.y, z: best.z };
    return this.coverGoal;
  }

  _pickWanderGoal(world) {
    const w = this.weapon;
    const g = this.game;
    // Scharfschuetzen und Camper suchen hohe Positionen mit Ueberblick
    if ((w.id === 'sniper' || w.id === 'marksman' || w.id === 'bow' || this.persona.camp) && Math.random() < 0.7 && world.nav) {
      let best = null;
      for (let i = 0; i < 24; i++) {
        const nd = world.nav.nodes[(Math.random() * world.nav.nodes.length) | 0];
        if (nd.y > 4 && (!best || nd.y > best.y)) best = nd;
      }
      if (best) return { x: best.x, y: best.y, z: best.z };
    }
    // Flanker: seitlich versetzt Richtung Gegnerspawn
    if (this.personaId === 'flanker' && Math.random() < 0.7) {
      const enemySpawns = g.enemySpawnsFor(this);
      if (enemySpawns && enemySpawns.length) {
        const s = pick(enemySpawns);
        const dx = s.x - this.pos.x, dz = s.z - this.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        const side = (this.id % 2 ? 1 : -1) * rand(16, 26);
        return { x: clamp(s.x * 0.5 + this.pos.x * 0.5 - dz / l * side, -55, 55), y: s.y, z: clamp(s.z * 0.5 + this.pos.z * 0.5 + dx / l * side, -55, 55) };
      }
    }
    // Support: beim naechsten Teamkameraden bleiben
    if (this.personaId === 'support' && g.teamMode && Math.random() < 0.7) {
      let mate = null, bd = Infinity;
      for (const a of g.actors) {
        if (a === this || !a.alive || !g.sameTeam(a, this)) continue;
        const d = Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z);
        if (d < bd) { bd = d; mate = a; }
      }
      if (mate) return { x: mate.pos.x + rand(-5, 5), y: mate.pos.y, z: mate.pos.z + rand(-5, 5) };
    }
    // Bevorzugt Punkte in Richtung des gegnerischen Spawns / Pickups
    if (Math.random() < 0.35) {
      const pk = this.game.pickups.filter(p => p.active);
      if (pk.length) {
        const p = pick(pk);
        return { x: p.x, y: p.y, z: p.z };
      }
    }
    if (Math.random() < 0.45) {
      const enemySpawns = this.game.enemySpawnsFor(this);
      if (enemySpawns && enemySpawns.length) {
        const s = pick(enemySpawns);
        return { x: s.x + rand(-8, 8), y: s.y, z: s.z + rand(-8, 8) };
      }
    }
    return world.randomNavPoint();
  }

  _eye() {
    const e = this._eyeTmp || (this._eyeTmp = { x: 0, y: 0, z: 0 });
    e.x = this.pos.x;
    e.y = this.pos.y + this.eyeHeight();
    e.z = this.pos.z;
    return e;
  }

  // --------------------------------------------------------
  // Zielen
  // --------------------------------------------------------
  _aim(dt, world) {
    const d = this.diff;
    const g = this.game;
    this.noiseT += dt;

    let tx, ty, tz;
    let tracking = false;

    if (this.target && (g.time - this.targetSeenAt) < d.memory && this.state !== STATE.COVER) {
      const t = this.target;
      const seen = (g.time - this.targetSeenAt) < 0.2;
      const px = seen ? t.pos.x : this.targetLastPos.x;
      const py = seen ? t.pos.y : this.targetLastPos.y;
      const pz = seen ? t.pos.z : this.targetLastPos.z;
      tracking = seen;

      // Zielpunkt: Brust; Kopf nur, wenn eingeschwungen und das Ziel ruhig steht
      const settled = g.time - this.targetAcquiredAt > d.settle;
      const tSpeed = Math.hypot(t.vel.x, t.vel.z);
      const aimHead = settled && tSpeed < 3 && Math.random() < d.hsChance * 0.2;
      const hOff = aimHead ? t.height * 0.88 : t.height * (0.58 + gauss(0.05));
      let ax = px, ay = py + hOff, az = pz;

      // Nachziehen: der Zielpunkt laeuft dem Gegner hinterher (Lag), bei
      // Projektilen dagegen bewusst vorhalten
      const w = this.weapon;
      const dist = Math.hypot(ax - this.pos.x, ay - this.pos.y, az - this.pos.z);
      if (w.projectile && !w.throwWeapon && !w.charge) {
        const lead = dist / w.projectile.speed * clamp(d.turnRate / 8, 0.4, 1.1);
        ax += t.vel.x * lead; ay += t.vel.y * lead * 0.5; az += t.vel.z * lead;
        if (w.projectile.gravity > 0) ay += 0.5 * w.projectile.gravity * lead * lead;
      } else {
        ax -= t.vel.x * d.lag; az -= t.vel.z * d.lag; ay -= t.vel.y * d.lag * 0.5;
      }
      // Granatenwurf: hoch anhalten
      if (this.nadeAimT > 0) { ay += dist * 0.55; }

      // Weich nachziehen (der Zielpunkt selbst ist traege)
      const k = clamp(dt * (8 + d.turnRate * 1.2), 0, 1);
      if (this.trackX === 0 && this.trackY === 0 && this.trackZ === 0) { this.trackX = ax; this.trackY = ay; this.trackZ = az; }
      this.trackX += (ax - this.trackX) * k;
      this.trackY += (ay - this.trackY) * k;
      this.trackZ += (az - this.trackZ) * k;
      tx = this.trackX; ty = this.trackY; tz = this.trackZ;
    } else if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[Math.min(this.pathIdx + 1, this.path.length - 1)];
      tx = wp.x; ty = wp.y + 1.6; tz = wp.z;
      this.trackX = this.trackY = this.trackZ = 0;
      // Umherschauen beim Laufen
      tx += Math.sin(this.noiseT * 0.7) * 3;
    } else {
      tx = this.pos.x - Math.sin(this.yaw) * 10;
      ty = this.pos.y + 1.7;
      tz = this.pos.z - Math.cos(this.yaw) * 10;
      this.trackX = this.trackY = this.trackZ = 0;
    }

    const ex = this.pos.x, ey = this.pos.y + this.eyeHeight(), ez = this.pos.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const flat = Math.hypot(dx, dz);
    let wantYaw = Math.atan2(-dx, -dz);
    let wantPitch = Math.atan2(dy, flat);

    // ---- Wandernder Zielfehler: neues Ziel alle 0.25-0.6 s, weich angefahren ----
    this.errT -= dt;
    if (this.errT <= 0) {
      this.errT = rand(0.25, 0.6);
      const dist = Math.hypot(dx, dy, dz);
      const tSpeed = this.target ? Math.hypot(this.target.vel.x, this.target.vel.z) : 0;
      const own = Math.hypot(this.vel.x, this.vel.z);
      const settle = clamp((g.time - this.targetAcquiredAt) / d.settle, 0, 1);
      let e = d.drift * (this.state === STATE.FIGHT ? 1 : 2.5);
      e *= 1 + dist / 70;                      // weit weg: ungenauer
      e *= 1 + tSpeed / 16;                    // schnelles Ziel: ungenauer
      e *= 1 + own / 22;                       // selbst in Bewegung: ungenauer
      e *= 1 + (1 - settle) * 3.0;             // gerade erst erfasst: deutlich ungenauer
      if (this.adsAmount > 0.5) e *= 0.75;
      if (this.crouching) e *= 0.85;
      this.errTargetYaw = gauss(e);
      this.errTargetPitch = gauss(e * 0.8);
    }
    const ek = clamp(dt * 6, 0, 1);
    this.errYaw += (this.errTargetYaw - this.errYaw) * ek;
    this.errPitch += (this.errTargetPitch - this.errPitch) * ek;
    // Feines Zittern
    const jit = d.drift * 0.25;
    wantYaw += this.errYaw + Math.sin(this.noiseT * 5.7) * jit;
    wantPitch += this.errPitch + Math.cos(this.noiseT * 4.3) * jit * 0.6;

    // ---- Rueckstoss: treibt den Lauf hoch, wird nur teilweise kompensiert ----
    if (this.recoilUp > 0) {
      const comp = d.recoilComp * dt * 6;
      this.recoilUp = Math.max(0, this.recoilUp - this.recoilUp * comp - dt * 0.15);
      wantPitch += this.recoilUp;
    }

    // ---- Gedaempfte Feder mit begrenzter Drehgeschwindigkeit -> Ueberschwingen bei Flicks ----
    const rate = d.turnRate * (this.state === STATE.FIGHT ? 1 : 0.55) * (tracking ? 1 : 0.7);
    const dYaw = angleDelta(this.yaw, wantYaw);
    const dPitch = clamp(wantPitch, -1.4, 1.4) - this.pitch;
    const K = d.aimK, D = d.aimD;
    this.aimVelYaw += (dYaw * K - this.aimVelYaw * D) * dt;
    this.aimVelPitch += (dPitch * K - this.aimVelPitch * D) * dt;
    this.aimVelYaw = clamp(this.aimVelYaw, -rate, rate);
    this.aimVelPitch = clamp(this.aimVelPitch, -rate, rate);
    this.yaw += this.aimVelYaw * dt;
    this.pitch += this.aimVelPitch * dt;
    this.pitch = clamp(this.pitch, -1.45, 1.45);
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;
  }

  /** Vom Spiel nach jedem eigenen Schuss aufgerufen */
  onShotFired(w) {
    this.recoilUp += (w.recoilV || 0.5) * 0.0175 * rand(0.7, 1.3);
    this.recoilUp = Math.min(this.recoilUp, 0.12);
  }

  // --------------------------------------------------------
  // Bewegung
  // --------------------------------------------------------
  _move(dt, world) {
    const it = this.intent;
    it.fwd = 0; it.side = 0; it.sprint = false; it.crouch = false;

    // Waypoint anpeilen
    let dirX = 0, dirZ = 0, haveDir = false;
    if (this.path && this.pathIdx < this.path.length) {
      let wp = this.path[this.pathIdx];
      let dx = wp.x - this.pos.x, dz = wp.z - this.pos.z;
      let dist = Math.hypot(dx, dz);
      const dy = wp.y - this.pos.y;

      // Waypoint erreicht?
      while (dist < 1.5 && Math.abs(dy) < 2.6 && this.pathIdx < this.path.length - 1) {
        this.pathIdx++;
        wp = this.path[this.pathIdx];
        dx = wp.x - this.pos.x; dz = wp.z - this.pos.z;
        dist = Math.hypot(dx, dz);
      }
      if (dist < 1.2 && this.pathIdx >= this.path.length - 1) {
        this.path = null;
      } else if (dist > 0.001) {
        dirX = dx / dist; dirZ = dz / dist;
        haveDir = true;
        // Hindernis vor uns -> springen
        if (dy > 0.9 && dist < 3.2 && this.grounded) it.jumpPressed = true;
      }
    }

    // Ohne Pfad direkt auf das Ziel zusteuern (z.B. kurze Wege oder Sackgassen)
    if (!haveDir && this.moveGoal) {
      const dx = this.moveGoal.x - this.pos.x, dz = this.moveGoal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.5) { dirX = dx / d; dirZ = dz / d; haveDir = true; }
    }

    // In der Zone / in Deckung / am Bombenplatz angekommen: stehen bleiben und ducken
    const ob = this.objective;
    const obDist = ob ? Math.hypot(ob.x - this.pos.x, ob.z - this.pos.z) : Infinity;
    const holding = (this.state === STATE.OBJECTIVE && ob && (ob.kind === 'zone' || ob.kind === 'defend' || ob.kind === 'guard') && obDist < 1.6) ||
                    (this.state === STATE.COVER && this.coverGoal && Math.hypot(this.coverGoal.x - this.pos.x, this.coverGoal.z - this.pos.z) < 1.3) ||
                    (this.persona.camp && this.state === STATE.WANDER && this.goal && Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z) < 2);
    if (holding) { haveDir = false; if (this.state === STATE.COVER || this.persona.camp || Math.random() < 0.5) it.crouch = true; }

    // Bombe legen / entschaerfen (S&D): am Platz stehen bleiben und E halten
    it.interactHold = false;
    if (this.state === STATE.OBJECTIVE && ob && (ob.kind === 'plant' || ob.kind === 'defuse') && obDist < 2.2 && this.state !== STATE.FIGHT) {
      haveDir = false; it.interactHold = true; it.crouch = true;
    }

    // Seilbahn nutzen, wenn das andere Ende naeher am Ziel liegt; liegende Waffe aufheben, wenn leer
    if (this.moveGoal && (this.game.time - (this._iaT || -9)) > 0.5) {
      this._iaT = this.game.time;
      const ia = this.game.interactionFor(this);
      if (ia && ia.type === 'zip') {
        const from = ia.fromA ? ia.z.a : ia.z.b, to = ia.fromA ? ia.z.b : ia.z.a;
        const dFrom = Math.hypot(from.x - this.moveGoal.x, from.z - this.moveGoal.z);
        const dTo = Math.hypot(to.x - this.moveGoal.x, to.z - this.moveGoal.z);
        if (dTo + 8 < dFrom) it.interact = true;
      } else if (ia && ia.type === 'drop') {
        const s0 = this.slots[0];
        if (s0 && s0.w.mag !== Infinity && s0.mag + s0.reserve < s0.w.mag * 0.5) it.interact = true;
      }
    }

    // Enterhaken: Distanz schliessen oder hoch zum Wegpunkt
    if (this.canGrapple && !this.grapple && this.grappleCooldown <= 0 && !this.zip) {
      if (this.state === STATE.FIGHT && this.target) {
        const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
        if (dist > this.preferDist * 1.6 && dist < 40 && Math.random() < 0.02 * this.persona.dash) it.grapple = true;
      } else if (this.path && this.pathIdx < this.path.length) {
        const wp = this.path[Math.min(this.pathIdx + 1, this.path.length - 1)];
        if (wp.y - this.pos.y > 4 && Math.random() < 0.04) it.grapple = true;
      }
    }

    if (this.unstuckTimer > 0) {
      // Ausweichbewegung
      dirX = Math.sin(this.game.time * 4 + this.id);
      dirZ = Math.cos(this.game.time * 4 + this.id);
      haveDir = true;
    }

    // Weltrichtung -> lokale Eingabe
    if (haveDir) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      it.fwd = clamp(-(dirX * sin + dirZ * cos), -1, 1);
      it.side = clamp(dirX * cos - dirZ * sin, -1, 1);
    }

    // Strafen im Kampf
    if (this.state === STATE.FIGHT && this.target) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(0.5, 1.5);
        if (Math.random() < 0.55) this.strafeDir = -this.strafeDir;
      }
      const sk = this.diff.strafeSkill * this.persona.strafe;
      it.side = clamp(it.side + this.strafeDir * sk, -1, 1);
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      // Distanz halten
      if (dist < this.preferDist * 0.55) it.fwd = clamp(it.fwd - 0.8, -1, 1);
      else if (dist > this.preferDist * 1.6) it.fwd = clamp(it.fwd + 0.7, -1, 1);

      // Praezisionswaffen: stehen bleiben und ducken, wenn weit weg
      const w = this.weapon;
      if ((w.id === 'sniper' || w.id === 'marksman' || w.id === 'lmg' || w.id === 'bow') && dist > 24 && Math.random() < 0.03) it.crouch = true;
      if (w.id === 'sniper' && dist > 30 && this.adsAmount > 0.5) { it.side *= 0.3; it.fwd *= 0.3; }
    }

    // Sprinten wenn weit weg vom Ziel und kein Kampf
    if (this.state !== STATE.FIGHT && this.state !== STATE.COVER && it.fwd > 0.5) it.sprint = true;

    // Gelegentlich springen (Bunny-Hop-Anmutung), nicht mit Praezisionswaffen im Kampf
    this.jumpTimer -= dt;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = rand(0.6, 3.0) / Math.max(0.15, this.diff.jumpiness + 0.2);
      const w = this.weapon;
      const precise = w.id === 'sniper' || w.id === 'marksman' || w.id === 'bow';
      if (this.grounded && (this.state === STATE.FIGHT ? (!precise && Math.random() < this.diff.jumpiness) : Math.random() < 0.25)) {
        it.jumpPressed = true;
      }
    }

    // Slide beim Sprinten (gute Bots)
    if (this.diff.strafeSkill > 0.7 && this.state === STATE.FIGHT &&
        this.grounded && Math.hypot(this.vel.x, this.vel.z) > 9 && Math.random() < 0.004) {
      it.crouch = true;
    }

    // Dash-Perk: zum Gegner schliessen (Nahkampf/Shotgun) oder beim Rueckzug abhauen
    if (this.canDash && this.dashCooldown <= 0 && this.target && haveDir) {
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      const closer = this.weapon.melee || this.weapon.id === 'shotgun' || this.weapon.id === 'flame';
      const wants = (this.state === STATE.FIGHT && dist > this.preferDist * (closer ? 1.2 : 1.6)) || this.state === STATE.RETREAT || this.state === STATE.COVER;
      if (wants && Math.random() < 0.025 * (0.5 + this.diff.strafeSkill) * this.persona.dash) it.dash = true;
    }
  }

  // --------------------------------------------------------
  // Kampf
  // --------------------------------------------------------
  _combat(dt, world) {
    const it = this.intent;
    const d = this.diff;
    const s = this.ammo;
    const w = this.weapon;
    const g = this.game;

    it.fire = false;
    it.reload = false;
    it.nade = false;
    it.melee = false;
    it.ads = false;
    it.inspect = false;
    it.airstrike = false;
    if (this.nadeAimT > 0) this.nadeAimT -= dt;
    // Zombies: gelegentlich knurren (Chat)
    if (this.zombie && Math.random() < 0.0008) g.botChat(this, 'zombie');

    // Nachladen wenn leer oder in Ruhe / in Deckung
    if (s.mag !== Infinity) {
      if (s.mag <= 0 && s.reserve > 0) it.reload = true;
      else if ((this.state !== STATE.FIGHT || this.state === STATE.COVER) && s.mag < w.mag * 0.4 && s.reserve > 0 &&
               Math.random() < d.reloadSmart * 0.03) it.reload = true;
    }

    // Keine Munition mehr -> Waffe wechseln
    if (s.mag !== Infinity && s.mag <= 0 && s.reserve <= 0) {
      for (let i = 0; i < this.slots.length; i++) {
        const o = this.slots[i];
        if (i !== this.slot && (o.mag === Infinity || o.mag > 0 || o.reserve > 0)) {
          it.switchTo = i;
          break;
        }
      }
      return;
    }

    if (!this.target) return;
    const t = this.target;
    // targetSeenAt wird nur mit freier Sichtlinie gesetzt (siehe _think)
    const seen = (g.time - this.targetSeenAt) < 0.12;

    const eye = this._eye();
    const ty = t.pos.y + t.height * 0.6;
    const dx = t.pos.x - eye.x, dy = ty - eye.y, dz = t.pos.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);

    // Granate auf die letzte bekannte Position, wenn der Gegner in Deckung ist
    if (!seen && this.state === STATE.HUNT && this.nades > 0 && this.nadeCooldown <= 0 &&
        dist > 8 && dist < 30 && Math.random() < d.nadeChance * 0.03) {
      this.nadeAimT = 0.45;
      this._nadeDue = 0.35;
    }
    if (this._nadeDue !== undefined && this._nadeDue > 0) {
      this._nadeDue -= dt;
      if (this._nadeDue <= 0) { it.nade = true; this._nadeDue = undefined; }
    }

    // Luftschlag (Killstreak): auf das Ziel, wenn es weit genug weg ist
    if (this.airstrikes > 0 && seen && dist > 14 && Math.random() < 0.02) it.airstrike = true;

    if (!seen) return;

    // Zielgenauigkeit pruefen
    const flat = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, flat);
    const angErr = Math.abs(angleDelta(this.yaw, wantYaw)) + Math.abs(wantPitch - this.pitch);

    // Nahkampf, wenn sehr nah und Messer besser waere (Nahkampfklassen frueher)
    const meleeIdx = this.slots.findIndex(sl => sl.w.melee);
    const meleeEager = this.slots[meleeIdx] && this.slots[meleeIdx].w.id === 'katana' ? 6 : 3.2;
    if (dist < meleeEager && !w.melee && meleeIdx >= 0 && Math.random() < 0.04) {
      it.switchTo = meleeIdx;
      return;
    }
    if (w.melee) {
      if (dist < (w.meleeRange || 3.4) * 0.9 && angErr < 0.5) {
        if (w.heavy && this.fireTimer <= 0 && Math.random() < 0.25 * d.strafeSkill) it.ads = true;
        else it.fire = true;
      }
      // Nach dem Nahkampf zurueck zur Primaerwaffe
      if (dist > 8 && Math.random() < 0.05) it.switchTo = 0;
      return;
    }

    // Zielen (ADS) bei Distanzwaffen
    if (dist > 14 && (w.id === 'sniper' || w.id === 'marksman' || w.id === 'burst' || w.id === 'ar' || w.id === 'bow')) {
      it.ads = true;
    }

    // Granate werfen (im Kampf, auf mittlere Distanz)
    if (this.nades > 0 && dist > 9 && dist < 32 && this.nadeCooldown <= 0 && this.nadeAimT <= 0 &&
        Math.random() < d.nadeChance * 0.012) {
      this.nadeAimT = 0.45;
      this._nadeDue = 0.35;
    }

    const maxEff = w.flame ? w.range : w.falloffEnd * 1.1;
    if (dist > maxEff) return;
    // Erst schiessen, wenn das Zielen eingeschwungen ist (Reaktions-/Einschwingzeit)
    const settled = (g.time - this.targetAcquiredAt) > d.settle * 0.45;
    if (!settled) return;
    // Der Bot "glaubt" seinem Zielpunkt inkl. Fehler: Feuerfreigabe, sobald die
    // Zielfeder ruhig ist und die Richtung im Rahmen des eigenen Fehlers passt
    const errMag = Math.abs(this.errYaw) + Math.abs(this.errPitch) + this.recoilUp;
    const springCalm = Math.abs(this.aimVelYaw) + Math.abs(this.aimVelPitch) < 2.6;
    if (!springCalm) return;
    if (angErr > d.fireAngle + errMag + 0.02 + (w.pellets > 1 ? 0.05 : 0) + (w.flame ? 0.15 : 0)) return;

    // Bogen: spannen und bei voller Spannung loslassen
    if (w.charge) {
      it.fire = this.chargeT < w.charge.time - 1e-3 && !(this.pauseTimer > 0);
      if (this.chargeT >= w.charge.time - 1e-3) { it.fire = false; this.pauseTimer = rand(0.4, 0.9); }
      return;
    }

    // Feuerpausen simulieren (Rueckstosskontrolle)
    if (this.pauseTimer > 0) { this.pauseTimer -= dt; return; }

    if (w.auto) {
      if (this.burstLeftAI <= 0) {
        this.burstLeftAI = Math.round(rand(d.burst[0], d.burst[1]));
        if (w.spinUp || w.flame) this.burstLeftAI *= 3;
      }
      it.fire = true;
      // Zaehlt nur wenn wirklich geschossen wurde
      if (this.fireTimer <= 0 && s.mag > 0) {
        this.burstLeftAI--;
        if (this.burstLeftAI <= 0) this.pauseTimer = rand(d.pause[0], d.pause[1]);
      }
    } else {
      it.fire = true;
      if (this.fireTimer <= 0 && s.mag > 0) {
        this.pauseTimer = rand(d.pause[0] * 0.5, d.pause[1] * 0.8);
      }
    }
  }
}
