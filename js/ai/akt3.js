// KI-Bausteine fuer Akt 3 (P24): Flieger, Scheinbatterien und Tarnnetze, Gas bei gutem Wind, Flammenwerfer,
// Waffenruhe anbieten und beantworten, Verwundete bergen, eine Gruppe aus dem Gas holen.
// Rein und deterministisch: arbeitet nur auf der Sicht (view.own enthaelt Gasvorrat, Flieger, Attrappen, Waffenruhe).
//
// opts.goals (optional): { recon: [{x,y}], decoy: [{x,y}], camo: [{x,y}], rescue: {x,y,group?}, recover: true,
//                          gas: true, flame: true }
import { registerAiBlock } from './blocks.js';
import { cellAt, cellLabel, distance, enterCost, findPath } from '../map.js';
import { surname } from '../phases/hold.js';
import { flameProblem } from '../phases/flame.js';
import { cylinderProblem, gasStock, shellBattery } from '../phases/gas.js';
import { reconProblem, decoyProblem, decoyCost } from '../phases/air.js';
import { featureOn } from '../underground.js';
import { windOf, windTowardEnemy } from '../gas.js';
import { truceProblem, recoverProblem } from '../truce.js';
import { FLAME, TRUCE, DECOY } from '../config/akt3.js';

const nameOf = (g) => 'Gruppe ' + surname(g.leader?.name ?? g.id);
const byId = (p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);
const free = (b, g) => !b.taken.has(g.id) && g.status !== 'lost';
const on = (b, f) => featureOn(b.st, f);

function live(map, view, x, y) {
  const c = cellAt(map, x, y);
  if (!c) return null;
  const s = view.cells?.[x + ',' + y];
  return s ? { ...c, ...s } : c;
}

/** Verwundete der eigenen Seite draussen, aus der Sicht: [{ x, y, n }] */
function ownLying(b) {
  const out = [];
  for (const k of Object.keys(b.view.cells ?? {}).sort()) {
    const n = b.view.cells[k]?.lying?.[b.side] | 0;
    if (n <= 0) continue;
    const [x, y] = k.split(',').map(Number);
    out.push({ x, y, n });
  }
  return out.sort((p, q) => p.y - q.y || p.x - q.x);
}

// 1. Eine Gruppe aus dem Gas holen (a3m2): auf dem kuerzesten Weg zurueck in den eigenen Graben
registerAiBlock({
  id: 'akt3-rescue',
  order: 5,
  run(b) {
    const t = b.opts.goals?.rescue;
    if (!t) return;
    const cost = (c) => {
      const lc = live(b.map, b.view, c.x, c.y);
      return lc ? enterCost({ ...lc, wire: lc.wire?.side === b.sit.ms ? null : lc.wire }) : Infinity;
    };
    for (const g of b.sit.own.filter((x) => free(b, x) && (t.group ? x.id === t.group : Number.isInteger(x.gasTurn))).sort(byId)) {
      if (distance(g.pos, t) === 0) continue;
      const r = findPath(b.map, g.pos, t, { cost, maxNodes: 20000 });
      const path = r?.path.slice(1);
      if (!path?.length) continue;
      const type = b.kind === 'battle' ? 'move' : 'redeploy';
      b.give(g, { group: g.id, type, path }, `${nameOf(g)} kommt aus dem Gas zurück nach ${cellLabel(t.x, t.y)}, Maske auf, die Verwundeten zwischen sich.`, 'Aus dem Gas zurück');
    }
  },
});

// 2. Waffenruhe: Angebot der Gegenseite beantworten, selbst anbieten, wenn viele eigene Verwundete draussen liegen
registerAiBlock({
  id: 'akt3-truce',
  order: 8,
  run(b) {
    if (b.kind !== 'position' || !on(b, 'truce')) return;
    const t = b.view.own.truce ?? null;
    const lying = ownLying(b).reduce((n, c) => n + c.n, 0);
    if (t?.status === 'offered' && t.by !== b.side) {
      // Eigene Leute draussen: annehmen. Sonst nimmt ein Veteran meist an, der Stab will Gruende sehen.
      const yes = lying > 0 || b.rng() < 0.6;
      const answer = yes ? 'accept' : 'decline';
      b.give(null, { type: 'truce', answer }, yes ? 'Wir nehmen die Waffenruhe an. Draußen liegen Leute, auch unsere.' : 'Keine Waffenruhe. Der Stab sieht darin eine List.', yes ? 'Waffenruhe annehmen' : 'Waffenruhe ablehnen');
      return;
    }
    if (lying >= TRUCE.offerWounded && !b.view.own.truceOffered && !truceProblem(b.st, b.side, { answer: 'offer' })) {
      b.give(null, { type: 'truce', answer: 'offer' }, `Draußen liegen ${lying} von uns. Weiße Fahne am Spaten, Laterne darunter.`, 'Waffenruhe anbieten');
    }
  },
});

// 3. Sanitaeter bergen draussen: in der Waffenruhe, geduldet, nachts oder wenn es das Ziel der Lage ist
registerAiBlock({
  id: 'akt3-recover',
  order: 9,
  run(b) {
    if (b.kind !== 'position' || !on(b, 'truce')) return;
    const t = b.view.own.truce ?? null;
    const calm = t && (t.status === 'active' || t.status === 'tolerated') && (t.until ?? 0) >= b.view.turn;
    if (!calm && !b.isNight && !b.opts.goals?.recover) return;
    if (t?.status === 'active' && (t.until ?? 0) >= b.view.turn) return; // in der Waffenruhe bergen alle ohnehin
    const cells = ownLying(b);
    if (!cells.length) return;
    const used = new Set();
    for (const g of b.sit.own.filter((x) => x.type === 'medics' && free(b, x)).sort(byId)) {
      const c = cells.filter((p) => !used.has(p.x + ',' + p.y) && !recoverProblem(b.st, b.map, g, p))
        .sort((p, q) => distance(p, g.pos) - distance(q, g.pos) || q.n - p.n || p.y - q.y || p.x - q.x)[0];
      if (!c) continue;
      if (b.give(g, { group: g.id, type: 'recover', target: { x: c.x, y: c.y } }, `${nameOf(g)} holt die Verwundeten bei ${cellLabel(c.x, c.y)} herein.`, 'Verwundete bergen')) used.add(c.x + ',' + c.y);
    }
  },
});

// 4. Flieger: Ziele aus der Lage der Reihe nach, sonst das Hinterland gegenueber
registerAiBlock({
  id: 'akt3-recon',
  order: 30,
  run(b) {
    if (b.kind !== 'position' || !on(b, 'plane')) return;
    if (!(b.view.own.air?.planes > 0)) return;
    const list = Array.isArray(b.opts.goals?.recon) && b.opts.goals.recon.length ? b.opts.goals.recon : null;
    let target;
    if (list) target = list[(b.view.turn | 0) % list.length];
    else {
      // Ohne Ziel: mal hier, mal da hinter der feindlichen Linie (nicht jede Runde, Flieger sind knapp)
      if (b.rng() < 0.5) return;
      const w = b.map.width, h = b.map.height;
      const x = b.sit.ex > 0 ? Math.min(w - 4, Math.floor(w * 0.8)) : Math.max(3, Math.floor(w * 0.2));
      const ys = [Math.floor(h / 4), Math.floor(h / 2), Math.floor((3 * h) / 4)];
      target = { x, y: ys[Math.floor(b.rng() * ys.length)] };
    }
    if (!target || reconProblem(b.st, b.side, target)) return;
    b.give(null, { type: 'recon', target: { x: target.x, y: target.y } }, `Der Flieger soll über ${cellLabel(target.x, target.y)} nachsehen: Batterien, Depots, Gräben.`, 'Flieger aufklären');
  },
});

// 5. Scheinbatterien und Tarnnetze (Ziele aus der Lage)
registerAiBlock({
  id: 'akt3-decoy',
  order: 32,
  run(b) {
    if (b.kind !== 'position' || !on(b, 'decoy')) return;
    const goals = b.opts.goals ?? {};
    const have = b.view.own.decoys ?? [];
    const camo = (p) => b.view.cells?.[p.x + ',' + p.y]?.camo === b.side;
    const builds = [];
    for (const p of goals.camo ?? []) if (!camo(p)) builds.push({ kind: 'camo', x: p.x, y: p.y });
    for (const p of goals.decoy ?? []) if (!have.some((d) => !d.wrecked && distance(d.pos, p) < 3)) builds.push({ kind: 'decoy', x: p.x, y: p.y });
    const ok = builds.filter((x) => !decoyProblem(b.st, b.map, b.side, x)).slice(0, DECOY.maxPerRound);
    let pick = ok;
    while (pick.length && decoyCost(pick) > (b.view.own.supplies?.material ?? 0)) pick = pick.slice(0, -1);
    if (!pick.length) return;
    const what = pick.map((x) => (x.kind === 'decoy' ? `eine Attrappe bei ${cellLabel(x.x, x.y)}` : `ein Tarnnetz bei ${cellLabel(x.x, x.y)}`)).join(' und ');
    b.give(null, { type: 'decoy', builds: pick }, `Pioniere bauen ${what}: Holz, Ofenrohre, Mündungsblitze aus Pulversäcken.`, 'Tarnen und täuschen');
  },
});

// 6. Gas: Flaschen abblasen nur bei sicherem Wind zum Gegner, Gasgranaten auf erkannte Ziele
registerAiBlock({
  id: 'akt3-gas',
  order: 35,
  run(b) {
    if (b.kind !== 'position' || !on(b, 'gas')) return;
    const eager = b.doc.id === 'material' || !!b.opts.goals?.gas;
    if (!eager) return;
    const stock = gasStock(b.st, b.side);
    const f = b.view.weather?.windForecast ?? { ...windOf(b.st), sure: 100 };
    const good = windTowardEnemy(f, b.side) && f.speed >= 1 && (f.sure ?? 0) >= 65;
    if (stock.cylinders > 0 && good && b.rng() < 0.6) {
      const pio = b.sit.own.filter((g) => g.type === 'pioneers' && free(b, g) && !cylinderProblem(b.st, b.map, g))
        .sort((p, q) => (b.sit.ex > 0 ? q.pos.x - p.pos.x : p.pos.x - q.pos.x) || byId(p, q))[0];
      if (pio && b.give(pio, { group: pio.id, type: 'gas' }, `${nameOf(pio)} öffnet die Gasflaschen bei ${cellLabel(pio.pos.x, pio.pos.y)}. Der Wind steht gut, sagt der Wetterzug.`, 'Gas abblasen')) return;
    }
    if (stock.shells > 0 && !windTowardEnemy({ ...f, dir: f.dir }, b.side === 'a' ? 'b' : 'a') && b.rng() < 0.5) {
      const tgt = b.sit.known.filter((k) => k.seen !== false).sort((p, q) => distance(p.pos, b.sit.own[0]?.pos ?? p.pos) - distance(q.pos, b.sit.own[0]?.pos ?? q.pos) || (p.id < q.id ? -1 : 1))
        .map((k) => k.pos).find((p) => shellBattery(b.st, b.side, p));
      if (!tgt) return;
      const bat = shellBattery(b.st, b.side, tgt);
      b.give(null, { type: 'gas_shell', target: { x: tgt.x, y: tgt.y }, battery: bat.id }, `${bat.label} schießt Gasgranaten nach ${cellLabel(tgt.x, tgt.y)}.`, 'Gasgranaten');
    }
  },
});

// 7. Flammenwerfer im Gefecht: Stoss auf den naechsten Feind in Reichweite, Unterstaende zuerst
registerAiBlock({
  id: 'akt3-flame',
  order: 12,
  run(b) {
    if (b.kind !== 'battle') return;
    for (const g of b.sit.own.filter((x) => x.type === 'flamethrowers' && free(b, x)).sort(byId)) {
      const cands = b.sit.known.filter((k) => distance(k.pos, g.pos) <= FLAME.range && distance(k.pos, g.pos) > 0)
        .sort((p, q) => (q.inDugout ? 1 : 0) - (p.inDugout ? 1 : 0) || distance(p.pos, g.pos) - distance(q.pos, g.pos) || (p.id < q.id ? -1 : 1));
      const k = cands.find((c) => !flameProblem(g, c.pos));
      if (!k) continue;
      b.give(g, { group: g.id, type: 'flame', target: { x: k.pos.x, y: k.pos.y } }, `${nameOf(g)} geht mit dem Flammenwerfer an ${cellLabel(k.pos.x, k.pos.y)} heran.`, 'Flammenstoß');
    }
  },
});

// 8. Feuerwalze vor einem Angriff aus der Lage (a3m6): Vorbereitungsfeuer auf die Linie, dann die Walze, die vor
//    den Sturmgruppen herwandert. Laeuft vor der Artillerie der Grundregeln; der erste Feuerplan der Runde gilt.
registerAiBlock({
  id: 'akt3-walze',
  order: 55,
  run(b) {
    const t = b.opts.goals?.attack;
    if (!t || !b.opts.goals?.walze || b.kind !== 'position') return;
    const art = b.view.own.artillery;
    const bats = [...(art?.batteries ?? [])].filter((x) => !(x.silenced > 0)).sort(byId);
    if (bats.length < 2) return;
    if ((art.plans ?? []).some((p) => p.kind === 'creep' && (p.fired ?? 0) < p.rounds)) return;
    const front = b.sit.own.reduce((m, g) => (b.sit.ex > 0 ? Math.max(m, g.pos.x) : Math.min(m, g.pos.x)), b.sit.ex > 0 ? 0 : b.map.width);
    if (Math.abs(t.x - front) < 3) return;
    const dir = b.sit.ex > 0 ? 'E' : 'W';
    const y0 = Math.max(0, t.y - 5), y1 = Math.min(b.map.height - 1, t.y + 5);
    const half = Math.max(1, bats.length >> 1);
    const startX = front + b.sit.ex * 3;
    const plans = [
      { id: 'walze-vorb', kind: 'prep', batteries: bats.slice(0, half).map((x) => x.id), a: { x: t.x, y: y0 }, b: { x: t.x, y: y1 }, dir, start: 1, rounds: 2 },
      { id: 'walze', kind: 'creep', batteries: bats.slice(half).map((x) => x.id), a: { x: startX, y: y0 }, b: { x: startX, y: y1 }, dir, start: 1, rounds: Math.max(3, Math.ceil(Math.abs(t.x - startX) / 2) + 2), step: 2 },
    ];
    b.give(null, { type: 'fire_plan', plans }, `Vorbereitungsfeuer auf ${cellLabel(t.x, t.y)}, dann die Walze, zwei Felder je Runde vor den Sturmgruppen.`, 'Feuerwalze');
  },
});
