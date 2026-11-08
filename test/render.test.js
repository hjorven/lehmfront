import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY, NIGHT, CSS_KEYS, lerpTheme, themeAt, contrast, mix, CROSSOVER, LATE_FROM, LATE_TO, applyTheme, onThemeChange } from '../js/theme.js';
import {
  createCamera, clampCamera, resizeCamera, worldToScreen, screenToWorld, screenToCell, panBy, zoomAt, fitZoom, visibleRect,
} from '../js/render/camera.js';
import { crenelPath, zigzagPath, polyLength, simplifyCollinear, cornerField, isolines, jitterPolyline, chaikin, hashSeed, offsetPolyline } from '../js/render/geometry.js';

// ---------- Thema (Plan 7.7) ----------

test('Tag und Nacht haben dieselben Schluessel, alle CSS-Schluessel vorhanden', () => {
  assert.deepEqual(Object.keys(DAY).sort(), Object.keys(NIGHT).sort());
  for (const k of CSS_KEYS) assert.ok(k in DAY, k);
});

test('lerpTheme: Endpunkte sind Tag und Nacht', () => {
  const d = lerpTheme(DAY, NIGHT, 0), n = lerpTheme(DAY, NIGHT, 1);
  for (const k of Object.keys(DAY)) {
    assert.equal(d[k], DAY[k], 'Tag ' + k);
    assert.equal(n[k], NIGHT[k], 'Nacht ' + k);
  }
  assert.equal(d.dark, false);
  assert.equal(n.dark, true);
  assert.equal(themeAt(-3).darkness, 0);
  assert.equal(themeAt(7).darkness, 1);
});

test('Tinte springt spaet: bei 0,4 noch Tagtinte, bei 0,75 Nachttinte, Spruenge im Planfenster', () => {
  assert.equal(themeAt(0.4).ink, DAY.ink);
  assert.equal(themeAt(0.75).ink, NIGHT.ink);
  for (const [k, t] of Object.entries(CROSSOVER)) assert.ok(t >= LATE_FROM && t <= LATE_TO, k + ' springt bei ' + t);
});

test('Daemmerungsschimmer: Papier in der Mitte waermer als die lineare Mischung', () => {
  const plain = mix(DAY.paper, NIGHT.paper, 0.5);
  const warm = themeAt(0.5).paper;
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [pr, , pb] = rgb(plain), [wr, , wb] = rgb(warm);
  assert.ok(wr - wb > pr - pb, 'mehr Rot als Blau');
});

test('Kontrast Tinte auf Papier und Kaertchen bleibt im ganzen Uebergang ueber 3 : 1', () => {
  for (let i = 0; i <= 200; i++) {
    const th = themeAt(i / 200);
    assert.ok(contrast(th.ink, th.paper) >= 3, `Papier bei ${i / 200}: ${contrast(th.ink, th.paper).toFixed(2)}`);
    assert.ok(contrast(th.ink, th.card) >= 3, `Kaertchen bei ${i / 200}: ${contrast(th.ink, th.card).toFixed(2)}`);
  }
  // Schrift auf Kaertchen springt mit dem Kaertchen
  for (let i = 0; i <= 200; i++) {
    const th = themeAt(i / 200);
    assert.ok(contrast(th.ink2, th.card) >= 3, `ink2 bei ${i / 200}`);
  }
  // Am Tag und in der Nacht: volle Lesbarkeit
  for (const th of [DAY, NIGHT]) {
    assert.ok(contrast(th.ink, th.card) >= 7);
    assert.ok(contrast(th.ink2, th.card) >= 4.5);
  }
});

test('Signaturen bleiben ausserhalb der Uebergangsmitte erkennbar, Tag und Nacht klar', () => {
  const keys = ['pencil', 'frame', 'forestLine', 'marsh', 'rock', 'own', 'enemy', 'wire', 'rail', 'village'];
  for (let i = 0; i <= 100; i++) {
    const t = i / 100;
    if (t > 0.35 && t < 0.8) continue;
    const th = themeAt(t);
    for (const k of keys) assert.ok(contrast(th[k], th.paper) >= 1.9, `${k} bei ${t}: ${contrast(th[k], th.paper).toFixed(2)}`);
  }
  for (const th of [DAY, NIGHT]) for (const k of keys) assert.ok(contrast(th[k], th.paper) >= 3, k);
});

test('applyTheme ohne DOM ruft Renderer auf', () => {
  let got = null;
  const off = onThemeChange((t) => { got = t; });
  applyTheme(themeAt(0.3), null);
  off();
  assert.equal(got.darkness, 0.3);
});

// ---------- Kamera ----------

const bounds = { x: -3, y: -3, w: 66, h: 46 };

test('Kamera: Bildschirm -> Welt -> Bildschirm ist verlustfrei', () => {
  const cam = createCamera({ bounds, viewW: 800, viewH: 600 });
  zoomAt(cam, 3, 100, 100);
  for (const [sx, sy] of [[0, 0], [400, 300], [799, 12]]) {
    const w = screenToWorld(cam, sx, sy);
    const s = worldToScreen(cam, w.x, w.y);
    assert.ok(Math.abs(s.x - sx) < 1e-9 && Math.abs(s.y - sy) < 1e-9);
  }
});

test('Kamera: Zoom haelt den Punkt unter dem Zeiger fest', () => {
  const cam = createCamera({ bounds, viewW: 800, viewH: 600 });
  zoomAt(cam, 2, 400, 300);
  const before = screenToWorld(cam, 250, 410);
  zoomAt(cam, 1.5, 250, 410);
  const after = screenToWorld(cam, 250, 410);
  assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
});

test('Kamera: Grenzen beim Verschieben und Zoomen', () => {
  const cam = createCamera({ bounds, viewW: 800, viewH: 600, maxZoom: 100 });
  zoomAt(cam, 0.01, 400, 300);
  assert.equal(cam.zoom, fitZoom(cam), 'nicht kleiner als ganzes Blatt');
  zoomAt(cam, 1000, 400, 300);
  assert.equal(cam.zoom, 100, 'nicht groesser als maxZoom');
  panBy(cam, 1e6, 1e6);
  const r = visibleRect(cam);
  assert.ok(Math.abs(r.x - bounds.x) < 1e-9 && Math.abs(r.y - bounds.y) < 1e-9, 'oben links am Blattrand');
  panBy(cam, -1e7, -1e7);
  const r2 = visibleRect(cam);
  assert.ok(Math.abs(r2.x + r2.w - (bounds.x + bounds.w)) < 1e-9);
});

test('Kamera: kleiner Bildschirm zentriert, Groessenwechsel bleibt in Grenzen', () => {
  const cam = createCamera({ bounds, viewW: 390, viewH: 844 });
  clampCamera(cam);
  assert.equal(cam.x, bounds.x + bounds.w / 2);
  resizeCamera(cam, 1280, 800);
  const r = visibleRect(cam);
  assert.ok(r.x >= bounds.x - 1e-9 || r.w >= bounds.w);
});

test('Kamera: Feld unter dem Zeiger', () => {
  const cam = createCamera({ bounds, viewW: 660, viewH: 460 }); // genau 10 px je Feld
  assert.equal(cam.zoom, 10);
  assert.deepEqual(screenToCell(cam, 35, 35), { x: 0, y: 0 });
  assert.deepEqual(screenToCell(cam, 29, 35), { x: -1, y: 0 });
  assert.deepEqual(screenToCell(cam, 30 + 315, 30 + 85), { x: 31, y: 8 });
});

// ---------- Geometrie ----------

test('Rechteckwelle bleibt in der Naehe der Linie und hat Buchten zur Feuerrichtung', () => {
  const pts = [[0.5, 0.5], [0.5, 10.5]];
  const { path, bays } = crenelPath(pts, { amp: 0.6, len: 1, sign: 1 });
  for (const p of path) assert.ok(Math.abs(p[0] - 0.5) <= 0.3 + 1e-9);
  assert.equal(bays.length, 5);
  // Laufrichtung Sued, Normale (-ty, tx) = Westen (-x)
  for (const b of bays) assert.ok(b.x < 0.5 && b.nx < 0);
  const flipped = crenelPath(pts, { amp: 0.6, len: 1, sign: -1 });
  for (const b of flipped.bays) assert.ok(b.x > 0.5 && b.nx > 0);
});

test('Zickzack beginnt und endet auf der Linie', () => {
  const z = zigzagPath([[0, 0], [5, 0]], { amp: 0.3, step: 1 });
  assert.deepEqual(z[0], [0, 0]);
  assert.deepEqual(z[z.length - 1], [5, 0]);
  assert.ok(z.some((p) => p[1] > 0) && z.some((p) => p[1] < 0));
});

test('Hilfen: Laenge, Geradenvereinfachung, Parallele', () => {
  assert.equal(polyLength([[0, 0], [3, 4]]), 5);
  assert.deepEqual(simplifyCollinear([[0, 0], [1, 0], [2, 0], [2, 1]]), [[0, 0], [2, 0], [2, 1]]);
  assert.deepEqual(offsetPolyline([[0, 0], [0, 2]], 0.5), [[-0.5, 0], [-0.5, 2]]);
});

test('Hoehenlinie um einen Huegel ist geschlossen und umschliesst die Kuppe', () => {
  const vals = [
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 3, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
  ];
  const f = cornerField(5, 5, (x, y) => vals[y][x], 0);
  const lines = isolines(f, 0.5);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].closed, true);
  const xs = lines[0].pts.map((p) => p[0]);
  assert.ok(Math.min(...xs) < 2.5 && Math.max(...xs) > 2.5);
});

test('Bleistiftzittern ist deterministisch und klein', () => {
  const a = jitterPolyline([[0, 0], [4, 0]], 0.1, 7);
  const b = jitterPolyline([[0, 0], [4, 0]], 0.1, 7);
  assert.deepEqual(a, b);
  for (const p of a) assert.ok(Math.abs(p[1]) <= 0.05 + 1e-9);
  assert.notDeepEqual(a, jitterPolyline([[0, 0], [4, 0]], 0.1, 8));
  assert.equal(hashSeed('asse', 1), hashSeed('asse', 1));
  assert.notEqual(hashSeed('asse', 1), hashSeed('asse', 2));
  assert.ok(chaikin([[0, 0], [1, 0], [1, 1]], 1).length > 3);
});
