import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFor, setVisibilityRules } from '../js/view.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { makeEvent } from '../js/events.js';
import { MAP, SCENARIO } from './fixtures/scenario.js';

test('Eigene Gruppen voll, ferne Feinde unsichtbar, nahe Feinde nur als Umriss', () => {
  const s = createInitialState(MAP, SCENARIO, 1);
  let v = viewFor(s, [], 'a');
  assert.deepEqual(v.groups.map((g) => g.id), ['a01', 'a02', 'a03']);
  assert.ok(v.groups[0].leader.name);
  assert.equal(v.enemy.faction, 'morrow');
  assert.equal(v.own.supplies.ammo, s.sides.a.supplies.ammo);

  const near = structuredClone(s);
  near.groups.find((g) => g.id === 'b01').pos = { x: 7, y: 2 };
  v = viewFor(near, [], 'a');
  const b01 = v.groups.find((g) => g.id === 'b01');
  assert.ok(b01);
  assert.equal(b01.leader, undefined);
  assert.equal(b01.strength, undefined);
  assert.ok(!v.groups.some((g) => g.id === 'b02'));
});

test('Nachts sieht man weniger weit', () => {
  const s = createInitialState(MAP, SCENARIO, 1);
  s.groups.find((g) => g.id === 'b01').pos = { x: 8, y: 2 };
  assert.ok(viewFor(s, [], 'a').groups.some((g) => g.id === 'b01'));
  s.night = true;
  assert.ok(!viewFor(s, [], 'a').groups.some((g) => g.id === 'b01'));
});

test('Protokoll: fremde Ereignisse nur, wenn sichtbar; allgemeine fuer beide', () => {
  const s = createInitialState(MAP, SCENARIO, 1);
  const log = [
    makeEvent({ phase: 'x', type: 'a', side: 'b', reason: 'fern', at: { x: 20, y: 2 } }),
    makeEvent({ phase: 'x', type: 'a', side: 'b', reason: 'nah', at: { x: 5, y: 2 } }),
    makeEvent({ phase: 'x', type: 'a', side: 'b', reason: 'geheim', secret: true, at: { x: 5, y: 2 } }),
    makeEvent({ phase: 'clock', type: 'nightfall', reason: 'dunkel', at: { x: 12, y: 6 } }),
  ];
  assert.deepEqual(viewFor(s, log, 'a').log.map((e) => e.reason), ['nah', 'dunkel']);
  assert.equal(viewFor(s, log, 'b').log.length, 4);
});

test('Sichtregel ist austauschbar', () => {
  const s = createInitialState(MAP, SCENARIO, 1);
  setVisibilityRules({ groupVisible: () => true });
  try {
    assert.equal(viewFor(s, [], 'a').groups.length, 5);
  } finally {
    setVisibilityRules();
  }
  assert.equal(viewFor(s, [], 'a').groups.length, 3);
});

test('Sicht ist eine Kopie und laeuft ueber einen echten Rundenausgang', () => {
  const s = createInitialState(MAP, SCENARIO, 1);
  const r = resolveTurn(s, [], [], 1, 1);
  const v = viewFor(r.state, r.log, 'b');
  v.groups[0].pos.x = 99;
  assert.notEqual(r.state.groups.find((g) => g.id === v.groups[0].id).pos.x, 99);
  assert.ok(v.log.every((e) => e.side !== 'a'));
});
