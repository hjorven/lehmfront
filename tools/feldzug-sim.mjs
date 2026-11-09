#!/usr/bin/env node
// Turnier ueber die Kampagnenmissionen von Akt 2 bis 4 (P27): KI gegen KI mit dem Missionsziel als Schiedsrichter.
// Seite a spielt einmal mit den Zielen aus dem Szenario (aktiv) und einmal nur haltend (passiv).
// Gute Missionen: aktiv meist gewinnbar, passiv meist verloren.
//
//   node tools/feldzug-sim.mjs                     alle Missionen, Seeds 1 bis 10
//   node tools/feldzug-sim.mjs --runs 20 a3m6 a4m2
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { scenarioForMission } from '../js/config/missions.js';
import { runMissionSeries } from '../js/ai/mission-match.js';
import '../js/phases/index.js';
import '../js/ai.js';

const argv = process.argv.slice(2);
const ri = argv.indexOf('--runs');
const runs = ri >= 0 ? Number(argv[ri + 1]) | 0 : 10;
const only = argv.filter((a, i) => !a.startsWith('--') && (ri < 0 || i !== ri + 1));
const MISSIONS = only.length ? only : ['a2m1', 'a2m2', 'a2m3', 'a2m4', 'a2m5', 'a2m6', 'a3m1', 'a3m2', 'a3m3', 'a3m4', 'a3m5', 'a3m6', 'a4m1', 'a4m2', 'a4m3', 'a4m4', 'a4m5'];
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const maps = new Map();
const pct = (n) => `${String(Math.round((n / runs) * 100)).padStart(3)} %`;

console.log(`Mission  Szenario                 aktiv    passiv   Befehl erfüllt (aktiv)   ${runs} Seeds`);
for (const mission of MISSIONS) {
  const id = scenarioForMission(mission, { flags: [] });
  const scenario = read(`../data/scenarios/${id}.json`);
  if (!maps.has(scenario.map)) maps.set(scenario.map, loadMap(read(`../data/maps/${scenario.map}.json`)));
  const base = { map: maps.get(scenario.map), scenario, mission, seed: 1, script: /^a4m/.test(mission) };
  const act = runMissionSeries(base, runs);
  const pas = runMissionSeries({ ...base, passive: true }, runs);
  console.log(`${mission.padEnd(8)} ${id.padEnd(24)} ${pct(act.wins)}    ${pct(pas.wins)}    ${pct(act.orderMet)}`);
}
