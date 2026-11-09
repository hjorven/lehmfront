// Handbuch fuer Einsteiger (?scene=handbuch, Hauptmenue "Handbuch", Dienstbuch > Tasten). Gedruckt wie eine
// Dienstvorschrift (Stil 03): Eine Runde in fuenf Schritten, die Werte, Begriffe von A bis Z, Tasten, zehn
// Ratschlaege. &teil=<id> springt zu einem Abschnitt. Inhalte: js/config/handbook.js.
import { ensureCss, esc } from '../ui/dom.js';
import { HANDBOOK_INTRO, HANDBOOK_ROUND, HANDBOOK_VALUES, HANDBOOK_TERMS, HANDBOOK_TIPS } from '../config/handbook.js';
import { FIXED_KEYS, TOUCH } from '../ui/settings.js';
import { DRILL_PATH, readDrill } from '../config/drill.js';

/** Ausfuehrliche Anleitung mit Bildern (docs/tutorial.md im Repository) */
export const TUTORIAL_URL = 'https://github.com/hjorven/lehmfront/blob/main/docs/tutorial.md';

const PARTS = [
  ['runde', 'Eine Runde'],
  ['werte', 'Die Werte'],
  ['begriffe', 'Begriffe'],
  ['tasten', 'Tasten'],
  ['rat', 'Zehn Ratschläge'],
];

const dl = (rows) => `<dl class="hb-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

export async function mount(root, params) {
  ensureCss('css/handbuch.css');
  document.title = 'Handbuch · Lehmfront';
  document.body.classList.add('menu'); // Systemfarben wie im Menue (Plan 7.7)
  let tools = [];
  try {
    await import('../ui/tools/index.js');
    const { allTools } = await import('../ui/tools.js');
    tools = allTools().filter((t) => t.key).map((t) => [t.key.toUpperCase(), t.label]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  } catch { /* ohne Werkzeuge nur feste Tasten */ }
  const drilled = readDrill()?.done;
  root.innerHTML = `<main class="hb">
    <header class="hb-head">
      <p class="hb-k">Dienstvorschrift Nr. 1 · für die Abschnittsführung</p>
      <h1>Handbuch</h1>
      <p class="hb-intro">${esc(HANDBOOK_INTRO)}</p>
      <nav class="hb-toc" aria-label="Abschnitte">${PARTS.map(([id, t]) => `<a href="#hb-${id}">${esc(t)}</a>`).join('')}</nav>
      <p class="hb-actions"><a class="btn hb-go" href="${DRILL_PATH}">${drilled ? 'Grundausbildung wiederholen' : 'Grundausbildung beginnen'}</a>
        <a class="btn" href="${TUTORIAL_URL}" target="_blank" rel="noopener">Anleitung mit Bildern</a>
        <a class="btn" href="./">Hauptmenü</a></p>
    </header>
    <section id="hb-runde" class="hb-part"><h2>Eine Runde in fünf Schritten</h2>
      <ol class="hb-steps">${HANDBOOK_ROUND.map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ol>
      <p class="hb-note">Stellungsrunden dauern zwölf Stunden, Gefechtsrunden fünf Minuten. Tag und Nacht wechseln mit jeder Stellungsrunde.</p></section>
    <section id="hb-werte" class="hb-part"><h2>Die Werte</h2>${dl(HANDBOOK_VALUES)}</section>
    <section id="hb-begriffe" class="hb-part"><h2>Begriffe von A bis Z</h2>${dl(HANDBOOK_TERMS)}</section>
    <section id="hb-tasten" class="hb-part"><h2>Tasten und Finger</h2>
      ${tools.length ? `<h3>Befehle</h3>${dl(tools)}` : ''}
      ${FIXED_KEYS.map(([t, rows]) => `<h3>${esc(t)}</h3>${dl(rows)}`).join('')}
      <h3>Mit dem Finger</h3>${dl(TOUCH)}</section>
    <section id="hb-rat" class="hb-part"><h2>Zehn Ratschläge für die erste Partie</h2>
      <ol class="hb-tips">${HANDBOOK_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="hb-sign">gez. Harms, Feldwebel</p></section>
    <footer class="hb-foot"><a class="btn" href="./">Zurück zum Hauptmenü</a>
      <a class="btn" href="?scene=feldzug">Zur Kampagne</a><a class="btn" href="?scene=puzzle">Lehrgang</a></footer>
  </main>`;
  const part = params.get('teil');
  if (part && PARTS.some(([id]) => id === part)) root.querySelector('#hb-' + part)?.scrollIntoView();
}
