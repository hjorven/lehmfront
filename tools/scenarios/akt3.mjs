// Erzeugt die Szenarien fuer Akt 3 "Materialschlacht" (P24) unter data/scenarios/akt3-*.json.
// Aufruf: node tools/scenarios/akt3.mjs
// Alle Missionen spielen auf data/maps/kroning.json (Asse-Mitte im Winter). Ein Test prueft, dass die Dateien
// diesem Lauf entsprechen.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { KRONING } from '../maps/kroning.mjs';

const FEDDERS = { name: 'Swantje Fedders', home: 'Grauwarf' };
const ALBERS = { name: 'Wiebke Albers', home: 'Fennhusen' };

/** Sappe vom eigenen Graben in den Rand des Kraehenholzes (a3m2) */
// a3m6: Sturmausgangsstellung, in den Naechten vor dem X-Tag ins Niemandsland gegraben, mit Laufgraeben zur Linie
const JUMP_CELLS = [
  ...Array.from({ length: 13 }, (_, i) => ({ x: 35, y: 15 + i, trench: { side: 'own', kind: 'fire', level: 1, facing: 'E' } })),
  ...[31, 32, 33, 34].flatMap((x) => [17, 24].map((y) => ({ x, y, trench: { side: 'own', kind: 'comm', level: 1, facing: 'E' } }))),
];
const SAP_CELLS = [31, 32, 33].map((x) => ({ x, y: 7, trench: { side: 'own', kind: 'comm', level: 1, facing: 'E', sap: true } }));
/** Gas, das in der Nacht mit dem Ostwind kam und in der Sappe und der Mulde liegt */
const GAS_CELLS = [
  { x: 33, y: 7, gas: 3, gasBy: 'b' }, { x: 34, y: 7, gas: 3, gasBy: 'b' }, { x: 32, y: 7, gas: 2, gasBy: 'b' },
  { x: 33, y: 6, gas: 2, gasBy: 'b' }, { x: 33, y: 8, gas: 2, gasBy: 'b' }, { x: 34, y: 8, gas: 2, gasBy: 'b' },
  { x: 32, y: 12, gas: 2, gasBy: 'b' }, { x: 33, y: 12, gas: 2, gasBy: 'b' }, { x: 33, y: 13, gas: 1, gasBy: 'b' },
  { x: 31, y: 7, gas: 1, gasBy: 'b' },
];
/** Verwundete draussen nach dem letzten Angriff (a3m5) */
const LYING = [
  { x: 33, y: 17, lying: { a: 3 } }, { x: 35, y: 20, lying: { a: 2, b: 1 } }, { x: 34, y: 15, lying: { a: 2 } },
  { x: 36, y: 22, lying: { a: 2 } }, { x: 37, y: 18, lying: { b: 3 } }, { x: 38, y: 21, lying: { b: 2 } },
];

export const MORROW_ART = {
  exchange: { x: 51, y: 20 },
  batteries: [
    { id: 'mb1', type: 'feldhaubitzen', x: 54, y: 27, w: 2, h: 2, label: 'Batterie Zelva 1' },
    { id: 'mb2', type: 'feldhaubitzen', x: 56, y: 32, w: 2, h: 2, label: 'Batterie Zelva 2' },
    { id: 'mb3', type: 'schwere', x: 52, y: 3, w: 2, h: 2, label: 'Schwere Batterie Raudas' },
  ],
  lines: [
    { id: 'm1', to: 'Abschnitt Mitte', points: [[51, 20], [47, 20], [46, 18]] },
    { id: 'm2', to: 'mb1', points: [[51, 20], [54, 27]] },
    { id: 'm3', to: 'mb2', points: [[51, 20], [56, 32]] },
    { id: 'm4', to: 'mb3', points: [[51, 20], [52, 4]] },
  ],
};
/** Eigene Artillerie: die zwei Batterien der Karte plus die neuen hinter Ostervenn */
const OWN_ART = (extra = true) => ({
  batteries: [
    { id: 'batterie1', type: 'feldhaubitzen', x: 11, y: 26, w: 2, h: 2, label: 'Batterie 1' },
    { id: 'batterie2', type: 'feldhaubitzen', x: 13, y: 33, w: 2, h: 2, label: 'Batterie 2' },
    ...(extra ? [
      { id: 'batterie3', type: 'feldhaubitzen', x: 8, y: 21, w: 2, h: 2, label: 'Batterie 3 (neu)' },
      { id: 'batterie4', type: 'schwere', x: 12, y: 37, w: 2, h: 2, label: 'Schwere Batterie 4 (neu)' },
    ] : []),
  ],
  exchange: { x: 14, y: 11 },
  lines: [
    { id: 'k8', to: 'batterie3', points: [[15, 12], [9, 21]] },
    { id: 'k9', to: 'batterie4', points: [[15, 12], [13, 37]] },
  ],
});

const WINTER = (o = {}) => ({ kind: 'clear', season: 'winter', wind: { dir: 'w', speed: 1 }, ...o });

function base(id, name, { features = [], startHour = 6, weather = WINTER(), cells = [], a, b, goals = {}, bAi = {}, mission, truce, art = true }) {
  return {
    id, name, map: 'kroning', act: 3, features: [...features].sort(), startHour, turnKind: 'position',
    weather,
    cells,
    ...(truce ? { truce } : {}),
    ...(mission ? { mission } : {}),
    sides: {
      a: { faction: 'kaldern', supplies: { carts: 4, cartsTotal: 6 }, artillery: OWN_ART(art), ai: { goals }, ...a },
      b: { faction: 'morrow', control: 'ai', ai: { doctrine: 'material', difficulty: 'veteran', ...bAi }, supplies: { carts: 3, cartsTotal: 5 }, artillery: MORROW_ART, ...b },
    },
  };
}

/** Morrows erste Linie (duenn) und zweite Linie (tief), Stellungen fuer die Gruppen */
const FIRST = (n) => [[41, 4], [42, 12], [42, 18], [41, 26], [42, 34]].slice(0, n).map(([x, y]) => ({ x, y }));

export function buildAkt3() {
  const out = {};

  // a3m1 Kalte Rohre: halten, waehrend beide Seiten einschiessen; Feldgeschuetz, Feuerwalze lernen
  out['akt3-m1'] = base('akt3-m1', 'Kalte Rohre', {
    features: ['fieldgun'],
    weather: WINTER({ kind: 'overcast' }),
    mission: {
      id: 'a3m1',
      lask: [{ from: 1, posture: 'vorbereiten' }, { from: 3, posture: 'sturm' }, { from: 5, posture: 'auto' }],
      fire: [
        { from: 1, to: 2, plan: { id: 'm-einschiessen', kind: 'harass', batteries: ['mb3'], target: { x: 29, y: 16 } } },
        { from: 4, to: 5, plan: { id: 'm-einschiessen', kind: 'harass', batteries: ['mb3'], target: { x: 30, y: 26 } } },
      ],
    },
    a: { groups: [
      { type: 'rifles', pos: { x: 29, y: 4 }, morale: 66 },
      { type: 'rifles', pos: { x: 30, y: 11 }, morale: 66 },
      { type: 'mg', pos: { x: 29, y: 17 }, morale: 66 },
      { type: 'rifles', pos: { x: 29, y: 21 }, morale: 64 },
      { type: 'mg', pos: { x: 30, y: 27 }, morale: 66 },
      { type: 'rifles', pos: { x: 29, y: 34 }, morale: 64 },
      { type: 'fieldgun', pos: { x: 24, y: 20 }, morale: 70, experience: 0 },
      { type: 'observers', pos: { x: 24, y: 8 }, morale: 68 },
      { type: 'pioneers', pos: { x: 24, y: 26 }, morale: 66, leader: FEDDERS },
      { type: 'medics', pos: { x: 24, y: 15 }, morale: 70 },
    ] },
    b: { groups: [
      ...FIRST(5).map((pos, i) => ({ type: i === 2 ? 'mg' : 'rifles', pos })),
      { type: 'stormtroops', pos: { x: 46, y: 20 } },
      { type: 'rifles', pos: { x: 46, y: 24 } },
    ] },
  });

  // a3m2 Gelber Nebel: Gruppe im Sappenkopf aus dem Gas holen, Ostwind
  out['akt3-m2'] = base('akt3-m2', 'Gelber Nebel', {
    features: ['gas', 'raid', 'sap'],
    startHour: 18,
    weather: WINTER({ kind: 'overcast', wind: { dir: 'e', speed: 1 } }),
    cells: [...SAP_CELLS, ...GAS_CELLS],
    goals: { rescue: { x: 29, y: 7, group: 'a01' } },
    a: {
      masks: true,
      groups: [
        { type: 'rifles', pos: { x: 33, y: 7 }, strength: 6, morale: 40, fatigue: 50, gassed: true },
        { type: 'medics', pos: { x: 29, y: 8 }, morale: 70 },
        { type: 'pioneers', pos: { x: 29, y: 6 }, morale: 66, leader: FEDDERS },
        { type: 'rifles', pos: { x: 30, y: 11 }, morale: 62 },
        { type: 'mg', pos: { x: 29, y: 4 }, morale: 64 },
        { type: 'rifles', pos: { x: 29, y: 18 }, morale: 62 },
        { type: 'listeners', pos: { x: 30, y: 13 }, morale: 62, leader: ALBERS },
      ],
    },
    b: {
      masks: true,
      gas: { shells: 1 },
      groups: [
        { type: 'stormtroops', pos: { x: 41, y: 7 } },
        { type: 'rifles', pos: { x: 41, y: 3 } },
        { type: 'mg', pos: { x: 42, y: 12 } },
        { type: 'rifles', pos: { x: 42, y: 20 } },
      ],
    },
  });

  // a3m3 Augen am Himmel: Scheinbatterien, Tarnnetz ueber dem Depot, eigener Flieger
  out['akt3-m3'] = base('akt3-m3', 'Augen am Himmel', {
    features: ['decoy', 'plane'],
    weather: WINTER({ kind: 'clear', fixed: true, wind: { dir: 'w', speed: 1 } }),
    goals: { decoy: [{ x: 9, y: 28 }, { x: 10, y: 34 }], camo: [{ x: 3, y: 15 }], recon: [{ x: 54, y: 29 }] },
    bAi: { difficulty: 'lask', goals: { recon: [{ x: 6, y: 16 }, { x: 11, y: 27 }, { x: 10, y: 33 }] } },
    a: {
      air: 1,
      supplies: { carts: 4, cartsTotal: 6, material: 30 },
      groups: [
        { type: 'rifles', pos: { x: 29, y: 5 }, morale: 66 },
        { type: 'mg', pos: { x: 30, y: 12 }, morale: 66 },
        { type: 'rifles', pos: { x: 29, y: 20 }, morale: 64 },
        { type: 'rifles', pos: { x: 30, y: 28 }, morale: 64 },
        { type: 'pioneers', pos: { x: 24, y: 24 }, morale: 68, leader: FEDDERS },
        { type: 'pioneers', pos: { x: 24, y: 12 }, morale: 66 },
        { type: 'observers', pos: { x: 24, y: 8 }, morale: 66 },
      ],
    },
    b: {
      air: 1,
      groups: [
        ...FIRST(4).map((pos, i) => ({ type: i === 1 ? 'mg' : 'rifles', pos })),
      ],
    },
  });

  // a3m4 Befehl 117: drei Fassungen nach der Entscheidung
  const kroningB = [
    { type: 'mg', pos: { x: 34, y: 25 }, morale: 70 },
    { type: 'mg', pos: { x: 36, y: 27 }, morale: 70 },
    { type: 'rifles', pos: { x: 35, y: 26 }, morale: 66 },
    { type: 'mg', pos: { x: 41, y: 22 } },
    { type: 'rifles', pos: { x: 42, y: 16 } },
    { type: 'rifles', pos: { x: 41, y: 29 } },
  ];
  out['akt3-m4'] = base('akt3-m4', 'Befehl 117', {
    features: ['fieldgun'],
    startHour: 18,
    weather: WINTER({ kind: 'overcast', wind: { dir: 'sw', speed: 1 } }),
    goals: { attack: { x: 35, y: 26 }, flame: true },
    a: { groups: [
      { type: 'flamethrowers', pos: { x: 30, y: 25 }, morale: 70, leader: { name: 'Hinnerk Oltmann', home: 'Brookmoor' } },
      { type: 'stormtroops', pos: { x: 30, y: 26 }, morale: 72, experience: 2 },
      { type: 'rifles', pos: { x: 30, y: 24 }, morale: 66 },
      { type: 'rifles', pos: { x: 30, y: 28 }, morale: 64 },
      { type: 'pioneers', pos: { x: 29, y: 22 }, morale: 66, leader: FEDDERS },
      { type: 'fieldgun', pos: { x: 26, y: 25 }, morale: 70 },
      { type: 'mg', pos: { x: 29, y: 31 }, morale: 66 },
      { type: 'mg', pos: { x: 29, y: 19 }, morale: 66 },
      { type: 'medics', pos: { x: 24, y: 26 }, morale: 70 },
    ] },
    b: { groups: kroningB },
  });
  out['akt3-m4-graben'] = base('akt3-m4-graben', 'Befehl 117', {
    features: ['fieldgun', 'sap'],
    weather: WINTER({ kind: 'overcast', wind: { dir: 'sw', speed: 1 } }),
    goals: { sap: { x: 33, y: 26 } },
    a: { groups: [
      { type: 'pioneers', pos: { x: 30, y: 26 }, morale: 68, leader: FEDDERS },
      { type: 'pioneers', pos: { x: 30, y: 25 }, morale: 66 },
      { type: 'rifles', pos: { x: 30, y: 24 }, morale: 66 },
      { type: 'rifles', pos: { x: 30, y: 28 }, morale: 64 },
      { type: 'mg', pos: { x: 29, y: 31 }, morale: 66 },
      { type: 'fieldgun', pos: { x: 26, y: 25 }, morale: 70 },
      { type: 'medics', pos: { x: 24, y: 26 }, morale: 70 },
    ] },
    b: { groups: kroningB },
  });
  out['akt3-m4-halten'] = base('akt3-m4-halten', 'Befehl 117', {
    features: ['fieldgun'],
    weather: WINTER({ kind: 'overcast', wind: { dir: 'sw', speed: 1 } }),
    mission: { id: 'a3m4', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 3, posture: 'sturm' }, { from: 5, posture: 'auto' }] },
    a: { groups: [
      { type: 'rifles', pos: { x: 30, y: 24 }, morale: 62 },
      { type: 'rifles', pos: { x: 30, y: 28 }, morale: 60 },
      { type: 'mg', pos: { x: 29, y: 31 }, morale: 64 },
      { type: 'mg', pos: { x: 29, y: 19 }, morale: 64 },
      { type: 'rifles', pos: { x: 30, y: 12 }, morale: 62 },
      { type: 'fieldgun', pos: { x: 26, y: 25 }, morale: 66 },
      { type: 'medics', pos: { x: 24, y: 26 }, morale: 70 },
    ] },
    b: { groups: [...kroningB, { type: 'stormtroops', pos: { x: 42, y: 24 } }] },
  });

  // a3m5 Die laengste Nacht: Waffenruhe angenommen, geduldet oder abgelehnt
  const m5 = (id, truce) => base(id, 'Die längste Nacht', {
    features: ['raid', 'truce'],
    startHour: 18,
    weather: WINTER({ kind: 'clear', wind: { dir: 'w', speed: 0 } }),
    cells: LYING,
    goals: { recover: true },
    ...(truce ? { truce } : {}),
    bAi: { doctrine: truce ? 'material' : 'nacht' },
    a: { groups: [
      { type: 'medics', pos: { x: 30, y: 17 }, morale: 72 },
      { type: 'medics', pos: { x: 30, y: 22 }, morale: 70 },
      { type: 'rifles', pos: { x: 29, y: 16 }, morale: 62 },
      { type: 'rifles', pos: { x: 30, y: 24 }, morale: 60 },
      { type: 'mg', pos: { x: 30, y: 12 }, morale: 64 },
      { type: 'rifles', pos: { x: 30, y: 28 }, morale: 60 },
    ] },
    b: { groups: [
      { type: 'medics', pos: { x: 42, y: 19 } },
      { type: 'rifles', pos: { x: 42, y: 16 } },
      { type: 'mg', pos: { x: 42, y: 21 } },
      { type: 'stormtroops', pos: { x: 41, y: 25 } },
      { type: 'rifles', pos: { x: 41, y: 28 } },
    ] },
  });
  out['akt3-m5'] = m5('akt3-m5', { status: 'tolerated', by: 'b', rounds: 1 });
  out['akt3-m5-ruhe'] = m5('akt3-m5-ruhe', { status: 'active', by: 'b', rounds: 1 });
  out['akt3-m5-halten'] = m5('akt3-m5-halten', null);

  // a3m6 Die Walze: X-Tag, die erste Linie nehmen und gegen den Gegenstoss aus der zweiten halten
  out['akt3-m6'] = base('akt3-m6', 'Die Walze', {
    features: ['fieldgun', 'gas', 'plane'],
    startHour: 6,
    weather: WINTER({ kind: 'overcast', wind: { dir: 'w', speed: 1 } }),
    cells: JUMP_CELLS,
    goals: { attack: { x: 42, y: 20 }, flame: true, walze: true, gas: true, recon: [{ x: 47, y: 20 }] },
    bAi: { doctrine: 'tiefe' },
    a: {
      air: 1,
      gas: { shells: 2 },
      groups: [
        { type: 'stormtroops', pos: { x: 35, y: 18 }, morale: 74, experience: 2 },
        { type: 'stormtroops', pos: { x: 35, y: 23 }, morale: 72, experience: 2 },
        { type: 'flamethrowers', pos: { x: 35, y: 20 }, morale: 70, leader: { name: 'Hinnerk Oltmann', home: 'Brookmoor' } },
        { type: 'rifles', pos: { x: 35, y: 16 }, morale: 68 },
        { type: 'rifles', pos: { x: 35, y: 21 }, morale: 68 },
        { type: 'rifles', pos: { x: 35, y: 26 }, morale: 66 },
        { type: 'rifles', pos: { x: 30, y: 13 }, morale: 66 },
        { type: 'pioneers', pos: { x: 29, y: 22 }, morale: 68, leader: FEDDERS },
        { type: 'mg', pos: { x: 29, y: 19 }, morale: 66 },
        { type: 'mg', pos: { x: 30, y: 27 }, morale: 66 },
        { type: 'fieldgun', pos: { x: 26, y: 20 }, morale: 70 },
        { type: 'observers', pos: { x: 24, y: 8 }, morale: 68 },
        { type: 'medics', pos: { x: 24, y: 20 }, morale: 72 },
      ],
    },
    b: {
      masks: true,
      groups: [
        // Lask hat die vordere Linie verduennt: wenige, muede Gruppen vorn
        { type: 'rifles', pos: { x: 42, y: 15 }, strength: 7, morale: 55 },
        { type: 'mg', pos: { x: 42, y: 20 }, strength: 5, morale: 55 },
        { type: 'rifles', pos: { x: 41, y: 26 }, strength: 7, morale: 55 },
        // ... und eine zweite Linie, die auf keiner Karte steht
        { type: 'rifles', pos: { x: 46, y: 16 } },
        { type: 'mg', pos: { x: 46, y: 21 } },
        { type: 'rifles', pos: { x: 46, y: 25 } },
        { type: 'stormtroops', pos: { x: 47, y: 20 } },
        { type: 'mg', pos: { x: 47, y: 10 } },
      ],
    },
  });
  return out;
}

export const KRONING_CELLS = KRONING;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, s] of Object.entries(buildAkt3())) {
    writeFileSync(new URL(`../../data/scenarios/${id}.json`, import.meta.url), JSON.stringify(s, null, 2) + '\n');
    console.log(`data/scenarios/${id}.json`);
  }
}
