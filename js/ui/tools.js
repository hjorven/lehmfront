// Werkzeug-Register (Plan 7.2, 7.6). Mechanik-Pakete melden ihre Befehle als Werkzeuge an, die Werkzeugreihe,
// das radiale Menue und die Tastatur lesen nur dieses Register.
//
// Werkzeug: { id, key, label, icon, order?, needsGroup?, canUse(group, state, env) -> true | false | 'Grund', begin(ctx) }
//   needsGroup: false = Befehl der ganzen Seite (Lorenplan); canUse bekommt dann eventuell group = null
//   shown(state) optional: false blendet das Werkzeug in Werkzeugreihe und radialem Menue aus (z. B. Leuchtkugel am Tag),
//     die Taste bleibt und erklaert, warum es gerade nicht geht
//   key: eine Taste (Plan 7.6: G U B F H D L), icon: SVG-Pfad(e) im 24er-Raster als String (stroke, currentColor)
//   begin(ctx) startet den Befehl. ctx (vom Gefechtsbildschirm):
//     group, state, map, side            gewaehlte Gruppe und Lage (nur lesen)
//     setOrder(order)                    Befehl ins Befehlsbuch (mit Undo)
//     pickCell({ title?, hint, preview(cell) -> { path?, text? } | null, pick(cell) -> true wenn erledigt })
//                                        Zielwahl auf der Karte; preview zeichnet Vorschau und Text im Schild
//                                        Mit dem Finger merkt das erste Antippen ein gueltiges Ziel nur vor (Bleistift), das zweite
//                                        waehlt; confirm: false waehlt sofort (z. B. eigene Editoren)
//     hint(text)                         Hinweis-Kaertchen setzen
//     cancel()                           Werkzeug beenden
//   Fuer Seitenbefehle (needsGroup: false) zusaetzlich:
//     ui                                 Element fuer eigene Fenster
//     plans() / setSidePlan(order)       Seitenbefehle dieser Runde lesen und setzen ({ type, ... })
//     setModal(bool)                     Karte sperren, solange ein Fenster offen ist
const tools = new Map();

export function registerTool(tool) {
  const { id, key, label, canUse, begin } = tool ?? {};
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error('Werkzeug braucht eine id aus a-z, 0-9, -');
  if (typeof label !== 'string' || !label) throw new Error(`Werkzeug ${id}: label fehlt`);
  if (typeof key !== 'string' || key.length !== 1) throw new Error(`Werkzeug ${id}: key muss ein Zeichen sein`);
  if (typeof canUse !== 'function' || typeof begin !== 'function') throw new Error(`Werkzeug ${id}: canUse und begin noetig`);
  if (tools.has(id)) throw new Error(`Werkzeug ${id} ist schon angemeldet`);
  const k = key.toLowerCase();
  for (const t of tools.values()) if (t.key === k) throw new Error(`Taste ${key} ist schon an ${t.id} vergeben`);
  tools.set(id, Object.freeze({ order: 100, icon: '', ...tool, key: k }));
  return tools.get(id);
}

export function unregisterTool(id) {
  tools.delete(id);
}

/** Alle Werkzeuge in Anzeigereihenfolge (order, dann id) */
export function allTools() {
  return [...tools.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Werkzeuge, die in dieser Lage angeboten werden (shown) */
export function shownTools(state) {
  return allTools().filter((t) => typeof t.shown !== 'function' || t.shown(state));
}

export function toolByKey(key) {
  const k = String(key).toLowerCase();
  return allTools().find((t) => t.key === k) ?? null;
}

/** Nutzbarkeit fuer eine Gruppe: { ok, why } */
export function usable(tool, group, state, env = {}) {
  if (!group && tool.needsGroup !== false) return { ok: false, why: 'Erst eine Gruppe wählen' };
  let r;
  try { r = tool.canUse(group, state, env); } catch (err) { r = err.message; }
  if (r === true) return { ok: true, why: '' };
  return { ok: false, why: typeof r === 'string' ? r : `${tool.label} geht hier nicht` };
}
