// Szene "werkstatt": Missionseditor und Stellungsbau-Sandbox (P25, Plan 8 und 9).
// Sandkasten: Graeben ohne Gegner zeichnen, der Ausbilder prueft auf Laengsfeuer und zeigt, wo ein MG stuende.
// Missionseditor: Gelaende, Hoehen, Graeben, Draht, Truppen beider Seiten, Ziel und Frist; Probe spielen,
// als Code oder Datei teilen, in der eigenen Mappe ablegen. Teilen uebers Netz kommt mit Supabase (P20).
// Parameter: tab=sand|mission, lage=<Code> (zum Bearbeiten laden), demo=sand|mission (fuer Screenshots).
import { loadMap, lineCells } from '../map.js';
import { createCamera, resizeCamera, centerOn, fitZoom, screenToWorld, zoomAt, panBy } from '../render/camera.js';
import { applyCameraTransform } from '../render/camera.js';
import { createMapLayer, sheetBounds, FONTS } from '../render/map-layer.js';
import { drawUnit } from '../render/units-layer.js';
import { themeAt, applyTheme, currentTheme } from '../theme.js';
import { cellsFromPoints, insertTraverses } from '../trench.js';
import { FACTIONS } from '../config/factions.js';
import { UNIT_TYPES } from '../config/units.js';
import { DIFFICULTIES } from '../config/doctrines.js';
import { MARKS } from '../ui/labels.js';
import { esc, ensureCss } from '../ui/dom.js';
import { audio, playSfx } from '../audio/engine.js';
import { goalText } from '../modes/goals.js';
import { encodeLage, decodeLage, lageProblems } from '../modes/lage-code.js';
import {
  SIZES, ENEMY_MODES, PLACE_TYPES, TERRAIN_TOOLS, blankDoc, paintCell, toggleGroup, toggleGoalCell,
  judgePosition, fixRuns, docToLage, lageToDoc, hasGoal,
} from '../modes/werkstatt.js';

const DRAFT_KEY = 'lehmfront.werkstatt.entwurf';
const SHELF_KEY = 'lehmfront.werkstatt.v1';
const WEATHER = [['clear', 'Klar'], ['overcast', 'Bedeckt'], ['rain', 'Regen'], ['fog', 'Nebel']];
const GOALS = [['keins', 'Kein Ziel (freies Gefecht)'], ['take', 'Nehmen'], ['hold', 'Halten'], ['destroy', 'Alle drüben aufreiben']];

/** Werkzeuge: layer + Zeichen; line = als Linie mit Traversen-Option zeichnen */
const TOOLS = {
  fire: { label: 'Feuergraben', sub: 'ziehen', layer: 'plan', ch: '=', line: true },
  comm: { label: 'Laufgraben', sub: 'ziehen', layer: 'plan', ch: ':', line: true },
  efire: { label: 'Feindgraben', sub: 'ziehen', layer: 'plan', ch: '#', line: true },
  ecomm: { label: 'Feind-Lauf', sub: 'ziehen', layer: 'plan', ch: ';', line: true },
  wire: { label: 'Draht', sub: 'eigener', layer: 'plan', ch: 'x' },
  ewire: { label: 'Feinddraht', sub: 'drüben', layer: 'plan', ch: 'X' },
  crater: { label: 'Trichter', sub: 'Granate', layer: 'plan', ch: 'o' },
  erase: { label: 'Radierer', sub: 'Plan weg', layer: 'plan', ch: '.' },
  up: { label: 'Höhe +', sub: 'bis 3', layer: 'height', ch: '+', once: true },
  down: { label: 'Höhe −', sub: 'bis 0', layer: 'height', ch: '-', once: true },
  ...Object.fromEntries(TERRAIN_TOOLS.map((t) => [t.id, { label: t.name, sub: 'Boden', layer: 'terrain', ch: t.code }])),
  group: { label: 'Truppe', sub: 'setzen', layer: 'group' },
  goal: { label: 'Zielfeld', sub: 'antippen', layer: 'goal' },
  pan: { label: 'Schieben', sub: 'Karte', layer: 'pan' },
};
const SAND_TOOLS = ['fire', 'comm', 'wire', 'crater', 'erase', 'pan'];
const MISSION_SETS = [
  ['Gelände', ['lehm', 'wald', 'sumpf', 'dorf', 'wasser', 'fels', 'up', 'down']],
  ['Stellung', ['fire', 'comm', 'efire', 'ecomm', 'wire', 'ewire', 'crater', 'erase']],
  ['Truppen und Ziel', ['group', 'goal', 'pan']],
];
const HINTS = {
  line: 'Mit dem Finger ziehen. Zurückfahren radiert. Zwei Finger schieben und zoomen.',
  paint: 'Antippen oder darüberstreichen. Zwei Finger schieben und zoomen.',
  group: 'Antippen setzt eine Gruppe, noch einmal antippen nimmt sie weg.',
  goal: 'Felder antippen, die gehalten oder genommen werden sollen (bis sechs).',
  pan: 'Karte ziehen. Mausrad oder zwei Finger zoomen.',
};

const read = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* voll oder gesperrt */ } };

/** Laesst sich aus dem Entwurf ein Kartenblatt bauen? Sonst null (kaputte Datei, alter Entwurf) */
function usable(d) {
  try { loadMap(docToLage(d).map); return d; } catch { return null; }
}

/** Beispiele fuer Screenshots und den ersten Besuch: ein schnurgerader Graben, der dem Ausbilder missfaellt */
function demoDoc(kind) {
  const d = blankDoc(kind === 'mission' ? 'mittel' : 'klein');
  if (kind === 'mission') {
    Object.assign(d, { title: 'Die Ziegelei', author: 'Ausbilder', brief: 'Die Ziegelei hält drüben ein MG. Nimm sie, bevor es dunkel wird.', enemy: 'veteran', limit: 8 });
    for (let y = 1; y < 15; y++) paintCell(d, 'plan', 5 + (Math.floor(y / 3) % 2), y, '=');
    for (let y = 1; y < 15; y++) paintCell(d, 'plan', 18, y, '#');
    for (let y = 2; y < 14; y++) paintCell(d, 'plan', 15, y, 'X');
    for (let y = 6; y < 10; y++) for (let x = 19; x < 22; x++) paintCell(d, 'terrain', x, y, 'd');
    for (let y = 0; y < 4; y++) for (let x = 10; x < 13; x++) paintCell(d, 'terrain', x, y, 'w');
    for (let y = 9; y < 13; y++) for (let x = 9; x < 13; x++) { paintCell(d, 'height', x, y, '+'); if (y > 9 && y < 12 && x > 9 && x < 12) paintCell(d, 'height', x, y, '+'); }
    for (const [x, y] of [[11, 6], [12, 11], [9, 4]]) paintCell(d, 'plan', x, y, 'o');
    for (const [t, x, y] of [['rifles', 5, 4], ['rifles', 6, 8], ['mg', 5, 11], ['pioneers', 3, 7]]) toggleGroup(d, 'a', t, x, y);
    for (const [t, x, y] of [['rifles', 18, 5], ['mg', 20, 7], ['rifles', 18, 11]]) toggleGroup(d, 'b', t, x, y);
    toggleGoalCell(d, 20, 7); toggleGoalCell(d, 20, 8);
  } else {
    for (let y = 1; y < 11; y++) paintCell(d, 'plan', 4, y, '=');
    for (let x = 1; x < 4; x++) paintCell(d, 'plan', x, 6, ':');
    for (let y = 2; y < 10; y++) paintCell(d, 'plan', 7, y, 'x');
    toggleGroup(d, 'a', 'rifles', 4, 3); toggleGroup(d, 'a', 'mg', 4, 8);
  }
  return d;
}

export async function mount(root, params = new URLSearchParams(location.search)) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();
  await Promise.all([
    ensureCss('css/werkstatt.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "Caveat"', '16px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {}),
  ]);

  // Entwurf: Code aus der Adresse, Beispiel, gespeicherter Entwurf oder Beispiel-Sandkasten
  let doc = null, note = '';
  const demo = params.get('demo');
  if (params.get('lage')) {
    try { doc = usable(lageToDoc(await decodeLage(params.get('lage')))); note = doc ? 'Lage aus dem Code geladen.' : 'Die Karte im Code lässt sich nicht zeichnen.'; } catch (e) { note = e.message; }
  }
  if (!doc && demo) doc = demoDoc(demo);
  if (!doc) { const saved = read(DRAFT_KEY, null); try { doc = saved ? usable(lageToDoc(saved)) : null; } catch { doc = null; } }
  if (!doc) doc = demoDoc('sand');
  let tab = params.get('tab') === 'mission' || demo === 'mission' || params.get('lage') ? 'mission' : 'sand';
  let tool = 'fire', placeSide = 'a', placeType = 'rifles', autoTraverse = false;
  const undo = [];

  root.className = 'ws';
  root.innerHTML = `<div class="ws-map">
      <canvas class="ws-static" aria-hidden="true"></canvas>
      <canvas class="ws-dyn" role="img" aria-label="Kartenblatt der Werkstatt"></canvas>
      <p class="ws-hint card" aria-live="polite"></p>
      <div class="ws-zoom"><button type="button" class="btn" data-z="out" aria-label="Verkleinern">−</button><button type="button" class="btn" data-z="fit" aria-label="Ganzes Blatt">Blatt</button><button type="button" class="btn" data-z="in" aria-label="Vergrößern">+</button></div>
    </div>
    <aside class="ws-side" aria-label="Werkstatt"></aside>`;
  const mapEl = root.querySelector('.ws-map');
  const cvS = root.querySelector('.ws-static');
  const cvD = root.querySelector('.ws-dyn');
  const side = root.querySelector('.ws-side');
  const hintEl = root.querySelector('.ws-hint');
  const dctx = cvD.getContext('2d');

  let map = loadMap(docToLage(doc).map);
  const cam = createCamera({ bounds: sheetBounds(map), maxZoom: 90 });
  const layer = createMapLayer(cvS, map, { getCamera: () => cam, getTheme: currentTheme });
  let dpr = 1, stroke = null, judged = judgePosition(doc), lastGrade = judged.grade;

  const rebuild = () => {
    map = loadMap(docToLage(doc).map);
    cam.bounds = sheetBounds(map);
    layer.setMap(map);
    judged = judgePosition(doc);
    if (tab === 'sand' && judged.grade !== lastGrade && judged.grade) playSfx('pencil', { count: 2, intensity: 0.4 });
    lastGrade = judged.grade;
    drawDyn();
  };
  const saveDraft = () => write(DRAFT_KEY, docToLage(doc));
  const remember = () => { undo.push(JSON.stringify(doc)); if (undo.length > 40) undo.shift(); };
  const changed = () => { rebuild(); saveDraft(); updateLive(); };

  // ---------- Zeichnen der dynamischen Ebene ----------
  function drawDyn() {
    const th = currentTheme();
    const w = cvD.width, h = cvD.height;
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, w, h);
    applyCameraTransform(dctx, cam, dpr);
    const px = 1 / cam.zoom;
    // Laengsfeuer: im Sandkasten immer, im Editor fuer die eigene Linie ebenfalls (der Ausbilder schaut mit)
    for (const r of judged.runs) {
      dctx.save();
      dctx.strokeStyle = th.danger; dctx.globalAlpha = 0.28; dctx.lineCap = 'round';
      dctx.lineWidth = 0.7;
      dctx.beginPath(); dctx.moveTo(r.from.x + 0.5, r.from.y + 0.5); dctx.lineTo(r.to.x + 0.5, r.to.y + 0.5); dctx.stroke();
      dctx.restore();
    }
    const worst = judged.worst;
    if (worst?.mg) {
      const m = worst.mg, far = m.x === worst.to.x + worst.dx && m.y === worst.to.y + worst.dy ? worst.from : worst.to;
      dctx.save();
      dctx.strokeStyle = th.danger; dctx.fillStyle = th.danger; dctx.lineWidth = 2 * px; dctx.setLineDash([7 * px, 5 * px]);
      dctx.beginPath(); dctx.moveTo(m.x + 0.5, m.y + 0.5); dctx.lineTo(far.x + 0.5, far.y + 0.5); dctx.stroke();
      dctx.setLineDash([]);
      // Pfeilspitze am fernen Ende
      const ax = far.x + 0.5, ay = far.y + 0.5, vx = Math.sign(far.x - m.x), vy = Math.sign(far.y - m.y), l = Math.hypot(vx, vy) || 1;
      const ux = vx / l, uy = vy / l, s = 0.35;
      dctx.beginPath(); dctx.moveTo(ax, ay); dctx.lineTo(ax - ux * s - uy * s * 0.6, ay - uy * s + ux * s * 0.6); dctx.lineTo(ax - ux * s + uy * s * 0.6, ay - uy * s - ux * s * 0.6); dctx.closePath(); dctx.fill();
      // Feindliches MG in Bleistift
      dctx.lineWidth = 2 * px;
      dctx.strokeRect(m.x + 0.15, m.y + 0.22, 0.7, 0.56);
      dctx.font = `700 ${Math.max(0.3, 0.42)}px ${FONTS.num}`; dctx.textAlign = 'center'; dctx.textBaseline = 'middle';
      dctx.fillText('MG', m.x + 0.5, m.y + 0.52);
      dctx.font = `700 ${Math.max(0.5, 15 * px)}px ${FONTS.hand}`; dctx.textAlign = 'left'; dctx.textBaseline = 'bottom';
      const label = `fegt ${worst.length} Felder leer`;
      const lx = Math.min(m.x + 1.1, map.width - 0.2 - dctx.measureText(label).width), ly = Math.max(0.9, m.y + 0.2);
      dctx.fillText(label, lx, ly);
      dctx.restore();
    }
    // Gruppen
    for (const s of ['a', 'b']) {
      doc.groups[s].forEach((g, i) => {
        const pos = { x: g.at[0], y: g.at[1] };
        drawUnit(dctx, cam, th, { id: s + i, side: s, type: g.type, pos, status: 'ok' }, MARKS[g.type] ?? String(i + 1));
      });
    }
    // Ziel ueber den Gruppen, damit der Ring nicht unter einem Kaertchen verschwindet
    if (doc.goal?.cells?.length && doc.goal.type !== 'destroy' && doc.goal.type !== 'keins') {
      dctx.save();
      dctx.strokeStyle = th.danger; dctx.fillStyle = th.danger; dctx.lineWidth = 3 * px; dctx.setLineDash([7 * px, 4 * px]);
      dctx.font = `700 ${Math.max(0.4, 14 * px)}px ${FONTS.hand}`; dctx.textAlign = 'left'; dctx.textBaseline = 'top';
      for (const [x, y] of doc.goal.cells) {
        dctx.beginPath(); dctx.arc(x + 0.5, y + 0.5, 0.82, 0, Math.PI * 2); dctx.stroke();
        dctx.fillText('Ziel', x + 1.05, y + 0.85);
      }
      dctx.restore();
    }
    // laufender Strich
    if (stroke?.line && stroke.points.length) {
      const cells = cellsFromPoints(stroke.points);
      const t = TOOLS[tool];
      dctx.save();
      dctx.strokeStyle = t.ch === '#' || t.ch === ';' ? th.enemy : th.own; dctx.globalAlpha = 0.75;
      dctx.lineWidth = 0.32; dctx.lineCap = 'round'; dctx.lineJoin = 'round';
      dctx.beginPath();
      cells.forEach((c, i) => (i ? dctx.lineTo(c.x + 0.5, c.y + 0.5) : dctx.moveTo(c.x + 0.5, c.y + 0.5)));
      dctx.stroke();
      dctx.restore();
    }
  }

  const fit = () => { centerOn(cam, map.width / 2, map.height / 2, fitZoom(cam)); layer.invalidate(); drawDyn(); };
  const resize = () => {
    const r = mapEl.getBoundingClientRect();
    dpr = Math.min(2, devicePixelRatio || 1);
    resizeCamera(cam, r.width, r.height);
    layer.resize(r.width, r.height, dpr);
    cvD.width = Math.round(r.width * dpr); cvD.height = Math.round(r.height * dpr);
    cvD.style.width = r.width + 'px'; cvD.style.height = r.height + 'px';
    fit();
  };

  // ---------- Eingabe auf der Karte ----------
  const pointers = new Map();
  let pinch = null, panLast = null;
  const local = (e) => { const r = cvD.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const cellOf = (p) => { const w = screenToWorld(cam, p.x, p.y); return { x: Math.floor(w.x), y: Math.floor(w.y), wx: w.x, wy: w.y }; };
  const moved = () => { layer.invalidate(); drawDyn(); };

  const applyAt = (c) => {
    const t = TOOLS[tool];
    if (t.layer === 'group') {
      const res = toggleGroup(doc, placeSide, placeType, c.x, c.y);
      if (res === 'full') flash('Mehr als zwölf Gruppen je Seite passen nicht aufs Blatt.');
      if (res === 'blocked') flash('Dort kann keine Gruppe stehen.');
      if (res === 'set') playSfx('paper', { intensity: 0.3 });
      return res === 'set' || res === 'removed';
    }
    if (t.layer === 'goal') {
      if (!doc.goal) doc.goal = { type: 'take', cells: [] };
      const ok = toggleGoalCell(doc, c.x, c.y);
      if (!ok) flash('Höchstens sechs Zielfelder.');
      return ok;
    }
    return paintCell(doc, t.layer, c.x, c.y, t.ch);
  };

  cvD.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button > 0 && e.button !== 1) return;
    cvD.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      // zweiter Finger: Strich verwerfen, Karte bewegen
      if (stroke && undo.length) { const prev = undo.pop(); if (stroke.dirty) { doc = JSON.parse(prev); rebuild(); } }
      stroke = null;
      const [a, b] = [...pointers.values()];
      pinch = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drawDyn();
      return;
    }
    if (pointers.size > 2) return;
    hintEl.hidden = true; // der Hinweis verdeckt sonst auf dem Handy die Legende
    if (tool === 'pan' || e.button === 1) { panLast = p; return; }
    const c = cellOf(p);
    const t = TOOLS[tool];
    remember();
    stroke = { line: !!t.line, points: [{ x: c.wx, y: c.wy }], last: c, dirty: false };
    if (!t.line) { stroke.dirty = applyAt(c); if (stroke.dirty) rebuild(); if (t.once || t.layer === 'group' || t.layer === 'goal') stroke.done = true; }
    drawDyn();
  });
  cvD.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const now = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      zoomAt(cam, now.dist / pinch.dist, now.mid.x, now.mid.y);
      panBy(cam, now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
      pinch = now; moved();
      return;
    }
    if (panLast) { panBy(cam, p.x - panLast.x, p.y - panLast.y); panLast = p; moved(); return; }
    if (!stroke || stroke.done) return;
    const c = cellOf(p);
    if (stroke.line) { stroke.points.push({ x: c.wx, y: c.wy }); drawDyn(); return; }
    if (c.x === stroke.last.x && c.y === stroke.last.y) return;
    let any = false;
    for (const [x, y] of lineCells(stroke.last.x, stroke.last.y, c.x, c.y).slice(1)) any = applyAt({ x, y }) || any;
    stroke.last = c;
    if (any) { stroke.dirty = true; rebuild(); }
  });
  const finish = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size) { if (pointers.size < 2) pinch = null; return; }
    pinch = null; panLast = null;
    const s = stroke; stroke = null;
    if (!s) return;
    if (s.line && e.type === 'pointerup') {
      let cells = cellsFromPoints(s.points);
      const t = TOOLS[tool];
      if (autoTraverse && t.ch === '=' && cells.length >= 4) {
        cells = insertTraverses(cells, { ok: (x, y) => x >= 0 && y >= 0 && x < doc.width && y < doc.height && doc.terrain[y][x] !== '~' });
      }
      for (const c of cells) s.dirty = paintCell(doc, t.layer, c.x, c.y, t.ch) || s.dirty;
      if (s.dirty) playSfx('pencil', { count: Math.min(4, 1 + (cells.length >> 2)), intensity: 0.4 });
    }
    if (s.dirty) changed(); else { undo.pop(); drawDyn(); }
  };
  cvD.addEventListener('pointerup', finish);
  cvD.addEventListener('pointercancel', finish);
  cvD.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(cam, e.deltaY < 0 ? 1.15 : 1 / 1.15, p.x, p.y); moved(); }, { passive: false });
  cvD.addEventListener('contextmenu', (e) => e.preventDefault());
  root.querySelector('.ws-zoom').addEventListener('click', (e) => {
    const z = e.target.closest('[data-z]')?.dataset.z;
    if (z === 'fit') return fit();
    if (z) { zoomAt(cam, z === 'in' ? 1.3 : 1 / 1.3, cam.viewW / 2, cam.viewH / 2); moved(); }
  });
  const onKey = (e) => {
    if (e.target.closest?.('input, textarea, select')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
  };
  addEventListener('keydown', onKey);
  function doUndo() {
    if (!undo.length) return flash('Nichts mehr zurückzunehmen.');
    doc = JSON.parse(undo.pop());
    changed();
    renderSide();
  }

  // ---------- Seitenleiste ----------
  let flashT = 0;
  function flash(text, bad = false) {
    const el = side.querySelector('.ws-flash');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('bad', bad);
    clearTimeout(flashT);
    flashT = setTimeout(() => { el.textContent = ''; }, 6000);
  }
  const toolBtn = (id) => `<button type="button" class="btn" data-tool="${id}" aria-pressed="${tool === id}">${esc(TOOLS[id].label)}<small>${esc(TOOLS[id].sub)}</small></button>`;
  const opt = (list, cur) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`).join('');

  function analysisHtml() {
    const j = judged;
    const head = j.grade ? `<b>Stellungsnote: ${esc(j.grade)}</b><br>` : '';
    const nums = j.total ? `${j.total} Felder Feuergraben, davon ${j.exposed} im Längsfeuer.` : '';
    return `${head}${esc(nums)}<span class="note">${esc(j.note)}</span>`;
  }
  function problemsHtml() {
    const bad = lageProblems(docToLage(doc));
    if (hasGoal(doc)) {
      const g = docToLage(doc).goal;
      return bad.length ? `<span class="bad">${esc(bad[0])}</span>` : esc('Spielbar. Auftrag: ' + goalText(g).replace(/\.$/, '') + ', Frist ' + doc.limit + ' Runden.');
    }
    return bad.length ? `<span class="bad">${esc(bad[0])}</span>` : 'Spielbar als freies Gefecht.';
  }
  function updateLive() {
    const a = side.querySelector('.ws-analysis');
    if (a) a.innerHTML = analysisHtml();
    const p = side.querySelector('.ws-check');
    if (p) p.innerHTML = problemsHtml();
    renderShelf();
  }

  function renderSide() {
    const sandTools = SAND_TOOLS.map(toolBtn).join('');
    const head = `<h1>Werkstatt</h1>
      <div class="ws-tabs" role="group" aria-label="Werkstatt-Teil">
        <button type="button" class="btn" data-tab="sand" aria-pressed="${tab === 'sand'}">Sandkasten</button>
        <button type="button" class="btn" data-tab="mission" aria-pressed="${tab === 'mission'}">Missionseditor</button>
      </div>`;
    const common = `<div class="ws-row"><button type="button" class="btn" data-act="undo">Rückgängig</button><button type="button" class="btn" data-act="clear">Blatt leeren</button></div>
      <p class="ws-status ws-flash" aria-live="polite">${esc(note)}</p>`;
    note = '';
    if (tab === 'sand') {
      side.innerHTML = `${head}
        <p class="ws-status">Stellung bauen ohne Gegner. Der Ausbilder sieht dir über die Schulter.</p>
        <h2>Werkzeug</h2><div class="ws-tools">${sandTools}</div>
        <label class="ws-check-row"><input type="checkbox" data-opt="auto"${autoTraverse ? ' checked' : ''}> Traversen beim Ziehen von selbst</label>
        <h2>Ausbilder</h2><p class="ws-analysis">${analysisHtml()}</p>
        <div class="ws-row"><button type="button" class="btn" data-act="fix">Traversen einziehen</button><button type="button" class="btn" data-act="adopt">Als Missionsstart übernehmen</button></div>
        ${common}`;
    } else {
      const facs = Object.keys(FACTIONS).sort().map((id) => [id, FACTIONS[id].name]);
      const enemies = ENEMY_MODES.map((id) => [id, id === 'halten' ? 'Hält nur die Stellung' : 'KI: ' + DIFFICULTIES[id].label]);
      const types = PLACE_TYPES.map((id) => [id, UNIT_TYPES[id].name]);
      const hours = Array.from({ length: 24 }, (_, i) => [i, String(i).padStart(2, '0') + ':00']);
      side.innerHTML = `${head}
        ${MISSION_SETS.map(([t, ids]) => `<h2>${esc(t)}</h2><div class="ws-tools">${ids.map(toolBtn).join('')}</div>`).join('')}
        <div class="ws-row">
          <label>Truppe für<select data-opt="pside">${opt([['a', 'Eigene Seite'], ['b', 'Drüben']], placeSide)}</select></label>
          <label>Art<select data-opt="ptype">${opt(types, placeType)}</select></label>
        </div>
        <h2>Ausbilder</h2><p class="ws-analysis">${analysisHtml()}</p>
        <h2>Auftrag</h2>
        <div class="ws-row"><label>Titel<input data-opt="title" maxlength="40" value="${esc(doc.title)}"></label><label>Verfasser<input data-opt="author" maxlength="30" value="${esc(doc.author)}"></label></div>
        <div class="ws-row"><label>Lagebefehl<textarea data-opt="brief" maxlength="400" rows="3">${esc(doc.brief)}</textarea></label></div>
        <div class="ws-row">
          <label>Ziel<select data-opt="goal">${opt(GOALS, doc.goal?.type ?? 'keins')}</select></label>
          <label>Frist (Runden)<input data-opt="limit" type="number" inputmode="numeric" min="1" max="40" value="${doc.limit}"></label>
          <label>Verluste höchstens<input data-opt="maxLosses" type="number" inputmode="numeric" min="0" max="60" value="${doc.maxLosses ?? ''}" placeholder="egal"></label>
        </div>
        <div class="ws-row">
          <label>Beginn<select data-opt="kind">${opt([['battle', 'Im Gefecht'], ['position', 'In Stellungsrunden']], doc.kind)}</select></label>
          <label>Gegner<select data-opt="enemy">${opt(enemies, doc.enemy)}</select></label>
        </div>
        <div class="ws-row">
          <label>Eigene Seite<select data-opt="fa">${opt(facs, doc.factions.a)}</select></label>
          <label>Drüben<select data-opt="fb">${opt(facs, doc.factions.b)}</select></label>
        </div>
        <div class="ws-row">
          <label>Uhrzeit<select data-opt="hour">${opt(hours, doc.startHour)}</select></label>
          <label>Wetter<select data-opt="weather">${opt(WEATHER, doc.weather)}</select></label>
        </div>
        <p class="ws-status ws-check" aria-live="polite">${problemsHtml()}</p>
        <div class="ws-row"><button type="button" class="btn" data-act="play">Probe spielen</button><button type="button" class="btn" data-act="shelve">In die Mappe</button></div>
        <h2>Teilen</h2>
        <div class="ws-row"><button type="button" class="btn" data-act="code">Code kopieren</button><button type="button" class="btn" data-act="link">Link kopieren</button><button type="button" class="btn" data-act="paste">Code einfügen</button></div>
        <div class="ws-row"><button type="button" class="btn" data-act="save">Als Datei sichern</button><button type="button" class="btn" data-act="load">Datei laden</button><input type="file" accept=".json,application/json" hidden></div>
        <pre class="ws-code" hidden></pre>
        <p class="ws-status">Teilen über das Netz kommt mit dem Lageaustausch. Bis dahin reist eine Lage als Code oder Datei.</p>
        <h2>Neues Blatt</h2>
        <div class="ws-row"><label>Größe<select data-opt="size">${opt(Object.values(SIZES).map((s) => [s.id, `${s.label} (${s.width} × ${s.height})`]), Object.values(SIZES).find((s) => s.width === doc.width)?.id ?? 'klein')}</select></label><button type="button" class="btn" data-act="new">Neues Blatt</button></div>
        <h2>Meine Lagen</h2><ul class="ws-list"></ul>
        ${common}`;
    }
    side.insertAdjacentHTML('beforeend', '<div class="ws-row ws-out"><a class="btn" href="?scene=puzzle">Lehrgangsmappe</a><a class="btn" href="./">Hauptmenü</a></div>');
    renderShelf();
    updateHint();
  }

  function renderShelf() {
    const ul = side.querySelector('.ws-list');
    if (!ul) return;
    const shelf = read(SHELF_KEY, []);
    ul.innerHTML = shelf.length ? shelf.map((s, i) => `<li><span class="grow">${esc(s.title)}<br><small>${esc(s.saved ?? '')}</small></span><button type="button" class="btn" data-open="${i}">Öffnen</button><button type="button" class="btn" data-del="${i}" aria-label="${esc(s.title)} löschen">Weg</button></li>`).join('')
      : '<li class="ws-status">Noch nichts abgelegt.</li>';
  }

  function updateHint() {
    const t = TOOLS[tool];
    const kind = t.line ? 'line' : t.layer === 'group' ? 'group' : t.layer === 'goal' ? 'goal' : t.layer === 'pan' ? 'pan' : 'paint';
    hintEl.textContent = `${t.label}: ${HINTS[kind]}`;
    hintEl.hidden = false;
  }

  async function shareCode() {
    const lage = docToLage(doc);
    const bad = lageProblems(lage);
    if (bad.length) { flash(bad[0], true); return null; }
    return encodeLage(lage);
  }
  async function copy(text, what) {
    const pre = side.querySelector('.ws-code');
    try { await navigator.clipboard.writeText(text); flash(what + ' liegt in der Zwischenablage.'); } catch { flash(what + ' steht unten zum Kopieren.'); }
    if (pre) { pre.hidden = false; pre.textContent = text; }
  }
  const adopt = (d, msg) => {
    if (!usable(d)) { flash('Die Karte in dieser Lage lässt sich nicht zeichnen.', true); return; }
    remember(); doc = d; changed(); fit(); renderSide(); flash(msg);
  };

  side.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tab) {
      tab = b.dataset.tab;
      if (tab === 'sand' && !SAND_TOOLS.includes(tool)) tool = 'fire';
      renderSide(); drawDyn();
      return;
    }
    if (b.dataset.tool) {
      tool = b.dataset.tool;
      side.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tool === tool)));
      updateHint();
      return;
    }
    if (b.dataset.open !== undefined) {
      const s = read(SHELF_KEY, [])[Number(b.dataset.open)];
      if (s) try { adopt(lageToDoc(s.lage), `„${s.title}“ geöffnet.`); } catch (err) { flash(err.message, true); }
      return;
    }
    if (b.dataset.del !== undefined) {
      const shelf = read(SHELF_KEY, []);
      const [gone] = shelf.splice(Number(b.dataset.del), 1);
      write(SHELF_KEY, shelf); renderShelf();
      if (gone) flash(`„${gone.title}“ aus der Mappe genommen.`);
      return;
    }
    const act = b.dataset.act;
    if (act === 'undo') doUndo();
    else if (act === 'clear') {
      remember();
      const keep = { title: doc.title, author: doc.author };
      doc = Object.assign(blankDoc(Object.values(SIZES).find((s) => s.width === doc.width)?.id ?? 'klein'), keep);
      changed(); renderSide(); flash('Blatt geleert. Rückgängig holt es zurück.');
    } else if (act === 'fix') {
      remember();
      const n = fixRuns(doc, 'own');
      if (n) { changed(); playSfx('pencil', { count: 4, intensity: 0.5 }); flash(n === 1 ? 'Eine Gerade geknickt.' : `${n} Geraden geknickt.`); } else { undo.pop(); flash(judged.runs.length ? 'Dort ist kein Platz für eine Traverse.' : 'Nichts zu knicken.'); }
    } else if (act === 'adopt') {
      tab = 'mission'; tool = 'group'; placeSide = 'b';
      if (!doc.title || doc.title === 'Eigene Lage') doc.title = 'Meine Stellung';
      saveDraft(); renderSide(); drawDyn();
      flash('Übernommen. Jetzt den Gegner drüben aufstellen und ein Ziel setzen.');
    } else if (act === 'play') {
      const code = await shareCode();
      if (code) { saveDraft(); location.href = '?scene=gefecht&lage=' + code; }
    } else if (act === 'code') {
      const code = await shareCode();
      if (code) copy(code, 'Der Code');
    } else if (act === 'link') {
      const code = await shareCode();
      if (code) copy(new URL('?scene=gefecht&lage=' + code, location.href).href, 'Der Link');
    } else if (act === 'paste') {
      const text = prompt('Lage-Code einfügen (beginnt mit L1.)');
      if (!text) return;
      try { const t = text.includes('lage=') ? new URL(text, location.href).searchParams.get('lage') : text; adopt(lageToDoc(await decodeLage(t)), 'Lage aus dem Code geladen.'); } catch (err) { flash(err.message, true); }
    } else if (act === 'save') {
      const lage = { ...docToLage(doc), v: 1 };
      const blob = new Blob([JSON.stringify(lage, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'lage-' + (doc.title || 'eigen').toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-').replace(/^-|-$/g, '') + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash('Datei gesichert.');
    } else if (act === 'load') {
      side.querySelector('input[type=file]')?.click();
    } else if (act === 'shelve') {
      const shelf = read(SHELF_KEY, []);
      const lage = docToLage(doc);
      const entry = { title: doc.title || 'Eigene Lage', saved: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }), lage };
      const i = shelf.findIndex((s) => s.title === entry.title);
      if (i >= 0) shelf[i] = entry; else shelf.unshift(entry);
      write(SHELF_KEY, shelf.slice(0, 30)); renderShelf();
      flash(`„${entry.title}“ liegt in der Mappe.`);
      playSfx('paper', { intensity: 0.5 });
    } else if (act === 'new') {
      const size = side.querySelector('[data-opt=size]')?.value ?? 'klein';
      remember();
      doc = blankDoc(size);
      changed(); fit(); renderSide(); flash('Neues Blatt. Rückgängig holt das alte zurück.');
    }
  });
  side.addEventListener('change', async (e) => {
    const el = e.target;
    if (el.type === 'file') {
      const f = el.files?.[0];
      if (!f) return;
      try { adopt(lageToDoc(JSON.parse(await f.text())), `„${f.name}“ geladen.`); } catch (err) { flash(err instanceof SyntaxError ? 'Die Datei ist kein JSON.' : err.message, true); }
      el.value = '';
      return;
    }
    const k = el.dataset.opt;
    if (!k) return;
    if (k === 'auto') autoTraverse = el.checked;
    else if (k === 'pside') placeSide = el.value;
    else if (k === 'ptype') placeType = el.value;
    else if (k === 'size') return;
    else {
      if (k === 'goal') doc.goal = el.value === 'keins' ? (doc.goal ? { ...doc.goal, type: 'keins' } : null) : { type: el.value, cells: doc.goal?.cells ?? [] };
      if (k === 'goal' && el.value !== 'keins' && el.value !== 'destroy' && !doc.goal.cells.length) { tool = 'goal'; renderSide(); flash('Jetzt die Zielfelder auf der Karte antippen.'); }
      if (k === 'limit') doc.limit = Math.max(1, Math.min(40, Math.round(Number(el.value) || 8)));
      if (k === 'maxLosses') doc.maxLosses = el.value === '' ? null : Math.max(0, Math.round(Number(el.value)));
      if (k === 'kind') doc.kind = el.value;
      if (k === 'enemy') doc.enemy = el.value;
      if (k === 'fa') doc.factions.a = el.value;
      if (k === 'fb') doc.factions.b = el.value;
      if (k === 'hour') doc.startHour = Number(el.value);
      if (k === 'weather') doc.weather = el.value;
      changed();
    }
  });
  side.addEventListener('input', (e) => {
    const k = e.target.dataset.opt;
    if (k === 'title' || k === 'author' || k === 'brief') { doc[k] = e.target.value; saveDraft(); if (k === 'title') rebuild(); }
  });

  renderSide();
  const ro = new ResizeObserver(() => resize());
  ro.observe(mapEl);
  resize();
  saveDraft();
}
