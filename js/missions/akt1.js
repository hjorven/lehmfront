// Akt 1 "Erstarrung" (P16, Plan 8.1): Missionsziele der sechs Missionen. Rein: kein DOM, kein Date, kein Math.random.
// Szenarien und Ablaufplaene stehen in data/missions/akt1-m*.json, Karten in data/maps/akt1-m*.json
// (tools/maps/akt1.mjs), Texte in data/texts/akt1.json und data/texts/tutorial.json.
//
// Jede Mission meldet ihr Ziel mit registerMissionJudge an (js/campaign.js). goalLines() liefert dieselbe Pruefung als
// Zeilen fuer den Auftragszettel im Gefecht (js/ui/mission-hints.js), damit Anzeige und Wertung nie auseinanderlaufen.
import { registerMissionJudge } from '../campaign.js';
import {
  positionRounds, lineStatus, trenchesLost, heldCells, groupsAt, eventsOf, figureFallen,
} from './goals.js';
import { sectionsOf, frontGroups } from '../supply.js';
import { UPKEEP } from '../config/supply.js';

/** Feste Orte und Fristen der Missionen (Felder 0-basiert, Stellungsrunden) */
export const AKT1 = {
  a1m1: { line: { y0: 9, y1: 31, minLevel: 2, xMin: 15, xMax: 28 }, rounds: 4 },
  a1m2: { rounds: 4 },
  a1m3: { rounds: 5, ammoRounds: 6, depotEmpty: 2 },
  a1m4: { rounds: 4, target: 'nest', silent: 2 },
  a1m5: { rounds: 5, fit: 30, kuhle: [{ x: 24, y: 24 }, { x: 24, y: 25 }, { x: 24, y: 26 }, { x: 24, y: 27 }] },
  a1m6: { rounds: 8, tolerate: 0, harms: 'Otto Harms' },
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const inBattle = (state) => state.turnKind === 'battle';

// ---------------------------------------------------------------- Mission 1: Der erste Spatenstich

function m1(ctx) {
  const cfg = AKT1.a1m1;
  const st = ctx.map ? lineStatus(ctx.map, ctx.state, ctx.side, cfg.line) : null;
  const played = positionRounds(ctx.rounds);
  return { st, played, cfg };
}

registerMissionJudge('a1m1', (ctx) => {
  const { st, played, cfg } = m1(ctx);
  if (!st) return null;
  if (st.done) return { outcome: 'sieg', orderMet: true, why: 'Linie Mühle bis Krähenholz steht' };
  if (played >= cfg.rounds && !inBattle(ctx.state)) {
    return { outcome: 'niederlage', orderMet: false, why: `Linie bis Tag 3 früh nicht fertig (${plural(st.missing.length, 'Lücke', 'Lücken')})` };
  }
  if (ctx.final) return { outcome: 'niederlage', orderMet: false, why: `Linie hat noch ${plural(st.missing.length, 'Lücke', 'Lücken')}` };
  return null;
});

// ---------------------------------------------------------------- Mission 2: Die Weide

registerMissionJudge('a1m2', (ctx) => {
  const cfg = AKT1.a1m2;
  if (!ctx.map || inBattle(ctx.state)) return ctx.final ? { outcome: 'niederlage', orderMet: false, why: 'Mitten im Gefecht gemeldet' } : null;
  const lost = trenchesLost(ctx.map, ctx.state, ctx.side);
  const played = positionRounds(ctx.rounds);
  if (played >= cfg.rounds) {
    return lost.length
      ? { outcome: 'niederlage', orderMet: false, why: `${plural(lost.length, 'Grabenfeld', 'Grabenfelder')} an Morrow verloren` }
      : { outcome: 'sieg', orderMet: true, why: 'Die Weide gehalten, kein Fußbreit zurück' };
  }
  if (ctx.final) return { outcome: 'niederlage', orderMet: false, why: `Vor Tag 6 gemeldet: Halten zählt erst nach ${cfg.rounds} Stellungsrunden` };
  return null;
});

// ---------------------------------------------------------------- Mission 3: Zwoelf Loren

/** Munition vorn je Abschnitt mit Gruppen: { rows: [{ id, label, ammo, need, ok }], ok } */
export function ammoStatus(map, state, side, ammoRounds = AKT1.a1m3.ammoRounds) {
  const supply = state.sides?.[side]?.supply;
  const rows = [];
  for (const sec of sectionsOf(map)) {
    const groups = frontGroups(map, state, side, sec).length;
    // Wer Gruppen nach hinten zieht, spart sich die Munition nicht: jeder Abschnitt braucht mindestens eine Gruppe
    const need = Math.max(1, groups) * UPKEEP.ammo * ammoRounds;
    const ammo = supply?.sections?.[sec.id]?.ammo ?? 0;
    rows.push({ id: sec.id, label: sec.label ?? sec.id, ammo, need, ok: ammo >= need });
  }
  return { rows, ok: rows.length > 0 && rows.every((r) => r.ok) };
}

registerMissionJudge('a1m3', (ctx) => {
  const cfg = AKT1.a1m3;
  if (!ctx.map) return null;
  const empty = eventsOf(ctx.rounds, ctx.side, 'depot_empty').length;
  const played = positionRounds(ctx.rounds);
  if (empty > cfg.depotEmpty) return { outcome: 'niederlage', orderMet: false, why: `Das Depot ist ${empty}-mal leer gelaufen` };
  if (played >= cfg.rounds && !inBattle(ctx.state)) {
    const a = ammoStatus(ctx.map, ctx.state, ctx.side);
    const short = a.rows.filter((r) => !r.ok).map((r) => r.id);
    return a.ok
      ? { outcome: 'sieg', orderMet: true, why: 'Munition vorn für drei Tage, das Depot hat gehalten' }
      : { outcome: 'niederlage', orderMet: false, why: `Abschnitt ${short.join(', ')} hat keine drei Tage Munition` };
  }
  if (ctx.final) return { outcome: 'niederlage', orderMet: false, why: 'Verbrauch gemeldet, bevor der Vorrat vorn steht' };
  return null;
});

// ---------------------------------------------------------------- Mission 4: Der Turm von Ostervenn

/** MG-Nest vor dem Heuwagen: { group, silent, strength } */
export function nestStatus(state, cfg = AKT1.a1m4) {
  const g = state.groups.find((x) => x.id === cfg.target) ?? null;
  const silent = !g || g.status === 'lost' || g.strength <= cfg.silent;
  return { group: g, silent, strength: g && g.status !== 'lost' ? g.strength : 0 };
}

registerMissionJudge('a1m4', (ctx) => {
  const cfg = AKT1.a1m4;
  const n = nestStatus(ctx.state, cfg);
  if (n.silent) return { outcome: 'sieg', orderMet: true, why: 'Das MG vor dem Heuwagen schweigt' };
  const played = positionRounds(ctx.rounds);
  if (played >= cfg.rounds && !inBattle(ctx.state)) return { outcome: 'niederlage', orderMet: false, why: `Das MG vor dem Heuwagen schießt noch (${n.strength} Mann)` };
  if (ctx.final) return { outcome: 'niederlage', orderMet: false, why: 'Gemeldet, solange das MG noch schießt' };
  return null;
});

// ---------------------------------------------------------------- Mission 5: Gewitter

export function kuhleStatus(map, state, side, cfg = AKT1.a1m5) {
  const held = heldCells(map, state, side, cfg.kuhle).length;
  const there = groupsAt(state, side, cfg.kuhle, 0);
  const men = there.filter((g) => g.morale >= cfg.fit).length;
  return { held, total: cfg.kuhle.length, men, worn: there.length - men, ok: held === cfg.kuhle.length && men > 0 };
}

registerMissionJudge('a1m5', (ctx) => {
  const cfg = AKT1.a1m5;
  if (!ctx.map || inBattle(ctx.state)) return ctx.final ? { outcome: 'niederlage', orderMet: false, why: 'Mitten im Gefecht gemeldet' } : null;
  const k = kuhleStatus(ctx.map, ctx.state, ctx.side, cfg);
  const played = positionRounds(ctx.rounds);
  if (played >= cfg.rounds || ctx.final) {
    if (k.ok && played >= cfg.rounds) return { outcome: 'sieg', orderMet: true, why: 'Die Lehmkuhle ist gehalten, bis der Regen aufhört' };
    if (k.held < k.total) return { outcome: 'niederlage', orderMet: false, why: 'Die Lehmkuhle ist verloren' };
    if (!k.men && k.worn) return { outcome: 'niederlage', orderMet: false, why: 'Die Leute in der Lehmkuhle sind am Ende, niemand löste sie ab' };
    if (!k.men) return { outcome: 'niederlage', orderMet: false, why: 'Niemand mehr in der Lehmkuhle' };
    return { outcome: 'niederlage', orderMet: false, why: `Vor dem Ende des Regens gemeldet (${cfg.rounds} Stellungsrunden)` };
  }
  return null;
});

// ---------------------------------------------------------------- Mission 6: Die Welle

registerMissionJudge('a1m6', (ctx) => {
  const cfg = AKT1.a1m6;
  const flags = figureFallen(ctx.state, ctx.rounds, cfg.harms) ? ['harms_gefallen'] : [];
  if (!ctx.map || inBattle(ctx.state)) return ctx.final ? { outcome: 'niederlage', orderMet: false, why: 'Mitten im Gefecht gemeldet', flags: [...flags, 'velde_verloren'] } : null;
  const lost = trenchesLost(ctx.map, ctx.state, ctx.side).length;
  const played = positionRounds(ctx.rounds);
  if (played >= cfg.rounds || ctx.final) {
    if (played >= cfg.rounds && lost <= cfg.tolerate) {
      return {
        outcome: 'sieg', orderMet: lost === 0, flags,
        why: lost ? `Bis zur Ablösung gehalten, ${plural(lost, 'Grabenfeld bleibt', 'Grabenfelder bleiben')} drüben` : 'Bis zur Ablösung gehalten, kein Graben verloren',
      };
    }
    return {
      outcome: 'niederlage', orderMet: false, flags: [...flags, 'velde_verloren'],
      why: played < cfg.rounds ? `Vor der Ablösung gemeldet (Tag 28)` : `${plural(lost, 'Grabenfeld', 'Grabenfelder')} in Morrows Hand, Velde fällt`,
    };
  }
  return null;
});

// ---------------------------------------------------------------- Auftragszettel

/**
 * Zeilen fuer den Auftragszettel im Gefecht: [{ text, done, warn? }]. Dieselben Pruefungen wie die Wertung.
 * ctx: { mission, state, rounds, side, map }
 */
export function goalLines({ mission, state, rounds, side = 'a', map }) {
  const played = positionRounds(rounds);
  const left = (n) => Math.max(0, n - played);
  const due = (n) => (left(n) ? `noch ${plural(left(n), 'Stellungsrunde', 'Stellungsrunden')}` : 'Frist erreicht');
  switch (mission) {
    case 'a1m1': {
      const cfg = AKT1.a1m1;
      const st = lineStatus(map, state, side, cfg.line);
      return [
        { text: `Linie Mühle bis Krähenholz: ${st.rows} von ${st.need} Reihen`, done: st.done },
        { text: `Frist Tag 3 früh: ${due(cfg.rounds)}`, done: st.done, warn: !st.done && left(cfg.rounds) <= 1 },
      ];
    }
    case 'a1m2': {
      const cfg = AKT1.a1m2;
      const lost = trenchesLost(map, state, side).length;
      return [
        { text: lost ? `${plural(lost, 'Grabenfeld', 'Grabenfelder')} verloren: zurücknehmen` : 'Kein Grabenfeld verloren', done: !lost, warn: !!lost },
        { text: `Halten bis Tag 6: ${due(cfg.rounds)}`, done: played >= cfg.rounds && !lost },
      ];
    }
    case 'a1m3': {
      const cfg = AKT1.a1m3;
      const a = ammoStatus(map, state, side);
      const empty = eventsOf(rounds, side, 'depot_empty').length;
      return [
        ...a.rows.map((r) => ({ text: `Abschnitt ${r.id}: Munition ${r.ammo} von ${r.need}`, done: r.ok })),
        { text: empty ? `Depot ${empty}-mal leer (höchstens ${cfg.depotEmpty})` : 'Depot nie leer', done: !empty, warn: empty >= cfg.depotEmpty },
        { text: `Frist Tag 11 abends: ${due(cfg.rounds)}`, done: false },
      ];
    }
    case 'a1m4': {
      const cfg = AKT1.a1m4;
      const n = nestStatus(state, cfg);
      return [
        { text: n.silent ? 'MG vor dem Heuwagen schweigt' : 'MG vor dem Heuwagen ausschalten', done: n.silent },
        { text: `Frist Tag 16 früh: ${due(cfg.rounds)}`, done: n.silent, warn: !n.silent && left(cfg.rounds) <= 1 },
      ];
    }
    case 'a1m5': {
      const cfg = AKT1.a1m5;
      const k = kuhleStatus(map, state, side, cfg);
      return [
        { text: `Lehmkuhle: ${k.held} von ${k.total} Feldern, ${k.men ? plural(k.men, 'frische Gruppe', 'frische Gruppen') + ' darin' : k.worn ? 'nur noch Erschöpfte darin' : 'niemand darin'}`, done: k.ok, warn: !k.ok },
        { text: `Halten bis der Regen aufhört: ${due(cfg.rounds)}`, done: played >= cfg.rounds && k.ok },
      ];
    }
    case 'a1m6': {
      const cfg = AKT1.a1m6;
      const lost = trenchesLost(map, state, side).length;
      return [
        { text: lost ? `${plural(lost, 'Grabenfeld', 'Grabenfelder')} in Morrows Hand: zurücknehmen` : 'Kein Graben verloren', done: !lost, warn: lost > cfg.tolerate },
        { text: `Bis zur Ablösung (Tag 28): ${due(cfg.rounds)}`, done: played >= cfg.rounds && lost <= cfg.tolerate },
      ];
    }
    default: return [];
  }
}
