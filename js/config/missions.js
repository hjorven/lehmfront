// Missionen der Kampagne (P14): welches Szenario eine Mission spielt. P16 ff. tragen hier ihre Missionen ein
// (z. B. a1m1: 'akt1-m1'), bis dahin spielt jede Mission die freie Lage an der Asse.
// Missionsziele melden die Missionspakete mit registerMissionJudge aus js/campaign.js an.

export const DEFAULT_SCENARIO = 'asse-frei';

export const MISSION_SCENARIOS = {
  // a1m1: 'akt1-m1',
};

export function scenarioForMission(mission) {
  return MISSION_SCENARIOS[mission] ?? DEFAULT_SCENARIO;
}

/** Hat die Mission schon ein eigenes Szenario? (Feldzugskarte zeigt sonst "Übungslage") */
export function missionBuilt(mission) {
  return Object.hasOwn(MISSION_SCENARIOS, mission);
}
