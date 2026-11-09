// Missionen ohne Browser durchspielen (P16): fuer Tests, tools/missions.mjs und Balancing.
// Rein: kein DOM, kein Date, kein Math.random. Karten und Szenarien kommen als JSON herein.
//
// playMission({ mapJson, scenario, seed, player, maxTurns, campaign? })
//   player(ctx) liefert die Befehle der Seite a fuer eine Runde (Liste wie im Befehlsbuch, mit Seitenbefehlen
//   wie fire_plan oder supply_plan). ctx: { state, view, map, env, turn, round (Stellungsrunde), log, memory, ai }
//   ctx.ai(opts) fragt den KI-Kommandanten fuer Seite a (z. B. als Spieler, der "halten" spielt).
//   Seite b spielt der KI-Kommandant mit dem Ablaufplan der Mission (state.mission.lask).
// Liefert { outcome, orderMet, why, flags, turns, positionRounds, state, rounds }.
import { loadMap } from '../map.js';
import { createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { decide } from '../ai.js';
import { judgeMission, applyCampaignToState, newCampaign } from '../campaign.js';
import { slimRounds } from '../campaign.js';
import { prepareMission, missionAi, missionRound, withMissionOrders } from './script.js';
import { positionRounds } from './goals.js';
import './index.js';

export const MAX_TURNS = 160;

export function playMission({ mapJson, map: given, scenario, seed = 1, player, maxTurns = MAX_TURNS, campaign = null }) {
  const map = given ?? loadMap(mapJson);
  const env = { map };
  const mission = scenario.mission?.id;
  if (!mission) throw new Error('Szenario ohne mission.id');
  let state = initEtappen(createInitialState(map, scenario, seed >>> 0), map, scenario);
  state = prepareMission(state, scenario);
  const camp = campaign ?? { ...newCampaign({ faction: scenario.sides.a.faction }), mission };
  state = applyCampaignToState(state, { ...camp, mission }, 'a');
  const ai = scenario.sides.b.ai ?? {};
  const memory = { a: undefined, b: undefined, player: {} };
  const rounds = [];
  let log = [];
  let verdict = null;
  for (let i = 0; i < maxTurns; i++) {
    const turn = state.turn;
    const viewA = viewFor(state, log, 'a', env);
    const askAi = (opts = {}) => {
      const d = decide(viewA, { map, seed, side: 'a', memory: memory.a, ...opts });
      memory.a = d.memory;
      return d.orders;
    };
    const ordersA = player ? player({ state, view: viewA, map, env, turn, round: missionRound(state), log, memory: memory.player, ai: askAi }) ?? [] : [];
    const db = decide(viewFor(state, log, 'b', env), { map, seed, side: 'b', doctrine: ai.doctrine, difficulty: ai.difficulty, memory: memory.b, ...missionAi(state) });
    memory.b = db.memory;
    const r = resolveTurn(state, ordersA, withMissionOrders(db.orders, state), seed, turn, env);
    rounds.push({ turn, kind: state.turnKind, battleRound: state.battle?.round ?? null, clock: { ...state.clock }, night: state.night, start: { groups: state.groups.map((g) => ({ id: g.id, side: g.side, type: g.type, strength: g.strength })) }, log: r.log });
    state = r.state;
    log = r.log;
    verdict = judgeMission(mission, { state, rounds, side: 'a', final: false, map });
    if (verdict) break;
  }
  if (!verdict) verdict = { ...judgeMission(mission, { state, rounds, side: 'a', final: true, map }), why: 'Rundengrenze des Simulators: ' + (judgeMission(mission, { state, rounds, side: 'a', final: true, map })?.why ?? '') };
  return {
    outcome: verdict.outcome, orderMet: !!verdict.orderMet, why: verdict.why ?? '', flags: verdict.flags ?? [],
    turns: state.turn - 1, positionRounds: positionRounds(rounds), state, rounds: slimRounds(rounds),
  };
}
