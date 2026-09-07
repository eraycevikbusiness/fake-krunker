// ============================================================
// Einstellungen: Definition, Persistenz (localStorage), UI-Bau
// ============================================================

const KEY = 'krunkerclone.settings.v1';

/**
 * Schema für die Settings-UI. type: range | check | select
 */
export const SCHEMA = [
  { head: 'MAUS & SICHT' },
  { id: 'sens',        label: 'Mausempfindlichkeit', type: 'range', min: 0.05, max: 3, step: 0.01, def: 0.55, fmt: v => v.toFixed(2) },
  { id: 'adsSens',     label: 'ADS-Empfindlichkeit', type: 'range', min: 0.1, max: 1.5, step: 0.01, def: 0.7, fmt: v => v.toFixed(2) },
  { id: 'fov',         label: 'Sichtfeld (FOV)',     type: 'range', min: 60, max: 130, step: 1, def: 95, fmt: v => v + '°' },
  { id: 'invertY',     label: 'Y-Achse invertieren', type: 'check', def: false },
  { id: 'thirdPerson', label: 'Third-Person-Kamera', type: 'check', def: false },

  { head: 'GRAFIK' },
  { id: 'renderScale', label: 'Auflösungsskalierung', type: 'range', min: 0.5, max: 2, step: 0.05, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'shadows',     label: 'Schatten',            type: 'select', def: 'high', options: [['off','Aus'],['low','Niedrig'],['high','Hoch'],['ultra','Ultra']] },
  { id: 'antialias',   label: 'Kantenglättung *',    type: 'check', def: true },
  { id: 'fog',         label: 'Nebel',               type: 'check', def: true },
  { id: 'particles',   label: 'Partikel-Menge',      type: 'range', min: 0, max: 2, step: 0.1, def: 1, fmt: v => Math.round(v * 100) + '%' },
  { id: 'decals',      label: 'Einschusslöcher',     type: 'check', def: true },
  { id: 'ragdolls',    label: 'Todes-Animationen',   type: 'check', def: true },
  { id: 'maxFps',      label: 'FPS-Limit',           type: 'select', def: '0', options: [['0','Unbegrenzt'],['30','30'],['60','60'],['120','120'],['144','144'],['240','240']] },

  { head: 'HUD' },
  { id: 'crossSize',   label: 'Fadenkreuz-Größe',    type: 'range', min: 2, max: 20, step: 1, def: 8, fmt: v => v + 'px' },
  { id: 'crossGap',    label: 'Fadenkreuz-Abstand',  type: 'range', min: 0, max: 20, step: 1, def: 6, fmt: v => v + 'px' },
  { id: 'crossDot',    label: 'Mittelpunkt',         type: 'check', def: true },
  { id: 'crossColor',  label: 'Fadenkreuz-Farbe',    type: 'select', def: '#ffffff', options: [['#ffffff','Weiß'],['#00ff66','Grün'],['#ffcc00','Gelb'],['#ff3355','Rot'],['#33ccff','Cyan'],['#ff00ff','Magenta']] },
  { id: 'dynCross',    label: 'Dynamisches Fadenkreuz', type: 'check', def: true },
  { id: 'showDmg',     label: 'Schadenszahlen',      type: 'check', def: true },
  { id: 'showMinimap', label: 'Minimap',             type: 'check', def: true },
  { id: 'showFps',     label: 'FPS-Anzeige',         type: 'check', def: false },

  { head: 'AUDIO' },
  { id: 'volMaster',   label: 'Gesamtlautstärke',    type: 'range', min: 0, max: 1, step: 0.01, def: 0.6, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volSfx',      label: 'Effekte',             type: 'range', min: 0, max: 1, step: 0.01, def: 1.0, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volSteps',    label: 'Schritte',            type: 'range', min: 0, max: 1, step: 0.01, def: 0.8, fmt: v => Math.round(v * 100) + '%' },
  { id: 'volUi',       label: 'Interface',           type: 'range', min: 0, max: 1, step: 0.01, def: 0.7, fmt: v => Math.round(v * 100) + '%' },

  { head: 'GAMEPLAY' },
  { id: 'toggleAds',   label: 'Zielen umschalten',   type: 'check', def: false },
  { id: 'toggleCrouch',label: 'Ducken umschalten',   type: 'check', def: false },
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

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      for (const s of SCHEMA) {
        if (s.id && data[s.id] !== undefined && typeof data[s.id] === typeof s.def) {
          settings[s.id] = data[s.id];
        }
      }
    }
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

/** Baut die Settings-UI in den Container und ruft onChange(id, value) auf */
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
    const row = document.createElement('div');
    row.className = 'set-row';

    const lbl = document.createElement('div');
    lbl.className = 'sr-label';
    lbl.textContent = s.label;
    row.appendChild(lbl);

    const ctl = document.createElement('div');
    ctl.className = 'sr-ctl';

    let input, valEl = null;
    if (s.type === 'range') {
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
