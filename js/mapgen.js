// Kartenbau fuer Gefecht frei (P17): Zufallskarten aus einem Seed und die handgebauten Karten aus einer Beschreibung.
// Rein: kein DOM, kein Date, kein Math.random, keine Winkelfunktionen. Ergebnis ist Karten-JSON wie data/maps/README.md.
//
// Gebaut wird nur die westliche Haelfte (eigene Etappe, Stellung, halbes Niemandsland). Die oestliche Haelfte ist ihr
// Spiegelbild mit getauschten Seiten: "spiegel" (an der Mittellinie gespiegelt) oder "punkt" (um den Mittelpunkt gedreht,
// Nord wird Sued). Beide Seiten bekommen so dasselbe Gelaende, nur die Namen sind verschieden: jede Kartenhaelfte
// traegt Ortsnamen in der Namenssprache ihrer Fraktion (js/placenames.js).
import { createRng } from './rng.js';
import { lineCells, loadMap } from './map.js';
import { createNamer } from './placenames.js';

export const SYMMETRIES = ['spiegel', 'punkt'];
const ZONE_SWAP = { E: 'e', S: 's', N: 'N', s: 'S', e: 'E' };
const FACING = {
  spiegel: { N: 'N', NE: 'NW', E: 'W', SE: 'SW', S: 'S', SW: 'SE', W: 'E', NW: 'NE' },
  punkt: { N: 'S', NE: 'SW', E: 'W', SE: 'NW', S: 'N', SW: 'NE', W: 'E', NW: 'SE' },
};
const SIDE_SWAP = { own: 'enemy', enemy: 'own' };
const key = (x, y) => x + ',' + y;
const round = (v) => Math.floor(v + 0.5);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Gegenstueck eines Feldes in der anderen Kartenhaelfte */
export function mirrorCell(meta, x, y) {
  return { x: meta.width - 1 - x, y: meta.symmetry === 'punkt' ? meta.height - 1 - y : y };
}

/** Gegenstueck eines Punktes in Weltkoordinaten (Felder, Kommazahlen erlaubt) */
export function mirrorPoint(meta, p) {
  return [meta.width - p[0], meta.symmetry === 'punkt' ? meta.height - p[1] : p[1]];
}

/** Gegenstueck eines Rechtecks (Gebaeude) */
function mirrorRect(meta, b) {
  const w = b.w ?? 1, h = b.h ?? 1;
  return { x: meta.width - b.x - w, y: meta.symmetry === 'punkt' ? meta.height - b.y - h : b.y };
}

/** Ellipse mit weichem Rand: Wert 1 in der Mitte, 0 am Rand */
function bump(x, y, k) {
  const dx = (x + 0.5 - k.cx) / k.rx, dy = (y + 0.5 - k.cy) / k.ry;
  const d = dx * dx + dy * dy;
  return d < 1 ? 1 - d : 0;
}

// Gebaeude der Etappe: Groesse und Vorzugsort als Anteil (Etappenbreite, Kartenhoehe)
const ETAPPE_BUILDINGS = [
  { id: 'depot', type: 'depot', w: 3, h: 2, letter: 'D', label: 'Depot', at: [0.3, 0.45] },
  { id: 'bahnhof', type: 'bahnhof', w: 3, h: 2, letter: 'B', label: 'Feldbahnhof', at: [0.62, 0.45] },
  { id: 'kueche', type: 'kueche', w: 2, h: 2, letter: 'K', label: 'Feldküche', at: [0.3, 0.27] },
  { id: 'ruhelager', type: 'ruhelager', w: 3, h: 2, letter: 'R', label: 'Ruhelager', at: [0.6, 0.27] },
  { id: 'lazarett', type: 'lazarett', w: 3, h: 2, letter: 'L', label: 'Lazarett', at: [0.3, 0.62] },
  { id: 'werkstatt', type: 'werkstatt', w: 3, h: 2, letter: 'W', label: 'Werkstatt', at: [0.62, 0.62] },
  { id: 'fernmelde', type: 'fernmelde', w: 2, h: 2, letter: 'F', label: 'Fernmelde', at: [0.85, 0.36] },
  { id: 'batterie1', type: 'batterie', w: 2, h: 2, letter: 'A1', label: 'Batterie 1', at: [0.75, 0.76] },
  { id: 'batterie2', type: 'batterie', w: 2, h: 2, letter: 'A2', label: 'Batterie 2', at: [0.5, 0.86] },
];

/**
 * Karte aus einer Beschreibung bauen. Koordinaten der Beschreibung liegen in der westlichen Haelfte.
 * spec: { id, name, title?, blatt?, seed, width, height, symmetry, langs: { a, b }, etappe, stellung, wobble?,
 *   river?, hills: [{cx,cy,rx,ry,peak,name?,named?}], dips, woods, villages, swamps, chalk,
 *   center?: { kind: 'hill'|'farm'|'mill', cy, names? }, Namen je Sprache: names: { kaldern, morrow }, bulges: [{y0,y1,dx}], strong: [y0,y1],
 *   wireGaps: [y], comm: [y], notes?: [...] }
 */
export function buildMap(spec) {
  const W = spec.width, H = spec.height;
  if (W % 2) throw new Error('Kartenbreite muss gerade sein');
  const half = W / 2;
  const sym = SYMMETRIES.includes(spec.symmetry) ? spec.symmetry : 'spiegel';
  const meta = { width: W, height: H, symmetry: sym };
  const rng = createRng((spec.seed >>> 0) ^ 0x5eed17);
  const langs = { a: spec.langs?.a ?? 'kaldern', b: spec.langs?.b ?? 'morrow' };
  const grid = (v) => Array.from({ length: H }, () => Array.from({ length: half }, () => v));
  const terrain = grid('.');
  const zones = grid('N');
  const hf = grid(1);

  // Zonen: Etappenbreite, dann Stellung bis eine Spalte vor die Feuerlinie, dann Niemandsland bis zur Mitte
  const wob = [];
  const amp = spec.wobble ?? 1;
  let cur = 0;
  for (let y = 0; y < H; y++) {
    if (y % 5 === 0) cur = amp ? Math.floor(rng() * (2 * amp + 1)) - amp : 0;
    wob.push(cur);
  }
  const nm = half - spec.etappe - spec.stellung;
  if (nm < 3) throw new Error('Niemandsland zu schmal');
  const bulgeAt = (y) => {
    let d = 0;
    for (const b of spec.bulges ?? []) if (y >= b.y0 && y <= b.y1) d = b.dx;
    return clamp(d, -2, nm - 3);
  };
  const frontX = (y) => spec.etappe + spec.stellung - 2 + bulgeAt(y);
  const etappeEnd = (y) => spec.etappe - 1 + (y >= 2 && y < H - 2 ? clamp(wob[y], -1, 1) : 0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < half; x++) zones[y][x] = x <= etappeEnd(y) ? 'E' : x <= frontX(y) + 1 ? 'S' : 'N';
  }

  // Hoehen
  const riverX = [];
  for (let y = 0; y < H; y++) riverX.push(spec.river ? 1 + (Math.floor(y / 7) % 2 === 0 ? 1 : 0) + (rng() < 0.15 ? 1 : 0) - 1 : -1);
  const hills = [...(spec.hills ?? [])];
  if (spec.center?.kind === 'hill') hills.push({ cx: half, cy: spec.center.cy, rx: spec.center.rx ?? 5, ry: spec.center.ry ?? 4, peak: spec.center.peak ?? 2.2 });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < half; x++) {
      let h = 1;
      for (const k of hills) h += k.peak * bump(x, y, k);
      for (const k of spec.dips ?? []) h -= k.depth * bump(x, y, k);
      if (riverX[y] >= 0 && x < riverX[y] + 4) h = Math.min(h, (x - riverX[y]) / 4 + 0.2);
      hf[y][x] = clamp(round(h), 0, 3);
    }
  }

  // Boden: Flecken mit unruhigem Rand
  const blob = (k, code, rough = 0.25) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < half; x++) {
      const dx = (x + 0.5 - k.cx) / k.rx, dy = (y + 0.5 - k.cy) / k.ry;
      if (dx * dx + dy * dy < 1 - rough + rng() * rough * 2) terrain[y][x] = code;
    }
  };
  for (const k of spec.woods ?? []) blob(k, 'w', k.rough ?? 0.25);
  for (const k of spec.swamps ?? []) blob(k, 's');
  for (let y = 0; y < H; y++) for (let x = 0; x < half; x++) {
    if (hf[y][x] === 3) terrain[y][x] = rng() < 0.15 ? 'f' : 'k';
  }
  for (const k of spec.chalk ?? []) blob(k, 'k');
  const village = (k) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < half; x++) {
      if (bump(x, y, k) > 0 && ((x + y) % 3 !== 0 || rng() < 0.4)) terrain[y][x] = 'd';
    }
  };
  for (const k of spec.villages ?? []) village(k);
  if (spec.center?.kind === 'farm' || spec.center?.kind === 'mill') {
    village({ cx: half, cy: spec.center.cy, rx: 1.6, ry: 1.4 });
    if (spec.center.kind === 'mill') blob({ cx: half, cy: spec.center.cy + 3, rx: 2.5, ry: 1.6 }, 's');
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < half; x++) if (x <= riverX[y]) { terrain[y][x] = '~'; hf[y][x] = 0; }

  // Graeben
  const trenches = new Map();
  const put = (x, y, o) => {
    if (x < 0 || x >= half || y < 0 || y >= H || terrain[y][x] === '~') return;
    const old = trenches.get(key(x, y));
    if (old && old.kind === 'fire' && o.kind === 'comm') return;
    if (old && old.kind === o.kind && old.level >= o.level) return;
    trenches.set(key(x, y), { x, y, ...o });
  };
  const line = (pts, o) => {
    for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) put(x, y, o);
  };
  const own = { side: 'own', facing: 'E' };
  const strong = spec.strong ?? [-1, -1];
  const front = [];
  for (let y = 1; y <= H - 2; y++) front.push([frontX(y), y]);
  for (let i = 0; i < front.length - 1; i++) {
    const y = front[i][1];
    line([front[i], front[i + 1]], { ...own, kind: 'fire', level: y >= strong[0] && y <= strong[1] ? 3 : 2 });
  }
  const supportX = spec.etappe + 2;
  line([[supportX, 2], [supportX, H - 3]], { ...own, kind: 'fire', level: 2 });
  const comm = spec.comm ?? [round(H * 0.2), round(H * 0.5), round(H * 0.8)];
  for (const y of comm) line([[supportX, y], [frontX(y), y]], { ...own, kind: 'comm', level: 2 });
  for (const y of comm.slice(0, 2)) line([[etappeEnd(y) + 1, y + 1], [supportX, y + 1]], { ...own, kind: 'comm', level: 1 });

  // Draht vor der Feuerlinie mit Gassen
  const gaps = new Set();
  for (const y of spec.wireGaps ?? []) { gaps.add(y); gaps.add(y + 1); }
  const wire = [];
  for (let y = 1; y <= H - 2; y++) {
    const x = frontX(y) + 2;
    if (!gaps.has(y) && x < half && !trenches.has(key(x, y))) wire.push({ x, y, side: 'own' });
  }

  // Gebaeude und Gleise
  const blocked = (x, y) => x < 0 || y < 0 || x >= half || y >= H || terrain[y][x] === '~' || trenches.has(key(x, y));
  const taken = new Set();
  const rails = new Map();
  const buildings = [];
  const free = (b, x, y, margin = 1) => {
    for (let yy = y - margin; yy < y + b.h + margin; yy++) for (let xx = x - margin; xx < x + b.w + margin; xx++) {
      const inside = yy >= y && yy < y + b.h && xx >= x && xx < x + b.w;
      if (inside && (blocked(xx, yy) || zones[yy]?.[xx] !== b.zone || rails.has(key(xx, yy)))) return false;
      if (taken.has(key(xx, yy))) return false;
    }
    return true;
  };
  const place = (b, px, py) => {
    // Spirale um den Vorzugsort, feste Reihenfolge
    for (let r = 0; r < Math.max(W, H); r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = px + dx, y = py + dy;
        if (free(b, x, y)) {
          for (let yy = y; yy < y + b.h; yy++) for (let xx = x; xx < x + b.w; xx++) { taken.add(key(xx, yy)); terrain[yy][xx] = '.'; }
          const out = { id: b.id, type: b.type, x, y, w: b.w, h: b.h, letter: b.letter, label: b.label };
          buildings.push(out);
          return out;
        }
      }
    }
    throw new Error('Kein Platz fuer ' + b.id);
  };
  const ex = (f) => clamp(round(Math.max(0, riverX[0] + 1) + f * (spec.etappe - Math.max(0, riverX[0] + 1))), 1, spec.etappe - 3);
  const ey = (f) => clamp(round(f * H), 2, H - 4);
  const placed = {};
  for (const b of ETAPPE_BUILDINGS.slice(0, 2)) placed[b.id] = place({ ...b, zone: 'E' }, ex(b.at[0]), ey(b.at[1]));
  // Feldbahn: vom Bahnhof nach vorn zur Unterstuetzungslinie, zwei Aeste
  const railLine = (pts) => {
    for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
      if (!blocked(x, y) && !taken.has(key(x, y))) rails.set(key(x, y), [x, y]);
    }
  };
  const dep = placed.depot, bf = placed.bahnhof;
  const ry = bf.y + bf.h;
  const fork = clamp(etappeEnd(ry) - 1, bf.x + bf.w + 1, supportX - 2);
  railLine([[dep.x, ry], [fork, ry]]);
  railLine([[fork, ry], [supportX - 2, clamp(ry - 4, 2, H - 3)], [supportX - 1, clamp(ry - 4, 2, H - 3)]]);
  railLine([[fork, ry], [supportX - 2, clamp(ry + 4, 2, H - 3)], [supportX - 1, clamp(ry + 4, 2, H - 3)]]);
  for (const b of ETAPPE_BUILDINGS.slice(2)) placed[b.id] = place({ ...b, zone: 'E' }, ex(b.at[0]), ey(b.at[1]));
  // Beobachtungsturm auf die hoechste Stelle der Etappe
  let best = null;
  for (let y = 2; y < H - 3; y++) for (let x = 1; x < spec.etappe - 2; x++) {
    const h = hf[y][x] + hf[y + 1][x] + hf[y][x + 1] + hf[y + 1][x + 1];
    if (free({ w: 2, h: 2, zone: 'E' }, x, y) && (!best || h > best.h)) best = { x, y, h };
  }
  if (best) placed.turm = place({ id: 'turm', type: 'turm', w: 2, h: 2, letter: 'T', label: 'Beob.-Turm', zone: 'E' }, best.x, best.y);
  // Unterstaende zwischen den Linien
  [0.18, 0.4, 0.62, 0.84].forEach((f, i) => {
    const y = ey(f);
    place({ id: 'unterstand' + (i + 1), type: 'unterstand', w: 1, h: 1, letter: '', label: '', zone: 'S' }, frontX(y) - 3, y);
  });

  // Krater: dicht im Niemandsland, vereinzelt in der Stellung
  const craters = [];
  const craterSet = new Set();
  const addCrater = (x, y, size) => {
    if (x < 0 || x >= half || y < 0 || y >= H) return;
    const k = key(x, y);
    if (craterSet.has(k) || trenches.has(k) || taken.has(k) || terrain[y][x] === '~' || terrain[y][x] === 'd') return;
    craterSet.add(k);
    craters.push({ x, y, size });
  };
  const nmCount = round(nm * H * (spec.craters ?? 0.24));
  for (let i = 0; i < nmCount; i++) {
    const y = 1 + Math.floor(rng() * (H - 2));
    addCrater(frontX(y) + 2 + Math.floor(rng() * (half - frontX(y) - 2)), y, rng() < 0.35 ? 2 : 1);
  }
  for (let i = 0; i < round(H * 0.4); i++) addCrater(supportX + 1 + Math.floor(rng() * (spec.stellung - 3)), 1 + Math.floor(rng() * (H - 2)), 1);

  // ---------- ganze Karte aus der Haelfte ----------
  const fullRows = (g, swap) => {
    const out = [];
    for (let y = 0; y < H; y++) {
      let row = '';
      for (let x = 0; x < W; x++) {
        if (x < half) row += g[y][x];
        else { const m = mirrorCell(meta, x, y); const c = String(g[m.y][m.x]); row += swap ? (swap[c] ?? c) : c; }
      }
      out.push(row);
    }
    return out;
  };
  const mirrorList = (list, f) => [...list, ...list.map((c) => ({ ...f(c), ...mirrorCell(meta, c.x, c.y) }))];
  const byPos = (a, b) => a.y - b.y || a.x - b.x;
  const allBuildings = [
    ...buildings,
    ...buildings.map((b) => ({ ...b, id: 'm-' + b.id, ...mirrorRect(meta, b), side: 'enemy' })),
  ];

  // ---------- Namen ----------
  const namer = createNamer(createRng((spec.seed >>> 0) ^ 0x0a3e5));
  const labels = [];
  const notes = [];
  const both = (x, y, mk) => { labels.push(mk('a', x, y)); const [mx, my] = mirrorPoint(meta, [x, y]); labels.push(mk('b', mx, my)); };
  // Feste Namen je Sprache (handgebaute Karten: names: { kaldern, morrow }), sonst erzeugt
  const nameOf = (f, s, kind) => f.names?.[langs[s]] ?? namer(langs[s], kind);
  for (const v of spec.villages ?? []) {
    if (v.named === false) continue;
    both(v.cx, v.cy + v.ry + 0.9, (s, x, y) => ({ text: nameOf(v, s, 'village'), x, y, size: 0.6, font: 'head' }));
  }
  for (const k of spec.woods ?? []) {
    if (k.named === false || k.rx < 2.5) continue;
    both(k.cx, k.cy, (s, x, y) => ({ text: nameOf(k, s, 'wood'), x, y, size: 0.5, font: 'head', alpha: 0.75 }));
  }
  for (const k of spec.hills ?? []) {
    if (!k.named) continue;
    both(k.cx, k.cy + k.ry * 0.55, (s, x, y) => ({ text: nameOf(k, s, 'hill'), x, y, size: 0.55, font: 'head', color: 'contour' }));
  }
  if (spec.river) {
    const t = { names: { kaldern: spec.riverName, morrow: spec.riverOther } };
    both(1.2, H / 2, (s, x, y) => ({ text: nameOf(t, s, 'water'), x, y, size: 0.7, rotate: -90, font: 'head', color: 'water' }));
  }
  // Umstrittener Ort auf der Mittellinie: gedruckt steht der eigene Name, drueben heisst er anders (Bleistift)
  let centerName = null;
  if (spec.center) {
    const c = spec.center;
    const kind = c.kind === 'hill' ? 'hill' : c.kind;
    centerName = nameOf(c, 'a', kind);
    const otherName = nameOf(c, 'b', kind);
    const meters = 180 + Math.floor(rng() * 60);
    const text = c.kind === 'hill' ? `${centerName} (${meters})` : centerName;
    labels.push({ text, x: half, y: c.cy + (c.kind === 'hill' ? 2.6 : 2.4), size: 0.62, font: 'head', color: c.kind === 'hill' ? 'contour' : undefined });
    const ny = c.cy < H / 2 ? c.cy + 5.2 : c.cy - 4.6;
    notes.push({ text: `drüben: „${otherName}“`, x: half + 3.5, y: clamp(ny, 1.2, H - 0.8), to: [half + 0.3, c.cy + 0.4], rotate: -3 });
  }
  labels.push({ text: 'ETAPPE', x: spec.etappe / 2, y: H - 1.6, size: 0.6, font: 'head', alpha: 0.5 });
  labels.push({ text: 'NIEMANDSLAND', x: half, y: spec.center && Math.abs(spec.center.cy - H / 2) < 8 ? (spec.center.cy < H / 2 ? H * 0.78 : H * 0.22) : H / 2, size: 0.6, font: 'head', alpha: 0.4, rotate: -90 });
  ['A', 'B', 'C'].forEach((n, i) => {
    const y = round(H * (i * 2 + 1) / 6);
    labels.push({ text: 'Abschnitt ' + n, x: frontX(y) - 1.4, y, size: 0.5, font: 'head', color: 'own', rotate: -90 });
  });
  const gap = (spec.wireGaps ?? [])[0];
  if (gap !== undefined) notes.push({ text: 'Gasse im Draht', x: frontX(gap) + 5, y: clamp(gap - 2.5, 1.2, H - 1), to: [frontX(gap) + 2.4, gap + 0.6], rotate: 3 });
  for (const n of spec.notes ?? []) notes.push({ ...n });

  const fe = placed.fernmelde;
  const cx = fe.x + 1, cy = fe.y + 1;
  const b1 = placed.batterie1, b2 = placed.batterie2;
  const cables = [
    { from: 'fernmelde', to: 'Abschnitt A', points: [[cx, cy], [supportX - 3, comm[0] - 0.5], [supportX, comm[0] - 0.5]] },
    { from: 'fernmelde', to: 'Abschnitt C', points: [[cx, cy], [supportX - 3, comm[comm.length - 1] - 0.5], [supportX, comm[comm.length - 1] - 0.5]] },
    { from: 'fernmelde', to: 'batterie1', points: [[cx, cy], [b1.x + 1, b1.y + 1]] },
    { from: 'fernmelde', to: 'batterie2', points: [[cx, cy], [b2.x + 1, b2.y + 1]] },
  ];

  const mapName = spec.name ?? centerName ?? labels[0]?.text ?? 'Zufallskarte';
  const sheetName = spec.title ?? `Lagekarte ${mapName}`;
  const map = {
    id: spec.id,
    name: mapName,
    sheet: { title: sheetName, blatt: spec.blatt ?? `Blatt Z${(spec.seed >>> 0) % 1000}`, scale: '1 : 2500', seed: spec.seed >>> 0 },
    width: W,
    height: H,
    legend: 'terrain: . Lehm, k Kreide, f Fels, s Sumpf, w Wald, d Dorf, ~ Wasser | heights: 0 bis 3 | zones: E Etappe, S Stellung, N Niemandsland, s/e feindlich',
    symmetry: sym,
    langs,
    terrain: fullRows(terrain),
    heights: fullRows(hf),
    zones: fullRows(zones, ZONE_SWAP),
    trenches: mirrorList([...trenches.values()], (t) => ({ ...t, side: SIDE_SWAP[t.side], facing: FACING[sym][t.facing] ?? t.facing })).sort(byPos),
    wire: mirrorList(wire, (d) => ({ ...d, side: SIDE_SWAP[d.side] })).sort(byPos),
    craters: mirrorList(craters, (c) => ({ ...c })).sort(byPos),
    rails: [...rails.values(), ...[...rails.values()].map(([x, y]) => { const m = mirrorCell(meta, x, y); return [m.x, m.y]; })]
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    buildings: allBuildings,
    cables,
    labels: labels.map((l) => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined))),
    notes,
  };
  loadMap(map); // prueft das Ergebnis
  return map;
}

/** Leitungen der Gegenseite: die Kartenleitungen von Seite a gespiegelt (fuer das Szenario, sides.b.artillery.lines) */
export function mirroredLines(json) {
  const meta = { width: json.width, height: json.height, symmetry: json.symmetry ?? 'spiegel' };
  return (json.cables ?? []).map((c, i) => ({
    id: 'mk' + (i + 1),
    to: c.to.startsWith('batterie') ? 'm-' + c.to : c.to,
    points: c.points.map((p) => mirrorPoint(meta, p)),
  }));
}

/**
 * Beschreibung einer Zufallskarte aus dem Seed. opts.langs: Namenssprachen { a, b } (Fraktions-IDs).
 * Gleicher Seed und gleiche Sprachen ergeben dieselbe Karte.
 */
export function randomSpec(seed, { langs = { a: 'kaldern', b: 'morrow' } } = {}) {
  const s = seed >>> 0;
  const rng = createRng(Math.imul(s ^ 0x17a3, 0x9e3779b1) >>> 0);
  const r = (a, b) => a + Math.floor(rng() * (b - a + 1));
  const f = (a, b) => a + rng() * (b - a);
  const W = [56, 60, 60, 64][r(0, 3)];
  const H = [36, 40, 40][r(0, 2)];
  const half = W / 2;
  const symmetry = rng() < 0.55 ? 'spiegel' : 'punkt';
  const etappe = 15;
  const stellung = clamp(r(9, 11), 9, half - etappe - 4);
  const nm = half - etappe - stellung;
  const river = rng() < 0.6;
  const hills = [];
  const nh = r(1, 3);
  for (let i = 0; i < nh; i++) {
    hills.push({ cx: f(4, half - 4), cy: f(4, H - 4), rx: f(3, 7), ry: f(2.5, 5), peak: f(0.8, 2.2), named: i === 0 });
  }
  const dips = [];
  const swamps = [];
  const nd = r(0, 2);
  for (let i = 0; i < nd; i++) {
    const d = { cx: f(etappe, half - 1), cy: f(4, H - 4), rx: f(2.5, 4.5), ry: f(2, 3.5), depth: f(0.8, 1.3) };
    dips.push(d);
    if (rng() < 0.7) swamps.push({ cx: d.cx, cy: d.cy, rx: d.rx * 0.8, ry: d.ry * 0.75 });
  }
  const woods = [{ cx: f(4, etappe - 3), cy: rng() < 0.5 ? f(2, 6) : f(H - 6, H - 2), rx: f(3.5, 6), ry: f(2.5, 3.5) }];
  if (rng() < 0.7) woods.push({ cx: f(etappe + 2, half - nm), cy: f(5, H - 5), rx: f(2.5, 4), ry: f(2, 3) });
  if (rng() < 0.6) woods.push({ cx: f(half - nm + 1, half - 1.5), cy: f(4, H - 4), rx: f(1.2, 1.8), ry: f(1, 1.4), rough: 0.4, named: false });
  const villages = [{ cx: f(4, etappe - 4), cy: f(H * 0.3, H * 0.7), rx: f(2, 3), ry: f(1.8, 2.6) }];
  if (rng() < 0.4) villages.push({ cx: f(etappe + 3, etappe + stellung - 4), cy: f(5, H - 5), rx: 1.6, ry: 1.4, named: true });
  const centerKind = ['hill', 'hill', 'hill', 'farm', 'mill', null][r(0, 5)];
  const center = centerKind ? {
    kind: centerKind,
    cy: symmetry === 'punkt' ? H / 2 : f(H * 0.25, H * 0.75),
    rx: f(4, 6), ry: f(3, 4.5), peak: f(1.6, 2.4),
  } : null;
  const bulges = [];
  if (rng() < 0.6) { const y0 = r(5, H - 12); bulges.push({ y0, y1: y0 + r(5, 9), dx: 1 }); }
  const sy = r(3, H - 12);
  const g1 = r(3, Math.floor(H / 2) - 2), g2 = r(Math.floor(H / 2) + 1, H - 4);
  return {
    id: 'zufall-' + s,
    name: null,
    seed: s,
    width: W,
    height: H,
    symmetry,
    langs,
    etappe,
    stellung,
    wobble: 1,
    river,
    hills,
    dips,
    swamps,
    woods,
    villages,
    center,
    bulges,
    strong: [sy, sy + r(4, 8)],
    wireGaps: [g1, g2],
    comm: [round(H * 0.2) + r(-1, 1), round(H * 0.5) + r(-1, 1), round(H * 0.8) + r(-1, 1)],
  };
}

/** Zufallskarte aus Seed und Namenssprachen */
export function generateMap(seed, opts = {}) {
  return buildMap(randomSpec(seed, opts));
}
