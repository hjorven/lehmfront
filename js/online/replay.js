// Nachrechnen ohne Browser (P20): Befehlsprotokoll -> Partie. Grundlage fuer den Replay-Link (lokal, ohne Server)
// und fuer die Edge Function submit-daily (der Server rechnet die Tageslage nach, bevor er Punkte eintraegt).
// Rein: kein DOM, kein Date, kein Math.random. Laeuft im Browser, in node --test und in Deno (Supabase).
import { ORDER_TYPES } from '../config/orders.js';
import { getGroup, createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { loadMap } from '../map.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { decide } from '../ai.js';
import { createArchive, archiveRound } from '../archive.js';
import {
  dailyBrief, dailyMap, skirmishScenario, emptyTally, tallyLog, finalReport, limitReached, validDayKey,
} from '../modes/skirmish.js';

/** Obergrenzen gegen uebergrosse Eingaben (Server und Replay-Link) */
export const LIMITS = { rounds: 120, ordersPerRound: 80, orderBytes: 4000, recordBytes: 400000 };

/**
 * Restbefehle nach einer Runde (aus der Szene "gefecht" herausgeloest, damit Server und Replay dasselbe tun):
 * unvollendete Wege laufen weiter, Mechaniken mit eigenem Weitertragen melden ihren Rest als carry.
 * Liefert { a: [...], b: [...] } mit carried: true.
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

/** Befehle der KI fuer Seite b wie im Gefecht: frische Entscheidung plus weitergetragene Wege ohne neuen Befehl */
export function aiOrdersB(state, log, { map, seed, aiCfg, memory, carried = [] }) {
  const d = decide(viewFor(state, log, 'b', { map }), { map, seed, ...aiCfg, memory });
  const fresh = new Set(d.orders.map((o) => o.group).filter(Boolean));
  return { orders: [...d.orders, ...carried.filter((o) => !fresh.has(o.group))], memory: d.memory };
}

/** Byte-Laenge eines JSON-Werts (UTF-16-Zeichen reichen als Schranke) */
const sizeOf = (v) => { try { return JSON.stringify(v).length; } catch { return Infinity; } };

/**
 * Befehlsliste aus fremder Hand pruefen: Array aus Objekten, begrenzte Anzahl und Groesse.
 * Inhaltliche Pruefung (eigene Gruppe, erlaubter Befehl) macht resolveTurn selbst (order_invalid -> Halten).
 */
export function cleanOrders(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const o of list.slice(0, LIMITS.ordersPerRound)) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) continue;
    if (typeof o.type !== 'string' || o.type.length > 40) continue;
    if (sizeOf(o) > LIMITS.orderBytes) continue;
    out.push(o);
  }
  return out;
}

/**
 * Runden nachspielen. start = Startzustand, rounds = [{ a, b }] (b fehlt: KI rechnet wie im Gefecht).
 * opts: { map, seed, aiCfg, limit, stopAtEnd = true }
 * Liefert { state, start, archive, tally, ended, played, lastLog, memory }.
 */
export function replayRounds(start, rounds, { map, seed, aiCfg = {}, limit = 0, stopAtEnd = true }) {
  const env = { map };
  let state = start;
  let log = [];
  let tally = emptyTally();
  let archive = createArchive('');
  let memory;
  let carry = { a: [], b: [] };
  let ended = false;
  let played = 0;
  const over = (st) => limitReached(st, tally, limit)
    || !st.groups.some((g) => g.side === 'a' && g.status !== 'lost')
    || !st.groups.some((g) => g.side === 'b' && g.status !== 'lost');
  for (const r of rounds.slice(0, LIMITS.rounds)) {
    if (ended && stopAtEnd) break;
    const ordersA = cleanOrders(r?.a);
    let ordersB;
    if (Array.isArray(r?.b)) ordersB = cleanOrders(r.b);
    else {
      const d = aiOrdersB(state, log, { map, seed, aiCfg, memory, carried: carry.b });
      memory = d.memory;
      ordersB = d.orders;
    }
    const input = { state, ordersA, ordersB, seed, turn: state.turn, env };
    const res = resolveTurn(state, ordersA, ordersB, seed, state.turn, env);
    tally = tallyLog(tally, res.log, { before: state.turnKind, after: res.state.turnKind });
    archive = archiveRound(archive, input, res);
    state = res.state;
    log = res.log;
    carry = carryOrders(state, log);
    played++;
    if (over(state)) ended = true;
  }
  return { state, start, archive, tally, ended, played, lastLog: log, memory };
}

/**
 * Tageslage nachrechnen (Edge Function submit-daily). key = JJJJMMTT, rounds = [{ a }] in Rundenfolge.
 * Seite b spielt die KI des Tages, genau wie im Gefecht. Gueltig ist nur eine beendete Woche.
 * Liefert { ok, why?, points, held, report, played }.
 */
export function replayDaily(key, rounds) {
  if (!validDayKey(key)) return { ok: false, why: 'Ungültiger Tag' };
  if (!Array.isArray(rounds) || rounds.length === 0) return { ok: false, why: 'Kein Befehlsprotokoll' };
  if (rounds.length > LIMITS.rounds) return { ok: false, why: 'Protokoll zu lang' };
  const brief = dailyBrief(Number(key));
  const mapJson = dailyMap(brief);
  const map = loadMap(mapJson);
  const scenario = skirmishScenario(mapJson, { faction: brief.faction, difficulty: brief.difficulty, seed: brief.seed });
  const start = initEtappen(createInitialState(map, scenario, brief.seed), map, scenario);
  const sai = scenario.sides.b.ai ?? {};
  const r = replayRounds(start, rounds.map((x) => ({ a: x?.a })), {
    map, seed: brief.seed, aiCfg: { doctrine: sai.doctrine, difficulty: sai.difficulty }, limit: brief.rounds,
  });
  if (!r.ended) return { ok: false, why: 'Die Woche ist nicht zu Ende gespielt', played: r.played };
  if (r.played !== rounds.length) return { ok: false, why: 'Protokoll läuft über das Ende hinaus', played: r.played };
  const report = finalReport({ start, end: r.state, map, tally: r.tally });
  return { ok: true, points: report.points, held: report.held, report, played: r.played, faction: brief.faction };
}

// ---------- Replay-Link ----------

export const RECORD_VERSION = 1;

/**
 * Befehlsprotokoll fuer den Replay-Link aus dem Archiv des Gefechts.
 * query = Abfrage des Gefechts (saveQuery), seed = Seed der Partie.
 */
export function recordFrom(archive, { query, seed, title = '' }) {
  return {
    v: RECORD_VERSION,
    q: String(query),
    s: seed >>> 0,
    t: String(title).slice(0, 80),
    r: (archive?.rounds ?? []).slice().sort((x, y) => x.turn - y.turn).map((e) => [e.ordersA ?? [], e.ordersB ?? []]),
  };
}

/** Protokoll aus fremder Hand pruefen; liefert das bereinigte Protokoll oder null */
export function checkRecord(rec) {
  if (!rec || typeof rec !== 'object' || rec.v !== RECORD_VERSION) return null;
  if (typeof rec.q !== 'string' || rec.q.length > 600 || !Number.isFinite(rec.s)) return null;
  if (!Array.isArray(rec.r) || rec.r.length === 0 || rec.r.length > LIMITS.rounds) return null;
  if (sizeOf(rec) > LIMITS.recordBytes) return null;
  // Kampagne und Online-Partien lassen sich nicht ohne ihren Rahmen nachspielen
  const p = new URLSearchParams(rec.q);
  if (p.has('mission') || p.has('match') || p.has('feldzug')) return null;
  return {
    v: rec.v, q: rec.q, s: rec.s >>> 0, t: typeof rec.t === 'string' ? rec.t.slice(0, 80) : '',
    r: rec.r.map((x) => ({ a: cleanOrders(Array.isArray(x) ? x[0] : null), b: cleanOrders(Array.isArray(x) ? x[1] : null) })),
  };
}

// base64url ohne btoa (laeuft so auch in reinen Dateien): Bytes <-> Text
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
export function bytesToB64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
export function b64urlToBytes(text) {
  const s = String(text).replace(/[^A-Za-z0-9_-]/g, '');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const v = [0, 1, 2, 3].map((k) => (i + k < s.length ? B64.indexOf(s[i + k]) : 0));
    const n = (v[0] << 18) | (v[1] << 12) | (v[2] << 6) | v[3];
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length && i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (o < out.length && i + 3 < s.length) out[o++] = n & 255;
  }
  return out.subarray(0, o);
}
