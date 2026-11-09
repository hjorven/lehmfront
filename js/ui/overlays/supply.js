// Overlay 1 Versorgung (Plan 7.4): Loren als fliessende Punkte vom Depot ueber Gleis und Laufgraben nach vorn,
// Verwundete als rote Kreuze zurueck, Engpaesse schraffiert, Bruchstellen mit Kreuz und Notiz.
// Zeichnet in Weltkoordinaten (1 = ein Feld). Rechnung aus js/supply.js, hier nur Darstellung.
import { registerOverlay } from '../overlays.js';
import { supplyNetwork, planPreview, mapSide, trenchAt } from '../../supply.js';
import { currentWagons } from '../tools/supply.js';

const cache = new WeakMap();

function model(map, state, side, plans) {
  const wagons = currentWagons(map, state, side, plans);
  const k = side + JSON.stringify(wagons);
  const hit = cache.get(state);
  if (hit && hit.k === k) return hit.m;
  const m = { net: supplyNetwork(map, state, side), pv: planPreview(map, state, side, wagons) };
  cache.set(state, { k, m });
  return m;
}

function polyLen(pts) {
  let n = 0;
  for (let i = 1; i < pts.length; i++) n += Math.sqrt((pts[i].x - pts[i - 1].x) ** 2 + (pts[i].y - pts[i - 1].y) ** 2);
  return n;
}

function pointAt(pts, s) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    if (s <= d || i === pts.length - 1) {
      const t = d ? Math.min(1, s / d) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    s -= d;
  }
  return pts[0];
}

function hatch(ctx, x, y, px) {
  ctx.moveTo(x, y + 0.5); ctx.lineTo(x + 0.5, y);
  ctx.moveTo(x, y + 1); ctx.lineTo(x + 1, y);
  ctx.moveTo(x + 0.5, y + 1); ctx.lineTo(x + 1, y + 0.5);
}

function cross(ctx, x, y, r) {
  ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
}

registerOverlay({
  slot: 1,
  id: 'supply',
  label: 'Versorgung',
  animated: true,
  draw(ctx, { map, state, side, theme, px, plans, time = 0 }) {
    const { net, pv } = model(map, state, side, plans);
    const byId = new Map(pv.sections.map((s) => [s.id, s]));
    const ms = mapSide(side);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Engpaesse: abgeschnittene Abschnitte rot, knappe (unter zwei Runden) in Ocker schraffiert
    for (const sec of net.sections) {
      const p = byId.get(sec.id);
      if (!p.upkeep.groups) continue;
      const short = p.connected && ((p.rounds.food ?? 9) < 2 || (p.rounds.ammo ?? 9) < 2);
      if (p.connected && !short) continue;
      ctx.strokeStyle = p.connected ? theme.accent : theme.danger;
      ctx.lineWidth = Math.max(px * 1.4, 0.05);
      ctx.globalAlpha = 0.8;
      ctx.beginPath();
      for (let y = sec.y0; y <= sec.y1; y++) {
        for (let x = 0; x < map.width; x++) {
          const t = trenchAt(map, state, x, y);
          if (t && t.side === ms) hatch(ctx, x, y, px);
        }
      }
      ctx.stroke();
    }

    // Verschuettete Graeben und zerschossene Gleise
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = theme.danger;
    ctx.lineWidth = Math.max(px * 2.2, 0.08);
    ctx.beginPath();
    for (const k of Object.keys(state.cells).sort()) {
      const c = state.cells[k];
      if (!c?.trenchBlocked && !c?.railBroken) continue;
      const [x, y] = k.split(',').map(Number);
      cross(ctx, x + 0.5, y + 0.5, 0.32);
    }
    ctx.stroke();

    // Wege und fliessende Loren
    const speed = 2.4; // Felder je Sekunde
    for (const sec of net.sections) {
      const p = byId.get(sec.id);
      if (!sec.route.length) continue;
      const pts = sec.route.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
      let live = pts;
      if (!sec.connected && sec.cutAt) {
        const i = sec.route.findIndex((c) => c.x === sec.cutAt.x && c.y === sec.cutAt.y);
        live = pts.slice(0, Math.max(1, i + 1));
      }
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = theme.ink2;
      ctx.lineWidth = Math.max(px * 1.2, 0.04);
      ctx.setLineDash([0.25, 0.2]);
      ctx.beginPath();
      pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.stroke();
      ctx.setLineDash([]);
      const len = polyLen(live);
      if (len <= 0) continue;
      const t = time / 1000;
      const carts = p.carts + p.medicCarts + p.blockedCarts;
      // Je Lore ein Punkt, gleichmaessig verteilt; abgeschnittene stauen sich an der Bruchstelle
      ctx.globalAlpha = 1;
      for (let i = 0; i < carts; i++) {
        let s = ((t * speed + (i * len) / Math.max(1, carts)) % (len + 2));
        if (s > len) continue;
        if (!sec.connected) s = Math.min(s, len - 0.15 - i * 0.35);
        const q = pointAt(live, Math.max(0, s));
        ctx.fillStyle = sec.connected ? theme.own : theme.danger;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 0.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = theme.card ?? theme.paper;
        ctx.lineWidth = Math.max(px, 0.03);
        ctx.stroke();
      }
      // Verwundete fahren zurueck: rote Kreuze gegen die Fahrtrichtung
      if (p.woundedBack && sec.connected) {
        ctx.strokeStyle = theme.danger;
        ctx.lineWidth = Math.max(px * 2, 0.07);
        const n = Math.min(6, p.woundedBack);
        for (let i = 0; i < n; i++) {
          const s = len - ((t * speed * 0.8 + (i * len) / n + len / (2 * n)) % len);
          const q = pointAt(live, s);
          ctx.beginPath();
          ctx.moveTo(q.x - 0.18, q.y); ctx.lineTo(q.x + 0.18, q.y);
          ctx.moveTo(q.x, q.y - 0.18); ctx.lineTo(q.x, q.y + 0.18);
          ctx.stroke();
        }
      }
    }

    // Abschnittsschilder: Buchstabe, Reichweite des Vorrats, wartende Verwundete
    const fs = Math.max(0.42, 13 * px);
    ctx.font = `700 ${fs}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'middle';
    for (const sec of net.sections) {
      const p = byId.get(sec.id);
      if (!p.upkeep.groups && !p.wounded) continue;
      const a = sec.anchor;
      const r = (n) => (n === null ? '–' : String(n));
      const txt = sec.connected
        ? `${sec.id}  Verpf ${r(p.rounds.food)} · Mun ${r(p.rounds.ammo)}${p.woundedLeft ? `  +${p.woundedLeft}` : ''}`
        : `${sec.id}  abgeschnitten${p.wounded ? `  +${p.wounded}` : ''}`;
      const w = ctx.measureText(txt).width + fs;
      const x = a.x + 0.5 - (side === 'a' ? w + 0.8 : -0.8), y = a.y + 0.5;
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = theme.card ?? theme.paper;
      ctx.fillRect(x, y - fs * 0.8, w, fs * 1.6);
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(px * 1.5, 0.04);
      ctx.strokeStyle = sec.connected ? theme.ink : theme.danger;
      ctx.strokeRect(x, y - fs * 0.8, w, fs * 1.6);
      ctx.fillStyle = sec.connected ? theme.ink : theme.danger;
      ctx.fillText(txt, x + fs * 0.5, y + fs * 0.05);
      if (!sec.connected && sec.cutAt) {
        ctx.font = `700 ${fs * 1.5}px "Caveat", cursive`;
        ctx.fillStyle = theme.danger;
        ctx.fillText('Weg zu', sec.cutAt.x + 1, sec.cutAt.y - 0.2);
        ctx.font = `700 ${fs}px "IBM Plex Mono", monospace`;
      }
    }
    ctx.restore();
  },
});
