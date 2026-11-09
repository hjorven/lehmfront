// Wetter, Schlamm, Wasser im Graben, Leuchtkugeln (Plan 4.1 Nr. 6, 7.1, 7.7). Rein: kein DOM, kein Date,
// kein Math.random. Zufall nur ueber den Phasen-Zufall (ctx.rng), den die Phase in js/phases/weather.js uebergibt.
//
// Zustand (state.weather, reines JSON):
//   kind   'clear' | 'overcast' | 'rain' | 'storm' | 'fog'   Wetter der laufenden Stellungsrunde
//   rain   0..1  Regenstaerke (fuer Optik und Klang), fog 0..1 Nebeldichte
//   wet    0..3  Naesse des Bodens; waechst mit Regen, trocknet bei klarem Wetter
//   wind   { dir, speed }
//   fixed  true = Szenario legt das Wetter fest, es wird nicht gewuerfelt
// Feldzustand (state.cells["x,y"]):
//   water  0..3  Wasser im Graben (nur Grabenfelder), drain 1 = Lattenrost und Pumpe (Entwaesserung)
//   mud    0..3  zusaetzlicher Schlamm durch Beschuss (P09 darf ihn setzen), crater wie in der Karte
// Leuchtkugeln (state.flares): [{ x, y, r, side, auto }] nur fuer die Runde, in der sie geschossen wurden.
//
// Schlamm wird nicht fuer jedes Feld gespeichert, sondern aus Naesse, Boden, Senke, Krater und Feldzustand
// berechnet (mudAt). So bleibt der Zustand klein und jede Regel liest dieselbe Zahl.
import { TERRAIN, cellAt, neighbors, distance } from './map.js';
import { getCell } from './state.js';
import { seasonWeather } from './config/seasons.js';

export const WEATHER_KINDS = ['clear', 'overcast', 'rain', 'storm', 'fog'];
export const WEATHER_NAMES = { clear: 'klar', overcast: 'bedeckt', rain: 'Regen', storm: 'Sturm', fog: 'Nebel', snow: 'Schnee' };

export const MAX_WET = 3;
export const MAX_WATER = 3;
export const MAX_MUD = 3;
/** Regen je Wetter in Naesse-Stufen pro Stellungsrunde (Sturm: Wolkenbruch) */
export const RAIN_UNITS = { clear: 0, overcast: 0, rain: 1, storm: 2, fog: 0, snow: 0 };
/** Sicht je Wetter (Faktor auf die Tagessicht). Nebel schluckt am meisten. */
export const WEATHER_SIGHT = { clear: 1, overcast: 1, rain: 0.85, storm: 0.7, fog: 0.55, snow: 0.85 };
/** Bewegungskosten je Schlammstufe in Zehnteln eines Feldes (Lehm kostet 10) */
export const MUD_MOVE = [0, 4, 9, 15];
/** Grabgeschwindigkeit je Schlammstufe */
export const MUD_DIG = [1, 0.85, 0.65, 0.45];
/** Moral je Stellungsrunde im Schlamm (ab Stufe 2) */
export const MUD_MORALE = [0, 0, 1, 2];
/** Zusaetzlicher Moralverlust, wenn das Wasser im Graben knoechel- oder knietief steht */
export const WATER_MORALE = [0, 0, 1, 2];
/** Leuchtkugel: Radius des erhellten Kreises in Feldern, Reichweite beim Schiessen, Hoerweite der Posten */
export const FLARE_RADIUS = 4;
export const FLARE_RANGE = 8;
export const FLARE_HEAR = 6;
/** Ab dieser Dunkelheit gibt es Leuchtkugeln (Plan 7.7) */
export const FLARE_DARKNESS = 0.5;

/**
 * Uebergaenge zwischen Wettern in Hundertsteln (Zeile = altes Wetter). Wetter haelt sich gern, Regen kommt aus
 * bedecktem Himmel, Nebel meist nach Regen oder in klaren Naechten.
 */
export const WEATHER_TABLE = {
  clear:    { clear: 55, overcast: 30, rain: 5,  storm: 0,  fog: 10 },
  overcast: { clear: 25, overcast: 35, rain: 30, storm: 5,  fog: 5 },
  rain:     { clear: 5,  overcast: 30, rain: 40, storm: 10, fog: 15 },
  storm:    { clear: 5,  overcast: 30, rain: 45, storm: 15, fog: 5 },
  fog:      { clear: 35, overcast: 35, rain: 15, storm: 0,  fog: 15 },
};

const WIND_DIRS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Wetter der naechsten Stellungsrunde wuerfeln. Liefert ein neues weather-Objekt (ohne wet, das macht stepWet). */
export function rollWeather(rng, prev) {
  const from = WEATHER_TABLE[prev?.kind] ? prev.kind : 'clear';
  // P22: Jahreszeit (state.weather.season) schaltet die Tabelle um
  const row = (seasonWeather(prev?.season) ?? WEATHER_TABLE)[from];
  let roll = Math.floor(rng() * 100);
  let kind = from;
  for (const k of WEATHER_KINDS) {
    if (roll < row[k]) { kind = k; break; }
    roll -= row[k];
  }
  // Wind dreht selten, Sturm bringt starken Wind
  const wind = { dir: prev?.wind?.dir ?? 'w', speed: prev?.wind?.speed ?? 1 };
  if (rng() < 0.2) wind.dir = WIND_DIRS[(WIND_DIRS.indexOf(wind.dir) + (rng() < 0.5 ? 1 : 7)) % 8] ?? 'w';
  wind.speed = kind === 'storm' ? 3 : kind === 'fog' ? 0 : clamp(wind.speed + (rng() < 0.5 ? -1 : 1), 1, 2);
  const rain = kind === 'storm' ? 1 : kind === 'rain' ? (rng() < 0.5 ? 0.5 : 0.7) : 0;
  const fog = kind === 'fog' ? (rng() < 0.5 ? 0.7 : 0.9) : 0;
  return { kind, rain, fog, wind };
}

/** Naesse fortschreiben: Regen macht nass, klares Wetter am Tag trocknet, sonst bleibt der Boden, wie er ist. */
export function stepWet(wet, kind, night = false) {
  const w = clamp(Math.floor(Number(wet) || 0), 0, MAX_WET);
  const add = RAIN_UNITS[kind] ?? 0;
  if (add) return clamp(w + add, 0, MAX_WET);
  if (kind === 'clear' && !night) return clamp(w - 1, 0, MAX_WET);
  return w;
}

function hasTerrain(map) {
  return !!(map && Array.isArray(map.cells));
}

/**
 * Senke: kein Nachbar liegt tiefer, mindestens einer hoeher. Hier sammelt sich Wasser zuerst (Plan 3.2).
 * Ohne Gelaende (Testkarten) gibt es keine Senken.
 */
export function isSink(map, x, y) {
  if (!hasTerrain(map)) return false;
  const c = cellAt(map, x, y);
  if (!c) return false;
  let higher = false;
  for (const n of neighbors(map, x, y)) {
    if (n.height < c.height) return false;
    if (n.height > c.height) higher = true;
  }
  return higher;
}

/** Graben eines Feldes: Spielzustand vor Karte (gleiche Regel wie sight.trenchAt) */
export function trenchOf(state, map, x, y) {
  const s = state ? getCell(state, x, y) : null;
  if (s && Object.hasOwn(s, 'trench')) return s.trench;
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  return c?.trench ?? null;
}

function craterOf(state, map, x, y) {
  const s = state ? getCell(state, x, y) : null;
  if (s && Object.hasOwn(s, 'crater')) return s.crater | 0;
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  return c?.crater ?? 0;
}

/** Wasser im Graben 0..3 */
export function waterAt(state, x, y) {
  return clamp((getCell(state, x, y)?.water ?? 0) | 0, 0, MAX_WATER);
}

/** Ist der Graben entwaessert (Lattenrost, Pumpe)? */
export function isDrained(state, x, y) {
  return !!getCell(state, x, y)?.drain;
}

/**
 * Wie viel Wasser bekommt ein Grabenfeld in dieser Runde? Senken zuerst und doppelt, flache Talsohle (Hoehe 0)
 * einfach, Hanglagen nur bei Wolkenbruch. Boden wirkt mit (Fels und Kreide lassen ablaufen, Sumpf steht).
 * Entwaesserte Graeben bekommen hoechstens 1, und auch nur bei Wolkenbruch.
 */
export function waterGain(state, map, x, y, kind) {
  const u = RAIN_UNITS[kind] ?? 0;
  if (!u) return 0;
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  const sink = isSink(map, x, y);
  let base = sink ? 2 * u : !c || c.height === 0 ? u : u > 1 ? 1 : 0;
  const soil = c ? TERRAIN[c.terrain]?.mud ?? 1 : 1;
  base = Math.floor(base * soil + 0.5);
  if (isDrained(state, x, y)) base = u > 1 ? Math.min(1, base) : 0;
  return base;
}

/** Wasser laeuft ab: ohne Regen eine Stufe je Runde; entwaessert pumpt die Pumpe zwei, auch bei Regen noch eine */
export function waterLoss(state, x, y, kind) {
  const drained = isDrained(state, x, y);
  if (RAIN_UNITS[kind]) return drained ? 1 : 0;
  return drained ? 2 : 1;
}

/**
 * Schlammstufe 0..3 eines Feldes. Grundlage ist die Naesse, gewichtet mit dem Boden (Lehm 1, Sumpf 2, Kreide 0,3,
 * Fels 0,1). Senken +1, sobald der Boden nass ist. Krater machen das Feld zu Schlamm (Plan 4.1 Nr. 6): mindestens
 * Stufe 1, nass Stufe 2 und mehr. Grabenwasser ab Stufe 2 zaehlt als Schlamm. Entwaesserte Graeben bleiben fest.
 */
export function mudAt(state, map, x, y) {
  const wet = clamp((state?.weather?.wet ?? 0) | 0, 0, MAX_WET);
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  if (c && !Number.isFinite(TERRAIN[c.terrain]?.move)) return 0;
  const soil = c ? TERRAIN[c.terrain]?.mud ?? 1 : 1;
  let m = Math.floor(wet * soil + 0.5);
  if (wet > 0 && isSink(map, x, y)) m += 1;
  const crater = craterOf(state, map, x, y);
  if (crater) m = Math.max(m + crater, 1 + (wet > 0 ? 1 : 0));
  const s = state ? getCell(state, x, y) : null;
  if (s?.mud) m += s.mud | 0;
  const trench = trenchOf(state, map, x, y);
  if (trench) {
    if (s?.drain) m = Math.min(m, 1);
    const water = s?.water | 0;
    if (water >= 2) m = Math.max(m, water);
  }
  return clamp(m, 0, MAX_MUD);
}

export const MUD_WORDS = ['fest', 'aufgeweicht', 'Schlamm', 'tiefer Schlamm'];
export const WATER_WORDS = ['trocken', 'Pfützen', 'knöcheltief Wasser', 'knietief Wasser'];
/** "steht ..." */
export const WATER_IN = ['im Trockenen', 'in Pfützen', 'knöcheltief im Wasser', 'knietief im Wasser'];
/** "liegt ..." */
export const MUD_IN = ['auf festem Boden', 'auf aufgeweichtem Boden', 'im Schlamm', 'im tiefen Schlamm'];

/** Zusaetzliche Bewegungskosten (Zehntel) durch Schlamm */
export function mudMoveCost(state, map, x, y) {
  return MUD_MOVE[mudAt(state, map, x, y)];
}

/** Faktor auf die Grabgeschwindigkeit (fuer P04) */
export function digFactor(state, map, x, y) {
  return MUD_DIG[mudAt(state, map, x, y)];
}

/** Sichtfaktor des Wetters (1 = klar) */
export function weatherSight(weather) {
  const k = weather?.kind ?? 'clear';
  const base = WEATHER_SIGHT[k] ?? 1;
  if (k !== 'fog') return base;
  // Nebel: je dichter, desto weniger (0,7 -> 0,65, 0,9 -> 0,55)
  const f = clamp(Number(weather.fog ?? 0.7) || 0, 0, 1);
  return 1 - 0.5 * f;
}

/**
 * Dunkelheit fuer die Sichtregeln: Tageszeit plus Wetter. Optik der Tageszeit bleibt beim reinen Wert
 * (darkness), Nebel und Regen zeichnet die Wetterebene als Grau ueber die Karte. Die Sicht ist
 * 1 - 0,6 * darkness (Plan 7.7); das Wetter multipliziert sie, hier zurueckgerechnet in eine Dunkelheit.
 */
export function sightDarkness(darkness, weather) {
  const d = clamp(Number(darkness) || 0, 0, 1);
  const vis = (1 - 0.6 * d) * weatherSight(weather);
  // Kann bei Nacht und Nebel ueber 1 liegen: rules.visibilityFromDarkness rechnet das bis Sicht 0 zurueck
  return clamp((1 - vis) / 0.6, 0, 1 / 0.6);
}

/** Erhellt eine Leuchtkugel dieser Runde das Feld p? Liefert die Leuchtkugel oder null. */
export function flareAt(state, p) {
  const list = state?.flares;
  if (!Array.isArray(list) || !list.length || !p) return null;
  for (const f of list) {
    // Nur in der Runde, in der sie geschossen wurde; beim Planen der naechsten Runde ist sie erloschen
    if (f.turn !== undefined && f.turn !== state.turn) continue;
    const dx = p.x - f.x, dy = p.y - f.y;
    if (dx * dx + dy * dy <= f.r * f.r) return f;
  }
  return null;
}

/** Kann eine Gruppe die Leuchtkugel an p schiessen? Liefert null oder einen deutschen Grund. */
export function flareProblem(group, p, darkness) {
  if (darkness <= FLARE_DARKNESS) return 'Leuchtkugeln nur bei Dunkelheit';
  if (!p) return 'kein Ziel';
  if (group.inDugout) return 'aus dem Unterstand nicht';
  const d = distance(group.pos, p);
  if (d < 2) return 'Ziel zu nah';
  if (d > FLARE_RANGE) return `zu weit (${d} von ${FLARE_RANGE} Feldern)`;
  return null;
}
