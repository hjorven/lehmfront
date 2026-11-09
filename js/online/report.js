// Abschlussmeldung, online ergaenzt (P20): Wiedergabe-Link fuer jedes Gefecht und bei der Tageslage die Meldung
// an den Stab, der die Woche nachrechnet, bevor sie in die Bestenliste kommt.
import { esc } from '../ui/dom.js';
import { replayUrl } from './link.js';
import { onlineEnabled } from '../net.js';
import { faction } from '../config/factions.js';
import { playSfx } from '../audio/engine.js';

const short = (id) => { try { return faction(id).short; } catch { return ''; } };

/** Link in die Zwischenablage, sonst zum Markieren anzeigen */
async function share(url, box) {
  let copied = false;
  try { await navigator.clipboard.writeText(url); copied = true; } catch { /* ohne Zwischenablage */ }
  box.hidden = false;
  box.innerHTML = `<label>${copied ? 'Link kopiert. Wer ihn öffnet, sieht das Gefecht Runde für Runde, ohne Server.' : 'Link zum Weitergeben:'}
    <input readonly value="${esc(url)}"></label><small>${Math.ceil(url.length / 1000)} kB Befehlsprotokoll im Link</small>`;
  const input = box.querySelector('input');
  if (!copied) { input.focus(); input.select(); }
  playSfx('pencil', { count: 2, intensity: 0.4 });
}

/**
 * section = .rm der Abschlussmeldung. opts: { info, report, record: () => Protokoll | null }
 */
export function decorateReport(section, { info, report, record }) {
  const rec = record?.();
  const foot = section.querySelector('.rm-foot');
  if (rec && rec.r.length && foot) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn rm-replay';
    btn.textContent = 'Wiedergabe-Link';
    const box = document.createElement('div');
    box.className = 'rm-link';
    box.hidden = true;
    foot.before(box);
    foot.prepend(btn);
    btn.addEventListener('click', async () => share(await replayUrl(rec), box));
  }
  if (info?.kind !== 'tageslage' || !onlineEnabled() || !rec) return;
  const block = document.createElement('div');
  block.className = 'rm-stab';
  block.innerHTML = `<b>Meldung an den Stab</b>
    <p>Der Stab rechnet die Woche aus deinen Befehlen nach. Erst dann steht sie im Wachbuch der Front, für alle sichtbar.</p>
    <button type="button" class="btn rm-send">Woche melden</button><div class="rm-stab-out" aria-live="polite"></div>`;
  const wb = section.querySelector('.wachbuch');
  (wb ?? foot)?.after(block);
  const out = block.querySelector('.rm-stab-out');
  block.querySelector('.rm-send').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    out.textContent = 'Fernschreiben geht hinaus ...';
    const net = await import('../net.js');
    const r = await net.submitDaily(info.key, rec.r.map((x) => x[0]), report.points);
    if (!r.ok) { out.textContent = r.why; b.disabled = false; return; }
    playSfx('stamp', { intensity: 0.7 });
    const board = await net.dailyBoard(info.key, 10);
    const rows = board.ok ? board.list.map((x, i) => `<li><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(x.name)}</span><span class="wb-f">${esc(short(x.faction))}</span><b>${x.points}</b></li>`).join('') : '';
    out.innerHTML = `<span class="rm-checked">Nachgerechnet</span> ${r.points} Punkte${r.improved ? '' : `, dein bester Eintrag heute bleibt ${r.best}`}.
      ${rows ? `<ol class="rm-front">${rows}</ol>` : ''}`;
  });
}
