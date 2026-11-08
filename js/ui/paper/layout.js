// Reine Rechenfunktionen der Papierebene: Lage, Kippen, Wegwischen, Stapel, Tippen, Zensur.
// Kein DOM, kein Math.random, damit alles in node --test pruefbar und in Screenshots reproduzierbar ist.
import { createRng } from '../../rng.js';

// FNV-1a ueber die Zeichen der ID: gleiche ID, gleiche Lage
export function hashString(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Wo ein Blatt landet. stage und sheet sind { w, h } in Pixeln, index die laufende Nummer im Stapel.
// Blaetter faechern leicht versetzt um die Mitte auf, Drehung -6 bis +6 Grad, immer ganz im Sichtbereich.
export function placeSheet(id, index, stage, sheet, margin = 8) {
  const rng = createRng(hashString(id));
  const freeX = Math.max(0, stage.w - sheet.w - 2 * margin);
  const freeY = Math.max(0, stage.h - sheet.h - 2 * margin);
  const slot = ((index % 5) + 5) % 5; // 0..4, wiederholt sich
  const fanX = (slot - 2) / 2; // -1 .. 1
  const fanY = ((index * 7) % 5 - 2) / 2;
  const x = margin + freeX / 2 + fanX * freeX * 0.4 + (rng() - 0.5) * freeX * 0.18;
  const y = margin + freeY / 2 + fanY * freeY * 0.3 + (rng() - 0.5) * freeY * 0.2;
  const rot = Math.round((rng() * 12 - 6) * 10) / 10;
  return {
    x: Math.round(clamp(x, margin, margin + freeX)),
    y: Math.round(clamp(y, margin, margin + freeY)),
    rot,
  };
}

// Haelt ein Blatt nach Groessenaenderung oder Ziehen im Sichtbereich; mindestens `keep` Pixel bleiben greifbar
export function clampToStage(pos, stage, sheet, keep = 64) {
  return {
    ...pos,
    x: Math.round(clamp(pos.x, keep - sheet.w, stage.w - keep)),
    y: Math.round(clamp(pos.y, 0, stage.h - keep)),
  };
}

// Kippen aus der Zeigerposition relativ zum Blatt: px, py in 0..1. Ergebnis in Grad, hoechstens max.
export function tiltFromPointer(px, py, max = 9) {
  const dx = clamp(px, 0, 1) - 0.5;
  const dy = clamp(py, 0, 1) - 0.5;
  return { rx: round1(-dy * 2 * max), ry: round1(dx * 2 * max) };
}

// Kippen aus dem Neigungssensor (beta: vor/zurueck, gamma: links/rechts, in Grad).
// Ruhelage ist ein schraeg gehaltenes Handy (beta etwa 40), kleine Zitterbewegungen werden geschluckt.
export function tiltFromOrientation(beta, gamma, max = 6, rest = 40) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return { rx: 0, ry: 0 };
  const dead = (v) => (Math.abs(v) < 2 ? 0 : v);
  const b = dead(clamp(beta - rest, -30, 30));
  const g = dead(clamp(gamma, -30, 30));
  return { rx: round1((-b / 30) * max), ry: round1((g / 30) * max) };
}

function round1(v) {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? 0 : r; // keine -0
}

// Entscheidet am Ende einer Ziehbewegung: wegwischen oder liegen lassen.
// recent: Bewegung der letzten Augenblicke { dx, dy, ms }, center: Blattmitte, stage: Groesse der Ebene.
// Weggewischt wird ein schneller Wurf oder ein Blatt, dessen Mitte ueber den Rand gezogen wurde.
// Langsames Verschieben innerhalb der Ebene legt das Blatt nur woanders hin.
export function flingDecision({ recent, center, stage }) {
  const dx = recent?.dx || 0, dy = recent?.dy || 0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const speed = dist / Math.max(16, recent?.ms || 0); // Pixel pro Millisekunde
  const fast = speed > 0.8 && dist > 30;
  let out = false, ox = 0, oy = 0;
  if (center && stage) {
    if (center.x < 0) ox = -1;
    else if (center.x > stage.w) ox = 1;
    if (center.y < 0) oy = -1;
    else if (center.y > stage.h) oy = 1;
    out = ox !== 0 || oy !== 0;
  }
  if (fast) return { dismiss: true, dirX: round1(dx / dist), dirY: round1(dy / dist) };
  if (out) {
    const n = Math.sqrt(ox * ox + oy * oy);
    return { dismiss: true, dirX: round1(ox / n), dirY: round1(oy / n) };
  }
  return { dismiss: false };
}

// Stapelreihenfolge: das angetippte Blatt nach oben, die anderen behalten ihre Reihenfolge.
export function bringToFront(order, id) {
  if (!order.includes(id)) return order.slice();
  return [...order.filter((x) => x !== id), id];
}

// Zeitplan fuer getippte Zeilen: jede Zeile beginnt nach der vorigen plus Wagenruecklauf.
// cps = Anschlaege pro Sekunde. Liefert [{ index, text, start, duration }] in Millisekunden.
export function typingSchedule(lines, { cps = 28, carriage = 260, startDelay = 300 } = {}) {
  const perChar = 1000 / Math.max(1, cps);
  let t = startDelay;
  return lines.map((text, index) => {
    const duration = Math.round(String(text).length * perChar);
    const item = { index, text: String(text), start: Math.round(t), duration };
    t += duration + carriage;
    return item;
  });
}

// Wie viele Zeichen einer Zeile nach elapsed Millisekunden sichtbar sind
export function visibleChars(item, elapsed) {
  if (elapsed <= item.start) return 0;
  if (item.duration <= 0) return item.text.length;
  const frac = (elapsed - item.start) / item.duration;
  return Math.min(item.text.length, Math.floor(frac * item.text.length));
}

// Zensur der Feldpostpruefstelle: Text in [[doppelten eckigen Klammern]] wird geschwaerzt.
// Liefert Abschnitte [{ text, censored }]. Ein unvollstaendiges [[ bleibt normaler Text.
export function parseCensored(text) {
  const out = [];
  const s = String(text ?? '');
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('[[', i);
    const close = open < 0 ? -1 : s.indexOf(']]', open + 2);
    if (open < 0 || close < 0) {
      out.push({ text: s.slice(i), censored: false });
      break;
    }
    if (open > i) out.push({ text: s.slice(i, open), censored: false });
    out.push({ text: s.slice(open + 2, close), censored: true });
    i = close + 2;
  }
  return out.filter((p) => p.text.length > 0);
}

export function hasCensored(text) {
  return parseCensored(text).some((p) => p.censored);
}
