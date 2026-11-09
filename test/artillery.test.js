// P09: Artillerie nach Feuerplan, Feuerwalze, Beobachter, Leitungen, Krater
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState, getGroup, getCell } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { createRng } from '../js/rng.js';
import { validateOrder, normalizeOrders } from '../js/orders.js';
import {
  initArtillery, planCellsAt, creepOffset, walzeTimeline, scatter, salvo, observerLink, commandLink, applyImpacts,
  normalizePlan, validatePlan, ammoAfter, stormGhosts, spreadOf, shellsPerRound, lineCellsOf, batteryLinked, planClashes, observerPlan,
} from '../js/artillery.js';
import { FACTIONS } from '../js/config/factions.js';

function makeMap({ w = 40, h = 16, wire = [] } = {}) {
  const row = (c) => c.repeat(w);
  return loadMap({
    id: 'probe', width: w, height: h,
    terrain: Array.from({ length: h }, () => row('.')),
    heights: Array.from({ length: h }, () => row('1')),
    zones: Array.from({ length: h }, () => 'E'.repeat(8) + 'S'.repeat(12) + 'N'.repeat(4) + 's'.repeat(8) + 'e'.repeat(w - 32)),
    wire,
  });
}

const ART_A = {
  exchange: { x: 4, y: 8 },
  batteries: [
    { id: 'bat1', type: 'feldhaubitzen', x: 1, y: 2, w: 2, h: 2, label: 'Batterie 1' },
    { id: 'bat2', type: 'feldhaubitzen', x: 1, y: 12, w: 2, h: 2, label: 'Batterie 2' },
  ],
  lines: [
    { id: 'lv', to: 'Abschnitt A', points: [[4, 8], [12, 8], [18, 8]] },
    { id: 'lb1', to: 'bat1', points: [[4, 8], [2, 3]] },
    { id: 'lb2', to: 'bat2', points: [[4, 8], [2, 12]] },
  ],
};
const ART_B = {
  exchange: { x: 36, y: 8 },
  batteries: [{ id: 'mb1', type: 'schwere', x: 37, y: 2, w: 2, h: 2, label: 'Batterie Morrow 1' }],
  lines: [],
};

function scen(a, b, { kind = 'battle', artA = ART_A, artB = ART_B, hour = 12 } = {}) {
  return {
    id: 'probe', startHour: hour, turnKind: kind,
    sides: {
      a: { faction: 'kaldern', groups: a, artillery: structuredClone(artA) },
      b: { faction: 'morrow', groups: b, artillery: structuredClone(artB) },
    },
  };
}

function battle(map, a, b, opts) {
  const s = createInitialState(map, scen(a, b, opts), 11);
  s.battle = { round: 1 };
  return s;
}

const walze = (over = {}) => normalizePlan({
  id: 'w1', kind: 'creep', batteries: ['bat1', 'bat2'], a: { x: 24, y: 4 }, b: { x: 24, y: 11 }, dir: 'E', step: 1, rounds: 6, start: 1, ...over,
});

test('Walze: Position pro Runde rueckt um den Schritt in Planrichtung vor', () => {
  const p = walze({ step: 2, start: 2, rounds: 4 });
  assert.equal(creepOffset(p, 1), null, 'vor dem Start keine Walze');
  assert.deepEqual(creepOffset(p, 2), { dx: 0, dy: 0 });
  assert.deepEqual(creepOffset(p, 3), { dx: 2, dy: 0 });
  assert.deepEqual(creepOffset(p, 5), { dx: 6, dy: 0 });
  assert.equal(creepOffset(p, 6), null, 'nach der Dauer ist Schluss');
  const cells = planCellsAt(p, 4);
  assert.equal(cells.length, 8);
  assert.ok(cells.every((c) => c.x === 28), 'Runde 4 liegt zwei Schritte = vier Felder weiter');
  const tl = walzeTimeline(p);
  assert.deepEqual(tl.map((t) => t.center.x), [24, 26, 28, 30]);
  assert.deepEqual(tl.map((t) => t.round), [2, 3, 4, 5]);
});

test('Walze diagonal und mit Verlegung durch Beobachter', () => {
  const p = walze({ dir: 'SE', a: { x: 20, y: 2 }, b: { x: 26, y: 2 } });
  assert.deepEqual(planCellsAt(p, 3)[0], { x: 22, y: 4 });
  const shifted = { ...p, shift: { dx: -1, dy: 3 } };
  assert.deepEqual(planCellsAt(shifted, 3)[0], { x: 21, y: 7 });
  assert.deepEqual(planCellsAt(shifted, 3, null, { withShift: false })[0], { x: 22, y: 4 });
});

test('Vorbereitungsfeuer hat Tiefe, Sperrfeuer liegt auf Abruf bis die Runden verschossen sind', () => {
  const prep = normalizePlan({ id: 'v', kind: 'prep', batteries: ['bat1'], a: { x: 30, y: 3 }, b: { x: 30, y: 5 }, dir: 'E', rounds: 2, start: 1 });
  assert.equal(planCellsAt(prep, 1).length, 6, 'drei Felder lang, zwei tief');
  assert.equal(planCellsAt(prep, 3).length, 0);
  const sperr = normalizePlan({ id: 's', kind: 'barrage', batteries: ['bat1'], a: { x: 22, y: 3 }, b: { x: 22, y: 5 }, dir: 'E', rounds: 2, start: 1 });
  assert.equal(planCellsAt(sperr, 9).length, 3, 'auf Abruf auch spaet');
  assert.equal(planCellsAt({ ...sperr, fired: 2 }, 9).length, 0, 'Munition fuer zwei Runden verschossen');
});

test('Streuung ist deterministisch und Kaldern streut weniger als Morrow', () => {
  const r1 = createRng(5), r2 = createRng(5);
  const a = Array.from({ length: 200 }, () => scatter(r1, 14));
  const b = Array.from({ length: 200 }, () => scatter(r2, 14));
  assert.deepEqual(a, b);
  assert.ok(Math.max(...a.map(Math.abs)) <= 5, 'Streuung bleibt begrenzt');
  const map = makeMap();
  const cells = [{ x: 20, y: 8 }];
  assert.deepEqual(salvo(createRng(9), cells, 12, 14, map), salvo(createRng(9), cells, 12, 14, map));
  const art = initArtillery(map, ART_A, 'a', 'kaldern');
  const k = spreadOf(art.batteries[0], { exchange: null }, 'kaldern');
  const m = spreadOf(art.batteries[0], { exchange: null }, 'morrow');
  assert.ok(k < m, `Kaldern ${k} < Morrow ${m}`);
  assert.equal(FACTIONS.kaldern.artillery.spread < FACTIONS.morrow.artillery.spread, true);
  // Mittlere Abweichung ueber viele Schuss: Kaldern naeher am Ziel
  const dev = (spread) => {
    const rng = createRng(3);
    let s = 0;
    for (let i = 0; i < 2000; i++) s += Math.abs(scatter(rng, spread));
    return s / 2000;
  };
  assert.ok(dev(k) < dev(m));
});

test('Leitungen: Beobachter am Leitungsende per Telefon, durchtrennt per Melder, ohne Melder gar nicht', () => {
  const map = makeMap();
  const s = battle(map, [{ type: 'observers', pos: { x: 19, y: 8 } }, { type: 'runners', pos: { x: 15, y: 10 } }], [{ type: 'rifles', pos: { x: 30, y: 8 } }]);
  const obs = getGroup(s, 'a01');
  const art = s.sides.a.artillery;
  const plan = walze();
  art.plans = [plan];
  assert.equal(observerLink(s, 'a', obs).phone, true);
  assert.deepEqual(commandLink(s, 'a', obs, plan).delay, 1);
  art.lines.find((l) => l.id === 'lv').cut = { x: 10, y: 8 };
  assert.equal(observerLink(s, 'a', obs).phone, false);
  const viaRunner = commandLink(s, 'a', obs, plan);
  assert.equal(viaRunner.via, 'runner');
  assert.equal(viaRunner.delay, 2);
  assert.match(viaRunner.why, /durchtrennt/);
  getGroup(s, 'a02').status = 'lost';
  assert.equal(commandLink(s, 'a', obs, plan).via, null);
  // Batterie ohne Leitung zwingt auch einen angeschlossenen Beobachter zum Melder
  art.lines.find((l) => l.id === 'lv').cut = null;
  getGroup(s, 'a02').status = 'front';
  art.lines.find((l) => l.id === 'lb2').cut = { x: 3, y: 10 };
  assert.equal(batteryLinked(art, art.batteries[1]), false);
  assert.equal(commandLink(s, 'a', obs, plan).via, 'runner');
});

test('Feuer verlegen wirkt per Telefon eine Runde, per Melder zwei Runden spaeter', () => {
  const map = makeMap();
  const target = { x: 28, y: 6 };
  const run = (cut) => {
    let s = battle(map, [{ type: 'observers', pos: { x: 19, y: 8 } }, { type: 'runners', pos: { x: 15, y: 10 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
    s.sides.a.artillery.plans = [normalizePlan({ id: 'v', kind: 'prep', batteries: ['bat1'], a: { x: 30, y: 3 }, b: { x: 30, y: 5 }, dir: 'E', rounds: 6, start: 1 })];
    if (cut) s.sides.a.artillery.lines.find((l) => l.id === 'lv').cut = { x: 10, y: 8 };
    const shiftedAt = [];
    for (let i = 0; i < 4; i++) {
      const orders = i === 0 ? [{ group: 'a01', type: 'shift_fire', target }] : [];
      const r = resolveTurn(s, orders, [], 11, s.turn, { map });
      if (r.log.some((e) => e.type === 'fire_shifted')) shiftedAt.push(s.battle.round);
      s = r.state;
    }
    return shiftedAt;
  };
  assert.deepEqual(run(false), [2], 'Telefon: Befehl aus Runde 1 gilt ab Runde 2');
  assert.deepEqual(run(true), [3], 'Melder: Befehl aus Runde 1 gilt ab Runde 3');
});

test('Feuer verlegen braucht Sicht auf das Ziel, nur Beobachter duerfen', () => {
  const map = makeMap();
  const s = battle(map, [{ type: 'observers', pos: { x: 19, y: 8 } }, { type: 'rifles', pos: { x: 18, y: 4 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
  s.sides.a.artillery.plans = [walze()];
  assert.equal(validateOrder({ group: 'a01', type: 'shift_fire', target: { x: 25, y: 8 } }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a02', type: 'shift_fire', target: { x: 25, y: 8 } }, s, 'a', { map }), /nur Beobachter/);
  assert.match(validateOrder({ group: 'a01', type: 'shift_fire', target: { x: 39, y: 0 } }, s, 'a', { map }), /sieht das Ziel nicht/);
  s.sides.a.artillery.plans = [];
  assert.match(validateOrder({ group: 'a01', type: 'shift_fire', target: { x: 25, y: 8 } }, s, 'a', { map }), /kein laufender Feuerplan/);
});

test('Feuer einstellen per Telefon stoppt die Walze ab der naechsten Runde', () => {
  const map = makeMap();
  let s = battle(map, [{ type: 'observers', pos: { x: 19, y: 8 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
  s.sides.a.artillery.plans = [walze()];
  const shots = [];
  for (let i = 0; i < 3; i++) {
    const r = resolveTurn(s, i === 0 ? [{ group: 'a01', type: 'cease_fire' }] : [], [], 11, s.turn, { map });
    shots.push(r.log.filter((e) => e.type === 'shelling' && e.side === 'a').length);
    s = r.state;
  }
  assert.deepEqual(shots, [2, 0, 0]);
});

test('Gefechtsrunde: Walze schiesst, bucht Munition ab, legt Krater an, Ereignisse mit Grund und Ort', () => {
  const map = makeMap();
  const s = battle(map, [{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 24, y: 8 } }]);
  s.sides.a.artillery.plans = [walze()];
  const before = s.sides.a.artillery.batteries.map((b) => b.ammo);
  const r = resolveTurn(s, [], [], 11, s.turn, { map });
  const after = r.state.sides.a.artillery.batteries.map((b) => b.ammo);
  const per = shellsPerRound(s.sides.a.artillery.batteries[0], 'kaldern', 'creep');
  assert.deepEqual(after, before.map((n) => n - per));
  const shelling = r.log.filter((e) => e.type === 'shelling');
  assert.equal(shelling.length, 2);
  for (const e of r.log) {
    assert.equal(typeof e.reason, 'string');
    assert.ok(Number.isInteger(e.at.x));
  }
  const craters = Object.entries(r.state.cells).filter(([, c]) => c.crater > 0);
  assert.ok(craters.length > 3, 'Einschlaege hinterlassen Krater');
  assert.ok(craters.every(([, c]) => c.shelled >= 1 && c.fresh === s.turn));
  assert.ok(r.log.some((e) => e.type === 'impacts' && e.side === undefined && e.impacts.length === 2 * per));
  // Gleiches Ergebnis bei gleichem Seed
  const r2 = resolveTurn(s, [], [], 11, s.turn, { map });
  assert.deepEqual(r2.state, r.state);
  assert.deepEqual(r2.log, r.log);
});

test('Einschlaege: Eigenbeschuss, Unterstand schuetzt, Draht und Leitung reissen, Batterie schweigt', () => {
  const map = makeMap({ wire: [{ x: 20, y: 8, side: 'enemy' }] });
  const s = battle(map, [{ type: 'rifles', pos: { x: 20, y: 6 }, strength: 10 }, { type: 'rifles', pos: { x: 22, y: 6 }, strength: 10 }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
  getGroup(s, 'a02').inDugout = true;
  const log = [];
  const emit = (type, f) => log.push({ type, ...f });
  const many = (x, y, n) => Array.from({ length: n }, () => ({ x, y }));
  const impacts = [...many(20, 6, 8), ...many(22, 6, 8), ...many(20, 8, 6), ...many(12, 8, 8), ...many(37, 2, 2)];
  applyImpacts(s, map, createRng(4), impacts, { firing: 'a', emit, turn: 1, what: 'Feuerwalze', lethal: 34, suppression: 30 });
  const g1 = getGroup(s, 'a01'), g2 = getGroup(s, 'a02');
  assert.ok(g1.strength < 10, 'offenes Feld: Verluste');
  assert.equal(g2.strength, 10, 'Unterstand: keine Verluste');
  assert.ok(g2.suppressed > 0);
  assert.ok(log.some((e) => e.cause === 'friendly_fire' && /zu kurz/.test(e.reason)));
  assert.equal(getCell(s, 20, 8).wire, null, 'Draht zerrissen');
  assert.equal(getCell(s, 20, 6).crater, 2, 'viele Einschlaege: grosser Krater');
  assert.ok(s.sides.a.artillery.lines.find((l) => l.id === 'lv').cut, 'Leitung im Beschuss durchtrennt');
  assert.equal(s.sides.b.artillery.batteries[0].silenced, 2);
  assert.ok(log.some((e) => e.type === 'battery_hit'));
});

test('Stellungsrunde: Stoerfeuer sofort, Walze wird scharf, Leitungen geflickt, Nachschub aus dem Depot', () => {
  const map = makeMap();
  const s = createInitialState(map, scen([{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 30, y: 8 } }], { kind: 'position' }), 11);
  s.sides.a.artillery.lines[0].cut = { x: 10, y: 8 };
  s.sides.a.artillery.batteries[0].ammo = 50;
  const ammoBefore = s.sides.a.supplies.ammo;
  const order = { type: 'fire_plan', plans: [
    { id: 'st', kind: 'harass', batteries: ['bat2'], target: { x: 30, y: 8 } },
    { id: 'w1', kind: 'creep', batteries: ['bat1', 'bat2'], a: { x: 24, y: 4 }, b: { x: 24, y: 11 }, dir: 'E', step: 1, rounds: 6, start: 1 },
  ] };
  const r = resolveTurn(s, [order], [], 11, s.turn, { map });
  const art = r.state.sides.a.artillery;
  assert.ok(r.log.some((e) => e.type === 'line_repaired'));
  assert.equal(art.lines.find((l) => l.cut), undefined);
  assert.ok(art.batteries[0].ammo > 50, 'Batterie 1 nachgeladen');
  assert.ok(r.log.some((e) => e.type === 'battery_supplied' && e.battery === 'bat1'), 'Depot gibt Munition ab');
  void ammoBefore;
  assert.ok(r.log.some((e) => e.type === 'shelling' && e.plan === 'st'), 'Stoerfeuer schiesst sofort');
  assert.deepEqual(art.plans.map((p) => p.id), ['w1'], 'nur die Walze wartet auf den Angriff');
});

test('Feuerplan pruefen: Reichweite, Batterie, Gegenbatterie nur auf aufgeklaerte Stellungen', () => {
  const map = makeMap({ w: 80 });
  const s = createInitialState(map, scen([{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 30, y: 8 } }], { kind: 'position' }), 11);
  assert.equal(validatePlan({ id: 'x', kind: 'creep', batteries: ['bat1'], a: { x: 24, y: 4 }, b: { x: 24, y: 11 }, dir: 'E', step: 1, rounds: 4 }, s, 'a', map), null);
  assert.match(validatePlan({ id: 'x', kind: 'prep', batteries: ['bat1'], a: { x: 70, y: 4 }, b: { x: 70, y: 6 }, dir: 'E', rounds: 2 }, s, 'a', map), /reicht nicht/);
  assert.match(validatePlan({ id: 'x', kind: 'prep', batteries: ['zz'], a: { x: 20, y: 4 }, b: { x: 20, y: 6 }, dir: 'E', rounds: 2 }, s, 'a', map), /gibt es nicht/);
  assert.match(validatePlan({ id: 'x', kind: 'counter', batteries: ['bat1'], battery: 'mb1' }, s, 'a', map), /nicht aufgeklärt/);
  s.sides.a.artillery.known.mb1 = { pos: { x: 37, y: 2 }, w: 2, h: 2, type: 'schwere', turn: 1 };
  assert.equal(validatePlan({ id: 'x', kind: 'counter', batteries: ['bat1'], battery: 'mb1' }, s, 'a', map), null);
  // Seitenbefehl im Befehlsfluss
  const n = normalizeOrders(s, 'a', [{ type: 'fire_plan', plans: [{ id: 'x', kind: 'prep', batteries: ['zz'], a: { x: 20, y: 4 }, b: { x: 20, y: 6 }, dir: 'E' }] }], { map });
  assert.equal(n.plans.fire_plan, undefined);
  assert.ok(n.events.some((e) => e.type === 'order_invalid'));
});

test('Muendungsblitz verraet Batterien, dann ist Gegenbatteriefeuer moeglich', () => {
  const map = makeMap();
  let s = battle(map, [{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }], { hour: 22 });
  s.night = true;
  s.sides.a.artillery.plans = [walze({ rounds: 12 })];
  for (let i = 0; i < 8 && !s.sides.b.artillery.known.bat1; i++) s = resolveTurn(s, [], [], 11, s.turn, { map }).state;
  assert.ok(s.sides.b.artillery.known.bat1 || s.sides.b.artillery.known.bat2, 'nachts sieht man den Blitz');
});

test('Munition danach und Sturm-Geister hinter der Walze', () => {
  const map = makeMap({ wire: [{ x: 21, y: 8, side: 'enemy' }, { x: 22, y: 8, side: 'enemy' }] });
  const s = createInitialState(map, scen([{ type: 'rifles', pos: { x: 19, y: 6 } }, { type: 'rifles', pos: { x: 19, y: 8 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }], { kind: 'position' }), 11);
  const art = s.sides.a.artillery;
  const p = walze({ a: { x: 21, y: 4 }, b: { x: 21, y: 11 } });
  const am = ammoAfter([p], art, 'kaldern');
  const per = shellsPerRound(art.batteries[0], 'kaldern', 'creep');
  assert.equal(am.cost, 2 * 6 * per);
  assert.equal(am.after, am.before - am.cost);
  const ghosts = stormGhosts(map, s, 'a', p);
  assert.equal(ghosts.length, 2);
  for (const g of ghosts) {
    assert.equal(g.steps.length, 6);
    assert.ok(g.steps.every((st) => st.gap >= 1), 'Sturm wartet hinter den Einschlaegen');
  }
  // Durch den Draht kommt die Gruppe in Zeile 8 langsamer voran
  const free = ghosts.find((g) => g.group === 'a01'), wired = ghosts.find((g) => g.group === 'a02');
  assert.ok(wired.lag >= free.lag);
  const fast = stormGhosts(map, s, 'a', walze({ a: { x: 21, y: 4 }, b: { x: 21, y: 11 }, step: 3, rounds: 6 }));
  assert.ok(fast.some((g) => /zurück/.test(g.warn)), 'zu schnelle Walze: Sturm kommt nicht hinterher');
});

test('Szenario Asse-Nord: Seite a liest Batterien und Leitungen von der Karte', () => {
  const map = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
  const sc = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url)));
  const s = createInitialState(map, sc, 1917);
  const a = s.sides.a.artillery;
  assert.deepEqual(a.batteries.map((b) => b.id), ['batterie1', 'batterie2']);
  assert.ok(a.exchange);
  assert.ok(a.lines.some((l) => l.to === 'Abschnitt C' && l.cut), 'Leitung nach C ist auf der Karte durchtrennt');
  assert.ok(a.lines.every((l) => l.cells.length > 2));
  assert.equal(s.sides.b.artillery.plans[0].kind, 'barrage');
  assert.deepEqual(lineCellsOf([[0, 0], [2, 0.5], [2, 3]]).at(-1), { x: 2, y: 3 });
  // Batterie 1 reicht bis zum feindlichen Graben
  const p = normalizePlan({ id: 'x', kind: 'creep', batteries: ['batterie1', 'batterie2'], a: { x: 40, y: 6 }, b: { x: 40, y: 18 }, dir: 'E', step: 1, rounds: 6 });
  assert.equal(validatePlan(p, s, 'a', map), null);
});

test('Blaupause fuer den Editor: alle Schluessel des Tages, gut lesbar, Zeit bleibt', async () => {
  const { DAY, BLUEPRINT, blueprintTheme, contrast, themeAt } = await import('../js/theme.js');
  for (const k of Object.keys(DAY)) assert.ok(k in BLUEPRINT, k);
  assert.ok(contrast(BLUEPRINT.ink, BLUEPRINT.paper) >= 7);
  assert.ok(contrast(BLUEPRINT.ink, BLUEPRINT.card) >= 7);
  assert.ok(contrast(BLUEPRINT.accent, BLUEPRINT.paper) >= 4.5);
  assert.ok(contrast(BLUEPRINT.danger, BLUEPRINT.card) >= 3);
  assert.equal(blueprintTheme(themeAt(0.8)).darkness, 0.8, 'Regeln rechnen weiter mit der echten Dunkelheit');
});

test('Review: neue Feuerplaene tragen keine alten Laufzeitfelder (Sperrfeuer schiesst wieder)', () => {
  const map = makeMap();
  const s = createInitialState(map, scen([{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 30, y: 8 } }], { kind: 'position' }), 11);
  const old = { id: 's1', kind: 'barrage', batteries: ['bat1'], a: { x: 22, y: 3 }, b: { x: 22, y: 5 }, dir: 'E', rounds: 2, start: 1, fired: 2, used: true, shift: { dx: 3, dy: 0 }, adjusted: true };
  assert.equal(normalizePlan(old).fired, undefined);
  assert.equal(normalizePlan(old, { runtime: true }).fired, 2);
  const r = resolveTurn(s, [{ type: 'fire_plan', plans: [old] }], [], 11, s.turn, { map });
  const p = r.state.sides.a.artillery.plans[0];
  assert.equal(p.fired, undefined);
  assert.equal(p.shift, undefined);
  assert.equal(p.adjusted, undefined);
  assert.equal(planCellsAt(p, 1).length, 3, 'Sperrfeuer liegt wieder auf Abruf');
});

test('Review: Batterie in zwei Plaenen schiesst einmal, der andere Plan meldet es, Editor warnt', () => {
  const map = makeMap();
  const s = battle(map, [{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
  const prep = normalizePlan({ id: 'v1', kind: 'prep', batteries: ['bat2'], a: { x: 30, y: 3 }, b: { x: 30, y: 5 }, dir: 'E', rounds: 2, start: 1 });
  s.sides.a.artillery.plans = [walze(), prep];
  const r = resolveTurn(s, [], [], 11, s.turn, { map });
  const idle = r.log.find((e) => e.type === 'battery_idle' && e.battery === 'bat2' && e.plan === 'w1');
  assert.ok(idle && /schon Vorbereitungsfeuer/.test(idle.reason), 'v1 kommt vor w1 (nach ID), w1 meldet die belegte Batterie');
  assert.deepEqual(planClashes([walze(), prep]), [{ battery: 'bat2', plans: ['v1', 'w1'], round: 1 }]);
  assert.deepEqual(planClashes([walze(), { ...prep, start: 7 }]), []);
});

test('Review: beide Seiten schiessen gleichzeitig, auch wenn a die Batterie von b trifft', () => {
  const map = makeMap();
  const s = battle(map, [{ type: 'rifles', pos: { x: 15, y: 8 } }], [{ type: 'rifles', pos: { x: 34, y: 14 } }]);
  // a schiesst Vorbereitung genau auf die Batterie von b, b schiesst Vorbereitung auf a
  s.sides.a.artillery.plans = [normalizePlan({ id: 'v1', kind: 'prep', batteries: ['bat1', 'bat2'], a: { x: 37, y: 2 }, b: { x: 38, y: 2 }, dir: 'E', rounds: 1, start: 1 })];
  s.sides.b.artillery.plans = [normalizePlan({ id: 'v1', kind: 'prep', batteries: ['mb1'], a: { x: 14, y: 7 }, b: { x: 14, y: 9 }, dir: 'W', rounds: 1, start: 1 })];
  const r = resolveTurn(s, [], [], 11, s.turn, { map });
  assert.ok(r.log.some((e) => e.type === 'shelling' && e.side === 'b'), 'b schiesst, obwohl a zuerst gerechnet wird');
  assert.ok(r.log.some((e) => e.type === 'battery_hit'), 'die Batterie von b wird getroffen');
});

test('Review: Walze ueber den Kartenrand wird abgelehnt, Geister ohne Infinity', () => {
  const map = makeMap();
  const s = createInitialState(map, scen([{ type: 'rifles', pos: { x: 30, y: 6 } }], [{ type: 'rifles', pos: { x: 2, y: 14 } }], { kind: 'position' }), 11);
  const p = walze({ a: { x: 34, y: 4 }, b: { x: 34, y: 11 }, step: 3, rounds: 6 });
  assert.match(validatePlan(p, s, 'a', map), /Kartenrand/);
  for (const g of stormGhosts(map, s, 'a', p)) {
    assert.ok(Number.isFinite(g.lag));
    assert.ok(!/Infinity/.test(g.warn));
  }
});

test('Review: Nachschub verliert keine Granaten, Feuer einstellen trifft den naechsten laufenden Plan', () => {
  const map = makeMap();
  const s = createInitialState(map, scen([{ type: 'observers', pos: { x: 19, y: 8 } }], [{ type: 'rifles', pos: { x: 30, y: 8 } }], { kind: 'position' }), 11);
  const b = s.sides.a.artillery.batteries[0];
  const cap = b.ammo;
  b.ammo = cap - 55;
  const r = resolveTurn(s, [], [], 11, s.turn, { map });
  assert.equal(r.state.sides.a.artillery.batteries[0].ammo, cap - 5, 'fuenf volle Einheiten, kein Rest verloren');
  // Feuer einstellen ohne Plan: naechster laufender Plan zum Beobachter, nicht der mit der kleinsten ID
  const art = { plans: [
    normalizePlan({ id: 'a1', kind: 'prep', batteries: ['bat1'], a: { x: 36, y: 2 }, b: { x: 36, y: 4 }, dir: 'E', rounds: 3, start: 1 }),
    normalizePlan({ id: 'w1', kind: 'creep', batteries: ['bat2'], a: { x: 22, y: 6 }, b: { x: 22, y: 10 }, dir: 'E', step: 1, rounds: 4, start: 1 }),
    normalizePlan({ id: 'b0', kind: 'prep', batteries: ['bat2'], a: { x: 20, y: 6 }, b: { x: 20, y: 10 }, dir: 'E', rounds: 2, start: 5 }),
  ] };
  assert.equal(observerPlan(art, {}, 1, null, { x: 19, y: 8 }).id, 'w1');
  assert.equal(observerPlan(art, {}, 1, { x: 21, y: 8 }, { x: 19, y: 8 }).id, 'b0', 'Verlegen darf auch kommende Plaene meinen');
});
