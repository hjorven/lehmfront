// P06: Gefechtsrunde, Unterstand, Draht, Sturm, Nahkampf, Gegenstoss
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, cellLabel } from '../js/map.js';
import { createInitialState, getGroup } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { validateOrder } from '../js/orders.js';
import { roundsAlong } from '../js/phases/move.js';
import { hasDugout } from '../js/phases/dugout.js';
import { meleeOdds } from '../js/phases/melee.js';
import { BATTLE_ROUNDS, objectiveTaken, battleMinute } from '../js/phases/battle.js';
import { wireRate } from '../js/phases/wire.js';

// 20 x 7: Spalten 0-5 eigene Stellung, 6-13 Niemandsland, 14-19 feindliche Stellung
function makeMap({ w = 20, h = 7, trenches = [], wire = [] } = {}) {
  return loadMap({
    id: 'probe', width: w, height: h,
    terrain: Array.from({ length: h }, () => '.'.repeat(w)),
    heights: Array.from({ length: h }, () => '1'.repeat(w)),
    zones: Array.from({ length: h }, () => 'S'.repeat(6) + 'N'.repeat(8) + 's'.repeat(6)),
    trenches, wire,
  });
}

const enemyTrench = (x, ys) => ys.map((y) => ({ x, y, side: 'enemy', kind: 'fire', level: 2, facing: 'W' }));
const ownTrench = (x, ys) => ys.map((y) => ({ x, y, side: 'own', kind: 'fire', level: 2, facing: 'E' }));

function makeState(map, a, b, { kind = 'battle', hour = 12 } = {}) {
  const s = createInitialState(map, {
    id: 'probe', startHour: hour, turnKind: kind,
    sides: { a: { faction: 'kaldern', groups: a }, b: { faction: 'morrow', groups: b } },
  }, 11);
  if (kind === 'battle') s.battle = { round: 1 };
  return s;
}

const line = (x0, x1, y) => {
  const out = [];
  for (let x = x0; x0 <= x1 ? x <= x1 : x >= x1; x += x0 <= x1 ? 1 : -1) out.push({ x, y });
  return out;
};

const run = (s, oa, ob, map) => resolveTurn(s, oa, ob, s.seed, s.turn, { map });

// ------------------------------------------------------------------ Rundenwechsel

test('Angriff ansetzen schaltet nach der Stellungsrunde auf Gefechtsrunden, Sturmweg laeuft weiter', () => {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 5, y: 3 } }], [{ type: 'rifles', pos: { x: 17, y: 3 } }], { kind: 'position', hour: 18 });
  const path = line(6, 15, 3);
  assert.equal(validateOrder({ group: 'a01', type: 'attack', path }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a01', type: 'assault', path }, s, 'a', { map }), /Gefechtsrunde/);
  const r = run(s, [{ group: 'a01', type: 'attack', path }], [], map);
  assert.equal(r.state.turnKind, 'battle');
  assert.equal(r.state.battle.round, 1);
  assert.deepEqual(r.state.battle.attackers, ['a']);
  assert.deepEqual(r.state.battle.objectives.a, [{ x: 15, y: 3, group: 'a01' }]);
  // Die Gruppe bleibt in der Stellungsrunde stehen, ihr Sturmweg kommt als Befehl der ersten Gefechtsrunde
  assert.deepEqual(getGroup(r.state, 'a01').pos, { x: 5, y: 3 });
  const set = r.log.find((e) => e.type === 'attack_set');
  assert.deepEqual(set.carry, { group: 'a01', type: 'assault', path });
  assert.match(set.reason, /06:00 Uhr/);
  // Beide Seiten erfahren es, mit eigenem Wortlaut
  const starts = r.log.filter((e) => e.type === 'battle_start');
  assert.equal(starts.length, 2);
  assert.match(starts.find((e) => e.side === 'b').reason, /Alarm/);
  // Die Uhr springt auf Gefechtsrunden zu 5 Minuten
  const r2 = run(r.state, [{ group: 'a01', type: 'assault', path }], [], map);
  assert.equal(r2.state.clock.minute, 5);
  assert.equal(r2.state.battle.round, 2);
  assert.equal(battleMinute(r2.state), 10);
});

test('Gefecht endet nach zwoelf Gefechtsrunden, wenn der Angriff weder steckt noch das Ziel faellt', () => {
  const map = makeMap();
  // Sturm mit Weg hin und her: immer in Bewegung, nie am Ziel
  let s = makeState(map, [{ type: 'rifles', pos: { x: 3, y: 1 } }], [{ type: 'rifles', pos: { x: 18, y: 5 } }]);
  s.battle = { round: 1, attackers: ['a'], assaulters: { a: ['a01'] }, objectives: { a: [{ x: 16, y: 5, group: 'a01' }] }, counter: {}, outcome: {} };
  let rounds = 0;
  while (s.turnKind === 'battle') {
    const g = getGroup(s, 'a01');
    const path = [{ x: g.pos.x + (rounds % 2 ? -1 : 1), y: 1 }];
    const r = run(s, [{ group: 'a01', type: 'assault', path }], [], map);
    s = r.state;
    rounds++;
    if (s.turnKind === 'position') assert.match(r.log.find((e) => e.type === 'battle_end' && e.side === 'a').reason, /Stunde/);
    assert.ok(rounds <= BATTLE_ROUNDS);
  }
  assert.equal(rounds, BATTLE_ROUNDS);
  assert.equal(s.battle, null);
  assert.equal(s.lastBattle.outcome.a, 'time');
});

test('Angriff steckt, sobald alle Sturmgruppen halten', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 8, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 3 } }]);
  s.battle = { round: 2, attackers: ['a'], assaulters: { a: ['a01'] }, objectives: { a: [{ x: 15, y: 3, group: 'a01' }] }, counter: {}, outcome: {} };
  const r = run(s, [{ group: 'a01', type: 'hold' }], [], map);
  assert.equal(r.state.turnKind, 'position');
  assert.equal(r.state.lastBattle.outcome.a, 'stuck');
  assert.match(r.log.find((e) => e.type === 'battle_end' && e.side === 'b').reason, /abgewiesen/);
});

test('Ziel genommen: Sturmgruppe am Ziel, kein Feind daneben', () => {
  const map = makeMap({ trenches: enemyTrench(15, [2, 3, 4]) });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 13, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 6 } }]);
  s.battle = { round: 3, attackers: ['a'], assaulters: { a: ['a01'] }, objectives: { a: [{ x: 15, y: 3, group: 'a01' }] }, counter: {}, outcome: {} };
  assert.equal(objectiveTaken(s, 'a'), false);
  const r = run(s, [{ group: 'a01', type: 'assault', path: [{ x: 14, y: 3 }, { x: 15, y: 3 }] }], [], map);
  assert.ok(r.log.some((e) => e.type === 'breach'));
  assert.equal(r.state.cells['15,3'].trench.side, 'own');
  assert.equal(r.state.turnKind, 'position');
  assert.equal(r.state.lastBattle.outcome.a, 'taken');
});

// ------------------------------------------------------------------ Unterstand

test('Unterstand: unter Beschuss hinein, Herauskommen dauert eine Gefechtsrunde', () => {
  const map = makeMap({ trenches: ownTrench(3, [3]) });
  let s = makeState(map, [{ type: 'rifles', pos: { x: 3, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }]);
  assert.equal(hasDugout(s, map, { x: 3, y: 3 }, 'a'), true);
  assert.equal(hasDugout(s, map, { x: 4, y: 3 }, 'a'), false);
  // Runde 1: Artillerie (P09) trifft den Graben -> automatisch hinein
  getGroup(s, 'a01').shelled = true;
  let r = run(s, [], [], map);
  s = r.state;
  assert.equal(getGroup(s, 'a01').inDugout, true);
  assert.ok(r.log.some((e) => e.type === 'dugout_in' && /Beschuss/.test(e.reason)));
  assert.equal(getGroup(s, 'a01').shelled, undefined);
  // Runde 2: Beschuss geht weiter -> bleibt drin
  getGroup(s, 'a01').shelled = true;
  r = run(s, [], [], map);
  s = r.state;
  assert.equal(getGroup(s, 'a01').inDugout, true);
  assert.equal(getGroup(s, 'a01').dugout, 'in');
  // Runde 3: Feuer hoert auf -> steigt hinauf, ist aber noch nicht oben (feuert nicht, bewegt sich nicht)
  r = run(s, [{ group: 'a01', type: 'move', path: [{ x: 4, y: 3 }] }], [], map);
  s = r.state;
  assert.equal(getGroup(s, 'a01').inDugout, true);
  assert.equal(getGroup(s, 'a01').dugout, 'leaving');
  assert.deepEqual(getGroup(s, 'a01').pos, { x: 3, y: 3 });
  const mv = r.log.find((e) => e.type === 'move');
  assert.deepEqual(mv.carry, { group: 'a01', type: 'move', path: [{ x: 4, y: 3 }] });
  // Runde 4: oben
  r = run(s, [{ group: 'a01', type: 'move', path: [{ x: 4, y: 3 }] }], [], map);
  assert.equal(getGroup(r.state, 'a01').inDugout, false);
  assert.ok(r.log.some((e) => e.type === 'dugout_out'));
  assert.deepEqual(getGroup(r.state, 'a01').pos, { x: 4, y: 3 });
});

test('Unterstand: Befehl Deckung nur im eigenen Graben, im Unterstand wird nicht gefeuert', () => {
  const map = makeMap({ trenches: ownTrench(5, [3]) });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 5, y: 3 } }, { type: 'rifles', pos: { x: 5, y: 5 } }], [{ type: 'rifles', pos: { x: 9, y: 3 } }]);
  assert.equal(validateOrder({ group: 'a01', type: 'dugout' }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a02', type: 'dugout' }, s, 'a', { map }), /keinen Unterstand/);
  const r = run(s, [{ group: 'a01', type: 'dugout' }], [{ group: 'b01', type: 'fire', target: { x: 5, y: 3 } }], map);
  assert.equal(getGroup(r.state, 'a01').inDugout, true);
  assert.equal(getGroup(r.state, 'a01').strength, getGroup(s, 'a01').strength, 'im Unterstand keine Verluste');
  assert.ok(!r.log.some((e) => e.type === 'fire' && e.group === 'a01'));
});

test('Eroberter Graben hat keinen Unterstand fuer den neuen Besitzer', () => {
  const map = makeMap({ trenches: enemyTrench(15, [3]) });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 15, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }]);
  assert.equal(hasDugout(s, map, { x: 15, y: 3 }, 'b'), true);
  s.cells['15,3'] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'W', captured: true } };
  assert.equal(hasDugout(s, map, { x: 15, y: 3 }, 'a'), false);
});

// ------------------------------------------------------------------ Draht

test('Draht: feindlicher Draht haelt den Angreifer fest, Pioniere schneiden eine Gasse', () => {
  const map = makeMap({ wire: [{ x: 10, y: 2, side: 'enemy' }, { x: 10, y: 4, side: 'enemy' }] });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 9, y: 2 } }, { type: 'pioneers', pos: { x: 9, y: 4 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }]);
  const r = run(s, [
    { group: 'a01', type: 'assault', path: line(10, 12, 2) },
    { group: 'a02', type: 'assault', path: line(10, 12, 4) },
  ], [], map);
  const a1 = getGroup(r.state, 'a01'), a2 = getGroup(r.state, 'a02');
  assert.deepEqual(a1.pos, { x: 10, y: 2 }, 'Schuetzen haengen im Draht');
  assert.deepEqual(a2.pos, { x: 10, y: 4 }, 'Pioniere halten zum Schneiden an');
  assert.match(r.log.find((e) => e.group === 'a01' && e.type === 'assault').reason, /Draht fest/);
  assert.equal(r.state.cells['10,4'].wire, null);
  assert.ok(r.log.some((e) => e.type === 'wire_cut'));
  assert.equal(r.state.cells['10,2'], undefined, 'nicht geschnittener Draht bleibt');
  // Naechste Runde: aus dem Draht heraus geht es weiter
  const r2 = run(r.state, [
    { group: 'a01', type: 'assault', path: line(11, 12, 2) },
    { group: 'a02', type: 'assault', path: line(11, 12, 4) },
  ], [], map);
  assert.deepEqual(getGroup(r2.state, 'a01').pos, { x: 12, y: 2 });
  assert.deepEqual(getGroup(r2.state, 'a02').pos, { x: 12, y: 4 });
});

test('Draht: eigener Draht hat Gassen und haelt nicht fest; Vorschau kennt den Draht', () => {
  const map = makeMap({ wire: [{ x: 7, y: 3, side: 'own' }, { x: 10, y: 3, side: 'enemy' }, { x: 7, y: 5, side: 'enemy' }] });
  // Melder (Tempo 5): 50 Zehntel reichen fuer Draht (40) und ein Feld dahinter
  const s = makeState(map, [{ type: 'runners', pos: { x: 6, y: 3 } }, { type: 'runners', pos: { x: 6, y: 5 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }]);
  const est = roundsAlong(map, s, getGroup(s, 'a01'), line(7, 12, 3), 'battle', 'move');
  assert.equal(est.wire, 1);
  assert.equal(est.reach, 2, 'durch den eigenen Draht, dann reicht das Budget nicht fuer mehr');
  assert.equal(roundsAlong(map, s, getGroup(s, 'a02'), line(7, 12, 5), 'battle', 'move').reach, 1, 'feindlicher Draht haelt an');
  const r = run(s, [{ group: 'a01', type: 'move', path: line(7, 9, 3) }, { group: 'a02', type: 'move', path: line(7, 9, 5) }], [], map);
  assert.deepEqual(getGroup(r.state, 'a01').pos, { x: 8, y: 3 });
  assert.deepEqual(getGroup(r.state, 'a02').pos, { x: 7, y: 5 });
});

test('Draht verlegen: Stellungsrunde, Material je Feld, Pioniere doppelt, Rest laeuft weiter', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 5, y: 1 } }, { type: 'pioneers', pos: { x: 5, y: 5 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }], { kind: 'position' });
  const base = run(s, [], [], map).state.sides.a.supplies.material; // Versorgung (P08) bucht auch ab
  const lineA = [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }];
  const lineB = [{ x: 7, y: 5 }, { x: 7, y: 6 }];
  assert.equal(validateOrder({ group: 'a01', type: 'wire', path: lineA }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a01', type: 'wire', path: [{ x: 15, y: 1 }] }, s, 'a', { map }), /zu weit|feindlichen/);
  const ra = wireRate(getGroup(s, 'a01'), false), rp = wireRate(getGroup(s, 'a02'), false);
  assert.ok(rp > ra);
  const r = run(s, [{ group: 'a01', type: 'wire', path: lineA }, { group: 'a02', type: 'wire', path: lineB }], [], map);
  const laid = Object.keys(r.state.cells).filter((k) => r.state.cells[k].wire);
  assert.equal(laid.length, ra + 2);
  assert.equal(r.state.sides.a.supplies.material, base - laid.length);
  const ev = r.log.find((e) => e.type === 'wire' && e.group === 'a01');
  assert.equal(ev.carry.path.length, 5 - ra);
  assert.equal(r.state.cells['7,0'].wire.side, 'own');
});

// ------------------------------------------------------------------ Nahkampf

function meleeSetup({ dugout = false } = {}) {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  const s = makeState(map,
    [{ type: 'rifles', pos: { x: 13, y: 3 }, strength: 11 }, { type: 'rifles', pos: { x: 13, y: 2 }, strength: 10 }],
    [{ type: 'rifles', pos: { x: 15, y: 3 }, strength: 9 }]);
  // Im Unterstand unter Beschuss: bleibt drin, bis der Sturm da ist
  if (dugout) Object.assign(getGroup(s, 'b01'), { inDugout: true, dugout: 'in', shelled: true });
  return { map, s };
}

const meleeOrders = [
  { group: 'a01', type: 'assault', path: [{ x: 14, y: 3 }, { x: 15, y: 3 }, { x: 16, y: 3 }] },
  { group: 'a02', type: 'assault', path: [{ x: 14, y: 2 }, { x: 15, y: 3 }] },
];

test('Nahkampf ist deterministisch und begruendet', () => {
  const { map, s } = meleeSetup();
  const r1 = run(s, meleeOrders, [], map);
  const r2 = run(s, meleeOrders, [], map);
  assert.deepEqual(r1.state, r2.state);
  assert.deepEqual(r1.log, r2.log);
  const m = r1.log.find((e) => e.type === 'melee');
  assert.ok(m, 'Begegnung fuehrt zum Nahkampf');
  assert.equal(m.public, true);
  assert.deepEqual(m.at, { x: 15, y: 3 });
  assert.match(m.reason, new RegExp('Nahkampf bei ' + cellLabel(15, 3)));
  assert.match(m.reason, /im eigenen Graben/);
  assert.ok(r1.log.some((e) => e.type === 'losses' && e.cause === 'melee'));
  // Jede Begegnung ist genau einmal ausgetragen worden
  assert.equal(r1.log.filter((e) => e.type === 'melee').length, 1);
});

test('Nahkampf: gewonnen nimmt das Feld, der Verteidiger weicht den Graben entlang aus', () => {
  // Seeds durchprobieren, bis beide Ausgaenge vorkommen; jeder Ausgang muss seine Regeln erfuellen
  const seen = new Set();
  for (let seed = 1; seed < 60 && seen.size < 2; seed++) {
    const { map, s } = meleeSetup();
    s.seed = seed;
    const r = run(s, meleeOrders, [], map);
    const m = r.log.find((e) => e.type === 'melee');
    seen.add(m.outcome);
    const b = getGroup(r.state, 'b01');
    if (m.outcome === 'taken') {
      assert.deepEqual(getGroup(r.state, 'a01').pos, { x: 15, y: 3 });
      assert.equal(r.state.cells['15,3'].trench.side, 'own');
      assert.equal(r.state.cells['15,3'].trench.captured, true);
      if (b.status !== 'lost') {
        assert.equal(b.pos.x, 15, 'weicht im Graben aus');
        assert.notEqual(b.pos.y, 3);
      }
      const push = r.log.find((e) => e.type === 'melee_push' && e.group === 'a01');
      assert.deepEqual(push.carry.path, [{ x: 16, y: 3 }]);
    } else {
      assert.deepEqual(b.pos, { x: 15, y: 3 });
      assert.deepEqual(getGroup(r.state, 'a01').pos, { x: 14, y: 3 });
      assert.ok(getGroup(r.state, 'a01').suppressed >= 0.3);
      assert.deepEqual(r.log.find((e) => e.type === 'melee_push' && e.group === 'a01').carry.path, [{ x: 15, y: 3 }, { x: 16, y: 3 }]);
    }
  }
  assert.deepEqual([...seen].sort(), ['repelled', 'taken']);
});

test('Nahkampf: im Unterstand ueberrascht, Gefangenschaft statt Ausweichen', () => {
  const { map, s } = meleeSetup({ dugout: true });
  const atk = [{ g: getGroup(s, 'a01'), assault: true }];
  const open = meleeSetup();
  assert.ok(meleeOdds(s, map, atk, getGroup(s, 'b01')).p > meleeOdds(open.s, open.map, [{ g: getGroup(open.s, 'a01'), assault: true }], getGroup(open.s, 'b01')).p + 0.2);
  let captured = 0;
  for (let seed = 1; seed < 30; seed++) {
    const t = meleeSetup({ dugout: true });
    t.s.seed = seed;
    const r = run(t.s, meleeOrders, [], t.map);
    const m = r.log.find((e) => e.type === 'melee');
    if (m.outcome === 'taken') {
      assert.equal(getGroup(r.state, 'b01').status, 'lost');
      assert.ok(r.log.some((e) => e.type === 'group_captured'));
      assert.match(m.reason, /Unterstand wird ausgehoben/);
      assert.ok(!r.state.fallen.some((f) => f.group === 'b01'), 'Gefangene stehen nicht in der Gefallenenliste');
      captured++;
    }
  }
  assert.ok(captured > 20, 'Unterstand faellt fast immer');
});

test('Gegenstoss: Stabsbefehl nach dem Einbruch, Ansehen fuer den Gegenstoss', () => {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  let s = makeState(map, [{ type: 'rifles', pos: { x: 14, y: 3 } }], [{ type: 'rifles', pos: { x: 15, y: 6 } }, { type: 'rifles', pos: { x: 18, y: 1 } }]);
  s.battle = { round: 1, attackers: ['a'], assaulters: { a: ['a01'] }, objectives: { a: [{ x: 18, y: 3, group: 'a01' }] }, counter: {}, outcome: {} };
  let r = run(s, [{ group: 'a01', type: 'assault', path: [{ x: 15, y: 3 }, { x: 16, y: 3 }] }], [], map);
  const order = r.log.find((e) => e.type === 'staff_order');
  assert.equal(order.side, 'b');
  assert.match(order.reason, /Gegenstoß/);
  assert.equal(r.state.battle.counter.b.due, 4);
  const rep = r.state.sides.b.reputation;
  // Verteidiger stoesst vor
  const r2 = run(r.state, [{ group: 'a01', type: 'hold' }], [{ group: 'b01', type: 'assault', path: [{ x: 15, y: 5 }, { x: 15, y: 4 }] }], map);
  assert.ok(r2.log.some((e) => e.type === 'counter_done'));
  assert.equal(r2.state.sides.b.reputation, rep + 3);
  // Wer sich einigelt, verliert Ansehen
  s = r.state;
  for (let i = 0; i < 3 && s.battle; i++) {
    const g = getGroup(s, 'a01');
    r = run(s, [{ group: 'a01', type: 'assault', path: [{ x: g.pos.x, y: g.pos.y === 3 ? 2 : 3 }] }], [], map);
    s = r.state;
  }
  assert.ok(r.log.some((e) => e.type === 'counter_missed') || s.sides.b.reputation === rep - 5);
  assert.equal(s.sides.b.reputation, rep - 5);
});

test('Rueckzug: nach dem Gefecht darf eine Gruppe aus dem Niemandsland zurueck verlegen', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 9, y: 3 } }, { type: 'rifles', pos: { x: 4, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }], { kind: 'position' });
  assert.equal(validateOrder({ group: 'a01', type: 'redeploy', path: line(8, 4, 2) }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a02', type: 'redeploy', path: line(5, 7, 3) }, s, 'a', { map }), /hinter der eigenen Linie/);
});

// ------------------------------------------------------------------ Funde aus dem Review

test('Deckung: wer beim Herauskommen wieder Deckung befiehlt, bleibt unten', () => {
  const map = makeMap({ trenches: ownTrench(3, [3]) });
  let s = makeState(map, [{ type: 'rifles', pos: { x: 3, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 0 } }]);
  s = run(s, [{ group: 'a01', type: 'dugout' }], [], map).state;
  s = run(s, [], [], map).state;
  assert.equal(getGroup(s, 'a01').dugout, 'leaving');
  const r = run(s, [{ group: 'a01', type: 'dugout' }], [], map);
  assert.equal(getGroup(r.state, 'a01').inDugout, true);
  assert.equal(getGroup(r.state, 'a01').dugout, 'in');
});

test('Zwei Sturmgruppen mit demselben Ziel: jede hat ihr eigenes', () => {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  const s = makeState(map, [
    { type: 'rifles', pos: { x: 5, y: 1 } }, { type: 'rifles', pos: { x: 5, y: 3 } }, { type: 'rifles', pos: { x: 5, y: 5 } },
  ], [{ type: 'rifles', pos: { x: 18, y: 6 } }], { kind: 'position' });
  const r = run(s, [
    { group: 'a01', type: 'attack', path: line(6, 15, 1) },
    { group: 'a02', type: 'attack', path: line(6, 15, 3) },
    { group: 'a03', type: 'attack', path: [...line(6, 14, 5), { x: 15, y: 4 }, { x: 15, y: 3 }] },
  ], [], map);
  const objs = r.state.battle.objectives.a;
  assert.equal(objs.length, 3);
  assert.deepEqual(objs.find((o) => o.group === 'a03'), { x: 15, y: 3, group: 'a03' });
  // a01 an seinem Ziel, a02 und a03 neben bzw. auf 15/3: genommen
  const t = structuredClone(r.state);
  getGroup(t, 'a01').pos = { x: 15, y: 1 };
  getGroup(t, 'a02').pos = { x: 14, y: 3 };
  getGroup(t, 'a03').pos = { x: 15, y: 3 };
  assert.equal(objectiveTaken(t, 'a'), true);
});

test('Gegenstoss zaehlt nur, wenn der Sturm auf den verlorenen Graben zielt; kein Stabsbefehl, wenn das Gefecht endet', () => {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 14, y: 3 } }], [{ type: 'rifles', pos: { x: 15, y: 6 } }, { type: 'rifles', pos: { x: 18, y: 1 } }]);
  s.battle = { round: 1, attackers: ['a'], assaulters: { a: ['a01'] }, objectives: { a: [{ x: 18, y: 3, group: 'a01' }] }, counter: {}, outcome: {} };
  const r = run(s, [{ group: 'a01', type: 'assault', path: [{ x: 15, y: 3 }, { x: 16, y: 3 }] }], [], map);
  const r2 = run(r.state, [{ group: 'a01', type: 'hold' }], [{ group: 'b02', type: 'assault', path: [{ x: 18, y: 0 }] }], map);
  assert.ok(!r2.log.some((e) => e.type === 'counter_done'), 'Sturm woandershin ist kein Gegenstoss');
  // Ziel direkt genommen: kein unerfuellbarer Stabsbefehl
  const s3 = structuredClone(s);
  s3.battle.objectives.a = [{ x: 15, y: 3, group: 'a01' }];
  getGroup(s3, 'b01').pos = { x: 18, y: 6 };
  const r3 = run(s3, [{ group: 'a01', type: 'assault', path: [{ x: 15, y: 3 }] }], [], map);
  assert.equal(r3.state.battle, null);
  assert.ok(!r3.log.some((e) => e.type === 'staff_order'));
});

test('Nahkampf nur, wo man auf den Feind traf; wer verteidigt hat, laeuft nicht als Angreifer weiter', () => {
  const map = makeMap({ trenches: enemyTrench(15, [1, 2, 3, 4, 5]) });
  // Sturm gegeneinander: beide treffen sich
  const s = makeState(map, [{ type: 'rifles', pos: { x: 10, y: 3 } }], [{ type: 'rifles', pos: { x: 12, y: 3 } }]);
  for (let seed = 1; seed < 15; seed++) {
    s.seed = seed;
    const r = run(s, [{ group: 'a01', type: 'assault', path: line(11, 15, 3) }], [{ group: 'b01', type: 'assault', path: line(11, 6, 3) }], map);
    assert.equal(r.log.filter((e) => e.type === 'melee').length, 1);
    assert.ok(!r.log.some((e) => e.type === 'melee_push' && /nicht mehr vor/.test(e.reason)));
    // Weitergetragene Wege beginnen neben der Gruppe
    for (const e of r.log.filter((x) => x.carry?.type === 'assault')) {
      const g = getGroup(r.state, e.group);
      const p = e.carry.path[0];
      assert.ok(Math.max(Math.abs(p.x - g.pos.x), Math.abs(p.y - g.pos.y)) <= 1, `Weg von ${e.group} springt`);
    }
  }
});
