// P26: Akt 4 "Das letzte Fruehjahr". Panzerwagen, grosse Mine, Sprengfallen und Besetzen, Pionierbruecke,
// Verweigerung mit Harms und Brandt, der letzte Tag, sechs Missionen mit Varianten, vier Enden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, enterCost, cellAt } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { validateOrder } from '../js/orders.js';
import { isValidEvent } from '../js/events.js';
import { factorFor } from '../js/modifiers.js';
import { coverAt } from '../js/sight.js';
import { stuckChance, armorPct } from '../js/tank.js';
import { refusalFor, assaultExposure, knownFoes } from '../js/refusal.js';
import { bridgeLine, bridgeProblem, bridgeCellDone } from '../js/bridge.js';
import { mineLeft } from '../js/phases/mine.js';
import { trapCells } from '../js/phases/traps.js';
import { hoursSince } from '../js/phases/lastday.js';
import { truceOf } from '../js/truce.js';
import { TANK, BRIDGE, REFUSAL } from '../js/config/akt4.js';
import {
  AKT4_SCENARIOS, ENDING_SCENARIOS, judgeA4m1, judgeA4m2, judgeA4m3, judgeA4m5, prepareAkt4, WRECK, BRIDGE_CELLS, HARMS_NAME,
} from '../js/config/missions-akt4.js';
import { scenarioForMission, prepareMission, missionBuilt } from '../js/config/missions.js';
import { newCampaign, finishMission, afterInterlude, endingFor, endingOf, ENDINGS } from '../js/campaign.js';
import { indexTexts, pickSlot } from '../js/narrative/texts.js';
import { endingSteps, lastFallen } from '../js/narrative/ending.js';
import { runMission } from '../js/ai/mission-match.js';
import { buildRaudas, buildFaehrhaus } from '../tools/maps/akt4.mjs';
import { buildAkt4 } from '../tools/scenarios/akt4.mjs';
import '../js/phases/index.js';
import '../js/ai.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const MAPS = {
  raudas: loadMap(read('../data/maps/raudas.json')),
  faehrhaus: loadMap(read('../data/maps/faehrhaus.json')),
  huegel214: loadMap(read('../data/maps/huegel214.json')),
};
const scenario = (id) => read(`../data/scenarios/${id}.json`);
const start = (id, seed = 1) => {
  const sc = scenario(id);
  const map = MAPS[sc.map];
  return { state: initEtappen(createInitialState(map, sc, seed), map, sc), map, env: { map } };
};
const grp = (state, id) => state.groups.find((x) => x.id === id);
const turn = (s, env, a = [], b = [], seed = 1) => resolveTurn(s, a, b, seed, s.turn, env);
const TEXTS = indexTexts(['akt1', 'akt2', 'akt3', 'akt4', 'enden'].map((f) => read(`../data/texts/${f}.json`)).concat([read('../data/letters/briefe-akt3-4.json')]));

// ------------------------------------------------------------------ Generatoren, Szenarien, Varianten

test('P26: Karten Raudas und Faehrhaus und die Akt-4-Szenarien entsprechen ihren Generatoren', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(buildRaudas())), read('../data/maps/raudas.json'));
  assert.deepEqual(JSON.parse(JSON.stringify(buildFaehrhaus())), read('../data/maps/faehrhaus.json'));
  const all = buildAkt4();
  assert.equal(Object.keys(all).length, 15);
  for (const [id, sc] of Object.entries(all)) {
    assert.deepEqual(JSON.parse(JSON.stringify(sc)), scenario(id), id);
    const { state } = start(id);
    assert.equal(state.scenario.act, 4, id);
    assert.equal(state.weather.season, 'fruehling', id);
    assert.ok(state.groups.some((g) => g.side === 'a' && g.leader.name === HARMS_NAME), id + ': Harms ist dabei');
  }
});

test('P26: Missionen waehlen ihre Fassung nach Entscheidungen und nach dem Ende', () => {
  for (const m of Object.keys(AKT4_SCENARIOS)) assert.ok(missionBuilt(m), m);
  assert.equal(scenarioForMission('a4m3', { flags: [] }), 'akt4-m3');
  assert.equal(scenarioForMission('a4m3', { flags: ['mine_gezuendet', 'mine_gewarnt'] }), 'akt4-m3-leer');
  assert.equal(scenarioForMission('a4m3', { flags: ['mine_geflutet'] }), 'akt4-m3-geflutet');
  assert.equal(scenarioForMission('a4m4', { flags: ['verweigerung_mitgegangen'] }), 'akt4-m4-brandt');
  assert.equal(scenarioForMission('a4m4', { flags: ['verweigerung_harms'] }), 'akt4-m4-harms');
  assert.equal(scenarioForMission('a4m4', { flags: ['verweigerung_gemeldet'] }), 'akt4-m4-gemeldet');
  assert.equal(scenarioForMission('a4m4', { flags: ['verweigerung_aufgehoben'] }), 'akt4-m4-halten');
  for (const k of ENDINGS) assert.equal(scenarioForMission('a4m6', { flags: ['ende_' + k] }), ENDING_SCENARIOS[k]);
  // Ohne Flag (alter Spielstand): aus den Werten
  assert.equal(scenarioForMission('a4m6', { flags: [], ansehen: 70, vertrauen: 70 }), ENDING_SCENARIOS.haelt);
  assert.equal(scenarioForMission('a4m6', { flags: [], ansehen: 20, vertrauen: 20 }), ENDING_SCENARIOS.abgeloest);
  // Brandt steht in der Fassung "Selbst vorgehen" als Gruppe auf der Karte; "gemeldet" hat eine Gruppe weniger
  assert.ok(start('akt4-m4-brandt').state.groups.some((g) => g.brandt && g.leader.name === 'Ilse Brandt'));
  assert.equal(start('akt4-m4-gemeldet').state.groups.filter((g) => g.side === 'a').length, start('akt4-m4').state.groups.filter((g) => g.side === 'a').length - 1);
  assert.equal(start('akt4-m4-harms').state.sides.a.harms.used, true);
});

test('P26: Die Wahl des Endes stimmt mit dem Slot ende.wahl ueberein', () => {
  for (let a = 0; a <= 100; a += 5) for (let v = 0; v <= 100; v += 5) {
    const e = pickSlot(TEXTS, 'ende.wahl', { ansehen: a, vertrauen: v, flags: [] });
    assert.equal(endingFor(a, v), e.ende, `${a}/${v}`);
    assert.deepEqual(e.setzt, ['ende_' + e.ende]);
  }
});

// ------------------------------------------------------------------ Panzerwagen

test('P26: Panzerwagen: Panzerung, Deckung dahinter, Draht walzen, steckenbleiben, Pioniere bergen', () => {
  const { state, map, env } = start('akt4-m2');
  const tank = state.groups.find((g) => g.type === 'tank');
  const rifle = state.groups.find((g) => g.side === 'b' && g.type === 'rifles');
  const gun = state.groups.find((g) => g.side === 'b' && g.type === 'fieldgun');
  assert.equal(armorPct(state, rifle, tank), TANK.armorPct);
  assert.equal(armorPct(state, gun, tank), null, 'das Feldgeschuetz schlaegt durch');
  assert.equal(factorFor('armor', { state, map, shooter: rifle, target: tank }), TANK.armorPct / 100);
  // Gruppe direkt hinter dem Wagen (vom Schuetzen aus gesehen)
  const behind = { ...grp(state, 'a05'), pos: { x: tank.pos.x - 1, y: tank.pos.y } };
  const shooter = { ...rifle, pos: { x: tank.pos.x + 5, y: tank.pos.y } };
  assert.equal(armorPct({ ...state, groups: [...state.groups.filter((g) => g.id !== behind.id), behind] }, shooter, behind), TANK.shieldPct);
  // Trichter und Graben machen das Steckenbleiben wahrscheinlicher
  const plain = stuckChance(map, state, { x: 28, y: 20 });
  const s2 = structuredClone(state);
  s2.cells['28,20'] = { crater: 2, mud: 2 };
  assert.ok(stuckChance(map, s2, { x: 28, y: 20 }) > plain + 20);
  // Draht walzen: Fahrt ueber ein Drahtfeld bei 26/20
  let crushed = false;
  for (let seed = 1; seed <= 6 && !crushed; seed++) {
    const w = start('akt4-m2', seed).state;
    w.groups.find((g) => g.id === tank.id).pos = { x: 25, y: 20 };
    w.cells['26,20'] = { wire: { side: 'enemy', strength: 2 } };
    w.turnKind = 'battle';
    w.battle = { round: 1, startTurn: w.turn, attacker: 'a' };
    const r = turn(w, env, [{ group: tank.id, type: 'move', path: [{ x: 26, y: 20 }, { x: 27, y: 20 }] }], [], seed);
    crushed = r.log.some((e) => e.type === 'wire_cut' && e.crushed) && !r.state.cells['26,20']?.wire;
  }
  assert.ok(crushed, 'der Wagen walzt den Draht nieder');
  // Steckt er fest, nimmt er keine Fahrbefehle an; Pioniere daneben holen ihn heraus
  let freed = false;
  for (let seed = 1; seed <= 8 && !freed; seed++) {
    const st = start('akt4-m2', seed).state;
    const t = st.groups.find((g) => g.id === tank.id);
    st.turn = 3;
    t.stuck = 2; // seit der Runde davor
    assert.match(validateOrder({ group: t.id, type: 'attack', path: [{ x: t.pos.x + 1, y: t.pos.y }] }, st, 'a', env), /sitzt fest/);
    const pio = st.groups.find((g) => g.side === 'a' && g.type === 'pioneers');
    pio.pos = { x: t.pos.x, y: t.pos.y + 1 };
    const r = turn(st, env, [{ group: pio.id, type: 'hold' }], [], seed);
    freed = r.log.some((e) => e.type === 'tank_freed') && !grp(r.state, t.id).stuck;
  }
  assert.ok(freed);
});

// ------------------------------------------------------------------ Grosse Mine

test('P26: Grosse Mine zaehlt bis zur Zuendung, ein Durchbruch Lasks macht sie wertlos', () => {
  const { state, env } = start('akt4-m3-leer');
  const m = state.sides.a.mine;
  assert.equal(mineLeft(m), m.fuse);
  let s = state;
  const logs = [];
  for (let i = 0; i < 10 && s.sides.a.mine.status === 'ready'; i++) {
    if (s.turnKind === 'battle') { s = { ...s, turnKind: 'position', battle: null }; }
    const r = turn(s, env);
    s = r.state;
    logs.push(...r.log);
  }
  assert.equal(s.sides.a.mine.status, 'blown');
  const e = logs.find((x) => x.type === 'mine_great');
  assert.ok(e && isValidEvent(e) && e.public);
  const c = s.sides.a.mine.chamber;
  assert.equal(s.cells[c.x + ',' + c.y].crater, 2);
  assert.equal(s.cells[c.x + ',' + c.y].trench, null, 'der Graben auf der Kuppe ist weg');
  assert.ok(Object.values(s.cells).filter((x) => x?.chalk).length > 25, 'Kreide faellt weit herum');
  assert.equal(judgeA4m3({ state: s, rounds: [], side: 'a' }).outcome, 'sieg');
  // Lasks Stollen bis an die Galerie: verloren
  const b = start('akt4-m3').state;
  b.sides.b.tunnels[0].dug = b.sides.b.tunnels[0].path.length;
  const r = turn(b, env);
  assert.equal(r.state.sides.a.mine.status, 'lost');
  assert.equal(r.state.sides.a.mine.lostBy, 'breach');
  assert.equal(judgeA4m3({ state: r.state, rounds: [], side: 'a' }).outcome, 'niederlage');
});

// ------------------------------------------------------------------ Fallen und Besetzen

test('P26: Geraeumte Linie: besetzen, Fallen gehen hoch, Pioniere finden sie', () => {
  const { state, map, env } = start('akt4-m1');
  assert.equal(trapCells(state).length, 10);
  // Eine Gruppe steht schon in Lasks alter Linie (eingebrochen): sie besetzt Nachbarfelder, auch eine Falle
  const s = structuredClone(state);
  const rif = s.groups.find((g) => g.side === 'a' && g.type === 'rifles' && g.leader.name !== HARMS_NAME);
  rif.pos = { x: 33, y: 18 };
  s.cells['33,18'] = { trench: { ...cellAt(map, 33, 18).trench, side: 'own', captured: true } };
  const r = turn(s, env, [{ group: rif.id, type: 'hold' }]);
  const occ = r.log.find((e) => e.type === 'trench_occupied');
  assert.ok(occ && isValidEvent(occ));
  assert.ok(occ.cells.some((p) => p.x === 33 && p.y === 19), 'das Feld mit der Falle wird mitbesetzt');
  assert.ok(r.log.some((e) => (e.type === 'trap' || e.type === 'trap_found') && e.at.x === 33 && e.at.y === 19));
  assert.equal(r.state.cells['33,19'].trench.side, 'own');
  // Pioniere daneben finden jede Falle
  const p = structuredClone(state);
  const pio = p.groups.find((g) => g.side === 'a' && g.type === 'pioneers');
  pio.pos = { x: 34, y: 12 };
  const r2 = turn(p, env, [{ group: pio.id, type: 'hold' }]);
  assert.ok(r2.log.some((e) => e.type === 'trap_found' && e.group === pio.id));
  assert.equal(trapCells(r2.state).length, 9);
  // Missionsziel: vier Felder reichen fuer den Sieg, acht fuer den Stab
  const j = structuredClone(state);
  for (let y = 2; y <= 7; y++) j.cells['33,' + y] = { trench: { side: 'own', kind: 'fire', level: 3, facing: 'W', captured: true } };
  const rounds = Array.from({ length: 6 }, () => ({ kind: 'position', log: [] }));
  assert.deepEqual([judgeA4m1({ state: j, rounds, side: 'a' }).outcome, judgeA4m1({ state: j, rounds, side: 'a' }).orderMet], ['sieg', false]);
});

// ------------------------------------------------------------------ Bruecke

test('P26: Pionierbruecke: Joch um Joch, dann Gleis; Treffer reissen ein; Missionsziel', () => {
  const { state, map, env } = start('akt4-m5');
  const pio = state.groups.find((g) => g.side === 'a' && g.type === 'pioneers');
  const path = bridgeLine(map, { pos: { x: 15, y: 20 } }, { x: 16, y: 20 });
  assert.deepEqual(path, BRIDGE_CELLS);
  assert.equal(bridgeProblem(map, state, pio, path), null);
  assert.ok(bridgeProblem(map, state, grp(state, 'a04'), path), 'Sanitaeter bauen keine Bruecken');
  assert.ok(bridgeProblem(map, state, pio, [{ x: 14, y: 20 }]));
  assert.equal(validateOrder({ group: pio.id, type: 'bridge', path }, state, 'a', env), null);
  const builders = state.groups.filter((g) => g.side === 'a' && BRIDGE.builders.includes(g.type) && g.pos.x === 15);
  assert.equal(builders.length, 3);
  let s = state;
  for (let i = 0; i < 6 && !BRIDGE_CELLS.every((p) => bridgeCellDone(s, p)); i++) {
    if (s.turnKind === 'battle') s = { ...s, turnKind: 'position', battle: null };
    s = turn(s, env, builders.map((g) => ({ group: g.id, type: 'bridge', path }))).state;
  }
  assert.ok(BRIDGE_CELLS.every((p) => bridgeCellDone(s, p)), 'die Bruecke steht mit Gleis');
  assert.equal(enterCost(cellAt(map, 17, 20)), Infinity);
  assert.equal(enterCost({ ...cellAt(map, 17, 20), ...s.cells['17,20'] }), BRIDGE.moveCost);
  const rounds = [{ kind: 'position', log: [] }, { kind: 'position', log: [] }, { kind: 'position', log: [] }];
  assert.deepEqual([judgeA4m5({ state: s, rounds, side: 'a' }).outcome, judgeA4m5({ state: s, rounds, side: 'a' }).orderMet], ['sieg', true]);
});

// ------------------------------------------------------------------ Verweigerung

test('P26: Verweigerung: hoffnungsloser Sturm wird Halten, Harms vermittelt einmal, Brandt geht vor', () => {
  const { state, map, env } = start('akt4-m4');
  const g = grp(state, 'a01');
  // Ueber offenes Feld und den Draht vor den Bahndamm; gesehen hat niemand jemanden, aber der Damm ist besetzt
  const path = [];
  for (let x = g.pos.x + 1; x <= 47; x++) path.push({ x, y: g.pos.y });
  const foes = knownFoes(map, state, 'a', [], path[path.length - 1]);
  assert.ok(foes.length >= 3 && foes.every((f) => f.assumed));
  const e = assaultExposure(map, state, g, path, foes);
  assert.ok(e.pct >= REFUSAL.lossPct, 'die Vorschau warnt: ' + e.pct);
  // Mit Harms in der Naehe vermittelt er (einmal), ohne ihn verweigert die Gruppe
  const noHarms = structuredClone(state);
  delete noHarms.sides.a.harms;
  assert.equal(refusalFor(map, noHarms, g, path, foes).outcome, 'refuse');
  const r = turn(noHarms, env, [{ group: g.id, type: 'attack', path }]);
  const ev = r.log.find((x) => x.type === 'assault_refused');
  assert.ok(ev && isValidEvent(ev));
  assert.equal(r.state.sides.a.refusals, 1);
  const near = structuredClone(state);
  grp(near, near.sides.a.harms.group).pos = { x: g.pos.x, y: g.pos.y + 2 };
  assert.equal(refusalFor(map, near, g, path, foes).outcome, 'harms');
  const r2 = turn(near, env, [{ group: g.id, type: 'attack', path }]);
  assert.ok(r2.log.some((x) => x.type === 'harms_mediated'));
  assert.equal(r2.state.sides.a.harms.used, true);
  assert.equal(refusalFor(map, r2.state, grp(r2.state, g.id), path, foes).outcome === 'harms', false, 'ein zweites Mal nicht');
  // Brandt in der Naehe: sie folgen ihr
  const b = start('akt4-m4-brandt').state;
  delete b.sides.a.harms;
  const bg = grp(b, 'a01');
  b.groups.find((x) => x.brandt).pos = { x: bg.pos.x, y: bg.pos.y + 1 };
  assert.equal(refusalFor(map, b, bg, path, foes).outcome, 'brandt');
  // Ohne Verweigerung (andere Akte) passiert nichts
  const free = structuredClone(state);
  delete free.sides.a.refusal;
  assert.equal(refusalFor(map, free, g, path, foes).outcome, 'go');
});

// ------------------------------------------------------------------ Der letzte Tag

test('P26: Der letzte Tag: Waffenstillstand um zwoelf, Uebergabe am Mittag', () => {
  const w = start('akt4-m6-waffenstillstand');
  assert.equal(hoursSince(w.state), 0);
  const r = turn(w.state, w.env);
  assert.equal(hoursSince(r.state), 12);
  const e = r.log.find((x) => x.type === 'ceasefire');
  assert.ok(e && isValidEvent(e) && e.public);
  assert.equal(truceOf(r.state).status, 'active');
  assert.ok(truceOf(r.state).until > 100);
  const a = start('akt4-m6-abgeloest');
  let s = a.state;
  const logs = [];
  for (let i = 0; i < 2; i++) {
    if (s.turnKind === 'battle') s = { ...s, turnKind: 'position', battle: null };
    const x = turn(s, a.env);
    s = x.state;
    logs.push(...x.log);
  }
  assert.ok(s.day.handover);
  assert.ok(logs.some((x) => x.type === 'handover' && isValidEvent(x)));
});

// ------------------------------------------------------------------ Vorbereitung und Missionsziele

test('P26: Vorbereitung: Harms gefallen, Wrack des Kastens, K1 faehrt wieder', () => {
  const m4 = start('akt4-m4');
  const p = prepareMission('a4m4', m4.state, { flags: ['harms_gefallen', 'kasten_liegen'] }, 'a');
  assert.ok(!p.groups.some((g) => g.leader.name === HARMS_NAME));
  assert.equal(p.sides.a.harms, undefined);
  assert.ok(p.cells[WRECK.x + ',' + WRECK.y].wreck);
  assert.equal(coverAt(p, m4.map, WRECK, 'b').label, 'Wrack des Panzerwagens', 'Deckung fuer beide Seiten');
  assert.equal(coverAt(p, m4.map, WRECK, 'a').cover, 'foxhole');
  assert.ok(p.sides.a.reports.includes('feuerwalze'), 'die Akte davor wirken weiter');
  const d = prepareAkt4('a4m6', start('akt4-m6-durchbruch').state, { flags: ['kasten_durch'] }, 'a');
  assert.equal(d.groups.find((g) => g.type === 'tank').callsign, 'K1');
});

test('P26: Missionsziel a4m2: der Kasten liegt oder kommt durch', () => {
  const { state } = start('akt4-m2');
  const lost = structuredClone(state);
  lost.groups.find((g) => g.type === 'tank').status = 'lost';
  assert.deepEqual(judgeA4m2({ state: lost, rounds: [], side: 'a' }).flags, ['kasten_liegen']);
  const through = structuredClone(state);
  through.groups.find((g) => g.type === 'tank').pos = { x: 39, y: 20 };
  const j = judgeA4m2({ state: through, rounds: [], side: 'a' });
  assert.equal(j.outcome, 'sieg');
  assert.ok(j.flags.includes('kasten_durch'));
});

// ------------------------------------------------------------------ Feldzug und Enden

test('P26: Feldzug: das Ende wird vor a4m6 gewaehlt und danach gespielt', () => {
  let c = newCampaign({ seed: 9, ansehen: 64, vertrauen: 70 });
  c.mission = 'a4m5';
  c = finishMission(c, { mission: 'a4m5', outcome: 'sieg', orderMet: true, rounds: [] }).campaign;
  assert.equal(c.mission, 'a4m6');
  c = afterInterlude(c);
  const key = endingFor(c.ansehen, c.vertrauen);
  assert.ok(c.flags.includes('ende_' + key));
  assert.equal(c.ended, null);
  assert.equal(scenarioForMission('a4m6', c), ENDING_SCENARIOS[key]);
  // Die Werte aendern sich in der letzten Mission: das Ende bleibt das gewaehlte
  c = finishMission(c, { mission: 'a4m6', outcome: 'niederlage', orderMet: false, rounds: [] }).campaign;
  c.ansehen = 51;
  c = afterInterlude(c);
  assert.equal(c.ended, key);
  assert.equal(endingOf(c), key);
  // Vorzeitige Enden bleiben vorzeitig
  let v = newCampaign({ seed: 9, ansehen: 5, vertrauen: 40 });
  v.mission = 'a4m6';
  v.flags.push('ende_abgeloest');
  v = finishMission(v, { mission: 'a4m6', outcome: 'niederlage', orderMet: false, rounds: [] }).campaign;
  v = afterInterlude(v);
  assert.equal(v.ended, 'vorzeitig_abgeloest');
});

test('P26: Schlusssequenz: Seiten, ganze Gefallenenliste, Nachwort, Brief 24', () => {
  const fallen = [{ name: 'Hilke Janssen', groupLabel: 'Gruppe Janssen' }, { name: 'Remmer Siebels', groupLabel: 'Gruppe Siebels' }];
  for (const key of ENDINGS) {
    const c = { seed: 3, ansehen: 50, vertrauen: 50, flags: ['ende_' + key], book: { fallen } };
    const steps = endingSteps(TEXTS, c, key, {});
    const list = steps.find((s) => s.kind === 'casualties');
    assert.ok(list, key);
    assert.ok(list.locked);
    assert.equal(list.sheet.entries.length, fallen.length + (key === 'abgeloest' ? 1 : 0), key);
    assert.ok(!/\{anzahl\}/.test(list.sheet.note), key);
    assert.equal(steps[steps.length - 1].id, 'brief.24', key);
    assert.equal(steps[steps.length - 2].id, 'ende.nachwort', key);
    for (const s of steps) assert.ok(!/\{\w+\}/.test(JSON.stringify(s.sheet)), `${key}: ${s.id} hat offene Platzhalter`);
  }
  const ab = endingSteps(TEXTS, { seed: 3, flags: ['ende_abgeloest'], book: { fallen } }, 'abgeloest', {});
  const last = lastFallen({ seed: 3, book: { fallen } });
  assert.ok(ab.find((s) => s.id === 'ende.abgeloest.4').sheet.body.includes(last.name), 'der letzte Name steht im Tagebuch');
  // Lask-Variante nach der Warnung vor der Mine
  const dl = endingSteps(TEXTS, { seed: 3, flags: ['ende_durchbruch', 'mine_gewarnt'], book: { fallen } }, 'durchbruch', {});
  assert.ok(dl.some((s) => s.id === 'ende.durchbruch.5.lask'));
  const vz = endingSteps(TEXTS, { seed: 3, flags: [], book: { fallen } }, 'vorzeitig_meuterei', {});
  assert.ok(vz.length >= 1 && !vz.some((s) => s.id === 'brief.24'));
});

// ------------------------------------------------------------------ Simulator

test('P26: Missionen im Simulator sind deterministisch, gewinnbar und verlierbar', () => {
  const run = (mission, seed, flags = [], passive = false) => {
    const sc = scenario(scenarioForMission(mission, { flags }));
    return runMission({ map: MAPS[sc.map], scenario: sc, mission, seed, flags, passive, script: true });
  };
  const a = run('a4m1', 1), b = run('a4m1', 1);
  assert.equal(a.outcome, b.outcome);
  assert.deepEqual(a.events, b.events);
  assert.equal(a.outcome, 'sieg', a.why);
  assert.equal(run('a4m1', 1, [], true).outcome, 'niederlage');
  assert.equal(run('a4m3', 1).outcome, 'sieg');
  assert.equal(run('a4m3', 2, [], true).outcome, 'niederlage');
  assert.equal(run('a4m4', 2).outcome, 'sieg');
  assert.equal(run('a4m4', 1, [], true).outcome, 'niederlage');
  assert.equal(run('a4m5', 1).outcome, 'sieg');
  assert.equal(run('a4m5', 1, [], true).outcome, 'niederlage');
  const k = run('a4m2', 1, [], true);
  assert.equal(k.outcome, 'niederlage');
  assert.ok(k.flags.includes('kasten_liegen'));
});

test('P26: Ereignisse der neuen Mechaniken tragen Begruendung und Ort', () => {
  const sc = scenario('akt4-m2');
  const r = runMission({ map: MAPS.raudas, scenario: sc, mission: 'a4m2', seed: 3, script: true, keepLog: true });
  const types = new Set();
  for (const rd of r.log) for (const e of rd.log) {
    if (/^(tank|trap|mine|bridge|assault_refused|harms|refusal|trench_occupied|ceasefire|handover)/.test(e.type)) {
      assert.ok(isValidEvent(e), e.type);
      types.add(e.type);
    }
  }
  assert.ok(types.size >= 1);
});
