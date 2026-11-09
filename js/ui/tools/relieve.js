// Werkzeug Ablösen (Taste R), P12, mit Auffüllen. Dazu Bleistiftvermerke an den Einheiten und der Pruefpunkt
// "zu lange vorn" vor dem Rundenende.
//
// Ablösen, Gruppe vorn gewaehlt: eine eigene Gruppe aus Reserve oder Ruhelager antippen (sie uebernimmt das Feld)
//   oder ein Feld in der eigenen Etappe (die Gruppe geht ohne Ablösung, das Feld bleibt leer).
// Ablösen, Gruppe hinten gewaehlt: die Gruppe vorn antippen, die abgeloest werden soll. Der Befehl gehoert dann der
//   Gruppe vorn ({ group: vorn, type: 'relieve', by: hinten }).
// Auffüllen: Gruppe hinten gewaehlt, sich selbst antippen ({ group, type: 'refill' }), mit Vorschau
//   "+5 Mann, Erfahrung 3 -> 1". Unterbesetzt lassen haelt die Erfahrung.
import { registerTool } from '../tools.js';
import { registerCheck } from '../summary.js';
import { registerDecor } from '../../render/decor.js';
import { unitBox } from '../../render/units-layer.js';
import { FONTS } from '../../render/map-layer.js';
import { cellLabel } from '../../map.js';
import { getGroup, groupsOf } from '../../state.js';
import { postOf, unitNote, refillPreview, isTooLong, restRoundsLeft, fatigueRecovery, restCamps, surname } from '../../morale.js';
import { replacementStock, greenXp } from '../../phases/morale.js';
import { LONG_FRONT, TOO_LONG } from '../../config/morale.js';
import { groupName, plural } from '../labels.js';

const POST_WORDS = { front: 'vorn', reserve: 'Reserve', rest: 'Ruhelager' };

/** Erholung je Runde fuer eine ruhende Gruppe (fuer "noch 2 Runden") */
export function restRate(state, side) {
  const camp = restCamps(state, side).length > 0;
  return fatigueRecovery('rest', { erholung: state.sides[side]?.etappe?.yield?.erholung ?? 0, camp });
}

/** Zeilen fuer das Schild (P12): Posten, Runden vorn, Ruhe */
export function moraleRows(map, state, g) {
  const post = postOf(map, g);
  if (post === 'lost') return [];
  const rows = [];
  if (post === 'front') {
    const n = g.frontTurns ?? 0;
    const warn = n >= TOO_LONG;
    rows.push({ label: 'Posten', value: n ? `vorn seit ${plural(n, 'Runde', 'Runden')}` : 'vorn', warn });
    if (warn) rows.push({ label: 'Ablösung', value: 'zu lange vorn', warn: true });
  } else if (post === 'rest') {
    const left = restRoundsLeft(g.fatigue ?? 0, restRate(state, g.side));
    rows.push({ label: 'Posten', value: left ? `ruht, noch ${plural(left, 'Runde', 'Runden')}` : 'ruht, ausgeruht' });
  } else {
    rows.push({ label: 'Posten', value: 'Reserve' });
  }
  if (g.leaderFell?.turns > 0) rows.push({ label: 'Gruppenführer', value: `${surname(g.leaderFell.name)} gefallen`, warn: true });
  return rows;
}

/** Kurzer Vermerk fuer die Befehlsliste: "zu lange vorn", "seit 5 Runden vorn", "ruht" */
export function listNote(map, state, g) {
  const post = postOf(map, g);
  if (post === 'front' && isTooLong(g)) return { text: `zu lange vorn (${g.frontTurns})`, warn: true };
  if (post === 'front' && (g.frontTurns ?? 0) >= LONG_FRONT) return { text: `seit ${g.frontTurns} Runden vorn`, warn: false };
  if (post === 'rest') return { text: 'ruht', warn: false };
  return null;
}

function canRelieve(group, state, env) {
  if (group.status === 'lost') return 'Gruppe ist aufgerieben';
  if (state.turnKind === 'battle') return 'Ablösen geht nur in Stellungsrunden';
  const map = env.map;
  if (!map) return true;
  const post = postOf(map, group);
  const others = groupsOf(state, group.side).filter((g) => g.id !== group.id);
  if (post === 'front') return true;
  if (group.strength < group.size) return true;
  if (!others.some((g) => postOf(map, g) === 'front')) return 'Vorn steht keine Gruppe, die abgelöst werden kann';
  return true;
}

/** Vorschau Auffüllen fuer eine Gruppe (rein) */
export function refillInfo(state, g) {
  return refillPreview(g, { ...replacementStock(state, g.side, { incoming: true }), greenXp: greenXp(state, g.side) });
}

function refillText(state, g, p) {
  const xp = p.experience < g.experience ? `, Erfahrung ${g.experience} → ${p.experience}` : '';
  return `+${p.total} Mann${p.green ? ` (${p.green} grün)` : ''}${xp}`;
}

function relievePreview(map, state, group, cell) {
  if (!cell) return null;
  const camp = restCamps(state, group.side).length ? 'ins Ruhelager' : 'in die Scheunen hinter dem Depot';
  const at = cellLabel(cell.x, cell.y);
  const post = postOf(map, group);
  const other = state.groups.find((g) => g.status !== 'lost' && g.side === group.side && g.id !== group.id && g.pos.x === cell.x && g.pos.y === cell.y);
  if (post === 'front') {
    if (other) {
      const op = postOf(map, other);
      if (op === 'front') return { ok: false, text: `${groupName(state, other)} steht selbst vorn` };
      const tired = (other.fatigue ?? 0) >= 50 ? ', noch müde' : '';
      return {
        ok: true, path: [{ x: cell.x, y: cell.y }], reach: 1, order: { group: group.id, type: 'relieve', by: other.id },
        text: `${groupName(state, other)} (${POST_WORDS[op]}${tired}) löst ${groupName(state, group)} ab · ${camp}`,
      };
    }
    const c = map.cells[cell.y * map.width + cell.x];
    const own = c && c.zone === 'etappe' && c.side === (group.side === 'a' ? 'own' : 'enemy');
    if (!own) return { ok: false, text: `${at}: eine Gruppe aus Reserve oder Ruhelager antippen, oder ein Feld der Etappe (ohne Ablösung)` };
    return {
      ok: true, path: [{ x: cell.x, y: cell.y }], reach: 1, order: { group: group.id, type: 'relieve' },
      text: `${groupName(state, group)} geht ohne Ablösung ${camp} · das Feld bleibt leer`,
    };
  }
  if (cell.x === group.pos.x && cell.y === group.pos.y) {
    if (group.strength >= group.size) return { ok: false, text: `${groupName(state, group)} ist vollzählig` };
    const p = refillInfo(state, group);
    if (!p.total) return { ok: false, text: `${groupName(state, group)}: kein Ersatz im Depot` };
    return { ok: true, order: { group: group.id, type: 'refill' }, text: `Auffüllen: ${refillText(state, group, p)}` };
  }
  if (!other) return { ok: false, text: `${at}: die Gruppe vorn antippen, die abgelöst werden soll, oder die eigene zum Auffüllen` };
  if (postOf(map, other) !== 'front') return { ok: false, text: `${groupName(state, other)} steht nicht vorn` };
  const turns = other.frontTurns ?? 0;
  return {
    ok: true, path: [{ x: cell.x, y: cell.y }], reach: 1, order: { group: other.id, type: 'relieve', by: group.id },
    text: `${groupName(state, group)} löst ${groupName(state, other)} ab${turns ? ` (seit ${plural(turns, 'Runde', 'Runden')} vorn)` : ''}`,
  };
}

registerTool({
  id: 'relieve',
  key: 'r',
  label: 'Ablösen',
  order: 72,
  icon: '<path d="M5 8 H17"/><path d="M14 5 L17 8 L14 11"/><path d="M19 16 H7"/><path d="M10 13 L7 16 L10 19"/>',
  shown: (state) => state.turnKind !== 'battle',
  orderTypes: ['relieve', 'refill'],
  describe(o, g, state) {
    if (o.type === 'refill') {
      const p = refillInfo(state, g);
      return p.total ? `Auffüllen: ${refillText(state, g, p)}` : 'Auffüllen, sobald Ersatz da ist';
    }
    const r = o.by ? getGroup(state, o.by) : null;
    return r ? `Ablösen durch ${groupName(state, r)}` : 'Ablösen ohne Ersatz, Feld bleibt leer';
  },
  canUse: canRelieve,
  begin(ctx) {
    const { group, state, map } = ctx;
    const front = postOf(map, group) === 'front';
    ctx.pickCell({
      title: 'Ablösen',
      hint: front
        ? `Wer übernimmt das Feld der ${groupName(state, group)}? Eine Gruppe aus Reserve oder Ruhelager antippen. Ein Feld der Etappe: ohne Ablösung.`
        : `Welche Gruppe vorn soll die ${groupName(state, group)} ablösen? Antippen. Die ${groupName(state, group)} selbst antippen: auffüllen.`,
      preview: (cell) => relievePreview(map, state, group, cell),
      pick(cell) {
        const p = relievePreview(map, state, group, cell);
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setOrder(p.order);
        if (p.order.type === 'refill') {
          const r = refillInfo(state, group);
          if (r.green && r.experience < group.experience) ctx.hint(`${groupName(state, group)}: ${r.green} Mann Ersatz, grün. Erfahrung ${group.experience} → ${r.experience}. Unterbesetzt lassen hält die Erfahrung.`);
        }
        return true;
      },
    });
  },
});


// ------------------------------------------------------------------ Pruefpunkt

registerCheck('abloesung', ({ state, side, orders, map }) => {
  if (!map || state.turnKind === 'battle') return [];
  const relieving = new Set(orders.filter((o) => o.type === 'relieve').map((o) => o.group));
  return groupsOf(state, side)
    .filter((g) => postOf(map, g) === 'front' && isTooLong(g) && !relieving.has(g.id))
    .map((g) => ({ tone: 'warn', text: `${groupName(state, g)} zu lange vorn (${plural(g.frontTurns, 'Runde', 'Runden')}), Ablösen mit R`, group: g.id, at: g.pos }));
});

// ------------------------------------------------------------------ Bleistiftvermerke (Ueberraschung)

registerDecor({
  id: 'morale-notes',
  order: 90,
  draw(ctx, d) {
    const { state, side, theme: th, px, cam } = d;
    if (!state || !d.map || !d.groups?.length) return;
    if (cam.zoom < 11) return; // weit herausgezoomt: keine Notizen, die Karte bleibt lesbar
    const box = unitBox(cam);
    const rate = restRate(state, side);
    const size = Math.max(12, Math.min(17, cam.zoom * 0.62));
    for (const v of d.groups) {
      if (v.side !== side || v.status === 'lost') continue;
      const g = getGroup(state, v.id);
      if (!g) continue;
      const note = unitNote(d.map, g, { recovery: rate });
      if (!note) continue;
      const x = g.pos.x + 0.5 + box.w / 2 + 14 * px; // hinter dem Bleistift-Fragezeichen der Gruppen ohne Befehl
      let y = g.pos.y + 0.5 - box.h / 2 + 2 * px;
      ctx.save();
      ctx.font = `600 ${size * px}px ${FONTS.hand}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const ink = note.tone === 'warn' ? th.danger : th.pencil;
      // Leichter Papiergrund, damit der Bleistift auf Schraffuren lesbar bleibt
      const lines = note.strike ? [note.strike, note.text] : [note.text];
      const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 6 * px;
      const h = lines.length * size * 1.05 * px + 3 * px;
      ctx.globalAlpha = 0.72;
      ctx.fillStyle = th.paper ?? th.card;
      ctx.fillRect(x - 3 * px, y - 1.5 * px, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink;
      if (note.strike) {
        const sw = ctx.measureText(note.strike).width;
        ctx.fillStyle = th.pencil;
        ctx.fillText(note.strike, x, y);
        ctx.strokeStyle = th.danger;
        ctx.lineWidth = 1.6 * px;
        ctx.beginPath();
        ctx.moveTo(x - 1.5 * px, y + size * 0.58 * px);
        ctx.lineTo(x + sw + 1.5 * px, y + size * 0.48 * px);
        ctx.stroke();
        y += size * 1.05 * px;
        ctx.fillStyle = ink;
      }
      ctx.fillText(note.text, x, y);
      ctx.restore();
    }
  },
});
