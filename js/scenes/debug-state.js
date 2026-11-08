// Debug-Ansicht: Spielzustand, Protokoll und Sicht als Text (P01, fuer Screenshot-Check und Fehlersuche).
// Aufruf: index.html?scene=debug-state&seed=42&turns=3&side=a&kind=position
// turns: so viele Runden (alle halten) vorab ausfuehren. side: a, b oder all (ungefiltert).
import { createInitialState, groupsOf } from '../state.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { exportSave, inspectSave, createSaveStore } from '../save.js';
import { unitType } from '../config/units.js';
import { faction } from '../config/factions.js';
import { ORDER_TYPES } from '../config/orders.js';

const MAP = { id: 'pruefstand', width: 30, height: 16 };
const SCENARIO = {
  id: 'pruefstand',
  name: 'Prüfstand an der Asse',
  sides: {
    a: { faction: 'kaldern', groups: [
      { type: 'rifles', pos: { x: 6, y: 3 } }, { type: 'rifles', pos: { x: 6, y: 8 } }, { type: 'mg', pos: { x: 7, y: 5 } },
      { type: 'pioneers', pos: { x: 4, y: 11 } }, { type: 'observers', pos: { x: 3, y: 6 } },
    ] },
    b: { faction: 'morrow', groups: [
      { type: 'rifles', pos: { x: 23, y: 3 } }, { type: 'rifles', pos: { x: 12, y: 8 } }, { type: 'mg', pos: { x: 22, y: 6 } },
    ] },
  },
};

const WEATHER = { clear: 'klar', rain: 'Regen', fog: 'Nebel', storm: 'Sturm', snow: 'Schnee' };
const WIND = { n: 'Nord', ne: 'Nordost', e: 'Ost', se: 'Südost', s: 'Süd', sw: 'Südwest', w: 'West', nw: 'Nordwest' };
const STATUS = { front: 'vorn', reserve: 'Reserve', rest: 'Ruhe', lost: 'aufgerieben' };

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const two = (n) => String(n).padStart(2, '0');

export async function mount(root, params) {
  const link = el('link', { rel: 'stylesheet', href: 'css/debug-state.css' });
  document.head.append(link);
  // Debug-Ansicht folgt dem Systemmodus wie die Menues (dunkle Token haengen an body.menu, css/style.css)
  document.body.classList.add('menu');
  const seed = Number.parseInt(params.get('seed') ?? '42', 10) >>> 0;
  const turns = Math.max(0, Math.min(40, Number.parseInt(params.get('turns') ?? '3', 10) || 0));
  const sideParam = params.get('side') ?? 'a';
  const side = ['a', 'b'].includes(sideParam) ? sideParam : null;

  let state = createInitialState(MAP, SCENARIO, seed);
  if (params.get('kind') === 'battle') state = { ...state, turnKind: 'battle', battle: { round: 0, attacker: 'a' } };
  let log = [];
  const run = () => {
    // Testbefehle: a01 bekommt abwechselnd einen gueltigen und einen ungueltigen Befehl, damit das Protokoll beides zeigt
    const t = state.turn;
    const ordersA = state.turnKind === 'position'
      ? [t % 2 ? { group: 'a04', type: 'dig', path: [{ x: 5, y: 11 }, { x: 6, y: 11 }] } : { group: 'a01', type: 'assault', path: [{ x: 9, y: 3 }] }]
      : [{ group: 'a01', type: 'move', path: [{ x: 7, y: 3 }] }];
    const r = resolveTurn(state, ordersA, [], state.seed, t);
    state = r.state;
    log = r.log;
  };
  for (let i = 0; i < turns; i++) run();

  const store = createSaveStore();
  const out = el('div', { class: 'dbg', role: 'main' });
  root.append(out);

  function render(note = '') {
    const view = side ? viewFor(state, log, side) : null;
    const shownGroups = view ? view.groups : groupsOf(state, null, { includeLost: true });
    const shownLog = view ? view.log : log;
    const c = state.clock;
    const exported = exportSave(state, { name: 'Debug' });
    const check = inspectSave(exported);
    const STAMP = { ok: 'GEPRÜFT ' + JSON.parse(exported).stamp, fehlt: 'OHNE STEMPEL', beschaedigt: 'BESCHÄDIGT' };

    out.replaceChildren(
      el('h1', {}, 'Lagezustand, Prüfstand'),
      el('p', { class: 'sub' }, `Sicht: ${side ? 'Seite ' + side + ' (' + faction(state.sides[side].faction).short + ')' : 'ungefiltert'} · Seed ${state.seed} · ${note || 'bereit'}`),
      el('div', { class: 'dbg-bar' },
        el('button', { type: 'button', onclick: () => { if (!state.result) run(); render('Runde ausgeführt'); } }, 'Runde ausführen'),
        el('button', { type: 'button', onclick: async () => { await store.save('debug', state, { name: 'Debug' }); render('gespeichert in ' + (await store.backendName())); } }, 'Speichern'),
        el('button', { type: 'button', onclick: async () => {
          const r = await store.load('debug');
          if (r) { state = r.state; log = []; render('geladen, Stempel ' + r.stamp); } else render('kein Stand gespeichert');
        } }, 'Laden'),
        el('button', { type: 'button', onclick: async () => {
          try { await navigator.clipboard.writeText(exported); render('Export in der Zwischenablage'); } catch { render('Zwischenablage gesperrt, Export steht unten'); }
        } }, 'Export kopieren'),
      ),
      el('div', { class: 'dbg-grid' },
        el('section', {},
          el('h2', {}, 'Lage'),
          el('dl', { class: 'dbg-kv' },
            el('dt', {}, 'Szenario'), el('dd', {}, `${state.scenario.name} (${state.map.id}, ${state.map.width} x ${state.map.height})`),
            el('dt', {}, 'Runde'), el('dd', {}, `${state.turn} · ${state.turnKind === 'battle' ? 'Gefechtsrunde' + (state.battle ? ' ' + state.battle.round + ' von 12' : '') : 'Stellungsrunde'}`),
            el('dt', {}, 'Zeit'), el('dd', {}, `Tag ${c.day}, ${two(c.hour)}:${two(c.minute)} Uhr · ${state.night ? 'Nacht' : 'Tag'}`),
            el('dt', {}, 'Wetter'), el('dd', {}, `${WEATHER[state.weather.kind] ?? state.weather.kind}, Wind aus ${WIND[state.weather.wind.dir] ?? state.weather.wind.dir}, Stärke ${state.weather.wind.speed}`),
            ...['a', 'b'].flatMap((s) => {
              if (side && s !== side) return [];
              const sd = state.sides[s];
              return [el('dt', {}, `Vorräte ${s}`), el('dd', {}, `Munition ${sd.supplies.ammo} · Verpflegung ${sd.supplies.food} · Material ${sd.supplies.material}`)];
            }),
            el('dt', {}, 'Ergebnis'), el('dd', {}, state.result ? `${state.result.winner ?? 'keiner'}: ${state.result.reason}` : 'läuft'),
          ),
          el('h2', {}, 'Gruppen'),
          el('div', { class: 'dbg-scroll' }, el('table', { class: 'dbg-groups' },
            el('thead', {}, el('tr', {}, ...['ID', 'Einheit', 'Führer', 'Stärke', 'Erf.', 'Ersch.', 'Moral', 'Ort', 'Hält'].map((h) => el('th', { scope: 'col' }, h)))),
            el('tbody', {}, ...shownGroups.map((g) => el('tr', { class: 'side-' + g.side },
              el('td', {}, g.id),
              el('td', {}, unitType(g.type).short),
              el('td', {}, g.leader ? `${g.leader.name}, ${g.leader.home}` : 'unbekannt'),
              el('td', {}, g.strength === undefined ? '?' : `${g.strength}/${g.size}`),
              el('td', {}, g.experience ?? '?'),
              el('td', {}, g.fatigue ?? '?'),
              el('td', {}, g.morale ?? '?'),
              el('td', {}, `${g.pos.x},${g.pos.y}`),
              el('td', {}, g.holdTurns === undefined ? (STATUS[g.status] ?? '') : String(g.holdTurns)),
            ))),
          )),
        ),
        el('section', {},
          el('h2', {}, `Protokoll Runde ${state.turn - 1 || '-'}`),
          el('div', { class: 'dbg-tape' },
            shownLog.length
              ? shownLog.map((e) => el('p', { class: e.minor ? 'minor' : '' }, el('span', { class: 'ph' }, e.phase), e.reason, el('span', { class: 'stop' }, ` (${e.at.x},${e.at.y}) STOP`)))
              : el('p', { class: 'minor' }, 'Noch keine Meldungen.'),
          ),
          el('h2', {}, 'Befehlsarten'),
          el('p', {}, Object.values(ORDER_TYPES).filter((t) => t.kind === 'both' || t.kind === state.turnKind).map((t) => t.label).join(' · ')),
        ),
      ),
      el('h2', {}, side ? `Sicht Seite ${side} (JSON), Stempel gilt dem vollen Spielstand` : 'Spielstand (Export)'),
      el('div', { class: 'dbg-stamp' },
        el('span', { class: 'stamp' + (check.stamp === 'ok' ? ' ok' : '') }, STAMP[check.stamp]),
        el('pre', {}, JSON.stringify(side ? viewFor(state, log, side) : state, null, 1)),
      ),
    );
  }
  render();
}
