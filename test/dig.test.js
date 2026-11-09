// P04: Graben zeichnen, ausheben, Stufen, Feuerrichtung, Laengsfeuer, Umbauen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, applyCellState, cellAt } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { isValidEvent } from '../js/events.js';
import { validateOrder } from '../js/orders.js';
import {
  LEVELS, cellsFromPoints, isContiguous, straightRuns, longestRun, enfiladeRuns, insertTraverses, defaultFacings,
  captureTrench, trenchCover, enfiladeOf, cellCost, levelForWork, ENFILADE_RUN, TRAVERSE_RUN,
} from '../js/trench.js';
import { digRate, digEstimate, registerDigFactor, unregisterDigFactor, getDigFactor } from '../js/phases/dig.js';
import { rebuildEstimate } from '../js/phases/rebuild.js';
import { coverValue } from '../js/rules.js';

// 16 x 12: Etappe 0-3, Stellung 4-8, Niemandsland 9-10, Gegner 11-15. Spalte 6 ab Zeile 8 Fels, 2/2 Wasser.
const W = 16, H = 12;
function testMap() {
  const terrain = [], heights = [], zones = [];
  for (let y = 0; y < H; y++) {
    let t = '', z = '';
    for (let x = 0; x < W; x++) {
      t += x === 2 && y === 2 ? '~' : y >= 8 && x === 6 ? 'f' : '.';
      z += x < 4 ? 'E' : x < 9 ? 'S' : x < 11 ? 'N' : x < 14 ? 's' : 'e';
    }
    terrain.push(t); heights.push('0'.repeat(W)); zones.push(z);
  }
  return loadMap({
    id: 'probe', width: W, height: H, terrain, heights, zones,
    trenches: [
      { x: 12, y: 1, side: 'enemy', kind: 'fire', level: 2, facing: 'W' },
      { x: 12, y: 2, side: 'enemy', kind: 'fire', level: 2, facing: 'W' },
      { x: 12, y: 3, side: 'enemy', kind: 'fire', level: 2, facing: 'W' },
    ],
  });
}
const MAP = testMap();
const scenario = (groups, b = [{ type: 'rifles', pos: { x: 13, y: 10 } }], extra = {}) => ({
  id: 'probe', startHour: 6, turnKind: 'position', weather: { kind: 'clear' },
  sides: {
    a: { faction: 'morrow', trust: 50, groups, ...extra },
    b: { faction: 'morrow', trust: 50, groups: b },
  },
});
const line = (x, y0, y1) => { const out = []; for (let y = y0; y <= y1; y++) out.push({ x, y }); return out; };
const fullRifles = (pos) => ({ type: 'rifles', pos, strength: 10, fatigue: 0 });

// -------------------------------------------------------------- Zerlegen

test('Zerlegen: gezeichnete Linie wird lückenlos in Felder zerlegt', () => {
  const cells = cellsFromPoints([{ x: 5.2, y: 1.5 }, { x: 5.6, y: 1.9 }, { x: 5.5, y: 6.4 }, { x: 8.1, y: 8.8 }]);
  assert.deepEqual(cells[0], { x: 5, y: 1 });
  assert.deepEqual(cells[cells.length - 1], { x: 8, y: 8 });
  assert.ok(isContiguous(cells));
  assert.equal(cells.filter((c) => c.x === 5).length, 6);
});

test('Zerlegen: Zurückzeichnen radiert die Linie bis dorthin', () => {
  const cells = cellsFromPoints([{ x: 5.5, y: 1.5 }, { x: 5.5, y: 6.5 }, { x: 5.5, y: 3.5 }]);
  assert.deepEqual(cells, line(5, 1, 3));
});

test('Zerlegen: ein Antippen ergibt ein Feld', () => {
  assert.deepEqual(cellsFromPoints([{ x: 7.3, y: 4.9 }]), [{ x: 7, y: 4 }]);
  assert.deepEqual(cellsFromPoints([]), []);
});

// -------------------------------------------------------------- Laengsfeuer

test('Längsfeuer: gerade Abschnitte werden erkannt, Ecken gehören zu beiden', () => {
  const cells = [...line(5, 0, 5), { x: 6, y: 5 }, { x: 7, y: 5 }];
  const runs = straightRuns(cells);
  assert.deepEqual(runs.map((r) => r.length), [6, 3]);
  assert.equal(longestRun(cells), 6);
  assert.equal(enfiladeRuns(cells).length, 1);
  assert.equal(enfiladeRuns(line(5, 0, ENFILADE_RUN - 2)).length, 0);
  assert.equal(enfiladeRuns(line(5, 0, 9), 'comm').length, 0, 'Laufgräben warnen nicht');
});

test('Traversen: keine Gerade länger als drei, Anfang und Ende bleiben, Linie bleibt lückenlos', () => {
  const ok = (x, y) => x >= 4 && x <= 8 && y >= 0 && y < H;
  for (const cells of [line(6, 0, 9), cellsFromPoints([{ x: 4.5, y: 0.5 }, { x: 8.5, y: 4.5 }]), [...line(6, 0, 6), { x: 7, y: 6 }, { x: 8, y: 6 }]]) {
    const t = insertTraverses(cells, { ok, rear: { dx: -1, dy: 0 } });
    assert.ok(isContiguous(t), 'lückenlos');
    assert.ok(longestRun(t) <= TRAVERSE_RUN, `längste Gerade ${longestRun(t)}`);
    assert.deepEqual(t[0], cells[0]);
    assert.deepEqual(t[t.length - 1], cells[cells.length - 1]);
    assert.ok(t.every((c) => ok(c.x, c.y)));
  }
});

test('Traversen: 300 zufällige Linien, immer lückenlos und höchstens drei gerade', async () => {
  const { createRng } = await import('../js/rng.js');
  const r = createRng(5);
  for (let k = 0; k < 300; k++) {
    const pts = [];
    let x = 20, y = 20;
    for (let i = 0; i < 4; i++) { x += Math.floor(r() * 16) - 8; y += Math.floor(r() * 16) - 8; pts.push({ x: x + 0.5, y: y + 0.5 }); }
    const c = cellsFromPoints(pts);
    const t = insertTraverses(c);
    assert.ok(isContiguous(t));
    assert.deepEqual([t[0], t[t.length - 1]], [c[0], c[c.length - 1]]);
    assert.ok(longestRun(t) <= TRAVERSE_RUN, JSON.stringify(c));
  }
});

test('Traversen: wo nicht gegraben werden kann, bleibt die Linie', () => {
  const ok = (x) => x === 6;
  assert.deepEqual(insertTraverses(line(6, 0, 9), { ok }), line(6, 0, 9));
});

test('Feuerrichtung: Normale der Linie zum Feind, Sappe zeigt zum Feind', () => {
  assert.deepEqual(defaultFacings(line(6, 0, 2), 'own'), ['E', 'E', 'E']);
  assert.deepEqual(defaultFacings(line(12, 0, 1), 'enemy'), ['W', 'W']);
  assert.deepEqual(defaultFacings([{ x: 4, y: 3 }, { x: 5, y: 3 }], 'own'), ['E', 'E']);
  assert.deepEqual(defaultFacings([{ x: 4, y: 4 }, { x: 5, y: 3 }, { x: 6, y: 2 }], 'own'), ['SE', 'SE', 'SE']);
});

test('Längsfeuer im Gefecht: nur aus der Verlängerung eines geraden Abschnitts', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 5 })]), 1);
  for (const p of line(6, 1, 6)) s.cells[p.x + ',' + p.y] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' } };
  const m = applyCellState(MAP, s.cells);
  assert.ok(enfiladeOf(m, { x: 6, y: 3 }, { x: 6, y: 10 }), 'von Süden längs');
  assert.ok(enfiladeOf(m, { x: 6, y: 3 }, { x: 7, y: 11 }), 'ein Feld daneben zählt');
  assert.equal(enfiladeOf(m, { x: 6, y: 3 }, { x: 12, y: 3 }), null, 'frontal nicht');
  assert.equal(enfiladeOf(m, { x: 6, y: 3 }, { x: 6, y: 4 }), null, 'im Abschnitt selbst nicht');
  assert.equal(enfiladeOf(m, { x: 12, y: 2 }, { x: 12, y: 9 }), null, 'drei Felder reichen nicht');
});

// -------------------------------------------------------------- Grabgeschwindigkeit

test('Grabgeschwindigkeit: Schützen 100, Pioniere doppelt, Boden zählt je Feld', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 1 }), { type: 'pioneers', pos: { x: 5, y: 3 }, strength: 8 }]), 1);
  s.groups[1].size = 8;
  s.groups[0].size = 10;
  assert.equal(digRate(s, s.groups[0], MAP).rate, 100);
  assert.equal(digRate(s, s.groups[1], MAP).rate, 200);
  // Mockup: 10 Felder Schützengraben auf Lehm, 3 Stellungsrunden, Pioniere 2
  const ten = line(5, 0, 9);
  assert.equal(digEstimate(MAP, s, s.groups[0], ten, 2).rounds, 3);
  assert.equal(digEstimate(MAP, s, s.groups[1], ten, 2).rounds, 2);
  // Fels (Faktor 0,3) kostet mehr als dreimal so viel
  assert.equal(cellCost(cellAt(MAP, 6, 9), 2), 84);
  assert.equal(cellCost(cellAt(MAP, 5, 9), 2), 25);
  assert.equal(cellCost(cellAt(MAP, 2, 2), 2), Infinity, 'Wasser');
});

test('Grabgeschwindigkeit: Wetter, Erschöpfung, Vertrauen und Stärke bremsen; Faktoren sind austauschbar', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 1 })]), 1);
  const g = s.groups[0];
  g.size = 10;
  s.weather.kind = 'rain';
  assert.equal(digRate(s, g, MAP).rate, 80);
  g.fatigue = 40;
  assert.equal(digRate(s, g, MAP).rate, 64);
  s.sides.a.trust = 0;
  assert.equal(digRate(s, g, MAP).rate, 51);
  g.strength = 5;
  assert.equal(digRate(s, g, MAP).rate, 38);
  const original = getDigFactor('wetter');
  registerDigFactor('wetter', () => null);
  try {
    assert.equal(digRate(s, g, MAP).rate, 48);
    registerDigFactor('werkzeug', () => ({ pct: 150, label: 'Pionierpark' }));
    assert.equal(digRate(s, g, MAP).rate, 72);
    assert.ok(digRate(s, g, MAP).factors.some((f) => f.label === 'Pionierpark'));
  } finally {
    unregisterDigFactor('werkzeug');
    registerDigFactor('wetter', original);
  }
});

// -------------------------------------------------------------- Ausheben ueber Runden

function play(state, ordersA, turns, carry = true) {
  let s = state, orders = ordersA;
  const logs = [];
  for (let t = 0; t < turns; t++) {
    const r = resolveTurn(s, orders, [], s.seed, s.turn, { map: MAP });
    for (const e of r.log) assert.ok(isValidEvent(e), JSON.stringify(e));
    logs.push(r.log);
    s = r.state;
    orders = carry ? r.log.filter((e) => e.carry).map((e) => e.carry) : orders;
  }
  return { state: s, logs };
}

test('Ausheben: 10 Felder Schützengraben in 3 Runden, Gruppe arbeitet sich entlang', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 0 })]), 7);
  s0.groups[0].size = 10;
  const fixed = [...line(6, 0, 7), { x: 5, y: 8 }, { x: 5, y: 9 }];
  const { state, logs } = play(s0, [{ group: 'a01', type: 'dig', path: fixed, level: 2 }], 3);
  const m = applyCellState(MAP, state.cells);
  for (const p of fixed) assert.equal(cellAt(m, p.x, p.y).trench?.level, 2, `Feld ${p.x}/${p.y}`);
  assert.equal(cellAt(m, 6, 0).trench.facing, 'E');
  assert.equal(cellAt(m, 6, 0).trench.side, 'own');
  const ev1 = logs[0].find((e) => e.type === 'dig');
  assert.equal(ev1.rest.length, 6, 'nach Runde 1 fehlen noch 6 Felder');
  assert.ok(ev1.carry);
  const last = logs[2].find((e) => e.type === 'dig');
  assert.equal(last.rest.length, 0);
  assert.equal(last.carry, null);
  assert.match(last.reason, /fertig/);
  assert.deepEqual(state.groups.find((g) => g.id === 'a01').pos, { x: 5, y: 9 });
});

test('Ausheben: angefangenes Feld wird erst Schützenloch, dann Graben', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 7, y: 9 })]), 7);
  s0.groups[0].size = 10;
  s0.groups[0].strength = 10;
  s0.weather.kind = 'storm'; // 60
  const { state } = play(s0, [{ group: 'a01', type: 'dig', path: [{ x: 6, y: 9 }], level: 2 }], 1);
  // Fels: 60 Budget * 0,3 = 18 Arbeit -> Schuetzenloch (10), noch kein Graben (25)
  assert.equal(state.cells['6,9'].dig.work, 18);
  assert.equal(state.cells['6,9'].trench.level, 1);
  assert.equal(levelForWork(18), 1);
});

test('Ausheben: Ausbau kostet Material, ohne Material bleibt die Stufe darunter', () => {
  const s0 = createInitialState(MAP, scenario([{ type: 'pioneers', pos: { x: 5, y: 0 }, strength: 8 }]), 3);
  s0.groups[0].size = 8;
  s0.sides.a.supplies.material = 2;
  const path = line(6, 0, 3);
  const { state, logs } = play(s0, [{ group: 'a01', type: 'dig', path, level: 3 }], 1);
  const m = applyCellState(MAP, state.cells);
  assert.equal(state.sides.a.supplies.material, 0);
  assert.equal(cellAt(m, 6, 0).trench.level, 3);
  assert.equal(cellAt(m, 6, 1).trench.level, 3);
  assert.equal(cellAt(m, 6, 2).trench.level, 2);
  const e = logs[0].find((x) => x.type === 'dig');
  assert.equal(e.noMaterial, 3);
  assert.equal(e.carry, null, 'ohne Material kein Weitertragen');
  assert.match(e.reason, /Material/);
});

test('Ausheben: Prüfung lehnt Niemandsland, Wasser, Sprünge und zu weite Linien ab', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 7, y: 5 }), { type: 'mg', pos: { x: 3, y: 2 } }]), 1);
  const v = (o) => validateOrder({ group: 'a01', type: 'dig', ...o }, s, 'a', { map: MAP });
  assert.equal(v({ path: line(7, 4, 6) }), null);
  assert.match(v({ path: [{ x: 8, y: 5 }, { x: 9, y: 5 }] }), /Niemandsland/);
  assert.match(v({ path: [{ x: 7, y: 4 }, { x: 7, y: 6 }] }), /springt/);
  assert.match(v({ path: line(7, 9, 11) }), /zu weit/);
  assert.match(validateOrder({ group: 'a02', type: 'dig', path: [{ x: 2, y: 3 }, { x: 2, y: 2 }] }, s, 'a', { map: MAP }), /Wasser/);
  assert.match(v({ path: line(7, 4, 6), level: 5 }), /stufe/i);
  // Morrow hat Beton erst ab Akt 3
  assert.match(v({ path: line(7, 4, 6), level: 4 }), /Beton/);
  s.scenario.act = 3;
  assert.equal(v({ path: line(7, 4, 6), level: 4 }), null);
});

test('Ausheben: frischer Aufwurf verrät den Gegner in Sichtweite, nachts kaum', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 7, y: 5 })], [{ type: 'rifles', pos: { x: 13, y: 5 } }]), 1);
  const order = [{ group: 'a01', type: 'dig', path: line(7, 4, 6) }];
  const day = resolveTurn(s0, order, [], 1, 1, { map: MAP });
  const seen = day.log.filter((e) => e.type === 'spoil_seen');
  assert.ok(seen.length >= 1);
  assert.equal(seen[0].side, 'b');
  assert.match(seen[0].reason, /Lehm/);
  assert.equal(day.state.cells['7,4'].fresh, 1);
  const n0 = structuredClone(s0);
  n0.night = true;
  const night = resolveTurn(n0, order, [], 1, 1, { map: MAP });
  assert.equal(night.log.filter((e) => e.type === 'spoil_seen').length, 0);
});

test('Ausheben: deterministisch und ohne Mutation', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 0 }), { type: 'pioneers', pos: { x: 7, y: 0 } }]), 9);
  const frozen = JSON.stringify(s0);
  const o = [{ group: 'a01', type: 'dig', path: line(6, 0, 5) }, { group: 'a02', type: 'dig', path: line(7, 1, 8), kind: 'comm' }];
  const r1 = resolveTurn(s0, o, [], 9, 1, { map: MAP });
  const r2 = resolveTurn(s0, structuredClone(o), [], 9, 1, { map: MAP });
  assert.deepEqual(r1, r2);
  assert.equal(JSON.stringify(s0), frozen);
  assert.equal(r1.state.cells['7,1'].trench.kind, 'comm');
});

// -------------------------------------------------------------- Erobern und Umbauen

test('Erobern: eroberter Graben gibt halbe Deckung, bis er umgebaut ist', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 11, y: 2 })]), 1);
  assert.ok(captureTrench(s, MAP, 12, 2, 'a'));
  assert.equal(captureTrench(s, MAP, 12, 2, 'a'), false, 'schon eigen');
  assert.equal(captureTrench(s, MAP, 5, 5, 'a'), false, 'kein Graben');
  const m = applyCellState(MAP, s.cells);
  const c = trenchCover(m, 12, 2, 'a');
  assert.deepEqual(c, { cover: 'trench', reversed: true, level: 2 });
  assert.equal(coverValue(c.cover, { reversed: c.reversed }), 0.3);
  assert.equal(trenchCover(m, 12, 1, 'a').cover, 'crater', 'fremder Graben: Deckung wie Krater');
  assert.equal(trenchCover(m, 12, 1, 'b').cover, 'trench');
});

test('Umbauen: eine Stellungsrunde je drei Felder, Pioniere doppelt so schnell', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 11, y: 0 }), { type: 'pioneers', pos: { x: 11, y: 5 }, strength: 8 }], [{ type: 'rifles', pos: { x: 15, y: 11 } }]), 1);
  s0.groups[0].size = 10;
  s0.groups[1].size = 8;
  // Gegnerischer Graben 12/0 bis 12/8, von a erobert
  for (const p of line(12, 0, 8)) {
    s0.cells[p.x + ',' + p.y] = { trench: { side: 'enemy', kind: 'fire', level: 2, facing: 'W' } };
    captureTrench(s0, MAP, p.x, p.y, 'a');
  }
  const six = line(12, 0, 5);
  assert.equal(rebuildEstimate(MAP, s0, s0.groups[0], six).rounds, 2);
  assert.equal(rebuildEstimate(MAP, s0, s0.groups[1], six).rounds, 1);
  // Validierung braucht env.map; dafuer liegt der Graben in state.cells
  const r1 = resolveTurn(s0, [{ group: 'a01', type: 'rebuild', path: six }], [], 1, 1, { map: MAP });
  const e = r1.log.find((x) => x.type === 'rebuild');
  assert.equal(e.cells, 3);
  assert.equal(e.rest.length, 3);
  let m = applyCellState(MAP, r1.state.cells);
  assert.equal(cellAt(m, 12, 0).trench.facing, 'E');
  assert.equal(cellAt(m, 12, 0).trench.captured, undefined);
  assert.deepEqual(trenchCover(m, 12, 0, 'a'), { cover: 'trench', reversed: false, level: 2 });
  assert.equal(trenchCover(m, 12, 3, 'a').reversed, true);
  const r2 = resolveTurn(r1.state, [e.carry], [], 1, 2, { map: MAP });
  m = applyCellState(MAP, r2.state.cells);
  for (const p of six) assert.equal(cellAt(m, p.x, p.y).trench.captured, undefined);
  assert.equal(cellAt(m, 12, 6).trench.captured, true);
  // Pioniere schaffen sechs in einer Runde
  const r3 = resolveTurn(s0, [{ group: 'a02', type: 'rebuild', path: line(12, 3, 8) }], [], 1, 1, { map: MAP });
  assert.equal(r3.log.find((x) => x.type === 'rebuild').cells, 6);
});

test('Umbauen: nur eigene Gräben, nicht zu weit weg', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 11, y: 0 })]), 1);
  const v = (path) => validateOrder({ group: 'a01', type: 'rebuild', path }, s, 'a', { map: MAP });
  assert.match(v(line(12, 1, 2)), /Gegner/);
  assert.match(v([{ x: 10, y: 0 }]), /kein Graben/);
  captureTrench(s, MAP, 12, 1, 'a');
  assert.equal(v([{ x: 12, y: 1 }]), null);
});

test('Stufen passen zur Deckungstabelle', () => {
  assert.deepEqual(LEVELS.slice(1).map((l) => coverValue(l.cover)), [0.45, 0.6, 0.7, 0.8]);
});

test('Rückeroberung: Auftritt zeigt wieder zum Feind, also volle Deckung', () => {
  const s = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 5 })]), 1);
  s.cells['6,3'] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' }, rebuild: { work: 20, side: 'own' } };
  assert.ok(captureTrench(s, MAP, 6, 3, 'b'));
  assert.equal(s.cells['6,3'].trench.captured, true, 'für b zeigt E nach hinten');
  assert.equal(s.cells['6,3'].rebuild, undefined, 'angefangener Umbau verfällt');
  assert.ok(captureTrench(s, MAP, 6, 3, 'a'));
  assert.equal(s.cells['6,3'].trench.captured, undefined);
  assert.equal(trenchCover(applyCellState(MAP, s.cells), 6, 3, 'a').reversed, false);
});

test('Umbauen über viele Runden: Gruppe rückt nach, der Rest bleibt gültig', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 11, y: 0 })], [{ type: 'rifles', pos: { x: 15, y: 11 } }]), 1);
  s0.groups[0].size = 10;
  for (const p of line(12, 0, 11)) {
    s0.cells[p.x + ',' + p.y] = { trench: { side: 'enemy', kind: 'fire', level: 2, facing: 'W' } };
    captureTrench(s0, MAP, p.x, p.y, 'a');
  }
  const { state, logs } = play(s0, [{ group: 'a01', type: 'rebuild', path: line(12, 0, 11) }], 4);
  for (const log of logs) assert.equal(log.filter((e) => e.type === 'order_invalid').length, 0, JSON.stringify(log.filter((e) => e.type === 'order_invalid')));
  const m = applyCellState(MAP, state.cells);
  for (const p of line(12, 0, 11)) assert.equal(cellAt(m, p.x, p.y).trench.captured, undefined, `${p.x}/${p.y}`);
});

test('Graben über fertige Felder: kein Sprung der Gruppe', () => {
  const s0 = createInitialState(MAP, scenario([fullRifles({ x: 5, y: 0 })]), 1);
  for (const p of line(6, 0, 5)) s0.cells[p.x + ',' + p.y] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' } };
  const r = resolveTurn(s0, [{ group: 'a01', type: 'dig', path: line(6, 0, 6) }], [], 1, 1, { map: MAP });
  const g = r.state.groups.find((x) => x.id === 'a01');
  assert.ok(Math.max(Math.abs(g.pos.x - 5), Math.abs(g.pos.y - 0)) <= 1 + 3);
  assert.match(validateOrder({ group: 'a01', type: 'dig', path: line(6, 0, 1), facing: ['E', 'X'] }, s0, 'a', { map: MAP }), /Feuerrichtung/);
});
