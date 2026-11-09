// Handbuch fuer Einsteiger (?scene=handbuch, Hauptmenue "Handbuch", Dienstbuch > Tasten, Pausenmenue). Gedruckt wie
// eine Dienstvorschrift (Stil 03). Inhalt in js/ui/handbook-view.js. &teil=<id> springt zu einem Abschnitt.
import { ensureCss, esc } from '../ui/dom.js';
import { HANDBOOK_INTRO } from '../config/handbook.js';
import { DRILL_PATH, readDrill } from '../config/drill.js';
import { handbookBody, handbookToc, toolKeys, HANDBOOK_PARTS } from '../ui/handbook-view.js';

/** Ausfuehrliche Anleitung mit Bildern (docs/tutorial.md im Repository) */
export const TUTORIAL_URL = 'https://github.com/hjorven/lehmfront/blob/main/docs/tutorial.md';

export async function mount(root, params) {
  ensureCss('css/handbuch.css');
  document.title = 'Handbuch · Lehmfront';
  document.body.classList.add('menu'); // Systemfarben wie im Menue (Plan 7.7)
  const tools = await toolKeys();
  const drilled = readDrill()?.done;
  root.innerHTML = `<main class="hb">
    <header class="hb-head">
      <p class="hb-k">Dienstvorschrift Nr. 1 · für die Abschnittsführung</p>
      <h1>Handbuch</h1>
      <p class="hb-intro">${esc(HANDBOOK_INTRO)}</p>
      ${handbookToc()}
      <p class="hb-actions"><a class="btn hb-go" href="${DRILL_PATH}">${drilled ? 'Grundausbildung wiederholen' : 'Grundausbildung beginnen'}</a>
        <a class="btn" href="${TUTORIAL_URL}" target="_blank" rel="noopener">Anleitung mit Bildern</a>
        <a class="btn" href="./">Hauptmenü</a></p>
    </header>
    ${handbookBody({ tools })}
    <footer class="hb-foot"><a class="btn" href="./">Zurück zum Hauptmenü</a>
      <a class="btn" href="?scene=feldzug">Zur Kampagne</a><a class="btn" href="?scene=puzzle">Lehrgang</a></footer>
  </main>`;
  const part = params.get('teil');
  if (part && HANDBOOK_PARTS.some(([id]) => id === part)) root.querySelector('#hb-' + part)?.scrollIntoView();
}
