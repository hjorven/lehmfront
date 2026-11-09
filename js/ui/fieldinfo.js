// Feldinfo (Einsteiger, 1.8.0): Antippen eines leeren Feldes ohne gewaehlte Gruppe erklaert, was dort ist.
// fieldInfo(map, state, x, y, side) ist rein und liefert { title, rows: [{ k, v, help }] }. map = Lagekarte der
// Seite (applyCellState mit den gesehenen Feldern, withEtappe), state = { weather, cells: gesehene Felder }:
// so verraet die Feldinfo nichts, was die Seite nicht sieht.
import { TERRAIN, cellAt, cellLabel, ZONE_NAMES } from '../map.js';
import { LEVELS } from '../trench.js';
import { mudAt, snowAt, waterAt, MUD_WORDS, SNOW_WORDS, WATER_WORDS } from '../weather.js';
import { TERRAIN_HELP, HEIGHT_HELP, MAP_BUILDING_HELP } from '../config/help.js';
import { BUILDINGS } from '../config/buildings.js';
import { MAP_TYPES } from '../etappe-map.js';

const DIR_NAME = { N: 'Norden', E: 'Osten', S: 'Süden', W: 'Westen', NE: 'Nordosten', SE: 'Südosten', SW: 'Südwesten', NW: 'Nordwesten' };

export function fieldInfo(map, state, x, y, side = 'a') {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const rows = [];
  const t = TERRAIN[c.terrain];
  rows.push({ k: 'Boden', v: t?.name ?? c.terrain, help: TERRAIN_HELP[c.terrain] ?? '' });
  rows.push({ k: 'Höhe', v: String(c.height), help: c.height > 0 ? HEIGHT_HELP : '' });
  const ownSide = side === 'a' ? 'own' : 'enemy';
  rows.push({ k: 'Zone', v: c.zone === 'niemandsland' ? 'Niemandsland' : `${ZONE_NAMES[c.zone] ?? c.zone} ${c.side === ownSide ? '(eigene)' : '(Gegner)'}`, help: c.zone === 'niemandsland' ? 'Zwischen den Linien: keine Deckung außer Trichtern.' : '' });
  if (c.trench) {
    const lv = LEVELS[c.trench.level] ?? LEVELS[2];
    const mine = c.trench.side === ownSide;
    rows.push({
      k: 'Graben', v: `${lv?.name ?? 'Graben'}${mine ? '' : ' (Gegner)'}${c.trench.captured ? ', erobert' : ''}`,
      help: c.trench.kind === 'comm' || c.trench.kind === 'lauf'
        ? 'Laufgraben: gedeckter Weg nach vorn, über ihn kommt auch die Versorgung.'
        : `Deckung gegen Feuer. Geschossen wird nach ${DIR_NAME[c.trench.facing] ?? c.trench.facing ?? 'vorn'}.${c.trench.captured ? ' Erobert: nur halbe Deckung, bis er umgebaut ist (U).' : ''}`,
    });
  }
  if (c.wire) rows.push({ k: 'Draht', v: c.wire.side === ownSide ? 'eigener' : 'feindlicher', help: 'Hält Angreifer fest. Pioniere schneiden Gassen, Artillerie zerreißt ihn.' });
  if (c.crater) rows.push({ k: 'Trichter', v: c.crater > 1 ? 'großer Krater' : 'Granattrichter', help: 'Gibt etwas Deckung, macht das Feld aber zu Schlamm.' });
  if (c.rail) rows.push({ k: 'Gleis', v: 'Feldbahn', help: 'Auf dem Gleis fahren die Loren bis zum Gleisende.' });
  // Gebaeude so, wie die Lagekarte sie zeigt (eigene Etappe, gesichtete feindliche), nicht aus der Grundkarte
  const b = (map.buildings ?? []).find((q) => x >= Math.floor(q.x) && x < Math.ceil(q.x + (q.w ?? 1)) && y >= Math.floor(q.y) && y < Math.ceil(q.y + (q.h ?? 1)));
  if (b) {
    const def = BUILDINGS[b.type] ?? BUILDINGS[MAP_TYPES[b.type]];
    const help = MAP_BUILDING_HELP[b.type] ?? def?.effect ?? '';
    rows.push({ k: 'Gebäude', v: `${def?.name ?? b.label ?? 'Gebäude'}${b.side && b.side !== ownSide ? ' (Gegner)' : ''}`, help });
  }
  if (state) {
    const s = snowAt(state, map, x, y);
    if (s) rows.push({ k: 'Schnee', v: SNOW_WORDS[s], help: s >= 2 ? 'Wege dauern länger, nachts frieren Posten ohne Unterstand.' : '' });
    const m = mudAt(state, map, x, y);
    if (m) rows.push({ k: 'Schlamm', v: MUD_WORDS[m], help: m >= 2 ? 'Langsamer, Graben dauert länger, kostet Moral.' : '' });
    if (c.trench && c.trench.side === ownSide) { const w = waterAt(state, x, y); if (w) rows.push({ k: 'Wasser', v: WATER_WORDS[w], help: 'Entwässern (W) pumpt es ab.' }); }
  }
  return { title: `Feld ${cellLabel(x, y)}`, rows };
}

/** Kaertchen auf der Karte: zeigt die Feldinfo, Schliessen mit × oder Esc */
export function createFieldCard(root, esc) {
  const el = document.createElement('section');
  el.className = 'card field-card';
  el.hidden = true;
  el.setAttribute('aria-live', 'polite');
  root.append(el);
  el.addEventListener('click', (e) => { if (e.target.closest('.fc-x')) el.hidden = true; });
  return {
    get open() { return !el.hidden; },
    /** at: Bildschirmpunkt des Feldes (relativ zu root); breit steht das Kaertchen daneben, schmal unten */
    show(info, at = null) {
      if (!info) { el.hidden = true; return; }
      el.innerHTML = `<header><b>${esc(info.title)}</b><button type="button" class="fc-x" aria-label="Feldinfo schließen">×</button></header>
        <dl>${info.rows.map((r) => `<div><dt>${esc(r.k)}</dt><dd><b>${esc(r.v)}</b>${r.help ? `<span>${esc(r.help)}</span>` : ''}</dd></div>`).join('')}</dl>
        <p class="fc-tip">Tipp: Gruppe wählen und ein Feld antippen zeigt, ob sie dorthin sieht.</p>`;
      el.hidden = false;
      el.style.left = el.style.top = '';
      if (at && root.clientWidth > 700) {
        const w = el.offsetWidth, h = el.offsetHeight, vw = root.clientWidth, vh = root.clientHeight;
        const right = at.x + 28 + w <= vw - 140; // rechts ist die Knopfspalte
        const left = right ? at.x + 28 : at.x - 28 - w;
        el.style.left = Math.round(Math.max(8, Math.min(vw - w - 8, left))) + 'px';
        el.style.top = Math.round(Math.max(90, Math.min(vh - h - 96, at.y - h / 2))) + 'px';
      }
    },
    hide() { el.hidden = true; },
  };
}
