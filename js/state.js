// Spielzustand als reines JSON (Plan 3.3, 5, 10.6). Keine Klassen, keine Funktionen im Zustand,
// damit structuredClone, JSON-Export und die Edge Function denselben Zustand teilen.
// Rein: kein DOM, kein Date, kein Math.random. Zufall nur ueber js/rng.js.
import { createRng } from './rng.js';
import { unitType } from './config/units.js';
import { faction } from './config/factions.js';
import { NAMES } from './config/names.js';
import { initArtillery } from './artillery.js';

export const STATE_VERSION = 2;
export const SIDES = ['a', 'b'];

/** Stabiler ID-Vergleich ohne Locale (localeCompare ist geraeteabhaengig) */
export function compareId(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function byId(a, b) {
  return compareId(a.id, b.id);
}

export function otherSide(side) {
  return side === 'a' ? 'b' : 'a';
}

export function cellKey(x, y) {
  return x + ',' + y;
}

/** Feldzustand eines Feldes (Graben, Krater, Draht, Schlamm ...). Fehlt der Eintrag, gilt die Karte. */
export function getCell(state, x, y) {
  return state.cells[cellKey(x, y)] ?? null;
}

/** Feldzustand setzen oder ergaenzen. Nur auf Entwurfszustaenden in Phasen aufrufen. */
export function patchCell(state, x, y, patch) {
  const k = cellKey(x, y);
  state.cells[k] = { ...(state.cells[k] ?? {}), ...patch };
  return state.cells[k];
}

/** Schluessel aller veraenderten Felder, sortiert nach y, dann x */
export function cellKeys(state) {
  return Object.keys(state.cells).sort((p, q) => {
    const [px, py] = p.split(',').map(Number);
    const [qx, qy] = q.split(',').map(Number);
    return py - qy || px - qx;
  });
}

export function getGroup(state, id) {
  return state.groups.find((g) => g.id === id) ?? null;
}

/** Gruppen einer Seite (oder alle), immer nach ID sortiert. Standard: nur einsatzfaehige. */
export function groupsOf(state, side = null, { includeLost = false } = {}) {
  return state.groups
    .filter((g) => (side === null || g.side === side) && (includeLost || g.status !== 'lost'))
    .sort(byId);
}

export function inBounds(map, p) {
  return Number.isInteger(p?.x) && Number.isInteger(p?.y) && p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
}

/** Nacht laut Uhr: 18 bis 6 Uhr */
export function isNightHour(hour) {
  return hour >= 18 || hour < 6;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

/** Gruppenfuehrer erzeugen: Name nie doppelt in einer Seite, Hauptfiguren ausgenommen */
function makeLeader(rng, factionId, used) {
  const pool = NAMES[faction(factionId).names];
  const reserved = new Set(pool.reserved ?? []);
  // Erst eindeutige Nachnamen versuchen (Meldungen nennen "Gruppe <Nachname>"), dann nur eindeutige volle Namen
  // Nachnamen der Hauptfiguren gelten als vergeben, damit "Gruppe Brandt" nicht mit Major Brandt verwechselt wird
  const surnames = new Set([...used, ...reserved].map((n) => n.slice(n.indexOf(' ') + 1)));
  for (let tries = 0; tries < 80; tries++) {
    const last = pick(rng, pool.last);
    const name = pick(rng, pool.first) + ' ' + last;
    if (reserved.has(name) || used.has(name)) continue;
    if (tries < 40 && surnames.has(last)) continue;
    used.add(name);
    return { name, home: pick(rng, pool.homes) };
  }
  // Namensraum erschoepft: Nummer anhaengen statt endlos zu wuerfeln
  const name = pick(rng, pool.first) + ' ' + pick(rng, pool.last) + ' ' + (used.size + 1);
  used.add(name);
  return { name, home: pick(rng, pool.homes) };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Neue Gruppe als JSON. spec: { type, pos:{x,y}, id?, strength?, experience?, fatigue?, morale?, leader?, status? }
 */
export function makeGroup(rng, side, factionId, spec, id, usedNames) {
  const t = unitType(spec.type);
  const f = faction(factionId);
  const [lo, hi] = t.size;
  const rolled = lo + Math.floor(rng() * (hi - lo + 1));
  const size = Math.max(1, Math.floor(rolled * f.replacements.groupSize + 0.5));
  const strength = spec.strength ?? size;
  return {
    id,
    side,
    type: t.id,
    strength,
    size: Math.max(size, strength),
    experience: clamp(spec.experience ?? 1, 0, 4),
    fatigue: clamp(spec.fatigue ?? 0, 0, 100),
    morale: clamp(spec.morale ?? 70, 0, 100),
    suppressed: 0,
    leader: spec.leader ? { name: spec.leader.name, home: spec.leader.home } : makeLeader(rng, factionId, usedNames),
    pos: { x: spec.pos.x, y: spec.pos.y },
    facing: spec.facing ?? (side === 'a' ? 'e' : 'w'),
    status: spec.status ?? 'front',
    inDugout: false,
    holdTurns: 0,
  };
}

/**
 * Anfangszustand einer Partie.
 * map: geladene Karte, mindestens { id, width, height } (Gelaende selbst bleibt in der Karte, Plan 3.2)
 * scenario: { id, name?, turnKind?, startHour?, weather?, sides: { a: { faction, supplies?, groups: [spec] }, b: {...} } }
 * seed: Partie-Seed (ganze Zahl)
 */
export function createInitialState(map, scenario, seed) {
  if (!map || !map.id || !(map.width > 0) || !(map.height > 0)) throw new Error('Karte braucht id, width, height');
  if (!scenario?.sides?.a || !scenario?.sides?.b) throw new Error('Szenario braucht sides.a und sides.b');
  const rng = createRng(seed >>> 0);
  const startHour = scenario.startHour ?? 6;

  const sides = {};
  const groups = [];
  for (const side of SIDES) {
    const s = scenario.sides[side];
    const f = faction(s.faction);
    sides[side] = {
      faction: f.id,
      supplies: { ...f.supplies, ...(s.supplies ?? {}) },
      reputation: s.reputation ?? 50,
      trust: s.trust ?? 50,
      control: s.control ?? 'human',
    };
    if (s.supply) sides[side].supply = structuredClone(s.supply); // Versorgung der Front (js/supply.js)
    const art = initArtillery(map, s.artillery, side, f.id); // Batterien, Leitungen, Feuerplaene (js/artillery.js)
    if (art.batteries.length || art.lines.length) sides[side].artillery = art;
    const used = new Set();
    (s.groups ?? []).forEach((spec, i) => {
      if (!inBounds(map, spec.pos)) throw new Error(`Gruppe ${i} von Seite ${side} steht ausserhalb der Karte`);
      const id = spec.id ?? side + String(i + 1).padStart(2, '0');
      groups.push(makeGroup(rng, side, f.id, spec, id, used));
    });
  }
  groups.sort(byId);
  const ids = new Set(groups.map((g) => g.id));
  if (ids.size !== groups.length) throw new Error('Doppelte Gruppen-ID im Szenario');

  // Anfangswissen ueber den Gegner (P05): sides[x].intel = [{ group, turnsAgo, sector?, source? }] wird zu Geistern
  for (const side of SIDES) {
    const known = scenario.sides[side].intel;
    if (!Array.isArray(known)) continue;
    const lastSeen = {};
    for (const k of [...known].sort((p, q) => compareId(String(p.group), String(q.group)))) {
      const g = groups.find((x) => x.id === k.group && x.side !== side);
      if (!g) throw new Error(`Aufklärung von Seite ${side}: Gruppe ${k.group} gibt es beim Gegner nicht`);
      const e = { pos: { ...g.pos }, turn: 1 - Math.max(0, k.turnsAgo | 0), type: g.type };
      if (k.sector) e.sector = { x: k.sector.x, y: k.sector.y };
      if (k.source) e.source = String(k.source);
      lastSeen[g.id] = e;
    }
    sides[side].intel = { lastSeen };
  }

  return {
    version: STATE_VERSION,
    seed: seed >>> 0,
    map: { id: map.id, width: map.width, height: map.height },
    scenario: { id: scenario.id ?? 'frei', name: scenario.name ?? '' },
    turn: 1,
    turnKind: scenario.turnKind ?? 'position',
    battle: null,
    clock: { day: 1, hour: startHour, minute: 0 },
    night: isNightHour(startHour),
    weather: { kind: 'clear', rain: 0, wind: { dir: 'w', speed: 1 }, ...(scenario.weather ?? {}) },
    sides,
    groups,
    cells: {},
    fallen: [],
    result: null,
  };
}
