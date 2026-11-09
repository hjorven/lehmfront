// Bewegung (Plan 3.3, 10.6): "Bewegen" in Gefechtsrunden, "Verlegen" in Stellungsrunden.
// Erste Fassung aus P03, damit der Gefechtsbildschirm eine spielbare Runde hat. P06 erweitert sie
// (Draht, Begegnungen, Sturm). Ein Befehl traegt den Weg ohne Startfeld: path = [{x,y}, ...].
// Regeln:
// - Budget je Runde: Gefecht speed * 10 Zehntel (Plan 5: Felder je Gefechtsrunde),
//   Stellung speed * 40 (zwoelf Stunden, aber Tragen, Gedraenge und Laufgraeben).
// - Kosten je Feld wie A* (map.enterCost), diagonal 14/10. Ein Feld schafft jede Gruppe immer.
// - Alle gehen gleichzeitig Feld fuer Feld; ein Feld, das am Ende noch besetzt ist, haelt die Gruppe davor an.
//   Tauschen zwei Gruppen die Plaetze, bleiben beide stehen.
// - Verlegen bleibt hinter der eigenen Linie: kein Niemandsland, keine fremde Zone.
// - Was nicht geschafft wird, steht im Ereignis als rest; die Oberflaeche traegt es als Befehl weiter.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, enterCost, cellLabel } from '../map.js';
import { unitType } from '../config/units.js';
import { surname } from './hold.js';

export const BATTLE_FACTOR = 10;
export const POSITION_FACTOR = 40;

/** Bewegungsbudget einer Gruppe in Zehnteln */
export function moveBudget(group, kind) {
  const full = unitType(group.type).speed * (kind === 'battle' ? BATTLE_FACTOR : POSITION_FACTOR);
  // Niedergehalten (P05, sight.PINNED): nur noch halb so weit, die Gruppe kriecht
  return (group.suppressed ?? 0) >= 0.75 ? Math.floor(full / 2) : full;
}

/** Kosten eines Schritts von a nach b (Zehntel), diagonal 14/10 */
export function stepCost(map, a, b) {
  const c = map ? cellAt(map, b.x, b.y) : null;
  const base = c ? enterCost(c) : 10;
  if (!Number.isFinite(base)) return Infinity;
  return a.x !== b.x && a.y !== b.y ? Math.floor((base * 14) / 10) : base;
}

/** Zonenseite einer Spielseite auf der Karte: Seite a spielt die eigene ("own") Kartenhaelfte */
export function mapSideOf(side) {
  return side === 'a' ? 'own' : 'enemy';
}

/** Darf eine Seite beim Verlegen dieses Feld betreten? */
export function redeployAllowed(cell, side) {
  if (!cell) return false;
  return cell.zone !== 'niemandsland' && cell.side === mapSideOf(side);
}

function checkPath(order, group, state, env) {
  const path = order.path;
  let prev = group.pos;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) !== 1) return `Weg springt bei Feld ${cellLabel(p.x, p.y)}`;
    if (env.map) {
      const c = cellAt(env.map, p.x, p.y);
      if (!Number.isFinite(enterCost(c))) return `Feld ${cellLabel(p.x, p.y)} ist nicht begehbar`;
      if (order.type === 'redeploy' && !redeployAllowed(c, group.side)) {
        return `Verlegen geht nur hinter der eigenen Linie (Feld ${cellLabel(p.x, p.y)})`;
      }
    }
    prev = p;
  }
  return null;
}

registerOrderValidator('move', checkPath);
registerOrderValidator('redeploy', checkPath);

function runMove(ctx) {
  const map = ctx.map;
  const type = ctx.kind === 'battle' ? 'move' : 'redeploy';
  const groups = ctx.groups();
  const occupied = new Map(groups.map((g) => [g.pos.x + ',' + g.pos.y, g.id]));
  // Alle Gruppen gehen gleichzeitig Feld fuer Feld (je Durchgang ein Schritt, nach ID). Wer hinter einer
  // abziehenden Gruppe steht, kommt im naechsten Durchgang nach; Kolonnen stauen sich also nicht nach ID.
  const movers = groups
    .map((g) => ({ g, o: ctx.orderFor(g.id) }))
    .filter(({ o }) => o && o.type === type && o.path?.length)
    .map(({ g, o }) => ({ g, o, budget: moveBudget(g, ctx.kind), steps: 0, from: { ...g.pos }, done: false, blockedBy: null }));
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of movers) {
      if (m.done) continue;
      if (m.steps >= m.o.path.length) { m.done = true; continue; }
      const p = m.o.path[m.steps];
      const cost = stepCost(map, m.g.pos, p);
      if (!Number.isFinite(cost) || (m.steps > 0 && cost > m.budget)) { m.done = true; m.blockedBy = null; continue; }
      const who = occupied.get(p.x + ',' + p.y);
      if (who && who !== m.g.id) { m.blockedBy = { at: p, group: who }; continue; }
      occupied.delete(m.g.pos.x + ',' + m.g.pos.y);
      m.g.pos = { x: p.x, y: p.y };
      occupied.set(p.x + ',' + p.y, m.g.id);
      m.budget -= cost;
      m.steps++;
      m.blockedBy = null;
      progress = true;
    }
  }
  for (const { g, o, steps, from, blockedBy } of movers) {
    const rest = o.path.slice(steps).map((p) => ({ x: p.x, y: p.y }));
    const name = 'Gruppe ' + surname(g.leader.name);
    const verb = type === 'move' ? 'rückt' : 'verlegt';
    const n = `${steps} ${steps === 1 ? 'Feld' : 'Felder'}`;
    const dest = o.path[o.path.length - 1];
    let reason;
    if (blockedBy && steps === 0) reason = `${name} kommt nicht los: Feld ${cellLabel(blockedBy.at.x, blockedBy.at.y)} ist besetzt.`;
    else if (blockedBy) reason = `${name} ${verb} ${n} bis ${cellLabel(g.pos.x, g.pos.y)} und bleibt stehen: Feld ${cellLabel(blockedBy.at.x, blockedBy.at.y)} ist besetzt.`;
    else if (steps === 0) reason = `${name} kommt nicht los: Feld ${cellLabel(rest[0].x, rest[0].y)} ist nicht begehbar.`;
    else if (rest.length) reason = `${name} ${verb} ${n} bis ${cellLabel(g.pos.x, g.pos.y)}, bis ${cellLabel(dest.x, dest.y)} fehlen noch ${rest.length}.`;
    else reason = `${name} ${verb} ${n} und erreicht ${cellLabel(g.pos.x, g.pos.y)}.`;
    ctx.emit(type, {
      side: g.side, group: g.id, secret: true, from, to: { ...g.pos }, steps, rest, blocked: blockedBy != null,
      reason, at: { ...g.pos },
    });
  }
}

registerPhase({
  id: 'move',
  kind: 'both',
  order: { position: ORDER.position.movement, battle: ORDER.battle.movement },
  run: runMove,
});
