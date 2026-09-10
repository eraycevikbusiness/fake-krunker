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
| `F` | Tippen: schneller Nahkampfschlag (ohne Waffenwechsel) — Halten: Waffe inspizieren |
| `E` | Interaktion: Seilbahn einhängen, liegende Waffe aufheben, Bombe legen/entschärfen (halten). Ohne Interaktion: Dash (Run N Gun, Agent, Ninja; auch in der Luft) |
| `X` / mittlere Maustaste | Enterhaken (Hunter, Agent, Archer): an Wand oder Decke schießen und ranziehen, `Leertaste` löst mit Schwung |
| `4` | Luftschlag auf den Blickpunkt (Killstreak ab 7 Kills) |
| Linksklick halten | Bogen spannen, loslassen schießt; Minigun läuft an |
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

**14 Klassen** mit eigenen Werten, Waffen und Perks:
Triggerman, Hunter, Run N Gun, Spray N Pray, Detective, Bull, Vince,
Rocketeer, Agent, Commando, Ninja, Archer, Pyro, Juggernaut. Die Klasse
lässt sich auch im Match wechseln (Pause → Klasse wechseln, gilt ab dem
nächsten Spawn).

**18 Waffen:** Sturmgewehr, MP, Scharfschützengewehr (Zielfernrohr,
Durchschuss), Schrotflinte, LMG, Marksman, Feuerstoß-Gewehr, Akimbo Uzi,
Raketenwerfer, Alien Blaster, Revolver, Pistole, Kampfmesser, Katana —
dazu Splittergranaten und die vier neuen:

* **Recurve-Bogen (Archer):** Maustaste halten spannt (0,8 s), loslassen
  schießt. Der Pfeil fliegt mit Schwerkraft; Schaden und Tempo hängen von
  der Spannung ab, voll gespannt tötet ein Körpertreffer.
* **Flammenwerfer (Pyro):** Dauerfeuer als Kegel auf 11 m, Getroffene
  brennen 2,4 s nach (Brandschaden geht auf den Pyro).
* **Minigun (Juggernaut):** 0,7 s Anlaufzeit, dann 1150 Schuss/min aus
  sechs Läufen, bremst beim Laufen.
* **Wurfmesser (Sekundär bei Archer und Ninja):** 8 Messer mit Flugbahn,
  75 Schaden, Kopftreffer tötet.

Jede Waffe hat eigene Werte für Schaden, Feuerrate, Streuung, Rückstoß,
Magazin, Nachladezeit, Reichweiten-Abfall, Zoom und Trefferzonen-Multiplikatoren,
außerdem Griffpunkte und eine Haltung: Messer werden im Vorwärtsgriff
geführt, das Katana beidhändig in Kampfstellung, jede Waffe hat eigene
Schlag-, Nachlade- und Wechselanimationen.

**4 Karten** (alle punktsymmetrisch, also für beide Teams fair):

* **Sandstorm** — Wüstenstadt mit Zentral-Ziggurat, Dachlinien und Brücken
* **Burg** — Wehrgänge, vier Ecktürme, Bergfried im Hof
* **Citadel** — Industrieanlage mit Reaktor, Laufsteg-Ring und Containern
* **Hafen** — Containerhafen mit zwei Portalkränen (per Sprungpad
  erreichbar), Lagerhalle mit Fenstern, Pier über dem Wasser, Tanklager
  mit explosiven Fässern
* **Dschungel** — Fluss mit Wasserfall und Pool auf dem Plateau,
  Hängebrücken, zwei Tempelruinen mit Stufenpyramiden, Bäume als Deckung,
  Klippenplateau im Westen

**Wetter und Tageszeit** (im Spielen-Tab, pro Match): Klar, Abend, Regen
(Regenstreifen, nasse Böden, Regenrauschen), Nebel (Sicht 60 m), Nacht
(Laternen mit Punktlichtern, Mond) und Gewitternacht (Blitze mit Donner).
Definition in `src/world/weather.js`.

**Zerstörbare Objekte:** Holzkisten (70 HP) zersplittern, Glasscheiben
zerspringen beim ersten Treffer, rote Fässer explodieren und zünden
benachbarte Fässer in einer Kettenreaktion. Alles baut sich nach 30–45 s
wieder auf, sobald niemand drinsteht. Kisten und Fässer sind Deckung, bis
sie weg sind. Explosionen aus Fässern werden dem Schützen gutgeschrieben.

**Modi** (Auswahl im Spielen-Tab, das Punktelimit passt sich an):

| Modus | Regel |
|---|---|
| Team Deathmatch | Zwei Teams, Kills zählen |
| Free For All | Jeder gegen jeden, Bestenliste (Top 3 + eigener Platz) im HUD |
| Gun Game | Jeder Kill schaltet zur nächsten von 17 Waffen (Pistole bis Katana). Wer mit der letzten Waffe trifft, gewinnt; ein Messer-Kill wirft das Opfer eine Stufe zurück |
| Capture the Flag | Gegnerflagge berühren, zur eigenen Basis tragen (13 % langsamer). Fallen gelassene Flaggen kehren nach 25 s oder per Berührung zurück |
| Hardpoint | Eine Zone wandert alle 60 s. Nur ein Team in der Zone = 1 Punkt/s, beide = umkämpft |
| Infection | Alle starten als Überlebende. Nach 8 s wird einer (ab 10 Spielern zwei) zum Zombie: grün, 130 HP, schneller, Doppelsprung, Dash, nur Klauen. Wer stirbt, kommt als Zombie wieder. Zombies gewinnen, wenn alle infiziert sind, Überlebende nach 4 Minuten |
| Search & Destroy | Runden ohne Respawn, erste zu 4 Runden. Angreifer legen die Bombe bei A oder B (E 3 s halten, 35 s Zünder), Verteidiger entschärfen (E 5 s halten). Runde endet auch, wenn ein Team ausgelöscht ist oder die Zeit abläuft. Seitenwechsel zur Halbzeit, Tote schauen bis zum Rundenende zu |

Bots verstehen die Modi: In CTF greift die Hälfte an, die andere verteidigt
oder holt die eigene Flagge zurück; in Hardpoint laufen sie in die Zone und
halten sie. Flaggen und Zone erscheinen auf der Minimap.

**Enterhaken und Seilbahnen:** Hunter, Agent und Archer haben einen
Enterhaken (`X`, bis 48 m). Der Anker sitzt an Wand oder Decke, der Spieler
wird mit bis zu 31 u/s herangezogen, kann in der Luft leicht lenken und mit
`Leertaste` samt Schwung loslassen. Bots nutzen ihn, um Abstand zu schließen
oder hohe Wegpunkte zu erreichen. Auf Hafen, Citadel, Burg, Sandstorm und
Dschungel hängen Seilbahnen zwischen Dächern: am gelben Pfosten `E` drücken,
mit 19 u/s hinüberfahren, `Leertaste` springt ab. Bots fahren mit, wenn das
andere Ende näher an ihrem Ziel liegt.

**Waffen fallen lassen und aufheben:** Beim Tod bleibt die Primärwaffe mit
ihrer Munition 30 s liegen (auch mit Skin, Sticker und Aufsätzen). Wer
darauf zugeht und `E` drückt, tauscht seine Waffe im gleichen Slot dagegen
ein, die alte bleibt liegen. Bots heben Waffen auf, wenn ihre eigene leer
ist.

**Waffen-Aufsätze** (Klassen-Tab, max. zwei pro Waffe, für Primär- und
Sekundärwaffe): Schalldämpfer (leiser, kein Mündungsfeuer, Bots hören dich
kaum, −8 % Schaden), Visier (mehr Zoom, ruhiger im ADS), erweitertes
Magazin (+40 %, langsamer nachladen), Griff (−25 % Rückstoß), Laser (−35 %
Hüftstreuung, schnellerer Wechsel). Aufsätze sind als Bauteile am Modell
sichtbar, in der Skin-Vorschau ebenfalls. Bots tragen zufällige Aufsätze.
Definition in `src/game/weapons.js` unter `ATTACHMENTS`.

**Killstreaks** (abschaltbar): 3 Kills → UAV (14 s, Gegner auf der Minimap
und mit Marker durch Wände), 5 Kills → Schild (80 Punkte, absorbiert vor
der Rüstung), 7 Kills → Luftschlag: Taste `4` legt sechs Einschläge quer
zur Blickrichtung auf den anvisierten Punkt. Bots bekommen dieselben
Belohnungen.

**Team-Erkennbarkeit:** Beim Start sagt ein Toast, in welchem Team du bist,
dein Team ist in der Punkteleiste mit „DU“ markiert, das HUD hat einen
dezenten Rand in Teamfarbe, deine Arme in der Egoansicht sind in Teamfarbe
und Mitspieler tragen einen farbigen Pfeil mit Namen und Lebensbalken über
dem Kopf, der auch durch Wände sichtbar ist. Gegner sieht man auf der
Minimap nur, wenn sie gerade geschossen haben oder ein UAV läuft.

**Bots:** 1–15 Gegner in vier Schwierigkeitsgraden (Einfach bis Albtraum).
Sie unterscheiden sich in Reaktionszeit, Drehgeschwindigkeit,
Einschwingzeit, Zielfehler, Strafing, Rückstoßkontrolle, Deckungssuche,
Granatennutzung und Wahrnehmungsreichweite. Gemessene Trefferquote im
Bot-Gefecht: Einfach etwa 7 %, Normal etwa 16 %, Albtraum etwa 20 %.

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

**Warum sie keinen Aimbot haben:** Ein Bot zielt nie auf die exakte
Position. Sein Zielpunkt läuft dem Gegner hinterher (Nachziehverzögerung
70–280 ms je nach Stufe), muss nach jedem Neuerfassen erst einschwingen
(gedämpfte Feder mit begrenzter Drehgeschwindigkeit, schwingt bei schnellen
Drehungen über) und trägt einen langsam wandernden Fehler, der mit
Entfernung, Zieltempo und eigenem Tempo wächst. Der Rückstoß der eigenen
Waffe treibt den Lauf hoch und wird nur teilweise kompensiert. Geschossen
wird erst, wenn die Zielfeder ruhig ist. Kopfschüsse gibt es nur, wenn der
Bot eingeschwungen ist und das Ziel stillsteht. Das Blickfeld ist
begrenzt; hinter sich bemerkt ein Bot nur laute oder sehr nahe Gegner.

**Persönlichkeiten und Chat:** Jeder Bot bekommt einen Typ. *Rusher*
halten weniger Abstand, dashen öfter und suchen kaum Deckung. *Camper*
suchen hohe Posten mit Überblick, ducken sich dort und bleiben 12–25 s.
*Flanker* laufen seitlich versetzt Richtung Gegnerspawn und strafen mehr.
*Support* bleibt beim Team. Alle reagieren auf Teamkameraden in Not: Wer
unter 40 % Leben gerade getroffen wurde, bekommt Hilfe („halte durch,
komme!“), Support immer, andere manchmal. Im Chat unten links melden sich
Bots zum Start („gl hf“), nach Kills gegen dich („gg ez“), wenn du sie
erwischst („nice shot“, „lag!“), mit der Flagge, bei Killstreaks und als
Zombies. Abschaltbar in den Einstellungen.

Dazu kommt Taktik: Bei wenig Leben oder beim Nachladen suchen sie einen
Navigationspunkt, den der Gegner nicht sieht, und gehen dort in Deckung.
Ist ein Gegner hinter Deckung verschwunden, werfen sie eine Granate auf
die letzte bekannte Position. Sniper und Bogenschützen suchen sich hohe
Positionen und bleiben beim Schießen stehen, Nahkampf- und
Schrotflintenklassen nutzen den Dash, um den Abstand zu schließen. Der
Schwierigkeitsgrad steht im Spielen-Tab.

## Grafik

* **Eigene Post-Processing-Pipeline** (ohne Addons, `src/fx/post.js`): HDR-Rendering,
  Screen-Space Ambient Occlusion, Bloom, ACES-Tonemapping, Farbkorrektur,
  Vignette, Filmkorn, leichte chromatische Aberration und FXAA. Alles einzeln
  abschaltbar (Einstellungen → Grafik).
* **Physikalisch basierte Materialien**: Welt mit prozeduraler Grunge-Albedo,
  Normal- und Roughness-Map; Waffen und Figuren mit Metalness/Roughness/Emissive
  pro Bauteil (ein Material, ein Shader).
* **Umgebungslicht aus dem Himmel** (PMREM): Metall reflektiert die Szene,
  Schatten sind nicht mehr flach schwarz.
* **Abgeschrägte Kanten** an allen Boxen (Welt, Waffen, Figuren) fangen Licht
  ein, dazu Sonne mit Schatten, Himmel-Shader mit Sonnenscheibe und Dunst.
* Mündungslicht, HDR-Tracer, Treffer-Flash auf getroffenen Gegnern.

## Performance

* Jede Figur besteht aus nur 8 Draw-Calls (verschmolzene Geometrie, ein
  geteiltes Material, gecachte Waffen-Geometrien)
* Raycasts laufen über ein Raster (DDA) statt über alle Weltboxen
* **Auto-Auflösung:** fällt die Bildrate, wird die Renderauflösung
  stufenweise gesenkt und später wieder angehoben (abschaltbar)
* Partikel laden nur den benutzten Pufferbereich hoch, das HUD schreibt nur
  geänderte Werte ins DOM
* Schatten: Niedrig/Hoch nutzen das günstigere PCF, Ultra weiches PCF

## Skins

Im Menü unter **SKINS** hat jede Waffe sieben Varianten (Standard, Gold, Neon,
Camo, Crimson, Frost, Obsidian) mit drehbarer 3D-Vorschau. Skins tauschen die
PBR-Materialien der Bauteile (Farbe, Metalness, Roughness, Emissive) und gelten
in Ego- und Fremdansicht; Bots tragen zufällige Skins. Definitionen in
`src/game/skins.js`.

Unter der Vorschau lassen sich pro Waffe **Sticker** wählen (Totenkopf,
Flamme, Blitz, Stern, Zielscheibe, FRAGSTORM-Logo, GG EZ …). Der Aufkleber
sitzt automatisch auf der größten Seitenfläche der Waffe, links und rechts
(`src/game/stickers.js`).

## Charakter

Im Tab **CHARAKTER** wird die Spielfigur angepasst, mit drehbarer Vorschau:

* **Outfit:** zwölf Farbsets (Team, Shadow, Desert, Toxic, Royal, Arctic,
  Lava, Ocean, Gold, Camo, Candy, Neon). Im Teammodus bleiben Schulterband,
  Ärmelbund und Kopfbedeckung in Teamfarbe, damit Gegner erkennbar bleiben.
* **Kopfbedeckung:** Basecap (vorn/verkehrt), Beanie, Helm, Zylinder, Krone,
  Hörner, Cyber-Visier, Katzenohren, Heiligenschein, Bandana, Stirnband.
  Die Hüte hängen am Kopf und fallen beim Ragdoll mit.
* **Kill-Effekt:** spielt bei Gegnern, die du eliminierst: Konfetti,
  Feuerwerk, Pixel-Zerfall, Seele, Blutfontäne, Münzregen. Bei Konfetti,
  Feuerwerk und Pixel verschwindet der Körper sofort. Abschaltbar in den
  Einstellungen.
* **Kill-Icon:** Emoji im Killfeed und in der Kill-Meldung (Schädel, Feuer,
  Blitz, Krone, Geist …).

Bots bekommen zufällige Outfits, Hüte, Sticker, Effekte und Icons.
Definitionen in `src/game/cosmetics.js`.

## Training (Aim-Trainer)

Der Tab **TRAINING** startet einen Drill auf der Karte *Schießstand*: keine
Gegner, unbegrenzte Munition, die Waffen deiner Klasse.

| Drill | Ablauf | Wertung |
|---|---|---|
| Gridshot | drei Ziele gleichzeitig, 60 s | Treffer, Genauigkeit, Treffer/s |
| Flick | ein Ziel nach dem anderen, weit auseinander, 45 s | Treffer, Genauigkeit |
| Reaktion | Ziel erscheint nach zufälliger Pause, 15 Runden | Ø Reaktionszeit in ms, Fehlstarts |
| Tracking | ein bewegtes Ziel, 45 s | Anteil der Zeit mit Fadenkreuz auf dem Ziel |

Zielgröße (klein/mittel/groß) und Distanz (14/24/38 m) sind wählbar;
Bestwerte werden pro Kombination gespeichert. Zielscheiben haben eine eigene
Treffererkennung für Hitscan, Projektile und Nahkampf (`src/game/training.js`).

## Fadenkreuz, Hitsound und Zielhilfe

* **Fadenkreuz-Editor** (Einstellungen): Form (Kreuz, T, X, Kreis, Punkt,
  Kreis + Kreuz), Länge, Dicke, Abstand, Mittelpunkt, Farbe, Treffer-Farbe,
  schwarzer Rand, Deckkraft, dynamische Weitung. Die Vorschau zeigt das
  Fadenkreuz 1:1 auf einem Beispielbild, das HUD zeichnet es als Canvas
  (`src/ui/crosshair.js`).
* **Hitsound:** acht Varianten (Standard, Klick, Ping, Bass, Retro, Holz,
  Glocke, Aus) mit eigener Lautstärke und Anhören-Button. Kopfschüsse klingen
  höher, Kills bekommen einen Doppelklick.
* **Zielhilfe** (Aus / Leicht / Mittel / Stark): nahe am Gegner wird die Maus
  langsamer („Reibung“), und bei Mausbewegung zieht die Blickrichtung leicht
  zum Ziel. Ohne Mausbewegung passiert nichts, es wird nie von selbst gezielt.
  Gilt auch für Zielscheiben im Training.

## Replay

Jedes Match wird mit 20 Hz aufgezeichnet (Position, Blick, Waffe,
Schüsse, Leben aller Spieler). Auf dem Endbildschirm: **Replay ansehen**
startet die Wiedergabe mit Flugkamera (WASD + Maus, E/C hoch/runter, Shift
schnell), Leertaste pausiert, Pfeiltasten springen 5 s, Tasten 1–4 setzen
das Tempo (0,25× bis 2×), R zurück zum Anfang, Esc beendet. **Replay
speichern** lädt eine JSON-Datei herunter, **Replay laden** im Spielen-Tab
spielt sie wieder ab (Karte und Wetter stecken in der Datei). Der
Charakter-Tab spielt den gewählten Kill-Effekt direkt an der Figur ab.

## Barrierefreiheit und Touch

* **Teamfarben:** Rot/Blau, Orange/Blau, Magenta/Cyan oder Gelb/Violett.
  Die Wahl gilt für Figuren, Marker, Killfeed, Minimap und Punkteleiste
  (`src/core/teams.js`).
* **HUD-Größe:** 80–160 %.
* **Touch-Steuerung** (automatisch auf Geräten mit Touch, sonst in den
  Einstellungen einschaltbar): linker Joystick läuft (voll ausgelenkt =
  Sprint), rechte Bildschirmhälfte schaut sich um, Buttons für Feuer,
  Sprung, Zielen, Nachladen, Waffe, Ducken, Granate, E, X, F und Pause. Das
  HUD rückt dabei von den Buttons weg. Kein Pointer-Lock nötig.

## Dash und Wandlauf

* **Dash (E):** kurzer Stoß in Bewegungsrichtung (auch in der Luft), 2,4 s
  Abklingzeit, Anzeige unten rechts. Klassen: Run N Gun, Agent, Ninja.
* **Wandlauf (Agent, Ninja):** schräg gegen eine Wand springen und die
  Richtung halten. Bis 1,3 s an der Wand entlang mit reduzierter Schwerkraft,
  Kamera neigt sich von der Wand weg. Leertaste = Wandsprung (von der Wand
  weg und nach oben), Doppelsprung bleibt erhalten.

## Killcam

Beim Tod läuft ein Replay der letzten drei Sekunden aus den Augen des Killers
(inklusive dessen Schüssen und Waffe), danach friert das Bild am Todesmoment
ein und der Respawn folgt. Grundlage ist ein 60-Hz-Ringpuffer aller
Akteurzustände (`_recordHistory` in `src/game/game.js`). Abschaltbar in den
Einstellungen.

## Ragdoll und Blut

Tote fallen als Ragdoll: sieben Massepunkte (Hüfte, Hals, Kopf, Hände, Füße)
mit Abstandsbeschränkungen, Verlet-Integration und Sweep-Kollision gegen die
Welt; der Treffer gibt den Impuls (Kopfschüsse reißen den Kopf mit). Nach dem
Liegenbleiben entsteht eine Blutlache. Treffer sprühen Blut auf die Wand
dahinter und den Boden (bis zu 64 Decals, abschaltbar).

## Nahkampf

Messer und Katana werden wie in CS:GO/Valorant mit der Klinge nach oben
gehalten, mit ruhiger Idle-Bewegung, eigenen Zück-Animationen (Messer-Flip,
Katana wird gezogen), leichten Schlägen mit wechselnder Richtung (Linksklick)
und einem schweren Angriff (Rechtsklick). Beide haben Goldbeschläge und eine
leuchtende Hohlkehle (Emissive, sichtbar im Bloom). Bei einem Gegner in Reichweite macht der
Angreifer einen kurzen Ausfallschritt, Treffer stoßen das Opfer zurück und
kicken die Kamera. Nahkampfwaffen reagieren träger und stärker auf Mausbewegung
und Sprünge.

## Sound

Alle Geräusche werden synthetisiert: Schüsse aus 2-ms-Transient, kurzem
Crack, Body mit steilem Pitch-Drop, Sub und resonantem Tiefpass-Sweep durch
eine Sättigungsstufe (Waveshaper), danach Mechanik-Klicks (Repetierwaffen
mit zweitem Klick) und Nachhall über einen Hall-Bus, der mit der Entfernung
lauter wird. Jede Waffenklasse hat ein eigenes Preset (`PRESETS` in
`src/core/audio.js`). Schritte und Landungen klingen je nach Untergrund
anders (Sand, Erde, Stein, Holz, Metall, Gitter — pro Kartenbox in
`src/world/mapdata.js` über `surfaces` zugeordnet). Der Treffer-Tick hängt von
der Entfernung ab: weit weg dünner, leiser und mit kurzer Schall-Laufzeit. Schießen fühlt sich weich an: Rückstoß wird über
~50 ms verteilt, dazu ein Kamera-Kick als Feder, exakte Feuerrate
unabhängig von der Bildrate, Mündungslicht und Treffer-Flash. Jede Waffe hat ein eigenes
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
  main.js             Einstiegspunkt, Spielschleife, Zustände, Auto-Auflösung, Replay-Wiedergabe
  core/               Eingabe, Audio, Einstellungen, Mathe-Helfer, Teamfarben (teams.js), Touch-Steuerung (touch.js)
  world/
    mapdata.js        Kartendefinitionen + Rampen-Validierung, Flaggen, Hardpoints, Zerstoerbares
    weather.js        Wetter und Tageszeit (Licht, Nebel, Laternen)
    world.js          Geometrie, Kollision, Grid-Raycast, Navigation, zerstoerbare Collider
  fx/effects.js       Partikel, Tracer, Decals, Explosionen
  game/
    weapons.js        Waffen- und Klassendaten (inkl. Griffpunkte/Haltungen)
    skins.js          Waffen-Skins
    stickers.js       Waffen-Sticker (Canvas-Texturen, automatische Platzierung)
    cosmetics.js      Outfits, Kopfbedeckungen, Kill-Effekte, Kill-Icons
    training.js       Aim-Trainer (Drills, Zielscheiben, Bestwerte)
    modes.js          Capture the Flag, Hardpoint, Gun Game, Infection, Search & Destroy (Regeln, Bot-Ziele, HUD)
    actor.js          Bewegungsphysik, Trefferzonen, Waffenlogik (gemeinsame Basis)
    player.js         Lokaler Spieler, Kamera, Rückstoß, Todeskamera
    bot.js            Bot-KI
    character.js      Spielerfiguren (verschmolzene Meshes, Arm-IK)
    viewmodel.js      Waffenansicht (Haltungen, Schlaganimationen)
    game.js           Match-Logik, Kampfsystem, Projektile
  ui/                 HUD, Menü, Minimap, Fadenkreuz-Renderer, 3D-Vorschauen
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
