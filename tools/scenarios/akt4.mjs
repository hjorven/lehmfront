// Erzeugt die Szenarien fuer Akt 4 "Das letzte Fruehjahr" (P26) unter data/scenarios/akt4-*.json.
// Aufruf: node tools/scenarios/akt4.mjs
// a4m1, a4m2, a4m4 und a4m6 spielen vor Raudas (data/maps/raudas.json), a4m3 unter Huegel 214
// (data/maps/huegel214.json), a4m5 am Faehrhaus Ostervenn (data/maps/faehrhaus.json). Ein Test prueft, dass die
// Dateien diesem Lauf entsprechen.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lineCells } from '../../js/map.js';
import { buildRaudas, RAUDAS, FAEHRHAUS } from '../maps/akt4.mjs';

const FEDDERS = { name: 'Swantje Fedders', home: 'Grauwarf' };
const ALBERS = { name: 'Wiebke Albers', home: 'Fennhusen' };
export const HARMS = { name: 'Otto Harms', home: 'Ostmoor' };
export const BRANDT = { name: 'Ilse Brandt', home: 'Haverstadt' };

const SPRING = (o = {}) => ({ kind: 'overcast', season: 'fruehling', wind: { dir: 'w', speed: 1 }, ...o });

/** Morrows Batterien hinter Raudas bzw. hinter dem Wald am Faehrhaus */
const MORROW_ART = {
  raudas: {
    exchange: { x: 55, y: 20 },
    batteries: [
      { id: 'mb1', type: 'feldhaubitzen', x: 56, y: 33, w: 2, h: 2, label: 'Batterie Raudas Süd' },
      { id: 'mb2', type: 'feldhaubitzen', x: 56, y: 4, w: 2, h: 2, label: 'Batterie Raudas Nord' },
    ],
    lines: [
      { id: 'm1', to: 'Bahndamm', points: [[55, 20], [50, 20], [47, 20]] },
      { id: 'm2', to: 'mb1', points: [[55, 20], [56, 33]] },
      { id: 'm3', to: 'mb2', points: [[55, 20], [56, 5]] },
    ],
  },
  huegel214: {
    exchange: { x: 52, y: 19 },
    batteries: [
      { id: 'mb1', type: 'feldhaubitzen', x: 54, y: 9, w: 2, h: 2, label: 'Batterie Morrow 1' },
      { id: 'mb2', type: 'feldhaubitzen', x: 54, y: 27, w: 2, h: 2, label: 'Batterie Morrow 2' },
    ],
    lines: [
      { id: 'm1', to: 'Abschnitt Hügel', points: [[52, 19], [47, 18], [45, 18]] },
      { id: 'm3', to: 'mb1', points: [[52, 19], [54, 10]] },
      { id: 'm4', to: 'mb2', points: [[52, 19], [54, 27]] },
    ],
  },
  faehrhaus: {
    exchange: { x: 53, y: 19 },
    batteries: [
      { id: 'mb1', type: 'feldhaubitzen', x: 55, y: 6, w: 2, h: 2, label: 'Batterie Morrow Nord' },
      { id: 'mb2', type: 'feldhaubitzen', x: 55, y: 36, w: 2, h: 2, label: 'Batterie Morrow Süd' },
    ],
    lines: [
      { id: 'm1', to: 'Abschnitt Fährhaus', points: [[53, 19], [49, 19]] },
      { id: 'm2', to: 'mb1', points: [[53, 19], [55, 7]] },
      { id: 'm3', to: 'mb2', points: [[53, 19], [55, 36]] },
    ],
  },
};

function base(id, name, { map = 'raudas', features = [], startHour = 6, weather = SPRING(), cells = [], a, b, goals = {}, bAi = {}, mission, day, view }) {
  return {
    id, name, map, act: 4, features: [...features].sort(), startHour, turnKind: 'position',
    weather,
    cells,
    ...(mission ? { mission } : {}),
    ...(day ? { day } : {}),
    ...(view ? { view } : {}),
    sides: {
      a: { faction: 'kaldern', supplies: { carts: 4, cartsTotal: 6 }, ai: { goals }, ...a },
      b: { faction: 'morrow', control: 'ai', ai: { doctrine: 'tiefe', difficulty: 'veteran', ...bAi }, supplies: { carts: 3, cartsTotal: 5 }, artillery: MORROW_ART[map], ...b },
    },
  };
}

// ---------------------------------------------------------------- Raudas: Felder

/** Lasks vordere Linie (Feuergraben, x 33/34), wie in tools/maps/akt4.mjs */
export function raudasFirstLine() {
  const m = buildRaudas();
  return m.trenches.filter((t) => t.side === 'enemy' && t.kind === 'fire' && t.x <= RAUDAS.firstLine + 1).map((t) => ({ x: t.x, y: t.y }));
}

/** Sprengfallen in der geraeumten vorderen Linie (a4m1) */
const TRAPS = [[33, 3], [33, 6], [34, 11], [34, 14], [33, 19], [35, 21], [33, 23], [34, 29], [34, 33], [34, 36]]
  .map(([x, y]) => ({ x, y, trap: { side: 'enemy' } }));

/**
 * Nach a4m1/a4m2 gehoeren Lasks vordere und zweite Linie dem Abschnitt (a4m4, a4m6): alle Feindgraeben bis x 40
 * werden eigene, ein Laufgraben entlang der Strasse verbindet die alte Linie mit der neuen, der Draht dort ist weg.
 */
function takenCells() {
  const m = buildRaudas();
  const out = [];
  for (const t of m.trenches) {
    if (t.side !== 'enemy' || t.x > RAUDAS.secondLine) continue;
    out.push({ x: t.x, y: t.y, trench: { side: 'own', kind: t.kind, level: t.level, facing: 'E' } });
  }
  for (const [x, y] of lineCells(RAUDAS.ownLine + 1, RAUDAS.road, RAUDAS.firstLine - 1, RAUDAS.road)) {
    out.push({ x, y, trench: { side: 'own', kind: 'comm', level: 1, facing: 'E' }, ...(x === 26 || x === 31 ? { wire: null } : {}) });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

/** Morrow am Bahndamm (a4m4, a4m6) */
const DAMM_B = [
  { type: 'rifles', pos: { x: 47, y: 9 } },
  { type: 'mg', pos: { x: 47, y: 15 } },
  { type: 'rifles', pos: { x: 47, y: 20 } },
  { type: 'mg', pos: { x: 47, y: 25 } },
  { type: 'rifles', pos: { x: 47, y: 31 } },
  { type: 'stormtroops', pos: { x: 50, y: 20 } },
];

export function buildAkt4() {
  const out = {};

  // a4m1 Tauwetter: Lask hat seine vordere Linie geraeumt; besetzen, was er stehen liess (Fallen)
  out['akt4-m1'] = base('akt4-m1', 'Tauwetter', {
    features: ['fieldgun', 'occupy', 'traps'],
    weather: SPRING({ kind: 'rain', rain: 0.3, wet: 2 }),
    cells: TRAPS,
    goals: { attack: { x: RAUDAS.firstLine, y: 20 } },
    mission: { id: 'a4m1', lask: [{ from: 1, posture: 'halten' }, { from: 3, posture: 'sturm' }, { from: 5, posture: 'auto' }] },
    a: { groups: [
      { type: 'rifles', pos: { x: 23, y: 4 }, morale: 62 },
      { type: 'rifles', pos: { x: 24, y: 12 }, morale: 62 },
      { type: 'mg', pos: { x: 23, y: 19 }, morale: 64 },
      { type: 'rifles', pos: { x: 23, y: 22 }, morale: 66, leader: HARMS, harms: true },
      { type: 'rifles', pos: { x: 23, y: 28 }, morale: 60 },
      { type: 'mg', pos: { x: 24, y: 34 }, morale: 62 },
      { type: 'pioneers', pos: { x: 23, y: 20 }, morale: 68, leader: FEDDERS },
      { type: 'pioneers', pos: { x: 24, y: 10 }, morale: 64 },
      { type: 'fieldgun', pos: { x: 19, y: 18 }, morale: 68 },
      { type: 'observers', pos: { x: 18, y: 9 }, morale: 66 },
      { type: 'medics', pos: { x: 18, y: 25 }, morale: 70 },
    ] },
    b: { groups: [
      { type: 'rifles', pos: { x: 40, y: 8 } },
      { type: 'mg', pos: { x: 40, y: 13 } },
      { type: 'mg', pos: { x: 39, y: 20 } },
      { type: 'rifles', pos: { x: 40, y: 27 } },
      { type: 'rifles', pos: { x: 40, y: 32 } },
      { type: 'stormtroops', pos: { x: 47, y: 20 } },
    ] },
  });

  // a4m2 Der Kasten: der Panzerwagen K1 faehrt die Strasse hinauf bis an die zweite Linie
  out['akt4-m2'] = base('akt4-m2', 'Der Kasten', {
    features: ['fieldgun', 'tank'],
    weather: SPRING({ kind: 'clear', fixed: true, wet: 0 }),
    cells: raudasFirstLine().filter((p) => p.y >= 14 && p.y <= 26).map((p) => ({ ...p, trench: { side: 'own', kind: 'fire', level: 3, facing: 'E' } })),
    goals: { attack: { x: RAUDAS.secondLine - 1, y: 20 }, tank: true },
    mission: { id: 'a4m2', lask: [{ from: 1, posture: 'halten' }, { from: 4, posture: 'auto' }] },
    a: { groups: [
      { type: 'tank', pos: { x: 30, y: 20 }, morale: 70, experience: 0, callsign: 'K1', leader: { name: 'Tjark Boysen', home: 'Haverstadt' } },
      { type: 'stormtroops', pos: { x: 33, y: 19 }, morale: 70, experience: 2 },
      { type: 'rifles', pos: { x: 33, y: 22 }, morale: 64, leader: HARMS, harms: true },
      { type: 'rifles', pos: { x: 34, y: 15 }, morale: 62 },
      { type: 'pioneers', pos: { x: 30, y: 21 }, morale: 68, leader: FEDDERS },
      { type: 'mg', pos: { x: 33, y: 25 }, morale: 64 },
      { type: 'fieldgun', pos: { x: 21, y: 18 }, morale: 68 },
      { type: 'medics', pos: { x: 18, y: 20 }, morale: 70 },
    ] },
    b: { groups: [
      { type: 'mg', pos: { x: 39, y: 19 } },
      { type: 'rifles', pos: { x: 39, y: 21 } },
      { type: 'fieldgun', pos: { x: 41, y: 20 } },
      { type: 'rifles', pos: { x: 40, y: 13 } },
      { type: 'rifles', pos: { x: 40, y: 27 } },
      { type: 'stormtroops', pos: { x: 47, y: 20 } },
    ] },
  });

  // a4m3 Unter dem Huegel: die grosse Mine; Lask graebt einen Gegenstollen, die Kammer muss halten bis zur Zuendung
  const GALLERY = Array.from({ length: 10 }, (_, i) => ({ x: 31 + i, y: 18 }));
  const MINE = { id: 'mine214', label: 'Große Mine', place: 'Hügel 214', time: '04:10', gallery: GALLERY, chamber: { x: 41, y: 18 }, fuse: 6 };
  const BTUNNEL = [[39, 23], [38, 22], [37, 21], [36, 21], [35, 20], [34, 20], [33, 19]].map(([x, y]) => ({ x, y }));
  const m3a = [
    { type: 'pioneers', pos: { x: 30, y: 18 }, morale: 68, leader: FEDDERS },
    { type: 'listeners', pos: { x: 30, y: 16 }, morale: 66, leader: ALBERS },
    { type: 'rifles', pos: { x: 29, y: 21 }, morale: 64, leader: HARMS, harms: true },
    { type: 'pioneers', pos: { x: 29, y: 23 }, morale: 64 },
    { type: 'mg', pos: { x: 30, y: 12 }, morale: 64 },
    { type: 'rifles', pos: { x: 29, y: 26 }, morale: 60 },
    { type: 'listeners', pos: { x: 29, y: 24 }, morale: 60 },
  ];
  out['akt4-m3'] = base('akt4-m3', 'Unter dem Hügel', {
    map: 'huegel214',
    features: ['tunnel'],
    startHour: 18,
    weather: SPRING({ kind: 'overcast', wet: 1 }),
    goals: { mine: true },
    mission: { id: 'a4m3', lask: [{ from: 1, posture: 'halten' }] },
    a: { mine: MINE, groups: m3a },
    b: {
      groups: [
        { type: 'rifles', pos: { x: 40, y: 22 } },
        { type: 'mg', pos: { x: 40, y: 17 } },
        { type: 'rifles', pos: { x: 40, y: 19 } },
        { type: 'rifles', pos: { x: 40, y: 12 } },
        { type: 'rifles', pos: { x: 45, y: 18 } },
        { type: 'listeners', pos: { x: 45, y: 21 } },
      ],
      tunnels: [{ group: 'b01', path: BTUNNEL, dug: 2 }],
    },
  });
  // Gewarnt: Lask hat die Kuppe geraeumt, nur Posten in der zweiten Linie
  out['akt4-m3-leer'] = base('akt4-m3-leer', 'Unter dem Hügel', {
    map: 'huegel214',
    features: ['tunnel'],
    startHour: 18,
    weather: SPRING({ kind: 'overcast', wet: 1 }),
    goals: { mine: true },
    mission: { id: 'a4m3', lask: [{ from: 1, posture: 'halten' }] },
    a: { mine: { ...MINE, fuse: 3 }, groups: m3a },
    b: { groups: [
      { type: 'rifles', pos: { x: 47, y: 12 } },
      { type: 'mg', pos: { x: 47, y: 18 } },
      { type: 'rifles', pos: { x: 47, y: 24 } },
    ] },
  });
  // Geflutet: keine Mine. Lask hat es gemerkt und greift den Hang an; halten
  out['akt4-m3-geflutet'] = base('akt4-m3-geflutet', 'Unter dem Hügel', {
    map: 'huegel214',
    features: [],
    startHour: 18,
    weather: SPRING({ kind: 'rain', rain: 0.4, wet: 2 }),
    mission: { id: 'a4m3', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 2, posture: 'sturm' }, { from: 4, posture: 'auto' }] },
    a: { groups: [
      { type: 'rifles', pos: { x: 29, y: 21 }, morale: 64, leader: HARMS, harms: true },
      { type: 'mg', pos: { x: 30, y: 17 }, morale: 64 },
      { type: 'rifles', pos: { x: 30, y: 12 }, morale: 62 },
      { type: 'mg', pos: { x: 29, y: 25 }, morale: 64 },
      { type: 'pioneers', pos: { x: 30, y: 18 }, morale: 66, leader: FEDDERS },
      { type: 'rifles', pos: { x: 29, y: 30 }, morale: 60 },
      { type: 'medics', pos: { x: 24, y: 20 }, morale: 70 },
    ] },
    b: { groups: [
      { type: 'stormtroops', pos: { x: 40, y: 18 } },
      { type: 'stormtroops', pos: { x: 40, y: 22 } },
      { type: 'rifles', pos: { x: 40, y: 12 } },
      { type: 'mg', pos: { x: 45, y: 18 } },
      { type: 'rifles', pos: { x: 41, y: 28 } },
    ] },
  });

  // a4m4 Geruechte: Sturm auf den Bahndamm; Gruppen mit wenig Vertrauen verweigern
  const TAKEN = takenCells();
  const m4a = (variant) => [
    { type: 'rifles', pos: { x: 40, y: 10 }, morale: 58 },
    { type: 'rifles', pos: { x: 40, y: 14 }, morale: 56 },
    { type: 'mg', pos: { x: 39, y: 19 }, morale: 60 },
    { type: 'stormtroops', pos: { x: 39, y: 21 }, morale: 62, experience: 2 },
    { type: 'rifles', pos: { x: 40, y: 25 }, morale: 56, leader: HARMS, harms: true },
    ...(variant === 'gemeldet' ? [] : [{ type: 'rifles', pos: { x: 40, y: 29 }, morale: 54 }]),
    { type: 'mg', pos: { x: 40, y: 33 }, morale: 58 },
    { type: 'pioneers', pos: { x: 39, y: 18 }, morale: 62, leader: FEDDERS },
    { type: 'medics', pos: { x: 33, y: 20 }, morale: 68 },
    ...(variant === 'brandt' ? [{ type: 'rifles', pos: { x: 39, y: 20 }, strength: 4, morale: 80, experience: 1, leader: BRANDT, brandt: true }] : []),
  ];
  const m4 = (id, variant) => base(id, 'Gerüchte', {
    features: variant === 'halten' ? ['fieldgun'] : ['fieldgun', 'occupy'],
    weather: SPRING({ kind: 'overcast', wet: 1 }),
    cells: TAKEN,
    goals: { attack: { x: RAUDAS.damm + 1, y: 20 } },
    mission: variant === 'halten'
      ? { id: 'a4m4', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 2, posture: 'sturm' }, { from: 4, posture: 'auto' }] }
      : { id: 'a4m4', lask: [{ from: 1, posture: 'halten' }, { from: 3, posture: 'auto' }] },
    a: { refusal: true, ...(variant === 'harms' ? { harmsUsed: true } : {}), groups: m4a(variant) },
    b: { groups: DAMM_B.filter((g) => g.type !== 'stormtroops') },
  });
  out['akt4-m4'] = m4('akt4-m4', 'befehl');
  out['akt4-m4-gemeldet'] = m4('akt4-m4-gemeldet', 'gemeldet');
  out['akt4-m4-brandt'] = m4('akt4-m4-brandt', 'brandt');
  out['akt4-m4-harms'] = m4('akt4-m4-harms', 'harms');
  out['akt4-m4-halten'] = m4('akt4-m4-halten', 'halten');

  // a4m5 Die Bruecke: Pioniere schlagen eine Bruecke ueber die Asse, bis das Gleis wieder ueber den Fluss geht
  const F = FAEHRHAUS;
  out['akt4-m5'] = base('akt4-m5', 'Die Brücke', {
    map: 'faehrhaus',
    features: ['bridge'],
    view: { x: 20, y: 20 },
    weather: SPRING({ kind: 'rain', rain: 0.5, wet: 3 }),
    goals: { bridge: { x: F.river[0], y: F.bridgeY } },
    mission: {
      id: 'a4m5',
      lask: [{ from: 1, posture: 'vorbereiten' }, { from: 3, posture: 'sturm' }, { from: 5, posture: 'auto' }],
      fire: [
        { from: 2, to: 3, plan: { id: 'm-bruecke', kind: 'harass', batteries: ['mb1'], target: { x: 18, y: F.bridgeY } } },
        { from: 5, to: 5, plan: { id: 'm-bruecke', kind: 'harass', batteries: ['mb2'], target: { x: 18, y: F.bridgeY } } },
      ],
    },
    a: {
      supplies: { carts: 4, cartsTotal: 6, material: 40 },
      groups: [
        { type: 'pioneers', pos: { x: F.westRail, y: F.bridgeY - 1 }, morale: 70, leader: FEDDERS },
        { type: 'pioneers', pos: { x: F.westRail, y: F.bridgeY + 1 }, morale: 66 },
        { type: 'rifles', pos: { x: F.westRail, y: F.bridgeY }, morale: 62 },
        { type: 'medics', pos: { x: 11, y: 24 }, morale: 70 },
        { type: 'rifles', pos: { x: 34, y: 5 }, morale: 54, fatigue: 30 },
        { type: 'mg', pos: { x: 33, y: 14 }, morale: 56, fatigue: 30 },
        { type: 'rifles', pos: { x: 33, y: 20 }, morale: 56, fatigue: 30, leader: HARMS, harms: true },
        { type: 'mg', pos: { x: 33, y: 26 }, morale: 54, fatigue: 30 },
        { type: 'rifles', pos: { x: 34, y: 33 }, morale: 52, fatigue: 30 },
        { type: 'listeners', pos: { x: 28, y: 20 }, morale: 60, leader: ALBERS },
      ],
    },
    b: { groups: [
      { type: 'rifles', pos: { x: 44, y: 8 } },
      { type: 'rifles', pos: { x: 43, y: 16 } },
      { type: 'mg', pos: { x: 43, y: 22 } },
      { type: 'rifles', pos: { x: 43, y: 28 } },
      { type: 'rifles', pos: { x: 44, y: 34 } },
      { type: 'stormtroops', pos: { x: 49, y: 20 } },
    ] },
  });

  // a4m6 Der letzte Tag: vier Fassungen nach dem Ende, auf das der Feldzug zulaeuft
  const m6a = (extra = []) => [
    { type: 'rifles', pos: { x: 40, y: 8 }, morale: 60 },
    { type: 'mg', pos: { x: 40, y: 13 }, morale: 62 },
    { type: 'rifles', pos: { x: 39, y: 18 }, morale: 60, leader: HARMS, harms: true },
    { type: 'mg', pos: { x: 39, y: 21 }, morale: 62 },
    { type: 'rifles', pos: { x: 40, y: 26 }, morale: 58 },
    { type: 'mg', pos: { x: 40, y: 31 }, morale: 60 },
    { type: 'pioneers', pos: { x: 39, y: 20 }, morale: 64, leader: FEDDERS },
    { type: 'medics', pos: { x: 33, y: 20 }, morale: 70 },
    ...extra,
  ];
  // Der Abschnitt haelt: Lasks letzter Angriff in der Nacht
  out['akt4-m6-haelt'] = base('akt4-m6-haelt', 'Der letzte Tag', {
    features: ['fieldgun'],
    startHour: 18,
    weather: SPRING({ kind: 'overcast', wet: 1 }),
    cells: TAKEN,
    mission: { id: 'a4m6', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 2, posture: 'sturm' }] },
    a: { groups: m6a([{ type: 'fieldgun', pos: { x: 35, y: 20 }, morale: 68 }]) },
    b: { groups: [...DAMM_B, { type: 'stormtroops', pos: { x: 47, y: 12 } }, { type: 'stormtroops', pos: { x: 47, y: 28 } }] },
  });
  // Waffenstillstand: bis zwoelf Uhr kein Schuss zu viel
  out['akt4-m6-waffenstillstand'] = base('akt4-m6-waffenstillstand', 'Der letzte Tag', {
    features: ['truce'],
    startHour: 0,
    day: { ceasefireAfter: 12 },
    weather: SPRING({ kind: 'clear', wind: { dir: 'w', speed: 0 } }),
    cells: TAKEN,
    goals: { recover: true },
    mission: { id: 'a4m6', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 2, posture: 'halten' }] },
    a: { groups: m6a() },
    b: { groups: DAMM_B },
  });
  // Durchbruch um jeden Preis: ueber den Bahndamm bis Raudas, mit zwei neuen Wagen
  out['akt4-m6-durchbruch'] = base('akt4-m6-durchbruch', 'Der letzte Tag', {
    features: ['fieldgun', 'occupy', 'tank'],
    startHour: 6,
    weather: SPRING({ kind: 'clear', fixed: true, wet: 0 }),
    cells: TAKEN,
    goals: { attack: { x: RAUDAS.damm + 1, y: 20 }, tank: true },
    mission: { id: 'a4m6', lask: [{ from: 1, posture: 'halten' }, { from: 3, posture: 'auto' }] },
    a: { groups: m6a([
      { type: 'tank', pos: { x: 38, y: 20 }, morale: 70, experience: 1, callsign: 'K2' },
      { type: 'tank', pos: { x: 38, y: 24 }, morale: 70, experience: 0, callsign: 'K3' },
      { type: 'stormtroops', pos: { x: 39, y: 22 }, morale: 70, experience: 2 },
      { type: 'stormtroops', pos: { x: 40, y: 15 }, morale: 68, experience: 2 },
    ]) },
    b: { groups: [...DAMM_B.filter((g) => g.type !== 'stormtroops'), { type: 'mg', pos: { x: 53, y: 18 } }, { type: 'rifles', pos: { x: 54, y: 23 } }] },
  });
  // Abgeloest: bis Mittag halten, dann uebergeben; keine Verwundeten zuruecklassen
  out['akt4-m6-abgeloest'] = base('akt4-m6-abgeloest', 'Der letzte Tag', {
    features: ['fieldgun'],
    startHour: 12,
    day: { handoverAfter: 24 },
    weather: SPRING({ kind: 'rain', rain: 0.3, wet: 2 }),
    cells: TAKEN,
    mission: { id: 'a4m6', lask: [{ from: 1, posture: 'vorbereiten' }, { from: 2, posture: 'sturm' }] },
    a: { groups: m6a() },
    b: { groups: DAMM_B },
  });
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, s] of Object.entries(buildAkt4())) {
    writeFileSync(new URL(`../../data/scenarios/${id}.json`, import.meta.url), JSON.stringify(s, null, 2) + '\n');
    console.log(`data/scenarios/${id}.json`);
  }
}
