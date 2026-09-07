// ============================================================
// HUD: Fadenkreuz, Balken, Killfeed, Schadenszahlen, Scoreboard
// ============================================================

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, formatTime, lerp, damp } from '../core/utils.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'),
      cross: $('crosshair'),
      chT: document.querySelector('#crosshair .ch-t'),
      chB: document.querySelector('#crosshair .ch-b'),
      chL: document.querySelector('#crosshair .ch-l'),
      chR: document.querySelector('#crosshair .ch-r'),
      chDot: document.querySelector('#crosshair .ch-dot'),
      hitmarker: $('hitmarker'),
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
    };
    this.slotEls = Array.from(document.querySelectorAll('#slots .slot'));

    this.popups = [];
    this.popupPool = [];
    this.dmgDirs = [];
    this.killfeedItems = [];
    this.toastItems = [];

    this._v = new THREE.Vector3();
    this._hpGhost = 1;
    this._spread = 0;
    this._lastHp = 100;
    this._sbDirty = true;
    this._lastCross = '';
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  // --------------------------------------------------------
  // Fadenkreuz
  // --------------------------------------------------------
  updateCrosshair(spreadPx, hidden, hitTint) {
    const c = this.el;
    if (hidden) { c.cross.style.display = 'none'; return; }
    c.cross.style.display = '';

    const size = settings.crossSize;
    const gap = settings.crossGap + spreadPx;
    const col = settings.crossColor;

    const key = size + '|' + Math.round(gap * 2) + '|' + col + '|' + settings.crossDot;
    if (key !== this._lastCross) {
      this._lastCross = key;
      c.chT.style.height = size + 'px'; c.chB.style.height = size + 'px';
      c.chL.style.width = size + 'px'; c.chR.style.width = size + 'px';
      c.chT.style.bottom = gap + 'px'; c.chB.style.top = gap + 'px';
      c.chL.style.right = gap + 'px'; c.chR.style.left = gap + 'px';
      for (const e of [c.chT, c.chB, c.chL, c.chR]) e.style.background = col;
      c.chDot.style.background = col;
      c.chDot.style.display = settings.crossDot ? '' : 'none';
    }
    c.cross.classList.toggle('hit', !!hitTint);
  }

  setScope(on) { this.el.scope.classList.toggle('hidden', !on); }

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
    e.hpBar.style.width = (f * 100) + '%';
    e.hpBar.classList.toggle('low', f < 0.34);
    e.hpText.textContent = Math.max(0, Math.ceil(p.hp));

    // "Geister"-Balken laeuft verzoegert nach
    this._hpGhost = Math.max(f, this._hpGhost - dt * (this._hpGhost > f ? 0.55 : 0));
    if (this._hpGhost < f) this._hpGhost = f;
    e.hpGhost.style.width = (this._hpGhost * 100) + '%';

    const showArmor = p.maxArmor > 0 || p.armor > 0;
    e.apLine.style.display = showArmor ? '' : 'none';
    if (showArmor) {
      const af = clamp(p.armor / Math.max(1, p.maxArmor), 0, 1);
      e.apBar.style.width = (af * 100) + '%';
      e.apText.textContent = Math.max(0, Math.ceil(p.armor));
    }
  }

  updateWeapon(p) {
    const e = this.el;
    const w = p.weapon;
    const s = p.ammo;
    e.wpnName.textContent = w.name.toUpperCase();
    if (s.mag === Infinity) {
      e.ammoMag.textContent = '∞';
      e.ammoRes.textContent = '';
      e.ammo.classList.remove('empty');
    } else {
      e.ammoMag.textContent = s.mag;
      e.ammoRes.textContent = s.reserve;
      e.ammo.classList.toggle('empty', s.mag <= 0);
    }
    const needReload = s.mag !== Infinity && s.mag <= 0 && s.reserve > 0 && p.reloadTimer <= 0;
    e.reloadHint.classList.toggle('hidden', !needReload);

    const reloading = p.reloadTimer > 0;
    e.reloadWrap.classList.toggle('hidden', !reloading);
    if (reloading) {
      const prog = 1 - p.reloadTimer / Math.max(0.01, p.reloadTotal);
      e.reloadBar.style.width = (prog * 100) + '%';
    }

    for (let i = 0; i < this.slotEls.length; i++) {
      const el = this.slotEls[i];
      if (i < p.slots.length) {
        el.classList.toggle('active', i === p.slot);
        const sl = p.slots[i];
        el.querySelector('span').textContent = sl.w.short;
        el.classList.toggle('empty', sl.mag !== Infinity && sl.mag <= 0 && sl.reserve <= 0);
      }
    }
    e.nadeCount.textContent = p.nades;
    this.slotEls[3].classList.toggle('empty', p.nades <= 0);
  }

  updateStats(p) {
    this.el.stK.textContent = p.kills;
    this.el.stD.textContent = p.deaths;
    this.el.stS.textContent = p.score;
    this.el.ksLine.classList.toggle('hidden', p.streak < 2);
    this.el.ksCount.textContent = p.streak;
  }

  updateMatch(mode, redScore, blueScore, timeLeft) {
    const e = this.el;
    if (mode === 'ffa') {
      e.scoreRed.parentElement.style.display = 'none';
      e.scoreBlue.parentElement.style.display = 'none';
    } else {
      e.scoreRed.parentElement.style.display = '';
      e.scoreBlue.parentElement.style.display = '';
      e.scoreRed.textContent = redScore;
      e.scoreBlue.textContent = blueScore;
    }
    e.timer.textContent = formatTime(timeLeft);
    e.timer.classList.toggle('urgent', timeLeft <= 30);
  }

  // --------------------------------------------------------
  // Killfeed
  // --------------------------------------------------------
  addKillfeed(killerName, killerTeam, victimName, victimTeam, weaponName, headshot, isMe, isSuicide) {
    const div = document.createElement('div');
    div.className = 'kf';
    const cls = (t) => (t === 'red' ? 'n-red' : t === 'blue' ? 'n-blue' : '');
    const me = (b) => (b ? ' n-me' : '');

    if (isSuicide) {
      div.innerHTML =
        `<span class="${cls(victimTeam)}${me(isMe)}">${escapeHtml(victimName)}</span>` +
        `<span class="kf-w">${escapeHtml(weaponName)}</span>`;
    } else {
      div.innerHTML =
        `<span class="${cls(killerTeam)}${me(isMe === 'killer')}">${escapeHtml(killerName)}</span>` +
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

  toast(text, small) {
    const div = document.createElement('div');
    div.className = 'toast' + (small ? ' small' : '');
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
  }

  damageFlash(intensity) {
    this.el.dmgVig.style.opacity = String(clamp(intensity, 0, 0.9));
    clearTimeout(this._vigT);
    this._vigT = setTimeout(() => { this.el.dmgVig.style.opacity = '0'; }, 90);
  }

  // --------------------------------------------------------
  updateFloating(dt, camera) {
    // Schadenszahlen
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
      const sx = (this._v.x * 0.5 + 0.5) * window.innerWidth + p.ox;
      const sy = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
      const k = p.t / p.life;
      p.el.style.transform = `translate(-50%,-50%) translate(${sx}px, ${sy - k * 22}px) scale(${1 + (1 - k) * 0.25})`;
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
    this.el.respawnT.textContent = t.toFixed(1);
  }
  updateDeathTimer(t) { this.el.respawnT.textContent = Math.max(0, t).toFixed(1); }
  hideDeath() { this.el.death.classList.add('hidden'); }

  // --------------------------------------------------------
  // Scoreboard
  // --------------------------------------------------------
  showScoreboard(v) { this.el.scoreboard.classList.toggle('hidden', !v); }

  renderScoreboard(game) {
    const e = this.el;
    e.sbMode.textContent = game.mode === 'ffa' ? 'FREE FOR ALL' : 'TEAM DEATHMATCH';
    e.sbMap.textContent = game.world.map.name;

    const rows = (list) => list.map((a) => {
      const pingCls = a.ping < 60 ? 'ping-good' : 'ping-bad';
      return `<div class="sb-row${a.isLocal ? ' me' : ''}${a.alive ? '' : ' dead'}">` +
        `<span class="nm">${escapeHtml(a.name)}</span>` +
        `<span>${a.kills}</span><span>${a.deaths}</span><span>${a.score}</span>` +
        `<span class="${pingCls}">${a.ping}</span></div>`;
    }).join('');

    const sortFn = (a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths;

    if (game.mode === 'ffa') {
      const all = game.actors.slice().sort(sortFn);
      document.querySelector('.sb-team.blue').style.display = 'none';
      document.querySelector('.sb-team.red').classList.add('ffa');
      document.querySelector('.sb-team.red .sb-team-head').innerHTML =
        `RANGLISTE <span>${all.length} Spieler</span>`;
      e.sbRed.innerHTML = rows(all);
    } else {
      document.querySelector('.sb-team.blue').style.display = '';
      document.querySelector('.sb-team.red').classList.remove('ffa');
      document.querySelector('.sb-team.red .sb-team-head').innerHTML =
        `ROT <span id="sb-red-score">${game.scores.red}</span>`;
      const red = game.actors.filter(a => a.team === 'red').sort(sortFn);
      const blue = game.actors.filter(a => a.team === 'blue').sort(sortFn);
      e.sbRed.innerHTML = rows(red);
      e.sbBlue.innerHTML = rows(blue);
      $('sb-blue-score').textContent = game.scores.blue;
    }
  }

  // --------------------------------------------------------
  setPerf(text, show) {
    this.el.perf.classList.toggle('hidden', !show);
    if (show) this.el.perf.textContent = text;
  }

  setMinimapVisible(v) { this.el.minimapWrap.classList.toggle('hidden', !v); }
  setClickHint(v) { this.el.clickHint.classList.toggle('hidden', !v); }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
