// Versorgung (Plan 4.1 Nr. 10, Plan 10.6 Stellungsrunde Schritt 7): Loren fahren, Gueter nach vorn,
// Verwundete zurueck, Vorraete der Abschnitte, Sanitaetskette. Die Regeln stehen in js/supply.js.
// Der Lorenplan ist ein Seitenbefehl: { type: 'supply_plan', wagons: [{ load, to }] }. Ohne Plan gilt der
// Plan der letzten Runde, in der ersten Runde ein Vorschlag (die Platzhalter-KI schickt keinen).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { runSupplySide, addWounded } from '../supply.js';
import { LOADS } from '../config/supply.js';

registerOrderValidator('supply_plan', (order, group, state) => {
  if (!Array.isArray(order.wagons)) return 'Lorenplan ohne Wagen';
  if (order.wagons.length > 64) return 'Lorenplan ist zu lang';
  for (const w of order.wagons) {
    if (!w || !Object.hasOwn(LOADS, w.load)) return 'unbekannte Ladung im Lorenplan';
    if (typeof w.to !== 'string' || !/^[A-H]$/.test(w.to)) return 'Lorenplan mit unbekanntem Abschnitt';
  }
  return null;
});

/** Anteil der Verluste, die verwundet statt gefallen sind (in Prozent) */
export const WOUNDED_PERCENT = 60;

// Verluste aus Feuer, Nahkampf und Artillerie (Ereignisse 'losses' dieser Runde) teilen sich in Gefallene und
// Verwundete. Die Verwundeten warten im Abschnitt auf eine Lore (Sanitaetskette). Laeuft nach Feuer und Nahkampf.
registerPhase({
  id: 'casualties',
  kind: 'both',
  order: { position: ORDER.position.supply - 5, battle: ORDER.battle.melee + 5 },
  run(ctx) {
    if (!ctx.map) return;
    const losses = ctx.log.filter((e) => e.type === 'losses' && e.amount > 0 && e.group && e.side);
    for (const e of losses) {
      let n = 0;
      for (let i = 0; i < e.amount; i++) if (Math.floor(ctx.rng() * 100) < WOUNDED_PERCENT) n++;
      if (!n) continue;
      const sec = addWounded(ctx.state, ctx.map, e.side, e.at, n, e.group);
      ctx.emit('wounded', {
        side: e.side, group: e.group, secret: true, minor: true, count: n, section: sec,
        reason: `${n === 1 ? 'Ein Verwundeter' : n + ' Verwundete'} von ${e.amount} ${e.amount === 1 ? 'Ausfall' : 'Ausfällen'} ${n === 1 ? 'liegt' : 'liegen'} im Unterstand von Abschnitt ${sec} und ${n === 1 ? 'wartet' : 'warten'} auf eine Lore.`,
        at: e.at,
      });
    }
  },
});

registerPhase({
  id: 'supply',
  kind: 'position',
  order: ORDER.position.supply,
  run(ctx) {
    if (!ctx.map) return; // ohne Karte (reine Regeltests) keine Versorgung
    for (const side of ['a', 'b']) {
      const order = ctx.planOf(side, 'supply_plan');
      runSupplySide(ctx.state, side, {
        map: ctx.map, turn: ctx.turn, rng: ctx.rng, emit: ctx.emit,
        plan: order ? order.wagons : null,
      });
    }
  },
});

