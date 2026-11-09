// P18: Spielstand-Slots, Einstellungen, Offline-Liste, Kontrast
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createSaveStore, memoryBackend, SAVE_VERSION } from '../js/save.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { createArchive, archiveRound } from '../js/archive.js';
import { saveQuery, sketchOf, slotTitle, packGame, unpackGame, freeSlot, exportName, HAND_SLOTS } from '../js/savegame.js';
import { normalizeSettings, DEFAULT_SETTINGS, SETTING_CHOICES } from '../js/settings.js';
import { DAY, NIGHT, contrast } from '../js/theme.js';
import { precacheFiles, renderBlock, listVersion } from '../tools/precache.mjs';
import { MAP, SCENARIO } from './fixtures/scenario.js';

test('saveQuery: Ansichtsparameter fallen weg, Reihenfolge fest', () => {
  assert.equal(saveQuery('scene=gefecht&x=3&seed=5&karte=asse&slot=auto&demo=film'), 'karte=asse&scene=gefecht&seed=5');
  assert.equal(saveQuery('seed=5&scene=gefecht'), saveQuery('scene=gefecht&seed=5'));
  assert.equal(saveQuery(''), 'scene=gefecht');
});

test('Skizze: Graeben je Seite, nur eigene Gruppen', () => {
  const map = { width: 4, height: 2, cells: [
    { x: 0, y: 0, trench: {}, side: 'own' }, { x: 3, y: 1, trench: {}, side: 'enemy' }, { x: 1, y: 0, trench: null, side: 'own' },
  ] };
  const state = { groups: [
    { id: 'a1', side: 'a', status: 'front', pos: { x: 1, y: 1 } },
    { id: 'b1', side: 'b', status: 'front', pos: { x: 2, y: 1 } },
    { id: 'a2', side: 'a', status: 'lost', pos: { x: 0, y: 1 } },
  ] };
  assert.deepEqual(sketchOf(map, state, 'a'), { w: 4, h: 2, a: [0], b: [7], g: [5], side: 'a' });
  assert.deepEqual(sketchOf(map, state, 'b').g, [6]);
});

test('Beschriftung der Kartentasche', () => {
  assert.equal(slotTitle({ clock: { day: 2, hour: 18 }, weather: { kind: 'rain' } }), 'Tag 2, 18 Uhr, Regen');
  assert.equal(slotTitle({}), '');
  assert.equal(exportName('tasche-1', { clock: { day: 3 }, turn: 7 }), 'lehmfront-tasche-1-tag3-runde7.json');
});

test('Packen und Entpacken: Archiv, KI-Gedaechtnis und Zaehler kommen zurueck', async () => {
  const s0 = createInitialState(MAP, SCENARIO, 9);
  const r = resolveTurn(s0, [], [], 9, 1);
  const archive = archiveRound(createArchive('test'), { state: s0, ordersA: [], ordersB: [], seed: 9, turn: 1 }, r);
  const store = createSaveStore(memoryBackend());
  const { state, meta } = packGame({ state: r.state, map: { ...MAP, cells: [] }, query: 'scene=gefecht&seed=9', archive, aiMemory: { seen: 3 }, lastLog: r.log, rules: { tally: { positionRounds: 1 } }, side: 'a' });
  await store.save('auto', state, meta);
  const back = unpackGame(await store.load('auto'));
  assert.deepEqual(back.state, r.state);
  assert.equal(back.query, 'scene=gefecht&seed=9');
  assert.equal(back.archive.rounds.length, 1);
  assert.deepEqual(back.archive.rounds[0].start, s0);
  assert.deepEqual(back.aiMemory, { seen: 3 });
  assert.deepEqual(back.lastLog, r.log);
  assert.deepEqual(back.rules, { tally: { positionRounds: 1 } });
  assert.equal(back.archiveDropped, false);
  // Weiterrechnen aus dem geladenen Stand ergibt dasselbe wie ohne Speichern
  const a = resolveTurn(r.state, [], [], 9, 2);
  const b = resolveTurn(back.state, [], [], 9, 2);
  assert.deepEqual(b.state, a.state);
});

test('Aelterer Stand: Archiv faellt weg, Spiel bleibt', () => {
  const out = unpackGame({ state: { turn: 1 }, version: SAVE_VERSION - 1, meta: { game: { archive: { rounds: [] }, side: 'b' } } });
  assert.equal(out.archive, null);
  assert.equal(out.archiveDropped, true);
  assert.equal(out.side, 'b');
  assert.equal(unpackGame({ state: {}, version: SAVE_VERSION, meta: {} }).query, 'scene=gefecht');
});

test('freier Handslot', () => {
  assert.equal(freeSlot([]), HAND_SLOTS[0]);
  assert.equal(freeSlot([{ slot: 'auto' }, { slot: 'tasche-1' }]), 'tasche-2');
  assert.equal(freeSlot(HAND_SLOTS.map((slot) => ({ slot }))), null);
  assert.equal(freeSlot([{ slot: 'tasche-1', error: 'kaputt' }]), 'tasche-1');
});

test('Einstellungen: unbekannte Werte fallen auf Vorgaben', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(normalizeSettings({ speed: 7, text: 1.3, signs: 'ja', motion: 'reduce', boese: 1 }), { ...DEFAULT_SETTINGS, text: 1.3, motion: 'reduce' });
  for (const [k, v] of Object.entries(SETTING_CHOICES)) assert.equal(DEFAULT_SETTINGS[k], v[0]);
  assert.equal(DEFAULT_SETTINGS.speed, 1);
});

test('Kontrast Tag und Nacht (WCAG): Text 4,5 : 1, Markierungen 3 : 1', () => {
  for (const [name, T] of [['Tag', DAY], ['Nacht', NIGHT]]) {
    for (const bg of ['paper', 'card']) {
      for (const k of ['ink', 'ink2', 'own', 'enemy', 'danger']) assert.ok(contrast(T[k], T[bg]) >= 4.5, `${name} ${k} auf ${bg}: ${contrast(T[k], T[bg]).toFixed(2)}`);
      assert.ok(contrast(T.accent, T[bg]) >= 3, `${name} accent auf ${bg}: ${contrast(T.accent, T[bg]).toFixed(2)}`);
    }
  }
});

test('Offline: Dateiliste in sw.js ist aktuell (sonst node tools/precache.mjs)', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const files = precacheFiles();
  assert.ok(sw.includes(renderBlock(files)), 'sw.js: Dateiliste veraltet, bitte `node tools/precache.mjs` ausfuehren');
  assert.match(sw, new RegExp(`VERSION = '${listVersion(files)}'`));
  for (const f of files) {
    assert.ok(!f.startsWith('/') && !f.includes('..'), 'relativer Pfad: ' + f);
    assert.ok(existsSync(new URL('../' + f, import.meta.url)), 'fehlt: ' + f);
  }
  for (const must of ['index.html', 'manifest.webmanifest', 'js/main.js', 'js/scenes/gefecht.js', 'css/style.css']) assert.ok(files.includes(must), must);
});

test('Manifest: relativ, installierbar', () => {
  const m = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  assert.equal(m.display, 'standalone');
  assert.ok(m.icons.some((i) => i.sizes === '192x192') && m.icons.some((i) => i.sizes === '512x512'));
  for (const i of m.icons) {
    assert.ok(!i.src.startsWith('/'), i.src);
    assert.ok(existsSync(new URL('../' + i.src, import.meta.url)), i.src);
  }
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<link rel="manifest" href="manifest.webmanifest">/);
  assert.doesNotMatch(html, /(href|src)="\//);
});
