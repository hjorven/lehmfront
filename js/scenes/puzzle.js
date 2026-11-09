// Szene "puzzle": Lehrgangsmappe mit den zwoelf Puzzle-Lagen (P25, Plan 8).
// Jede Lage als Uebungsblatt mit Kartenskizze; geloeste Lagen tragen Stempel und die Note des Ausbilders.
// Ein Klick oeffnet die Lage im Gefecht (?scene=gefecht&puzzle=<datei>).
import { loadMap } from '../map.js';
import { createCamera, resizeCamera, centerOn, fitZoom } from '../render/camera.js';
import { createMapLayer, sheetBounds } from '../render/map-layer.js';
import { themeAt, applyTheme, currentTheme } from '../theme.js';
import { PUZZLES } from '../config/puzzles.js';
import { puzzleMapJson } from '../modes/puzzle.js';
import { readProgress } from '../ui/lage-rules.js';
import { esc, ensureCss } from '../ui/dom.js';
import { audio, playSfx } from '../audio/engine.js';

export async function mount(root) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();
  const [list] = await Promise.all([
    Promise.all(PUZZLES.map((f) => fetch(`data/puzzles/${f}.json`).then((r) => r.json()))),
    ensureCss('css/werkstatt.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '16px "Caveat"', '700 16px "Caveat"', '16px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const prog = readProgress();
  const solved = list.filter((p) => prog[p.id]?.solved).length;
  const firstOpen = list.find((p) => !prog[p.id]?.solved);
  root.className = 'lg';
  root.innerHTML = `<div class="lg-in">
    <header class="lg-head"><h1>Lehrgangsmappe</h1><p>${solved} von ${list.length} Lagen gelöst · volle Information, keine Würfel</p></header>
    <div class="lg-grid">${list.map((p, i) => {
      const e = prog[p.id];
      const r = ((i * 37) % 7 - 3) * 0.25;
      return `<a class="card lg-card" href="?scene=gefecht&amp;puzzle=${esc(PUZZLES[i])}" style="--r:${r}deg" data-i="${i}">
        <span class="lg-num">Lage ${p.num} · ${esc(p.lesson)}</span>
        <canvas aria-hidden="true"></canvas>
        <b>${esc(p.title)}</b>
        <small>${esc(p.kind === 'battle' ? 'Gefecht' : 'Stellungsrunden')}, Frist ${p.limit} ${p.limit === 1 ? 'Runde' : 'Runden'}${e?.tries ? ` · ${e.tries} ${e.tries === 1 ? 'Versuch' : 'Versuche'}` : ''}</small>
        ${e?.solved ? `<span class="lg-stamp" aria-label="gelöst">${e.clean ? 'Sauber' : 'Gelöst'}</span><span class="lg-grade">Note: ${esc(e.grade ?? 'bestanden')}</span>` : ''}
      </a>`;
    }).join('')}</div>
    <footer class="lg-foot">
      ${firstOpen ? `<a class="btn" href="?scene=gefecht&amp;puzzle=${esc(PUZZLES[list.indexOf(firstOpen)])}">Weiter mit Lage ${firstOpen.num} <small>${esc(firstOpen.title)}</small></a>` : ''}
      <a class="btn" href="?scene=werkstatt">Werkstatt <small>eigene Lagen bauen</small></a>
      <a class="btn" href="./">Hauptmenü</a>
    </footer>
  </div>`;

  // Kartenskizzen: dieselbe statische Ebene wie im Gefecht, ganzes Blatt
  const cards = [...root.querySelectorAll('.lg-card')];
  const draw = () => {
    cards.forEach((card, i) => {
      const cv = card.querySelector('canvas');
      const map = loadMap(puzzleMapJson(list[i]));
      const w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      const cam = createCamera({ bounds: sheetBounds(map), maxZoom: 40 });
      resizeCamera(cam, w, h);
      centerOn(cam, map.width / 2, map.height / 2, fitZoom(cam));
      const layer = createMapLayer(cv, map, { getCamera: () => cam, getTheme: currentTheme });
      layer.resize(w, h, Math.min(2, devicePixelRatio || 1));
      cv.style.width = ''; cv.style.height = '';
      layer.drawNow();
    });
  };
  draw();
  let t = 0;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(draw, 150); });
  for (const c of cards) c.addEventListener('pointerenter', () => playSfx('paper', { intensity: 0.15 }));
}
