// Wachbuch der Front in der Tageslage (P20): die vom Stab nachgerechneten Wochen aller, unter dem Wachbuch des
// Geraets. Ohne geschaltete Leitung passiert nichts.
import { esc } from '../ui/dom.js';
import { FACTIONS } from '../config/factions.js';
import { onlineEnabled, dailyBoard } from '../net.js';

export async function mountFrontBoard(after, key) {
  if (!after || !onlineEnabled()) return;
  const box = document.createElement('div');
  box.className = 'wachbuch wb-front';
  box.innerHTML = '<b class="wb-title">Wachbuch der Front</b><p class="wb-empty">Fernschreiben läuft ...</p>';
  after.after(box);
  const r = await dailyBoard(key, 5);
  const body = !r.ok ? `<p class="wb-empty">${esc(r.why)}</p>`
    : r.list.length ? `<ol>${r.list.map((e, i) => `<li><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${esc(FACTIONS[e.faction]?.short ?? '')}</span><b>${e.points}</b></li>`).join('')}</ol>`
      : '<p class="wb-empty">Heute hat noch niemand an den Stab gemeldet.</p>';
  box.innerHTML = `<b class="wb-title">Wachbuch der Front</b>${body}<small class="wb-hint">Nur Wochen, die der Stab aus den Befehlen nachgerechnet hat.</small>`;
}
