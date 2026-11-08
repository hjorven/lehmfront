// Prozedurale Bilder fuer die Blaetter: Fundstueck-Foto, Aquarell im Tagebuch, Linolschnitt der Aktkarte,
// Rasterbild der Zeitung. Deterministisch aus dem Seed (createRng), Farben aus CSS-Variablen der Papierebene.
// Das ist reine Darstellung, keine Spiellogik; Math.sin/cos sind hier erlaubt.
import { createRng } from '../../rng.js';
import { hashString } from './layout.js';

// Legt eine Leinwand an, gemalt wird erst, wenn sie im DOM haengt (dann sind die CSS-Variablen bekannt)
export function artCanvas(type, seed, w, h, label) {
  const c = document.createElement('canvas');
  c.className = 'paper-art paper-art-' + type;
  c.dataset.art = type;
  c.dataset.seed = String(seed);
  c.dataset.w = String(w);
  c.dataset.h = String(h);
  c.setAttribute('role', 'img');
  if (label) c.setAttribute('aria-label', label);
  return c;
}

export function paintAll(root) {
  root.querySelectorAll('canvas[data-art]').forEach(paintArt);
}

export function paintArt(c) {
  const w = +c.dataset.w, h = +c.dataset.h;
  const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  const ctx = c.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cs = getComputedStyle(c);
  const v = (k, d) => cs.getPropertyValue('--' + k).trim() || d;
  const rng = createRng(hashString(c.dataset.seed));
  const [type, motif] = c.dataset.art.split(':');
  const fn = PAINTERS[type];
  if (fn) fn(ctx, w, h, rng, v, motif);
}

const PAINTERS = { photo, wash, lino, press };

// ---------- Fundstueck-Foto: Sepia, Koernung, Vignette, Kratzer ----------
function photo(ctx, w, h, rng, v, motif = 'graben') {
  const light = v('photo-light', '#cdb48c'), mid = v('photo-mid', '#8d7a5e'), dark = v('photo-dark', '#3b3024');
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, light);
  sky.addColorStop(0.55, mid);
  sky.addColorStop(1, dark);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const horizon = h * (0.5 + rng() * 0.1);
  // Boden mit unruhiger Kante
  ctx.fillStyle = dark;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 8) ctx.lineTo(x, horizon + (rng() - 0.5) * 6);
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = dark;
  ctx.strokeStyle = dark;
  ctx.filter = 'blur(0.8px)'; // alte Optik: Motiv leicht unscharf
  if (motif === 'gruppe') {
    // Gruppe vor dem Unterstand, Koepfe leicht versetzt
    ctx.globalAlpha = 0.8;
    ctx.fillRect(w * 0.08, horizon - h * 0.2, w * 0.2, h * 0.2);
    ctx.globalAlpha = 0.9;
    const n = 5 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = w * 0.3 + (i * w * 0.6) / n + rng() * 4;
      const tall = h * (0.26 + rng() * 0.05);
      const base = horizon + h * 0.12;
      ctx.beginPath();
      ctx.arc(x, base - tall - 6, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x - 9, base);
      ctx.lineTo(x - 8, base - tall + 4);
      ctx.lineTo(x + 8, base - tall + 4);
      ctx.lineTo(x + 9, base);
      ctx.fill();
    }
  } else if (motif === 'dorf') {
    // Zerschossene Haeuser, ein Kirchturmstumpf
    ctx.globalAlpha = 0.85;
    let x = w * 0.04;
    while (x < w * 0.92) {
      const bw = 24 + rng() * 34, bh = 18 + rng() * 40;
      ctx.beginPath();
      ctx.moveTo(x, horizon + 4);
      ctx.lineTo(x, horizon - bh);
      for (let k = 1; k <= 4; k++) ctx.lineTo(x + (bw * k) / 4, horizon - bh + (rng() - 0.3) * 16);
      ctx.lineTo(x + bw, horizon + 4);
      ctx.fill();
      x += bw + 6 + rng() * 18;
    }
    ctx.fillRect(w * 0.62, horizon - h * 0.42, 14, h * 0.42);
  } else {
    // Graben mit Sandsaecken, Pfaehle mit Draht, Baumstuempfe
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3;
    ctx.beginPath();
    let y = horizon + h * 0.16;
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 22) {
      y = horizon + h * 0.16 + ((x / 22) % 2 ? -8 : 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (let x = 6; x < w; x += 13) {
      ctx.beginPath();
      ctx.ellipse(x, horizon + h * 0.09 + rng() * 3, 7, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineWidth = 1;
    for (let x = 10; x < w; x += 26) {
      ctx.beginPath();
      ctx.moveTo(x, horizon + 2);
      ctx.lineTo(x + 2, horizon - 16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x, horizon - 10);
      ctx.lineTo(x + 26, horizon - 8 + rng() * 4);
      ctx.stroke();
    }
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      const x = w * (0.15 + rng() * 0.75), th = 20 + rng() * 40;
      ctx.beginPath();
      ctx.moveTo(x, horizon);
      ctx.lineTo(x + rng() * 4 - 2, horizon - th);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  ctx.filter = 'none';

  // Koernung
  for (let i = 0; i < (w * h) / 40; i++) {
    ctx.fillStyle = rng() < 0.5 ? light : dark;
    ctx.globalAlpha = 0.08 + rng() * 0.1;
    ctx.fillRect(rng() * w, rng() * h, 1, 1);
  }
  // Kratzer
  ctx.strokeStyle = light;
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 2; i++) {
    ctx.globalAlpha = 0.5;
    const x = rng() * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + (rng() - 0.5) * 30, h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Vignette
  const vg = ctx.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

// ---------- Aquarell: Lasuren in Schichten, darueber Bleistift ----------
function blob(ctx, rng, cx, cy, r, color, layers = 7) {
  ctx.fillStyle = color;
  for (let l = 0; l < layers; l++) {
    ctx.globalAlpha = 0.07 + rng() * 0.05;
    ctx.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const rr = r * (0.75 + rng() * 0.4);
      const x = cx + Math.cos(a) * rr * 1.5, y = cy + Math.sin(a) * rr * 0.7;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function wash(ctx, w, h, rng, v, motif = 'huegel') {
  ctx.clearRect(0, 0, w, h);
  const sky = v('wash-sky', '#9fb4c4'), earth = v('wash-earth', '#b89a6a'), green = v('wash-green', '#8fa078'), pencil = v('wash-pencil', '#5a5048');
  blob(ctx, rng, w * 0.45, h * 0.28, w * 0.28, sky, 9);
  blob(ctx, rng, w * 0.55, h * 0.72, w * 0.3, earth, 9);
  if (motif === 'regen') {
    ctx.strokeStyle = sky;
    ctx.lineWidth = 1;
    for (let i = 0; i < 40; i++) {
      ctx.globalAlpha = 0.35;
      const x = rng() * w, y = rng() * h * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - 4, y + 12);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  for (let i = 0; i < 5; i++) blob(ctx, rng, w * (0.12 + rng() * 0.76), h * (0.5 + rng() * 0.08), 8 + rng() * 6, green, 5);
  // Bleistift: Huegelkontur und Graben als Rechteckwelle
  ctx.strokeStyle = pencil;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 6) {
    const y = h * 0.58 - Math.sin((x / w) * Math.PI) * h * 0.22 + (rng() - 0.5) * 1.5;
    x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.stroke();
  ctx.beginPath();
  let x = w * 0.08;
  const y0 = h * 0.78;
  ctx.moveTo(x, y0);
  while (x < w * 0.9) {
    ctx.lineTo(x, y0 - 5);
    ctx.lineTo(x + 9, y0 - 5);
    ctx.lineTo(x + 9, y0 + 5);
    ctx.lineTo(x + 18, y0 + 5);
    x += 18;
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ---------- Linolschnitt: grosse schwarze Flaeche, ausgehobene Linien, ein Rot ----------
function gouge(ctx, x1, y1, x2, y2, width) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const nx = (-dy / len) * width, ny = (dx / len) * width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo((x1 + x2) / 2 + nx, (y1 + y2) / 2 + ny, x2, y2);
  ctx.quadraticCurveTo((x1 + x2) / 2 - nx * 0.3, (y1 + y2) / 2 - ny * 0.3, x1, y1);
  ctx.fill();
}

function lino(ctx, w, h, rng, v, motif = 'sonne') {
  const ground = v('lino-ground', '#ebe0c6'), ink = v('lino-ink', '#151210'), red = v('lino-red', '#b3261e');
  const night = motif === 'leuchtkugel';
  ctx.fillStyle = night ? ink : ground;
  ctx.fillRect(0, 0, w, h);
  // Himmelskoerper: Sonne (schwarz auf hell) oder Leuchtkugel (rot auf schwarz)
  const cx = w * (0.6 + rng() * 0.15), cy = h * 0.3, r = h * 0.2;
  ctx.fillStyle = night ? red : ink;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = night ? ink : ground;
  for (let i = 0; i < 9; i++) {
    const yy = cy - r + (i + 0.5) * ((2 * r) / 9);
    gouge(ctx, cx - r * 1.1, yy, cx + r * 1.1, yy + (rng() - 0.5) * 4, 1.6);
  }
  // Strahlen der Leuchtkugel oder Wolkenbaender
  ctx.strokeStyle = night ? red : ink;
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + rng() * 0.2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
    ctx.lineTo(cx + Math.cos(a) * r * (1.5 + rng() * 0.4), cy + Math.sin(a) * r * (1.5 + rng() * 0.4));
    ctx.stroke();
  }
  // Erde: schwarzes Band mit Grabenkante
  const top = h * 0.62;
  ctx.fillStyle = night ? ground : ink;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, top);
  for (let x = 0; x <= w; x += 14) ctx.lineTo(x, top + (rng() - 0.5) * 10 - Math.sin((x / w) * Math.PI) * 18);
  ctx.lineTo(w, h);
  ctx.fill();
  ctx.fillStyle = night ? ink : ground;
  for (let i = 0; i < 26; i++) {
    const x = rng() * w, y = top + 18 + rng() * (h - top - 24);
    gouge(ctx, x, y, x + 20 + rng() * 40, y + (rng() - 0.5) * 6, 1.4);
  }
  // Roter Graben als Rechteckwelle
  ctx.strokeStyle = red;
  ctx.lineWidth = 5;
  ctx.beginPath();
  let x = -4;
  const gy = top + (h - top) * 0.45;
  ctx.moveTo(x, gy);
  while (x < w) {
    ctx.lineTo(x, gy - 8);
    ctx.lineTo(x + 16, gy - 8);
    ctx.lineTo(x + 16, gy + 8);
    ctx.lineTo(x + 32, gy + 8);
    x += 32;
  }
  ctx.stroke();
  // Pfaehle mit Draht
  ctx.strokeStyle = night ? ink : ground;
  ctx.lineWidth = 2;
  for (let px = 12; px < w; px += 34) {
    ctx.beginPath();
    ctx.moveTo(px, top + 2);
    ctx.lineTo(px + 3, top - 18);
    ctx.stroke();
  }
}

// ---------- Rasterbild der Zeitung: Punkte nach Helligkeit ----------
function press(ctx, w, h, rng, v) {
  const ink = v('news-ink', '#1b1b1b'), paper = v('news-paper', '#f2efe6');
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const horizon = h * 0.55;
  const ruins = [];
  for (let i = 0; i < 7; i++) ruins.push({ x: rng() * w, wid: 10 + rng() * 26, hi: 10 + rng() * 34 });
  const darkness = (x, y) => {
    let d = y < horizon ? 0.12 + (y / horizon) * 0.2 : 0.55 + ((y - horizon) / (h - horizon)) * 0.35;
    for (const r of ruins) if (x > r.x && x < r.x + r.wid && y > horizon - r.hi && y < horizon) d = 0.85;
    if (Math.abs(y - (horizon + h * 0.18)) < 3) d = 0.95;
    return Math.min(1, d + (rng() - 0.5) * 0.08);
  };
  ctx.fillStyle = ink;
  const step = 4;
  for (let y = step / 2; y < h; y += step) {
    for (let x = ((y / step) % 2) * (step / 2); x < w; x += step) {
      const r = (step / 2) * Math.sqrt(darkness(x, y));
      if (r < 0.3) continue;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
