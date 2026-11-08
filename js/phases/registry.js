// Phasen-Register (Plan 10.6). Mechanik-Pakete melden hier ihre Phasen an, resolve.js fuehrt sie aus.
//
// Eine Phase: { id, kind: 'position'|'battle'|'both', order, run(ctx) }
//   order: Zahl (gilt fuer beide Rundenarten) oder { position: Zahl, battle: Zahl } bei kind 'both'.
//   Gleiche order-Zahl: Reihenfolge nach id. run(ctx) veraendert ctx.state direkt (eine Kopie, die resolve.js
//   anlegt), meldet Ereignisse mit ctx.emit(type, { reason, at, ... }) und wuerfelt nur mit ctx.rng. Neue Phase anmelden: Datei js/phases/<name>.js anlegen,
//   darin registerPhase(...) aufrufen und eine Import-Zeile in js/phases/index.js ergaenzen.
//
// Vorgegebene Reihenfolge (Plan 10.6). Abstaende von 10 lassen Platz fuer Zwischenphasen.
export const ORDER = {
  position: {
    orders: 10,      // 1 Befehle einsammeln und sortieren (macht resolve.js selbst, vor allen Phasen)
    weather: 20,     // 2 Wetter wuerfeln, Schlamm in Senken
    artillery: 30,   // 3 Stoerfeuer, Gegenbatteriefeuer, Krater, Leitungen und Gleise
    works: 40,       // 4 Graben, Umbauen, Bauen, Draht, Entwaesserung
    tunnels: 50,     // 5 Stollen vortreiben, Horchposten
    movement: 60,    // 6 Bewegung und Abloesung hinter der Front, nachts Stosstrupps
    supply: 70,      // 7 Loren fahren, Verwundete zurueck, Vorraete
    morale: 80,      // 8 Moral, Erschoepfung, Heilung, Erfahrungsberichte
    attack: 90,      // 9 Angriff angesetzt? turnKind = 'battle', Feuerplaene scharf
    clock: 100,      // Uhr weiterstellen (12 Stunden), Tag und Nacht. ctx.kind bleibt die Art der laufenden
                     //   Runde: setzt attack turnKind auf 'battle', laufen die 12 Stunden trotzdem noch ab,
                     //   das Gefecht beginnt also am Ende dieser Stellungsrunde.
  },
  battle: {
    orders: 10,      // 1 Befehle einsammeln
    artillery: 20,   // 2 aktueller Schritt jedes Feuerplans, Umlenken mit Verzoegerung
    dugout: 30,      // 3 Unterstand: hinein unter Beschuss, nach einer Runde heraus
    movement: 40,    // 4 Bewegung, Draht, Begegnungen
    fire: 50,        // 5 Feuer nach der Bewegung, Unterdrueckung
    melee: 60,       // 6 Nahkampf Feld fuer Feld
    morale: 70,      // 7 Unterdrueckung klingt ab, Moralproben
    end: 80,         // 8 Angriff zu Ende? turnKind = 'position' (ctx.state.battle auf null setzen)
    clock: 100,      // Uhr weiterstellen (5 Minuten)
  },
};

export const KINDS = ['position', 'battle'];

const phases = new Map();

function orderFor(phase, kind) {
  return typeof phase.order === 'number' ? phase.order : phase.order[kind];
}

export function registerPhase(phase) {
  const { id, kind, order, run } = phase ?? {};
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Phase braucht eine id aus a-z, 0-9, -');
  if (!['position', 'battle', 'both'].includes(kind)) throw new Error(`Phase ${id}: kind muss position, battle oder both sein`);
  if (typeof run !== 'function') throw new Error(`Phase ${id}: run(ctx) fehlt`);
  const ok = (n) => typeof n === 'number' && Number.isFinite(n);
  if (typeof order === 'object' && order !== null) {
    for (const k of kind === 'both' ? KINDS : [kind]) if (!ok(order[k])) throw new Error(`Phase ${id}: order.${k} fehlt`);
  } else if (!ok(order)) {
    throw new Error(`Phase ${id}: order muss eine Zahl sein`);
  }
  if (phases.has(id)) throw new Error(`Phase ${id} ist schon angemeldet`);
  phases.set(id, Object.freeze({ id, kind, order, run }));
  return phases.get(id);
}

/** Nur fuer Tests: Phase wieder abmelden */
export function unregisterPhase(id) {
  phases.delete(id);
}

/** Phasen einer Rundenart in Ausfuehrungsreihenfolge: nach order, dann id */
export function phasesFor(kind, list = [...phases.values()]) {
  return list
    .filter((p) => p.kind === kind || p.kind === 'both')
    .map((p) => ({ p, n: orderFor(p, kind) }))
    .sort((a, b) => a.n - b.n || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
    .map((e) => e.p);
}

export function phaseOrder(phase, kind) {
  return orderFor(phase, kind);
}
