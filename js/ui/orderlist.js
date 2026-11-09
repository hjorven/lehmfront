// Befehlsliste als Kaertchen (Plan 7.3, Taste Tab): alle geplanten Befehle, Klick springt zur Gruppe,
// x nimmt den Befehl zurueck (Gruppe haelt dann wieder als Standard).
import { esc } from './dom.js';

export function createOrderList(root, { onJump, onClear, onClose }) {
  const el = document.createElement('section');
  el.className = 'card orderlist';
  el.hidden = true;
  el.setAttribute('aria-label', 'Befehlsliste');
  el.innerHTML = `<header><b>Befehle</b><span class="sub"></span><button type="button" class="x" aria-label="Befehlsliste schließen">×</button></header><ol></ol>`;
  root.append(el);
  el.querySelector('.x').addEventListener('click', () => onClose());
  el.addEventListener('click', (e) => {
    const j = e.target.closest('[data-jump]');
    if (j) onJump(j.dataset.jump);
    const c = e.target.closest('[data-clear]');
    if (c) onClear(c.dataset.clear);
  });
  return {
    el,
    get open() { return !el.hidden; },
    show() { el.hidden = false; el.querySelector('[data-jump]')?.focus(); },
    hide() { el.hidden = true; },
    /** rows: [{ id, name, mark, text, set (true wenn ausdruecklicher Befehl), carried, note?: { text, warn } (P12: zu lange vorn) }] */
    update(rows, sub) {
      el.querySelector('.sub').textContent = sub;
      el.querySelector('ol').innerHTML = rows.map((r) => `<li class="${r.set || r.resting ? 'set' : 'idle'}">
        <button type="button" class="row" data-jump="${esc(r.id)}"><span class="mark">${esc(r.mark)}</span>
          <span class="who">${esc(r.name)}</span><span class="what">${esc(r.text)}${r.note ? ` <i class="note${r.note.warn ? ' warn' : ''}">${esc(r.note.text)}</i>` : ''}</span></button>
        ${r.set ? `<button type="button" class="clr" data-clear="${esc(r.id)}" aria-label="Befehl für ${esc(r.name)} zurücknehmen">×</button>` : ''}
      </li>`).join('');
    },
  };
}
