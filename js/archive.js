// Protokoll-Archiv einer Mission (P07): jede aufgeloeste Runde mit allem, was zum Nachrechnen noetig ist.
// Rein: kein DOM, kein Date, kein Math.random. Das Archiv ist reines JSON (ausser env.map, das nicht
// gespeichert wird); der Film einer alten Runde entsteht neu aus Startzustand, Befehlen und Seed.

/** Leeres Archiv */
export function createArchive(mission = '') {
  return { mission, rounds: [] };
}

/**
 * Runde ablegen. input = { state, ordersA, ordersB, seed, turn }, result = { state, log }.
 * Gibt ein neues Archiv zurueck; eine Runde mit gleicher Nummer wird ersetzt.
 */
export function archiveRound(archive, input, result) {
  const entry = {
    turn: input.turn,
    kind: input.state.turnKind,
    battleRound: input.state.battle?.round ?? null,
    clock: { ...input.state.clock },
    night: input.state.night,
    seed: input.seed,
    start: structuredClone(input.state),
    ordersA: structuredClone(input.ordersA ?? []),
    ordersB: structuredClone(input.ordersB ?? []),
    log: structuredClone(result.log),
    endClock: { ...result.state.clock },
  };
  const rounds = archive.rounds.filter((r) => r.turn !== entry.turn);
  rounds.push(entry);
  rounds.sort((a, b) => a.turn - b.turn);
  return { ...archive, rounds };
}

/** Eingabe fuer replayTo / planFilm aus einem Archiv-Eintrag (env mit Karte von aussen) */
export function inputOf(entry, env = {}) {
  return { state: entry.start, ordersA: entry.ordersA, ordersB: entry.ordersB, seed: entry.seed, turn: entry.turn, env };
}

/** Titel einer Runde wie im Kopf des Gefechtsbildschirms */
export function entryTitle(entry) {
  return entry.kind === 'battle' ? `Gefechtsrunde ${entry.battleRound ?? entry.turn}` : `Stellungsrunde ${entry.turn}`;
}
