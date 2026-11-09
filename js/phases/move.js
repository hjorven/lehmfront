// Bewegung (Plan 3.3, 4.1 Nr. 4 und 9, 10.6): "Bewegen" und "Sturm" in Gefechtsrunden, "Verlegen" in Stellungsrunden.
// Erste Fassung aus P03, P06 hat Draht, Begegnungen, Unterstand und Sturm ergaenzt.
// Ein Befehl traegt den Weg ohne Startfeld: path = [{x,y}, ...].
// Regeln:
// - Budget je Runde: Gefecht speed * 10 Zehntel (Plan 5: Felder je Gefechtsrunde),
//   Stellung speed * 40 (zwoelf Stunden, aber Tragen, Gedraenge und Laufgraeben).
// - Kosten je Feld wie A* (map.enterCost auf dem Feld mit Spielzustand), diagonal 14/10. Ein Feld schafft jede
//   Gruppe immer.
// - Alle gehen gleichzeitig Feld fuer Feld; ein Feld, das am Ende noch besetzt ist, haelt die Gruppe davor an.
//   Tauschen zwei Gruppen die Plaetze, bleiben beide stehen.
// - Draht (P06): Wer feindlichen Draht betritt, haengt fest und kommt in dieser Runde nicht weiter. Pioniere
//   schneiden dabei eine Gasse (der Draht ist weg). Durch eigenen Draht fuehren Gassen: er kostet nur Zeit.
// - Begegnung (P06): Steht auf dem naechsten Feld eine feindliche Gruppe, bleibt die Gruppe davor stehen und
//   merkt sich das als Nahkampf (g.engage); js/phases/melee.js traegt ihn aus.
// - Sturm (P06): Wer stuermt und ein leeres feindliches Grabenfeld erreicht, bricht ein (captureTrench) und bleibt
//   fuer diese Runde dort: der Graben wird Feld fuer Feld genommen.
// - Wer im Unterstand sitzt, bewegt sich nicht; der Befehl laeuft weiter, bis die Gruppe oben ist (dugout.js).
// - Verlegen bleibt hinter der eigenen Linie: kein Niemandsland, keine fremde Zone. Ausnahme Rueckzug: Wer
//   draussen steht (nach einem Gefecht), darf durchs Niemandsland zurueck.
// - Was nicht geschafft wird, steht im Ereignis als rest; die Oberflaeche traegt es als Befehl weiter.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, enterCost, cellLabel } from '../map.js';
import { unitType } from '../config/units.js';
import { surname } from './hold.js';
import { PINNED } from '../sight.js';
import { captureTrench } from '../trench.js';

export const BATTLE_FACTOR = 10;
export const POSITION_FACTOR = 40;
/** Laengster Sturmweg (Felder) */
export const MAX_ASSAULT_CELLS = 40;
/** Einheiten, die stuermen koennen (Plan 5: Schuetzen, Pioniere, spaeter Stosstrupp, Flammenwerfer, Panzerwagen) */
export const ASSAULT_TYPES = new Set(['rifles', 'pioneers', 'stormtroops', 'flamethrowers', 'tank']);
/** Einheiten, die feindlichen Draht schneiden */
export const WIRE_CUTTERS = new Set(['pioneers', 'stormtroops']);

/** Bewegungsbudget einer Gruppe in Zehnteln */
export function moveBudget(group, kind) {
  const full = unitType(group.type).speed * (kind === 'battle' ? BATTLE_FACTOR : POSITION_FACTOR);
  // Niedergehalten (P05) im Gefecht: nur noch halb so weit, die Gruppe kriecht
  return kind === 'battle' && (group.suppressed ?? 0) >= PINNED ? Math.floor(full / 2) : full;
}

/** Feld mit Spielzustand (Graeben, Krater, Draht aus state.cells ueberdecken die Karte) */
export function liveCell(map, state, x, y) {
  const c = map ? cellAt(map, x, y) : null;
  const s = state?.cells?.[x + ',' + y];
  if (!c) return null;
  return s ? { ...c, ...s } : c;
}

/**
 * Zusatzkosten fuer das Betreten eines Feldes aus dem Spielzustand (Schlamm P10 ...).
 * fn(state, map, {x,y}) -> Zehntel. Regeln melden sich hier an, statt stepCost umzuschreiben.
 */
const costRules = [];
export function addStepCostRule(fn) {
  costRules.push(fn);
  return () => { const i = costRules.indexOf(fn); if (i >= 0) costRules.splice(i, 1); };
}

/** Summe der Zusatzkosten eines Feldes (Zehntel) */
export function extraCost(state, map, p) {
  if (!state) return 0;
  let sum = 0;
  for (const fn of costRules) sum += fn(state, map, p) || 0;
  return sum;
}

/**
 * Kosten eines Schritts von a nach b (Zehntel), diagonal 14/10. Mit state zaehlen der Feldzustand (Draht
 * geschnitten, neue Graeben, P06) und die Zusatzkosten (Schlamm, P10) mit.
 */
export function stepCost(map, a, b, state = null) {
  const c = map ? liveCell(map, state, b.x, b.y) : null;
  let base = c ? enterCost(c) : 10;
  if (!Number.isFinite(base)) return Infinity;
  base += extraCost(state, map, b);
  return a.x !== b.x && a.y !== b.y ? Math.floor((base * 14) / 10) : base;
}

/** Zonenseite einer Spielseite auf der Karte: Seite a spielt die eigene ("own") Kartenhaelfte */
export function mapSideOf(side) {
  return side === 'a' ? 'own' : 'enemy';
}

/** Feindlicher Draht auf dem Feld (fuer diese Seite)? */
export function enemyWire(cell, side) {
  return !!(cell?.wire && cell.wire.side !== mapSideOf(side));
}

/** Darf eine Seite beim Verlegen dieses Feld betreten? */
export function redeployAllowed(cell, side) {
  if (!cell) return false;
  return cell.zone !== 'niemandsland' && cell.side === mapSideOf(side);
}

/**
 * Verlegen fuer eine Gruppe: hinter der eigenen Linie, oder als Rueckzug, wenn die Gruppe selbst draussen steht.
 * home = Feld der Gruppe (mit Karte), cell = Zielfeld des Schritts.
 */
export function redeployCellOk(cell, side, home) {
  if (redeployAllowed(cell, side)) return true;
  return !!cell && !!home && !redeployAllowed(home, side);
}

/**
 * Wie weit kommt eine Gruppe auf einem Weg, Runde fuer Runde, wenn ihr niemand im Weg steht? (rein)
 * Beruecksichtigt Budget, Draht (feindlicher Draht haelt an) und den Einbruch beim Sturm.
 * Liefert { reach (Felder in dieser Runde), rounds, wire (feindliche Drahtfelder), breach (Index des ersten
 * feindlichen Grabenfelds oder -1) }.
 */
export function roundsAlong(map, state, group, path, kind = state.turnKind, type = null) {
  const budget = moveBudget(group, kind);
  const storming = type === 'assault' || type === 'attack';
  const ms = mapSideOf(group.side);
  let rounds = 1, left = budget, reach = -1, prev = group.pos, steps = 0, wire = 0, breach = -1;
  const cut = new Set();
  const endRound = (i) => { rounds++; left = budget; steps = 0; if (reach < 0) reach = i; };
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const c = map ? liveCell(map, state, p.x, p.y) : null;
    let cost = stepCost(map, prev, p, state);
    if (!Number.isFinite(cost)) break;
    if (cost > left && steps > 0) endRound(i);
    left -= cost;
    steps++;
    prev = p;
    const k = p.x + ',' + p.y;
    if (enemyWire(c, group.side) && !cut.has(k)) {
      wire++;
      cut.add(k);
      if (i < path.length - 1) endRound(i + 1);
      continue;
    }
    if (storming && c?.trench && c.trench.side !== ms) {
      if (breach < 0) breach = i;
      if (i < path.length - 1) endRound(i + 1);
    }
  }
  return { reach: reach < 0 ? path.length : reach, rounds, wire, breach };
}

function checkPath(order, group, state, env) {
  const path = order.path;
  const map = env.map;
  const home = map ? cellAt(map, group.pos.x, group.pos.y) : null;
  if ((order.type === 'assault' || order.type === 'attack')) {
    if (!ASSAULT_TYPES.has(group.type)) return `${unitType(group.type).name} stürmt nicht`;
    if (path.length > MAX_ASSAULT_CELLS) return `Sturmweg zu lang (höchstens ${MAX_ASSAULT_CELLS} Felder)`;
  }
  let prev = group.pos;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (Math.max(Math.abs(p.x - prev.x), Math.abs(p.y - prev.y)) !== 1) return `Weg springt bei Feld ${cellLabel(p.x, p.y)}`;
    if (map) {
      const c = cellAt(map, p.x, p.y);
      if (!Number.isFinite(enterCost(c))) return `Feld ${cellLabel(p.x, p.y)} ist nicht begehbar`;
      if (order.type === 'redeploy' && !redeployCellOk(c, group.side, home)) {
        return `Verlegen geht nur hinter der eigenen Linie (Feld ${cellLabel(p.x, p.y)})`;
      }
    }
    prev = p;
  }
  return null;
}

registerOrderValidator('move', checkPath);
registerOrderValidator('redeploy', checkPath);
registerOrderValidator('assault', checkPath);
registerOrderValidator('attack', checkPath);

/** Befehlsart, die in dieser Rundenart Bewegung ausloest */
function movesNow(type, kind) {
  return kind === 'battle' ? type === 'move' || type === 'assault' : type === 'redeploy';
}

function runMove(ctx) {
  const map = ctx.map;
  const state = ctx.state;
  const groups = ctx.groups();
  const occupied = new Map(groups.map((g) => [g.pos.x + ',' + g.pos.y, g.id]));
  const sideOf = new Map(groups.map((g) => [g.id, g.side]));
  for (const g of groups) delete g.engage;
  // Alle Gruppen gehen gleichzeitig Feld fuer Feld (je Durchgang ein Schritt, nach ID). Wer hinter einer
  // abziehenden Gruppe steht, kommt im naechsten Durchgang nach; Kolonnen stauen sich also nicht nach ID.
  const all = groups
    .map((g) => ({ g, o: ctx.orderFor(g.id) }))
    .filter(({ o }) => o && movesNow(o.type, ctx.kind) && o.path?.length);
  // Im Unterstand: erst heraus (dugout.js), der Befehl laeuft weiter
  for (const { g, o } of all.filter(({ g }) => g.inDugout)) {
    ctx.emit(o.type, {
      side: g.side, group: g.id, secret: true, from: { ...g.pos }, to: { ...g.pos }, steps: 0,
      rest: o.path.map((p) => ({ x: p.x, y: p.y })), blocked: true, dugout: true,
      carry: { group: g.id, type: o.type, path: o.path.map((p) => ({ x: p.x, y: p.y })) },
      reason: `Gruppe ${surname(g.leader.name)} ist noch im Unterstand und steigt erst die Stufen hinauf.`,
      at: { ...g.pos },
    });
  }
  const movers = all
    .filter(({ g }) => !g.inDugout)
    .map(({ g, o }) => ({
      g, o, budget: moveBudget(g, ctx.kind), steps: 0, from: { ...g.pos }, done: false, blockedBy: null,
      wire: null, cut: null, breach: null, foe: null,
    }));
  let progress = true;
  while (progress) {
    progress = false;
    for (const m of movers) {
      if (m.done) continue;
      if (m.steps >= m.o.path.length) { m.done = true; continue; }
      const p = m.o.path[m.steps];
      const cost = stepCost(map, m.g.pos, p, state);
      if (!Number.isFinite(cost) || (m.steps > 0 && cost > m.budget)) { m.done = true; m.blockedBy = null; continue; }
      const who = occupied.get(p.x + ',' + p.y);
      if (who && who !== m.g.id) {
        m.blockedBy = { at: p, group: who };
        // Begegnung mit dem Feind: Nahkampf (melee.js). Eigene Gruppen warten nur.
        if (sideOf.get(who) !== m.g.side) {
          m.foe = who;
          m.done = true;
        }
        continue;
      }
      occupied.delete(m.g.pos.x + ',' + m.g.pos.y);
      m.g.pos = { x: p.x, y: p.y };
      occupied.set(p.x + ',' + p.y, m.g.id);
      m.budget -= cost;
      m.steps++;
      m.blockedBy = null;
      progress = true;
      const c = map ? liveCell(map, state, p.x, p.y) : null;
      if (ctx.kind === 'battle' && enemyWire(c, m.g.side)) {
        // Im feindlichen Draht: haengt fest; Pioniere schneiden eine Gasse
        if (WIRE_CUTTERS.has(m.g.type)) {
          state.cells[p.x + ',' + p.y] = { ...(state.cells[p.x + ',' + p.y] ?? {}), wire: null, wireCut: ctx.turn };
          m.cut = { ...p };
        } else {
          m.wire = { ...p };
        }
        m.done = true;
        continue;
      }
      if (m.o.type === 'assault' && c?.trench && c.trench.side !== mapSideOf(m.g.side) && map) {
        if (captureTrench(state, map, p.x, p.y, m.g.side)) m.breach = { ...p };
        m.done = true;
      }
    }
  }
  for (const m of movers) {
    const { g, o, steps, from, blockedBy } = m;
    const type = o.type;
    const rest = o.path.slice(steps).map((p) => ({ x: p.x, y: p.y }));
    const name = 'Gruppe ' + surname(g.leader.name);
    const verb = type === 'assault' ? 'stürmt' : type === 'move' ? 'rückt' : 'verlegt';
    const n = `${steps} ${steps === 1 ? 'Feld' : 'Felder'}`;
    const dest = o.path[o.path.length - 1];
    let reason;
    if (m.foe) {
      g.engage = { target: m.foe, at: { ...blockedBy.at }, idx: steps };
      reason = steps
        ? `${name} ${verb} ${n} bis ${cellLabel(g.pos.x, g.pos.y)} und trifft bei ${cellLabel(blockedBy.at.x, blockedBy.at.y)} auf den Feind.`
        : `${name} trifft gleich bei ${cellLabel(blockedBy.at.x, blockedBy.at.y)} auf den Feind.`;
    } else if (m.cut) reason = `${name} ${verb} ${n} und schneidet bei ${cellLabel(m.cut.x, m.cut.y)} eine Gasse in den Draht.`;
    else if (m.wire) reason = `${name} ${verb} ${n} und hängt bei ${cellLabel(m.wire.x, m.wire.y)} im Draht fest.`;
    else if (m.breach) reason = `${name} ${verb} ${n} und bricht bei ${cellLabel(m.breach.x, m.breach.y)} in den feindlichen Graben ein.`;
    else if (blockedBy && steps === 0) reason = `${name} kommt nicht los: Feld ${cellLabel(blockedBy.at.x, blockedBy.at.y)} ist besetzt.`;
    else if (blockedBy) reason = `${name} ${verb} ${n} bis ${cellLabel(g.pos.x, g.pos.y)} und bleibt stehen: Feld ${cellLabel(blockedBy.at.x, blockedBy.at.y)} ist besetzt.`;
    else if (steps === 0) reason = `${name} kommt nicht los: Feld ${cellLabel(rest[0].x, rest[0].y)} ist nicht begehbar.`;
    else if (rest.length) reason = `${name} ${verb} ${n} bis ${cellLabel(g.pos.x, g.pos.y)}, bis ${cellLabel(dest.x, dest.y)} fehlen noch ${rest.length}.`;
    else reason = `${name} ${verb} ${n} und erreicht ${cellLabel(g.pos.x, g.pos.y)}.`;
    const ev = {
      side: g.side, group: g.id, secret: true, from, to: { ...g.pos }, steps, rest, blocked: blockedBy != null,
      reason, at: { ...g.pos },
    };
    if (m.wire) ev.wire = m.wire;
    // Sturm traegt sich selbst weiter (ausser bei Feindberuehrung: das entscheidet der Nahkampf)
    if (type === 'assault' && rest.length && !m.foe) ev.carry = { group: g.id, type, path: rest };
    ctx.emit(type, ev);
    if (m.cut) {
      ctx.emit('wire_cut', {
        side: g.side, group: g.id, public: true, cell: m.cut,
        reason: `Drahtschere: ${name} öffnet eine Gasse bei ${cellLabel(m.cut.x, m.cut.y)}. Wer folgt, kommt durch.`,
        at: { ...m.cut },
      });
    }
    if (m.breach) {
      ctx.emit('breach', {
        side: g.side, group: g.id, public: true, cell: m.breach,
        reason: `Einbruch bei ${cellLabel(m.breach.x, m.breach.y)}: ${name} ist im Graben. Er gibt nur halbe Deckung, bis er umgebaut ist.`,
        at: { ...m.breach },
      });
    }
  }
}

registerPhase({
  id: 'move',
  kind: 'both',
  order: { position: ORDER.position.movement, battle: ORDER.battle.movement },
  run: runMove,
});
