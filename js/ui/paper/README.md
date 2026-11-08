# Papierebene (`js/ui/paper/`)

Briefe, Telegramme, Tagebuchseiten, Gefallenenlisten, Zeitungen, Fundstücke und Aktkarten liegen als echte Blätter über der Karte (Plan 2.5, 7.5). Demo: `index.html?scene=papier`.

## Einbinden

```js
import { loadPaperStyles, createPaperLayer } from '../ui/paper/index.js';

await loadPaperStyles();                      // css/paper.css und Schriften laden, sonst stimmen die Masse nicht
const paper = createPaperLayer(hostElement, {  // hostElement braucht position: relative (oder absolute)
  light: 'auto',                               // 'auto' (Systemmodus), 'day', 'night'
  reducedMotion: undefined,                    // undefined = prefers-reduced-motion beachten
  tiltSensor: true,                            // Neigungssensor auf Handys (iOS fragt bei der ersten Berührung)
  cps: 28,                                     // Anschläge pro Sekunde beim Tippen
  hooks: { onKey, onLine, onStamp, onTyped, onAdd, onFront, onFlip, onMove, onDismiss },
});
paper.add(blatt, { typed: true });             // gibt die id zurück; gleiche id holt das Blatt nur nach vorn
```

Die Ebene selbst lässt Zeiger durch (`pointer-events: none`), nur Blätter und die Ablage fangen sie. Die Karte darunter bleibt bedienbar.

### Schnittstelle

| Aufruf | Wirkung |
|---|---|
| `add(blatt, { x, y, rot, typed, animate })` | Blatt auflegen. Ohne `x`/`y` legt `placeSheet` es deterministisch aus der id |
| `front(id)` | nach vorn holen |
| `flip(id)` | umdrehen, nur Blätter mit Rückseite |
| `dismiss(id)` | wegwischen, landet in der Ablage |
| `restore()` | zuletzt abgelegtes Blatt zurückholen (auch per Klick auf die Ablage) |
| `remove(id)` | ohne Ablage entfernen |
| `clear()` | alles weg, Ablage leer |
| `ids()` | Stapelreihenfolge, oberstes Blatt zuletzt |
| `pileCount()` | Anzahl in der Ablage |
| `setLight('day' \| 'night' \| 'auto')` | Papier wie unter der Lampe |
| `destroy()` | Ebene und Listener entfernen |

### Hooks für den Klang (K1)

| Hook | Wann | Argument |
|---|---|---|
| `onKey` | jeder getippte Buchstabe | `{ sheetId, char, line }` |
| `onLine` | Zeile fertig (Wagenrücklauf) | `{ sheetId, index, text }` |
| `onStamp` | Stempel schlägt auf, nach dem Tippen | `{ sheetId }` |
| `onTyped` | Telegramm komplett | `{ sheetId }` |
| `onFront`, `onFlip`, `onMove`, `onDismiss`, `onAdd` | Papiergeräusche | `{ sheetId, ... }` |

Bei reduzierter Bewegung wird nicht getippt (Text steht sofort da), nichts kippt oder fliegt.

## Bedienung

- Maus: Bewegen über dem Blatt kippt es. Klick holt es nach vorn. Klick auf das vordere Blatt dreht es um, wenn es eine Rückseite hat.
- Touch: Antippen wie Klick. Das Handy neigen kippt alle Blätter ein wenig (Neigungssensor).
- Ziehen verschiebt. Ein schneller Wurf oder Ziehen über den Rand wischt das Blatt weg in die **Ablage** unten links. Antippen der Ablage holt das zuletzt abgelegte zurück.
- Tastatur: Tab wählt ein Blatt, Enter/Leertaste holt nach vorn bzw. dreht um, Pfeile verschieben (mit Umschalt weiter), Entf legt ab.
- Tippen eines Telegramms lässt sich durch Antippen sofort beenden.

## Datenformat

T1 (`data/texts/README.md`) war beim Bau noch nicht auf `main`, daher ein eigenes, einfaches Format. Jedes Blatt ist ein Objekt mit `id` (eindeutig, bestimmt auch die Lage) und `kind`. Texte sind deutsche Zeichenketten mit echten Umlauten. `body` darf ein String (Absätze durch Leerzeile getrennt) oder eine Liste von Absätzen sein.

**Zensur:** In `letter.body` und `diary.body` wird Text in `[[doppelten eckigen Klammern]]` von der Feldpostprüfstelle geschwärzt; der Brief bekommt dann automatisch den Prüfstempel. Der geschwärzte Text kommt nicht ins DOM.

| kind | Stil | Felder |
|---|---|---|
| `letter` | Handschrift auf Briefpapier | `place`, `date`, `salutation`, `body`, `closing`, `signature`, `examined` (Prüfstempel erzwingen), `examinedBy` |
| `telegram` | Stil 03 Feldtelegramm, Stabsbefehl | `heading` (z. B. `STABSBEFEHL`), `number`, `urgent` (Stempel EILT), `urgentText`, `fields: [[Bezeichnung, Wert], ...]`, `lines: [...]`, `footer: [[Bezeichnung, Wert], ...]`, `typed` |
| `diary` | Stil 06 Aquarell | `date`, `title`, `body`, `signature`, `sketch` (`huegel`, `regen` oder `false`), `seed` |
| `casualties` | Schreibmaschine, Formular | `title`, `form`, `sector`, `mission`, `date`, `entries: [{ name, group, turn, cause }]`, `note`, `signedBy` |
| `newspaper` | Stil 10 Zeitungsdruck | `masthead`, `date`, `issue`, `price`, `headline`, `subhead`, `picture` (`false` = ohne Bild), `pictureCaption`, `columns`, `seed` |
| `photo` | Fundstück, Sepia | `motif` (`graben`, `gruppe`, `dorf`), `caption`, `back` (Handschrift auf der Rückseite), `printer`, `seed` |
| `actcard` | Stil 08 Linolschnitt | `act` (z. B. `Akt II`), `title`, `subtitle`, `motif` (`sonne`, `leuchtkugel`), `seed` |

Bilder (Foto, Aquarell, Linolschnitt, Zeitungsraster) entstehen prozedural aus `seed` (Standard: `id`) und sind damit für jede id gleich.

Beispiele: `data/paper/demo.json`.

## Neue Blattarten

```js
import { registerKind, el } from './js/ui/paper/registry.js';
registerKind('flugblatt', {
  label: 'Flugblatt',
  render(d) { return { front: el('div', 'paper-flugblatt-body', d.text), back: null, title: 'Flugblatt' }; },
});
```

Das Blatt bekommt die Klasse `paper-<kind>`; Breite über `--w`, Papierfarbe über `--face`. Farben als Variablen auf `.paper-layer` in `css/paper.css` (Tag und Nacht).

## Reine Funktionen

`layout.js` (Lage, Kippen, Wegwisch-Entscheidung, Stapel, Tippplan, Zensur) hat kein DOM und kein `Math.random`; Tests in `test/paper.test.js`.
