import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, RESOURCES, ETAPPE_LEVELS } from '../js/config/buildings.js';
import { GROUNDS } from '../js/config/grounds.js';
import {
  fieldName, formatAmount, buildingYield, etappeYield, canBuild, previewBuild, buildOptions,
  placeBuilding, advanceConstruction, repairBuilding, repairCost, etappeLevel, pendingRewards, chooseReward, buildTimeFor,
} from '../js/etappe.js';

// 5 x 4 Felder Wiese, einzelne Boeden gezielt gesetzt
function grid(w = 5, h = 4, special = {}) {
  const fields = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = special[x + ',' + y] || {};
    fields.push({ x, y, ground: s.ground || 'wiese', height: s.height || 0 });
  }
  return fields;
}
const et = (buildings, special, rewards) => ({ fields: grid(5, 4, special), buildings, rewards });

test('Konfiguration: jedes Gebaeude ist vollstaendig und nutzt nur bekannte Ressourcen', () => {
  const plan10 = ['depot', 'feldbahnhof', 'gleis', 'feldkueche', 'ruhelager', 'verbandsplatz', 'feldlazarett', 'werkstatt',
    'saegewerk', 'ziegelei', 'betonmischer', 'fernmeldestelle', 'beobachtungsturm', 'batteriestellung', 'ausbildungslager', 'feldpost'];
  for (const id of plan10) assert.equal(BUILDINGS[id].act, 1, id);
  for (const id of ['offiziersquartier', 'ballonplatz']) assert.equal(BUILDINGS[id].act, 2, id);
  for (const id of ['kapelle', 'gedenkstaette', 'flugfeld']) assert.equal(BUILDINGS[id].act, 3, id);
  for (const [id, b] of Object.entries(BUILDINGS)) {
    assert.ok(b.name && b.effect, id);
    assert.ok(Number.isInteger(b.cost) && b.cost > 0, id);
    assert.ok(Number.isInteger(b.buildTime) && b.buildTime >= 1, id);
    for (const r of Object.keys(b.yield)) assert.ok(RESOURCES[r], id + ' ' + r);
    for (const bo of b.bonus || []) {
      for (const r of Object.keys(bo.add)) assert.ok(RESOURCES[r], id + ' bonus ' + r);
      for (const t of bo.per.building || []) assert.ok(BUILDINGS[t], id + ' verweist auf ' + t);
      for (const g of bo.per.ground || []) assert.ok(GROUNDS[g], id + ' verweist auf Boden ' + g);
      assert.ok(b.missing, id + ' braucht einen Text fuer fehlenden Bonus');
    }
  }
  for (const L of ETAPPE_LEVELS) if (L.level > 1) assert.equal(L.rewards.length, 2);
});

test('Feldnamen: Spalte als Buchstabe, Zeile ab 1', () => {
  assert.equal(fieldName(2, 2), 'C3');
  assert.equal(fieldName(0, 0), 'A1');
  assert.equal(fieldName(25, 9), 'Z10');
  assert.equal(fieldName(26, 0), 'AA1');
});

test('Formatierung: negative Wirkungen wie Erschoepfung mit Minus hinten', () => {
  assert.equal(formatAmount('verpflegung', 3), '+3 Verpflegung');
  assert.equal(formatAmount('erholung', 2), 'Erschöpfung −2');
});

test('Feldkueche ohne Nachbarn: Grundertrag und Hinweis auf fehlenden Bonus', () => {
  const y = buildingYield(et([]), { id: 'k', type: 'feldkueche', x: 2, y: 2 });
  assert.deepEqual(y.total, { moral: 1, verpflegung: 3 });
  assert.deepEqual(y.missing, ['kein Ruhelager angrenzend']);
});

test('Feldkueche und Ruhelager staerken sich gegenseitig', () => {
  const e = et([{ id: 'a', type: 'feldkueche', x: 1, y: 1 }, { id: 'b', type: 'ruhelager', x: 2, y: 1 }]);
  const t = etappeYield(e).total;
  assert.equal(t.moral, 2);
  assert.equal(t.erholung, 3);
  const k = buildingYield(e, e.buildings[0]);
  assert.equal(k.bonus[0].reason, '+1 Moral durch Ruhelager (Nachbar)');
});

test('Diagonal zaehlt nicht als angrenzend', () => {
  const e = et([{ id: 'a', type: 'feldkueche', x: 1, y: 1 }, { id: 'b', type: 'ruhelager', x: 2, y: 2 }]);
  assert.equal(etappeYield(e).total.moral, 1);
});

test('Bonus zaehlt jeden Nachbarn: Saegewerk zwischen drei Waldfeldern', () => {
  const special = { '1,1': { ground: 'wald' }, '3,1': { ground: 'wald' }, '2,0': { ground: 'wald' } };
  const y = buildingYield(et([], special), { id: 's', type: 'saegewerk', x: 2, y: 1 });
  assert.equal(y.total.holz, 5);
  assert.equal(y.bonus[0].count, 3);
  assert.match(y.bonus[0].reason, /3 Nachbarn/);
});

test('Beobachtungsturm sieht auf Hoehe weiter', () => {
  const flat = buildingYield(et([]), { id: 't', type: 'beobachtungsturm', x: 0, y: 0 });
  const hill = buildingYield(et([], { '0,0': { height: 2 } }), { id: 't', type: 'beobachtungsturm', x: 0, y: 0 });
  assert.equal(flat.total.sicht, 2);
  assert.equal(hill.total.sicht, 4);
  assert.match(hill.bonus[0].reason, /Höhe 2/);
});

test('Feldbahnhof ohne Gleis bringt nichts, mit Gleis und Depot drei Loren', () => {
  const ohne = et([{ id: 'a', type: 'feldbahnhof', x: 2, y: 2 }]);
  const yo = buildingYield(ohne, ohne.buildings[0]);
  assert.deepEqual(yo.total, {});
  assert.match(yo.blocked, /kein Gleis/);
  const mit = et([{ id: 'a', type: 'feldbahnhof', x: 2, y: 2 }, { id: 'b', type: 'gleis', x: 3, y: 2 }, { id: 'c', type: 'depot', x: 1, y: 2 }]);
  // Bahnhof 2 + 1 (Depot), Depot 2 + 1 (Bahnhof)
  assert.equal(etappeYield(mit).total.loren, 6);
});

test('Gebaeude im Bau oder beschaedigt bringen nichts und geben keinen Nachbarbonus', () => {
  const e = et([{ id: 'a', type: 'feldkueche', x: 1, y: 1 }, { id: 'b', type: 'ruhelager', x: 2, y: 1, remaining: 1 }]);
  assert.equal(etappeYield(e).total.moral, 1);
  assert.equal(etappeYield(e).total.erholung, undefined);
  const d = et([{ id: 'a', type: 'feldkueche', x: 1, y: 1, damaged: true }]);
  assert.deepEqual(etappeYield(d).total, {});
  assert.match(buildingYield(d, d.buildings[0]).blocked, /beschädigt/);
});

test('Feldpost wirkt nur alle fuenf Runden und steht getrennt', () => {
  const e = et([{ id: 'p', type: 'feldpost', x: 0, y: 0 }]);
  const y = etappeYield(e);
  assert.deepEqual(y.total, {});
  assert.deepEqual(y.periodic, [{ id: 'p', res: 'moral', amount: 2, every: 5 }]);
});

test('Bauen geht nicht auf Wald, belegtem Feld, ausserhalb, ohne Material oder vor dem Akt', () => {
  const e = et([{ id: 'a', type: 'depot', x: 0, y: 0 }], { '1,0': { ground: 'wald' } });
  assert.equal(canBuild(e, 1, 0, 'depot').ok, false);
  assert.match(canBuild(e, 0, 0, 'depot').reason, /belegt: Depot/);
  assert.equal(canBuild(e, 9, 9, 'depot').ok, false);
  assert.match(canBuild(e, 2, 2, 'depot', { material: 5 }).reason, /16 nötig, 5 da/);
  assert.match(canBuild(e, 2, 2, 'kapelle').reason, /Akt 3/);
  assert.equal(canBuild(e, 2, 2, 'kapelle', { act: 3 }).ok, true);
});

test('Vorschau zeigt eigenen Bonus und was der Bau den Nachbarn bringt', () => {
  const e = et([{ id: 'r', type: 'ruhelager', x: 2, y: 1 }]);
  const p = previewBuild(e, 1, 1, 'feldkueche');
  assert.equal(p.ok, true);
  assert.deepEqual(p.own.total, { moral: 2, verpflegung: 3 });
  assert.equal(p.neighbors.length, 1);
  assert.deepEqual(p.neighbors[0].delta, { erholung: 1 });
  assert.equal(p.neighbors[0].lines[0], 'Ruhelager C2: Erschöpfung −1');
  assert.deepEqual(p.totalDelta, { erholung: 1, moral: 2, verpflegung: 3 });
  assert.deepEqual(p.highlight, [{ x: 2, y: 1 }]);
  assert.equal(p.cost, 12);
  assert.equal(p.buildTime, 2);
});

test('Vorschau eines Gleises zeigt, dass der Bahnhof anfaengt zu fahren', () => {
  const e = et([{ id: 'b', type: 'feldbahnhof', x: 2, y: 2 }]);
  const p = previewBuild(e, 3, 2, 'gleis');
  assert.deepEqual(p.totalDelta, { loren: 2 });
});

test('Vorschau veraendert die Eingabe nicht', () => {
  const e = et([{ id: 'r', type: 'ruhelager', x: 2, y: 1 }]);
  const copy = structuredClone(e);
  previewBuild(e, 1, 1, 'feldkueche');
  buildOptions(e, 1, 1);
  placeBuilding(e, 1, 1, 'feldkueche');
  advanceConstruction(e);
  assert.deepEqual(e, copy);
});

test('Bauoptionen: baubare zuerst, spaetere Akte verborgen', () => {
  const opts = buildOptions(et([]), 2, 2, { material: 10 });
  assert.ok(!opts.some((o) => o.type === 'kapelle'));
  const firstBad = opts.findIndex((o) => !o.ok);
  assert.ok(firstBad > 0);
  assert.ok(opts.slice(firstBad).every((o) => !o.ok));
  assert.ok(opts.slice(0, firstBad).every((o) => o.cost <= 10));
});

test('Bauen und Bauzeit: fertig nach buildTime Stellungsrunden', () => {
  let e = et([]);
  const r = placeBuilding(e, 1, 1, 'feldkueche');
  assert.equal(r.ok, true);
  assert.equal(r.building.remaining, 2);
  e = r.etappe;
  assert.equal(etappeYield(e).total.verpflegung, undefined);
  let s = advanceConstruction(e);
  assert.deepEqual(s.finished, []);
  s = advanceConstruction(s.etappe);
  assert.deepEqual(s.finished, [r.building.id]);
  assert.equal(etappeYield(s.etappe).total.verpflegung, 3);
  assert.equal(placeBuilding(s.etappe, 1, 1, 'depot').ok, false);
});

test('Neue IDs sind eindeutig und deterministisch', () => {
  let e = et([]);
  const ids = [];
  for (let i = 0; i < 3; i++) { const r = placeBuilding(e, i, 0, 'gleis'); ids.push(r.building.id); e = r.etappe; }
  assert.deepEqual(ids, ['g001', 'g002', 'g003']);
});

test('Ergebnis haengt nicht von der Reihenfolge der Gebaeude ab', () => {
  const list = [{ id: 'a', type: 'feldkueche', x: 1, y: 1 }, { id: 'b', type: 'ruhelager', x: 2, y: 1 }, { id: 'c', type: 'depot', x: 0, y: 3 }];
  assert.deepEqual(etappeYield(et(list)), etappeYield(et([...list].reverse())));
});

test('Etappenstufen nach Loren pro Runde', () => {
  assert.equal(etappeLevel(0).level, 1);
  assert.equal(etappeLevel(4).level, 1);
  assert.equal(etappeLevel(5).level, 2);
  assert.equal(etappeLevel(5).next, 8);
  assert.equal(etappeLevel(20).level, 4);
  assert.equal(etappeLevel(20).next, null);
});

test('Belohnung waehlen: nur erreichte Stufen, nur einmal, wirkt auf den Ertrag', () => {
  // 6 Loren: Stufe 2
  const e = et([{ id: 'a', type: 'feldbahnhof', x: 2, y: 2 }, { id: 'b', type: 'gleis', x: 3, y: 2 }, { id: 'c', type: 'depot', x: 1, y: 2 }]);
  assert.deepEqual(pendingRewards(e).map((p) => p.level), [2]);
  assert.equal(chooseReward(e, 3, 'sanitaetszug').ok, false);
  assert.equal(chooseReward(e, 2, 'sanitaetszug').ok, false);
  const r = chooseReward(e, 2, 'zweite-gleisstrecke');
  assert.equal(r.ok, true);
  assert.equal(etappeYield(r.etappe).total.loren, 8);
  // Belohnungs-Loren heben die Stufe nicht selbst an: Gebaeude leisten weiter 6
  assert.equal(etappeYield(r.etappe).levelLoren, 6);
  assert.deepEqual(pendingRewards(r.etappe), []);
  assert.equal(chooseReward(r.etappe, 2, 'zusatzbatterie').ok, false);
});

test('Pionierpark verkuerzt Bauzeit, aber nie unter eine Runde', () => {
  const e = et([], {}, { 4: 'pionierpark' });
  assert.equal(buildTimeFor(e, 'feldlazarett'), 2);
  assert.equal(buildTimeFor(e, 'gleis'), 1);
});

test('Depot ohne Gleis und ohne Bahnhof bringt keine Loren', () => {
  const e = et([{ id: 'a', type: 'depot', x: 0, y: 0 }, { id: 'b', type: 'depot', x: 3, y: 3 }]);
  assert.deepEqual(etappeYield(e).total, {});
  assert.match(buildingYield(e, e.buildings[0]).blocked, /kein Gleis/);
});

test('Stillstehender Bahnhof gibt dem Depot keinen Bonus', () => {
  // Bahnhof ohne Gleis, Depot haengt am Bahnhof (Pflicht erfuellt), bekommt aber keinen Bonus
  const e = et([{ id: 'a', type: 'feldbahnhof', x: 2, y: 2 }, { id: 'c', type: 'depot', x: 1, y: 2 }]);
  const d = buildingYield(e, e.buildings[1]);
  assert.deepEqual(d.total, { loren: 2 });
  assert.deepEqual(d.bonus, []);
  assert.equal(etappeYield(e).total.loren, 2);
});

test('Vorschau nennt den Zustand nach Fertigstellung, Bauen liefert die Kosten', () => {
  const e = et([{ id: 'a', type: 'feldbahnhof', x: 2, y: 2 }]);
  const p = previewBuild(e, 3, 2, 'gleis');
  const r = placeBuilding(e, 3, 2, 'gleis');
  assert.equal(r.cost, 2);
  assert.equal(etappeYield(r.etappe).total.loren, undefined);
  const done = advanceConstruction(r.etappe).etappe;
  assert.deepEqual(etappeYield(done).total, p.totalDelta);
});

test('Reparatur: halbe Kosten aufgerundet, eine Runde, danach wieder Ertrag', () => {
  const e = et([{ id: 'k', type: 'feldkueche', x: 1, y: 1, damaged: true }]);
  assert.equal(repairCost('feldkueche'), 6);
  assert.equal(repairCost('depot'), 8);
  assert.equal(repairBuilding(e, 'k', { material: 3 }).ok, false);
  assert.equal(repairBuilding(et([{ id: 'k', type: 'feldkueche', x: 1, y: 1 }]), 'k').ok, false);
  const r = repairBuilding(e, 'k', { material: 10 });
  assert.equal(r.ok, true);
  assert.equal(r.cost, 6);
  assert.deepEqual(etappeYield(r.etappe).total, {});
  assert.equal(etappeYield(advanceConstruction(r.etappe).etappe).total.verpflegung, 3);
  assert.equal(e.buildings[0].damaged, true);
});
