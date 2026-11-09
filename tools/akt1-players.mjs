// Spielerinnen fuer den Missions-Simulator (P16): je Mission eine, die den Auftrag ernst nimmt ("gut"), und eine,
// die es nicht tut ("passiv" oder "falsch"). Belegt, dass jede Mission gewinnbar und verlierbar ist
// (test/akt1.test.js, tools/missions.mjs). Rein: Befehle aus Spielzustand und Sicht, kein Zufall.
import { cellAt } from '../js/map.js';
import { liveMap, trenchesLost } from '../js/missions/goals.js';
import { supplyOf, depotAfterIncome, capacityOf, sectionsOf, frontGroups, upkeepOf, woundedCount } from '../js/supply.js';
import { CART_LOAD } from '../js/config/supply.js';

const own = (state) => state.groups.filter((g) => g.side === 'a' && g.status !== 'lost').sort((p, q) => (p.id < q.id ? -1 : 1));
const byLeader = (state, name) => own(state).find((g) => g.leader?.name === name);
const vline = (x, y0, y1) => { const out = []; const d = y1 >= y0 ? 1 : -1; for (let y = y0; y !== y1 + d; y += d) out.push({ x, y }); return out; };

/** Graben ziehen: jede Gruppe ihr Stueck, beginnend am naechsten Ende */
function dig(g, cells, level = 2) {
  const first = cells[0], last = cells[cells.length - 1];
  const d = (p) => Math.max(Math.abs(p.x - g.pos.x), Math.abs(p.y - g.pos.y));
  const path = d(first) <= d(last) ? cells : cells.slice().reverse();
  return { group: g.id, type: 'dig', path, level, kind: 'fire' };
}

/** Nur in Stellungsrunden befehlen, im Gefecht haelt (bzw. entscheidet die KI fuer Seite a) */
const positionOnly = (fn) => (ctx) => (ctx.state.turnKind === 'position' ? fn(ctx) : ctx.ai({ posture: 'halten' }));

export const PLAYERS = {
  a1m1: {
    // Mission 1: Linie von der Muehle bis zum Kraehenholz in Stuecken, mit einem Knick bei Hof Klaas
    gut: positionOnly(({ state }) => {
      const gs = own(state);
      const parts = [vline(22, 9, 15), vline(22, 16, 21), vline(22, 22, 28), vline(22, 29, 31)];
      return gs.map((g, i) => dig(g, parts[i % parts.length]));
    }),
    // Graebt nur das eigene Loch tiefer und wartet
    passiv: () => [],
  },
};

/** Gruppe nach Typ (erste nach ID) */
const ofType = (state, type) => own(state).filter((g) => g.type === type);

PLAYERS.a1m2 = {
  // MG-Kegel ueber die Weide, Draht in die Gasse, im Gefecht halten und schiessen (KI fuer Seite a, Lage halten)
  gut: (ctx) => {
    const { state, round } = ctx;
    if (state.turnKind !== 'position') return ctx.ai({});
    if (trenchesLost(ctx.map, state, 'a').length) return ctx.ai({ posture: 'gegenstoss' });
    const orders = ctx.ai({ posture: 'halten' }).filter((o) => o.type !== 'sector');
    for (const mg of ofType(state, 'mg')) orders.push({ group: mg.id, type: 'sector', target: { x: 30, y: 17 } });
    const pio = ofType(state, 'pioneers')[0];
    if (pio && round === 1) {
      const i = orders.findIndex((o) => o.group === pio.id);
      if (i >= 0) orders.splice(i, 1);
      orders.push({ group: pio.id, type: 'wire', path: [{ x: 24, y: 20 }, { x: 24, y: 21 }] });
    }
    return orders;
  },
  // Gibt keinen einzigen Befehl: das MG schaut geradeaus, niemand kommt aus dem Unterstand
  passiv: () => [],
};

PLAYERS.a1m3 = {
  // Lorenplan von Hand: Verpflegung so knapp wie moeglich, Munition so viel das Depot hergibt, Sanitaetslore zu Wartenden
  gut: (ctx) => {
    const { state, map } = ctx;
    if (state.turnKind !== 'position') return ctx.ai({});
    return [...ctx.ai({ posture: 'halten' }).filter((o) => o.type !== 'supply_plan'), { type: 'supply_plan', wagons: handPlan(map, state) }];
  },
  // Gibt keinen Lorenplan: es faehrt der Vorschlag der Feldbahn, der nur vier Runden Vorrat anstrebt
  passiv: () => [],
  // Schickt jede Runde zwoelf Loren Munition, ob das Depot sie hat oder nicht
  falsch: (ctx) => (ctx.state.turnKind === 'position'
    ? [{ type: 'supply_plan', wagons: ['A', 'B', 'C'].flatMap((to) => [0, 1, 2, 3].map(() => ({ load: 'ammo', to }))) }]
    : []),
};

function handPlan(map, state) {
  const sup = supplyOf(state, map, 'a');
  const depot = depotAfterIncome(state, map, 'a');
  const cap = capacityOf(state, 'a');
  const plan = [];
  const secs = sectionsOf(map).filter((s) => frontGroups(map, state, 'a', s).length);
  const stock = Object.fromEntries(secs.map((s) => [s.id, { ...sup.sections[s.id] }]));
  const need = Object.fromEntries(secs.map((s) => [s.id, upkeepOf(map, state, 'a', s)]));
  for (const s of secs) if (woundedCount(sup.sections[s.id]) >= 2 && plan.length < cap) plan.push({ load: 'medic', to: s.id });
  // Verpflegung: zwei Runden Vorrat
  for (const s of secs) {
    while (stock[s.id].food < need[s.id].food * 2 && depot.food >= CART_LOAD && plan.length < cap) {
      plan.push({ load: 'food', to: s.id }); stock[s.id].food += CART_LOAD; depot.food -= CART_LOAD;
    }
  }
  // Munition: immer dorthin, wo am wenigsten liegt, solange das Depot volle Loren hergibt
  while (depot.ammo >= CART_LOAD && plan.length < cap) {
    const s = secs.slice().sort((p, q) => stock[p.id].ammo / need[p.id].ammo - stock[q.id].ammo / need[q.id].ammo || (p.id < q.id ? -1 : 1))[0];
    plan.push({ load: 'ammo', to: s.id }); stock[s.id].ammo += CART_LOAD; depot.ammo -= CART_LOAD;
  }
  return plan;
}

/** Feind in Sicht oder als Geist bekannt */
function knownFoe(view, id) {
  const g = view.groups.find((x) => x.id === id && x.side !== 'a');
  if (g) return { pos: g.pos, seen: true };
  const ghost = (view.ghosts ?? []).find((x) => x.id === id || x.group === id);
  return ghost ? { pos: ghost.pos, seen: false } : null;
}

PLAYERS.a1m4 = {
  // Beobachter nach vorn in die Muehle, dann Stoerfeuer beider Batterien auf das Nest, sobald es gesehen ist
  gut: (ctx) => {
    const { state, view } = ctx;
    if (state.turnKind !== 'position') return ctx.ai({});
    const orders = ctx.ai({ posture: 'halten' }).filter((o) => o.type !== 'fire_plan');
    const obs = ofType(state, 'observers')[0];
    if (obs && (obs.pos.x !== 22 || obs.pos.y !== 14)) {
      const i = orders.findIndex((o) => o.group === obs.id);
      if (i >= 0) orders.splice(i, 1);
      orders.push({ group: obs.id, type: 'redeploy', path: [{ x: 17, y: 13 }, { x: 18, y: 13 }, { x: 19, y: 13 }, { x: 20, y: 13 }, { x: 21, y: 13 }, { x: 22, y: 14 }] });
    }
    const nest = knownFoe(view, 'nest');
    const bats = (state.sides.a.artillery?.batteries ?? []).map((b) => b.id).sort();
    if (nest && bats.length) {
      orders.push({ type: 'fire_plan', plans: bats.map((b, i) => ({ id: 'nest' + i, kind: 'harass', batteries: [b], target: { ...nest.pos } })) });
    }
    return orders;
  },
  // Schiesst dorthin, wo das MG laut Karte gestern stand (zwei Felder daneben), und wartet sonst
  falsch: (ctx) => {
    const bats = (ctx.state.sides.a.artillery?.batteries ?? []).map((b) => b.id).sort();
    return ctx.state.turnKind === 'position' && bats.length ? [{ type: 'fire_plan', plans: [{ id: 'gestern', kind: 'harass', batteries: [bats[0]], target: { x: 33, y: 10 } }] }] : [];
  },
  passiv: () => [],
};
