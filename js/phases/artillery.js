// Artillerie nach Feuerplan (Plan 4.1 Nr. 8, 10.6 Stellungsrunde Schritt 3, Gefechtsrunde Schritt 2).
// Rein: kein DOM, kein Date, kein Math.random. Die Regeln stehen in js/artillery.js.
//
// Stellungsrunde (Phase "artillery", vor dem Graben):
//   - Stoerungstrupps flicken durchtrennte Leitungen, getroffene Batterien sind wieder bereit.
//   - Batterien holen Granaten aus dem Depot (supplies.ammo, 1 Einheit = 10 Granaten).
//   - Seitenbefehl fire_plan: { type: 'fire_plan', plans: [plan] } ersetzt die Plaene fuer die Gefechtsrunden;
//     Stoerfeuer und Gegenbatteriefeuer schiessen sofort in dieser Stellungsrunde.
// Gefechtsrunde (Phase "artillery", vor Unterstand und Bewegung):
//   - Befehle von Beobachtern, die jetzt ankommen, werden ausgefuehrt (Feuer verlegen, Feuer einstellen).
//   - Neue Befehle shift_fire / cease_fire von Beobachtern gehen per Telefon (1 Runde) oder Melder (2 Runden) los.
//   - Jeder laufende Plan schiesst seinen Schritt: Vorbereitung, Sperrfeuer (nur wenn Feind nahe der Linie), Walze.
// Phase "shelled" (nach der Bewegung): wer beschossen wurde, gilt fuer die Erholung als "unter Feuer".
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { PLAN_KINDS, SHELLS_PER_AMMO } from '../config/artillery.js';
import {
  artilleryOf, normalizePlan, validatePlan, activePlans, planCellsAt, centerOf, targetCellsOf, fireBattery,
  applyImpacts, commandLink, batteryCapacity, batteryType, observerPlan, MAX_PLANS,
} from '../artillery.js';
import { visibleEnemies, darknessOf, seesCellFrom } from '../sight.js';
import { cellLabel, distance } from '../map.js';
import { compareId, getGroup, cellKeys } from '../state.js';
import { surname } from './hold.js';

const SIDES = ['a', 'b'];

function rangeText(cells) {
  if (!cells.length) return '';
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  const a = { x: Math.min(...xs), y: Math.min(...ys) }, b = { x: Math.max(...xs), y: Math.max(...ys) };
  return a.x === b.x && a.y === b.y ? cellLabel(a.x, a.y) : `${cellLabel(a.x, a.y)} bis ${cellLabel(b.x, b.y)}`;
}

/**
 * Plan zielen: jede Batterie einmal je Runde, Munition abbuchen, Streuung wuerfeln, Abschuss melden.
 * Die Einschlaege kommen erst danach fuer beide Seiten gemeinsam (land), damit keine Seite zuerst trifft (WEGO).
 * Liefert { side, plan, fired, salvos: [{ battery, impacts }] }.
 */
function aim(ctx, side, plan, cells, { round = null, used }) {
  const art = ctx.state.sides[side].artillery;
  const k = PLAN_KINDS[plan.kind];
  const out = { side, plan, fired: 0, salvos: [] };
  for (const id of plan.batteries) {
    const b = art.batteries.find((x) => x.id === id);
    if (!b) continue;
    if (used.has(b.id)) {
      const other = used.get(b.id);
      ctx.emit('battery_idle', {
        side, secret: true, minor: true, battery: b.id, plan: plan.id,
        reason: `${k.label}: ${b.label} schießt in dieser Runde schon ${PLAN_KINDS[other.kind].label}.`, at: { ...b.pos },
      });
      continue;
    }
    const r = fireBattery(ctx.state, ctx.map, ctx.rng, side, b, cells, { kind: plan.kind, adjusted: !!plan.adjusted });
    if (!r.impacts.length) {
      ctx.emit('battery_idle', { side, secret: true, minor: true, battery: b.id, plan: plan.id, reason: `${k.label}: ${r.why}.`, at: { ...b.pos } });
      continue;
    }
    used.set(b.id, plan);
    out.fired++;
    const when = round ? ` (Runde ${round - plan.start + 1}${k.moves || k.id === 'prep' ? ` von ${plan.rounds}` : ''})` : '';
    ctx.emit('shelling', {
      side, secret: true, battery: b.id, plan: plan.id, kind: plan.kind, shells: r.shells, ammo: b.ammo, impacts: r.impacts,
      reason: `${b.label} schießt ${k.label}${when}: ${r.shells} Granaten auf ${rangeText(cells)}, noch ${b.ammo} am Geschütz.`,
      at: centerOf(cells),
    });
    out.salvos.push({ battery: b, impacts: r.impacts });
  }
  return out;
}

/** Einschlaege einer gezielten Salve auswerten (nach dem Zielen beider Seiten) */
function land(ctx, shot) {
  const { side, plan } = shot;
  const k = PLAN_KINDS[plan.kind];
  const all = [];
  for (const s of shot.salvos) {
    const t = batteryType(s.battery);
    applyImpacts(ctx.state, ctx.map, ctx.rng, s.impacts, {
      firing: side, emit: ctx.emit, turn: ctx.turn, what: k.label, lethal: t.lethal, suppression: t.suppression,
    });
    all.push(...s.impacts);
  }
  if (all.length) {
    const c = centerOf(all);
    ctx.emit('impacts', {
      impacts: all, from: side, kind: plan.kind,
      reason: `Einschläge bei ${cellLabel(c.x, c.y)}: ${all.length} Granaten.`,
      at: c,
    });
  }
}

function runPosition(ctx) {
  const state = ctx.state;
  // Bautrupps flicken Gleise, die vor dieser Runde zerschossen wurden
  for (const k of cellKeys(state)) {
    const c = state.cells[k];
    if (c.railBroken == null || c.railBroken === true || c.railBroken >= ctx.turn) continue;
    delete c.railBroken;
    const [x, y] = k.split(',').map(Number);
    ctx.emit('rail_repaired', { minor: true, reason: `Bautrupp hat das Gleis bei ${cellLabel(x, y)} geflickt.`, at: { x, y } });
  }
  for (const side of SIDES) {
    const art = state.sides[side].artillery;
    if (!art) continue;
    // Stoerungstrupps
    for (const l of art.lines) {
      if (!l.cut) continue;
      ctx.emit('line_repaired', {
        side, secret: true, minor: true, line: l.id,
        reason: `Störungstrupp hat die Leitung zu ${l.to} bei ${cellLabel(l.cut.x, l.cut.y)} geflickt.`,
        at: { ...l.cut },
      });
      l.cut = null;
    }
    art.pending = [];
    // Verbrauchte Plaene des letzten Angriffs fallen weg, Sperrfeuer bleibt auf Abruf
    art.plans = art.plans.filter((p) => !(p.used && p.kind !== 'barrage'));
    for (const p of art.plans) { p.fired = 0; delete p.ceasedFrom; delete p.shift; delete p.used; }
    // Nachschub aus dem Depot
    const sup = state.sides[side].supplies;
    for (const b of art.batteries) {
      b.silenced = 0;
      const cap = batteryCapacity(b, state.sides[side].faction);
      const want = Math.min(batteryType(b).refill, cap - b.ammo);
      if (want <= 0) continue;
      if (want < SHELLS_PER_AMMO) continue; // weniger als eine Depot-Einheit frei
      const units = Math.min(Math.floor(sup?.ammo ?? 0), Math.floor(want / SHELLS_PER_AMMO));
      const got = units * SHELLS_PER_AMMO;
      if (got <= 0) {
        ctx.emit('battery_dry', { side, secret: true, battery: b.id, reason: `${b.label}: Depot ohne Munition, kein Nachschub für die Geschütze.`, at: { ...b.pos } });
        continue;
      }
      sup.ammo -= units;
      b.ammo += got;
      ctx.emit('battery_supplied', {
        side, secret: true, minor: true, battery: b.id,
        reason: `${b.label} holt ${got} Granaten aus dem Depot (${b.ammo} am Geschütz).`, at: { ...b.pos },
      });
    }
  }
  // Neue Feuerplaene
  const shots = [];
  for (const side of SIDES) {
    const art = state.sides[side].artillery;
    const order = ctx.planOf ? ctx.planOf(side, 'fire_plan') : null;
    if (!art || !order) continue;
    const plans = order.plans.map((p) => normalizePlan(p)).sort((p, q) => compareId(p.id, q.id)); // ohne Laufzeitfelder
    const battle = plans.filter((p) => PLAN_KINDS[p.kind].round === 'battle');
    art.plans = battle;
    for (const p of battle) {
      const cells = planCellsAt(p, p.start, ctx.map);
      ctx.emit('fire_plan', {
        side, secret: true, plan: p.id, kind: p.kind,
        reason: `${PLAN_KINDS[p.kind].label} angelegt: ${p.batteries.length} ${p.batteries.length === 1 ? 'Batterie' : 'Batterien'}, ab Gefechtsrunde ${p.start}, ${p.rounds} Runden${p.step ? `, Schritt ${p.step} ${p.step === 1 ? 'Feld' : 'Felder'}` : ''}.`,
        at: centerOf(cells) ?? { ...p.a },
      });
    }
    const used = new Map();
    for (const p of plans.filter((x) => PLAN_KINDS[x.kind].round === 'position')) {
      const cells = targetCellsOf(p, state, side, ctx.map);
      if (!cells.length) continue;
      shots.push(aim(ctx, side, p, cells, { used }));
    }
  }
  // Erst zielen beide Seiten, dann schlagen alle Granaten ein
  for (const shot of shots) land(ctx, shot);
}

function runBattle(ctx) {
  const state = ctx.state;
  const round = state.battle?.round ?? 1;
  const darkness = darknessOf(state);
  for (const side of SIDES) {
    const art = state.sides[side].artillery;
    if (!art) continue;
    // 1. Befehle, die jetzt bei den Batterien ankommen
    const due = art.pending.filter((c) => c.due <= round).sort((p, q) => p.due - q.due || compareId(p.plan, q.plan));
    art.pending = art.pending.filter((c) => c.due > round);
    for (const c of due) {
      const p = art.plans.find((x) => x.id === c.plan);
      if (!p) continue;
      if (c.kind === 'cease') {
        p.ceasedFrom = round;
        ctx.emit('fire_ceased', {
          side, secret: true, plan: p.id,
          reason: `${PLAN_KINDS[p.kind].label} eingestellt, Meldung ${c.via === 'phone' ? 'per Telefon' : 'per Melder'} von ${c.observer}.`,
          at: centerOf(planCellsAt(p, round, ctx.map)) ?? { ...p.a },
        });
      } else {
        const now = planCellsAt({ ...p, shift: null }, Math.max(round, p.start), ctx.map);
        const cc = centerOf(now) ?? p.a;
        p.shift = { dx: c.target.x - cc.x, dy: c.target.y - cc.y };
        if (c.seen) p.adjusted = true;
        ctx.emit('fire_shifted', {
          side, secret: true, plan: p.id, target: { ...c.target },
          reason: `${PLAN_KINDS[p.kind].label} liegt jetzt auf ${cellLabel(c.target.x, c.target.y)}, verlegt ${c.via === 'phone' ? 'per Telefon' : 'per Melder'} von ${c.observer}${c.seen ? ', der Beobachter schießt ein' : ''}.`,
          at: { ...c.target },
        });
      }
    }
    // 2. Neue Befehle von Beobachtern
    for (const o of ctx.orders[side] ?? []) {
      if (o.type !== 'shift_fire' && o.type !== 'cease_fire') continue;
      const g = getGroup(state, o.group);
      if (!g || g.type !== 'observers') continue;
      const p = observerPlan(art, o, round, o.target ?? null, g.pos);
      if (!p) continue;
      const link = commandLink(state, side, g, p);
      const who = 'Beobachter ' + surname(g.leader.name);
      if (!link.via) {
        ctx.emit('command_lost', { side, secret: true, group: g.id, plan: p.id, reason: `${who}: kein Weg zu den Batterien (${link.why}). Die Artillerie schießt blind weiter.`, at: { ...g.pos } });
        continue;
      }
      const kind = o.type === 'cease_fire' ? 'cease' : 'shift';
      const seen = kind === 'shift' && ctx.map ? seesCellFrom(ctx.map, g, o.target, darkness) : false;
      art.pending.push({ plan: p.id, kind, target: o.target ? { ...o.target } : null, due: round + link.delay, via: link.via, observer: who, seen });
      const what = kind === 'cease' ? 'Feuer einstellen' : `Feuer verlegen nach ${cellLabel(o.target.x, o.target.y)}`;
      ctx.emit('command_sent', {
        side, secret: true, group: g.id, plan: p.id, via: link.via, delay: link.delay,
        reason: `${who} meldet ${link.why}: ${what}. Gilt ab Gefechtsrunde ${round + link.delay}.`,
        at: { ...g.pos },
      });
    }
  }
  // 3. Plaene zielen (je Seite nach Plan-ID, jede Batterie einmal je Runde), dann schlagen alle Granaten
  //    beider Seiten gemeinsam ein: wer zuerst gerechnet wird, trifft nicht zuerst.
  const shots = [];
  const usedBy = {};
  for (const side of SIDES) {
    const art = state.sides[side].artillery;
    if (!art) continue;
    const used = usedBy[side] = new Map();
    const seen = visibleEnemies(state, ctx.map, side, darkness).map((id) => getGroup(state, id));
    for (const p of activePlans(art, round)) {
      const cells = planCellsAt(p, round, ctx.map);
      if (!cells.length) continue;
      const k = PLAN_KINDS[p.kind];
      if (k.trigger === 'enemy' && !seen.some((g) => cells.some((c) => distance(c, g.pos) <= k.triggerRange))) continue;
      const shot = aim(ctx, side, p, cells, { round, used });
      if (shot.fired) {
        p.used = true;
        p.fired = (p.fired ?? 0) + 1;
        shots.push(shot);
      }
    }
  }
  // Schweigende Batterien zaehlen herunter, bevor neue Treffer sie wieder zum Schweigen bringen
  for (const side of SIDES) {
    const art = state.sides[side].artillery;
    if (!art) continue;
    for (const b of art.batteries) if (b.silenced > 0 && !usedBy[side].has(b.id)) b.silenced--;
  }
  for (const shot of shots) land(ctx, shot);
}

registerPhase({
  id: 'artillery',
  kind: 'both',
  order: { position: ORDER.position.artillery, battle: ORDER.battle.artillery },
  run(ctx) {
    if (!ctx.map) return; // reine Regeltests ohne Karte: keine Artillerie
    if (ctx.kind === 'position') runPosition(ctx);
    else runBattle(ctx);
  },
});

// Nach der Bewegung (und nach "exposure"): Beschuss zaehlt fuer die Erholung wie Feuer
registerPhase({
  id: 'shelled',
  kind: 'both',
  order: { position: ORDER.position.movement + 9, battle: ORDER.battle.movement + 9 },
  run(ctx) {
    for (const g of ctx.state.groups) {
      if (!g.shelled) continue;
      if (ctx.kind === 'battle') g.underFire = true;
      delete g.shelled;
    }
  },
});

// ---------- Befehlspruefungen ----------

registerOrderValidator('fire_plan', (order, group, state, env, side) => {
  if (!Array.isArray(order.plans)) return 'Feuerplan ohne Pläne';
  if (order.plans.length > MAX_PLANS) return `höchstens ${MAX_PLANS} Feuerpläne je Runde`;
  if (!state.sides[side]?.artillery?.batteries?.length) return 'keine Batterien';
  const ids = new Set();
  for (const p of order.plans) {
    if (!p || typeof p.id !== 'string' || ids.has(p.id)) return 'Feuerplan ohne eindeutige ID';
    ids.add(p.id);
    const why = validatePlan(p, state, side, env?.map ?? null);
    if (why) return why;
  }
  return null;
});

registerOrderValidator('shift_fire', (order, group, state, env) => {
  if (group.type !== 'observers') return 'nur Beobachter lenken die Artillerie';
  const art = artilleryOf(state, group.side);
  const round = state.battle?.round ?? 1;
  const p = observerPlan(art, order, round, order.target, group.pos);
  if (!p) return 'kein laufender Feuerplan';
  if (env?.map && !seesCellFrom(env.map, group, order.target, darknessOf(state))) return 'der Beobachter sieht das Ziel nicht';
  const link = commandLink(state, group.side, group, p);
  if (!link.via) return link.why;
  return null;
});

registerOrderValidator('cease_fire', (order, group, state) => {
  // Ohne Beobachter-Plaene ist "Feuer einstellen" der Befehl aus dem Gewehrfeuer (P05) und gilt immer
  if (group.type !== 'observers') return null;
  const art = artilleryOf(state, group.side);
  const p = observerPlan(art, order, state.battle?.round ?? 1, null, group.pos);
  if (!p) return 'kein Feuerplan schießt gerade';
  const link = commandLink(state, group.side, group, p);
  if (!link.via) return link.why;
  return null;
});
