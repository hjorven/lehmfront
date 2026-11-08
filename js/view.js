// Gefilterte Sicht pro Seite (Plan 10.6, Nebel des Krieges). Erste Fassung:
// eigene Einheiten vollstaendig, fremde nur, wenn sichtbar. Die Sichtregel ist ein austauschbarer Haken,
// P05 ersetzt sie mit setVisibilityRules({ groupVisible, cellVisible, eventVisible }) durch Sichtlinien mit Hoehe.
// Rein: kein DOM, kein Date, kein Math.random.
import { unitType } from './config/units.js';
import { groupsOf, cellKeys, otherSide } from './state.js';

export const DAY_SIGHT = 6;
export const NIGHT_SIGHT = 3;

function chebyshev(p, q) {
  return Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
}

/** Sichtweite einer Gruppe in Feldern (vorlaeufig: Einheitentyp, nachts kuerzer) */
export function sightOf(state, group) {
  const t = unitType(group.type);
  const day = t.sight ?? DAY_SIGHT;
  return state.night ? Math.max(1, Math.min(NIGHT_SIGHT, day)) : day;
}

/** Sieht irgendeine eigene Gruppe den Ort p? */
export function seesPoint(state, side, p) {
  return groupsOf(state, side).some((g) => chebyshev(g.pos, p) <= sightOf(state, g));
}

const DEFAULT_RULES = {
  groupVisible: (state, side, group) => seesPoint(state, side, group.pos),
  cellVisible: () => true,
  // Ereignisse mit side: nur diese Seite, ausser der Ort ist fuer die andere sichtbar und nicht secret.
  // Ereignisse ohne side (Wetter, Uhr): beide Seiten.
  eventVisible: (state, side, e) => {
    if (e.side === undefined || e.side === null) return true;
    if (e.side === side) return true;
    return !e.secret && seesPoint(state, side, e.at);
  },
};

let rules = { ...DEFAULT_RULES };

/** Sichtregeln tauschen (teilweise). Ohne Argument: zurueck auf die erste Fassung. */
export function setVisibilityRules(partial) {
  rules = partial ? { ...rules, ...partial } : { ...DEFAULT_RULES };
}

function enemyStub(g) {
  return { id: g.id, side: g.side, type: g.type, pos: { ...g.pos }, status: g.status, inDugout: g.inDugout, seen: true };
}

/**
 * Sicht einer Seite auf Zustand und Protokoll.
 * Liefert { side, turn, turnKind, night, clock, weather, battle, result, map, own, enemy, groups, cells, log, ghosts }.
 */
export function viewFor(state, log, side) {
  const foe = otherSide(side);
  const groups = [
    ...groupsOf(state, side, { includeLost: true }).map((g) => structuredClone(g)),
    ...groupsOf(state, foe).filter((g) => rules.groupVisible(state, side, g)).map(enemyStub),
  ].sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));

  const cells = {};
  for (const k of cellKeys(state)) {
    const [x, y] = k.split(',').map(Number);
    if (rules.cellVisible(state, side, x, y)) cells[k] = structuredClone(state.cells[k]);
  }

  // Geister (zuletzt gesehene Feinde mit Alter) fuehrt P05 in state.sides[side].intel; hier nur durchreichen.
  const intel = state.sides[side].intel?.lastSeen ?? {};
  const visibleIds = new Set(groups.map((g) => g.id));
  const ghosts = Object.keys(intel).sort()
    .filter((id) => !visibleIds.has(id))
    .map((id) => ({ id, pos: { ...intel[id].pos }, age: state.turn - intel[id].turn }));

  return {
    side,
    turn: state.turn,
    turnKind: state.turnKind,
    night: state.night,
    clock: { ...state.clock },
    weather: structuredClone(state.weather),
    battle: structuredClone(state.battle),
    result: structuredClone(state.result),
    map: { ...state.map },
    own: structuredClone(state.sides[side]),
    enemy: { faction: state.sides[foe].faction },
    groups,
    cells,
    log: (log ?? []).filter((e) => rules.eventVisible(state, side, e)).map((e) => structuredClone(e)),
    ghosts,
  };
}
