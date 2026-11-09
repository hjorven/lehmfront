// KI-Kommandant, Taktik-Lehrling, Notizen, Simulator (P13)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, distance } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import { decide, planOrders, viewState, strengthRatio, assess } from '../js/ai.js';
import { DOCTRINES, DIFFICULTIES, POSTURES, doctrineForAct } from '../js/config/doctrines.js';
import { noteFromDecision, maybeIntercept, interceptChance, noteParts } from '../js/ai/notes.js';
import { mirrorMap, mirrorScenario, mirrorHalf, runMatch, runSeries, reasonKey, topEntries } from '../js/ai/match.js';
import { validateOrder } from '../js/orders.js';
import { deepFreeze } from './fixtures/scenario.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const MAP_JSON = read('../data/maps/asse.json');
const MAP = loadMap(MAP_JSON);
const SCEN = read('../data/scenarios/asse-frei.json');
const env = { map: MAP };
const fresh = (seed = 7) => initEtappen(createInitialState(MAP, SCEN, seed), MAP, SCEN);

test('KI ist deterministisch: gleiche Sicht, gleicher Seed, gleiche Entscheidung', () => {
  const s = fresh();
  for (const side of ['a', 'b']) {
    const v = viewFor(s, [], side, env);
    const d1 = decide(v, { map: MAP, seed: 7 });
    const d2 = decide(structuredClone(v), { map: MAP, seed: 7 });
    assert.deepEqual(d1, d2);
    assert.ok(d1.postureReason.length > 10);
  }
});

test('KI veraendert die Sicht nicht', () => {
  const v = deepFreeze(viewFor(fresh(), [], 'b', env));
  assert.doesNotThrow(() => decide(v, { map: MAP, seed: 3, posture: 'sturm' }));
});

test('KI schummelt nicht: ungesehene Feinde aendern nichts an der Entscheidung', () => {
  const s = fresh();
  const v = viewFor(s, [], 'b', env);
  const seen = new Set(v.groups.filter((g) => g.side === 'a').map((g) => g.id));
  const known = new Set([...seen, ...v.ghosts.map((g) => g.id)]);
  const hidden = s.groups.find((g) => g.side === 'a' && !known.has(g.id));
  assert.ok(hidden, 'mindestens eine Gruppe von a ist fuer b unbekannt');
  const s2 = structuredClone(s);
  const h2 = s2.groups.find((g) => g.id === hidden.id);
  h2.strength = 1;
  h2.morale = 5;
  h2.pos = { x: hidden.pos.x - 2, y: hidden.pos.y };
  const v2 = viewFor(s2, [], 'b', env);
  assert.deepEqual(v2.groups.filter((g) => g.side === 'a'), v.groups.filter((g) => g.side === 'a'));
  for (const posture of ['auto', 'sturm', 'halten']) {
    assert.deepEqual(decide(v2, { map: MAP, seed: 5, posture }).orders, decide(v, { map: MAP, seed: 5, posture }).orders, posture);
  }
});

test('Alle KI-Befehle sind gueltig, ueber viele Runden und alle Lagen', () => {
  for (const [pa, pb] of [['auto', 'sturm'], ['sturm', 'halten'], ['vorbereiten', 'gegenstoss']]) {
    let s = fresh(11);
    let log = [];
    const mem = {};
    for (let i = 0; i < 18; i++) {
      const orders = {};
      for (const side of ['a', 'b']) {
        const d = decide(viewFor(s, log, side, env), { map: MAP, seed: 11, posture: side === 'a' ? pa : pb, memory: mem[side], difficulty: 'lask' });
        mem[side] = d.memory;
        orders[side] = d.orders;
        for (const o of d.orders) assert.equal(validateOrder(o, s, side, env), null, `${side} ${o.type}`);
        for (const a of d.advice) {
          assert.equal(typeof a.reason, 'string');
          assert.ok(a.reason.length > 8, a.reason);
          assert.ok(!/undefined|NaN/.test(a.reason), a.reason);
        }
      }
      const r = resolveTurn(s, orders.a, orders.b, 11, s.turn, env);
      assert.deepEqual(r.log.filter((e) => e.type === 'order_invalid').map((e) => e.reason), []);
      s = r.state;
      log = r.log;
    }
  }
});

test('Lage Sturm setzt einen Angriff an, Halten nicht', () => {
  const v = viewFor(fresh(), [], 'b', env);
  const sturm = decide(v, { map: MAP, seed: 2, posture: 'sturm' });
  const attacks = sturm.orders.filter((o) => o.type === 'attack');
  assert.ok(attacks.length >= 1);
  assert.ok(sturm.intent.objective, 'Ziel gewaehlt');
  for (const o of attacks) assert.ok(distance(o.path[o.path.length - 1], sturm.intent.objective) <= 3);
  const halten = decide(v, { map: MAP, seed: 2, posture: 'halten' });
  assert.equal(halten.orders.filter((o) => o.type === 'attack').length, 0);
  assert.equal(halten.posture, 'halten');
});

test('Sturm laeuft in den Gefechtsrunden weiter und Lage waehlt sich selbst', () => {
  let s = fresh(4);
  const d = decide(viewFor(s, [], 'b', env), { map: MAP, seed: 4, posture: 'sturm' });
  const r = resolveTurn(s, [], d.orders, 4, 1, env);
  s = r.state;
  assert.equal(s.turnKind, 'battle');
  const d2 = decide(viewFor(s, r.log, 'b', env), { map: MAP, seed: 4, memory: d.memory });
  assert.equal(d2.posture, 'sturm');
  assert.ok(d2.orders.some((o) => o.type === 'assault'), 'Sturmgruppen stuermen weiter');
  const def = decide(viewFor(s, r.log, 'a', env), { map: MAP, seed: 4 });
  assert.equal(def.posture, 'halten');
});

test('Gegenstoss nach Stabsbefehl: Sturm auf den verlorenen Graben', () => {
  const s = fresh(9);
  s.turnKind = 'battle';
  const at = { x: 33, y: 8 };
  s.battle = { round: 3, attackers: ['b'], assaulters: { b: ['b01'] }, objectives: { b: [{ ...at, group: 'b01' }] }, counter: { a: { at, due: 6, issued: 2 } }, outcome: {} };
  const d = decide(viewFor(s, [], 'a', env), { map: MAP, seed: 9 });
  assert.equal(d.posture, 'gegenstoss');
  const pushes = d.orders.filter((o) => o.type === 'assault');
  assert.ok(pushes.length >= 1);
  for (const o of pushes) assert.deepEqual(o.path[o.path.length - 1], at);
});

test('Doktrinen und Schwierigkeiten sind vollstaendig und wirken', () => {
  for (const d of Object.values(DOCTRINES)) {
    for (const k of ['attackRatio', 'prepareRatio', 'prepTurns', 'assaultShare', 'persistence', 'counterRatio']) assert.ok(Number.isFinite(d[k]), `${d.id}.${k}`);
    assert.ok(d.attackRatio >= d.prepareRatio, d.id);
  }
  assert.equal(doctrineForAct(1).id, 'masse');
  assert.equal(doctrineForAct(4).id, 'tiefe');
  assert.deepEqual(Object.keys(DIFFICULTIES), ['rekrut', 'veteran', 'lask']);
  assert.deepEqual(Object.keys(POSTURES), ['halten', 'vorbereiten', 'sturm', 'gegenstoss']);
  // Rekrut vergisst alte Geister, Lask nicht
  const v = viewFor(fresh(), [], 'a', env);
  const old = v.ghosts.filter((g) => g.age > 2);
  assert.ok(old.length, 'Szenario hat einen alten Geist');
  const memo = { enemies: {}, lost: [], prep: 0 };
  assert.ok(assess(v, MAP, memo, DIFFICULTIES.lask).known.length > assess(v, MAP, memo, DIFFICULTIES.rekrut).known.length);
  // Nachtangriff-Doktrin wartet am Tag
  const day = decide(v, { map: MAP, seed: 1, doctrine: 'nacht', memory: { prep: 5 } });
  assert.notEqual(day.posture, 'sturm');
  // Kraefteverhaeltnis ist eine ganze Zahl
  const r = strengthRatio(assess(v, MAP, memo, DIFFICULTIES.veteran), () => 0.5, DIFFICULTIES.veteran);
  assert.ok(Number.isInteger(r) && r > 0);
});

test('Rekrut verschlaeft manchmal Befehle, der Taktik-Lehrling nie', () => {
  let slept = 0, advisorSlept = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const v = viewFor(fresh(seed), [], 'b', env);
    slept += decide(v, { map: MAP, seed, difficulty: 'rekrut', posture: 'sturm' }).advice.filter((a) => a.tag === 'Befehl verschlafen').length;
    advisorSlept += decide(v, { map: MAP, seed, difficulty: 'rekrut', posture: 'sturm', advisor: true }).advice.filter((a) => a.tag === 'Befehl verschlafen').length;
  }
  assert.ok(slept > 0);
  assert.equal(advisorSlept, 0);
});

test('Taktik-Lehrling: Vorschlaege fuer die Spielerseite mit Begruendung', () => {
  const v = viewFor(fresh(), [], 'a', env);
  const d = decide(v, { map: MAP, seed: 7, advisor: true, difficulty: 'lask' });
  assert.equal(d.side, 'a');
  assert.ok(d.advice.length >= 1);
  for (const a of d.advice) {
    assert.ok(!a.group || a.group.startsWith('a'));
    assert.match(a.reason, /[a-zäöü]/);
  }
  assert.deepEqual(planOrders(v, { map: MAP, seed: 7, advisor: true, difficulty: 'lask' }), d.orders);
});

test('viewState enthaelt nur die eigene Seite vollstaendig', () => {
  const v = viewFor(fresh(), [], 'b', env);
  const st = viewState(v);
  assert.deepEqual(Object.keys(st.sides).sort(), ['a', 'b']);
  assert.deepEqual(Object.keys(st.sides.a), ['faction']);
  assert.equal(st.sides.b, v.own);
});

// ---------- Notizen ----------

test('Abgefangene Notiz entsteht aus der echten Entscheidung', () => {
  const v = viewFor(fresh(), [], 'b', env);
  const d = decide(v, { map: MAP, seed: 3, posture: 'sturm' });
  const n1 = noteFromDecision(d, v, { seed: 3, difficulty: 'rekrut' });
  const n2 = noteFromDecision(d, v, { seed: 3, difficulty: 'rekrut' });
  assert.deepEqual(n1, n2);
  assert.equal(n1.posture, 'sturm');
  const label = `${d.intent.objective.x + 1}/${d.intent.objective.y + 1}`;
  assert.ok(n1.hint.includes(label), n1.hint);
  assert.ok(n1.lines.some((l) => l.includes(label)), 'Feldangabe bleibt lesbar');
  assert.deepEqual(n1.at, d.intent.objective);
  for (const p of ['halten', 'vorbereiten', 'gegenstoss']) {
    const n = noteFromDecision(decide(v, { map: MAP, seed: 3, posture: p }), v, { seed: 3 });
    assert.ok(n.lines.length >= 2 && n.hint.length > 5, p);
    for (const l of n.lines) assert.ok(!/undefined|NaN|null/.test(l), l);
  }
});

test('Notiz: Verwischungen werden zerlegt, Gefangene bringen sie sicher', () => {
  assert.deepEqual(noteParts('Wir {{gehen}} auf 33/4.'), [{ text: 'Wir ', smudged: false }, { text: 'gehen', smudged: true }, { text: ' auf 33/4.', smudged: false }]);
  const s = fresh();
  const pv = viewFor(s, [], 'a', env);
  assert.ok(interceptChance(pv).chance < 100);
  const withCapture = { ...pv, log: [{ type: 'group_captured', side: 'b', group: 'b01', reason: 'x', at: { x: 1, y: 1 } }] };
  assert.equal(interceptChance(withCapture).chance, 100);
  const lv = viewFor(s, [], 'b', env);
  const d = decide(lv, { map: MAP, seed: 1 });
  const note = maybeIntercept({ decision: d, laskView: lv, playerView: withCapture, seed: 1 });
  assert.ok(note && note.found.includes('Gefangenen'));
  // Wie oft ueber viele Runden? Nicht staendig, aber auch nicht nie
  let n = 0;
  for (let t = 1; t <= 60; t++) if (maybeIntercept({ decision: d, laskView: lv, playerView: { ...pv, turn: t }, seed: 1 })) n++;
  assert.ok(n > 3 && n < 40, String(n));
});

// ---------- Simulator ----------

test('Spiegelkarte: beide Seiten haben dasselbe Gelaende', () => {
  const half = mirrorHalf(MAP_JSON);
  assert.ok(half > 30 && half < 45, String(half));
  const mj = mirrorMap(MAP_JSON);
  const m = loadMap(mj);
  assert.equal(m.width, 2 * half);
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < half; x++) {
      const p = m.cells[y * m.width + x], q = m.cells[y * m.width + (m.width - 1 - x)];
      assert.equal(p.terrain, q.terrain);
      assert.equal(p.height, q.height);
      assert.equal(p.zone, q.zone);
      assert.equal(!!p.trench, !!q.trench);
      if (p.side) assert.notEqual(p.side, q.side);
    }
  }
  const own = mj.trenches.filter((t) => t.side === 'own').length;
  assert.equal(own, mj.trenches.filter((t) => t.side === 'enemy').length);
  const sc = mirrorScenario(MAP_JSON, SCEN.sides.a.groups);
  const st = initEtappen(createInitialState(m, sc, 1), m, sc);
  const ga = st.groups.filter((g) => g.side === 'a'), gb = st.groups.filter((g) => g.side === 'b');
  assert.equal(ga.length, gb.length);
  ga.forEach((g, i) => {
    assert.equal(g.type, gb[i].type);
    assert.equal(g.strength, gb[i].strength);
    assert.equal(g.pos.x, m.width - 1 - gb[i].pos.x);
  });
  assert.equal(st.sides.a.artillery.batteries.length, st.sides.b.artillery.batteries.length);
});

test('Simulator ist deterministisch', () => {
  const opts = { map: MAP, scenario: SCEN, seed: 42, turns: 14, ai: { a: { posture: 'halten' }, b: { posture: 'sturm' } } };
  const r1 = runMatch(opts), r2 = runMatch(opts);
  assert.deepEqual({ ...r1, state: null }, { ...r2, state: null });
  assert.ok(r1.battles >= 1, 'Sturm setzt mindestens einen Angriff an');
  assert.ok(Object.keys(r1.events).length > 3);
  assert.equal(reasonKey('Gruppe Janssen feuert auf 33/4 mit 12 Schuss.'), 'Gruppe X feuert auf F mit N Schuss.');
  assert.deepEqual(topEntries({ b: 2, a: 2, c: 5 }, 2), [['c', 5], ['a', 2]]);
});

test('Symmetrie: gleiche KI auf gespiegelter Karte landet nahe 50 Prozent', () => {
  const m = loadMap(mirrorMap(MAP_JSON));
  const sc = mirrorScenario(MAP_JSON, SCEN.sides.a.groups);
  const runs = 16;
  const sum = runSeries({ map: m, scenario: sc, seed: 100, turns: 24, ai: { a: { posture: 'sturm' }, b: { posture: 'sturm' } } }, runs);
  const decided = sum.wins.a + sum.wins.b;
  assert.ok(decided >= 4, `zu wenige entschiedene Partien (${decided})`);
  const share = (sum.wins.a * 100) / decided;
  assert.ok(share >= 20 && share <= 80, `Siegquote a ${share} Prozent (a ${sum.wins.a}, b ${sum.wins.b}, Remis ${sum.wins.draw})`);
  // Verluste aehnlich (hoechstens doppelt so viele auf einer Seite)
  assert.ok(sum.losses.a <= 2 * sum.losses.b + runs && sum.losses.b <= 2 * sum.losses.a + runs, JSON.stringify(sum.losses));
});
