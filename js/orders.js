// Befehle (Plan 3.3, 3.4, 10.6). Format, Pruefung, Standardbefehl Halten, Sortierung nach Gruppen-ID.
// Rein: kein DOM, kein Date, kein Math.random.
//
// Befehlsformat (reines JSON):
//   { group: 'a03', type: 'dig', target?: {x,y}, path?: [{x,y}, ...], ...weitere Felder je Befehlsart }
// target/path je nach ORDER_TYPES[type].target. Unbekannte Zusatzfelder bleiben erhalten (fuer Mechanik-Pakete).
import { ORDER_TYPES } from './config/orders.js';
import { compareId, getGroup, groupsOf, inBounds } from './state.js';
import { makeEvent } from './events.js';

const validators = new Map();

/**
 * Zusaetzliche Pruefung fuer eine Befehlsart anmelden (z. B. P04: Graben nur auf grabbarem Boden).
 * fn(order, group, state, env, side) -> null wenn gueltig, sonst deutscher Grund als Text.
 * Bei Seitenbefehlen (scope 'side') ist group null.
 */
export function registerOrderValidator(type, fn) {
  if (!Object.hasOwn(ORDER_TYPES, type)) throw new Error('Unbekannte Befehlsart: ' + type);
  if (!validators.has(type)) validators.set(type, []);
  validators.get(type).push(fn);
}

/** Pruefung wieder abmelden (Tests) */
export function unregisterOrderValidator(type, fn) {
  const list = validators.get(type);
  if (list) validators.set(type, list.filter((f) => f !== fn));
}

export function holdOrder(groupId, implicit = false) {
  return implicit ? { group: groupId, type: 'hold', implicit: true } : { group: groupId, type: 'hold' };
}

/** Befehle nach Gruppen-ID sortieren (stabil, ohne Locale) */
export function sortOrders(orders) {
  return [...orders].sort((p, q) => compareId(p.group, q.group));
}

/**
 * Einzelnen Befehl pruefen. Liefert null (gueltig) oder einen deutschen Grund.
 */
export function validateOrder(order, state, side, env = {}) {
  if (!order || typeof order !== 'object') return 'Befehl ist kein Objekt';
  if (isSideOrder(order)) return validateSideOrder(order, state, side, env);
  if (typeof order.group !== 'string') return 'Befehl ohne Gruppe';
  const g = getGroup(state, order.group);
  if (!g) return `Gruppe ${order.group} gibt es nicht`;
  if (g.side !== side) return `Gruppe ${order.group} gehört nicht zur eigenen Seite`;
  if (g.status === 'lost') return `Gruppe ${order.group} ist aufgerieben`;
  const t = Object.hasOwn(ORDER_TYPES, order.type) ? ORDER_TYPES[order.type] : null;
  if (!t) return `unbekannter Befehl "${order.type}"`;
  if (t.kind !== 'both' && t.kind !== state.turnKind) {
    return state.turnKind === 'battle'
      ? `${t.label} geht nur in einer Stellungsrunde`
      : `${t.label} geht nur in einer Gefechtsrunde`;
  }
  if (t.night && !state.night) return `${t.label} geht nur nachts`;
  if (t.target === 'cell' && !inBounds(state.map, order.target)) return `${t.label} braucht ein Zielfeld auf der Karte`;
  if (t.target === 'path') {
    if (!Array.isArray(order.path) || order.path.length === 0) return `${t.label} braucht einen Weg`;
    if (order.path.length > state.map.width * state.map.height) return `${t.label}: Weg ist zu lang`;
    for (const p of order.path) if (!inBounds(state.map, p)) return `${t.label}: Weg führt aus der Karte`;
  }
  for (const fn of validators.get(order.type) ?? []) {
    let why;
    try {
      why = fn(order, g, state, env, side);
    } catch (err) {
      why = 'Prüfung fehlgeschlagen: ' + err.message;
    }
    if (why) return why;
  }
  return null;
}

/** Befehl der ganzen Seite (ohne Gruppe), z. B. Lorenplan */
export function isSideOrder(order) {
  return !!order && Object.hasOwn(ORDER_TYPES, order.type) && ORDER_TYPES[order.type].scope === 'side';
}

function validateSideOrder(order, state, side, env) {
  const t = ORDER_TYPES[order.type];
  if (t.kind !== 'both' && t.kind !== state.turnKind) {
    return state.turnKind === 'battle' ? `${t.label} geht nur in einer Stellungsrunde` : `${t.label} geht nur in einer Gefechtsrunde`;
  }
  for (const fn of validators.get(order.type) ?? []) {
    let why;
    try { why = fn(order, null, state, env, side); } catch (err) { why = 'Prüfung fehlgeschlagen: ' + err.message; }
    if (why) return why;
  }
  return null;
}

/**
 * Befehlsliste einer Seite fuer die Aufloesung aufbereiten:
 * - ungueltige Befehle werden zu Halten, mit Ereignis und Begruendung
 * - doppelte Befehle fuer dieselbe Gruppe: der erste gueltige gilt, weitere werden verworfen
 * - einsatzfaehige Gruppen ohne Befehl bekommen Halten (implicit: true)
 * - Ergebnis nach Gruppen-ID sortiert
 * - Seitenbefehle (scope 'side') stehen getrennt in plans[type]; der erste gueltige je Art gilt
 * Liefert { orders, events, plans }.
 */
export function normalizeOrders(state, side, orders, env = {}) {
  const list = Array.isArray(orders) ? orders : [];
  const byGroup = new Map();
  const events = [];
  const reject = (order, why, g) => {
    const at = g?.pos ?? { x: 0, y: 0 };
    events.push(makeEvent({
      phase: 'orders', type: 'order_invalid', side, secret: true, group: g?.id ?? null, order: order?.type ?? null,
      reason: g ? `Befehl für ${g.leader.name} nicht ausführbar: ${why}. Gruppe hält.` : `Befehl verworfen: ${why}`,
      at,
    }));
  };

  // Eingang stabil nach Gruppe sortieren, damit "der erste gilt" nicht von der Klickreihenfolge im UI abhaengt,
  // sondern von der Reihenfolge innerhalb derselben Gruppe (stabile Sortierung).
  const sorted = list
    .map((o, i) => ({ o, i }))
    .sort((p, q) => compareId(String(p.o?.group ?? ''), String(q.o?.group ?? '')) || p.i - q.i)
    .map((e) => e.o);

  const plans = {};
  for (const order of sorted) {
    if (isSideOrder(order)) {
      const why = plans[order.type] ? 'es gibt schon einen ' + ORDER_TYPES[order.type].label : validateOrder(order, state, side, env);
      if (why) reject(order, why, null);
      else plans[order.type] = structuredClone(order);
      continue;
    }
    const why = validateOrder(order, state, side, env);
    const g = order && typeof order.group === 'string' ? getGroup(state, order.group) : null;
    const own = g && g.side === side && g.status !== 'lost';
    if (own && byGroup.has(g.id) && !byGroup.get(g.id).replaced) {
      reject(order, 'die Gruppe hat schon einen Befehl', g);
      continue;
    }
    if (why) {
      reject(order, why, own ? g : null);
      if (own && !byGroup.has(g.id)) byGroup.set(g.id, { ...holdOrder(g.id), replaced: String(order.type ?? '') });
      continue;
    }
    byGroup.set(g.id, structuredClone(order));
  }

  for (const g of groupsOf(state, side)) {
    if (!byGroup.has(g.id)) byGroup.set(g.id, holdOrder(g.id, true));
  }
  return { orders: sortOrders([...byGroup.values()]), events, plans };
}
