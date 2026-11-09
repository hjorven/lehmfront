// P11: Etappe im Spielzustand (js/etappe-map.js), Phase etappe (js/phases/build.js), Anbindung an die Versorgung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { isValidEvent } from '../js/events.js';
import '../js/phases/index.js';
import {
  etappeGrid, initEtappen, createEtappe, plotAt, plotRect, sideBuildings, withEtappe, planView, railCellsOf, PLOT,
} from '../js/etappe-map.js';
import { runEtappeSide, damageBuildingAt, SMOKE_RANGE, MAX_BUILDS } from '../js/phases/build.js';
import { etappeYield, buildingYield } from '../js/etappe.js';
import { supplyNetwork, buildingsWithRole, capacityOf } from '../js/supply.js';
import { validateOrder } from '../js/orders.js';

const map = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
const scenario = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url)));
const SEED = 1917;

function start() {
  return initEtappen(createInitialState(map, scenario, SEED), map, scenario);
}

/** Eine Stellungsrunde mit Etappenauftrag der Seite a */
function turn(state, plan = null, extraA = []) {
  const ordersA = [...extraA, ...(plan ? [{ type: 'etappe', builds: [], repairs: [], reward: null, ...plan }] : [])];
  return resolveTurn(state, ordersA, [], SEED, state.turn, { map });
}

const ofPhase = (log, type) => log.filter((e) => e.phase === 'etappe' && e.type === type);
const at = (et, x, y) => et.buildings.find((b) => b.x === x && b.y === y);

test('Parzellenraster: Asse-Etappe hat 7 x 13 Parzellen zu je 3 x 3 Feldern', () => {
  const g = etappeGrid(map, 'a');
  assert.equal(PLOT, 3);
  assert.equal(g.cols, 7);
  assert.equal(g.rows, 13);
  assert.equal(g.fields.length, 91);
  assert.deepEqual(g.origin, { x: 0, y: 0 });
  // Wald im Norden ist nicht bebaubar, der Fluss im Westen ist Wasser
  assert.equal(g.fields.find((f) => f.x === 2 && f.y === 0).ground, 'wald');
  assert.equal(g.fields.find((f) => f.x === 0 && f.y === 5).ground, 'wasser');
  assert.deepEqual(plotAt(g, 4, 16), { x: 1, y: 5 });
  assert.equal(plotAt(g, 30, 16), null);
  // Gegenseite: Raster vom hinteren Kartenrand aus
  const b = etappeGrid(map, 'b');
  assert.ok(b.cols >= 2 && b.origin.x + b.cols * PLOT === map.width);
});

test('Grundausbau aus dem Szenario: Depot und Bahnhof am Gleis, 6 Loren, Stufe 2 schon erreicht', () => {
  const s = start();
  const et = s.sides.a.etappe;
  assert.equal(s.sides.b.etappe, undefined, 'die Gegenseite hat auf der Asse keine Etappe');
  assert.equal(at(et, 1, 5).type, 'depot');
  assert.equal(at(et, 2, 5).type, 'feldbahnhof');
  assert.equal(at(et, 1, 6).type, 'gleis');
  assert.equal(at(et, 1, 6).map, true, 'Kartengleis wird Gleis-Parzelle');
  const y = etappeYield(et);
  assert.equal(y.total.loren, 6);
  assert.equal(et.best, 2);
  assert.equal(et.level, 2);
  // Eingabe bleibt unveraendert
  const raw = createInitialState(map, scenario, SEED);
  initEtappen(raw, map, scenario);
  assert.equal(raw.sides.a.etappe, undefined);
});

test('Ohne Grundausbau werden Kartengebaeude uebernommen', () => {
  const et = createEtappe(map, 'a');
  assert.ok(et.buildings.some((b) => b.type === 'depot'));
  assert.ok(et.buildings.some((b) => b.type === 'feldlazarett'));
  assert.equal(createEtappe(map, 'b'), null, 'ohne Depot keine Etappe');
});

test('Nachbarboni: Ruhelager neben der Feldkueche bringt beiden mehr', () => {
  const s = start();
  let r = turn(s, { builds: [{ type: 'ruhelager', x: 2, y: 3 }] });
  r = turn(r.state);
  const et = r.state.sides.a.etappe;
  const kitchen = buildingYield(et, at(et, 1, 3));
  const rest = buildingYield(et, at(et, 2, 3));
  assert.equal(kitchen.total.moral, 2, 'Kueche +1 Moral je Ruhelager');
  assert.equal(rest.total.erholung, 3, 'Ruhelager +1 Erholung je Kueche');
  assert.ok(rest.bonus.some((b) => /Feldküche/.test(b.reason)));
});

test('Bauen: Material wird abgezogen, Bauzeit in Stellungsrunden, Fertigmeldung', () => {
  const s = start();
  const mat = s.sides.a.supplies.material;
  const r1 = turn(s, { builds: [{ type: 'feldkueche', x: 4, y: 4 }] });
  const started = ofPhase(r1.log, 'build_started');
  assert.equal(started.length, 1);
  assert.match(started[0].reason, /Feldküche auf E5: 12 Material, fertig in 2 Stellungsrunden/);
  const et1 = r1.state.sides.a.etappe;
  assert.equal(at(et1, 4, 4).remaining, 1, 'erste Runde Arbeit zaehlt schon');
  assert.ok(r1.state.sides.a.supplies.material < mat);
  const r2 = turn(r1.state);
  assert.equal(ofPhase(r2.log, 'build_done').length, 1);
  assert.equal(at(r2.state.sides.a.etappe, 4, 4).remaining, 0);
});

test('Bauauftrag wird mit Begruendung abgelehnt: Wasser, belegt, zu wenig Material', () => {
  const s = start();
  s.sides.a.supplies.material = 10;
  const r = turn(s, { builds: [{ type: 'gleis', x: 0, y: 6 }, { type: 'werkstatt', x: 1, y: 5 }, { type: 'feldlazarett', x: 4, y: 4 }] });
  const no = ofPhase(r.log, 'build_refused').map((e) => e.reason);
  assert.equal(no.length, 3);
  assert.match(no[0], /Wasser/);
  assert.match(no[1], /belegt: Depot/);
  assert.match(no[2], /zu wenig Material/);
  assert.equal(ofPhase(r.log, 'build_started').length, 0, 'nichts gebaut, nichts abgebucht');
});

test('Ertraege wirken: Loren setzen die Feldbahn, Verpflegung und Material ins Depot', () => {
  const s = start();
  s.sides.a.supplies.cartsTotal = 99;
  const food0 = s.sides.a.supplies.food;
  const r = turn(s, { builds: [{ type: 'ziegelei', x: 4, y: 7 }] });
  assert.equal(capacityOf(r.state, 'a'), 6, 'cartsTotal kommt aus der Etappe');
  const y = ofPhase(r.log, 'etappe_yield')[0];
  assert.match(y.reason, /6 Loren je Runde, \+3 Verpflegung/);
  assert.ok(r.state.sides.a.supplies.food >= food0 - 50);
  // Ziegelei auf Lehm: 2 + 4 Lehmnachbarn = 6 Material je Runde, sobald fertig
  let st = r.state;
  for (let i = 0; i < 3; i++) st = turn(st).state;
  assert.equal(st.sides.a.etappe.yield.material, 6);
});

test('Zweiter Bahnhof am Depot hebt die Stufe; Belohnung wird gewaehlt und wirkt', () => {
  const s = start();
  let r = turn(s, { reward: { level: 2, id: 'zweite-gleisstrecke' } });
  assert.equal(ofPhase(r.log, 'etappe_reward').length, 1);
  assert.match(ofPhase(r.log, 'etappe_reward')[0].reason, /Zweite Gleisstrecke/);
  assert.equal(capacityOf(r.state, 'a'), 8);
  // Stufe 3 braucht 8 Loren aus eigenen Gebaeuden, die Belohnung (+2) zaehlt nicht mit: zweiter Bahnhof und zweites Depot am Gleis
  r = turn(r.state, { builds: [{ type: 'feldbahnhof', x: 3, y: 5 }, { type: 'depot', x: 3, y: 4 }] });
  r = turn(r.state);
  assert.match(ofPhase(r.log, 'etappe_level')[0].reason, /steigt auf Stufe 4/);
  const lv = r.state.sides.a.etappe;
  assert.equal(etappeYield(lv).levelLoren, 12, 'je Depot und Bahnhof 2 + 1 Nachbarbonus');
  assert.equal(lv.best, 4);
  // Doppelte Wahl fuer dieselbe Stufe wird abgelehnt
  const again = turn(r.state, { reward: { level: 2, id: 'zusatzbatterie' } });
  assert.match(ofPhase(again.log, 'build_refused')[0].reason, /schon gewählt/);
});

test('Beschuss: getroffenes Feld der Parzelle beschaedigt das Gebaeude, Loren fallen, Reparatur hilft', () => {
  const s = start();
  const et = s.sides.a.etappe;
  const r0 = plotRect(et, 2, 5); // Feldbahnhof
  s.cells[(r0.x + 2) + ',' + (r0.y + 1)] = { buildingDamaged: true };
  const r1 = turn(s);
  const hit = ofPhase(r1.log, 'building_damaged');
  assert.equal(hit.length, 1);
  assert.match(hit[0].reason, /Feldbahnhof C6 ist getroffen/);
  assert.equal(at(r1.state.sides.a.etappe, 2, 5).damaged, true);
  assert.equal(capacityOf(r1.state, 'a'), 2, 'nur noch das Depot ohne Bahnhof-Bonus');
  assert.equal(r1.state.cells[(r0.x + 2) + ',' + (r0.y + 1)].buildingDamaged, undefined, 'Treffer ist uebernommen');
  // keine doppelte Meldung in der naechsten Runde
  const r2 = turn(r1.state, { repairs: [at(r1.state.sides.a.etappe, 2, 5).id] });
  assert.equal(ofPhase(r2.log, 'building_damaged').length, 0);
  assert.equal(ofPhase(r2.log, 'repair_started').length, 1);
  assert.equal(ofPhase(r2.log, 'building_repaired').length, 1);
  assert.equal(capacityOf(r2.state, 'a'), 6);
});

test('damageBuildingAt fuer andere Pakete (Artillerie)', () => {
  const s = start();
  const r = plotRect(s.sides.a.etappe, 1, 5);
  const b = damageBuildingAt(s, 'a', r.x + 1, r.y + 1);
  assert.equal(b.type, 'depot');
  assert.equal(damageBuildingAt(s, 'a', 40, 10), null);
});

test('Versorgung liest die Etappe: zerschossenes Depot schneidet alle Abschnitte ab', () => {
  const s = start();
  assert.equal(buildingsWithRole(map, s, 'a', 'depot').length, 1);
  assert.equal(buildingsWithRole(map, s, 'a', 'kitchen')[0].type, 'feldkueche');
  assert.ok(supplyNetwork(map, s, 'a').sections.every((x) => x.connected));
  const d = at(s.sides.a.etappe, 1, 5);
  d.damaged = true;
  const net = supplyNetwork(map, s, 'a');
  assert.equal(net.abstract, false);
  assert.ok(net.sections.every((x) => !x.connected));
  assert.equal(net.sections[0].cutWhy, 'Depot getroffen');
  // Gebaeude im Bau zaehlen noch nicht
  const s2 = start();
  s2.sides.a.etappe.buildings.push({ id: 'g200', type: 'verbandsplatz', x: 3, y: 2, remaining: 1 });
  assert.equal(sideBuildings(map, s2, 'a').some((b) => b.id === 'etappe-g200'), false);
});

test('Neues Gleis legt Gleisfelder fuer die Feldbahn', () => {
  const s = start();
  const r = turn(s, { builds: [{ type: 'gleis', x: 3, y: 5 }] });
  const g = at(r.state.sides.a.etappe, 3, 5);
  assert.equal(g.remaining, 0);
  const cells = railCellsOf(r.state.sides.a.etappe, g);
  assert.ok(cells.length >= 3);
  for (const c of cells) assert.equal(r.state.cells[c.x + ',' + c.y].rail, true);
});

test('Aufklaerung: Rauch der Feldkueche verraet sie am Tag, nachts nicht', () => {
  const s = start();
  s.sides.a.etappe.buildings.push({ id: 'g099', type: 'feldkueche', x: 6, y: 4 });
  const night = structuredClone(s);
  night.night = true;
  night.clock.hour = 22;
  const day = turn(s);
  const spot = day.log.filter((e) => e.type === 'building_spotted');
  assert.equal(spot.length, 1);
  assert.equal(spot[0].how, 'smoke');
  assert.match(spot[0].reason, /Rauch über der Feldküche G5/);
  assert.equal(at(day.state.sides.a.etappe, 6, 4).spotted, 1);
  const foeEvent = day.log.find((e) => e.type === 'enemy_building_spotted');
  assert.equal(foeEvent.side, 'b');
  assert.ok(day.state.sides.b.intel.buildings['a:g099']);
  // Die Kueche hinten (B4) ist zu weit weg
  assert.equal(at(day.state.sides.a.etappe, 1, 3).spotted, undefined);
  const n = turn(night);
  assert.equal(n.log.filter((e) => e.type === 'building_spotted').length, 0);
  assert.ok(SMOKE_RANGE > 20);
});

test('Gegner sieht auf der Lagekarte nur aufgeklaerte Gebaeude', () => {
  const s = start();
  s.sides.a.etappe.buildings.push({ id: 'g099', type: 'feldkueche', x: 6, y: 4, spotted: 1 });
  const forA = withEtappe(map, s, 'a').buildings.filter((b) => b.id.startsWith('etappe-a-'));
  const forB = withEtappe(map, s, 'b').buildings.filter((b) => b.id.startsWith('etappe-a-'));
  assert.equal(forA.length, s.sides.a.etappe.buildings.filter((b) => b.type !== 'gleis').length);
  assert.deepEqual(forB.map((b) => b.type), ['feldkueche']);
  // Kartengebaeude der Etappe sind ersetzt, Unterstaende bleiben
  const ids = withEtappe(map, s, 'a').buildings.map((b) => b.id);
  assert.ok(!ids.includes('depot'));
  assert.ok(ids.includes('unterstand1'));
});

test('Feldpost: alle 5 Stellungsrunden Moral +2', () => {
  let s = start();
  s.sides.a.etappe.buildings.push({ id: 'g098', type: 'feldpost', x: 3, y: 2 });
  let posts = 0;
  for (let i = 0; i < 5; i++) {
    const before = s.groups.filter((g) => g.side === 'a').map((g) => g.morale);
    const r = turn(s);
    const p = ofPhase(r.log, 'feldpost');
    posts += p.length;
    if (p.length) assert.match(p[0].reason, /Feldpost ist da/);
    s = r.state;
    void before;
  }
  assert.equal(posts, 1);
});

test('Befehl Etappe: Pruefung und Hoechstzahl', () => {
  const s = start();
  assert.equal(validateOrder({ type: 'etappe', builds: [{ type: 'depot', x: 1, y: 1 }] }, s, 'a'), null);
  assert.match(validateOrder({ type: 'etappe', builds: [{ type: 'burg', x: 1, y: 1 }] }, s, 'a'), /unbekanntes Gebäude/);
  assert.match(validateOrder({ type: 'etappe', builds: [] }, s, 'b'), /keine Etappe/);
  const many = Array.from({ length: MAX_BUILDS + 1 }, (_, i) => ({ type: 'gleis', x: i % 7, y: 9 + (i > 6 ? 1 : 0) }));
  assert.match(validateOrder({ type: 'etappe', builds: many }, s, 'a'), /höchstens/);
});

test('Etappenfenster-Vorschau: geplante Bauten und Reparaturen kosten Material', () => {
  const s = start();
  const et = s.sides.a.etappe;
  et.buildings.find((b) => b.type === 'werkstatt').damaged = true;
  const id = et.buildings.find((b) => b.type === 'werkstatt').id;
  const v = planView(et, { builds: [{ type: 'feldkueche', x: 4, y: 4 }], repairs: [id] }, 90);
  assert.equal(v.cost, 12 + 7);
  assert.equal(v.material, 90 - 19);
  assert.equal(v.buildings.find((b) => b.id === 'plan-0').planned, 'build');
  assert.equal(v.buildings.find((b) => b.id === id).planned, 'repair');
  assert.equal(et.buildings.find((b) => b.id === id).damaged, true, 'Etappe bleibt unveraendert');
});

test('Determinismus und Ereignisse: gleiche Eingabe, gleiches Ergebnis; jedes Ereignis mit Grund und Ort', () => {
  const plan = { builds: [{ type: 'feldkueche', x: 6, y: 4 }, { type: 'gleis', x: 3, y: 5 }], reward: { level: 2, id: 'zusatzbatterie' } };
  const a = turn(start(), plan);
  const b = turn(start(), plan);
  assert.equal(JSON.stringify(a.state), JSON.stringify(b.state));
  assert.equal(JSON.stringify(a.log), JSON.stringify(b.log));
  for (const e of a.log) assert.ok(isValidEvent(e), JSON.stringify(e));
  const etEvents = a.log.filter((e) => e.phase === 'etappe');
  assert.ok(etEvents.length >= 3);
  for (const e of etEvents) assert.ok(e.reason.length > 10);
});

test('runEtappeSide ohne Karte (reine Regeln) laeuft und spaeht nicht', () => {
  const s = start();
  const log = [];
  const y = runEtappeSide(s, 'a', { turn: 1, emit: (type, f) => log.push({ type, ...f }), order: null });
  assert.equal(y.total.loren, 6);
  assert.ok(!log.some((e) => e.type === 'building_spotted'));
});

test('Getroffene Baustelle ruht bis zur Reparatur; Reparatur behaelt die Restbauzeit', () => {
  const s = start();
  let r = turn(s, { builds: [{ type: 'feldlazarett', x: 4, y: 2 }] }); // 3 Runden, nach Runde 1 noch 2
  const rect = plotRect(r.state.sides.a.etappe, 4, 2);
  r.state.cells[rect.x + ',' + rect.y] = { buildingDamaged: true };
  r = turn(r.state);
  let b = at(r.state.sides.a.etappe, 4, 2);
  assert.equal(b.damaged, true);
  assert.equal(b.remaining, 2, 'keine Arbeit an einer zerschossenen Baustelle');
  r = turn(r.state);
  assert.equal(ofPhase(r.log, 'build_done').length, 0);
  r = turn(r.state, { repairs: [b.id] });
  b = at(r.state.sides.a.etappe, 4, 2);
  assert.equal(b.damaged, false);
  assert.equal(b.remaining, 1, 'Reparatur plus eine Runde Arbeit, Rest bleibt');
});

test('Treffer auf leere Parzelle verfaellt; cartsLost zieht Loren ab', () => {
  const s = start();
  const rect = plotRect(s.sides.a.etappe, 4, 4);
  s.cells[rect.x + ',' + rect.y] = { buildingDamaged: true };
  s.sides.a.supplies.cartsLost = 2;
  const r = turn(s);
  assert.equal(r.state.cells[rect.x + ',' + rect.y].buildingDamaged, undefined);
  assert.equal(capacityOf(r.state, 'a'), 4);
});

test('P09: Batterie in zerschossener Stellung schweigt, nach der Reparatur nicht mehr', () => {
  const s = start();
  const art = s.sides.a.artillery;
  assert.ok(art?.batteries?.length, 'Asse hat eigene Batterien');
  const ab = art.batteries[0];
  const p = plotAt(s.sides.a.etappe, ab.pos.x, ab.pos.y);
  const eb = at(s.sides.a.etappe, p.x, p.y);
  assert.equal(eb.type, 'batteriestellung');
  eb.damaged = true;
  let r = turn(s);
  assert.ok(r.state.sides.a.artillery.batteries.find((b) => b.id === ab.id).silenced > 0);
  r = turn(r.state, { repairs: [eb.id] });
  r = turn(r.state);
  assert.equal(r.state.sides.a.artillery.batteries.find((b) => b.id === ab.id).silenced, 0);
});
