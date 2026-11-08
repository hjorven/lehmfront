// Reine Klang-Logik ohne AudioContext: Kurven, Parameter-Abbildung, Ereignisraten, Musikphrasen.
// Alles hier ist in node testbar (test/audio.test.js). Klang ist Optik, deshalb sind
// Math.sin/cos/exp/log hier erlaubt; Zufall kommt trotzdem nur aus createRng.

export const BUSES = ['master', 'music', 'sfx', 'ambience'];

// Startlautstaerken: Musik und Umgebung bewusst leise, die Musik ist eine Schicht, kein Soundtrack.
export const DEFAULT_VOLUMES = { master: 0.8, music: 0.35, sfx: 0.8, ambience: 0.6 };

// Im Hintergrund-Tab nicht ganz stumm, aber deutlich leiser (Plan: reduzierte Lautstaerke).
export const BACKGROUND_GAIN = 0.2;

// Zeitkonstanten in Sekunden fuer setTargetAtTime
export const RAMP = { volume: 0.05, ambience: 1.6, music: 2.5, duck: 0.4 };

export function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function clamp(v, lo, hi) {
  v = Number(v);
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

export function dbToGain(db) { return Math.pow(10, db / 20); }
export function gainToDb(g) { return g <= 0 ? -Infinity : 20 * Math.log10(g); }

// Regler 0..1 -> Verstaerkung. Quadratisch, damit die untere Haelfte des Reglers fein dosiert.
export function sliderToGain(v) {
  const x = clamp01(v);
  return x * x;
}

// Gleichleistungs-Ueberblendung: a^2 + b^2 = 1, keine Lautstaerkedelle in der Mitte.
export function equalPowerFade(t) {
  const x = clamp01(t);
  return { a: Math.cos(x * Math.PI / 2), b: Math.sin(x * Math.PI / 2) };
}

// Weiche S-Kurve fuer Schwellen (z. B. Grillen erst ab Daemmerung)
export function smoothstep(e0, e1, v) {
  if (e0 === e1) return v < e0 ? 0 : 1;
  const t = clamp01((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// Exponentielle Annaeherung, wie setTargetAtTime sie im AudioContext rechnet.
export function approach(current, target, dt, tau) {
  if (tau <= 0) return target;
  return target + (current - target) * Math.exp(-dt / tau);
}

// Stereo-Position: pan direkt (-1..1) hat Vorrang, sonst x relativ zur Breite (0..width).
export function panFrom({ pan, x, width = 1 } = {}) {
  if (Number.isFinite(pan)) return clamp(pan, -1, 1);
  if (Number.isFinite(x) && width > 0) return clamp((x / width) * 2 - 1, -1, 1);
  return 0;
}

// Normalisierte Parameter fuer einen Effekt. intensity 0..1 steuert Lautstaerke und Helligkeit;
// leise Effekte bleiben hoerbar (Mindestpegel), damit ein Regler auf 0,1 nicht nach Fehler klingt.
export function sfxParams(opts = {}) {
  const intensity = Number.isFinite(opts.intensity) ? clamp01(opts.intensity) : 0.7;
  return {
    intensity,
    pan: panFrom(opts),
    gain: 0.15 + 0.85 * intensity,
    brightness: 0.35 + 0.65 * intensity,
  };
}

// Umgebung: Pegel der Dauerschichten aus Tageszeit und Wetter. Werte 0..1, vor der Busverstaerkung.
export function ambienceTargets(input = {}) {
  const darkness = clamp01(input.darkness);
  const rain = clamp01(input.rain);
  const wind = clamp01(input.wind);
  const battle = clamp01(input.battle);
  const quiet = 1 - battle;
  const day = 1 - darkness;
  return {
    // Grundrauschen der Front: nie ganz still, unter Beschuss dichter
    rumble: 0.18 + 0.62 * battle + 0.08 * darkness,
    rain: rain * rain * 0.9 + (rain > 0 ? 0.08 : 0),
    // Regen bringt immer etwas Wind mit
    wind: clamp01(wind * 0.85 + rain * 0.15),
    // Kraehen am Tag: selten, verstummen bei Regen und Gefecht
    crows: day * day * quiet * quiet * (1 - 0.85 * rain),
    // Grillen erst ab der Daemmerung, nicht im Regen, nicht im Gefecht
    crickets: smoothstep(0.45, 0.85, darkness) * quiet * quiet * (1 - rain),
    // Tropfen von Brettern und Draht: nach dem Regen am deutlichsten
    drips: rain * (1 - 0.5 * rain),
  };
}

// Ereignisse pro Sekunde fuer die Einzelklaenge der Umgebung.
export function ambienceRates(input = {}) {
  const darkness = clamp01(input.darkness);
  const battle = clamp01(input.battle);
  const t = ambienceTargets(input);
  return {
    'artillery-far': 0.02 + 0.5 * battle * battle,
    'mg-far': battle > 0.15 ? 0.25 * (battle - 0.15) : 0,
    rifle: battle > 0.05 ? 0.06 + 0.25 * battle : 0.015,
    // Leuchtkugeln erst ab darkness > 0,5 (Plan 7.7)
    flare: darkness > 0.5 ? (0.01 + 0.06 * battle) * smoothstep(0.5, 0.8, darkness) : 0,
    crow: 0.08 * t.crows,
    cricket: 0.9 * t.crickets,
    drip: 1.6 * t.drips,
  };
}

// Wartezeit bis zum naechsten Ereignis (Poisson-Prozess). u aus rng() in [0,1).
export function nextEventDelay(rate, u) {
  if (!(rate > 0)) return Infinity;
  const v = clamp(u, 0, 0.999999);
  return -Math.log(1 - v) / rate;
}

// Musik zieht sich unter Beschuss zurueck und kommt erst zoegernd wieder (Ueberraschung K1).
export function musicLevel(battle) {
  return 1 - smoothstep(0.2, 0.55, clamp01(battle));
}

// Gehoer nach einem nahen Einschlag: Tiefpass-Grenzfrequenz ueber die Zeit seit dem Einschlag.
// Sofort dumpf (~450 Hz), nach etwa drei Sekunden wieder offen.
export const MUFFLE = { low: 450, open: 18000, hold: 0.35, recover: 3.2 };
export function muffleCutoff(t, strength = 1) {
  const s = clamp01(strength);
  if (t < 0 || s === 0) return MUFFLE.open;
  const low = MUFFLE.open * Math.pow(MUFFLE.low / MUFFLE.open, s);
  if (t <= MUFFLE.hold) return low;
  const k = clamp01((t - MUFFLE.hold) / MUFFLE.recover);
  // logarithmisch zwischen low und open, damit das Ohr es als gleichmaessiges Aufklaren hoert
  const e = k * k * (3 - 2 * k);
  return low * Math.pow(MUFFLE.open / low, e);
}

// Ab welcher Staerke ein naher Einschlag taub macht
export function muffleStrength(intensity) {
  const i = clamp01(intensity);
  return i < 0.55 ? 0 : (i - 0.55) / 0.45;
}

export function midiToHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

// D-Aeolisch ohne Sexte: karg, kein Dur-Pathos
export const MUSIC_SCALE = [0, 2, 3, 5, 7, 10];
export const MUSIC_ROOT = 50; // D3

// Eine Phrase: wenige Toene, viel Pause. rng aus createRng. Rueckgabe sortiert nach t.
// bars Takte zu je beat*4 Sekunden; hoechstens ein Ton pro Schlag, meist weniger.
export function musicPhrase(rng, { bars = 4, beat = 1.6, density = 0.32, root = MUSIC_ROOT } = {}) {
  const notes = [];
  let degree = 0;
  for (let b = 0; b < bars * 4; b++) {
    const r = rng();
    if (r > density) continue;
    // kleine Schritte bevorzugen, damit es nach Melodie klingt, nicht nach Zufall
    const step = rng() < 0.6 ? (rng() < 0.5 ? -1 : 1) : (rng() < 0.5 ? -2 : 2);
    degree = clamp(degree + step, -2, MUSIC_SCALE.length + 2);
    const len = MUSIC_SCALE.length;
    const oct = Math.floor(degree / len);
    const idx = ((degree % len) + len) % len;
    const midi = root + 12 * oct + MUSIC_SCALE[idx] + 12;
    notes.push({ t: b * beat, midi, dur: beat * (1.5 + rng() * 2), vel: 0.45 + rng() * 0.35 });
  }
  // Phrase endet auf dem Grundton oder der Quinte, damit sie ruht
  if (notes.length) {
    const last = notes[notes.length - 1];
    last.midi = rng() < 0.6 ? root + 12 : root + 19;
    last.dur = beat * 4;
  }
  return notes;
}

// Bordun der Phrase: Grundton tief, darueber gelegentlich die Quinte
export function droneFor(rng, root = MUSIC_ROOT) {
  return rng() < 0.7 ? [root - 12] : [root - 12, root - 5];
}

// Wie viele Stimmen gleichzeitig: aeltere leise Stimmen weichen, die Engine bleibt bezahlbar.
export const MAX_VOICES = 28;
export function shouldDropVoice(active, max = MAX_VOICES) {
  return active >= max;
}
