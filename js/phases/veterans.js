// Offiziere fallen, Gruppen werden Veteranen (Plan 4.2 Nr. 16 und 17, Paket P23).
// Rein: kein DOM, kein Date, kein Math.random. Laeuft in beiden Rundenarten nach Feuer, Nahkampf und Stosstrupp.
// - Jedes Verlustereignis einer Gruppe mit Offizier wuerfelt, ob der Offizier faellt (Scharfschuetzen zielen auf
//   ihn). Gefallene Offiziere stehen in state.fallen und in state.sides[s].officersFallen, die Gruppe und ihre
//   Nachbarn verlieren Moral.
// - Taten zaehlen je Gruppe (graben, treffen, Moralproben bestehen, nachts gewinnen, Stosstrupps hoeren);
//   ab der Schwelle bekommt die Gruppe eine Veteranen-Eigenschaft (hoechstens zwei).
import { registerPhase, ORDER } from './registry.js';
import { getGroup } from '../state.js';
import { cellLabel, distance } from '../map.js';
import { OFFICER, TRAITS } from '../config/akt2.js';
import { officerFallChance, earnedTrait } from '../veterans.js';
import { groupLabel } from '../harm.js';

function bump(g, key, n = 1) {
  if (!g || n <= 0) return;
  g.deeds = { ...(g.deeds ?? {}), [key]: (g.deeds?.[key] ?? 0) + n };
}

function run(ctx) {
  const { state } = ctx;
  const events = ctx.log; // Protokoll dieser Runde
  // Offiziere
  for (const e of events.filter((x) => x.type === 'losses' && x.amount > 0 && x.group).sort((p, q) => (p.group < q.group ? -1 : p.group > q.group ? 1 : 0))) {
    const g = getGroup(state, e.group);
    if (!g?.officer) continue;
    const sniper = Array.isArray(e.from) && e.from.some((id) => getGroup(state, id)?.type === 'snipers');
    const p = officerFallChance(e.amount, { sniper });
    if (Math.floor(ctx.rng() * 100) >= p) continue;
    const o = g.officer;
    if (o.protect) {
      // Die Geschichte braucht ihn noch (Vell bis a2m5): verwundet, bleibt aber beim Zug
      ctx.emit('officer_wounded', {
        side: g.side, group: g.id, officer: o.id, secret: true,
        reason: `${o.rank ?? 'Leutnant'} ${o.name} ist bei ${cellLabel(g.pos.x, g.pos.y)} leicht verwundet. Er lässt sich verbinden und bleibt beim Zug.`,
        at: { ...g.pos },
      });
      continue;
    }
    delete g.officer;
    const s = state.sides[g.side];
    s.officersFallen = [...(s.officersFallen ?? []), o.id].sort();
    state.fallen.push({ name: o.name, home: o.home ?? '', group: g.id, side: g.side, turn: ctx.turn, at: { ...g.pos }, cause: 'officer', officer: o.id, rank: o.rank ?? 'Leutnant' });
    g.morale = Math.max(0, (g.morale ?? 70) - OFFICER.moraleHit);
    for (const n of ctx.groups(g.side)) if (n.id !== g.id && distance(n.pos, g.pos) <= OFFICER.aura) n.morale = Math.max(0, (n.morale ?? 70) - OFFICER.nearHit);
    ctx.emit('officer_fallen', {
      side: g.side, group: g.id, officer: o.id, public: true,
      reason: `${o.rank ?? 'Leutnant'} ${o.name} ist bei ${cellLabel(g.pos.x, g.pos.y)} gefallen. ${groupLabel(g)} steht ohne Zugführer da.`,
      at: { ...g.pos },
    });
  }
  // Taten aus dem Protokoll dieser Runde
  for (const e of events) {
    if (e.type === 'dig' || e.type === 'sap' || e.type === 'tunnel' || e.type === 'tunnel_charged') bump(getGroup(state, e.group), 'graeber', Number(e.cells) || 0);
    else if (e.type === 'losses' && Array.isArray(e.from) && e.amount > 0) {
      const share = Math.max(1, Math.floor(e.amount / e.from.length));
      for (const id of e.from) bump(getGroup(state, id), 'schuetzen', share);
    } else if (e.type === 'morale_check' && e.outcome === 'held') bump(getGroup(state, e.group), 'fest');
    else if (e.type === 'melee' && state.night) {
      if (e.outcome === 'taken') for (const id of e.attackers ?? []) bump(getGroup(state, id), 'nacht');
      else if (e.outcome === 'repelled') bump(getGroup(state, e.target), 'nacht');
    }
  }
  for (const g of ctx.groups()) {
    const t = earnedTrait(g);
    if (!t) continue;
    g.traits = [...(g.traits ?? []), t];
    ctx.emit('trait_earned', {
      side: g.side, group: g.id, secret: true, trait: t,
      reason: `${groupLabel(g)} gilt jetzt als „${TRAITS[t].label}“: ${TRAITS[t].text}.`,
      at: { ...g.pos },
    });
  }
}

registerPhase({ id: 'veterans', kind: 'both', order: { position: ORDER.position.movement + 7, battle: ORDER.battle.morale + 5 }, run });
