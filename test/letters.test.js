// Feldpost-Erzeugung (P15): js/letters.js mit den echten Vorlagen aus data/letters/templates.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateFieldPost, toneFor, weatherWord, stainsFor, experiencesOf, registerLetterCategory } from '../js/letters.js';
import { rollCasualties } from '../js/narrative/casualties.js';
import { fill, placeholdersIn } from '../js/narrative/texts.js';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const templates = read('data/letters/templates.json').eintraege;
const map = read('data/maps/asse.json');

const groups = {
  a01: { label: '1. Gruppe', leader: 'Wiebke Albers', home: 'Ostmoor' },
  a02: { label: '2. Gruppe', leader: 'Dirk Lohmann', home: 'Wessel' },
  a03: { label: '3. Gruppe', leader: 'Remmer Siebels', home: 'Brookdorp' },
};

function mission({ morale = [70, 30, 50], weather = 'rain', night = false, lost = false } = {}) {
  const rounds = [
    { turn: 2, night: false, log: [
      { type: 'losses', side: 'a', group: 'a02', amount: 3, cause: 'enfilade', at: { x: 48, y: 32 } },
      { type: 'wounded', side: 'a', group: 'a02', count: 1, at: { x: 48, y: 32 } },
      { type: 'warm_meal', side: 'a', section: 'A', at: { x: 29, y: 6 } },
      { type: 'losses', side: 'b', group: 'b01', amount: 5, cause: 'mg', at: { x: 40, y: 10 } },
    ] },
    { turn: 3, night: true, log: lost
      ? [{ type: 'losses', side: 'a', group: 'a03', amount: 2, cause: 'mg', at: { x: 33, y: 20 } }, { type: 'group_lost', side: 'a', group: 'a03', at: { x: 33, y: 20 } }]
      : [] },
  ];
  const state = {
    groups: ['a01', 'a02', 'a03'].map((id, i) => ({ id, side: 'a', morale: morale[i], status: lost && id === 'a03' ? 'lost' : 'front' })),
    clock: { day: 5 },
    weather: { kind: weather },
    night,
  };
  const casualties = rollCasualties(rounds, { side: 'a', faction: 'kaldern', seed: 9, mission: 'a1m2', groups });
  return { rounds, state, casualties };
}

const run = (over = {}, m = mission()) => generateFieldPost({ templates, side: 'a', faction: 'kaldern', groups, map, seed: 9, mission: 'a1m2', trust: 50, ...m, ...over });

test('Tonlage aus Moral und Vertrauen (README Schritt 1)', () => {
  assert.equal(toneFor(60, 50), 'zuversichtlich');
  assert.equal(toneFor(59, 80), 'erschoepft');
  assert.equal(toneFor(80, 49), 'erschoepft');
  assert.equal(toneFor(34, 80), 'verbittert');
  assert.equal(toneFor(90, 29), 'verbittert');
  assert.equal(toneFor(35, 30), 'erschoepft');
});

test('Wetter des Zustands wird zum Wetterwort der Texte, Flecken passen dazu', () => {
  assert.equal(weatherWord('rain'), 'regen');
  assert.equal(weatherWord('clear'), 'trocken');
  assert.equal(weatherWord('mud'), 'schlamm');
  assert.equal(weatherWord('snow'), 'schnee');
  assert.equal(weatherWord('nebel'), 'nebel');
  assert.equal(weatherWord(undefined), 'trocken');
  assert.deepEqual(stainsFor('regen', false), ['wasser']);
  assert.deepEqual(stainsFor('schlamm', true), ['lehm', 'wachs']);
  assert.deepEqual(stainsFor('trocken', false), ['staub']);
  assert.deepEqual(stainsFor('frost', false), ['frost']);
});

test('gleiche Mission, gleiche Briefe; anderer Seed, andere Briefe', () => {
  const a = run();
  const b = run();
  assert.deepEqual(a, b);
  const c = run({ seed: 10 });
  assert.notDeepEqual(a.map((l) => l.text), c.map((l) => l.text));
});

test('alle Platzhalter gefuellt, Anrede vorn, Unterschrift ist der Vorname der schreibenden Person', () => {
  for (let seed = 0; seed < 40; seed++) {
    for (const l of run({ seed, count: 5 })) {
      assert.deepEqual(placeholdersIn(l.text), [], l.text);
      assert.match(l.text, /^Liebe[r]? [^,\n]+,\n\n/);
      const lines = l.text.trim().split('\n');
      assert.equal(lines[lines.length - 1], l.writer.name.split(' ')[0]);
      assert.ok(!/\{|\}/.test(l.text));
    }
  }
});

test('Tonlage folgt der Gruppe: Gruppe mit Moral 30 schreibt verbittert', () => {
  const letters = run({ count: 3 });
  const byGroup = Object.fromEntries(letters.map((l) => [l.group, l.tone]));
  assert.equal(byGroup.a01, 'zuversichtlich');
  assert.equal(byGroup.a02, 'verbittert');
  assert.equal(byGroup.a03, 'erschoepft');
  for (const l of letters) assert.ok(templates.find((t) => t.id === l.templateId).ton === l.tone);
});

test('echtes Ereignis: die Gruppe mit Gefallenen schreibt davon, mit Namen aus der Gefallenenliste', () => {
  const m = mission();
  const letters = run({}, m);
  const l = letters.find((x) => x.group === 'a02');
  assert.equal(l.category, 'verluste');
  const names = m.casualties.fallen.filter((f) => f.group === 'a02').map((f) => f.name);
  assert.ok(names.some((n) => l.text.includes(n)), l.text);
});

test('Pruefstelle schwaerzt militaerische Orte (Huegel 214) und bei verbitterten Briefen jeden Ort', () => {
  let censoredOnce = false;
  for (let seed = 0; seed < 60; seed++) {
    for (const l of run({ seed })) {
      if (l.text.includes('Hügel 214')) {
        assert.ok(l.text.includes('[[am Hügel 214]]'), l.text);
        censoredOnce = true;
      }
      if (l.censored) assert.match(l.text, /\[\[[^\]]+\]\]/);
    }
  }
  assert.ok(censoredOnce, 'in 60 Seeds sollte die Stellung am Hügel 214 mindestens einmal genannt werden');
});

test('aufgeriebene Gruppen schreiben keine Briefe mehr', () => {
  const letters = run({ count: 6 }, mission({ lost: true }));
  assert.ok(letters.length === 6);
  assert.ok(letters.every((l) => l.group !== 'a03'));
});

test('Wetter-Vorlagen nur bei passendem Wetter, Nacht-Vorlage nur nachts', () => {
  for (let seed = 0; seed < 50; seed++) {
    for (const l of run({ seed, count: 4 }, mission({ weather: 'clear' }))) {
      const t = templates.find((x) => x.id === l.templateId);
      if (t.wann?.wetter) assert.ok([].concat(t.wann.wetter).includes('trocken'), t.id);
      assert.ok(!t.wann?.tageszeit, t.id);
      assert.deepEqual(l.stains, ['staub']);
    }
  }
  const night = run({ count: 6, seed: 3 }, mission({ night: true }));
  assert.ok(night.every((l) => l.stains.includes('wachs') && l.night));
});

test('{anzahl} nur ab zwei, sonst ein Satz derselben Kategorie ohne Zahl', () => {
  for (let seed = 0; seed < 50; seed++) {
    for (const l of run({ seed, count: 4 })) {
      const s = templates.find((x) => x.id === l.sentenceId);
      if (placeholdersIn(s.text).includes('anzahl')) assert.ok(!/\beins\b|\b1\b/.test(l.text), l.text);
    }
  }
});

test('ruhige Mission: Rueckfall-Kategorie, trotzdem ein vollstaendiger Brief', () => {
  const quiet = { rounds: [], state: { groups: [{ id: 'a01', side: 'a', morale: 70 }], clock: { day: 1 }, weather: { kind: 'clear' } }, casualties: { fallen: [], wounded: [] } };
  const letters = generateFieldPost({ templates, side: 'a', faction: 'kaldern', groups: { a01: groups.a01 }, map, seed: 1, mission: 'a1m1', count: 2, ...quiet });
  assert.equal(letters.length, 2);
  assert.ok(letters.every((l) => l.category === 'ruhig'));
  assert.notEqual(letters[0].text, letters[1].text);
});

test('Morrow-Feldpost nutzt nur Anreden ohne oder mit eigener Fraktion', () => {
  const morrowGroups = { b01: { label: '1. Rotte', leader: 'Arvo Ozols', home: 'Ravelsk' } };
  const letters = generateFieldPost({ templates, side: 'b', faction: 'morrow', groups: morrowGroups, map, seed: 4, mission: 'a1m1', count: 8, rounds: [], casualties: { fallen: [], wounded: [] } });
  const kalderisch = templates.filter((t) => t.art === 'anrede' && t.fraktion === 'kaldern').map((t) => t.text);
  for (const l of letters) assert.ok(!kalderisch.some((a) => l.text.startsWith(a + ',')), l.text);
});

test('neue Ereignisarten melden sich mit registerLetterCategory an', () => {
  registerLetterCategory('test_gas_alarm', 'nacht');
  const rounds = [{ turn: 1, night: false, log: [{ type: 'test_gas_alarm', side: 'a', group: 'a01', at: { x: 33, y: 10 } }] }];
  const exp = experiencesOf('a01', { rounds, side: 'a', weather: 'trocken' });
  assert.ok(exp.has('nacht'));
});

test('jede Vorlage und jeder Ereignissatz laesst sich vollstaendig fuellen', () => {
  const values = {
    anrede: 'Liebe Maren', empfaenger: 'Maren', absender: 'Hinrich', gruppenfuehrer: 'Wiebke Albers', gruppenfuehrer_nachname: 'Albers',
    gruppe: '2. Gruppe', heimatort: 'Wessel', ereignis: 'Es war ruhig.', ort: 'an der Velder Mühle', anzahl: 'drei',
    gefallener: 'Tjark Boysen', kamerad: 'Geske Onken', kamerad_nachname: 'Onken', wetter: 'der Regen', jahreszeit: 'der Herbst',
    tag: '14', abschnitt: 'Asse-Nord',
  };
  for (const t of templates.filter((x) => x.art === 'feldpost' || x.art === 'ereignis')) {
    assert.deepEqual(placeholdersIn(fill(t.text, values)), [], t.id);
  }
});
