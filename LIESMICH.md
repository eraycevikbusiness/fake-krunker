# KRUNKER CLONE — Browser-FPS

Ein vollständiger Ego-Shooter im Stil von Krunker.io, komplett im Browser.
Keine Installation, keine Assets aus dem Netz, kein Build-Schritt.

## Starten

**Doppelklick auf `START.bat`** — der Server startet und der Browser öffnet
sich automatisch auf <http://localhost:8080>.

Alternativ im Terminal:

```
node serve.mjs
```

> Ein Server ist nötig, weil das Spiel aus ES-Modulen besteht. Ein direktes
> Öffnen der `index.html` per Doppelklick funktioniert deshalb **nicht**
> (Browser blockieren Module über `file://`).

Voraussetzung: [Node.js](https://nodejs.org) (nur für den Mini-Server).
Three.js liegt lokal unter `libs/` — das Spiel läuft also auch offline.

## Steuerung

| Taste | Funktion |
|---|---|
| `W A S D` | Bewegen |
| Maus | Umsehen |
| Linksklick | Schießen |
| Rechtsklick | Zielen / Zoom (Scharfschützengewehr: Zielfernrohr) |
| `Leertaste` | Springen — je nach Klasse Doppel- oder Dreifachsprung |
| `Shift` | Sprinten |
| `Strg` / `C` | Ducken — im Sprint wird daraus ein Slide |
| `R` | Nachladen |
| `1` `2` `3` | Primär- / Sekundär- / Nahkampfwaffe |
| `Q` | Zurück zur vorherigen Waffe |
| `F` | Schneller Nahkampfschlag (ohne Waffenwechsel) |
| `G` | Granate werfen |
| `Tab` | Rangliste |
| `Esc` | Pause |
| `V` | Umschalten Ego-/Verfolgerperspektive |
| `P` | Performance-Anzeige |

**Tipp:** Springen und dabei seitlich strafen (ohne `W`) beschleunigt dich —
Bunny-Hop und Air-Strafe funktionieren wie im Original.

## Inhalt

**11 Klassen** mit eigenen Werten, Waffen und Perks:
Triggerman, Hunter, Run N Gun, Spray N Pray, Detective, Bull, Vince,
Rocketeer, Agent, Commando, Ninja.

**14 Waffen:** Sturmgewehr, MP, Scharfschützengewehr (Zielfernrohr,
Durchschuss), Schrotflinte, LMG, Marksman, Feuerstoß-Gewehr, Akimbo Uzi,
Raketenwerfer, Alien Blaster, Revolver, Pistole, Kampfmesser, Katana —
dazu Splittergranaten.

Jede Waffe hat eigene Werte für Schaden, Feuerrate, Streuung, Rückstoß,
Magazin, Nachladezeit, Reichweiten-Abfall, Zoom und Trefferzonen-Multiplikatoren.

**3 Karten** (alle punktsymmetrisch, also für beide Teams fair):

* **Sandstorm** — Wüstenstadt mit Zentral-Ziggurat, Dachlinien und Brücken
* **Burg** — Wehrgänge, vier Ecktürme, Bergfried im Hof
* **Citadel** — Industrieanlage mit Reaktor, Laufsteg-Ring und Containern

**Modi:** Team Deathmatch und Free For All, mit einstellbarem Punkte- und
Zeitlimit.

**Bots:** 1–15 Gegner in vier Schwierigkeitsgraden (Einfach bis Albtraum).
Sie unterscheiden sich in Reaktionszeit, Zielgenauigkeit, Strafing,
Rückstoßkontrolle, Granatennutzung und Wahrnehmungsreichweite.

## Wie die Bots funktionieren

Beim Laden jeder Karte wird automatisch ein **mehrstöckiges Navigationsgitter**
erzeugt (rund 4000–5000 Knoten): Für jede Rasterzelle werden alle begehbaren
Oberflächen gesucht — Boden, Dächer, Rampenstufen, Laufstege. Nachbarknoten
werden verbunden, wenn Höhenunterschied und Durchgangsbreite stimmen.

Die Bots suchen darauf per A\* ihren Weg, nutzen also Rampen, Dächer und
Wehrgänge genauso wie du. Im Kampf halten sie eine waffenabhängige
Wunschdistanz (Schrotflinte nah, Sniper weit), strafen, springen, legen
Feuerpausen zur Rückstoßkontrolle ein, laden in Deckung nach und wechseln
die Waffe, wenn die Munition leer ist.

## Weitere Funktionen

* Waffenansicht mit Sway, Bob, Rückstoß, Nachlade- und Wechselanimation
* Trefferzonen (Kopf / Rumpf / Beine) mit eigenen Multiplikatoren, Reichweiten-Abfall, Rückenangriffe im Nahkampf
* Projektile mit Ballistik: Raketen und Granaten mit Flächenschaden, Rückstoß und Rocket-Jumps
* Partikel, Tracer, Einschusslöcher, Mündungsfeuer, Explosionen, Blut, Staub
* Vollständig synthetisierter Sound (Web Audio) mit Entfernungsdämpfung und Stereo-Panning — keine Sounddateien nötig
* HUD: dynamisches Fadenkreuz, Killfeed, Schadenszahlen, Trefferrichtungs-Anzeige, Killstreaks, Minimap, Rangliste
* Sprungpads, Medikits, Rüstung und Munitionskisten
* 30 Einstellungen (Empfindlichkeit, Sichtfeld, Schatten, Auflösungsskalierung, FPS-Limit, Fadenkreuz, Lautstärken …), dauerhaft gespeichert

## Projektstruktur

```
index.html            Seitengerüst und HUD-Markup
css/style.css         Gesamtes UI
libs/three.module.js  Three.js (lokal, r160)
serve.mjs             Mini-Webserver
src/
  main.js             Einstiegspunkt, Spielschleife, Zustände
  core/               Eingabe, Audio, Einstellungen, Mathe-Helfer
  world/
    mapdata.js        Kartendefinitionen + Rampen-Validierung
    world.js          Geometrie, Kollision, Raycasting, Navigation
  fx/effects.js       Partikel, Tracer, Decals, Explosionen
  game/
    weapons.js        Waffen- und Klassendaten
    actor.js          Bewegungsphysik und Waffenlogik (gemeinsame Basis)
    player.js         Lokaler Spieler, Kamera, Rückstoß
    bot.js            Bot-KI
    character.js      Spielerfiguren
    viewmodel.js      Waffenansicht
    game.js           Match-Logik, Kampfsystem, Projektile
  ui/                 HUD, Menü, Minimap
```

## Anpassen

* **Waffenwerte:** `src/game/weapons.js` — Schaden, Feuerrate, Streuung usw. stehen als Klartext-Zahlen beieinander.
* **Klassen:** ebenfalls `src/game/weapons.js`, Abschnitt `CLASSES`.
* **Karten:** `src/world/mapdata.js`. Bausteine sind `b()` für Boxen,
  `building()` für Häuser und `rampTo()` für Rampen.
  Wichtig: Rampen immer über `rampTo()` bauen — die Funktion begrenzt die
  Steigung, sonst kommen weder Spieler noch Bots hoch.
* **Bewegungsgefühl:** `PHYS` in `src/game/actor.js` (Tempo, Schwerkraft,
  Sprungkraft, Reibung, Slide).
* **Bot-Schwierigkeit:** `DIFFICULTY` in `src/game/bot.js`.

In der Browser-Konsole ist `__KRUNKER__` verfügbar, z. B.
`__KRUNKER__.game.player.hp = 999`.
