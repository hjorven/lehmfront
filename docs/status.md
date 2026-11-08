# Lehmfront: Stand

Jeder Thread traegt hier nach dem Merge ein, was fertig ist und was offen bleibt.

## Fertig

- P00 Grundgeruest: Ordnerstruktur, Titelbild, Schriften lokal, `js/rng.js`, `js/rules.js` mit Tests, Screenshot- und Pruefwerkzeug (`tools/shot.mjs`), CI mit Tests und Browser-Pruefung, GitHub Pages baut direkt aus `main` (Wurzel, `.nojekyll`).
- K1 Klang-Engine: `js/audio/` (Engine mit Bussen master/music/sfx/ambience, 16 prozedurale Klaenge plus Kraehen, Grillen, Tropfen, Umgebung nach Tageszeit und Wetter, karge Musik-Schicht), Demo `?scene=klang` (Tonpult mit Schreibstreifen), API siehe `js/audio/README.md`. Ueberraschung: nach einem nahen Einschlag hoert man kurz dumpf mit Ohrensausen (abschaltbar per `setOption('shellshock', false)`), und die Musik verstummt unter Beschuss und kommt danach mit einem einzelnen Ton zurueck.

- P01 Spielzustand und Rundenmotor:
  - `js/state.js` (Zustand als reines JSON, `createInitialState(map, scenario, seed)`, Helfer `groupsOf`, `getGroup`, `patchCell`, `cellKeys`, `compareId`), `js/events.js` (`makeEvent` prueft phase, type, reason, at).
  - `js/resolve.js`: `resolveTurn(state, ordersA, ordersB, seed, turn, env?)` ohne Mechanik-Code. Phasen melden sich in `js/phases/registry.js` an (`registerPhase`), die Reihenfolge aus Plan 10.6 steht dort als `ORDER.position.*` / `ORDER.battle.*` (10er-Schritte). Neue Phase: Datei in `js/phases/`, eine Import-Zeile in `js/phases/index.js`.
  - Jede Phase hat ihren eigenen Zufallsstrom (`rngForPhase(seed, turn, phaseId)`): eine neu angemeldete Phase verschiebt die Wuerfe der anderen nicht, parallele Pakete brechen sich so keine Tests.
  - `js/orders.js`: Befehlsformat `{ group, type, target? | path? }`, Befehlsarten in `js/config/orders.js`, eigene Pruefungen mit `registerOrderValidator(type, fn)`. Ungueltig wird Halten mit Ereignis `order_invalid`.
  - `js/view.js`: `viewFor(state, log, side)`, Sichtregel austauschbar mit `setVisibilityRules` (P05). Ereignisse mit `side` sieht nur diese Seite, ausser sie tragen `public: true` und der Ort ist sichtbar.
  - `js/save.js`: Export/Import als JSON-String mit Pruefstempel, Migration v1 -> v2, Ablage IndexedDB, sonst localStorage, sonst RAM.
  - Phasen `hold` (zaehlt `holdTurns`, Begruendungen werden mit der Dauer muerber) und `clock` (12 Stunden bzw. 5 Minuten, Tag/Nacht).
  - Daten: `js/config/units.js` (Release-1.0-Einheiten befuellt, spaetere mit `enabled: false`), `js/config/factions.js`, `data/names.json` mit fiktiven Heimatorten.
  - Debug-Ansicht: `?scene=debug-state&seed=42&turns=3&side=a|b|all&kind=position|battle`.
  - `test/purity.test.js` prueft alle reinen Dateien (inkl. kuenftiger `js/map.js`, `js/supply.js`, `js/phases/*`) auf Math.random, Date, DOM, transzendente Mathematik und localeCompare.
- E1 Etappenfenster als Baustein: `js/config/buildings.js` (alle Gebäude aus Plan 6 mit Ertrag, Nachbarbonus, Kosten, Bauzeit, Akt), `js/config/grounds.js`, `js/etappe.js` (Ertrag mit Nachbarboni, Bauvorschau inklusive Wirkung auf Nachbarn, Bauen, Bauzeit, Etappenstufen 1 bis 4 mit Belohnungswahl), `js/ui/etappe3d/` (drehbares Pappmodell in CSS-3D plus Bauleiste), Demo unter `?scene=etappe` (Parameter `sel`, `night`, `view`, `act`, `material`). Schnittstelle für P11: `renderEtappe(root, { fields, buildings, selected, onSelect, onBuild })`, optional `rewards`, `onChooseReward`, `onRepair`, `act`, `material`, `night`; Rückgabe `{ update, setView, getView, destroy }`.

- Z1 Papierebene: Baustein `js/ui/paper/` mit `css/paper.css`, Demo `?scene=papier`. Sieben Blattarten (Brief, Telegramm/Stabsbefehl, Tagebuch, Gefallenenliste, Zeitung, Fundstück-Foto mit Rückseite, Aktkarte), prozedurale Bilder, Kippen mit Maus und Neigungssensor, nach vorn holen, Verschieben, Wegwischen in die Ablage, getippte Telegramme mit Klang-Hooks, Zensur `[[...]]`, Tag/Nacht, reduzierte Bewegung, Tastatur. Format und Schnittstelle: `js/ui/paper/README.md`.
- P02 Lagekarte: `js/map.js` (Boden, Höhe 0..3, Zonen, Gräben mit Stufe und Feuerrichtung, Krater, Draht, Gleise, Gebäude; `loadMap`, `neighbors`, `lineCells`, `lineOfSight` mit Höhe und Wald/Dorf als Hindernis, `findPath` (A*), `cellChains`, `cellLabel`), Karte `data/maps/asse.json` 60 x 40 aus `tools/maps/asse.mjs` (Format: `data/maps/README.md`), `js/theme.js` (DAY, NIGHT, `lerpTheme`, `themeAt`, `applyTheme`, `animateDarkness`, `onThemeChange`), `js/render/geometry.js`, `js/render/map-layer.js` (statische Ebene, Path2D-Geometrie einmal je Karte, zeichnet nur nach `invalidate()`), `js/render/camera.js` (Maus, Rad, Trackpad-Pinch, Pfeiltasten, +/-, Doppelklick, Ziehen mit Nachgleiten, Zwei-Finger-Pinch, Grenzen, Bildschirm/Feld). Szene `?scene=karte` mit `&night=0..1`, `&x=&y=&zoom=`, `&ui=0`. Antippen zeigt Feldinfo, zweites Feld zeigt A*-Weg und Sichtlinie.

- T1 Texte Akt 1 und 2, Welt-Bibel:
  - Format fuer alle Spieltexte: `data/texts/README.md` (Eintraege mit `id`, `art`, `text`, Varianten ueber `slot` + `wann`, Bedingungen, Folgen, Flags, Platzhalter, Reihenfolge zwischen Missionen, Vorschlag fuer die Feldpost-Erzeugung). Platzhalter in `data/texts/placeholders.json`.
  - Welt-Bibel `data/texts/welt.md`: Orte im Lehmgau (Ostervenn, Velde, Velder Muehle, Krähenholz, Lehmkuhle, Huegel 214, Schacht Drei, Raudas), Heimatorte beider Fraktionen (jetzt auch in `data/names.json`), Heer und Dienstgrade, Stimmen aller Hauptfiguren, Nebenfiguren, Lasks Doktrinen, Zeitungen.
  - `data/texts/akt1.json`, `akt2.json`: Aktkarten, 12 Briefings (a2m5 und a2m6 mit Varianten), 12 Stabsbefehle, 10 Entscheidungen, Tagebuch je Mission mit 3 bis 4 Varianten.
  - `data/letters/briefe-akt1-2.json`: handgeschriebene Briefe 1 bis 12 (mit Varianten, wenn Harms oder Vell fallen) und 5 abgefangene Briefe von Lask mit Uebersetzungsvermerk.
  - `data/letters/templates.json`: 48 Feldpost-Vorlagen (16 je Tonlage), 43 Ereignis-Saetze in 18 Kategorien, 11 Anreden.
  - `data/texts/berichte.json`: 20 Erfahrungsberichte mit Ausloeser, Zaehler-Vorschlag und Wirkung. `data/texts/tutorial.json`: 19 Tutorial-Hinweise fuer Akt 1 als Bleistiftnotizen der Figuren.
  - `test/texts.test.js` prueft alle Text-Dateien automatisch (auch die von T2).

### Für die nächsten Pakete (P03, P10)

- Karte einbinden: `createMapLayer(canvas, map, { getCamera, getTheme })`, Kamera mit `createCamera({ bounds: sheetBounds(map) })` und `attachCameraControls(el, cam, { onChange, onTap, onHover })`. Muster: `js/scenes/karte.js`.
- Dynamische Ebene (Einheiten, Overlays) als zweites Canvas darüber, Weltkoordinaten per `applyCameraTransform(ctx, cam, dpr)`.
- Neuer Graben: Zelle in `map.cells` ändern, dann `layer.setMap(map)` (baut die Geometrie neu, etwa 5 bis 10 ms auf dem Desktop).
- Tageszeit: `applyTheme(themeAt(darkness))`; Regeln lesen dieselbe Zahl über `visibilityFromDarkness`. `theme.flare` ist ab 0,5 wahr (Leuchtkugeln zeichnet P10).

## Offen und bekannte Macken

- `data/names.json` wird per Import-Attribut (`with { type: 'json' }`) geladen: braucht Chrome 123+, Safari 17.2+, Firefox 138+. Falls aeltere Geraete wichtig werden, nur `js/config/names.js` auf fetch umstellen.
- `resolveTurn` wirft, wenn `seed` oder `turn` nicht zum Zustand passen. Die Karte (`env.map`) wird nicht kopiert: Phasen duerfen sie nur lesen, Veraenderungen gehoeren in `state.cells`.
- Geister (zuletzt gesehene Feinde) reicht `viewFor` aus `state.sides[side].intel.lastSeen` durch; befuellen muss P05.
- Gruppen-IDs sind `a01`, `b01` ... (Seite plus zwei Ziffern), sortiert wird ohne Locale.
- K1: Klaenge sind noch nirgends im Spiel eingehaengt, das macht P19 (und P03/P06/P07 duerfen `playSfx` direkt aufrufen). Lautstaerke-Regler gehoeren spaeter in die Einstellungen aus P18 (`setVolume`, Werte werden schon in localStorage gespeichert).
- K1: In Safari auf iOS vor 16.4 bleibt der Klang stumm, wenn der Stummschalter am Geraet aktiv ist (ab 16.4 setzt die Engine `navigator.audioSession.type = 'playback'`).
- Z1: Die Blätter haben ein eigenes Datenformat (`js/ui/paper/README.md`); T1 kam erst während Z1 auf `main`. P15 setzt Texte aus `data/texts/` in dieses Format um.
- Z1: Zeitung nutzt die Systemschrift Georgia/Times (keine Fraktur, keine neue Schriftdatei). Den Neigungssensor kann der Container nicht prüfen; abgesichert sind nur die Rechenfunktionen (Tests), nicht das Verhalten auf echten Geräten.
- P02: In der Mitte des Übergangs (darkness etwa 0,45 bis 0,7) sind die Kartensignaturen (Blau, Rot, Draht, Wald) auf dem mittelbraunen Papier schwächer (bis 1,4 : 1). Tinte auf Papier und Schrift auf Kärtchen bleiben über 3 : 1 (Test), Kärtchen springen dazu mit der Tinte von hell nach dunkel.
- P02: Doppelklick zum Zoomen zählt in der Szene `karte` auch als zwei Antipp-Vorgänge (Weg/Sicht-Anzeige wird dabei zurückgesetzt). Nur Demo-Szene; P03 sollte Antippen mit kurzer Verzögerung von Doppelklick trennen.
- P02: Szenen haben noch kein Abmelden: Kamera-Listener, ResizeObserver und `onThemeChange` bleiben bestehen. Harmlos, solange `main.js` Szenen nicht wechselt.
- P02: Diagonale Grabenstücke werden als schräge Rechteckwelle gezeichnet; das sieht etwas unruhiger aus als gerade Abschnitte.
- E1: Einhängen in Spielzustand und Runden fehlt noch (P11). Beschuss und Aufklärbarkeit sind nur als Feld `damaged` vorbereitet; Reparatur gibt es schon (`repairBuilding`).
- E1: Kosten und Bauzeiten außer Feldküche, Ruhelager, Sägewerk und Fernmeldestelle (aus dem Mockup) sind geschätzt, Balancing in P21.
- E1: Feldpost "alle 5 Runden" ist nur als `periodic` ausgewiesen; wann sie fällig ist (Bezug auf Runde oder Fertigstellung), legt P11 fest.
- E1: Erreichte Belohnungsstufen hängen an der aktuellen Leistung; fällt sie vor der Wahl unter die Schwelle (Beschuss), verschwindet das Angebot wieder. P11 kann die höchste erreichte Stufe im Spielzustand merken.
- E1: Figuren laufen auf gerader Linie zwischen Nachbargebäuden und gehen dabei sichtbar "durch die Tür" in den Kasten; auf Hängen schweben sie leicht.

- T1: Die Zaehler der Erfahrungsberichte (`zaehler.ereignis`) sind Vorschlaege; P14 muss sie auf die echten Ereignistypen aus dem Protokoll abbilden. Die Statistiken fuer `wann.werte` (README) muss P07/P14 aus dem Protokoll zaehlen.
- T1: Flags `harms_gefallen`, `vell_gefallen`, `trichter_gehalten` setzt die Mission (P16 bzw. Akt-2-Paket), nicht eine Entscheidung.

## Freigaben und Entscheidungen von Jorven

Stand 2026-11-08, von Jorven bestaetigt:

- Threads duerfen selbst nach `main` mergen und Einstellungen aendern, soweit GitHub es zulaesst.
- Umfang: **alle Stufen und alle Akte** (Release 1.0 bis 1.5, Akte 1 bis 4). Fertig ist das Spiel erst mit P27.
- Supabase: ein Thread darf ein Projekt fuer Lehmfront anlegen und Tabellen sowie Edge Functions deployen (Paket P20). Hinweis: Jorvens Supabase-Organisation hat schon zwei aktive Gratis-Projekte; braucht ein neues Projekt eine Bezahl-Bestaetigung, muss der Thread Jorven fragen und solange offline weiterarbeiten.
- Threads duerfen vom Plan abweichen, wenn es das Spiel besser oder ueberraschender macht. Begruendung hier unter "Abweichungen vom Plan".
- Klang wird prozedural erzeugt (WebAudio).
- Alle Spieltexte schreiben Claude-Threads selbst, gebuendelt in den Text-Threads T1 und T2.
- Bis zu 15 Threads gleichzeitig.

## Abweichungen vom Plan

- Z1: Weggewischte Blätter verschwinden nicht, sie landen in einer Ablage unten links und lassen sich zurückholen. Fotos haben eine beschriftete Rückseite (Antippen des vorderen Blattes dreht um). Feldpost kann zensiert sein.

- Pages baut direkt aus `main` statt ueber einen eigenen Deploy-Job (war im Repo schon so eingestellt).
- P01: Konfiguration liegt in `js/config/*.js` (units, factions, orders, names) statt in einer `js/config.js` (Plan 10.3), damit parallele Pakete nicht dieselbe Datei aendern.
- P01: Zufall pro Phase statt ein Strom pro Runde (Plan 10.6). Weiterhin aus Seed und Runde abgeleitet und einzeln nachrechenbar, aber robust gegen neue Phasen.
- P01: Ein Gruppenfuehrer bekommt moeglichst einen auf seiner Seite einmaligen Nachnamen, und die Nachnamen der Hauptfiguren (Brandt, Harms, Vell, Lask) werden nicht zufaellig vergeben. Meldungen sagen "Gruppe Lohmann", das soll eindeutig sein.
- P02, Tinte beim Tag-Nacht-Übergang: Plan 7.7 lässt Tinte und Signaturfarben zwischen darkness 0,45 und 0,7 linear wandern. Nachgemessen fällt dabei der Kontrast Tinte auf Papier bis 1,1 : 1. Jetzt springt jede Farbe innerhalb dieses Fensters an ihrem eigenen Kreuzungspunkt (dort, wo die Nachtfarbe auf dem dann gültigen Papier besser lesbar ist). Tinte bleibt damit immer über 3 : 1, im Übergang wirkt es wie Tinte, die aufleuchtet.
- P02, Kartenblatt: Die Karte liegt als Papierblatt mit Rand auf einem Tisch: Spalten- und Zeilennummern am Rand (passend zu Meldungen wie „Feld 31/9"), Titel, Maßstab, Nordpfeil. Das war im Plan nicht vorgesehen, macht Feldangaben im Protokoll aber auffindbar.
- T1: Die Heimatorte in `data/names.json` wurden durch die der Welt-Bibel ersetzt, damit Briefe und Gefallenenliste dieselben Orte nennen.
- T1: Tutorial-Hinweise sind Bleistiftnotizen von Harms, Lohmann, Fedders und Selin am Kartenrand statt neutraler Hinweisfenster (Feld `von`).
- E1: "Angrenzend" heißt nur die vier Felder mit gemeinsamer Kante, keine Diagonalen (klarer lesbar im Modell).
- E1: Depot braucht ein angrenzendes Gleis oder einen Feldbahnhof, sonst kommen keine Loren weg. Ein stillstehender Bahnhof gibt keinen Nachbarbonus.
- E1: Die Etappenstufe zählt nur die Loren aus eigenen Gebäuden; Loren aus Belohnungen (Zweite Gleisstrecke) heben die Stufe nicht selbst an.
- E1: Reparatur kostet die halbe Baukosten (aufgerundet) und eine Stellungsrunde (`repairBuilding`).
- E1: Feldbahnhof braucht ein angrenzendes Gleis, sonst bringt er keine Loren; Gleis ist ein baubares Gebäude statt eines Bodens. So zeigt die Vorschau eines Gleisstücks, dass ein Bahnhof anfängt zu fahren.
- E1: Verbandsplatz/Feldlazarett, Ziegelei/Betonmischer und Kapelle/Gedenkstätte sind jeweils zwei Gebäude statt einer Zeile im Plan.
- E1: Etappenstufen: Stufe 2 ab 5 Loren, Stufe 3 ab 8, Stufe 4 ab 12. Stufe 4 bietet zusätzlich Pionierpark (Bauzeit −1) oder Materialzug (+3 Material).
- E1: Ist die Modellbühne hochkant (schmale Fenster), steht das Brett längs gedreht, damit die Felder groß genug zum Antippen sind.
