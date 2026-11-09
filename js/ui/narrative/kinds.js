// Blattarten und Bilder fuer die Erzaehlung (P15). Meldet sich in der Papierebene an, ohne Z1 umzubauen:
//   briefing  Lage vor einer Mission (Schreibmaschine, Stil 03) mit Zielen zum Abhaken
//   decision  Entscheidung mit Wahlmoeglichkeiten als Durchschlaege; die Wahl faengt der Leser ab
// Bilder: stain (Flecken auf Feldpost), flur (handgezeichnete Flurkarte), postcard (Feldpostkarte)
// Darstellung, keine Spiellogik: Math.sin/cos sind hier erlaubt.
import { registerKind, el } from '../paper/registry.js';
import { registerPainter, getPainter } from '../paper/art.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
const missionLabel = (m) => {
  const r = /^a(\d)m(\d)$/.exec(m);
  return r ? `Akt ${ROMAN[+r[1]] ?? r[1]} · Einsatz ${r[2]}` : m;
};
const paras = (body) => (Array.isArray(body) ? body : String(body ?? '').split(/\n\s*\n/)).filter((p) => String(p).trim());

registerKind('briefing', {
  label: 'Lage',
  render(d) {
    const front = el('div', 'narr-brief-body', [
      el('div', 'narr-brief-head', [el('b', null, 'LAGE'), d.mission ? el('span', null, missionLabel(d.mission)) : null]),
      el('h3', 'narr-brief-title', d.title || ''),
      el('dl', 'paper-form paper-form-top', [
        el('div', null, [el('dt', null, 'Ort:'), el('dd', null, d.place || '')]),
        el('div', null, [el('dt', null, 'Zeit:'), el('dd', null, d.time || '')]),
      ]),
      ...paras(d.body).map((p) => el('p', 'narr-brief-p', p)),
      d.goals?.length
        ? el('div', 'narr-brief-goals', [
            el('b', null, 'Ziele'),
            el('ul', null, d.goals.map((g) => el('li', null, [el('span', 'narr-box'), el('span', null, g)]))),
          ])
        : null,
    ]);
    return { front, title: 'Lage: ' + (d.title || '') };
  },
});

registerKind('decision', {
  label: 'Entscheidung',
  render(d) {
    const opts = (d.options || []).map((o, i) =>
      el('li', null, [
        Object.assign(el('button', 'narr-option', [
          el('span', 'narr-option-key', String(i + 1)),
          el('span', 'narr-option-label', o.label),
          el('span', 'narr-option-cons', o.consequence),
        ]), { type: 'button' }),
      ]),
    );
    opts.forEach((li, i) => {
      const b = li.firstChild;
      b.dataset.option = d.options[i].id;
      // Schon gewaehlt (Blatt aus der Ablage zurueckgeholt): Wahl zeigen, Knoepfe sperren
      if (d.chosen) {
        b.disabled = true;
        if (d.chosen === d.options[i].id) b.classList.add('is-chosen');
      }
    });
    const front = el('div', 'narr-dec-body', [
      el('div', 'narr-dec-head', [el('b', null, 'ENTSCHEIDUNG'), el('span', null, 'Major Brandt')]),
      el('h3', 'narr-dec-title', d.title || ''),
      ...paras(d.body).map((p) => el('p', 'narr-dec-p', p)),
      el('ol', 'narr-options', opts),
      el('div', 'narr-dec-result', d.chosen ? d.options.find((o) => o.id === d.chosen)?.text ?? '' : ''),
    ]);
    return { front, title: 'Entscheidung: ' + (d.title || '') };
  },
});

// ---------- Flecken auf der Feldpost ----------
// motif: Liste mit '+' getrennt, z. B. 'wasser+wachs'. Jede Art zeichnet in Papierkoordinaten (310 x 620).

function blob(ctx, cx, cy, r, rng, wobble = 0.18, n = 18) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + (rng() - 0.5) * wobble);
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.92;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const STAINS = {
  // Regen: Wasserraender mit dunklem Rand, darunter verlaufene Tinte
  wasser(ctx, w, h, rng, v) {
    const col = v('stain-water', '#6f7f8c');
    for (let k = 0; k < 2 + Math.floor(rng() * 2); k++) {
      const cx = w * (0.15 + rng() * 0.7), cy = h * (0.12 + rng() * 0.7), r = 18 + rng() * 34;
      ctx.globalAlpha = 0.1;
      ctx.fillStyle = col;
      blob(ctx, cx, cy, r, rng);
      ctx.fill();
      ctx.globalAlpha = 0.32;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      blob(ctx, cx, cy, r, rng, 0.12);
      ctx.stroke();
      // Tinte laeuft unten aus dem Fleck
      ctx.strokeStyle = v('stain-ink', '#24324f');
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const x = cx - r * 0.6 + rng() * r * 1.2;
        const y0 = cy + r * (0.2 + rng() * 0.5);
        ctx.globalAlpha = 0.1 + rng() * 0.08;
        ctx.lineWidth = 1 + rng() * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.quadraticCurveTo(x + (rng() - 0.5) * 4, y0 + 10, x + (rng() - 0.5) * 3, y0 + 14 + rng() * 26);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
  // Schlamm: Lehmfinger am Rand und ein Wisch
  lehm(ctx, w, h, rng, v) {
    const col = v('stain-mud', '#7a5a34');
    for (let k = 0; k < 2; k++) {
      const left = rng() < 0.5;
      const cx = left ? 8 + rng() * 22 : w - 8 - rng() * 22, cy = h * (0.2 + rng() * 0.65);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((rng() - 0.5) * 1.2);
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.ellipse(0, 0, 13, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.34;
      ctx.lineWidth = 0.9;
      for (let r = 3; r < 15; r += 2.2) {
        ctx.beginPath();
        ctx.ellipse(0, 1, r * 0.78, r, 0, Math.PI * (0.1 + rng() * 0.2), Math.PI * (1.8 + rng() * 0.15));
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = col;
    const y = h * (0.75 + rng() * 0.2);
    ctx.beginPath();
    ctx.moveTo(w * 0.1, y);
    ctx.bezierCurveTo(w * 0.35, y - 12, w * 0.6, y + 10, w * 0.8, y - 4);
    ctx.lineTo(w * 0.78, y + 6);
    ctx.bezierCurveTo(w * 0.55, y + 16, w * 0.3, y + 2, w * 0.12, y + 8);
    ctx.fill();
    ctx.globalAlpha = 1;
  },
  // Nebel: das Papier ist klamm, grosse weiche Wolken
  feucht(ctx, w, h, rng, v) {
    const col = v('stain-water', '#6f7f8c');
    ctx.fillStyle = col;
    for (let k = 0; k < 6; k++) {
      ctx.globalAlpha = 0.04 + rng() * 0.03;
      blob(ctx, rng() * w, rng() * h, 40 + rng() * 60, rng, 0.35);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
  // Frost: Knickfalten und helle Kristalle in den Ecken
  frost(ctx, w, h, rng, v) {
    ctx.strokeStyle = v('stain-dust', '#8d7e66');
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 0.8;
    const y = h * (0.45 + rng() * 0.1);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 20) ctx.lineTo(x, y + (rng() - 0.5) * 2);
    ctx.stroke();
    ctx.strokeStyle = v('stain-water', '#6f7f8c');
    for (let k = 0; k < 3; k++) {
      const cx = rng() < 0.5 ? rng() * 40 : w - rng() * 40, cy = rng() < 0.5 ? rng() * 50 : h - rng() * 50;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + rng();
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * (6 + rng() * 8), cy + Math.sin(a) * (6 + rng() * 8));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  },
  // Trockenes Wetter: nur ein staubiger Daumen in der Ecke
  staub(ctx, w, h, rng, v) {
    ctx.fillStyle = v('stain-dust', '#8d7e66');
    ctx.globalAlpha = 0.1;
    blob(ctx, w - 18 - rng() * 14, h - 30 - rng() * 30, 14, rng, 0.3);
    ctx.fill();
    ctx.globalAlpha = 1;
  },
  // Nacht: Wachstropfen der Kerze und Russ vom Docht
  wachs(ctx, w, h, rng, v) {
    for (let k = 0; k < 1 + Math.floor(rng() * 2); k++) {
      const cx = w * (0.2 + rng() * 0.6), cy = h * (0.08 + rng() * 0.8), r = 5 + rng() * 6;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = v('stain-wax', '#efe4bf');
      blob(ctx, cx, cy, r, rng, 0.25, 12);
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = v('stain-wax-edge', '#b9a77a');
      ctx.lineWidth = 1;
      ctx.stroke();
      // Spritzer daneben
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = v('stain-wax', '#efe4bf');
        ctx.beginPath();
        ctx.arc(cx + (rng() - 0.5) * r * 5, cy + (rng() - 0.5) * r * 4, 1 + rng() * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = v('stain-soot', '#3a332c');
    blob(ctx, w * (0.3 + rng() * 0.4), 14 + rng() * 10, 20, rng, 0.5);
    ctx.fill();
    ctx.globalAlpha = 1;
  },
};

registerPainter('stain', (ctx, w, h, rng, v, motif = '') => {
  for (const kind of motif.split('+')) STAINS[kind]?.(ctx, w, h, rng, v);
});

// ---------- Fundstueck: handgezeichnete Flurkarte ----------
registerPainter('flur', (ctx, w, h, rng, v) => {
  const paper = v('photo-back', '#ece4d0'), ink = v('photo-dark', '#3b3024'), mid = v('photo-mid', '#8d7a5e');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.75;
  // Aecker als schiefe Vierecke
  const cols = 3, rows = 2;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = 14 + (i * (w - 28)) / cols, y = 14 + (j * (h - 28)) / rows;
      const cw = (w - 28) / cols, chh = (h - 28) / rows;
      ctx.beginPath();
      ctx.moveTo(x + rng() * 4, y + rng() * 4);
      ctx.lineTo(x + cw - rng() * 4, y + rng() * 4);
      ctx.lineTo(x + cw - rng() * 4, y + chh - rng() * 4);
      ctx.lineTo(x + rng() * 4, y + chh - rng() * 4);
      ctx.closePath();
      ctx.stroke();
      // Schraffur fuer Wiese
      if (rng() < 0.5) {
        ctx.globalAlpha = 0.25;
        for (let k = 8; k < cw - 6; k += 7) {
          ctx.beginPath();
          ctx.moveTo(x + k, y + chh * 0.3);
          ctx.lineTo(x + k + 3, y + chh * 0.3 - 4);
          ctx.stroke();
        }
        ctx.globalAlpha = 0.75;
      }
    }
  }
  // Weg und Brunnen
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(0, h * 0.62);
  ctx.bezierCurveTo(w * 0.3, h * 0.5, w * 0.6, h * 0.75, w, h * 0.58);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(w * (0.4 + rng() * 0.2), h * (0.3 + rng() * 0.2), 5, 0, Math.PI * 2);
  ctx.stroke();
  // Vergilbte Faltkante
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = mid;
  ctx.fillRect(w / 2 - 1, 0, 2, h);
  ctx.globalAlpha = 1;
});

// ---------- Fundstueck: Feldpostkarte (Foto mit weissem Rand und Aufdruck) ----------
registerPainter('postcard', (ctx, w, h, rng, v) => {
  const photo = getPainter('photo');
  const frame = v('photo-frame', '#f4efe4'), ink = v('photo-dark', '#3b3024');
  ctx.fillStyle = frame;
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.translate(10, 10);
  ctx.beginPath();
  ctx.rect(0, 0, w - 20, h - 34);
  ctx.clip();
  photo?.(ctx, w - 20, h - 34, rng, v, 'dorf');
  ctx.restore();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.8;
  ctx.font = '400 10px "Special Elite", monospace';
  ctx.fillText('FELDPOSTKARTE', 10, h - 12);
  ctx.globalAlpha = 1;
});
