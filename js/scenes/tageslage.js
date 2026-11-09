// Szene "tageslage": die Lage des Tages (P17, Plan 8). Fester Seed aus dem Datum, fuer alle gleich: dieselbe
// Zufallskarte, dieselbe Fraktion, derselbe Gegner. Eine Woche = 14 Stellungsrunden, Punkte nach Plan 8.3.
// Lokale Bestenliste (Wachbuch) auf diesem Geraet; online kommt mit P20.
// Parameter: tag=JJJJMMTT (fuer Screenshots und zum Nachspielen eines Tages).
import { loadMap } from '../map.js';
import { createCamera, resizeCamera, centerOn, fitZoom } from '../render/camera.js';
import { createMapLayer, sheetBounds } from '../render/map-layer.js';
import { themeAt, applyTheme, currentTheme } from '../theme.js';
import { FACTIONS } from '../config/factions.js';
import { DIFFICULTIES } from '../config/doctrines.js';
import { dailyBrief, dailyMap, dayKey, dayLabel, otherFaction, validDayKey } from '../modes/skirmish.js';
import { boardFor, bestDays } from '../modes/board.js';
import { esc, ensureCss } from '../ui/dom.js';
import { audio, playSfx } from '../audio/engine.js';

// Stabsbefehl des Tages: aus dem Seed, damit alle denselben lesen
const ORDERS = [
  'Abschnitt eine Woche halten. Keinen Meter hergeben, keinen Mann umsonst.',
  'Halten. Wer drüben einen Graben nimmt, soll ihn auch halten können.',
  'Eine Woche durchstehen. Die Verwundeten zuerst, dann die Ehre.',
  'Linie halten bis zur Ablösung. Was genommen wird, wird gezählt.',
];

export async function mount(root, params) {
  await Promise.all([
    ensureCss('css/modi.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "Caveat"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();

  const now = new Date(); // nur hier: welcher Tag heute ist; die Lage selbst ist rein aus dem Schluessel
  const p = params.get('tag');
  const key = p && validDayKey(p) ? Number(p) : dayKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const brief = dailyBrief(key);
  const json = dailyMap(brief);
  const map = loadMap(json);
  const f = FACTIONS[brief.faction], foe = FACTIONS[otherFaction(brief.faction)];
  const board = boardFor(key);
  const days = bestDays(6).filter((d) => d.key !== key && d.best);

  root.className = 'mb tl';
  root.innerHTML = `
    <div class="mb-map">
      <div class="mb-sheet"><canvas aria-hidden="true"></canvas></div>
      <div class="mb-cap"><span>${esc(json.sheet.title)}</span><span>Seed ${brief.seed}</span></div>
    </div>
    <section class="mb-form card" aria-label="Tageslage">
      <div class="tl-head"><span class="mb-sub" style="margin:0">Tageslage</span><b class="tl-date">${esc(dayLabel(key))}</b></div>
      <p class="tl-order">${esc(ORDERS[brief.seed % ORDERS.length])}</p>
      <ul class="tl-brief">
        <li><span>Abschnitt</span><b>${esc(map.name)}</b></li>
        <li><span>Du führst</span><b>${esc(f.name)}</b></li>
        <li><span>Drüben</span><b>${esc(foe.name)}, ${esc(DIFFICULTIES[brief.difficulty].label)}</b></li>
        <li><span>Dauer</span><b>${brief.rounds} Stellungsrunden</b></li>
        <li><span>Wertung</span><b>Woche gehalten 100, Feld 5, Verwundeter 2, Gefallener −3</b></li>
      </ul>
      <div class="wachbuch"><b class="wb-title">Wachbuch, ${esc(dayLabel(key))}</b>
        ${board.length ? `<ol>${board.slice(0, 5).map((e, i) => `<li><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${esc(FACTIONS[e.faction]?.short ?? '')}</span><b>${e.points}</b></li>`).join('')}</ol>` : '<p class="wb-empty">Heute hat noch niemand auf diesem Gerät gemeldet.</p>'}
        ${days.length ? `<small class="wb-hint">Frühere Tage: ${days.map((d) => `${esc(dayLabel(d.key))} ${d.best.points}`).join(' · ')}</small>` : '<small class="wb-hint">Nur auf diesem Gerät. Für alle gilt heute dieselbe Lage.</small>'}
      </div>
      <div class="mb-go">
        <a class="btn mb-start" href="?scene=gefecht&amp;tageslage=${key}">Lage annehmen</a>
        <a class="mb-back" href="./">Zurück zum Hauptmenü</a>
      </div>
    </section>`;
  const sheet = root.querySelector('.mb-sheet');
  const canvas = sheet.querySelector('canvas');
  const cam = createCamera({ bounds: sheetBounds(map), maxZoom: 60 });
  const layer = createMapLayer(canvas, map, { getCamera: () => cam, getTheme: currentTheme });
  const fit = () => {
    const w = sheet.clientWidth, h = sheet.clientHeight;
    resizeCamera(cam, w, h);
    centerOn(cam, map.width / 2, map.height / 2, fitZoom(cam));
    layer.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
  };
  new ResizeObserver(fit).observe(sheet);
  fit();
  root.querySelector('.mb-start').addEventListener('click', () => playSfx('stamp'));
  // P20: Wachbuch der Front (online, vom Stab nachgerechnet), wenn eine Leitung geschaltet ist
  import('../online/front-board.js').then((m) => m.mountFrontBoard(root.querySelector('.wachbuch'), key)).catch(() => {});
}
