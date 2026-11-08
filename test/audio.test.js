import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clamp01, dbToGain, gainToDb, sliderToGain, equalPowerFade, smoothstep, approach, panFrom, sfxParams,
  ambienceTargets, ambienceRates, nextEventDelay, musicLevel, muffleCutoff, muffleStrength, MUFFLE,
  musicPhrase, MUSIC_SCALE, MUSIC_ROOT, midiToHz, shouldDropVoice, MAX_VOICES,
} from '../js/audio/logic.js';
import { SOUNDS, CATALOG, noiseBuffer, envelope } from '../js/audio/sounds.js';
import { createAmbience } from '../js/audio/ambience.js';
import { createAudioEngine } from '../js/audio/engine.js';
import { createRng } from '../js/rng.js';
import { FakeAudioContext } from './fake-audio.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('clamp01 faengt NaN und Grenzen ab', () => {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(-2), 0);
  assert.equal(clamp01(3), 1);
  assert.equal(clamp01('0.5'), 0.5);
});

test('dB und Verstaerkung sind invers', () => {
  close(dbToGain(-6), 0.501187, 1e-6);
  close(gainToDb(dbToGain(-12.5)), -12.5, 1e-9);
  assert.equal(gainToDb(0), -Infinity);
});

test('Regler: 0 ist still, 1 ist voll, monoton', () => {
  assert.equal(sliderToGain(0), 0);
  assert.equal(sliderToGain(1), 1);
  let last = -1;
  for (let i = 0; i <= 20; i++) { const g = sliderToGain(i / 20); assert.ok(g >= last); last = g; }
});

test('Gleichleistungs-Ueberblendung haelt die Leistung konstant', () => {
  for (let i = 0; i <= 10; i++) {
    const { a, b } = equalPowerFade(i / 10);
    close(a * a + b * b, 1, 1e-12);
  }
  close(equalPowerFade(0).a, 1); close(equalPowerFade(1).b, 1);
  close(equalPowerFade(-5).a, 1);
});

test('smoothstep ist an den Raendern 0 und 1 und in der Mitte 0,5', () => {
  assert.equal(smoothstep(0.2, 0.6, 0), 0);
  assert.equal(smoothstep(0.2, 0.6, 1), 1);
  close(smoothstep(0.2, 0.6, 0.4), 0.5);
});

test('approach naehert sich exponentiell und ueberschiesst nie', () => {
  let v = 0;
  for (let i = 0; i < 50; i++) { const n = approach(v, 1, 0.1, 0.5); assert.ok(n > v && n < 1); v = n; }
  close(approach(0, 1, 0.5, 0.5), 1 - Math.exp(-1));
  assert.equal(approach(0, 1, 0.1, 0), 1);
});

test('Stereo: pan hat Vorrang, x wird auf die Breite bezogen und begrenzt', () => {
  assert.equal(panFrom({ pan: 0.3, x: 0 }), 0.3);
  assert.equal(panFrom({ x: 0, width: 60 }), -1);
  assert.equal(panFrom({ x: 30, width: 60 }), 0);
  assert.equal(panFrom({ x: 90, width: 60 }), 1);
  assert.equal(panFrom({}), 0);
  assert.equal(panFrom({ pan: 5 }), 1);
});

test('sfxParams: Standardwerte und Mindestpegel', () => {
  const d = sfxParams();
  assert.equal(d.intensity, 0.7);
  assert.equal(d.pan, 0);
  assert.ok(sfxParams({ intensity: 0 }).gain > 0);
  assert.ok(sfxParams({ intensity: 1 }).gain <= 1);
  assert.ok(sfxParams({ intensity: 1 }).brightness > sfxParams({ intensity: 0.2 }).brightness);
});

test('Umgebung: Grillen nur nachts, Kraehen nur am Tag', () => {
  const day = ambienceTargets({ darkness: 0 });
  const night = ambienceTargets({ darkness: 1 });
  assert.equal(day.crickets, 0);
  assert.ok(night.crickets > 0.9);
  assert.ok(day.crows > 0.9);
  assert.equal(night.crows, 0);
});

test('Umgebung: Gefecht verdraengt Tiere und hebt das Grollen', () => {
  const calm = ambienceTargets({ darkness: 1, battle: 0 });
  const hot = ambienceTargets({ darkness: 1, battle: 1 });
  assert.equal(hot.crickets, 0);
  assert.ok(hot.rumble > calm.rumble);
  assert.ok(calm.rumble > 0, 'die Front ist nie ganz still');
});

test('Umgebung: Regen bringt Wind und Tropfen, ohne Regen kein Regen', () => {
  assert.equal(ambienceTargets({ rain: 0 }).rain, 0);
  assert.equal(ambienceTargets({ rain: 0 }).drips, 0);
  const r = ambienceTargets({ rain: 1, wind: 0 });
  assert.ok(r.rain > 0.9 && r.wind > 0 && r.drips > 0);
});

test('Umgebung: alle Pegel bleiben in 0..1, auch bei Unsinn', () => {
  for (const input of [{}, { darkness: 2, rain: -1, wind: NaN, battle: 9 }, { darkness: 0.5, rain: 0.5, wind: 0.5, battle: 0.5 }]) {
    for (const [k, v] of Object.entries(ambienceTargets(input))) assert.ok(v >= 0 && v <= 1, `${k}=${v}`);
  }
});

test('Ereignisraten: Leuchtkugeln erst ab darkness > 0,5, MG erst im Gefecht', () => {
  assert.equal(ambienceRates({ darkness: 0.5, battle: 1 }).flare, 0);
  assert.ok(ambienceRates({ darkness: 0.9, battle: 0.5 }).flare > 0);
  assert.equal(ambienceRates({ battle: 0 })['mg-far'], 0);
  assert.ok(ambienceRates({ battle: 1 })['mg-far'] > 0);
  assert.ok(ambienceRates({ battle: 1 })['artillery-far'] > ambienceRates({ battle: 0 })['artillery-far']);
  for (const name of Object.keys(ambienceRates({}))) assert.ok(SOUNDS[name], 'Klang fehlt: ' + name);
});

test('Wartezeit: Rate 0 heisst nie, Mittelwert passt zur Rate', () => {
  assert.equal(nextEventDelay(0, 0.5), Infinity);
  assert.ok(Number.isFinite(nextEventDelay(2, 0.9999999)));
  const rng = createRng(3);
  let sum = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) sum += nextEventDelay(2, rng());
  close(sum / n, 0.5, 0.05);
});

test('Musik zieht sich unter Beschuss zurueck', () => {
  assert.equal(musicLevel(0), 1);
  assert.equal(musicLevel(1), 0);
  assert.ok(musicLevel(0.3) < 1 && musicLevel(0.3) > 0);
});

test('Taubheit: sofort dumpf, nach der Erholung wieder offen, dazwischen monoton', () => {
  close(muffleCutoff(0, 1), MUFFLE.low, 1e-6);
  close(muffleCutoff(MUFFLE.hold + MUFFLE.recover + 1, 1), MUFFLE.open, 1e-6);
  assert.equal(muffleCutoff(0, 0), MUFFLE.open);
  assert.equal(muffleCutoff(-1, 1), MUFFLE.open);
  let last = 0;
  for (let t = 0; t <= 4; t += 0.1) { const f = muffleCutoff(t, 1); assert.ok(f >= last - 1e-9); last = f; }
  assert.ok(muffleCutoff(0, 0.5) > muffleCutoff(0, 1), 'schwaecherer Einschlag macht weniger taub');
  assert.equal(muffleStrength(0.3), 0);
  close(muffleStrength(1), 1);
});

test('Musikphrase: deterministisch, nur Skalentoene, sparsam, endet auf Ruhe', () => {
  const a = musicPhrase(createRng(42));
  const b = musicPhrase(createRng(42));
  assert.deepEqual(a, b);
  for (let seed = 1; seed < 40; seed++) {
    const notes = musicPhrase(createRng(seed));
    assert.ok(notes.length <= 16, 'hoechstens ein Ton pro Schlag');
    for (let i = 1; i < notes.length; i++) assert.ok(notes[i].t > notes[i - 1].t);
    for (const n of notes) {
      const pc = (((n.midi - MUSIC_ROOT) % 12) + 12) % 12;
      assert.ok(MUSIC_SCALE.includes(pc), `Ton ${n.midi} nicht in der Skala`);
      assert.ok(n.vel > 0 && n.vel <= 1);
    }
    if (notes.length) {
      const pc = (((notes.at(-1).midi - MUSIC_ROOT) % 12) + 12) % 12;
      assert.ok(pc === 0 || pc === 7);
    }
  }
});

test('midiToHz: A4 = 440 Hz, Oktave verdoppelt', () => {
  close(midiToHz(69), 440);
  close(midiToHz(81), 880);
});

test('Stimmenbegrenzung', () => {
  assert.equal(shouldDropVoice(MAX_VOICES - 1), false);
  assert.equal(shouldDropVoice(MAX_VOICES), true);
});

test('Braunrauschen-Schleife knackt nicht: Anfang gleich Ende, Pegel begrenzt', () => {
  const ac = new FakeAudioContext();
  const d = noiseBuffer(ac, 'brown').getChannelData(0);
  close(d[0], d[d.length - 1], 1e-6);
  let peak = 0;
  for (const v of d) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak <= 0.9 + 1e-6 && peak > 0.5);
  assert.equal(noiseBuffer(ac, 'brown'), noiseBuffer(ac, 'brown'), 'Puffer wird wiederverwendet');
});

test('Huelle beginnt bei 0 und endet bei 0', () => {
  const ac = new FakeAudioContext();
  const g = ac.createGain();
  const end = envelope(g.gain, 1, 0.01, 0.5, 0.1, 0.2);
  assert.equal(g.gain.events[0].v, 0);
  assert.equal(g.gain.events.at(-1).v, 0);
  close(end, 1.32, 1e-9);
});

test('Katalog: jeder Eintrag hat einen Klang, alle geforderten Klaenge sind da', () => {
  const required = ['paper', 'pencil', 'stamp', 'teletype', 'tick', 'clock-lock', 'artillery-far', 'impact-near',
    'mg-far', 'rifle', 'whistle', 'flare', 'rain', 'wind', 'lore', 'steps'];
  const names = CATALOG.map((c) => c.name);
  for (const r of required) assert.ok(names.includes(r), 'fehlt im Katalog: ' + r);
  for (const c of CATALOG) assert.equal(typeof SOUNDS[c.name], 'function');
});

// Jeder Klang: alle Quellen starten nicht vor t, stoppen sicher bis end, Huellen beginnen und enden bei 0
for (const name of Object.keys(SOUNDS)) {
  test(`Klang ${name}: knackfrei und endlich`, () => {
    for (const intensity of [0, 0.5, 1]) {
      const ac = new FakeAudioContext();
      const out = ac.createGain();
      const pan = ac.createStereoPanner();
      const t = 2;
      const p = { ...sfxParams({ intensity }), panParam: pan.pan };
      const res = SOUNDS[name](ac, out, p, t, createRng(11));
      assert.ok(Number.isFinite(res.end) && res.end > t, 'Endzeit fehlt');
      assert.ok(res.end - t < 12, 'Klang dauert zu lange');
      const sources = ac.nodes.filter((n) => n.kind === 'osc' || n.kind === 'buffer');
      assert.ok(sources.length > 0);
      for (const s of sources) {
        assert.ok(s.startAt >= t - 1e-9, 'startet vor t');
        assert.ok(Number.isFinite(s.stopAt), 'Quelle ohne stop()');
        assert.ok(s.stopAt <= res.end + 0.05 + 1e-9, `stoppt nach Ende (${s.stopAt} > ${res.end})`);
      }
      for (const g of ac.nodes.filter((n) => n.kind === 'gain' && n !== out && n.gain.events.length)) {
        const ev = g.gain.events;
        assert.equal(ev[0].v, 0, 'Huelle beginnt nicht bei 0');
        assert.ok(ev[0].t >= t - 1e-9);
        assert.equal(ev.at(-1).v, 0, 'Huelle endet nicht bei 0');
        assert.ok(ev.at(-1).t <= res.end + 1e-9);
      }
      if (name === 'impact-near') assert.ok(res.impact > t);
    }
  });
}

test('Umgebung: stop beendet alle Dauerquellen, Takt plant danach nichts mehr', () => {
  const ac = new FakeAudioContext();
  const out = ac.createGain();
  const played = [];
  const amb = createAmbience(ac, out, (name, when) => played.push({ name, when }), createRng(5));
  amb.set({ darkness: 1, battle: 1, rain: 1, wind: 1 });
  amb.start();
  for (let i = 0; i < 400; i++) { ac.currentTime = i * 0.25; amb.tick(ac.currentTime, 0.6, false); }
  assert.ok(played.length > 20, 'im Gefecht passiert etwas');
  assert.ok(played.every((p) => p.name !== 'crow' && p.name !== 'cricket'), 'keine Tiere im Gefecht');
  const loops = ac.nodes.filter((n) => n.kind === 'buffer');
  assert.ok(loops.length >= 3);
  const end = amb.stop();
  for (const s of loops) assert.ok(Number.isFinite(s.stopAt) && s.stopAt <= end);
  const before = played.length;
  for (let i = 400; i < 500; i++) { ac.currentTime = i * 0.25; amb.tick(ac.currentTime, 0.6, false); }
  assert.equal(played.length, before);
});

test('Umgebung: im Hintergrund-Tab keine Einzelklaenge, danach kein Nachholen', () => {
  const ac = new FakeAudioContext();
  const played = [];
  const amb = createAmbience(ac, ac.createGain(), (name, when) => played.push({ name, when }), createRng(5));
  amb.set({ battle: 1 });
  amb.start();
  for (let i = 0; i < 100; i++) { ac.currentTime = i * 0.25; amb.tick(ac.currentTime, 0.6, true); }
  assert.equal(played.length, 0);
  ac.currentTime = 600;
  amb.tick(600, 0.6, false);
  assert.ok(played.length < 10, 'nach langer Pause kein Schwall');
  assert.ok(played.every((p) => p.when >= 600));
});

test('Engine ohne Browser ist ein stiller No-op', () => {
  const e = createAudioEngine({ win: undefined });
  assert.equal(e.playSfx('paper'), false);
  e.setAmbience({ darkness: 1 });
  e.setVolume('music', 0.5);
  assert.equal(e.getVolume('music'), 0.5);
  assert.throws(() => e.setVolume('laut', 1));
  e.stopAll();
  assert.equal(e.state().ready, false);
});

test('Umgebung: steigt das Gefecht, kommt die Artillerie bald statt erst nach einer Minute', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const ac = new FakeAudioContext();
    const played = [];
    const amb = createAmbience(ac, ac.createGain(), (name, when) => played.push({ name, when }), createRng(seed));
    amb.set({ battle: 0 });
    amb.start();
    amb.tick(0, 0.6, false);
    amb.set({ battle: 1 });
    for (let i = 1; i <= 120; i++) { ac.currentTime = i * 0.25; amb.tick(ac.currentTime, 0.6, false); }
    assert.ok(played.some((p) => p.name === 'artillery-far'), `Seed ${seed}: 30 s Trommelfeuer ohne Artillerie`);
  }
});

test('Umgebung: Unsinn als Eingabe bricht den Takt nicht, nichts wird in der Vergangenheit geplant', () => {
  const ac = new FakeAudioContext();
  const played = [];
  const amb = createAmbience(ac, ac.createGain(), (name, when) => played.push({ name, when, now: ac.currentTime }), createRng(9));
  amb.set({ wind: undefined, rain: 'x', battle: NaN, darkness: 1 });
  amb.start();
  for (let i = 0; i < 200; i++) {
    ac.currentTime = i * 0.25;
    for (const g of ac.nodes.filter((n) => n.kind === 'gain')) for (const e of g.gain.events) assert.ok(!Number.isNaN(e.v));
    amb.tick(ac.currentTime, 0.6, false);
  }
  assert.ok(played.every((p) => p.when >= p.now));
});
