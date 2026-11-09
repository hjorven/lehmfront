// Befehle Schritt fuer Schritt (Einsteiger, 1.7.0). Wer neu ist, sieht nicht gleich alle Befehle, sondern bekommt
// sie in Stufen: in der Grundausbildung Schritt fuer Schritt, in Akt 1 je Mission, in Gefecht frei, Hotseat, Koop
// und Frontabschnitt nach dem erreichten Stand. Tageslage, Puzzle-Lagen, eigene Lagen, Online und Akt 2 bis 4
// zeigen immer alles. Im Dienstbuch (Darstellung, "Befehle") laesst sich alles sofort freischalten.
//
// Nur die Grundbefehle werden gestuft (CORE_TOOLS). Befehle spaeterer Akte (Stollen, Gas ...) blenden sich wie
// bisher ueber die Merkmale des Szenarios ein.
//
// Rein bis auf readLevel/raiseLevel (localStorage, ohne Speicher stumm).

export const UNLOCK_KEY = 'lehmfront.freigabe';
export const UNLOCK_SEEN_KEY = 'lehmfront.freigabe.gesehen';

/** Stufen in der Reihenfolge von Akt 1 */
export const STAGES = [
  { level: 1, title: 'Bewegen und Graben', tools: ['move', 'hold', 'dig'] },
  { level: 2, title: 'Feuer und Draht', tools: ['fire', 'dugout', 'wire'] },
  { level: 3, title: 'Versorgung', tools: ['supply', 'relieve'] },
  { level: 4, title: 'Angriff und Artillerie', tools: ['assault', 'fireplan', 'shift', 'cease'] },
  { level: 5, title: 'Ausbau', tools: ['rebuild', 'drain', 'flare', 'etappe'] },
];
export const MAX_LEVEL = STAGES.length;
export const CORE_TOOLS = new Set(STAGES.flatMap((s) => s.tools));

/** Ein Satz je Befehl: im Tooltip und auf dem Zettel "Neu freigeschaltet" */
export const TOOL_HELP = {
  move: 'Gruppe an ein anderes Feld schicken. Hinter der eigenen Linie geht das weit.',
  hold: 'Gruppe bleibt, wo sie ist, und schießt auf alles, was sie sieht.',
  dig: 'Linie ziehen, die Gruppe gräbt dort einen Graben. Knicke (Traversen) schützen vor Längsfeuer.',
  fire: 'Auf ein Feld schießen. Beim MG: Feuerkegel legen, wer dort durchläuft, wird niedergehalten.',
  dugout: 'Gruppe geht in den Unterstand: sicher vor Granaten, schießt aber nicht.',
  wire: 'Stacheldraht vor die Linie legen. Hält Angreifer fest.',
  supply: 'Was die Feldbahn nach vorn fährt: Munition, Essen, Material. Verwundete fahren zurück.',
  relieve: 'Müde Gruppe vorn gegen eine ausgeruhte von hinten tauschen.',
  assault: 'Angriff: Gruppen laufen über das Niemandsland auf den feindlichen Graben.',
  fireplan: 'Artillerie planen, zum Beispiel eine Feuerwalze vor dem eigenen Angriff.',
  shift: 'Im Gefecht: Artilleriefeuer weiterschieben. Braucht einen Beobachter mit Leitung.',
  cease: 'Im Gefecht: Artilleriefeuer stoppen. Braucht einen Beobachter mit Leitung.',
  rebuild: 'Eroberten Graben umdrehen, damit er wieder voll schützt.',
  drain: 'Wasser aus dem Graben pumpen. Gegen Schlamm.',
  flare: 'Nachts eine Leuchtkugel: macht einen Kreis kurz taghell.',
  etappe: 'Gebäude hinter der Front bauen: Depot, Küche, Lazarett, Batterien.',
};

/** Pruefpunkte in "Vor der Runde", die nur mit einem bestimmten Befehl Sinn ergeben */
export const CHECK_TOOLS = { etappe: 'etappe', artillerie: 'fireplan', versorgung: 'supply', abloesung: 'relieve', angriff: 'assault' };

/** Pruefpunkte, die bei gesperrten Befehlen wegfallen (Set der Pruefpunkt-ids) oder null */
export function hiddenChecks(allowed) {
  if (!allowed) return null;
  return new Set(Object.entries(CHECK_TOOLS).filter(([, tool]) => !allowed.has(tool)).map(([id]) => id));
}

/** Befehlsart -> Werkzeug (fuer den Lehrling: keine Vorschlaege mit gesperrten Befehlen) */
export const ORDER_TOOL = {
  move: 'move', redeploy: 'move', hold: 'hold', dig: 'dig', fire: 'fire', sector: 'fire', dugout: 'dugout', wire: 'wire',
  supply_plan: 'supply', relieve: 'relieve', refill: 'relieve', assault: 'assault', attack: 'assault', fire_plan: 'fireplan',
  shift: 'shift', shift_fire: 'shift', cease: 'cease', cease_fire: 'cease', rebuild: 'rebuild', drain: 'drain', flare: 'flare', etappe: 'etappe',
};

export function orderAllowed(allowed, type) {
  const tool = ORDER_TOOL[type];
  return !allowed || !tool || allowed.has(tool);
}

/** Befehle bis zu einer Stufe */
export function toolsForLevel(level) {
  return new Set(STAGES.filter((s) => s.level <= level).flatMap((s) => s.tools));
}

/** Stufe einer Mission in Akt 1 (Mission n bringt Stufe n, Mission 6 alles) */
export function akt1Level(scenId) {
  const m = /^akt1-m(\d)$/.exec(String(scenId ?? ''));
  return m ? Math.min(MAX_LEVEL, Number(m[1])) : null;
}

/** Wer ohne Grundausbildung in Gefecht frei geht, bekommt wenigstens Bewegen, Graben und Feuer */
export const FREE_MIN_LEVEL = 2;

/**
 * Welche Grundbefehle sind in diesem Gefecht erlaubt? null = alle (keine Stufen).
 * ctx = { setting: 'auto' | 'all', level, scenId, act, mode, campaign, online, demo, drill, lage }
 */
export function allowedTools(ctx) {
  if (ctx.demo || ctx.setting === 'all' || ctx.online) return null;
  if ((ctx.act | 0) > 1 || /^akt[2-9]-/.test(String(ctx.scenId ?? ''))) return null; // ab Akt 2 alle Befehle
  if (ctx.drill) return toolsForLevel(0); // die Grundausbildung schaltet selbst frei
  const mission = akt1Level(ctx.scenId);
  if (ctx.campaign) return mission ? toolsForLevel(Math.max(mission, ctx.level | 0)) : null;
  if (mission) return toolsForLevel(Math.max(mission, ctx.level | 0));
  if (['tageslage', 'puzzle'].includes(ctx.mode) || ctx.lage) return null;
  const lv = Math.max(FREE_MIN_LEVEL, ctx.level | 0);
  return lv >= MAX_LEVEL ? null : toolsForLevel(lv);
}

/** Zeigt die Werkzeugreihe dieses Werkzeug? (Befehle ausserhalb der Stufen immer) */
export function offered(allowed, toolId) {
  return !allowed || !CORE_TOOLS.has(toolId) || allowed.has(toolId);
}

// ---------- Stand im Browser ----------

const EXPERIENCED_KEYS = ['lehmfront-campaign', 'lehmfront-hinweise', 'lehmfront.endlos', 'lehmfront.lehrgang.v1', 'lehmfront.werkstatt.v1'];

/**
 * Erreichte Stufe. Beim ersten Aufruf: wer schon gespielt hat (Feldzug, Hinweise gesehen, Endlos, Lehrgang,
 * Werkstatt, gespeicherte Akte), bekommt alles; wer neu ist, beginnt bei 0.
 */
export function readLevel(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(UNLOCK_KEY);
    if (raw != null) return Math.max(0, Math.min(MAX_LEVEL, Number(raw) | 0));
    let old = EXPERIENCED_KEYS.some((k) => storage?.getItem(k) != null);
    for (let i = 0; !old && i < (storage?.length ?? 0); i++) if (/^lehmfront\.(akte|save)/.test(storage.key(i) ?? '')) old = true;
    const lv = old ? MAX_LEVEL : 0;
    storage?.setItem(UNLOCK_KEY, String(lv));
    return lv;
  } catch { return MAX_LEVEL; }
}

/** Stufe anheben (nie senken); liefert die neue Stufe */
export function raiseLevel(level, storage = globalThis.localStorage) {
  const now = readLevel(storage);
  const next = Math.max(now, Math.min(MAX_LEVEL, level | 0));
  try { if (next !== now) storage?.setItem(UNLOCK_KEY, String(next)); } catch { /* ohne Speicher */ }
  return next;
}

/** Welche der erlaubten Befehle sind neu (noch nie vorgestellt)? Merkt sie sich als gesehen. */
export function takeNewTools(allowed, storage = globalThis.localStorage) {
  if (!allowed) return [];
  let seen = [];
  try { seen = JSON.parse(storage?.getItem(UNLOCK_SEEN_KEY) ?? '[]'); } catch { seen = []; }
  if (!Array.isArray(seen)) seen = [];
  const fresh = [...allowed].filter((id) => !seen.includes(id));
  try { if (fresh.length) storage?.setItem(UNLOCK_SEEN_KEY, JSON.stringify([...seen, ...fresh])); } catch { /* ohne Speicher */ }
  return fresh;
}
