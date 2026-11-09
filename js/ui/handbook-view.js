// Inhalt des Handbuchs als HTML (Szene ?scene=handbuch und "Nachschlagen" im Pausenmenue des Gefechts).
// Abschnitte: So geht's, eine Runde, Einheiten, Gelaende, Gebaeude, Werte, Begriffe, Tasten, Ratschlaege.
import { esc } from './dom.js';
import { HANDBOOK_UNLOCK, HANDBOOK_ROUND, HANDBOOK_VALUES, HANDBOOK_TERMS, HANDBOOK_TIPS } from '../config/handbook.js';
import { UNIT_HELP, TERRAIN_HELP, HEIGHT_HELP, HOW_TO } from '../config/help.js';
import { UNIT_TYPES } from '../config/units.js';
import { TERRAIN } from '../map.js';
import { BUILDINGS } from '../config/buildings.js';
import { FIXED_KEYS, TOUCH } from './settings.js';

export const HANDBOOK_PARTS = [
  ['sogehts', 'So geht’s'],
  ['runde', 'Eine Runde'],
  ['einheiten', 'Einheiten'],
  ['gelaende', 'Gelände'],
  ['gebaeude', 'Gebäude'],
  ['werte', 'Werte'],
  ['begriffe', 'Begriffe'],
  ['tasten', 'Tasten'],
  ['rat', 'Ratschläge'],
];

const dl = (rows) => `<dl class="hb-dl">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;

/** Befehlstasten aus dem Werkzeug-Register (async, weil die Werkzeuge erst geladen werden) */
export async function toolKeys() {
  try {
    await import('./tools/index.js');
    const { allTools } = await import('./tools.js');
    return allTools().filter((t) => t.key).map((t) => [t.key.toUpperCase(), t.label]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  } catch { return []; }
}

/** Gebaeude, die man in der Etappe bauen kann, mit Kosten und Bauzeit */
function buildingRows() {
  return Object.entries(BUILDINGS)
    .filter(([id, b]) => b.effect && id !== 'gleis')
    .sort(([, a], [, b]) => (a.act ?? 1) - (b.act ?? 1))
    .map(([, b]) => [b.name, `${b.effect} Material ${b.cost}, ${b.buildTime === 1 ? 'eine Stellungsrunde' : b.buildTime + ' Stellungsrunden'}${(b.act ?? 1) > 1 ? `, ab Akt ${b.act}` : ''}.`]);
}

const AVAIL = { 'akt1-m4': 'ab Akt 1, Mission 4', akt2: 'ab Akt 2', akt3: 'ab Akt 3', akt4: 'ab Akt 4' };

/** Starteinheiten (in Akt 1 verfuegbar) zuerst, spaetere danach */
function unitRows() {
  return Object.values(UNIT_TYPES)
    .filter((u) => UNIT_HELP[u.id])
    .map((u) => [u.name + (AVAIL[u.available] ? ` (${AVAIL[u.available]})` : ''), UNIT_HELP[u.id]]);
}

export function handbookBody({ tools = [], idPrefix = 'hb-' } = {}) {
  const id = (k) => idPrefix + k;
  return `
    <section id="${id('sogehts')}" class="hb-part"><h2>So geht’s</h2>
      <div class="hb-how">${HOW_TO.map((h) => `<details><summary>${esc(h.title)}</summary><ol>${h.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details>`).join('')}</div>
      <p class="hb-unlock">${esc(HANDBOOK_UNLOCK)}</p></section>
    <section id="${id('runde')}" class="hb-part"><h2>Eine Runde in fünf Schritten</h2>
      <ol class="hb-steps">${HANDBOOK_ROUND.map(([k, v]) => `<li><b>${esc(k)}</b> ${esc(v)}</li>`).join('')}</ol>
      <p class="hb-note">Stellungsrunden dauern zwölf Stunden, Gefechtsrunden fünf Minuten. Tag und Nacht wechseln mit jeder Stellungsrunde.</p></section>
    <section id="${id('einheiten')}" class="hb-part"><h2>Einheiten</h2>
      <p class="hb-lead">Auf der Karte steht das Kürzel im Kästchen: 1 bis 6 Schützen, MG, Beo (Beobachter), Me (Melder), Pi (Pioniere), San (Sanitäter). Antippen zeigt das Schild mit allem über die Gruppe.</p>
      ${dl(unitRows())}</section>
    <section id="${id('gelaende')}" class="hb-part"><h2>Gelände</h2>
      <p class="hb-lead">Ein leeres Feld antippen (ohne gewählte Gruppe) zeigt, was dort ist.</p>
      ${dl([...Object.values(TERRAIN).filter((t) => TERRAIN_HELP[t.id]).map((t) => [t.name, TERRAIN_HELP[t.id]]), ['Höhe', HEIGHT_HELP],
        ['Trichter', 'Granattrichter geben etwas Deckung, machen das Feld aber zu Schlamm.'],
        ['Draht', 'Hält Angreifer fest. Pioniere schneiden Gassen, Artillerie zerreißt ihn.']])}</section>
    <section id="${id('gebaeude')}" class="hb-part"><h2>Gebäude der Etappe</h2>
      <p class="hb-lead">Gebaut wird im Etappenfenster (Etappe, M). Nachbarn helfen sich gegenseitig; das Fenster zeigt vorher, was ein Gebäude an seiner Stelle bringt.</p>
      ${dl(buildingRows())}</section>
    <section id="${id('werte')}" class="hb-part"><h2>Die Werte</h2>${dl(HANDBOOK_VALUES)}</section>
    <section id="${id('begriffe')}" class="hb-part"><h2>Begriffe von A bis Z</h2>${dl(HANDBOOK_TERMS)}</section>
    <section id="${id('tasten')}" class="hb-part"><h2>Tasten und Finger</h2>
      ${tools.length ? `<h3>Befehle</h3>${dl(tools)}` : ''}
      ${FIXED_KEYS.map(([t, rows]) => `<h3>${esc(t)}</h3>${dl(rows)}`).join('')}
      <h3>Mit dem Finger</h3>${dl(TOUCH)}</section>
    <section id="${id('rat')}" class="hb-part"><h2>Zehn Ratschläge für die erste Partie</h2>
      <ol class="hb-tips">${HANDBOOK_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
      <p class="hb-sign">gez. Harms, Feldwebel</p></section>`;
}

export function handbookToc(idPrefix = 'hb-') {
  return `<nav class="hb-toc" aria-label="Abschnitte">${HANDBOOK_PARTS.map(([id, t]) => `<a href="#${idPrefix}${id}" data-part="${id}">${esc(t)}</a>`).join('')}</nav>`;
}
