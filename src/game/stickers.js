// ============================================================
// Waffen-Sticker: kleine Aufkleber auf der groessten Seitenflaeche
// der Waffe. Bilder werden zur Laufzeit auf ein Canvas gezeichnet.
// Die Platzierung wird pro Waffe automatisch aus den Bauteilen
// bestimmt (groesste Seitenflaeche h*d eines nicht gedrehten Teils).
// ============================================================

import * as THREE from 'three';
import { registerMaterial } from '../fx/materials.js';

const S = 96;

function canvas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  return cv;
}

/** Abgerundetes Rechteck (Fallback fuer Browser ohne roundRect) */
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  if (g.roundRect) { g.roundRect(x, y, w, h, r); return; }
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

function circleBg(g, c1, c2) {
  const grd = g.createRadialGradient(S * 0.4, S * 0.35, 4, S / 2, S / 2, S / 2);
  grd.addColorStop(0, c1); grd.addColorStop(1, c2);
  g.fillStyle = grd;
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 3, 0, Math.PI * 2); g.fill();
  g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 4, 0, Math.PI * 2); g.stroke();
}

function emojiCenter(g, text, size, y) {
  g.font = `${size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#fff';
  g.fillText(text, S / 2, y || S / 2 + 3);
}

function textCenter(g, text, font, color, y) {
  g.font = font;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineJoin = 'round';
  g.strokeText(text, S / 2, y || S / 2 + 2);
  g.fillStyle = color;
  g.fillText(text, S / 2, y || S / 2 + 2);
}

// Jeder Sticker: draw(ctx) zeichnet 96x96 mit Transparenz
export const STICKERS = [
  { id: 'none', name: 'Keiner', draw: null },
  {
    id: 'skull', name: 'Totenkopf',
    draw: (g) => { circleBg(g, '#3a3a44', '#0d0d12'); emojiCenter(g, '💀', 54); },
  },
  {
    id: 'flame', name: 'Flamme',
    draw: (g) => { circleBg(g, '#ff9a2a', '#7a1e00'); emojiCenter(g, '🔥', 54); },
  },
  {
    id: 'bolt', name: 'Blitz',
    draw: (g) => { circleBg(g, '#ffe66a', '#8a6a00'); emojiCenter(g, '⚡', 54); },
  },
  {
    id: 'star', name: 'Stern',
    draw: (g) => {
      circleBg(g, '#2b4a8a', '#0b1630');
      g.fillStyle = '#ffd94a'; g.strokeStyle = '#000'; g.lineWidth = 3;
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 14 : 34, a = -Math.PI / 2 + i * Math.PI / 5;
        g.lineTo(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r);
      }
      g.closePath(); g.fill(); g.stroke();
    },
  },
  {
    id: 'smiley', name: 'Smiley',
    draw: (g) => { circleBg(g, '#ffe94a', '#c99a00'); emojiCenter(g, '😎', 52); },
  },
  {
    id: 'heart', name: 'Herz',
    draw: (g) => { circleBg(g, '#ff6a8a', '#7a0020'); emojiCenter(g, '❤️', 50); },
  },
  {
    id: 'radioactive', name: 'Radioaktiv',
    draw: (g) => {
      circleBg(g, '#f0ff4a', '#7a8a00');
      g.fillStyle = '#111';
      for (let i = 0; i < 3; i++) {
        const a0 = -Math.PI / 2 + i * Math.PI * 2 / 3 - 0.52, a1 = a0 + 1.04;
        g.beginPath(); g.moveTo(S / 2, S / 2); g.arc(S / 2, S / 2, 36, a0, a1); g.closePath(); g.fill();
      }
      g.fillStyle = '#f0ff4a'; g.beginPath(); g.arc(S / 2, S / 2, 12, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(S / 2, S / 2, 6, 0, Math.PI * 2); g.fill();
    },
  },
  {
    id: 'target', name: 'Zielscheibe',
    draw: (g) => {
      for (let i = 4; i >= 0; i--) {
        g.fillStyle = i % 2 ? '#ffffff' : '#e02020';
        g.beginPath(); g.arc(S / 2, S / 2, 8 + i * 9, 0, Math.PI * 2); g.fill();
      }
      g.lineWidth = 3; g.strokeStyle = '#000';
      g.beginPath(); g.arc(S / 2, S / 2, 44, 0, Math.PI * 2); g.stroke();
    },
  },
  {
    id: 'frag', name: 'FRAGSTORM',
    draw: (g) => {
      g.fillStyle = '#0d1017';
      rrect(g, 4, 26, S - 8, 44, 8); g.fill();
      g.lineWidth = 3; g.strokeStyle = '#ffcc00'; g.stroke();
      textCenter(g, 'FRAG', 'italic 900 26px Impact, "Arial Black", sans-serif', '#ffffff', 40);
      textCenter(g, 'STORM', 'italic 900 22px Impact, "Arial Black", sans-serif', '#ffcc00', 60);
    },
  },
  {
    id: 'paw', name: 'Pfote',
    draw: (g) => { circleBg(g, '#8a5a3a', '#3a2010'); emojiCenter(g, '🐾', 50); },
  },
  {
    id: 'alien', name: 'Alien',
    draw: (g) => { circleBg(g, '#6aff9a', '#0a5a2a'); emojiCenter(g, '👽', 52); },
  },
  {
    id: 'gg', name: 'GG EZ',
    draw: (g) => {
      g.fillStyle = '#ff2ee6';
      rrect(g, 6, 22, S - 12, 52, 10); g.fill();
      g.lineWidth = 3; g.strokeStyle = '#fff'; g.stroke();
      textCenter(g, 'GG EZ', '900 30px Impact, "Arial Black", sans-serif', '#ffffff', 49);
    },
  },
  {
    id: 'hazard', name: 'Warnung',
    draw: (g) => {
      g.fillStyle = '#ffcc00'; g.strokeStyle = '#111'; g.lineWidth = 5; g.lineJoin = 'round';
      g.beginPath(); g.moveTo(S / 2, 8); g.lineTo(S - 8, S - 12); g.lineTo(8, S - 12); g.closePath();
      g.fill(); g.stroke();
      textCenter(g, '!', '900 46px Impact, "Arial Black", sans-serif', '#111', 62);
    },
  },
];
export const STICKER_BY_ID = {};
for (const s of STICKERS) STICKER_BY_ID[s.id] = s;

// ------------------------------------------------------------
const texCache = new Map();
const matCache = new Map();
const placeCache = new Map();
let planeGeo = null;

/** Canvas eines Stickers (fuer Menue-Vorschau) */
export function stickerCanvas(id) {
  const s = STICKER_BY_ID[id];
  if (!s || !s.draw) return null;
  const cv = canvas();
  s.draw(cv.getContext('2d'));
  return cv;
}

function stickerTexture(id) {
  let t = texCache.get(id);
  if (!t) {
    const cv = stickerCanvas(id);
    if (!cv) return null;
    t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    texCache.set(id, t);
  }
  return t;
}

function stickerMaterial(id) {
  let m = matCache.get(id);
  if (!m) {
    const tex = stickerTexture(id);
    if (!tex) return null;
    m = new THREE.MeshStandardMaterial({
      map: tex, transparent: true, alphaTest: 0.4, roughness: 0.55, metalness: 0.0,
      envMapIntensity: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      side: THREE.FrontSide,
    });
    registerMaterial(m);
    matCache.set(id, m);
  }
  return m;
}

/**
 * Platzierung auf der Waffe: groesste Seitenflaeche (h*d) eines
 * nicht rotierten Bauteils. Rueckgabe {x,y,z,w,size} oder null.
 */
export function stickerPlacement(weapon) {
  const key = weapon.variant || weapon.id;
  let pl = placeCache.get(key);
  if (pl !== undefined) return pl;
  pl = null;
  const parts = weapon.parts || [];
  let best = -1;
  for (const p of parts) {
    if (p.rot) continue;
    const area = p.h * p.d;
    const side = Math.min(p.h, p.d);
    if (side < 0.05) continue;
    // Flaechen bevorzugen, die gross und "kastig" sind
    const score = area * Math.min(1, side / 0.08);
    if (score > best) {
      best = score;
      const size = Math.min(side * 0.95, 0.2);
      pl = { x: p.x, y: p.y, z: p.z, w: p.w, size, part: p };
    }
  }
  placeCache.set(key, pl);
  return pl;
}

/**
 * Baut die Sticker-Meshes (linke + rechte Seite) fuer eine Waffe.
 * Rueckgabe: Group im Waffenraum (als Kind des Waffen-Meshes anhaengen) oder null.
 */
export function buildStickerGroup(weapon, stickerId) {
  if (!stickerId || stickerId === 'none') return null;
  const mat = stickerMaterial(stickerId);
  if (!mat) return null;
  const pl = stickerPlacement(weapon);
  if (!pl) return null;
  if (!planeGeo) planeGeo = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.Group();
  const off = pl.w / 2 + 0.0025;
  // Linke Seite (-X): sichtbar in der Egoansicht
  const l = new THREE.Mesh(planeGeo, mat);
  l.position.set(pl.x - off, pl.y, pl.z);
  l.rotation.y = -Math.PI / 2;
  l.scale.setScalar(pl.size);
  // Rechte Seite (+X)
  const r = new THREE.Mesh(planeGeo, mat);
  r.position.set(pl.x + off, pl.y, pl.z);
  r.rotation.y = Math.PI / 2;
  r.scale.setScalar(pl.size);
  g.add(l, r);
  g.userData.sticker = stickerId;
  return g;
}

export function randomStickerId() {
  if (Math.random() < 0.7) return 'none';
  return STICKERS[1 + ((Math.random() * (STICKERS.length - 1)) | 0)].id;
}
