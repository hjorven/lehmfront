// Statistiken der letzten Mission fuer wann.werte (data/texts/README.md) aus dem Protokoll-Archiv (P07).
// Rein: kein DOM, kein Date, kein Math.random. Weitere Statistiken melden sich mit registerStat an.

const stats = new Map();

/** fn({ rounds, side, casualties, finalState }) -> Zahl */
export function registerStat(name, fn) {
  stats.set(name, fn);
}

const own = (rounds, side) => rounds.flatMap((r) => (r.log ?? []).filter((e) => e.side === side));
const count = (rounds, side, type) => own(rounds, side).filter((e) => e.type === type).length;
const sum = (rounds, side, type, key) => own(rounds, side).filter((e) => e.type === type).reduce((n, e) => n + (Number(e[key]) || 0), 0);

registerStat('gefallene', ({ casualties }) => casualties.fallen.length);
registerStat('verwundete', ({ casualties }) => casualties.wounded.length);
registerStat('verwundete_geborgen', ({ rounds, side }) => sum(rounds, side, 'supply_delivered', 'wounded'));
registerStat('verwundete_liegen', ({ rounds, side }) => {
  // Wer am Ende noch wartet, plus wer beim Warten gestorben ist
  const waiting = own(rounds, side).filter((e) => e.type === 'wounded_waiting');
  const last = waiting.length ? waiting[waiting.length - 1].waiting ?? 0 : 0;
  return last + waiting.reduce((n, e) => n + (e.died ?? 0), 0);
});
registerStat('gefangene', ({ rounds, side }) => sum(rounds, side, 'prisoners', 'count'));
registerStat('felder_gewonnen', ({ rounds, side }) => count(rounds, side, 'trench_taken') + count(rounds, side, 'breach'));
// Einbrueche des Gegners (breach, P06) sind verlorene eigene Grabenfelder
registerStat('felder_verloren', ({ rounds, side }) => count(rounds, side, 'trench_lost')
  + rounds.reduce((n, r) => n + (r.log ?? []).filter((e) => e.type === 'breach' && e.side && e.side !== side).length, 0));
// Stellungsrunden; Gefechtsrunden (kind 'battle') liegen dazwischen und zaehlen nicht
registerStat('runden', ({ rounds }) => rounds.filter((r) => r.kind !== 'battle').length);
registerStat('depot_leer', ({ rounds, side }) => count(rounds, side, 'depot_empty'));
registerStat('abloesung_verspaetet', ({ rounds, side }) => count(rounds, side, 'relief_late'));
registerStat('moral', ({ finalState, side }) => {
  const groups = (finalState?.groups ?? []).filter((g) => g.side === side && g.status !== 'lost');
  if (!groups.length) return 0;
  return Math.floor(groups.reduce((n, g) => n + (g.morale ?? 0), 0) / groups.length);
});

/** Alle Statistiken. input: { rounds, side, casualties: { fallen, wounded }, finalState } */
export function missionStats(input) {
  const out = {};
  const safe = { rounds: input.rounds ?? [], side: input.side, casualties: input.casualties ?? { fallen: [], wounded: [] }, finalState: input.finalState ?? null };
  for (const name of [...stats.keys()].sort()) out[name] = stats.get(name)(safe);
  return out;
}
