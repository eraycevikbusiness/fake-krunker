// ============================================================
// Bot-KI: Wahrnehmung, Zielen mit Reaktionszeit, Pfadfindung,
// Kampfverhalten je nach Waffentyp und Schwierigkeitsgrad
// ============================================================

import { Actor } from './actor.js';
import { clamp, rand, randSign, angleDelta, pick, gauss } from '../core/utils.js';

export const DIFFICULTY = [
  {
    name: 'Einfach', react: 0.62, aimSpeed: 5.0, aimErr: 0.085, jitter: 0.045,
    hsChance: 0.04, fireAngle: 0.10, strafeSkill: 0.35, burst: [2, 5], pause: [0.3, 0.9],
    memory: 1.6, jumpiness: 0.1, nadeChance: 0.05, hearRange: 22, sightRange: 95, reloadSmart: 0.3,
  },
  {
    name: 'Normal', react: 0.36, aimSpeed: 9.0, aimErr: 0.042, jitter: 0.028,
    hsChance: 0.14, fireAngle: 0.065, strafeSkill: 0.6, burst: [3, 7], pause: [0.18, 0.55],
    memory: 2.6, jumpiness: 0.25, nadeChance: 0.12, hearRange: 30, sightRange: 115, reloadSmart: 0.6,
  },
  {
    name: 'Schwer', react: 0.21, aimSpeed: 14.0, aimErr: 0.021, jitter: 0.016,
    hsChance: 0.30, fireAngle: 0.05, strafeSkill: 0.85, burst: [4, 9], pause: [0.1, 0.35],
    memory: 3.6, jumpiness: 0.45, nadeChance: 0.18, hearRange: 38, sightRange: 140, reloadSmart: 0.85,
  },
  {
    name: 'Albtraum', react: 0.11, aimSpeed: 21.0, aimErr: 0.010, jitter: 0.008,
    hsChance: 0.5, fireAngle: 0.04, strafeSkill: 1.0, burst: [6, 14], pause: [0.05, 0.2],
    memory: 5.0, jumpiness: 0.6, nadeChance: 0.25, hearRange: 46, sightRange: 170, reloadSmart: 1.0,
  },
];

const STATE = { WANDER: 0, HUNT: 1, FIGHT: 2, RETREAT: 3 };

export class Bot extends Actor {
  constructor(game, opts) {
    super(game, Object.assign({ isBot: true }, opts));

    this.diff = DIFFICULTY[clamp(opts.difficulty | 0, 0, 3)];
    this.state = STATE.WANDER;

    this.target = null;
    this.targetSeenAt = -99;
    this.targetLastPos = { x: 0, y: 0, z: 0 };
    this.reactTimer = 0;
    this.pendingTarget = null;

    this.path = null;
    this.pathIdx = 0;
    this.repathTimer = 0;
    this.goal = null;
    this.moveGoal = null;

    this.noiseT = rand(0, 100);
    this.noiseYaw = 0;
    this.noisePitch = 0;

    this.strafeDir = randSign();
    this.strafeTimer = 0;
    this.jumpTimer = rand(1, 4);
    this.burstLeftAI = 0;
    this.pauseTimer = 0;

    this.stuckTimer = 0;
    this.lastPos = { x: 0, y: 0, z: 0 };
    this.unstuckTimer = 0;

    this.thinkTimer = rand(0, 0.15);
    this.preferDist = 18;
    this.intent.autoJump = false;
  }

  spawn(point) {
    super.spawn(point);
    this.state = STATE.WANDER;
    this.target = null;
    this.pendingTarget = null;
    this.path = null;
    this.goal = null;
    this.moveGoal = null;
    this.repathTimer = 0;
    this.burstLeftAI = 0;
    this.pauseTimer = 0;
    this.stuckTimer = 0;
    this.lastPos.x = point.x; this.lastPos.y = point.y; this.lastPos.z = point.z;
    this._updatePreferredRange();
  }

  _updatePreferredRange() {
    const w = this.weapon;
    if (w.melee) this.preferDist = 2.2;
    else if (w.id === 'shotgun') this.preferDist = rand(5, 10);
    else if (w.id === 'sniper') this.preferDist = rand(38, 65);
    else if (w.id === 'marksman') this.preferDist = rand(26, 45);
    else if (w.id === 'smg' || w.id === 'akimbo') this.preferDist = rand(7, 15);
    else if (w.id === 'rpg') this.preferDist = rand(16, 30);
    else if (w.id === 'lmg') this.preferDist = rand(16, 34);
    else this.preferDist = rand(13, 26);
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

    // ---- Sichtbare Gegner suchen ----
    let best = null, bestScore = -Infinity;
    const eye = this._eye();

    for (const a of g.actors) {
      if (a === this || !a.alive) continue;
      if (g.sameTeam(a, this)) continue;
      if (a.spawnProtect > 0) continue;

      const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z;
      const dy = a.pos.y - this.pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist > d.sightRange) continue;

      // Blickfeld (Bots "hoeren" nahe Gegner auch hinter sich)
      const ang = Math.abs(angleDelta(this.yaw, Math.atan2(-dx, -dz)));
      const inFov = ang < 1.5 || dist < d.hearRange * 0.5;
      const noisy = (g.time - (a.lastLoudTime || -99)) < 1.2 && dist < d.hearRange;
      if (!inFov && !noisy) continue;

      // Sichtlinie zur Brust
      const ty = a.pos.y + a.height * 0.62;
      if (!world.losClear(eye.x, eye.y, eye.z, a.pos.x, ty, a.pos.z)) continue;

      // Bewertung: nah + zentral + angeschlagen
      let score = 400 - dist * 3 - ang * 40 + (a.hp < 40 ? 60 : 0);
      if (a === this.target) score += 90;
      if (a.isLocal) score += 25;
      if (score > bestScore) { bestScore = score; best = a; }
    }

    // ---- Reaktionszeit ----
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
          this._updatePreferredRange();
        }
      } else {
        this.pendingTarget = null;
      }
      if (this.target === best) {
        this.targetSeenAt = g.time;
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
    if (this.target && visible) {
      this.state = (hpFrac < 0.28 && Math.random() < 0.5 && this.diff.reloadSmart > 0.5)
        ? STATE.RETREAT : STATE.FIGHT;
    } else if (this.target && sinceSeen < d.memory) {
      this.state = STATE.HUNT;
    } else {
      this.target = null;
      this.state = STATE.WANDER;
    }

    // ---- Ziel fuer Pfadfindung ----
    this.repathTimer -= 0.1;
    if (this.repathTimer <= 0 || !this.path) {
      this.repathTimer = rand(0.45, 0.95);
      let gx, gy, gz;

      if (this.state === STATE.FIGHT) {
        const t = this.target;
        const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
        const dist = Math.hypot(dx, dz) || 1;
        // Auf Wunschdistanz zugehen / zurueckweichen
        const want = this.preferDist;
        const move = clamp((dist - want) / Math.max(dist, 1), -1, 1);
        gx = this.pos.x - dx * move * 0.9;
        gz = this.pos.z - dz * move * 0.9;
        gy = t.pos.y;
      } else if (this.state === STATE.RETREAT) {
        const t = this.target;
        const dx = this.pos.x - t.pos.x, dz = this.pos.z - t.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        gx = this.pos.x + (dx / l) * 22;
        gz = this.pos.z + (dz / l) * 22;
        gy = this.pos.y;
      } else if (this.state === STATE.HUNT) {
        gx = this.targetLastPos.x; gy = this.targetLastPos.y; gz = this.targetLastPos.z;
      } else {
        if (!this.goal || Math.hypot(this.pos.x - this.goal.x, this.pos.z - this.goal.z) < 5) {
          this.goal = this._pickWanderGoal(world);
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

  _pickWanderGoal(world) {
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
    this.noiseT += dt;
    // Weiches Pseudo-Rauschen fuer menschliche Zielbewegung
    this.noiseYaw = Math.sin(this.noiseT * 2.3) * 0.6 + Math.sin(this.noiseT * 5.7) * 0.4;
    this.noisePitch = Math.cos(this.noiseT * 1.9) * 0.6 + Math.cos(this.noiseT * 4.3) * 0.4;

    let tx, ty, tz;

    if (this.target && (this.game.time - this.targetSeenAt) < d.memory) {
      const t = this.target;
      const seen = (this.game.time - this.targetSeenAt) < 0.2;
      const px = seen ? t.pos.x : this.targetLastPos.x;
      const py = seen ? t.pos.y : this.targetLastPos.y;
      const pz = seen ? t.pos.z : this.targetLastPos.z;

      // Zielpunkt: Brust, mit Chance auf Kopf
      const aimHead = Math.random() < d.hsChance * 0.15;
      const hOff = aimHead ? t.height * 0.88 : t.height * (0.58 + gauss(0.06));
      tx = px; ty = py + hOff; tz = pz;

      // Vorhalten (Projektile / Reaktionslatenz)
      const w = this.weapon;
      const dist = Math.hypot(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z);
      let lead = 0;
      if (w.projectile) lead = dist / w.projectile.speed;
      else lead = 0.035;
      lead *= clamp(d.aimSpeed / 12, 0.35, 1.15);
      tx += t.vel.x * lead;
      ty += t.vel.y * lead * 0.5;
      tz += t.vel.z * lead;

      if (w.projectile && w.projectile.gravity > 0) {
        const tof = dist / w.projectile.speed;
        ty += 0.5 * w.projectile.gravity * tof * tof;
      }
    } else if (this.path && this.pathIdx < this.path.length) {
      const wp = this.path[Math.min(this.pathIdx + 1, this.path.length - 1)];
      tx = wp.x; ty = wp.y + 1.6; tz = wp.z;
    } else {
      tx = this.pos.x - Math.sin(this.yaw) * 10;
      ty = this.pos.y + 1.7;
      tz = this.pos.z - Math.cos(this.yaw) * 10;
    }

    const ex = this.pos.x, ey = this.pos.y + this.eyeHeight(), ez = this.pos.z;
    const dx = tx - ex, dy = ty - ey, dz = tz - ez;
    const flat = Math.hypot(dx, dz);
    let wantYaw = Math.atan2(-dx, -dz);
    let wantPitch = Math.atan2(dy, flat);

    // Zielfehler
    const err = d.aimErr * (this.state === STATE.FIGHT ? 1 : 2.5);
    wantYaw += this.noiseYaw * d.jitter + gauss(err) * 0.5;
    wantPitch += this.noisePitch * d.jitter * 0.6 + gauss(err) * 0.4;

    const speed = d.aimSpeed * (this.state === STATE.FIGHT ? 1 : 0.5);
    this.yaw += angleDelta(this.yaw, wantYaw) * clamp(speed * dt, 0, 1);
    this.pitch += (clamp(wantPitch, -1.4, 1.4) - this.pitch) * clamp(speed * dt, 0, 1);
    this.pitch = clamp(this.pitch, -1.45, 1.45);
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

    if (this.unstuckTimer > 0) {
      // Ausweichbewegung
      dirX = Math.sin(this.game.time * 4 + this.id);
      dirZ = Math.cos(this.game.time * 4 + this.id);
      haveDir = true;
    }

    // Weltrichtung -> lokale Eingabe
    if (haveDir) {
      const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
      // fwd/side aus Weltrichtung ableiten (invers zur Formel in actor.js)
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
      const sk = this.diff.strafeSkill;
      it.side = clamp(it.side + this.strafeDir * sk, -1, 1);
      const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z);
      // Distanz halten
      if (dist < this.preferDist * 0.55) it.fwd = clamp(it.fwd - 0.8, -1, 1);
      else if (dist > this.preferDist * 1.6) it.fwd = clamp(it.fwd + 0.7, -1, 1);

      // Sniper duckt sich fuer bessere Praezision
      if (this.weapon.id === 'sniper' && dist > 30 && Math.random() < 0.02) it.crouch = true;
    }

    // Sprinten wenn weit weg vom Ziel und kein Kampf
    if (this.state !== STATE.FIGHT && it.fwd > 0.5) it.sprint = true;

    // Gelegentlich springen (Bunny-Hop-Anmutung)
    this.jumpTimer -= dt;
    if (this.jumpTimer <= 0) {
      this.jumpTimer = rand(0.6, 3.0) / Math.max(0.15, this.diff.jumpiness + 0.2);
      if (this.grounded && (this.state === STATE.FIGHT ? Math.random() < this.diff.jumpiness : Math.random() < 0.25)) {
        it.jumpPressed = true;
      }
    }

    // Slide beim Sprinten (gute Bots)
    if (this.diff.strafeSkill > 0.7 && this.state === STATE.FIGHT &&
        this.grounded && Math.hypot(this.vel.x, this.vel.z) > 9 && Math.random() < 0.004) {
      it.crouch = true;
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

    it.fire = false;
    it.reload = false;
    it.nade = false;
    it.melee = false;
    it.ads = false;

    // Nachladen wenn leer oder in Ruhe
    if (s.mag !== Infinity) {
      if (s.mag <= 0 && s.reserve > 0) it.reload = true;
      else if (this.state !== STATE.FIGHT && s.mag < w.mag * 0.4 && s.reserve > 0 &&
               Math.random() < d.reloadSmart * 0.02) it.reload = true;
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
    const seen = (this.game.time - this.targetSeenAt) < 0.12;
    if (!seen) return;

    const eye = this._eye();
    const ty = t.pos.y + t.height * 0.6;
    const dx = t.pos.x - eye.x, dy = ty - eye.y, dz = t.pos.z - eye.z;
    const dist = Math.hypot(dx, dy, dz);

    // Zielgenauigkeit pruefen
    const flat = Math.hypot(dx, dz);
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, flat);
    const angErr = Math.abs(angleDelta(this.yaw, wantYaw)) + Math.abs(wantPitch - this.pitch);

    // Nahkampf, wenn sehr nah und Messer besser waere
    if (dist < 3.0 && !w.melee && Math.random() < 0.02 && this.slots[2]) {
      it.switchTo = 2;
      return;
    }
    if (w.melee) {
      if (dist < (w.meleeRange || 3.4) * 0.9 && angErr < 0.5) {
        // Gute Bots setzen auch den schweren Angriff ein
        if (w.heavy && this.fireTimer <= 0 && Math.random() < 0.25 * d.strafeSkill) it.ads = true;
        else it.fire = true;
      }
      // Nach dem Nahkampf zurueck zur Primaerwaffe
      if (dist > 8 && Math.random() < 0.05) it.switchTo = 0;
      return;
    }

    // Zielen (ADS) bei Distanzwaffen
    if (dist > 14 && (w.id === 'sniper' || w.id === 'marksman' || w.id === 'burst' || w.id === 'ar')) {
      it.ads = true;
    }

    // Granate werfen
    if (this.nades > 0 && dist > 9 && dist < 32 && this.nadeCooldown <= 0 &&
        Math.random() < d.nadeChance * 0.012) {
      it.nade = true;
    }

    const maxEff = w.falloffEnd * 1.1;
    if (dist > maxEff) return;
    if (angErr > d.fireAngle + (w.pellets > 1 ? 0.05 : 0)) return;

    // Feuerpausen simulieren (Rueckstosskontrolle)
    if (this.pauseTimer > 0) { this.pauseTimer -= dt; return; }

    if (w.auto) {
      if (this.burstLeftAI <= 0) {
        this.burstLeftAI = Math.round(rand(d.burst[0], d.burst[1]));
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
