// Missionen der Kampagne (P14): welches Szenario eine Mission spielt. P16 ff. tragen hier ihre Missionen ein
// (z. B. a1m1: 'akt1-m1'), bis dahin spielt jede Mission die freie Lage an der Asse.
// Missionsziele melden die Missionspakete mit registerMissionJudge aus js/campaign.js an.

import { AKT2_SCENARIOS, prepareAkt2 } from './missions-akt2.js';

export const DEFAULT_SCENARIO = 'asse-frei';

export const MISSION_SCENARIOS = {
  a1m1: 'akt1-m1',
  a1m2: 'akt1-m2',
  a1m3: 'akt1-m3',
  a1m4: 'akt1-m4',
  a1m5: 'akt1-m5',
  a1m6: 'akt1-m6',
  ...AKT2_SCENARIOS, // P23: Akt 2, Varianten nach Flags ({ base, flags })
};

/** Szenario einer Mission; campaign (optional) waehlt Varianten nach Flags ({ base, flags: { flag: id } }) */
export function scenarioForMission(mission, campaign = null) {
  const e = MISSION_SCENARIOS[mission];
  if (!e) return DEFAULT_SCENARIO;
  if (typeof e === 'string') return e;
  const flags = campaign?.flags ?? [];
  for (const [flag, id] of Object.entries(e.flags ?? {})) if (flags.includes(flag)) return id;
  return e.base;
}

/** Missionseigene Vorbereitung nach applyCampaignToState (P23: Doktrin, Lattenroste in Akt 2) */
export function prepareMission(mission, state, campaign, side = 'a') {
  if (/^a[2-9]m/.test(mission ?? '')) return prepareAkt2(state, campaign, side);
  return state;
}

/** Hat die Mission schon ein eigenes Szenario? (Feldzugskarte zeigt sonst "Übungslage") */
export function missionBuilt(mission) {
  return Object.hasOwn(MISSION_SCENARIOS, mission);
}
