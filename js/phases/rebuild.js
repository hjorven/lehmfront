// Umbauen (Plan 4.1 Nr. 2, 10.6 Schritt 4 "works"). Befehl:
//   { group, type: 'rebuild', path: [{x,y}, ...] (eigene Grabenfelder), facing?: ['E', ...] (Zielrichtung je Feld) }
// Ein eroberter Graben gibt nur halbe Deckung, weil der Schuetzenauftritt zum alten Besitzer zeigt. Umbauen
// dreht ihn um: eine Stellungsrunde je drei Felder fuer eine volle Schuetzengruppe, Pioniere doppelt so schnell
// (dasselbe Budget und dieselben Faktoren wie beim Graben). Ohne facing zeigt der Auftritt danach in die
// Gegenrichtung. Auch ein eigener, nie eroberter Graben laesst sich so umdrehen (Feuerrichtung aendern).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, cellLabel, distance, DIR } from '../map.js';
import { mapSideOf, oppositeDir } from '../trench.js';
import { digRate, DIG_REACH, MAX_DIG_CELLS } from './dig.js';
import { surname } from './hold.js';

/** Arbeit je Feld: 100 Budget schaffen drei Felder */
export const REBUILD_WORK = 33;

/** Grabenfeld mit Zustand (rein) */
function trenchAt(state, map, p) {
  const k = p.x + ',' + p.y;
  const o = state.cells[k];
  if (o && Object.hasOwn(o, 'trench')) return o.trench;
  return cellAt(map, p.x, p.y)?.trench ?? null;
}

/** Runden fuer eine Umbau-Linie (Oberflaeche): { rounds, rate, cost } */
export function rebuildEstimate(map, state, group, cells) {
  const { rate } = digRate(state, group, map);
  let cost = 0;
  for (const p of cells) cost += REBUILD_WORK - Math.min(REBUILD_WORK, state.cells[p.x + ',' + p.y]?.rebuild?.work ?? 0);
  const rounds = cost === 0 ? 0 : rate > 0 ? Math.floor((cost + rate - 1) / rate) : Infinity;
  return { rounds, rate, cost };
}

function checkRebuild(order, group, state, env) {
  const path = order.path;
  if (path.length > MAX_DIG_CELLS) return `höchstens ${MAX_DIG_CELLS} Felder auf einmal`;
  if (order.facing !== undefined && (!Array.isArray(order.facing) || order.facing.length !== path.length || order.facing.some((f) => !DIR[f]))) {
    return 'Feuerrichtung passt nicht zur Linie';
  }
  const seen = new Set();
  for (const p of path) {
    const k = p.x + ',' + p.y;
    if (seen.has(k)) return `Feld ${cellLabel(p.x, p.y)} doppelt`;
    seen.add(k);
  }
  if (!env.map) return null;
  if (distance(group.pos, path[0]) > DIG_REACH) return `Umbau beginnt zu weit von der Gruppe (Feld ${cellLabel(path[0].x, path[0].y)})`;
  for (const p of path) {
    const t = trenchAt(state, env.map, p);
    if (!t) return `Feld ${cellLabel(p.x, p.y)}: dort ist kein Graben`;
    if (t.side !== mapSideOf(group.side)) return `Feld ${cellLabel(p.x, p.y)}: Graben gehört dem Gegner`;
  }
  return null;
}

registerOrderValidator('rebuild', checkRebuild);

function runRebuild(ctx) {
  const { state, map } = ctx;
  if (!map) return;
  for (const o of ctx.ordersOfType('rebuild')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const ms = mapSideOf(g.side);
    let budget = digRate(state, g, map).rate;
    let turned = 0, captured = 0, last = null, lost = 0;
    let i = 0;
    for (; i < o.path.length && budget > 0; i++) {
      const p = o.path[i];
      const k = p.x + ',' + p.y;
      const t = trenchAt(state, map, p);
      if (!t || t.side !== ms) { lost++; continue; } // inzwischen verloren: ueberspringen
      const have = state.cells[k]?.rebuild?.work ?? 0;
      const need = REBUILD_WORK - have;
      const spend = Math.min(need, budget);
      budget -= spend;
      if (spend < need) {
        state.cells[k] = { ...(state.cells[k] ?? {}), rebuild: { work: have + spend } };
        last = p;
        break;
      }
      const facing = o.facing?.[i] ?? oppositeDir(t.facing);
      if (t.captured) captured++;
      const cell = { ...(state.cells[k] ?? {}) };
      delete cell.rebuild;
      cell.trench = { ...t, facing };
      delete cell.trench.captured;
      state.cells[k] = cell;
      turned++;
      last = p;
    }
    const rest = o.path.slice(i).filter((p) => {
      const t = trenchAt(state, map, p);
      return t && t.side === ms;
    }).map((p) => ({ x: p.x, y: p.y }));
    // Ein angefangenes Feld (break oben) gehoert zum Rest; i zeigt darauf
    const name = 'Gruppe ' + surname(g.leader.name);
    const n = (k) => `${k} ${k === 1 ? 'Feld' : 'Felder'}`;
    let reason;
    if (!turned && !rest.length) reason = `${name}: Umbau nicht möglich, der Graben ist nicht mehr in eigener Hand.`;
    else if (!turned) reason = `${name} baut bei ${cellLabel((last ?? rest[0]).x, (last ?? rest[0]).y)} den Schützenauftritt um. Noch ${n(rest.length)}.`;
    else if (rest.length) reason = `${name} dreht ${n(turned)} Graben um${captured ? ', jetzt volle Deckung zur neuen Front' : ''}. Noch ${n(rest.length)}.`;
    else reason = `${name} hat den Umbau fertig: ${n(turned)}${captured ? ' eroberter Graben geben wieder volle Deckung' : ' zeigen in die neue Richtung'}.`;
    if (lost) reason += ` ${n(lost)} sind nicht mehr in eigener Hand.`;
    const restFacing = o.facing ? o.path.map((p, j) => ({ p, f: o.facing[j] })).filter(({ p }) => rest.some((r) => r.x === p.x && r.y === p.y)).map(({ f }) => f) : undefined;
    ctx.emit('rebuild', {
      side: g.side, group: g.id, secret: true, cells: turned, captured, rest,
      carry: rest.length ? { group: g.id, type: 'rebuild', path: rest, ...(restFacing ? { facing: restFacing } : {}) } : null,
      reason, at: last ? { ...last } : { ...o.path[0] },
    });
  }
}

// Nach dem Graben (gleiche Stufe "works", Reihenfolge nach id: dig vor rebuild)
registerPhase({ id: 'rebuild', kind: 'position', order: ORDER.position.works, run: runRebuild });
