// Klangregie (P19): Zuordnung Ereignis -> Klang, Kappung, Stereo, Grundton der Front.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  planCues, registerCue, hasCue, sectionCues, ambienceFor, distanceToOwn, shellCue, MAX_CUES, MAX_SAME, STAGGER,
} from '../js/audio/cues.js';
import { SOUNDS } from '../js/audio/sounds.js';
import { loadMap } from '../js/map.js';
import { createInitialState } from '../js/state.js';
import { resolveTurn } from '../js/resolve.js';
import { planFilm } from '../js/film.js';
import { planMove } from '../js/ui/tools/move.js';
import { createAudioEngine } from '../js/audio/engine.js';
import { FakeAudioContext } from './fake-audio.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const at = (x, y) => ({ x, y });
const ctx = { side: 'a', width: 60, own: [at(10, 10)] };

test('Feuer klingt nach Waffe: MG als MG-Salve, sonst Gewehr, mit Stereo nach Ort', () => {
  const [mg] = planCues([{ type: 'fire', side: 'a', ammo: 2, at: at(45, 9) }], ctx);
  assert.equal(mg.name, 'mg-far');
  assert.equal(mg.opts.x, 45.5);
  assert.equal(mg.opts.width, 60);
  const [rifle] = planCues([{ type: 'fire', side: 'b', ammo: 1, at: at(5, 9) }], ctx);
  assert.equal(rifle.name, 'rifle');
  assert.ok(rifle.opts.intensity > 0 && rifle.opts.intensity <= 1);
});

test('Bewegung: nur die eigene Seite hoert ihre Schritte, ohne Schritt kein Klang', () => {
  assert.equal(planCues([{ type: 'move', side: 'a', steps: 3, at: at(1, 1) }], ctx)[0].name, 'steps');
  assert.equal(planCues([{ type: 'move', side: 'b', steps: 3, at: at(1, 1) }], ctx).length, 0);
  assert.equal(planCues([{ type: 'move', side: 'a', steps: 0, at: at(1, 1) }], ctx).length, 0);
});

test('Gruppe aufgerieben: die Front verstummt (hush)', () => {
  assert.deepEqual(planCues([{ type: 'group_lost', side: 'a', at: at(3, 3) }], ctx).map((c) => c.name), ['hush']);
});

test('Kappung: hoechstens MAX_SAME gleiche und MAX_CUES insgesamt, versetzt um STAGGER', () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ type: 'fire', side: 'a', ammo: i % 2 ? 2 : 1, at: at(i, 0) }));
  const out = planCues(many, ctx);
  assert.ok(out.length <= MAX_CUES);
  for (const name of new Set(out.map((c) => c.name))) assert.ok(out.filter((c) => c.name === name).length <= MAX_SAME);
  out.forEach((c, i) => assert.ok(c.delay >= i * STAGGER - 1e-9));
  for (let i = 1; i < out.length; i++) assert.ok(out[i].delay > out[i - 1].delay);
});

test('Unbekannte Typen, kaputte Eingaben und werfende Haken bleiben still', () => {
  assert.deepEqual(planCues(null, ctx), []);
  assert.deepEqual(planCues([null, { type: 'nichts', at: at(0, 0) }], ctx), []);
  registerCue('test_wirft', () => { throw new Error('boom'); });
  assert.deepEqual(planCues([{ type: 'test_wirft', at: at(0, 0) }], ctx), []);
});

test('registerCue: spaetere Pakete melden eigene Klaenge an, eigene Stereo-Angabe bleibt', () => {
  assert.equal(hasCue('test_draht'), false);
  registerCue('test_draht', () => [{ name: 'pencil', opts: { pan: -0.5 } }]);
  const [c] = planCues([{ type: 'test_draht', at: at(30, 3) }], ctx);
  assert.equal(c.name, 'pencil');
  assert.equal(c.opts.pan, -0.5);
  assert.equal(c.opts.x, undefined);
  assert.throws(() => registerCue('x', 'kein Haken'));
});

test('Vorbelegte Klaenge gibt es alle in der Engine', () => {
  const types = ['move', 'redeploy', 'fire', 'dig', 'rebuild', 'spoil_seen', 'nightfall', 'daybreak', 'ghost_cleared', 'order_invalid', 'assault', 'artillery', 'mine', 'flare', 'supply'];
  for (const type of types) {
    for (const side of ['a', 'b']) {
      for (const c of planCues([{ type, side, steps: 2, ammo: 1, at: at(10, 12) }], ctx)) {
        assert.ok(c.name === 'hush' || SOUNDS[c.name], `${type}: Klang ${c.name} fehlt`);
      }
    }
  }
  for (const c of sectionCues('clock')) assert.ok(SOUNDS[c.name]);
  assert.deepEqual(sectionCues('movement'), []);
});

test('Einschlag nah an eigenen Gruppen ist nah (mit Taubheit), weit weg ist fern', () => {
  assert.equal(distanceToOwn(at(12, 11), [at(10, 10)]), 2);
  assert.equal(distanceToOwn(at(0, 0), []), Infinity);
  const near = shellCue({ at: at(11, 10) }, ctx)[0];
  assert.equal(near.name, 'impact-near');
  assert.ok(near.opts.intensity >= 0.55, 'so nah wird man taub');
  assert.equal(shellCue({ at: at(40, 30) }, ctx)[0].name, 'artillery-far');
  assert.equal(shellCue({ at: at(40, 30) }, { own: [] })[0].name, 'artillery-far');
});

test('Grundton: Gefecht lauter als Stellung, Feuer und Verluste heben ihn, Wetter bringt Regen und Wind', () => {
  const calm = ambienceFor({ darkness: 0.2, kind: 'position' });
  const battle = ambienceFor({ darkness: 0.2, kind: 'battle' });
  assert.ok(battle.battle > calm.battle);
  const hot = ambienceFor({ kind: 'battle', log: [{ type: 'fire' }, { type: 'losses', side: 'a' }, { type: 'group_lost' }] });
  assert.ok(hot.battle > battle.battle);
  assert.equal(calm.rain, 0);
  const storm = ambienceFor({ weather: { kind: 'storm', wind: { speed: 4 } } });
  assert.ok(storm.rain > 0.5 && storm.wind > 0.8);
  assert.equal(ambienceFor({ weather: { kind: 'clear', rain: 0.3 } }).rain, 0.3);
  const junk = ambienceFor({ darkness: NaN, weather: { kind: 'x', wind: { speed: 99 } }, log: Array(500).fill({ type: 'fire' }) });
  for (const v of Object.values(junk)) assert.ok(v >= 0 && v <= 1);
  assert.equal(ambienceFor().darkness, 0);
});

test('Phasenfilm: Telegrammzeilen tragen ihr Ereignis, die Klangregie findet die eigenen Schritte', () => {
  const map = loadMap(read('../data/maps/asse.json'));
  const scen = read('../data/scenarios/asse-frei.json');
  const env = { map };
  const state = createInitialState(map, scen, 11);
  const own = state.groups.filter((g) => g.side === 'a');
  const path = planMove(map, state, own[0], { x: 24, y: 9 }).path;
  const ordersA = [{ group: own[0].id, type: 'redeploy', path }];
  const input = { state, ordersA, ordersB: [], seed: 11, turn: state.turn, env };
  const film = planFilm(input, resolveTurn(state, ordersA, [], 11, state.turn, env), 'a');
  const line = film.lines.find((l) => l.type === 'redeploy');
  assert.ok(line.event, 'Zeile ohne Ereignis');
  assert.equal(line.event.group, own[0].id);
  const cues = planCues(film.lines.map((l) => l.event), { side: 'a', width: map.width });
  assert.ok(cues.some((c) => c.name === 'steps'));
});

test('Engine: hush senkt Umgebung und Musik und holt sie zurueck, ohne Kontext ein No-op', () => {
  let ac = null;
  class Ctx extends FakeAudioContext {
    constructor(o) { super(o); ac = this; }
    createDynamicsCompressor() {
      const n = this.createGain();
      for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) n[k] = { value: 0 };
      return n;
    }
    createAnalyser() { return this.createGain(); }
    resume() { return Promise.resolve(); }
  }
  const win = { AudioContext: Ctx, addEventListener() {}, removeEventListener() {}, document: { visibilityState: 'visible', addEventListener() {} } };
  const e = createAudioEngine({ win });
  assert.equal(e.hush(), false);
  e.unlock();
  ac.currentTime = 5;
  assert.equal(e.hush(2), true);
  // Umgebung und Musik: erst Richtung 0, nach 2 s zurueck zum alten Pegel
  const buses = ac.nodes.filter((n) => n.kind === 'gain' && n.gain.events.some((ev) => ev.type === 'target' && ev.v === 0 && ev.t === 5));
  assert.equal(buses.length, 2);
  for (const n of buses) {
    const back = n.gain.events.find((ev) => ev.type === 'target' && ev.t === 7);
    assert.ok(back && back.v > 0, 'kommt zurueck');
  }
});

test('Zwei Gruppen auf einmal verloren: die Front verstummt nur einmal', () => {
  const out = planCues([{ type: 'group_lost', at: at(1, 1) }, { type: 'group_lost', at: at(2, 2) }], ctx);
  assert.equal(out.filter((c) => c.name === 'hush').length, 1);
});
