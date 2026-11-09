// Aufgeraeumte Karte und "Karte frei" fuer das Gefecht (Tablet-Thread).
// Aufgeraeumt: Vorraete, Achsen, Runde und Pruefliste stecken in einer Kopfleiste, die sich wie auf dem Handy
// zur Seitenleiste aufklappt. Vorgabe "nach Geraet": auf Tablets (Finger, ab 700 px Breite) aufgeraeumt.
// Karte frei: alle Kaertchen werden wie Papier vom Kartentisch geschoben, nur ein Knopf "Lage zeigen" bleibt.
import { ensureCss } from './dom.js';
import { getSetting, onSettingsChange } from '../settings.js';

/** Ab dieser Breite gilt das Tablet-Layout; darunter hat das Handy ohnehin seine Kopfleiste. */
export const TIDY_MIN_WIDTH = 700;

/** Rein: aufgeraeumte Kaertchen ja oder nein. setting: 'auto' | 'tidy' | 'full' */
export function tidyFor({ setting = 'auto', coarse = false, width = 0 } = {}) {
  if (width < TIDY_MIN_WIDTH) return false; // Handy: eigenes Layout (css/gefecht.css)
  if (setting === 'tidy') return true;
  if (setting === 'full') return false;
  return !!coarse;
}

/**
 * root: Szenenwurzel (.gefecht), ui: .g-ui, bar: rechte Knopfleiste.
 * onChange(): nach jedem Wechsel (Kamera und Schild neu ausrichten).
 * Liefert { toggleBare, setBare, bare, tidy, destroy }.
 */
export function attachTidy({ root, ui, bar, sheet = null, onChange = () => {} }) {
  ensureCss('css/kartefrei.css');
  const coarseMq = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn bare-btn';
  btn.setAttribute('aria-pressed', 'false');
  btn.setAttribute('aria-keyshortcuts', '^');
  btn.innerHTML = '<span>Karte frei</span>';
  bar.prepend(btn);

  // Handy: rechts ist nur Platz fuer "Befehle", deshalb liegt "Karte frei" oben in der Seitenleiste
  let card = null;
  if (sheet) {
    card = document.createElement('section');
    card.className = 'card bare-card';
    card.innerHTML = '<button type="button" class="btn bare-btn2">Karte frei</button>';
    sheet.prepend(card);
  }

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn bare-exit';
  back.innerHTML = '<span>Lage zeigen</span>';
  back.tabIndex = -1;
  back.hidden = true;
  ui.append(back);

  // Bleistiftvermerk in der Ecke, solange die Karte frei ist: wann man aufgeraeumt hat
  const note = document.createElement('div');
  note.className = 'bare-note';
  note.setAttribute('aria-hidden', 'true');
  note.hidden = true;
  ui.append(note);

  let tidy = false;
  let bare = false;

  function applyTidy() {
    const next = tidyFor({ setting: getSetting('hud'), coarse: !!coarseMq?.matches, width: root.clientWidth });
    if (next === tidy) return;
    tidy = next;
    root.classList.toggle('tidy', tidy);
    if (!tidy) root.classList.remove('sheet-open');
    onChange();
  }

  function setBare(on, { stamp = '' } = {}) {
    on = !!on;
    if (on === bare) return;
    bare = on;
    if (bare) root.classList.remove('sheet-open');
    const backHadFocus = document.activeElement === back;
    note.textContent = stamp ? `Karte frei · ${stamp}` : 'Karte frei';
    root.classList.toggle('bare', bare);
    btn.setAttribute('aria-pressed', String(bare));
    back.tabIndex = bare ? 0 : -1;
    back.hidden = note.hidden = !bare;
    // Fokus nicht auf einem weggeschobenen Knopf lassen
    if (bare && ui.contains(document.activeElement) && document.activeElement !== back) back.focus({ preventScroll: true });
    if (!bare && backHadFocus) root.querySelector('.g-dyn')?.focus({ preventScroll: true });
    onChange();
  }

  let stampFn = () => '';
  btn.addEventListener('click', () => setBare(true, { stamp: stampFn() }));
  card?.querySelector('button').addEventListener('click', () => setBare(true, { stamp: stampFn() }));
  back.addEventListener('click', () => setBare(false));

  const onResize = () => applyTidy();
  window.addEventListener('resize', onResize);
  coarseMq?.addEventListener?.('change', onResize);
  const offSettings = onSettingsChange(() => applyTidy());
  applyTidy();

  return {
    get bare() { return bare; },
    get tidy() { return tidy; },
    /** Text fuer den Bleistiftvermerk (z. B. Uhrzeit der Runde) */
    stampWith(fn) { stampFn = fn; },
    toggleBare() { setBare(!bare, { stamp: stampFn() }); },
    setBare,
    destroy() {
      window.removeEventListener('resize', onResize);
      coarseMq?.removeEventListener?.('change', onResize);
      offSettings();
      btn.remove(); back.remove(); note.remove(); card?.remove();
    },
  };
}
