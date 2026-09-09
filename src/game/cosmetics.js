// ============================================================
// Kosmetik der Spielfigur: Outfits (Farben), Kopfbedeckungen,
// Kill-Effekte und Kill-Icons. Reine Daten + Geometrie der Huete.
// Hut-Koordinaten: Kopfraum, Ursprung am Hals, Kopf ist 0.6 hoch,
// Vorne = -Z. Farbtokens: 'p' = Primaerfarbe (Team/Outfit-Akzent),
// 's' = Sekundaerfarbe (Outfit-Koerperfarbe), sonst Hex.
// ============================================================

import { mergeBoxes } from '../fx/geom.js';

const HEAD = 0.6;

// ------------------------------------------------------------
// Outfits: body = Rumpf/Oberarme, pants = Hose, accent = Akzente
// (im Teammodus bleibt der Akzent die Teamfarbe -> Erkennbarkeit)
// ------------------------------------------------------------
export const OUTFITS = [
  { id: 'team',    name: 'Team',     desc: 'Teamfarbe / Standard', body: null,     pants: 0x2a3040, accent: null,     swatch: ['#d94a4a', '#4a86d9', '#2a3040'] },
  { id: 'shadow',  name: 'Shadow',   desc: 'Schwarz und Anthrazit', body: 0x1a1c22, pants: 0x0f1014, accent: 0x5c6270, swatch: ['#1a1c22', '#0f1014', '#5c6270'] },
  { id: 'desert',  name: 'Desert',   desc: 'Sand und Khaki',        body: 0xc9a86e, pants: 0x8a7248, accent: 0x5a4a2c, swatch: ['#c9a86e', '#8a7248', '#5a4a2c'] },
  { id: 'toxic',   name: 'Toxic',    desc: 'Giftgruen auf Schwarz', body: 0x1e2a1a, pants: 0x121812, accent: 0x9dff2e, swatch: ['#1e2a1a', '#121812', '#9dff2e'] },
  { id: 'royal',   name: 'Royal',    desc: 'Violett mit Gold',      body: 0x4a2a7a, pants: 0x2a1848, accent: 0xd8ad2a, swatch: ['#4a2a7a', '#2a1848', '#d8ad2a'] },
  { id: 'arctic',  name: 'Arctic',   desc: 'Weiss und Eisblau',     body: 0xe8eef2, pants: 0x9fb4c4, accent: 0x5fc8ff, swatch: ['#e8eef2', '#9fb4c4', '#5fc8ff'] },
  { id: 'lava',    name: 'Lava',     desc: 'Dunkelrot mit Orange',  body: 0x6a1a1a, pants: 0x2a0e0e, accent: 0xff8a1f, swatch: ['#6a1a1a', '#2a0e0e', '#ff8a1f'] },
  { id: 'ocean',   name: 'Ocean',    desc: 'Tiefblau mit Tuerkis',  body: 0x123a5a, pants: 0x0c2238, accent: 0x2ee6c8, swatch: ['#123a5a', '#0c2238', '#2ee6c8'] },
  { id: 'gold',    name: 'Gold',     desc: 'Angeber-Gold',          body: 0xd8ad2a, pants: 0x3a2a10, accent: 0xfff0b0, swatch: ['#d8ad2a', '#3a2a10', '#fff0b0'] },
  { id: 'camo',    name: 'Camo',     desc: 'Woodland',              body: 0x4a5a3a, pants: 0x2f3a2a, accent: 0x8a8560, swatch: ['#4a5a3a', '#2f3a2a', '#8a8560'] },
  { id: 'candy',   name: 'Candy',    desc: 'Pink und Mint',         body: 0xff6ec7, pants: 0x3a2a3a, accent: 0x7fffd4, swatch: ['#ff6ec7', '#3a2a3a', '#7fffd4'] },
  { id: 'neon',    name: 'Neon',     desc: 'Schwarz mit Magenta',   body: 0x12111c, pants: 0x0b0a12, accent: 0xff2ee6, swatch: ['#12111c', '#0b0a12', '#ff2ee6'] },
];
export const OUTFIT_BY_ID = {};
for (const o of OUTFITS) OUTFIT_BY_ID[o.id] = o;

// ------------------------------------------------------------
// Kopfbedeckungen
// ------------------------------------------------------------
const M = (c, m, r, e) => ({ c, m, r, e: e || 0 });
const P = (x, y, z, w, h, d, color, rot) => ({ x, y, z, w, h, d, color, rot });

export const HATS = [
  { id: 'none',     name: 'Ohne',        icon: '🙂', parts: () => [] },
  {
    id: 'cap', name: 'Basecap', icon: '🧢',
    parts: (p, s) => [
      P(0, HEAD - 0.02, 0, HEAD + 0.06, 0.16, HEAD + 0.06, M(p, 0, 0.8)),
      P(0, HEAD - 0.06, -HEAD / 2 - 0.08, HEAD, 0.06, 0.26, M(p, 0, 0.8)),
      P(0, HEAD + 0.06, 0, 0.05, 0.03, 0.05, M(s, 0, 0.8)),
    ],
  },
  {
    id: 'backcap', name: 'Cap (verkehrt)', icon: '🧢',
    parts: (p, s) => [
      P(0, HEAD - 0.02, 0, HEAD + 0.06, 0.16, HEAD + 0.06, M(p, 0, 0.8)),
      P(0, HEAD - 0.06, HEAD / 2 + 0.08, HEAD, 0.06, 0.26, M(p, 0, 0.8)),
      P(0, HEAD + 0.06, 0, 0.05, 0.03, 0.05, M(s, 0, 0.8)),
    ],
  },
  {
    id: 'beanie', name: 'Beanie', icon: '🎿',
    parts: (p, s) => [
      P(0, HEAD - 0.06, 0, HEAD + 0.08, 0.22, HEAD + 0.08, M(p, 0, 0.92)),
      P(0, HEAD + 0.14, 0, HEAD - 0.06, 0.12, HEAD - 0.06, M(p, 0, 0.92)),
      P(0, HEAD + 0.28, 0, 0.16, 0.14, 0.16, M(s, 0, 0.95)),
      P(0, HEAD - 0.08, 0, HEAD + 0.10, 0.06, HEAD + 0.10, M(s, 0, 0.9)),
    ],
  },
  {
    id: 'helmet', name: 'Helm', icon: '🪖',
    parts: (p) => [
      P(0, HEAD - 0.10, 0, HEAD + 0.12, 0.30, HEAD + 0.12, M(0x4a5a3a, 0.2, 0.7)),
      P(0, HEAD + 0.16, 0, HEAD - 0.04, 0.10, HEAD - 0.04, M(0x4a5a3a, 0.2, 0.7)),
      P(0, HEAD - 0.12, 0, HEAD + 0.20, 0.05, HEAD + 0.20, M(0x3a4a2e, 0.2, 0.7)),
      P(0, HEAD - 0.02, 0, HEAD + 0.14, 0.05, HEAD + 0.14, M(p, 0, 0.8)),          // Band in Teamfarbe
      P(0, 0.15, -HEAD / 2 - 0.005, 0.05, 0.10, 0.02, M(0x2a2a2a, 0.3, 0.6)),      // Kinnriemen
    ],
  },
  {
    id: 'tophat', name: 'Zylinder', icon: '🎩',
    parts: (p) => [
      P(0, HEAD - 0.01, 0, HEAD + 0.24, 0.04, HEAD + 0.24, M(0x121214, 0.2, 0.55)),
      P(0, HEAD + 0.03, 0, HEAD - 0.08, 0.46, HEAD - 0.08, M(0x121214, 0.2, 0.55)),
      P(0, HEAD + 0.05, 0, HEAD - 0.06, 0.07, HEAD - 0.06, M(p, 0.3, 0.6)),
    ],
  },
  {
    id: 'crown', name: 'Krone', icon: '👑',
    parts: () => {
      const g = M(0xf0c850, 1.0, 0.25);
      const out = [P(0, HEAD - 0.02, 0, HEAD + 0.06, 0.12, HEAD + 0.06, g)];
      for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        out.push(P(x * (HEAD / 2 + 0.01), HEAD + 0.12, z * (HEAD / 2 + 0.01), 0.09, 0.16, 0.09, g));
      }
      out.push(P(0, HEAD + 0.12, -HEAD / 2 - 0.02, 0.09, 0.2, 0.06, g));
      out.push(P(0, HEAD + 0.05, -HEAD / 2 - 0.045, 0.07, 0.07, 0.03, M(0xff3b3b, 0, 0.3, 1.2)));
      out.push(P(0.2, HEAD + 0.03, -HEAD / 2 - 0.04, 0.05, 0.05, 0.02, M(0x2ee6ff, 0, 0.3, 1.2)));
      out.push(P(-0.2, HEAD + 0.03, -HEAD / 2 - 0.04, 0.05, 0.05, 0.02, M(0x2ee6ff, 0, 0.3, 1.2)));
      return out;
    },
  },
  {
    id: 'horns', name: 'Hörner', icon: '😈',
    parts: () => [
      P(0.24, HEAD + 0.08, 0, 0.09, 0.28, 0.09, M(0x7a1a1a, 0.1, 0.5), { z: -0.55 }),
      P(-0.24, HEAD + 0.08, 0, 0.09, 0.28, 0.09, M(0x7a1a1a, 0.1, 0.5), { z: 0.55 }),
      P(0.33, HEAD + 0.22, 0, 0.06, 0.12, 0.06, M(0x3a0a0a, 0.1, 0.5), { z: -0.9 }),
      P(-0.33, HEAD + 0.22, 0, 0.06, 0.12, 0.06, M(0x3a0a0a, 0.1, 0.5), { z: 0.9 }),
    ],
  },
  {
    id: 'visor', name: 'Cyber-Visier', icon: '🕶️',
    parts: () => [
      P(0, HEAD * 0.58, -HEAD / 2 - 0.02, HEAD + 0.08, 0.11, 0.06, M(0x2ee6ff, 0.2, 0.2, 2.2)),
      P(0, HEAD * 0.58, 0.02, HEAD + 0.10, 0.13, HEAD - 0.02, M(0x1c1f26, 0.6, 0.4)),
      P(HEAD / 2 + 0.05, HEAD * 0.58, 0.08, 0.05, 0.16, 0.16, M(0x1c1f26, 0.6, 0.4)),
      P(-HEAD / 2 - 0.05, HEAD * 0.58, 0.08, 0.05, 0.16, 0.16, M(0x1c1f26, 0.6, 0.4)),
    ],
  },
  {
    id: 'catears', name: 'Katzenohren', icon: '🐱',
    parts: (p) => [
      P(0.2, HEAD + 0.07, 0, 0.16, 0.18, 0.06, M(0x2a2a2e, 0, 0.9), { z: -0.3 }),
      P(-0.2, HEAD + 0.07, 0, 0.16, 0.18, 0.06, M(0x2a2a2e, 0, 0.9), { z: 0.3 }),
      P(0.2, HEAD + 0.05, -0.01, 0.08, 0.10, 0.05, M(0xff8fbf, 0, 0.9), { z: -0.3 }),
      P(-0.2, HEAD + 0.05, -0.01, 0.08, 0.10, 0.05, M(0xff8fbf, 0, 0.9), { z: 0.3 }),
      P(0, HEAD - 0.01, 0, HEAD + 0.02, 0.05, HEAD + 0.02, M(p, 0, 0.85)),
    ],
  },
  {
    id: 'halo', name: 'Heiligenschein', icon: '😇',
    parts: () => {
      const g = M(0xffe27a, 0, 0.3, 2.6);
      const r = 0.24, t = 0.045, y = HEAD + 0.24;
      return [
        P(0, y, -r, r * 2, t, t, g), P(0, y, r, r * 2, t, t, g),
        P(-r, y, 0, t, t, r * 2, g), P(r, y, 0, t, t, r * 2, g),
      ];
    },
  },
  {
    id: 'bandana', name: 'Bandana (Maske)', icon: '🥷',
    parts: (p) => [
      P(0, HEAD * 0.28, -HEAD / 2 - 0.015, HEAD + 0.04, 0.22, 0.05, M(p, 0, 0.9)),
      P(0, HEAD * 0.28, 0.0, HEAD + 0.05, 0.22, HEAD - 0.02, M(p, 0, 0.9)),
      P(0.05, HEAD * 0.2, HEAD / 2 + 0.05, 0.06, 0.18, 0.05, M(p, 0, 0.9), { z: 0.3 }),
      P(-0.06, HEAD * 0.16, HEAD / 2 + 0.05, 0.06, 0.22, 0.05, M(p, 0, 0.9), { z: -0.2 }),
    ],
  },
  {
    id: 'headband', name: 'Stirnband', icon: '🎽',
    parts: (p) => [
      P(0, HEAD * 0.78, 0, HEAD + 0.04, 0.09, HEAD + 0.04, M(p, 0, 0.9)),
      P(0.06, HEAD * 0.66, HEAD / 2 + 0.06, 0.06, 0.26, 0.04, M(p, 0, 0.9), { z: 0.25 }),
      P(-0.05, HEAD * 0.62, HEAD / 2 + 0.06, 0.06, 0.30, 0.04, M(p, 0, 0.9), { z: -0.2 }),
    ],
  },
];
export const HAT_BY_ID = {};
for (const h of HATS) HAT_BY_ID[h.id] = h;

const hatGeoCache = new Map();
/** Geometrie einer Kopfbedeckung (gecacht nach Id + Farben) */
export function hatGeometry(hatId, primary, secondary) {
  const h = HAT_BY_ID[hatId];
  if (!h || h.id === 'none') return null;
  const key = hatId + '|' + primary + '|' + secondary;
  let g = hatGeoCache.get(key);
  if (!g) {
    const parts = h.parts(primary, secondary);
    if (!parts.length) return null;
    g = mergeBoxes(parts, { chamfer: 0.02, defaults: { m: 0, r: 0.8 } });
    hatGeoCache.set(key, g);
  }
  return g;
}

// ------------------------------------------------------------
// Kill-Effekte (vom Killer gewaehlt, spielt beim Opfer ab)
// hideBody: Leiche verschwindet sofort (explodiert)
// ------------------------------------------------------------
export const KILL_EFFECTS = [
  { id: 'none',      name: 'Standard',   icon: '💀', desc: 'Nur Ragdoll' },
  { id: 'confetti',  name: 'Konfetti',   icon: '🎉', desc: 'Gegner platzt in Konfetti', hideBody: true },
  { id: 'fireworks', name: 'Feuerwerk',  icon: '🎆', desc: 'Funkenregen mit Knall', hideBody: true },
  { id: 'voxel',     name: 'Pixel',      icon: '🟦', desc: 'Zerfaellt in Wuerfel', hideBody: true },
  { id: 'soul',      name: 'Seele',      icon: '👻', desc: 'Ein Geist steigt auf' },
  { id: 'gore',      name: 'Blutfontaene', icon: '🩸', desc: 'Extra viel Blut' },
  { id: 'coins',     name: 'Muenzen',    icon: '🪙', desc: 'Goldregen' },
];
export const KILL_EFFECT_BY_ID = {};
for (const k of KILL_EFFECTS) KILL_EFFECT_BY_ID[k.id] = k;

// ------------------------------------------------------------
// Kill-Icons (im Killfeed hinter der Waffe)
// ------------------------------------------------------------
export const KILL_ICONS = [
  { id: 'none',  name: 'Keins',    icon: '' },
  { id: 'skull', name: 'Schaedel', icon: '💀' },
  { id: 'fire',  name: 'Feuer',    icon: '🔥' },
  { id: 'bolt',  name: 'Blitz',    icon: '⚡' },
  { id: 'crown', name: 'Krone',    icon: '👑' },
  { id: 'ghost', name: 'Geist',    icon: '👻' },
  { id: 'heart', name: 'Herz',     icon: '❤️' },
  { id: 'star',  name: 'Stern',    icon: '⭐' },
  { id: 'hundred', name: '100',    icon: '💯' },
  { id: 'clown', name: 'Clown',    icon: '🤡' },
  { id: 'alien', name: 'Alien',    icon: '👽' },
  { id: 'knife', name: 'Messer',   icon: '🔪' },
  { id: 'devil', name: 'Teufel',   icon: '😈' },
  { id: 'bomb',  name: 'Bombe',    icon: '💣' },
];
export const KILL_ICON_BY_ID = {};
for (const k of KILL_ICONS) KILL_ICON_BY_ID[k.id] = k;

function darken(hex, f) {
  const r = Math.round(((hex >> 16) & 255) * f), g = Math.round(((hex >> 8) & 255) * f), b = Math.round((hex & 255) * f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Farben der Spielfigur aus Outfit und Team/FFA-Farbe.
 * Im Teammodus bleiben Schulterband, Aermelbund und Kopfbedeckung in
 * Teamfarbe, damit Gegner erkennbar bleiben.
 * baseCol = Teamfarbe (Team) bzw. Spielerfarbe (FFA)
 */
export function figureColors(outfitId, baseCol, isTeam, teamAccent) {
  const outfit = OUTFIT_BY_ID[outfitId] || OUTFIT_BY_ID.team;
  const custom = outfit.id !== 'team';
  const body = custom ? outfit.body : baseCol;
  const pants = outfit.pants || 0x2a3040;
  let accent, hatPrimary, cuff, arm;
  if (isTeam) {
    // Teammodus: Arme und Aermel immer in Teamfarbe -> in der Egoansicht
    // sieht man an den eigenen Armen sofort, in welchem Team man ist
    accent = custom ? baseCol : (teamAccent || 0xffffff);
    hatPrimary = baseCol;
    cuff = custom ? darken(baseCol, 0.6) : 0x2a3040;
    arm = darken(baseCol, 0.9);
  } else {
    accent = custom ? outfit.accent : 0xffffff;
    hatPrimary = custom ? outfit.accent : baseCol;
    cuff = custom ? darken(outfit.accent, 0.8) : 0x2a3040;
    arm = darken(body, 0.78);
  }
  return {
    body, pants, accent, hatPrimary, cuff, arm,
    hatSecondary: custom ? outfit.accent : 0xffffff,
    sleeve: arm,
  };
}

/** Zufallsauswahl fuer Bots */
export function randomOutfitId() {
  if (Math.random() < 0.4) return 'team';
  return OUTFITS[1 + ((Math.random() * (OUTFITS.length - 1)) | 0)].id;
}
export function randomHatId() {
  if (Math.random() < 0.45) return 'none';
  return HATS[1 + ((Math.random() * (HATS.length - 1)) | 0)].id;
}
export function randomKillEffectId() {
  if (Math.random() < 0.55) return 'none';
  return KILL_EFFECTS[1 + ((Math.random() * (KILL_EFFECTS.length - 1)) | 0)].id;
}
export function randomKillIconId() {
  if (Math.random() < 0.5) return 'none';
  return KILL_ICONS[1 + ((Math.random() * (KILL_ICONS.length - 1)) | 0)].id;
}
