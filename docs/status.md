# Lehmfront: Stand

Jeder Thread traegt hier nach dem Merge ein, was fertig ist und was offen bleibt.

## Fertig

- P00 Grundgeruest: Ordnerstruktur, Titelbild, Schriften lokal, `js/rng.js`, `js/rules.js` mit Tests, Screenshot- und Pruefwerkzeug (`tools/shot.mjs`), CI mit Tests und Browser-Pruefung, GitHub Pages baut direkt aus `main` (Wurzel, `.nojekyll`).

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

## Offen und bekannte Macken

- `data/names.json` wird per Import-Attribut (`with { type: 'json' }`) geladen: braucht Chrome 123+, Safari 17.2+, Firefox 138+. Falls aeltere Geraete wichtig werden, nur `js/config/names.js` auf fetch umstellen.
- `resolveTurn` wirft, wenn `seed` oder `turn` nicht zum Zustand passen. Die Karte (`env.map`) wird nicht kopiert: Phasen duerfen sie nur lesen, Veraenderungen gehoeren in `state.cells`.
- Geister (zuletzt gesehene Feinde) reicht `viewFor` aus `state.sides[side].intel.lastSeen` durch; befuellen muss P05.
- Gruppen-IDs sind `a01`, `b01` ... (Seite plus zwei Ziffern), sortiert wird ohne Locale.

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

- Pages baut direkt aus `main` statt ueber einen eigenen Deploy-Job (war im Repo schon so eingestellt).
- P01: Konfiguration liegt in `js/config/*.js` (units, factions, orders, names) statt in einer `js/config.js` (Plan 10.3), damit parallele Pakete nicht dieselbe Datei aendern.
- P01: Zufall pro Phase statt ein Strom pro Runde (Plan 10.6). Weiterhin aus Seed und Runde abgeleitet und einzeln nachrechenbar, aber robust gegen neue Phasen.
- P01: Ein Gruppenfuehrer bekommt moeglichst einen auf seiner Seite einmaligen Nachnamen, und die Nachnamen der Hauptfiguren (Brandt, Harms, Vell, Lask) werden nicht zufaellig vergeben. Meldungen sagen "Gruppe Lohmann", das soll eindeutig sein.
