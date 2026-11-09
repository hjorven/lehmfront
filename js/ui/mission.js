// Kampagnenmission im Gefecht (P16): Auftragszettel, Tutorial-Hinweise als Bleistiftnotizen der Figuren und in
// Mission 1 die Karte, die sich erst zeichnet, wo die eigenen Leute hinsehen und graben (Ueberraschung).
//
// Kein Lehrmodus: die Hinweise kommen, wenn ihre Mechanik zum ersten Mal vorkommt, als Zettel am Kartenrand. Jede
// Mechanik wird nur einmal erklaert, ueber alle Missionen hinweg (localStorage "lehmfront-hinweise"). &hinweise=neu
// zeigt sie wieder (Screenshots). Texte aus data/texts/tutorial.json, Ziele aus js/missions/akt1.js (goalLines).
//
// In js/scenes/gefecht.js:
//   const mission = attachMissionUi({ ui, scenario, map, params, getArchive });  // null ohne scenario.mission
//   mission?.sync({ state, orders, selected, tool, busy });  // in refresh()
//   ...mission?.overlays(state) ?? []                         // unter den Gruppen
//   mission?.afterFilm(state, log);                           // nach dem Phasenfilm
import { esc, ensureCss, reducedMotion } from './dom.js';
import { goalLines } from '../missions/akt1.js';
import { positionRounds, mapSideOf } from '../missions/goals.js';
import { missionRound } from '../missions/script.js';
import { cellAt } from '../map.js';
import { cellKey } from '../state.js';
import { mudAt } from '../weather.js';
import { FONTS } from '../render/map-layer.js';
import { playSfx } from '../audio/engine.js';

const SEEN_KEY = 'lehmfront-hinweise';
const mem = { seen: null };

function loadSeen() {
  if (mem.seen) return mem.seen;
  try { mem.seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { mem.seen = new Set(); }
  return mem.seen;
}
function markSeen(mech) {
  const s = loadSeen();
  s.add(mech);
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...s].sort())); } catch { /* egal: dann nur fuer diese Sitzung */ }
}

/** Wohin eine Notiz zeigt (anker aus tutorial.json) */
const ANCHORS = {
  'werkzeug-graben': '[data-tool="dig"]',
  'werkzeug-draht': '[data-tool="wire"]',
  'werkzeug-sektor': '[data-tool="fire"]',
  'werkzeug-feuerplan': '[data-tool="fireplan"]',
  lorenplan: '[data-tool="supply"]',
  'etappe-feld': '[data-tool="etappe"]',
  'knopf-runde': '.exec',
  'uhr-wetter': '.round-clock',
};

const own = (state) => state.groups.filter((g) => g.side === 'a' && g.status !== 'lost');
const dugCells = (state) => Object.keys(state.cells ?? {}).filter((k) => state.cells[k].trench?.side === 'own' && state.cells[k].dig);

/** Laengstes gerades Stueck selbst gegrabener Feuergraben (senkrecht oder waagerecht) */
function longestRun(state) {
  const set = new Set(Object.keys(state.cells ?? {}).filter((k) => state.cells[k].trench?.side === 'own' && state.cells[k].trench?.kind === 'fire'));
  let best = 0;
  for (const k of set) {
    const [x, y] = k.split(',').map(Number);
    if (!set.has(cellKey(x, y - 1))) { let n = 0; while (set.has(cellKey(x, y + n))) n++; best = Math.max(best, n); }
    if (!set.has(cellKey(x - 1, y))) { let n = 0; while (set.has(cellKey(x + n, y))) n++; best = Math.max(best, n); }
  }
  return best;
}

/**
 * Ausloeser je Mechanik: ctx = { state, log, orders, selected, tool, round, after } (after: nach einem Phasenfilm).
 * Liefert true, wenn der Hinweis jetzt kommen soll.
 */
const TRIGGERS = {
  graben: ({ round, orders }) => round === 1 && !orders.some((o) => o.type === 'dig'),
  feuerrichtung: ({ state }) => dugCells(state).length > 0,
  laengsfeuer: ({ state, orders }) => longestRun(state) >= 5 || orders.some((o) => o.type === 'dig' && (o.path?.length ?? 0) >= 6),
  runde_ausfuehren: ({ orders }) => orders.length > 0,
  bericht: ({ after }) => after,
  unterdrueckung: ({ state }) => own(state).some((g) => (g.suppressed ?? 0) >= 0.5),
  mg_sektor: ({ selected }) => selected?.type === 'mg',
  unterstand: ({ state, log }) => own(state).some((g) => g.inDugout) || log.some((e) => e.type === 'impacts' && e.from === 'b'),
  draht: ({ round }) => round >= 2,
  lorenplan: () => true,
  etappe: ({ tool, round }) => tool === 'etappe' || round >= 2,
  feuerplan: () => true,
  beobachter: ({ selected }) => selected?.type === 'observers',
  grabenmoerser: ({ selected, round }) => selected?.type === 'mortar' || round >= 2,
  schlamm: ({ state, log, map }) => log.some((e) => e.type === 'mud_morale' && e.side === 'a') || own(state).some((g) => mudAt(state, map, g.pos.x, g.pos.y) >= 2),
  wetter: () => true,
  abloesung: ({ state, log }) => own(state).some((g) => (g.fatigue ?? 0) >= 60) || log.some((e) => e.type === 'too_long' && e.side === 'a'),
  ersatz: ({ state }) => own(state).some((g) => g.strength * 2 < (g.size ?? g.strength)),
  sturm: ({ orders }) => orders.some((o) => o.type === 'attack' || o.type === 'assault'),
};

/** Felder, die in Mission 1 schon auf dem Blatt stehen: um die Gruppen (gesehen) und um selbst gegrabene Graeben */
export const SURVEY_GROUP = 5;
export const SURVEY_TRENCH = 2;
export function surveyed(map, states) {
  const seen = new Uint8Array(map.width * map.height);
  const mark = (cx, cy, r) => {
    for (let y = Math.max(0, cy - r); y <= Math.min(map.height - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(map.width - 1, cx + r); x++) {
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy <= r * r + r) seen[y * map.width + x] = 1;
      }
    }
  };
  for (const st of states) {
    if (!st) continue;
    for (const g of st.groups ?? []) if (g.side === 'a' && g.status !== 'lost') mark(g.pos.x, g.pos.y, SURVEY_GROUP);
    for (const k of Object.keys(st.cells ?? {})) {
      const c = st.cells[k];
      if (c.trench?.side === 'own' || c.dig) { const [x, y] = k.split(',').map(Number); mark(x, y, SURVEY_TRENCH); }
    }
  }
  // Was Kaldern schon vorher hatte: die Schuetzenloecher der Karte
  for (const c of map.cells) if (c.trench?.side === mapSideOf('a')) mark(c.x, c.y, 1);
  return seen;
}

export function attachMissionUi({ ui, scenario, map, params, getArchive = () => ({ rounds: [] }), onChange = () => {} }) {
  const m = scenario?.mission;
  if (!m?.id) return null;
  ensureCss('css/mission.css');
  const fresh = params?.get?.('hinweise') === 'neu';
  const seen = fresh ? new Set() : new Set(loadSeen());
  let hints = [];
  let current = null;
  let last = { state: null, log: [] };
  let surveyCache = { key: '', seen: null };
  let lineKey = '';

  // Texte laden (asynchron, ohne Texte gibt es eben keine Notizen)
  fetch('data/texts/tutorial.json').then((r) => (r.ok ? r.json() : null)).then((d) => {
    const wanted = new Set(m.hints ?? []);
    hints = (d?.eintraege ?? []).filter((e) => e.art === 'hinweis' && wanted.has(e.id))
      .sort((p, q) => (m.hints.indexOf(p.id) - m.hints.indexOf(q.id)));
    if (last.state) check({ ...last, after: false });
  }).catch(() => {});

  // ---------- Auftragszettel ----------
  const slip = document.createElement('section');
  slip.className = 'card m-slip';
  slip.setAttribute('aria-label', 'Auftrag dieser Mission');
  const host = ui.querySelector('.hud-sheet') ?? ui;
  const round = ui.querySelector('.card.round');
  if (round?.parentNode === host) round.after(slip); else host.append(slip);

  function updateSlip(state) {
    const archive = getArchive();
    const rows = goalLines({ mission: m.id, state, rounds: archive.rounds ?? [], side: 'a', map });
    const k = JSON.stringify(rows);
    if (k === lineKey) return;
    lineKey = k;
    slip.innerHTML = `<span class="m-slip-k">Auftrag · ${esc(scenario.name ?? '')}</span><ul>${rows.map((r) =>
      `<li class="${r.done ? 'done' : r.warn ? 'warn' : ''}"><span class="m-tick" aria-hidden="true">${r.done ? '✓' : ''}</span>${esc(r.text)}</li>`).join('')}</ul>`;
  }

  // ---------- Bleistiftnotiz ----------
  const note = document.createElement('aside');
  note.className = 'm-note';
  note.hidden = true;
  note.setAttribute('role', 'note');
  ui.append(note);
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.setAttribute('class', 'm-arrow');
  arrow.setAttribute('aria-hidden', 'true');
  ui.append(arrow);
  note.addEventListener('click', (e) => { if (e.target.closest('.m-ok')) dismiss(); });
  note.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } });

  function dismiss() {
    if (!current) return;
    markSeen(current.mechanik);
    seen.add(current.mechanik);
    current = null;
    note.hidden = true;
    placeArrow();
    onChange();
    if (last.state) check({ ...last, after: false });
  }

  function show(h) {
    current = h;
    note.innerHTML = `<p class="m-text">${esc(h.text)}</p><span class="m-from">${esc(h.von === 'Selin' ? '' : '– ' + h.von)}</span>
      <button type="button" class="m-ok">Verstanden</button>`;
    note.hidden = false;
    note.classList.toggle('m-new', !reducedMotion());
    placeArrow();
    try { playSfx('pencil', { count: 3, intensity: 0.35 }); } catch { /* ohne Klang */ }
  }

  let marked = null;
  function placeArrow() {
    arrow.innerHTML = '';
    marked?.classList.remove('m-target');
    marked = null;
    if (!current) return;
    const sel = ANCHORS[current.anker];
    const target = sel ? ui.querySelector(sel) : null;
    if (!target || !target.getClientRects().length) return;
    // Bleistiftkringel um das Bedienelement, auf breiten Schirmen dazu ein Pfeil vom Zettel
    target.classList.add('m-target');
    marked = target;
    if (ui.clientWidth < 700) return;
    const box = ui.getBoundingClientRect();
    const a = note.getBoundingClientRect(), b = target.getBoundingClientRect();
    if (!b.width) return;
    const sx = a.left + a.width * 0.5 - box.left, sy = (b.top > a.bottom ? a.bottom : a.top) - box.top;
    const tx = b.left + b.width / 2 - box.left, ty = (b.top > a.bottom ? b.top - 6 : b.bottom + 6) - box.top;
    const mx = (sx + tx) / 2 + (tx > sx ? -30 : 30), my = (sy + ty) / 2;
    // Pfeilspitze in Laufrichtung
    const ang = Math.atan2(ty - my, tx - mx);
    const h = (d) => `${tx - 11 * Math.cos(ang + d)},${ty - 11 * Math.sin(ang + d)}`;
    arrow.innerHTML = `<path d="M${sx},${sy} Q${mx},${my} ${tx},${ty}" /><path d="M${h(0.45)} L${tx},${ty} L${h(-0.45)}" />`;
  }
  addEventListener('resize', placeArrow);

  function check(ctx) {
    if (current || !hints.length) return;
    for (const h of hints) {
      if (seen.has(h.mechanik)) continue;
      const fn = TRIGGERS[h.mechanik];
      if (fn && fn({ ...ctx, map })) { show(h); return; }
    }
  }

  // ---------- Karte, die sich zeichnet (Mission 1) ----------
  function surveyOverlay(state) {
    if (!m.survey) return null;
    return {
      draw(ctx, o) {
        const archive = getArchive();
        const key = `${state.turn}:${(archive.rounds ?? []).length}:${Object.keys(state.cells ?? {}).length}:${state.groups.map((g) => g.pos.x + '.' + g.pos.y).join(',')}`;
        if (surveyCache.key !== key) surveyCache = { key, seen: surveyed(map, [...(archive.rounds ?? []).map((r) => r.start), state]) };
        const seenCells = surveyCache.seen;
        const th = o.theme;
        ctx.save();
        // Leeres Blatt: Papierfarbe fast deckend, die Vorzeichnung schimmert durch
        ctx.fillStyle = th.paper;
        ctx.globalAlpha = 0.96;
        for (let y = 0; y < map.height; y++) {
          let run = -1;
          for (let x = 0; x <= map.width; x++) {
            const blank = x < map.width && !seenCells[y * map.width + x];
            if (blank && run < 0) run = x;
            if (!blank && run >= 0) { ctx.fillRect(run, y, x - run, 1.02); run = -1; }
          }
        }
        // Bleistiftschraffur am Rand des Gezeichneten
        ctx.globalAlpha = 0.45;
        ctx.strokeStyle = th.pencil ?? th.ink2;
        ctx.lineWidth = o.px * 1.1;
        ctx.beginPath();
        for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
          if (seenCells[y * map.width + x]) continue;
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seenCells[(y + dy) * map.width + x + dx] && x + dx >= 0 && x + dx < map.width);
          if (!edge) continue;
          const j = ((x * 7 + y * 13) % 5) / 10;
          ctx.moveTo(x + 0.15 + j * 0.3, y + 0.85); ctx.lineTo(x + 0.55 + j * 0.3, y + 0.2);
          ctx.moveTo(x + 0.5 + j * 0.2, y + 0.95); ctx.lineTo(x + 0.9, y + 0.45);
        }
        ctx.stroke();
        // Orte, die noch niemand gesehen hat: nur der Name mit Fragezeichen
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = th.pencil ?? th.ink2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 0.62px ${FONTS.hand}`;
        for (const l of map.labels ?? []) {
          const c = cellAt(map, Math.floor(l.x), Math.floor(l.y));
          if (!c || seenCells[c.y * map.width + c.x] || l.rotate) continue;
          if (/^(ETAPPE|NIEMANDSLAND)$/.test(l.text)) continue;
          ctx.fillText(l.text + '?', l.x, l.y);
        }
        ctx.restore();
      },
    };
  }

  return {
    mission: m.id,
    sync({ state, orders = [], selected = null, tool = null, busy = false }) {
      updateSlip(state);
      last = { state, log: last.log, orders, selected, tool, round: missionRound(state) };
      if (!busy) check({ ...last, after: false });
      else placeArrow();
    },
    afterFilm(state, log = []) {
      last = { ...last, state, log, round: missionRound(state) };
      updateSlip(state);
      check({ ...last, orders: last.orders ?? [], after: positionRounds(getArchive().rounds ?? []) >= 1 });
    },
    overlays(state) {
      const o = surveyOverlay(state);
      return o ? [o] : [];
    },
    get noteOpen() { return !!current; },
    dismiss,
  };
}
