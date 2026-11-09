// Werte fuer die Mechaniken von Akt 4 "Das letzte Fruehjahr" (Plan 4.2 Nr. 23 und 24, Paket P26). Reine Daten.
// Verweigerung eines Sturms, Panzerwagen (Prototyp), grosse Mine unter dem Huegel, Sprengfallen in geraeumten
// Graeben, Pionierbruecke ueber die Asse, Waffenstillstand und Uebergabe am letzten Tag.

/** Verweigerung (Plan 2.6, 4.2 Nr. 23) */
export const REFUSAL = {
  trustBelow: 25,      // Vertrauen darunter: in Akt 4 verweigern Gruppen (campaign.refuse)
  lossPct: 50,         // erwartete Verluste ab diesem Anteil (Prozent der Gruppe)
  harmsReach: 5,       // Harms vermittelt einmal je Mission, wenn er so nah ist (Felder)
  brandtReach: 3,      // wer Brandt sieht, geht mit (a4m4 "Selbst vorgehen")
  brandtCheck: 10,     // Moralproben in Brandts Naehe leichter (Prozentpunkte)
  harmsCheck: 6,       // Plan 2.4: Gruppen in Harms' Naehe erholen sich schneller
  harmsAura: 3,
  warnedTrust: 1,      // Sturm trotz Warnung der Vorschau: Vertrauen sinkt je Gruppe (Kampagne)
  warnedTrustMax: 3,   // hoechstens so viel je Runde
  refusedMorale: 6,    // die Gruppe, die verweigert hat, schaemt sich nicht, aber sie ist durch
  // Schaetzung der Vorschau: Anteil der Verluste je erwarteten Treffer im Nahkampf am Ziel
  meleePct: 25,        // besetzter feindlicher Graben am Ziel
  wirePct: 100,        // ein Drahtfeld kostet eine volle Runde unter Feuer (Prozent einer Runde)
  memory: 4,           // zuletzt gesehene Feinde zaehlen so viele Runden mit
  postReach: 2,        // Posten im feindlichen Feuergraben so nah am Ziel werden angenommen
  postStrength: 3,     // angenommene Staerke eines solchen Postens
};

/** Panzerwagen K1 (Plan 4.2 Nr. 24, Einheit tank) */
export const TANK = {
  // Chance in Prozent, beim Betreten eines Feldes stecken zu bleiben
  stuck: { base: 3, crater1: 12, crater2: 28, trench: 10, mud1: 12, mud2: 25, wire: 2, wood: 15, village: 6 },
  dryBonus: -2,        // trockener Tag (a4m2): etwas weniger
  armorPct: 10,        // Gewehre und MG richten so viel aus wie gegen ungedeckte Leute (Prozent)
  shieldPct: 50,       // Gruppen direkt hinter dem Wagen bekommen nur so viele Treffer ab
  shockRadius: 2,      // Feinde in diesem Abstand zu einem fahrenden Wagen
  shockSuppression: 0.35,
  shockMorale: 8,
  meleePct: 200,       // im Nahkampf
  freePct: 50,         // Pioniere daneben bergen den Wagen in einer Stellungsrunde
  breakdownPct: 4,     // Getriebe: je Stellungsrunde, in der der Wagen faehrt
};

/** Grosse Mine unter Huegel 214 (a4m3) */
export const MINE = {
  radius: 2,           // Trichter um die Kammer
  centerLossPct: 95,
  ringLossPct: 65,
  farRadius: 7,        // so weit faellt Kreide, Gruppen erschrecken
  farMorale: 15,
  breachReach: 1,      // feindlicher Stollen so nah an der Galerie: Durchbruch, die Kammer ist verloren
  camoufletReach: 2,   // feindliche Quetschladung so nah: Galerie stuerzt ein
};

/** Sprengfallen in geraeumten Graeben (a4m1) */
export const TRAP = {
  triggerPct: 60,      // wer ohne Pioniere hineingeht
  loss: [1, 3],
  searchReach: 1,      // Pioniere finden Fallen auf dem eigenen und den Nachbarfeldern
  othersFindPct: 25,   // andere Gruppen finden sie manchmal selbst (auf dem eigenen Feld)
};

/** Pionierbruecke (a4m5) */
export const BRIDGE = {
  work: 260,           // Arbeit je Brueckenfeld (ein Joch, Bohlen, Gelaender)
  railWork: 30,        // Gleis auf dem fertigen Feld
  builders: ['pioneers', 'rifles'],
  reach: 1,            // die Gruppe steht am Ufer oder auf der Bruecke, hoechstens so weit vom naechsten Feld
  maxCells: 8,
  hitDamage: 45,       // ein Treffer reisst so viel Arbeit wieder ein
  material: 4,         // Material je Brueckenfeld aus dem Depot
  moveCost: 12,        // Laufen ueber die fertige Bruecke
};
