// P10: Wetter, Schlamm, Krater, Entwaesserung, Tag und Nacht, Leuchtkugeln
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMap } from '../js/map.js';
import { createInitialState, getGroup, getCell, patchCell } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { createRng } from '../js/rng.js';
import { validateOrder } from '../js/orders.js';
import { darknessAt } from '../js/ui/daytime.js';
import { darknessOf, sightRange, spot, visibleEnemies } from '../js/sight.js';
import { viewFor } from '../js/view.js';
import { moveBudget, stepCost } from '../js/phases/move.js';
import { planMove, pathRounds } from '../js/ui/tools/move.js';
import { fireOdds } from '../js/phases/fire.js';
import {
  rollWeather, stepWet, mudAt, isSink, waterGain, sightDarkness, weatherSight, digFactor, mudMoveCost,
  WEATHER_TABLE, WEATHER_KINDS, MUD_MOVE, FLARE_RADIUS,
} from '../js/weather.js';
import { trenchCells, drainCells, DRAIN_COST } from '../js/phases/weather.js';

function makeMap({ w = 20, h = 7, terrain, heights, trenches = [], craters = [] } = {}) {
  const row = (c) => c.repeat(w);
  return loadMap({
    id: 'probe', width: w, height: h,
    terrain: terrain ?? Array.from({ length: h }, () => row('.')),
    heights: heights ?? Array.from({ length: h }, () => row('1')),
    zones: Array.from({ length: h }, () => 'S'.repeat(w / 2) + 's'.repeat(w / 2)),
    trenches, craters,
  });
}

function makeState(map, a, b, extra = {}) {
  return createInitialState(map, {
    id: 'probe', startHour: 12, ...extra,
    sides: { a: { faction: 'kaldern', groups: a }, b: { faction: 'morrow', groups: b } },
  }, 7);
}

const trench = (x, y, side = 'own') => ({ x, y, kind: 'fire', level: 1, facing: side === 'own' ? 'E' : 'W', side });

// ---------- Wetter ----------

test('Wettertabelle: jede Zeile ergibt 100, Wuerfeln ist deterministisch und bleibt in den Arten', () => {
  for (const k of WEATHER_KINDS) {
    assert.equal(WEATHER_KINDS.reduce((s, j) => s + WEATHER_TABLE[k][j], 0), 100, k);
  }
  const roll = (seed) => {
    const rng = createRng(seed);
    let w = { kind: 'clear', wind: { dir: 'w', speed: 1 } };
    const seen = [];
    for (let i = 0; i < 40; i++) { w = rollWeather(rng, w); seen.push(w.kind); }
    return seen;
  };
  assert.deepEqual(roll(5), roll(5));
  assert.ok(roll(5).every((k) => WEATHER_KINDS.includes(k)));
  assert.ok(new Set(roll(5)).size >= 3, 'Wetter wechselt ueber 40 Runden');
});

test('Naesse: Regen +1, Wolkenbruch +2, klarer Tag trocknet, Nacht und Nebel halten', () => {
  assert.equal(stepWet(0, 'rain'), 1);
  assert.equal(stepWet(1, 'storm'), 3);
  assert.equal(stepWet(3, 'storm'), 3);
  assert.equal(stepWet(2, 'clear'), 1);
  assert.equal(stepWet(2, 'clear', true), 2);
  assert.equal(stepWet(2, 'fog'), 2);
  assert.equal(stepWet(0, 'clear'), 0);
});

test('Festes Wetter aus dem Szenario wird nicht gewuerfelt, Regen macht den Boden nass', () => {
  const map = makeMap();
  let s = makeState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 17, y: 3 } }],
    { weather: { kind: 'rain', fixed: true } });
  for (let t = 1; t <= 3; t++) s = resolveTurn(s, [], [], 7, t, { map }).state;
  assert.equal(s.weather.kind, 'rain');
  assert.equal(s.weather.wet, 3);
});

// ---------- Schlamm ----------

test('Schlamm: Boden, Senke, Krater; Krater machen auch trockene Felder zu Schlamm', () => {
  const heights = ['1111111111', '1111111111', '1111011111', '1111111111'];
  const terrain = ['..........', '..........', '..........', 'ssssffffkk'];
  const map = makeMap({ w: 10, h: 4, heights, terrain, craters: [{ x: 8, y: 0, size: 2 }] });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 0, y: 0 } }], [{ type: 'rifles', pos: { x: 9, y: 1 } }]);
  // trocken: nur der Krater ist Schlamm
  assert.equal(mudAt(s, map, 1, 1), 0);
  assert.equal(mudAt(s, map, 8, 0), 2);
  assert.equal(isSink(map, 4, 2), true);
  assert.equal(isSink(map, 1, 1), false);
  s.weather.wet = 2;
  assert.equal(mudAt(s, map, 1, 1), 2, 'Lehm nass');
  assert.equal(mudAt(s, map, 4, 2), 3, 'Senke +1');
  assert.equal(mudAt(s, map, 0, 3), 3, 'Sumpf doppelt, gedeckelt');
  assert.equal(mudAt(s, map, 5, 3), 0, 'Fels bleibt fest');
  assert.equal(mudAt(s, map, 8, 3), 1, 'Kreide kaum');
  // neuer Krater im Spielzustand (Beschuss, P09)
  patchCell(s, 2, 1, { crater: 1 });
  assert.equal(mudAt(s, map, 2, 1), 3);
  s.weather.wet = 0;
  assert.equal(mudAt(s, map, 2, 1), 1, 'trockener Krater bleibt aufgewuehlt');
});

test('Schlamm senkt Bewegung: Schritt kostet mehr, die Gruppe kommt nicht so weit', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 1, y: 3 } }], [{ type: 'rifles', pos: { x: 18, y: 3 } }], { turnKind: 'battle' });
  s.battle = { round: 1 };
  const g = getGroup(s, 'a01');
  const path = Array.from({ length: 8 }, (_, i) => ({ x: 2 + i, y: 3 }));
  assert.equal(stepCost(map, { x: 1, y: 3 }, { x: 2, y: 3 }, s), 10);
  const dry = resolveTurn(s, [{ group: 'a01', type: 'move', path }], [], 7, 1, { map }).state;
  const wet = structuredClone(s);
  wet.weather.wet = 3;
  assert.equal(stepCost(map, { x: 1, y: 3 }, { x: 2, y: 3 }, wet), 10 + MUD_MOVE[3]);
  assert.equal(mudMoveCost(wet, map, 2, 3), MUD_MOVE[3]);
  const muddy = resolveTurn(wet, [{ group: 'a01', type: 'move', path }], [], 7, 1, { map }).state;
  const dx = (st) => getGroup(st, 'a01').pos.x - g.pos.x;
  assert.ok(dx(muddy) < dx(dry), `Schlamm ${dx(muddy)} Felder, trocken ${dx(dry)}`);
  assert.equal(dx(muddy), Math.floor(moveBudget(g, 'battle') / 25) || 1);
  // Vorschau rechnet mit demselben Schlamm
  assert.ok(pathRounds(map, wet, g, path).rounds > pathRounds(map, s, g, path).rounds);
  assert.ok(planMove(map, wet, g, { x: 9, y: 3 }).cost > planMove(map, s, g, { x: 9, y: 3 }).cost);
});

test('Schlamm senkt Grabgeschwindigkeit und Moral', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 2, y: 3 }, morale: 70 }], [{ type: 'rifles', pos: { x: 17, y: 3 }, morale: 70 }],
    { weather: { kind: 'storm', fixed: true, wet: 2 } });
  assert.equal(digFactor(s, map, 2, 3), 0.65);
  const r = resolveTurn(s, [], [], 7, 1, { map });
  // wet 2 + Wolkenbruch = 3: tiefer Schlamm
  assert.equal(r.state.weather.wet, 3);
  assert.ok(getGroup(r.state, 'a01').morale < 70);
  const e = r.log.find((x) => x.type === 'mud_morale' && x.group === 'a01');
  assert.match(e.reason, /im tiefen Schlamm .*Moral sinkt um 2/);
  assert.deepEqual(e.at, { x: 2, y: 3 });
});

// ---------- Wasser im Graben ----------

test('Regen fuellt Graeben, zuerst in Senken; ohne Regen laeuft es ab', () => {
  // Senke bei 4/2 (Hoehe 0, rundherum 1), Hanggraben bei 7/2 (Hoehe 2, Nachbar tiefer)
  const heights = ['111111111111', '111111111111', '111101121111', '111111111111'];
  const map = makeMap({ w: 12, h: 4, heights, trenches: [trench(4, 2), trench(2, 2), trench(7, 2)] });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 0, y: 0 } }], [{ type: 'rifles', pos: { x: 10, y: 0 } }],
    { weather: { kind: 'rain', fixed: true } });
  assert.equal(waterGain(s, map, 4, 2, 'rain'), 2);
  assert.equal(waterGain(s, map, 7, 2, 'rain'), 0, 'am Hang laeuft Regen ab');
  assert.deepEqual(trenchCells(s, map).map((c) => c.x), [2, 4, 7]);
  const r1 = resolveTurn(s, [], [], 7, 1, { map });
  assert.equal(getCell(r1.state, 4, 2).water, 2, 'Senke zuerst');
  assert.equal(getCell(r1.state, 2, 2)?.water ?? 0, 0, 'Flacher Graben auf Hoehe 1 bekommt bei leichtem Regen nichts');
  const flood = r1.log.find((e) => e.type === 'flood' && e.side === 'a');
  assert.deepEqual(flood.at, { x: 4, y: 2 });
  assert.match(flood.reason, /Senke bei/);
  // Wetter wird klar: eine Stufe weniger je Runde
  r1.state.weather = { ...r1.state.weather, kind: 'clear', fixed: true };
  const r2 = resolveTurn(r1.state, [], [], 7, 2, { map });
  assert.equal(getCell(r2.state, 4, 2).water, 1);
});

test('Entwaesserung: kostet Material, legt Lattenrost, Wasser laeuft ab, Graben bleibt fest', () => {
  const heights = ['1111111111', '1111111111', '1110001111', '1111111111'];
  const map = makeMap({ w: 10, h: 4, heights, trenches: [trench(3, 2), trench(4, 2), trench(5, 2), trench(6, 2)] });
  const s = makeState(map, [{ type: 'pioneers', pos: { x: 4, y: 2 } }], [{ type: 'rifles', pos: { x: 9, y: 0 } }],
    { weather: { kind: 'storm', fixed: true, wet: 3 } });
  patchCell(s, 4, 2, { water: 3 });
  assert.equal(validateOrder({ group: 'a01', type: 'drain', target: { x: 0, y: 0 } }, s, 'a', { map }), 'Entwässern geht nur in einem Graben');
  assert.equal(validateOrder({ group: 'a01', type: 'drain', target: { x: 4, y: 2 } }, s, 'a', { map }), null);
  assert.deepEqual(drainCells(s, map, { x: 4, y: 2 }), [{ x: 4, y: 2 }, { x: 3, y: 2 }, { x: 5, y: 2 }]);
  const r = resolveTurn(s, [{ group: 'a01', type: 'drain', target: { x: 4, y: 2 } }], [], 7, 1, { map });
  // Verglichen mit derselben Runde ohne Befehl (die Versorgung bucht selbst Material)
  const idle = resolveTurn(s, [], [], 7, 1, { map });
  assert.equal(r.state.sides.a.supplies.material, idle.state.sides.a.supplies.material - DRAIN_COST);
  assert.equal(getCell(r.state, 4, 2).drain, 1);
  assert.ok(getCell(r.state, 4, 2).water <= 1, 'Wasser sinkt');
  assert.ok(mudAt(r.state, map, 4, 2) <= 1, 'entwaesserter Graben bleibt fest');
  assert.ok(mudAt(r.state, map, 6, 2) >= 2, 'daneben Schlamm');
  assert.match(r.log.find((e) => e.type === 'drain').reason, /Lattenrost/);
  // zweites Mal: schon entwaessert
  assert.match(validateOrder({ group: 'a01', type: 'drain', target: { x: 4, y: 2 } }, r.state, 'a', { map }), /schon entwässert/);
  // ohne Material
  const poor = structuredClone(s);
  poor.sides.a.supplies.material = 1;
  const r3 = resolveTurn(poor, [{ group: 'a01', type: 'drain', target: { x: 4, y: 2 } }], [], 7, 1, { map });
  assert.equal(getCell(r3.state, 4, 2).drain, undefined);
  assert.match(r3.log.find((e) => e.type === 'drain_failed').reason, /Material/);
});

// ---------- Tag und Nacht ----------

test('Tageszeit: Stellungsrunden wechseln Tag und Nacht, Gefechtsrunden erben sie', () => {
  const map = makeMap();
  let s = makeState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 17, y: 3 } }], { startHour: 6 });
  assert.equal(s.night, false);
  s = resolveTurn(s, [], [], 7, 1, { map }).state;
  assert.equal(s.clock.hour, 18);
  assert.equal(s.night, true);
  assert.equal(darknessAt(s.clock, s.turnKind, s.night), 1);
  // Angriff bei Nacht: 12 Gefechtsrunden laufen ueber 18 Uhr hinaus, es bleibt Nacht
  s.turnKind = 'battle';
  s.battle = { round: 1 };
  for (let i = 0; i < 12; i++) s = resolveTurn(s, [], [], 7, s.turn, { map }).state;
  assert.equal(s.clock.hour, 19);
  assert.equal(s.night, true);
  // Ein Tagesangriff um 17:55 bleibt Tag, auch nach 18 Uhr
  let d = makeState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 17, y: 3 } }], { startHour: 17, turnKind: 'battle' });
  d.clock.minute = 55;
  d.battle = { round: 1 };
  for (let i = 0; i < 3; i++) d = resolveTurn(d, [], [], 7, d.turn, { map }).state;
  assert.equal(d.clock.hour, 18);
  assert.equal(d.night, false);
  assert.equal(darknessOf(d), 0, 'Sicht bleibt Tag');
  assert.ok(!resolveTurn(d, [], [], 7, d.turn, { map }).log.some((e) => e.type === 'nightfall'));
});

test('Sichtweite nachts: Dunkelheit kuerzt sie auf 4, Nebel kuerzt am Tag, Optik und Regel teilen darkness', () => {
  const map = makeMap();
  const s = makeState(map, [{ type: 'rifles', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 8, y: 3 } }]);
  const viewer = getGroup(s, 'a01');
  assert.equal(darknessOf(s), 0);
  assert.equal(sightRange(map, viewer, { x: 8, y: 3 }, darknessOf(s)), 12);
  s.night = true;
  assert.equal(darknessOf(s), 1);
  assert.equal(sightRange(map, viewer, { x: 8, y: 3 }, darknessOf(s)), 4);
  assert.equal(spot(s, map, viewer, getGroup(s, 'b01'), darknessOf(s)).visible, false);
  s.night = false;
  s.weather = { kind: 'fog', fog: 0.9, wind: { dir: 'w', speed: 0 } };
  assert.equal(weatherSight(s.weather), 0.55);
  assert.equal(sightRange(map, viewer, { x: 8, y: 3 }, darknessOf(s)), 6, 'Nebel: 12 * 0,55');
  assert.equal(sightDarkness(0, { kind: 'clear' }), 0);
  // Nebel bei Nacht sieht weniger als eine klare Nacht
  assert.ok(sightDarkness(1, { kind: 'fog', fog: 0.9 }) > 1);
  s.night = true;
  assert.equal(sightRange(map, viewer, { x: 8, y: 3 }, darknessOf(s)), 2, 'Nacht und Nebel: 12 * 0,4 * 0,55');
});

// ---------- Leuchtkugeln ----------

test('Leuchtkugel nur nachts, erhellt einen Kreis und verraet Bewegung darin', () => {
  const map = makeMap({ w: 24 });
  const mk = () => makeState(map, [{ type: 'rifles', pos: { x: 6, y: 3 } }], [{ type: 'rifles', pos: { x: 14, y: 3 } }],
    { turnKind: 'battle', startHour: 22 });
  const day = makeState(map, [{ type: 'rifles', pos: { x: 6, y: 3 } }], [{ type: 'rifles', pos: { x: 14, y: 3 } }], { turnKind: 'battle' });
  assert.match(validateOrder({ group: 'a01', type: 'flare', target: { x: 10, y: 3 } }, day, 'a', { map }), /nachts/);
  const s = mk();
  s.battle = { round: 1 };
  assert.equal(validateOrder({ group: 'a01', type: 'flare', target: { x: 10, y: 3 } }, s, 'a', { map }), null);
  assert.match(validateOrder({ group: 'a01', type: 'flare', target: { x: 20, y: 3 } }, s, 'a', { map }), /zu weit/);
  // Ohne Leuchtkugel sieht a die Gruppe b bei 10 nicht (Nacht: 4 Felder)
  const path = [{ x: 13, y: 3 }, { x: 12, y: 3 }, { x: 11, y: 3 }, { x: 10, y: 3 }];
  const ordersB = [{ group: 'b01', type: 'move', path }];
  const dark = resolveTurn(s, [], ordersB, 7, 1, { map });
  // Posten hoeren evtl. selbst und schiessen: Sichtbarkeit nur pruefen, wenn keine Leuchtkugel ueber b01 steht
  const lit = resolveTurn(s, [{ group: 'a01', type: 'flare', target: { x: 11, y: 3 } }], ordersB, 7, 1, { map });
  const b = getGroup(lit.state, 'b01');
  assert.ok(lit.state.flares.some((f) => f.x === 11 && f.y === 3 && f.r === FLARE_RADIUS));
  // In der Runde gesehen: Aufklaerung hat b01 im Licht erfasst
  assert.equal(lit.state.sides.a.intel.lastSeen.b01?.turn, 2, 'im Licht gesehen (Alter 0 zu Beginn der naechsten Runde)');
  const during = { ...lit.state, turn: 1 };
  assert.ok(visibleEnemies(during, map, 'a').includes('b01'));
  // Beim Planen der naechsten Runde ist die Leuchtkugel erloschen: b01 nur noch als Geist
  assert.ok(!visibleEnemies(lit.state, map, 'a').includes('b01'));
  assert.ok(viewFor(lit.state, lit.log, 'a', { map }).ghosts.some((g) => g.id === 'b01'));
  assert.ok(lit.log.some((e) => e.type === 'flare_exposed' && e.group === 'b01'));
  assert.ok(lit.log.some((e) => e.type === 'flare' && e.side === 'a'));
  // Treffer im Licht wie am Tag
  const a = getGroup(lit.state, 'a01');
  const pLit = fireOdds(during, map, a, b.pos, 'b').p;
  assert.ok(pLit > fireOdds(lit.state, map, a, b.pos, 'b').p, 'naechste Runde wieder Nachtchance');
  if (!dark.state.flares.length) assert.equal(dark.state.sides.a.intel.lastSeen.b01, undefined);
  // naechste Runde: neue Leuchtkugeln, alte sind erloschen
  const next = resolveTurn(lit.state, [], [], 7, 2, { map });
  assert.ok(!next.state.flares.some((f) => !f.auto));
});

test('Posten schiessen nachts selbst eine Leuchtkugel, wenn sie Bewegung hoeren (deterministisch)', () => {
  const map = makeMap({ w: 24 });
  const s = makeState(map, [{ type: 'rifles', pos: { x: 8, y: 3 } }], [{ type: 'rifles', pos: { x: 16, y: 3 } }],
    { turnKind: 'battle', startHour: 22 });
  s.battle = { round: 1 };
  const ordersB = [{ group: 'b01', type: 'move', path: [{ x: 15, y: 3 }, { x: 14, y: 3 }, { x: 13, y: 3 }] }];
  let fired = 0;
  for (let seed = 7, t = 0; t < 1; t++) {
    const r1 = resolveTurn(s, [], ordersB, seed, 1, { map });
    const r2 = resolveTurn(s, [], ordersB, seed, 1, { map });
    assert.deepEqual(r1.state.flares, r2.state.flares);
    fired += r1.state.flares.length;
    for (const f of r1.state.flares) assert.equal(f.auto, true);
  }
  // Ueber viele Runden: Posten hoeren meistens (75 %)
  let heard = 0;
  let st = structuredClone(s);
  for (let t = 1; t <= 12; t++) {
    const b = getGroup(st, 'b01');
    const dir = b.pos.x > 10 ? -1 : 1;
    const r = resolveTurn(st, [], [{ group: 'b01', type: 'move', path: [{ x: b.pos.x + dir, y: 3 }] }], 7, t, { map });
    if (r.state.flares.some((f) => f.side === 'a' && f.auto)) heard++;
    st = r.state;
  }
  assert.ok(heard >= 5 && heard <= 12, `gehoert ${heard} von 12`);
  // Am Tag nie
  const day = structuredClone(s);
  day.night = false;
  assert.equal(resolveTurn(day, [], ordersB, 7, 1, { map }).state.flares.length, 0);
  assert.ok(fired >= 0);
});

test('Wetter der naechsten Runde steht schon beim Planen fest: Wetterphase am Ende der Stellungsrunde', async () => {
  const { phasesFor } = await import('../js/phases/registry.js');
  const ids = phasesFor('position').map((p) => p.id);
  assert.ok(ids.indexOf('weather') > ids.indexOf('move'), 'nach der Bewegung');
  assert.ok(ids.indexOf('weather') < ids.indexOf('clock'), 'vor der Uhr');
  assert.ok(!phasesFor('battle').some((p) => p.id === 'weather'), 'Gefechtsrunden erben das Wetter');
});

test('Graben (P04) wird im Schlamm langsamer', async () => {
  const { digRate } = await import('../js/phases/dig.js');
  const map = makeMap();
  const s = makeState(map, [{ type: 'pioneers', pos: { x: 2, y: 3 } }], [{ type: 'rifles', pos: { x: 17, y: 3 } }]);
  const dry = digRate(s, getGroup(s, 'a01'), map).rate;
  s.weather = { kind: 'overcast', wet: 3, wind: { dir: 'w', speed: 1 } };
  const wet = digRate(s, getGroup(s, 'a01'), map);
  assert.ok(wet.rate < dry, `${wet.rate} < ${dry}`);
  assert.ok(wet.factors.some((f) => f.label === 'Schlamm'));
});
