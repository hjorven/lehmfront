// Overlay 2 Bedrohung (Plan 7.4, Bild feature-07): was die eigene Seite ueber den Gegner weiss.
// Schraffiert: bekannte MG-Kegel (aus Aufklaerung oder beim Feuern gesehen), verblassen mit dem Alter.
// Gestrichelte Pfeile: zuletzt gesehene Bewegung mit Richtung und Alter. Geister tragen ihre Quelle (Luftbild ...).
// Artilleriereichweiten meldet P09 hier spaeter dazu.
import { registerOverlay } from '../overlays.js';
import { viewFor } from '../../view.js';
import { unitType } from '../../config/units.js';
import { directionOf } from '../../sight.js';
import { drawCone, drawGhostTrail, ghostAlpha, ageText } from '../../render/fire-layer.js';
import { FONTS } from '../../render/map-layer.js';

let cache = { state: null, side: null, view: null };
function viewOf(state, map, side) {
  if (cache.state !== state || cache.side !== side) cache = { state, side, view: viewFor(state, [], side, { map }) };
  return cache.view;
}

registerOverlay({
  slot: 2,
  id: 'threat',
  label: 'Bedrohung',
  draw(ctx, { map, state, side, theme, px }) {
    const v = viewOf(state, map, side);
    const foeColor = side === 'a' ? theme.enemy : theme.own;
    // Sichtbare MGs zeichnet die Einheitenebene schon; hier nur das Wissen ueber nicht sichtbare
    const known = v.ghosts.filter((g) => g.sector);
    for (const g of known) {
      const t = unitType(g.type ?? 'mg');
      drawCone(ctx, g.pos, g.sector, t.sector ?? 60, t.range, {
        color: foeColor, px, alpha: ghostAlpha(g.age), dashed: g.age > 0, hatch: 6, fillAlpha: 0.1,
      });
    }
    ctx.save();
    ctx.font = `700 ${16 * px}px ${FONTS.hand}`;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    for (const gh of v.ghosts) {
      const a = ghostAlpha(gh.age);
      drawGhostTrail(ctx, gh, { color: foeColor, px, alpha: a });
      ctx.globalAlpha = Math.max(0.7, a);
      ctx.fillStyle = foeColor;
      ctx.strokeStyle = theme.paper;
      ctx.lineWidth = 3.5 * px;
      ctx.lineJoin = 'round';
      const lines = [];
      if (gh.from) {
        const d = directionOf(gh.from, gh.pos);
        lines.push(`Bewegung ${d ? d.name : ''}, ${ageText(gh.age)}`);
      }
      if (gh.source) lines.push(gh.source);
      lines.forEach((l, i) => {
        const lx = gh.pos.x + 0.5 + 18 * px, ly = gh.pos.y + 0.5 + 11 * px + i * 17 * px;
        ctx.strokeText(l, lx, ly);
        ctx.fillText(l, lx, ly);
      });
    }
    ctx.restore();
  },
});
