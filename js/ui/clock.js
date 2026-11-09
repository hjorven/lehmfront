// Eine Uhr fuer zwei Zeitmassstaebe (Plan 7.5, Bild feature-05-uhr): In Stellungsrunden eine Tag-Nacht-Scheibe
// (24 Stunden, oben Mittag, unten Mitternacht, der Bogen zeigt die naechsten 12 Stunden). Beim Angriff wird sie zur
// Stoppuhr mit zwoelf Fuenf-Minuten-Feldern. Reine Optik: liefert SVG als Text, der Wechsel rastet per CSS ein.
import { BATTLE_ROUNDS, BATTLE_MINUTES } from '../phases/battle.js';

const f1 = (v) => Math.round(v * 10) / 10;

/** Punkt auf dem Kreis: Winkel in Grad, 0 = oben, im Uhrzeigersinn */
function at(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [f1(cx + r * Math.cos(a)), f1(cy + r * Math.sin(a))];
}

/** Ringstueck von a0 bis a1 (Grad) zwischen den Radien r0 (innen) und r1 (aussen) */
function band(cx, cy, r0, r1, a0, a1) {
  const large = a1 - a0 > 180 ? 1 : 0;
  const [x0, y0] = at(cx, cy, r1, a0), [x1, y1] = at(cx, cy, r1, a1);
  const [x2, y2] = at(cx, cy, r0, a1), [x3, y3] = at(cx, cy, r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

/** Modell der Uhr aus dem Zustand (rein): { mode: 'day'|'battle', hour, minute, round, of, minutes } */
export function clockModel(state) {
  if (state.turnKind === 'battle') {
    const round = Math.max(1, Math.min(BATTLE_ROUNDS, state.battle?.round ?? 1));
    return { mode: 'battle', round, of: BATTLE_ROUNDS, minutes: round * BATTLE_MINUTES, hour: state.clock.hour, minute: state.clock.minute };
  }
  return { mode: 'day', hour: state.clock.hour, minute: state.clock.minute, night: !!state.night };
}

/**
 * SVG der Uhr. opts.labels: Minutenzahlen am Rand (nur bei grosser Uhr).
 * Farben kommen aus den CSS-Variablen des Themas (currentColor = Tinte).
 */
export function clockSvg(m, { labels = false, title = '' } = {}) {
  const c = 50;
  const parts = [];
  if (m.mode === 'battle') {
    // Zwoelf Felder zu fuenf Minuten, die gelaufenen in Akzentfarbe
    for (let i = 0; i < BATTLE_ROUNDS; i++) {
      const a0 = i * 30 + 2.5, a1 = (i + 1) * 30 - 2.5;
      const on = i < m.round;
      parts.push(`<path class="${on ? 'seg on' : 'seg'}${i === m.round - 1 ? ' now' : ''}" d="${band(c, c, 33, 45, a0, a1)}"/>`);
    }
    if (labels) {
      for (let i = 1; i <= BATTLE_ROUNDS; i++) {
        const [x, y] = at(c, c, 25, i * 30);
        parts.push(`<text class="num" x="${x}" y="${y}">${i * BATTLE_MINUTES}</text>`);
      }
    }
    const [hx, hy] = at(c, c, labels ? 31 : 29, m.round * 30);
    parts.push(`<line class="hand" x1="${c}" y1="${c}" x2="${hx}" y2="${hy}"/>`);
  } else {
    // 24 Stunden: oben 12 Uhr, unten 0 Uhr. Tag hell, Nacht dunkel, Bogen = die kommende Stellungsrunde
    const h = m.hour + m.minute / 60;
    const deg = (h / 24) * 360 + 180;
    parts.push(`<path class="day" d="${band(c, c, 0.01, 45, 270, 450)}"/>`);
    parts.push(`<path class="night" d="${band(c, c, 0.01, 45, 90, 270)}"/>`);
    parts.push(`<path class="next" d="${band(c, c, 38, 45, deg + 3, deg + 177)}"/>`);
    for (let i = 0; i < 24; i += 3) {
      const [x0, y0] = at(c, c, i % 6 ? 41 : 36, (i / 24) * 360 + 180), [x1, y1] = at(c, c, 45, (i / 24) * 360 + 180);
      parts.push(`<line class="tick" x1="${x0}" y1="${y0}" x2="${x1}" y2="${y1}"/>`);
    }
    // Sonne oben, Mond unten
    parts.push(`<circle class="sun" cx="${c}" cy="22" r="5"/>`);
    parts.push(`<path class="moon" d="M${c - 2} 72a6 6 0 1 0 6 8a5 5 0 1 1 -6 -8z"/>`);
    const [hx, hy] = at(c, c, 34, deg);
    parts.push(`<line class="hand" x1="${c}" y1="${c}" x2="${hx}" y2="${hy}"/>`);
  }
  parts.push(`<circle class="pin" cx="${c}" cy="${c}" r="4"/>`);
  return `<svg class="clock-svg ${m.mode}" viewBox="0 0 100 100" role="img" aria-label="${title}">
    <circle class="rim" cx="${c}" cy="${c}" r="48"/>${parts.join('')}</svg>`;
}

/** Text zur Uhr fuer Screenreader und Kaertchen */
export function clockLabel(m) {
  if (m.mode === 'battle') return `Gefechtsrunde ${m.round}, Minute ${m.minutes} von ${m.of * BATTLE_MINUTES}`;
  const hh = String(m.hour).padStart(2, '0') + ':' + String(m.minute).padStart(2, '0');
  return `${m.night ? 'Nacht' : 'Tag'}, ${hh} Uhr, eine Stellungsrunde dauert zwölf Stunden`;
}
