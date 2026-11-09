// Panzerwagen K1, Prototyp (Plan 4.2 Nr. 24, Paket P26). Rein: kein DOM, kein Date, kein Math.random.
// Der Wagen ist eine Gruppe vom Typ tank: er walzt Draht nieder (js/phases/move.js WIRE_CRUSHERS), faehrt durch
// Graeben, Gewehre und MG richten wenig gegen ihn aus, Gruppen direkt hinter ihm sind gedeckt. Er bleibt oft
// liegen: in Trichtern, im Schlamm, in Graeben (g.stuck). Pioniere daneben koennen ihn in einer Stellungsrunde
// wieder flott machen. Die Phase steht in js/phases/tank.js.
import { TANK } from './config/akt4.js';
import { cellAt, distance, TERRAIN } from './map.js';
import { unitType } from './config/units.js';
import { mudAt } from './weather.js';

const live = (map, state, x, y) => {
  const c = map ? cellAt(map, x, y) : null;
  if (!c) return null;
  const s = state?.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
};

export const isTank = (g) => g?.type === 'tank';

/** Chance in Prozent, beim Betreten des Feldes stecken zu bleiben */
export function stuckChance(map, state, p) {
  const c = live(map, state, p.x, p.y);
  if (!c) return 0;
  const s = TANK.stuck;
  let pct = s.base;
  const crater = c.crater | 0;
  if (crater >= 2) pct += s.crater2; else if (crater === 1) pct += s.crater1;
  if (c.trench) pct += s.trench;
  if (c.wire) pct += s.wire;
  if (c.terrain === 'wald') pct += s.wood;
  if (c.terrain === 'dorf') pct += s.village;
  const mud = map ? mudAt(state, map, p.x, p.y) : 0;
  if (mud >= 2) pct += s.mud2; else if (mud === 1) pct += s.mud1;
  if ((state?.weather?.wet ?? 0) <= 0 && !crater) pct += TANK.dryBonus;
  if (c.terrain === TERRAIN.sumpf.id) pct += s.mud2;
  return Math.max(1, Math.min(90, pct));
}

/** Welche Waffen richten gegen den Wagen etwas aus? Feldgeschuetz (pierce) und Steilfeuer */
export function piercesArmor(shooter) {
  const t = unitType(shooter.type);
  return !!(t.pierce || t.indirect);
}

/** Faktor (Prozent) auf einen Schuss: Panzerung und Deckung hinter dem Wagen. null = keine Wirkung */
export function armorPct(state, shooter, target) {
  if (!shooter || !target) return null;
  if (isTank(target)) return piercesArmor(shooter) ? null : TANK.armorPct;
  // Hinter dem Wagen: ein eigener, fahrbereiter oder liegender Wagen steht direkt neben dem Ziel und naeher am Schuetzen
  const d = distance(shooter.pos, target.pos);
  const shield = (state?.groups ?? []).some((t) => isTank(t) && t.status !== 'lost' && t.side === target.side && t.id !== target.id
    && distance(t.pos, target.pos) === 1 && distance(t.pos, shooter.pos) < d);
  return shield ? TANK.shieldPct : null;
}

/** Wrack aus einer frueheren Mission (a4m2 "Der Kasten"): state.cells[k].wreck = { by, since } */
export function wreckAt(state, p) {
  return state?.cells?.[p.x + ',' + p.y]?.wreck ?? null;
}
