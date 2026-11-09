// Feldzugskarte (P14): Orte des Abschnitts Asse-Nord (data/texts/welt.md) und wo welche Mission spielt.
// Koordinaten 0..1 auf dem Kartentisch, Westen links (Etappe), Osten rechts (Morrow). Reine Daten.

export const PLACES = [
  { id: 'haverstadt', label: 'Stab (Haverstadt-Land)', x: 0.09, y: 0.07, kind: 'staff' },
  { id: 'ostervenn', label: 'Ostervenn', x: 0.13, y: 0.5, kind: 'village' },
  { id: 'faehrhaus', label: 'Fährhaus', x: 0.255, y: 0.62, kind: 'house' },
  { id: 'ziegelei', label: 'Ziegelei Tamm', x: 0.2, y: 0.28, kind: 'house' },
  { id: 'velde', label: 'Velde', x: 0.4, y: 0.48, kind: 'village' },
  { id: 'muehle', label: 'Velder Mühle', x: 0.37, y: 0.68, kind: 'house' },
  { id: 'kraehenholz', label: 'Krähenholz', x: 0.47, y: 0.15, kind: 'forest' },
  { id: 'kuhle', label: 'Lehmkuhle', x: 0.53, y: 0.7, kind: 'hollow' },
  { id: 'heuwagen', label: 'Heuwagen', x: 0.6, y: 0.5, kind: 'mark' },
  { id: 'kroning', label: 'Gehöft Kroning', x: 0.62, y: 0.82, kind: 'house' },
  { id: 'huegel', label: 'Hügel 214', x: 0.65, y: 0.28, kind: 'hill' },
  { id: 'bahndamm', label: 'Alter Bahndamm', x: 0.4, y: 0.88, kind: 'mark' },
  { id: 'schacht', label: 'Schacht Drei', x: 0.84, y: 0.17, kind: 'tower' },
  { id: 'raudas', label: 'Raudas', x: 0.85, y: 0.62, kind: 'village' },
  { id: 'zelva', label: 'Zelva-Wald', x: 0.92, y: 0.4, kind: 'forest' },
];

/** Fluss Asse als Stuetzpunkte (x, y), von Nord nach Sued */
export const RIVER = [[0.27, 0], [0.25, 0.14], [0.28, 0.3], [0.26, 0.46], [0.29, 0.6], [0.27, 0.76], [0.3, 0.9], [0.28, 1]];

/** Eigene Linie zu Beginn (x je Hoehe) und Abstand eines Front-Schritts; die feindliche liegt LINE_GAP weiter */
export const FRONT_X = 0.47;
export const FRONT_STEP = 0.022;
export const LINE_GAP = 0.25;

/** Ort jeder Mission (Briefings in data/texts/akt*.json) */
export const MISSION_PLACES = {
  a1m1: 'velde', a1m2: 'velde', a1m3: 'ostervenn', a1m4: 'ostervenn', a1m5: 'kuhle', a1m6: 'velde',
  a2m1: 'huegel', a2m2: 'huegel', a2m3: 'velde', a2m4: 'huegel', a2m5: 'heuwagen', a2m6: 'huegel',
  a3m1: 'muehle', a3m2: 'kraehenholz', a3m3: 'ziegelei', a3m4: 'kroning', a3m5: 'heuwagen', a3m6: 'raudas',
  a4m1: 'raudas', a4m2: 'raudas', a4m3: 'huegel', a4m4: 'bahndamm', a4m5: 'faehrhaus', a4m6: 'velde',
};
