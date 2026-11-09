// Dunkelheit (0..1) aus der Spieluhr fuer das Kartenthema (Plan 7.7). Rein.
// Tag und Nacht sind Spielzustand (state.night): Stellungsrunden dauern 12 Stunden und wechseln Tag und Nacht,
// Gefechtsrunden erben die Tageszeit ihrer Stellungsrunde, auch wenn die Uhr waehrend des Angriffs ueber 18 oder
// 6 Uhr laeuft (Plan 7.7: "Ein Angriff, der bei Nacht angesetzt wird, bleibt Nacht").
// Ohne Angabe von night (alte Aufrufe) gilt die Uhr: Stellung ganz Tag oder Nacht, Gefecht mit Daemmerung
// von 5 bis 7 und 17 bis 19 Uhr.
export function darknessAt(clock, turnKind = 'position', night = null) {
  if (night !== null && night !== undefined) return night ? 1 : 0;
  const m = clock.hour * 60 + clock.minute;
  if (turnKind !== 'battle') return clock.hour >= 18 || clock.hour < 6 ? 1 : 0;
  if (m >= 7 * 60 && m <= 17 * 60) return 0;
  if (m >= 19 * 60 || m <= 5 * 60) return 1;
  if (m < 7 * 60) return (7 * 60 - m) / 120;
  return (m - 17 * 60) / 120;
}
