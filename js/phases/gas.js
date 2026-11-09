// Gas mit Wind, Windvorhersage und Gasmasken (Plan 4.2 Nr. 20, Paket P24). Rein: kein DOM, kein Date, kein Math.random.
// Regeln in js/gas.js, Werte in js/config/akt3.js. Nur in Szenarien mit features: ['gas'].
//
// Phasen:
//   wind          (Beginn jeder Runde)  Wuerfelt, ob die Vorhersage stimmt. Dreht der Wind, steht es im Protokoll.
//   gas-release   (Stellungsrunde, vor den Arbeiten)  Flaschen abblasen (Befehl gas, Pioniere im eigenen Graben)
//                 und Gasgranaten (Seitenbefehl gas_shell { target, battery }).
//   gas           (nach der Bewegung)  Die Wolke treibt Schritt fuer Schritt mit dem Wind. Wer unterwegs ins Gas
//                 geraet: mit Maske niedergehalten und erschoepft, ohne Maske (oder zu spaet) schwere Verluste.
//                 Die erste Gruppe, die das Gas trifft, schlaegt Alarm (Gasglocke): Nachbarn setzen rechtzeitig auf.
//   wind-forecast (Ende jeder Runde)  Neue Vorhersage fuer die naechste Runde.
// Gas kostet beide Seiten Moral (Gruppen nahe der Freisetzung), Briefe und Tagebuch greifen es auf (Ereignis gas_released).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance } from '../map.js';
import { otherSide } from '../state.js';
import { featureOn } from '../underground.js';
import { trenchOf } from '../weather.js';
import { batteryCenter, batteryType, spreadOf, scatter } from '../artillery.js';
import { flagFor } from '../modifiers.js';
import { surname } from './hold.js';
import { GAS, WIND_NAMES } from '../config/akt3.js';
import {
  windOf, windText, forecastSure, makeForecast, rollWind, gasMap, writeGas, driftStep, driftSteps,
  cylinderCells, shellCells,
} from '../gas.js';

const name = (g) => 'Gruppe ' + surname(g.leader.name);
const on = (state) => featureOn(state, 'gas');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Gasvorrat einer Seite: { cylinders, shells } */
export function gasStock(state, side) {
  const s = state.sides[side]?.gas;
  return { cylinders: s?.cylinders ?? 0, shells: s?.shells ?? 0 };
}

/** Hat die Seite Gasmasken? (ab Akt 3) */
export function hasMasks(state, side) {
  return !!state.sides[side]?.masks;
}

// ------------------------------------------------------------------ Befehle pruefen

/** Warum kann die Gruppe hier kein Gas abblasen? null = geht */
export function cylinderProblem(state, map, group) {
  if (!on(state)) return 'Gas gibt es erst in Akt 3';
  if (group.type !== 'pioneers') return 'Gasflaschen öffnen nur Pioniere';
  if (gasStock(state, group.side).cylinders <= 0) return 'keine Gasflaschen mehr im Graben';
  const tr = map ? trenchOf(state, map, group.pos.x, group.pos.y) : { side: group.side === 'a' ? 'own' : 'enemy' };
  if (!tr || tr.side !== (group.side === 'a' ? 'own' : 'enemy')) return 'die Flaschen stehen nur im eigenen Graben';
  if (group.inDugout) return 'Gruppe sitzt im Unterstand';
  return null;
}

/** Warum geht diese Gasgranaten-Salve nicht? null = geht */
export function shellProblem(state, side, order) {
  if (!on(state)) return 'Gas gibt es erst in Akt 3';
  if (gasStock(state, side).shells <= 0) return 'keine Gasgranaten im Depot';
  const t = order?.target;
  if (!t || !Number.isInteger(t.x) || !Number.isInteger(t.y) || t.x < 0 || t.y < 0 || t.x >= state.map.width || t.y >= state.map.height) return 'Gasgranaten brauchen ein Zielfeld auf der Karte';
  const art = state.sides[side]?.artillery;
  const b = art?.batteries?.find((x) => x.id === String(order.battery));
  if (!b) return 'Gasgranaten brauchen eine Batterie';
  if ((b.silenced | 0) > 0) return `${b.label} schweigt`;
  if ((b.ammo ?? 0) < GAS.shellAmmo) return `${b.label} hat zu wenig Munition (${GAS.shellAmmo} nötig)`;
  const d = distance(batteryCenter(b), t);
  if (d > Math.min(GAS.shellRange, batteryType(b).range)) return `${b.label} reicht nicht bis ${cellLabel(t.x, t.y)}`;
  return null;
}

/** Erste Batterie, die eine Gas-Salve auf das Ziel schiessen kann (nach ID) */
export function shellBattery(state, side, target) {
  const art = state.sides[side]?.artillery;
  for (const b of [...(art?.batteries ?? [])].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    if (!shellProblem(state, side, { target, battery: b.id })) return b;
  }
  return null;
}

registerOrderValidator('gas', (order, group, state, env) => cylinderProblem(state, env.map ?? null, group));
registerOrderValidator('gas_shell', (order, group, state, env, side) => shellProblem(state, side, order));

// ------------------------------------------------------------------ Wind

function runWind(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  if (s.weather?.windFixed || s.weather?.fixed) return;
  const before = windOf(s);
  const f = s.weather?.windForecast;
  if (!f) return;
  const { wind, held } = rollWind(ctx.rng, f, before);
  s.weather = { ...s.weather, wind };
  if (!held) {
    ctx.emit('wind_shift', {
      public: true, from: f.dir, to: wind.dir, speed: wind.speed,
      reason: `Der Wind hält sich nicht an die Vorhersage: statt ${WIND_NAMES[f.dir] ?? 'des erwarteten Windes'} weht ${windText(wind)}.`,
      at: { x: Math.floor(s.map.width / 2), y: Math.floor(s.map.height / 2) },
    });
  }
}

function runForecast(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  const w = windOf(s);
  if (s.weather?.windFixed || s.weather?.fixed) {
    s.weather = { ...s.weather, windForecast: { ...w, sure: 100 } };
    return;
  }
  // Fuer die naechste Runde: nach einer Stellungsrunde kann ein Gefecht folgen (fuenf Minuten, sicherer)
  const battleNext = s.turnKind === 'battle';
  s.weather = { ...s.weather, windForecast: makeForecast(ctx.rng, w, forecastSure(s, battleNext)) };
}

// ------------------------------------------------------------------ Freisetzen

function release(ctx, side, cells, how, at) {
  const s = ctx.state;
  const m = gasMap(s);
  for (const c of cells) {
    const k = c.x + ',' + c.y;
    const old = m.get(k);
    if (!old || old.d < c.d) m.set(k, { d: c.d, by: side });
  }
  writeGas(s, m, ctx.turn);
  s.sides[side].gasUsed = (s.sides[side].gasUsed | 0) + 1;
  ctx.emit('gas_released', {
    side, public: true, how, cells: cells.length,
    reason: how === 'cylinder'
      ? `Bei ${cellLabel(at.x, at.y)} zischen die Flaschen. Eine gelbe Wand kriecht los, ${windText(windOf(s))}.`
      : `Gasgranaten schlagen bei ${cellLabel(at.x, at.y)} ein, dumpf, fast leise. Gelber Nebel steigt auf.`,
    at: { ...at },
  });
  // Gas kostet beide Seiten Moral: wer es sieht, weiss, was es ist
  const near = ctx.groups().filter((g) => distance(g.pos, at) <= GAS.dreadRadius);
  for (const g of near) g.morale = Math.max(0, g.morale - GAS.dreadMorale);
  for (const sd of ['a', 'b']) {
    const n = near.filter((g) => g.side === sd).length;
    if (!n) continue;
    ctx.emit('gas_dread', {
      side: sd, secret: true, minor: true, groups: n, amount: GAS.dreadMorale,
      reason: sd === side
        ? `Auch die eigenen Leute sehen der gelben Wand nach. ${plural(n, 'Gruppe', 'Gruppen')}: Moral sinkt um ${GAS.dreadMorale}.`
        : `Gas! ${plural(n, 'Gruppe sieht', 'Gruppen sehen')} die Wolke kommen. Moral sinkt um ${GAS.dreadMorale}.`,
      at: { ...at },
    });
  }
}

function runRelease(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  for (const o of ctx.ordersOfType('gas')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const why = cylinderProblem(s, ctx.map, g);
    if (why) {
      ctx.emit('gas_failed', { side: g.side, group: g.id, secret: true, blocked: true, reason: `${name(g)} bläst kein Gas ab: ${why}.`, at: { ...g.pos } });
      continue;
    }
    s.sides[g.side].gas.cylinders -= 1;
    const cells = cylinderCells(s, ctx.map, g).map((c) => ({ ...c, d: GAS.cylinderDensity }));
    release(ctx, g.side, cells, 'cylinder', g.pos);
  }
  for (const side of ['a', 'b']) {
    const o = ctx.planOf(side, 'gas_shell');
    if (!o) continue;
    const why = shellProblem(s, side, o);
    if (why) {
      ctx.emit('gas_failed', { side, secret: true, blocked: true, reason: `Gasgranaten bleiben im Depot: ${why}.`, at: { ...(o.target ?? { x: 0, y: 0 }) } });
      continue;
    }
    const art = s.sides[side].artillery;
    const b = art.batteries.find((x) => x.id === String(o.battery));
    b.ammo -= GAS.shellAmmo;
    s.sides[side].gas.shells -= 1;
    // Streuung wie bei der Batterie: die Salve liegt hoechstens shellScatter Felder daneben
    const spread = spreadOf(b, art, s.sides[side].faction, { night: s.night });
    const off = () => Math.max(-GAS.shellScatter, Math.min(GAS.shellScatter, scatter(ctx.rng, spread)));
    const ox = off(), oy = off();
    const c = {
      x: Math.max(0, Math.min(s.map.width - 1, o.target.x + ox)),
      y: Math.max(0, Math.min(s.map.height - 1, o.target.y + oy)),
    };
    release(ctx, side, shellCells(c, s.map), 'shell', c);
  }
}

// ------------------------------------------------------------------ Treiben und Wirkung

/** Chance in Prozent, dass eine Gruppe die Maske zu spaet aufsetzt (erste Beruehrung mit dieser Wolke) */
export function lateChance(state, group, { alarm = false } = {}) {
  let p = state.night ? GAS.latePct.night : GAS.latePct.day;
  if (group.inDugout) p += GAS.latePct.dugout;
  if (alarm) p += GAS.latePct.alarm;
  if ((group.traits ?? []).includes('wachsam') || flagFor('exit', { state, group })) p += GAS.latePct.wachsam;
  return Math.max(0, Math.min(90, p));
}

function runDrift(ctx) {
  const s = ctx.state;
  if (!on(s)) return;
  let m = gasMap(s);
  if (!m.size) return;
  const wind = windOf(s);
  const steps = driftSteps(wind, ctx.kind, ctx.turn);
  // Hoechste Dichte je Gruppe ueber alle Schritte (auch das Feld zu Beginn: wer hineinlief, steht drin)
  const groups = ctx.groups();
  const at = new Map();
  for (const g of groups) { const k = g.pos.x + ',' + g.pos.y; at.set(k, [...(at.get(k) ?? []), g]); }
  const worst = new Map();
  const firstStep = new Map();
  const touch = (mm, step) => {
    for (const [k, e] of mm) {
      for (const g of at.get(k) ?? []) {
        if ((worst.get(g.id) ?? 0) < e.d) worst.set(g.id, e.d);
        if (!firstStep.has(g.id)) firstStep.set(g.id, step);
      }
    }
  };
  touch(m, 0);
  for (let i = 0; i < steps; i++) {
    m = driftStep(m, wind, ctx.map, s, ctx.rng);
    touch(m, i + 1);
  }
  writeGas(s, m, ctx.turn);
  if (!worst.size) return;

  // Gasalarm: wer zuerst getroffen wird, schlaegt die Glocke fuer die Nachbarn (gleiche Seite, die danach kommen)
  const hit = groups.filter((g) => worst.has(g.id));
  const alarmed = new Set();
  for (const g of [...hit].sort((p, q) => firstStep.get(p.id) - firstStep.get(q.id) || (p.id < q.id ? -1 : 1))) {
    const t = firstStep.get(g.id);
    for (const n of hit) {
      if (n.side === g.side && n.id !== g.id && firstStep.get(n.id) > t && distance(n.pos, g.pos) <= GAS.alarmRadius) alarmed.add(n.id);
    }
  }
  const alarmBy = new Map();
  for (const g of hit) {
    if (alarmed.has(g.id) || alarmBy.has(g.side)) continue;
    if (hit.some((n) => alarmed.has(n.id) && n.side === g.side)) alarmBy.set(g.side, g);
  }
  for (const [side, g] of [...alarmBy].sort()) {
    ctx.emit('gas_alarm', {
      side, secret: true, group: g.id,
      reason: `${name(g)} schlägt Gasalarm: die Glocke aus einer Kartusche läutet bei ${cellLabel(g.pos.x, g.pos.y)}. Die Nachbarn haben die Masken auf, bevor die Wolke da ist.`,
      at: { ...g.pos },
    });
  }

  for (const g of [...hit].sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const d = worst.get(g.id);
    const fresh = g.gasTurn !== ctx.turn - 1 && g.gasTurn !== ctx.turn;
    g.gasTurn = ctx.turn;
    let lossPct = 0;
    let late = false;
    if (!hasMasks(s, g.side)) lossPct = GAS.lossPct[d];
    else if (fresh && Math.floor(ctx.rng() * 100) < lateChance(s, g, { alarm: alarmed.has(g.id) })) {
      late = true;
      lossPct = Math.floor((GAS.lossPct[d] * GAS.lateLossFactor) / 100);
    }
    let losses = 0;
    for (let i = 0; i < g.strength; i++) if (Math.floor(ctx.rng() * 100) < lossPct) losses++;
    losses = Math.min(g.strength, losses);
    // Mit Maske: kaum Sicht, kaum Luft. Niedergehalten, erschoepft, die Moral leidet
    g.suppressed = Math.min(1, Math.floor(((g.suppressed ?? 0) * 100 + GAS.maskSuppression * d)) / 100);
    g.fatigue = Math.min(100, (g.fatigue ?? 0) + GAS.maskFatigue * d);
    g.morale = Math.max(0, g.morale - GAS.maskMorale * d - (losses ? 2 : 0));
    g.underFire = true;
    const thick = ['', 'dünn', 'dicht', 'sehr dicht'][d];
    const where = cellLabel(g.pos.x, g.pos.y);
    if (late) {
      ctx.emit('gas_late', {
        side: g.side, group: g.id, secret: true, density: d,
        reason: `${name(g)} hat die Masken zu spät auf (${where}, Gas ${thick}).`, at: { ...g.pos },
      });
    }
    const why = !hasMasks(s, g.side)
      ? `${name(g)} steht ohne Masken im Gas (${where}, ${thick})`
      : late ? `${name(g)} hustet, die Augen brennen` : `${name(g)} sitzt mit Masken im Gas (${where}, ${thick}): blind und kurzatmig, niedergehalten`;
    ctx.emit(losses ? 'losses' : 'gas_exposed', {
      side: g.side, group: g.id, amount: losses, cause: 'gas', density: d, minor: !losses && !late,
      reason: losses ? `${why}: ${plural(losses, 'Ausfall', 'Ausfälle')}.` : `${why}.`,
      at: { ...g.pos },
    });
    if (losses) {
      g.strength -= losses;
      s.sides[g.side].gasCasualties = (s.sides[g.side].gasCasualties | 0) + losses;
      if (g.strength <= 0) {
        g.strength = 0;
        g.status = 'lost';
        s.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos }, cause: 'gas' });
        ctx.emit('group_lost', {
          side: g.side, group: g.id, public: true,
          reason: `${name(g)} ist im Gas geblieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
          at: { ...g.pos },
        });
      }
    }
  }
}

registerPhase({ id: 'wind', kind: 'both', order: { position: ORDER.position.orders + 5, battle: ORDER.battle.orders + 5 }, run: runWind });
registerPhase({ id: 'gas-release', kind: 'position', order: ORDER.position.artillery + 3, run: runRelease });
registerPhase({ id: 'gas', kind: 'both', order: { position: ORDER.position.movement + 3, battle: ORDER.battle.movement + 3 }, run: runDrift });
registerPhase({ id: 'wind-forecast', kind: 'both', order: { position: ORDER.position.clock - 4, battle: ORDER.battle.clock - 4 }, run: runForecast });

export { otherSide };
