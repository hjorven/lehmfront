// Umgebung: Dauerschichten (Grundrauschen der Front, Regen, Wind) plus verstreute Einzelklaenge
// (ferne Artillerie, MG, Schuesse, Leuchtkugeln, Kraehen, Grillen, Tropfen).
// Pegel kommen aus ambienceTargets, Ereignisraten aus ambienceRates (logic.js). Ueberblendet wird
// mit setTargetAtTime, also ohne Spruenge. stop() blendet aus und beendet alle Quellen.

import { ambienceTargets, ambienceRates, nextEventDelay, clamp01, RAMP } from './logic.js';
import { noiseBuffer } from './sounds.js';

// Hoechstpegel je Schicht, bevor der Umgebungsbus greift
const LAYER_MAX = { rumble: 0.9, rain: 0.45, wind: 0.75 };

// Staerke der verstreuten Klaenge: ferne Dinge bleiben leise und dumpf
const ONE_SHOT = {
  'artillery-far': (rng) => ({ intensity: 0.3 + rng() * 0.5 }),
  'mg-far': (rng) => ({ intensity: 0.25 + rng() * 0.4 }),
  rifle: (rng) => ({ intensity: 0.12 + rng() * 0.3 }),
  flare: (rng) => ({ intensity: 0.25 + rng() * 0.25 }),
  crow: (rng) => ({ intensity: 0.4 + rng() * 0.4 }),
  cricket: (rng) => ({ intensity: 0.5 + rng() * 0.5 }),
  drip: (rng) => ({ intensity: 0.4 + rng() * 0.6 }),
};

export function createAmbience(ac, out, playOneShot, rng) {
  let layers = null;
  let input = { darkness: 0, rain: 0, wind: 0, battle: 0 };
  let active = false;
  const next = {};
  let nextGust = 0;

  function loop(kind, dest) {
    const s = ac.createBufferSource();
    const buf = noiseBuffer(ac, kind);
    s.buffer = buf;
    s.loop = true;
    s.connect(dest);
    s.start(ac.currentTime, rng() * (buf.duration - 0.5));
    return s;
  }

  function chain(...nodes) {
    for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
    return nodes[0];
  }

  function makeFilter(type, f, q) {
    const n = ac.createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    if (q !== undefined) n.Q.value = q;
    return n;
  }

  function silentGain() {
    const g = ac.createGain();
    g.gain.value = 0;
    return g;
  }

  function build() {
    const L = {};
    // Grundrauschen der Front: tiefes, fernes Grollen
    L.rumble = silentGain();
    L.rumble.connect(out);
    const rumbleLp = makeFilter('lowpass', 130, 0.7);
    rumbleLp.connect(L.rumble);
    L.rumbleSrc = loop('brown', rumbleLp);

    // Regen: breites Rauschen plus Prasseln auf Holz und Blech
    L.rain = silentGain();
    L.rain.connect(out);
    const rainIn = chain(makeFilter('highpass', 450), makeFilter('lowpass', 6500), L.rain);
    const patterLevel = ac.createGain();
    patterLevel.gain.value = 0.35;
    const patter = chain(makeFilter('bandpass', 2800, 0.8), patterLevel, L.rain);
    L.rainSrc = loop('white', rainIn);
    L.rainSrc.connect(patter);

    // Wind: Braunrauschen durch wandernden Bandpass, Boeen ueber eigenen Verstaerker
    L.wind = silentGain();
    L.wind.connect(out);
    L.gust = ac.createGain();
    L.gust.gain.value = 1;
    L.gust.connect(L.wind);
    L.windBp = makeFilter('bandpass', 380, 0.9);
    L.windBp.connect(L.gust);
    L.windSrc = loop('brown', L.windBp);
    return L;
  }

  function applyLevels(tau = RAMP.ambience) {
    if (!layers) return;
    const t = ac.currentTime;
    const lv = ambienceTargets(input);
    for (const k of ['rumble', 'rain', 'wind']) {
      layers[k].gain.cancelScheduledValues(t);
      layers[k].gain.setTargetAtTime(active ? lv[k] * LAYER_MAX[k] : 0, t, tau);
    }
  }

  return {
    get active() { return active; },
    get input() { return { ...input }; },

    set(partial = {}) {
      const clean = {};
      for (const k of ['darkness', 'rain', 'wind', 'battle']) if (k in partial) clean[k] = clamp01(partial[k]);
      const before = ambienceRates(input);
      input = { ...input, ...clean };
      const after = ambienceRates(input);
      // steigt eine Rate, die Restwartezeit entsprechend verkuerzen (sonst schweigt die Artillerie noch eine Minute)
      const now = ac.currentTime;
      for (const name of Object.keys(next)) {
        if (after[name] > before[name] && before[name] > 0 && next[name] > now) {
          next[name] = now + (next[name] - now) * before[name] / after[name];
        }
      }
      applyLevels();
    },

    start() {
      if (active) return;
      if (!layers) layers = build();
      active = true;
      applyLevels();
    },

    // Ausblenden und alle Quellen beenden. Liefert die Zeit, ab der Ruhe ist.
    stop() {
      if (!active && !layers) return ac.currentTime;
      active = false;
      for (const k in next) delete next[k];
      if (!layers) return ac.currentTime;
      applyLevels(0.4);
      const end = ac.currentTime + 2.5;
      const L = layers;
      layers = null;
      for (const s of [L.rumbleSrc, L.rainSrc, L.windSrc]) s.stop(end);
      return end;
    },

    // Vom Engine-Takt aufgerufen. hidden: Hintergrund-Tab, dann keine Einzelklaenge.
    tick(now, lookahead, hidden) {
      if (!active) return;
      const rates = ambienceRates(input);
      for (const name of Object.keys(rates).sort()) {
        const rate = rates[name];
        if (!(rate > 0)) { delete next[name]; continue; }
        // nach langer Pause (Hintergrund-Tab, Drosselung) nicht alles nachholen
        if (next[name] === undefined || next[name] < now - 1) next[name] = now + nextEventDelay(rate, rng());
        let guard = 0;
        while (next[name] <= now + lookahead && guard++ < 8) {
          // nie in der Vergangenheit planen: sonst setzt die Huelle mittendrin ein
          if (!hidden && next[name] >= now) playOneShot(name, next[name], { ...ONE_SHOT[name](rng), pan: rng() * 1.6 - 0.8 });
          next[name] += nextEventDelay(rate, rng());
        }
      }
      // Windboeen
      if (layers && now >= nextGust) {
        const w = Math.max(input.wind, 0.15);
        layers.windBp.frequency.setTargetAtTime(220 + rng() * 520 * (0.5 + w), now, 1.2);
        layers.gust.gain.setTargetAtTime(0.55 + rng() * 0.7, now, 0.9);
        nextGust = now + 1.5 + rng() * 3.5;
      }
    },
  };
}
