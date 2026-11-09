// Akt 1 (P16): sechs Missionen, die die Kernmechaniken einzeln einfuehren. Belegt Karten, Ablaufplaene, Ziele und
// dass jede Mission gewinnbar und verlierbar ist (Spielerinnen aus tools/akt1-players.mjs, Seite b spielt die KI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { MISSION_SCENARIOS } from '../js/config/missions.js';
import { prepareMission, missionAi, missionRound, withMissionOrders, entryAt } from '../js/missions/script.js';
import { lineStatus, halfDay, trenchesLost, groupsAt, positionRounds } from '../js/missions/goals.js';
import { judgeMission } from '../js/campaign.js';
import { playMission } from '../js/missions/run.js';
import { BUILDERS } from '../tools/maps/akt1.mjs';
import { PLAYERS } from '../tools/akt1-players.mjs';
import '../js/missions/index.js';

const rd = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const IDS = ['akt1-m1', 'akt1-m2', 'akt1-m3', 'akt1-m4', 'akt1-m5', 'akt1-m6'];
const scen = Object.fromEntries(IDS.map((id) => [id, rd(`data/missions/${id}.json`)]));
const mapJson = (id) => rd(`data/maps/${scen[id].map}.json`);

test('Akt 1: sechs Missionen, jede mit eigener Karte, in der Kampagne eingetragen', () => {
  for (const [i, id] of IDS.entries()) {
    const s = scen[id];
    assert.equal(s.mission.id, `a1m${i + 1}`);
    assert.equal(s.map, id);
    assert.equal(MISSION_SCENARIOS[s.mission.id], id);
    const map = loadMap(mapJson(id));
    for (const g of [...s.sides.a.groups, ...s.sides.b.groups]) {
      const c = map.cells.find((c) => c.x === g.pos.x && c.y === g.pos.y);
      assert.ok(c && c.terrain !== 'water', `${id}: Gruppe ${g.id ?? g.type} steht auf ${g.pos.x}/${g.pos.y} nicht auf Land`);
    }
  }
});

test('Akt 1: Karten entsprechen dem Generator tools/maps/akt1.mjs', () => {
  for (const id of IDS) {
    const built = JSON.parse(JSON.stringify(BUILDERS[id]()));
    assert.deepEqual(built, mapJson(id), `${id}: node tools/maps/akt1.mjs ausfuehren`);
  }
});

test('Mission 1 beginnt fast leer: keine eigenen Graeben ausser Loechern, kein Draht', () => {
  const m = mapJson('akt1-m1');
  const own = m.trenches.filter((t) => t.side === 'own');
  assert.ok(own.every((t) => (t.level ?? 1) <= 1), 'nur Schuetzenloecher');
  assert.ok(own.length <= 8);
  assert.equal(m.wire.filter((w) => w.side === 'own').length, 0);
  assert.equal(scen['akt1-m1'].mission.survey, true);
});

test('Tutorial: jede Mechanik wird genau einmal erklaert, in der Mission, die sie einfuehrt', () => {
  const tut = rd('data/texts/tutorial.json').eintraege;
  const byId = new Map(tut.map((e) => [e.id, e]));
  const seenMech = new Set();
  for (const id of IDS) {
    for (const h of scen[id].mission.hints) {
      const e = byId.get(h);
      assert.ok(e, `${id}: Hinweis ${h} fehlt in tutorial.json`);
      assert.ok(e.text && e.von, `${h}: Text und Figur`);
      assert.ok(!seenMech.has(e.mechanik), `${e.mechanik} doppelt erklaert`);
      seenMech.add(e.mechanik);
    }
  }
  // Die Kernmechaniken des Pakets
  for (const k of ['graben', 'feuerrichtung', 'unterdrueckung', 'mg_sektor', 'draht', 'lorenplan', 'feuerplan', 'beobachter', 'schlamm', 'wetter', 'abloesung', 'ersatz']) {
    assert.ok(seenMech.has(k), `Mechanik ${k} wird nirgends eingefuehrt`);
  }
});

test('Ablaufplan: Lask-Lage, Feuerplaene und Wetter nach Stellungsrunde', () => {
  const s = scen['akt1-m2'];
  const map = loadMap(mapJson('akt1-m2'));
  let st = prepareMission(createInitialState(map, s, 1), s);
  assert.equal(st.mission.id, 'a1m2');
  assert.equal(missionRound(st), 1);
  assert.deepEqual(missionAi(st), { posture: 'halten' });
  const d0 = st.clock.day;
  assert.equal(d0, 4, 'Mission 2 beginnt an Tag 4');
  st = { ...st, clock: { day: d0 + 1, hour: 6 } };
  assert.equal(missionRound(st), 3);
  assert.deepEqual(missionAi(st), { posture: 'sturm' });
  assert.deepEqual(missionAi({ ...st, turnKind: 'battle' }), {}, 'im Gefecht entscheidet die KI selbst');
  assert.deepEqual(missionAi({ ...st, clock: { day: d0 + 2, hour: 6 } }), {}, 'auto: freie KI');
  assert.equal(entryAt([{ from: 1, x: 1 }, { from: 3, x: 2 }], 2).x, 1);
  assert.equal(halfDay({ clock: { day: 1, hour: 18 } }), 2);

  const s3 = scen['akt1-m3'];
  const st3 = prepareMission(createInitialState(loadMap(mapJson('akt1-m3')), s3, 1), s3);
  const out = withMissionOrders([{ type: 'fire_plan', plans: [{ id: 'eigen', kind: 'counter' }] }], st3);
  assert.deepEqual(out[0].plans.map((p) => p.id), ['eigen'], 'Runde 1: noch kein Stoerfeuer');
  const r2 = { ...st3, clock: { day: st3.clock.day, hour: 18 } };
  assert.deepEqual(withMissionOrders([{ type: 'fire_plan', plans: [{ id: 'eigen', kind: 'counter' }] }], r2)[0].plans.map((p) => p.id), ['eigen', 'gleis']);
  assert.deepEqual(withMissionOrders([], r2).map((o) => o.type), ['fire_plan']);
  // Szenario ohne Mission bleibt unberuehrt
  const plain = { sides: s.sides };
  const st0 = createInitialState(map, s, 1);
  assert.equal(prepareMission(st0, plain), st0);
});

test('Ziele: durchgehende Linie und verlorene Graeben', () => {
  const map = loadMap(mapJson('akt1-m1'));
  const s = prepareMission(createInitialState(map, scen['akt1-m1'], 1), scen['akt1-m1']);
  const empty = lineStatus(map, s, 'a', { y0: 9, y1: 31, minLevel: 2, xMin: 15, xMax: 28 });
  assert.equal(empty.done, false);
  assert.equal(empty.need, 23);
  const cells = {};
  for (let y = 9; y <= 31; y++) cells[`${y % 2 ? 22 : 23},${y}`] = { trench: { side: 'own', kind: 'fire', level: 2, facing: 'E' } };
  const full = lineStatus(map, { ...s, cells }, 'a', { y0: 9, y1: 31, minLevel: 2, xMin: 15, xMax: 28 });
  assert.equal(full.done, true, 'schraeg verbundene Felder zaehlen als Linie');
  const back = {}; for (const k of Object.keys(cells)) back[k] = { trench: { ...cells[k].trench, facing: 'W' } };
  assert.equal(lineStatus(map, { ...s, cells: back }, 'a', { y0: 9, y1: 31 }).done, false, 'Auftritt nach hinten zaehlt nicht');
  assert.deepEqual(trenchesLost(map, { ...s, cells: { '22,10': { trench: { side: 'enemy', kind: 'fire', level: 2 } } } }, 'a'), [{ x: 22, y: 10 }]);
  assert.equal(groupsAt(s, 'a', [{ x: 22, y: 10 }]).length, 1);
  assert.equal(positionRounds([{ kind: 'position' }, { kind: 'battle' }]), 1);
  assert.equal(judgeMission('a1m1', { state: s, rounds: [], side: 'a', map }), null, 'am Anfang noch offen');
  assert.equal(judgeMission('a1m1', { state: { ...s, cells }, rounds: [], side: 'a', map })?.outcome, 'sieg');
});

// Jede Mission: wer den Auftrag ernst nimmt, gewinnt; wer es nicht tut, verliert (feste Seeds, deterministisch)
const CASES = {
  a1m1: { win: 'gut', lose: 'passiv', seeds: [1, 2] },
  a1m2: { win: 'gut', lose: 'passiv', seeds: [1, 2] },
  a1m3: { win: 'gut', lose: 'falsch', seeds: [1, 2] },
  a1m4: { win: 'gut', lose: 'falsch', seeds: [1, 2] },
  a1m5: { win: 'gut', lose: 'passiv', seeds: [1, 2] },
  a1m6: { win: 'gut', lose: 'passiv', seeds: [1] },
};
for (const id of IDS) {
  const s = scen[id];
  const c = CASES[s.mission.id];
  test(`${id}: gewinnbar und verlierbar`, () => {
    const mj = mapJson(id);
    for (const seed of c.seeds) {
      const w = playMission({ mapJson: mj, scenario: s, seed, player: PLAYERS[s.mission.id][c.win] });
      assert.equal(w.outcome, 'sieg', `${c.win}, Seed ${seed}: ${w.why}`);
      assert.ok(w.orderMet);
      const l = playMission({ mapJson: mj, scenario: s, seed, player: PLAYERS[s.mission.id][c.lose] });
      assert.equal(l.outcome, 'niederlage', `${c.lose}, Seed ${seed}: ${l.why}`);
      assert.ok(l.why.length > 0);
    }
  });
}

test('a1m6: der Durchbruch setzt Flags fuer den naechsten Akt', () => {
  const s = scen['akt1-m6'];
  const r = playMission({ mapJson: mapJson('akt1-m6'), scenario: s, seed: 1, player: PLAYERS.a1m6.passiv });
  assert.ok(r.flags.includes('velde_verloren'));
});

test('Missionen sind deterministisch', () => {
  const s = scen['akt1-m2'];
  const a = playMission({ mapJson: mapJson('akt1-m2'), scenario: s, seed: 7, player: PLAYERS.a1m2.gut });
  const b = playMission({ mapJson: mapJson('akt1-m2'), scenario: s, seed: 7, player: PLAYERS.a1m2.gut });
  assert.deepEqual(a.state, b.state);
});
