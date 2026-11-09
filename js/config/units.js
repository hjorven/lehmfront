// Einheitentypen (Plan 5). Reine Daten, keine Logik.
// release: ab welcher Version die Einheit im Spiel ist. enabled: in diesem Stand befuellt und nutzbar.
// Kampfwerte passen zu rules.js: range (Felder), shots (Schuss je Gefechtsrunde), suppressionPerShot.
// size: Mannstaerke einer neuen Gruppe [min, max] vor Fraktions-Modifikator (Plan 5: 8 bis 12 Mann).
// digRate: Grabfortschritt je Stellungsrunde relativ zur Schuetzengruppe (1 = normal).
// speed: Felder je Gefechtsrunde auf offenem, trockenem Boden.

export const UNIT_TYPES = {
  rifles: {
    id: 'rifles', name: 'Schützengruppe', short: 'Schützen', role: 'Standard, gräbt, kämpft, trägt',
    release: '1.0', available: 'start', enabled: true,
    size: [10, 12], range: 6, shots: 8, suppressionPerShot: 0.02, digRate: 1, speed: 3, carry: 2,
  },
  pioneers: {
    id: 'pioneers', name: 'Pioniere', short: 'Pioniere', role: 'Graben doppelt so schnell, Draht, Umbauen, Sprengungen',
    release: '1.0', available: 'start', enabled: true,
    size: [8, 10], range: 5, shots: 5, suppressionPerShot: 0.02, digRate: 2, speed: 3, carry: 2,
  },
  mg: {
    id: 'mg', name: 'MG-Trupp', short: 'MG', role: 'Feuersektor, Unterdrückung',
    release: '1.0', available: 'start', enabled: true,
    size: [6, 8], range: 10, shots: 30, suppressionPerShot: 0.015, digRate: 0.5, speed: 2, carry: 0, sector: 60,
  },
  medics: {
    id: 'medics', name: 'Sanitäter', short: 'Sanitäter', role: 'Bergen, Erstversorgung, Verwundete zur Lore',
    release: '1.0', available: 'start', enabled: true,
    size: [6, 8], range: 0, shots: 0, suppressionPerShot: 0, digRate: 0.5, speed: 3, carry: 4,
  },
  runners: {
    id: 'runners', name: 'Melder', short: 'Melder', role: 'Stellt Verbindung her, wenn die Leitung ausfällt',
    release: '1.0', available: 'start', enabled: true,
    size: [3, 4], range: 4, shots: 2, suppressionPerShot: 0.01, digRate: 0.5, speed: 5, carry: 0,
  },
  observers: {
    id: 'observers', name: 'Beobachter', short: 'Beobachter', role: 'Lenkt Artillerie, sieht weit, braucht Höhe oder Turm',
    release: '1.0', available: 'start', enabled: true,
    size: [3, 4], range: 4, shots: 2, suppressionPerShot: 0.01, digRate: 0.5, speed: 3, carry: 0, sight: 14,
  },
  mortar: {
    id: 'mortar', name: 'Grabenmörser', short: 'Mörser', role: 'Kurze Reichweite, steile Flugbahn, trifft in Gräben',
    release: '1.0', available: 'akt1-m4', enabled: true,
    size: [5, 6], range: 8, shots: 3, suppressionPerShot: 0.06, digRate: 0.5, speed: 2, carry: 0, indirect: true,
  },

  // Akt 2 (P23): Stosstrupp, Scharfschuetzen, Horchposten. Akt 3 (P24): Flammenwerfer (schiesst nicht, sondern
  // stoesst mit dem Befehl flame, js/phases/flame.js), Feldgeschuetz (Direktfeuer, pierce: Deckung hoechstens wie
  // ein Trichter). Der Flieger ist keine Gruppe, sondern ein Mittel der Seite (state.sides[s].air, js/phases/air.js).
  stormtroops: {
    id: 'stormtroops', name: 'Stoßtrupp', short: 'Stoßtrupp', role: 'Nachtangriff, Infiltration, Gefangene',
    release: '1.2', available: 'akt2', enabled: true,
    size: [8, 10], range: 4, shots: 8, suppressionPerShot: 0.02, digRate: 1, speed: 4, carry: 1,
  },
  snipers: {
    id: 'snipers', name: 'Scharfschützen', short: 'Scharfsch.', role: 'Beobachter und Offiziere ausschalten',
    release: '1.2', available: 'akt2', enabled: true,
    size: [2, 3], range: 12, shots: 2, suppressionPerShot: 0.03, digRate: 0.5, speed: 3, carry: 0,
  },
  listeners: {
    id: 'listeners', name: 'Horchposten', short: 'Horchp.', role: 'Erkennt feindliche Stollen',
    release: '1.2', available: 'akt2', enabled: true,
    size: [2, 3], range: 3, shots: 1, suppressionPerShot: 0.01, digRate: 1, speed: 3, carry: 0, listenRadius: 6,
  },
  flamethrowers: {
    id: 'flamethrowers', name: 'Flammenwerfer-Trupp', short: 'Flammenw.', role: 'Säubert Unterstände, sehr gefährdet',
    release: '1.3', available: 'akt3', enabled: true,
    size: [3, 4], range: 2, shots: 0, suppressionPerShot: 0.08, digRate: 0, speed: 2, carry: 0, clearsDugouts: true,
  },
  fieldgun: {
    id: 'fieldgun', name: 'Feldgeschütz', short: 'Feldgesch.', role: 'Direktfeuer, kann nach vorne gezogen werden',
    release: '1.3', available: 'akt3', enabled: true,
    size: [6, 8], range: 16, shots: 5, suppressionPerShot: 0.08, digRate: 0, speed: 1, carry: 0, pierce: 'crater',
  },
  plane: {
    id: 'plane', name: 'Aufklärungsflugzeug', short: 'Flugzeug', role: 'Deckt Karte auf, lenkt Artillerie',
    release: '1.3', available: 'akt3', enabled: false,
    size: [2, 2], range: 0, shots: 0, suppressionPerShot: 0, digRate: 0, speed: 20, carry: 0, sight: 20,
  },
  tank: {
    id: 'tank', name: 'Panzerwagen (Prototyp)', short: 'Panzerw.', role: 'Überquert Draht und Gräben, oft liegengeblieben',
    release: '1.4', available: 'akt4', enabled: true,
    size: [6, 8], range: 8, shots: 12, suppressionPerShot: 0.03, digRate: 0, speed: 2, carry: 0, breakdown: 0.25,
  },
};

/** Typ nachschlagen, wirft bei unbekanntem Typ (Tippfehler in Szenarien frueh finden) */
export function unitType(id) {
  const t = UNIT_TYPES[id];
  if (!t) throw new Error('Unbekannter Einheitentyp: ' + id);
  return t;
}
