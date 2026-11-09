// Verweigerung (Plan 2.6, 4.2 Nr. 23, Paket P26). Rein: kein DOM, kein Date, kein Math.random.
// Laeuft gleich nach den Befehlen (vor Artillerie und Wetter), in beiden Rundenarten:
//   - Ein Sturm (Angriff ansetzen in der Stellungsrunde, Sturm aus dem eigenen Graben im Gefecht) mit erwarteten
//     Verlusten ab 50 Prozent wird verweigert, wenn die Seite verweigert (js/refusal.js). Der Befehl wird zu Halten.
//     Harms vermittelt einmal je Mission, Brandt geht selbst vor.
//   - Ohne Verweigerung kostet ein solcher Sturm in den Kampagnen-Missionen von Akt 4 Vertrauen (Plan 2.6 "Sturm trotz Vorschau-Warnung").
// Ausserdem: Harms und Brandt staerken Moralproben in ihrer Naehe (Plan 2.4).
import { registerPhase, ORDER } from './registry.js';
import { registerModifier } from '../modifiers.js';
import { cellLabel, distance } from '../map.js';
import { SIDES } from '../state.js';
import { visibleEnemies } from '../sight.js';
import { liveCell, mapSideOf } from './move.js';
import { refusalFor, harmsOf, brandtOf, knownFoes } from '../refusal.js';
import { REFUSAL } from '../config/akt4.js';
import { groupLabel } from '../harm.js';

registerModifier('check', 'harms', ({ state, group }) => {
  const h = harmsOf(state, group?.side);
  return h && distance(h.g.pos, group.pos) <= REFUSAL.harmsAura ? REFUSAL.harmsCheck : null;
});
registerModifier('check', 'brandt', ({ state, group }) => {
  const b = brandtOf(state, group?.side);
  return b && distance(b.pos, group.pos) <= REFUSAL.brandtReach ? REFUSAL.brandtCheck : null;
});

/** Beginnt der Sturm aus dem eigenen Graben (oder ist es ein angesetzter Angriff)? */
function fresh(ctx, g, o) {
  if (o.type === 'attack') return true;
  const c = liveCell(ctx.map, ctx.state, g.pos.x, g.pos.y);
  return !!(c?.trench && c.trench.side === mapSideOf(g.side) && !c.trench.captured);
}

function runRefusal(ctx) {
  const { state, map } = ctx;
  // Die Bleistiftnotiz "verweigert" gilt nur fuer die Runde der Verweigerung
  for (const g of state.groups) if (g.refused) delete g.refused;
  for (const side of SIDES) {
    const st = state.sides[side];
    if (!st) continue;
    const list = ctx.allOrders.filter((o) => (o.type === 'attack' || o.type === 'assault') && o.path?.length)
      .map((o) => ({ o, g: ctx.group(o.group) }))
      .filter(({ g }) => g && g.side === side && g.status !== 'lost');
    if (!list.length) continue;
    const seen = visibleEnemies(state, map, side);
    let warnedTrust = 0;
    for (const { o, g } of list) {
      if (!fresh(ctx, g, o)) continue;
      const r = refusalFor(map, state, g, o.path, knownFoes(map, state, side, seen, o.path[o.path.length - 1]));
      if (!r.warn) continue;
      const dest = o.path[o.path.length - 1];
      if (r.outcome === 'refuse') {
        o.type = 'hold';
        delete o.path;
        o.refused = true;
        g.refused = true;
        g.morale = Math.max(0, (g.morale ?? 70) - REFUSAL.refusedMorale);
        st.refusals = (st.refusals | 0) + 1;
        ctx.emit('assault_refused', {
          side, group: g.id, secret: true, pct: r.pct,
          reason: `${groupLabel(g)} lehnt die Gewehre an die Grabenwand. Sturm auf ${cellLabel(dest.x, dest.y)} verweigert: ${r.why}.`,
          at: { ...g.pos },
        });
        continue;
      }
      if (r.outcome === 'harms') {
        st.harms = { ...st.harms, used: true, turn: ctx.turn };
        const h = harmsOf(state, side);
        ctx.emit('harms_mediated', {
          side, group: g.id, secret: true, pct: r.pct, harms: h?.g.id ?? null,
          reason: `${groupLabel(g)} will nicht mehr. Harms setzt sich zu ihnen, die kalte Pfeife im Mund. Danach gehen sie. Ein zweites Mal kann er das nicht.`,
          at: { ...g.pos },
        });
      } else if (r.outcome === 'brandt') {
        ctx.emit('refusal_brandt', {
          side, group: g.id, secret: true, pct: r.pct,
          reason: `${groupLabel(g)} sieht Brandt vorgehen und steigt hinter ihr aus dem Graben, ohne dass jemand etwas befiehlt.`,
          at: { ...g.pos },
        });
      } else if (st.campaign && /^akt4-/.test(state.scenario?.id ?? '') && warnedTrust < REFUSAL.warnedTrustMax) {
        // Sturm trotz Warnung der Vorschau: die Truppe merkt es sich (Plan 2.6)
        warnedTrust += REFUSAL.warnedTrust;
        st.trust = Math.max(0, (st.trust ?? 50) - REFUSAL.warnedTrust);
        ctx.emit('assault_warned', {
          side, group: g.id, secret: true, pct: r.pct,
          reason: `${groupLabel(g)} geht gegen die Warnung (erwartete Verluste etwa ${r.pct} Prozent). Die Truppe merkt sich das, Vertrauen −${REFUSAL.warnedTrust}.`,
          at: { ...g.pos },
        });
      }
    }
  }
}

registerPhase({
  id: 'refusal', kind: 'both',
  order: { position: ORDER.position.orders + 5, battle: ORDER.battle.orders + 5 },
  run: runRefusal,
});
