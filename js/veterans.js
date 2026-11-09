// Offiziere, Veteranen-Eigenschaften und Doktrinen der Spielerin (Plan 2.4, 4.2 Nr. 16 bis 18, Paket P23).
// Rein: kein DOM, kein Date, kein Math.random. Meldet ihre Wirkungen im Register js/modifiers.js und als
// Grabfaktor an; die Phase js/phases/veterans.js laesst Offiziere fallen und vergibt Eigenschaften.
//
// Zustand:
//   group.officer = { id, name, rank, home, skill: 'sturm'|'ruhe'|'graben'|'nacht' }  Zugfuehrer bei der Gruppe
//   group.traits  = ['nacht', 'graeber', ...]   hoechstens MAX_TRAITS
//   group.deeds   = { nacht, graeber, schuetzen, fest, wachsam }   Zaehler fuer Eigenschaften
//   state.sides[s].doctrine = 'tiefe' | 'infiltration' | 'material'   (Entscheidung nach a2m4)
import { OFFICER, OFFICER_SKILLS, TRAITS, MAX_TRAITS, DEEDS, PLAYER_DOCTRINES } from './config/akt2.js';
import { registerModifier } from './modifiers.js';
import { registerDigFactor } from './phases/dig.js';
import { distance, cellAt } from './map.js';
import { mapSideOf } from './trench.js';

export function hasTrait(g, id) {
  return Array.isArray(g?.traits) && g.traits.includes(id);
}

/** Offiziere einer Seite in Reichweite der Gruppe (auch der eigene), nach id */
export function officersNear(state, g, skill = null) {
  if (!state?.groups || !g?.pos) return [];
  return state.groups
    .filter((o) => o.side === g.side && o.status !== 'lost' && o.officer && (!skill || o.officer.skill === skill) && distance(o.pos, g.pos) <= OFFICER.aura)
    .sort((p, q) => (p.id < q.id ? -1 : 1));
}

export function doctrineOf(state, side) {
  const d = state?.sides?.[side]?.doctrine;
  return d && PLAYER_DOCTRINES[d] ? PLAYER_DOCTRINES[d] : null;
}

/** Chance in Prozent, dass der Offizier bei einem Verlustereignis seiner Gruppe faellt */
export function officerFallChance(amount, { sniper = false } = {}) {
  if (!(amount > 0)) return 0;
  return Math.min(OFFICER.fallMax, OFFICER.fallBase + OFFICER.fallPerLoss * amount + (sniper ? OFFICER.sniperBonus : 0));
}

/** Neue Eigenschaft, die eine Gruppe mit diesen Taten verdient hat (nach fester Reihenfolge), oder null */
export function earnedTrait(g) {
  const have = Array.isArray(g.traits) ? g.traits : [];
  if (have.length >= MAX_TRAITS) return null;
  for (const id of Object.keys(DEEDS)) {
    if (have.includes(id)) continue;
    if ((g.deeds?.[id] ?? 0) >= DEEDS[id]) return id;
  }
  return null;
}

/** Kurzbeschreibung fuer Schild und Liste: ['Lt. Vell (Sturm)', 'Nachtkämpfer'] */
export function veteranLines(g) {
  const out = [];
  if (g.officer) out.push(`${g.officer.rank ?? 'Leutnant'} ${g.officer.name} (${OFFICER_SKILLS[g.officer.skill]?.label ?? g.officer.skill})`);
  for (const t of g.traits ?? []) if (TRAITS[t]) out.push(TRAITS[t].label);
  return out;
}

const inOwnTrench = (state, map, g) => {
  const s = state?.cells?.[g.pos.x + ',' + g.pos.y];
  const tr = s && Object.hasOwn(s, 'trench') ? s.trench : (map?.cells ? cellAt(map, g.pos.x, g.pos.y)?.trench : null);
  return !!(tr && tr.side === mapSideOf(g.side));
};

// ---------------------------------------------------------------------- Wirkungen anmelden

registerModifier('melee', 'offizier', ({ state, group }) => (officersNear(state, group, 'sturm').length ? OFFICER_SKILLS.sturm.melee : null));
registerModifier('melee', 'nachtkaempfer', ({ group, night }) => (night && hasTrait(group, 'nacht') ? 125 : null));
registerModifier('melee', 'doktrin', ({ state, map, group, defending }) => {
  const d = doctrineOf(state, group.side);
  return d?.melee && defending && inOwnTrench(state, map, group) ? d.melee : null;
});
registerModifier('raid', 'doktrin', ({ state, group }) => doctrineOf(state, group.side)?.raid ?? null);
registerModifier('fire_xp', 'scharfschuetzen', ({ group }) => (hasTrait(group, 'schuetzen') ? 1 : null));
registerModifier('check', 'unerschuetterlich', ({ group }) => (hasTrait(group, 'fest') ? 20 : null));
registerModifier('check', 'offizier', ({ state, group }) => (officersNear(state, group, 'ruhe').length ? OFFICER_SKILLS.ruhe.check : null));
registerModifier('exit', 'wachsam', ({ group }) => hasTrait(group, 'wachsam'));
registerModifier('listen', 'wachsam', ({ group }) => (hasTrait(group, 'wachsam') ? 10 : null));
registerModifier('spot', 'veteran', ({ group, role }) => {
  if (role === 'watcher') return hasTrait(group, 'wachsam') ? 12 : null;
  return hasTrait(group, 'nacht') ? -10 : null;
});
registerModifier('spot', 'offizier', ({ group, role }) => (role === 'raider' && group.officer?.skill === 'nacht' ? OFFICER_SKILLS.nacht.spot : null));
registerModifier('spot', 'doktrin', ({ state, group, role }) => {
  const d = doctrineOf(state, group.side);
  if (!d?.spot) return null;
  if (role === 'watcher' && d.spot > 0) return d.spot;
  if (role === 'raider' && d.spot < 0) return d.spot;
  return null;
});

registerDigFactor('veteran', ({ state, group }) => {
  let pct = 100;
  const why = [];
  if (hasTrait(group, 'graeber')) { pct = Math.floor((pct * 125) / 100); why.push('Gräber'); }
  if (officersNear(state, group, 'graben').length) { pct = Math.floor((pct * OFFICER_SKILLS.graben.dig) / 100); why.push('Offizier'); }
  const d = doctrineOf(state, group.side);
  if (d?.dig) { pct = Math.floor((pct * d.dig) / 100); why.push(d.label); }
  return pct === 100 ? null : { pct, label: why.join(', ') };
});
