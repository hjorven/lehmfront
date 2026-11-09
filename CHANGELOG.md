# Änderungen

## 1.8.0 (2026-11-09)

Erklären statt raten.

- **Pausenmenü** (Esc oder „Menü“): Weiterspielen, Nachschlagen, Speichern und Einstellungen, Grundausbildung, zum Hauptmenü (mit Warnung bei offenen Befehlen).
- **Nachschlagen im Spiel**: Einheiten, Gelände, Gebäude (mit Wirkung, Kosten, Bauzeit), Werte, Begriffe, Tasten und Anleitungen (Artillerie steuern, Gebäude bauen, was zuerst bauen, neue Leute, Beobachter). Dasselbe im Handbuch.
- **Feldinfo**: Ein Feld ohne gewählte Gruppe antippen erklärt Boden, Höhe, Graben mit Feuerrichtung, Draht, Trichter, Gebäude, Schlamm und Schnee.
- **Schild der Gruppe** sagt in einem Satz, was die Einheit kann (auch beim Gegner).
- **Etappenfenster** nennt bei jeder Bauoption, wozu das Gebäude gut ist.
- **Grundausbildung Teil 2**: Beobachter, Feldinfo, Feuerplan, Gebäude bauen, Ablösen, Nachschlagen. Im Hauptmenü nach Teil 1.
- **Behoben**: Der Feuerplan-Editor stürzte beim Öffnen ab, wenn noch kein Feuerplan bestand (seit 1.0). Die Artillerie ließ sich so im normalen Spiel nicht planen. Jetzt öffnet er mit einer Feuerwalze; die CI prüft das.
- Die Feldinfo schließt sich, sobald ein Befehl beginnt; der Zettel der Grundausbildung weicht nach rechts aus, wenn links getippt werden muss.

## 1.7.0 (2026-11-09)

Übersichtlicher für Einsteiger: nicht mehr alles auf einmal.

- **Befehle Schritt für Schritt** (`js/unlocks.js`): Neue beginnen mit Bewegen, Halten und Graben. Weitere Befehle kommen in fünf Stufen mit der Grundausbildung und den Missionen von Akt 1 dazu. In Gefecht frei, Hotseat, Koop und Frontabschnitt gilt die erreichte Stufe, mindestens Stufe 2. Tageslage, Lehrgang, eigene Lagen, Online und Akt 2 bis 4 zeigen alles. Wer vor 1.7.0 schon gespielt hat, bekommt alles sofort. Dienstbuch, Darstellung: „Befehle im Gefecht: alle von Anfang an“.
- **Neue Befehle mit einem Satz Erklärung**: Ein Zettel stellt jeden Befehl einmal vor, wenn er dazukommt. Der Tooltip jedes Werkzeugs erklärt ihn ebenfalls.
- **Weniger auf dem Schirm**: Solange Befehle gestuft sind, fehlen Overlays, Ton und „Karte frei“ bis Stufe 4. Ansehen und Vertrauen stehen nur in der Kampagne. „Vor der Runde“ und die Zusammenfassung melden nichts zu gesperrten Befehlen, und der Lehrling schlägt sie nicht vor.
- **Grundausbildung neu**: 13 kurze Schritte, ein Gedanke je Zettel. Am Anfang gibt es keinen Befehl, jeder erscheint mit seinem Schritt. „Vor der Runde“ und der Lehrling kommen erst, wenn sie dran sind.
- **Schnee in Akt 3**: Alle Winter-Missionen beginnen mit einer Schneedecke, Schneefall statt Regen. Die Werkstatt kennt Schnee als Wetter. Das Turnier über Akt 3 zeigt unveränderte Siegquoten.
- Supabase: alter Testhelfer (`public._probe` mit zwei Probe-Tokens, `public._call`) entfernt.

## 1.6.0 (2026-11-09)

Besser für Einsteiger, offene Macken geschlossen, Lagen online teilen.

### Für Einsteiger

- **Grundausbildung** (Hauptmenü, oberster Eintrag): eine echte Partie an der Asse gegen den Rekruten. Ein Zettel führt in 14 Schritten durch Karte, Gruppen, Bewegen, Graben mit Traversen, MG-Sektor, Runde ausführen, Film und Telegramm, Lorenplan und Lehrling. Erledigte Schritte hakt er selbst ab, das Bedienelement ist mit Bleistift umkringelt. Auf dem Handy setzt sich der Zettel über das Schild der Gruppe.
- **Handbuch** (`?scene=handbuch`, Hauptmenü, Dienstbuch > Tasten): eine Runde in fünf Schritten, alle Werte, Begriffe von A bis Z, Tasten und Fingergesten, zehn Ratschläge.
- **Anleitung mit Bildern** in `docs/tutorial.md`; die Bilder erzeugt `node tools/tutorial-shots.mjs`.
- Hauptmenü: „Neu hier? Hier anfangen.“ für alle ohne Grundausbildung und Feldzug. Gefecht frei wählt für Neue den Rekruten vor.
- Werte oben links und Ansehen/Vertrauen erklären sich beim Überfahren mit der Maus.
- **Bleistiftnotizen aus dem Protokoll**: geht etwas schief, steht an der Stelle, was gefehlt hat („Traverse fehlt!“, „Draht! Erst Gasse schneiden“, „Wasser: entwässern (W)“, „Lorenplan prüfen (L)“, „eigene Walze zu dicht!“). Die Notizen bleiben für die Mission auf dem Blatt.

### Macken behoben

- **Kartenschrift in Chrome**: Schrift unter 2 px auf der vergrößerten Karte setzte Chrome falsch, alle Buchstaben landeten übereinander. Gruppenkürzel („MG“, „Beo“, „Pi“), Geisternotizen („MG? vor 2 Runden“) und Sichtlinien-Beschriftungen waren unlesbar. Eine kleine Schicht (`js/render/text-fix.js`) zeichnet kleine Schrift jetzt in Bildschirmgröße.
- **KI löst ab**: Stehen alle Gruppen vorn, schickt die KI (Veteran, Lask) die müdeste ins Ruhelager, wenn vor ihr Ruhe ist; ausgeruht löst sie die nächste ab. Vorher lagen KI-Gruppen bis zu 24 Runden bei Erschöpfung 100 vorn.
- **Etappe**: Eine fertige Batteriestellung bringt eine Batterie Feldhaubitzen (Munition aus dem Depot), eine fertige Fernmeldestelle wird Vermittlung, wenn es keine gibt. Die **Werkstatt** setzt zerschossene Gebäude von selbst instand (ab der Runde nach dem Treffer, ohne Material).
- **Schnee** hat eine Regel: Im Winter fällt Schnee statt Regen, die Decke wächst bis knietief, bremst Wege ab Knöcheltiefe, nachts frieren Posten ohne Unterstand, Tauwetter macht den Lehm nass. Auf der Karte als heller Hauch mit Tupfen und fallenden Flocken.
- **Sichtlinie mit dem Finger**: Mit gewählter Gruppe zeigt das Antippen eines leeren Feldes die Sichtlinie, ein zweites Antippen hebt die Auswahl auf.
- Durchspiel-Werkzeug fand den Knopf „Zum Wochentisch“ nicht (Endlos „Szene nicht geladen“); jetzt laufen alle 16 Modi durch.

### Online

- **Lageaustausch** in der Werkstatt: eigene Lagen ins Netz stellen, die neuesten Lagen anderer spielen oder öffnen, eigene wieder herausnehmen, Link `?scene=werkstatt&netz=<Kennung>`. Neue Tabelle `lagen` (`supabase/migrations/0002_lagen.sql`, `0003_lagen_haerten.sql`, RLS: lesen alle, anlegen und löschen nur eigene, höchstens 20 je Spieler).

### Überraschung

- Hotseat: Auf den versiegelten Umschlag kann die abgebende Seite mit Bleistift eine Zeile für drüben schreiben.

## 1.5.0 (2026-11-09)

Das ganze Spiel: alle vier Akte, alle Ausbaustufen bis 1.5, online spielbar.

### Neu seit 1.0.0

- **Akt 3 „Materialschlacht“** (#37): Gas mit Wind und Vorhersage, Masken, Waffenruhe mit weißer Fahne, Bergen im Niemandsland, Feldgeschütz, Flammenwerfer, Flieger, Scheinbatterien und Tarnnetze. Sechs Missionen, Befehl 117 und die längste Nacht mit Varianten.
- **Akt 4 „Das letzte Frühjahr“** (#39): Panzerwagen, Große Mine unter Hügel 214, Sprengfallen in geräumten Gräben, Pionierbrücke, Verweigerung der Truppe, der letzte Tag. Sechs Missionen und vier Enden (die Linie hält, Waffenstillstand, Durchbruch, abgelöst) mit eigener Schlusssequenz.
- **Online** (#35, #38): Fernsprechamt mit Zweikampf über Einladungscode, Cloud-Spielstand und nachgerechneter Bestenliste der Tageslage sind live geschaltet.
- **Tablet und Touch** (#36): Ziel mit dem Finger erst vormerken, dann bestätigen; iPad-Layout im Gefecht.
- **README** neu geschrieben, Hauptmenü nennt Akt 1 bis 4 und das geschaltete Fernsprechamt (#40).

### In 1.5.0 nachgezogen (Paket P27, Abschluss)

- Dienstbuch: **Sicherung** von Feldzug, Frontabschnitt, Lehrgangsmappe, Wachbuch, Werkstatt und Einstellungen als eine Datei mit Prüfstempel, einlesbar auf einem anderen Gerät.
- Feuern auf dem Handy rückt Gruppe und Ziele ins Bild.
- Phasenfilm auf dem Handy: der laufende Reiter rollt ins Bild, „Phase 3 von 6“ steht im Kopf, „Ohne Halt“ (Durchlaufen) gibt es auch auf dem schmalen Schirm.
- Telegramm-Kopf bricht nicht mehr mitten im Titel um.
- Checkliste „Vor der Runde“: viele Gruppen ohne Befehl stehen in einer Zeile, damit andere Prüfpunkte sichtbar bleiben.
- Feste Figuren im Szenario teilen ihren Nachnamen nicht mehr mit gezogenen Gruppenführern (vorher zwei „Gruppe Albers“ in Akt 3).
- Werkstatt nennt mit Maus keine Fingergesten mehr; Wertungen von Tageslage und Frontabschnitt sagen „je“.
- Durchspiel-Werkzeug `tools/playthrough.mjs` deckt Akt 3 und 4, Endlos, Puzzle und Koop ab; neues Turnier `tools/feldzug-sim.mjs` über alle Missionen von Akt 2 bis 4.
- Überraschung: Das Titelblatt erinnert sich an den Ausgang des Feldzugs. Die Gräben im Hintergrund stehen, wie die Front am letzten Tag stand, daneben ein Bleistiftvermerk und die Zahl der Namen auf der Liste.

### Bekannt

Siehe `docs/status.md`, Abschnitt „Offen und bekannte Macken“.

## 1.0.0 (2026-11-09)

Erste vollständige Fassung. Lehmfront läuft im Browser, ohne Installation, auch offline, auf Desktop und Handy.

### Spielen

- **Feldzug**: Akt 1 (sechs Missionen mit eingebauter Einweisung) und Akt 2 (Sappen, Stollen, Horchposten, Stoßtrupps bei Nacht, Offiziere und Veteranen). Feldzugskarte, Stabsbefehle zum Befolgen, Umdeuten oder Verweigern, Ansehen beim Stab und Vertrauen der Truppe.
- **Erzählung** zwischen den Missionen: Zeitungen beider Seiten, Feldpost, Gefallenenliste, Tagebuch, Tisch mit Fundstücken.
- **Gefecht frei** auf Asse-Nord, drei handgebauten Spiegelkarten oder Zufallskarten, mit wählbarer Dauer, Fraktion, Gegner-Doktrin und Schwierigkeit.
- **Hotseat** mit versiegeltem Umschlag zur Übergabe, **Koop gegen die KI** (zwei Abschnitte, Zettel an den Nachbarn).
- **Tageslage**: für alle dieselbe Woche an einem Tag, mit Wachbuch.
- **Frontabschnitt**: Endlosmodus mit Wochen, Jahreszeiten, Stabsbefehlen und Buch des Abschnitts.
- **Puzzle-Lagen** und **Werkstatt** (Missionseditor und Sandkasten).
- **Online-Zweikampf** und Wiedergabe-Link sind gebaut, aber abgeschaltet, bis der Server eingerichtet ist (`docs/online.md`).

### Regeln

- WEGO: beide Seiten planen gleichzeitig, eine Runde wird nach festen Phasen aufgelöst. Stellungsrunden (6 Stunden) und Gefechtsrunden (5 Minuten).
- Graben ausheben, Stufen, Feuerrichtung, Traversen, Draht, Unterstände, Entwässern.
- Feuer mit Sichtlinien, Unterdrückung, MG-Kegeln und Nebel des Krieges; Leuchtkugeln bei Nacht.
- Artillerie mit Feuerplänen (Vorbereitung, Walze, Sperrfeuer, Störfeuer), Beobachtern, Telefonleitungen und Gegenbatterie.
- Versorgung über Depot, Feldbahn und Lorenplan, Sanitätskette, Etappe mit Gebäuden und Nachbarboni.
- Wetter, Schlamm, Krater, Tag und Nacht. Moral, Erschöpfung, Ablösung und Ersatz.
- KI-Kommandant mit Doktrinen und drei Schwierigkeiten, Taktik-Lehrling als Ratgeber.
- Alles deterministisch: gleicher Seed, gleiche Befehle, gleicher Verlauf. Jedes Ereignis trägt im Protokoll eine Begründung.

### Bedienung und Darstellung

- Lagekarte im Stil einer Generalstabskarte bei Tag, Nachtstil bei Dunkelheit, mit Übergang in der Dämmerung.
- Phasenfilm und Telegramm nach jeder Runde, Protokoll-Archiv.
- Werkzeugreihe, Befehlskreis per langem Druck, Tastenkürzel. Auf dem Handy (ab 390 x 844) vollständig per Touch bedienbar.
- Prozeduraler Klang (WebAudio): Front, Wetter, Einschläge, Musik.
- Spielstände: automatische Akte nach jeder Runde, drei Kartentaschen, Export und Import mit Prüfstempel. Offline über Service Worker.
- Dienstbuch: Tempo, reduzierte Bewegung, Textgröße, farbunabhängige Signaturen, hoher Kontrast.

### In 1.0.0 nachgezogen (Paket P21)

- Hoher Kontrast wirkt jetzt auch auf die gezeichnete Karte, nicht nur auf die Kärtchen.
- Brandlöcher am Kartenrand und Tropfenflecken auf dem Papier kommen mit der Akte zurück.
- Werkzeugreihe: Passen nicht alle Werkzeuge auf den Schirm, zeigen Laschen an den Enden, wie viele noch folgen, und blättern weiter. Auf dem Handy stehen die gerade möglichen Befehle vorn. Auf dem Desktop läuft die Reihe nicht mehr unter „Runde ausführen“.
- Missionen aus Akt 2 lassen sich direkt per Link öffnen.
- Balancing geprüft: auf Spiegelkarten keine Seitenbevorzugung (1000 Partien), Kaldern und Morrow auf Zufallskarten nahe beieinander. Neue Werkzeuge `tools/balance.mjs` und `tools/playthrough.mjs`.

### Bekannt

Siehe `docs/status.md`, Abschnitt „Offen und bekannte Macken“. Akt 3 und 4 folgten mit 1.5.0.
