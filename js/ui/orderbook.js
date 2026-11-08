// Befehlsbuch der Planungsphase (Plan 7.3): Befehle pro Seite, frei aenderbar bis zum Commit, mit Undo.
// Rein und unveraenderlich: jede Funktion liefert ein neues Buch, das alte bleibt gueltig (einfaches Undo, Tests).
// Ein Buch: { a: { orders: { [groupId]: order }, history: [{ group, prev }] , sealed }, b: {...} }
import { compareId } from '../state.js';

export const HISTORY_LIMIT = 200;

function emptySide() {
  return { orders: {}, history: [], sealed: false };
}

export function createOrderBook(sides = ['a', 'b']) {
  const book = {};
  for (const s of sides) book[s] = emptySide();
  return book;
}

function withSide(book, side, fn) {
  const cur = book[side] ?? emptySide();
  return { ...book, [side]: fn(cur) };
}

function pushHistory(history, entry) {
  const h = [...history, entry];
  return h.length > HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT) : h;
}

/** Befehl der Gruppe (oder null fuer "ohne Befehl", haelt implizit) */
export function orderOf(book, side, groupId) {
  return book[side]?.orders[groupId] ?? null;
}

/** Befehl setzen oder ersetzen. Gleicher Befehl wie vorher: Buch bleibt unveraendert. */
export function setOrder(book, side, order) {
  if (book[side]?.sealed) return book;
  const prev = orderOf(book, side, order.group);
  if (prev && JSON.stringify(prev) === JSON.stringify(order)) return book;
  return withSide(book, side, (s) => ({
    ...s,
    orders: { ...s.orders, [order.group]: structuredClone(order) },
    history: pushHistory(s.history, { group: order.group, prev }),
  }));
}

/** Befehl entfernen (Gruppe haelt dann wieder als Standard) */
export function clearOrder(book, side, groupId) {
  const prev = orderOf(book, side, groupId);
  if (!prev || book[side]?.sealed) return book;
  return withSide(book, side, (s) => {
    const orders = { ...s.orders };
    delete orders[groupId];
    return { ...s, orders, history: pushHistory(s.history, { group: groupId, prev }) };
  });
}

/** Letzte Aenderung zuruecknehmen. Liefert { book, group } (group = betroffene Gruppe oder null). */
export function undo(book, side) {
  const s = book[side];
  if (!s || s.sealed || !s.history.length) return { book, group: null };
  const last = s.history[s.history.length - 1];
  const orders = { ...s.orders };
  if (last.prev) orders[last.group] = last.prev;
  else delete orders[last.group];
  return { book: { ...book, [side]: { ...s, orders, history: s.history.slice(0, -1) } }, group: last.group };
}

export function canUndo(book, side) {
  return !!book[side] && !book[side].sealed && book[side].history.length > 0;
}

/** Alle gesetzten Befehle einer Seite, nach Gruppen-ID sortiert */
export function listOrders(book, side) {
  const o = book[side]?.orders ?? {};
  return Object.keys(o).sort(compareId).map((k) => o[k]);
}

/** Befehle versiegeln (Commit einer Seite). Danach nicht mehr aenderbar. */
export function seal(book, side) {
  return withSide(book, side, (s) => ({ ...s, sealed: true }));
}

/** Neue Runde: Buch leeren, Vorgaben (z. B. weiterlaufende Wege) uebernehmen */
export function nextRound(book, carry = {}) {
  const out = {};
  for (const side of Object.keys(book)) {
    const orders = {};
    for (const o of carry[side] ?? []) orders[o.group] = structuredClone(o);
    out[side] = { orders, history: [], sealed: false };
  }
  return out;
}
