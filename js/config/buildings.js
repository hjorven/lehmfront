// Etappengebaeude (Plan 6). Reine Daten, keine Logik.
//
// Felder je Gebaeude:
//   name, letter      Anzeige; letter steht auf dem Dach des Pappmodells
//   effect            Wirkung in einem Satz (deutsch)
//   yield             Ertrag pro Stellungsrunde, Schluessel aus RESOURCES
//   every             Ertrag nur alle n Stellungsrunden (Feldpost)
//   bonus             Nachbarboni; per.building = Gebaeudetyp(en) auf angrenzenden Feldern,
//                     per.ground = Boden angrenzender Felder, per.height = je Hoehenstufe des eigenen Feldes
//   missing           Text, wenn kein Bonus greift
//   needs             Pflicht-Nachbar; ohne ihn bringt das Gebaeude nichts
//   cost, buildTime   Material und Bauzeit in Stellungsrunden
//   release, act      ab welcher Ausbaustufe und ab welchem Akt baubar
//   model             Masse fuer das Pappmodell in Pixeln (h Hoehe, inset Rand zum Feld)
//
// "Angrenzend" heisst in Lehmfront: die vier Felder mit gemeinsamer Kante (keine Diagonalen).

export const RESOURCES = {
  loren:       { label: 'Loren' },
  verpflegung: { label: 'Verpflegung' },
  moral:       { label: 'Moral' },
  erholung:    { label: 'Erschöpfung', negative: true },
  heilung:     { label: 'Heilung' },
  reparatur:   { label: 'Reparatur' },
  holz:        { label: 'Holz' },
  material:    { label: 'Material' },
  beton:       { label: 'Beton' },
  leitung:     { label: 'Leitungsreichweite' },
  sicht:       { label: 'Sicht' },
  streuung:    { label: 'Streuung', negative: true },
  ausbildung:  { label: 'Erfahrung für Ersatz' },
  batterie:    { label: 'Batterieplatz' },
  offiziere:   { label: 'Offiziersplatz' },
  trost:       { label: 'Halt nach Verlusten' },
  flugzeuge:   { label: 'Flugzeug' },
};

export const BUILDINGS = {
  depot: {
    name: 'Depot', letter: 'D',
    effect: 'Lager für Munition, Verpflegung und Material. Hier starten die Loren.',
    yield: { loren: 2 },
    bonus: [{ per: { building: ['feldbahnhof'] }, add: { loren: 1 } }],
    missing: 'kein Feldbahnhof angrenzend',
    needs: { building: ['gleis', 'feldbahnhof'], text: 'kein Gleis und kein Feldbahnhof angrenzend: die Loren kommen nicht weg' },
    cost: 16, buildTime: 2, release: '1.0', act: 1,
    model: { h: 22, inset: 5 },
  },
  feldbahnhof: {
    name: 'Feldbahnhof', letter: 'B',
    effect: 'Verteilt die Loren auf die Gleise. Ohne Gleis daneben fährt nichts.',
    yield: { loren: 2 },
    bonus: [{ per: { building: ['depot'] }, add: { loren: 1 } }],
    missing: 'kein Depot angrenzend',
    needs: { building: ['gleis'], text: 'kein Gleis angrenzend: die Loren stehen still' },
    cost: 14, buildTime: 2, release: '1.0', act: 1,
    model: { h: 18, inset: 6 },
  },
  gleis: {
    name: 'Gleis', letter: '', kind: 'rail',
    effect: 'Feldbahngleis. Loren fahren bis zum Gleisende.',
    yield: {},
    cost: 2, buildTime: 1, release: '1.0', act: 1,
    model: { h: 0, inset: 0 },
  },
  feldkueche: {
    name: 'Feldküche', letter: 'K', smoke: true,
    effect: 'Macht aus Verpflegung warme Mahlzeiten. Versorgte Abschnitte halten besser durch.',
    yield: { verpflegung: 3, moral: 1 },
    bonus: [{ per: { building: ['ruhelager'] }, add: { moral: 1 } }],
    missing: 'kein Ruhelager angrenzend',
    cost: 12, buildTime: 2, release: '1.0', act: 1,
    model: { h: 16, inset: 7 },
  },
  ruhelager: {
    name: 'Ruhelager', letter: 'R',
    effect: 'Abgelöste Gruppen erholen sich schneller.',
    yield: { erholung: 2 },
    bonus: [{ per: { building: ['feldkueche'] }, add: { erholung: 1 } }],
    missing: 'keine Feldküche angrenzend',
    cost: 10, buildTime: 2, release: '1.0', act: 1,
    model: { h: 14, inset: 5 },
  },
  verbandsplatz: {
    name: 'Verbandsplatz', letter: 'V',
    effect: 'Erstversorgung. Leicht Verwundete kehren nach kurzer Zeit zurück.',
    yield: { heilung: 1 },
    bonus: [{ per: { building: ['ruhelager'] }, add: { heilung: 1 } }],
    missing: 'kein Ruhelager angrenzend',
    cost: 8, buildTime: 1, release: '1.0', act: 1,
    model: { h: 10, inset: 8 },
  },
  feldlazarett: {
    name: 'Feldlazarett', letter: 'L',
    effect: 'Verwundete heilen aus und kehren mit Erfahrung zurück.',
    yield: { heilung: 3 },
    bonus: [{ per: { building: ['ruhelager'] }, add: { heilung: 1 } }],
    missing: 'kein Ruhelager angrenzend',
    cost: 18, buildTime: 3, release: '1.0', act: 1,
    model: { h: 18, inset: 4 },
  },
  werkstatt: {
    name: 'Werkstatt', letter: 'W',
    effect: 'Setzt zerschossene Gebäude von selbst instand, ohne Material (je 2 Reparatur ein Gebäude je Runde).',
    yield: { reparatur: 2 },
    bonus: [{ per: { building: ['saegewerk', 'ziegelei'] }, add: { reparatur: 1 } }],
    missing: 'kein Sägewerk und keine Ziegelei angrenzend',
    cost: 14, buildTime: 2, release: '1.0', act: 1,
    model: { h: 14, inset: 6 },
  },
  saegewerk: {
    name: 'Sägewerk', letter: 'S',
    effect: 'Holz für Faschinen, Lattenroste und Unterstände.',
    yield: { holz: 2 },
    bonus: [{ per: { ground: ['wald'] }, add: { holz: 1 } }],
    missing: 'kein Wald angrenzend',
    cost: 14, buildTime: 3, release: '1.0', act: 1,
    model: { h: 20, inset: 6 },
  },
  ziegelei: {
    name: 'Ziegelei', letter: 'Z',
    effect: 'Brennt Ziegel für ausgebaute Gräben.',
    yield: { material: 2 },
    bonus: [{ per: { ground: ['lehm'] }, add: { material: 1 } }],
    missing: 'kein Lehmfeld angrenzend',
    cost: 16, buildTime: 3, release: '1.0', act: 1,
    model: { h: 18, inset: 5 },
  },
  betonmischer: {
    name: 'Betonmischer', letter: 'M',
    effect: 'Beton für betonierte Gräben und tiefe Unterstände.',
    yield: { beton: 1 },
    bonus: [{ per: { ground: ['lehm'] }, add: { beton: 1 } }],
    missing: 'kein Lehmfeld angrenzend',
    cost: 20, buildTime: 3, release: '1.0', act: 1,
    model: { h: 14, inset: 8 },
  },
  fernmeldestelle: {
    name: 'Fernmeldestelle', letter: 'F',
    effect: 'Größere Leitungsreichweite und Feuerleitung für die Artillerie.',
    yield: { leitung: 4 },
    bonus: [{ per: { building: ['beobachtungsturm'] }, add: { leitung: 1 } }],
    missing: 'kein Turm angrenzend',
    cost: 8, buildTime: 1, release: '1.0', act: 1,
    model: { h: 12, inset: 8 },
  },
  beobachtungsturm: {
    name: 'Beobachtungsturm', letter: 'T',
    effect: 'Sicht ins Niemandsland.',
    yield: { sicht: 2 },
    bonus: [{ per: { height: true }, add: { sicht: 1 } }],
    missing: 'Feld liegt flach, keine Höhe',
    cost: 10, buildTime: 2, release: '1.0', act: 1,
    model: { h: 34, inset: 13 },
  },
  batteriestellung: {
    name: 'Batteriestellung', letter: 'A',
    effect: 'Neue Batterie Feldhaubitzen, sobald fertig. Munition kommt aus dem Depot.',
    yield: { batterie: 1 },
    bonus: [{ per: { building: ['fernmeldestelle'] }, add: { streuung: 1 } }],
    missing: 'keine Fernmeldestelle angrenzend',
    cost: 12, buildTime: 2, release: '1.0', act: 1,
    model: { h: 7, inset: 3 },
  },
  ausbildungslager: {
    name: 'Ausbildungslager', letter: 'E',
    effect: 'Ersatz kommt mit Erfahrung 1 statt 0.',
    yield: { ausbildung: 1 },
    bonus: [{ per: { building: ['offiziersquartier'] }, add: { ausbildung: 1 } }],
    missing: 'kein Offiziersquartier angrenzend',
    cost: 12, buildTime: 2, release: '1.0', act: 1,
    model: { h: 12, inset: 4 },
  },
  feldpost: {
    name: 'Feldpost', letter: 'P',
    effect: 'Briefe treffen ein. Alle fünf Stellungsrunden steigt die Moral.',
    yield: { moral: 2 }, every: 5,
    cost: 6, buildTime: 1, release: '1.0', act: 1,
    model: { h: 10, inset: 9 },
  },
  offiziersquartier: {
    name: 'Offiziersquartier', letter: 'O',
    effect: 'Mehr Offiziere möglich.',
    yield: { offiziere: 1 },
    cost: 14, buildTime: 2, release: '1.2', act: 2,
    model: { h: 16, inset: 6 },
  },
  ballonplatz: {
    name: 'Ballonplatz', letter: 'Bp',
    effect: 'Fesselballon für weite Aufklärung.',
    yield: { sicht: 4 },
    bonus: [{ per: { building: ['fernmeldestelle'] }, add: { sicht: 1 } }],
    missing: 'keine Fernmeldestelle angrenzend',
    cost: 16, buildTime: 2, release: '1.2', act: 2,
    model: { h: 6, inset: 4 },
  },
  kapelle: {
    name: 'Kapelle', letter: 'Ka',
    effect: 'Nach Verlusten sinkt die Moral weniger.',
    yield: { trost: 2 },
    cost: 12, buildTime: 2, release: '1.3', act: 3,
    model: { h: 24, inset: 9 },
  },
  gedenkstaette: {
    name: 'Gedenkstätte', letter: 'G',
    effect: 'Ein Ort für die Namen der Gefallenen. Die Moral sinkt nach Verlusten weniger.',
    yield: { trost: 1 },
    cost: 6, buildTime: 1, release: '1.3', act: 3,
    model: { h: 8, inset: 12 },
  },
  flugfeld: {
    name: 'Flugfeld', letter: 'Fl',
    effect: 'Start- und Landeplatz für Flugzeuge.',
    yield: { flugzeuge: 1 },
    cost: 24, buildTime: 4, release: '1.3', act: 3,
    model: { h: 10, inset: 2 },
  },
};

// Etappenstufen (Plan 6): steigt die Versorgungsleistung (Loren pro Runde), waehlt man eine von zwei Belohnungen.
// add wirkt wie ein dauerhafter Ertrag, buildTime veraendert die Bauzeit aller Gebaeude (mindestens 1).
export const ETAPPE_LEVELS = [
  { level: 1, minLoren: 0, rewards: [] },
  { level: 2, minLoren: 5, rewards: [
    { id: 'zweite-gleisstrecke', name: 'Zweite Gleisstrecke', text: 'Eine zweite Strecke nach vorn: +2 Loren pro Runde.', add: { loren: 2 } },
    { id: 'zusatzbatterie', name: 'Zusätzliche Batterie', text: 'Der Stab schickt eine Batterie mehr: +1 Batterieplatz.', add: { batterie: 1 } },
  ] },
  { level: 3, minLoren: 8, rewards: [
    { id: 'sanitaetszug', name: 'Sanitätszug', text: 'Ein Zug fährt Verwundete nach hinten: +2 Heilung pro Runde.', add: { heilung: 2 } },
    { id: 'fernsprechvermittlung', name: 'Fernsprechvermittlung', text: 'Eine Vermittlung verbindet alle Leitungen: +3 Leitungsreichweite.', add: { leitung: 3 } },
  ] },
  { level: 4, minLoren: 12, rewards: [
    { id: 'pionierpark', name: 'Pionierpark', text: 'Vorgefertigte Teile: jedes Gebäude ist eine Stellungsrunde schneller fertig.', buildTime: -1 },
    { id: 'materialzug', name: 'Materialzug', text: 'Ein fester Materialzug: +3 Material pro Runde.', add: { material: 3 } },
  ] },
];
