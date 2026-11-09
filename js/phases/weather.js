// Phasen fuer Wetter, Schlamm, Entwaesserung und Leuchtkugeln (Plan 4.1 Nr. 6, 7.7, 10.6 Schritt 2 und 4).
// Regeln stehen in js/weather.js, hier nur der Ablauf und die Meldungen.
// - weather (Stellungsrunde, Schritt 2): Wetter wuerfeln, Naesse fortschreiben, Regen fuellt Graeben (Senken zuerst),
//   Wasser laeuft ab, Moral sinkt bei Gruppen, die im Schlamm oder im Wasser stehen.
// - drain (Stellungsrunde, Schritt 4): Befehl "Entwaessern" legt Lattenrost und Pumpensumpf in einen Grabenabschnitt.
// - flares (beide Rundenarten, nach der Bewegung, vor dem Feuer): Leuchtkugeln auf Befehl, und Posten schiessen
//   von selbst, wenn sie nachts Bewegung hoeren. Der Kreis ist eine Runde lang taghell (js/sight.js).
// Gefechtsrunden wuerfeln kein Wetter: sie erben Wetter und Tageszeit ihrer Stellungsrunde.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel, distance, neighbors } from '../map.js';
import { cellKey, getCell, patchCell, otherSide } from '../state.js';
import { darknessAt } from '../ui/daytime.js';
import { surname } from './hold.js';
import { addStepCostRule } from './move.js';
import { reportOpen } from '../config/reports.js';
import {
  rollWeather, stepWet, stepSnow, snowAt, snowMoveCost, SNOW_COLD, SNOW_WORDS, MAX_WET, waterGain, waterLoss, mudAt, mudMoveCost, trenchOf, isSink, flareAt, flareProblem,
  MAX_WATER, MUD_MORALE, WATER_MORALE, FLARE_RADIUS, FLARE_HEAR, FLARE_DARKNESS, WEATHER_NAMES, MUD_IN, WATER_IN,
} from '../weather.js';

/** Material fuer eine Entwaesserung (Lattenrost, Pumpe) */
export const DRAIN_COST = 2;
/** Felder je Entwaesserung: das Zielfeld und bis zu zwei angrenzende Grabenfelder */
export const DRAIN_CELLS = 3;
/** Selbsttaetige Leuchtkugeln je Seite und Runde */
export const AUTO_FLARES = 2;
/** Wahrscheinlichkeit, dass ein Posten Bewegung in Hoerweite bemerkt */
export const HEAR_CHANCE = 0.75;

const name = (g) => 'Gruppe ' + surname(g.leader.name);
const mapSideOf = (side) => (side === 'a' ? 'own' : 'enemy');

function center(state) {
  return { x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) };
}

/** Alle Grabenfelder (Karte und Spielzustand), sortiert nach y, dann x */
export function trenchCells(state, map) {
  const out = new Map();
  if (map?.cells) for (const c of map.cells) if (c.trench) out.set(cellKey(c.x, c.y), { x: c.x, y: c.y });
  for (const k of Object.keys(state.cells)) {
    const [x, y] = k.split(',').map(Number);
    if (state.cells[k].trench) out.set(k, { x, y });
    else if (Object.hasOwn(state.cells[k], 'trench')) out.delete(k);
  }
  return [...out.values()].sort((p, q) => p.y - q.y || p.x - q.x);
}

function weatherSentence(w, wet) {
  const ground = wet >= 3 ? 'Der Boden ist grundlos.' : wet === 2 ? 'Der Boden ist aufgeweicht.' : wet === 1 ? 'Der Boden wird weich.' : '';
  switch (w.kind) {
    case 'rain': return `Regen setzt ein. ${ground}`.trim();
    case 'storm': return `Wolkenbruch, starker Wind. ${ground}`.trim();
    case 'fog': return 'Nebel liegt über dem Abschnitt. Sicht stark eingeschränkt.';
    case 'snow': return 'Es schneit. Der Schnee schluckt die Geräusche, jeder Schritt wird schwer.';
    case 'overcast': return `Der Himmel zieht zu. ${ground}`.trim();
    default: return wet ? `Es klart auf. ${ground}`.trim() : 'Es klart auf, der Boden trocknet.';
  }
}

function runWeather(ctx) {
  const s = ctx.state, map = ctx.map;
  const prev = s.weather ?? { kind: 'clear', rain: 0, wind: { dir: 'w', speed: 1 } };
  const prevKind = prev.kind;
  let w = { ...prev, wind: { ...(prev.wind ?? { dir: 'w', speed: 1 }) } };
  if (!prev.fixed) w = { ...w, ...rollWeather(ctx.rng, prev) };
  // P24: mit Windvorhersage (Gas) bestimmt die Gasphase den Wind, nicht der Wetterwurf
  if (prev.windForecast) w.wind = { ...(prev.wind ?? { dir: 'w', speed: 1 }) };
  w.rain = w.rain ?? (w.kind === 'storm' ? 1 : w.kind === 'rain' ? 0.6 : 0);
  w.fog = w.fog ?? (w.kind === 'fog' ? 0.8 : 0);
  const prevWet = prev.wet ?? 0;
  w.wet = stepWet(prevWet, w.kind, s.night);
  // Schnee (nur wenn es ihn gibt oder er faellt): Tauwasser macht den Boden nass
  const prevSnow = prev.snow ?? 0;
  if (prevSnow || w.kind === 'snow') {
    const sn = stepSnow(prevSnow, w.kind, s.night);
    w.snow = sn.snow;
    if (sn.melt) w.wet = Math.min(MAX_WET, w.wet + Math.min(2, sn.melt));
    if (sn.snow !== prevSnow) {
      ctx.emit('snow', {
        snow: sn.snow, from: prevSnow, melt: sn.melt, minor: sn.snow > 0 && sn.melt === 0 && prevSnow > 0,
        reason: sn.snow > prevSnow ? `Neuschnee: ${SNOW_WORDS[sn.snow]}. Bewegung kostet Kraft${sn.snow >= 2 ? ', Wege dauern länger' : ''}.`
          : sn.snow === 0 ? 'Tauwetter: Der Schnee ist weg, das Tauwasser weicht den Lehm auf.'
            : `Tauwetter: noch ${SNOW_WORDS[sn.snow]}, der Boden wird nass.`,
        at: center(s),
      });
    }
  }
  if (w.wet > 0) w.wasWet = true;
  s.weather = w;
  if (w.kind !== prevKind || w.wet !== prevWet) {
    ctx.emit('weather', {
      kind: w.kind, from: prevKind, wet: w.wet,
      minor: w.kind === prevKind,
      reason: w.kind === prevKind && w.wet > prevWet ? `Weiter ${WEATHER_NAMES[w.kind]}. ${weatherSentence(w, w.wet).replace(/^[^.]*\.\s*/, '')}`.trim()
        : w.kind === prevKind ? 'Der Boden trocknet ab.' : weatherSentence(w, w.wet),
      at: center(s),
    });
  }

  // Regen fuellt Graeben, zuerst in Senken; ohne Regen laeuft das Wasser ab
  const flooded = { own: [], enemy: [] };
  for (const p of trenchCells(s, map)) {
    const before = getCell(s, p.x, p.y)?.water ?? 0;
    const after = Math.max(0, Math.min(MAX_WATER, before + waterGain(s, map, p.x, p.y, w.kind) - waterLoss(s, p.x, p.y, w.kind)));
    if (after === before) continue;
    if (after === 0 && Object.keys(getCell(s, p.x, p.y) ?? {}).length === 1) delete s.cells[cellKey(p.x, p.y)];
    else patchCell(s, p.x, p.y, { water: after });
    if (after >= 2 && before < 2) {
      const tr = trenchOf(s, map, p.x, p.y);
      if (tr?.side === 'own' || tr?.side === 'enemy') flooded[tr.side].push({ ...p, sink: isSink(map, p.x, p.y) });
    }
  }
  for (const side of ['a', 'b']) {
    const list = flooded[mapSideOf(side)];
    if (!list.length) continue;
    const first = list.find((c) => c.sink) ?? list[0];
    ctx.emit('flood', {
      side, secret: true, cells: list.length,
      reason: `Wasser steht in ${list.length} ${list.length === 1 ? 'Grabenfeld' : 'Grabenfeldern'}, ${first.sink ? 'zuerst in der Senke' : 'am tiefsten'} bei ${cellLabel(first.x, first.y)}. Entwässern hilft.`,
      at: { x: first.x, y: first.y },
    });
  }

  // Kaelte: bei hohem Schnee frieren nachts die Posten vorn, die nicht im Unterstand sitzen
  for (const g of ctx.groups()) {
    if (!s.night) break;
    const sn = snowAt(s, map, g.pos.x, g.pos.y);
    const cold = SNOW_COLD[sn] ?? 0;
    if (!cold || g.inDugout || g.status === 'rest') continue;
    g.morale = Math.max(0, g.morale - cold);
    ctx.emit('snow_cold', {
      side: g.side, group: g.id, secret: true, minor: true, amount: cold,
      reason: `${name(g)} friert im Schnee bei ${cellLabel(g.pos.x, g.pos.y)}: Moral sinkt um ${cold}. Im Unterstand wäre es wärmer.`,
      at: { ...g.pos },
    });
  }

  // Schlamm und Wasser druecken auf die Moral (nur wer drin steht, Unterstand schuetzt nicht vor Naesse)
  for (const g of ctx.groups()) {
    const m = mudAt(s, map, g.pos.x, g.pos.y);
    const water = getCell(s, g.pos.x, g.pos.y)?.water ?? 0;
    const loss = (MUD_MORALE[m] ?? 0) + (WATER_MORALE[water] ?? 0);
    if (!loss) continue;
    g.morale = Math.max(0, g.morale - loss);
    const what = water >= 2 ? `steht ${WATER_IN[water]}` : `liegt ${MUD_IN[m]}`;
    ctx.emit('mud_morale', {
      side: g.side, group: g.id, secret: true, minor: true, amount: loss,
      reason: `${name(g)} ${what} (${cellLabel(g.pos.x, g.pos.y)}): Moral sinkt um ${loss}.`,
      at: { ...g.pos },
    });
  }
}

// Das Wetter der naechsten zwoelf Stunden wird am Ende der Stellungsrunde gewuerfelt (kurz vor der Uhr), damit der
// Spieler beim Planen schon das Wetter und den Schlamm sieht, die in der Runde gelten (Plan 7.7: "Der Spieler sieht
// beim Planen das, was gilt"). Abweichung von Plan 10.6 Schritt 2, wo es am Anfang steht.
export const WEATHER_ORDER = ORDER.position.clock - 5;
registerPhase({ id: 'weather', kind: 'position', order: WEATHER_ORDER, run: runWeather });

// Schlamm bremst jede Bewegung (Plan 4.1 Nr. 6): Zusatzkosten je Feld, auch in der Vorschau
addStepCostRule((state, map, p) => mudMoveCost(state, map, p.x, p.y));
// Schnee bremst zusaetzlich (ab Knoecheltiefe)
addStepCostRule((state, map, p) => snowMoveCost(state, map, p.x, p.y));

// ---------- Entwaesserung ----------

/** Felder, die eine Entwaesserung am Zielfeld erfasst: Zielfeld plus angrenzende Grabenfelder (sortiert) */
export function drainCells(state, map, target) {
  const out = [{ x: target.x, y: target.y }];
  if (!map?.cells) return out;
  const near = neighbors(map, target.x, target.y, { diagonal: true })
    .filter((c) => trenchOf(state, map, c.x, c.y) && !getCell(state, c.x, c.y)?.drain)
    .sort((p, q) => p.y - q.y || p.x - q.x);
  for (const c of near) {
    if (out.length >= DRAIN_CELLS) break;
    out.push({ x: c.x, y: c.y });
  }
  return out;
}

registerOrderValidator('drain', (order, group, state, env) => {
  const t = order.target;
  if (!reportOpen(state, group.side, 'lattenroste')) return 'Entwässern erst nach dem Erfahrungsbericht Lattenroste';
  if (!trenchOf(state, env.map, t.x, t.y)) return 'Entwässern geht nur in einem Graben';
  if (distance(group.pos, t) > 1) return 'Die Gruppe muss im Graben oder daneben stehen';
  if (getCell(state, t.x, t.y)?.drain) return 'Dieser Abschnitt ist schon entwässert';
  return null;
});

function runDrain(ctx) {
  const s = ctx.state;
  for (const o of ctx.ordersOfType('drain')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    const sup = s.sides[g.side].supplies;
    if ((sup.material ?? 0) < DRAIN_COST) {
      ctx.emit('drain_failed', {
        side: g.side, group: g.id, secret: true, blocked: true,
        reason: `${name(g)} kann nicht entwässern: es fehlt Material (${DRAIN_COST} nötig, ${sup.material ?? 0} da).`,
        at: { ...o.target },
      });
      continue;
    }
    sup.material -= DRAIN_COST;
    const cells = drainCells(s, ctx.map, o.target);
    for (const c of cells) {
      const water = getCell(s, c.x, c.y)?.water ?? 0;
      patchCell(s, c.x, c.y, { drain: 1, water: Math.max(0, water - 2) });
    }
    ctx.emit('drain', {
      side: g.side, group: g.id, secret: true, cells: cells.map((c) => ({ ...c })), material: DRAIN_COST,
      reason: `${name(g)} legt Lattenrost und Pumpensumpf in ${cells.length} ${cells.length === 1 ? 'Grabenfeld' : 'Grabenfelder'} bei ${cellLabel(o.target.x, o.target.y)}. Das Wasser läuft ab.`,
      at: { ...o.target },
    });
  }
}

registerPhase({ id: 'drain', kind: 'position', order: ORDER.position.works + 5, run: runDrain });

// ---------- Leuchtkugeln ----------

/** Dunkelheit der Tageszeit (ohne Wetter), dieselbe Zahl wie die Optik */
export function timeDarkness(state) {
  return darknessAt(state.clock, state.turnKind, state.night);
}

registerOrderValidator('flare', (order, group, state) => flareProblem(group, order.target, timeDarkness(state)));

function runFlares(ctx) {
  const s = ctx.state;
  s.flares = [];
  if (timeDarkness(s) <= FLARE_DARKNESS) return;
  const add = (f) => { s.flares.push(f); return f; };

  // Auf Befehl
  for (const o of ctx.ordersOfType('flare')) {
    const g = ctx.group(o.group);
    if (!g || g.status === 'lost') continue;
    add({ x: o.target.x, y: o.target.y, r: FLARE_RADIUS, side: g.side, auto: false, turn: ctx.turn });
    ctx.emit('flare', {
      side: g.side, group: g.id, public: true, target: { ...o.target },
      reason: `Leuchtkugel über ${cellLabel(o.target.x, o.target.y)}. Für einen Augenblick ist es taghell.`,
      at: { ...o.target },
    });
  }

  // Posten hoeren Bewegung und schiessen von selbst (je Seite hoechstens AUTO_FLARES)
  for (const side of ['a', 'b']) {
    const sentries = ctx.groups(side).filter((g) => !g.moved && !g.inDugout);
    const movers = ctx.groups(otherSide(side)).filter((g) => g.moved);
    let n = 0;
    for (const m of movers) {
      if (n >= AUTO_FLARES) break;
      if (flareAt(s, m.pos)) continue;
      const near = sentries.filter((g) => distance(g.pos, m.pos) <= FLARE_HEAR);
      if (!near.length) continue;
      if (ctx.rng() >= HEAR_CHANCE) continue;
      n++;
      add({ x: m.pos.x, y: m.pos.y, r: FLARE_RADIUS, side, auto: true, turn: ctx.turn });
      ctx.emit('flare', {
        side, public: true, auto: true, target: { ...m.pos },
        reason: `Posten hören Bewegung und schießen eine Leuchtkugel über ${cellLabel(m.pos.x, m.pos.y)}.`,
        at: { ...m.pos },
      });
    }
  }

  // Wer sich im Licht bewegt, ist verraten
  for (const g of ctx.groups()) {
    if (!g.moved || !flareAt(s, g.pos)) continue;
    ctx.emit('flare_exposed', {
      side: g.side, group: g.id, secret: true, blocked: true,
      reason: `${name(g)} gerät ins Licht einer Leuchtkugel bei ${cellLabel(g.pos.x, g.pos.y)}. Der Feind kann sie sehen.`,
      at: { ...g.pos },
    });
  }
}

registerPhase({
  id: 'flares',
  kind: 'both',
  order: { position: ORDER.position.movement + 9, battle: ORDER.battle.movement + 9 },
  run: runFlares,
});
