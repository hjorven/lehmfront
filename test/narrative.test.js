// Erzaehlung (P15): Textauswahl, Gefallenenliste, Statistik, Ablauf zwischen den Missionen, Blaetter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { indexTexts, matches, pickSlot, resolveEntries, fill, numberWord, nextMission, actOf, MISSIONS } from '../js/narrative/texts.js';
import { rollCasualties, makeSoldierName, fixedDeathsAfter, groupInfoFrom } from '../js/narrative/casualties.js';
import { missionStats } from '../js/narrative/stats.js';
import { placePhrase } from '../js/narrative/places.js';
import { buildInterlude, buildPrologue, applyChoice, followUpSteps, recordInterlude, createCampaign, tailSteps } from '../js/narrative/interlude.js';
import { splitLetter, orderSheet, consequenceText, actSheet, findSheet } from '../js/narrative/sheets.js';
import { createRng } from '../js/rng.js';
import { TEXT_FILES } from '../js/ui/narrative/load.js';

const read = (p) => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const index = indexTexts(TEXT_FILES.map((f) => read('data/' + f)));
const map = read('data/maps/asse.json');

const groups = {
  a01: { label: '1. Gruppe', leader: 'Wiebke Albers', home: 'Ostmoor' },
  a02: { label: '2. Gruppe', leader: 'Dirk Lohmann', home: 'Wessel' },
  a03: { label: 'MG-Trupp', leader: 'Arend Janssen', home: 'Kelling' },
};
const rounds = [
  { turn: 2, night: false, kind: 'position', log: [
    { type: 'losses', side: 'a', group: 'a02', amount: 3, cause: 'enfilade', at: { x: 33, y: 14 } },
    { type: 'wounded', side: 'a', group: 'a02', count: 1 },
    { type: 'supply_delivered', side: 'a', wounded: 2 },
    { type: 'depot_empty', side: 'a' },
  ] },
  { turn: 3, night: true, kind: 'battle', log: [
    { type: 'losses', side: 'a', group: 'a03', amount: 2, cause: 'mg', at: { x: 34, y: 30 } },
    { type: 'group_lost', side: 'a', group: 'a03', at: { x: 34, y: 30 } },
    { type: 'wounded_waiting', side: 'a', waiting: 2, died: 1, at: { x: 30, y: 15 } },
    { type: 'losses', side: 'b', group: 'b01', amount: 4, cause: 'fire' },
  ] },
];
const finalState = {
  groups: [{ id: 'a01', side: 'a', morale: 70 }, { id: 'a02', side: 'a', morale: 30 }, { id: 'a03', side: 'a', morale: 0, status: 'lost' }],
  clock: { day: 3 }, weather: { kind: 'rain' }, night: false,
};

test('alle Textdateien werden geladen (Liste in js/ui/narrative/load.js)', () => {
  const onDisk = [];
  for (const d of ['texts', 'letters']) for (const f of readdirSync(new URL(`../data/${d}/`, import.meta.url))) if (f.endsWith('.json') && f !== 'placeholders.json') onDisk.push(`${d}/${f}`);
  assert.deepEqual([...TEXT_FILES].sort(), onDisk.sort());
});

test('Bedingungen: ausgang, Bereiche, flags/ohne, werte, oder; Unbekanntes gilt nicht', () => {
  const ctx = { outcome: 'sieg', ansehen: 40, vertrauen: 70, flags: ['a'], werte: { gefallene: 3 }, wetter: 'regen', tageszeit: 'nacht', fraktion: 'kaldern' };
  assert.ok(matches(null, ctx));
  assert.ok(matches({ ausgang: ['sieg', 'niederlage'] }, ctx));
  assert.ok(!matches({ ausgang: 'niederlage' }, ctx));
  assert.ok(matches({ ansehen: { min: 40, max: 40 } }, ctx));
  assert.ok(!matches({ vertrauen: { max: 69 } }, ctx));
  assert.ok(matches({ flags: ['a'], ohne: ['b'] }, ctx));
  assert.ok(!matches({ ohne: ['a'] }, ctx));
  assert.ok(matches({ werte: { gefallene: { min: 3 } } }, ctx));
  assert.ok(!matches({ werte: { verwundete: { min: 0 } } }, ctx), 'fehlende Statistik gilt nicht');
  assert.ok(matches({ oder: [{ wetter: 'frost' }, { tageszeit: 'nacht' }] }, ctx));
  assert.ok(!matches({ unbekannt: 1 }, ctx));
});

test('Slots: erste gueltige Variante, sonst Rueckfall', () => {
  assert.equal(pickSlot(index, 'a1m1.tagebuch', { outcome: 'niederlage' }).id, 'a1m1.tagebuch.niederlage');
  assert.equal(pickSlot(index, 'a1m1.tagebuch', { outcome: 'sieg', werte: { gefallene: 5 } }).id, 'a1m1.tagebuch.verluste');
  assert.equal(pickSlot(index, 'a1m1.tagebuch', { outcome: 'sieg', werte: { gefallene: 0 } }).id, 'a1m1.tagebuch');
  const briefs = resolveEntries(index, (e) => e.art === 'brief' && e.nach === 'a1m1', {});
  assert.ok(briefs.length >= 1);
});

test('Zahlen als Wort, Platzhalter fuellen', () => {
  assert.equal(numberWord(1), '1');
  assert.equal(numberWord(2), 'zwei');
  assert.equal(numberWord(12), 'zwölf');
  assert.equal(numberWord(13), '13');
  assert.equal(fill('{a} und {b}', { a: 'x' }), 'x und {b}');
  assert.equal(nextMission('a1m6'), 'a2m1');
  assert.equal(nextMission('a4m6'), null);
  assert.equal(actOf('a3m2'), 3);
  assert.equal(MISSIONS.length, 24);
});

test('Gefallenenliste: Verluste minus Verwundete, Gruppenfuehrer der aufgeriebenen Gruppe, Tod beim Warten', () => {
  const c = rollCasualties(rounds, { side: 'a', faction: 'kaldern', seed: 5, mission: 'a1m1', groups });
  assert.equal(c.wounded.length, 1);
  // a02: 3 - 1 = 2, a03: 2 (letzter ist Janssen), wounded_waiting: 1
  assert.equal(c.fallen.length, 5);
  assert.equal(c.fallen.filter((f) => f.group === 'a02').length, 2);
  const mg = c.fallen.filter((f) => f.group === 'a03');
  assert.equal(mg.length, 2);
  assert.equal(mg[1].name, 'Arend Janssen');
  assert.ok(mg[1].leader);
  assert.equal(c.fallen.find((f) => f.cause === 'wounds').causeText, 'Verwundung, keine Lore');
  assert.equal(new Set([...c.fallen, ...c.wounded].map((f) => f.name)).size, 6, 'Namen eindeutig');
  assert.deepEqual(c, rollCasualties(rounds, { side: 'a', faction: 'kaldern', seed: 5, mission: 'a1m1', groups }));
  assert.equal(c.fallen.filter((f) => f.group === 'a02')[0].causeText, 'Längsfeuer');
});

test('Zufallsnamen meiden Hauptfiguren und Familien der Geschichte', () => {
  const used = new Set();
  const rng = createRng(1);
  for (let i = 0; i < 200; i++) {
    const { name } = makeSoldierName(rng, 'kaldern', used);
    assert.ok(!/\b(Brandt|Harms|Vell|Boysen|Ubben|Tiedemann|Fedders|Albers|Lohmann|Vos|Ebens)$/.test(name), name);
  }
  assert.equal(used.size, 200);
  // Nachnamen der Gruppenfuehrer gesperrt, Morrow ohne Frauennamen (names.json women:false)
  const c = rollCasualties(rounds, { side: 'a', faction: 'kaldern', seed: 5, mission: 'a1m1', groups: { a01: { label: '1. Gruppe', leader: 'Gerd Siebels' }, ...groups } });
  assert.ok(c.fallen.every((f) => f.leader || !f.name.endsWith(' Siebels')));
  const names = read('data/names.json');
  const morrowUsed = new Set();
  for (let i = 0; i < 100; i++) {
    const { name } = makeSoldierName(rng, 'morrow', morrowUsed);
    assert.ok(!(names.morrow.firstWomen ?? []).includes(name.split(' ')[0]), name);
    assert.ok(!name.endsWith(' Dravin'), name);
  }
});

test('Wahl schaltet Briefing der naechsten Mission um (a2m5 vell_angriff), Neuaufloesung nach der Wahl', () => {
  let campaign = createCampaign({ flags: ['harms_gefallen'] });
  const built = buildInterlude(index, { campaign, mission: 'a2m4', outcome: 'sieg', rounds: [], groups, seed: 2 });
  const dec = built.steps.find((s) => s.kind === 'decision' && s.entry === 'a2m5.entscheidung');
  assert.ok(dec && dec.tail);
  assert.ok(built.steps.some((s) => s.entry === 'a2m5.briefing'));
  campaign = applyChoice(campaign, index, 'a2m5.entscheidung', 'gehen');
  const tail = tailSteps(index, campaign, built);
  assert.ok(tail.every((s) => s.tail));
  assert.ok(!tail.some((s) => s.entry === 'a2m5.entscheidung'), 'gewaehlte Entscheidung kommt nicht wieder');
  assert.ok(tail.some((s) => s.entry === 'a2m5.briefing.angriff'));
  assert.ok(!tail.some((s) => s.entry === 'a2m5.briefing'));
});

test('nach a4m6 keine Briefe und keine Feldpost (Schlusssequenz P26)', () => {
  const built = buildInterlude(index, { campaign: createCampaign({ flags: ['ende_waffenstillstand'] }), mission: 'a4m6', outcome: 'sieg', rounds, groups, finalState, seed: 2 });
  assert.equal(built.next, null);
  assert.ok(!built.steps.some((s) => s.kind === 'letter' || s.kind === 'fieldpost' || s.kind === 'lask'));
});

test('feste Tote nach a2m2, Gruppen-Steckbriefe aus dem Zustand', () => {
  assert.deepEqual(fixedDeathsAfter('a2m2').map((d) => d.name), ['Tjark Boysen', 'Folkert Ubben']);
  assert.deepEqual(fixedDeathsAfter('a2m3'), []);
  const info = groupInfoFrom({ groups: [{ id: 'a02', side: 'a', leader: { name: 'X Y', home: 'Z' } }, { id: 'a01', side: 'a', leader: { name: 'A B', home: 'C' } }, { id: 'b01', side: 'b' }] }, 'a');
  assert.deepEqual(Object.keys(info).sort(), ['a01', 'a02']);
  assert.equal(info.a02.label, '2. Gruppe');
});

test('Statistiken der Mission aus dem Protokoll', () => {
  const casualties = rollCasualties(rounds, { side: 'a', seed: 5, mission: 'a1m1', groups });
  const s = missionStats({ rounds, side: 'a', casualties, finalState });
  assert.equal(s.gefallene, 5);
  assert.equal(s.verwundete, 1);
  assert.equal(s.verwundete_geborgen, 2);
  assert.equal(s.verwundete_liegen, 3);
  assert.equal(s.depot_leer, 1);
  assert.equal(s.runden, 1);
  assert.equal(s.moral, 50);
});

test('Ortsangaben: naechster benannter Ort, militaerische Orte als heikel, sonst die Zone', () => {
  const h = placePhrase(map, { x: 48, y: 32 });
  assert.equal(h.text, 'am Hügel 214');
  assert.ok(h.sensitive);
  const k = placePhrase(map, { x: 6, y: 11 });
  assert.equal(k.text, 'bei der Feldküche');
  assert.ok(!k.sensitive);
  const z = placePhrase(map, { x: 38, y: 5 });
  assert.equal(z.text, 'draußen auf der Weide');
  assert.equal(placePhrase(map, null).text, 'hier vorn');
});

test('Ablauf nach a1m1: Liste, Tagebuch, Brief, Feldpost, Entscheidung, dann Lage und Befehl von a1m2', () => {
  const c = createCampaign();
  const b = buildInterlude(index, { campaign: c, mission: 'a1m1', outcome: 'sieg', rounds, finalState, map, seed: 3, groups });
  const kinds = b.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['casualties', 'diary', 'letter', 'fieldpost', 'fieldpost', 'fieldpost', 'decision', 'briefing', 'order']);
  assert.equal(b.next, 'a1m2');
  assert.equal(b.steps[0].sheet.entries.length, 5);
  assert.equal(b.steps[1].entry, 'a1m1.tagebuch.verluste', 'fuenf Gefallene: Variante "verluste"');
  assert.equal(b.steps[7].entry, 'a1m2.briefing');
  assert.deepEqual(b.book.diary, ['a1m1.tagebuch.verluste']);
  // Die Feldpost traegt die Flecken des Regens
  assert.ok(b.steps.filter((s) => s.kind === 'fieldpost').every((s) => s.sheet.stains.includes('wasser')));
  assert.deepEqual(b.steps[2].sheet.stains, ['wasser']);
});

test('Niederlage waehlt die Niederlage-Variante', () => {
  const b = buildInterlude(index, { campaign: createCampaign(), mission: 'a1m1', outcome: 'niederlage', rounds: [], finalState, seed: 1, groups });
  assert.equal(b.steps.find((s) => s.kind === 'diary').entry, 'a1m1.tagebuch.niederlage');
});

test('Aktwechsel nach a1m6: vier Zeitungen und Aktkarte vor der Lage von a2m1', () => {
  const b = buildInterlude(index, { campaign: createCampaign(), mission: 'a1m6', outcome: 'sieg', rounds, finalState, seed: 3, groups });
  const kinds = b.steps.map((s) => s.kind);
  const i = kinds.indexOf('newspaper');
  assert.deepEqual(kinds.slice(i), ['newspaper', 'newspaper', 'newspaper', 'newspaper', 'actcard', 'briefing', 'order']);
  assert.equal(b.steps[i + 4].sheet.act, 'Akt II');
  assert.ok(b.steps.slice(i, i + 4).every((s) => s.sheet.kind === 'newspaper' && s.entry.startsWith('zeitung.a1-a2')));
});

test('Prolog: Zeitungen vor dem Feldzug, Aktkarte I, Lage und Befehl von a1m1', () => {
  const p = buildPrologue(index, createCampaign());
  assert.deepEqual(p.steps.map((s) => s.kind), ['newspaper', 'newspaper', 'newspaper', 'newspaper', 'actcard', 'briefing', 'order']);
  assert.equal(p.steps[4].sheet.title, 'Erstarrung');
});

test('a2m2: Boysen und Ubben stehen auf der Liste, Harms nach seinem Tod einmal', () => {
  const c = createCampaign({ flags: ['harms_gefallen'] });
  const b = buildInterlude(index, { campaign: c, mission: 'a2m2', outcome: 'sieg', rounds: [], finalState, seed: 1, groups });
  const names = b.steps[0].sheet.entries.map((e) => e.name);
  assert.ok(names.includes('Tjark Boysen') && names.includes('Folkert Ubben') && names.includes('Otto Harms'));
  const c2 = recordInterlude(c, b);
  const again = buildInterlude(index, { campaign: c2, mission: 'a2m3', outcome: 'sieg', rounds: [], finalState, seed: 1, groups });
  assert.ok(!again.steps[0].sheet.entries.some((e) => e.name === 'Otto Harms'));
});

test('Entscheidung: Folgen begrenzt auf 0 bis 100, Flags gesetzt, Wahl gemerkt', () => {
  const c = createCampaign({ ansehen: 98, vertrauen: 2 });
  const d = index.byId.get('a1m2.entscheidung');
  const opt = d.optionen[0];
  const after = applyChoice(c, index, d.id, opt.id);
  assert.equal(after.ansehen, Math.min(100, 98 + (opt.folgen.ansehen ?? 0)));
  assert.equal(after.vertrauen, Math.max(0, 2 + (opt.folgen.vertrauen ?? 0)));
  for (const f of opt.setzt ?? []) assert.ok(after.flags.includes(f));
  assert.equal(after.book.decisions[d.id], opt.id);
  assert.equal(c.ansehen, 98, 'Eingabe bleibt unveraendert');
  assert.throws(() => applyChoice(c, index, d.id, 'gibtsnicht'));
});

test('Optionen mit wann: Harms-Option nur, wenn Harms lebt', () => {
  const alive = buildInterlude(index, { campaign: createCampaign(), mission: 'a4m3', outcome: 'sieg', rounds: [], finalState, seed: 1, groups });
  const dead = buildInterlude(index, { campaign: createCampaign({ flags: ['harms_gefallen'] }), mission: 'a4m3', outcome: 'sieg', rounds: [], finalState, seed: 1, groups });
  const opts = (b) => b.steps.find((s) => s.kind === 'decision' && s.entry === 'a4m4.entscheidung')?.sheet.options.map((o) => o.id) ?? [];
  assert.ok(opts(alive).includes('harms'));
  assert.ok(!opts(dead).includes('harms'));
});

test('Tagebuch direkt nach einer Entscheidung (a4m5) folgt der Wahl', () => {
  const b = buildInterlude(index, { campaign: createCampaign(), mission: 'a4m5', outcome: 'sieg', rounds: [], finalState, seed: 1, groups });
  assert.ok(!b.steps.some((s) => s.entry === 'a4m5.treffen'), 'nicht mit dem uebrigen Tagebuch');
  const dec = index.byId.get('a4m5.entscheidung');
  const opt = dec.optionen.find((o) => (o.setzt ?? []).includes('lask_treffen'));
  const c = applyChoice(createCampaign(), index, dec.id, opt.id);
  assert.deepEqual(followUpSteps(index, c, b, dec.id).map((s) => s.entry), ['a4m5.treffen']);
});

test('Fundstuecke: Stueck als Foto mit Notiz, Abschluss der Kette erst mit dem vierten', () => {
  const chain = index.list.filter((e) => e.art === 'fundstueck' && e.kette === 'heuwagen').map((e) => e.id);
  const c = createCampaign({ book: { fallen: [], diary: [], letters: [], finds: chain.slice(0, 2), decisions: {} } });
  const b1 = buildInterlude(index, { campaign: c, mission: 'a1m2', outcome: 'sieg', rounds: [], finalState, seed: 1, groups, finds: [chain[2]] });
  assert.deepEqual(b1.steps.filter((s) => s.kind.startsWith('find')).map((s) => s.kind), ['find', 'findnote']);
  const c2 = recordInterlude(c, b1);
  const b2 = buildInterlude(index, { campaign: c2, mission: 'a1m3', outcome: 'sieg', rounds: [], finalState, seed: 1, groups, finds: [chain[3], chain[0]] });
  assert.deepEqual(b2.steps.filter((s) => s.kind.startsWith('find')).map((s) => s.kind), ['find', 'findnote', 'findchain']);
});

test('Buch des Abschnitts waechst ohne doppelte Namen und Briefe', () => {
  let c = createCampaign();
  const b = buildInterlude(index, { campaign: c, mission: 'a1m1', outcome: 'sieg', rounds, finalState, seed: 3, groups });
  c = recordInterlude(c, b);
  c = recordInterlude(c, b);
  assert.equal(c.book.fallen.length, 5);
  assert.equal(c.book.letters.length, 4);
  assert.equal(c.outcomes.a1m1, 'sieg');
  assert.ok(c.book.fallen.every((f) => f.mission === 'a1m1'));
});

const KNOWN_KINDS = new Set(['letter', 'telegram', 'diary', 'casualties', 'newspaper', 'photo', 'actcard', 'briefing', 'decision']);

test('jede Mission der Kampagne baut ihren Ablauf: bekannte Blattarten, keine offenen Platzhalter', () => {
  let c = createCampaign();
  for (const m of MISSIONS) {
    const b = buildInterlude(index, { campaign: c, mission: m, outcome: 'sieg', rounds, finalState, map, seed: 11, groups });
    const ids = new Set();
    for (const s of b.steps) {
      assert.ok(KNOWN_KINDS.has(s.sheet.kind), `${m}: ${s.sheet.kind}`);
      assert.ok(s.sheet.id && !ids.has(s.sheet.id), `${m}: doppelte Blatt-ID ${s.sheet.id}`);
      ids.add(s.sheet.id);
      const json = JSON.stringify(s.sheet);
      assert.ok(!/\{[a-z_]+\}/.test(json), `${m} ${s.id}: offener Platzhalter`);
    }
    // Nach a4m6 folgt die Schlusssequenz (P26) statt des Tagebuchs
    if (m !== 'a4m6') assert.ok(b.steps.some((s) => s.kind === 'diary'), `${m}: Tagebuch fehlt`);
    if (b.next) assert.ok(b.steps.some((s) => s.kind === 'briefing'), `${m}: Lage der naechsten Mission fehlt`);
    for (const s of b.steps.filter((x) => x.kind === 'decision')) {
      c = applyChoice(c, index, s.entry, s.sheet.options[s.sheet.options.length - 1].id);
    }
    c = recordInterlude(c, b);
  }
  assert.equal(Object.keys(c.outcomes).length, 24);
});

test('Blaetter: Brief zerlegt, Stabsbefehl Zeile fuer Zeile mit STOP, Folgen lesbar', () => {
  const p = splitLetter('Liebe Maren,\n\nerster Absatz.\n\nzweiter Absatz.\n\nDein Hinrich');
  assert.equal(p.salutation, 'Liebe Maren,');
  assert.deepEqual(p.body, ['erster Absatz.', 'zweiter Absatz.']);
  assert.equal(p.signature, 'Dein Hinrich');
  const q = splitLetter('Text.\n\nMit Gruß\nMira Selin');
  assert.equal(q.closing, 'Mit Gruß');
  assert.equal(q.signature, 'Mira Selin');
  const o = orderSheet(index.byId.get('a1m1.befehl'));
  assert.ok(o.lines.length >= 2 && o.lines.every((l) => l.endsWith(' STOP')));
  assert.ok(o.urgent);
  assert.equal(consequenceText({ ansehen: 6, vertrauen: -4 }), 'Ansehen +6, Vertrauen −4');
  assert.equal(consequenceText({}), 'keine');
  assert.equal(actSheet(index.byId.get('a3.titel')).title, 'Materialschlacht');
  assert.equal(findSheet(index.byId.get('fund.heuwagen.1')).motif, 'karte');
});
