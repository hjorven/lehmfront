// Erzeugt data/maps/kroning.json, die Karte fuer Akt 3 "Materialschlacht" (60 x 40, P24).
// Aufruf: node tools/maps/kroning.mjs
// Asse-Mitte im Winter: das Gehoeft Kroning als Ruine mitten im Niemandsland an der Strasse nach Raudas, noerdlich
// davon das Kraehenholz mit dem Sappenkopf, davor der Heuwagen. Morrow hat hinter der ersten Linie eine zweite, die
// auf keiner Karte des Stabs steht (a3m6). Hinter Morrows Linien der Zelva-Wald mit den neuen Batterien, hinter
// der eigenen Linie die Ziegelei in der Etappe (a3m3) und die Ruine der Velder Muehle in der Stellung (a3m1).
// Das Werkzeug darf Math.sin benutzen; das Spiel liest nur das JSON.
import { pathToFileURL } from 'node:url';
import { createRng } from '../../js/rng.js';
import { lineCells, loadMap } from '../../js/map.js';
import { writeMapJson } from './write.mjs';

const W = 60, H = 40;

/** Wichtige Felder fuer Szenarien und Missionsziele (0-basiert) */
export const SPOTS = {
  kroning: { x: 35, y: 26 },       // Mitte des Gehoefts
  sappenkopf: { x: 33, y: 7 },     // Kopf der Sappe am Kraehenholz
  heuwagen: { x: 34, y: 18 },
  muehle: { x: 21, y: 8 },
  ziegelei: { x: 7, y: 31 },
  zelva: { x: 55, y: 30 },
};
/** Felder des Gehoefts (Ruine, Hofmauer) */
export const KRONING = [];
for (let y = 25; y <= 27; y++) for (let x = 34; x <= 36; x++) KRONING.push({ x, y });

export function buildKroning() {
  const rng = createRng(1917);
  const grid = (v) => Array.from({ length: H }, () => Array.from({ length: W }, () => v));
  const terrain = grid('.');
  const zones = grid('N');
  const hf = grid(1);
  const riverX = (y) => 1.3 + 0.6 * Math.sin(y * 0.31 + 1.1) + 0.3 * Math.sin(y * 0.9);

  const hills = [
    { cx: 46, cy: 8, rx: 7, ry: 5, peak: 1.4 },       // Rueckhang vor Raudas: Morrows Beobachter
    { cx: 12, cy: 6, rx: 5, ry: 3.5, peak: 1.0 },     // Ruecken hinter Ostervenn
    { cx: 24, cy: 34, rx: 5, ry: 3, peak: 0.9 },
  ];
  const dips = [
    { cx: 33, cy: 13, rx: 4, ry: 3, depth: 1.1 },     // Mulde vor dem Kraehenholz: hier bleibt das Gas liegen
    { cx: 38, cy: 33, rx: 3.5, ry: 3, depth: 0.9 },
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
  blob(35.5, 5, 3.4, 3.2, 'w', 0.35);  // Kraehenholz im Niemandsland, zerschossen
  blob(55.5, 30, 3.8, 5, 'w');         // Zelva-Wald hinter Morrows Linien
  blob(7, 36, 4, 2.5, 'w');            // Erlen an der Asse
  blob(37, 33, 2.2, 1.6, 's');         // Sumpf in der Mulde
  // Gehoeft Kroning: Ruine, Mauern nur noch hueftohoch
  for (const p of KRONING) terrain[p.y][p.x] = 'd';
  terrain[24][35] = 'd';
  // Velder Muehle (Ruine) in der eigenen Stellung
  for (let y = 7; y <= 9; y++) for (let x = 20; x <= 22; x++) if ((x + y) % 2 === 0 || rng() < 0.4) terrain[y][x] = 'd';
  // Ziegelei in der Etappe
  for (let y = 30; y <= 32; y++) for (let x = 6; x <= 8; x++) if ((x * 3 + y) % 4 !== 0) terrain[y][x] = 'd';
  // Raudas am Ostrand
  for (let y = 8; y <= 14; y++) for (let x = 55; x <= 58; x++) if ((x + 2 * y) % 3 !== 0) terrain[y][x] = 'd';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x <= riverX(y)) { terrain[y][x] = '~'; hf[y][x] = 0; }

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wob = Math.round(Math.sin(y * 0.41) * 0.7);
    zones[y][x] = x <= 16 + wob ? 'E' : x <= 30 ? 'S' : x <= 39 ? 'N' : x <= 50 - wob ? 's' : 'e';
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
  // Eigene vordere Linie: zickzack, vor der Muehle ein Vorsprung
  trenchLine([[29, 2], [29, 6], [30, 8], [30, 14], [29, 16], [29, 22], [30, 24], [30, 29], [29, 31], [29, 38]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[24, 3], [24, 37]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[24, 6], [29, 6]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 15], [29, 15]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 26], [30, 26]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 33], [29, 33]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[18, 15], [24, 15]], { ...own, kind: 'comm', level: 1 });
  trenchLine([[18, 26], [24, 26]], { ...own, kind: 'comm', level: 1 });
  // Morrow: erste Linie duenn, zweite Linie tief und betoniert (steht auf keiner Karte des Stabs)
  trenchLine([[41, 1], [41, 9], [42, 11], [42, 22], [41, 24], [41, 30], [42, 32], [42, 38]], { ...foe, kind: 'fire', level: 2 });
  trenchLine([[47, 2], [47, 12], [46, 14], [46, 26], [47, 28], [47, 37]], { ...foe, kind: 'fire', level: 3 });
  trenchLine([[42, 6], [47, 6]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[42, 18], [46, 18]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[41, 28], [47, 28]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[47, 20], [52, 20]], { ...foe, kind: 'comm', level: 1 });

  const wire = [];
  for (let y = 2; y <= 37; y++) if (y !== 7 && y !== 18 && y !== 26) wire.push({ x: 32, y, side: 'own' });
  for (let y = 1; y <= 38; y++) if (y !== 12 && y !== 26) wire.push({ x: 39, y, side: 'enemy' });
  // Draht um das Gehoeft: Morrow hat es zum Stuetzpunkt gemacht
  for (const [x, y] of [[33, 24], [33, 28], [37, 24], [37, 28]]) wire.push({ x, y, side: 'enemy' });

  const rails = new Map();
  const railLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) rails.set(key(x, y), [x, y]); };
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
    { id: 'batterie1', type: 'batterie', x: 11, y: 26, w: 2, h: 2, letter: 'A1', label: 'Batterie 1' },
    { id: 'batterie2', type: 'batterie', x: 13, y: 33, w: 2, h: 2, letter: 'A2', label: 'Batterie 2' },
    { id: 'unterstand1', type: 'unterstand', x: 26, y: 10, letter: '', label: '' },
    { id: 'unterstand2', type: 'unterstand', x: 26, y: 20, letter: '', label: '' },
    { id: 'unterstand3', type: 'unterstand', x: 26, y: 30, letter: '', label: '' },
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
  // Materialschlacht: das Niemandsland ist umgepfluegt
  for (let i = 0; i < 130; i++) addCrater(31 + Math.floor(rng() * 9), 1 + Math.floor(rng() * 38), rng() < 0.35 ? 2 : 1);
  for (let i = 0; i < 24; i++) addCrater(25 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 38), 1);
  for (let i = 0; i < 24; i++) addCrater(42 + Math.floor(rng() * 7), 1 + Math.floor(rng() * 38), 1);

  const map = {
    id: 'kroning',
    name: 'Asse-Mitte vor dem Gehöft Kroning',
    sheet: { title: 'Lagekarte Asse-Mitte, Winter', blatt: 'Blatt 3b', scale: '1 : 2500', seed: 1917 },
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
      { from: 'fernmelde', to: 'batterie1', points: [[15, 12], [13, 20], [12, 26]] },
    ],
    labels: [
      { text: 'Asse', x: 1.0, y: 13, size: 0.75, rotate: -90, font: 'head', color: 'water' },
      { text: 'Gehöft Kroning', x: 35.5, y: 23.2, size: 0.5, font: 'head' },
      { text: 'Krähenholz', x: 35.5, y: 1.3, size: 0.55, font: 'head', color: 'forestLine' },
      { text: 'Zelva-Wald', x: 55.5, y: 24.4, size: 0.5, font: 'head', color: 'forestLine' },
      { text: 'Velder Mühle (Ruine)', x: 21.4, y: 6.3, size: 0.45, font: 'head' },
      { text: 'Ziegelei', x: 7.2, y: 29.4, size: 0.45, font: 'head' },
      { text: 'Raudas', x: 56.5, y: 15.8, size: 0.6, font: 'head' },
      { text: 'Heuwagen', x: 34.5, y: 19.4, size: 0.42, font: 'hand' },
      { text: 'ETAPPE', x: 9, y: 38.4, size: 0.65, font: 'head', alpha: 0.5 },
      { text: 'NIEMANDSLAND', x: 37.6, y: 16, size: 0.55, font: 'head', alpha: 0.4, rotate: -90 },
    ],
    notes: [
      { text: 'Straße nach Raudas', x: 37.5, y: 30.6, to: [36, 27.5], rotate: -3 },
      { text: 'Mulde: hier bleibt das Gas liegen', x: 26, y: 12.2, to: [32, 13], rotate: 2 },
      { text: 'Sappenkopf', x: 30.5, y: 10.4, to: [33, 7.5], rotate: -2 },
      { text: '2. Linie? (Fedders)', x: 49.5, y: 35.5, to: [47, 32], rotate: 3 },
    ],
  };
  loadMap(map);
  return map;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map = buildKroning();
  writeMapJson(new URL('../../data/maps/kroning.json', import.meta.url), map);
  console.log('data/maps/kroning.json geschrieben:', map.trenches.length, 'Grabenfelder,', map.craters.length, 'Krater,', map.wire.length, 'Drahtfelder');
}
