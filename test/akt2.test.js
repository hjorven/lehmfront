// P23: Akt 2. Sappen, Stollen und Horchposten, Stosstrupps, Offiziere und Veteranen, Doktrinen, Missionsziele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, cellAt } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import { isValidEvent } from '../js/events.js';
import { validateOrder } from '../js/orders.js';
import { registerModifier, unregisterModifier, factorFor, bonusFor, flagFor } from '../js/modifiers.js';
import { checkSap, checkTunnel, tunnelRate, tunnelCellWork, listenChance, featureOn, sapCellWork } from '../js/underground.js';
import { raidProblem } from '../js/phases/raid.js';
import { officerFallChance, earnedTrait } from '../js/veterans.js';
import { OFFICER, DEEDS, MAX_TRAITS, SAP } from '../js/config/akt2.js';
import {
  judgeA2m1, judgeA2m2, judgeA2m3, judgeA2m4, judgeA2m6, prepareAkt2, doctrineFromFlags, CRATER, HEUWAGEN,
} from '../js/config/missions-akt2.js';
import { scenarioForMission } from '../js/config/missions.js';
import { runMission } from '../js/ai/mission-match.js';
import { buildHuegel214 } from '../tools/maps/huegel214.mjs';
import { buildAkt2 } from '../tools/scenarios/akt2.mjs';
import '../js/phases/index.js';

const MAP_JSON = JSON.parse(readFileSync(new URL('../data/maps/huegel214.json', import.meta.url)));
const MAP = loadMap(MAP_JSON);
const scenario = (id) => JSON.parse(readFileSync(new URL(`../data/scenarios/${id}.json`, import.meta.url)));
const start = (id, seed = 1) => {
  const sc = scenario(id);
  return initEtappen(createInitialState(MAP, sc, seed), MAP, sc);
};
const env = { map: MAP };
const g = (state, id) => state.groups.find((x) => x.id === id);

/** Runden aufloesen, orders(state) liefert { a: [], b: [] } je Runde */
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

// ------------------------------------------------------------------ Generatoren

test('P23: Karte Hügel 214 und Akt-2-Szenarien entsprechen ihren Generatoren', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildHuegel214())), MAP_JSON);
  const all = buildAkt2();
  for (const [id, sc] of Object.entries(all)) assert.deepEqual(JSON.parse(JSON.stringify(sc)), scenario(id), id);
  for (const id of Object.keys(all)) {
    const st = start(id);
    assert.equal(st.scenario.act, 2, id);
    assert.ok(Array.isArray(st.scenario.features) && st.scenario.features.length, id);
  }
});

test('P23: Versorgung erreicht auf Hügel 214 alle Abschnitte', async () => {
  const { supplyNetwork } = await import('../js/supply.js');
  const st = start('akt2-m2');
  for (const s of supplyNetwork(MAP, st, 'a').sections) assert.ok(s.connected, `Abschnitt ${s.id}: ${s.cutWhy}`);
});

test('P23: Szenario-Varianten nach Flags', () => {
  assert.equal(scenarioForMission('a2m2', { flags: [] }), 'akt2-m2');
  assert.equal(scenarioForMission('a2m2', { flags: ['stollen_frueh'] }), 'akt2-m2-frueh');
  assert.equal(scenarioForMission('a2m5', { flags: ['vell_angriff'] }), 'akt2-m5-angriff');
  assert.equal(scenarioForMission('a2m4', { flags: ['vell_angriff'] }), 'akt2-m4');
});

// ------------------------------------------------------------------ Modifikatoren

test('P23: Modifikatoren multiplizieren Faktoren und addieren Boni', () => {
  registerModifier('probe', 'x', () => 150);
  registerModifier('probe', 'y', () => 50);
  registerModifier('probe', 'z', () => null);
  assert.equal(factorFor('probe', {}), 0.75);
  assert.equal(bonusFor('probe', {}), 200);
  registerModifier('flag', 'w', () => true);
  assert.equal(flagFor('flag', {}), true);
  for (const id of ['x', 'y', 'z']) unregisterModifier('probe', id);
  unregisterModifier('flag', 'w');
  assert.equal(factorFor('probe', {}), 1);
  assert.equal(flagFor('flag', {}), false);
});

// ------------------------------------------------------------------ Sappe

test('P23: Sappe setzt am eigenen Graben an und nicht im feindlichen Graben', () => {
  const st = start('akt2-m2');
  const pio = g(st, 'a03'); // Pioniere am Ende der Sappe (34/21)
  assert.equal(checkSap(MAP, st, pio, [{ x: 36, y: 21 }]), null);
  assert.match(checkSap(MAP, st, pio, [{ x: 36, y: 25 }]), /zu weit/);
  assert.match(checkSap(MAP, st, pio, [{ x: 36, y: 21 }, { x: 38, y: 21 }]), /springt/);
  const lone = { ...pio, pos: { x: 34, y: 10 } };
  assert.match(checkSap(MAP, st, lone, [{ x: 35, y: 10 }]), /eigenen Graben/);
  const mg = g(st, 'a05');
  assert.match(checkSap(MAP, st, mg, [{ x: 31, y: 15 }]), /keine Sappe/);
  assert.ok(sapCellWork(cellAt(MAP, 44, 18)) >= SAP.work, 'Kreide ist harte Arbeit');
});

test('P23: Sappe wird Feld um Feld zum eigenen Graben', () => {
  let st = start('akt2-m2');
  const path = [{ x: 36, y: 21 }, { x: 37, y: 21 }];
  assert.equal(validateOrder({ group: 'a03', type: 'sap', path }, st, env).ok ?? true, true);
  const { state, logs } = play(st, 8, (s) => ({ a: [{ group: 'a03', type: 'sap', path }] }));
  const c = state.cells['36,21'];
  assert.equal(c?.trench?.side, 'own');
  assert.equal(c.trench.sap, true);
  assert.ok(logs.some((e) => e.type === 'sap' && e.side === 'a'));
  for (const e of logs) assert.ok(isValidEvent(e), e.type);
});

// ------------------------------------------------------------------ Stollen, Horchen, Sprengung

test('P23: Stollen beginnen im eigenen Graben, nicht unter Wasser', () => {
  const st = start('akt2-m2');
  const pio = g(st, 'a03');
  assert.equal(checkTunnel(MAP, st, pio, [{ x: 35, y: 20 }, { x: 36, y: 20 }]), null);
  assert.match(checkTunnel(MAP, st, { ...pio, pos: { x: 33, y: 10 } }, [{ x: 34, y: 10 }]), /eigenen Graben/);
  assert.match(checkTunnel(MAP, st, g(st, 'a05'), [{ x: 31, y: 15 }]), /keine Stollen/);
  assert.equal(tunnelCellWork({ terrain: 'wasser' }), Infinity);
  assert.ok(tunnelCellWork({ terrain: 'kreide' }) < tunnelCellWork({ terrain: 'lehm' }));
  assert.ok(tunnelRate({ ...pio }) > tunnelRate({ ...pio, type: 'rifles' }));
  assert.ok(tunnelRate({ ...pio, traits: ['graeber'] }) > tunnelRate(pio));
});

test('P23: Stollen wird gegraben, geladen und gesprengt; der Trichter bleibt', () => {
  const st = start('akt2-m2');
  const path = [{ x: 35, y: 20 }, { x: 36, y: 20 }, { x: 37, y: 20 }, { x: 38, y: 19 }, { x: 39, y: 18 }, { x: 40, y: 18 }];
  const { state, logs } = play(st, 14, (s, i) => ({ a: [{ group: 'a03', type: i === 0 ? 'tunnel' : 'hold', ...(i === 0 ? { path } : {}) }] }));
  const t = state.sides.a.tunnels.find((x) => x.group === 'a03');
  assert.ok(t, 'Stollen angelegt');
  const blown = logs.find((e) => e.type === 'mine_blown' && e.by === 'a');
  const collapsed = t.status === 'collapsed';
  assert.ok(blown || collapsed, `Stollen endet gesprengt oder verschuettet, Status ${t.status}`);
  if (blown && !blown.camouflet) assert.ok(state.cells['40,18']?.trichter, 'Trichter auf dem Ziel');
  for (const e of logs) assert.ok(isValidEvent(e), e.type);
});

test('P23: Horchposten hören den feindlichen Stollen; der Gegner sieht davon nichts', () => {
  const st = start('akt2-m2');
  const bt = st.sides.b.tunnels[0];
  assert.ok(listenChance(MAP, st, g(st, 'a02'), bt) > 0, 'Albers ist in Hörweite');
  assert.equal(listenChance(MAP, st, g(st, 'a06'), bt), 0, 'zu weit im Norden');
  let heard = null, out = null;
  for (let seed = 1; seed <= 6 && !heard; seed++) {
    out = play(start('akt2-m2', seed), 4, () => ({ b: [{ group: 'b01', type: 'hold' }] }), seed);
    heard = out.state.sides.a.heard?.[bt.id] ?? null;
  }
  assert.ok(heard, 'in einigen Seeds gehört');
  assert.ok(out.logs.some((e) => e.type === 'tunnel_detected' && e.side === 'a'));
  const vb = viewFor(out.state, out.logs, 'b', env);
  assert.equal(vb.state?.sides?.a?.heard ?? vb.sides?.a?.heard, undefined, 'b sieht nicht, was a gehört hat');
});

// ------------------------------------------------------------------ Stosstrupp

test('P23: Stoßtrupp nur mit Stoßtruppen und nicht in die eigene Stellung', () => {
  const st = start('akt2-m4');
  assert.equal(raidProblem(MAP, st, g(st, 'a01'), { x: 40, y: 20 }), null);
  assert.match(raidProblem(MAP, st, g(st, 'a02'), { x: 40, y: 20 }), /Stoßtrupp/);
  assert.match(raidProblem(MAP, st, g(st, 'a01'), { x: 29, y: 19 }), /eigene Stellung/);
  assert.match(raidProblem(MAP, st, g(st, 'a01'), { x: 59, y: 20 }), /zu weit/);
});

test('P23: Stoßtrupp bringt mal Gefangene, mal wird er abgewiesen', () => {
  let ok = 0, bad = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { logs } = play(start('akt2-m4', seed), 1, () => ({ a: [{ group: 'a01', type: 'raid', target: { x: 40, y: 20 } }] }), seed);
    for (const e of logs) assert.ok(isValidEvent(e), e.type);
    if (logs.some((e) => e.type === 'prisoners' && e.side === 'a')) ok++;
    else bad++;
  }
  assert.ok(ok > 0, 'mindestens einmal Gefangene');
  assert.ok(bad > 0, 'mindestens einmal ohne');
});

// ------------------------------------------------------------------ Offiziere, Veteranen, Doktrinen

test('P23: Offiziere fallen eher bei schweren Verlusten, höchstens mit der Obergrenze', () => {
  assert.equal(officerFallChance(0), 0);
  assert.ok(officerFallChance(3) > officerFallChance(1));
  assert.ok(officerFallChance(1, { sniper: true }) > officerFallChance(1));
  assert.equal(officerFallChance(99, { sniper: true }), OFFICER.fallMax);
});

test('P23: Veteranen verdienen Eigenschaften, höchstens zwei', () => {
  assert.equal(earnedTrait({ deeds: {} }), null);
  assert.equal(earnedTrait({ deeds: { graeber: DEEDS.graeber } }), 'graeber');
  assert.equal(earnedTrait({ deeds: { graeber: DEEDS.graeber - 1 } }), null);
  const full = Array.from({ length: MAX_TRAITS }, (_, i) => ['nacht', 'fest'][i]);
  assert.equal(earnedTrait({ traits: full, deeds: { graeber: 99 } }), null);
});

test('P23: Doktrin aus der Entscheidung; Infiltration bildet einen Stoßtrupp aus', () => {
  assert.equal(doctrineFromFlags(['doktrin_tiefe', 'doktrin_infiltration']), 'infiltration');
  assert.equal(doctrineFromFlags([]), null);
  const st = start('akt2-m2');
  const s2 = prepareAkt2(st, { flags: ['doktrin_infiltration'] }, 'a');
  assert.equal(s2.sides.a.doctrine, 'infiltration');
  assert.ok(s2.groups.some((x) => x.side === 'a' && x.type === 'stormtroops'));
  if (Array.isArray(st.sides.a.reports)) assert.ok(s2.sides.a.reports.includes('lattenroste'));
  assert.notEqual(st, s2);
  assert.ok(!st.groups.some((x) => x.side === 'a' && x.type === 'stormtroops'), 'Eingabe bleibt unverändert');
});

test('P23: Szenario-Aufbau setzt Offizier, Stollen und Merkmale', () => {
  const st = start('akt2-m2-frueh');
  assert.ok(featureOn(st, 'tunnel'));
  assert.equal(featureOn(st, 'raid'), false);
  assert.equal(g(st, 'a01').officer?.id, 'vell');
  assert.ok(st.sides.a.tunnels?.length, 'vorbereiteter Stollen');
});

// ------------------------------------------------------------------ Missionsziele

test('P23: Missionsziele a2m1 bis a2m6', () => {
  const st = start('akt2-m1');
  const none = judgeA2m1({ state: st, rounds: [], side: 'a', final: false });
  assert.equal(none, null);
  const sapped = structuredClone(st);
  sapped.cells[`${HEUWAGEN.x},${HEUWAGEN.y}`] = { trench: { side: 'own', kind: 'comm', level: 1 } };
  assert.equal(judgeA2m1({ state: sapped, rounds: [], side: 'a', final: true }).outcome, 'sieg');

  const blownByFoe = [{ kind: 'position', log: [{ type: 'mine_blown', by: 'b', camouflet: false }] }];
  assert.equal(judgeA2m2({ state: st, rounds: blownByFoe, side: 'a', final: false }).outcome, 'niederlage');

  const six = Array.from({ length: 6 }, () => ({ kind: 'position', log: [] }));
  assert.equal(judgeA2m3({ state: st, rounds: six, side: 'a', final: false }).orderMet, true);
  const lost = [{ kind: 'position', log: [{ type: 'men_captured', side: 'a', count: 4 }] }];
  assert.equal(judgeA2m3({ state: st, rounds: lost, side: 'a', final: false }).outcome, 'niederlage');

  const m4 = start('akt2-m4');
  const two = [{ kind: 'position', log: [{ type: 'prisoners', side: 'a', count: 2 }] }];
  assert.equal(judgeA2m4({ state: m4, rounds: two, side: 'a', final: false }).orderMet, true);

  const m6 = structuredClone(start('akt2-m6'));
  const inCrater = m6.groups.find((x) => x.side === 'a' && x.type === 'rifles');
  inCrater.pos = { ...CRATER[4] };
  for (const x of m6.groups) if (x.side === 'b' && CRATER.some((c) => c.x === x.pos.x && c.y === x.pos.y)) x.status = 'lost';
  for (const c of CRATER.slice(0, 3)) m6.cells[`${c.x},${c.y}`] = { ...(m6.cells[`${c.x},${c.y}`] ?? {}), trench: { side: 'own', kind: 'comm', level: 1 } };
  const r = judgeA2m6({ state: m6, rounds: six, side: 'a', final: false });
  assert.equal(r.outcome, 'sieg');
  assert.deepEqual(r.flags, ['trichter_gehalten']);
});

test('P23: Missionen im Simulator sind deterministisch und gewinnbar', () => {
  const run = (mission, seed, flags = []) => {
    const sc = scenario(scenarioForMission(mission, { flags }));
    return runMission({ map: MAP, scenario: sc, mission, seed, flags });
  };
  const a = run('a2m1', 3), b = run('a2m1', 3);
  assert.equal(a.outcome, b.outcome);
  assert.equal(a.rounds, b.rounds);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.outcome, 'sieg', a.why);
  const passive = runMission({ map: MAP, scenario: scenario('akt2-m1'), mission: 'a2m1', seed: 3, passive: true });
  assert.equal(passive.outcome, 'niederlage');
});

test('P23: Leuchtkugeln derselben Runde verraten den Stoßtrupp', () => {
  let lit = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const { logs } = play(start('akt2-m4', seed), 1, () => ({
      a: [{ group: 'a01', type: 'raid', target: { x: 40, y: 20 } }],
      b: [{ group: 'b01', type: 'flare', target: { x: 37, y: 20 } }],
    }), seed);
    if (logs.some((e) => e.type === 'raid_spotted' && /Leuchtkugel/.test(e.reason))) lit++;
    for (const e of logs.filter((x) => x.type === 'raid_spotted' || x.type === 'raid_repelled')) assert.equal(e.raider, undefined, 'keine fremde Gruppen-ID');
  }
  assert.ok(lit > 0, 'mindestens einmal im Licht entdeckt');
});

test('P23: Ein gefallener Vell kommt in späteren Missionen nicht wieder', () => {
  const st = start('akt2-m6');
  assert.ok(st.groups.some((x) => x.officer?.id === 'vell'));
  const s2 = prepareAkt2(st, { flags: ['vell_angriff', 'vell_gefallen'] }, 'a');
  assert.ok(!s2.groups.some((x) => x.officer?.id === 'vell'));
});
