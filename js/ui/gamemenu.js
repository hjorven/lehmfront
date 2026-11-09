// Dienstbuch im Gefecht (P18): Knopf "Menü" in der rechten Leiste (Desktop) und in der Seitenleiste (Handy),
// Taste O. Dazu Spielstaende: automatisch nach jeder Runde (Slot "auto", mit Protokoll-Archiv) und von Hand
// in drei Kartentaschen; ?slot=<name> laedt einen Stand beim Start der Szene.
import { createSaveStore, stampOf } from '../save.js';
import { AUTO_SLOT, packGame, unpackGame, saveQuery, loadHref } from '../savegame.js';
import { openSettings, settingsOpen } from './settings.js';
import { ensureCss } from './dom.js';

const store = createSaveStore();

/** War der Seitenaufruf ein Neuladen (F5, Wischgeste)? */
function isReload() {
  try { return performance.getEntriesByType('navigation')[0]?.type === 'reload'; } catch { return false; }
}

/**
 * Schluessel, an dem ein Gefecht ueber das Neuladen hinweg wiedererkannt wird. Kampagne: der Aufbruch zur
 * Mission (bleibt bis zur Meldung gleich), so geht ein Einsatz auch nach dem Schliessen des Browsers weiter.
 */
export async function resumeKeyFor(params) {
  // P22: im Frontabschnitt gehoert die Akte zur laufenden Woche
  if (params.has('endlos')) {
    try {
      const { weekStamp } = await import('./endless/store.js');
      const w = weekStamp();
      return w ? 'endlos-' + w : null;
    } catch { return null; }
  }
  if (!params.has('campaign')) return null;
  try {
    const { loadMissionStart } = await import('./campaign/store.js');
    const start = loadMissionStart();
    return start ? 'kampagne-' + stampOf(JSON.stringify(start)) : null;
  } catch { return null; }
}

/**
 * Stand laden: ?slot=<name> ausdruecklich, sonst die laufende Akte, wenn sie zu diesem Gefecht gehoert
 * (gleiche Abfrage und Neuladen, oder gleicher Kampagnen-Aufbruch). Liefert unpackGame(...) mit slot oder null.
 */
export async function resumeGame(params) {
  const slot = params.get('slot');
  try {
    if (slot) {
      if (!/^[a-z0-9-]+$/.test(slot)) return null;
      const loaded = await store.load(slot);
      if (!loaded) return null;
      // Gehoert der Stand zu einem anderen Gefecht (Lesezeichen, alte Adresse): dorthin umleiten
      if (loaded.meta?.query && saveQuery(loaded.meta.query) !== saveQuery(params)) {
        location.replace(loadHref(loaded.meta.query, slot));
        return new Promise(() => {}); // die Seite wird ersetzt
      }
      return { slot, ...unpackGame(loaded) };
    }
    if (params.has('demo')) return null;
    const auto = await store.load(AUTO_SLOT);
    if (!auto || auto.meta?.query !== saveQuery(params)) return null;
    const key = await resumeKeyFor(params);
    const same = key ? auto.meta?.resumeKey === key : isReload();
    return same ? { slot: AUTO_SLOT, reload: true, ...unpackGame(auto) } : null;
  } catch (e) {
    console.warn('Spielstand nicht ladbar:', e.message);
    return null;
  }
}

/**
 * attachGameMenu({ ui, params, snapshot, busy, canOpen, ended, onOpen, onClose })
 * snapshot() -> { state, map, archive, aiMemory, lastLog, rules, side }; busy() -> null | Grund, warum gerade nicht.
 * Liefert { open(tab), autosave(), get open }.
 */
export function attachGameMenu({ ui, params, snapshot, busy, canOpen = () => true, ended = () => false, onOpen = () => {}, onClose = () => {} }) {
  ensureCss('css/einstellungen.css');
  const query = saveQuery(params);
  const keyP = resumeKeyFor(params);
  const mk = (cls) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-keyshortcuts', 'O');
    b.innerHTML = 'Menü <kbd>O</kbd>';
    b.addEventListener('click', () => open());
    return b;
  };
  ui.querySelector('.hud-right')?.prepend(mk('menu-btn'));
  const sheetBtn = mk('menu-card');
  sheetBtn.innerHTML = 'Dienstbuch <small>Spielstände, Klang, Darstellung</small>';
  ui.querySelector('.hud-sheet')?.append(sheetBtn);

  const save = async (slot, label = '') => {
    const { state, meta } = packGame({ ...snapshot(), query, label });
    return store.save(slot, state, { ...meta, resumeKey: await keyP });
  };

  function open(tab = 'akten') {
    if (settingsOpen() || !canOpen()) return;
    onOpen();
    openSettings({
      tab,
      container: document.body,
      game: { canSave: busy, save: (slot) => save(slot) },
      onClose,
    });
  }

  return {
    open,
    get isOpen() { return settingsOpen(); },
    /** Nach jeder Runde: laufende Akte schreiben. Fehler (Speicher voll, privat) nur melden, nie stoeren. */
    async autosave() {
      if (params.has('demo')) return false; // Screenshot-Zustaende ueberschreiben keine echte Akte
      // P20: Wiedergabe und Online-Gefecht beruehren die laufende Akte nicht (der Stand liegt im Link bzw. beim Stab)
      if (params.has('wiedergabe') || params.has('match')) return false;
      // Beendete Partie: keine laufende Akte mehr (sonst boete das Hauptmenue "Weiterspielen" an)
      if (ended()) { try { await store.remove(AUTO_SLOT); } catch { /* egal */ } return false; }
      try { await save(AUTO_SLOT, 'auto'); return true; } catch (e) { console.warn('Automatisch speichern ging nicht:', e.message); return false; }
    },
  };
}
