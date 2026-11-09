// Waffenruhe zum Bergen und Verwundete im Niemandsland (Plan 4.2 Nr. 21, Paket P24). Rein: kein DOM, kein Date.
// Die Phasen stehen in js/phases/truce.js.
//
// Zustand: state.sides[s].truce (beide Seiten tragen dieselbe Kopie, damit jede Sicht sie hat) =
//   { status: 'offered'|'active'|'tolerated'|'over'|'declined'|'broken'|'abused', by, turn, until?, brokenBy?, abusedBy? }
//   offered   eine Seite hat angeboten (Laterne unter der weissen Fahne), die andere antwortet in der naechsten
//             Stellungsrunde mit dem Seitenbefehl { type: 'truce', answer: 'accept' | 'decline' }
//   active    bis Runde until: niemand schiesst, beide Seiten bergen alle Verwundeten draussen
//   tolerated geduldet, nichts abgesprochen (a3m5 "Nichts befehlen"): Sanitaeter gehen, ein nervoeser Posten
//             schiesst vielleicht
// Verwundete draussen: state.cells[k].lying = { a: n, b: m }. Wer im Niemandsland getroffen wird, bleibt dort
// liegen (nur mit features: ['truce']). Sanitaeter bergen mit dem Befehl recover (Ziel: ein Feld mit Verwundeten).
import { TRUCE } from './config/akt3.js';
import { cellAt, cellLabel, distance } from './map.js';
import { featureOn } from './underground.js';

export const BREAK_ORDERS = new Set(['fire', 'attack', 'raid', 'harass', 'gas', 'flame', 'assault', 'shift_fire']);
export const ABUSE_ORDERS = new Set(['wire', 'sap', 'dig', 'move', 'redeploy']);

export function truceOf(state) {
  return state?.sides?.a?.truce ?? state?.sides?.b?.truce ?? null;
}

/** Waffenruhe aus einer Sicht (view.own.truce) oder dem Zustand */
export function truceInView(view) {
  return view?.own?.truce ?? null;
}

export function setTruce(state, t) {
  for (const s of ['a', 'b']) {
    if (!state.sides[s]) continue;
    if (t) state.sides[s].truce = structuredClone(t);
    else delete state.sides[s].truce;
  }
}

/** Gilt gerade eine Waffenruhe (abgesprochen)? */
export function truceActive(state, turn = state?.turn) {
  const t = truceOf(state);
  return !!t && t.status === 'active' && (t.until ?? 0) >= turn;
}

/** Geduldet (nichts abgesprochen, aber die Sanitaeter gehen)? */
export function truceTolerated(state, turn = state?.turn) {
  const t = truceOf(state);
  return !!t && t.status === 'tolerated' && (t.until ?? 0) >= turn;
}

/** Verwundete draussen: [{ x, y, a, b }] sortiert */
export function lyingCells(state) {
  const out = [];
  for (const k of Object.keys(state?.cells ?? {})) {
    const l = state.cells[k]?.lying;
    if (!l || (!(l.a > 0) && !(l.b > 0))) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y, a: l.a | 0, b: l.b | 0 });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

export function lyingCount(state, side) {
  return lyingCells(state).reduce((n, c) => n + (c[side] | 0), 0);
}

/** Verwundete einer Seite auf ein Feld legen (Entwurfszustand) */
export function addLying(state, p, side, n) {
  if (!(n > 0)) return;
  const k = p.x + ',' + p.y;
  const c = state.cells[k] ?? {};
  const l = { a: 0, b: 0, ...(c.lying ?? {}) };
  l[side] = (l[side] | 0) + n;
  state.cells[k] = { ...c, lying: l };
}

/** Verwundete einer Seite von einem Feld nehmen, liefert die Zahl */
export function takeLying(state, p, side, n) {
  const k = p.x + ',' + p.y;
  const c = state.cells[k];
  if (!c?.lying) return 0;
  const take = Math.max(0, Math.min(c.lying[side] | 0, n));
  const l = { ...c.lying, [side]: (c.lying[side] | 0) - take };
  if (!(l.a > 0) && !(l.b > 0)) {
    const { lying, ...rest } = c;
    if (Object.keys(rest).length) state.cells[k] = rest; else delete state.cells[k];
  } else state.cells[k] = { ...c, lying: l };
  return take;
}

/** Liegt das Feld im Niemandsland (oder auf der Gegenseite)? */
export function outsideCell(map, side, p) {
  const c = map ? cellAt(map, p.x, p.y) : null;
  if (!c) return false;
  return c.zone === 'niemandsland' || (c.side != null && c.side !== (side === 'a' ? 'own' : 'enemy'));
}

/** Warum kann die Gruppe hier nicht bergen? null = geht */
export function recoverProblem(state, map, group, target) {
  if (!featureOn(state, 'truce')) return 'Bergen draußen gibt es erst in Akt 3';
  if (group.type !== 'medics') return 'Bergen draußen können nur Sanitäter';
  if (group.inDugout) return 'Gruppe sitzt im Unterstand';
  if (!target) return 'Bergen braucht ein Feld mit Verwundeten';
  if (distance(group.pos, target) > TRUCE.recoverReach) return `zu weit (höchstens ${TRUCE.recoverReach} Felder)`;
  const l = state.cells?.[target.x + ',' + target.y]?.lying;
  if (!l || !(l[group.side] > 0)) return `bei ${cellLabel(target.x, target.y)} liegt niemand von uns`;
  return null;
}

/** Warum kann die Seite das nicht antworten oder anbieten? null = geht */
export function truceProblem(state, side, order) {
  if (!featureOn(state, 'truce')) return 'Waffenruhe gibt es erst in Akt 3';
  const t = truceOf(state);
  const a = order?.answer;
  if (a === 'none') return null; // Antwort zurueckgenommen: nichts zu tun
  if (a === 'offer') {
    if (t && (t.status === 'offered' || t.status === 'active' || t.status === 'tolerated')) return 'es gilt schon eine Waffenruhe oder ein Angebot';
    if (state.sides[side]?.truceOffered) return 'diese Seite hat schon einmal angeboten';
    return null;
  }
  if (a === 'accept' || a === 'decline') {
    if (!t || t.status !== 'offered') return 'es liegt kein Angebot vor';
    if (t.by === side) return 'das eigene Angebot kann man nicht annehmen';
    return null;
  }
  return 'Waffenruhe: annehmen, ablehnen oder anbieten';
}

/** Bricht dieser Befehl eine Waffenruhe? */
export function breaksTruce(order) {
  if (!order) return false;
  if (BREAK_ORDERS.has(order.type)) return true;
  if (order.type === 'gas_shell') return true;
  if (order.type === 'fire_plan') return (order.plans ?? []).some((p) => p.kind === 'harass' || p.kind === 'counter');
  return false;
}

/**
 * Haelt sich ein Kommandant (KI) an die Waffenruhe? true = diesen Befehl nicht geben. Gilt, solange die
 * Waffenruhe laeuft oder in dieser Stellungsrunde ein Angebot der Gegenseite beantwortet wird; Arbeiten draussen auch.
 */
export function truceVeto(view, order, map, side) {
  const t = view?.own?.truce ?? null;
  if (!t || !order) return false;
  const quiet = (t.status === 'active' && (t.until ?? 0) >= (view.turn ?? 0)) || (t.status === 'offered' && t.by !== side && view.turnKind !== 'battle');
  if (!quiet) return false;
  if (breaksTruce(order)) return true;
  if (!ABUSE_ORDERS.has(order.type)) return false;
  const cells = [...(order.path ?? []), ...(order.target ? [order.target] : [])];
  return cells.some((p) => outsideCell(map, side, p));
}
