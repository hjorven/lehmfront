// Register fuer die dynamische Ebene (P04). Mechanik-Pakete zeichnen hier, ohne units-layer.js umzuschreiben:
// - registerDecor({ id, order?, draw(ctx, d) }): immer sichtbare Zeichnung unter den Befehlen und Symbolen
//   (z. B. frischer Aufwurf, abgesteckte Grabenfelder, eroberte Graeben). Reihenfolge nach order, dann id.
// - registerOrderPainter(type, fn(ctx, { group, order, th, px, progress, d })): eigener Befehlsstrich fuer eine
//   Befehlsart mit path (statt des Bewegungspfeils), z. B. ein geplanter Graben. Rueckgabe true = gezeichnet.
// d ist das Zeichenmodell aus drawBattle (state, map, side, groups, orders, cam, theme ...).
const decors = new Map();
const painters = new Map();

export function registerDecor(decor) {
  if (!decor?.id || typeof decor.draw !== 'function') throw new Error('Decor braucht id und draw(ctx, d)');
  decors.set(decor.id, { order: 100, ...decor });
}

export function unregisterDecor(id) {
  decors.delete(id);
}

export function allDecors() {
  return [...decors.values()].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function registerOrderPainter(type, fn) {
  if (typeof fn !== 'function') throw new Error('Painter braucht eine Funktion');
  painters.set(type, fn);
}

export function orderPainter(type) {
  return painters.get(type) ?? null;
}
