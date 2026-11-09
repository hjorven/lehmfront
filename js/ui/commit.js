// "Runde ausfuehren": Zusammenfassung, Halten-Ring bei Sturm (Plan 3.4, Bild feature-09),
// Uebergabebildschirm fuer Hotseat (Platzhalter) und Meldungen nach der Runde (bis P07 das Telegramm bringt).
import { esc, reducedMotion } from './dom.js';

export const HOLD_MS = 1400;
const R = 74, C = 2 * Math.PI * R;

/** Modaler Rahmen mit Fokusfalle. Liefert { el, close } */
function modal(root, cls, label, onClose) {
  const back = document.createElement('div');
  back.className = 'modal-back ' + cls;
  back.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(label)}"></div>`;
  root.append(back);
  const box = back.firstElementChild;
  const prev = document.activeElement;
  const trap = (e) => {
    if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button:not([disabled]), [tabindex="0"]')];
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    e.stopPropagation();
  };
  back.addEventListener('keydown', trap);
  // Gehaltene Enter- oder Leertaste darf keine Knoepfe im neuen Dialog ausloesen (Serien-Commit)
  back.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); } }, true);
  back.addEventListener('pointerdown', (e) => { if (e.target === back && onClose) onClose(); });
  return {
    el: back, box,
    close() { back.remove(); if (prev && prev.isConnected) prev.focus?.({ preventScroll: true }); },
  };
}

/**
 * Zusammenfassung zeigen. s = summarize(...) Ergebnis, title, onCommit, onCancel.
 * needsHold: Ring fuellt sich nur, solange Maus, Finger, Enter oder Leertaste gehalten werden.
 */
export function showSummary(root, s, { title, sub, onCommit, onCancel, preset = 0, action = 'Runde ausführen' }) {
  let done = false;
  const m = modal(root, 'summary', 'Zusammenfassung vor der Ausführung', () => { if (!done) { m.close(); onCancel(); } });
  const hold = s.needsHold;
  m.box.innerHTML = `
    <header><b>${esc(title)}</b><span>${esc(sub)}</span></header>
    <div class="sum-body">
      <ul class="sum-lines">${s.lines.map((l) => `<li class="${l.tone}"><i></i><b>${esc(l.count)}</b><span>${esc(l.text)}</span></li>`).join('')}</ul>
      <button type="button" class="ring${hold ? ' hold' : ''}" aria-describedby="ring-how">
        <svg viewBox="0 0 170 170" aria-hidden="true"><circle class="trk" cx="85" cy="85" r="${R}"/><circle class="val" cx="85" cy="85" r="${R}"
          stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" transform="rotate(-90 85 85)"/></svg>
        <span class="ring-face"><b>${esc(action)}</b><small id="ring-how">${hold ? 'halten' : 'klicken'} · ${s.count} ${s.count === 1 ? 'Befehl' : 'Befehle'}</small></span>
      </button>
    </div>
    <footer><button type="button" class="btn back">Zurück zur Karte <small>Esc</small></button></footer>`;
  const ring = m.box.querySelector('.ring');
  const val = m.box.querySelector('.val');
  m.box.querySelector('.back').addEventListener('click', () => { m.close(); onCancel(); });

  const commit = () => {
    if (done) return;
    done = true;
    m.close();
    onCommit();
  };
  let start = 0, raf = 0, holding = false;
  const setFill = (f) => { val.setAttribute('stroke-dashoffset', (C * (1 - f)).toFixed(1)); };
  const tick = (ts) => {
    if (!holding) return;
    if (!start) start = ts;
    const f = Math.min(1, (ts - start) / HOLD_MS);
    setFill(f);
    if (f >= 1) { holding = false; commit(); return; }
    raf = requestAnimationFrame(tick);
  };
  const begin = () => {
    if (done || holding) return;
    holding = true;
    start = 0;
    ring.classList.add('pressed');
    if (reducedMotion()) { /* Ring trotzdem fuellen, aber ohne Nachfedern */ }
    raf = requestAnimationFrame(tick);
  };
  const end = () => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    ring.classList.remove('pressed');
    setFill(0);
  };
  if (hold) {
    ring.addEventListener('pointerdown', (e) => { e.preventDefault(); ring.setPointerCapture?.(e.pointerId); begin(); });
    ring.addEventListener('pointerup', end);
    ring.addEventListener('pointercancel', end);
    ring.addEventListener('lostpointercapture', end);
    ring.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); begin(); } });
    ring.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') end(); });
    ring.addEventListener('contextmenu', (e) => e.preventDefault());
  } else {
    ring.addEventListener('click', commit);
  }
  if (preset) setFill(preset);
  ring.focus({ preventScroll: true });
  return { close: () => { done = true; m.close(); } };
}

/** Uebergabe zwischen zwei Spielern an einem Geraet (Hotseat, Platzhalter fuer P17) */
// Uebergabe im Hotseat (P17, Plan 9): ein verschlossener Umschlag auf leerem Papier. Er verraet nichts ueber den
// Plan der anderen Seite (keine Zahl der Befehle, keine Dauer, keine Karte) und oeffnet sich erst, wenn das Siegel
// eine Weile gedrueckt wird: ein versehentliches Tippen der abgebenden Person zeigt der naechsten nichts.
const SEAL_MS = 700;
const SEAL_NOTES = ['Nicht hineinsehen.', 'Nur für die Abschnittsführung.', 'Erst lesen, wenn allein.', 'Bitte umdrehen und warten.'];

/**
 * Uebergabebildschirm. opts: { title, text, button, onGo, to?, from?, note? }
 * to/from: Namen der Fraktionen fuer die Anschrift, note: Zahl fuer die Bleistiftnotiz (z. B. die Runde).
 */
export function showHandover(root, { title, text, button, onGo, to = '', from = '', note = 0 }) {
  const m = modal(root, 'handover', title, null);
  m.box.classList.add('envelope');
  const pencil = SEAL_NOTES[Math.abs(note | 0) % SEAL_NOTES.length];
  m.box.innerHTML = `<svg class="env-flap" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0 L50 34 L100 0"/></svg>
    <span class="env-seal" aria-hidden="true"></span>
    <div class="stamp" aria-hidden="true">Verschlossen</div>
    ${to ? `<p class="env-addr"><span>An</span> ${esc(to)}<br><span>Von</span> ${esc(from)}</p>` : ''}
    <b class="ho-title">${esc(title)}</b><p class="ho-text">${esc(text)}</p>
    <p class="env-note" aria-hidden="true">${esc(pencil)}</p>
    <button type="button" class="btn go seal" aria-describedby="ho-hold"><span class="seal-fill" aria-hidden="true"></span><span class="seal-label">${esc(button)}</span></button>
    <small id="ho-hold" class="ho-hold">Siegel gedrückt halten, bis es bricht.</small>`;
  const go = m.box.querySelector('.go');
  let t0 = 0, raf = 0, done = false;
  const set = (p) => go.style.setProperty('--p', String(p));
  const stop = () => { if (done) return; cancelAnimationFrame(raf); raf = 0; t0 = 0; set(0); go.classList.remove('holding'); };
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / SEAL_MS);
    set(p);
    if (p >= 1) { done = true; go.classList.add('broken'); m.close(); onGo(); return; }
    raf = requestAnimationFrame(tick);
  };
  const start = () => { if (done || raf) return; t0 = performance.now(); go.classList.add('holding'); raf = requestAnimationFrame(tick); };
  go.addEventListener('pointerdown', (e) => { e.preventDefault(); go.setPointerCapture?.(e.pointerId); start(); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) go.addEventListener(ev, stop);
  go.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } });
  go.addEventListener('keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') stop(); });
  go.addEventListener('click', (e) => e.preventDefault()); // nur Halten oeffnet
  go.addEventListener('contextmenu', (e) => e.preventDefault());
  go.focus({ preventScroll: true });
  return m;
}

/** Meldungen nach der Runde. lines: [{ text, at, tone }] */
export function createReport(root, { onJump }) {
  const el = document.createElement('section');
  el.className = 'card report';
  el.hidden = true;
  el.setAttribute('aria-label', 'Meldungen');
  root.append(el);
  let lines = [];
  el.addEventListener('click', (e) => {
    if (e.target.closest('.x')) { el.hidden = true; return; }
    const b = e.target.closest('[data-i]');
    if (b) onJump(lines[Number(b.dataset.i)]);
  });
  return {
    el,
    get open() { return !el.hidden; },
    show(title, list) {
      lines = list;
      el.innerHTML = `<header><b>${esc(title)}</b><span class="sub">${list.length} ${list.length === 1 ? 'Zeile' : 'Zeilen'}</span>
        <button type="button" class="x" aria-label="Meldungen schließen">×</button></header>
        <ol>${list.length ? list.map((l, i) => `<li class="${l.tone ?? ''}"><button type="button" data-i="${i}">${esc(l.text)}</button></li>`).join('')
          : '<li class="quiet"><span>Keine besonderen Vorkommnisse.</span></li>'}</ol>`;
      el.hidden = false;
    },
    hide() { el.hidden = true; },
  };
}
