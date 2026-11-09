// Erklaerungen fuer Einsteiger (js/config/help.js) und Feldinfo (js/ui/fieldinfo.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UNIT_HELP, TERRAIN_HELP, MAP_BUILDING_HELP, HOW_TO } from '../js/config/help.js';
import { UNIT_TYPES } from '../js/config/units.js';
import { TERRAIN, loadMap } from '../js/map.js';
import { MAP_TYPES } from '../js/etappe-map.js';
import { fieldInfo } from '../js/ui/fieldinfo.js';
import { createInitialState } from '../js/state.js';
import { DRILL2_STEPS, drillUnlocks } from '../js/config/drill.js';
import { toolsForLevel, MAX_LEVEL, CORE_TOOLS } from '../js/unlocks.js';

test('Jede Einheit, jedes Gelände und jedes Kartengebäude ist erklärt', () => {
  for (const id of Object.keys(UNIT_TYPES)) {
    if (UNIT_TYPES[id].available === 'start' || UNIT_TYPES[id].available === 'akt1-m4') assert.ok(UNIT_HELP[id]?.length > 20, id);
  }
  for (const id of Object.keys(TERRAIN)) assert.ok(TERRAIN_HELP[id], id);
  for (const id of Object.keys(MAP_TYPES)) assert.ok(MAP_BUILDING_HELP[id], id);
});

test('Anleitungen: Artillerie, Bauen, Ersatz und Beobachter sind dabei, kurze Schritte', () => {
  const ids = HOW_TO.map((h) => h.id);
  for (const need of ['artillerie', 'bauen', 'ersatz', 'beobachter', 'was-bauen']) assert.ok(ids.includes(need), need);
  for (const h of HOW_TO) for (const s of h.steps) assert.ok(s.length < 220, `${h.id}: ${s}`);
});

test('Feldinfo: Wald, Höhe, Graben mit Feuerrichtung, Gebäude, eroberter Graben', () => {
  const map = loadMap(JSON.parse(readFileSync(new URL('../data/maps/asse.json', import.meta.url))));
  const sc = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url)));
  const state = createInitialState(map, sc, 3);
  const wood = map.cells.find((c) => c.terrain === 'wald');
  const w = fieldInfo(map, state, wood.x, wood.y, 'a');
  assert.match(w.title, /^Feld /);
  assert.equal(w.rows[0].v, 'Wald');
  assert.match(w.rows[0].help, /Sicht/);
  const tr = map.cells.find((c) => c.trench && c.trench.kind === 'fire' && c.trench.side === 'own');
  const t = fieldInfo(map, state, tr.x, tr.y, 'a').rows.find((r) => r.k === 'Graben');
  assert.ok(t && /Geschossen wird nach/.test(t.help));
  const foe = map.cells.find((c) => c.trench && c.trench.side === 'enemy');
  assert.match(fieldInfo(map, state, foe.x, foe.y, 'a').rows.find((r) => r.k === 'Graben').v, /Gegner/);
  const b = map.cells.find((c) => c.building);
  assert.ok(fieldInfo(map, state, b.x, b.y, 'a').rows.find((r) => r.k === 'Gebäude')?.help.length > 10);
  assert.equal(fieldInfo(map, state, -1, 0, 'a'), null);
});

test('Grundausbildung Teil 2: beginnt mit den Befehlen aus Teil 1 und endet mit allen Stufen-Befehlen außer Sturm', () => {
  const first = drillUnlocks(DRILL2_STEPS, 0).tools;
  for (const t of ['move', 'dig', 'fire', 'supply']) assert.ok(first.includes(t), t);
  const all = new Set(drillUnlocks(DRILL2_STEPS, DRILL2_STEPS.length - 1).tools);
  for (const t of ['fireplan', 'etappe', 'relieve']) assert.ok(all.has(t), t);
  for (const t of all) assert.ok(CORE_TOOLS.has(t), t);
  assert.ok(toolsForLevel(MAX_LEVEL).has('assault'));
  assert.ok(DRILL2_STEPS[DRILL2_STEPS.length - 1].final);
  for (const s of DRILL2_STEPS) assert.ok(s.text.length <= 140, `${s.id} (${s.text.length})`);
});
