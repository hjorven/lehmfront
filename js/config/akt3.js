// Werte fuer die Mechaniken von Akt 3 "Materialschlacht" (Plan 4.2 Nr. 20 bis 22, Paket P24). Reine Daten.
// Gas mit Wind und Windvorhersage, Gasmasken, Waffenruhe zum Bergen, Feldgeschuetz, Flammenwerfer, Flieger,
// Scheinbatterien und Tarnnetze.

/** Windrichtungen im Uhrzeigersinn. Eine Richtung sagt, woher der Wind kommt (Westwind blaest nach Osten). */
export const WIND_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
export const WIND_NAMES = {
  n: 'Nordwind', ne: 'Nordostwind', e: 'Ostwind', se: 'Südostwind',
  s: 'Südwind', sw: 'Südwestwind', w: 'Westwind', nw: 'Nordwestwind',
};
/** Wohin der Wind treibt (Gegenrichtung der Herkunft), in Feldern */
export const WIND_DRIFT = {
  n: { dx: 0, dy: 1 }, ne: { dx: -1, dy: 1 }, e: { dx: -1, dy: 0 }, se: { dx: -1, dy: -1 },
  s: { dx: 0, dy: -1 }, sw: { dx: 1, dy: -1 }, w: { dx: 1, dy: 0 }, nw: { dx: 1, dy: 1 },
};
export const WIND_SPEED_WORDS = ['still', 'schwach', 'mäßig', 'frisch'];

/** Windvorhersage (Plan 4.2 Nr. 20): wie sicher sie fuer die naechste Runde ist (Prozent) */
export const WIND = {
  surePosition: 70,   // zwoelf Stunden voraus
  sureBattle: 90,     // fuenf Minuten voraus
  afternoon: -15,     // "Der Wind im Lehmgau dreht am Nachmittag": Tagesrunden sind unsicherer
  storm: -15,         // Sturm und Regen machen die Vorhersage schlechter
  turnTwo: 30,        // Anteil der Fehlvorhersagen, bei denen der Wind gleich um 90 Grad dreht
  persist: 65,        // Prozent: die naechste Vorhersage behaelt die Richtung
  maxSpeed: 3,
};

/** Gas (Plan 4.2 Nr. 20). Dichte je Feld 1 bis 3. */
export const GAS = {
  maxDensity: 3,
  cylinderCells: 2,      // Flaschen: Gruppenfeld plus so viele Grabenfelder je Seite
  cylinderDensity: 3,
  shellDensity: 3,       // Mitte einer Gasgranaten-Salve, Ring eine Stufe weniger
  shellAmmo: 20,         // Granaten aus der Batterie je Gas-Salve
  shellRange: 46,
  shellScatter: 2,       // hoechstens so weit liegt die Salve daneben (mit Streuung)
  // Treibschritte je Runde: Stellungsrunde 2 + 2 je Windstaerke, Gefechtsrunde 1 bei Windstaerke ab 2,
  // bei schwachem Wind jede zweite Gefechtsrunde, bei Windstille gar nicht (das Gas sinkt in die Senken)
  stepsPosition: 2, stepsPerSpeed: 2,
  decayPct: 30,          // Chance je Schritt und Feld, eine Dichte zu verlieren
  decayCalm: 15,         // bei Windstille
  decayLow: 50,          // in Graeben, Trichtern und Senken haelt sich das Gas: Chance mal diesem Anteil
  decayStrong: 45,       // frischer Wind verweht schneller
  // Wirkung je Runde nach hoechster Dichte, die eine Gruppe abbekommt
  maskSuppression: 25,   // Hundertstel Unterdrueckung je Dichte (mit Maske)
  maskFatigue: 4,        // je Dichte
  maskMorale: 1,         // je Dichte
  lossPct: [0, 8, 18, 30], // ohne Maske: Chance je Mann nach Dichte
  latePct: { night: 30, day: 12, dugout: 10, alarm: -20, wachsam: -10 }, // Masken zu spaet (erste Beruehrung)
  lateLossFactor: 50,    // zu spaet aufgesetzt: Prozent der Verluste ohne Maske
  dreadRadius: 8,        // Gas kostet beide Seiten Moral: Gruppen in diesem Abstand zur Freisetzung
  dreadMorale: 3,
  alarmRadius: 3,        // eine Gruppe, die das Gas zuerst trifft, schlaegt Alarm fuer diesen Umkreis
};

/** Waffenruhe zum Bergen (Plan 4.2 Nr. 21) */
export const TRUCE = {
  offerWounded: 3,       // so viele eigene Verwundete muessen draussen liegen, bevor Lask anbietet
  rounds: 1,             // eine Stellungsrunde (bis Mitternacht bzw. Morgengrauen)
  breakMorale: 4,        // wer bricht, schaemt sich: Moral der eigenen Gruppen
  breakTrust: 8,         // Vertrauen der brechenden Seite
  acceptTrust: 3,        // Vertrauen steigt beim Annehmen, Ansehen sinkt
  acceptReputation: -3,
  dieRound: 20,          // Prozent je Mann und Stellungsrunde, draussen zu sterben
  carry: 4,              // Verwundete je Sanitaetsgruppe und Runde (ohne Waffenruhe)
  recoverReach: 6,       // Bergen bis so weit von der Gruppe
  spotted: 15,           // ohne Waffenruhe: Prozent je feindlicher Gruppe in Hoerweite
  spotRadius: 6,
  nervous: 50,           // geduldet: Chance, dass ein nervoeser Posten einmal schiesst
  shotLoss: [1, 2],
};

/** Flammenwerfer (Plan 4.2 Nr. 22, Plan 5) */
export const FLAME = {
  range: 2,
  fuel: 3,               // Stoesse je Einsatz
  dugoutLossPct: 55,     // im Unterstand: so viele der Besatzung fallen aus
  openLossPct: 25,
  surrender: 3,          // Rest bis zu dieser Staerke ergibt sich
  dugoutMorale: 30, openMorale: 15, nearMorale: 6,
  tankHitPct: 18,        // je feindlicher Gruppe mit Sicht, die beim Stoss auf den Trupp schiesst
  tankHitRange: 6,
  burstOnLossPct: 30,    // nach Verlusten im Feuer platzt ein Tank
};

/** Flieger (Plan 4.2 Nr. 19 und 22): Aufklaerung bei Tag und klarem Wetter, einmal am Tag */
export const AIR = {
  radius: 6,
  lostPct: 6,            // Chance je Flug, dass der Flieger nicht zurueckkommt
  weatherOk: ['clear', 'overcast'],
};

/** Scheinbatterien und Tarnnetze (Mission a3m3 "Augen am Himmel") */
export const DECOY = {
  maxPerRound: 2,
  decoyCost: 6,          // Material
  camoCost: 4,
  size: 2,
  wreckHits: 2,          // nach so vielen Beschuss-Runden ist die Attrappe zerschossen
};

/** Stoffe, die ein Szenario einer Seite mitgibt (sides.x.gas) */
export const GAS_STOCK = { cylinders: 0, shells: 0 };
