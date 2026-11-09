// Spielmodi ohne Kampagne (P17, Plan 8 und 9): Gefecht frei, Hotseat, Tageslage.
// Rein: kein DOM, kein Date, kein Math.random. Datum kommt als Zahlen herein (die Szene liest die Uhr).
import { createRng } from '../rng.js';
import { loadMap } from '../map.js';
import { buildMap, generateMap, mirrorCell, mirroredLines } from '../mapgen.js';
import { battleMap } from '../config/battlemaps.js';
import { faction as factionOf } from '../config/factions.js';
import { unitType } from '../config/units.js';
import { DOCTRINES, DIFFICULTIES } from '../config/doctrines.js';
import { scoreMatch, groundHeld } from '../ai/match.js';

export const FACTION_IDS = ['kaldern', 'morrow'];
export const DIFFICULTY_IDS = ['rekrut', 'veteran', 'lask'];
export const otherFaction = (f) => (f === 'morrow' ? 'kaldern' : 'morrow');

/** Tageslage (Plan 8): eine Woche = 14 Stellungsrunden plus die Angriffe, die sich daraus ergeben (Plan 8.3) */
export const TAGESLAGE = { rounds: 14, difficulty: 'veteran' };

// Aufstellung beider Seiten, als Anteil der Kartenhoehe: wo die Gruppe in ihrer Linie steht
const LINEUP = [
  { type: 'rifles', line: 'front', at: 0.25 },
  { type: 'mg', line: 'front', at: 0.5 },
  { type: 'rifles', line: 'front', at: 0.75 },
  { type: 'observers', line: 'high', at: 0.45 },
  { type: 'runners', line: 'support', at: 0.38 },
  { type: 'pioneers', line: 'support', at: 0.62 },
];

/**
 * Karten-JSON fuer eine Wahl aus dem Menue.
 * choice: { map: 'zufall' | Karten-ID, mapSeed, faction }. Die Namenssprache folgt der Fraktion:
 * Seite a (West) spricht die Sprache der Spielerfraktion. Asse-Nord ist eine Datei (null: Aufrufer laedt sie).
 */
export function mapJsonFor(choice) {
  const langs = { a: choice.faction ?? 'kaldern', b: otherFaction(choice.faction ?? 'kaldern') };
  if (choice.map === 'zufall') return generateMap(choice.mapSeed >>> 0, { langs });
  const bm = battleMap(choice.map);
  if (!bm) throw new Error('Unbekannte Karte: ' + choice.map);
  if (bm.kind !== 'spec') return null;
  return buildMap({ ...bm.spec, langs });
}

/** Feuergraben-Felder einer Seite je Reihe: vorderste und hinterste Linie */
function linesOf(map, mapSide) {
  const front = new Map(), support = new Map();
  for (const c of map.cells) {
    if (!c.trench || c.trench.side !== mapSide || c.trench.kind !== 'fire') continue;
    const fwd = mapSide === 'own' ? c.x : -c.x;
    if (!front.has(c.y) || fwd > front.get(c.y).fwd) front.set(c.y, { x: c.x, y: c.y, fwd });
    if (!support.has(c.y) || fwd < support.get(c.y).fwd) support.set(c.y, { x: c.x, y: c.y, fwd });
  }
  return { front, support };
}

/** Naechstes freies Feld einer Linie zu einer Zielreihe (feste Suchreihenfolge: erst naeher, dann noerdlich) */
function nearestRow(list, y, used) {
  for (let d = 0; d < 40; d++) {
    for (const yy of [y - d, y + d]) {
      const c = list.get(yy);
      if (c && !used.has(c.x + ',' + c.y)) return c;
    }
  }
  return null;
}

/** Aufstellung von Seite a auf einer Spiegelkarte: Gruppen in der eigenen Linie */
export function lineupFor(map, factionId) {
  const { front, support } = linesOf(map, 'own');
  const used = new Set();
  const f = factionOf(factionId);
  const out = [];
  for (const u of LINEUP) {
    const y = Math.floor(map.height * u.at);
    let c = null;
    if (u.line === 'high') {
      // Beobachter: hoechstes eigenes Grabenfeld nahe der Front, bei Gleichstand naeher an der Zielreihe
      let best = null;
      for (const cell of map.cells) {
        if (!cell.trench || cell.trench.side !== 'own') continue;
        const fr = front.get(cell.y);
        if (!fr || fr.x - cell.x > 3 || used.has(cell.x + ',' + cell.y)) continue;
        const score = cell.height * 100 - Math.abs(cell.y - y);
        if (!best || score > best.score) best = { x: cell.x, y: cell.y, score };
      }
      c = best;
    } else c = nearestRow(u.line === 'front' ? front : support, y, used);
    if (!c) throw new Error('Kein Platz für ' + u.type);
    used.add(c.x + ',' + c.y);
    const [lo, hi] = unitType(u.type).size;
    out.push({ type: u.type, pos: { x: c.x, y: c.y }, strength: Math.max(1, Math.floor(((lo + hi) / 2) * f.replacements.groupSize + 0.5)), morale: 70, experience: 1 });
  }
  return out;
}

const pickFrom = (rng, list) => list[Math.floor(rng() * list.length) % list.length];

/**
 * Szenario fuer eine Spiegelkarte (Zufallskarte und handgebaute Karten ausser Asse-Nord).
 * opts: { faction, difficulty, seed, hotseat, doctrine? }
 * Beide Seiten stehen gleich (gespiegelt); die Fraktionen unterscheiden sich wie im Plan 2.2.
 */
export function skirmishScenario(mapJson, { faction = 'kaldern', difficulty = 'veteran', seed = 1, hotseat = false, doctrine = null } = {}) {
  const map = loadMap(mapJson);
  const meta = { width: map.width, height: map.height, symmetry: mapJson.symmetry ?? 'spiegel' };
  const rng = createRng(Math.imul((seed >>> 0) ^ 0x51a7, 0x85ebca6b) >>> 0);
  const fb = otherFaction(faction);
  const groupsA = lineupFor(map, faction);
  const groupsB = lineupFor(map, fb).map((g) => ({ ...g, pos: mirrorCell(meta, g.pos.x, g.pos.y) }));
  const doc = doctrine && DOCTRINES[doctrine] ? doctrine : pickFrom(rng, Object.keys(DOCTRINES).sort());
  const diff = DIFFICULTIES[difficulty] ? difficulty : 'veteran';
  const weather = pickFrom(rng, ['clear', 'clear', 'overcast', 'overcast', 'rain', 'fog']);
  return {
    id: 'frei-' + mapJson.id,
    name: 'Gefecht frei: ' + mapJson.name,
    map: mapJson.id,
    startHour: 6,
    turnKind: 'position',
    weather: { kind: weather },
    sides: {
      a: { faction, groups: groupsA },
      b: {
        faction: fb,
        control: hotseat ? 'human' : 'ai',
        ...(hotseat ? {} : { ai: { doctrine: doc, difficulty: diff } }),
        groups: groupsB,
        artillery: { lines: mirroredLines(mapJson) },
      },
    },
  };
}

/** Asse-Nord: festes Szenario, nur Fraktionen tauschen (die Spielerfraktion steht immer im Westen) und KI einstellen */
export function adaptFixedScenario(scenario, { faction = 'kaldern', difficulty = null, hotseat = false } = {}) {
  const s = structuredClone(scenario);
  if (faction !== s.sides.a.faction) {
    s.sides.a.faction = faction;
    s.sides.b.faction = otherFaction(faction);
  }
  if (hotseat) { s.sides.b.control = 'human'; delete s.sides.b.ai; }
  else if (difficulty && DIFFICULTIES[difficulty]) s.sides.b.ai = { ...(s.sides.b.ai ?? {}), difficulty };
  return s;
}

// ---------- Tageslage ----------

/** Schluessel eines Tages: 20261109 */
export function dayKey(y, m, d) {
  return y * 10000 + m * 100 + d;
}

/** Seed eines Tages: fuer alle gleich, aus dem Datum gemischt */
export function dailySeed(key) {
  let h = Math.imul((key >>> 0) ^ 0x2a5b1c3d, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return (h ^ (h >>> 13)) >>> 0 || 1;
}

const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
/** 20261109 -> "9. November" (ohne Jahr: die Welt hat keine reale Zeitrechnung) */
export function dayLabel(key) {
  const d = key % 100, m = Math.floor(key / 100) % 100;
  return `${d}. ${MONTHS[m - 1] ?? ''}`.trim();
}

/** Karte der Tageslage: Zufallskarte aus dem Tages-Seed, Blatt mit dem Datum beschriftet */
export function dailyMap(brief) {
  const json = mapJsonFor({ map: 'zufall', mapSeed: brief.mapSeed, faction: brief.faction });
  json.sheet = { ...json.sheet, blatt: 'Tageslage ' + dayLabel(brief.key) };
  return json;
}

/** Die Lage eines Tages: Karte, Fraktion, Gegner, alles aus dem Seed */
export function dailyBrief(key) {
  const seed = dailySeed(key);
  const rng = createRng(seed);
  const faction = rng() < 0.5 ? 'kaldern' : 'morrow';
  return { key, seed, mapSeed: seed, faction, difficulty: TAGESLAGE.difficulty, rounds: TAGESLAGE.rounds };
}

// ---------- Wertung ----------

export function emptyTally() {
  return { losses: { a: 0, b: 0 }, wounded: { a: 0, b: 0 }, returned: { a: 0, b: 0 }, positionRounds: 0, battles: 0 };
}

/** Protokoll einer Runde einrechnen (vollstaendiges Protokoll, nicht die Sicht einer Seite) */
export function tallyLog(tally, log, { before, after } = {}) {
  const t = structuredClone(tally);
  for (const e of log) {
    if (!e.side || (e.side !== 'a' && e.side !== 'b')) continue;
    if (e.type === 'losses' && e.amount > 0) t.losses[e.side] += e.amount;
    else if (e.type === 'wounded' && e.count > 0) t.wounded[e.side] += e.count;
    else if (e.type === 'wounded_returned' && e.count > 0) t.returned[e.side] += e.count;
  }
  if (before === 'position') t.positionRounds++;
  if (before === 'position' && after === 'battle') t.battles++;
  return t;
}

/** An Wunden Gestorbene einer Seite (Sanitaetskette, state.fallen) */
function diedOfWounds(state, side) {
  return (state.fallen ?? []).filter((f) => f.side === side && f.cause === 'wounds').reduce((s, f) => s + (f.count ?? 1), 0);
}

/**
 * Abschlussmeldung. Gefecht frei und Hotseat: Wertung wie im Simulator (feindliche Verluste plus 3 je gehaltenem
 * feindlichem Grabenfeld). Tageslage: Punkte nach Plan 8.3 (gehaltene Woche x 100, gewonnene Felder x 5,
 * geborgene Verwundete x 2, minus Gefallene x 3).
 */
export function finalReport({ start, end, map, tally, side = 'a' }) {
  const m = scoreMatch(start, end, map);
  const foe = side === 'a' ? 'b' : 'a';
  const fallen = Math.max(0, tally.losses[side] - tally.wounded[side]) + diedOfWounds(end, side);
  const fallenFoe = Math.max(0, tally.losses[foe] - tally.wounded[foe]) + diedOfWounds(end, foe);
  const alive = end.groups.some((g) => g.side === side && g.status !== 'lost');
  const lost = groundHeld(end, map, foe);
  const held = alive && lost < 3;
  const gained = groundHeld(end, map, side);
  const rescued = tally.returned[side];
  const parts = [
    { id: 'held', label: 'Woche gehalten', count: held ? 1 : 0, per: 100 },
    { id: 'gained', label: 'Grabenfelder gewonnen', count: gained, per: 5 },
    { id: 'rescued', label: 'Verwundete geborgen', count: rescued, per: 2 },
    { id: 'fallen', label: 'Gefallene', count: fallen, per: -3 },
  ];
  const points = parts.reduce((s, p) => s + p.count * p.per, 0);
  let verdict;
  if (m.winner === side) verdict = 'won';
  else if (m.winner === foe) verdict = 'lost';
  else verdict = 'draw';
  return {
    winner: m.winner, verdict, why: m.why, score: m.score, losses: m.losses, ground: m.ground,
    held, lostGround: lost, gained, rescued, fallen, fallenFoe, parts, points,
    rounds: tally.positionRounds, battles: tally.battles,
  };
}

/** Ist die Partie nach der Rundengrenze vorbei? Ein laufendes Gefecht wird noch zu Ende gefuehrt. */
export function limitReached(state, tally, limit) {
  if (!limit) return false;
  return tally.positionRounds >= limit && state.turnKind === 'position';
}
