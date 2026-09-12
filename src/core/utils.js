// ============================================================
// Kleine Mathe-/Hilfsfunktionen
// ============================================================

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const deg = (d) => (d * Math.PI) / 180;
export const rad2deg = (r) => (r * 180) / Math.PI;

/** Framerate-unabhängiges Annähern: t = 1-exp(-rate*dt) */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** Gauß-verteilte Zufallszahl (Box-Muller), gekappt auf +/-3 sigma */
export function gauss(sigma = 1) {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return clamp(n, -3, 3) * sigma;
}

/** Kürzeste Winkeldifferenz in Radiant */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function angleLerp(a, b, t) {
  return a + angleDelta(a, b) * t;
}

/** Deterministischer PRNG (mulberry32) – für reproduzierbare Karten */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

/** Objekt-Pool für häufig recycelte Instanzen */
export class Pool {
  constructor(factory, size = 32) {
    this.factory = factory;
    this.free = [];
    for (let i = 0; i < size; i++) this.free.push(factory());
  }
  get() { return this.free.length ? this.free.pop() : this.factory(); }
  put(o) { if (this.free.length < 512) this.free.push(o); }
}

const BOT_FIRST = [
  'xX', 'Pro', 'Dark', 'Sniper', 'Krunk', 'Toxic', 'Silent', 'Rapid', 'Ghost', 'Neon',
  'Iron', 'Turbo', 'Cyber', 'Frost', 'Blaze', 'Nova', 'Void', 'Zero', 'Mega', 'Rogue',
  'Swift', 'Vex', 'Grim', 'Lucky', 'Ultra', 'Quick', 'Wild', 'Hyper', 'Storm', 'Razor',
];
const BOT_SECOND = [
  'Slayer', 'Shot', 'Wolf', 'King', 'Beast', 'Hunter', 'Ninja', 'Blade', 'Fury', 'Byte',
  'Fox', 'Hawk', 'Bolt', 'Reaper', 'Titan', 'Viper', 'Crush', 'Punk', 'Dude', 'Kid',
  'Man', 'Bot', 'Lord', 'Frag', 'Aim', 'Rush', 'Pixel', 'Nerd', 'Sauce', 'Gamer',
];
const BOT_SUFFIX = ['', '', '', '', 'Xx', '69', '99', '_TTV', '_YT', '007', '2000', 'z', '1337'];

/** Liefert n eindeutige, krunker-typische Bot-Namen */
export function makeBotNames(n, exclude) {
  const used = new Set(exclude || []);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 2000) {
    const name = pick(BOT_FIRST) + pick(BOT_SECOND) + pick(BOT_SUFFIX);
    if (name.length > 16 || used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  while (out.length < n) out.push('Bot' + out.length);
  return out;
}
