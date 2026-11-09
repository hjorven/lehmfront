// Spielerinnen fuer den Missions-Simulator (P16): je Mission eine, die den Auftrag ernst nimmt ("gut"), und eine,
// die es nicht tut ("passiv" oder "falsch"). Belegt, dass jede Mission gewinnbar und verlierbar ist
// (test/akt1.test.js, tools/missions.mjs). Rein: Befehle aus Spielzustand und Sicht, kein Zufall.
import { cellAt, findPath } from '../js/map.js';
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
  // Beobachter nach vorn, dann ein Stosstrupp gegen das Nest mit Vorbereitungsfeuer beider Batterien darauf;
  // im Gefecht schiesst der Moerser auf das Nest
  gut: (ctx) => {
    const { state, view, map } = ctx;
    // Ohne Sicht gilt die Meldung aus dem Briefing: das MG liegt vor dem Heuwagen
    const nest = knownFoe(view, 'nest') ?? { pos: { x: 31, y: 14 }, seen: false };
    if (state.turnKind !== 'position') {
      const orders = ctx.ai({}).filter((o) => o.group !== ofType(state, 'mortar')[0]?.id);
      const mortar = ofType(state, 'mortar')[0];
      if (mortar && nest) orders.push({ group: mortar.id, type: 'fire', target: { ...nest.pos } });
      return orders;
    }
    const orders = ctx.ai({ posture: 'halten' }).filter((o) => o.type !== 'fire_plan');
    const take = (g) => { const i = orders.findIndex((o) => o.group === g.id); if (i >= 0) orders.splice(i, 1); };
    const obs = ofType(state, 'observers')[0];
    if (obs && (obs.pos.x !== 22 || obs.pos.y !== 14)) {
      take(obs);
      orders.push({ group: obs.id, type: 'redeploy', path: [{ x: 17, y: 13 }, { x: 18, y: 13 }, { x: 19, y: 13 }, { x: 20, y: 13 }, { x: 21, y: 13 }, { x: 22, y: 14 }] });
      return orders;
    }
    const bats = (state.sides.a.artillery?.batteries ?? []).map((b) => b.id).sort();
    if (nest && bats.length) {
      orders.push({ type: 'fire_plan', plans: [{ id: 'nest', kind: 'prep', batteries: bats, a: { x: nest.pos.x, y: nest.pos.y - 2 }, b: { x: nest.pos.x, y: nest.pos.y + 2 }, dir: 'E', start: 1, rounds: 3 }] });
      const raider = ofType(state, 'rifles').sort((p, q) => Math.abs(p.pos.y - nest.pos.y) - Math.abs(q.pos.y - nest.pos.y))[0];
      const path = raider && findPath(map, raider.pos, nest.pos)?.path?.slice(1);
      if (path?.length) { take(raider); orders.push({ group: raider.id, type: 'attack', path }); }
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

const KUHLE = [{ x: 24, y: 24 }, { x: 24, y: 25 }, { x: 24, y: 26 }, { x: 24, y: 27 }];

PLAYERS.a1m5 = {
  // Kuhle besetzt halten, muede Gruppen abloesen (KI-Regel "zu lange vorn"), verlorene Felder zurueckholen
  gut: (ctx) => {
    const { state, map } = ctx;
    if (state.turnKind !== 'position') return ctx.ai({});
    if (trenchesLost(map, state, 'a').length) return ctx.ai({ posture: 'gegenstoss' });
    const back = (g) => cellAt(map, g.pos.x, g.pos.y)?.zone === 'etappe';
    const resting = new Set(own(state).filter((g) => g.status === 'rest' || back(g)).map((g) => g.id));
    const orders = ctx.ai({ posture: 'halten' }).filter((o) => !resting.has(o.group) && !resting.has(o.by));
    const inside = own(state).filter((g) => KUHLE.some((p) => p.x === g.pos.x && p.y === g.pos.y));
    // Erschoepfte in der Kuhle gegen Ausgeruhte aus dem Ruhelager tauschen
    const fresh = own(state).filter((g) => resting.has(g.id) && g.morale >= 50);
    for (const g of inside.filter((x) => x.morale < 45).sort((p, q) => p.morale - q.morale)) {
      const by = fresh.shift();
      if (!by) break;
      const i = orders.findIndex((o) => o.group === g.id || o.group === by.id);
      if (i >= 0) orders.splice(i, 1);
      orders.push({ group: g.id, type: 'relieve', by: by.id });
    }
    if (inside.length < 2) {
      const free = KUHLE.find((p) => !own(state).some((g) => g.pos.x === p.x && g.pos.y === p.y));
      const busy = new Set(orders.filter((o) => o.type === 'relieve').flatMap((o) => [o.group, o.by]));
      const cand = own(state).filter((g) => g.type === 'rifles' && g.status !== 'rest' && !busy.has(g.id) && !inside.includes(g))
        .sort((p, q) => Math.abs(p.pos.y - 25) - Math.abs(q.pos.y - 25))[0];
      const path = cand && free && findPath(map, cand.pos, free)?.path?.slice(1);
      if (path?.length) {
        const i = orders.findIndex((o) => o.group === cand.id);
        if (i >= 0) orders.splice(i, 1);
        orders.push({ group: cand.id, type: 'redeploy', path });
      }
    }
    return orders;
  },
  // Zieht die Leute aus dem Wasser auf trockenen Boden zurueck (gegen den Befehl des Stabs)
  falsch: (ctx) => {
    const { state, map } = ctx;
    if (state.turnKind !== 'position') return [];
    const out = [];
    for (const g of own(state).filter((x) => x.pos.x === 24)) {
      const path = findPath(map, g.pos, { x: 18, y: g.pos.y })?.path?.slice(1);
      if (path?.length) out.push({ group: g.id, type: 'redeploy', path });
    }
    return out;
  },
  passiv: () => [],
};

PLAYERS.a1m6 = {
  // Halten, ablösen, was zu lange vorn ist (KI-Regel), jeden verlorenen Graben sofort zurückholen
  gut: (ctx) => {
    const { state, map } = ctx;
    if (state.turnKind !== 'position') return ctx.ai({});
    if (trenchesLost(map, state, 'a').length) return ctx.ai({ posture: 'gegenstoss' });
    return ctx.ai({ posture: 'halten' });
  },
  passiv: () => [],
};
