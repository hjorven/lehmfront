// Verweigerung eines Sturms (Plan 2.6 und 4.2 Nr. 23, Paket P26). Rein: kein DOM, kein Date, kein Math.random.
//
// Die Vorschau eines Sturms schaetzt die erwarteten Verluste: wie viele Treffer die bekannten feindlichen Schuetzen
// auf dem Weg anrichten, solange die Gruppe draussen ist (Draht kostet eine ganze Runde unter Feuer), dazu der
// Nahkampf, wenn am Ziel jemand im Graben sitzt. Ab 50 Prozent warnt die Vorschau.
// In Akt 4 verweigert bei Vertrauen unter 25 eine Gruppe einen solchen Sturm (state.sides[s].campaign.refuse),
// in a4m4 "Geruechte" jede Gruppe der Seite mit sides[s].refusal. Harms vermittelt einmal je Mission, wenn er in der
// Naehe ist (sides[s].harms = { group, used }); wer Brandt neben sich sieht, geht mit (Gruppe mit brandt: true).
import { REFUSAL } from './config/akt4.js';
import { distance } from './map.js';
import { unitType } from './config/units.js';
import { fireOdds, canFire } from './phases/fire.js';
import { liveCell, stepCost, enemyWire, mapSideOf } from './phases/move.js';

const alive = (g) => g && g.status !== 'lost';

/**
 * Feinde, mit denen die Truppe rechnet: gesehene Gruppen (seenIds), zuletzt gesehene (Phase intel, hoechstens
 * REFUSAL.memory Runden alt, an ihrem alten Ort) und Posten im feindlichen Feuergraben am Ziel des Sturms: dass die
 * Linie, auf die man laeuft, besetzt ist, weiss jeder, auch ohne ihn gesehen zu haben. Gleich in Phase und Vorschau.
 */
export function knownFoes(map, state, side, seenIds, target = null) {
  const foe = side === 'a' ? 'b' : 'a';
  const seen = new Set(seenIds ?? []);
  const out = (state?.groups ?? []).filter((g) => g.side === foe && alive(g) && seen.has(g.id));
  const intel = state?.sides?.[side]?.intel?.lastSeen ?? {};
  for (const id of Object.keys(intel).sort()) {
    if (seen.has(id)) continue;
    const e = intel[id];
    if (!e?.pos || (state.turn ?? 0) - (e.turn ?? 0) > REFUSAL.memory) continue;
    const real = (state.groups ?? []).find((g) => g.id === id);
    if (real && !alive(real)) continue;
    out.push(posten(id, foe, e.type ?? 'rifles', e.pos));
  }
  if (target && map) {
    const fms = mapSideOf(foe);
    const r = REFUSAL.postReach;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const p = { x: target.x + dx, y: target.y + dy };
      const c = liveCell(map, state, p.x, p.y);
      if (!c?.trench || c.trench.side !== fms || c.trench.kind !== 'fire') continue;
      if (out.some((g) => distance(g.pos, p) <= 1)) continue;
      out.push(posten(`posten-${p.x}-${p.y}`, foe, 'rifles', p));
    }
  }
  return out;
}

function posten(id, side, type, pos) {
  return { id, side, type, pos: { x: pos.x, y: pos.y }, strength: REFUSAL.postStrength, size: REFUSAL.postStrength * 2, morale: 70, experience: 1, suppressed: 0, status: 'ok', assumed: true };
}

/** Gilt fuer diese Seite die Verweigerung? */
export function refusalActive(state, side) {
  const st = state?.sides?.[side];
  return !!(st?.campaign?.refuse || st?.refusal);
}

/**
 * Erwartete Verluste eines Sturms auf dem Weg path (ohne Startfeld) gegen die bekannten Feinde foes.
 * Liefert { pct (0..100), hits (Zehntel-genau gerundet), exposed (Felder draussen), melee (bool) }.
 */
export function assaultExposure(map, state, group, path, foes) {
  const strength = Math.max(1, group.strength | 0);
  const speed = Math.max(1, unitType(group.type).speed);
  const ms = mapSideOf(group.side);
  const shooters = (foes ?? []).filter((f) => alive(f) && f.side !== group.side && canFire(f) && !f.inDugout)
    .sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  let hits = 0;
  let exposed = 0;
  let prev = group.pos;
  for (const p of path ?? []) {
    const c = map ? liveCell(map, state, p.x, p.y) : null;
    const step = stepCost(map, prev, p, state);
    prev = p;
    if (c?.trench && c.trench.side === ms && !c.trench.captured) continue; // im eigenen Graben gedeckt
    exposed++;
    // Anteil einer Gefechtsrunde auf diesem Feld (Zehntel), Draht haelt eine ganze Runde fest
    let share = Number.isFinite(step) ? Math.min(100, Math.floor((step * 10) / speed)) : 100;
    if (enemyWire(c, group.side)) share = Math.max(share, REFUSAL.wirePct);
    let here = 0;
    for (const f of shooters) {
      if (distance(f.pos, p) > unitType(f.type).range) continue;
      const o = fireOdds(state, map, f, p, group.side);
      if (o.ok) here += o.expected;
    }
    hits += (here * share) / 100;
  }
  const last = path?.length ? path[path.length - 1] : null;
  const def = last ? (foes ?? []).find((f) => alive(f) && f.side !== group.side && distance(f.pos, last) <= 1) : null;
  if (def) hits += (Math.min(def.strength | 0, strength) * REFUSAL.meleePct) / 100;
  const pct = Math.max(0, Math.min(100, Math.floor((hits * 100) / strength)));
  return { pct, hits: Math.round(hits * 10) / 10, exposed, melee: !!def };
}

/** Ist die Vorschau eine Warnung (erwartete Verluste ab 50 Prozent)? */
export function warned(pct) {
  return pct >= REFUSAL.lossPct;
}

/** Harms der Seite, wenn er da ist: { group, used } und die Gruppe, sonst null */
export function harmsOf(state, side) {
  const h = state?.sides?.[side]?.harms;
  if (!h?.group) return null;
  const g = (state.groups ?? []).find((x) => x.id === h.group);
  return alive(g) ? { ...h, g } : null;
}

/** Brandt auf der Karte (a4m4 "Selbst vorgehen") */
export function brandtOf(state, side) {
  return (state?.groups ?? []).find((g) => g.side === side && g.brandt && alive(g)) ?? null;
}

/**
 * Was geschieht mit diesem Sturm? Liefert { pct, warn, outcome: 'go'|'refuse'|'harms'|'brandt', why }.
 * outcome 'harms': Harms vermittelt (verbraucht ihn), 'brandt': die Gruppe geht hinter Brandt her.
 */
export function refusalFor(map, state, group, path, foes) {
  const e = assaultExposure(map, state, group, path, foes);
  const warn = warned(e.pct);
  if (!warn || !refusalActive(state, group.side)) return { ...e, warn, outcome: 'go', why: '' };
  const b = brandtOf(state, group.side);
  if (b && (b.id === group.id || distance(b.pos, group.pos) <= REFUSAL.brandtReach)) {
    return { ...e, warn, outcome: 'brandt', why: 'Brandt geht selbst vor, die Gruppe folgt ihr' };
  }
  const h = harmsOf(state, group.side);
  if (h && !h.used && distance(h.g.pos, group.pos) <= REFUSAL.harmsReach) {
    return { ...e, warn, outcome: 'harms', why: 'Harms setzt sich zu den Leuten' };
  }
  const far = h && !h.used ? ` (Harms ist ${distance(h.g.pos, group.pos)} Felder weg)` : h?.used ? ' (Harms hat schon einmal vermittelt)' : '';
  return { ...e, warn, outcome: 'refuse', why: `erwartete Verluste etwa ${e.pct} Prozent, die Gruppe geht nicht${far}` };
}
