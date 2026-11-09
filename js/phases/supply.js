// Versorgung (Plan 4.1 Nr. 10, Plan 10.6 Stellungsrunde Schritt 7): Loren fahren, Gueter nach vorn,
// Verwundete zurueck, Vorraete der Abschnitte, Sanitaetskette. Die Regeln stehen in js/supply.js.
// Der Lorenplan ist ein Seitenbefehl: { type: 'supply_plan', wagons: [{ load, to }] }. Ohne Plan gilt der
// Plan der letzten Runde, in der ersten Runde ein Vorschlag (die Platzhalter-KI schickt keinen).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { runSupplySide } from '../supply.js';
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

