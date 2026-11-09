// Uhr: Stellungsrunde = 12 Stunden (Tag oder Nacht), Gefechtsrunde = 5 Minuten (Plan 3.3).
import { registerPhase, ORDER } from './registry.js';
import { isNightHour } from '../state.js';

export const POSITION_HOURS = 12;
export const BATTLE_MINUTES = 5;

export function advanceClock(clock, minutes) {
  let total = clock.hour * 60 + clock.minute + minutes;
  let day = clock.day;
  while (total >= 24 * 60) { total -= 24 * 60; day++; }
  return { day, hour: Math.floor(total / 60), minute: total % 60 };
}

registerPhase({
  id: 'clock',
  kind: 'both',
  order: { position: ORDER.position.clock, battle: ORDER.battle.clock },
  run(ctx) {
    const s = ctx.state;
    const wasNight = s.night;
    s.clock = advanceClock(s.clock, ctx.kind === 'battle' ? BATTLE_MINUTES : POSITION_HOURS * 60);
    if (ctx.kind === 'battle' && s.battle) s.battle.round = (s.battle.round ?? 0) + 1;
    // Gefechtsrunden erben die Tageszeit ihrer Stellungsrunde (Plan 7.7): nur Stellungsrunden wechseln Tag und Nacht
    if (ctx.kind !== 'battle') s.night = isNightHour(s.clock.hour);
    if (s.night !== wasNight) {
      const hh = String(s.clock.hour).padStart(2, '0') + ':' + String(s.clock.minute).padStart(2, '0');
      ctx.emit(s.night ? 'nightfall' : 'daybreak', {
        reason: s.night ? `Es wird dunkel, ${hh} Uhr. Sicht sinkt.` : `Es wird hell, ${hh} Uhr, Tag ${s.clock.day}.`,
        at: { x: Math.floor(s.map.width / 2), y: Math.floor(s.map.height / 2) },
      });
    }
  },
});
