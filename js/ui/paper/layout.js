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

// Van-der-Corput-Folge: gleichmaessig gestreute Werte 0..1 ohne Wiederholung, nur Grundrechenarten
export function radicalInverse(n, base) {
  let f = 1, r = 0, i = Math.max(0, Math.floor(n));
  while (i > 0) {
    f = f / base;
    r += f * (i % base);
    i = Math.floor(i / base);
  }
  return r;
}

// Wo ein Blatt landet. stage und sheet sind { w, h } in Pixeln, index die laufende Nummer im Stapel.
// Blaetter streuen nach einer Halton-Folge (Basis 2 und 3) ueber die Flaeche, so dass auch das sechste,
// siebte usw. Blatt nicht auf einem frueheren landet. Drehung -6 bis +6 Grad; der Rand beruecksichtigt die
// Drehung, damit gedrehte Ecken nicht abgeschnitten werden. Ist das Blatt hoeher als die Ebene, liegt es oben.
export function placeSheet(id, index, stage, sheet, margin = 8) {
  const rng = createRng(hashString(id));
  const rot = Math.round((rng() * 12 - 6) * 10) / 10;
  const rad = Math.abs(rot) * 0.01745; // Bogenmass; fuer kleine Winkel gilt sin(a) ungefaehr a
  const mx = margin + Math.ceil((sheet.h * rad) / 2);
  const my = margin + Math.ceil((sheet.w * rad) / 2);
  const freeX = Math.max(0, stage.w - sheet.w - 2 * mx);
  const freeY = Math.max(0, stage.h - sheet.h - 2 * my);
  const hx = radicalInverse(index + 1, 2);
  const hy = radicalInverse(index + 1, 3);
  const x = mx + freeX * (0.08 + 0.84 * hx) + (rng() - 0.5) * freeX * 0.08;
  const y = my + freeY * (0.08 + 0.84 * hy) + (rng() - 0.5) * freeY * 0.08;
  // Passt das gedrehte Blatt nicht mit Rand hinein: waagerecht mittig, senkrecht oben (Kopf lesbar)
  const fitsX = stage.w - sheet.w - 2 * mx >= 0;
  const fitsY = stage.h - sheet.h - 2 * my >= 0;
  return {
    x: Math.round(fitsX ? clamp(x, mx, mx + freeX) : Math.max(0, (stage.w - sheet.w) / 2)),
    y: Math.round(fitsY ? clamp(y, my, my + freeY) : Math.max(0, Math.min(my, (stage.h - sheet.h) / 2))),
    rot,
  };
}

// Haelt ein Blatt nach Groessenaenderung oder Ziehen im Sichtbereich; mindestens `keep` Pixel bleiben greifbar.
// Nach oben darf ein hohes Blatt hinausgeschoben werden, damit man sein unteres Ende lesen kann.
export function clampToStage(pos, stage, sheet, keep = 64) {
  return {
    ...pos,
    x: Math.round(clamp(pos.x, keep - sheet.w, stage.w - keep)),
    y: Math.round(clamp(pos.y, Math.min(0, keep - sheet.h), stage.h - keep)),
  };
}

// Kippen aus der Zeigerposition relativ zum Blatt: px, py in 0..1. Ergebnis in Grad, hoechstens max.
export function tiltFromPointer(px, py, max = 9) {
  const dx = clamp(px, 0, 1) - 0.5;
  const dy = clamp(py, 0, 1) - 0.5;
  return { rx: round1(-dy * 2 * max), ry: round1(dx * 2 * max) };
}

// Kippen aus dem Neigungssensor (beta: vor/zurueck, gamma: links/rechts, in Grad).
// angle ist screen.orientation.angle (0, 90, 180, 270); im Querformat tauschen die Achsen.
// Ruhelage ist ein schraeg gehaltenes Handy (etwa 40 Grad), kleine Zitterbewegungen werden geschluckt.
export function tiltFromOrientation(beta, gamma, max = 6, rest = 40, angle = 0) {
  if (!Number.isFinite(beta) || !Number.isFinite(gamma)) return { rx: 0, ry: 0 };
  const a = (((Math.round(angle / 90) % 4) + 4) % 4) * 90;
  let fb = beta, lr = gamma;
  if (a === 90) { fb = -gamma; lr = beta; }
  else if (a === 180) { fb = -beta; lr = -gamma; }
  else if (a === 270) { fb = gamma; lr = -beta; }
  const dead = (v) => (Math.abs(v) < 2 ? 0 : v);
  const b = dead(clamp(fb - rest, -30, 30));
  const g = dead(clamp(lr, -30, 30));
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
