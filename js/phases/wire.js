// Stacheldraht verlegen (Plan 3.3 Stellungsrunde "Draht", 4.1 Nr. 4). Rein: kein DOM, kein Date, kein Math.random.
// Befehl { group, type: 'wire', path: [{x,y}, ...] }: eine Linie Draht vor der eigenen Stellung oder im Niemandsland.
// - Je Stellungsrunde schafft eine Gruppe WIRE_RATE Felder, Pioniere doppelt so viele. Nachts geht es schneller,
//   weil niemand auf die Arbeitstrupps schiesst (Plan 4.1: Draht wird nachts verlegt).
// - Jedes Feld kostet 1 Material aus dem Depot der Seite.
// - Die Gruppe bleibt in ihrem Graben (die Arbeitstrupps kriechen hinaus und kommen zurueck).
// - Draht liegt in state.cells[k].wire = { side, laid }. Er verlangsamt Angreifer (move.js), Pioniere und
//   Artillerie zerstoeren ihn (wire = null).
// - Der Rest der Linie laeuft als Befehl weiter (carry).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, cellLabel, distance, enterCost } from '../map.js';
import { unitType } from '../config/units.js';
import { surname } from './hold.js';
import { liveCell, mapSideOf } from './move.js';

/** Felder je Stellungsrunde (Schuetzen); Pioniere doppelt, nachts +50 Prozent */
export const WIRE_RATE = 3;
export const MAX_WIRE_CELLS = 12;
/** So weit darf der Anfang der Linie von der Gruppe weg sein */
export const WIRE_REACH = 3;
export const WIRE_MATERIAL = 1;
export const WIRE_LAYERS = new Set(['rifles', 'pioneers', 'stormtroops']);

/** Felder je Runde fuer eine Gruppe */
export function wireRate(group, night) {
  let r = WIRE_RATE * (group.type === 'pioneers' ? 2 : 1);
  if (night) r = r + Math.floor(r / 2);
  return Math.max(1, Math.floor((r * Math.max(1, group.strength)) / Math.max(1, group.size || group.strength)));
}

/** Warum kann hier kein Draht liegen? null = geht */
export function wireBlocker(cell, side, { ignoreWire = false } = {}) {
  if (!cell) return 'außerhalb der Karte';
  if (!Number.isFinite(enterCost(cell))) return 'nicht begehbar';
  if (cell.building) return 'Gebäude';
  if (cell.trench) return 'im Graben liegt kein Draht';
  if (cell.wire && !ignoreWire) return 'dort liegt schon Draht';
  if (cell.zone !== 'niemandsland' && cell.side !== mapSideOf(side)) return 'hinter der feindlichen Linie';
  if (cell.zone === 'etappe') return 'in der Etappe braucht es keinen Draht';
  return null;
}

function checkWire(order, group, state, env) {
  if (!WIRE_LAYERS.has(group.type)) return `${unitType(group.type).name} verlegt keinen Draht`;
  const path = order.path;
  if (path.length > MAX_WIRE_CELLS) return `höchstens ${MAX_WIRE_CELLS} Felder auf einmal`;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const k = p.x + ',' + p.y;
    if (seen.has(k)) return `Feld ${cellLabel(p.x, p.y)} doppelt`;
    seen.add(k);
    if (i && Math.max(Math.abs(p.x - path[i - 1].x), Math.abs(p.y - path[i - 1].y)) !== 1) return `Linie springt bei Feld ${cellLabel(p.x, p.y)}`;
  }
  if (!env.map) return null;
  const near = order.carried ? Math.min(...path.map((p) => distance(group.pos, p))) : distance(group.pos, path[0]);
  if (near > (order.carried ? MAX_WIRE_CELLS : WIRE_REACH)) return `Draht beginnt zu weit von der Gruppe (Feld ${cellLabel(path[0].x, path[0].y)})`;
  for (const p of path) {
    const why = wireBlocker(liveCell(env.map, state, p.x, p.y), group.side, { ignoreWire: true });
    if (why) return `Feld ${cellLabel(p.x, p.y)}: ${why}`;
  }
  return null;
}

registerOrderValidator('wire', checkWire);

function runWire(ctx) {
  const { state, map } = ctx;
  for (const o of ctx.ordersOfType('wire')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const sup = state.sides[g.side].supplies;
    let budget = wireRate(g, state.night);
    const laid = [];
    let noMaterial = false;
    let i = 0;
    for (; i < o.path.length && budget > 0; i++) {
      const p = o.path[i];
      const cell = map ? liveCell(map, state, p.x, p.y) : { wire: state.cells[p.x + ',' + p.y]?.wire ?? null };
      if (cell?.wire) continue; // liegt schon (z. B. von einer Nachbargruppe)
      if (map && wireBlocker(cell, g.side)) continue;
      if ((sup.material ?? 0) < WIRE_MATERIAL) { noMaterial = true; break; }
      sup.material -= WIRE_MATERIAL;
      const k = p.x + ',' + p.y;
      state.cells[k] = { ...(state.cells[k] ?? {}), wire: { side: mapSideOf(g.side), laid: ctx.turn } };
      laid.push(p);
      budget--;
    }
    const rest = o.path.slice(i).map((p) => ({ x: p.x, y: p.y }));
    const name = 'Gruppe ' + surname(g.leader.name);
    const span = laid.length
      ? (laid.length === 1 ? cellLabel(laid[0].x, laid[0].y) : `${cellLabel(laid[0].x, laid[0].y)} bis ${cellLabel(laid[laid.length - 1].x, laid[laid.length - 1].y)}`)
      : '';
    let reason;
    if (!laid.length && noMaterial) reason = `${name} kann keinen Draht ziehen: im Depot fehlt Material.`;
    else if (!laid.length) reason = `${name}: der Draht liegt schon.`;
    else if (rest.length) reason = `${name} zieht ${laid.length} Felder Draht (${span})${state.night ? ' im Dunkeln' : ''}. Noch ${rest.length} offen${noMaterial ? ', das Material ist alle' : ''}.`;
    else reason = `${name} hat den Draht gezogen: ${laid.length} ${laid.length === 1 ? 'Feld' : 'Felder'} (${span}).`;
    ctx.emit('wire', {
      side: g.side, group: g.id, secret: true, cells: laid.map((p) => ({ x: p.x, y: p.y })), rest, noMaterial: noMaterial || undefined,
      carry: rest.length && !noMaterial ? { group: g.id, type: 'wire', path: rest } : null,
      reason, at: laid.length ? { ...laid[laid.length - 1] } : { ...o.path[0] },
    });
  }
}

registerPhase({ id: 'wire', kind: 'position', order: ORDER.position.works + 2, run: runWire });
