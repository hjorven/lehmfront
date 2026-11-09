// Erzeugt data/maps/huegel214.json, die Karte fuer Akt 2 "Lehm und Regen" (60 x 40, P23).
// Aufruf: node tools/maps/huegel214.mjs
// Asse-Nord im Herbst: Huegel 214 als Kreidekuppe im Niemandsland, leicht auf Morrows Seite, davor die Lange
// Wiese mit dem umgestuerzten Heuwagen, hinter der eigenen Linie die Ruine der Velder Muehle und eine Senke,
// in der die Graeben bei Regen vollaufen. Das Werkzeug darf Math.sin benutzen; das Spiel liest nur das JSON.
import { pathToFileURL } from 'node:url';
import { createRng } from '../../js/rng.js';
import { lineCells, loadMap } from '../../js/map.js';
import { writeMapJson } from './write.mjs';

const W = 60, H = 40;

/** Wichtige Felder fuer Szenarien und Missionsziele (0-basiert) */
export const SPOTS = {
  heuwagen: { x: 35, y: 21 },
  kuppe: { x: 44, y: 18 },
  muehle: { x: 21, y: 8 },
  senke: { x: 27, y: 30 },
};

export function buildHuegel214() {
  const rng = createRng(1914);
  const grid = (v) => Array.from({ length: H }, () => Array.from({ length: W }, () => v));
  const terrain = grid('.');
  const zones = grid('N');
  const hf = grid(1);
  const riverX = (y) => 1.4 + 0.7 * Math.sin(y * 0.29 + 0.6) + 0.3 * Math.sin(y * 1.1);

  const hills = [
    { cx: 44, cy: 18, rx: 8, ry: 6.5, peak: 2.6 },    // Huegel 214
    { cx: 12, cy: 6, rx: 5, ry: 3.5, peak: 1.2 },     // Ruecken hinter der Etappe
    { cx: 53, cy: 33, rx: 5, ry: 4, peak: 1.0 },      // Ausläufer bei Raudas
  ];
  const dips = [
    { cx: 27, cy: 30, rx: 5, ry: 4.5, depth: 1.3 },   // Senke: hier laufen die Graeben voll
    { cx: 36, cy: 34, rx: 3, ry: 3, depth: 0.9 },
  ];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let h = 1;
    for (const k of hills) { const d = ((x - k.cx) / k.rx) ** 2 + ((y - k.cy) / k.ry) ** 2; if (d < 1) h += k.peak * (1 - d); }
    for (const k of dips) { const d = ((x - k.cx) / k.rx) ** 2 + ((y - k.cy) / k.ry) ** 2; if (d < 1) h -= k.depth * (1 - d); }
    const rx = riverX(y);
    if (x < rx + 4) h = Math.min(h, (x - rx) / 4 + 0.2);
    hf[y][x] = Math.max(0, Math.min(3, Math.round(h)));
  }
  const blob = (cx, cy, rx, ry, code, rough = 0.25) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1 - rough + rng() * rough * 2) terrain[y][x] = code;
    }
  };
  blob(7, 33, 5, 4, 'w');          // Erlenbruch an der Asse
  blob(55, 6, 4.5, 3.5, 'w');      // Wald hinter Morrows Linie
  blob(37.5, 4.5, 1.5, 1.2, 'w', 0.4); // Baumstuempfe im Niemandsland
  blob(27, 31, 2.6, 2.2, 's');     // Sumpf in der Senke
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hf[y][x] >= 2 && Math.abs(x - 44) <= 8 && Math.abs(y - 18) <= 7) terrain[y][x] = 'k';
  // Velder Muehle: Ruine in der eigenen Stellung
  for (let y = 7; y <= 9; y++) for (let x = 20; x <= 22; x++) if ((x + y) % 2 === 0 || rng() < 0.4) terrain[y][x] = 'd';
  // Raudas am Ostrand
  for (let y = 30; y <= 36; y++) for (let x = 55; x <= 58; x++) if ((x + 2 * y) % 3 !== 0) terrain[y][x] = 'd';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x <= riverX(y)) { terrain[y][x] = '~'; hf[y][x] = 0; }

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wob = Math.round(Math.sin(y * 0.37) * 0.7);
    zones[y][x] = x <= 17 + wob ? 'E' : x <= 30 ? 'S' : x <= 39 ? 'N' : x <= 50 - wob ? 's' : 'e';
  }

  const trenches = new Map();
  const key = (x, y) => x + ',' + y;
  function trenchLine(pts, o) {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
        const k = key(x, y);
        const old = trenches.get(k);
        if (old && (old.kind === 'fire' && o.kind === 'comm')) continue;
        if (old && old.kind === o.kind && old.level >= o.level) continue;
        trenches.set(k, { x, y, ...o });
      }
    }
  }
  const own = { side: 'own', facing: 'E' }, foe = { side: 'enemy', facing: 'W' };
  // Eigene vordere Linie: zickzack, in der Senke ein Bogen nach hinten
  trenchLine([[29, 2], [29, 8], [30, 10], [30, 18], [29, 20], [29, 26], [28, 28], [28, 33], [29, 35], [29, 38]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[24, 3], [24, 37]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[24, 6], [29, 6]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 15], [30, 15]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 23], [29, 23]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 32], [28, 32]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[18, 15], [24, 15]], { ...own, kind: 'comm', level: 1 });
  trenchLine([[18, 26], [24, 26]], { ...own, kind: 'comm', level: 1 });
  // Morrows Linien: vordere am Hangfuss, zweite ueber die Kuppe, Laufgraeben
  trenchLine([[41, 1], [41, 10], [40, 12], [40, 24], [41, 26], [41, 38]], { ...foe, kind: 'fire', level: 2 });
  trenchLine([[46, 2], [46, 12], [45, 14], [45, 22], [46, 24], [46, 37]], { ...foe, kind: 'fire', level: 3 });
  trenchLine([[41, 8], [46, 8]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[40, 18], [45, 18]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[41, 30], [46, 30]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[46, 18], [52, 18]], { ...foe, kind: 'comm', level: 1 });

  const wire = [];
  for (let y = 2; y <= 37; y++) if (y !== 20 && y !== 21 && y !== 9) wire.push({ x: 32, y, side: 'own' });
  for (let y = 1; y <= 38; y++) if (y !== 27) wire.push({ x: 38, y, side: 'enemy' });

  const rails = new Map();
  const railLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) rails.set(key(x, y), [x, y]); };
  // Gleis zwei Felder unter Depot und Bahnhof (wie auf der Asse-Karte, passt zur Etappe)
  railLine([[5, 18], [15, 18]]);
  railLine([[15, 18], [17, 16], [20, 16]]);
  railLine([[15, 18], [18, 21], [18, 24]]);

  const buildings = [
    { id: 'depot', type: 'depot', x: 5, y: 15, w: 3, h: 2, letter: 'D', label: 'Depot' },
    { id: 'bahnhof', type: 'bahnhof', x: 10, y: 15, w: 3, h: 2, letter: 'B', label: 'Feldbahnhof' },
    { id: 'kueche', type: 'kueche', x: 5, y: 12, w: 2, h: 2, letter: 'K', label: 'Feldküche' },
    { id: 'ruhelager', type: 'ruhelager', x: 9, y: 12, w: 3, h: 2, letter: 'R', label: 'Ruhelager' },
    { id: 'lazarett', type: 'lazarett', x: 5, y: 24, w: 3, h: 2, letter: 'L', label: 'Lazarett' },
    { id: 'fernmelde', type: 'fernmelde', x: 14, y: 11, w: 2, h: 2, letter: 'F', label: 'Fernmelde' },
    { id: 'batterie1', type: 'batterie', x: 11, y: 28, w: 2, h: 2, letter: 'A1', label: 'Batterie 1' },
    { id: 'batterie2', type: 'batterie', x: 14, y: 33, w: 2, h: 2, letter: 'A2', label: 'Batterie 2' },
    { id: 'unterstand1', type: 'unterstand', x: 26, y: 10, letter: '', label: '' },
    { id: 'unterstand2', type: 'unterstand', x: 26, y: 20, letter: '', label: '' },
    { id: 'unterstand3', type: 'unterstand', x: 26, y: 35, letter: '', label: '' },
  ];
  for (const b of buildings) {
    for (let y = b.y; y < b.y + (b.h || 1); y++) for (let x = b.x; x < b.x + (b.w || 1); x++) {
      if (terrain[y][x] === '~' || trenches.has(key(x, y)) || rails.has(key(x, y))) throw new Error('Gebaeude ' + b.id + ' liegt auf Wasser, Graben oder Gleis');
      terrain[y][x] = '.';
    }
  }

  const craters = [];
  const craterSet = new Set();
  const addCrater = (x, y, size) => {
    const k = key(x, y);
    if (craterSet.has(k) || trenches.has(k) || terrain[y][x] === '~' || terrain[y][x] === 'd') return;
    if (x === SPOTS.heuwagen.x && y === SPOTS.heuwagen.y) return;
    craterSet.add(k);
    craters.push({ x, y, size });
  };
  for (let i = 0; i < 80; i++) addCrater(33 + Math.floor(rng() * 5), 1 + Math.floor(rng() * 38), rng() < 0.3 ? 2 : 1);
  for (let i = 0; i < 14; i++) addCrater(25 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 38), 1);
  for (let i = 0; i < 14; i++) addCrater(42 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 38), 1);

  const map = {
    id: 'huegel214',
    name: 'Asse-Nord vor Hügel 214',
    sheet: { title: 'Lagekarte Asse-Nord, Herbst', blatt: 'Blatt 3a', scale: '1 : 2500', seed: 1914 },
    width: W,
    height: H,
    legend: 'terrain: . Lehm, k Kreide, f Fels, s Sumpf, w Wald, d Dorf, ~ Wasser | heights: 0 bis 3 | zones: E Etappe, S Stellung, N Niemandsland, s/e feindlich',
    terrain: terrain.map((r) => r.join('')),
    heights: hf.map((r) => r.join('')),
    zones: zones.map((r) => r.join('')),
    trenches: [...trenches.values()].sort((a, b) => a.y - b.y || a.x - b.x),
    wire: wire.sort((a, b) => a.y - b.y || a.x - b.x),
    craters: craters.sort((a, b) => a.y - b.y || a.x - b.x),
    rails: [...rails.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    buildings,
    cables: [
      { from: 'fernmelde', to: 'Abschnitt Mitte', points: [[15, 12], [20, 15.5], [24, 15.5]] },
      { from: 'fernmelde', to: 'batterie1', points: [[15, 12], [13, 20], [12, 28]] },
    ],
    labels: [
      { text: 'Asse', x: 1.0, y: 13, size: 0.75, rotate: -90, font: 'head', color: 'water' },
      { text: 'Hügel 214', x: 44, y: 11.4, size: 0.75, font: 'head', color: 'contour' },
      { text: 'Lange Wiese', x: 35, y: 27.5, size: 0.5, font: 'head', alpha: 0.6, rotate: -90 },
      { text: 'Heuwagen', x: 35.5, y: 22.4, size: 0.42, font: 'hand' },
      { text: 'Velder Mühle (Ruine)', x: 21.4, y: 6.3, size: 0.45, font: 'head' },
      { text: 'Raudas', x: 56.5, y: 37.6, size: 0.6, font: 'head' },
      { text: 'ETAPPE', x: 9, y: 38.4, size: 0.65, font: 'head', alpha: 0.5 },
      { text: 'NIEMANDSLAND', x: 34.6, y: 9, size: 0.55, font: 'head', alpha: 0.4, rotate: -90 },
      { text: 'Senke', x: 27, y: 37.2, size: 0.45, font: 'head', color: 'water' },
    ],
    notes: [
      { text: 'Heuwagen: Kronings letzte Fuhre', x: 31.5, y: 24.6, to: [35, 21.5], rotate: -3 },
      { text: 'Kreide: man hört jeden Spaten', x: 50, y: 25.5, to: [45, 20], rotate: 3 },
      { text: 'Senke läuft nach Regen voll', x: 21, y: 34.6, to: [27, 30.5], rotate: -2 },
      { text: 'Gasse im Draht', x: 33.5, y: 17.4, to: [32.4, 20.5], rotate: 2 },
    ],
  };
  loadMap(map);
  return map;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map = buildHuegel214();
  writeMapJson(new URL('../../data/maps/huegel214.json', import.meta.url), map);
  console.log('data/maps/huegel214.json geschrieben:', map.trenches.length, 'Grabenfelder,', map.craters.length, 'Krater,', map.wire.length, 'Drahtfelder');
}
