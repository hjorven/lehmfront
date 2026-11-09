// Puzzle-Lagen (P25): jede Lage laedt, ihre Loesung gewinnt, die hinterlegten Irrwege verlieren.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PUZZLES } from '../js/config/puzzles.js';
import { playPuzzle, playSolution, puzzleStart } from '../js/modes/puzzle-run.js';
import { normOrder, puzzleMapJson, carryOrders, mergeCarry } from '../js/modes/puzzle.js';
import { judgeGoal, goalText, trenchPath, longestFireRun } from '../js/modes/goals.js';
import { createSteadyRng } from '../js/rng.js';
import { loadMap } from '../js/map.js';

const load = (id) => JSON.parse(readFileSync(new URL(`../data/puzzles/${id}.json`, import.meta.url), 'utf8'));

test('Puzzle: zwoelf Lagen, Nummern 1 bis 12, eindeutige IDs', () => {
  assert.equal(PUZZLES.length, 12);
  const ids = new Set();
  PUZZLES.forEach((f, i) => {
    const p = load(f);
    assert.equal(p.num, i + 1, f);
    assert.ok(!ids.has(p.id), 'doppelte ID ' + p.id);
    ids.add(p.id);
    for (const k of ['title', 'lesson', 'brief', 'solutionText', 'wonText']) assert.ok(typeof p[k] === 'string' && p[k].length > 3, `${f}: ${k}`);
    assert.ok(Array.isArray(p.hints) && p.hints.length >= 2, `${f}: Hinweise`);
    assert.ok(p.limit >= 1 && p.limit <= 12, `${f}: Frist`);
    assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(JSON.stringify(p)), `${f}: keine Emojis`);
  });
});

for (const f of PUZZLES) {
  test(`Puzzle ${f}: Karte gueltig, Loesung gewinnt, Irrwege verlieren`, () => {
    const p = load(f);
    const map = loadMap(puzzleMapJson(p));
    assert.equal(map.width, p.width);
    assert.ok(goalText(p.goal).length > 5);
    const { state } = puzzleStart(p);
    assert.equal(state.reveal, true);
    assert.equal(state.steady, true);
    const r = playSolution(p);
    assert.equal(r.verdict.status, 'won', `${f}: Loesung verliert (${r.verdict.why})`);
    // Zweimal gespielt, gleiches Ergebnis (ruhige Wuerfel)
    assert.deepEqual(playSolution(p).state, r.state);
    for (const [name, orders] of Object.entries(p.tests ?? {})) {
      const t = playPuzzle(p, (turn) => (orders[String(turn)] ?? []).map(normOrder));
      assert.equal(t.verdict.status, 'lost', `${f}: Irrweg "${name}" gewinnt`);
    }
  });
}

test('Ruhige Wuerfel: van-der-Corput-Folge, Erwartungswert ueber viele Wuerfe', () => {
  const r = createSteadyRng();
  assert.deepEqual([r(), r(), r(), r()], [0.5, 0.25, 0.75, 0.125]);
  const s = createSteadyRng();
  let hits = 0;
  for (let i = 0; i < 30; i++) if (s() < 0.2) hits++;
  assert.ok(Math.abs(hits - 6) <= 1, 'fast genau 6 Treffer bei 30 Schuss und 20 Prozent');
});

test('Ziele: Frist, Verluste, Halten, Graben ohne lange Gerade', () => {
  const p = load('06-traversen');
  const { state, map } = puzzleStart(p);
  assert.equal(judgeGoal(p, { start: state, state, map, rounds: 0 }).status, 'running');
  assert.equal(judgeGoal(p, { start: state, state, map, rounds: 1 }).status, 'lost');
  const s = structuredClone(state);
  // gerader Graben von oben nach unten: verbunden, aber zu lang
  for (let y = 2; y <= 9; y++) s.cells[`3,${y}`] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' } };
  s.cells['4,10'] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' } };
  assert.ok(trenchPath(s, map, [3, 1], [4, 10]));
  assert.ok(longestFireRun(s, map) > 3);
  assert.equal(judgeGoal(p, { start: state, state: s, map, rounds: 1 }).status, 'lost');
  const q = { ...p, maxLosses: 0 };
  const hurt = structuredClone(state);
  hurt.groups[0].strength -= 1;
  assert.match(judgeGoal(q, { start: state, state: hurt, map, rounds: 0 }).why, /Verluste/);
});

test('Restbefehle: Sturm laeuft weiter, neue Befehle ersetzen ihn', () => {
  const log = [{ type: 'assault', group: 'a01', carry: { group: 'a01', type: 'assault', path: [{ x: 1, y: 1 }] } }];
  const state = { turnKind: 'battle', groups: [{ id: 'a01', side: 'a', status: 'front' }] };
  const c = carryOrders(state, log);
  assert.equal(c.a.length, 1);
  assert.equal(mergeCarry([{ group: 'a01', type: 'hold' }], c.a).length, 1);
  assert.equal(mergeCarry([], c.a)[0].carried, true);
});
