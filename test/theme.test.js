import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boostContrast, themeAt, contrast } from '../js/theme.js';

test('Hoher Kontrast (P21): Kartensignaturen rücken vom Papier weg, Tag, Dämmerung und Nacht', () => {
  for (const d of [0, 0.5, 0.55, 1]) {
    const t = themeAt(d), b = boostContrast(t);
    assert.equal(b.paper, t.paper, 'Papier bleibt');
    for (const k of ['ink', 'wire', 'contour', 'forestLine', 'own', 'enemy', 'marsh', 'village']) {
      assert.ok(contrast(b[k], b.paper) >= contrast(t[k], t.paper), `${k} bei ${d}`);
    }
    assert.ok(b.foldAlpha < t.foldAlpha);
  }
});
