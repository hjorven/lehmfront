// Pionierbruecke (Paket P26, Mission a4m5). Rein: kein DOM, kein Date, kein Math.random. Regeln in js/bridge.js.
// Stellungsrunde, nach der Artillerie (Treffer reissen Arbeit ein), bei den Arbeiten: Gruppen mit dem Befehl
// bridge bauen Joch um Joch vom Ufer aus, danach das Gleis. Wer die Bruecke baut, steht am Ufer und wird muede.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel } from '../map.js';
import { BRIDGE } from '../config/akt4.js';
import { bridgeProblem, bridgeAt, bridgeRate, bridgeProgress } from '../bridge.js';
import { mapSideOf } from './move.js';
import { groupLabel } from '../harm.js';

registerOrderValidator('bridge', (order, group, state, env) => bridgeProblem(env.map ?? null, state, group, order.path));

function runBridge(ctx) {
  const { state } = ctx;
  // 1. Treffer auf der Bruecke (Einschlaege dieser Runde)
  const hits = new Map();
  for (const e of ctx.log) {
    if (e.type !== 'impacts') continue;
    for (const i of e.impacts ?? []) {
      const p = i.at ?? i;
      if (!Number.isInteger(p?.x) || !bridgeAt(state, p)) continue;
      const k = p.x + ',' + p.y;
      hits.set(k, (hits.get(k) ?? 0) + 1);
    }
  }
  for (const k of [...hits.keys()].sort()) {
    const b = state.cells[k].bridge;
    const was = b.done;
    const work = Math.max(0, (b.work ?? 0) - BRIDGE.hitDamage * hits.get(k));
    state.cells[k] = { ...state.cells[k], bridge: { ...b, work, done: work >= BRIDGE.work, railWork: work >= BRIDGE.work ? b.railWork ?? 0 : 0 } };
    if (!state.cells[k].bridge.done && state.cells[k].rail) state.cells[k] = { ...state.cells[k], rail: false };
    const [x, y] = k.split(',').map(Number);
    ctx.emit('bridge_hit', {
      public: true, cell: { x, y }, broken: was && !state.cells[k].bridge.done,
      reason: was && !state.cells[k].bridge.done
        ? `Ein Treffer reißt bei ${cellLabel(x, y)} ein Joch aus der Brücke. Bohlen treiben die Asse hinunter.`
        : `Einschlag bei ${cellLabel(x, y)} neben der Brücke. Splitter in den Balken, das Joch steht noch halb.`,
      at: { x, y },
    });
  }
  // 2. Bauen
  for (const o of ctx.ordersOfType('bridge')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    let budget = bridgeRate(g);
    const before = bridgeProgress(state, o.path);
    for (const p of o.path) {
      if (budget <= 0) break;
      const k = p.x + ',' + p.y;
      const b = { work: 0, railWork: 0, side: mapSideOf(g.side), ...(state.cells[k]?.bridge ?? {}) };
      if (b.work < BRIDGE.work) {
        const add = Math.min(budget, BRIDGE.work - b.work);
        b.work += add;
        budget -= add;
        b.done = b.work >= BRIDGE.work;
      }
      if (b.done && budget > 0 && (b.railWork ?? 0) < BRIDGE.railWork) {
        const add = Math.min(budget, BRIDGE.railWork - (b.railWork ?? 0));
        b.railWork = (b.railWork ?? 0) + add;
        budget -= add;
      }
      const patch = { bridge: b };
      if (b.done && b.railWork >= BRIDGE.railWork) patch.rail = true;
      state.cells[k] = { ...(state.cells[k] ?? {}), ...patch };
      if (!b.done) break; // das naechste Joch erst, wenn dieses steht
    }
    g.fatigue = Math.min(100, (g.fatigue ?? 0) + 5);
    const after = bridgeProgress(state, o.path);
    const end = o.path[o.path.length - 1];
    const done = after.rail === after.total;
    ctx.emit(done ? 'bridge_done' : 'bridge', {
      side: g.side, group: g.id, public: done, secret: !done, cells: after.done - before.done, done: after.done, rail: after.rail, total: after.total,
      reason: done
        ? `Die Brücke bei ${cellLabel(end.x, end.y)} steht, ${after.total} Joche, das Gleis liegt darauf. Die erste Lore rollt hinüber, langsam, alle sehen zu.`
        : `${groupLabel(g)} baut an der Brücke: ${after.done} von ${after.total} Jochen stehen${after.rail ? `, auf ${after.rail} liegt schon Gleis` : ''}.`,
      at: { ...(o.path[Math.max(0, Math.min(after.done, o.path.length - 1))]) },
    });
  }
}

registerPhase({ id: 'bridge', kind: 'position', order: ORDER.position.works + 3, run: runBridge });
