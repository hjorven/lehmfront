// Tablet und Touch: Einstellung "Ziel antippen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS } from '../js/settings.js';

test('Ziel antippen: Vorgabe ist vormerken, unbekannte Werte fallen zurueck', () => {
  assert.equal(DEFAULT_SETTINGS.tap, 'confirm');
  assert.equal(normalizeSettings({ tap: 'direct' }).tap, 'direct');
  assert.equal(normalizeSettings({ tap: 'doppelt' }).tap, 'confirm');
});
