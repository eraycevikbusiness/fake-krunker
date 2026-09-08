// ============================================================
// HUD: Fadenkreuz, Balken, Killfeed, Schadenszahlen, Scoreboard
// DOM-Schreibzugriffe passieren nur, wenn sich ein Wert aendert.
// ============================================================

import * as THREE from 'three';
import { settings } from '../core/settings.js';
import { clamp, formatTime } from '../core/utils.js';

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
      speedo: $('speedo'),
      killcam: $('killcam'), killcamName: $('killcam-name'),
      dashInd: $('dash-ind'), dashFill: $('dash-fill'),
    };
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
    if (hidden) return;

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
    this._cls('crossHit', c.cross, 'hit', !!hitTint);
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

  updateStats(p) {
    this._txt('k', this.el.stK, String(p.kills));
    this._txt('d', this.el.stD, String(p.deaths));
    this._txt('s', this.el.stS, String(p.score));
    this._cls('ks', this.el.ksLine, 'hidden', p.streak < 2);
    this._txt('ksc', this.el.ksCount, String(p.streak));
  }

  updateMatch(mode, redScore, blueScore, timeLeft) {
    const e = this.el;
    const ffa = mode === 'ffa';
    this._style('tr', e.scoreRed.parentElement, 'display', ffa ? 'none' : '');
    this._style('tb', e.scoreBlue.parentElement, 'display', ffa ? 'none' : '');
    if (!ffa) {
      this._txt('sr', e.scoreRed, String(redScore));
      this._txt('sb', e.scoreBlue, String(blueScore));
    }
    this._txt('tm', e.timer, formatTime(timeLeft));
    this._cls('tu', e.timer, 'urgent', timeLeft <= 30);
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
    this.el.respawnT.textContent = t.toFixed(1);
  }
  updateDeathTimer(t) { this._txt('rt', this.el.respawnT, Math.max(0, t).toFixed(1)); }
  hideDeath() { this.el.death.classList.add('hidden'); }

  // --------------------------------------------------------
  // Scoreboard
  // --------------------------------------------------------
  showScoreboard(v) { this.el.scoreboard.classList.toggle('hidden', !v); }

  renderScoreboard(game) {
    const e = this.el;
    e.sbMode.textContent = game.mode === 'ffa' ? 'FREE FOR ALL' : 'TEAM DEATHMATCH';
    e.sbMap.textContent = game.world ? game.world.map.name : '';

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
