import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrders, validateOrder, registerOrderValidator, sortOrders } from '../js/orders.js';
import { resolveTurn } from '../js/resolve.js';
import { createInitialState } from '../js/state.js';
import { MAP, SCENARIO } from './fixtures/scenario.js';

const s = createInitialState(MAP, SCENARIO, 42);

test('Gruppen ohne Befehl halten, Ergebnis nach Gruppen-ID sortiert', () => {
  const { orders, events } = normalizeOrders(s, 'a', [{ group: 'a03', type: 'dig', path: [{ x: 2, y: 9 }] }]);
  assert.deepEqual(orders.map((o) => o.group), ['a01', 'a02', 'a03']);
  assert.deepEqual(orders.map((o) => o.type), ['hold', 'hold', 'dig']);
  assert.equal(orders[0].implicit, true);
  assert.equal(events.length, 0);
});

test('Ungueltige Befehle werden zu Halten mit Begruendung', () => {
  const cases = [
    [{ group: 'a01', type: 'fliegen' }, /unbekannter Befehl/],
    [{ group: 'a01', type: 'move', path: [{ x: 1, y: 1 }] }, /Gefechtsrunde/],
    [{ group: 'a01', type: 'raid', target: { x: 10, y: 3 } }, /nachts/],
    [{ group: 'a01', type: 'build', target: { x: 99, y: 3 } }, /Zielfeld/],
    [{ group: 'a01', type: 'dig', path: [] }, /Weg/],
    [{ group: 'a01', type: 'dig', path: [{ x: 1, y: -1 }] }, /aus der Karte/],
  ];
  for (const [order, re] of cases) {
    const { orders, events } = normalizeOrders(s, 'a', [order]);
    assert.equal(orders[0].type, 'hold', JSON.stringify(order));
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'order_invalid');
    assert.match(events[0].reason, re);
    assert.match(events[0].reason, /hält/);
    assert.deepEqual(events[0].at, s.groups[0].pos);
  }
});

test('Fremde, unbekannte und doppelte Befehle', () => {
  const { orders, events } = normalizeOrders(s, 'a', [
    { group: 'b01', type: 'hold' },
    { group: 'x9', type: 'hold' },
    null,
    { group: 'a02', type: 'dig', path: [{ x: 4, y: 5 }] },
    { group: 'a02', type: 'wire', path: [{ x: 5, y: 5 }] },
  ]);
  assert.equal(events.length, 4);
  assert.match(events.find((e) => /b01/.test(e.reason)).reason, /eigenen Seite/);
  assert.equal(orders.find((o) => o.group === 'a02').type, 'dig');
  assert.ok(!orders.some((o) => o.group === 'b01'));
});

test('Nachtbefehl geht nachts, Befehle sind unabhaengig von der Eingabereihenfolge', () => {
  const night = { ...structuredClone(s), night: true };
  assert.equal(validateOrder({ group: 'a01', type: 'raid', target: { x: 10, y: 3 } }, night, 'a'), null);
  const list = [{ group: 'a03', type: 'hold' }, { group: 'a01', type: 'dig', path: [{ x: 3, y: 3 }] }];
  assert.deepEqual(normalizeOrders(s, 'a', list), normalizeOrders(s, 'a', [...list].reverse()));
  assert.deepEqual(sortOrders([{ group: 'a10' }, { group: 'a02' }]).map((o) => o.group), ['a02', 'a10']);
});

test('Mechanik-Pakete koennen eigene Pruefungen anmelden', () => {
  registerOrderValidator('build', (o) => (o.what ? null : 'unklar, was gebaut werden soll'));
  const { events } = normalizeOrders(s, 'a', [{ group: 'a01', type: 'build', target: { x: 3, y: 3 } }]);
  assert.match(events[0].reason, /unklar/);
  assert.equal(validateOrder({ group: 'a01', type: 'build', target: { x: 3, y: 3 }, what: 'dugout' }, s, 'a'), null);
});

test('Ungueltiger Befehl landet im Rundenprotokoll und die Gruppe haelt', () => {
  const r = resolveTurn(s, [{ group: 'a01', type: 'assault', path: [{ x: 9, y: 2 }] }], [], 42, 1);
  const inv = r.log.filter((e) => e.type === 'order_invalid');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].phase, 'orders');
  assert.equal(r.log.find((e) => e.type === 'hold' && e.group === 'a01').implicit, false);
  assert.equal(r.state.groups[0].holdTurns, 1);
});
