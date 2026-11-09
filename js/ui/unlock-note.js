// Zettel "Neu freigeschaltet" (Einsteiger, js/unlocks.js): stellt neue Befehle mit je einem Satz vor.
// Erscheint einmal je Befehl, ueber der Werkzeugreihe; "Verstanden" legt ihn weg.
import { ensureCss, esc, icon } from './dom.js';
import { TOOL_HELP } from '../unlocks.js';
import { playSfx } from '../audio/engine.js';

/** tools: Werkzeuge aus dem Register ({ id, label, key, icon }); first: allererster Zettel (Begruessung) */
export function showUnlocked(ui, tools, { first = false } = {}) {
  if (!tools.length) return null;
  ensureCss('css/unlock.css');
  const el = document.createElement('section');
  el.className = 'card unlock-note';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Neue Befehle');
  el.innerHTML = `<span class="un-k">${first ? 'Deine ersten Befehle' : tools.length === 1 ? 'Neuer Befehl' : 'Neue Befehle'}</span>
    ${first ? '<p class="un-lead">Mehr brauchst du für den Anfang nicht. Weitere Befehle kommen nach und nach dazu.</p>' : ''}
    <ul>${tools.map((t) => `<li><span class="un-ico">${icon(t.icon ?? '', 24)}</span>
      <span><b>${esc(t.label)}</b> <kbd>${esc(String(t.key ?? '').toUpperCase())}</kbd><br>${esc(TOOL_HELP[t.id] ?? '')}</span></li>`).join('')}</ul>
    <p class="un-more">Genauer: Esc oder „Menü“, dann „Nachschlagen“.</p>
    <button type="button" class="btn un-ok">Verstanden</button>`;
  ui.append(el);
  playSfx('paper', { intensity: 0.5 });
  const close = () => el.remove();
  el.querySelector('.un-ok').addEventListener('click', close);
  el.querySelector('.un-ok').focus({ preventScroll: true });
  return { el, close };
}
