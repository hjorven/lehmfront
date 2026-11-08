// Einstieg. Bis die Spielansichten stehen: Titelbild mit gezeichneter Lagekarte im Hintergrund.
import { createRng } from './rng.js';

export const VERSION = '0.1.0';

function drawBackground(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.body);
  const v = (k) => cs.getPropertyValue('--' + k).trim();
  ctx.fillStyle = v('paper');
  ctx.fillRect(0, 0, w, h);

  // Hoehenlinien wie auf der Generalstabskarte, deterministisch zittern
  const rng = createRng(214);
  ctx.strokeStyle = v('line');
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  const cx = w * 0.72, cy = h * 0.42;
  for (let r = 40; r < Math.max(w, h); r += 34) {
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const j = 1 + (rng() - 0.5) * 0.05;
      const x = cx + Math.cos(t) * r * 1.4 * j, y = cy + Math.sin(t) * r * 0.8 * j;
      a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  // Eigener Graben als Rechteckwelle (blau), feindlicher (rot)
  const crenel = (x0, color) => {
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, 0);
    for (let y = 0; y < h; y += 28) {
      const o = (y / 28) % 2 ? 10 : -10;
      ctx.lineTo(x, y + 14);
      ctx.lineTo(x + o, y + 14);
      ctx.lineTo(x + o, y + 28);
      x += o;
    }
    ctx.stroke();
  };
  crenel(w * 0.58, v('own'));
  crenel(w * 0.86, v('enemy'));
  ctx.globalAlpha = 1;
}

const canvas = document.getElementById('bg');
const redraw = () => drawBackground(canvas);
redraw();
addEventListener('resize', redraw);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
document.getElementById('version').textContent = 'v' + VERSION;
