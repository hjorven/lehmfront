// Stosstrupp bei Nacht (Plan 4.2 Nr. 15 und 19, 8.2 "Nachtangriff mit Stosstrupp, Gefangene einbringen"; P23).
// Rein: kein DOM, kein Date, kein Math.random.
//
// Befehl { group, type: 'raid', target: {x,y} } in einer Stellungsrunde bei Nacht, nur Stosstrupps.
// Der Trupp kriecht in derselben Nacht hin und zurueck:
//   1. Weg durchs Niemandsland (Drahtscheren: feindlicher Draht kostet Zeit, haelt aber nicht auf).
//   2. Posten in Hoerweite des Weges wuerfeln, ob sie ihn bemerken. Leuchtkugeln dieser Runde verraten jede
//      Bewegung im Kreis, Horchposten und wachsame Gruppen hoeren mehr, Nebel und Regen verschlucken Geraeusche.
//      Entdeckt: Feuer auf den Trupp, oft bricht er ab.
//   3. Am Ziel: liegt dort jemand, kommt es zum kurzen Kampf im Graben. Unentdeckt ist der Trupp stark
//      (Ueberraschung), entdeckt schwach. Sieg: Gefangene (Ereignis prisoners), Befragung deckt Gruppen im
//      Umkreis auf (erweiterte Aufklaerung). Niederlage: Verluste, manchmal geraet einer in Gefangenschaft.
//      Leerer Graben: Papiere und Spuren decken die Gruppen im Umkreis auf.
//   4. Der Trupp ist vor der Daemmerung zurueck auf seinem Ausgangsfeld.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance, enterCost, findPath } from '../map.js';
import { otherSide } from '../state.js';
import { unitType } from '../config/units.js';
import { RAID } from '../config/akt2.js';
import { hasReport } from '../config/reports.js';
import { mapSideOf } from '../trench.js';
import { flareAt } from '../weather.js';
import { live } from '../underground.js';
import { inflictLosses, groupLabel, roll } from '../harm.js';
import { factorFor, bonusFor } from '../modifiers.js';

/** Warum geht dieser Stosstrupp nicht? null = geht */
export function raidProblem(map, state, group, target) {
  if (!RAID.raiders.includes(group.type)) return `${unitType(group.type).name} gehen nicht auf Stoßtrupp`;
  if (!target) return 'kein Ziel';
  if (group.inDugout) return 'Gruppe sitzt im Unterstand';
  const d = distance(group.pos, target);
  if (d > RAID.reach) return `zu weit (${d} von ${RAID.reach} Feldern)`;
  if (d < 2) return 'Ziel zu nah';
  if (!map) return null;
  const c = live(map, state, target.x, target.y);
  if (!c || !Number.isFinite(enterCost(c))) return 'dort kommt niemand hin';
  if (c.zone !== 'niemandsland' && c.side === mapSideOf(group.side)) return 'eigene Stellung';
  if (!raidPath(map, state, group, target)) return 'kein Weg dorthin';
  return null;
}

/** Weg des Trupps (ohne Startfeld) oder null. Feindlicher Draht wird geschnitten und kostet nur Zeit. */
export function raidPath(map, state, group, target) {
  const cost = (c) => {
    const lc = live(map, state, c.x, c.y);
    if (!lc) return Infinity;
    let v = enterCost({ ...lc, wire: null });
    if (lc.wire && lc.wire.side !== mapSideOf(group.side)) v += 12;
    return v;
  };
  const r = findPath(map, group.pos, target, { cost, maxNodes: 20000 });
  return r ? r.path.slice(1) : null;
}

registerOrderValidator('raid', (order, group, state, env) => raidProblem(env.map ?? null, state, group, order.target));

/** Wahrscheinlichkeit (Prozent), dass Posten w den Trupp auf dem Weg bemerkt. 0 = ausser Hoerweite. */
export function spotChance(state, map, watcher, raider, path) {
  if (watcher.inDugout || watcher.status === 'lost') return 0;
  const radius = RAID.spotRadius + (watcher.type === 'listeners' ? 2 : 0);
  let best = 0;
  for (const p of path) {
    const d = distance(watcher.pos, p);
    const lit = !!flareAt(state, p);
    if (d > radius && !(lit && d <= 8)) continue;
    let c = RAID.spot + (lit ? RAID.flare : 0);
    if (watcher.type === 'listeners') c += RAID.listeners;
    if (state.weather?.kind === 'fog') c += RAID.fog;
    if (state.weather?.kind === 'rain' || state.weather?.kind === 'storm') c += RAID.rain;
    c += bonusFor('spot', { state, map, group: watcher, role: 'watcher' });
    c += bonusFor('spot', { state, map, group: raider, role: 'raider' });
    if (!state.night) c += 40;
    if (c > best) best = c;
  }
  return best ? Math.max(3, Math.min(90, best)) : 0;
}

function reveal(state, side, near, radius, source, turn) {
  const s = state.sides[side];
  if (!s.intel) s.intel = { lastSeen: {} };
  if (!s.intel.lastSeen) s.intel.lastSeen = {};
  const found = [];
  for (const g of state.groups.filter((v) => v.side !== side && v.status !== 'lost' && distance(v.pos, near) <= radius).sort((p, q) => (p.id < q.id ? -1 : 1))) {
    s.intel.lastSeen[g.id] = { pos: { ...g.pos }, turn, type: g.type, source };
    found.push(g.id);
  }
  return found;
}

function runRaid(ctx) {
  const { state, map } = ctx;
  if (!map) return;
  for (const o of ctx.ordersOfType('raid')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const foe = otherSide(g.side);
    const home = { ...g.pos };
    const target = o.target;
    const path = raidPath(map, state, g, target);
    const name = groupLabel(g);
    if (!path) {
      ctx.emit('raid', { side: g.side, group: g.id, secret: true, outcome: 'no_path', reason: `${name} findet keinen Weg nach ${cellLabel(target.x, target.y)} und bleibt im Graben.`, at: home });
      continue;
    }
    g.fatigue = Math.min(100, (g.fatigue ?? 0) + RAID.fatigue);
    // 2. Entdeckung
    let spotter = null;
    for (const w of ctx.groups(foe)) {
      const p = spotChance(state, map, w, g, path);
      if (!p) continue;
      if (Math.floor(ctx.rng() * 100) < p) { spotter = w; break; }
    }
    if (spotter) {
      spotter.deeds = { ...(spotter.deeds ?? {}), wachsam: (spotter.deeds?.wachsam ?? 0) + 1 };
      const where = path.find((p) => distance(p, spotter.pos) <= RAID.spotRadius + 2) ?? path[Math.floor(path.length / 2)];
      const lit = !!flareAt(state, where);
      ctx.emit('raid_spotted', {
        side: foe, group: spotter.id, secret: true, raider: g.id,
        reason: lit
          ? `Im Licht der Leuchtkugel stehen bei ${cellLabel(where.x, where.y)} Gestalten im Draht. ${groupLabel(spotter)} schießt.`
          : `${groupLabel(spotter)} hört bei ${cellLabel(where.x, where.y)} Draht klirren und schießt in die Dunkelheit.`,
        at: { ...where },
      });
      const n = roll(ctx.rng, RAID.spottedLoss[0], RAID.spottedLoss[1]);
      if (n) inflictLosses(ctx, g, n, `${name} wird bei ${cellLabel(where.x, where.y)} entdeckt und beschossen: ${n} ${n === 1 ? 'Verlust' : 'Verluste'}.`, { cause: 'raid' });
      if (g.status === 'lost') continue;
      if (Math.floor(ctx.rng() * 100) < RAID.abortPct) {
        g.pos = home;
        ctx.emit('raid', { side: g.side, group: g.id, secret: true, outcome: 'aborted', reason: `${name} ist entdeckt und kriecht zurück, bevor drüben alle wach sind.`, at: { ...where } });
        continue;
      }
    }
    // 3. Am Ziel
    const defenders = ctx.groups(foe).filter((d) => distance(d.pos, target) <= 1)
      .sort((p, q) => distance(p.pos, target) - distance(q.pos, target) || (p.id < q.id ? -1 : 1));
    const night = !!state.night;
    if (!defenders.length) {
      const found = reveal(state, g.side, target, RAID.intelRadius, 'Stoßtrupp', ctx.turn + 1);
      ctx.emit('raid', {
        side: g.side, group: g.id, secret: true, outcome: 'empty', revealed: found,
        reason: `${name} findet bei ${cellLabel(target.x, target.y)} niemanden. ${found.length ? `Spuren, Feldpost und ein Kochgeschirr verraten ${found.length} ${found.length === 1 ? 'Gruppe' : 'Gruppen'} in der Nähe.` : 'Nur Wasser und leere Patronenhülsen.'} Vor der Dämmerung ist der Trupp zurück.`,
        at: { ...target },
      });
      g.pos = home;
      continue;
    }
    const def = defenders[0];
    const own = live(map, state, def.pos.x, def.pos.y)?.trench?.side === mapSideOf(def.side);
    const A = g.strength * (1 + 0.15 * (g.experience ?? 0)) * factorFor('raid', { state, map, group: g, night }) * factorFor('melee', { state, map, group: g, night, defending: false })
      * (spotter ? RAID.alerted : RAID.surprise);
    const D = def.strength * (1 + 0.15 * (def.experience ?? 0)) * factorFor('melee', { state, map, group: def, night, defending: true })
      * (own ? RAID.trench : 1) * (def.inDugout ? 0.6 : 1) * (1 - 0.5 * (def.suppressed ?? 0))
      + defenders.slice(1).reduce((s, n) => s + n.strength * RAID.support * (n.inDugout ? 0.5 : 1), 0); // Posten verdoppeln hilft
    const p = Math.max(0.1, Math.min(0.9, A / Math.max(0.01, A + D)));
    const won = ctx.rng() < p;
    if (won) {
      const taken = Math.min(def.strength, roll(ctx.rng, 1, 2));
      def.strength -= taken;
      def.morale = Math.max(0, (def.morale ?? 70) - 15);
      def.deeds = { ...(def.deeds ?? {}) };
      ctx.emit('men_captured', {
        side: foe, group: def.id, secret: true, count: taken,
        reason: `Bei ${cellLabel(def.pos.x, def.pos.y)} fehlen am Morgen ${taken} ${taken === 1 ? 'Mann' : 'Mann'} aus ${groupLabel(def)}. Vermisst.`,
        at: { ...def.pos },
      });
      if (def.strength <= 0) {
        def.strength = 0;
        def.status = 'lost';
        ctx.emit('group_lost', { side: foe, group: def.id, public: true, reason: `${groupLabel(def)} gibt es nicht mehr: der Posten ist leer.`, at: { ...def.pos } });
      }
      const kills = Math.min(def.strength, roll(ctx.rng, 0, 1));
      if (kills) inflictLosses(ctx, def, kills, `${groupLabel(def)} verliert im Handgemenge ${kills} ${kills === 1 ? 'Mann' : 'Mann'}.`, { cause: 'raid' });
      const lost = roll(ctx.rng, 0, 1);
      if (lost) inflictLosses(ctx, g, lost, `${name}: ${lost} Verwundeter auf dem Rückweg.`, { cause: 'raid' });
      const radius = RAID.interrogateRadius;
      const found = reveal(state, g.side, target, radius, 'Gefangenenbefragung', ctx.turn + 1);
      let batteries = 0;
      if (hasReport(state, g.side, 'gefangenenbefragung') && state.sides[foe].artillery && state.sides[g.side].artillery) {
        for (const b of [...(state.sides[foe].artillery.batteries ?? [])].sort((p2, q2) => (p2.id < q2.id ? -1 : 1))) {
          const known = state.sides[g.side].artillery.known ?? (state.sides[g.side].artillery.known = {});
          if (known[b.id]) continue;
          known[b.id] = { pos: { ...b.pos }, w: b.w, h: b.h, type: b.type, turn: ctx.turn, label: b.label };
          batteries++;
        }
      }
      if (night) g.deeds = { ...(g.deeds ?? {}), nacht: (g.deeds?.nacht ?? 0) + 1 };
      ctx.emit('prisoners', {
        side: g.side, group: g.id, secret: true, count: taken, revealed: found, batteries,
        reason: `${name} bringt ${taken} ${taken === 1 ? 'Gefangenen' : 'Gefangene'} aus ${cellLabel(target.x, target.y)} zurück. Die Befragung verrät ${found.length} ${found.length === 1 ? 'Gruppe' : 'Gruppen'}${batteries ? ` und ${batteries} ${batteries === 1 ? 'Batterie' : 'Batterien'}` : ''}.`,
        at: { ...target },
      });
      ctx.emit('raid', { side: g.side, group: g.id, secret: true, outcome: 'success', count: taken, reason: `${name} ist vor der Dämmerung zurück.`, at: home, minor: true });
    } else {
      const n = roll(ctx.rng, RAID.repelledLoss[0], RAID.repelledLoss[1]);
      inflictLosses(ctx, g, n, `${name} bleibt im Graben bei ${cellLabel(target.x, target.y)} hängen: ${n} ${n === 1 ? 'Verlust' : 'Verluste'}.`, { cause: 'raid' });
      def.deeds = { ...(def.deeds ?? {}), wachsam: (def.deeds?.wachsam ?? 0) + 1 };
      if (night) def.deeds.nacht = (def.deeds.nacht ?? 0) + 1;
      if (g.status !== 'lost' && g.strength > 1 && ctx.rng() < 0.35) {
        g.strength -= 1;
        ctx.emit('men_captured', { side: g.side, group: g.id, secret: true, count: 1, reason: `Von ${name} kommt einer nicht zurück. Vermisst bei ${cellLabel(target.x, target.y)}.`, at: { ...target } });
        ctx.emit('prisoners', { side: foe, group: def.id, secret: true, count: 1, reason: `${groupLabel(def)} wirft einen Stoßtrupp zurück und hält einen Mann fest.`, at: { ...def.pos } });
      }
      ctx.emit('raid_repelled', {
        side: foe, group: def.id, secret: true, raider: g.id,
        reason: `${groupLabel(def)} wehrt bei ${cellLabel(def.pos.x, def.pos.y)} einen Stoßtrupp ab.`,
        at: { ...def.pos },
      });
      ctx.emit('raid', { side: g.side, group: g.id, secret: true, outcome: 'repelled', reason: `${name} kommt ohne Gefangene zurück.`, at: home, minor: true });
    }
    if (g.status !== 'lost') g.pos = home;
  }
}

registerPhase({ id: 'raid', kind: 'position', order: ORDER.position.movement + 5, run: runRaid });
