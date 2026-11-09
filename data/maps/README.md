# Kartenformat

Karten liegen als JSON unter `data/maps/<id>.json` und werden mit `loadMap(json)` aus `js/map.js` geladen und geprüft.
Felder sind 0-basiert (x nach Osten, y nach Süden); Spielern wird 1-basiert angezeigt (`cellLabel(30, 8)` ergibt `31/9`, wie am Kartenrand).
Ein Feld sind 10 Meter.

| Schlüssel | Inhalt |
|---|---|
| `id`, `name` | Kennung und Anzeigename |
| `sheet` | Kartenblatt: `title`, `blatt`, `scale`, `seed`. Der Seed bestimmt Knickfalten, Eselsohr und Kaffeerand, damit jede Mission anders aussieht |
| `width`, `height` | Größe in Feldern |
| `terrain` | Zeilen als Text, ein Zeichen je Feld: `.` Lehm, `k` Kreide, `f` Fels, `s` Sumpf, `w` Wald, `d` Dorf, `~` Wasser |
| `heights` | Zeilen, Ziffer 0 bis 3 je Feld |
| `zones` | Zeilen: `E` Etappe, `S` Stellung (eigen), `N` Niemandsland, `s` Stellung (Feind), `e` Etappe (Feind) |
| `trenches` | `{x, y, side: own/enemy, kind: fire/comm, level: 1..4 (Schützenloch, Schützengraben, ausgebaut, betoniert), facing: N/NE/E/SE/S/SW/W/NW}` je Grabenfeld. `fire` = Feuergraben (Rechteckwelle), `comm` = Laufgraben (Zickzack) |
| `wire` | `{x, y, side}` je Drahtfeld |
| `craters` | `{x, y, size: 1/2}` |
| `rails` | `[x, y]` je Gleisfeld (Feldbahn) |
| `buildings` | `{id, type, x, y, w, h, letter, label}`; Felder darunter sind belegt und nicht begehbar. `type: unterstand` wird als kleines Quadrat gezeichnet |
| `cables` | Fernsprechleitungen als Linienzug in Weltkoordinaten (Felder, Kommazahlen erlaubt) |
| `labels` | Beschriftungen `{text, x, y, size, rotate (Grad), font: head/num/hand, color: Themenschlüssel, alpha}` |
| `notes` | Bleistiftnotizen `{text, x, y, to: [x, y], rotate}`: handschriftlich, mit Pfeil auf `to` |

Die Asse-Karte wird erzeugt, nicht von Hand geschrieben:

```bash
node tools/maps/asse.mjs
```

Die Karte Hügel 214 (Akt 2) entsteht ebenso mit `node tools/maps/huegel214.mjs`, ihre Szenarien mit `node tools/scenarios/akt2.mjs`; `test/akt2.test.js` prüft beide.
Die Karte Kroning (Akt 3, Winter) entsteht mit `node tools/maps/kroning.mjs`, ihre zehn Szenarien (sechs Missionen mit Varianten) mit `node tools/scenarios/akt3.mjs`; `test/akt3.test.js` prüft beide.

Die Karten Raudas und Fährhaus (Akt 4, Frühling) entstehen mit `node tools/maps/akt4.mjs`, ihre fünfzehn Szenarien (sechs Missionen mit Varianten) mit `node tools/scenarios/akt4.mjs`; `test/akt4.test.js` prüft beide.

Ein Test (`test/map.test.js`) prüft, dass die Datei einem neuen Lauf des Generators entspricht. Wer die Karte ändert, ändert den Generator und lässt ihn laufen.
