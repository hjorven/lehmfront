// Versorgung als Lorenkapazitaet (Plan 4.1 Nr. 10, 6, 7.4). Reine Funktionen.
// Regeln aus CLAUDE.md: kein DOM, kein Date, kein Math.random, immer nach ID sortieren.
//
// Modell:
// - Depot (Kartengebaeude "depot" der eigenen Seite) haelt Munition, Verpflegung, Material: state.sides[s].supplies.
// - Die Front ist in Abschnitte A, B, C ... von Nord nach Sued geteilt (Baender gleicher Hoehe).
//   Jeder Abschnitt hat einen eigenen Vorrat in den Unterstaenden: state.sides[s].supply.sections[id].
// - Das Netz: Depot -> Gleis (Feldbahn) -> Gleisende/Umschlagplatz -> Laufgraeben -> Front. Traeger
//   ueberbruecken bis LINK Felder zu Fuss. Gebrochene Gleise (state.cells[k].railBroken), verschuettete
//   Graeben (trenchBlocked) und Feinde im Graben unterbrechen das Netz.
// - Lorenplan: so viele Wagen, wie die Feldbahn je Stellungsrunde faehrt, jeder mit Ladung und Ziel.
//   Wagen fahren voll nach vorn und nehmen Verwundete mit zurueck; Sanitaetsloren fahren leer und
//   nehmen mehr Verwundete mit.
// - Abgeschnittene Abschnitte bekommen nichts, zehren vom Vorrat, dann von der eisernen Ration,
//   dann sinkt die Moral.
// - Sanitaetskette: wartende Verwundete -> Lore -> Verbandsplatz/Lazarett -> nach einigen Runden
//   zurueck zur Gruppe, mit Erfahrung.
//
// Fuer andere Pakete:
// - addWounded(state, map, side, at, n, groupId): Verwundete aus Feuer und Nahkampf (P05, P06, P09)
// - takeStock(state, side, sectionId, res, n): Material fuer Grabenausbau (P04), Munition fuer Feuer (P05)
// - sectionAt(map, side, y): Abschnitt eines Feldes
import {
  LOADS, LOAD_CYCLE, RESOURCES, CART_LOAD, DEFAULT_CARTS, UPKEEP, START_STOCK, STOCK_CAP, IRON_RATIONS,
  DEFAULT_INCOME, WOUNDED_PER_CART, WOUNDED_PER_MEDIC_CART, WAITING_DEATH_PERCENT, TRUST_PER_WAITING_SECTION,
  MAX_TRUST_LOSS, HEAL_TURNS, VETERANS_PER_XP, BUILDING_ROLES, LINK, DEFAULT_SECTIONS, SECTION_LETTERS,
} from './config/supply.js';
import { seesPoint } from './view.js';

const key = (x, y) => x + ',' + y;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Zonenseite einer Spielseite auf der Karte: Seite a spielt die eigene ("own") Kartenhaelfte */
export function mapSide(side) {
  return side === 'a' ? 'own' : 'enemy';
}

function cell(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height ? map.cells[y * map.width + x] : null;
}

function surname(name) {
  const i = (name ?? '').indexOf(' ');
  return i < 0 ? name ?? '' : name.slice(i + 1);
}

function cellText(p) {
  return `${p.x + 1}/${p.y + 1}`;
}

// ---------------------------------------------------------------- Abschnitte

/** Abschnitte von Nord nach Sued: [{ id, label, y0, y1 }] (y1 einschliesslich) */
export function sectionsOf(map) {
  const n = Math.max(1, Math.min(SECTION_LETTERS.length, map.supply?.sections ?? DEFAULT_SECTIONS, map.height));
  const out = [];
  for (let i = 0; i < n; i++) {
    const y0 = Math.floor((i * map.height) / n);
    const y1 = Math.floor(((i + 1) * map.height) / n) - 1;
    const id = SECTION_LETTERS[i];
    out.push({ id, label: 'Abschnitt ' + id, y0, y1 });
  }
  return out;
}

/** Abschnitt einer Zeile */
export function sectionAt(map, y) {
  const list = sectionsOf(map);
  return (list.find((s) => y >= s.y0 && y <= s.y1) ?? list[list.length - 1]).id;
}

// ---------------------------------------------------------------- Graeben, Gleise, Gebaeude im Spielzustand

/** Graben eines Feldes: Spielzustand vor Karte (P04 legt neue Graeben in state.cells[k].trench an) */
export function trenchAt(map, state, x, y) {
  const sc = state.cells?.[key(x, y)];
  if (sc && Object.hasOwn(sc, 'trench')) return sc.trench;
  return cell(map, x, y)?.trench ?? null;
}

export function railAt(map, state, x, y) {
  const sc = state.cells?.[key(x, y)];
  if (sc?.railBroken) return false;
  if (sc && Object.hasOwn(sc, 'rail')) return !!sc.rail;
  return !!cell(map, x, y)?.rail;
}

/** Gebaeude ist beschaedigt, wenn eines seiner Felder buildingDamaged traegt (P09/P11) */
function buildingDown(state, b) {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (state.cells?.[key(x, y)]?.buildingDamaged) return true;
  return false;
}

/** Laufende Kartengebaeude einer Seite mit einer Rolle (depot, kitchen, aidpost, hospital), nach ID */
export function buildingsWithRole(map, state, side, role) {
  const types = BUILDING_ROLES[role] ?? [];
  return (map.buildings ?? []).filter((b) => (b.side ?? 'own') === mapSide(side) && types.includes(b.type) && !buildingDown(state, b));
}

function cellsOf(b) {
  const out = [];
  for (let y = b.y; y < b.y + (b.h ?? 1); y++) for (let x = b.x; x < b.x + (b.w ?? 1); x++) out.push({ x, y });
  return out;
}

function hasDepotOnMap(map, side) {
  return (map.buildings ?? []).some((b) => (b.side ?? 'own') === mapSide(side) && BUILDING_ROLES.depot.includes(b.type));
}

// ---------------------------------------------------------------- Netz

// fog: nur Feinde, die die Seite sieht (Vorschau im Fenster, Overlay, Pruefpunkt). Die Aufloesung kennt alle.
function enemyAt(state, side, fog = false) {
  const s = new Set();
  for (const g of state.groups) {
    if (g.side === side || g.status === 'lost') continue;
    if (fog && !seesPoint(state, side, g.pos)) continue;
    s.add(key(g.pos.x, g.pos.y));
  }
  return s;
}

/**
 * Breitensuche Depot -> Gleis -> Graben. ignoreBreaks: Brueche zaehlen nicht (fuer die Suche nach der Bruchstelle).
 * Liefert { nodes: Map(key -> { x, y, kind: 'depot'|'rail'|'trench', parent }), order: [key] }.
 */
function searchNetwork(map, state, side, { ignoreBreaks = false, fog = false } = {}) {
  const ms = mapSide(side);
  const foes = enemyAt(state, side, fog);
  const nodes = new Map();
  const order = [];
  const queue = [];
  const push = (x, y, kind, parent) => {
    const k = key(x, y);
    if (nodes.has(k)) return;
    nodes.set(k, { x, y, kind, parent });
    order.push(k);
    queue.push(k);
  };
  const railOk = (x, y) => (ignoreBreaks ? !!cell(map, x, y)?.rail || railAt(map, state, x, y) : railAt(map, state, x, y));
  const trenchOk = (x, y) => {
    const t = ignoreBreaks ? (trenchAt(map, state, x, y) ?? cell(map, x, y)?.trench) : trenchAt(map, state, x, y);
    if (!t || t.side !== ms) return false;
    if (ignoreBreaks) return true;
    return !state.cells?.[key(x, y)]?.trenchBlocked && !foes.has(key(x, y));
  };
  const depots = ignoreBreaks
    ? (map.buildings ?? []).filter((b) => (b.side ?? 'own') === ms && BUILDING_ROLES.depot.includes(b.type))
    : buildingsWithRole(map, state, side, 'depot');
  for (const d of depots) for (const c of cellsOf(d)) push(c.x, c.y, 'depot', null);

  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const n = nodes.get(k);
    const far = n.kind === 'trench' ? 1 : LINK; // Traeger ueberbruecken kurze Luecken zwischen Depot, Gleis und Graben
    for (let dy = -far; dy <= far; dy++) {
      for (let dx = -far; dx <= far; dx++) {
        if (!dx && !dy) continue;
        const x = n.x + dx, y = n.y + dy;
        if (!cell(map, x, y) || nodes.has(key(x, y))) continue;
        const near = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
        if (railOk(x, y) && (n.kind !== 'trench') && (near || n.kind === 'depot')) push(x, y, 'rail', k);
        else if (trenchOk(x, y) && (near || n.kind === 'rail')) push(x, y, 'trench', k);
      }
    }
  }
  return { nodes, order };
}

function pathTo(nodes, k) {
  const out = [];
  let cur = k;
  while (cur) {
    const n = nodes.get(cur);
    out.push({ x: n.x, y: n.y, kind: n.kind });
    cur = n.parent;
  }
  return out.reverse();
}

/** Ziel eines Abschnitts: das erreichte Grabenfeld nahe der Mitte des Bandes, bei Gleichstand das erste */
function targetIn(nodes, order, sec) {
  const mid2 = sec.y0 + sec.y1; // doppelte Mitte, ganzzahlig
  let best = null, bestD = Infinity;
  for (const k of order) {
    const n = nodes.get(k);
    if (n.kind !== 'trench' || n.y < sec.y0 || n.y > sec.y1) continue;
    const d = Math.abs(2 * n.y - mid2);
    if (d < bestD) { best = k; bestD = d; }
  }
  return best;
}

function blockedWhy(map, state, side, p, fog) {
  const sc = state.cells?.[key(p.x, p.y)];
  if (p.kind === 'rail' && !railAt(map, state, p.x, p.y)) return 'Gleis zerschossen';
  if (p.kind === 'trench') {
    if (sc?.trenchBlocked) return 'Laufgraben verschüttet';
    if (enemyAt(state, side, fog).has(key(p.x, p.y))) return 'Feind im Graben';
    if (!trenchAt(map, state, p.x, p.y)) return 'Graben eingeebnet';
  }
  if (p.kind === 'depot') return 'Depot getroffen';
  return null;
}

/**
 * Versorgungsnetz einer Seite. Liefert pro Abschnitt { id, label, y0, y1, connected, route: [{x,y,kind}],
 * cutAt: {x,y} | null, cutWhy, anchor: {x,y} }. Ohne Depot auf der Karte gilt die Seite als versorgt
 * (abstract: true), z. B. fuer den Gegner auf der Asse-Karte. opts.fog: nur gesehene Feinde sperren (Anzeige).
 */
export function supplyNetwork(map, state, side, { fog = false } = {}) {
  const sections = sectionsOf(map);
  if (!hasDepotOnMap(map, side)) {
    return {
      abstract: true,
      sections: sections.map((s) => ({ ...s, connected: true, route: [], cutAt: null, cutWhy: null, anchor: frontAnchor(map, state, side, s) })),
    };
  }
  const live = searchNetwork(map, state, side, { fog });
  let ghost = null;
  const out = sections.map((s) => {
    const t = targetIn(live.nodes, live.order, s);
    if (t) {
      const route = pathTo(live.nodes, t);
      return { ...s, connected: true, route, cutAt: null, cutWhy: null, anchor: route[route.length - 1] };
    }
    ghost ??= searchNetwork(map, state, side, { ignoreBreaks: true });
    const g = targetIn(ghost.nodes, ghost.order, s);
    if (!g) return { ...s, connected: false, route: [], cutAt: null, cutWhy: 'kein Graben im Abschnitt', anchor: frontAnchor(map, state, side, s) };
    const route = pathTo(ghost.nodes, g);
    let cutAt = null, cutWhy = null;
    for (const p of route) {
      const why = blockedWhy(map, state, side, p, fog);
      if (why && !live.nodes.has(key(p.x, p.y))) { cutAt = { x: p.x, y: p.y }; cutWhy = why; break; }
    }
    return { ...s, connected: false, route, cutAt, cutWhy: cutWhy ?? 'keine Verbindung', anchor: route[route.length - 1] };
  });
  return { abstract: false, sections: out };
}

/** Ein Feld an der Front eines Abschnitts (fuer Ereignisse ohne Netz) */
function frontAnchor(map, state, side, sec) {
  const own = state.groups.filter((g) => g.side === side && g.status !== 'lost' && g.pos.y >= sec.y0 && g.pos.y <= sec.y1).sort((a, b) => cmp(a.id, b.id));
  if (own.length) return { x: own[0].pos.x, y: own[0].pos.y };
  return { x: side === 'a' ? Math.floor(map.width / 3) : Math.floor((2 * map.width) / 3), y: Math.floor((sec.y0 + sec.y1) / 2) };
}

// ---------------------------------------------------------------- Zustand

function emptySection() {
  return { ...START_STOCK, wounded: {} };
}

/** Versorgungsteil des Zustands anlegen (nur auf Entwurfszustaenden in Phasen aufrufen) */
export function ensureSupply(state, map, side) {
  const s = state.sides[side];
  s.supply ??= {};
  const sup = s.supply;
  sup.sections ??= {};
  for (const sec of sectionsOf(map)) {
    const cur = sup.sections[sec.id] ?? {};
    sup.sections[sec.id] = { ...emptySection(), ...cur, wounded: { ...(cur.wounded ?? {}) } };
  }
  sup.hospital ??= [];
  sup.plan ??= null;
  sup.stats ??= {};
  sup.stats.woundedCarried ??= 0;
  sup.stats.depotEmpty ??= 0;
  sup.stats.cutTurns ??= 0;
  sup.reserveMen ??= 0;
  return sup;
}

/** Lesende Sicht auf den Versorgungsteil, ohne den Zustand zu veraendern */
export function supplyOf(state, map, side) {
  const copy = { sides: { [side]: { supply: structuredClone(state.sides[side]?.supply ?? {}) } } };
  return ensureSupply(copy, map, side);
}

export function woundedCount(section) {
  let n = 0;
  for (const k of Object.keys(section?.wounded ?? {})) n += section.wounded[k];
  return n;
}

/**
 * Loren je Stellungsrunde (Kapazitaet der Feldbahn): supplies.cartsTotal. Pakete, die Kapazitaet nehmen
 * oder geben (P09 Feldbahn zerschossen, P11 Etappe), aendern cartsTotal. supplies.carts ist nur Anzeige.
 */
export function capacityOf(state, side) {
  const s = state.sides[side]?.supplies ?? {};
  const n = s.cartsTotal ?? DEFAULT_CARTS;
  return Math.max(0, Math.floor(n));
}

function hasReport(state, side, id) {
  const r = state.sides[side]?.reports;
  return Array.isArray(r) ? r.includes(id) : !!r?.[id];
}

/** Verwundete je Wagen auf dem Rueckweg (Erfahrungsbericht "Sanitaetsloren" verdoppelt) */
export function woundedPerWagon(state, side, load) {
  const base = load === 'medic' ? WOUNDED_PER_MEDIC_CART : WOUNDED_PER_CART;
  return hasReport(state, side, 'sanitaetsloren') ? base * 2 : base;
}

/** Gruppen an der Front eines Abschnitts (nicht in der eigenen Etappe), nach ID */
export function frontGroups(map, state, side, sec) {
  const ms = mapSide(side);
  return state.groups
    .filter((g) => g.side === side && g.status !== 'lost' && g.pos.y >= sec.y0 && g.pos.y <= sec.y1)
    .filter((g) => { const c = cell(map, g.pos.x, g.pos.y); return !(c && c.zone === 'etappe' && c.side === ms); })
    .sort((a, b) => cmp(a.id, b.id));
}

/** Gruppen in der eigenen Etappe, die direkt am Depot essen */
function etappeGroups(map, state, side) {
  const ms = mapSide(side);
  return state.groups
    .filter((g) => g.side === side && g.status !== 'lost')
    .filter((g) => { const c = cell(map, g.pos.x, g.pos.y); return c && c.zone === 'etappe' && c.side === ms; })
    .sort((a, b) => cmp(a.id, b.id));
}

// ---------------------------------------------------------------- Lorenplan

/** Lorenplan pruefen: Liste von { load, to } auf die Kapazitaet kuerzen, Unbekanntes verwerfen */
export function normalizePlan(wagons, capacity, sectionIds) {
  const ids = new Set(sectionIds);
  const out = [];
  for (const w of Array.isArray(wagons) ? wagons : []) {
    if (out.length >= capacity) break;
    if (!w || !Object.hasOwn(LOADS, w.load) || !ids.has(w.to)) continue;
    out.push({ load: w.load, to: w.to });
  }
  return out;
}

/** Was ein Abschnitt je Runde verbraucht */
export function upkeepOf(map, state, side, sec) {
  const n = frontGroups(map, state, side, sec).length;
  return { food: n * UPKEEP.food, ammo: n * UPKEEP.ammo, groups: n };
}

/**
 * Vorschlag fuer einen Lorenplan: Wagen gehen dorthin, wo der Vorrat am kuerzesten reicht.
 * Wartende Verwundete bekommen eine Sanitaetslore. Abgeschnittene Abschnitte werden ausgelassen.
 */
export function suggestPlan(map, state, side, opts = {}) {
  const cap = capacityOf(state, side);
  const sup = supplyOf(state, map, side);
  const net = supplyNetwork(map, state, side, opts);
  const reach = net.sections.filter((s) => s.connected);
  const plan = [];
  if (!reach.length || !cap) return plan;
  const stock = {};
  for (const s of reach) stock[s.id] = { ...sup.sections[s.id], need: upkeepOf(map, state, side, s) };
  // Verwundete zuerst: ab zwei Wartenden eine Sanitaetslore
  for (const s of reach) {
    if (plan.length >= cap - 1) break;
    if (woundedCount(sup.sections[s.id]) >= 2) plan.push({ load: 'medic', to: s.id });
  }
  const depot = depotAfterIncome(state, map, side);
  let guard = 0;
  while (plan.length < cap && guard++ < 64) {
    let best = null, bestScore = Infinity;
    for (const s of reach) {
      const st = stock[s.id];
      for (const res of ['food', 'ammo']) {
        const per = st.need[res];
        if (!per) continue;
        if ((depot[res] ?? 0) <= 0) continue;
        // Runden, die der Vorrat reicht, in Vierteln (ganzzahlig)
        const score = Math.floor((st[res] * 4) / per);
        if (score < bestScore) { best = { s, res }; bestScore = score; }
      }
    }
    if (!best || bestScore >= 16) break; // ueberall Vorrat fuer vier Runden
    plan.push({ load: best.res, to: best.s.id });
    stock[best.s.id][best.res] += CART_LOAD;
    depot[best.res] = (depot[best.res] ?? 0) - CART_LOAD;
  }
  // Rest: Material nach vorn, wo am wenigsten liegt
  while (plan.length < cap && reach.length && (depot.material ?? 0) > 0) {
    const s = [...reach].sort((p, q) => stock[p.id].material - stock[q.id].material || cmp(p.id, q.id))[0];
    plan.push({ load: 'material', to: s.id });
    stock[s.id].material += CART_LOAD;
    depot.material -= CART_LOAD;
  }
  return plan;
}

/** Lorenplan, der gilt, wenn diese Runde keiner kommt: der letzte, sonst ein Vorschlag */
export function standingPlan(map, state, side, opts = {}) {
  const ids = sectionsOf(map).map((s) => s.id);
  const last = state.sides[side]?.supply?.plan;
  if (Array.isArray(last) && last.length) return normalizePlan(last, capacityOf(state, side), ids);
  return suggestPlan(map, state, side, opts);
}

/** Depot nach dem Nachschub dieser Runde (so rechnet die Runde, bevor die Loren fahren) */
export function depotAfterIncome(state, map, side) {
  const st = state.sides[side]?.supplies ?? {};
  const out = { ...st };
  if (!hasDepotOnMap(map, side) || buildingsWithRole(map, state, side, 'depot').length) {
    const income = { ...DEFAULT_INCOME, ...(st.income ?? {}) };
    for (const res of RESOURCES) out[res] = (out[res] ?? 0) + (income[res] ?? 0);
  }
  return out;
}

/**
 * Vorschau fuer das Lorenplan-Fenster (rein): was kommt je Abschnitt an, wie lange reicht der Vorrat danach,
 * wie viele Verwundete fahren zurueck. Rechnet wie die Runde: erst Nachschub ins Depot, dann die Loren,
 * was vorn keinen Platz hat, faehrt zurueck. opts.fog: nur gesehene Feinde sperren.
 */
export function planPreview(map, state, side, wagons, opts = {}) {
  const cap = capacityOf(state, side);
  const ids = sectionsOf(map).map((s) => s.id);
  const plan = normalizePlan(wagons, cap, ids);
  const sup = supplyOf(state, map, side);
  const net = supplyNetwork(map, state, side, opts);
  const depot = depotAfterIncome(state, map, side);
  const sections = net.sections.map((s) => ({
    id: s.id, label: s.label, connected: s.connected, cutAt: s.cutAt, cutWhy: s.cutWhy, anchor: s.anchor,
    delivered: { ammo: 0, food: 0, material: 0 }, carts: 0, medicCarts: 0, blockedCarts: 0,
    stock: { ammo: sup.sections[s.id].ammo, food: sup.sections[s.id].food, material: sup.sections[s.id].material },
    wounded: woundedCount(sup.sections[s.id]), woundedBack: 0,
    upkeep: upkeepOf(map, state, side, s),
    groups: frontGroups(map, state, side, s).map((g) => ({ id: g.id, name: surname(g.leader?.name) })),
  }));
  const byId = new Map(sections.map((s) => [s.id, s]));
  const wagonsOut = plan.map((w, i) => {
    const s = byId.get(w.to);
    const res = LOADS[w.load].res;
    let amount = 0, blocked = !s.connected, empty = false;
    if (!blocked) {
      if (res) {
        amount = Math.min(CART_LOAD, Math.max(0, depot[res] ?? 0));
        const put = Math.max(0, Math.min(STOCK_CAP[res] - s.stock[res] - s.delivered[res], amount));
        depot[res] = (depot[res] ?? 0) - put;
        s.delivered[res] += put;
        empty = amount === 0;
        s.carts++;
      } else s.medicCarts++;
    } else s.blockedCarts++;
    return { index: i, ...w, amount, blocked, empty };
  });
  // Verwundete: zuerst Sanitaetsloren, dann beladene Wagen
  for (const w of [...wagonsOut].sort((p, q) => (p.load === 'medic' ? 0 : 1) - (q.load === 'medic' ? 0 : 1) || p.index - q.index)) {
    if (w.blocked) continue;
    const s = byId.get(w.to);
    const take = Math.min(s.wounded - s.woundedBack, woundedPerWagon(state, side, w.load));
    if (take > 0) { s.woundedBack += take; w.wounded = take; }
  }
  for (const s of sections) {
    s.after = {};
    s.rounds = {};
    for (const res of RESOURCES) s.after[res] = Math.min(STOCK_CAP[res], s.stock[res] + s.delivered[res]);
    for (const res of ['food', 'ammo']) {
      const per = s.upkeep[res];
      s.rounds[res] = per ? Math.floor(s.after[res] / per) : null;
    }
    s.woundedLeft = s.wounded - s.woundedBack;
  }
  return {
    capacity: cap, used: plan.length, plan, wagons: wagonsOut, sections,
    woundedBack: sections.reduce((n, s) => n + s.woundedBack, 0),
    returning: wagonsOut.filter((w) => w.wounded).length,
    depot,
  };
}

// ---------------------------------------------------------------- Schnittstellen fuer andere Phasen

/**
 * Verwundete melden (Feuer, Nahkampf, Artillerie). Sie warten im Abschnitt auf eine Lore.
 * Nur auf Entwurfszustaenden in Phasen aufrufen. Liefert die Abschnitts-ID.
 */
export function addWounded(state, map, side, at, n, groupId) {
  const sup = ensureSupply(state, map, side);
  const id = sectionAt(map, at.y);
  const sec = sup.sections[id];
  const k = groupId ?? '-';
  sec.wounded[k] = (sec.wounded[k] ?? 0) + Math.max(0, Math.floor(n));
  return id;
}

/** Vorrat eines Abschnitts verbrauchen. Liefert die tatsaechlich entnommene Menge. */
export function takeStock(state, map, side, sectionId, res, n) {
  const sup = ensureSupply(state, map, side);
  const sec = sup.sections[sectionId];
  if (!sec || !RESOURCES.includes(res)) return 0;
  const take = Math.max(0, Math.min(sec[res], Math.floor(n)));
  sec[res] -= take;
  return take;
}

// ---------------------------------------------------------------- Stellungsrunde

function healTurns(map, state, side) {
  if (buildingsWithRole(map, state, side, 'aidpost').length) return HEAL_TURNS.verbandsplatz;
  if (buildingsWithRole(map, state, side, 'hospital').length) return HEAL_TURNS.lazarett;
  return HEAL_TURNS.none;
}

function careAt(map, state, side) {
  const b = buildingsWithRole(map, state, side, 'aidpost')[0] ?? buildingsWithRole(map, state, side, 'hospital')[0]
    ?? buildingsWithRole(map, state, side, 'depot')[0];
  return b ? { x: b.x, y: b.y } : null;
}

function names(list) {
  if (list.length <= 1) return list.join('');
  return list.slice(0, -1).join(', ') + ' und ' + list[list.length - 1];
}

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

const RES_WORD = { ammo: 'Munition', food: 'Verpflegung', material: 'Material' };

/**
 * Versorgung einer Seite fuer eine Stellungsrunde ausfuehren. Veraendert state (Entwurf).
 * ctx: { map, turn, rng, emit(type, fields), plan: Wagenliste oder null }
 * Reihenfolge: Nachschub ins Depot, Loren fahren, Verbrauch, wartende Verwundete, Lazarett.
 */
export function runSupplySide(state, side, ctx) {
  const { map, turn, rng, emit } = ctx;
  const sup = ensureSupply(state, map, side);
  const sideState = state.sides[side];
  const depotSt = (sideState.supplies ??= {});
  const net = supplyNetwork(map, state, side);
  const depot = buildingsWithRole(map, state, side, 'depot')[0];
  const depotAt = depot ? { x: depot.x, y: depot.y } : net.sections[0].anchor;
  const secOf = new Map(net.sections.map((s) => [s.id, s]));
  const ids = net.sections.map((s) => s.id);
  const cap = capacityOf(state, side);

  // 1. Nachschub von hinten
  const filled = depotAfterIncome(state, map, side);
  for (const res of RESOURCES) depotSt[res] = filled[res] ?? 0;

  // 2. Lorenplan
  const plan = ctx.plan ? normalizePlan(ctx.plan, cap, ids) : standingPlan(map, state, side);
  sup.plan = plan.map((w) => ({ ...w }));
  const got = {};
  for (const id of ids) got[id] = { ammo: 0, food: 0, material: 0, carts: 0, blocked: 0, back: 0, medic: 0 };
  const emptyRes = new Set();
  plan.forEach((w) => {
    const s = secOf.get(w.to);
    if (!s.connected) { got[w.to].blocked++; return; }
    const res = LOADS[w.load].res;
    if (res) {
      const amount = Math.min(CART_LOAD, Math.max(0, depotSt[res] ?? 0));
      if (amount < CART_LOAD) emptyRes.add(res);
      depotSt[res] = (depotSt[res] ?? 0) - amount;
      const room = STOCK_CAP[res] - sup.sections[w.to][res];
      const put = Math.max(0, Math.min(room, amount));
      sup.sections[w.to][res] += put;
      depotSt[res] += amount - put; // was vorn keinen Platz hat, faehrt zurueck
      got[w.to][res] += put;
      got[w.to].carts++;
    } else got[w.to].medic++;
  });
  for (const res of [...emptyRes].sort()) {
    sup.stats.depotEmpty++;
    emit('depot_empty', {
      side, secret: true, res,
      reason: `Depot leer: ${RES_WORD[res]} reicht nicht für alle Loren, Wagen fahren halb leer.`,
      at: depotAt,
    });
  }

  // 3. Verwundete fahren zurueck (Sanitaetsloren zuerst)
  const care = careAt(map, state, side) ?? depotAt;
  const heal = healTurns(map, state, side);
  const order = plan.map((w, i) => ({ ...w, i })).sort((p, q) => (p.load === 'medic' ? 0 : 1) - (q.load === 'medic' ? 0 : 1) || p.i - q.i);
  for (const w of order) {
    if (!secOf.get(w.to).connected) continue;
    const sec = sup.sections[w.to];
    let room = woundedPerWagon(state, side, w.load);
    for (const g of Object.keys(sec.wounded).sort(cmp)) {
      if (room <= 0) break;
      const n = Math.min(room, sec.wounded[g]);
      if (n <= 0) continue;
      sec.wounded[g] -= n;
      if (!sec.wounded[g]) delete sec.wounded[g];
      room -= n;
      got[w.to].back += n;
      sup.hospital.push({ group: g, n, ready: turn + heal, from: w.to });
    }
  }
  sup.stats.woundedCarried += ids.reduce((n, id) => n + got[id].back, 0);

  // Meldungen je Abschnitt
  for (const id of ids) {
    const s = secOf.get(id), g = got[id];
    const parts = RESOURCES.filter((r) => g[r]).map((r) => `${g[r]} ${RES_WORD[r]}`);
    if (g.blocked) {
      emit('supply_blocked', {
        side, secret: true, section: id, carts: g.blocked,
        reason: `${plural(g.blocked, 'Lore', 'Loren')} nach ${s.label} ${g.blocked === 1 ? 'kommt' : 'kommen'} nicht durch: ${s.cutWhy}${s.cutAt ? ' bei ' + cellText(s.cutAt) : ''}. Die Ladung bleibt im Depot.`,
        at: s.cutAt ?? s.anchor,
      });
    }
    if (g.carts || g.medic) {
      const back = g.back ? `, ${plural(g.back, 'Verwundeter', 'Verwundete')} zurück` : '';
      emit('supply_delivered', {
        side, secret: true, minor: !g.back, section: id, carts: g.carts + g.medic, delivered: { ammo: g.ammo, food: g.food, material: g.material }, wounded: g.back,
        reason: `${s.label}: ${plural(g.carts + g.medic, 'Lore', 'Loren')}${parts.length ? ' mit ' + names(parts) : ''}${back}.`,
        at: s.anchor,
      });
    }
  }

  // 4. Verbrauch an der Front
  const kitchens = buildingsWithRole(map, state, side, 'kitchen').length > 0;
  for (const s of net.sections) {
    const sec = sup.sections[s.id];
    const groups = frontGroups(map, state, side, s);
    if (!groups.length) continue;
    const hungry = [], rationed = [], noAmmo = [], warm = [];
    for (const g of groups) {
      const who = surname(g.leader?.name);
      g.rations ??= IRON_RATIONS;
      g.hunger ??= 0;
      if (sec.food >= UPKEEP.food) {
        sec.food -= UPKEEP.food;
        g.hunger = 0;
        if (g.rations < IRON_RATIONS && sec.food > 0) { sec.food--; g.rations++; }
        if (kitchens && got[s.id].food > 0 && s.connected) { g.morale = Math.min(100, g.morale + 1); warm.push(who); }
      } else if (g.rations > 0) {
        sec.food = 0;
        g.rations--;
        rationed.push(who);
      } else {
        sec.food = 0;
        g.hunger++;
        g.morale = Math.max(0, g.morale - (2 + 2 * g.hunger));
        hungry.push({ who, g });
      }
      if (sec.ammo >= UPKEEP.ammo) { sec.ammo -= UPKEEP.ammo; g.ammoLow = false; }
      else {
        sec.ammo = 0;
        if (!g.ammoLow) noAmmo.push(who);
        g.ammoLow = true;
        g.morale = Math.max(0, g.morale - 2);
      }
    }
    const where = s.connected ? '' : ' Der Abschnitt ist abgeschnitten.';
    if (warm.length) {
      emit('warm_meal', { side, secret: true, minor: true, section: s.id, reason: `${s.label}: warmes Essen aus der Feldküche für ${names(warm)}. Moral +1.`, at: s.anchor });
    }
    if (rationed.length) {
      emit('iron_ration', { side, secret: true, section: s.id, reason: `${s.label}: keine Verpflegung mehr, ${names(rationed)} ${rationed.length === 1 ? 'isst' : 'essen'} die eiserne Ration.${where}`, at: s.anchor });
    }
    for (const h of hungry) {
      emit('hunger', {
        side, secret: true, section: s.id, group: h.g.id, hunger: h.g.hunger,
        reason: `Gruppe ${h.who} hungert seit ${plural(h.g.hunger, 'Runde', 'Runden')}.${where} Moral sinkt auf ${h.g.morale}.`,
        at: h.g.pos,
      });
    }
    if (noAmmo.length) {
      emit('ammo_short', { side, secret: true, section: s.id, reason: `${s.label}: keine Munition mehr in den Unterständen, bei ${names(noAmmo)} werden die Patronen gezählt.${where}`, at: s.anchor });
    }
  }
  if (net.sections.some((s) => !s.connected && frontGroups(map, state, side, s).length)) sup.stats.cutTurns++;

  // Etappe isst am Depot
  for (const g of etappeGroups(map, state, side)) {
    g.hunger ??= 0;
    g.rations ??= IRON_RATIONS;
    if ((depotSt.food ?? 0) >= UPKEEP.food) { depotSt.food -= UPKEEP.food; g.hunger = 0; continue; }
    depotSt.food = 0;
    if (g.rations > 0) { g.rations--; continue; }
    g.hunger++;
    g.morale = Math.max(0, g.morale - (2 + 2 * g.hunger));
    emit('hunger', {
      side, secret: true, group: g.id, hunger: g.hunger,
      reason: `Gruppe ${surname(g.leader?.name)} hungert in der Etappe seit ${plural(g.hunger, 'Runde', 'Runden')}: das Depot ist leer. Moral sinkt auf ${g.morale}.`,
      at: g.pos,
    });
  }

  // 5. Wartende Verwundete: ohne Sanitaeter sterben welche, jede wartende Stelle kostet Vertrauen
  let trustLoss = 0;
  for (const s of net.sections) {
    const sec = sup.sections[s.id];
    const waiting = woundedCount(sec);
    if (!waiting) continue;
    const medics = frontGroups(map, state, side, s).some((g) => g.type === 'medics');
    let died = 0;
    if (!medics) {
      for (const g of Object.keys(sec.wounded).sort(cmp)) {
        let dead = 0;
        for (let i = 0; i < sec.wounded[g]; i++) if (Math.floor(rng() * 100) < WAITING_DEATH_PERCENT) dead++;
        if (!dead) continue;
        sec.wounded[g] -= dead;
        if (!sec.wounded[g]) delete sec.wounded[g];
        died += dead;
        state.fallen ??= [];
        const grp = state.groups.find((x) => x.id === g);
        state.fallen.push({ side, group: grp ? g : null, leader: grp?.leader?.name ?? null, count: dead, turn, cause: 'wounds', at: { x: s.anchor.x, y: s.anchor.y } });
      }
    }
    const left = woundedCount(sec);
    trustLoss += TRUST_PER_WAITING_SECTION;
    const tail = medics ? ' Die Sanitäter halten sie am Leben.' : ' Ohne Sanitäter im Abschnitt.';
    emit('wounded_waiting', {
      side, secret: true, section: s.id, waiting: left, died,
      reason: died
        ? `${s.label}: ${plural(died, 'Verwundeter', 'Verwundete')} ${died === 1 ? 'stirbt' : 'sterben'} im Unterstand, ${left} ${left === 1 ? 'wartet' : 'warten'} noch auf eine Lore.`
        : `${s.label}: ${plural(left, 'Verwundeter wartet', 'Verwundete warten')} auf eine Lore.${tail}`,
      at: s.anchor,
    });
  }
  if (trustLoss) {
    const loss = Math.min(MAX_TRUST_LOSS, trustLoss);
    sideState.trust = Math.max(0, (sideState.trust ?? 50) - loss);
    emit('trust_wounded', { side, secret: true, minor: true, amount: -loss, reason: `Vertrauen −${loss}: Die Truppe sieht, wer liegen bleibt.`, at: depotAt });
  }

  // 6. Lazarett: Geheilte kehren zurueck, mit Erfahrung
  const stay = [];
  const back = new Map();
  for (const h of sup.hospital) {
    if (h.ready > turn) { stay.push(h); continue; }
    back.set(h.group, (back.get(h.group) ?? 0) + h.n);
  }
  sup.hospital = stay;
  for (const gid of [...back.keys()].sort(cmp)) {
    const n = back.get(gid);
    const g = state.groups.find((x) => x.id === gid && x.side === side);
    if (!g || g.status === 'lost') {
      sup.reserveMen += n;
      emit('wounded_returned', { side, secret: true, count: n, reason: `${plural(n, 'Genesener', 'Genesene')} aus dem Lazarett ${n === 1 ? 'meldet' : 'melden'} sich zurück. Die eigene Gruppe gibt es nicht mehr, ${n === 1 ? 'er kommt' : 'sie kommen'} in die Reserve.`, at: care });
      continue;
    }
    const join = Math.min(n, Math.max(0, g.size - g.strength));
    g.strength += join;
    if (n > join) sup.reserveMen += n - join;
    g.veterans = (g.veterans ?? 0) + join;
    let xp = '';
    if (g.veterans >= VETERANS_PER_XP && g.experience < 4) {
      g.veterans -= VETERANS_PER_XP;
      g.experience += 1;
      xp = ` Sie wissen jetzt, wohin man sich wirft. Erfahrung ${g.experience}.`;
    }
    emit('wounded_returned', {
      side, secret: true, group: g.id, count: join,
      reason: `${plural(join, 'Mann', 'Mann')} von Gruppe ${surname(g.leader?.name)} ${join === 1 ? 'kehrt' : 'kehren'} aus dem Lazarett zurück.${xp}`,
      at: g.pos,
    });
  }
  return { network: net, plan, delivered: got };
}

/** Zahl fuer die Anzeige: Runden, die ein Vorrat bei diesem Verbrauch reicht (null = kein Verbrauch) */
export function roundsLeft(amount, perRound) {
  return perRound > 0 ? Math.floor(Math.max(0, amount) / perRound) : null;
}

/** Naechste Ladung beim Antippen */
export function nextLoad(load) {
  const i = LOAD_CYCLE.indexOf(load);
  return LOAD_CYCLE[(i + 1) % LOAD_CYCLE.length];
}

/** Naechstes Ziel beim Antippen des Kreises */
export function nextTarget(map, to) {
  const ids = sectionsOf(map).map((s) => s.id);
  const i = ids.indexOf(to);
  return ids[(i + 1) % ids.length];
}
