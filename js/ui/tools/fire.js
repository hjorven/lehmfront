// Werkzeug Feuern (Taste F, Plan 7.4, 7.6). Gewehre, Moerser und andere: Ziel waehlen (nur Gefechtsrunden).
// MG-Trupps: Feuersektor ausrichten (beide Rundenarten), das MG bestreicht dann seinen Kegel von selbst.
// Vorschau vor dem Befehl: Sichtlinie, Trefferchance, Deckung, erwartete Verluste.
import { registerTool } from '../tools.js';
import { cellLabel, distance } from '../../map.js';
import { unitType } from '../../config/units.js';
import { viewFor } from '../../view.js';
import { fireOdds, canFire, BLIND } from '../../phases/fire.js';
import { sectorOf, inCone, directionOf, darknessOf } from '../../sight.js';
import { groupName } from '../labels.js';
import { ageText } from '../../render/fire-layer.js';

const pct = (p) => `${Math.round(p * 100)} %`;

/** Erwartete Verluste als Satz: "etwa 1 bis 2 Verluste" */
export function lossesText(expected) {
  if (expected < 0.35) return 'kaum Verluste, aber hält nieder';
  const lo = Math.floor(expected), hi = Math.ceil(expected);
  if (expected - lo < 0.2 || lo === hi) return `etwa ${Math.max(1, lo)} ${Math.max(1, lo) === 1 ? 'Verlust' : 'Verluste'}`;
  return `etwa ${Math.max(1, lo)} bis ${hi} Verluste`;
}

/**
 * Vorschau fuer ein Zielfeld (rein): { ok, text, sight, fire, target, odds }.
 * Sucht auf dem Feld eine sichtbare Gruppe oder einen Geist; auf leeres Feld wird nicht geschossen.
 */
export function firePreview(map, state, group, cell) {
  const side = group.side;
  const v = viewFor(state, [], side, { map });
  const foe = v.groups.find((g) => g.side !== side && g.pos.x === cell.x && g.pos.y === cell.y);
  const ghost = foe ? null : v.ghosts.find((g) => g.pos.x === cell.x && g.pos.y === cell.y);
  const odds = fireOdds(state, map, group, cell, foe?.side ?? (side === 'a' ? 'b' : 'a'), { darkness: darknessOf(state) });
  const sight = { from: group.pos, to: { x: cell.x, y: cell.y }, blockedAt: odds.los?.blockedAt ?? null, label: '' };
  const where = cellLabel(cell.x, cell.y);
  if (!odds.ok) {
    sight.label = odds.los && !odds.los.visible ? 'kein Schussfeld' : '';
    return { ok: false, text: `${where}: ${odds.why}`, sight, fire: null, odds };
  }
  if (!foe && !ghost) {
    return { ok: false, text: `${where}: dort ist kein Feind zu sehen`, sight, fire: null, odds };
  }
  sight.label = `${pct(odds.p)}`;
  if (!foe) {
    const p = odds.p * BLIND;
    return {
      ok: true, sight: { ...sight, label: `${pct(p)}?` }, fire: { x: cell.x, y: cell.y }, odds, target: ghost,
      text: `Feuer auf Verdacht nach ${where} (${ageText(ghost.age)} gesehen)\nOhne Sicht nur ${pct(p)} je Schuss, falls noch jemand dort liegt\n${odds.shots} Schuss · Wirkung nicht zu erkennen`,
    };
  }
  const who = `Feind bei ${where}`;
  const extra = odds.enfilade ? ' · Längsfeuer!' : odds.indirect ? ' · Steilfeuer' : '';
  const text = `${who}\nTreffer je Schuss ${pct(odds.p)} · Deckung: ${odds.coverLabel}${extra}\n${odds.shots} Schuss · ${lossesText(odds.expected)}`;
  return { ok: true, text, sight, fire: { x: cell.x, y: cell.y }, odds, target: foe };
}

/** Vorschau fuer einen MG-Sektor (rein): { ok, text, cone } */
export function sectorPreview(map, state, group, cell) {
  if (cell.x === group.pos.x && cell.y === group.pos.y) return { ok: false, text: 'Richtung wählen, nicht das eigene Feld', cone: null };
  const t = unitType(group.type);
  const aim = { x: cell.x, y: cell.y };
  const sec = sectorOf({ ...group, sector: aim });
  const v = viewFor(state, [], group.side, { map });
  const inside = [...v.groups.filter((g) => g.side !== group.side), ...v.ghosts]
    .filter((g) => inCone(group.pos, sec.aim, g.pos, sec.width, t.range));
  const dir = directionOf(group.pos, aim);
  let text = `Feuersektor nach ${dir ? dir.name : 'vorn'} · ${sec.width} Grad · ${t.range} Felder`;
  if (inside.length) {
    const near = inside.map((g) => ({ g, d: distance(group.pos, g.pos) })).sort((a, b) => a.d - b.d)[0].g;
    const odds = fireOdds(state, map, group, near.pos, near.side, { darkness: darknessOf(state) });
    text += `\n${inside.length === 1 ? 'Ein Ziel' : `${inside.length} Ziele`} im Kegel`;
    if (odds.ok) text += ` · nächstes: ${pct(odds.p)} je Schuss, ${lossesText(odds.expected)}`;
  } else {
    text += '\nIm Kegel ist niemand zu sehen. Das MG wartet.';
  }
  return { ok: true, text, cone: { aim, width: sec.width, range: t.range } };
}

registerTool({
  id: 'fire',
  key: 'f',
  label: 'Feuern',
  order: 40,
  icon: '<circle cx="12" cy="12" r="6"/><path d="M12 3 V8"/><path d="M12 16 V21"/><path d="M3 12 H8"/><path d="M16 12 H21"/>',
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    const t = unitType(group.type);
    if (!canFire(group)) return `${t.name} feuern nicht`;
    if (t.sector) return true;
    if (state.turnKind !== 'battle') return 'Feuern geht nur in Gefechtsrunden';
    if (group.inDugout) return 'Gruppe sitzt im Unterstand';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    const t = unitType(group.type);
    if (t.sector) {
      ctx.pickCell({
        title: 'Feuersektor',
        hint: `Feuersektor: Richtung für ${groupName(state, group)} antippen. Das MG bestreicht den Kegel von selbst.`,
        preview: (cell) => (cell ? sectorPreview(map, state, group, cell) : null),
        pick(cell) {
          const p = cell ? sectorPreview(map, state, group, cell) : null;
          if (!p?.ok) { ctx.hint(p?.text ?? 'Keine Richtung.'); return false; }
          ctx.setOrder({ group: group.id, type: 'sector', target: { x: cell.x, y: cell.y } });
          return true;
        },
      });
      return;
    }
    ctx.pickCell({
      title: 'Feuern',
      hint: `Feuern: Ziel für ${groupName(state, group)} antippen. Gezeigt werden Sichtlinie, Trefferchance und erwartete Verluste.`,
      preview: (cell) => (cell ? firePreview(map, state, group, cell) : null),
      pick(cell) {
        const p = cell ? firePreview(map, state, group, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder({ group: group.id, type: 'fire', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});
