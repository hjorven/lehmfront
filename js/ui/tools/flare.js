// Werkzeug Leuchtkugel (Taste K, P10). Nur bei Dunkelheit: ein Feld bis 8 Felder weit fuer eine Runde erhellen.
// Im Kreis sieht und trifft man wie am Tag, und wer sich darin bewegt, ist verraten (js/phases/weather.js).
import { registerTool } from '../tools.js';
import { cellLabel } from '../../map.js';
import { flareProblem, FLARE_RADIUS, FLARE_RANGE } from '../../weather.js';
import { timeDarkness } from '../../phases/weather.js';
import { groupName } from '../labels.js';

export function flarePreview(state, group, cell) {
  const why = flareProblem(group, cell, timeDarkness(state));
  if (why) return { ok: false, text: `${cellLabel(cell.x, cell.y)}: ${why}` };
  return { ok: true, text: `Leuchtkugel über ${cellLabel(cell.x, cell.y)} · erhellt ${FLARE_RADIUS} Felder im Umkreis, eine Runde lang` };
}

registerTool({
  id: 'flare',
  key: 'k',
  label: 'Leuchtkugel',
  order: 45,
  icon: '<path d="M12 21 V11"/><circle cx="12" cy="7" r="2.5"/><path d="M6 7 H4"/><path d="M20 7 H18"/><path d="M7.8 2.8 L9 4"/><path d="M16.2 2.8 L15 4"/>',
  shown: (state) => timeDarkness(state) > 0.5,
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (timeDarkness(state) <= 0.5) return 'Leuchtkugeln nur bei Dunkelheit';
    if (group.inDugout) return 'Gruppe sitzt im Unterstand';
    return true;
  },
  begin(ctx) {
    const { group, state } = ctx;
    ctx.pickCell({
      title: 'Leuchtkugel',
      hint: `Leuchtkugel: Feld bis ${FLARE_RANGE} Felder vor ${groupName(state, group)} antippen. Wer sich dort bewegt, wird gesehen.`,
      preview: (cell) => (cell ? flarePreview(state, group, cell) : null),
      pick(cell) {
        const p = cell ? flarePreview(state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'flare', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});
