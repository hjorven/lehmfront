// Fraktionen (Plan 2.2). Reine Daten. Faktoren sind Multiplikatoren auf Grundwerte (1 = neutral).
// Farben stehen nicht hier: eigen/feindlich haengt von der Sicht ab und kommt aus js/theme.js.

export const FACTIONS = {
  kaldern: {
    id: 'kaldern', name: 'Republik Kaldern', short: 'Kaldern', adjective: 'kaldrisch',
    names: 'kaldern',
    artillery: { tubes: 1.25, ammo: 1.3, spread: 0.8 },
    replacements: { speed: 0.6, groupSize: 0.85 },
    losses: { reputation: 1.3, trust: 1.3 },
    materials: { concrete: 'start', fascines: 'start', concreteFromAct: 1 },
    morale: { breakFactor: 1.25, recovery: 1.3 },
    units: { pioneers: { cost: 0.8, digRate: 1.25 } },
    stormtroopsFromAct: 2,
    supplies: { ammo: 120, food: 100, material: 90 },
  },
  morrow: {
    id: 'morrow', name: 'Haus Morrow', short: 'Morrow', adjective: 'morrowsch',
    names: 'morrow',
    artillery: { tubes: 0.8, ammo: 0.9, spread: 1.3 },
    replacements: { speed: 1.5, groupSize: 1.15 },
    losses: { reputation: 0.7, trust: 1 },
    materials: { concrete: 'late', fascines: 'start', concreteFromAct: 3 },
    morale: { breakFactor: 0.8, recovery: 0.75 },
    units: { pioneers: { cost: 1, digRate: 1 } },
    stormtroopsFromAct: 1,
    supplies: { ammo: 90, food: 110, material: 70 },
  },
};

export function faction(id) {
  const f = FACTIONS[id];
  if (!f) throw new Error('Unbekannte Fraktion: ' + id);
  return f;
}
