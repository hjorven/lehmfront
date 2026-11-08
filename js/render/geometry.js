// Geometrie fuer die Lagekarte, ohne DOM: Linienzuege, Rechteckwelle, Zickzack, Hoehenlinien, Bleistiftzittern.
// Alle Koordinaten in Feldern (Weltkoordinaten). Nur Optik, aber deterministisch (Seed-Zufall aus rng.js).
import { createRng } from '../rng.js';

/** Ganzzahliger Hash fuer Seeds aus Koordinaten und Text. */
export function hashSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
    h = Math.imul(h ^ 0x2c, 0x01000193);
  }
  return h >>> 0;
}

/** Laenge eines Linienzugs. */
export function polyLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** Entfernt Zwischenpunkte auf geraden Strecken. */
export function simplifyCollinear(pts) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1], b = pts[i], c = pts[i + 1];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out.map((p) => [p[0], p[1]]);
}

/**
 * Punkt und Normale bei Bogenlaenge s. Normale ist (-ty, tx), also bei Laufrichtung Sued
 * nach Westen und bei Laufrichtung Ost nach Sueden (y waechst nach unten).
 */
export function pointAt(pts, s) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d === 0) continue;
    if (s <= acc + d || i === pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / d));
      const tx = (b[0] - a[0]) / d, ty = (b[1] - a[1]) / d;
      return { x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, nx: -ty, ny: tx, seg: i };
    }
    acc += d;
  }
  const p = pts[pts.length - 1];
  return { x: p[0], y: p[1], nx: 0, ny: 0, seg: pts.length - 1 };
}

/** Bogenlaengen der Ecken eines Linienzugs. */
function vertexArcs(pts) {
  const out = [0];
  for (let i = 1; i < pts.length; i++) out.push(out[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return out;
}

/** Versetzter Abschnitt eines Linienzugs zwischen Bogenlaenge s0 und s1, Ecken eingeschlossen. */
function offsetSpan(pts, arcs, s0, s1, off) {
  const out = [];
  const p0 = pointAt(pts, s0);
  out.push([p0.x + p0.nx * off, p0.y + p0.ny * off]);
  for (let i = 1; i < pts.length - 1; i++) {
    if (arcs[i] > s0 + 1e-9 && arcs[i] < s1 - 1e-9) {
      // Eckennormale als Mittel der beiden Segmentnormalen
      const a = pointAt(pts, arcs[i] - 1e-6), b = pointAt(pts, arcs[i] + 1e-6);
      let nx = a.nx + b.nx, ny = a.ny + b.ny;
      const l = Math.hypot(nx, ny) || 1;
      nx /= l; ny /= l;
      out.push([pts[i][0] + nx * off, pts[i][1] + ny * off]);
    }
  }
  const p1 = pointAt(pts, s1);
  out.push([p1.x + p1.nx * off, p1.y + p1.ny * off]);
  return out;
}

/**
 * Feuergraben als Rechteckwelle (Traversen). amp = Gesamthub, len = Laenge eines Abschnitts.
 * sign = +1 legt die vorderen Buchten auf die Seite der Normale (-ty, tx), -1 auf die andere.
 * Rueckgabe: { path: [[x,y]...], bays: [{x,y,nx,ny}] } bays = Mitte jeder vorderen Bucht (fuer Schuetzenauftritte).
 */
export function crenelPath(pts, { amp = 0.5, len = 1, sign = 1 } = {}) {
  const L = polyLength(pts);
  if (L === 0) return { path: pts.map((p) => [p[0], p[1]]), bays: [] };
  const arcs = vertexArcs(pts);
  const n = Math.max(1, Math.round(L / len));
  const step = L / n;
  // Anfang und Ende liegen auf der Mittellinie, damit anschliessende Zuege an Kreuzungen verbunden sind
  const path = [[pts[0][0], pts[0][1]]];
  const bays = [];
  for (let i = 0; i < n; i++) {
    const front = i % 2 === 0;
    const off = (front ? amp / 2 : -amp / 2) * sign;
    const span = offsetSpan(pts, arcs, i * step, (i + 1) * step, off);
    for (const p of span) path.push(p);
    if (front) {
      const m = pointAt(pts, (i + 0.5) * step);
      bays.push({ x: m.x + m.nx * off, y: m.y + m.ny * off, nx: m.nx * sign, ny: m.ny * sign });
    }
  }
  const e = pts[pts.length - 1];
  path.push([e[0], e[1]]);
  return { path, bays };
}

/** Laufgraben als Zickzack um den Linienzug. */
export function zigzagPath(pts, { amp = 0.3, step = 0.7 } = {}) {
  const L = polyLength(pts);
  if (L === 0) return pts.map((p) => [p[0], p[1]]);
  const n = Math.max(2, Math.round(L / step));
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < n; i++) {
    const p = pointAt(pts, (i * L) / n);
    const o = i % 2 ? amp : -amp;
    out.push([p.x + p.nx * o, p.y + p.ny * o]);
  }
  const e = pts[pts.length - 1];
  out.push([e[0], e[1]]);
  return out;
}

/** Gleichmaessige Punkte entlang des Linienzugs (fuer Schwellen, Drahtkreuze). */
export function samplesAlong(pts, spacing, offset = spacing / 2) {
  const L = polyLength(pts);
  const out = [];
  for (let s = offset; s <= L + 1e-9; s += spacing) out.push(pointAt(pts, Math.min(s, L)));
  return out;
}

/** Parallele zum Linienzug im Abstand off (positiv in Richtung der Normale (-ty, tx)). */
export function offsetPolyline(pts, off) {
  if (pts.length < 2) return pts.map((p) => [p[0] + off, p[1]]);
  return pts.map((p, i) => {
    let nx = 0, ny = 0;
    for (const [a, b] of [[pts[i - 1], p], [p, pts[i + 1]]]) {
      if (!a || !b) continue;
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      nx += -(b[1] - a[1]) / d; ny += (b[0] - a[0]) / d;
    }
    const l = Math.hypot(nx, ny) || 1;
    return [p[0] + (nx / l) * off, p[1] + (ny / l) * off];
  });
}

/** Bleistiftzittern: unterteilt und verschiebt Punkte leicht, deterministisch. */
export function jitterPolyline(pts, amp, seed, segLen = 0.4) {
  if (!amp || pts.length < 2) return pts.map((p) => [p[0], p[1]]);
  const r = createRng(seed);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / segLen));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t + (r() - 0.5) * amp, a[1] + (b[1] - a[1]) * t + (r() - 0.5) * amp]);
    }
  }
  const e = pts[pts.length - 1];
  out.push([e[0] + (r() - 0.5) * amp * 0.5, e[1] + (r() - 0.5) * amp * 0.5]);
  return out;
}

/** Chaikin-Glaettung, closed fuer Ringe. */
export function chaikin(pts, iterations = 2, closed = false) {
  let p = pts;
  for (let it = 0; it < iterations; it++) {
    if (p.length < 3) return p;
    const out = closed ? [] : [p[0]];
    const n = closed ? p.length - 1 : p.length - 1;
    for (let i = 0; i < n; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (closed) out.push(out[0]);
    else out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

/**
 * Skalarfeld an den Feldecken: Mittel der (bis zu vier) angrenzenden Felder, dann geglaettet.
 * value(x, y) liefert den Wert eines Feldes. Rueckgabe { w, h, v } mit w = width + 1 Ecken.
 */
export function cornerField(width, height, value, blurPasses = 2) {
  const w = width + 1, h = height + 1;
  let v = new Float64Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      let s = 0, n = 0;
      for (const [x, y] of [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]]) {
        if (x >= 0 && y >= 0 && x < width && y < height) { s += value(x, y); n++; }
      }
      v[j * w + i] = n ? s / n : 0;
    }
  }
  for (let p = 0; p < blurPasses; p++) {
    const o = new Float64Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        let s = 0, n = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const x = Math.max(0, Math.min(w - 1, i + di)), y = Math.max(0, Math.min(h - 1, j + dj));
          const wgt = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
          s += v[y * w + x] * wgt; n += wgt;
        }
        o[j * w + i] = s / n;
      }
    }
    v = o;
  }
  return { w, h, v };
}

/**
 * Hoehenlinien per Marching Squares. Gibt verbundene Linienzuege zurueck: [{ pts, closed }].
 * Koordinaten: Ecke (i, j) liegt bei Welt (i, j).
 */
export function isolines(field, level) {
  const { w, h, v } = field;
  const at = (i, j) => v[j * w + i];
  const segs = [];
  const interp = (i0, j0, i1, j1) => {
    const a = at(i0, j0), b = at(i1, j1);
    const t = a === b ? 0.5 : (level - a) / (b - a);
    return [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t];
  };
  for (let j = 0; j < h - 1; j++) {
    for (let i = 0; i < w - 1; i++) {
      const tl = at(i, j) >= level, tr = at(i + 1, j) >= level, br = at(i + 1, j + 1) >= level, bl = at(i, j + 1) >= level;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const T = () => interp(i, j, i + 1, j), R = () => interp(i + 1, j, i + 1, j + 1);
      const B = () => interp(i, j + 1, i + 1, j + 1), Lf = () => interp(i, j, i, j + 1);
      const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= level;
      switch (code) {
        case 1: case 14: segs.push([Lf(), B()]); break;
        case 2: case 13: segs.push([B(), R()]); break;
        case 3: case 12: segs.push([Lf(), R()]); break;
        case 4: case 11: segs.push([T(), R()]); break;
        case 6: case 9: segs.push([T(), B()]); break;
        case 7: case 8: segs.push([Lf(), T()]); break;
        case 5: if (centre) { segs.push([Lf(), T()]); segs.push([B(), R()]); } else { segs.push([Lf(), B()]); segs.push([T(), R()]); } break;
        case 10: if (centre) { segs.push([T(), R()]); segs.push([Lf(), B()]); } else { segs.push([Lf(), T()]); segs.push([B(), R()]); } break;
      }
    }
  }
  return joinSegments(segs);
}

/** Verbindet Segmente mit gemeinsamen Endpunkten zu Linienzuegen. */
export function joinSegments(segs) {
  const key = (p) => Math.round(p[0] * 1e6) + ':' + Math.round(p[1] * 1e6);
  const ends = new Map();
  segs.forEach((s, idx) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(idx);
    }
  });
  const used = new Uint8Array(segs.length);
  const other = (k, idx) => (ends.get(k) || []).find((j) => j !== idx && !used[j]);
  const lines = [];
  for (let s = 0; s < segs.length; s++) {
    if (used[s]) continue;
    used[s] = 1;
    const pts = [segs[s][0], segs[s][1]];
    // vorwaerts
    for (;;) {
      const k = key(pts[pts.length - 1]);
      const j = other(k, -1);
      if (j === undefined) break;
      used[j] = 1;
      const seg = segs[j];
      pts.push(key(seg[0]) === k ? seg[1] : seg[0]);
    }
    // rueckwaerts
    for (;;) {
      const k = key(pts[0]);
      const j = other(k, -1);
      if (j === undefined) break;
      used[j] = 1;
      const seg = segs[j];
      pts.unshift(key(seg[0]) === k ? seg[1] : seg[0]);
    }
    const closed = pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1]);
    lines.push({ pts, closed });
  }
  return lines;
}
