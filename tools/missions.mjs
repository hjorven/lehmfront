// Kampagnenmissionen ohne Browser durchspielen (P16).
//   node tools/missions.mjs                      alle Missionen von Akt 1, Seeds 1 bis 5
//   node tools/missions.mjs akt1-m4 --seeds 1,2,3
// Jede Mission spielt jede Spielerin aus tools/akt1-players.mjs ("gut" soll siegen, die anderen verlieren).
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { playMission } from '../js/missions/run.js';
import { PLAYERS } from './akt1-players.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const args = process.argv.slice(2);
const si = args.indexOf('--seeds');
const seeds = (si >= 0 ? args[si + 1] : '1,2,3,4,5').split(',').map(Number);
const only = args.filter((a, i) => !a.startsWith('--') && (si < 0 || i !== si + 1));
const ids = only.length ? only : readdirSync(join(root, 'data/missions')).filter((f) => /^akt1-m\d+\.json$/.test(f)).map((f) => f.slice(0, -5)).sort();

for (const id of ids) {
  const scenario = rd(`data/missions/${id}.json`);
  const mapJson = rd(`data/maps/${scenario.map}.json`);
  const players = PLAYERS[scenario.mission.id] ?? {};
  for (const [name, player] of Object.entries(players)) {
    const res = seeds.map((seed) => playMission({ mapJson, scenario, seed, player }));
    const won = res.filter((r) => r.outcome === 'sieg').length;
    console.log(`${id} ${name.padEnd(7)} ${won}/${res.length} Siege`);
    res.forEach((r, i) => console.log(`  Seed ${seeds[i]}: ${r.outcome}, ${r.positionRounds} Stellungsrunden. ${r.why}${r.flags.length ? ' [' + r.flags.join(', ') + ']' : ''}`));
  }
}
