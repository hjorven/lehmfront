// Zusammenfassung vor "Runde ausfuehren" und Rundenende-Checkliste (Plan 3.4, 7.3). Rein, ohne DOM.
// Mechanik-Pakete melden eigene Pruefpunkte an: registerCheck(id, fn), fn(ctx) -> [{ tone, text, group?, at? }].
//   ctx = { state, side, orders (nur gesetzte), map, plans (Seitenbefehle dieser Runde nach Art, z. B. supply_plan) }
//   tone: 'warn' (rot, etwas fehlt) oder 'ok' (blau, alles gut). summary: true = auch in der Zusammenfassung zeigen. Beispiele: P08 "abgeschnitten", P09 "Leitung unterbrochen".
import { groupsOf, getGroup } from '../state.js';
import { ORDER_TYPES } from '../config/orders.js';
import { groupName } from './labels.js';
import { cellLabel } from '../map.js';

const checks = new Map();

export function registerCheck(id, fn) {
  if (checks.has(id)) throw new Error('Pruefpunkt schon angemeldet: ' + id);
  checks.set(id, fn);
}

export function unregisterCheck(id) {
  checks.delete(id);
}

export const LOW_MORALE = 35;
export const LOW_AMMO = 25;

registerCheck('ohne-befehl', ({ state, side, orders, only = null }) => {
  const has = new Set(orders.map((o) => o.group));
  // P12: Gruppen im Ruhelager ruhen mit Absicht und brauchen keinen Befehl
  const idle = groupsOf(state, side).filter((g) => (!only || only(g)) && !has.has(g.id) && g.status !== 'rest');
  if (!idle.length) return [{ tone: 'ok', text: 'Alle Gruppen haben einen Befehl' }];
  // P27: viele Gruppen ohne Befehl in einer Zeile, sonst schiebt die Liste andere Pruefpunkte aus dem Kaertchen.
  // Antippen springt zur ersten, die Leertaste weiter zur naechsten.
  if (idle.length > 3) {
    return [{ tone: 'warn', text: `${idle.length} Gruppen ohne Befehl, sie halten`, group: idle[0].id, at: idle[0].pos }];
  }
  return idle.map((g) => ({ tone: 'warn', text: `${groupName(state, g)} ohne Befehl`, group: g.id, at: g.pos }));
});

registerCheck('moral', ({ state, side }) => groupsOf(state, side)
  .filter((g) => g.morale < LOW_MORALE)
  .map((g) => ({ tone: 'warn', text: `${groupName(state, g)}: Moral ${g.morale}`, group: g.id, at: g.pos })));

registerCheck('munition', ({ state, side }) => {
  const ammo = state.sides[side]?.supplies?.ammo ?? 0;
  return ammo < LOW_AMMO ? [{ tone: 'warn', text: `Wenig Munition (${ammo})` }] : [];
});

/** Alle Pruefpunkte, nach Anmeldereihenfolge; Fehler eines Pruefpunkts werden als Warnung gezeigt */
export function checklist(ctx) {
  const out = [];
  for (const [id, fn] of checks) {
    try {
      for (const item of fn(ctx) ?? []) out.push({ ...item, check: id });
    } catch (err) {
      out.push({ tone: 'warn', text: `Prüfung ${id} fehlgeschlagen: ${err.message}`, check: id });
    }
  }
  // Warnungen zuerst, sonst Reihenfolge beibehalten
  return out.map((e, i) => ({ e, i })).sort((p, q) => (p.e.tone === q.e.tone ? p.i - q.i : p.e.tone === 'warn' ? -1 : 1)).map((x) => x.e);
}

// Die Zahl steht in der Zusammenfassung schon in der eigenen Spalte
const VERBS = {
  hold: (n) => (n === 1 ? 'Gruppe hält ausdrücklich' : 'Gruppen halten ausdrücklich'),
  move: (n) => (n === 1 ? 'Gruppe bewegt sich' : 'Gruppen bewegen sich'),
  redeploy: (n) => (n === 1 ? 'Gruppe verlegt' : 'Gruppen verlegen'),
  assault: (n) => (n === 1 ? 'Gruppe stürmt' : 'Gruppen stürmen'),
};

/** Befehlsarten, die den Knopf "halten" verlangen (Plan 3.4: Sturm) */
export const HOLD_TYPES = new Set(['assault']);

/**
 * Zusammenfassung fuer den Commit.
 * Liefert { lines: [{ tone, count, text }], needsHold, count, warnings }.
 */
export function summarize({ state, side, orders, map = null, plans = {}, only = null }) {
  const byType = new Map();
  for (const o of orders) {
    if (!byType.has(o.type)) byType.set(o.type, []);
    byType.get(o.type).push(o);
  }
  const lines = [];
  const typeOrder = Object.keys(ORDER_TYPES);
  const types = [...byType.keys()].sort((p, q) => typeOrder.indexOf(p) - typeOrder.indexOf(q));
  for (const t of types) {
    const list = byType.get(t);
    const who = list.map((o) => {
      const g = getGroup(state, o.group);
      const dest = o.path?.length ? o.path[o.path.length - 1] : o.target;
      return g ? groupName(state, g) + (dest ? ` nach ${cellLabel(dest.x, dest.y)}` : '') : o.group;
    });
    const head = VERBS[t] ? VERBS[t](list.length) : ORDER_TYPES[t]?.label ?? t;
    lines.push({ tone: 'own', count: String(list.length), text: `${head}: ${who.join(', ')}`, type: t });
  }
  const has = new Set(orders.map((o) => o.group));
  const idle = groupsOf(state, side).filter((g) => (!only || only(g)) && !has.has(g.id) && g.status !== 'rest');
  if (idle.length) {
    lines.push({ tone: 'warn', count: String(idle.length), text: `${idle.length === 1 ? 'Gruppe' : 'Gruppen'} ohne Befehl (${idle.map((g) => groupName(state, g)).join(', ')}), ${idle.length === 1 ? 'hält' : 'halten'}` });
  }
  const checks = checklist({ state, side, orders, map, plans, only });
  for (const c of checks) if (c.summary && c.tone !== 'warn') lines.push({ tone: 'own', count: '·', text: c.text });
  const warnings = checks.filter((c) => c.tone === 'warn' && c.check !== 'ohne-befehl');
  for (const w of warnings) lines.push({ tone: 'warn', count: '!', text: w.text });
  if (!lines.length) lines.push({ tone: 'own', count: '0', text: 'Keine Gruppen' });
  return { lines, needsHold: orders.some((o) => HOLD_TYPES.has(o.type)), count: orders.length, warnings };
}
