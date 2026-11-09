// Graeben als reine Regeln (Plan 4.1 Nr. 1 bis 3, 7.4): Stufen, Feuerrichtung, Zerlegen einer gezeichneten
// Linie in Felder, Laengsfeuer-Analyse, Traversen, Eroberung und Deckung.
// Rein: kein DOM, kein Date, kein Math.random. Nur Ganzzahl-Rechnung.
import { DIRS, DIR, TERRAIN, cellAt, lineCells } from './map.js';

/**
 * Grabenstufen. work = aufsummierte Arbeit bis zu dieser Stufe auf Lehm (100 = eine Stellungsrunde einer
 * vollen Schuetzengruppe), material = Material je Feld beim Erreichen der Stufe (Faschinen, Beton).
 * cover passt zu COVER in js/rules.js.
 */
export const LEVELS = [
  null,
  { id: 1, name: 'Schützenloch', short: 'Loch', cover: 'foxhole', work: 10, material: 0 },
  { id: 2, name: 'Schützengraben', short: 'Graben', cover: 'trench', work: 25, material: 0 },
  { id: 3, name: 'Ausgebauter Graben', short: 'ausgebaut', cover: 'trench_improved', work: 60, material: 1 },
  { id: 4, name: 'Betonierter Graben', short: 'betoniert', cover: 'trench_concrete', work: 120, material: 2 },
];
export const MAX_LEVEL = 4;

/** Ab so vielen Feldern in gerader Linie kann ein MG den Abschnitt von einem Ende bestreichen */
export const ENFILADE_RUN = 4;
/** Traversen brechen jede Gerade nach so vielen Feldern */
export const TRAVERSE_RUN = 3;

export function levelName(level) {
  return LEVELS[level]?.name ?? 'kein Graben';
}

/** Kartenseite ('own'/'enemy') einer Spielseite ('a'/'b'): Seite a spielt die eigene Kartenhaelfte */
export function mapSideOf(side) {
  return side === 'a' ? 'own' : 'enemy';
}

/** Richtung zum Gegner fuer eine Kartenseite */
export function enemyDir(mapSide) {
  return mapSide === 'own' ? DIR.E : DIR.W;
}

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

/** Richtungs-ID aus einem Vektor (Vorzeichen je Achse), null bei (0,0) */
export function dirId(dx, dy) {
  const d = DIRS.find((q) => q.dx === sign(dx) && q.dy === sign(dy));
  return d ? d.id : null;
}

export function oppositeDir(id) {
  const d = DIR[id];
  return dirId(-d.dx, -d.dy);
}

/** Arbeit, die in einem Feld schon steckt (Graben aus Karte oder Zustand, plus angefangene Arbeit) */
export function workIn(cell) {
  if (!cell) return 0;
  const base = cell.trench ? LEVELS[cell.trench.level]?.work ?? 0 : 0;
  return Math.max(base, cell.dig?.work ?? 0);
}

/** Hoechste Stufe, die eine Arbeitsmenge erreicht (0 = noch nichts) */
export function levelForWork(work) {
  let lv = 0;
  for (let i = 1; i <= MAX_LEVEL; i++) if (work >= LEVELS[i].work) lv = i;
  return lv;
}

/** Bodenfaktor in Prozent (Lehm 100, Fels 30) */
export function terrainPct(cell) {
  return Math.round((TERRAIN[cell?.terrain]?.dig ?? 0) * 100);
}

/** Arbeitspunkte (Gruppenbudget), die ein Feld von seinem Stand bis zur Zielstufe kostet */
export function cellCost(cell, target) {
  const pct = terrainPct(cell);
  if (pct <= 0) return Infinity;
  const need = Math.max(0, LEVELS[target].work - workIn(cell));
  return Math.floor((need * 100 + pct - 1) / pct);
}

/** Wie viel Grabenarbeit bringt ein Budget in einem Feld? (abgerundet) */
export function workFromBudget(cell, budget) {
  return Math.floor((budget * terrainPct(cell)) / 100);
}

// ---------------------------------------------------------------------------------------------
// Linie zerlegen

/**
 * Zerlegt eine gezeichnete Linie (Weltkoordinaten, 1 = ein Feld) in eine lueckenlose Feldfolge
 * (Nachbarn auch diagonal). Zurueckzeichnen ueber schon erfasste Felder radiert die Linie bis dorthin.
 */
export function cellsFromPoints(points) {
  const out = [];
  const idx = new Map();
  const add = (x, y) => {
    const k = x + ',' + y;
    if (idx.has(k)) {
      // zurueckgezeichnet: alles nach diesem Feld faellt weg
      const i = idx.get(k);
      for (const c of out.splice(i + 1)) idx.delete(c.x + ',' + c.y);
      return;
    }
    idx.set(k, out.length);
    out.push({ x, y });
  };
  let prev = null;
  for (const p of points ?? []) {
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!prev) add(x, y);
    else if (prev.x !== x || prev.y !== y) for (const [cx, cy] of lineCells(prev.x, prev.y, x, y).slice(1)) add(cx, cy);
    prev = { x, y };
  }
  return out;
}

/** Ist die Feldfolge lueckenlos (8er-Nachbarschaft, keine Doppelten)? */
export function isContiguous(cells) {
  const seen = new Set();
  for (let i = 0; i < cells.length; i++) {
    const k = cells[i].x + ',' + cells[i].y;
    if (seen.has(k)) return false;
    seen.add(k);
    if (i && Math.max(Math.abs(cells[i].x - cells[i - 1].x), Math.abs(cells[i].y - cells[i - 1].y)) !== 1) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------------------------
// Laengsfeuer

/**
 * Gerade Abschnitte einer Feldfolge: [{ from, to, length, dx, dy }] (Indizes inklusive, length in Feldern).
 * Eckfelder gehoeren zu beiden Abschnitten.
 */
export function straightRuns(cells) {
  if (!cells.length) return [];
  if (cells.length === 1) return [{ from: 0, to: 0, length: 1, dx: 0, dy: 0 }];
  const runs = [];
  let from = 0;
  let dx = cells[1].x - cells[0].x, dy = cells[1].y - cells[0].y;
  for (let i = 2; i < cells.length; i++) {
    const ex = cells[i].x - cells[i - 1].x, ey = cells[i].y - cells[i - 1].y;
    if (ex !== dx || ey !== dy) {
      runs.push({ from, to: i - 1, length: i - from, dx, dy });
      from = i - 1;
      dx = ex; dy = ey;
    }
  }
  runs.push({ from, to: cells.length - 1, length: cells.length - from, dx, dy });
  return runs;
}

export function longestRun(cells) {
  return straightRuns(cells).reduce((m, r) => Math.max(m, r.length), 0);
}

/** Abschnitte, die ein MG vom Ende aus bestreichen kann (Laufgraeben zaehlen nicht, sie sind Verbindung) */
export function enfiladeRuns(cells, kind = 'fire') {
  if (kind === 'comm') return [];
  return straightRuns(cells).filter((r) => r.length >= ENFILADE_RUN);
}

/** Summe der Felder ueber TRAVERSE_RUN in allen Geraden (0 = ueberall Traversen) */
function excess(cells) {
  return straightRuns(cells).reduce((s, r) => s + Math.max(0, r.length - TRAVERSE_RUN), 0);
}

/**
 * Traversen einfuegen: jede Gerade wird nach TRAVERSE_RUN Feldern seitlich versetzt (Zickzack wie im Mockup).
 * ok(x, y) prueft, ob ein Feld grabbar ist; side bevorzugt die Seite weg vom Feind (rear = {dx, dy}).
 * Liefert eine neue lueckenlose Feldfolge mit gleichem Anfang und Ende, oder die alte, wenn es nicht geht.
 */
export function insertTraverses(cells, { ok = () => true, rear = { dx: -1, dy: 0 } } = {}) {
  if (cells.length < ENFILADE_RUN) return cells.slice();
  const first = cells[0], last = cells[cells.length - 1];
  const attempt = (cur, phase, flip) => {
    const shifted = cur.map((c) => ({ ...c }));
    for (const r of straightRuns(cur)) {
      if (r.length <= TRAVERSE_RUN) continue;
      // senkrecht zur Laufrichtung, bevorzugt nach hinten
      let px = -r.dy, py = r.dx;
      if (r.dx && r.dy) { px = r.dx; py = 0; } // diagonal: waagrecht versetzen
      if (px * rear.dx + py * rear.dy < 0) { px = -px; py = -py; }
      if (flip) { px = -px; py = -py; }
      // Erstes und letztes Feld bleiben, damit Anschluesse halten
      for (let i = r.from + 1; i < r.to; i++) {
        if (Math.floor((i - r.from + phase) / TRAVERSE_RUN) % 2 === 0) continue;
        const c = cur[i];
        if (ok(c.x + px, c.y + py)) shifted[i] = { x: c.x + px, y: c.y + py };
        else if (ok(c.x - px, c.y - py)) shifted[i] = { x: c.x - px, y: c.y - py };
      }
    }
    // Wieder lueckenlos verbinden
    const pts = [];
    for (const c of shifted) {
      const prev = pts[pts.length - 1];
      if (!prev) { pts.push(c); continue; }
      for (const [x, y] of lineCells(prev.x, prev.y, c.x, c.y).slice(1)) pts.push({ x, y });
    }
    const joined = cellsFromPoints(pts.map((p) => ({ x: p.x + 0.5, y: p.y + 0.5 })));
    const end = joined[joined.length - 1];
    if (!end || end.x !== last.x || end.y !== last.y || joined[0].x !== first.x || joined[0].y !== first.y) return null;
    if (!joined.every((c) => ok(c.x, c.y))) return null;
    return joined;
  };
  let cur = cells.slice();
  for (let round = 0; round < 8 && excess(cur) > 0; round++) {
    let best = null;
    for (const flip of [false, true]) {
      for (let phase = 0; phase < TRAVERSE_RUN; phase++) {
        const cand = attempt(cur, phase, flip);
        if (cand && excess(cand) < excess(best ?? cur)) best = cand;
      }
    }
    if (!best) break;
    cur = best;
  }
  return cur;
}

/**
 * Feuerrichtung je Feld: die Normale der Linie, die zum Feind zeigt. Laeuft die Linie auf den Feind zu
 * (Sappe, Laufgraben), zeigt sie zum Feind.
 */
export function defaultFacings(cells, mapSide) {
  const foe = enemyDir(mapSide);
  return cells.map((c, i) => {
    const a = cells[Math.max(0, i - 1)], b = cells[Math.min(cells.length - 1, i + 1)];
    const tx = b.x - a.x, ty = b.y - a.y;
    if (!tx && !ty) return foe.id;
    let nx = -ty, ny = tx;
    const dot = nx * foe.dx + ny * foe.dy;
    if (dot === 0) return foe.id;
    if (dot < 0) { nx = -nx; ny = -ny; }
    return dirId(nx, ny);
  });
}

// ---------------------------------------------------------------------------------------------
// Eroberung, Deckung, Laengsfeuer im Gefecht (Schnittstellen fuer P05, P06, P09)

/**
 * Graben erobern: das Feld gehoert jetzt der Seite side ('a'/'b'). Der Schuetzenauftritt zeigt noch
 * zum alten Besitzer (falsche Richtung), bis der Graben umgebaut ist: halbe Deckung.
 * Nur auf Entwurfszustaenden in Phasen aufrufen. Liefert true, wenn sich etwas geaendert hat.
 */
export function captureTrench(state, map, x, y, side) {
  const k = x + ',' + y;
  const base = cellAt(map, x, y);
  const cur = state.cells[k]?.trench !== undefined ? state.cells[k].trench : base?.trench ?? null;
  const ms = mapSideOf(side);
  if (!cur || cur.side === ms) return false;
  state.cells[k] = { ...(state.cells[k] ?? {}), trench: { ...cur, side: ms, captured: true } };
  return true;
}

/**
 * Deckung eines Feldes fuer eine Seite: { cover (Schluessel aus COVER in rules.js), reversed, level }.
 * map muss den Zustand schon enthalten (applyCellState). Fremde Graeben geben die Deckung eines Kraters.
 */
export function trenchCover(map, x, y, side) {
  const c = cellAt(map, x, y);
  if (!c) return { cover: 'open', reversed: false, level: 0 };
  const t = c.trench;
  if (t && t.side === mapSideOf(side)) return { cover: LEVELS[t.level].cover, reversed: !!t.captured, level: t.level };
  if (t) return { cover: 'crater', reversed: false, level: 0 };
  return { cover: TERRAIN[c.terrain].cover, reversed: false, level: 0 };
}

const AXES = [[0, 1], [1, 0], [1, 1], [1, -1]];

/**
 * Laengsfeuer: steht der Schuetze in der Verlaengerung eines geraden Grabenabschnitts (mindestens
 * ENFILADE_RUN Felder) durch das Ziel, bestreicht er ihn (seitlich hoechstens ein Feld daneben).
 * Laufgraeben zaehlen mit, denn auch dort steht man in einer Reihe. Rueckgabe: { run, axis } oder null.
 */
export function enfiladeOf(map, target, shooter) {
  const t = cellAt(map, target.x, target.y);
  if (!t?.trench) return null;
  const same = (x, y) => { const c = cellAt(map, x, y); return c?.trench && c.trench.side === t.trench.side; };
  for (const [ax, ay] of AXES) {
    let fwd = 0, back = 0;
    while (same(t.x + ax * (fwd + 1), t.y + ay * (fwd + 1))) fwd++;
    while (same(t.x - ax * (back + 1), t.y - ay * (back + 1))) back++;
    const run = 1 + fwd + back;
    if (run < ENFILADE_RUN) continue;
    const sx = shooter.x - t.x, sy = shooter.y - t.y;
    const along = sx * ax + sy * ay;           // Projektion (mal |a|^2)
    const cross = Math.abs(sx * ay - sy * ax); // seitlicher Abstand (mal |a|)
    const len2 = ax * ax + ay * ay;
    if (cross > 1) continue;
    if (along > fwd * len2 || -along > back * len2) return { run, axis: dirId(ax, ay) };
  }
  return null;
}
