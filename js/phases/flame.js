// Flammenwerfer (Plan 4.2 Nr. 22, Plan 5, Paket P24). Rein: kein DOM, kein Date, kein Math.random.
// Befehl { group, type: 'flame', target } in der Gefechtsrunde: ein Stoss auf ein Feld bis FLAME.range weit.
// - Im Unterstand ist niemand sicher: der Stoss trifft die Besatzung dort, wo Gewehre nicht hinkommen. Wer
//   uebrig bleibt und kaum noch Leute hat, ergibt sich (Gefangene), der Rest muss heraus und ist niedergehalten.
// - Ausserhalb des Unterstands: Verluste, Unterdrueckung, Moral; Nachbarn des Ziels verlieren Moral.
// - Der Trupp ist sehr gefaehrdet: jede feindliche Gruppe mit Sicht kann auf die Tanks schiessen, und wer
//   den Trupp im Feuer trifft, bringt manchmal einen Tank zum Platzen.
// - Ein Trupp hat FLAME.fuel Stoesse je Einsatz (g.fuel).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance, lineOfSight } from '../map.js';
import { otherSide } from '../state.js';
import { surname } from './hold.js';
import { FLAME } from '../config/akt3.js';

const name = (g) => 'Gruppe ' + surname(g.leader.name);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export function fuelOf(g) {
  return Number.isInteger(g?.fuel) ? g.fuel : FLAME.fuel;
}

/** Warum geht der Stoss nicht? null = geht */
export function flameProblem(group, target) {
  if (group.type !== 'flamethrowers') return 'nur Flammenwerfer-Trupps';
  if (group.inDugout) return 'Gruppe sitzt im Unterstand';
  if (fuelOf(group) <= 0) return 'die Tanks sind leer';
  if (!target) return 'Ziel fehlt';
  const d = distance(group.pos, target);
  if (d === 0) return 'Ziel ist das eigene Feld';
  if (d > FLAME.range) return `zu weit (höchstens ${FLAME.range} Felder)`;
  return null;
}

registerOrderValidator('flame', (order, group) => flameProblem(group, order.target));

function lose(ctx, g, n, cause, reason, at) {
  const loss = Math.min(g.strength, n);
  g.strength -= loss;
  ctx.emit('losses', { side: g.side, group: g.id, amount: loss, cause, reason, at: { ...at } });
  if (g.strength <= 0) {
    g.strength = 0;
    g.status = 'lost';
    ctx.state.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos } });
    ctx.emit('group_lost', {
      side: g.side, group: g.id, public: true,
      reason: `${name(g)} ist aufgerieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
      at: { ...g.pos },
    });
  }
  return loss;
}

function burst(ctx, g, why) {
  const n = Math.max(2, Math.ceil(g.strength / 2));
  g.fuel = 0;
  const k = g.pos.x + ',' + g.pos.y;
  ctx.state.cells[k] = { ...(ctx.state.cells[k] ?? {}), scorched: ctx.turn };
  lose(ctx, g, n, 'flame', `${why} Ein Tank von ${name(g)} platzt bei ${cellLabel(g.pos.x, g.pos.y)}: ${plural(Math.min(n, g.strength), 'Ausfall', 'Ausfälle')}, die Stöße sind verbraucht.`, g.pos);
  for (const o of ctx.groups(g.side)) {
    if (o.id !== g.id && distance(o.pos, g.pos) <= 1) o.morale = Math.max(0, o.morale - FLAME.nearMorale);
  }
}

function runFlame(ctx) {
  const s = ctx.state;
  for (const o of [...ctx.ordersOfType('flame')].sort((p, q) => (p.group < q.group ? -1 : 1))) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const why = flameProblem(g, o.target);
    if (why) {
      ctx.emit('flame_failed', { side: g.side, group: g.id, secret: true, blocked: true, reason: `${name(g)}: kein Stoß, ${why}.`, at: { ...g.pos } });
      continue;
    }
    g.fuel = fuelOf(g) - 1;
    g.fired = true;
    const foe = otherSide(g.side);
    const victim = ctx.groups(foe).filter((v) => distance(v.pos, o.target) <= 0)[0]
      ?? ctx.groups(foe).filter((v) => distance(v.pos, o.target) <= 1 && distance(v.pos, g.pos) <= FLAME.range).sort((p, q) => (p.id < q.id ? -1 : 1))[0];
    const k = o.target.x + ',' + o.target.y;
    s.cells[k] = { ...(s.cells[k] ?? {}), scorched: ctx.turn };
    ctx.emit('flame', {
      side: g.side, group: g.id, public: true, target: { ...o.target }, hit: victim?.id ?? null,
      reason: `${name(g)} schickt einen Feuerstoß nach ${cellLabel(o.target.x, o.target.y)}.${fuelOf(g) ? '' : ' Die Tanks sind leer.'}`,
      at: { ...o.target },
    });
    if (victim) {
      const inDug = !!victim.inDugout;
      const pct = inDug ? FLAME.dugoutLossPct : FLAME.openLossPct;
      let n = 0;
      for (let i = 0; i < victim.strength; i++) if (Math.floor(ctx.rng() * 100) < pct) n++;
      if (inDug) n = Math.max(2, n);
      lose(ctx, victim, n, 'flame', inDug
        ? `Feuer im Unterstand bei ${cellLabel(victim.pos.x, victim.pos.y)}. ${name(victim)}: ${plural(Math.min(n, victim.strength), 'Ausfall', 'Ausfälle')}.`
        : `${name(victim)} im Feuerstoß bei ${cellLabel(victim.pos.x, victim.pos.y)}: ${plural(Math.min(n, victim.strength), 'Ausfall', 'Ausfälle')}.`, victim.pos);
      if (victim.status !== 'lost') {
        victim.morale = Math.max(0, victim.morale - (inDug ? FLAME.dugoutMorale : FLAME.openMorale));
        victim.suppressed = 1;
        victim.underFire = true;
        if (inDug) {
          victim.inDugout = false;
          delete victim.dugout;
          if (victim.strength <= FLAME.surrender) {
            const count = victim.strength;
            victim.strength = 0;
            victim.status = 'lost';
            ctx.emit('prisoners', {
              side: g.side, group: g.id, count, from: victim.id, secret: true,
              reason: `Aus dem Unterstand kommen ${plural(count, 'Mann', 'Mann')} mit erhobenen Händen. ${name(g)} bringt sie zurück.`,
              at: { ...victim.pos },
            });
            ctx.emit('men_captured', {
              side: victim.side, group: victim.id, count, secret: true,
              reason: `${name(victim)}: der Rest ergibt sich nach dem Feuer im Unterstand.`, at: { ...victim.pos },
            });
            ctx.emit('group_lost', {
              side: victim.side, group: victim.id, public: true, captured: true,
              reason: `${name(victim)} gibt es nicht mehr: wer das Feuer überlebt hat, ist in Gefangenschaft.`, at: { ...victim.pos },
            });
          } else {
            ctx.emit('dugout_cleared', {
              side: victim.side, group: victim.id, public: true,
              reason: `${name(victim)} muss aus dem brennenden Unterstand, hustend, ohne Ordnung.`, at: { ...victim.pos },
            });
          }
        }
      }
      for (const n2 of ctx.groups(foe)) {
        if (n2.id !== victim.id && distance(n2.pos, victim.pos) <= 1) n2.morale = Math.max(0, n2.morale - FLAME.nearMorale);
      }
    }
    // Wer sieht den Trupp, schiesst auf die Tanks
    if (g.status === 'lost') continue;
    const shooters = ctx.groups(foe).filter((f) => !f.inDugout && (f.suppressed ?? 0) < 0.75 && distance(f.pos, g.pos) <= FLAME.tankHitRange
      && (!ctx.map?.cells || distance(f.pos, g.pos) <= 1 || lineOfSight(ctx.map, f.pos, g.pos, { eye: 1, target: 1 }).visible));
    for (const f of shooters) {
      if (Math.floor(ctx.rng() * 100) < FLAME.tankHitPct) {
        burst(ctx, g, `${name(f)} schießt auf die Tanks.`);
        break;
      }
    }
  }
}

/** Nach dem Feuer: wer einen Flammenwerfer trifft, bringt manchmal einen Tank zum Platzen */
function runTanks(ctx) {
  for (const e of ctx.log.filter((x) => x.type === 'losses' && x.amount > 0 && x.cause !== 'flame')) {
    const g = ctx.group(e.group);
    if (!g || g.type !== 'flamethrowers' || g.status === 'lost' || fuelOf(g) <= 0) continue;
    if (Math.floor(ctx.rng() * 100) < FLAME.burstOnLossPct) burst(ctx, g, 'Ein Treffer im Rücken.');
  }
}

registerPhase({ id: 'flame', kind: 'battle', order: ORDER.battle.fire - 3, run: runFlame });
registerPhase({ id: 'flame-tanks', kind: 'battle', order: ORDER.battle.fire + 3, run: runTanks });
