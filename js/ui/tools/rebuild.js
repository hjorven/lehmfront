// Werkzeug Umbauen (Taste U, Plan 4.1 Nr. 2): Linie entlang eigener Graeben ziehen, der Schuetzenauftritt
// wird umgedreht. Eroberte Graeben (halbe Deckung) bekommen so wieder volle Deckung zur neuen Front.
// Antippen eines eroberten Feldes nimmt den ganzen zusammenhaengenden eroberten Abschnitt.
import { registerTool } from '../tools.js';
import { startLineDraw } from '../linedraw.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { cellAt, cellLabel, distance, DIR } from '../../map.js';
import { unitType } from '../../config/units.js';
import { cellsFromPoints, mapSideOf, oppositeDir } from '../../trench.js';
import { digRate, DIG_REACH, MAX_DIG_CELLS } from '../../phases/dig.js';
import { rebuildEstimate } from '../../phases/rebuild.js';
import { groupName, plural } from '../labels.js';
import { createDrawPanel, factorLine } from './dig.js';
import { FONTS } from '../../render/map-layer.js';

let draft = null; // { cells, captured: Set }

/** Zusammenhaengender eroberter Abschnitt ab einem Feld, nach Abstand zur Gruppe geordnet (rein) */
export function capturedSegment(map, start, ms) {
  const ok = (c) => c?.trench?.side === ms && c.trench.captured;
  if (!ok(cellAt(map, start.x, start.y))) return [];
  const seen = new Set([start.x + ',' + start.y]);
  const out = [];
  const queue = [{ x: start.x, y: start.y }];
  while (queue.length) {
    const p = queue.shift();
    out.push(p);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const q = { x: p.x + dx, y: p.y + dy };
      const k = q.x + ',' + q.y;
      if (seen.has(k) || !ok(cellAt(map, q.x, q.y))) continue;
      seen.add(k);
      queue.push(q);
    }
  }
  return out;
}

/** Linie auf eigene Grabenfelder einschraenken; Rest faellt weg */
export function rebuildCells(map, cells, ms) {
  return cells.filter((c) => cellAt(map, c.x, c.y)?.trench?.side === ms);
}

/** Pfeil zur neuen Feuerrichtung mit kleinem Bogen am Ende (wird gedreht) */
function turnArrow(ctx, c, color, px, to) {
  const f = DIR[to];
  if (!f) return;
  const cx = c.x + 0.5, cy = c.y + 0.5;
  const len = f.dx && f.dy ? 0.3 : 0.4;
  const tx = cx + f.dx * len, ty = cy + f.dy * len;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8 * px;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - f.dx * len * 0.6, cy - f.dy * len * 0.6);
  ctx.lineTo(tx, ty);
  // Pfeilspitze
  const ax = -f.dx, ay = -f.dy, nx = -f.dy, ny = f.dx, h = 0.14;
  ctx.moveTo(tx + (ax + nx) * h, ty + (ay + ny) * h);
  ctx.lineTo(tx, ty);
  ctx.lineTo(tx + (ax - nx) * h, ty + (ay - ny) * h);
  ctx.stroke();
  ctx.restore();
}

registerDecor({
  id: 'rebuild-draft',
  order: 51,
  draw(ctx, d) {
    if (!draft) return;
    const th = d.theme, px = d.px;
    for (const c of draft.cells) {
      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = th.accent;
      ctx.fillRect(c.x, c.y, 1, 1);
      ctx.restore();
      const t = d.map ? cellAt(d.map, c.x, c.y)?.trench : null;
      if (t) turnArrow(ctx, c, th.ink, px, oppositeDir(t.facing));
    }
    if (draft.tooFar && draft.group) {
      ctx.save();
      ctx.strokeStyle = th.danger;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      const g = draft.group.pos;
      ctx.strokeRect(g.x - DIG_REACH, g.y - DIG_REACH, DIG_REACH * 2 + 1, DIG_REACH * 2 + 1);
      ctx.restore();
    }
  },
});

registerOrderPainter('rebuild', (ctx, { order, th, px, d }) => {
  for (const c of order.path) {
    const t = d.map ? cellAt(d.map, c.x, c.y)?.trench : null;
    turnArrow(ctx, c, th.pencil, px, t ? oppositeDir(t.facing) : null);
  }
  const end = order.path[order.path.length - 1];
  ctx.save();
  ctx.fillStyle = th.pencil;
  ctx.font = `700 ${15 * px}px ${FONTS.hand}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('umbauen', end.x + 0.9, end.y + 0.5);
  ctx.restore();
  return true;
});

registerTool({
  id: 'rebuild',
  key: 'u',
  label: 'Umbauen',
  order: 20,
  orderTypes: ['rebuild'],
  icon: '<path d="M5 12 A7 7 0 0 1 17 7"/><path d="M17 3 V7 H13"/><path d="M19 12 A7 7 0 0 1 7 17"/><path d="M7 21 V17 H11"/>',
  describe(o, g, state, map) {
    const e = rebuildEstimate(map, state, g, o.path);
    return `Umbauen ${plural(o.path.length, 'Feld', 'Felder')} · ${plural(e.rounds, 'Runde', 'Runden')}`;
  },
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind !== 'position') return 'Umbauen nur in Stellungsrunden';
    if (!(unitType(group.type).digRate > 0)) return `${unitType(group.type).name} baut nicht um`;
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    const ms = mapSideOf(group.side);
    const s = { cells: [] };

    function update() {
      const cells = s.cells;
      const n = cells.length;
      const tooFar = n > 0 && distance(group.pos, cells[0]) > DIG_REACH;
      draft = n || tooFar ? { cells, tooFar, group } : null;
      const captured = cells.filter((c) => cellAt(map, c.x, c.y)?.trench?.captured).length;
      let tone = '', title, text, canGo = n > 0;
      const meta = [];
      if (!n) {
        title = 'Umbauen';
        text = 'Linie entlang eines eigenen Grabens ziehen. Antippen eines eroberten Feldes nimmt den ganzen eroberten Abschnitt.';
      } else if (tooFar) {
        tone = 'warn'; canGo = false;
        title = 'Zu weit weg';
        text = `Der Umbau muss höchstens ${DIG_REACH} Felder neben ${groupName(state, group)} beginnen.`;
      } else if (n > MAX_DIG_CELLS) {
        tone = 'warn'; canGo = false;
        title = 'Zu lang';
        text = `Höchstens ${MAX_DIG_CELLS} Felder auf einmal.`;
      } else {
        tone = 'good';
        title = captured ? 'Eroberten Graben drehen' : 'Feuerrichtung drehen';
        text = captured
          ? `${plural(captured, 'Feld', 'Felder')} erobert, dort nur halbe Deckung. Nach dem Umbau zeigt der Auftritt zur neuen Front.`
          : `${plural(n, 'Feld', 'Felder')} eigener Graben, der Auftritt zeigt danach in die Gegenrichtung.`;
        const e = rebuildEstimate(map, state, group, cells);
        const other = group.type === 'pioneers' ? 'rifles' : 'pioneers';
        const e2 = rebuildEstimate(map, state, { ...group, type: other }, cells);
        meta.push(`Dauer: ${plural(e.rounds, 'Stellungsrunde', 'Stellungsrunden')} · ${other === 'pioneers' ? 'Pioniere' : 'Schützen'} ${e2.rounds}`);
        const fl = factorLine(digRate(state, group, map).factors);
        if (fl) meta.push(fl);
      }
      panel.set({
        tone, title, text, meta,
        actions: [
          { id: 'go', label: 'Umbau befehlen', primary: true, disabled: !canGo },
          ...(n ? [{ id: 'clear', label: 'Neu zeichnen' }] : []),
          { id: 'cancel', label: 'Abbrechen' },
        ],
      });
      ctx.redraw();
    }

    const panel = createDrawPanel(ctx.ui, (act) => {
      if (act === 'cancel') { ctx.cancel(); return; }
      if (act === 'clear') s.cells = [];
      else if (act === 'go') {
        ctx.setOrder({ group: group.id, type: 'rebuild', path: s.cells.map((c) => ({ x: c.x, y: c.y })) });
        ctx.cancel();
        return;
      }
      update();
    });

    const setFrom = (points) => {
      const raw = cellsFromPoints(points);
      if (raw.length === 1) {
        const seg = capturedSegment(map, raw[0], ms);
        s.cells = seg.length ? seg.sort((a, b) => distance(group.pos, a) - distance(group.pos, b) || a.y - b.y || a.x - b.x) : rebuildCells(map, raw, ms);
        // Abschnitt in Reihenfolge entlang des Grabens: vom naechsten Feld aus ablaufen
        if (seg.length > 1) s.cells = orderAlong(s.cells);
      } else s.cells = rebuildCells(map, raw, ms);
      if (raw.length && !s.cells.length) ctx.hint(`${cellLabel(raw[0].x, raw[0].y)}: dort ist kein eigener Graben.`);
      update();
    };

    const surface = startLineDraw(ctx.ui, ctx.cam, {
      label: 'Umbau zeichnen',
      onCamera: () => ctx.redraw(true),
      onDraw(points) { if (points) setFrom(points); },
    });
    ctx.onCancel(() => { surface.destroy(); panel.destroy(); draft = null; ctx.redraw(); });
    ctx.expose?.({ draw: setFrom, act(id) { panel.el.querySelector(`[data-act="${id}"]`)?.click(); } });
    update();
  },
});

/** Felder vom ersten aus jeweils zum naechsten Nachbarn ordnen (Graben entlang) */
function orderAlong(cells) {
  const left = cells.slice(1);
  const out = [cells[0]];
  while (left.length) {
    const p = out[out.length - 1];
    let best = 0;
    for (let i = 1; i < left.length; i++) if (distance(p, left[i]) < distance(p, left[best])) best = i;
    out.push(left.splice(best, 1)[0]);
  }
  return out;
}
