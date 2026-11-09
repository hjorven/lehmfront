// KI-Kommandant (Plan 2.4, 13, Paket P13): Lagen, Doktrinen und Schwierigkeiten. Reine Daten, keine Logik.
// Die Regeln stehen in js/ai.js. Prozentwerte sind ganze Zahlen, damit die KI ohne Brueche rechnet.

/** Lagen: was der Kommandant gerade vorhat */
export const POSTURES = {
  halten:      { id: 'halten',      label: 'Halten',      verb: 'hält die Linie' },
  vorbereiten: { id: 'vorbereiten', label: 'Vorbereiten', verb: 'bereitet einen Angriff vor' },
  sturm:       { id: 'sturm',       label: 'Sturm',       verb: 'greift an' },
  gegenstoss:  { id: 'gegenstoss',  label: 'Gegenstoß',   verb: 'stößt gegen' },
};

/**
 * Doktrinen (welt.md "Lasks Doktrinen", eine je Akt).
 *   attackRatio: eigene Kampfkraft in Prozent der geschaetzten feindlichen, ab der angegriffen wird
 *   prepareRatio: ab hier wird vorbereitet (darunter: halten)
 *   prepTurns: Stellungsrunden Vorbereitung vor dem Sturm
 *   restTurns: Stellungsrunden Pause nach einem Gefecht
 *   assaultShare: Anteil der sturmfaehigen Gruppen, die stuermen (Prozent), reserve: so viele bleiben immer zurueck
 *   persistence: Verluste der Sturmgruppen in Prozent, ab denen der Sturm abgebrochen wird
 *   nightOnly: greift nur bei Dunkelheit an
 *   artillery: welche Feuerplaene die Doktrin nutzt
 *   counterRatio: Kampfkraft in Prozent, ab der ein verlorener Graben im Gegenstoss zurueckgeholt wird
 *   depth: haelt Reserven hinten (tiefe Verteidigung) statt alles in den vorderen Graben zu stellen
 */
export const DOCTRINES = {
  ausgewogen: {
    id: 'ausgewogen', label: 'Ausgewogen', act: 0,
    attackRatio: 130, prepareRatio: 100, prepTurns: 2, restTurns: 2, assaultShare: 60, reserve: 1,
    persistence: 55, nightOnly: false, counterRatio: 70, depth: false,
    artillery: { barrage: true, harass: true, counter: true, prep: true, creep: false },
    motto: 'Erst sehen, dann gehen.',
  },
  masse: {
    id: 'masse', label: 'Masse', act: 1,
    attackRatio: 105, prepareRatio: 85, prepTurns: 1, restTurns: 1, assaultShare: 100, reserve: 0,
    persistence: 75, nightOnly: false, counterRatio: 60, depth: false,
    artillery: { barrage: true, harass: false, counter: false, prep: true, creep: false },
    motto: 'Der Stab zählt Köpfe, nicht Gräben.',
  },
  nacht: {
    id: 'nacht', label: 'Nachtangriffe', act: 2,
    attackRatio: 110, prepareRatio: 80, prepTurns: 1, restTurns: 1, assaultShare: 60, reserve: 1,
    persistence: 50, nightOnly: true, counterRatio: 70, depth: false,
    artillery: { barrage: true, harass: true, counter: false, prep: false, creep: false },
    motto: 'Wir lernen, im Dunkeln zu sehen.',
  },
  material: {
    id: 'material', label: 'Materialschlacht', act: 3,
    attackRatio: 120, prepareRatio: 90, prepTurns: 3, restTurns: 2, assaultShare: 50, reserve: 1,
    persistence: 45, nightOnly: false, counterRatio: 80, depth: false,
    artillery: { barrage: true, harass: true, counter: true, prep: true, creep: true },
    motto: 'Granaten statt Menschen.',
  },
  tiefe: {
    id: 'tiefe', label: 'Tiefe Verteidigung', act: 4,
    attackRatio: 170, prepareRatio: 140, prepTurns: 2, restTurns: 3, assaultShare: 50, reserve: 2,
    persistence: 40, nightOnly: false, counterRatio: 50, depth: true,
    artillery: { barrage: true, harass: true, counter: true, prep: true, creep: false },
    motto: 'Wir geben vorn nach, damit hinten etwas hält.',
  },
};

/** Doktrin eines Akts (Lask wechselt sie pro Akt, Plan 2.4) */
export function doctrineForAct(act) {
  return Object.values(DOCTRINES).find((d) => d.act === act) ?? DOCTRINES.ausgewogen;
}

/**
 * Schwierigkeiten. Alle arbeiten auf derselben gefilterten Sicht (kein Schummeln); sie unterscheiden sich darin,
 * wie gruendlich der Kommandant liest und plant.
 *   ghostAge: Geister bis zu diesem Alter (Runden) zaehlen als Feind
 *   noise: Unsicherheit beim Schaetzen der Kraefte und bei der Wahl des Ziels (Prozent)
 *   slip: Chance in Prozent, dass eine Gruppe ihren Befehl verschlaeft (haelt)
 *   mgAware, wireAware: weicht bekannten MG-Kegeln und Draht beim Sturmweg aus
 *   flares, observers, rearrange: nutzt Leuchtkugeln, stellt Beobachter um, verteilt Gruppen auf die Front
 *   coordinate: legt Feuerwalze und Sturm aufeinander, laesst Niedergehaltene liegen statt sie weiter zu treiben
 */
export const DIFFICULTIES = {
  rekrut: {
    id: 'rekrut', label: 'Rekrut', ghostAge: 2, noise: 30, slip: 20,
    mgAware: false, wireAware: false, flares: false, observers: false, rearrange: false, coordinate: false,
    artillery: { barrage: true, harass: false, counter: false, prep: true, creep: false },
  },
  veteran: {
    id: 'veteran', label: 'Veteran', ghostAge: 5, noise: 10, slip: 5,
    mgAware: true, wireAware: true, flares: true, observers: true, rearrange: true, coordinate: false,
    artillery: { barrage: true, harass: true, counter: false, prep: true, creep: true },
  },
  lask: {
    id: 'lask', label: 'Lask', ghostAge: 8, noise: 0, slip: 0,
    mgAware: true, wireAware: true, flares: true, observers: true, rearrange: true, coordinate: true,
    artillery: { barrage: true, harass: true, counter: true, prep: true, creep: true },
  },
};

export const DEFAULT_DIFFICULTY = 'veteran';
export const DEFAULT_DOCTRINE = 'ausgewogen';
