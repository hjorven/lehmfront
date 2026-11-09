// Etappe: Ertraege, Nachbarboni, Bauvorschau, Etappenstufen (Plan 6). Reine Funktionen.
// Regeln aus CLAUDE.md: kein DOM, kein Zufall, keine Mutation der Eingaben, immer nach ID sortieren.
//
// Form einer Etappe:
//   { fields: [{ x, y, ground, height }], buildings: [{ id, type, x, y, remaining?, damaged? }], rewards?: { [level]: rewardId } }
// remaining > 0: im Bau, noch so viele Stellungsrunden. damaged: beschaedigt, bringt nichts bis zur Reparatur.

import { BUILDINGS, RESOURCES, ETAPPE_LEVELS } from './config/buildings.js';
import { GROUNDS } from './config/grounds.js';

const key = (x, y) => x + ',' + y;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

// Spalte als Buchstabe (A, B, ... Z, AA, AB ...), Zeile ab 1: Feld C3 = x 2, y 2
export function fieldName(x, y) {
  let n = x + 1, s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s + (y + 1);
}

export function neighbors4(x, y) {
  return DIRS.map(([dx, dy]) => ({ x: x + dx, y: y + dy }));
}

// "+3 Verpflegung" bzw. "Erschöpfung −2" (negative Wirkungen wie im Mockup)
export function formatAmount(res, n) {
  const r = RESOURCES[res] || { label: res };
  if (r.negative) return `${r.label} ${n < 0 ? '+' : '−'}${Math.abs(n)}`;
  return `${n < 0 ? '−' : '+'}${Math.abs(n)} ${r.label}`;
}

function index(etappe) {
  const fields = new Map();
  for (const f of etappe.fields) fields.set(key(f.x, f.y), f);
  const at = new Map();
  for (const b of [...etappe.buildings].sort(byId)) if (!at.has(key(b.x, b.y))) at.set(key(b.x, b.y), b);
  return { fields, at };
}

const isActive = (b) => !!b && !(b.remaining > 0) && !b.damaged;

// Laeuft ein Gebaeude wirklich? Fertig, heil und Pflicht-Nachbar vorhanden (z. B. Bahnhof braucht Gleis).
// Pflicht-Nachbarn selbst werden nur auf isActive geprueft, damit keine Kreise entstehen.
function needsMet(idx, b) {
  const def = BUILDINGS[b.type];
  if (!def || !def.needs) return true;
  return neighbors4(b.x, b.y).some((n) => {
    const nb = idx.at.get(key(n.x, n.y));
    return isActive(nb) && def.needs.building.includes(nb.type);
  });
}
const isRunning = (idx, b) => isActive(b) && needsMet(idx, b);

function addTo(target, add, factor = 1) {
  for (const res of Object.keys(add).sort()) target[res] = (target[res] || 0) + add[res] * factor;
}

function nameList(types) {
  return types.map((t) => BUILDINGS[t].name).join(' und ');
}

// Ertrag eines einzelnen Gebaeudes mit allen Nachbarboni und Begruendungen.
function yieldOf(idx, b) {
  const def = BUILDINGS[b.type];
  const out = { id: b.id, type: b.type, x: b.x, y: b.y, base: {}, bonus: [], missing: [], blocked: null, total: {}, every: def ? def.every || 1 : 1 };
  if (!def) { out.blocked = 'unbekannter Gebäudetyp'; return out; }
  addTo(out.base, def.yield || {});
  const field = idx.fields.get(key(b.x, b.y)) || { ground: 'wiese', height: 0 };
  const near = neighbors4(b.x, b.y);

  for (const rule of def.bonus || []) {
    let count = 0, from = [], source = '';
    if (rule.per.building) {
      const types = new Set();
      for (const n of near) {
        const nb = idx.at.get(key(n.x, n.y));
        if (nb && isRunning(idx, nb) && rule.per.building.includes(nb.type)) { count++; from.push(n); types.add(nb.type); }
      }
      source = nameList(rule.per.building.filter((t) => types.has(t)));
    } else if (rule.per.ground) {
      for (const n of near) {
        const nf = idx.fields.get(key(n.x, n.y));
        if (nf && rule.per.ground.includes(nf.ground)) { count++; from.push(n); }
      }
      source = rule.per.ground.map((g) => (GROUNDS[g] ? GROUNDS[g].label : g)).join(' und ');
    } else if (rule.per.height) {
      count = Math.max(0, field.height | 0);
      source = 'Höhe ' + count;
    }
    if (count > 0) {
      for (const res of Object.keys(rule.add).sort()) {
        const amount = rule.add[res] * count;
        let reason;
        if (rule.per.height) reason = `${formatAmount(res, amount)} durch ${source}`;
        else reason = `${formatAmount(res, amount)} durch ${source} (${count > 1 ? count + ' Nachbarn' : 'Nachbar'})`;
        out.bonus.push({ res, amount, count, reason, from });
      }
    }
  }
  if ((def.bonus || []).length && !out.bonus.length && def.missing) out.missing.push(def.missing);

  if (def.needs && !needsMet(idx, b)) out.blocked = def.needs.text;
  if (b.remaining > 0) out.blocked = `im Bau, noch ${b.remaining} ${b.remaining === 1 ? 'Stellungsrunde' : 'Stellungsrunden'}`;
  else if (b.damaged) out.blocked = 'beschädigt, bringt nichts bis zur Reparatur';

  if (!out.blocked) {
    addTo(out.total, out.base);
    for (const bo of out.bonus) addTo(out.total, { [bo.res]: bo.amount });
  }
  return out;
}

export function buildingYield(etappe, building) {
  return yieldOf(index(etappe), building);
}

// Gesamtertrag pro Stellungsrunde. Ertraege mit "every" (Feldpost) stehen getrennt unter periodic.
export function etappeYield(etappe) {
  const idx = index(etappe);
  const total = {}, periodic = [];
  const buildings = [];
  for (const b of [...etappe.buildings].sort(byId)) {
    if (idx.at.get(key(b.x, b.y)) !== b) continue; // doppelt belegtes Feld: nur das erste zaehlt
    const y = yieldOf(idx, b);
    buildings.push(y);
    if (y.every > 1) { for (const res of Object.keys(y.total).sort()) if (y.total[res]) periodic.push({ id: b.id, res, amount: y.total[res], every: y.every }); }
    else addTo(total, y.total);
  }
  // Stufe zaehlt nur, was die Gebaeude leisten; Belohnungen heben die Stufe nicht selbst an
  const levelLoren = total.loren || 0;
  for (const r of chosenRewards(etappe)) if (r.add) addTo(total, r.add);
  for (const res of Object.keys(total)) if (!total[res]) delete total[res];
  return { total: sortKeys(total), periodic, buildings, levelLoren };
}

function sortKeys(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function chosenRewards(etappe) {
  const out = [];
  const chosen = etappe.rewards || {};
  for (const L of ETAPPE_LEVELS) {
    const id = chosen[L.level];
    const r = id && L.rewards.find((x) => x.id === id);
    if (r) out.push(r);
  }
  return out;
}

// Bauzeit nach Belohnungen (Pionierpark), mindestens eine Stellungsrunde
export function buildTimeFor(etappe, type) {
  const def = BUILDINGS[type];
  if (!def) return 0;
  let t = def.buildTime;
  for (const r of chosenRewards(etappe)) if (r.buildTime) t += r.buildTime;
  return Math.max(1, t);
}

// Darf hier gebaut werden? ctx: { act = 1, material } (material optional; fehlt es, wird nicht geprueft)
export function canBuild(etappe, x, y, type, ctx = {}) {
  const def = BUILDINGS[type];
  if (!def) return { ok: false, reason: 'unbekannter Gebäudetyp' };
  const act = ctx.act || 1;
  if (def.act > act) return { ok: false, reason: `erst ab Akt ${def.act}` };
  const idx = index(etappe);
  const f = idx.fields.get(key(x, y));
  if (!f) return { ok: false, reason: 'Feld liegt nicht in der Etappe' };
  const g = GROUNDS[f.ground];
  if (!g || !g.buildable) return { ok: false, reason: g ? g.why : 'unbekannter Boden' };
  const there = idx.at.get(key(x, y));
  if (there) return { ok: false, reason: `Feld ist belegt: ${BUILDINGS[there.type] ? BUILDINGS[there.type].name : there.type}` };
  if (ctx.material != null && def.cost > ctx.material) return { ok: false, reason: `zu wenig Material (${def.cost} nötig, ${ctx.material} da)` };
  return { ok: true, reason: null };
}

function nextId(etappe) {
  const used = new Set(etappe.buildings.map((b) => b.id));
  let n = etappe.buildings.length + 1;
  const make = (i) => 'g' + String(i).padStart(3, '0');
  while (used.has(make(n))) n++;
  return make(n);
}

function diff(after, before) {
  const out = {};
  for (const res of [...new Set([...Object.keys(after), ...Object.keys(before)])].sort()) {
    const d = (after[res] || 0) - (before[res] || 0);
    if (d) out[res] = d;
  }
  return out;
}

// Vorschau vor dem Bauen: zeigt den Zustand NACH der Fertigstellung (in buildTime Stellungsrunden).
// Eigener Ertrag mit Nachbarboni, was es den Nachbarn bringt, Gesamtaenderung, Etappenstufe.
export function previewBuild(etappe, x, y, type, ctx = {}) {
  const def = BUILDINGS[type];
  const check = canBuild(etappe, x, y, type, ctx);
  const probe = { id: '~vorschau', type, x, y };
  const others = etappe.buildings.filter((b) => !(b.x === x && b.y === y));
  const hypo = { ...etappe, buildings: [...others, probe] };
  const own = buildingYield(hypo, probe);
  const before = etappeYield(etappe);
  const after = etappeYield(hypo);
  const neighbors = [];
  const beforeById = new Map(before.buildings.map((b) => [b.id, b]));
  for (const a of after.buildings) {
    if (a.id === probe.id) continue;
    const b = beforeById.get(a.id);
    if (!b) continue;
    const d = diff(a.total, b.total);
    const keys = Object.keys(d);
    if (!keys.length) continue;
    const name = BUILDINGS[a.type].name;
    const lines = keys.map((res) => `${name} ${fieldName(a.x, a.y)}: ${formatAmount(res, d[res])}`);
    neighbors.push({ id: a.id, type: a.type, x: a.x, y: a.y, delta: d, lines });
  }
  const levelBefore = etappeLevel(before.levelLoren).level;
  const levelAfter = etappeLevel(after.levelLoren).level;
  const from = [];
  for (const bo of own.bonus) for (const p of bo.from) from.push(p);
  for (const n of neighbors) from.push({ x: n.x, y: n.y });
  return {
    type, name: def ? def.name : type, x, y,
    ok: check.ok, reason: check.reason,
    cost: def ? def.cost : 0, buildTime: buildTimeFor(etappe, type),
    own, neighbors,
    totalDelta: diff(after.total, before.total),
    levelBefore, levelAfter,
    highlight: uniqCoords(from),
  };
}

function uniqCoords(list) {
  const seen = new Set(), out = [];
  for (const p of list) { const k = key(p.x, p.y); if (!seen.has(k)) { seen.add(k); out.push({ x: p.x, y: p.y }); } }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

// Alle Bauoptionen fuer ein Feld; Gebaeude spaeterer Akte bleiben verborgen. Baubare zuerst, sonst Reihenfolge aus der Konfiguration.
export function buildOptions(etappe, x, y, ctx = {}) {
  const act = ctx.act || 1;
  const list = Object.keys(BUILDINGS).filter((t) => BUILDINGS[t].act <= act).map((t) => previewBuild(etappe, x, y, t, ctx));
  return [...list.filter((o) => o.ok), ...list.filter((o) => !o.ok)];
}

// Bauen: neues Gebaeude im Bau. Gibt { ok, reason, etappe, building, cost } zurueck, die Eingabe bleibt unveraendert.
// Das Material zieht der Aufrufer ab (cost), weil der Vorrat im Spielzustand liegt, nicht in der Etappe.
export function placeBuilding(etappe, x, y, type, ctx = {}) {
  const check = canBuild(etappe, x, y, type, ctx);
  if (!check.ok) return { ok: false, reason: check.reason, etappe, building: null };
  const building = { id: nextId(etappe), type, x, y, remaining: buildTimeFor(etappe, type) };
  return { ok: true, reason: null, etappe: { ...etappe, buildings: [...etappe.buildings, building] }, building, cost: BUILDINGS[type].cost };
}

// Reparatur: halbe Baukosten (aufgerundet), eine Stellungsrunde Arbeit. Gibt { ok, reason, etappe, cost } zurueck.
export function repairCost(type) {
  const def = BUILDINGS[type];
  return def ? Math.floor((def.cost + 1) / 2) : 0;
}
export function repairBuilding(etappe, id, ctx = {}) {
  const b = etappe.buildings.find((x) => x.id === id);
  if (!b) return { ok: false, reason: 'Gebäude nicht gefunden', etappe, cost: 0 };
  if (!b.damaged) return { ok: false, reason: 'nicht beschädigt', etappe, cost: 0 };
  const cost = repairCost(b.type);
  if (ctx.material != null && cost > ctx.material) return { ok: false, reason: `zu wenig Material (${cost} nötig, ${ctx.material} da)`, etappe, cost };
  const buildings = etappe.buildings.map((x) => (x.id === id ? { ...x, damaged: false, remaining: 1 } : x));
  return { ok: true, reason: null, etappe: { ...etappe, buildings }, cost };
}

// Eine Stellungsrunde Bauarbeit: remaining sinkt um 1. finished listet die IDs, die jetzt fertig sind.
export function advanceConstruction(etappe) {
  const finished = [];
  const buildings = [...etappe.buildings].sort(byId).map((b) => {
    if (!(b.remaining > 0)) return b;
    const remaining = b.remaining - 1;
    if (remaining === 0) finished.push(b.id);
    return { ...b, remaining };
  });
  return { etappe: { ...etappe, buildings }, finished };
}

// Etappenstufe aus der Versorgungsleistung (Loren pro Runde)
export function etappeLevel(loren) {
  let cur = ETAPPE_LEVELS[0];
  for (const L of ETAPPE_LEVELS) if (loren >= L.minLoren) cur = L;
  const next = ETAPPE_LEVELS.find((L) => L.level === cur.level + 1) || null;
  return { level: cur.level, minLoren: cur.minLoren, next: next ? next.minLoren : null, loren };
}

// Erreichte Stufen, fuer die noch keine Belohnung gewaehlt wurde. etappe.best (hoechste je erreichte Stufe,
// Spielzustand) haelt das Angebot offen, auch wenn Beschuss die Leistung vor der Wahl wieder senkt.
export function pendingRewards(etappe) {
  const level = Math.max(etappeLevel(etappeYield(etappe).levelLoren).level, etappe.best | 0);
  const chosen = etappe.rewards || {};
  return ETAPPE_LEVELS.filter((L) => L.level > 1 && L.level <= level && !chosen[L.level]).map((L) => ({ level: L.level, rewards: L.rewards }));
}

export function chooseReward(etappe, level, rewardId) {
  const L = ETAPPE_LEVELS.find((l) => l.level === level);
  if (!L || !L.rewards.length) return { ok: false, reason: 'diese Stufe hat keine Belohnung', etappe };
  if ((etappe.rewards || {})[level]) return { ok: false, reason: 'für diese Stufe ist schon gewählt', etappe };
  if (!pendingRewards(etappe).some((p) => p.level === level)) return { ok: false, reason: 'Stufe noch nicht erreicht', etappe };
  if (!L.rewards.some((r) => r.id === rewardId)) return { ok: false, reason: 'unbekannte Belohnung', etappe };
  return { ok: true, reason: null, etappe: { ...etappe, rewards: { ...(etappe.rewards || {}), [level]: rewardId } } };
}
