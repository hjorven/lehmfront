// Pausenmenue im Gefecht (1.8.0): Esc, wenn nichts anderes offen ist, oder der Knopf "Menü".
// Weiterspielen, Nachschlagen (Handbuch im Spiel, ohne die Partie zu verlassen), Speichern und Einstellungen
// (Dienstbuch), Grundausbildung, Hauptmenue (zweimal tippen: Befehle dieser Runde gehen verloren).
import { ensureCss, esc } from './dom.js';
import { modal } from './commit.js';
import { handbookBody, handbookToc, toolKeys } from './handbook-view.js';
import { DRILL_PATH } from '../config/drill.js';
import { playSfx } from '../audio/engine.js';

/**
 * attachPauseMenu({ ui, onOpen, onClose, openSettings, pendingOrders, drill })
 * pendingOrders(): Zahl der noch nicht ausgefuehrten Befehle (Warnung beim Verlassen).
 * Liefert { open(view?), close(), get isOpen }.
 */
export function attachPauseMenu({ ui, onOpen = () => {}, onClose = () => {}, openSettings, pendingOrders = () => 0, drill = false }) {
  ensureCss('css/pause.css');
  ensureCss('css/handbuch.css');
  let m = null;
  let armed = null; // 'leave' | 'drill': einmal getippt, Warnung steht
  // Esc unabhaengig vom Fokus (ein Klick auf Text setzt ihn auf body): im Nachschlagen zurueck, sonst schliessen
  const onKey = (e) => {
    if (e.key !== 'Escape' || !m) return;
    e.preventDefault(); e.stopPropagation();
    if (m.box.classList.contains('pm-help')) showMain(); else close();
  };

  function close() {
    if (!m) return;
    window.removeEventListener('keydown', onKey, true);
    m.close();
    m = null;
    armed = null;
    onClose();
  }

  async function showHelp(part = null) {
    if (!m) return;
    const tools = await toolKeys();
    if (!m) return; // inzwischen geschlossen
    m.box.classList.add('pm-help');
    m.box.innerHTML = `<header class="pm-head"><b>Nachschlagen</b><button type="button" class="btn pm-back">Zurück</button></header>
      ${handbookToc('pm-')}
      <div class="pm-scroll hb">${handbookBody({ tools, idPrefix: 'pm-' })}</div>`;
    m.box.querySelector('.pm-back').focus({ preventScroll: true });
    if (part) m.box.querySelector('#pm-' + part)?.scrollIntoView();
  }

  function showMain() {
    if (!m) return;
    m.box.classList.remove('pm-help');
    const n = pendingOrders();
    m.box.innerHTML = `<header class="pm-head"><b>Pause</b><span>Die Front wartet.</span></header>
      <nav class="pm-list">
        <button type="button" class="btn pm-go" data-act="resume">Weiterspielen <kbd>Esc</kbd></button>
        <button type="button" class="btn" data-act="help">Nachschlagen <small>Einheiten, Gelände, Gebäude, Artillerie, Bauen</small></button>
        <button type="button" class="btn" data-act="settings">Speichern und Einstellungen <small>Dienstbuch</small></button>
        ${drill ? '' : `<a class="btn" href="${esc(DRILL_PATH)}" data-act="drill">Grundausbildung <small>verlässt diese Partie</small></a>`}
        <button type="button" class="btn pm-leave" data-act="leave">Zum Hauptmenü <small${n ? ' class="warn"' : ''}>${n ? `${n} ${n === 1 ? 'Befehl geht' : 'Befehle gehen'} verloren` : 'Stand vom Rundenbeginn bleibt'}</small></button>
      </nav>
      <p class="pm-note">Gespeichert wird von selbst nach jeder Runde (laufende Akte). „Weiterspielen“ im Hauptmenü holt die Partie zurück.</p>`;
    m.box.querySelector('.pm-go').focus({ preventScroll: true });
  }

  function open(view = 'main', part = null) {
    if (m) return;
    onOpen();
    m = modal(ui, 'pause-back', 'Pause', () => (m?.box.classList.contains('pm-help') ? showMain() : close()));
    m.box.classList.add('pause-menu');
    window.addEventListener('keydown', onKey, true);
    playSfx('paper', { intensity: 0.4 });
    m.box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act], .pm-back, [data-part]');
      if (!b) return;
      if (b.dataset.part) { e.preventDefault(); m.box.querySelector('#pm-' + b.dataset.part)?.scrollIntoView({ behavior: 'smooth' }); return; }
      if (b.classList.contains('pm-back')) { showMain(); return; }
      const act = b.dataset.act;
      if (act === 'resume') close();
      else if (act === 'help') showHelp();
      else if (act === 'settings') { close(); openSettings(); }
      else if (act === 'drill' && pendingOrders() && armed !== 'drill') { e.preventDefault(); armed = 'drill'; b.querySelector('small').textContent = 'Noch einmal tippen: Befehle dieser Runde gehen verloren'; }
      else if (act === 'leave') {
        if (armed !== 'leave' && pendingOrders()) { armed = 'leave'; b.querySelector('small').textContent = 'Noch einmal tippen: Befehle dieser Runde gehen verloren'; return; }
        location.href = './';
      }
    });
    if (view === 'help') showHelp(part); else showMain();
  }

  return { open, close, get isOpen() { return !!m; } };
}
