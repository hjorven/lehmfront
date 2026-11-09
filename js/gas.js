// Gas mit Wind (Plan 4.2 Nr. 20, Paket P24) als reine Regeln. Rein: kein DOM, kein Date, kein Math.random.
// Die Phasen stehen in js/phases/gas.js.
//
// Wind: state.weather.wind = { dir, speed }        dir = woher er kommt ('w' = Westwind, treibt nach Osten),
//                                                  speed 0 (still) bis 3 (frisch)
//       state.weather.windForecast = { dir, speed, sure }  Vorhersage fuer die naechste Runde (sure in Prozent).
//       Zu Beginn jeder Runde wird gewuerfelt, ob die Vorhersage stimmt. Stimmt sie nicht, dreht der Wind um 45,
//       manchmal um 90 Grad: wer abblaest, wettet auf den Wind (WEGO-Risiko).
// Gas:  state.cells[k].gas = Dichte 1..3, gasBy = Seite, die es freigesetzt hat. gasStain = Runde, in der dort
//       zuletzt Gas lag (die Karte vergilbt dort, Ueberraschung von P24).
import { GAS, WIND, WIND_DIRS, WIND_DRIFT, WIND_NAMES, WIND_SPEED_WORDS } from './config/akt3.js';
import { cellAt, cellLabel } from './map.js';
import { isSink, trenchOf } from './weather.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Wind aus dem Zustand, immer gueltig */
export function windOf(state) {
  const w = state?.weather?.wind ?? {};
  const dir = WIND_DIRS.includes(w.dir) ? w.dir : 'w';
  const speed = clamp(Number.isInteger(w.speed) ? w.speed : 1, 0, WIND.maxSpeed);
  return { dir, speed };
}

export function windText(w) {
  if (!w || w.speed === 0) return 'Windstille';
  return `${WIND_NAMES[w.dir] ?? 'Wind'}, ${WIND_SPEED_WORDS[w.speed] ?? ''}`.trim();
}

/** Richtung um steps Achtel drehen (positiv im Uhrzeigersinn) */
export function turnDir(dir, steps) {
  const i = WIND_DIRS.indexOf(dir);
  return WIND_DIRS[(((i < 0 ? 6 : i) + steps) % 8 + 8) % 8];
}

/** Treibrichtung als Vektor */
export function driftOf(w) {
  return WIND_DRIFT[w.dir] ?? WIND_DRIFT.w;
}

/** Wie sicher ist die Vorhersage fuer die naechste Runde? */
export function forecastSure(state, battle) {
  if (battle) return WIND.sureBattle;
  let s = WIND.surePosition;
  // Die naechste Stellungsrunde ist eine Tagrunde (6 bis 18 Uhr): der Wind dreht am Nachmittag
  const h = state?.clock?.hour ?? 6;
  const nextDay = h >= 18 || h < 6;
  if (nextDay) s += WIND.afternoon;
  const k = state?.weather?.kind;
  if (k === 'storm' || k === 'rain') s += WIND.storm;
  return clamp(s, 30, 95);
}

/** Neue Vorhersage aus dem jetzigen Wind (eine Zufallszahl je Entscheidung) */
export function makeForecast(rng, wind, sure) {
  let dir = wind.dir;
  if (Math.floor(rng() * 100) >= WIND.persist) dir = turnDir(dir, rng() < 0.5 ? -1 : 1);
  let speed = wind.speed;
  const r = Math.floor(rng() * 100);
  if (r < 20) speed -= 1; else if (r >= 80) speed += 1;
  return { dir, speed: clamp(speed, 0, WIND.maxSpeed), sure };
}

/** Wirklicher Wind der Runde aus der Vorhersage: { wind, held } */
export function rollWind(rng, forecast, current) {
  const f = forecast ?? { ...current, sure: 100 };
  if (Math.floor(rng() * 100) < (f.sure ?? 100)) return { wind: { dir: f.dir, speed: f.speed }, held: true };
  const big = Math.floor(rng() * 100) < WIND.turnTwo;
  const steps = (rng() < 0.5 ? -1 : 1) * (big ? 2 : 1);
  const speed = clamp(f.speed + (rng() < 0.5 ? 0 : 1), 0, WIND.maxSpeed);
  return { wind: { dir: turnDir(f.dir, steps), speed: Math.max(1, speed) }, held: false };
}

/** Gasfelder sortiert: [{ x, y, d, by }] */
export function gasCells(state) {
  const out = [];
  for (const k of Object.keys(state?.cells ?? {})) {
    const c = state.cells[k];
    if (!c?.gas) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y, d: c.gas, by: c.gasBy ?? null });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

export function gasAt(state, x, y) {
  return state?.cells?.[x + ',' + y]?.gas ?? 0;
}

/** Haelt sich das Gas hier laenger? (Graben, Trichter, Senke, Wald) */
export function holdsGas(state, map, x, y) {
  if (!map?.cells) return false;
  const c = cellAt(map, x, y);
  if (!c) return false;
  if (c.terrain === 'wald') return true;
  if (trenchOf(state, map, x, y)) return true;
  if (c.crater || state?.cells?.[x + ',' + y]?.crater || state?.cells?.[x + ',' + y]?.trichter) return true;
  return isSink(map, x, y);
}

/** Wie viele Treibschritte macht das Gas in dieser Runde? */
export function driftSteps(wind, kind, turn) {
  if (kind === 'position') return wind.speed === 0 ? 1 : GAS.stepsPosition + GAS.stepsPerSpeed * wind.speed;
  if (wind.speed >= 3) return 2;
  if (wind.speed === 2) return 1;
  if (wind.speed === 1) return turn % 2 === 0 ? 1 : 0;
  return 0;
}

/**
 * Einen Treibschritt rechnen. cells: Map 'x,y' -> { d, by }. Liefert eine neue Map.
 * Ohne rng (Vorschau) verliert das Gas keine Dichte.
 */
export function driftStep(cells, wind, map, state, rng = null) {
  const v = driftOf(wind);
  const calm = wind.speed === 0;
  const next = new Map();
  const put = (x, y, d, by) => {
    if (d <= 0) return;
    if (map && (x < 0 || y < 0 || x >= map.width || y >= map.height)) return;
    const k = x + ',' + y;
    const old = next.get(k);
    if (!old || old.d < d) next.set(k, { d, by: old && old.d === d ? (old.by ?? by) : by });
  };
  const keys = [...cells.keys()].sort((p, q) => {
    const [px, py] = p.split(',').map(Number);
    const [qx, qy] = q.split(',').map(Number);
    return py - qy || px - qx;
  });
  for (const k of keys) {
    const { d, by } = cells.get(k);
    const [x, y] = k.split(',').map(Number);
    const low = holdsGas(state, map, x, y);
    // Wer in einer Senke oder einem Graben liegt, bleibt zum Teil liegen
    const tx = calm ? x : x + v.dx, ty = calm ? y : y + v.dy;
    put(tx, ty, d, by);
    if (low && !calm) put(x, y, d - 1, by);
    // Seitlich breitet sich die Wolke aus (quer zur Treibrichtung), eine Stufe duenner
    if (d >= 2) {
      const px = calm ? 1 : -v.dy, py = calm ? 0 : v.dx;
      put(tx + px, ty + py, d - 1, by);
      put(tx - px, ty - py, d - 1, by);
      if (calm) { put(x, y + 1, d - 1, by); put(x, y - 1, d - 1, by); }
    }
  }
  if (!rng) return next;
  // Verduennen: Chance je Feld, eine Stufe zu verlieren
  const out = new Map();
  for (const k of [...next.keys()].sort()) {
    const e = next.get(k);
    const [x, y] = k.split(',').map(Number);
    let pct = calm ? GAS.decayCalm : wind.speed >= 3 ? GAS.decayStrong : GAS.decayPct;
    if (holdsGas(state, map, x, y)) pct = Math.floor((pct * GAS.decayLow) / 100);
    const d = Math.floor(rng() * 100) < pct ? e.d - 1 : e.d;
    if (d > 0) out.set(k, { d, by: e.by });
  }
  return out;
}

/** Gas aus dem Zustand als Map */
export function gasMap(state) {
  const m = new Map();
  for (const c of gasCells(state)) m.set(c.x + ',' + c.y, { d: c.d, by: c.by });
  return m;
}

/** Gas aus einer Map in den Zustand schreiben (alte Felder raeumen, Vergilben merken) */
export function writeGas(state, m, turn) {
  for (const k of Object.keys(state.cells)) {
    const c = state.cells[k];
    if (!c?.gas) continue;
    const { gas, gasBy, ...rest } = c;
    if (Object.keys(rest).length) state.cells[k] = rest; else delete state.cells[k];
  }
  for (const k of [...m.keys()].sort()) {
    const e = m.get(k);
    state.cells[k] = { ...(state.cells[k] ?? {}), gas: Math.min(GAS.maxDensity, e.d), ...(e.by ? { gasBy: e.by } : {}), gasStain: turn };
  }
}

/**
 * Vorschau: wohin treibt eine Wolke, die an cells freigesetzt wird? Ohne Zufall, mit dem vorhergesagten Wind.
 * Liefert { path: Mittellinie [{x,y}], reach: Set der beruehrten Felder }.
 */
export function predictDrift(map, state, cells, wind, steps) {
  let m = new Map(cells.map((c) => [c.x + ',' + c.y, { d: c.d ?? GAS.maxDensity, by: null }]));
  const reach = new Set(m.keys());
  const mid = (mm) => {
    const list = [...mm.keys()].map((k) => k.split(',').map(Number));
    if (!list.length) return null;
    let sx = 0, sy = 0;
    for (const [x, y] of list) { sx += x; sy += y; }
    return { x: Math.floor(sx / list.length + 0.5), y: Math.floor(sy / list.length + 0.5) };
  };
  const path = [];
  const first = mid(m);
  if (first) path.push(first);
  for (let i = 0; i < steps; i++) {
    m = driftStep(m, wind, map, state, null);
    // Vorschau duennt gleichmaessig aus: jede zweite Stufe eine Dichte weniger
    if (i % 2 === 1) for (const [k, e] of [...m]) { if (e.d <= 1) m.delete(k); else m.set(k, { ...e, d: e.d - 1 }); }
    for (const k of m.keys()) reach.add(k);
    const p = mid(m);
    if (!p) break;
    const last = path[path.length - 1];
    if (!last || last.x !== p.x || last.y !== p.y) path.push(p);
  }
  return { path, reach };
}

/** Grabenfelder fuer die Flaschen einer Gruppe: eigenes Feld plus die naechsten Grabenfelder der Linie */
export function cylinderCells(state, map, group) {
  const side = group.side === 'a' ? 'own' : 'enemy';
  const out = [{ x: group.pos.x, y: group.pos.y }];
  if (!map?.cells) return out;
  const near = [];
  for (let dy = -GAS.cylinderCells; dy <= GAS.cylinderCells; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = group.pos.x + dx, y = group.pos.y + dy;
      const tr = trenchOf(state, map, x, y);
      if (tr?.side !== side) continue;
      near.push({ x, y, d: Math.abs(dy) * 2 + Math.abs(dx) });
    }
  }
  near.sort((p, q) => p.d - q.d || p.y - q.y || p.x - q.x);
  for (const c of near.slice(0, GAS.cylinderCells * 2)) out.push({ x: c.x, y: c.y });
  return out;
}

/** Felder einer Gasgranaten-Salve um die Mitte */
export function shellCells(center, map) {
  const out = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const x = center.x + dx, y = center.y + dy;
    if (map && (x < 0 || y < 0 || x >= map.width || y >= map.height)) continue;
    out.push({ x, y, d: dx || dy ? GAS.shellDensity - 1 : GAS.shellDensity });
  }
  return out;
}

/** Blaest der Wind zur feindlichen Seite? side 'a' steht im Westen */
export function windTowardEnemy(wind, side) {
  if (wind.speed === 0) return false;
  const v = driftOf(wind);
  return side === 'a' ? v.dx > 0 : v.dx < 0;
}

export function windWarning(wind, side) {
  if (wind.speed === 0) return 'Windstille: das Gas bleibt liegen, wo es ist';
  const v = driftOf(wind);
  const toward = side === 'a' ? v.dx < 0 : v.dx > 0;
  if (toward) return 'Der Wind treibt das Gas zu den eigenen Linien';
  if (v.dx === 0) return 'Der Wind treibt das Gas an der Front entlang';
  return null;
}

export const describeCell = (p) => cellLabel(p.x, p.y);
