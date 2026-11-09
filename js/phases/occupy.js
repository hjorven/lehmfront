// Geraeumte Graeben besetzen (Paket P26, Mission a4m1 "Tauwetter", Szenario-Feature 'occupy').
// Rein: kein DOM, kein Date, kein Math.random.
//
// Lask hat seine vordere Linie geraeumt. Wer darin Fuss gefasst hat (ein eigenes oder erobertes Grabenfeld), besetzt
// in jeder Stellungsrunde bis zu OCCUPY.perGroup leere Nachbarfelder desselben Grabensystems, solange kein Feind
// daneben steht. Liegt dort eine Falle, die niemand gefunden hat, tritt die Gruppe hinein (js/phases/traps.js).
import { registerPhase, ORDER } from './registry.js';
import { cellLabel, distance } from '../map.js';
import { mapSideOf } from './move.js';
import { captureTrench } from '../trench.js';
import { featureOn, live } from '../underground.js';
import { groupLabel } from '../harm.js';
import { springTrap } from './traps.js';

export const OCCUPY = { perGroup: 2, foeReach: 1 };

function runOccupy(ctx) {
  const { state, map } = ctx;
  if (!map || !featureOn(state, 'occupy')) return;
  const all = ctx.groups();
  for (const g of all.filter((x) => !x.inDugout).sort((p, q) => (p.id < q.id ? -1 : 1))) {
    const ms = mapSideOf(g.side);
    const here = live(map, state, g.pos.x, g.pos.y);
    if (here?.trench?.side !== ms) continue;
    const foes = all.filter((x) => x.side !== g.side);
    const cand = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const p = { x: g.pos.x + dx, y: g.pos.y + dy };
      const c = live(map, state, p.x, p.y);
      if (!c?.trench || c.trench.side === ms) continue;
      if (foes.some((f) => distance(f.pos, p) <= OCCUPY.foeReach)) continue;
      cand.push(p);
    }
    cand.sort((p, q) => p.y - q.y || p.x - q.x);
    const took = [];
    for (const p of cand.slice(0, OCCUPY.perGroup)) {
      if (!captureTrench(state, map, p.x, p.y, g.side)) continue;
      took.push(p);
      const t = state.cells[p.x + ',' + p.y];
      if (t?.trap && !t.trapFound && t.trap.side !== ms) springTrap(ctx, { x: p.x, y: p.y, side: t.trap.side }, g);
    }
    if (!took.length) continue;
    ctx.emit('trench_occupied', {
      side: g.side, group: g.id, cells: took, count: took.length,
      reason: `${groupLabel(g)} besetzt ${took.length === 1 ? 'ein leeres Grabenfeld' : took.length + ' leere Grabenfelder'} bei ${cellLabel(took[0].x, took[0].y)}.`,
      at: { ...took[0] },
    });
  }
}

registerPhase({ id: 'occupy', kind: 'position', order: ORDER.position.movement + 2, run: runOccupy });
