// ============================================================
// Teamfarben, inkl. Farbenblind-Paletten (Einstellung `colorblind`).
// Alle Stellen, die Teamfarben brauchen (Figuren, HUD, Minimap,
// Killfeed, Toasts), holen sie hier ab.
// ============================================================

import { settings } from './settings.js';

const PALETTES = {
  off:      { red: { hex: 0xd94a4a, css: '#ff6b6b', accent: 0xff8a8a, bg: 'rgba(200,50,50,0.55)' },  blue: { hex: 0x4a86d9, css: '#7ab4ff', accent: 0x8ab8ff, bg: 'rgba(50,110,200,0.55)' } },
  orange:   { red: { hex: 0xff8a1f, css: '#ffa14d', accent: 0xffc27a, bg: 'rgba(230,120,20,0.55)' },  blue: { hex: 0x2f80ed, css: '#6fa8ff', accent: 0x9cc4ff, bg: 'rgba(40,110,220,0.55)' } },
  magenta:  { red: { hex: 0xd63cd6, css: '#ee6cee', accent: 0xf29cf2, bg: 'rgba(190,40,190,0.55)' },  blue: { hex: 0x22b8b8, css: '#5fe0e0', accent: 0x9ff0f0, bg: 'rgba(20,160,160,0.55)' } },
  yellow:   { red: { hex: 0xe6c200, css: '#ffd633', accent: 0xffe680, bg: 'rgba(200,170,0,0.55)' },   blue: { hex: 0x5a3fd6, css: '#9a86ff', accent: 0xbcb0ff, bg: 'rgba(80,60,200,0.55)' } },
};

export function teamPalette() {
  return PALETTES[settings.colorblind] || PALETTES.off;
}

/** Hex-Zahl der Teamfarbe (Figuren, Effekte) */
export function teamHex(team) {
  const p = teamPalette();
  return (p[team] || p.red).hex;
}
/** CSS-Farbe (Namensschilder, HUD) */
export function teamCss(team) {
  const p = teamPalette();
  return (p[team] || p.red).css;
}
export function teamAccent(team) {
  const p = teamPalette();
  return (p[team] || p.red).accent;
}

/** CSS-Variablen fuer das HUD setzen (Killfeed, Match-Leiste, Toasts, Chat) */
export function applyTeamCss(el, override) {
  const p = teamPalette();
  const r = (override && override.red) || p.red, b = (override && override.blue) || p.blue;
  const root = el || document.documentElement;
  root.style.setProperty('--team-red', r.css);
  root.style.setProperty('--team-red-bg', r.bg);
  root.style.setProperty('--team-blue', b.css);
  root.style.setProperty('--team-blue-bg', b.bg);
}
