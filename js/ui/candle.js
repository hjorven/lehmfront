// Kerze als Frist (P20, Ueberraschung): Online-Gefechte haben 48 Stunden je Stellungsrunde. Statt einer
// Uhr brennt im Fernsprechamt eine Kerze herunter; ist sie aus, gilt "Halten" fuer die, die nichts geschickt haben.
import { DEADLINE_HOURS } from '../online/match.js';

/** Restanteil 0..1 und Text ("noch 31 Std.") einer Frist */
export function deadlineLeft(deadline, turnKind = 'position', now = Date.now()) {
  if (!deadline) return { part: 1, text: '' };
  const total = (DEADLINE_HOURS[turnKind] ?? 48) * 3600 * 1000;
  const left = Date.parse(deadline) - now;
  if (!(left > 0)) return { part: 0, text: 'Frist verstrichen' };
  const h = Math.floor(left / 3600000);
  const text = h >= 1 ? `noch ${h} Std.` : `noch ${Math.max(1, Math.ceil(left / 60000))} Min.`;
  return { part: Math.max(0.04, Math.min(1, left / total)), text };
}

/** HTML einer Kerze, die mit der Frist abbrennt */
export function candle(deadline, turnKind = 'position', now = Date.now()) {
  const { part, text } = deadlineLeft(deadline, turnKind, now);
  const wax = Math.round(6 + part * 40); // Hoehe in px
  const out = part === 0;
  return `<span class="fa-candle${out ? ' out' : ''}" role="img" aria-label="Frist: ${text || 'offen'}">
    <svg viewBox="0 0 28 64" width="28" height="64" aria-hidden="true">
      ${out ? '<path class="smoke" d="M14 ' + (58 - wax) + ' q-4 -6 0 -10 q4 -5 0 -10" fill="none"/>' : `<path class="flame" d="M14 ${55 - wax} q-5 -5 0 -13 q5 8 0 13z"/>`}
      <line class="wick" x1="14" y1="${58 - wax}" x2="14" y2="${55 - wax}"/>
      <rect class="wax" x="9" y="${58 - wax}" width="10" height="${wax}" rx="1.5"/>
      <path class="drip" d="M9 ${60 - wax} q-1.5 5 0 7" fill="none"/>
      <path class="dish" d="M3 58 h22 l-3 4 h-16z"/>
    </svg>
    <small>${text}</small>
  </span>`;
}
