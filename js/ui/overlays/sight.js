// Overlay 3 Sicht: was die eigene Seite gerade sieht. Unsichtbares liegt unter grauer Schraffur.
// Nutzt dieselbe Sichtregel wie viewFor (js/view.js); P05 tauscht sie gegen Sichtlinien mit Hoehe.
import { registerOverlay } from '../overlays.js';
import { seesPoint } from '../../view.js';

registerOverlay({
  slot: 3,
  id: 'sight',
  label: 'Sicht',
  draw(ctx, { map, state, side, theme, px }) {
    ctx.save();
    ctx.strokeStyle = theme.ink2;
    ctx.lineWidth = px;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (const c of map.cells) {
      if (seesPoint(state, side, c)) continue;
      ctx.moveTo(c.x, c.y + 1);
      ctx.lineTo(c.x + 1, c.y);
      ctx.moveTo(c.x, c.y + 0.5);
      ctx.lineTo(c.x + 0.5, c.y);
      ctx.moveTo(c.x + 0.5, c.y + 1);
      ctx.lineTo(c.x + 1, c.y + 0.5);
    }
    ctx.stroke();
    ctx.restore();
  },
});
