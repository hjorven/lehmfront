// Moral, Erschoepfung, Abloesung, Ersatz (Plan 4.1 Nr. 12, 2.2, 2.6, 5). Reine Formeln, ohne Zustand zu veraendern.
// Rein: kein DOM, kein Date, kein Math.random, nur Grundrechenarten. Die Phasen stehen in js/phases/morale.js.
//
// Posten einer Gruppe (postOf):
//   'front'   in der eigenen Stellung, im Niemandsland oder beim Gegner: erschoepft sich, zaehlt frontTurns
//   'reserve' in der eigenen Etappe: erholt sich langsam, Moral nur bis MORALE_RESERVE_CAP
//   'rest'    im Ruhelager (g.status === 'rest', steht auf g.restAt): erholt sich schnell, kann aufgefuellt werden
import * as C from './config/morale.js';
import { faction } from './config/factions.js';
import { sectionsOf, mapSide } from './supply.js';
import { plotCells, isBuilt } from './etappe-map.js';

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round = (v) => Math.floor(v + 0.5);

function mapCell(map, x, y) {
  return map && x >= 0 && y >= 0 && x < map.width && y < map.height ? map.cells[y * map.width + x] : null;
}

/** Posten einer Gruppe: 'front' | 'reserve' | 'rest' | 'lost' */
export function postOf(map, g) {
  if (!g || g.status === 'lost') return 'lost';
  // Ruhe gilt nur auf dem Platz im Ruhelager; wer weggeht (auch im Gefecht), steht wieder nach Ort
  if (g.status === 'rest' && (!g.restAt || (g.restAt.x === g.pos.x && g.restAt.y === g.pos.y))) return 'rest';
  const c = mapCell(map, g.pos.x, g.pos.y);
  if (c && c.zone === 'etappe' && c.side === mapSide(g.side)) return 'reserve';
  return 'front';
}

/** Fraktionswerte (Plan 2.2): Kaldern bricht schneller ein und erholt sich schneller, Morrow umgekehrt */
export function moraleFactors(state, side) {
  const f = faction(state.sides[side]?.faction ?? 'kaldern');
  return { breakFactor: f.morale?.breakFactor ?? 1, recovery: f.morale?.recovery ?? 1, replacements: f.replacements ?? { speed: 1, groupSize: 1 } };
}

// ------------------------------------------------------------------ Erschoepfung

/** Erschoepfung, die eine Gruppe vorn in einer Runde dazubekommt */
export function fatigueGain(kind, { moved = false } = {}) {
  if (kind === 'battle') return C.FATIGUE_BATTLE + (moved ? C.FATIGUE_BATTLE_MOVE : 0);
  return C.FATIGUE_FRONT;
}

/** Erholung von der Erschoepfung je Stellungsrunde. erholung = Etappenertrag (Ruhelager, Kueche daneben) */
export function fatigueRecovery(post, { erholung = 0, camp = true } = {}) {
  if (post === 'reserve') return C.FATIGUE_RESERVE;
  if (post === 'rest') return camp ? C.FATIGUE_REST + C.FATIGUE_REST_PER_YIELD * Math.max(0, erholung) : C.FATIGUE_REST_NO_CAMP;
  return 0;
}

/** Grabgeschwindigkeit in Prozent je nach Erschoepfung: bis FATIGUE_DIG_FREE voll, darueber halb so schnell fallend */
export function digFatiguePct(fatigue) {
  const f = clamp(fatigue | 0, 0, 100);
  return 100 - Math.floor(Math.max(0, f - C.FATIGUE_DIG_FREE) / 2);
}

/** Wie viele Stellungsrunden eine ruhende Gruppe noch braucht, bis sie ausgeruht ist (0 = schon ausgeruht) */
export function restRoundsLeft(fatigue, perRound) {
  if (fatigue <= C.RESTED) return 0;
  if (perRound <= 0) return null;
  return Math.floor((fatigue - C.RESTED + perRound - 1) / perRound);
}

// ------------------------------------------------------------------ Moral

/**
 * Moralerholung je Stellungsrunde hinter der Front.
 * moral = Etappenertrag "moral" (Feldkueche, +1 je Ruhelager daneben) kommt nur im Ruhelager an.
 */
export function moraleRecovery(post, { recovery = 1, moral = 0, shock = 0 } = {}) {
  if (shock > 0) return 0;
  if (post === 'reserve') return round(C.MORALE_RESERVE * recovery);
  if (post === 'rest') return round((C.MORALE_REST + Math.max(0, moral)) * recovery);
  return 0;
}

/** Obergrenze, bis zu der sich die Moral auf dem Posten erholt */
export function moraleCap(post) {
  return post === 'reserve' ? C.MORALE_RESERVE_CAP : 100;
}

/** Moralverlust vorn je Stellungsrunde: Erschoepfung und zu lange vorn */
export function frontMoraleLoss(g) {
  let n = 0;
  if ((g.fatigue ?? 0) >= C.FATIGUE_TIRED) n += C.MORALE_TIRED;
  n += tooLongMorale(g.frontTurns ?? 0);
  return n;
}

/** Zusaetzlicher Moralverlust, wenn eine Gruppe zu lange vorn ist */
export function tooLongMorale(frontTurns) {
  if (frontTurns <= C.TOO_LONG) return 0;
  return Math.min(C.TOO_LONG_MORALE_MAX, (frontTurns - C.TOO_LONG) * C.TOO_LONG_MORALE);
}

export function isTooLong(g) {
  return (g.frontTurns ?? 0) >= C.TOO_LONG;
}

/** Trost (Kapelle, Gedenkstaette) senkt den Verlust in Prozent */
export function trostPercent(trost) {
  return clamp(Math.max(0, trost | 0) * C.TROST_PERCENT, 0, C.TROST_MAX);
}

/**
 * Moralverlust durch Verluste: anteilig an der Sollstaerke, mal Fraktionsfaktor, weniger Trost.
 * Jeder Verlust kostet mindestens 1.
 */
export function lossMorale(amount, size, { breakFactor = 1, trost = 0 } = {}) {
  if (!(amount > 0)) return 0;
  const raw = (amount * C.LOSS_MORALE * breakFactor) / Math.max(1, size);
  const after = (raw * (100 - trostPercent(trost))) / 100;
  return Math.max(1, round(after));
}

/** Moraleinbruch, wenn der Gruppenfuehrer faellt */
export function leaderMorale({ breakFactor = 1 } = {}) {
  return round(C.LEADER_MORALE * breakFactor);
}

/**
 * Wahrscheinlichkeit (ganze Prozent), dass der Gruppenfuehrer unter den Verlusten ist.
 * amount: Verluste, before: Staerke vor den Verlusten.
 */
export function leaderChance(amount, before) {
  if (!(amount > 0) || !(before > 0)) return 0;
  return clamp(Math.floor((amount * C.LEADER_SHARE) / before), 1, C.LEADER_MAX);
}

// ------------------------------------------------------------------ Moralprobe

/**
 * Aussicht (ganze Prozent), eine Moralprobe zu bestehen.
 * Fraktion: Wer schneller einbricht (breakFactor > 1), verfehlt oefter.
 */
export function checkChance({ morale = 70, experience = 0, losses = false, leaderFell = false, pinned = false, fatigue = 0, section = 50, breakFactor = 1 } = {}) {
  let base = morale + C.CHECK_XP * experience;
  if (losses) base -= C.CHECK_LOSSES;
  if (leaderFell) base -= C.CHECK_LEADER;
  if (pinned) base -= C.CHECK_PINNED;
  if (fatigue >= C.FATIGUE_TIRED) base -= C.CHECK_TIRED;
  base += Math.floor((section - 50) / C.CHECK_SECTION_DIV);
  base = clamp(base, C.CHECK_MIN, C.CHECK_MAX);
  const fail = round((100 - base) * breakFactor);
  return clamp(100 - fail, C.CHECK_MIN, C.CHECK_MAX);
}

/** Ergebnis einer Probe: roll 0..99. 'held' | 'wavers' (wirft sich hin) | 'breaks' (weicht ein Feld zurueck) */
export function checkOutcome(roll, chance, morale) {
  if (roll < chance) return 'held';
  if (morale < C.BREAK_MORALE && roll >= chance + C.BREAK_MARGIN) return 'breaks';
  return 'wavers';
}

// ------------------------------------------------------------------ Abschnitt

/**
 * Moral je Abschnitt (Mittel der Gruppen vorn, nach Staerke gewichtet) und gesamt.
 * Liefert { sections: { A: 64, ... }, overall } (Abschnitte ohne Gruppe fehlen).
 */
export function sectionMorale(map, state, side) {
  const out = {};
  let sum = 0, weight = 0;
  for (const sec of sectionsOf(map)) {
    let s = 0, w = 0;
    for (const g of state.groups) {
      if (g.side !== side || postOf(map, g) !== 'front') continue;
      if (g.pos.y < sec.y0 || g.pos.y > sec.y1) continue;
      const k = Math.max(1, g.strength);
      s += g.morale * k; w += k;
    }
    if (w) { out[sec.id] = round(s / w); sum += s; weight += w; }
  }
  return { sections: out, overall: weight ? round(sum / weight) : null };
}

/** Abschnitt eines Feldes (Kennbuchstabe) */
export function sectionIdAt(map, y) {
  const sec = sectionsOf(map).find((s) => y >= s.y0 && y <= s.y1);
  return sec ? sec.id : null;
}

// ------------------------------------------------------------------ Ruhelager

/** Ruhelager einer Seite (fertig, nicht beschaedigt), nach id */
export function restCamps(state, side) {
  const et = state.sides[side]?.etappe;
  if (!et) return [];
  return et.buildings.filter((b) => b.type === 'ruhelager' && isBuilt(b) && !b.damaged).sort((p, q) => cmp(p.id, q.id));
}

/**
 * Felder, auf denen ruhende Gruppen stehen koennen: zuerst die Ruhelager, sonst die Parzellen der Etappe
 * nahe dem Depot (Scheunen, Keller). Liefert { cells: [{x,y}], camp: bool }.
 */
export function restCells(map, state, side) {
  const et = state.sides[side]?.etappe;
  const camps = restCamps(state, side);
  const cells = [];
  if (et && camps.length) {
    for (const b of camps) for (const p of plotCells(et, b.x, b.y)) cells.push({ x: p.x, y: p.y });
    return { cells, camp: true };
  }
  if (map) {
    const ms = mapSide(side);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const c = mapCell(map, x, y);
        if (c && c.zone === 'etappe' && c.side === ms && c.terrain !== 'wasser') cells.push({ x, y });
      }
    }
    // Moeglichst weit hinten: Seite a links, Seite b rechts
    cells.sort((p, q) => (side === 'a' ? p.x - q.x : q.x - p.x) || p.y - q.y);
  }
  return { cells, camp: false };
}

/** Freies Feld fuer eine ruhende Gruppe (keine andere Gruppe darauf): im Ruhelager das naechste zu "near", sonst ganz hinten */
export function freeRestCell(map, state, side, near = null, taken = new Set()) {
  const { cells, camp } = restCells(map, state, side);
  const occupied = new Set(state.groups.filter((g) => g.status !== 'lost').map((g) => g.pos.x + ',' + g.pos.y));
  const free = cells.filter((p) => !occupied.has(p.x + ',' + p.y) && !taken.has(p.x + ',' + p.y));
  if (!free.length) return null;
  if (near && camp) {
    const d = (p) => Math.abs(p.x - near.x) + Math.abs(p.y - near.y);
    free.sort((p, q) => d(p) - d(q) || p.y - q.y || p.x - q.x);
  }
  return { cell: free[0], camp };
}

// ------------------------------------------------------------------ Ersatz

/** Neue Ersatzleute je Stellungsrunde in Zehnteln (Kaldern langsam, Morrow schnell) */
export function replacementTenths(speed = 1) {
  return round(C.REPLACEMENTS_PER_TURN * speed * 10);
}

/**
 * Vorschau Auffuellen. Zuerst Genesene (veterans, behalten ihre Erfahrung), dann gruener Ersatz mit greenXp.
 * Liefert { veterans, green, total, experience, morale } (experience gewichtet und gerundet: Ersatz senkt sie).
 */
export function refillPreview(g, { pool = 0, veterans = 0, greenXp = 0 } = {}) {
  const gap = Math.max(0, (g.size ?? g.strength) - g.strength);
  const vet = Math.min(gap, Math.max(0, veterans | 0));
  const green = Math.min(gap - vet, Math.max(0, pool | 0));
  const total = vet + green;
  const men = g.strength + total;
  // Gewichtetes Mittel, kaufmaennisch gerundet: ein einzelner Gruener kostet keine ganze Stufe
  const xp = men > 0 ? round(((g.strength + vet) * g.experience + green * greenXp) / men) : g.experience;
  const morale = men > 0 ? round(((g.strength + vet) * g.morale + green * C.GREEN_MORALE) / men) : g.morale;
  return { veterans: vet, green, total, experience: clamp(xp, 0, 4), morale: clamp(morale, 0, 100) };
}

// ------------------------------------------------------------------ Bleistiftvermerke

/**
 * Kurzer Vermerk an der Einheit (Ueberraschung P12), wie mit Bleistift neben den Namen geschrieben.
 * Liefert { text, tone: 'pencil' | 'warn', strike?: alter Name } oder null.
 */
export function unitNote(map, g, { recovery = 0 } = {}) {
  const post = postOf(map, g);
  if (post === 'lost') return null;
  if (g.leaderFell && g.leaderFell.turns > 0) {
    return { text: `${surname(g.leader?.name)} übernimmt`, tone: 'warn', strike: surname(g.leaderFell.name) };
  }
  if (post === 'rest') {
    const left = restRoundsLeft(g.fatigue ?? 0, recovery);
    return { text: left ? `ruht, noch ${left} ${left === 1 ? 'Runde' : 'Runden'}` : 'ausgeruht', tone: 'pencil' };
  }
  if ((g.greenTurns ?? 0) > 0) return { text: 'Ersatz, grün', tone: 'pencil' };
  if (post === 'front' && (g.frontTurns ?? 0) >= C.LONG_FRONT) {
    return { text: `seit ${g.frontTurns} Runden vorn`, tone: g.frontTurns >= C.TOO_LONG ? 'warn' : 'pencil' };
  }
  return null;
}

export function surname(name) {
  const n = name ?? '';
  const i = n.indexOf(' ');
  return i < 0 ? n : n.slice(i + 1);
}
