// KI-Bausteine fuer Akt 4 (P26): geraeumte Linie besetzen (verteilt statt alle auf einen Punkt), den Panzerwagen
// vorfahren und flottmachen, die Pionierbruecke bauen. Rein und deterministisch: arbeitet nur auf der Sicht.
//
// opts.goals (optional): { attack: {x,y}, tank: true, bridge: {x,y} (erstes Wasserfeld der Bruecke) }
import { registerAiBlock } from './blocks.js';
import { cellAt, cellLabel, distance, enterCost, findPath } from '../map.js';
import { surname } from '../phases/hold.js';
import { ASSAULT_TYPES, MAX_ASSAULT_CELLS } from '../phases/move.js';
import { featureOn } from '../underground.js';
import { bridgeLine, bridgeProblem, bridgeCellDone } from '../bridge.js';
import { BRIDGE } from '../config/akt4.js';

const nameOf = (g) => (g.type === 'tank' ? `Panzerwagen ${g.callsign ?? 'K1'}` : 'Gruppe ' + surname(g.leader?.name ?? g.id));
const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
const free = (b, g) => !b.taken.has(g.id) && g.status !== 'lost';

function live(map, view, x, y) {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const s = view.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
}

function assaultPath(b, g, t, { crush = false } = {}) {
  const cost = (c) => {
    const lc = live(b.map, b.view, c.x, c.y);
    if (!lc) return Infinity;
    const wire = crush || lc.wire?.side === b.sit.ms ? null : lc.wire;
    // Der Wagen meidet Trichter, wo es geht
    const extra = g.type === 'tank' ? (lc.crater | 0) * 30 + (lc.terrain === 'wald' ? 40 : 0) : 0;
    return enterCost({ ...lc, wire }) + extra;
  };
  const r = findPath(b.map, g.pos, t, { cost, maxNodes: 20000 });
  const path = r?.path.slice(1);
  if (!path?.length || path.length > MAX_ASSAULT_CELLS) return null;
  return path;
}

// 1. Geraeumte Linie (Feature 'occupy'): jede Sturmgruppe nimmt sich ein eigenes Stueck der feindlichen Linie vor
registerAiBlock({
  id: 'akt4-occupy',
  order: 58,
  run(b) {
    const t = b.opts.goals?.attack;
    if (!t || !featureOn(b.st, 'occupy')) return;
    // Ziele: feindliche Feuergraeben in der Spalte des Ziels (+-1), die noch nicht uns gehoeren
    const targets = b.sit.foeTrench.filter((c) => c.kind === 'fire' && Math.abs(c.x - t.x) <= 1)
      .sort((p, q) => p.y - q.y || p.x - q.x);
    if (!targets.length) return;
    const used = new Set();
    const fighters = b.sit.own.filter((g) => ASSAULT_TYPES.has(g.type) && g.type !== 'tank' && free(b, g) && !g.inDugout && g.strength * 10 >= (g.size ?? 1) * 4)
      .sort(byId);
    for (const g of fighters) {
      // Wer schon in der neuen Linie steht, bleibt und besetzt von dort aus weiter
      const here = live(b.map, b.view, g.pos.x, g.pos.y);
      if (here?.trench?.side === b.sit.ms && Math.abs(g.pos.x - t.x) <= 1) {
        b.give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} bleibt in der besetzten Linie bei ${cellLabel(g.pos.x, g.pos.y)}.`, 'Linie besetzen: halten');
        continue;
      }
      const cand = targets.filter((c) => !used.has(c.x + ',' + c.y) && Math.abs(c.y - g.pos.y) <= 8)
        .sort((p, q) => Math.abs(p.y - g.pos.y) - Math.abs(q.y - g.pos.y) || p.y - q.y)[0];
      if (!cand) continue;
      const kind = b.kind === 'battle' ? 'assault' : 'attack';
      const path = assaultPath(b, g, cand);
      if (!path) continue;
      for (let dy = -2; dy <= 2; dy++) used.add(cand.x + ',' + (cand.y + dy));
      b.give(g, { group: g.id, type: kind, path }, `${nameOf(g)} geht auf die geräumte Linie bei ${cellLabel(cand.x, cand.y)}.`, 'Linie besetzen');
    }
  },
});

// 2. Panzerwagen: festgefahren warten (Pioniere holen ihn heraus), sonst die Strasse hinauf aufs Ziel
registerAiBlock({
  id: 'akt4-tank',
  order: 57,
  run(b) {
    const t = b.opts.goals?.attack;
    if (!t || !b.opts.goals?.tank) return;
    for (const g of b.sit.own.filter((x) => x.type === 'tank' && free(b, x)).sort(byId)) {
      if (g.stuck) {
        b.give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} steckt fest und wartet auf die Pioniere.`, 'Panzerwagen: festgefahren');
        const pio = b.sit.own.filter((x) => x.type === 'pioneers' && free(b, x) && !x.inDugout)
          .sort((p, q) => distance(p.pos, g.pos) - distance(q.pos, g.pos) || byId(p, q))[0];
        if (pio && b.kind === 'position') {
          if (distance(pio.pos, g.pos) <= 1) b.give(pio, { group: pio.id, type: 'hold' }, `${nameOf(pio)} gräbt ${nameOf(g)} frei.`, 'Panzerwagen freigraben');
          else {
            const path = assaultPath(b, pio, g.pos);
            if (path && path.length > 1) b.give(pio, { group: pio.id, type: 'attack', path: path.slice(0, -1) }, `${nameOf(pio)} geht zum festgefahrenen ${nameOf(g)}.`, 'Panzerwagen freigraben');
          }
        }
        continue;
      }
      if (distance(g.pos, t) <= 1) {
        b.give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} steht am Ziel.`, 'Panzerwagen: am Ziel');
        continue;
      }
      const path = assaultPath(b, g, t, { crush: true });
      if (!path) continue;
      const kind = b.kind === 'battle' ? 'assault' : 'attack';
      b.give(g, { group: g.id, type: kind, path }, `${nameOf(g)} fährt auf ${cellLabel(t.x, t.y)} vor, über den Draht.`, 'Panzerwagen vor');
    }
  },
});

// 3. Pionierbruecke: Bauleute am Ufer bauen weiter, bis das Gleis drueben ist
registerAiBlock({
  id: 'akt4-bridge',
  order: 30,
  run(b) {
    const goal = b.opts.goals?.bridge;
    if (!goal || b.kind !== 'position' || !featureOn(b.st, 'bridge')) return;
    const builders = b.sit.own.filter((g) => BRIDGE.builders.includes(g.type) && free(b, g) && !g.inDugout)
      .sort((p, q) => (p.type === 'pioneers' ? 0 : 1) - (q.type === 'pioneers' ? 0 : 1) || distance(p.pos, goal) - distance(q.pos, goal) || byId(p, q));
    // Eine Linie vom Ufer geradeaus ueber das Wasser (alle Bauleute arbeiten an derselben)
    const dir = cellAt(b.map, goal.x - 1, goal.y) && cellAt(b.map, goal.x - 1, goal.y).terrain !== 'wasser' ? -1 : 1;
    const path = bridgeLine(b.map, { pos: { x: goal.x + dir, y: goal.y } }, goal);
    if (!path || path.every((p) => bridgeCellDone(b.st, p))) return;
    let n = 0;
    for (const g of builders) {
      if (n >= 3 || bridgeProblem(b.map, b.st, g, path)) continue;
      if (b.give(g, { group: g.id, type: 'bridge', path }, `${nameOf(g)} baut an der Brücke bei ${cellLabel(path[0].x, path[0].y)}.`, 'Brücke bauen')) n++;
    }
  },
});
