// Bausteine fuer Missionsziele (P16 ff.). Rein: kein DOM, kein Date, kein Math.random, immer nach ID sortiert.
// Ein Missionsziel liest den Spielzustand, das Rundenarchiv und die Grundkarte und sagt, wie weit es ist.
import { applyCellState, cellAt } from '../map.js';
import { compareId } from '../state.js';

const key = (x, y) => x + ',' + y;

/** Kartenseite einer Spielseite */
export const mapSideOf = (side) => (side === 'a' ? 'own' : 'enemy');

/** Gespielte Stellungsrunden (Gefechtsrunden zaehlen nicht, sie dauern nur Minuten) */
export function positionRounds(rounds) {
  return (rounds ?? []).filter((r) => r.kind === 'position').length;
}

/**
 * Nummer der laufenden Stellungsrunde aus der Uhr: 1 ist die erste, jede Stellungsrunde dauert 12 Stunden.
 * Gefechtsrunden dauern Minuten und bleiben in der Stellungsrunde, an deren Ende sie begonnen haben.
 */
export function halfDay(state, startHour = 6, startDay = 1) {
  const c = state.clock ?? { day: startDay, hour: startHour };
  const h = (c.day - startDay) * 24 + c.hour - startHour;
  return Math.floor(h / 12) + 1;
}

/** Karte mit dem Feldzustand (Graeben, die gegraben, genommen oder zugeschuettet wurden) */
export function liveMap(map, state) {
  return applyCellState(map, state.cells ?? {});
}

/** Feuerrichtungen, die nach vorn schauen (Kaldern: Osten) */
const FORWARD = { a: new Set(['E', 'NE', 'SE']), b: new Set(['W', 'NW', 'SW']) };

/**
 * Durchgehende Linie: verbundene Feuergraben-Felder der Seite (Nachbarn auch schraeg) mit mindestens minLevel, die
 * jede Reihe von y0 bis y1 erreichen. Liefert { done, rows, need, missing: [y], best } (best: Felder der groessten Kette).
 * forward: nur Felder, deren Auftritt nach vorn zeigt, zaehlen.
 */
export function lineStatus(map, state, side, { y0, y1, minLevel = 2, forward = true, xMin = 0, xMax = Infinity }) {
  const live = liveMap(map, state);
  const ms = mapSideOf(side);
  const ok = new Set();
  for (let y = y0; y <= y1; y++) {
    for (let x = Math.max(0, xMin); x <= Math.min(map.width - 1, xMax); x++) {
      const t = cellAt(live, x, y)?.trench;
      if (!t || t.side !== ms || t.kind !== 'fire' || (t.level ?? 0) < minLevel) continue;
      if (forward && t.facing && !FORWARD[side].has(t.facing)) continue;
      ok.add(key(x, y));
    }
  }
  // Ketten finden (feste Reihenfolge: nach y, dann x)
  const cells = [...ok].map((k) => k.split(',').map(Number)).sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  const seen = new Set();
  let best = { rows: new Set(), size: 0 };
  for (const [sx, sy] of cells) {
    if (seen.has(key(sx, sy))) continue;
    const rows = new Set();
    let size = 0;
    const stack = [[sx, sy]];
    seen.add(key(sx, sy));
    while (stack.length) {
      const [x, y] = stack.pop();
      rows.add(y);
      size++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const k = key(x + dx, y + dy);
        if ((dx || dy) && ok.has(k) && !seen.has(k)) { seen.add(k); stack.push([x + dx, y + dy]); }
      }
    }
    if (rows.size > best.rows.size || (rows.size === best.rows.size && size > best.size)) best = { rows, size };
  }
  const need = y1 - y0 + 1;
  const missing = [];
  for (let y = y0; y <= y1; y++) if (!best.rows.has(y)) missing.push(y);
  return { done: missing.length === 0, rows: best.rows.size, need, missing, best: best.size };
}

/** Grabenfelder auf der eigenen Kartenhaelfte, die jetzt der Gegenseite gehoeren */
export function trenchesLost(map, state, side) {
  const ms = mapSideOf(side);
  const out = [];
  for (const k of Object.keys(state.cells ?? {}).sort(compareId)) {
    const t = state.cells[k].trench;
    if (!t || t.side === ms) continue;
    const [x, y] = k.split(',').map(Number);
    const c = cellAt(map, x, y);
    if (c && c.side === ms) out.push({ x, y });
  }
  return out;
}

/** Felder einer Liste, die ein Graben der Seite sind */
export function heldCells(map, state, side, cells) {
  const live = liveMap(map, state);
  const ms = mapSideOf(side);
  return cells.filter((p) => cellAt(live, p.x, p.y)?.trench?.side === ms);
}

/** Lebende Gruppen der Seite auf (oder hoechstens r Felder neben) einem der Felder */
export function groupsAt(state, side, cells, r = 0) {
  return state.groups
    .filter((g) => g.side === side && g.status !== 'lost' && g.status !== 'rest')
    .filter((g) => cells.some((p) => Math.max(Math.abs(p.x - g.pos.x), Math.abs(p.y - g.pos.y)) <= r))
    .sort((p, q) => compareId(p.id, q.id));
}

/** Ereignisse der Seite (eigene oder ohne Seite) aus dem Archiv */
export function eventsOf(rounds, side, type) {
  const out = [];
  for (const r of rounds ?? []) for (const e of r.log ?? []) if (e.type === type && (!e.side || e.side === side)) out.push(e);
  return out;
}

/** Ist eine Figur (Gruppenfuehrer mit diesem Namen) gefallen? Stirbt sie mit der Gruppe oder als Fuehrer. */
export function figureFallen(state, rounds, name) {
  for (const r of rounds ?? []) for (const e of r.log ?? []) {
    if (e.type === 'leader_fallen' && e.fallen === name) return true;
  }
  return (state.fallen ?? []).some((f) => f.name === name)
    || state.groups.some((g) => g.status === 'lost' && g.leader?.name === name);
}
