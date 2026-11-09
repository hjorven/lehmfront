// Graben ausheben (Plan 4.1 Nr. 1 bis 3, 10.6 Schritt 4 "works"). Befehl:
//   { group, type: 'dig', path: [{x,y}, ...] (Grabenfelder in Reihenfolge), level: 1..4 (Ziel, Standard 2),
//     kind: 'fire' | 'comm' (Feuergraben oder Laufgraben), facing: ['E', ...] (je Feld, optional) }
// Regeln:
// - Eine Gruppe hat je Stellungsrunde ein Arbeitsbudget: 100 mal Einheit (Pioniere doppelt) mal Faktoren in
//   Prozent (Staerke, Wetter, Erschoepfung, Vertrauen, spaeter Werkzeug). Faktoren melden sich mit
//   registerDigFactor an; ein spaeteres Paket ersetzt einen Faktor, indem es dieselbe id anmeldet.
// - Jedes Feld kostet Arbeit bis zur Zielstufe (js/trench.js LEVELS), geteilt durch den Bodenfaktor.
//   Angefangene Arbeit bleibt im Feld (state.cells[k].dig.work), der Graben waechst Stufe fuer Stufe.
// - Ausgebaut kostet je Feld Material (Faschinen), betoniert mehr. Ohne Material bleibt die Stufe darunter.
// - Die Gruppe arbeitet sich die Linie entlang und steht am Ende am zuletzt bearbeiteten Feld, wenn es frei ist.
// - Was fehlt, steht als carry im Ereignis; der Gefechtsbildschirm traegt es als Befehl weiter.
// - Ueberraschung: frischer Aufwurf. Ein bearbeitetes Feld traegt fresh = Runde; Gegner in Sichtweite des
//   Aufwurfs (tags weit, nachts kurz) bekommen eine Meldung, dass dort gegraben wird.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, cellLabel, distance, TERRAIN } from '../map.js';
import { unitType } from '../config/units.js';
import { faction } from '../config/factions.js';
import { groupsOf, otherSide } from '../state.js';
import {
  LEVELS, MAX_LEVEL, workIn, levelForWork, cellCost, workFromBudget, mapSideOf, defaultFacings, levelName,
} from '../trench.js';
import { surname } from './hold.js';

export const BASE_WORK = 100;
export const MAX_DIG_CELLS = 40;
/** So weit darf das erste Feld von der Gruppe entfernt sein */
export const DIG_REACH = 3;
/** Erschoepfung je Arbeitsrunde */
export const DIG_FATIGUE = 4;
/** Aufwurf ist so viele Runden frisch */
export const SPOIL_AGE = 2;
export const SPOIL_SIGHT_DAY = 10;
export const SPOIL_SIGHT_NIGHT = 3;

// ---------------------------------------------------------------------------------------------
// Faktoren

const factors = new Map();

/**
 * Faktor anmelden: fn({ state, group, map }) -> { pct, label } | null. pct in Prozent (100 = neutral).
 * Dieselbe id ersetzt den vorhandenen Faktor (spaetere Pakete: Wetter, Werkzeug aus der Etappe ...).
 */
export function registerDigFactor(id, fn) {
  factors.set(id, fn);
}

export function getDigFactor(id) {
  return factors.get(id) ?? null;
}

export function unregisterDigFactor(id) {
  factors.delete(id);
}

registerDigFactor('einheit', ({ state, group }) => {
  const t = unitType(group.type);
  let pct = Math.round((t.digRate ?? 1) * 100);
  const fac = state.sides?.[group.side]?.faction;
  const mod = fac ? faction(fac).units?.[group.type]?.digRate : null;
  if (mod) pct = Math.round(pct * mod);
  return { pct, label: t.short };
});

registerDigFactor('staerke', ({ group }) => {
  const size = Math.max(1, group.size ?? group.strength);
  const pct = 50 + Math.floor((50 * Math.min(size, group.strength)) / size);
  return pct === 100 ? null : { pct, label: `${group.strength} von ${size} Mann` };
});

const WEATHER_PCT = { rain: 80, storm: 60, snow: 70, frost: 60 };
registerDigFactor('wetter', ({ state }) => {
  const w = state.weather ?? {};
  let pct = WEATHER_PCT[w.kind] ?? 100;
  if (Number.isFinite(w.rain) && w.rain > 0) pct = Math.min(pct, 100 - Math.min(40, Math.floor(w.rain * 20)));
  return pct === 100 ? null : { pct, label: w.kind === 'frost' ? 'gefrorener Boden' : 'Regen und Schlamm' };
});

registerDigFactor('erschoepfung', ({ group }) => {
  const f = Math.max(0, Math.min(100, group.fatigue ?? 0));
  const pct = 100 - Math.floor(f / 2);
  return pct === 100 ? null : { pct, label: 'Erschöpfung' };
});

registerDigFactor('vertrauen', ({ state, group }) => {
  const trust = state.sides?.[group.side]?.trust ?? 50;
  const pct = 80 + Math.floor((Math.max(0, Math.min(100, trust)) * 2) / 5);
  return pct === 100 ? null : { pct, label: 'Vertrauen' };
});

/**
 * Arbeitsbudget einer Gruppe fuer eine Stellungsrunde: { rate, factors: [{ id, pct, label }] }.
 * Faktoren in fester Reihenfolge (nach id), jeder Schritt abgerundet.
 */
export function digRate(state, group, map = null) {
  let rate = BASE_WORK;
  const used = [];
  for (const id of [...factors.keys()].sort()) {
    let f = null;
    try { f = factors.get(id)({ state, group, map }); } catch { f = null; }
    if (!f || !Number.isFinite(f.pct)) continue;
    const pct = Math.max(0, Math.round(f.pct));
    rate = Math.floor((rate * pct) / 100);
    used.push({ id, pct, label: f.label ?? id });
  }
  return { rate, factors: used };
}

// ---------------------------------------------------------------------------------------------
// Pruefen und Vorausrechnen

/** Darf Seite side hier graben? Liefert null oder einen deutschen Grund. map mit Zustand (applyCellState). */
export function digBlocker(map, cell, side) {
  if (!cell) return 'außerhalb der Karte';
  const t = TERRAIN[cell.terrain];
  if (!t || !(t.dig > 0)) return `${t?.name ?? 'Boden'} lässt sich nicht graben`;
  if (cell.building) return 'dort steht ein Gebäude';
  if (cell.zone === 'niemandsland') return 'Niemandsland: dort gräbt man nur mit Sappen';
  if (cell.side !== mapSideOf(side)) return 'feindliche Zone';
  if (cell.trench && cell.trench.side !== mapSideOf(side)) return 'feindlicher Graben';
  return null;
}

/** Darf die Seite Beton verbauen? (Fraktion, Akt) */
export function concreteAllowed(state, side) {
  const fac = state.sides?.[side]?.faction;
  const m = fac ? faction(fac).materials : null;
  if (!m || m.concrete === 'start') return true;
  return (state.scenario?.act ?? 1) >= (m.concreteFromAct ?? 1);
}

/**
 * Vorausrechnung fuer die Oberflaeche: wie viele Runden fuer diese Linie? (rein)
 * map muss den Zustand enthalten. Liefert { cost, rate, rounds, material, todo (Felder mit Arbeit) }.
 */
export function digEstimate(map, state, group, cells, level = 2) {
  const { rate } = digRate(state, group, map);
  let cost = 0, material = 0, todo = 0;
  for (const p of cells) {
    const c = cellAt(map, p.x, p.y);
    const k = cellCost(c, level);
    if (!Number.isFinite(k)) continue;
    if (k > 0) todo++;
    cost += k;
    const have = levelForWork(workIn(c));
    for (let lv = have + 1; lv <= level; lv++) material += LEVELS[lv].material;
  }
  const rounds = cost === 0 ? 0 : rate > 0 ? Math.floor((cost + rate - 1) / rate) : Infinity;
  return { cost, rate, rounds, material, todo };
}

function checkDig(order, group, state, env) {
  const path = order.path;
  if (path.length > MAX_DIG_CELLS) return `höchstens ${MAX_DIG_CELLS} Felder auf einmal`;
  const level = order.level ?? 2;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL) return 'unbekannte Grabenstufe';
  if (order.kind !== undefined && order.kind !== 'fire' && order.kind !== 'comm') return 'unbekannte Grabenart';
  if (order.facing !== undefined && (!Array.isArray(order.facing) || order.facing.length !== path.length)) return 'Feuerrichtung passt nicht zur Linie';
  if (level === 4 && !concreteAllowed(state, group.side)) return 'Beton gibt es erst später';
  if (!(unitType(group.type).digRate > 0)) return `${unitType(group.type).name} gräbt nicht`;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const k = p.x + ',' + p.y;
    if (seen.has(k)) return `Feld ${cellLabel(p.x, p.y)} doppelt`;
    seen.add(k);
    if (i && Math.max(Math.abs(p.x - path[i - 1].x), Math.abs(p.y - path[i - 1].y)) !== 1) return `Linie springt bei Feld ${cellLabel(p.x, p.y)}`;
  }
  if (!env.map) return null;
  const map = env.map;
  if (distance(group.pos, path[0]) > DIG_REACH) return `Graben beginnt zu weit von der Gruppe (Feld ${cellLabel(path[0].x, path[0].y)})`;
  for (const p of path) {
    const base = cellAt(map, p.x, p.y);
    const cell = { ...base, ...(state.cells[p.x + ',' + p.y] ?? {}) };
    const why = digBlocker(map, cell, group.side);
    if (why) return `Feld ${cellLabel(p.x, p.y)}: ${why}`;
  }
  return null;
}

registerOrderValidator('dig', checkDig);

// ---------------------------------------------------------------------------------------------
// Phase

function runDig(ctx) {
  const { state, map } = ctx;
  if (!map) return;
  const orders = ctx.ordersOfType('dig');
  const occupied = new Map(ctx.groups().map((g) => [g.pos.x + ',' + g.pos.y, g.id]));
  const spoil = []; // { at, side }
  for (const o of orders) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const ms = mapSideOf(g.side);
    const level = o.level ?? 2;
    const kind = o.kind === 'comm' ? 'comm' : 'fire';
    const facings = o.facing ?? defaultFacings(o.path, ms);
    const { rate, factors: used } = digRate(state, g, map);
    let budget = rate;
    let done = 0, worked = 0, last = null, firstWorked = null, noMaterial = null;
    let i = 0;
    for (; i < o.path.length; i++) {
      const p = o.path[i];
      const k = p.x + ',' + p.y;
      const base = cellAt(map, p.x, p.y);
      const cell = { ...base, ...(state.cells[k] ?? {}) };
      const have = workIn(cell);
      const need = LEVELS[level].work - have;
      if (need <= 0) { done++; continue; }
      if (budget <= 0) break;
      const cost = cellCost(cell, level);
      let gain = cost <= budget ? need : workFromBudget(cell, budget);
      budget = cost <= budget ? budget - cost : 0;
      if (gain <= 0) break;
      // Material beim Erreichen von Stufe 3 und 4
      let newWork = have + gain;
      const from = levelForWork(have);
      for (let lv = from + 1; lv <= levelForWork(newWork); lv++) {
        const m = LEVELS[lv].material;
        if (!m) continue;
        const sup = state.sides[g.side].supplies;
        if ((sup.material ?? 0) >= m) sup.material -= m;
        else { newWork = LEVELS[lv].work - 1; noMaterial = lv; break; }
      }
      if (newWork <= have) break;
      const lvNow = levelForWork(newWork);
      const prevTrench = cell.trench;
      const patch = { dig: { work: newWork, side: ms }, fresh: ctx.turn };
      if (lvNow > 0) {
        patch.trench = prevTrench
          ? { ...prevTrench, level: Math.max(prevTrench.level, lvNow) }
          : { side: ms, kind, level: lvNow, facing: facings[i] };
      }
      state.cells[k] = { ...(state.cells[k] ?? {}), ...patch };
      worked++;
      if (!firstWorked) firstWorked = p;
      last = p;
      spoil.push({ at: p, side: g.side });
      if (newWork >= LEVELS[level].work) done++;
      else break; // Feld noch nicht fertig: hier geht es naechste Runde weiter
      if (noMaterial) break;
    }
    // Restlinie ab dem ersten unfertigen Feld
    let restFrom = o.path.length;
    for (let j = 0; j < o.path.length; j++) {
      const p = o.path[j];
      const c = { ...cellAt(map, p.x, p.y), ...(state.cells[p.x + ',' + p.y] ?? {}) };
      if (workIn(c) < LEVELS[level].work) { restFrom = j; break; }
    }
    const rest = o.path.slice(restFrom).map((p) => ({ x: p.x, y: p.y }));
    if (worked) g.fatigue = Math.min(100, (g.fatigue ?? 0) + DIG_FATIGUE);
    // Gruppe rueckt zum zuletzt bearbeiteten Feld nach
    if (last && distance(g.pos, last) > 0) {
      const k = last.x + ',' + last.y;
      if (!occupied.has(k)) {
        occupied.delete(g.pos.x + ',' + g.pos.y);
        g.pos = { x: last.x, y: last.y };
        occupied.set(k, g.id);
      }
    }
    const name = 'Gruppe ' + surname(g.leader.name);
    const what = kind === 'comm' ? 'Laufgraben' : levelName(level);
    const span = (a, b) => (a.x === b.x && a.y === b.y ? cellLabel(a.x, a.y) : `${cellLabel(a.x, a.y)} bis ${cellLabel(b.x, b.y)}`);
    const soil = (() => {
      const counts = new Map();
      for (const p of o.path) { const t = cellAt(map, p.x, p.y)?.terrain; counts.set(t, (counts.get(t) ?? 0) + 1); }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
      return TERRAIN[top[0]]?.name ?? 'Boden';
    })();
    const slow = used.filter((f) => f.pct < 100 && f.id !== 'einheit').map((f) => f.label);
    let reason;
    if (!worked && !rest.length) reason = `${name}: der Graben steht schon.`;
    else if (!worked) reason = noMaterial ? `${name} kommt nicht voran: kein Material für ${levelName(noMaterial)}.` : `${name} kommt mit dem ${what} nicht voran.`;
    else if (!rest.length) reason = `${name} hat den ${what} fertig: ${o.path.length} ${o.path.length === 1 ? 'Feld' : 'Felder'} von ${span(o.path[0], o.path[o.path.length - 1])}.`;
    else reason = `${name} gräbt am ${what} ${span(firstWorked, last)}, ${soil}${slow.length ? ', gebremst durch ' + slow.join(' und ') : ''}. Es fehlen noch ${rest.length} ${rest.length === 1 ? 'Feld' : 'Felder'}.`;
    if (noMaterial && worked) reason += ` Für ${levelName(noMaterial)} fehlt Material.`;
    const carry = rest.length && !noMaterial
      ? { group: g.id, type: 'dig', path: rest, level, kind, facing: facings.slice(restFrom) }
      : null;
    ctx.emit('dig', {
      side: g.side, group: g.id, secret: true, cells: worked, done, rest, level, kind, rate,
      noMaterial: noMaterial ?? undefined, carry, reason, at: last ? { ...last } : { ...o.path[0] },
    });
  }

  // Aufwurf verraet frische Arbeiten: je Seite und Feld hoechstens eine Meldung pro Runde, nach Ort sortiert
  const sight = state.night ? SPOIL_SIGHT_NIGHT : SPOIL_SIGHT_DAY;
  const told = new Set();
  for (const s of spoil.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)) {
    const foe = otherSide(s.side);
    const watchers = groupsOf(state, foe).filter((w) => distance(w.pos, s.at) <= sight);
    if (!watchers.length) continue;
    // Benachbarte Felder zusammenfassen: eine Meldung je Block von 3 x 3
    const key = foe + ':' + Math.floor(s.at.x / 3) + ',' + Math.floor(s.at.y / 3);
    if (told.has(key)) continue;
    told.add(key);
    ctx.emit('spoil_seen', {
      side: foe, secret: true, by: watchers[0].id,
      reason: state.night
        ? `Im Dunkeln Spatengeräusche bei ${cellLabel(s.at.x, s.at.y)}. Der Gegner gräbt.`
        : `Frisch aufgeworfener Lehm bei ${cellLabel(s.at.x, s.at.y)}: Dort wird gegraben.`,
      at: { ...s.at },
    });
  }
}

registerPhase({ id: 'dig', kind: 'position', order: ORDER.position.works, run: runDig });
