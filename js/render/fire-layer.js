// Zeichnungen fuer Feuer, Sicht und Nebel des Krieges (P05). Reine Optik in Weltkoordinaten (1 = ein Feld).
// - MG-Kegel als schraffierter Faecher
// - Sichtlinie beim Zeigen: frei bis zum Hindernis, danach gestrichelt, Kreuz am Hindernis
// - Feuerbefehl als Bleistiftlinie mit Zielkreuz
// - Unterdrueckung als Bleistift-Zickzack ueber dem Symbol
// - Geister (Ueberraschung P05): zuletzt gesehene Feinde sind mit Bleistift skizziert. Jede Runde wird die Skizze
//   blasser und lueckenhafter, als haette jemand mit dem Radiergummi darueber gerieben; Kruemel bleiben liegen.
import { createRng } from '../rng.js';
import { jitterPolyline, hashSeed } from './geometry.js';
import { FONTS } from './map-layer.js';
import { unitBox } from './units-layer.js';

const MARK = { mg: 'MG', pioneers: 'Pi', medics: 'San', runners: 'Me', observers: 'Beo', mortar: 'Mö' };

/** Winkel einer Richtung (Optik, hier sind Winkelfunktionen erlaubt) */
function angleTo(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/**
 * Feuerkegel: from/aim in Feldern, width in Grad, range in Feldern.
 * opts: { color, px, alpha, dashed, hatch (Abstand in Bildschirmpixeln), label }
 */
export function drawCone(ctx, from, aim, width, range, { color, px, alpha = 1, dashed = false, hatch = 9, fillAlpha = 0.07 } = {}) {
  if (aim.x === from.x && aim.y === from.y) return;
  const cx = from.x + 0.5, cy = from.y + 0.5;
  const a = angleTo(from, aim);
  const half = (width / 2) * (Math.PI / 180);
  const r = range + 0.5;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a - half, a + half);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * fillAlpha;
  ctx.fill();
  ctx.globalAlpha = alpha;
  // Schraffur quer zur Schussrichtung, im Kegel abgeschnitten
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1 * px;
  ctx.globalAlpha = alpha * 0.45;
  const step = hatch * px;
  ctx.beginPath();
  for (let s = -r; s <= r; s += step) {
    // Linien unter 45 Grad zur Kegelachse
    const ux = Math.cos(a + Math.PI / 4), uy = Math.sin(a + Math.PI / 4);
    const nx = -uy, ny = ux;
    ctx.moveTo(cx + nx * s - ux * r, cy + ny * s - uy * r);
    ctx.lineTo(cx + nx * s + ux * r, cy + ny * s + uy * r);
  }
  ctx.stroke();
  ctx.restore();
  ctx.globalAlpha = alpha * 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.4 * px;
  if (dashed) ctx.setLineDash([6 * px, 4 * px]);
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, r, a - half, a + half);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/**
 * Sichtlinie von from nach to. blockedAt: erstes Hindernis oder null.
 */
export function drawSightLine(ctx, from, to, blockedAt, { th, px, label = '' }) {
  const ax = from.x + 0.5, ay = from.y + 0.5, bx = to.x + 0.5, by = to.y + 0.5;
  ctx.save();
  ctx.lineCap = 'round';
  if (!blockedAt) {
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.6 * px;
    ctx.setLineDash([2 * px, 3 * px]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    // Auge am Ziel: kleiner Kreis
    ctx.beginPath(); ctx.arc(bx, by, 4 * px, 0, Math.PI * 2); ctx.stroke();
  } else {
    const kx = blockedAt.x + 0.5, ky = blockedAt.y + 0.5;
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 1.6 * px;
    ctx.setLineDash([2 * px, 3 * px]);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.strokeStyle = th.danger;
    ctx.globalAlpha = 0.7;
    ctx.setLineDash([5 * px, 5 * px]);
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(bx, by); ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 2.2 * px;
    const s = 5 * px;
    ctx.beginPath();
    ctx.moveTo(kx - s, ky - s); ctx.lineTo(kx + s, ky + s);
    ctx.moveTo(kx + s, ky - s); ctx.lineTo(kx - s, ky + s);
    ctx.stroke();
  }
  if (label) {
    ctx.font = `700 ${18 * px}px ${FONTS.hand}`;
    ctx.fillStyle = blockedAt ? th.danger : th.ink;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = th.paper;
    ctx.lineWidth = 4 * px;
    ctx.lineJoin = 'round';
    ctx.strokeText(label, bx + 18 * px, by - 9 * px);
    ctx.fillText(label, bx + 18 * px, by - 9 * px);
  }
  ctx.restore();
}

/** Feuerbefehl: Bleistiftlinie zum Ziel, Zielkreuz im Kreis */
export function drawFireOrder(ctx, from, target, { color, px, seed = 0, preview = false }) {
  const raw = [[from.x + 0.5, from.y + 0.5], [target.x + 0.5, target.y + 0.5]];
  const pts = preview ? raw : jitterPolyline(raw, 0.06, seed, 0.4);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8 * px;
  ctx.setLineDash([7 * px, 4 * px]);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.stroke();
  ctx.setLineDash([]);
  const tx = target.x + 0.5, ty = target.y + 0.5, r = Math.max(0.42, 9 * px);
  ctx.lineWidth = 2 * px;
  ctx.beginPath();
  ctx.arc(tx, ty, r, 0, Math.PI * 2);
  ctx.moveTo(tx - r * 1.4, ty); ctx.lineTo(tx - r * 0.4, ty);
  ctx.moveTo(tx + r * 0.4, ty); ctx.lineTo(tx + r * 1.4, ty);
  ctx.moveTo(tx, ty - r * 1.4); ctx.lineTo(tx, ty - r * 0.4);
  ctx.moveTo(tx, ty + r * 0.4); ctx.lineTo(tx, ty + r * 1.4);
  ctx.stroke();
  ctx.restore();
}

/** Unterdrueckung: ein Zickzack ab 0,3, zwei ab niedergehalten */
export function drawSuppression(ctx, cam, g, th, px, pinned) {
  if (!(g.suppressed >= 0.3)) return;
  const { w, h } = unitBox(cam);
  const x0 = g.pos.x + 0.5 - w / 2, y0 = g.pos.y + 0.5 - h / 2 - 6 * px;
  ctx.save();
  ctx.strokeStyle = th.danger;
  ctx.lineWidth = 1.6 * px;
  const rows = pinned ? 2 : 1;
  for (let r = 0; r < rows; r++) {
    const y = y0 - r * 5 * px;
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = x0 + (w * i) / n;
      const yy = y + (i % 2 ? -2.2 * px : 0);
      if (i) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Alter als Bleistifttext */
export function ageText(age) {
  if (age <= 0) return 'eben noch';
  return age === 1 ? 'vor 1 Runde' : `vor ${age} Runden`;
}

/** Deckkraft eines Geistes nach Alter: jede Runde blasser */
export function ghostAlpha(age) {
  return Math.max(0.2, 0.92 - age * 0.11);
}

/** Skizzierte, teilweise radierte Linie: Segmente fallen je nach Alter aus */
function sketchLine(ctx, a, b, rng, erase, px) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.round(len / (5 * px)));
  ctx.beginPath();
  let pen = false;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t + (rng() - 0.5) * 1.6 * px;
    const y = a[1] + (b[1] - a[1]) * t + (rng() - 0.5) * 1.6 * px;
    const gone = i > 0 && rng() < erase;
    if (gone) { pen = false; continue; }
    if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
  }
  ctx.stroke();
}

/**
 * Geist: Bleistiftskizze eines zuletzt gesehenen Feindes.
 * gh = { id, pos, age, type }, opts: { label (Altersnotiz), color }
 */
export function drawGhost(ctx, cam, th, gh, { color = th.enemy, label = true } = {}) {
  const px = 1 / cam.zoom;
  const { w, h } = unitBox(cam);
  const cx = gh.pos.x + 0.5, cy = gh.pos.y + 0.5;
  const x = cx - w / 2, y = cy - h / 2;
  const age = gh.age ?? 0;
  const erase = Math.min(0.55, age * 0.08);
  const rng = createRng(hashSeed(gh.id, gh.pos.x, gh.pos.y));
  ctx.save();
  ctx.globalAlpha = ghostAlpha(age);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.3 * px;
  // Zwei Striche je Kante, leicht versetzt und ueberstehend, wie schnell skizziert
  const o = 2.5 * px;
  for (let pass = 0; pass < 2; pass++) {
    const d = pass ? 1.2 * px : -0.8 * px;
    sketchLine(ctx, [x - o, y + d], [x + w + o, y - d], rng, erase, px);
    sketchLine(ctx, [x + w + d, y - o], [x + w - d, y + h + o], rng, erase, px);
    sketchLine(ctx, [x + w + o, y + h + d], [x - o, y + h - d], rng, erase, px);
    sketchLine(ctx, [x + d, y + h + o], [x - d, y - o], rng, erase, px);
  }
  // Radierspur: ein heller Wisch quer ueber die Skizze, ab der zweiten Runde
  if (age >= 2) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.55, 0.12 * age);
    ctx.fillStyle = th.paper;
    ctx.translate(cx, cy);
    ctx.rotate(-0.35 + (rng() - 0.5) * 0.3);
    ctx.beginPath();
    ctx.ellipse((rng() - 0.5) * w * 0.3, 0, w * 0.55, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // Kruemel
    ctx.fillStyle = th.pencil;
    const n = Math.min(7, age + 1);
    for (let i = 0; i < n; i++) {
      const kx = x + w + 3 * px + rng() * 10 * px, ky = y + h * 0.3 + rng() * h;
      ctx.fillRect(kx, ky, 1.6 * px, 1.2 * px);
    }
  }
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const mark = MARK[gh.type];
  ctx.font = `700 ${Math.min(h * 0.85, 17 * px)}px ${FONTS.hand}`;
  ctx.fillText(mark ? mark + '?' : '?', cx, cy + 0.5 * px);
  if (label && px < 1 / 9) {
    ctx.globalAlpha = Math.max(0.7, ghostAlpha(age));
    ctx.font = `700 ${15 * px}px ${FONTS.hand}`;
    ctx.textAlign = 'left';
    ctx.strokeStyle = th.paper;
    ctx.lineWidth = 3.5 * px;
    ctx.lineJoin = 'round';
    ctx.strokeText(ageText(age), x + w + 6 * px, cy);
    ctx.fillText(ageText(age), x + w + 6 * px, cy);
  }
  ctx.restore();
}

/** Bewegungsspur eines Geistes: gestrichelter Pfeil vom frueheren zum letzten Ort */
export function drawGhostTrail(ctx, gh, { color, px, alpha = 1 }) {
  if (!gh.from) return;
  const ax = gh.from.x + 0.5, ay = gh.from.y + 0.5, bx = gh.pos.x + 0.5, by = gh.pos.y + 0.5;
  const d = Math.hypot(bx - ax, by - ay);
  if (d < 0.5) return;
  const ux = (bx - ax) / d, uy = (by - ay) / d;
  const stop = Math.min(d - 0.2, 0.9);
  const ex = bx - ux * stop, ey = by - uy * stop;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([4 * px, 4 * px]);
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.setLineDash([]);
  const s = 7 * px;
  ctx.beginPath();
  ctx.moveTo(ex - ux * s - uy * s * 0.55, ey - uy * s + ux * s * 0.55);
  ctx.lineTo(ex, ey);
  ctx.lineTo(ex - ux * s + uy * s * 0.55, ey - uy * s - ux * s * 0.55);
  ctx.stroke();
  ctx.restore();
}
