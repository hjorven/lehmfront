// Werte fuer die Mechaniken von Akt 2 (Plan 4.2 Nr. 13 bis 19, Paket P23). Reine Daten, keine Logik.
// Sappen, Stollen und Horchposten, Stosstrupps, Offiziere, Veteranen-Eigenschaften, Doktrinen der Spielerin.

/** Sappe: vorgetriebener Annaeherungsgraben ins Niemandsland (Plan 4.2 Nr. 13) */
export const SAP = {
  work: 70,          // Arbeit je Sappenfeld (ein Schuetzenloch kostet 10, ein Graben 25): langsam, aber gedeckt
  maxCells: 16,      // laengste Sappe je Befehl
  reach: 2,          // erstes Feld hoechstens so weit von der Gruppe
  diggers: ['rifles', 'pioneers', 'stormtroops'],
  fatigue: 6,        // Erschoepfung je Arbeitsrunde (enger, nasser Graben)
  sappenkopfPct: 130, // Erfahrungsbericht Sappenkopf: schneller
};

/** Stollen und Horchposten (Plan 4.2 Nr. 14). Ein Stollen ist eine gestrichelte Linie auf derselben Karte. */
export const TUNNEL = {
  maxCells: 18,       // laengster Stollen
  reach: 1,           // Stolleneingang neben der Gruppe (im eigenen Graben)
  // Arbeit je Stollenfeld nach Boden (100 = eine Runde volle Schuetzengruppe; Pioniere schaffen doppelt so viel).
  // Kreide schneidet sich leicht, traegt aber jeden Spatenschlag weit (siehe LISTEN.chalk).
  cellWork: { kreide: 70, lehm: 100, wald: 120, dorf: 120, fels: 180, sumpf: 200 },
  diggers: ['pioneers', 'rifles'],
  collapseWet: 2,     // ab dieser Naesse kann eine Stuetze nachgeben
  collapsePct: 6,     // Chance je Runde und Stollen bei Naesse
  blastRadius: 1,     // Trichter um das Ziel
  camoufletRadius: 2, // feindliche Stollen in diesem Abstand zur Ladung werden verschuettet
  centerLossPct: 70,  // Verluste auf dem Zielfeld
  ringLossPct: 30,    // Verluste im Ring
  crewLoss: [1, 2],   // Mineure bei einem verschuetteten Stollen
};

export const LISTEN = {
  radius: 6,          // Horchposten (Einheit listeners); Bericht Horchgeraet +2
  reportBonus: 2,
  chance: 55,         // Prozent je Runde und Stollen im Radius
  chalk: 20,          // Kreide: man hoert jeden Spaten
  far: -15,           // in der aeusseren Haelfte des Radius
  digging: 10,        // es wird gerade gegraben (nicht nur geladen)
  troops: { radius: 2, chance: 15 }, // jede Gruppe im eigenen Graben hoert ein Klopfen direkt unter sich
};

/** Stosstrupp bei Nacht (Plan 4.2 Nr. 15) */
export const RAID = {
  reach: 16,          // Ziel hoechstens so weit
  raiders: ['stormtroops'],
  spot: 25,           // Prozent je Posten in Hoerweite, entdeckt zu werden
  spotRadius: 3,
  flare: 30,          // im Licht einer Leuchtkugel
  listeners: 12,      // Horchposten und wachsame Gruppen
  fog: -10, rain: -6,
  surprise: 1.4,      // unentdeckt im Graben
  trench: 1.3,        // Verteidiger im eigenen Graben
  support: 0.5,       // Nachbarn des Verteidigers helfen mit diesem Anteil
  repelledLoss: [1, 3],
  alerted: 0.85,
  spottedLoss: [0, 2],
  abortPct: 45,       // entdeckt: so oft bricht der Trupp ab
  intelRadius: 5,     // leerer Graben: Papiere, Feldpost, Spuren
  interrogateRadius: 9, // Gefangenenbefragung
  fatigue: 15,
};

/** Offiziere (Plan 2.4, 4.2 Nr. 16): Zugfuehrer mit einer Faehigkeit fuer Gruppen in ihrer Naehe */
export const OFFICER = {
  aura: 3,            // Felder
  fallBase: 6,        // Prozent je Verlustereignis der eigenen Gruppe
  fallPerLoss: 6,     // plus je verlorenem Mann
  fallMax: 45,
  sniperBonus: 20,    // Scharfschuetzen zielen auf Offiziere
  moraleHit: 12,      // Gruppe, wenn der Offizier faellt
  nearHit: 5,         // Gruppen in der Naehe
};

export const OFFICER_SKILLS = {
  sturm:  { id: 'sturm',  label: 'Sturm',  text: 'Nahkampf und Stoßtrupp ein Viertel stärker', melee: 125 },
  ruhe:   { id: 'ruhe',   label: 'Ruhe',   text: 'Moralproben in der Nähe leichter', check: 12 },
  graben: { id: 'graben', label: 'Graben', text: 'Graben und Sappen ein Fünftel schneller', dig: 120 },
  nacht:  { id: 'nacht',  label: 'Nacht',  text: 'Stoßtrupps werden seltener entdeckt', spot: -8 },
};

/** Veteranen-Eigenschaften (Plan 4.2 Nr. 17). Hoechstens zwei je Gruppe. */
export const TRAITS = {
  nacht:      { id: 'nacht',      label: 'Nachtkämpfer',  short: 'N', text: 'Nachts im Nahkampf stärker, beim Stoßtrupp schwer zu entdecken' },
  graeber:    { id: 'graeber',    label: 'Gräber',        short: 'G', text: 'Gräbt ein Viertel schneller' },
  schuetzen:  { id: 'schuetzen',  label: 'Scharfschützen', short: 'S', text: 'Trifft wie eine Stufe erfahrener' },
  fest:       { id: 'fest',       label: 'Unerschütterlich', short: 'U', text: 'Moralproben deutlich leichter' },
  wachsam:    { id: 'wachsam',    label: 'Wachsam',       short: 'W', text: 'Kommt sofort aus dem Unterstand, hört Stoßtrupps früher' },
};
export const MAX_TRAITS = 2;
/** Schwellen, ab denen eine Gruppe eine Eigenschaft verdient (Zaehler je Gruppe in g.deeds) */
export const DEEDS = {
  nacht: 1,       // gewonnener Nahkampf oder Stosstrupp bei Nacht
  graeber: 16,    // Felder gegraben, gesappt oder Stollen
  schuetzen: 10,  // Ausfaelle beim Gegner durch eigenes Feuer
  fest: 5,        // bestandene Moralproben
  wachsam: 1,     // Stosstrupp oder Stollen entdeckt
};

/** Doktrin der Spielerin ab a2m4 (Plan 4.2 Nr. 18, Entscheidung "Wie wir kämpfen") */
export const PLAYER_DOCTRINES = {
  tiefe:        { id: 'tiefe',        label: 'Tiefe Verteidigung', text: 'Verteidiger im eigenen Graben stärker, Stoßtrupps des Gegners fallen eher auf', melee: 115, spot: 8, dig: 110 },
  infiltration: { id: 'infiltration', label: 'Infiltration',       text: 'Stoßtrupps stärker und leiser, ein zusätzlicher Stoßtrupp', raid: 120, spot: -6, extra: 'stormtroops' },
  material:     { id: 'material',     label: 'Materialschlacht',   text: 'Batterien mit mehr Munition, eine Lore weniger für Verwundete', ammoPct: 140, carts: -1 },
};
export const DOCTRINE_FLAGS = { doktrin_tiefe: 'tiefe', doktrin_infiltration: 'infiltration', doktrin_material: 'material' };
