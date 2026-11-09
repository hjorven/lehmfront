// P12: Moral, Erschoepfung, Abloesung, Ersatz (Plan 4.1 Nr. 12, 2.2, 2.6, 5)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../js/map.js';
import { createInitialState, getGroup } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { validateOrder } from '../js/orders.js';
import { initEtappen } from '../js/etappe-map.js';
import { isValidEvent } from '../js/events.js';
import { phasesFor } from '../js/phases/registry.js';
import { fallbackCell, replacementStock } from '../js/phases/morale.js';
import * as C from '../js/config/morale.js';
import {
  postOf, fatigueGain, fatigueRecovery, restRoundsLeft, moraleRecovery, moraleCap, frontMoraleLoss, tooLongMorale,
  lossMorale, trostPercent, leaderMorale, leaderChance, checkChance, checkOutcome, sectionMorale, restCells,
  freeRestCell, replacementTenths, refillPreview, unitNote, digFatiguePct,
} from '../js/morale.js';

// Kleine Front: Etappe x 0..5 (Ruhelager A1 = Felder 0..2 / 0..2), Stellung 6..13, Niemandsland 14..15, Feind 16..
const W = 20, H = 9;
function testMap() {
  const rows = Array.from({ length: H }, () => '.'.repeat(W));
  return loadMap({
    id: 'moral', width: W, height: H, terrain: rows, heights: rows.map((r) => '0'.repeat(r.length)),
    zones: Array.from({ length: H }, () => 'EEEEEESSSSSSSSNNssee'),
    trenches: Array.from({ length: H }, (_, y) => ({ x: 11, y, side: 'own', kind: 'fire', level: 2, facing: 'E' })),
    buildings: [{ id: 'depot', type: 'depot', x: 3, y: 6, w: 2, h: 2 }],
  });
}

function setup({ groups, camp = true, faction = 'kaldern', b = null } = {}) {
  const map = testMap();
  const scen = {
    id: 'm',
    sides: {
      a: {
        faction,
        etappe: camp ? { buildings: [{ type: 'ruhelager', at: 'A1' }] } : { buildings: [] },
        groups: groups ?? [
          { type: 'rifles', pos: { x: 11, y: 1 }, morale: 70, strength: 10 },  // a01 vorn
          { type: 'rifles', pos: { x: 4, y: 4 }, morale: 50, strength: 10 },   // a02 Reserve
        ],
      },
      b: { faction: 'morrow', etappe: false, groups: b ?? [{ type: 'rifles', pos: { x: 17, y: 4 } }] },
    },
  };
  let state = createInitialState(map, scen, 5);
  state = initEtappen(state, map, scen);
  for (const g of state.groups) g.size = 10;
  return { map, state };
}

const turn = (state, map, a = [], b = [], extra = {}) => resolveTurn(state, a, b, state.seed, state.turn, { map, ...extra });

// ------------------------------------------------------------------ Formeln

test('Formeln: Erschoepfung vorn, Erholung in Reserve und Ruhelager', () => {
  assert.equal(fatigueGain('position'), C.FATIGUE_FRONT);
  assert.equal(fatigueGain('battle'), C.FATIGUE_BATTLE);
  assert.equal(fatigueGain('battle', { moved: true }), C.FATIGUE_BATTLE + C.FATIGUE_BATTLE_MOVE);
  assert.equal(fatigueRecovery('front'), 0);
  assert.equal(fatigueRecovery('reserve'), C.FATIGUE_RESERVE);
  assert.equal(fatigueRecovery('rest', { erholung: 3 }), C.FATIGUE_REST + 3 * C.FATIGUE_REST_PER_YIELD);
  assert.equal(fatigueRecovery('rest', { erholung: 3, camp: false }), C.FATIGUE_REST_NO_CAMP);
  assert.ok(fatigueRecovery('rest') > fatigueRecovery('reserve'), 'Ruhelager schlaegt Reserve');
  assert.equal(restRoundsLeft(10, 20), 0);
  assert.equal(restRoundsLeft(60, 20), 3); // 60 -> 40 -> 20 -> 0
  assert.equal(restRoundsLeft(35, 20), 1);
  assert.equal(restRoundsLeft(60, 0), null);
});

test('Formeln: Grabfaktor Erschoepfung erst ab mittel', () => {
  assert.equal(digFatiguePct(0), 100);
  assert.equal(digFatiguePct(C.FATIGUE_DIG_FREE), 100);
  assert.equal(digFatiguePct(75), 80);
  assert.equal(digFatiguePct(100), 68);
  assert.equal(digFatiguePct(250), 68);
});

test('Formeln: Moralerholung nach Posten und Fraktion (Kaldern schneller, Morrow langsamer)', () => {
  assert.equal(moraleRecovery('front', { recovery: 1 }), 0);
  assert.equal(moraleRecovery('reserve', { recovery: 1 }), C.MORALE_RESERVE);
  assert.equal(moraleRecovery('rest', { recovery: 1, moral: 2 }), C.MORALE_REST + 2);
  assert.equal(moraleRecovery('rest', { recovery: 1.3 }), Math.floor(C.MORALE_REST * 1.3 + 0.5));
  assert.equal(moraleRecovery('rest', { recovery: 0.75 }), Math.floor(C.MORALE_REST * 0.75 + 0.5));
  assert.equal(moraleRecovery('rest', { recovery: 1, shock: 1 }), 0, 'nach dem Tod des Gruppenfuehrers keine Erholung');
  assert.equal(moraleCap('reserve'), C.MORALE_RESERVE_CAP);
  assert.equal(moraleCap('rest'), 100);
});

test('Formeln: zu lange vorn und Erschoepfung kosten Moral', () => {
  assert.equal(tooLongMorale(C.TOO_LONG), 0);
  assert.equal(tooLongMorale(C.TOO_LONG + 1), C.TOO_LONG_MORALE);
  assert.equal(tooLongMorale(C.TOO_LONG + 50), C.TOO_LONG_MORALE_MAX);
  assert.equal(frontMoraleLoss({ fatigue: 10, frontTurns: 2 }), 0);
  assert.equal(frontMoraleLoss({ fatigue: C.FATIGUE_TIRED, frontTurns: 2 }), C.MORALE_TIRED);
  assert.equal(frontMoraleLoss({ fatigue: C.FATIGUE_TIRED, frontTurns: C.TOO_LONG + 2 }), C.MORALE_TIRED + 2 * C.TOO_LONG_MORALE);
});

test('Formeln: Verluste druecken die Moral anteilig, Trost mildert, Fraktion verstaerkt', () => {
  assert.equal(lossMorale(0, 10), 0);
  assert.equal(lossMorale(5, 10), 15); // halbe Gruppe: 30 * 5 / 10
  assert.equal(lossMorale(1, 100), 1, 'jeder Verlust kostet mindestens 1');
  assert.equal(lossMorale(5, 10, { breakFactor: 1.25 }), 19);
  assert.equal(lossMorale(5, 10, { breakFactor: 0.8 }), 12);
  assert.equal(trostPercent(2), 30);
  assert.equal(trostPercent(10), C.TROST_MAX);
  assert.equal(lossMorale(5, 10, { trost: 2 }), 11); // 15 * 0,7 = 10,5
  assert.equal(leaderMorale(), C.LEADER_MORALE);
  assert.equal(leaderMorale({ breakFactor: 1.25 }), 19);
});

test('Formeln: Gruppenfuehrer faellt mit der Verlustquote, gedeckelt', () => {
  assert.equal(leaderChance(0, 10), 0);
  assert.equal(leaderChance(1, 10), 5);
  assert.equal(leaderChance(4, 10), 20);
  assert.equal(leaderChance(9, 10), C.LEADER_MAX);
  assert.equal(leaderChance(1, 200), 1, 'mindestens 1 Prozent');
});

test('Formeln: Moralprobe mit Erfahrung, Verlusten, Abschnitt und Fraktion', () => {
  assert.equal(checkChance({ morale: 70, experience: 1 }), 78);
  assert.equal(checkChance({ morale: 70, experience: 1, losses: true }), 63);
  assert.equal(checkChance({ morale: 70, experience: 1, losses: true, leaderFell: true, pinned: true, fatigue: 80 }), 23);
  assert.equal(checkChance({ morale: 70, experience: 1, section: 30 }), 74);
  assert.equal(checkChance({ morale: 0 }), C.CHECK_MIN);
  assert.equal(checkChance({ morale: 100, experience: 4 }), C.CHECK_MAX);
  // Kaldern bricht schneller ein: 22 Prozent Fehlschlag werden 28
  assert.equal(checkChance({ morale: 70, experience: 1, breakFactor: 1.25 }), 72);
  assert.equal(checkChance({ morale: 70, experience: 1, breakFactor: 0.8 }), 82);
  assert.equal(checkOutcome(10, 50, 60), 'held');
  assert.equal(checkOutcome(60, 50, 60), 'wavers');
  assert.equal(checkOutcome(90, 50, 60), 'wavers', 'mit guter Moral weicht keiner');
  assert.equal(checkOutcome(90, 50, 20), 'breaks');
  assert.equal(checkOutcome(70, 50, 20), 'wavers', 'knapp daneben: hinwerfen');
});

test('Formeln: Ersatz fuellt auf und senkt die Erfahrung, Genesene behalten sie', () => {
  const g = { strength: 5, size: 10, experience: 3, morale: 80 };
  const p = refillPreview(g, { pool: 10 });
  assert.equal(p.total, 5);
  assert.equal(p.green, 5);
  assert.equal(p.experience, 1); // (5*3 + 5*0) / 10 = 1,5 -> 1
  assert.equal(p.morale, 68);    // (5*80 + 5*55) / 10 = 67,5 -> 68
  assert.equal(refillPreview(g, { pool: 10, greenXp: 1 }).experience, 2);
  const v = refillPreview(g, { pool: 10, veterans: 3 });
  assert.equal(v.veterans, 3);
  assert.equal(v.green, 2);
  assert.equal(v.experience, 2); // (8*3) / 10 = 2,4
  assert.equal(refillPreview(g, { pool: 2 }).total, 2);
  assert.equal(refillPreview({ ...g, strength: 10 }, { pool: 5 }).total, 0);
  assert.equal(replacementTenths(0.6), 18);
  assert.equal(replacementTenths(1.5), 45);
});

test('Posten: vorn, Reserve in der eigenen Etappe, Ruhe', () => {
  const { map, state } = setup();
  assert.equal(postOf(map, getGroup(state, 'a01')), 'front');
  assert.equal(postOf(map, getGroup(state, 'a02')), 'reserve');
  assert.equal(postOf(map, getGroup(state, 'b01')), 'front');
  assert.equal(postOf(map, { ...getGroup(state, 'a02'), status: 'rest' }), 'rest');
  assert.equal(postOf(map, { ...getGroup(state, 'a02'), status: 'lost' }), 'lost');
});

test('Ruhelager: Felder der Parzelle, sonst Scheunen ganz hinten; freie Felder', () => {
  const { map, state } = setup();
  const rc = restCells(map, state, 'a');
  assert.equal(rc.camp, true);
  assert.equal(rc.cells.length, 9);
  assert.ok(rc.cells.every((p) => p.x <= 2 && p.y <= 2));
  const none = setup({ camp: false });
  const nc = restCells(none.map, none.state, 'a');
  assert.equal(nc.camp, false);
  assert.equal(nc.cells[0].x, 0, 'Seite a ruht ganz links');
  const f = freeRestCell(map, state, 'a', { x: 11, y: 1 });
  assert.deepEqual(f.cell, { x: 2, y: 1 });
  assert.equal(freeRestCell(map, state, 'a', null, new Set(rc.cells.map((p) => p.x + ',' + p.y))), null);
});

test('Bleistiftvermerke an der Einheit', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a01');
  assert.equal(unitNote(map, { ...g, frontTurns: 2 }), null);
  assert.deepEqual(unitNote(map, { ...g, frontTurns: C.LONG_FRONT }), { text: `seit ${C.LONG_FRONT} Runden vorn`, tone: 'pencil' });
  assert.equal(unitNote(map, { ...g, frontTurns: C.TOO_LONG }).tone, 'warn');
  assert.equal(unitNote(map, { ...g, status: 'rest', fatigue: 50 }, { recovery: 20 }).text, 'ruht, noch 2 Runden');
  assert.equal(unitNote(map, { ...g, status: 'rest', fatigue: 5 }, { recovery: 20 }).text, 'ausgeruht');
  assert.equal(unitNote(map, { ...g, greenTurns: 2 }).text, 'Ersatz, grün');
  const n = unitNote(map, { ...g, leader: { name: 'Karl Brehm' }, leaderFell: { name: 'Otto Lenz', turns: 1 } });
  assert.deepEqual(n, { text: 'Brehm übernimmt', tone: 'warn', strike: 'Lenz' });
});

// ------------------------------------------------------------------ Stellungsrunde

test('Stellungsrunde: vorn erschoepft, Reserve erholt sich, Abschnittsmoral steht im Zustand', () => {
  const { map, state } = setup();
  getGroup(state, 'a02').fatigue = 40;
  const r = turn(state, map);
  const a1 = getGroup(r.state, 'a01'), a2 = getGroup(r.state, 'a02');
  assert.equal(a1.fatigue, C.FATIGUE_FRONT);
  assert.equal(a1.frontTurns, 1);
  assert.equal(a2.fatigue, 40 - C.FATIGUE_RESERVE);
  assert.equal(a2.morale, 50 + Math.floor(C.MORALE_RESERVE * 1.3 + 0.5));
  assert.deepEqual(r.state.sides.a.morale, { sections: { A: 70 }, overall: 70 });
  assert.ok(r.state.sides.a.replacements.tenths > 0, 'Ersatz sammelt sich');
  for (const e of r.log) assert.ok(isValidEvent(e), JSON.stringify(e));
});

test('Reserve erholt die Moral nur bis zur Obergrenze', () => {
  const { map, state } = setup();
  getGroup(state, 'a02').morale = C.MORALE_RESERVE_CAP - 1;
  assert.equal(getGroup(turn(state, map).state, 'a02').morale, C.MORALE_RESERVE_CAP);
  getGroup(state, 'a02').morale = 90;
  assert.equal(getGroup(turn(state, map).state, 'a02').morale, 90, 'hoeher wird nicht gekappt');
});

test('Zu lange vorn: Meldung, Moral und Vertrauen sinken', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a01');
  g.frontTurns = C.TOO_LONG - 1;
  const r = turn(state, map);
  assert.ok(r.log.some((e) => e.type === 'too_long' && e.group === 'a01'));
  const t = r.log.find((e) => e.type === 'trust_front');
  assert.equal(t.amount, -C.TRUST_TOO_LONG);
  assert.equal(r.state.sides.a.trust, state.sides.a.trust - C.TRUST_TOO_LONG);
  // Noch eine Runde: jetzt kostet es auch Moral
  const r2 = turn(r.state, map);
  assert.equal(getGroup(r2.state, 'a01').morale, 70 - C.TOO_LONG_MORALE);
  assert.ok(!r2.log.some((e) => e.type === 'too_long'), 'Meldung nur einmal');
});

test('Ablösen: Reserve übernimmt das Feld, die Gruppe geht ins Ruhelager, Vertrauen steigt', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a01');
  g.frontTurns = 4;
  g.fatigue = 60;
  g.suppressed = 0.4;
  const r = turn(state, map, [{ group: 'a01', type: 'relieve', by: 'a02' }]);
  const a1 = getGroup(r.state, 'a01'), a2 = getGroup(r.state, 'a02');
  assert.deepEqual(a2.pos, { x: 11, y: 1 });
  assert.equal(postOf(map, a2), 'front');
  assert.equal(a1.status, 'rest');
  assert.ok(a1.pos.x <= 2 && a1.pos.y <= 2, 'im Ruhelager');
  assert.deepEqual(a1.restAt, a1.pos);
  assert.equal(a1.frontTurns, 0);
  assert.equal(a1.suppressed, 0);
  // Erholung im Ruhelager schon in derselben Runde (Ruhelager liefert erholung 2)
  assert.equal(a1.fatigue, 60 - (C.FATIGUE_REST + 2 * C.FATIGUE_REST_PER_YIELD));
  assert.equal(r.state.sides.a.trust, state.sides.a.trust + C.TRUST_RELIEF);
  const e = r.log.find((x) => x.type === 'relieved');
  assert.match(e.reason, /löst .* ab/);
  assert.equal(e.by, 'a02');
});

test('Ablösen ohne Ersatz: Feld bleibt leer; ohne Ruhelager in die Scheunen', () => {
  const { map, state } = setup({ camp: false });
  const r = turn(state, map, [{ group: 'a01', type: 'relieve' }]);
  const a1 = getGroup(r.state, 'a01');
  assert.equal(a1.status, 'rest');
  assert.equal(a1.pos.x, 0);
  const e = r.log.find((x) => x.type === 'relieved');
  assert.equal(e.empty, true);
  assert.match(e.reason, /Scheunen/);
  assert.match(e.reason, /Feld bleibt leer/);
  assert.equal(a1.fatigue, 0);
});

test('Ablösen: Pruefungen', () => {
  const { map, state } = setup();
  const v = (o) => validateOrder({ type: 'relieve', ...o }, state, 'a', { map });
  assert.equal(v({ group: 'a01' }), null);
  assert.equal(v({ group: 'a01', by: 'a02' }), null);
  assert.match(v({ group: 'a02' }), /nicht vorn/);
  assert.match(v({ group: 'a01', by: 'a01' }), /selbst/);
  assert.match(v({ group: 'a01', by: 'b01' }), /eigenen Seite/);
  getGroup(state, 'a02').pos = { x: 10, y: 5 };
  assert.match(v({ group: 'a01', by: 'a02' }), /selbst vorn/);
});

test('Ablösung mit eigenem Befehl kommt nicht, die Gruppe geht trotzdem', () => {
  const { map, state } = setup();
  const r = turn(state, map, [{ group: 'a01', type: 'relieve', by: 'a02' }, { group: 'a02', type: 'redeploy', path: [{ x: 5, y: 4 }] }]);
  const e = r.log.find((x) => x.type === 'relieved');
  assert.equal(e.by, null);
  assert.match(e.reason, /anderen Befehl/);
});

test('Ruhelager: wer weggeht, ruht nicht mehr', () => {
  const { map, state } = setup();
  const r = turn(state, map, [{ group: 'a01', type: 'relieve', by: 'a02' }]);
  const at = getGroup(r.state, 'a01').pos;
  const r2 = turn(r.state, map, [{ group: 'a01', type: 'redeploy', path: [{ x: at.x + 1, y: at.y }] }]);
  const a1 = getGroup(r2.state, 'a01');
  assert.notDeepEqual(a1.pos, at);
  assert.equal(a1.status, 'front');
  assert.equal(postOf(map, a1), 'reserve');
});

test('Ersatz: Auffüllen in Reserve senkt die Erfahrung, verbraucht das Ersatzdepot', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a02');
  g.strength = 5;
  g.experience = 3;
  state.sides.a.replacements = { tenths: 50 };
  assert.equal(validateOrder({ group: 'a02', type: 'refill' }, state, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a01', type: 'refill' }, state, 'a', { map }), /Reserve oder Ruhe/);
  const r = turn(state, map, [{ group: 'a02', type: 'refill' }]);
  const a2 = getGroup(r.state, 'a02');
  assert.equal(a2.strength, 10);
  assert.equal(a2.experience, 1);
  assert.equal(a2.greenTurns, C.GREEN_TURNS - 1);
  assert.equal(r.state.sides.a.replacements.tenths, 50 + 18 - 50);
  assert.match(r.log.find((e) => e.type === 'refilled').reason, /Erfahrung 3 → 1/);
  // Vollzaehlig: nichts mehr zu tun
  assert.match(validateOrder({ group: 'a02', type: 'refill' }, r.state, 'a', { map }), /vollzählig/);
});

test('Ersatz: Genesene aus dem Lazarett zuerst; ohne Ersatz kein Befehl', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a02');
  g.strength = 7;
  g.experience = 2;
  state.sides.a.supply = { reserveMen: 3 };
  state.sides.a.replacements = { tenths: 0 };
  assert.deepEqual(replacementStock(state, 'a'), { pool: 0, veterans: 3 });
  const r = turn(state, map, [{ group: 'a02', type: 'refill' }]);
  assert.equal(getGroup(r.state, 'a02').strength, 10);
  assert.equal(getGroup(r.state, 'a02').experience, 2, 'Genesene senken die Erfahrung nicht');
  assert.equal(r.state.sides.a.supply.reserveMen, 0);
  // Kaldern bekommt 1,8 Mann je Runde: aus 0 wird in einer Runde 1
  delete state.sides.a.supply;
  state.sides.a.replacements = { tenths: -20 };
  assert.match(validateOrder({ group: 'a02', type: 'refill' }, state, 'a', { map }), /kein Ersatz/);
});

// ------------------------------------------------------------------ Verluste und Gruppenfuehrer

/** Testphase: zieht einer Gruppe vor der Moralphase Leute ab und meldet 'losses' wie Feuer oder Artillerie */
function hitPhase(group, amount, kind = 'position') {
  return {
    id: 'hit', kind, order: kind === 'position' ? 75 : 65,
    run(ctx) {
      const g = ctx.group(group);
      g.strength -= amount;
      ctx.emit('losses', { side: g.side, group, amount, reason: 'Test', at: { ...g.pos } });
    },
  };
}
const only = (kind, ...ids) => phasesFor(kind).filter((p) => ids.includes(p.id));

test('Verluste: Moral sinkt anteilig; der Gruppenfuehrer faellt manchmal, mit Moraleinbruch', () => {
  let fell = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { map, state } = setup();
    state.seed = seed;
    const old = getGroup(state, 'a01').leader.name;
    const r = turn(state, map, [], [], { phases: [hitPhase('a01', 5), ...only('position', 'morale')] });
    const g = getGroup(r.state, 'a01');
    const base = 70 - lossMorale(5, 10, { breakFactor: 1.25 });
    const e = r.log.find((x) => x.type === 'leader_fallen');
    if (e) {
      fell++;
      assert.notEqual(g.leader.name, old);
      assert.equal(e.fallen, old);
      assert.equal(g.morale, base - leaderMorale({ breakFactor: 1.25 }));
      assert.equal(g.shock, C.LEADER_SHOCK - 1);
      assert.ok(r.state.fallen.some((f) => f.name === old && f.cause === 'leader'));
      assert.equal(unitNote(map, g).strike, old.slice(old.indexOf(' ') + 1));
    } else {
      assert.equal(g.morale, base);
      assert.equal(g.leader.name, old);
    }
  }
  // leaderChance(5, 10) = 25 Prozent
  assert.ok(fell > 5 && fell < 30, `Gruppenfuehrer fiel ${fell} von 60 Mal`);
});

test('Verluste: Morrow ist zaeher; Kapelle troestet', () => {
  const { map, state } = setup({ faction: 'morrow' });
  const r = turn(state, map, [], [], { phases: [hitPhase('a01', 5), ...only('position', 'morale')] });
  const e = r.log.find((x) => x.type === 'morale_loss');
  assert.equal(e.amount, lossMorale(5, 10, { breakFactor: 0.8 }));
  const k = setup();
  k.state.sides.a.etappe.yield = { trost: 2 };
  const r2 = turn(k.state, k.map, [], [], { phases: [hitPhase('a01', 5), ...only('position', 'morale')] });
  assert.equal(r2.log.find((x) => x.type === 'morale_loss').amount, lossMorale(5, 10, { breakFactor: 1.25, trost: 2 }));
});

// ------------------------------------------------------------------ Gefechtsrunde

test('Gefechtsrunde: Moralprobe nach Verlusten, misslungen wirft sich hin oder weicht zurueck', () => {
  const seen = { held: 0, wavers: 0, breaks: 0 };
  for (let seed = 1; seed <= 80; seed++) {
    const { map, state } = setup();
    state.seed = seed;
    state.turnKind = 'battle';
    const g = getGroup(state, 'a01');
    g.morale = 30;
    g.experience = 0;
    const r = turn(state, map, [], [], { phases: [hitPhase('a01', 2, 'battle'), ...only('battle', 'morale')] });
    const after = getGroup(r.state, 'a01');
    const brk = r.log.find((e) => e.type === 'morale_break');
    const chk = r.log.find((e) => e.type === 'morale_check');
    if (brk) {
      seen.breaks++;
      assert.equal(after.pos.x, 10, 'ein Feld zurueck nach Westen');
      assert.equal(after.suppressed, 1);
    } else if (chk.outcome === 'wavers') {
      seen.wavers++;
      assert.deepEqual(after.pos, { x: 11, y: 1 });
      assert.ok(after.suppressed >= 0.6);
    } else {
      seen.held++;
    }
    assert.equal(after.fatigue, C.FATIGUE_BATTLE);
  }
  assert.ok(seen.held > 0 && seen.wavers > 0 && seen.breaks > 0, JSON.stringify(seen));
});

test('Gefechtsrunde: Rueckzugsfeld nur frei und begehbar', () => {
  const { map, state } = setup();
  const g = getGroup(state, 'a01');
  assert.deepEqual(fallbackCell(map, state, g), { x: 10, y: 1 });
  getGroup(state, 'a02').pos = { x: 10, y: 1 };
  assert.deepEqual(fallbackCell(map, state, g), { x: 10, y: 0 });
  g.pos = { x: 0, y: 4 };
  assert.equal(fallbackCell(map, state, g), null, 'Kartenrand');
  const b = getGroup(state, 'b01');
  assert.deepEqual(fallbackCell(map, state, b), { x: 18, y: 4 }, 'Seite b weicht nach Osten');
});

test('Gefechtsende: Moral nach abgewiesenem oder verlorenem Gefecht', () => {
  const { map, state } = setup();
  state.turnKind = 'battle';
  const end = {
    id: 'end-test', kind: 'battle', order: 80,
    run(ctx) {
      ctx.emit('battle_end', { side: 'a', outcome: 'defended', reason: 'Test', at: { x: 11, y: 1 } });
      ctx.emit('battle_end', { side: 'b', outcome: 'broken', reason: 'Test', at: { x: 11, y: 1 } });
    },
  };
  const r = turn(state, map, [], [], { phases: [end, ...only('battle', 'morale-end')] });
  assert.equal(getGroup(r.state, 'a01').morale, 70 + C.BATTLE_WON);
  assert.equal(getGroup(r.state, 'a02').morale, 50, 'Reserve war nicht dabei');
  assert.equal(getGroup(r.state, 'b01').morale, getGroup(state, 'b01').morale - C.BATTLE_LOST);
});

test('Abschnittsmoral nach Staerke gewichtet, nur Gruppen vorn', () => {
  const { map, state } = setup({
    groups: [
      { type: 'rifles', pos: { x: 11, y: 1 }, morale: 80, strength: 10 },
      { type: 'rifles', pos: { x: 12, y: 2 }, morale: 40, strength: 5 },
      { type: 'rifles', pos: { x: 11, y: 7 }, morale: 50, strength: 10 },
      { type: 'rifles', pos: { x: 3, y: 1 }, morale: 10, strength: 10 },
    ],
  });
  assert.deepEqual(sectionMorale(map, state, 'a'), { sections: { A: 67, C: 50 }, overall: 60 });
});

test('Determinismus: gleiche Eingabe, gleiches Ergebnis', () => {
  const play = () => {
    const { map, state } = setup();
    state.seed = 9;
    let s = state;
    const logs = [];
    for (let i = 0; i < 4; i++) {
      const r = turn(s, map, i === 1 ? [{ group: 'a01', type: 'relieve', by: 'a02' }] : []);
      logs.push(r.log);
      s = r.state;
    }
    return JSON.stringify({ s, logs });
  };
  assert.equal(play(), play());
});
