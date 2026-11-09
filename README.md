# Lehmfront

Taktisches Grabenkriegsspiel in 2D für den Browser. Beide Seiten planen gleichzeitig, dann wird die Runde nach festen Phasen aufgelöst (WEGO). Die Welt ist fiktiv: der Lehmgau an der Asse, die Fraktionen Kaldern und Morrow.

**Spielen:** https://hjorven.github.io/lehmfront/

Läuft ohne Installation auf Desktop, Tablet und Handy (ab 390 x 844, ganz per Touch), lässt sich als App installieren und funktioniert danach auch offline.

**Neu hier?** Im Hauptmenü oben die **Grundausbildung** wählen (zehn Minuten, Schritt für Schritt im Spiel). Die Anleitung mit Bildern steht in [`docs/tutorial.md`](docs/tutorial.md), alle Begriffe im **Handbuch** im Spiel.

## Spielmodi

| Modus | Inhalt |
|---|---|
| Grundausbildung | Erste Partie an der Asse mit einem Zettel, der jeden Schritt erklärt und abhakt |
| Kampagne | Feldzug an der Asse in vier Akten mit je sechs Missionen, Stabsbefehlen, Ansehen beim Stab und Vertrauen der Truppe, vier Enden |
| Gefecht frei | Asse-Nord, drei Spiegelkarten oder Zufallskarte; Dauer, Fraktion und Schwierigkeit wählbar |
| Tageslage | Für alle dieselbe Woche an einem Tag, mit Wachbuch |
| Frontabschnitt | Endlosmodus mit Wochen, Jahreszeiten, Stabsbefehlen und Buch des Abschnitts |
| Hotseat | Zwei an einem Gerät, Übergabe im versiegelten Umschlag |
| Koop | Zwei gegen die KI an einem Gerät, je ein Abschnitt |
| Fernsprechamt | Online-Zweikampf per Code (Supabase) |
| Lehrgang | Zwölf Puzzle-Lagen mit fester Lösung |
| Werkstatt | Missionseditor und Sandkasten, Lagen als Code, Link oder Datei |

## Kampagne

1. **Akt 1** „Erstarrung“: sechs Missionen mit eingebauter Einweisung (Graben, MG, Draht, Lorenplan, Artillerie, Ablösung).
2. **Akt 2** „Lehm und Regen“: Sappen, Stollen, Horchposten, Stoßtrupps bei Nacht, Offiziere und Veteranen.
3. **Akt 3** „Materialschlacht“: Gas mit Wind, Waffenruhe und Bergen, Feldgeschütz, Flammenwerfer, Flieger, Tarnung.
4. **Akt 4** „Das letzte Frühjahr“: Panzerwagen, Große Mine, Sprengfallen, Pionierbrücke, Verweigerung der Truppe, vier Enden.

Zwischen den Missionen: Zeitungen beider Seiten, Feldpost, Gefallenenliste, Tagebuch und ein Tisch mit Fundstücken.

## Regeln in Kürze

- Stellungsrunden (12 Stunden) zum Graben, Versorgen und Planen, Gefechtsrunden (5 Minuten) im Angriff.
- Gräben mit Stufen und Feuerrichtung, Traversen, Draht, Unterstände, Entwässern.
- Feuer mit Sichtlinien, Unterdrückung und MG-Kegeln, Nebel des Krieges, Leuchtkugeln bei Nacht.
- Artillerie mit Feuerplänen, Beobachtern, Telefonleitungen und Gegenbatterie.
- Versorgung über Depot, Feldbahn und Lorenplan, Sanitätskette, Etappe mit Gebäuden.
- Wetter, Schlamm, Tag und Nacht, Moral, Erschöpfung, Ablösung und Ersatz.
- KI-Kommandant mit Doktrinen und drei Schwierigkeiten, Taktik-Lehrling als Ratgeber.
- Nach jeder Partie gibt es einen Wiedergabe-Link, der ohne Server funktioniert.
- Deterministisch: gleicher Seed und gleiche Befehle ergeben denselben Verlauf. Jedes Ereignis im Protokoll trägt eine Begründung.

## Bedienung

- Werkzeugreihe unten, Befehlskreis per langem Druck, Tastenkürzel (Liste im Dienstbuch, Taste O).
- Mit dem Finger wird ein Ziel erst vorgemerkt und mit dem zweiten Tippen bestätigt.
- Dienstbuch: Spielstände (laufende Akte, drei Kartentaschen, Export und Import), Klang, Animationstempo, reduzierte Bewegung, Textgröße, farbunabhängige Signaturen, hoher Kontrast.
- Klang ist prozedural (WebAudio), es gibt keine Audiodateien.

## Lokal starten

Kein Build-Schritt, reine ES-Module. Node.js 22 wie in der CI.

```bash
npm test
npm run serve
```

Danach http://localhost:8080/ öffnen. Einzelne Ansichten lassen sich direkt laden, z. B. http://localhost:8080/?scene=gefecht-frei oder http://localhost:8080/?scene=feldzug.

Weitere Werkzeuge:

```bash
node tools/shot.mjs --dark          # Screenshots Desktop und Handy, hell und dunkel, nach shots/
node tools/shot.mjs --check         # Konsolenfehler und fehlende Dateien prüfen (läuft auch in CI)
node tools/precache.mjs             # Offline-Dateiliste in sw.js neu schreiben
node tools/playthrough.mjs          # Hauptmodi im Browser durchspielen
node tools/balance.mjs --runs 150   # Balancing KI gegen KI
node tools/tutorial-shots.mjs       # Bilder der Anleitung neu erzeugen (docs/bilder/tutorial/)
```

## Aufbau

| Ordner | Inhalt |
|---|---|
| `js/` | Spiellogik als reine Funktionen (`rules.js`, `resolve.js`, `map.js`, `js/phases/`), Darstellung (`js/render/`), Oberfläche (`js/ui/`), Szenen (`js/scenes/`) |
| `data/` | Karten, Szenarien, Missionen, Puzzle-Lagen, Texte und Briefe |
| `css/`, `assets/` | Stile, Schriften (mit Lizenzen), Symbole |
| `supabase/` | Schema und Functions für den Online-Modus |
| `test/` | Regeltests (`node --test`) |
| `tools/` | Screenshots, Simulator, Karten- und Szenario-Generatoren |
| `vendor/` | supabase-js als lokale Datei, keine CDNs zur Laufzeit |

## Dokumentation

- Anleitung für Einsteiger mit Bildern: `docs/tutorial.md`
- Spielplan: `docs/plan.md`
- Stand und bekannte Macken: `docs/status.md`
- Änderungen je Version: `CHANGELOG.md`
- Online-Modus einrichten und neu pinnen: `docs/online.md`
- Arbeitspakete: `docs/arbeitspakete.md`
- Ideen: `docs/ideen.md`
- UI-Mockup: `docs/mockup/lehmfront-ui.html`
- Arbeitsregeln für Beiträge: `CLAUDE.md`

GitHub Pages baut direkt aus `main` (Wurzel, `.nojekyll`). Jeder Merge ist sofort live.
