// Moral, Erschoepfung, Abloesung, Ersatz (Plan 4.1 Nr. 12, 2.2, 2.6, 5, 10.6 Stellungsrunde 6 und 8, Gefechtsrunde 7).
// Formeln in js/morale.js, Zahlen in js/config/morale.js.
//
// Phasen:
// - 'relieve' (Stellungsrunde, nach der Bewegung): Befehl Abloesen { group, type: 'relieve', by? }. Die Gruppe vorn geht
//   ins Ruhelager (g.status = 'rest', g.restAt), die Abloesung (by, aus Reserve oder Ruhe) uebernimmt ihr Feld.
//   Rechtzeitig abgeloest (hoechstens TOO_LONG Runden vorn): Vertrauen +1.
// - 'morale' (Stellungsrunde, Plan 10.6 Nr. 8): Verluste und gefallene Gruppenfuehrer, Erschoepfung vorn, Erholung in
//   Reserve und Ruhelager (Etappenertrag erholung, moral, trost), zu lange vorn (Moral, Vertrauen), Ersatz (Befehl
//   { group, type: 'refill' }), Abschnittsmoral in state.sides[s].morale.
// - 'morale' (Gefechtsrunde, Plan 10.6 Nr. 7): Verluste, Gruppenfuehrer, Erschoepfung, Moralproben (haelt, wirft sich
//   hin, weicht ein Feld zurueck).
// - 'morale-end' (Gefechtsrunde, nach dem Gefechtsende): Moral nach gewonnenem oder verlorenem Gefecht.
//
// Ereignisse: relieved, refilled, leader_fallen, morale_loss, morale_check, morale_break, too_long, trust_front,
// trust_relief, morale_battle. Alle tragen side und sind geheim (der Gegner sieht nur, was er sieht).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { registerDigFactor } from './dig.js';
import { cellLabel, TERRAIN } from '../map.js';
import { byId, compareId, newLeader, otherSide, SIDES } from '../state.js';
import { PINNED } from '../sight.js';
import * as C from '../config/morale.js';
import {
  postOf, moraleFactors, fatigueGain, fatigueRecovery, moraleRecovery, moraleCap, frontMoraleLoss, lossMorale,
  leaderMorale, leaderChance, checkChance, checkOutcome, sectionMorale, sectionIdAt, freeRestCell, restCamps,
  replacementTenths, refillPreview, surname, digFatiguePct,
} from '../morale.js';

const name = (g) => 'Gruppe ' + surname(g.leader?.name);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function yieldOf(state, side) {
  return state.sides[side]?.etappe?.yield ?? {};
}

function replacementsOf(state, side) {
  const s = state.sides[side];
  s.replacements ??= { tenths: 0 };
  return s.replacements;
}

/** Ersatz, der gerade bereitsteht: { pool (gruen), veterans (Genesene aus dem Lazarett) } */
export function replacementStock(state, side) {
  const s = state.sides[side];
  return { pool: Math.floor((s?.replacements?.tenths ?? 0) / 10), veterans: s?.supply?.reserveMen ?? 0 };
}

/** Erfahrung, mit der gruener Ersatz kommt (Ausbildungslager: 1 statt 0) */
export function greenXp(state, side) {
  return (yieldOf(state, side).ausbildung ?? 0) > 0 ? 1 : 0;
}

function usedNames(state, side) {
  const used = new Set();
  for (const g of state.groups) if (g.side === side && g.leader?.name) used.add(g.leader.name);
  for (const f of state.fallen ?? []) if (f.side === side && f.name) used.add(f.name);
  return used;
}

// ------------------------------------------------------------------ Verluste und Gruppenfuehrer

/** Verluste dieser Runde (aus dem Protokoll) auf die Moral anrechnen; der Gruppenfuehrer kann darunter sein */
function applyLosses(ctx) {
  const { state } = ctx;
  const hits = new Map();
  for (const e of ctx.log) {
    if (e.type !== 'losses' || !(e.amount > 0) || !e.group) continue;
    hits.set(e.group, (hits.get(e.group) ?? 0) + e.amount);
  }
  const out = { losses: new Set(), leader: new Set() };
  for (const id of [...hits.keys()].sort(compareId)) {
    const g = ctx.group(id);
    if (!g || g.status === 'lost') continue; // aufgerieben oder gefangen: steht schon in der Gefallenenliste
    const amount = hits.get(id);
    const f = moraleFactors(state, g.side);
    const trost = yieldOf(state, g.side).trost ?? 0;
    const loss = lossMorale(amount, g.size, { breakFactor: f.breakFactor, trost });
    g.morale = clamp(g.morale - loss, 0, 100);
    out.losses.add(id);
    // Gruppenfuehrer: ein Wurf je Gruppe und Runde
    const chance = leaderChance(amount, g.strength + amount);
    const roll = Math.floor(ctx.rng() * 100);
    let fell = null;
    if (roll < chance) {
      fell = { ...g.leader };
      state.fallen.push({ name: fell.name, home: fell.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos }, cause: 'leader' });
      g.leader = newLeader(ctx.rng, state.sides[g.side].faction, usedNames(state, g.side));
      const drop = leaderMorale({ breakFactor: f.breakFactor });
      g.morale = clamp(g.morale - drop, 0, 100);
      g.shock = C.LEADER_SHOCK;
      g.leaderFell = { name: fell.name, home: fell.home, turns: C.LEADER_SHOCK };
      out.leader.add(id);
      ctx.emit('leader_fallen', {
        side: g.side, group: g.id, secret: true, fallen: fell.name, successor: g.leader.name, amount: drop,
        reason: `${fell.name} aus ${fell.home} ist gefallen. ${g.leader.name} übernimmt die Gruppe. Die Leute sind wie gelähmt, Moral −${drop}.`,
        at: { ...g.pos },
      });
    }
    ctx.emit('morale_loss', {
      side: g.side, group: g.id, secret: true, minor: true, amount: loss,
      reason: `${name(g)}: ${plural(amount, 'Verlust', 'Verluste')} drücken die Moral um ${loss} auf ${g.morale}${trost > 0 ? ' (die Kapelle tröstet etwas)' : ''}.`,
      at: { ...g.pos },
    });
  }
  // Gefangennahme in der Naehe (P06: group_captured)
  for (const e of ctx.log) {
    if (e.type !== 'group_captured' || !e.at) continue;
    for (const g of ctx.groups(e.side)) {
      if (g.id === e.group || postOf(ctx.map, g) !== 'front') continue;
      if (Math.max(Math.abs(g.pos.x - e.at.x), Math.abs(g.pos.y - e.at.y)) > C.CAPTURED_NEAR) continue;
      g.morale = clamp(g.morale - C.CAPTURED_MORALE, 0, 100);
      ctx.emit('morale_loss', {
        side: g.side, group: g.id, secret: true, minor: true, amount: C.CAPTURED_MORALE,
        reason: `${name(g)} sieht die Kameraden mit erhobenen Händen abziehen. Moral −${C.CAPTURED_MORALE}.`,
        at: { ...g.pos },
      });
    }
  }
  return out;
}

function storeSections(ctx) {
  if (!ctx.map) return;
  for (const side of SIDES) {
    if (!ctx.state.sides[side]) continue;
    ctx.state.sides[side].morale = sectionMorale(ctx.map, ctx.state, side);
  }
}

// ------------------------------------------------------------------ Abloesen (Stellungsrunde)

function runRelieve(ctx) {
  const { state, map } = ctx;
  // Ruhende Gruppen, die woandershin gegangen sind, ruhen nicht mehr
  for (const g of ctx.groups()) {
    if (g.status === 'rest' && g.restAt && (g.pos.x !== g.restAt.x || g.pos.y !== g.restAt.y)) {
      g.status = 'front';
      delete g.restAt;
    }
  }
  const orders = ctx.ordersOfType('relieve');
  if (!orders.length) return;
  const taken = new Set();
  const usedRelief = new Set();
  const relieved = { a: 0, b: 0 };
  for (const o of orders) {
    const g = ctx.group(o.group);
    if (!g || postOf(map, g) !== 'front') continue;
    const at = { ...g.pos };
    let r = o.by ? ctx.group(o.by) : null;
    let note = '';
    if (r && (r.side !== g.side || postOf(map, r) === 'front' || usedRelief.has(r.id))) { note = ` ${name(r)} kann nicht kommen.`; r = null; }
    if (r) {
      const ro = ctx.orderFor(r.id);
      if (ro && ro.type !== 'hold') { note = ` ${name(r)} hat einen anderen Befehl.`; r = null; }
    }
    const from = r ? { ...r.pos } : null;
    const spot = freeRestCell(map, state, g.side, from ?? at, taken);
    const dest = spot?.cell ?? from;
    if (!dest) {
      ctx.emit('relieve_failed', {
        side: g.side, group: g.id, secret: true,
        reason: `${name(g)} kann nicht abgelöst werden: kein Platz im Ruhelager und keine Ablösung.`, at,
      });
      continue;
    }
    const timely = (g.frontTurns ?? 0) >= 1 && (g.frontTurns ?? 0) <= C.TOO_LONG;
    const turns = g.frontTurns ?? 0;
    if (r) {
      usedRelief.add(r.id);
      r.pos = { ...at };
      r.facing = g.facing;
      r.inDugout = false;
      r.status = 'front';
      delete r.restAt;
      r.frontTurns = 0;
    }
    g.pos = { x: dest.x, y: dest.y };
    g.inDugout = false;
    delete g.dugout;
    g.suppressed = 0;
    if (spot) {
      taken.add(dest.x + ',' + dest.y);
      g.status = 'rest';
      g.restAt = { x: dest.x, y: dest.y };
    }
    g.frontTurns = 0;
    if (timely) relieved[g.side]++;
    const where = cellLabel(at.x, at.y);
    const camp = spot ? (spot.camp ? 'ins Ruhelager' : 'in die Scheunen hinter dem Depot') : 'in die Reserve';
    const reason = r
      ? `${name(r)} löst ${name(g)} bei ${where} ab. ${name(g)} geht nach ${plural(turns, 'Runde', 'Runden')} vorn ${camp}.${note}`
      : `${name(g)} verlässt nach ${plural(turns, 'Runde', 'Runden')} die Stellung bei ${where} und geht ${camp}. Das Feld bleibt leer.${note}`;
    ctx.emit('relieved', {
      side: g.side, group: g.id, secret: true, by: r?.id ?? null, from: at, to: { ...g.pos }, turns, empty: !r,
      reason, at,
    });
  }
  for (const side of SIDES) {
    const n = Math.min(C.TRUST_RELIEF_MAX, relieved[side] * C.TRUST_RELIEF);
    if (!n || !state.sides[side]) continue;
    state.sides[side].trust = clamp((state.sides[side].trust ?? 50) + n, 0, 100);
    ctx.emit('trust_relief', {
      side, secret: true, minor: true, amount: n,
      reason: `Vertrauen +${n}: Die Truppe merkt, dass man sie nicht vergisst.`,
      at: { x: 0, y: 0 },
    });
  }
}

// ------------------------------------------------------------------ Moral (Stellungsrunde)

function runRefill(ctx) {
  const { state } = ctx;
  for (const o of ctx.ordersOfType('refill')) {
    const g = ctx.group(o.group);
    if (!g || postOf(ctx.map, g) === 'front') continue;
    const rep = replacementsOf(state, g.side);
    const stock = replacementStock(state, g.side);
    const xpBefore = g.experience;
    const p = refillPreview(g, { ...stock, greenXp: greenXp(state, g.side) });
    if (!p.total) {
      ctx.emit('refill_none', { side: g.side, group: g.id, secret: true, reason: `${name(g)}: kein Ersatz im Depot.`, at: { ...g.pos } });
      continue;
    }
    g.strength += p.total;
    g.experience = p.experience;
    g.morale = p.morale;
    rep.tenths -= p.green * 10;
    if (p.veterans && state.sides[g.side].supply) state.sides[g.side].supply.reserveMen -= p.veterans;
    if (p.green) g.greenTurns = C.GREEN_TURNS;
    const parts = [];
    if (p.veterans) parts.push(plural(p.veterans, 'Genesener', 'Genesene'));
    if (p.green) parts.push(`${p.green} Mann Ersatz`);
    const xp = p.experience < xpBefore ? ` Die Neuen wissen noch nicht, wann man sich hinwirft: Erfahrung ${xpBefore} → ${p.experience}.` : '';
    ctx.emit('refilled', {
      side: g.side, group: g.id, secret: true, veterans: p.veterans, green: p.green, experience: p.experience,
      reason: `${name(g)} wird aufgefüllt: ${parts.join(' und ')}, jetzt ${g.strength} von ${g.size}.${xp}`,
      at: { ...g.pos },
    });
  }
}

function runMoralePosition(ctx) {
  const { state, map } = ctx;
  applyLosses(ctx);

  for (const side of SIDES) {
    if (!state.sides[side]) continue;
    const f = moraleFactors(state, side);
    const rep = replacementsOf(state, side);
    rep.tenths = Math.min(C.REPLACEMENTS_CAP * 10, rep.tenths + replacementTenths(f.replacements.speed ?? 1));
  }
  runRefill(ctx);

  const tooLong = { a: [], b: [] };
  for (const g of ctx.groups()) {
    const post = postOf(map, g);
    const f = moraleFactors(state, g.side);
    const y = yieldOf(state, g.side);
    const shock = g.shock ?? 0;
    if (post === 'front') {
      g.fatigue = clamp((g.fatigue ?? 0) + fatigueGain('position'), 0, 100);
      g.frontTurns = (g.frontTurns ?? 0) + 1;
      const loss = frontMoraleLoss(g);
      if (loss) {
        g.morale = clamp(g.morale - loss, 0, 100);
        const why = [];
        if (g.fatigue >= C.FATIGUE_TIRED) why.push('übermüdet');
        if (g.frontTurns > C.TOO_LONG) why.push(`seit ${g.frontTurns} Runden vorn`);
        ctx.emit('morale_loss', {
          side: g.side, group: g.id, secret: true, minor: true, amount: loss,
          reason: `${name(g)} ist ${why.join(' und ')}. Moral −${loss} auf ${g.morale}.`, at: { ...g.pos },
        });
      }
      if (g.frontTurns === C.TOO_LONG) {
        ctx.emit('too_long', {
          side: g.side, group: g.id, secret: true, turns: g.frontTurns,
          reason: `${name(g)} ist seit ${g.frontTurns} Runden vorn. Die Leute fragen, wann die Ablösung kommt.`, at: { ...g.pos },
        });
      }
      if (g.frontTurns >= C.TOO_LONG) tooLong[g.side].push(g);
    } else {
      const camp = post === 'rest' ? restCamps(state, g.side).length > 0 : true;
      const fr = fatigueRecovery(post, { erholung: y.erholung ?? 0, camp });
      g.fatigue = clamp((g.fatigue ?? 0) - fr, 0, 100);
      const mr = moraleRecovery(post, { recovery: f.recovery, moral: camp ? y.moral ?? 0 : 0, shock });
      const cap = moraleCap(post);
      if (mr && g.morale < cap) g.morale = Math.min(cap, g.morale + mr);
      g.frontTurns = post === 'rest' ? 0 : Math.max(0, (g.frontTurns ?? 0) - C.FRONT_TURNS_RESERVE_DECAY);
    }
    tick(g);
  }

  for (const side of SIDES) {
    const list = tooLong[side];
    if (!list.length || !state.sides[side]) continue;
    const n = Math.min(C.TRUST_TOO_LONG_MAX, list.length * C.TRUST_TOO_LONG);
    state.sides[side].trust = clamp((state.sides[side].trust ?? 50) - n, 0, 100);
    ctx.emit('trust_front', {
      side, secret: true, amount: -n, groups: list.map((g) => g.id),
      reason: `Vertrauen −${n}: ${list.map(name).join(', ')} ${list.length === 1 ? 'ist' : 'sind'} zu lange vorn.`,
      at: { ...list[0].pos },
    });
  }
  storeSections(ctx);
}

/** Zaehler, die je Runde ablaufen */
function tick(g) {
  if (g.shock) g.shock = Math.max(0, g.shock - 1);
  if (!g.shock) delete g.shock;
  if (g.greenTurns) g.greenTurns -= 1;
  if (!g.greenTurns) delete g.greenTurns;
  if (g.leaderFell) {
    g.leaderFell.turns -= 1;
    if (g.leaderFell.turns <= 0) delete g.leaderFell;
  }
}

// ------------------------------------------------------------------ Moral (Gefechtsrunde)

/** Ein Feld zurueck, weg vom Gegner: Seite a nach Westen, Seite b nach Osten. null, wenn es nicht geht */
export function fallbackCell(map, state, g) {
  const dx = g.side === 'a' ? -1 : 1;
  const occupied = new Set(state.groups.filter((q) => q.status !== 'lost' && q.id !== g.id).map((q) => q.pos.x + ',' + q.pos.y));
  for (const dy of [0, -1, 1]) {
    const x = g.pos.x + dx, y = g.pos.y + dy;
    if (!map || x < 0 || y < 0 || x >= map.width || y >= map.height) continue;
    const c = map.cells[y * map.width + x];
    if (!c || !Number.isFinite(TERRAIN[c.terrain]?.move ?? 1)) continue;
    if (occupied.has(x + ',' + y)) continue;
    return { x, y };
  }
  return null;
}

function runMoraleBattle(ctx) {
  const { state, map } = ctx;
  const hit = applyLosses(ctx);
  storeSections(ctx);

  for (const g of ctx.groups()) {
    if (postOf(map, g) !== 'front') continue;
    const o = ctx.orderFor(g.id);
    const moved = o?.type === 'move' || o?.type === 'assault';
    g.fatigue = clamp((g.fatigue ?? 0) + fatigueGain('battle', { moved }), 0, 100);
  }

  for (const g of ctx.groups()) {
    if (postOf(map, g) !== 'front' || g.inDugout) continue;
    const losses = hit.losses.has(g.id);
    const leaderFell = hit.leader.has(g.id);
    const pinned = (g.suppressed ?? 0) >= PINNED && !!g.underFire;
    if (!losses && !leaderFell && !pinned) continue;
    const f = moraleFactors(state, g.side);
    const sec = map ? state.sides[g.side]?.morale?.sections?.[sectionIdAt(map, g.pos.y)] ?? 50 : 50;
    const chance = checkChance({
      morale: g.morale, experience: g.experience, losses, leaderFell, pinned, fatigue: g.fatigue, section: sec, breakFactor: f.breakFactor,
    });
    const roll = Math.floor(ctx.rng() * 100);
    let outcome = checkOutcome(roll, chance, g.morale);
    const at = { ...g.pos };
    if (outcome === 'held') {
      ctx.emit('morale_check', {
        side: g.side, group: g.id, secret: true, minor: true, outcome, chance,
        reason: `${name(g)} hält stand (Aussicht ${chance} Prozent).`, at,
      });
      continue;
    }
    g.morale = clamp(g.morale - C.WAVER_MORALE, 0, 100);
    const back = outcome === 'breaks' ? fallbackCell(map, state, g) : null;
    if (outcome === 'breaks' && !back) outcome = 'wavers';
    g.suppressed = Math.max(g.suppressed ?? 0, outcome === 'breaks' ? 1 : PINNED);
    if (outcome === 'breaks') {
      g.pos = back;
      g.inDugout = false;
      delete g.dugout;
      ctx.emit('morale_break', {
        side: g.side, group: g.id, secret: true, outcome, chance, from: at, to: { ...back },
        reason: `${name(g)} weicht: Die Leute laufen von ${cellLabel(at.x, at.y)} nach ${cellLabel(back.x, back.y)} zurück (Aussicht ${chance} Prozent, Moral ${g.morale}).`,
        at,
      });
    } else {
      ctx.emit('morale_check', {
        side: g.side, group: g.id, secret: true, outcome, chance,
        reason: `${name(g)} wirft sich hin und kommt nicht mehr hoch (Aussicht ${chance} Prozent, Moral ${g.morale}).`,
        at,
      });
    }
  }
  storeSections(ctx);
}

/** Nach dem Gefechtsende (P06: battle_end mit outcome): Moral der Gruppen vorn */
function runMoraleEnd(ctx) {
  for (const e of ctx.log) {
    if (e.type !== 'battle_end' || !e.side) continue;
    const won = e.outcome === 'taken' || e.outcome === 'defended';
    const lost = e.outcome === 'broken' || e.outcome === 'lost';
    const foe = ctx.log.find((x) => x.type === 'battle_end' && x.side === otherSide(e.side));
    const lostGround = foe?.outcome === 'taken';
    const delta = won ? C.BATTLE_WON : lost || lostGround ? -C.BATTLE_LOST : 0;
    if (!delta) continue;
    const list = ctx.groups(e.side).filter((g) => postOf(ctx.map, g) === 'front').sort(byId);
    for (const g of list) g.morale = clamp(g.morale + delta, 0, 100);
    if (!list.length) continue;
    ctx.emit('morale_battle', {
      side: e.side, secret: true, amount: delta, groups: list.map((g) => g.id),
      reason: delta > 0 ? `Nach dem Gefecht atmen die Gruppen vorn auf. Moral +${delta}.` : `Nach dem Gefecht ist es still in den Gräben. Moral ${delta}.`,
      at: e.at,
    });
  }
  storeSections(ctx);
}

// ------------------------------------------------------------------ Befehlspruefungen

registerOrderValidator('relieve', (order, group, state, env) => {
  const map = env?.map;
  if (map && postOf(map, group) !== 'front') return 'die Gruppe steht nicht vorn';
  if (order.by == null) return null;
  if (typeof order.by !== 'string') return 'Ablösung ist keine Gruppe';
  if (order.by === group.id) return 'eine Gruppe kann sich nicht selbst ablösen';
  const r = state.groups.find((g) => g.id === order.by);
  if (!r || r.side !== group.side) return `Gruppe ${order.by} gehört nicht zur eigenen Seite`;
  if (r.status === 'lost') return 'die Ablösung ist aufgerieben';
  if (map && postOf(map, r) === 'front') return 'die Ablösung steht selbst vorn';
  return null;
});

registerOrderValidator('refill', (order, group, state, env, side) => {
  const map = env?.map;
  if (map && postOf(map, group) === 'front') return 'aufgefüllt wird nur in Reserve oder Ruhe';
  if (group.strength >= group.size) return 'die Gruppe ist vollzählig';
  const st = replacementStock(state, side);
  const accrued = Math.floor(((state.sides[side]?.replacements?.tenths ?? 0) + replacementTenths(moraleFactors(state, side).replacements.speed ?? 1)) / 10);
  if (!st.veterans && accrued <= 0) return 'kein Ersatz im Depot';
  return null;
});

// ------------------------------------------------------------------ Anmeldung

// Grabfaktor Erschoepfung (ersetzt den vorlaeufigen aus P04): erst ab "mittel" spuerbar, dann bis 68 Prozent
registerDigFactor('erschoepfung', ({ group }) => {
  const pct = digFatiguePct(group.fatigue ?? 0);
  return pct === 100 ? null : { pct, label: 'Erschöpfung' };
});

registerPhase({ id: 'relieve', kind: 'position', order: ORDER.position.movement + 5, run: runRelieve });
registerPhase({ id: 'morale', kind: 'both', order: { position: ORDER.position.morale, battle: ORDER.battle.morale }, run(ctx) {
  if (ctx.kind === 'battle') runMoraleBattle(ctx);
  else runMoralePosition(ctx);
} });
registerPhase({ id: 'morale-end', kind: 'battle', order: ORDER.battle.end + 5, run: runMoraleEnd });
