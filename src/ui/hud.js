// ============================================================
// HUD: Fadenkreuz, Balken, Killfeed, Schadenszahlen, Scoreboard
// DOM-Schreibzugriffe passieren nur, wenn sich ein Wert aendert.
// ============================================================

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, formatTime } from '../core/utils.js';
import { drawCrosshair, crosshairKey } from './crosshair.js';
import { MODE_BY_ID } from '../game/modes.js';

const $ = (id) => document.getElementById(id);
const CROSS_PX = 160;
const TEAM_NAME = { red: 'ROT', blue: 'BLAU' };

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      cross: $('crosshair'),
      hitmarker: $('hitmarker'),
      trainHud: $('train-hud'), trName: $('tr-name'), trStats: $('tr-stats'), trMsg: $('tr-msg'),
      scope: $('scope'),
      dmgVig: $('dmg-vignette'),
      dmgDirs: $('dmg-dirs'),
      popups: $('popups'),
      hpBar: $('hp-bar'), hpGhost: $('hp-bar-ghost'), hpText: $('hp-text'),
      apBar: $('ap-bar'), apText: $('ap-text'), apLine: $('armor-line'),
      wpnName: $('wpn-name'), ammo: $('ammo'),
      ammoMag: $('ammo-mag'), ammoRes: $('ammo-res'),
      reloadHint: $('reload-hint'),
      reloadWrap: $('reload-bar-wrap'), reloadBar: $('reload-bar'),
      slots: $('slots'),
      nadeCount: $('nade-count'),
      killfeed: $('killfeed'),
      scoreRed: $('score-red'), scoreBlue: $('score-blue'), timer: $('timer'),
      toasts: $('toasts'),
      minimapWrap: $('minimap-wrap'),
      ksLine: $('ks-line'), ksCount: $('ks-count'),
      stK: $('st-k'), stD: $('st-d'), stS: $('st-s'),
      scoreboard: $('scoreboard'),
      sbRed: $('sb-red-list'), sbBlue: $('sb-blue-list'),
      sbRedScore: $('sb-red-score'), sbBlueScore: $('sb-blue-score'),
      sbMode: $('sb-mode'), sbMap: $('sb-map'),
      death: $('deathscreen'), deathBy: $('death-by'), respawnT: $('respawn-t'),
      perf: $('perf'),
      clickHint: $('click-hint'),
      speedo: $('speedo'),
      killcam: $('killcam'), killcamName: $('killcam-name'),
      dashInd: $('dash-ind'), dashFill: $('dash-fill'),
      teamRed: document.querySelector('#matchbar .t-red'), teamBlue: document.querySelector('#matchbar .t-blue'),
      objHud: $('obj-hud'), objLine: $('obj-line'), objSub: $('obj-sub'),
      streaks: $('streaks'), board: $('ffa-board'), carry: $('carry-banner'),
      prompt: $('prompt'), chat: $('chat'),
      replay: $('replay-bar'), rpTime: $('rp-time'), rpFill: $('rp-fill'), rpSpeed: $('rp-speed'), rpState: $('rp-state'),
    };
    this.chatItems = [];
    this.slotEls = Array.from(document.querySelectorAll('#slots .slot'));

    this.popups = [];
    this.popupPool = [];
    this.dmgDirs = [];
    this.killfeedItems = [];
    this.toastItems = [];

    this._v = new THREE.Vector3();
    this._hpGhost = 1;
    this._lastCross = '';
    this._crossHidden = null;
    this._c = {};            // Cache fuer zuletzt geschriebene DOM-Werte
    this._perfShown = false;
    this._perfText = '';

    // Fadenkreuz als Canvas (unterstuetzt Kreis, X, T, Punkt ...)
    this._crossCtx = null;
    this._crossDpr = 1;
    if (this.el.cross && this.el.cross.getContext) {
      this._crossDpr = Math.min(2, window.devicePixelRatio || 1);
      this.el.cross.width = CROSS_PX * this._crossDpr;
      this.el.cross.height = CROSS_PX * this._crossDpr;
      this._crossCtx = this.el.cross.getContext('2d');
    }
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  /** Setzt einen Textinhalt nur, wenn er sich geaendert hat */
  _txt(key, el, value) {
    if (this._c[key] === value) return;
    this._c[key] = value;
    el.textContent = value;
  }
  _style(key, el, prop, value) {
    if (this._c[key] === value) return;
    this._c[key] = value;
    el.style[prop] = value;
  }
  _cls(key, el, cls, on) {
    if (this._c[key] === on) return;
    this._c[key] = on;
    el.classList.toggle(cls, on);
  }

  // --------------------------------------------------------
  // Fadenkreuz
  // --------------------------------------------------------
  updateCrosshair(spreadPx, hidden, hitTint) {
    const c = this.el;
    if (this._crossHidden !== hidden) {
      this._crossHidden = hidden;
      c.cross.style.display = hidden ? 'none' : '';
    }
    if (hidden || !this._crossCtx) return;

    const key = crosshairKey(settings, spreadPx, !!hitTint);
    if (key !== this._lastCross) {
      this._lastCross = key;
      const ctx = this._crossCtx;
      const dpr = this._crossDpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCrosshair(ctx, CROSS_PX, CROSS_PX, settings, spreadPx, !!hitTint);
    }
  }

  setScope(on) { this._cls('scope', this.el.scope, 'hidden', !on); }

  hitmarker(kind) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;          // Reflow -> Animation neu starten
    if (kind === 'kill') h.classList.add('kill');
    h.classList.add('show');
  }

  // --------------------------------------------------------
  // Status
  // --------------------------------------------------------
  updateStatus(p, dt) {
    const e = this.el;
    const f = clamp(p.hp / p.maxHp, 0, 1);
    this._style('hpW', e.hpBar, 'width', (Math.round(f * 1000) / 10) + '%');
    this._cls('hpLow', e.hpBar, 'low', f < 0.34);
    this._txt('hpT', e.hpText, String(Math.max(0, Math.ceil(p.hp))));

    // "Geister"-Balken laeuft verzoegert nach
    this._hpGhost = Math.max(f, this._hpGhost - dt * (this._hpGhost > f ? 0.55 : 0));
    if (this._hpGhost < f) this._hpGhost = f;
    this._style('hpG', e.hpGhost, 'width', (Math.round(this._hpGhost * 1000) / 10) + '%');

    const showArmor = p.maxArmor > 0 || p.armor > 0;
    this._style('apD', e.apLine, 'display', showArmor ? '' : 'none');
    if (showArmor) {
      const af = clamp(p.armor / Math.max(1, p.maxArmor), 0, 1);
      this._style('apW', e.apBar, 'width', (Math.round(af * 1000) / 10) + '%');
      this._txt('apT', e.apText, String(Math.max(0, Math.ceil(p.armor))));
    }

    if (e.speedo) {
      const spd = Math.hypot(p.vel.x, p.vel.z);
      this._txt('spd', e.speedo, spd.toFixed(1) + ' u/s');
    }
  }

  updateWeapon(p) {
    const e = this.el;
    const w = p.weapon;
    const s = p.ammo;
    this._txt('wn', e.wpnName, w.name.toUpperCase());
    if (s.mag === Infinity) {
      this._txt('mag', e.ammoMag, '∞');
      this._txt('res', e.ammoRes, '');
      this._cls('empty', e.ammo, 'empty', false);
    } else {
      this._txt('mag', e.ammoMag, String(s.mag));
      this._txt('res', e.ammoRes, String(s.reserve));
      this._cls('empty', e.ammo, 'empty', s.mag <= 0);
    }
    const needReload = s.mag !== Infinity && s.mag <= 0 && s.reserve > 0 && p.reloadTimer <= 0;
    this._cls('rh', e.reloadHint, 'hidden', !needReload);

    const reloading = p.reloadTimer > 0;
    this._cls('rw', e.reloadWrap, 'hidden', !reloading);
    if (reloading) {
      const prog = 1 - p.reloadTimer / Math.max(0.01, p.reloadTotal);
      this._style('rb', e.reloadBar, 'width', Math.round(prog * 100) + '%');
    }

    for (let i = 0; i < this.slotEls.length; i++) {
      const el = this.slotEls[i];
      if (i < p.slots.length) {
        this._cls('sa' + i, el, 'active', i === p.slot);
        const sl = p.slots[i];
        this._txt('sn' + i, el.querySelector('span'), sl.w.short);
        this._cls('se' + i, el, 'empty', sl.mag !== Infinity && sl.mag <= 0 && sl.reserve <= 0);
      }
    }
    this._txt('nc', e.nadeCount, String(p.nades));
    this._cls('ne', this.slotEls[3], 'empty', p.nades <= 0);
  }

  /** Dash-Anzeige: nur fuer Klassen mit Dash, Balken = Abklingzeit */
  updateDash(p, cooldownMax) {
    const e = this.el;
    if (!e.dashInd) return;
    this._cls('dashHidden', e.dashInd, 'hidden', !p.canDash);
    if (!p.canDash) return;
    const f = cooldownMax > 0 ? clamp(1 - p.dashCooldown / cooldownMax, 0, 1) : 1;
    this._style('dashW', e.dashFill, 'width', Math.round(f * 100) + '%');
    this._cls('dashReady', e.dashInd, 'ready', f >= 1);
  }

  /** Killcam-Banner (name = null blendet aus) */
  setKillcam(name) {
    const e = this.el;
    if (!e.killcam) return;
    this._cls('kc', e.killcam, 'hidden', !name);
    if (name) this._txt('kcn', e.killcamName, name);
  }

  /** Trainings-Anzeige (name = null blendet aus) */
  setTraining(name) {
    const e = this.el;
    if (!e.trainHud) return;
    this._cls('trH', e.trainHud, 'hidden', !name);
    if (name) this._txt('trN', e.trName, name);
    // Im Training keine Kill-/Score-Zeile
    if (e.stK) this._cls('trStat', e.stK.parentElement, 'hidden', !!name);
  }
  updateTraining(stats, msg) {
    const e = this.el;
    if (!e.trainHud) return;
    this._txt('trS', e.trStats, stats || '');
    this._txt('trM', e.trMsg, msg || '');
    this._cls('trMH', e.trMsg, 'hidden', !msg);
  }

  updateStats(p) {
    this._txt('k', this.el.stK, String(p.kills));
    this._txt('d', this.el.stD, String(p.deaths));
    this._txt('s', this.el.stS, String(p.score));
    this._cls('ks', this.el.ksLine, 'hidden', p.streak < 2);
    this._txt('ksc', this.el.ksCount, String(p.streak));
  }

  updateMatch(mode, redScore, blueScore, timeLeft) {
    const e = this.el;
    const ffa = mode === 'ffa' || mode === 'training' || mode === 'gungame';
    this._style('tr', e.scoreRed.parentElement, 'display', ffa ? 'none' : '');
    this._style('tb', e.scoreBlue.parentElement, 'display', ffa ? 'none' : '');
    if (!ffa) {
      this._txt('sr', e.scoreRed, String(redScore));
      this._txt('sb', e.scoreBlue, String(blueScore));
    }
    this._txt('tm', e.timer, formatTime(timeLeft));
    this._cls('tu', e.timer, 'urgent', timeLeft <= 30);
  }

  /** Eigenes Team in der Match-Leiste markieren ("DU"), null = kein Teammodus */
  setMyTeam(team) {
    const e = this.el;
    if (!e.teamRed || !e.teamBlue) return;
    this._cls('mtR', e.teamRed, 'mine', team === 'red');
    this._cls('mtB', e.teamBlue, 'mine', team === 'blue');
    if (e.hud) {
      this._cls('hudR', e.hud, 'team-red', team === 'red');
      this._cls('hudB', e.hud, 'team-blue', team === 'blue');
    }
  }

  /** Missionsziel-Zeile (CTF/Hardpoint/Gun Game); o = {line, sub, carry, inZone} oder null */
  updateObjective(o) {
    const e = this.el;
    if (!e.objHud) return;
    this._cls('objH', e.objHud, 'hidden', !o);
    if (!o) { if (e.carry) this._cls('carryH', e.carry, 'hidden', true); return; }
    this._txt('objL', e.objLine, o.line || '');
    this._txt('objS', e.objSub, o.sub || '');
    this._cls('objZ', e.objHud, 'inzone', !!o.inZone);
    if (e.carry) this._cls('carryH', e.carry, 'hidden', !o.carry);
  }

  /** Replay-Leiste */
  showReplay(v) { if (this.el.replay) this.el.replay.classList.toggle('hidden', !v); }
  updateReplay(t, total, speed, paused) {
    const e = this.el;
    if (!e.replay) return;
    this._txt('rpT', e.rpTime, formatTime(t) + ' / ' + formatTime(total));
    this._style('rpF', e.rpFill, 'width', (total > 0 ? Math.round(t / total * 1000) / 10 : 0) + '%');
    this._txt('rpS', e.rpSpeed, speed + '×');
    this._txt('rpP', e.rpState, paused ? 'PAUSE' : 'REPLAY');
  }

  /** Interaktions-Hinweis unter dem Fadenkreuz ('' blendet aus) */
  setPrompt(text) {
    const e = this.el;
    if (!e.prompt) return;
    this._cls('prH', e.prompt, 'hidden', !text);
    if (text) e.prompt.innerHTML = '<b>E</b> ' + escapeHtml(text);
  }

  /** Chat-Zeile (Bots): name in Teamfarbe, Text */
  chat(name, text, team, isMe) {
    const e = this.el;
    if (!e.chat) return;
    const div = document.createElement('div');
    div.className = 'chat-line';
    const cls = team === 'red' ? 'n-red' : team === 'blue' ? 'n-blue' : '';
    div.innerHTML = `<span class="${cls}${isMe ? ' n-me' : ''}">${escapeHtml(name)}</span>: ${escapeHtml(text)}`;
    e.chat.appendChild(div);
    this.chatItems.push({ el: div, t: 9 });
    while (this.chatItems.length > 6) { const o = this.chatItems.shift(); o.el.remove(); }
  }

  /** Aktive Killstreak-Belohnungen */
  updateStreaks(p, time) {
    const e = this.el;
    if (!e.streaks) return;
    if (!p) { this._txt('stk', e.streaks, ''); this._cls('stkH', e.streaks, 'hidden', true); return; }
    const parts = [];
    if (p.uavUntil > time) parts.push('UAV ' + Math.ceil(p.uavUntil - time) + 's');
    if (p.shield > 0) parts.push('SCHILD ' + Math.ceil(p.shield));
    if (p.airstrikes > 0) parts.push('LUFTSCHLAG [4]' + (p.airstrikes > 1 ? ' ×' + p.airstrikes : ''));
    const txt = parts.join('  ·  ');
    this._txt('stk', e.streaks, txt);
    this._cls('stkH', e.streaks, 'hidden', !txt);
  }

  /** Bestenliste (FFA / Gun Game): Top 3 + eigener Platz */
  updateBoard(game) {
    const e = this.el;
    if (!e.board) return;
    if (!game) { this._cls('bdH', e.board, 'hidden', true); return; }
    this._cls('bdH', e.board, 'hidden', false);
    const gg = game.mode === 'gungame';
    const sorted = game.actors.slice().sort((a, b) => (gg ? b.ggLevel - a.ggLevel : 0) || b.kills - a.kills || b.score - a.score);
    const me = game.player;
    const rank = sorted.indexOf(me) + 1;
    const val = (a) => gg ? 'ST ' + (a.ggLevel + 1) : a.kills;
    let html = '';
    for (let i = 0; i < Math.min(3, sorted.length); i++) {
      const a = sorted[i];
      html += `<div class="bd-row${a === me ? ' me' : ''}"><span>${i + 1}.</span><span class="nm">${escapeHtml(a.name)}</span><b>${val(a)}</b></div>`;
    }
    if (rank > 3) html += `<div class="bd-row me"><span>${rank}.</span><span class="nm">${escapeHtml(me.name)}</span><b>${val(me)}</b></div>`;
    if (this._c.bdHtml !== html) { this._c.bdHtml = html; e.board.innerHTML = html; }
  }

  // --------------------------------------------------------
  // Killfeed
  // --------------------------------------------------------
  addKillfeed(killerName, killerTeam, victimName, victimTeam, weaponName, headshot, isMe, isSuicide, icon) {
    const div = document.createElement('div');
    div.className = 'kf';
    const cls = (t) => (t === 'red' ? 'n-red' : t === 'blue' ? 'n-blue' : '');
    const me = (b) => (b ? ' n-me' : '');
    const ico = icon ? `<span class="kf-ico">${escapeHtml(icon)}</span>` : '';

    if (isSuicide) {
      div.innerHTML =
        `<span class="${cls(victimTeam)}${me(isMe)}">${escapeHtml(victimName)}</span>` +
        `<span class="kf-w">${escapeHtml(weaponName)}</span>`;
    } else {
      div.innerHTML =
        `<span class="${cls(killerTeam)}${me(isMe === 'killer')}">${escapeHtml(killerName)}</span>` +
        ico +
        `<span class="kf-w">${escapeHtml(weaponName)}</span>` +
        (headshot ? '<span class="kf-hs">HS</span>' : '') +
        `<span class="${cls(victimTeam)}${me(isMe === 'victim')}">${escapeHtml(victimName)}</span>`;
    }

    this.el.killfeed.appendChild(div);
    const item = { el: div, t: 6 };
    this.killfeedItems.push(item);
    while (this.killfeedItems.length > 6) {
      const old = this.killfeedItems.shift();
      old.el.remove();
    }
  }

  toast(text, small, team) {
    const div = document.createElement('div');
    div.className = 'toast' + (small ? ' small' : '') + (team ? ' t-' + team : '');
    div.textContent = text;
    this.el.toasts.appendChild(div);
    this.toastItems.push({ el: div, t: small ? 1.8 : 2.4 });
    while (this.toastItems.length > 4) {
      const o = this.toastItems.shift();
      o.el.remove();
    }
  }

  // --------------------------------------------------------
  // Schadenszahlen
  // --------------------------------------------------------
  popup(x, y, z, text, kind) {
    if (!settings.showDmg) return;
    let el = this.popupPool.pop();
    if (!el) { el = document.createElement('div'); }
    el.className = 'popup' + (kind ? ' ' + kind : '');
    el.textContent = text;
    el.style.opacity = '1';
    el.style.display = '';
    this.el.popups.appendChild(el);
    this.popups.push({ el, x, y, z, t: 0, life: 1.0, ox: (Math.random() - 0.5) * 26 });
  }

  /** Trefferrichtungs-Anzeige */
  damageDir(angleRad) {
    const wrap = document.createElement('div');
    wrap.className = 'dmg-dir';
    wrap.style.transform = `rotate(${angleRad}rad)`;
    wrap.innerHTML = '<i></i>';
    this.el.dmgDirs.appendChild(wrap);
    this.dmgDirs.push({ el: wrap, t: 1.1 });
    while (this.dmgDirs.length > 8) { const o = this.dmgDirs.shift(); o.el.remove(); }
  }

  damageFlash(intensity) {
    this.el.dmgVig.style.opacity = String(clamp(intensity, 0, 0.9));
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => { this.el.dmgVig.style.opacity = '0'; }, 90);
  }

  // --------------------------------------------------------
  updateFloating(dt, camera) {
    // Schadenszahlen
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt;
      if (p.t >= p.life) {
        p.el.remove();
        if (this.popupPool.length < 40) this.popupPool.push(p.el);
        this.popups.splice(i, 1);
        continue;
      }
      this._v.set(p.x, p.y + p.t * 1.1, p.z).project(camera);
      if (this._v.z > 1) { p.el.style.display = 'none'; continue; }
      p.el.style.display = '';
      const sx = (this._v.x * 0.5 + 0.5) * W + p.ox;
      const sy = (-this._v.y * 0.5 + 0.5) * H;
      const k = p.t / p.life;
      p.el.style.transform = `translate(-50%,-50%) translate(${sx.toFixed(1)}px, ${(sy - k * 22).toFixed(1)}px) scale(${(1 + (1 - k) * 0.25).toFixed(3)})`;
      p.el.style.opacity = String(clamp(1 - k * k, 0, 1));
    }

    // Killfeed
    for (let i = this.killfeedItems.length - 1; i >= 0; i--) {
      const k = this.killfeedItems[i];
      k.t -= dt;
      if (k.t < 0.5) k.el.classList.add('fade');
      if (k.t <= 0) { k.el.remove(); this.killfeedItems.splice(i, 1); }
    }

    // Toasts
    for (let i = this.toastItems.length - 1; i >= 0; i--) {
      const t = this.toastItems[i];
      t.t -= dt;
      if (t.t < 0.6) t.el.classList.add('fade');
      if (t.t <= 0) { t.el.remove(); this.toastItems.splice(i, 1); }
    }

    // Chat
    for (let i = this.chatItems.length - 1; i >= 0; i--) {
      const c = this.chatItems[i];
      c.t -= dt;
      if (c.t < 1) c.el.classList.add('fade');
      if (c.t <= 0) { c.el.remove(); this.chatItems.splice(i, 1); }
    }

    // Trefferrichtungen
    for (let i = this.dmgDirs.length - 1; i >= 0; i--) {
      const d = this.dmgDirs[i];
      d.t -= dt;
      d.el.style.opacity = String(clamp(d.t / 1.1, 0, 1));
      if (d.t <= 0) { d.el.remove(); this.dmgDirs.splice(i, 1); }
    }
  }

  clearFloating() {
    for (const p of this.popups) p.el.remove();
    this.popups.length = 0;
    for (const k of this.killfeedItems) k.el.remove();
    this.killfeedItems.length = 0;
    for (const t of this.toastItems) t.el.remove();
    this.toastItems.length = 0;
    for (const d of this.dmgDirs) d.el.remove();
    this.dmgDirs.length = 0;
    for (const c of this.chatItems) c.el.remove();
    this.chatItems.length = 0;
    this._c = {};
    this._lastCross = '';
    this._crossHidden = null;
  }

  // --------------------------------------------------------
  // Todesbildschirm
  // --------------------------------------------------------
  showDeath(killerName, weaponName, killerHp, t) {
    this.el.death.classList.remove('hidden');
    if (killerName) {
      this.el.deathBy.innerHTML =
        `Getötet von <b>${escapeHtml(killerName)}</b> mit <b>${escapeHtml(weaponName)}</b>` +
        (killerHp !== null && killerHp !== undefined ? ` &middot; noch ${Math.ceil(killerHp)} HP` : '');
    } else {
      this.el.deathBy.textContent = weaponName || '';
    }
    const timerEl = this.el.respawnT.parentElement;
    if (!isFinite(t) || t > 1000) {
      timerEl.innerHTML = 'Zuschauer bis zum Rundenende';
      this._noRespawnTimer = true;
    } else {
      if (this._noRespawnTimer) { timerEl.innerHTML = 'Respawn in <span id="respawn-t">3.0</span>s'; this.el.respawnT = $('respawn-t'); this._noRespawnTimer = false; }
      this.el.respawnT.textContent = t.toFixed(1);
    }
  }
  updateDeathTimer(t) { if (!this._noRespawnTimer && t < 1000) this._txt('rt', this.el.respawnT, Math.max(0, t).toFixed(1)); }
  hideDeath() { this.el.death.classList.add('hidden'); }

  // --------------------------------------------------------
  // Scoreboard
  // --------------------------------------------------------
  showScoreboard(v) { this.el.scoreboard.classList.toggle('hidden', !v); }

  renderScoreboard(game) {
    const e = this.el;
    e.sbMode.textContent = game.mode === 'training' ? 'TRAINING' : (MODE_BY_ID[game.mode] ? MODE_BY_ID[game.mode].name.toUpperCase() : 'TEAM DEATHMATCH');
    e.sbMap.textContent = game.world ? game.world.map.name : '';

    const rows = (list) => list.map((a) => {
      const pingCls = a.ping < 60 ? 'ping-good' : 'ping-bad';
      return `<div class="sb-row${a.isLocal ? ' me' : ''}${a.alive ? '' : ' dead'}">` +
        `<span class="nm">${escapeHtml(a.name)}</span>` +
        `<span>${a.kills}</span><span>${a.deaths}</span><span>${a.score}</span>` +
        `<span class="${pingCls}">${a.ping}</span></div>`;
    }).join('');

    const sortFn = (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths;

    if (!game.teamMode || game.mode === 'training') {
      const all = game.actors.slice().sort(sortFn);
      document.querySelector('.sb-team.blue').style.display = 'none';
      document.querySelector('.sb-team.red').classList.add('ffa');
      document.querySelector('.sb-team.red .sb-team-head').innerHTML =
        `RANGLISTE <span>${all.length} Spieler</span>`;
      e.sbRed.innerHTML = rows(all);
    } else {
      document.querySelector('.sb-team.blue').style.display = '';
      document.querySelector('.sb-team.red').classList.remove('ffa');
      const mine = game.player ? game.player.team : null;
      const nameR = game.teamName ? game.teamName('red') : 'ROT', nameB = game.teamName ? game.teamName('blue') : 'BLAU';
      document.querySelector('.sb-team.red .sb-team-head').innerHTML =
        `${nameR}${mine === 'red' ? ' <i class="you">DEIN TEAM</i>' : ''} <span id="sb-red-score">${game.scores.red}</span>`;
      document.querySelector('.sb-team.blue .sb-team-head').innerHTML =
        `${nameB}${mine === 'blue' ? ' <i class="you">DEIN TEAM</i>' : ''} <span id="sb-blue-score">${game.scores.blue}</span>`;
      const red = game.actors.filter(a => a.team === 'red').sort(sortFn);
      const blue = game.actors.filter(a => a.team === 'blue').sort(sortFn);
      e.sbRed.innerHTML = rows(red);
      e.sbBlue.innerHTML = rows(blue);
    }
  }

  // --------------------------------------------------------
  setPerf(text, show) {
    if (this._perfShown !== show) {
      this._perfShown = show;
      this.el.perf.classList.toggle('hidden', !show);
    }
    if (show && text !== this._perfText) {
      this._perfText = text;
      this.el.perf.textContent = text;
    }
  }

  setMinimapVisible(v) { this.el.minimapWrap.classList.toggle('hidden', !v); }
  setClickHint(v) { this.el.clickHint.classList.toggle('hidden', !v); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
