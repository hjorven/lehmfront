// Erzeugt data/maps/asse.json, die erste Karte (60 x 40) nach dem Vorbild des Mockups.
// Aufruf: node tools/maps/asse.mjs
// Das Werkzeug darf Math.sin benutzen; die Ausgabe ist trotzdem fest (nur Seed-Zufall), das Spiel liest nur das JSON.
import { pathToFileURL } from 'node:url';
import { createRng } from '../../js/rng.js';
import { lineCells, loadMap } from '../../js/map.js';
import { writeMapJson } from './write.mjs';

const W = 60, H = 40;

export function buildAsse() {
const rng = createRng(214);
const grid = (v) => Array.from({ length: H }, () => Array.from({ length: W }, () => v));
const terrain = grid('.');
const zones = grid('N');
const hf = grid(1);

// Fluss Asse am linken Rand
const riverX = (y) => 1.7 + 0.9 * Math.sin(y * 0.33) + 0.4 * Math.sin(y * 0.9 + 1);

// Hoehen: Plateau 1, Fluss-Senke 0, Huegel
const hills = [
  { cx: 19.5, cy: 7, rx: 7, ry: 4.5, peak: 1.9 },   // Beobachtungshuegel mit Turm
  { cx: 50, cy: 29, rx: 9, ry: 6.5, peak: 2.4 },    // Huegel 214
  { cx: 8, cy: 34, rx: 4.5, ry: 3, peak: 1.2 },     // kleiner Ruecken bei den Batterien
  { cx: 38, cy: 5, rx: 3.5, ry: 2.5, peak: 0.8 },   // Kuppe im Niemandsland
];
const dips = [{ cx: 41.5, cy: 35, rx: 4.5, ry: 3.5, depth: 1.2 }]; // Senke mit Sumpf
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    let h = 1;
    for (const k of hills) {
      const d = ((x - k.cx) / k.rx) ** 2 + ((y - k.cy) / k.ry) ** 2;
      if (d < 1) h += k.peak * (1 - d);
    }
    for (const k of dips) {
      const d = ((x - k.cx) / k.rx) ** 2 + ((y - k.cy) / k.ry) ** 2;
      if (d < 1) h -= k.depth * (1 - d);
    }
    const rx = riverX(y);
    if (x < rx + 4) h = Math.min(h, (x - rx) / 4 + 0.2);
    hf[y][x] = Math.max(0, Math.min(3, Math.round(h)));
  }
}

// Boden
const blob = (cx, cy, rx, ry, code, rough = 0.25) => {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d < 1 - rough + rng() * rough * 2) terrain[y][x] = code;
  }
};
blob(8.5, 3.5, 6, 3, 'w');      // Wald hinter der Etappe
blob(25, 35, 4, 3, 'w');        // Waeldchen bei Abschnitt C
blob(54.5, 4, 5.5, 3.2, 'w');   // Wald hinter der feindlichen Linie
blob(39.5, 8.5, 1.6, 1.2, 'w', 0.4); // zerschossene Baumgruppe im Niemandsland
blob(41.5, 35.5, 3.6, 2.6, 's'); // Sumpf in der Senke
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (hf[y][x] === 3) terrain[y][x] = rng() < 0.15 ? 'f' : 'k';
}
blob(20, 6.5, 2.2, 1.4, 'k');   // Kreidekuppe unter dem Turm
// Kalkhof: Dorf hinter der feindlichen Linie, mit Hoefen und Luecken
for (let y = 31; y <= 36; y++) for (let x = 54; x <= 58; x++) if ((x + y) % 3 !== 0 || rng() < 0.4) terrain[y][x] = 'd';
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x <= riverX(y)) { terrain[y][x] = '~'; hf[y][x] = 0; }

// Zonen von hinten nach vorn, die Grenzen schwingen leicht mit dem Gelaende
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const wob = Math.round(Math.sin(y * 0.4) * 0.8);
  zones[y][x] = x <= 21 + wob ? 'E' : x <= 34 ? 'S' : x <= 43 ? 'N' : x <= 51 - wob ? 's' : 'e';
}

// Graeben als Linienzuege, in Felder zerlegt
const trenches = new Map();
const key = (x, y) => x + ',' + y;
function trenchLine(pts, o) {
  for (let i = 0; i < pts.length - 1; i++) {
    for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
      const k = key(x, y);
      const old = trenches.get(k);
      // Feuergraben gewinnt gegen Laufgraben, hoehere Stufe gewinnt
      if (old && (old.kind === 'fire' && o.kind === 'comm')) continue;
      if (old && old.kind === o.kind && old.level >= o.level) continue;
      trenches.set(k, { x, y, ...o });
    }
  }
}
const own = { side: 'own', facing: 'E' }, foe = { side: 'enemy', facing: 'W' };
// Eigene vordere Linie mit Ausbuchtung vor Abschnitt B, Abschnitt A ausgebaut (Stufe 3)
trenchLine([[32, 2], [32, 13]], { ...own, kind: 'fire', level: 3 });
trenchLine([[32, 13], [33, 15], [33, 24], [32, 26], [32, 37]], { ...own, kind: 'fire', level: 2 });
// Unterstuetzungslinie
trenchLine([[27, 3], [27, 36]], { ...own, kind: 'fire', level: 2 });
// Laufgraeben zwischen den Linien und nach hinten
trenchLine([[27, 9], [32, 9]], { ...own, kind: 'comm', level: 2 });
trenchLine([[27, 20], [33, 20]], { ...own, kind: 'comm', level: 2 });
trenchLine([[27, 30], [32, 30]], { ...own, kind: 'comm', level: 2 });
trenchLine([[22, 20], [27, 20]], { ...own, kind: 'comm', level: 1 });
trenchLine([[22, 11], [27, 11]], { ...own, kind: 'comm', level: 1 });
// Sappe mit Horchposten ins Niemandsland
trenchLine([[33, 22], [36, 23]], { ...own, kind: 'fire', level: 1, facing: 'E' });
// Feindliche Linien
trenchLine([[45, 1], [45, 16], [46, 18], [46, 27], [45, 29], [45, 38]], { ...foe, kind: 'fire', level: 2 });
trenchLine([[50, 3], [50, 22], [51, 24], [51, 36]], { ...foe, kind: 'fire', level: 3 });
trenchLine([[45, 12], [50, 12]], { ...foe, kind: 'comm', level: 2 });
trenchLine([[46, 24], [51, 24]], { ...foe, kind: 'comm', level: 2 });
trenchLine([[51, 30], [56, 30]], { ...foe, kind: 'comm', level: 1 });

// Draht vor beiden Linien, mit Gassen
const wire = [];
for (let y = 2; y <= 37; y++) if (y !== 19 && y !== 20) wire.push({ x: 35, y, side: 'own' });
for (let y = 1; y <= 38; y++) if (y !== 9) wire.push({ x: 43, y, side: 'enemy' });
const wireSet = new Set(wire.map((d) => key(d.x, d.y)));

// Gleise der Feldbahn
const rails = new Map();
const railLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) rails.set(key(x, y), [x, y]); };
railLine([[5, 18], [19, 18]]);
railLine([[19, 18], [23, 14], [25, 14]]);
railLine([[19, 18], [23, 22], [25, 22]]);

// Gebaeude
const buildings = [
  { id: 'depot', type: 'depot', x: 5, y: 15, w: 3, h: 2, letter: 'D', label: 'Depot' },
  { id: 'bahnhof', type: 'bahnhof', x: 10, y: 15, w: 3, h: 2, letter: 'B', label: 'Feldbahnhof' },
  { id: 'kueche', type: 'kueche', x: 5, y: 10, w: 2, h: 2, letter: 'K', label: 'Feldküche' },
  { id: 'ruhelager', type: 'ruhelager', x: 9, y: 10, w: 3, h: 2, letter: 'R', label: 'Ruhelager' },
  { id: 'lazarett', type: 'lazarett', x: 5, y: 23, w: 3, h: 2, letter: 'L', label: 'Lazarett' },
  { id: 'werkstatt', type: 'werkstatt', x: 11, y: 23, w: 3, h: 2, letter: 'W', label: 'Werkstatt' },
  { id: 'turm', type: 'turm', x: 19, y: 6, w: 2, h: 2, letter: 'T', label: 'Beob.-Turm' },
  { id: 'fernmelde', type: 'fernmelde', x: 16, y: 11, w: 2, h: 2, letter: 'F', label: 'Fernmelde' },
  { id: 'batterie1', type: 'batterie', x: 12, y: 29, w: 2, h: 2, letter: 'A1', label: 'Batterie 1' },
  { id: 'batterie2', type: 'batterie', x: 16, y: 32, w: 2, h: 2, letter: 'A2', label: 'Batterie 2' },
  { id: 'unterstand1', type: 'unterstand', x: 29, y: 6, letter: '', label: '' },
  { id: 'unterstand2', type: 'unterstand', x: 29, y: 16, letter: '', label: '' },
  { id: 'unterstand3', type: 'unterstand', x: 29, y: 24, letter: '', label: '' },
  { id: 'unterstand4', type: 'unterstand', x: 29, y: 33, letter: '', label: '' },
];
for (const b of buildings) {
  for (let y = b.y; y < b.y + (b.h || 1); y++) for (let x = b.x; x < b.x + (b.w || 1); x++) {
    if (terrain[y][x] === '~' || trenches.has(key(x, y)) || rails.has(key(x, y))) throw new Error('Gebaeude ' + b.id + ' liegt auf Wasser, Graben oder Gleis');
    terrain[y][x] = '.';
  }
}

// Krater: dicht im Niemandsland, vereinzelt in den Stellungen
const craters = [];
const craterSet = new Set();
const addCrater = (x, y, size) => {
  const k = key(x, y);
  if (craterSet.has(k) || trenches.has(k) || terrain[y][x] === '~' || terrain[y][x] === 'd') return;
  craterSet.add(k);
  craters.push({ x, y, size });
};
for (let i = 0; i < 95; i++) addCrater(36 + Math.floor(rng() * 7), 1 + Math.floor(rng() * 38), rng() < 0.35 ? 2 : 1);
for (let i = 0; i < 18; i++) addCrater(28 + Math.floor(rng() * 7), 1 + Math.floor(rng() * 38), 1);
for (let i = 0; i < 16; i++) addCrater(44 + Math.floor(rng() * 8), 1 + Math.floor(rng() * 38), 1);

const map = {
  id: 'asse',
  name: 'Asse-Nord',
  sheet: { title: 'Lagekarte Asse-Nord', blatt: 'Blatt 3', scale: '1 : 2500', seed: 214 },
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
    { from: 'fernmelde', to: 'Abschnitt A', points: [[17, 12], [23, 8.5], [27, 8.5]] },
    { from: 'fernmelde', to: 'Abschnitt C', points: [[17, 12], [23, 26.5], [27, 26.5]], cut: [24.5, 26.5] },
    { from: 'fernmelde', to: 'batterie1', points: [[17, 12], [14, 21], [13, 29]] },
  ],
  labels: [
    { text: 'Asse', x: 1.2, y: 21, size: 0.75, rotate: -90, font: 'head', color: 'water' },
    { text: 'Hügel 214', x: 48.5, y: 32.6, size: 0.7, font: 'head', color: 'contour' },
    { text: 'Kalkhof', x: 56.5, y: 37.4, size: 0.6, font: 'head' },
    { text: 'ETAPPE', x: 11, y: 38.4, size: 0.65, font: 'head', alpha: 0.5 },
    { text: 'NIEMANDSLAND', x: 39.5, y: 20, size: 0.6, font: 'head', alpha: 0.4, rotate: -90 },
    { text: 'Abschnitt A', x: 30.6, y: 5, size: 0.5, font: 'head', color: 'own', rotate: -90 },
    { text: 'Abschnitt B', x: 30.6, y: 15, size: 0.5, font: 'head', color: 'own', rotate: -90 },
    { text: 'Abschnitt C', x: 30.6, y: 27, size: 0.5, font: 'head', color: 'own', rotate: -90 },
    { text: '× Leitung unterbrochen', x: 24.5, y: 27.3, size: 0.42, color: 'enemy' },
  ],
  notes: [
    { text: 'MG auf 214? nachts verlegt', x: 53, y: 21.5, to: [49.5, 27], rotate: -4 },
    { text: 'Gasse im Draht, nur nachts', x: 37.5, y: 16.5, to: [35.4, 19.4], rotate: 3 },
    { text: 'Brunnen Kalkhof: nicht trinken', x: 52, y: 38.8, to: [55.5, 34], rotate: -2 },
    { text: 'nach Regen knietief', x: 36.5, y: 39.2, to: [40, 36], rotate: 2 },
    { text: 'Turm sieht bis zur Kuppe', x: 22.5, y: 3.2, to: [20.5, 6], rotate: -3 },
  ],
};

loadMap(map); // prueft das Ergebnis
return map;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const map = buildAsse();
  writeMapJson(new URL('../../data/maps/asse.json', import.meta.url), map);
  console.log('data/maps/asse.json geschrieben:', map.trenches.length, 'Grabenfelder,', map.craters.length, 'Krater,', map.wire.length, 'Drahtfelder');
}
