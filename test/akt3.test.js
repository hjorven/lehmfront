// P24: Akt 3 "Materialschlacht". Gas mit Wind, Waffenruhe, Feldgeschuetz, Flammenwerfer, Flieger, Scheinbatterien,
// sechs Missionen mit Varianten, KI-Bausteine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, cellAt } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import { validateOrder } from '../js/orders.js';
import { isValidEvent } from '../js/events.js';
import { decide } from '../js/ai.js';
import { createRng } from '../js/rng.js';
import {
  windOf, windText, turnDir, forecastSure, makeForecast, rollWind, driftStep, driftSteps, predictDrift, gasMap, writeGas,
  windTowardEnemy, windWarning, shellCells,
} from '../js/gas.js';
import { cylinderProblem, lateChance, hasMasks } from '../js/phases/gas.js';
import { flameProblem } from '../js/phases/flame.js';
import { reconProblem, decoyProblem } from '../js/phases/air.js';
import { truceOf, truceProblem, recoverProblem, lyingCount, addLying, takeLying, breaksTruce, truceVeto } from '../js/truce.js';
import { fireOdds } from '../js/phases/fire.js';
import { WIND, GAS, FLAME, TRUCE } from '../js/config/akt3.js';
import {
  AKT3_SCENARIOS, judgeA3m1, judgeA3m2, judgeA3m3, judgeA3m4, judgeA3m5, judgeA3m6, prepareAkt3, FIRST_LINE, RESCUE_ID, lossRatio,
} from '../js/config/missions-akt3.js';
import { scenarioForMission, prepareMission, missionBuilt } from '../js/config/missions.js';
import { runMission } from '../js/ai/mission-match.js';
import { buildKroning } from '../tools/maps/kroning.mjs';
import { buildAkt3 } from '../tools/scenarios/akt3.mjs';
import '../js/phases/index.js';

const MAP_JSON = JSON.parse(readFileSync(new URL('../data/maps/kroning.json', import.meta.url)));
const MAP = loadMap(MAP_JSON);
const scenario = (id) => JSON.parse(readFileSync(new URL(`../data/scenarios/${id}.json`, import.meta.url)));
const start = (id, seed = 1) => {
  const sc = scenario(id);
  return initEtappen(createInitialState(MAP, sc, seed), MAP, sc);
};
const env = { map: MAP };
const g = (state, id) => state.groups.find((x) => x.id === id);

function play(state, rounds, orders, seed = 1) {
  const logs = [];
  for (let i = 0; i < rounds && !state.result; i++) {
    const o = orders(state, i) ?? {};
    const r = resolveTurn(state, o.a ?? [], o.b ?? [], seed, state.turn, env);
    state = r.state;
    logs.push(...r.log);
  }
  return { state, logs };
}

// ------------------------------------------------------------------ Generatoren und Szenarien

test('P24: Karte Kroning und Akt-3-Szenarien entsprechen ihren Generatoren', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildKroning())), MAP_JSON);
  const all = buildAkt3();
  assert.equal(Object.keys(all).length, 10);
  for (const [id, sc] of Object.entries(all)) {
    assert.deepEqual(JSON.parse(JSON.stringify(sc)), scenario(id), id);
    const st = start(id);
    assert.equal(st.scenario.act, 3, id);
    assert.ok(st.scenario.features.length, id);
  }
});

test('P24: Missionen haben Szenarien, Varianten nach Flags', () => {
  for (const m of Object.keys(AKT3_SCENARIOS)) assert.ok(missionBuilt(m), m);
  assert.equal(scenarioForMission('a3m4', { flags: [] }), 'akt3-m4');
  assert.equal(scenarioForMission('a3m4', { flags: ['befehl117_umgedeutet'] }), 'akt3-m4-graben');
  assert.equal(scenarioForMission('a3m4', { flags: ['befehl117_verweigert'] }), 'akt3-m4-halten');
  assert.equal(scenarioForMission('a3m5', { flags: ['waffenruhe_angenommen'] }), 'akt3-m5-ruhe');
  assert.equal(scenarioForMission('a3m5', { flags: ['waffenruhe_abgelehnt'] }), 'akt3-m5-halten');
  assert.equal(scenarioForMission('a3m5', { flags: ['waffenruhe_geduldet'] }), 'akt3-m5');
});

test('P24: Szenario-Aufbau: Masken, Gasvorrat, Flieger, Waffenruhe, Gruppe im Gas', () => {
  const m2 = start('akt3-m2');
  assert.ok(hasMasks(m2, 'a') && hasMasks(m2, 'b'));
  assert.equal(m2.sides.b.gas.shells, 1);
  assert.equal(g(m2, RESCUE_ID).gasTurn, 0);
  assert.ok(m2.weather.windForecast, 'Vorhersage liegt an');
  const m3 = start('akt3-m3');
  assert.equal(m3.sides.a.air.planes, 1);
  const m5 = start('akt3-m5');
  assert.equal(truceOf(m5).status, 'tolerated');
  assert.equal(m5.sides.a.truce.status, m5.sides.b.truce.status, 'beide Seiten tragen dieselbe Waffenruhe');
  assert.ok(lyingCount(m5, 'a') > 0, 'eigene Verwundete liegen draussen');
  assert.equal(truceOf(start('akt3-m5-halten')), null);
});

// ------------------------------------------------------------------ Wind

test('P24: Wind: Richtung drehen, Text, Vorhersage unsicherer am Nachmittag', () => {
  assert.equal(turnDir('w', 1), 'nw');
  assert.equal(turnDir('n', -1), 'nw');
  assert.equal(turnDir('w', 2), 'n');
  assert.equal(windText({ dir: 'e', speed: 0 }), 'Windstille');
  assert.match(windText({ dir: 'e', speed: 1 }), /Ostwind/);
  // morgens (naechste Runde ist die Nacht) sicherer als abends (naechste Runde ist der Tag)
  const morning = forecastSure({ clock: { hour: 6 }, weather: { kind: 'clear' } }, false);
  const evening = forecastSure({ clock: { hour: 18 }, weather: { kind: 'clear' } }, false);
  assert.equal(morning, WIND.surePosition);
  assert.equal(evening, WIND.surePosition + WIND.afternoon);
  assert.ok(forecastSure({ clock: { hour: 6 }, weather: { kind: 'rain' } }, false) < morning);
  assert.equal(forecastSure({}, true), WIND.sureBattle);
});

test('P24: Wind hält sich meistens an die Vorhersage, sonst dreht er', () => {
  const f = { dir: 'w', speed: 1, sure: 70 };
  let held = 0;
  const rng = createRng(5);
  for (let i = 0; i < 400; i++) {
    const r = rollWind(rng, f, { dir: 'w', speed: 1 });
    if (r.held) { held++; assert.deepEqual(r.wind, { dir: 'w', speed: 1 }); } else assert.notEqual(r.wind.dir, 'w');
  }
  assert.ok(held > 240 && held < 320, `gehalten ${held} von 400`);
  const fc = makeForecast(createRng(2), { dir: 'w', speed: 3 }, 70);
  assert.ok(fc.speed <= WIND.maxSpeed && fc.speed >= 0 && fc.sure === 70);
});

test('P24: Wind gilt für die Seite: zum Feind, zu den eigenen Linien, längs', () => {
  assert.equal(windTowardEnemy({ dir: 'w', speed: 1 }, 'a'), true);
  assert.equal(windTowardEnemy({ dir: 'w', speed: 1 }, 'b'), false);
  assert.equal(windTowardEnemy({ dir: 'w', speed: 0 }, 'a'), false);
  assert.equal(windWarning({ dir: 'w', speed: 1 }, 'a'), null);
  assert.match(windWarning({ dir: 'e', speed: 1 }, 'a'), /eigenen Linien/);
  assert.match(windWarning({ dir: 'n', speed: 1 }, 'a'), /entlang/);
  assert.match(windWarning({ dir: 'n', speed: 0 }, 'a'), /Windstille/);
});

// ------------------------------------------------------------------ Gas

test('P24: Gas treibt mit dem Wind und bleibt in Senken und Gräben länger', () => {
  const st = start('akt3-m2');
  const m = new Map([['20,30', { d: 3, by: 'a' }]]);
  const next = driftStep(m, { dir: 'w', speed: 2 }, MAP, st, null);
  assert.ok(next.has('21,30'), 'nach Osten getrieben');
  assert.equal(next.get('21,30').d, 3);
  assert.ok(next.has('21,29') && next.has('21,31'), 'seitlich dünner');
  // Windstille: bleibt liegen und breitet sich aus
  const calm = driftStep(m, { dir: 'w', speed: 0 }, MAP, st, null);
  assert.ok(calm.has('20,30'));
  // In einem eigenen Graben bleibt ein Rest liegen
  const tk = Object.keys(st.cells).find((k) => st.cells[k]?.trench?.side === 'own');
  const tm = driftStep(new Map([[tk, { d: 3, by: 'b' }]]), { dir: 'w', speed: 1 }, MAP, st, null);
  assert.equal(tm.get(tk)?.d, 2, 'im Graben bleibt Gas liegen');
  assert.equal(driftSteps({ speed: 0 }, 'battle', 1), 0);
  assert.equal(driftSteps({ speed: 2 }, 'position', 1), GAS.stepsPosition + 2 * GAS.stepsPerSpeed);
});

test('P24: Vorschau der Wolke folgt dem vorhergesagten Wind', () => {
  const st = start('akt3-m6');
  const p = predictDrift(MAP, st, shellCells({ x: 44, y: 18 }, MAP), { dir: 'w', speed: 1 }, 4);
  assert.ok(p.path.length >= 2);
  assert.ok(p.path[p.path.length - 1].x > 44, 'die Wolke zieht nach Osten');
  const back = predictDrift(MAP, st, shellCells({ x: 44, y: 18 }, MAP), { dir: 'e', speed: 1 }, 4);
  assert.ok(back.path[back.path.length - 1].x < 44);
});

test('P24: Gasflaschen nur für Pioniere im eigenen Graben, mit Vorrat', () => {
  const st = start('akt3-m2');
  const pio = st.groups.find((x) => x.side === 'a' && x.type === 'pioneers');
  st.sides.a.gas = { cylinders: 2, shells: 0 };
  assert.equal(cylinderProblem(st, MAP, pio), null);
  const rif = st.groups.find((x) => x.side === 'a' && x.type === 'rifles');
  assert.match(cylinderProblem(st, MAP, rif), /Pioniere/);
  st.sides.a.gas.cylinders = 0;
  assert.match(cylinderProblem(st, MAP, pio), /keine Gasflaschen/);
  assert.match(cylinderProblem({ ...st, scenario: { ...st.scenario, features: [] } }, MAP, pio), /Akt 3/);
});

test('P24: Masken zu spät: nachts eher, mit Gasalarm seltener', () => {
  const grp = { inDugout: false, traits: [] };
  const night = lateChance({ night: true }, grp);
  const day = lateChance({ night: false }, grp);
  assert.ok(night > day);
  assert.ok(lateChance({ night: true }, grp, { alarm: true }) < night);
  assert.ok(lateChance({ night: true }, { ...grp, inDugout: true }) > night);
});

test('P24: Abgeblasenes Gas trifft Gruppen ohne Masken schwer, mit Masken leicht; die Karte vergilbt', () => {
  let without = 0, withMask = 0;
  for (let seed = 1; seed <= 6; seed++) {
    for (const masks of [false, true]) {
      const st = start('akt3-m6', seed);
      st.weather = { ...st.weather, fixed: true, wind: { dir: 'w', speed: 3 }, windFixed: true, windForecast: { dir: 'w', speed: 3, sure: 100 } };
      st.sides.a.gas = { cylinders: 1, shells: 0 };
      st.sides.b.masks = masks;
      const pio = st.groups.find((x) => x.side === 'a' && x.type === 'pioneers');
      // Pioniere stehen in der Sturmausgangsstellung, der Gegner sechs Felder oestlich
      pio.pos = { x: 35, y: 20 };
      const { state, logs } = play(st, 1, () => ({ a: [{ group: pio.id, type: 'gas' }] }), seed);
      assert.ok(logs.some((e) => e.type === 'gas_released' && e.public));
      for (const e of logs) assert.ok(isValidEvent(e), `Ereignis ${e.type} ohne reason/at`);
      const lost = logs.filter((e) => e.type === 'losses' && e.cause === 'gas' && e.side === 'b').reduce((n, e) => n + e.amount, 0);
      if (masks) withMask += lost; else without += lost;
      assert.ok(Object.values(state.cells).some((c) => Number.isInteger(c?.gasStain)), 'vergilbte Felder');
    }
  }
  assert.ok(without > withMask, `ohne Masken ${without}, mit ${withMask}`);
});

test('P24: Gas im Zustand schreiben räumt alte Wolken und merkt sich den Fleck', () => {
  const st = { cells: { '1,1': { gas: 2, gasBy: 'a' }, '2,2': { trench: { side: 'own' } } } };
  writeGas(st, new Map([['2,2', { d: 3, by: 'b' }]]), 4);
  assert.equal(st.cells['1,1'], undefined);
  assert.equal(st.cells['2,2'].gas, 3);
  assert.equal(st.cells['2,2'].gasStain, 4);
  assert.ok(st.cells['2,2'].trench);
  assert.equal(gasMap(st).size, 1);
});

// ------------------------------------------------------------------ Feldgeschuetz und Flammenwerfer

test('P24: Feldgeschütz schießt durch Sandsack und Graben wie durch einen Trichter', () => {
  const st = start('akt3-m6');
  const gun = { ...st.groups.find((x) => x.side === 'a' && x.type === 'fieldgun'), pos: { x: 37, y: 20 } };
  const rif = { ...st.groups.find((x) => x.side === 'a' && x.type === 'rifles'), pos: { x: 37, y: 20 } };
  const ty = 20;
  let tx = 40;
  while (cellAt(MAP, tx, ty)?.trench?.side !== 'enemy') tx++;
  const target = { x: tx, y: ty };
  gun.pos = rif.pos = { x: tx - 3, y: ty };
  const og = fireOdds(st, MAP, gun, target, 'b', { needLos: false });
  const or = fireOdds(st, MAP, rif, target, 'b', { needLos: false });
  assert.equal(og.cover, 'crater');
  assert.notEqual(or.cover, 'crater');
  assert.ok(og.p > or.p * 0.9);
});

test('P24: Flammenwerfer: Reichweite, Tanks, nur der eigene Trupp', () => {
  const fw = { type: 'flamethrowers', pos: { x: 10, y: 10 }, inDugout: false };
  assert.equal(flameProblem(fw, { x: 12, y: 10 }), null);
  assert.match(flameProblem(fw, { x: 13, y: 10 }), /zu weit/);
  assert.match(flameProblem(fw, { x: 10, y: 10 }), /eigene Feld/);
  assert.match(flameProblem({ ...fw, fuel: 0 }, { x: 11, y: 10 }), /leer/);
  assert.match(flameProblem({ ...fw, type: 'rifles' }, { x: 11, y: 10 }), /Flammenwerfer/);
});

test('P24: Flammenstoß in den Unterstand: hohe Verluste, Aufgabe oder Flucht aus dem Unterstand', () => {
  let outcomes = new Set();
  for (let seed = 1; seed <= 10; seed++) {
    const st = start('akt3-m6', seed);
    st.turnKind = 'battle';
    st.battle = { round: 1 };
    const fw = st.groups.find((x) => x.side === 'a' && x.type === 'flamethrowers');
    const victim = st.groups.find((x) => x.side === 'b' && x.type === 'rifles');
    fw.pos = { x: victim.pos.x - 1, y: victim.pos.y };
    victim.inDugout = true;
    victim.strength = 6;
    const r = resolveTurn(st, [{ group: fw.id, type: 'flame', target: { ...victim.pos } }], [], seed, st.turn, env);
    const types = r.log.map((e) => e.type);
    assert.ok(types.includes('flame'));
    const v = g(r.state, victim.id);
    assert.ok(v.status === 'lost' || v.strength <= 4, 'mindestens zwei Ausfälle');
    assert.equal(v.inDugout, false);
    if (types.includes('prisoners')) outcomes.add('aufgabe');
    if (types.includes('dugout_cleared')) outcomes.add('flucht');
    assert.ok(g(r.state, fw.id).fuel <= FLAME.fuel - 1);
    for (const e of r.log) assert.ok(isValidEvent(e), e.type);
    assert.ok(r.state.cells[victim.pos.x + ',' + victim.pos.y]?.scorched >= 0, 'angesengt');
  }
  assert.ok(outcomes.size >= 1);
});

// ------------------------------------------------------------------ Flieger und Scheinbatterien

test('P24: Flieger: nicht nachts, nicht bei Regen, nur mit Flieger', () => {
  const st = start('akt3-m3');
  assert.equal(reconProblem(st, 'a', { x: 50, y: 20 }), null);
  assert.match(reconProblem({ ...st, weather: { ...st.weather, kind: 'rain' } }, 'a', { x: 50, y: 20 }), /Wetter/);
  assert.match(reconProblem(st, 'a', { x: 500, y: 20 }), /Karte/);
  const none = structuredClone(st);
  none.sides.a.air.planes = 0;
  assert.match(reconProblem(none, 'a', { x: 50, y: 20 }), /kein Flieger/);
});

test('P24: Attrappen nur hinter der eigenen Linie, Tarnnetz versteckt das Depot vor dem Flieger', () => {
  const st = start('akt3-m3');
  assert.equal(decoyProblem(st, MAP, 'a', { kind: 'decoy', x: 9, y: 28 }), null);
  assert.match(decoyProblem(st, MAP, 'a', { kind: 'decoy', x: 36, y: 20 }), /eigenen Linie/);
  // Ohne Netz sieht der feindliche Flieger das Depot, mit Netz nicht
  const recon = { type: 'recon', target: { x: 5, y: 16 } };
  const open = resolveTurn(start('akt3-m3', 2), [], [recon], 2, 1, env);
  const hidden = resolveTurn(start('akt3-m3', 2), [{ type: 'decoy', builds: [{ kind: 'camo', x: 3, y: 15 }] }], [recon], 2, 1, env);
  const spotted = (r) => r.log.some((e) => e.type === 'depot_spotted') || r.log.some((e) => e.type === 'plane_lost');
  const lostPlane = (r) => r.log.some((e) => e.type === 'plane_lost');
  if (!lostPlane(open)) assert.ok(open.state.sides.a.depotSpotted, 'Depot gesehen');
  assert.ok(!hidden.state.sides.a.depotSpotted, 'Depot unter dem Netz');
  assert.ok(hidden.log.some((e) => e.type === 'camo_built'));
  assert.ok(spotted(open));
});

test('P24: Lask beschießt die Attrappe und meldet eine schweigende Batterie', () => {
  let shelled = 0;
  for (let seed = 1; seed <= 4; seed++) {
    const r = runMission({ map: MAP, scenario: scenario('akt3-m3'), mission: 'a3m3', seed, keepLog: true });
    shelled += r.events.decoy_shelled ?? 0;
    assert.ok(!r.log.some((rd) => rd.log.some((e) => e.type === 'decoy_shelled' && e.side === 'b' && !e.secret)), 'Lask erfährt nicht, dass es Holz war');
  }
  assert.ok(shelled > 0);
});

// ------------------------------------------------------------------ Waffenruhe

test('P24: Waffenruhe: anbieten, annehmen, ablehnen', () => {
  const st = start('akt3-m5-halten');
  assert.equal(truceProblem(st, 'a', { answer: 'offer' }), null);
  assert.match(truceProblem(st, 'a', { answer: 'accept' }), /kein Angebot/);
  assert.equal(truceProblem(st, 'a', { answer: 'none' }), null);
  // a bietet an, b nimmt in der naechsten Runde an
  const r1 = resolveTurn(st, [{ type: 'truce', answer: 'offer' }], [], 1, st.turn, env);
  assert.ok(r1.log.some((e) => e.type === 'truce_offer'));
  assert.equal(truceOf(r1.state).status, 'offered');
  assert.match(truceProblem(r1.state, 'a', { answer: 'accept' }), /eigene Angebot/);
  const s2 = r1.state.turnKind === 'battle' ? play(r1.state, 20, () => ({})).state : r1.state;
  if (s2.turnKind === 'position' && truceOf(s2)?.status === 'offered') {
    const r2 = resolveTurn(s2, [], [{ type: 'truce', answer: 'accept' }], 1, s2.turn, env);
    assert.ok(r2.log.some((e) => e.type === 'truce_begin'));
    assert.equal(truceOf(r2.state).status, 'active');
    assert.ok(r2.log.some((e) => e.type === 'recovered' && e.how === 'truce'), 'beide Seiten bergen');
    assert.ok(r2.state.sides.b.trust > s2.sides.b.trust || r2.state.sides.b.trust === 100);
  }
});

test('P24: Wer in die Waffenruhe schießt, bricht sie und schämt sich', () => {
  const st = start('akt3-m5-ruhe');
  const rif = st.groups.find((x) => x.side === 'a' && x.type === 'rifles');
  assert.equal(breaksTruce({ type: 'fire' }), true);
  assert.equal(breaksTruce({ type: 'fire_plan', plans: [{ kind: 'barrage' }] }), false);
  assert.equal(breaksTruce({ type: 'fire_plan', plans: [{ kind: 'harass' }] }), true);
  const r = resolveTurn(st, [{ group: rif.id, type: 'attack', path: [{ x: rif.pos.x + 1, y: rif.pos.y }] }], [], 1, st.turn, env);
  assert.ok(r.log.some((e) => e.type === 'truce_broken' && e.by === 'a'));
  assert.equal(truceOf(r.state).brokenBy, 'a');
  assert.ok(r.state.sides.a.trust < st.sides.a.trust || st.sides.a.trust === undefined);
  const j = judgeA3m5({ state: r.state, rounds: [{ kind: 'position', log: r.log }], side: 'a', final: true });
  assert.ok(j.flags.includes('waffenruhe_gebrochen'));
});

test('P24: Die KI schießt nicht in eine laufende Waffenruhe', () => {
  const st = start('akt3-m5-ruhe');
  const view = viewFor(st, [], 'b', env);
  assert.equal(truceVeto(view, { type: 'fire', group: 'b01' }, MAP, 'b'), true);
  assert.equal(truceVeto(view, { type: 'recover', group: 'b01', target: { x: 36, y: 20 } }, MAP, 'b'), false);
  const d = decide(view, { map: MAP, seed: 1, side: 'b', difficulty: 'lask', doctrine: 'material' });
  assert.ok(!d.orders.some((o) => breaksTruce(o)), d.orders.map((o) => o.type).join());
});

test('P24: Bergen: nur Sanitäter, nur eigene Verwundete, in Reichweite', () => {
  const st = start('akt3-m5');
  const med = st.groups.find((x) => x.side === 'a' && x.type === 'medics');
  const cell = Object.keys(st.cells).map((k) => ({ k, c: st.cells[k] })).find((e) => e.c?.lying?.a > 0);
  const [x, y] = cell.k.split(',').map(Number);
  med.pos = { x: x - 2, y };
  assert.equal(recoverProblem(st, MAP, med, { x, y }), null);
  assert.match(recoverProblem(st, MAP, { ...med, type: 'rifles' }, { x, y }), /Sanitäter/);
  assert.match(recoverProblem(st, MAP, { ...med, pos: { x: x - 9, y } }, { x, y }), /zu weit/);
  const empty = { x: 1, y: 1 };
  assert.match(recoverProblem(st, MAP, { ...med, pos: { x: 2, y: 1 } }, empty), /niemand/);
  const s2 = structuredClone(st);
  addLying(s2, { x: 1, y: 1 }, 'a', 2);
  assert.equal(takeLying(s2, { x: 1, y: 1 }, 'a', 5), 2);
  assert.equal(s2.cells['1,1'], undefined);
});

// ------------------------------------------------------------------ Missionsziele

test('P24: Missionsziele a3m1 bis a3m6', () => {
  const pos = (n) => Array.from({ length: n }, () => ({ kind: 'position', log: [] }));
  const m1 = start('akt3-m1');
  assert.equal(judgeA3m1({ state: m1, rounds: [], side: 'a', final: false }), null);
  const plan3 = [{ kind: 'position', log: [1, 2, 3].map(() => ({ type: 'fire_plan', side: 'a' })) }];
  assert.equal(judgeA3m1({ state: m1, rounds: plan3, side: 'a', final: true }).orderMet, true);
  // a3m2: Gruppe verloren = Niederlage, zurueck im Graben = Sieg
  const m2 = start('akt3-m2');
  const lost = structuredClone(m2);
  g(lost, RESCUE_ID).status = 'lost';
  assert.equal(judgeA3m2({ state: lost, rounds: [], side: 'a', final: false }).outcome, 'niederlage');
  const home = structuredClone(m2);
  g(home, RESCUE_ID).pos = { x: 29, y: 7 };
  assert.equal(judgeA3m2({ state: home, rounds: pos(1), side: 'a', final: false }), null, 'erst nach der Lore');
  assert.equal(judgeA3m2({ state: home, rounds: pos(2), side: 'a', final: false }).outcome, 'sieg');
  // a3m3: Depot entdeckt = Niederlage
  const m3 = start('akt3-m3');
  const spotted = structuredClone(m3);
  spotted.sides.a.depotSpotted = 2;
  assert.equal(judgeA3m3({ state: spotted, rounds: pos(1), side: 'a', final: false }).outcome, 'niederlage');
  const fooled = structuredClone(m3);
  fooled.sides.a.decoys = [{ id: 'attrappe1', hits: 1 }, { id: 'attrappe2', hits: 2 }];
  assert.equal(judgeA3m3({ state: fooled, rounds: pos(3), side: 'a', final: false }).orderMet, true);
  // a3m4: Gehoeft besetzt
  const m4 = start('akt3-m4');
  const taken = structuredClone(m4);
  taken.groups = taken.groups.filter((x) => !(x.side === 'b' && Math.abs(x.pos.x - 35) <= 1 && Math.abs(x.pos.y - 26) <= 1));
  taken.groups.find((x) => x.side === 'a').pos = { x: 35, y: 26 };
  assert.equal(judgeA3m4({ state: taken, rounds: pos(1), side: 'a', final: false }).outcome, 'sieg');
  assert.equal(judgeA3m4({ state: m4, rounds: pos(6), side: 'a', final: false }).outcome, 'niederlage');
  assert.equal(judgeA3m4({ state: start('akt3-m4-halten'), rounds: pos(6), side: 'a', final: false }).outcome, 'sieg');
  // a3m5: alle geborgen
  const m5 = start('akt3-m5');
  const all = structuredClone(m5);
  for (const k of Object.keys(all.cells)) if (all.cells[k]?.lying) delete all.cells[k].lying;
  all.sides.a.recovered = 9;
  assert.equal(judgeA3m5({ state: all, rounds: pos(1), side: 'a', final: false }).orderMet, true);
  // a3m6: erste Linie genommen
  const m6 = start('akt3-m6');
  assert.equal(judgeA3m6({ state: m6, rounds: pos(4), side: 'a', final: false }).outcome, 'niederlage');
  const won = structuredClone(m6);
  for (const p of FIRST_LINE.slice(0, 8)) won.cells[p.x + ',' + p.y] = { ...(won.cells[p.x + ',' + p.y] ?? {}), trench: { side: 'own', kind: 'fire', level: 1, captured: true } };
  won.turn = 16;
  assert.deepEqual(judgeA3m6({ state: won, rounds: pos(2), side: 'a', final: false }).outcome, 'sieg');
  assert.equal(lossRatio(m6, 'a', []), 0);
});

test('P24: Gas-Entscheidung wirkt in a3m6: Batterien schweigen oder die erste Linie ist geschwächt', () => {
  const st = start('akt3-m6');
  const bat = prepareAkt3('a3m6', st, { flags: ['gas_batterien'] });
  const zelva = bat.sides.b.artillery.batteries.filter((b) => b.type === 'feldhaubitzen');
  assert.ok(zelva.length && zelva.every((b) => b.silenced >= 2));
  const gr = prepareAkt3('a3m6', st, { flags: ['gas_abgeblasen'] });
  const front = (s) => s.groups.filter((x) => x.side === 'b' && x.pos.x <= 43);
  assert.ok(front(gr).every((x, i) => x.strength < front(st)[i].strength));
  assert.ok(FIRST_LINE.some((p) => Number.isInteger(gr.cells[p.x + ',' + p.y]?.gasStain)), 'die Karte erinnert sich');
  assert.ok(gr.sides.a.reports.includes('feuerwalze'));
  // prepareMission ruft Akt 2 und Akt 3 nacheinander
  const pm = prepareMission('a3m6', st, { flags: [] }, 'a');
  assert.ok(pm.sides.a.reports.includes('stahlhelme'));
});

// ------------------------------------------------------------------ Simulator

test('P24: Missionen im Simulator sind deterministisch, gewinnbar und verlierbar', () => {
  const run = (mission, seed, flags = [], passive = false) => runMission({ map: MAP, scenario: scenario(scenarioForMission(mission, { flags })), mission, seed, flags, passive });
  const a = run('a3m2', 2), b = run('a3m2', 2);
  assert.equal(a.outcome, b.outcome);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.outcome, 'sieg', a.why);
  assert.equal(run('a3m2', 2, [], true).outcome, 'niederlage');
  assert.equal(run('a3m3', 1).outcome, 'sieg');
  assert.equal(run('a3m3', 1, [], true).outcome, 'niederlage');
  assert.equal(run('a3m4', 1).outcome, 'sieg');
  assert.equal(run('a3m4', 1, [], true).outcome, 'niederlage');
  assert.equal(run('a3m5', 1).outcome, 'sieg');
  assert.equal(run('a3m5', 1, [], true).outcome, 'niederlage');
});

test('P24: Befehle der Mechaniken werden geprüft', () => {
  const st = start('akt3-m6');
  st.turnKind = 'battle';
  st.battle = { round: 1 };
  const fw = st.groups.find((x) => x.side === 'a' && x.type === 'flamethrowers');
  assert.equal(validateOrder({ group: fw.id, type: 'flame', target: { x: fw.pos.x + 2, y: fw.pos.y } }, st, 'a', env), null);
  assert.ok(validateOrder({ group: fw.id, type: 'flame', target: { x: fw.pos.x + 5, y: fw.pos.y } }, st, 'a', env));
  const ps = start('akt3-m3');
  assert.equal(validateOrder({ type: 'recon', target: { x: 50, y: 20 } }, ps, 'a', env), null);
  assert.equal(validateOrder({ type: 'decoy', builds: [] }, ps, 'a', env), null);
  assert.ok(validateOrder({ type: 'decoy', builds: [{ kind: 'decoy', x: 9, y: 28 }, { kind: 'decoy', x: 9, y: 33 }, { kind: 'camo', x: 3, y: 15 }] }, ps, 'a', env));
  assert.ok(TRUCE.offerWounded > 0 && GAS.maxDensity === 3);
});

test('P24: Wer anbietet, bricht die Waffenruhe nicht in der Runde, in der sie angenommen wird', () => {
  const st = start('akt3-m5-halten');
  const s = resolveTurn(st, [{ type: 'truce', answer: 'offer' }], [], 1, st.turn, env).state;
  assert.equal(s.turnKind, 'position');
  assert.equal(truceOf(s).status, 'offered');
  const rif = s.groups.find((x) => x.side === 'a' && x.type === 'rifles' && x.status !== 'lost');
  const r = resolveTurn(s, [{ group: rif.id, type: 'attack', path: [{ x: rif.pos.x + 1, y: rif.pos.y }] }], [{ type: 'truce', answer: 'accept' }], 1, s.turn, env);
  assert.ok(r.log.some((e) => e.type === 'truce_begin'));
  assert.ok(!r.log.some((e) => e.type === 'truce_broken'));
  // Die KI laesst sich im Gefecht von einem offenen Angebot nicht laehmen
  const bv = viewFor({ ...s, turnKind: 'battle' }, [], 'b', env);
  assert.equal(truceVeto(bv, { type: 'fire', group: 'b01' }, MAP, 'b'), false);
});
