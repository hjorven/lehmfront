// Rundenaufloesung (Plan 10.6). Enthaelt keinen Mechanik-Code, nur den Ablauf:
// Befehle aufbereiten, Phasen aus dem Register der Reihe nach ausfuehren, Protokoll sammeln.
// Die Mechaniken liegen in js/phases/*.js und melden sich in js/phases/registry.js an.
// Rein: kein DOM, kein Date, kein Math.random. Zufall nur ueber js/rng.js.
import { rngForTurn } from './rng.js';
import { makeEvent } from './events.js';
import { normalizeOrders } from './orders.js';
import { groupsOf, getGroup, compareId } from './state.js';
import { phasesFor } from './phases/registry.js';
import './phases/index.js';

/** FNV-1a ueber die Phasen-ID: jede Phase bekommt einen eigenen Zufallsstrom */
export function hashId(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Zufall fuer eine Phase. Abgeleitet aus Partie-Seed, Runde und Phasen-ID, damit eine neu angemeldete
 * Phase die Wuerfe der anderen Phasen nicht verschiebt (parallele Pakete brechen sich keine Tests).
 */
export function rngForPhase(seed, turn, phaseId) {
  return rngForTurn((seed ^ hashId(phaseId)) >>> 0, turn);
}

/**
 * Eine Runde aufloesen.
 * state: Zustand vor der Runde (wird nie veraendert)
 * ordersA, ordersB: Befehlslisten der Seiten a und b (siehe js/orders.js)
 * seed: Partie-Seed, turn: Nummer der Runde (muss state.turn sein)
 * env: optional { map, phases }. map = geladene Karte fuer Gelaende-Abfragen, phases = eigene Phasenliste (Tests)
 * Liefert { state, log, finished }.
 */
export function resolveTurn(state, ordersA, ordersB, seed, turn, env = {}) {
  if (state.result) throw new Error('Die Partie ist bereits beendet');
  if (turn !== state.turn) throw new Error(`Runde ${turn} passt nicht zum Zustand (Runde ${state.turn})`);

  const draft = structuredClone(state);
  const kind = draft.turnKind;
  const log = [];

  const a = normalizeOrders(draft, 'a', ordersA, env);
  const b = normalizeOrders(draft, 'b', ordersB, env);
  log.push(...a.events, ...b.events);
  const orders = { a: a.orders, b: b.orders };
  const all = [...a.orders, ...b.orders].sort((p, q) => compareId(p.group, q.group));
  const byGroup = new Map(all.map((o) => [o.group, o]));

  for (const phase of phasesFor(kind, env.phases)) {
    const ctx = {
      kind,
      turn,
      seed,
      env,
      map: env.map ?? null,
      state: draft,
      orders,
      allOrders: all,
      log,
      rng: rngForPhase(seed, turn, phase.id),
      phase: phase.id,
      orderFor: (groupId) => byGroup.get(groupId) ?? null,
      ordersOfType: (type) => all.filter((o) => o.type === type),
      groups: (side = null) => groupsOf(draft, side),
      group: (id) => getGroup(draft, id),
      emit: (type, fields) => {
        const e = makeEvent({ phase: phase.id, type, ...fields });
        log.push(e);
        return e;
      },
      finish: (result) => {
        if (!draft.result) draft.result = { winner: result.winner ?? null, reason: result.reason, turn };
      },
    };
    try {
      phase.run(ctx);
    } catch (err) {
      err.message = `Phase ${phase.id}: ${err.message}`;
      throw err;
    }
  }

  draft.turn = turn + 1;
  return { state: draft, log, finished: draft.result !== null };
}
