// Tablet und Touch: Einstellung "Ziel antippen".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, DEFAULT_SETTINGS } from '../js/settings.js';

test('Ziel antippen: Vorgabe ist vormerken, unbekannte Werte fallen zurueck', () => {
  assert.equal(DEFAULT_SETTINGS.tap, 'confirm');
  assert.equal(normalizeSettings({ tap: 'direct' }).tap, 'direct');
  assert.equal(normalizeSettings({ tap: 'doppelt' }).tap, 'confirm');
});

test('Kärtchen im Gefecht: aufgeräumt nach Gerät, Handy behält eigenes Layout', async () => {
  const { tidyFor, TIDY_MIN_WIDTH } = await import('../js/ui/tidy.js');
  assert.equal(DEFAULT_SETTINGS.hud, 'auto');
  assert.equal(tidyFor({ setting: 'auto', coarse: true, width: 820 }), true);    // iPad hochkant
  assert.equal(tidyFor({ setting: 'auto', coarse: true, width: 1366 }), true);   // iPad Pro quer
  assert.equal(tidyFor({ setting: 'auto', coarse: false, width: 1280 }), false); // Desktop mit Maus
  assert.equal(tidyFor({ setting: 'tidy', coarse: false, width: 1280 }), true);
  assert.equal(tidyFor({ setting: 'full', coarse: true, width: 1180 }), false);
  assert.equal(tidyFor({ setting: 'tidy', coarse: true, width: TIDY_MIN_WIDTH - 1 }), false);
  assert.equal(normalizeSettings({ hud: 'bunt' }).hud, 'auto');
});
