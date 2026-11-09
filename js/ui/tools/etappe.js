// Werkzeug Etappe (Taste M fuer Modell; Plan 6): oeffnet das Etappenfenster mit dem Pappmodell. Gilt fuer die ganze Seite.
// Dazu der Pruefpunkt "Vor der Runde" (Belohnung offen, zerschossene Gebaeude, Bauauftraege) und die Zeichnung
// auf der Lagekarte: vorgemerkte Bauten mit Bleistift, Rauch ueber der Feldkueche bei Tag (Ueberraschung:
// der Rauch verraet die Kueche), roter Kringel um Gebaeude, die der Gegner kennt.
import { registerTool } from '../tools.js';
import { registerCheck } from '../summary.js';
import { registerDecor } from '../../render/decor.js';
import { ensureCss } from '../dom.js';
import { openEtappeWindow } from '../etappe-window.js';
import { BUILDINGS } from '../../config/buildings.js';
import { pendingRewards } from '../../etappe.js';
import { etappeOf, plotRect, plotCenter, plotName, planView, isBuilt, MAP_LABELS } from '../../etappe-map.js';
import { isSmoking } from '../../phases/build.js';
import { registerCue, shellCue } from '../../audio/cues.js';

export const ETAPPE_ICON = '<path d="M3 20 H21"/><path d="M5 20 V11 L10 7 L15 11 V20"/><path d="M15 14 H20 V20"/><path d="M8.5 20 V15 H11.5 V20"/><path d="M17.5 11 V8"/>';

registerTool({
  id: 'etappe',
  key: 'm',
  label: 'Etappe',
  order: 85,
  shown: (state) => state.turnKind !== 'battle',
  needsGroup: false,
  icon: ETAPPE_ICON,
  canUse(group, state) {
    if (state.turnKind !== 'position') return 'Bauen in der Etappe nur in Stellungsrunden';
    if (!etappeOf(state, 'a') && !etappeOf(state, 'b')) return 'Diese Karte hat keine Etappe';
    return true;
  },
  begin(ctx) {
    const { state, side } = ctx;
    if (!etappeOf(state, side)) { ctx.hint('Diese Seite hat keine eigene Etappe.'); ctx.cancel(); return; }
    ctx.setModal?.(true);
    Promise.all([ensureCss('css/etappe3d.css'), ensureCss('css/etappe-window.css')]).then(() => {
      const win = openEtappeWindow(ctx.ui, {
        state, side,
        plan: ctx.plans?.().etappe ?? null,
        focus: ctx.focus ?? null,
        night: !!state.night,
        title: 'Etappe' + (ctx.map?.sheet?.title ? ' · ' + ctx.map.sheet.title.replace(/^Lagekarte\s*/i, '') : ''),
        onApply: (plan) => {
          ctx.setModal?.(false);
          ctx.setSidePlan({ type: 'etappe', builds: plan.builds, repairs: plan.repairs, reward: plan.reward });
          ctx.cancel();
        },
        onClose: () => { ctx.setModal?.(false); ctx.cancel(); },
      });
      ctx.onWindow?.(win);
    }).catch(() => { ctx.setModal?.(false); ctx.cancel(); ctx.hint('Das Etappenfenster konnte nicht geladen werden.'); });
  },
});

registerCheck('etappe', ({ state, side, plans }) => {
  const et = etappeOf(state, side);
  if (!et || state.turnKind !== 'position') return [];
  const plan = plans?.etappe ?? null;
  const out = [];
  const view = planView(et, plan, state.sides[side].supplies.material ?? 0);
  const pending = pendingRewards({ ...et, rewards: view.rewards });
  if (pending.length) {
    const d = et.buildings.find((b) => b.type === 'depot') ?? et.buildings[0];
    out.push({ tone: 'warn', text: `Etappe Stufe ${pending[0].level}: Belohnung im Etappenfenster wählen`, at: d ? plotCenter(et, d.x, d.y) : null });
  }
  const repairs = new Set(plan?.repairs ?? []);
  for (const b of [...et.buildings].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    if (b.damaged && !repairs.has(b.id)) out.push({ tone: 'warn', text: `${BUILDINGS[b.type].name} ${plotName(b.x, b.y)} zerschossen`, at: plotCenter(et, b.x, b.y) });
  }
  const n = (plan?.builds?.length ?? 0) + repairs.size;
  if (n) {
    const names = (plan.builds ?? []).map((w) => BUILDINGS[w.type]?.name).filter(Boolean);
    if (repairs.size) names.push(repairs.size === 1 ? 'eine Reparatur' : repairs.size + ' Reparaturen');
    out.push({ tone: 'ok', summary: true, text: `Etappe: ${names.slice(0, 3).join(', ')}${names.length > 3 ? ' …' : ''} für ${view.cost} Material` });
  }
  return out;
});

// ---------- Zeichnung auf der Lagekarte ----------

function handText(ctx, px, text, x, y, color, size = 15, align = 'center') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(px, px);
  ctx.font = `700 ${size}px "Caveat", cursive`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** Bleistift-Rauchfahne: Kringel, die nach oben groesser werden und mit dem Wind (aus Westen) abziehen */
function smoke(ctx, x, y, px, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const puffs = [[0, 0, 0.16], [0.18, -0.42, 0.22], [0.48, -0.9, 0.29], [0.9, -1.4, 0.36]];
  puffs.forEach(([dx, dy, r], i) => {
    ctx.globalAlpha = 0.8 - i * 0.14;
    ctx.lineWidth = Math.max(1.2, 2.2 - i * 0.3) * px;
    ctx.beginPath();
    ctx.arc(x + dx, y + dy, r, 0.4, Math.PI * 2 - 0.2);
    ctx.stroke();
  });
  ctx.restore();
}

registerDecor({
  id: 'etappe',
  order: 30,
  draw(ctx, d) {
    const { state, side, theme: th, px } = d;
    if (!state) return;
    const et = etappeOf(state, side);
    if (!et) return;
    // Vorgemerkte Bauten dieser Runde: gestrichelt mit Bleistift
    for (const w of d.plans?.etappe?.builds ?? []) {
      const def = BUILDINGS[w.type];
      if (!def) continue;
      const r = plotRect(et, w.x, w.y);
      ctx.save();
      ctx.strokeStyle = th.pencil ?? th.ink;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([5 * px, 4 * px]);
      if (def.kind === 'rail') {
        ctx.beginPath();
        ctx.moveTo(r.x + 0.2, r.y + r.h / 2); ctx.lineTo(r.x + r.w - 0.2, r.y + r.h / 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(r.x + 0.3, r.y + 0.25, r.w - 0.6, r.h - 1.05);
      }
      ctx.restore();
      handText(ctx, px, (def.kind === 'rail' ? 'Gleis' : MAP_LABELS[w.type] ?? def.name) + '?', r.x + r.w / 2, r.y + r.h / 2 - 0.45, th.pencil ?? th.ink, 14);
    }
    for (const b of et.buildings) {
      const def = BUILDINGS[b.type];
      if (!def || def.kind === 'rail') continue;
      const r = plotRect(et, b.x, b.y);
      if (isSmoking(b, state.night)) smoke(ctx, r.x + r.w - 0.75, r.y + 0.25, px, th.pencil ?? th.ink);
      if (b.spotted && (isBuilt(b) || b.damaged)) {
        ctx.save();
        ctx.strokeStyle = th.danger;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 1.8 * px;
        ctx.beginPath();
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2 - 0.4, r.w * 0.62, r.h * 0.48, -0.12, 0.2, Math.PI * 2 - 0.1);
        ctx.stroke();
        ctx.restore();
        handText(ctx, px, b.spottedBy === 'smoke' ? 'Rauch gesehen!' : 'aufgeklärt', r.x + r.w / 2, r.y - 0.35, th.danger, 14);
      }
    }
  },
});

// Klaenge (P19): Treffer klingt wie ein ferner Einschlag, Fertigmeldung nach Arbeit, Feldpost nach Papier
const mine = (e, ctx) => e.side === ctx.side;
registerCue('building_damaged', (e, ctx) => shellCue(e, ctx, 0.5));
registerCue('build_done', (e, ctx) => (mine(e, ctx) ? [{ name: 'steps', opts: { count: 3, intensity: 0.3 } }] : null));
registerCue('building_repaired', (e, ctx) => (mine(e, ctx) ? [{ name: 'steps', opts: { count: 3, intensity: 0.3 } }] : null));
registerCue('feldpost', (e, ctx) => (mine(e, ctx) ? [{ name: 'paper', opts: { intensity: 0.45 } }] : null));
registerCue('building_spotted', (e, ctx) => (mine(e, ctx) ? [{ name: 'pencil', opts: { count: 2, intensity: 0.35 } }] : null));
