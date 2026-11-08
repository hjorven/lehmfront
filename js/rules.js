// Reine Spielregeln. Nur Grundrechenarten, keine Date/Math.random/DOM (Plan 10.7).

export const COVER = {
  open: 0,
  crater: 0.35,
  foxhole: 0.45,
  trench: 0.6,
  trench_improved: 0.7,
  trench_concrete: 0.8,
};

/**
 * Wirksame Deckung eines Feldes.
 * reversed: eroberter Graben, Schuetzenauftritt zeigt in die falsche Richtung
 * enfilade: Laengsfeuer entlang eines Grabens ohne Traverse
 */
export function coverValue(cover, { enfilade = false, reversed = false } = {}) {
  let c = COVER[cover] ?? 0;
  if (reversed) c *= 0.5;
  if (enfilade) c *= 0.3;
  return c;
}

/**
 * Trefferchance eines Schusses einer Gruppe auf eine andere.
 * distance in Feldern, visibility 0..1 (Nacht, Nebel, Rauch), suppressed 0..1, experience 0..4
 */
export function hitChance({ distance, range, cover, visibility, experience, suppressed, enfilade = false, reversed = false }) {
  if (distance > range || visibility <= 0) return 0;

  const rangeFactor = 1 - (distance / range) * 0.6;
  const skill = 0.8 + experience * 0.1;
  const shakiness = 1 - suppressed * 0.6;

  const p = 0.35 * rangeFactor * (1 - coverValue(cover, { enfilade, reversed })) * visibility * skill * shakiness;
  return Math.max(0, Math.min(0.95, p));
}

/** Sichtweite aus Dunkelheit (Plan 7.7): Optik und Regel haengen am selben Wert */
export function visibilityFromDarkness(darkness) {
  const d = Math.max(0, Math.min(1, darkness));
  return 1 - 0.6 * d;
}

/** Feuer einer Gruppe ausfuehren: Verluste und Unterdrueckung beim Ziel */
export function resolveFire(rng, shooter, target, ctx) {
  if (target.inDugout) return { hits: 0, suppression: target.suppressed, reason: 'Ziel im Unterstand' };

  const p = hitChance({
    distance: ctx.distance,
    range: shooter.range,
    cover: target.cover,
    visibility: ctx.visibility,
    experience: shooter.experience,
    suppressed: shooter.suppressed,
    enfilade: ctx.enfilade,
    reversed: target.reversed,
  });

  let hits = 0;
  for (let i = 0; i < shooter.shots; i++) {
    if (rng() < p) hits++;
  }

  const suppression = Math.min(1, target.suppressed + shooter.shots * shooter.suppressionPerShot + hits * 0.1);
  const reason = ctx.enfilade ? 'Längsfeuer, Graben ohne Traverse' : target.reversed ? 'eroberter Graben noch nicht umgebaut' : null;
  return { hits, suppression, reason };
}
