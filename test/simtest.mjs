// Headless-Test der Simulation in Node: Bots spielen gegeneinander, Ereignisse werden gezaehlt.
import { Sim } from '../src/game/sim.js';

const modes = process.argv[2] ? process.argv[2].split(',') : ['tdm', 'ffa', 'gungame', 'ctf', 'hardpoint', 'infection', 'sd'];
const secs = Number(process.argv[3] || 60);
const maps = ['sandstorm', 'burg', 'citadel', 'hafen', 'dschungel'];
let mi = 0;

for (const mode of modes) {
  const sim = new Sim();
  sim.server = true;
  sim.events = [];
  const map = maps[mi++ % maps.length];
  sim.setupMatch({ mode, map, weather: 'clear', bots: 8, difficulty: 2, scoreLimit: 40, timeLimit: 10 });
  sim.addBots(8);
  sim.setupMode();
  for (const a of sim.actors) sim.respawn(a, true);
  sim.running = true;
  const counts = {};
  const t0 = Date.now();
  let steps = 0;
  try {
    while (sim.time < secs && sim.running) {
      sim.step(1 / 60);
      steps++;
      for (const ev of sim.events) counts[ev.t] = (counts[ev.t] || 0) + 1;
      sim.events.length = 0;
    }
  } catch (e) {
    console.log('ERROR in', mode, 'at t=', sim.time.toFixed(2), e.stack);
    process.exitCode = 1;
    continue;
  }
  const ms = Date.now() - t0;
  const alive = sim.actors.filter(a => a.alive).length;
  console.log(`${mode.padEnd(10)} ${map.padEnd(10)} t=${sim.time.toFixed(0)}s steps=${steps} cpu=${ms}ms (${(ms / steps).toFixed(2)} ms/step) alive=${alive}/${sim.actors.length} over=${sim.over} winner=${sim.winner && sim.winner.name ? sim.winner.name : sim.winner} scores=${sim.scores.red}:${sim.scores.blue}`);
  console.log('   events:', Object.entries(counts).filter(([k]) => !['step'].includes(k)).map(([k, v]) => k + '=' + v).join(' '));
}
