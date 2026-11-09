// Jahreszeit im Gefecht (P22, Endlosmodus): Frost macht den Lehm zu Stein, das Graben dauert laenger.
// Nur wenn state.weather.season gesetzt ist (Endlosmodus); sonst meldet der Faktor nichts.
import { registerDigFactor } from './dig.js';
import { SEASONS } from '../config/seasons.js';

registerDigFactor('jahreszeit', ({ state }) => {
  const s = SEASONS[state.weather?.season];
  if (!s || s.digPct === 100) return null;
  return { pct: s.digPct, label: s.id === 'winter' ? 'gefrorener Boden' : 'Tauwetter, der Boden gibt nach' };
});
