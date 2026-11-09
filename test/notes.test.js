// Bleistiftnotizen aus dem Protokoll (js/ui/margin-notes.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginNotes, NOTE_RULES, MAX_NOTES } from '../js/ui/margin-notes.js';

const ev = (type, side, at, extra = {}) => ({ type, side, at, reason: 'x', phase: 'fire', ...extra });

test('Notizen entstehen nur aus Ereignissen der eigenen Seite und tragen den Ort', () => {
  const rounds = [
    { turn: 1, log: [ev('losses', 'a', { x: 5, y: 5 }, { cause: 'enfilade' }), ev('losses', 'b', { x: 30, y: 5 }, { cause: 'enfilade' })] },
    { turn: 2, log: [ev('assault', 'a', { x: 10, y: 8 }, { wire: { x: 12, y: 8 } }), ev('flood', 'a', { x: 3, y: 9 })] },
  ];
  const a = marginNotes(rounds, 'a');
  assert.deepEqual(a.map((n) => n.kind), ['traverse', 'wire', 'flood']);
  assert.deepEqual([a[1].x, a[1].y], [12, 8], 'Draht: Notiz am Drahtfeld');
  assert.match(a[0].text, /Traverse fehlt/);
  const b = marginNotes(rounds, 'b');
  assert.equal(b.length, 1);
  assert.equal(b[0].x, 30);
});

test('Gleiche Art in der Nähe wird zusammengefasst, höchstens MAX_NOTES, die jüngsten bleiben', () => {
  const log = [];
  for (let i = 0; i < 20; i++) log.push(ev('losses', 'a', { x: i * 10, y: 0 }, { cause: 'enfilade' }));
  log.push(ev('losses', 'a', { x: 191, y: 1 }, { cause: 'enfilade' }));
  const n = marginNotes([{ turn: 3, log }], 'a');
  assert.equal(n.length, MAX_NOTES);
  assert.deepEqual([n[n.length - 1].x, n[n.length - 1].y], [191, 1], 'die jüngste ersetzt die alte daneben');
  assert.ok(!n.some((x) => x.x === 190));
});

test('Jede Regel hat Art und Text; Ereignisse ohne Regel geben nichts', () => {
  for (const r of NOTE_RULES) { assert.ok(r.kind && r.text && typeof r.when === 'function'); }
  assert.deepEqual(marginNotes([{ turn: 1, log: [ev('move', 'a', { x: 1, y: 1 })] }], 'a'), []);
  assert.deepEqual(marginNotes(undefined, 'a'), []);
});
