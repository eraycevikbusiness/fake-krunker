// ============================================================
// Kartendefinitionen
// Alle Karten bestehen aus achsenparallelen Boxen (wie Krunker).
// Koordinaten: (cx, by, cz) = Mitte X, Unterkante Y, Mitte Z
//
// WICHTIG: Rampen werden ueber rampTo() gebaut. Die Steigung bleibt
// dadurch <= ~0.55, sonst koennen weder Spieler noch Bots sie sauber
// erklimmen (siehe STEP_UP im Navigationsgitter in world.js).
// ============================================================

const MAX_SLOPE = 0.56;
const MAX_STEP_RISE = 0.5;

class MapBuilder {
  constructor(cfg) {
    Object.assign(this, cfg);
    this.boxes = [];
    this.spawnsRed = [];
    this.spawnsBlue = [];
    this.spawnsFfa = [];
    this.pickups = [];
    this.jumpPads = [];
    this.rampSteps = [];
    this.bounds = { min: -60, max: 60 };
    this.size = 120;
    // Farbe -> Oberflaechentyp (Schrittgeraeusche): sand | stone | wood | metal | grate | dirt | water
    this.surfaces = {};
    // Spielmodi: Flaggenbasen (CTF), Hardpoint-Zonen, Bombenplaetze (S&D)
    this.flags = {};
    this.hardpoints = [];
    this.bombsites = [];
    this.lamps = [];
    this.ziplines = [];
  }

  /** Bombenplatz fuer Search & Destroy */
  bombsite(name, x, z) { this.bombsites.push({ name, x, z }); }

  /**
   * Seilbahn von (x1,y1,z1) nach (x2,y2,z2). Beide Enden bekommen einen
   * Pfosten; das Seil selbst zeichnet das Spiel (diagonal, kein Box-Objekt).
   * y ist die Seilhoehe; Spieler haengen 1.95 darunter.
   */
  zipline(x1, y1, z1, x2, y2, z2) {
    this.ziplines.push({ a: { x: x1, y: y1, z: z1 }, b: { x: x2, y: y2, z: z2 } });
    for (const [x, y, z] of [[x1, y1, z1], [x2, y2, z2]]) {
      this.b(x, y - 3.2, z, 0.36, 3.2, 0.36, 0x3a3f46, { surface: 'metal' });
      this.b(x, y - 0.1, z, 0.7, 0.2, 0.7, 0xffcc00, { emissive: 0.4, noShadow: true, noCollide: true });
    }
  }
  ziplineS(x1, y1, z1, x2, y2, z2) { this.zipline(x1, y1, z1, x2, y2, z2); this.zipline(-x1, y1, -z1, -x2, y2, -z2); }

  /** Flaggenbasis fuer CTF */
  flag(x, z, team) { this.flags[team] = { x, z }; }
  flagS(x, z) { this.flag(x, z, 'red'); this.flag(-x, -z, 'blue'); }
  /** Hardpoint-Zone */
  hardpoint(x, z) { this.hardpoints.push({ x, z }); }
  /** Laterne (Nacht) */
  lamp(x, z) { this.lamps.push({ x, z }); }
  lampS(x, z) { this.lamp(x, z); this.lamp(-x, -z); }

  /** Zerstoerbare Kiste (Holz) */
  crate(cx, by, cz, size = 2.4, color = 0xa8703a) {
    return this.b(cx, by, cz, size, size, size, color, { surface: 'wood', destr: { type: 'crate', hp: 70, respawn: 40 } });
  }
  crateS(cx, by, cz, size, color) { this.crate(cx, by, cz, size, color); this.crate(-cx, by, -cz, size, color); }
  /** Explosives Fass */
  barrel(cx, by, cz) {
    return this.b(cx, by, cz, 1.3, 1.8, 1.3, 0xc0392b, { surface: 'metal', destr: { type: 'barrel', hp: 35, explode: true, respawn: 45 } });
  }
  barrelS(cx, by, cz) { this.barrel(cx, by, cz); this.barrel(-cx, by, -cz); }
  /** Glasscheibe (axis 'x': Flaeche liegt in der X-Y-Ebene, 'z': in der Z-Y-Ebene) */
  glass(cx, by, cz, w, h, axis = 'x') {
    const t = 0.12;
    return axis === 'x'
      ? this.b(cx, by, cz, w, h, t, 0xa8d8f0, { destr: { type: 'glass', hp: 1, respawn: 30 }, noShadow: true })
      : this.b(cx, by, cz, t, h, w, 0xa8d8f0, { destr: { type: 'glass', hp: 1, respawn: 30 }, noShadow: true });
  }
  glassS(cx, by, cz, w, h, axis) { this.glass(cx, by, cz, w, h, axis); this.glass(-cx, by, -cz, w, h, axis); }

  /** Box hinzufuegen. opts: {noCollide, emissive, noShadow, surface} */
  b(cx, by, cz, w, h, d, color, opts) {
    const box = { cx, by, cz, w, h, d, color };
    if (opts) Object.assign(box, opts);
    if (!box.surface) box.surface = this.surfaces[color] || 'stone';
    this.boxes.push(box);
    return box;
  }

  /** Box + um 180 Grad um Y gedrehte Kopie (Team-Symmetrie) */
  bs(cx, by, cz, w, h, d, color, opts) {
    this.b(cx, by, cz, w, h, d, color, opts);
    this.b(-cx, by, -cz, w, h, d, color, opts);
  }

  /** Box + an X gespiegelte Kopie */
  bx(cx, by, cz, w, h, d, color, opts) {
    this.b(cx, by, cz, w, h, d, color, opts);
    if (cx !== 0) this.b(-cx, by, cz, w, h, d, color, opts);
  }

  /** Alle vier Quadranten */
  b4(cx, by, cz, w, h, d, color, opts) {
    this.b(cx, by, cz, w, h, d, color, opts);
    if (cx !== 0) this.b(-cx, by, cz, w, h, d, color, opts);
    if (cz !== 0) this.b(cx, by, -cz, w, h, d, color, opts);
    if (cx !== 0 && cz !== 0) this.b(-cx, by, -cz, w, h, d, color, opts);
  }

  /**
   * Treppenrampe von Hoehe y0 auf y1.
   * (cx, cz) = Mitte, `length` = horizontale Laenge in Laufrichtung `dir`.
   * Ohne flip steigt sie in Richtung + der Achse, mit flip in Richtung -.
   * `base` = Unterkante der Stufenbloecke (auf welcher Ebene die Rampe steht).
   * Die Laenge wird bei Bedarf verlaengert, damit die Steigung begehbar bleibt.
   */
  rampTo(cx, cz, width, length, y0, y1, color, dir = 'z', flip = false, base = 0) {
    const rise = y1 - y0;
    const len = Math.max(length, Math.abs(rise) / MAX_SLOPE);
    const steps = Math.max(2, Math.ceil(Math.abs(rise) / MAX_STEP_RISE));
    const segLen = len / steps;
    for (let i = 0; i < steps; i++) {
      const top = y0 + (rise * (i + 1)) / steps;
      let off = -len / 2 + segLen / 2 + i * segLen;
      if (flip) off = -off;
      const h = top - base;
      if (h <= 0.02) continue;
      const box = (dir === 'z')
        ? this.b(cx, base, cz + off, width, h, segLen + 0.03, color)
        : this.b(cx + off, base, cz, segLen + 0.03, h, width, color);
      box.isRamp = true;
      this.rampSteps.push({
        minx: box.cx - box.w / 2, maxx: box.cx + box.w / 2,
        minz: box.cz - box.d / 2, maxz: box.cz + box.d / 2,
        top,
      });
    }
    return len;
  }

  /** rampTo + punktgespiegelte Kopie (Team-Symmetrie) */
  rampToS(cx, cz, width, length, y0, y1, color, dir = 'z', flip = false, base = 0) {
    this.rampTo(cx, cz, width, length, y0, y1, color, dir, flip, base);
    this.rampTo(-cx, -cz, width, length, y0, y1, color, dir, !flip, base);
  }

  /** Hohles Gebaeude: 4 Waende mit Tueroeffnungen + optionales Dach */
  building(cx, by, cz, w, h, d, wall, roofColor, opts) {
    const o = opts || {};
    const t = o.thickness || 1;
    const doorW = o.doorW || 5;
    const doorH = Math.min(o.doorH || 5, h);
    const doors = o.doors || { n: true, s: true, e: false, w: false };
    const lintel = h - doorH;

    const side = (isNS, sign) => {
      const len = isNS ? w : d;
      const has = isNS ? (sign > 0 ? doors.n : doors.s) : (sign > 0 ? doors.e : doors.w);
      const px = isNS ? cx : cx + sign * (w / 2 - t / 2);
      const pz = isNS ? cz + sign * (d / 2 - t / 2) : cz;
      const sw = isNS ? len : t;
      const sd = isNS ? t : len;
      if (!has) { this.b(px, by, pz, sw, h, sd, wall); return; }
      const sideW = (len - doorW) / 2;
      if (isNS) {
        this.b(px - (doorW / 2 + sideW / 2), by, pz, sideW, h, sd, wall);
        this.b(px + (doorW / 2 + sideW / 2), by, pz, sideW, h, sd, wall);
        if (lintel > 0.1) this.b(px, by + doorH, pz, doorW, lintel, sd, wall);
      } else {
        this.b(px, by, pz - (doorW / 2 + sideW / 2), sw, h, sideW, wall);
        this.b(px, by, pz + (doorW / 2 + sideW / 2), sw, h, sideW, wall);
        if (lintel > 0.1) this.b(px, by + doorH, pz, sw, lintel, doorW, wall);
      }
    };
    side(true, 1); side(true, -1); side(false, 1); side(false, -1);
    if (o.roof !== false) this.b(cx, by + h, cz, w, o.roofT || 0.8, d, roofColor || wall);
  }

  buildingS(cx, by, cz, w, h, d, wall, roof, opts) {
    this.building(cx, by, cz, w, h, d, wall, roof, opts);
    const o2 = Object.assign({}, opts || {});
    if (o2.doors) o2.doors = { n: o2.doors.s, s: o2.doors.n, e: o2.doors.w, w: o2.doors.e };
    this.building(-cx, by, -cz, w, h, d, wall, roof, o2);
  }

  /**
   * Spawnpunkt. Die Blickrichtung zeigt automatisch zur Kartenmitte
   * (yaw = atan2(x, z) ergibt Vorwaerts = -pos/|pos|).
   */
  spawn(x, z, team) {
    const p = { x, y: 0.3, z, yaw: Math.atan2(x, z) };
    if (team === 'red') this.spawnsRed.push(p);
    else if (team === 'blue') this.spawnsBlue.push(p);
    this.spawnsFfa.push(p);
  }

  /** Spawn fuer Rot + punktgespiegelter Spawn fuer Blau */
  spawnS(x, z) {
    this.spawn(x, z, 'red');
    this.spawn(-x, -z, 'blue');
  }

  pad(cx, cz, power = 24, color = 0x2ee6a8) {
    this.b(cx, 0.02, cz, 4, 0.3, 4, color, { emissive: 0.7, noShadow: true });
    this.jumpPads.push({ x: cx, z: cz, r: 2.6, power });
  }
  padS(cx, cz, power, color) { this.pad(cx, cz, power, color); this.pad(-cx, -cz, power, color); }

  pickup(x, z, type, y = 1.2) { this.pickups.push({ x, y, z, type }); }
  pickupS(x, z, type, y) { this.pickup(x, z, type, y); this.pickup(-x, -z, type, y); }

  /** Boden + Aussenmauern */
  arena(size, groundColor, wallColor, wallH = 34) {
    const s = size / 2;
    this.b(0, -3, 0, size + 30, 3, size + 30, groundColor);
    this.b(0, 0, s + 2, size + 12, wallH, 4, wallColor);
    this.b(0, 0, -s - 2, size + 12, wallH, 4, wallColor);
    this.b(s + 2, 0, 0, 4, wallH, size + 12, wallColor);
    this.b(-s - 2, 0, 0, 4, wallH, size + 12, wallColor);
    this.bounds = { min: -s, max: s };
    this.size = size;
  }
}

// ============================================================
// SANDSTORM — Wuestenstadt: offene Mitte, Dachlinien, Marktgassen
// ============================================================
function buildSandstorm() {
  const m = new MapBuilder({
    id: 'sandstorm',
    name: 'SANDSTORM',
    skyTop: 0x3f7cc4, skyBottom: 0xf0d9ac,
    fogColor: 0xdcc8a2, fogNear: 80, fogFar: 250,
    sunDir: [0.52, 0.74, 0.42], sunColor: 0xfff2d6, sunIntensity: 1.45,
    ambTop: 0xa8c8f0, ambBottom: 0xc9a86e, ambIntensity: 0.62,
  });

  const C = {
    ground: 0xcaa25c, wall: 0xe3c795, wall2: 0xb98a4e, dark: 0x8a6534,
    roof: 0xa8512c, crate: 0xc08a44, metal: 0x7d8894, cloth: 0x2a6f9e,
    stone: 0xdcd2b0, plank: 0x87582c, teal: 0x2f8f86, door: 0x3b5c8a,
  };
  m.surfaces = {
    [C.ground]: 'sand', [C.plank]: 'wood', [C.crate]: 'wood', [C.metal]: 'metal',
    [C.roof]: 'wood', [C.teal]: 'metal',
  };

  m.arena(120, C.ground, C.wall2, 36);

  // ---------------- Zentrum: Ziggurat mit Turm ----------------
  m.b(0, 0, 0, 26, 3, 26, C.stone);       // Ebene 1, Oberkante 3   (x,z -13..13)
  m.b(0, 3, 0, 18, 3, 18, C.wall);        // Ebene 2, Oberkante 6   (x,z  -9..9)
  m.b(0, 6, 0, 8, 8, 8, C.wall2);         // Turmschaft, Oberkante 14
  m.b(0, 14, 0, 10, 1, 10, C.roof);       // Turmplattform, Oberkante 15 (x,z -5..5)
  m.b4(4.2, 15, 4.2, 1.6, 1.8, 1.6, C.wall);   // Eckzinnen, Zugaenge bleiben frei

  // Boden -> Ebene 1 (endet exakt an der Kante z = 13)
  m.rampToS(0, 16.5, 7, 7, 0, 3, C.stone, 'z', true);
  // Ebene 1 -> Ebene 2: laeuft im Ring x 9..13 und stoesst bei x = 9 auf Ebene 2
  m.rampToS(11, 5, 4, 14, 3, 6, C.wall, 'z', true, 3);
  // Ebene 2 -> Turmplattform: seitlich am Turm vorbei, dann zwei Stege
  m.rampTo(0, 7.4, 3.6, 18, 6, 15, C.wall2, 'x', false, 6);
  m.b(11, 14.2, 6.4, 6, 0.8, 5.6, C.plank);
  m.b(6, 14.2, 2.5, 6, 0.8, 4, C.plank);
  m.rampTo(0, -7.4, 3.6, 18, 6, 15, C.wall2, 'x', true, 6);
  m.b(-11, 14.2, -6.4, 6, 0.8, 5.6, C.plank);
  m.b(-6, 14.2, -2.5, 6, 0.8, 4, C.plank);

  // ---------------- Team-Basen (Nord = Rot, Sued = Blau) ----------------
  m.buildingS(0, 0, 44, 30, 9, 20, C.wall, C.roof,
    { doors: { n: false, s: true, e: true, w: true }, doorW: 7, doorH: 6, thickness: 1.2 });
  // Aufgang westlich neben der Basis auf das Dach (Oberkante 9.8)
  m.rampToS(-17.5, 44, 5, 19, 0, 9.8, C.wall2, 'z', false);
  m.bs(0, 9.8, 34.4, 30, 1.3, 1.2, C.wall2);
  m.bs(15.4, 9.8, 44, 1.2, 1.3, 20, C.wall2);

  // ---------------- Bruecken auf Dachniveau (Oberkante 8.7) ----------------
  m.b(0, 8, 30, 60, 0.7, 5, C.plank);
  m.b(0, 8, -30, 60, 0.7, 5, C.plank);
  m.b(0, 8.7, 27.7, 60, 1.1, 0.4, C.plank, { noShadow: true });
  m.b(0, 8.7, -27.7, 60, 1.1, 0.4, C.plank, { noShadow: true });

  // ---------------- Seitenhaeuser an den Brueckenkoepfen ----------------
  // Daecher liegen mit 8.8 genau auf Brueckenniveau -> direkter Uebergang
  m.buildingS(-38, 0, 30, 16, 8, 16, C.wall2, C.roof,
    { doors: { n: true, s: true, e: true, w: false }, doorW: 5, doorH: 5 });
  m.buildingS(38, 0, 30, 16, 8, 16, C.wall, C.roof,
    { doors: { n: true, s: true, e: false, w: true }, doorW: 5, doorH: 5 });
  // Aufgaenge von Norden auf die Daecher
  m.rampToS(-38, 46, 5, 16, 0, 8.8, C.plank, 'z', true);
  m.rampToS(38, 46, 5, 16, 0, 8.8, C.plank, 'z', true);
  // Bruestungen an den Aussenkanten
  m.bs(-38, 8.8, 21.6, 16, 1.1, 1.2, C.wall2, { noShadow: true });
  m.bs(38, 8.8, 21.6, 16, 1.1, 1.2, C.wall, { noShadow: true });

  // ---------------- Deckung am Boden ----------------
  m.b4(20, 0, 14, 8, 5, 5, C.metal);
  m.b4(20, 5, 14, 6, 0.5, 4, C.dark);
  m.b4(10, 0, 34, 5, 3.2, 5, C.crate);
  m.b4(30, 0, 4, 4, 3.2, 4, C.crate);
  m.b4(11, 0, 22, 3, 3.2, 3, C.crate);
  m.b4(40, 0, 8, 10, 6, 10, C.wall2);            // Bunker (reine Deckung)
  m.b4(40, 6, 8, 12, 0.8, 12, C.roof);
  m.b4(52, 0, 20, 1.2, 7, 16, C.wall2);
  m.b4(50, 0, 44, 7, 7, 7, C.wall);
  m.b4(9, 0, 40, 10, 5, 1.2, C.wall2);
  m.bs(-9, 0, 34, 1.2, 5.5, 12, C.wall2);
  m.bs(9, 0, 38, 10, 5.5, 1.2, C.wall2);
  m.b4(6, 0, 48, 4, 3.4, 4, C.crate);
  // Farbakzente: Planen, Fassadenbaender, Tuerrahmen
  m.b4(22, 5.5, 14, 8.4, 0.35, 5.4, C.teal, { noShadow: true });
  m.b4(40, 6.8, 8, 12.4, 0.4, 12.4, C.teal, { noShadow: true });
  m.bs(0, 6.2, 34.3, 30, 0.6, 0.5, C.door, { noShadow: true, noCollide: true });
  m.bs(-38, 6.2, 21.9, 16, 0.6, 0.5, C.door, { noShadow: true, noCollide: true });
  m.bs(38, 6.2, 21.9, 16, 0.6, 0.5, C.cloth, { noShadow: true, noCollide: true });
  m.b(0, 3.05, 0, 26.4, 0.35, 26.4, C.dark, { noShadow: true, noCollide: true });
  m.b(0, 6.05, 0, 18.4, 0.35, 18.4, C.dark, { noShadow: true, noCollide: true });

  // Marktstaende (Deckung mit Durchsicht)
  for (let i = -1; i <= 1; i++) {
    const sx = i * 9 - 18;
    m.bs(sx, 0, -14, 6, 0.7, 4, C.plank);
    m.bs(sx, 3.4, -14, 6.6, 0.5, 5, C.cloth, { noShadow: true, noCollide: true });
    m.bs(sx - 2.7, 0.7, -14, 0.4, 2.7, 0.4, C.plank);
    m.bs(sx + 2.7, 0.7, -14, 0.4, 2.7, 0.4, C.plank);
  }

  // ---------------- Sprungpads ----------------
  m.padS(-52, -8, 26);
  m.pad(0, 25, 26); m.pad(0, -25, 26);

  // ---------------- Pickups ----------------
  m.pickupS(22, 2, 'ammo');
  m.pickupS(-30, 42, 'health');
  m.pickup(0, 22, 'armor'); m.pickup(0, -22, 'armor');
  m.pickup(0, 0, 'health', 15.6);

  // ---------------- Zerstoerbares, Modi, Laternen ----------------
  m.crateS(16, 0, 26, 2.4);
  m.crateS(-4, 0, 30, 2.2);
  m.crateS(26, 0, 30, 2.4); m.crateS(26, 2.4, 30, 2.0);
  m.barrelS(23, 0, 18); m.barrelS(24.5, 0, 18.2);
  m.barrelS(-44, 0, 4);
  m.glassS(-38, 3, 22.8, 5, 3, 'x');       // Fenster im Seitenhaus
  m.glassS(38, 3, 22.8, 5, 3, 'x');
  m.flagS(0, 42);
  m.hardpoint(0, 0); m.hardpoint(20, 14); m.hardpoint(-20, -14); m.hardpoint(-38, 30); m.hardpoint(38, -30);
  m.bombsite('A', 0, 0); m.bombsite('B', 40, 8);
  m.lampS(14, 36); m.lampS(-14, 36); m.lampS(44, 0); m.lampS(0, 12); m.lampS(-26, -10);
  // Seilbahn vom Seitenhausdach zum Bunkerdach
  m.ziplineS(-38, 13.2, 30, -40, 11.2, 4);

  // ---------------- Spawns ----------------
  m.spawnS(0, 47);
  m.spawnS(-9, 48);
  m.spawnS(9, 48);
  m.spawnS(-11, 42);
  m.spawnS(11, 42);
  m.spawnS(-31, 40);
  m.spawnS(31, 40);
  m.spawnS(-50, 48);
  m.spawnS(50, 48);
  m.spawn(-52, 0, null); m.spawn(52, 0, null);
  m.spawn(-30, -14, null); m.spawn(30, 14, null);
  return m;
}

// ============================================================
// BURG — Wehrgaenge, Ecktuerme, Bergfried im Hof
// ============================================================
function buildBurg() {
  const m = new MapBuilder({
    id: 'burg',
    name: 'BURG',
    skyTop: 0x3c5f8f, skyBottom: 0xb9c8d8,
    fogColor: 0x9fb0c2, fogNear: 65, fogFar: 210,
    sunDir: [-0.42, 0.76, 0.5], sunColor: 0xe6eeff, sunIntensity: 1.25,
    ambTop: 0x9ab6dd, ambBottom: 0x5a6156, ambIntensity: 0.7,
  });

  const C = {
    ground: 0x74805f, stone: 0xa5a59c, stone2: 0x8d8d85, dark: 0x64645f,
    roof: 0x8a4141, wood: 0x7a5533, banner: 0x963232, bannerB: 0x32528c,
    water: 0x35708c,
  };
  m.surfaces = { [C.ground]: 'dirt', [C.wood]: 'wood', [C.roof]: 'wood' };

  m.arena(112, C.ground, C.stone2, 40);

  const R = 42;          // Mauerring
  const WALK = 11;       // Oberkante Wehrgang
  const TOWER = 16;      // Oberkante Ecktuerme
  const GATE = 9;        // lichte Torbreite

  // ---------------- Burgmauer mit vier Toren ----------------
  // Je Seite zwei Mauerstuecke links und rechts des Tors.
  const inner = GATE / 2;
  const outer = R + 1.5;                  // bis zur Ecke
  const segLen = outer - inner;
  const segMid = (inner + outer) / 2;
  for (const s of [1, -1]) {
    m.b(s * segMid, 0, R, segLen, 12, 3, C.stone);
    m.b(s * segMid, 0, -R, segLen, 12, 3, C.stone);
    m.b(R, 0, s * segMid, 3, 12, segLen, C.stone);
    m.b(-R, 0, s * segMid, 3, 12, segLen, C.stone);
  }
  // Torbogen (Durchgangshoehe 7)
  m.b(0, 7, R, GATE, 5, 3, C.stone);
  m.b(0, 7, -R, GATE, 5, 3, C.stone);
  m.b(R, 7, 0, 3, 5, GATE, C.stone);
  m.b(-R, 7, 0, 3, 5, GATE, C.stone);

  // Wehrgang innen, Oberkante 11 (durchgehend, auch ueber den Toren)
  m.bx(R - 3.5, 10.2, 0, 4, 0.8, 2 * R, C.stone2);
  m.b(0, 10.2, R - 3.5, 2 * R, 0.8, 4, C.stone2);
  m.b(0, 10.2, -(R - 3.5), 2 * R, 0.8, 4, C.stone2);

  // Zinnen
  for (let i = -R + 3; i <= R - 3; i += 6) {
    m.bx(R, 12, i, 3, 2.4, 2.6, C.stone);
    m.b(i, 12, R, 2.6, 2.4, 3, C.stone);
    m.b(i, 12, -R, 2.6, 2.4, 3, C.stone);
  }

  // ---------------- Ecktuerme (Plattform Oberkante 16) ----------------
  m.b4(R, 0, R, 12, TOWER - 1, 12, C.stone);
  m.b4(R, TOWER - 1, R, 14, 1, 14, C.stone2);
  m.b4(R, TOWER, R + 5.8, 14, 2.2, 2.4, C.stone);
  m.b4(R + 5.8, TOWER, R, 2.4, 2.2, 14, C.stone);
  // Wehrgang (11) -> Turmplattform (16)
  m.rampToS(R - 3.5, 31, 4, 10, WALK, TOWER, C.wood, 'z', false, WALK - 0.8);
  m.rampToS(-(R - 3.5), 31, 4, 10, WALK, TOWER, C.wood, 'z', false, WALK - 0.8);

  // ---------------- Aufgaenge auf die Mauer (frei stehend) ----------------
  m.rampToS(-28, 33, 6, 21, 0, WALK, C.stone2, 'x', true);
  m.rampToS(33, 20, 5, 21, 0, WALK, C.stone2, 'z', true);
  m.bs(35.5, 10.2, 8.5, 8, 0.8, 5, C.stone2);      // Podest zum Wehrgang

  // ---------------- Bergfried ----------------
  m.building(0, 0, 0, 24, 10, 24, C.stone, C.stone2,
    { doors: { n: true, s: true, e: true, w: true }, doorW: 6, doorH: 6, thickness: 1.4 });
  m.b(0, 10.8, 0, 26, 1.4, 26, C.stone2);          // Dachplatte, Oberkante 12.2
  for (let i = -12; i <= 12; i += 4) {
    if (Math.abs(i) > 5) {                          // Zugaenge bei z = +/-13 frei lassen
      m.b(i, 12.2, 13, 2.6, 2.2, 1.6, C.stone);
      m.b(i, 12.2, -13, 2.6, 2.2, 1.6, C.stone);
    }
    m.b(13, 12.2, i, 1.6, 2.2, 2.6, C.stone);
    m.b(-13, 12.2, i, 1.6, 2.2, 2.6, C.stone);
  }
  m.b(0, 12.2, 0, 9, 8, 9, C.stone);               // innerer Turm (Deko)
  m.b(0, 20.2, 0, 11, 1, 11, C.roof);
  m.b(0, 21.2, 0, 7, 4.5, 7, C.roof);
  // Freitreppen vom Hof auf das Bergfrieddach
  m.rampTo(0, 24.5, 6, 23, 0, 12.2, C.wood, 'z', true);
  m.rampTo(0, -24.5, 6, 23, 0, 12.2, C.wood, 'z', false);

  // ---------------- Nebengebaeude im Hof ----------------
  m.buildingS(-24, 0, 20, 14, 7, 12, C.stone2, C.roof,
    { doors: { n: true, s: false, e: true, w: false }, doorW: 5 });
  m.rampToS(-24, 6.5, 5, 15, 0, 7.8, C.wood, 'z', false);
  m.buildingS(24, 0, 16, 12, 6, 12, C.wood, C.roof,
    { doors: { n: false, s: true, e: false, w: true }, doorW: 5 });
  m.rampToS(24, 28.5, 4, 13, 0, 6.8, C.wood, 'z', true);

  // ---------------- Deckung ----------------
  m.b4(15, 0, 32, 4, 3.4, 4, C.wood);
  m.b4(30, 0, 4, 3.6, 4.2, 3.6, C.wood);
  m.b4(10, 0, 30, 10, 4, 1.4, C.stone2);
  m.b4(34, 0, 34, 6, 5, 6, C.stone2);
  m.bs(-14, 0, -6, 1.4, 5, 16, C.stone2);
  m.bs(14, 0, 6, 16, 5, 1.4, C.stone2);
  m.b4(20, 0, 8, 3, 3, 3, C.wood);
  m.b4(50, 0, 20, 5, 5, 5, C.stone2);              // Deckung ausserhalb der Mauer
  m.b4(48, 0, 46, 6, 4, 6, C.wood);

  // Brunnen
  m.bs(-18, 0, -18, 6, 2.2, 6, C.stone);
  m.bs(-18, 2.2, -18, 4.4, 0.2, 4.4, C.water, { emissive: 0.2, noShadow: true });

  // Banner
  m.b(0, 6, 35.4, 4, 8, 0.3, C.banner, { noShadow: true, noCollide: true });
  m.b(0, 6, -35.4, 4, 8, 0.3, C.bannerB, { noShadow: true, noCollide: true });

  m.padS(-34, 4, 26);
  m.pickupS(-16, 30, 'ammo');
  m.pickupS(24, 26, 'health');
  m.pickup(0, 0, 'armor', 12.9);
  m.pickup(9, 24, 'health'); m.pickup(-9, -24, 'health');

  // Zerstoerbares, Modi, Laternen
  m.crateS(8, 0, 18, 2.4); m.crateS(10.6, 0, 18, 2.0);
  m.crateS(-30, 0, 8, 2.4);
  m.barrelS(20, 0, 30); m.barrelS(21.5, 0, 30.4);
  m.barrelS(-6, 0, -8);
  m.glassS(-24, 2.5, 14.3, 4, 2.6, 'x');   // Fenster Nebengebaeude
  m.flagS(0, 33);
  m.hardpoint(0, 0); m.hardpoint(24, 16); m.hardpoint(-24, -16); m.hardpoint(0, 30); m.hardpoint(-34, 30);
  m.bombsite('A', 0, 0); m.bombsite('B', -24, 20);
  m.lampS(12, 30); m.lampS(-12, 30); m.lampS(30, 0); m.lampS(-18, -6);
  // Seilbahn vom Ecktturm auf das Bergfrieddach
  m.ziplineS(38, 20.4, 38, 8, 16.4, 8);

  m.spawnS(0, 37);
  m.spawnS(-10, 36);
  m.spawnS(10, 36);
  m.spawnS(-24, 33);
  m.spawnS(24, 33);
  m.spawnS(-36, 24);
  m.spawnS(36, 24);
  m.spawn(-50, -6, null); m.spawn(50, 6, null);
  m.spawn(-6, -50, null); m.spawn(6, 50, null);
  return m;
}

// ============================================================
// CITADEL — Industrieanlage: Reaktor, Laufstege, Container
// ============================================================
function buildCitadel() {
  const m = new MapBuilder({
    id: 'citadel',
    name: 'CITADEL',
    skyTop: 0x0c1728, skyBottom: 0x33506f,
    fogColor: 0x22334a, fogNear: 55, fogFar: 190,
    sunDir: [0.32, 0.82, -0.42], sunColor: 0xcfe0ff, sunIntensity: 1.15,
    ambTop: 0x5a86bd, ambBottom: 0x161f2c, ambIntensity: 0.85,
  });

  const C = {
    ground: 0x323c4c, deck: 0x414d64, metal: 0x525e76, dark: 0x272f3d,
    accent: 0x00c8ff, accent2: 0xff4d6d, panel: 0x5d6b85, grate: 0x384356,
    glow: 0x2ee6a8, orange: 0xe08a2a,
  };
  m.surfaces = {
    [C.deck]: 'metal', [C.metal]: 'metal', [C.dark]: 'metal', [C.panel]: 'metal',
    [C.grate]: 'grate', [C.accent2]: 'metal', [C.orange]: 'metal',
  };

  m.arena(112, C.ground, C.dark, 40);

  // ---------------- Reaktor ----------------
  m.b(0, 0, 0, 22, 4, 22, C.deck);           // Sockel,  Oberkante 4  (x,z -11..11)
  m.b(0, 4, 0, 16, 4, 16, C.metal);          // Podest,  Oberkante 8  (x,z  -8..8)
  m.b(0, 8, 0, 6, 12, 6, C.dark);            // Kern
  m.b(0, 8, 0, 6.6, 12, 1.4, C.accent, { emissive: 0.9, noShadow: true, noCollide: true });
  m.b(0, 8, 0, 1.4, 12, 6.6, C.accent, { emissive: 0.9, noShadow: true, noCollide: true });
  m.b(0, 20, 0, 12, 1, 12, C.panel);         // Reaktordach, Oberkante 21 (x,z -6..6)
  m.b4(5, 21, 5, 1.6, 1.6, 1.6, C.metal);

  m.rampToS(0, 15, 6, 8, 0, 4, C.deck, 'z', true);
  m.rampToS(9.5, 4, 3, 7.2, 4, 8, C.metal, 'z', true, 4);

  // ---------------- Laufsteg-Ring auf 14.6 ----------------
  m.bx(36, 14, 0, 6, 0.6, 56, C.grate);
  m.b(0, 14, 36, 56, 0.6, 6, C.grate);
  m.b(0, 14, -36, 56, 0.6, 6, C.grate);
  m.bx(24, 14, 0, 18, 0.6, 5, C.grate);
  m.b(0, 14, 24, 5, 0.6, 18, C.grate);
  m.b(0, 14, -24, 5, 0.6, 18, C.grate);
  // Gelaender - mit Durchlaessen dort, wo Arme und Aufgaenge einmuenden
  const rail = (x, z, w, d) => m.b(x, 14.6, z, w, 1.4, d, C.panel, { noShadow: true });
  for (const sg of [1, -1]) {
    rail(33.2, sg * 16, 0.3, 24);       // innen, Luecke bei |z| < 4
    rail(-33.2, sg * 16, 0.3, 24);
    rail(sg * 16, 33.2, 24, 0.3);       // innen, Luecke bei |x| < 4
    rail(sg * 16, -33.2, 24, 0.3);
  }
  rail(-38.8, -3, 0.3, 50);             // aussen, Luecke fuer das Aufgangspodest
  rail(38.8, 3, 0.3, 50);
  rail(0, 38.8, 56, 0.3);
  rail(0, -38.8, 56, 0.3);

  // ---------------- Ecktuerme (Deck 15) ----------------
  m.b4(36, 0, 36, 16, 14, 16, C.metal);
  m.b4(36, 14, 36, 18, 1, 18, C.deck);
  m.b4(36, 15, 44.2, 18, 1.4, 1.6, C.panel);
  m.b4(44.2, 15, 36, 1.6, 1.4, 18, C.panel);

  // ---------------- Aufgaenge ----------------
  // Boden -> Ring: laeuft AUSSERHALB des Rings und muendet ueber ein Podest ein
  m.rampToS(-47, 12, 6, 27, 0, 14.6, C.metal, 'z', false);
  m.bs(-42, 14, 27, 14, 0.6, 6, C.grate);
  m.bs(-39, 14.6, 24.2, 8, 1.4, 0.3, C.panel, { noShadow: true });
  // Ring -> Reaktordach
  m.rampToS(13, 0, 5, 14, 14.6, 21, C.metal, 'x', true, 14);
  m.padS(-18, 36, 34, C.glow);
  m.padS(18, -36, 34, C.glow);

  // ---------------- Container-Labyrinth ----------------
  m.b4(20, 0, 14, 10, 5, 5, C.accent2);
  m.b4(20, 5, 14, 8, 0.6, 4, C.dark);
  m.b4(12, 0, 26, 5, 5, 10, C.accent);
  m.b4(30, 0, 10, 5, 6, 5, C.panel);
  m.b4(8, 0, 42, 12, 4, 5, C.metal);
  m.b4(46, 0, 42, 6, 7, 6, C.orange);
  m.b4(16, 0, 48, 5, 5, 5, C.panel);
  m.bs(-26, 0, 4, 1.2, 6, 20, C.dark);
  m.bs(26, 0, -4, 1.2, 6, 20, C.dark);

  // Leuchtstreifen (rein optisch)
  m.bx(41, 0.02, 0, 0.6, 0.06, 100, C.accent, { emissive: 0.9, noShadow: true, noCollide: true });
  m.b(0, 0.02, 41, 100, 0.06, 0.6, C.accent, { emissive: 0.9, noShadow: true, noCollide: true });
  m.b(0, 0.02, -41, 100, 0.06, 0.6, C.accent, { emissive: 0.9, noShadow: true, noCollide: true });

  m.pickupS(20, 22, 'ammo');
  m.pickupS(-32, 32, 'health');
  m.pickup(0, 0, 'armor', 21.6);
  m.pickup(0, 30, 'health'); m.pickup(0, -30, 'health');

  // Zerstoerbares, Modi, Laternen
  m.crateS(14, 0, 36, 2.4); m.crateS(14, 2.4, 36, 2.0);
  m.crateS(-6, 0, 20, 2.2);
  m.barrelS(28, 0, 20); m.barrelS(29.6, 0, 20.3); m.barrelS(28.8, 0, 21.7);
  m.barrelS(-40, 0, 6);
  m.flagS(0, 42);
  m.hardpoint(0, 0); m.hardpoint(20, 14); m.hardpoint(-20, -14); m.hardpoint(36, 36); m.hardpoint(-36, -36);
  m.bombsite('A', 0, 0); m.bombsite('B', 30, 10);
  m.lampS(10, 40); m.lampS(-10, 40); m.lampS(30, 4); m.lampS(0, 18);
  // Seilbahnen: vom Eckturm-Deck zum Reaktordach und vom Ring zum Boden
  m.ziplineS(30, 19.5, 30, 6, 25.2, 6);
  m.ziplineS(-30, 19, 0, -46, 4.6, -24);

  m.spawnS(0, 48);
  m.spawnS(-12, 48);
  m.spawnS(12, 48);
  m.spawnS(-30, 45);
  m.spawnS(30, 45);
  m.spawnS(-40, 30);
  m.spawnS(40, 30);
  m.spawn(-52, 4, null); m.spawn(52, -4, null);
  return m;
}

// ============================================================
// HAFEN — Containerhafen: Kraene, Containerstapel, Lagerhalle,
// Pier ueber dem Wasser, Tanklager mit Faessern
// ============================================================
function buildHafen() {
  const m = new MapBuilder({
    id: 'hafen',
    name: 'HAFEN',
    skyTop: 0x2e6fb0, skyBottom: 0xd8e4ec,
    fogColor: 0xb9c8d4, fogNear: 70, fogFar: 230,
    sunDir: [-0.35, 0.7, 0.55], sunColor: 0xfff0dc, sunIntensity: 1.35,
    ambTop: 0x9fc0e6, ambBottom: 0x5a5e60, ambIntensity: 0.68,
  });
  const C = {
    concrete: 0x8c8f92, concrete2: 0x7a7d80, asphalt: 0x4a4d52, water: 0x2a5f7a, waterFloor: 0x1d3a48,
    pier: 0x8a6a44, plank: 0x6e5236, crane: 0xd9a020, craneDark: 0x8a6414, steel: 0x6a7280,
    dark: 0x2e3238, hall: 0xb8b4aa, hallRoof: 0x6a6e74, cRed: 0xa8402a, cBlue: 0x2a5a9a,
    cGreen: 0x3a7a4a, cYellow: 0xc9a020, cWhite: 0xd8d8d2, rust: 0x7a4a2a, stripe: 0xffcc00, glow: 0x2ee6ff,
  };
  m.surfaces = {
    [C.concrete]: 'stone', [C.concrete2]: 'stone', [C.asphalt]: 'stone', [C.waterFloor]: 'water',
    [C.pier]: 'wood', [C.plank]: 'wood', [C.crane]: 'metal', [C.craneDark]: 'metal', [C.steel]: 'metal',
    [C.dark]: 'metal', [C.hallRoof]: 'metal', [C.cRed]: 'metal', [C.cBlue]: 'metal', [C.cGreen]: 'metal',
    [C.cYellow]: 'metal', [C.cWhite]: 'metal', [C.rust]: 'metal',
  };

  m.arena(116, C.concrete, C.concrete2, 30);

  // ---------------- Hafenbecken (Osten und Westen, punktsymmetrisch) ----------------
  // Wasser liegt 2.4 tiefer; Kaimauer als Kante, Pier aus Planken darueber
  for (const s of [1, -1]) {
    m.b(s * 46, -3, s * 10, 22, 0.6, 60, C.waterFloor);                 // Beckenboden (Oberkante -2.4)
    m.b(s * 46, -2.4, s * 10, 22, 0.4, 60, C.water, { emissive: 0.12, noShadow: true, noCollide: true });
    m.b(s * 35.2, -3, s * 10, 0.8, 3, 60, C.concrete2);                  // Kaimauer
    // Pier ueber dem Wasser
    m.b(s * 44, -0.3, s * 4, 16, 0.5, 6, C.pier);
    m.b(s * 44, -0.3, s * 20, 6, 0.5, 26, C.pier);
    for (let i = -2; i <= 2; i++) m.b(s * (38 + i * 3.2), -3, s * 4, 0.5, 2.7, 0.5, C.plank);
    m.b(s * 51, 0.2, s * 4, 0.3, 1.0, 6, C.plank, { noShadow: true });   // Gelaender
    m.b(s * 44, 0.2, s * 1, 16, 1.0, 0.3, C.plank, { noShadow: true });
    // Poller
    m.b(s * 34, 0, s * 2, 0.8, 0.8, 0.8, C.dark);
    m.b(s * 34, 0, s * 18, 0.8, 0.8, 0.8, C.dark);
  }

  // ---------------- Grosse Portalkraene (Nord und Sued) ----------------
  m.b4(14, 0, 36, 2.2, 20, 2.2, C.crane);                                // Beine (alle vier Quadranten)
  for (const s of [1, -1]) {
    const cz = s * 36;
    m.b(0, 20, cz, 32, 2.2, 3, C.crane);                                 // Traeger
    m.b(0, 22.2, cz, 32, 0.4, 3.4, C.craneDark);
    m.b(0, 18.8, cz, 30, 1.2, 0.5, C.stripe, { emissive: 0.3, noShadow: true, noCollide: true });
    m.b(s * 10, 22.6, cz, 4, 3, 3.6, C.craneDark);                       // Kabine
    m.b(s * 10, 23.4, cz - s * 1.9, 3.2, 1.4, 0.15, C.glow, { emissive: 0.6, noShadow: true, noCollide: true });
    m.b(0, 12, cz, 0.5, 8, 0.5, C.steel);                                // Seil
    m.b(0, 10, cz, 6, 2.6, 2.6, C.cYellow);                              // haengender Container
    // Querstreben
    m.b(0, 6, cz, 30, 0.5, 0.5, C.craneDark);
    m.b(0, 12, cz, 30, 0.5, 0.5, C.craneDark);
  }
  // Aufgaenge: Containerstapel -> Sprungpad auf den Kran
  m.padS(-19, 30, 42, C.glow);

  // ---------------- Lagerhalle in der Mitte ----------------
  m.building(0, 0, 0, 30, 10, 20, C.hall, C.hallRoof,
    { doors: { n: true, s: true, e: true, w: true }, doorW: 7, doorH: 6, thickness: 1.2 });
  m.b(0, 10.8, 0, 32, 0.6, 22, C.hallRoof);
  m.b(0, 11.4, 0, 8, 2.2, 6, C.dark);                                    // Dachaufbau
  m.b(0, 5.5, 0, 6, 0.3, 6, C.steel);                                    // Zwischenboden
  m.rampTo(-10, 0, 4, 12, 0, 5.8, C.steel, 'z', true, 0);
  m.rampTo(10, 0, 4, 12, 0, 5.8, C.steel, 'z', false, 0);
  m.b(0, 5.5, 0, 24, 0.3, 4, C.steel);                                   // Laufsteg quer
  // Fenster in den Laengswaenden
  m.glassS(-9, 5.5, 9.4, 6, 3, 'x'); m.glassS(9, 5.5, 9.4, 6, 3, 'x');
  m.glassS(-9, 5.5, -9.4, 6, 3, 'x'); m.glassS(9, 5.5, -9.4, 6, 3, 'x');
  // Aufgang aufs Hallendach
  m.rampToS(-19, 0, 5, 20, 0, 11.4, C.steel, 'z', false);
  m.bs(-19, 11.4, -3, 5, 1.0, 0.4, C.steel, { noShadow: true });

  // ---------------- Containerstapel ----------------
  const cont = (x, y, z, col, rot) => rot ? m.b(x, y, z, 2.6, 2.6, 6.2, col) : m.b(x, y, z, 6.2, 2.6, 2.6, col);
  const contS = (x, y, z, col, rot) => { cont(x, y, z, col, rot); cont(-x, y, -z, col, rot); };
  contS(-22, 0, 30, C.cRed); contS(-22, 2.6, 30, C.cBlue); contS(-22, 5.2, 30, C.cGreen);
  contS(-15, 0, 30, C.cWhite); contS(-15, 2.6, 30, C.rust);
  contS(-22, 0, 33.2, C.cYellow); contS(-22, 2.6, 33.2, C.cRed);
  contS(-8, 0, 30, C.cBlue, true); contS(-8, 2.6, 30, C.cGreen, true);
  contS(22, 0, 18, C.cGreen, true); contS(22, 2.6, 18, C.cWhite, true);
  contS(24.8, 0, 18, C.cRed, true);
  contS(14, 0, 16, C.cYellow); contS(14, 2.6, 16, C.cBlue);
  contS(-28, 0, 12, C.rust); contS(-28, 2.6, 12, C.cYellow);
  contS(-30, 0, -4, C.cWhite, true);
  contS(30, 0, 40, C.cBlue); contS(30, 2.6, 40, C.cRed);
  contS(6, 0, 44, C.cGreen); contS(12.5, 0, 44, C.rust);
  // Treppen auf Stapel
  m.rampToS(-15, 36.5, 4, 9, 0, 5.2, C.steel, 'z', true);
  m.rampToS(14, 21.4, 4, 8, 0, 5.2, C.steel, 'z', true);

  // ---------------- Tanklager mit Faessern (explosiv) ----------------
  m.bs(-30, 0, -26, 8, 5, 8, C.cWhite);
  m.bs(-30, 5, -26, 8.6, 0.6, 8.6, C.steel);
  m.bs(-30, 0, -26, 8.4, 1.2, 8.4, C.stripe, { noShadow: true, noCollide: true });
  m.barrelS(-25, 0, -30); m.barrelS(-23.6, 0, -30.4); m.barrelS(-24.3, 0, -28.9);
  m.barrelS(-36, 0, -20); m.barrelS(-34.6, 0, -19.6);
  m.barrelS(4, 0, 14); m.barrelS(5.5, 0, 14.4);
  // Kisten
  m.crateS(-6, 0, 22, 2.4); m.crateS(-3.5, 0, 22, 2.2); m.crateS(-6, 2.4, 22, 2.0);
  m.crateS(26, 0, 6, 2.4); m.crateS(28.5, 0, 6, 2.4);
  m.crateS(0, 0, 14, 2.2);
  m.crateS(20, 0, -8, 2.4); m.crateS(20, 2.4, -8, 2.0);

  // ---------------- Deckung / Deko ----------------
  m.b4(38, 0, 26, 3, 3.5, 3, C.dark);                                    // Stromkaesten
  m.bs(0, 0, 24, 12, 1.2, 1.2, C.concrete2);                             // Betonbarriere
  m.bs(-12, 0, 8, 1.2, 1.2, 10, C.concrete2);
  m.bx(50, 0, 40, 4, 12, 4, C.hall);                                     // Leuchtturm-artige Tuerme
  m.bx(50, 12, 40, 4.6, 0.5, 4.6, C.hallRoof);
  m.bx(50, 12.5, 40, 2, 2, 2, C.glow, { emissive: 0.9, noShadow: true });
  m.bx(50, 0, -40, 4, 12, 4, C.hall);
  m.bx(50, 12, -40, 4.6, 0.5, 4.6, C.hallRoof);
  // Fahrbahnmarkierungen
  m.b(0, 0.01, 0, 0.3, 0.04, 100, C.stripe, { emissive: 0.3, noShadow: true, noCollide: true });
  m.b(0, 0.01, 0, 100, 0.04, 0.3, C.stripe, { emissive: 0.3, noShadow: true, noCollide: true });

  // ---------------- Pickups, Pads, Modi ----------------
  m.pickupS(-15, 30, 'ammo', 8.4);
  m.pickupS(26, 2, 'health');
  m.pickup(0, 0, 'armor', 6.8);
  m.pickup(0, 0, 'health', 12.6);
  m.pickup(44, 4, 'ammo', 1.0); m.pickup(-44, -4, 'ammo', 1.0);
  m.padS(36, -8, 24);
  m.flagS(0, 46);
  m.hardpoint(0, 0); m.hardpoint(-22, 26); m.hardpoint(22, -26); m.hardpoint(40, 8); m.hardpoint(-40, -8);
  m.bombsite('A', -22, 30); m.bombsite('B', 22, -18);
  m.lampS(8, 44); m.lampS(-26, 20); m.lampS(30, 12); m.lampS(0, 26); m.lampS(38, 30);
  // Seilbahnen: vom Krantraeger aufs Hallendach und vom Containerstapel zum Pier
  m.ziplineS(-6, 25.4, 34, -3, 15.4, 4);
  m.ziplineS(-22, 10.6, 27, -40, 4.2, 6);

  // ---------------- Spawns ----------------
  m.spawnS(0, 50);
  m.spawnS(-8, 52);
  m.spawnS(8, 52);
  m.spawnS(-30, 48);
  m.spawnS(26, 48);
  m.spawnS(-44, 30);
  m.spawnS(40, 46);
  m.spawn(-50, 0, null); m.spawn(50, 0, null);
  m.spawn(-20, -12, null); m.spawn(20, 12, null);
  return m;
}

// ============================================================
// DSCHUNGEL — Fluss mit Wasserfall, Haengebruecken, Tempelruinen,
// Baeume als Deckung, Klippenplateau im Westen
// ============================================================
function buildDschungel() {
  const m = new MapBuilder({
    id: 'dschungel',
    name: 'DSCHUNGEL',
    skyTop: 0x2c6aa8, skyBottom: 0xcfe3c9,
    fogColor: 0x9fc09a, fogNear: 60, fogFar: 210,
    sunDir: [0.3, 0.78, 0.55], sunColor: 0xfff6dc, sunIntensity: 1.3,
    ambTop: 0x8fc0a0, ambBottom: 0x3a5a30, ambIntensity: 0.75,
  });
  const C = {
    ground: 0x4d6b35, mud: 0x5a4a32, stone: 0x7c8172, stone2: 0x656a5c, moss: 0x3f6b3a,
    trunk: 0x5a3d24, leaves: 0x2f7a35, leaves2: 0x3d9440, plank: 0x8a6a44, rope: 0x9a8262,
    temple: 0x8f8a74, temple2: 0x7a7560, gold: 0xd8ad2a, glow: 0x2ee6a8, water: 0x3a8fb0, waterFloor: 0x1d4a5a,
    fall: 0xbfe6ff, cliff: 0x6b6f66,
  };
  m.surfaces = {
    [C.ground]: 'dirt', [C.mud]: 'dirt', [C.moss]: 'dirt', [C.waterFloor]: 'water',
    [C.trunk]: 'wood', [C.leaves]: 'wood', [C.leaves2]: 'wood', [C.plank]: 'wood', [C.rope]: 'wood',
    [C.stone]: 'stone', [C.stone2]: 'stone', [C.temple]: 'stone', [C.temple2]: 'stone', [C.cliff]: 'stone',
  };

  // ---------------- Boden mit Flusslauf (z = -5..5), Aussenwaende ----------------
  const S = 116, s = S / 2;
  m.b(0, -3, 33, S + 30, 3, 56, C.ground);
  m.b(0, -3, -33, S + 30, 3, 56, C.ground);
  m.b(0, -3.2, 0, S + 30, 1.6, 10, C.waterFloor);                                    // Flussbett, Oberkante -1.6
  m.b(0, -1.5, 0, S + 30, 0.5, 10, C.water, { alpha: 0.55, noCollide: true, noShadow: true, emissive: 0.15 });
  m.b(0, 0, s + 2, S + 12, 30, 4, C.cliff);
  m.b(0, 0, -s - 2, S + 12, 30, 4, C.cliff);
  m.b(s + 2, 0, 0, 4, 30, S + 12, C.cliff);
  m.b(-s - 2, 0, 0, 4, 30, S + 12, C.cliff);
  m.bounds = { min: -s, max: s };
  m.size = S;
  // Ufer (leicht erhoehte Kanten)
  m.b(0, -0.4, 5.8, S + 30, 0.5, 1.6, C.mud);
  m.b(0, -0.4, -5.8, S + 30, 0.5, 1.6, C.mud);

  // ---------------- Wasserfall-Plateau im Osten ----------------
  m.b(50, 0, 0, 16, 12, 30, C.cliff);                                                // Plateau, Oberkante 12
  m.b(50, 12, 0, 12, 0.3, 10, C.water, { alpha: 0.5, noCollide: true, noShadow: true, emissive: 0.1 });   // Pool
  m.b(41.6, -1.6, 0, 1.4, 13.8, 8, C.fall, { alpha: 0.45, noCollide: true, noShadow: true, emissive: 0.35 });  // Wasserfall
  m.b(41.0, -1.4, 0, 3, 0.8, 9, C.fall, { alpha: 0.35, noCollide: true, noShadow: true, emissive: 0.25 });     // Gischt
  m.rampTo(50, 22, 6, 18, 0, 12, C.stone2, 'z', true);                              // Aufgang von Norden
  m.rampTo(50, -22, 6, 18, 0, 12, C.stone2, 'z', false);                            // und von Sueden
  m.b4(46, 12, 14, 1.4, 2.4, 1.4, C.stone);                                          // Eckpfeiler
  m.b(56, 12, 0, 1.2, 1.6, 30, C.stone2, { noShadow: true });

  // ---------------- Klippenplateau im Westen (Oberkante 8) ----------------
  m.b(-50, 0, 0, 16, 8, 44, C.cliff);
  m.rampTo(-50, 30, 6, 16, 0, 8, C.stone2, 'z', true);
  m.rampTo(-50, -30, 6, 16, 0, 8, C.stone2, 'z', false);
  m.bs(-46, 8, 12, 4, 3, 4, C.stone);
  m.b(-43, 8, 0, 1.2, 1.4, 44, C.stone2, { noShadow: true });

  // ---------------- Bruecken ueber den Fluss ----------------
  m.b(0, -0.4, 0, 9, 0.8, 13, C.temple);                                             // Steinbruecke Mitte
  m.b(0, 0.4, 0, 9, 0.6, 13, C.temple2, { noCollide: true, noShadow: true });
  m.bx(5.2, 0.4, 0, 0.6, 1.1, 13, C.temple, { noShadow: true });
  for (const x of [-30, 30]) {                                                       // Haengebruecken
    m.b(x, -0.3, 0, 3.2, 0.4, 13, C.plank);
    m.b(x, -0.1, 0, 3.4, 0.1, 13, C.plank, { noCollide: true, noShadow: true });
    m.b(x - 1.7, 0.1, 0, 0.16, 1.2, 13, C.rope, { noCollide: true, noShadow: true });
    m.b(x + 1.7, 0.1, 0, 0.16, 1.2, 13, C.rope, { noCollide: true, noShadow: true });
    m.b4(Math.abs(x) + 1.7, 0, 6.8, 0.5, 2.6, 0.5, C.trunk);
  }

  // ---------------- Tempelruinen (Nord und Sued, punktsymmetrisch) ----------------
  m.bs(0, 0, 28, 22, 3, 22, C.temple);
  m.bs(0, 3, 28, 15, 3, 15, C.temple2);
  m.bs(0, 6, 28, 8, 3, 8, C.temple);
  m.bs(0, 9, 28, 4, 2.5, 4, C.gold, { emissive: 0.2 });
  m.rampToS(0, 15.5, 6, 6, 0, 3, C.temple, 'z', true);
  m.rampToS(0, 22, 4, 5, 3, 6, C.temple2, 'z', true, 3);
  m.rampToS(-12, 28, 4, 8, 0, 3, C.temple, 'x', false);
  // Saeulen und Mauerreste
  m.b4(14, 0, 22, 1.8, 7, 1.8, C.stone);
  m.b4(14, 0, 34, 1.8, 5, 1.8, C.stone);
  m.bs(-18, 0, 40, 12, 4.5, 1.6, C.stone2);
  m.bs(18, 0, 44, 1.6, 4, 10, C.stone2);
  m.bs(-24, 0, 16, 6, 2.6, 1.6, C.moss);
  m.bs(20, 0, 12, 1.6, 3, 8, C.moss);
  // Zerstoerbares
  m.crateS(8, 0, 44, 2.4); m.crateS(10.5, 0, 44, 2.2);
  m.crateS(-6, 0, 12, 2.2);
  m.barrelS(-14, 0, 46); m.barrelS(-12.6, 0, 46.4);
  m.barrelS(22, 0, 24);

  // ---------------- Baeume ----------------
  const tree = (x, z, h, big) => {
    m.b(x, 0, z, big ? 1.8 : 1.3, h, big ? 1.8 : 1.3, C.trunk);
    m.b(x, h, z, big ? 9 : 6.5, 3, big ? 9 : 6.5, C.leaves);
    m.b(x, h + 3, z, big ? 6 : 4.2, 2.6, big ? 6 : 4.2, C.leaves2);
    m.b(x, h + 5.6, z, big ? 3 : 2.2, 1.6, big ? 3 : 2.2, C.leaves);
  };
  const treeS = (x, z, h, big) => { tree(x, z, h, big); tree(-x, -z, h, big); };
  treeS(-30, 22, 7, true); treeS(-16, 34, 6, false); treeS(26, 36, 8, true); treeS(34, 14, 6, false);
  treeS(-8, 48, 6, false); treeS(12, 10, 5, false); treeS(-38, 44, 7, false); treeS(40, 44, 6, false);
  treeS(30, -12, 6, false);

  // ---------------- Pickups, Pads, Modi ----------------
  m.pickupS(-30, 22, 'health');
  m.pickupS(26, 16, 'ammo');
  m.pickup(0, 28, 'armor', 12.6); m.pickup(0, -28, 'armor', 12.6);
  m.pickup(50, 0, 'health', 13.4);
  m.pickup(-50, 0, 'ammo', 9.2);
  m.padS(-40, 26, 26, C.glow);
  m.padS(36, -8, 24, C.glow);
  m.flagS(0, 46);
  m.hardpoint(0, 0); m.hardpoint(0, 28); m.hardpoint(0, -28); m.hardpoint(50, 0); m.hardpoint(-50, 0);
  m.bombsite('A', 0, 28); m.bombsite('B', -50, 0);
  m.lampS(8, 40); m.lampS(-30, 8); m.lampS(30, -8); m.lampS(0, 14);
  m.ziplineS(-44, 12.4, 16, -8, 15.2, 30);     // Klippe -> Tempeldach
  m.zipline(50, 16.4, 0, 8, 4.2, 0);           // Wasserfall-Plateau -> Steinbruecke

  // ---------------- Spawns ----------------
  m.spawnS(0, 52);
  m.spawnS(-10, 50);
  m.spawnS(10, 50);
  m.spawnS(-26, 46);
  m.spawnS(28, 48);
  m.spawnS(-44, 40);
  m.spawnS(44, 38);
  m.spawn(-50, 0, null); m.spawn(50, 0, null);
  m.spawn(-30, -14, null); m.spawn(30, 14, null);
  return m;
}

// ============================================================
// SCHIESSSTAND — Trainingskarte: Schuetzenstand, freie Bahn,
// Distanzmarken, Kugelfang. Keine Deckung, nur Sicht.
// ============================================================
function buildRange() {
  const m = new MapBuilder({
    id: 'range',
    name: 'SCHIESSSTAND',
    skyTop: 0x2f5f9f, skyBottom: 0xd8e6f0,
    fogColor: 0xbfd0dc, fogNear: 90, fogFar: 260,
    sunDir: [0.35, 0.8, 0.48], sunColor: 0xfff4e0, sunIntensity: 1.35,
    ambTop: 0xa8c4e8, ambBottom: 0x6c6a60, ambIntensity: 0.72,
  });
  const C = {
    ground: 0x8c8f8a, wall: 0x596068, dark: 0x3a3f46, floor: 0xa4a7a0, lane: 0x4a5058,
    accent: 0xffb020, red: 0xc0392b, white: 0xe8ecef, glow: 0x2ee6ff,
  };
  m.surfaces = { [C.floor]: 'stone', [C.lane]: 'metal', [C.dark]: 'metal', [C.ground]: 'stone' };

  m.arena(100, C.ground, C.wall, 22);

  // Schuetzenstand (Plattform z 7..19, Oberkante 0.6) mit Bruestung; das Dach
  // deckt nur den hinteren Teil, damit die Spawns (z = 11) unter freiem Himmel liegen
  m.b(0, 0, 13, 44, 0.6, 12, C.floor);
  m.b(0, 0.6, 7.4, 44, 0.9, 0.5, C.lane);
  m.bx(21.5, 0.6, 15, 0.6, 7, 0.6, C.dark);
  m.bx(21.5, 0.6, 18.5, 0.6, 7, 0.6, C.dark);
  m.b(0, 7.6, 17, 46, 0.5, 5, C.dark);
  m.b(0, 7.2, 14.6, 46, 0.4, 0.5, C.accent, { emissive: 0.5, noShadow: true, noCollide: true });
  // Lauflinien auf dem Stand
  for (let x = -14; x <= 14; x += 7) m.b(x, 0.6, 13, 0.15, 0.02, 12, C.white, { noShadow: true, noCollide: true });

  // Bahn: Seitenwaende und Kugelfang
  m.bx(22, 0, -19, 1.2, 8, 52, C.wall);
  m.b(0, 0, -45, 46, 16, 2, C.dark);
  m.b(0, 0.02, -43.8, 40, 11, 0.4, C.lane, { noCollide: true, noShadow: true });
  m.b(0, 11.2, -43.8, 40, 0.5, 0.5, C.red, { emissive: 0.4, noShadow: true, noCollide: true });

  // Distanzmarken (10, 20, 30, 40 m vor dem Stand)
  for (let d = 10; d <= 40; d += 10) {
    m.b(0, 0.01, 12 - d, 42, 0.06, 0.35, d % 20 === 0 ? C.accent : C.white, { emissive: 0.5, noShadow: true, noCollide: true });
  }
  // Bahnbegrenzung am Boden
  m.bx(20.5, 0.01, -19, 0.3, 0.05, 52, C.glow, { emissive: 0.6, noShadow: true, noCollide: true });

  // Dekorative Pfosten hinter der Bahn (Silhouette), ausserhalb der Sichtlinie zu den Zielen
  m.bx(30, 0, -30, 2, 12, 2, C.wall);
  m.bx(36, 0, -10, 2, 9, 2, C.wall);

  m.spawn(0, 11, null);
  m.spawn(-6, 11, null);
  m.spawn(6, 11, null);
  return m;
}

const BUILDERS = {
  sandstorm: buildSandstorm,
  burg: buildBurg,
  citadel: buildCitadel,
  hafen: buildHafen,
  dschungel: buildDschungel,
  range: buildRange,
};

export const MAP_LIST = [
  { id: 'sandstorm', name: 'Sandstorm' },
  { id: 'burg', name: 'Burg' },
  { id: 'citadel', name: 'Citadel' },
  { id: 'hafen', name: 'Hafen' },
  { id: 'dschungel', name: 'Dschungel' },
];

/**
 * Prueft, ob ueber einer Rampenstufe genug Platz zum Gehen ist.
 * Findet Deckungsobjekte oder Decken, die eine Rampe unbenutzbar machen.
 */
export function validateMap(m) {
  const HEAD = 2.2;      // benoetigte Kopffreiheit
  const STEP = 1.2;      // niedrigere Kanten sind ersteigbar
  const issues = [];
  for (const st of m.rampSteps) {
    const lo = st.top + STEP, hi = st.top + HEAD;
    for (const b of m.boxes) {
      if (b.isRamp || b.noCollide) continue;
      const bx0 = b.cx - b.w / 2, bx1 = b.cx + b.w / 2;
      const bz0 = b.cz - b.d / 2, bz1 = b.cz + b.d / 2;
      const by0 = b.by, by1 = b.by + b.h;
      if (by1 <= st.top + STEP + 0.01) continue;          // ersteigbar
      if (bx1 <= st.minx + 0.05 || bx0 >= st.maxx - 0.05) continue;
      if (bz1 <= st.minz + 0.05 || bz0 >= st.maxz - 0.05) continue;
      if (by1 <= lo + 0.01 || by0 >= hi - 0.01) continue;
      issues.push({
        rampTop: +st.top.toFixed(2),
        at: [Math.round((st.minx + st.maxx) / 2), Math.round((st.minz + st.maxz) / 2)],
        blocker: { x: b.cx, y: b.by, z: b.cz, w: b.w, h: b.h, d: b.d },
      });
      break;
    }
  }
  return issues;
}

export function buildMap(id) {
  const fn = BUILDERS[id] || BUILDERS.sandstorm;
  return fn();
}
