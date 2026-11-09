// Befehle Schritt fuer Schritt (js/unlocks.js) und Grundausbildung (drillUnlocks)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STAGES, CORE_TOOLS, TOOL_HELP, toolsForLevel, akt1Level, allowedTools, offered, readLevel, raiseLevel, takeNewTools,
  hiddenChecks, orderAllowed, ORDER_TOOL, MAX_LEVEL, FREE_MIN_LEVEL, UNLOCK_KEY,
} from '../js/unlocks.js';
import { DRILL_STEPS, drillUnlocks, DRILL_LEVEL } from '../js/config/drill.js';

const mem = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, m };
};

test('Stufen: jeder Grundbefehl genau einmal, jeder mit Erklärung', () => {
  const all = STAGES.flatMap((s) => s.tools);
  assert.equal(new Set(all).size, all.length);
  for (const id of CORE_TOOLS) assert.ok(TOOL_HELP[id]?.length > 20, id);
  assert.deepEqual([...toolsForLevel(1)].sort(), ['dig', 'hold', 'move']);
  assert.equal(toolsForLevel(MAX_LEVEL).size, CORE_TOOLS.size);
  assert.equal(toolsForLevel(0).size, 0);
});

test('Akt 1: Mission n bringt Stufe n, sonst keine Stufe', () => {
  assert.equal(akt1Level('akt1-m1'), 1);
  assert.equal(akt1Level('akt1-m4'), 4);
  assert.equal(akt1Level('akt1-m6'), MAX_LEVEL);
  assert.equal(akt1Level('akt2-m1'), null);
  assert.equal(akt1Level(undefined), null);
});

test('Erlaubte Befehle je Modus', () => {
  const base = { setting: 'auto', level: 0 };
  assert.equal(allowedTools({ ...base, setting: 'all' }), null, 'Einstellung alle');
  assert.equal(allowedTools({ ...base, demo: true }), null, 'Demo');
  assert.equal(allowedTools({ ...base, online: true }), null, 'Online');
  assert.equal(allowedTools({ ...base, mode: 'tageslage' }), null, 'Tageslage');
  assert.equal(allowedTools({ ...base, mode: 'puzzle' }), null, 'Puzzle');
  assert.equal(allowedTools({ ...base, lage: true }), null, 'eigene Lage');
  assert.equal(allowedTools({ ...base, drill: true }).size, 0, 'Grundausbildung schaltet selbst frei');
  assert.deepEqual([...allowedTools({ ...base, scenId: 'akt1-m1', campaign: true })].sort(), ['dig', 'hold', 'move']);
  assert.equal(allowedTools({ ...base, scenId: 'akt2-m1', campaign: true }), null, 'Akt 2 zeigt alles');
  assert.equal(allowedTools({ ...base, scenId: 'akt3-m1' }), null, 'Akt 3 auch ohne Kampagne');
  assert.equal(allowedTools({ ...base, act: 4, mode: 'frei' }), null);
  assert.deepEqual(allowedTools({ ...base, mode: 'frei' }), toolsForLevel(FREE_MIN_LEVEL), 'Gefecht frei mindestens Stufe 2');
  assert.equal(allowedTools({ ...base, level: MAX_LEVEL, mode: 'frei' }), null, 'alles erreicht');
  assert.deepEqual(allowedTools({ ...base, level: 4, scenId: 'akt1-m2', campaign: true }), toolsForLevel(4), 'erreichte Stufe gilt auch in früheren Missionen');
});

test('offered: gesperrte Grundbefehle weg, Befehle späterer Akte unberührt', () => {
  const a = toolsForLevel(1);
  assert.equal(offered(a, 'move'), true);
  assert.equal(offered(a, 'fireplan'), false);
  assert.equal(offered(a, 'tunnel'), true, 'Stollen kommt über Merkmale, nicht über Stufen');
  assert.equal(offered(null, 'fireplan'), true);
});

test('Prüfpunkte und Lehrling folgen den Stufen', () => {
  const a = toolsForLevel(2);
  assert.deepEqual([...hiddenChecks(a)].sort(), ['abloesung', 'angriff', 'artillerie', 'etappe', 'versorgung']);
  assert.equal(hiddenChecks(null), null);
  assert.equal(orderAllowed(a, 'sector'), true);
  assert.equal(orderAllowed(a, 'fire_plan'), false);
  assert.equal(orderAllowed(a, 'supply_plan'), false);
  assert.equal(orderAllowed(a, 'tunnel'), true);
  for (const tool of Object.values(ORDER_TOOL)) assert.ok(CORE_TOOLS.has(tool), tool);
});

test('Stand: Neue beginnen bei 0, wer schon gespielt hat, bekommt alles; anheben, nie senken', () => {
  const fresh = mem();
  assert.equal(readLevel(fresh), 0);
  assert.equal(fresh.getItem(UNLOCK_KEY), '0', 'einmal festgelegt');
  assert.equal(raiseLevel(3, fresh), 3);
  assert.equal(raiseLevel(1, fresh), 3);
  assert.equal(readLevel(mem({ 'lehmfront-campaign': '{}' })), MAX_LEVEL);
  assert.equal(readLevel(mem({ 'lehmfront.akte.laufend': '{}' })), MAX_LEVEL);
  assert.equal(readLevel({ getItem: () => { throw new Error('x'); } }), MAX_LEVEL, 'ohne Speicher keine Sperren');
});

test('Neue Befehle werden genau einmal vorgestellt', () => {
  const s = mem();
  assert.deepEqual(takeNewTools(toolsForLevel(1), s).sort(), ['dig', 'hold', 'move']);
  assert.deepEqual(takeNewTools(toolsForLevel(1), s), []);
  assert.deepEqual(takeNewTools(toolsForLevel(2), s).sort(), ['dugout', 'fire', 'wire']);
  assert.deepEqual(takeNewTools(null, s), []);
});

test('Grundausbildung: Befehle kommen nacheinander, vor dem ersten Befehl gibt es keinen', () => {
  assert.deepEqual(drillUnlocks(DRILL_STEPS, 0).tools, []);
  const iMove = DRILL_STEPS.findIndex((s) => s.id === 'bewegen');
  assert.deepEqual(drillUnlocks(DRILL_STEPS, iMove - 1).tools, []);
  assert.ok(drillUnlocks(DRILL_STEPS, iMove).tools.includes('move'));
  const last = drillUnlocks(DRILL_STEPS, DRILL_STEPS.length - 1);
  for (const t of last.tools) assert.ok(toolsForLevel(DRILL_LEVEL).has(t), `${t} gehört zur Stufe nach der Ausbildung`);
  assert.ok(last.show.includes('check') && last.show.includes('lehrling'));
  for (const s of DRILL_STEPS) assert.ok(s.text.length <= 130, `kurzer Text: ${s.id} (${s.text.length})`);
});
