// ============================================================
// Lokaler Spieler: Eingabe -> Intent, Kamera, Rueckstoss, Shake
// ============================================================

import * as THREE from 'three';
import { Actor, PHYS } from './actor.js';
import { settings } from '../core/settings.js';
import { clamp, damp, lerp, rand, deg } from '../core/utils.js';

const PITCH_LIMIT = Math.PI / 2 - 0.015;

export class LocalPlayer extends Actor {
  constructor(game, opts) {
    super(game, Object.assign({ isLocal: true }, opts));

    this.recoilAccP = 0;
    this.recoilAccY = 0;
    this.lastFireTime = -99;

    this.shake = 0;
    this.shakeDecay = 6;
    this.shakeOffset = new THREE.Vector3();

    this.viewRoll = 0;
    this.camBobPhase = 0;
    this.camBob = new THREE.Vector3();

    this.thirdPerson = false;
    this.adsToggleState = false;
    this.crouchToggleState = false;

    this.lookDX = 0;
    this.lookDY = 0;

    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._camTarget = new THREE.Vector3();
  }

  addRecoil(v, h) {
    this.pitch += v;
    this.yaw += h;
    this.recoilAccP += v;
    this.recoilAccY += h;
    this.lastFireTime = this.game.time;
    this.pitch = clamp(this.pitch, -PITCH_LIMIT, PITCH_LIMIT);
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
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

    this.yaw -= dx * sens;
    this.pitch -= dy * sens;

    if (this.alive) {
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
    if (this.game.time - this.lastFireTime > 0.11) {
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
      it.fire = it.jump = it.crouch = it.sprint = false;
      return;
    }

    // ---------- Tastatur ----------
    const f = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const s = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    it.fwd = f;
    it.side = s;

    if (input.justDown('Space')) it.jumpPressed = true;
    it.jump = input.down('Space');
    it.sprint = input.down('ShiftLeft') || input.down('ShiftRight');

    // Ducken (Halten oder Umschalten)
    const crouchKey = input.down('ControlLeft') || input.down('KeyC');
    if (settings.toggleCrouch) {
      if (input.justDown('ControlLeft') || input.justDown('KeyC')) this.crouchToggleState = !this.crouchToggleState;
      it.crouch = this.crouchToggleState;
    } else {
      it.crouch = crouchKey;
    }

    // Zielen
    if (settings.toggleAds) {
      if (input.mouseJust(2)) this.adsToggleState = !this.adsToggleState;
      it.ads = this.adsToggleState;
    } else {
      it.ads = input.mouseDown(2);
      this.adsToggleState = false;
    }
    if (this.weapon.melee) it.ads = false;

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

    // Kamerawackeln
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const bobScale = settings.viewBob * (1 - this.adsAmount * 0.75);
    if (this.grounded && hs > 1) this.camBobPhase += dt * hs * 1.15;
    const amp = clamp(hs / 11, 0, 1.1) * 0.035 * bobScale * (this.grounded ? 1 : 0);
    this.camBob.x = damp(this.camBob.x, Math.cos(this.camBobPhase) * amp, 12, dt);
    this.camBob.y = damp(this.camBob.y, -Math.abs(Math.sin(this.camBobPhase)) * amp * 1.2, 12, dt);

    // Seitliche Neigung beim Strafen
    const strafeTilt = -this.intent.side * 0.022 * (this.grounded ? 1 : 0.6);
    const slideTilt = this.sliding ? 0.075 : 0;
    this.viewRoll = damp(this.viewRoll, strafeTilt + slideTilt, 9, dt);
  }

  // --------------------------------------------------------
  applyCamera(camera, world, dt) {
    const eyeY = this.pos.y + this.eyeHeight();
    this._camTarget.set(this.pos.x, eyeY, this.pos.z);
    this._camTarget.y += this.camBob.y;

    // Seitliche Bob-Verschiebung im Kamerakoordinatensystem
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    this._camTarget.x += cosY * this.camBob.x;
    this._camTarget.z += -sinY * this.camBob.x;

    camera.rotation.order = 'YXZ';
    camera.rotation.y = this.yaw;
    camera.rotation.x = this.pitch;
    camera.rotation.z = this.viewRoll;

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
    return fov;
  }
}
