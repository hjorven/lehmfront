import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSave, importSave, inspectSave, migrate, createSaveStore, memoryBackend, localStorageBackend, SAVE_VERSION } from '../js/save.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { MAP, SCENARIO } from './fixtures/scenario.js';

const v1 = {
  version: 1,
  seed: 5,
  map: { id: 'test', width: 24, height: 12 },
  round: 4,
  isDay: false,
  turnKind: 'position',
  sides: { a: { faction: 'kaldern', supplies: { ammo: 1, food: 1, material: 1 } }, b: { faction: 'morrow', supplies: { ammo: 1, food: 1, material: 1 } } },
  groups: {
    b01: { side: 'b', type: 'rifles', strength: 9, pos: { x: 20, y: 2 }, leader: { name: 'Arvo Ozols', home: 'Ozvara' } },
    a01: { side: 'a', type: 'rifles', strength: 8, pos: { x: 3, y: 2 }, leader: { name: 'Maren Wessel', home: 'Asseloo' } },
  },
};

test('Migration v1 -> v2', () => {
  const s = migrate(v1);
  assert.equal(s.version, 2);
  assert.equal(s.turn, 4);
  assert.equal(s.night, true);
  assert.equal('round' in s, false);
  assert.equal('isDay' in s, false);
  assert.deepEqual(s.groups.map((g) => g.id), ['a01', 'b01']);
  assert.equal(s.groups[0].holdTurns, 0);
  assert.deepEqual(s.cells, {});
  assert.deepEqual(s.clock, { day: 2, hour: 18, minute: 0 });
  assert.equal(s.sides.a.trust, 50);
  assert.equal(v1.round, 4, 'Eingabe bleibt unveraendert');
  // ein migrierter Stand laeuft durch den Motor
  const r = resolveTurn(s, [], [], 5, 4);
  assert.equal(r.state.turn, 5);
});

test('v1-Stand ohne Umschlag laesst sich importieren', () => {
  const { state, version, stamp } = inspectSave(JSON.stringify(v1));
  assert.equal(version, 1);
  assert.equal(stamp, 'fehlt');
  assert.equal(state.version, SAVE_VERSION);
});

test('Export/Import: Rundreise ist verlustfrei, Stempel stimmt', () => {
  let s = createInitialState(MAP, SCENARIO, 11);
  s = resolveTurn(s, [], [], 11, 1).state;
  const text = exportSave(s, { name: 'Test' });
  assert.equal(typeof text, 'string');
  assert.equal(exportSave(s, { name: 'Test' }), text);
  const r = inspectSave(text);
  assert.deepEqual(r.state, s);
  assert.equal(r.stamp, 'ok');
  assert.deepEqual(r.meta, { name: 'Test' });
  assert.deepEqual(importSave(text), s);
});

test('Veraenderter Stand wird am Stempel erkannt', () => {
  const s = createInitialState(MAP, SCENARIO, 11);
  const data = JSON.parse(exportSave(s));
  data.state.sides.a.supplies.ammo = 9999;
  assert.equal(inspectSave(JSON.stringify(data)).stamp, 'beschaedigt');
});

test('Kaputte, fremde und zu neue Staende werden abgelehnt', () => {
  assert.throws(() => importSave('{kaputt'), /JSON/);
  assert.throws(() => importSave('{"hallo":1}'), /kein Lehmfront/);
  const s = createInitialState(MAP, SCENARIO, 1);
  const future = JSON.parse(exportSave(s));
  future.state.version = SAVE_VERSION + 1;
  assert.throws(() => importSave(JSON.stringify(future)), /neueren Version/);
});

test('Ablage im Speicher und in localStorage', async () => {
  const fakeLs = (() => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k),
      key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
    };
  })();
  fakeLs.setItem('fremd', 'x');
  const s = createInitialState(MAP, SCENARIO, 2);
  for (const be of [memoryBackend(), localStorageBackend(fakeLs)]) {
    const store = createSaveStore(be);
    await store.save('auto', s, { name: 'Auto' });
    await store.save('b', s);
    const loaded = await store.load('auto');
    assert.deepEqual(loaded.state, s);
    assert.equal(loaded.meta.name, 'Auto');
    assert.ok(loaded.meta.savedAt);
    const list = await store.list();
    assert.deepEqual(list.map((e) => e.slot), ['auto', 'b']);
    assert.equal(list[0].turn, 1);
    await store.remove('auto');
    assert.equal(await store.load('auto'), null);
  }
});

test('Ohne Browser-Speicher faellt die Ablage auf RAM zurueck', async () => {
  const store = createSaveStore();
  assert.equal(await store.backendName(), 'memory');
});
