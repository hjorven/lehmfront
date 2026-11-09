// Werkzeug Lorenplan (Taste L, Plan 7.4/7.6): oeffnet den Zug. Gilt fuer die ganze Seite, braucht keine Gruppe.
// Dazu der Pruefpunkt "Vor der Runde": abgeschnittene Abschnitte, knapper Vorrat, wartende Verwundete.
import { registerTool } from '../tools.js';
import { registerCheck } from '../summary.js';
import { ensureCss } from '../dom.js';
import { openLorenplan } from '../lorenplan.js';
import { standingPlan, planPreview } from '../../supply.js';
import { cellLabel } from '../../map.js';

export const TRAIN_ICON = '<path d="M3 15 H21"/><rect x="4" y="8" width="6" height="6"/><rect x="13" y="8" width="7" height="6"/><circle cx="6" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/><path d="M6 8 V5"/>';

/** Wagen, die fuer die planende Seite gerade gelten: eigener Plan dieser Runde oder der stehende */
export function currentWagons(map, state, side, plans) {
  return plans?.supply_plan?.wagons ?? standingPlan(map, state, side, { fog: true });
}

registerTool({
  id: 'supply',
  key: 'l',
  label: 'Lorenplan',
  order: 80,
  needsGroup: false,
  icon: TRAIN_ICON,
  canUse(group, state) {
    return state.turnKind === 'position' ? true : 'Lorenplan nur in Stellungsrunden';
  },
  begin(ctx) {
    const { map, state, side } = ctx;
    const wagons = currentWagons(map, state, side, ctx.plans?.());
    ctx.setModal?.(true);
    ensureCss('css/lorenplan.css').then(() => {
      const win = openLorenplan(ctx.ui, {
        map, state, side, wagons,
        onApply: (w) => { ctx.setModal?.(false); ctx.setSidePlan({ type: 'supply_plan', wagons: w }); ctx.cancel(); },
        onClose: () => { ctx.setModal?.(false); ctx.cancel(); },
      });
      ctx.onWindow?.(win);
    }).catch(() => { ctx.setModal?.(false); ctx.cancel(); ctx.hint('Lorenplan konnte nicht geladen werden.'); });
  },
});

registerCheck('versorgung', ({ state, side, map, plans }) => {
  if (!map || state.turnKind !== 'position') return [];
  const pv = planPreview(map, state, side, currentWagons(map, state, side, plans), { fog: true });
  const out = [];
  for (const s of pv.sections) {
    if (!s.connected && s.upkeep.groups) {
      out.push({ tone: 'warn', text: `${s.label} abgeschnitten${s.cutAt ? ' bei ' + cellLabel(s.cutAt.x, s.cutAt.y) : ''}`, at: s.cutAt ?? s.anchor });
    } else if (s.upkeep.groups && (s.rounds.food === 0 || s.rounds.ammo === 0)) {
      out.push({ tone: 'warn', text: `${s.label}: ${s.rounds.food === 0 ? 'Verpflegung' : 'Munition'} reicht nicht bis morgen`, at: s.anchor });
    }
    if (s.woundedLeft) out.push({ tone: 'warn', text: `${s.label}: ${s.woundedLeft} ${s.woundedLeft === 1 ? 'Verwundeter wartet' : 'Verwundete warten'} ohne Lore`, at: s.anchor });
  }
  const fed = pv.sections.filter((s) => s.upkeep.groups && s.connected);
  if (fed.length) {
    const min = Math.min(...fed.map((s) => Math.min(s.rounds.food ?? 99, s.rounds.ammo ?? 99)));
    out.push({ tone: 'ok', summary: true, text: `Lorenplan ${pv.used} von ${pv.capacity} Loren, Vorrat vorn reicht ${min === 1 ? 'eine Runde' : min + ' Runden'}` });
  }
  return out;
});
