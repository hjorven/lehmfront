// Dynamische Ebene des Gefechtsbildschirms (P03): Gruppen, Befehlspfeile, Zielvorschau, Overlays.
// Zeichnet in Weltkoordinaten ueber der statischen Karte (applyCameraTransform). Reine Optik.
// Befehlspfeile sehen aus wie mit Bleistift gezogen; ein frischer Pfeil wird sichtbar nachgezeichnet
// (progress 0..1), die Bleistiftspitze faehrt dabei mit (Ueberraschung P03).
import { applyCameraTransform } from './camera.js';
import { jitterPolyline, polyLength, hashSeed } from './geometry.js';
import { FONTS } from './map-layer.js';
import { drawCone, drawSightLine, drawFireOrder, drawGhost, drawSuppression } from './fire-layer.js';
import { sectorOf, PINNED } from '../sight.js';
import { unitType } from '../config/units.js';
import { allDecors, orderPainter } from './decor.js';

/** Groesse des Gruppensymbols in Feldern: mindestens 26 x 17 Bildschirmpixel */
export function unitBox(cam) {
  const px = 1 / cam.zoom;
  return { w: Math.max(1.5, 28 * px), h: Math.max(1, 18 * px) };
}

/** Liegt der Weltpunkt im Symbol der Gruppe? */
export function hitUnit(cam, group, wx, wy) {
  const b = unitBox(cam);
  return Math.abs(wx - (group.pos.x + 0.5)) <= b.w / 2 + 0.15 && Math.abs(wy - (group.pos.y + 0.5)) <= b.h / 2 + 0.15;
}

/** Linienzug durch die Feldmitten, Start bei der Gruppe */
export function pathPoints(from, path) {
  return [[from.x + 0.5, from.y + 0.5], ...path.map((p) => [p.x + 0.5, p.y + 0.5])];
}

/** Linienzug bis zur Bogenlaenge s abschneiden */
export function cutPolyline(pts, s) {
  if (s <= 0) return [pts[0]];
  const out = [pts[0]];
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (acc + d >= s) {
      const t = d ? (s - acc) / d : 0;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      return out;
    }
    out.push(b);
    acc += d;
  }
  return out;
}

function stroke(ctx, pts) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
}

function arrowHead(ctx, pts, size) {
  if (pts.length < 2) return;
  const b = pts[pts.length - 1];
  // Richtung aus einem Punkt etwas weiter hinten, damit das Zittern die Spitze nicht verdreht
  let a = pts[pts.length - 2];
  for (let i = pts.length - 2; i >= 0; i--) {
    a = pts[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > size * 1.2) break;
  }
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / d, uy = (b[1] - a[1]) / d;
  ctx.beginPath();
  ctx.moveTo(b[0] - ux * size - uy * size * 0.55, b[1] - uy * size + ux * size * 0.55);
  ctx.lineTo(b[0], b[1]);
  ctx.lineTo(b[0] - ux * size + uy * size * 0.55, b[1] - uy * size - ux * size * 0.55);
  ctx.stroke();
}

/** Bleistift an der Spitze eines frischen Pfeils: Holz in Akzentfarbe, Graphitspitze in Tinte */
function pencil(ctx, x, y, px, th) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.85);
  const s = px;
  ctx.fillStyle = th.accent;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1 * s;
  // Koerper
  ctx.beginPath();
  ctx.rect(9 * s, -3.5 * s, 22 * s, 7 * s);
  ctx.fill();
  ctx.stroke();
  // Holzkegel und Mine
  ctx.fillStyle = th.card;
  ctx.beginPath();
  ctx.moveTo(9 * s, -3.5 * s); ctx.lineTo(0, 0); ctx.lineTo(9 * s, 3.5 * s); ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.beginPath();
  ctx.moveTo(3 * s, -1.2 * s); ctx.lineTo(0, 0); ctx.lineTo(3 * s, 1.2 * s); ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Einen Bewegungsbefehl zeichnen. reach = Felder, die diese Runde erreicht werden (Rest gestrichelt).
 * progress < 1: Pfeil wird gerade gezogen.
 */
export function drawPathOrder(ctx, from, path, { reach = path.length, progress = 1, color, th, px, seed = 0, preview = false }) {
  const raw = pathPoints(from, path);
  const pts = preview ? raw : jitterPolyline(raw, 0.07, seed, 0.35);
  const total = polyLength(pts);
  const drawn = progress >= 1 ? pts : cutPolyline(pts, total * progress);
  // Grenze erreichbar/Rest auf dem unverzerrten Weg suchen und auf den gezitterten uebertragen
  const reachLen = reach >= path.length ? Infinity : polyLength(raw.slice(0, reach + 1)) * (total / (polyLength(raw) || 1));
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.lineWidth = (preview ? 2 : 2.4) * px;
  if (preview) ctx.setLineDash([6 * px, 5 * px]);
  const solid = reachLen === Infinity ? drawn : cutPolyline(drawn, reachLen);
  stroke(ctx, solid);
  if (reachLen !== Infinity && polyLength(drawn) > reachLen) {
    // Rest: gestrichelt und blasser, Haltemarke am Rundenende
    const restPts = [];
    let acc = 0;
    for (let i = 1; i < drawn.length; i++) {
      const a = drawn[i - 1], b = drawn[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + d >= reachLen) {
        if (!restPts.length) {
          const t = d ? (reachLen - acc) / d : 0;
          restPts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        }
        restPts.push(b);
      }
      acc += d;
    }
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4 * px, 5 * px]);
    stroke(ctx, restPts);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    const m = restPts[0];
    if (m) {
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(m[0] - 5 * px, m[1] - 5 * px); ctx.lineTo(m[0] + 5 * px, m[1] + 5 * px);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);
  if (progress >= 1 || preview) {
    ctx.lineWidth = 2.4 * px;
    arrowHead(ctx, drawn, 9 * px);
  }
  ctx.restore();
  const tip = drawn[drawn.length - 1];
  if (progress < 1 && tip) pencil(ctx, tip[0], tip[1], px, th);
}

function roundRect(ctx, x, y, w, h) {
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

/**
 * Gruppensymbol: Rechteck mit Kuerzel wie im Mockup. Eigene Seite a blau, Seite b rot.
 * opts: { selected, idle (ohne Befehl: Bleistift-Fragezeichen), hold (ausdruecklich halten), ghost }
 */
export function drawUnit(ctx, cam, th, g, mark, opts = {}) {
  const px = 1 / cam.zoom;
  const { w, h } = unitBox(cam);
  const cx = g.pos.x + 0.5, cy = g.pos.y + 0.5;
  const x = cx - w / 2, y = cy - h / 2;
  const color = g.side === 'a' ? th.own : th.enemy;
  ctx.save();
  if (opts.selected) {
    ctx.strokeStyle = th.accent;
    ctx.lineWidth = 3.5 * px;
    ctx.strokeRect(x - 4 * px, y - 4 * px, w + 8 * px, h + 8 * px);
  }
  ctx.globalAlpha = opts.ghost ? 0.7 : 1;
  ctx.fillStyle = th.card;
  roundRect(ctx, x, y, w, h);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * px;
  if (opts.ghost) ctx.setLineDash([4 * px, 3 * px]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = opts.ghost ? color : th.ink;
  ctx.font = `700 ${Math.min(h * 0.62, 13 * px)}px ${FONTS.num}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(opts.ghost ? '?' : mark, cx, cy + 0.5 * px);
  // Staerke als feiner Balken unter dem Symbol
  if (!opts.ghost && g.size) {
    const f = Math.max(0, Math.min(1, g.strength / g.size));
    ctx.fillStyle = th.track;
    ctx.fillRect(x, y + h + 2 * px, w, 2.5 * px);
    ctx.fillStyle = color;
    ctx.fillRect(x, y + h + 2 * px, w * f, 2.5 * px);
  }
  if (opts.hold) {
    ctx.strokeStyle = th.pencil;
    ctx.lineWidth = 2 * px;
    const hx = x + w + 5 * px, hy = y + 1 * px;
    ctx.beginPath();
    ctx.moveTo(hx, hy); ctx.lineTo(hx, hy + h - 2 * px);
    ctx.moveTo(hx + 4 * px, hy); ctx.lineTo(hx + 4 * px, hy + h - 2 * px);
    ctx.stroke();
  }
  if (opts.idle) {
    ctx.fillStyle = th.pencil;
    ctx.font = `700 ${16 * px}px ${FONTS.hand}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText('?', x + w + 3 * px, y + 3 * px);
  }
  ctx.restore();
}

/** Zielfeld der Vorschau */
export function drawTargetCell(ctx, cell, color, px, ok = true) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5 * px;
  if (!ok) ctx.setLineDash([3 * px, 3 * px]);
  ctx.strokeRect(cell.x + 0.06, cell.y + 0.06, 0.88, 0.88);
  if (!ok) {
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(cell.x + 0.25, cell.y + 0.25); ctx.lineTo(cell.x + 0.75, cell.y + 0.75);
    ctx.moveTo(cell.x + 0.75, cell.y + 0.25); ctx.lineTo(cell.x + 0.25, cell.y + 0.75);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Ganze dynamische Ebene zeichnen.
 * d = { state, map, side, groups (sichtbar, mit mark), ghosts, orders: Map(groupId -> order), selectedId,
 *       planning (true: Fragezeichen fuer Gruppen ohne Befehl), reach: Map(groupId -> Felder diese Runde),
 *       anim: { group, progress }, preview: { group, path, reach, cell, ok, sight?, fire?, cone? }, overlays: [overlay], hover,
 *       sightLine?: { from, to, blockedAt, label } }
 */
export function drawBattle(ctx, cam, dpr, th, d) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  applyCameraTransform(ctx, cam, dpr);
  const px = 1 / cam.zoom;

  for (const dec of allDecors()) {
    try { dec.draw(ctx, { ...d, cam, theme: th, px }); } catch (err) { console.error(err); }
  }
  for (const o of d.overlays ?? []) {
    try { o.draw(ctx, { cam, theme: th, map: d.map, state: d.state, side: d.side, px }); } catch (err) { console.error(err); }
  }

  // MG-Kegel (P05): eigene MGs immer, feindliche, sobald man sie feuern sah. Ein geplanter Sektor gilt schon.
  for (const g of d.groups) {
    if (g.status === 'lost' || g.type !== 'mg') continue;
    const own = g.side === d.side;
    if (!own && !g.sector) continue;
    const o = own ? d.orders.get(g.id) : null;
    const planned = d.preview?.cone && d.preview.group === g.id ? d.preview.cone.aim : o?.type === 'sector' ? o.target : null;
    const sec = sectorOf(planned ? { ...g, sector: planned } : g);
    if (!sec) continue;
    drawCone(ctx, g.pos, sec.aim, sec.width, unitType(g.type).range, {
      color: g.side === 'a' ? th.own : th.enemy, px, alpha: own ? (planned ? 0.95 : 0.6) : 0.8, dashed: !!planned,
    });
  }

  if (d.hover) {
    ctx.save();
    ctx.strokeStyle = th.ink;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5 * px;
    ctx.strokeRect(d.hover.x + 0.05, d.hover.y + 0.05, 0.9, 0.9);
    ctx.restore();
  }

  // Befehlspfeile unter den Symbolen
  for (const g of d.groups) {
    const o = d.orders.get(g.id);
    if (o?.type === 'fire' && o.target && !(d.preview && d.preview.group === g.id)) {
      drawFireOrder(ctx, g.pos, o.target, { color: th.pencil, px, seed: hashSeed(g.id, o.target.x, o.target.y) });
      continue;
    }
    if (!o?.path?.length) continue;
    if (d.preview && d.preview.group === g.id) continue;
    const progress = d.anim && d.anim.group === g.id ? d.anim.progress : 1;
    const paint = orderPainter(o.type);
    if (paint) {
      let done = false;
      try { done = paint(ctx, { group: g, order: o, th, px, progress, d }); } catch (err) { console.error(err); }
      if (done) continue;
    }
    drawPathOrder(ctx, g.pos, o.path, {
      reach: d.reach?.get(g.id) ?? o.path.length, progress, color: th.pencil, th, px, seed: hashSeed(g.id, o.path.length),
    });
  }
  if (d.preview?.path) {
    const g = d.groups.find((x) => x.id === d.preview.group);
    if (g) drawPathOrder(ctx, g.pos, d.preview.path, { reach: d.preview.reach, color: th.accent, th, px, preview: true });
  }
  if (d.preview?.sight) {
    const sl = d.preview.sight;
    drawSightLine(ctx, sl.from, sl.to, sl.blockedAt, { th, px, label: sl.label });
  }
  if (d.preview?.fire) {
    const g = d.groups.find((x) => x.id === d.preview.group);
    if (g) drawFireOrder(ctx, g.pos, d.preview.fire, { color: th.accent, px, preview: true });
  }
  if (d.preview?.cell && !d.preview.fire) drawTargetCell(ctx, d.preview.cell, d.preview.ok ? th.accent : th.danger, px, d.preview.ok);
  if (d.sightLine) drawSightLine(ctx, d.sightLine.from, d.sightLine.to, d.sightLine.blockedAt, { th, px, label: d.sightLine.label });

  for (const gh of d.ghosts ?? []) drawGhost(ctx, cam, th, gh, { color: gh.side === 'a' ? th.own : th.enemy });
  for (const g of d.groups) {
    if (g.status === 'lost') continue;
    const o = d.orders.get(g.id);
    drawUnit(ctx, cam, th, g, g.mark, {
      selected: g.id === d.selectedId,
      idle: d.planning && g.side === d.side && !o && g.status !== 'rest',
      hold: o?.type === 'hold',
    });
    if (g.side === d.side || g.suppressed !== undefined) drawSuppression(ctx, cam, g, th, px, g.suppressed >= PINNED);
  }
}
