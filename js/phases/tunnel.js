// Stollen und Horchposten (Plan 4.2 Nr. 14, Paket P23). Rein: kein DOM, kein Date, kein Math.random.
// Stellungsrunde, Schritt 5 "tunnels" (Plan 10.6). Ablauf je Runde:
//   1. Neue Stollen aus Befehlen anlegen ({ group, type: 'tunnel', path }).
//   2. Geladene Stollen der Vorrunde zuenden: Trichter, Verluste im Umkreis, feindliche Stollen nahe der Ladung
//      werden verschuettet (Gegenstollen). Liegt kein feindlicher Graben im Umkreis, ist es nur eine Quetschmine
//      unter der Weide (kleiner Trichter, keine Verluste an der Oberflaeche).
//   3. Nasse Stollen: eine Stuetze kann nachgeben (Feld verloren, ein Mineur).
//   4. Vortrieb: Arbeitsbudget wie beim Graben, je Feld 100 (Kreide 70). Die Mineure muessen am Eingang bleiben
//      (Befehl Stollen oder Halten). Am Ziel wird geladen; gezuendet wird in der naechsten Stellungsrunde, der
//      Gegner hat also noch eine Nacht zum Horchen.
//   5. Horchen: Horchposten (Radius 6, Bericht Horchgeraet 8) und Gruppen im eigenen Graben (Radius 2) hoeren
//      feindliche Stollen mit einem Wurf je Runde. Gehoerte Stollen stehen als unsichere Linie auf der Karte.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance } from '../map.js';
import { SIDES, otherSide, getGroup } from '../state.js';
import { TUNNEL } from '../config/akt2.js';
import { mapSideOf } from '../trench.js';
import { checkTunnel, live, tunnelCellWork, tunnelRate, dugCells, tunnelHead, listenChance } from '../underground.js';
import { inflictLosses, groupLabel, roll } from '../harm.js';
import { bonusFor } from '../modifiers.js';

registerOrderValidator('tunnel', (order, group, state, env) => checkTunnel(env.map ?? null, state, group, order.path));

const WORKING = new Set(['tunnel', 'hold']);

function sideOf(state, side) {
  const s = state.sides[side];
  if (!s.tunnels) s.tunnels = [];
  if (!s.heard) s.heard = {};
  return s;
}

/** Arbeitet die Mannschaft in dieser Runde? */
function crewWorks(ctx, t) {
  const g = ctx.group(t.group);
  if (!g || g.status === 'lost') return null;
  if (distance(g.pos, t.path[0]) > TUNNEL.reach) return null;
  const o = ctx.orderFor(g.id);
  return !o || WORKING.has(o.type) ? g : null;
}

function blow(ctx, side, t) {
  const { state, map } = ctx;
  const foe = otherSide(side);
  const c = t.path[t.path.length - 1];
  const r = TUNNEL.blastRadius;
  const foeTrench = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const cell = live(map, state, c.x + dx, c.y + dy);
    if (cell?.trench && cell.trench.side === mapSideOf(foe)) foeTrench.push({ x: c.x + dx, y: c.y + dy });
  }
  const camouflet = !foeTrench.length && !state.groups.some((g) => g.side === foe && g.status !== 'lost' && distance(g.pos, c) <= r);
  t.status = 'blown';
  t.blownTurn = ctx.turn;
  const crater = [];
  if (camouflet) {
    const k = c.x + ',' + c.y;
    state.cells[k] = { ...(state.cells[k] ?? {}), crater: Math.max(1, state.cells[k]?.crater ?? 0), mud: 1, fresh: ctx.turn };
    crater.push({ x: c.x, y: c.y });
  } else {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = c.x + dx, y = c.y + dy;
      const cell = live(map, state, x, y);
      if (!cell || cell.terrain === 'wasser') continue;
      const k = x + ',' + y;
      const center = !dx && !dy;
      const patch = { crater: center ? 2 : Math.max(1, cell.crater ?? 0), mud: center ? 2 : 1, fresh: ctx.turn, trichter: t.id, shelled: (state.cells[k]?.shelled ?? 0) + 1 };
      if (cell.trench) patch.trench = null;
      if (cell.wire) patch.wire = null;
      state.cells[k] = { ...(state.cells[k] ?? {}), ...patch };
      crater.push({ x, y });
    }
  }
  ctx.emit('mine_blown', {
    tunnel: t.id, by: side, camouflet, cells: crater, trench: foeTrench.length,
    reason: camouflet
      ? `Unter ${cellLabel(c.x, c.y)} ein dumpfer Schlag, die Weide zittert. Eine Quetschladung, tief unter der Oberfläche.`
      : `Bei ${cellLabel(c.x, c.y)} hebt sich der Boden. Eine Mine: Lehm, Kreide und Balken fliegen, wo eben noch ${foeTrench.length ? 'ein Graben' : 'Erde'} war. Es bleibt ein Trichter.`,
    at: { x: c.x, y: c.y },
  });
  if (!camouflet) {
    for (const g of state.groups.filter((v) => v.status !== 'lost' && distance(v.pos, c) <= r).sort((p, q) => (p.id < q.id ? -1 : 1))) {
      const center = g.pos.x === c.x && g.pos.y === c.y;
      const pct = center ? TUNNEL.centerLossPct : TUNNEL.ringLossPct;
      const n = Math.max(1, Math.floor((g.strength * pct + 50) / 100));
      g.suppressed = 1;
      g.underFire = true;
      g.inDugout = false;
      delete g.dugout;
      g.morale = Math.max(0, (g.morale ?? 70) - 25);
      inflictLosses(ctx, g, n, `${groupLabel(g)} liegt über der Mine bei ${cellLabel(c.x, c.y)}: ${n} ${n === 1 ? 'Mann' : 'Mann'} verschüttet oder verletzt.`, { cause: 'mine', public: true });
    }
  }
  // Gegenstollen: feindliche Stollen nahe der Ladung stuerzen ein
  for (const ft of sideOf(state, foe).tunnels) {
    if (ft.status !== 'digging' && ft.status !== 'charged') continue;
    if (!dugCells(ft).some((p) => distance(p, c) <= TUNNEL.camoufletRadius)) continue;
    ft.status = 'collapsed';
    ft.collapsedTurn = ctx.turn;
    const crew = getGroup(state, ft.group);
    const head = tunnelHead(ft) ?? ft.path[0];
    ctx.emit('tunnel_collapsed', {
      side: foe, secret: true, tunnel: ft.id, cause: 'countermine',
      reason: `Unser Stollen bei ${cellLabel(head.x, head.y)} ist eingestürzt: Der Gegner hat direkt daneben gezündet.`,
      at: { ...head },
    });
    if (crew && crew.status !== 'lost') {
      const n = roll(ctx.rng, TUNNEL.crewLoss[0], TUNNEL.crewLoss[1]);
      inflictLosses(ctx, crew, n, `${groupLabel(crew)}: ${n} Mineure im Stollen verschüttet.`, { cause: 'mine' });
    }
    const h = sideOf(state, side).heard[ft.id];
    if (h) h.gone = ctx.turn;
    ctx.emit('tunnel_destroyed', {
      side, secret: true, tunnel: ft.id,
      reason: `Die Ladung hat den feindlichen Stollen bei ${cellLabel(head.x, head.y)} erwischt. Drüben gräbt dort niemand mehr.`,
      at: { ...head },
    });
  }
}

function runTunnels(ctx) {
  const { state, map } = ctx;
  if (!map) return;
  // 1. Neue Stollen
  for (const o of ctx.ordersOfType('tunnel')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const s = sideOf(state, g.side);
    const id = g.side + 't' + (s.tunnels.length + 1);
    s.tunnels.push({ id, group: g.id, path: o.path.map((p) => ({ x: p.x, y: p.y })), dug: 0, work: 0, status: 'digging', turn: ctx.turn });
    ctx.emit('tunnel_begun', {
      side: g.side, group: g.id, secret: true, tunnel: id,
      reason: `${groupLabel(g)} beginnt bei ${cellLabel(o.path[0].x, o.path[0].y)} einen Stollen, ${o.path.length} Felder bis zur Ladung bei ${cellLabel(o.path[o.path.length - 1].x, o.path[o.path.length - 1].y)}.`,
      at: { ...o.path[0] },
    });
  }
  // 2. Zuenden
  for (const side of SIDES) {
    for (const t of sideOf(state, side).tunnels) {
      if (t.status === 'charged' && t.chargedTurn < ctx.turn) blow(ctx, side, t);
    }
  }
  // 3. und 4. Einsturz und Vortrieb
  for (const side of SIDES) {
    const wet = state.weather?.wet ?? 0;
    for (const t of sideOf(state, side).tunnels) {
      if (t.status !== 'digging') continue;
      const g = crewWorks(ctx, t);
      if (!g) {
        const crew = ctx.group(t.group);
        if (!crew || crew.status === 'lost') continue;
        ctx.emit('tunnel_idle', { side, group: crew.id, secret: true, minor: true, tunnel: t.id, reason: `${groupLabel(crew)} ist nicht am Stolleneingang, der Stollen ruht.`, at: { ...t.path[0] } });
        continue;
      }
      if (t.dug > 1 && wet >= TUNNEL.collapseWet && ctx.rng() * 100 < TUNNEL.collapsePct) {
        const lost = t.path[t.dug - 1];
        t.dug -= 1;
        t.work = 0;
        inflictLosses(ctx, g, 1, `Im Stollen bei ${cellLabel(lost.x, lost.y)} gibt eine Stütze nach. Der nasse Lehm drückt nach, ein Mann kommt nicht mehr heraus.`, { cause: 'tunnel' });
        ctx.emit('tunnel_cavein', { side, group: g.id, secret: true, tunnel: t.id, reason: `Der Stollen verliert ein Feld bei ${cellLabel(lost.x, lost.y)}. Die Mineure stützen neu ab.`, at: { ...lost } });
        continue;
      }
      let budget = tunnelRate(g);
      const from = t.dug;
      while (budget > 0 && t.dug < t.path.length) {
        const p = t.path[t.dug];
        const need = tunnelCellWork(live(map, state, p.x, p.y)) - t.work;
        if (need > budget) { t.work += budget; budget = 0; break; }
        budget -= need;
        t.work = 0;
        t.dug += 1;
      }
      g.fatigue = Math.min(100, (g.fatigue ?? 0) + 3);
      const gained = t.dug - from;
      const head = tunnelHead(t) ?? t.path[0];
      if (t.dug >= t.path.length) {
        t.status = 'charged';
        t.chargedTurn = ctx.turn;
        ctx.emit('tunnel_charged', {
          side, group: g.id, secret: true, tunnel: t.id, cells: gained,
          reason: `${groupLabel(g)} ist am Ziel ${cellLabel(head.x, head.y)}. Die Ladung liegt. Gezündet wird in der nächsten Stellungsrunde.`,
          at: { ...head },
        });
      } else {
        ctx.emit('tunnel', {
          side, group: g.id, secret: true, tunnel: t.id, cells: gained,
          reason: gained
            ? `${groupLabel(g)} treibt den Stollen ${gained} ${gained === 1 ? 'Feld' : 'Felder'} vor, bis unter ${cellLabel(head.x, head.y)}. Noch ${t.path.length - t.dug} bis zur Ladung.`
            : `${groupLabel(g)} kommt im Stollen kaum voran, das Feld vor ${cellLabel(head.x, head.y)} ist noch nicht durch.`,
          at: { ...head },
        });
      }
    }
  }
  // 5. Horchen
  for (const side of SIDES) {
    const foe = otherSide(side);
    const s = sideOf(state, side);
    const ears = ctx.groups(side).filter((g) => g.type === 'listeners' || ownTrenchAt(map, state, g, side));
    for (const t of sideOf(state, foe).tunnels) {
      if (t.status !== 'digging' && t.status !== 'charged') continue;
      if (!t.dug) continue;
      let best = null;
      for (const g of ears) {
        const p = listenChance(map, state, g, t, { digging: t.status === 'digging', bonus: bonusFor('listen', { state, group: g }) });
        if (p > 0 && (!best || p > best.p || (p === best.p && g.id < best.g.id))) best = { g, p };
      }
      if (!best) continue;
      const r = Math.floor(ctx.rng() * 100);
      if (r >= best.p) continue;
      const cells = dugCells(t).map((p) => ({ x: p.x, y: p.y }));
      const head = cells[cells.length - 1];
      const first = !s.heard[t.id];
      s.heard[t.id] = { cells, turn: ctx.turn, count: (s.heard[t.id]?.count ?? 0) + 1, charged: t.status === 'charged' };
      best.g.deeds = { ...(best.g.deeds ?? {}), wachsam: (best.g.deeds?.wachsam ?? 0) + 1 };
      const listener = best.g.type === 'listeners';
      const chalk = map && live(map, state, head.x, head.y)?.terrain === 'kreide';
      ctx.emit('tunnel_detected', {
        side, group: best.g.id, secret: true, tunnel: t.id, first, chance: best.p, cells: cells.length, charged: t.status === 'charged',
        reason: t.status === 'charged'
          ? `${groupLabel(best.g)} meldet: Unter ${cellLabel(head.x, head.y)} ist es still geworden. Kein Klopfen mehr, nur Schritte. Drüben wird geladen.`
          : `${groupLabel(best.g)} ${listener ? 'hört im Horchposten' : 'hört durch die Grabensohle'} ein Klopfen unter ${cellLabel(head.x, head.y)}${chalk ? ', klar wie durch eine Tür' : ''}. ${first ? 'Der Gegner gräbt einen Stollen.' : 'Der Stollen ist näher gekommen.'}`,
        at: { ...head },
      });
    }
  }
}

function ownTrenchAt(map, state, g, side) {
  const c = live(map, state, g.pos.x, g.pos.y);
  return !!(c?.trench && c.trench.side === mapSideOf(side)) && !g.inDugout;
}

registerPhase({ id: 'tunnel', kind: 'position', order: ORDER.position.tunnels, run: runTunnels });
