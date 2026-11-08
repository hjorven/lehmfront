// Overlay 4 Hoehe: Hoehenstufen 0..3 als Flaechen in Tinte, ab mittlerem Zoom Ziffern auf Kuppen (ab Stufe 2).
import { registerOverlay } from '../overlays.js';

registerOverlay({
  slot: 4,
  id: 'height',
  label: 'Höhe',
  draw(ctx, { map, theme, px }) {
    ctx.save();
    ctx.fillStyle = theme.ink;
    for (const c of map.cells) {
      if (!c.height) continue;
      ctx.globalAlpha = 0.07 * c.height;
      ctx.fillRect(c.x, c.y, 1, 1);
    }
    if (px < 1 / 14) {
      ctx.globalAlpha = 0.75;
      ctx.font = '0.42px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of map.cells) if (c.height >= 2) ctx.fillText(String(c.height), c.x + 0.5, c.y + 0.52);
    }
    ctx.restore();
  },
});
