// Wechsel Stellungsrunde -> Gefechtsrunde und zurueck (Plan 3.3, 4.1 Nr. 9, 10.6). Rein: kein DOM, kein Date,
// kein Math.random.
//
// Phase attack (Stellungsrunde, Schritt 9): Befehle "attack" (Angriff ansetzen, mit Sturmweg) schalten auf
//   Gefechtsrunden um. Die 12 Stunden der Stellungsrunde laufen noch ab, das Gefecht beginnt danach. Jede
//   Sturmgruppe bekommt ihren Weg als Befehl "assault" fuer die erste Gefechtsrunde (carry).
//   state.battle = { round, startTurn, attackers: [side], assaulters: { side: [id] }, objectives: { side: [{x,y}] },
//                    counter: { side: { at, due, issued, done? } }, outcome: { side: 'taken'|'stuck' } }
// Phase battle-end (Gefechtsrunde, Schritt 8): Ende, wenn fuer jede angreifende Seite
//   - das Ziel genommen ist (jede Sturmgruppe steht auf oder neben ihrem Ziel, kein Feind daneben) oder
//   - der Angriff steckt (alle Sturmgruppen halten, sitzen fest oder sind ausgefallen),
//   oder nach 12 Gefechtsrunden (eine Stunde). Dann wieder Stellungsrunden.
// Gegenstoss (Plan 4.1 Nr. 9): Bricht der Angreifer ein, bekommt der Verteidiger einen Stabsbefehl, den Graben
//   binnen drei Gefechtsrunden zurueckzunehmen. Wer gegenstoesst (Befehl assault), gewinnt Ansehen; wer sich
//   einigelt, verliert es.
import { registerPhase, ORDER } from './registry.js';
import { cellLabel, distance } from '../map.js';
import { otherSide, SIDES } from '../state.js';
import { advanceClock } from './clock.js';
import { surname } from './hold.js';

export const BATTLE_ROUNDS = 12;
export const BATTLE_MINUTES = 5;
export const COUNTER_ROUNDS = 3;
export const COUNTER_REWARD = 3;
export const COUNTER_PENALTY = 5;
/** Befehle, mit denen eine Sturmgruppe noch angreift */
export const PRESSING = new Set(['assault', 'move']);

const hhmm = (c) => String(c.hour).padStart(2, '0') + ':' + String(c.minute).padStart(2, '0');
const name = (g) => 'Gruppe ' + surname(g.leader.name);

/** Spielminute des laufenden Gefechts am Ende der aktuellen Gefechtsrunde (5, 10, ... 60) */
export function battleMinute(state) {
  return state.battle ? Math.min(BATTLE_ROUNDS, state.battle.round) * BATTLE_MINUTES : 0;
}

/** Spielminute, bis zu der ein Stabsbefehl zum Gegenstoss erfuellt sein muss (hoechstens 60) */
export function counterMinute(counter) {
  return Math.min(BATTLE_ROUNDS, counter.due) * BATTLE_MINUTES;
}

export function isAttacker(state, side) {
  return !!state.battle?.attackers?.includes(side);
}

function runAttack(ctx) {
  const state = ctx.state;
  if (state.battle) return;
  const orders = ctx.ordersOfType('attack');
  if (!orders.length) return;
  const battle = { round: 1, startTurn: ctx.turn + 1, attackers: [], assaulters: {}, objectives: {}, counter: {}, outcome: {} };
  const start = advanceClock(state.clock, 12 * 60);
  for (const side of SIDES) {
    const list = orders.filter((o) => ctx.group(o.group)?.side === side && ctx.group(o.group).status !== 'lost');
    if (!list.length) continue;
    battle.attackers.push(side);
    battle.assaulters[side] = list.map((o) => o.group);
    // Ziel je Sturmgruppe (mehrere Gruppen duerfen dasselbe Feld haben)
    battle.objectives[side] = list.map((o) => {
      const end = o.path[o.path.length - 1];
      return { x: end.x, y: end.y, group: o.group };
    });
    for (const o of list) {
      const g = ctx.group(o.group);
      const end = o.path[o.path.length - 1];
      ctx.emit('attack_set', {
        side, group: g.id, secret: true,
        carry: { group: g.id, type: 'assault', path: o.path.map((p) => ({ x: p.x, y: p.y })) },
        reason: `${name(g)} liegt in der Sturmstellung. Ziel ${cellLabel(end.x, end.y)}, ${o.path.length} Felder Sturmweg. Um ${hhmm(start)} Uhr geht es los.`,
        at: { ...g.pos },
      });
    }
  }
  if (!battle.attackers.length) return;
  state.turnKind = 'battle';
  state.battle = battle;
  for (const side of SIDES) {
    const attacking = battle.attackers.includes(side);
    // Der Verteidiger erfaehrt nicht, wohin der Sturm geht: Meldung am eigenen Graben
    const obj = battle.objectives[side]?.[0] ?? ctx.groups(side)[0]?.pos;
    ctx.emit('battle_start', {
      side, secret: true,
      reason: attacking
        ? `Angriff angesetzt: ${battle.assaulters[side].length} ${battle.assaulters[side].length === 1 ? 'Gruppe stürmt' : 'Gruppen stürmen'} um ${hhmm(start)} Uhr. Die Uhr läuft dann in Fünf-Minuten-Schritten.`
        : `Alarm um ${hhmm(start)} Uhr: Vor dem Graben wird es laut, der Gegner greift an. Gefechtsrunden zu fünf Minuten.`,
      at: obj ? { x: obj.x, y: obj.y } : { x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) },
    });
  }
}

/** Ist das Ziel einer Seite genommen? Jede Sturmgruppe am Ziel, kein Feind direkt daneben. */
export function objectiveTaken(state, side) {
  const b = state.battle;
  const ids = b?.assaulters?.[side] ?? [];
  const alive = ids.map((id) => state.groups.find((g) => g.id === id)).filter((g) => g && g.status !== 'lost');
  if (!alive.length) return false;
  const objs = b.objectives[side] ?? [];
  const foes = state.groups.filter((g) => g.side !== side && g.status !== 'lost');
  for (const g of alive) {
    const goal = objs.find((o) => o.group === g.id) ?? objs[0];
    if (!goal || distance(g.pos, goal) > 1) return false;
  }
  return !objs.some((o) => foes.some((f) => distance(f.pos, o) <= 1));
}

function runEnd(ctx) {
  const state = ctx.state;
  const b = state.battle;
  if (!b) return;
  // Von aussen gesetzte Gefechte (Tests, Szene mit kind=battle) haben nur { round }
  b.attackers ??= [];
  b.assaulters ??= {};
  b.objectives ??= {};
  b.counter ??= {};
  b.outcome ??= {};

  // Ende des Angriffs je Seite
  for (const side of b.attackers) {
    if (b.outcome[side]) continue;
    if (objectiveTaken(state, side)) { b.outcome[side] = 'taken'; continue; }
    const alive = (b.assaulters[side] ?? []).map((id) => ctx.group(id)).filter((g) => g && g.status !== 'lost');
    const pressing = alive.filter((g) => PRESSING.has(ctx.orderFor(g.id)?.type));
    if (!pressing.length) b.outcome[side] = alive.length ? 'stuck' : 'broken';
  }
  const allDone = b.attackers.length > 0 && b.attackers.every((s) => b.outcome[s]);
  const timeUp = b.round >= BATTLE_ROUNDS;
  const ending = allDone || timeUp;

  // Stabsbefehl zum Gegenstoss nach einem Einbruch (nur, wenn das Gefecht weitergeht)
  for (const e of ending ? [] : ctx.log) {
    if (e.type !== 'breach' || !e.side) continue;
    const def = otherSide(e.side);
    const pending = b.counter[def];
    if (pending && !pending.done) continue;
    if (!ctx.groups(def).length) continue;
    b.counter[def] = { at: { ...e.at }, due: b.round + COUNTER_ROUNDS, issued: b.round };
    ctx.emit('staff_order', {
      side: def, secret: true, kind: 'counter', due: b.round + COUNTER_ROUNDS,
      reason: `Stabsbefehl: Der Graben bei ${cellLabel(e.at.x, e.at.y)} ist im Gegenstoß zurückzunehmen, spätestens bis Minute ${counterMinute(b.counter[def])}. Der Stab erwartet keine Ausreden.`,
      at: { ...e.at },
    });
  }
  for (const side of SIDES) {
    const c = b.counter[side];
    if (!c || c.done || c.issued === b.round) continue;
    // Gegenstoss: ein Sturm, der auf oder neben dem verlorenen Graben endet
    const pushing = ctx.groups(side).find((g) => {
      const o = ctx.orderFor(g.id);
      return o?.type === 'assault' && o.path?.length && distance(o.path[o.path.length - 1], c.at) <= 1;
    });
    const s = state.sides[side];
    if (pushing) {
      c.done = 'done';
      s.reputation = Math.min(100, (s.reputation ?? 50) + COUNTER_REWARD);
      ctx.emit('counter_done', {
        side, group: pushing.id, secret: true, reputation: s.reputation,
        reason: `Gegenstoß befohlen und angetreten: ${name(pushing)} geht vor. Der Stab vermerkt es (Ansehen +${COUNTER_REWARD}).`,
        at: { ...pushing.pos },
      });
    } else if (b.round >= c.due) {
      c.done = 'missed';
      s.reputation = Math.max(0, (s.reputation ?? 50) - COUNTER_PENALTY);
      ctx.emit('counter_missed', {
        side, secret: true, reputation: s.reputation,
        reason: `Kein Gegenstoß bei ${cellLabel(c.at.x, c.at.y)}. Der Stab spricht von Einigeln (Ansehen −${COUNTER_PENALTY}).`,
        at: { ...c.at },
      });
    }
  }

  if (!ending) return;

  for (const side of b.attackers) if (!b.outcome[side]) b.outcome[side] = 'time';
  const minutes = b.round * BATTLE_MINUTES;
  const summary = { startTurn: b.startTurn, endTurn: ctx.turn, rounds: b.round, attackers: [...b.attackers], outcome: { ...b.outcome } };
  for (const side of SIDES) {
    const own = b.outcome[side];
    const foe = b.outcome[otherSide(side)];
    let reason;
    if (own === 'taken') reason = `Ziel genommen. Nach ${minutes} Minuten ist der Graben in eigener Hand; jetzt muss er umgebaut werden.`;
    else if (own === 'stuck') reason = `Der Angriff steckt fest: Keine Sturmgruppe kommt mehr voran. Nach ${minutes} Minuten ist das Gefecht vorbei.`;
    else if (own === 'broken') reason = `Der Angriff ist zusammengebrochen: Alle Sturmgruppen sind ausgefallen.`;
    else if (own === 'time') reason = `Eine Stunde Gefecht ist vorbei. Die Linien erstarren, wo sie gerade liegen.`;
    else if (foe === 'taken') reason = `Der Gegner hat sein Ziel genommen. Nach ${minutes} Minuten ist das Grabenstück verloren.`;
    else if (foe === 'stuck' || foe === 'broken') reason = `Der Angriff ist abgewiesen. Nach ${minutes} Minuten wird es still vor dem Graben.`;
    else reason = `Eine Stunde Gefecht ist vorbei. Die Linien erstarren, wo sie gerade liegen.`;
    ctx.emit('battle_end', { side, secret: true, outcome: own ?? (foe ? 'defended' : 'time'), minutes, reason, at: battleCenter(state) });
  }
  state.lastBattle = summary;
  state.battle = null;
  state.turnKind = 'position';
  for (const g of state.groups) {
    g.inDugout = false;
    delete g.dugout;
  }
}

function battleCenter(state) {
  const b = state.battle;
  const objs = b ? Object.values(b.objectives).flat() : [];
  if (objs.length) return { x: objs[0].x, y: objs[0].y };
  return { x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) };
}

registerPhase({ id: 'attack', kind: 'position', order: ORDER.position.attack, run: runAttack });
registerPhase({ id: 'battle-end', kind: 'battle', order: ORDER.battle.end, run: runEnd });
