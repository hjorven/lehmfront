// Werkzeuge fuer Akt 2 (P23, Plan 4.2 Nr. 13 bis 16): Sappe (Taste Y), Stollen (Taste J), Stosstrupp (Taste X).
// Nur in Szenarien, die die Mechanik freischalten (state.scenario.features).
// Zeichnet ausserdem: eigene Stollen als gestrichelte Linie unter der Karte, gehoerte feindliche Stollen als
// unsichere Bleistiftlinie mit Fragezeichen, Sprengtrichter mit Kreideflecken, Offiziere und Veteranen-Zeichen.
import { registerTool } from '../tools.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { cellLabel, lineCells } from '../../map.js';
import { featureOn, checkSap, checkTunnel, sapRounds, tunnelRate, tunnelRounds, dugCells, activeTunnel, ownTrench, live } from '../../underground.js';
import { sapRate } from '../../phases/sap.js';
import { raidProblem, raidPath } from '../../phases/raid.js';
import { timeDarkness } from '../../phases/weather.js';
import { SAP, TUNNEL, RAID, TRAITS } from '../../config/akt2.js';
import { groupName } from '../labels.js';
import { FONTS } from '../../render/map-layer.js';
import { unitBox } from '../../render/units-layer.js';

const lineTo = (a, b) => lineCells(a.x, a.y, b.x, b.y).slice(1).map(([x, y]) => ({ x, y }));
const dark = (state) => timeDarkness(state) > 0.5;
const rounds = (n) => (Number.isFinite(n) ? `${n} ${n === 1 ? 'Stellungsrunde' : 'Stellungsrunden'}` : 'kommt nicht voran');

// ------------------------------------------------------------------------------------------- Sappe

export function sapPlan(map, state, group, cell) {
  let path = lineTo(group.pos, cell);
  // Felder, die schon eigener Graben sind, am Anfang ueberspringen: die Sappe setzt am Grabenende an
  while (path.length > 1 && ownTrench(live(map, state, path[0].x, path[0].y), group.side)) path = path.slice(1);
  if (path.length > SAP.maxCells) path = path.slice(0, SAP.maxCells);
  const why = path.length ? checkSap(map, state, group, path) : 'Ziel ist das eigene Feld';
  if (why) return { ok: false, path, text: `${cellLabel(cell.x, cell.y)}: ${why}` };
  const n = sapRounds(map, state, group.side, path, sapRate(state, group, map));
  return { ok: true, path, text: `Sappe bis ${cellLabel(path[path.length - 1].x, path[path.length - 1].y)} · ${path.length} Felder · etwa ${rounds(n)} · gedeckt, aber der Aufwurf verrät sie` };
}

registerTool({
  id: 'sap',
  key: 'y',
  label: 'Sappe',
  order: 62,
  icon: '<path d="M3 18 H9 L13 12 L17 9 L21 7"/><path d="M3 21 H10 L14 15 L18 12"/><path d="M19 4 L21 7 L18 8"/>',
  shown: (state) => featureOn(state, 'sap') && state.turnKind !== 'battle',
  canUse(group, state) {
    if (!featureOn(state, 'sap')) return 'Sappen gibt es erst in Akt 2';
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind === 'battle') return 'Sappen geht nur in Stellungsrunden';
    if (!SAP.diggers.includes(group.type)) return 'Diese Gruppe treibt keine Sappe';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Sappe',
      hint: `Sappe: Zielfeld vor ${groupName(state, group)} antippen. Der Graben wächst Feld um Feld ins Niemandsland, höchstens ${SAP.maxCells} Felder.`,
      preview: (cell) => {
        if (!cell) return null;
        const p = sapPlan(map, state, group, cell);
        return { path: p.path, text: p.text };
      },
      pick(cell) {
        const p = cell ? sapPlan(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'sap', path: p.path });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Stollen

export function tunnelPlan(map, state, group, cell) {
  const path = lineTo(group.pos, cell).slice(0, TUNNEL.maxCells);
  const why = path.length ? checkTunnel(map, state, group, path) : 'Ziel ist das eigene Feld';
  if (why) return { ok: false, path, text: `${cellLabel(cell.x, cell.y)}: ${why}` };
  const n = tunnelRounds(map, path, tunnelRate(group));
  return { ok: true, path, text: `Stollen bis ${cellLabel(path[path.length - 1].x, path[path.length - 1].y)} · ${path.length} Felder · Ladung nach etwa ${rounds(n)} · die Mineure bleiben am Eingang` };
}

registerTool({
  id: 'tunnel',
  key: 'j',
  label: 'Stollen',
  order: 64,
  icon: '<path d="M3 8 H21"/><path d="M5 8 V12" /><path d="M6 15 L9 15 M11 16 L14 16 M16 17 L19 17" stroke-dasharray="0"/><circle cx="20" cy="18" r="1.6"/>',
  shown: (state) => featureOn(state, 'tunnel') && state.turnKind !== 'battle',
  canUse(group, state, env) {
    if (!featureOn(state, 'tunnel')) return 'Stollen gibt es erst in Akt 2';
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind === 'battle') return 'Stollen gräbt man in Stellungsrunden';
    if (!TUNNEL.diggers.includes(group.type)) return 'Diese Gruppe gräbt keine Stollen';
    if (activeTunnel(state, group.id)) return 'Die Gruppe gräbt schon einen Stollen';
    if (env?.map && !ownTrench(live(env.map, state, group.pos.x, group.pos.y), group.side)) return 'Stollen beginnen im eigenen Graben';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Stollen',
      hint: `Stollen: Ziel unter der feindlichen Linie antippen. Der Gegner kann horchen, ein Gegenstollen kann ihn verschütten.`,
      preview: (cell) => {
        if (!cell) return null;
        const p = tunnelPlan(map, state, group, cell);
        return { path: p.path, text: p.text };
      },
      pick(cell) {
        const p = cell ? tunnelPlan(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'tunnel', path: p.path });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Stosstrupp

export function raidPlan(map, state, group, cell) {
  const why = raidProblem(map, state, group, cell);
  if (why) return { ok: false, path: null, text: `${cellLabel(cell.x, cell.y)}: ${why}` };
  const path = raidPath(map, state, group, cell);
  return { ok: true, path, text: `Stoßtrupp auf ${cellLabel(cell.x, cell.y)} · ${path.length} Felder hin und zurück in einer Nacht · Ziel: Gefangene, Papiere, Lage` };
}

registerTool({
  id: 'raid',
  key: 'x',
  label: 'Stoßtrupp',
  order: 66,
  icon: '<path d="M4 20 L10 14"/><path d="M10 14 L13 17 L20 10"/><path d="M16 4 L20 4 L20 8"/><path d="M20 4 L13 11"/>',
  shown: (state) => featureOn(state, 'raid') && state.turnKind !== 'battle' && dark(state),
  canUse(group, state) {
    if (!featureOn(state, 'raid')) return 'Stoßtrupps gibt es erst in Akt 2';
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind === 'battle') return 'Stoßtrupps gehen in der Stellungsrunde los';
    if (!dark(state)) return 'Stoßtrupps nur bei Dunkelheit';
    if (!RAID.raiders.includes(group.type)) return 'Nur Stoßtruppen gehen auf Stoßtrupp';
    if (group.inDugout) return 'Gruppe sitzt im Unterstand';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Stoßtrupp',
      hint: `Stoßtrupp: feindlichen Graben bis ${RAID.reach} Felder vor ${groupName(state, group)} antippen. Posten und Leuchtkugeln können den Trupp entdecken.`,
      preview: (cell) => {
        if (!cell) return null;
        const p = raidPlan(map, state, group, cell);
        return { path: p.path, text: p.text };
      },
      pick(cell) {
        const p = cell ? raidPlan(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'raid', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Zeichnen

function polyline(ctx, cells, from) {
  ctx.beginPath();
  if (from) ctx.moveTo(from.x + 0.5, from.y + 0.5);
  cells.forEach((c, i) => (i || from ? ctx.lineTo(c.x + 0.5, c.y + 0.5) : ctx.moveTo(c.x + 0.5, c.y + 0.5)));
  if (cells.length === 1 && !from) ctx.lineTo(cells[0].x + 0.51, cells[0].y + 0.5);
  ctx.stroke();
}

function note(ctx, text, x, y, color, px, size = 15) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${size * px}px ${FONTS.hand}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Geplante Sappe: Bleistift, schmale Doppellinie mit Zickzack-Kopf */
registerOrderPainter('sap', (ctx, { group, order, th, px, progress }) => {
  const cells = order.path ?? [];
  if (!cells.length) return false;
  const n = Math.max(1, Math.ceil(cells.length * Math.min(1, progress)));
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.strokeStyle = th.pencil;
  ctx.lineWidth = 4 * px;
  ctx.setLineDash([6 * px, 3 * px]);
  polyline(ctx, cells.slice(0, n), group.pos);
  ctx.restore();
  if (progress >= 1) {
    const end = cells[cells.length - 1];
    note(ctx, 'Sappe', end.x + 0.9, end.y + 0.5, th.pencil, px);
  }
  return true;
});

/** Geplanter Stollen: feine Punktlinie (unter Tage) */
registerOrderPainter('tunnel', (ctx, { group, order, th, px, progress }) => {
  const cells = order.path ?? [];
  if (!cells.length) return false;
  const n = Math.max(1, Math.ceil(cells.length * Math.min(1, progress)));
  ctx.save();
  ctx.strokeStyle = th.own;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([2 * px, 5 * px]);
  ctx.lineCap = 'round';
  polyline(ctx, cells.slice(0, n), group.pos);
  ctx.restore();
  return true;
});

/** Eigene Stollen, gehoerte feindliche Stollen, Sprengtrichter */
registerDecor({
  id: 'underground',
  order: 20,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.sides) return;
    const th = d.theme, px = d.px;
    const own = st.sides[d.side];
    // Sprengtrichter: Kreide auf dem Lehm, ein heller Ring (Ueberraschung: es hat Kreide geregnet)
    const cells = d.cells ?? st.cells ?? {};
    ctx.save();
    for (const k of Object.keys(cells).sort()) {
      const c = cells[k];
      if (!c?.trichter) continue;
      const [x, y] = k.split(',').map(Number);
      const s = (x * 31 + y * 17) % 7;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = th.chalk;
      for (let i = 0; i < 4; i++) {
        const ox = ((s + i * 3) % 7) / 8 + 0.06, oy = ((s * 2 + i * 5) % 7) / 8 + 0.06;
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, 0.05 + ((s + i) % 3) * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    if (!own) return;
    // Eigene Stollen: gestrichelte Linie, gegraben kraeftig, geplant blass, Ladung als Kreis
    for (const t of [...(own.tunnels ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const dug = dugCells(t);
      const gone = t.status === 'collapsed' || t.status === 'blown';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = gone ? th.ink2 : th.own;
      ctx.globalAlpha = gone ? 0.45 : 0.9;
      ctx.lineWidth = 2.4 * px;
      ctx.setLineDash([7 * px, 5 * px]);
      if (dug.length) polyline(ctx, dug);
      if (!gone && t.dug < t.path.length) {
        ctx.globalAlpha = 0.35;
        ctx.setLineDash([2 * px, 6 * px]);
        polyline(ctx, t.path.slice(Math.max(0, t.dug - 1)));
      }
      ctx.restore();
      const head = dug[dug.length - 1] ?? t.path[0];
      if (t.status === 'charged') {
        ctx.save();
        ctx.strokeStyle = th.danger;
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.arc(head.x + 0.5, head.y + 0.5, 0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        note(ctx, 'geladen', head.x + 0.9, head.y + 0.5, th.danger, px);
      } else if (t.status === 'digging') {
        note(ctx, `${t.path.length - t.dug} F.`, head.x + 0.8, head.y + 0.2, th.own, px, 13);
      } else if (t.status === 'collapsed') {
        note(ctx, 'verschüttet', head.x + 0.8, head.y + 0.5, th.ink2, px, 13);
      }
    }
    // Gehoerte feindliche Stollen: zittrige Bleistiftlinie mit Fragezeichen, aeltere blasser
    const heard = own.heard ?? {};
    for (const id of Object.keys(heard).sort()) {
      const h = heard[id];
      if (!h?.cells?.length || h.gone) continue;
      const age = Math.max(0, (st.turn ?? 0) - (h.turn ?? 0));
      ctx.save();
      ctx.globalAlpha = age > 2 ? 0.45 : 0.85;
      ctx.strokeStyle = th.enemy;
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash([3 * px, 4 * px]);
      ctx.beginPath();
      h.cells.forEach((c, i) => {
        const w = ((c.x * 7 + c.y * 11 + i) % 5 - 2) * 0.06;
        const X = c.x + 0.5 + w, Y = c.y + 0.5 - w;
        if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
      });
      if (h.cells.length === 1) ctx.lineTo(h.cells[0].x + 0.6, h.cells[0].y + 0.55);
      ctx.stroke();
      ctx.restore();
      const last = h.cells[h.cells.length - 1];
      note(ctx, h.charged ? 'still. Ladung?' : '?', last.x + 0.75, last.y + 0.35, th.enemy, px, h.charged ? 14 : 20);
    }
  },
});

/** Offiziere und Veteranen: Bleistiftkuerzel unter dem Gruppensymbol (Z = Zugfuehrer, dann Eigenschaften) */
registerDecor({
  id: 'veterans',
  order: 95,
  draw(ctx, d) {
    if (!d.groups?.length || !d.cam) return;
    const th = d.theme, px = d.px;
    const box = unitBox(d.cam);
    for (const g of d.groups) {
      if (g.status === 'lost' || g.side !== d.side) continue;
      const marks = [];
      if (g.officer) {
        const last = String(g.officer.name ?? '').split(' ').pop();
        marks.push([g.officer.rank === 'Leutnant' ? 'Lt.' : 'Zf', last].filter(Boolean).join(' '));
      }
      for (const t of g.traits ?? []) if (TRAITS[t]) marks.push(TRAITS[t].short);
      if (!marks.length) continue;
      note(ctx, marks.join(' · '), g.pos.x + 0.5 - box.w / 2, g.pos.y + 0.5 + box.h / 2 + 0.28, th.pencil, px, 13);
    }
  },
});
