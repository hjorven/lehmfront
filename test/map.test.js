import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadMap, cellAt, neighbors, lineCells, lineOfSight, findPath, enterCost, cellChains, cellLabel, inBounds, TERRAIN,
} from '../js/map.js';

const asseJson = JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url)));

/** Kleine Testkarte aus Zeilen. */
function tiny(rows, heights, extra = {}) {
  const h = rows.length, w = rows[0].length;
  return loadMap({
    id: 'test', width: w, height: h, terrain: rows,
    heights: heights || rows.map((r) => '0'.repeat(r.length)),
    zones: rows.map((r) => 'N'.repeat(r.length)),
    ...extra,
  });
}

test('Asse-Karte laedt: 60 x 40, Fluss links, Huegel 214 hoch, beide Linien vorhanden', () => {
  const m = loadMap(asseJson);
  assert.equal(m.width, 60);
  assert.equal(m.height, 40);
  assert.equal(m.cells.length, 2400);
  assert.equal(cellAt(m, 0, 20).terrain, 'wasser');
  assert.equal(cellAt(m, 50, 29).height, 3);
  assert.equal(cellAt(m, 5, 20).zone, 'etappe');
  assert.equal(cellAt(m, 5, 20).side, 'own');
  assert.equal(cellAt(m, 39, 20).zone, 'niemandsland');
  assert.equal(cellAt(m, 57, 20).side, 'enemy');
  const own = m.cells.filter((c) => c.trench?.side === 'own');
  const enemy = m.cells.filter((c) => c.trench?.side === 'enemy');
  assert.ok(own.length > 60 && enemy.length > 60);
  assert.ok(own.every((c) => c.trench.facing === 'E'));
  assert.ok(m.cells.some((c) => c.terrain === 'wald') && m.cells.some((c) => c.terrain === 'sumpf') && m.cells.some((c) => c.terrain === 'dorf'));
  assert.ok(m.buildings.find((b) => b.id === 'depot'));
});

test('Asse-Karte: Depot erreicht die vordere Linie, Gegner ist nur durch das Niemandsland erreichbar', () => {
  const m = loadMap(asseJson);
  const p = findPath(m, { x: 6, y: 18 }, { x: 32, y: 20 });
  assert.ok(p, 'Weg zur Front fehlt');
  assert.deepEqual(p.path[0], { x: 6, y: 18 });
  assert.deepEqual(p.path[p.path.length - 1], { x: 32, y: 20 });
  const q = findPath(m, { x: 32, y: 20 }, { x: 45, y: 20 });
  assert.ok(q && q.path.some((c) => cellAt(m, c.x, c.y).zone === 'niemandsland'));
});

test('Generator ist reproduzierbar: data/maps/asse.json entspricht einem neuen Lauf', async () => {
  const { buildAsse } = await import('../tools/maps/asse.mjs');
  assert.deepEqual(JSON.parse(JSON.stringify(buildAsse())), asseJson);
});

test('loadMap meldet Fehler auf Deutsch', () => {
  assert.throws(() => tiny(['..', '.x']), /unbekannter Boden/);
  assert.throws(() => tiny(['..', '..'], ['00', '04']), /Höhe/);
  assert.throws(() => tiny(['..', '..'], null, { trenches: [{ x: 5, y: 0, side: 'own', kind: 'fire', level: 2, facing: 'E' }] }), /ausserhalb/);
  assert.throws(() => tiny(['..', '..'], null, { trenches: [{ x: 0, y: 0, side: 'own', kind: 'fire', level: 2, facing: 'Q' }] }), /Feuerrichtung/);
  assert.throws(() => loadMap({ width: 2, height: 2, terrain: ['..'], heights: ['00', '00'], zones: ['NN', 'NN'] }), /Zeilen/);
});

test('Nachbarn in fester Reihenfolge, am Rand weniger', () => {
  const m = tiny(['...', '...', '...']);
  assert.deepEqual(neighbors(m, 1, 1).map((c) => [c.x, c.y]), [[1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]]);
  assert.equal(neighbors(m, 0, 0).length, 3);
  assert.equal(neighbors(m, 1, 1, { diagonal: false }).length, 4);
  assert.equal(inBounds(m, 3, 0), false);
  assert.equal(cellAt(m, -1, 0), null);
});

test('Bresenham enthaelt beide Endpunkte und ist symmetrisch in der Laenge', () => {
  const a = lineCells(0, 0, 5, 2);
  assert.deepEqual(a[0], [0, 0]);
  assert.deepEqual(a[a.length - 1], [5, 2]);
  assert.equal(a.length, 6);
  assert.equal(lineCells(5, 2, 0, 0).length, a.length);
  assert.deepEqual(lineCells(3, 3, 3, 3), [[3, 3]]);
});

test('Sichtlinie: Huegel dazwischen verdeckt, von oben sieht man darueber', () => {
  const m = tiny(['.....'], ['00200']);
  const low = lineOfSight(m, { x: 0, y: 0 }, { x: 4, y: 0 });
  assert.equal(low.visible, false);
  assert.deepEqual(low.blockedAt, { x: 2, y: 0 });
  const m2 = tiny(['.....'], ['30100']);
  assert.equal(lineOfSight(m2, { x: 0, y: 0 }, { x: 4, y: 0 }).visible, true);
});

test('Sichtlinie: Wald und Dorf blockieren auf gleicher Hoehe, Nachbarn sehen sich immer', () => {
  const m = tiny(['..w..']);
  assert.equal(lineOfSight(m, { x: 0, y: 0 }, { x: 4, y: 0 }).visible, false);
  assert.equal(lineOfSight(m, { x: 1, y: 0 }, { x: 2, y: 0 }).visible, true);
  const m2 = tiny(['..d..'], ['20002']);
  assert.equal(lineOfSight(m2, { x: 0, y: 0 }, { x: 4, y: 0 }).visible, true, 'von Hoehe 2 ueber das Dorf');
});

test('A*: findet kuerzesten Weg, umgeht Wasser, schneidet keine Ecken', () => {
  const m = tiny([
    '.....',
    '.~~~.',
    '.....',
  ]);
  const p = findPath(m, { x: 0, y: 1 }, { x: 4, y: 1 });
  assert.ok(p);
  for (const c of p.path) assert.notEqual(cellAt(m, c.x, c.y).terrain, 'wasser');
  // Diagonale an Wasser vorbei waere Eckenschneiden
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1], b = p.path[i];
    if (a.x !== b.x && a.y !== b.y) {
      assert.notEqual(cellAt(m, b.x, a.y).terrain, 'wasser');
      assert.notEqual(cellAt(m, a.x, b.y).terrain, 'wasser');
    }
  }
  assert.equal(findPath(m, { x: 0, y: 0 }, { x: 2, y: 1 }), null, 'Ziel im Wasser');
});

test('A*: Kosten stimmen mit dem Weg ueberein und Sumpf wird umgangen, wenn es billiger ist', () => {
  const m = tiny([
    '.....',
    '.sss.',
    '.....',
  ]);
  const p = findPath(m, { x: 0, y: 1 }, { x: 4, y: 1 });
  let sum = 0;
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1], b = p.path[i];
    const c = enterCost(cellAt(m, b.x, b.y));
    sum += a.x !== b.x && a.y !== b.y ? Math.floor((c * 14) / 10) : c;
  }
  assert.equal(p.cost, sum);
  assert.ok(p.path.every((c) => cellAt(m, c.x, c.y).terrain !== 'sumpf'));
});

test('A* ist deterministisch bei gleich teuren Wegen', () => {
  const m = tiny(['......', '......', '......', '......']);
  const a = findPath(m, { x: 0, y: 0 }, { x: 5, y: 3 });
  const b = findPath(m, { x: 0, y: 0 }, { x: 5, y: 3 });
  assert.deepEqual(a, b);
});

test('Graben ist billiger als offenes Feld, Draht teurer', () => {
  const m = tiny(['...'], null, { trenches: [{ x: 0, y: 0, side: 'own', kind: 'comm', level: 2, facing: 'E' }], wire: [{ x: 2, y: 0, side: 'own' }] });
  assert.ok(enterCost(cellAt(m, 0, 0)) < enterCost(cellAt(m, 1, 0)));
  assert.ok(enterCost(cellAt(m, 2, 0)) > enterCost(cellAt(m, 1, 0)));
  assert.equal(enterCost({ ...cellAt(m, 1, 0), terrain: 'wasser' }), Infinity);
  assert.equal(TERRAIN.fels.dig < TERRAIN.lehm.dig, true);
});

test('cellChains: L-Form ist ein Zug, T-Kreuzung bricht in drei', () => {
  const L = tiny(['#..', '#..', '###'].map((r) => r.replace(/#/g, '.')), null, {
    trenches: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]].map(([x, y]) => ({ x, y, side: 'own', kind: 'fire', level: 2, facing: 'E' })),
  });
  const ch = cellChains(L, (c) => !!c.trench);
  assert.equal(ch.length, 1);
  assert.equal(ch[0].cells.length, 5);

  const T = tiny(['...', '...', '...'], null, {
    trenches: [[0, 1], [1, 1], [2, 1], [1, 0]].map(([x, y]) => ({ x, y, side: 'own', kind: 'fire', level: 2, facing: 'E' })),
  });
  assert.equal(cellChains(T, (c) => !!c.trench).length, 3);
});

test('cellChains: Diagonale ohne Dreiecke, Stilwechsel trennt', () => {
  const m = tiny(['...', '...', '...'], null, {
    trenches: [
      { x: 0, y: 0, side: 'own', kind: 'fire', level: 2, facing: 'E' },
      { x: 1, y: 1, side: 'own', kind: 'fire', level: 2, facing: 'E' },
      { x: 2, y: 2, side: 'own', kind: 'comm', level: 2, facing: 'E' },
    ],
  });
  const all = cellChains(m, (c) => !!c.trench);
  assert.equal(all.length, 1);
  assert.equal(all[0].cells.length, 3);
  const styled = cellChains(m, (c) => !!c.trench, (a, b) => (a.trench.kind === 'comm' || b.trench.kind === 'comm' ? 'comm' : 'fire'));
  assert.equal(styled.length, 2);
});

test('Feldbezeichnung ist 1-basiert wie am Kartenrand', () => {
  assert.equal(cellLabel(30, 8), '31/9');
});
