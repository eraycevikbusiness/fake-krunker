// ============================================================
// Menue: Tabs, Klassenauswahl, Einstellungen, Pause, Endscreen
// ============================================================

import { CLASSES, WEAPONS } from '../game/weapons.js';
import { SKINS } from '../game/skins.js';
import { DIFFICULTY } from '../game/bot.js';
import { buildSettingsUI, resetSettings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { SkinPreview } from './preview.js';

const $ = (id) => document.getElementById(id);
const LS = 'fragstorm.profile.v1';
const LS_LEGACY = 'krunkerclone.profile.v1';

const STAT_LABELS = {
  schaden: 'SCHADEN', feuerrate: 'FEUERRATE', reichweite: 'REICHWEITE', mobilitaet: 'MOBILITÄT',
};

export class Menu {
  constructor(handlers) {
    this.h = handlers;
    this.classId = 'triggerman';
    this.inGame = false;
    this.skins = {};               // weaponId -> skinId
    this.skinWeapon = 'ar';
    this.preview = null;
    this.el = {
      menu: $('menu'), loading: $('loading'), pause: $('pause'), end: $('endscreen'),
      classGrid: $('class-grid'), classDetail: $('class-detail'),
      settingsGrid: $('settings-grid'),
      name: $('opt-name'), mode: $('opt-mode'), map: $('opt-map'),
      bots: $('opt-bots'), diff: $('opt-diff'), limit: $('opt-limit'), timeL: $('opt-time'),
      lblBots: $('lbl-bots'), lblDiff: $('lbl-diff'), lblLimit: $('lbl-limit'), lblTime: $('lbl-time'),
      endTitle: $('end-title'), endSub: $('end-sub'), endBoard: $('end-board'),
      backGame: $('btn-back-game'), classHint: $('class-hint'),
    };

    this._loadProfile();
    this._wireTabs();
    this._buildClasses();
    this._buildSkins();
    this._wireOptions();
    buildSettingsUI(this.el.settingsGrid, (id, v) => this.h.onSettingChange && this.h.onSettingChange(id, v));

    $('btn-play').addEventListener('click', () => {
      audio.uiClick();
      this._saveProfile();
      this.h.onPlay && this.h.onPlay(this.getConfig());
    });
    $('btn-reset-settings').addEventListener('click', () => {
      resetSettings();
      buildSettingsUI(this.el.settingsGrid, (id, v) => this.h.onSettingChange && this.h.onSettingChange(id, v));
      this.h.onSettingChange && this.h.onSettingChange('*', null);
      audio.uiClick();
    });
    $('btn-resume').addEventListener('click', () => { audio.uiClick(); this.h.onResume && this.h.onResume(); });
    $('btn-settings-ingame').addEventListener('click', () => {
      audio.uiClick();
      this.hidePause();
      this.showMenu('settings', true);
      this.h.onOpenSettings && this.h.onOpenSettings();
    });
    $('btn-class-ingame').addEventListener('click', () => {
      audio.uiClick();
      this.hidePause();
      this.showMenu('class', true);
      this.h.onOpenSettings && this.h.onOpenSettings();
    });
    this.el.backGame.addEventListener('click', () => {
      audio.uiClick();
      this.h.onBackToGame && this.h.onBackToGame();
    });
    $('btn-quit').addEventListener('click', () => { audio.uiClick(); this.h.onQuit && this.h.onQuit(); });
    $('btn-again').addEventListener('click', () => {
      audio.uiClick();
      this.hideEnd();
      this.h.onPlay && this.h.onPlay(this.getConfig());
    });
    $('btn-tomenu').addEventListener('click', () => {
      audio.uiClick();
      this.hideEnd();
      this.h.onQuit && this.h.onQuit();
    });
    for (const id of ['btn-fullscreen', 'btn-fullscreen-pause']) {
      const b = $(id);
      if (b) b.addEventListener('click', () => { audio.uiClick(); this.h.onFullscreen && this.h.onFullscreen(); });
    }

    // Hover-Sounds
    document.querySelectorAll('button, .class-card').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.uiHover());
    });
  }

  // --------------------------------------------------------
  _wireTabs() {
    document.querySelectorAll('.menu-tabs .tab').forEach((t) => {
      t.addEventListener('click', () => {
        audio.uiClick();
        this._activateTab(t.dataset.tab);
      });
    });
  }

  _activateTab(tab) {
    document.querySelectorAll('.menu-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
    document.querySelectorAll('.tabpane').forEach(x => x.classList.remove('active'));
    const pane = $('pane-' + tab);
    if (pane) pane.classList.add('active');
    if (tab === 'skins') this._showPreview();
    else if (this.preview) this.preview.stop();
  }

  // --------------------------------------------------------
  // Skins
  // --------------------------------------------------------
  _buildSkins() {
    const list = $('skin-weapons');
    if (!list) return;
    list.innerHTML = '';
    const weapons = Object.values(WEAPONS).filter(w => w.id !== 'grenade');
    for (const w of weapons) {
      const d = document.createElement('div');
      d.className = 'skin-wpn' + (w.id === this.skinWeapon ? ' sel' : '');
      d.dataset.id = w.id;
      d.innerHTML = `<span>${w.name.toUpperCase()}</span><i></i>`;
      d.addEventListener('click', () => {
        audio.uiClick();
        this.skinWeapon = w.id;
        list.querySelectorAll('.skin-wpn').forEach(x => x.classList.toggle('sel', x.dataset.id === w.id));
        this._renderSkinChips();
        this._showPreview();
      });
      d.addEventListener('mouseenter', () => audio.uiHover());
      list.appendChild(d);
    }
    this._renderSkinChips();
    this._updateSkinDots();
  }

  _updateSkinDots() {
    document.querySelectorAll('.skin-wpn').forEach((el) => {
      const sid = this.skins[el.dataset.id] || 'default';
      const s = SKINS.find(x => x.id === sid) || SKINS[0];
      const dot = el.querySelector('i');
      if (dot) dot.style.background = `linear-gradient(135deg, ${s.swatch[0]}, ${s.swatch[1]})`;
    });
  }

  _renderSkinChips() {
    const box = $('skin-list');
    if (!box) return;
    box.innerHTML = '';
    const cur = this.skins[this.skinWeapon] || 'default';
    const w = WEAPONS[this.skinWeapon];
    $('skin-wname').textContent = w ? w.name.toUpperCase() : '';
    for (const s of SKINS) {
      const d = document.createElement('div');
      d.className = 'skin-chip' + (s.id === cur ? ' sel' : '');
      d.innerHTML =
        `<div class="sw">${s.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</div>` +
        `<div><div class="sn">${s.name}</div><div class="sd">${s.desc}</div></div>`;
      d.addEventListener('click', () => {
        audio.uiClick();
        this.skins[this.skinWeapon] = s.id;
        box.querySelectorAll('.skin-chip').forEach(x => x.classList.remove('sel'));
        d.classList.add('sel');
        $('skin-sname').textContent = s.name;
        this._updateSkinDots();
        this._saveProfile();
        this._showPreview();
        this.h.onSkinChange && this.h.onSkinChange(this.skinWeapon, s.id);
      });
      d.addEventListener('mouseenter', () => audio.uiHover());
      box.appendChild(d);
    }
    const sel = SKINS.find(x => x.id === cur) || SKINS[0];
    $('skin-sname').textContent = sel.name;
  }

  _showPreview() {
    const cv = $('skin-preview');
    if (!cv) return;
    if (!this.preview) this.preview = new SkinPreview(cv);
    const w = WEAPONS[this.skinWeapon] || WEAPONS.ar;
    this.preview.show(w, this.skins[this.skinWeapon] || 'default');
    this.preview.start();
  }

  _buildClasses() {
    const grid = this.el.classGrid;
    grid.innerHTML = '';
    for (const c of CLASSES) {
      const d = document.createElement('div');
      d.className = 'class-card' + (c.id === this.classId ? ' sel' : '');
      d.dataset.id = c.id;
      d.innerHTML =
        `<div class="cc-ico">${c.icon}</div>` +
        `<div class="cc-name">${c.name}</div>` +
        `<div class="cc-wpn">${c.primary.toUpperCase()}</div>`;
      d.addEventListener('click', () => {
        audio.uiClick();
        this.classId = c.id;
        grid.querySelectorAll('.class-card').forEach(x => x.classList.remove('sel'));
        d.classList.add('sel');
        this._renderClassDetail(c);
        this._saveProfile();
        this.h.onClassChange && this.h.onClassChange(c.id);
      });
      d.addEventListener('mouseenter', () => audio.uiHover());
      grid.appendChild(d);
    }
    this._renderClassDetail(CLASSES.find(c => c.id === this.classId) || CLASSES[0]);
  }

  _renderClassDetail(c) {
    const bars = Object.keys(c.stats).map((k) => {
      const v = Math.round(c.stats[k] * 100);
      return `<div class="cd-stat"><div class="lbl"><span>${STAT_LABELS[k] || k.toUpperCase()}</span><span>${v}</span></div>` +
        `<div class="track"><div class="fill" style="width:${v}%"></div></div></div>`;
    }).join('');
    this.el.classDetail.innerHTML =
      `<h3>${c.icon} ${c.name}</h3>` +
      `<div class="cd-desc">${c.desc}</div>` +
      `<div class="cd-stat"><div class="lbl"><span>LEBEN</span><span>${c.hp}${c.armor ? ' +' + c.armor + ' RÜSTUNG' : ''}</span></div>` +
      `<div class="track"><div class="fill" style="width:${Math.min(100, (c.hp + c.armor) / 1.6)}%"></div></div></div>` +
      bars +
      `<div class="cd-perks">${c.perks.map(p => `<span>${p}</span>`).join('')}</div>` +
      `<div class="cd-perks" style="margin-top:10px">` +
      `<span>1 · ${c.primary.toUpperCase()}</span><span>2 · ${c.secondary.toUpperCase()}</span>` +
      `<span>3 · ${c.melee.toUpperCase()}</span><span>G · ${c.nades}× GRANATE</span></div>`;
  }

  _wireOptions() {
    const e = this.el;
    const upd = () => {
      e.lblBots.textContent = e.bots.value;
      e.lblDiff.textContent = DIFFICULTY[+e.diff.value].name;
      e.lblLimit.textContent = e.limit.value;
      e.lblTime.textContent = e.timeL.value + ' min';
    };
    [e.bots, e.diff, e.limit, e.timeL].forEach((el) => el.addEventListener('input', () => { upd(); this._saveProfile(); }));
    [e.name, e.mode, e.map].forEach((el) => el.addEventListener('change', () => this._saveProfile()));
    // Enter im Namensfeld startet das Spiel
    e.name.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); $('btn-play').click(); } });
    upd();
  }

  getConfig() {
    const e = this.el;
    return {
      name: e.name.value.trim() || 'Player',
      mode: e.mode.value,
      map: e.map.value,
      bots: +e.bots.value,
      difficulty: +e.diff.value,
      scoreLimit: +e.limit.value,
      timeLimit: +e.timeL.value,
      classId: this.classId,
      skins: Object.assign({}, this.skins),
    };
  }

  _loadProfile() {
    try {
      const raw = localStorage.getItem(LS) || localStorage.getItem(LS_LEGACY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.name) this.el.name.value = String(p.name).slice(0, 16);
      if (p.mode) this.el.mode.value = p.mode;
      if (p.map) this.el.map.value = p.map;
      if (p.bots) this.el.bots.value = p.bots;
      if (p.difficulty !== undefined) this.el.diff.value = p.difficulty;
      if (p.scoreLimit) this.el.limit.value = p.scoreLimit;
      if (p.timeLimit) this.el.timeL.value = p.timeLimit;
      if (p.classId && CLASSES.some(c => c.id === p.classId)) this.classId = p.classId;
      if (p.skins && typeof p.skins === 'object') {
        for (const k of Object.keys(p.skins)) {
          if (WEAPONS[k] && SKINS.some(s => s.id === p.skins[k])) this.skins[k] = p.skins[k];
        }
      }
    } catch (err) { /* ignorieren */ }
  }

  _saveProfile() {
    try { localStorage.setItem(LS, JSON.stringify(this.getConfig())); } catch (err) {}
  }

  // --------------------------------------------------------
  hideLoading() { this.el.loading.classList.add('hidden'); }
  setLoading(pct, text) {
    $('loadbar-fill').style.width = pct + '%';
    if (text) $('loadtext').textContent = text;
  }

  /** tab: play | class | settings | controls; inGame: Match laeuft (Zurueck-Button zeigen) */
  showMenu(tab, inGame) {
    this.inGame = !!inGame;
    this.el.menu.classList.remove('hidden');
    this.el.backGame.classList.toggle('hidden', !this.inGame);
    if (this.el.classHint) this.el.classHint.classList.toggle('hidden', !this.inGame);
    if (tab) this._activateTab(tab);
  }
  hideMenu() { this.el.menu.classList.add('hidden'); if (this.preview) this.preview.stop(); }
  get menuVisible() { return !this.el.menu.classList.contains('hidden'); }

  showPause() { this.el.pause.classList.remove('hidden'); }
  hidePause() { this.el.pause.classList.add('hidden'); }
  get pauseVisible() { return !this.el.pause.classList.contains('hidden'); }

  hideEnd() { this.el.end.classList.add('hidden'); }
  get endVisible() { return !this.el.end.classList.contains('hidden'); }

  showEnd(game, winner, won) {
    const e = this.el;
    e.end.classList.remove('hidden');

    if (game.mode === 'ffa') {
      e.endTitle.textContent = won ? 'SIEG!' : 'MATCH BEENDET';
      e.endSub.textContent = winner ? `${winner.name} gewinnt mit ${winner.kills} Kills` : '';
    } else if (winner === 'draw') {
      e.endTitle.textContent = 'UNENTSCHIEDEN';
      e.endSub.textContent = `${game.scores.red} : ${game.scores.blue}`;
    } else {
      e.endTitle.textContent = won ? 'SIEG!' : 'NIEDERLAGE';
      e.endSub.textContent =
        `Team ${winner === 'red' ? 'ROT' : 'BLAU'} gewinnt  ·  ${game.scores.red} : ${game.scores.blue}`;
    }
    e.endTitle.style.color = won ? '#ffcc00' : '#ff6b6b';

    const sorted = game.actors.slice().sort((a, b) => b.score - a.score || b.kills - a.kills);
    const p = game.player;
    const rank = sorted.indexOf(p) + 1;
    const acc = p.kills + p.deaths > 0 ? Math.round(p.kills / Math.max(1, p.kills + p.deaths) * 100) : 0;

    const rows = sorted.map((a, i) => {
      const kd = (a.kills / Math.max(1, a.deaths)).toFixed(2);
      return `<div class="sb-row${a.isLocal ? ' me' : ''}">` +
        `<span class="nm">${i + 1}. ${escapeHtml(a.name)}</span>` +
        `<span>${a.kills}</span><span>${a.deaths}</span><span>${a.score}</span><span>${kd}</span></div>`;
    }).join('');

    e.endBoard.innerHTML =
      `<div style="margin:16px 0 10px;font-size:16px;color:#8d97a8;letter-spacing:1px">` +
      `DEIN ERGEBNIS: <b style="color:#fff">Platz ${rank}</b> &middot; ` +
      `${p.kills} Kills &middot; ${p.deaths} Tode &middot; ${Math.round(p.damageDealt)} Schaden &middot; ` +
      `beste Serie ${p.bestStreak} &middot; K/D-Quote ${acc}%</div>` +
      `<div class="sb-cols"><span>SPIELER</span><span>K</span><span>D</span><span>SCORE</span><span>K/D</span></div>` +
      rows;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
