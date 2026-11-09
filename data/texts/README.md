# Spieltexte: Datenformat

Alle Spieltexte liegen als Daten unter `data/texts/` und `data/letters/`, nie im Code.
Dieses Format gilt für alle Text-Pakete (T1 Akt 1 und 2, T2 Akt 3 und 4) und für alle Pakete,
die Texte anzeigen (Z1 Papierebene, P14 Kampagne, P15 Erzählung, P16 Missionen).
Die Welt, die Namen und die Stimmen der Figuren stehen in [`welt.md`](welt.md).

`test/texts.test.js` prüft alle JSON-Dateien in beiden Ordnern automatisch: gültiges JSON,
eindeutige IDs über alle Dateien, nur bekannte Platzhalter, nur bekannte Bedingungen,
jede Variantengruppe mit genau einem Rückfall. Neue Dateien muss man nirgends eintragen.

## Dateien

| Datei | Inhalt | Paket |
|---|---|---|
| `data/texts/placeholders.json` | Liste aller erlaubten Platzhalter | T1, Erweiterung durch alle |
| `data/texts/akt1.json` | Akt 1: Briefings, Stabsbefehle, Entscheidungen, Tagebuch | T1 |
| `data/texts/akt2.json` | Akt 2: dasselbe | T1 |
| `data/texts/akt3.json`, `akt4.json` | Akt 3 und 4 | T2 |
| `data/texts/berichte.json` | Erfahrungsberichte | T1 |
| `data/texts/tutorial.json` | Tutorial-Hinweise Akt 1 | T1 |
| `data/letters/briefe-akt1-2.json` | Handgeschriebene Briefe 01 bis 12, Lasks abgefangene Briefe Akt 1 und 2 | T1 |
| `data/letters/briefe-akt3-4.json` | Briefe 13 bis 24, Lasks Briefe Akt 3 und 4 | T2 |
| `data/letters/templates.json` | Vorlagen für generierte Feldpost und Ereignis-Sätze | T1 |
| `data/texts/enden.json` | Auswahl des Endes, vier Schlusssequenzen, vorzeitige Enden, Nachwort | T2 |
| `data/texts/zeitungen.json` | Was die Zeitungen schreiben, vor und zwischen den Akten | T2 |
| `data/texts/fundstuecke.json` | 24 Fundstücke in sechs Ketten | T2 |
| `data/texts/endlos.json` | Endlosmodus: Wochenbefehle, Wochenanfang, Jahreszeiten, Ende | T2 |
| `data/texts/erfolge.json` | 40 Erfolge | T2 |

Alle Dateien folgen demselben Aufbau. Einzelheiten zu den T2-Dateien unter „Ergänzungen aus T2“.

## Aufbau einer Datei

```json
{
  "format": 1,
  "beschreibung": "Akt 1: Erstarrung",
  "eintraege": [
    { "id": "a1m1.briefing", "art": "briefing", "text": "..." }
  ]
}
```

Jede Datei hat genau diese drei Schlüssel (einzige Ausnahme: `placeholders.json` mit `platzhalter`). Alles Inhaltliche steht als Eintrag in `eintraege`.
Die Reihenfolge im Array ist bedeutsam (Varianten, siehe unten), sonst wird nach `id` gesucht.

## Gemeinsame Felder jedes Eintrags

| Feld | Pflicht | Bedeutung |
|---|---|---|
| `id` | ja | Eindeutig über alle Dateien. Kleinbuchstaben, Ziffern, `-`, `_`, Teile mit Punkt getrennt, z. B. `a1m3.befehl`, `brief.07`, `feldpost.erschoepft.04` |
| `art` | ja | Was der Eintrag ist, siehe Tabelle Arten |
| `text` | ja | Der Text. Absätze mit `\n\n`, harte Zeilenumbrüche mit `\n`. Platzhalter in geschweiften Klammern |
| `blatt` | nein | Blattart für die Papierebene (Z1): `brief`, `telegramm`, `tagebuch`, `gefallenenliste`, `zeitung`, `foto`, `aktkarte`. Fehlt es, ist es UI-Text ohne Blatt |
| `mission` | nein | Missions-ID, zu der der Eintrag gehört: `a1m1` bis `a4m6` (Akt, Mission) |
| `nach` | nein | Missions-ID, nach deren Ende der Eintrag erscheint (Briefe, Tagebuch, Entscheidungen zwischen Missionen) |
| `slot` | nein | Variantengruppe, siehe unten |
| `wann` | nein | Bedingung, siehe unten. Fehlt sie, gilt der Eintrag immer |
| `ton` | nein | Tonlage `zuversichtlich`, `erschoepft` oder `verbittert` (Pflicht bei Feldpost) |

Echte Umlaute in allen Texten. Keine Emojis. Keine realen Länder, Personen, Symbole.

## Arten

| `art` | Zusatzfelder | Wofür |
|---|---|---|
| `akt` | `titel`, `zeit` | Aktkarte (Linolschnitt) beim Aktwechsel, id `a1.titel` usw. |
| `briefing` | `titel`, `ort`, `zeit`, `ziele` (Liste von Texten) | Missionsbriefing vor einer Mission, auch mit `slot` und Varianten |
| `befehl` | `nr`, `von`, `an`, `abschnitt`, `frist`, `eilt` (bool), `folgen` (`erfuellt`, `verfehlt`) | Stabsbefehl als Telegramm. Text in Großbuchstaben, Sätze enden mit ` STOP` |
| `entscheidung` | `titel`, `optionen` | Entscheidung mit Folgen für Ansehen und Vertrauen |
| `tagebuch` | `titel` | Brandts Tagebucheintrag, immer mit `slot` und Varianten |
| `brief` | `nr`, `absender`, `empfaenger`, `ort` | Handgeschriebener Brief (24 im ganzen Spiel, `nr` 1 bis 24) |
| `lask` | `absender`, `empfaenger`, `vermerk`, `doktrin` | Abgefangener Brief von Hauptmann Lask. `vermerk` ist der Übersetzungsvermerk der Fernmeldestelle, unter den Brief gesetzt (Schreibmaschine) |
| `feldpost` | `ton` (Pflicht), `fraktion` | Vorlage für generierte Feldpost |
| `ereignis` | `kategorie` | Satz, der in `{ereignis}` einer Feldpost eingesetzt wird |
| `anrede` | `empfaenger`, `fraktion` | Anrede für generierte Feldpost, Text z. B. `Lieber Vater` |
| `bericht` | `titel`, `ab`, `ausloeser`, `zaehler`, `wirkung` | Erfahrungsbericht (Plan 4.3). `zaehler` = `{ "ereignis": "<protokoll-typ>", "anzahl": n }` ist ein Vorschlag für P14 |
| `hinweis` | `mechanik`, `von`, `ausloeser`, `anker` | Tutorial-Hinweis als Bleistiftnotiz einer Figur (`von`) am Kartenrand, höchstens 160 Zeichen. Jede `mechanik` nur einmal |
| `akt` | `titel`, `untertitel` | Titelkarte eines Akts (Stil 08), id `a<n>.titel` |
| `zeitung` | `zwischen`, `zeitung`, `fraktion`, `titel`, `unterzeile`, `randnotiz` | „Was die Zeitungen schreiben“ (Stil 10), siehe unten |
| `fundstueck` | `typ`, `kette`, `kette_nr`, `akt`, `titel`, `fundort`, `bild`, `rueckseite` | Fundstück mit Nebengeschichte im `text`, siehe unten |
| `fundstueck-kette` | `kette`, `titel` | Ende einer Fundstück-Kette, erscheint, wenn alle vier Stücke gefunden sind |
| `ende-wahl` | `ende`, `titel`, `setzt` | Auswahl des Endes, Slot `ende.wahl`, siehe unten |
| `ende` | `ende`, `seite`, `titel` | Eine Seite der Schlusssequenz eines Endes |
| `nachwort` | `figur` | „Was aus ihnen wurde“ nach der Schlusssequenz |
| `erfolg` | `titel`, `ausloeser` | Erfolg (Stil 08), keine Punkte, keine Orden |
| `endlos-befehl` | `befehlsart`, `titel`, `frist`, `eilt`, `folgen` | Vorlage für den Stabsbefehl einer Woche im Endlosmodus |
| `endlos-stab` | `fraktion`, `von` | Absender und Unterschrift (`text`) des Stabs im Endlosmodus, füllt `{stab}` |
| `endlos-woche` | | Satz zum Wochenanfang, Slot `endlos.woche` |
| `jahreszeit` | `jahreszeit`, `teil` (`wechsel` oder `wetter`) | Texte für die Jahreszeiten im Endlosmodus |
| `endlos-ende` | `grund` | Ende des Endlosmodus: `abschnitt_gefallen`, `abgeloest`, `meuterei` |
| `stab-antwort` | `band` | Antwort des Stabs auf der Feldzugskarte (P14), Slot `stab.antwort`, je tiefer das Ansehen, desto knapper (`data/texts/stab.json`) |
| `stab-drohung`, `stab-stempel`, `stab-berichte` | | Drohung unter 25, Antwort auf Umdeuten/Verweigern, zurückgehaltene Berichte (P14) |

T2 und spätere Pakete dürfen neue Arten einführen (`zeitung`, `fundstueck`, `ende`, `erfolg`,
`endlos-befehl`, `jahreszeit` ...). Sie tragen sie hier in die Tabelle ein; der Test prüft
für unbekannte Arten nur die gemeinsamen Felder.

### Folgen

`folgen` ist ein Objekt mit Änderungen der beiden Achsen (Plan 2.6), ganze Zahlen:

```json
{ "ansehen": 8, "vertrauen": -4 }
```

Bei `befehl` gibt es zwei: `"folgen": { "erfuellt": {...}, "verfehlt": {...} }`.

### Entscheidungen

```json
{
  "id": "a2m5.entscheidung",
  "art": "entscheidung",
  "nach": "a2m4",
  "titel": "Vell will angreifen",
  "text": "Situation, aus Brandts Sicht beschrieben.",
  "optionen": [
    {
      "id": "aufhalten",
      "label": "Vell zurückhalten",
      "text": "Was danach geschieht, ein bis drei Sätze.",
      "folgen": { "ansehen": -8, "vertrauen": 6 },
      "setzt": ["vell_zurueckgehalten"]
    }
  ]
}
```

Options-IDs sind frei, für Stabsbefehle aber nach Plan 2.5 bevorzugt `befolgen`, `umdeuten`, `verweigern`.
`setzt` setzt Flags im Kampagnenzustand, die spätere `wann`-Bedingungen lesen.

## Reihenfolge zwischen den Missionen

Nach dem Ende einer Mission zeigt P15 die Einträge mit `nach` gleich dieser Mission in dieser Reihenfolge:
Gefallenenliste, Tagebuch, Briefe (`brief`, dann `lask`), Entscheidungen, dann Briefing und Stabsbefehl der
nächsten Mission. Entscheidungen kommen zuletzt, weil Briefe sie vorbereiten (Selin bittet um Loren, dann
entscheidet Brandt). Flags aus einer Entscheidung wirken deshalb erst ab der nächsten Mission
(Ausnahme: Entscheidungen mit `mission`, siehe „Entscheidungen vor oder in einer Mission“).

Harms ist in Akt 1 als Figur auf der Karte und kann nur in Mission a1m6 fallen (P16 setzt `harms_gefallen`).
In Akt 2 führt er den Gefechtsstand und steht nicht auf der Karte; ab Akt 3 entscheidet T2. Vell kann nur in
a2m5 fallen, und nur nach `vell_angriff`. Texte danach erwähnen beide nur in Varianten mit `flags`/`ohne`,
sonst übernimmt Feldwebel Fedders ihre Rolle. Erzählte Tode in festen Texten (Tjark Boysen und Folkert Ubben
in a2m2) trägt P15 zusätzlich in die Gefallenenliste ein.

## Varianten: `slot` und `wann`

Einträge mit gleichem `slot` sind Varianten desselben Textes, z. B. Brandts Tagebuch nach Mission 3.
Die Anzeige nimmt **den ersten Eintrag im Array, dessen `wann` erfüllt ist**. Der letzte Eintrag
eines Slots hat kein `wann` und ist der Rückfall, damit immer etwas erscheint. Der Test prüft das.

Einträge ohne `slot` mit `wann` erscheinen nur, wenn die Bedingung gilt (z. B. ein Brief, den es
nur gibt, wenn Harms gefallen ist), sonst gar nicht.

## Bedingungen (`wann`)

Alle Schlüssel müssen gleichzeitig gelten (UND). Für ODER gibt es `oder` mit einer Liste von Bedingungen.

| Schlüssel | Wert | Gilt, wenn |
|---|---|---|
| `ausgang` | `"sieg"`, `"niederlage"` oder Liste davon | Ausgang der Mission aus `mission` bzw. `nach` |
| `ansehen` | `{ "min": 0, "max": 40 }` (beide Grenzen einschließlich, je optional) | Ansehen beim Stab im Bereich |
| `vertrauen` | wie `ansehen` | Vertrauen der Truppe im Bereich |
| `werte` | `{ "<statistik>": { "min": .., "max": .. } }` | Statistik der letzten Mission im Bereich, siehe unten |
| `flags` | Liste von Flag-Namen | alle gesetzt |
| `ohne` | Liste von Flag-Namen | keins gesetzt |
| `fraktion` | `"kaldern"` oder `"morrow"` | eigene Fraktion |
| `wetter` | `"trocken"`, `"regen"`, `"schlamm"`, `"nebel"`, `"frost"`, `"schnee"` oder Liste | Wetter der Runde bzw. Mission |
| `tageszeit` | `"tag"` oder `"nacht"` | Tageszeit der Runde |
| `oder` | Liste von Bedingungen | mindestens eine gilt |

### Statistiken der letzten Mission (`werte`)

Werden von P07/P14 aus dem Ereignisprotokoll gezählt.

| Name | Bedeutung |
|---|---|
| `gefallene` | Gefallene eigene Soldaten |
| `verwundete` | Verwundete eigene Soldaten |
| `verwundete_geborgen` | Per Lore oder Sanitäter zurückgebrachte Verwundete |
| `verwundete_liegen` | Liegen gelassene Verwundete |
| `gefangene` | Eingebrachte Gefangene |
| `felder_gewonnen` | Gewonnene Grabenfelder |
| `felder_verloren` | Verlorene Grabenfelder |
| `moral` | Abschnittsmoral am Ende, 0 bis 100 |
| `runden` | Gespielte Stellungsrunden |
| `depot_leer` | Wie oft das Depot leer lief |
| `abloesung_verspaetet` | Gruppen, die länger vorn blieben als vorgesehen |

### Flags

Flags sind Kleinbuchstaben mit `_`. Gesetzt durch Entscheidungen (`setzt`) oder durch Missionen (P16).
Bekannte Flags aus Akt 1 und 2:

| Flag | Gesetzt durch |
|---|---|
| `harms_gefallen` | Mission, wenn Feldwebel Harms fällt |
| `vell_gefallen` | Mission, wenn Leutnant Vell fällt (ab Akt 2) |
| `selin_loren` | Entscheidung a1m3: Brandt gibt dem Lazarett feste Loren |
| `faehre_sofort`, `faehre_spaet` | Entscheidung a1m2 (Fähre sofort oder erst um Mitternacht gesprengt) |
| `velde_verloren` | Mission a1m6, wenn sie verloren geht (Velde fällt, die Kellinger nehmen es vor Akt 2 zurück) |
| `kuhle_gehalten`, `kuhle_umgedeutet`, `kuhle_verweigert` | Entscheidung a1m5 |
| `verwundeter_geholt` | Entscheidung a2m3 |
| `orden_liste`, `urlaub_statt_orden` | Entscheidung a2m6 |
| `kirchturm_gesprengt` | Entscheidung a1m4 |
| `lask_bild_zurueck` | Entscheidung a1m6 |
| `stollen_frueh` | Entscheidung a2m2 |
| `doktrin_tiefe`, `doktrin_infiltration`, `doktrin_material` | Doktrinwahl a2m4 |
| `vell_zurueckgehalten`, `vell_angriff` | Entscheidung a2m5 |
| `trichter_gehalten` | Mission a2m6, wenn der Trichter gehalten wurde |
| `gas_abgeblasen`, `gas_batterien`, `gas_zurueck` | Entscheidung nach a3m3 |
| `befehl117_befolgt`, `befehl117_umgedeutet`, `befehl117_verweigert` | Entscheidung a3m4 |
| `waffenruhe_angenommen`, `waffenruhe_geduldet`, `waffenruhe_abgelehnt` | Entscheidung a3m5 |
| `kasten_durch`, `kasten_liegen` | Mission a4m2: Panzerwagen K1 erreicht das Ziel oder bleibt liegen (Wrack ab a4m3 auf der Karte) |
| `verweigerung_damm` | Mission a4m4, wenn eine Gruppe den Sturm verweigert hat |
| `waffenstillstand_gebrochen` | Mission a4m6, wenn nach Beginn des Waffenstillstands noch geschossen wurde |
| `ende_haelt`, `ende_waffenstillstand`, `ende_durchbruch`, `ende_abgeloest` | Feldzug vor a4m6 nach Ansehen und Vertrauen (`endingFor` in `js/campaign.js`) |
| `selin_fruehjahr_loren` | Entscheidung nach a3m6: zwei Loren nur für das Lazarett in Akt 4 |
| `mine_gezuendet`, `mine_gewarnt`, `mine_geflutet` | Entscheidung a4m3 (`mine_gewarnt` setzt auch `mine_gezuendet`) |
| `verweigerung_mitgegangen`, `verweigerung_harms`, `verweigerung_gemeldet`, `verweigerung_aufgehoben` | Entscheidung a4m4 |
| `lask_treffen`, `lask_gemeldet`, `lask_geschwiegen` | Entscheidung nach a4m5 |
| `ende_durchbruch`, `ende_waffenstillstand`, `ende_abgeloest`, `ende_haelt` | Auswahl des Endes (`ende.wahl`) |
| `jahreszeit_wechsel` | Endlosmodus: erste Woche einer neuen Jahreszeit |
| `ersatz_eingetroffen` | Endlosmodus: in dieser Woche kam Ersatz |

Spätere Pakete ergänzen die Tabelle.

## Ergänzungen aus T2 (Akt 3 und 4, Enden, Zeitungen, Fundstücke, Endlos, Erfolge)

Dateien: `akt3.json`, `akt4.json`, `enden.json`, `zeitungen.json`, `fundstuecke.json`, `endlos.json`,
`erfolge.json` in `data/texts/`, dazu `data/letters/briefe-akt3-4.json`.

### Optionen mit Bedingung

Eine Option einer Entscheidung darf ein eigenes `wann` haben. Gilt es nicht, wird die Option nicht
angeboten (Beispiel: `a4m4.entscheidung`, Option `harms` nur, wenn Harms lebt). Jede Entscheidung hat mindestens
eine Option ohne `wann`.

### Entscheidungen vor oder in einer Mission

Entscheidungen mit `mission` statt `nach` (a3m4, a3m5, a4m3, a4m4) fallen vor bzw. während der Mission
und bestimmen, wie sie gespielt wird. Ihre Flags gelten deshalb sofort, auch für Tagebuch und Briefe nach
derselben Mission. Ihre Optionen-`folgen` gelten sofort; die `folgen` des Stabsbefehls derselben Mission
kommen nach dem Ausgang dazu (beides addiert: Wer Befehl 117 verweigert und die Mission verliert,
verliert also zweimal Ansehen).

### Tagebuch nach einer Entscheidung

Ein Eintrag mit `nach_entscheidung` (ID einer Entscheidung) erscheint direkt nach dieser Entscheidung,
nicht mit dem übrigen Tagebuch der Mission. Er hat immer ein `wann` mit dem Flag der gewählten Option
(Beispiel: `a4m5.treffen`).

### Enden (`enden.json`)

1. **Auswahl** vor Mission a4m6: Slot `ende.wahl` wie jeder Slot auswerten (erster Eintrag, dessen `wann`
   gilt). Das Feld `ende` ist der Schlüssel, `setzt` setzt das Flag `ende_<schlüssel>`. Grenzen:
   beide Werte ab 60 → `haelt`; Vertrauen ab 50 und Ansehen bis 59 → `waffenstillstand`; Ansehen ab 50 →
   `durchbruch`; sonst `abgeloest`. Das Briefing von a4m6 (Slot `a4m6.briefing`, Feld `ende`) nutzt dieselben
   Grenzen, mit einer zusätzlichen Variante für das Flag `lask_gemeldet`.
   Der Test prüft, dass beides zusammenpasst.
2. **Schlusssequenz** nach a4m6: alle Einträge `art: "ende"` mit diesem `ende`, nach `seite` aufsteigend.
   Gibt es zu einer Seite mehrere Einträge, bilden sie einen Slot (`ende.<schlüssel>.<seite>`).
   Seiten mit `blatt: "gefallenenliste"` zeigen vor dem Text die ganze Gefallenenliste der Kampagne
   (`{anzahl}` ist ihre Länge) und lassen sich nicht überspringen.
3. **Nachwort**: alle Slots `ende.nachwort.*` und Einträge `art: "nachwort"` ohne Slot, je ein Absatz pro Figur.
4. **Brief 24** (`brief.24`) als letzte Seite, bei jedem Ende.

Die vorzeitigen Enden aus Plan 2.6 (Ansehen unter 10, Vertrauen unter 10) heißen `vorzeitig_abgeloest`
und `vorzeitig_meuterei` und werden direkt ausgelöst, ohne `ende.wahl`. Plan 2.6 sagt bei Meuterei nur
„Mission verloren“; ob die Kampagne danach endet oder mit Brandts Nachfolge weitergeht, entscheidet P14/P26.
Brief 24 erscheint nur bei den vier regulären Enden (er hat ein `wann` auf die Flags `ende_*`).

In `ende.abgeloest.4` füllt `{gefallener}` die letzte Person der Gefallenenliste (P14 legt sie an:
gefallen in der letzten Runde vor dem Waffenstillstand). Seiten mit `blatt: "gefallenenliste"` gibt es
in jedem regulären Ende.

### Zeitungen (`zeitungen.json`)

`zwischen` ist `vor-a1`, `a1-a2`, `a2-a3` oder `a3-a4` (zwischen Akt 4 und Ende stehen Zeitungen in der
Schlusssequenz). Pro Zwischenspiel vier Zeitungen, zwei je Fraktion (Zeitungen aus `welt.md`).
`randnotiz` ist eine Bleistiftnotiz am Rand, von der Front: Kalderner Leser unterschreiben mit Initialen,
erbeutete Morrow-Zeitungen tragen den Vermerk von Leutnant de Groot. Die Randnotiz wird in Caveat schräg
über den Satzspiegel gelegt. Zensurlücken im Ravelsker Grubenblatt stehen wie in der Papierebene (Z1) in
`[[doppelten eckigen Klammern]]`: Der Text darin wird als schwarzer Balken gedruckt und nicht angezeigt.
Er steht trotzdem in den Daten, damit die Balken die richtige Länge haben.

### Fundstücke (`fundstuecke.json`)

Alle Fundstücke haben `blatt: "foto"` (das Fundstück-Blatt der Papierebene); `typ` ist `foto`,
`feldpostkarte` oder `karte` und bestimmt, wie das Blatt gezeichnet wird. `bild` beschreibt, was auf der Vorderseite zu sehen ist
(für die Zeichnung und als Alternativtext), `rueckseite` ist die Schrift auf der Rückseite (Blatt
umdrehen). `akt` sagt, ab welchem Akt das Stück gefunden werden kann. Sechs Ketten zu je vier Stücken
(`kette`, `kette_nr` 1 bis 4). Sind alle vier einer Kette gefunden, erscheint der Eintrag
`fundstueck-kette` derselben Kette als Abschluss. Wer die Kette „schach“ vollständig hat, hat Lasks
Partie mit Ruta von der Eröffnung bis zur letzten Stellung.

### Endlosmodus (`endlos.json`)

- Stabsbefehl der Woche: unter `endlos-befehl` mit passender `befehlsart` (Plan 8.3) einen wählen, dessen
  `wann` gilt, über `rngForTurn`. `{stab}` kommt aus `endlos-stab` der eigenen Fraktion, `{feld}` ist das
  Zielfeld, `{frist}` die Frist, `{woche}` die Woche. `endlos.befehl.knapp` gilt nur bei Ansehen unter 25:
  P22 nimmt dann für `halten` immer diese Vorlage, und der Stab schreibt nur noch zwei Wörter.
- Wochenanfang: Slot `endlos.woche`, ab Woche 2 (in Woche 1 gibt es keine Vorwoche).
- `{gruppe}`, `{gruppenfuehrer}` usw. sind für beide Fraktionen neutral formuliert (Morrow sagt „Rotte“, die Texte sagen „die Leute“).
- Jahreszeit: beim Wechsel `teil: "wechsel"`, sonst pro Woche ein `teil: "wetter"`, dessen `wann` zum Wetter passt.
- Ende: `endlos-ende` mit dem passenden `grund`.

### Erfolge (`erfolge.json`)

40 Einträge. `ausloeser` beschreibt in Worten, wann der Erfolg gilt; P14/P22/P25 setzen das um, manche
brauchen dafür Zähler über alle Missionen. Erfolge vergeben aber keine Punkte, keine Ränge und keine Orden
(Plan 13), und der Spieler sieht keine Zählerstände.

### Weitere Felder

- `hinweis` (bei `brief`): Hinweis an die Umsetzung, wird nicht angezeigt.
- `doktrin` (bei `lask`): `masse`, `nachtangriffe`, `materialschlacht`, `tiefe_verteidigung`. Lasks letzter
  Brief eines Akts darf schon die Doktrin des nächsten Akts ankündigen.

## Platzhalter

Platzhalter stehen in geschweiften Klammern, z. B. `{gruppenfuehrer}`. Die erlaubten Namen stehen
in `placeholders.json` mit Beschreibung und Beispiel. Ein neuer Platzhalter wird dort eingetragen,
sonst schlägt der Test fehl.

Wichtig für die Feldpost (P15):

- `{ereignis}` ist **ein ganzer Satz mit Punkt**, aus Sicht der Schreibenden, aus einem Eintrag der Art
  `ereignis` gebildet. Er kann selbst wieder Platzhalter enthalten (`{ort}`, `{anzahl}`, `{gefallener}`, `{kamerad}`),
  die P15 aus demselben Protokollereignis füllt.
- `{anrede}` ist die ganze Anrede ohne Komma, z. B. `Liebe Maren` oder `Lieber Vater`. P15 wählt sie aus den
  Einträgen der Art `anrede` in `templates.json` (Feld `empfaenger` ist der nackte Name dazu). Vorlagen beginnen
  deshalb mit `{anrede},` und schreiben nie selbst „Liebe“ oder „Lieber“. `{empfaenger}` ist der nackte Name
  oder die Rolle (`Maren`, `Vater`) für die Mitte des Textes.
- Schreibende sind in Kaldern Männer und Frauen. Vorlagen vermeiden deshalb Formen, die das
  Geschlecht der Schreibenden verraten („ich bin müde“ statt „ich bin ein müder Mann“).

### Feldpost erzeugen (Vorschlag für P15)

1. Tonlage aus der Gruppe: `zuversichtlich` bei Moral ab 60 und Vertrauen ab 50, `verbittert` bei
   Moral unter 35 oder Vertrauen unter 30, sonst `erschoepft`.
2. Ein Ereignis der letzten Mission aus dem Protokoll wählen, das die Gruppe betraf, und seiner
   `kategorie` zuordnen (Tabelle der Kategorien in `templates.json`, Feld `beschreibung` jedes
   Ereignis-Eintrags). Unter den Ereignis-Sätzen dieser Kategorie einen mit passender oder ohne Tonlage nehmen.
3. Unter den Feldpost-Vorlagen der Tonlage eine wählen, deren `wann` erfüllt ist. Auswahl immer
   über `rngForTurn` und nach `id` sortiert, damit dieselbe Mission dieselben Briefe ergibt.

Umgesetzt in `js/letters.js` (P15), Ablauf und Schnittstelle in `js/ui/narrative/README.md`. Abweichungen: Zufall über
`createRng` aus Seed, Mission und Seite (eine Mission hat keine einzelne Runde). `{ort}` ist der nächste benannte Ort der
Karte, die Feldpostprüfstelle schwärzt heikle Orte als `[[...]]`. In festen Texten füllt P15 `{gruppe}` und
`{gruppenfuehrer}` mit der ersten lebenden eigenen Gruppe, P14/P16 können eine andere vorgeben (`storyValues`).

## Telegramme und Großschrift

Stabsbefehle stehen in den Daten bereits in Großbuchstaben. `ß` wird als `SS` geschrieben,
Umlaute bleiben (`ÜBER`, `FRÜH`). Jeder Satz endet mit ` STOP`.
