// Kartentisch der Feldzugskarte (P14, Stil 09 Kriegsraum): Abschnitt Asse-Nord von West nach Ost,
// Orte, Fluss, Hoehenlinien von Huegel 214, die Missionen als Stationen und der Frontverlauf.
// Ueberraschung: jede gespielte Mission hinterlaesst ihre Frontlinie als feine Bleistiftlinie, wie Jahresringe;
// man sieht, wie die Front hin und her ging. Reine Optik: Math.sin und Zufall aus dem Seed sind hier erlaubt.
import { PLACES, RIVER, FRONT_X, FRONT_STEP, LINE_GAP, MISSION_PLACES } from '../../config/campaign-map.js';
import { MISSIONS, actOf, actRoman } from '../../narrative/texts.js';
import { createRng } from '../../rng.js';
import { WARROOM as C } from '../../theme.js';

const FONT_MONO = '"IBM Plex Mono", monospace';
const FONT_HEAD = '"Special Elite", "IBM Plex Mono", monospace';

/** Missionskuerzel wie auf der Karte: I-3 */
export function missionShort(m) {
  return `${actRoman(actOf(m))}-${Number(m.slice(3))}`;
}

/** Position einer Mission in Pixeln: unter ihrem Ort, Missionen am selben Ort nebeneinander (hoechstens drei je Reihe) */
export function missionPos(m, w, h, r) {
  const place = PLACES.find((p) => p.id === MISSION_PLACES[m]) ?? PLACES[0];
  const same = MISSIONS.filter((x) => MISSION_PLACES[x] === MISSION_PLACES[m]);
  const i = same.indexOf(m);
  const perRow = Math.min(3, same.length - Math.floor(i / 3) * 3);
  const col = i % 3, row = Math.floor(i / 3);
  const gap = r * 2 + 5;
  return { x: place.x * w + (col - (perRow - 1) / 2) * gap, y: place.y * h + r * 2.2 + row * (r * 1.5 + 5) };
}

function crenel(ctx, x, h, amp, step, seed) {
  const rng = createRng(seed);
  ctx.beginPath();
  let cx = x;
  ctx.moveTo(cx, 0);
  for (let y = 0; y < h; y += step) {
    const o = ((y / step) | 0) % 2 ? amp : -amp;
    const j = (rng() - 0.5) * 1.2;
    ctx.lineTo(cx + j, y + step / 2);
    ctx.lineTo(cx + o + j, y + step / 2);
    ctx.lineTo(cx + o + j, y + step);
    cx = x;
  }
  ctx.stroke();
}

/** Stempel je Ende des Feldzugs */
export const ENDED_STAMPS = {
  vorzeitig_meuterei: 'MEUTEREI', vorzeitig_abgeloest: 'ABGELÖST', abgeloest: 'ABGELÖST',
  haelt: 'GEHALTEN', waffenstillstand: 'WAFFENSTILLSTAND', durchbruch: 'DURCHBRUCH',
};

/**
 * Zeichnen. opts: { campaign, next (naechste Mission oder null), ended, highlight (Mission unter dem Zeiger) }
 * Gibt die Trefferflaechen der Stationen zurueck: [{ m, x, y, r }].
 */
export function drawWarMap(canvas, { campaign, next = null, ended = null, highlight = null } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return [];
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = (v) => v * w, Y = (v) => v * h;
  const small = w < 440;

  ctx.fillStyle = C.board;
  ctx.fillRect(0, 0, w, h);
  // Raster des Kartentischs
  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  const cell = small ? 28 : 40;
  ctx.beginPath();
  for (let x = cell; x < w; x += cell) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); }
  for (let y = cell; y < h; y += cell) { ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); }
  ctx.stroke();

  // Hoehenlinien um Huegel 214
  const hill = PLACES.find((p) => p.id === 'huegel');
  ctx.strokeStyle = C.faint;
  for (let r = 1; r <= 5; r++) {
    ctx.beginPath();
    const rr = r * (small ? 11 : 17);
    for (let a = 0; a <= 48; a++) {
      const t = (a / 48) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(t * 3 + r);
      const px = X(hill.x) + Math.cos(t) * rr * 1.35 * wob, py = Y(hill.y) + Math.sin(t) * rr * 0.85 * wob;
      a ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
    }
    ctx.stroke();
  }

  // Asse
  ctx.strokeStyle = C.water;
  ctx.lineWidth = small ? 9 : 14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  RIVER.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.save();
  ctx.translate(X(0.235), Y(0.86));
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = C.water;
  ctx.font = `${small ? 10 : 12}px ${FONT_MONO}`;
  ctx.fillText('Asse', 0, 0);
  ctx.restore();

  // Front: alte Linien als Bleistiftringe, die aktuelle als Grabenlinie, die feindliche gegenueber
  const front = campaign?.front ?? [];
  const amp = small ? 5 : 7, step = small ? 18 : 24;
  ctx.setLineDash([3, 4]);
  const rings = [0, ...front].slice(0, -1); // Startlinie und jede Linie nach einer Mission ausser der letzten
  rings.forEach((f, i) => {
    ctx.strokeStyle = C.faint;
    ctx.globalAlpha = 0.5 + (0.4 * (i + 1)) / Math.max(1, rings.length);
    crenel(ctx, X(FRONT_X + f * FRONT_STEP), h, amp, step, 300 + i);
  });
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);
  const cur = front.length ? front[front.length - 1] : 0;
  ctx.lineWidth = 2;
  ctx.strokeStyle = C.own;
  crenel(ctx, X(FRONT_X + cur * FRONT_STEP), h, amp, step, 11);
  ctx.strokeStyle = C.enemy;
  crenel(ctx, X(FRONT_X + cur * FRONT_STEP + LINE_GAP), h, amp, step, 12);
  // Draht vor der feindlichen Linie
  ctx.lineWidth = 1;
  const wx = X(FRONT_X + cur * FRONT_STEP + LINE_GAP) - (small ? 12 : 18);
  for (let y = 6; y < h; y += small ? 10 : 12) {
    ctx.beginPath();
    ctx.moveTo(wx - 4, y - 4); ctx.lineTo(wx + 4, y + 4);
    ctx.moveTo(wx + 4, y - 4); ctx.lineTo(wx - 4, y + 4);
    ctx.stroke();
  }
  ctx.fillStyle = C.ink2;
  ctx.font = `${small ? 9 : 11}px ${FONT_MONO}`;
  ctx.save();
  ctx.translate(X(FRONT_X + cur * FRONT_STEP + LINE_GAP / 2) + 4, Y(0.98));
  ctx.rotate(-Math.PI / 2);
  const nw = ctx.measureText('NIEMANDSLAND').width, nf = small ? 9 : 11;
  ctx.fillStyle = C.board;
  ctx.fillRect(-2, -nf, nw + 4, nf + 3);
  ctx.fillStyle = C.ink2;
  ctx.fillText('NIEMANDSLAND', 0, 0);
  ctx.restore();

  // Orte
  for (const p of PLACES) {
    const x = X(p.x), y = Y(p.y);
    ctx.strokeStyle = C.line;
    ctx.fillStyle = C.board;
    ctx.lineWidth = 1.2;
    if (p.kind === 'village') {
      const s = small ? 7 : 10;
      for (const [dx, dy] of [[-1, -1], [1, -1], [0, 1], [-1, 1]]) {
        ctx.fillRect(x + dx * s - 4, y + dy * s * 0.7 - 3, 8, 6);
        ctx.strokeRect(x + dx * s - 4, y + dy * s * 0.7 - 3, 8, 6);
      }
    } else if (p.kind === 'forest') {
      ctx.strokeStyle = C.forest;
      for (const [dx, dy] of [[-10, 0], [0, -6], [10, 2], [2, 8]]) {
        ctx.beginPath();
        ctx.arc(x + dx * (small ? 0.7 : 1), y + dy * (small ? 0.7 : 1), small ? 5 : 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (p.kind === 'hill') {
      ctx.fillStyle = C.line;
      ctx.beginPath();
      ctx.moveTo(x, y - 6); ctx.lineTo(x + 6, y + 4); ctx.lineTo(x - 6, y + 4); ctx.closePath();
      ctx.fill();
    } else if (p.kind === 'tower') {
      ctx.strokeRect(x - 4, y - 10, 8, 16);
      ctx.beginPath(); ctx.moveTo(x - 4, y - 10); ctx.lineTo(x + 4, y + 6); ctx.moveTo(x + 4, y - 10); ctx.lineTo(x - 4, y + 6); ctx.stroke();
    } else if (p.kind === 'hollow') {
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.ellipse(x, y, small ? 12 : 18, small ? 7 : 10, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    } else if (p.kind === 'staff') {
      ctx.strokeRect(x - 6, y - 5, 12, 10);
      ctx.beginPath(); ctx.moveTo(x - 7, y - 5); ctx.lineTo(x, y - 10); ctx.lineTo(x + 7, y - 5); ctx.stroke();
    } else {
      ctx.fillRect(x - 5, y - 4, 10, 8);
      ctx.strokeRect(x - 5, y - 4, 10, 8);
    }
    ctx.fillStyle = C.ink2;
    ctx.font = `${small ? 9 : 11}px ${FONT_MONO}`;
    if (!small || !['mark', 'house', 'hollow'].includes(p.kind)) {
      const tw = ctx.measureText(p.label).width;
      const lx = Math.max(4, Math.min(w - tw - 4, x - tw / 2));
      const ly = y - (small ? 12 : 16), fs = small ? 9 : 11;
      // Schild in Brettfarbe, damit Linien und Draht die Namen nicht durchkreuzen
      ctx.fillStyle = C.board;
      ctx.fillRect(lx - 2, ly - fs, tw + 4, fs + 3);
      ctx.fillStyle = C.ink2;
      ctx.fillText(p.label, lx, ly);
    }
  }

  // Stationen der Missionen
  const hits = [];
  const outcomes = campaign?.outcomes ?? {};
  const act = next ? actOf(next) : actOf(campaign?.mission ?? MISSIONS[0]);
  for (const m of MISSIONS) {
    const done = outcomes[m];
    const isNext = m === next && !ended;
    if (!done && !isNext && actOf(m) > act) continue; // spaetere Akte sind noch nicht auf dem Tisch
    const r = small ? 9 : 12;
    const { x, y } = missionPos(m, w, h, r);
    ctx.lineWidth = isNext ? 2.5 : 1.4;
    ctx.strokeStyle = isNext ? C.accent : done ? C.line : C.faint;
    ctx.fillStyle = isNext ? C.accent : done === 'sieg' ? C.line : C.board2;
    ctx.beginPath();
    ctx.rect(x - r, y - r * 0.75, r * 2, r * 1.5);
    if (isNext) {
      ctx.globalAlpha = 0.18;
      ctx.fill();
      ctx.globalAlpha = 1;
    } else ctx.fill();
    ctx.stroke();
    if (m === highlight) {
      ctx.strokeStyle = C.ink;
      ctx.strokeRect(x - r - 3, y - r * 0.75 - 3, r * 2 + 6, r * 1.5 + 6);
    }
    ctx.fillStyle = isNext ? C.accent : done === 'sieg' ? C.board : done ? C.ink : C.ink2;
    ctx.font = `700 ${small ? 9 : 11}px ${FONT_MONO}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(missionShort(m), x, y + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if (done === 'niederlage') {
      // Verloren: mit Rotstift durchgestrichen (gewonnene Stationen sind voll ausgemalt)
      ctx.strokeStyle = C.danger;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - r - 2, y + r * 0.75 + 2);
      ctx.lineTo(x + r + 2, y - r * 0.75 - 2);
      ctx.stroke();
    }
    hits.push({ m, x, y, r: r + 4 });
  }

  // Stempel am Ende des Feldzugs: rot bei Abloesung, Meuterei und Durchbruch, Tinte bei den stillen Enden (P26)
  if (ended) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.12);
    const quiet = ended === 'haelt' || ended === 'waffenstillstand';
    ctx.strokeStyle = quiet ? C.ink : C.danger;
    ctx.fillStyle = quiet ? C.ink : C.danger;
    ctx.lineWidth = 4;
    const label = ENDED_STAMPS[ended] ?? 'ABGELÖST';
    ctx.font = `${small ? 30 : 54}px ${FONT_HEAD}`;
    const tw = ctx.measureText(label).width;
    ctx.globalAlpha = 0.85;
    ctx.strokeRect(-tw / 2 - 18, -(small ? 26 : 44), tw + 36, small ? 48 : 80);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 2);
    ctx.restore();
  }
  return hits;
}
