// Nahkampf Feld fuer Feld (Plan 4.1 Nr. 9, 10.6 Gefechtsrunde Schritt 6). Rein: kein DOM, kein Date, kein Math.random.
//
// Eine Begegnung entsteht in der Bewegung (move.js): wer auf ein Feld mit einer feindlichen Gruppe will, bleibt
// davor stehen und merkt sich g.engage = { target, at, idx }. Hier wird je verteidigter Gruppe ausgetragen:
// - Kampfkraft = Staerke x Erfahrung x (1 - halbe Unterdrueckung). Sturm gibt dem Angreifer Schwung (x1,25).
// - Der Verteidiger im eigenen Graben x1,4, im eroberten (noch nicht umgebauten) nur x1,15: der Gegenstoss hat
//   eine Chance. Wer im Unterstand sitzt, wird ueberrascht (x0,35), wer gerade herauskommt, halb (x0,6).
// - Ein Wurf entscheidet: Angreifer gewinnt mit Anteil A / (A + V), begrenzt auf 5 bis 95 Prozent.
// - Verlierer verliert 2 und mehr Mann, Gewinner einige. Gewinnt der Angreifer, weicht der Verteidiger auf ein
//   freies Nachbarfeld (am liebsten den eigenen Graben entlang) aus; findet er keins oder sass er im Unterstand,
//   geraet der Rest in Gefangenschaft. Der erste Angreifer nimmt das Feld (Einbruch, captureTrench).
// - Verliert der Angreifer, bleibt er liegen, wird niedergehalten und versucht es mit dem Rest des Weges erneut.
// Jede Begegnung meldet 'melee' (oeffentlich, Begruendung mit den Gruenden) und 'losses' (fuer die Sanitaetskette).
import { registerPhase, ORDER } from './registry.js';
import { cellLabel, distance, enterCost } from '../map.js';
import { trenchAt } from '../sight.js';
import { captureTrench } from '../trench.js';
import { surname } from './hold.js';
import { liveCell, mapSideOf } from './move.js';

export const ASSAULT_DASH = 1.25;
export const TRENCH_HOLD = 1.4;
export const CAPTURED_HOLD = 1.15;
export const DUGOUT_SURPRISE = 0.35;
export const LEAVING_SURPRISE = 0.6;

const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;
const name = (g) => 'Gruppe ' + surname(g.leader.name);

/** Kampfkraft einer Gruppe im Nahkampf (ohne Lage) */
export function meleePower(g) {
  return g.strength * (1 + 0.15 * (g.experience ?? 0)) * (1 - 0.5 * (g.suppressed ?? 0));
}

/**
 * Lage des Verteidigers: { factor, why[] }. state/map fuer den Graben auf seinem Feld.
 */
export function defenseFactor(state, map, def) {
  let f = 1;
  const why = [];
  const t = trenchAt(state, map, def.pos.x, def.pos.y);
  if (t && t.side === mapSideOf(def.side)) {
    if (t.captured) { f *= CAPTURED_HOLD; why.push('eroberter Graben, noch nicht umgebaut'); }
    else { f *= TRENCH_HOLD; why.push('im eigenen Graben'); }
  }
  if (def.inDugout && def.dugout === 'leaving') { f *= LEAVING_SURPRISE; why.push('kam gerade aus dem Unterstand'); }
  else if (def.inDugout) { f *= DUGOUT_SURPRISE; why.push('im Unterstand überrascht'); }
  if ((def.suppressed ?? 0) >= 0.75) why.push('niedergehalten');
  return { factor: f, why };
}

/** Chance des Angreifers (0,05 bis 0,95). attackers: [{ g, assault }] */
export function meleeOdds(state, map, attackers, def) {
  const A = attackers.reduce((s, a) => s + meleePower(a.g) * (a.assault ? ASSAULT_DASH : 1), 0);
  const d = defenseFactor(state, map, def);
  const D = meleePower(def) * d.factor;
  const p = A + D > 0 ? A / (A + D) : 0.5;
  return { p: Math.max(0.05, Math.min(0.95, p)), A, D, why: d.why };
}

/** Freies Ausweichfeld fuer den Verlierer: eigener Graben vor offenem Feld, weg vom Angreifer, dann y, x */
function retreatCell(state, map, def, attackers, occupied) {
  const cands = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const x = def.pos.x + dx, y = def.pos.y + dy;
      if (occupied.has(x + ',' + y)) continue;
      const c = map ? liveCell(map, state, x, y) : (x >= 0 && y >= 0 && x < state.map.width && y < state.map.height ? {} : null);
      if (!c || (map && !Number.isFinite(enterCost(c)))) continue;
      const own = c.trench && c.trench.side === mapSideOf(def.side) ? 1 : 0;
      const away = Math.min(...attackers.map((a) => distance(a.g.pos, { x, y })));
      if (away < 1) continue;
      cands.push({ x, y, own, away });
    }
  }
  cands.sort((a, b) => b.own - a.own || b.away - a.away || a.y - b.y || a.x - b.x);
  return cands[0] ?? null;
}

function takeLosses(g, n) {
  const k = Math.min(g.strength, Math.max(0, n));
  g.strength -= k;
  return k;
}

function runMelee(ctx) {
  const state = ctx.state, map = ctx.map;
  const groups = ctx.groups();
  const byTarget = new Map();
  for (const g of groups) {
    if (!g.engage) continue;
    const t = ctx.group(g.engage.target);
    if (!t || t.status === 'lost' || distance(g.pos, t.pos) > 1) continue;
    if (!byTarget.has(t.id)) byTarget.set(t.id, []);
    byTarget.get(t.id).push(g);
  }
  const occupied = new Map(groups.map((g) => [g.pos.x + ',' + g.pos.y, g.id]));
  const carried = new Set();
  const fought = new Set(); // wer schon gekaempft hat, greift in dieser Runde nicht noch einmal an

  for (const tid of [...byTarget.keys()].sort()) {
    const def = ctx.group(tid);
    const atkGroups = byTarget.get(tid).filter((g) => g.status !== 'lost' && !fought.has(g.id) && distance(g.pos, def.pos) <= 1)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    if (!atkGroups.length || def.status === 'lost') continue;
    for (const g of [...atkGroups, def]) fought.add(g.id);
    const attackers = atkGroups.map((g) => ({ g, o: ctx.orderFor(g.id), assault: ctx.orderFor(g.id)?.type === 'assault' }));
    const odds = meleeOdds(state, map, attackers, def);
    const roll = ctx.rng();
    const won = roll < odds.p;
    const pw = won ? odds.p : 1 - odds.p;
    const at = { ...def.pos };
    const atkNames = atkGroups.map(name).join(' und ');
    const winnerLoss = Math.floor(ctx.rng() * (2 + 3 * (1 - pw)));
    const loserLoss = 2 + Math.floor(ctx.rng() * (2 + 4 * pw));
    const lossesOf = new Map();
    const note = (g, n) => { if (n > 0) lossesOf.set(g.id, (lossesOf.get(g.id) ?? 0) + n); };
    // Verluste der Angreifer der Reihe nach verteilen
    const spread = (n) => {
      for (let i = 0; n > 0 && atkGroups.some((g) => g.strength > 0); i++) {
        const g = atkGroups[i % atkGroups.length];
        if (g.strength <= 0) continue;
        note(g, takeLosses(g, 1));
        n--;
      }
    };
    let outcome;
    let captured = 0;
    let retreatTo = null;
    const wasDugout = def.inDugout && def.dugout !== 'leaving';
    if (won) {
      note(def, takeLosses(def, loserLoss));
      spread(winnerLoss);
      if (def.strength > 0) {
        retreatTo = wasDugout ? null : retreatCell(state, map, def, attackers, occupied);
        if (!retreatTo) { captured = def.strength; def.strength = 0; }
      }
      outcome = 'taken';
    } else {
      note(def, takeLosses(def, winnerLoss));
      spread(loserLoss);
      for (const g of atkGroups) g.suppressed = r2(Math.min(1, (g.suppressed ?? 0) + 0.3));
      outcome = 'repelled';
    }

    // Verteidiger raeumt das Feld
    if (won) {
      occupied.delete(def.pos.x + ',' + def.pos.y);
      if (retreatTo) {
        def.pos = { x: retreatTo.x, y: retreatTo.y };
        occupied.set(retreatTo.x + ',' + retreatTo.y, def.id);
        def.inDugout = false;
        delete def.dugout;
      }
    }
    const lead = won ? atkGroups.find((g) => g.strength > 0) : null;
    let breach = false;
    if (lead) {
      occupied.delete(lead.pos.x + ',' + lead.pos.y);
      lead.pos = { ...at };
      occupied.set(at.x + ',' + at.y, lead.id);
      lead.moved = true;
      if (map) breach = captureTrench(state, map, at.x, at.y, lead.side);
    }

    // Weiter mit dem Rest des Weges (gewonnen: ab dem genommenen Feld, verloren: erneut)
    for (const a of attackers) {
      const o = a.o;
      if (!o?.path?.length || a.g.strength <= 0) continue;
      const idx = a.g.engage?.idx ?? 0;
      const from = a.g === lead ? idx + 1 : idx;
      const rest = o.path.slice(from).map((p) => ({ x: p.x, y: p.y }));
      if (rest.length && o.type === 'assault') {
        ctx.emit('melee_push', {
          side: a.g.side, group: a.g.id, secret: true, minor: true, rest,
          carry: { group: a.g.id, type: 'assault', path: rest },
          reason: `${name(a.g)} soll weiter bis ${cellLabel(rest[rest.length - 1].x, rest[rest.length - 1].y)}, noch ${rest.length} ${rest.length === 1 ? 'Feld' : 'Felder'}.`,
          at: { ...a.g.pos },
        });
        carried.add(a.g.id);
      }
    }

    const why = [];
    if (attackers.some((a) => a.assault)) why.push('Sturm mit Schwung');
    why.push(...odds.why);
    const pct = Math.floor(odds.p * 100 + 0.5);
    const head = `Nahkampf bei ${cellLabel(at.x, at.y)}: ${atkNames} gegen ${name(def)}`;
    let tail;
    if (won && captured && wasDugout) tail = `Der Unterstand wird ausgehoben, ${captured} Mann geraten in Gefangenschaft.`;
    else if (won && captured) tail = `${name(def)} ist eingeschlossen, ${captured} Mann geraten in Gefangenschaft.`;
    else if (won) tail = `Das Feld fällt, ${name(def)} weicht nach ${cellLabel(retreatTo.x, retreatTo.y)} aus.`;
    else tail = 'Der Angriff wird abgewiesen, die Angreifer liegen vor dem Feld.';
    ctx.emit('melee', {
      side: atkGroups[0].side, group: atkGroups[0].id, target: def.id, public: true, outcome, chance: r2(odds.p),
      attackers: atkGroups.map((g) => g.id), captured: captured || undefined,
      reason: `${head} (${why.join(', ')}; Aussicht ${pct} Prozent). ${tail}`,
      at,
    });
    if (breach && lead) {
      ctx.emit('breach', {
        side: lead.side, group: lead.id, public: true, cell: at,
        reason: `Einbruch bei ${cellLabel(at.x, at.y)}: ${name(lead)} nimmt das Grabenstück im Nahkampf.`,
        at,
      });
    }
    // Verluste melden (Sanitaetskette, Moral), Gruppen ohne Leute fallen weg
    for (const g of [...atkGroups, def].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const n = lossesOf.get(g.id) ?? 0;
      if (n) {
        ctx.emit('losses', {
          side: g.side, group: g.id, amount: n, from: g === def ? atkGroups.map((x) => x.id) : [def.id], cause: 'melee',
          suppressed: g.suppressed,
          reason: `${name(g)}: ${n} ${n === 1 ? 'Verlust' : 'Verluste'} im Nahkampf bei ${cellLabel(at.x, at.y)}.`,
          at: { ...g.pos },
        });
      }
      if (g.strength <= 0 && g.status !== 'lost') {
        g.status = 'lost';
        g.strength = 0;
        g.inDugout = false;
        delete g.dugout;
        if (g === def && captured) {
          g.captured = captured;
          ctx.emit('group_captured', {
            side: g.side, group: g.id, public: true, count: captured,
            reason: `${name(g)} gerät in Gefangenschaft. ${g.leader.name} aus ${g.leader.home} ist bei ihnen.`,
            at,
          });
        } else {
          state.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos }, cause: 'melee' });
          ctx.emit('group_lost', {
            side: g.side, group: g.id, public: true,
            reason: `${name(g)} ist im Nahkampf aufgerieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
            at: { ...g.pos },
          });
        }
      }
    }
  }
  // Begegnung ohne Gegner (der Feind ist weg oder aufgerieben): Sturm laeuft weiter
  for (const g of groups) {
    if (g.engage && !carried.has(g.id) && g.status !== 'lost') {
      const o = ctx.orderFor(g.id);
      const rest = o?.path ? o.path.slice(g.engage.idx).map((p) => ({ x: p.x, y: p.y })) : [];
      if (rest.length && o.type === 'assault') {
        ctx.emit('melee_push', {
          side: g.side, group: g.id, secret: true, minor: true, rest, carry: { group: g.id, type: 'assault', path: rest },
          reason: `${name(g)} findet den Gegner nicht mehr vor und läuft weiter.`, at: { ...g.pos },
        });
      }
    }
    delete g.engage;
  }
}

registerPhase({ id: 'melee', kind: 'battle', order: ORDER.battle.melee, run: runMelee });

