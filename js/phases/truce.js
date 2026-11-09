// Waffenruhe zum Bergen (Plan 4.2 Nr. 21, Paket P24). Rein: kein DOM, kein Date, kein Math.random.
// Regeln und Zustand in js/truce.js. Nur in Szenarien mit features: ['truce'].
//
// Phasen:
//   truce   (Stellungsrunde, gleich nach den Befehlen) Angebot, Antwort, Ablauf, Bruch und Ausnutzen.
//           Wer waehrend der Waffenruhe schiessen laesst oder angreift, bricht sie: die eigenen Leute schaemen sich,
//           das Vertrauen sinkt. Wer sie ausnutzt (Draht, Sappe, Vorruecken im Niemandsland) und dabei gesehen
//           wird, beendet sie ebenso.
//   recover (Stellungsrunde, nach der Bewegung) Waehrend der Waffenruhe bergen beide Seiten alle Verwundeten
//           draussen. Sonst bergen Sanitaeter mit dem Befehl recover, und wer gesehen wird, wird beschossen.
//           Wer draussen liegen bleibt, stirbt mit der Zeit.
//   lying   (nach den Verlusten) Verwundete von Gruppen im Niemandsland bleiben dort liegen.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance } from '../map.js';
import { otherSide } from '../state.js';
import { addWounded } from '../supply.js';
import { sectionAt } from '../supply.js';
import { sideSeesCell, darknessOf } from '../sight.js';
import { featureOn } from '../underground.js';
import { surname } from './hold.js';
import { TRUCE } from '../config/akt3.js';
import {
  truceOf, setTruce, truceProblem, recoverProblem, breaksTruce, lyingCells, takeLying, addLying, outsideCell,
  ABUSE_ORDERS,
} from '../truce.js';

const name = (g) => 'Gruppe ' + surname(g.leader.name);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const on = (state) => featureOn(state, 'truce');
const mid = (state) => ({ x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) });

registerOrderValidator('truce', (order, group, state, env, side) => truceProblem(state, side, order));
registerOrderValidator('recover', (order, group, state, env) => recoverProblem(state, env.map ?? null, group, order.target));

function shame(ctx, side, why) {
  const s = ctx.state;
  for (const g of ctx.groups(side)) g.morale = Math.max(0, g.morale - TRUCE.breakMorale);
  s.sides[side].trust = Math.max(0, (s.sides[side].trust ?? 50) - TRUCE.breakTrust);
  ctx.emit('truce_shame', {
    side, secret: true,
    reason: `${why} Die eigenen Leute sehen weg. Moral sinkt um ${TRUCE.breakMorale}, Vertrauen um ${TRUCE.breakTrust}.`,
    at: mid(s),
  });
}

function runTruce(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  let t = truceOf(s);

  // Ablauf
  if (t && (t.status === 'active' || t.status === 'tolerated') && (t.until ?? 0) < ctx.turn) {
    t = { ...t, status: 'over' };
    setTruce(s, t);
    ctx.emit('truce_over', {
      public: true,
      reason: 'Eine grüne Leuchtkugel steigt. Die Waffenruhe ist vorbei, alle gehen zurück, ohne sich umzudrehen.',
      at: mid(s),
    });
  }

  // Antwort auf ein Angebot aus einer frueheren Runde
  if (t?.status === 'offered' && t.turn < ctx.turn) {
    const to = otherSide(t.by);
    const ans = ctx.planOf(to, 'truce')?.answer;
    if (ans === 'accept') {
      t = { ...t, status: 'active', until: ctx.turn + TRUCE.rounds - 1, accepted: ctx.turn };
      setTruce(s, t);
      const st = s.sides[to];
      st.trust = Math.min(100, (st.trust ?? 50) + TRUCE.acceptTrust);
      st.reputation = Math.max(0, (st.reputation ?? 50) + TRUCE.acceptReputation);
      ctx.emit('truce_begin', {
        public: true, by: t.by,
        reason: 'Die Waffenruhe gilt. Sanitäter beider Seiten gehen mit Laternen hinaus, niemand schießt.',
        at: mid(s),
      });
    } else {
      t = { ...t, status: 'declined' };
      setTruce(s, t);
      ctx.emit('truce_declined', {
        public: true, by: t.by,
        reason: ans === 'decline' ? 'Der Bote geht mit einer Absage zurück. Die Laterne unter der Fahne wird eingeholt.' : 'Keine Antwort. Gegen Morgen holt drüben jemand die Laterne unter der Fahne ein.',
        at: mid(s),
      });
    }
  }

  // Neues Angebot
  for (const side of ['a', 'b']) {
    const o = ctx.planOf(side, 'truce');
    if (o?.answer !== 'offer' || truceProblem(s, side, o)) continue;
    t = { status: 'offered', by: side, turn: ctx.turn };
    setTruce(s, t);
    s.sides[side].truceOffered = true;
    ctx.emit('truce_offer', {
      public: true, by: side,
      reason: side === 'b'
        ? 'Drüben hat jemand eine weiße Fahne an einen Spaten gebunden und eine Laterne darunter gehängt. Ein Bote bringt einen Brief: Waffenruhe, um die Verwundeten beider Seiten zu bergen.'
        : 'Eine weiße Fahne am Spaten, eine Laterne darunter. Der Bote geht hinüber und bietet eine Waffenruhe zum Bergen an.',
      at: mid(s),
    });
    break;
  }

  // Bruch und Ausnutzen
  if (!t || (t.status !== 'active' && t.status !== 'tolerated') || (t.until ?? 0) < ctx.turn) return;
  if (t.status === 'active') {
    for (const side of ['a', 'b']) {
      // In der Runde der Annahme wusste die anbietende Seite noch nichts davon: ihre Befehle zaehlen nicht
      if (t.accepted === ctx.turn && t.by === side) continue;
      const own = ctx.allOrders.filter((o) => (o.group ? ctx.group(o.group)?.side === side : false) && breaksTruce(o));
      const plans = [ctx.planOf(side, 'fire_plan'), ctx.planOf(side, 'gas_shell')].filter((o) => o && breaksTruce(o));
      if (!own.length && !plans.length) continue;
      t = { ...t, status: 'broken', brokenBy: side, until: ctx.turn - 1 };
      setTruce(s, t);
      const g = own.length ? ctx.group(own[0].group) : null;
      ctx.emit('truce_broken', {
        public: true, by: side,
        reason: g ? `${side === 'a' ? 'Eigene' : 'Feindliche'} ${name(g)} schießt in die Waffenruhe. Die Laternen gehen aus, die Sanitäter werfen sich hin.`
          : `${side === 'a' ? 'Die eigene' : 'Die feindliche'} Artillerie schießt in die Waffenruhe. Die Laternen gehen aus.`,
        at: g ? { ...g.pos } : mid(s),
      });
      shame(ctx, side, 'Die Waffenruhe ist gebrochen.');
      return;
    }
  }
  for (const side of ['a', 'b']) {
    for (const o of ctx.allOrders) {
      if (!ABUSE_ORDERS.has(o.type)) continue;
      const g = o.group ? ctx.group(o.group) : null;
      if (!g || g.side !== side || g.type === 'medics' || g.status === 'lost') continue;
      const cells = [...(o.path ?? []), ...(o.target ? [o.target] : [])];
      const out = cells.find((p) => outsideCell(ctx.map, side, p));
      if (!out) continue;
      const foe = otherSide(side);
      const seen = ctx.map ? sideSeesCell(s, ctx.map, foe, out, darknessOf(s)) || ctx.groups(foe).some((f) => distance(f.pos, out) <= 2) : true;
      s.sides[side].truceAbused = (s.sides[side].truceAbused | 0) + 1;
      if (!seen) {
        ctx.emit('truce_abused', {
          side, secret: true, group: g.id, seen: false,
          reason: `${name(g)} nutzt die Waffenruhe bei ${cellLabel(out.x, out.y)}. Drüben scheint es niemand zu merken.`,
          at: { ...out },
        });
        continue;
      }
      t = { ...t, status: 'abused', abusedBy: side, until: ctx.turn };
      setTruce(s, t);
      ctx.emit('truce_abused', {
        public: true, by: side, group: g.id, seen: true,
        reason: `Im Schein der Laternen ${side === 'a' ? 'sieht der Gegner eigene' : 'sieht man feindliche'} Leute bei ${cellLabel(out.x, out.y)}, die nicht bergen, sondern arbeiten. Die Waffenruhe ist verdorben.`,
        at: { ...out },
      });
      shame(ctx, side, 'Die Waffenruhe ist ausgenutzt worden, und drüben hat man es gesehen.');
      return;
    }
  }
}

function recovered(ctx, side, at, n, how) {
  if (!n) return;
  const s = ctx.state;
  if (ctx.map) addWounded(s, ctx.map, side, at, n, '-');
  s.sides[side].recovered = (s.sides[side].recovered | 0) + n;
  ctx.emit('recovered', {
    side, secret: true, count: n, how, section: ctx.map ? sectionAt(ctx.map, at.y) : null,
    reason: how === 'truce'
      ? `${plural(n, 'Verwundeter', 'Verwundete')} bei ${cellLabel(at.x, at.y)} geborgen, im Licht der Laternen.`
      : `${plural(n, 'Verwundeter', 'Verwundete')} bei ${cellLabel(at.x, at.y)} hereingeholt.`,
    at: { ...at },
  });
}

function runRecover(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  const t = truceOf(s);
  const active = t?.status === 'active' && (t.until ?? 0) >= ctx.turn;
  const tolerated = t?.status === 'tolerated' && (t.until ?? 0) >= ctx.turn;
  if (active) {
    for (const side of ['a', 'b']) {
      const medics = ctx.groups(side).some((g) => g.type === 'medics');
      for (const c of lyingCells(s)) {
        const want = c[side] | 0;
        if (!want) continue;
        const n = takeLying(s, c, side, medics ? want : Math.max(1, want >> 1));
        recovered(ctx, side, c, n, 'truce');
      }
    }
  } else {
    let nervousDone = false;
    for (const o of ctx.ordersOfType('recover')) {
      const g = ctx.group(o.group);
      if (!g || g.status === 'lost') continue;
      const why = recoverProblem(s, ctx.map, g, o.target);
      if (why) {
        ctx.emit('recover_failed', { side: g.side, group: g.id, secret: true, blocked: true, reason: `${name(g)} birgt niemanden: ${why}.`, at: { ...g.pos } });
        continue;
      }
      const foe = otherSide(g.side);
      let hitBy = null;
      if (tolerated) {
        if (!nervousDone && Math.floor(ctx.rng() * 100) < TRUCE.nervous) {
          nervousDone = true;
          hitBy = 'nervous';
        }
      } else {
        const posts = ctx.groups(foe).filter((f) => !f.inDugout && distance(f.pos, o.target) <= TRUCE.spotRadius);
        const per = s.night ? TRUCE.spotted : TRUCE.spotted * 3;
        for (const f of posts) if (!hitBy && Math.floor(ctx.rng() * 100) < per) hitBy = f.id;
      }
      let carry = TRUCE.carry;
      if (hitBy) {
        const [lo, hi] = TRUCE.shotLoss;
        const loss = Math.min(g.strength, lo + Math.floor(ctx.rng() * (hi - lo + 1)));
        g.strength -= loss;
        carry = Math.max(0, carry >> 1);
        ctx.emit('losses', {
          side: g.side, group: g.id, amount: loss, cause: 'fire', from: hitBy === 'nervous' ? [] : [hitBy],
          reason: hitBy === 'nervous'
            ? `Ein nervöser Posten drüben schießt einmal in die Dunkelheit. ${name(g)}: ${plural(loss, 'Verlust', 'Verluste')} beim Bergen.`
            : `${name(g)} wird beim Bergen bei ${cellLabel(o.target.x, o.target.y)} gesehen und beschossen: ${plural(loss, 'Verlust', 'Verluste')}.`,
          at: { ...o.target },
        });
        if (g.strength <= 0) {
          g.strength = 0;
          g.status = 'lost';
          s.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...o.target } });
          ctx.emit('group_lost', { side: g.side, group: g.id, public: true, reason: `${name(g)} kommt vom Bergen nicht zurück. ${g.leader.name} aus ${g.leader.home} bleibt draußen.`, at: { ...o.target } });
          continue;
        }
      }
      const n = takeLying(s, o.target, g.side, carry);
      g.fatigue = Math.min(100, (g.fatigue ?? 0) + 10);
      recovered(ctx, g.side, o.target, n, 'medics');
    }
  }
  // Wer draussen liegen bleibt, stirbt mit der Zeit
  for (const side of ['a', 'b']) {
    let died = 0;
    let where = null;
    for (const c of lyingCells(s)) {
      const n = c[side] | 0;
      let d = 0;
      for (let i = 0; i < n; i++) if (Math.floor(ctx.rng() * 100) < TRUCE.dieRound) d++;
      if (d) { takeLying(s, c, side, d); died += d; where ??= { x: c.x, y: c.y }; }
    }
    if (!died) continue;
    s.sides[side].lyingDied = (s.sides[side].lyingDied | 0) + died;
    ctx.emit('lying_died', {
      side, secret: true, count: died,
      reason: `Draußen ${died === 1 ? 'ist einer' : `sind ${died}`} gestorben, die niemand holen konnte. Gegen Morgen ruft es leiser.`,
      at: where,
    });
  }
}

/** Verwundete von Gruppen draussen bleiben draussen liegen (aus der Sanitaetskette zurueck auf das Feld) */
function runLying(ctx) {
  const s = ctx.state;
  if (!on(s) || !ctx.map) return;
  for (const e of ctx.log.filter((x) => x.type === 'wounded' && x.group && x.count > 0)) {
    const g = ctx.group(e.group) ?? s.groups.find((x) => x.id === e.group);
    if (!g || !outsideCell(ctx.map, g.side, g.pos) || g.type === 'medics') continue;
    const sec = s.sides[g.side]?.supply?.sections?.[e.section];
    const have = sec?.wounded?.[g.id] | 0;
    const n = Math.min(have, e.count);
    if (!n) continue;
    sec.wounded[g.id] -= n;
    if (!sec.wounded[g.id]) delete sec.wounded[g.id];
    addLying(s, g.pos, g.side, n);
    ctx.emit('left_lying', {
      side: g.side, group: g.id, secret: true, count: n,
      reason: `${plural(n, 'Verwundeter bleibt', 'Verwundete bleiben')} draußen bei ${cellLabel(g.pos.x, g.pos.y)} liegen. Man hört sie, wenn der Wind still ist.`,
      at: { ...g.pos },
    });
  }
}

registerPhase({ id: 'truce', kind: 'position', order: ORDER.position.orders + 3, run: runTruce });
registerPhase({ id: 'recover', kind: 'position', order: ORDER.position.movement + 4, run: runRecover });
registerPhase({ id: 'lying', kind: 'both', order: { position: ORDER.position.supply - 4, battle: ORDER.battle.melee + 6 }, run: runLying });
