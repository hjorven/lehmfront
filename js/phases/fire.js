// Feuer und Unterdrueckung (Plan 4.1 Nr. 5 und 7, 10.5, 10.6). Rein: kein DOM, kein Date, kein Math.random.
//
// Phasen in dieser Datei:
// - exposure (nach der Bewegung, beide Rundenarten): merkt, wer sich gezeigt hat (moved) und setzt fired zurueck.
// - sector (vor dem Feuer): MG-Trupps richten ihren Feuersektor aus (Befehl "sector", in beiden Rundenarten).
// - fire (Gefecht, nach der Bewegung): alle schiessen gleichzeitig mit dem Stand nach der Bewegung.
//     * Befehl "fire" mit Zielfeld: feuert auf die sichtbare feindliche Gruppe auf dem Feld (oder direkt daneben,
//       falls sie ausgewichen ist).
//     * MG-Trupps ohne Feuerbefehl bestreichen ihren Kegel: naechste sichtbare Gruppe darin.
//     * Andere Gruppen, die halten, erwidern das Feuer auf die naechste sichtbare Gruppe in Reichweite,
//       ausser sie sind niedergehalten. Wer sich bewegt, stuermt oder im Unterstand sitzt, feuert nicht.
//     * Grabenmoerser (indirect) brauchen keine eigene Sichtlinie, nur ein Ziel, das die eigene Seite sieht,
//       und treffen in Graeben (Deckung hoechstens wie ein Trichter).
// - rally (vor der Moral): Unterdrueckung klingt ab. Wer in dieser Runde nicht beschossen wurde, faengt sich.
//   Nach einer Stellungsrunde (12 Stunden) ist niemand mehr niedergehalten.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { unitType } from '../config/units.js';
import { resolveFire, hitChance, coverValue, visibilityFromDarkness } from '../rules.js';
import { cellLabel, distance, lineOfSight } from '../map.js';
import { otherSide } from '../state.js';
import {
  darknessOf, darknessAtCell, coverAt, trenchAt, spot, visibleEnemies, sectorOf, inCone, directionOf, PINNED,
} from '../sight.js';
import { surname } from './hold.js';

/** Befehle, bei denen eine Gruppe nicht schiesst */
export const NO_FIRE_ORDERS = new Set(['move', 'assault', 'redeploy', 'dugout', 'cease_fire', 'shift_fire']);
/** Diese Gruppen schiessen nur auf Befehl, sonst verraten sie sich (Beobachter, Melder) */
export const ORDER_ONLY = new Set(['observers', 'runners']);
/** Feuer auf Verdacht (Ziel nicht zu sehen): Trefferchance mal diesem Faktor */
export const BLIND = 0.4;
/** Erholung je Gefechtsrunde ohne Beschuss */
export const RALLY = 0.3;

const r2 = (v) => Math.floor(v * 100 + 0.5) / 100;

/** Kann die Gruppe ueberhaupt feuern? */
export function canFire(group) {
  const t = unitType(group.type);
  return t.shots > 0 && t.range > 0;
}

/** Wirksame Schusszahl: Grundwert mal Anteil der Mannstaerke (mindestens 1) */
export function effectiveShots(group) {
  const t = unitType(group.type);
  if (!group.size) return t.shots;
  return Math.max(1, Math.floor((t.shots * group.strength) / group.size + 0.5));
}

// ---------- Laengsfeuer ----------

/**
 * Laengsfeuer (Plan 4.1 Nr. 3): Ziel liegt in einem Graben, der Schuetze schaut entlang des Grabens, und der
 * Abschnitt laeuft in seine Richtung mindestens zwei Felder gerade weiter (keine Traverse dazwischen).
 * P04 kann die Regel mit setEnfiladeRule genauer machen.
 */
export function defaultEnfilade(state, map, shooterPos, targetPos) {
  const tr = trenchAt(state, map, targetPos.x, targetPos.y);
  if (!tr || tr.traverse) return false;
  const facing = String(tr.facing ?? '').toUpperCase();
  const dir = directionOf(targetPos, shooterPos);
  if (!dir || !facing) return false;
  // Feuerrichtung des Grabens; der Graben verlaeuft quer dazu
  const f = { N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1] }[facing];
  if (!f) return false;
  // Schuetze muss quer zur Feuerrichtung stehen (Skalarprodukt 0)
  if (dir.dx * f[0] + dir.dy * f[1] !== 0) return false;
  for (let i = 1; i <= 2; i++) {
    const n = trenchAt(state, map, targetPos.x + dir.dx * i, targetPos.y + dir.dy * i);
    if (!n || n.traverse || String(n.facing ?? '').toUpperCase() !== facing) return false;
  }
  return true;
}

let enfiladeRule = defaultEnfilade;
/** Laengsfeuer-Regel tauschen (P04); ohne Argument zurueck auf die Grundregel */
export function setEnfiladeRule(fn) {
  enfiladeRule = typeof fn === 'function' ? fn : defaultEnfilade;
}

// ---------- Feuerwerte (auch fuer die Vorschau) ----------

/**
 * Werte eines Schusses von shooter auf ein Ziel an targetPos (Gruppe der Seite targetSide).
 * Liefert { ok, why, p, shots, expected, cover, reversed, enfilade, distance, range, los }.
 * ok = false mit deutschem Grund, wenn ausser Reichweite oder ohne Sicht.
 */
export function fireOdds(state, map, shooter, targetPos, targetSide, { darkness = darknessOf(state), needLos = true } = {}) {
  const t = unitType(shooter.type);
  const d = distance(shooter.pos, targetPos);
  const cov = coverAt(state, map, targetPos, targetSide);
  const indirect = !!t.indirect;
  let cover = cov.cover;
  // Steilfeuer trifft in den Graben
  if (indirect && coverValue(cover) > coverValue('crater')) cover = 'crater';
  const enfilade = !indirect && enfiladeRule(state, map, shooter.pos, targetPos);
  const base = { shots: effectiveShots(shooter), cover, coverLabel: cov.label, reversed: cov.reversed, enfilade, distance: d, range: t.range, indirect };
  if (!canFire(shooter)) return { ...base, ok: false, why: `${t.name} feuert nicht`, p: 0, expected: 0, los: null };
  if (d > t.range) return { ...base, ok: false, why: `außer Reichweite (${d} von ${t.range} Feldern)`, p: 0, expected: 0, los: null };
  let los = null;
  if (needLos && !indirect && map?.cells && d > 1) {
    los = lineOfSight(map, shooter.pos, targetPos, { eye: 1, target: 1 });
    if (!los.visible) return { ...base, ok: false, why: `kein freies Schussfeld (Sicht endet bei ${cellLabel(los.blockedAt.x, los.blockedAt.y)})`, p: 0, expected: 0, los };
  }
  // Im Licht einer Leuchtkugel (P10) zielt es sich wie am Tag
  const p = hitChance({
    distance: d, range: t.range, cover, visibility: visibilityFromDarkness(darknessAtCell(state, targetPos, darkness)),
    experience: shooter.experience, suppressed: shooter.suppressed, enfilade, reversed: cov.reversed,
  });
  return { ...base, ok: true, why: '', p, expected: base.shots * p, los };
}

// ---------- Phasen ----------

function name(g) {
  return 'Gruppe ' + surname(g.leader.name);
}

function weaponWord(g) {
  const t = unitType(g.type);
  return g.type === 'mg' ? 'MG' : g.type === 'mortar' ? 'Mörser' : t.short === 'Schützen' ? 'Gewehre' : t.short;
}

/** Ziel fuer einen Schuetzen waehlen: { target, why } */
function pickTarget(ctx, shooter, order, visible, darkness) {
  const map = ctx.map;
  const t = unitType(shooter.type);
  const foes = ctx.groups(otherSide(shooter.side)).filter((g) => visible.has(g.id));
  const odds = (g) => fireOdds(ctx.state, map, shooter, g.pos, g.side, { darkness });
  const near = (list) => list
    .map((g) => ({ g, d: distance(shooter.pos, g.pos) }))
    .sort((a, b) => a.d - b.d || (a.g.id < b.g.id ? -1 : 1));

  if (order?.type === 'fire' && order.target) {
    const cands = foes.filter((g) => distance(g.pos, order.target) <= 1)
      .map((g) => ({ g, d: distance(g.pos, order.target) }))
      .sort((a, b) => a.d - b.d || (a.g.id < b.g.id ? -1 : 1));
    if (!cands.length) {
      // Feuer auf Verdacht: liegt dort tatsaechlich jemand verborgen, trifft es ihn schlechter
      const hidden = ctx.groups(otherSide(shooter.side)).find((g) => g.pos.x === order.target.x && g.pos.y === order.target.y);
      const o = fireOdds(ctx.state, map, shooter, order.target, otherSide(shooter.side), { darkness });
      if (!o.ok) return { target: null, why: o.why };
      if (hidden) return { target: hidden, odds: { ...o, p: o.p * BLIND, expected: o.expected * BLIND, blind: true } };
      return { target: null, blindEmpty: true, odds: o, why: `Feuer auf Verdacht nach ${cellLabel(order.target.x, order.target.y)}, dort liegt niemand` };
    }
    for (const { g } of cands) {
      const o = odds(g);
      if (o.ok) return { target: g, odds: o };
    }
    return { target: null, why: odds(cands[0].g).why };
  }
  if (ORDER_ONLY.has(shooter.type)) return { target: null, why: 'schießt nur auf Befehl', quiet: true };
  if (shooter.suppressed >= PINNED) return { target: null, why: 'niedergehalten', quiet: true };
  let list = foes;
  if (t.sector) {
    const sec = sectorOf(shooter);
    list = list.filter((g) => inCone(shooter.pos, sec.aim, g.pos, sec.width, t.range));
  }
  for (const { g } of near(list)) {
    const o = odds(g);
    if (o.ok) return { target: g, odds: o };
  }
  return { target: null, why: 'kein Ziel', quiet: true };
}

function runExposure(ctx) {
  const moved = new Set();
  for (const e of ctx.log) {
    if (e.group && e.from && e.to && (e.from.x !== e.to.x || e.from.y !== e.to.y)) moved.add(e.group);
  }
  for (const g of ctx.state.groups) {
    g.moved = moved.has(g.id);
    g.fired = false;
    g.underFire = false;
  }
}

function runSector(ctx) {
  for (const o of ctx.ordersOfType('sector')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    g.sector = { x: o.target.x, y: o.target.y };
    const dir = directionOf(g.pos, o.target);
    ctx.emit('sector', {
      side: g.side, group: g.id, secret: true, minor: true, target: { ...o.target },
      reason: `${name(g)} richtet das MG nach ${dir ? dir.name : 'vorn'} aus, Feuersektor auf ${cellLabel(o.target.x, o.target.y)}.`,
      at: { ...g.pos },
    });
  }
}

function runFire(ctx) {
  const state = ctx.state, map = ctx.map;
  const darkness = darknessOf(state);
  const visible = { a: new Set(visibleEnemies(state, map, 'a', darkness)), b: new Set(visibleEnemies(state, map, 'b', darkness)) };
  // Momentaufnahme: alle schiessen gleichzeitig mit Unterdrueckung und Staerke vor dem Feuer
  const shots = [];
  for (const g of ctx.groups()) {
    if (!canFire(g) || g.inDugout) continue;
    const o = ctx.orderFor(g.id);
    if (o && NO_FIRE_ORDERS.has(o.type)) continue;
    if (g.moved) continue;
    const pick = pickTarget(ctx, g, o, visible[g.side], darkness);
    if (!pick.target && pick.blindEmpty) {
      // Auf Verdacht ins Leere: Muendungsfeuer verraet trotzdem
      g.fired = true;
      ctx.emit('fire', {
        side: g.side, group: g.id, secret: true, target: null, hits: 0, shots: pick.odds.shots, ammo: unitType(g.type).id === 'mg' ? 2 : 1, ordered: true, blind: true,
        reason: `${name(g)} feuert auf Verdacht nach ${cellLabel(o.target.x, o.target.y)}: keine Wirkung zu erkennen.`,
        at: { ...g.pos },
      });
      continue;
    }
    if (!pick.target) {
      if (!pick.quiet || o?.type === 'fire') {
        ctx.emit('fire_none', {
          side: g.side, group: g.id, secret: true, minor: true,
          reason: `${name(g)} feuert nicht: ${pick.why}.`, at: { ...g.pos },
        });
      }
      continue;
    }
    shots.push({ shooter: g, target: pick.target, odds: pick.odds, ordered: o?.type === 'fire' });
  }

  const hitsOn = new Map();
  for (const s of shots) {
    const { shooter, target, odds } = s;
    const t = unitType(shooter.type);
    const r = resolveFire(ctx.rng,
      { shots: odds.shots, range: t.range, experience: shooter.experience, suppressed: shooter.suppressed, suppressionPerShot: t.suppressionPerShot },
      { cover: odds.cover, suppressed: 0, reversed: odds.reversed, inDugout: target.inDugout },
      { distance: odds.distance, visibility: visibilityFromDarkness(darknessAtCell(ctx.state, target.pos, darkness)) * (odds.blind ? BLIND : 1), enfilade: odds.enfilade });
    shooter.fired = true;
    if (!hitsOn.has(target.id)) hitsOn.set(target.id, { hits: 0, supp: 0, from: [] });
    const acc = hitsOn.get(target.id);
    acc.hits += r.hits;
    acc.supp += r.suppression;
    acc.from.push({ group: shooter.id, type: shooter.type, dir: directionOf(target.pos, shooter.pos), enfilade: odds.enfilade, reversed: odds.reversed, hits: r.hits });
    const seen = odds.blind ? 'Wirkung nicht zu erkennen' : r.hits === 0 ? 'kein Treffer zu erkennen' : r.hits === 1 ? 'ein Treffer beobachtet' : `etwa ${r.hits} Treffer beobachtet`;
    const where = odds.coverLabel === 'offenes Feld' ? 'im offenen Feld' : `in Deckung (${odds.coverLabel})`;
    const extra = odds.enfilade ? ', Längsfeuer in den Graben' : odds.indirect ? ', Steilfeuer' : '';
    ctx.emit('fire', {
      side: shooter.side, group: shooter.id, secret: true, target: target.id, hits: odds.blind ? null : r.hits, blind: !!odds.blind, shots: odds.shots,
      chance: r2(odds.p), ammo: t.id === 'mg' ? 2 : 1, ordered: s.ordered,
      reason: odds.blind
        ? `${name(shooter)} feuert (${weaponWord(shooter)}, ${odds.shots} Schuss) auf Verdacht nach ${cellLabel(target.pos.x, target.pos.y)}: ${seen}.`
        : `${name(shooter)} feuert (${weaponWord(shooter)}, ${odds.shots} Schuss) auf Feind bei ${cellLabel(target.pos.x, target.pos.y)} ${where}: ${seen}${extra}.`,
      at: { ...shooter.pos },
    });
  }

  for (const id of [...hitsOn.keys()].sort()) {
    const g = ctx.group(id);
    const acc = hitsOn.get(id);
    const losses = Math.min(g.strength, acc.hits);
    const before = g.suppressed;
    g.strength -= losses;
    g.suppressed = r2(Math.min(1, g.suppressed + acc.supp));
    g.underFire = true;
    const dirs = [...new Set(acc.from.map((f) => f.dir?.name).filter(Boolean))];
    const mg = acc.from.some((f) => f.type === 'mg');
    const cause = acc.from.some((f) => f.enfilade) ? 'enfilade' : acc.from.some((f) => f.reversed) ? 'reversed' : mg ? 'mg' : 'fire';
    const parts = [];
    parts.push(`${mg ? 'MG-Feuer' : 'Feuer'} aus ${dirs.length ? dirs.join(' und ') : 'nächster Nähe'}`);
    if (cause === 'enfilade') parts.push('Längsfeuer, Graben ohne Traverse');
    else if (cause === 'reversed') parts.push('eroberter Graben noch nicht umgebaut');
    const pinned = g.suppressed >= PINNED && before < PINNED;
    const tail = pinned ? ' Die Gruppe ist niedergehalten.' : '';
    const head = losses === 0 ? `${name(g)}: keine Verluste` : `${name(g)}: ${losses} ${losses === 1 ? 'Verlust' : 'Verluste'}`;
    ctx.emit(losses ? 'losses' : 'suppressed', {
      side: g.side, group: g.id, amount: losses, from: acc.from.map((f) => f.group), cause, suppressed: g.suppressed, pinned,
      reason: `${head}, ${parts.join(', ')}.${tail}`,
      at: { ...g.pos },
    });
    if (g.strength <= 0) {
      g.status = 'lost';
      g.strength = 0;
      ctx.state.fallen.push({ name: g.leader.name, home: g.leader.home, group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos } });
      ctx.emit('group_lost', {
        side: g.side, group: g.id, public: true,
        reason: `${name(g)} ist aufgerieben. ${g.leader.name} aus ${g.leader.home} kommt nicht zurück.`,
        at: { ...g.pos },
      });
    }
  }
}

function runRally(ctx) {
  for (const g of ctx.groups()) {
    if (!g.suppressed) continue;
    const before = g.suppressed;
    if (ctx.kind === 'position') g.suppressed = 0;
    else if (!g.underFire) g.suppressed = r2(Math.max(0, g.suppressed - RALLY));
    if (before >= PINNED && g.suppressed < PINNED) {
      ctx.emit('rally', {
        side: g.side, group: g.id, secret: true, minor: true,
        reason: `${name(g)} hebt wieder die Köpfe über die Brustwehr.`, at: { ...g.pos },
      });
    }
  }
}

// ---------- Befehlspruefungen ----------

registerOrderValidator('fire', (order, group, state, env) => {
  const t = unitType(group.type);
  if (!canFire(group)) return `${t.name} feuert nicht`;
  if (t.sector) return 'MG-Trupps feuern über ihren Feuersektor';
  const d = distance(group.pos, order.target);
  if (d === 0) return 'Ziel ist das eigene Feld';
  if (d > t.range + 3) return `Ziel zu weit (${d} Felder, Reichweite ${t.range})`;
  return null;
});

registerOrderValidator('sector', (order, group) => {
  if (!unitType(group.type).sector) return 'nur MG-Trupps haben einen Feuersektor';
  if (order.target.x === group.pos.x && order.target.y === group.pos.y) return 'Sektor braucht eine Richtung';
  return null;
});

registerPhase({
  id: 'exposure',
  kind: 'both',
  order: { position: ORDER.position.movement + 7, battle: ORDER.battle.movement + 7 },
  run: runExposure,
});

registerPhase({
  id: 'sector',
  kind: 'both',
  order: { position: ORDER.position.movement + 8, battle: ORDER.battle.movement + 8 },
  run: runSector,
});

registerPhase({ id: 'fire', kind: 'battle', order: ORDER.battle.fire, run: runFire });

registerPhase({
  id: 'rally',
  kind: 'both',
  order: { position: ORDER.position.morale - 5, battle: ORDER.battle.morale - 5 },
  run: runRally,
});
