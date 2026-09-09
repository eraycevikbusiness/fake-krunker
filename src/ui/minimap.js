// ============================================================
// Minimap: statischer Karten-Hintergrund + dynamische Spieler.
// Gegner erscheinen nur, wenn sie gerade geschossen haben (laut)
// oder das UAV (Killstreak) aktiv ist. Mitspieler immer.
// Modi-Objekte (Flaggen, Hardpoint) kommen ueber player.items.
// ============================================================

import { clamp } from '../core/utils.js';

export class Minimap {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.size = canvas.width;
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = 512;
    this.ready = false;
    this.zoom = 1.0;
  }

  build(map) {
    const S = this.bg.width;
    const g = this.bg.getContext('2d');
    const half = (map.size || 120) / 2 + 4;
    this.half = half;
    const scale = S / (half * 2);

    g.clearRect(0, 0, S, S);
    g.fillStyle = '#10141c';
    g.fillRect(0, 0, S, S);

    // Boxen nach Hoehe sortiert -> hohe Bauten oben drauf
    const boxes = map.boxes
      .filter(b => !b.noCollide && b.by + b.h > 0.3 && b.h > 0.25)
      .slice()
      .sort((a, b) => (a.by + a.h) - (b.by + b.h));

    for (const b of boxes) {
      const top = b.by + b.h;
      if (top > 40) continue;                    // Aussenmauern ausblenden
      const x = (b.cx - b.w / 2 + half) * scale;
      const z = (b.cz - b.d / 2 + half) * scale;
      const w = b.w * scale, d = b.d * scale;
      const t = clamp(top / 16, 0, 1);
      const r = Math.round(52 + t * 150);
      const gg = Math.round(58 + t * 150);
      const bb = Math.round(70 + t * 140);
      g.fillStyle = `rgb(${r},${gg},${bb})`;
      g.fillRect(x, z, w, d);
    }

    // Rahmen
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3;
    g.strokeRect(1.5, 1.5, S - 3, S - 3);

    this.ready = true;
  }

  /**
   * @param player {x,y,z,yaw,actor,pickups,uav,items,teamMode}
   * @param actors alle Akteure
   * @param sameTeam Funktion (a,b) -> bool
   */
  draw(player, actors, sameTeam, time) {
    if (!this.ready) return;
    const g = this.g;
    const S = this.size;
    const R = S / 2;
    g.clearRect(0, 0, S, S);

    g.save();
    // Kreisförmige Maske
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();

    const worldToPx = (S / (this.half * 2)) * this.zoom * 1.9;

    g.translate(R, R);
    g.rotate(player.yaw);          // Karte dreht sich, Spieler zeigt nach oben

    // Hintergrund zentriert auf Spieler
    const bgScale = worldToPx * (this.half * 2) / this.bg.width;
    g.drawImage(
      this.bg,
      -player.x * worldToPx - (this.half * worldToPx),
      -player.z * worldToPx - (this.half * worldToPx),
      this.bg.width * bgScale, this.bg.height * bgScale
    );

    // Modi-Objekte (Flaggen, Zone)
    if (player.items) {
      for (const it of player.items) {
        const dx = (it.x - player.x) * worldToPx;
        const dz = (it.z - player.z) * worldToPx;
        if (it.zone) {
          g.fillStyle = it.color.replace(')', ',0.25)').replace('rgb(', 'rgba(').replace('#', '#');
          g.strokeStyle = it.color;
          g.lineWidth = 2;
          g.beginPath(); g.arc(dx, dz, it.zone * worldToPx, 0, Math.PI * 2);
          g.globalAlpha = 0.25; g.fill(); g.globalAlpha = 1; g.stroke();
        } else if (it.ring) {
          g.strokeStyle = it.color;
          g.lineWidth = 2;
          g.beginPath(); g.arc(dx, dz, 6, 0, Math.PI * 2); g.stroke();
        }
        if (it.label) {
          g.save();
          g.translate(dx, dz);
          g.rotate(-player.yaw);
          g.fillStyle = it.color;
          g.strokeStyle = 'rgba(0,0,0,0.8)';
          g.lineWidth = 3;
          g.font = (it.big ? 'bold 13px ' : 'bold 11px ') + 'Rajdhani, sans-serif';
          g.textAlign = 'center'; g.textBaseline = 'middle';
          g.strokeText(it.label, 0, 0);
          g.fillText(it.label, 0, 0);
          g.restore();
        }
      }
    }

    // Akteure
    for (const a of actors) {
      if (!a.alive) continue;
      if (a === player.actor) continue;
      const friend = sameTeam(a, player.actor);
      // Gegner nur bei UAV oder wenn sie gerade laut waren
      const loud = (time - (a.lastLoudTime || -99)) < 1.6;
      if (!friend && !player.uav && !loud) continue;
      const dx = (a.pos.x - player.x) * worldToPx;
      const dz = (a.pos.z - player.z) * worldToPx;
      if (Math.hypot(dx, dz) > R - 6) continue;

      g.save();
      g.translate(dx, dz);
      g.rotate(-a.yaw + Math.PI);
      const tc = player.teamCss || { red: '#ff6b6b', blue: '#7ab4ff' };
      g.fillStyle = friend ? (player.teamMode ? (tc[a.team] || '#7ab4ff') : '#4499ff') : '#ff4444';
      if (!friend && !player.uav) g.globalAlpha = 0.75;
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(0, -5.5); g.lineTo(4, 4); g.lineTo(0, 1.5); g.lineTo(-4, 4);
      g.closePath();
      g.fill(); g.stroke();
      if (a.carrying) {
        g.fillStyle = '#ffcc00';
        g.beginPath(); g.arc(0, 0, 7, 0, Math.PI * 2); g.lineWidth = 2; g.strokeStyle = '#ffcc00'; g.stroke();
      }
      // Hoehenunterschied andeuten
      const dy = a.pos.y - player.y;
      if (Math.abs(dy) > 2.5) {
        g.fillStyle = '#fff';
        g.font = 'bold 9px sans-serif';
        g.textAlign = 'center';
        g.fillText(dy > 0 ? '▲' : '▼', 0, dy > 0 ? -8 : 12);
      }
      g.restore();
    }

    // Pickups
    if (player.pickups) {
      for (const p of player.pickups) {
        if (!p.active) continue;
        const dx = (p.x - player.x) * worldToPx;
        const dz = (p.z - player.z) * worldToPx;
        if (Math.hypot(dx, dz) > R - 6) continue;
        g.fillStyle = p.type === 'health' ? '#55dd55' : p.type === 'armor' ? '#4499ff' : '#ffcc00';
        g.fillRect(dx - 2.5, dz - 2.5, 5, 5);
      }
    }

    g.restore();

    // Eigener Marker (immer oben, zeigt nach oben)
    g.save();
    g.translate(R, R);
    g.fillStyle = '#ffcc00';
    g.strokeStyle = '#000';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -6.5); g.lineTo(4.5, 5); g.lineTo(0, 2); g.lineTo(-4.5, 5);
    g.closePath();
    g.fill(); g.stroke();
    g.restore();

    // UAV-Hinweis
    if (player.uav) {
      g.save();
      g.strokeStyle = 'rgba(255,204,0,0.8)';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(R, R, (R - 8) * ((time * 0.5) % 1), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // Nordanzeige
    g.save();
    g.translate(R, R);
    g.rotate(player.yaw);
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.font = 'bold 11px Rajdhani, sans-serif';
    g.textAlign = 'center';
    g.fillText('N', 0, -(R - 8));
    g.restore();

    // Rand
    g.strokeStyle = player.uav ? 'rgba(255,204,0,0.5)' : 'rgba(255,255,255,0.22)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.stroke();
  }
}
