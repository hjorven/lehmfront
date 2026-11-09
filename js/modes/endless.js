// Endlosmodus "Frontabschnitt" und Wochenlage (P22, Plan 8.3).
// Derselbe Abschnitt, dieselben Leute, Wochen als Zyklen: eine Woche = 14 Stellungsrunden plus die Angriffe, die
// sich daraus ergeben. Pro Woche ein generierter Stabsbefehl mit Ansehensfolgen, alle sechs Wochen eine neue
// Jahreszeit, der Gegner wird jede Woche staerker, der Ersatz haengt am Ansehen. Ende, wenn der Abschnitt faellt,
// die Kommandantin abgeloest wird oder die Truppe meutert. Wochenlage: vier Wochen mit festem Seed.
//
// Rein: kein DOM, kein Date, kein Math.random. Der Lauf ist reines JSON und erweitert den Kampagnenzustand
// (newCampaign aus js/campaign.js), damit Achsen, Stempel, Berichte und Buch des Abschnitts dieselben Regeln haben:
//   { ...Kampagne, mode: 'endlos'|'wochenlage', key, map, mapSeed, week, order, base, score, weeks: [...],
//     ended: null|'abschnitt_gefallen'|'abgeloest'|'meuterei'|'wochenlage', endWeek }
// Der Spielzustand traegt state.endless = { week, startHours, arrivals, reinforced } (Wochenbeginn, Ankuenfte).
import { createRng } from '../rng.js';
import {
  newCampaign, normalizeCampaign, missionAxes, missionCounts, countReports, stampOrder, stampCost, LIMITS, supplyPct, batteryPct, replacementsFor,
} from '../campaign.js';
import { groundHeld } from '../ai/match.js';
import { cellLabel } from '../map.js';
import { makeGroup, byId } from '../state.js';
import { freeRestCell } from '../morale.js';
import { SEASONS, SEASON_IDS } from '../config/seasons.js';
import { DEFAULT_INCOME } from '../config/supply.js';
import { REPLACEMENTS_CAP } from '../config/morale.js';
import { rollCasualties, groupInfoFrom } from '../narrative/casualties.js';
import { fill, hashText } from '../narrative/texts.js';
import { tallyLog, emptyTally, dailySeed, dayLabel } from './skirmish.js';

export const WEEK_ROUNDS = 14;
export const SEASON_WEEKS = 6;
export const WOCHENLAGE_WEEKS = 4;
/** Punkte nach Plan 8.3 */
export const SCORE = { week: 100, field: 5, rescued: 2, fallen: -3 };
/** Der Abschnitt faellt, wenn der Gegner so viel eigenen Feuergraben haelt (Anteil in Prozent, mindestens 4 Felder) */
export const FALL_PCT = 40;
export const ORDER_KINDS = ['halten', 'feld_nehmen', 'stosstrupp', 'gefangene', 'graben_zuruecknehmen'];
/** Gefangene, die ein Gefangenen-Befehl verlangt (Text "MINDESTENS ZWEI"), sonst einer */
const PRISONERS_NEED = { 'endlos.befehl.gefangene.1': 2 };

const clamp = (v) => Math.max(0, Math.min(100, Math.trunc(v)));
const mix = (...parts) => hashText(parts.join('|'));

// ------------------------------------------------------------------ Kalender

/** Jahreszeit einer Woche: Sommer, Herbst, Winter, Fruehling, je sechs Wochen, dann von vorn */
export function seasonOf(week) {
  return SEASON_IDS[Math.floor((Math.max(1, week) - 1) / SEASON_WEEKS) % SEASON_IDS.length];
}

/** Erste Woche einer neuen Jahreszeit (nicht Woche 1) */
export function isSeasonStart(week) {
  return week > 1 && (week - 1) % SEASON_WEEKS === 0;
}

/** Akt fuer Gebaeude und Berichte: die Jahreszeiten laufen wie die Akte der Kampagne (Sommer = Akt 1), hoechstens 4 */
export function actOfWeek(week) {
  return 1 + Math.min(3, Math.floor((Math.max(1, week) - 1) / SEASON_WEEKS));
}

/** Gegner je Woche: erst Rekruten, dann Veteranen, ab Woche 8 Lask selbst */
export function enemyDifficulty(week) {
  if (week <= 2) return 'rekrut';
  if (week <= 7) return 'veteran';
  return 'lask';
}

/** Wie stark drueben nachgeschoben wird: Erfahrung, zusaetzliche Gruppen, Munition der Batterien in Prozent */
export function enemyPressure(week) {
  const w = Math.max(1, week);
  return {
    experience: Math.min(4, 1 + Math.floor((w - 1) / 3)),
    extraGroups: Math.min(6, Math.floor((w - 1) / 2)),
    ammoPct: Math.min(200, 100 + 10 * (w - 1)),
    morale: Math.min(85, 65 + 2 * (w - 1)),
  };
}

/** Ganze Ersatzgruppen fuer aufgeriebene eigene Gruppen je Woche: ab Ansehen 35 eine, ab 70 zwei */
export function groupReplacementsFor(ansehen) {
  if (ansehen >= 70) return 2;
  if (ansehen >= 35) return 1;
  return 0;
}

// ------------------------------------------------------------------ Lauf

/**
 * Neuer Lauf. opts: { mode: 'endlos'|'wochenlage', faction, map: 'zufall'|Karten-ID, mapSeed, seed, key? }
 */
export function newRun({ mode = 'endlos', faction = 'kaldern', map = 'zufall', mapSeed = 1, seed = 1, key = null } = {}) {
  const c = newCampaign({ side: 'a', faction, seed: seed >>> 0 });
  return {
    ...c,
    mission: 'w1',
    mode: mode === 'wochenlage' ? 'wochenlage' : 'endlos',
    key,
    map,
    mapSeed: mapSeed >>> 0,
    week: 1,
    order: null,
    base: null,
    score: { weeks: 0, gained: 0, rescued: 0, fallen: 0, points: 0 },
    weeks: [],
    ended: null,
    endWeek: null,
  };
}

/** Fehlende Felder nachtragen (aelterer Speicherstand) */
export function normalizeRun(run) {
  const n = newRun({});
  const out = normalizeCampaign(run);
  for (const [k, v] of Object.entries(n)) if (out[k] === undefined) out[k] = structuredClone(v);
  return out;
}

/** Punkte eines Laufs nach Plan 8.3 */
export function pointsOf(score) {
  return score.weeks * SCORE.week + score.gained * SCORE.field + score.rescued * SCORE.rescued + score.fallen * SCORE.fallen;
}

/** Punkte als Zeilen (fuer Tabellen) */
export function scoreParts(score) {
  return [
    { id: 'weeks', label: 'Wochen gehalten', count: score.weeks, per: SCORE.week },
    { id: 'gained', label: 'Grabenfelder gewonnen', count: score.gained, per: SCORE.field },
    { id: 'rescued', label: 'Verwundete geborgen', count: score.rescued, per: SCORE.rescued },
    { id: 'fallen', label: 'Gefallene', count: score.fallen, per: SCORE.fallen },
  ];
}

/** Wie viele Wochen hat der Lauf (Wochenlage: vier, Endlos: offen) */
export function weekLimit(run) {
  return run.mode === 'wochenlage' ? WOCHENLAGE_WEEKS : 0;
}

/** Grundwerte aus dem Anfangszustand (Nachschub, Batteriemunition beider Seiten), einmal je Lauf */
export function baseOf(state) {
  const ammo = {};
  for (const side of ['a', 'b']) {
    ammo[side] = {};
    for (const b of state.sides[side]?.artillery?.batteries ?? []) if (Number.isFinite(b.ammo)) ammo[side][b.id] = b.ammo;
  }
  return { income: { ...DEFAULT_INCOME, ...(state.sides.a?.supplies?.income ?? {}) }, ammo };
}

/**
 * Wochenlage (Plan 8): vier Wochen mit festem Seed, fuer alle gleich. key = JJJJMMTT des Montags der Woche.
 * Liefert die Wahl fuer newRun: { mode, key, faction, map, mapSeed, seed, label }.
 */
export function wochenlageBrief(key) {
  const seed = (dailySeed(key) ^ 0x3c6ef372) >>> 0 || 1;
  const rng = createRng(seed);
  const faction = rng() < 0.5 ? 'kaldern' : 'morrow';
  const mapSeed = 1 + Math.floor(rng() * 99999);
  return { mode: 'wochenlage', key, faction, map: 'zufall', mapSeed, seed, label: 'Woche ab ' + dayLabel(key) };
}

// ------------------------------------------------------------------ Graeben

const mapSide = (side) => (side === 'a' ? 'own' : 'enemy');

/** Wem gehoert der Graben auf einem Feld gerade (Zustand vor Karte)? 'own' | 'enemy' | null */
export function trenchSideAt(state, map, x, y) {
  const live = state.cells?.[x + ',' + y]?.trench;
  if (live) return live.side ?? null;
  return map.cells[y * map.width + x]?.trench?.side ?? null;
}

/** Feuergrabenfelder einer Kartenseite (urspruenglich), vorderste je Reihe */
function frontCells(map, ms) {
  const best = new Map();
  for (const c of map.cells) {
    if (!c.trench || c.trench.side !== ms || c.trench.kind !== 'fire') continue;
    const fwd = ms === 'own' ? c.x : -c.x;
    const prev = best.get(c.y);
    if (!prev || fwd > prev.fwd) best.set(c.y, { x: c.x, y: c.y, fwd });
  }
  return [...best.values()].sort((p, q) => p.y - q.y).map(({ x, y }) => ({ x, y }));
}

/** Eigene Feuergrabenfelder (urspruenglich), Zahl fuer die Grenze "Abschnitt gefallen" */
export function ownFireCells(map, side = 'a') {
  const ms = mapSide(side);
  return map.cells.filter((c) => c.trench && c.trench.side === ms && c.trench.kind === 'fire').length;
}

/** Ab so vielen verlorenen eigenen Grabenfeldern ist der Abschnitt gefallen */
export function fallLimit(map, side = 'a') {
  return Math.max(4, Math.ceil((ownFireCells(map, side) * FALL_PCT) / 100));
}

// ------------------------------------------------------------------ Stabsbefehl

/** Befehlsart der Woche: Woche 1 halten, verlorener Graben will zurueck, sonst nach Zufall */
export function orderKindFor(run, { lost = 0, rng }) {
  if (run.week <= 1) return 'halten';
  if (run.ansehen < LIMITS.THREAT) return 'halten';
  const r = Math.floor(rng() * 100);
  if (lost > 0 && r < 60) return 'graben_zuruecknehmen';
  if (r < 30) return 'halten';
  if (r < 55) return 'feld_nehmen';
  if (r < 78) return 'stosstrupp';
  return 'gefangene';
}

/**
 * Stabsbefehl einer Woche aus den Texten (data/texts/endlos.json).
 * entries: alle Texteintraege (oder nur endlos-befehl und endlos-stab), state: Zustand zu Wochenbeginn.
 * Liefert { id, befehlsart, titel, eilt, folgen, text, frist, von, unterschrift, target, need, week, nr }.
 */
export function generateOrder(entries, run, state, map) {
  const rng = createRng(mix(run.seed, 'befehl', run.week));
  const own = frontCells(map, 'own');
  const foe = frontCells(map, 'enemy');
  const lostCells = map.cells
    .filter((c) => c.trench && c.trench.side === 'own' && trenchSideAt(state, map, c.x, c.y) === 'enemy')
    .map((c) => ({ x: c.x, y: c.y }))
    .sort((p, q) => p.y - q.y || p.x - q.x);
  const kind = orderKindFor(run, { lost: lostCells.length, rng });
  const margin = Math.min(3, Math.floor(map.height / 8));
  const inner = (list) => {
    const mid = list.filter((p) => p.y >= margin && p.y < map.height - margin);
    return mid.length ? mid : list;
  };
  // Ziel: fuer Angriffe ein Feld der feindlichen Linie, das drueben noch gehalten wird; fuer Halten ein eigenes
  let target = null;
  if (kind === 'graben_zuruecknehmen') target = lostCells[Math.floor(rng() * lostCells.length) % lostCells.length] ?? null;
  else if (kind === 'halten') {
    const list = inner(own.filter((p) => trenchSideAt(state, map, p.x, p.y) === 'own'));
    target = list.length ? list[Math.floor(rng() * list.length) % list.length] : null;
  } else {
    const list = inner(foe.filter((p) => trenchSideAt(state, map, p.x, p.y) === 'enemy'));
    target = list.length ? list[Math.floor(rng() * list.length) % list.length] : null;
  }
  const short = run.ansehen < LIMITS.THREAT;
  const pool = entries
    .filter((e) => e.art === 'endlos-befehl' && e.befehlsart === kind)
    .filter((e) => (short ? e.id === 'endlos.befehl.knapp' : !e.wann))
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const e = pool[Math.floor(rng() * pool.length) % pool.length] ?? {
    id: 'endlos.befehl.ersatz', befehlsart: 'halten', titel: 'Halten', frist: 'ENDE WOCHE {woche}', eilt: false,
    text: 'WOCHE {woche} STOP HALTEN STOP {stab} STOP', folgen: { erfuellt: { ansehen: 4 }, verfehlt: { ansehen: -8 } },
  };
  const stab = entries.find((x) => x.art === 'endlos-stab' && x.fraktion === run.faction) ?? { von: 'STAB', text: 'STAB' };
  const feld = target ? cellLabel(target.x, target.y) : 'IM ABSCHNITT';
  const frist = fill(e.frist ?? 'ENDE WOCHE {woche}', { woche: run.week });
  const values = { woche: run.week, feld, frist: fill('ENDE WOCHE {woche}', { woche: run.week }), stab: stab.text };
  return {
    id: e.id,
    befehlsart: e.befehlsart ?? kind,
    titel: e.titel ?? 'Stabsbefehl',
    eilt: !!e.eilt,
    folgen: structuredClone(e.folgen ?? {}),
    text: fill(e.text, values),
    frist: frist.includes('{') ? values.frist : frist,
    von: stab.von,
    unterschrift: stab.text,
    target: target ? { x: target.x, y: target.y } : null,
    feld,
    need: kind === 'gefangene' ? PRISONERS_NEED[e.id] ?? 1 : 0,
    week: run.week,
    nr: `W${run.week}`,
  };
}

const near = (a, b, d) => a && b && Math.abs(a.x - b.x) <= d && Math.abs(a.y - b.y) <= d;

/**
 * Ist der Stabsbefehl der Woche erfuellt? input: { start, end, rounds, map, side }
 * Liefert { met, why } mit deutscher Begruendung.
 */
export function judgeOrder(order, { start, end, rounds = [], map, side = 'a' }) {
  if (!order) return { met: true, why: 'Kein Befehl.' };
  const foe = side === 'a' ? 'b' : 'a';
  const alive = end.groups.some((g) => g.side === side && g.status !== 'lost');
  if (!alive) return { met: false, why: 'Der Abschnitt ist aufgerieben.' };
  const t = order.target;
  const ms = mapSide(side);
  const holds = () => t && (trenchSideAt(end, map, t.x, t.y) === ms
    || end.groups.some((g) => g.side === side && g.status !== 'lost' && g.pos.x === t.x && g.pos.y === t.y));
  switch (order.befehlsart) {
    case 'feld_nehmen':
      return holds() ? { met: true, why: `Feld ${order.feld} ist genommen und gehalten.` } : { met: false, why: `Feld ${order.feld} ist nicht in eigener Hand.` };
    case 'graben_zuruecknehmen':
      return holds() ? { met: true, why: `Feld ${order.feld} ist zurückgenommen.` } : { met: false, why: `Feld ${order.feld} ist weiter drüben in der Hand des Gegners.` };
    case 'gefangene': {
      const n = missionCounts(rounds, side).prisoners;
      const need = Math.max(1, order.need ?? 1);
      return n >= need ? { met: true, why: `${n} Gefangene eingebracht.` } : { met: false, why: n ? `Nur ${n} von ${need} Gefangenen eingebracht.` : 'Keine Gefangenen eingebracht.' };
    }
    case 'stosstrupp': {
      const hit = rounds.some((r) => (r.log ?? []).some((e) => e.side === side
        && (e.type === 'melee' || e.type === 'breach') && near(e.cell ?? e.at, t, 2)));
      const caught = rounds.some((r) => (r.log ?? []).some((e) => e.side === foe && e.type === 'group_captured' && near(e.at, t, 3)));
      return hit || caught ? { met: true, why: `Der Stoßtrupp war bei Feld ${order.feld} im Graben.` } : { met: false, why: `Bei Feld ${order.feld} war niemand drüben im Graben.` };
    }
    default: {
      const before = groundHeld(start, map, foe), after = groundHeld(end, map, foe);
      return after <= before ? { met: true, why: 'Kein Feld aufgegeben.' } : { met: false, why: `${after - before} ${after - before === 1 ? 'Grabenfeld' : 'Grabenfelder'} an den Gegner verloren.` };
    }
  }
}

// ------------------------------------------------------------------ Woche vorbereiten

/** Abschnittsbeginn in Stunden (Tag mal 24 plus Stunde), daraus zaehlt die Woche ihre Stellungsrunden */
export const hoursOf = (clock) => (clock?.day ?? 1) * 24 + (clock?.hour ?? 0);

/** Gespielte Stellungsrunden dieser Woche (aus der Uhr: eine Stellungsrunde = 12 Stunden) */
export function weekRounds(state) {
  const start = state.endless?.startHours ?? hoursOf(state.clock);
  return Math.max(0, Math.floor((hoursOf(state.clock) - start) / 12));
}

/** Ist die Woche um? Ein laufendes Gefecht wird noch zu Ende gefuehrt. */
export function weekOver(state) {
  return weekRounds(state) >= WEEK_ROUNDS && state.turnKind === 'position';
}

const REINFORCE_TYPES = ['rifles', 'stormtroops', 'mg', 'rifles', 'mortar', 'pioneers'];

function nextId(state, side) {
  let n = 0;
  for (const g of state.groups) {
    if (g.side !== side) continue;
    const m = /^[ab](\d+)$/.exec(g.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return side + String(n + 1).padStart(2, '0');
}

/**
 * Zustand fuer den Beginn einer Woche (nach finishWeek oder fuer Woche 1 aus dem Anfangszustand).
 * Jahreszeit und Akt, Ansehen und Vertrauen, Nachschub und Batteriemunition nach Ansehen, Ersatz, ganze
 * Ersatzgruppen fuer aufgeriebene, und drueben: aufgefuellt, erfahrener, mehr Gruppen, mehr Munition.
 * Liefert einen neuen Zustand mit state.endless = { week, startHours, arrivals, reinforced }.
 */
export function prepareWeek(state, run, map) {
  const s = structuredClone(state);
  const week = run.week;
  const base = run.base ?? baseOf(state);
  const rng = createRng(mix(run.seed, 'woche', week));
  const season = seasonOf(week);
  const act = actOfWeek(week);
  s.act = act;
  s.result = null;
  s.weather = { ...(s.weather ?? {}), season };
  const used = new Set(s.groups.map((g) => g.leader?.name).filter(Boolean));

  // Eigene Seite: Achsen und ihre Wirkungen (Nachschub nicht doppelt: immer von den Grundwerten aus)
  const a = s.sides.a;
  a.reputation = clamp(run.ansehen);
  a.trust = clamp(run.vertrauen);
  a.reports = [...(run.reports ?? [])].sort();
  delete a.mutiny;
  const sp = supplyPct(run.ansehen), bp = batteryPct(run.ansehen);
  a.campaign = { mission: 'w' + week, supplyPct: sp, batteryPct: bp, act, refuse: run.vertrauen < LIMITS.REFUSE && act >= 4 };
  a.supplies = { ...(a.supplies ?? {}) };
  a.supplies.income = Object.fromEntries(Object.keys(base.income).sort().map((k) => [k, Math.floor((base.income[k] * sp) / 100)]));
  for (const b of a.artillery?.batteries ?? []) {
    const full = Math.floor(((base.ammo.a?.[b.id] ?? b.ammo ?? 0) * bp) / 100);
    if (Number.isFinite(b.ammo)) b.ammo = Math.max(b.ammo, full);
  }
  const men = Math.min(REPLACEMENTS_CAP, replacementsFor(run.ansehen));
  a.replacements = { tenths: Math.min(REPLACEMENTS_CAP * 10, (a.replacements?.tenths ?? 0) + men * 10) };

  for (const g of s.groups) g.since ??= 1;
  const arrivals = [];
  if (week > 1) {
    const lost = s.groups.filter((g) => g.side === 'a' && g.status === 'lost' && !g.replaced).sort(byId);
    const taken = new Set();
    for (const g of lost.slice(0, groupReplacementsFor(run.ansehen))) {
      const spot = freeRestCell(map, s, 'a', null, taken);
      if (!spot) break;
      taken.add(spot.cell.x + ',' + spot.cell.y);
      const id = nextId(s, 'a');
      const fresh = makeGroup(rng, 'a', a.faction, { type: g.type, pos: spot.cell, experience: 0, morale: 60, status: spot.camp ? 'rest' : 'reserve' }, id, used);
      if (spot.camp) fresh.restAt = { ...spot.cell };
      fresh.since = week;
      fresh.replaces = g.id;
      g.replaced = id;
      s.groups.push(fresh);
      arrivals.push({ id, type: fresh.type, leader: fresh.leader.name, replaces: g.id });
    }
  }

  // Drueben: jede Woche frisch aufgefuellt und erfahrener, alle zwei Wochen eine Gruppe mehr
  const p = enemyPressure(week);
  const bSide = s.sides.b;
  for (const b of bSide.artillery?.batteries ?? []) {
    const full = Math.floor(((base.ammo.b?.[b.id] ?? b.ammo ?? 0) * p.ammoPct) / 100);
    if (Number.isFinite(b.ammo)) b.ammo = Math.max(b.ammo, full);
  }
  let reinforced = 0;
  if (week > 1) {
    for (const g of s.groups) {
      if (g.side !== 'b' || g.status === 'lost') continue;
      g.strength = Math.max(g.strength, g.size ?? g.strength);
      g.experience = Math.max(g.experience ?? 1, p.experience);
      g.morale = Math.max(g.morale ?? 60, p.morale);
      g.fatigue = Math.min(g.fatigue ?? 0, 20);
    }
    const lostB = s.groups.filter((g) => g.side === 'b' && g.status === 'lost' && !g.replaced).sort(byId);
    const extra = s.groups.filter((g) => g.side === 'b' && g.extra).length;
    const wants = [...lostB.map((g) => ({ type: g.type, replaces: g })),
      ...REINFORCE_TYPES.slice(extra, p.extraGroups).map((type) => ({ type, replaces: null }))];
    const taken = new Set();
    for (const w of wants) {
      const spot = freeRestCell(map, s, 'b', null, taken);
      if (!spot) break;
      taken.add(spot.cell.x + ',' + spot.cell.y);
      const id = nextId(s, 'b');
      const g = makeGroup(rng, 'b', bSide.faction, { type: w.type, pos: spot.cell, experience: p.experience, morale: p.morale, status: spot.camp ? 'rest' : 'reserve' }, id, used);
      if (spot.camp) g.restAt = { ...spot.cell };
      g.since = week;
      if (w.replaces) { w.replaces.replaced = id; g.replaces = w.replaces.id; } else g.extra = true;
      s.groups.push(g);
      reinforced++;
    }
  }
  s.groups.sort(byId);
  s.endless = { week, startHours: hoursOf(s.clock), arrivals, reinforced, season };
  return s;
}

// ------------------------------------------------------------------ Woche abschliessen

/** An Wunden Gestorbene einer Seite insgesamt (state.fallen) */
function diedOfWounds(state, side) {
  return (state?.fallen ?? []).filter((f) => f.side === side && f.cause === 'wounds').reduce((n, f) => n + (f.count ?? 1), 0);
}

/**
 * Ende einer Woche buchen. input: { start (Zustand zu Wochenbeginn), end, rounds (Archiv dieser Woche), map }
 * Liefert { run, record, changes, judged, casualties }. run.week ist danach die naechste Woche (ausser am Ende).
 */
export function finishWeek(runIn, { start, end, rounds = [], map }) {
  const run = normalizeRun(runIn);
  const side = 'a', foe = 'b';
  const week = run.week;
  const wk = 'w' + week;
  let tally = emptyTally();
  for (const r of rounds) tally = tallyLog(tally, r.log ?? [], {});
  const counts = missionCounts(rounds, side);
  const judged = judgeOrder(run.order, { start, end, rounds, map, side });
  const stamp = run.stamps?.[wk] ?? 'befolgen';
  const changes = missionAxes({
    rounds, side, faction: run.faction, outcome: judged.met ? 'sieg' : 'niederlage', order: run.order, orderMet: judged.met, stamp,
    start: { reputation: start.sides[side]?.reputation ?? run.ansehen, trust: start.sides[side]?.trust ?? run.vertrauen },
    end: { reputation: end.sides[side]?.reputation ?? 50, trust: end.sides[side]?.trust ?? 50 },
  });
  for (const ch of changes) run[ch.axis] = clamp(run[ch.axis] + ch.amount);
  run.ledger.push({ mission: wk, stage: 'woche', outcome: judged.met ? 'sieg' : 'niederlage', changes });
  run.outcomes[wk] = judged.met ? 'sieg' : 'niederlage';

  // Punkte nach Plan 8.3
  const alive = end.groups.some((g) => g.side === side && g.status !== 'lost');
  const lostStart = groundHeld(start, map, foe), lostEnd = groundHeld(end, map, foe);
  const limit = fallLimit(map, side);
  const fell = !alive || lostEnd >= limit;
  const held = !fell && lostEnd - lostStart < 3;
  const gained = Math.max(0, groundHeld(end, map, side) - groundHeld(start, map, side));
  const carried = (st) => st?.sides?.[side]?.supply?.stats?.woundedCarried ?? 0;
  const rescued = Math.max(0, carried(end) - carried(start));
  const fallen = Math.max(0, tally.losses[side] - tally.wounded[side]) + Math.max(0, diedOfWounds(end, side) - diedOfWounds(start, side));
  run.score.weeks += held ? 1 : 0;
  run.score.gained += gained;
  run.score.rescued += rescued;
  run.score.fallen += fallen;
  run.score.points = pointsOf(run.score);

  // Namen der Woche ins Buch des Abschnitts
  const casualties = rollCasualties(rounds, {
    side, faction: run.faction, seed: run.seed, mission: wk, groups: groupInfoFrom(end, side, run.faction),
    used: run.book.fallen.map((f) => f.name),
  });
  for (const f of casualties.fallen) run.book.fallen.push({ name: f.name, home: f.home ?? '', groupLabel: f.groupLabel ?? '', causeText: f.causeText ?? '', mission: wk, missionTitle: `Woche ${week}` });

  // Erfahrungsberichte laufen ueber alle Wochen
  const rep = countReports(run, rounds, side, actOfWeek(week));
  Object.assign(run, { counters: rep.campaign.counters, reports: rep.campaign.reports, withheld: rep.campaign.withheld });
  const reached = [];
  for (const id of rep.reached) {
    if (run.ansehen < LIMITS.THREAT) { if (!run.withheld.includes(id)) run.withheld.push(id); } else if (!run.reports.includes(id)) { run.reports.push(id); reached.push(id); }
  }
  if (run.ansehen >= LIMITS.THREAT && run.withheld.length) {
    for (const id of run.withheld.slice().sort()) if (!run.reports.includes(id)) { run.reports.push(id); reached.push(id); }
    run.withheld = [];
  }

  // Ende?
  const mutiny = counts.mutiny || !!end.sides[side]?.mutiny || run.vertrauen < LIMITS.MUTINY;
  let ended = null;
  if (fell) ended = 'abschnitt_gefallen';
  else if (mutiny) ended = 'meuterei';
  else if (run.ansehen < LIMITS.RELIEF) ended = 'abgeloest';
  else if (weekLimit(run) && week >= weekLimit(run)) ended = 'wochenlage';

  const record = {
    week, season: seasonOf(week), stamp,
    order: run.order ? { id: run.order.id, befehlsart: run.order.befehlsart, titel: run.order.titel, feld: run.order.feld, met: judged.met, why: judged.why } : null,
    held, fell, gained, rescued, fallen, lostGround: lostEnd,
    names: casualties.fallen.map((f) => f.name),
    wounded: casualties.wounded.length,
    ansehen: run.ansehen, vertrauen: run.vertrauen, points: run.score.points,
    reports: reached,
    enemy: { difficulty: enemyDifficulty(week), groups: end.groups.filter((g) => g.side === foe && g.status !== 'lost').length },
  };
  run.weeks.push(record);
  run.history.push({ mission: wk, ansehen: run.ansehen, vertrauen: run.vertrauen, outcome: judged.met ? 'sieg' : 'niederlage' });
  if (ended) {
    run.ended = ended;
    run.endWeek = week;
  } else {
    run.week = week + 1;
    run.mission = 'w' + run.week;
    run.order = null;
  }
  return { run, record, changes, judged, casualties };
}

/**
 * Stempel auf den Stabsbefehl der laufenden Woche (befolgen, umdeuten, verweigern): sofortige Folgen wie in der
 * Kampagne (stampOrder), ein Stempel je Woche. Faellt das Ansehen dabei unter 10, ist der Lauf vorbei.
 */
export function stampWeek(run, stamp) {
  const c = stampOrder(run, 'w' + run.week, stamp, run.order);
  const map = { vorzeitig_abgeloest: 'abgeloest', vorzeitig_meuterei: 'meuterei' };
  const ended = map[c.ended] ?? c.ended ?? null;
  return { ...c, ended, endWeek: ended && !run.ended ? run.week : c.endWeek ?? null };
}
export { stampCost };

/** Ende pruefen, nachdem ein Stempel Ansehen gekostet hat (verweigern kann unter 10 druecken) */
export function checkRunEnd(run) {
  const r = structuredClone(run);
  if (r.ended) return r;
  if (r.ansehen < LIMITS.RELIEF) { r.ended = 'abgeloest'; r.endWeek = r.week; }
  else if (r.vertrauen < LIMITS.MUTINY) { r.ended = 'meuterei'; r.endWeek = r.week; }
  return r;
}

/** Die Leute des Abschnitts: lebende eigene Gruppen mit Fuehrer, Staerke und seit wann sie da sind */
export function rosterOf(state, run) {
  const unit = run.faction === 'morrow' ? 'Rotte' : 'Gruppe';
  const own = state.groups.filter((g) => g.side === 'a').sort(byId);
  return own.map((g, i) => ({
    id: g.id, label: `${i + 1}. ${unit}`, type: g.type, leader: g.leader?.name ?? '', home: g.leader?.home ?? '',
    strength: g.strength, size: g.size ?? g.strength, since: g.since ?? 1, lost: g.status === 'lost', replaces: g.replaces ?? null,
    weeks: Math.max(1, (run.endWeek ?? run.week) - (g.since ?? 1) + 1),
  })).filter((r) => !r.lost);
}
