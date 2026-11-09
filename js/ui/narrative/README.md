# Erzählung (P15)

Briefe, Tagebuch, Feldpost, Gefallenenliste, Zeitungen, Aktkarten und Fundstücke zwischen den Missionen (Plan 2.5, 7.5, 7.8).
Demo: `index.html?scene=erzaehlung` (Parameter im Kopf von `js/scenes/erzaehlung.js`).

## Für die Kampagne (P14)

```js
import { playPrologue, playInterlude, showJournal, createCampaign } from './js/ui/narrative/index.js';

let campaign = createCampaign({ side: 'a', faction: 'kaldern', seed: 1234 });
campaign = (await playPrologue({ campaign })).campaign;      // Zeitungen, Aktkarte I, Lage und Befehl a1m1

// nach jeder Mission
const r = await playInterlude({
  campaign, mission: 'a1m1', outcome: 'sieg',                 // oder 'niederlage'
  archive,                                                    // Protokoll-Archiv der Mission (P07, js/archive.js)
  finalState,                                                 // Spielzustand am Ende (Moral, Wetter, Tag, Gruppen)
  map,                                                        // Karte fuer Ortsangaben in der Feldpost
  finds: ['fund.heuwagen.1'],                                 // in der Mission gefundene Stuecke (P16 ff.)
  letterCount: 3,                                             // Feldpost-Briefe (Feldpostamt P11 darf erhoehen)
  storyValues: { gruppe: '2. Gruppe', gruppenfuehrer: 'Dirk Lohmann' }, // optional: {gruppe} in festen Texten
});
campaign = r.campaign;                                        // Ansehen, Vertrauen, Flags, Buch fortgeschrieben

showJournal({ campaign });                                    // jederzeit, z. B. Taste T
```

Der Kampagnenzustand ist reines JSON (`createCampaign` in `js/narrative/interlude.js`):
`{ side, faction, ansehen, vertrauen, flags, outcomes, seed, book: { fallen, diary, letters, finds, decisions } }`.
P14 setzt vor `playInterlude` die Flags der Mission (`harms_gefallen`, `velde_verloren`, ...), rechnet die Folgen des
Stabsbefehls (`folgen.erfuellt/verfehlt`) und prüft die vorzeitigen Enden. Entscheidungen wendet `playInterlude` selbst an.
Nach jeder Wahl löst `playInterlude` die restlichen Entscheidungen, Briefing und Befehl neu auf (`tailSteps`), weil eine
Wahl sie umschalten kann (a2m5 `vell_angriff`, a4m6 `lask_gemeldet`). Nach a4m6 kommen keine Briefe und keine Feldpost:
die Schlusssequenz (P26) zeigt `brief.24` selbst. Bricht P14 den Tisch mit `destroy()` ab, endet `done` mit `aborted: true`.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/narrative/texts.js` | rein: Index aller Texte, `matches` (wann), `pickSlot`, `resolveEntries`, `fill`, Missionsfolge |
| `js/narrative/casualties.js` | rein: Namen für die Gefallenenliste aus `losses`, `wounded` (P08), `group_lost`, `wounded_waiting`; `registerCasualtySource` |
| `js/narrative/stats.js` | rein: Statistiken für `wann.werte`; `registerStat` |
| `js/narrative/places.js` | rein: Ortsangabe für `{ort}` (nächster benannter Ort der Karte, sonst Zone), heikle Orte |
| `js/letters.js` | rein: generierte Feldpost, drei Tonlagen, Ereignis aus dem Protokoll; `registerLetterCategory` |
| `js/narrative/sheets.js` | rein: Texte als Blätter der Papierebene (Z1-Format) |
| `js/narrative/interlude.js` | rein: Ablauf zwischen zwei Missionen, Prolog, Entscheidungen, Buch fortschreiben |
| `js/ui/narrative/reader.js` | der Tisch: Blätter nacheinander, Ablage, Entscheidung hält an, Tasten Enter/→ und 1 bis 4 |
| `js/ui/narrative/journal.js` | Tagebuch der Kommandantin mit Buch des Abschnitts, Fundstücken, Briefen |
| `js/ui/narrative/kinds.js` | Blattarten `briefing` und `decision`, Bilder `stain`, `flur`, `postcard` |

## Neue Ereignisse anmelden

- Feldpost: `registerLetterCategory('artillery_hit', 'artillerie')` aus `js/letters.js` (Kategorien wie in `templates.json`).
- Gefallenenliste: `registerCasualtySource('gas', (event, h) => [{ group, count, cause: 'gas', kind: 'fallen' }])`.
- Statistik für Texte: `registerStat('gas_angriffe', ({ rounds, side }) => ...)`.

## Feldpost

Pro Brief eine lebende eigene Gruppe. Tonlage aus Moral der Gruppe und Vertrauen (README der Texte). Das Ereignis ist das
schwerste, was die Gruppe in der Mission erlebt hat (Gefallene vor Verwundeten vor Sturm ... vor ruhig); im selben Stapel
wiederholt sich eine Kategorie erst, wenn nichts anderes mehr da ist. Die Feldpostprüfstelle schwärzt militärische Orte
(Hügel, Schacht, Abschnitt, Depot) und in verbitterten Briefen jeden genannten Ort.

Briefe tragen Flecken nach Wetter und Tageszeit der Mission: Wasserränder mit verlaufener Tinte bei Regen, Lehmfinger bei
Schlamm, klammes Papier bei Nebel, Frostkristalle, Wachstropfen und schiefe Zeilen nachts. Auch die festen Briefe der Geschichte.
