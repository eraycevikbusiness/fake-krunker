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
        menu.showMenu('play', false);
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
    setState('ended');
    hud.show(false);
    hud.showScoreboard(false);
    hud.hideDeath();
    hud.setClickHint(false);
    input.exitLock();
    menu.showEnd(game, winner, won);
  };
}

function setState(s) {
  state = s;
  input.gameActive = (s === 'playing' || s === 'paused') && !!game && game.running;
}

function inMatch() { return !!game && game.running && (state === 'playing' || state === 'paused'); }

function resumeGame() {
  menu.hideMenu();
  menu.hidePause();
  setState('playing');
  requestLock();
}

function pauseGame() {
  if (!inMatch()) return;
  setState('paused');
  input.exitLock();
  hud.setClickHint(false);
  menu.showPause();
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
    setState('playing');
    requestLock();
  },
  onResume: () => resumeGame(),
  onBackToGame: () => {
    // Aus dem Menue (Einstellungen/Klassen) zurueck zum Pausenbildschirm
    menu.hideMenu();
    if (inMatch()) { setState('paused'); menu.showPause(); }
  },
  onQuit: () => {
    // Wichtig: Mauszeiger wieder freigeben, sonst bleibt das Menue unklickbar
    input.exitLock();
    menu.hidePause();
    menu.hideEnd();
    hud.show(false);
    hud.showScoreboard(false);
    hud.hideDeath();
    hud.setClickHint(false);
    if (game) { game.running = false; game.cleanup(); }
    setState('menu');
    menu.showMenu('play', false);
  },
  onOpenSettings: () => { setState('paused'); },
  onSettingChange: (id) => {
    saveSettings();
    if (!game) return;
    if (id === 'renderScale' || id === 'shadows' || id === 'antialias' || id === 'autoQuality' || id === '*') {
      game.applyGraphicsSettings();
    }
    if (id === 'fog' || id === '*') game._applyFog();
    if (id === 'showMinimap' || id === '*') hud.setMinimapVisible(settings.showMinimap);
    if (id === 'thirdPerson' && game.player) game.player.thirdPerson = settings.thirdPerson;
    if (id === 'showFps' || id === '*') showPerf = settings.showFps;
    if (id && id.startsWith('vol')) audio.applySettings();
    if (id === '*') audio.applySettings();
  },
  onClassChange: (id) => {
    if (inMatch()) {
      game.pendingClassId = id;
      hud.toast('KLASSE WIRD BEIM NÄCHSTEN SPAWN GEWECHSELT', true);
    }
  },
  onFullscreen: () => input.toggleFullscreen(),
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

input.onLockChange((locked, error) => {
  if (locked) {
    hud.setClickHint(false);
    if (state === 'playing') menu.hidePause();
    return;
  }
  if (state !== 'playing') return;
  if (error) {
    // Browser hat die Sperre verweigert (z.B. Chrome-Cooldown nach Esc):
    // Spiel bleibt eingefroren, Hinweis zum Klicken zeigen.
    hud.setClickHint(true);
  } else {
    // Maus freigegeben (Esc) -> pausieren
    pauseGame();
  }
});

canvas.addEventListener('click', () => {
  if (state === 'playing' && !input.locked) requestLock();
});

// Tab-Wechsel / Fenster minimiert -> pausieren
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') pauseGame();
});

// ------------------------------------------------------------
// Globale Tasten
// ------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (state === 'playing') {
      pauseGame();
    } else if (state === 'paused') {
      if (menu.menuVisible) {
        // Einstellungen/Klassen im Match offen -> zurueck zum Pausenmenue
        menu.hideMenu();
        menu.showPause();
      } else {
        resumeGame();
      }
    }
    return;
  }
  if (e.code === 'Tab') {
    if (inMatch()) {
      e.preventDefault();
      if (!scoreboardOpen) {
        scoreboardOpen = true;
        hud.renderScoreboard(game);
        hud.showScoreboard(true);
      }
    }
    return;
  }
  if (e.code === 'KeyP' && inMatch() && !menu.menuVisible) {
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
  if (scoreboardOpen && game && game.world) hud.renderScoreboard(game);
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

// Dynamische Aufloesung: Bildzeit beobachten, Pixelratio nachregeln
let dynFrames = 0;
let dynTime = 0;
let dynGoodStreak = 0;
let dynScale = 1;

function updateDynamicResolution(dt) {
  if (!game || !settings.autoQuality) {
    if (game && dynScale !== 1) { dynScale = 1; game.setDynScale(1); }
    return;
  }
  dynFrames++;
  dynTime += dt;
  if (dynTime < 0.75) return;
  const avg = dynTime / dynFrames;
  dynFrames = 0; dynTime = 0;

  const limit = parseInt(settings.maxFps, 10) || 0;
  const target = limit > 0 ? Math.max(1 / limit, 1 / 60) : 1 / 58;
  if (avg > target * 1.25) {
    // Zu langsam -> Aufloesung senken
    dynScale = clamp(dynScale - 0.1, 0.5, 1);
    dynGoodStreak = 0;
    game.setDynScale(dynScale);
  } else if (avg < target * 1.03 && dynScale < 1) {
    // Genug Luft -> nach einer Weile wieder erhoehen
    if (++dynGoodStreak >= 3) {
      dynGoodStreak = 0;
      dynScale = clamp(dynScale + 0.05, 0.5, 1);
      game.setDynScale(dynScale);
    }
  }
}

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

  // Simulation nur, wenn die Maus gefangen ist - sonst steht das Spiel
  // (verhindert, dass man beim Klicken auf "Weiterspielen" getoetet wird).
  const simulate = game && state === 'playing' && input.locked;

  if (simulate) {
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
    acc = 0;
  }

  if (game && game.world) {
    game.render();
    if (simulate) updateDynamicResolution(dt);
  }

  if (showPerf && game && game.world) {
    const info = game.renderer.info;
    hud.setPerf(
      `FPS   ${fps}\n` +
      `Draws ${info.render.calls}\n` +
      `Tris  ${(info.render.triangles / 1000).toFixed(1)}k\n` +
      `Scale ${Math.round(game.dynScale * 100)}%\n` +
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
//   __FRAGSTORM__.game.player.hp = 999
// ------------------------------------------------------------
window.__FRAGSTORM__ = {
  get game() { return game; },
  get state() { return state; },
  set state(s) { setState(s); },
  input, hud, menu, settings,
};
window.__KRUNKER__ = window.__FRAGSTORM__;

// Kontextverlust abfangen
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  console.warn('WebGL-Kontext verloren');
  if (state === 'playing') pauseGame();
});
canvas.addEventListener('webglcontextrestored', () => {
  console.warn('WebGL-Kontext wiederhergestellt');
  if (game) game.applyGraphicsSettings();
});
