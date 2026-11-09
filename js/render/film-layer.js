// Spuren im Phasenfilm (P07, Bild feature-02): wo eine Gruppe zu Beginn der Runde stand (gestrichelter Geist)
// und welchen Weg sie bis jetzt gegangen ist (Bleistiftspur). Wird als Overlay unter den Gruppen gezeichnet.
import { jitterPolyline, hashSeed } from './geometry.js';
import { unitBox } from './units-layer.js';

/**
 * trails: [{ id, side, pts: [{x,y}, ...] }] (Feldkoordinaten, Kommastellen erlaubt)
 */
export function drawFilmTrails(ctx, { cam, theme: th, px }, trails) {
  const { w, h } = unitBox(cam);
  for (const tr of trails) {
    if (tr.pts.length < 2) continue;
    const color = tr.side === 'a' ? th.own : th.enemy;
    const raw = tr.pts.map((p) => [p.x + 0.5, p.y + 0.5]);
    const pts = jitterPolyline(raw, 0.05, hashSeed(tr.id, 7), 0.4);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 2 * px;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    // Geist am Ausgangsort
    const s = tr.pts[0];
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.lineWidth = 1.6 * px;
    ctx.strokeRect(s.x + 0.5 - w / 2, s.y + 0.5 - h / 2, w, h);
    ctx.restore();
  }
}
