// Spielstand-Slots fuer Gefechte (P18). Baut auf js/save.js auf (Umschlag, Pruefstempel, Migrationen,
// IndexedDB/localStorage). Ein Slot traegt den Spielzustand und in meta alles, was das Gefecht zum
// Weiterspielen braucht: die URL-Abfrage, mit der es gestartet wurde (Karte, Modus, Seed), das
// Protokoll-Archiv, das Gedaechtnis der KI, das letzte Protokoll und die Zaehler der Abschlussmeldung.
// Dazu eine Bleistiftskizze der Front fuer die Kartentasche im Menue.
// Die Hilfsfunktionen ohne Speicher (sketchOf, saveQuery, slotTitle, packGame, unpackGame) sind rein.
import { SAVE_VERSION } from './save.js';
import { WEATHER } from './ui/labels.js';

/** Feste Slots: automatisch nach jeder Runde und drei Kartentaschen von Hand */
export const AUTO_SLOT = 'auto';
export const HAND_SLOTS = ['tasche-1', 'tasche-2', 'tasche-3'];
export const SLOTS = [AUTO_SLOT, ...HAND_SLOTS];

/** Parameter, die nur die Ansicht betreffen oder Screenshots steuern; sie gehoeren nicht in den Spielstand */
const VIEW_PARAMS = ['slot', 'demo', 'x', 'y', 'zoom', 'night', 'akte'];

/** Abfrage ohne Ansichtsparameter, sortiert (gleiches Gefecht, gleicher Text) */
export function saveQuery(params) {
  const p = new URLSearchParams(params);
  const keys = [...new Set([...p.keys()])].filter((k) => !VIEW_PARAMS.includes(k)).sort();
  const out = new URLSearchParams();
  for (const k of keys) out.set(k, p.get(k));
  if (!out.has('scene')) out.set('scene', 'gefecht');
  return out.toString();
}

/**
 * Bleistiftskizze: Grabenfelder je Seite und die Lage der Gruppen der planenden Seite.
 * map = Karte, wie die Seite sie kennt (mit gegrabenen Graeben). Kompakt: Feldindizes y * w + x.
 */
export function sketchOf(map, state, side = 'a') {
  const w = map.width, h = map.height;
  const own = [], enemy = [];
  for (const c of map.cells ?? []) {
    if (!c?.trench) continue;
    const i = c.y * w + c.x;
    if (c.side === 'enemy') enemy.push(i); else own.push(i);
  }
  own.sort((a, b) => a - b);
  enemy.sort((a, b) => a - b);
  const groups = (state.groups ?? [])
    .filter((g) => g.side === side && g.status !== 'lost' && g.pos)
    .map((g) => g.pos.y * w + g.pos.x)
    .sort((a, b) => a - b);
  return { w, h, a: own, b: enemy, g: groups, side };
}

/** Handschriftliche Beschriftung der Kartentasche, z. B. "Tag 2, 18 Uhr, Regen" */
export function slotTitle(state) {
  const c = state?.clock ?? {};
  const parts = [];
  if (c.day) parts.push(`Tag ${c.day}`);
  if (Number.isInteger(c.hour)) parts.push(`${c.hour} Uhr`);
  const w = WEATHER[state?.weather?.kind];
  if (w) parts.push(w);
  return parts.join(', ');
}

/**
 * Spielstand fuer save.js packen. game = { state, map, query, archive, aiMemory, lastLog, rules, side, label }.
 * Liefert { state, meta } (savedAt setzt die Ablage).
 */
export function packGame(game) {
  const { state } = game;
  return {
    state,
    meta: {
      label: game.label ?? '',
      query: game.query,
      title: slotTitle(state),
      turn: state.turn,
      turnKind: state.turnKind,
      sketch: game.map ? sketchOf(game.map, state, game.side ?? 'a') : null,
      game: {
        archive: game.archive ?? null,
        aiMemory: game.aiMemory ?? null,
        lastLog: game.lastLog ?? [],
        rules: game.rules ?? null,
        side: game.side ?? 'a',
        book: game.book ?? null,
      },
    },
  };
}

/**
 * Aus save.js-Ergebnis ({ state, meta, version }) die Teile zum Weiterspielen.
 * Stammt der Stand aus einer aelteren Version, sind die Startzustaende im Archiv nicht migriert:
 * dann faellt das Archiv weg (das Spiel selbst laeuft weiter).
 */
export function unpackGame(loaded) {
  const g = loaded.meta?.game ?? {};
  const sameVersion = loaded.version === SAVE_VERSION;
  return {
    state: loaded.state,
    query: loaded.meta?.query ?? 'scene=gefecht',
    archive: sameVersion && g.archive && Array.isArray(g.archive.rounds) ? g.archive : null,
    aiMemory: g.aiMemory ?? undefined,
    lastLog: Array.isArray(g.lastLog) ? g.lastLog : [],
    rules: g.rules ?? null,
    side: g.side === 'b' ? 'b' : 'a',
    book: g.book && typeof g.book === 'object' ? g.book : null,
    archiveDropped: !sameVersion && !!g.archive,
  };
}

/** Adresse zum Laden eines Slots. Die Abfrage kommt aus dem Stand (auch aus importierten Dateien):
 * normalisiert, Szene nur aus Kleinbuchstaben, Ziffern und Bindestrich, sonst "gefecht". */
export function loadHref(query, slot) {
  const q = new URLSearchParams(saveQuery(query || ''));
  if (!/^[a-z0-9-]+$/.test(q.get('scene') || '')) q.set('scene', 'gefecht');
  return '?' + q.toString() + '&slot=' + encodeURIComponent(slot);
}

/** Dateiname fuer den Export, nur ASCII */
export function exportName(slot, state) {
  const c = state?.clock ?? {};
  return `lehmfront-${slot}-tag${c.day ?? 0}-runde${state?.turn ?? 0}.json`;
}

/** Freien Handslot finden, sonst null */
export function freeSlot(list) {
  const used = new Set(list.filter((x) => !x.error).map((x) => x.slot));
  return HAND_SLOTS.find((s) => !used.has(s)) ?? null;
}
