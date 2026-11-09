// Lokale Bestenliste der Tageslage (P17). Liegt im localStorage dieses Geraets; die Online-Bestenliste mit
// Nachrechnen auf dem Server kommt mit P20. Jeder Zugriff ist abgesichert: ohne Speicher bleibt die Liste leer.
const KEY = 'lehmfront.tageslage.v1';
const KEEP_DAYS = 40;
const PER_DAY = 20;

const okEntry = (e) => e && typeof e === 'object' && typeof e.name === 'string' && Number.isFinite(e.points);
const byRank = (a, b) => b.points - a.points || (a.at ?? 0) - (b.at ?? 0);

/** Gespeicherte Tage lesen; kaputte oder fremde Eintraege fallen heraus */
function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const data = raw ? JSON.parse(raw) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = {};
    for (const k of Object.keys(data)) {
      if (!/^\d{8}$/.test(k) || !Array.isArray(data[k])) continue;
      out[k] = data[k].filter(okEntry);
    }
    return out;
  } catch { return {}; }
}

function write(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; }
}

/** Eintraege eines Tages, beste zuerst */
export function boardFor(key) {
  const list = read()[key];
  return Array.isArray(list) ? list.slice().sort(byRank) : [];
}

/** Eintrag speichern; liefert { list, index, saved } (index = Platz des neuen Eintrags oder -1, wenn er nicht hineinpasst) */
export function addEntry(key, entry) {
  const data = read();
  const clean = {
    name: String(entry.name || 'Ohne Namen').slice(0, 24),
    points: entry.points | 0,
    faction: entry.faction,
    held: !!entry.held,
    at: entry.at ?? 0,
  };
  const list = [...(Array.isArray(data[key]) ? data[key] : []), clean]
    .sort(byRank)
    .slice(0, PER_DAY);
  data[key] = list;
  // alte Tage aufraeumen
  const days = Object.keys(data).sort();
  while (days.length > KEEP_DAYS) delete data[days.shift()];
  const saved = write(data);
  return { list, index: list.indexOf(clean), saved };
}

/** Bester eigener Eintrag ueber alle Tage (fuer das Menue) */
export function bestDays(n = 5) {
  const data = read();
  return Object.keys(data).sort().reverse().slice(0, n).map((k) => ({ key: Number(k), best: boardFor(k)[0] ?? null }));
}

/** Zuletzt benutzter Name */
export function lastName() {
  try { return localStorage.getItem(KEY + '.name') || ''; } catch { return ''; }
}
export function rememberName(name) {
  try { localStorage.setItem(KEY + '.name', String(name).slice(0, 24)); } catch { /* ohne Speicher */ }
}
