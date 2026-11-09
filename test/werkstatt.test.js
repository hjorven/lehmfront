// P25: Werkstatt (Missionseditor, Sandbox) und Lage-Code
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blankDoc, paintCell, toggleGroup, toggleGoalCell, fireRuns, judgePosition, fixRuns, docToLage, lageToDoc, MAX_GROUPS,
} from '../js/modes/werkstatt.js';
import { encodeLage, decodeLage, lageProblems, CODE_PREFIX } from '../js/modes/lage-code.js';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';

function straight() {
  const d = blankDoc('klein');
  for (let y = 1; y < 11; y++) paintCell(d, 'plan', 4, y, '=');
  return d;
}

function playable() {
  const d = straight();
  toggleGroup(d, 'a', 'rifles', 4, 3);
  toggleGroup(d, 'a', 'mg', 4, 8);
  toggleGroup(d, 'b', 'rifles', 14, 5);
  toggleGoalCell(d, 14, 5);
  d.goal.type = 'take';
  d.limit = 6;
  return d;
}

test('leeres Blatt hat die Groesse der Vorlage und gueltige Ebenen', () => {
  const d = blankDoc('mittel');
  assert.equal(d.width, 24);
  assert.equal(d.height, 16);
  const m = loadMap(docToLage(d).map);
  assert.equal(m.width, 24);
});

test('gerader Graben steht im Laengsfeuer, MG-Standort liegt in der Verlaengerung', () => {
  const runs = fireRuns(straight());
  assert.equal(runs.length, 1);
  assert.equal(runs[0].length, 10);
  assert.deepEqual(runs[0].mg, { x: 4, y: 0 });
  const j = judgePosition(straight());
  assert.equal(j.grade, 'ungenügend');
  assert.match(j.note, /10 Felder/);
});

test('Laufgraeben zaehlen nicht als Laengsfeuer', () => {
  const d = blankDoc('klein');
  for (let y = 1; y < 11; y++) paintCell(d, 'plan', 4, y, ':');
  assert.equal(fireRuns(d).length, 0);
});

test('Traversen einziehen beseitigt alle Geraden ueber drei Felder', () => {
  const d = straight();
  assert.ok(fixRuns(d) >= 1);
  assert.equal(fireRuns(d).length, 0);
  assert.equal(judgePosition(d).grade, 'sehr gut');
  // Anfang und Ende bleiben
  assert.equal(d.plan[1][4], '=');
  assert.equal(d.plan[10][4], '=');
});

test('Gruppen setzen, wegnehmen, Obergrenze, Wasser', () => {
  const d = blankDoc('klein');
  assert.equal(toggleGroup(d, 'a', 'rifles', 2, 2), 'set');
  assert.equal(toggleGroup(d, 'a', 'rifles', 2, 2), 'removed');
  assert.equal(d.groups.a.length, 0);
  paintCell(d, 'terrain', 3, 3, '~');
  assert.equal(toggleGroup(d, 'a', 'rifles', 3, 3), 'blocked');
  for (let i = 0; i < MAX_GROUPS; i++) toggleGroup(d, 'b', 'rifles', 15, i);
  assert.equal(toggleGroup(d, 'b', 'rifles', 16, 0), 'full');
});

test('Wasser verdraengt Graben und Gruppe; Hoehe bleibt zwischen 0 und 3', () => {
  const d = blankDoc('klein');
  paintCell(d, 'plan', 5, 5, '=');
  toggleGroup(d, 'a', 'rifles', 5, 5);
  paintCell(d, 'terrain', 5, 5, '~');
  assert.equal(d.plan[5][5], '.');
  assert.equal(d.groups.a.length, 0);
  for (let i = 0; i < 6; i++) paintCell(d, 'height', 1, 1, '+');
  assert.equal(d.heights[1][1], '3');
  for (let i = 0; i < 6; i++) paintCell(d, 'height', 1, 1, '-');
  assert.equal(d.heights[1][1], '0');
});

test('Lage aus dem Entwurf ist spielbar, Probleme werden deutsch gemeldet', () => {
  assert.deepEqual(lageProblems(docToLage(playable())), []);
  const empty = docToLage(blankDoc('klein'));
  const bad = lageProblems(empty);
  assert.ok(bad.some((t) => /keine Gruppe/.test(t)));
  const l = docToLage(playable());
  const s = createInitialState(loadMap(l.map), l.scenario, 1);
  assert.equal(s.groups.length, 3);
  assert.equal(l.scenario.sides.b.control, 'script');
  const d = playable(); d.enemy = 'lask';
  assert.equal(docToLage(d).scenario.sides.b.ai.difficulty, 'lask');
});

test('Lage-Code: hin und zurueck ergibt denselben Entwurf', async () => {
  const d = playable();
  d.title = 'Die Ziegelei';
  d.brief = 'Nimm die Ziegelei.';
  d.maxLosses = 5;
  const code = await encodeLage(docToLage(d));
  assert.ok(code.startsWith(CODE_PREFIX));
  assert.match(code, /^[A-Za-z0-9._-]+$/);
  const back = lageToDoc(await decodeLage(code));
  for (const k of ['terrain', 'heights', 'plan', 'groups', 'goal', 'limit', 'title', 'brief', 'maxLosses', 'zoneCols', 'enemy', 'kind']) {
    assert.deepEqual(back[k], d[k], k);
  }
});

test('Lage-Code: kaputte Codes geben eine deutsche Meldung', async () => {
  await assert.rejects(decodeLage('hallo'), /kein Lage-Code/);
  await assert.rejects(decodeLage(CODE_PREFIX + 'AAAA'), /beschädigt/);
});
