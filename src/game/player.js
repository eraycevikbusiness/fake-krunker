// ============================================================
// Lokaler Spieler: Eingabe -> Intent, Kamera, Rueckstoss, Shake,
// Treppen-Glaettung, Landungs-Dip, Todeskamera
// ============================================================

import * as THREE from 'three';
import { Actor, PHYS } from './actor.js';
import { settings } from '../core/settings.js';
import { clamp, damp, lerp, rand } from '../core/utils.js';

const PITCH_LIMIT = Math.PI / 2 - 0.015;

export class LocalPlayer extends Actor {
  constructor(game, opts) {
    super(game, Object.assign({ isLocal: true }, opts));

    this.recoilAccP = 0;
    this.recoilAccY = 0;
    this.recoilQueueP = 0;      // noch nicht angewendeter Rueckstoss (wird weich verteilt)
    this.recoilQueueY = 0;
    this.punch = 0;             // sichtbarer Kamera-Kick (Feder, kehrt zurueck)
    this.punchV = 0;
    this.punchRoll = 0;
    this.punchRollV = 0;
    this.lastFireTime = -99;

    this.shake = 0;
    this.shakeDecay = 6;
    this.shakeOffset = new THREE.Vector3();

    this.viewRoll = 0;
    this.camBobPhase = 0;
    this.camBob = new THREE.Vector3();
    this.stepOffset = 0;        // Kamera-Glaettung bei Stufen
    this.landDip = 0;           // Kamera-Einknicken bei Landung

    this.thirdPerson = false;
    this.adsToggleState = false;
    this.crouchToggleState = false;
    this.sprintToggleState = false;

    this.lookDX = 0;
    this.lookDY = 0;

    this.deathCamT = 0;
    this.deathYaw = 0;
    this.killer = null;

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  addRecoil(v, h) {
    // Nicht sofort springen: der Rueckstoss wird in den naechsten ~50 ms
    // weich auf die Blickrichtung verteilt, dazu ein Kamera-Kick als Feder.
    this.recoilQueueP += v;
    this.recoilQueueY += h;
    this.punchV += v * 3.2;
    this.punchRollV += h * 2.2;
    this.lastFireTime = this.game.time;
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  /** Hook aus der Physik: Stufe hoch (+) oder Snap runter (-) */
  onStep(rise) {
    this.stepOffset = clamp(this.stepOffset - rise, -1.3, 1.3);
  }

  onLanded(impact) {
    if (impact > 6) this.landDip = Math.min(0.4, impact / 50);
  }

  onDeath(killer) {
    this.recoilQueueP = this.recoilQueueY = 0;
    this.punch = this.punchV = this.punchRoll = this.punchRollV = 0;
    this.deathCamT = 0;
    this.deathYaw = this.yaw;
    this.killer = killer && killer !== this ? killer : null;
  }

  // --------------------------------------------------------
  handleInput(input, dt) {
    const it = this.intent;

    // ---------- Maus ----------
    let sens = settings.sens * 0.0022;
    if (this.adsAmount > 0.01) {
      const w = this.weapon;
      const zoom = w.adsFov || 1;
      // Zoom-abhaengige Skalierung, damit ADS konsistent bleibt
      const scale = lerp(1, settings.adsSens * zoom / 0.9, this.adsAmount);
      sens *= clamp(scale, 0.12, 1.2);
    }

    const dx = input.dx;
    const dy = input.dy * (settings.invertY ? -1 : 1);
    // Delta sofort verbrauchen: handleInput laeuft 1x pro Frame,
    // die Physik danach ggf. in mehreren Teilschritten.
    input.dx = 0;
    input.dy = 0;

    this.lookDX = damp(this.lookDX, dx / Math.max(dt, 0.001) * 0.001, 20, dt);
    this.lookDY = damp(this.lookDY, dy / Math.max(dt, 0.001) * 0.001, 20, dt);

    if (this.alive) {
      this.yaw -= dx * sens;
      this.pitch -= dy * sens;
      // Ausstehenden Rueckstoss weich anwenden
      if (this.recoilQueueP !== 0 || this.recoilQueueY !== 0) {
        const k = 1 - Math.exp(-dt * 45);
        const dp = this.recoilQueueP * k, dyw = this.recoilQueueY * k;
        this.pitch += dp; this.yaw += dyw;
        this.recoilAccP += dp; this.recoilAccY += dyw;
        this.recoilQueueP -= dp; this.recoilQueueY -= dyw;
        if (Math.abs(this.recoilQueueP) < 1e-4) this.recoilQueueP = 0;
        if (Math.abs(this.recoilQueueY) < 1e-4) this.recoilQueueY = 0;
      }
      // Manuelle Rueckstosskompensation anrechnen
      if (dy > 0) this.recoilAccP = Math.max(0, this.recoilAccP - dy * sens);
      if (dx * this.recoilAccY < 0) {
        const c = Math.min(Math.abs(this.recoilAccY), Math.abs(dx * sens));
        this.recoilAccY -= Math.sign(this.recoilAccY) * c;
      }
    }
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
    while (this.yaw > Math.PI) this.yaw -= Math.PI * 2;
    while (this.yaw < -Math.PI) this.yaw += Math.PI * 2;

    // ---------- Rueckstoss-Erholung ----------
    if (this.alive && this.game.time - this.lastFireTime > 0.11) {
      const rate = (this.weapon.recoilRecover || 7) * dt;
      if (this.recoilAccP > 0) {
        const a = Math.min(this.recoilAccP, rate * 0.55);
        this.pitch -= a;
        this.recoilAccP -= a;
      }
      if (Math.abs(this.recoilAccY) > 0) {
        const a = Math.min(Math.abs(this.recoilAccY), rate * 0.35);
        this.yaw -= Math.sign(this.recoilAccY) * a;
        this.recoilAccY -= Math.sign(this.recoilAccY) * a;
      }
    }

    if (!this.alive) {
      it.fwd = it.side = 0;
      it.fire = it.jump = it.crouch = it.sprint = it.jumpPressed = false;
      it.ads = false;
      return;
    }

    // ---------- Tastatur ----------
    const f = (input.down('KeyW') || input.down('ArrowUp') ? 1 : 0) - (input.down('KeyS') || input.down('ArrowDown') ? 1 : 0);
    const s = (input.down('KeyD') || input.down('ArrowRight') ? 1 : 0) - (input.down('KeyA') || input.down('ArrowLeft') ? 1 : 0);
    it.fwd = f;
    it.side = s;

    if (input.justDown('Space')) it.jumpPressed = true;
    it.jump = input.down('Space');
    it.autoJump = !!settings.autoJump;

    // Sprint: halten / umschalten / immer
    const shift = input.down('ShiftLeft') || input.down('ShiftRight');
    if (settings.sprintMode === 'always') it.sprint = true;
    else if (settings.sprintMode === 'toggle') {
      if (input.justDown('ShiftLeft') || input.justDown('ShiftRight')) this.sprintToggleState = !this.sprintToggleState;
      if (f <= 0) this.sprintToggleState = false;
      it.sprint = this.sprintToggleState;
    } else it.sprint = shift;

    // Ducken: C immer, dazu die gewaehlte Zusatztaste
    const extra = settings.crouchKey === 'alt' ? ['AltLeft', 'AltRight'] : ['ControlLeft', 'ControlRight'];
    const crouchKey = input.down('KeyC') || input.down(extra[0]) || input.down(extra[1]);
    const crouchJust = input.justDown('KeyC') || input.justDown(extra[0]) || input.justDown(extra[1]);
    if (settings.toggleCrouch) {
      if (crouchJust) this.crouchToggleState = !this.crouchToggleState;
      it.crouch = this.crouchToggleState;
    } else {
      it.crouch = crouchKey;
      this.crouchToggleState = false;
    }

    // Zielen
    if (settings.toggleAds) {
      if (input.mouseJust(2)) this.adsToggleState = !this.adsToggleState;
      it.ads = this.adsToggleState;
    } else {
      it.ads = input.mouseDown(2);
      this.adsToggleState = false;
    }
    // Nahkampfwaffen: Rechtsklick ist der schwere Angriff (kein Umschalten)
    if (this.weapon.melee) { it.ads = input.mouseDown(2); this.adsToggleState = false; }

    it.fire = input.mouseDown(0);
    if (input.justDown('KeyR')) it.reload = true;
    if (input.justDown('KeyG')) it.nade = true;
    if (input.justDown('KeyF')) it.melee = true;

    // Waffenwechsel
    if (input.justDown('Digit1')) it.switchTo = 0;
    if (input.justDown('Digit2')) it.switchTo = 1;
    if (input.justDown('Digit3')) it.switchTo = 2;
    if (input.justDown('KeyQ')) it.switchTo = this.lastSlot;
    if (input.wheel !== 0) {
      const n = this.slots.length;
      it.switchTo = ((this.slot + (input.wheel > 0 ? 1 : -1)) % n + n) % n;
      input.wheel = 0;
    }

    if (input.justDown('KeyV')) {
      this.thirdPerson = !this.thirdPerson;
      settings.thirdPerson = this.thirdPerson;
    }
  }

  // --------------------------------------------------------
  update(dt, world) {
    this.updateWeapons(dt);
    this.updatePhysics(dt, world);

    // Shake abklingen
    this.shake = damp(this.shake, 0, this.shakeDecay, dt);
    const sh = this.shake * settings.shake;
    if (sh > 0.001) {
      this.shakeOffset.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(sh * 0.075);
    } else {
      this.shakeOffset.set(0, 0, 0);
    }

    // Kamera-Kick als gedaempfte Feder (kehrt weich zurueck)
    this.punchV += (-this.punch * 420 - this.punchV * 26) * dt;
    this.punch += this.punchV * dt;
    this.punchRollV += (-this.punchRoll * 300 - this.punchRollV * 22) * dt;
    this.punchRoll += this.punchRollV * dt;

    // Treppen-Glaettung und Landungs-Dip
    this.stepOffset = damp(this.stepOffset, 0, 16, dt);
    if (Math.abs(this.stepOffset) < 0.002) this.stepOffset = 0;
    this.landDip = damp(this.landDip, 0, 9, dt);

    // Kamerawackeln
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const bobScale = settings.viewBob * (1 - this.adsAmount * 0.75);
    if (this.grounded && hs > 1 && !this.sliding) this.camBobPhase += dt * hs * 1.1;
    const amp = clamp(hs / 11, 0, 1.1) * 0.03 * bobScale * (this.grounded && !this.sliding ? 1 : 0);
    this.camBob.x = damp(this.camBob.x, Math.cos(this.camBobPhase) * amp, 12, dt);
    this.camBob.y = damp(this.camBob.y, -Math.abs(Math.sin(this.camBobPhase)) * amp * 1.2, 12, dt);

    // Seitliche Neigung beim Strafen / Slide
    const strafeTilt = -this.intent.side * 0.02 * (this.grounded ? 1 : 0.6);
    const slideTilt = this.sliding ? 0.07 : 0;
    this.viewRoll = damp(this.viewRoll, strafeTilt + slideTilt, 9, dt);
  }

  // --------------------------------------------------------
  applyCamera(camera, world, dt) {
    if (!this.alive) { this._deathCamera(camera, world, dt); return; }

    const eyeY = this.pos.y + this.eyeHeight() + this.stepOffset - this.landDip * 0.6;
    this._camTarget.set(this.pos.x, eyeY, this.pos.z);
    this._camTarget.y += this.camBob.y;

    // Seitliche Bob-Verschiebung im Kamerakoordinatensystem
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    this._camTarget.x += cosY * this.camBob.x;
    this._camTarget.z += -sinY * this.camBob.x;

    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch - this.landDip * 0.25 + this.punch * settings.shake;
    camera.rotation.z = this.viewRoll + this.punchRoll * 0.5 * settings.shake;

    if (this.thirdPerson || settings.thirdPerson) {
      const dist = 5.5;
      const dir = this._v.set(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      let d = dist;
      const hit = world.raycast(
        this._camTarget.x, this._camTarget.y, this._camTarget.z,
        -dir.x, -dir.y, -dir.z, dist + 0.4
      );
      if (hit) d = Math.max(0.6, hit.t - 0.35);
      camera.position.set(
        this._camTarget.x - dir.x * d,
        this._camTarget.y - dir.y * d + 0.4,
        this._camTarget.z - dir.z * d
      );
    } else {
      camera.position.copy(this._camTarget);
    }

    camera.position.add(this.shakeOffset);
  }

  /** Orbit-Kamera um die eigene Leiche, Blick auf den Killer */
  _deathCamera(camera, world, dt) {
    this.deathCamT += dt;
    const ang = this.deathYaw + this.deathCamT * 0.3;
    const cx = this.pos.x, cy = this.pos.y + 1.0, cz = this.pos.z;
    const dist = 5.2;
    const ox = Math.sin(ang) * dist, oz = Math.cos(ang) * dist, oy = 2.4;
    const l = Math.hypot(ox, oy, oz);
    let d = l;
    const hit = world.raycast(cx, cy, cz, ox / l, oy / l, oz / l, l + 0.3);
    if (hit) d = Math.max(0.8, hit.t - 0.35);
    camera.position.set(cx + ox / l * d, cy + oy / l * d, cz + oz / l * d);

    const k = this.killer;
    if (k && k.alive) {
      this._look.set(k.pos.x, k.pos.y + 1.6, k.pos.z);
      // Mischung: erst Leiche, dann langsam zum Killer schwenken
      const t = clamp(this.deathCamT / 1.2, 0, 1);
      this._look.lerp(this._v2.set(cx, cy, cz), 1 - t);
    } else {
      this._look.set(cx, cy, cz);
    }
    camera.rotation.order = 'YXZ';
    camera.lookAt(this._look);
    camera.rotation.z = 0;
  }

  /** Sicht-FOV inkl. ADS und Sprint-Bonus */
  targetFov() {
    const base = settings.fov;
    const w = this.weapon;
    const adsF = base * (w.adsFov || 1);
    let fov = lerp(base, adsF, this.adsAmount);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const maxS = PHYS.BASE_SPEED * this.speedMult * PHYS.SPRINT_MULT;
    const over = clamp((hs - PHYS.BASE_SPEED * 0.9) / Math.max(1, maxS), 0, 1.4);
    fov += over * 9 * (1 - this.adsAmount);
    if (this.sliding) fov += 4 * (1 - this.adsAmount);
    return fov;
  }
}
