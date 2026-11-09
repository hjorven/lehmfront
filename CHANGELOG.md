# Änderungen

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

Siehe `docs/status.md`, Abschnitt „Offen und bekannte Macken“. Akt 3 und 4 folgen in späteren Versionen.
