// Puzzle-Lagen ohne Browser durchspielen (P25): fuer Tests, die Loesung und das Nachrechnen.
// Rein: kein DOM, kein Date, kein Math.random.
import { loadMap } from '../map.js';
import { createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { resolveTurn } from '../resolve.js';
import { puzzleMapJson, puzzleScenario, preparePuzzleState, scriptedOrders, solutionOrders, carryOrders, mergeCarry } from './puzzle.js';
import { judgeGoal, seenNow } from './goals.js';

/** Startzustand einer Lage. Gefechtslagen beginnen mitten im Gefecht (Gefechtsrunde 1). */
export function puzzleStart(p) {
  const mapJson = puzzleMapJson(p);
  const map = loadMap(mapJson);
  const scenario = puzzleScenario(p);
  let state = createInitialState(map, scenario, p.seed ?? 1);
  state = preparePuzzleState(p, initEtappen(state, map, scenario));
  return { mapJson, map, scenario, state };
}

/**
 * Spielt eine Lage mit Befehlen je Runde: orders(turn, state) -> Liste fuer Seite a (Restbefehle laufen weiter).
 * Liefert { verdict, state, rounds, logs }.
 */
export function playPuzzle(p, orders) {
  const { map, state: s0 } = puzzleStart(p);
  const env = { map };
  let state = s0;
  let carry = { a: [], b: [] };
  let seen = false;
  const logs = [];
  let verdict = { status: 'running' };
  for (let r = 1; r <= p.limit && verdict.status === 'running'; r++) {
    const a = mergeCarry(orders(state.turn, state) ?? [], carry.a);
    const b = mergeCarry(scriptedOrders(p, state), carry.b);
    const res = resolveTurn(state, a, b, p.seed ?? 1, state.turn, env);
    state = res.state;
    logs.push(res.log);
    carry = carryOrders(state, res.log);
    seen = seen || seenNow(p.goal, state, map);
    verdict = judgeGoal(p, { start: s0, state, map, rounds: r, seen });
  }
  return { verdict, state, rounds: logs.length, logs };
}

/** Die hinterlegte Loesung spielen */
export function playSolution(p) {
  return playPuzzle(p, (turn) => solutionOrders(p, turn));
}
