// Werkzeuge der Artillerie (P09, Plan 4.1 Nr. 8, 7.4, 7.6):
// - Feuerplan (Taste A, Stellungsrunde, ganze Seite): oeffnet den Feuerplan-Editor im Blaupausen-Stil
// - Feuer verlegen (Taste V, Gefechtsrunde, Beobachter): Ziel antippen, Vorschau zeigt Weg und Verzoegerung
// - Feuer einstellen (Taste E, Gefechtsrunde, Beobachter)
// Dazu Pruefpunkte "Vor der Runde": durchtrennte Leitungen, Batterien ohne Leitung, Feuerplan-Warnungen.
import { registerTool } from '../tools.js';
import { registerCheck } from '../summary.js';
import { ensureCss } from '../dom.js';
import { cellLabel } from '../../map.js';
import { PLAN_KINDS } from '../../config/artillery.js';
import {
  artilleryOf, activePlans, observerPlan, commandLink, observerLink, batteryLinked, planCellsAt, centerOf, stormGhosts, ammoAfter,
} from '../../artillery.js';
import { seesCellFrom, darknessOf } from '../../sight.js';
import { openFirePlanEditor } from '../fireplan.js';
import { groupName } from '../labels.js';
import { registerCue, shellCue } from '../../audio/cues.js';

// Klaenge der Artillerie (Ereignis-Haken aus js/audio/cues.js). Abschuss fern, Einschlag nach kurzer Flugzeit,
// nah an eigenen Gruppen mit Taubheit. "Feuer einstellen" laesst die Front kurz verstummen.
registerCue('shelling', () => [{ name: 'artillery-far', opts: { intensity: 0.35 } }]);
registerCue('impacts', (e, ctx) => shellCue(e, ctx, 0.5 + Math.min(0.2, (e.impacts?.length ?? 0) * 0.01)).map((c) => ({ ...c, delay: 0.45 })));
registerCue('battery_hit', (e, ctx) => shellCue(e, ctx, 0.75));
registerCue('fire_ceased', () => [{ name: 'hush' }]);
registerCue('fire_shifted', () => [{ name: 'teletype', opts: { count: 2, intensity: 0.3 } }]);
registerCue('command_sent', () => [{ name: 'teletype', opts: { count: 3, intensity: 0.3 } }]);
registerCue('command_lost', () => [{ name: 'paper', opts: { intensity: 0.35 } }]);
registerCue('line_cut', () => [{ name: 'teletype', opts: { count: 1, intensity: 0.25 } }]);
registerCue('wire_cut', () => [{ name: 'pencil', opts: { count: 2, intensity: 0.4 } }]);

export const FIREPLAN_ICON = '<path d="M3 20 H21"/><path d="M6 20 V9"/><path d="M12 20 V6"/><path d="M18 20 V12"/><path d="M4 9 H8"/><path d="M10 6 H14"/><path d="M16 12 H20"/>';
const SHIFT_ICON = '<circle cx="16" cy="9" r="4"/><path d="M4 18 L12 12"/><path d="M9 11 L12 12 L11 15"/>';
const CEASE_ICON = '<circle cx="12" cy="12" r="8"/><path d="M8 12 H16"/>';

/** Feuerplaene, die fuer die planende Seite gelten: neuer Plan dieser Runde oder die scharfen Plaene */
export function currentPlans(state, side, plans) {
  return plans?.fire_plan?.plans ?? artilleryOf(state, side).plans;
}

function anyBatteries(state) {
  return Object.values(state.sides).some((s) => s.artillery?.batteries?.length);
}

registerTool({
  id: 'fireplan',
  shown: (state) => state.turnKind !== 'battle', // P06: nur in der passenden Rundenart in der Werkzeugreihe
  key: 'a',
  label: 'Feuerplan',
  order: 70,
  needsGroup: false,
  icon: FIREPLAN_ICON,
  canUse(group, state) {
    if (!anyBatteries(state)) return 'Keine Batterien im Abschnitt';
    return state.turnKind === 'position' ? true : 'Feuerpläne entstehen in der Stellungsrunde. Im Gefecht lenken Beobachter.';
  },
  begin(ctx) {
    const { map, state, side } = ctx;
    if (!artilleryOf(state, side).batteries.length) { ctx.hint('Diese Seite hat keine Batterien.'); ctx.cancel(); return; }
    const base = ctx.blueprint?.(true);
    let ed = null;
    let ended = false;
    ensureCss('css/feuerplan.css').then(() => {
      if (ended) return; // schon abgebrochen, bevor die Stile geladen waren
      ed = openFirePlanEditor({
        ui: ctx.ui, root: ctx.root, cam: ctx.cam, map, state, side,
        plans: currentPlans(state, side, ctx.plans?.()),
        marks: ctx.marks?.() ?? {},
        redraw: () => ctx.redraw?.(),
        hint: (t) => ctx.hint(t),
        onApply: (plans) => { ctx.setSidePlan({ type: 'fire_plan', plans }); ctx.cancel(); },
        onClose: () => ctx.cancel(),
      });
      ctx.setDecor?.((c, v) => ed.draw(c, v));
      ctx.pickCell({
        title: 'Feuerplan',
        hint: 'Blaupause: Linie ziehen, Griffe verschieben, rechts Batterien und Runden einstellen.',
        preview: () => null,
        pick: (cell) => ed.tap(cell),
      });
    }).catch(() => { ctx.hint('Feuerplan-Editor konnte nicht geladen werden.'); ctx.cancel(); });
    ctx.onEnd?.(() => {
      ended = true;
      ed?.close();
      ctx.setDecor?.(null);
      ctx.blueprint?.(false, base);
    });
  },
});

/** Vorschau fuer "Feuer verlegen" (rein): { ok, text, fire } */
export function shiftPreview(map, state, group, cell) {
  const art = artilleryOf(state, group.side);
  const round = state.battle?.round ?? 1;
  const plan = observerPlan(art, {}, round, cell, group.pos);
  if (!plan) return { ok: false, text: 'Kein laufender Feuerplan, den der Beobachter lenken könnte.' };
  const where = cellLabel(cell.x, cell.y);
  if (!seesCellFrom(map, group, cell, darknessOf(state))) return { ok: false, text: `${where}: der Beobachter sieht das Ziel nicht` };
  const link = commandLink(state, group.side, group, plan);
  if (!link.via) return { ok: false, text: `Keine Verbindung: ${link.why}` };
  return {
    ok: true, fire: { x: cell.x, y: cell.y }, plan: plan.id,
    text: `${PLAN_KINDS[plan.kind].label} nach ${where} verlegen\nGilt ab Gefechtsrunde ${round + link.delay}, ${link.why}`,
  };
}

registerTool({
  id: 'shift',
  shown: (state) => state.turnKind === 'battle', // P06: nur in der passenden Rundenart in der Werkzeugreihe
  key: 'v',
  label: 'Verlegen',
  order: 72,
  icon: SHIFT_ICON,
  canUse(group, state) {
    if (group.type !== 'observers') return 'Nur Beobachter lenken die Artillerie';
    if (state.turnKind !== 'battle') return 'Feuer verlegen geht nur in Gefechtsrunden';
    const art = artilleryOf(state, group.side);
    const round = state.battle?.round ?? 1;
    if (!art.plans.some((p) => p.ceasedFrom == null && (planCellsAt(p, round).length || p.start > round))) return 'Kein laufender Feuerplan';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Feuer verlegen',
      hint: `Feuer verlegen: Ziel für ${groupName(state, group)} antippen. Telefon braucht eine Runde, ein Melder zwei.`,
      preview: (cell) => (cell ? shiftPreview(map, state, group, cell) : null),
      pick(cell) {
        const p = cell ? shiftPreview(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'shift_fire', target: { x: cell.x, y: cell.y }, plan: p.plan });
        return true;
      },
    });
  },
});

registerTool({
  id: 'cease',
  shown: (state) => state.turnKind === 'battle', // P06: nur in der passenden Rundenart in der Werkzeugreihe
  key: 'e',
  label: 'Einstellen',
  order: 74,
  icon: CEASE_ICON,
  canUse(group, state) {
    if (group.type !== 'observers') return 'Nur Beobachter lenken die Artillerie';
    if (state.turnKind !== 'battle') return 'Feuer einstellen geht nur in Gefechtsrunden';
    const art = artilleryOf(state, group.side);
    const plan = observerPlan(art, {}, state.battle?.round ?? 1, null, group.pos);
    if (!plan) return 'Gerade schießt kein Feuerplan';
    const link = commandLink(state, group.side, group, plan);
    return link.via ? true : `Keine Verbindung: ${link.why}`;
  },
  begin(ctx) {
    const { state, group } = ctx;
    const plan = observerPlan(artilleryOf(state, group.side), {}, state.battle?.round ?? 1, null, group.pos);
    const link = commandLink(state, group.side, group, plan);
    ctx.setOrder({ group: group.id, type: 'cease_fire', plan: plan?.id });
    ctx.hint(`${plan ? PLAN_KINDS[plan.kind].label : 'Feuer'} einstellen geht ${link.via === 'phone' ? 'per Telefon, gilt nächste Runde' : 'per Melder, gilt in zwei Runden'}.`);
    ctx.cancel();
  },
});

registerCheck('artillerie', ({ state, side, map, plans }) => {
  const art = state.sides[side]?.artillery;
  if (!art) return [];
  const out = [];
  for (const l of art.lines) {
    if (l.cut) out.push({ tone: 'warn', text: `Leitung zu ${art.batteries.find((b) => b.id === l.to)?.label ?? l.to} durchtrennt bei ${cellLabel(l.cut.x, l.cut.y)}`, at: l.cut });
  }
  for (const b of art.batteries) {
    if (!batteryLinked(art, b) && !art.lines.some((l) => l.to === b.id && l.cut)) out.push({ tone: 'warn', text: `${b.label} ohne Leitung`, at: b.pos });
    if (b.silenced) out.push({ tone: 'warn', text: `${b.label} schweigt nach Treffern`, at: b.pos });
  }
  if (state.turnKind === 'battle') {
    for (const g of state.groups.filter((x) => x.side === side && x.type === 'observers' && x.status !== 'lost')) {
      const o = observerLink(state, side, g);
      if (!o.phone && map) out.push({ tone: 'warn', text: `${groupName(state, g)} ohne Telefon (${o.why})`, group: g.id });
    }
    return out;
  }
  const list = currentPlans(state, side, plans).filter((p) => PLAN_KINDS[p.kind]?.round === 'battle');
  if (list.length && map) {
    const fid = state.sides[side].faction;
    const am = ammoAfter(list, art, fid);
    for (const [id, e] of am.perBattery) {
      if (e.after < 0) out.push({ tone: 'warn', text: `${art.batteries.find((b) => b.id === id).label}: Munition reicht nicht für alle Feuerpläne` });
    }
    for (const p of list.filter((x) => x.kind === 'creep')) {
      for (const g of stormGhosts(map, state, side, p)) if (g.warn) out.push({ tone: 'warn', text: `Walze: ${g.warn}`, group: g.group });
    }
    const names = list.map((p) => PLAN_KINDS[p.kind].short).join(', ');
    out.push({ tone: 'ok', summary: true, text: `Feuerplan: ${names}, ${am.cost} Granaten, danach ${am.after}` });
  }
  return out;
});
