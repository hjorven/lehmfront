// Asynchrone 1-gegen-1-Gefechte (P20, Plan 9 und 11). Rein: kein DOM, kein Date, kein Math.random.
// Server (Edge Functions join/resolve) und Client bauen dieselbe Lage aus der Karten-ID; der Seed der Partie
// bleibt geheim beim Server, bis die Partie beendet ist (sonst liesse sich der verdeckte Zustand nachrechnen).
import { loadMap } from '../map.js';
import { createInitialState, otherSide } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { battleMap } from '../config/battlemaps.js';
import { mapJsonFor, skirmishScenario, emptyTally, tallyLog, finalReport, limitReached } from '../modes/skirmish.js';
import { carryOrders, cleanOrders } from './replay.js';

/** Stellungsrunden bis zur Abschlussmeldung (wie die Tageslage eine Woche) */
export const MATCH_LIMIT = 14;
/** Frist in Stunden: Stellungsrunden ein Zug pro Tag (Plan 9: 48 Stunden), Gefechtsrunden mit kurzer Frist */
export const DEADLINE_HOURS = { position: 48, battle: 12 };
/** Karten fuer Online-Gefechte: nur rein erzeugbare (Asse-Nord ist eine Datei) */
export const MATCH_MAPS = ['velde', 'kraehenholz', 'schacht', 'zufall'];
/** Zeichen fuer Einladungscodes: ohne 0/O, 1/I/L */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Karten-ID pruefen: 'velde' | 'kraehenholz' | 'schacht' | 'zufall-<1..999999>' */
export function parseMapId(id) {
  const s = String(id ?? '');
  const m = /^zufall-(\d{1,6})$/.exec(s);
  if (m && Number(m[1]) > 0) return { map: 'zufall', mapSeed: Number(m[1]) };
  if (MATCH_MAPS.includes(s) && s !== 'zufall') return { map: s };
  return null;
}

/** Einladungscode pruefen (6 Zeichen aus CODE_ALPHABET), Kleinbuchstaben und Leerzeichen werden verziehen */
export function normalizeCode(text) {
  const s = String(text ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 6) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** Lage einer Partie: Karte und Szenario (beide Seiten menschlich), gleich auf Server und Client */
export function matchBattle(mapId) {
  const p = parseMapId(mapId);
  if (!p) throw new Error('Unbekannte Karte: ' + mapId);
  const mapJson = mapJsonFor({ map: p.map, mapSeed: p.mapSeed, faction: 'kaldern' });
  const seed = p.map === 'zufall' ? p.mapSeed : battleMap(p.map).spec.seed;
  const scenario = skirmishScenario(mapJson, { faction: 'kaldern', seed, hotseat: true });
  // id und name bleiben wie bei Gefecht frei, damit der Replay-Link im Gefecht genau denselben Zustand rechnet
  return { mapJson, scenario, limit: MATCH_LIMIT };
}

/** Abfrage fuer die Szene "gefecht" (der Client laedt damit Karte und Szenario wie bei Gefecht frei) */
export function matchQuery(mapId, matchId) {
  const p = parseMapId(mapId);
  const q = new URLSearchParams({ scene: 'gefecht' });
  q.set('karte', p.map);
  if (p.mapSeed) q.set('kseed', String(p.mapSeed));
  q.set('fraktion', 'kaldern');
  q.set('mode', 'hotseat');
  q.set('match', String(matchId));
  return q.toString();
}

/**
 * Oeffentlicher Start-Seed einer Partie aus ihrer ID (FNV-1a). Davon haengen nur Namen und Heimatorte der
 * Gruppenfuehrer ab, die beide Seiten sehen. Wuerde der geheime Seed das auch tun, liesse er sich aus den
 * eigenen Namen in Sekunden zurueckrechnen (Review P20).
 */
export function initSeedFor(matchId) {
  let h = 0x811c9dc5;
  const s = String(matchId);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) || 1;
}

/**
 * Startzustand einer Partie (Edge Function join). seed = geheimer Seed fuer alle Wuerfe der Runden,
 * initSeed = oeffentlicher Seed fuer den Startzustand. Liefert den Inhalt von match_states.state:
 * { state, start, tally, carry, seed, initSeed, mapId } und die Sicht beider Seiten.
 */
export function startMatch(mapId, seed, initSeed = 1) {
  const { mapJson, scenario } = matchBattle(mapId);
  const map = loadMap(mapJson);
  const init = createInitialState(map, scenario, initSeed >>> 0);
  init.seed = seed >>> 0; // die Runden wuerfeln mit dem geheimen Seed (resolveTurn prueft state.seed)
  const state = initEtappen(init, map, scenario);
  const ms = { mapId, seed: seed >>> 0, initSeed: initSeed >>> 0, state, start: state, tally: emptyTally(), carry: { a: [], b: [] } };
  return { ms, views: viewsOf(ms, [], map) };
}

/** Sicht beider Seiten (fuer match_views) */
export function viewsOf(ms, log, map) {
  const env = { map };
  return { a: viewFor(ms.state, log, 'a', env), b: viewFor(ms.state, log, 'b', env) };
}

/**
 * Runde einer Partie rechnen (Edge Function resolve). orders.a / orders.b = abgegebene Befehle oder null
 * (Frist verstrichen: dann laufen nur die weitergetragenen Wege, alles andere haelt).
 * Liefert { ms, views, log, finished, winner: 'a'|'b'|null, report|null, turnKind }.
 */
export function resolveMatch(ms, orders) {
  const { mapJson } = matchBattle(ms.mapId);
  const map = loadMap(mapJson);
  const env = { map };
  const pick = (s) => (Array.isArray(orders?.[s]) ? cleanOrders(orders[s]) : (ms.carry?.[s] ?? []));
  const before = ms.state;
  let r;
  try {
    r = resolveTurn(before, pick('a'), pick('b'), ms.seed, before.turn, env);
  } catch {
    // Befehle, an denen die Rechnung scheitert, gelten als Halten (sonst haengt die Partie fuer immer)
    orders = { a: [], b: [] };
    r = resolveTurn(before, [], [], ms.seed, before.turn, env);
  }
  const tally = tallyLog(ms.tally ?? emptyTally(), r.log, { before: before.turnKind, after: r.state.turnKind });
  const used = [...(ms.used ?? []), [pick('a'), pick('b')]];
  const next = { ...ms, state: r.state, tally, carry: carryOrders(r.state, r.log), used };
  const alive = (s) => r.state.groups.some((g) => g.side === s && g.status !== 'lost');
  const finished = limitReached(r.state, tally, MATCH_LIMIT) || !alive('a') || !alive('b');
  const report = finished ? finalReport({ start: ms.start, end: r.state, map, tally }) : null;
  return {
    ms: next, views: viewsOf(next, r.log, map), log: r.log, finished,
    winner: report?.winner ?? null, report, turnKind: r.state.turnKind,
  };
}

/**
 * Befehlsprotokoll fuer den Replay-Link einer beendeten Partie (matches.record). Traegt die tatsaechlich
 * gerechneten Befehle, also auch die nach verstrichener Frist weitergetragenen Wege.
 */
export function matchRecord(ms, matchId) {
  const q = new URLSearchParams(matchQuery(ms.mapId, matchId));
  q.delete('match');
  q.set('runden', String(MATCH_LIMIT));
  q.set('seed', String(ms.seed));
  q.set('iseed', String(ms.initSeed ?? ms.seed));
  const sorted = new URLSearchParams([...q.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)));
  return { v: 1, q: sorted.toString(), s: ms.seed, t: 'Zweikampf', r: (ms.used ?? []).map(([a, b]) => [a, b]) };
}

/** Frist der naechsten Runde in Millisekunden ab jetzt */
export function deadlineMs(turnKind) {
  return (DEADLINE_HOURS[turnKind] ?? DEADLINE_HOURS.position) * 3600 * 1000;
}

/**
 * Spielzustand fuer die Oberflaeche aus der Sicht einer Seite (Client). Eigene Gruppen vollstaendig, fremde
 * nur als gesehene Umrisse; die Gegenseite traegt nur ihre Fraktion und leere Vorraete aus dem Grundzustand.
 * base = Startzustand aus matchBattle (Struktur), view = match_views.view.
 */
export function stateFromView(base, view) {
  const side = view.side;
  const foe = otherSide(side);
  const st = structuredClone(base);
  st.turn = view.turn;
  st.turnKind = view.turnKind;
  st.night = view.night;
  st.clock = { ...view.clock };
  st.weather = structuredClone(view.weather);
  st.battle = structuredClone(view.battle);
  st.result = structuredClone(view.result);
  st.cells = structuredClone(view.cells);
  st.groups = structuredClone(view.groups);
  st.sides = { ...st.sides, [side]: structuredClone(view.own), [foe]: { ...st.sides[foe], faction: view.enemy.faction } };
  if (st.sides[foe].intel) st.sides[foe].intel = { lastSeen: {} };
  return st;
}

/** Wessen Zug fehlt? me = 'a'|'b', submitted = Liste der Seiten mit Befehlen fuer die laufende Runde */
export function turnState(match, me, submitted) {
  if (match.status === 'waiting') return 'waiting';
  if (match.status === 'finished') return 'finished';
  const mine = submitted.includes(me);
  const theirs = submitted.includes(me === 'a' ? 'b' : 'a');
  if (!mine) return 'yours';
  return theirs ? 'resolving' : 'theirs';
}
