// Overlay-Register (Plan 7.4, Tasten 1 bis 4). Vier feste Plaetze; Mechanik-Pakete fuellen sie mit
// registerOverlay({ id, slot, label, draw(ctx, view) }). Leere Plaetze zeigen "in Arbeit".
//   draw(ctx, { cam, theme, map, state, side, px }) zeichnet in Weltkoordinaten (1 = ein Feld), px = ein Bildschirmpixel.
export const SLOTS = [
  { slot: 1, id: 'supply', label: 'Versorgung' },
  { slot: 2, id: 'threat', label: 'Bedrohung' },
  { slot: 3, id: 'sight', label: 'Sicht' },
  { slot: 4, id: 'height', label: 'Höhe' },
];

const overlays = new Map();

export function registerOverlay(o) {
  const def = SLOTS.find((s) => s.slot === o.slot);
  if (!def) throw new Error('Overlay braucht einen Platz 1 bis 4');
  if (typeof o.draw !== 'function') throw new Error('Overlay braucht draw(ctx, view)');
  overlays.set(o.slot, { ...def, ...o });
}

export function unregisterOverlay(slot) {
  overlays.delete(slot);
}

/** Alle vier Plaetze mit Inhalt oder Platzhalter */
export function overlaySlots() {
  return SLOTS.map((s) => overlays.get(s.slot) ?? { ...s, draw: null, empty: true });
}
