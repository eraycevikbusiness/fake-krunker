// ============================================================
// Menue: Tabs, Klassenauswahl, Skins + Sticker, Charakter
// (Outfit, Kopfbedeckung, Kill-Effekt, Kill-Icon), Training,
// Einstellungen (mit Fadenkreuz-Vorschau), Pause, Endscreen
// ============================================================

import { CLASSES, WEAPONS, ATTACHMENTS, ATTACHMENT_BY_ID, MAX_ATTACHMENTS, applyAttachments } from '../game/weapons.js';
import { SKINS } from '../game/skins.js';
import { STICKERS, stickerCanvas } from '../game/stickers.js';
import { OUTFITS, HATS, KILL_EFFECTS, KILL_ICONS } from '../game/cosmetics.js';
import { DRILLS, TARGET_SIZES, TARGET_DISTS, loadBests } from '../game/training.js';
import { MODE_BY_ID } from '../game/modes.js';
import { DIFFICULTY } from '../game/bot.js';
import { buildSettingsUI, resetSettings, settings } from '../core/settings.js';
import { audio } from '../core/audio.js';
import { SkinPreview, CharPreview } from './preview.js';
import { drawCrosshair } from './crosshair.js';

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
    this.stickers = {};            // weaponId -> stickerId
    this.attachments = {};         // weaponId -> [attachmentIds]
    this.skinWeapon = 'ar';
    this.outfit = 'team';
    this.hat = 'none';
    this.killEffect = 'none';
    this.killIcon = 'none';
    this.training = { drill: 'gridshot', size: 'medium', dist: 'mid' };
    this.preview = null;
    this.charPreview = null;
    this.lastCfg = null;
    this.el = {
      menu: $('menu'), loading: $('loading'), pause: $('pause'), end: $('endscreen'),
      classGrid: $('class-grid'), classDetail: $('class-detail'),
      settingsGrid: $('settings-grid'),
      name: $('opt-name'), mode: $('opt-mode'), map: $('opt-map'), weather: $('opt-weather'), modeDesc: $('mode-desc'),
      bots: $('opt-bots'), diff: $('opt-diff'), limit: $('opt-limit'), timeL: $('opt-time'),
      lblBots: $('lbl-bots'), lblDiff: $('lbl-diff'), lblLimit: $('lbl-limit'), lblTime: $('lbl-time'),
      endTitle: $('end-title'), endSub: $('end-sub'), endBoard: $('end-board'),
      backGame: $('btn-back-game'), classHint: $('class-hint'),
      crossPreview: null,
    };

    this._loadProfile();
    this._wireTabs();
    this._buildClasses();
    this._buildSkins();
    this._buildCharacter();
    this._buildTraining();
    this._wireOptions();
    this._buildSettings();

    $('btn-play').addEventListener('click', () => {
      audio.uiClick();
      this._saveProfile();
      this._play(this.getConfig());
    });
    $('btn-reset-settings').addEventListener('click', () => {
      resetSettings();
      this._buildSettings();
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
      this._play(this.lastCfg || this.getConfig());
    });
    $('btn-tomenu').addEventListener('click', () => {
      audio.uiClick();
      this.hideEnd();
      this.h.onQuit && this.h.onQuit();
    });
    const bR = $('btn-replay'), bRS = $('btn-replay-save'), bRL = $('btn-replay-load'), fileIn = $('replay-file');
    if (bR) bR.addEventListener('click', () => { audio.uiClick(); this.h.onReplay && this.h.onReplay(); });
    if (bRS) bRS.addEventListener('click', () => { audio.uiClick(); this.h.onReplaySave && this.h.onReplaySave(); });
    if (bRL && fileIn) {
      bRL.addEventListener('click', () => { audio.uiClick(); fileIn.value = ''; fileIn.click(); });
      fileIn.addEventListener('change', () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try { const data = JSON.parse(rd.result); this.h.onReplayLoad && this.h.onReplayLoad(data); }
          catch (e) { alert('Replay konnte nicht gelesen werden.'); }
        };
        rd.readAsText(f);
      });
    }
    for (const id of ['btn-fullscreen', 'btn-fullscreen-pause']) {
      const b = $(id);
      if (b) b.addEventListener('click', () => { audio.uiClick(); this.h.onFullscreen && this.h.onFullscreen(); });
    }

    // Hover-Sounds
    document.querySelectorAll('button, .class-card').forEach((b) => {
      b.addEventListener('mouseenter', () => audio.uiHover());
    });
  }

  _play(cfg) {
    this.lastCfg = cfg;
    this.h.onPlay && this.h.onPlay(cfg);
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
    if (tab === 'skins') this._showPreview(); else if (this.preview) this.preview.stop();
    if (tab === 'char') this._showCharPreview(); else if (this.charPreview) this.charPreview.stop();
    if (tab === 'training') this._refreshDrillBests();
    if (tab === 'settings') this._drawCrossPreview();
  }

  // --------------------------------------------------------
  // Einstellungen (mit Fadenkreuz-Vorschau und Hitsound-Test)
  // --------------------------------------------------------
  _buildSettings() {
    buildSettingsUI(this.el.settingsGrid, (id, v) => {
      if (id === 'crossPreview') { this.el.crossPreview = v; this._drawCrossPreview(); return; }
      if (id === 'hitPreview') { audio.init(); audio.resume(); audio.previewHitsound(); return; }
      if (id === '*' || (typeof id === 'string' && (id.startsWith('cross') || id === 'dynCross'))) this._drawCrossPreview();
      this.h.onSettingChange && this.h.onSettingChange(id, v);
    });
  }

  _drawCrossPreview() {
    const box = this.el.crossPreview;
    if (!box) return;
    const cv = box.querySelector('canvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Hintergrund: stilisierte Arena
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#5b7fae'); grd.addColorStop(0.55, '#c9b48a'); grd.addColorStop(1, '#6e5a3a');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#8a6a44'; ctx.fillRect(20, 50, 46, 40); ctx.fillRect(150, 40, 50, 50);
    ctx.fillStyle = '#b39262'; ctx.fillRect(66, 62, 84, 28);
    // Gegner-Silhouette
    ctx.fillStyle = '#c94a4a'; ctx.fillRect(W / 2 - 6, H / 2 - 4, 12, 26);
    ctx.fillStyle = '#e3b68f'; ctx.fillRect(W / 2 - 4, H / 2 - 13, 8, 8);
    // Fadenkreuz (statisch, Streuung 0 / dynamisch: etwas geweitet)
    const spread = settings.dynCross ? 3 : 0;
    drawCrosshair(ctx, W, H, settings, spread, false, true);
    // Kleine zweite Ansicht rechts: Treffer-Farbe
    ctx.save();
    ctx.translate(W - 34, 30);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-26, -26, 52, 52);
    drawCrosshair(ctx, 0, 0, settings, 0, true, true);
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '10px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('1:1', 6, H - 6);
  }

  // --------------------------------------------------------
  // Skins + Sticker
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
        this._renderStickerChips();
        this._showPreview();
      });
      d.addEventListener('mouseenter', () => audio.uiHover());
      list.appendChild(d);
    }
    this._renderSkinChips();
    this._renderStickerChips();
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

  _renderStickerChips() {
    const box = $('sticker-list');
    if (!box) return;
    box.innerHTML = '';
    const cur = this.stickers[this.skinWeapon] || 'none';
    for (const s of STICKERS) {
      const d = document.createElement('div');
      d.className = 'sticker-chip' + (s.id === cur ? ' sel' : '');
      d.title = s.name;
      const cv = stickerCanvas(s.id);
      if (cv) { cv.className = 'st-img'; d.appendChild(cv); }
      else { const n = document.createElement('span'); n.className = 'st-none'; n.textContent = '⃠'; d.appendChild(n); }
      d.addEventListener('click', () => {
        audio.uiClick();
        this.stickers[this.skinWeapon] = s.id;
        box.querySelectorAll('.sticker-chip').forEach(x => x.classList.remove('sel'));
        d.classList.add('sel');
        this._saveProfile();
        this._showPreview();
        this.h.onStickerChange && this.h.onStickerChange(this.skinWeapon, s.id);
      });
      d.addEventListener('mouseenter', () => audio.uiHover());
      box.appendChild(d);
    }
  }

  _showPreview() {
    const cv = $('skin-preview');
    if (!cv) return;
    if (!this.preview) this.preview = new SkinPreview(cv);
    const base = WEAPONS[this.skinWeapon] || WEAPONS.ar;
    const w = applyAttachments(base, this.attachments[this.skinWeapon]);
    this.preview.show(w, this.skins[this.skinWeapon] || 'default', this.stickers[this.skinWeapon] || 'none');
    this.preview.start();
  }

  // --------------------------------------------------------
  // Charakter: Outfit, Kopfbedeckung, Kill-Effekt, Kill-Icon
  // --------------------------------------------------------
  _buildCharacter() {
    const outfits = $('char-outfits'), hats = $('char-hats'), fx = $('char-effects'), icons = $('char-icons');
    if (!outfits) return;

    const chips = (box, list, curId, render, onPick) => {
      box.innerHTML = '';
      for (const item of list) {
        const d = document.createElement('div');
        d.className = 'cos-chip' + (item.id === curId() ? ' sel' : '');
        d.innerHTML = render(item);
        d.addEventListener('click', () => {
          audio.uiClick();
          onPick(item);
          box.querySelectorAll('.cos-chip').forEach(x => x.classList.remove('sel'));
          d.classList.add('sel');
          this._saveProfile();
          this._showCharPreview();
          this.h.onCosmeticChange && this.h.onCosmeticChange(this.getCosmetics());
        });
        d.addEventListener('mouseenter', () => audio.uiHover());
        box.appendChild(d);
      }
    };

    chips(outfits, OUTFITS, () => this.outfit,
      (o) => `<div class="sw">${o.swatch.map(c => `<i style="background:${c}"></i>`).join('')}</div><div><div class="sn">${o.name}</div><div class="sd">${o.desc}</div></div>`,
      (o) => { this.outfit = o.id; });
    chips(hats, HATS, () => this.hat,
      (h) => `<span class="ico">${h.icon}</span><div class="sn">${h.name}</div>`,
      (h) => { this.hat = h.id; audio.hatSwap(); });
    chips(fx, KILL_EFFECTS, () => this.killEffect,
      (k) => `<span class="ico">${k.icon}</span><div><div class="sn">${k.name}</div><div class="sd">${k.desc}</div></div>`,
      (k) => { this.killEffect = k.id; if (this.charPreview) this.charPreview.playEffect(k.id); });
    chips(icons, KILL_ICONS, () => this.killIcon,
      (k) => `<span class="ico">${k.icon || '—'}</span><div class="sn">${k.name}</div>`,
      (k) => { this.killIcon = k.id; });
  }

  _showCharPreview() {
    const cv = $('char-preview');
    if (!cv) return;
    if (!this.charPreview) this.charPreview = new CharPreview(cv);
    const cls = CLASSES.find(c => c.id === this.classId) || CLASSES[0];
    const wid = cls.primary;
    this.charPreview.show({
      outfit: this.outfit, hat: this.hat, weaponId: wid,
      skinId: this.skins[wid] || 'default', stickerId: this.stickers[wid] || 'none',
    });
    this.charPreview.start();
    const cap = $('char-caption');
    if (cap) {
      const o = OUTFITS.find(x => x.id === this.outfit) || OUTFITS[0];
      const h = HATS.find(x => x.id === this.hat) || HATS[0];
      cap.innerHTML = `<b>${o.name.toUpperCase()}</b><span>${h.name}</span>`;
    }
  }

  getCosmetics() {
    return { outfit: this.outfit, hat: this.hat, killEffect: this.killEffect, killIcon: this.killIcon };
  }

  // --------------------------------------------------------
  // Training
  // --------------------------------------------------------
  _buildTraining() {
    const grid = $('drill-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (const d of DRILLS) {
      const card = document.createElement('div');
      card.className = 'drill-card' + (d.id === this.training.drill ? ' sel' : '');
      card.dataset.id = d.id;
      card.innerHTML = `<div class="dc-ico">${d.icon}</div><div class="dc-name">${d.name}</div><div class="dc-desc">${d.desc}</div><div class="dc-best"></div>`;
      card.addEventListener('click', () => {
        audio.uiClick();
        this.training.drill = d.id;
        grid.querySelectorAll('.drill-card').forEach(x => x.classList.toggle('sel', x.dataset.id === d.id));
        this._saveProfile();
      });
      card.addEventListener('mouseenter', () => audio.uiHover());
      grid.appendChild(card);
    }
    const size = $('tr-size'), dist = $('tr-dist');
    if (size) {
      size.innerHTML = TARGET_SIZES.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('');
      size.value = this.training.size;
      size.addEventListener('change', () => { this.training.size = size.value; this._saveProfile(); this._refreshDrillBests(); });
    }
    if (dist) {
      dist.innerHTML = TARGET_DISTS.map(s => `<option value="${s[0]}">${s[1]}</option>`).join('');
      dist.value = this.training.dist;
      dist.addEventListener('change', () => { this.training.dist = dist.value; this._saveProfile(); this._refreshDrillBests(); });
    }
    const btn = $('btn-train');
    if (btn) btn.addEventListener('click', () => {
      audio.uiClick();
      this._saveProfile();
      this._play(this.getTrainingConfig());
    });
    this._refreshDrillBests();
  }

  _refreshDrillBests() {
    const bests = loadBests();
    document.querySelectorAll('.drill-card').forEach((card) => {
      const id = card.dataset.id;
      const key = id + '|' + this.training.size + '|' + this.training.dist;
      const v = bests[key];
      const el = card.querySelector('.dc-best');
      if (!el) return;
      if (v === undefined) { el.textContent = 'Noch kein Bestwert'; return; }
      el.textContent = 'Bestwert: ' + (id === 'reaction' ? v + ' ms' : id === 'tracking' ? v + '%' : v + ' Treffer');
    });
  }

  getTrainingConfig() {
    const cfg = this.getConfig();
    cfg.training = Object.assign({}, this.training);
    cfg.bots = 0;
    return cfg;
  }

  /** Ergebnis eines Trainings-Drills anzeigen */
  showTrainingEnd(r) {
    const e = this.el;
    e.end.classList.remove('hidden');
    e.endTitle.textContent = r.isBest ? 'NEUER BESTWERT!' : 'TRAINING BEENDET';
    e.endTitle.style.color = r.isBest ? '#ffcc00' : '#e8edf5';
    const sz = TARGET_SIZES.find(s => s[0] === r.cfg.size), ds = TARGET_DISTS.find(s => s[0] === r.cfg.dist);
    e.endSub.textContent = `${r.drill.icon} ${r.drill.name} · Ziele ${sz ? sz[1] : ''} · ${ds ? ds[1] : ''}`;
    const rows = r.lines.map(([k, v]) => `<div class="tr-row"><span>${escapeHtml(k)}</span><b>${escapeHtml(String(v))}</b></div>`).join('');
    e.endBoard.innerHTML =
      `<div class="tr-score">${escapeHtml(r.scoreText)}</div>` +
      `<div class="tr-rows">${rows}` +
      `<div class="tr-row"><span>Bisheriger Bestwert</span><b>${escapeHtml(r.prevBestText)}</b></div></div>`;
    this._refreshDrillBests();
  }

  // --------------------------------------------------------
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
    // Aufsaetze fuer Primaer- und Sekundaerwaffe
    const attBlock = (wid, label) => {
      const w = WEAPONS[wid];
      if (!w) return '';
      const fit = ATTACHMENTS.filter(a => a.fits(w));
      if (!fit.length) return '';
      const cur = this.attachments[wid] || [];
      return `<div class="cd-att"><div class="cd-att-head">${label} · ${w.name.toUpperCase()} <span class="dim">(max. ${MAX_ATTACHMENTS})</span></div><div class="att-row" data-w="${wid}">` +
        fit.map(a => `<div class="att-chip${cur.includes(a.id) ? ' sel' : ''}" data-att="${a.id}" title="${escapeHtml(a.desc)}"><span>${a.icon}</span>${a.name}</div>`).join('') +
        `</div></div>`;
    };
    this.el.classDetail.innerHTML =
      `<h3>${c.icon} ${c.name}</h3>` +
      `<div class="cd-desc">${c.desc}</div>` +
      `<div class="cd-stat"><div class="lbl"><span>LEBEN</span><span>${c.hp}${c.armor ? ' +' + c.armor + ' RÜSTUNG' : ''}</span></div>` +
      `<div class="track"><div class="fill" style="width:${Math.min(100, (c.hp + c.armor) / 1.6)}%"></div></div></div>` +
      bars +
      `<div class="cd-perks">${c.perks.map(p => `<span>${p}</span>`).join('')}</div>` +
      `<div class="cd-perks" style="margin-top:10px">` +
      `<span>1 · ${c.primary.toUpperCase()}</span><span>2 · ${c.secondary.toUpperCase()}</span>` +
      `<span>3 · ${c.melee.toUpperCase()}</span><span>G · ${c.nades}× GRANATE</span></div>` +
      attBlock(c.primary, 'PRIMÄR') + attBlock(c.secondary, 'SEKUNDÄR');
    this.el.classDetail.querySelectorAll('.att-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        audio.uiClick();
        const wid = chip.parentElement.dataset.w, id = chip.dataset.att;
        let cur = (this.attachments[wid] || []).slice();
        if (cur.includes(id)) cur = cur.filter(x => x !== id);
        else { cur.push(id); while (cur.length > MAX_ATTACHMENTS) cur.shift(); }
        this.attachments[wid] = cur;
        chip.parentElement.querySelectorAll('.att-chip').forEach(x => x.classList.toggle('sel', cur.includes(x.dataset.att)));
        this._saveProfile();
        this.h.onAttachmentChange && this.h.onAttachmentChange(Object.assign({}, this.attachments));
      });
      chip.addEventListener('mouseenter', () => audio.uiHover());
    });
  }

  _wireOptions() {
    const e = this.el;
    const upd = () => {
      e.lblBots.textContent = e.bots.value;
      e.lblDiff.textContent = DIFFICULTY[+e.diff.value].name;
      const m = MODE_BY_ID[e.mode.value];
      const lim = +e.limit.value;
      let limTxt = lim;
      if (e.mode.value === 'ctf') limTxt = Math.max(3, Math.min(10, Math.round(lim / 10))) + ' Flaggen';
      else if (e.mode.value === 'hardpoint') limTxt = Math.max(30, lim * 2) + ' Punkte';
      else if (e.mode.value === 'gungame') limTxt = 'alle Waffen';
      else if (e.mode.value === 'sd') limTxt = Math.max(3, Math.min(8, Math.round(lim / 10))) + ' Runden';
      else if (e.mode.value === 'infection') limTxt = 'bis alle infiziert sind';
      else limTxt = lim + ' Kills';
      e.lblLimit.textContent = limTxt;
      e.lblTime.textContent = e.timeL.value + ' min';
      if (e.modeDesc) e.modeDesc.textContent = m ? m.desc : '';
    };
    [e.bots, e.diff, e.limit, e.timeL].forEach((el) => el.addEventListener('input', () => { upd(); this._saveProfile(); }));
    [e.name, e.mode, e.map, e.weather].forEach((el) => el && el.addEventListener('change', () => { upd(); this._saveProfile(); }));
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
      weather: e.weather ? e.weather.value : 'clear',
      bots: +e.bots.value,
      difficulty: +e.diff.value,
      scoreLimit: +e.limit.value,
      timeLimit: +e.timeL.value,
      classId: this.classId,
      skins: Object.assign({}, this.skins),
      stickers: Object.assign({}, this.stickers),
      attachments: JSON.parse(JSON.stringify(this.attachments)),
      outfit: this.outfit,
      hat: this.hat,
      killEffect: this.killEffect,
      killIcon: this.killIcon,
      trainingOpts: Object.assign({}, this.training),
    };
  }

  _loadProfile() {
    try {
      const raw = localStorage.getItem(LS) || localStorage.getItem(LS_LEGACY);
      if (!raw) return;
      const p = JSON.parse(raw);
      if (p.name) this.el.name.value = String(p.name).slice(0, 16);
      if (p.mode && MODE_BY_ID[p.mode]) this.el.mode.value = p.mode;
      if (p.map) this.el.map.value = p.map;
      if (p.weather && this.el.weather) this.el.weather.value = p.weather;
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
      if (p.stickers && typeof p.stickers === 'object') {
        for (const k of Object.keys(p.stickers)) {
          if (WEAPONS[k] && STICKERS.some(s => s.id === p.stickers[k])) this.stickers[k] = p.stickers[k];
        }
      }
      if (p.attachments && typeof p.attachments === 'object') {
        for (const k of Object.keys(p.attachments)) {
          const ids = Array.isArray(p.attachments[k]) ? p.attachments[k].filter(id => ATTACHMENT_BY_ID[id]).slice(0, MAX_ATTACHMENTS) : [];
          if (WEAPONS[k] && ids.length) this.attachments[k] = ids;
        }
      }
      if (p.outfit && OUTFITS.some(o => o.id === p.outfit)) this.outfit = p.outfit;
      if (p.hat && HATS.some(o => o.id === p.hat)) this.hat = p.hat;
      if (p.killEffect && KILL_EFFECTS.some(o => o.id === p.killEffect)) this.killEffect = p.killEffect;
      if (p.killIcon && KILL_ICONS.some(o => o.id === p.killIcon)) this.killIcon = p.killIcon;
      if (p.trainingOpts && typeof p.trainingOpts === 'object') {
        const t = p.trainingOpts;
        if (DRILLS.some(d => d.id === t.drill)) this.training.drill = t.drill;
        if (TARGET_SIZES.some(s => s[0] === t.size)) this.training.size = t.size;
        if (TARGET_DISTS.some(s => s[0] === t.dist)) this.training.dist = t.dist;
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

  /** tab: play | class | skins | char | training | settings | controls; inGame: Match laeuft (Zurueck-Button zeigen) */
  showMenu(tab, inGame) {
    this.inGame = !!inGame;
    this.el.menu.classList.remove('hidden');
    this.el.backGame.classList.toggle('hidden', !this.inGame);
    if (this.el.classHint) this.el.classHint.classList.toggle('hidden', !this.inGame);
    if (tab) this._activateTab(tab);
  }
  hideMenu() {
    this.el.menu.classList.add('hidden');
    if (this.preview) this.preview.stop();
    if (this.charPreview) this.charPreview.stop();
  }
  get menuVisible() { return !this.el.menu.classList.contains('hidden'); }

  showPause() { this.el.pause.classList.remove('hidden'); }
  hidePause() { this.el.pause.classList.add('hidden'); }
  get pauseVisible() { return !this.el.pause.classList.contains('hidden'); }

  hideEnd() { this.el.end.classList.add('hidden'); }
  showEndAgain() { this.el.end.classList.remove('hidden'); }
  get endVisible() { return !this.el.end.classList.contains('hidden'); }
  /** Replay-Buttons auf dem Endscreen ein-/ausblenden (Training: keine Aufzeichnung) */
  setReplayAvailable(v) { const r = $('btn-replay'), s = $('btn-replay-save'); if (r) r.classList.toggle('hidden', !v); if (s) s.classList.toggle('hidden', !v); }

  showEnd(game, winner, won) {
    const e = this.el;
    e.end.classList.remove('hidden');

    if (!game.teamMode) {
      e.endTitle.textContent = won ? 'SIEG!' : 'MATCH BEENDET';
      if (game.mode === 'gungame') e.endSub.textContent = winner ? `${winner.name} hat alle Waffen durch (${winner.kills} Kills)` : '';
      else e.endSub.textContent = winner ? `${winner.name} gewinnt mit ${winner.kills} Kills` : '';
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
