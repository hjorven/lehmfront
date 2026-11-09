// Werkzeug Sturm (Taste S, Plan 3.3, 4.1 Nr. 9). In Stellungsrunden "Angriff ansetzen" (Befehl attack): das
// Gefecht beginnt nach der Runde. In Gefechtsrunden "Sturm" (assault); fuer den Verteidiger heisst es Gegenstoss.
// Der Weg darf ins Niemandsland und in den feindlichen Graben; die Vorschau zeigt Draht, Einbruch und Dauer.
// Bestaetigt wird mit dem Halten-Ring (HOLD_TYPES aus P03).
// Zeichnet ausserdem: Sturmwege als Bleistiftlinie mit Sturmzacken, Ziele des laufenden Angriffs,
// Unterstaende (eigene Gruppen darin) und den Stabsbefehl zum Gegenstoss.
import { registerTool } from '../tools.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { drawPathOrder } from '../../render/units-layer.js';
import { findPath, enterCost, cellLabel, TERRAIN } from '../../map.js';
import { unitType } from '../../config/units.js';
import { roundsAlong, ASSAULT_TYPES, MAX_ASSAULT_CELLS, enemyWire, liveCell } from '../../phases/move.js';
import { isAttacker, BATTLE_MINUTES, counterMinute } from '../../phases/battle.js';
import { HOLD_TYPES, registerCheck } from '../summary.js';
import { groupName, plural } from '../labels.js';
import { registerCue } from '../../audio/cues.js';
import { FONTS } from '../../render/map-layer.js';

HOLD_TYPES.add('attack');

export function assaultTypeFor(state) {
  return state.turnKind === 'battle' ? 'assault' : 'attack';
}

/** Wort fuer den Befehl: Angriff ansetzen, Sturm oder Gegenstoss */
export function assaultWord(state, side) {
  if (state.turnKind !== 'battle') return 'Angriff ansetzen';
  return state.battle && state.battle.attackers?.length && !isAttacker(state, side) ? 'Gegenstoß' : 'Sturm';
}

/**
 * Sturmweg planen (rein): eigene Gruppen versperren, feindliche nicht (dort beginnt der Nahkampf).
 * Liefert null oder { type, path, reach, rounds, wire, breach, foe }.
 */
export function planAssault(map, state, group, goal) {
  if (goal.x === group.pos.x && goal.y === group.pos.y) return null;
  const own = new Set(state.groups.filter((g) => g.id !== group.id && g.status !== 'lost' && g.side === group.side).map((g) => g.pos.x + ',' + g.pos.y));
  const cost = (c) => (own.has(c.x + ',' + c.y) ? Infinity : enterCost(liveCell(map, state, c.x, c.y)));
  const r = findPath(map, group.pos, goal, { cost });
  if (!r) return null;
  const path = r.path.slice(1);
  if (path.length > MAX_ASSAULT_CELLS) return null;
  const type = assaultTypeFor(state);
  const est = roundsAlong(map, state, group, path, 'battle', type);
  const foe = state.groups.find((g) => g.side !== group.side && g.status !== 'lost' && path.some((p) => p.x === g.pos.x && p.y === g.pos.y)) ?? null;
  return { type, path, ...est, foe };
}

function whyNot(map, state, group, cell) {
  if (!cell) return 'außerhalb der Karte';
  if (!Number.isFinite(enterCost(cell))) return `${TERRAIN[cell.terrain].name}${cell.building ? ' mit Gebäude' : ''}, nicht begehbar`;
  if (state.groups.some((g) => g.id !== group.id && g.side === group.side && g.status !== 'lost' && g.pos.x === cell.x && g.pos.y === cell.y)) return 'dort steht eine eigene Gruppe';
  return `kein Sturmweg dorthin (höchstens ${MAX_ASSAULT_CELLS} Felder)`;
}

/** Zusaetze zur Vorschau aus anderen Paketen (P26: erwartete Verluste, Verweigerung): fn(ctx) -> Text | null */
export const ASSAULT_NOTES = [];

function previewText(state, side, plan, cell, group = null, map = null) {
  const word = assaultWord(state, side);
  const bits = [`${word} auf ${cellLabel(cell.x, cell.y)}`, plural(plan.path.length, 'Feld', 'Felder')];
  bits.push(state.turnKind === 'battle'
    ? `etwa ${plural(plan.rounds, 'Runde', 'Runden')} (${plan.rounds * BATTLE_MINUTES} Min.)`
    : `Gefecht ab nächster Runde, etwa ${plural(plan.rounds, 'Gefechtsrunde', 'Gefechtsrunden')}`);
  if (plan.wire) bits.push(`${plural(plan.wire, 'Feld', 'Felder')} Draht`);
  if (plan.breach >= 0) bits.push('Einbruch in den Graben');
  for (const f of ASSAULT_NOTES) {
    const t = group ? f({ state, side, plan, cell, group, map }) : null;
    if (t) bits.push(t);
  }
  return bits.join(' · ');
}

registerTool({
  id: 'assault',
  key: 's',
  label: 'Sturm',
  order: 35,
  orderTypes: ['assault', 'attack'],
  icon: '<path d="M4 18 L11 11 L14 14 L20 6"/><path d="M15 6 H20 V11"/><path d="M4 12 L7 9"/>',
  describe(o, g, state, map) {
    const dest = o.path[o.path.length - 1];
    const est = roundsAlong(map, state, g, o.path, 'battle', o.type);
    const word = o.type === 'attack' ? 'Angriff angesetzt' : assaultWord(state, g.side);
    return `${word} auf ${cellLabel(dest.x, dest.y)} · ${plural(est.rounds, 'Runde', 'Runden')}${est.wire ? ' · Draht' : ''}`;
  },
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (!ASSAULT_TYPES.has(group.type)) return `${unitType(group.type).name} stürmt nicht`;
    return true;
  },
  begin(ctx) {
    const { group, state, map, side } = ctx;
    const word = assaultWord(state, side);
    ctx.pickCell({
      title: word,
      hint: state.turnKind === 'battle'
        ? `${word}: Ziel für ${groupName(state, group)} antippen. Bestätigt wird mit dem Halten-Ring. Esc bricht ab.`
        : `${word}: Ziel im feindlichen Graben antippen. Nach dieser Stellungsrunde beginnen Gefechtsrunden zu fünf Minuten.`,
      preview(cell) {
        const plan = cell ? planAssault(map, state, group, cell) : null;
        if (!plan) return { path: null, text: cell ? `${cellLabel(cell.x, cell.y)}: ${whyNot(map, state, group, cell)}` : '' };
        return { path: plan.path, reach: plan.reach, text: previewText(state, side, plan, cell, group, map) };
      },
      pick(cell) {
        const plan = cell ? planAssault(map, state, group, cell) : null;
        if (!plan) { ctx.hint(cell ? `${cellLabel(cell.x, cell.y)}: ${whyNot(map, state, group, cell)}.` : 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: plan.type, path: plan.path });
        return true;
      },
    });
  },
});

// Werkzeug Deckung (Taste N, Unterstand): in den Unterstand, Gefechtsrunde
registerTool({
  id: 'dugout',
  shown: (state) => state.turnKind === 'battle', // P06: nur in der passenden Rundenart in der Werkzeugreihe
  key: 'n',
  label: 'Deckung',
  order: 55,
  orderTypes: ['dugout'],
  icon: '<path d="M3 13 H21"/><path d="M6 13 V19 H18 V13"/><path d="M8 9 Q12 5 16 9"/>',
  describe(o, g) {
    return g.inDugout ? 'Bleibt im Unterstand' : 'In den Unterstand';
  },
  canUse(group, state, env) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind !== 'battle') return 'Deckung gibt es nur in Gefechtsrunden';
    if (group.inDugout) return true;
    const t = liveCell(env.map ?? null, state, group.pos.x, group.pos.y)?.trench;
    if (!t || t.side !== (group.side === 'a' ? 'own' : 'enemy') || t.captured || (t.level ?? 0) < 2) return 'Kein Unterstand hier (eigener Graben ab Stufe 2)';
    return true;
  },
  begin(ctx) {
    ctx.setOrder({ group: ctx.group.id, type: 'dugout' });
    ctx.cancel();
  },
});

// Pruefpunkt: Angriff angesetzt (Zusammenfassung) und Stabsbefehl zum Gegenstoss
registerCheck('angriff', ({ state, side, orders }) => {
  const out = [];
  const set = orders.filter((o) => o.type === 'attack');
  if (set.length && state.turnKind !== 'battle') {
    out.push({ tone: 'ok', summary: true, text: `Angriff: Nach dieser Runde beginnen Gefechtsrunden zu fünf Minuten (${plural(set.length, 'Sturmgruppe', 'Sturmgruppen')})` });
  }
  const c = state.battle?.counter?.[side];
  if (c && !c.done && !orders.some((o) => o.type === 'assault')) {
    out.push({ tone: 'warn', summary: true, text: `Stabsbefehl: Gegenstoß auf ${cellLabel(c.at.x, c.at.y)} bis Minute ${counterMinute(c)}`, at: c.at });
  }
  return out;
});

// ------------------------------------------------------------------ Zeichnen

/** Sturmweg: kraeftiger Bleistift mit kleinen Zacken quer zum Weg */
registerOrderPainter('assault', paintAssault);
registerOrderPainter('attack', paintAssault);
function paintAssault(ctx, { group, order, th, px, progress, d }) {
  const est = roundsAlong(d.map, d.state, group, order.path, 'battle', order.type);
  drawPathOrder(ctx, group.pos, order.path, { reach: est.reach, progress, color: th.danger, th, px, seed: order.path.length * 7 + 3 });
  if (progress < 1) return true;
  ctx.save();
  ctx.strokeStyle = th.danger;
  ctx.lineWidth = 1.6 * px;
  ctx.lineCap = 'round';
  ctx.beginPath();
  let prev = group.pos;
  order.path.forEach((p, i) => {
    if (i % 2 === 0 && i < order.path.length - 1) {
      const dx = p.x - prev.x, dy = p.y - prev.y;
      const n = Math.hypot(dx, dy) || 1;
      const nx = -dy / n, ny = dx / n;
      const cx = p.x + 0.5, cy = p.y + 0.5;
      ctx.moveTo(cx - nx * 0.22 - dx / n * 0.12, cy - ny * 0.22 - dy / n * 0.12);
      ctx.lineTo(cx + dx / n * 0.1, cy + dy / n * 0.1);
      ctx.lineTo(cx + nx * 0.22 - dx / n * 0.12, cy + ny * 0.22 - dy / n * 0.12);
    }
    prev = p;
  });
  ctx.stroke();
  // Drahtfelder auf dem Weg markieren
  for (const p of order.path) {
    if (!enemyWire(liveCell(d.map, d.state, p.x, p.y), group.side)) continue;
    ctx.beginPath();
    ctx.arc(p.x + 0.5, p.y + 0.5, 0.42, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  return true;
}

registerDecor({
  id: 'battle-marks',
  order: 60,
  draw(ctx, d) {
    const { state, theme: th, px, side } = d;
    if (!state) return;
    ctx.save();
    // Ziele des eigenen Angriffs: Bleistiftkreis mit "Ziel"
    const objs = (state.battle?.objectives?.[side] ?? []).filter((o, i, all) => all.findIndex((p) => p.x === o.x && p.y === o.y) === i);
    ctx.strokeStyle = th.danger;
    ctx.fillStyle = th.danger;
    ctx.lineWidth = 2 * px;
    ctx.font = `700 ${15 * px}px ${FONTS.hand}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    for (const o of objs) {
      ctx.beginPath();
      ctx.ellipse(o.x + 0.5, o.y + 0.5, 0.95, 0.8, -0.2, 0.3, Math.PI * 2 + 0.1);
      ctx.stroke();
      ctx.fillText('Ziel', o.x + 1.3, o.y + 0.2);
    }
    // Stabsbefehl zum Gegenstoss: Pfeil auf den verlorenen Graben
    const c = state.battle?.counter?.[side];
    if (c && !c.done) {
      ctx.setLineDash([5 * px, 4 * px]);
      ctx.beginPath();
      ctx.rect(c.at.x - 0.1, c.at.y - 0.1, 1.2, 1.2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillText(`Gegenstoß bis Min. ${counterMinute(c)}`, c.at.x + 1.4, c.at.y + 1.1);
    }
    // Eigene Gruppen im Unterstand: Dach ueber dem Symbol, beim Herauskommen gestrichelt
    ctx.strokeStyle = th.ink;
    ctx.lineWidth = 2 * px;
    for (const g of d.groups ?? []) {
      if (!g.inDugout || g.status === 'lost') continue;
      const real = state.groups.find((x) => x.id === g.id);
      const leaving = real?.dugout === 'leaving';
      const cx = g.pos.x + 0.5, top = g.pos.y + 0.5 - Math.max(0.5, 9 * px) - 5 * px;
      const w = Math.max(0.75, 14 * px);
      ctx.setLineDash(leaving ? [3 * px, 3 * px] : []);
      ctx.beginPath();
      ctx.moveTo(cx - w, top + 4 * px);
      ctx.quadraticCurveTo(cx, top - 6 * px, cx + w, top + 4 * px);
      ctx.stroke();
      ctx.setLineDash([]);
      if (g.side === side) {
        ctx.fillStyle = th.pencil;
        ctx.font = `700 ${13 * px}px ${FONTS.hand}`;
        ctx.textAlign = 'center';
        ctx.fillText(leaving ? 'kommt rauf' : 'Unterstand', cx, top - 7 * px);
        ctx.textAlign = 'left';
      }
    }
    ctx.restore();
  },
});

// Klang: Pfeife zum Sturm ist vorbelegt (assault); Draht, Einbruch, Nahkampf, Unterstand melden sich hier an
registerCue('wire_cut', () => [{ name: 'pencil', opts: { count: 3, intensity: 0.5 } }]);
registerCue('breach', () => [{ name: 'whistle', opts: { intensity: 0.6 } }]);
registerCue('melee', () => [{ name: 'rifle', opts: { count: 4, intensity: 0.7 } }]);
registerCue('dugout_in', () => [{ name: 'steps', opts: { intensity: 0.4 } }]);
registerCue('battle_start', () => [{ name: 'clock-lock', opts: { intensity: 1 } }]);


