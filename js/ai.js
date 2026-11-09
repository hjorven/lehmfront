// KI-Kommandant (Plan 2.4, 7.5, 13; Paket P13). Persoenlichkeit: Hauptmann Teodor Lask.
// Rein und deterministisch: kein DOM, kein Date, kein Math.random. Zufall nur ueber js/rng.js.
//
// Die KI arbeitet ausschliesslich auf der gefilterten Sicht viewFor(state, log, side, env) und der Grundkarte
// (Gelaende kennt jeder). Sie liest nie den vollen Zustand: feindliche Gruppen kennt sie nur, wenn eine eigene
// Gruppe sie sieht oder als Geist aus der Aufklaerung. Aus view.battle nimmt sie nur die eigenen Eintraege.
//
// Lagen (js/config/doctrines.js): halten, vorbereiten, sturm, gegenstoss. Die Lage waehlt die KI selbst aus
// Kraefteverhaeltnis, Doktrin und Vorbereitung, oder sie wird vorgegeben (Simulator: --a halten --b sturm).
// Doktrin und Schwierigkeit sind Parameter.
//
// Schnittstelle:
//   decide(view, { map, seed, side?, posture?, doctrine?, difficulty?, memory?, advisor? })
//     -> { side, posture, postureReason, orders, advice: [{ group, order, reason, tag }], intent, memory, reasons }
//   planOrders(view, opts) -> nur die Befehlsliste (wie vom Spieler)
// advisor: true = Taktik-Lehrling (Plan 7.5). Dieselbe KI, aber ohne verschlafene Befehle; sie plant fuer den Spieler.
import { createRng } from './rng.js';
import { cellAt, cellLabel, distance, enterCost, findPath, lineOfSight } from './map.js';
import { unitType } from './config/units.js';
import { validateOrder } from './orders.js';
import { inCone, PINNED } from './sight.js';
import { normalizePlan, batteryCenter, batteryType } from './artillery.js';
import { flareProblem } from './weather.js';
import { MAX_ASSAULT_CELLS, ASSAULT_TYPES, WIRE_CUTTERS, redeployCellOk } from './phases/move.js';
import { MAX_WIRE_CELLS, WIRE_REACH, WIRE_LAYERS, wireBlocker } from './phases/wire.js';
import { surname } from './phases/hold.js';
import { timeDarkness } from './phases/weather.js';
import { postOf, isTooLong } from './morale.js';
import { POSTURES, DOCTRINES, DIFFICULTIES, DEFAULT_DIFFICULTY, DEFAULT_DOCTRINE } from './config/doctrines.js';
import './phases/index.js';
import { runAiBlocks } from './ai/blocks.js';
import './ai/akt2.js'; // Befehlspruefungen der Mechaniken (die KI prueft ihre Befehle vor der Abgabe)

export { POSTURES, DOCTRINES, DIFFICULTIES };

/** Kampfwert je Einheit (fuer das Kraefteverhaeltnis) */
export const POWER = { rifles: 10, pioneers: 8, mg: 14, mortar: 7, observers: 2, runners: 1, medics: 0, stormtroops: 12, flamethrowers: 6, fieldgun: 9, tank: 16, snipers: 3, listeners: 1, plane: 0 };
/** Sicherheitsabstand der Feuerwalze vor den eigenen Sturmgruppen (Felder) */
export const CREEP_LEAD = 5;
/** So weit (Felder) darf ein Sturmweg hoechstens werden; laengere Wege werden erst vorbereitet */
export const ASSAULT_REACH = 30;

const SIDES = ['a', 'b'];
const foeOf = (s) => (s === 'a' ? 'b' : 'a');
const mapSideOf = (s) => (s === 'a' ? 'own' : 'enemy');
const compare = (p, q) => (p < q ? -1 : p > q ? 1 : 0);
const byId = (p, q) => compare(p.id, q.id);
const key = (p) => p.x + ',' + p.y;
const nameOf = (g) => 'Gruppe ' + surname(g.leader?.name ?? g.id);
const pct = (n) => Math.round(n) + ' %';
/** Runden spiegelgleich um null (Spiegelkarte: Seite b sieht dieselben Abstaende mit umgekehrtem Vorzeichen) */
const roundSym = (v) => (v < 0 ? -Math.round(-v) : Math.round(v));

/** FNV-1a fuer den Zufallsstrom der KI (Seite und Runde mischen) */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** Zufall der KI: aus Partie-Seed, Seite, Runde und Zweck. Andere Zwecke verschieben die Wuerfe nicht. */
export function aiRng(seed, side, turn, purpose = 'plan') {
  return createRng((Math.imul((seed >>> 0) ^ hash(side + ':' + purpose), 0x9e3779b1) ^ Math.imul(turn >>> 0, 0x85ebca6b)) >>> 0);
}

/** Zustand aus der Sicht, nur damit die KI ihre Befehle mit denselben Pruefungen wie der Spieler pruefen kann */
export function viewState(view) {
  const sides = { [view.side]: view.own, [foeOf(view.side)]: { faction: view.enemy?.faction ?? null } };
  return {
    turn: view.turn, turnKind: view.turnKind, night: view.night, clock: view.clock, weather: view.weather,
    battle: view.battle, map: view.map, cells: view.cells, groups: view.groups, sides, result: null,
  };
}

// ---------------------------------------------------------------------------------------------
// Lagebild

function liveCell(map, cells, x, y) {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const s = cells[x + ',' + y];
  return s ? { ...c, ...s } : c;
}

function avgSize(type) {
  const t = unitType(type);
  return (t.size[0] + t.size[1]) / 2;
}

function groupPower(g) {
  const w = POWER[g.type] ?? 5;
  const size = Math.max(1, g.size ?? g.strength ?? 1);
  const str = g.strength ?? size;
  const morale = g.morale ?? 70;
  return (w * str * (40 + morale)) / (size * 110);
}

/**
 * Lagebild einer Seite aus Sicht und Karte. Feinde: gesehene Gruppen (Vertrauen 100), Geister (sinkt mit dem Alter),
 * und Gruppen, die man frueher einmal gesehen hat (Gedaechtnis), ohne Ort.
 */
export function assess(view, map, memory, diff) {
  const side = view.side;
  const ms = mapSideOf(side);
  const ex = side === 'a' ? 1 : -1;
  const own = view.groups.filter((g) => g.side === side && g.status !== 'lost').sort(byId);
  const seen = view.groups.filter((g) => g.side !== side && g.status !== 'lost').sort(byId);
  const ghosts = (view.ghosts ?? []).filter((g) => g.age <= diff.ghostAge).sort(byId);
  const known = [
    ...seen.map((g) => ({ id: g.id, type: g.type, pos: { ...g.pos }, age: 0, conf: 100, sector: g.sector ?? null, moved: !!g.moved, seen: true })),
    ...ghosts.map((g) => ({ id: g.id, type: g.type ?? 'rifles', pos: { ...g.pos }, age: g.age, conf: Math.max(30, 100 - g.age * 12), sector: g.sector ?? null, moved: !!g.from, seen: false })),
  ];
  const knownIds = new Set(known.map((k) => k.id));
  const lost = new Set(memory.lost ?? []);
  const remembered = Object.keys(memory.enemies ?? {}).sort().filter((id) => !knownIds.has(id) && !lost.has(id));

  // Graeben aus Karte und Zustand
  const ownTrench = [], foeTrench = [];
  for (const c of map.cells) {
    const t = liveCell(map, view.cells, c.x, c.y)?.trench;
    if (!t) continue;
    if (t.side === ms) ownTrench.push({ x: c.x, y: c.y, kind: t.kind, level: t.level ?? 1, captured: !!t.captured, home: c.side === ms });
    else foeTrench.push({ x: c.x, y: c.y, kind: t.kind, level: t.level ?? 1, captured: !!t.captured, home: c.side !== ms && c.side !== null });
  }
  // Vorderste eigene Grabenlinie je Zeile (in Richtung Feind)
  const front = new Map();
  for (const t of ownTrench) {
    if (t.kind !== 'fire' && t.kind !== undefined) continue;
    const cur = front.get(t.y);
    if (cur === undefined || (ex > 0 ? t.x > cur : t.x < cur)) front.set(t.y, t.x);
  }
  // Eigene Graeben, die der Feind genommen hat (Kartenseite eigen, Graben jetzt feindlich)
  const lostCells = foeTrench.filter((t) => cellAt(map, t.x, t.y)?.side === ms);

  const ownPower = own.reduce((s, g) => s + groupPower(g), 0);
  const inTrench = (p) => { const t = liveCell(map, view.cells, p.x, p.y)?.trench; return !!t && t.side !== ms; };
  let foePower = 0;
  for (const k of known) foePower += ((POWER[k.type] ?? 5) * k.conf * (inTrench(k.pos) ? 15 : 10)) / 1000;
  for (const id of remembered) foePower += ((POWER[memory.enemies[id]] ?? 5) * 7) / 10;
  foePower = Math.max(foePower, 1);
  return { side, ms, ex, own, known, remembered, ownTrench, foeTrench, front, lostCells, ownPower, foePower };
}

function updateMemory(view, memory) {
  const m = structuredClone(memory ?? {});
  m.enemies ??= {};
  m.lost ??= [];
  m.prep ??= 0;
  for (const g of view.groups) if (g.side !== view.side && !m.enemies[g.id]) m.enemies[g.id] = g.type;
  for (const g of view.ghosts ?? []) if (!m.enemies[g.id]) m.enemies[g.id] = g.type ?? 'rifles';
  for (const e of view.log ?? []) {
    if ((e.type === 'group_lost' || e.type === 'group_captured') && e.side && e.side !== view.side && e.group && !m.lost.includes(e.group)) m.lost.push(e.group);
  }
  m.lost.sort(compare);
  if (m.inBattle && view.turnKind === 'position') m.lastBattle = view.turn;
  m.inBattle = view.turnKind === 'battle';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Lage waehlen

/** Kraefteverhaeltnis in Prozent (eigene Kampfkraft zur geschaetzten feindlichen) */
export function strengthRatio(sit, rng, diff) {
  let r = (sit.ownPower * 100) / sit.foePower;
  if (diff.noise) r = r * (100 - diff.noise / 2 + Math.floor(rng() * (diff.noise + 1))) / 100;
  return Math.round(r);
}

function ownBattle(view) {
  const b = view.battle;
  if (!b) return null;
  const s = view.side;
  return {
    round: b.round ?? 1,
    attacking: !!b.attackers?.includes(s),
    assaulters: b.assaulters?.[s] ?? [],
    objectives: b.objectives?.[s] ?? [],
    counter: b.counter?.[s] ?? null,
    outcome: b.outcome?.[s] ?? null,
  };
}

function choosePosture(view, sit, memory, doc, diff, forced, rng) {
  const battle = ownBattle(view);
  const ratio = strengthRatio(sit, rng, diff);
  const assaultable = sit.own.filter((g) => ASSAULT_TYPES.has(g.type));
  const r = (posture, reason) => ({ posture, reason, ratio });
  if (forced && forced !== 'auto') {
    return r(forced, `Lage ${POSTURES[forced].label} ist vorgegeben (Kräfte ${pct(ratio)} der geschätzten feindlichen).`);
  }
  if (battle?.attacking && !battle.outcome) return r('sturm', `Der eigene Angriff läuft (Minute ${battle.round * 5}).`);
  if (battle?.counter && !battle.counter.done) return r('gegenstoss', `Stabsbefehl: Gegenstoß bei ${cellLabel(battle.counter.at.x, battle.counter.at.y)}.`);
  if (battle) return r('halten', `Der Gegner greift an. Jede Gruppe hält und schießt.`);
  if (sit.lostCells.length && assaultable.length && ratio >= doc.counterRatio) {
    const c = sit.lostCells[0];
    return r('gegenstoss', `Der Graben bei ${cellLabel(c.x, c.y)} ist verloren und wird zurückgeholt (Kräfte ${pct(ratio)}).`);
  }
  const rested = memory.lastBattle === undefined || view.turn - memory.lastBattle > doc.restTurns;
  if (!assaultable.length) return r('halten', 'Keine Gruppe, die stürmen könnte. Halten.');
  if (ratio >= doc.attackRatio && rested) {
    if (memory.prep >= doc.prepTurns) {
      if (doc.nightOnly && !view.night) return r('vorbereiten', `Angriff bereit, aber die Doktrin wartet auf die Nacht (Kräfte ${pct(ratio)}).`);
      return r('sturm', `Kräfte ${pct(ratio)} der geschätzten feindlichen, ${memory.prep} ${memory.prep === 1 ? 'Runde' : 'Runden'} vorbereitet: Angriff.`);
    }
    return r('vorbereiten', `Kräfte ${pct(ratio)}: genug für einen Angriff, aber erst vorbereiten (${memory.prep} von ${doc.prepTurns} ${doc.prepTurns === 1 ? 'Runde' : 'Runden'}).`);
  }
  if (ratio >= doc.prepareRatio && rested) return r('vorbereiten', `Kräfte ${pct(ratio)}: noch nicht genug, wir bereiten vor.`);
  if (!rested) return r('halten', `Nach dem letzten Gefecht braucht die Truppe Ruhe.`);
  return r('halten', `Kräfte nur ${pct(ratio)} der geschätzten feindlichen: halten und abwarten.`);
}

// ---------------------------------------------------------------------------------------------
// Bausteine fuer Befehle

/** Kosten fuer den Sturmweg: Gelaende, dazu (je nach Schwierigkeit) feindlicher Draht und bekannte MG-Kegel */
function assaultCost(map, view, sit, diff) {
  const mgs = sit.known.filter((k) => k.type === 'mg');
  return (c) => {
    const lc = view.cells[c.x + ',' + c.y] ? { ...c, ...view.cells[c.x + ',' + c.y] } : c;
    let v = enterCost(lc);
    if (!Number.isFinite(v)) return v;
    if (diff.wireAware && lc.wire && lc.wire.side !== sit.ms) v += 40;
    if (diff.mgAware) {
      for (const m of mgs) {
        const aim = m.sector ?? { x: m.pos.x - sit.ex * 10, y: m.pos.y };
        if (inCone(m.pos, aim, c, 60, 10)) v += 12;
      }
    }
    return v;
  };
}

function pathTo(map, from, to, cost) {
  const r = findPath(map, from, to, { cost, maxNodes: 6000 });
  return r ? r.path.slice(1) : null;
}

function redeployPath(map, g, to, side) {
  const home = cellAt(map, g.pos.x, g.pos.y);
  const r = findPath(map, g.pos, to, { cost: (c) => (redeployCellOk(c, side, home) ? enterCost(c) : Infinity), maxNodes: 6000 });
  return r ? r.path.slice(1) : null;
}

/**
 * Gleichstand zwischen zwei Feldern aufloesen: erst nach Zeile, dann das Feld naeher an der eigenen Etappe.
 * Seitengleich (ex = Richtung zum Feind), damit Seite a und b auf einer Spiegelkarte gleich entscheiden.
 */
function tie(p, q, ex) {
  return p.y - q.y || (p.x - q.x) * ex;
}

function nearest(list, p, ex) {
  let best = null, bd = Infinity;
  for (const q of list) {
    const d = distance(q, p);
    if (d < bd || (d === bd && best && tie(q, best, ex) < 0)) { best = q; bd = d; }
  }
  return best;
}

function occupiedSet(sit, extra = []) {
  const s = new Set(sit.own.map((g) => key(g.pos)));
  for (const k of sit.known) if (k.seen) s.add(key(k.pos));
  for (const p of extra) s.add(key(p));
  return s;
}

/** Ziel fuer den Sturm: feindliches Grabenfeld mit dem geringsten Widerstand */
export function pickObjective(view, map, sit, diff, rng, from) {
  const candidates = sit.foeTrench.filter((t) => t.home && (t.kind === 'fire' || t.kind === undefined));
  if (!candidates.length) return null;
  const mgs = sit.known.filter((k) => k.type === 'mg');
  let best = null;
  for (const t of candidates) {
    const d = distance(t, from);
    if (d > ASSAULT_REACH + 6) continue;
    let score = d * 4;
    for (const k of sit.known) {
      const kd = distance(k.pos, t);
      if (kd <= 2) score += (40 * k.conf) / 100;
      else if (kd <= 5) score += (12 * k.conf) / 100;
    }
    if (diff.mgAware) for (const m of mgs) if (inCone(m.pos, m.sector ?? { x: m.pos.x - sit.ex * 10, y: m.pos.y }, t, 60, 10)) score += 30;
    if (diff.wireAware) {
      // Draht auf der geraden Linie vom Ausgangspunkt
      const steps = Math.max(1, d);
      for (let i = 1; i < steps; i++) {
        const x = from.x + roundSym(((t.x - from.x) * i) / steps), y = from.y + Math.round(((t.y - from.y) * i) / steps);
        const c = liveCell(map, view.cells, x, y);
        if (c?.wire && c.wire.side !== sit.ms) score += 6;
      }
    }
    if (diff.noise) score += Math.floor(rng() * diff.noise);
    if (!best || score < best.score || (score === best.score && tie(t, best, sit.ex) < 0)) best = { x: t.x, y: t.y, score };
  }
  return best;
}

/** Feldnachbarn eines Ziels im feindlichen Graben (fuer mehrere Sturmgruppen) */
function objectiveCells(sit, obj, n) {
  return sit.foeTrench
    .filter((t) => distance(t, obj) <= 3)
    .sort((p, q) => distance(p, obj) - distance(q, obj) || tie(p, q, sit.ex))
    .slice(0, Math.max(1, n));
}

function frontX(sit, y) {
  if (sit.front.has(y)) return sit.front.get(y);
  let best = null;
  for (const [fy, fx] of sit.front) if (best === null || Math.abs(fy - y) < Math.abs(best[0] - y)) best = [fy, fx];
  return best ? best[1] : null;
}

function clampY(map, y) {
  return Math.max(0, Math.min(map.height - 1, y));
}

// ---------------------------------------------------------------------------------------------
// Artillerie

function batteriesInRange(art, p) {
  return (art?.batteries ?? []).filter((b) => !b.silenced && distance(batteryCenter(b), p) <= batteryType(b).range).sort(byId);
}

function barragePlan(map, sit, art, centerY) {
  const fx = frontX(sit, centerY);
  if (fx === null) return null;
  const x = fx + sit.ex * 3;
  if (x < 0 || x >= map.width) return null;
  const a = { x, y: clampY(map, centerY - 10) }, b = { x, y: clampY(map, centerY + 10) };
  const mid = { x, y: centerY };
  const bats = batteriesInRange(art, mid).map((q) => q.id);
  if (!bats.length) return null;
  return { id: 'ki-sperr', kind: 'barrage', batteries: bats, a, b, dir: sit.ex > 0 ? 'E' : 'W', start: 1, rounds: 4 };
}

function threatCenterY(map, sit) {
  const k = sit.known;
  if (k.length) return clampY(map, Math.round(k.reduce((s, q) => s + q.pos.y, 0) / k.length));
  if (sit.own.length) return clampY(map, Math.round(sit.own.reduce((s, g) => s + g.pos.y, 0) / sit.own.length));
  return Math.floor(map.height / 2);
}

// ---------------------------------------------------------------------------------------------
// Entscheidung

/**
 * Was wuerde der Kommandant tun? Liefert Befehle mit Begruendungen.
 */
export function decide(view, opts = {}) {
  const map = opts.map;
  if (!map?.cells) throw new Error('decide braucht die geladene Karte (opts.map)');
  const side = view.side;
  const doc = DOCTRINES[opts.doctrine] ?? DOCTRINES[DEFAULT_DOCTRINE];
  const diff = DIFFICULTIES[opts.difficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  const seed = (opts.seed ?? 1) >>> 0;
  const rng = aiRng(seed, side + (opts.advisor ? ':lehrling' : ''), view.turn);
  const memory = updateMemory(view, opts.memory);
  const sit = assess(view, map, memory, diff);
  const st = viewState(view);
  const env = { map };
  const forced = opts.posture && POSTURES[opts.posture] ? opts.posture : null;
  const pick = choosePosture(view, sit, memory, doc, diff, forced, rng);
  const posture = pick.posture;
  const battle = ownBattle(view);
  const art = view.own.artillery ?? null;
  const allow = (k) => !!(doc.artillery[k] && diff.artillery[k]);

  const advice = [];
  const taken = new Set();
  const reserved = new Set(); // Zielfelder, die schon eine Gruppe bekommt
  const intent = { posture, objective: null, groups: [], fire: [], when: null, ratio: pick.ratio };

  /** Befehl pruefen und vormerken. Ungueltig: verworfen, die Gruppe bleibt frei fuer andere Regeln. */
  function give(g, order, reason, tag) {
    if (g && taken.has(g.id)) return false;
    const why = validateOrder(order, st, side, env);
    if (why) return false;
    if (g) taken.add(g.id);
    advice.push({ group: g ? g.id : null, order, reason, tag });
    return true;
  }

  const isNight = timeDarkness(st) > 0.5;
  const kind = view.turnKind;
  const healthy = (g) => (g.strength ?? 1) * 100 >= (g.size ?? 1) * 40 && (g.morale ?? 70) >= 30 && (g.suppressed ?? 0) < PINNED;
  const zoneOf = (p) => cellAt(map, p.x, p.y);
  // Draussen: Niemandsland oder Feindseite, aber nicht in einem genommenen (jetzt eigenen) Graben
  const outside = (g) => {
    const c = zoneOf(g.pos);
    if (!c || !(c.zone === 'niemandsland' || (c.side !== null && c.side !== sit.ms))) return false;
    return liveCell(map, view.cells, g.pos.x, g.pos.y)?.trench?.side !== sit.ms;
  };

  // Bausteine der Mechanik-Pakete (P23: Stollen, Stosstrupp, Sappe) bekommen ihre Gruppen zuerst
  runAiBlocks({ view, map, side, sit, kind, isNight, doc, diff, rng, memory, opts, give, taken, outside, st });

  // ---------- Gefechtsrunde ----------
  if (kind === 'battle') {
    const visibleFoes = sit.known.filter((k) => k.seen);
    if (posture === 'sturm' && battle?.attacking && !battle.outcome) {
      const ids = new Set(battle.assaulters);
      const groups = sit.own.filter((g) => ids.has(g.id));
      const size = groups.reduce((s, g) => s + (g.size ?? 1), 0), str = groups.reduce((s, g) => s + (g.strength ?? 0), 0);
      const lossPct = size ? 100 - Math.floor((str * 100) / size) : 100;
      const pinned = groups.filter((g) => (g.suppressed ?? 0) >= PINNED).length;
      const abort = groups.length > 0 && (lossPct >= doc.persistence || (diff.coordinate && pinned === groups.length && lossPct >= doc.persistence / 2));
      for (const g of groups) {
        const goal = battle.objectives.find((o) => o.group === g.id) ?? battle.objectives[0];
        if (!goal) continue;
        intent.objective ??= { x: goal.x, y: goal.y };
        intent.groups.push(g.id);
        if (abort) {
          give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} bleibt liegen: Die Sturmgruppen haben ${pct(lossPct)} verloren, der Angriff wird abgebrochen.`, 'Sturm abbrechen: Verluste zu hoch');
          continue;
        }
        if (g.pos.x === goal.x && g.pos.y === goal.y) {
          give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} ist am Ziel ${cellLabel(goal.x, goal.y)} und richtet sich im Graben ein.`, 'Sturm: Ziel erreicht, halten');
          continue;
        }
        const path = pathTo(map, g.pos, goal, assaultCost(map, view, sit, diff));
        if (path?.length && path.length <= MAX_ASSAULT_CELLS) {
          give(g, { group: g.id, type: 'assault', path }, `${nameOf(g)} stürmt weiter auf ${cellLabel(goal.x, goal.y)}, noch ${path.length} ${path.length === 1 ? 'Feld' : 'Felder'}.`, 'Sturm: weiter aufs Ziel');
        }
      }
    }
    if (posture === 'gegenstoss' && battle?.counter && !battle.counter.done) {
      const at = battle.counter.at;
      intent.objective = { x: at.x, y: at.y };
      const cands = sit.own.filter((g) => ASSAULT_TYPES.has(g.type) && healthy(g) && !g.inDugout && distance(g.pos, at) <= 12)
        .sort((p, q) => distance(p.pos, at) - distance(q.pos, at) || byId(p, q)).slice(0, doc.depth ? 3 : 2);
      for (const g of cands) {
        const path = pathTo(map, g.pos, at, assaultCost(map, view, sit, diff));
        if (path?.length && path.length <= MAX_ASSAULT_CELLS) {
          intent.groups.push(g.id);
          give(g, { group: g.id, type: 'assault', path }, `${nameOf(g)} tritt zum Gegenstoß auf ${cellLabel(at.x, at.y)} an. Der Graben muss zurück, bevor sich der Gegner einrichtet.`, 'Gegenstoß: Graben zurückholen');
        }
      }
    }
    // Verteidigung: aus dem Unterstand, wenn der Sturm naht; Feuer auf die naechste Bedrohung
    for (const g of sit.own) {
      if (taken.has(g.id)) continue;
      const near = visibleFoes.filter((k) => distance(k.pos, g.pos) <= unitType(g.type).range + 3)
        .sort((p, q) => distance(p.pos, g.pos) - distance(q.pos, g.pos) || compare(p.id, q.id));
      const t = unitType(g.type);
      if (outside(g) && !(battle?.assaulters ?? []).includes(g.id)) {
        const back = nearest(sit.ownTrench.filter((c) => c.home), g.pos, sit.ex);
        const path = back ? pathTo(map, g.pos, back, (c) => enterCost(c)) : null;
        if (path?.length && give(g, { group: g.id, type: 'move', path }, `${nameOf(g)} steht draußen und geht zurück in den Graben bei ${cellLabel(back.x, back.y)}.`, 'Zurück in den Graben')) continue;
      }
      if (!near.length) continue;
      const target = near[0];
      if (t.sector) {
        if (g.inDugout || !g.sector || distance(g.sector, target.pos) > 2) {
          give(g, { group: g.id, type: 'sector', target: { ...target.pos } }, `${nameOf(g)} schwenkt das MG auf den Feind bei ${cellLabel(target.pos.x, target.pos.y)}${g.inDugout ? ' und rennt dafür an die Brustwehr' : ''}.`, 'MG auf den Sturm');
        }
        continue;
      }
      if (t.shots > 0 && !t.indirect && distance(target.pos, g.pos) >= 1) {
        give(g, { group: g.id, type: 'fire', target: { ...target.pos } },
          g.inDugout ? `${nameOf(g)} raus aus dem Unterstand: Feind bei ${cellLabel(target.pos.x, target.pos.y)}, ${distance(target.pos, g.pos)} Felder. Wettlauf zur Brustwehr.`
            : `${nameOf(g)} feuert auf den nächsten Feind bei ${cellLabel(target.pos.x, target.pos.y)}.`,
          g.inDugout ? 'Aus dem Unterstand an die Brustwehr' : 'Feuer auf die nächste Bedrohung');
      }
    }
  }

  // ---------- Stellungsrunde ----------
  if (kind === 'position') {
    const assaultable = sit.own.filter((g) => ASSAULT_TYPES.has(g.type) && healthy(g));
    const center = sit.own.length ? { x: sit.ex > 0 ? Math.round(sit.own.reduce((s, g) => s + g.pos.x, 0) / sit.own.length) : -Math.round(-sit.own.reduce((s, g) => s + g.pos.x, 0) / sit.own.length), y: Math.round(sit.own.reduce((s, g) => s + g.pos.y, 0) / sit.own.length) } : { x: 0, y: 0 };
    let objective = null;
    if (posture === 'sturm' || posture === 'vorbereiten') {
      const from = assaultable.length ? assaultable.reduce((b, g) => (b && byId(b, g) <= 0 ? b : g), null).pos : center;
      const fx = frontX(sit, from.y);
      objective = pickObjective(view, map, sit, diff, rng, fx !== null ? { x: fx, y: from.y } : from);
      if (!objective && memory.objective) objective = memory.objective;
    }
    if (posture === 'gegenstoss') objective = nearest(sit.lostCells, center, sit.ex);
    if (objective) intent.objective = { x: objective.x, y: objective.y };

    // Sturm ansetzen
    let fireTarget = null;
    if ((posture === 'sturm' || posture === 'gegenstoss') && objective) {
      const share = posture === 'gegenstoss' ? Math.min(3, assaultable.length) : Math.max(1, Math.ceil((assaultable.length * doc.assaultShare) / 100));
      const count = Math.max(0, Math.min(share, assaultable.length - (posture === 'sturm' ? doc.reserve : 0))) || (assaultable.length ? 1 : 0);
      const ranked = assaultable.slice().sort((p, q) => distance(p.pos, objective) - distance(q.pos, objective) || byId(p, q));
      // Pioniere vorn, wenn Draht im Weg liegt (sie schneiden Gassen)
      const cutters = ranked.filter((g) => WIRE_CUTTERS.has(g.type));
      const chosen = [...new Set([...cutters.slice(0, 1), ...ranked])].slice(0, count).sort(byId);
      const goals = objectiveCells(sit, objective, chosen.length);
      const cost = assaultCost(map, view, sit, diff);
      chosen.forEach((g, i) => {
        const goal = goals[i % goals.length];
        const path = pathTo(map, g.pos, goal, cost);
        if (!path?.length || path.length > MAX_ASSAULT_CELLS) return;
        const wire = path.filter((p) => { const c = liveCell(map, view.cells, p.x, p.y); return c?.wire && c.wire.side !== sit.ms; }).length;
        const why = posture === 'gegenstoss'
          ? `${nameOf(g)} setzt zum Gegenstoß auf ${cellLabel(goal.x, goal.y)} an: Der verlorene Graben wird zurückgeholt.`
          : `${nameOf(g)} stürmt auf ${cellLabel(goal.x, goal.y)}: dort ist der Widerstand am geringsten${wire ? `, ${wire} ${wire === 1 ? 'Drahtfeld' : 'Drahtfelder'} im Weg` : ''}.`;
        if (give(g, { group: g.id, type: 'attack', path }, why, posture === 'gegenstoss' ? 'Gegenstoß ansetzen' : 'Sturm: schwächste Stelle angreifen')) {
          intent.groups.push(g.id);
          reserved.add(key(goal));
        }
      });
      if (intent.groups.length) {
        intent.when = isNight ? 'nachts' : 'tags';
        fireTarget = objective;
      }
    }

    // Vorbereiten: Sturmgruppen in die Sprungstellung, Beobachter auf Hoehe
    if (posture === 'vorbereiten' && objective) {
      const count = Math.max(1, Math.ceil((assaultable.length * doc.assaultShare) / 100));
      const ranked = assaultable.slice().sort((p, q) => distance(p.pos, objective) - distance(q.pos, objective) || byId(p, q)).slice(0, count);
      const occupied = occupiedSet(sit);
      const jump = sit.ownTrench.filter((c) => c.home && !occupied.has(key(c)))
        .sort((p, q) => distance(p, objective) - distance(q, objective) || tie(p, q, sit.ex));
      for (const g of ranked.sort(byId)) {
        intent.groups.push(g.id);
        if (distance(g.pos, objective) <= ASSAULT_REACH - 6 && !outside(g)) continue;
        const spot = jump.find((c) => !reserved.has(key(c)));
        if (!spot) break;
        const path = redeployPath(map, g, spot, side);
        if (path?.length && give(g, { group: g.id, type: 'redeploy', path }, `${nameOf(g)} verlegt in die Sprungstellung bei ${cellLabel(spot.x, spot.y)}, ${distance(spot, objective)} Felder vor dem Ziel.`, 'Vorbereiten: Sprungstellung beziehen')) reserved.add(key(spot));
      }
    }
    if ((posture === 'vorbereiten' || posture === 'sturm') && objective && diff.observers) {
      const obs = sit.own.filter((g) => g.type === 'observers' && !taken.has(g.id));
      const occupied = occupiedSet(sit);
      for (const g of obs) {
        const seesNow = distance(g.pos, objective) <= 14 && lineOfSight(map, g.pos, objective).visible;
        if (seesNow) continue;
        let best = null;
        for (let y = Math.max(0, objective.y - 8); y <= Math.min(map.height - 1, objective.y + 8); y++) {
          for (let x = 0; x < map.width; x++) {
            const c = cellAt(map, x, y);
            if (c.side !== sit.ms || c.zone === 'niemandsland' || !Number.isFinite(enterCost(c)) || occupied.has(key(c)) || reserved.has(key(c))) continue;
            const d = distance(c, objective);
            if (d > 14 || d < 4) continue;
            const s = c.height * 10 - d - distance(c, g.pos) / 4;
            if (best && (s < best.s || (s === best.s && tie(c, best, sit.ex) >= 0))) continue;
            if (!lineOfSight(map, c, objective).visible) continue;
            best = { x, y, s };
          }
        }
        if (!best) continue;
        const path = redeployPath(map, g, best, side);
        if (path?.length && give(g, { group: g.id, type: 'redeploy', path }, `${nameOf(g)} geht auf ${cellLabel(best.x, best.y)}: von dort ist ${cellLabel(objective.x, objective.y)} einzusehen.`, 'Beobachter auf Sicht zum Ziel')) reserved.add(key(best));
      }
    }

    // Rueckzug aus dem Niemandsland nach einem Gefecht
    for (const g of sit.own) {
      if (taken.has(g.id) || !outside(g)) continue;
      const back = nearest(sit.ownTrench.filter((c) => c.home && !reserved.has(key(c))), g.pos, sit.ex);
      if (!back) continue;
      const path = redeployPath(map, g, back, side);
      if (path?.length && give(g, { group: g.id, type: 'redeploy', path }, `${nameOf(g)} liegt noch draußen und kriecht zurück in den Graben bei ${cellLabel(back.x, back.y)}.`, 'Zurück in den Graben')) reserved.add(key(back));
    }

    // Abloesen und Auffuellen (P12): wer zu lange vorn liegt, wird von einer Gruppe aus Reserve oder Ruhe
    // abgeloest; Gruppen hinten werden mit Ersatz aufgefuellt, bevor sie wieder nach vorn gehen.
    if (posture !== 'sturm') {
      const back = sit.own.filter((g) => !taken.has(g.id) && postOf(map, g) !== 'front' && healthy(g) && (g.fatigue ?? 0) < 50).sort(byId);
      for (const g of sit.own.filter((x) => !taken.has(x.id) && postOf(map, x) === 'front' && isTooLong(x)).sort(byId)) {
        const by = back.find((r) => !taken.has(r.id) && (ASSAULT_TYPES.has(r.type) === ASSAULT_TYPES.has(g.type)));
        if (!by) continue;
        if (give(g, { group: g.id, type: 'relieve', by: by.id }, `${nameOf(g)} liegt seit ${g.frontTurns} Runden vorn und wird von ${nameOf(by)} abgelöst.`, 'Ablösen: zu lange vorn')) taken.add(by.id);
      }
      for (const g of sit.own.filter((x) => !taken.has(x.id) && postOf(map, x) !== 'front' && x.strength * 100 < x.size * 80).sort(byId)) {
        give(g, { group: g.id, type: 'refill' }, `${nameOf(g)} hat nur ${g.strength} von ${g.size} Mann und wird hinten mit Ersatz aufgefüllt.`, 'Auffüllen mit Ersatz');
      }
    }

    // Front besetzen (Veteran und Lask): Gruppen ohne Graben gehen in den naechsten freien Feuergraben
    // (nicht aus dem Ruhelager: wer ruht, bleibt dort, bis er abloest)
    if (diff.rearrange) {
      const occupied = occupiedSet(sit, [...reserved].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; }));
      for (const g of sit.own) {
        if (taken.has(g.id) || g.type === 'observers' || g.type === 'runners' || g.type === 'medics' || postOf(map, g) === 'rest') continue;
        const here = liveCell(map, view.cells, g.pos.x, g.pos.y);
        if (here?.trench && here.trench.side === sit.ms) continue;
        const free = sit.ownTrench.filter((c) => c.home && c.kind === 'fire' && !occupied.has(key(c)));
        let target = nearest(free, g.pos, sit.ex);
        if (doc.depth && g.type !== 'mg' && target) {
          // Tiefe Verteidigung: Reserven bleiben einige Felder hinter der vordersten Linie
          const deep = free.filter((c) => { const fx = frontX(sit, c.y); return fx !== null && Math.abs(fx - c.x) >= 3; });
          target = nearest(deep, g.pos, sit.ex) ?? target;
        }
        if (!target || distance(target, g.pos) > 14) continue;
        const path = redeployPath(map, g, target, side);
        if (path?.length && give(g, { group: g.id, type: 'redeploy', path }, `${nameOf(g)} steht ohne Deckung und bezieht den Graben bei ${cellLabel(target.x, target.y)}.`, 'Graben beziehen')) occupied.add(key(target));
      }
    }

    // Draht vor die eigene Linie (Halten, Vorbereiten): Pioniere zuerst
    if (posture === 'halten' || (posture === 'vorbereiten' && doc.depth)) {
      const layers = sit.own.filter((g) => WIRE_LAYERS.has(g.type) && !taken.has(g.id)).sort((p, q) => (p.type === 'pioneers' ? -1 : 0) - (q.type === 'pioneers' ? -1 : 0) || byId(p, q));
      let material = view.own.supplies?.material ?? 0;
      for (const g of layers.slice(0, g0(layers))) {
        const line = wireLine(map, view, sit, g, side);
        if (!line || line.length > material) continue;
        if (give(g, { group: g.id, type: 'wire', path: line }, `${nameOf(g)} zieht ${line.length} Felder Draht vor dem Graben von ${cellLabel(line[0].x, line[0].y)} bis ${cellLabel(line[line.length - 1].x, line[line.length - 1].y)}.`, 'Halten: Draht vor die Linie')) material -= line.length;
      }
    }

    // MG-Sektoren
    for (const g of sit.own) {
      if (taken.has(g.id) || !unitType(g.type).sector) continue;
      const range = unitType(g.type).range;
      const threats = sit.known.filter((k) => distance(k.pos, g.pos) <= range + 4).sort((p, q) => distance(p.pos, g.pos) - distance(q.pos, g.pos) || compare(p.id, q.id));
      let aim, why, tag;
      if (fireTarget && distance(fireTarget, g.pos) <= range + 2) { aim = fireTarget; why = `${nameOf(g)} legt den Feuersektor auf das Sturmziel ${cellLabel(aim.x, aim.y)} und hält den Gegner nieder.`; tag = 'MG deckt den Sturm'; }
      else if (threats.length) { aim = threats[0].pos; why = `${nameOf(g)} richtet das MG auf ${threats[0].seen ? 'den Feind' : 'den vermuteten Feind'} bei ${cellLabel(aim.x, aim.y)}.`; tag = 'MG auf bekannten Feind'; }
      else { aim = { x: Math.max(0, Math.min(map.width - 1, g.pos.x + sit.ex * range)), y: g.pos.y }; why = `${nameOf(g)} bestreicht das Vorfeld geradeaus.`; tag = 'MG bestreicht das Vorfeld'; }
      const cur = g.sector ?? { x: g.pos.x + sit.ex * range, y: g.pos.y };
      if (distance(cur, aim) <= 2) continue;
      give(g, { group: g.id, type: 'sector', target: { x: aim.x, y: aim.y } }, why, tag);
    }

    // Leuchtkugel bei Nacht auf vermutete Bewegung vor der Linie
    if (diff.flares && isNight) {
      const moving = sit.known.filter((k) => k.moved || k.age <= 1).sort((p, q) => compare(p.id, q.id));
      done: for (const k of moving) {
        for (const g of sit.own.filter((x) => !taken.has(x.id)).sort((p, q) => distance(p.pos, k.pos) - distance(q.pos, k.pos) || byId(p, q))) {
          if (flareProblem(g, k.pos, timeDarkness(st))) continue;
          if (give(g, { group: g.id, type: 'flare', target: { ...k.pos } }, `${nameOf(g)} schießt eine Leuchtkugel über ${cellLabel(k.pos.x, k.pos.y)}: dort hat sich drüben etwas bewegt.`, 'Leuchtkugel auf Bewegung')) break done;
        }
      }
    }

    // Artillerie: ein Feuerplan fuer die Seite
    if (art?.batteries?.length) {
      const plans = [];
      const used = new Set();
      const reasons = [];
      if (fireTarget && (allow('prep') || allow('creep'))) {
        const fx = frontX(sit, fireTarget.y) ?? fireTarget.x - sit.ex * 10;
        const dist = Math.abs(fireTarget.x - fx);
        const prepBats = batteriesInRange(art, fireTarget).slice(0, allow('creep') && art.batteries.length > 1 ? 1 : 2);
        if (allow('prep') && prepBats.length) {
          const rounds = Math.max(1, Math.min(3, Math.floor(dist / 3) - 1));
          plans.push({ id: 'ki-vorb', kind: 'prep', batteries: prepBats.map((b) => b.id), a: { x: fireTarget.x, y: clampY(map, fireTarget.y - 4) }, b: { x: fireTarget.x, y: clampY(map, fireTarget.y + 4) }, dir: sit.ex > 0 ? 'E' : 'W', start: 1, rounds });
          prepBats.forEach((b) => used.add(b.id));
          reasons.push(`Vorbereitungsfeuer auf ${cellLabel(fireTarget.x, fireTarget.y)}, ${rounds} ${rounds === 1 ? 'Runde' : 'Runden'}, bevor die Sturmgruppen ankommen`);
        }
        const creepStart = fx + sit.ex * CREEP_LEAD;
        const creepBats = batteriesInRange(art, { x: creepStart, y: fireTarget.y }).filter((b) => !used.has(b.id));
        if (allow('creep') && diff.coordinate && creepBats.length && dist > CREEP_LEAD + 2) {
          const step = 3;
          const rounds = Math.max(2, Math.min(12, Math.ceil((dist - CREEP_LEAD) / step) + 1));
          plans.push({ id: 'ki-walze', kind: 'creep', batteries: creepBats.map((b) => b.id), a: { x: creepStart, y: clampY(map, fireTarget.y - 4) }, b: { x: creepStart, y: clampY(map, fireTarget.y + 4) }, dir: sit.ex > 0 ? 'E' : 'W', start: 1, rounds, step });
          creepBats.forEach((b) => used.add(b.id));
          reasons.push(`Feuerwalze ${CREEP_LEAD} Felder vor den Sturmgruppen, ${step} Felder je Runde`);
        }
        intent.fire.push(...plans.map((p) => p.kind));
      } else if (allow('barrage')) {
        const centerY = threatCenterY(map, sit);
        const bar = barragePlan(map, sit, art, centerY);
        const has = (art.plans ?? []).some((p) => p.kind === 'barrage' && (p.fired ?? 0) < p.rounds);
        if (bar && !has) {
          plans.push(bar);
          reasons.push(`Sperrfeuer auf Abruf vor der eigenen Linie bei ${cellLabel(bar.a.x, centerY)}`);
          intent.fire.push('barrage');
        } else if (bar && has) {
          // vorhandenes Sperrfeuer bleibt stehen. Kommt ein weiterer Plan dazu, wird es mitgeschickt und neu angelegt
          // (volle Runden fuer das naechste Gefecht); ohne neuen Plan geht gar kein Feuerplan raus.
          plans.push(...(art.plans ?? []).filter((p) => p.kind === 'barrage').map((p) => normalizePlan(p)));
        }
      }
      if (posture === 'vorbereiten' || posture === 'halten') {
        const known = Object.keys(art.known ?? {}).sort();
        if (allow('counter') && known.length) {
          const id = known[0];
          const e = art.known[id];
          const tgt = { x: e.pos.x + ((e.w ?? 1) >> 1), y: e.pos.y + ((e.h ?? 1) >> 1) };
          const bats = batteriesInRange(art, tgt).filter((b) => !used.has(b.id)).slice(0, 1);
          if (bats.length) {
            plans.push({ id: 'ki-gegen', kind: 'counter', batteries: bats.map((b) => b.id), battery: id });
            used.add(bats[0].id);
            reasons.push(`Gegenbatteriefeuer auf ${e.label ?? 'die erkannte Batterie'}`);
            intent.fire.push('counter');
          }
        }
        if (allow('harass') && posture === 'vorbereiten') {
          const tgts = sit.known.filter((k) => !objective || distance(k.pos, objective) <= 8).sort((p, q) => q.conf - p.conf || compare(p.id, q.id));
          const t = tgts[0]?.pos ?? objective;
          if (t) {
            const bats = batteriesInRange(art, t).filter((b) => !used.has(b.id)).slice(0, 1);
            if (bats.length) {
              plans.push({ id: 'ki-stoer', kind: 'harass', batteries: bats.map((b) => b.id), target: { x: t.x, y: t.y } });
              used.add(bats[0].id);
              reasons.push(`Störfeuer auf ${cellLabel(t.x, t.y)}`);
              intent.fire.push('harass');
            }
          }
        }
      }
      const fresh = plans.filter((p) => !(art.plans ?? []).some((q) => q.id === p.id && q.kind === 'barrage' && p.kind === 'barrage'));
      if (plans.length && fresh.length) {
        const order = { type: 'fire_plan', plans };
        if (!give(null, order, `Artillerie: ${reasons.join('; ')}.`, 'Artillerie nach Feuerplan')) {
          // Ein Plan passt nicht (Reichweite, Munition): einzeln versuchen, nur die gueltigen behalten
          const ok = plans.filter((p) => !validateOrder({ type: 'fire_plan', plans: [p] }, st, side, env));
          if (ok.length) give(null, { type: 'fire_plan', plans: ok }, `Artillerie: ${reasons.join('; ')}.`, 'Artillerie nach Feuerplan');
        }
      }
    }
  }

  // Taktik-Lehrling: auch fuer Gruppen ohne neuen Befehl sagen, warum sie bleiben sollen (Halten ausdruecklich)
  if (opts.advisor) {
    for (const g of sit.own) {
      if (taken.has(g.id)) continue;
      const here = liveCell(map, view.cells, g.pos.x, g.pos.y);
      const at = cellLabel(g.pos.x, g.pos.y);
      let why;
      if (kind === 'battle') why = `${nameOf(g)} hält bei ${at} und schießt auf alles, was durchs Vorfeld kommt.`;
      else if (g.type === 'observers') why = `${nameOf(g)} beobachtet weiter von ${at}; jede Meldung von dort ist mehr wert als ein Gang.`;
      else if (here?.trench && here.trench.side === sit.ms) why = `${nameOf(g)} bleibt im Graben bei ${at}. Hier gibt es nichts zu verbessern.`;
      else why = `${nameOf(g)} bleibt bei ${at}; ein Weg nach vorn wäre jetzt zu teuer.`;
      give(g, { group: g.id, type: 'hold' }, why, 'Halten');
    }
  }

  // Verschlafene Befehle (Rekrut): die Gruppe haelt. Der Taktik-Lehrling verschlaeft nichts.
  let orders = advice.map((a) => a.order);
  if (diff.slip && !opts.advisor) {
    const slipRng = aiRng(seed, side, view.turn, 'slip');
    for (const a of advice) {
      if (!a.group) continue;
      if (slipRng() * 100 < diff.slip) {
        a.order = { group: a.group, type: 'hold' };
        const g = sit.own.find((x) => x.id === a.group);
        a.reason = `${nameOf(g)} hat den Befehl nicht verstanden und bleibt, wo sie ist.`;
        a.tag = 'Befehl verschlafen';
      }
    }
    orders = advice.map((a) => a.order);
  }

  // Gedaechtnis fuer die naechste Runde
  const next = { ...memory };
  if (kind === 'position') {
    next.prep = posture === 'vorbereiten' ? (memory.posture === 'vorbereiten' || memory.posture === 'sturm' ? memory.prep : 0) + 1
      : posture === 'sturm' ? 0 : memory.prep;
    if (posture === 'sturm' && intent.groups.length) { next.lastAttack = view.turn; next.prep = 0; }
  }
  if (intent.objective) next.objective = { ...intent.objective };
  next.posture = posture;
  if (memory.posture !== posture) next.since = view.turn;

  const reasons = [pick.reason, ...advice.map((a) => a.reason)];
  return {
    side, posture, postureLabel: POSTURES[posture].label, postureReason: pick.reason, doctrine: doc.id, difficulty: diff.id,
    orders: orders.sort((p, q) => compare(p.group ?? '', q.group ?? '') || compare(p.type, q.type)),
    advice, intent, memory: next, reasons,
  };
}

// Draht: wie viele Gruppen hoechstens gleichzeitig Draht ziehen
function g0(layers) {
  return Math.min(layers.length, 2);
}

/** Drahtlinie zwei Felder vor dem eigenen Graben, nahe der Gruppe, ohne Luecken */
function wireLine(map, view, sit, g, side) {
  const cells = [];
  for (let y = Math.max(0, g.pos.y - 6); y <= Math.min(map.height - 1, g.pos.y + 6); y++) {
    const fx = frontX(sit, y);
    if (fx === null) { cells.push(null); continue; }
    const x = fx + sit.ex * 2;
    const c = liveCell(map, view.cells, x, y);
    cells.push(c && !wireBlocker(c, side) ? { x, y } : null);
  }
  // laengste zusammenhaengende Folge, die nahe genug an der Gruppe beginnt
  let best = null, cur = [];
  const flush = () => {
    if (!cur.length) return;
    // Anfang an die Gruppe legen: von der naechsten Seite her beginnen
    const startNear = distance(cur[0], g.pos) <= distance(cur[cur.length - 1], g.pos) ? cur : cur.slice().reverse();
    if (distance(startNear[0], g.pos) <= WIRE_REACH && (!best || startNear.length > best.length)) best = startNear.slice(0, MAX_WIRE_CELLS);
    cur = [];
  };
  for (const c of cells) {
    if (!c) { flush(); continue; }
    if (cur.length && distance(cur[cur.length - 1], c) !== 1) flush();
    cur.push(c);
  }
  flush();
  return best && best.length >= 2 ? best : null;
}

/** Nur die Befehle (Schnittstelle wie die Platzhalter-KI aus P03) */
export function planOrders(view, opts = {}) {
  return decide(view, opts).orders;
}

/** Lage-Name fuer Anzeigen */
export function postureLabel(id) {
  return POSTURES[id]?.label ?? id;
}

export { SIDES };
