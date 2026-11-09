// Register fuer Zu- und Abschlaege auf Gruppen (P23). Mechanik-Pakete (Offiziere, Veteranen, Doktrinen ...)
// melden hier Faktoren an, statt Feuer, Nahkampf oder Moral umzuschreiben. Die Phasen fragen nur ab.
// Rein: kein DOM, kein Date, kein Math.random.
//
// Arten:
//   'melee'   Prozent auf die Kampfkraft im Nahkampf (100 = neutral), ctx { state, group, night, defending }
//   'raid'    Prozent auf die Kampfkraft eines Stosstrupps
//   'fire_xp' Zuschlag auf die Erfahrung beim Schiessen (ganze Stufen)
//   'check'   Zuschlag in Prozentpunkten auf Moralproben
//   'spot'    Zuschlag in Prozentpunkten auf die Chance, einen Stosstrupp zu entdecken (ctx: group = Posten oder Trupp)
//   'exit'    true = kommt ohne Wartezeit aus dem Unterstand
//   'dig'     Prozent auf das Grabtempo
//   'armor'   Prozent auf Treffer und Unterdrueckung eines Schusses (P26: Panzerwagen), ctx { state, map, shooter, target }
// fn(ctx) -> Zahl | null (null = keine Wirkung)
const mods = new Map(); // art -> Map(id -> fn)

export function registerModifier(kind, id, fn) {
  if (typeof fn !== 'function') throw new Error('Modifikator braucht eine Funktion');
  if (!mods.has(kind)) mods.set(kind, new Map());
  mods.get(kind).set(id, fn);
}

export function unregisterModifier(kind, id) {
  mods.get(kind)?.delete(id);
}

function each(kind, ctx) {
  const m = mods.get(kind);
  if (!m) return [];
  const out = [];
  for (const id of [...m.keys()].sort()) {
    let v = null;
    try { v = m.get(id)(ctx); } catch { v = null; }
    if (v !== null && v !== undefined && v !== false) out.push({ id, v });
  }
  return out;
}

/** Produkt aller Prozent-Faktoren als Faktor (1 = neutral) */
export function factorFor(kind, ctx) {
  let f = 100;
  for (const { v } of each(kind, ctx)) if (Number.isFinite(v)) f = Math.floor((f * v) / 100);
  return f / 100;
}

/** Summe aller Zuschlaege */
export function bonusFor(kind, ctx) {
  let s = 0;
  for (const { v } of each(kind, ctx)) if (Number.isFinite(v)) s += v;
  return s;
}

/** Trifft irgendein Modifikator zu? */
export function flagFor(kind, ctx) {
  return each(kind, ctx).some(({ v }) => v === true);
}

/** Welche Modifikatoren wirken (fuer Begruendungen): [{ id, v }] */
export function modifiersFor(kind, ctx) {
  return each(kind, ctx);
}
