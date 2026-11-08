// Karge Musik-Schicht: ein leiser Bordun und wenige Harmonium-Toene in D-Aeolisch, viel Stille.
// Kein Heldenpathos, keine Trommeln. Unter Beschuss zieht sich die Musik zurueck (musicLevel)
// und setzt danach zoegernd mit einem einzelnen Ton wieder ein.

import { musicPhrase, droneFor, musicLevel, midiToHz, MUSIC_ROOT, RAMP } from './logic.js';
import { envelope } from './sounds.js';

const BEAT = 1.6;
const BARS = 4;

export function createMusic(ac, out, rng) {
  const level = ac.createGain();
  level.gain.value = 1;
  level.connect(out);
  let active = false;
  let nextPhrase = 0;
  let current = 1;
  let lone = false;
  const phrases = new Set();

  function note(dest, t, midi, dur, vel) {
    const g = ac.createGain();
    g.gain.value = 0;
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700 + vel * 600;
    lp.connect(g);
    g.connect(dest);
    const end = envelope(g.gain, t, 0.5, 0.11 * vel, Math.max(0, dur - 0.5), 1.8);
    // zwei leicht verstimmte Zungen wie beim Harmonium
    for (const cents of [-5, 5]) {
      const o = ac.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midiToHz(midi) * Math.pow(2, cents / 1200);
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.02);
    }
    return end;
  }

  function drone(dest, t, midi, len) {
    const g = ac.createGain();
    g.gain.value = 0;
    g.connect(dest);
    const end = envelope(g.gain, t, 3, 0.07, Math.max(0, len - 6), 3);
    const o = ac.createOscillator();
    o.type = 'sine';
    o.frequency.value = midiToHz(midi);
    o.connect(g);
    o.start(t);
    o.stop(end + 0.02);
    return end;
  }

  function schedulePhrase(t) {
    const bus = ac.createGain();
    bus.gain.value = 1;
    bus.connect(level);
    const notes = lone
      ? [{ t: 0, midi: MUSIC_ROOT + 12, dur: BEAT * 4, vel: 0.5 }]
      : musicPhrase(rng, { bars: BARS, beat: BEAT });
    lone = false;
    let end = t;
    const len = BARS * 4 * BEAT;
    if (notes.length > 1) for (const m of droneFor(rng)) end = Math.max(end, drone(bus, t, m, len));
    for (const n of notes) end = Math.max(end, note(bus, t + n.t, n.midi, n.dur, n.vel));
    const entry = { bus, end };
    phrases.add(entry);
    // nach dem letzten Ton aufraeumen
    setTimeout(() => { if (phrases.delete(entry)) bus.disconnect(); }, Math.max(0, end - ac.currentTime + 0.5) * 1000);
    return Math.max(end, t + len);
  }

  return {
    get active() { return active; },

    start() {
      if (active) return;
      active = true;
      level.gain.cancelScheduledValues(ac.currentTime);
      level.gain.setTargetAtTime(current, ac.currentTime, 0.5);
      nextPhrase = ac.currentTime + 1.5;
    },

    stop() {
      if (!active) return;
      active = false;
      const t = ac.currentTime;
      // laufende und schon geplante Phrasen ausblenden, dann abklemmen
      for (const p of phrases) {
        p.bus.gain.cancelScheduledValues(t);
        p.bus.gain.setTargetAtTime(0, t, 0.4);
        const entry = p;
        setTimeout(() => { if (phrases.delete(entry)) entry.bus.disconnect(); }, 2500);
      }
    },

    setBattle(battle) {
      const target = musicLevel(battle);
      if (current < 0.3 && target >= 0.7) lone = true;
      const t = ac.currentTime;
      level.gain.cancelScheduledValues(t);
      // schnell weg, langsam zurueck
      level.gain.setTargetAtTime(active ? target : 0, t, target < current ? 0.6 : RAMP.music * 2);
      current = target;
    },

    tick(now, lookahead, hidden) {
      if (!active || now + lookahead < nextPhrase) return;
      if (hidden || current < 0.05) { nextPhrase = now + 4; return; }
      // nicht jede Phrase spielt: Stille gehoert dazu
      if (rng() < 0.25) { nextPhrase = now + 8 + rng() * 10; return; }
      const end = schedulePhrase(Math.max(nextPhrase, now + 0.05));
      nextPhrase = end + 3 + rng() * 9;
    },
  };
}
