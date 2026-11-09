// Artillerie (Plan 4.1 Nr. 8, 5 letzter Absatz, 6 Batteriestellung). Reine Daten, keine Logik.
//
// Batterien sind keine Gruppen, sondern Etappengebaeude mit Munition, Reichweite und Streuung.
// shells: Granaten je Gefechtsrunde (eine Stellungsrunde Stoerfeuer zaehlt wie eine Gefechtsrunde).
// range: Reichweite in Feldern ab der Batteriestellung. spread: Streuung in Zehntelfeldern (Kaldern x 0,8, Morrow x 1,3).
// ammo: Granaten, die an der Stellung lagern koennen (mal Fraktion artillery.ammo). refill: Nachschub je Stellungsrunde
//   aus dem Depot (supplies.ammo), 1 Depot-Einheit = SHELLS_PER_AMMO Granaten.
// lethal: Grundwahrscheinlichkeit in Hundertsteln, dass ein Einschlag im Feld einen Mann trifft (vor Deckung).
export const BATTERY_TYPES = {
  feldhaubitzen: {
    id: 'feldhaubitzen', name: 'Feldhaubitzen', short: 'FH', guns: 6,
    shells: 12, range: 46, spread: 14, ammo: 160, refill: 60, lethal: 34, suppression: 30,
  },
  schwere: {
    id: 'schwere', name: 'Schwere Haubitzen', short: 'sH', guns: 4,
    shells: 8, range: 56, spread: 20, ammo: 100, refill: 40, lethal: 52, suppression: 45, breaksTrench: true,
  },
};

export const SHELLS_PER_AMMO = 10;

/**
 * Feuerplan-Arten (Plan 4.1 Nr. 8). round: 'battle' = laeuft in den Gefechtsrunden eines Angriffs,
 * 'position' = wird in der Stellungsrunde selbst geschossen.
 *   line: braucht eine Linie (zwei Endpunkte), target: braucht ein Zielfeld, battery: zielt auf eine feindliche Batterie
 *   depth: Tiefe des Zielstreifens in Feldern (in Richtung des Plans), moves: Walze rueckt vor
 *   trigger: 'enemy' = schiesst nur, wenn Feind nahe der Linie gemeldet ist (Sperrfeuer auf Abruf)
 *   salvo: Anteil der vollen Granatenzahl je Runde in Hundertsteln
 */
export const PLAN_KINDS = {
  prep:    { id: 'prep',    label: 'Vorbereitungsfeuer', short: 'Vorbereitung', round: 'battle', line: true, depth: 2, rounds: [1, 6], salvo: 100 },
  barrage: { id: 'barrage', label: 'Sperrfeuer',         short: 'Sperrfeuer',   round: 'battle', line: true, depth: 1, rounds: [1, 12], salvo: 100, trigger: 'enemy', triggerRange: 3 },
  creep:   { id: 'creep',   label: 'Feuerwalze',         short: 'Walze',        round: 'battle', line: true, depth: 1, rounds: [2, 12], salvo: 100, moves: true, steps: [1, 3] },
  harass:  { id: 'harass',  label: 'Störfeuer',          short: 'Störfeuer',    round: 'position', target: true, radius: 2, salvo: 50 },
  counter: { id: 'counter', label: 'Gegenbatteriefeuer', short: 'Gegenbatterie', round: 'position', battery: true, radius: 1, salvo: 100 },
};

/** Verzoegerung von "Feuer verlegen/einstellen" in Gefechtsrunden (Plan 4.1 Nr. 8) */
export const LINK_DELAY = { phone: 1, runner: 2 };

/** Abstand eines Beobachters zum vorderen Ende einer Leitung, in dem er noch angeschlossen ist (Felder) */
export const LINE_REACH = 2;

/** Chance in Hundertsteln, dass ein Einschlag auf einem Leitungsfeld die Leitung zerreisst */
export const LINE_CUT = 40;

/** Chance in Hundertsteln je feuernder Runde, dass der Gegner die Batterie am Muendungsblitz ausmacht (Tag, Nacht) */
export const FLASH_SPOT = { day: 20, night: 45 };

/** Gefechtsrunden, die eine getroffene Batterie schweigt */
export const SILENCED_ROUNDS = 2;

/** Ab so vielen Einschlaegen wird aus dem Trichter ein grosser Krater (Stufe 2) */
export const CRATER_BIG = 3;
