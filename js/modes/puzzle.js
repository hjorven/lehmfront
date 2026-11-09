// Puzzle-Lagen (P25, Plan 8: 12 kleine Karten mit voller Information und einer Loesung).
// Rein: kein DOM, kein Date, kein Math.random. Eine Lage ist eine JSON-Datei unter data/puzzles/ (Format: README dort).
//
// - puzzleMapJson(p): Kartenblatt aus den ASCII-Ebenen der Lage (Boden, Hoehe, Plan mit Graeben, Draht, Trichtern)
// - puzzleScenario(p): Szenario fuer createInitialState (Seite b ohne KI, volle Information)
// - scriptedOrders(p, state): Befehle der Gegenseite fuer diese Runde (das Drehbuch ist bekannt: volle Information)
// - carryOrders(state, log): Restbefehle wie in der Szene gefecht (Sturm und Wege laufen weiter)
// - Ziele und Wertung stehen in js/modes/goals.js.
import { ORDER_TYPES } from '../config/orders.js';
import { getGroup } from '../state.js';

/** Zeichen der Plan-Ebene. Graeben zeigen ohne Angabe zum Gegner (eigene nach Osten, feindliche nach Westen). */
export const PLAN_CODES = {
  '=': { trench: { side: 'own', kind: 'fire' } },
  ':': { trench: { side: 'own', kind: 'comm' } },
  '#': { trench: { side: 'enemy', kind: 'fire' } },
  ';': { trench: { side: 'enemy', kind: 'comm' } },
  x: { wire: 'own' },
  X: { wire: 'enemy' },
  o: { crater: 1 },
  O: { crater: 2 },
};

const toXY = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });

/** Zonen: Spalten links von own sind eigene Stellung, ab enemy feindliche, dazwischen Niemandsland */
function zoneRows(p) {
  if (Array.isArray(p.zones)) return p.zones.slice();
  const own = p.zoneCols?.[0] ?? Math.floor(p.width / 3);
  const foe = p.zoneCols?.[1] ?? p.width - Math.floor(p.width / 3);
  const row = Array.from({ length: p.width }, (_, x) => (x < own ? 'S' : x >= foe ? 's' : 'N')).join('');
  return Array.from({ length: p.height }, () => row);
}

/** Kartenblatt (Format data/maps/README.md) aus einer Puzzle-Lage */
export function puzzleMapJson(p) {
  const w = p.width, h = p.height;
  const terrain = p.terrain ?? Array.from({ length: h }, () => '.'.repeat(w));
  const heights = p.heights ?? Array.from({ length: h }, () => '0'.repeat(w));
  const plan = p.plan ?? [];
  const facing = new Map((p.facings ?? []).map((f) => [f.x + ',' + f.y, f.facing]));
  const levels = new Map((p.levels ?? []).map((f) => [f.x + ',' + f.y, f.level]));
  const trenches = [], wire = [], craters = [];
  for (let y = 0; y < plan.length; y++) {
    for (let x = 0; x < (plan[y] ?? '').length; x++) {
      const code = PLAN_CODES[plan[y][x]];
      if (!code) continue;
      const k = x + ',' + y;
      if (code.trench) {
        trenches.push({
          x, y, side: code.trench.side, kind: code.trench.kind,
          level: levels.get(k) ?? p.trenchLevel ?? 2,
          facing: facing.get(k) ?? (code.trench.side === 'own' ? 'E' : 'W'),
        });
      }
      if (code.wire) wire.push({ x, y, side: code.wire });
      if (code.crater) craters.push({ x, y, size: code.crater });
    }
  }
  return {
    id: 'lage-' + p.id,
    name: p.title,
    sheet: { title: 'Lage ' + (p.num ?? '') + ': ' + p.title, blatt: 'Übungsblatt ' + (p.num ?? ''), scale: '1:2500', seed: p.sheetSeed ?? 100 + (p.num ?? 0) },
    width: w,
    height: h,
    terrain,
    heights,
    zones: zoneRows(p),
    trenches,
    wire,
    craters,
    rails: (p.rails ?? []).map((r) => [r[0], r[1]]),
    buildings: (p.buildings ?? []).map((b) => ({ ...b })),
    labels: (p.labels ?? []).map((l) => ({ ...l })),
    notes: (p.notes ?? []).map((n) => ({ ...n })),
  };
}

function groupSpec(g) {
  const out = { type: g.type, pos: toXY(g.at) };
  for (const k of ['strength', 'morale', 'experience', 'fatigue', 'id', 'status']) if (g[k] !== undefined) out[k] = g[k];
  if (g.leader) out.leader = { name: g.leader[0], home: g.leader[1] };
  return out;
}

/** Szenario fuer createInitialState: Seite b haelt nach Drehbuch, volle Information fuer Seite a */
export function puzzleScenario(p) {
  return {
    id: 'lage-' + p.id,
    name: 'Puzzle-Lage: ' + p.title,
    map: 'lage-' + p.id,
    startHour: p.startHour ?? 10,
    turnKind: p.kind === 'battle' ? 'battle' : 'position',
    weather: { kind: p.weather ?? 'clear' },
    reveal: true,
    steady: p.steady !== false,
    sides: {
      a: { faction: p.factions?.a ?? 'kaldern', supplies: p.supplies?.a, groups: (p.groups?.a ?? []).map(groupSpec) },
      b: { faction: p.factions?.b ?? 'morrow', control: 'script', supplies: p.supplies?.b, groups: (p.groups?.b ?? []).map(groupSpec) },
    },
  };
}

/**
 * Lage auf den Startzustand legen (nach createInitialState): Gefechtslagen beginnen in Gefechtsrunde 1,
 * cells setzt Feldzustaende (z. B. ein eroberter Graben: { at: [x,y], trench: { side, kind, level, facing, captured } }).
 */
export function preparePuzzleState(p, state) {
  const s = structuredClone(state);
  if (p.kind === 'battle' && !s.battle) s.battle = { round: 1 };
  for (const c of p.cells ?? []) {
    const { x, y } = toXY(c.at);
    const { at, ...rest } = c;
    s.cells[x + ',' + y] = { ...(s.cells[x + ',' + y] ?? {}), ...structuredClone(rest) };
  }
  return s;
}

/** Befehl aus der kompakten Schreibweise der Lage: { group, type, path: [[x,y],...] | target: [x,y] } */
export function normOrder(o) {
  const out = { group: o.group, type: o.type };
  if (o.path) out.path = o.path.map(toXY);
  if (o.target) out.target = toXY(o.target);
  return out;
}

/** Drehbuch der Gegenseite fuer die laufende Runde (Schluessel = Rundennummer state.turn) */
export function scriptedOrders(p, state) {
  const list = p.script?.[String(state.turn)] ?? [];
  return list.map(normOrder).filter((o) => { const g = getGroup(state, o.group); return g && g.status !== 'lost'; });
}

/** Loesung der Lage fuer eine Runde (Schluessel = Rundennummer) */
export function solutionOrders(p, turn) {
  return (p.solution?.[String(turn)] ?? []).map(normOrder);
}

/**
 * Restbefehle nach einer Runde, wie die Szene gefecht sie weitertraegt: Mechaniken mit carry (Sturm, Graben),
 * unvollendete Wege der passenden Rundenart. Liefert { a: [...], b: [...] }.
 */
export function carryOrders(state, log) {
  const carry = { a: [], b: [] };
  for (const e of log) {
    if (e.carry && e.carry.group === e.group) {
      const g = getGroup(state, e.group);
      const kind = ORDER_TYPES[e.carry.type]?.kind;
      if (g && g.status !== 'lost' && (kind === 'both' || kind === state.turnKind)) carry[g.side].push({ ...e.carry, carried: true });
      continue;
    }
    if ((e.type === 'move' || e.type === 'redeploy') && e.rest?.length && !e.blocked) {
      const g = getGroup(state, e.group);
      const type = state.turnKind === 'battle' ? 'move' : 'redeploy';
      if (g && g.status !== 'lost' && e.type === type) carry[g.side].push({ group: g.id, type, path: e.rest, carried: true });
    }
  }
  return carry;
}

/** Neue Befehle ersetzen Restbefehle derselben Gruppe */
export function mergeCarry(fresh, carried) {
  const have = new Set(fresh.map((o) => o.group).filter(Boolean));
  return [...fresh, ...carried.filter((o) => !have.has(o.group))];
}
