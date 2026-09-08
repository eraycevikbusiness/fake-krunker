// ============================================================
// Post-Processing ohne Addons: HDR-Szene -> SSAO -> Bloom ->
// Composite (Belichtung, ACES, Farbkorrektur, Vignette, Koernung)
// -> FXAA -> Bildschirm.
// ============================================================

import * as THREE from 'three';

const VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const SSAO_FS = `
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float near; uniform float far;
uniform vec2 tanHalf;
uniform mat4 projection;
uniform float radius; uniform float intensity; uniform float bias;
varying vec2 vUv;
const int N = 12;
float linZ(float d) { float z = d * 2.0 - 1.0; return -2.0 * near * far / (far + near - z * (far - near)); }
vec3 viewPos(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  float vz = linZ(d);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * tanHalf * -vz, vz);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  if (d0 >= 0.9999) { gl_FragColor = vec4(1.0); return; }
  vec3 p = viewPos(vUv);
  vec3 n = normalize(cross(dFdx(p), dFdy(p)));
  // Zufaellige Rotation pro Pixel
  float a = hash(vUv * resolution) * 6.2831853;
  vec3 rnd = vec3(cos(a), sin(a), hash(vUv * resolution + 3.1) * 2.0 - 1.0);
  vec3 t = normalize(rnd - n * dot(rnd, n));
  vec3 b = cross(n, t);
  mat3 tbn = mat3(t, b, n);
  float dist = -p.z;
  float r = radius * (0.6 + 0.4 * clamp(dist / 30.0, 0.0, 1.0));
  float occ = 0.0;
  for (int i = 0; i < N; i++) {
    float fi = float(i);
    // Halbkugel-Samples (Fibonacci-artig), zur Mitte hin dichter
    float k = (fi + 0.5) / float(N);
    float ang = fi * 2.399963;
    float rr = sqrt(k) * 0.9;
    vec3 s = vec3(cos(ang) * rr, sin(ang) * rr, 0.15 + 0.85 * (1.0 - k));
    s = normalize(s) * (0.2 + 0.8 * k * k);
    vec3 sp = p + tbn * s * r;
    vec4 o = projection * vec4(sp, 1.0);
    vec2 suv = (o.xy / o.w) * 0.5 + 0.5;
    if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) continue;
    float sz = linZ(texture2D(tDepth, suv).x);
    float diff = sz - sp.z;               // > 0: Szene liegt vor dem Sample
    float range = smoothstep(0.0, 1.0, r / max(abs(p.z - sz), 1e-4));
    occ += (diff > bias ? 1.0 : 0.0) * range;
  }
  float ao = 1.0 - (occ / float(N)) * intensity;
  gl_FragColor = vec4(vec3(clamp(ao, 0.0, 1.0)), 1.0);
}`;

const BLUR_AO_FS = `
uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 texel;
varying vec2 vUv;
void main() {
  float d0 = texture2D(tDepth, vUv).x;
  float sum = 0.0, wsum = 0.0;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 o = vec2(float(x), float(y)) * texel;
    float d = texture2D(tDepth, vUv + o).x;
    float w = exp(-abs(d - d0) * 4000.0);
    sum += texture2D(tAO, vUv + o).r * w; wsum += w;
  }
  gl_FragColor = vec4(vec3(sum / max(wsum, 1e-4)), 1.0);
}`;

const BRIGHT_FS = `
uniform sampler2D tScene; uniform float threshold; uniform vec2 texel;
varying vec2 vUv;
void main() {
  // 4-Tap-Downsample
  vec3 c = texture2D(tScene, vUv + texel * vec2(-0.5, -0.5)).rgb
         + texture2D(tScene, vUv + texel * vec2(0.5, -0.5)).rgb
         + texture2D(tScene, vUv + texel * vec2(-0.5, 0.5)).rgb
         + texture2D(tScene, vUv + texel * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float knee = threshold * 0.5;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float k = max(soft, l - threshold) / max(l, 1e-4);
  gl_FragColor = vec4(c * k, 1.0);
}`;

const BLUR_FS = `
uniform sampler2D tex; uniform vec2 dir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tex, vUv).rgb * 0.2270270270;
  c += texture2D(tex, vUv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tex, vUv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tex, vUv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FS = `
uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tBloom;
uniform float exposure; uniform float bloomStrength; uniform float aoMix;
uniform float vignette; uniform float grain; uniform float time;
uniform float saturation; uniform float contrast; uniform vec2 resolution;
uniform float aberration;
varying vec2 vUv;
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 d = vUv - 0.5;
  // Leichte chromatische Aberration zum Rand hin
  vec2 ab = d * aberration * dot(d, d);
  vec3 c;
  c.r = texture2D(tScene, vUv + ab).r;
  c.g = texture2D(tScene, vUv).g;
  c.b = texture2D(tScene, vUv - ab).b;
  float ao = mix(1.0, texture2D(tAO, vUv).r, aoMix);
  c *= ao;
  c += texture2D(tBloom, vUv).rgb * bloomStrength;
  c *= exposure;
  c = aces(c);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  c *= 1.0 - vignette * dot(d, d) * 1.7;
  float g = fract(sin(dot(vUv * resolution + vec2(time * 61.0, time * 37.0), vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - 0.5) * grain;
  gl_FragColor = vec4(toSRGB(clamp(c, 0.0, 1.0)), 1.0);
}`;

const FXAA_FS = `
uniform sampler2D tDiffuse; uniform vec2 resolution;
varying vec2 vUv;
#define SPAN_MAX 8.0
#define REDUCE_MUL (1.0 / 8.0)
#define REDUCE_MIN (1.0 / 128.0)
void main() {
  vec2 inv = 1.0 / resolution;
  vec3 rgbNW = texture2D(tDiffuse, vUv + vec2(-1.0, -1.0) * inv).rgb;
  vec3 rgbNE = texture2D(tDiffuse, vUv + vec2(1.0, -1.0) * inv).rgb;
  vec3 rgbSW = texture2D(tDiffuse, vUv + vec2(-1.0, 1.0) * inv).rgb;
  vec3 rgbSE = texture2D(tDiffuse, vUv + vec2(1.0, 1.0) * inv).rgb;
  vec3 rgbM = texture2D(tDiffuse, vUv).rgb;
  vec3 luma = vec3(0.299, 0.587, 0.114);
  float lNW = dot(rgbNW, luma), lNE = dot(rgbNE, luma), lSW = dot(rgbSW, luma), lSE = dot(rgbSE, luma), lM = dot(rgbM, luma);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * (0.25 * REDUCE_MUL), REDUCE_MIN);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(SPAN_MAX), max(vec2(-SPAN_MAX), dir * rcpDirMin)) * inv;
  vec3 rgbA = 0.5 * (texture2D(tDiffuse, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tDiffuse, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tDiffuse, vUv + dir * -0.5).rgb + texture2D(tDiffuse, vUv + dir * 0.5).rgb);
  float lB = dot(rgbB, luma);
  gl_FragColor = vec4((lB < lMin || lB > lMax) ? rgbA : rgbB, 1.0);
}`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.ssao = true;
    this.bloom = true;
    this.time = 0;
    this.params = {
      exposure: 0.95, bloomStrength: 0.45, bloomThreshold: 1.0,
      vignette: 0.22, grain: 0.028, saturation: 0.90, contrast: 1.04, aberration: 0.005,
      aoRadius: 1.4, aoIntensity: 1.25, aoBias: 0.03,
    };

    const gl2 = renderer.capabilities.isWebGL2;
    const hdr = gl2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.hdr = hdr;
    const type = hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

    this.rtScene = new THREE.WebGLRenderTarget(2, 2, {
      type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
    });
    this.rtScene.depthTexture = new THREE.DepthTexture(2, 2, THREE.UnsignedIntType);
    this.rtScene.texture.colorSpace = THREE.NoColorSpace;
    const mk = (opts) => new THREE.WebGLRenderTarget(2, 2, Object.assign({
      type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
    }, opts || {}));
    this.rtAO = mk();
    this.rtAO2 = mk();
    this.rtBloomA = mk({ type });
    this.rtBloomB = mk({ type });
    this.rtLDR = mk();

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const sm = (fs, uniforms) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
    this.matSSAO = sm(SSAO_FS, {
      tDepth: { value: null }, resolution: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 900 },
      tanHalf: { value: new THREE.Vector2() }, projection: { value: new THREE.Matrix4() },
      radius: { value: 1.4 }, intensity: { value: 1.2 }, bias: { value: 0.03 },
    });
    this.matBlurAO = sm(BLUR_AO_FS, { tAO: { value: null }, tDepth: { value: null }, texel: { value: new THREE.Vector2() } });
    this.matBright = sm(BRIGHT_FS, { tScene: { value: null }, threshold: { value: 1.0 }, texel: { value: new THREE.Vector2() } });
    this.matBlur = sm(BLUR_FS, { tex: { value: null }, dir: { value: new THREE.Vector2() } });
    this.matComposite = sm(COMPOSITE_FS, {
      tScene: { value: null }, tAO: { value: null }, tBloom: { value: null },
      exposure: { value: 1 }, bloomStrength: { value: 0.5 }, aoMix: { value: 1 },
      vignette: { value: 0.3 }, grain: { value: 0.03 }, time: { value: 0 },
      saturation: { value: 1.05 }, contrast: { value: 1.05 }, resolution: { value: new THREE.Vector2() },
      aberration: { value: 0.006 },
    });
    this.matFXAA = sm(FXAA_FS, { tDiffuse: { value: null }, resolution: { value: new THREE.Vector2() } });

    this.width = 0; this.height = 0;
    this._black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._black.needsUpdate = true;
    this._white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    this._white.needsUpdate = true;
  }

  /** Groesse in Pixeln des Zeichenpuffers */
  resize(w, h) {
    w = Math.max(2, Math.floor(w)); h = Math.max(2, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.rtScene.setSize(w, h);
    this.rtScene.depthTexture.image.width = w;
    this.rtScene.depthTexture.image.height = h;
    this.rtLDR.setSize(w, h);
    const hw = Math.max(1, Math.floor(w / 2)), hh = Math.max(1, Math.floor(h / 2));
    this.rtAO.setSize(hw, hh);
    this.rtAO2.setSize(hw, hh);
    const qw = Math.max(1, Math.floor(w / 4)), qh = Math.max(1, Math.floor(h / 4));
    this.rtBloomA.setSize(qw, qh);
    this.rtBloomB.setSize(qw, qh);
    this.matSSAO.uniforms.resolution.value.set(hw, hh);
    this.matBlurAO.uniforms.texel.value.set(1 / hw, 1 / hh);
    this.matBright.uniforms.texel.value.set(1 / w, 1 / h);
    this.matComposite.uniforms.resolution.value.set(w, h);
    this.matFXAA.uniforms.resolution.value.set(w, h);
  }

  _pass(mat, target) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  /**
   * Komplettes Bild rendern.
   * vm: { scene, camera, visible } fuer die Waffenansicht (optional)
   */
  render(scene, camera, vm, dt) {
    const r = this.renderer;
    this.time += dt || 0.016;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    this.resize(size.x, size.y);
    const P = this.params;

    // ---- Szene (HDR, mit Tiefe) ----
    r.setRenderTarget(this.rtScene);
    r.clear(true, true, false);
    r.render(scene, camera);

    // ---- SSAO aus der Welt-Tiefe (vor der Waffenansicht) ----
    let aoTex = this._white;
    if (this.ssao) {
      const u = this.matSSAO.uniforms;
      u.tDepth.value = this.rtScene.depthTexture;
      u.near.value = camera.near; u.far.value = camera.far;
      const th = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      u.tanHalf.value.set(th * camera.aspect, th);
      u.projection.value.copy(camera.projectionMatrix);
      u.radius.value = P.aoRadius; u.intensity.value = P.aoIntensity; u.bias.value = P.aoBias;
      this._pass(this.matSSAO, this.rtAO);
      this.matBlurAO.uniforms.tAO.value = this.rtAO.texture;
      this.matBlurAO.uniforms.tDepth.value = this.rtScene.depthTexture;
      this._pass(this.matBlurAO, this.rtAO2);
      aoTex = this.rtAO2.texture;
    }

    // ---- Waffenansicht in dieselbe Szene zeichnen ----
    if (vm && vm.visible) {
      r.setRenderTarget(this.rtScene);
      r.clearDepth();
      r.render(vm.scene, vm.camera);
    }

    // ---- Bloom ----
    let bloomTex = this._black;
    if (this.bloom) {
      this.matBright.uniforms.tScene.value = this.rtScene.texture;
      this.matBright.uniforms.threshold.value = this.hdr ? P.bloomThreshold : 0.82;
      this._pass(this.matBright, this.rtBloomA);
      const bw = this.rtBloomA.width, bh = this.rtBloomA.height;
      for (let i = 0; i < 2; i++) {
        this.matBlur.uniforms.tex.value = this.rtBloomA.texture;
        this.matBlur.uniforms.dir.value.set((1 + i) / bw, 0);
        this._pass(this.matBlur, this.rtBloomB);
        this.matBlur.uniforms.tex.value = this.rtBloomB.texture;
        this.matBlur.uniforms.dir.value.set(0, (1 + i) / bh);
        this._pass(this.matBlur, this.rtBloomA);
      }
      bloomTex = this.rtBloomA.texture;
    }

    // ---- Composite -> LDR ----
    const c = this.matComposite.uniforms;
    c.tScene.value = this.rtScene.texture;
    c.tAO.value = aoTex;
    c.tBloom.value = bloomTex;
    c.exposure.value = P.exposure;
    c.bloomStrength.value = this.bloom ? P.bloomStrength : 0;
    c.aoMix.value = this.ssao ? 1 : 0;
    c.vignette.value = P.vignette;
    c.grain.value = P.grain;
    c.time.value = this.time % 1000;
    c.saturation.value = P.saturation;
    c.contrast.value = P.contrast;
    c.aberration.value = P.aberration;
    this._pass(this.matComposite, this.rtLDR);

    // ---- FXAA -> Bildschirm ----
    this.matFXAA.uniforms.tDiffuse.value = this.rtLDR.texture;
    this._pass(this.matFXAA, null);
    r.setRenderTarget(null);
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtAO, this.rtAO2, this.rtBloomA, this.rtBloomB, this.rtLDR]) rt.dispose();
    for (const m of [this.matSSAO, this.matBlurAO, this.matBright, this.matBlur, this.matComposite, this.matFXAA]) m.dispose();
    this.quad.geometry.dispose();
  }
}
