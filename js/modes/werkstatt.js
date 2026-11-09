// Werkstatt (P25, Plan 8 und 9): Missionseditor und Stellungsbau-Sandbox. Rein: kein DOM, kein Date, kein Math.random.
// Der Entwurf (doc) ist eine Puzzle-Lage in Kurzschrift (ASCII-Ebenen, Format js/modes/puzzle.js), damit Editor,
// Puzzle-Lagen und Lage-Code dieselbe Karte bauen. Fuer das Spiel wird daraus eine Lage (js/modes/lage-code.js).
//
// - blankDoc(size), SIZES, paintCell(doc, layer, x, y, ch)
// - fireRuns(doc, side): gerade Feuergraben-Stuecke ab ENFILADE_RUN Feldern (Laengsfeuer), mit MG-Standort
// - judgePosition(doc): Stellungsnote und Bleistiftnotiz des Ausbilders fuer die Sandbox
// - fixRuns(doc, side): Traversen in alle zu langen Geraden einziehen
// - docToLage(doc) und lageToDoc(lage): Entwurf <-> spielbare Lage
import { puzzleMapJson } from './puzzle.js';
import { ENFILADE_RUN, insertTraverses } from '../trench.js';
import { TERRAIN, MAX_HEIGHT } from '../map.js';
import { MAX_SIDE } from './lage-code.js';

export const SIZES = {
  klein: { id: 'klein', label: 'Klein', width: 18, height: 12 },
  mittel: { id: 'mittel', label: 'Mittel', width: 24, height: 16 },
  gross: { id: 'gross', label: 'Groß', width: 32, height: 22 },
};

export const ENEMY_MODES = ['halten', 'rekrut', 'veteran', 'lask'];
export const GOAL_TYPES = ['keins', 'take', 'hold', 'destroy'];
export const PLACE_TYPES = ['rifles', 'pioneers', 'mg', 'medics', 'observers', 'mortar'];
/** Hoechstens so viele Gruppen je Seite (Uebersicht auf dem Handy, Codelaenge) */
export const MAX_GROUPS = 12;

const FIRE = { own: '=', enemy: '#' };
const TRENCH_CHARS = '=:#;';

const rows = (w, h, ch) => Array.from({ length: h }, () => ch.repeat(w));

/** Leeres Blatt: Lehm, flach, eigene Stellung im Westen, feindliche im Osten */
export function blankDoc(size = 'klein') {
  const s = SIZES[size] ?? SIZES.klein;
  const w = s.width, h = s.height;
  return {
    id: 'werkstatt', num: '', title: 'Eigene Lage', author: '', brief: '',
    width: w, height: h, zoneCols: [Math.floor(w / 3), w - Math.floor(w / 3)],
    terrain: rows(w, h, '.'), heights: rows(w, h, '0'), plan: rows(w, h, '.'),
    groups: { a: [], b: [] }, factions: { a: 'kaldern', b: 'morrow' },
    enemy: 'halten', kind: 'battle', startHour: 10, weather: 'clear',
    goal: null, limit: 8, maxLosses: null,
  };
}

const setChar = (row, x, ch) => row.slice(0, x) + ch + row.slice(x + 1);
const inside = (doc, x, y) => x >= 0 && y >= 0 && x < doc.width && y < doc.height;
const groupAt = (doc, x, y) => {
  for (const s of ['a', 'b']) {
    const i = doc.groups[s].findIndex((g) => g.at[0] === x && g.at[1] === y);
    if (i >= 0) return { side: s, i };
  }
  return null;
};

/**
 * Ein Feld bemalen. layer: 'terrain' (Zeichen aus TERRAIN), 'height' (ch '+' oder '-'), 'plan' (Graben, Draht,
 * Trichter, '.' radiert). Wasser verdraengt Graeben und Gruppen. Liefert true, wenn sich etwas geaendert hat.
 */
export function paintCell(doc, layer, x, y, ch) {
  if (!inside(doc, x, y)) return false;
  if (layer === 'terrain') {
    if (doc.terrain[y][x] === ch) return false;
    doc.terrain[y] = setChar(doc.terrain[y], x, ch);
    if (ch === '~') {
      doc.plan[y] = setChar(doc.plan[y], x, '.');
      const g = groupAt(doc, x, y);
      if (g) doc.groups[g.side].splice(g.i, 1);
    }
    return true;
  }
  if (layer === 'height') {
    const v = Number(doc.heights[y][x]) || 0;
    const n = Math.max(0, Math.min(MAX_HEIGHT, v + (ch === '-' ? -1 : 1)));
    if (n === v) return false;
    doc.heights[y] = setChar(doc.heights[y], x, String(n));
    return true;
  }
  if (layer === 'plan') {
    if (doc.plan[y][x] === ch) return false;
    if (ch !== '.' && doc.terrain[y][x] === '~') return false;
    doc.plan[y] = setChar(doc.plan[y], x, ch);
    return true;
  }
  return false;
}

/** Gruppe setzen oder (gleicher Typ, gleiche Seite) wegnehmen. Liefert 'set', 'removed', 'full', 'blocked' */
export function toggleGroup(doc, side, type, x, y) {
  if (!inside(doc, x, y)) return 'blocked';
  if (doc.terrain[y][x] === '~') return 'blocked';
  const hit = groupAt(doc, x, y);
  if (hit) {
    const g = doc.groups[hit.side][hit.i];
    doc.groups[hit.side].splice(hit.i, 1);
    if (hit.side === side && g.type === type) return 'removed';
  }
  if (doc.groups[side].length >= MAX_GROUPS) return 'full';
  doc.groups[side].push({ type, at: [x, y] });
  return 'set';
}

/** Zielfeld an- oder abwaehlen (hoechstens sechs) */
export function toggleGoalCell(doc, x, y) {
  if (!inside(doc, x, y)) return false;
  const goal = doc.goal ?? { type: 'take', cells: [] };
  const i = goal.cells.findIndex((c) => c[0] === x && c[1] === y);
  if (i >= 0) goal.cells.splice(i, 1);
  else if (goal.cells.length < 6) goal.cells.push([x, y]);
  else return false;
  doc.goal = goal;
  return true;
}

const DIRS4 = [[1, 0], [0, 1], [1, 1], [1, -1]];

/**
 * Laengsfeuer: alle geraden Stuecke Feuergraben (waagrecht, senkrecht, diagonal) mit mindestens ENFILADE_RUN Feldern.
 * Jedes Stueck nennt den Standort, von dem ein feindliches MG es der Laenge nach bestreicht (erstes freies Feld
 * hinter dem Ende, das naeher am Feind liegt). Sortiert: laengste zuerst, dann nach Lage.
 */
export function fireRuns(doc, side = 'own') {
  const ch = FIRE[side];
  const at = (x, y) => inside(doc, x, y) && doc.plan[y][x] === ch;
  const out = [];
  for (const [dx, dy] of DIRS4) {
    for (let y = 0; y < doc.height; y++) {
      for (let x = 0; x < doc.width; x++) {
        if (!at(x, y) || at(x - dx, y - dy)) continue;
        const cells = [];
        let cx = x, cy = y;
        while (at(cx, cy)) { cells.push({ x: cx, y: cy }); cx += dx; cy += dy; }
        if (cells.length < ENFILADE_RUN) continue;
        const first = cells[0], last = cells[cells.length - 1];
        const ends = [{ x: last.x + dx, y: last.y + dy }, { x: first.x - dx, y: first.y - dy }]
          .filter((p) => inside(doc, p.x, p.y) && doc.terrain[p.y][p.x] !== '~' && !TRENCH_CHARS.includes(doc.plan[p.y][p.x]));
        // Feind sitzt im Osten (own) bzw. Westen (enemy): das Ende auf seiner Seite zuerst, sonst das noerdlichere
        const toward = side === 'own' ? 1 : -1;
        ends.sort((p, q) => (q.x - p.x) * toward || p.y - q.y);
        out.push({ cells, dx, dy, length: cells.length, from: first, to: last, mg: ends[0] ?? null });
      }
    }
  }
  return out.sort((p, q) => q.length - p.length || p.from.y - q.from.y || p.from.x - q.from.x);
}

/** Wie viele Felder Feuergraben hat eine Seite? */
export function fireCount(doc, side = 'own') {
  const ch = FIRE[side];
  return doc.plan.reduce((n, r) => n + [...r].filter((c) => c === ch).length, 0);
}

/**
 * Stellungsnote fuer die Sandbox: { grade, exposed, total, worst, note } mit einer deutschen Notiz des Ausbilders.
 * exposed = Felder, die in einem Laengsfeuer-Stueck liegen (jedes Feld einmal).
 */
export function judgePosition(doc) {
  const total = fireCount(doc, 'own');
  const runs = fireRuns(doc, 'own');
  const hit = new Set();
  for (const r of runs) for (const c of r.cells) hit.add(c.x + ',' + c.y);
  const exposed = hit.size;
  const worst = runs[0] ?? null;
  if (!total) return { grade: null, exposed: 0, total, worst, runs, note: 'Noch kein Feuergraben. Zieh eine Linie, dann sehe ich sie mir an.' };
  if (total < ENFILADE_RUN) return { grade: null, exposed, total, worst, runs, note: 'Ein Loch ist noch kein Graben. Weiter graben.' };
  if (!worst) return { grade: 'sehr gut', exposed, total, worst, runs, note: 'Keine Gerade über drei Felder. So baut man das.' };
  const where = worst.mg ? `Von ${worst.mg.x + 1}/${worst.mg.y + 1} aus` : 'Von der Seite';
  const note = `${where} fegt ein MG ${worst.length} Felder Graben leer.`;
  const share = exposed / total;
  const grade = share <= 0.25 ? 'brauchbar' : share <= 0.6 ? 'mangelhaft' : 'ungenügend';
  return { grade, exposed, total, worst, runs, note: grade === 'brauchbar' ? note + ' Eine Traverse noch.' : note + ' Traversen!' };
}

/**
 * Traversen in alle zu langen Geraden einer Seite einziehen (js/trench.js insertTraverses). Anfang und Ende jedes
 * Stuecks bleiben, damit Anschluesse halten. Liefert die Zahl der umgebauten Stuecke.
 */
export function fixRuns(doc, side = 'own') {
  const ch = FIRE[side];
  let changed = 0;
  for (let round = 0; round < 6; round++) {
    const runs = fireRuns(doc, side);
    if (!runs.length) break;
    let any = false;
    for (const r of runs) {
      // Stueck koennte schon von einem frueheren Umbau dieser Runde beruehrt sein
      if (!r.cells.every((c) => doc.plan[c.y][c.x] === ch)) continue;
      const own = new Set(r.cells.map((c) => c.x + ',' + c.y));
      const ok = (x, y) => inside(doc, x, y) && doc.terrain[y][x] !== '~'
        && (own.has(x + ',' + y) || doc.plan[y][x] === '.' || doc.plan[y][x] === 'o' || doc.plan[y][x] === 'O');
      const next = insertTraverses(r.cells, { ok, rear: { dx: side === 'own' ? -1 : 1, dy: 0 } });
      const same = next.length === r.cells.length && next.every((c, i) => c.x === r.cells[i].x && c.y === r.cells[i].y);
      if (same) continue;
      for (const c of r.cells) doc.plan[c.y] = setChar(doc.plan[c.y], c.x, '.');
      for (const c of next) doc.plan[c.y] = setChar(doc.plan[c.y], c.x, ch);
      changed++;
      any = true;
    }
    if (!any) break;
  }
  return changed;
}

/** Hat der Entwurf ein Ziel, das ins Spiel geht? (Aufreiben ohne Felder, sonst mindestens ein Feld) */
export function hasGoal(doc) {
  const g = doc.goal;
  if (!g || !GOAL_TYPES.includes(g.type) || g.type === 'keins') return false;
  return g.type === 'destroy' || !!g.cells?.length;
}

/** Spielbare Lage aus dem Entwurf (Format js/modes/lage-code.js) */
export function docToLage(doc) {
  const map = puzzleMapJson({ ...doc, id: 'eigen', num: '', title: doc.title || 'Eigene Lage' });
  map.sheet = { ...map.sheet, title: doc.title || 'Eigene Lage', blatt: doc.author ? 'Werkstatt · ' + doc.author : 'Werkstatt' };
  const spec = (g) => ({ type: g.type, pos: { x: g.at[0], y: g.at[1] } });
  const ai = doc.enemy !== 'halten';
  const scenario = {
    id: 'lage-eigen', name: doc.title || 'Eigene Lage', map: map.id,
    startHour: doc.startHour ?? 10,
    turnKind: doc.kind === 'battle' ? 'battle' : 'position',
    weather: { kind: doc.weather ?? 'clear' },
    sides: {
      a: { faction: doc.factions?.a ?? 'kaldern', groups: doc.groups.a.map(spec) },
      b: {
        faction: doc.factions?.b ?? 'morrow', groups: doc.groups.b.map(spec),
        ...(ai ? { control: 'ai', ai: { difficulty: doc.enemy, doctrine: 'ausgewogen' } } : { control: 'script' }),
      },
    },
  };
  const lage = { title: doc.title || 'Eigene Lage', map, scenario, kind: doc.kind, limit: doc.limit ?? 8 };
  if (doc.author) lage.author = doc.author;
  if (doc.brief) lage.brief = doc.brief;
  if (hasGoal(doc)) {
    // Aufreiben braucht keine Felder: alle Gruppen drueben (Format js/modes/goals.js)
    lage.goal = doc.goal.type === 'destroy' ? { type: 'destroy', groups: 'all' } : { type: doc.goal.type, cells: doc.goal.cells.map((c) => [c[0], c[1]]) };
    if (Number.isFinite(doc.maxLosses) && doc.maxLosses > 0) lage.maxLosses = doc.maxLosses;
  }
  return lage;
}

/** Entwurf aus einer Lage (Import einer Datei oder eines Codes). Wirft mit deutscher Meldung. */
export function lageToDoc(lage) {
  const m = lage?.map;
  if (!m || !Array.isArray(m.terrain)) throw new Error('In der Datei steht keine Lage.');
  const w = m.width, h = m.height;
  if (!(Number.isInteger(w) && Number.isInteger(h) && w >= 4 && h >= 4 && w <= MAX_SIDE && h <= MAX_SIDE)) {
    throw new Error(`Die Karte muss zwischen 4 und ${MAX_SIDE} Felder je Seite haben.`);
  }
  const okRows = (r) => Array.isArray(r) && r.length === h && r.every((row) => typeof row === 'string' && row.length === w);
  if (!okRows(m.terrain) || (m.heights && !okRows(m.heights))) throw new Error('Die Karte in der Datei ist unvollständig.');
  const doc = blankDoc();
  Object.assign(doc, { width: w, height: h, title: lage.title ?? m.name ?? 'Eigene Lage', author: lage.author ?? '', brief: lage.brief ?? '' });
  doc.terrain = m.terrain.slice();
  doc.heights = Array.isArray(m.heights) ? m.heights.slice() : rows(w, h, '0');
  const z = m.zones?.[0] ?? '';
  const own = [...z].findIndex((c) => c === 'N' || c === 's' || c === 'e');
  const foe = [...z].findIndex((c) => c === 's' || c === 'e');
  doc.zoneCols = [own < 0 ? Math.floor(w / 3) : own, foe < 0 ? w - Math.floor(w / 3) : foe];
  doc.plan = rows(w, h, '.');
  const put = (x, y, ch) => { if (x >= 0 && y >= 0 && x < w && y < h) doc.plan[y] = setChar(doc.plan[y], x, ch); };
  for (const c of m.craters ?? []) put(c.x, c.y, (c.size ?? 1) > 1 ? 'O' : 'o');
  for (const c of m.wire ?? []) put(c.x, c.y, c.side === 'enemy' ? 'X' : 'x');
  for (const t of m.trenches ?? []) put(t.x, t.y, t.side === 'enemy' ? (t.kind === 'comm' ? ';' : '#') : (t.kind === 'comm' ? ':' : '='));
  const sc = lage.scenario ?? {};
  const back = (g) => ({ type: g.type, at: [g.pos.x, g.pos.y] });
  const okG = (g) => g && Number.isInteger(g.pos?.x) && Number.isInteger(g.pos?.y) && g.pos.x >= 0 && g.pos.y >= 0 && g.pos.x < w && g.pos.y < h;
  doc.groups = { a: (sc.sides?.a?.groups ?? []).filter(okG).map(back).slice(0, MAX_GROUPS), b: (sc.sides?.b?.groups ?? []).filter(okG).map(back).slice(0, MAX_GROUPS) };
  doc.factions = { a: sc.sides?.a?.faction ?? 'kaldern', b: sc.sides?.b?.faction ?? 'morrow' };
  doc.enemy = sc.sides?.b?.control === 'ai' && ENEMY_MODES.includes(sc.sides.b.ai?.difficulty) ? sc.sides.b.ai.difficulty : 'halten';
  doc.kind = lage.kind === 'position' || sc.turnKind === 'position' ? 'position' : 'battle';
  doc.startHour = sc.startHour ?? 10;
  doc.weather = sc.weather?.kind ?? 'clear';
  doc.limit = lage.limit ?? 8;
  doc.goal = lage.goal && GOAL_TYPES.includes(lage.goal.type)
    ? { type: lage.goal.type, cells: (Array.isArray(lage.goal.cells) ? lage.goal.cells : []).map((c) => (Array.isArray(c) ? [c[0], c[1]] : [c?.x, c?.y]))
      .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h).slice(0, 6) }
    : null;
  doc.maxLosses = Number.isFinite(lage.maxLosses) ? lage.maxLosses : null;
  return doc;
}

/** Bodenarten fuer die Werkzeugreihe */
export const TERRAIN_TOOLS = ['lehm', 'wald', 'sumpf', 'dorf', 'wasser', 'fels'].map((id) => ({ id, name: TERRAIN[id].name, code: TERRAIN[id].code }));
