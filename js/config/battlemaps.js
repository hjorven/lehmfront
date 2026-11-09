// Karten fuer "Gefecht frei" (P17, Plan 8): vier handgebaute Karten plus Zufallskarte.
// Asse-Nord ist die feste Karte aus P02 mit eigenem Szenario. Die anderen drei sind Beschreibungen fuer
// buildMap (js/mapgen.js): von Hand gesetzte Huegel, Waelder, Doerfer, Linien; die Ostseite ist das Spiegelbild.
// Namen stehen in beiden Namenssprachen: jede Kartenhaelfte heisst so, wie die Fraktion sie nennt, die dort liegt.

const W = 60, H = 40;

const VELDE = {
  id: 'velde', name: 'Velder Mühle', seed: 1201, width: W, height: H, symmetry: 'spiegel',
  title: 'Lagekarte Velder Mühle', blatt: 'Blatt 4',
  etappe: 15, stellung: 10, wobble: 1, river: true,
  riverName: 'Asse', riverOther: 'Asava',
  hills: [
    { cx: 9, cy: 7, rx: 6, ry: 4, peak: 1.8, named: true, names: { kaldern: 'Ostkopp', morrow: 'Rukvakalns' } },
    { cx: 20, cy: 32, rx: 5, ry: 3.5, peak: 1.2 },
  ],
  // Bachniederung quer durch das Niemandsland: Sumpf, im Regen knietief
  dips: [{ cx: 24, cy: 20, rx: 9, ry: 2.6, depth: 1.2 }],
  swamps: [{ cx: 26, cy: 20.5, rx: 5, ry: 1.6 }],
  woods: [
    { cx: 6, cy: 33, rx: 5, ry: 3, names: { kaldern: 'Ellernbusch', morrow: 'Zelva-Wald' } },
    { cx: 27.5, cy: 9, rx: 1.4, ry: 1.2, rough: 0.4, named: false },
  ],
  villages: [
    { cx: 7, cy: 20, rx: 2.6, ry: 2.4, names: { kaldern: 'Ostervenn', morrow: 'Raudas' } },
    { cx: 19, cy: 11, rx: 2, ry: 1.6, names: { kaldern: 'Velde', morrow: 'Sarvele' } },
  ],
  center: { kind: 'mill', cy: 18, names: { kaldern: 'Velder Mühle', morrow: 'Mühle Velava' } },
  bulges: [{ y0: 14, y1: 24, dx: 1 }],
  strong: [3, 12],
  wireGaps: [7, 30],
  comm: [8, 22, 32],
  notes: [{ text: 'nach Regen knietief', x: 34, y: 25.6, to: [30, 21], rotate: 2 }],
  blurb: 'Eine Bachniederung teilt das Niemandsland, die Mühle liegt mitten im Sumpf. Wer sie hält, sieht beide Ufer.',
};

const KRAEHENHOLZ = {
  id: 'kraehenholz', name: 'Krähenholz', seed: 1717, width: W, height: H, symmetry: 'punkt',
  title: 'Lagekarte Krähenholz', blatt: 'Blatt 1',
  etappe: 15, stellung: 10, wobble: 1, river: false,
  hills: [
    { cx: 12, cy: 30, rx: 6, ry: 4, peak: 1.6, named: true, names: { kaldern: 'Reetberg', morrow: 'Lapvakalns' } },
  ],
  dips: [],
  swamps: [],
  // Buchenwald vor der Linie, bis ins Niemandsland: nachts sieht man darin kaum drei Felder
  woods: [
    { cx: 26, cy: 11, rx: 4.6, ry: 5, rough: 0.3, names: { kaldern: 'Krähenholz', morrow: 'Varna-Wald' } },
    { cx: 5, cy: 6, rx: 5, ry: 3.4, names: { kaldern: 'Möwenbusch', morrow: 'Girrala-Wald' } },
    { cx: 18, cy: 34, rx: 2.4, ry: 2, rough: 0.35, named: false },
  ],
  villages: [
    { cx: 8, cy: 18, rx: 2.4, ry: 2.2, names: { kaldern: 'Brookdorp', morrow: 'Zirlane' } },
  ],
  center: { kind: 'farm', cy: 20, names: { kaldern: 'Hof Ubben', morrow: 'Gut Strazdin' } },
  bulges: [{ y0: 6, y1: 15, dx: 1 }],
  strong: [24, 33],
  wireGaps: [16, 27],
  comm: [8, 20, 31],
  notes: [{ text: 'Krähen fliegen auf = Patrouille', x: 21, y: 3.4, to: [25, 8], rotate: -3 }],
  blurb: 'Ein Buchenwald reicht von beiden Seiten ins Niemandsland. Dazwischen ein Hof, um den sich alle streiten.',
};

const SCHACHT = {
  id: 'schacht', name: 'Schacht Drei', seed: 3303, width: W, height: H, symmetry: 'punkt',
  title: 'Lagekarte Schacht Drei', blatt: 'Blatt 7',
  etappe: 15, stellung: 9, wobble: 1, river: false,
  hills: [
    { cx: 18, cy: 8, rx: 4, ry: 3, peak: 1.4 },
    { cx: 8, cy: 30, rx: 5, ry: 3.6, peak: 1.6, named: true, names: { kaldern: 'Kreidebült', morrow: 'Kalnakalns' } },
  ],
  dips: [{ cx: 27, cy: 33, rx: 3.5, ry: 2.6, depth: 1 }],
  swamps: [],
  chalk: [{ cx: 22, cy: 26, rx: 3, ry: 2.2 }, { cx: 12, cy: 12, rx: 2.4, ry: 2 }],
  woods: [{ cx: 4, cy: 4, rx: 4, ry: 2.6, names: { kaldern: 'Kolkholt', morrow: 'Dubmana-Wald' } }],
  villages: [
    { cx: 7, cy: 19, rx: 2.8, ry: 2.6, names: { kaldern: 'Grauwarf', morrow: 'Daugava' } },
  ],
  // Abraumhalde auf der Mittellinie: der hoechste Punkt weit und breit
  center: { kind: 'hill', cy: 20, rx: 4.5, ry: 4, peak: 2.6, names: { kaldern: 'Halde Drei', morrow: 'Ravelsker Halde' } },
  bulges: [{ y0: 26, y1: 34, dx: 1 }],
  strong: [15, 25],
  wireGaps: [11, 30],
  comm: [9, 20, 31],
  notes: [{ text: 'Stollen? nachts horchen', x: 33.5, y: 13.6, to: [30.4, 17.4], rotate: -2 }],
  blurb: 'Kreide und Abraum. Die Halde der alten Grube steht genau zwischen den Linien und überragt alles.',
};

export const BATTLE_MAPS = [
  {
    id: 'asse', name: 'Asse-Nord', kind: 'file', scenario: 'asse-frei',
    blurb: 'Der Abschnitt der Kampagne. Kaldern hält das Ufer der Asse, Morrow den Hügel 214. Nicht gespiegelt: drüben stehen weniger, aber besser eingegraben.',
  },
  { id: 'velde', name: 'Velder Mühle', kind: 'spec', spec: VELDE, blurb: VELDE.blurb },
  { id: 'kraehenholz', name: 'Krähenholz', kind: 'spec', spec: KRAEHENHOLZ, blurb: KRAEHENHOLZ.blurb },
  { id: 'schacht', name: 'Schacht Drei', kind: 'spec', spec: SCHACHT, blurb: SCHACHT.blurb },
];

export function battleMap(id) {
  return BATTLE_MAPS.find((m) => m.id === id) ?? null;
}
