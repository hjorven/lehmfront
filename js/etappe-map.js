// Etappe auf der Lagekarte (Plan 4.1 Nr. 11, 6): Parzellen, Grundausbau, Gebaeude als Kartengebaeude.
// Rein: kein DOM, kein Date, kein Math.random, immer nach ID sortieren.
//
// Die Etappe einer Seite ist ein grobes Raster ueber ihrer Etappenzone: ein Etappenfeld ("Parzelle") ist
// PLOT x PLOT Kartenfelder gross. So bleiben Nachbarboni (vier Nachbarn mit gemeinsamer Kante) lesbar und das
// Pappmodell klein genug fuer den Daumen. Parzellen zaehlen nur, wenn alle ihre Kartenfelder Etappe der Seite sind.
//
// Zustand: state.sides[s].etappe = {
//   plot, origin: {x,y}, cols, rows,
//   fields: [{ x, y, ground, height }],                 Parzellen-Koordinaten, wie js/etappe.js sie erwartet
//   buildings: [{ id, type, x, y, remaining?, damaged?, map?, spotted?, spottedBy?, repairing? }],
//   rewards: { [stufe]: belohnungId }, best: hoechste erreichte Stufe, rounds: gezaehlte Stellungsrunden,
//   yield: Ertrag der letzten Stellungsrunde (fuer andere Pakete: moral, erholung, heilung, sicht, batterie ...)
// }
// Gleise, die die Karte schon zeichnet, stehen als Gebaeude "gleis" mit map: true in der Etappe (Pflicht-Nachbar
// fuer Depot und Bahnhof). Neu gebaute Gleise legen Gleisfelder in state.cells (rail: true), damit die Feldbahn
// (js/supply.js) und die Lagekarte sie sehen.
import { BUILDINGS } from './config/buildings.js';
import { fieldName, etappeYield, etappeLevel, buildTimeFor, repairCost } from './etappe.js';

/** Kartenfelder je Etappenfeld (Seitenlaenge). 3 x 10 m = 30 m je Parzelle */
export const PLOT = 3;

/** Kartenboden -> Etappenboden (js/config/grounds.js) */
const GROUND_OF = { lehm: 'lehm', kreide: 'kreide', fels: 'fels', sumpf: 'sumpf', wald: 'wald', dorf: 'dorf', wasser: 'wasser' };
/** Bei Gleichstand gewinnt der erste Boden dieser Liste (unbaubare zuerst: im Zweifel nicht bebaubar) */
const GROUND_RANK = ['wasser', 'sumpf', 'wald', 'dorf', 'fels', 'kreide', 'lehm', 'wiese'];

/** Kartengebaeude -> Etappengebaeude, fuer Karten ohne eigenen Grundausbau */
export const MAP_TYPES = {
  depot: 'depot', bahnhof: 'feldbahnhof', kueche: 'feldkueche', ruhelager: 'ruhelager', lazarett: 'feldlazarett',
  verbandsplatz: 'verbandsplatz', werkstatt: 'werkstatt', turm: 'beobachtungsturm', fernmelde: 'fernmeldestelle',
  batterie: 'batteriestellung',
};

const key = (x, y) => x + ',' + y;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => cmp(a.id, b.id);
const mapSideOf = (side) => (side === 'a' ? 'own' : 'enemy');

function mapCell(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height ? map.cells[y * map.width + x] : null;
}

/**
 * Parzellenraster der Etappenzone einer Seite. Liefert null, wenn die Karte keine Etappe fuer die Seite hat.
 * { plot, origin: {x,y}, cols, rows, fields: [{x,y,ground,height}] }
 */
export function etappeGrid(map, side, plot = PLOT) {
  if (!map?.cells) return null;
  const ms = mapSideOf(side);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const c = map.cells[y * map.width + x];
      if (c.zone !== 'etappe' || c.side !== ms) continue;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return null;
  // Die Gegenseite zaehlt ihre Parzellen vom hinteren Kartenrand aus, damit die Front-Parzellen voll bleiben
  const spanX = x1 - x0 + 1;
  const cols = Math.floor(spanX / plot), rows = Math.floor((y1 - y0 + 1) / plot);
  const origin = { x: ms === 'own' ? x0 : x1 + 1 - cols * plot, y: y0 };
  const fields = [];
  for (let fy = 0; fy < rows; fy++) {
    for (let fx = 0; fx < cols; fx++) {
      const count = {};
      let height = 0, ok = true;
      for (let dy = 0; dy < plot && ok; dy++) {
        for (let dx = 0; dx < plot; dx++) {
          const c = mapCell(map, origin.x + fx * plot + dx, origin.y + fy * plot + dy);
          if (!c || c.zone !== 'etappe' || c.side !== ms) { ok = false; break; }
          const g = GROUND_OF[c.terrain] ?? 'lehm';
          count[g] = (count[g] ?? 0) + 1;
          height = Math.max(height, c.height | 0);
        }
      }
      if (!ok) continue;
      let ground = 'lehm', best = -1;
      for (const g of GROUND_RANK) if ((count[g] ?? 0) > best) { best = count[g] ?? 0; ground = g; }
      fields.push({ x: fx, y: fy, ground, height });
    }
  }
  if (!fields.length) return null;
  return { plot, origin, cols, rows, fields };
}

/** Kartenrechteck einer Parzelle */
export function plotRect(et, fx, fy) {
  return { x: et.origin.x + fx * et.plot, y: et.origin.y + fy * et.plot, w: et.plot, h: et.plot };
}

/** Mittleres Kartenfeld einer Parzelle (fuer Ereignisse und Kamerasprung) */
export function plotCenter(et, fx, fy) {
  const half = Math.floor(et.plot / 2);
  return { x: et.origin.x + fx * et.plot + half, y: et.origin.y + fy * et.plot + half };
}

/** Parzelle unter einem Kartenfeld oder null */
export function plotAt(et, x, y) {
  if (!et) return null;
  const fx = Math.floor((x - et.origin.x) / et.plot), fy = Math.floor((y - et.origin.y) / et.plot);
  if (x < et.origin.x || y < et.origin.y) return null;
  return et.fields.some((f) => f.x === fx && f.y === fy) ? { x: fx, y: fy } : null;
}

/** Parzellenname wie im Pappmodell ("C4") */
export function plotName(fx, fy) {
  return fieldName(fx, fy);
}

/** Alle Kartenfelder einer Parzelle, sortiert nach y, dann x */
export function plotCells(et, fx, fy) {
  const r = plotRect(et, fx, fy), out = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y });
  return out;
}

function parseAt(s) {
  const m = /^([A-Z])(\d+)$/.exec(String(s ?? ''));
  return m ? { x: m[1].charCodeAt(0) - 65, y: Number(m[2]) - 1 } : null;
}

/**
 * Etappe einer Seite anlegen. spec (aus dem Szenario, optional): { buildings: [{ type, at: 'B6' } | { type, x, y }], act? }.
 * Ohne spec werden Kartengebaeude der Seite in der Etappe uebernommen (MAP_TYPES). Gleise der Karte werden zu
 * Gleis-Parzellen. Liefert null, wenn die Seite keine Etappe hat (kein Raster oder weder Grundausbau noch Depot).
 */
export function createEtappe(map, side, spec = null) {
  const grid = etappeGrid(map, side);
  if (!grid) return null;
  const et = { ...grid, buildings: [], rewards: {}, best: 1, rounds: 0, yield: {} };
  const used = new Set();
  let n = 0;
  const add = (type, x, y, extra = {}) => {
    if (!BUILDINGS[type] || used.has(key(x, y)) || !grid.fields.some((f) => f.x === x && f.y === y)) return false;
    used.add(key(x, y));
    et.buildings.push({ id: 'g' + String(++n).padStart(3, '0'), type, x, y, ...extra });
    return true;
  };
  if (spec?.buildings) {
    for (const b of spec.buildings) {
      const p = b.at ? parseAt(b.at) : { x: b.x, y: b.y };
      if (!p) throw new Error(`Etappe von Seite ${side}: Feld "${b.at}" unbekannt`);
      if (!add(b.type, p.x, p.y)) throw new Error(`Etappe von Seite ${side}: ${b.type} auf ${b.at ?? p.x + '/' + p.y} geht nicht`);
    }
  } else {
    const ms = mapSideOf(side);
    const own = (map.buildings ?? []).filter((b) => (b.side ?? 'own') === ms && MAP_TYPES[b.type]).sort(byId);
    if (!own.some((b) => b.type === 'depot')) return null;
    for (const b of own) {
      const p = plotAt(grid, b.x, b.y);
      if (p) add(MAP_TYPES[b.type], p.x, p.y);
    }
  }
  // Gleise der Karte: jede Parzelle mit einem Gleisfeld wird Gleis (sofern frei)
  const railPlots = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!mapCell(map, x, y)?.rail) continue;
      const p = plotAt(grid, x, y);
      if (p && !railPlots.some((q) => q.x === p.x && q.y === p.y)) railPlots.push(p);
    }
  }
  railPlots.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const p of railPlots) add('gleis', p.x, p.y, { map: true });
  // Der Grundausbau zaehlt als erreicht (keine Meldung "steigt auf"); seine Belohnung darf man trotzdem waehlen
  const y = etappeYield(et);
  et.best = et.level = etappeLevel(y.levelLoren).level;
  et.yield = { ...y.total };
  return et;
}

/**
 * Etappen fuer alle Seiten in einen neuen Zustand eintragen (Szenario sides[s].etappe, sonst aus der Karte).
 * Laesst vorhandene Etappen stehen. Gibt einen neuen Zustand zurueck, die Eingabe bleibt unveraendert.
 */
export function initEtappen(state, map, scenario = null) {
  const next = structuredClone(state);
  for (const side of ['a', 'b']) {
    if (next.sides[side].etappe) continue;
    const spec = scenario?.sides?.[side]?.etappe ?? null;
    if (spec === false) continue;
    const et = createEtappe(map, side, spec);
    if (et) {
      next.sides[side].etappe = et;
      next.sides[side].supplies.cartsTotal = Math.max(0, (et.yield.loren ?? 0) - (next.sides[side].supplies.cartsLost | 0));
      syncRails(next, side);
    }
  }
  return next;
}

export function etappeOf(state, side) {
  return state.sides?.[side]?.etappe ?? null;
}

/** Laeuft das Gebaeude (fertig und heil)? Pflicht-Nachbarn prueft js/etappe.js */
export function isBuilt(b) {
  return !!b && !(b.remaining > 0) && !b.damaged;
}

/**
 * Gleisfelder einer neu gebauten Gleis-Parzelle: Mittelfeld und Arme zu den Nachbarn, die Gleis, Depot oder
 * Bahnhof sind. Ohne solche Nachbarn ein waagerechtes Stueck durch die Mitte.
 */
export function railCellsOf(et, b) {
  const at = new Map(et.buildings.filter((x) => !(x.remaining > 0)).map((x) => [key(x.x, x.y), x]));
  const c = plotCenter(et, b.x, b.y);
  const half = Math.floor(et.plot / 2);
  const out = [{ x: c.x, y: c.y }];
  const joins = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => {
    const n = at.get(key(b.x + dx, b.y + dy));
    return n && ['gleis', 'depot', 'feldbahnhof'].includes(n.type);
  });
  const arms = joins.length ? joins : [[1, 0], [-1, 0]];
  for (const [dx, dy] of arms) for (let i = 1; i <= half; i++) out.push({ x: c.x + dx * i, y: c.y + dy * i });
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

/** Gleisfelder aller fertigen, selbst gebauten Gleise in state.cells eintragen (nur auf Entwurfszustaenden) */
export function syncRails(state, side) {
  const et = etappeOf(state, side);
  if (!et) return 0;
  let n = 0;
  for (const b of [...et.buildings].sort(byId)) {
    if (b.type !== 'gleis' || b.map || b.remaining > 0) continue;
    for (const p of railCellsOf(et, b)) {
      const k = key(p.x, p.y);
      const cur = state.cells[k];
      if (cur && Object.hasOwn(cur, 'rail') && cur.rail) continue;
      state.cells[k] = { ...(cur ?? {}), rail: true };
      n++;
    }
  }
  return n;
}

function insideGrid(et, b) {
  return !!plotAt(et, b.x, b.y);
}

/**
 * Kartengebaeude einer Seite fuer Regeln (Versorgung): mit Etappe die Etappengebaeude als Rechtecke der Parzelle,
 * dazu Kartengebaeude ausserhalb der Etappe (Unterstaende). Ohne Etappe die Kartengebaeude der Seite.
 * Gebaeude im Bau fehlen, beschaedigte tragen down: true. Nach ID sortiert.
 */
export function sideBuildings(map, state, side) {
  const ms = mapSideOf(side);
  const mapOwn = (map.buildings ?? []).filter((b) => (b.side ?? 'own') === ms);
  const et = etappeOf(state, side);
  if (!et) return mapOwn;
  const out = mapOwn.filter((b) => !insideGrid(et, b));
  for (const b of et.buildings) {
    if (b.remaining > 0 && !b.repairing) continue;
    const def = BUILDINGS[b.type];
    if (!def || def.kind === 'rail') continue;
    const r = plotRect(et, b.x, b.y);
    out.push({ id: 'etappe-' + b.id, type: b.type, ...r, side: ms, letter: def.letter, label: def.name, down: !isBuilt(b) });
  }
  return out.sort(byId);
}

/**
 * Karte fuer die Anzeige: Kartengebaeude der Etappe werden durch die Etappengebaeude ersetzt (Parzelle,
 * etwas kleiner gezeichnet, damit die Beschriftung darunter Platz hat). viewer: planende Seite; von der
 * Gegenseite erscheinen nur aufgeklaerte Gebaeude. Ohne Etappe kommt dieselbe Karte zurueck.
 */
export function withEtappe(map, state, viewer) {
  const sides = ['a', 'b'].filter((s) => etappeOf(state, s));
  if (!sides.length) return map;
  let buildings = map.buildings ?? [];
  const extra = [];
  for (const s of sides) {
    const et = etappeOf(state, s), ms = mapSideOf(s);
    buildings = buildings.filter((b) => (b.side ?? 'own') !== ms || !insideGrid(et, b));
    for (const b of [...et.buildings].sort(byId)) {
      const def = BUILDINGS[b.type];
      if (!def || def.kind === 'rail') continue;
      if (s !== viewer && !b.spotted) continue;
      if (s !== viewer && b.remaining > 0) continue;
      const r = plotRect(et, b.x, b.y);
      let label = MAP_LABELS[b.type] ?? def.name;
      if (s === viewer) {
        if (b.damaged) label += ' (zerschossen)';
        else if (b.remaining > 0) label += b.repairing ? ' (Reparatur)' : ' (im Bau)';
      }
      extra.push({ id: `etappe-${s}-${b.id}`, type: b.type, x: r.x + 0.3, y: r.y + 0.25, w: r.w - 0.6, h: r.h - 1.05, letter: def.letter, label, side: ms });
    }
  }
  return { ...map, buildings: [...buildings, ...extra].sort(byId) };
}

/** Kurze Namen fuer die Beschriftung auf der Lagekarte (eine Parzelle ist nur drei Felder breit) */
export const MAP_LABELS = {
  feldbahnhof: 'Bahnhof', verbandsplatz: 'Verbandspl.', feldlazarett: 'Lazarett', beobachtungsturm: 'Beob.-Turm',
  fernmeldestelle: 'Fernmelde', batteriestellung: 'Batterie', ausbildungslager: 'Ausbildung',
  offiziersquartier: 'Offiziere', gedenkstaette: 'Gedenkstätte', betonmischer: 'Beton',
};

/**
 * Etappe mit den Auftraegen dieser Runde fuer das Etappenfenster (noch nicht ausgefuehrt).
 * plan: { builds: [{type,x,y}], repairs: [id], reward: {level,id}|null }. Liefert
 * { fields, buildings, rewards, best, material, cost } mit planned: 'build' | 'repair' an den geplanten Gebaeuden.
 * Geplante Bauten tragen die ID "plan-<index>", damit das Fenster sie wieder streichen kann.
 */
export function planView(et, plan, material) {
  const p = plan ?? {};
  // Die Belohnung wirkt in der Runde vor den Bauten (Pionierpark verkuerzt die Bauzeit schon)
  const etR = p.reward ? { ...et, rewards: { ...(et.rewards ?? {}), [p.reward.level]: p.reward.id } } : et;
  const repairs = new Set(p.repairs ?? []);
  let cost = 0;
  const buildings = et.buildings.map((b) => {
    if (!repairs.has(b.id) || !b.damaged) return b;
    cost += repairCost(b.type);
    return { ...b, damaged: false, remaining: Math.max(1, b.remaining | 0), planned: 'repair' };
  });
  (p.builds ?? []).forEach((w, i) => {
    const def = BUILDINGS[w.type];
    if (!def) return;
    cost += def.cost;
    buildings.push({ id: 'plan-' + i, type: w.type, x: w.x, y: w.y, remaining: buildTimeFor(etR, w.type), planned: 'build' });
  });
  const rewards = p.reward ? { ...(et.rewards ?? {}), [p.reward.level]: p.reward.id } : (et.rewards ?? {});
  return { fields: et.fields, buildings, rewards, best: et.best ?? 1, material: material - cost, cost };
}

