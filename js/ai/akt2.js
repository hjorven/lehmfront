// KI-Bausteine fuer Akt 2 (P23): Stollen weitergraben, Gegenstollen auf gehoerte Stollen, Horchposten bleiben,
// Stosstrupps bei Nacht, Sappen und Ziele aus dem Szenario (opts.goals, z. B. fuer den Simulator).
// Rein und deterministisch: arbeitet nur auf der Sicht (view.own enthaelt eigene Stollen und Gehoertes).
//
// opts.goals (optional): { sap: {x,y}, tunnel: {x,y}, raid: {x,y} | true, attack: {x,y}, drain: true, crater: [{x,y}] }
import { registerAiBlock } from './blocks.js';
import { cellAt, cellLabel, distance, enterCost, findPath, lineCells } from '../map.js';
import { checkSap, checkTunnel } from '../underground.js';
import { raidProblem } from '../phases/raid.js';
import { surname } from '../phases/hold.js';
import { ASSAULT_TYPES, MAX_ASSAULT_CELLS } from '../phases/move.js';
import { RAID, SAP, TUNNEL } from '../config/akt2.js';

const nameOf = (g) => 'Gruppe ' + surname(g.leader?.name ?? g.id);
const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
const free = (b, g) => !b.taken.has(g.id) && g.status !== 'lost';

function live(map, view, x, y) {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const s = view.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
}

/** Linie von a nach b als Feldliste ohne a */
function line(a, b) {
  return lineCells(a.x, a.y, b.x, b.y).slice(1).map(([x, y]) => ({ x, y }));
}

// 1. Mineure bleiben am Stolleneingang, Horchposten bleiben im Graben
registerAiBlock({
  id: 'akt2-stay',
  order: 10,
  run(b) {
    if (b.kind !== 'position') return;
    const active = (b.view.own.tunnels ?? []).filter((t) => t.status === 'digging');
    for (const t of active) {
      const g = b.sit.own.find((x) => x.id === t.group);
      if (!g || !free(b, g)) continue;
      b.give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} gräbt am Stollen weiter, ${t.path.length - t.dug} Felder bis zur Ladung.`, 'Stollen: weitergraben');
    }
    for (const g of b.sit.own.filter((x) => x.type === 'listeners' && free(b, x))) {
      const here = live(b.map, b.view, g.pos.x, g.pos.y);
      if (here?.trench?.side === b.sit.ms) b.give(g, { group: g.id, type: 'hold' }, `${nameOf(g)} horcht im Posten bei ${cellLabel(g.pos.x, g.pos.y)}.`, 'Horchposten: horchen');
    }
  },
});

/** Bester Stollenweg einer Gruppe zum Ziel (Ende hoechstens 1 Feld daneben) */
function tunnelPlan(b, g, target) {
  const map = b.map;
  let best = null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const start = { x: g.pos.x + dx, y: g.pos.y + dy };
    if (!cellAt(map, start.x, start.y)) continue;
    const path = [start, ...line(start, target)];
    // Ende neben dem Ziel reicht (Quetschladung wirkt im Umkreis), auf das Ziel selbst ist besser
    const trimmed = path.slice(0, Math.min(path.length, TUNNEL.maxCells));
    if (distance(trimmed[trimmed.length - 1], target) > 1) continue;
    if (checkTunnel(map, b.st, g, trimmed)) continue;
    if (!best || trimmed.length < best.length) best = trimmed;
  }
  return best;
}

// 2. Gegenstollen auf gehoerte Stollen, Stollen auf ein Ziel aus dem Szenario
registerAiBlock({
  id: 'akt2-tunnel',
  order: 20,
  run(b) {
    if (b.kind !== 'position') return;
    const own = b.view.own.tunnels ?? [];
    const busy = own.some((t) => t.status === 'digging' || t.status === 'charged');
    if (busy) return;
    const heard = Object.entries(b.view.own.heard ?? {}).filter(([, h]) => !h.gone && h.cells?.length)
      .sort((p, q) => q[1].turn - p[1].turn || (p[0] < q[0] ? -1 : 1));
    let target = null, why = '';
    if (heard.length) {
      const cells = heard[0][1].cells;
      target = cells[cells.length - 1];
      why = `gehörter Stollen bei ${cellLabel(target.x, target.y)}`;
    } else if (b.opts.goals?.tunnel) {
      target = b.opts.goals.tunnel;
      why = `Ziel ${cellLabel(target.x, target.y)}`;
    }
    if (!target) return;
    const diggers = b.sit.own.filter((g) => TUNNEL.diggers.includes(g.type) && free(b, g) && !g.inDugout)
      .sort((p, q) => (p.type === 'pioneers' ? 0 : 1) - (q.type === 'pioneers' ? 0 : 1) || distance(p.pos, target) - distance(q.pos, target) || byId(p, q));
    for (const g of diggers) {
      if (distance(g.pos, target) > TUNNEL.maxCells) continue;
      const path = tunnelPlan(b, g, target);
      if (!path) continue;
      if (b.give(g, { group: g.id, type: 'tunnel', path }, `${nameOf(g)} beginnt einen Gegenstollen: ${why}, ${path.length} Felder.`, 'Stollen: Gegenstollen')) return;
    }
  },
});

// 3. Stosstrupps bei Nacht
registerAiBlock({
  id: 'akt2-raid',
  order: 40,
  run(b) {
    if (b.kind !== 'position' || !b.view.night) return;
    const raiders = b.sit.own.filter((g) => RAID.raiders.includes(g.type) && free(b, g) && g.strength * 2 >= (g.size ?? g.strength) && (g.morale ?? 70) >= 35);
    if (!raiders.length) return;
    const eager = b.doc.id === 'nacht' || !!b.opts.goals?.raid;
    for (const g of raiders.sort(byId)) {
      if (!eager && b.rng() < 0.5) continue;
      const goal = b.opts.goals?.raid && b.opts.goals.raid !== true ? b.opts.goals.raid : null;
      const cands = [];
      if (goal) cands.push(goal);
      for (const k of b.sit.known.slice().sort((p, q) => distance(p.pos, g.pos) - distance(q.pos, g.pos) || (p.id < q.id ? -1 : 1))) cands.push(k.pos);
      // Ohne Wissen: der naechste feindliche Graben vor der Gruppe
      for (const t of b.sit.foeTrench.filter((c) => c.home).sort((p, q) => distance(p, g.pos) - distance(q, g.pos) || p.y - q.y || p.x - q.x).slice(0, 4)) cands.push(t);
      for (const c of cands) {
        if (raidProblem(b.map, b.st, g, c)) continue;
        if (b.give(g, { group: g.id, type: 'raid', target: { x: c.x, y: c.y } }, `${nameOf(g)} geht heute Nacht auf Stoßtrupp nach ${cellLabel(c.x, c.y)}: Gefangene und Papiere.`, 'Stoßtrupp bei Nacht')) break;
      }
    }
  },
});

// 4. Sappe auf ein Ziel, Entwaessern, Trichterrand ausbauen (Szenarioziele)
registerAiBlock({
  id: 'akt2-goals',
  order: 50,
  run(b) {
    const goals = b.opts.goals;
    if (!goals || b.kind !== 'position') return;
    if (goals.drain) {
      for (const g of b.sit.own.filter((x) => free(b, x)).sort(byId)) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const p = { x: g.pos.x + dx, y: g.pos.y + dy };
          const c = live(b.map, b.view, p.x, p.y);
          if (!c?.trench || !(c.water > 0) || c.drain) continue;
          if (!b.taken.has(g.id)) b.give(g, { group: g.id, type: 'drain', target: p }, `${nameOf(g)} legt Lattenroste bei ${cellLabel(p.x, p.y)}.`, 'Entwässern');
        }
      }
    }
    if (goals.sap) {
      const t = goals.sap;
      const head = live(b.map, b.view, t.x, t.y);
      if (!(head?.trench?.side === b.sit.ms)) {
        const diggers = b.sit.own.filter((g) => SAP.diggers.includes(g.type) && free(b, g))
          .sort((p, q) => (p.type === 'pioneers' ? 0 : 1) - (q.type === 'pioneers' ? 0 : 1) || distance(p.pos, t) - distance(q.pos, t) || byId(p, q));
        for (const g of diggers) {
          const path = line(g.pos, t).filter((p) => live(b.map, b.view, p.x, p.y)?.trench?.side !== b.sit.ms).slice(0, SAP.maxCells);
          if (!path.length || checkSap(b.map, b.st, g, path)) continue;
          if (b.give(g, { group: g.id, type: 'sap', path }, `${nameOf(g)} treibt die Sappe auf ${cellLabel(t.x, t.y)} vor.`, 'Sappe vortreiben')) break;
        }
      }
    }
    if (Array.isArray(goals.crater) && goals.crater.length) {
      // Im Trichter: Rand zur Feuerstellung ausbauen
      for (const g of b.sit.own.filter((x) => free(b, x) && SAP.diggers.includes(x.type)).sort(byId)) {
        const open = goals.crater.filter((p) => distance(p, g.pos) <= 1 && live(b.map, b.view, p.x, p.y)?.trench?.side !== b.sit.ms);
        if (!open.length || !goals.crater.some((p) => p.x === g.pos.x && p.y === g.pos.y)) continue;
        const path = [open[0]];
        if (!checkSap(b.map, b.st, g, path)) b.give(g, { group: g.id, type: 'sap', path }, `${nameOf(g)} baut den Trichterrand bei ${cellLabel(open[0].x, open[0].y)} zur Feuerstellung um.`, 'Trichterrand ausbauen');
      }
    }
  },
});

// 5. Angriff auf ein Ziel aus dem Szenario (Simulator: a2m5, a2m6)
registerAiBlock({
  id: 'akt2-attack',
  order: 60,
  run(b) {
    const t = b.opts.goals?.attack;
    if (!t) return;
    const there = b.sit.own.some((g) => distance(g.pos, t) <= 1);
    const cost = (c) => {
      const lc = live(b.map, b.view, c.x, c.y);
      return lc ? enterCost({ ...lc, wire: lc.wire?.side === b.sit.ms ? null : lc.wire }) : Infinity;
    };
    const fighters = b.sit.own.filter((g) => ASSAULT_TYPES.has(g.type) && free(b, g) && g.strength * 10 >= (g.size ?? 1) * 4)
      .sort((p, q) => distance(p.pos, t) - distance(q.pos, t) || byId(p, q)).slice(0, 3);
    for (const g of fighters) {
      if (distance(g.pos, t) <= 1) continue;
      if (there && b.kind === 'position') continue;
      const r = findPath(b.map, g.pos, t, { cost, maxNodes: 20000 });
      const path = r?.path.slice(1);
      if (!path?.length || path.length > MAX_ASSAULT_CELLS) continue;
      const type = b.kind === 'battle' ? 'assault' : 'attack';
      b.give(g, { group: g.id, type, path }, `${nameOf(g)} ${type === 'attack' ? 'setzt zum Angriff' : 'stürmt weiter'} auf ${cellLabel(t.x, t.y)} an.`, 'Szenario: Angriff aufs Ziel');
    }
  },
});
