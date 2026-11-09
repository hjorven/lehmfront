// Grundausbildung (js/config/drill.js) und Handbuch (js/config/handbook.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRILL_STEPS, DRILL_PATH, nextStep, readDrill, writeDrill, DRILL_KEY } from '../js/config/drill.js';
import { HANDBOOK_ROUND, HANDBOOK_VALUES, HANDBOOK_TERMS, HANDBOOK_TIPS, HANDBOOK_INTRO } from '../js/config/handbook.js';
import { createOrderBook, setOrder } from '../js/ui/orderbook.js';

function fakeApi(over = {}) {
  return {
    state: { turn: 1, groups: [{ id: 'a01', side: 'a', pos: { x: 1, y: 1 } }, { id: 'b01', side: 'b', pos: { x: 9, y: 1 } }] },
    book: createOrderBook(), side: 'a', selected: null, cam: { x: 10, y: 10, zoom: 20 }, toolInfo: null, plans: { a: {}, b: {} },
    ...over,
  };
}
const step = (id) => DRILL_STEPS.find((s) => s.id === id);
const start = { turn: 1, cam: { x: 10, y: 10, zoom: 20 } };

test('Schritte: eindeutige ids, Text, Absender, genau ein letzter Schritt am Ende', () => {
  const ids = new Set();
  for (const s of DRILL_STEPS) {
    assert.ok(!ids.has(s.id), s.id); ids.add(s.id);
    assert.ok(s.title && s.text.length > 40 && s.von, s.id);
    assert.ok(s.manual || s.final || typeof s.done === 'function', `${s.id} braucht done oder Weiter`);
  }
  assert.equal(DRILL_STEPS.filter((s) => s.final).length, 1);
  assert.ok(DRILL_STEPS[DRILL_STEPS.length - 1].final);
  assert.match(DRILL_PATH, /scene=gefecht/);
  assert.match(DRILL_PATH, /ausbildung=1/);
});

test('Bedingungen: Wählen, Bewegen, Graben, MG, Runde, Loren', () => {
  assert.equal(step('waehlen').done(fakeApi(), start), false);
  assert.equal(step('waehlen').done(fakeApi({ selected: 'b01' }), start), false, 'fremde Gruppe zählt nicht');
  assert.equal(step('waehlen').done(fakeApi({ selected: 'a01' }), start), true);
  const book = setOrder(createOrderBook(), 'a', { group: 'a01', type: 'redeploy', path: [{ x: 0, y: 1 }] });
  assert.equal(step('bewegen').done(fakeApi({ book }), start), true);
  assert.equal(step('graben').done(fakeApi({ book }), start), false);
  const dug = setOrder(createOrderBook(), 'a', { group: 'a01', type: 'dig', path: [{ x: 1, y: 2 }] });
  assert.equal(step('graben').done(fakeApi({ book: dug }), start), true);
  const mg = setOrder(createOrderBook(), 'a', { group: 'a01', type: 'sector', target: { x: 5, y: 1 } });
  assert.equal(step('mg').done(fakeApi({ book: mg }), start), true);
  assert.equal(step('runde').done(fakeApi(), start), false);
  assert.equal(step('runde').done(fakeApi({ state: { ...fakeApi().state, turn: 2 } }), start), true);
  assert.equal(step('loren').done(fakeApi({ toolInfo: { id: 'supply' } }), start), true);
  assert.equal(step('karte').manual, true, 'Lesen mit Weiter, kein Weiterschalten durch Kamerasprünge');
});

test('nextStep hält an Schritten mit Weiter und überspringt geschaffte', () => {
  const steps = [{ id: 'a', done: () => true }, { id: 'b', done: () => false }, { id: 'c', manual: true }, { id: 'z', final: true }];
  assert.equal(nextStep(steps, {}, {}), 1);
  assert.equal(nextStep(steps, {}, {}, 2), 2);
  assert.equal(nextStep([{ id: 'a', done: () => true }, { id: 'z', final: true }], {}, {}), 1);
});

test('Fortschritt liest und schreibt JSON, kaputter Speicher stört nicht', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.equal(readDrill(storage), null);
  writeDrill({ step: 3, done: false }, storage);
  assert.deepEqual(readDrill(storage), { step: 3, done: false });
  mem.set(DRILL_KEY, '{kaputt');
  assert.equal(readDrill(storage), null);
  assert.equal(readDrill({ getItem: () => { throw new Error('gesperrt'); } }), null);
});

test('Handbuch: vollständige Einträge, keine Emojis, Begriffe alphabetisch', () => {
  const all = [HANDBOOK_INTRO, ...HANDBOOK_TIPS, ...[...HANDBOOK_ROUND, ...HANDBOOK_VALUES, ...HANDBOOK_TERMS].flat()];
  for (const t of all) {
    assert.ok(typeof t === 'string' && t.length > 2);
    assert.ok(!/\p{Extended_Pictographic}/u.test(t), t);
  }
  assert.equal(HANDBOOK_TIPS.length, 10);
  assert.equal(HANDBOOK_ROUND.length, 5);
  const terms = HANDBOOK_TERMS.map(([k]) => k);
  assert.deepEqual([...terms].sort((a, b) => a.localeCompare(b, 'de')), terms, 'Begriffe alphabetisch');
  for (const need of ['Traverse', 'Längsfeuer', 'Unterstand', 'Feuerwalze', 'Lorenplan', 'WEGO']) assert.ok(terms.includes(need), need);
});
