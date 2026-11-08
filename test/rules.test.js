import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitChance, resolveFire, visibilityFromDarkness } from '../js/rules.js';
import { createRng, rngForTurn } from '../js/rng.js';

const base = { distance: 3, range: 6, visibility: 1, experience: 1, suppressed: 0 };

test('Graben schuetzt besser als offenes Feld', () => {
  assert.ok(hitChance({ ...base, cover: 'trench' }) < hitChance({ ...base, cover: 'open' }));
});

test('Laengsfeuer hebelt Grabendeckung aus', () => {
  assert.ok(hitChance({ ...base, cover: 'trench', enfilade: true }) > hitChance({ ...base, cover: 'trench' }));
});

test('eroberter Graben schuetzt weniger als eigener', () => {
  assert.ok(hitChance({ ...base, cover: 'trench', reversed: true }) > hitChance({ ...base, cover: 'trench' }));
});

test('unbekannte Deckung zaehlt als offen, nie NaN', () => {
  assert.equal(hitChance({ ...base, cover: 'kaputt' }), hitChance({ ...base, cover: 'open' }));
});

test('ausser Reichweite kein Treffer', () => {
  assert.equal(hitChance({ ...base, distance: 7, cover: 'open' }), 0);
});

test('im Unterstand keine Treffer', () => {
  const rng = createRng(1);
  const r = resolveFire(rng, { shots: 12, range: 6, experience: 2, suppressed: 0, suppressionPerShot: 0.01 },
    { cover: 'trench', suppressed: 0, inDugout: true }, { distance: 2, visibility: 1, enfilade: false });
  assert.equal(r.hits, 0);
});

test('gleicher Seed, gleiche Folge', () => {
  const a = createRng(42), b = createRng(42);
  for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('gleicher Seed, gleiches Feuerergebnis', () => {
  const shooter = { shots: 10, range: 6, experience: 1, suppressed: 0, suppressionPerShot: 0.01 };
  const target = { cover: 'open', suppressed: 0 };
  const ctx = { distance: 3, visibility: 1, enfilade: false };
  assert.deepEqual(resolveFire(createRng(7), shooter, target, ctx), resolveFire(createRng(7), shooter, target, ctx));
});

test('Rundenzufall ist pro Runde verschieden und reproduzierbar', () => {
  assert.equal(rngForTurn(42, 3)(), rngForTurn(42, 3)());
  assert.notEqual(rngForTurn(42, 3)(), rngForTurn(42, 4)());
});

test('Sicht: Tag 1, Nacht 0.4', () => {
  assert.equal(visibilityFromDarkness(0), 1);
  assert.ok(Math.abs(visibilityFromDarkness(1) - 0.4) < 1e-9);
});
