# Änderungen

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
