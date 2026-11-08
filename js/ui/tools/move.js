// Werkzeug Bewegen (Taste B). In Gefechtsrunden "Bewegen" (move), in Stellungsrunden "Verlegen" (redeploy).
// Vorschau: Weg per A*, der in dieser Runde erreichbare Teil durchgezogen, der Rest gestrichelt.
import { registerTool } from '../tools.js';
import { findPath, enterCost, cellAt, cellLabel, TERRAIN } from '../../map.js';
import { moveBudget, stepCost, redeployAllowed } from '../../phases/move.js';
import { groupName, plural } from '../labels.js';

export function moveTypeFor(state) {
  return state.turnKind === 'battle' ? 'move' : 'redeploy';
}

/**
 * Weg und Dauer planen (rein). Liefert null, wenn kein Weg, sonst
 * { path (ohne Start), reach (Anzahl Felder in dieser Runde), rounds, cost }.
 */
export function planMove(map, state, group, goal) {
  const type = moveTypeFor(state);
  const blocked = new Set(state.groups.filter((g) => g.id !== group.id && g.status !== 'lost').map((g) => g.pos.x + ',' + g.pos.y));
  const cost = (c) => {
    if (blocked.has(c.x + ',' + c.y)) return Infinity;
    if (type === 'redeploy' && !redeployAllowed(c, group.side)) return Infinity;
    return enterCost(c);
  };
  if (goal.x === group.pos.x && goal.y === group.pos.y) return null;
  const r = findPath(map, group.pos, goal, { cost });
  if (!r) return null;
  const path = r.path.slice(1);
  return { type, path, ...pathRounds(map, state, group, path), cost: r.cost };
}

/** Wie weit kommt die Gruppe auf diesem Weg in dieser Runde, und wie viele Runden braucht sie? (rein) */
export function pathRounds(map, state, group, path) {
  const budget = moveBudget(group, state.turnKind);
  let rounds = 1, left = budget, reach = -1, prev = group.pos, steps = 0;
  for (let i = 0; i < path.length; i++) {
    const c = stepCost(map, prev, path[i]);
    if (c > left && steps > 0) { rounds++; left = budget; steps = 0; if (reach < 0) reach = i; }
    left -= c;
    steps++;
    prev = path[i];
  }
  return { reach: reach < 0 ? path.length : reach, rounds };
}

function whyNot(map, state, group, cell) {
  if (!cell) return 'außerhalb der Karte';
  if (!Number.isFinite(enterCost(cell))) return `${TERRAIN[cell.terrain].name}${cell.building ? ' mit Gebäude' : ''}, nicht begehbar`;
  if (state.groups.some((g) => g.id !== group.id && g.status !== 'lost' && g.pos.x === cell.x && g.pos.y === cell.y)) return 'Feld ist besetzt';
  if (moveTypeFor(state) === 'redeploy' && !redeployAllowed(cell, group.side)) return 'Verlegen nur hinter der eigenen Linie';
  return 'kein Weg dorthin';
}

registerTool({
  id: 'move',
  key: 'b',
  label: 'Bewegen',
  order: 30,
  icon: '<path d="M6 18 L18 6"/><path d="M9 6 H18 V15"/>',
  canUse(group) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    const verb = moveTypeFor(state) === 'move' ? 'Bewegen' : 'Verlegen';
    ctx.pickCell({
      hint: `${verb}: Zielfeld für ${groupName(state, group)} antippen. Esc bricht ab.`,
      preview(cell) {
        const plan = cell ? planMove(map, state, group, cell) : null;
        if (!plan) return { path: null, text: cell ? `${cellLabel(cell.x, cell.y)}: ${whyNot(map, state, group, cell)}` : '' };
        return {
          path: plan.path, reach: plan.reach,
          text: `${verb} nach ${cellLabel(cell.x, cell.y)} · ${plural(plan.path.length, 'Feld', 'Felder')} · ${plural(plan.rounds, 'Runde', 'Runden')}`,
        };
      },
      pick(cell) {
        const plan = cell ? planMove(map, state, group, cell) : null;
        if (!plan) { ctx.hint(cell ? `${cellLabel(cell.x, cell.y)}: ${whyNot(map, state, group, cellAt(map, cell.x, cell.y))}.` : 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: plan.type, path: plan.path });
        return true;
      },
    });
  },
});
