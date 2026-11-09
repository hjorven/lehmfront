#!/usr/bin/env node
// Fraktionsbalance auf Zufallskarten (P21): Kaldern gegen Morrow, beide Seitenbelegungen, KI gegen KI.
//
//   node tools/balance.mjs --runs 40 --turns 24
//   node tools/balance.mjs --runs 40 --same kaldern      # gleiche Fraktion auf beiden Seiten (nur Gelaende/Seite)
//
// Jede Karte wird zweimal gespielt (Kaldern West, dann Morrow West), damit Seitenvorteil und Fraktionsvorteil
// sich trennen lassen. Doktrin beider Seiten: ausgewogen, Schwierigkeit veteran.
import { generateMap } from '../js/mapgen.js';
import { skirmishScenario } from '../js/modes/skirmish.js';
import { runMatch } from '../js/ai/match.js';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true] : null)).filter(Boolean));
const runs = Number(args.runs ?? 20) | 0;
const turns = Number(args.turns ?? 24) | 0;
const first = Number(args.seed ?? 1) >>> 0;
const same = typeof args.same === 'string' ? args.same : null;

const tally = { kaldern: 0, morrow: 0, west: 0, east: 0, draw: 0, games: 0 };
const losses = { kaldern: 0, morrow: 0 };
const byWest = { kaldern: { a: 0, b: 0, draw: 0, n: 0 }, morrow: { a: 0, b: 0, draw: 0, n: 0 } };
for (let i = 0; i < runs; i++) {
  const seed = first + i;
  const json = generateMap(seed);
  for (const west of same ? [same] : ['kaldern', 'morrow']) {
    const sc = skirmishScenario(json, { faction: west, seed, doctrine: 'ausgewogen' });
    if (same) {
      sc.sides.b.faction = same;
      sc.sides.b.groups = sc.sides.b.groups.map((g, k) => ({ ...g, strength: sc.sides.a.groups[k].strength }));
    }
    const r = runMatch({ mapJson: json, scenario: sc, seed, turns, ai: { a: { doctrine: 'ausgewogen' }, b: { doctrine: 'ausgewogen' } } });
    const fa = sc.sides.a.faction, fb = sc.sides.b.faction;
    tally.games++;
    byWest[fa].n++; byWest[fa][r.winner ?? 'draw']++;
    losses[fa] += r.losses.a; losses[fb] += r.losses.b;
    if (!r.winner) tally.draw++;
    else {
      tally[r.winner === 'a' ? 'west' : 'east']++;
      if (!same) tally[r.winner === 'a' ? fa : fb]++;
    }
  }
}
const pct = (n) => ((n * 100) / tally.games).toFixed(1).replace('.', ',') + ' %';
console.log(`${tally.games} Partien, ${turns} Runden, Seeds ${first} bis ${first + runs - 1}`);
if (!same) console.log(`Fraktion   Kaldern ${pct(tally.kaldern)}   Morrow ${pct(tally.morrow)}   Remis ${pct(tally.draw)}`);
console.log(`Seite      West ${pct(tally.west)}   Ost ${pct(tally.east)}   Remis ${pct(tally.draw)}`);
if (!same) for (const f of ['kaldern', 'morrow']) { const w = byWest[f]; if (w.n) console.log(`${f} im Westen: West ${w.a}  Ost ${w.b}  Remis ${w.draw}  (${w.n})`); }
if (!same) console.log(`Verluste   Kaldern ${(losses.kaldern / tally.games).toFixed(1)}   Morrow ${(losses.morrow / tally.games).toFixed(1)} Mann je Partie`);
