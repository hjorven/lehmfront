// Statische Ebene der Lagekarte (Plan 7.1): Papierblatt, Hoehenlinien, Signaturen, Graeben, Draht, Gleise, Gebaeude.
// Geometrie wird einmal pro Karte gebaut (Path2D in Feldkoordinaten); Thema und Kamera aendern nur das Zeichnen.
// Gezeichnet wird nur, wenn sich Karte, Thema, Kamera oder Groesse aendern (siehe createMapView).
import { TERRAIN, DIR, cellChains, cellAt } from '../map.js';
import { createRng } from '../rng.js';
import {
  hashSeed, simplifyCollinear, offsetPolyline, crenelPath, zigzagPath, samplesAlong, jitterPolyline, chaikin, cornerField, isolines,
} from './geometry.js';
import { applyCameraTransform, visibleRect } from './camera.js';

/** Blattrand um das Raster in Feldern: Platz fuer Titel, Koordinaten und Notizen. */
export const SHEET_MARGIN = 3;

export const FONTS = {
  head: '"Special Elite", "Courier New", monospace',
  num: '"IBM Plex Mono", monospace',
  ui: '"IBM Plex Sans", system-ui, sans-serif',
  hand: '"Caveat", cursive',
};

/** Weltbereich des Papierblatts (Karte plus Rand). */
export function sheetBounds(map) {
  const m = SHEET_MARGIN;
  return { x: -m, y: -m, w: map.width + 2 * m, h: map.height + 2 * m };
}

const center = (c) => [c[0] + 0.5, c[1] + 0.5];

function pathFrom(pts, closed = false) {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  if (closed) p.closePath();
  return p;
}
function addTo(path, pts) {
  pts.forEach((q, i) => (i ? path.lineTo(q[0], q[1]) : path.moveTo(q[0], q[1])));
}

/**
 * Bestimmt fuer einen Grabenzug, auf welcher Seite die Feuerrichtung liegt: Summe ueber alle Abschnitte,
 * gewichtet mit der Feuerrichtung des jeweiligen Feldes. 0 = keine Seite (dann keine Schuetzenauftritte).
 */
function facingSign(map, chain) {
  const pts = chain.cells;
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const f = DIR[cellAt(map, a[0], a[1]).trench.facing];
    const tx = b[0] - a[0], ty = b[1] - a[1];
    sum += -ty * f.dx + tx * f.dy; // Normale (-ty, tx)
  }
  // Laeuft der Zug ueberwiegend in Feuerrichtung (Sappe), gibt es keine Seite
  if (Math.abs(sum) * 2 < pts.length - 1) return 0;
  return sum > 0 ? 1 : -1;
}

/**
 * Baut alle Pfade der Karte. Reine Geometrie, unabhaengig von Farbe und Zoom.
 * Rueckgabe wird von drawMapLayer benutzt; jitter in Feldern.
 */
export function buildMapGeometry(map, { jitter = 0.045 } = {}) {
  const seed = map.sheet?.seed ?? hashSeed(map.id);
  const g = { seed, map };

  // Hoehenlinien aus den Hoehendaten
  const hField = cornerField(map.width, map.height, (x, y) => map.cells[y * map.width + x].height, 2);
  g.contours = [];
  const levels = [0.55, 1.35, 1.7, 2.05, 2.4, 2.75];
  levels.forEach((lv, li) => {
    const p = new Path2D();
    for (const line of isolines(hField, lv)) {
      if (line.pts.length < 4) continue;
      const smooth = chaikin(line.pts, 2, line.closed);
      const jl = jitterPolyline(smooth, jitter * 0.8, hashSeed(seed, 'h', li, line.pts.length), 0.6);
      if (line.closed) jl[jl.length - 1] = jl[0]; // Ring ohne Luecke schliessen
      addTo(p, jl);
    }
    g.contours.push({ level: lv, path: p, index: Number.isInteger(lv * 2) && lv >= 1 });
  });

  // Wasser: weiches Feld fuer die Flaeche, Uferlinie als Isolinie
  const isWater = (x, y) => (map.cells[y * map.width + x].terrain === 'wasser' ? 1 : 0);
  g.waterMask = [];
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (isWater(x, y)) g.waterMask.push([x, y]);
  const wField = cornerField(map.width, map.height, isWater, 1);
  g.shore = new Path2D();
  for (const line of isolines(wField, 0.5)) {
    const jl = jitterPolyline(chaikin(line.pts, 2, line.closed), jitter, hashSeed(seed, 'u'), 0.5);
    if (line.closed) jl[jl.length - 1] = jl[0];
    addTo(g.shore, jl);
  }

  // Signaturen je Feld
  g.forestFill = new Path2D();
  g.marsh = new Path2D();
  g.village = new Path2D();
  g.chalk = new Path2D();
  g.rock = new Path2D();
  for (const c of map.cells) {
    if (c.building) continue;
    const r = createRng(hashSeed(seed, 't', c.x, c.y));
    if (c.terrain === 'wald') {
      const n = 1 + (r() < 0.55 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const tx = c.x + 0.2 + r() * 0.6, ty = c.y + 0.2 + r() * 0.6, rad = 0.2 + r() * 0.13;
        g.forestFill.moveTo(tx + rad, ty);
        g.forestFill.arc(tx, ty, rad, 0, Math.PI * 2);
      }
    } else if (c.terrain === 'sumpf') {
      if (r() < 0.75) {
        const sx = c.x + 0.15 + r() * 0.3, sy = c.y + 0.35 + r() * 0.4;
        g.marsh.moveTo(sx, sy); g.marsh.lineTo(sx + 0.55, sy);
        g.marsh.moveTo(sx + 0.12, sy - 0.16); g.marsh.lineTo(sx + 0.4, sy - 0.16);
      }
    } else if (c.terrain === 'dorf') {
      const n = 1 + (r() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) g.village.rect(c.x + 0.1 + r() * 0.45, c.y + 0.1 + r() * 0.5, 0.36, 0.28);
    } else if (c.terrain === 'kreide') {
      for (let i = 0; i < 3; i++) {
        const dx = c.x + 0.15 + r() * 0.7, dy = c.y + 0.15 + r() * 0.7;
        g.chalk.moveTo(dx + 0.05, dy);
        g.chalk.arc(dx, dy, 0.05, 0, Math.PI * 2);
      }
    } else if (c.terrain === 'fels') {
      const fx = c.x + 0.25 + r() * 0.3, fy = c.y + 0.65 + r() * 0.15;
      g.rock.moveTo(fx, fy); g.rock.lineTo(fx + 0.2, fy - 0.35); g.rock.lineTo(fx + 0.42, fy);
    }
  }

  // Krater
  g.craterFill = new Path2D();
  g.craterRim = new Path2D();
  for (const c of map.cells) {
    if (!c.crater) continue;
    const r = createRng(hashSeed(seed, 'k', c.x, c.y));
    const rad = c.crater === 2 ? 0.48 + r() * 0.12 : 0.28 + r() * 0.1;
    const cx = c.x + 0.5 + (r() - 0.5) * (1 - rad * 1.6) * 0.8, cy = c.y + 0.5 + (r() - 0.5) * (1 - rad * 1.6) * 0.8;
    g.craterFill.moveTo(cx + rad, cy);
    g.craterFill.arc(cx, cy, rad, 0, Math.PI * 2);
    const a0 = 0.2 + r() * 0.4;
    g.craterRim.moveTo(cx + Math.cos(a0) * rad, cy + Math.sin(a0) * rad);
    g.craterRim.arc(cx, cy, rad, a0, a0 + 2.6 + r() * 0.6);
  }

  // Gleise mit Schwellen
  g.railLine = new Path2D();
  g.sleepers = new Path2D();
  for (const ch of cellChains(map, (c) => c.rail)) {
    const pts = simplifyCollinear(ch.cells.map(center));
    if (pts.length < 2) continue;
    addTo(g.railLine, pts);
    for (const s of samplesAlong(pts, 0.42, 0.2)) {
      g.sleepers.moveTo(s.x - s.nx * 0.22, s.y - s.ny * 0.22);
      g.sleepers.lineTo(s.x + s.nx * 0.22, s.y + s.ny * 0.22);
    }
  }

  // Draht: Grundlinie und Kreuze, je Seite
  g.wire = {};
  for (const side of ['own', 'enemy']) {
    const line = new Path2D(), cross = new Path2D();
    for (const ch of cellChains(map, (c) => c.wire?.side === side)) {
      const pts = simplifyCollinear(ch.cells.map(center));
      if (pts.length === 1) pts.push([pts[0][0], pts[0][1] + 0.01]);
      for (const o of [-0.16, 0.16]) addTo(line, jitterPolyline(offsetPolyline(pts, o), jitter * 0.7, hashSeed(seed, 'd', side, o, pts[0]), 0.5));
      for (const s of samplesAlong(pts, 0.55, 0.27)) {
        const tx = s.ny, ty = -s.nx; // Laufrichtung
        const a = 0.2;
        cross.moveTo(s.x - tx * a - s.nx * a, s.y - ty * a - s.ny * a); cross.lineTo(s.x + tx * a + s.nx * a, s.y + ty * a + s.ny * a);
        cross.moveTo(s.x - tx * a + s.nx * a, s.y - ty * a + s.ny * a); cross.lineTo(s.x + tx * a - s.nx * a, s.y + ty * a - s.ny * a);
      }
    }
    g.wire[side] = { line, cross };
  }

  // Graeben: Feuergraben als Rechteckwelle, Laufgraben als Zickzack, Stufe bestimmt die Strichstaerke
  g.trenches = [];
  for (const side of ['own', 'enemy']) {
    const chains = cellChains(map, (c) => c.trench?.side === side, (a, b) => {
      const kind = a.trench.kind === 'comm' || b.trench.kind === 'comm' ? 'comm' : 'fire';
      return kind + ':' + Math.min(a.trench.level, b.trench.level);
    });
    for (const ch of chains) {
      const [kind, lv] = ch.style.split(':');
      const level = Number(lv);
      const pts = simplifyCollinear(ch.cells.map(center));
      const s = hashSeed(seed, 'g', side, pts[0], pts.length);
      if (pts.length === 1) {
        g.trenches.push({ side, kind: 'hole', level, path: (() => { const p = new Path2D(); p.arc(pts[0][0], pts[0][1], 0.22, 0, Math.PI * 2); return p; })(), bays: [] });
        continue;
      }
      let line, bays = [];
      if (kind === 'fire') {
        const sign = facingSign(map, ch);
        const cr = crenelPath(pts, { amp: 0.6, len: 1.25, sign: sign || 1 });
        line = cr.path;
        bays = sign ? cr.bays : [];
      } else {
        line = zigzagPath(pts, { amp: 0.3, step: 1.0 });
      }
      g.trenches.push({ side, kind, level, path: pathFrom(jitterPolyline(line, jitter * 0.6, s, 0.35)), bays });
    }
  }

  // Fernsprechleitungen
  g.cables = new Path2D();
  for (const c of map.cables || []) addTo(g.cables, jitterPolyline(c.points, jitter * 0.6, hashSeed(seed, 'c', c.to), 0.8));

  g.sheet = buildSheet(map, seed);
  return g;
}

/** Das Papier: Knickfalten, Eselsohr und Kaffeerand haengen am Seed der Mission (Ueberraschung P02). */
function buildSheet(map, seed) {
  const b = sheetBounds(map);
  const r = createRng(hashSeed(seed, 'blatt'));
  const folds = [];
  const nv = 2 + (r() < 0.4 ? 1 : 0), nh = 1 + (r() < 0.35 ? 1 : 0);
  for (let i = 1; i <= nv; i++) {
    const x = b.x + (b.w * i) / (nv + 1) + (r() - 0.5) * 0.8;
    folds.push({ x0: x + (r() - 0.5) * 0.4, y0: b.y, x1: x + (r() - 0.5) * 0.4, y1: b.y + b.h, vertical: true });
  }
  for (let i = 1; i <= nh; i++) {
    const y = b.y + (b.h * i) / (nh + 1) + (r() - 0.5) * 0.8;
    folds.push({ x0: b.x, y0: y + (r() - 0.5) * 0.4, x1: b.x + b.w, y1: y + (r() - 0.5) * 0.4, vertical: false });
  }
  // Kaffeerand: meist in der Etappe oder am Rand, wo der Stab die Tasse abstellt
  const stains = [];
  const nStain = 1 + (r() < 0.45 ? 1 : 0);
  for (let i = 0; i < nStain; i++) {
    const cx = b.x + 3 + r() * (map.width * 0.33), cy = b.y + 4 + r() * (b.h - 8);
    const rad = 1.9 + r() * 0.7;
    const arcs = [];
    for (let k = 0; k < 3; k++) arcs.push({ dr: (r() - 0.5) * 0.18, a0: r() * Math.PI * 2, len: Math.PI * (1.1 + r() * 0.85), w: 0.05 + r() * 0.1 });
    stains.push({ cx, cy, rad, arcs, drip: r() < 0.6 ? { a: r() * Math.PI * 2, d: rad + 0.6 + r() * 0.8, rad: 0.18 + r() * 0.15 } : null });
  }
  // Eselsohr an einer Ecke
  const corner = Math.floor(r() * 4);
  const ear = 1.6 + r() * 0.9;
  return { bounds: b, folds, stains, corner, ear };
}

function sheetOutline(sh) {
  const { x, y, w, h } = sh.bounds, e = sh.ear;
  const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const c = sh.corner;
  const p = pts[c], prev = pts[(c + 3) % 4], next = pts[(c + 1) % 4];
  const toward = (a, b2) => { const d = Math.hypot(b2[0] - a[0], b2[1] - a[1]); return [a[0] + ((b2[0] - a[0]) / d) * e, a[1] + ((b2[1] - a[1]) / d) * e]; };
  const a = toward(p, prev), bb = toward(p, next);
  const out = [];
  for (let i = 0; i < 4; i++) {
    if (i === c) { out.push(a, bb); } else out.push(pts[i]);
  }
  // gefaltete Ecke: Dreieck nach innen gespiegelt
  const fold = [a, bb, [a[0] + bb[0] - p[0], a[1] + bb[1] - p[1]]];
  return { outline: out, fold };
}

function setFont(ctx, size, family, weight = '') {
  ctx.font = `${weight} ${size}px ${FONTS[family] || family}`.trim();
}

/** Text in Weltkoordinaten; size in Feldern. Unterhalb minPx wird nicht gezeichnet. */
function text(ctx, cam, str, x, y, { size = 0.5, family = 'num', color, alpha = 1, align = 'center', rotate = 0, weight = '', minPx = 6, baseline = 'middle', halo = null } = {}) {
  if (size * cam.zoom < minPx) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.translate(x, y);
  if (rotate) ctx.rotate((rotate * Math.PI) / 180);
  // Schrift in Pixelgroesse setzen und zurueckskalieren: Browser runden kleine Schriftgroessen sonst grob
  const k = cam.zoom;
  ctx.scale(1 / k, 1 / k);
  setFont(ctx, size * k, family, weight);
  if (halo) {
    // Papierhof hinter der Schrift, damit Notizen und Namen auf Linien lesbar bleiben
    ctx.strokeStyle = halo;
    ctx.lineWidth = Math.max(2, size * k * 0.28);
    ctx.lineJoin = 'round';
    ctx.globalAlpha *= 0.85;
    ctx.strokeText(str, 0, 0);
    ctx.globalAlpha /= 0.85;
  }
  ctx.fillText(str, 0, 0);
  ctx.restore();
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** Themenfarbe (#rrggbb) mit Deckkraft als rgba() fuer Verlaeufe. */
function rgba(hex, a) {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}

/** Wasserflaeche als weiche Lavierung: 1 Pixel je Feld, beim Hochskalieren geglaettet. */
function waterCanvas(geo, map, color) {
  if (geo._waterColor === color && geo._water) return geo._water;
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(map.width, map.height) : Object.assign(document.createElement('canvas'), { width: map.width, height: map.height });
  const c = cv.getContext('2d');
  c.fillStyle = color;
  for (const [x, y] of geo.waterMask) c.fillRect(x, y, 1, 1);
  geo._water = cv;
  geo._waterColor = color;
  return cv;
}

/**
 * Zeichnet die statische Ebene in ctx. cam aus camera.js, th aus theme.js, dpr = Geraetepixel je CSS-Pixel.
 */
export function drawMapLayer(ctx, geo, cam, th, dpr = 1) {
  const map = geo.map;
  const z = cam.zoom;
  const px = 1 / z; // ein CSS-Pixel in Feldern
  const W = map.width, H = map.height;

  // Tisch unter dem Blatt
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = th.desk;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  applyCameraTransform(ctx, cam, dpr);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const sh = geo.sheet;
  const { outline, fold } = sheetOutline(sh);

  // Schatten und Papier
  ctx.save();
  ctx.globalAlpha = th.shadeAlpha;
  ctx.fillStyle = th.shade;
  ctx.translate(0.25, 0.35);
  ctx.fill(pathFrom(outline, true));
  ctx.restore();
  ctx.fillStyle = th.paper;
  ctx.fill(pathFrom(outline, true));

  ctx.save();
  ctx.clip(pathFrom(outline, true));

  // Knickfalten: weiche Schattierung auf einer Seite, dunkle Kante, helle Kante
  for (const f of sh.folds) {
    const nx = f.vertical ? 1 : 0, ny = f.vertical ? 0 : 1;
    const grad = ctx.createLinearGradient(f.x0, f.y0, f.x0 + nx * 1.6, f.y0 + ny * 1.6);
    grad.addColorStop(0, rgba(th.shade, th.foldAlpha * 0.22));
    grad.addColorStop(1, rgba(th.shade, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.lineTo(f.x1 + nx * 1.6, f.y1 + ny * 1.6); ctx.lineTo(f.x0 + nx * 1.6, f.y0 + ny * 1.6);
    ctx.fill();
    ctx.globalAlpha = th.foldAlpha;
    ctx.strokeStyle = th.fold;
    ctx.lineWidth = 1 * px;
    ctx.beginPath(); ctx.moveTo(f.x0, f.y0); ctx.lineTo(f.x1, f.y1); ctx.stroke();
    ctx.strokeStyle = th.card;
    ctx.beginPath(); ctx.moveTo(f.x0 - nx * 1.2 * px, f.y0 - ny * 1.2 * px); ctx.lineTo(f.x1 - nx * 1.2 * px, f.y1 - ny * 1.2 * px); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Wasser
  const wc = waterCanvas(geo, map, th.water);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalAlpha = th.dark ? 0.55 : 0.4;
  ctx.drawImage(wc, 0, 0, W, H);
  ctx.restore();

  // Signaturen
  ctx.save();
  ctx.fillStyle = th.forest;
  ctx.strokeStyle = th.forest;
  ctx.globalAlpha = 0.5;
  ctx.fill(geo.forestFill);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = th.forestLine;
  ctx.lineWidth = clamp(0.03 * z, 0.8, 1.6) * px;
  ctx.stroke(geo.forestFill);
  ctx.strokeStyle = th.marsh;
  ctx.lineWidth = clamp(0.035 * z, 0.8, 1.8) * px;
  ctx.globalAlpha = 0.85;
  ctx.stroke(geo.marsh);
  ctx.fillStyle = th.chalk;
  ctx.fill(geo.chalk);
  ctx.strokeStyle = th.rock;
  ctx.lineWidth = clamp(0.03 * z, 0.8, 1.6) * px;
  ctx.stroke(geo.rock);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = th.village;
  ctx.fill(geo.village);
  ctx.restore();

  // Hoehenlinien
  ctx.save();
  ctx.strokeStyle = th.contour;
  for (const c of geo.contours) {
    ctx.globalAlpha = c.index ? 0.95 : 0.75;
    ctx.lineWidth = (c.index ? 1.4 : 1) * clamp(z / 30, 0.8, 1.6) * px;
    ctx.stroke(c.path);
  }
  ctx.restore();

  // Ufer
  ctx.strokeStyle = th.water;
  ctx.lineWidth = clamp(0.05 * z, 1.2, 2.4) * px;
  ctx.stroke(geo.shore);

  // Gleise
  ctx.strokeStyle = th.rail;
  ctx.lineWidth = clamp(0.07 * z, 1.5, 3) * px;
  ctx.stroke(geo.railLine);
  ctx.lineWidth = clamp(0.045 * z, 1, 2) * px;
  ctx.stroke(geo.sleepers);

  // Fernsprechleitungen
  ctx.save();
  ctx.strokeStyle = th.ink;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1 * px;
  ctx.setLineDash([2 * px, 4 * px]);
  ctx.stroke(geo.cables);
  ctx.restore();

  // Krater
  ctx.save();
  ctx.fillStyle = th.crater;
  ctx.globalAlpha = th.dark ? 0.75 : 0.55;
  ctx.fill(geo.craterFill);
  ctx.globalAlpha = 0.8;
  ctx.strokeStyle = th.ink;
  ctx.lineWidth = clamp(0.03 * z, 0.8, 1.5) * px;
  ctx.stroke(geo.craterRim);
  ctx.restore();

  // Draht
  for (const side of ['own', 'enemy']) {
    const w = geo.wire[side];
    ctx.strokeStyle = side === 'own' ? th.wire : th.enemy;
    ctx.lineWidth = clamp(0.03 * z, 0.8, 1.6) * px;
    ctx.stroke(w.line);
    ctx.stroke(w.cross);
  }

  // Graeben: aussen Farbe, innen Papier (Doppellinie wie mit Buntstift nachgezogen)
  const tw = clamp(0.22 * z, 3.5, 10);
  for (const t of geo.trenches) {
    const color = t.side === 'own' ? th.own : th.enemy;
    if (t.kind === 'hole') {
      ctx.fillStyle = color;
      ctx.fill(t.path);
      continue;
    }
    const outer = t.level === 1 ? tw * 0.5 : t.level === 4 ? tw * 1.5 : t.level === 3 ? tw * 1.3 : tw;
    ctx.strokeStyle = color;
    ctx.lineWidth = outer * px;
    ctx.stroke(t.path);
    if (t.level >= 2) {
      ctx.strokeStyle = th.paper;
      ctx.lineWidth = Math.max(1, outer * (t.level >= 3 ? 0.36 : 0.42)) * px;
      ctx.stroke(t.path);
    }
    if (t.level === 4) {
      // Betoniert: Fugen als kurze Querstriche in der Grabensohle
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, outer * 0.32) * px;
      ctx.setLineDash([0.08, 0.22]);
      ctx.stroke(t.path);
      ctx.restore();
    }
    // Schuetzenauftritte: kurze Striche zur Feuerrichtung, erst beim Hineinzoomen
    if (z >= 26 && t.bays.length) {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, outer * 0.3) * px;
      ctx.beginPath();
      const off = (outer / 2) * px;
      for (const b of t.bays) {
        ctx.moveTo(b.x + b.nx * off, b.y + b.ny * off);
        ctx.lineTo(b.x + b.nx * (off + 0.14), b.y + b.ny * (off + 0.14));
      }
      ctx.stroke();
    }
  }

  // Gebaeude
  for (const b of map.buildings) {
    if (b.type === 'unterstand') {
      ctx.fillStyle = b.side === 'enemy' ? th.enemy : th.own;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(b.x + 0.2, b.y + 0.22, 0.6, 0.56);
      ctx.globalAlpha = 1;
      continue;
    }
    const inset = 0.12;
    ctx.fillStyle = th.paper;
    ctx.fillRect(b.x + inset, b.y + inset, b.w - 2 * inset, b.h - 2 * inset);
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = clamp(0.06 * z, 1.2, 2.2) * px;
    ctx.strokeRect(b.x + inset, b.y + inset, b.w - 2 * inset, b.h - 2 * inset);
    text(ctx, cam, b.letter, b.x + b.w / 2, b.y + b.h / 2 + 0.02, { size: Math.min(0.62, b.h * 0.42), family: 'num', weight: '700', color: th.ink, minPx: 5 });
    text(ctx, cam, b.label, b.x + b.w / 2, b.y + b.h + 0.42, { size: 0.42, family: 'num', color: th.ink, alpha: 0.78, minPx: 6 });
  }

  // Beschriftungen
  for (const l of map.labels) {
    text(ctx, cam, l.text, l.x, l.y, { size: l.size || 0.5, family: l.font || 'num', color: th[l.color || 'ink'] || th.ink, alpha: l.alpha ?? 0.9, rotate: l.rotate || 0, minPx: 6.5, halo: th.paper });
  }

  // Bleistiftnotizen mit Pfeil
  for (let i = 0; i < map.notes.length; i++) drawNote(ctx, cam, geo, map.notes[i], th, i);

  // Kaffeerand
  for (const s of sh.stains) {
    ctx.save();
    ctx.strokeStyle = th.stain;
    ctx.fillStyle = th.stain;
    ctx.globalAlpha = th.stainAlpha * 0.25;
    ctx.beginPath();
    ctx.arc(s.cx, s.cy, s.rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = th.stainAlpha;
    for (const a of s.arcs) {
      ctx.lineWidth = a.w;
      ctx.beginPath();
      ctx.arc(s.cx, s.cy, s.rad + a.dr, a.a0, a.a0 + a.len);
      ctx.stroke();
    }
    if (s.drip) {
      ctx.globalAlpha = th.stainAlpha * 0.8;
      ctx.beginPath();
      ctx.arc(s.cx + Math.cos(s.drip.a) * s.drip.d, s.cy + Math.sin(s.drip.a) * s.drip.d, s.drip.rad, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawFrame(ctx, cam, map, th, px);
  ctx.restore(); // Clip

  // Eselsohr: umgeklappte Ecke liegt ueber dem Blatt
  ctx.save();
  ctx.fillStyle = th.card;
  ctx.strokeStyle = th.fold;
  ctx.lineWidth = 1 * px;
  const fp = pathFrom(fold, true);
  ctx.fill(fp);
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = th.shade;
  ctx.fill(fp);
  ctx.globalAlpha = 0.9;
  ctx.stroke(fp);
  ctx.restore();
}

function drawNote(ctx, cam, geo, n, th, i) {
  const size = n.size || 0.85;
  if (size * cam.zoom < 7) return;
  text(ctx, cam, n.text, n.x, n.y, { size, family: 'hand', color: th.pencil, rotate: n.rotate || 0, minPx: 7, halo: th.paper });
  if (!n.to) return;
  // Pfeil von der Notiz zum Ziel, leicht gebogen
  ctx.save();
  setFont(ctx, size * cam.zoom, 'hand');
  const half = ctx.measureText(n.text).width / cam.zoom / 2;
  const dx = n.to[0] - n.x, dy = n.to[1] - n.y;
  // Start an der Textkante, die dem Ziel zugewandt ist
  const sx = Math.abs(dx) > half ? n.x + Math.sign(dx) * (half + 0.2) : n.x, sy = Math.abs(dx) > half ? n.y : n.y + Math.sign(dy) * size * 0.6;
  const mx = (sx + n.to[0]) / 2 - (n.to[1] - sy) * 0.18, my = (sy + n.to[1]) / 2 + (n.to[0] - sx) * 0.18;
  const r = createRng(hashSeed(geo.seed, 'n', i));
  ctx.strokeStyle = th.pencil;
  ctx.lineWidth = clamp(0.035 * cam.zoom, 1, 1.8) / cam.zoom;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(mx + (r() - 0.5) * 0.3, my + (r() - 0.5) * 0.3, n.to[0], n.to[1]);
  const ang = Math.atan2(n.to[1] - my, n.to[0] - mx), hl = 0.35;
  ctx.moveTo(n.to[0], n.to[1]);
  ctx.lineTo(n.to[0] - Math.cos(ang - 0.45) * hl, n.to[1] - Math.sin(ang - 0.45) * hl);
  ctx.moveTo(n.to[0], n.to[1]);
  ctx.lineTo(n.to[0] - Math.cos(ang + 0.45) * hl, n.to[1] - Math.sin(ang + 0.45) * hl);
  ctx.stroke();
  ctx.restore();
}

/** Kartenrahmen mit Koordinaten (1-basiert wie cellLabel), Titel, Nordpfeil und Massstab. */
function drawFrame(ctx, cam, map, th, px) {
  const W = map.width, H = map.height;
  const z = cam.zoom;
  ctx.save();
  ctx.strokeStyle = th.frame;
  ctx.lineWidth = clamp(0.05 * z, 1, 2) * px;
  ctx.strokeRect(0, 0, W, H);
  ctx.lineWidth = 1 * px;
  ctx.strokeRect(-0.35, -0.35, W + 0.7, H + 0.7);
  // Teilstriche
  ctx.beginPath();
  for (let x = 0; x <= W; x++) {
    const l = x % 5 === 0 ? 0.35 : 0.15;
    ctx.moveTo(x, 0); ctx.lineTo(x, -l);
    ctx.moveTo(x, H); ctx.lineTo(x, H + l);
  }
  for (let y = 0; y <= H; y++) {
    const l = y % 5 === 0 ? 0.35 : 0.15;
    ctx.moveTo(0, y); ctx.lineTo(-l, y);
    ctx.moveTo(W, y); ctx.lineTo(W + l, y);
  }
  ctx.stroke();
  ctx.restore();
  // Spalten- und Zeilennummern in der Feldmitte, alle 5 Felder (bei grossem Zoom jedes Feld)
  const every = z >= 40 ? 1 : 5;
  const vr = visibleRect(cam);
  for (let x = 0; x < W; x++) {
    if ((x + 1) % every !== 0 && x !== 0) continue;
    if (x + 1 < vr.x || x > vr.x + vr.w) continue;
    text(ctx, cam, String(x + 1), x + 0.5, -0.85, { size: 0.42, color: th.frame, minPx: 6 });
    text(ctx, cam, String(x + 1), x + 0.5, H + 0.85, { size: 0.42, color: th.frame, minPx: 6 });
  }
  for (let y = 0; y < H; y++) {
    if ((y + 1) % every !== 0 && y !== 0) continue;
    text(ctx, cam, String(y + 1), -0.95, y + 0.5, { size: 0.42, color: th.frame, minPx: 6 });
    text(ctx, cam, String(y + 1), W + 0.95, y + 0.5, { size: 0.42, color: th.frame, minPx: 6 });
  }
  const s = map.sheet || {};
  text(ctx, cam, (s.title || map.name).toUpperCase(), 0, -2.05, { size: 0.85, family: 'head', color: th.ink, align: 'left', minPx: 6 });
  text(ctx, cam, [s.blatt, s.scale].filter(Boolean).join(' · '), W, -2.0, { size: 0.55, family: 'num', color: th.ink, align: 'right', alpha: 0.8, minPx: 6 });
  // Massstab 50 m = 5 Felder, Nordpfeil
  ctx.save();
  ctx.strokeStyle = th.ink;
  ctx.fillStyle = th.ink;
  ctx.lineWidth = clamp(0.06 * z, 1.2, 2.2) * px;
  const sx = W - 6, sy = H + 1.9;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + 5, sy);
  for (let i = 0; i <= 5; i++) { ctx.moveTo(sx + i, sy); ctx.lineTo(sx + i, sy - (i % 5 === 0 ? 0.3 : 0.15)); }
  ctx.stroke();
  ctx.fillRect(sx, sy - 0.08, 1, 0.16);
  ctx.fillRect(sx + 2, sy - 0.08, 1, 0.16);
  ctx.fillRect(sx + 4, sy - 0.08, 1, 0.16);
  ctx.restore();
  text(ctx, cam, '0', sx, sy + 0.55, { size: 0.4, color: th.ink, minPx: 6 });
  text(ctx, cam, '50 m', sx + 5, sy + 0.55, { size: 0.4, color: th.ink, minPx: 6 });
  const nx = W + 1.9, ny = -1.4;
  ctx.save();
  ctx.fillStyle = th.ink;
  ctx.beginPath(); ctx.moveTo(nx, ny - 0.9); ctx.lineTo(nx + 0.3, ny + 0.3); ctx.lineTo(nx, ny + 0.1); ctx.lineTo(nx - 0.3, ny + 0.3); ctx.closePath(); ctx.fill();
  ctx.restore();
  text(ctx, cam, 'N', nx, ny + 0.75, { size: 0.45, color: th.ink, weight: '700', minPx: 6 });
  text(ctx, cam, 'Eigene Linie blau · Feind rot · 1 Feld = 10 m', 0, H + 1.9, { size: 0.42, color: th.ink, align: 'left', alpha: 0.7, minPx: 6 });
}

/**
 * Zeichenauftrag fuer die statische Ebene: zeichnet hoechstens einmal pro Frame und nur nach invalidate().
 */
export function createMapLayer(canvas, map, { getCamera, getTheme }) {
  let geo = buildMapGeometry(map);
  let pending = 0;
  let dpr = 1;
  const ctx = canvas.getContext('2d');
  const layer = {
    get geometry() { return geo; },
    /** Karte hat sich geaendert (z. B. neuer Graben): Geometrie neu bauen. */
    setMap(m) { map = m; geo = buildMapGeometry(map); layer.invalidate(); },
    resize(w, h, ratio) {
      dpr = ratio;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      layer.invalidate();
    },
    invalidate() {
      if (pending) return;
      pending = requestAnimationFrame(() => { pending = 0; layer.drawNow(); });
    },
    drawNow() {
      const t0 = performance.now();
      drawMapLayer(ctx, geo, getCamera(), getTheme(), dpr);
      layer.lastDrawMs = performance.now() - t0;
    },
    lastDrawMs: 0,
  };
  return layer;
}
