// Kampagne im Gefecht (P14, Plan 2.6): nur wenn die Seite aus der Kampagne kommt (state.sides[s].campaign).
// - Vertrauen unter 10: Meuterei. Die Gruppen bleiben in den Unterstaenden, die Mission ist verloren (einmal je Mission).
// - Ansehen unter 25: Der Stab droht mit Abloesung (einmal je Mission, als Zeile im Telegramm).
// Laeuft nach der Moral (dort aendert sich das Vertrauen), in beiden Rundenarten.
import { registerPhase, ORDER } from './registry.js';
import { SIDES } from '../state.js';

export const MUTINY_BELOW = 10;
export const THREAT_BELOW = 25;

function centerOf(state, side) {
  const own = state.groups.filter((g) => g.side === side && g.status !== 'lost').sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!own.length) return { x: 0, y: 0 };
  const x = Math.floor(own.reduce((n, g) => n + g.pos.x, 0) / own.length);
  const y = Math.floor(own.reduce((n, g) => n + g.pos.y, 0) / own.length);
  return { x, y };
}

export function runCampaign(ctx) {
  const state = ctx.state;
  for (const side of SIDES) {
    const s = state.sides[side];
    if (!s?.campaign) continue;
    if (!s.mutiny && (s.trust ?? 50) < MUTINY_BELOW) {
      s.mutiny = ctx.turn;
      ctx.emit('mutiny', {
        side, secret: true, trust: s.trust,
        reason: `Vertrauen ${s.trust}: Die Gruppen kommen nicht mehr aus den Unterständen. Sie halten den Graben, aber sie gehen nirgends mehr hin. Die Mission ist verloren.`,
        at: centerOf(state, side),
      });
    }
    if (!s.campaign.threatened && (s.reputation ?? 50) < THREAT_BELOW) {
      s.campaign = { ...s.campaign, threatened: ctx.turn };
      ctx.emit('staff_threat', {
        side, secret: true, reputation: s.reputation,
        reason: `Ansehen ${s.reputation}: Der Stab fragt an, ob die Abschnittsführung „der Lage gewachsen“ sei. Unter 10 wird abgelöst.`,
        at: centerOf(state, side),
      });
    }
  }
}

registerPhase({ id: 'campaign', kind: 'both', order: { position: ORDER.position.morale + 5, battle: ORDER.battle.morale + 5 }, run: runCampaign });
