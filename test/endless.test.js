// P22 Endlosmodus "Frontabschnitt" und Wochenlage: Kalender, Stabsbefehle, Woche vorbereiten und abschliessen,
// Punkte nach Plan 8.3, Enden, Jahreszeiten im Wetter, Blaetter am Wochentisch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRng } from '../js/rng.js';
import { rollWeather } from '../js/weather.js';
import { getDigFactor } from '../js/phases/dig.js';
import { groundHeld } from '../js/ai/match.js';
import { indexTexts } from '../js/narrative/texts.js';
import { TEXT_FILES } from '../js/ui/narrative/load.js';
import { buildWeekSteps, stampSheet } from '../js/narrative/endless.js';
import {
  seasonOf, isSeasonStart, actOfWeek, enemyDifficulty, enemyPressure, groupReplacementsFor, newRun, prepareWeek, generateOrder,
  judgeOrder, finishWeek, weekOver, weekRounds, stampWeek, checkRunEnd, pointsOf, wochenlageBrief, fallLimit, trenchSideAt, rosterOf,
  WEEK_ROUNDS,
} from '../js/modes/endless.js';
import { ENTRIES, setupRun, playWeek, nextWeek } from './helpers-endless.js';

const INDEX = indexTexts(TEXT_FILES.map((f) => JSON.parse(readFileSync(new URL('../data/' + f, import.meta.url), 'utf8'))));

test('Kalender: Jahreszeit alle sechs Wochen, Akt wie die Kampagne, Gegner wird schwerer', () => {
  assert.deepEqual([1, 6, 7, 12, 13, 19, 24, 25].map(seasonOf), ['sommer', 'sommer', 'herbst', 'herbst', 'winter', 'fruehling', 'fruehling', 'sommer']);
  assert.deepEqual([1, 6, 7, 13, 14].map(isSeasonStart), [false, false, true, true, false]);
  assert.deepEqual([1, 7, 13, 19, 40].map(actOfWeek), [1, 2, 3, 4, 4]);
  assert.deepEqual([1, 2, 3, 7, 8].map(enemyDifficulty), ['rekrut', 'rekrut', 'veteran', 'veteran', 'lask']);
  for (let w = 1; w < 30; w++) {
    const a = enemyPressure(w), b = enemyPressure(w + 1);
    for (const k of ['experience', 'extraGroups', 'ammoPct', 'morale']) assert.ok(b[k] >= a[k], `${k} faellt nicht in Woche ${w + 1}`);
  }
  assert.deepEqual([10, 34, 35, 69, 70].map(groupReplacementsFor), [0, 0, 1, 1, 2]);
});

test('Jahreszeit im Wetter: Herbst regnet mehr als Sommer, ohne Jahreszeit wie vorher', () => {
  const count = (season) => {
    const rng = createRng(5);
    let w = { kind: 'clear', season };
    let rain = 0;
    for (let i = 0; i < 2000; i++) { w = { ...rollWeather(rng, w), season }; if (w.kind === 'rain' || w.kind === 'storm') rain++; }
    return rain;
  };
  assert.ok(count('herbst') > count('sommer') * 1.5);
  const a = rollWeather(createRng(9), { kind: 'rain' }), b = rollWeather(createRng(9), { kind: 'rain', season: 'unbekannt' });
  assert.deepEqual(a, b);
});

test('Frost: Grabfaktor im Winter, sonst nichts', () => {
  const f = getDigFactor('jahreszeit');
  assert.equal(f({ state: { weather: { season: 'winter' } } }).pct, 60);
  assert.equal(f({ state: { weather: { season: 'sommer' } } }), null);
  assert.equal(f({ state: { weather: {} } }), null);
});

test('Woche vorbereiten: Jahreszeit, Achsen, Nachschub nicht doppelt, Wochenbeginn in der Uhr', () => {
  const { run, map, state } = setupRun();
  assert.equal(state.endless.week, 1);
  assert.equal(state.weather.season, 'sommer');
  assert.equal(state.act, 1);
  assert.equal(weekRounds(state), 0);
  const again = prepareWeek(state, run, map);
  assert.deepEqual(again.sides.a.supplies.income, state.sides.a.supplies.income, 'Nachschub haengt nur am Ansehen, nicht an der Zahl der Aufrufe');
  const low = prepareWeek(state, { ...run, ansehen: 0 }, map);
  assert.ok(low.sides.a.supplies.income.ammo < state.sides.a.supplies.income.ammo);
  assert.equal(low.sides.a.reputation, 0);
  // Die Phase zaehlt die Stellungsrunden; ohne Zaehler gilt die Uhr (14 Stellungsrunden sind 7 Tage)
  const later = { ...state, endless: { ...state.endless, rounds: WEEK_ROUNDS } };
  assert.equal(weekRounds(later), WEEK_ROUNDS);
  const { rounds: _r, ...noCount } = state.endless;
  assert.equal(weekRounds({ ...state, endless: noCount, clock: { ...state.clock, day: state.clock.day + 7 } }), WEEK_ROUNDS);
  assert.ok(weekOver(later));
  assert.ok(!weekOver({ ...later, turnKind: 'battle' }), 'ein laufendes Gefecht wird zu Ende gefuehrt');
});

test('Gegner wird staerker, aufgeriebene eigene Gruppen kommen nach Ansehen als Ersatz', () => {
  const { run, map, state } = setupRun();
  const s = structuredClone(state);
  const own = s.groups.filter((g) => g.side === 'a').sort((p, q) => (p.id < q.id ? -1 : 1));
  own[0].status = 'lost';
  own[0].strength = 0;
  const foeBefore = s.groups.filter((g) => g.side === 'b' && g.status !== 'lost').length;
  const w5 = prepareWeek(s, { ...run, week: 5, ansehen: 50 }, map);
  const foeAfter = w5.groups.filter((g) => g.side === 'b' && g.status !== 'lost');
  assert.equal(foeAfter.length, foeBefore + enemyPressure(5).extraGroups);
  assert.ok(foeAfter.every((g) => g.experience >= enemyPressure(5).experience));
  assert.equal(w5.endless.arrivals.length, 1);
  const fresh = w5.groups.find((g) => g.id === w5.endless.arrivals[0].id);
  assert.equal(fresh.type, own[0].type);
  assert.equal(fresh.experience, 0);
  assert.equal(fresh.since, 5);
  assert.equal(w5.groups.find((g) => g.id === own[0].id).replaced, fresh.id);
  // Einmal ersetzt bleibt ersetzt; unter 35 Ansehen kommt niemand
  assert.equal(prepareWeek(w5, { ...run, week: 6, ansehen: 50 }, map).endless.arrivals.length, 0);
  assert.equal(prepareWeek(s, { ...run, week: 5, ansehen: 20 }, map).endless.arrivals.length, 0);
  // Ids bleiben eindeutig und sortiert
  const ids = w5.groups.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort());
  assert.ok(rosterOf(w5, { ...run, week: 5 }).some((r) => r.id === fresh.id && r.since === 5));
});

test('Stabsbefehl: Woche 1 halten, rein aus dem Seed, Ziel auf der Karte, Platzhalter gefuellt', () => {
  const { run, map, state } = setupRun();
  const o = generateOrder(ENTRIES, run, state, map);
  assert.equal(o.befehlsart, 'halten');
  assert.deepEqual(generateOrder(ENTRIES, run, state, map), o);
  assert.ok(!/[{}]/.test(o.text + o.frist), o.text);
  assert.ok(o.text.includes('VAN AURACH'));
  const kinds = new Set();
  for (let w = 2; w < 40; w++) {
    const x = generateOrder(ENTRIES, { ...run, week: w }, state, map);
    kinds.add(x.befehlsart);
    assert.ok(!/[{}]/.test(x.text), x.text);
    if (x.target) assert.ok(x.target.x >= 0 && x.target.x < map.width && x.target.y >= 0 && x.target.y < map.height);
    if (x.befehlsart === 'feld_nehmen') assert.equal(trenchSideAt(state, map, x.target.x, x.target.y), 'enemy');
  }
  assert.ok(kinds.has('feld_nehmen') && kinds.has('stosstrupp') && kinds.has('gefangene'));
  assert.ok(!kinds.has('graben_zuruecknehmen'), 'ohne verlorenen Graben nichts zurueckzunehmen');
  const short = generateOrder(ENTRIES, { ...run, week: 5, ansehen: 20 }, state, map);
  assert.equal(short.id, 'endlos.befehl.knapp');
  // Verlorener Graben: der Stab will ihn zurueck
  const lostCell = map.cells.find((c) => c.trench?.side === 'own' && c.trench.kind === 'fire');
  const s2 = structuredClone(state);
  s2.cells[lostCell.x + ',' + lostCell.y] = { trench: { ...lostCell.trench, side: 'enemy' } };
  const back = Array.from({ length: 20 }, (_, i) => generateOrder(ENTRIES, { ...run, week: i + 2 }, s2, map)).filter((x) => x.befehlsart === 'graben_zuruecknehmen');
  assert.ok(back.length > 0);
  assert.deepEqual(back[0].target, { x: lostCell.x, y: lostCell.y });
});

test('Befehl pruefen: halten, Feld nehmen, Gefangene, Stosstrupp', () => {
  const { run, map, state } = setupRun();
  const own = map.cells.find((c) => c.trench?.side === 'own' && c.trench.kind === 'fire');
  const foe = map.cells.find((c) => c.trench?.side === 'enemy' && c.trench.kind === 'fire');
  const lost = structuredClone(state);
  lost.cells[own.x + ',' + own.y] = { trench: { ...own.trench, side: 'enemy' } };
  assert.equal(groundHeld(lost, map, 'b'), 1);
  const halten = { befehlsart: 'halten', feld: '1/1' };
  assert.equal(judgeOrder(halten, { start: state, end: state, map }).met, true);
  assert.equal(judgeOrder(halten, { start: state, end: lost, map }).met, false);
  const take = { befehlsart: 'feld_nehmen', target: { x: foe.x, y: foe.y }, feld: 'X' };
  assert.equal(judgeOrder(take, { start: state, end: state, map }).met, false);
  const taken = structuredClone(state);
  taken.cells[foe.x + ',' + foe.y] = { trench: { ...foe.trench, side: 'own' } };
  assert.equal(judgeOrder(take, { start: state, end: taken, map }).met, true);
  const pris = { befehlsart: 'gefangene', need: 2 };
  const one = [{ log: [{ type: 'group_captured', side: 'b', count: 1, at: { x: 1, y: 1 } }] }];
  assert.equal(judgeOrder(pris, { start: state, end: state, map, rounds: one }).met, false);
  assert.equal(judgeOrder(pris, { start: state, end: state, map, rounds: [...one, ...one] }).met, true);
  const raid = { befehlsart: 'stosstrupp', target: { x: foe.x, y: foe.y }, feld: 'X' };
  assert.equal(judgeOrder(raid, { start: state, end: state, map, rounds: [] }).met, false);
  assert.equal(judgeOrder(raid, { start: state, end: state, map, rounds: [{ log: [{ type: 'melee', side: 'a', outcome: 'repelled', at: { x: foe.x + 1, y: foe.y } }] }] }).met, false, 'abgewiesen zaehlt nicht');
  assert.equal(judgeOrder(raid, { start: state, end: state, map, rounds: [{ log: [{ type: 'melee', side: 'a', outcome: 'taken', at: { x: foe.x + 1, y: foe.y } }] }] }).met, true);
  // Zerstoerter Graben (trench: null) gehoert niemandem, auch wenn die Karte ihn noch kennt
  const gone = structuredClone(state);
  gone.cells[foe.x + ',' + foe.y] = { trench: null };
  assert.equal(trenchSideAt(gone, map, foe.x, foe.y), null);
  const dead = structuredClone(state);
  for (const g of dead.groups) if (g.side === 'a') g.status = 'lost';
  assert.equal(judgeOrder(halten, { start: state, end: dead, map }).met, false);
  assert.ok(run);
});

test('Woche abschliessen: Punkte nach Plan 8.3, naechste Woche, Buch des Abschnitts', () => {
  const { run, map, state } = setupRun();
  const end = structuredClone(state);
  end.sides.a.supply = { ...(end.sides.a.supply ?? {}), stats: { ...(end.sides.a.supply?.stats ?? {}), woundedCarried: (state.sides.a.supply?.stats?.woundedCarried ?? 0) + 3 } };
  const g = end.groups.find((x) => x.side === 'a');
  const rounds = [{ turn: 2, log: [{ type: 'losses', side: 'a', group: g.id, amount: 3, at: g.pos, reason: 'x' }, { type: 'wounded', side: 'a', group: g.id, count: 1, at: g.pos, reason: 'x' }] }];
  const f = finishWeek(run, { start: state, end, rounds, map });
  assert.equal(f.record.held, true);
  assert.equal(f.record.fallen, 2);
  assert.equal(f.record.rescued, 3);
  assert.equal(f.run.score.points, 100 + 3 * 2 - 2 * 3);
  assert.equal(f.run.score.points, pointsOf(f.run.score));
  assert.equal(f.run.week, 2);
  assert.equal(f.run.order, null);
  assert.equal(f.run.book.fallen.length, 2);
  assert.ok(f.run.book.fallen.every((x) => x.missionTitle === 'Woche 1'));
  assert.equal(f.run.weeks.length, 1);
  assert.equal(f.run.ended, null);
  // Rein: gleiche Eingabe, gleiches Ergebnis
  assert.deepEqual(finishWeek(run, { start: state, end, rounds, map }), f);
  // Feld verlieren und zuruecknehmen bringt keine Punkte doppelt
  const foe = map.cells.find((c) => c.trench?.side === 'enemy' && c.trench.kind === 'fire');
  const won = structuredClone(state);
  won.cells[foe.x + ',' + foe.y] = { trench: { ...foe.trench, side: 'own' } };
  const w1 = finishWeek(run, { start: state, end: won, map });
  assert.equal(w1.record.gained, 1);
  const w2 = finishWeek(w1.run, { start: state, end: won, map });
  assert.equal(w2.record.gained, 0);
});

test('Enden: Abschnitt gefallen, Meuterei, Abloesung, Wochenlage nach vier Wochen', () => {
  const { run, map, state } = setupRun();
  const fallen = structuredClone(state);
  let n = 0;
  for (const c of map.cells) {
    if (c.trench?.side !== 'own' || c.trench.kind !== 'fire' || n >= fallLimit(map)) continue;
    fallen.cells[c.x + ',' + c.y] = { trench: { ...c.trench, side: 'enemy' } };
    n++;
  }
  assert.equal(finishWeek(run, { start: state, end: fallen, map }).run.ended, 'abschnitt_gefallen');
  assert.equal(finishWeek({ ...run, vertrauen: 5 }, { start: state, end: state, map }).run.ended, 'meuterei');
  assert.equal(finishWeek({ ...run, ansehen: 5 }, { start: state, end: state, map }).run.ended, 'abgeloest');
  const wl = { ...run, mode: 'wochenlage', week: 4 };
  const f = finishWeek(wl, { start: state, end: state, map });
  assert.equal(f.run.ended, 'wochenlage');
  assert.equal(f.run.endWeek, 4);
  assert.equal(finishWeek({ ...wl, week: 3 }, { start: state, end: state, map }).run.ended, null);
});

test('Stempel: verweigern kostet sofort Ansehen, ein Stempel je Woche, unter 10 abgeloest', () => {
  const { run } = setupRun();
  const r = stampWeek(run, 'verweigern');
  assert.equal(r.stamps.w1, 'verweigern');
  assert.ok(r.ansehen < run.ansehen && r.vertrauen > run.vertrauen);
  assert.deepEqual(stampWeek(r, 'befolgen'), { ...r, ended: r.ended ?? null, endWeek: r.endWeek ?? null });
  const low = checkRunEnd(stampWeek({ ...run, ansehen: 12 }, 'verweigern'));
  assert.equal(low.ended, 'abgeloest');
  assert.equal(stampSheet(run.order).options.length, 3);
});

test('Wochenlage: fester Seed fuer alle', () => {
  const a = wochenlageBrief(20261109);
  assert.deepEqual(wochenlageBrief(20261109), a);
  assert.notDeepEqual(wochenlageBrief(20261116), a);
  assert.equal(newRun(a).mode, 'wochenlage');
});

test('Wochentisch: Blaetter fuer Woche 1, nach einer Woche und am Ende, alle Platzhalter gefuellt', () => {
  const { run, map, state } = setupRun();
  const first = buildWeekSteps(INDEX, { run, state, map });
  assert.deepEqual(first.map((s) => s.kind), ['diary', 'order', 'decision']);
  const end = structuredClone(state);
  const g = end.groups.find((x) => x.side === 'a');
  const rounds = [{ turn: 2, log: [{ type: 'losses', side: 'a', group: g.id, amount: 2, at: g.pos, reason: 'x' }] }];
  const f = finishWeek(run, { start: state, end, rounds, map });
  const next = prepareWeek(end, f.run, map);
  f.run.order = generateOrder(ENTRIES, f.run, next, map);
  const steps = buildWeekSteps(INDEX, { run: f.run, record: f.record, changes: f.changes, casualties: f.casualties, rounds, endState: end, state: next, map });
  const kinds = steps.map((s) => s.kind);
  assert.deepEqual([kinds[0], kinds[1]], ['casualties', 'briefing']);
  assert.ok(kinds.includes('fieldpost'));
  assert.deepEqual(kinds.slice(-3), ['diary', 'order', 'decision']);
  assert.equal(steps[0].sheet.entries.length, 2);
  const text = JSON.stringify(steps.map((s) => s.sheet));
  assert.ok(!/\{[a-z_]+\}/.test(text), text.match(/\{[a-z_]+\}/)?.[0]);
  for (const grund of ['abschnitt_gefallen', 'abgeloest', 'meuterei', 'wochenlage']) {
    const r = { ...f.run, ended: grund, endWeek: 1 };
    const s = buildWeekSteps(INDEX, { run: r, record: f.record, changes: f.changes, casualties: f.casualties, rounds, endState: end, state: end, map });
    const last = s[s.length - 1];
    assert.equal(last.section, 'Ende des Abschnitts');
    assert.ok(!/\{[a-z_]+\}/.test(JSON.stringify(last.sheet)), grund);
  }
});

test('Zwei Wochen KI gegen KI: derselbe Lauf bei gleichem Seed, Woche endet nach 14 Stellungsrunden', () => {
  const play = () => {
    let { run, map, state } = setupRun();
    const out = [];
    for (let w = 0; w < 2 && !run.ended; w++) {
      run.vertrauen = 70;
      state = prepareWeek(state, run, map);
      const { end, rounds } = playWeek(state, run, map);
      if (!end.result) assert.equal(weekRounds(end), WEEK_ROUNDS);
      const r = nextWeek(run, map, state, end, rounds);
      run = r.run;
      state = r.state;
      out.push(r.record);
    }
    return { run, out };
  };
  const a = play(), b = play();
  assert.deepEqual(a, b);
  assert.ok(a.out.length >= 1);
});
