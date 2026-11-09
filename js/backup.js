// Dienstbuch-Sicherung (P27): Feldzug, Endloslauf, Lehrgangsmappe, Wachbuch, Werkstatt und Einstellungen liegen
// im localStorage des Browsers. Die Sicherung packt alle Eintraege mit dem Praefix "lehmfront" in eine Datei mit
// Pruefstempel (wie Spielstaende aus js/save.js), damit ein Feldzug auf ein anderes Geraet oder nach dem Leeren des
// Browsers zurueckkommt. Spielstaende in den Kartentaschen exportiert jede Tasche selbst.
// Rein bis auf collectLocal/restoreLocal, die den Speicher lesen und schreiben.
import { stampOf } from './save.js';

export const BACKUP_KIND = 'lehmfront-dienstbuch';
export const BACKUP_PREFIX = 'lehmfront';

const ours = (k) => typeof k === 'string' && k.startsWith(BACKUP_PREFIX);

/** Eintraege { schluessel: Text } als Datei-Text, Schluessel sortiert (gleicher Inhalt, gleicher Text) */
export function packBackup(entries, meta = {}) {
  const keys = Object.keys(entries ?? {}).filter((k) => ours(k) && typeof entries[k] === 'string').sort();
  const body = Object.fromEntries(keys.map((k) => [k, entries[k]]));
  const text = JSON.stringify(body);
  return JSON.stringify({ kind: BACKUP_KIND, stamp: stampOf(text), meta, entries: body });
}

/**
 * Datei-Text lesen: { entries, meta, stamp: 'ok' | 'beschaedigt', count, campaign (Feldzug enthalten), endless }.
 * Wirft bei fremden Dateien. Schluessel ohne Praefix werden verworfen.
 */
export function readBackup(text) {
  let d;
  try { d = JSON.parse(text); } catch { throw new Error('keine Sicherung aus dem Dienstbuch (kein JSON)'); }
  if (!d || d.kind !== BACKUP_KIND || typeof d.entries !== 'object' || !d.entries) throw new Error('keine Sicherung aus dem Dienstbuch');
  const keys = Object.keys(d.entries).filter((k) => ours(k) && typeof d.entries[k] === 'string').sort();
  const entries = Object.fromEntries(keys.map((k) => [k, d.entries[k]]));
  const stamp = d.stamp === stampOf(JSON.stringify(entries)) ? 'ok' : 'beschaedigt';
  return {
    entries, meta: d.meta ?? {}, stamp, count: keys.length,
    campaign: keys.includes('lehmfront-campaign'),
    endless: keys.includes('lehmfront-endlos'),
  };
}

/** Alle eigenen Eintraege aus einem Speicher (localStorage) lesen */
export function collectLocal(storage = globalThis.localStorage) {
  const out = {};
  if (!storage) return out;
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (ours(k)) out[k] = storage.getItem(k);
  }
  return out;
}

/** Eigene Eintraege ersetzen: was in der Sicherung fehlt, wird geloescht (sonst mischen sich zwei Feldzuege) */
export function restoreLocal(entries, storage = globalThis.localStorage) {
  for (const k of Object.keys(collectLocal(storage))) if (!(k in entries)) storage.removeItem(k);
  for (const [k, v] of Object.entries(entries)) if (ours(k)) storage.setItem(k, v);
}
