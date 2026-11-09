// Einstieg. Bis die Spielansichten stehen: Titelbild mit gezeichneter Lagekarte im Hintergrund.
import { createRng } from './rng.js';
import { audio, playSfx } from './audio/engine.js';
import { dayKey, dayLabel } from './modes/skirmish.js';
import { boardFor } from './modes/board.js';

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

// Szenen: ?scene=<name> laedt js/scenes/<name>.js und ruft dessen mount(root, params) auf.
// Jedes Paket legt seine Demo- und Spielansichten als eigene Szene an, ohne main.js zu aendern.
const params = new URLSearchParams(location.search);
const scene = params.get('scene');

async function mountScene(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Ungueltiger Szenenname: ' + name);
  const mod = await import(`./scenes/${name}.js`);
  document.body.classList.remove('menu');
  document.body.dataset.scene = name;
  const root = document.createElement('div');
  root.id = 'scene';
  document.body.replaceChildren(root);
  await mod.mount(root, params);
}

if (scene) {
  mountScene(scene).catch((e) => {
    console.error(e);
    document.body.textContent = 'Szene konnte nicht geladen werden: ' + scene;
  });
} else {
  const canvas = document.getElementById('bg');
  const redraw = () => drawBackground(canvas);
  redraw();
  addEventListener('resize', redraw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  document.getElementById('version').textContent = 'v' + VERSION;
  menuSound();
  menuToday();
}

// Klang im Hauptmenue (P17, Hinweis aus P19): ferne Front, Wind, karge Musik, sobald jemand tippt.
// Fahren die Finger ueber die Eintraege, raschelt Papier; der Knopf unten schaltet den Ton.
function menuSound() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  audio.init();
  audio.setAmbience({ darkness: dark ? 0.85 : 0.2, wind: 0.3, rain: 0, battle: 0.06 });
  audio.startMusic();
  for (const b of document.querySelectorAll('.menu-list .btn:not([disabled])')) {
    b.addEventListener('pointerenter', () => playSfx('paper', { intensity: 0.18 }));
    b.addEventListener('click', () => playSfx('stamp', { intensity: 0.5 }));
  }
  const btn = document.getElementById('menu-sound');
  if (!btn) return;
  const show = (s) => {
    btn.textContent = !s.ready ? 'Ton: tippen zum Wecken' : s.muted ? 'Ton: aus' : 'Ton: an';
    btn.setAttribute('aria-pressed', String(s.ready && !s.muted));
  };
  audio.onChange(show);
  show(audio.init());
  btn.addEventListener('click', () => { if (audio.init().ready) audio.setMuted(!audio.isMuted()); });
}

// Tageslage im Menue: heutiges Datum und der beste Eintrag im Wachbuch dieses Geraets
function menuToday() {
  const a = document.getElementById('menu-tageslage');
  if (!a) return;
  const d = new Date();
  const key = dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const best = boardFor(key)[0];
  a.querySelector('small').textContent = best ? `${dayLabel(key)} · bisher ${best.points}` : dayLabel(key);
}
