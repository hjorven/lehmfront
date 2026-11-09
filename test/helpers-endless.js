// Hilfen fuer test/endless.test.js: einen Lauf ohne Browser Woche fuer Woche spielen (KI gegen KI).
import { readFileSync } from 'node:fs';
import { loadMap } from '../js/map.js';
import { createInitialState, SIDES } from '../js/state.js';
import { initEtappen } from '../js/etappe-map.js';
import { resolveTurn } from '../js/resolve.js';
import { viewFor } from '../js/view.js';
import { decide } from '../js/ai.js';
import '../js/phases/index.js';
import { mapJsonFor, skirmishScenario } from '../js/modes/skirmish.js';
import { newRun, prepareWeek, baseOf, generateOrder, weekOver, finishWeek, enemyDifficulty } from '../js/modes/endless.js';

export const ENTRIES = JSON.parse(readFileSync(new URL('../data/texts/endlos.json', import.meta.url), 'utf8')).eintraege;

export function setupRun(opts = {}) {
  const run = newRun({ faction: 'kaldern', map: 'zufall', mapSeed: 7, seed: 11, ...opts });
  const mapJson = mapJsonFor({ map: run.map, mapSeed: run.mapSeed, faction: run.faction });
  const map = loadMap(mapJson);
  const scenario = skirmishScenario(mapJson, { faction: run.faction, difficulty: 'rekrut', seed: run.mapSeed });
  const fresh = initEtappen(createInitialState(map, scenario, run.seed), map, scenario);
  run.base = baseOf(fresh);
  const state = prepareWeek(fresh, run, map);
  run.order = generateOrder(ENTRIES, run, state, map);
  return { run, map, state, scenario };
}

/** Eine Woche KI gegen KI; liefert { end, rounds } */
export function playWeek(state, run, map, { maxTurns = 80 } = {}) {
  const env = { map };
  const memory = { a: undefined, b: undefined };
  const rounds = [];
  let log = [];
  let s = state;
  for (let i = 0; i < maxTurns && !weekOver(s) && !s.result; i++) {
    const orders = {};
    for (const side of SIDES) {
      const d = decide(viewFor(s, log, side, env), { map, seed: run.seed, side, difficulty: side === 'b' ? enemyDifficulty(run.week) : 'veteran', memory: memory[side] });
      memory[side] = d.memory;
      orders[side] = d.orders;
    }
    const r = resolveTurn(s, orders.a, orders.b, run.seed, s.turn, env);
    rounds.push({ turn: s.turn, kind: s.turnKind, log: r.log });
    log = r.log;
    s = r.state;
  }
  return { end: s, rounds };
}

export function nextWeek(run, map, start, end, rounds) {
  const f = finishWeek(run, { start, end, rounds, map });
  if (f.run.ended) return { ...f, state: end };
  const state = prepareWeek(end, f.run, map);
  f.run.order = generateOrder(ENTRIES, f.run, state, map);
  return { ...f, state };
}
