// Puzzle-Lagen (P25): Reihenfolge der zwoelf Lagen unter data/puzzles/. Neue Lage: Datei anlegen, hier eintragen.
export const PUZZLES = [
  '01-laengsfeuer',
  '02-totraum',
  '03-draht',
  '04-unterstand',
  '05-gegenstoss',
  '06-traversen',
  '07-hoehe',
  '08-draht-legen',
  '09-rueckzug',
  '10-sektor',
  '11-verlegen',
  '12-keil',
];

export function puzzleFile(id) {
  return PUZZLES.includes(id) ? `data/puzzles/${id}.json` : null;
}
