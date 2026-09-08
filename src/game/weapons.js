// ============================================================
// Waffen- und Klassendefinitionen
// Modelle werden aus Boxen zusammengesetzt (parts).
// Lokales Koordinatensystem: -Z = Laufrichtung, +Y = oben, +X = rechts
//
// Neu: jede Waffe hat
//   hold   - Haltungstyp (rifle | pistol | akimbo | launcher | knife | katana | nade)
//   grips  - Griffpunkte fuer rechte/linke Hand im Waffenraum (Arme werden
//            per Mini-IK von der Schulter dorthin gezogen)
//   vmPos / vmRot - Ablage in der Egoansicht (optional)
//   swing  - Nahkampf-Animation (slash | sweep)
// ============================================================

const MAT = {
  body:   0x2c2f36,
  dark:   0x1b1d22,
  metal:  0x555b66,
  steel:  0x8a929e,
  edge:   0xd6dde6,
  wood:   0x6b4a2c,
  grip:   0x22242a,
  wrap:   0x3a2a4a,
  accent: 0xffc21f,
  green:  0x3f5c3a,
  tan:    0x9a8461,
  red:    0xb03a3a,
  glow:   0x2ee6ff,
};

const p = (x, y, z, w, h, d, color, rot) => ({ x, y, z, w, h, d, color, rot });

// ------------------------------------------------------------
// Bauteil-Sets
// ------------------------------------------------------------
const PARTS = {
  ar: [
    p(0, 0, -0.26, 0.11, 0.15, 0.9, MAT.body),
    p(0, 0.02, -0.88, 0.085, 0.10, 0.46, MAT.dark),
    p(0, 0.03, -1.16, 0.055, 0.055, 0.34, MAT.metal),
    p(0, 0.03, -1.36, 0.075, 0.075, 0.12, MAT.dark),
    p(0, -0.20, -0.20, 0.075, 0.30, 0.16, MAT.dark, { x: 0.12 }),
    p(0, -0.17, 0.10, 0.075, 0.24, 0.11, MAT.grip, { x: -0.25 }),
    p(0, 0.0, 0.36, 0.09, 0.13, 0.44, MAT.body),
    p(0, 0.10, 0.34, 0.05, 0.06, 0.30, MAT.dark),
    p(0, 0.115, -0.02, 0.045, 0.07, 0.09, MAT.dark),
    p(0, 0.115, -1.02, 0.035, 0.075, 0.05, MAT.dark),
    p(0.062, 0.02, -0.05, 0.03, 0.05, 0.14, MAT.metal),
  ],
  smg: [
    p(0, 0, -0.16, 0.10, 0.14, 0.62, MAT.body),
    p(0, 0.02, -0.58, 0.06, 0.07, 0.36, MAT.dark),
    p(0, 0.02, -0.80, 0.05, 0.05, 0.14, MAT.metal),
    p(0, -0.22, -0.10, 0.06, 0.34, 0.10, MAT.dark),
    p(0, -0.15, 0.10, 0.07, 0.22, 0.10, MAT.grip, { x: -0.2 }),
    p(0, 0.02, 0.26, 0.07, 0.09, 0.26, MAT.metal),
    p(0, 0.10, -0.05, 0.04, 0.06, 0.06, MAT.dark),
    p(0, 0.10, -0.70, 0.03, 0.06, 0.04, MAT.dark),
  ],
  sniper: [
    p(0, 0, -0.10, 0.10, 0.13, 1.0, MAT.wood),
    p(0, 0.01, -0.92, 0.05, 0.05, 0.72, MAT.dark),
    p(0, 0.01, -1.30, 0.065, 0.065, 0.10, MAT.metal),
    p(0, 0.145, -0.28, 0.075, 0.085, 0.52, MAT.dark),
    p(0, 0.145, -0.56, 0.09, 0.10, 0.06, MAT.metal),
    p(0, 0.145, 0.0, 0.09, 0.10, 0.06, MAT.metal),
    p(0, 0.075, -0.16, 0.04, 0.06, 0.06, MAT.metal),
    p(0, 0.075, -0.42, 0.04, 0.06, 0.06, MAT.metal),
    p(0, -0.16, -0.12, 0.06, 0.20, 0.12, MAT.dark),
    p(0, -0.14, 0.16, 0.07, 0.22, 0.11, MAT.wood, { x: -0.22 }),
    p(0, 0.0, 0.46, 0.09, 0.16, 0.42, MAT.wood),
    p(0.06, 0.03, -0.02, 0.04, 0.05, 0.16, MAT.metal),
  ],
  shotgun: [
    p(0, 0, -0.20, 0.11, 0.14, 0.80, MAT.body),
    p(0, 0.03, -0.82, 0.07, 0.07, 0.56, MAT.dark),
    p(0, -0.05, -0.82, 0.09, 0.06, 0.50, MAT.wood),
    p(0, 0.03, -1.14, 0.085, 0.085, 0.10, MAT.metal),
    p(0, -0.14, 0.12, 0.075, 0.22, 0.11, MAT.wood, { x: -0.24 }),
    p(0, 0.0, 0.40, 0.09, 0.15, 0.40, MAT.wood),
    p(0, 0.105, -0.05, 0.04, 0.05, 0.08, MAT.dark),
  ],
  lmg: [
    p(0, 0, -0.26, 0.13, 0.17, 1.0, MAT.green),
    p(0, 0.02, -0.96, 0.07, 0.07, 0.6, MAT.dark),
    p(0, 0.02, -1.30, 0.09, 0.09, 0.14, MAT.metal),
    p(0, -0.20, -0.30, 0.20, 0.26, 0.30, MAT.dark),
    p(0, -0.16, 0.12, 0.08, 0.24, 0.11, MAT.grip, { x: -0.22 }),
    p(0, 0.0, 0.42, 0.10, 0.16, 0.44, MAT.green),
    p(0, 0.125, -0.06, 0.05, 0.07, 0.10, MAT.dark),
    p(0, 0.125, -1.02, 0.04, 0.08, 0.05, MAT.dark),
    p(0, -0.30, -0.86, 0.05, 0.22, 0.05, MAT.metal, { z: 0.4 }),
    p(0, -0.30, -0.86, 0.05, 0.22, 0.05, MAT.metal, { z: -0.4 }),
  ],
  revolver: [
    p(0, 0, -0.14, 0.07, 0.11, 0.46, MAT.steel),
    p(0, 0.01, -0.44, 0.045, 0.05, 0.30, MAT.steel),
    p(0, -0.02, -0.10, 0.10, 0.12, 0.16, MAT.metal),
    p(0, -0.15, 0.10, 0.065, 0.24, 0.10, MAT.wood, { x: -0.32 }),
    p(0, 0.075, -0.06, 0.035, 0.045, 0.06, MAT.dark),
    p(0, 0.075, -0.55, 0.03, 0.05, 0.04, MAT.dark),
    p(0, -0.09, -0.02, 0.03, 0.07, 0.05, MAT.dark),
  ],
  pistol: [
    p(0, 0, -0.14, 0.065, 0.11, 0.42, MAT.body),
    p(0, 0.005, -0.40, 0.045, 0.05, 0.16, MAT.dark),
    p(0, -0.16, 0.02, 0.06, 0.26, 0.10, MAT.grip, { x: -0.14 }),
    p(0, 0.07, -0.05, 0.03, 0.04, 0.06, MAT.dark),
    p(0, 0.07, -0.32, 0.025, 0.045, 0.04, MAT.dark),
    p(0, -0.075, -0.04, 0.03, 0.06, 0.05, MAT.dark),
  ],
  burst: [
    p(0, 0, -0.24, 0.10, 0.14, 0.86, MAT.tan),
    p(0, 0.02, -0.82, 0.06, 0.07, 0.44, MAT.dark),
    p(0, 0.02, -1.08, 0.05, 0.05, 0.20, MAT.metal),
    p(0, -0.20, -0.16, 0.07, 0.30, 0.14, MAT.dark),
    p(0, -0.16, 0.10, 0.07, 0.23, 0.10, MAT.grip, { x: -0.24 }),
    p(0, 0.0, 0.34, 0.085, 0.13, 0.40, MAT.tan),
    p(0, 0.11, -0.20, 0.05, 0.06, 0.34, MAT.dark),
  ],
  rpg: [
    p(0, 0, -0.15, 0.14, 0.14, 1.5, MAT.green),
    p(0, 0, -1.02, 0.19, 0.19, 0.18, MAT.dark),
    p(0, 0, 0.52, 0.20, 0.20, 0.16, MAT.dark),
    p(0, 0.02, -1.24, 0.16, 0.16, 0.34, MAT.red),
    p(0, 0.02, -1.46, 0.09, 0.09, 0.18, MAT.dark),
    p(0, -0.17, 0.02, 0.07, 0.24, 0.11, MAT.grip, { x: -0.2 }),
    p(0, -0.15, -0.60, 0.06, 0.20, 0.09, MAT.dark, { x: -0.1 }),
    p(0, 0.13, -0.30, 0.05, 0.12, 0.30, MAT.metal),
  ],
  akimbo: [
    p(-0.13, 0, -0.14, 0.065, 0.11, 0.46, MAT.body),
    p(-0.13, 0.005, -0.42, 0.045, 0.05, 0.20, MAT.dark),
    p(-0.13, -0.17, 0.02, 0.06, 0.26, 0.10, MAT.grip, { x: -0.14 }),
    p(0.13, 0, -0.14, 0.065, 0.11, 0.46, MAT.body),
    p(0.13, 0.005, -0.42, 0.045, 0.05, 0.20, MAT.dark),
    p(0.13, -0.17, 0.02, 0.06, 0.26, 0.10, MAT.grip, { x: -0.14 }),
  ],
  // Kampfmesser: Griff hinten (+Z), Klinge nach vorn (-Z), Schneide unten
  knife: [
    p(0, -0.01, 0.12, 0.046, 0.085, 0.24, MAT.grip),
    p(0, -0.01, 0.245, 0.05, 0.09, 0.03, MAT.metal),          // Knauf
    p(0, 0.0, -0.005, 0.095, 0.028, 0.05, MAT.metal),         // Parierstange
    p(0, 0.005, -0.26, 0.02, 0.08, 0.46, MAT.steel),          // Klinge
    p(0, -0.036, -0.26, 0.012, 0.016, 0.46, MAT.edge),        // Schneide
    p(0, 0.028, -0.52, 0.02, 0.045, 0.10, MAT.steel),         // Spitze
    p(0, 0.032, -0.20, 0.006, 0.02, 0.36, MAT.dark),          // Blutrinne
  ],
  // Katana: langer, umwickelter Griff, Tsuba, leicht gebogene Klinge
  katana: [
    p(0, -0.02, 0.10, 0.04, 0.05, 0.10, MAT.wrap),
    p(0, -0.02, 0.20, 0.04, 0.05, 0.10, MAT.dark),
    p(0, -0.02, 0.30, 0.04, 0.05, 0.10, MAT.wrap),
    p(0, -0.02, 0.36, 0.044, 0.054, 0.03, MAT.accent),        // Kashira
    p(0, 0.0, 0.03, 0.12, 0.028, 0.07, MAT.accent),           // Tsuba
    p(0, 0.01, -0.30, 0.018, 0.075, 0.66, MAT.steel),         // Klinge hinten
    p(0, 0.04, -0.82, 0.018, 0.07, 0.42, MAT.steel, { x: 0.06 }), // Klinge vorn (leicht gebogen)
    p(0, -0.026, -0.30, 0.01, 0.014, 0.66, MAT.edge),         // Schneide
    p(0, 0.008, -0.82, 0.01, 0.014, 0.40, MAT.edge, { x: 0.06 }),
    p(0, 0.075, -1.06, 0.018, 0.04, 0.12, MAT.steel, { x: 0.10 }), // Kissaki (Spitze)
  ],
  nade: [
    p(0, 0, 0, 0.14, 0.18, 0.14, MAT.green),
    p(0, 0.11, 0, 0.06, 0.05, 0.06, MAT.metal),
    p(0.05, 0.10, 0, 0.02, 0.09, 0.02, MAT.metal),
  ],
};

// ------------------------------------------------------------
// Waffen
// ------------------------------------------------------------
function W(o) {
  return Object.assign({
    slot: 0,
    damage: 20, headMult: 2.0, legMult: 0.85,
    rpm: 600, auto: true, burst: 0, burstDelay: 0.075,
    pellets: 1,
    mag: 30, reserve: 90, reloadTime: 2.1, reloadType: 'mag', reloadFillsAll: true,
    spread: 0.004, spreadMove: 0.03, spreadAir: 0.05, spreadCrouch: -0.002,
    spreadPerShot: 0.006, spreadRecover: 0.05, spreadMax: 0.09, spreadAds: 0.25,
    recoilV: 0.9, recoilH: 0.35, recoilRecover: 7.5, kick: 0.05,
    range: 300, falloffStart: 40, falloffEnd: 130, falloffMin: 0.55,
    adsFov: 0.72, adsTime: 0.16, scope: false,
    moveMult: 1.0, adsMoveMult: 0.45,
    switchTime: 0.45,
    pierce: 0,
    projectile: null,
    tracer: 0xffe08a, tracerWidth: 0.05,
    sound: { vol: 0.8, lowCut: 200, hiCut: 5000, dur: 0.16, body: 95, punch: 1 },
    parts: PARTS.ar,
    muzzle: [0, 0.03, -1.42],
    hold: 'rifle',
    grips: { r: [0, -0.16, 0.10], l: [0, -0.05, -0.62] },
    icon: '\u{1F52B}',
  }, o);
}

export const WEAPONS = {
  // ---------------- Primaerwaffen ----------------
  ar: W({
    id: 'ar', name: 'Assault Rifle', short: 'AR',
    damage: 27, rpm: 545, mag: 30, reserve: 120, reloadTime: 2.0,
    spread: 0.0035, spreadPerShot: 0.0055, spreadMax: 0.075,
    recoilV: 0.95, recoilH: 0.34,
    range: 320, falloffStart: 45, falloffEnd: 140, falloffMin: 0.6,
    moveMult: 1.0, parts: PARTS.ar,
    grips: { r: [0, -0.16, 0.10], l: [0, -0.05, -0.62] },
    sound: { vol: 0.85, lowCut: 190, hiCut: 5400, dur: 0.15, body: 100, punch: 1 },
  }),
  smg: W({
    id: 'smg', name: 'Submachine Gun', short: 'SMG',
    damage: 16, headMult: 1.9, rpm: 900, mag: 32, reserve: 160, reloadTime: 1.7,
    spread: 0.008, spreadPerShot: 0.0055, spreadMax: 0.1, spreadMove: 0.018,
    recoilV: 0.55, recoilH: 0.42, kick: 0.035,
    range: 160, falloffStart: 22, falloffEnd: 70, falloffMin: 0.45,
    moveMult: 1.14, adsFov: 0.82, parts: PARTS.smg, muzzle: [0, 0.02, -0.9],
    grips: { r: [0, -0.14, 0.10], l: [0, -0.05, -0.45] },
    tracer: 0xffe8b0,
    sound: { vol: 0.6, lowCut: 260, hiCut: 6200, dur: 0.1, body: 130, punch: 0.8 },
  }),
  sniper: W({
    id: 'sniper', name: 'Sniper Rifle', short: 'SNIPER',
    damage: 100, headMult: 1.6, legMult: 0.75, rpm: 55, auto: false,
    mag: 5, reserve: 30, reloadTime: 2.6,
    spread: 0.0006, spreadPerShot: 0.05, spreadMax: 0.16, spreadMove: 0.075, spreadAir: 0.12,
    spreadAds: 0.0, spreadRecover: 0.09,
    recoilV: 3.4, recoilH: 0.7, recoilRecover: 5, kick: 0.28,
    range: 500, falloffStart: 200, falloffEnd: 400, falloffMin: 0.9,
    adsFov: 0.16, adsTime: 0.24, scope: true, pierce: 1,
    moveMult: 0.86, adsMoveMult: 0.28,
    switchTime: 0.7, parts: PARTS.sniper, muzzle: [0, 0.01, -1.36],
    grips: { r: [0, -0.13, 0.16], l: [0, -0.06, -0.60] },
    tracer: 0xffffff, tracerWidth: 0.07,
    sound: { vol: 1.25, lowCut: 120, hiCut: 4200, dur: 0.35, body: 62, punch: 1.5 },
  }),
  shotgun: W({
    id: 'shotgun', name: 'Shotgun', short: 'SHOTGUN',
    damage: 12, headMult: 1.5, pellets: 9, rpm: 85, auto: false,
    mag: 6, reserve: 36, reloadTime: 0.55, reloadType: 'single', reloadFillsAll: false,
    spread: 0.052, spreadPerShot: 0.0, spreadMax: 0.09, spreadMove: 0.012, spreadAds: 0.62,
    recoilV: 2.6, recoilH: 0.5, kick: 0.24,
    range: 60, falloffStart: 9, falloffEnd: 34, falloffMin: 0.18,
    adsFov: 0.86, moveMult: 0.96,
    parts: PARTS.shotgun, muzzle: [0, 0.03, -1.2],
    grips: { r: [0, -0.13, 0.12], l: [0, -0.08, -0.82] },
    tracer: 0xffd27a, tracerWidth: 0.035,
    sound: { vol: 1.15, lowCut: 110, hiCut: 3600, dur: 0.3, body: 70, punch: 1.4 },
  }),
  lmg: W({
    id: 'lmg', name: 'LMG', short: 'LMG',
    damage: 30, rpm: 430, mag: 60, reserve: 180, reloadTime: 3.6,
    spread: 0.006, spreadPerShot: 0.006, spreadMax: 0.11, spreadMove: 0.045,
    recoilV: 1.15, recoilH: 0.5, kick: 0.075,
    range: 320, falloffStart: 55, falloffEnd: 160, falloffMin: 0.65,
    moveMult: 0.82, adsMoveMult: 0.34, adsFov: 0.72, switchTime: 0.75,
    parts: PARTS.lmg, muzzle: [0, 0.02, -1.4],
    grips: { r: [0, -0.15, 0.12], l: [0, -0.10, -0.70] },
    sound: { vol: 1.0, lowCut: 150, hiCut: 4800, dur: 0.2, body: 78, punch: 1.25 },
  }),
  marksman: W({
    id: 'marksman', name: 'Marksman', short: 'MARKSMAN',
    damage: 48, headMult: 2.1, rpm: 260, auto: false, mag: 12, reserve: 72, reloadTime: 2.2,
    spread: 0.0016, spreadPerShot: 0.016, spreadMax: 0.1, spreadMove: 0.05,
    recoilV: 1.9, recoilH: 0.4, kick: 0.14,
    range: 400, falloffStart: 90, falloffEnd: 240, falloffMin: 0.8,
    adsFov: 0.44, adsTime: 0.2, moveMult: 0.93,
    parts: PARTS.burst, muzzle: [0, 0.02, -1.2],
    grips: { r: [0, -0.15, 0.10], l: [0, -0.05, -0.66] },
    tracer: 0xfff0c0,
    sound: { vol: 1.0, lowCut: 150, hiCut: 4600, dur: 0.22, body: 82, punch: 1.2 },
  }),
  burst: W({
    id: 'burst', name: 'Burst Rifle', short: 'BURST',
    damage: 29, rpm: 420, auto: false, burst: 3, burstDelay: 0.062,
    mag: 30, reserve: 120, reloadTime: 2.1,
    spread: 0.0025, spreadPerShot: 0.004, spreadMax: 0.06,
    recoilV: 0.85, recoilH: 0.28,
    range: 340, falloffStart: 60, falloffEnd: 170, falloffMin: 0.7,
    adsFov: 0.62, parts: PARTS.burst, muzzle: [0, 0.02, -1.2],
    grips: { r: [0, -0.15, 0.10], l: [0, -0.05, -0.66] },
    sound: { vol: 0.8, lowCut: 210, hiCut: 5600, dur: 0.13, body: 105, punch: 0.95 },
  }),
  akimbo: W({
    id: 'akimbo', name: 'Akimbo Uzi', short: 'AKIMBO',
    damage: 14, headMult: 1.8, rpm: 1100, mag: 40, reserve: 200, reloadTime: 2.4,
    spread: 0.014, spreadPerShot: 0.004, spreadMax: 0.12, spreadMove: 0.012, spreadAds: 0.75,
    recoilV: 0.45, recoilH: 0.55, kick: 0.03,
    range: 120, falloffStart: 18, falloffEnd: 55, falloffMin: 0.4,
    adsFov: 0.92, moveMult: 1.18,
    parts: PARTS.akimbo, muzzle: [0, 0.0, -0.56], dualMuzzle: [[-0.13, 0, -0.56], [0.13, 0, -0.56]],
    hold: 'akimbo',
    grips: { r: [0.13, -0.16, 0.02], l: [-0.13, -0.16, 0.02] },
    vmPos: [0.0, -0.20, -0.62],
    sound: { vol: 0.5, lowCut: 300, hiCut: 6600, dur: 0.08, body: 150, punch: 0.7 },
  }),
  rpg: W({
    id: 'rpg', name: 'Rocket Launcher', short: 'RPG',
    damage: 34, headMult: 1.0, rpm: 48, auto: false, mag: 1, reserve: 8, reloadTime: 2.5,
    spread: 0.002, spreadPerShot: 0, spreadMove: 0.006, spreadMax: 0.02,
    recoilV: 2.2, recoilH: 0.4, kick: 0.3,
    range: 400, falloffStart: 400, falloffEnd: 401, falloffMin: 1,
    adsFov: 0.78, moveMult: 0.85, switchTime: 0.8,
    projectile: { speed: 62, gravity: 5.5, radius: 0.28, color: 0xd8d8d8,
                  explode: { radius: 8.5, damage: 110, minMult: 0.22, force: 16, selfMult: 0.55 } },
    parts: PARTS.rpg, muzzle: [0, 0.02, -1.6],
    hold: 'launcher',
    grips: { r: [0, -0.16, 0.02], l: [0, -0.14, -0.60] },
    vmPos: [0.21, -0.13, -0.62],
    sound: { vol: 1.2, lowCut: 120, hiCut: 3200, dur: 0.4, body: 60, punch: 1.5 },
  }),
  crossbow: W({
    id: 'crossbow', name: 'Alien Blaster', short: 'BLASTER',
    damage: 42, headMult: 1.8, rpm: 180, auto: true, mag: 20, reserve: 100, reloadTime: 2.2,
    spread: 0.003, spreadPerShot: 0.008, spreadMax: 0.06, spreadMove: 0.02,
    recoilV: 1.2, recoilH: 0.3, kick: 0.09,
    range: 220, falloffStart: 50, falloffEnd: 150, falloffMin: 0.6,
    adsFov: 0.6, moveMult: 1.02,
    projectile: { speed: 105, gravity: 0, radius: 0.2, color: 0x2ee6ff, glow: true,
                  explode: { radius: 3.4, damage: 46, minMult: 0.3, force: 6, selfMult: 0.25 } },
    parts: PARTS.smg, muzzle: [0, 0.02, -0.9],
    grips: { r: [0, -0.14, 0.10], l: [0, -0.05, -0.45] },
    tracer: 0x2ee6ff,
    sound: { vol: 0.7, lowCut: 400, hiCut: 7000, dur: 0.18, body: 220, punch: 0.8 },
  }),

  // ---------------- Sekundaerwaffen ----------------
  pistol: W({
    id: 'pistol', name: 'Pistol', short: 'PISTOL', slot: 1,
    damage: 26, headMult: 2.0, rpm: 400, auto: false, mag: 12, reserve: 60, reloadTime: 1.5,
    spread: 0.004, spreadPerShot: 0.012, spreadMax: 0.07, spreadMove: 0.02,
    recoilV: 1.1, recoilH: 0.35, kick: 0.09,
    range: 140, falloffStart: 26, falloffEnd: 80, falloffMin: 0.45,
    adsFov: 0.8, moveMult: 1.12, switchTime: 0.3,
    parts: PARTS.pistol, muzzle: [0, 0.0, -0.5],
    hold: 'pistol',
    grips: { r: [0, -0.15, 0.02], l: [-0.035, -0.20, 0.0] },
    sound: { vol: 0.6, lowCut: 260, hiCut: 6000, dur: 0.12, body: 120, punch: 0.9 },
  }),
  revolver: W({
    id: 'revolver', name: 'Revolver', short: 'REVOLVER', slot: 1,
    damage: 58, headMult: 2.0, rpm: 190, auto: false, mag: 6, reserve: 36, reloadTime: 2.2,
    spread: 0.0025, spreadPerShot: 0.03, spreadMax: 0.09, spreadMove: 0.03,
    recoilV: 2.4, recoilH: 0.5, kick: 0.2,
    range: 200, falloffStart: 45, falloffEnd: 120, falloffMin: 0.55,
    adsFov: 0.66, moveMult: 1.05, switchTime: 0.38,
    parts: PARTS.revolver, muzzle: [0, 0.01, -0.6],
    hold: 'pistol',
    grips: { r: [0, -0.14, 0.10], l: [-0.035, -0.19, 0.08] },
    sound: { vol: 1.0, lowCut: 140, hiCut: 4600, dur: 0.26, body: 74, punch: 1.35 },
  }),

  // ---------------- Nahkampf ----------------
  knife: W({
    id: 'knife', name: 'Combat Knife', short: 'KNIFE', slot: 2,
    damage: 55, headMult: 1.6, rpm: 130, auto: false, mag: Infinity, reserve: 0,
    melee: true, meleeRange: 3.4, meleeArc: 0.55, meleeBackstab: 3.0, swing: 'slash', swingTime: 0.32,
    moveMult: 1.25, switchTime: 0.25, adsFov: 1, spread: 0,
    parts: PARTS.knife, muzzle: [0, 0, -0.5],
    hold: 'knife',
    grips: { r: [0, -0.02, 0.11], l: null },
    vmPos: [0.28, -0.27, -0.50],
    vmRot: [0.35, 0.45, -0.40],
    icon: '\u{1F52A}',
  }),
  katana: W({
    id: 'katana', name: 'Katana', short: 'KATANA', slot: 2,
    damage: 95, headMult: 1.2, rpm: 100, auto: false, mag: Infinity, reserve: 0,
    melee: true, meleeRange: 4.4, meleeArc: 0.6, meleeBackstab: 1.6, swing: 'sweep', swingTime: 0.42,
    moveMult: 1.3, switchTime: 0.3, adsFov: 1, spread: 0,
    parts: PARTS.katana, muzzle: [0, 0, -1.0],
    hold: 'katana',
    grips: { r: [0, -0.02, 0.09], l: [0, -0.02, 0.28] },
    vmPos: [0.31, -0.33, -0.56],
    vmRot: [0.74, 0.04, -0.34],
    icon: '⚔',
  }),

  // ---------------- Granate ----------------
  grenade: W({
    id: 'grenade', name: 'Frag Grenade', short: 'NADE', slot: 3,
    damage: 0, rpm: 60, auto: false, mag: 1, reserve: 0,
    projectile: { speed: 26, gravity: 20, radius: 0.16, color: 0x3f5c3a, bounce: 0.42, fuse: 1.6,
                  explode: { radius: 8.0, damage: 125, minMult: 0.2, force: 14, selfMult: 0.75 } },
    parts: PARTS.nade, muzzle: [0, 0, -0.2],
    hold: 'nade',
    grips: { r: [0, -0.05, 0.0], l: null },
    switchTime: 0.25, moveMult: 1.1,
    icon: '\u{1F4A3}',
  }),
};

// ------------------------------------------------------------
// Klassen
// ------------------------------------------------------------
export const CLASSES = [
  {
    id: 'triggerman', name: 'Triggerman', icon: '\u{1F3AF}',
    desc: 'Der Allrounder. Sturmgewehr mit gutem Schaden auf jede Distanz — die sichere Wahl für jede Situation.',
    primary: 'ar', secondary: 'pistol', melee: 'knife',
    hp: 100, armor: 0, speed: 1.0, jumps: 1, nades: 2,
    perks: ['Ausgewogen', 'Doppelsprung: nein'],
    stats: { schaden: 0.62, feuerrate: 0.62, reichweite: 0.7, mobilitaet: 0.6 },
  },
  {
    id: 'hunter', name: 'Hunter', icon: '\u{1F3AF}',
    desc: 'Ein Treffer, ein Kill. Das Scharfschützengewehr tötet auf jede Distanz mit einem Körpertreffer — wenn du triffst.',
    primary: 'sniper', secondary: 'pistol', melee: 'knife',
    hp: 100, armor: 0, speed: 1.02, jumps: 1, nades: 1,
    perks: ['One-Shot-Kill', 'Zielfernrohr', 'Durchschuss'],
    stats: { schaden: 1.0, feuerrate: 0.1, reichweite: 1.0, mobilitaet: 0.62 },
  },
  {
    id: 'rungun', name: 'Run N Gun', icon: '\u{1F3C3}',
    desc: 'Extrem schnell und wendig, mit Doppelsprung. Die MP zerlegt Gegner auf kurze Distanz.',
    primary: 'smg', secondary: 'pistol', melee: 'knife',
    hp: 90, armor: 0, speed: 1.16, jumps: 2, nades: 2,
    perks: ['Doppelsprung', '+16% Tempo', 'Schneller Slide'],
    stats: { schaden: 0.4, feuerrate: 0.88, reichweite: 0.35, mobilitaet: 1.0 },
  },
  {
    id: 'spray', name: 'Spray N Pray', icon: '\u{1F4A5}',
    desc: 'Die Schrotflinte pulverisiert alles auf Tuchfühlung. Auf Distanz aber nahezu wirkungslos.',
    primary: 'shotgun', secondary: 'pistol', melee: 'knife',
    hp: 110, armor: 0, speed: 1.04, jumps: 1, nades: 2,
    perks: ['+10 HP', 'Nahkampf-Dominanz'],
    stats: { schaden: 0.95, feuerrate: 0.22, reichweite: 0.15, mobilitaet: 0.66 },
  },
  {
    id: 'detective', name: 'Detective', icon: '\u{1F575}',
    desc: 'Revolver mit brutalem Schadenswert. Belohnt präzises Zielen — zwei Treffer genügen.',
    primary: 'revolver', secondary: 'pistol', melee: 'knife',
    hp: 100, armor: 0, speed: 1.08, jumps: 1, nades: 2,
    perks: ['2-Schuss-Kill', 'Schneller Waffenwechsel'],
    stats: { schaden: 0.85, feuerrate: 0.3, reichweite: 0.6, mobilitaet: 0.75 },
  },
  {
    id: 'bull', name: 'Bull', icon: '\u{1F402}',
    desc: 'Wandelnder Panzer. 130 HP und ein LMG mit 60 Schuss Magazin — dafür langsam.',
    primary: 'lmg', secondary: 'pistol', melee: 'knife',
    hp: 130, armor: 25, speed: 0.86, jumps: 1, nades: 1,
    perks: ['+30 HP', '+25 Rüstung', 'Langsam'],
    stats: { schaden: 0.7, feuerrate: 0.5, reichweite: 0.75, mobilitaet: 0.3 },
  },
  {
    id: 'vince', name: 'Vince', icon: '\u{1F3A9}',
    desc: 'Halbautomatisches Präzisionsgewehr mit Zielfernrohr. Belohnt Kopftreffer auf mittlerer Distanz.',
    primary: 'marksman', secondary: 'revolver', melee: 'knife',
    hp: 100, armor: 0, speed: 1.04, jumps: 1, nades: 2,
    perks: ['Kopfschuss +110%', 'Zoom'],
    stats: { schaden: 0.8, feuerrate: 0.35, reichweite: 0.88, mobilitaet: 0.68 },
  },
  {
    id: 'rocketeer', name: 'Rocketeer', icon: '\u{1F680}',
    desc: 'Raketenwerfer mit Flächenschaden. Rocket-Jumps möglich — aber Vorsicht mit Selbstschaden.',
    primary: 'rpg', secondary: 'pistol', melee: 'knife',
    hp: 110, armor: 0, speed: 0.96, jumps: 1, nades: 1,
    perks: ['Flächenschaden', 'Rocket-Jump', 'Selbstschaden reduziert'],
    stats: { schaden: 1.0, feuerrate: 0.12, reichweite: 0.55, mobilitaet: 0.5 },
  },
  {
    id: 'agent', name: 'Agent', icon: '\u{1F576}',
    desc: 'Zwei Uzis, absurde Feuerrate, maximale Mobilität. Nachladen dauert allerdings ewig.',
    primary: 'akimbo', secondary: 'pistol', melee: 'katana',
    hp: 85, armor: 0, speed: 1.2, jumps: 2, nades: 2,
    perks: ['Doppelsprung', '+20% Tempo', 'Katana'],
    stats: { schaden: 0.35, feuerrate: 1.0, reichweite: 0.28, mobilitaet: 1.0 },
  },
  {
    id: 'commando', name: 'Commando', icon: '\u{1F396}',
    desc: 'Feuerstoß-Gewehr: drei Kugeln pro Klick. Präzise auf mittlere Distanz, mit 3 Granaten.',
    primary: 'burst', secondary: 'pistol', melee: 'knife',
    hp: 105, armor: 10, speed: 1.02, jumps: 1, nades: 3,
    perks: ['3er-Feuerstoß', '+3 Granaten', '+10 Rüstung'],
    stats: { schaden: 0.7, feuerrate: 0.55, reichweite: 0.78, mobilitaet: 0.65 },
  },
  {
    id: 'ninja', name: 'Ninja', icon: '\u{1F977}',
    desc: 'Katana und Alien Blaster. Dreifachsprung, leise Schritte, extreme Beweglichkeit.',
    primary: 'crossbow', secondary: 'pistol', melee: 'katana',
    hp: 85, armor: 0, speed: 1.22, jumps: 3, nades: 1,
    perks: ['Dreifachsprung', 'Leise', 'Katana One-Hit'],
    stats: { schaden: 0.66, feuerrate: 0.4, reichweite: 0.5, mobilitaet: 1.0 },
  },
];

export const CLASS_BY_ID = {};
for (const c of CLASSES) CLASS_BY_ID[c.id] = c;

export function fireDelay(w) { return 60 / w.rpm; }
