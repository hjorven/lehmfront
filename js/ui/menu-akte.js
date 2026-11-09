// Hauptmenue (P18): "Weiterspielen" aus der laufenden Akte und das Dienstbuch.
// ?akte=<reiter> oeffnet das Dienstbuch gleich (Screenshots, Lesezeichen).
import { createSaveStore } from '../save.js';
import { AUTO_SLOT, loadHref } from '../savegame.js';
import { openSettings } from './settings.js';
import { playSfx } from '../audio/engine.js';

export async function mountMenuAkte(params) {
  const akte = document.getElementById('menu-akte');
  akte?.addEventListener('click', () => { playSfx('stamp', { intensity: 0.4 }); openSettings({ opener: akte }); });
  if (params.has('akte')) openSettings({ tab: params.get('akte'), opener: akte });
  const weiter = document.getElementById('menu-weiter');
  if (!weiter) return;
  try {
    const auto = await createSaveStore().load(AUTO_SLOT);
    if (!auto) return;
    weiter.href = loadHref(auto.meta?.query, AUTO_SLOT);
    const t = auto.meta?.title;
    weiter.querySelector('small').textContent = `Runde ${auto.state.turn}${t ? ' · ' + t : ''}`;
    weiter.hidden = false;
  } catch { /* ohne lesbare Akte kein Weiterspielen */ }
}
