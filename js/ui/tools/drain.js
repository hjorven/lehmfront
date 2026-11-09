// Werkzeug Entwaessern (Taste W, P10): Lattenrost und Pumpensumpf in einen Grabenabschnitt legen (Stellungsrunde).
// Kostet Material, der Graben laeuft leer und bleibt fest (js/phases/weather.js).
import { registerTool } from '../tools.js';
import { cellLabel, distance } from '../../map.js';
import { trenchOf, waterAt, isDrained, WATER_WORDS } from '../../weather.js';
import { drainCells, DRAIN_COST } from '../../phases/weather.js';
import { groupName } from '../labels.js';

export function drainPreview(map, state, group, cell) {
  const at = cellLabel(cell.x, cell.y);
  if (!trenchOf(state, map, cell.x, cell.y)) return { ok: false, text: `${at}: kein Graben` };
  if (distance(group.pos, cell) > 1) return { ok: false, text: `${at}: die Gruppe muss im Graben oder daneben stehen` };
  if (isDrained(state, cell.x, cell.y)) return { ok: false, text: `${at}: schon entwässert` };
  const mat = state.sides[group.side].supplies.material ?? 0;
  if (mat < DRAIN_COST) return { ok: false, text: `${at}: zu wenig Material (${mat} von ${DRAIN_COST})` };
  const n = drainCells(state, map, cell).length;
  return { ok: true, text: `Entwässern bei ${at} (${WATER_WORDS[waterAt(state, cell.x, cell.y)]}) · ${n} Grabenfelder · ${DRAIN_COST} Material` };
}

registerTool({
  id: 'drain',
  key: 'w',
  label: 'Entwässern',
  order: 70,
  icon: '<path d="M4 14 H20"/><path d="M4 18 H20"/><path d="M7 12 V20"/><path d="M12 12 V20"/><path d="M17 12 V20"/><path d="M12 3 C10 6 9 7.5 12 9 C15 7.5 14 6 12 3 Z"/>',
  shown: (state) => state.turnKind !== 'battle',
  canUse(group, state, env) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind === 'battle') return 'Entwässern geht nur in Stellungsrunden';
    const map = env.map;
    const near = [group.pos, ...[[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => ({ x: group.pos.x + dx, y: group.pos.y + dy }))];
    if (!near.some((p) => trenchOf(state, map, p.x, p.y))) return 'Kein Graben in der Nähe';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Entwässern',
      hint: `Entwässern: Grabenfeld bei ${groupName(state, group)} antippen. Lattenrost und Pumpe, das Wasser läuft ab.`,
      preview: (cell) => (cell ? drainPreview(map, state, group, cell) : null),
      pick(cell) {
        const p = cell ? drainPreview(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'drain', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});
