// ============================================================
// Waffen-Skins: Farbvarianten, die die Materialien der Bauteile
// austauschen. Ein Skin ist eine Zuordnung Material-Schluessel ->
// neues Material {c,m,r,e}; Camo faerbt Grundflaechen im Muster.
// ============================================================

import { MAT } from './weapons.js';

const M = (c, m, r, e) => ({ c, m, r, e: e || 0 });

// Umkehr-Zuordnung: Materialobjekt -> Schluessel ("body", "steel", ...)
const KEY_OF = new Map(Object.entries(MAT).map(([k, v]) => [v, k]));

// Schluessel, die bei Camo im Muster eingefaerbt werden
const CAMO_KEYS = new Set(['body', 'dark', 'tan', 'green', 'wood', 'wood2', 'metal', 'grip', 'rubber']);

export const SKINS = [
  { id: 'default', name: 'Standard', desc: 'Werkszustand', swatch: ['#2e3033', '#8a929e', '#2ee6ff'], map: null },
  {
    id: 'gold', name: 'Gold', desc: 'Poliertes Gold, dunkle Griffe', swatch: ['#d8ad2a', '#fff0b0', '#1b1b1f'],
    map: {
      body: M(0xd8ad2a, 1.0, 0.26), dark: M(0x8a6a15, 1.0, 0.34), black: M(0x2a2116, 0.6, 0.5),
      metal: M(0xe6c04a, 1.0, 0.22), steel: M(0xf0d070, 1.0, 0.18), steelDark: M(0xb8901f, 1.0, 0.3),
      chrome: M(0xfff0b0, 1.0, 0.10), edge: M(0xfff6d0, 1.0, 0.08),
      wood: M(0x3a2a1a, 0.2, 0.6), wood2: M(0x2a1e12, 0.2, 0.65),
      grip: M(0x1b1b1f, 0.3, 0.7), rubber: M(0x1b1b1f, 0.2, 0.8), wrap: M(0x161020, 0.1, 0.8), wrap2: M(0x0c0814, 0.1, 0.8),
      tan: M(0xc9a54a, 1.0, 0.3), green: M(0xb8901f, 1.0, 0.3), red: M(0xd8ad2a, 1.0, 0.3),
      glow: M(0xffd257, 0, 0.4, 2.4), glowSoft: M(0xffd257, 0, 0.4, 1.2), glowR: M(0xffd257, 0, 0.4, 2.4),
      accent: M(0xffffff, 0.8, 0.2), brass: M(0xfff0b0, 1.0, 0.15), gold: M(0xfff0b0, 1.0, 0.12),
    },
  },
  {
    id: 'neon', name: 'Neon', desc: 'Schwarz mit Magenta-Leuchtlinien', swatch: ['#12111c', '#ff2ee6', '#2ee6ff'],
    map: {
      body: M(0x12111c, 0.7, 0.30), dark: M(0x0b0a12, 0.6, 0.35), black: M(0x07070c, 0.5, 0.4),
      metal: M(0x2a2540, 0.9, 0.28), steel: M(0x3a3358, 1.0, 0.22), steelDark: M(0x231f36, 1.0, 0.3),
      chrome: M(0xd0c8ff, 1.0, 0.10), edge: M(0xff9df3, 0, 0.3, 2.2),
      wood: M(0x1a1226, 0.3, 0.5), wood2: M(0x120c1c, 0.3, 0.55),
      grip: M(0x0f0d16, 0.2, 0.75), rubber: M(0x0f0d16, 0.1, 0.85), wrap: M(0x1a0f2a, 0.1, 0.8), wrap2: M(0x0c0714, 0.1, 0.8),
      tan: M(0x1e1830, 0.6, 0.4), green: M(0x161228, 0.6, 0.4), red: M(0xff2ee6, 0, 0.4, 2.0),
      glow: M(0xff2ee6, 0, 0.4, 3.0), glowSoft: M(0xff2ee6, 0, 0.4, 1.5), glowR: M(0x2ee6ff, 0, 0.4, 3.0),
      accent: M(0xff2ee6, 0, 0.4, 2.0), brass: M(0x8f7fd6, 1.0, 0.3), gold: M(0xff2ee6, 0.2, 0.3, 1.4),
    },
  },
  {
    id: 'camo', name: 'Camo', desc: 'Woodland-Tarnmuster', swatch: ['#4a5a3a', '#8a8560', '#2f3a2a'],
    map: {
      steel: M(0x6c7364, 1.0, 0.4), steelDark: M(0x4a5045, 1.0, 0.45), chrome: M(0xc4ccd6, 1.0, 0.12), edge: M(0xe8eef6, 1.0, 0.10),
      glow: M(0xb8ff5c, 0, 0.4, 2.0), glowSoft: M(0xb8ff5c, 0, 0.4, 1.0), glowR: M(0xb8ff5c, 0, 0.4, 2.0),
      accent: M(0xd8c68a, 0.3, 0.5), brass: M(0x8a7a3a, 1.0, 0.4), gold: M(0x8a7a3a, 1.0, 0.35), red: M(0x5a3a2a, 0.2, 0.6),
    },
    camo: [M(0x4a5a3a, 0.1, 0.8), M(0x8a8560, 0.1, 0.8), M(0x2f3a2a, 0.1, 0.8), M(0x6b5a3c, 0.1, 0.8)],
  },
  {
    id: 'crimson', name: 'Crimson', desc: 'Blutrot und Schwarz, rotes Leuchten', swatch: ['#8f1a24', '#141014', '#ff3b3b'],
    map: {
      body: M(0x8f1a24, 0.5, 0.38), dark: M(0x141014, 0.6, 0.35), black: M(0x0b0809, 0.5, 0.4),
      metal: M(0x3a1418, 0.9, 0.3), steel: M(0x5a1e24, 1.0, 0.25), steelDark: M(0x3c1418, 1.0, 0.3),
      chrome: M(0xffd0d0, 1.0, 0.10), edge: M(0xffe4e4, 1.0, 0.08),
      wood: M(0x3a1216, 0.2, 0.55), wood2: M(0x26090c, 0.2, 0.6),
      grip: M(0x1a1416, 0.2, 0.75), rubber: M(0x1a1416, 0.1, 0.85), wrap: M(0x2a0a10, 0.1, 0.8), wrap2: M(0x160408, 0.1, 0.8),
      tan: M(0x6e1a22, 0.5, 0.4), green: M(0x5a141c, 0.5, 0.4), red: M(0xff3b3b, 0, 0.4, 1.6),
      glow: M(0xff3b3b, 0, 0.4, 2.8), glowSoft: M(0xff3b3b, 0, 0.4, 1.4), glowR: M(0xff3b3b, 0, 0.4, 2.8),
      accent: M(0xffb0b0, 0.6, 0.3), brass: M(0xc46a3a, 1.0, 0.3), gold: M(0xd8d8d8, 1.0, 0.2),
    },
  },
  {
    id: 'frost', name: 'Frost', desc: 'Weiss mit Eisblau', swatch: ['#e8eef2', '#9fb4c4', '#8fe6ff'],
    map: {
      body: M(0xe8eef2, 0.3, 0.45), dark: M(0x9fb4c4, 0.5, 0.4), black: M(0x5d7180, 0.5, 0.45),
      metal: M(0xc4d4e0, 0.9, 0.3), steel: M(0xd0e4f0, 1.0, 0.15), steelDark: M(0xa8bfd0, 1.0, 0.25),
      chrome: M(0xf0faff, 1.0, 0.08), edge: M(0xffffff, 1.0, 0.06),
      wood: M(0xd8dee4, 0.1, 0.6), wood2: M(0xbcc6cf, 0.1, 0.62),
      grip: M(0x6e8496, 0.2, 0.75), rubber: M(0x6e8496, 0.1, 0.85), wrap: M(0x7d92a5, 0.1, 0.8), wrap2: M(0x5a6e80, 0.1, 0.8),
      tan: M(0xd8e2ea, 0.3, 0.5), green: M(0xc8d6e0, 0.3, 0.5), red: M(0x8fe6ff, 0, 0.4, 1.4),
      glow: M(0x8fe6ff, 0, 0.4, 2.6), glowSoft: M(0x8fe6ff, 0, 0.4, 1.3), glowR: M(0x8fe6ff, 0, 0.4, 2.6),
      accent: M(0xffffff, 0.6, 0.2), brass: M(0xe0e8f0, 1.0, 0.2), gold: M(0xeaf2f8, 1.0, 0.15),
    },
  },
  {
    id: 'obsidian', name: 'Obsidian', desc: 'Tiefschwarz, glaenzend, Goldkanten', swatch: ['#0c0c0e', '#d8ad2a', '#24242a'],
    map: {
      body: M(0x0c0c0e, 0.8, 0.14), dark: M(0x08080a, 0.7, 0.18), black: M(0x050506, 0.6, 0.2),
      metal: M(0x1a1a1e, 1.0, 0.14), steel: M(0x24242a, 1.0, 0.12), steelDark: M(0x141417, 1.0, 0.16),
      chrome: M(0xd8ad2a, 1.0, 0.14), edge: M(0xffe08a, 1.0, 0.10),
      wood: M(0x151214, 0.4, 0.4), wood2: M(0x0e0c0d, 0.4, 0.45),
      grip: M(0x121214, 0.3, 0.6), rubber: M(0x121214, 0.2, 0.7), wrap: M(0x14100c, 0.2, 0.7), wrap2: M(0x0a0806, 0.2, 0.7),
      tan: M(0x141416, 0.8, 0.2), green: M(0x101012, 0.8, 0.2), red: M(0xd8ad2a, 1.0, 0.2),
      glow: M(0xffc447, 0, 0.4, 2.2), glowSoft: M(0xffc447, 0, 0.4, 1.1), glowR: M(0xffc447, 0, 0.4, 2.2),
      accent: M(0xd8ad2a, 1.0, 0.2), brass: M(0xd8ad2a, 1.0, 0.2), gold: M(0xf0c850, 1.0, 0.14),
    },
  },
];

export const SKIN_BY_ID = {};
for (const s of SKINS) SKIN_BY_ID[s.id] = s;

/** Bauteilliste mit angewendetem Skin (neue Objekte, Original bleibt unveraendert) */
export function applySkin(parts, skinId) {
  const skin = SKIN_BY_ID[skinId];
  if (!skin || (!skin.map && !skin.camo)) return parts;
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const key = KEY_OF.get(p.color);
    let mat = p.color;
    if (key && skin.map && skin.map[key]) mat = skin.map[key];
    else if (key && skin.camo && CAMO_KEYS.has(key)) {
      // Pseudo-Zufall aus dem Index -> stabiles, fleckiges Muster
      const h = ((i * 2654435761) >>> 0) % skin.camo.length;
      mat = skin.camo[h];
    }
    out[i] = mat === p.color ? p : Object.assign({}, p, { color: mat });
  }
  return out;
}

/** Zufaelliger Skin (fuer Bots), gewichtet zugunsten Standard */
export function randomSkinId() {
  if (Math.random() < 0.45) return 'default';
  return SKINS[1 + ((Math.random() * (SKINS.length - 1)) | 0)].id;
}
