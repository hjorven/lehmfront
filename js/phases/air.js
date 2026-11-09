// Flieger, Scheinbatterien und Tarnnetze (Plan 4.2 Nr. 19 und 22, Mission a3m3, Paket P24).
// Rein: kein DOM, kein Date, kein Math.random.
//
// Flieger: Seitenbefehl { type: 'recon', target } bei Tag und klarem oder bedecktem Wetter, einmal je Tagrunde.
//   Er kreist ueber dem Ziel und deckt im Umkreis AIR.radius Gruppen, Batterien und das Depot auf (Geister mit der
//   Quelle "Flieger", aufgeklaerte Batterien fuer das Gegenbatteriefeuer). Unter Tarnnetzen sieht er nichts.
//   Manchmal kommt er nicht zurueck. state.sides[s].air = { planes, last: { target, turn } }
// Scheinbatterie und Tarnnetz: Seitenbefehl { type: 'decoy', builds: [{ kind: 'decoy' | 'camo', x, y }] } in der
//   eigenen Stellung oder Etappe, kostet Material. Eine Scheinbatterie sieht von oben aus wie eine Batterie: wer
//   sie aufklaert, schiesst auf Holz und Ofenrohr. state.sides[s].decoys = [{ id, pos, w, h, built, hits, wrecked? }],
//   Tarnnetz: state.cells[k].camo = Seite.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellAt, cellLabel, distance } from '../map.js';
import { otherSide } from '../state.js';
import { featureOn } from '../underground.js';
import { batteryCenter } from '../artillery.js';
import { buildingsWithRole } from '../supply.js';
import { timeDarkness } from './weather.js';
import { AIR, DECOY } from '../config/akt3.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const ms = (side) => (side === 'a' ? 'own' : 'enemy');

export function airOf(state, side) {
  return state.sides[side]?.air ?? null;
}

/** Warum kann der Flieger nicht aufsteigen? null = geht */
export function reconProblem(state, side, target) {
  if (!featureOn(state, 'plane')) return 'Flieger gibt es erst in Akt 3';
  const air = airOf(state, side);
  if (!air || !(air.planes > 0)) return 'kein Flieger da';
  if (timeDarkness(state) > 0.5) return 'nachts fliegt niemand';
  if (!AIR.weatherOk.includes(state.weather?.kind ?? 'clear')) return 'bei diesem Wetter bleibt der Flieger am Boden';
  if (!target || !Number.isInteger(target.x) || !Number.isInteger(target.y) || target.x < 0 || target.y < 0
    || target.x >= state.map.width || target.y >= state.map.height) return 'Ziel liegt nicht auf der Karte';
  return null;
}

export function camoAt(state, side, x, y) {
  return state?.cells?.[x + ',' + y]?.camo === side;
}

/** Ist ein Rechteck (Batterie, Depot, Attrappe) getarnt? Ein Netz ueber der Mitte reicht */
function hidden(state, side, r) {
  const cx = r.x + ((r.w ?? 1) >> 1), cy = r.y + ((r.h ?? 1) >> 1);
  return camoAt(state, side, cx, cy) || camoAt(state, side, r.x, r.y);
}

/** Warum geht dieser Bau nicht? null = geht */
export function decoyProblem(state, map, side, b) {
  if (!featureOn(state, 'decoy')) return 'Scheinbatterien gibt es erst in Akt 3';
  if (!b || (b.kind !== 'decoy' && b.kind !== 'camo')) return 'unbekannter Bau';
  if (!Number.isInteger(b.x) || !Number.isInteger(b.y)) return 'Bau braucht ein Feld';
  const c = map ? cellAt(map, b.x, b.y) : { zone: 'etappe', side: ms(side), terrain: 'lehm' };
  if (!c) return 'außerhalb der Karte';
  if (c.zone === 'niemandsland' || c.side !== ms(side)) return 'nur hinter der eigenen Linie';
  if (c.terrain === 'wasser') return 'auf dem Wasser baut man nichts';
  if (b.kind === 'decoy') {
    if (map && cellAt(map, b.x + 1, b.y + 1) == null) return 'kein Platz für eine Attrappe';
    if ((state.sides[side].decoys ?? []).some((d) => !d.wrecked && distance(d.pos, b) < 3)) return 'dort steht schon eine Attrappe';
  }
  return null;
}

export function decoyCost(builds) {
  return (builds ?? []).reduce((n, b) => n + (b.kind === 'decoy' ? DECOY.decoyCost : DECOY.camoCost), 0);
}

registerOrderValidator('recon', (order, group, state, env, side) => reconProblem(state, side, order.target));
registerOrderValidator('decoy', (order, group, state, env, side) => {
  const list = order.builds ?? [];
  if (!Array.isArray(list)) return 'nichts zu bauen';
  if (!list.length) return null; // gestrichen: nichts zu tun
  if (list.length > DECOY.maxPerRound) return `höchstens ${DECOY.maxPerRound} Bauten je Runde`;
  for (const b of list) {
    const why = decoyProblem(state, env.map ?? null, side, b);
    if (why) return why;
  }
  const have = state.sides[side]?.supplies?.material ?? 0;
  if (have < decoyCost(list)) return `zu wenig Material (${decoyCost(list)} nötig, ${have} da)`;
  return null;
});

// ------------------------------------------------------------------ Bauen

function runDecoy(ctx) {
  const s = ctx.state;
  if (!featureOn(s, 'decoy')) return;
  for (const side of ['a', 'b']) {
    const o = ctx.planOf(side, 'decoy');
    if (!o) continue;
    const st = s.sides[side];
    const builds = [...(o.builds ?? [])].slice(0, DECOY.maxPerRound);
    for (const b of builds) {
      const why = decoyProblem(s, ctx.map, side, b);
      const cost = b.kind === 'decoy' ? DECOY.decoyCost : DECOY.camoCost;
      if (why || (st.supplies?.material ?? 0) < cost) {
        ctx.emit('decoy_failed', { side, secret: true, blocked: true, reason: `Bau bei ${cellLabel(b.x, b.y)} geht nicht: ${why ?? 'zu wenig Material'}.`, at: { x: b.x, y: b.y } });
        continue;
      }
      st.supplies.material -= cost;
      if (b.kind === 'decoy') {
        st.decoys ??= [];
        st.decoyCount = (st.decoyCount | 0) + 1;
        const id = 'attrappe' + st.decoyCount;
        st.decoys.push({ id, pos: { x: b.x, y: b.y }, w: DECOY.size, h: DECOY.size, built: ctx.turn, hits: 0 });
        ctx.emit('decoy_built', {
          side, secret: true, decoy: id,
          reason: `Pioniere bauen bei ${cellLabel(b.x, b.y)} über Nacht eine Batterie aus Zaunpfählen, Ofenrohr und Zeltbahn. Von oben sieht sie echt aus.`,
          at: { x: b.x, y: b.y },
        });
      } else {
        for (let dy = 0; dy < DECOY.size; dy++) for (let dx = 0; dx < DECOY.size; dx++) {
          const x = b.x + dx, y = b.y + dy;
          if (x >= s.map.width || y >= s.map.height) continue;
          const k = x + ',' + y;
          s.cells[k] = { ...(s.cells[k] ?? {}), camo: side };
        }
        ctx.emit('camo_built', {
          side, secret: true,
          reason: `Tarnnetz über ${cellLabel(b.x, b.y)}: Zweige, Draht und Farbe. Von oben ist dort nur noch Acker.`,
          at: { x: b.x, y: b.y },
        });
      }
    }
  }
}

/** Nach dem Stoer- und Gegenbatteriefeuer: hat jemand auf eine Attrappe geschossen? */
function runDecoyHits(ctx) {
  const s = ctx.state;
  if (!featureOn(s, 'decoy')) return;
  for (const side of ['a', 'b']) {
    const decoys = (s.sides[side].decoys ?? []).filter((d) => !d.wrecked);
    if (!decoys.length) continue;
    const foe = otherSide(side);
    const bats = s.sides[foe].artillery?.batteries ?? [];
    const canFire = (p) => (p.batteries ?? []).some((id) => bats.some((b) => b.id === id && !((b.silenced | 0) > 0) && (b.ammo ?? 0) > 0));
    const plans = (ctx.planOf(foe, 'fire_plan')?.plans ?? []).filter(canFire);
    for (const d of decoys) {
      const center = { x: d.pos.x + (d.w >> 1), y: d.pos.y + (d.h >> 1) };
      const hit = plans.some((p) => (p.kind === 'counter' && p.battery === d.id) || (p.kind === 'harass' && p.target && distance(p.target, center) <= 2));
      if (!hit) continue;
      d.hits = (d.hits | 0) + 1;
      s.sides[side].decoyShelled = (s.sides[side].decoyShelled | 0) + 1;
      const wrecked = d.hits >= DECOY.wreckHits;
      if (wrecked) d.wrecked = ctx.turn;
      ctx.emit('decoy_shelled', {
        side, secret: true, decoy: d.id, hits: d.hits, wrecked,
        reason: wrecked
          ? `Drüben schießt man die Attrappe bei ${cellLabel(d.pos.x, d.pos.y)} zu Kleinholz. Jede Granate dort fehlt woanders.`
          : `Granaten auf die Attrappe bei ${cellLabel(d.pos.x, d.pos.y)}. Holz und Ofenrohr fliegen, niemand ist verletzt.`,
        at: { ...center },
      });
      if (wrecked) {
        const art = s.sides[foe].artillery;
        if (art?.known?.[d.id]) {
          delete art.known[d.id];
          ctx.emit('battery_silenced_report', {
            side: foe, secret: true,
            reason: `Beobachter melden: die feindliche Batterie bei ${cellLabel(d.pos.x, d.pos.y)} schweigt.`,
            at: { ...center },
          });
        }
      }
    }
  }
}

// ------------------------------------------------------------------ Flieger

function runRecon(ctx) {
  const s = ctx.state;
  if (!featureOn(s, 'plane')) return;
  for (const side of ['a', 'b']) {
    const o = ctx.planOf(side, 'recon');
    if (!o) continue;
    const why = reconProblem(s, side, o.target);
    if (why) {
      ctx.emit('recon_failed', { side, secret: true, blocked: true, reason: `Der Flieger bleibt am Boden: ${why}.`, at: { ...(o.target ?? { x: 0, y: 0 }) } });
      continue;
    }
    const air = s.sides[side].air;
    const t = { x: o.target.x, y: o.target.y };
    const foe = otherSide(side);
    air.last = { target: t, turn: ctx.turn };
    air.sorties = (air.sorties | 0) + 1;
    if (Math.floor(ctx.rng() * 100) < AIR.lostPct) {
      air.planes -= 1;
      ctx.emit('plane_lost', {
        side, public: true,
        reason: `Der Flieger über ${cellLabel(t.x, t.y)} zieht eine Rauchfahne und geht hinter dem Wald nieder. Er kommt nicht zurück.`,
        at: t,
      });
      continue;
    }
    // Gruppen
    const seen = [];
    const intel = s.sides[side].intel ?? (s.sides[side].intel = { lastSeen: {} });
    intel.lastSeen ??= {};
    for (const g of ctx.groups(foe)) {
      if (distance(g.pos, t) > AIR.radius || camoAt(s, foe, g.pos.x, g.pos.y)) continue;
      const prev = intel.lastSeen[g.id];
      const e = { pos: { ...g.pos }, turn: ctx.turn + 1, type: g.type, source: 'Flieger' };
      if (prev && (prev.pos.x !== g.pos.x || prev.pos.y !== g.pos.y)) e.from = { ...prev.pos };
      intel.lastSeen[g.id] = e;
      seen.push(g.id);
    }
    // Batterien und Attrappen (von oben nicht zu unterscheiden)
    const art = s.sides[side].artillery;
    let bats = 0;
    for (const b of [...(s.sides[foe].artillery?.batteries ?? [])].sort((p, q) => (p.id < q.id ? -1 : 1))) {
      if (distance(batteryCenter(b), t) > AIR.radius + 1 || hidden(s, foe, { ...b.pos, w: b.w, h: b.h })) continue;
      if (art) { art.known ??= {}; art.known[b.id] = { pos: { ...b.pos }, w: b.w, h: b.h, type: b.type, turn: ctx.turn, label: b.label, source: 'Flieger' }; }
      bats++;
    }
    for (const d of (s.sides[foe].decoys ?? []).filter((x) => !x.wrecked)) {
      const c = { x: d.pos.x + (d.w >> 1), y: d.pos.y + (d.h >> 1) };
      if (distance(c, t) > AIR.radius + 1 || hidden(s, foe, { ...d.pos, w: d.w, h: d.h })) continue;
      if (art) { art.known ??= {}; art.known[d.id] = { pos: { ...d.pos }, w: d.w, h: d.h, type: 'feldhaubitzen', turn: ctx.turn, label: `Batterie bei ${cellLabel(d.pos.x, d.pos.y)}`, source: 'Flieger' }; }
      bats++;
      d.spotted = ctx.turn;
      ctx.emit('decoy_spotted', {
        side: foe, secret: true, decoy: d.id,
        reason: `Der feindliche Flieger kreist über der Attrappe bei ${cellLabel(d.pos.x, d.pos.y)}. Er hat angebissen.`,
        at: c,
      });
    }
    // Depot
    let depot = false;
    if (ctx.map) {
      for (const b of buildingsWithRole(ctx.map, s, foe, 'depot')) {
        const c = { x: b.x + ((b.w ?? 1) >> 1), y: b.y + ((b.h ?? 1) >> 1) };
        if (distance(c, t) > AIR.radius || hidden(s, foe, b)) continue;
        depot = true;
        s.sides[foe].depotSpotted = ctx.turn;
        const intelB = intel.buildings ?? (intel.buildings = {});
        intelB[foe + ':' + b.id] = { side: foe, type: b.type, x: b.x, y: b.y, w: b.w ?? 1, h: b.h ?? 1, turn: ctx.turn, how: 'flieger' };
        ctx.emit('depot_spotted', {
          side: foe, secret: true, by: side,
          reason: `Der feindliche Flieger hat das Depot bei ${cellLabel(c.x, c.y)} gesehen. Morgen fallen dort Granaten.`,
          at: c,
        });
      }
    }
    const parts = [];
    if (seen.length) parts.push(plural(seen.length, 'Gruppe', 'Gruppen'));
    if (bats) parts.push(plural(bats, 'Batterie', 'Batterien'));
    if (depot) parts.push('das Depot');
    ctx.emit('recon', {
      side, secret: true, target: t, groups: seen.length, batteries: bats, depot,
      reason: parts.length
        ? `Der Flieger kreist über ${cellLabel(t.x, t.y)} und meldet ${parts.join(', ')}.`
        : `Der Flieger kreist über ${cellLabel(t.x, t.y)} und sieht nur Acker und Trichter.`,
      at: t,
    });
    ctx.emit('plane_over', {
      side: foe, secret: true, target: t,
      reason: `Ein feindlicher Flieger kreist langsam über ${cellLabel(t.x, t.y)}, als hätte er Zeit. Niemand sieht gern hinauf.`,
      at: t,
    });
  }
}

registerPhase({ id: 'decoy', kind: 'position', order: ORDER.position.works + 6, run: runDecoy });
registerPhase({ id: 'decoy-hits', kind: 'position', order: ORDER.position.artillery + 6, run: runDecoyHits });
registerPhase({ id: 'recon', kind: 'position', order: ORDER.position.movement + 2, run: runRecon });
