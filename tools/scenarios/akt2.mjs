// Erzeugt die Szenarien fuer Akt 2 "Lehm und Regen" (P23) unter data/scenarios/akt2-*.json.
// Aufruf: node tools/scenarios/akt2.mjs
// Alle Missionen spielen auf data/maps/huegel214.json. Ein Test prueft, dass die Dateien diesem Lauf entsprechen.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { lineCells } from '../../js/map.js';

const VELL = { id: 'vell', name: 'Jost Vell', rank: 'Leutnant', home: 'Haverstadt', skill: 'sturm' };
const ALBERS = { name: 'Wiebke Albers', home: 'Fennhusen' };
const FEDDERS = { name: 'Swantje Fedders', home: 'Grauwarf' };

/** Sappe vom eigenen Graben bis zum Heuwagen (in a2m1 gegraben) */
const SAP_CELLS = [30, 31, 32, 33, 34, 35].map((x) => ({ x, y: 21, trench: { side: 'own', kind: 'comm', level: 1, facing: 'E', sap: true } }));
/** Wasser in der Senke */
const WATER = [24, 28].flatMap((x) => [28, 29, 30, 31, 32, 33].map((y) => ({ x, y, water: 2 })));
/** Gassen im feindlichen Draht vor dem Hangfuss (Vells Leute, Sprengung) */
const GAPS = (ys) => ys.map((y) => ({ x: 38, y, wire: null }));
/** Trichter vor der Kuppe von Huegel 214 */
export const CRATER_CENTER = { x: 40, y: 18 };
const CRATER = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
  CRATER.push({ x: CRATER_CENTER.x + dx, y: CRATER_CENTER.y + dy, crater: dx || dy ? 1 : 2, mud: dx || dy ? 1 : 2, trichter: 'b0', trench: null });
}

const MORROW_ART = {
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
};
const OWN_ART = {
  lines: [
    { id: 'k4', to: 'batterie1', points: [[15, 12], [13, 20], [12, 28]] },
    { id: 'k5', to: 'B-Stelle Mitte', points: [[15, 12], [20, 15.5], [24, 15.5]] },
  ],
};

function base(id, name, { act = 2, features = [], startHour = 6, weather, cells = [], a, b, goals = {}, bAi = {} }) {
  return {
    id, name, map: 'huegel214', act, features, startHour, turnKind: 'position',
    weather,
    cells,
    sides: {
      a: { faction: 'kaldern', supplies: { carts: 4, cartsTotal: 6 }, artillery: OWN_ART, ai: { goals }, ...a },
      b: { faction: 'morrow', control: 'ai', ai: { doctrine: 'nacht', difficulty: 'veteran', ...bAi }, supplies: { carts: 3, cartsTotal: 5 }, artillery: MORROW_ART, ...b },
    },
  };
}

export function buildAkt2() {
  const out = {};
  out['akt2-m1'] = base('akt2-m1', 'Wasser im Graben', {
    features: ['officers', 'sap'],
    weather: { kind: 'rain', rain: 0.7, wet: 3, fixed: true },
    cells: WATER,
    goals: { sap: { x: 35, y: 21 }, drain: true },
    a: { groups: [
      { type: 'rifles', pos: { x: 29, y: 19 }, morale: 70, officer: { ...VELL, protect: true } },
      { type: 'pioneers', pos: { x: 29, y: 21 }, morale: 68, leader: FEDDERS },
      { type: 'rifles', pos: { x: 28, y: 30 }, morale: 60 },
      { type: 'mg', pos: { x: 30, y: 13 }, morale: 64 },
      { type: 'rifles', pos: { x: 24, y: 31 }, morale: 58 },
      { type: 'observers', pos: { x: 24, y: 17 }, morale: 66 },
      { type: 'medics', pos: { x: 24, y: 24 }, morale: 70 },
    ] },
    b: { groups: [
      { type: 'rifles', pos: { x: 41, y: 8 } },
      { type: 'mg', pos: { x: 40, y: 20 } },
      { type: 'rifles', pos: { x: 41, y: 30 } },
      { type: 'snipers', pos: { x: 40, y: 15 } },
    ] },
  });
  const m2 = (frueh) => base(frueh ? 'akt2-m2-frueh' : 'akt2-m2', 'Unter Hügel 214', {
    features: ['officers', 'sap', 'tunnel'],
    startHour: 18,
    weather: { kind: 'overcast', wet: 2 },
    cells: SAP_CELLS,
    goals: {},
    a: {
      groups: [
        { type: 'rifles', pos: { x: 29, y: 19 }, morale: 68, officer: { ...VELL, protect: true } },
        { type: 'listeners', pos: { x: 35, y: 21 }, morale: 66, leader: ALBERS },
        frueh ? { type: 'rifles', pos: { x: 34, y: 21 }, morale: 60 } : { type: 'pioneers', pos: { x: 34, y: 21 }, morale: 70, leader: FEDDERS },
        { type: 'rifles', pos: { x: 29, y: 24 }, morale: 64 },
        { type: 'mg', pos: { x: 30, y: 15 }, morale: 64 },
        { type: 'listeners', pos: { x: 30, y: 12 }, morale: 62 },
      ],
      ...(frueh ? { tunnels: [{ group: 'a03', path: [{ x: 35, y: 22 }, { x: 36, y: 22 }, { x: 37, y: 22 }, { x: 38, y: 22 }], dug: 2 }] } : {}),
    },
    b: {
      groups: [
        { type: 'rifles', pos: { x: 40, y: 22 } },
        { type: 'mg', pos: { x: 40, y: 18 } },
        { type: 'rifles', pos: { x: 41, y: 9 } },
        { type: 'rifles', pos: { x: 41, y: 30 } },
      ],
      tunnels: [{ group: 'b01', path: [39, 38, 37, 36, 35, 34].map((x) => ({ x, y: 22 })), dug: frueh ? 1 : 2 }],
    },
  });
  out['akt2-m2'] = m2(false);
  out['akt2-m2-frueh'] = m2(true);
  out['akt2-m3'] = base('akt2-m3', 'Leuchtkugeln', {
    features: ['officers', 'raid'],
    startHour: 18,
    weather: { kind: 'rain', rain: 0.5, wet: 2 },
    cells: SAP_CELLS,
    a: { groups: [
      { type: 'rifles', pos: { x: 29, y: 8 }, morale: 62 },
      { type: 'rifles', pos: { x: 30, y: 14 }, morale: 60, officer: { ...VELL, protect: true } },
      { type: 'mg', pos: { x: 29, y: 20 }, morale: 64 },
      { type: 'listeners', pos: { x: 35, y: 21 }, morale: 60, leader: ALBERS },
      { type: 'rifles', pos: { x: 29, y: 26 }, morale: 58 },
      { type: 'rifles', pos: { x: 28, y: 32 }, morale: 58 },
    ] },
    b: { groups: [
      { type: 'stormtroops', pos: { x: 41, y: 12 } },
      { type: 'stormtroops', pos: { x: 40, y: 22 } },
      { type: 'rifles', pos: { x: 41, y: 30 } },
      { type: 'mg', pos: { x: 40, y: 18 } },
    ] },
  });
  out['akt2-m4'] = base('akt2-m4', 'Stoßtrupp', {
    features: ['officers', 'raid'],
    startHour: 18,
    weather: { kind: 'overcast', wet: 2 },
    cells: SAP_CELLS,
    goals: { raid: true },
    a: { groups: [
      { type: 'stormtroops', pos: { x: 34, y: 21 }, morale: 74, experience: 2, officer: { ...VELL, protect: true } },
      { type: 'rifles', pos: { x: 29, y: 19 }, morale: 64 },
      { type: 'mg', pos: { x: 30, y: 13 }, morale: 64 },
      { type: 'listeners', pos: { x: 35, y: 21 }, morale: 62, leader: ALBERS },
      { type: 'rifles', pos: { x: 29, y: 26 }, morale: 62 },
    ] },
    b: { groups: [
      { type: 'rifles', pos: { x: 40, y: 20 } },
      { type: 'rifles', pos: { x: 41, y: 10 } },
      { type: 'mg', pos: { x: 40, y: 15 } },
      { type: 'rifles', pos: { x: 41, y: 28 } },
    ] },
  });
  out['akt2-m5-angriff'] = base('akt2-m5-angriff', 'Morgennebel', {
    features: ['officers', 'sap', 'raid'],
    startHour: 6,
    weather: { kind: 'fog', fog: 0.9, wet: 2 },
    cells: [...SAP_CELLS, ...GAPS([18, 19, 20, 21])],
    goals: { attack: { x: 40, y: 19 } },
    a: { groups: [
      { type: 'stormtroops', pos: { x: 35, y: 21 }, morale: 76, experience: 2, officer: { ...VELL } },
      { type: 'rifles', pos: { x: 34, y: 21 }, morale: 70 },
      { type: 'rifles', pos: { x: 33, y: 21 }, morale: 68 },
      { type: 'pioneers', pos: { x: 32, y: 21 }, morale: 68, leader: FEDDERS },
      { type: 'mg', pos: { x: 30, y: 18 }, morale: 66 },
      { type: 'medics', pos: { x: 30, y: 21 }, morale: 70 },
      { type: 'observers', pos: { x: 29, y: 16 }, morale: 66 },
    ] },
    b: { groups: [
      { type: 'rifles', pos: { x: 40, y: 19 }, strength: 7, morale: 55, fatigue: 40 },
      { type: 'mg', pos: { x: 40, y: 24 }, strength: 5, morale: 55, fatigue: 40 },
      { type: 'rifles', pos: { x: 45, y: 17 } },
      { type: 'rifles', pos: { x: 45, y: 23 } },
    ] },
  });
  out['akt2-m5'] = base('akt2-m5', 'Morgennebel', {
    features: ['officers', 'sap', 'raid'],
    startHour: 6,
    weather: { kind: 'fog', fog: 0.8, wet: 2 },
    cells: [...SAP_CELLS.slice(0, 3), ...SAP_CELLS.slice(3).map((c) => ({ ...c, trench: { ...c.trench, side: 'enemy', captured: true } }))],
    goals: { attack: { x: 35, y: 21 } },
    a: { groups: [
      { type: 'rifles', pos: { x: 30, y: 21 }, morale: 70, officer: { ...VELL, protect: true } },
      { type: 'rifles', pos: { x: 29, y: 19 }, morale: 66 },
      { type: 'pioneers', pos: { x: 29, y: 23 }, morale: 66, leader: FEDDERS },
      { type: 'mg', pos: { x: 30, y: 17 }, morale: 64 },
      { type: 'medics', pos: { x: 28, y: 21 }, morale: 70 },
      { type: 'stormtroops', pos: { x: 29, y: 22 }, morale: 72, experience: 2 },
    ] },
    b: { groups: [
      { type: 'stormtroops', pos: { x: 35, y: 21 }, strength: 6, morale: 60 },
      { type: 'rifles', pos: { x: 40, y: 20 } },
      { type: 'mg', pos: { x: 40, y: 23 } },
      { type: 'rifles', pos: { x: 41, y: 27 } },
    ] },
  });
  const m6 = (frueh) => base(frueh ? 'akt2-m6-frueh' : 'akt2-m6', 'Der Trichter', {
    features: ['officers', 'sap', 'tunnel'],
    startHour: 6,
    weather: { kind: 'overcast', wet: 2 },
    cells: frueh ? [...SAP_CELLS, ...GAPS([17, 18, 19])] : [...SAP_CELLS, ...CRATER, ...GAPS([17, 18, 19])],
    goals: { attack: { ...CRATER_CENTER }, crater: CRATER.map((c) => ({ x: c.x, y: c.y })) },
    a: {
      groups: [
        { type: 'rifles', pos: { x: 34, y: 21 }, morale: 70, officer: { ...VELL, protect: true } },
        { type: 'rifles', pos: { x: 33, y: 21 }, morale: 68 },
        { type: 'pioneers', pos: { x: 35, y: 21 }, morale: 70, leader: FEDDERS },
        { type: 'mg', pos: { x: 30, y: 18 }, morale: 66 },
        { type: 'stormtroops', pos: { x: 32, y: 21 }, morale: 72, experience: 2 },
        { type: 'observers', pos: { x: 29, y: 16 }, morale: 66 },
        { type: 'medics', pos: { x: 30, y: 21 }, morale: 70 },
      ],
      ...(frueh ? { tunnels: [{ group: 'a03', path: lineCells(36, 21, 40, 18).map(([x, y]) => ({ x, y })), dug: 5, status: 'charged' }] } : {}),
    },
    b: { groups: [
      // Die Grabenbesatzung neben dem Trichter ist von der Sprengung erschuettert
      { type: 'rifles', pos: { x: 41, y: 14 }, strength: 7, morale: 50, fatigue: 30 },
      { type: 'rifles', pos: { x: 41, y: 23 }, strength: 7, morale: 50, fatigue: 30 },
      // Das MG der Kuppe ist bei der Sprengung verschuettet, ein Ersatz steht weiter hinten am Hang
      { type: 'mg', pos: { x: 46, y: 22 }, strength: 4 },
      { type: 'rifles', pos: { x: 46, y: 20 }, strength: 8 },
      { type: 'stormtroops', pos: { x: 45, y: 14 } },
    ] },
  });
  out['akt2-m6'] = m6(false);
  out['akt2-m6-frueh'] = m6(true);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, s] of Object.entries(buildAkt2())) {
    writeFileSync(new URL(`../../data/scenarios/${id}.json`, import.meta.url), JSON.stringify(s, null, 2) + '\n');
    console.log(`data/scenarios/${id}.json`);
  }
}
