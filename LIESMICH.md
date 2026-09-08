# FRAGSTORM — Arena FPS im Browser

Ein schneller Ego-Shooter im Blockstil, komplett im Browser.
Keine Installation, keine Assets aus dem Netz, kein Build-Schritt.
Läuft auf **Windows, Linux und macOS** in jedem aktuellen Browser
(Chrome, Edge, Firefox, Safari).

## Starten

Ein kleiner lokaler Webserver ist nötig, weil das Spiel aus ES-Modulen
besteht (Browser blockieren Module über `file://`). Der Server öffnet den
Browser automatisch auf <http://localhost:8080>.

| Plattform | So geht's |
|---|---|
| **Windows** | Doppelklick auf `START.bat` |
| **macOS** | Doppelklick auf `start.command` (beim ersten Mal ggf. Rechtsklick → Öffnen) oder im Terminal `bash start.sh` |
| **Linux** | Im Terminal `bash start.sh` (oder `./start.sh`) |
| **Überall** | `node serve.mjs` bzw. `npm start` |

Voraussetzung ist [Node.js](https://nodejs.org) (Version 16 oder neuer).
Fehlt Node.js, starten die Skripte automatisch einen Ersatz-Server mit
Python 3, falls vorhanden.

Optionen für den Server:

```
PORT=3000 node serve.mjs      # anderer Port
node serve.mjs --no-open      # Browser nicht automatisch öffnen
HOST=0.0.0.0 node serve.mjs   # im LAN erreichbar
```

Three.js liegt lokal unter `libs/`, das Spiel läuft also auch komplett offline.

**Tipp:** Im Menü oben rechts auf **VOLLBILD** klicken. Im Vollbild fängt das
Spiel Browser-Kürzel wie `Strg+W` ab (Keyboard-Lock-API in Chrome/Edge).

## Steuerung

| Taste | Funktion |
|---|---|
| `W A S D` | Bewegen |
| Maus | Umsehen |
| Linksklick | Schießen / schneller Nahkampfschlag |
| Rechtsklick | Zielen / Zoom (Scharfschützengewehr: Zielfernrohr) — mit Messer: **Stich** (100 Schaden), mit Katana: **Überkopfhieb** (150 Schaden) |
| `Leertaste` | Springen — **gedrückt halten = automatischer Bunny-Hop**; Doppel-/Dreifachsprung je nach Klasse |
| `Shift` | Sprinten (halten, umschalten oder „immer rennen“ — einstellbar) |
| `C` / `Strg` | Ducken — im Sprint wird daraus ein Slide |
| `R` | Nachladen |
| `1` `2` `3` / Mausrad | Primär- / Sekundär- / Nahkampfwaffe |
| `Q` | Zurück zur vorherigen Waffe |
| `F` | Schneller Nahkampfschlag (ohne Waffenwechsel) |
| `G` | Granate werfen |
| `Tab` | Rangliste |
| `Esc` | Pause (dort: Klasse wechseln, Einstellungen, Vollbild) |
| `V` | Umschalten Ego-/Verfolgerperspektive |
| `P` | Performance-Anzeige |

## Bewegung

Das Movement ist Quake-/Source-artig, aber mit sauberem Feel:

* endliche Beschleunigung und Reibung statt Sofort-Stopp
* Jump-Buffer und Coyote-Time: Sprünge kurz vor der Landung oder kurz nach
  einer Kante werden trotzdem ausgeführt
* Bunny-Hop ohne Geschwindigkeitsverlust (Sprung wird vor der Reibung
  verarbeitet), Air-Strafe mit sanftem Soft-Cap
* Slide mit Cooldown (kein Slide-Spam mehr), Boden-Snapping auf Treppen und
  Rampen, geglättete Kamera bei Stufen, Landungs-Dip

## Inhalt

**11 Klassen** mit eigenen Werten, Waffen und Perks:
Triggerman, Hunter, Run N Gun, Spray N Pray, Detective, Bull, Vince,
Rocketeer, Agent, Commando, Ninja. Die Klasse lässt sich auch im Match
wechseln (Pause → Klasse wechseln, gilt ab dem nächsten Spawn).

**14 Waffen:** Sturmgewehr, MP, Scharfschützengewehr (Zielfernrohr,
Durchschuss), Schrotflinte, LMG, Marksman, Feuerstoß-Gewehr, Akimbo Uzi,
Raketenwerfer, Alien Blaster, Revolver, Pistole, Kampfmesser, Katana —
dazu Splittergranaten.

Jede Waffe hat eigene Werte für Schaden, Feuerrate, Streuung, Rückstoß,
Magazin, Nachladezeit, Reichweiten-Abfall, Zoom und Trefferzonen-Multiplikatoren,
außerdem Griffpunkte und eine Haltung: Messer werden im Vorwärtsgriff
geführt, das Katana beidhändig in Kampfstellung, jede Waffe hat eigene
Schlag-, Nachlade- und Wechselanimationen.

**3 Karten** (alle punktsymmetrisch, also für beide Teams fair):

* **Sandstorm** — Wüstenstadt mit Zentral-Ziggurat, Dachlinien und Brücken
* **Burg** — Wehrgänge, vier Ecktürme, Bergfried im Hof
* **Citadel** — Industrieanlage mit Reaktor, Laufsteg-Ring und Containern

**Modi:** Team Deathmatch und Free For All, mit einstellbarem Punkte- und
Zeitlimit.

**Bots:** 1–15 Gegner in vier Schwierigkeitsgraden (Einfach bis Albtraum).
Sie unterscheiden sich in Reaktionszeit, Zielgenauigkeit, Strafing,
Rückstoßkontrolle, Granatennutzung und Wahrnehmungsreichweite.

## Trefferzonen

Jede Figur hat fünf an der Blickrichtung ausgerichtete Trefferboxen
(Kopf, Rumpf, zwei Arme, Beine), die exakt zum Blockmodell passen und beim
Ducken mitschrumpfen. Kopf, Körper und Beine haben eigene
Schadensmultiplikatoren; Nahkampfangriffe prüfen einen Strahlenfächer gegen
dieselben Boxen, Rückenangriffe machen Extraschaden.

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

## Performance

* Jede Figur besteht aus nur 8 Draw-Calls (verschmolzene Geometrie, ein
  geteiltes Material, gecachte Waffen-Geometrien)
* Raycasts laufen über ein Raster (DDA) statt über alle Weltboxen
* **Auto-Auflösung:** fällt die Bildrate, wird die Renderauflösung
  stufenweise gesenkt und später wieder angehoben (abschaltbar)
* Partikel laden nur den benutzten Pufferbereich hoch, das HUD schreibt nur
  geänderte Werte ins DOM
* Schatten: Niedrig/Hoch nutzen das günstigere PCF, Ultra weiches PCF

## Nahkampf

Messer und Katana haben eigene Zück-Animationen (Messer-Flip, Katana wird von
der Hüfte gezogen), leichte Schläge mit wechselnder Richtung (Linksklick) und
einen schweren Angriff (Rechtsklick). Bei einem Gegner in Reichweite macht der
Angreifer einen kurzen Ausfallschritt, Treffer stoßen das Opfer zurück und
kicken die Kamera. Nahkampfwaffen reagieren träger und stärker auf Mausbewegung
und Sprünge.

## Sound

Alle Geräusche werden synthetisiert: Schüsse aus Transient, Crack, Body,
Verschluss-Klick (Repetierwaffen mit zweitem Klick) und Nachhall über einen
Hall-Bus, der mit der Entfernung lauter wird. Jede Waffe hat ein eigenes
Zück-Geräusch (Ladegriff, Schlitten, Messer-„Shing“, Katana-Ziehen mit
Klingenresonanz), Nachladen in drei Schritten, Nahkampf-Schwünge und -Treffer.

## Weitere Funktionen

* Waffenansicht mit Sway, Bob, Atmen, Rückstoß, Nachlade-, Wechsel- und
  Schlaganimation; Arme folgen den Griffpunkten der Waffe
* Projektile mit Ballistik: Raketen und Granaten mit Flächenschaden, Rückstoß und Rocket-Jumps
* Partikel, Tracer, Einschusslöcher, Mündungsfeuer, Explosionen, Blut, Staub
* Vollständig synthetisierter Sound (Web Audio) mit Entfernungsdämpfung und Stereo-Panning — keine Sounddateien nötig
* HUD: dynamisches Fadenkreuz, Killfeed, Schadenszahlen (pro Schuss gebündelt), Trefferrichtungs-Anzeige, Killstreaks, Minimap, Rangliste, Tacho
* Todeskamera mit Blick auf den Killer
* Sprungpads, Medikits, Rüstung und Munitionskisten
* Über 30 Einstellungen, dauerhaft gespeichert

## Projektstruktur

```
index.html            Seitengerüst und HUD-Markup
css/style.css         Gesamtes UI
libs/three.module.js  Three.js (lokal, r160)
serve.mjs             Mini-Webserver (Windows/Linux/macOS)
START.bat             Start unter Windows
start.sh / .command   Start unter Linux / macOS
src/
  main.js             Einstiegspunkt, Spielschleife, Zustände, Auto-Auflösung
  core/               Eingabe, Audio, Einstellungen, Mathe-Helfer
  world/
    mapdata.js        Kartendefinitionen + Rampen-Validierung
    world.js          Geometrie, Kollision, Grid-Raycast, Navigation
  fx/effects.js       Partikel, Tracer, Decals, Explosionen
  game/
    weapons.js        Waffen- und Klassendaten (inkl. Griffpunkte/Haltungen)
    actor.js          Bewegungsphysik, Trefferzonen, Waffenlogik (gemeinsame Basis)
    player.js         Lokaler Spieler, Kamera, Rückstoß, Todeskamera
    bot.js            Bot-KI
    character.js      Spielerfiguren (verschmolzene Meshes, Arm-IK)
    viewmodel.js      Waffenansicht (Haltungen, Schlaganimationen)
    game.js           Match-Logik, Kampfsystem, Projektile
  ui/                 HUD, Menü, Minimap
```

## Anpassen

* **Waffenwerte:** `src/game/weapons.js` — Schaden, Feuerrate, Streuung usw. stehen als Klartext-Zahlen beieinander.
  `grips` (Griffpunkte), `vmPos`/`vmRot` (Haltung in der Egoansicht) und `hold` (Haltungstyp) steuern die Animation.
* **Klassen:** ebenfalls `src/game/weapons.js`, Abschnitt `CLASSES`.
* **Karten:** `src/world/mapdata.js`. Bausteine sind `b()` für Boxen,
  `building()` für Häuser und `rampTo()` für Rampen.
  Wichtig: Rampen immer über `rampTo()` bauen — die Funktion begrenzt die
  Steigung, sonst kommen weder Spieler noch Bots hoch.
* **Bewegungsgefühl:** `PHYS` in `src/game/actor.js` (Tempo, Schwerkraft,
  Sprungkraft, Reibung, Slide, Air-Control).
* **Trefferzonen:** `HITBOX` in `src/game/actor.js`.
* **Bot-Schwierigkeit:** `DIFFICULTY` in `src/game/bot.js`.

In der Browser-Konsole ist `__FRAGSTORM__` verfügbar, z. B.
`__FRAGSTORM__.game.player.hp = 999`.
