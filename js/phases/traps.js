// Sprengfallen in geraeumten Graeben (Paket P26, Mission a4m1 "Tauwetter"). Rein: kein DOM, kein Date, kein Math.random.
// Zustand: state.cells[k].trap = { side } (wer sie gelegt hat, Kartenseite 'own'|'enemy'), gefunden: trapFound = Runde.
// Nach der Bewegung (beide Rundenarten):
//   - Pioniere suchen auf dem eigenen Feld und daneben und entschaerfen, was sie finden.
//   - Wer ein Feld mit einer Falle betritt, ohne dass Pioniere daneben sind, loest sie oft aus (Verluste);
//     manchmal sieht die Gruppe den Draht am Tuerrahmen selbst.
import { registerPhase, ORDER } from './registry.js';
import { cellLabel, distance } from '../map.js';
import { mapSideOf } from './move.js';
import { inflictLosses, groupLabel, roll } from '../harm.js';
import { TRAP } from '../config/akt4.js';

/** Unentdeckte Fallen: [{ x, y, side }] sortiert */
export function trapCells(state) {
  const out = [];
  for (const k of Object.keys(state?.cells ?? {})) {
    const t = state.cells[k]?.trap;
    if (!t || state.cells[k].trapFound) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y, side: t.side });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

function runTraps(ctx) {
  const { state } = ctx;
  const traps = trapCells(state);
  if (!traps.length) return;
  const groups = ctx.groups().filter((g) => !g.inDugout);
  for (const t of traps) {
    const k = t.x + ',' + t.y;
    // Gefahr nur fuer die Seite, die die Falle nicht gelegt hat
    const foes = groups.filter((g) => mapSideOf(g.side) !== t.side);
    const finder = foes.filter((g) => g.type === 'pioneers' && distance(g.pos, t) <= TRAP.searchReach)
      .sort((p, q) => (p.id < q.id ? -1 : 1))[0];
    if (finder) {
      state.cells[k] = { ...state.cells[k], trapFound: ctx.turn };
      ctx.emit('trap_found', {
        side: finder.side, group: finder.id, secret: true,
        reason: `${groupLabel(finder)} findet bei ${cellLabel(t.x, t.y)} einen Draht am Türrahmen, darunter eine Granate ohne Splint. Entschärft.`,
        at: { x: t.x, y: t.y },
      });
      continue;
    }
    const on = foes.filter((g) => g.pos.x === t.x && g.pos.y === t.y)[0];
    if (on) springTrap(ctx, t, on);
  }
}

/** Gruppe on steht auf der Falle t: manchmal sieht sie den Draht, oft geht die Falle hoch */
export function springTrap(ctx, t, on) {
  const { state } = ctx;
  const k = t.x + ',' + t.y;
  if (ctx.rng() * 100 < TRAP.othersFindPct) {
    state.cells[k] = { ...state.cells[k], trapFound: ctx.turn };
    ctx.emit('trap_found', {
      side: on.side, group: on.id, secret: true,
      reason: `${groupLabel(on)} sieht bei ${cellLabel(t.x, t.y)} den Draht gerade noch, bevor jemand den Fuß hebt.`,
      at: { x: t.x, y: t.y },
    });
    return false;
  }
  if (ctx.rng() * 100 >= TRAP.triggerPct) return false;
  state.cells[k] = { ...state.cells[k], trapFound: ctx.turn, trapFired: true };
  const n = roll(ctx.rng, TRAP.loss[0], TRAP.loss[1]);
  ctx.emit('trap', {
    side: on.side, group: on.id, public: true,
    reason: `Bei ${cellLabel(t.x, t.y)} geht eine Sprengfalle hoch, im Unterstand, an dem keiner gezogen hat.`,
    at: { x: t.x, y: t.y },
  });
  inflictLosses(ctx, on, n, `${groupLabel(on)}: ${n} Mann von der Sprengfalle bei ${cellLabel(t.x, t.y)} getroffen.`, { cause: 'trap' });
  return true;
}

registerPhase({ id: 'traps', kind: 'both', order: { position: ORDER.position.movement + 3, battle: ORDER.battle.movement + 3 }, run: runTraps });
