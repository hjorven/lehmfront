// P03: Bewegungsphase, Befehlsbuch, Zusammenfassung, Werkzeug-Register, Tageszeit, Szenario "Gefecht frei"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadMap, cellAt } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { moveBudget, stepCost, redeployAllowed } from '../js/phases/move.js';
import { validateOrder } from '../js/orders.js';
import { createOrderBook, setOrder, clearOrder, undo, listOrders, orderOf, seal, nextRound, canUndo } from '../js/ui/orderbook.js';
import { summarize, checklist, registerCheck, unregisterCheck } from '../js/ui/summary.js';
import { registerTool, unregisterTool, allTools, toolByKey, usable } from '../js/ui/tools.js';
import '../js/ui/tools/index.js';
import { planMove, moveTypeFor } from '../js/ui/tools/move.js';
import { darknessAt } from '../js/ui/daytime.js';
import { groupName, groupMark, fatigueWord, leaderShort } from '../js/ui/labels.js';
import { overlaySlots } from '../js/ui/overlays.js';
import '../js/ui/overlays/index.js';
import { planOrders } from '../js/ai/dummy.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const MAP = loadMap(read('../data/maps/asse.json'));
const SCEN = read('../data/scenarios/asse-frei.json');
const fresh = (seed = 7) => createInitialState(MAP, SCEN, seed);
const env = { map: MAP };

function lineEast(from, n) {
  return Array.from({ length: n }, (_, i) => ({ x: from.x - i - 1, y: from.y }));
}

test('Szenario Gefecht frei: 5 gegen 3 auf begehbaren Feldern, Seite b ist KI', () => {
  const s = fresh();
  // P09: Seite a hat zusaetzlich Beobachter und Melder fuer die Artillerie
  assert.equal(s.groups.filter((g) => g.side === 'a').length, 5);
  assert.equal(s.groups.filter((g) => g.side === 'b').length, 3);
  assert.equal(s.sides.b.control, 'ai');
  for (const g of s.groups) {
    const c = cellAt(MAP, g.pos.x, g.pos.y);
    assert.ok(c && !c.building && c.terrain !== 'wasser', `${g.id} steht auf begehbarem Feld`);
  }
  assert.deepEqual(planOrders(), []);
});

test('Verlegen: Budget der Stellungsrunde, Rest bleibt als Ereignis', () => {
  const s = fresh();
  const g = s.groups.find((x) => x.id === 'a01');
  const path = lineEast(g.pos, 20); // nach Westen in die Etappe
  const r = resolveTurn(s, [{ group: 'a01', type: 'redeploy', path }], [], 7, 1, env);
  const moved = r.state.groups.find((x) => x.id === 'a01');
  const ev = r.log.find((e) => e.type === 'redeploy');
  assert.ok(ev, 'Ereignis redeploy');
  assert.ok(ev.reason.includes('Gruppe'), ev.reason);
  assert.equal(moved.pos.x, g.pos.x - ev.steps);
  assert.equal(ev.rest.length, 20 - ev.steps);
  assert.ok(ev.steps >= 6 && ev.steps < 20, 'zwoelf Stunden reichen nicht fuer 20 Felder: ' + ev.steps);
  assert.equal(moved.holdTurns, 0);
});

test('Verlegen ins Niemandsland ist ungueltig, Gruppe haelt mit Begruendung', () => {
  const s = fresh();
  const g = s.groups.find((x) => x.id === 'a01');
  const path = [{ x: g.pos.x + 1, y: g.pos.y }, { x: g.pos.x + 2, y: g.pos.y }, { x: g.pos.x + 3, y: g.pos.y }];
  const why = validateOrder({ group: 'a01', type: 'redeploy', path }, s, 'a', env);
  assert.match(why, /hinter der eigenen Linie/);
  const r = resolveTurn(s, [{ group: 'a01', type: 'redeploy', path }], [], 7, 1, env);
  assert.deepEqual(r.state.groups.find((x) => x.id === 'a01').pos, g.pos);
  assert.ok(r.log.some((e) => e.type === 'order_invalid'));
});

test('Weg mit Sprung ist ungueltig', () => {
  const s = fresh();
  const g = s.groups[0];
  assert.match(validateOrder({ group: g.id, type: 'redeploy', path: [{ x: g.pos.x - 3, y: g.pos.y }] }, s, 'a', env), /springt/);
});

test('Bewegen im Gefecht: speed Felder, besetztes Feld haelt davor an, eine Gruppe schafft immer ein Feld', () => {
  const s = fresh();
  s.turnKind = 'battle';
  s.battle = { round: 0 };
  const a1 = s.groups.find((x) => x.id === 'a01');
  const a2 = s.groups.find((x) => x.id === 'a02');
  a2.pos = { x: a1.pos.x - 2, y: a1.pos.y };
  const r = resolveTurn(s, [{ group: 'a01', type: 'move', path: lineEast(a1.pos, 5) }], [], 7, 1, env);
  const ev = r.log.find((e) => e.type === 'move');
  assert.equal(ev.steps, 1);
  assert.equal(ev.blocked, true);
  assert.match(ev.reason, /besetzt/);
  assert.equal(moveBudget({ type: 'rifles' }, 'battle'), 30);
  assert.equal(moveBudget({ type: 'mg' }, 'position'), 80);
  // Sumpf (30) ist teurer als das MG-Budget (20): ein Feld geht trotzdem
  assert.equal(stepCost(null, { x: 0, y: 0 }, { x: 1, y: 1 }), 14);
});

test('Bewegung ist deterministisch', () => {
  const orders = [{ group: 'a01', type: 'redeploy', path: lineEast({ x: 32, y: 8 }, 8) }, { group: 'a03', type: 'hold' }];
  const r1 = resolveTurn(fresh(3), orders, [], 3, 1, env);
  const r2 = resolveTurn(fresh(3), structuredClone(orders), [], 3, 1, env);
  assert.deepEqual(r1, r2);
});

test('redeployAllowed: nur eigene Stellung und Etappe', () => {
  assert.equal(redeployAllowed(cellAt(MAP, 20, 10), 'a'), true);
  assert.equal(redeployAllowed(cellAt(MAP, 38, 10), 'a'), false);
  assert.equal(redeployAllowed(cellAt(MAP, 50, 10), 'a'), false);
  assert.equal(redeployAllowed(cellAt(MAP, 50, 10), 'b'), true);
});

test('Befehlsbuch: setzen, ersetzen, entfernen, Undo in umgekehrter Reihenfolge', () => {
  let b = createOrderBook();
  b = setOrder(b, 'a', { group: 'a02', type: 'hold' });
  b = setOrder(b, 'a', { group: 'a01', type: 'redeploy', path: [{ x: 1, y: 1 }] });
  b = setOrder(b, 'a', { group: 'a01', type: 'hold' });
  assert.deepEqual(listOrders(b, 'a').map((o) => o.group), ['a01', 'a02']);
  assert.equal(orderOf(b, 'a', 'a01').type, 'hold');
  const same = setOrder(b, 'a', { group: 'a01', type: 'hold' });
  assert.equal(same, b, 'gleicher Befehl aendert nichts');
  b = clearOrder(b, 'a', 'a02');
  assert.equal(orderOf(b, 'a', 'a02'), null);
  let u = undo(b, 'a'); b = u.book;
  assert.equal(u.group, 'a02');
  assert.equal(orderOf(b, 'a', 'a02').type, 'hold');
  b = undo(b, 'a').book;
  assert.equal(orderOf(b, 'a', 'a01').type, 'redeploy');
  b = undo(b, 'a').book;
  b = undo(b, 'a').book;
  assert.equal(listOrders(b, 'a').length, 0);
  assert.equal(canUndo(b, 'a'), false);
  assert.equal(undo(b, 'a').group, null);
  assert.equal(listOrders(b, 'b').length, 0, 'Seiten getrennt');
});

test('Befehlsbuch: versiegelt nicht mehr aenderbar, neue Runde uebernimmt Weiterlaeufer', () => {
  let b = setOrder(createOrderBook(), 'a', { group: 'a01', type: 'hold' });
  b = seal(b, 'a');
  assert.equal(setOrder(b, 'a', { group: 'a02', type: 'hold' }), b);
  assert.equal(undo(b, 'a').book, b);
  const n = nextRound(b, { a: [{ group: 'a03', type: 'redeploy', path: [{ x: 2, y: 2 }], carried: true }] });
  assert.equal(n.a.sealed, false);
  assert.deepEqual(listOrders(n, 'a').map((o) => o.group), ['a03']);
  assert.equal(canUndo(n, 'a'), false);
});

test('Zusammenfassung: Gruppen ohne Befehl, Sturm verlangt Halten', () => {
  const s = fresh();
  const plain = summarize({ state: s, side: 'a', orders: [{ group: 'a01', type: 'hold' }] });
  assert.equal(plain.needsHold, false);
  assert.ok(plain.lines.some((l) => l.tone === 'warn' && l.text.includes('ohne Befehl') && l.text.includes('2. Gruppe')));
  const storm = summarize({ state: s, side: 'a', orders: [{ group: 'a01', type: 'assault', path: [{ x: 33, y: 8 }] }] });
  assert.equal(storm.needsHold, true);
  assert.match(storm.lines[0].text, /stürmt/);
});

test('Checkliste: angemeldete Pruefpunkte, Warnungen zuerst, Fehler werden Warnung', () => {
  const s = fresh();
  registerCheck('test-ok', () => [{ tone: 'ok', text: 'Alle Abschnitte erreichbar' }]);
  registerCheck('test-kaputt', () => { throw new Error('kaputt'); });
  try {
    const all = s.groups.filter((g) => g.side === 'a').map((g) => ({ group: g.id, type: 'hold' }));
    const items = checklist({ state: s, side: 'a', orders: all });
    assert.equal(items[0].tone, 'warn');
    assert.ok(items.some((i) => i.text === 'Alle Abschnitte erreichbar'));
    assert.ok(items.some((i) => i.text === 'Alle Gruppen haben einen Befehl'));
    assert.throws(() => registerCheck('test-ok', () => []));
  } finally {
    unregisterCheck('test-ok');
    unregisterCheck('test-kaputt');
  }
});

test('Werkzeug-Register: Bewegen und Halten, Tasten eindeutig', () => {
  const ids = allTools().map((t) => t.id);
  // Weitere Pakete melden eigene Werkzeuge an (P05 Feuern); Bewegen steht vor Halten
  assert.ok(ids.includes('move') && ids.includes('hold') && ids.indexOf('move') < ids.indexOf('hold'), ids.join());
  assert.equal(new Set(allTools().map((t) => t.key)).size, ids.length);
  // Lorenplan braucht keine Gruppe, aber eine Stellungsrunde
  const st = fresh();
  assert.equal(usable(toolByKey('l'), null, st).ok, true);
  assert.equal(usable(toolByKey('l'), null, { ...st, turnKind: 'battle' }).why, 'Lorenplan nur in Stellungsrunden');
  assert.equal(toolByKey('B').id, 'move');
  assert.equal(toolByKey('h').id, 'hold');
  assert.throws(() => registerTool({ id: 'x', key: 'b', label: 'X', canUse: () => true, begin() {} }), /schon an move/);
  registerTool({ id: 'test-probe', key: 'q', label: 'Probe', order: 1, canUse: () => 'Nur Pioniere', begin() {} });
  try {
    assert.equal(allTools()[0].id, 'test-probe');
    const s = fresh();
    assert.deepEqual(usable(toolByKey('q'), s.groups[0], s), { ok: false, why: 'Nur Pioniere' });
    assert.equal(usable(toolByKey('b'), null, s).ok, false);
    assert.equal(usable(toolByKey('b'), s.groups[0], s).ok, true);
  } finally {
    unregisterTool('test-probe');
  }
});

test('Werkzeug Halten setzt den Befehl sofort', () => {
  const s = fresh();
  let set = null, cancelled = false;
  toolByKey('h').begin({ group: s.groups[0], state: s, map: MAP, side: 'a', setOrder: (o) => { set = o; }, cancel: () => { cancelled = true; }, hint() {}, pickCell() {} });
  assert.deepEqual(set, { group: 'a01', type: 'hold' });
  assert.equal(cancelled, true);
});

test('planMove: erreichbarer Teil, Runden, besetzte Felder werden umgangen', () => {
  const s = fresh();
  const g = s.groups.find((x) => x.id === 'a01');
  assert.equal(moveTypeFor(s), 'redeploy');
  const near = planMove(MAP, s, g, { x: 30, y: 8 });
  assert.equal(near.rounds, 1);
  assert.equal(near.reach, near.path.length);
  const far = planMove(MAP, s, g, { x: 4, y: 3 });
  assert.ok(far.rounds >= 2, 'weit hinten braucht mehrere Runden');
  assert.ok(far.reach > 0 && far.reach < far.path.length);
  assert.equal(planMove(MAP, s, g, { x: 40, y: 8 }), null, 'Niemandsland geht beim Verlegen nicht');
  assert.equal(planMove(MAP, s, g, g.pos), null);
  // Feld einer anderen Gruppe ist kein Ziel
  const other = s.groups.find((x) => x.id === 'a02');
  assert.equal(planMove(MAP, s, g, other.pos), null);
  // der geplante Weg ist ein gueltiger Befehl
  assert.equal(validateOrder({ group: g.id, type: 'redeploy', path: far.path }, s, 'a', env), null);
});

test('Werkzeug Bewegen: Zielwahl setzt Befehl mit Weg', () => {
  const s = fresh();
  let req = null, set = null;
  toolByKey('b').begin({ group: s.groups[0], state: s, map: MAP, side: 'a', setOrder: (o) => { set = o; }, cancel() {}, hint() {}, pickCell: (r) => { req = r; } });
  assert.match(req.hint, /Verlegen/);
  assert.match(req.preview(cellAt(MAP, 28, 8)).text, /Felder/);
  assert.match(req.preview(cellAt(MAP, 40, 8)).text, /hinter der eigenen Linie/);
  assert.equal(req.pick(cellAt(MAP, 40, 8)), false);
  assert.equal(req.pick(cellAt(MAP, 28, 8)), true);
  assert.equal(set.type, 'redeploy');
  assert.deepEqual(set.path[set.path.length - 1], { x: 28, y: 8 });
});

test('Tageszeit: Stellungsrunde Tag oder Nacht ganz, Gefecht mit Daemmerung', () => {
  assert.equal(darknessAt({ hour: 6, minute: 0 }), 0);
  assert.equal(darknessAt({ hour: 18, minute: 0 }), 1);
  assert.equal(darknessAt({ hour: 12, minute: 0 }, 'battle'), 0);
  assert.equal(darknessAt({ hour: 23, minute: 0 }, 'battle'), 1);
  assert.equal(darknessAt({ hour: 18, minute: 0 }, 'battle'), 0.5);
  assert.equal(darknessAt({ hour: 6, minute: 0 }, 'battle'), 0.5);
});

test('Bezeichnungen', () => {
  const s = fresh();
  const [a1, a2, a3] = s.groups.filter((g) => g.side === 'a');
  assert.equal(groupName(s, a2), '2. Gruppe');
  assert.equal(groupMark(s, a1), '1');
  assert.equal(groupMark(s, a2), 'MG');
  assert.equal(groupMark(s, a3), 'Pi');
  assert.equal(fatigueWord(80), 'hoch');
  assert.match(leaderShort(a1), /^Gf\. \S+/);
});

test('Overlays: vier Plaetze, Sicht und Hoehe belegt', () => {
  const slots = overlaySlots();
  assert.deepEqual(slots.map((s) => s.slot), [1, 2, 3, 4]);
  assert.equal(slots[0].id, 'supply');
  assert.equal(slots[0].animated, true);
  assert.equal(slots[2].id, 'sight');
  assert.equal(typeof slots[3].draw, 'function');
});

test('Optik: Pfeil abschneiden, radiales Menue bleibt im Bild', async () => {
  const { cutPolyline, unitBox, hitUnit } = await import('../js/render/units-layer.js');
  const { radialLayout } = await import('../js/ui/radial.js');
  assert.deepEqual(cutPolyline([[0, 0], [2, 0], [2, 2]], 3), [[0, 0], [2, 0], [2, 1]]);
  assert.deepEqual(cutPolyline([[0, 0], [2, 0]], 0), [[0, 0]]);
  const cam = { zoom: 10 };
  assert.ok(Math.abs(unitBox(cam).w - 2.8) < 1e-9 && Math.abs(unitBox(cam).h - 1.8) < 1e-9);
  assert.equal(hitUnit(cam, { pos: { x: 5, y: 5 } }, 6.9, 5.5), true);
  assert.equal(hitUnit(cam, { pos: { x: 5, y: 5 } }, 7.5, 5.5), false);
  const L = radialLayout(3, 5, 5, 390, 844);
  assert.ok(L.x >= 74 + 33 && L.y >= 74 + 33, 'Mitte am Rand wird nach innen geschoben');
  assert.equal(L.items.length, 3);
  assert.equal(L.items[0].x, 0);
  assert.equal(L.items[0].y, -74);
});

test('Kolonne: Gruppe hinter einer abziehenden Gruppe kommt nach, unabhaengig von der ID', () => {
  const s = fresh();
  s.turnKind = 'battle';
  s.battle = { round: 0 };
  const a1 = s.groups.find((x) => x.id === 'a01');
  const a2 = s.groups.find((x) => x.id === 'a02');
  a1.pos = { x: 30, y: 9 };
  a2.pos = { x: 29, y: 9 };   // a02 steht vor a01, a01 hat die kleinere ID
  const r = resolveTurn(s, [
    { group: 'a01', type: 'move', path: [{ x: 29, y: 9 }, { x: 28, y: 9 }] },
    { group: 'a02', type: 'move', path: [{ x: 28, y: 9 }, { x: 27, y: 9 }] },
  ], [], 7, 1, env);
  const ev = (id) => r.log.find((e) => e.type === 'move' && e.group === id);
  assert.equal(ev('a02').steps, 2);
  assert.equal(ev('a01').steps, 2);
  assert.equal(ev('a01').blocked, false);
  assert.match(ev('a01').reason, /2 Felder/);
});

test('Ein Feld: Begruendung im Singular', () => {
  const s = fresh();
  const g = s.groups.find((x) => x.id === 'a01');
  const r = resolveTurn(s, [{ group: 'a01', type: 'redeploy', path: [{ x: g.pos.x - 1, y: g.pos.y }] }], [], 7, 1, env);
  assert.match(r.log.find((e) => e.type === 'redeploy').reason, /verlegt 1 Feld und/);
});
