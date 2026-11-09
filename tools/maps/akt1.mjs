#!/usr/bin/env node
// Karten der sechs Missionen von Akt 1 (P16): derselbe Abschnitt Asse-Nord bei Velde, sechsmal in einem anderen
// Zustand. Grundlage ist buildMap (js/mapgen.js) mit einer festen Beschreibung; jede Mission nimmt weg oder fuegt
// hinzu, was in diesem Moment des Sommers da ist (Mission 1: noch kein Graben, Mission 3: die Feldbahn, Mission 4:
// die Batterien und der Kirchturm, Mission 5: die vollgelaufene Lehmkuhle, Mission 6: alles, ausgebaut).
//
//   node tools/maps/akt1.mjs          schreibt data/maps/akt1-m1.json bis akt1-m6.json
//
// Ein Test (test/akt1.test.js) prueft, dass die Dateien einem neuen Lauf entsprechen.
import { pathToFileURL } from 'node:url';
import { buildMap } from '../../js/mapgen.js';
import { loadMap } from '../../js/map.js';
import { writeMapJson } from './write.mjs';

export const W = 60;
export const H = 40;
export const ETAPPE = 14;
export const STELLUNG = 10;
/** Feuerlinie von Kaldern (Spalte), dieselbe wie in buildMap: etappe + stellung - 2 */
export const FRONT_X = ETAPPE + STELLUNG - 2;

/** Orte des Abschnitts (Felder), auf die sich Missionen, Hinweise und Ziele beziehen */
export const PLACES = {
  muehle: { x: 21, y: 9 },
  kraehenholz: { x: 21, y: 31 },
  hofKlaas: { x: 22, y: 16 },
  weide: { x: 30, y: 20 },
  lehmkuhle: { x: 23, y: 25 },
  heuwagen: { x: 31, y: 13 },
};

const BASE = {
  id: 'akt1', name: 'Asse-Nord bei Velde', seed: 1916, width: W, height: H, symmetry: 'spiegel',
  title: 'Lagekarte Asse-Nord', blatt: 'Blatt 3',
  etappe: ETAPPE, stellung: STELLUNG, wobble: 1, river: true,
  riverName: 'Asse', riverOther: 'Asava',
  hills: [
    { cx: 9, cy: 31, rx: 5, ry: 4, peak: 1.5, named: true, names: { kaldern: 'Ostkopp', morrow: 'Rukvakalns' } },
    { cx: 19, cy: 8, rx: 3, ry: 2.4, peak: 0.9 },
  ],
  dips: [],
  swamps: [],
  woods: [
    { cx: 21, cy: 32, rx: 2.8, ry: 3, rough: 0.3, names: { kaldern: 'Krähenholz', morrow: 'Varna-Wald' } },
    { cx: 4, cy: 4, rx: 3.5, ry: 2.4, named: false },
  ],
  villages: [
    { cx: 7, cy: 12, rx: 2.6, ry: 2.2, names: { kaldern: 'Ostervenn', morrow: 'Raudas' } },
    { cx: 18, cy: 9, rx: 2, ry: 1.6, names: { kaldern: 'Velde', morrow: 'Sarvele' } },
  ],
  bulges: [{ y0: 14, y1: 18, dx: 1 }],
  strong: [-1, -1],
  wireGaps: [20],
  comm: [9, 20, 31],
  craters: 0.12,
};

/** Tiefe Senke vor der Linie: die Lehmkuhle (Mission 5 laeuft sie voll, vorher ist sie nur eine Mulde) */
const KUHLE = { cx: 24.5, cy: 25.5, rx: 3.4, ry: 2.4, depth: 1.4 };

const key = (x, y) => x + ',' + y;
const half = W / 2;
const west = (x) => x < half;

/** Kirchturm von Ostervenn: der Beobachtungsturm steht am Dorfrand, nicht auf dem Ostkopp (beide Seiten gespiegelt) */
export const TURM = { x: 8, y: 13 };

function base(extra = {}) {
  const m = buildMap({ ...BASE, ...extra });
  m.buildings = m.buildings.map((b) => {
    if (b.id === 'turm') return { ...b, ...TURM, label: 'Kirchturm' };
    if (b.id === 'm-turm') return { ...b, x: W - TURM.x - b.w, y: TURM.y, label: 'Kirchturm' };
    return b;
  });
  return m;
}

/** Gemeinsame Beschriftungen des Abschnitts (Orte aus den Texten von Akt 1) */
function placeLabels(map, { kuhle = true } = {}) {
  const labels = map.labels.filter((l) => !/^Abschnitt /.test(l.text));
  labels.push({ text: 'Mühle', x: PLACES.muehle.x + 0.5, y: PLACES.muehle.y - 1.1, size: 0.5, font: 'head' });
  labels.push({ text: 'Hof Klaas', x: PLACES.hofKlaas.x - 2.2, y: PLACES.hofKlaas.y + 0.5, size: 0.45, font: 'head', rotate: -90 });
  labels.push({ text: 'die Weide', x: PLACES.weide.x, y: PLACES.weide.y - 3.5, size: 0.55, font: 'hand', color: 'pencil', alpha: 0.85 });
  if (kuhle) labels.push({ text: 'Lehmkuhle', x: KUHLE.cx + 0.5, y: KUHLE.cy + 3, size: 0.45, font: 'head', color: 'contour' });
  return labels;
}

/** Alles Eigene vor der Etappe entfernen (Graeben, Draht), nur Schuetzenloecher an der kuenftigen Linie bleiben */
function stripOwnLine(map) {
  const holes = [];
  for (let y = 10; y <= 30; y += 4) holes.push({ x: FRONT_X, y, side: 'own', kind: 'fire', level: 1, facing: 'E' });
  return {
    ...map,
    trenches: [...map.trenches.filter((t) => t.side !== 'own'), ...holes].sort((a, b) => a.y - b.y || a.x - b.x),
    wire: map.wire.filter((w) => w.side !== 'own'),
  };
}

/** Graeben der Gegenseite auf eine Stufe kappen (am Anfang des Sommers graebt Morrow auch erst) */
function capEnemy(map, level) {
  return { ...map, trenches: map.trenches.map((t) => (t.side === 'enemy' ? { ...t, level: Math.min(t.level, level) } : t)) };
}

/** Eigene Graeben einer Reihe von Feldern auf eine Stufe heben */
function raiseOwn(map, level, test = () => true) {
  return { ...map, trenches: map.trenches.map((t) => (t.side === 'own' && test(t) ? { ...t, level: Math.max(t.level, level) } : t)) };
}

/** Gebaeude nach Typ weglassen (Batterien gibt es erst ab Mission 4, die Feldbahn erst ab Mission 3) */
function without(map, types) {
  const drop = new Set(types);
  return {
    ...map,
    buildings: map.buildings.filter((b) => !drop.has(b.type)),
    cables: map.cables.filter((c) => !(drop.has('batterie') && /^batterie/.test(c.to))),
  };
}

function noRails(map) {
  return { ...map, rails: [] };
}

function finish(map, id, name, extra = {}) {
  const out = { ...map, id, name, ...extra };
  out.trenches = [...out.trenches].sort((a, b) => a.y - b.y || a.x - b.x);
  out.wire = [...out.wire].sort((a, b) => a.y - b.y || a.x - b.x);
  out.craters = [...out.craters].sort((a, b) => a.y - b.y || a.x - b.x);
  loadMap(out);
  return out;
}

/** Mission 1: Der erste Spatenstich. Fast leeres Blatt, nur Schuetzenloecher, Morrow graebt gerade erst. */
export function buildM1() {
  let m = base();
  m = stripOwnLine(m);
  m = capEnemy(m, 1);
  // Noch keine Etappe: kein Depot, kein Bahnhof, getragen wird von Hand (Versorgung ohne Netz, js/supply.js)
  m = without(m, ['batterie', 'lazarett', 'werkstatt', 'ruhelager', 'kueche', 'depot', 'bahnhof']);
  m = noRails(m);
  m = { ...m, craters: m.craters.filter((c) => !west(c.x) || c.x > FRONT_X + 1).filter((_, i) => i % 3 === 0) };
  return finish(m, 'akt1-m1', 'Asse-Nord, Tag 1', {
    sheet: { ...m.sheet, title: 'Lagekarte Asse-Nord (unvollständig)', blatt: 'Blatt 3, erste Fassung' },
    labels: placeLabels(m, { kuhle: false }),
    notes: [
      { text: 'bis zum Wald', x: 23.6, y: 13.8, to: [22.6, 12.4], rotate: -4 },
      { text: '„nur Löcher“', x: 23.6, y: 27.6, to: [22.6, 26.4], rotate: 2 },
    ],
    cables: [],
  });
}

/** Mission 2: Die Weide. Die Linie steht, Draht davor, das MG in der Muehle. Morrow tastet und greift an. */
export function buildM2() {
  let m = base();
  m = capEnemy(m, 2);
  m = without(m, ['batterie', 'werkstatt', 'depot', 'bahnhof']);
  m = noRails(m);
  return finish(m, 'akt1-m2', 'Asse-Nord, die Weide', {
    sheet: { ...m.sheet, blatt: 'Blatt 3, Tag 5' },
    labels: placeLabels(m, { kuhle: false }),
    notes: [
      { text: 'MG Lohmann: Kegel über die Weide', x: 14.5, y: 6.2, to: [20.5, 9.4], rotate: -3 },
      { text: 'Gasse im Draht', x: 27.5, y: 18, to: [24.4, 20.6], rotate: 3 },
    ],
    cables: m.cables.filter((c) => !/^batterie/.test(c.to)),
  });
}

/** Mission 3: Zwoelf Loren. Die Feldbahn ist fertig, das Depot voll, vorn fehlt alles. */
export function buildM3() {
  let m = base();
  m = capEnemy(m, 2);
  m = without(m, ['batterie']);
  return finish(m, 'akt1-m3', 'Asse-Nord, Feldbahn', {
    sheet: { ...m.sheet, blatt: 'Blatt 3, Tag 9' },
    labels: placeLabels(m),
    notes: [
      { text: 'zwölf Loren je Runde, nicht mehr', x: 10.5, y: 23.6, to: [12, 20.5], rotate: -2 },
      { text: 'Rückweg = Verwundete!', x: 15, y: 27.5, to: [14, 24.4], rotate: 3 },
    ],
    cables: m.cables.filter((c) => !/^batterie/.test(c.to)),
  });
}

/** Mission 4: Der Turm von Ostervenn. Zwei Batterien, der Kirchturm, ein MG-Nest vor dem Heuwagen. */
export function buildM4() {
  let m = base({ craters: 0.2 });
  m = capEnemy(m, 3);
  const turm = m.buildings.find((b) => b.id === 'turm');
  // MG-Nest vor dem Heuwagen: ein Stueck Feuergraben vor Morrows Draht, mit Laufgraben zurueck
  const nest = [
    { x: PLACES.heuwagen.x, y: PLACES.heuwagen.y + 1, side: 'enemy', kind: 'fire', level: 2, facing: 'W' },
    { x: PLACES.heuwagen.x + 1, y: PLACES.heuwagen.y + 1, side: 'enemy', kind: 'comm', level: 1, facing: 'W' },
    { x: PLACES.heuwagen.x + 2, y: PLACES.heuwagen.y + 1, side: 'enemy', kind: 'comm', level: 1, facing: 'W' },
  ];
  const nestKeys = new Set(nest.map((t) => key(t.x, t.y)));
  m = {
    ...m,
    trenches: [...m.trenches.filter((t) => !nestKeys.has(key(t.x, t.y))), ...nest],
    wire: m.wire.filter((w) => !nestKeys.has(key(w.x, w.y))),
    craters: m.craters.filter((c) => !nestKeys.has(key(c.x, c.y))),
  };
  const labels = placeLabels(m);
  labels.push({ text: 'Heuwagen', x: PLACES.heuwagen.x + 0.5, y: PLACES.heuwagen.y - 1, size: 0.45, font: 'head', color: 'enemy' });
  return finish(m, 'akt1-m4', 'Asse-Nord, der Turm', {
    sheet: { ...m.sheet, blatt: 'Blatt 3, Tag 14' },
    labels,
    notes: [
      { text: 'MG-Nest? Mündungsfeuer nachts', x: 38, y: 9.5, to: [32, 13.6], rotate: -3 },
      { text: 'Turm sieht über die Weide', x: 9, y: 6, to: [turm ? turm.x + 1 : 8, turm ? turm.y : 10], rotate: -2 },
    ],
  });
}

/** Mission 5: Gewitter. Die Lehmkuhle ist eine tiefe Mulde mit einer vorgeschobenen Stellung darin. */
export function buildM5() {
  let m = base({ dips: [KUHLE], craters: 0.3 });
  m = capEnemy(m, 3);
  // Vorgeschobene Stellung in der Kuhle: ein Feuergraben-Bogen vor der Linie
  const kuhle = [];
  for (let y = 24; y <= 27; y++) kuhle.push({ x: FRONT_X + 2, y, side: 'own', kind: 'fire', level: 2, facing: 'E' });
  kuhle.push({ x: FRONT_X + 1, y: 24, side: 'own', kind: 'comm', level: 2, facing: 'E' });
  const taken = new Set(kuhle.map((t) => key(t.x, t.y)));
  m = {
    ...m,
    trenches: [...m.trenches.filter((t) => !taken.has(key(t.x, t.y))), ...kuhle],
    wire: m.wire.filter((w) => !taken.has(key(w.x, w.y)) && !(w.side === 'own' && w.y >= 23 && w.y <= 28)),
  };
  m = raiseOwn(m, 2);
  // Die Kuhle gehoert zur eigenen Stellung (ablösen geht nur dort)
  m = { ...m, zones: m.zones.map((row, y) => (y >= 23 && y <= 28 ? row.slice(0, FRONT_X + 2) + 'SS' + row.slice(FRONT_X + 4) : row)) };
  return finish(m, 'akt1-m5', 'Asse-Nord, Lehmkuhle', {
    sheet: { ...m.sheet, blatt: 'Blatt 3, Tag 19' },
    labels: placeLabels(m),
    notes: [
      { text: 'Kuhle läuft zuerst voll', x: 30, y: 30.5, to: [25.5, 26.5], rotate: 3 },
      { text: 'Krater halten Wasser', x: 31, y: 7, to: [28, 9.5], rotate: -2 },
    ],
  });
}

/** Mission 6: Die Welle. Alles ausgebaut, Ruhelager voll, drueben drei Regimenter. */
export function buildM6() {
  let m = base({ strong: [8, 32], craters: 0.28 });
  m = raiseOwn(m, 2);
  return finish(m, 'akt1-m6', 'Asse-Nord, die Welle', {
    sheet: { ...m.sheet, blatt: 'Blatt 3, Tag 24' },
    labels: placeLabels(m),
    notes: [
      { text: 'Kellinger ab Tag 28', x: 9.5, y: 2.2, to: [12, 4.5], rotate: -2 },
      { text: 'Reserve ist zum Benutzen da (F.)', x: 13, y: 37.6, to: [11.5, 34.4], rotate: 2 },
    ],
  });
}

export const BUILDERS = { 'akt1-m1': buildM1, 'akt1-m2': buildM2, 'akt1-m3': buildM3, 'akt1-m4': buildM4, 'akt1-m5': buildM5, 'akt1-m6': buildM6 };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, fn] of Object.entries(BUILDERS)) {
    const map = fn();
    writeMapJson(new URL(`../../data/maps/${id}.json`, import.meta.url), map);
    console.log(`data/maps/${id}.json geschrieben:`, map.trenches.length, 'Grabenfelder,', map.wire.length, 'Draht,', map.buildings.length, 'Gebäude');
  }
}
