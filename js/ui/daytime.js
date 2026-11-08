// Dunkelheit (0..1) aus der Spieluhr fuer das Kartenthema (Plan 7.7). Rein.
// Stellungsrunden dauern 12 Stunden und zeigen Tag oder Nacht ganz. Gefechtsrunden (5 Minuten) laufen durch
// die Daemmerung: von 5 bis 7 Uhr wird es hell, von 17 bis 19 Uhr dunkel.
export function darknessAt(clock, turnKind = 'position', night = null) {
  const m = clock.hour * 60 + clock.minute;
  if (turnKind !== 'battle') {
    const isNight = night ?? (clock.hour >= 18 || clock.hour < 6);
    return isNight ? 1 : 0;
  }
  if (m >= 7 * 60 && m <= 17 * 60) return 0;
  if (m >= 19 * 60 || m <= 5 * 60) return 1;
  if (m < 7 * 60) return (7 * 60 - m) / 120;
  return (m - 17 * 60) / 120;
}
