# Lehmfront: Arbeitspakete

Stand: 2026-11-08 (Umfang: alle Stufen und Akte, bis 15 Threads parallel). Grundlage: `docs/plan.md` (Plan v2.1) und das Mockup in `docs/mockup/`.

Jedes Paket ist ein eigener Thread. Der Prompt unter jedem Paket ist so geschrieben, dass er allein reicht. Die Arbeitsregeln (Tests, Screenshots, Review mit frischem Blick, Merge) stehen in `CLAUDE.md` und gelten fuer alle Pakete.

## Uebersicht und Reihenfolge

| Welle | Paket | Inhalt | Haengt ab von | Parallel moeglich mit |
|---|---|---|---|---|
| 0 | P00 | Grundgeruest, CI, Pages (erledigt) | - | - |
| 1 | T1, T2, K1, Z1, E1 | Texte, Klang, Papierebene, Etappenmodell als eigenstaendige Bausteine | P00 | alle |
| 1 | P01 | Spielzustand, Rundenmotor, Phasen-Register, Speichern | P00 | P02 |
| 1 | P02 | Lagekarte: Kartenmodell, Renderer, Kamera, Tag/Nacht-Thema | P00 | P01 |
| 2 | P03 | Gefechtsbildschirm: Kaertchen, Schild, Werkzeugreihe, Befehle, Commit | P01, P02 | - |
| 3 | P04 | Graben: zeichnen, ausheben, Stufen, Feuerrichtung, Traversen | P03 | P05, P07, P08 |
| 3 | P05 | Feuer, Sicht, Unterdrueckung, MG-Kegel, Nebel des Krieges | P03 | P04, P07, P08 |
| 3 | P07 | Phasenfilm und Telegramm mit Begruendungen | P03 | P04, P05, P08 |
| 3 | P08 | Versorgung: Depot, Feldbahn, Lorenplan als Zug, Sanitaetskette | P03 | P04, P05, P07 |
| 4 | P06 | Gefechtsrunde: Sturm, Draht, Unterstaende, Nahkampf, Uhr | P04, P05 | P09, P10, P11 |
| 4 | P09 | Artillerie: Feuerplan-Editor, Feuerwalze, Beobachter, Leitungen | P05 | P06, P10, P11 |
| 4 | P10 | Wetter, Schlamm, Krater, Tag-Nacht-Uebergang, Leuchtkugeln | P02, P05 | P06, P09, P11 |
| 4 | P11 | Etappe einhaengen: Gebaeude, Nachbarboni, Etappenstufen, 3D-Etappenfenster | P08, E1 | P06, P09, P10 |
| 5 | P12 | Moral, Erschoepfung, Abloesung, Ersatz | P06, P08 | P13 |
| 5 | P13 | KI-Kommandant, Taktik-Lehrling, Headless-Simulator | P06, P09 | P12 |
| 6 | P14 | Kampagnenrahmen: Feldzugskarte, Ansehen, Vertrauen, Stabsbefehle, Erfahrungsberichte | P12 | P15, P17 |
| 6 | P15 | Papierebene und Erzaehlung einhaengen: Briefe, Feldpost, Tagebuch, Gefallenenliste | P07, Z1, T1 | P14, P17 |
| 6 | P17 | Modi: Gefecht frei, Zufallskarten, Hotseat, Tageslage (lokal) | P13 | P14, P15 |
| 7 | P16 | Akt 1: sechs Missionen mit integriertem Tutorial | P14, P15 | P18, P19 |
| 7 | P18 | Offline-Spiel: Service Worker, Spielstaende, Einstellungen, Barrierefreiheit | P17 | P16, P19 |
| 7 | P19 | Klang einhaengen und Feinschliff | P07, K1 | P16, P18 |
| 8 | P20 | Online mit Supabase: Cloud-Spielstand, Bestenliste, asynchrone Gefechte, Replay-Link | P17, P18, Freigabe Supabase | P21 |
| 8 | P21 | Release 1.0: Gesamtreview, Balancing-Turnier, Handy-Performance | P16 bis P19 | P20 |
| 9 | P22 | 1.1: Endlosmodus "Frontabschnitt", Wochenlage | P21 | P23 |
| 9 | P23 | 1.2 Akt 2: Sappen, Stollen, Stosstrupps, Offiziere, Veteranen, Doktrinen | P21 | P22 |
| 10 | P24 | 1.3 Akt 3: Gas, Waffenruhe, Feldgeschuetz, Flammenwerfer, Flugzeug | P23 | P25 |
| 10 | P25 | 1.5: Missionseditor, Sandbox, Puzzle-Lagen, Koop | P21 | P24 |
| 11 | P26 | 1.4 Akt 4: Verweigerung, Panzerwagen, Mine, vier Enden | P24 | - |
| 11 | P27 | Abschluss: Gesamtreview des fertigen Spiels | alle | - |

Bis zu 15 Threads gleichzeitig (Freigabe Jorven). Ein Paket startet, sobald seine Abhaengigkeiten auf `main` gemerged sind. Damit gleich zu Beginn mehr parallel laufen kann, gibt es Pakete ohne Code-Abhaengigkeit (T1, T2, K1, Z1, E1); sie bauen eigenstaendige Bausteine mit eigener Demo-Szene, die spaetere Pakete nur noch einhaengen.

### Welle 1 (sofort, alle parallel)

| Paket | Inhalt | Beruehrt |
|---|---|---|
| P01 | Spielzustand, Rundenmotor, Phasen-Register, Speichern | `js/state.js`, `js/resolve.js`, `js/orders.js`, `js/view.js`, `js/save.js`, `js/phases/`, `js/config/units.js`, `js/config/factions.js`, `data/names.json` |
| P02 | Lagekarte, Kamera, Tag/Nacht-Thema | `js/map.js`, `js/theme.js`, `js/render/`, `data/maps/asse.json` |
| T1 | Texte Akt 1 und 2, Welt-Bibel | `data/texts/`, `data/letters/` (Akt 1, 2) |
| T2 | Texte Akt 3 und 4, Endlosmodus, Zeitungen, Fundstuecke | `data/texts/`, `data/letters/` (Akt 3, 4) |
| K1 | Klang-Engine prozedural | `js/audio/`, `js/scenes/klang.js` |
| Z1 | Papierebene als Baustein | `js/ui/paper/`, `css/paper.css`, `js/scenes/papier.js` |
| E1 | Etappenfenster-Modell als Baustein | `js/config/buildings.js`, `js/ui/etappe3d/`, `js/scenes/etappe.js` |

Gemeinsame Dateien (`index.html`, `css/style.css`, `js/main.js`) moeglichst nicht anfassen; eigene CSS-Dateien laedt die Szene selbst.

---

## T1 Texte Akt 1 und 2, Welt-Bibel

```
Repo hjorven/lehmfront. Lies CLAUDE.md und docs/plan.md Abschnitte 2 (Welt und Lore), 8.1 (Akt 1 und 2), 8.2, 4.3, 7.8 (Stile 03, 06, 10).

Du bist der zentrale Text-Thread fuer Akt 1 und 2. Schreibe alle Spieltexte als Daten, nicht als Code:
- data/texts/README.md: Datenformat fuer alle Texte (IDs, Platzhalter wie {gruppenfuehrer}, {heimatort}, {ereignis}, Tonlage zuversichtlich|erschoepft|verbittert, Bedingungen). Stimme das Format so ab, dass T2 und P15 es ohne Rueckfrage nutzen koennen.
- data/texts/welt.md: Welt-Bibel (Orte im Lehmgau, Heimatorte beider Fraktionen, Einheitenbezeichnungen, Stimme jeder Hauptfigur mit Beispielsaetzen). T2 baut darauf auf, schreib sie zuerst und merge sie frueh.
- Akt 1 und 2: je 6 Missionsbriefings, Stabsbefehle (Telegrammstil mit STOP), Entscheidungen mit Folgen fuer Ansehen und Vertrauen, Brandts Tagebucheintraege (je Mission mindestens zwei Varianten nach Verlauf), handgeschriebene Briefe (Anteil Akt 1 und 2 der 24), Lasks abgefangene Briefe.
- data/letters/templates.json: Vorlagen fuer generierte Feldpost, mindestens 40, in drei Tonlagen.
- Erfahrungsberichte (etwa 20) als Text mit Ausloeser-Beschreibung.
- Tutorial-Hinweise fuer Akt 1 (kurz, im Spiel eingebettet, nichts doppelt erklaeren).
Ton: ernst, menschlich, nichts Verherrlichendes, keine realen Laender oder Personen, echte Umlaute.
Pruefe mit einem Test (test/texts.test.js), dass alle JSON-Dateien gueltig sind, alle Platzhalter bekannt sind und keine ID doppelt ist.
Danach Review mit frischem Blick (ein Subagent liest die Texte auf Ton, Widersprueche zur Welt-Bibel und Tippfehler), PR, CI gruen, mergen, docs/status.md.
```

## T2 Texte Akt 3 und 4, Endlosmodus, Zeitungen, Fundstuecke

```
Repo hjorven/lehmfront. Lies CLAUDE.md, docs/plan.md Abschnitte 2, 8.1 (Akt 3 und 4), 8.3, 2.6 (vier Enden), 7.8 (Stile 08, 10). Warte, bis data/texts/README.md und data/texts/welt.md von T1 auf main sind (git fetch origin main), und halte dich an deren Format und Welt. Bis dahin kannst du an Entwuerfen arbeiten.

Schreibe als Daten unter data/texts/ und data/letters/:
- Akt 3 und 4: je 6 Missionsbriefings, Stabsbefehle, Entscheidungen (Waffenruhe, Befehl umdeuten oder verweigern, Verweigerung der Truppe), Tagebuch, Briefe (Rest der 24), Lasks Briefe.
- Die vier Enden aus Plan 2.6 als ausfuehrliche Schlusssequenzen.
- Zeitungs-Zwischentexte ("Was die Zeitungen schreiben") zwischen allen Akten, beide Fraktionen, mit Propaganda-Kontrast zur Front.
- 24 Fundstuecke (Fotos, Feldpostkarten, Karten) mit kurzer Nebengeschichte.
- Endlosmodus: Vorlagen fuer generierte Stabsbefehle pro Woche, Jahreszeit-Texte.
- 40 Erfolge mit Titel und Beschreibung (ohne Orden-Zaehlerei, Plan 13).
Erweitere test/texts.test.js um deine Dateien. Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## K1 Klang-Engine prozedural

```
Repo hjorven/lehmfront. Lies CLAUDE.md und docs/plan.md 7.1, 7.7, 13. Klang wird komplett prozedural mit WebAudio erzeugt (Freigabe Jorven), keine Aufnahmen.

Baue js/audio/ als eigenstaendigen Baustein:
- engine.js: AudioContext erst nach erster Nutzerinteraktion, Master-, Musik-, Effekt- und Umgebungsbus, Lautstaerke, Stummschalten, reduzierte Lautstaerke im Hintergrund-Tab.
- Klaenge als Funktionen: Papier rascheln, Bleistift kratzen, Stempel, Fernschreiber-Tippen, Uhr ticken und einrasten, ferne Artillerie, naher Einschlag, MG-Salve in der Ferne, Gewehrschuss, Pfeife zum Sturm, Leuchtkugel, Regen, Wind, Lore auf Schienen, Schlamm-Schritte.
- Umgebung je nach Tageszeit (darkness 0..1) und Wetter, sanft ueberblendet.
- Eine leise, karge Musik-Schicht (prozedural, zurueckhaltend, kein Heldenpathos).
- API: playSfx(name, { x, pan, intensity }), setAmbience({ darkness, rain, wind, battle }), setVolume(bus, v).
- js/scenes/klang.js: Demo-Szene mit Knoepfen fuer jeden Klang und Reglern fuer Tageszeit und Wetter.
Tests fuer die reine Logik (z. B. Ueberblend-Kurven, Parameter-Mapping) mit node --test, ohne AudioContext.
Screenshot der Demo-Szene, Review mit frischem Blick (auch: keine Klicks und Knackser, keine Endlosschleifen ohne Stop), PR, CI gruen, mergen, docs/status.md.
```

## Z1 Papierebene als Baustein

```
Repo hjorven/lehmfront. Lies CLAUDE.md, docs/plan.md 2.5, 7.5 (Papierebene), 7.7 (Gedrucktes immer Stil 03), 7.8, Bilder docs/bilder/feature-10-papierebene.png, stil-03-feldtelegramm.png, stil-06-aquarell.png, stil-10-zeitungsdruck.png, stil-08-linolschnitt.png, und den Mockup-Teil __f10 in docs/mockup/template.html.

Baue js/ui/paper/ als eigenstaendigen Baustein (DOM + CSS, eigene css/paper.css):
- Blattarten: Brief (Handschrift Caveat auf Briefpapier), Telegramm/Stabsbefehl (Stil 03 mit Stempel EILT, Formularfeldern), Tagebuchseite (Aquarell, Stil 06), Gefallenenliste (Schreibmaschine, Formular), Zeitung (Stil 10), Fundstueck-Foto, Aktkarte (Linolschnitt, Stil 08).
- Blaetter liegen ueber der Karte, kippen mit der Maus/dem Neigungssensor, kommen beim Antippen nach vorn, lassen sich wegwischen und stapeln.
- Telegramme koennen Zeile fuer Zeile "getippt" erscheinen (Hook fuer K1-Klang, optional).
- Inhalt kommt als Daten (Format aus data/texts/README.md von T1, falls schon auf main, sonst eigenes einfaches Format, das du dokumentierst).
- js/scenes/papier.js: Demo mit allen Blattarten, hell und dunkel, Desktop und Handy.
- Reduzierte Bewegung respektieren (prefers-reduced-motion).
Screenshots aller Blattarten, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## E1 Etappenfenster-Modell als Baustein

```
Repo hjorven/lehmfront. Lies CLAUDE.md, docs/plan.md Abschnitt 6 komplett, Bilder docs/bilder/feature-01-etappe-3d.png und etappe-3d.gif, Mockup-Teil __f1 in docs/mockup/template.html.

Baue:
- js/config/buildings.js: alle Gebaeude aus Plan 6 (Wirkung, Nachbarbonus, Kosten, Bauzeit, ab welcher Stufe/Akt), reine Daten.
- js/etappe.js (rein, testbar): Ertragsvorschau pro Feld inklusive Nachbarboni, Etappenstufen und Belohnungswahl. Tests.
- js/ui/etappe3d/: das drehbare Pappmodell der Etappe (CSS-3D oder Canvas, kein Framework): Ziehen dreht und kippt, Doppelklick setzt zurueck, Felder antippbar, Gebaeude als Pappkaesten, Gleise, Wald, Boden. Rechts bzw. auf dem Handy unten die Bauoptionen mit Ertragsvorschau.
- js/scenes/etappe.js: Demo mit einer Beispiel-Etappe.
Das Einhaengen in Spielzustand und Runden macht spaeter P11. Halte die Schnittstelle klein: renderEtappe(root, { fields, buildings, selected, onSelect, onBuild }).
Ueberraschung: z. B. Rauch aus der Feldkueche, kleine Figuren, die zwischen Gebaeuden laufen.
Screenshots Desktop und Handy, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

---

## P01 Spielzustand, Rundenmotor, Phasen-Register, Speichern

```
Repo hjorven/lehmfront. Lies zuerst CLAUDE.md, dann docs/plan.md Abschnitte 3.3, 3.4, 5, 10.3 bis 10.8.

Ziel: das Rueckgrat, auf dem alle Mechaniken aufsetzen, ohne dass parallele Threads dieselben Dateien umschreiben muessen.

Baue:
- js/state.js: Spielzustand als reines JSON (Karte-Referenz, Seiten a/b, Gruppen mit Staerke, Erfahrung, Erschoepfung, Moral, Gruppenfuehrer mit Name und Heimatort, Position, Feldzustand, Runde, turnKind position|battle, night, Wetter, Vorraete). createInitialState(map, scenario, seed).
- js/config/units.js, js/config/factions.js, data/names.json (Plan 2.2, 2.3, 5). Nur Release-1.0-Einheiten befuellen, die anderen als Daten vorbereitet.
- js/resolve.js: resolveTurn(state, ordersA, ordersB, seed, turn) -> { state, log, finished }. Kein Mechanik-Code darin, nur ein Phasen-Register: Module unter js/phases/ melden sich mit { id, kind: 'position'|'battle'|'both', order, run(ctx) } an. Vorgegebene Reihenfolge aus Plan 10.6 als order-Zahlen dokumentieren. Zustand wird nie mutiert, sondern kopiert (structuredClone ist ok).
- Ereignisprotokoll mit Pflichtfeldern phase, type, reason (deutsch), at {x,y} und Hilfsfunktion zum Anlegen.
- js/orders.js: Befehlsformat, Validierung, Standardbefehl Halten, Sortierung nach Gruppen-ID.
- js/view.js: viewFor(state, log, side) als einfache erste Fassung (eigene Einheiten voll, fremde nur wenn sichtbar; Sichtregel kommt aus P05, hier ein austauschbarer Haken).
- js/save.js: Speichern mit version-Feld und Migrationskette v1 -> v2 (Plan 10.8), lokal in IndexedDB mit Fallback localStorage. Export/Import als JSON-String.
- Eine Beispiel-Phase js/phases/hold.js, damit der Ablauf getestet ist.
- Tests: Determinismus (gleicher Zustand, gleiche Befehle, gleicher Seed zweimal -> tief gleich), Reihenfolge der Phasen, Zustand wird nicht mutiert, Migration v1->v2, ungueltige Befehle werden zu Halten mit reason.

Keine UI in diesem Paket ausser einer Debug-Ansicht unter ?scene=debug-state, die den Zustand als Text zeigt (fuer den Screenshot-Check).
Danach: Review mit frischem Blick laut CLAUDE.md, PR, CI gruen, selbst mergen, docs/status.md aktualisieren.
```

## P02 Lagekarte: Kartenmodell, Renderer, Kamera, Tag/Nacht-Thema

```
Repo hjorven/lehmfront. Lies zuerst CLAUDE.md, dann docs/plan.md Abschnitte 3.2, 7.1, 7.7, 7.8, 10.1 und Anhang A. Sieh dir docs/bilder/stil-01-generalstabskarte.png, stil-04-nacht.png, uebersicht-tagnacht.png an und lies docs/mockup/template.html (drawMap, crenel, zagH, THEMES, lerpTheme, applyDayNight).

Ziel: die Lagekarte als Spielfeld, so schoen wie im Mockup, aber aus echten Kartendaten.

Baue:
- js/map.js (rein): Raster aus Feldern mit Boden (Lehm, Kreide, Fels, Sumpf, Wald, Dorf, Wasser), Hoehe 0..3, Zone (Etappe, Stellung, Niemandsland), Grabenfeld mit Stufe und Feuerrichtung, Krater, Draht, Gleis. Laden aus JSON, Nachbarn, Bresenham-Sichtlinie mit Hoehe, A* fuer Wege. Tests.
- data/maps/asse.json: erste Karte 60 x 40 nach dem Vorbild des Mockups (Fluss Asse links, Etappe hinten, eigene und feindliche Linie, Niemandsland, Wald, Huegel 214).
- js/theme.js: DAY und NIGHT als Objekte mit gleichen Schluesseln, lerpTheme, applyTheme (CSS-Variablen + Canvas-Thema), Regeln aus Plan 7.7 (spaetes Umspringen der Tinte, Daemmerungsschimmer). Hier darf Math.sin verwendet werden, weil es nur Optik ist.
- js/render/map-layer.js: statische Ebene (Papier, Hoehenlinien aus den Hoehendaten, Signaturen Wald/Sumpf/Dorf, Graeben als Rechteckwelle, Laufgraeben Zickzack, Draht, Gleise, Gebaeudekaesten), nur bei Aenderung neu zeichnen, deterministisches Bleistiftzittern.
- js/render/camera.js: Zoom und Verschieben mit Maus, Rad, Pfeiltasten, Ziehen, Pinch; Grenzen; Bildschirm <-> Feld.
- ?scene=karte zeigt die Karte bildschirmfuellend, ?night=0..1 setzt darkness fuer Screenshots.

Ueberraschung (Vorschlag, gern besser): Kaffeerand oder Knickfalten im Papier, die sich je Mission unterscheiden; Bleistiftnotizen am Rand.
Pruefe mit Screenshots Tag, Daemmerung, Nacht, Desktop und Handy gegen die Mockup-Bilder. Danach Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P03 Gefechtsbildschirm: Kaertchen, Schild, Werkzeugreihe, Befehle, Commit

```
Repo hjorven/lehmfront. Voraussetzung: P01 und P02 sind auf main. Lies CLAUDE.md, docs/plan.md 3.4, 7.2, 7.3, 7.6, die Bilder feature-08-radialmenue.png, feature-09-halten.png, stil-01-generalstabskarte.png, stil-07-hud.png und die passenden Teile in docs/mockup/template.html.

Ziel: Ein spielbarer Rahmen: Gefecht laden, Gruppen waehlen, Befehle geben, Runde ausfuehren.

Baue:
- js/ui/ mit: Kopf-Kaertchen (Loren, Munition, Material, Moral, Ansehen/Vertrauen, Runde, Tageszeit, Wetter), Hinweis-Kaertchen, Schild am gewaehlten Objekt, Werkzeugreihe unten, Befehlsliste (Tab), Rundenende-Checkliste, Overlays-Schalter (1 bis 4, Inhalte kommen spaeter).
- Werkzeug-Register: Mechanik-Pakete melden ihre Werkzeuge an ({ id, key, label, icon, canUse(group, state), begin(ctx) }). Hier nur Bewegen und Halten.
- Radiales Befehlsmenue bei langem Druck (Touch und Maus), Zielwahl direkt danach.
- Undo (Strg+Z) und Befehle frei aenderbar bis zum Commit.
- "Runde ausfuehren" mit Zusammenfassung; ist ein Sturm dabei, muss der Knopf gehalten werden (Ring fuellt sich).
- Hotseat-faehig vorbereiten: Befehle pro Seite sammeln, Uebergabebildschirm als Platzhalter.
- Handy: Kaertchen klappen zu einer Leiste zusammen, Seitenleiste wie Stil 07 fuer Hochkant.
- Tastatur laut Plan 7.6. Fokusreihenfolge und sichtbarer Fokus.
- Hauptmenue: "Gefecht frei" startet vorerst die Testkarte asse.json mit 3 gegen 3 Gruppen und einer Dummy-KI (haelt).

Ueberraschung: z. B. der Bleistift zeichnet den Befehlspfeil sichtbar nach, mit leichtem Kratzgeraeusch-Platzhalter.
Screenshots Desktop und Handy, hell und Nacht. Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P04 Graben: zeichnen, ausheben, Stufen, Feuerrichtung, Traversen

```
Repo hjorven/lehmfront. Voraussetzung: P03 auf main. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 1 bis 3, 7.4 (Graben zeichnen), Bild feature-03-graben-zeichnen.png, Mockup-Teil __f3.

Baue als js/phases/dig.js, js/phases/rebuild.js und Werkzeuge Graben (G) und Umbauen (U):
- Graben mit Finger/Maus als Linie zeichnen, in Felder zerlegen, Dauer in Stellungsrunden zeigen (Boden, Pioniere doppelt, Wetter, Erschoepfung, Vertrauen als Faktoren aus Hooks, die spaetere Pakete fuellen).
- Grabenstufen Schuetzenloch, Schuetzengraben, ausgebaut, betoniert; Feuerrichtung pro Feld; eroberter Graben halbe Deckung bis Umbauen (eine Stellungsrunde je drei Felder).
- Laengsfeuer-Analyse: gerade Abschnitte erkennen, Warnung, "Traversen einfuegen".
- Laufgraeben als Verbindung.
- Tests fuer Grabgeschwindigkeit, Zerlegung, Laengsfeuer-Erkennung, Umbauen.

Ueberraschung: z. B. der ausgehobene Lehm wird als Aufwurf neben dem Graben sichtbar und verraet dem Gegner frische Arbeiten.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P05 Feuer, Sicht, Unterdrueckung, MG-Kegel, Nebel des Krieges

```
Repo hjorven/lehmfront. Voraussetzung: P03 auf main. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 5 und 7, 7.4 (Sichtlinien, Bedrohung), 10.5, 10.6, Bild feature-07-bedrohung.png.

Baue:
- js/phases/fire.js auf Basis von js/rules.js (hitChance, resolveFire existieren schon): Feuer nach Bewegung, Unterdrueckung pro Waffe, Begruendungen.
- Sicht mit Hoehe und darkness (visibilityFromDarkness), Sichtlinien beim Zeigen, Werkzeug Feuern (F).
- MG-Trupps mit Feuersektor als Kegel auf der Karte.
- view.js vervollstaendigen: Nebel des Krieges, Geister mit Alter in Runden.
- Bedrohungs-Overlay (Taste 2): bekannte MG-Kegel, zuletzt gesehene Bewegung, verblasst pro Runde.
- Vorschau vor dem Befehl: Trefferchance, Deckung, erwartete Verluste.
- Tests: Sicht ueber Hoehe, Nacht, Geisteralter, Unterdrueckung.

Ueberraschung: z. B. Geister sind mit Bleistift skizziert und werden pro Runde blasser, als wuerde jemand radieren.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P06 Gefechtsrunde: Sturm, Draht, Unterstaende, Nahkampf, Uhr

```
Repo hjorven/lehmfront. Voraussetzung: P04 und P05 auf main. Lies CLAUDE.md, docs/plan.md 3.3, 4.1 Nr. 4 und 9, 7.5 (Uhr), Bild feature-05-uhr.png.

Baue:
- Wechsel Stellungsrunde -> Gefechtsrunde, sobald ein Angriff angesetzt ist; Ende bei Angriff steckt, Ziel genommen oder nach 12 Gefechtsrunden.
- js/phases/dugout.js: Gruppen unter Beschuss gehen in den Unterstand, Herauskommen dauert eine Runde (Wettlauf zum Grabenrand).
- js/phases/move.js mit Draht (verlangsamt), Werkzeug Draht (D) zum Verlegen in Stellungsrunden.
- js/phases/melee.js: Nahkampf Feld fuer Feld, Einbruch, Gegenstoss-Befehle fuer den Verteidiger.
- Werkzeug Sturm mit Pfad, Hold-to-confirm aus P03.
- Eine Uhr: Tag-Nacht-Scheibe wird beim Angriff zur Stoppuhr in Fuenf-Minuten-Schritten.
- Tests: Unterstand-Timing, Draht, Nahkampf deterministisch.

Ueberraschung: z. B. beim Umschalten auf Gefechtsrunde rastet die Uhr hoerbar ein und das Papier ruckt leicht.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P07 Phasenfilm und Telegramm mit Begruendungen

```
Repo hjorven/lehmfront. Voraussetzung: P03 auf main. Lies CLAUDE.md, docs/plan.md 3.4 Punkt 4 und 5, 7.5, 7.7 (Uebergang am Ende des Films), Bilder feature-02-rundenfilm.png, stil-03-feldtelegramm.png.

Baue:
- Phasenfilm: Runde laeuft in Phasen ab (aus dem Ereignisprotokoll), "Weiter" pro Phase, Ueberspringen, Zeitleiste mit Phasenreitern. Scrubbing durch Neuberechnung aus dem Startzustand (deterministisch).
- Telegramm im Stil 03: jede Zeile mit Begruendung, Klick springt zur Stelle auf der Karte.
- Haken fuer den Tag-Nacht-Uebergang in der letzten Sekunde des Films (die Optik liefert P10, hier nur der Zeitpunkt und t).
- Protokoll-Archiv aller Runden der Mission.

Ueberraschung: z. B. das Telegramm wird Zeile fuer Zeile wie von einem Fernschreiber getippt, mit STOP am Zeilenende.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P08 Versorgung: Depot, Feldbahn, Lorenplan als Zug, Sanitaetskette

```
Repo hjorven/lehmfront. Voraussetzung: P03 auf main. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 10, 6 (Depot, Feldbahnhof), 7.4 (Lorenplan als Zug), Bild feature-04-lorenplan.png.

Baue:
- js/supply.js (rein) und js/phases/supply.js: Depot mit Munition, Verpflegung, Material; Loren pro Stellungsrunde; Lorenplan; Verwundete fahren zurueck; abgeschnittene Abschnitte zehren vom Vorrat, dann sinkt Moral; Laufgraeben verbinden Gleisende und Front; Verbandsplatz und Lazarett.
- Lorenplan-Fenster als Zug (Tippen wechselt die Ladung, Kreis das Ziel), Werkzeug L.
- Versorgungs-Overlay (Taste 1): Loren als fliessende Punkte, Engpaesse schraffiert.
- Tests fuer Kapazitaet, Abschneiden, Verwundetenfluss.

Ueberraschung: z. B. Wagen tragen kleine Kreideaufschriften der Gruppen, die sie beliefern.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P09 Artillerie: Feuerplan-Editor, Feuerwalze, Beobachter, Leitungen

```
Repo hjorven/lehmfront. Voraussetzung: P05 auf main (P06 hilfreich). Lies CLAUDE.md, docs/plan.md 4.1 Nr. 8, 7.4 (Feuerplan-Editor), 7.8 (Stil 02 Blaupause fuer den Editor), Bilder feature-06-feuerwalze.png, stil-02-blaupause.png.

Baue:
- Batterien als Etappengebaeude mit Munition, Reichweite, Streuung (Kaldern praeziser).
- Feuerplaene: Vorbereitungsfeuer, Sperrfeuer, Feuerwalze (Startlinie, Richtung, Schritt pro Gefechtsrunde, Dauer, Batterien, Munitionskosten), Stoerfeuer.
- Feuerplan-Editor im Blaupausen-Stil: Startlinie und Schrittweite direkt auf der Karte ziehen, Zeitbaender, Sturmgruppen als Geister entlang ihres Pfads.
- Beobachter und Leitungen: Feuer verlegen/einstellen nur mit intakter Leitung, Verzoegerung Telefon 1 Runde, Melder 2. Durchtrennte Leitungen, Gegenbatteriefeuer.
- Krater entstehen (Optik aus P10, Daten hier).
- Tests: Walzenposition pro Runde, Leitungsverzoegerung, Streuung deterministisch.

Ueberraschung: z. B. Einschlaege lassen das Papier kurz vibrieren und hinterlassen Brandloecher am Kartenrand.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P10 Wetter, Schlamm, Krater, Tag-Nacht-Uebergang, Leuchtkugeln

```
Repo hjorven/lehmfront. Voraussetzung: P02 und P05 auf main. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 6, 7.1 (Wetter auf dem Papier), 7.7 komplett, Bilder tagnacht-*.png.

Baue:
- js/phases/weather.js: Wetter wuerfeln, Regen fuellt Graeben (zuerst Senken), Schlamm senkt Bewegung, Grabgeschwindigkeit, Moral; Krater machen Felder zu Schlamm; Entwaesserung als Grabenverbesserung.
- Tag/Nacht als Spielzustand: Stellungsrunden wechseln Tag und Nacht, Gefechtsrunden erben; darkness steuert Thema und visibility gleichzeitig.
- Uebergang am Ende des Phasenfilms (Haken aus P07), etwa zwei Sekunden.
- Leuchtkugeln ab darkness > 0,5, erhellen kurz einen Kreis und verraten Bewegung.
- Wasserflecken bei Regen, Nebel als Grau ueber der Karte.
- Tests fuer Schlamm, Sichtweite nachts, Vererbung der Tageszeit.

Ueberraschung: z. B. Regentropfen landen sichtbar auf dem Papier, die Tinte zerlaeuft an diesen Stellen ein wenig.
Screenshots Tag, Daemmerung, Nacht, Regen. Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P11 Etappe: Gebaeude, Nachbarboni, Etappenstufen, 3D-Etappenfenster

```
Repo hjorven/lehmfront. Voraussetzung: P08 und E1 auf main. E1 hat Gebaeudedaten, Ertragslogik und das 3D-Fenster schon gebaut; dieses Paket haengt sie in Spielzustand, Runden und Gefechtsbildschirm ein und ergaenzt, was fehlt. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 11 und Abschnitt 6 komplett, Bilder feature-01-etappe-3d.png, etappe-3d.gif, Mockup-Teil __f1.

Baue:
- js/config/buildings.js mit allen 1.0-Gebaeuden aus Plan 6, Nachbarboni, Bauzeit, Kosten.
- js/phases/build.js: Bauen, Ertraege pro Stellungsrunde, Beschaedigung durch Beschuss, Reparatur, Aufklaerbarkeit.
- Etappenstufen mit Wahl zwischen zwei Belohnungen.
- Etappenfenster: links die Etappe als drehbares Pappmodell (Ziehen dreht/kippt, Doppelklick setzt zurueck; CSS-3D oder Canvas, kein WebGL-Framework noetig), rechts Bauoptionen mit Ertragsvorschau inkl. Nachbarn.
- Tests fuer Nachbarboni und Ertraege.

Ueberraschung: z. B. kleine Rauchfahnen aus der Feldkueche im Modell zur Essenszeit.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P12 Moral, Erschoepfung, Abloesung, Ersatz

```
Repo hjorven/lehmfront. Voraussetzung: P06 und P08 auf main. Lies CLAUDE.md, docs/plan.md 4.1 Nr. 12, 2.2 (Moral pro Fraktion), 5.

Baue js/phases/morale.js: Moral pro Gruppe und Abschnitt, Erschoepfung vorn, Erholung im Ruhelager, Rotation Front/Reserve/Ruhe als Befehl Abloesen, Ersatz (gruen, senkt Erfahrung), gefallener Gruppenfuehrer mit Moraleinbruch, Moralproben in der Gefechtsrunde. Anzeige im Schild und in der Befehlsliste ("zu lange vorn").
Tests fuer alle Formeln.

Ueberraschung: z. B. Gruppenfuehrer-Namen bekommen kleine Bleistiftvermerke ("seit 6 Runden vorn") direkt an der Einheit.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P13 KI-Kommandant, Taktik-Lehrling, Headless-Simulator

```
Repo hjorven/lehmfront. Voraussetzung: P06 und P09 auf main. Lies CLAUDE.md, docs/plan.md 2.4 (Lask), 7.5 (Taktik-Lehrling), 10.9, 13.

Baue:
- js/ai.js (rein, deterministisch): Lagen Halten, Vorbereiten, Sturm, Gegenstoss; Doktrin als Parameter; arbeitet nur auf viewFor (kein Schummeln). Drei Schwierigkeiten.
- Taktik-Lehrling: auf Wunsch zeigt die KI, was sie an deiner Stelle tun wuerde, mit Begruendung.
- tools/sim.js: node tools/sim.js --map data/maps/asse.json --seed 42 --a halten --b sturm --runs 200; Siegquote, Verluste, Rundenzahl, Top-10-Begruendungen; Symmetrietest auf gespiegelter Karte.
- Tests: KI ist deterministisch, Symmetrie nahe 50 Prozent (mit kleiner Laufzahl im Test).

Ueberraschung: z. B. abgefangene Notizen von Lask, die seine naechste Absicht andeuten, aus echten KI-Entscheidungen erzeugt.
Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P14 Kampagnenrahmen

```
Repo hjorven/lehmfront. Voraussetzung: P12 auf main. Lies CLAUDE.md, docs/plan.md 2.4, 2.6, 3.1, 4.3, 7.8 (Stil 09 als Kandidat fuer die Feldzugskarte).

Baue js/campaign.js und Ansichten: Feldzugskarte zwischen Missionen, Ansehen beim Stab und Vertrauen der Truppe mit allen Ausloesern und Wirkungen, Stabsbefehle als Telegramm mit Stempel, Entscheidungen (befolgen, umdeuten, verweigern), Erfahrungsberichte (etwa 20, Ausloeser aus dem Ereignisprotokoll gezaehlt) in js/config/reports.js, Ersatz und Nachschub nach Ansehen, Ablösung der Kommandantin unter 10.
Tests fuer Ausloeser und Wertegrenzen.

Ueberraschung: z. B. der Stab antwortet auf Erfolge mit immer knapperen Telegrammen, je tiefer das Ansehen sinkt.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P15 Papierebene und Erzaehlung

```
Repo hjorven/lehmfront. Voraussetzung: P07, Z1 und T1 auf main. Z1 hat die Papierebene, T1 die Texte; dieses Paket verdrahtet sie mit Ereignisprotokoll und Kampagne und baut die Feldpost-Erzeugung. Lies CLAUDE.md, docs/plan.md 2.3 bis 2.5, 7.5 (Papierebene), 7.8 (Stile 03, 06, 08, 10), Bilder feature-10-papierebene.png, stil-06-aquarell.png, stil-08-linolschnitt.png, stil-10-zeitungsdruck.png.

Baue:
- Papierebene: Briefe, Telegramme, Fundstuecke als Blaetter ueber der Karte, kippen mit der Maus, kommen beim Antippen nach vorn.
- js/letters.js: generierte Feldpost aus data/letters/templates.json mit Platzhaltern und echten Ereignissen, drei Tonlagen.
- Tagebuch der Kommandantin im Aquarell-Stil, Gefallenenliste und "Buch des Abschnitts", Fundstueck-Sammlung.
- Zeitungsdruck-Zwischentexte und Linolschnitt-Titelbild als Rahmen fuer Aktwechsel.
- Texte fuer Akt 1 schreiben (ernster Ton, siehe CLAUDE.md).
Tests fuer die Feldpost-Erzeugung.

Ueberraschung: z. B. Briefe tragen Schmutz- und Wasserflecken passend zum Wetter der Runde, in der sie geschrieben wurden.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P16 Akt 1: sechs Missionen mit integriertem Tutorial

```
Repo hjorven/lehmfront. Voraussetzung: P14 und P15 auf main. Lies CLAUDE.md, docs/plan.md 8, 8.1 Akt 1, 8.2.

Baue data/missions/akt1-*.json mit sechs Missionen, die die zwoelf Kernmechaniken einzeln einfuehren (Graben und Feuerrichtung, Feuer und Unterdrueckung, Lorenplan, Feuerplan mit Beobachter, Schlamm, Abloesung) und mit der grossen Gegenoffensive von Haus Morrow enden. Tutorial integriert: Hinweise im Spiel, kein separater Lehrmodus, nichts muss zweimal erklaert werden. Karten dazu, Stabsbefehle, Briefe, Tagebuch, Entscheidungen.
Spiele jede Mission mit tools/sim.js oder per Skript durch und belege, dass sie gewinnbar und verlierbar ist.

Ueberraschung: z. B. die erste Mission beginnt auf einer fast leeren Karte, die der Spieler buchstaeblich selbst zeichnet.
Screenshots jeder Mission, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P17 Modi: Gefecht frei, Zufallskarten, Hotseat, Tageslage (lokal)

```
Repo hjorven/lehmfront. Voraussetzung: P13 auf main. Lies CLAUDE.md, docs/plan.md 8 (Tabelle), 9 (Hotseat).

Baue: Gefecht frei mit 4 handgebauten Karten plus Zufallskarten-Generator (Seed, deterministisch, spielbar ausbalanciert), beide Fraktionen, drei Schwierigkeiten; Hotseat mit Uebergabebildschirm, der nichts verraet; Tageslage mit festem Tages-Seed und lokaler Bestenliste (Online-Bestenliste kommt in P20).
Tests fuer den Kartengenerator (Spiegelbarkeit, Erreichbarkeit).

Ueberraschung: z. B. Zufallskarten bekommen generierte Ortsnamen in der Namenssprache der Fraktion.
Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P18 Offline-Spiel, Spielstaende, Einstellungen, Barrierefreiheit

```
Repo hjorven/lehmfront. Voraussetzung: P17 auf main. Lies CLAUDE.md, docs/plan.md 10.1, 10.8.

Baue: sw.js und manifest.webmanifest (installierbar, offline spielbar, Cache-Versionierung, Update-Hinweis), Spielstand-Slots mit Laden/Speichern/Export/Import, Einstellungen (Lautstaerke, Animationstempo, reduzierte Bewegung, Textgroesse, farbunabhaengige Signaturen, Tastenbelegung anzeigen), Barrierefreiheit (Fokus, ARIA, Kontrast in Tag und Nacht pruefen).
Beachte: Pages liegt unter /lehmfront/, alle Pfade relativ.

Screenshots, Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md, auf Pages offline testen.
```

## P19 Klang und Feinschliff

```
Repo hjorven/lehmfront. Voraussetzung: P07 und K1 auf main. K1 hat die Klang-Engine; dieses Paket haengt die Klaenge an alle Ereignisse und Ansichten. Lies CLAUDE.md, docs/plan.md 7.1, 13.

Baue Klang mit WebAudio (prozedural erzeugt; Aufnahmen nur unter CC0 mit Lizenzdatei unter assets/sounds/): Papier, Bleistift, Fernschreiber, ferne Artillerie, Regen, Wind, Uhr, Pfeife beim Sturm. Leiser Grundton der Front je nach Tageszeit. Lautstaerke-Regler (Einstellungen aus P18, falls schon da). Dazu Feinschliff aller bisherigen Ansichten: Uebergaenge, Mikroanimationen, Konsistenz der Token.

Review mit frischem Blick, PR, CI gruen, mergen, docs/status.md.
```

## P20 Online mit Supabase

```
Repo hjorven/lehmfront. Voraussetzung: P17, P18 auf main und Jorvens Freigabe fuer Supabase (siehe docs/status.md, Abschnitt Freigaben). Lies CLAUDE.md, docs/plan.md 9, 11 komplett.

Baue: Migration supabase/migrations/0001_init.sql aus Plan 11.2 (mit Supabase-MCP anwenden), Edge Functions resolve, join, submit-daily mit _shared-Kopie der Spiellogik, js/net.js mit supabase-js als UMD unter vendor/, Anmeldung (anonym oder Magic Link), Cloud-Spielstand, Tageslage-Bestenliste nur nach Nachrechnen, asynchrone 1-gegen-1-Gefechte mit Einladungscode und 48-Stunden-Frist, Replay-Link (Seed und Befehlsprotokoll in der URL, ohne Server).
Nur der anon/publishable Key darf ins Repo. Pruefe RLS mit den Supabase-Advisors.

Screenshots, Review mit frischem Blick (auch Sicherheit: kann ein Spieler den verdeckten Zustand lesen?), PR, CI gruen, mergen, docs/status.md.
```

## P21 Release 1.0

```
Repo hjorven/lehmfront. Voraussetzung: P16 bis P19 auf main. Lies CLAUDE.md, docs/plan.md 1.1, 12 M5, 13, docs/status.md.

Spiele das ganze Spiel per Playwright-Skript und von Hand durch (Kampagne Akt 1, Gefecht frei, Hotseat, Tageslage). Balancing per Turnier mit tools/sim.js. Handy-Performance messen (390 x 844, CPU-Drosselung 4x). Alle bekannten Macken aus docs/status.md beheben. Screenshots aller Bildschirme in hell, dunkel, Tag, Nacht, Desktop, Handy und mit einem frischen Subagenten pruefen lassen. Version 1.0.0 setzen, Tag v1.0.0 und Release auf GitHub mit Changelog.
```

## P22 bis P27 Ausbaustufen

Die Prompts fuer P22 bis P27 folgen dem gleichen Muster und werden geschrieben, sobald P21 laeuft, mit dem dann aktuellen Stand. Sie gehoeren fest zum Umfang (Freigabe Jorven: alle Stufen, alle Akte):

- **P22 1.1 Endlosmodus und Wochenlage**: Plan 8.3, Wochen als Zyklen, Jahreszeiten, generierte Stabsbefehle, Score.
- **P23 1.2 Akt 2 "Lehm und Regen"**: Plan 4.2 Nr. 13 bis 19, Sappen, Stollen als gestrichelte Linie, Horchposten, Stosstrupps, Nacht, Leuchtkugeln im Angriff, Offiziere (Vell), Veteranen, Doktrinen, erweiterte Aufklaerung, sechs Missionen.
- **P24 1.3 Akt 3 "Materialschlacht"**: Plan 4.2 Nr. 20 bis 22, Gas mit Wind, Waffenruhe, Feldgeschuetz, Flammenwerfer, Flugzeug, sechs Missionen.
- **P25 1.5 Editor, Sandbox, Puzzle, Koop**: Plan 8 und 9.
- **P26 1.4 Akt 4 "Das letzte Fruehjahr"**: Plan 4.2 Nr. 23 und 24, vier Enden aus Plan 2.6, sechs Missionen.
- **P27 Abschluss**: wie P21 fuer das gesamte Spiel.
