// Wetterebene der Lagekarte (P10, Plan 7.1 "Wetter auf dem Papier", 7.7). Liegt als eigenes Canvas zwischen
// statischer Karte und Einheiten. Reine Optik: liest den Spielzustand, aendert ihn nie.
//
// Zeichnet:
// - Wasserflecken auf dem Papier, solange der Boden nass ist (getrocknet bleiben blasse Raender)
// - Ueberraschung: Regentropfen landen sichtbar auf dem Blatt. Wo einer landet, bleibt ein kleiner Fleck, und die
//   Tinte darunter zerlaeuft ein wenig nach unten (die statische Karte wird an diesen Stellen versetzt nachgedruckt).
// - Schlammsignatur (kurze waagerechte Striche wie Sumpf, dichter je Stufe), Wasser im Graben, Lattenrost
// - Leuchtkugeln ab darkness > 0,5: steigen auf, brennen flackernd, erhellen den Kreis, verloeschen; danach bleibt
//   ein Bleistiftkreis, damit man beim Planen weiss, warum man dort etwas sieht
// - Nebel als Grau ueber der Karte, mit Luecken, so weit die eigenen Gruppen im Nebel sehen
// - Regenstriche schraeg nach dem Wind
// Bewegung nur ohne prefers-reduced-motion; Szenen fuer Screenshots schalten sie mit { still: true } ab.
import { applyCameraTransform } from './camera.js';
import { hashSeed } from './geometry.js';
import { mudAt, waterAt, isDrained, trenchOf, snowAt } from '../weather.js';
import { sightRange, darknessOf } from '../sight.js';
import { groupsOf } from '../state.js';

const TAU = Math.PI * 2;
const FLARE_LIFE = { rise: 450, burn: 2600, fade: 900 };
const MAX_DROP_STAINS = 60;

/** Kleiner deterministischer Zufall fuer die Optik (Mulberry32) */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex, a) {
  const s = String(hex).replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Unregelmaessiger Fleck als Punktliste um (cx, cy) */
function blob(r, cx, cy, rad, n = 14) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const k = rad * (0.8 + r() * 0.35);
    pts.push([cx + Math.cos(a) * k, cy + Math.sin(a) * k]);
  }
  return pts;
}

function tracePoly(ctx, pts) {
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

const WIND_X = { n: 0, ne: -0.5, e: -1, se: -0.5, s: 0, sw: 0.5, w: 1, nw: 0.5 };

/** Wie viele der vorbereiteten Flecken sind sichtbar? (Naesse und Regen) */
export function stainCount(weather) {
  const wet = weather?.wet ?? 0;
  const rain = weather?.kind === 'rain' || weather?.kind === 'storm';
  return Math.min(36, wet * 9 + (rain ? 6 : 0));
}

/**
 * createWeatherLayer(canvas, { map, seed, getCamera, getTheme, staticCanvas })
 * Rueckgabe: { setState(state, { side, still }), resize(w, h, dpr), invalidate(), drawNow(), destroy() }
 */
export function createWeatherLayer(canvas, { map, seed = 1, getCamera, getTheme, staticCanvas = null }) {
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let state = null;
  let side = 'a';
  let still = false;
  let pending = 0, loop = 0, lastFrame = 0;
  let mud = [], water = [], fogHoles = [];
  const flareAnim = new Map(); // key -> Startzeit
  const drops = [];            // landende Tropfen { x, y, t0 }
  const dropStains = [];       // gebliebene Flecken der Tropfen { pts, cx, cy, rad }
  let fogCv = null;

  // Vorbereitete Flecken (deterministisch je Partie), sichtbar je nach Naesse
  const r0 = prng(hashSeed(seed, 'regen'));
  const stains = Array.from({ length: 36 }, () => {
    const cx = r0() * map.width, cy = r0() * map.height;
    const rad = 0.7 + r0() * 1.8;
    return { cx, cy, rad, pts: blob(r0, cx, cy, rad), ring: blob(r0, cx, cy, rad * 1.02, 18) };
  });

  function rebuild() {
    mud = [];
    water = [];
    fogHoles = [];
    stainKey = '';
    fogKey = '';
    if (!state) return;
    const ownMapSide = side === 'a' ? 'own' : 'enemy';
    for (const c of map.cells) {
      const m = mudAt(state, map, c.x, c.y);
      if (m > 0) mud.push({ x: c.x, y: c.y, m });
      // Wasser und Lattenrost nur in eigenen Graeben: was im feindlichen Graben steht, weiss man nicht
      const tr = trenchOf(state, map, c.x, c.y);
      if (tr && tr.side === ownMapSide) {
        const w = waterAt(state, c.x, c.y), dr = isDrained(state, c.x, c.y);
        if (w || dr) water.push({ x: c.x, y: c.y, w, dr });
      }
    }
    if (state.weather?.kind === 'fog') {
      const dk = darknessOf(state);
      for (const g of groupsOf(state, side)) fogHoles.push({ x: g.pos.x + 0.5, y: g.pos.y + 0.5, r: sightRange(map, g, g.pos, dk) + 0.5 });
    }
    // Neue Leuchtkugeln merken (Startzeit der Animation)
    const now = performance.now();
    const keys = new Set();
    for (const f of state.flares ?? []) {
      const k = `${state.turn}:${f.x},${f.y}:${f.side}`;
      keys.add(k);
      // Standbild (Screenshots, reduzierte Bewegung): Kugel brennt gerade
      if (!flareAnim.has(k)) flareAnim.set(k, still ? now - FLARE_LIFE.rise - FLARE_LIFE.burn / 3 : now);
    }
    for (const k of [...flareAnim.keys()]) if (!keys.has(k)) flareAnim.delete(k);
  }

  function animating() {
    if (still || !state) return false;
    const w = state.weather ?? {};
    if (w.kind === 'rain' || w.kind === 'storm' || w.kind === 'fog' || w.kind === 'snow') return true;
    const now = performance.now();
    for (const t0 of flareAnim.values()) if (now - t0 < FLARE_LIFE.rise + FLARE_LIFE.burn + FLARE_LIFE.fade) return true;
    return drops.length > 0;
  }

  function schedule() {
    if (loop || !animating()) return;
    const tick = (ts) => {
      loop = 0;
      if (typeof document !== 'undefined' && document.hidden) { loop = requestAnimationFrame(tick); return; }
      if (ts - lastFrame >= 33) { lastFrame = ts; draw(ts); }
      if (animating()) loop = requestAnimationFrame(tick);
    };
    loop = requestAnimationFrame(tick);
  }

  // ---------- Zeichnen ----------

  function visibleRect(cam) {
    const hw = cam.viewW / 2 / cam.zoom, hh = cam.viewH / 2 / cam.zoom;
    return { x0: cam.x - hw - 2, y0: cam.y - hh - 2, x1: cam.x + hw + 2, y1: cam.y + hh + 2 };
  }

  function renderStains(g, cam, th, wet, raining) {
    const n = stainCount(state.weather);
    const list = stains.slice(0, n).concat(dropStains);
    // Getrocknet: nur noch blasse Raender der ersten Flecken
    const dry = wet === 0 && !raining;
    const shown = dry ? (state.weather?.wasWet ? stains.slice(0, 6) : []) : list;
    if (!shown.length) return;
    applyCameraTransform(g, cam, dpr);
    // Tinte zerlaeuft: statische Karte an den Flecken leicht nach unten versetzt nachdrucken
    if (!dry && staticCanvas && staticCanvas.width) {
      g.save();
      g.beginPath();
      for (const s of list) tracePoly(g, s.pts);
      g.clip();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 0.4;
      g.drawImage(staticCanvas, 0, 1.5 * dpr);
      g.globalAlpha = 0.25;
      g.drawImage(staticCanvas, 0.6 * dpr, 3.5 * dpr);
      g.restore();
      applyCameraTransform(g, cam, dpr);
    }
    const px = 1 / cam.zoom;
    g.save();
    for (const s of shown) {
      g.beginPath();
      tracePoly(g, s.pts);
      if (!dry) {
        g.fillStyle = rgba(th.wetPaper, th.dark ? 0.4 : 0.35);
        g.fill();
        g.fillStyle = rgba(th.stain, th.dark ? 0.1 : 0.08);
        g.fill();
      }
      g.beginPath();
      tracePoly(g, s.ring ?? s.pts);
      g.strokeStyle = rgba(th.stain, dry ? 0.15 : th.dark ? 0.6 : 0.5);
      g.lineWidth = Math.max(0.03, 1.6 * px);
      g.stroke();
    }
    g.restore();
  }

  // Flecken und zerlaufene Tinte sind teuer (Clip, zwei Kopien der Karte): zwischengespeichert, neu nur wenn sich
  // Kamera, Groesse, Tageszeit oder die Flecken aendern. Nach einer Aenderung zwei Bilder lang neu, damit die
  // statische Karte sicher fertig gezeichnet ist, bevor ihre Tinte kopiert wird.
  let stainCv = null, stainKey = '', stainFresh = 0;
  function drawStains(cam, th, wet, raining) {
    const key = [cam.x, cam.y, cam.zoom, canvas.width, canvas.height, th.darkness, wet, raining, stainCount(state.weather), dropStains.length, !!state.weather?.wasWet].join('|');
    if (key !== stainKey) { stainKey = key; stainFresh = 2; }
    if (!stainCv) stainCv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    if (stainFresh > 0) {
      stainFresh--;
      if (stainCv.width !== canvas.width || stainCv.height !== canvas.height) { stainCv.width = canvas.width; stainCv.height = canvas.height; }
      const g = stainCv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, stainCv.width, stainCv.height);
      renderStains(g, cam, th, wet, raining);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(stainCv, 0, 0);
    ctx.restore();
  }

  function drawMud(cam, th, rect) {
    const px = 1 / cam.zoom;
    const fine = cam.zoom >= 9;
    const alpha = [0, 0.3, 0.45, 0.6];
    // Allgemeine Naesse nur locker andeuten, Schlamm darueber (Krater, Senken, Sumpf, Wasser) voll zeichnen
    const general = Math.min(3, state.weather?.wet ?? 0);
    for (let m = 1; m <= 3; m++) {
      ctx.beginPath();
      for (const c of mud) {
        if (c.m !== m || c.x < rect.x0 || c.x > rect.x1 || c.y < rect.y0 || c.y > rect.y1) continue;
        const h = hashSeed(c.x, c.y, 77);
        const strong = c.m > general;
        // Leichte allgemeine Naesse nicht zeichnen (sonst rauscht die ganze Karte), ab Stufe 2 locker
        if (!strong && (general < 2 || (h & 255) >= 30 * m)) continue;
        if (!fine) { ctx.rect(c.x, c.y, 1, 1); continue; }
        const dashes = strong ? m : 1;
        for (let i = 0; i < dashes; i++) {
          const y = c.y + 0.25 + i * 0.25 + ((h >> (i * 3)) & 7) * 0.012;
          const x = c.x + 0.15 + ((h >> (i * 5 + 2)) & 7) * 0.03;
          ctx.moveTo(x, y);
          ctx.lineTo(x + 0.45 + ((h >> (i + 9)) & 3) * 0.05, y);
        }
      }
      if (fine) {
        ctx.strokeStyle = rgba(th.mud, alpha[m]);
        ctx.lineWidth = Math.max(0.035, 1.3 * px);
        ctx.lineCap = 'round';
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(th.mud, alpha[m] * 0.25);
        ctx.fill();
      }
    }
  }

  function drawWater(cam, th) {
    const px = 1 / cam.zoom;
    ctx.save();
    ctx.lineCap = 'round';
    for (const c of water) {
      if (c.w) {
        ctx.strokeStyle = rgba(th.water, 0.55 + c.w * 0.12);
        ctx.lineWidth = Math.max(0.05, (1 + c.w) * px);
        ctx.beginPath();
        for (let i = 0; i < c.w; i++) {
          const y = c.y + 0.35 + i * 0.16;
          ctx.moveTo(c.x + 0.15, y);
          ctx.quadraticCurveTo(c.x + 0.32, y - 0.09, c.x + 0.5, y);
          ctx.quadraticCurveTo(c.x + 0.68, y + 0.09, c.x + 0.85, y);
        }
        ctx.stroke();
      }
      if (c.dr) {
        // Lattenrost: zwei Holme, drei Sprossen, Bleistift
        ctx.strokeStyle = rgba(th.pencil, 0.8);
        ctx.lineWidth = Math.max(0.03, 1 * px);
        ctx.beginPath();
        ctx.moveTo(c.x + 0.2, c.y + 0.72); ctx.lineTo(c.x + 0.8, c.y + 0.72);
        ctx.moveTo(c.x + 0.2, c.y + 0.86); ctx.lineTo(c.x + 0.8, c.y + 0.86);
        for (let i = 0; i < 4; i++) { const x = c.x + 0.26 + i * 0.16; ctx.moveTo(x, c.y + 0.68); ctx.lineTo(x, c.y + 0.9); }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawFlares(cam, th, now) {
    const list = state.flares ?? [];
    if (!list.length || !(th.darkness > 0.5)) return;
    const px = 1 / cam.zoom;
    for (const f of list) {
      const k = `${state.turn}:${f.x},${f.y}:${f.side}`;
      const age = still ? FLARE_LIFE.rise + FLARE_LIFE.burn / 3 : now - (flareAnim.get(k) ?? -1e9);
      const { rise, burn, fade } = FLARE_LIFE;
      let light, height;
      if (age < rise) { light = (age / rise) * 0.6; height = 1 - age / rise; }
      else if (age < rise + burn) {
        const p = (age - rise) / burn;
        light = 0.85 + 0.15 * Math.sin(age / 47) * Math.sin(age / 113);
        height = -p * 0.6; // sinkt am Schirm
      } else if (age < rise + burn + fade) { light = 0.85 * (1 - (age - rise - burn) / fade) + 0.2; height = -0.6; }
      else { light = 0.2; height = null; }
      const cx = f.x + 0.5, cy = f.y + 0.5;
      const lx = cx, ly = cy - 1.2 + (height ?? 0) * 2.5;
      // Lichtkreis auf dem Papier
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(lx, ly + 0.6, 0.2, cx, cy, f.r + 0.5);
      g.addColorStop(0, rgba(th.flareLight, 0.5 * light));
      g.addColorStop(0.7, rgba(th.flareLight, 0.26 * light));
      g.addColorStop(1, rgba(th.flareLight, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, f.r + 0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
      // Bleistiftkreis bleibt
      ctx.save();
      ctx.strokeStyle = rgba(th.flareLight, 0.55);
      ctx.setLineDash([0.35, 0.25]);
      ctx.lineWidth = Math.max(0.03, 1.2 * px);
      ctx.beginPath();
      ctx.arc(cx, cy, f.r, 0, TAU);
      ctx.stroke();
      ctx.restore();
      // Die Kugel selbst mit Schirm, solange sie brennt
      if (height !== null) {
        ctx.save();
        ctx.fillStyle = rgba(th.flareLight, 1);
        ctx.beginPath();
        ctx.arc(lx, ly, Math.max(0.12, 3 * px), 0, TAU);
        ctx.fill();
        ctx.strokeStyle = rgba(th.ink, 0.7);
        ctx.lineWidth = Math.max(0.02, 0.8 * px);
        ctx.beginPath();
        ctx.arc(lx, ly - 0.45, 0.28, Math.PI * 1.05, Math.PI * 1.95);
        ctx.moveTo(lx - 0.26, ly - 0.5); ctx.lineTo(lx, ly);
        ctx.moveTo(lx + 0.26, ly - 0.5); ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function drawFog(cam, th, now) {
    const w = state.weather;
    if (w?.kind !== 'fog') return;
    const dens = Math.max(0.3, Math.min(1, w.fog ?? 0.8));
    if (!fogCv) fogCv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
    // Nebel ist weich: halbe Aufloesung genuegt, neu gerechnet hoechstens alle 120 ms oder bei Kamera/Tageszeit
    const fw = Math.max(1, Math.ceil(canvas.width / 2)), fh = Math.max(1, Math.ceil(canvas.height / 2));
    const key = [cam.x, cam.y, cam.zoom, fw, fh, th.darkness, dens, fogHoles.length].join('|');
    if (key !== fogKey || now - fogAt >= 120) {
      fogKey = key;
      fogAt = now;
      renderFog(cam, th, now, dens, fw, fh);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fogCv, 0, 0, canvas.width, canvas.height);
    ctx.restore();
  }

  let fogKey = '', fogAt = -1e9;
  function renderFog(cam, th, now, dens, fw, fh) {
    if (fogCv.width !== fw || fogCv.height !== fh) { fogCv.width = fw; fogCv.height = fh; }
    const f = fogCv.getContext('2d');
    f.setTransform(1, 0, 0, 1, 0, 0);
    f.clearRect(0, 0, fw, fh);
    applyCameraTransform(f, cam, dpr / 2);
    const rect = visibleRect(cam);
    f.fillStyle = rgba(th.fog, (th.dark ? 0.55 : 0.7) * dens);
    f.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
    // Schwaden ziehen mit dem Wind
    const drift = still ? 0 : now / 9000;
    const rr = prng(hashSeed(seed, 'nebel'));
    for (let i = 0; i < 14; i++) {
      const bx = ((rr() * (map.width + 20) + drift * (2 + rr() * 2)) % (map.width + 20)) - 10;
      const by = rr() * map.height;
      const rad = 4 + rr() * 7;
      const g = f.createRadialGradient(bx, by, 0, bx, by, rad);
      g.addColorStop(0, rgba(th.fog, 0.45 * dens));
      g.addColorStop(1, rgba(th.fog, 0));
      f.fillStyle = g;
      f.beginPath();
      f.arc(bx, by, rad, 0, TAU);
      f.fill();
    }
    // Was die eigenen Gruppen im Nebel sehen, bleibt frei
    f.globalCompositeOperation = 'destination-out';
    for (const h of fogHoles) {
      const g = f.createRadialGradient(h.x, h.y, h.r * 0.45, h.x, h.y, h.r);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      f.fillStyle = g;
      f.beginPath();
      f.arc(h.x, h.y, h.r, 0, TAU);
      f.fill();
    }
    f.globalCompositeOperation = 'source-over';
  }

  // Schneedecke: ein heller Hauch ueber dem Papier und feine Tupfen je Feld (deterministisch), dichter mit der Stufe.
  // Felder ohne Schnee (Wasser) bleiben frei. Die Tinte darunter bleibt lesbar.
  function drawSnowCover(cam, th, rect) {
    const lvl = state.weather?.snow | 0;
    if (!lvl || !th.snow) return;
    const x0 = Math.max(0, Math.floor(rect.x0)), x1 = Math.min(map.width, Math.ceil(rect.x1));
    const y0 = Math.max(0, Math.floor(rect.y0)), y1 = Math.min(map.height, Math.ceil(rect.y1));
    ctx.save();
    ctx.fillStyle = rgba(th.snow, (th.dark ? 0.04 : 0.1) * lvl);
    ctx.beginPath();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (snowAt(state, map, x, y)) ctx.rect(x, y, 1, 1);
    ctx.fill();
    ctx.fillStyle = rgba(th.snow, th.dark ? 0.3 : 0.85);
    ctx.beginPath();
    const dots = 2 + lvl * 2;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        if (snowAt(state, map, x, y) === 0) continue;
        const r = prng(hashSeed(seed, x * 977 + y * 131 + 7));
        for (let k = 0; k < dots; k++) {
          const cx = x + r(), cy = y + r(), rad = 0.035 + r() * 0.05;
          ctx.moveTo(cx + rad, cy);
          ctx.arc(cx, cy, rad, 0, TAU);
        }
      }
    }
    ctx.fill();
    ctx.restore();
  }

  // Fallende Flocken (Bildschirmkoordinaten), langsam und leicht nach dem Wind
  function drawSnowfall(cam, th, now) {
    if (state.weather?.kind !== 'snow') return;
    const W = canvas.width, H = canvas.height;
    const n = Math.round((W * H) / (dpr * dpr) / 7000);
    const drift = (WIND_X[state.weather.wind?.dir] ?? 0.5) * 0.02;
    const t = still ? 0 : now / 1000;
    const r = prng(hashSeed(seed, 'schnee'));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = rgba(th.dark ? th.ink : th.snow, th.dark ? 0.55 : 0.9);
    ctx.strokeStyle = rgba(th.ink2, 0.35);
    ctx.lineWidth = 0.6 * dpr;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const sp = 18 + r() * 22;
      const x = ((r() * W + (drift * sp * t * 60) * dpr) % W + W) % W;
      const y = ((r() * H + sp * t * dpr) % H + H) % H;
      const rad = (1.2 + r() * 1.6) * dpr;
      ctx.moveTo(x + rad, y);
      ctx.arc(x, y, rad, 0, TAU);
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawRain(cam, th, now) {
    const w = state.weather;
    if (w?.kind !== 'rain' && w?.kind !== 'storm') return;
    const strength = w.kind === 'storm' ? 1 : Math.max(0.4, w.rain ?? 0.6);
    const slant = (WIND_X[w.wind?.dir] ?? 0.5) * (0.25 + (w.wind?.speed ?? 1) * 0.12);
    const W = canvas.width, H = canvas.height;
    const n = Math.round((W * H) / (dpr * dpr) / 9000 * strength);
    const r = prng(still ? 99 : Math.floor(now / 33));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.strokeStyle = rgba(th.dark ? th.ink2 : th.marsh, th.dark ? 0.45 : 0.5);
    ctx.lineWidth = 1.2 * dpr;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = r() * W, y = r() * H, len = (10 + r() * 14) * dpr;
      ctx.moveTo(x, y);
      ctx.lineTo(x + slant * len, y + len);
    }
    ctx.stroke();
    ctx.restore();
    // Tropfen landen auf dem Papier
    if (!still && r() < 0.35 * strength) {
      const rect = visibleRect(cam);
      const rx = prng(Math.floor(now));
      drops.push({ x: rect.x0 + rx() * (rect.x1 - rect.x0), y: rect.y0 + rx() * (rect.y1 - rect.y0), t0: now, stay: rx() < 0.35 });
    }
  }

  function drawDrops(cam, th, now) {
    const px = 1 / cam.zoom;
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      const p = (now - d.t0) / 420;
      if (p >= 1) {
        drops.splice(i, 1);
        if (d.stay) {
          const rad = (6 + (d.x * 13 % 1) * 8) * px;
          const rr = prng(hashSeed(Math.floor(d.x * 100), Math.floor(d.y * 100)));
          dropStains.push({ cx: d.x, cy: d.y, rad, pts: blob(rr, d.x, d.y, rad, 10) });
          if (dropStains.length > MAX_DROP_STAINS) dropStains.shift();
        }
        continue;
      }
      ctx.save();
      ctx.strokeStyle = rgba(th.dark ? th.ink2 : th.water, 0.7 * (1 - p));
      ctx.lineWidth = Math.max(0.02, 1.2 * px);
      ctx.beginPath();
      ctx.arc(d.x, d.y, (2 + p * 9) * px, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(now = performance.now()) {
    const cam = getCamera();
    const th = getTheme();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!state) return;
    applyCameraTransform(ctx, cam, dpr);
    const w = state.weather ?? {};
    const raining = w.kind === 'rain' || w.kind === 'storm';
    drawStains(cam, th, w.wet ?? 0, raining);
    applyCameraTransform(ctx, cam, dpr);
    drawMud(cam, th, visibleRect(cam));
    drawSnowCover(cam, th, visibleRect(cam));
    drawWater(cam, th);
    drawFlares(cam, th, now);
    drawDrops(cam, th, now);
    drawFog(cam, th, now);
    drawRain(cam, th, now);
    drawSnowfall(cam, th, now);
  }

  const layer = {
    setState(next, opts = {}) {
      const changed = next !== state || (opts.side && opts.side !== side);
      if (opts.side) side = opts.side;
      if (opts.still !== undefined) still = !!opts.still;
      if (!changed) return;
      state = next;
      rebuild();
      layer.invalidate();
      schedule();
    },
    resize(w, h, ratio) {
      dpr = ratio;
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      layer.invalidate();
    },
    invalidate() {
      if (pending || loop) return;
      // Nach der statischen Karte zeichnen (die Tinte unter den Flecken wird von dort kopiert)
      pending = requestAnimationFrame(() => { pending = requestAnimationFrame(() => { pending = 0; draw(); schedule(); }); });
    },
    drawNow() { draw(); },
    destroy() { cancelAnimationFrame(pending); cancelAnimationFrame(loop); },
    get stains() { return dropStains.length; },
    /** Gebliebene Tropfenflecken fuer den Spielstand (P21): nur Mitte und Radius, die Form kommt neu aus dem Seed */
    exportStains() { return dropStains.map((d) => ({ x: +d.cx.toFixed(4), y: +d.cy.toFixed(4), r: +d.rad.toFixed(4) })); },
    importStains(list) {
      if (!Array.isArray(list)) return;
      dropStains.length = 0;
      for (const d of list.slice(-MAX_DROP_STAINS)) {
        if (!Number.isFinite(d?.x) || !Number.isFinite(d?.y) || !Number.isFinite(d?.r)) continue;
        const rr = prng(hashSeed(Math.floor(d.x * 100), Math.floor(d.y * 100))); // wie beim Landen des Tropfens
        dropStains.push({ cx: d.x, cy: d.y, rad: d.r, pts: blob(rr, d.x, d.y, d.r, 10) });
      }
      layer.invalidate();
    },
  };
  return layer;
}
