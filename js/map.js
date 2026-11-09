// Kartenmodell der Lagekarte (Plan 3.2). Rein: keine DOM-Zugriffe, kein Date, kein Math.random.
// Felder sind 0-basiert (x nach rechts/Osten, y nach unten/Sueden). Fuer Spieler wird 1-basiert angezeigt (cellLabel).

/** Boden. Kosten sind ganzzahlig (Zehntel), damit A* exakt und deterministisch bleibt. */
export const TERRAIN = {
  lehm:   { id: 'lehm',   name: 'Lehm',   code: '.', move: 10, dig: 1.0, mud: 1.0, cover: 'open', obstacle: 0 },
  kreide: { id: 'kreide', name: 'Kreide', code: 'k', move: 10, dig: 0.7, mud: 0.3, cover: 'open', obstacle: 0 },
  fels:   { id: 'fels',   name: 'Fels',   code: 'f', move: 15, dig: 0.3, mud: 0.1, cover: 'open', obstacle: 0 },
  sumpf:  { id: 'sumpf',  name: 'Sumpf',  code: 's', move: 30, dig: 0.5, mud: 2.0, cover: 'open', obstacle: 0 },
  wald:   { id: 'wald',   name: 'Wald',   code: 'w', move: 15, dig: 0.6, mud: 0.8, cover: 'crater', obstacle: 2 },
  dorf:   { id: 'dorf',   name: 'Dorf',   code: 'd', move: 10, dig: 0.4, mud: 0.5, cover: 'foxhole', obstacle: 2 },
  wasser: { id: 'wasser', name: 'Wasser', code: '~', move: Infinity, dig: 0, mud: 0, cover: 'open', obstacle: 0 },
};
const TERRAIN_BY_CODE = Object.fromEntries(Object.values(TERRAIN).map((t) => [t.code, t.id]));

/** Zonen von hinten nach vorn. Grossbuchstaben eigene Seite, Kleinbuchstaben Gegner, N Niemandsland. */
export const ZONE_CODES = {
  E: { zone: 'etappe', side: 'own' },
  S: { zone: 'stellung', side: 'own' },
  N: { zone: 'niemandsland', side: null },
  s: { zone: 'stellung', side: 'enemy' },
  e: { zone: 'etappe', side: 'enemy' },
};
export const ZONE_NAMES = { etappe: 'Etappe', stellung: 'Stellung', niemandsland: 'Niemandsland' };

/** Acht Richtungen in fester Reihenfolge (auch Reihenfolge der Nachbarn). */
export const DIRS = [
  { id: 'N', dx: 0, dy: -1, name: 'Nord' },
  { id: 'NE', dx: 1, dy: -1, name: 'Nordost' },
  { id: 'E', dx: 1, dy: 0, name: 'Ost' },
  { id: 'SE', dx: 1, dy: 1, name: 'Südost' },
  { id: 'S', dx: 0, dy: 1, name: 'Süd' },
  { id: 'SW', dx: -1, dy: 1, name: 'Südwest' },
  { id: 'W', dx: -1, dy: 0, name: 'West' },
  { id: 'NW', dx: -1, dy: -1, name: 'Nordwest' },
];
export const DIR = Object.fromEntries(DIRS.map((d) => [d.id, d]));

export const MAX_HEIGHT = 3;
export const TRENCH_KINDS = ['fire', 'comm'];

function fail(msg) {
  throw new Error('Karte ungültig: ' + msg);
}

function readRows(rows, w, h, what) {
  if (!Array.isArray(rows) || rows.length !== h) fail(`${what}: ${h} Zeilen erwartet`);
  rows.forEach((r, y) => {
    if (typeof r !== 'string' || r.length !== w) fail(`${what}: Zeile ${y + 1} hat nicht ${w} Zeichen`);
  });
  return rows;
}

function emptyCell(x, y) {
  return { x, y, terrain: 'lehm', height: 0, zone: 'niemandsland', side: null, trench: null, crater: 0, wire: null, rail: false, building: null };
}

/**
 * Laedt eine Karte aus JSON (Objekt oder String) und prueft sie.
 * Format siehe data/maps/README.md.
 */
export function loadMap(json) {
  const src = typeof json === 'string' ? JSON.parse(json) : json;
  const { width: w, height: h } = src;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) fail('Breite und Höhe fehlen');

  const terrain = readRows(src.terrain, w, h, 'terrain');
  const heights = readRows(src.heights, w, h, 'heights');
  const zones = readRows(src.zones, w, h, 'zones');

  const cells = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = emptyCell(x, y);
      const t = TERRAIN_BY_CODE[terrain[y][x]];
      if (!t) fail(`unbekannter Boden "${terrain[y][x]}" bei ${x}/${y}`);
      c.terrain = t;
      const hv = heights[y].charCodeAt(x) - 48;
      if (!(hv >= 0 && hv <= MAX_HEIGHT)) fail(`Höhe "${heights[y][x]}" bei ${x}/${y}`);
      c.height = hv;
      const z = ZONE_CODES[zones[y][x]];
      if (!z) fail(`unbekannte Zone "${zones[y][x]}" bei ${x}/${y}`);
      c.zone = z.zone;
      c.side = z.side;
      cells[y * w + x] = c;
    }
  }

  const map = {
    id: String(src.id || 'karte'),
    name: String(src.name || src.id || 'Karte'),
    sheet: src.sheet || {},
    width: w,
    height: h,
    cells,
    buildings: [],
    labels: (src.labels || []).map((l) => ({ ...l })),
    notes: (src.notes || []).map((n) => ({ ...n })),
    cables: (src.cables || []).map((c) => ({ ...c, points: c.points.map((p) => [p[0], p[1]]) })),
  };

  const at = (x, y, what) => {
    if (!inBounds(map, x, y)) fail(`${what} ausserhalb der Karte bei ${x}/${y}`);
    return cells[y * w + x];
  };

  for (const t of src.trenches || []) {
    const c = at(t.x, t.y, 'Graben');
    if (!TRENCH_KINDS.includes(t.kind)) fail(`Grabenart "${t.kind}" bei ${t.x}/${t.y}`);
    if (!DIR[t.facing]) fail(`Feuerrichtung "${t.facing}" bei ${t.x}/${t.y}`);
    if (!(t.level >= 1 && t.level <= 4)) fail(`Grabenstufe "${t.level}" bei ${t.x}/${t.y}`);
    if (t.side !== 'own' && t.side !== 'enemy') fail(`Grabenseite "${t.side}" bei ${t.x}/${t.y}`);
    c.trench = { side: t.side, kind: t.kind, level: t.level, facing: t.facing };
  }
  for (const k of src.craters || []) {
    const c = at(k.x, k.y, 'Krater');
    c.crater = Math.max(1, Math.min(2, k.size | 0 || 1));
  }
  for (const d of src.wire || []) {
    const c = at(d.x, d.y, 'Draht');
    if (d.side !== 'own' && d.side !== 'enemy') fail(`Drahtseite bei ${d.x}/${d.y}`);
    c.wire = { side: d.side };
  }
  for (const r of src.rails || []) at(r[0], r[1], 'Gleis').rail = true;

  const ids = new Set();
  for (const b of src.buildings || []) {
    if (!b.id || ids.has(b.id)) fail(`Gebäude-ID "${b.id}" fehlt oder doppelt`);
    ids.add(b.id);
    const bw = b.w || 1, bh = b.h || 1;
    for (let y = b.y; y < b.y + bh; y++) for (let x = b.x; x < b.x + bw; x++) at(x, y, 'Gebäude ' + b.id).building = b.id;
    map.buildings.push({ id: b.id, type: b.type || 'gebaeude', x: b.x, y: b.y, w: bw, h: bh, letter: b.letter || '', label: b.label || '', side: b.side || 'own' });
  }
  map.buildings.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return map;
}

export function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.width && y < map.height && Number.isInteger(x) && Number.isInteger(y);
}

export function cellAt(map, x, y) {
  return inBounds(map, x, y) ? map.cells[y * map.width + x] : null;
}

/** Feldbezeichnung fuer Spieler, 1-basiert wie auf dem Kartenrand: "31/9" */
export function cellLabel(x, y) {
  return `${x + 1}/${y + 1}`;
}

/** Nachbarn in fester Reihenfolge N, NE, E, SE, S, SW, W, NW (bzw. nur N, E, S, W). */
export function neighbors(map, x, y, { diagonal = true } = {}) {
  const out = [];
  for (const d of DIRS) {
    if (!diagonal && d.dx && d.dy) continue;
    const c = cellAt(map, x + d.dx, y + d.dy);
    if (c) out.push(c);
  }
  return out;
}

/** Bresenham-Linie von a nach b, inklusive beider Endpunkte. */
export function lineCells(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** Chebyshev-Abstand in Feldern (fuer Reichweiten). */
export function distance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * Sichtlinie mit Hoehe. Hoehen in halben Stufen: Boden = 2 * height, Augenhoehe +1,
 * Wald und Dorf ragen eine ganze Stufe (+2) auf. Ein Zwischenfeld blockiert, wenn es
 * hoeher ist als die Gerade zwischen Auge und Ziel. Rechnung ganzzahlig per Kreuzmultiplikation.
 * Rueckgabe: { visible, blockedAt: {x,y}|null, cells }
 */
export function lineOfSight(map, from, to, { eye = 1, target = 1 } = {}) {
  const a = cellAt(map, from.x, from.y), b = cellAt(map, to.x, to.y);
  if (!a || !b) return { visible: false, blockedAt: null, cells: [] };
  // Immer vom kleineren Index aus rechnen: Bresenham waehlt sonst je nach Richtung andere Zwischenfelder,
  // und A saehe B, B aber nicht A (Review P02). Ergebnis ist damit symmetrisch.
  const swap = a.y * map.width + a.x > b.y * map.width + b.x;
  const [p, q, ep, eq] = swap ? [b, a, target, eye] : [a, b, eye, target];
  const line = lineCells(p.x, p.y, q.x, q.y);
  const n = line.length - 1;
  const hp = 2 * p.height + ep, hq = 2 * q.height + eq;
  const blocked = [];
  for (let i = 1; i < n; i++) {
    const c = cellAt(map, line[i][0], line[i][1]);
    const top = 2 * c.height + TERRAIN[c.terrain].obstacle;
    // Sichtgerade an Position i: hp + (hq - hp) * i / n  ->  mal n
    if (top * n > hp * (n - i) + hq * i) blocked.push({ x: c.x, y: c.y });
  }
  const cells = swap ? line.slice().reverse() : line;
  if (!blocked.length) return { visible: true, blockedAt: null, cells };
  // Gemeldet wird das Hindernis, das dem Beobachter am naechsten ist
  return { visible: false, blockedAt: swap ? blocked[blocked.length - 1] : blocked[0], cells };
}

/** Bewegungskosten fuer das Betreten eines Feldes (Zehntel). Infinity = unpassierbar. */
export function enterCost(cell) {
  let c = TERRAIN[cell.terrain].move;
  if (!Number.isFinite(c)) return Infinity;
  if (cell.building) return Infinity;
  if (cell.trench) c = 8;
  if (cell.crater) c += 5 * cell.crater;
  if (cell.wire) c += 30;
  return c;
}

// Kleiner Binaer-Heap mit deterministischem Vergleich
function heapPush(h, item, less) {
  h.push(item);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!less(h[i], h[p])) break;
    [h[i], h[p]] = [h[p], h[i]];
    i = p;
  }
}
function heapPop(h, less) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < h.length && less(h[l], h[m])) m = l;
      if (r < h.length && less(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
  }
  return top;
}

/**
 * A* auf dem Raster. Diagonalen kosten 14/10, Ecken werden nicht geschnitten.
 * opts.cost(cell) ueberschreibt enterCost; opts.diagonal schaltet Diagonalen.
 * Rueckgabe { path: [{x,y}, ...] inklusive Start und Ziel, cost } oder null.
 */
export function findPath(map, start, goal, { cost = enterCost, diagonal = true, maxNodes = 100000 } = {}) {
  const w = map.width;
  const s = cellAt(map, start.x, start.y), g = cellAt(map, goal.x, goal.y);
  if (!s || !g) return null;
  if (!Number.isFinite(cost(g))) return null;
  const si = s.y * w + s.x, gi = g.y * w + g.x;
  if (si === gi) return { path: [{ x: s.x, y: s.y }], cost: 0 };

  // Kleinste Schrittkosten der Karte fuer eine zulaessige Schaetzung
  let minStep = Infinity;
  for (const c of map.cells) { const v = cost(c); if (v < minStep) minStep = v; }
  if (!Number.isFinite(minStep) || minStep < 0) minStep = 0;
  const minDiag = Math.floor((minStep * 14) / 10);
  const heur = (i) => {
    const dx = Math.abs((i % w) - g.x), dy = Math.abs(Math.floor(i / w) - g.y);
    if (!diagonal) return minStep * (dx + dy);
    const lo = Math.min(dx, dy), hi = Math.max(dx, dy);
    return minStep * (hi - lo) + minDiag * lo;
  };

  const gScore = new Map([[si, 0]]);
  const came = new Map();
  const closed = new Set();
  const less = (a, b) => a.f !== b.f ? a.f < b.f : a.h !== b.h ? a.h < b.h : a.i < b.i;
  const open = [];
  heapPush(open, { i: si, f: heur(si), h: heur(si), g: 0 }, less);
  let visited = 0;

  while (open.length) {
    const cur = heapPop(open, less);
    if (closed.has(cur.i)) continue;
    if (cur.i === gi) {
      const path = [];
      for (let i = gi; i !== undefined; i = came.get(i)) path.push({ x: i % w, y: Math.floor(i / w) });
      path.reverse();
      return { path, cost: cur.g };
    }
    closed.add(cur.i);
    if (++visited > maxNodes) return null;
    const cx = cur.i % w, cy = Math.floor(cur.i / w);
    for (const d of DIRS) {
      const diag = d.dx !== 0 && d.dy !== 0;
      if (diag && !diagonal) continue;
      const n = cellAt(map, cx + d.dx, cy + d.dy);
      if (!n) continue;
      const ni = n.y * w + n.x;
      if (closed.has(ni)) continue;
      let step = cost(n);
      if (!Number.isFinite(step)) continue;
      if (diag) {
        // Keine Ecke schneiden: beide Orthogonalnachbarn muessen passierbar sein
        if (!Number.isFinite(cost(cellAt(map, cx + d.dx, cy))) || !Number.isFinite(cost(cellAt(map, cx, cy + d.dy)))) continue;
        step = Math.floor((step * 14) / 10);
      }
      const ng = cur.g + step;
      if (ng < (gScore.get(ni) ?? Infinity)) {
        gScore.set(ni, ng);
        came.set(ni, cur.i);
        const h = heur(ni);
        heapPush(open, { i: ni, f: ng + h, h, g: ng }, less);
      }
    }
  }
  return null;
}

/**
 * Zerlegt eine Menge von Feldern in Linienzuege (fuer Graeben, Draht, Gleise).
 * Nachbarn: orthogonal immer, diagonal nur, wenn keines der beiden gemeinsamen
 * Orthogonalfelder dazugehoert (sonst entstuenden Dreiecke).
 * styleOf(a, b) liefert einen Schluessel je Kante; ein Zug bricht an Kreuzungen und wo der Stil wechselt.
 * Rueckgabe: [{ style, cells: [[x,y], ...] }] in deterministischer Reihenfolge. Einzelfelder werden Zuege der Laenge 1.
 */
export function cellChains(map, isMember, styleOf = () => '') {
  const w = map.width;
  const member = new Set();
  for (const c of map.cells) if (isMember(c)) member.add(c.y * w + c.x);
  const has = (x, y) => x >= 0 && y >= 0 && x < w && y < map.height && member.has(y * w + x);
  const adj = new Map();
  const sorted = [...member].sort((a, b) => a - b);
  for (const i of sorted) {
    const x = i % w, y = Math.floor(i / w);
    const list = [];
    for (const d of DIRS) {
      const nx = x + d.dx, ny = y + d.dy;
      if (!has(nx, ny)) continue;
      if (d.dx && d.dy && (has(x + d.dx, y) || has(x, y + d.dy))) continue;
      list.push(ny * w + nx);
    }
    adj.set(i, list);
  }
  const cellOf = (i) => map.cells[i];
  const eKey = (a, b) => (a < b ? a + ':' + b : b + ':' + a);
  const style = (a, b) => styleOf(cellOf(a), cellOf(b));
  const used = new Set();
  const chains = [];
  const walk = (a, b) => {
    const st = style(a, b);
    const pts = [a, b];
    used.add(eKey(a, b));
    let prev = a, cur = b;
    while (adj.get(cur).length === 2) {
      const next = adj.get(cur)[0] === prev ? adj.get(cur)[1] : adj.get(cur)[0];
      if (used.has(eKey(cur, next)) || style(cur, next) !== st) break;
      used.add(eKey(cur, next));
      pts.push(next);
      prev = cur;
      cur = next;
    }
    chains.push({ style: st, cells: pts.map((i) => [i % w, Math.floor(i / w)]) });
  };
  // Erst von Endpunkten und Kreuzungen aus, dann verbleibende Ringe
  for (const i of sorted) {
    if (adj.get(i).length === 2) continue;
    if (adj.get(i).length === 0) { chains.push({ style: styleOf(cellOf(i), cellOf(i)), cells: [[i % w, Math.floor(i / w)]] }); continue; }
    for (const n of adj.get(i)) if (!used.has(eKey(i, n))) walk(i, n);
  }
  // Verbleibende Ringe: zuerst an Feldern beginnen, an denen der Stil wechselt, damit Zuege ganz bleiben
  for (const i of sorted) {
    const st = new Set(adj.get(i).map((n) => style(i, n)));
    if (st.size < 2) continue;
    for (const n of adj.get(i)) if (!used.has(eKey(i, n))) walk(i, n);
  }
  for (const i of sorted) for (const n of adj.get(i)) if (!used.has(eKey(i, n))) walk(i, n);
  return chains;
}

/** Hoehe eines Feldes als Zahl, ausserhalb 0. Praktisch fuer Renderer und Overlays. */
export function heightAt(map, x, y) {
  const c = cellAt(map, x, y);
  return c ? c.height : 0;
}

/**
 * Karte mit dem Feldzustand aus dem Spiel (state.cells) ueberlagern, ohne die Karte zu veraendern.
 * Felder aus state.cells ersetzen gleichnamige Felder der Kartenzelle (trench, crater, wire ...).
 * Ohne Aenderungen kommt dieselbe Karte zurueck. Fuer Anzeige, Werkzeuge und Regeln, die Graeben sehen muessen.
 */
export function applyCellState(map, cells) {
  const keys = Object.keys(cells ?? {});
  if (!keys.length) return map;
  const out = { ...map, cells: map.cells.slice() };
  for (const k of keys) {
    const [x, y] = k.split(',').map(Number);
    if (!inBounds(map, x, y)) continue;
    const i = y * map.width + x;
    out.cells[i] = { ...map.cells[i], ...cells[k] };
  }
  return out;
}
