// Pionierbruecke ueber die Asse (Paket P26, Mission a4m5 "Die Bruecke"). Rein: kein DOM, kein Date, kein Math.random.
// Befehl { group, type: 'bridge', path: [{x,y}, ...] }: eine Linie Wasserfelder vom Ufer, an dem die Gruppe steht,
// hinueber. Jedes Feld ist ein Joch: Arbeit BRIDGE.work, danach das Feldbahngleis darauf (BRIDGE.railWork).
// Zustand je Feld: state.cells[k].bridge = { work, done, railWork?, side }; mit Gleis zusaetzlich rail: true.
// Fertige Brueckenfelder sind begehbar (js/map.js enterCost), Treffer reissen Arbeit wieder ein.
import { BRIDGE } from './config/akt4.js';
import { cellAt, cellLabel, distance } from './map.js';
import { unitType } from './config/units.js';
import { tunnelRate } from './underground.js';

const live = (map, state, x, y) => {
  const c = map ? cellAt(map, x, y) : null;
  if (!c) return null;
  const s = state?.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
};

export const bridgeAt = (state, p) => state?.cells?.[p.x + ',' + p.y]?.bridge ?? null;

/** Ist das Feld (Grundkarte) Wasser? */
export function isWater(map, p) {
  return cellAt(map, p.x, p.y)?.terrain === 'wasser';
}

/** Ist das Brueckenfeld fertig, mit Gleis? */
export function bridgeCellDone(state, p, { rail = true } = {}) {
  const b = bridgeAt(state, p);
  if (!b?.done) return false;
  return !rail || !!state.cells[p.x + ',' + p.y]?.rail;
}

/** Arbeit, die auf einem Feld noch fehlt (Joch plus Gleis) */
export function bridgeTodo(state, p, { rail = true } = {}) {
  const b = bridgeAt(state, p);
  const deck = Math.max(0, BRIDGE.work - (b?.work ?? 0));
  const track = rail ? Math.max(0, BRIDGE.railWork - (b?.railWork ?? 0)) : 0;
  return deck + track;
}

/** Arbeitsbudget einer Gruppe je Stellungsrunde (wie beim Stollen: Pioniere doppelt) */
export function bridgeRate(group) {
  return tunnelRate(group);
}

/** Vorschau: Runden, bis die Bruecke mit Gleis steht */
export function bridgeRounds(state, group, path) {
  const rate = Math.max(1, bridgeRate(group));
  const todo = path.reduce((n, p) => n + bridgeTodo(state, p), 0);
  return Math.max(1, Math.ceil(todo / rate));
}

/**
 * Wasserfelder vom Ufer bis ans andere Ufer: Linie vom Feld neben der Gruppe in Richtung des angetippten Feldes.
 * Liefert [{x,y}] (nur Wasser) oder null.
 */
export function bridgeLine(map, group, cell) {
  if (!map || !cell || !isWater(map, cell)) return null;
  const dx = Math.sign(cell.x - group.pos.x), dy = Math.sign(cell.y - group.pos.y);
  if (!dx && !dy) return null;
  // Erstes Wasserfeld in dieser Richtung, direkt neben der Gruppe
  let p = { x: group.pos.x + dx, y: group.pos.y + dy };
  if (!isWater(map, p)) return null;
  const out = [];
  while (p && isWater(map, p) && out.length < BRIDGE.maxCells) {
    out.push(p);
    p = { x: p.x + dx, y: p.y + dy };
    if (!cellAt(map, p.x, p.y)) return null;
  }
  if (!p || isWater(map, p)) return null; // anderes Ufer nicht erreicht
  return out;
}

/** Warum laesst sich hier keine Bruecke bauen? null = geht */
export function bridgeProblem(map, state, group, path) {
  if (!BRIDGE.builders.includes(group.type)) return `${unitType(group.type).name} baut keine Brücken`;
  if (group.inDugout) return 'Gruppe sitzt im Unterstand';
  if (!Array.isArray(path) || !path.length) return 'Brücke braucht eine Linie über das Wasser';
  if (path.length > BRIDGE.maxCells) return `höchstens ${BRIDGE.maxCells} Felder Brücke`;
  if (!map) return null;
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const k = p.x + ',' + p.y;
    if (seen.has(k)) return `Feld ${cellLabel(p.x, p.y)} doppelt`;
    seen.add(k);
    if (!isWater(map, p)) return `${cellLabel(p.x, p.y)} ist kein Wasser`;
    if (i && distance(p, path[i - 1]) !== 1) return `Linie springt bei ${cellLabel(p.x, p.y)}`;
  }
  if (distance(group.pos, path[0]) > BRIDGE.reach) return `die Gruppe steht nicht am Ufer bei ${cellLabel(path[0].x, path[0].y)}`;
  if (path.every((p) => bridgeCellDone(state, p))) return 'die Brücke steht schon';
  return null;
}

/** Fertige Brueckenfelder einer Linie */
export function bridgeProgress(state, path) {
  const done = path.filter((p) => bridgeAt(state, p)?.done).length;
  const rail = path.filter((p) => bridgeCellDone(state, p)).length;
  return { done, rail, total: path.length };
}

export { live as bridgeLive };
