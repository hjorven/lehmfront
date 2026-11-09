// Verluste ausserhalb von Feuer und Nahkampf melden (P23: Sprengung, Stosstrupp, verschuetteter Stollen).
// Gleiches Format wie js/phases/fire.js: Ereignis 'losses' (die Phase casualties macht daraus Verwundete),
// aufgeriebene Gruppen landen mit Gruppenfuehrer in state.fallen. Rein: kein DOM, kein Date, kein Math.random.
import { surname } from './phases/hold.js';

export const groupLabel = (g) => 'Gruppe ' + surname(g.leader.name);

/**
 * Verluste zufuegen. Liefert die tatsaechliche Zahl. extra: weitere Felder fuer das Ereignis (cause, public, at ...).
 */
export function inflictLosses(ctx, g, amount, reason, extra = {}) {
  const n = Math.max(0, Math.min(g.strength, Math.floor(amount)));
  if (n <= 0) return 0;
  g.strength -= n;
  const { at, ...rest } = extra; // at: Ort des Geschehens, wenn die Gruppe nicht dort steht (Stosstrupp)
  ctx.emit('losses', { side: g.side, group: g.id, amount: n, cause: extra.cause ?? 'other', reason, ...rest, at: { ...(at ?? g.pos) } });
  if (g.strength <= 0) {
    g.strength = 0;
    g.status = 'lost';
    ctx.state.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos }, cause: extra.cause ?? 'other' });
    ctx.emit('group_lost', {
      side: g.side, group: g.id, public: true,
      reason: `${groupLabel(g)} ist aufgerieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
      at: { ...g.pos },
    });
  }
  return n;
}

/** Ganze Zahl zwischen lo und hi (inklusive) aus ctx.rng */
export function roll(rng, lo, hi) {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
