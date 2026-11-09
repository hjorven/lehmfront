// Etappe in der Stellungsrunde (Plan 4.1 Nr. 11, 6, 10.6 Schritt 4): Bauen, Reparieren, Belohnung waehlen,
// Bauzeit, Ertraege, Beschaedigung durch Beschuss, Aufklaerung durch den Gegner.
// Die Regeln fuer Ertrag und Nachbarboni stehen in js/etappe.js, das Raster auf der Karte in js/etappe-map.js.
//
// Befehl der ganzen Seite: { type: 'etappe', builds: [{ type, x, y }], repairs: [gebaeudeId], reward: { level, id } | null }
// x, y sind Parzellen (Etappenfelder). Material kommt aus dem Depot (state.sides[s].supplies.material).
//
// Ertraege, die hier wirken:
//   loren       -> supplies.cartsTotal (Kapazitaet der Feldbahn, js/supply.js liest sie in Schritt 7)
//   verpflegung -> Nachschub ins Depot (food), material/holz/beton -> Material ins Depot
//   Feldpost    -> alle 5 Stellungsrunden Moral +2 fuer alle Gruppen der Seite
// Alle anderen Ertraege (moral, erholung, heilung, sicht, leitung, streuung, batterie, ausbildung, trost ...)
// stehen nach jeder Stellungsrunde in etappe.yield; Moral (P12), Artillerie (P09), Sicht (P05) lesen sie dort.
//
// Beschuss: Wer ein Etappengebaeude trifft, setzt state.cells[k].buildingDamaged = true auf ein Feld der Parzelle
// oder ruft damageBuildingAt(state, side, x, y) auf. Die Phase uebernimmt das in die Etappe.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { BUILDINGS, ETAPPE_LEVELS } from '../config/buildings.js';
import {
  placeBuilding, repairBuilding, advanceConstruction, etappeYield, etappeLevel, chooseReward, buildTimeFor,
} from '../etappe.js';
import { etappeOf, plotCells, plotCenter, plotName, plotAt, syncRails, isBuilt } from '../etappe-map.js';
import { sideSeesCell, darknessOf } from '../sight.js';

/** Hoechstens so viele Bauauftraege je Stellungsrunde */
export const MAX_BUILDS = 8;
/** Rauch der Feldkueche ist am Tag bis so weit zu sehen (Kartenfelder, Schachbrett) */
export const SMOKE_RANGE = 28;

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byId = (a, b) => cmp(a.id, b.id);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const nameOf = (type) => BUILDINGS[type]?.name ?? type;

registerOrderValidator('etappe', (order, group, state, env, side) => {
  if (!etappeOf(state, side)) return 'diese Seite hat keine Etappe';
  const builds = order.builds ?? [];
  const repairs = order.repairs ?? [];
  if (!Array.isArray(builds) || !Array.isArray(repairs)) return 'Bauauftrag ist unvollständig';
  if (builds.length > MAX_BUILDS) return `höchstens ${MAX_BUILDS} Bauaufträge je Runde`;
  for (const b of builds) {
    if (!b || !Object.hasOwn(BUILDINGS, b.type)) return 'unbekanntes Gebäude im Bauauftrag';
    if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) return 'Bauauftrag ohne Feld';
  }
  for (const id of repairs) if (typeof id !== 'string') return 'Reparatur ohne Gebäude';
  if (order.reward != null && (!Number.isInteger(order.reward.level) || typeof order.reward.id !== 'string')) return 'Belohnung unvollständig';
  return null;
});

/** Treffer auf ein Kartenfeld der Etappe einer Seite: Gebaeude dort ist beschaedigt. Liefert das Gebaeude oder null. */
export function damageBuildingAt(state, side, x, y) {
  const et = etappeOf(state, side);
  const p = plotAt(et, x, y);
  if (!p) return null;
  const b = [...et.buildings].sort(byId).find((q) => q.x === p.x && q.y === p.y && BUILDINGS[q.type]?.kind !== 'rail');
  if (!b) return null;
  b.damaged = true;
  return b;
}

function where(et, b) {
  return plotCenter(et, b.x, b.y);
}

/**
 * Etappe einer Seite fuer eine Stellungsrunde. ctx: { map?, turn, emit, order?, night?, foe? }
 * Veraendert state (Entwurf). Gibt den Ertrag zurueck.
 */
export function runEtappeSide(state, side, ctx) {
  let et = etappeOf(state, side);
  if (!et) return null;
  const sup = state.sides[side].supplies;
  const emit = (type, f) => ctx.emit(type, { side, ...f });
  const act = (state.act | 0) || 1;

  // 1. Treffer aus dem Beschuss uebernehmen (buildingDamaged auf einem Feld der Parzelle)
  for (const b of [...et.buildings].sort(byId)) {
    if (BUILDINGS[b.type]?.kind === 'rail') continue;
    let hit = false;
    for (const c of plotCells(et, b.x, b.y)) {
      const k = c.x + ',' + c.y;
      if (state.cells[k]?.buildingDamaged) { hit = true; const { buildingDamaged, ...rest } = state.cells[k]; state.cells[k] = rest; }
    }
    if (hit && !b.damaged) {
      b.damaged = true;
      delete b.repairing;
    }
  }
  for (const b of [...et.buildings].sort(byId)) {
    if (b.damaged && !b.reported) {
      b.reported = true;
      emit('building_damaged', {
        building: b.id, buildingType: b.type, public: true,
        reason: `${nameOf(b.type)} ${plotName(b.x, b.y)} ist getroffen und bringt nichts mehr, bis es repariert ist.`,
        at: where(et, b),
      });
    }
  }

  const order = ctx.order ?? null;
  // 2. Belohnung der Etappenstufe
  if (order?.reward) {
    const r = chooseReward(et, order.reward.level, order.reward.id);
    if (r.ok) {
      et.rewards = r.etappe.rewards;
      const lv = r.etappe.rewards[order.reward.level];
      emit('etappe_reward', { level: order.reward.level, reward: lv, reason: `Etappe Stufe ${order.reward.level}: ${rewardName(order.reward.level, lv)} ist zugesagt.`, at: anchor(et) });
    } else {
      emit('build_refused', { reason: `Belohnung nicht möglich: ${r.reason}.`, at: anchor(et) });
    }
  }

  // 3. Reparaturen (halbe Baukosten, eine Stellungsrunde)
  for (const id of [...new Set(order?.repairs ?? [])].sort()) {
    const r = repairBuilding(et, id, { material: sup.material ?? 0 });
    const b = et.buildings.find((x) => x.id === id);
    if (!r.ok) {
      emit('build_refused', { reason: `Reparatur ${b ? nameOf(b.type) + ' ' + plotName(b.x, b.y) : id} nicht möglich: ${r.reason}.`, at: b ? where(et, b) : anchor(et) });
      continue;
    }
    sup.material = (sup.material ?? 0) - r.cost;
    et.buildings = r.etappe.buildings;
    const nb = et.buildings.find((x) => x.id === id);
    nb.repairing = true;
    delete nb.reported;
    emit('repair_started', { building: id, cost: r.cost, reason: `Pioniere reparieren ${nameOf(nb.type)} ${plotName(nb.x, nb.y)} für ${r.cost} Material.`, at: where(et, nb) });
  }

  // 4. Neue Bauauftraege in der befohlenen Reihenfolge
  for (const want of (order?.builds ?? []).slice(0, MAX_BUILDS)) {
    const time = buildTimeFor(et, want.type);
    const r = placeBuilding(et, want.x, want.y, want.type, { act, material: sup.material ?? 0 });
    const at = et.fields.some((f) => f.x === want.x && f.y === want.y) ? plotCenter(et, want.x, want.y) : anchor(et);
    if (!r.ok) {
      emit('build_refused', { buildingType: want.type, reason: `${nameOf(want.type)} auf ${plotName(want.x, want.y)} nicht gebaut: ${r.reason}.`, at });
      continue;
    }
    sup.material = (sup.material ?? 0) - r.cost;
    et.buildings = r.etappe.buildings;
    emit('build_started', {
      building: r.building.id, buildingType: want.type, cost: r.cost,
      reason: `Bauauftrag ${nameOf(want.type)} auf ${plotName(want.x, want.y)}: ${r.cost} Material, fertig in ${plural(time, 'Stellungsrunde', 'Stellungsrunden')}.`,
      at,
    });
  }

  // 5. Eine Stellungsrunde Arbeit: was diese Runde begonnen wurde, zaehlt schon mit
  const adv = advanceConstruction(et);
  et.buildings = adv.etappe.buildings;
  for (const id of adv.finished) {
    const b = et.buildings.find((x) => x.id === id);
    const again = b.repairing;
    delete b.repairing;
    emit(again ? 'building_repaired' : 'build_done', {
      building: id, buildingType: b.type,
      reason: again ? `${nameOf(b.type)} ${plotName(b.x, b.y)} ist repariert und wieder in Betrieb.` : `${nameOf(b.type)} ${plotName(b.x, b.y)} ist fertig.`,
      at: where(et, b),
    });
  }
  syncRails(state, side);

  // 6. Ertraege
  const y = etappeYield(et);
  const t = y.total;
  et.rounds = (et.rounds | 0) + 1;
  sup.cartsTotal = Math.max(0, t.loren ?? 0);
  const food = t.verpflegung ?? 0;
  const mat = (t.material ?? 0) + (t.holz ?? 0) + (t.beton ?? 0);
  if (food) sup.food = (sup.food ?? 0) + food;
  if (mat) sup.material = (sup.material ?? 0) + mat;
  const parts = [plural(sup.cartsTotal, 'Lore', 'Loren') + ' je Runde'];
  if (food) parts.push(`+${food} Verpflegung`);
  if (mat) parts.push(`+${mat} Material`);
  emit('etappe_yield', { minor: true, carts: sup.cartsTotal, food, material: mat, reason: `Etappe liefert ${parts.join(', ')}.`, at: anchor(et) });

  for (const p of y.periodic) {
    if (et.rounds % p.every !== 0) continue;
    const b = et.buildings.find((x) => x.id === p.id);
    if (p.res === 'moral') {
      for (const g of state.groups.filter((q) => q.side === side && q.status !== 'lost').sort(byId)) g.morale = Math.min(100, g.morale + p.amount);
    }
    emit('feldpost', { building: p.id, amount: p.amount, reason: `Die Feldpost ist da: Briefe von zu Hause für alle Gruppen, Moral +${p.amount}.`, at: where(et, b) });
  }

  const lv = etappeLevel(y.levelLoren).level;
  if (lv > (et.best | 0)) {
    et.best = lv;
    emit('etappe_level', { level: lv, reason: `Die Etappe schafft ${plural(y.levelLoren, 'Lore', 'Loren')} je Runde und steigt auf Stufe ${lv}. Im Etappenfenster wartet eine Belohnung.`, at: anchor(et) });
  }
  et.level = lv;
  et.yield = { ...t };
  for (const p of y.periodic) et.yield[p.res + 'Periodic'] = p.amount;

  // 7. Aufklaerung: sieht der Gegner ein Gebaeude, kennt er es (bleibt bekannt). Ueberraschung: Am Tag steigt
  //    Rauch aus der Feldkueche, den man weit sieht. Wer zu weit vorn kocht, verraet seine Kueche.
  if (ctx.map) spotBuildings(state, side, et, ctx);
  return y;
}

function rewardName(level, id) {
  const L = ETAPPE_LEVELS.find((l) => l.level === level);
  return L?.rewards.find((r) => r.id === id)?.name ?? id;
}

function anchor(et) {
  const d = [...et.buildings].sort(byId).find((b) => b.type === 'depot') ?? et.buildings[0];
  return d ? plotCenter(et, d.x, d.y) : plotCenter(et, et.fields[0].x, et.fields[0].y);
}

/** Raucht die Kueche gerade? Fertig, heil und Tag (gekocht wird zu den Mahlzeiten bei Tageslicht) */
export function isSmoking(b, night) {
  return !night && isBuilt(b) && !!BUILDINGS[b.type]?.smoke;
}

function spotBuildings(state, side, et, ctx) {
  const foe = side === 'a' ? 'b' : 'a';
  const foes = state.groups.filter((g) => g.side === foe && g.status !== 'lost').sort(byId);
  if (!foes.length) return;
  const dark = darknessOf(state);
  for (const b of [...et.buildings].sort(byId)) {
    if (b.spotted || b.remaining > 0 || BUILDINGS[b.type]?.kind === 'rail') continue;
    let how = null;
    for (const c of plotCells(et, b.x, b.y)) {
      if (sideSeesCell(state, ctx.map, foe, c, dark)) { how = 'sight'; break; }
    }
    if (!how && isSmoking(b, state.night)) {
      const c = plotCenter(et, b.x, b.y);
      if (foes.some((g) => Math.max(Math.abs(g.pos.x - c.x), Math.abs(g.pos.y - c.y)) <= SMOKE_RANGE)) how = 'smoke';
    }
    if (!how) continue;
    b.spotted = ctx.turn;
    b.spottedBy = how;
    const at = where(et, b);
    const name = `${nameOf(b.type)} ${plotName(b.x, b.y)}`;
    ctx.emit('building_spotted', {
      side, building: b.id, buildingType: b.type, how,
      reason: how === 'smoke'
        ? `Der Rauch über der ${name} ist bis in die feindlichen Linien zu sehen. Der Gegner kennt jetzt ihren Platz.`
        : `${name} liegt im Blick feindlicher Beobachter. Der Gegner kennt jetzt ihren Platz.`,
      at,
    });
    // Der Gegner merkt sich das Gebaeude (Gegenbatteriefeuer P09, Anzeige)
    const intel = state.sides[foe].intel ?? (state.sides[foe].intel = { lastSeen: {} });
    intel.buildings ??= {};
    const cells = plotCells(et, b.x, b.y);
    intel.buildings[side + ':' + b.id] = { side, type: b.type, x: cells[0].x, y: cells[0].y, w: et.plot, h: et.plot, turn: ctx.turn, how };
    ctx.emit('enemy_building_spotted', {
      side: foe, building: b.id, buildingType: b.type, how,
      reason: how === 'smoke'
        ? `Beobachter melden Rauch aus der feindlichen Etappe: dort steht eine Feldküche.`
        : `Beobachter haben in der feindlichen Etappe ein Gebäude erkannt: ${nameOf(b.type)}.`,
      at,
    });
  }
}

registerPhase({
  id: 'etappe',
  kind: 'position',
  order: ORDER.position.works + 5,
  run(ctx) {
    for (const side of ['a', 'b']) {
      if (!etappeOf(ctx.state, side)) continue;
      runEtappeSide(ctx.state, side, { map: ctx.map, turn: ctx.turn, emit: ctx.emit, order: ctx.planOf(side, 'etappe') });
    }
  },
});
