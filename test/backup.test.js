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
