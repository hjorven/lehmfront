// Werkzeuge und Kartenzeichnung fuer Akt 3 (P24, Plan 4.2 Nr. 20 bis 22): Gas (Q), Flammenwerfer (I),
// Flieger (C), Tarnen und Scheinbatterie (Z), Waffenruhe (0), Bergen (9). Nur in Szenarien mit dem Merkmal.
// Zeichnet ausserdem Gaswolken, vergilbtes Papier, wo Gas lag, Verwundete draussen,
// angesengte Felder, eigene Attrappen und Tarnnetze, den Kreis des Fliegers und die Laterne der Waffenruhe.
// Klaenge: Gasglocke, Flammenstoss, Flieger.
import { registerTool } from '../tools.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { registerCheck } from '../summary.js';
import { registerCue } from '../../audio/cues.js';
import { cellAt, cellLabel, distance } from '../../map.js';
import { featureOn } from '../../underground.js';
import { windOf, windText, driftOf, driftSteps, predictDrift, cylinderCells, shellCells, windWarning } from '../../gas.js';
import { cylinderProblem, gasStock, shellBattery, shellProblem, hasMasks } from '../../phases/gas.js';
import { flameProblem, fuelOf } from '../../phases/flame.js';
import { reconProblem, decoyProblem, decoyCost } from '../../phases/air.js';
import { truceOf, truceProblem, recoverProblem, lyingCells, breaksTruce } from '../../truce.js';
import { buildingsWithRole } from '../../supply.js';
import { timeDarkness } from '../../phases/weather.js';
import { FLAME, TRUCE, AIR, DECOY } from '../../config/akt3.js';
import { groupName } from '../labels.js';
import { FONTS } from '../../render/map-layer.js';

const on = (state, f) => featureOn(state, f);
const position = (state) => state.turnKind !== 'battle';

function note(ctx, text, x, y, color, px, size = 14, align = 'left') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `700 ${size * px}px ${FONTS.hand}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ------------------------------------------------------------------------------------------- Gas (Q)

/** Vorschau fuer Gas aus Flaschen (Gruppe) oder Granaten (Zielfeld): { ok, path, text } */
export function gasPreview(map, state, side, group, cell) {
  const f = state.weather?.windForecast ?? { ...windOf(state), sure: 100 };
  const steps = driftSteps(f, 'position', state.turn);
  const sure = `Vorhersage ${windText(f)}, ${f.sure ?? 100} % sicher`;
  if (group && group.type === 'pioneers') {
    const why = cylinderProblem(state, map, group);
    if (why) return { ok: false, path: null, text: why };
    const p = predictDrift(map, state, cylinderCells(state, map, group), f, steps);
    const warn = windWarning(f, side);
    return { ok: true, path: p.path, text: `Gas abblasen bei ${cellLabel(group.pos.x, group.pos.y)} · ${sure}${warn ? '\n' + warn + '!' : ''}` };
  }
  if (!cell) return { ok: false, path: null, text: 'Zielfeld für die Gasgranaten antippen' };
  const bat = shellBattery(state, side, cell);
  const why = bat ? null : shellProblem(state, side, { target: cell, battery: (state.sides[side]?.artillery?.batteries ?? [])[0]?.id });
  if (!bat) return { ok: false, path: null, text: `${cellLabel(cell.x, cell.y)}: ${why ?? 'keine Batterie reicht'}` };
  const p = predictDrift(map, state, shellCells(cell, map), f, steps);
  const near = [...p.reach].some((k) => {
    const [x, y] = k.split(',').map(Number);
    return (state.groups ?? []).some((g) => g.side === side && g.status !== 'lost' && g.pos.x === x && g.pos.y === y);
  });
  return { ok: true, battery: bat.id, path: p.path, text: `Gasgranaten nach ${cellLabel(cell.x, cell.y)} · ${bat.label} · ${sure}${near ? '\nDie Wolke kann eigene Gruppen erreichen!' : ''}` };
}

registerTool({
  id: 'gas',
  key: 'q',
  label: 'Gas',
  order: 68,
  needsGroup: false,
  icon: '<path d="M4 15 C6 11 9 13 10 10 C11 7 15 8 16 6"/><path d="M5 19 C8 16 11 18 13 15 C15 12 18 14 20 11"/><circle cx="18" cy="5" r="1.4"/>',
  shown: (state) => on(state, 'gas') && position(state),
  canUse(group, state, env) {
    if (!on(state, 'gas')) return 'Gas gibt es erst in Akt 3';
    if (!position(state)) return 'Gas geht nur in Stellungsrunden';
    const side = group?.side ?? null;
    const cyl = group && group.type === 'pioneers' ? cylinderProblem(state, env?.map ?? null, group) : 'keine Pioniere';
    if (!cyl) return true;
    if (side && gasStock(state, side).shells <= 0) return group?.type === 'pioneers' ? cyl : 'keine Gasgranaten im Depot';
    return true;
  },
  begin(ctx) {
    const { state, map, side } = ctx;
    const group = ctx.group?.type === 'pioneers' && !cylinderProblem(state, map, ctx.group) ? ctx.group : null;
    if (group) {
      const p = gasPreview(map, state, side, group, null);
      if (!p.ok) { ctx.hint(p.text); ctx.cancel(); return; }
      ctx.setOrder({ group: group.id, type: 'gas' });
      ctx.hint(p.text);
      ctx.cancel();
      return;
    }
    if (gasStock(state, side).shells <= 0) { ctx.hint('Keine Gasgranaten im Depot. Gasflaschen öffnen nur Pioniere im eigenen Graben.'); ctx.cancel(); return; }
    ctx.pickCell({
      title: 'Gasgranaten',
      hint: 'Gasgranaten: Zielfeld antippen. Die Linie zeigt, wohin der vorhergesagte Wind die Wolke treibt.',
      preview: (cell) => (cell ? gasPreview(map, state, side, null, cell) : null),
      pick(cell) {
        const p = cell ? gasPreview(map, state, side, null, cell) : null;
        if (!p?.ok) { ctx.hint(p?.text ?? 'Kein Ziel.'); return false; }
        ctx.setSidePlan({ type: 'gas_shell', target: { x: cell.x, y: cell.y }, battery: p.battery });
        ctx.hint(p.text);
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Flammenwerfer (I)

registerTool({
  id: 'flame',
  key: 'i',
  label: 'Flammenwerfer',
  order: 69,
  icon: '<path d="M3 15 H11"/><path d="M5 12 V18"/><path d="M11 15 C14 13 14 10 17 9 C16 12 20 12 21 15 C20 18 16 19 13 17"/>',
  shown: (state) => state.turnKind === 'battle' && (state.groups ?? []).some((g) => g.type === 'flamethrowers' && g.status !== 'lost'),
  canUse(group, state) {
    if (group.type !== 'flamethrowers') return 'Nur Flammenwerfer-Trupps';
    if (state.turnKind !== 'battle') return 'Flammenstöße gehen nur im Gefecht';
    if (group.inDugout) return 'Gruppe sitzt im Unterstand';
    if (fuelOf(group) <= 0) return 'Die Tanks sind leer';
    return true;
  },
  begin(ctx) {
    const { group, state } = ctx;
    ctx.pickCell({
      title: 'Flammenstoß',
      hint: `Flammenstoß: Feld bis ${FLAME.range} Felder vor ${groupName(state, group)} antippen. Noch ${fuelOf(group)} Stöße. Wer die Tanks trifft, bringt sie zum Platzen.`,
      preview: (cell) => {
        if (!cell) return null;
        const why = flameProblem(group, cell);
        return { path: why ? null : [{ x: cell.x, y: cell.y }], text: why ? `${cellLabel(cell.x, cell.y)}: ${why}` : `Feuerstoß nach ${cellLabel(cell.x, cell.y)} · im Unterstand ist niemand sicher` };
      },
      pick(cell) {
        const why = cell ? flameProblem(group, cell) : 'Kein Ziel';
        if (why) { ctx.hint(why); return false; }
        ctx.setOrder({ group: group.id, type: 'flame', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Flieger (C)

registerTool({
  id: 'recon',
  key: 'c',
  label: 'Flieger',
  order: 74,
  needsGroup: false,
  icon: '<path d="M2 12 H22"/><path d="M12 8 V16"/><path d="M9 18 H15"/><circle cx="12" cy="12" r="1.5"/>',
  shown: (state) => on(state, 'plane') && position(state),
  canUse(group, state) {
    if (!on(state, 'plane')) return 'Flieger gibt es erst in Akt 3';
    if (!position(state)) return 'Der Flieger steigt in der Stellungsrunde auf';
    return true;
  },
  begin(ctx) {
    const { state, side } = ctx;
    const first = reconProblem(state, side, { x: 0, y: 0 });
    if (first) { ctx.hint(`Der Flieger bleibt am Boden: ${first}.`); ctx.cancel(); return; }
    ctx.pickCell({
      title: 'Flieger',
      hint: `Flieger: Mitte des Aufklärungskreises antippen (${AIR.radius} Felder). Er meldet Gruppen, Batterien und Depots. Manchmal kommt er nicht zurück.`,
      preview: (cell) => {
        if (!cell) return null;
        const why = reconProblem(state, side, cell);
        return { path: null, text: why ? `${cellLabel(cell.x, cell.y)}: ${why}` : `Aufklärung über ${cellLabel(cell.x, cell.y)} · Kreis ${AIR.radius} Felder · Batterien von oben sehen aus wie Attrappen` };
      },
      pick(cell) {
        const why = cell ? reconProblem(state, side, cell) : 'Kein Ziel';
        if (why) { ctx.hint(why); return false; }
        ctx.setSidePlan({ type: 'recon', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Tarnen (Z)

/** Was baut ein Tipp auf dieses Feld? Ueber eigener Batterie oder Depot ein Tarnnetz, sonst eine Attrappe */
export function decoyKind(map, state, side, cell) {
  const inside = (r) => cell.x >= r.x && cell.y >= r.y && cell.x < r.x + (r.w ?? 1) && cell.y < r.y + (r.h ?? 1);
  const bats = (state.sides[side]?.artillery?.batteries ?? []).map((b) => ({ ...b.pos, w: b.w, h: b.h }));
  const depots = map ? buildingsWithRole(map, state, side, 'depot') : [];
  const hit = [...bats, ...depots].find(inside);
  return hit ? { kind: 'camo', x: hit.x, y: hit.y } : { kind: 'decoy', x: cell.x, y: cell.y };
}

registerTool({
  id: 'decoy',
  key: 'z',
  label: 'Tarnen',
  order: 75,
  needsGroup: false,
  icon: '<path d="M3 17 L8 12 L12 15 L17 9 L21 13"/><path d="M3 20 H21"/><path d="M6 8 L8 5 L10 8"/>',
  shown: (state) => on(state, 'decoy') && position(state),
  canUse(group, state) {
    if (!on(state, 'decoy')) return 'Scheinbatterien gibt es erst in Akt 3';
    if (!position(state)) return 'Gebaut wird in der Stellungsrunde';
    return true;
  },
  begin(ctx) {
    const { state, map, side } = ctx;
    const current = () => ctx.plans?.()?.decoy?.builds ?? [];
    ctx.pickCell({
      title: 'Tarnen',
      hint: `Tarnen: auf eine eigene Batterie oder das Depot tippen legt ein Tarnnetz (${DECOY.camoCost} Material), sonst entsteht eine Scheinbatterie (${DECOY.decoyCost} Material). Höchstens ${DECOY.maxPerRound} Bauten je Runde.`,
      preview: (cell) => {
        if (!cell) return null;
        const b = decoyKind(map, state, side, cell);
        const why = decoyProblem(state, map, side, b);
        const what = b.kind === 'camo' ? 'Tarnnetz' : 'Scheinbatterie';
        return { path: null, text: why ? `${cellLabel(cell.x, cell.y)}: ${why}` : `${what} bei ${cellLabel(b.x, b.y)} · ${b.kind === 'camo' ? DECOY.camoCost : DECOY.decoyCost} Material` };
      },
      pick(cell) {
        if (!cell) return false;
        const b = decoyKind(map, state, side, cell);
        const why = decoyProblem(state, map, side, b);
        if (why) { ctx.hint(why); return false; }
        let list = current().filter((x) => !(x.x === b.x && x.y === b.y));
        const removed = list.length !== current().length;
        if (!removed) list = [...list, b].slice(-DECOY.maxPerRound);
        const have = state.sides[side]?.supplies?.material ?? 0;
        if (decoyCost(list) > have) { ctx.hint(`Zu wenig Material: ${decoyCost(list)} nötig, ${have} im Depot.`); return false; }
        ctx.setSidePlan(list.length ? { type: 'decoy', builds: list } : { type: 'decoy', builds: [] });
        ctx.hint(removed ? 'Bau gestrichen.' : `${list.length} ${list.length === 1 ? 'Bau' : 'Bauten'} für diese Nacht, ${decoyCost(list)} Material.`);
        return list.length >= DECOY.maxPerRound;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Waffenruhe (0)

/** Was ein Druck auf die Waffenruhe jetzt bedeutet: naechste Antwort im Kreis */
export function nextTruceAnswer(state, side, current) {
  const t = truceOf(state);
  if (t?.status === 'offered' && t.by !== side) return current === 'accept' ? 'decline' : current === 'decline' ? null : 'accept';
  if (!truceProblem(state, side, { answer: 'offer' })) return current === 'offer' ? null : 'offer';
  return null;
}

const TRUCE_TEXT = {
  accept: 'Waffenruhe annehmen: niemand schießt, beide Seiten bergen. Der Stab wird das nicht gern sehen.',
  decline: 'Waffenruhe ablehnen: der Bote geht mit einer Absage zurück.',
  offer: 'Waffenruhe anbieten: weiße Fahne am Spaten, eine Laterne darunter. Antwort in der nächsten Runde.',
};

registerTool({
  id: 'truce',
  key: '0',
  label: 'Waffenruhe',
  order: 78,
  needsGroup: false,
  icon: '<path d="M6 21 V4"/><path d="M6 4 H17 L15 7 L17 10 H6"/><path d="M9 17 H13 V21 H9 Z"/>',
  shown: (state) => on(state, 'truce') && position(state) && (truceOf(state)?.status === 'offered' || lyingCells(state).length > 0),
  canUse(group, state) {
    if (!on(state, 'truce')) return 'Waffenruhe gibt es erst in Akt 3';
    if (!position(state)) return 'Über eine Waffenruhe wird in der Stellungsrunde verhandelt';
    return true;
  },
  begin(ctx) {
    const { state, side } = ctx;
    const a0 = ctx.plans?.()?.truce?.answer;
    const cur = a0 && a0 !== 'none' ? a0 : null;
    const next = nextTruceAnswer(state, side, cur);
    if (!next && !cur) {
      ctx.hint(truceProblem(state, side, { answer: 'offer' }) ?? 'Keine Waffenruhe möglich.');
      ctx.cancel();
      return;
    }
    if (next) ctx.setSidePlan({ type: 'truce', answer: next });
    else ctx.setSidePlan({ type: 'truce', answer: 'none' });
    ctx.hint(next ? TRUCE_TEXT[next] : 'Keine Antwort. Ohne Antwort gilt ein Angebot als abgelehnt.');
    ctx.cancel();
  },
});

// ------------------------------------------------------------------------------------------- Bergen (9)

registerTool({
  id: 'recover',
  key: '9',
  label: 'Bergen',
  order: 79,
  icon: '<path d="M12 5 V19"/><path d="M5 12 H19"/><path d="M4 20 C8 17 16 17 20 20"/>',
  shown: (state) => on(state, 'truce') && position(state) && lyingCells(state).length > 0,
  canUse(group, state) {
    if (!on(state, 'truce')) return 'Bergen draußen gibt es erst in Akt 3';
    if (group.type !== 'medics') return 'Bergen draußen können nur Sanitäter';
    if (!position(state)) return 'Geborgen wird in der Stellungsrunde';
    return true;
  },
  begin(ctx) {
    const { group, state, map } = ctx;
    ctx.pickCell({
      title: 'Bergen',
      hint: `Bergen: Feld mit eigenen Verwundeten bis ${TRUCE.recoverReach} Felder weit antippen. Ohne Waffenruhe sieht vielleicht ein Posten die Sanitäter.`,
      preview: (cell) => {
        if (!cell) return null;
        const why = recoverProblem(state, map, group, cell);
        const n = state.cells?.[cell.x + ',' + cell.y]?.lying?.[group.side] | 0;
        return { path: why ? null : [{ x: cell.x, y: cell.y }], text: why ? `${cellLabel(cell.x, cell.y)}: ${why}` : `${n} ${n === 1 ? 'Verwundeter' : 'Verwundete'} bei ${cellLabel(cell.x, cell.y)} hereinholen` };
      },
      pick(cell) {
        const why = cell ? recoverProblem(state, map, group, cell) : 'Kein Ziel';
        if (why) { ctx.hint(why); return false; }
        ctx.setOrder({ group: group.id, type: 'recover', target: { x: cell.x, y: cell.y } });
        return true;
      },
    });
  },
});

// ------------------------------------------------------------------------------------------- Befehlsstriche

registerOrderPainter('flame', (ctx, { group, order, th, px, progress }) => {
  const t = order.target;
  if (!t) return false;
  const k = Math.min(1, progress);
  ctx.save();
  ctx.strokeStyle = th.danger;
  ctx.lineWidth = 3 * px;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const ax = group.pos.x + 0.5, ay = group.pos.y + 0.5;
  const bx = ax + (t.x + 0.5 - ax) * k, by = ay + (t.y + 0.5 - ay) * k;
  // Zickzack: die Flamme flackert
  const n = 6;
  ctx.moveTo(ax, ay);
  for (let i = 1; i <= n; i++) {
    const f = i / n;
    const w = i % 2 ? 0.12 : -0.12;
    ctx.lineTo(ax + (bx - ax) * f - (by - ay) * w * 0.4, ay + (by - ay) * f + (bx - ax) * w * 0.4);
  }
  ctx.stroke();
  ctx.restore();
  return true;
});

registerOrderPainter('recover', (ctx, { group, order, th, px }) => {
  const t = order.target;
  if (!t) return false;
  ctx.save();
  ctx.strokeStyle = th.pencil;
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([3 * px, 4 * px]);
  ctx.beginPath();
  ctx.moveTo(group.pos.x + 0.5, group.pos.y + 0.5);
  ctx.lineTo(t.x + 0.5, t.y + 0.5);
  ctx.stroke();
  ctx.restore();
  note(ctx, 'bergen', t.x + 0.9, t.y + 0.5, th.pencil, px, 13);
  return true;
});

// ------------------------------------------------------------------------------------------- Karte

/** Feste Pseudozufallszahl je Feld (fuer Wolkenfetzen und Flecken), 0..1 */
const hash = (x, y, i) => (((x * 73856093) ^ (y * 19349663) ^ (i * 83492791)) >>> 0) % 1000 / 1000;

registerDecor({
  id: 'akt3-ground',
  order: 18,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.cells || !st.scenario?.features?.length) return;
    const th = d.theme, px = d.px;
    const keys = Object.keys(st.cells).sort();
    ctx.save();
    for (const k of keys) {
      const c = st.cells[k];
      if (!c) continue;
      const [x, y] = k.split(',').map(Number);
      // Wo Gas lag, vergilbt das Papier und bleibt so (Ueberraschung)
      if (Number.isInteger(c.gasStain) && !c.gas) {
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = th.gasStain ?? th.stain;
        ctx.beginPath();
        ctx.ellipse(x + 0.5, y + 0.5, 0.48 + hash(x, y, 1) * 0.1, 0.42 + hash(x, y, 2) * 0.1, hash(x, y, 3) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      // Angesengt: schwarze Kringel
      if (Number.isInteger(c.scorched)) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = th.ink;
        ctx.lineWidth = 1.5 * px;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(x + 0.2 + hash(x, y, i) * 0.6, y + 0.2 + hash(x, y, i + 5) * 0.6, 0.08 + i * 0.03, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Eigenes Tarnnetz: Schraffur
      if (c.camo === d.side) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = th.forestLine;
        ctx.lineWidth = 1.2 * px;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) { ctx.moveTo(x + i * 0.25, y); ctx.lineTo(x, y + i * 0.25); ctx.moveTo(x + 1, y + i * 0.25); ctx.lineTo(x + i * 0.25, y + 1); }
        ctx.stroke();
      }
    }
    ctx.restore();
  },
});

registerDecor({
  id: 'akt3-gas',
  order: 88,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.cells || !on(st, 'gas') && !Object.values(st.cells).some((c) => c?.gas)) return;
    const th = d.theme, px = d.px;
    ctx.save();
    for (const k of Object.keys(st.cells).sort()) {
      const c = st.cells[k];
      if (!c?.gas) continue;
      const [x, y] = k.split(',').map(Number);
      // Gaswolke: drei bis fuenf Fetzen je Feld, dichter = mehr und kraeftiger
      ctx.fillStyle = th.gas ?? th.accent;
      ctx.strokeStyle = th.gas ?? th.accent;
      ctx.lineWidth = 1.2 * px;
      const n = 2 + c.gas;
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = 0.2 + c.gas * 0.1;
        ctx.beginPath();
        ctx.ellipse(x + 0.15 + hash(x, y, i) * 0.7, y + 0.15 + hash(x, y, i + 9) * 0.7, 0.28 + hash(x, y, i + 3) * 0.2, 0.18 + hash(x, y, i + 4) * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.55;
        ctx.stroke();
      }
    }
    ctx.restore();
  },
});

registerDecor({
  id: 'akt3-marks',
  order: 92,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.sides || !st.scenario?.features?.length) return;
    const th = d.theme, px = d.px;
    // Verwundete draussen: kleine Kreuze, die eigenen mit Zahl
    for (const c of lyingCells(st)) {
      const own = c[d.side] | 0, foe = (c[d.side === 'a' ? 'b' : 'a']) | 0;
      ctx.save();
      ctx.strokeStyle = own ? th.own : th.enemy;
      ctx.lineWidth = 3 * px;
      ctx.beginPath();
      ctx.moveTo(c.x + 0.25, c.y + 0.5); ctx.lineTo(c.x + 0.75, c.y + 0.5);
      ctx.moveTo(c.x + 0.5, c.y + 0.25); ctx.lineTo(c.x + 0.5, c.y + 0.75);
      ctx.stroke();
      ctx.restore();
      const label = own ? String(own) + (foe ? ` · ${foe}` : '') : String(foe);
      note(ctx, label, c.x + 0.8, c.y + 0.3, own ? th.own : th.enemy, px, 15);
    }
    const own = st.sides[d.side];
    if (!own) return;
    // Eigene Attrappen: Bleistiftrahmen mit "Attr."
    for (const dd of own.decoys ?? []) {
      ctx.save();
      ctx.strokeStyle = th.pencil;
      ctx.globalAlpha = dd.wrecked ? 0.4 : 0.85;
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(dd.pos.x + 0.1, dd.pos.y + 0.1, (dd.w ?? 2) - 0.2, (dd.h ?? 2) - 0.2);
      ctx.restore();
      note(ctx, dd.wrecked ? 'Attrappe, zerschossen' : `Attrappe${dd.hits ? ` · ${dd.hits} Treffer` : ''}`, dd.pos.x + (dd.w ?? 2) + 0.15, dd.pos.y + 0.5, th.pencil, px, 13);
    }
    // Flieger: Kreis der letzten Aufklaerung (eine Runde lang)
    const last = own.air?.last;
    if (last && (st.turn ?? 0) - last.turn <= 1) {
      ctx.save();
      ctx.strokeStyle = th.own;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 6 * px]);
      ctx.beginPath();
      ctx.arc(last.target.x + 0.5, last.target.y + 0.5, AIR.radius + 0.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      note(ctx, 'Flieger', last.target.x + 0.5, last.target.y - AIR.radius - 0.2, th.own, px, 14, 'center');
    }
    // Waffenruhe: Laterne unter der weissen Fahne in der Mitte des Niemandslands
    const t = truceOf(st);
    if (t && (t.status === 'offered' || t.status === 'active' || t.status === 'tolerated') && (t.status === 'offered' || (t.until ?? 0) >= (st.turn ?? 0))) {
      // ueber den Verwundeten draussen, sonst in der Mitte der Karte
      const lie = lyingCells(st);
      const mx = lie.length ? Math.floor(lie.reduce((n, c) => n + c.x, 0) / lie.length) : Math.floor((d.map?.width ?? 60) / 2);
      const my = lie.length ? Math.max(1, Math.min(...lie.map((c) => c.y)) - 3) : Math.floor((d.map?.height ?? 40) / 2);
      ctx.save();
      ctx.strokeStyle = th.ink;
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.moveTo(mx + 0.3, my + 1.4); ctx.lineTo(mx + 0.3, my);
      ctx.stroke();
      ctx.fillStyle = th.card;
      ctx.fillRect(mx + 0.32, my, 0.6, 0.38);
      ctx.strokeRect(mx + 0.32, my, 0.6, 0.38);
      ctx.fillStyle = th.flareLight;
      ctx.globalAlpha = timeDarkness(st) > 0.5 ? 0.95 : 0.7;
      ctx.beginPath();
      ctx.arc(mx + 0.3, my + 1.0, 0.16, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      const word = t.status === 'offered' ? (t.by === d.side ? 'Angebot läuft' : 'Waffenruhe angeboten') : t.status === 'active' ? 'Waffenruhe' : 'Waffenruhe geduldet';
      note(ctx, word, mx + 1.1, my + 0.7, th.ink, px, 15);
    }
  },
});

// ------------------------------------------------------------------------------------------- Pruefpunkte

registerCheck('waffenruhe', ({ state, side, orders, plans }) => {
  if (!on(state, 'truce') || state.turnKind !== 'position') return [];
  const t = truceOf(state);
  const out = [];
  if (t?.status === 'offered' && t.by !== side && !['accept', 'decline'].includes(plans?.truce?.answer)) {
    out.push({ tone: 'warn', summary: true, text: 'Waffenruhe angeboten: noch keine Antwort (Taste 0)' });
  }
  const quiet = t && t.status === 'active' && (t.until ?? 0) >= state.turn;
  if (quiet) {
    const bad = (orders ?? []).filter((o) => breaksTruce(o));
    const art = plans?.fire_plan && breaksTruce(plans.fire_plan);
    if (bad.length || art || plans?.gas_shell) out.push({ tone: 'warn', summary: true, text: 'Dieser Befehl bricht die Waffenruhe', group: bad[0]?.group });
  }
  return out;
});

registerCheck('gas-wind', ({ state, side, orders, plans }) => {
  if (!on(state, 'gas') || state.turnKind !== 'position') return [];
  const f = state.weather?.windForecast ?? { ...windOf(state), sure: 100 };
  const out = [];
  const gas = (orders ?? []).some((o) => o.type === 'gas') || !!plans?.gas_shell;
  const warn = windWarning(f, side);
  if (gas && warn) out.push({ tone: 'warn', summary: true, text: `Gas: ${warn}` });
  else out.push({ tone: 'ok', text: `Wind morgen: ${windText(f)}, ${f.sure ?? 100} % sicher` });
  if (!hasMasks(state, side)) out.push({ tone: 'warn', text: 'Keine Gasmasken ausgegeben' });
  return out;
});

// ------------------------------------------------------------------------------------------- Klaenge

registerCue('gas_alarm', () => [{ name: 'gasbell', opts: { intensity: 0.6, count: 5 } }]);
registerCue('gas_released', () => [{ name: 'artillery-far', opts: { intensity: 0.3 } }, { name: 'gasbell', opts: { intensity: 0.35, count: 3 }, delay: 1.2 }]);
registerCue('flame', () => [{ name: 'flame', opts: { intensity: 0.7 } }]);
registerCue('plane_over', () => [{ name: 'plane', opts: { intensity: 0.5 } }]);
registerCue('recon', () => [{ name: 'plane', opts: { intensity: 0.4 } }]);
registerCue('truce_begin', () => [{ name: 'hush' }]);
registerCue('truce_over', () => [{ name: 'flare', opts: { intensity: 0.4 } }]);
