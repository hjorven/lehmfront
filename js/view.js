// Gefilterte Sicht pro Seite (Plan 10.6, Nebel des Krieges).
// Eigene Einheiten vollstaendig, fremde nur, wenn eine eigene Gruppe sie sieht (Sichtlinie mit Hoehe, Dunkelheit,
// Deckung, Muendungsfeuer; Regeln in js/sight.js). Nicht mehr sichtbare Feinde bleiben als Geister mit Alter in
// Runden, gefuehrt von der Phase intel (js/phases/intel.js) in state.sides[side].intel.lastSeen.
// Die Sichtregel bleibt austauschbar: setVisibilityRules({ groupVisible, cellVisible, eventVisible }).
// Rein: kein DOM, kein Date, kein Math.random.
import { unitType } from './config/units.js';
import { groupsOf, cellKeys, otherSide } from './state.js';
import { darknessOf, sightRange, sideSeesCell, visibleEnemies, sectorOf } from './sight.js';

/** Sichtweite am Tag ohne Hoehe und Deckung (alte Schnittstelle, Werte aus js/sight.js) */
export const DAY_SIGHT = 12;
export const NIGHT_SIGHT = 4;
/** Geister aelter als das werden vergessen */
export const MAX_GHOST_AGE = 8;

/** Sichtweite einer Gruppe auf offenes Feld gleicher Hoehe (fuer Anzeigen) */
export function sightOf(state, group) {
  return sightRange(null, group, group.pos, darknessOf(state));
}

/** Sieht irgendeine eigene Gruppe den Ort p? env.map fuer Sichtlinien, env.darkness ueberschreibt die Uhr */
export function seesPoint(state, side, p, env = {}) {
  return sideSeesCell(state, env.map ?? null, side, p, env.darkness ?? darknessOf(state));
}

const DEFAULT_RULES = {
  groupVisible: (state, side, group, ctx) => ctx.visible.has(group.id),
  cellVisible: () => true,
  // Ereignisse mit side: nur diese Seite. Ausnahme: public: true und der Ort ist fuer die andere Seite sichtbar
  // (z. B. Einschlag, Sturm). Befehle, Namen und Halten bleiben so beim Gegner verborgen.
  // Ereignisse ohne side (Wetter, Uhr): beide Seiten.
  eventVisible: (state, side, e, ctx) => {
    if (e.side === undefined || e.side === null) return true;
    if (e.side === side) return true;
    return e.public === true && sideSeesCell(state, ctx.map, side, e.at, ctx.darkness);
  },
};

let rules = { ...DEFAULT_RULES };

/** Sichtregeln tauschen (teilweise). Ohne Argument: zurueck auf die Grundregeln. */
export function setVisibilityRules(partial) {
  rules = partial ? { ...rules, ...partial } : { ...DEFAULT_RULES };
}

function enemyStub(g) {
  const s = { id: g.id, side: g.side, type: g.type, pos: { ...g.pos }, status: g.status, inDugout: g.inDugout, seen: true };
  // Wer gefeuert hat, verraet seine Richtung: beim MG sieht man den Kegel
  if (g.fired && unitType(g.type).sector) {
    const sec = sectorOf(g);
    if (sec) s.sector = { ...sec.aim };
  }
  if (g.fired) s.fired = true;
  if (g.moved) s.moved = true;
  return s;
}

/**
 * Sicht einer Seite auf Zustand und Protokoll.
 * env (optional): { map } fuer Sichtlinien und Deckung, { darkness } ueberschreibt die Dunkelheit der Uhr.
 * Liefert { side, turn, turnKind, night, darkness, clock, weather, battle, result, map, own, enemy, groups, cells, log, ghosts }.
 */
export function viewFor(state, log, side, env = {}) {
  const foe = otherSide(side);
  const map = env.map ?? null;
  const darkness = env.darkness ?? darknessOf(state);
  const ctx = { map, darkness, visible: new Set(visibleEnemies(state, map, side, darkness)) };
  const groups = [
    ...groupsOf(state, side, { includeLost: true }).map((g) => structuredClone(g)),
    ...groupsOf(state, foe).filter((g) => rules.groupVisible(state, side, g, ctx)).map(enemyStub),
  ].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  const cells = {};
  for (const k of cellKeys(state)) {
    const [x, y] = k.split(',').map(Number);
    if (rules.cellVisible(state, side, x, y, ctx)) cells[k] = structuredClone(state.cells[k]);
  }

  // Geister: zuletzt gesehene Feinde mit Alter in Runden (Phase intel)
  const intel = state.sides[side].intel?.lastSeen ?? {};
  const visibleIds = new Set(groups.map((g) => g.id));
  const ghosts = Object.keys(intel).sort()
    .filter((id) => !visibleIds.has(id))
    .map((id) => {
      const e = intel[id];
      const gh = { id, side: foe, type: e.type ?? null, pos: { ...e.pos }, age: Math.max(0, state.turn - e.turn) };
      if (e.from) gh.from = { ...e.from };
      if (e.sector) gh.sector = { ...e.sector };
      if (e.source) gh.source = e.source;
      return gh;
    })
    .filter((g) => g.age <= MAX_GHOST_AGE);

  return {
    side,
    turn: state.turn,
    turnKind: state.turnKind,
    night: state.night,
    darkness,
    clock: { ...state.clock },
    weather: structuredClone(state.weather),
    battle: structuredClone(state.battle),
    result: structuredClone(state.result),
    map: { ...state.map },
    own: structuredClone(state.sides[side]),
    enemy: { faction: state.sides[foe].faction },
    groups,
    cells,
    log: (log ?? []).filter((e) => rules.eventVisible(state, side, e, ctx)).map((e) => structuredClone(e)),
    ghosts,
  };
}
