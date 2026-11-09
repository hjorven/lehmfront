// Sappe vortreiben (Plan 4.2 Nr. 13, Paket P23). Rein: kein DOM, kein Date, kein Math.random.
// Befehl { group, type: 'sap', path }: ein gedeckter Annaeherungsgraben vom eigenen Graben ins Niemandsland.
// - Arbeitsbudget wie beim Graben (digRate: Einheit, Staerke, Wetter, Erschoepfung, Vertrauen, Veteranen ...),
//   ein Sappenfeld kostet SAP.work (Kreide mehr). Bericht Sappenkopf: schneller.
// - Fertige Felder werden Graeben der eigenen Seite (Laufgraben, Stufe 1, sap: true). Die Gruppe sitzt im
//   Sappenkopf, also immer in Deckung. Sie arbeitet sich vor und steht am letzten fertigen Feld.
// - Angefangene Arbeit bleibt im Feld (sapWork). Der Rest laeuft als Befehl weiter (carry).
// - Frischer Aufwurf verraet die Sappe wie beim Graben (Meldung spoil_seen fuer den Gegner in Sichtweite).
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance } from '../map.js';
import { groupsOf, otherSide } from '../state.js';
import { digRate, SPOIL_SIGHT_DAY, SPOIL_SIGHT_NIGHT } from './dig.js';
import { surname } from './hold.js';
import { SAP } from '../config/akt2.js';
import { hasReport } from '../config/reports.js';
import { checkSap, live, ownTrench, sapCellWork } from '../underground.js';
import { mapSideOf } from '../trench.js';

registerOrderValidator('sap', (order, group, state, env) => checkSap(env.map ?? null, state, group, order.path, { carried: !!order.carried }));

/** Arbeitsbudget fuer Sappen (Bericht Sappenkopf eingerechnet) */
export function sapRate(state, group, map) {
  const { rate } = digRate(state, group, map);
  return hasReport(state, group.side, 'sappenkopf') ? Math.floor((rate * SAP.sappenkopfPct) / 100) : rate;
}

/** Feuerrichtung eines Sappenfeldes: zur feindlichen Seite */
function facingFor(side) {
  return side === 'a' ? 'E' : 'W';
}

function runSap(ctx) {
  const { state, map } = ctx;
  if (!map) return;
  const occupied = new Map(ctx.groups().map((g) => [g.pos.x + ',' + g.pos.y, g.id]));
  const spoil = [];
  for (const o of ctx.ordersOfType('sap')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const ms = mapSideOf(g.side);
    let budget = sapRate(state, g, map);
    const done = [];
    let i = 0;
    let stuck = null;
    for (; i < o.path.length; i++) {
      const p = o.path[i];
      const k = p.x + ',' + p.y;
      const cell = live(map, state, p.x, p.y);
      if (ownTrench(cell, g.side)) continue;
      if (budget <= 0) break;
      const need = sapCellWork(cell) - (cell.sapWork ?? 0);
      if (need > budget) {
        state.cells[k] = { ...(state.cells[k] ?? {}), sapWork: (cell.sapWork ?? 0) + budget, fresh: ctx.turn };
        budget = 0;
        stuck = p;
        spoil.push({ at: p, side: g.side });
        break;
      }
      budget -= need;
      const { sapWork, ...rest } = state.cells[k] ?? {};
      state.cells[k] = { ...rest, trench: { side: ms, kind: 'comm', level: 1, facing: facingFor(g.side), sap: true }, fresh: ctx.turn };
      done.push(p);
      spoil.push({ at: p, side: g.side });
    }
    const rest = o.path.filter((p) => !ownTrench(live(map, state, p.x, p.y), g.side)).map((p) => ({ x: p.x, y: p.y }));
    if (done.length || stuck) g.fatigue = Math.min(100, (g.fatigue ?? 0) + SAP.fatigue);
    // In den Sappenkopf nachruecken: zum letzten fertigen freien Feld
    for (let j = done.length - 1; j >= 0; j--) {
      const p = done[j];
      const k = p.x + ',' + p.y;
      if (occupied.has(k) && occupied.get(k) !== g.id) continue;
      occupied.delete(g.pos.x + ',' + g.pos.y);
      g.pos = { x: p.x, y: p.y };
      occupied.set(k, g.id);
      break;
    }
    const name = 'Gruppe ' + surname(g.leader.name);
    const fields = (n) => `${n} ${n === 1 ? 'Feld' : 'Felder'}`;
    let reason;
    if (!done.length && !stuck) reason = `${name}: die Sappe steht schon.`;
    else if (!done.length) reason = `${name} gräbt sich bei ${cellLabel(stuck.x, stuck.y)} durch ${live(map, state, stuck.x, stuck.y)?.terrain === 'kreide' ? 'die Kreide' : (state.weather?.wet ?? 0) >= 2 ? 'den nassen Lehm' : 'den Boden'}. Das Feld ist noch nicht durch.`;
    else if (!rest.length) reason = `${name} hat die Sappe bis ${cellLabel(done[done.length - 1].x, done[done.length - 1].y)} vorgetrieben, gedeckt bis zum Kopf.`;
    else reason = `${name} treibt die Sappe ${fields(done.length)} vor, bis ${cellLabel(done[done.length - 1].x, done[done.length - 1].y)}. Noch ${fields(rest.length)} offen.`;
    ctx.emit('sap', {
      side: g.side, group: g.id, secret: true, cells: done.length, rest,
      carry: rest.length ? { group: g.id, type: 'sap', path: rest } : null,
      reason, at: done.length ? { ...done[done.length - 1] } : { ...(stuck ?? o.path[0]) },
    });
  }
  // Aufwurf: je Seite und 3x3-Block eine Meldung
  const sight = state.night ? SPOIL_SIGHT_NIGHT : SPOIL_SIGHT_DAY;
  const told = new Set();
  for (const s of spoil.sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)) {
    const foe = otherSide(s.side);
    const watchers = groupsOf(state, foe).filter((w) => distance(w.pos, s.at) <= sight && !w.inDugout);
    if (!watchers.length) continue;
    const key = foe + ':' + Math.floor(s.at.x / 3) + ',' + Math.floor(s.at.y / 3);
    if (told.has(key)) continue;
    told.add(key);
    ctx.emit('spoil_seen', {
      side: foe, secret: true, by: watchers[0].id, sap: true,
      reason: state.night
        ? `Im Dunkeln Spatengeräusche bei ${cellLabel(s.at.x, s.at.y)}, ganz nah. Der Gegner treibt eine Sappe vor.`
        : `Frischer Aufwurf bei ${cellLabel(s.at.x, s.at.y)}, mitten im Niemandsland: eine Sappe kommt näher.`,
      at: { ...s.at },
    });
  }
}

registerPhase({ id: 'sap', kind: 'position', order: ORDER.position.works + 4, run: runSap });
