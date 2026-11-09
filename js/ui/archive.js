// Protokoll-Archiv als Aktenordner (P07): alle Runden der Mission als Durchschlaege mit Registerreitern.
// Jede Zeile springt zur Stelle, "Film dieser Runde" rechnet die Runde aus dem Startzustand neu.
import { esc } from './dom.js';

/**
 * createArchiveView(root, { onJump(line), onReplay(entry), onClose() })
 * show(rounds, pick) mit rounds = [{ entry, title, sub, lines }], pick = Index der gezeigten Runde
 */
export function createArchiveView(root, { onJump, onReplay, onClose }) {
  const el = document.createElement('section');
  el.className = 'card archive';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Protokoll der Mission');
  root.append(el);
  let rounds = [];
  let cur = 0;

  function render() {
    const r = rounds[cur];
    el.innerHTML = `<header><b>Protokoll</b><span class="sub">${rounds.length} ${rounds.length === 1 ? 'Runde' : 'Runden'} · Durchschläge</span>
        <button type="button" class="x" aria-label="Protokoll schließen">×</button></header>
      <div class="ar-body">
        <nav class="ar-tabs" role="tablist" aria-label="Runden">${rounds.map((x, i) =>
          `<button type="button" role="tab" class="ar-tab${i === cur ? ' on' : ''}" aria-selected="${i === cur}" data-r="${i}">${esc(x.short)}</button>`).join('')}</nav>
        <div class="ar-page">${r ? `
          <div class="ar-title"><b>${esc(r.title)}</b><span>${esc(r.sub)}</span></div>
          <ol>${r.lines.length ? r.lines.map((l, i) => `<li class="${esc(l.tone)}"><button type="button" data-i="${i}">
            <span class="tg-head">${esc(l.head)}</span><span class="tg-text">${esc(l.text)}</span></button></li>`).join('')
            : '<li class="quiet"><span class="tg-text">Keine besonderen Vorkommnisse STOP</span></li>'}</ol>
          <button type="button" class="btn ar-film">Film dieser Runde</button>` : '<p class="ar-none">Noch keine Runde ausgeführt.</p>'}</div>
      </div>`;
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('.x')) { onClose(); return; }
    const tab = e.target.closest('[data-r]');
    if (tab) { cur = Number(tab.dataset.r); render(); el.querySelector('.ar-tab.on')?.focus(); return; }
    if (e.target.closest('.ar-film')) { onReplay(rounds[cur].entry); return; }
    const b = e.target.closest('[data-i]');
    if (b) onJump(rounds[cur].lines[Number(b.dataset.i)]);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const tab = e.target.closest?.('.ar-tab');
    if (tab && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault(); e.stopPropagation();
      const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      cur = (cur + d + rounds.length) % rounds.length;
      render();
      el.querySelector('.ar-tab.on')?.focus();
    }
  });

  return {
    el,
    get open() { return !el.hidden; },
    show(rs, pick = rs.length - 1) {
      rounds = rs;
      cur = Math.max(0, Math.min(rs.length - 1, pick));
      render();
      el.hidden = false;
      (el.querySelector('.ar-tab.on') ?? el.querySelector('.x')).focus({ preventScroll: true });
    },
    hide() { el.hidden = true; },
  };
}
