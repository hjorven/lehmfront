// Grosse Mine unter Huegel 214 (Plan 4.2 Nr. 24, Paket P26, Mission a4m3). Rein: kein DOM, kein Date, kein Math.random.
//
// Zustand (nur die eigene Seite kennt ihn): state.sides[s].mine =
//   { label, gallery: [{x,y}], chamber: {x,y}, fuse (Stellungsrunden bis zur Zuendung), rounds (gezaehlt),
//     status: 'ready'|'blown'|'lost'|'flooded', radius }
// Stellungsrunde, gleich nach den Stollen:
//   1. Hat der Gegner in dieser Runde nahe der Galerie gezuendet (Quetschladung) oder ist sein Stollen bis an die
//      Galerie heran, ist die Kammer verloren: verschuettet oder entdeckt.
//   2. Sonst zaehlt die Zuendschnur: Ist der X-Tag da, geht die Mine hoch. Trichter im Radius 2, Graeben und Draht
//      weg, wer darauf liegt, kommt kaum heraus. Kreide faellt weit herum, alle erschrecken.
import { registerPhase, ORDER } from './registry.js';
import { cellLabel, distance } from '../map.js';
import { SIDES, otherSide } from '../state.js';
import { dugCells, tunnelHead, live } from '../underground.js';
import { inflictLosses, groupLabel } from '../harm.js';
import { MINE } from '../config/akt4.js';

/** Alle Felder der Galerie mit Kammer */
export function mineCells(m) {
  return [...(m?.gallery ?? []), ...(m?.chamber ? [m.chamber] : [])];
}

/** Abstand eines Feldes zur Galerie */
export function mineDistance(m, p) {
  let best = Infinity;
  for (const c of mineCells(m)) best = Math.min(best, distance(c, p));
  return best;
}

/** Wie viele Stellungsrunden noch bis zur Zuendung? */
export function mineLeft(m) {
  if (!m || m.status !== 'ready') return 0;
  return Math.max(0, (m.fuse | 0) - (m.rounds | 0));
}

function blowGreat(ctx, side, m) {
  const { state, map } = ctx;
  const c = m.chamber;
  const r = m.radius ?? MINE.radius;
  m.status = 'blown';
  m.blownTurn = ctx.turn;
  const cells = [];
  let trench = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = c.x + dx, y = c.y + dy;
    const cell = live(map, state, x, y);
    if (!cell || cell.terrain === 'wasser') continue;
    const k = x + ',' + y;
    const ring = Math.max(Math.abs(dx), Math.abs(dy));
    const patch = { crater: ring < r ? 2 : Math.max(1, cell.crater ?? 0), mud: ring ? 1 : 2, fresh: ctx.turn, trichter: m.id ?? 'mine', chalk: true, shelled: (state.cells[k]?.shelled ?? 0) + 1 };
    if (cell.trench) { patch.trench = null; trench++; }
    if (cell.wire) patch.wire = null;
    state.cells[k] = { ...(state.cells[k] ?? {}), ...patch };
    cells.push({ x, y });
  }
  // Kreide faellt weit herum (nur Zeichnung)
  const far = MINE.farRadius;
  for (let dy = -far; dy <= far; dy++) for (let dx = -far; dx <= far; dx++) {
    const d = Math.max(Math.abs(dx), Math.abs(dy));
    if (d <= r || d > far || (dx * 7 + dy * 13 + 1000) % 3 !== 0) continue;
    const x = c.x + dx, y = c.y + dy;
    if (!live(map, state, x, y)) continue;
    const k = x + ',' + y;
    state.cells[k] = { ...(state.cells[k] ?? {}), chalk: true };
  }
  const hit = state.groups.filter((g) => g.status !== 'lost' && distance(g.pos, c) <= r).sort((p, q) => (p.id < q.id ? -1 : 1));
  ctx.emit('mine_great', {
    by: side, public: true, cells, trench, groups: hit.length, label: m.label ?? 'Mine',
    reason: `Um ${m.time ?? '04:10'} hebt sich ${m.place ?? 'der Hügel'} bei ${cellLabel(c.x, c.y)}, langsam, wie ein Tier, das aufsteht. Dann kommt der Ton, dann der Wind, dann regnet Kreide. Wo ${m.place ?? 'der Hügel'} war, ist ein Trichter.`,
    at: { x: c.x, y: c.y },
  });
  for (const g of hit) {
    const center = distance(g.pos, c) === 0;
    const pct = center ? MINE.centerLossPct : MINE.ringLossPct;
    const n = Math.max(1, Math.floor((g.strength * pct + 50) / 100));
    g.suppressed = 1;
    g.inDugout = false;
    delete g.dugout;
    g.morale = Math.max(0, (g.morale ?? 70) - 40);
    inflictLosses(ctx, g, n, `${groupLabel(g)} lag auf ${m.place ?? 'dem Hügel'}: ${n} Mann verschüttet.`, { cause: 'mine', public: true });
  }
  for (const g of state.groups.filter((v) => v.status !== 'lost' && distance(v.pos, c) > r && distance(v.pos, c) <= MINE.farRadius)) {
    g.morale = Math.max(0, (g.morale ?? 70) - MINE.farMorale);
    g.suppressed = Math.max(g.suppressed ?? 0, 0.5);
  }
}

function runMine(ctx) {
  const { state } = ctx;
  for (const side of SIDES) {
    const m = state.sides[side]?.mine;
    if (!m || m.status !== 'ready') continue;
    const foe = otherSide(side);
    // 1. Gegenstollen
    for (const t of (state.sides[foe]?.tunnels ?? []).slice().sort((p, q) => (p.id < q.id ? -1 : 1))) {
      if (m.status !== 'ready') break;
      const end = t.path[t.path.length - 1];
      if (t.status === 'blown' && t.blownTurn === ctx.turn && mineDistance(m, end) <= MINE.camoufletReach) {
        m.status = 'lost';
        m.lostTurn = ctx.turn;
        m.lostBy = 'camouflet';
        ctx.emit('mine_lost', {
          side, secret: true, cause: 'camouflet',
          reason: `Drüben haben sie bei ${cellLabel(end.x, end.y)} gezündet, direkt neben der Galerie. Sie ist eingestürzt. Die Kammer unter ${m.place ?? 'dem Hügel'} ist verloren.`,
          at: { ...end },
        });
        continue;
      }
      const head = tunnelHead(t);
      if ((t.status === 'digging' || t.status === 'charged') && head && dugCells(t).some((p) => mineDistance(m, p) <= MINE.breachReach)) {
        m.status = 'lost';
        m.lostTurn = ctx.turn;
        m.lostBy = 'breach';
        ctx.emit('mine_lost', {
          side, secret: true, cause: 'breach',
          reason: `Lasks Mineure sind bei ${cellLabel(head.x, head.y)} in unsere Galerie durchgebrochen. Sie schneiden die Zündleitung. Die Kammer ist verloren.`,
          at: { ...head },
        });
      }
    }
    if (m.status !== 'ready') continue;
    // 2. Zuendschnur
    m.rounds = (m.rounds | 0) + 1;
    if (m.rounds >= (m.fuse | 0)) blowGreat(ctx, side, m);
    else {
      ctx.emit('mine_wait', {
        side, secret: true, minor: true, left: m.fuse - m.rounds,
        reason: `Die Kammer unter ${m.place ?? 'dem Hügel'} ist geladen. Noch ${m.fuse - m.rounds} ${m.fuse - m.rounds === 1 ? 'Stellungsrunde' : 'Stellungsrunden'} bis zur Zündung.`,
        at: { ...m.chamber },
      });
    }
  }
}

registerPhase({ id: 'mine', kind: 'position', order: ORDER.position.tunnels + 3, run: runMine });
