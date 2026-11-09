import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { createRng } from '../js/rng.js';
import { isValidEvent } from '../js/events.js';
import {
  sectionsOf, sectionAt, supplyNetwork, runSupplySide, ensureSupply, addWounded, takeStock, normalizePlan,
  suggestPlan, planPreview, capacityOf, woundedCount, nextLoad, nextTarget, standingPlan,
} from '../js/supply.js';
import { CART_LOAD, UPKEEP, HEAL_TURNS, WOUNDED_PER_MEDIC_CART, DEFAULT_INCOME } from '../js/config/supply.js';
import { deepFreeze } from './fixtures/scenario.js';

// Kleine Front: Depot links, Gleis nach Osten, Laufgraben zur Feuerlinie x = 11, drei Abschnitte je drei Zeilen
//   x:   0123456789012345678 9
const W = 20, H = 9;
function testMap({ buildings = [] } = {}) {
  const rows = Array.from({ length: H }, () => '.'.repeat(W));
  const zones = Array.from({ length: H }, () => 'EEEEEESSSSSSSSNNssee');
  const trenches = [{ x: 10, y: 4, side: 'own', kind: 'comm', level: 1, facing: 'E' }];
  for (let y = 0; y < H; y++) trenches.push({ x: 11, y, side: 'own', kind: 'fire', level: 1, facing: 'E' });
  const rails = [];
  for (let x = 3; x <= 8; x++) rails.push([x, 4]);
  return loadMap({
    id: 'versorgung', width: W, height: H, terrain: rows, heights: rows.map((r) => '0'.repeat(r.length)), zones,
    trenches, rails,
    buildings: [{ id: 'depot', type: 'depot', x: 0, y: 3, w: 2, h: 2 }, ...buildings],
  });
}

const SCEN = {
  id: 'v',
  sides: {
    a: {
      faction: 'kaldern',
      supplies: { ammo: 60, food: 60, material: 30, cartsTotal: 4, income: { ammo: 0, food: 0, material: 0 } },
      groups: [
        { type: 'rifles', pos: { x: 11, y: 1 }, morale: 70 },
        { type: 'mg', pos: { x: 11, y: 4 }, morale: 70 },
        { type: 'pioneers', pos: { x: 11, y: 7 }, morale: 70 },
      ],
    },
    b: { faction: 'morrow', groups: [{ type: 'rifles', pos: { x: 18, y: 4 } }] },
  },
};

function setup(opts) {
  const map = testMap(opts);
  const state = createInitialState(map, structuredClone(SCEN), 7);
  return { map, state };
}

function run(state, map, side, plan, turn = 1, seed = 1) {
  const log = [];
  const r = runSupplySide(state, side, { map, turn, rng: createRng(seed), plan, emit: (type, f) => { const e = { phase: 'supply', type, ...f }; log.push(e); return e; } });
  return { ...r, log };
}

test('Abschnitte: drei Baender von Nord nach Sued, Zeile gehoert zu genau einem', () => {
  const map = testMap();
  assert.deepEqual(sectionsOf(map).map((s) => [s.id, s.y0, s.y1]), [['A', 0, 2], ['B', 3, 5], ['C', 6, 8]]);
  assert.equal(sectionAt(map, 0), 'A');
  assert.equal(sectionAt(map, 5), 'B');
  assert.equal(sectionAt(map, 8), 'C');
  const asse = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
  assert.equal(sectionsOf(asse).length, 3);
});

test('Netz: Depot, Gleis, Laufgraben verbinden alle Abschnitte', () => {
  const { map, state } = setup();
  const net = supplyNetwork(map, state, 'a');
  assert.equal(net.abstract, false);
  assert.deepEqual(net.sections.map((s) => s.connected), [true, true, true]);
  const b = net.sections[1];
  assert.equal(b.route[0].kind, 'depot');
  assert.ok(b.route.some((p) => p.kind === 'rail'));
  assert.equal(b.route[b.route.length - 1].kind, 'trench');
  // Seite b hat kein Depot auf der Karte: gilt als versorgt
  assert.equal(supplyNetwork(map, state, 'b').abstract, true);
});

test('Abschneiden: verschuetteter Laufgraben trennt nur den Abschnitt dahinter und nennt die Stelle', () => {
  const { map, state } = setup();
  state.cells['11,3'] = { trenchBlocked: true };
  const net = supplyNetwork(map, state, 'a');
  const [a, b, c] = net.sections;
  assert.equal(a.connected, false);
  assert.equal(b.connected, true);
  assert.equal(c.connected, true);
  assert.deepEqual(a.cutAt, { x: 11, y: 3 });
  assert.equal(a.cutWhy, 'Laufgraben verschüttet');
});

test('Abschneiden: Feind im Graben und zerschossenes Gleis', () => {
  const { map, state } = setup();
  state.groups.find((g) => g.side === 'b').pos = { x: 11, y: 5 };
  let net = supplyNetwork(map, state, 'a');
  assert.equal(net.sections[2].connected, false);
  assert.equal(net.sections[2].cutWhy, 'Feind im Graben');

  const s2 = setup().state;
  s2.cells['5,4'] = { railBroken: true };
  net = supplyNetwork(map, s2, 'a');
  assert.deepEqual(net.sections.map((s) => s.connected), [false, false, false]);
  assert.deepEqual(net.sections[1].cutAt, { x: 5, y: 4 });
  assert.equal(net.sections[1].cutWhy, 'Gleis zerschossen');
});

test('Kapazitaet: Plan wird auf die Loren gekuerzt, jede Lore bringt CART_LOAD aus dem Depot', () => {
  const { map, state } = setup();
  assert.equal(capacityOf(state, 'a'), 4);
  const plan = [
    { load: 'ammo', to: 'A' }, { load: 'food', to: 'A' }, { load: 'food', to: 'B' }, { load: 'material', to: 'C' },
    { load: 'ammo', to: 'C' }, { load: 'ammo', to: 'C' },
  ];
  assert.equal(normalizePlan(plan, 4, ['A', 'B', 'C']).length, 4);
  assert.equal(normalizePlan([{ load: 'gold', to: 'A' }, { load: 'ammo', to: 'Z' }], 4, ['A']).length, 0);
  ensureSupply(state, map, 'a');
  const before = structuredClone(state.sides.a.supply.sections);
  const r = run(state, map, 'a', plan);
  const s = state.sides.a;
  assert.equal(s.supplies.ammo, 60 - CART_LOAD);
  assert.equal(s.supplies.food, 60 - 2 * CART_LOAD - UPKEEP.food * 0);
  assert.equal(s.supplies.material, 30 - CART_LOAD);
  assert.equal(s.supplies.carts, 4);
  assert.equal(s.supplies.cartsTotal, 4);
  // A: +6 Munition, +6 Verpflegung, minus Verbrauch einer Gruppe
  assert.equal(s.supply.sections.A.ammo, before.A.ammo + CART_LOAD - UPKEEP.ammo);
  assert.equal(s.supply.sections.A.food, before.A.food + CART_LOAD - UPKEEP.food);
  assert.equal(s.supply.sections.C.material, before.C.material + CART_LOAD);
  assert.equal(s.supply.plan.length, 4);
  for (const e of r.log) assert.ok(isValidEvent(e), JSON.stringify(e));
});

test('Kapazitaet: leeres Depot laesst Loren halb leer fahren und meldet es', () => {
  const { map, state } = setup();
  state.sides.a.supplies.ammo = 8;
  const r = run(state, map, 'a', [{ load: 'ammo', to: 'A' }, { load: 'ammo', to: 'B' }]);
  assert.equal(state.sides.a.supplies.ammo, 0);
  const empty = r.log.filter((e) => e.type === 'depot_empty');
  assert.equal(empty.length, 1);
  assert.match(empty[0].reason, /Depot leer: Munition/);
  assert.equal(state.sides.a.supply.stats.depotEmpty, 1);
});

test('Nachschub: Depot bekommt je Stellungsrunde den Grundnachschub, wenn das Szenario nichts sagt', () => {
  const { map, state } = setup();
  delete state.sides.a.supplies.income;
  run(state, map, 'a', []);
  assert.equal(state.sides.a.supplies.ammo, 60 + DEFAULT_INCOME.ammo);
});

test('Abgeschnitten: Loren kommen nicht durch, Ladung bleibt im Depot, Abschnitt zehrt vom Vorrat, dann Moral', () => {
  const { map, state } = setup();
  state.cells['11,3'] = { trenchBlocked: true };
  ensureSupply(state, map, 'a');
  const g = state.groups.find((x) => x.id === 'a01');
  let r = run(state, map, 'a', [{ load: 'food', to: 'A' }]);
  assert.equal(state.sides.a.supplies.food, 60, 'Ladung bleibt im Depot');
  const blocked = r.log.find((e) => e.type === 'supply_blocked');
  assert.ok(blocked);
  assert.match(blocked.reason, /Abschnitt A.*Laufgraben verschüttet bei 12\/4/);
  assert.deepEqual(blocked.at, { x: 11, y: 3 });
  // Vorrat 6 Verpflegung: reicht drei Runden ohne Moralverlust
  for (let t = 2; t <= 3; t++) run(state, map, 'a', [{ load: 'food', to: 'A' }], t);
  assert.equal(state.sides.a.supply.sections.A.food, 0);
  assert.equal(g.morale, 70);
  // Runde 4: eiserne Ration
  r = run(state, map, 'a', [], 4);
  assert.ok(r.log.some((e) => e.type === 'iron_ration'));
  assert.equal(g.morale, 70);
  // Runde 5 und 6: Hunger, Moral sinkt immer schneller
  r = run(state, map, 'a', [], 5);
  assert.equal(g.hunger, 1);
  assert.equal(g.morale, 66);
  r = run(state, map, 'a', [], 6);
  assert.equal(g.morale, 60);
  assert.match(r.log.find((e) => e.type === 'hunger').reason, /abgeschnitten/);
  // Andere Abschnitte sind nicht abgeschnitten (sie bekommen nur nichts, weil der Plan nichts schickt)
  assert.ok(!r.log.some((e) => e.type === 'supply_blocked' && e.section !== 'A'));
  assert.ok(state.sides.a.supply.stats.cutTurns >= 6);
});

test('Munition aus: Moral sinkt, Gruppe ist als knapp markiert', () => {
  const { map, state } = setup();
  ensureSupply(state, map, 'a');
  state.sides.a.supply.sections.B.ammo = 0;
  const r = run(state, map, 'a', []);
  const g = state.groups.find((x) => x.id === 'a02');
  assert.equal(g.ammoLow, true);
  assert.equal(g.morale, 68);
  assert.ok(r.log.some((e) => e.type === 'ammo_short' && e.section === 'B'));
});

test('Verwundetenfluss: Sanitaetslore holt vier, beladene Lore einen, Rest wartet', () => {
  const { map, state } = setup();
  addWounded(state, map, 'a', { x: 11, y: 4 }, 6, 'a02');
  assert.equal(woundedCount(state.sides.a.supply.sections.B), 6);
  const r = run(state, map, 'a', [{ load: 'ammo', to: 'B' }, { load: 'medic', to: 'B' }]);
  const sup = state.sides.a.supply;
  assert.equal(woundedCount(sup.sections.B), 1);
  assert.equal(sup.hospital.reduce((n, h) => n + h.n, 0), WOUNDED_PER_MEDIC_CART + 1);
  assert.equal(sup.stats.woundedCarried, 5);
  assert.ok(r.log.some((e) => e.type === 'supply_delivered' && e.wounded === 5));
  // Ein Verwundeter wartet: Vertrauen sinkt
  assert.equal(state.sides.a.trust, 49);
});

test('Sanitaetskette: ohne Verbandsplatz dauert die Heilung laenger; Gruppe wird aufgefuellt und erfahrener', () => {
  for (const [buildings, turns] of [[[], HEAL_TURNS.none], [[{ id: 'vp', type: 'verbandsplatz', x: 2, y: 7 }], HEAL_TURNS.verbandsplatz]]) {
    const { map, state } = setup({ buildings });
    const g = state.groups.find((x) => x.id === 'a01');
    g.strength = g.size - 4;
    const xp = g.experience;
    addWounded(state, map, 'a', g.pos, 4, 'a01');
    run(state, map, 'a', [{ load: 'medic', to: 'A' }], 1);
    assert.equal(state.sides.a.supply.hospital[0].ready, 1 + turns);
    for (let t = 2; t < 1 + turns; t++) run(state, map, 'a', [], t);
    assert.equal(g.strength, g.size - 4, 'noch im Lazarett');
    const r = run(state, map, 'a', [], 1 + turns);
    assert.equal(g.strength, g.size);
    assert.equal(g.experience, Math.min(4, xp + 1));
    assert.match(r.log.find((e) => e.type === 'wounded_returned').reason, /kehren aus dem Lazarett zurück/);
    assert.equal(state.sides.a.supply.hospital.length, 0);
  }
});

test('Wartende Verwundete: ohne Sanitaeter sterben welche (deterministisch), mit Sanitaetern keiner', () => {
  const deaths = (withMedic, seed) => {
    const { map, state } = setup();
    if (withMedic) state.groups.find((x) => x.id === 'a03').type = 'medics';
    addWounded(state, map, 'a', { x: 11, y: 7 }, 20, 'a03');
    const r = run(state, map, 'a', [], 1, seed);
    return { left: woundedCount(state.sides.a.supply.sections.C), fallen: state.fallen, log: r.log };
  };
  const a = deaths(false, 3), b = deaths(false, 3);
  assert.deepEqual(a, b, 'gleicher Seed, gleiches Ergebnis');
  assert.ok(a.left < 20);
  assert.equal(a.fallen[0].count, 20 - a.left);
  assert.equal(a.fallen[0].cause, 'wounds');
  const m = deaths(true, 3);
  assert.equal(m.left, 20);
  assert.match(m.log.find((e) => e.type === 'wounded_waiting').reason, /Sanitäter halten sie am Leben/);
});

test('Vorschlag: Wagen gehen zum kuerzesten Vorrat, Verwundete bekommen eine Sanitaetslore, Abgeschnittene nichts', () => {
  const { map, state } = setup();
  ensureSupply(state, map, 'a');
  state.sides.a.supply.sections.B.food = 0;
  addWounded(state, map, 'a', { x: 11, y: 7 }, 3, 'a03');
  state.cells['11,1'] = { trenchBlocked: true };
  state.cells['11,2'] = { trenchBlocked: true };
  const plan = suggestPlan(map, state, 'a');
  assert.equal(plan.length, 4);
  assert.deepEqual(plan[0], { load: 'medic', to: 'C' });
  assert.deepEqual(plan[1], { load: 'food', to: 'B' });
  assert.ok(plan.every((w) => w.to !== 'A'));
  assert.deepEqual(standingPlan(map, state, 'a'), plan);
});

test('Vorschau: zaehlt Lieferungen, Reichweite in Runden und Verwundete zurueck, ohne den Zustand zu aendern', () => {
  const { map, state } = setup();
  addWounded(state, map, 'a', { x: 11, y: 4 }, 2, 'a02');
  deepFreeze(state);
  const p = planPreview(map, state, 'a', [{ load: 'food', to: 'B' }, { load: 'food', to: 'B' }, { load: 'medic', to: 'B' }]);
  const b = p.sections.find((s) => s.id === 'B');
  assert.equal(b.delivered.food, 2 * CART_LOAD);
  assert.equal(b.rounds.food, Math.floor((6 + 2 * CART_LOAD) / UPKEEP.food));
  assert.equal(b.woundedBack, 2);
  assert.equal(p.returning, 1);
  assert.equal(p.used, 3);
  assert.deepEqual(b.groups.map((g) => g.id), ['a02']);
});

test('Antippen wechselt Ladung und Ziel im Kreis', () => {
  assert.equal(nextLoad('ammo'), 'food');
  assert.equal(nextLoad('medic'), 'ammo');
  const map = testMap();
  assert.equal(nextTarget(map, 'A'), 'B');
  assert.equal(nextTarget(map, 'C'), 'A');
});

test('takeStock gibt nie mehr heraus, als da ist', () => {
  const { map, state } = setup();
  assert.equal(takeStock(state, map, 'a', 'A', 'ammo', 100), 6);
  assert.equal(takeStock(state, map, 'a', 'A', 'ammo', 1), 0);
  assert.equal(takeStock(state, map, 'a', 'Z', 'ammo', 1), 0);
});

test('Runde: Lorenplan als Seitenbefehl, gilt weiter, ungueltiger Plan wird verworfen, deterministisch', () => {
  const { map } = setup();
  const env = { map };
  const start = createInitialState(map, structuredClone(SCEN), 7);
  const plan = { type: 'supply_plan', wagons: [{ load: 'food', to: 'C' }, { load: 'ammo', to: 'C' }] };
  const r1 = resolveTurn(start, [plan], [], 7, 1, env);
  const r1b = resolveTurn(start, [structuredClone(plan)], [], 7, 1, env);
  assert.deepEqual(r1, r1b);
  assert.deepEqual(r1.state.sides.a.supply.plan, plan.wagons);
  assert.ok(r1.log.some((e) => e.phase === 'supply' && e.type === 'supply_delivered' && e.section === 'C'));
  for (const e of r1.log) assert.ok(isValidEvent(e));
  // Naechste Runde ohne Plan: der alte gilt weiter
  const r2 = resolveTurn(r1.state, [], [], 7, 2, env);
  assert.deepEqual(r2.state.sides.a.supply.plan, plan.wagons);
  // Ungueltig: Halten-Ersatz gibt es nicht, nur eine Meldung
  const bad = resolveTurn(r1.state, [{ type: 'supply_plan', wagons: [{ load: 'gold', to: 'A' }] }], [], 7, 2, env);
  assert.ok(bad.log.some((e) => e.type === 'order_invalid' && /unbekannte Ladung/.test(e.reason)));
  // Zwei Plaene: der zweite wird verworfen
  const two = resolveTurn(r1.state, [plan, { ...plan, wagons: [] }], [], 7, 2, env);
  assert.ok(two.log.some((e) => e.type === 'order_invalid' && /schon einen Lorenplan/.test(e.reason)));
  // Gefechtsrunde: kein Lorenplan
  const battle = structuredClone(start);
  battle.turnKind = 'battle';
  const rb = resolveTurn(battle, [plan], [], 7, 1, env);
  assert.ok(rb.log.some((e) => e.type === 'order_invalid' && /Stellungsrunde/.test(e.reason)));
  // Seite b (KI, kein Depot) laeuft mit
  assert.ok(r1.state.sides.b.supply);
});

test('Asse-Karte: alle drei Abschnitte der Seite a sind ueber Gleis und Laufgraeben verbunden', () => {
  const asse = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
  const scen = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url)));
  const state = createInitialState(asse, scen, 1);
  const net = supplyNetwork(asse, state, 'a');
  assert.deepEqual(net.sections.map((s) => s.connected), [true, true, true]);
  for (const s of net.sections) assert.ok(s.route.length > 5);
});
