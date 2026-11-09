// Werkzeug Draht (Taste D, Plan 3.3, 4.1 Nr. 4): in Stellungsrunden eine Drahtlinie vor die eigene Stellung ziehen.
// Linie mit Finger oder Maus wie beim Graben; das Kaertchen zeigt Dauer, Material und Hinweise (nachts schneller).
// Zeichnet ausserdem geplante Drahtlinien (Befehle) als Bleistift-Kreuzchen.
import { registerTool } from '../tools.js';
import { startLineDraw } from '../linedraw.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { cellLabel, distance } from '../../map.js';
import { unitType } from '../../config/units.js';
import { cellsFromPoints } from '../../trench.js';
import { wireBlocker, wireRate, MAX_WIRE_CELLS, WIRE_REACH, WIRE_LAYERS, WIRE_MATERIAL } from '../../phases/wire.js';
import { liveCell } from '../../phases/move.js';
import { createDrawPanel } from './dig.js';
import { groupName, plural } from '../labels.js';

let draft = null; // { cells, bad: Set }

/** Linie beurteilen (rein): { bad: Set('x,y'), why, whyAt, tooFar, fresh (Felder ohne Draht) } */
export function judgeWire(map, state, group, cells) {
  const bad = new Set();
  let why = null, whyAt = null, fresh = 0;
  for (const c of cells) {
    const cell = liveCell(map, state, c.x, c.y);
    if (cell?.wire) continue;
    const w = wireBlocker(cell, group.side);
    if (w) { bad.add(c.x + ',' + c.y); if (!why) { why = w; whyAt = c; } } else fresh++;
  }
  const tooFar = cells.length > 0 && distance(group.pos, cells[0]) > WIRE_REACH;
  return { bad, why, whyAt, tooFar, fresh };
}

function crosses(ctx, cells, color, px, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * px;
  ctx.beginPath();
  for (const c of cells) {
    const x = c.x + 0.5, y = c.y + 0.5;
    ctx.moveTo(x - 0.28, y - 0.28); ctx.lineTo(x + 0.28, y + 0.28);
    ctx.moveTo(x + 0.28, y - 0.28); ctx.lineTo(x - 0.28, y + 0.28);
  }
  ctx.stroke();
  ctx.setLineDash([3 * px, 3 * px]);
  ctx.beginPath();
  cells.forEach((c, i) => (i ? ctx.lineTo(c.x + 0.5, c.y + 0.5) : ctx.moveTo(c.x + 0.5, c.y + 0.5)));
  ctx.stroke();
  ctx.restore();
}

registerOrderPainter('wire', (ctx, { order, th, px }) => {
  crosses(ctx, order.path, th.pencil, px, 0.9);
  return true;
});

registerDecor({
  id: 'wire-draft',
  order: 70,
  draw(ctx, d) {
    if (!draft?.cells.length) return;
    crosses(ctx, draft.cells.filter((c) => !draft.bad.has(c.x + ',' + c.y)), d.theme.accent, d.px);
    const bad = draft.cells.filter((c) => draft.bad.has(c.x + ',' + c.y));
    if (bad.length) crosses(ctx, bad, d.theme.danger, d.px);
  },
});

registerTool({
  id: 'wire',
  key: 'd',
  label: 'Draht',
  order: 15,
  orderTypes: ['wire'],
  icon: '<path d="M3 12 H21"/><path d="M6 9 L9 15"/><path d="M9 9 L6 15"/><path d="M15 9 L18 15"/><path d="M18 9 L15 15"/>',
  describe(o, g, state) {
    const r = wireRate(g, state.night);
    return `Draht ${plural(o.path.length, 'Feld', 'Felder')} · ${plural(Math.max(1, Math.ceil(o.path.length / r)), 'Runde', 'Runden')}`;
  },
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind !== 'position') return 'Draht nur in Stellungsrunden';
    if (!WIRE_LAYERS.has(group.type)) return `${unitType(group.type).name} verlegt keinen Draht`;
    return true;
  },
  begin(ctx) {
    const { group, state } = ctx;
    const map = ctx.map;
    const s = { cells: [] };
    function update() {
      const cells = s.cells;
      const j = judgeWire(map, state, group, cells);
      draft = { cells, bad: j.bad };
      const n = cells.length;
      const mat = state.sides[group.side]?.supplies?.material ?? 0;
      const rate = wireRate(group, state.night);
      let tone = 'good', title, text, canGo = n > 0;
      const meta = [];
      if (!n) {
        tone = ''; title = 'Draht ziehen';
        text = `Mit Finger oder Maus eine Linie vor der Stellung ziehen, höchstens ${WIRE_REACH} Felder neben ${groupName(state, group)} beginnen.`;
      } else if (j.tooFar) {
        tone = 'warn'; canGo = false; title = 'Zu weit weg';
        text = `Der Draht muss höchstens ${WIRE_REACH} Felder neben ${groupName(state, group)} beginnen.`;
      } else if (j.why) {
        tone = 'warn'; canGo = false; title = 'Hier nicht';
        text = `Feld ${cellLabel(j.whyAt.x, j.whyAt.y)}: ${j.why}.`;
      } else if (n > MAX_WIRE_CELLS) {
        tone = 'warn'; canGo = false; title = 'Zu lang';
        text = `Höchstens ${MAX_WIRE_CELLS} Felder auf einmal, das sind ${n}.`;
      } else if (!j.fresh) {
        tone = ''; canGo = false; title = 'Liegt schon';
        text = 'Auf dieser Linie liegt schon Draht.';
      } else {
        title = `${plural(j.fresh, 'Feld', 'Felder')} Draht`;
        text = state.night
          ? 'Nachts kriechen die Arbeitstrupps unbemerkt hinaus und kommen schneller voran.'
          : 'Am Tag sieht der Gegner die Arbeitstrupps. Nachts geht es schneller.';
        meta.push(`Dauer: ${plural(Math.max(1, Math.ceil(j.fresh / rate)), 'Stellungsrunde', 'Stellungsrunden')} (${rate} Felder je Runde)`);
        meta.push(`Material ${j.fresh * WIRE_MATERIAL} von ${mat}`);
        if (j.fresh * WIRE_MATERIAL > mat) { tone = 'warn'; text += ' Das Material reicht nicht für die ganze Linie.'; }
      }
      const actions = [{ id: 'go', label: 'Draht befehlen', primary: true, disabled: !canGo }];
      if (n) actions.push({ id: 'clear', label: 'Neu zeichnen' });
      actions.push({ id: 'cancel', label: 'Abbrechen' });
      panel.set({ tone, title, text, meta, actions });
      ctx.redraw();
    }
    const panel = createDrawPanel(ctx.ui, (act) => {
      if (act === 'cancel') { ctx.cancel(); return; }
      if (act === 'clear') s.cells = [];
      else if (act === 'go') {
        ctx.setOrder({ group: group.id, type: 'wire', path: s.cells.map((c) => ({ x: c.x, y: c.y })) });
        ctx.cancel();
        return;
      }
      update();
    });
    const surface = startLineDraw(ctx.ui, ctx.cam, {
      label: 'Draht ziehen',
      onCamera: () => ctx.redraw(true),
      onDraw(points, done) {
        if (!points) { update(); return; }
        s.cells = cellsFromPoints(points);
        update();
        if (done && s.cells.length) panel.el.querySelector('.sbtn.primary:not([disabled])')?.focus({ preventScroll: true });
      },
    });
    ctx.onCancel(() => { surface.destroy(); panel.destroy(); draft = null; ctx.redraw(); });
    ctx.expose?.({
      draw(points) { s.cells = cellsFromPoints(points); update(); },
      act(id) { panel.el.querySelector(`[data-act="${id}"]`)?.click(); },
    });
    update();
  },
});
