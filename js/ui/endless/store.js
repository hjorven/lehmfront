// Speicher des Endlosmodus (P22): der Lauf, der Zustand zu Wochenbeginn und die Rueckmeldung einer Woche.
// localStorage mit Rueckfall in den Speicher (privates Fenster, gesperrter Speicher). Dazu zwei lokale Listen:
// die besten Laeufe im Endlosmodus und das Wochenbuch der Wochenlage (nur auf diesem Geraet).
import { enemyDifficulty } from '../../modes/endless.js';

const RUN = 'lehmfront-endlos';
const SNAP = 'lehmfront-endlos-woche';
const RETURN = 'lehmfront-endlos-rueckmeldung';
const BEST = 'lehmfront.endlos.best.v1';
const WEEKLY = 'lehmfront.wochenlage.v1';
const mem = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* gesperrt oder kaputt */ }
  return mem.has(key) ? structuredClone(mem.get(key)) : null;
}

function write(key, value) {
  mem.set(key, value == null ? null : structuredClone(value));
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadRun = () => read(RUN);
export const saveRun = (r) => write(RUN, r);
export const loadWeekStart = () => read(SNAP);
export const saveWeekStart = (s) => write(SNAP, s);
export const loadWeekReturn = () => read(RETURN);
export const saveWeekReturn = (r) => write(RETURN, r);
export const clearWeekReturn = () => write(RETURN, null);
export function clearRun() { write(RUN, null); write(SNAP, null); write(RETURN, null); }

/** Kennung der laufenden Woche (fuer das Wiederaufnehmen der Akte im Gefecht, P18) */
export function weekStamp() {
  const r = read(RUN);
  return r ? `${r.runId ?? 0}-${r.seed}-${r.mapSeed}-${r.week}-${r.weeks?.length ?? 0}` : null;
}

/** Abfrage fuer die Woche im Gefecht (gleiche Karte, gleiches Szenario, Gegner nach Woche) */
export function weekQuery(run) {
  const q = new URLSearchParams({ scene: 'gefecht', endlos: '1', karte: run.map, fraktion: run.faction, ki: enemyDifficulty(run.week), seed: String(run.seed) });
  if (run.map === 'zufall') q.set('kseed', String(run.mapSeed));
  return q;
}

/** Passt die Adresse zur laufenden Woche? (Karte, Fraktion, Gegner, Seed; sonst alte Lesezeichen oder Handarbeit) */
export function matchesWeek(params, run) {
  const want = weekQuery(run);
  for (const k of ['karte', 'kseed', 'fraktion', 'ki', 'seed']) if ((params.get(k) ?? '') !== (want.get(k) ?? '')) return false;
  return true;
}

const okEntry = (e) => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.points);
const byRank = (a, b) => b.points - a.points || (a.at ?? 0) - (b.at ?? 0);

/** Beste Laeufe im Endlosmodus (hoechstens 12) */
export function bestRuns() {
  const list = read(BEST);
  return Array.isArray(list) ? list.filter(okEntry).sort(byRank) : [];
}

export function addBestRun(entry) {
  const list = [...bestRuns(), { ...entry, name: String(entry.name || 'Ohne Namen').slice(0, 24), points: entry.points | 0 }].sort(byRank).slice(0, 12);
  const saved = write(BEST, list);
  return { list, saved };
}

/** Wochenbuch der Wochenlage: Eintraege einer Woche (Schluessel JJJJMMTT des Montags) */
export function weeklyBoard(key) {
  const data = read(WEEKLY);
  const list = data && typeof data === 'object' && Array.isArray(data[key]) ? data[key] : [];
  return list.filter(okEntry).sort(byRank);
}

export function addWeeklyEntry(key, entry) {
  const data = read(WEEKLY);
  const all = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const clean = { name: String(entry.name || 'Ohne Namen').slice(0, 24), points: entry.points | 0, faction: entry.faction, weeks: entry.weeks | 0, at: entry.at ?? 0 };
  const list = [...(Array.isArray(all[key]) ? all[key].filter(okEntry) : []), clean].sort(byRank).slice(0, 20);
  all[key] = list;
  // Nur die letzten zwoelf Wochen behalten
  for (const k of Object.keys(all).sort().slice(0, -12)) delete all[k];
  const saved = write(WEEKLY, all);
  return { list, index: list.indexOf(clean), saved };
}
