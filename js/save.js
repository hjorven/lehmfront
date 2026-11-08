// Speichern (Plan 10.8): Spielstand mit version-Feld, Migrationskette v1 -> v2 -> ...,
// lokal in IndexedDB mit Fallback localStorage (und Speicher im RAM, wenn beides fehlt, z. B. in Node).
// Export/Import als JSON-String. Jeder Export traegt einen Pruefstempel ("Zensurstempel"):
// beim Import zeigt er, ob der Stand unterwegs beschaedigt oder von Hand veraendert wurde.
import { STATE_VERSION, byId } from './state.js';

export const SAVE_KIND = 'lehmfront-save';
export const SAVE_VERSION = STATE_VERSION;

/**
 * Migrationen: jede hebt einen Zustand genau eine Version an. Neue Version: Eintrag anhaengen,
 * STATE_VERSION in js/state.js erhoehen, Test mit einem alten Stand schreiben.
 */
export const MIGRATIONS = [
  {
    from: 1,
    to: 2,
    // v1 (Plan v1): round statt turn, isDay statt night, groups als Objekt nach ID, kein cells/fallen
    migrate(s) {
      if (!s.map || !(s.map.width > 0) || !(s.map.height > 0)) throw new Error('Alter Spielstand ohne Karte, nicht ladbar');
      const out = { ...s };
      out.turnKind = s.turnKind ?? 'position';
      out.turn = s.turn ?? s.round ?? 1;
      delete out.round;
      out.night = s.night ?? (s.isDay === undefined ? false : !s.isDay);
      delete out.isDay;
      const groups = Array.isArray(s.groups)
        ? s.groups
        : Object.keys(s.groups ?? {}).map((id) => ({ ...s.groups[id], id: s.groups[id].id ?? id }));
      out.groups = groups.map((g) => ({
        experience: 1, fatigue: 0, morale: 70, suppressed: 0, size: g.strength ?? 1,
        facing: g.side === 'b' ? 'w' : 'e', status: 'front', inDugout: false, holdTurns: 0,
        ...g,
        leader: g.leader ?? { name: 'Unbekannt ' + g.id, home: 'unbekannt' },
      })).sort(byId);
      // v1 kannte keine Uhr: aus Runde und Tag/Nacht ableiten (Runde 1 = Tag 1 morgens)
      out.clock = s.clock ?? { day: Math.floor((out.turn - 1) / 2) + 1, hour: out.night ? 18 : 6, minute: 0 };
      out.weather = s.weather ?? { kind: 'clear', rain: 0, wind: { dir: 'w', speed: 1 } };
      out.scenario = s.scenario ?? { id: 'frei', name: '' };
      out.seed = (s.seed ?? 0) >>> 0;
      for (const side of ['a', 'b']) {
        const old = s.sides?.[side] ?? {};
        if (!old.faction) throw new Error(`Alter Spielstand ohne Fraktion fuer Seite ${side}, nicht ladbar`);
        out.sides = { ...out.sides, [side]: { reputation: 50, trust: 50, control: 'human', ...old, supplies: { ammo: 0, food: 0, material: 0, ...(old.supplies ?? {}) } } };
      }
      out.cells = s.cells ?? {};
      out.fallen = s.fallen ?? [];
      out.result = s.result ?? null;
      out.battle = s.battle ?? null;
      out.version = 2;
      return out;
    },
  },
];

/** Zustand von version auf SAVE_VERSION heben. Wirft bei unbekannten oder neueren Versionen. */
export function migrate(state) {
  let s = structuredClone(state);
  let v = s.version ?? 1;
  if (!Number.isInteger(v) || v < 1) throw new Error('Spielstand ohne gueltige Version');
  if (v > SAVE_VERSION) throw new Error(`Spielstand stammt aus einer neueren Version (${v}), dieses Spiel kennt ${SAVE_VERSION}`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS.find((x) => x.from === v);
    if (!m) throw new Error(`Keine Migration von Version ${v}`);
    s = m.migrate(s);
    if (s.version !== m.to) throw new Error(`Migration ${m.from} -> ${m.to} hat die Version nicht gesetzt`);
    v = s.version;
  }
  return s;
}

/** FNV-1a ueber einen Text, als 8 Hex-Zeichen */
export function stampOf(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Spielstand als JSON-String (deterministisch: gleicher Zustand, gleicher Text) */
export function exportSave(state, meta = {}) {
  const body = JSON.stringify(state);
  return JSON.stringify({ kind: SAVE_KIND, version: state.version ?? SAVE_VERSION, stamp: stampOf(body), meta, state });
}

/**
 * JSON-String lesen, pruefen und migrieren.
 * Liefert { state, meta, version (vor Migration), stamp: 'ok' | 'fehlt' | 'beschaedigt' }.
 * Wirft bei kaputtem JSON, fremden Daten oder zu neuer Version.
 */
export function inspectSave(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Spielstand ist kein gueltiges JSON');
  }
  if (!data || typeof data !== 'object') throw new Error('Spielstand ist leer');
  // v1-Staende waren ohne Umschlag: der Zustand selbst mit version 1
  const wrapped = data.kind === SAVE_KIND;
  if (!wrapped && data.version !== 1) throw new Error('Das ist kein Lehmfront-Spielstand');
  const raw = wrapped ? data.state : data;
  if (!raw || typeof raw !== 'object') throw new Error('Spielstand ohne Zustand');
  let stamp = 'fehlt';
  if (wrapped && data.stamp) stamp = stampOf(JSON.stringify(raw)) === data.stamp ? 'ok' : 'beschaedigt';
  return { state: migrate(raw), meta: wrapped ? data.meta ?? {} : {}, version: raw.version ?? 1, stamp };
}

/** Kurzform: nur den migrierten Zustand */
export function importSave(text) {
  return inspectSave(text).state;
}

// ---------- Ablage ----------

export function memoryBackend() {
  const m = new Map();
  return {
    name: 'memory',
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async set(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
    async keys() { return [...m.keys()].sort(); },
  };
}

const LS_PREFIX = 'lehmfront.save.';

export function localStorageBackend(ls = globalThis.localStorage) {
  return {
    name: 'localStorage',
    async get(k) { return ls.getItem(LS_PREFIX + k); },
    async set(k, v) { ls.setItem(LS_PREFIX + k, v); },
    async del(k) { ls.removeItem(LS_PREFIX + k); },
    async keys() {
      const out = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(LS_PREFIX)) out.push(k.slice(LS_PREFIX.length));
      }
      return out.sort();
    },
  };
}

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function indexedDbBackend(idb = globalThis.indexedDB, dbName = 'lehmfront') {
  const open = idb.open(dbName, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('saves');
  const db = await req(open);
  const store = (mode) => db.transaction('saves', mode).objectStore('saves');
  return {
    name: 'indexedDB',
    async get(k) { return (await req(store('readonly').get(k))) ?? null; },
    async set(k, v) { await req(store('readwrite').put(v, k)); },
    async del(k) { await req(store('readwrite').delete(k)); },
    async keys() { return (await req(store('readonly').getAllKeys())).map(String).sort(); },
  };
}

function localStorageUsable() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    ls.setItem(LS_PREFIX + '__probe', '1');
    ls.removeItem(LS_PREFIX + '__probe');
    return true;
  } catch {
    return false;
  }
}

/** Beste verfuegbare Ablage: IndexedDB, sonst localStorage, sonst RAM */
export async function openBackend() {
  if (globalThis.indexedDB) {
    try {
      return await indexedDbBackend();
    } catch {
      // z. B. privater Modus: weiter mit localStorage
    }
  }
  if (localStorageUsable()) return localStorageBackend();
  return memoryBackend();
}

/**
 * Spielstand-Ablage. backend optional (Tests), sonst openBackend().
 * slot: frei waehlbarer Name, z. B. 'auto', 'kampagne-1'.
 */
export function createSaveStore(backend = null) {
  let b = backend;
  const ready = async () => (b ??= await openBackend());
  return {
    async backendName() { return (await ready()).name; },
    async save(slot, state, meta = {}) {
      const text = exportSave(state, { savedAt: new Date().toISOString(), ...meta });
      await (await ready()).set(slot, text);
      return text.length;
    },
    async load(slot) {
      const text = await (await ready()).get(slot);
      return text === null ? null : inspectSave(text);
    },
    async list() {
      const be = await ready();
      const out = [];
      for (const slot of await be.keys()) {
        try {
          const { meta, version, stamp, state } = inspectSave(await be.get(slot));
          out.push({ slot, meta, version, stamp, turn: state.turn, scenario: state.scenario?.id ?? null });
        } catch (e) {
          out.push({ slot, error: e.message });
        }
      }
      return out;
    },
    async remove(slot) { await (await ready()).del(slot); },
  };
}
