// Erzeugt die Karten fuer Akt 4 "Das letzte Fruehjahr" (P26): data/maps/raudas.json und data/maps/faehrhaus.json.
// Aufruf: node tools/maps/akt4.mjs
// Raudas (60 x 40): Lasks Linien vor Raudas im Fruehjahr. Seine vordere Linie (a4m1 geraeumt, mit Fallen), dahinter
//   der "Raum": eine zweite Linie mit Stuetzpunkten, der alte Bahndamm mit der letzten Linie, dann Raudas.
//   Gespielt in a4m1, a4m2, a4m4 und a4m6.
// Faehrhaus (60 x 40): die Asse beim Faehrhaus Ostervenn, Hochwasser. Die Behelfsbruecke ist weg; der Abschnitt
//   oestlich des Flusses haengt ohne Gleis in der Luft. Gespielt in a4m5.
// Das Werkzeug darf Math.sin benutzen; das Spiel liest nur das JSON.
import { pathToFileURL } from 'node:url';
import { createRng } from '../../js/rng.js';
import { lineCells, loadMap } from '../../js/map.js';
import { writeMapJson } from './write.mjs';

const W = 60, H = 40;
const key = (x, y) => x + ',' + y;
const grid = (v) => Array.from({ length: H }, () => Array.from({ length: W }, () => v));

/** Wichtige Felder fuer Szenarien und Missionsziele (0-basiert) */
export const RAUDAS = {
  ownLine: 23,          // eigene vordere Linie (Feuergraben)
  firstLine: 33,        // Lasks vordere Linie (a4m1 geraeumt)
  secondLine: 40,       // zweite Linie, der "Raum dahinter"
  damm: 46,             // alter Bahndamm, Lasks letzte Linie
  town: { x0: 52, x1: 58, y0: 9, y1: 30 },
  road: 20,             // Strasse nach Raudas
};
export const FAEHRHAUS = {
  river: [16, 20],      // Wasser zwischen diesen x (beide inklusive) auf Hoehe der Bruecke
  bridgeY: 20,
  westRail: 15,         // Gleisende am Westufer
  eastRail: 21,         // Gleisanfang am Ostufer
  front: 34,
};

function trenchTool(trenches) {
  return function trenchLine(pts, o) {
    for (let i = 0; i < pts.length - 1; i++) {
      for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
        const k = key(x, y);
        const old = trenches.get(k);
        if (old && (old.kind === 'fire' && o.kind === 'comm')) continue;
        if (old && old.kind === o.kind && old.level >= o.level) continue;
        trenches.set(k, { x, y, ...o });
      }
    }
  };
}

function finish(map) {
  map.trenches = [...map.trenches.values()].sort((a, b) => a.y - b.y || a.x - b.x);
  map.wire.sort((a, b) => a.y - b.y || a.x - b.x);
  map.craters.sort((a, b) => a.y - b.y || a.x - b.x);
  map.rails = [...map.rails.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  loadMap(map);
  return map;
}

// ------------------------------------------------------------------------------------------- Raudas

export function buildRaudas() {
  const rng = createRng(1918);
  const terrain = grid('.');
  const zones = grid('N');
  const hf = grid(1);
  const riverX = (y) => 1.1 + 0.5 * Math.sin(y * 0.27 + 0.4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let h = 1;
    // Ruecken hinter Raudas, sanft
    const d = ((x - 52) / 8) ** 2 + ((y - 34) / 5) ** 2;
    if (d < 1) h += 1.2 * (1 - d);
    // Bahndamm: ein schmaler Wall in Hoehe 2
    if (x === RAUDAS.damm - 1 || x === RAUDAS.damm) h = 2;
    // Senke vor Lasks vorderer Linie (Schmelzwasser)
    const s = ((x - 29) / 3.5) ** 2 + ((y - 27) / 3) ** 2;
    if (s < 1) h -= 1.1 * (1 - s);
    if (x < riverX(y) + 3) h = Math.min(h, (x - riverX(y)) / 3 + 0.2);
    hf[y][x] = Math.max(0, Math.min(3, Math.round(h)));
  }
  const blob = (cx, cy, rx, ry, code, rough = 0.25) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1 - rough + rng() * rough * 2) terrain[y][x] = code;
    }
  };
  blob(36, 6, 3, 2.5, 'w', 0.35);       // Birkenwaeldchen zwischen erster und zweiter Linie
  blob(43, 33, 2.6, 2.2, 'w', 0.35);
  blob(29, 27, 2.4, 1.8, 's');          // Schmelzwasser in der Senke
  blob(8, 34, 3, 2, 'w');
  // Raudas: Haeuser beidseits der Strasse, die Kirche, das Pfarrhaus
  const T = RAUDAS.town;
  for (let y = T.y0; y <= T.y1; y++) for (let x = T.x0; x <= T.x1; x++) {
    const street = y === RAUDAS.road || x === 55;
    if (!street && ((x * 5 + y * 3) % 4 !== 0 || rng() < 0.3)) terrain[y][x] = 'd';
  }
  // Stuetzpunkte in der zweiten Linie: Gehoeftreste
  for (const [cx, cy] of [[41, 12], [41, 28]]) for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx; x <= cx + 1; x++) terrain[y][x] = 'd';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x <= riverX(y)) { terrain[y][x] = '~'; hf[y][x] = 0; }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const wob = Math.round(Math.sin(y * 0.37) * 0.7);
    zones[y][x] = x <= 12 + wob ? 'E' : x <= 24 ? 'S' : x <= 31 ? 'N' : x <= 50 - wob ? 's' : 'e';
  }

  const trenches = new Map();
  const trenchLine = trenchTool(trenches);
  const own = { side: 'own', facing: 'E' }, foe = { side: 'enemy', facing: 'W' };
  const O = RAUDAS.ownLine;
  trenchLine([[O, 1], [O, 8], [O + 1, 10], [O + 1, 17], [O, 19], [O, 30], [O + 1, 32], [O + 1, 38]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[18, 2], [18, 37]], { ...own, kind: 'fire', level: 2 });
  for (const y of [6, 16, 25, 34]) trenchLine([[18, y], [O, y]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[13, 20], [18, 20]], { ...own, kind: 'comm', level: 1 });
  // Lasks vordere Linie: gut ausgebaut, den ganzen Winter gehalten (a4m1 leer)
  const F = RAUDAS.firstLine;
  trenchLine([[F, 1], [F, 7], [F + 1, 9], [F + 1, 16], [F, 18], [F, 26], [F + 1, 28], [F + 1, 38]], { ...foe, kind: 'fire', level: 3 });
  // Zweite Linie: kurze Stuecke um Stuetzpunkte, nicht durchgehend (Tiefe statt Linie)
  const S = RAUDAS.secondLine;
  trenchLine([[S, 3], [S, 15]], { ...foe, kind: 'fire', level: 3 });
  trenchLine([[S, 24], [S, 36]], { ...foe, kind: 'fire', level: 3 });
  trenchLine([[S - 1, 18], [S - 1, 22]], { ...foe, kind: 'fire', level: 2 });
  for (const y of [5, 12, 30]) trenchLine([[F + 1, y], [S, y]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[F, 21], [S - 1, 21]], { ...foe, kind: 'comm', level: 2 });
  // Bahndamm: die letzte Linie, eingegraben in den Wall
  const D = RAUDAS.damm;
  trenchLine([[D + 1, 2], [D + 1, 38]], { ...foe, kind: 'fire', level: 3 });
  for (const y of [9, 20, 31]) trenchLine([[S, y], [D + 1, y]], { ...foe, kind: 'comm', level: 2 });
  trenchLine([[D + 1, 20], [52, 20]], { ...foe, kind: 'comm', level: 1 });

  const wire = [];
  for (let y = 1; y <= 38; y++) if (y !== 6 && y !== 16 && y !== 25 && y !== 34) wire.push({ x: 26, y, side: 'own' });
  for (let y = 1; y <= 38; y++) if (y !== 21 && y % 9 !== 0) wire.push({ x: 31, y, side: 'enemy' });
  // Vor der zweiten Linie: Draht nur vor den Stuetzpunkten, dazwischen Gassen, die das MG bestreicht
  for (const [y0, y1] of [[2, 14], [25, 36]]) for (let y = y0; y <= y1; y++) wire.push({ x: S - 2, y, side: 'enemy' });
  for (let y = 2; y <= 38; y++) if (y !== 20) wire.push({ x: D - 2, y, side: 'enemy' });

  const rails = new Map();
  const railLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) rails.set(key(x, y), [x, y]); };
  railLine([[4, 20], [13, 20]]);
  railLine([[13, 20], [15, 18], [16, 14]]);
  railLine([[13, 20], [15, 22], [16, 27]]);

  const buildings = [
    { id: 'depot', type: 'depot', x: 4, y: 16, w: 3, h: 2, letter: 'D', label: 'Depot' },
    { id: 'bahnhof', type: 'bahnhof', x: 8, y: 17, w: 3, h: 2, letter: 'B', label: 'Feldbahnhof' },
    { id: 'kueche', type: 'kueche', x: 4, y: 12, w: 2, h: 2, letter: 'K', label: 'Feldküche' },
    { id: 'ruhelager', type: 'ruhelager', x: 8, y: 12, w: 3, h: 2, letter: 'R', label: 'Ruhelager' },
    { id: 'lazarett', type: 'lazarett', x: 5, y: 25, w: 3, h: 2, letter: 'L', label: 'Lazarett' },
    { id: 'fernmelde', type: 'fernmelde', x: 12, y: 9, w: 2, h: 2, letter: 'F', label: 'Fernmelde' },
    { id: 'batterie1', type: 'batterie', x: 9, y: 28, w: 2, h: 2, letter: 'A1', label: 'Batterie 1' },
    { id: 'batterie2', type: 'batterie', x: 11, y: 4, w: 2, h: 2, letter: 'A2', label: 'Batterie 2' },
    { id: 'unterstand1', type: 'unterstand', x: 20, y: 10, letter: '', label: '' },
    { id: 'unterstand2', type: 'unterstand', x: 20, y: 22, letter: '', label: '' },
    { id: 'unterstand3', type: 'unterstand', x: 20, y: 31, letter: '', label: '' },
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
    if (y === RAUDAS.road && x > 24) return; // die Strasse ist geflickt, der Kasten soll sie fahren koennen
    craterSet.add(k);
    craters.push({ x, y, size });
  };
  for (let i = 0; i < 70; i++) addCrater(25 + Math.floor(rng() * 8), 1 + Math.floor(rng() * 38), rng() < 0.3 ? 2 : 1);
  for (let i = 0; i < 40; i++) addCrater(34 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 38), rng() < 0.2 ? 2 : 1);
  for (let i = 0; i < 14; i++) addCrater(19 + Math.floor(rng() * 4), 1 + Math.floor(rng() * 38), 1);

  return finish({
    id: 'raudas',
    name: 'Vor Raudas, Frühjahr',
    sheet: { title: 'Lagekarte vor Raudas, Frühjahr', blatt: 'Blatt 4a', scale: '1 : 2500', seed: 1918 },
    width: W,
    height: H,
    legend: 'terrain: . Lehm, k Kreide, f Fels, s Sumpf, w Wald, d Dorf, ~ Wasser | heights: 0 bis 3 | zones: E Etappe, S Stellung, N Niemandsland, s/e feindlich',
    terrain: terrain.map((r) => r.join('')),
    heights: hf.map((r) => r.join('')),
    zones: zones.map((r) => r.join('')),
    trenches,
    wire,
    craters,
    rails,
    buildings,
    cables: [
      { from: 'fernmelde', to: 'Abschnitt Mitte', points: [[13, 10], [18, 16.5], [23, 16.5]] },
      { from: 'fernmelde', to: 'batterie1', points: [[13, 10], [11, 20], [10, 28]] },
    ],
    labels: [
      { text: 'Asse', x: 0.9, y: 12, size: 0.7, rotate: -90, font: 'head', color: 'water' },
      { text: 'Raudas', x: 55.5, y: 8.2, size: 0.65, font: 'head' },
      { text: 'Pfarrhaus', x: 56.5, y: 22.4, size: 0.4, font: 'hand' },
      { text: 'Alter Bahndamm', x: 45.4, y: 20, size: 0.48, font: 'head', rotate: -90 },
      { text: 'Straße nach Raudas', x: 37, y: 19.3, size: 0.42, font: 'hand' },
      { text: 'Birken', x: 36, y: 3.2, size: 0.4, font: 'head', color: 'forestLine' },
      { text: 'ETAPPE', x: 7, y: 38.4, size: 0.65, font: 'head', alpha: 0.5 },
      { text: 'NIEMANDSLAND', x: 28.6, y: 13, size: 0.5, font: 'head', alpha: 0.4, rotate: -90 },
    ],
    notes: [
      { text: 'Lasks vordere Linie', x: 27.5, y: 2.2, to: [33, 3], rotate: -2 },
      { text: 'der Raum dahinter (Fedders)', x: 35.5, y: 36.6, to: [40, 34], rotate: 2 },
      { text: 'Schmelzwasser', x: 24.5, y: 29.8, to: [29, 27.5], rotate: -3 },
    ],
  });
}

// ------------------------------------------------------------------------------------------- Faehrhaus

export function buildFaehrhaus() {
  const rng = createRng(1919);
  const terrain = grid('.');
  const zones = grid('N');
  const hf = grid(1);
  const [r0, r1] = FAEHRHAUS.river;
  // Hochwasser: die Asse ist an der Bruecke fuenf Felder breit, sonst schwankt sie ein wenig
  const bank = (y) => {
    const w = 0.6 * Math.sin(y * 0.31 + 0.7) + 0.4 * Math.sin(y * 0.83);
    return [r0 + Math.round(w), r1 + Math.round(w * 0.6)];
  };
  for (let y = 0; y < H; y++) {
    const [a, b] = Math.abs(y - FAEHRHAUS.bridgeY) <= 1 ? [r0, r1] : bank(y);
    for (let x = 0; x < W; x++) {
      let h = 1;
      if (x >= a - 2 && x <= b + 2) h = 0;
      const d = ((x - 46) / 6) ** 2 + ((y - 10) / 4) ** 2;
      if (d < 1) h += 1.3 * (1 - d);
      const e = ((x - 6) / 5) ** 2 + ((y - 6) / 3) ** 2;
      if (e < 1) h += 0.9 * (1 - e);
      hf[y][x] = Math.max(0, Math.min(3, Math.round(h)));
      if (x >= a && x <= b) { terrain[y][x] = '~'; hf[y][x] = 0; }
    }
  }
  const blob = (cx, cy, rx, ry, code, rough = 0.25) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (terrain[y][x] === '~') continue;
      const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
      if (d < 1 - rough + rng() * rough * 2) terrain[y][x] = code;
    }
  };
  blob(55, 28, 4, 6, 'w');              // Zelva-Wald hinter Morrows Linien
  blob(12, 33, 2.5, 3, 'w');            // Erlen am Westufer
  blob(24, 31, 2.2, 1.6, 's');          // ueberschwemmte Wiese
  blob(23, 9, 2, 1.5, 's');
  // Ostervenn am Westufer: Kirche, Schule (Lazarett), Haeuser
  for (let y = 9; y <= 27; y++) for (let x = 3; x <= 9; x++) {
    if (y === 20 || x === 6) continue;
    if ((x * 3 + y * 7) % 5 !== 0 && rng() < 0.75) terrain[y][x] = 'd';
  }
  // Faehrhaus am Ostufer
  terrain[18][22] = 'd'; terrain[18][23] = 'd';
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    zones[y][x] = x <= 20 ? 'E' : x <= 34 ? 'S' : x <= 42 ? 'N' : x <= 50 ? 's' : 'e';
  }

  const trenches = new Map();
  const trenchLine = trenchTool(trenches);
  const own = { side: 'own', facing: 'E' }, foe = { side: 'enemy', facing: 'W' };
  const Fr = FAEHRHAUS.front;
  trenchLine([[Fr, 2], [Fr, 10], [Fr - 1, 12], [Fr - 1, 26], [Fr, 28], [Fr, 38]], { ...own, kind: 'fire', level: 2 });
  trenchLine([[28, 4], [28, 36]], { ...own, kind: 'fire', level: 2 });
  for (const y of [8, 20, 32]) trenchLine([[28, y], [Fr, y]], { ...own, kind: 'comm', level: 2 });
  trenchLine([[24, 20], [28, 20]], { ...own, kind: 'comm', level: 1 });
  trenchLine([[44, 1], [44, 14], [43, 16], [43, 30], [44, 32], [44, 38]], { ...foe, kind: 'fire', level: 2 });
  trenchLine([[49, 4], [49, 36]], { ...foe, kind: 'fire', level: 2 });
  for (const y of [10, 22, 33]) trenchLine([[44, y], [49, y]], { ...foe, kind: 'comm', level: 2 });

  const wire = [];
  for (let y = 2; y <= 37; y++) if (y !== 8 && y !== 20 && y !== 32) wire.push({ x: Fr + 2, y, side: 'own' });
  for (let y = 1; y <= 38; y++) if (y !== 22) wire.push({ x: 41, y, side: 'enemy' });

  const rails = new Map();
  const railLine = (pts) => { for (let i = 0; i < pts.length - 1; i++) for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) rails.set(key(x, y), [x, y]); };
  const by = FAEHRHAUS.bridgeY;
  railLine([[1, by], [FAEHRHAUS.westRail, by]]);
  // Ostufer: das Gleis liegt noch, nur die Bruecke fehlt
  railLine([[FAEHRHAUS.eastRail, by], [25, by], [26, by - 4]]);
  railLine([[25, by], [26, by + 5]]);

  const buildings = [
    { id: 'depot', type: 'depot', x: 1, y: 15, w: 2, h: 2, letter: 'D', label: 'Depot' },
    { id: 'bahnhof', type: 'bahnhof', x: 11, y: 21, w: 3, h: 2, letter: 'B', label: 'Feldbahnhof' },
    { id: 'kueche', type: 'kueche', x: 11, y: 16, w: 2, h: 2, letter: 'K', label: 'Feldküche' },
    { id: 'lazarett', type: 'lazarett', x: 4, y: 28, w: 3, h: 2, letter: 'L', label: 'Lazarett' },
    { id: 'ruhelager', type: 'ruhelager', x: 1, y: 24, w: 2, h: 3, letter: 'R', label: 'Ruhelager' },
    { id: 'fernmelde', type: 'fernmelde', x: 11, y: 11, w: 2, h: 2, letter: 'F', label: 'Fernmelde' },
    { id: 'batterie1', type: 'batterie', x: 12, y: 30, w: 2, h: 2, letter: 'A1', label: 'Batterie 1' },
    { id: 'unterstand1', type: 'unterstand', x: 30, y: 12, letter: '', label: '' },
    { id: 'unterstand2', type: 'unterstand', x: 30, y: 28, letter: '', label: '' },
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
    if (craterSet.has(k) || trenches.has(k) || terrain[y][x] === '~' || terrain[y][x] === 'd' || rails.has(k)) return;
    craterSet.add(k);
    craters.push({ x, y, size });
  };
  for (let i = 0; i < 60; i++) addCrater(36 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 38), rng() < 0.3 ? 2 : 1);
  // Stoerfeuer auf den alten Uebergang
  for (let i = 0; i < 12; i++) addCrater(21 + Math.floor(rng() * 4), by - 4 + Math.floor(rng() * 9), 1);
  for (let i = 0; i < 8; i++) addCrater(12 + Math.floor(rng() * 4), by - 4 + Math.floor(rng() * 9), 1);

  return finish({
    id: 'faehrhaus',
    name: 'Fährhaus Ostervenn, Hochwasser',
    sheet: { title: 'Lagekarte Fährhaus Ostervenn, Frühjahr', blatt: 'Blatt 4b', scale: '1 : 2500', seed: 1919 },
    width: W,
    height: H,
    legend: 'terrain: . Lehm, k Kreide, f Fels, s Sumpf, w Wald, d Dorf, ~ Wasser | heights: 0 bis 3 | zones: E Etappe, S Stellung, N Niemandsland, s/e feindlich',
    terrain: terrain.map((r) => r.join('')),
    heights: hf.map((r) => r.join('')),
    zones: zones.map((r) => r.join('')),
    trenches,
    wire,
    craters,
    rails,
    buildings,
    cables: [
      { from: 'fernmelde', to: 'batterie1', points: [[12, 12], [11, 22], [13, 30]] },
    ],
    labels: [
      { text: 'Asse (Hochwasser)', x: 18.5, y: 5.5, size: 0.6, rotate: -90, font: 'head', color: 'water' },
      { text: 'Ostervenn', x: 6, y: 7.6, size: 0.6, font: 'head' },
      { text: 'Fährhaus', x: 22.8, y: 17.2, size: 0.42, font: 'head' },
      { text: 'Zelva-Wald', x: 55, y: 20.6, size: 0.5, font: 'head', color: 'forestLine' },
      { text: 'ETAPPE', x: 6, y: 38.4, size: 0.65, font: 'head', alpha: 0.5 },
      { text: 'NIEMANDSLAND', x: 38.5, y: 15, size: 0.5, font: 'head', alpha: 0.4, rotate: -90 },
    ],
    notes: [
      { text: 'hier stand die Behelfsbrücke', x: 9.5, y: 24.6, to: [16, 20.5], rotate: -2 },
      { text: 'Gleis endet am Ufer', x: 9, y: 18.8, to: [15, 20], rotate: 2 },
      { text: 'Störfeuer aus dem Zelva-Wald', x: 45, y: 37.2, to: [52, 32], rotate: 3 },
    ],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [id, fn] of [['raudas', buildRaudas], ['faehrhaus', buildFaehrhaus]]) {
    const map = fn();
    writeMapJson(new URL(`../../data/maps/${id}.json`, import.meta.url), map);
    console.log(`data/maps/${id}.json geschrieben:`, map.trenches.length, 'Grabenfelder,', map.craters.length, 'Krater,', map.wire.length, 'Drahtfelder');
  }
}
