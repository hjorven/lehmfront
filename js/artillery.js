// Artillerie nach Feuerplan (Plan 4.1 Nr. 4, 6 und 8, 7.4, 10.6). Rein: kein DOM, kein Date, kein Math.random.
// Zufall nur ueber den Phasen-Zufall, der als rng hereingereicht wird. Immer nach ID sortiert.
//
// Zustand je Seite: state.sides[side].artillery = {
//   batteries: [{ id, type, label, pos: {x,y}, w, h, ammo, silenced }]   Batteriestellungen in der Etappe
//   exchange: {x,y} | null                                              Fernmeldestelle (Leitungen laufen hier zusammen)
//   lines: [{ id, to, points: [[x,y],...], cells: [{x,y}], cut: {x,y} | null }]  Fernsprechleitungen
//   plans: [plan]                                                       scharfe Feuerplaene fuer die Gefechtsrunden
//   pending: [{ plan, kind: 'shift'|'cease', target?, due, via, observer }]  Befehle von Beobachtern unterwegs
//   known: { batteryId: { pos, w, h, type, turn } }                    aufgeklaerte feindliche Batterien
// }
// Feuerplan: { id, kind, batteries: [id], a?, b? (Linie), dir?, step?, rounds?, start?, target?, battery?,
//              shift?: {dx,dy}, ceasedFrom?: Runde, adjusted?: true, fired?: Zahl, used?: true }
import {
  BATTERY_TYPES, PLAN_KINDS, LINK_DELAY, LINE_REACH, LINE_CUT, FLASH_SPOT, SILENCED_ROUNDS, CRATER_BIG, SHELLS_PER_AMMO,
} from './config/artillery.js';
import { faction } from './config/factions.js';
import { hasReport, reportOpen, REPORT_EFFECTS } from './config/reports.js';
import { unitType } from './config/units.js';
import { DIR, DIRS, lineCells, distance, cellAt, cellLabel, enterCost } from './map.js';
import { coverValue } from './rules.js';
import { coverAt, directionOf, PINNED } from './sight.js';
import { cellKey, getCell, patchCell, groupsOf, otherSide, compareId, byId } from './state.js';

export const MAX_PLANS = 8;
const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(v)));

/** Kartenseite einer Spielseite: Seite a spielt die eigene ("own") Kartenhaelfte */
function mapSide(side) {
  return side === 'a' ? 'own' : 'enemy';
}

function hasTerrain(map) {
  return !!(map && Array.isArray(map.cells));
}

// ---------- Aufbau ----------

/** Felder einer Leitung aus ihren (auch halben) Stuetzpunkten, ohne Doppelte, in Laufrichtung */
export function lineCellsOf(points) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[i + 1] ?? p;
    for (const [x, y] of lineCells(Math.floor(p[0]), Math.floor(p[1]), Math.floor(q[0]), Math.floor(q[1]))) {
      const k = x + ',' + y;
      if (!seen.has(k)) { seen.add(k); out.push({ x, y }); }
    }
  }
  return out;
}

function makeBattery(spec, factionId) {
  const t = BATTERY_TYPES[spec.type] ? BATTERY_TYPES[spec.type] : BATTERY_TYPES.feldhaubitzen;
  const f = faction(factionId);
  const cap = Math.floor(t.ammo * f.artillery.ammo);
  return {
    id: String(spec.id), type: t.id, label: spec.label || t.name,
    pos: { x: spec.pos?.x ?? spec.x, y: spec.pos?.y ?? spec.y }, w: spec.w || 2, h: spec.h || 2,
    ammo: Math.min(cap, spec.ammo ?? cap), silenced: 0,
    ...(spec.center ? { center: { x: spec.center.x, y: spec.center.y } } : {}),
  };
}

function makeLine(spec, i) {
  const points = spec.points.map((p) => [Number(p[0]), Number(p[1])]);
  const cells = lineCellsOf(points);
  let cut = null;
  if (spec.cut) {
    const c = { x: Math.floor(spec.cut[0] ?? spec.cut.x), y: Math.floor(spec.cut[1] ?? spec.cut.y) };
    // Schnittstelle auf das naechste Leitungsfeld legen
    cut = cells.map((p) => ({ p, d: distance(p, c) })).sort((a, b) => a.d - b.d)[0]?.p ?? null;
  }
  return { id: String(spec.id ?? 'l' + (i + 1)), to: String(spec.to ?? ''), points, cells, cut: cut ? { ...cut } : null };
}

/**
 * Artillerie einer Seite fuer den Anfangszustand. spec (Szenario sides.x.artillery, optional):
 * { batteries: [{ id, type, pos|x,y, w, h, label, ammo, center? }], exchange: {x,y}, lines: [{ id, to, points, cut }], plans: [plan] }
 * Ohne Angaben liest die Seite a ihre Batterien, Fernmeldestelle und Leitungen von der Karte (Gebaeude "batterie",
 * "fernmelde", map.cables), Seite b entsprechend die Gebaeude mit side "enemy".
 */
export function initArtillery(map, spec, side, factionId) {
  const ms = mapSide(side);
  const own = (map?.buildings ?? []).filter((b) => (b.side ?? 'own') === ms);
  const batSpecs = spec?.batteries ?? own.filter((b) => b.type === 'batterie')
    .map((b) => ({ id: b.id, type: b.battery ?? 'feldhaubitzen', x: b.x, y: b.y, w: b.w, h: b.h, label: b.label }));
  const ex = spec?.exchange ?? own.find((b) => b.type === 'fernmelde') ?? null;
  const exchange = ex ? { x: Math.floor(ex.x + ((ex.w ?? 1) - 1) / 2), y: Math.floor(ex.y + ((ex.h ?? 1) - 1) / 2) } : null;
  const cableSpecs = side === 'a' ? (map?.cables ?? []).map((c, i) => ({ id: 'k' + (i + 1), to: c.to, points: c.points, cut: c.cut })) : [];
  const lineSpecs = [...cableSpecs, ...(spec?.lines ?? [])];
  const batteries = batSpecs.map((b) => makeBattery(b, factionId)).sort(byId);
  return {
    batteries,
    exchange,
    lines: lineSpecs.map(makeLine).sort(byId),
    plans: (spec?.plans ?? []).map((p) => normalizePlan(p)).sort(byId),
    pending: [],
    known: {},
  };
}

/** Artillerie einer Seite (leer, falls das Szenario keine hat) */
export function artilleryOf(state, side) {
  return state.sides[side]?.artillery ?? { batteries: [], exchange: null, lines: [], plans: [], pending: [], known: {} };
}

export function batteryType(b) {
  return BATTERY_TYPES[b.type] ?? BATTERY_TYPES.feldhaubitzen;
}

export function batteryCenter(b) {
  if (b.center) return { x: b.center.x, y: b.center.y }; // gespiegelte Karten: Mitte fest vorgegeben (P17)
  return { x: b.pos.x + Math.floor((b.w - 1) / 2), y: b.pos.y + Math.floor((b.h - 1) / 2) };
}

/** Lagerplatz einer Batterie (Granaten) mit Fraktionsfaktor */
export function batteryCapacity(b, factionId) {
  return Math.floor(batteryType(b).ammo * faction(factionId).artillery.ammo);
}

/** Granaten einer Batterie je Gefechtsrunde (Rohre der Fraktion, Anteil der Planart) */
export function shellsPerRound(b, factionId, kind = 'prep') {
  const t = batteryType(b);
  const salvo = PLAN_KINDS[kind]?.salvo ?? 100;
  return Math.max(1, Math.floor((t.shells * faction(factionId).artillery.tubes * salvo) / 100 + 0.5));
}

/** Streuung einer Batterie in Zehntelfeldern. Fernmeldestelle in der Naehe und eingeschossenes Feuer machen genauer. */
export function spreadOf(b, art, factionId, { adjusted = false, night = false } = {}) {
  let s = batteryType(b).spread * faction(factionId).artillery.spread;
  if (art?.exchange && distance(batteryCenter(b), art.exchange) <= 3) s *= 0.85;
  if (adjusted) s *= 0.7;
  if (night) s *= 1.15;
  return Math.max(2, Math.floor(s + 0.5));
}

// ---------- Plaene und Geometrie ----------

/** Plan auf gueltige Zahlen bringen (Kopie). runtime: Laufzeitfelder (fired, shift ...) mitnehmen */
export function normalizePlan(p, { runtime = false } = {}) {
  const k = PLAN_KINDS[p.kind];
  const out = { id: String(p.id), kind: p.kind, batteries: [...new Set((p.batteries ?? []).map(String))].sort(compareId) };
  if (k?.line) {
    out.a = { x: p.a.x | 0, y: p.a.y | 0 };
    out.b = { x: p.b.x | 0, y: p.b.y | 0 };
    out.dir = DIR[p.dir] ? p.dir : 'E';
    out.start = clampInt(p.start ?? 1, 1, 12);
    out.rounds = clampInt(p.rounds ?? k.rounds[0], k.rounds[0], k.rounds[1]);
    if (k.moves) out.step = clampInt(p.step ?? 1, k.steps[0], k.steps[1]);
  }
  if (k?.target) out.target = { x: p.target.x | 0, y: p.target.y | 0 };
  if (k?.battery) out.battery = String(p.battery);
  if (runtime) for (const f of ['shift', 'ceasedFrom', 'adjusted', 'fired', 'used']) if (p[f] !== undefined) out[f] = structuredClone(p[f]);
  return out;
}

/** Felder der Ausgangslinie eines Plans */
export function baseLine(plan) {
  return lineCells(plan.a.x, plan.a.y, plan.b.x, plan.b.y).map(([x, y]) => ({ x, y }));
}

/** Versatz der Walze in einer Gefechtsrunde (ohne Verlegen). null, wenn der Plan in dieser Runde nicht laeuft. */
export function creepOffset(plan, round) {
  if (round < plan.start) return null;
  // Sperrfeuer liegt auf Abruf, solange die Runden (Munition) reichen
  if (plan.kind === 'barrage') return (plan.fired ?? 0) < plan.rounds ? { dx: 0, dy: 0 } : null;
  if (round >= plan.start + plan.rounds) return null;
  const d = DIR[plan.dir] ?? DIR.E;
  const n = PLAN_KINDS[plan.kind]?.moves ? plan.step * (round - plan.start) : 0;
  return { dx: d.dx * n, dy: d.dy * n };
}

/**
 * Zielfelder eines Linienplans in einer Gefechtsrunde: die verschobene Linie plus Tiefe in Planrichtung.
 * withShift: Verlegungen durch Beobachter einrechnen (Standard). Liefert [] ausserhalb der Laufzeit.
 */
export function planCellsAt(plan, round, map = null, { withShift = true } = {}) {
  const k = PLAN_KINDS[plan.kind];
  if (!k?.line) return [];
  const off = creepOffset(plan, round);
  if (!off) return [];
  const d = DIR[plan.dir] ?? DIR.E;
  const sx = off.dx + (withShift ? plan.shift?.dx ?? 0 : 0), sy = off.dy + (withShift ? plan.shift?.dy ?? 0 : 0);
  const out = [];
  const seen = new Set();
  for (const c of baseLine(plan)) {
    for (let i = 0; i < k.depth; i++) {
      const x = c.x + sx + d.dx * i, y = c.y + sy + d.dy * i;
      if (map && (x < 0 || y < 0 || x >= map.width || y >= map.height)) continue;
      const key = x + ',' + y;
      if (!seen.has(key)) { seen.add(key); out.push({ x, y }); }
    }
  }
  return out;
}

/** Mitte einer Feldliste (ganzzahlig) */
export function centerOf(cells) {
  if (!cells.length) return null;
  let sx = 0, sy = 0;
  for (const c of cells) { sx += c.x; sy += c.y; }
  return { x: Math.floor(sx / cells.length + 0.5), y: Math.floor(sy / cells.length + 0.5) };
}

/** Walze ueber alle Runden: [{ round, cells, center }] (fuer Zeitbaender und Tests) */
export function walzeTimeline(plan, map = null) {
  const out = [];
  if (!PLAN_KINDS[plan.kind]?.line) return out;
  for (let r = plan.start; r < plan.start + plan.rounds; r++) {
    const cells = planCellsAt({ ...plan, fired: 0 }, r, map);
    out.push({ round: r, cells, center: centerOf(cells) });
  }
  return out;
}

/** Zielfelder eines Stellungsrunden-Plans (Stoerfeuer, Gegenbatterie) */
export function targetCellsOf(plan, state, side, map = null) {
  const k = PLAN_KINDS[plan.kind];
  let c = null, w = 1, h = 1;
  if (k.target) c = plan.target;
  if (k.battery) {
    const e = artilleryOf(state, side).known?.[plan.battery];
    if (!e) return [];
    c = e.pos; w = e.w ?? 2; h = e.h ?? 2;
  }
  if (!c) return [];
  const rad = k.radius ?? 1;
  const out = [];
  for (let y = c.y - (k.battery ? 0 : rad); y < c.y + h + (k.battery ? 0 : rad); y++) {
    for (let x = c.x - (k.battery ? 0 : rad); x < c.x + w + (k.battery ? 0 : rad); x++) {
      if (map && (x < 0 || y < 0 || x >= map.width || y >= map.height)) continue;
      out.push({ x, y });
    }
  }
  return out;
}

/** Granatenbedarf eines Plans je Batterie: Map(batteryId -> Granaten) */
export function planCost(plan, art, factionId) {
  const k = PLAN_KINDS[plan.kind];
  const rounds = k.round === 'battle' ? plan.rounds : 1;
  const out = new Map();
  for (const id of plan.batteries) {
    const b = art.batteries.find((x) => x.id === id);
    if (b) out.set(id, shellsPerRound(b, factionId, plan.kind) * rounds);
  }
  return out;
}

/** Munition nach allen Plaenen: { total, before, after, perBattery: Map(id -> { before, cost, after }) } */
export function ammoAfter(plans, art, factionId) {
  const per = new Map(art.batteries.map((b) => [b.id, { before: b.ammo, cost: 0, after: b.ammo }]));
  for (const p of plans) {
    for (const [id, n] of planCost(p, art, factionId)) {
      const e = per.get(id);
      if (e) { e.cost += n; e.after = e.before - e.cost; }
    }
  }
  let before = 0, cost = 0;
  for (const e of per.values()) { before += e.before; cost += e.cost; }
  return { before, cost, after: before - cost, perBattery: per };
}

/** Plan pruefen. Liefert null oder einen deutschen Grund. */
export function validatePlan(plan, state, side, map) {
  const k = PLAN_KINDS[plan?.kind];
  if (!k) return 'unbekannte Feuerplan-Art';
  if (plan.kind === 'creep' && !reportOpen(state, side, 'feuerwalze')) return 'Feuerwalze erst nach dem Erfahrungsbericht (drei Vorbereitungsfeuer)';
  const art = artilleryOf(state, side);
  if (!Array.isArray(plan.batteries) || !plan.batteries.length) return `${k.label} ohne Batterie`;
  for (const id of plan.batteries) {
    if (!art.batteries.some((b) => b.id === String(id))) return `Batterie ${id} gibt es nicht`;
  }
  const inMap = (p) => p && Number.isInteger(p.x) && Number.isInteger(p.y) && p.x >= 0 && p.y >= 0
    && p.x < state.map.width && p.y < state.map.height;
  if (k.line) {
    if (!inMap(plan.a) || !inMap(plan.b)) return `${k.label}: Linie liegt nicht auf der Karte`;
    if (distance(plan.a, plan.b) > 24) return `${k.label}: Linie ist zu lang (höchstens 25 Felder)`;
    if (!DIR[plan.dir]) return `${k.label}: Richtung fehlt`;
  }
  if (k.target && !inMap(plan.target)) return `${k.label}: Ziel liegt nicht auf der Karte`;
  if (k.battery && !art.known?.[plan.battery]) return `${k.label}: diese Batterie ist nicht aufgeklärt`;
  // Reichweite: die Mitte des ersten Ziels muss jede Batterie erreichen
  const p = normalizePlan(plan);
  const first = k.line ? centerOf(planCellsAt(p, p.start, map)) : centerOf(targetCellsOf(p, state, side, map));
  if (first) {
    for (const id of p.batteries) {
      const b = art.batteries.find((x) => x.id === id);
      const d = distance(batteryCenter(b), first);
      if (d > batteryType(b).range) return `${b.label} reicht nicht bis ${cellLabel(first.x, first.y)} (${d} von ${batteryType(b).range} Feldern)`;
    }
  }
  // Walze: auch die letzte Runde muss auf der Karte und in Reichweite liegen
  if (k.moves && map) {
    const lastRound = p.start + p.rounds - 1;
    const last = centerOf(planCellsAt(p, lastRound, map));
    if (!last) return `${k.label} läuft in Runde ${p.rounds} über den Kartenrand`;
    for (const id of p.batteries) {
      const b = art.batteries.find((x) => x.id === id);
      const d = distance(batteryCenter(b), last);
      if (d > batteryType(b).range) return `${b.label} reicht in Runde ${p.rounds} nicht bis ${cellLabel(last.x, last.y)} (${d} von ${batteryType(b).range} Feldern)`;
    }
  }
  return null;
}

/**
 * Batterien, die in derselben Gefechtsrunde in zwei Plaenen stehen. Jede Batterie schiesst nur einmal je Runde
 * (der Plan mit der kleineren ID zuerst). Liefert [{ battery, plans: [id, id], round }] (erste Ueberschneidung je Paar).
 */
export function planClashes(plans) {
  const out = [];
  const list = plans.filter((p) => PLAN_KINDS[p.kind]?.round === 'battle').sort((p, q) => compareId(p.id, q.id));
  const span = (p) => [p.start ?? 1, (p.start ?? 1) + (p.rounds ?? 1) - 1];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [a0, a1] = span(list[i]), [b0, b1] = span(list[j]);
      const from = Math.max(a0, b0);
      if (from > Math.min(a1, b1)) continue;
      for (const id of list[i].batteries) {
        if (list[j].batteries.includes(id)) out.push({ battery: id, plans: [list[i].id, list[j].id], round: from });
      }
    }
  }
  return out;
}

// ---------- Leitungen und Beobachter ----------

/** Vorderes Ende einer Leitung (das Feld, an dem Beobachter oder Batterie anschliessen) */
export function lineEnd(line) {
  return line.cells[line.cells.length - 1] ?? null;
}

/** Ist die Batterie an die Fernmeldestelle angeschlossen? (eigene Leitung oder Stellung direkt daneben) */
export function batteryLinked(art, b) {
  if (art.exchange && distance(batteryCenter(b), art.exchange) <= 3) return true;
  return art.lines.some((l) => l.to === b.id && !l.cut);
}

/**
 * Verbindung eines Beobachters zur Fernmeldestelle: { phone, line, why }.
 * Angeschlossen ist, wer hoechstens LINE_REACH Felder vom vorderen Ende einer heilen Leitung steht,
 * oder neben der Fernmeldestelle sitzt.
 */
export function observerLink(state, side, group) {
  const art = artilleryOf(state, side);
  if (art.exchange && distance(group.pos, art.exchange) <= LINE_REACH) return { phone: true, line: null, why: 'an der Fernmeldestelle' };
  const near = art.lines
    .filter((l) => !art.batteries.some((b) => b.id === l.to))
    .map((l) => ({ l, d: distance(group.pos, lineEnd(l)) }))
    .filter((e) => e.d <= LINE_REACH)
    .sort((a, b) => a.d - b.d || compareId(a.l.id, b.l.id));
  const ok = near.find((e) => !e.l.cut);
  if (ok) return { phone: true, line: ok.l.id, why: `Leitung ${ok.l.to}` };
  if (near.length) return { phone: false, line: near[0].l.id, why: `Leitung ${near[0].l.to} bei ${cellLabel(near[0].l.cut.x, near[0].l.cut.y)} durchtrennt` };
  return { phone: false, line: null, why: 'keine Leitung in der Nähe' };
}

/**
 * Weg eines Beobachterbefehls zu den Batterien eines Plans: { via: 'phone'|'runner'|null, delay, why }.
 * Telefon nur, wenn Beobachter und alle Batterien des Plans angeschlossen sind. Sonst laeuft ein Melder
 * (braucht eine einsatzfaehige Meldergruppe), sonst geht nichts.
 */
export function commandLink(state, side, group, plan) {
  const art = artilleryOf(state, side);
  const obs = observerLink(state, side, group);
  const cutBat = plan ? plan.batteries.map((id) => art.batteries.find((b) => b.id === id)).filter((b) => b && !batteryLinked(art, b)) : [];
  if (obs.phone && !cutBat.length) return { via: 'phone', delay: LINK_DELAY.phone, why: `per Telefon (${obs.why})` };
  const runner = groupsOf(state, side).find((g) => g.type === 'runners');
  const what = !obs.phone ? obs.why : `${cutBat.map((b) => b.label).join(', ')} ohne Leitung`;
  if (runner) return { via: 'runner', delay: LINK_DELAY.runner, why: `per Melder, ${what}` };
  return { via: null, delay: 0, why: `${what}, kein Melder da` };
}

/**
 * Plan, den ein Beobachterbefehl meint (Phase, Pruefung und Vorschau nutzen dieselbe Wahl):
 * ausdruecklich (order.plan), sonst der laufende oder noch kommende Plan, der dem Ziel am naechsten liegt.
 * Ohne Ziel (Feuer einstellen) zaehlt die Naehe zum Beobachter, und nur Plaene, die gerade schiessen.
 */
export function observerPlan(art, order, round, target = null, from = null) {
  const list = (art?.plans ?? []).filter((p) => PLAN_KINDS[p.kind]?.round === 'battle' && p.ceasedFrom == null)
    .sort((p, q) => compareId(p.id, q.id));
  if (order?.plan) return list.find((p) => p.id === order.plan) ?? null;
  const near = target ?? from;
  const running = target
    ? list.filter((p) => planCellsAt(p, round).length || p.start > round)
    : list.filter((p) => planCellsAt(p, round).length);
  if (!running.length) return null;
  if (!near) return running[0];
  return running
    .map((p) => ({ p, c: centerOf(planCellsAt(p, Math.max(round, p.start))) }))
    .map((e) => ({ ...e, d: e.c ? distance(e.c, near) : 999 }))
    .sort((a, b) => a.d - b.d || compareId(a.p.id, b.p.id))[0].p;
}

/** Laufende Linienplaene einer Gefechtsrunde (nach ID) */
export function activePlans(art, round) {
  return art.plans.filter((p) => PLAN_KINDS[p.kind]?.round === 'battle' && creepOffset(p, round)
    && !(p.ceasedFrom != null && round >= p.ceasedFrom)).sort((p, q) => compareId(p.id, q.id));
}

// ---------- Einschlaege ----------

/** Streuung eines Schusses: ganzzahliger Versatz, Summe dreier Wuerfe (glockenfoermig) */
export function scatter(rng, spreadTenths) {
  const s = (rng() + rng() + rng() - 1.5) * 2 * spreadTenths / 10;
  return s < 0 ? -Math.floor(-s + 0.5) : Math.floor(s + 0.5);
}

/** Einschlaege einer Salve: Zielfeld zufaellig aus cells, dann gestreut, auf die Karte begrenzt. Reihenfolge = Wurf. */
export function salvo(rng, cells, shells, spreadTenths, map) {
  const out = [];
  if (!cells.length) return out;
  for (let i = 0; i < shells; i++) {
    const c = cells[Math.floor(rng() * cells.length)];
    const x = Math.max(0, Math.min(map.width - 1, c.x + scatter(rng, spreadTenths)));
    const y = Math.max(0, Math.min(map.height - 1, c.y + scatter(rng, spreadTenths)));
    out.push({ x, y });
  }
  return out;
}

/** Einschlaege je Feld zaehlen, sortiert nach y, dann x */
export function countImpacts(impacts) {
  const m = new Map();
  for (const p of impacts) {
    const k = cellKey(p.x, p.y);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].map(([k, n]) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y, n };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function wireAt(state, map, x, y) {
  const s = getCell(state, x, y);
  if (s && Object.hasOwn(s, 'wire')) return s.wire;
  return hasTerrain(map) ? cellAt(map, x, y)?.wire ?? null : null;
}

function craterSize(state, map, x, y) {
  const s = getCell(state, x, y);
  if (s && Object.hasOwn(s, 'crater')) return s.crater | 0;
  return hasTerrain(map) ? cellAt(map, x, y)?.crater ?? 0 : 0;
}

function surname(name) {
  const i = name.indexOf(' ');
  return i < 0 ? name : name.slice(i + 1);
}

/**
 * Einschlaege auswerten (Plan 4.1 Nr. 4, 6, 8): Krater (Daten in state.cells: crater 1..2, shelled = Zahl der
 * Einschlaege, fresh = Runde), Draht zerrissen, Leitungen durchtrennt, Verluste und Unterdrueckung bei Gruppen
 * beider Seiten (Eigenbeschuss!), Batterien zum Schweigen gebracht. Unterstand schuetzt vor Verlusten.
 * firing: Seite, die schiesst. emit(type, fields). Liefert { losses, friendly, cut: [lineId], hitBatteries: [id] }.
 */
export function applyImpacts(state, map, rng, impacts, { firing, emit, turn, what, lethal = 34, suppression = 30 }) {
  const counted = countImpacts(impacts);
  const res = { losses: 0, friendly: 0, cut: [], hitBatteries: [] };
  const perGroup = new Map();
  const groups = groupsOf(state);
  for (const c of counted) {
    // Krater
    const before = getCell(state, c.x, c.y);
    const shelled = (before?.shelled ?? 0) + c.n;
    const size = Math.max(craterSize(state, map, c.x, c.y), shelled >= CRATER_BIG ? 2 : 1);
    patchCell(state, c.x, c.y, { crater: Math.min(2, size), shelled, fresh: turn });
    // Draht: jeder Einschlag reisst mit halber Chance eine Gasse
    if (wireAt(state, map, c.x, c.y)) {
      let gone = false;
      for (let i = 0; i < c.n && !gone; i++) if (rng() < 0.5) gone = true;
      if (gone) {
        patchCell(state, c.x, c.y, { wire: null });
        emit('wire_cut', { public: true, side: firing, reason: `Granaten reißen bei ${cellLabel(c.x, c.y)} eine Gasse in den Draht.`, at: { x: c.x, y: c.y } });
      }
    }
    // Feldbahn: ein Treffer auf dem Gleis bricht es (P08 liest railBroken), die Bautrupps flicken es zur naechsten Stellungsrunde
    const rail = before && Object.hasOwn(before, 'rail') ? !!before.rail : hasTerrain(map) && !!cellAt(map, c.x, c.y)?.rail;
    if (rail && !getCell(state, c.x, c.y)?.railBroken) {
      let broken = false;
      for (let i = 0; i < c.n && !broken; i++) if (rng() < 0.5) broken = true;
      if (broken) {
        patchCell(state, c.x, c.y, { railBroken: turn });
        emit('rail_broken', { public: true, side: firing, reason: `Gleis bei ${cellLabel(c.x, c.y)} zerschossen, die Loren stehen.`, at: { x: c.x, y: c.y } });
      }
    }
    // Leitungen beider Seiten
    for (const s of ['a', 'b']) {
      const art = state.sides[s].artillery;
      if (!art) continue;
      for (const l of art.lines) {
        if (l.cut || !l.cells.some((p) => p.x === c.x && p.y === c.y)) continue;
        let cut = false;
        for (let i = 0; i < c.n && !cut; i++) if (rng() * 100 < LINE_CUT) cut = true;
        if (!cut) continue;
        l.cut = { x: c.x, y: c.y };
        res.cut.push(l.id);
        emit('line_cut', {
          side: s, secret: true, line: l.id,
          reason: `Leitung zu ${l.to} bei ${cellLabel(c.x, c.y)} durchtrennt. Bis zur Reparatur gehen Befehle nur per Melder.`,
          at: { x: c.x, y: c.y },
        });
      }
      // Batterien
      for (const b of art.batteries) {
        if (c.x < b.pos.x || c.y < b.pos.y || c.x >= b.pos.x + b.w || c.y >= b.pos.y + b.h) continue;
        const lost = Math.min(b.ammo, 6 * c.n);
        b.ammo -= lost;
        b.silenced = SILENCED_ROUNDS;
        res.hitBatteries.push(b.id);
        emit('battery_hit', {
          side: s, secret: true, battery: b.id,
          reason: `${b.label} liegt unter Gegenbatteriefeuer: ${c.n} ${c.n === 1 ? 'Einschlag' : 'Einschläge'} in der Stellung, ${lost} Granaten verloren, schweigt ${SILENCED_ROUNDS} Runden.`,
          at: { x: c.x, y: c.y },
        });
      }
    }
    // Gruppen im Feld (Treffer) und daneben (nur Unterdrueckung)
    for (const g of groups) {
      if (g.status === 'lost') continue;
      const d = distance(g.pos, c);
      if (d > 1) continue;
      if (!perGroup.has(g.id)) perGroup.set(g.id, { direct: 0, near: 0 });
      const acc = perGroup.get(g.id);
      if (d === 0) acc.direct += c.n; else acc.near += c.n;
    }
  }

  for (const id of [...perGroup.keys()].sort(compareId)) {
    const g = groups.find((x) => x.id === id);
    const acc = perGroup.get(id);
    const cov = coverAt(state, map, g.pos, g.side);
    let losses = 0;
    if (!g.inDugout) {
      const p = (lethal / 100) * (1 - coverValue(cov.cover, { reversed: cov.reversed }));
      for (let i = 0; i < acc.direct; i++) {
        if (rng() < p) losses++;
        if (rng() < p / 2) losses++;
      }
    }
    losses = Math.min(g.strength, losses);
    // Erfahrungsbericht Stahlhelme (P14): Ausfaelle durch Splitter auf REPORT_EFFECTS.stahlhelme (drei Viertel, abgerundet zugunsten des Helms)
    if (losses > 1 && hasReport(state, g.side, 'stahlhelme')) losses -= Math.floor((losses * (100 - REPORT_EFFECTS.stahlhelme.artilleryLossPct) + 99) / 100);
    const before = g.suppressed;
    const supp = (acc.direct * suppression) / 100 + (acc.near * suppression) / 400;
    g.suppressed = r2(Math.min(1, g.suppressed + (g.inDugout ? supp / 2 : supp)));
    g.strength -= losses;
    g.shelled = true;
    const friendly = g.side === firing;
    res.losses += losses;
    if (friendly) res.friendly += losses;
    const pinned = g.suppressed >= PINNED && before < PINNED;
    const who = 'Gruppe ' + surname(g.leader.name);
    const hits = acc.direct ? `${acc.direct} ${acc.direct === 1 ? 'Einschlag' : 'Einschläge'} im Feld` : 'Einschläge daneben';
    const head = losses ? `${who}: ${losses} ${losses === 1 ? 'Verlust' : 'Verluste'} durch Granatfeuer` : `${who}: keine Verluste, aber Granatfeuer`;
    const tail = g.inDugout ? ', der Unterstand hält' : cov.cover !== 'open' ? `, Deckung: ${cov.label}` : ', offenes Feld';
    const own = friendly ? ` Eigene Artillerie (${what}) schießt zu kurz.` : '';
    emit(losses ? 'losses' : 'suppressed', {
      side: g.side, group: g.id, amount: losses, cause: friendly ? 'friendly_fire' : 'artillery', suppressed: g.suppressed, pinned,
      reason: `${head} (${hits})${tail}.${own}${pinned ? ' Die Gruppe ist niedergehalten.' : ''}`,
      at: { ...g.pos },
    });
    if (g.strength <= 0) {
      g.status = 'lost';
      g.strength = 0;
      state.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn, at: { ...g.pos } });
      emit('group_lost', {
        side: g.side, group: g.id, public: true,
        reason: `${who} ist im Granatfeuer aufgerieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
        at: { ...g.pos },
      });
    }
  }
  return res;
}

/**
 * Eine Batterie schiesst auf cells. Bucht Munition ab, wuerfelt Streuung und den Muendungsblitz (Aufklaerung durch
 * den Gegner). Liefert die Einschlaege (leer, wenn sie nicht schiessen kann) und einen Grund.
 */
export function fireBattery(state, map, rng, side, b, cells, { kind, adjusted = false }) {
  const art = state.sides[side].artillery;
  const fid = state.sides[side].faction;
  if (b.silenced > 0) return { impacts: [], why: `${b.label} schweigt nach Treffern in der Stellung` };
  if (b.ammo <= 0) return { impacts: [], why: `${b.label} hat sich verschossen` };
  const aim = centerOf(cells);
  const d = aim ? distance(batteryCenter(b), aim) : 0;
  if (aim && d > batteryType(b).range) return { impacts: [], why: `${b.label} reicht nicht bis ${cellLabel(aim.x, aim.y)}` };
  const n = Math.min(b.ammo, shellsPerRound(b, fid, kind));
  b.ammo -= n;
  const impacts = salvo(rng, cells, n, spreadOf(b, art, fid, { adjusted, night: !!state.night }), map);
  // Muendungsblitz: der Gegner kann die Stellung ausmachen
  const foe = state.sides[otherSide(side)].artillery;
  if (foe && !foe.known[b.id] && rng() * 100 < (state.night ? FLASH_SPOT.night : FLASH_SPOT.day)) {
    foe.known[b.id] = { pos: { ...b.pos }, w: b.w, h: b.h, type: b.type, turn: state.turn, label: b.label };
    b.spotted = true;
  }
  return { impacts, why: '', shells: n };
}

// ---------- Sturm hinter der Walze (Editor-Vorschau) ----------

function mergedCell(state, map, x, y) {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const s = getCell(state, x, y);
  return s ? { ...c, ...s } : c;
}

/**
 * Geister der Sturmgruppen hinter einer Walze (Plan 7.4): eigene Schuetzen und Pioniere, die hinter der Startlinie
 * liegen, folgen der Walze geradeaus in Planrichtung, so schnell es Boden, Krater und Draht erlauben, aber hoechstens
 * bis ein Feld hinter den Einschlaegen. Liefert [{ group, steps: [{ round, pos, gap, inFire }], lag, warn }].
 *   gap: Felder zwischen Gruppe und Walze, inFire: Gruppe steht in den Einschlaegen (Eigenbeschuss).
 *   lag: Abstand, wenn die Walze aufhoert. warn: deutscher Satz oder ''.
 */
export function stormGhosts(map, state, side, plan) {
  const k = PLAN_KINDS[plan.kind];
  if (!k?.line || !hasTerrain(map)) return [];
  if (!plan.step) plan = { ...plan, step: 0 };
  const d = DIR[plan.dir] ?? DIR.E;
  const line = baseLine(plan);
  const out = [];
  // Projektion: along = Abstand in Planrichtung, across = seitlich
  const along = (p) => (p.x - plan.a.x) * d.dx + (p.y - plan.a.y) * d.dy;
  const acrossOf = (p) => (p.x * -d.dy + p.y * d.dx);
  const acr = line.map(acrossOf);
  const lo = Math.min(...acr) - 1, hi = Math.max(...acr) + 1;
  for (const g of groupsOf(state, side)) {
    if (g.type !== 'rifles' && g.type !== 'pioneers' && g.type !== 'stormtroops') continue;
    const a0 = along(g.pos);
    const ac = acrossOf(g.pos);
    if (ac < lo || ac > hi || a0 < -12 || a0 > plan.step * plan.rounds + 2) continue;
    const budget = unitType(g.type).speed * 10;
    let pos = { ...g.pos };
    const steps = [];
    for (let r = plan.start; r < plan.start + plan.rounds; r++) {
      const fire = planCellsAt(plan, r, map);
      if (!fire.length) break; // Walze hat die Karte verlassen
      const front = Math.min(...fire.map(along));
      // bis ein Feld vor die Einschlaege
      let left = budget;
      for (;;) {
        const next = { x: pos.x + d.dx, y: pos.y + d.dy };
        if (along(next) > front - 1) break;
        const c = mergedCell(state, map, next.x, next.y);
        if (!c) break;
        const cost = enterCost(c);
        // Teures Feld (Draht): kostet die ganze Runde, sonst kaeme die Gruppe nie hinueber
        if (!Number.isFinite(cost) || (cost > left && left < budget)) break;
        left -= Math.min(cost, left);
        pos = next;
      }
      const inFire = fire.some((c) => c.x === pos.x && c.y === pos.y);
      steps.push({ round: r, pos: { ...pos }, gap: front - along(pos), inFire });
    }
    const last = steps[steps.length - 1];
    const lag = last ? last.gap : 0;
    const name = 'Gruppe ' + surname(g.leader.name);
    let warn = '';
    const hit = steps.find((s) => s.inFire);
    if (hit && hit.round === plan.start) warn = `${name} liegt in der ersten Welle der Einschläge`;
    else if (hit) warn = `${name} liegt in Runde ${hit.round} in der eigenen Walze`;
    else if (lag > 3) warn = `${name} liegt ${lag} Felder zurück, wenn die Walze aufhört`;
    out.push({ group: g.id, steps, lag, warn });
  }
  return out;
}

// Richtung von a nach b fuer Begruendungen ("aus Südwest")
export function fromDirection(target, source) {
  const dir = directionOf(target, source);
  return dir ? dir.name : 'der Nähe';
}

export { DIRS };
