// Jahreszeit im Gefecht (P22, Endlosmodus): Frost macht den Lehm zu Stein, das Graben dauert laenger.
// Nur wenn state.weather.season gesetzt ist (Endlosmodus); sonst meldet der Faktor nichts.
import { registerDigFactor } from './dig.js';
import { registerPhase, ORDER } from './registry.js';
import { SEASONS } from '../config/seasons.js';

registerDigFactor('jahreszeit', ({ state }) => {
  const s = SEASONS[state.weather?.season];
  if (!s || s.digPct === 100) return null;
  return { pct: s.digPct, label: s.id === 'winter' ? 'gefrorener Boden' : 'Tauwetter, der Boden gibt nach' };
});

// Stellungsrunden der laufenden Woche zaehlen (Endlosmodus): genauer als die Uhr, die Gefechtsminuten mitzaehlt
registerPhase({
  id: 'endless-rounds', kind: 'position', order: ORDER.position.clock + 1,
  run(ctx) {
    const e = ctx.state.endless;
    if (e && Number.isFinite(e.rounds)) e.rounds += 1;
  },
});
