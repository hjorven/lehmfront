// Ablaufplan einer Mission (P16): was Lask wann vorhat, wie das Wetter laeuft. Steht im Szenario unter "mission"
// und wird beim Start in den Spielzustand kopiert (state.mission), damit Gefecht, Simulator und Tests denselben
// Ablauf lesen. Rein: kein DOM, kein Date, kein Math.random.
//
// scenario.mission = {
//   id: 'a1m2',                                  Missions-ID der Kampagne
//   lask: [{ from: 1, posture: 'halten' }, ...],  Lage der KI ab dieser Stellungsrunde (halten, vorbereiten, sturm,
//                                                gegenstoss oder auto). Gilt nur in Stellungsrunden; im Gefecht
//                                                entscheidet die KI selbst (Sturm weiterfuehren, Gegenstoss).
//   weather: [{ from: 1, kind: 'storm' }, ...],  Wetter ab dieser Stellungsrunde (fest, nicht gewuerfelt). Die Phase
//                                                setzt es schon am Ende der Runde davor, damit die Uhr es beim
//                                                Planen zeigt; Runde 1 nimmt scenario.weather.
//   fire: [{ from: 1, to: 5, plan: { id, kind: 'harass', batteries, target } }, ...]
//                                                Feuerplaene der Gegenseite in diesen Stellungsrunden (Stoerfeuer auf
//                                                das Gleis), zusaetzlich zu dem, was die KI selbst schiesst
//   hints: ['hinweis.graben', ...],              Tutorial-Hinweise dieser Mission (data/texts/tutorial.json)
//   survey: true                                 Mission 1: die Karte ist ein leeres Blatt und zeichnet sich erst,
//                                                wo die eigenen Leute hinsehen oder graben
// }
import { POSTURES } from '../config/doctrines.js';
import { halfDay } from './goals.js';
import { compareId } from '../state.js';

/** Missionsdaten aus dem Szenario in den Anfangszustand legen (neuer Zustand) */
export function prepareMission(state, scenario) {
  const m = scenario?.mission;
  if (!m?.id) return state;
  const s = structuredClone(state);
  s.mission = {
    id: String(m.id),
    startHour: scenario.startHour ?? 6,
    startDay: Number.isInteger(scenario.startDay) && scenario.startDay > 0 ? scenario.startDay : 1,
    lask: (m.lask ?? []).filter((e) => Number.isInteger(e.from) && (POSTURES[e.posture] || e.posture === 'auto'))
      .map((e) => ({ from: e.from, posture: e.posture })).sort((p, q) => p.from - q.from),
    fire: (m.fire ?? []).filter((e) => Number.isInteger(e.from) && e.plan?.id && e.plan?.kind)
      .map((e) => ({ from: e.from, to: Number.isInteger(e.to) ? e.to : e.from, plan: structuredClone(e.plan) })).sort((p, q) => p.from - q.from || compareId(p.plan.id, q.plan.id)),
    weather: (m.weather ?? []).filter((e) => Number.isInteger(e.from) && typeof e.kind === 'string')
      .map((e) => ({ from: e.from, kind: e.kind })).sort((p, q) => p.from - q.from),
  };
  return s;
}

/** Eintrag eines Ablaufplans, der in Stellungsrunde n gilt (der letzte mit from <= n) */
export function entryAt(list, n) {
  let out = null;
  for (const e of list ?? []) if (e.from <= n) out = e;
  return out;
}

/** Stellungsrunde der Mission (1 = erste) */
export function missionRound(state) {
  return halfDay(state, state.mission?.startHour ?? 6, state.mission?.startDay ?? 1);
}

/**
 * Lage fuer die KI aus dem Ablaufplan: { posture } in Stellungsrunden, sonst {} (die KI entscheidet selbst).
 * In die Optionen von decide() mischen: decide(view, { ...cfg, ...missionAi(state) }).
 */
export function missionAi(state) {
  if (!state?.mission?.lask?.length || state.turnKind !== 'position') return {};
  const e = entryAt(state.mission.lask, missionRound(state));
  return e && e.posture !== 'auto' ? { posture: e.posture } : {};
}

/**
 * Befehle der KI-Seite um die Feuerplaene des Ablaufplans ergaenzen (neue Liste). Gibt die KI selbst einen Feuerplan,
 * kommen die Plaene des Ablaufplans dazu (gleiche ID: der Ablaufplan gewinnt nicht, die KI behaelt ihren).
 */
export function withMissionOrders(orders, state) {
  const list = state?.mission?.fire;
  if (!list?.length || state.turnKind !== 'position') return orders;
  const n = missionRound(state);
  const plans = list.filter((e) => e.from <= n && n <= e.to).map((e) => structuredClone(e.plan));
  if (!plans.length) return orders;
  const out = orders.map((o) => ({ ...o }));
  const fp = out.find((o) => o.type === 'fire_plan');
  if (fp) {
    const ids = new Set((fp.plans ?? []).map((p) => p.id));
    fp.plans = [...(fp.plans ?? []), ...plans.filter((p) => !ids.has(p.id))];
  } else out.push({ type: 'fire_plan', plans });
  return out;
}
