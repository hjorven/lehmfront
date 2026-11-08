import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTurn, rngForPhase } from '../js/resolve.js';
import { registerPhase, unregisterPhase, phasesFor, ORDER } from '../js/phases/registry.js';
import { createInitialState } from '../js/state.js';
import { isValidEvent } from '../js/events.js';
import { MAP, SCENARIO, deepFreeze } from './fixtures/scenario.js';

const fresh = (seed = 42) => createInitialState(MAP, SCENARIO, seed);

test('Determinismus: gleicher Zustand, gleiche Befehle, gleicher Seed -> tief gleich', () => {
  const orders = [{ group: 'a01', type: 'hold' }, { group: 'a02', type: 'dig', path: [{ x: 4, y: 5 }, { x: 4, y: 6 }] }];
  let s1 = fresh(), s2 = fresh();
  for (let t = 1; t <= 6; t++) {
    const r1 = resolveTurn(s1, orders, [], 42, t);
    const r2 = resolveTurn(s2, structuredClone(orders), [], 42, t);
    assert.deepEqual(r1, r2);
    s1 = r1.state; s2 = r2.state;
  }
  assert.equal(s1.turn, 7);
});

test('Zustand und Befehle werden nicht mutiert', () => {
  const s = deepFreeze(fresh());
  const orders = deepFreeze([{ group: 'a01', type: 'hold' }, { group: 'zz', type: 'hold' }]);
  const r = resolveTurn(s, orders, deepFreeze([]), 42, 1);
  assert.notEqual(r.state, s);
  assert.equal(s.turn, 1);
  assert.equal(r.state.turn, 2);
  assert.equal(s.groups[0].holdTurns, 0);
  assert.equal(r.state.groups[0].holdTurns, 1);
});

test('Phasen laufen in der Reihenfolge aus Plan 10.6, gleiche Zahl nach id', () => {
  const seen = [];
  const mk = (id, kind, order) => ({ id, kind, order, run: () => seen.push(id) });
  const list = [
    mk('morale', 'position', ORDER.position.morale),
    mk('weather', 'position', ORDER.position.weather),
    mk('fire', 'battle', ORDER.battle.fire),
    mk('works-b', 'position', ORDER.position.works),
    mk('works-a', 'position', ORDER.position.works),
    mk('tick', 'both', { position: 5, battle: 95 }),
    mk('artillery', 'both', { position: ORDER.position.artillery, battle: ORDER.battle.artillery }),
  ];
  assert.deepEqual(phasesFor('position', list).map((p) => p.id), ['tick', 'weather', 'artillery', 'works-a', 'works-b', 'morale']);
  assert.deepEqual(phasesFor('battle', list).map((p) => p.id), ['artillery', 'fire', 'tick']);

  resolveTurn(fresh(), [], [], 1, 1, { phases: list });
  assert.deepEqual(seen, ['tick', 'weather', 'artillery', 'works-a', 'works-b', 'morale']);
});

test('Plan-Reihenfolge ist aufsteigend dokumentiert', () => {
  for (const kind of ['position', 'battle']) {
    const nums = Object.values(ORDER[kind]);
    assert.deepEqual(nums, [...nums].sort((a, b) => a - b));
  }
});

test('Register: angemeldete Phase laeuft im Standardablauf, Fehler werden benannt', () => {
  const ran = [];
  registerPhase({ id: 'test-probe', kind: 'position', order: ORDER.position.works, run: (ctx) => ran.push(ctx.kind) });
  try {
    assert.throws(() => registerPhase({ id: 'test-probe', kind: 'position', order: 1, run() {} }), /schon/);
    assert.throws(() => registerPhase({ id: 'x', kind: 'immer', order: 1, run() {} }), /kind/);
    assert.throws(() => registerPhase({ id: 'y', kind: 'both', order: { position: 1 }, run() {} }), /battle/);
    resolveTurn(fresh(), [], [], 1, 1);
    assert.deepEqual(ran, ['position']);
  } finally {
    unregisterPhase('test-probe');
  }
  const boom = { id: 'boom', kind: 'position', order: 1, run() { throw new Error('kaputt'); } };
  assert.throws(() => resolveTurn(fresh(), [], [], 1, 1, { phases: [boom] }), /Phase boom: kaputt/);
});

test('Gefechtsrunde nutzt Gefechtsphasen und die 5-Minuten-Uhr', () => {
  const s = fresh();
  const b = { ...structuredClone(s), turnKind: 'battle', battle: { round: 0, attacker: 'a' } };
  const r = resolveTurn(b, [{ group: 'a01', type: 'dig', path: [{ x: 1, y: 1 }] }], [], 9, 1);
  assert.equal(r.state.clock.hour, 6);
  assert.equal(r.state.clock.minute, 5);
  assert.equal(r.state.battle.round, 1);
  const inv = r.log.find((e) => e.type === 'order_invalid');
  assert.match(inv.reason, /Stellungsrunde/);
});

test('Stellungsrunden wechseln Tag und Nacht', () => {
  let s = fresh();
  const kinds = [];
  for (let t = 1; t <= 4; t++) {
    const r = resolveTurn(s, [], [], 5, t);
    kinds.push(r.state.night);
    s = r.state;
  }
  assert.deepEqual(kinds, [true, false, true, false]);
  assert.equal(s.clock.day, 3);
});

test('Protokoll: jedes Ereignis hat phase, type, reason und at', () => {
  const r = resolveTurn(fresh(), [{ group: 'a01', type: 'fliegen' }], [{ group: 'a02', type: 'hold' }], 3, 1);
  assert.ok(r.log.length > 0);
  for (const e of r.log) assert.ok(isValidEvent(e), JSON.stringify(e));
  const emit = { id: 'leer', kind: 'position', order: 1, run: (ctx) => ctx.emit('x', { reason: 'ohne Ort' }) };
  assert.throws(() => resolveTurn(fresh(), [], [], 1, 1, { phases: [emit] }), /Pflichtfeld "at"/);
});

test('Halten zaehlt durch, Bewegung setzt zurueck, Begruendungen nennen den Gruppenfuehrer', () => {
  let s = fresh();
  for (let t = 1; t <= 5; t++) s = resolveTurn(s, [], [], 1, t).state;
  const a01 = s.groups.find((g) => g.id === 'a01');
  assert.equal(a01.holdTurns, 5);
  const r = resolveTurn(s, [{ group: 'a01', type: 'dig', path: [{ x: 4, y: 2 }] }], [], 1, 6);
  assert.equal(r.state.groups.find((g) => g.id === 'a01').holdTurns, 0);
  const last = r.log.filter((e) => e.type === 'hold');
  assert.equal(last.length, 4);
  const a02 = r.state.groups.find((g) => g.id === 'a02');
  const ev = last.find((e) => e.group === 'a02');
  assert.ok(ev.reason.includes(a02.leader.name.split(' ').slice(1).join(' ')));
  assert.ok(ev.reason.includes('keinen Befehl'));
});

test('Partie-Ende ueber ctx.finish, danach keine weitere Runde', () => {
  const end = { id: 'ende', kind: 'position', order: 1, run: (ctx) => ctx.finish({ winner: 'b', reason: 'Abschnitt gefallen' }) };
  const r = resolveTurn(fresh(), [], [], 1, 1, { phases: [end] });
  assert.equal(r.finished, true);
  assert.deepEqual(r.state.result, { winner: 'b', reason: 'Abschnitt gefallen', turn: 1 });
  assert.throws(() => resolveTurn(r.state, [], [], 1, 2), /beendet/);
});

test('Falsche Rundennummer wird abgelehnt', () => {
  assert.throws(() => resolveTurn(fresh(), [], [], 1, 3), /passt nicht/);
});

test('Jede Phase hat eigenen Zufall: eine neue Phase verschiebt die Wuerfe anderer nicht', () => {
  const draws = (extra) => {
    const out = [];
    const a = { id: 'wuerfel', kind: 'position', order: 50, run: (ctx) => out.push(ctx.rng(), ctx.rng()) };
    const b = { id: 'neu', kind: 'position', order: 10, run: (ctx) => { ctx.rng(); ctx.rng(); ctx.rng(); } };
    resolveTurn(fresh(), [], [], 77, 1, { phases: extra ? [a, b] : [a] });
    return out;
  };
  assert.deepEqual(draws(false), draws(true));
  assert.notEqual(rngForPhase(1, 1, 'a')(), rngForPhase(1, 1, 'b')());
});
