// Aufklaerung (Plan 7.4, 10.6): was jede Seite ueber den Gegner weiss. Rein: kein DOM, kein Date, kein Math.random.
// Laeuft als letzte Phase jeder Runde, nach der Uhr, damit die Dunkelheit der naechsten Runde gilt.
// state.sides[side].intel.lastSeen[id] = { pos, turn, type, from?, sector?, source? }
//   turn: Runde, zu deren Beginn die Gruppe zuletzt gesehen war (Alter = state.turn - turn)
//   from: vorher gesehener Ort, wenn sie sich seitdem bewegt hat ("Bewegung Sued, vor 3 Runden")
//   sector: Zielpunkt des MG-Kegels, sobald das MG beim Feuern gesehen wurde
// Ein Geist wird ausradiert, wenn die Seite auf sein Feld so genau schaut, dass sie dort auch eine Gruppe in
// Deckung erkennen wuerde, und niemand mehr da ist, oder wenn er aelter als MAX_GHOST_AGE ist.
import { registerPhase } from './registry.js';
import { SIDES, getGroup } from '../state.js';
import { cellLabel } from '../map.js';
import { darknessOf, visibleEnemies, sideSeesCell, sectorOf, trenchAt } from '../sight.js';
import { distance } from '../map.js';
import { unitType } from '../config/units.js';
import { MAX_GHOST_AGE } from '../view.js';

/** Aufklaerung einer Seite fortschreiben. now = Runde, fuer die das Wissen gilt. */
export function updateIntel(state, map, side, now, darkness = darknessOf(state)) {
  const s = state.sides[side];
  if (!s.intel) s.intel = { lastSeen: {} };
  if (!s.intel.lastSeen) s.intel.lastSeen = {};
  const known = s.intel.lastSeen;
  const seen = visibleEnemies(state, map, side, darkness);
  const seenSet = new Set(seen);
  for (const id of seen) {
    const g = getGroup(state, id);
    const prev = known[id];
    const e = { pos: { ...g.pos }, turn: now, type: g.type };
    if (prev && (prev.pos.x !== g.pos.x || prev.pos.y !== g.pos.y)) e.from = { ...prev.pos };
    if (unitType(g.type).sector) {
      if (g.fired) e.sector = { ...sectorOf(g).aim };
      else if (prev?.sector && !e.from) e.sector = { ...prev.sector };
    }
    known[id] = e;
  }
  const gone = [];
  for (const id of Object.keys(known).sort()) {
    if (seenSet.has(id)) continue;
    const e = known[id];
    if (now - e.turn > MAX_GHOST_AGE) { delete known[id]; continue; }
    const g = getGroup(state, id);
    // Aufgerieben und der Ort ist einsehbar: still streichen (die Meldung kam schon beim Feuer)
    if ((!g || g.status === 'lost') && sideSeesCell(state, map, side, e.pos, darkness)) { delete known[id]; continue; }
    // In einem Graben kann ein Unterstand eine ganze Gruppe verbergen: erst aus dem Nachbarfeld sicher
    const deep = trenchAt(state, map, e.pos.x, e.pos.y)
      ? state.groups.some((v) => v.side === side && v.status !== 'lost' && distance(v.pos, e.pos) <= 1)
      : sideSeesCell(state, map, side, e.pos, darkness, { concealed: true });
    if (deep) {
      delete known[id];
      gone.push({ id, pos: e.pos });
    }
  }
  return { seen, gone };
}

registerPhase({
  id: 'intel',
  kind: 'both',
  order: { position: 110, battle: 110 },
  run(ctx) {
    for (const side of SIDES) {
      const { gone } = updateIntel(ctx.state, ctx.map, side, ctx.turn + 1);
      for (const g of gone) {
        ctx.emit('ghost_cleared', {
          side, secret: true, minor: true, group: null,
          reason: `Bei ${cellLabel(g.pos.x, g.pos.y)} ist niemand mehr zu sehen. Die Bleistiftnotiz wird ausradiert.`,
          at: { ...g.pos },
        });
      }
    }
  },
});
