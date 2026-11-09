// Missionen der Kampagne ohne Browser durchspielen (P23): KI gegen KI mit dem Missionsziel als Schiedsrichter.
// Seite a spielt entweder mit den Zielen aus dem Szenario (sides.a.ai.goals: Sappe, Stollen, Stosstrupp, Angriff)
// oder passiv (haelt nur), um zu zeigen, dass eine Mission gewinnbar und verlierbar ist.
import { loadMap } from '../map.js';
import { createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { decide } from '../ai.js';
import { judgeMission } from '../campaign.js';
import { prepareMission } from '../config/missions.js';

/**
 * Eine Mission. opts: { mapJson | map, scenario, mission, seed, passive?, flags?, turns? }
 * Liefert { outcome, orderMet, why, flags, rounds, state, events: { type: n } }.
 */
export function runMission(opts) {
  const map = opts.map ?? loadMap(opts.mapJson);
  const seed = (opts.seed ?? 1) >>> 0;
  const env = { map };
  let state = initEtappen(createInitialState(map, opts.scenario, seed), map, opts.scenario);
  state = prepareMission(opts.mission, state, { flags: opts.flags ?? [] }, 'a');
  const memory = { a: undefined, b: undefined };
  const rounds = [];
  const events = {};
  let log = [];
  const goalsA = opts.passive ? null : opts.scenario.sides.a.ai?.goals ?? null;
  const limit = opts.turns ?? 80;
  for (let i = 0; i < limit && !state.result; i++) {
    const orders = {};
    for (const side of ['a', 'b']) {
      const cfg = side === 'a'
        ? { posture: opts.passive ? 'halten' : undefined, doctrine: 'ausgewogen', difficulty: 'lask', goals: goalsA }
        : { doctrine: opts.scenario.sides.b.ai?.doctrine, difficulty: opts.scenario.sides.b.ai?.difficulty, goals: opts.scenario.sides.b.ai?.goals ?? null };
      const d = decide(viewFor(state, log, side, env), { map, seed, side, memory: memory[side], ...cfg });
      memory[side] = d.memory;
      orders[side] = opts.passive && side === 'a' ? [] : d.orders;
    }
    const kind = state.turnKind;
    const r = resolveTurn(state, orders.a, orders.b, seed, state.turn, env);
    state = r.state;
    log = r.log;
    rounds.push({ turn: state.turn - 1, kind, log: r.log });
    for (const e of r.log) if (!e.minor) events[e.type] = (events[e.type] ?? 0) + 1;
    const j = judgeMission(opts.mission, { state, rounds, side: 'a', final: false });
    if (j?.done) return { ...j, rounds: rounds.length, state, events, ...(opts.keepLog ? { log: rounds } : {}) };
  }
  const j = judgeMission(opts.mission, { state, rounds, side: 'a', final: true });
  return { ...j, rounds: rounds.length, state, events, ...(opts.keepLog ? { log: rounds } : {}) };
}

/** Mehrere Seeds: { runs, wins, losses, orderMet, why: { text: n }, rounds, events } */
export function runMissionSeries(opts, runs) {
  const map = opts.map ?? loadMap(opts.mapJson);
  const sum = { runs, wins: 0, losses: 0, orderMet: 0, why: {}, rounds: 0, events: {} };
  for (let i = 0; i < runs; i++) {
    const r = runMission({ ...opts, map, seed: ((opts.seed ?? 1) + i) >>> 0 });
    if (r.outcome === 'sieg') sum.wins++; else sum.losses++;
    if (r.orderMet) sum.orderMet++;
    sum.why[r.why] = (sum.why[r.why] ?? 0) + 1;
    sum.rounds += r.rounds;
    for (const [k, n] of Object.entries(r.events)) sum.events[k] = (sum.events[k] ?? 0) + n;
  }
  return sum;
}
