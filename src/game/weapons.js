// ============================================================
// Waffen- und Klassendefinitionen
// Modelle werden aus Boxen zusammengesetzt (parts) und zu EINEM Mesh
// verschmolzen. Jedes Teil traegt ein Material {c: Farbe, m: Metalness,
// r: Roughness, e: Emissive} -> physikalisch korrekte Oberflaechen.
// Lokales Koordinatensystem: -Z = Laufrichtung, +Y = oben, +X = rechts
//
// Jede Waffe hat
//   hold   - Haltungstyp (rifle | pistol | akimbo | launcher | knife | katana | nade)
//   grips  - Griffpunkte fuer rechte/linke Hand im Waffenraum
//   vmPos / vmRot - Ablage in der Egoansicht, sightY = Visierhoehe
//   equip  - Zueck-Animation (raise | flip | unsheathe)
//   swing / heavy - Nahkampf: leichter Schlag (Linksklick) und schwerer
//            Angriff (Rechtsklick, mehr Schaden, langsamer)
//   sound  - { kind, vol, pitch } fuer die Schuss-Synthese
// ============================================================

const M = (c, m, r, e) => ({ c, m, r, e: e || 0 });
export const MAT = {
  body:   M(0x2e3033, 0.35, 0.58),
  dark:   M(0x1c1d21, 0.30, 0.62),
  black:  M(0x0e1013, 0.35, 0.65),
  metal:  M(0x555b66, 0.90, 0.45),
  steel:  M(0x8a929e, 1.00, 0.32),
  steelDark: M(0x5a626e, 1.00, 0.38),
  chrome: M(0xc4ccd6, 1.00, 0.12),
  edge:   M(0xe8eef6, 1.00, 0.10),
  wood:   M(0x6b4a2c, 0.00, 0.62),
  wood2:  M(0x54371f, 0.00, 0.68),
  grip:   M(0x22242a, 0.10, 0.88),
  rubber: M(0x2a2d33, 0.00, 0.92),
  wrap:   M(0x1f1a2e, 0.05, 0.85),
  wrap2:  M(0x120e1c, 0.05, 0.85),
  brass:  M(0xc9a54a, 1.00, 0.30),
  gold:   M(0xd8ad2a, 1.00, 0.22),
  accent: M(0xffc21f, 0.60, 0.35),
  red:    M(0xb03a3a, 0.30, 0.50),
  green:  M(0x3f5c3a, 0.20, 0.70),
  tan:    M(0x9a8461, 0.20, 0.70),
  glow:   M(0x2ee6ff, 0.00, 0.40, 2.6),
  glowR:  M(0xff3b3b, 0.00, 0.40, 2.6),
  glowSoft: M(0x2ee6ff, 0.00, 0.40, 1.2),
};

const p = (x, y, z, w, h, d, color, rot) => ({ x, y, z, w, h, d, color, rot });

// Gemeinsame Kleinteile
const triggerGuard = (z, color = MAT.dark) => [
  p(0, -0.115, z, 0.05, 0.012, 0.14, color),
  p(0, -0.14, z - 0.075, 0.05, 0.06, 0.012, color),
  p(0, -0.10, z + 0.01, 0.012, 0.045, 0.018, MAT.metal),      // Abzug
];
const rearSight = (y, z) => [
  p(0, y, z, 0.05, 0.05, 0.06, MAT.dark),
  p(-0.014, y + 0.03, z, 0.008, 0.02, 0.02, MAT.dark),
  p(0.014, y + 0.03, z, 0.008, 0.02, 0.02, MAT.dark),
];
const frontSight = (y, z) => [
  p(0, y, z, 0.03, 0.05, 0.05, MAT.dark),
  p(0, y + 0.04, z, 0.01, 0.035, 0.015, MAT.dark),
];

// ------------------------------------------------------------
// Katana im Valorant-Stil: dunkle Klinge, polierte Schneide,
// leuchtende Hohlkehle, Goldbeschlaege, Seidenwicklung, Quaste
// ------------------------------------------------------------
function katanaParts() {
  const parts = [];
  // Tsuka (Griff) mit Rautenwicklung
  parts.push(p(0, -0.02, 0.21, 0.036, 0.052, 0.36, MAT.wrap));
  for (let i = 0; i < 8; i++) {
    const z = 0.055 + i * 0.042;
    parts.push(p(0, -0.02, z, 0.04, 0.058, 0.010, MAT.wrap2));
    parts.push(p(i % 2 ? 0.021 : -0.021, -0.02, z + 0.02, 0.006, 0.02, 0.02, MAT.gold, { y: 0.785 }));
  }
  parts.push(p(0.022, -0.02, 0.19, 0.006, 0.02, 0.06, MAT.gold));           // Menuki
  parts.push(p(0, -0.02, 0.034, 0.044, 0.06, 0.024, MAT.gold));             // Fuchi
  parts.push(p(0, -0.02, 0.392, 0.044, 0.06, 0.026, MAT.gold));             // Kashira
  // Quaste (Sageo)
  parts.push(p(0.012, -0.07, 0.40, 0.012, 0.08, 0.012, MAT.glowSoft));
  parts.push(p(0.012, -0.13, 0.40, 0.02, 0.05, 0.02, MAT.gold));
  // Tsuba (achteckig) + Seppa + Edelstein
  parts.push(p(0, 0, 0.012, 0.13, 0.13, 0.016, MAT.black));
  parts.push(p(0, 0, 0.012, 0.13, 0.13, 0.016, MAT.black, { z: 0.785 }));
  parts.push(p(0, 0, 0.012, 0.11, 0.11, 0.02, MAT.gold, { z: 0.39 }));
  parts.push(p(0, 0, 0.012, 0.08, 0.08, 0.024, MAT.black, { z: 0.2 }));
  parts.push(p(0, 0.048, 0.012, 0.014, 0.014, 0.028, MAT.glow, { z: 0.785 }));
  parts.push(p(0, -0.048, 0.012, 0.014, 0.014, 0.028, MAT.glow, { z: 0.785 }));
  parts.push(p(0, 0, -0.004, 0.06, 0.07, 0.012, MAT.gold));
  // Habaki
  parts.push(p(0, 0.005, -0.03, 0.026, 0.072, 0.045, MAT.gold));
  // Klinge: 5 Segmente, nach vorn zunehmend gebogen
  const SEG = 5, L = 0.215, k = 0.11;
  for (let i = 0; i < SEG; i++) {
    const dist = (i + 0.5) * L;
    const z = -0.055 - dist;
    const y = 0.5 * k * dist * dist * 0.5;
    const rx = k * dist * 0.5;
    parts.push(p(0, y + 0.008, z, 0.016, 0.074, L + 0.01, MAT.steelDark, { x: rx }));  // Klingenkoerper
    parts.push(p(0, y + 0.024, z, 0.018, 0.02, L + 0.01, MAT.steel, { x: rx }));       // Shinogi (Grat)
    parts.push(p(0, y - 0.030, z, 0.021, 0.016, L + 0.01, MAT.chrome, { x: rx }));     // polierte Schneide
    parts.push(p(0, y + 0.0, z, 0.0185, 0.008, L + 0.01, MAT.glow, { x: rx }));        // leuchtende Hohlkehle
    parts.push(p(0, y + 0.043, z, 0.011, 0.009, L + 0.01, MAT.black, { x: rx }));      // Ruecken
  }
  const dEnd = SEG * L;
  const yEnd = 0.5 * k * dEnd * dEnd * 0.5, rEnd = k * dEnd * 0.5;
  parts.push(p(0, yEnd + 0.016, -0.055 - dEnd - 0.06, 0.015, 0.06, 0.12, MAT.steelDark, { x: rEnd + 0.15 }));
  parts.push(p(0, yEnd - 0.006, -0.055 - dEnd - 0.06, 0.02, 0.014, 0.12, MAT.chrome, { x: rEnd + 0.15 }));
  parts.push(p(0, yEnd + 0.036, -0.055 - dEnd - 0.135, 0.013, 0.03, 0.05, MAT.chrome, { x: rEnd + 0.35 }));
  return parts;
}

// ------------------------------------------------------------
// Bauteil-Sets
// ------------------------------------------------------------
const PARTS = {
  // M4-artiges Sturmgewehr
  ar: [
    p(0, 0.02, -0.22, 0.10, 0.12, 0.78, MAT.body),
    p(0, -0.06, -0.05, 0.095, 0.09, 0.42, MAT.dark),
    p(0.052, 0.03, -0.14, 0.006, 0.04, 0.12, MAT.metal),
    p(0, -0.22, -0.16, 0.07, 0.30, 0.14, MAT.dark, { x: 0.15 }),
    p(0, -0.37, -0.12, 0.075, 0.03, 0.15, MAT.metal, { x: 0.15 }),
    p(0, 0.02, -0.82, 0.09, 0.10, 0.46, MAT.dark),
    p(0, 0.085, -0.6, 0.05, 0.022, 0.9, MAT.metal),
    p(-0.052, 0.0, -0.82, 0.012, 0.03, 0.42, MAT.metal),
    p(0.052, 0.0, -0.82, 0.012, 0.03, 0.42, MAT.metal),
    p(0, 0.03, -1.18, 0.05, 0.05, 0.34, MAT.steelDark),
    p(0, 0.03, -1.39, 0.07, 0.07, 0.12, MAT.dark),
    p(0, 0.03, -1.39, 0.075, 0.02, 0.10, MAT.black),
    ...frontSight(0.12, -1.02),
    p(0, 0.125, -0.10, 0.05, 0.07, 0.15, MAT.dark),
    p(0, 0.16, -0.10, 0.056, 0.012, 0.16, MAT.black),
    p(0, 0.14, -0.18, 0.038, 0.04, 0.008, MAT.glowR),
    ...rearSight(0.12, 0.10),
    p(0, 0.06, 0.20, 0.06, 0.03, 0.06, MAT.metal),
    p(0, -0.17, 0.12, 0.07, 0.24, 0.10, MAT.grip, { x: -0.25 }),
    ...triggerGuard(0.0),
    p(0, 0.02, 0.40, 0.06, 0.06, 0.36, MAT.metal),
    p(0, 0.0, 0.52, 0.085, 0.13, 0.22, MAT.body),
    p(0, 0.0, 0.64, 0.09, 0.15, 0.03, MAT.rubber),
    p(0, -0.14, -0.75, 0.05, 0.14, 0.06, MAT.grip),
  ],
  smg: [
    p(0, 0.0, -0.18, 0.095, 0.13, 0.66, MAT.body),
    p(0, 0.075, -0.2, 0.04, 0.02, 0.5, MAT.metal),
    p(0.05, 0.03, -0.38, 0.03, 0.02, 0.05, MAT.metal),
    p(0, -0.02, -0.58, 0.085, 0.10, 0.34, MAT.dark),
    p(0, 0.02, -0.82, 0.045, 0.045, 0.18, MAT.steelDark),
    p(0, 0.02, -0.94, 0.055, 0.055, 0.06, MAT.dark),
    p(0, -0.24, -0.20, 0.055, 0.36, 0.09, MAT.dark, { x: 0.1 }),
    p(0, -0.42, -0.17, 0.06, 0.025, 0.10, MAT.metal, { x: 0.1 }),
    p(0, -0.15, 0.10, 0.07, 0.22, 0.10, MAT.grip, { x: -0.2 }),
    ...triggerGuard(-0.02),
    p(-0.032, 0.02, 0.32, 0.02, 0.03, 0.30, MAT.metal),
    p(0.032, 0.02, 0.32, 0.02, 0.03, 0.30, MAT.metal),
    p(0, 0.0, 0.48, 0.08, 0.11, 0.03, MAT.dark),
    p(0, 0.115, 0.0, 0.05, 0.06, 0.06, MAT.dark),
    p(0, 0.115, -0.72, 0.035, 0.07, 0.04, MAT.dark),
    p(0, 0.16, -0.72, 0.012, 0.03, 0.012, MAT.dark),
  ],
  sniper: [
    p(0, -0.02, 0.42, 0.09, 0.17, 0.46, MAT.wood),
    p(0, 0.08, 0.38, 0.07, 0.04, 0.30, MAT.wood2),
    p(0, -0.02, 0.66, 0.095, 0.18, 0.03, MAT.rubber),
    p(0, 0.0, -0.05, 0.095, 0.13, 0.5, MAT.wood),
    p(0, 0.05, -0.12, 0.07, 0.08, 0.44, MAT.dark),
    p(0.07, 0.05, 0.0, 0.06, 0.025, 0.025, MAT.steel),
    p(0.11, 0.03, 0.0, 0.032, 0.032, 0.032, MAT.steel),
    p(0, 0.03, -0.95, 0.045, 0.045, 1.0, MAT.steelDark),
    p(0, 0.03, -1.48, 0.06, 0.06, 0.10, MAT.metal),
    p(0, -0.03, -0.55, 0.09, 0.09, 0.5, MAT.wood),
    p(0, 0.16, -0.28, 0.06, 0.06, 0.5, MAT.dark),
    p(0, 0.16, -0.58, 0.085, 0.085, 0.10, MAT.metal),
    p(0, 0.16, 0.0, 0.075, 0.075, 0.08, MAT.metal),
    p(0, 0.16, -0.635, 0.07, 0.07, 0.01, MAT.glowSoft),
    p(0, 0.11, -0.16, 0.045, 0.06, 0.04, MAT.metal),
    p(0, 0.11, -0.42, 0.045, 0.06, 0.04, MAT.metal),
    p(0, -0.12, -0.10, 0.06, 0.10, 0.14, MAT.dark),
    p(0, -0.14, 0.16, 0.07, 0.22, 0.11, MAT.wood, { x: -0.22 }),
    ...triggerGuard(0.0),
    p(-0.05, -0.12, -0.85, 0.02, 0.22, 0.02, MAT.metal, { x: -1.3 }),
    p(0.05, -0.12, -0.85, 0.02, 0.22, 0.02, MAT.metal, { x: -1.3 }),
  ],
  shotgun: [
    p(0, 0, -0.15, 0.10, 0.14, 0.5, MAT.body),
    p(0, 0.04, -0.85, 0.055, 0.055, 0.8, MAT.steelDark),
    p(0, -0.04, -0.80, 0.05, 0.05, 0.7, MAT.metal),
    p(0, 0.04, -1.27, 0.065, 0.065, 0.06, MAT.metal),
    p(0, -0.03, -0.72, 0.09, 0.09, 0.24, MAT.wood),
    p(0, -0.03, -0.66, 0.095, 0.095, 0.02, MAT.wood2),
    p(0, -0.03, -0.78, 0.095, 0.095, 0.02, MAT.wood2),
    p(0.062, 0.02, -0.02, 0.02, 0.04, 0.05, MAT.red),
    p(0.062, 0.02, -0.10, 0.02, 0.04, 0.05, MAT.red),
    p(0.062, 0.02, -0.18, 0.02, 0.04, 0.05, MAT.red),
    p(0.062, 0.02, -0.26, 0.02, 0.04, 0.05, MAT.brass),
    p(0, -0.14, 0.12, 0.075, 0.22, 0.11, MAT.wood, { x: -0.24 }),
    p(0, 0.0, 0.42, 0.09, 0.15, 0.42, MAT.wood),
    p(0, 0.0, 0.64, 0.095, 0.16, 0.03, MAT.rubber),
    ...triggerGuard(0.0),
    p(0, 0.085, -1.22, 0.015, 0.02, 0.02, MAT.accent),
    p(0, 0.09, -0.2, 0.04, 0.03, 0.06, MAT.dark),
  ],
  lmg: [
    p(0, 0, -0.24, 0.12, 0.16, 0.9, MAT.green),
    p(0, 0.09, -0.2, 0.11, 0.03, 0.7, MAT.dark),
    p(0, 0.16, -0.1, 0.03, 0.05, 0.28, MAT.dark),
    p(0, 0.12, -0.22, 0.03, 0.04, 0.03, MAT.dark),
    p(0, 0.12, 0.02, 0.03, 0.04, 0.03, MAT.dark),
    p(0, 0.03, -1.0, 0.06, 0.06, 0.7, MAT.steelDark),
    p(0, 0.05, -0.85, 0.09, 0.07, 0.4, MAT.metal),
    p(0, 0.03, -1.4, 0.08, 0.08, 0.12, MAT.metal),
    p(0, -0.2, -0.28, 0.20, 0.24, 0.28, MAT.tan),
    p(0, -0.08, -0.28, 0.21, 0.02, 0.29, MAT.dark),
    p(-0.06, -0.28, -0.9, 0.03, 0.30, 0.03, MAT.metal, { z: 0.35 }),
    p(0.06, -0.28, -0.9, 0.03, 0.30, 0.03, MAT.metal, { z: -0.35 }),
    p(0, -0.16, 0.12, 0.08, 0.24, 0.11, MAT.grip, { x: -0.22 }),
    ...triggerGuard(0.0),
    p(0, 0.0, 0.44, 0.10, 0.16, 0.4, MAT.green),
    p(0, 0.0, 0.65, 0.105, 0.17, 0.03, MAT.rubber),
    ...rearSight(0.13, 0.12),
    ...frontSight(0.13, -1.1),
  ],
  burst: [
    p(0, 0, -0.2, 0.10, 0.14, 0.9, MAT.tan),
    p(0, 0.13, -0.15, 0.04, 0.05, 0.7, MAT.dark),
    p(0, 0.09, -0.48, 0.03, 0.04, 0.03, MAT.dark),
    p(0, 0.09, 0.18, 0.03, 0.04, 0.03, MAT.dark),
    p(0, 0.02, -0.95, 0.05, 0.05, 0.4, MAT.steelDark),
    p(0, 0.02, -1.18, 0.065, 0.065, 0.10, MAT.dark),
    p(0, -0.2, 0.16, 0.07, 0.28, 0.12, MAT.dark, { x: 0.1 }),
    p(0, -0.15, -0.14, 0.07, 0.22, 0.10, MAT.grip, { x: -0.2 }),
    p(0, -0.115, -0.05, 0.05, 0.012, 0.40, MAT.dark),
    p(0, -0.14, -0.25, 0.05, 0.06, 0.012, MAT.dark),
    p(0, -0.10, -0.12, 0.012, 0.045, 0.018, MAT.metal),
    p(0, -0.12, -0.62, 0.05, 0.12, 0.06, MAT.grip),
    p(0, 0.0, 0.62, 0.10, 0.15, 0.03, MAT.rubber),
    p(0, 0.16, 0.10, 0.03, 0.04, 0.05, MAT.dark),
    p(0, 0.16, -0.45, 0.012, 0.045, 0.012, MAT.dark),
  ],
  marksman: [
    p(0, 0.02, -0.22, 0.10, 0.12, 0.84, MAT.body),
    p(0, -0.06, -0.05, 0.095, 0.09, 0.42, MAT.dark),
    p(0, -0.24, -0.14, 0.07, 0.32, 0.15, MAT.dark, { x: 0.12 }),
    p(0, 0.02, -0.86, 0.09, 0.10, 0.48, MAT.dark),
    p(0, 0.03, -1.28, 0.045, 0.045, 0.44, MAT.steelDark),
    p(0, 0.03, -1.52, 0.065, 0.065, 0.12, MAT.dark),
    p(0, 0.17, -0.20, 0.055, 0.055, 0.44, MAT.dark),
    p(0, 0.17, -0.46, 0.08, 0.08, 0.09, MAT.metal),
    p(0, 0.17, 0.04, 0.07, 0.07, 0.08, MAT.metal),
    p(0, 0.17, -0.51, 0.065, 0.065, 0.01, MAT.glowSoft),
    p(0, 0.115, -0.12, 0.045, 0.06, 0.04, MAT.metal),
    p(0, 0.115, -0.30, 0.045, 0.06, 0.04, MAT.metal),
    p(0, 0.06, 0.20, 0.06, 0.03, 0.06, MAT.metal),
    p(0, -0.17, 0.12, 0.07, 0.24, 0.10, MAT.grip, { x: -0.25 }),
    ...triggerGuard(0.0),
    p(0, 0.02, 0.40, 0.06, 0.06, 0.36, MAT.metal),
    p(0, 0.0, 0.54, 0.085, 0.14, 0.26, MAT.body),
    p(0, 0.0, 0.68, 0.09, 0.15, 0.03, MAT.rubber),
    p(0, 0.08, 0.5, 0.06, 0.03, 0.2, MAT.dark),
    ...frontSight(0.12, -1.05),
  ],
  rpg: [
    p(0, 0, -0.1, 0.13, 0.13, 1.5, MAT.green),
    p(0, 0, 0.62, 0.18, 0.18, 0.14, MAT.dark),
    p(0, 0, -0.45, 0.15, 0.15, 0.3, MAT.wood),
    p(0, 0.02, -1.0, 0.16, 0.16, 0.18, MAT.dark),
    p(0, 0.02, -1.25, 0.17, 0.17, 0.30, MAT.red),
    p(0, 0.02, -1.45, 0.11, 0.11, 0.16, MAT.red),
    p(0, 0.02, -1.56, 0.06, 0.06, 0.08, MAT.dark),
    p(0, -0.17, 0.02, 0.07, 0.24, 0.11, MAT.grip, { x: -0.2 }),
    p(0, -0.15, -0.60, 0.06, 0.20, 0.09, MAT.dark, { x: -0.1 }),
    ...triggerGuard(-0.08),
    p(0, 0.13, -0.25, 0.04, 0.12, 0.06, MAT.metal),
    p(0, 0.21, -0.25, 0.06, 0.06, 0.14, MAT.dark),
    p(0, 0.21, -0.325, 0.05, 0.05, 0.01, MAT.glowSoft),
    p(0, -0.12, 0.35, 0.06, 0.10, 0.2, MAT.dark),
  ],
  crossbow: [
    p(0, 0, -0.2, 0.11, 0.15, 0.7, MAT.body),
    p(0, 0.0, -0.1, 0.116, 0.04, 0.3, MAT.glow),
    p(0, 0.09, -0.3, 0.06, 0.02, 0.5, MAT.metal),
    p(0, 0.04, -0.75, 0.06, 0.09, 0.4, MAT.metal),
    p(0, 0.04, -0.95, 0.03, 0.03, 0.4, MAT.glow),
    p(0, 0.04, -1.12, 0.09, 0.09, 0.06, MAT.dark),
    p(0, 0.04, -1.12, 0.05, 0.05, 0.07, MAT.glow),
    p(-0.07, 0.02, -0.3, 0.02, 0.10, 0.3, MAT.metal),
    p(0.07, 0.02, -0.3, 0.02, 0.10, 0.3, MAT.metal),
    p(0, -0.16, 0.06, 0.07, 0.24, 0.10, MAT.grip, { x: -0.22 }),
    ...triggerGuard(-0.06),
    p(0, 0, 0.32, 0.08, 0.12, 0.3, MAT.dark),
    p(0, 0.04, 0.32, 0.05, 0.02, 0.28, MAT.glow),
    p(0, 0.12, 0.0, 0.04, 0.05, 0.06, MAT.dark),
    p(0, 0.15, -0.02, 0.035, 0.035, 0.008, MAT.glow),
  ],
  revolver: [
    p(0, 0, -0.08, 0.07, 0.11, 0.36, MAT.steel),
    p(0, 0.02, -0.42, 0.05, 0.06, 0.36, MAT.steel),
    p(0, -0.03, -0.42, 0.035, 0.035, 0.34, MAT.steel),
    p(0, -0.01, -0.10, 0.10, 0.10, 0.16, MAT.metal),
    p(0, -0.01, -0.10, 0.10, 0.10, 0.16, MAT.metal, { z: 0.52 }),
    p(0, -0.01, -0.10, 0.10, 0.10, 0.16, MAT.metal, { z: 1.05 }),
    p(0, -0.01, -0.10, 0.06, 0.06, 0.17, MAT.dark),
    p(0, 0.07, 0.06, 0.02, 0.06, 0.05, MAT.dark, { x: 0.5 }),
    p(0, -0.15, 0.10, 0.065, 0.24, 0.10, MAT.wood, { x: -0.32 }),
    p(0.034, -0.14, 0.10, 0.006, 0.05, 0.05, MAT.brass, { x: -0.32 }),
    ...triggerGuard(-0.03, MAT.steel),
    p(0, 0.075, -0.06, 0.035, 0.045, 0.06, MAT.dark),
    p(0, 0.075, -0.58, 0.012, 0.04, 0.03, MAT.dark),
  ],
  pistol: [
    p(0, 0.01, -0.16, 0.065, 0.09, 0.44, MAT.body),
    p(-0.034, 0.01, 0.0, 0.004, 0.06, 0.10, MAT.dark),
    p(0.034, 0.01, 0.0, 0.004, 0.06, 0.10, MAT.dark),
    p(0.034, 0.02, -0.22, 0.004, 0.035, 0.10, MAT.metal),
    p(0, 0.005, -0.40, 0.035, 0.035, 0.06, MAT.steel),
    p(0, -0.06, -0.10, 0.06, 0.05, 0.34, MAT.dark),
    p(0, -0.09, -0.24, 0.05, 0.02, 0.12, MAT.metal),
    p(0, -0.18, 0.03, 0.06, 0.28, 0.10, MAT.grip, { x: -0.14 }),
    p(0, -0.325, 0.06, 0.065, 0.02, 0.11, MAT.dark, { x: -0.14 }),
    p(0, -0.115, -0.09, 0.05, 0.012, 0.14, MAT.dark),
    p(0, -0.145, -0.16, 0.05, 0.06, 0.012, MAT.dark),
    p(0, -0.10, -0.06, 0.012, 0.045, 0.018, MAT.metal),
    p(0, 0.07, -0.05, 0.03, 0.03, 0.05, MAT.dark),
    p(0, 0.07, -0.34, 0.012, 0.035, 0.03, MAT.dark),
    p(0, 0.09, -0.36, 0.008, 0.008, 0.008, MAT.glowSoft),
  ],
  akimbo: [-0.13, 0.13].flatMap((x) => [
    p(x, 0, -0.10, 0.065, 0.11, 0.5, MAT.body),
    p(x, 0.01, -0.42, 0.04, 0.04, 0.2, MAT.steelDark),
    p(x, 0.01, -0.54, 0.05, 0.05, 0.05, MAT.metal),
    p(x, 0.07, 0.05, 0.03, 0.03, 0.05, MAT.metal),
    p(x, -0.17, 0.02, 0.06, 0.26, 0.10, MAT.grip, { x: -0.14 }),
    p(x, -0.36, 0.045, 0.05, 0.12, 0.08, MAT.dark, { x: -0.14 }),
    p(x, -0.115, -0.09, 0.05, 0.012, 0.14, MAT.dark),
    p(x, -0.145, -0.16, 0.05, 0.06, 0.012, MAT.dark),
    p(x, -0.10, -0.06, 0.012, 0.045, 0.018, MAT.metal),
    p(x, 0.075, -0.32, 0.012, 0.03, 0.02, MAT.dark),
    p(x, 0.075, 0.1, 0.04, 0.03, 0.04, MAT.dark),
    p(x, 0.03, 0.22, 0.05, 0.03, 0.06, MAT.metal),
  ]),
  // Kampfmesser im CS:GO-/Valorant-Stil: Goldparier, leuchtende Inlays,
  // dunkle Klinge mit polierter Schneide und Clip-Point-Spitze
  knife: [
    p(0, -0.01, 0.15, 0.046, 0.082, 0.26, MAT.grip),
    p(0, -0.01, 0.06, 0.05, 0.088, 0.024, MAT.gold),
    p(0, -0.01, 0.285, 0.05, 0.088, 0.03, MAT.gold),
    p(0.024, 0.014, 0.16, 0.004, 0.010, 0.20, MAT.glow),
    p(-0.024, 0.014, 0.16, 0.004, 0.010, 0.20, MAT.glow),
    p(0.024, -0.03, 0.16, 0.004, 0.008, 0.20, MAT.gold),
    p(-0.024, -0.03, 0.16, 0.004, 0.008, 0.20, MAT.gold),
    p(0, 0.0, 0.0, 0.12, 0.03, 0.05, MAT.gold),
    p(-0.055, -0.03, 0.0, 0.016, 0.045, 0.04, MAT.gold),
    p(0.055, -0.03, 0.0, 0.016, 0.045, 0.04, MAT.gold),
    p(0, 0.005, -0.28, 0.016, 0.09, 0.52, MAT.steelDark),
    p(0, -0.036, -0.28, 0.02, 0.018, 0.52, MAT.chrome),
    p(0, 0.048, -0.24, 0.022, 0.012, 0.44, MAT.black),
    p(0, 0.018, -0.24, 0.018, 0.010, 0.40, MAT.glow),
    p(0, 0.055, -0.07, 0.024, 0.012, 0.012, MAT.black),
    p(0, 0.055, -0.10, 0.024, 0.012, 0.012, MAT.black),
    p(0, 0.055, -0.13, 0.024, 0.012, 0.012, MAT.black),
    p(0, 0.055, -0.16, 0.024, 0.012, 0.012, MAT.black),
    p(0, 0.02, -0.58, 0.015, 0.06, 0.10, MAT.steelDark, { x: 0.3 }),
    p(0, -0.012, -0.62, 0.014, 0.03, 0.06, MAT.chrome, { x: 0.55 }),
    p(0, 0.03, -0.60, 0.012, 0.010, 0.08, MAT.glow, { x: 0.3 }),
  ],
  katana: katanaParts(),
  nade: [
    p(0, 0, 0, 0.14, 0.18, 0.14, MAT.green),
    p(0, 0, 0, 0.14, 0.18, 0.14, MAT.green, { y: 0.785 }),
    p(0, 0.06, 0, 0.145, 0.02, 0.145, MAT.dark),
    p(0, -0.04, 0, 0.145, 0.02, 0.145, MAT.dark),
    p(0, 0.11, 0, 0.06, 0.05, 0.06, MAT.metal),
    p(0.05, 0.10, 0, 0.02, 0.09, 0.02, MAT.metal),
    p(0.07, 0.13, 0, 0.03, 0.03, 0.01, MAT.metal),
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
    sound: { kind: 'rifle', vol: 0.85, pitch: 1 },
    parts: PARTS.ar,
    muzzle: [0, 0.03, -1.42],
    hold: 'rifle',
    equip: 'raise',
    grips: { r: [0, -0.16, 0.10], l: [0, -0.05, -0.62] },
    icon: '\u{1F52B}',
  }, o);
}

export const WEAPONS = {
  ar: W({
    id: 'ar', name: 'Assault Rifle', short: 'AR',
    damage: 27, rpm: 545, mag: 30, reserve: 120, reloadTime: 2.0,
    spread: 0.0035, spreadPerShot: 0.0055, spreadMax: 0.075,
    recoilV: 0.95, recoilH: 0.34,
    range: 320, falloffStart: 45, falloffEnd: 140, falloffMin: 0.6,
    moveMult: 1.0, parts: PARTS.ar, muzzle: [0, 0.03, -1.46], sightY: 0.135,
    grips: { r: [0, -0.16, 0.12], l: [0, -0.06, -0.72] },
    sound: { kind: 'rifle', vol: 0.9, pitch: 1.0 },
  }),
  smg: W({
    id: 'smg', name: 'Submachine Gun', short: 'SMG',
    damage: 16, headMult: 1.9, rpm: 900, mag: 32, reserve: 160, reloadTime: 1.7,
    spread: 0.008, spreadPerShot: 0.0055, spreadMax: 0.1, spreadMove: 0.018,
    recoilV: 0.55, recoilH: 0.42, kick: 0.035,
    range: 160, falloffStart: 22, falloffEnd: 70, falloffMin: 0.45,
    moveMult: 1.14, adsFov: 0.82, parts: PARTS.smg, muzzle: [0, 0.02, -0.98], sightY: 0.115,
    grips: { r: [0, -0.14, 0.10], l: [0, -0.06, -0.55] },
    tracer: 0xffe8b0,
    sound: { kind: 'smg', vol: 0.65, pitch: 1.05 },
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
    switchTime: 0.7, parts: PARTS.sniper, muzzle: [0, 0.03, -1.54], sightY: 0.16,
    grips: { r: [0, -0.13, 0.16], l: [0, -0.07, -0.62] },
    tracer: 0xffffff, tracerWidth: 0.07,
    sound: { kind: 'sniper', vol: 1.3, pitch: 1.0 },
  }),
  shotgun: W({
    id: 'shotgun', name: 'Shotgun', short: 'SHOTGUN',
    damage: 12, headMult: 1.5, pellets: 9, rpm: 85, auto: false,
    mag: 6, reserve: 36, reloadTime: 0.55, reloadType: 'single', reloadFillsAll: false,
    spread: 0.052, spreadPerShot: 0.0, spreadMax: 0.09, spreadMove: 0.012, spreadAds: 0.62,
    recoilV: 2.6, recoilH: 0.5, kick: 0.24,
    range: 60, falloffStart: 9, falloffEnd: 34, falloffMin: 0.18,
    adsFov: 0.86, moveMult: 0.96,
    parts: PARTS.shotgun, muzzle: [0, 0.04, -1.32], sightY: 0.085,
    grips: { r: [0, -0.13, 0.12], l: [0, -0.08, -0.72] },
    tracer: 0xffd27a, tracerWidth: 0.035,
    sound: { kind: 'shotgun', vol: 1.2, pitch: 1.0 },
  }),
  lmg: W({
    id: 'lmg', name: 'LMG', short: 'LMG',
    damage: 30, rpm: 430, mag: 60, reserve: 180, reloadTime: 3.6,
    spread: 0.006, spreadPerShot: 0.006, spreadMax: 0.11, spreadMove: 0.045,
    recoilV: 1.15, recoilH: 0.5, kick: 0.075,
    range: 320, falloffStart: 55, falloffEnd: 160, falloffMin: 0.65,
    moveMult: 0.82, adsMoveMult: 0.34, adsFov: 0.72, switchTime: 0.75,
    parts: PARTS.lmg, muzzle: [0, 0.03, -1.48], sightY: 0.135,
    grips: { r: [0, -0.15, 0.12], l: [0, -0.10, -0.66] },
    sound: { kind: 'lmg', vol: 1.0, pitch: 0.95 },
  }),
  marksman: W({
    id: 'marksman', name: 'Marksman', short: 'MARKSMAN',
    damage: 48, headMult: 2.1, rpm: 260, auto: false, mag: 12, reserve: 72, reloadTime: 2.2,
    spread: 0.0016, spreadPerShot: 0.016, spreadMax: 0.1, spreadMove: 0.05,
    recoilV: 1.9, recoilH: 0.4, kick: 0.14,
    range: 400, falloffStart: 90, falloffEnd: 240, falloffMin: 0.8,
    adsFov: 0.44, adsTime: 0.2, moveMult: 0.93,
    parts: PARTS.marksman, muzzle: [0, 0.03, -1.58], sightY: 0.17,
    grips: { r: [0, -0.16, 0.12], l: [0, -0.06, -0.78] },
    tracer: 0xfff0c0,
    sound: { kind: 'rifle', vol: 1.05, pitch: 0.8 },
  }),
  burst: W({
    id: 'burst', name: 'Burst Rifle', short: 'BURST',
    damage: 29, rpm: 420, auto: false, burst: 3, burstDelay: 0.062,
    mag: 30, reserve: 120, reloadTime: 2.1,
    spread: 0.0025, spreadPerShot: 0.004, spreadMax: 0.06,
    recoilV: 0.85, recoilH: 0.28,
    range: 340, falloffStart: 60, falloffEnd: 170, falloffMin: 0.7,
    adsFov: 0.62, parts: PARTS.burst, muzzle: [0, 0.02, -1.23], sightY: 0.16,
    grips: { r: [0, -0.15, -0.14], l: [0, -0.10, -0.60] },
    sound: { kind: 'rifle', vol: 0.85, pitch: 1.1 },
  }),
  akimbo: W({
    id: 'akimbo', name: 'Akimbo Uzi', short: 'AKIMBO',
    damage: 14, headMult: 1.8, rpm: 1100, mag: 40, reserve: 200, reloadTime: 2.4,
    spread: 0.014, spreadPerShot: 0.004, spreadMax: 0.12, spreadMove: 0.012, spreadAds: 0.75,
    recoilV: 0.45, recoilH: 0.55, kick: 0.03,
    range: 120, falloffStart: 18, falloffEnd: 55, falloffMin: 0.4,
    adsFov: 0.92, moveMult: 1.18,
    parts: PARTS.akimbo, muzzle: [0, 0.01, -0.56], dualMuzzle: [[-0.13, 0.01, -0.56], [0.13, 0.01, -0.56]],
    hold: 'akimbo', sightY: 0.02,
    grips: { r: [0.13, -0.16, 0.02], l: [-0.13, -0.16, 0.02] },
    vmPos: [0.0, -0.20, -0.62],
    sound: { kind: 'smg', vol: 0.55, pitch: 1.2 },
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
    parts: PARTS.rpg, muzzle: [0, 0.02, -1.62], sightY: 0.21,
    hold: 'launcher',
    grips: { r: [0, -0.16, 0.02], l: [0, -0.14, -0.60] },
    vmPos: [0.21, -0.13, -0.62],
    sound: { kind: 'rpg', vol: 1.2, pitch: 1.0 },
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
    parts: PARTS.crossbow, muzzle: [0, 0.04, -1.16], sightY: 0.15,
    grips: { r: [0, -0.15, 0.06], l: [0, -0.05, -0.50] },
    tracer: 0x2ee6ff,
    sound: { kind: 'energy', vol: 0.8, pitch: 1.0 },
  }),

  pistol: W({
    id: 'pistol', name: 'Pistol', short: 'PISTOL', slot: 1,
    damage: 26, headMult: 2.0, rpm: 400, auto: false, mag: 12, reserve: 60, reloadTime: 1.5,
    spread: 0.004, spreadPerShot: 0.012, spreadMax: 0.07, spreadMove: 0.02,
    recoilV: 1.1, recoilH: 0.35, kick: 0.09,
    range: 140, falloffStart: 26, falloffEnd: 80, falloffMin: 0.45,
    adsFov: 0.8, moveMult: 1.12, switchTime: 0.3,
    parts: PARTS.pistol, muzzle: [0, 0.005, -0.44], sightY: 0.078,
    hold: 'pistol',
    grips: { r: [0, -0.16, 0.03], l: [-0.035, -0.21, 0.01] },
    sound: { kind: 'pistol', vol: 0.7, pitch: 1.0 },
  }),
  revolver: W({
    id: 'revolver', name: 'Revolver', short: 'REVOLVER', slot: 1,
    damage: 58, headMult: 2.0, rpm: 190, auto: false, mag: 6, reserve: 36, reloadTime: 2.2,
    spread: 0.0025, spreadPerShot: 0.03, spreadMax: 0.09, spreadMove: 0.03,
    recoilV: 2.4, recoilH: 0.5, kick: 0.2,
    range: 200, falloffStart: 45, falloffEnd: 120, falloffMin: 0.55,
    adsFov: 0.66, moveMult: 1.05, switchTime: 0.38,
    parts: PARTS.revolver, muzzle: [0, 0.02, -0.62], sightY: 0.082,
    hold: 'pistol',
    grips: { r: [0, -0.14, 0.10], l: [-0.035, -0.19, 0.08] },
    sound: { kind: 'revolver', vol: 1.05, pitch: 1.0 },
  }),

  knife: W({
    id: 'knife', name: 'Combat Knife', short: 'KNIFE', slot: 2,
    damage: 55, headMult: 1.6, rpm: 150, auto: false, mag: Infinity, reserve: 0,
    melee: true, meleeRange: 3.4, meleeArc: 0.55, meleeBackstab: 3.0, swing: 'slash', swingTime: 0.30,
    heavy: { damage: 100, meleeRange: 3.6, meleeBackstab: 1.5, swing: 'stab', swingTime: 0.62, hitAt: 0.42, lunge: 5.5 },
    lunge: 3.5, knockback: 4,
    moveMult: 1.25, switchTime: 0.45, adsFov: 1, spread: 0,
    parts: PARTS.knife, muzzle: [0, 0, -0.5],
    hold: 'knife', equip: 'flip',
    grips: { r: [0, -0.01, 0.15], l: null },
    // Klinge zeigt nach oben (CS:GO-Haltung)
    vmPos: [0.30, -0.28, -0.52],
    vmRot: [1.15, 0.30, -0.22],
    icon: '\u{1F52A}',
  }),
  katana: W({
    id: 'katana', name: 'Katana', short: 'KATANA', slot: 2,
    damage: 95, headMult: 1.2, rpm: 110, auto: false, mag: Infinity, reserve: 0,
    melee: true, meleeRange: 4.4, meleeArc: 0.6, meleeBackstab: 1.6, swing: 'sweep', swingTime: 0.40,
    heavy: { damage: 150, meleeRange: 4.6, meleeBackstab: 1.3, swing: 'overhead', swingTime: 0.85, hitAt: 0.5, lunge: 7 },
    lunge: 4.5, knockback: 7,
    moveMult: 1.3, switchTime: 0.6, adsFov: 1, spread: 0,
    parts: PARTS.katana, muzzle: [0, 0, -1.0],
    hold: 'katana', equip: 'unsheathe',
    grips: { r: [0, -0.02, 0.10], l: [0, -0.02, 0.30] },
    vmPos: [0.36, -0.31, -0.60],
    vmRot: [1.35, -0.05, -0.20],
    icon: '⚔',
  }),

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
    hp: 90, armor: 0, speed: 1.16, jumps: 2, nades: 2, dash: true,
    perks: ['Doppelsprung', 'Dash (E)', '+16% Tempo'],
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
    hp: 85, armor: 0, speed: 1.2, jumps: 2, nades: 2, dash: true, wallrun: true,
    perks: ['Doppelsprung', 'Dash (E)', 'Wandlauf', 'Katana'],
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
    hp: 85, armor: 0, speed: 1.22, jumps: 3, nades: 1, dash: true, wallrun: true,
    perks: ['Dreifachsprung', 'Wandlauf', 'Dash (E)', 'Leise'],
    stats: { schaden: 0.66, feuerrate: 0.4, reichweite: 0.5, mobilitaet: 1.0 },
  },
];

export const CLASS_BY_ID = {};
for (const c of CLASSES) CLASS_BY_ID[c.id] = c;

export function fireDelay(w) { return 60 / w.rpm; }
