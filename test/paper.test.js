import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString, placeSheet, clampToStage, tiltFromPointer, tiltFromOrientation, flingDecision,
  bringToFront, typingSchedule, visibleChars, parseCensored, hasCensored,
} from '../js/ui/paper/layout.js';

const stage = { w: 1280, h: 700 };
const sheet = { w: 310, h: 360 };

test('gleiche ID ergibt gleiche Lage, andere ID eine andere', () => {
  assert.deepEqual(placeSheet('brief-1', 0, stage, sheet), placeSheet('brief-1', 0, stage, sheet));
  assert.notDeepEqual(placeSheet('brief-1', 0, stage, sheet), placeSheet('brief-2', 0, stage, sheet));
  assert.equal(hashString('abc'), hashString('abc'));
});

test('Blaetter liegen immer ganz in der Ebene, auch auf dem Handy', () => {
  const phone = { w: 390, h: 640 };
  const big = { w: 366, h: 420 };
  for (let i = 0; i < 40; i++) {
    for (const [st, sh] of [[stage, sheet], [phone, big]]) {
      const p = placeSheet('blatt-' + i, i, st, sh);
      assert.ok(p.x >= 8 && p.x + sh.w <= st.w - 8 + 0.5, `x ${p.x}`);
      assert.ok(p.y >= 8 && p.y + sh.h <= st.h - 8 + 0.5, `y ${p.y}`);
      assert.ok(p.rot >= -6 && p.rot <= 6);
    }
  }
});

test('Blatt groesser als die Ebene landet am Rand statt ausserhalb', () => {
  const p = placeSheet('riesig', 3, { w: 200, h: 200 }, { w: 400, h: 400 });
  assert.equal(p.x, 8);
  assert.equal(p.y, 8);
});

test('mehrere Blaetter faechern auf statt exakt uebereinander', () => {
  const xs = new Set();
  for (let i = 0; i < 5; i++) xs.add(placeSheet('x', i, stage, sheet).x);
  assert.ok(xs.size >= 4);
});

test('nach dem Ziehen bleibt ein greifbarer Rest sichtbar', () => {
  const c = clampToStage({ x: -900, y: 5000, rot: 3 }, stage, sheet);
  assert.equal(c.x, 64 - sheet.w);
  assert.equal(c.y, stage.h - 64);
  assert.equal(c.rot, 3);
});

test('Kippen folgt dem Zeiger und ist begrenzt', () => {
  assert.deepEqual(tiltFromPointer(0.5, 0.5), { rx: 0, ry: 0 });
  const t = tiltFromPointer(1, 0);
  assert.ok(t.ry > 0 && t.rx > 0);
  assert.deepEqual(tiltFromPointer(5, -5), tiltFromPointer(1, 0));
  assert.ok(Math.abs(tiltFromPointer(1, 1, 9).ry) <= 9);
});

test('Neigungssensor: Ruhelage kippt nicht, fehlende Werte auch nicht', () => {
  assert.deepEqual(tiltFromOrientation(40, 0), { rx: 0, ry: 0 });
  assert.deepEqual(tiltFromOrientation(41, 1), { rx: 0, ry: 0 });
  assert.deepEqual(tiltFromOrientation(null, null), { rx: 0, ry: 0 });
  const t = tiltFromOrientation(90, 90, 6);
  assert.equal(t.rx, -6);
  assert.equal(t.ry, 6);
});

test('schneller Wurf wischt weg, langsames Schieben nicht', () => {
  const center = { x: 600, y: 300 };
  const fast = flingDecision({ recent: { dx: 120, dy: 0, ms: 60 }, center, stage });
  assert.equal(fast.dismiss, true);
  assert.equal(fast.dirX, 1);
  assert.equal(flingDecision({ recent: { dx: 20, dy: 0, ms: 90 }, center, stage }).dismiss, false);
  // langsam, aber weit verschoben und noch in der Ebene: bleibt liegen
  assert.equal(flingDecision({ recent: { dx: 10, dy: 0, ms: 90 }, center: { x: 1200, y: 600 }, stage }).dismiss, false);
});

test('ueber den Rand gezogen wischt weg, in Richtung des Randes', () => {
  const d = flingDecision({ recent: { dx: 2, dy: 0, ms: 90 }, center: { x: 600, y: 760 }, stage });
  assert.deepEqual(d, { dismiss: true, dirX: 0, dirY: 1 });
  const l = flingDecision({ recent: { dx: 0, dy: 0, ms: 0 }, center: { x: -5, y: 300 }, stage });
  assert.equal(l.dirX, -1);
});

test('nach vorn holen aendert nur die Reihenfolge des Blattes', () => {
  assert.deepEqual(bringToFront(['a', 'b', 'c'], 'a'), ['b', 'c', 'a']);
  assert.deepEqual(bringToFront(['a', 'b', 'c'], 'c'), ['a', 'b', 'c']);
  assert.deepEqual(bringToFront(['a', 'b'], 'x'), ['a', 'b']);
});

test('Tippen: Zeilen folgen nacheinander mit Wagenruecklauf', () => {
  const plan = typingSchedule(['HALLO STOP', 'ENDE'], { cps: 10, carriage: 200, startDelay: 100 });
  assert.equal(plan[0].start, 100);
  assert.equal(plan[0].duration, 1000);
  assert.equal(plan[1].start, 100 + 1000 + 200);
  assert.equal(visibleChars(plan[0], 0), 0);
  assert.equal(visibleChars(plan[0], 600), 5);
  assert.equal(visibleChars(plan[0], 5000), 10);
  assert.equal(visibleChars(plan[1], 1200), 0);
  assert.equal(visibleChars({ text: '', start: 0, duration: 0 }, 10), 0);
});

test('Zensur: [[...]] wird geschwaerzt, Rest bleibt', () => {
  assert.deepEqual(parseCensored('im Graben bei [[Mühle]] steht Wasser'), [
    { text: 'im Graben bei ', censored: false },
    { text: 'Mühle', censored: true },
    { text: ' steht Wasser', censored: false },
  ]);
  assert.deepEqual(parseCensored('[[a]][[b]]'), [{ text: 'a', censored: true }, { text: 'b', censored: true }]);
  assert.deepEqual(parseCensored('offen [[ohne Ende'), [{ text: 'offen [[ohne Ende', censored: false }]);
  assert.deepEqual(parseCensored(''), []);
  assert.equal(hasCensored('x [[y]]'), true);
  assert.equal(hasCensored('x y'), false);
});
