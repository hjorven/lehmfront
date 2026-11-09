#!/usr/bin/env node
// Headless-Simulator (Plan 10.9, Paket P13): KI gegen KI ohne Browser, fuer Balancing und KI-Turniere.
//
//   node tools/sim.js --map data/maps/asse.json --seed 42 --a halten --b sturm --runs 200
//   node tools/sim.js --map data/maps/asse.json --mirror --runs 200          # Symmetrie: Spiegelkarte, gleiche Armeen
//   node tools/sim.js --map data/maps/asse.json --tournament --runs 20       # alle Lagen gegeneinander
//
// Optionen:
//   --map <datei>          Karte (Pflicht)
//   --scenario <datei>     Szenario; ohne Angabe das erste unter data/scenarios/ mit passender Karte
//   --seed <zahl>          erster Seed, jede weitere Partie nimmt den naechsten (Standard 1)
//   --runs <zahl>          Partien (Standard 50)
//   --turns <zahl>         Rundengrenze je Partie (Standard 36, Gefechtsrunden zaehlen mit)
//   --a, --b <lage>        auto, halten, vorbereiten, sturm, gegenstoss (Standard auto)
//   --doctrine <id>        Doktrin fuer beide Seiten, oder --doctrine-a / --doctrine-b
//   --difficulty <id>      rekrut, veteran, lask fuer beide, oder --difficulty-a / --difficulty-b
//   --mirror               gespiegelte Karte mit identischen Armeen (Seite a des Szenarios fuer beide)
//   --tournament           alle Lagen gegen alle (je --runs Partien)
//   --json                 Ergebnis als JSON
//   --mission <id>         Kampagnenmission (z. B. a2m3) mit Missionsziel; Karte und Szenario kommen aus der Mission.
//                          Seite a spielt die Ziele des Szenarios, dazu ein Lauf mit passiver Seite a (P23).
//   --flags <a,b>          Flags der Kampagne fuer Varianten (z. B. vell_angriff, stollen_frueh)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadMap } from '../js/map.js';
import { mirrorMap, mirrorScenario, runSeries, topEntries } from '../js/ai/match.js';
import { POSTURES, DOCTRINES, DIFFICULTIES } from '../js/config/doctrines.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

function fail(msg) {
  console.error('Fehler: ' + msg);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.mission) {
  const { scenarioForMission } = await import('../js/config/missions.js');
  const { runMissionSeries } = await import('../js/ai/mission-match.js');
  const flags = typeof args.flags === 'string' ? args.flags.split(',') : [];
  const scenId = scenarioForMission(args.mission, { flags });
  const scenario = JSON.parse(readFileSync(join(ROOT, 'data/scenarios', scenId + '.json'), 'utf8'));
  const mapJson = JSON.parse(readFileSync(join(ROOT, 'data/maps', scenario.map + '.json'), 'utf8'));
  const runs = Math.max(1, Number(args.runs ?? 20) | 0);
  const seed = Number(args.seed ?? 1) >>> 0;
  const out = {};
  for (const passive of [false, true]) {
    const sum = runMissionSeries({ mapJson, scenario, mission: args.mission, seed, flags, passive }, runs);
    out[passive ? 'passiv' : 'aktiv'] = sum;
  }
  if (args.json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`Mission ${args.mission}, Szenario ${scenId}, Seeds ${seed} bis ${seed + runs - 1}`);
    for (const [k, sum] of Object.entries(out)) {
      console.log(`\n${k === 'aktiv' ? 'Seite a spielt die Ziele' : 'Seite a hält nur'}: Erfolg ${sum.wins} von ${runs}, Befehl erfüllt ${sum.orderMet}, Runden im Mittel ${Math.round((sum.rounds * 10) / runs) / 10}`);
      for (const [why, n] of Object.entries(sum.why).sort((p, q) => q[1] - p[1])) console.log(`  ${String(n).padStart(4)}  ${why}`);
      const ev = Object.entries(sum.events).filter(([t]) => /sap|tunnel|mine|raid|prisoner|captured|officer|trait|drain/.test(t)).sort((p, q) => q[1] - p[1]);
      if (ev.length) console.log('  Ereignisse: ' + ev.map(([t, n]) => `${t} ${n}`).join(', '));
    }
  }
  process.exit(0);
}
if (args.help || !args.map) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  process.exit(args.help ? 0 : 1);
}

const readJson = (p) => JSON.parse(readFileSync(resolve(process.cwd(), p), 'utf8'));
const mapJson = readJson(args.map);
let scenario;
if (args.scenario) scenario = readJson(args.scenario);
else {
  const dir = join(ROOT, 'data/scenarios');
  const file = existsSync(dir) && readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .find((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')).map === mapJson.id);
  if (!file) fail(`kein Szenario für Karte ${mapJson.id} gefunden (--scenario angeben)`);
  scenario = JSON.parse(readFileSync(join(dir, file), 'utf8'));
}

const pick = (v, table, what) => {
  if (v === undefined || v === true) return undefined;
  if (v === 'auto') return 'auto';
  if (!table[v]) fail(`unbekannte ${what} "${v}" (${Object.keys(table).join(', ')})`);
  return v;
};
const runs = Math.max(1, Number(args.runs ?? 50) | 0);
const seed = Number(args.seed ?? 1) >>> 0;
const turns = args.turns ? Math.max(1, Number(args.turns) | 0) : undefined;
const side = (s) => ({
  posture: pick(args[s] ?? 'auto', POSTURES, 'Lage'),
  doctrine: pick(args['doctrine-' + s] ?? args.doctrine, DOCTRINES, 'Doktrin'),
  difficulty: pick(args['difficulty-' + s] ?? args.difficulty, DIFFICULTIES, 'Schwierigkeit'),
});

let map, scen;
if (args.mirror) {
  const mj = mirrorMap(mapJson);
  map = loadMap(mj);
  scen = mirrorScenario(mapJson, scenario.sides.a.groups);
} else {
  map = loadMap(mapJson);
  scen = scenario;
}

const pctOf = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);
const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

function series(a, b) {
  const t0 = process.hrtime.bigint();
  const sum = runSeries({ map, scenario: scen, seed, turns, ai: { a, b } }, runs);
  sum.ms = Number(process.hrtime.bigint() - t0) / 1e6;
  return sum;
}

function report(title, a, b, sum) {
  const lines = [];
  lines.push(`== ${title} ==`);
  lines.push(`Karte ${map.id}, Szenario ${scen.id}, Seeds ${seed} bis ${seed + runs - 1}, ${runs} Partien, ${fmt(sum.ms / 1000)} s`);
  lines.push(`Seite a: Lage ${a.posture ?? 'auto'}, Doktrin ${a.doctrine ?? 'ausgewogen'}, ${a.difficulty ?? 'veteran'}`);
  lines.push(`Seite b: Lage ${b.posture ?? 'auto'}, Doktrin ${b.doctrine ?? 'ausgewogen'}, ${b.difficulty ?? 'veteran'}`);
  lines.push('');
  lines.push(`Siegquote   a ${fmt(pctOf(sum.wins.a, runs))} %   b ${fmt(pctOf(sum.wins.b, runs))} %   Remis ${fmt(pctOf(sum.wins.draw, runs))} %`);
  lines.push(`Verluste    a ${fmt(sum.losses.a / runs)} Mann   b ${fmt(sum.losses.b / runs)} Mann (Mittel je Partie)`);
  lines.push(`Gelände     a ${fmt(sum.ground.a / runs)}   b ${fmt(sum.ground.b / runs)} genommene Grabenfelder`);
  lines.push(`Runden      ${fmt(sum.turns / runs)} je Partie, ${fmt(sum.battles / runs)} Angriffe`);
  for (const s of ['a', 'b']) {
    lines.push('');
    lines.push(`Top-10 Entscheidungen Seite ${s}:`);
    for (const [k, n] of topEntries(sum.decisions[s], 10)) lines.push(`  ${String(n).padStart(6)}  ${k}`);
  }
  lines.push('');
  lines.push('Top-10 Begründungen im Protokoll:');
  for (const [k, n] of topEntries(sum.events, 10)) lines.push(`  ${String(n).padStart(6)}  ${k}`);
  return lines.join('\n');
}

if (args.tournament) {
  const ids = Object.keys(POSTURES);
  const table = [];
  for (const pa of ['auto', ...ids]) {
    for (const pb of ['auto', ...ids]) {
      const a = { ...side('a'), posture: pa }, b = { ...side('b'), posture: pb };
      const sum = series(a, b);
      table.push({ a: pa, b: pb, wins: sum.wins, losses: { a: sum.losses.a / runs, b: sum.losses.b / runs } });
    }
  }
  if (args.json) console.log(JSON.stringify(table, null, 2));
  else {
    console.log(`Turnier aller Lagen, je ${runs} Partien. Zeile = Seite a, Spalte = Seite b, Wert = Siegquote a in Prozent.`);
    const cols = ['auto', ...ids];
    console.log(''.padEnd(13) + cols.map((c) => c.padStart(12)).join(''));
    for (const pa of cols) {
      console.log(pa.padEnd(13) + cols.map((pb) => fmt(pctOf(table.find((t) => t.a === pa && t.b === pb).wins.a, runs)).padStart(12)).join(''));
    }
  }
} else {
  const a = side('a'), b = side('b');
  const sum = series(a, b);
  if (args.json) console.log(JSON.stringify({ a, b, ...sum, decisions: { a: topEntries(sum.decisions.a), b: topEntries(sum.decisions.b) }, events: topEntries(sum.events) }, null, 2));
  else console.log(report(args.mirror ? 'Symmetrietest auf gespiegelter Karte' : 'KI gegen KI', a, b, sum));
}
