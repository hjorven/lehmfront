// Abgefangene Notiz von Lask (Ueberraschung P13): ein Zettel mit Bleistiftschrift, ausgerissen, teils verwischt,
// darunter der Vermerk der Fernmeldestelle. Der Inhalt kommt aus der echten naechsten Entscheidung der KI
// (js/ai/notes.js). Auf der Karte bleibt ein Bleistiftkringel an der Stelle, die Lask meint.
import { esc, ensureCss } from './dom.js';
import { noteParts } from '../ai/notes.js';
import { cellLabel } from '../map.js';
import { FONTS } from '../render/map-layer.js';

/**
 * Zettel anzeigen. handlers: { onJump(at), onClose() }. Liefert { el, open, show(note), hide() }.
 */
export function createLaskNote(root, { onJump, onClose }) {
  ensureCss('css/lehrling.css');
  const el = document.createElement('section');
  el.className = 'lask-note';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Abgefangene Notiz');
  root.append(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('.ln-jump')) onJump(JSON.parse(e.target.closest('.ln-jump').dataset.at));
    else if (e.target.closest('.ln-close')) onClose();
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  });
  return {
    el,
    get open() { return !el.hidden; },
    show(note) {
      const lines = note.lines.map((l) => `<span class="ln-line">${noteParts(l).map((p) => (p.smudged ? `<span class="ln-smudge" aria-hidden="true">${esc(p.text)}</span>` : esc(p.text))).join('')}</span>`).join('');
      el.innerHTML = `
        <div class="ln-stamp">Abgefangen · ${esc(note.found ?? 'am Draht gefunden')}</div>
        <div class="ln-paper"><p class="ln-text">${lines}<span class="ln-sig">${esc(note.signature ?? 'L.')}</span></p></div>
        <p class="ln-vermerk">Übersetzt: Lt. de Groot, Fernmeldestelle Ostervenn. Klartext: ${esc(note.hint)}</p>
        <div class="ln-actions"><button type="button" class="btn ln-jump" data-at='${esc(JSON.stringify(note.at))}'>Zur Stelle ${esc(cellLabel(note.at.x, note.at.y))}</button><button type="button" class="btn ln-close">Ablegen</button></div>`;
      el.hidden = false;
      el.querySelector('.ln-close').focus({ preventScroll: true });
    },
    hide() { el.hidden = true; },
  };
}

/** Bleistiftkringel mit "L.?" an der Stelle, die die Notiz meint (bis zur naechsten Notiz) */
export function laskNoteOverlay(note) {
  return {
    draw(ctx, { theme: th, px }) {
      const x = note.at.x + 0.5, y = note.at.y + 0.5;
      ctx.save();
      ctx.strokeStyle = th.pencil ?? th.ink2;
      ctx.lineWidth = Math.max(1.8 * px, 0.06);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      // zweimal umkreist, leicht versetzt, wie mit der Hand
      ctx.ellipse(x, y, 2.3, 1.7, -0.2, 0.2, Math.PI * 2 + 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + 0.15, y - 0.1, 2.5, 1.85, -0.25, 0, Math.PI * 1.7);
      ctx.stroke();
      ctx.fillStyle = th.ink;
      ctx.font = `700 ${Math.max(0.9, 16 * px)}px ${FONTS.hand}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText('L.?', x + 2.2, y - 1.4);
      ctx.restore();
    },
  };
}
