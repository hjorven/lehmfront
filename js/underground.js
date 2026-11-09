// Sappen, Stollen und Horchposten als reine Regeln (Plan 4.2 Nr. 13 und 14, Paket P23).
// Rein: kein DOM, kein Date, kein Math.random. Die Phasen stehen in js/phases/sap.js und js/phases/tunnel.js.
//
// Sappe: Befehl { group, type: 'sap', path } treibt einen gedeckten Annaeherungsgraben vom eigenen Graben ins
//   Niemandsland. Fertige Sappenfelder sind Graeben (kind 'comm', level 1, sap: true) der eigenen Seite.
// Stollen: Befehl { group, type: 'tunnel', path } legt einen Stollen an. Er steht als gestrichelte Linie auf
//   derselben Karte, nur fuer die eigene Seite, im Zustand unter state.sides[side].tunnels:
//     [{ id, group, path: [{x,y}], dug, work, status: 'digging'|'charged'|'blown'|'collapsed', turn }]
//   Gehoerte feindliche Stollen: state.sides[side].heard[tunnelId] = { cells: [{x,y}], turn, count }
//   Die Mineure arbeiten weiter, solange sie am Eingang bleiben (Befehl Stollen oder Halten).
import { SAP, TUNNEL, LISTEN } from './config/akt2.js';
import { cellAt, cellLabel, distance, TERRAIN } from './map.js';
import { unitType } from './config/units.js';
import { mapSideOf } from './trench.js';

export const sideKey = (p) => p.x + ',' + p.y;

/** Feld mit Spielzustand */
export function live(map, state, x, y) {
  const c = map ? cellAt(map, x, y) : null;
  if (!c) return null;
  const s = state?.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
}

/** Ist das Feld ein Graben dieser Seite (auch Sappe)? */
export function ownTrench(cell, side) {
  return !!(cell?.trench && cell.trench.side === mapSideOf(side));
}

/** Gibt es Akt-2-Mechaniken im Szenario? features: 'sap' | 'tunnel' | 'raid' | 'officers' */
export function featureOn(state, f) {
  const list = state?.scenario?.features;
  return Array.isArray(list) && list.includes(f);
}

function stepsOk(path) {
  const seen = new Set();
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    const k = sideKey(p);
    if (seen.has(k)) return `Feld ${cellLabel(p.x, p.y)} doppelt`;
    seen.add(k);
    if (i && Math.max(Math.abs(p.x - path[i - 1].x), Math.abs(p.y - path[i - 1].y)) !== 1) return `Linie springt bei Feld ${cellLabel(p.x, p.y)}`;
  }
  return null;
}

// ------------------------------------------------------------------------------------------- Sappe

/** Warum laesst sich hier keine Sappe treiben? null = geht */
export function sapBlocker(cell, side) {
  if (!cell) return 'außerhalb der Karte';
  const t = TERRAIN[cell.terrain];
  if (!t || !(t.dig > 0)) return `${t?.name ?? 'Boden'} lässt sich nicht graben`;
  if (cell.building) return 'dort steht ein Gebäude';
  if (cell.trench && cell.trench.side !== mapSideOf(side)) return 'feindlicher Graben';
  if (cell.wire && cell.wire.side !== mapSideOf(side)) return 'feindlicher Draht, erst Gasse schneiden';
  // Ein Minentrichter darf ausgebaut werden, auch auf der feindlichen Seite (a2m6: Trichterrand umbauen)
  if (cell.zone !== 'niemandsland' && cell.side !== mapSideOf(side) && !cell.trichter) return 'feindliche Zone';
  return null;
}

/** Felder einer Sappe, die noch Arbeit brauchen */
export function sapTodo(map, state, side, path) {
  return path.filter((p) => !ownTrench(live(map, state, p.x, p.y), side));
}

/**
 * Sappe pruefen (rein). Liefert null oder einen deutschen Grund.
 * Die Sappe muss an einem eigenen Graben ansetzen: das erste noch offene Feld liegt neben einem eigenen Graben.
 */
export function checkSap(map, state, group, path, { carried = false } = {}) {
  if (!SAP.diggers.includes(group.type)) return `${unitType(group.type).name} treibt keine Sappe`;
  if (!Array.isArray(path) || !path.length) return 'Sappe braucht einen Weg';
  if (path.length > SAP.maxCells) return `höchstens ${SAP.maxCells} Felder Sappe auf einmal`;
  const steps = stepsOk(path);
  if (steps) return steps;
  if (!map) return null;
  const near = carried ? Math.min(...path.map((p) => distance(group.pos, p))) : distance(group.pos, path[0]);
  if (near > (carried ? SAP.maxCells : SAP.reach)) return `Sappe beginnt zu weit von der Gruppe (Feld ${cellLabel(path[0].x, path[0].y)})`;
  for (const p of path) {
    const why = sapBlocker(live(map, state, p.x, p.y), group.side);
    if (why) return `Feld ${cellLabel(p.x, p.y)}: ${why}`;
  }
  const first = path.findIndex((p) => !ownTrench(live(map, state, p.x, p.y), group.side));
  if (first < 0) return 'die Sappe steht schon';
  const f = path[first];
  let anchored = first > 0;
  // Im Minentrichter darf man ohne Anschluss ansetzen: der Trichter selbst ist die Deckung (a2m6)
  const inCrater = live(map, state, group.pos.x, group.pos.y)?.trichter;
  if (inCrater && distance(group.pos, f) <= 1) anchored = true;
  for (let dy = -1; dy <= 1 && !anchored; dy++) {
    for (let dx = -1; dx <= 1 && !anchored; dx++) {
      if (!dx && !dy) continue;
      if (ownTrench(live(map, state, f.x + dx, f.y + dy), group.side)) anchored = true;
    }
  }
  if (!anchored) return `Sappe muss an einem eigenen Graben ansetzen (Feld ${cellLabel(f.x, f.y)})`;
  return null;
}

/** Runden fuer eine Sappe bei gegebenem Arbeitsbudget (rate wie digRate, 100 = volle Schuetzengruppe) */
export function sapRounds(map, state, side, path, rate) {
  const todo = sapTodo(map, state, side, path);
  if (!todo.length) return 0;
  let work = 0;
  for (const p of todo) work += sapCellWork(live(map, state, p.x, p.y)) - (live(map, state, p.x, p.y)?.sapWork ?? 0);
  return rate > 0 ? Math.max(1, Math.floor((work + rate - 1) / rate)) : Infinity;
}

/** Arbeit fuer ein Sappenfeld nach Boden (Kreide hart, Lehm normal) */
export function sapCellWork(cell) {
  const t = TERRAIN[cell?.terrain];
  const dig = t?.dig > 0 ? t.dig : 1;
  return Math.max(1, Math.floor((SAP.work * 10) / Math.max(1, Math.floor(dig * 10))));
}

// ------------------------------------------------------------------------------------------- Stollen

export function tunnelsOf(state, side) {
  return state?.sides?.[side]?.tunnels ?? [];
}

export function activeTunnel(state, groupId) {
  for (const side of ['a', 'b']) {
    const t = tunnelsOf(state, side).find((x) => x.group === groupId && (x.status === 'digging' || x.status === 'charged'));
    if (t) return t;
  }
  return null;
}

/** Arbeit fuer ein Stollenfeld (100 = eine Runde Schuetzen in Lehm). Kreide geht schneller, Fels langsam. */
export function tunnelCellWork(cell) {
  const t = cell?.terrain;
  if (t === 'wasser') return Infinity;
  return TUNNEL.cellWork[t] ?? TUNNEL.cellWork.lehm;
}

/** Stollen pruefen (rein): null oder deutscher Grund */
export function checkTunnel(map, state, group, path) {
  if (!TUNNEL.diggers.includes(group.type)) return `${unitType(group.type).name} gräbt keine Stollen`;
  if (!Array.isArray(path) || !path.length) return 'Stollen braucht einen Weg';
  if (path.length > TUNNEL.maxCells) return `höchstens ${TUNNEL.maxCells} Felder Stollen`;
  const steps = stepsOk(path);
  if (steps) return steps;
  if (activeTunnel(state, group.id)) return 'die Gruppe gräbt schon einen Stollen';
  if (!map) return null;
  const here = live(map, state, group.pos.x, group.pos.y);
  if (!ownTrench(here, group.side)) return 'Stollen beginnen im eigenen Graben';
  if (distance(group.pos, path[0]) > TUNNEL.reach) return `Stollen beginnt zu weit von der Gruppe (Feld ${cellLabel(path[0].x, path[0].y)})`;
  for (const p of path) {
    const c = live(map, state, p.x, p.y);
    if (!c) return 'Stollen führt aus der Karte';
    if (!Number.isFinite(tunnelCellWork(c))) return `Feld ${cellLabel(p.x, p.y)}: unter Wasser gräbt niemand`;
  }
  return null;
}

/**
 * Arbeitsbudget im Stollen je Stellungsrunde (100 = ein Feld Lehm). Unter Tage zaehlen weder Regen noch Schlamm,
 * nur Einheit (Pioniere doppelt), Staerke, Erschoepfung und Veteranen (Graeber +25 Prozent).
 */
export function tunnelRate(group) {
  const unit = group.type === 'pioneers' ? 200 : 100;
  const size = Math.max(1, group.size ?? group.strength);
  const str = 50 + Math.floor((50 * Math.min(size, group.strength)) / size);
  const tired = 100 - Math.floor(Math.max(0, Math.min(100, group.fatigue ?? 0)) / 2);
  let r = Math.floor((Math.floor((unit * str) / 100) * Math.max(60, tired)) / 100);
  if (Array.isArray(group.traits) && group.traits.includes('graeber')) r = Math.floor((r * 125) / 100);
  return r;
}

/** Vorschau: Runden bis zur Ladung bei Arbeitsbudget rate */
export function tunnelRounds(map, path, rate, from = 0, work = 0) {
  let need = -work;
  for (let i = from; i < path.length; i++) need += tunnelCellWork(cellAt(map, path[i].x, path[i].y));
  if (need <= 0) return 0;
  return rate > 0 ? Math.max(1, Math.floor((need + rate - 1) / rate)) : Infinity;
}

/** Kopf des Stollens (letztes gegrabenes Feld) oder null */
export function tunnelHead(t) {
  return t.dug > 0 ? t.path[t.dug - 1] : null;
}

/** Gegrabene Felder */
export function dugCells(t) {
  return t.path.slice(0, t.dug);
}

/** Horchradius einer Gruppe (Horchposten, Bericht Horchgeraet) */
export function listenRadius(state, group) {
  if (group.type !== 'listeners') return LISTEN.troops.radius;
  const t = unitType(group.type);
  const extra = state?.sides?.[group.side]?.reports?.includes?.('horchgeraet') ? LISTEN.reportBonus : 0;
  return (t.listenRadius ?? LISTEN.radius) + extra;
}

/**
 * Chance in Prozent, dass Gruppe g den Stollen t in dieser Runde hoert (0 = ausser Hoerweite).
 * Gehoert wird das naechste gegrabene Feld; Kreide traegt jeden Spaten.
 */
export function listenChance(map, state, g, t, { digging = true, bonus = 0 } = {}) {
  const cells = dugCells(t);
  if (!cells.length) return 0;
  const r = listenRadius(state, g);
  let best = Infinity, at = null;
  for (const c of cells) {
    const d = distance(g.pos, c);
    if (d < best) { best = d; at = c; }
  }
  if (best > r) return 0;
  let p = g.type === 'listeners' ? LISTEN.chance : LISTEN.troops.chance;
  if (map && cellAt(map, at.x, at.y)?.terrain === 'kreide') p += LISTEN.chalk;
  if (g.type === 'listeners' && best * 2 > r) p += LISTEN.far;
  if (digging) p += LISTEN.digging;
  p += bonus;
  return Math.max(5, Math.min(90, p));
}
