import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packBackup, readBackup, collectLocal, restoreLocal } from '../js/backup.js';

class Mem {
  constructor(o = {}) { this.m = new Map(Object.entries(o)); }
  get length() { return this.m.size; }
  key(i) { return [...this.m.keys()][i] ?? null; }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
}

test('P27: Sicherung packt nur eigene Eintraege, sortiert und mit Stempel', () => {
  const a = packBackup({ 'lehmfront-endlos': '{"w":3}', fremd: 'x', 'lehmfront-campaign': '{"act":2}' });
  const b = packBackup({ 'lehmfront-campaign': '{"act":2}', 'lehmfront-endlos': '{"w":3}' });
  assert.equal(a, b);
  const r = readBackup(a);
  assert.equal(r.stamp, 'ok');
  assert.equal(r.count, 2);
  assert.ok(r.campaign && r.endless);
  assert.ok(!('fremd' in r.entries));
});

test('P27: veraenderte Sicherung faellt am Stempel auf, fremde Dateien werden abgelehnt', () => {
  const d = JSON.parse(packBackup({ 'lehmfront-campaign': '{"ansehen":50}' }));
  d.entries['lehmfront-campaign'] = '{"ansehen":99}';
  assert.equal(readBackup(JSON.stringify(d)).stamp, 'beschaedigt');
  assert.throws(() => readBackup('{"kind":"lehmfront-save"}'), /keine Sicherung/);
  assert.throws(() => readBackup('kaputt'), /keine Sicherung/);
});

test('P27: Einlesen ersetzt eigene Eintraege, laesst fremde stehen', () => {
  const src = new Mem({ 'lehmfront-campaign': 'A', 'lehmfront.settings': 'S', other: 'o' });
  const text = packBackup(collectLocal(src));
  const dst = new Mem({ 'lehmfront-campaign': 'B', 'lehmfront-endlos': 'alt', other: 'bleibt' });
  restoreLocal(readBackup(text).entries, dst);
  assert.equal(dst.getItem('lehmfront-campaign'), 'A');
  assert.equal(dst.getItem('lehmfront.settings'), 'S');
  assert.equal(dst.getItem('lehmfront-endlos'), null);
  assert.equal(dst.getItem('other'), 'bleibt');
});

test('P27: Anmeldung, Serveradresse und Kartentaschen bleiben aussen vor', () => {
  const src = new Mem({ 'lehmfront.auth': 'token', 'lehmfront.online': '{"url":"https://boese"}', 'lehmfront.save.slot1': 'x', 'lehmfront-campaign-start': 's', 'lehmfront-campaign': 'A' });
  const r = readBackup(packBackup(collectLocal(src)));
  assert.deepEqual(Object.keys(r.entries), ['lehmfront-campaign']);
  // eine praeparierte Datei kann sie auch nicht setzen oder loeschen
  const forged = JSON.stringify({ kind: 'lehmfront-dienstbuch', stamp: '', entries: { 'lehmfront.online': '{"url":"https://boese"}', 'lehmfront.auth': 'fremd' } });
  const dst = new Mem({ 'lehmfront.auth': 'meins', 'lehmfront.save.slot1': 'stand' });
  restoreLocal(readBackup(forged).entries, dst);
  assert.equal(dst.getItem('lehmfront.auth'), 'meins');
  assert.equal(dst.getItem('lehmfront.online'), null);
  assert.equal(dst.getItem('lehmfront.save.slot1'), 'stand');
});

test('P27: scheitert das Einlesen, bleibt der alte Stand', () => {
  const dst = new Mem({ 'lehmfront-campaign': 'alt', 'lehmfront-endlos': 'lauf' });
  dst.setItem = function (k, v) { if (k === 'lehmfront.settings') throw new Error('voll'); this.m.set(k, String(v)); };
  assert.throws(() => restoreLocal({ 'lehmfront-campaign': 'neu', 'lehmfront.settings': 'S' }, dst), /voll/);
  assert.equal(dst.getItem('lehmfront-campaign'), 'alt');
  assert.equal(dst.getItem('lehmfront-endlos'), 'lauf');
  assert.throws(() => readBackup('x'.repeat(5_000_001)), /zu groß/);
});
