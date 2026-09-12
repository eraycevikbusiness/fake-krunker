// ============================================================
// Einstellungen: Definition, Persistenz (localStorage), UI-Bau
// ============================================================

const KEY = 'fragstorm.settings.v2';
const LEGACY_KEYS = ['krunkerclone.settings.v1'];

/**
 * Schema für die Settings-UI.
 * type: range | check | select | color | preview | button
 * (preview/button haben keinen gespeicherten Wert, nur einen `key`)
 */
export const SCHEMA = [
  { head: 'MAUS & SICHT' },
  { id: 'sens',        label: 'Mausempfindlichkeit', type: 'range', min: 0.05, max: 3, step: 0.01, def: 0.55, fmt: v => v.toFixed(2) },
  { id: 'adsSens',     label: 'ADS-Empfindlichkeit', type: 'range', min: 0.1, max: 1.5, step: 0.01, def: 0.7, fmt: v => v.toFixed(2) },
  { id: 'fov',         label: 'Sichtfeld (FOV)',     type: 'range', min: 60, max: 130, step: 1, def: 95, fmt: v => v + '°' },
  { id: 'invertY',     label: 'Y-Achse invertieren', type: 'check', def: false },
  { id: 'thirdPerson', label: 'Third-Person-Kamera', type: 'check', def: false },

  { head: 'GRAFIK' },
  { id: 'autoQuality', label: 'Auto-Auflösung (FPS halten)', type: 'check', def: true },
  { id: 'renderScale', label: 'Auflösungsskalierung', type: 'range', min: 0.5, max: 2, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'shadows',     label: 'Schatten',            type: 'select', def: 'high', options: [['off','Aus'],['low','Niedrig'],['high','Hoch'],['ultra','Ultra']] },
  { id: 'postfx',      label: 'Post-Processing (HDR, Tonemapping, Vignette)', type: 'check', def: true },
  { id: 'ssao',        label: 'Umgebungsverdeckung (SSAO)', type: 'check', def: true },
  { id: 'bloom',       label: 'Bloom / Leuchten',    type: 'check', def: true },
  { id: 'antialias',   label: 'Kantenglättung *',    type: 'check', def: true },
  { id: 'fog',         label: 'Nebel',               type: 'check', def: true },
  { id: 'particles',   label: 'Partikel-Menge',      type: 'range', min: 0, max: 2, step: 0.1, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'decals',      label: 'Einschusslöcher',     type: 'check', def: true },
  { id: 'ragdolls',    label: 'Ragdoll-Tode',        type: 'check', def: true },
  { id: 'blood',       label: 'Blut-Decals',         type: 'check', def: true },
  { id: 'killcam',     label: 'Killcam (Replay beim Tod)', type: 'check', def: true },
  { id: 'killEffects', label: 'Kill-Effekte (Konfetti usw.)', type: 'check', def: true },
  { id: 'maxFps',      label: 'FPS-Limit',           type: 'select', def: '0', options: [['0','Unbegrenzt'],['30','30'],['60','60'],['120','120'],['144','144'],['240','240']] },

  { head: 'FADENKREUZ' },
  { key: 'crossPreview', type: 'preview' },
  { id: 'crossStyle',  label: 'Form',                type: 'select', def: 'cross', options: [['cross','Kreuz'],['tee','T-Form'],['x','X'],['circle','Kreis'],['dot','Nur Punkt'],['circlecross','Kreis + Kreuz']] },
  { id: 'crossSize',   label: 'Länge',               type: 'range', min: 1, max: 24, step: 1, def: 8, fmt: v => v + 'px' },
  { id: 'crossThick',  label: 'Dicke',               type: 'range', min: 1, max: 6, step: 0.5, def: 2, fmt: v => v + 'px' },
  { id: 'crossGap',    label: 'Abstand zur Mitte',   type: 'range', min: 0, max: 20, step: 1, def: 5, fmt: v => v + 'px' },
  { id: 'crossDot',    label: 'Mittelpunkt',         type: 'check', def: true },
  { id: 'crossDotSize',label: 'Punktgröße',          type: 'range', min: 1, max: 6, step: 0.5, def: 2, fmt: v => v + 'px' },
  { id: 'crossColor',  label: 'Farbe',               type: 'color', def: '#ffffff' },
  { id: 'crossHitColor',label: 'Treffer-Farbe',      type: 'color', def: '#ff4444' },
  { id: 'crossOutline',label: 'Schwarzer Rand',      type: 'check', def: true },
  { id: 'crossOpacity',label: 'Deckkraft',           type: 'range', min: 0.2, max: 1, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'dynCross',    label: 'Dynamisch (weitet sich mit Streuung)', type: 'check', def: true },

  { head: 'INTERFACE' },
  { id: 'uiTheme',     label: 'Design',              type: 'select', def: 'dark', options: [['dark','Dunkel'],['oled','Schwarz (OLED)'],['neon','Neon'],['light','Hell']] },
  { id: 'uiAnim',      label: 'Interface-Animationen', type: 'check', def: true },
  { id: 'uiGlass',     label: 'Glas-Effekt (Unschärfe hinter Panels)', type: 'check', def: true },

  { head: 'HUD & BARRIEREFREIHEIT' },
  { id: 'hudScale',    label: 'HUD-Größe',           type: 'range', min: 0.8, max: 1.6, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'colorblind',  label: 'Teamfarben (Farbenblind-Modus)', type: 'select', def: 'off', options: [['off','Rot / Blau'],['orange','Orange / Blau'],['magenta','Magenta / Cyan'],['yellow','Gelb / Violett']] },
  { id: 'botChat',     label: 'Bot-Chat',            type: 'check', def: true },
  { id: 'touch',       label: 'Touch-Steuerung (Handy/Tablet)', type: 'select', def: 'auto', options: [['auto','Automatisch'],['on','An'],['off','Aus']] },
  { id: 'showDmg',     label: 'Schadenszahlen',      type: 'check', def: true },
  { id: 'showMinimap', label: 'Minimap',             type: 'check', def: true },
  { id: 'showFps',     label: 'FPS-Anzeige',         type: 'check', def: false },

  { head: 'AUDIO' },
  { id: 'volMaster',   label: 'Gesamtlautstärke',    type: 'range', min: 0, max: 1, step: 0.01, def: 0.6, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volSfx',      label: 'Effekte',             type: 'range', min: 0, max: 1, step: 0.01, def: 1.0, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volSteps',    label: 'Schritte',            type: 'range', min: 0, max: 1, step: 0.01, def: 0.8, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volUi',       label: 'Interface',           type: 'range', min: 0, max: 1, step: 0.01, def: 0.7, fmt: v => Math.round(v * 100) + '%' },
  { id: 'hitSound',    label: 'Hitsound',            type: 'select', def: 'classic', options: [['classic','Standard'],['click','Klick'],['ping','Ping'],['bass','Bass'],['retro','Retro (8-Bit)'],['wood','Holz'],['bell','Glocke'],['none','Aus']] },
  { id: 'volHit',      label: 'Hitsound-Lautstärke', type: 'range', min: 0, max: 1.5, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { key: 'hitPreview', label: 'Hitsound anhören',    type: 'button', text: 'ABSPIELEN' },

  { head: 'GAMEPLAY' },
  { id: 'aimAssist',   label: 'Zielhilfe',           type: 'select', def: 'off', options: [['off','Aus'],['low','Leicht'],['mid','Mittel'],['high','Stark']] },
  { id: 'killstreaks', label: 'Killstreaks (UAV, Schild, Luftschlag)', type: 'check', def: true },
  { id: 'sprintMode',  label: 'Sprint',              type: 'select', def: 'hold', options: [['hold','Shift halten'],['toggle','Shift umschalten'],['always','Immer rennen']] },
  { id: 'crouchKey',   label: 'Ducken-Taste',        type: 'select', def: 'c', options: [['c','C (+ Strg)'],['ctrl','Strg (+ C)'],['alt','Alt (+ C)']] },
  { id: 'toggleAds',   label: 'Zielen umschalten',   type: 'check', def: false },
  { id: 'toggleCrouch',label: 'Ducken umschalten',   type: 'check', def: false },
  { id: 'autoJump',    label: 'Auto-Bunnyhop (Leertaste halten)', type: 'check', def: true },
  { id: 'autoReload',  label: 'Auto-Nachladen',      type: 'check', def: true },
  { id: 'viewBob',     label: 'Kamerawackeln',       type: 'range', min: 0, max: 2, step: 0.1, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'shake',       label: 'Screenshake',         type: 'range', min: 0, max: 2, step: 0.1, def: 1, fmt: v => Math.round(v * 100) + '%' },
];

function defaults() {
  const o = {};
  for (const s of SCHEMA) if (s.id) o[s.id] = s.def;
  return o;
}

export const settings = defaults();

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function applyData(data) {
  if (!data || typeof data !== 'object') return;
  for (const s of SCHEMA) {
    if (!s.id || data[s.id] === undefined) continue;
    const v = data[s.id];
    if (typeof v !== typeof s.def) continue;
    if (s.type === 'select' && !s.options.some(o => o[0] === v)) continue;
    if (s.type === 'range' && (!isFinite(v) || v < s.min || v > s.max)) continue;
    if (s.type === 'color' && !HEX_RE.test(v)) continue;
    settings[s.id] = v;
  }
}

export function loadSettings() {
  try {
    let raw = localStorage.getItem(KEY);
    if (!raw) {
      // Alte Speicherstaende uebernehmen
      for (const k of LEGACY_KEYS) {
        raw = localStorage.getItem(k);
        if (raw) break;
      }
    }
    if (raw) applyData(JSON.parse(raw));
  } catch (e) { /* localStorage kann blockiert sein */ }
  return settings;
}

export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {}
}

export function resetSettings() {
  Object.assign(settings, defaults());
  saveSettings();
}

/**
 * Baut die Settings-UI in den Container und ruft onChange(id, value) auf.
 * Fuer `preview`-Eintraege wird onChange(key, element) einmal beim Bau
 * aufgerufen, fuer `button`-Eintraege bei jedem Klick onChange(key, null).
 */
export function buildSettingsUI(container, onChange) {
  container.innerHTML = '';
  for (const s of SCHEMA) {
    if (s.head) {
      const h = document.createElement('div');
      h.className = 'set-head';
      h.textContent = s.head;
      container.appendChild(h);
      continue;
    }
    if (s.type === 'preview') {
      const box = document.createElement('div');
      box.className = 'set-preview';
      box.dataset.key = s.key;
      const cv = document.createElement('canvas');
      cv.width = 220; cv.height = 120;
      box.appendChild(cv);
      container.appendChild(box);
      onChange && onChange(s.key, box);
      continue;
    }

    const row = document.createElement('div');
    row.className = 'set-row';

    const lbl = document.createElement('div');
    lbl.className = 'sr-label';
    lbl.textContent = s.label;
    row.appendChild(lbl);

    const ctl = document.createElement('div');
    ctl.className = 'sr-ctl';

    let input, valEl = null;
    if (s.type === 'button') {
      input = document.createElement('button');
      input.type = 'button';
      input.className = 'sr-btn';
      input.textContent = s.text || 'OK';
      input.addEventListener('click', () => onChange && onChange(s.key, null));
    } else if (s.type === 'range') {
      input = document.createElement('input');
      input.type = 'range';
      input.min = s.min; input.max = s.max; input.step = s.step;
      input.value = settings[s.id];
      valEl = document.createElement('div');
      valEl.className = 'sr-val';
      valEl.textContent = s.fmt ? s.fmt(+settings[s.id]) : settings[s.id];
      input.addEventListener('input', () => {
        const v = parseFloat(input.value);
        settings[s.id] = v;
        if (valEl) valEl.textContent = s.fmt ? s.fmt(v) : v;
        saveSettings();
        onChange && onChange(s.id, v);
      });
    } else if (s.type === 'check') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!settings[s.id];
      input.addEventListener('change', () => {
        settings[s.id] = input.checked;
        saveSettings();
        onChange && onChange(s.id, input.checked);
      });
    } else if (s.type === 'color') {
      input = document.createElement('input');
      input.type = 'color';
      input.value = settings[s.id];
      valEl = document.createElement('div');
      valEl.className = 'sr-val';
      valEl.textContent = settings[s.id];
      input.addEventListener('input', () => {
        settings[s.id] = input.value;
        if (valEl) valEl.textContent = input.value;
        saveSettings();
        onChange && onChange(s.id, input.value);
      });
    } else {
      input = document.createElement('select');
      for (const [v, t] of s.options) {
        const op = document.createElement('option');
        op.value = v; op.textContent = t;
        input.appendChild(op);
      }
      input.value = settings[s.id];
      input.addEventListener('change', () => {
        settings[s.id] = input.value;
        saveSettings();
        onChange && onChange(s.id, input.value);
      });
    }

    ctl.appendChild(input);
    if (valEl) ctl.appendChild(valEl);
    row.appendChild(ctl);
    container.appendChild(row);
  }
}
