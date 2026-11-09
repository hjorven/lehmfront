import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AFTERMATH, campaignAftermath } from '../js/aftermath.js';
import { ENDINGS } from '../js/campaign.js';

test('P27: Titelblatt kennt jeden Ausgang des Feldzugs', () => {
  for (const k of [...ENDINGS, 'vorzeitig_abgeloest', 'vorzeitig_meuterei']) assert.ok(AFTERMATH[k]?.note, k);
  assert.deepEqual(campaignAftermath(JSON.stringify({ ended: 'waffenstillstand', book: { fallen: [{}, {}] } })), { ended: 'waffenstillstand', fallen: 2 });
  assert.equal(campaignAftermath(JSON.stringify({ ended: null })), null);
  assert.equal(campaignAftermath('kaputt'), null);
  assert.equal(campaignAftermath(null), null);
});
