// P07: Phasenfilm (Abschnitte, Nachrechnen aus dem Startzustand, Wege, Uebergang) und Protokoll-Archiv
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { phasesFor, registerPhase, unregisterPhase, ORDER } from '../js/phases/registry.js';
import { planMove } from '../js/ui/tools/move.js';
import {
  planFilm, planSections, replayTo, tracksBetween, trackPos, trackUpTo, sectionAt, transitionAt, clockDuring,
  stopText, linesUntil, nextStop, sectionOf, TIMING,
} from '../js/film.js';
import { createArchive, archiveRound, inputOf, entryTitle } from '../js/archive.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const MAP = loadMap(read('../data/maps/asse.json'));
const SCEN = read('../data/scenarios/asse-frei.json');
const env = { map: MAP };

function round(seed = 11) {
  const state = createInitialState(MAP, SCEN, seed);
  const own = state.groups.filter((g) => g.side === 'a');
  const path = planMove(MAP, state, own[0], { x: 24, y: 9 }).path;
  const ordersA = [{ group: own[0].id, type: 'redeploy', path }, { group: own[2].id, type: 'hold' }];
  const input = { state, ordersA, ordersB: [], seed, turn: state.turn, env };
  const result = resolveTurn(state, ordersA, [], seed, state.turn, env);
  return { input, result, own };
}

test('sectionOf ordnet Phasen der Abteilung aus ORDER zu', () => {
  assert.equal(sectionOf(ORDER.position.movement, 'position'), 'movement');
  assert.equal(sectionOf(ORDER.position.movement + 5, 'position'), 'movement');
  assert.equal(sectionOf(ORDER.battle.fire + 1, 'battle'), 'fire');
  assert.equal(sectionOf(ORDER.position.clock, 'position'), 'clock');
});

test('replayTo: alle Phasen ergeben genau den Zustand der vollen Runde', () => {
  const { input, result } = round();
  const n = phasesFor(input.state.turnKind).length;
  assert.deepEqual(replayTo(input, n).state, result.state);
  assert.deepEqual(replayTo(input, n).log, result.log);
});

test('replayTo: Zwischenstand nach der Bewegung hat die Endpositionen, davor die alten', () => {
  const { input, result, own } = round();
  const film = planFilm(input, result, 'a');
  const mv = film.sections.find((s) => s.key === 'movement');
  assert.ok(mv, 'Bewegung ist ein Abschnitt');
  const after = replayTo(input, mv.upto).state;
  const before = replayTo(input, mv.upto - mv.phaseIds.length).state;
  const g0 = (s) => s.groups.find((g) => g.id === own[0].id).pos;
  assert.deepEqual(g0(after), g0(result.state));
  assert.deepEqual(g0(before), g0(input.state));
  // Startzustand bleibt unberuehrt
  assert.deepEqual(input.state.groups.find((g) => g.id === own[0].id).pos, own[0].pos);
});

test('replayTo ist deterministisch', () => {
  const { input } = round(99);
  assert.deepEqual(replayTo(input, 2), replayTo(input, 2));
});

test('planFilm: Abschnitte lueckenlos, letzter ist die Uhr, Zeilen in Zeitordnung mit STOP', () => {
  const { input, result } = round();
  const film = planFilm(input, result, 'a');
  let t = 0;
  for (const s of film.sections) { assert.equal(s.start, t); assert.ok(s.dur > 0); t += s.dur; }
  assert.equal(film.total, t);
  assert.equal(film.sections[film.sections.length - 1].key, 'clock');
  assert.ok(film.sections[film.sections.length - 1].dur >= TIMING.last);
  assert.ok(film.lines.length >= 3);
  for (let i = 1; i < film.lines.length; i++) assert.ok(film.lines[i].time >= film.lines[i - 1].time);
  for (const l of film.lines) {
    assert.match(l.text, / STOP$/);
    assert.ok(Number.isInteger(l.at.x) && Number.isInteger(l.at.y));
    assert.match(l.head, /^\d{4} [A-ZÄÖÜ]+( · FELD \d+\/\d+)?$/);
    assert.ok(l.time < film.total);
  }
  // Nacht bricht an: Zeile im letzten Abschnitt
  assert.ok(film.lines.some((l) => l.type === 'nightfall' && l.section === film.sections.length - 1));
});

test('planFilm: Seite b sieht keine Befehle und kein Halten von Seite a', () => {
  const { input, result } = round();
  const film = planFilm(input, result, 'b');
  assert.ok(!film.lines.some((l) => l.type === 'redeploy'));
  const holds = film.lines.filter((l) => l.type === 'hold');
  assert.ok(holds.length > 0 && holds.every((l) => l.group?.startsWith('b')));
});

test('planSections: leere Abschnitte fallen weg, Bewegung und der letzte bleiben', () => {
  const phases = phasesFor('position');
  const s = planSections('position', phases, []);
  assert.deepEqual(s.map((x) => x.key), ['movement', 'clock']);
  assert.equal(s[1].upto, phases.length);
});

test('planSections: neue Phase eines anderen Pakets bekommt eigenen Reiter', () => {
  registerPhase({ id: 'film-test-fire', kind: 'battle', order: ORDER.battle.fire, run(ctx) {
    ctx.emit('losses', { side: 'a', group: 'a01', reason: 'Längsfeuer aus Nordost.', at: { x: 3, y: 4 } });
  } });
  try {
    const state = createInitialState(MAP, SCEN, 5);
    state.turnKind = 'battle'; state.battle = { round: 1 };
    const input = { state, ordersA: [], ordersB: [], seed: 5, turn: 1, env };
    const result = resolveTurn(state, [], [], 5, 1, env);
    const film = planFilm(input, result, 'a');
    const fire = film.sections.find((x) => x.key === 'fire');
    assert.ok(fire);
    assert.equal(fire.label, 'Feuer');
    const line = film.lines.find((l) => l.type === 'losses');
    assert.equal(line.tone, 'warn');
    assert.equal(line.text, 'Längsfeuer aus Nordost STOP');
  } finally {
    unregisterPhase('film-test-fire');
  }
});

test('tracksBetween: gegangener Weg aus dem Befehl, sonst gerade Linie', () => {
  const { input, result, own } = round();
  const tr = tracksBetween(input.state, result.state, result.log, input.ordersA);
  const t = tr.get(own[0].id);
  assert.ok(t.length >= 2);
  assert.deepEqual(t[0], own[0].pos);
  assert.deepEqual(t[t.length - 1], result.state.groups.find((g) => g.id === own[0].id).pos);
  assert.ok(!tr.has(own[2].id), 'haltende Gruppe hat keinen Weg');
  const before = { groups: [{ id: 'x', pos: { x: 1, y: 1 } }] };
  const after = { groups: [{ id: 'x', pos: { x: 4, y: 1 } }] };
  assert.deepEqual(tracksBetween(before, after, [], []).get('x'), [{ x: 1, y: 1 }, { x: 4, y: 1 }]);
});

test('trackPos und trackUpTo laufen gleichmaessig je Schritt', () => {
  const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }];
  assert.deepEqual(trackPos(pts, 0), { x: 0, y: 0 });
  assert.deepEqual(trackPos(pts, 0.5), { x: 1, y: 0 });
  assert.deepEqual(trackPos(pts, 0.75), { x: 1, y: 1 });
  assert.deepEqual(trackPos(pts, 1), { x: 1, y: 2 });
  assert.deepEqual(trackUpTo(pts, 0.25), [{ x: 0, y: 0 }, { x: 0.5, y: 0 }]);
  assert.equal(trackUpTo(pts, 1).length, 3);
});

test('sectionAt, linesUntil, nextStop', () => {
  const { input, result } = round();
  const film = planFilm(input, result, 'a');
  assert.deepEqual(sectionAt(film.sections, 0), { index: 0, f: 0 });
  assert.equal(sectionAt(film.sections, film.total).index, film.sections.length - 1);
  assert.equal(sectionAt(film.sections, film.total).f, 1);
  assert.equal(linesUntil(film, -1), 0);
  assert.equal(linesUntil(film, film.total), film.lines.length);
  const s0 = film.sections[0];
  assert.equal(nextStop(film, 0), s0.start + s0.dur);
  assert.equal(nextStop(film, film.total), film.total);
});

test('transitionAt: nur am Ende (TIMING.transition, etwa zwei Sekunden), t von 0 bis 1', () => {
  const start = 5000 - TIMING.transition;
  assert.ok(TIMING.transition >= 1800 && TIMING.transition <= 2200);
  assert.ok(TIMING.last > TIMING.transition);
  assert.equal(transitionAt(5000, start - 1), null);
  assert.equal(transitionAt(5000, start), 0);
  assert.equal(transitionAt(5000, start + TIMING.transition / 2), 0.5);
  assert.equal(transitionAt(5000, 5000), 1);
  assert.equal(transitionAt(5000, 9000), 1);
});

test('clockDuring: Spieluhr laeuft linear mit, ueber Mitternacht', () => {
  const a = { day: 1, hour: 18, minute: 0 }, b = { day: 2, hour: 6, minute: 0 };
  assert.deepEqual(clockDuring(a, b, 1000, 0), a);
  assert.deepEqual(clockDuring(a, b, 1000, 500), { day: 2, hour: 0, minute: 0 });
  assert.deepEqual(clockDuring(a, b, 1000, 1000), b);
});

test('stopText ersetzt das Satzende', () => {
  assert.equal(stopText('Gruppe Albers hält.'), 'Gruppe Albers hält STOP');
  assert.equal(stopText('Es wird dunkel'), 'Es wird dunkel STOP');
});

test('Archiv: Runden nach Nummer, gleicher Film wie live, Eintrag ist eigenstaendig', () => {
  const { input, result } = round();
  let ar = createArchive('asse-frei');
  ar = archiveRound(ar, input, result);
  const r2 = resolveTurn(result.state, [], [], input.seed, result.state.turn, env);
  ar = archiveRound(ar, { ...input, state: result.state, ordersA: [], turn: result.state.turn }, r2);
  assert.deepEqual(ar.rounds.map((r) => r.turn), [1, 2]);
  assert.equal(entryTitle(ar.rounds[0]), 'Stellungsrunde 1');
  const e = ar.rounds[0];
  const replay = replayTo(inputOf(e, env), phasesFor(e.kind).length);
  assert.deepEqual(replay.state, result.state);
  assert.deepEqual(planFilm(inputOf(e, env), replay, 'a'), planFilm(input, result, 'a'));
  // Spaetere Aenderungen am Live-Zustand schlagen nicht ins Archiv durch
  input.state.groups[0].pos.x += 3;
  assert.notDeepEqual(ar.rounds[0].start.groups[0].pos, input.state.groups[0].pos);
  // Gleiche Runde ersetzt
  ar = archiveRound(ar, inputOf(e, env), replay);
  assert.equal(ar.rounds.length, 2);
});
