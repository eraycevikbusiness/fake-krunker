// ============================================================
// Wetter und Tageszeit: veraendert Himmel, Nebel, Sonne und
// Umgebungslicht einer Karte. Nacht stellt Laternen auf (Pfosten
// + leuchtender Kopf als Boxen, dazu Punktlichter im Spiel).
// ============================================================

export const WEATHERS = [
  { id: 'clear', name: 'Klar' },
  { id: 'dusk', name: 'Abend' },
  { id: 'rain', name: 'Regen' },
  { id: 'fog', name: 'Nebel' },
  { id: 'night', name: 'Nacht' },
  { id: 'storm', name: 'Gewitternacht' },
];

const LAMP_POLE = 0x2b2f36;
const LAMP_HEAD = 0xffe2a8;

/**
 * Liefert eine Kopie der Kartendefinition mit angepasstem Licht sowie
 * { map, rain, lamps, lightning, wet }.
 */
export function applyWeather(mapDef, id) {
  const map = Object.assign({}, mapDef, { boxes: mapDef.boxes.slice() });
  const res = { map, rain: false, lamps: [], lightning: false, wet: false, weather: id || 'clear' };
  const W = id || 'clear';
  if (W === 'clear') return res;

  if (W === 'dusk') {
    map.skyTop = 0x2a2f5a; map.skyBottom = 0xf0a060;
    map.fogColor = 0xd9a882; map.fogNear = Math.round(map.fogNear * 0.9); map.fogFar = Math.round(map.fogFar * 0.95);
    map.sunDir = [map.sunDir[0], 0.22, map.sunDir[2]];
    map.sunColor = 0xffb070; map.sunIntensity = map.sunIntensity * 0.9;
    map.ambTop = 0x6a5a9a; map.ambBottom = 0x5a3a2a; map.ambIntensity = map.ambIntensity * 0.9;
    return res;
  }
  if (W === 'rain') {
    map.skyTop = 0x3a4656; map.skyBottom = 0x8a95a3;
    map.fogColor = 0x7f8a96; map.fogNear = Math.min(map.fogNear, 40); map.fogFar = Math.min(map.fogFar, 150);
    map.sunColor = 0xdfe6ee; map.sunIntensity = map.sunIntensity * 0.45;
    map.ambTop = 0x8a97a8; map.ambBottom = 0x3a4048; map.ambIntensity = map.ambIntensity * 1.05;
    res.rain = true; res.wet = true;
    return res;
  }
  if (W === 'fog') {
    map.skyTop = 0xb8c2cc; map.skyBottom = 0xd4dade;
    map.fogColor = 0xc9d0d6; map.fogNear = 10; map.fogFar = 62;
    map.sunColor = 0xf4f6f8; map.sunIntensity = map.sunIntensity * 0.6;
    map.ambTop = 0xc0c8d0; map.ambBottom = 0x7a8088; map.ambIntensity = map.ambIntensity * 1.15;
    return res;
  }
  // Nacht / Gewitternacht
  map.skyTop = 0x04060e; map.skyBottom = 0x101a2e;
  map.fogColor = 0x0a1020; map.fogNear = Math.min(map.fogNear, 35); map.fogFar = Math.min(map.fogFar, 150);
  map.sunDir = [-map.sunDir[0] * 0.6, 0.55, -map.sunDir[2] * 0.6];
  map.sunColor = 0x9fb4ff; map.sunIntensity = 0.34;
  map.ambTop = 0x2c3f66; map.ambBottom = 0x0e1220; map.ambIntensity = 0.8;
  res.lamps = placeLamps(map);
  if (W === 'storm') { res.rain = true; res.wet = true; res.lightning = true; map.fogColor = 0x0d1220; }
  return res;
}

/** Laternen: aus map.lamps oder automatisch an Pickups, Sprungpads und Spawns */
function placeLamps(map) {
  const pts = [];
  if (map.lamps && map.lamps.length) {
    for (const l of map.lamps) pts.push({ x: l.x, z: l.z });
  } else {
    for (const p of map.pickups || []) pts.push({ x: p.x, z: p.z });
    for (const p of map.jumpPads || []) pts.push({ x: p.x + 3, z: p.z });
    const sp = (map.spawnsFfa || []);
    for (let i = 0; i < sp.length; i += 3) pts.push({ x: sp[i].x, z: sp[i].z });
  }
  // Mindestabstand und Obergrenze
  const lamps = [];
  for (const p of pts) {
    if (lamps.length >= 12) break;
    if (lamps.some(l => Math.hypot(l.x - p.x, l.z - p.z) < 14)) continue;
    const y = groundGuess(map, p.x, p.z);
    lamps.push({ x: p.x, y, z: p.z });
    map.boxes.push({ cx: p.x, by: y, cz: p.z, w: 0.34, h: 4.6, d: 0.34, color: LAMP_POLE, surface: 'metal' });
    map.boxes.push({ cx: p.x, by: y + 4.6, cz: p.z, w: 0.9, h: 0.32, d: 0.9, color: LAMP_HEAD, emissive: 1.1, noShadow: true, noCollide: true });
    map.boxes.push({ cx: p.x, by: y + 4.92, cz: p.z, w: 1.1, h: 0.12, d: 1.1, color: LAMP_POLE, noShadow: true, noCollide: true });
  }
  return lamps;
}

/** Hoechste Box-Oberkante unter dem Punkt (grob, ohne Collider) */
function groundGuess(map, x, z) {
  let y = 0;
  for (const b of map.boxes) {
    if (b.noCollide) continue;
    if (x < b.cx - b.w / 2 || x > b.cx + b.w / 2 || z < b.cz - b.d / 2 || z > b.cz + b.d / 2) continue;
    const top = b.by + b.h;
    if (top > y && top < 30) y = top;
  }
  return y;
}
