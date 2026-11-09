// Erklaerungen fuer Einsteiger (1.8.0): Einheiten, Gelaende, Gebaeude der Karte und kurze Anleitungen.
// Genutzt vom Schild der Gruppe, der Feldinfo auf der Karte, dem Pausenmenue und dem Handbuch. Reine Daten.

/** Was eine Einheit kann, in einem oder zwei Saetzen */
export const UNIT_HELP = {
  rifles: 'Die Allzweck-Gruppe: gräbt, schießt, stürmt, trägt.',
  pioneers: 'Graben zweieinhalbmal so schnell, schneiden Gassen in feindlichen Draht, bauen Gräben um.',
  mg: 'Legt einen Feuerkegel: alles darin wird niedergehalten. Stark in der Verteidigung, schwach im Sturm.',
  medics: 'Bringen Verwundete zur Lore. Ohne Sanitäter im Abschnitt sterben Wartende.',
  runners: 'Tragen Befehle, wenn die Telefonleitung zerschossen ist (dauert eine Runde länger).',
  observers: 'Sehen am weitesten, auf Hügeln und Türmen noch weiter. Nur sie können im Gefecht die Artillerie verlegen oder stoppen.',
  mortar: 'Schießt im hohen Bogen auch ohne eigene Sicht in feindliche Gräben, aber nicht weit.',
  stormtroops: 'Nachts unbemerkt in feindliche Gräben, bringen Gefangene und Nachrichten.',
  snipers: 'Schalten Beobachter und Offiziere aus.',
  listeners: 'Hören feindliche Stollen unter der Erde.',
  flamethrowers: 'Räumen Unterstände aus nächster Nähe. Sehr verwundbar.',
  fieldgun: 'Schießt direkt und durch die Brustwehr.',
  tank: 'Fährt über Draht und Gräben, bleibt oft in Trichtern stecken.',
};

/** Gelaende: was es fuer Bewegung, Deckung, Sicht und Graben bedeutet */
export const TERRAIN_HELP = {
  lehm: 'Normaler Boden. Wird bei Regen zu Schlamm.',
  kreide: 'Fester Boden, wird kaum zu Schlamm. Graben dauert etwas länger.',
  fels: 'Langsam zu begehen, Graben fast unmöglich.',
  sumpf: 'Sehr langsam (dreimal so lange), wird schnell zu tiefem Schlamm.',
  wald: 'Gibt Deckung und versperrt die Sicht: wer drin steht, wird schwer gesehen und sieht selbst nicht hindurch. Etwas langsamer.',
  dorf: 'Häuser geben gute Deckung (wie ein Schützenloch) und versperren die Sicht.',
  wasser: 'Nicht begehbar.',
};

/** Hoehe */
export const HEIGHT_HELP = 'Höhe 0 bis 3. Von oben sieht man weiter (Beobachter besonders), und man sieht über niedrigere Felder hinweg. In Senken sammelt sich Wasser.';

/** Gebaeude auf der Karte (Kartentypen) */
export const MAP_BUILDING_HELP = {
  depot: 'Depot: Lager für Munition, Verpflegung und Material. Von hier fahren die Loren.',
  bahnhof: 'Feldbahnhof: verteilt die Loren auf die Gleise, mehr Loren je Runde.',
  kueche: 'Feldküche: warmes Essen für versorgte Abschnitte, Moral steigt.',
  ruhelager: 'Ruhelager: abgelöste Gruppen erholen sich hier schneller.',
  lazarett: 'Feldlazarett: Verwundete heilen und kommen erfahrener zurück.',
  verbandsplatz: 'Verbandsplatz: Verwundete heilen schneller.',
  werkstatt: 'Werkstatt: repariert zerschossene Gebäude von selbst.',
  turm: 'Beobachtungsturm: weite Sicht ins Niemandsland.',
  fernmelde: 'Fernmeldestelle: Telefonleitungen zu Beobachtern, Batterien in der Nähe schießen genauer.',
  batterie: 'Batterie: Geschütze. Gesteuert über den Feuerplan (A) in der Stellungsrunde.',
};

/** Kurze Anleitungen: Titel und Schritte */
export const HOW_TO = [
  {
    id: 'artillerie', title: 'Artillerie steuern',
    steps: [
      'Batterien stehen hinten in der Etappe (Kästchen „A“). Du steuerst sie nicht einzeln, sondern mit einem Feuerplan.',
      'In der Stellungsrunde „Feuerplan“ (A) antippen. Die Karte wird blau.',
      'Mit „+“ eine Planart wählen: Vorbereitungsfeuer (vor einem Angriff), Sperrfeuer (wenn der Gegner kommt), Feuerwalze (wandert vor deinem Sturm her), Störfeuer, Gegenbatterie.',
      'Die Linie auf die Karte ziehen. Rechts (Handy: unten) Batterien, Dauer und Beginn einstellen, dann „Übernehmen“.',
      'Die Artillerie schießt, sobald ein Angriff läuft (Gefechtsrunden). Störfeuer und Gegenbatterie sofort.',
      'Im Gefecht kann nur ein Beobachter mit Telefonleitung das Feuer „Verlegen“ (V) oder „Einstellen“ (E).',
    ],
  },
  {
    id: 'bauen', title: 'Gebäude bauen',
    steps: [
      'Ohne gewählte Gruppe „Etappe“ (M) antippen oder ein Gebäude hinten auf der Karte antippen.',
      'Links ein freies Feld im Modell wählen, rechts steht, was dort gebaut werden kann und was es bringt.',
      'Gebäude kosten Material aus dem Depot und brauchen eine oder mehrere Stellungsrunden.',
      'Nachbarn helfen sich: Depot neben Feldbahnhof gibt mehr Loren, Küche neben Ruhelager mehr Moral.',
      '„Aufträge übernehmen“, dann wie gewohnt „Runde ausführen“.',
    ],
  },
  {
    id: 'was-bauen', title: 'Was zuerst bauen?',
    steps: [
      'Feldbahnhof oder zweites Depot, wenn Loren knapp sind (oben links: Loren).',
      'Feldküche neben das Ruhelager: Moral und Erholung.',
      'Feldlazarett, wenn viele Verwundete warten.',
      'Werkstatt, sobald Granaten hinten einschlagen: sie repariert von selbst.',
      'Ausbildungslager, wenn viel Ersatz kommt: neue Leute bringen dann Erfahrung mit.',
    ],
  },
  {
    id: 'ersatz', title: 'Neue Leute (Ersatz)',
    steps: [
      'Neue Gruppen kannst du nicht aufstellen. Aber Ersatzleute kommen jede Runde ins Depot, mehr bei hohem Ansehen beim Stab.',
      'Aufgefüllt wird hinten: Gruppe vorn wählen, „Ablösen“ (R), dann ein Feld in der Etappe antippen (oder eine Gruppe von hinten, die ihren Platz übernimmt).',
      'Ist die Gruppe hinten: sie wählen, „Ablösen“ (R) antippen und die Gruppe selbst antippen. Die Vorschau zeigt, wie viele Leute kommen.',
      'Ersatz ist grün und senkt die Erfahrung der Gruppe. Genesene Verwundete kommen zuerst und behalten ihre Erfahrung.',
      'Mit Ausbildungslager kommt Ersatz mit Erfahrung 1 statt 0.',
    ],
  },
  {
    id: 'beobachter', title: 'Beobachter richtig nutzen',
    steps: [
      'Stell Beobachter auf Hügel oder in den Beobachtungsturm: von dort sehen sie am weitesten.',
      'Was sie sehen, wird für alle sichtbar. Feinde, die sie gesehen haben, bleiben als Fragezeichen mit Alter auf der Karte.',
      'Nur ein Beobachter mit Telefonleitung kann im Gefecht die Artillerie verlegen oder stoppen.',
    ],
  },
];
