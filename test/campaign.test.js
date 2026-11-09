// P14: Kampagnenrahmen (Plan 2.4, 2.6, 3.1, 4.3): Ausloeser, Wertegrenzen, Stempel, Berichte, Ersatz, Abloesung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { validateOrder } from '../js/orders.js';
import { isValidEvent } from '../js/events.js';
import { moraleFactors } from '../js/morale.js';
import { runCampaign } from '../js/phases/campaign.js';
import { meleeOdds } from '../js/phases/melee.js';
import {
  LIMITS, newCampaign, normalizeCampaign, supplyPct, replacementsFor, batteryPct, recoveryPct, digPct, axisEffects,
  missionAxes, missionCounts, orderConsequence, stampOrder, stampCost, countReports, checkThresholds, finishMission,
  afterInterlude, replyBand, applyCampaignToState, judgeMission, registerMissionJudge, slimRounds, startAxes,
} from '../js/campaign.js';
import { REPORTS, REPORT_IDS, hasReport, reportOpen, battlesOf } from '../js/config/reports.js';
import { indexTexts, pickSlot } from '../js/narrative/texts.js';

const ev = (type, side, extra = {}) => ({ type, side, reason: 'x', at: { x: 0, y: 0 }, ...extra });
const round = (log, extra = {}) => ({ turn: 1, kind: 'position', log, ...extra });
const ORDER = { id: 'x.befehl', nr: 'S-1/01', eilt: false, folgen: { erfuellt: { ansehen: 6 }, verfehlt: { ansehen: -8 } } };
const byKey = (list, key) => list.filter((c) => c.key === key).reduce((n, c) => n + c.amount, 0);

// ---------------------------------------------------------------- Wirkungen und Grenzen

test('Nachschub, Ersatz, Batterien nach Ansehen: Grenzen', () => {
  assert.equal(supplyPct(0), 60);
  assert.equal(supplyPct(50), 100);
  assert.equal(supplyPct(100), 140);
  assert.equal(supplyPct(250), 140, 'ueber 100 wird gekappt');
  assert.equal(replacementsFor(17), 0);
  assert.equal(replacementsFor(18), 1);
  assert.equal(replacementsFor(50), 5);
  assert.equal(replacementsFor(100), 11);
  assert.equal(batteryPct(24), 50);
  assert.equal(batteryPct(25), 100);
  assert.equal(batteryPct(74), 100);
  assert.equal(batteryPct(75), 125);
});

test('Vertrauen auf Moralerholung und Graben: neutral zwischen 40 und 60', () => {
  assert.equal(recoveryPct(39), 93);
  assert.equal(recoveryPct(40), 100);
  assert.equal(recoveryPct(60), 100);
  assert.equal(recoveryPct(61), 106);
  assert.equal(recoveryPct(0), 70);
  assert.equal(recoveryPct(100), 130);
  assert.equal(digPct(50), 100);
  assert.equal(digPct(0), 80);
  const fx = axisEffects({ ansehen: 24, vertrauen: 24, mission: 'a4m1' });
  assert.equal(fx.threat, true);
  assert.equal(fx.reportsHeld, true);
  assert.equal(fx.refuse, true, 'Akt 4 unter 25: Verweigerung moeglich');
  assert.equal(axisEffects({ ansehen: 25, vertrauen: 25, mission: 'a4m1' }).refuse, false);
  assert.equal(axisEffects({ ansehen: 50, vertrauen: 20, mission: 'a1m1' }).refuse, false, 'vor Akt 4 keine Verweigerung');
});

test('Antwort des Stabs wird mit sinkendem Ansehen knapper', () => {
  assert.equal(replyBand(75), 'herzlich');
  assert.equal(replyBand(74), 'sachlich');
  assert.equal(replyBand(50), 'sachlich');
  assert.equal(replyBand(49), 'knapp');
  assert.equal(replyBand(25), 'knapp');
  assert.equal(replyBand(24), 'kalt');
  const index = indexTexts([JSON.parse(readFileSync(new URL('../data/texts/stab.json', import.meta.url), 'utf8'))]);
  const len = (ansehen, outcome) => pickSlot(index, 'stab.antwort', { ansehen, outcome }).text.length;
  for (const outcome of ['sieg', 'niederlage']) {
    assert.ok(len(80, outcome) > len(60, outcome), `herzlich laenger als sachlich (${outcome})`);
    assert.ok(len(60, outcome) > len(30, outcome), `sachlich laenger als knapp (${outcome})`);
    assert.ok(len(30, outcome) >= len(10, outcome) || outcome === 'niederlage', `knapp nicht kuerzer als kalt (${outcome})`);
  }
  assert.ok(len(10, 'sieg') <= 5, 'kalt auf einen Erfolg: fast nichts');
});

// ---------------------------------------------------------------- Ausloeser einer Mission

test('Stabsbefehl: erfuellt, verfehlt, umgedeutet halb, verweigert nichts', () => {
  assert.deepEqual(orderConsequence(ORDER, true), { ansehen: 6, vertrauen: 0 });
  assert.deepEqual(orderConsequence(ORDER, false), { ansehen: -8, vertrauen: 0 });
  assert.deepEqual(orderConsequence(ORDER, true, 'umdeuten'), { ansehen: 3, vertrauen: 0 });
  assert.deepEqual(orderConsequence(ORDER, false, 'umdeuten'), { ansehen: -4, vertrauen: 0 });
  assert.deepEqual(orderConsequence({ folgen: { erfuellt: { ansehen: 1 } } }, true, 'umdeuten'), { ansehen: 1, vertrauen: 0 }, 'nie 0 aus etwas');
  assert.deepEqual(orderConsequence(ORDER, false, 'verweigern'), { ansehen: 0, vertrauen: 0 });
  const ch = missionAxes({ rounds: [], outcome: 'sieg', order: ORDER });
  assert.equal(byKey(ch, 'befehl'), 6);
  assert.equal(byKey(missionAxes({ rounds: [], outcome: 'sieg', order: ORDER, orderMet: false }), 'befehl'), -8, 'orderMet geht vor Ausgang');
  for (const c of ch) assert.ok(c.reason && /[a-zäöü]/.test(c.reason), 'deutsche Begruendung');
});

test('Gelaende gewonnen und verloren (Fraktionsfaktor, Kappung), Gefangene', () => {
  const won = Array.from({ length: 9 }, () => ev('breach', 'a'));
  assert.equal(byKey(missionAxes({ rounds: [round(won)] }), 'gelaende_gewonnen'), 6, 'hoechstens +6');
  const lost3 = [ev('breach', 'b'), ev('breach', 'b'), ev('breach', 'b')];
  assert.equal(byKey(missionAxes({ rounds: [round(lost3)], faction: 'kaldern' }), 'gelaende_verloren'), -4, 'Kaldern 1,3: 3 -> 4');
  assert.equal(byKey(missionAxes({ rounds: [round(lost3)], faction: 'morrow' }), 'gelaende_verloren'), -3, 'Morrow 0,7: 3 -> 3 (aufgerundet)');
  const many = Array.from({ length: 20 }, () => ev('breach', 'b'));
  assert.equal(byKey(missionAxes({ rounds: [round(many)] }), 'gelaende_verloren'), -8, 'hoechstens -8');
  const pris = [ev('group_captured', 'b', { count: 5 }), ev('group_captured', 'a', { count: 9 })];
  assert.equal(byKey(missionAxes({ rounds: [round(pris)] }), 'gefangene'), 2, 'nur feindliche Gefangene, je zwei +1');
});

test('Vertrauen: Mahlzeiten, Post, Verwundete, Gefecht im Zustand', () => {
  const log = [
    ...Array.from({ length: 9 }, () => ev('warm_meal', 'a')),
    ev('supply_delivered', 'a', { wounded: 9 }),
    ev('feldpost', undefined),
  ];
  const ch = missionAxes({ rounds: [round(log), round([ev('feldpost', undefined)])], start: { reputation: 50, trust: 50 }, end: { reputation: 53, trust: 46 } });
  assert.equal(byKey(ch, 'mahlzeiten'), 2);
  assert.equal(byKey(ch, 'verwundete'), 2);
  assert.equal(byKey(ch, 'post'), 2);
  assert.equal(byKey(ch, 'gefecht'), 3, 'Gegenstoss-Belohnung aus dem Zustand');
  assert.equal(byKey(ch, 'truppe'), -4, 'zu lange vorn usw. aus dem Zustand');
  const capped = missionAxes({ rounds: [round(Array.from({ length: 40 }, () => ev('warm_meal', 'a')))] });
  assert.equal(byKey(capped, 'mahlzeiten'), 3, 'hoechstens +3');
});

test('Hohe Verluste kosten Vertrauen, Kaldern staerker', () => {
  const lossLog = (n) => [round([ev('losses', 'a', { amount: n, group: 'a01' })])];
  assert.equal(byKey(missionAxes({ rounds: lossLog(4) }), 'verluste'), 0, 'bis vier Ausfaelle frei');
  assert.equal(byKey(missionAxes({ rounds: lossLog(10), faction: 'morrow' }), 'verluste'), -2);
  assert.equal(byKey(missionAxes({ rounds: lossLog(10), faction: 'kaldern' }), 'verluste'), -2);
  assert.equal(byKey(missionAxes({ rounds: lossLog(31), faction: 'kaldern' }), 'verluste'), -10, 'Kappung -10');
  assert.equal(byKey(missionAxes({ rounds: lossLog(25), faction: 'kaldern' }), 'verluste'), -9);
  assert.equal(byKey(missionAxes({ rounds: lossLog(25), faction: 'morrow' }), 'verluste'), -7);
});

function battle(outcome, losses, { wire = false } = {}) {
  const start = { groups: [{ id: 'a01', side: 'a', type: 'rifles', strength: 10 }] };
  return [
    round([ev('attack_set', 'a', { group: 'a01' })], { start }),
    round([ev('battle_start', 'a'), ev('assault', 'a', { group: 'a01', ...(wire ? { wire: { x: 1, y: 1 } } : {}) }), ev('losses', 'a', { group: 'a01', amount: losses })], { kind: 'battle', start }),
    round([ev('battle_end', 'a', { outcome }), ev('battle_end', 'b', { outcome: outcome === 'taken' ? 'time' : 'defended' })], { kind: 'battle', start }),
  ];
}

test('Angriff mit geringen Verlusten hebt Vertrauen, blutiger Sturm senkt es', () => {
  assert.equal(battlesOf(battle('taken', 2)).length, 1);
  assert.equal(byKey(missionAxes({ rounds: battle('taken', 2) }), 'angriff_billig'), 2);
  assert.equal(byKey(missionAxes({ rounds: battle('taken', 3) }), 'angriff_billig'), 0, 'mehr als ein Fuenftel: nicht billig');
  assert.equal(byKey(missionAxes({ rounds: battle('stuck', 6) }), 'sturm_verlust'), -3);
  assert.equal(byKey(missionAxes({ rounds: battle('stuck', 5) }), 'sturm_verlust'), 0, 'genau die Haelfte: noch keine Strafe');
  const two = [...battle('taken', 1), ...battle('taken', 0), ...battle('taken', 1)];
  assert.equal(byKey(missionAxes({ rounds: two }), 'angriff_billig'), 4, 'Kappung +4');
});

// ---------------------------------------------------------------- Stempel

test('Stempel auf dem Stabsbefehl: Kosten, einmal je Mission, Eilt', () => {
  assert.deepEqual(stampCost(ORDER, 'befolgen'), { ansehen: 0, vertrauen: 0 });
  assert.deepEqual(stampCost(ORDER, 'umdeuten'), { ansehen: -1, vertrauen: 2 });
  assert.deepEqual(stampCost(ORDER, 'verweigern'), { ansehen: -10, vertrauen: 4 });
  assert.deepEqual(stampCost({ ...ORDER, eilt: true }, 'verweigern'), { ansehen: -12, vertrauen: 4 });
  let c = newCampaign({ ansehen: 50, vertrauen: 50 });
  c = stampOrder(c, 'a1m1', 'verweigern', ORDER);
  assert.equal(c.ansehen, 40);
  assert.equal(c.vertrauen, 54);
  assert.equal(c.stamps.a1m1, 'verweigern');
  const again = stampOrder(c, 'a1m1', 'befolgen', ORDER);
  assert.equal(again, c, 'ein Stempel ist endgueltig');
  assert.throws(() => stampOrder(c, 'a1m2', 'ignorieren', ORDER));
  const low = stampOrder(newCampaign({ ansehen: 19 }), 'a1m1', 'verweigern', ORDER);
  assert.equal(low.ended, 'vorzeitig_abgeloest', 'Verweigerung unter die 10: sofort abgeloest');
});

// ---------------------------------------------------------------- Schwellen

test('Abloesung unter 10, Meuterei unter 10, Drohung unter 25', () => {
  assert.equal(checkThresholds(newCampaign({ ansehen: 10 })).ended, null);
  assert.equal(checkThresholds(newCampaign({ ansehen: 9 })).ended, 'vorzeitig_abgeloest');
  assert.equal(checkThresholds(newCampaign({ vertrauen: 10 })).ended, null);
  assert.equal(checkThresholds(newCampaign({ vertrauen: 9 })).ended, 'vorzeitig_meuterei');
  assert.equal(checkThresholds(newCampaign({ ansehen: 5, vertrauen: 5 })).ended, 'vorzeitig_abgeloest', 'der Stab handelt zuerst');
  assert.deepEqual(checkThresholds(newCampaign({ ansehen: 24 }), 'a1m3').threat, { mission: 'a1m3' });
  assert.equal(checkThresholds(newCampaign({ ansehen: 25 })).threat, null);
  assert.equal(LIMITS.RELIEF, 10);
});

test('Berichte bleiben unter 25 beim Stab liegen und kommen nach', () => {
  let c = newCampaign({ ansehen: 20 });
  const rounds = [round([ev('line_cut', 'a')])];
  const r = countReports(c, rounds, 'a', 1);
  assert.deepEqual(r.reached, ['doppelleitung']);
  let f = finishMission(c, { mission: 'a1m1', outcome: 'sieg', rounds });
  c = f.campaign;
  assert.ok(c.withheld.includes('doppelleitung'));
  assert.ok(!c.reports.includes('doppelleitung'));
  c = checkThresholds({ ...c, ansehen: 30 });
  assert.ok(c.reports.includes('doppelleitung'));
  assert.ok(c.fresh.includes('doppelleitung'));
  assert.deepEqual(c.withheld, []);
});

// ---------------------------------------------------------------- Erfahrungsberichte

test('20 Berichte, jeder passend zu berichte.json und mit Zaehler', () => {
  const data = JSON.parse(readFileSync(new URL('../data/texts/berichte.json', import.meta.url), 'utf8'));
  const ids = data.eintraege.map((e) => e.id.replace(/^bericht\./, '')).sort();
  assert.equal(REPORTS.length, 20);
  assert.deepEqual([...REPORT_IDS].sort(), ids);
  for (const r of REPORTS) {
    const e = data.eintraege.find((x) => x.id === 'bericht.' + r.id);
    assert.equal(r.act, Number(e.ab.slice(1)), `${r.id}: Akt wie in den Texten`);
    assert.ok(r.need >= 1 && Number.isInteger(r.need));
    assert.equal(r.count([], 'a'), 0, `${r.id}: leeres Protokoll zaehlt 0`);
  }
});

// Ein Protokoll, das genau die Schwelle jedes Berichts erreicht
const TRIGGERS = {
  faschinenbau: (k) => [round([ev('dig', 'a', { cells: k })])],
  traversen: (k) => [round(Array.from({ length: k }, () => ev('losses', 'a', { amount: 1, cause: 'enfilade' })))],
  lattenroste: (k) => Array.from({ length: k }, () => round([ev('flood', 'a', { cells: 2 })])),
  tiefer_unterstand: (k) => Array.from({ length: k }, () => round([ev('shelling', 'b', { kind: 'prep', plan: 'p1' }), ev('dugout_stay', 'a', { group: 'a01' })])),
  drahtscheren: (k) => Array.from({ length: k }, () => battle('stuck', 1, { wire: true })).flat(),
  feuerwalze: (k) => [round(Array.from({ length: k }, (_, i) => ev('shelling', 'a', { kind: 'prep', plan: 'p' + i })))],
  doppelleitung: (k) => [round(Array.from({ length: k }, () => ev('line_cut', 'a')))],
  stahlhelme: (k) => [round([ev('losses', 'a', { amount: k, cause: 'artillery' })])],
  leichtes_mg: (k) => Array.from({ length: k }, () => [
    round([ev('battle_start', 'b'), ev('losses', 'b', { amount: 2, cause: 'mg' })], { kind: 'battle' }),
    round([ev('battle_end', 'a', { outcome: 'defended' })], { kind: 'battle' }),
  ]).flat(),
  grabenkeulen: (k) => [round(Array.from({ length: k }, () => ev('melee', 'a', { outcome: 'taken' })))],
  sanitaetsloren: (k) => [round([ev('supply_delivered', 'a', { wounded: k })])],
  feldbahn_ausbauen: (k) => [round(Array.from({ length: k }, () => ev('depot_empty', 'a')))],
  kochkisten: (k) => [round(Array.from({ length: k }, () => ev('warm_meal', 'a')))],
  grabenpumpe: (k) => [round(Array.from({ length: k }, () => ev('drain_failed', 'a')))],
  horchgeraet: (k) => [round(Array.from({ length: k }, () => ev('tunnel_detected', 'a')))],
  leuchtpistolen: (k) => Array.from({ length: k }, () => round([ev('flare', 'a')], { night: true })),
  sappenkopf: (k) => [round([ev('sap', 'a', { cells: k })])],
  tarnung: (k) => [round(Array.from({ length: k }, () => ev('battery_hit', 'a')))],
  lichtsignale: (k) => [round(Array.from({ length: k }, () => ev('line_cut', 'a')))],
  gefangenenbefragung: (k) => [round([ev('group_captured', 'b', { count: k })])],
};

test('Jeder Bericht kommt genau an seiner Schwelle, nicht darunter, nicht vor seinem Akt', () => {
  for (const r of REPORTS) {
    const make = TRIGGERS[r.id];
    assert.ok(make, `${r.id}: Ausloeser im Test fehlt`);
    assert.equal(r.count(make(r.need), 'a'), r.need, `${r.id}: zaehlt ${r.need}`);
    const base = newCampaign({ ansehen: 60 });
    assert.ok(countReports(base, make(r.need), 'a', 4).reached.includes(r.id), `${r.id}: an der Schwelle`);
    if (r.need > 1) assert.ok(!countReports(base, make(r.need - 1), 'a', 4).reached.includes(r.id), `${r.id}: knapp darunter nicht`);
    if (r.act > 1) assert.ok(!countReports(base, make(r.need), 'a', r.act - 1).reached.includes(r.id), `${r.id}: nicht vor Akt ${r.act}`);
    assert.equal(r.count(make(r.need).map((x) => ({ ...x, log: x.log.map((e) => ({ ...e, side: e.side === 'a' ? 'b' : e.side === 'b' ? 'a' : e.side })) })), 'b'), r.need, `${r.id}: gilt fuer beide Seiten`);
  }
});

test('Zaehler laufen ueber Missionen weiter', () => {
  let c = newCampaign({ ansehen: 60 });
  const half = [round([ev('dig', 'a', { cells: 100 })])];
  c = countReports(c, half, 'a', 1).campaign;
  assert.equal(c.counters.faschinenbau, 100);
  const r = countReports(c, half, 'a', 1);
  assert.ok(r.reached.includes('faschinenbau'));
});

// ---------------------------------------------------------------- Mission abschliessen

test('finishMission bucht Achsen, Verlauf, Front und naechste Mission', () => {
  const c0 = newCampaign({ ansehen: 50, vertrauen: 50 });
  const rounds = [round([ev('breach', 'a'), ev('warm_meal', 'a')])];
  const f = finishMission(c0, { mission: 'a1m1', outcome: 'sieg', rounds, order: ORDER, start: { reputation: 50, trust: 50 }, finalState: { sides: { a: { reputation: 52, trust: 49 } } } });
  const c = f.campaign;
  assert.equal(c.ansehen, 50 + 6 + 2 + 1);
  assert.equal(c.vertrauen, 49);
  assert.equal(c.outcomes.a1m1, 'sieg');
  assert.equal(c.mission, 'a1m2');
  assert.deepEqual(c.front, [1]);
  assert.equal(c.history.length, 2);
  assert.equal(c.reply.band, replyBand(c.ansehen));
  assert.equal(c.ledger.at(-1).changes.length, f.changes.length);
  const lost = finishMission(c, { mission: 'a1m2', outcome: 'niederlage', rounds: [], flags: ['velde_verloren'] }).campaign;
  assert.deepEqual(lost.front, [1, 0]);
  assert.ok(lost.flags.includes('velde_verloren'), 'Flags der Mission');
});

test('Meuterei im Gefecht: Mission verloren, Kampagne endet', () => {
  const f = finishMission(newCampaign({ vertrauen: 30 }), { mission: 'a1m4', outcome: 'sieg', rounds: [round([ev('mutiny', 'a')])], order: ORDER });
  assert.equal(f.campaign.outcomes.a1m4, 'niederlage');
  assert.equal(f.ended, 'vorzeitig_meuterei');
  assert.equal(f.campaign.mission, 'a1m4', 'keine naechste Mission');
  assert.equal(byKey(f.changes, 'befehl'), -8, 'Befehl verfehlt');
});

test('afterInterlude prueft die Entscheidungen nach', () => {
  const c = afterInterlude({ ...newCampaign({}), ansehen: 8 });
  assert.equal(c.ended, 'vorzeitig_abgeloest');
  const n = normalizeCampaign({ side: 'a', ansehen: 40, vertrauen: 40, flags: [], outcomes: {}, book: { fallen: [] } });
  assert.deepEqual(n.reports, []);
  assert.deepEqual(n.book.diary, []);
});

// ---------------------------------------------------------------- Im Spielzustand

const W = 20, H = 9;
function testMap() {
  const rows = Array.from({ length: H }, () => '.'.repeat(W));
  return loadMap({
    id: 'kampagne', width: W, height: H, terrain: rows, heights: rows.map((r) => '0'.repeat(r.length)),
    zones: Array.from({ length: H }, () => 'EEEEEESSSSSSSSNNssee'),
    trenches: Array.from({ length: H }, (_, y) => ({ x: 11, y, side: 'own', kind: 'fire', level: 2, facing: 'E' })),
    buildings: [{ id: 'depot', type: 'depot', x: 3, y: 6, w: 2, h: 2 }],
  });
}
function setup() {
  const map = testMap();
  const scen = { id: 'k', sides: { a: { faction: 'kaldern', groups: [{ type: 'rifles', pos: { x: 11, y: 1 }, strength: 10 }] }, b: { faction: 'morrow', groups: [{ type: 'rifles', pos: { x: 17, y: 4 }, strength: 10 }] } } };
  return { map, state: createInitialState(map, scen, 7) };
}

test('applyCampaignToState: Werte, Berichte, Nachschub, Ersatz', () => {
  const { state } = setup();
  const c = { ...newCampaign({ ansehen: 100, vertrauen: 70 }), reports: ['stahlhelme', 'drahtscheren'] };
  const s = applyCampaignToState(state, c);
  assert.equal(s.sides.a.reputation, 100);
  assert.equal(s.sides.a.trust, 70);
  assert.deepEqual(s.sides.a.reports, ['drahtscheren', 'stahlhelme']);
  assert.equal(s.sides.a.supplies.income.food, Math.floor((12 * 140) / 100));
  assert.equal(s.sides.a.replacements.tenths, 110);
  assert.equal(s.sides.a.supplies.food, state.sides.a.supplies.food, 'Anfangsbestand bleibt, nur der Zufluss skaliert');
  assert.equal(state.sides.a.reports, undefined, 'Original unveraendert');
  assert.deepEqual(startAxes(s), { reputation: 100, trust: 70 });
  assert.equal(s.sides.b.campaign, undefined, 'der Gegner bleibt frei');
});

test('Vertrauen und Ansehen wirken im Zustand auf Erholung und Ersatz', () => {
  const { state } = setup();
  const neutral = moraleFactors(state, 'a');
  const low = moraleFactors({ ...state, sides: { ...state.sides, a: { ...state.sides.a, trust: 0 } } }, 'a');
  assert.ok(low.recovery < neutral.recovery);
  const s0 = applyCampaignToState(state, newCampaign({ ansehen: 0, vertrauen: 50 }));
  const s9 = applyCampaignToState(state, newCampaign({ ansehen: 90, vertrauen: 50 }));
  assert.ok(s0.sides.a.replacements.tenths < s9.sides.a.replacements.tenths, 'Ansehen bringt Ersatz vor der Mission');
  assert.ok(s0.sides.a.supplies.income.ammo < s9.sides.a.supplies.income.ammo, 'und Nachschub je Runde');
});

test('Sperren nur in der Kampagne, Boni nur mit Bericht', () => {
  const { map, state } = setup();
  const free = state;
  const camp = applyCampaignToState(state, newCampaign({}));
  assert.equal(reportOpen(free, 'a', 'faschinenbau'), true);
  assert.equal(reportOpen(camp, 'a', 'faschinenbau'), false);
  assert.equal(hasReport(free, 'a', 'stahlhelme'), false);
  const order = { group: 'a01', type: 'dig', path: [{ x: 10, y: 1 }], level: 3 };
  assert.equal(validateOrder(order, free, 'a', { map }), null);
  assert.match(validateOrder(order, camp, 'a', { map }), /Faschinenbau/);
  const withRep = applyCampaignToState(state, { ...newCampaign({}), reports: ['faschinenbau'] });
  assert.equal(validateOrder(order, withRep, 'a', { map }), null);
});

test('Grabenkeulen staerken den Nahkampf', () => {
  const { map, state } = setup();
  const a = state.groups.find((g) => g.side === 'a');
  const d = state.groups.find((g) => g.side === 'b');
  const base = meleeOdds(state, map, [{ g: a, assault: true }], d).p;
  const s2 = applyCampaignToState(state, { ...newCampaign({}), reports: ['grabenkeulen'] });
  const a2 = s2.groups.find((g) => g.side === 'a');
  assert.ok(meleeOdds(s2, map, [{ g: a2, assault: true }], d).p > base);
});

test('Phase Kampagne: Meuterei unter 10 einmal, Drohung unter 25 einmal, nur in der Kampagne', () => {
  const { state } = setup();
  const run = (s, turn = 3) => {
    const log = [];
    runCampaign({ state: s, turn, emit: (type, f) => log.push({ phase: 'campaign', type, ...f }) });
    return log;
  };
  const free = structuredClone(state);
  free.sides.a.trust = 5;
  assert.deepEqual(run(free), [], 'freies Gefecht: keine Meuterei');
  const s = applyCampaignToState(state, newCampaign({ ansehen: 20, vertrauen: 9 }));
  const log = run(s);
  assert.deepEqual(log.map((e) => e.type).sort(), ['mutiny', 'staff_threat']);
  for (const e of log) assert.ok(isValidEvent(e), e.type);
  assert.equal(s.sides.a.mutiny, 3);
  assert.deepEqual(run(s, 4), [], 'nur einmal');
  const ok = applyCampaignToState(state, newCampaign({ ansehen: 25, vertrauen: 10 }));
  assert.deepEqual(run(ok), [], 'an der Grenze nichts');
});

test('Runde mit Kampagne laeuft durch und ist deterministisch', () => {
  const { map, state } = setup();
  const s = applyCampaignToState(state, newCampaign({ vertrauen: 9 }));
  const r1 = resolveTurn(s, [], [], 7, 1, { map });
  const r2 = resolveTurn(s, [], [], 7, 1, { map });
  assert.deepEqual(r1.log, r2.log);
  assert.ok(r1.log.some((e) => e.type === 'mutiny'));
  assert.equal(r1.finished, true, 'Meuterei beendet die Partie');
  assert.equal(r1.state.result.winner, 'b');
  const j = judgeMission('a1m1', { state: r1.state, rounds: [{ turn: 1, kind: 'position', log: r1.log }] });
  assert.equal(j.outcome, 'niederlage');
});

test('Missionsziel: angemeldet, sonst Standard beim Beenden', () => {
  assert.equal(judgeMission('a9m9', { rounds: [], final: false }), null, 'ohne Ziel laeuft die Mission weiter');
  assert.equal(judgeMission('a9m9', { rounds: [], final: true }).outcome, 'niederlage', 'zu frueh gemeldet zaehlt nicht');
  const quiet = Array.from({ length: 6 }, () => round([]));
  assert.equal(judgeMission('a9m9', { rounds: quiet, final: true }).outcome, 'sieg', 'Linie gehalten');
  assert.equal(judgeMission('a9m9', { rounds: [round([ev('breach', 'b')])], final: true }).outcome, 'niederlage');
  registerMissionJudge('a9m8', ({ counts }) => (counts.won >= 2 ? { outcome: 'sieg', orderMet: true } : null));
  assert.equal(judgeMission('a9m8', { rounds: [round([ev('breach', 'a'), ev('breach', 'a')])] }).outcome, 'sieg');
  assert.equal(judgeMission('a9m8', { rounds: [] }), null);
});

test('slimRounds behaelt Protokoll und Staerken, sonst nichts', () => {
  const { state } = setup();
  const slim = slimRounds([{ turn: 2, kind: 'position', night: true, start: state, ordersA: [1], log: [ev('dig', 'a')] }]);
  assert.deepEqual(Object.keys(slim[0].start), ['groups']);
  assert.equal(slim[0].ordersA, undefined);
  assert.equal(slim[0].start.groups[0].strength, 10);
  assert.equal(missionCounts(slim, 'a').won, 0);
});
