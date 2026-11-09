// Overlay 3 Sicht: was die eigene Seite gerade sieht (Sichtlinien mit Hoehe, Dunkelheit). Unsichtbares liegt unter
// grauer Schraffur. Dieselbe Regel wie viewFor (js/sight.js); zwischengespeichert, bis sich der Zustand aendert.
import { registerOverlay } from '../overlays.js';
import { visibleCells, darknessOf } from '../../sight.js';

let cache = { state: null, side: null, cells: null };

registerOverlay({
  slot: 3,
  id: 'sight',
  label: 'Sicht',
  draw(ctx, { map, state, side, theme, px }) {
    if (cache.state !== state || cache.side !== side) cache = { state, side, cells: visibleCells(state, map, side, darknessOf(state)) };
    const seen = cache.cells;
    ctx.save();
    ctx.strokeStyle = theme.ink2;
    ctx.lineWidth = px;
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    for (const c of map.cells) {
      if (seen[c.y * map.width + c.x]) continue;
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
