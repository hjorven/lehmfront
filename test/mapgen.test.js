// Kartengenerator und Spielmodi (P17): Spiegelbarkeit, Erreichbarkeit, Spielbarkeit, Namen, Tageslage, Wertung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap, findPath, enterCost } from '../js/map.js';
import { buildMap, generateMap, randomSpec, mirrorCell } from '../js/mapgen.js';
import { BATTLE_MAPS } from '../js/config/battlemaps.js';
import { createNamer } from '../js/placenames.js';
import { createRng } from '../js/rng.js';
import { createInitialState } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { runMatch } from '../js/ai/match.js';
import {
  skirmishScenario, mapJsonFor, adaptFixedScenario, dailySeed, dailyBrief, dayKey, emptyTally, tallyLog, finalReport,
  limitReached, lineupFor,
} from '../js/modes/skirmish.js';
import { readFileSync } from 'node:fs';

const SEEDS = Array.from({ length: 24 }, (_, i) => 1 + i * 7919);
const ZONE_SWAP = { E: 'e', S: 's', N: 'N', s: 'S', e: 'E' };
const SIDE_SWAP = { own: 'enemy', enemy: 'own' };
const FACING = {
  spiegel: { N: 'N', NE: 'NW', E: 'W', SE: 'SW', S: 'S', SW: 'SE', W: 'E', NW: 'NE' },
  punkt: { N: 'S', NE: 'SW', E: 'W', SE: 'NW', S: 'N', SW: 'NE', W: 'E', NW: 'SE' },
};

function handmade(langs = { a: 'kaldern', b: 'morrow' }) {
  return BATTLE_MAPS.filter((m) => m.kind === 'spec').map((m) => buildMap({ ...m.spec, langs }));
}

function assertMirrored(json) {
  const meta = { width: json.width, height: json.height, symmetry: json.symmetry };
  for (let y = 0; y < json.height; y++) {
    for (let x = 0; x < json.width; x++) {
      const m = mirrorCell(meta, x, y);
      assert.equal(json.terrain[y][x], json.terrain[m.y][m.x], `Boden ${x}/${y} (${json.id})`);
      assert.equal(json.heights[y][x], json.heights[m.y][m.x], `Höhe ${x}/${y} (${json.id})`);
      assert.equal(ZONE_SWAP[json.zones[y][x]], json.zones[m.y][m.x], `Zone ${x}/${y} (${json.id})`);
    }
  }
  const at = (list) => new Map(list.map((c) => [c.x + ',' + c.y, c]));
  const trenches = at(json.trenches);
  for (const t of json.trenches) {
    const m = mirrorCell(meta, t.x, t.y);
    const o = trenches.get(m.x + ',' + m.y);
    assert.ok(o, `Graben ohne Gegenstück bei ${t.x}/${t.y} (${json.id})`);
    assert.equal(o.side, SIDE_SWAP[t.side]);
    assert.equal(o.kind, t.kind);
    assert.equal(o.level, t.level);
    assert.equal(o.facing, FACING[json.symmetry][t.facing]);
  }
  const wire = at(json.wire);
  for (const d of json.wire) {
    const m = mirrorCell(meta, d.x, d.y);
    assert.equal(wire.get(m.x + ',' + m.y)?.side, SIDE_SWAP[d.side], `Draht ${d.x}/${d.y}`);
  }
  const craters = at(json.craters);
  for (const c of json.craters) {
    const m = mirrorCell(meta, c.x, c.y);
    assert.equal(craters.get(m.x + ',' + m.y)?.size, c.size, `Krater ${c.x}/${c.y}`);
  }
  const rails = new Set(json.rails.map(([x, y]) => x + ',' + y));
  for (const [x, y] of json.rails) { const m = mirrorCell(meta, x, y); assert.ok(rails.has(m.x + ',' + m.y), `Gleis ${x}/${y}`); }
  const own = json.buildings.filter((b) => !b.side).map((b) => b.type).sort();
  const foe = json.buildings.filter((b) => b.side === 'enemy').map((b) => b.type).sort();
  assert.deepEqual(own, foe, 'beide Seiten haben dieselben Gebäude');
  for (const b of json.buildings.filter((q) => !q.side)) {
    const m = json.buildings.find((q) => q.id === 'm-' + b.id);
    const w = b.w ?? 1, h = b.h ?? 1;
    assert.equal(m.x, json.width - b.x - w);
    assert.equal(m.y, json.symmetry === 'punkt' ? json.height - b.y - h : b.y);
  }
}

/** Alle begehbaren Felder haengen zusammen (vier Nachbarn, strenger als A* mit Diagonalen) */
function assertConnected(json) {
  const map = loadMap(json);
  const ok = (c) => c && Number.isFinite(enterCost(c));
  const start = map.cells.find(ok);
  const seen = new Set([start.y * map.width + start.x]);
  const queue = [start];
  while (queue.length) {
    const c = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
      const i = y * map.width + x;
      if (seen.has(i) || !ok(map.cells[i])) continue;
      seen.add(i);
      queue.push(map.cells[i]);
    }
  }
  const passable = map.cells.filter(ok).length;
  assert.equal(seen.size, passable, `${passable - seen.size} begehbare Felder sind abgeschnitten (${json.id})`);
  return map;
}

test('Zufallskarte: gleicher Seed, gleiche Karte; anderer Seed, andere Karte', () => {
  assert.deepEqual(generateMap(42), generateMap(42));
  assert.notDeepEqual(generateMap(42).terrain, generateMap(43).terrain);
  assert.deepEqual(randomSpec(9), randomSpec(9));
});

test('Zufallskarten sind spiegelbar: Boden, Höhe, Zonen, Gräben, Draht, Krater, Gleise, Gebäude', () => {
  const kinds = new Set();
  for (const s of SEEDS) {
    const json = generateMap(s);
    kinds.add(json.symmetry);
    assertMirrored(json);
  }
  assert.deepEqual([...kinds].sort(), ['punkt', 'spiegel'], 'beide Spiegelarten kommen vor');
});

test('Zufallskarten: alles erreichbar, jede Front kommt zur anderen', () => {
  for (const s of SEEDS) {
    const json = generateMap(s);
    const map = assertConnected(json);
    const own = map.cells.filter((c) => c.trench?.side === 'own' && c.trench.kind === 'fire');
    const foe = map.cells.filter((c) => c.trench?.side === 'enemy' && c.trench.kind === 'fire');
    assert.ok(own.length > 30 && foe.length === own.length, `Feuergräben fehlen (${json.id})`);
    const depot = map.buildings.find((b) => b.type === 'depot' && b.side === 'own');
    const from = { x: depot.x + depot.w, y: depot.y };
    const a = own[Math.floor(own.length / 2)], b = foe[Math.floor(foe.length / 3)];
    assert.ok(findPath(map, a, b), `kein Weg von Graben zu Graben (${json.id})`);
    assert.ok(findPath(map, from, a), `kein Weg vom Depot zur Front (${json.id})`);
  }
});

test('Zufallskarten: Niemandsland breit genug, Draht vor beiden Linien, Etappe mit Depot und Batterien', () => {
  for (const s of SEEDS.slice(0, 10)) {
    const json = generateMap(s);
    const nm = json.zones.map((r) => [...r].filter((c) => c === 'N').length);
    assert.ok(Math.min(...nm) >= 6, `Niemandsland zu schmal (${json.id})`);
    for (const side of ['own', 'enemy']) {
      assert.ok(json.wire.filter((d) => d.side === side).length > json.height / 2);
      const types = json.buildings.filter((b) => (b.side ?? 'own') === side).map((b) => b.type);
      for (const t of ['depot', 'bahnhof', 'fernmelde', 'batterie', 'turm']) assert.ok(types.includes(t), `${t} fehlt (${side})`);
    }
  }
});

test('Handgebaute Karten: spiegelbar und erreichbar, in beiden Namenssprachen', () => {
  for (const langs of [{ a: 'kaldern', b: 'morrow' }, { a: 'morrow', b: 'kaldern' }]) {
    for (const json of handmade(langs)) {
      assertMirrored(json);
      assertConnected(json);
    }
  }
  assert.equal(BATTLE_MAPS.length, 4, 'vier handgebaute Karten');
});

test('Ortsnamen: jede Kartenhälfte in der Sprache ihrer Fraktion, umstrittener Ort mit beiden Namen', () => {
  const k = handmade({ a: 'kaldern', b: 'morrow' }).find((m) => m.id === 'velde');
  const m = handmade({ a: 'morrow', b: 'kaldern' }).find((q) => q.id === 'velde');
  const west = (json) => json.labels.filter((l) => l.x < json.width / 2 && !/^(ETAPPE|Abschnitt)/.test(l.text)).map((l) => l.text);
  assert.ok(west(k).includes('Ostervenn') && west(k).includes('Velde'));
  assert.ok(west(m).includes('Raudas') && west(m).includes('Sarvele'));
  assert.deepEqual(k.terrain, m.terrain, 'Sprache ändert das Gelände nicht');
  assert.ok(k.labels.some((l) => l.text === 'Velder Mühle'));
  assert.ok(k.notes.some((n) => n.text === 'drüben: „Mühle Velava“'));

  // Zufallskarte: Namen unterscheiden sich je Seite, keine Hauptfiguren
  for (const s of SEEDS.slice(0, 8)) {
    const json = generateMap(s);
    const texts = json.labels.map((l) => l.text);
    assert.equal(new Set(texts).size, texts.length, 'kein Name doppelt');
    for (const t of texts) assert.ok(!/Brandt|Harms|Vell\b|Lask/.test(t), t);
  }
  const n = createNamer(createRng(3));
  const mor = Array.from({ length: 30 }, () => n('morrow', 'village'));
  const kal = Array.from({ length: 30 }, () => n('kaldern', 'village'));
  for (const s of mor) assert.ok(!/[aeiou]{3}/i.test(s), 'keine drei Vokale: ' + s);
  assert.ok(kal.every((s) => /(venn|husen|dorp|siel|warf|brügge|fehn|horst|wold|kamp|hude|um|zand|moor|hörn)$/.test(s)), kal.join());
  assert.ok(mor.every((s) => !/(venn|husen|dorp|siel|warf)$/.test(s)), mor.join());
});

test('Szenario Gefecht frei: gespiegelte Aufstellung in den eigenen Gräben, beide Fraktionen', () => {
  for (const s of SEEDS.slice(0, 8)) {
    for (const faction of ['kaldern', 'morrow']) {
      const json = mapJsonFor({ map: 'zufall', mapSeed: s, faction });
      const sc = skirmishScenario(json, { faction, difficulty: 'lask', seed: s });
      assert.equal(sc.sides.a.faction, faction);
      assert.notEqual(sc.sides.b.faction, faction);
      assert.equal(sc.sides.b.ai.difficulty, 'lask');
      const map = loadMap(json);
      const meta = { width: json.width, height: json.height, symmetry: json.symmetry };
      sc.sides.a.groups.forEach((g, i) => {
        const b = sc.sides.b.groups[i];
        assert.equal(b.type, g.type);
        assert.deepEqual(b.pos, mirrorCell(meta, g.pos.x, g.pos.y));
        const ca = map.cells[g.pos.y * map.width + g.pos.x], cb = map.cells[b.pos.y * map.width + b.pos.x];
        assert.equal(ca.trench?.side, 'own', `${g.type} steht im eigenen Graben`);
        assert.equal(cb.trench?.side, 'enemy');
      });
      const state = initEtappen(createInitialState(map, sc, s), map, sc);
      assert.equal(state.groups.length, 12);
      assert.ok(state.sides.a.etappe && state.sides.b.etappe, 'beide Seiten haben eine Etappe');
      assert.ok(state.sides.a.artillery.batteries.length === 2 && state.sides.b.artillery.batteries.length === 2);
      assert.equal(state.sides.a.artillery.lines.length, state.sides.b.artillery.lines.length);
    }
  }
  const hs = skirmishScenario(generateMap(5), { hotseat: true });
  assert.equal(hs.sides.b.control, 'human');
  assert.equal(hs.sides.b.ai, undefined);
});

test('Zufallskarten sind spielbar: KI gegen KI läuft, keine Seite gewinnt alles', () => {
  const winners = { a: 0, b: 0, null: 0 };
  for (const s of SEEDS.slice(0, 6)) {
    // Gleiche Fraktion auf beiden Seiten: nur das Gelaende darf entscheiden
    const json = generateMap(s);
    const sc = skirmishScenario(json, { faction: 'kaldern', seed: s });
    sc.sides.b.faction = 'kaldern';
    sc.sides.b.groups = sc.sides.b.groups.map((g, i) => ({ ...g, strength: sc.sides.a.groups[i].strength }));
    const r = runMatch({ mapJson: json, scenario: sc, seed: s, turns: 16, ai: { a: { doctrine: 'ausgewogen' }, b: { doctrine: 'ausgewogen' } } });
    assert.ok(r.turns >= 1);
    winners[r.winner]++;
  }
  assert.ok(winners.a < 6 && winners.b < 6, JSON.stringify(winners));
});

test('Asse-Nord: festes Szenario, Fraktion tauschen und Hotseat', () => {
  const sc = JSON.parse(readFileSync(new URL('../data/scenarios/asse-frei.json', import.meta.url), 'utf8'));
  const m = adaptFixedScenario(sc, { faction: 'morrow', difficulty: 'rekrut' });
  assert.equal(m.sides.a.faction, 'morrow');
  assert.equal(m.sides.b.faction, 'kaldern');
  assert.equal(m.sides.b.ai.difficulty, 'rekrut');
  assert.equal(sc.sides.a.faction, 'kaldern', 'Original bleibt');
  const h = adaptFixedScenario(sc, { hotseat: true });
  assert.equal(h.sides.b.control, 'human');
  assert.equal(mapJsonFor({ map: 'asse', faction: 'kaldern' }), null);
});

test('Tageslage: fester Seed je Tag, für alle gleich', () => {
  const k = dayKey(2026, 11, 9);
  assert.equal(k, 20261109);
  assert.equal(dailySeed(k), dailySeed(20261109));
  assert.notEqual(dailySeed(k), dailySeed(dayKey(2026, 11, 10)));
  assert.deepEqual(dailyBrief(k), dailyBrief(k));
  assert.equal(dailyBrief(k).rounds, 14);
  const factions = new Set(Array.from({ length: 20 }, (_, i) => dailyBrief(dayKey(2026, 12, i + 1)).faction));
  assert.deepEqual([...factions].sort(), ['kaldern', 'morrow']);
});

test('Wertung: Protokoll zählen, Rundengrenze, Punkte nach Plan 8.3', () => {
  let t = emptyTally();
  t = tallyLog(t, [
    { type: 'losses', side: 'a', amount: 5 }, { type: 'wounded', side: 'a', count: 3 },
    { type: 'losses', side: 'b', amount: 2 }, { type: 'wounded_returned', side: 'a', count: 2 }, { type: 'move', side: 'a' },
  ], { before: 'position', after: 'battle' });
  assert.deepEqual(t.losses, { a: 5, b: 2 });
  assert.equal(t.positionRounds, 1);
  assert.equal(t.battles, 1);
  const json = generateMap(11);
  const map = loadMap(json);
  const sc = skirmishScenario(json, { seed: 11 });
  const start = createInitialState(map, sc, 11);
  const r = finalReport({ start, end: start, map, tally: t });
  assert.equal(r.fallen, 2);
  assert.equal(r.rescued, 2);
  assert.equal(r.points, 100 + 2 * 2 - 3 * 2);
  assert.equal(r.verdict, 'draw');
  assert.equal(limitReached({ turnKind: 'position' }, { positionRounds: 14 }, 14), true);
  assert.equal(limitReached({ turnKind: 'battle' }, { positionRounds: 14 }, 14), false, 'Gefecht läuft zu Ende');
  assert.equal(limitReached({ turnKind: 'position' }, { positionRounds: 30 }, 0), false, 'offen');
  assert.equal(lineupFor(map, 'kaldern').length, 6);
});
