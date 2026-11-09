// Zeichnungen der Artillerie (P09) in Weltkoordinaten (1 = ein Feld). Reine Optik.
// - Feuerplaene als schraffierte Zeitbaender (eine Schraffur je Gefechtsrunde, abwechselnd geneigt), Beschriftung
//   mit Runde und Uhrzeit, Griffe fuer den Editor
// - Fernsprechleitungen mit Bruchstelle, Batterien, Sturm-Geister hinter der Walze
// - frische Trichter aus dem Spielzustand (bis P10 die eigentliche Kraterdarstellung liefert)
// - Ueberraschung: Brandloecher am Kartenrand nach Einschlaegen
import { createRng } from '../rng.js';
import { hashSeed } from './geometry.js';
import { FONTS } from './map-layer.js';
import { PLAN_KINDS, BATTERY_TYPES } from '../config/artillery.js';
import { DIR } from '../map.js';
import { planCellsAt, centerOf, targetCellsOf, batteryCenter, batteryType, batteryLinked, artilleryOf } from '../artillery.js';
import { cellKeys } from '../state.js';

const HANDLE_R = 11; // Bildschirmpixel

function cellsPath(cells) {
  const p = new Path2D();
  for (const c of cells) p.rect(c.x, c.y, 1, 1);
  return p;
}

/** Umriss einer Feldmenge als Rechteckkanten, die nach aussen zeigen */
function outline(ctx, cells) {
  const set = new Set(cells.map((c) => c.x + ',' + c.y));
  const has = (x, y) => set.has(x + ',' + y);
  ctx.beginPath();
  for (const c of cells) {
    if (!has(c.x, c.y - 1)) { ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + 1, c.y); }
    if (!has(c.x, c.y + 1)) { ctx.moveTo(c.x, c.y + 1); ctx.lineTo(c.x + 1, c.y + 1); }
    if (!has(c.x - 1, c.y)) { ctx.moveTo(c.x, c.y); ctx.lineTo(c.x, c.y + 1); }
    if (!has(c.x + 1, c.y)) { ctx.moveTo(c.x + 1, c.y); ctx.lineTo(c.x + 1, c.y + 1); }
  }
  ctx.stroke();
}

/** Schraffiertes Feldband. tilt +1/-1 wechselt die Neigung der Schraffur (Zeitbaender sind so unterscheidbar). */
export function drawBand(ctx, cells, { color, px, alpha = 1, tilt = 1, fill = 0.12, gap = 7, dashed = false, width = 1.3 }) {
  if (!cells.length) return;
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), x1 = Math.max(...xs) + 1, y1 = Math.max(...ys) + 1;
  ctx.save();
  ctx.globalAlpha = alpha;
  const path = cellsPath(cells);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * fill;
  ctx.fill(path);
  ctx.globalAlpha = alpha;
  ctx.save();
  ctx.clip(path);
  ctx.strokeStyle = color;
  ctx.lineWidth = width * px;
  const step = gap * px;
  const span = (x1 - x0) + (y1 - y0);
  ctx.beginPath();
  for (let s = -span; s < span; s += step) {
    if (tilt > 0) { ctx.moveTo(x0 + s, y1); ctx.lineTo(x0 + s + (y1 - y0), y0); }
    else { ctx.moveTo(x0 + s, y0); ctx.lineTo(x0 + s + (y1 - y0), y1); }
  }
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * px;
  if (dashed) ctx.setLineDash([5 * px, 4 * px]);
  outline(ctx, cells);
  ctx.restore();
}

function label(ctx, text, x, y, { color, halo, px, size = 12, font = FONTS.num, weight = 700, align = 'left', base = 'middle' }) {
  ctx.save();
  ctx.font = `${weight} ${size * px}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = base;
  ctx.lineJoin = 'round';
  if (halo) { ctx.strokeStyle = halo; ctx.lineWidth = 3.5 * px; ctx.strokeText(text, x, y); }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Uhrzeit einer Gefechtsrunde (5 Minuten je Runde), ab der Uhr des Zustands */
export function roundClock(clock, round, current = 1) {
  const m = clock.hour * 60 + clock.minute + (round - current) * 5;
  const t = ((m % 1440) + 1440) % 1440;
  return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
}

/**
 * Plan zeichnen. opts: { th, px, map, state, side, selected, faint, round (aktuelle Gefechtsrunde oder null),
 *   timeBands (alle Runden zeigen), clock }
 */
export function drawPlan(ctx, plan, o) {
  const { th, px } = o;
  const k = PLAN_KINDS[plan.kind];
  const color = o.selected ? th.accent : o.color ?? th.own;
  const alpha = o.faint ? 0.55 : 1;
  if (k.line) {
    const rounds = [];
    if (o.timeBands) for (let r = plan.start; r < plan.start + (k.moves ? plan.rounds : 1); r++) rounds.push(r);
    else rounds.push(o.round && o.round >= plan.start ? o.round : plan.start);
    rounds.forEach((r, i) => {
      const cells = planCellsAt({ ...plan, fired: 0 }, r, o.map);
      if (!cells.length) return;
      drawBand(ctx, cells, { color, px, alpha: alpha * (k.moves && o.timeBands ? 1 - i * 0.07 : 1), tilt: i % 2 ? -1 : 1, dashed: plan.kind === 'barrage', fill: o.selected ? 0.16 : 0.1 });
      if (k.moves && o.timeBands) {
        // Rundenmarke an der Spitze des Bandes: "R2 06:10"
        const end = cells.reduce((a, c) => (c.y < a.y || (c.y === a.y && c.x < a.x) ? c : a), cells[0]);
        label(ctx, `R${r}`, end.x + 0.5, end.y - 0.15, { color, halo: th.paper, px, size: 11, align: 'center', base: 'bottom' });
        if (o.clock && (i === 0 || i === rounds.length - 1)) {
          label(ctx, roundClock(o.clock, r, o.currentRound ?? 1), end.x + 0.5, end.y - 0.15 - 13 * px, { color: th.ink2, halo: th.paper, px, size: 10, weight: 400, align: 'center', base: 'bottom' });
        }
      }
    });
    if (!o.timeBands || !k.moves) {
      const cells = planCellsAt({ ...plan, fired: 0 }, rounds[0], o.map);
      const top = cells.reduce((a, c) => (c.y < a.y ? c : a), cells[0]);
      if (top) {
        const txt = plan.kind === 'barrage' ? 'Sperrfeuer auf Abruf'
          : plan.kind === 'creep' ? (o.round ? `Walze R${o.round}` : `Walze ab R${plan.start}`)
            : `${k.short} R${plan.start}${plan.rounds > 1 ? '–' + (plan.start + plan.rounds - 1) : ''}`;
        label(ctx, txt, top.x + 0.5, top.y - 0.2, { color, halo: th.paper, px, size: 11, align: 'center', base: 'bottom' });
      }
    }
  } else {
    const cells = targetCellsOf(plan, o.state, o.side, o.map);
    drawBand(ctx, cells, { color, px, alpha, fill: 0.14, gap: 5 });
    const top = cells[0];
    if (top) label(ctx, k.short, top.x, top.y - 0.2, { color, halo: th.paper, px, size: 11, base: 'bottom' });
  }
}

/** Fernsprechleitung: durchgezogen, an der Bruchstelle ein Kreuz und "durchtrennt" */
export function drawLine(ctx, line, { th, px, emph = false, map = null }) {
  ctx.save();
  ctx.strokeStyle = line.cut ? th.danger : emph ? th.ink : th.ink2;
  ctx.lineWidth = (emph ? 1.8 : 1.2) * px;
  ctx.setLineDash(emph ? [] : [6 * px, 4 * px]);
  ctx.beginPath();
  line.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.setLineDash([]);
  if (line.cut) {
    const x = line.cut.x + 0.5, y = line.cut.y + 0.5, s = 6 * px;
    ctx.lineWidth = 2.4 * px;
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
    ctx.stroke();
    // Die Karte beschriftet ihre urspruengliche Bruchstelle schon selbst
    const printed = (map?.cables ?? []).some((c) => c.cut && Math.abs(c.cut[0] - x) < 1.5 && Math.abs(c.cut[1] - y) < 1.5);
    if (!printed) label(ctx, 'Leitung durchtrennt', x + 9 * px, y, { color: th.danger, halo: th.paper, px, size: 13, font: FONTS.hand });
  }
  ctx.restore();
}

/** Batterie mit Kuerzel, Munition und Leitungsstatus (nur im Editor) */
export function drawBattery(ctx, b, art, { th, px, selected = false, used = false }) {
  ctx.save();
  ctx.strokeStyle = selected ? th.accent : th.ink;
  ctx.lineWidth = (selected ? 2.6 : 1.4) * px;
  ctx.strokeRect(b.pos.x + 0.1, b.pos.y + 0.1, b.w - 0.2, b.h - 0.2);
  const c = { x: b.pos.x + b.w / 2, y: b.pos.y + b.h + 0.15 };
  const link = batteryLinked(art, b);
  label(ctx, `${b.label} · ${b.ammo} Gr.${link ? '' : ' · ohne Leitung'}`, c.x, c.y, {
    color: link ? (used ? th.accent : th.ink) : th.danger, halo: th.paper, px, size: 11, align: 'center', base: 'top',
  });
  ctx.restore();
}

/** Reichweite einer Batterie als gestrichelter Bogen (Chebyshev-Quadrat wie die Regel) */
export function drawRange(ctx, b, { color, px, alpha = 0.6 }) {
  const c = batteryCenter(b), r = batteryType(b).range;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash([2 * px, 5 * px]);
  ctx.strokeRect(c.x - r, c.y - r, 2 * r + 1, 2 * r + 1);
  ctx.restore();
}

/** Sturm-Geister: gestrichelte Kaestchen je Runde, Linie dazwischen, Warnung in Rot */
export function drawStormGhosts(ctx, ghosts, { th, px, marks }) {
  const w = 22 * px, h = 15 * px;
  for (const g of ghosts) {
    const bad = !!g.warn;
    const color = bad ? th.danger : th.own;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4 * px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.beginPath();
    g.steps.forEach((s, i) => (i ? ctx.lineTo(s.pos.x + 0.5, s.pos.y + 0.5) : ctx.moveTo(s.pos.x + 0.5, s.pos.y + 0.5)));
    ctx.stroke();
    // Geister, die sich bei kleinem Massstab ueberdecken wuerden, auslassen (der letzte bleibt immer)
    let last = null;
    g.steps.forEach((s, i) => {
      const end = i === g.steps.length - 1;
      if (last && Math.abs(s.pos.x - last.x) < w * 1.8 && Math.abs(s.pos.y - last.y) < h * 1.8 && (!end || (s.pos.x === last.x && s.pos.y === last.y))) return;
      last = s.pos;
      ctx.fillStyle = th.paper;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(s.pos.x + 0.5 - w / 2, s.pos.y + 0.5 - h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = s.inFire ? th.danger : color;
      ctx.strokeRect(s.pos.x + 0.5 - w / 2, s.pos.y + 0.5 - h / 2, w, h);
      label(ctx, `${marks?.[g.group] ?? '?'}`, s.pos.x + 0.5, s.pos.y + 0.5, { color: s.inFire ? th.danger : color, px, size: 10, align: 'center' });
      label(ctx, `R${s.round}`, s.pos.x + 0.5, s.pos.y + 0.5 + h / 2 + 1 * px, { color: th.ink2, halo: th.paper, px, size: 9, weight: 400, align: 'center', base: 'top' });
    });
    if (bad) {
      const s = g.steps[g.steps.length - 1];
      label(ctx, g.warn, s.pos.x + 0.5, s.pos.y + 0.5 + h / 2 + 14 * px, { color: th.danger, halo: th.paper, px, size: 15, font: FONTS.hand, align: 'center', base: 'top' });
    }
    ctx.restore();
  }
}

/** Griff: Kreis mit Beschriftung (Start, Schritt, Ende). Liefert nichts, Treffer prueft der Editor selbst. */
export function drawHandle(ctx, x, y, text, { th, px, active = false }) {
  ctx.save();
  ctx.fillStyle = th.accent;
  ctx.strokeStyle = th.paper;
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.arc(x, y, (active ? HANDLE_R + 3 : HANDLE_R) * px, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = 1.4 * px;
  ctx.beginPath();
  ctx.arc(x, y, (active ? HANDLE_R + 3 : HANDLE_R) * px, 0, Math.PI * 2);
  ctx.stroke();
  if (text) label(ctx, text, x, y + (HANDLE_R + 3) * px, { color: th.ink, halo: th.paper, px, size: 11, align: 'center', base: 'top' });
  ctx.restore();
}

export const HANDLE_RADIUS = HANDLE_R;

/**
 * Weltpunkte der Griffe eines Linienplans: a, b (Linienenden), mid (ganze Linie verschieben) und bei der Walze
 * base/step: Lineal hinter dem Ende b, der Griff "Schritt" liegt step Felder in Planrichtung von base.
 */
export function planHandles(plan) {
  const d = DIR[plan.dir] ?? DIR.E;
  const out = {
    a: { x: plan.a.x + 0.5, y: plan.a.y + 0.5 },
    b: { x: plan.b.x + 0.5, y: plan.b.y + 0.5 },
    mid: { x: (plan.a.x + plan.b.x) / 2 + 0.5, y: (plan.a.y + plan.b.y) / 2 + 0.5 },
  };
  if (PLAN_KINDS[plan.kind]?.moves) {
    const vx = plan.b.x - plan.a.x, vy = plan.b.y - plan.a.y;
    const len = Math.hypot(vx, vy) || 1;
    const ux = vx ? vx / len : -d.dy, uy = vx || vy ? vy / len : d.dx;
    out.base = { x: out.b.x + ux * 1.8, y: out.b.y + uy * 1.8 };
    out.step = { x: out.base.x + d.dx * (plan.step ?? 1), y: out.base.y + d.dy * (plan.step ?? 1) };
  }
  return out;
}

/** Frische Trichter aus dem Spielzustand (Daten von P09, die eigentliche Optik bringt P10) */
export function drawFreshCraters(ctx, state, map, { th, px }) {
  ctx.save();
  for (const k of cellKeys(state)) {
    const c = state.cells[k];
    if (!c.shelled) continue;
    const [x, y] = k.split(',').map(Number);
    const rng = createRng(hashSeed('krater', x, y));
    const n = Math.min(3, c.shelled);
    for (let i = 0; i < n; i++) {
      const cx = x + 0.25 + rng() * 0.5, cy = y + 0.25 + rng() * 0.5;
      const r = (c.crater === 2 ? 0.32 : 0.2) + rng() * 0.08;
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = th.crater;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = th.ink2;
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      ctx.arc(cx, cy, r, rng() * 6, rng() * 6 + 3.6);
      ctx.stroke();
    }
    // Rauch ueber ganz frischen Einschlaegen: ein paar Bleistiftkringel
    if (c.fresh != null && c.fresh >= state.turn - 1) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = th.pencil;
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) ctx.arc(x + 0.35 + i * 0.15, y + 0.1 - i * 0.08, 0.12 + i * 0.04, 3.4, 6);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Brandloch am Kartenrand (Ueberraschung P09): verkohlter Rand, dunkler Kern, ein paar Glutpunkte bei frischen.
 * b = { x, y, r, seed, age } in Weltkoordinaten.
 */
export function drawBurn(ctx, b, { th, px }) {
  const rng = createRng(b.seed >>> 0);
  const pts = [];
  const n = 13;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = b.r * (0.7 + rng() * 0.45);
    pts.push([b.x + Math.cos(a) * rr, b.y + Math.sin(a) * rr]);
  }
  const ring = (scale) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => {
      const sx = b.x + (x - b.x) * scale, sy = b.y + (y - b.y) * scale;
      i ? ctx.lineTo(sx, sy) : ctx.moveTo(sx, sy);
    });
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = th.stain;
  ring(1.6);
  ctx.fill();
  // verkohlter Rand: Kaffeefleck-Ton aus dem Thema, kraeftig und doppelt gelegt
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = th.stain;
  ring(1.15);
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = th.ink;
  ring(1.0);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = th.desk;
  ring(0.85);
  ctx.fill();
  if (b.age === 0) {
    ctx.fillStyle = th.accent;
    for (let i = 0; i < 4; i++) {
      const a = rng() * Math.PI * 2;
      ctx.globalAlpha = 0.5 + rng() * 0.4;
      ctx.beginPath();
      ctx.arc(b.x + Math.cos(a) * b.r * 1.02, b.y + Math.sin(a) * b.r * 1.02, 1.6 * px, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * Ort eines Brandlochs zu einem Einschlag: der naechste Kartenrand, mitten im Blattrand (SHEET_MARGIN 3 Felder).
 */
export function burnSpot(map, at, seed) {
  const rng = createRng(seed >>> 0);
  const d = [
    { e: 'w', v: at.x }, { e: 'e', v: map.width - 1 - at.x }, { e: 'n', v: at.y }, { e: 's', v: map.height - 1 - at.y },
  ].sort((a, b) => a.v - b.v)[0].e;
  const off = 0.55 + rng() * 0.8;
  const j = (rng() - 0.5) * 2;
  const r = 0.5 + rng() * 0.5;
  if (d === 'w') return { x: -off, y: at.y + 0.5 + j, r, seed };
  if (d === 'e') return { x: map.width + off, y: at.y + 0.5 + j, r, seed };
  if (d === 'n') return { x: at.x + 0.5 + j, y: -off, r, seed };
  return { x: at.x + 0.5 + j, y: map.height + off, r, seed };
}

/**
 * Bedrohungs-Overlay (Taste 2): aufgeklaerte feindliche Batterien mit Stellung, Reichweite (gestrichelt) und Alter.
 */
export function drawEnemyBatteries(ctx, state, side, { th, px, color }) {
  const known = artilleryOf(state, side).known ?? {};
  for (const id of Object.keys(known).sort()) {
    const e = known[id];
    const t = BATTERY_TYPES[e.type] ?? BATTERY_TYPES.feldhaubitzen;
    const c = { x: e.pos.x + Math.floor(((e.w ?? 2) - 1) / 2), y: e.pos.y + Math.floor(((e.h ?? 2) - 1) / 2) };
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.3 * px;
    ctx.setLineDash([2 * px, 6 * px]);
    ctx.strokeRect(c.x - t.range, c.y - t.range, 2 * t.range + 1, 2 * t.range + 1);
    ctx.globalAlpha = 1;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.lineWidth = 2 * px;
    ctx.strokeRect(e.pos.x, e.pos.y, e.w ?? 2, e.h ?? 2);
    ctx.restore();
    const age = Math.max(0, state.turn - e.turn);
    label(ctx, `Batterie, ${t.short}`, e.pos.x + (e.w ?? 2) / 2, e.pos.y - 0.15, { color, halo: th.paper, px, size: 15, font: FONTS.hand, align: 'center', base: 'bottom' });
    label(ctx, age ? `Mündungsblitz vor ${age} ${age === 1 ? 'Runde' : 'Runden'}` : 'Mündungsblitz gesehen', e.pos.x + (e.w ?? 2) / 2, e.pos.y + (e.h ?? 2) + 0.1, { color, halo: th.paper, px, size: 13, font: FONTS.hand, align: 'center', base: 'top' });
  }
}

/**
 * Artillerie der planenden Seite auf der Lagekarte (ausserhalb des Editors): scharfe Plaene als Band der aktuellen
 * Runde, durchtrennte Leitungen, frische Trichter, Brandloecher.
 */
export function drawArtilleryMap(ctx, { state, map, side, theme: th, px, pending = null, burns = [] }) {
  drawFreshCraters(ctx, state, map, { th, px });
  const art = artilleryOf(state, side);
  const battle = state.turnKind === 'battle';
  const round = battle ? state.battle?.round ?? 1 : null;
  const plans = pending ?? art.plans;
  for (const p of plans) {
    if (PLAN_KINDS[p.kind]?.round !== 'battle') continue;
    if (battle && !planCellsAt(p, round, map).length) continue;
    drawPlan(ctx, p, { th, px, map, state, side, faint: !battle, round, color: side === 'a' ? th.own : th.enemy });
  }
  for (const l of art.lines) if (l.cut) drawLine(ctx, l, { th, px, map });
  for (const b of burns) drawBurn(ctx, b, { th, px });
}

export { centerOf };
