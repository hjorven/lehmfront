// Werkzeuge und Kartenzeichnung fuer Akt 4 (P26, Plan 4.2 Nr. 23 und 24): Brücke bauen (Taste 8), Verlust-
// schaetzung in der Sturmvorschau mit Verweigerung, Pruefpunkte vor der Runde. Zeichnet die Bruecke Joch fuer Joch,
// die Galerie der grossen Mine mit der Zuendschnur, Kreide nach der Sprengung, gefundene Fallen, den festgefahrenen
// Panzerwagen und das Wrack des Kastens. Klaenge: Motor, Mine, Spaten auf der Granathuelse.
import { registerTool } from '../tools.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { registerCheck } from '../summary.js';
import { registerCue } from '../../audio/cues.js';
import { cellLabel } from '../../map.js';
import { featureOn } from '../../underground.js';
import { bridgeLine, bridgeProblem, bridgeRounds, bridgeProgress } from '../../bridge.js';
import { refusalFor, refusalActive, knownFoes } from '../../refusal.js';
import { visibleEnemies } from '../../sight.js';
import { mineCells, mineLeft } from '../../phases/mine.js';
import { BRIDGE } from '../../config/akt4.js';
import { groupName, plural, MARKS } from '../labels.js';
import { ASSAULT_NOTES } from './assault.js';
import { FONTS } from '../../render/map-layer.js';

MARKS.tank = 'Pw';

const on = (state, f) => featureOn(state, f);
const position = (state) => state.turnKind !== 'battle';

function note(ctx, text, x, y, color, px, size = 14, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${size * px}px ${FONTS.hand}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ------------------------------------------------------------------------------------------- Bruecke (8)

/** Vorschau: { ok, path, text } */
export function bridgePreview(map, state, group, cell) {
  if (!cell) return { ok: false, path: null, text: '' };
  const path = bridgeLine(map, group, cell);
  if (!path) return { ok: false, path: null, text: `${cellLabel(cell.x, cell.y)}: kein Wasser direkt neben der Gruppe in dieser Richtung, oder das andere Ufer ist zu weit` };
  const why = bridgeProblem(map, state, group, path);
  if (why) return { ok: false, path: null, text: `${cellLabel(cell.x, cell.y)}: ${why}` };
  const pr = bridgeProgress(state, path);
  const n = bridgeRounds(state, group, path);
  return {
    ok: true, path,
    text: `Brücke über ${plural(path.length, 'Feld', 'Felder')} Wasser · ${pr.done ? `${pr.done} Joche stehen · ` : ''}allein etwa ${plural(n, 'Stellungsrunde', 'Stellungsrunden')} · mit Gleis`,
  };
}

registerTool({
  id: 'bridge',
  key: '8',
  label: 'Brücke',
  order: 80,
  icon: '<path d="M3 15 H21"/><path d="M5 15 V19"/><path d="M12 15 V19"/><path d="M19 15 V19"/><path d="M3 12 C8 8 16 8 21 12"/>',
  shown: (state) => on(state, 'bridge') && position(state),
  describe(o) {
    const end = o.path?.[o.path.length - 1];
    return end ? `Brücke bauen bis ${cellLabel(end.x, end.y)}` : 'Brücke bauen';
  },
  canUse(group, state) {
    if (!on(state, 'bridge')) return 'Brücken baut der Abschnitt erst in Akt 4';
    if (!position(state)) return 'Gebaut wird in der Stellungsrunde';
    if (!BRIDGE.builders.includes(group.type)) return 'Brücken bauen Pioniere und Schützen';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Brücke bauen',
      hint: `Brücke: das Wasserfeld neben ${groupName(state, group)} antippen, in dessen Richtung die Brücke laufen soll. Erst die Joche, dann das Gleis. Treffer reißen Arbeit wieder ein.`,
      preview: (cell) => {
        const p = bridgePreview(map, state, group, cell);
        return { path: p.path, text: p.text };
      },
      pick(cell) {
        const p = bridgePreview(map, state, group, cell);
        if (!p.ok) { ctx.hint(p.text || 'Kein Wasser'); return false; }
        ctx.setOrder({ group: group.id, type: 'bridge', path: p.path });
        return true;
      },
    });
  },
});

registerOrderPainter('bridge', (ctx, { order, th, px }) => {
  const path = order.path;
  if (!path?.length) return false;
  ctx.save();
  ctx.strokeStyle = th.pencil;
  ctx.lineWidth = 1.6 * px;
  ctx.setLineDash([3 * px, 3 * px]);
  for (const p of path) ctx.strokeRect(p.x + 0.12, p.y + 0.22, 0.76, 0.56);
  ctx.restore();
  const end = path[path.length - 1];
  note(ctx, 'Brücke', end.x + 1.1, end.y + 0.5, th.pencil, px, 13);
  return true;
});

// ------------------------------------------------------------------------------------------- Sturmvorschau

ASSAULT_NOTES.push(({ state, side, plan, group, map }) => {
  if (!map || !plan?.path?.length) return null;
  const foes = knownFoes(map, state, side, visibleEnemies(state, map, side), plan.path[plan.path.length - 1]);
  if (!foes.length) return null;
  const r = refusalFor(map, state, group, plan.path, foes);
  if (!r.warn) return r.pct >= 25 ? `erwartete Verluste etwa ${r.pct} %` : null;
  if (r.outcome === 'refuse') return `erwartete Verluste etwa ${r.pct} %: die Gruppe wird nicht gehen`;
  if (r.outcome === 'harms') return `erwartete Verluste etwa ${r.pct} %: Harms wird mit ihnen reden müssen`;
  if (r.outcome === 'brandt') return `erwartete Verluste etwa ${r.pct} %: sie folgen Brandt`;
  return `Warnung: erwartete Verluste etwa ${r.pct} %`;
});

// ------------------------------------------------------------------------------------------- Pruefpunkte

registerCheck('verweigerung', ({ state, side, orders, map }) => {
  if (!map) return [];
  const list = (orders ?? []).filter((o) => (o.type === 'attack' || o.type === 'assault') && o.path?.length);
  if (!list.length) return [];
  const seen = visibleEnemies(state, map, side);
  const out = [];
  for (const o of list) {
    const g = (state.groups ?? []).find((x) => x.id === o.group);
    if (!g) continue;
    const r = refusalFor(map, state, g, o.path, knownFoes(map, state, side, seen, o.path[o.path.length - 1]));
    if (!r.warn) continue;
    const who = groupName(state, g);
    if (r.outcome === 'refuse') out.push({ tone: 'warn', summary: true, group: g.id, text: `${who} wird den Sturm verweigern (etwa ${r.pct} % Verluste)` });
    else if (refusalActive(state, side) || state.sides?.[side]?.campaign) out.push({ tone: 'warn', summary: true, group: g.id, text: `${who}: Sturm mit etwa ${r.pct} % erwarteten Verlusten. Die Truppe merkt sich das.` });
  }
  return out;
});

registerCheck('mine', ({ state, side }) => {
  const m = state.sides?.[side]?.mine;
  if (!m || m.status !== 'ready') return [];
  const left = mineLeft(m);
  return [{ tone: left <= 1 ? 'warn' : 'ok', summary: left <= 1, at: m.chamber, text: left <= 1 ? `${m.label}: Zündung nach dieser Runde. Niemand auf ${m.place ?? 'dem Hügel'}!` : `${m.label}: Zündung in ${plural(left, 'Stellungsrunde', 'Stellungsrunden')}` }];
});

// ------------------------------------------------------------------------------------------- Karte

const hash = (x, y, i) => (((x * 73856093) ^ (y * 19349663) ^ (i * 83492791)) >>> 0) % 1000 / 1000;

registerDecor({
  id: 'akt4-ground',
  order: 19,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.cells) return;
    const th = d.theme, px = d.px;
    ctx.save();
    for (const k of Object.keys(st.cells).sort()) {
      const c = st.cells[k];
      if (!c) continue;
      const [x, y] = k.split(',').map(Number);
      // Kreide, die nach der grossen Mine gefallen ist: helle Brocken
      if (c.chalk) {
        ctx.fillStyle = th.card;
        ctx.strokeStyle = th.chalk;
        ctx.lineWidth = 1 * px;
        for (let i = 0; i < 4; i++) {
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x + 0.15 + hash(x, y, i) * 0.7, y + 0.15 + hash(x, y, i + 7) * 0.7, 0.05 + hash(x, y, i + 3) * 0.06, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
      }
      // Bruecke: Joche als Querbalken, fertig mit Bohlen, mit Gleis zwei Schienen
      if (c.bridge) {
        const b = c.bridge;
        const part = Math.min(1, (b.work ?? 0) / BRIDGE.work);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = th.ink;
        ctx.lineWidth = 2 * px;
        const n = Math.max(1, Math.round(part * 4));
        for (let i = 0; i < n; i++) {
          const bx = x + 0.12 + i * 0.25;
          ctx.beginPath();
          ctx.moveTo(bx, y + 0.18);
          ctx.lineTo(bx, y + 0.82);
          ctx.stroke();
        }
        if (b.done) {
          ctx.lineWidth = 1.6 * px;
          ctx.strokeRect(x, y + 0.18, 1, 0.64);
        }
        if (c.rail) {
          ctx.strokeStyle = th.rail;
          ctx.lineWidth = 1.4 * px;
          ctx.beginPath();
          ctx.moveTo(x, y + 0.38); ctx.lineTo(x + 1, y + 0.38);
          ctx.moveTo(x, y + 0.62); ctx.lineTo(x + 1, y + 0.62);
          ctx.stroke();
        }
      }
      // Gefundene Falle: Kreuz mit Kreis, "Falle"
      if (c.trap && c.trapFound) {
        ctx.globalAlpha = c.trapFired ? 0.5 : 0.9;
        ctx.strokeStyle = th.danger;
        ctx.lineWidth = 1.6 * px;
        ctx.beginPath();
        ctx.arc(x + 0.5, y + 0.5, 0.28, 0, Math.PI * 2);
        ctx.moveTo(x + 0.3, y + 0.3); ctx.lineTo(x + 0.7, y + 0.7);
        ctx.moveTo(x + 0.7, y + 0.3); ctx.lineTo(x + 0.3, y + 0.7);
        ctx.stroke();
      }
      // Wrack des Kastens: Raute mit gebrochener Kette, beide Seiten liegen dahinter (Ueberraschung)
      if (c.wreck) {
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = th.ink;
        ctx.fillStyle = th.faint;
        ctx.lineWidth = 2 * px;
        ctx.beginPath();
        ctx.moveTo(x + 0.08, y + 0.6); ctx.lineTo(x + 0.3, y + 0.3); ctx.lineTo(x + 0.92, y + 0.36); ctx.lineTo(x + 0.75, y + 0.72); ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 0.15, y + 0.8); ctx.lineTo(x + 0.45, y + 0.86);
        ctx.moveTo(x + 0.55, y + 0.9); ctx.lineTo(x + 0.85, y + 0.84);
        ctx.stroke();
      }
    }
    ctx.restore();
    for (const k of Object.keys(st.cells).sort()) {
      const c = st.cells[k];
      if (!c?.wreck && !(c?.trap && c.trapFound && !c.trapFired)) continue;
      const [x, y] = k.split(',').map(Number);
      if (c.wreck) note(ctx, `Wrack ${c.wreck.label ?? 'K1'}`, x + 0.5, y - 0.2, th.pencil, px, 13, 'center');
      else note(ctx, 'Falle', x + 0.95, y + 0.5, th.danger, px, 12);
    }
  },
});

registerDecor({
  id: 'akt4-marks',
  order: 93,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.sides) return;
    const th = d.theme, px = d.px;
    // Galerie der grossen Mine: gestrichelt unter der Erde, Kammer als Kreis, die Zuendschnur zaehlt mit
    const m = st.sides[d.side]?.mine;
    if (m && m.status === 'ready') {
      const cells = mineCells(m);
      ctx.save();
      ctx.strokeStyle = th.own;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([2 * px, 4 * px]);
      ctx.beginPath();
      cells.forEach((p, i) => (i ? ctx.lineTo(p.x + 0.5, p.y + 0.5) : ctx.moveTo(p.x + 0.5, p.y + 0.5)));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(m.chamber.x + 0.5, m.chamber.y + 0.5, 0.42, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      const left = mineLeft(m);
      note(ctx, left <= 1 ? 'Zündung!' : `Zündung in ${left}`, m.chamber.x + 0.5, m.chamber.y - 0.45, th.own, px, 15, 'center');
    }
    // Festgefahrene Panzerwagen
    for (const g of d.groups ?? []) {
      if (g.type !== 'tank' || !g.stuck || g.status === 'lost') continue;
      note(ctx, 'steckt fest', g.pos.x + 0.5, g.pos.y + 1.25, g.side === d.side ? th.own : th.enemy, px, 13, 'center');
    }
    // Gruppen, die in dieser Runde den Sturm verweigert haben (nur eigene)
    for (const g of d.groups ?? []) {
      if (g.side !== d.side || !g.refused || g.status === 'lost') continue;
      note(ctx, 'verweigert', g.pos.x + 0.5, g.pos.y - 0.3, th.pencil, px, 12, 'center');
    }
  },
});

// ------------------------------------------------------------------------------------------- Klaenge

registerCue('tank_shock', () => [{ name: 'engine', opts: { intensity: 0.6 } }]);
registerCue('tank_stuck', () => [{ name: 'engine', opts: { intensity: 0.35 } }]);
registerCue('tank_freed', () => [{ name: 'engine', opts: { intensity: 0.45 } }]);
registerCue('mine_great', () => [{ name: 'mine', opts: { intensity: 1 } }]);
registerCue('ceasefire', () => [{ name: 'spade', opts: { intensity: 0.7, count: 3 } }, { name: 'hush', delay: 3.2 }]);
registerCue('assault_refused', () => [{ name: 'hush' }]);
registerCue('trap', () => [{ name: 'impact-near', opts: { intensity: 0.45 } }]);
registerCue('bridge_done', () => [{ name: 'lore', opts: { intensity: 0.5 } }]);
