# Lehmfront: Arbeitsregeln fuer Claude-Threads

Taktisches Grabenkriegsspiel (WEGO, rundenbasiert) fuer den Browser, gehostet auf GitHub Pages.
Der vollstaendige Spielplan steht in `docs/plan.md`, das UI-Mockup in `docs/mockup/` (Bilder in `docs/bilder/`).
Die Arbeitspakete mit Reihenfolge stehen in `docs/arbeitspakete.md`, der Stand in `docs/status.md`.

## Sprache und Ton

- Code-Bezeichner englisch, Kommentare, UI-Texte, Commits und Doku deutsch.
- Im Spiel echte Umlaute (ä, ö, ü, ß) verwenden. In Code-Kommentaren ist beides ok.
- Ernster Ton, nichts Verherrlichendes, fiktive Welt ohne reale Laender, Personen, Symbole (Plan 2.1, 13).
- Keine Emojis, weder im Spiel noch in Doku oder Commits.

## Technik (fest, Plan 10)

- Kein Build-Schritt. Reine ES-Module, `index.html` laedt `js/main.js`. Bibliotheken nur als Datei unter `vendor/`, keine CDNs zur Laufzeit.
- Darstellung Canvas 2D in zwei Ebenen (statische Karte, dynamische Einheiten und Overlays) plus DOM fuer Kaertchen.
- Schriften liegen unter `assets/fonts/` (Special Elite, IBM Plex Sans/Mono, Caveat). Neue Schriften nur mit Lizenzdatei.
- Spiellogik in reinen Funktionen (`js/rules.js`, `js/resolve.js`, `js/map.js`, `js/supply.js` und `js/phases/*`):
  - nur Grundrechenarten, `Math.imul`, `floor`, `min`, `max`, `abs`, `sqrt` ist ok; keine `sin`, `cos`, `exp`, `pow` mit Bruchexponent
  - kein `Date`, kein `Math.random`, kein DOM
  - Zufall nur ueber `createRng` / `rngForTurn` aus `js/rng.js`
  - immer nach ID sortieren, nie auf Objektreihenfolge verlassen
- Jedes Ereignis im Protokoll traegt eine deutsche Begruendung (`reason`) und einen Ort (`at`).
- Mobile-first: alles muss bei 390 x 844 (Hochkant, Touch) bedienbar sein, nicht nur bei 1280 x 800.
- Stile: Tag = Stil 01 Generalstabskarte, Nacht = Stil 04, Gedrucktes = Stil 03 (Plan 7.7, 7.8). Farben nur ueber CSS-Variablen und das Thema in `js/theme.js`, nie hart im Code verstreut.

## Erweiterbar bauen, damit parallele Threads sich nicht stoeren

- Neue Mechaniken kommen als eigenes Modul `js/phases/<name>.js` und melden sich in der Phasenliste an, statt `resolve.js` umzuschreiben.
- Neue Werkzeuge (Befehle in der Werkzeugreihe) melden sich ueber das Werkzeug-Register in `js/ui/` an.
- Daten (Einheiten, Gebaeude, Berichte, Missionen) als eigene Dateien unter `js/config/` bzw. `data/`, nicht in eine Riesendatei.
- Wenn du eine gemeinsame Datei aendern musst, halte die Aenderung klein und rebase direkt vor dem Merge auf `main`.

## Befehle

```bash
npm test                                   # Regeltests (node --test)
npm run serve                              # http://localhost:8080/
node tools/shot.mjs --dark                 # Screenshots Desktop + Handy, hell + dunkel, nach shots/
node tools/shot.mjs --path "/?scene=gefecht" --name gefecht --dark
node tools/shot.mjs --tablet --dark       # zusaetzlich iPad hoch und quer (Touch)
node tools/shot.mjs --check                # nur Konsolenfehler und fehlende Dateien pruefen (laeuft auch in CI)
node tools/precache.mjs                    # nach neuen/entfernten Dateien: Offline-Liste in sw.js neu schreiben (Test prueft das)
```

Ansichten sind Szenen: `index.html?scene=<name>` laedt `js/scenes/<name>.js` und ruft `mount(root, params)` auf (Muster: `js/scenes/beispiel.js`). Jedes Paket legt eigene Szenen an, statt `js/main.js` zu aendern. Weitere Query-Parameter (z. B. `&seed=42&night=1`) machen Screenshots reproduzierbar.

## Ablauf pro Arbeitspaket

1. `git fetch origin main` und den eigenen Branch frisch von `origin/main` abzweigen.
2. Plan-Abschnitte des Pakets lesen, Mockup-Bilder des Pakets ansehen (`docs/bilder/`).
3. Bauen, mit Tests fuer jede Regel. `npm test` muss gruen sein.
4. Bei jeder sichtbaren Aenderung: Screenshots mit `node tools/shot.mjs ... --dark` machen, selbst ansehen und gegen Mockup und Plan pruefen (Lesbarkeit, Kontrast, Handy-Layout, Ueberlappungen, abgeschnittene Texte).
5. Review mit frischem Blick: einen Subagenten ohne deinen Kontext den Diff reviewen lassen (Korrektheit, Determinismus, offensichtliche Fehler, UX-Bruchstellen) und die Screenshots beurteilen lassen. Funde beheben, dann erneut testen.
6. PR gegen `main` oeffnen, CI abwarten (Tests und Browser-Pruefung). Bei Gruen selbst mergen (Squash). Kein Merge mit roter CI, keine Tests abschalten. GitHub Pages baut direkt aus `main` (Wurzel, `.nojekyll`): jeder Merge ist sofort live.
7. `docs/status.md` aktualisieren (was fertig ist, was offen ist, bekannte Macken). Kreative Zusatzideen, die nicht ins Paket passen, nach `docs/ideen.md`.
8. Nach dem Merge pruefen, dass der Workflow-Lauf "pages build and deployment" auf `main` erfolgreich war (GitHub-MCP `actions_list`). Die Seite https://hjorven.github.io/lehmfront/ ist aus dem Container nicht direkt abrufbar.

## Kreativitaet

Der Spieler soll ueberrascht werden. Pro Paket mindestens eine eigene, kleine, ueberraschende Idee einbauen, die zum Ton passt (z. B. die Karte reagiert auf das Geschehen, Bleistiftnotizen, Blaetter, die sich bewegen). Im PR-Text unter "Ueberraschung" beschreiben. Plan-Regeln von Poly Battle gelten: keine Verlaufs- oder Glow-Rahmen, keine Neonfarben, hoher Kontrast.
