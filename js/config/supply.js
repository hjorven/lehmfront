// Versorgung (Plan 4.1 Nr. 10, 6, 7.4). Reine Daten; die Regeln stehen in js/supply.js.
// Mengen sind ganze "Einheiten": eine Lore fasst CART_LOAD Einheiten einer Ladung.

/** Ladungen einer Lore in der Reihenfolge, in der Antippen sie wechselt */
export const LOADS = {
  ammo:     { id: 'ammo',     label: 'Munition',     short: 'MUN',   res: 'ammo' },
  food:     { id: 'food',     label: 'Verpflegung',  short: 'VERPF', res: 'food' },
  material: { id: 'material', label: 'Material',     short: 'MAT',   res: 'material' },
  medic:    { id: 'medic',    label: 'Sanitätslore', short: '+',     res: null },
};
export const LOAD_CYCLE = ['ammo', 'food', 'material', 'medic'];
export const RESOURCES = ['ammo', 'food', 'material'];

/** Einheiten je Lore */
export const CART_LOAD = 6;

/** Loren je Stellungsrunde, wenn das Szenario nichts sagt (supplies.cartsTotal) */
export const DEFAULT_CARTS = 6;

/** Verbrauch je Gruppe in einer Stellungsrunde (12 Stunden) */
export const UPKEEP = { food: 2, ammo: 1 };

/** Vorrat eines Abschnitts zu Beginn (reicht bei einer Gruppe drei Runden Verpflegung) */
export const START_STOCK = { ammo: 6, food: 6, material: 0 };

/** Mehr passt nicht in die Unterstaende eines Abschnitts */
export const STOCK_CAP = { ammo: 36, food: 36, material: 36 };

/** Eiserne Ration: so viele Runden kommt eine Gruppe ohne Verpflegung aus, bevor die Moral sinkt */
export const IRON_RATIONS = 1;

/** Nachschub von hinten ins Depot je Stellungsrunde, wenn das Szenario nichts sagt (supplies.income) */
export const DEFAULT_INCOME = { ammo: 10, food: 12, material: 6 };

/** Verwundete, die eine Lore auf dem Rueckweg mitnimmt: beladene Lore (leer zurueck) und Sanitaetslore */
export const WOUNDED_PER_CART = 1;
export const WOUNDED_PER_MEDIC_CART = 4;

/** Wahrscheinlichkeit in Prozent, dass ein wartender Verwundeter ohne Sanitaeter im Abschnitt stirbt */
export const WAITING_DEATH_PERCENT = 20;
/** Vertrauen, das wartende Verwundete je Abschnitt und Runde kosten, hoechstens MAX_TRUST_LOSS je Runde */
export const TRUST_PER_WAITING_SECTION = 1;
export const MAX_TRUST_LOSS = 2;

/** Heilung in Stellungsrunden: mit Verbandsplatz, nur Lazarett, ohne beides (Weg ins Hinterland) */
export const HEAL_TURNS = { verbandsplatz: 2, lazarett: 3, none: 5 };
/** Zurueckgekehrte Verwundete je Erfahrungsstufe der Gruppe ("kehrt spaeter erfahren zurueck") */
export const VETERANS_PER_XP = 4;

/** Kartengebaeude nach Rolle (Kartentypen aus data/maps und Etappen-Typen aus js/config/buildings.js) */
export const BUILDING_ROLES = {
  depot: ['depot'],
  kitchen: ['kueche', 'feldkueche'],
  aidpost: ['verbandsplatz'],
  hospital: ['lazarett', 'feldlazarett'],
};

/** Abstand (Felder, Schachbrett) zwischen Depot, Gleis und Graben, den Traeger zu Fuss ueberbruecken */
export const LINK = 2;

/** Abschnitte von Nord nach Sued, wenn die Karte nichts sagt */
export const DEFAULT_SECTIONS = 3;
export const SECTION_LETTERS = 'ABCDEFGH';
