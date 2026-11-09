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
- T2 Texte Akt 3 und 4, Enden, Zeitungen, Fundstuecke, Endlosmodus, Erfolge:
  - `data/texts/akt3.json`, `akt4.json`: 12 Briefings, 12 Stabsbefehle, 7 Entscheidungen (Gas, Befehl 117, Waffenruhe, Selins Loren, Mine 214, Verweigerung der Truppe, Treffen mit Lask), Tagebuch mit Varianten nach Ausgang und Flags, Tagebuch direkt nach einer Entscheidung (`nach_entscheidung`).
  - `data/letters/briefe-akt3-4.json`: Briefe 13 bis 24 mit Varianten (Harms/Vell gefallen, Entscheidungen), Lasks Briefe Akt 3 und 4 mit Vermerk.
  - `data/texts/enden.json`: Auswahl des Endes (Slot `ende.wahl`, Grenzen 50/60, im Test fuer jede Wertekombination geprueft), vier Schlusssequenzen mit Gefallenenliste, vorzeitige Enden, Nachwort je Figur.
  - `data/texts/zeitungen.json` (16 Seiten vor und zwischen den Akten, je zwei Zeitungen pro Fraktion, Randnotizen von der Front, Zensur als `[[...]]` wie in Z1), `fundstuecke.json` (24 Stuecke in 6 Ketten mit Abschluss), `endlos.json` (Wochenbefehle fuer beide Fraktionen, Wochenanfang, Jahreszeiten mit Wetter, Enden), `erfolge.json` (40, ohne Punkte und Orden).
  - Neue Arten, Flags und Ablauf der Enden in `data/texts/README.md`, neue Orte und Figuren in `welt.md`.
- P03 Gefechtsbildschirm: Szene `?scene=gefecht` (Hauptmenü „Gefecht frei“ und „Hotseat“), Szenario `data/scenarios/asse-frei.json` (3 gegen 3, Seite b hält per Platzhalter-KI `js/ai/dummy.js`).
  - Kärtchen (`js/ui/hud.js`): Loren, Munition, Material, Moral, Ansehen/Vertrauen, Runde mit Tageszeit und Wetter, Hinweis, „Vor der Runde“, Overlays 1 bis 4. Handy: Leiste oben, klappt zur Seitenleiste wie Stil 07 auf.
  - Schild am gewählten Objekt (`js/ui/shield.js`), Werkzeugreihe (`js/ui/toolbar.js`), Befehlsliste (Tab, `js/ui/orderlist.js`), radiales Menü bei langem Druck oder Rechtsklick (`js/ui/radial.js`, Finger zum Befehl ziehen und loslassen), Zusammenfassung mit Halten-Ring bei Sturm und Übergabe für Hotseat (`js/ui/commit.js`).
  - Befehlsbuch pro Seite mit Undo (`js/ui/orderbook.js`, rein), Zusammenfassung und Checkliste mit Register (`js/ui/summary.js`), Bezeichnungen (`js/ui/labels.js`), Tageszeit aus der Uhr (`js/ui/daytime.js`).
  - Erste Bewegungsphase `js/phases/move.js`: Bewegen (Gefecht, speed Felder) und Verlegen (Stellung, speed x 4 Felder, nur hinter der eigenen Linie), besetzte Felder halten an, Rest läuft als Befehl in der nächsten Runde weiter.
  - Dynamische Ebene `js/render/units-layer.js`: Gruppensymbole wie im Mockup, Bleistiftpfeile (diese Runde durchgezogen, Rest gestrichelt), Zielvorschau, Fragezeichen an Gruppen ohne Befehl.
  - Demo-Zustände für Screenshots: `&demo=befehle|liste|radial|zusammenfassung|sturm|bericht|uebergabe|zeichnen|overlays`, außerdem `&mode=hotseat`, `&kind=battle`, `&night=0..1`, `&seed=`.
- P07 Phasenfilm und Telegramm:
  - `js/film.js` (rein): `planFilm(input, result, side)` teilt eine aufgelöste Runde in Abschnitte nach den Abteilungen aus `ORDER` (Reiter „Bewegung“, „Feuer“, „Uhr“ ...), Abschnitte ohne sichtbares Ereignis fallen weg. `replayTo(input, n)` rechnet den Zustand nach n Phasen aus dem Startzustand neu (Scrubbing ohne gespeicherte Zwischenstände), `tracksBetween`/`trackPos` liefern die gegangenen Wege, `transitionAt` die letzte Sekunde, `clockDuring` die mitlaufende Spieluhr.
  - `js/archive.js` (rein): Protokoll-Archiv der Mission, je Runde Startzustand, Befehle beider Seiten, Seed und Protokoll. Jede alte Runde lässt sich als Film neu rechnen.
  - Oberfläche: `js/ui/film.js` (Filmleiste mit Phasenreitern, Weiter pro Phase, Durchlaufen, Überspringen, Zeitleiste, Tasten Enter/Leertaste, Esc, Pfeile), `js/ui/telegram.js` (Fernschreiberstreifen Stil 03, Klick springt zum Ort und im Film zum Zeitpunkt), `js/ui/archive.js` (Aktenordner „Protokoll“, Taste P), `js/render/film-layer.js` (Geist am Ausgangsort und Bleistiftspur). Ersetzt das Meldungen-Kärtchen aus P03.
  - Demo-Zustände: `?scene=gefecht&demo=film|telegramm|archiv`.

- P19 Klang im Spiel (Teil 1, Feinschliff folgt):
  - `js/audio/cues.js` (rein): Ereignis-Haken `registerCue(type, fn)`, Vorbelegung fuer alle bisherigen Ereignisse (Schritte, Gewehr, MG, Leuchtkugel bei Einbruch der Nacht, Kraehe bei Tagesanbruch, Radieren beim Geist, Uhr in der Uhrphase) und fuer kommende (Sturm, Artillerie nah/fern nach Abstand zu eigenen Gruppen, Mine, Loren, Wetter). Grundton der Front `ambienceFor` aus Tageszeit, Wetter, Rundenart und dem, was die eigene Seite in der letzten Runde mitbekommen hat.
  - `js/audio/director.js` spielt ab; eingehaengt in Phasenfilm, Gefecht (Pfeife nach dem Halten-Ring beim Sturm, Musik), Papier, Etappe.
  - Regler: Knopf „Ton“ rechts im Gefecht mit Klappkarte, auf dem Handy als Karte „Klang“ in der Seitenleiste (`js/ui/sound.js`, auch fuer P18 nutzbar).
  - Ueberraschung: wird eine Gruppe aufgerieben, verstummt die ganze Front fuer drei Sekunden, dann schlaegt die Uhr einmal und das Grollen kommt langsam zurueck (`audio.hush`).
  - Offen: Feinschliff der Ansichten (Uebergaenge, Mikroanimationen, Token-Konsistenz) als zweiter PR; Hauptmenue und Feldzugskarte bekommen ihren Klang, sobald es sie gibt.

### Für die nächsten Pakete (nach P07)

- Tag-Nacht-Optik (P10): `setTransitionHook(({ t, from, to }) => ...)` aus `js/ui/film.js`. Wird in der letzten Sekunde des Films mit t 0..1 gerufen (beim Zurückspulen auch rückwärts), `from`/`to` sind die Dunkelheit vor und nach der Runde. Standard ist `applyTheme(themeAt(...))`.
- Neue Phasen bekommen automatisch einen Reiter, sobald sie sichtbare Ereignisse melden. Der Name kommt aus `SECTION_LABELS` in `js/film.js` (nach der `ORDER`-Abteilung). Bewegung im Film braucht nichts: Positionen werden zwischen den Zwischenständen gezogen; liefert ein Ereignis `from`, `to`, `steps` und der Befehl `path`, läuft die Gruppe den echten Weg.
- Rote Zeilen im Telegramm: Ereignistypen in `WARN_TYPES` (`js/film.js`) oder `blocked: true`; graue Zeilen: `minor: true`.
- Statistiken für Texte (T1 `wann.werte`) und Erfahrungsberichte (P14) können aus `archive.rounds[].log` gezählt werden.

- P05 Feuer, Sicht, Nebel des Krieges:
  - `js/sight.js` (rein): Sichtweite (Tag 12 Felder, Beobachter 14, Höhe +1 je Stufe, Beobachter +3), Dunkelheit über `visibilityFromDarkness`, Deckung verbirgt (zwei Drittel Sichtweite, solange die Gruppe sich nicht bewegt), Mündungsfeuer verrät auch nachts, Unterstand sieht und wird nur aus dem Nachbarfeld gesehen. `coverAt` (Graben aus `state.cells` vor der Karte, eroberter Graben halb), `sectorOf`/`inCone` (MG-Kegel ohne Winkelfunktionen), `visibleEnemies`, `visibleCells`, `sightLine`.
  - `js/view.js`: Nebel des Krieges mit Sichtlinien. `viewFor(state, log, side, env)` nimmt jetzt optional `{ map, darkness }`; ohne Karte zählt nur die Entfernung. Geister mit `age`, `type`, `from` (Bewegung), `sector` (bekannter MG-Kegel), `source`.
  - Phasen in `js/phases/fire.js`: `exposure` (wer sich bewegt hat), `sector` (MG richtet Sektor aus, Befehl `sector` in beiden Rundenarten), `fire` (Gefecht, nach der Bewegung, alle gleichzeitig; Feuerbefehl auf Feld, MG bestreicht Kegel, haltende Gruppen feuern von selbst auf das nächste sichtbare Ziel, Beobachter und Melder nur auf Befehl; Feuer auf einen Geist ist Feuer auf Verdacht mit 40 % der Wirkung; Mörser Steilfeuer ohne eigene Sichtlinie), `rally` (Unterdrückung klingt ab). Verluste, Unterdrückung pro Waffe, Längsfeuer (Regel tauschbar mit `setEnfiladeRule`), Begründungen mit Richtung („MG-Feuer aus Ost“). Aufgeriebene Gruppen landen mit ihrem Führer in `state.fallen`.
  - `js/phases/intel.js`: Aufklärung je Seite in `state.sides[side].intel.lastSeen`; Geister werden ausradiert, wenn man ihr Feld genau sieht und niemand mehr dort ist, oder nach 8 Runden vergessen. Szenarien können Anfangswissen mitgeben (`sides.x.intel`, siehe `data/scenarios/asse-frei.json`).
  - Werkzeug Feuern (F): Vorschau mit Sichtlinie, Trefferchance, Deckung, erwarteten Verlusten; bei MG-Trupps Feuersektor mit Kegel-Vorschau. Sichtlinie der gewählten Gruppe beim Zeigen mit der Maus. Bedrohungs-Overlay (Taste 2): bekannte MG-Kegel schraffiert, zuletzt gesehene Bewegung mit Richtung und Alter, Quelle (Luftbild, Grabenspiegel). Sicht-Overlay (3) nutzt jetzt dieselbe Regel.
  - Demos: `?scene=gefecht&demo=feuer|sektor|feuerrunde|bedrohung|sichtlinie`.
- P08 Versorgung: `js/supply.js` (rein), `js/config/supply.js`, Phase `js/phases/supply.js` (Stellungsrunde, Schritt 7).
  - Depot (`supplies.ammo/food/material`) bekommt je Stellungsrunde Nachschub (`supplies.income`, sonst `DEFAULT_INCOME`). Die Feldbahn fährt `supplies.cartsTotal` Loren (6 Einheiten je Lore).
  - Front in Abschnitte A, B, C (Bänder von Nord nach Süd, `map.supply.sections` ändert die Zahl). Jeder Abschnitt hat einen eigenen Vorrat in `state.sides[s].supply.sections[id]` und verbraucht je Gruppe 2 Verpflegung und 1 Munition pro Stellungsrunde.
  - Netz: Depot, Gleis, Laufgraben (Träger überbrücken 2 Felder). Unterbrochen durch `state.cells[k].railBroken`, `trenchBlocked`, Feinde im Graben oder ein beschädigtes Depot (`buildingDamaged`). Abgeschnittene Abschnitte bekommen nichts, zehren vom Vorrat, dann eiserne Ration, dann sinkt die Moral immer schneller.
  - Sanitätskette: Verwundete warten im Abschnitt (`addWounded`), fahren auf den Loren zurück (1 je beladener Lore, 4 je Sanitätslore, Bericht `sanitaetsloren` verdoppelt), heilen im Verbandsplatz (2 Runden), Lazarett (3) oder ohne beides (5) und kehren zur Gruppe zurück; je 4 Rückkehrer +1 Erfahrung. Ohne Sanitäter im Abschnitt stirbt jeder Wartende mit 20 Prozent, jede wartende Stelle kostet Vertrauen.
  - Lorenplan als Seitenbefehl `{ type: 'supply_plan', wagons: [{ load, to }] }` (neu: `scope: 'side'` in `js/config/orders.js`, `normalizeOrders` liefert `plans`, Phasen lesen `ctx.planOf(side, type)`). Ohne neuen Plan gilt der letzte, in der ersten Runde ein Vorschlag (`suggestPlan`).
  - Fenster „Lorenplan“ als Zug (`js/ui/lorenplan.js`, Werkzeug L, auch ohne gewählte Gruppe): Antippen des Wagens wechselt die Ladung (MUN, VERPF, MAT, Sanitätslore, frei), der Kreis das Ziel. Abschnittskärtchen zeigen Lieferung, Reichweite in Runden, Verwundete, Bruchstelle. V = Vorschlag, Enter übernimmt, Esc verwirft.
  - Overlay 1 Versorgung: Loren als fließende Punkte entlang des Wegs, Verwundete als rote Kreuze zurück, abgeschnittene Abschnitte rot und knappe ocker schraffiert, Bruchstellen mit Kreuz und „Weg zu“.
  - Prüfpunkt „versorgung“ (abgeschnitten, Vorrat reicht nicht bis morgen, Verwundete ohne Lore) und eine Zeile in der Zusammenfassung. Demo: `?scene=gefecht&demo=lorenplan` und `&demo=versorgung`.
  - Überraschung: Die Wagen tragen Kreideaufschriften („für Janssen“, „holt 3 Verw.“), kommt eine Lore nicht durch, steht „Weg zu“ durchgestrichen auf der Bordwand.
- P04 Graben:
  - Regeln rein in `js/trench.js`: Stufen `LEVELS` (1 Schützenloch, 2 Schützengraben, 3 ausgebaut mit Faschinen, 4 betoniert; Deckung passt zu `COVER` in `js/rules.js`), `cellsFromPoints` (gezeichnete Linie in Felder, Zurückzeichnen radiert), `straightRuns`/`enfiladeRuns` (Längsfeuer ab 4 Feldern gerade), `insertTraverses` (keine Gerade über 3), `defaultFacings`, `captureTrench`, `trenchCover`, `enfiladeOf`.
  - Phasen `js/phases/dig.js` (Graben ausheben über Runden, Arbeit bleibt im Feld, Material für Stufe 3 und 4, Beton für Morrow erst ab Akt 3) und `js/phases/rebuild.js` (Umbauen: eine Stellungsrunde je drei Felder, Pioniere doppelt). Grabbudget 100 je Runde mal Faktoren in Prozent aus `registerDigFactor(id, fn)` (Einheit, Stärke, Wetter, Erschöpfung, Vertrauen; gleiche id ersetzt).
  - Werkzeuge Graben (G) und Umbauen (U) mit Zeichenfläche (`js/ui/linedraw.js`, ein Finger zeichnet, zwei Finger bewegen die Karte) und Kärtchen wie im Mockup: Warnung Längsfeuer mit eingezeichneter MG-Schusslinie, „Traversen einfügen“, Stufe, Feuer- oder Laufgraben, Richtung, Dauer im Vergleich Schützen/Pioniere, bremsende Faktoren.
  - Demo: `?scene=gefecht&demo=graben|traversen|grabenplan|umbauen`.

- P10 Wetter, Schlamm, Krater, Tag und Nacht, Leuchtkugeln:
  - `js/weather.js` (rein): Wetter als Markow-Kette (klar, bedeckt, Regen, Sturm, Nebel; `WEATHER_TABLE`), Bodennässe `weather.wet` 0..3, Senken (`isSink`), Wasser im Graben (`state.cells[k].water` 0..3, Senken zuerst und doppelt, Hang läuft ab, Boden wirkt mit), Schlamm `mudAt` 0..3 aus Nässe, Boden, Senke, Krater (auch trocken mindestens 1), `cells.mud` und Grabenwasser, Entwässerung `cells.drain`. Wirkung: `mudMoveCost` (Bewegung), `digFactor` (Graben, für P04), Moral in der Wetterphase, `weatherSight`/`sightDarkness` (Nebel und Regen kürzen die Sicht), `flareAt`.
  - `js/phases/weather.js`: Phasen `weather` (Stellungsrunde, am Ende kurz vor der Uhr: Wetter der nächsten zwölf Stunden würfeln, Nässe, Gräben füllen und leeren, Moral im Schlamm), `drain` (Befehl Entwässern: Lattenrost und Pumpensumpf in bis zu 3 Grabenfeldern, 2 Material), `flares` (beide Rundenarten nach der Bewegung, vor dem Feuer: Leuchtkugel auf Befehl, Posten schießen von selbst, wenn sie nachts Bewegung in 6 Feldern hören, höchstens 2 je Seite und Runde). Szenarien können das Wetter festlegen (`weather.fixed: true`).
  - Tag und Nacht sind Spielzustand: Stellungsrunden wechseln Tag und Nacht, Gefechtsrunden erben die Tageszeit ihrer Stellungsrunde (`js/phases/clock.js`, `darknessAt` mit `night`). `darknessOf(state)` (Sichtregeln) = Tageszeit plus Wetter; die Optik nimmt die reine Tageszeit, Nebel zeichnet die Wetterebene.
  - Leuchtkugel: Kreis mit Radius 4 ist eine Runde lang taghell (`darknessAtCell` in `js/sight.js`, gilt für Sicht, Sicht-Overlay und Trefferchance); wer sich darin bewegt, bekommt eine rote Meldung „gerät ins Licht“.
  - Bewegung: `addStepCostRule(fn)` in `js/phases/move.js` für Zusatzkosten je Feld aus dem Spielzustand; Schlamm meldet sich dort an, Vorschau und A* rechnen mit.
  - Darstellung `js/render/weather-layer.js` (eigenes Canvas zwischen Karte und Einheiten) und `js/ui/weather-fx.js`: Wasserflecken, Schlammsignatur (allgemeine Nässe locker, Krater, Senken und Wasser voll), Wasserwellen im Graben, Lattenrost, Regenstriche nach Wind, Nebel als Grau mit Lücken, so weit die eigenen Gruppen sehen, Leuchtkugeln steigen, brennen flackernd am Schirm und hinterlassen einen Bleistiftkreis. Klang über `setAmbience`. Tag-Nacht-Übergang am Filmende jetzt zwei Sekunden (`TIMING.transition`), weich beschleunigt.
  - Werkzeuge Leuchtkugel (K, nur bei Dunkelheit sichtbar) und Entwässern (W, nur in Stellungsrunden). Werkzeuge können sich mit `shown(state)` ausblenden (`shownTools`). Schild zeigt „Boden“ (Schlamm, Wasser), Kopfzeile „Regen, Schlamm“.
  - Szenen-Parameter: `?scene=gefecht&weather=clear|overcast|rain|storm|fog&wet=0..3&flares=41,10;38,17` (Felder 1-basiert).

### Für die nächsten Pakete (nach P10)

- P04: Grabgeschwindigkeit mit `digFactor(state, map, x, y)` aus `js/weather.js` multiplizieren. Neue Gräben in `state.cells` bekommen Wasser automatisch (die Wetterphase liest Karte und Zustand). „Entwässerung als Grabenverbesserung“ ist Befehl `drain`; P04 darf sie in sein Umbau-Werkzeug übernehmen.
- P06: Draht-Zusatzkosten ebenfalls über `addStepCostRule`. P09: Einschläge setzen `crater` (und gern `mud: 1`) in `state.cells`, Schlamm folgt von selbst; zeichnen muss P09 neue Krater selbst (die Wetterebene zeichnet nur Schlamm).
- P12: Moralverlust im Schlamm ist das Ereignis `mud_morale` (Phase `weather`). P14: Ereignisse `weather`, `flood`, `drain`, `flare`, `flare_exposed` für Zähler.
- P22 (Endlos, Jahreszeiten): `WEATHER_TABLE` je Jahreszeit tauschen oder `weather.fixed` setzen; Schnee kennt `WEATHER_NAMES` schon, hat aber noch keine Regel.

### Für die nächsten Pakete (P03, P10)

- Karte einbinden: `createMapLayer(canvas, map, { getCamera, getTheme })`, Kamera mit `createCamera({ bounds: sheetBounds(map) })` und `attachCameraControls(el, cam, { onChange, onTap, onHover })`. Muster: `js/scenes/karte.js`.
- Dynamische Ebene (Einheiten, Overlays) als zweites Canvas darüber, Weltkoordinaten per `applyCameraTransform(ctx, cam, dpr)`.
- Neuer Graben: Zelle in `map.cells` ändern, dann `layer.setMap(map)` (baut die Geometrie neu, etwa 5 bis 10 ms auf dem Desktop).
- Tageszeit: `applyTheme(themeAt(darkness))`; Regeln lesen dieselbe Zahl über `visibilityFromDarkness`. `theme.flare` ist ab 0,5 wahr (Leuchtkugeln zeichnet jetzt `js/render/weather-layer.js`).

### Für die nächsten Pakete (nach P03)

- Werkzeug anmelden: Datei `js/ui/tools/<name>.js` mit `registerTool({ id, key, label, icon, order, canUse(group, state, env), begin(ctx) })`, eine Import-Zeile in `js/ui/tools/index.js`. `ctx` bietet `setOrder`, `pickCell({ hint, preview(cell), pick(cell) })`, `hint`, `cancel` (Beschreibung in `js/ui/tools.js`, Muster `js/ui/tools/move.js`). Tasten laut Plan 7.6: G Graben, U Umbauen, F Feuern, D Draht, L Lorenplan (B und H sind belegt).
- Overlay anmelden: `registerOverlay({ slot: 1..4, id, label, draw(ctx, { cam, theme, map, state, side, px }) })` aus `js/ui/overlays.js`; Platz 1 Versorgung (P08) ist frei, 2 Bedrohung (P05), 3 Sicht und 4 Höhe sind belegt und dürfen ersetzt werden.
- Pruefpunkt für „Vor der Runde“ und die Zusammenfassung: `registerCheck(id, ({ state, side, orders, map }) => [{ tone: 'warn'|'ok', text, group?, at? }])` aus `js/ui/summary.js`. Befehlsarten, die den Halten-Ring auslösen: `HOLD_TYPES` (bisher `assault`).
- P06 erweitert `js/phases/move.js` (Draht, Begegnungen, Sturm). Ereignisse `move`/`redeploy` tragen `rest`; der Gefechtsbildschirm übernimmt den Rest als Befehl der nächsten Runde.
- P07 ersetzt das Meldungen-Kärtchen (`createReport` in `js/ui/commit.js`) durch Phasenfilm und Telegramm. P13 ersetzt `js/ai/dummy.js` (`planOrders(view, { map, seed })`). P17 baut den Übergabebildschirm aus.
- Gemeinsame Kärtchen-Klasse `.card` steht jetzt in `css/style.css` (vorher nur in `css/karte.css`).

### Für die nächsten Pakete (nach P05)

- Sicht immer über `js/sight.js`; `viewFor` mit `{ map }` aufrufen, sonst gibt es keine Sichtlinien.
- P06: Unterstand (`inDugout`) wird von Feuer und Sicht schon beachtet. Niedergehaltene Gruppen (`suppressed >= PINNED`) kommen nur halb so weit (`moveBudget`). Sturm (`assault`) und Bewegen feuern nicht. Befehle `dugout`, `cease_fire` stoppen das Feuer.
- P08/P09: Feuer-Ereignisse tragen `ammo` (MG 2, sonst 1) zum Abbuchen; Munition wird noch nicht verbraucht. Artilleriereichweiten gehören ins Bedrohungs-Overlay (`js/ui/overlays/threat.js`).
- P04: Längsfeuer-Regel mit `setEnfiladeRule(fn)` aus `js/phases/fire.js` ersetzen; Traversen als `trench.traverse` werden schon erkannt.
- P12: `losses`- und `suppressed`-Ereignisse und `g.underFire` sind die Haken für Moralproben.

### Für die nächsten Pakete (nach P04)

- Gräben im Spiel stehen in `state.cells[k].trench` (`{ side: 'own'|'enemy', kind, level, facing, captured? }`, Kartenseite wie in der Karte). Für Regeln und Anzeige: `applyCellState(map, state.cells)` aus `js/map.js` legt den Zustand über die Karte.
- Feuer (P05) ist angeschlossen: `js/phases/dig.js` setzt `setEnfiladeRule` auf `enfiladeInState` (gerade Abschnitte ab 4 Feldern, Schütze in der Verlängerung, seitlich höchstens ein Feld). `coverAt` in `js/sight.js` liest jetzt Stufe 1 bis 4 wie `LEVELS` und wertet `captured` als halbe Deckung. `trenchCover` und `enfiladeOf` aus `js/trench.js` gibt es zusätzlich für Karten mit Zustand.
- P06/P09 Sturm und Nahkampf: `captureTrench(state, map, x, y, side)` beim Einbruch aufrufen; der Graben gibt dann halbe Deckung, bis er umgebaut ist.
- Wetter (P10?), Etappe (P11, Pionierpark) und Moral (P12) melden Grabfaktoren mit `registerDigFactor` an oder ersetzen die vorläufigen.
- Dynamische Ebene: `registerDecor({ id, order, draw(ctx, d) })` und `registerOrderPainter(type, fn)` aus `js/render/decor.js` zeichnen eigene Dinge, ohne `units-layer.js` anzufassen.
- Werkzeuge dürfen `orderTypes` und `describe(order, group, state, map)` angeben (Text in Schild und Befehlsliste). Zeichenwerkzeuge bekommen in `ctx` zusätzlich `ui`, `cam`, `onCancel(fn)`, `redraw(camera?)`, `expose(api)`.
- Ereignisse dürfen `carry` (ein Befehl) tragen; der Gefechtsbildschirm setzt ihn in der nächsten Runde als Befehl („läuft weiter“), wenn die Rundenart passt.

## Offen und bekannte Macken

- P08: Für andere Pakete: `addWounded(state, map, side, at, n, groupId)` (P05/P06/P09 melden Verwundete), `takeStock(state, map, side, sectionId, res, n)` (P04 Material, P05 Munition), `group.ammoLow` (Feuer schwächer), `trenchAt` liest neue Gräben aus `state.cells[k].trench`. Die Phase `casualties` macht aus jedem Ereignis `losses` (P05 Feuer, später Nahkampf und Artillerie) zu 60 Prozent Verwundete, die im Abschnitt auf eine Lore warten; die anderen gelten als gefallen.
- P08: Die Gegenseite auf der Asse-Karte hat kein Depot und gilt als versorgt (`abstract`). Die Etappe aus P11 sollte Kapazität (`cartsTotal`) und Nachschub (`income`) aus `etappeYield` setzen; bisher stammen sie aus dem Szenario.
- P08: Mengen (6 je Lore, Verbrauch, Sterberate, Heilzeiten) sind geschätzt, Balancing in P21. `state.fallen` bekommt Einträge `{ side, group, leader, count, turn, cause: 'wounds', at }` ohne Einzelnamen.

- T2: Die Texte sind Daten; Einhaengen machen P14/P15 (Ablauf), P22 (Endlos), P24/P26 (Akt 3 und 4, Enden). Offen: Harms und Vell kommen in den Missionen von Akt 3 und 4 kaum vor (nur Briefe und a4m4); wer mag, ergaenzt Briefing-Varianten. Die Auslöser der Erfolge sind nur in Worten beschrieben, Zaehler legt P14 fest.

- `data/names.json` wird per Import-Attribut (`with { type: 'json' }`) geladen: braucht Chrome 123+, Safari 17.2+, Firefox 138+. Falls aeltere Geraete wichtig werden, nur `js/config/names.js` auf fetch umstellen.
- `resolveTurn` wirft, wenn `seed` oder `turn` nicht zum Zustand passen. Die Karte (`env.map`) wird nicht kopiert: Phasen duerfen sie nur lesen, Veraenderungen gehoeren in `state.cells`.
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

- P03: Doppelklick zum Zoomen löst in der Zielwahl auch ein Antippen aus (Ziel wird gesetzt, Strg+Z nimmt es zurück). Antippen und Doppelklick werden nicht mit Verzögerung getrennt, damit das Antippen sofort reagiert.
- P03: Im Hotseat bleiben die Kartenfarben fest (Kaldern blau, Morrow rot); die Seite b plant also mit roten Symbolen. Der Nebel gilt pro planender Seite.
- P03: Die Bewegungsregeln sind eine erste Fassung (keine Begegnungen, kein Draht-Abbremsen außer über die Feldkosten); Verlegen in Stellungsrunden darf nicht ins Niemandsland.
- P10: Das Wetter wechselt nur zu Beginn einer Stellungsrunde; Gefechtsrunden behalten es. Schnee hat noch keine Regel. Ohne Ruhelager (P11/P12) erholt sich die Moral vom Schlamm noch nicht.
- P10: Leuchtkugeln kosten noch nichts (keine Munition), Posten schießen höchstens zwei je Runde. Die Szene zeigt den Kreis der letzten Runde beim Planen weiter (als Bleistiftkreis), die Regel gilt nur in der Runde, in der sie geschossen wurde (`flare.turn`). Auf dem Handy passen tagsüber 5 Werkzeuge nicht ganz neben „Runde ausführen“; die Leiste scrollt.
- P10: Die Tropfenflecken (Überraschung) leben nur im Speicher der Szene, nicht im Spielzustand; nach dem Neuladen liegen nur die vorbereiteten Flecken je Nässe da. Das Zerlaufen der Tinte kopiert die statische Karte versetzt; bei sehr schnellem Zoomen kann es einen Augenblick nachhängen.
- P07: Das Archiv lebt nur im Speicher der Szene; Speichern und Laden (P18) muss `archive` mitnehmen (reines JSON, die Karte steckt nicht darin). Pro Runde liegt der ganze Startzustand drin, bei sehr langen Missionen wird das groß.
- P07: Ein Film rechnet je Abschnitt eine Teilrunde neu (heute 2 bis 3). Mit vielen Phasen und großen Karten sollte P21 messen, ob das auf schwachen Handys flüssig bleibt.
- P07: Der Gegner bekommt im Film nur Ereignisse, die er sieht (`viewFor`); feindliche Gruppen erscheinen, sobald sie im Zwischenstand sichtbar sind.
- P03: Die Szene nutzt `requestAnimationFrame` und `performance.now()` nur für Optik (Bleistift, Ring); die Spiellogik bleibt rein.

- P05: Sicht- und Schussweite sind Chebyshev-Abstand (Quadrat), nur der MG-Kegel ist rund wie gezeichnet. Niedergehaltene Gruppen feuern auf ausdrücklichen Befehl weiter (mit Zittern), nur nicht von selbst. Geister in Gräben werden erst aus dem Nachbarfeld ausradiert (ein Unterstand kann eine Gruppe verbergen).
- P05: Feuer in Gefechtsrunden trifft nur Gruppen, die nach der Bewegung sichtbar sind; Feuer während der Bewegung (Sperrfeuer auf den Weg) gibt es noch nicht.
- P05: Mit `night=` (ab 0,5) stellt die Szene die Uhr auf 22 Uhr, damit Regeln und Optik übereinstimmen.
- P04: Die Gruppe rückt beim Graben zum zuletzt bearbeiteten Feld nach. Ist das Feld besetzt, bleibt sie stehen; ein weitergetragener Rest gilt, solange irgendein Feld davon höchstens drei Felder entfernt ist. Grabgeschwindigkeit und Materialkosten sind Startwerte für das Balancing (P21).
- P04: Laufgräben warnen nicht vor Längsfeuer, `enfiladeOf` zählt sie im Gefecht aber mit. Schräg gezeichnete Linien zerfallen in kurze Stücke und lösen selten eine Warnung aus.
- P04: Die Anzeige von Gräben und Aufwurf folgt `viewFor(...).cells`; solange `cellVisible` immer wahr ist, sieht man feindliche Gräben überall.

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
- P03: Langer Druck öffnet das radiale Menü auch mit der Maus, zusätzlich Rechtsklick. Der Finger kann vom Druckpunkt direkt zum Befehl gleiten und loslassen (Marking-Menü), Antippen geht ebenso.
- P03: „Bewegen“ ist ein Werkzeug für beide Rundenarten: in Stellungsrunden wird daraus „Verlegen“ (redeploy), in Gefechtsrunden „Bewegen“ (move). Unfertige Wege laufen als Befehl weiter („läuft weiter“ in der Befehlsliste).
- P03: Gruppen ohne Befehl tragen auf der Karte ein Bleistift-Fragezeichen; der Plan nennt das nur in der Checkliste.
- P10: Regen fällt sichtbar auf das Blatt: Tropfen landen als kleine Ringe, ein Teil bleibt als Fleck, und an jedem Fleck zerläuft die Tinte der Karte ein wenig nach unten. Nebel ist nicht gleichmäßig grau, sondern lässt frei, was die eigenen Gruppen im Nebel sehen (dieselbe Regel wie die Sicht). Leuchtkugeln hinterlassen nach dem Verlöschen einen gestrichelten Kreis.
- P10: Tag-Nacht-Übergang am Filmende zwei statt eine Sekunde (Plan: „etwa zwei Sekunden“), mit weichem Anfang und Ende. Gefechtsrunden laufen nicht mehr durch die Dämmerung, sie erben Tag oder Nacht (Plan 7.7).
- P10: Das Wetter wird am Ende der Stellungsrunde für die nächste gewürfelt (Plan 10.6 nennt Schritt 2), damit Vorschau und Auflösung mit demselben Schlamm und Nebel rechnen (Plan 7.7: man plant mit dem, was gilt). Nebel bei Nacht kürzt die Sicht unter die Nachtsicht (`visibilityFromDarkness` nimmt dafür Werte über 1). Wasser und Lattenroste zeichnet die Karte nur in eigenen Gräben.
- P10: Schlamm wird nicht pro Feld gespeichert, sondern aus Nässe, Boden, Senke, Krater und Feldzustand berechnet; der Spielzustand bleibt klein, und jede Regel liest dieselbe Zahl.
- P07: „Überspringen“ springt nicht ans Ende, sondern in die letzte Sekunde: der Tag-Nacht-Wechsel läuft immer sichtbar ab. Jede Telegrammzeile trägt eine Zeitgruppe, Phase und Feld („0750 BEWEGUNG · FELD 25/10“) und endet mit STOP. Das Protokoll zeigt alte Runden als Durchschläge in Kopierstift-Farbe.
- P03: Nach der Runde zeigt ein schlichtes Meldungen-Kärtchen alle Begründungen (Klick springt zum Ort), bis P07 das Telegramm bringt.
- P05: Der Nebel des Krieges braucht kein eigenes Grau: Feinde, die man nicht sieht, bleiben als Bleistiftskizze stehen, die jede Runde blasser und lückenhafter wird, als würde jemand radieren. Ist der Platz wieder einsehbar und leer, wird die Skizze ausradiert (Meldung im Protokoll).
- P05: MG-Trupps bekommen statt „Feuern“ einen dauerhaften Feuersektor (Befehl `sector`, auch in Stellungsrunden), den sie im Gefecht selbst bestreichen. Mündungsfeuer verrät die Stellung auch nachts.
- P08: Lorenplan ist ein Befehl der ganzen Seite (kein Gruppenbefehl) und gilt weiter, bis er geändert wird. Neben Munition, Verpflegung und Material gibt es die Sanitätslore (fährt leer, holt vier Verwundete) und „frei“ (Lore bleibt stehen). Beladene Loren nehmen auf dem Rückweg einen Verwundeten mit.
- P08: Abschnitte sind gleich hohe Bänder von Nord nach Süd; Gleis, Depot und Laufgraben dürfen bis zu zwei Felder auseinanderliegen (Träger), weil die Asse-Karte keine durchgehende Verbindung zeichnet.
- P08: Ohne eigene Bruchstellen-Grafik auf der Karte: Das Versorgungs-Overlay markiert verschüttete Gräben und zerschossene Gleise mit rotem Kreuz und schreibt „Weg zu“ an die Stelle.
- P04: Grabenstufen 1 bis 4 statt 1 bis 3 im Kartenformat (betoniert neu). Arbeit wird je Feld aufsummiert, ein angefangenes Feld wird erst Schützenloch, dann Graben.
- P04: Die Gruppe wandert beim Graben die Linie entlang (sie steht am Ende am zuletzt bearbeiteten Feld), statt am Platz zu bleiben.
- P04, Überraschung: frischer Aufwurf. Frisch gegrabene Felder tragen zwei Runden lang Lehmhaufen auf der Feindseite; Gegner in Sichtweite (tags 10 Felder, nachts 3) bekommen eine Meldung „Frisch aufgeworfener Lehm bei ...“ bzw. nachts „Spatengeräusche“. Nachts graben lohnt sich also. Beim Zeichnen zeigt eine gestrichelte Schusslinie mit „MG?“, von wo ein gerader Abschnitt bestrichen werden kann.
- P04: Umbauen geht auch an eigenen, nie eroberten Gräben (Feuerrichtung drehen). Antippen eines eroberten Feldes nimmt den ganzen eroberten Abschnitt.
