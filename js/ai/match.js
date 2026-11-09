// KI gegen KI ohne Browser (Plan 10.9, Paket P13). Grundlage fuer tools/sim.js und die Symmetrie-Tests.
// Rein: kein DOM, kein Date, kein Math.random, keine Dateien. Karten und Szenarien kommen als JSON herein.
//
// runMatch: eine Partie mit zwei KI-Kommandanten bis zur Rundengrenze oder bis eine Seite keine Gruppe mehr hat.
// Wertung (scoreMatch): feindliche Verluste (Mann) plus 3 Punkte je gehaltenes feindliches Grabenfeld,
//   minus 3 je verlorenes eigenes. Wer keine Gruppe mehr hat, verliert. Unterschied unter DRAW_MARGIN: Remis.
// mirrorMap / mirrorScenario: Spiegelkarte aus der eigenen Kartenhaelfte, damit beide Seiten dasselbe Gelaende haben.
import { loadMap } from '../map.js';
import { createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { decide } from '../ai.js';

export const DEFAULT_TURNS = 36;
export const DRAW_MARGIN = 3;
export const GROUND_POINTS = 3;

const SIDES = ['a', 'b'];
const mapSideOf = (s) => (s === 'a' ? 'own' : 'enemy');
const ZONE_MIRROR = { E: 'e', S: 's', N: 'N', s: 'S', e: 'E' };
const FACING_MIRROR = { N: 'N', NE: 'NW', E: 'W', SE: 'SW', S: 'S', SW: 'SE', W: 'E', NW: 'NE' };
const SIDE_MIRROR = { own: 'enemy', enemy: 'own' };

/**
 * Breite der Spiegelkarte: gespiegelt wird um die Mitte des Niemandslands, damit es auf beiden Seiten gleich breit
 * bleibt. Behalten wird alles westlich davon (eigene Etappe, eigene Stellung, halbes Niemandsland).
 */
export function mirrorHalf(json) {
  let sum = 0, n = 0;
  for (const row of json.zones) {
    const xs = [];
    for (let x = 0; x < row.length; x++) if (row[x] === 'N') xs.push(x);
    if (xs.length) { sum += xs[0] + xs[xs.length - 1]; n += 2; }
  }
  return n ? Math.floor(sum / n) + 1 : Math.floor(json.width / 2);
}

/**
 * Spiegelkarte: die westliche (eigene) Seite bis zur Mitte des Niemandslands bleibt, die oestliche wird ihr
 * Spiegelbild mit getauschten Seiten. Beschriftungen und Notizen fallen weg; Leitungen wandern ins Szenario
 * (mirrorScenario), damit beide Seiten gleich verkabelt sind.
 */
export function mirrorMap(json) {
  const half = mirrorHalf(json);
  const w = 2 * half;
  const mx = (x) => w - 1 - x;
  const left = (x) => x < half;
  const rows = (list, swap) => list.map((row) => {
    const out = [];
    for (let x = 0; x < w; x++) {
      if (x < half) out.push(row[x]);
      else { const c = row[mx(x)]; out.push(swap ? (swap[c] ?? c) : c); }
    }
    return out.join('');
  });
  const cells = (list, f) => [...list.filter((c) => left(c.x)), ...list.filter((c) => left(c.x)).map(f)];
  const inside = (b) => b.x + (b.w ?? 1) <= half;
  return {
    ...json,
    id: json.id + '-spiegel',
    name: json.name + ' (gespiegelt)',
    width: w,
    terrain: rows(json.terrain),
    heights: rows(json.heights),
    zones: rows(json.zones, ZONE_MIRROR),
    trenches: cells(json.trenches ?? [], (t) => ({ ...t, x: mx(t.x), side: SIDE_MIRROR[t.side], facing: FACING_MIRROR[t.facing] ?? t.facing })),
    wire: cells(json.wire ?? [], (d) => ({ ...d, x: mx(d.x), side: SIDE_MIRROR[d.side] })),
    craters: cells(json.craters ?? [], (c) => ({ ...c, x: mx(c.x) })),
    rails: [...(json.rails ?? []).filter(([x]) => left(x)), ...(json.rails ?? []).filter(([x]) => left(x)).map(([x, y]) => [mx(x), y])],
    buildings: [
      ...(json.buildings ?? []).filter(inside),
      ...(json.buildings ?? []).filter(inside).map((b) => ({ ...b, id: 'm-' + b.id, x: w - b.x - (b.w ?? 1), side: 'enemy' })),
    ],
    cables: [],
    labels: [],
    notes: [],
  };
}

function mirrorPoint(w, p) {
  const fx = Math.floor(p[0]);
  return [w - 1 - fx + (p[0] - fx), p[1]];
}

/**
 * Szenario mit identischen Armeen fuer die Spiegelkarte (json = die Originalkarte). Seite b bekommt die Gruppen von Seite a gespiegelt,
 * mit fester Staerke (sonst wuerfelt createInitialState die Mannstaerke) und derselben Fraktion.
 * groups: [{ type, pos, strength?, morale? }] fuer Seite a.
 */
export function mirrorScenario(json, groups, { faction = 'kaldern', supplies = null } = {}) {
  const w = 2 * mirrorHalf(json);
  const fixed = groups.map((g) => ({ type: g.type, pos: { ...g.pos }, strength: g.strength ?? 9, morale: g.morale ?? 70, experience: g.experience ?? 1 }));
  const lines = (json.cables ?? []).map((c, i) => ({ id: 'k' + (i + 1), to: c.to, points: c.points.map((p) => [p[0], p[1]]) }));
  return {
    id: 'spiegel',
    name: 'Spiegelgefecht',
    map: json.id + '-spiegel',
    startHour: 6,
    turnKind: 'position',
    weather: { kind: 'clear', fixed: true },
    sides: {
      a: { faction, supplies: supplies ?? undefined, groups: fixed, artillery: { lines } },
      b: {
        faction,
        supplies: supplies ?? undefined,
        groups: fixed.map((g) => ({ ...g, pos: { x: w - 1 - g.pos.x, y: g.pos.y } })),
        artillery: { lines: lines.map((l) => ({ ...l, id: 'm' + l.id, to: l.to.startsWith('batterie') ? 'm-' + l.to : l.to, points: l.points.map((p) => mirrorPoint(w, p)) })) },
      },
    },
  };
}

/** Mannstaerke einer Seite (aufgeriebene Gruppen zaehlen 0) */
function menOf(state, side) {
  return state.groups.filter((g) => g.side === side && g.status !== 'lost').reduce((s, g) => s + g.strength, 0);
}

/** Grabenfelder auf der Kartenhaelfte der Gegenseite, die jetzt der Seite gehoeren */
export function groundHeld(state, map, side) {
  const ms = mapSideOf(side);
  let n = 0;
  for (const k of Object.keys(state.cells)) {
    const t = state.cells[k].trench;
    if (!t || t.side !== ms) continue;
    const [x, y] = k.split(',').map(Number);
    const c = map.cells[y * map.width + x];
    if (c && c.side && c.side !== ms) n++;
  }
  return n;
}

/** Wertung einer Partie */
export function scoreMatch(start, end, map) {
  const men = { a: menOf(end, 'a'), b: menOf(end, 'b') };
  const losses = { a: menOf(start, 'a') - men.a, b: menOf(start, 'b') - men.b };
  const ground = { a: groundHeld(end, map, 'a'), b: groundHeld(end, map, 'b') };
  const alive = { a: end.groups.some((g) => g.side === 'a' && g.status !== 'lost'), b: end.groups.some((g) => g.side === 'b' && g.status !== 'lost') };
  const score = {
    a: losses.b + GROUND_POINTS * ground.a - GROUND_POINTS * ground.b,
    b: losses.a + GROUND_POINTS * ground.b - GROUND_POINTS * ground.a,
  };
  let winner = null, why;
  if (!alive.a && alive.b) { winner = 'b'; why = 'Seite a hat keine Gruppe mehr'; }
  else if (!alive.b && alive.a) { winner = 'a'; why = 'Seite b hat keine Gruppe mehr'; }
  else if (score.a - score.b >= DRAW_MARGIN) { winner = 'a'; why = 'Wertung'; }
  else if (score.b - score.a >= DRAW_MARGIN) { winner = 'b'; why = 'Wertung'; }
  else why = 'Remis';
  return { winner, why, losses, ground, score };
}

/** Begruendung ohne Namen und Zahlen, damit gleiche Lagen zusammengezaehlt werden */
export function reasonKey(text) {
  return String(text)
    .replace(/Gruppe [A-ZÄÖÜ][\wäöüß-]*/g, 'Gruppe X')
    .replace(/\d+\/\d+/g, 'F')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Eine Partie KI gegen KI.
 * opts: { mapJson | map, scenario, seed, ai: { a: { posture, doctrine, difficulty }, b: {...} }, turns }
 * Liefert { winner, why, turns, losses, ground, score, decisions: { a: {tag: n}, b }, events: {key: n}, postures, battles }.
 */
export function runMatch(opts) {
  const map = opts.map ?? loadMap(opts.mapJson);
  const seed = (opts.seed ?? 1) >>> 0;
  const turns = opts.turns ?? DEFAULT_TURNS;
  let state = initEtappen(createInitialState(map, opts.scenario, seed), map, opts.scenario);
  const start = state;
  const env = { map };
  const memory = { a: undefined, b: undefined };
  const decisions = { a: {}, b: {} };
  const postures = { a: {}, b: {} };
  const events = {};
  let log = [];
  let battles = 0;
  const count = (obj, k) => { obj[k] = (obj[k] ?? 0) + 1; };
  for (let i = 0; i < turns && !state.result; i++) {
    const orders = {};
    for (const side of SIDES) {
      const cfg = opts.ai?.[side] ?? {};
      const d = decide(viewFor(state, log, side, env), { map, seed, side, posture: cfg.posture, doctrine: cfg.doctrine, difficulty: cfg.difficulty, memory: memory[side] });
      memory[side] = d.memory;
      orders[side] = d.orders;
      count(postures[side], d.posture);
      for (const a of d.advice) count(decisions[side], a.tag);
    }
    const before = state.turnKind;
    const r = resolveTurn(state, orders.a, orders.b, seed, state.turn, env);
    state = r.state;
    log = r.log;
    if (before === 'position' && state.turnKind === 'battle') battles++;
    for (const e of r.log) if (!e.minor) count(events, e.type + ': ' + reasonKey(e.reason));
    if (!state.groups.some((g) => g.side === 'a' && g.status !== 'lost') || !state.groups.some((g) => g.side === 'b' && g.status !== 'lost')) break;
  }
  const score = scoreMatch(start, state, map);
  return { ...score, turns: state.turn - 1, decisions, events, postures, battles, state };
}

/** Mehrere Partien mit aufeinanderfolgenden Seeds und Zusammenfassung */
export function runSeries(opts, runs, onEach = null) {
  const map = opts.map ?? loadMap(opts.mapJson);
  const sum = {
    runs, wins: { a: 0, b: 0, draw: 0 }, losses: { a: 0, b: 0 }, turns: 0, battles: 0, ground: { a: 0, b: 0 },
    decisions: { a: {}, b: {} }, events: {},
  };
  const add = (into, from) => { for (const k of Object.keys(from)) into[k] = (into[k] ?? 0) + from[k]; };
  for (let i = 0; i < runs; i++) {
    const r = runMatch({ ...opts, map, seed: ((opts.seed ?? 1) + i) >>> 0 });
    sum.wins[r.winner ?? 'draw']++;
    sum.losses.a += r.losses.a;
    sum.losses.b += r.losses.b;
    sum.ground.a += r.ground.a;
    sum.ground.b += r.ground.b;
    sum.turns += r.turns;
    sum.battles += r.battles;
    add(sum.decisions.a, r.decisions.a);
    add(sum.decisions.b, r.decisions.b);
    add(sum.events, r.events);
    if (onEach) onEach(r, i);
  }
  return sum;
}

/** Die haeufigsten Eintraege einer Zaehlung: [[text, n], ...], bei Gleichstand alphabetisch */
export function topEntries(counts, n = 10) {
  return Object.entries(counts).sort((p, q) => q[1] - p[1] || (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)).slice(0, n);
}
