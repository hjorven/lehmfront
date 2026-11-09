// P05: Sicht, Feuer, Unterdrueckung, Nebel des Krieges
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState, getGroup } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import {
  spot, sightRange, coverAt, inCone, sectorOf, directionOf, visibleEnemies, darknessOf, PINNED, visibleCells,
} from '../js/sight.js';
import { fireOdds, defaultEnfilade, effectiveShots } from '../js/phases/fire.js';
import { moveBudget } from '../js/phases/move.js';
import { validateOrder } from '../js/orders.js';

/** Kleine Karte: rows je Feld ein Zeichen, Hoehen als Ziffern */
function makeMap({ w = 20, h = 7, terrain, heights, trenches = [], craters = [] } = {}) {
  const row = (c) => c.repeat(w);
  return loadMap({
    id: 'probe', width: w, height: h,
    terrain: terrain ?? Array.from({ length: h }, () => row('.')),
    heights: heights ?? Array.from({ length: h }, () => row('1')),
    zones: Array.from({ length: h }, () => 'S'.repeat(w / 2) + 's'.repeat(w / 2)),
    trenches, craters,
  });
}

function scenario(a, b, extra = {}) {
  return {
    id: 'probe', startHour: 12, turnKind: 'battle', ...extra,
    sides: {
      a: { faction: 'kaldern', groups: a, ...(extra.a ?? {}) },
      b: { faction: 'morrow', groups: b, ...(extra.b ?? {}) },
    },
  };
}

function battleState(map, a, b, extra) {
  const s = createInitialState(map, scenario(a, b, extra), 7);
  s.battle = { round: 1 };
  return s;
}

test('Sichtweite: Tag 12, Nacht kuerzer, Beobachter weiter, Deckung verbirgt', () => {
  const map = makeMap();
  const rifle = { type: 'rifles', pos: { x: 0, y: 3 } };
  assert.equal(sightRange(map, rifle, { x: 10, y: 3 }, 0), 12);
  assert.equal(sightRange(map, rifle, { x: 10, y: 3 }, 1), 4);
  assert.equal(sightRange(map, rifle, { x: 10, y: 3 }, 0, { concealed: true }), 8);
  assert.equal(sightRange(map, rifle, { x: 10, y: 3 }, 1, { concealed: true, flash: true }), 12);
  assert.equal(sightRange(map, { type: 'observers', pos: { x: 0, y: 3 } }, { x: 10, y: 3 }, 0), 14);
  assert.equal(sightRange(map, { ...rifle, inDugout: true }, { x: 1, y: 3 }, 0), 1);
});

test('Hoehe sieht ueber niedrigere Felder hinweg, ein Huegel dazwischen versperrt die Sicht', () => {
  // Huegel (Hoehe 3) in Spalte 5, Beobachter links auf Hoehe 1, Ziel rechts auf Hoehe 1
  const heights = Array.from({ length: 7 }, () => '11111' + '3' + '11111111111111');
  const map = makeMap({ heights });
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 9, y: 3 } }]);
  const viewer = getGroup(s, 'a01'), target = getGroup(s, 'b01');
  const r = spot(s, map, viewer, target, 0);
  assert.equal(r.visible, false);
  assert.deepEqual(r.blockedAt, { x: 5, y: 3 });

  // Auf dem Huegel selbst stehend sieht der Beobachter darueber hinweg und weiter
  const heights2 = Array.from({ length: 7 }, () => '33333' + '3' + '11111111111111');
  const map2 = makeMap({ heights: heights2 });
  const s2 = battleState(map2, [{ type: 'observers', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 19, y: 3 } }]);
  const v2 = getGroup(s2, 'a01');
  // 14 + 2 Stufen * 3 = 20 Felder fuer Beobachter auf der Hoehe
  assert.equal(sightRange(map2, v2, { x: 19, y: 3 }, 0), 20);
  assert.equal(spot(s2, map2, v2, getGroup(s2, 'b01'), 0).visible, true);
});

test('Nachts sieht man weniger weit, Muendungsfeuer verraet die Stellung', () => {
  const map = makeMap();
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 9, y: 3 } }]);
  assert.deepEqual(visibleEnemies(s, map, 'a', 0), ['b01']);
  assert.deepEqual(visibleEnemies(s, map, 'a', 1), []);
  getGroup(s, 'b01').fired = true;
  assert.deepEqual(visibleEnemies(s, map, 'a', 1), ['b01']);
});

test('Ziel im Graben wird spaeter erkannt als im offenen Feld', () => {
  const map = makeMap({ trenches: [{ x: 12, y: 3, side: 'enemy', kind: 'fire', level: 1, facing: 'W' }] });
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 12, y: 3 } }]);
  // 10 Felder: offen sichtbar (12), im Graben nicht (8)
  assert.deepEqual(visibleEnemies(s, map, 'a', 0), []);
  getGroup(s, 'b01').moved = true;
  assert.deepEqual(visibleEnemies(s, map, 'a', 0), ['b01']);
});

test('Deckung: Graben, eroberter Graben halb, Wald', () => {
  const terrain = Array.from({ length: 7 }, () => '....w...............');
  const map = makeMap({ terrain, trenches: [{ x: 2, y: 3, side: 'own', kind: 'fire', level: 2, facing: 'E' }] });
  const s = createInitialState(map, scenario([], []), 1);
  assert.equal(coverAt(s, map, { x: 2, y: 3 }, 'a').cover, 'trench_improved');
  assert.equal(coverAt(s, map, { x: 2, y: 3 }, 'a').reversed, false);
  assert.equal(coverAt(s, map, { x: 2, y: 3 }, 'b').reversed, true);
  assert.equal(coverAt(s, map, { x: 4, y: 0 }, 'a').label, 'Wald');
  assert.equal(coverAt(s, map, { x: 7, y: 0 }, 'a').cover, 'open');
  // Spielzustand vor Karte: P04 schuettet zu
  s.cells['2,3'] = { trench: null };
  assert.equal(coverAt(s, map, { x: 2, y: 3 }, 'a').cover, 'open');
});

test('Feuersektor: Kegel 60 Grad, Reichweite, Standardrichtung nach Blickrichtung', () => {
  const from = { x: 5, y: 5 }, aim = { x: 15, y: 5 };
  assert.ok(inCone(from, aim, { x: 10, y: 5 }, 60, 10));
  assert.ok(inCone(from, aim, { x: 10, y: 7 }, 60, 10));      // ~22 Grad
  assert.ok(!inCone(from, aim, { x: 10, y: 9 }, 60, 10));     // ~39 Grad
  assert.ok(!inCone(from, aim, { x: 0, y: 5 }, 60, 10));      // hinten
  assert.ok(!inCone(from, aim, { x: 16, y: 5 }, 60, 10));     // zu weit
  const mg = { type: 'mg', side: 'a', pos: { x: 3, y: 3 }, facing: 'e' };
  assert.deepEqual(sectorOf(mg).aim, { x: 13, y: 3 });
  assert.deepEqual(sectorOf({ ...mg, sector: { x: 3, y: 9 } }).aim, { x: 3, y: 9 });
  assert.equal(sectorOf({ type: 'rifles', side: 'a', pos: { x: 0, y: 0 } }), null);
  assert.equal(directionOf({ x: 0, y: 0 }, { x: 5, y: -1 }).name, 'Ost');
  assert.equal(directionOf({ x: 0, y: 0 }, { x: 3, y: 3 }).name, 'Südost');
});

test('Laengsfeuer: entlang eines geraden Grabens, nicht von vorn, nicht ueber Traversen', () => {
  const tr = (y, extra = {}) => ({ x: 10, y, side: 'enemy', kind: 'fire', level: 1, facing: 'W', ...extra });
  const map = makeMap({ h: 9, trenches: [tr(2), tr(3), tr(4), tr(5), tr(6)] });
  const s = createInitialState(map, scenario([], []), 1);
  assert.equal(defaultEnfilade(s, map, { x: 10, y: 8 }, { x: 10, y: 4 }), true);   // von Sueden entlang
  assert.equal(defaultEnfilade(s, map, { x: 4, y: 4 }, { x: 10, y: 4 }), false);   // von vorn
  s.cells['10,3'] = { trench: tr(3, { traverse: true }) };
  assert.equal(defaultEnfilade(s, map, { x: 10, y: 0 }, { x: 10, y: 4 }), false);  // Traverse dazwischen
});

test('Vorschau: Trefferchance faellt mit Deckung und Nacht, ohne Sicht kein Feuer', () => {
  const map = makeMap({ trenches: [{ x: 8, y: 3, side: 'enemy', kind: 'fire', level: 1, facing: 'W' }] });
  const s = battleState(map, [{ type: 'rifles', pos: { x: 3, y: 3 } }], [{ type: 'rifles', pos: { x: 8, y: 3 } }]);
  const a = getGroup(s, 'a01');
  const open = fireOdds(s, map, a, { x: 8, y: 2 }, 'b', { darkness: 0 });
  const trench = fireOdds(s, map, a, { x: 8, y: 3 }, 'b', { darkness: 0 });
  const night = fireOdds(s, map, a, { x: 8, y: 2 }, 'b', { darkness: 1 });
  assert.ok(open.ok && trench.ok);
  assert.ok(trench.p < open.p);
  assert.ok(night.p < open.p);
  assert.equal(trench.coverLabel, 'Graben');
  assert.ok(Math.abs(open.expected - open.shots * open.p) < 1e-9);
  const far = fireOdds(s, map, a, { x: 15, y: 3 }, 'b', { darkness: 0 });
  assert.equal(far.ok, false);
  assert.match(far.why, /Reichweite/);
});

test('Feuer nach Bewegung: Verluste, Unterdrueckung, Begruendung mit Richtung', () => {
  const map = makeMap();
  const s = battleState(map,
    [{ type: 'mg', pos: { x: 2, y: 3 } }],
    [{ type: 'rifles', pos: { x: 14, y: 3 } }]);
  // b01 laeuft auf das MG zu und steht danach im offenen Feld im Kegel
  const ordersB = [{ group: 'b01', type: 'move', path: [{ x: 13, y: 3 }, { x: 12, y: 3 }, { x: 11, y: 3 }] }];
  const r = resolveTurn(s, [], ordersB, 7, 1, { map });
  const fire = r.log.find((e) => e.type === 'fire');
  assert.ok(fire, JSON.stringify(r.log.map((e) => e.type)));
  assert.equal(fire.group, 'a01');
  const hit = r.log.find((e) => e.group === 'b01' && (e.type === 'losses' || e.type === 'suppressed'));
  assert.ok(hit);
  assert.match(hit.reason, /MG-Feuer aus West/);
  const b = getGroup(r.state, 'b01');
  assert.ok(b.suppressed > 0.4, String(b.suppressed));
  assert.equal(b.strength, getGroup(s, 'b01').strength - hit.amount);
  assert.equal(getGroup(r.state, 'a01').fired, true);
  // Wer gelaufen ist, schiesst nicht zurueck
  assert.ok(!r.log.some((e) => e.type === 'fire' && e.group === 'b01'));
});

test('Feuer ist deterministisch', () => {
  const map = makeMap();
  const mk = () => battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }, { type: 'mg', pos: { x: 2, y: 5 } }],
    [{ type: 'rifles', pos: { x: 7, y: 3 } }, { type: 'rifles', pos: { x: 8, y: 5 } }]);
  const r1 = resolveTurn(mk(), [{ group: 'a01', type: 'fire', target: { x: 7, y: 3 } }], [], 7, 1, { map });
  const r2 = resolveTurn(mk(), [{ group: 'a01', type: 'fire', target: { x: 7, y: 3 } }], [], 7, 1, { map });
  assert.deepEqual(r1.state, r2.state);
  assert.deepEqual(r1.log, r2.log);
});

test('Unterdrueckung: niedergehalten feuert nicht von selbst, kriecht, faengt sich ohne Beschuss', () => {
  const map = makeMap();
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 7, y: 3 } }]);
  const a = getGroup(s, 'a01');
  a.suppressed = 0.9;
  assert.equal(moveBudget(a, 'battle'), Math.floor(moveBudget({ ...a, suppressed: 0 }, 'battle') / 2));
  // b in einem Unterstand: wird nicht beschossen; a ist niedergehalten und feuert nicht
  getGroup(s, 'b01').inDugout = true;
  const r = resolveTurn(s, [], [], 7, 1, { map });
  assert.ok(!r.log.some((e) => e.type === 'fire'));
  assert.equal(getGroup(r.state, 'a01').suppressed, 0.6);
  assert.ok(r.log.some((e) => e.type === 'rally' && e.group === 'a01'));
  assert.ok(getGroup(r.state, 'a01').suppressed < PINNED);
});

test('Waffe bestimmt die Unterdrueckung: MG haelt staerker nieder als Gewehre', () => {
  const map = makeMap();
  const run = (type) => {
    const s = battleState(map, [{ type, pos: { x: 2, y: 3 }, strength: 6 }], [{ type: 'rifles', pos: { x: 8, y: 3 } }]);
    getGroup(s, 'b01').moved = true;
    const r = resolveTurn(s, [], [{ group: 'b01', type: 'hold' }], 7, 1, { map });
    return getGroup(r.state, 'b01').suppressed;
  };
  assert.ok(run('mg') > run('rifles'));
});

test('Geister: zuletzt gesehen, Alter in Runden, Bewegung, ausradiert wenn der Platz leer ist', () => {
  const map = makeMap({ w: 30 });
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 10, y: 3 } }]);
  let st = s;
  // Runde 1: b01 sichtbar (8 Felder, offen)
  st = resolveTurn(st, [{ group: 'a01', type: 'hold' }], [{ group: 'b01', type: 'hold' }], 7, 1, { map }).state;
  assert.equal(st.sides.a.intel.lastSeen.b01.turn, 2);
  assert.ok(viewFor(st, [], 'a', { map }).groups.some((g) => g.id === 'b01'));
  // Runde 2: b01 zieht sich weit zurueck und verschwindet aus der Sicht
  const back = [{ group: 'b01', type: 'move', path: [{ x: 11, y: 3 }, { x: 12, y: 3 }, { x: 13, y: 3 }] }];
  st = resolveTurn(st, [], back, 7, 2, { map }).state;
  st.groups.find((g) => g.id === 'b01').pos = { x: 25, y: 3 }; // weit weg, ausser Sicht
  st = resolveTurn(st, [], [], 7, 3, { map }).state;
  st = resolveTurn(st, [], [], 7, 4, { map }).state;
  const v = viewFor(st, [], 'a', { map });
  assert.ok(!v.groups.some((g) => g.id === 'b01'));
  const gh = v.ghosts.find((g) => g.id === 'b01');
  assert.ok(gh);
  assert.deepEqual(gh.pos, { x: 13, y: 3 });
  assert.deepEqual(gh.from, { x: 10, y: 3 });
  assert.equal(gh.age, 2);
  assert.equal(gh.type, 'rifles');

  // a01 schaut auf das Feld des Geistes: niemand da, Geist wird ausradiert
  st.groups.find((g) => g.id === 'a01').pos = { x: 10, y: 3 };
  const r = resolveTurn(st, [], [], 7, 5, { map });
  assert.ok(!r.state.sides.a.intel.lastSeen.b01);
  assert.ok(r.log.some((e) => e.type === 'ghost_cleared' && e.side === 'a'));
});

test('Geister werden alt und vergessen; Anfangswissen aus dem Szenario', () => {
  const map = makeMap({ w: 30 });
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'mg', pos: { x: 28, y: 3 } }],
    { a: { intel: [{ group: 'b01', turnsAgo: 3, sector: { x: 20, y: 3 }, source: 'Luftbild' }] } });
  let v = viewFor(s, [], 'a', { map });
  assert.equal(v.ghosts.length, 1);
  assert.equal(v.ghosts[0].age, 3);
  assert.deepEqual(v.ghosts[0].sector, { x: 20, y: 3 });
  assert.equal(v.ghosts[0].source, 'Luftbild');
  s.turn = 13;
  v = viewFor(s, [], 'a', { map });
  assert.equal(v.ghosts.length, 0);
});

test('Gegner sieht keine Namen, nur Umriss; MG-Kegel erst, wenn es feuert', () => {
  const map = makeMap();
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'mg', pos: { x: 9, y: 3 } }]);
  let e = viewFor(s, [], 'a', { map }).groups.find((g) => g.id === 'b01');
  assert.ok(e);
  assert.equal(e.leader, undefined);
  assert.equal(e.sector, undefined);
  getGroup(s, 'b01').fired = true;
  e = viewFor(s, [], 'a', { map }).groups.find((g) => g.id === 'b01');
  assert.deepEqual(e.sector, { x: -1, y: 3 });
});

test('Befehle: Sektor nur fuer MG, Feuern nicht fuer MG und nicht in Stellungsrunden', () => {
  const map = makeMap();
  const s = battleState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }, { type: 'mg', pos: { x: 2, y: 5 } }, { type: 'medics', pos: { x: 1, y: 1 } }], []);
  assert.equal(validateOrder({ group: 'a01', type: 'fire', target: { x: 6, y: 3 } }, s, 'a'), null);
  assert.match(validateOrder({ group: 'a02', type: 'fire', target: { x: 6, y: 3 } }, s, 'a'), /Feuersektor/);
  assert.equal(validateOrder({ group: 'a02', type: 'sector', target: { x: 9, y: 5 } }, s, 'a'), null);
  assert.match(validateOrder({ group: 'a01', type: 'sector', target: { x: 9, y: 5 } }, s, 'a'), /nur MG/);
  assert.match(validateOrder({ group: 'a03', type: 'fire', target: { x: 6, y: 3 } }, s, 'a'), /feuert nicht/);
  s.turnKind = 'position';
  assert.match(validateOrder({ group: 'a01', type: 'fire', target: { x: 6, y: 3 } }, s, 'a'), /Gefechtsrunde/);
  assert.equal(validateOrder({ group: 'a02', type: 'sector', target: { x: 9, y: 5 } }, s, 'a'), null);
});

test('Sektor-Befehl setzt den Kegel, das MG feuert nur hinein', () => {
  const map = makeMap({ h: 12 });
  const s = battleState(map, [{ type: 'mg', pos: { x: 2, y: 2 } }], [{ type: 'rifles', pos: { x: 8, y: 2 } }, { type: 'rifles', pos: { x: 2, y: 9 } }]);
  getGroup(s, 'b01').moved = true;
  const r = resolveTurn(s, [{ group: 'a01', type: 'sector', target: { x: 2, y: 11 } }], [{ group: 'b01', type: 'hold' }, { group: 'b02', type: 'hold' }], 7, 1, { map });
  assert.deepEqual(getGroup(r.state, 'a01').sector, { x: 2, y: 11 });
  const fire = r.log.find((e) => e.type === 'fire' && e.group === 'a01');
  assert.equal(fire.target, 'b02');
});

test('Schusszahl folgt der Mannstaerke; Sicht-Overlay deckt sich mit der Regel', () => {
  assert.equal(effectiveShots({ type: 'rifles', strength: 5, size: 10 }), 4);
  assert.equal(effectiveShots({ type: 'rifles', strength: 0, size: 10 }), 1);
  const map = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
  const scen = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url)));
  const s = createInitialState(map, scen, 1917);
  const cells = visibleCells(s, map, 'a', darknessOf(s));
  const g = getGroup(s, 'a01');
  assert.equal(cells[g.pos.y * map.width + g.pos.x], 1);
  // Szenario bringt Geister mit
  const v = viewFor(s, [], 'a', { map });
  assert.deepEqual(v.ghosts.map((x) => [x.id, x.age]), [['b02', 2], ['b03', 4]]);
});
