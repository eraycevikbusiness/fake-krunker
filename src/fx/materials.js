// ============================================================
// Materialien: physikalisch basierte Oberflaechen mit prozeduralen
// Texturen (Grunge-Albedo, Normal-Map, Roughness), ein Prop-Material
// mit per-Vertex Metalness/Roughness/Emissive, Himmel-Shader und
// Umgebungslicht (PMREM) aus dem Himmel.
// ============================================================

import * as THREE from 'three';
import { makeRng } from '../core/utils.js';

// ------------------------------------------------------------
// Value-Noise (mehrere Oktaven) fuer Texturen
// ------------------------------------------------------------
function makeNoise(seed) {
  const rng = makeRng(seed);
  const N = 64;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) grid[i] = rng();
  const smooth = (t) => t * t * (3 - 2 * t);
  const at = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = smooth(x - xi), fy = smooth(y - yi);
    const x0 = ((xi % N) + N) % N, y0 = ((yi % N) + N) % N;
    const x1 = (x0 + 1) % N, y1 = (y0 + 1) % N;
    const a = grid[y0 * N + x0], b = grid[y0 * N + x1], c = grid[y1 * N + x0], d = grid[y1 * N + x1];
    return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
  };
  // fbm: x,y in [0,1) kachelbar durch Modulo auf dem Gitter
  return (x, y, oct = 4, lac = 2, gain = 0.5, scale = 4) => {
    let v = 0, amp = 1, f = scale, norm = 0;
    for (let o = 0; o < oct; o++) {
      v += at(x * f, y * f) * amp;
      norm += amp;
      amp *= gain; f *= lac;
    }
    return v / norm;
  };
}

function tex(cv, srgb) {
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

/** Albedo-Grunge: helle Grundflaeche mit Schmutz, Flecken, feinen Rissen */
export function makeGrungeTexture(size = 256, seed = 11) {
  const noise = makeNoise(seed);
  const fine = makeNoise(seed + 7);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = noise(u, v, 5, 2.1, 0.55, 3);
      const f = fine(u, v, 3, 2.7, 0.5, 24);
      let l = 0.80 + n * 0.22 + (f - 0.5) * 0.10;
      // Dunkle Flecken (Ablagerungen)
      const spot = noise(u + 0.37, v + 0.11, 2, 2, 0.5, 2);
      if (spot < 0.36) l *= 0.86 + spot * 0.3;
      l = Math.max(0.55, Math.min(1, l));
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(l * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(cv, true);
}

/** Normal-Map aus einem Hoehenfeld (Rauschen + Koernung) */
export function makeNormalTexture(size = 256, seed = 23, strength = 1.0) {
  const noise = makeNoise(seed);
  const fine = makeNoise(seed + 3);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = noise(u, v, 4, 2.2, 0.5, 3) * 0.6 + fine(u, v, 3, 2.5, 0.55, 20) * 0.4;
    }
  }
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  const k = 6.0 * strength;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const xl = h[y * size + ((x - 1 + size) % size)], xr = h[y * size + ((x + 1) % size)];
      const yu = h[((y - 1 + size) % size) * size + x], yd = h[((y + 1) % size) * size + x];
      let nx = -(xr - xl) * k, ny = -(yd - yu) * k, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * size + x) * 4;
      d[i] = Math.round((nx * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(cv, false);
}

/** Roughness-Map: matt mit leicht glaenzenden, abgeriebenen Stellen */
export function makeRoughnessTexture(size = 128, seed = 41) {
  const noise = makeNoise(seed);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const g = cv.getContext('2d');
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = noise(x / size, y / size, 3, 2.3, 0.5, 3);
      const r = 0.72 + n * 0.28;
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.round(r * 255);
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(cv, false);
}

// Alle erzeugten Materialien (fuer Shader-Neuaufbau bei Einstellungsaenderung)
export const ALL_MATERIALS = new Set();
export function registerMaterial(m) { ALL_MATERIALS.add(m); return m; }
export function unregisterMaterial(m) { ALL_MATERIALS.delete(m); }
export function refreshMaterials() { for (const m of ALL_MATERIALS) m.needsUpdate = true; }

// ------------------------------------------------------------
// Welt-Material
// ------------------------------------------------------------
let worldTex = null;
export function makeWorldMaterial() {
  if (!worldTex) {
    worldTex = {
      map: makeGrungeTexture(256, 11),
      normalMap: makeNormalTexture(256, 23, 0.9),
      roughnessMap: makeRoughnessTexture(128, 41),
    };
  }
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: worldTex.map,
    normalMap: worldTex.normalMap,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughnessMap: worldTex.roughnessMap,
    roughness: 1.0,
    metalness: 0.0,
    envMapIntensity: 0.32,
  });
  // Texturen werden geteilt -> nicht mit dem Material entsorgen
  mat.userData.sharedTextures = true;
  return registerMaterial(mat);
}

// ------------------------------------------------------------
// Prop-Material (Waffen, Figuren): Metalness/Roughness/Emissive pro Vertex
// ------------------------------------------------------------
export function makePropMaterial(opts) {
  const mat = new THREE.MeshStandardMaterial(Object.assign({
    vertexColors: true,
    roughness: 1.0,
    metalness: 1.0,
    envMapIntensity: 1.0,
  }, opts || {}));
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', 'attribute vec3 aPBR;\nvarying vec3 vPBR;\n#include <common>')
      .replace('#include <begin_vertex>', 'vPBR = aPBR;\n#include <begin_vertex>');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', 'varying vec3 vPBR;\n#include <common>')
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPBR.y;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPBR.x;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vPBR.z;');
  };
  mat.customProgramCacheKey = () => 'fragstorm-prop';
  return registerMaterial(mat);
}

// ------------------------------------------------------------
// Himmel
// ------------------------------------------------------------
const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const SKY_FS = `
uniform vec3 top; uniform vec3 bottom; uniform vec3 horizon;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunGlow;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float t = clamp(d.y, -1.0, 1.0);
  vec3 col = mix(bottom, top, pow(max(t, 0.0), 0.5));
  col = mix(col, horizon, exp(-abs(t) * 6.0) * 0.55);
  if (t < 0.0) col = mix(col, bottom * 0.7, clamp(-t * 3.0, 0.0, 1.0));
  float s = dot(d, sunDir);
  float disc = smoothstep(0.9988, 0.9996, s);
  col += sunColor * (disc * 8.0 + pow(max(s, 0.0), 64.0) * 0.9 * sunGlow + pow(max(s, 0.0), 6.0) * 0.10 * sunGlow);
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeSkyMaterial(map) {
  const c = (hex) => new THREE.Color(hex);
  const top = c(map.skyTop), bottom = c(map.skyBottom);
  const horizon = bottom.clone().lerp(new THREE.Color(0xffffff), 0.35);
  const sd = new THREE.Vector3(map.sunDir[0], map.sunDir[1], map.sunDir[2]).normalize();
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VS,
    fragmentShader: SKY_FS,
    uniforms: {
      top: { value: top }, bottom: { value: bottom }, horizon: { value: horizon },
      sunDir: { value: sd }, sunColor: { value: c(map.sunColor) }, sunGlow: { value: 1.0 },
    },
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
  });
}

/** Umgebungslicht (IBL) aus dem Himmel-Shader erzeugen */
export function buildEnvironment(renderer, skyMaterial) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMaterial);
  scene.add(mesh);
  // Boden-Anteil: dunklere untere Hemisphaere ist im Shader enthalten
  const rt = pmrem.fromScene(scene, 0.04, 0.1, 100);
  mesh.geometry.dispose();
  pmrem.dispose();
  return rt;
}
