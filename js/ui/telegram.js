// Telegramm nach der Runde (P07, Plan 3.4 Punkt 5, Stil 03 Feldtelegramm). Ein Fernschreiberstreifen:
// jede Zeile kommt mit Zeitgruppe, Phase und Feld, darunter die Begruendung, wird Zeichen fuer Zeichen
// getippt und endet mit STOP und Glocke. Klick auf eine Zeile springt zur Stelle auf der Karte.
import { esc, reducedMotion } from './dom.js';
import { playSfx } from '../audio/engine.js';

const CPS = 70; // Anschlaege pro Sekunde

/** Kleine, feste Schieflage je Zeile wie bei einem muerben Typenhebel (deterministisch aus dem Index) */
function skew(i) {
  const h = Math.imul(i + 1, 2654435761) >>> 0;
  return { dx: (h % 5) - 2, rot: ((h >>> 8) % 7 - 3) / 10 };
}

/**
 * createTelegram(root, { onJump(line), onFilm(), onArchive() })
 * show({ title, sub, lines, film }) setzt den Streifen neu; setCount(n, typing) zeigt die ersten n Zeilen.
 */
export function createTelegram(root, { onJump, onFilm, onArchive }) {
  const el = document.createElement('section');
  el.className = 'card telegram';
  el.hidden = true;
  el.setAttribute('aria-label', 'Telegramm');
  root.append(el);
  let lines = [];
  let shown = 0;
  let queue = [];   // Zeilen, die noch getippt werden
  let timer = 0;

  el.addEventListener('click', (e) => {
    if (e.target.closest('.x')) { el.hidden = true; return; }
    if (e.target.closest('.tg-film')) { onFilm?.(); return; }
    if (e.target.closest('.tg-archive')) { onArchive?.(); return; }
    const b = e.target.closest('[data-i]');
    if (b) onJump(lines[Number(b.dataset.i)]);
  });

  function lineHtml(l, i) {
    const k = skew(i);
    return `<li class="${esc(l.tone)}" style="--dx:${k.dx}px;--rot:${k.rot}deg"><button type="button" data-i="${i}">
      <span class="tg-head">${esc(l.head)}</span><span class="tg-text"></span></button></li>`;
  }

  function stopTyping() {
    clearTimeout(timer);
    timer = 0;
    for (const q of queue) q.span.textContent = q.text;
    queue = [];
    el.classList.remove('typing');
  }

  function typeNext() {
    timer = 0;
    const q = queue[0];
    if (!q) { el.classList.remove('typing'); return; }
    if (q.pos === 0) {
      q.span.parentElement.parentElement.classList.add('cur');
      playSfx('teletype', { count: Math.min(16, Math.ceil(q.text.length / 5)), bell: true });
    }
    q.pos = Math.min(q.text.length, q.pos + 2);
    q.span.textContent = q.text.slice(0, q.pos);
    if (q.pos >= q.text.length) {
      q.span.parentElement.parentElement.classList.remove('cur');
      queue.shift();
      timer = setTimeout(typeNext, 160);
    } else {
      timer = setTimeout(typeNext, 2000 / CPS);
    }
  }

  const list = () => el.querySelector('ol');

  return {
    el,
    get open() { return !el.hidden; },
    show({ title, sub = '', lines: ls, actions = true }) {
      stopTyping();
      lines = ls;
      shown = 0;
      el.innerHTML = `<header><b>${esc(title)}</b><span class="sub">${esc(sub)}</span>
          <button type="button" class="x" aria-label="Telegramm schließen">×</button></header>
        <ol aria-live="polite"></ol>
        <p class="tg-empty" hidden>Keine besonderen Vorkommnisse STOP</p>
        ${actions ? `<footer><button type="button" class="btn tg-film">Film der Runde</button>
          <button type="button" class="btn tg-archive" aria-keyshortcuts="P">Protokoll <kbd>P</kbd></button></footer>` : ''}`;
      el.hidden = false;
    },
    /** Erste n Zeilen zeigen. typing: neue Zeilen werden getippt, sonst stehen sie sofort da. */
    setCount(n, typing = false) {
      const ol = list();
      if (!ol) return;
      n = Math.max(0, Math.min(lines.length, n));
      if (n < shown) {
        stopTyping();
        while (ol.children.length > n) ol.lastElementChild.remove();
      }
      for (let i = shown; i < n; i++) {
        ol.insertAdjacentHTML('beforeend', lineHtml(lines[i], i));
        const span = ol.lastElementChild.querySelector('.tg-text');
        if (typing && !reducedMotion()) queue.push({ span, text: lines[i].text, pos: 0 });
        else span.textContent = lines[i].text;
      }
      if (n > shown) ol.lastElementChild?.scrollIntoView?.({ block: 'nearest' });
      shown = n;
      if (queue.length && !timer) { el.classList.add('typing'); typeNext(); }
      el.querySelector('.tg-empty').hidden = !(n === 0 && lines.length === 0);
    },
    /** Laufendes Tippen sofort fertig machen */
    finishTyping() { stopTyping(); },
    setFilmActive(on) { el.classList.toggle('in-film', on); },
    hide() { stopTyping(); el.hidden = true; },
  };
}
