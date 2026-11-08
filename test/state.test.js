import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, groupsOf, compareId, patchCell, cellKeys, getCell } from '../js/state.js';
import { UNIT_TYPES } from '../js/config/units.js';
import { FACTIONS } from '../js/config/factions.js';
import { NAMES } from '../js/config/names.js';
import { MAP, SCENARIO } from './fixtures/scenario.js';

test('Anfangszustand ist reines JSON und deterministisch', () => {
  const s1 = createInitialState(MAP, SCENARIO, 42);
  const s2 = createInitialState(MAP, SCENARIO, 42);
  assert.deepEqual(s1, s2);
  assert.deepEqual(JSON.parse(JSON.stringify(s1)), s1);
  assert.notDeepEqual(createInitialState(MAP, SCENARIO, 43).groups.map((g) => g.leader), s1.groups.map((g) => g.leader));
});

test('Anfangszustand hat alle Pflichtfelder', () => {
  const s = createInitialState(MAP, SCENARIO, 7);
  assert.equal(s.turn, 1);
  assert.equal(s.turnKind, 'position');
  assert.equal(s.night, false);
  assert.deepEqual(s.map, { id: 'test', width: 24, height: 12 });
  assert.equal(s.sides.a.faction, 'kaldern');
  assert.equal(s.sides.b.faction, 'morrow');
  for (const k of ['ammo', 'food', 'material']) assert.ok(s.sides.a.supplies[k] > 0);
  assert.ok(s.weather.kind);
  assert.deepEqual(s.groups.map((g) => g.id), ['a01', 'a02', 'a03', 'b01', 'b02']);
  for (const g of s.groups) {
    assert.ok(g.strength >= 1 && g.strength <= g.size);
    assert.ok(g.experience >= 0 && g.experience <= 4);
    assert.ok(g.leader.name.includes(' ') && g.leader.home);
    assert.ok(Number.isInteger(g.pos.x));
  }
});

test('Gruppenfuehrer: keine Doppelten pro Seite, Hauptfiguren nie zufaellig, Namen passen zur Fraktion', () => {
  const many = { id: 'viele', sides: {
    a: { faction: 'kaldern', groups: Array.from({ length: 40 }, (_, i) => ({ type: 'rifles', pos: { x: 1, y: i % 12 } })) },
    b: { faction: 'morrow', groups: Array.from({ length: 40 }, (_, i) => ({ type: 'rifles', pos: { x: 22, y: i % 12 } })) },
  } };
  for (let seed = 1; seed < 6; seed++) {
    const s = createInitialState(MAP, many, seed);
    for (const side of ['a', 'b']) {
      const names = groupsOf(s, side).map((g) => g.leader.name);
      assert.equal(new Set(names).size, names.length);
      const pool = NAMES[side === 'a' ? 'kaldern' : 'morrow'];
      for (const n of names) {
        assert.ok(!pool.reserved.includes(n), n);
        assert.ok(pool.first.includes(n.split(' ')[0]), n);
      }
    }
  }
});

test('Morrow-Gruppen sind groesser als Kaldern-Gruppen (Plan 2.2)', () => {
  const sc = { id: 'x', sides: {
    a: { faction: 'kaldern', groups: Array.from({ length: 30 }, () => ({ type: 'rifles', pos: { x: 0, y: 0 } })) },
    b: { faction: 'morrow', groups: Array.from({ length: 30 }, () => ({ type: 'rifles', pos: { x: 0, y: 0 } })) },
  } };
  const s = createInitialState(MAP, sc, 3);
  const avg = (side) => groupsOf(s, side).reduce((t, g) => t + g.strength, 0) / 30;
  assert.ok(avg('b') > avg('a'));
});

test('Szenariofehler werden frueh gemeldet', () => {
  assert.throws(() => createInitialState(MAP, { sides: { a: SCENARIO.sides.a } }, 1));
  const bad = structuredClone(SCENARIO);
  bad.sides.a.groups[0].pos = { x: 99, y: 0 };
  assert.throws(() => createInitialState(MAP, bad, 1), /ausserhalb/);
  const typo = structuredClone(SCENARIO);
  typo.sides.a.groups[0].type = 'kavallerie';
  assert.throws(() => createInitialState(MAP, typo, 1), /Einheitentyp/);
});

test('ID-Vergleich ohne Locale, Feldzustand sortiert', () => {
  assert.deepEqual(['b02', 'a10', 'a02'].sort(compareId), ['a02', 'a10', 'b02']);
  const s = createInitialState(MAP, SCENARIO, 1);
  patchCell(s, 5, 3, { crater: 1 });
  patchCell(s, 2, 1, { trench: 1 });
  patchCell(s, 5, 3, { mud: 2 });
  assert.deepEqual(cellKeys(s), ['2,1', '5,3']);
  assert.deepEqual(getCell(s, 5, 3), { crater: 1, mud: 2 });
  assert.equal(getCell(s, 0, 0), null);
});

test('Konfiguration: Release-1.0-Einheiten befuellt, spaetere vorbereitet', () => {
  const on = Object.values(UNIT_TYPES).filter((u) => u.enabled).map((u) => u.id).sort();
  assert.deepEqual(on, ['medics', 'mg', 'mortar', 'observers', 'pioneers', 'rifles', 'runners']);
  for (const u of Object.values(UNIT_TYPES)) {
    assert.equal(u.enabled, u.release === '1.0', u.id);
    for (const k of ['range', 'shots', 'suppressionPerShot', 'digRate', 'speed']) assert.equal(typeof u[k], 'number', u.id + '.' + k);
    assert.ok(u.size[0] <= u.size[1]);
  }
  assert.ok(FACTIONS.kaldern.artillery.spread < FACTIONS.morrow.artillery.spread);
  assert.ok(FACTIONS.morrow.replacements.speed > FACTIONS.kaldern.replacements.speed);
});

test('Nachnamen sind pro Seite eindeutig, solange die Liste reicht', () => {
  const s = createInitialState(MAP, SCENARIO, 42);
  const sur = groupsOf(s, 'a').map((g) => g.leader.name.split(' ').slice(1).join(' '));
  assert.equal(new Set(sur).size, sur.length);
});
