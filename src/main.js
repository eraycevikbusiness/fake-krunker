// ============================================================
// Einstiegspunkt: Bootstrap, Spielschleife, Zustandsverwaltung
// ============================================================

import { Input } from './core/input.js';
import { audio } from './core/audio.js';
import { settings, loadSettings, saveSettings } from './core/settings.js';
import { HUD } from './ui/hud.js';
import { Minimap } from './ui/minimap.js';
import { Menu } from './ui/menu.js';
import { Game } from './game/game.js';
import { clamp } from './core/utils.js';

const canvas = document.getElementById('game-canvas');

loadSettings();

const input = new Input(canvas);
const hud = new HUD();
const minimap = new Minimap(document.getElementById('minimap'));

let game = null;
let menu = null;
let state = 'menu';        // menu | playing | paused | ended
let scoreboardOpen = false;
let showPerf = settings.showFps;
let wasLocked = false;

// ------------------------------------------------------------
// Initialisierung
// ------------------------------------------------------------
function boot() {
  const steps = [
    [15, 'Initialisiere Renderer…'],
    [40, 'Baue Waffen…'],
    [65, 'Lade Karten…'],
    [88, 'Bereite Bots vor…'],
    [100, 'Bereit!'],
  ];
  let i = 0;
  const tick = () => {
    if (i >= steps.length) {
      setTimeout(() => {
        menu.hideLoading();
        menu.showMenu('play');
      }, 180);
      return;
    }
    menu.setLoading(steps[i][0], steps[i][1]);
    i++;
    setTimeout(tick, 110);
  };
  tick();
}

function createGame() {
  game = new Game(canvas, hud, minimap, input);
  game.onMatchEnd = (winner, won) => {
    state = 'ended';
    hud.show(false);
    hud.showScoreboard(false);
    hud.hideDeath();
    input.exitLock();
    menu.showEnd(game, winner, won);
  };
}

menu = new Menu({
  onPlay: (cfg) => {
    audio.init();
    audio.resume();
    if (!game) createGame();
    menu.hideMenu();
    menu.hidePause();
    menu.hideEnd();
    game.start(cfg);
    state = 'playing';
    wasLocked = false;
    requestLock();
  },
  onResume: () => {
    menu.hidePause();
    state = 'playing';
    requestLock();
  },
  onQuit: () => {
    // Wichtig: Mauszeiger wieder freigeben, sonst bleibt das Menue unklickbar
    input.exitLock();
    wasLocked = false;
    menu.hidePause();
    menu.hideEnd();
    hud.show(false);
    hud.showScoreboard(false);
    hud.hideDeath();
    if (game) { game.running = false; game.cleanup(); }
    state = 'menu';
    menu.showMenu('play');
  },
  onOpenSettings: () => { state = 'paused'; },
  onSettingChange: (id) => {
    saveSettings();
    if (!game) return;
    if (id === 'renderScale' || id === 'shadows' || id === 'antialias' || id === '*') {
      game.applyGraphicsSettings();
    }
    if (id === 'fog' || id === '*') game._applyFog();
    if (id === 'showMinimap' || id === '*') hud.setMinimapVisible(settings.showMinimap);
    if (id === 'thirdPerson') game.player && (game.player.thirdPerson = settings.thirdPerson);
    if (id === 'showFps' || id === '*') showPerf = settings.showFps;
    if (id && id.startsWith('vol')) audio.applySettings();
    if (id === '*') audio.applySettings();
  },
  onClassChange: () => {},
});

boot();

// ------------------------------------------------------------
// Pointer-Lock-Verwaltung
// ------------------------------------------------------------
function requestLock() {
  audio.init();
  audio.resume();
  input.requestLock();
}

input.onLockChange((locked) => {
  if (locked) {
    wasLocked = true;
    hud.setClickHint(false);
    if (state === 'playing') menu.hidePause();
  } else if (state === 'playing') {
    hud.setClickHint(false);
    if (wasLocked) {
      // Maus freigegeben -> pausieren
      state = 'paused';
      menu.showPause();
    } else {
      // Sperre wurde vom Browser verweigert -> Hinweis zum Klicken zeigen
      hud.setClickHint(true);
    }
  }
});

canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.locked) requestLock();
});

// ------------------------------------------------------------
// Globale Tasten
// ------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state === 'playing') {
      state = 'paused';
      input.exitLock();
      menu.showPause();
    } else if (state === 'paused' && !menu.menuVisible) {
      menu.hidePause();
      state = 'playing';
      requestLock();
    }
    return;
  }
  if (e.code === 'Tab') {
    e.preventDefault();
    if (state === 'playing' || state === 'paused') {
      if (!scoreboardOpen && game) {
        scoreboardOpen = true;
        hud.renderScoreboard(game);
        hud.showScoreboard(true);
      }
    }
    return;
  }
  if (e.code === 'KeyP' && (state === 'playing' || state === 'paused')) {
    showPerf = !showPerf;
    settings.showFps = showPerf;
    saveSettings();
  }
});

addEventListener('keyup', (e) => {
  if (e.code === 'Tab') {
    scoreboardOpen = false;
    hud.showScoreboard(false);
  }
});

// Scoreboard alle 0.5s aktualisieren, solange offen
setInterval(() => {
  if (scoreboardOpen && game) hud.renderScoreboard(game);
}, 500);

// ------------------------------------------------------------
// Spielschleife
// ------------------------------------------------------------
let last = performance.now();
let acc = 0;
let frames = 0;
let fpsTimer = 0;
let fps = 0;
let frameBudget = 0;

function loop(now) {
  requestAnimationFrame(loop);

  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;          // nach Tab-Wechsel nicht springen

  // FPS-Limit
  const limit = parseInt(settings.maxFps, 10) || 0;
  if (limit > 0) {
    frameBudget += dt;
    const step = 1 / limit;
    if (frameBudget < step) return;
    dt = frameBudget;
    frameBudget = 0;
  }

  // FPS-Zaehler
  frames++;
  fpsTimer += dt;
  if (fpsTimer >= 0.5) {
    fps = Math.round(frames / fpsTimer);
    frames = 0; fpsTimer = 0;
  }

  if (game && state === 'playing') {
    input.enabled = true;

    // Eingabe genau einmal pro Frame lesen ...
    game.readInput(dt);

    // ... danach die Physik in Teilschritten simulieren.
    // Die Schrittzahl richtet sich nach der vergangenen Zeit, die Schrittweite
    // wird gleichmaessig verteilt. So laeuft das Spiel auch bei wenigen
    // Bildern pro Sekunde in Echtzeit weiter (kein Zeitlupeneffekt).
    acc += dt;
    if (acc > 0.0005) {
      const MAX_STEP = 1 / 90;
      const steps = Math.min(30, Math.max(1, Math.ceil(acc / MAX_STEP)));
      const h = acc / steps;
      for (let i = 0; i < steps; i++) game.step(h);
      acc = 0;
    }

    // Kamera, Modelle, Effekte und HUD einmal pro Frame
    game.postUpdate(dt);
    input.endFrame();
  } else if (game) {
    input.enabled = false;
    input.endFrame();
  }

  if (game && game.world) game.render();

  if (showPerf && game) {
    const info = game.renderer.info;
    hud.setPerf(
      `FPS   ${fps}\n` +
      `Draws ${info.render.calls}\n` +
      `Tris  ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `Bots  ${game.actors.length - 1}\n` +
      `Proj  ${game.projectiles.length}\n` +
      `Nav   ${game.world.nav ? game.world.nav.nodes.length : 0}`,
      true
    );
  } else {
    hud.setPerf('', false);
  }
}

requestAnimationFrame(loop);

// ------------------------------------------------------------
// Audio erst nach Nutzerinteraktion starten (Browser-Richtlinie)
// ------------------------------------------------------------
const unlock = () => {
  audio.init();
  audio.resume();
  audio.applySettings();
  removeEventListener('pointerdown', unlock);
  removeEventListener('keydown', unlock);
};
addEventListener('pointerdown', unlock);
addEventListener('keydown', unlock);

// ------------------------------------------------------------
// Debug-Zugriff (nuetzlich in der Browser-Konsole)
//   __KRUNKER__.game.player.hp = 999
// ------------------------------------------------------------
window.__KRUNKER__ = {
  get game() { return game; },
  get state() { return state; },
  set state(s) { state = s; },
  input, hud, menu, settings,
};

// Kontextverlust abfangen
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('WebGL-Kontext verloren');
});
