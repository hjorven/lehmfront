import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString, placeSheet, radicalInverse, clampToStage, tiltFromPointer, tiltFromOrientation, flingDecision,
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
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('auch sieben und mehr Blaetter liegen nicht aufeinander', () => {
  const ps = [];
  for (let i = 0; i < 9; i++) ps.push(placeSheet('blatt-' + i, i, stage, sheet));
  for (let i = 0; i < ps.length; i++)
    for (let j = i + 1; j < ps.length; j++) {
      const d = Math.abs(ps[i].x - ps[j].x) + Math.abs(ps[i].y - ps[j].y);
      assert.ok(d > 60, `Blatt ${i} und ${j} zu nah: ${d}`);
    }
});

test('gedrehte Blaetter bleiben mit den Ecken in der Ebene', () => {
  const phone = { w: 390, h: 640 };
  const s = { w: 340, h: 420 };
  for (let i = 0; i < 30; i++) {
    const p = placeSheet('d' + i, i, phone, s);
    const rad = Math.abs(p.rot) * 0.01745;
    assert.ok(p.x - (s.h * rad) / 2 >= 0 && p.x + s.w + (s.h * rad) / 2 <= phone.w + 1, `x ${p.x} rot ${p.rot}`);
  }
});

test('nach dem Ziehen bleibt ein greifbarer Rest sichtbar', () => {
  const c = clampToStage({ x: -900, y: 5000, rot: 3 }, stage, sheet);
  assert.equal(c.x, 64 - sheet.w);
  assert.equal(c.y, stage.h - 64);
  assert.equal(c.rot, 3);
  // hohes Blatt darf nach oben hinaus, damit das untere Ende lesbar wird
  const tall = clampToStage({ x: 0, y: -2000, rot: 0 }, { w: 844, h: 280 }, { w: 300, h: 450 });
  assert.equal(tall.y, 64 - 450);
  assert.equal(clampToStage({ x: 0, y: -50, rot: 0 }, stage, { w: 100, h: 50 }).y, 0);
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

test('Neigungssensor im Querformat: Achsen getauscht', () => {
  // Querformat 90 Grad: Vor-zurueck-Neigung kommt aus gamma
  assert.deepEqual(tiltFromOrientation(0, -40, 6, 40, 90), { rx: 0, ry: 0 });
  assert.equal(tiltFromOrientation(30, -40, 6, 40, 90).ry, 6);
  assert.equal(tiltFromOrientation(0, -70, 6, 40, 90).rx, -6);
  assert.deepEqual(tiltFromOrientation(0, 40, 6, 40, 270), { rx: 0, ry: 0 });
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

test('Halton-Folge streut gleichmaessig', () => {
  assert.equal(radicalInverse(1, 2), 0.5);
  assert.equal(radicalInverse(2, 2), 0.25);
  assert.equal(radicalInverse(3, 2), 0.75);
  assert.ok(Math.abs(radicalInverse(1, 3) - 1 / 3) < 1e-12);
  assert.equal(radicalInverse(0, 2), 0);
});
