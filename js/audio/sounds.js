// Klaenge als Funktionen, komplett prozedural mit WebAudio (keine Aufnahmen).
// Jede Funktion: (ac, out, p, t, rng) -> { end, impact? }
//   ac   AudioContext (oder kompatible Attrappe in Tests)
//   out  Eingang, an den der Klang angeschlossen wird (Stimme mit Panner)
//   p    { gain, pan, intensity, brightness, ...Optionen } aus sfxParams
//   t    Startzeit in ac-Zeit
//   rng  createRng-Funktion fuer Variation
// Regeln gegen Knackser: jede Huelle beginnt bei 0 und endet bei 0, jede Quelle hat ein festes stop().
// Keine Quelle laeuft ohne Ende: auch Schleifenpuffer bekommen stop(end).

import { createRng } from '../rng.js';

const buffers = new WeakMap();

// Rauschpuffer einmal pro AudioContext erzeugen. 'brown' ist so korrigiert,
// dass Anfang und Ende gleich sind und die Schleife nicht knackt.
export function noiseBuffer(ac, kind = 'white') {
  let cache = buffers.get(ac);
  if (!cache) { cache = {}; buffers.set(ac, cache); }
  if (cache[kind]) return cache[kind];
  const rate = ac.sampleRate;
  const len = Math.floor(rate * (kind === 'brown' ? 4 : 3));
  const buf = ac.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  const rng = createRng(kind === 'brown' ? 1916 : 1917);
  if (kind === 'brown') {
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.985 + (rng() * 2 - 1) * 0.15;
      d[i] = last;
    }
    // linearen Drift entfernen: d[0] == d[len-1]
    const a = d[0], b = d[len - 1];
    let peak = 0;
    for (let i = 0; i < len; i++) {
      d[i] -= a + (b - a) * (i / (len - 1));
      peak = Math.max(peak, Math.abs(d[i]));
    }
    const k = peak > 0 ? 0.9 / peak : 1;
    for (let i = 0; i < len; i++) d[i] *= k;
  } else {
    for (let i = 0; i < len; i++) d[i] = rng() * 2 - 1;
  }
  cache[kind] = buf;
  return buf;
}

// Kleine Bausteine -------------------------------------------------------------------------

const SILENT = 0.0001;

// Huelle: 0 -> peak (linear, attack) -> halten -> exponentiell auf fast 0 -> exakt 0. Gibt Endzeit zurueck.
export function envelope(param, t, attack, peak, hold, release) {
  const a = Math.max(0.002, attack);
  const r = Math.max(0.01, release);
  const pk = Math.max(SILENT * 2, peak);
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(pk, t + a);
  if (hold > 0) param.setValueAtTime(pk, t + a + hold);
  const tEnd = t + a + Math.max(0, hold) + r;
  param.exponentialRampToValueAtTime(SILENT, tEnd);
  param.linearRampToValueAtTime(0, tEnd + 0.01);
  return tEnd + 0.01;
}

function gainNode(ac, dest) {
  const g = ac.createGain();
  g.gain.value = 0;
  g.connect(dest);
  return g;
}

function filter(ac, type, freq, q, dest) {
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  if (q !== undefined) f.Q.value = q;
  f.connect(dest);
  return f;
}

// Rauschquelle mit zufaelligem Einstieg in den Puffer, startet bei t, stoppt bei end
function noise(ac, kind, dest, t, end, rng) {
  const s = ac.createBufferSource();
  const buf = noiseBuffer(ac, kind);
  s.buffer = buf;
  s.loop = true;
  s.connect(dest);
  s.start(t, rng() * (buf.duration - 0.5));
  s.stop(end);
  return s;
}

function osc(ac, type, freq, dest, t, end) {
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (dest) o.connect(dest);
  o.start(t);
  o.stop(end);
  return o;
}

// Rauschstoss durch Filterkette: [typ, freq, q] ... -> Huelle. Gibt Endzeit zurueck.
function burst(ac, out, t, rng, { kind = 'white', filters = [], attack, peak, hold = 0, release }) {
  const g = gainNode(ac, out);
  let dest = g;
  for (let i = filters.length - 1; i >= 0; i--) {
    const [type, f, q] = filters[i];
    dest = filter(ac, type, f, q, dest);
  }
  const end = envelope(g.gain, t, attack, peak, hold, release);
  noise(ac, kind, dest, t, end + 0.02, rng);
  return end;
}

// Ton mit Tonhoehenverlauf f0 -> f1 (exponentiell) und Huelle
function tone(ac, out, t, { type = 'sine', f0, f1 = f0, glide = 0.1, attack, peak, hold = 0, release, filterHz }) {
  const g = gainNode(ac, out);
  const dest = filterHz ? filter(ac, 'lowpass', filterHz, 0.7, g) : g;
  const end = envelope(g.gain, t, attack, peak, hold, release);
  const o = osc(ac, type, f0, dest, t, end + 0.02);
  if (f1 !== f0) {
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + glide);
  }
  return end;
}

const between = (rng, a, b) => a + (b - a) * rng();

// Papier, Bueroklang ---------------------------------------------------------------------

function paper(ac, out, p, t, rng) {
  let end = t;
  const n = 3 + Math.floor(rng() * 4);
  let at = t;
  for (let i = 0; i < n; i++) {
    end = Math.max(end, burst(ac, out, at, rng, {
      filters: [['highpass', 700], ['bandpass', between(rng, 1800, 5200), 0.9]],
      attack: 0.004, peak: 0.5 * p.gain * between(rng, 0.5, 1), hold: between(rng, 0.005, 0.04), release: between(rng, 0.04, 0.11),
    }));
    at += between(rng, 0.03, 0.11);
  }
  // das Gleiten des Blatts ueber den Tisch
  end = Math.max(end, burst(ac, out, t + 0.02, rng, {
    filters: [['bandpass', 2600, 0.6]], attack: 0.08, peak: 0.12 * p.gain, hold: 0.08, release: 0.18,
  }));
  return { end };
}

function pencil(ac, out, p, t, rng) {
  let end = t;
  const strokes = Number.isFinite(p.count) ? Math.max(1, Math.min(12, p.count)) : 3 + Math.floor(rng() * 3);
  let at = t;
  for (let i = 0; i < strokes; i++) {
    const len = between(rng, 0.07, 0.17);
    end = Math.max(end, burst(ac, out, at, rng, {
      filters: [['highpass', 1800], ['bandpass', between(rng, 3200, 5200), 1.4]],
      attack: 0.015, peak: 0.32 * p.gain, hold: len, release: 0.03,
    }));
    at += len + between(rng, 0.03, 0.09);
  }
  return { end };
}

function stamp(ac, out, p, t, rng) {
  let end = tone(ac, out, t, { f0: 170, f1: 52, glide: 0.12, attack: 0.002, peak: 0.7 * p.gain, release: 0.2 });
  end = Math.max(end, burst(ac, out, t, rng, { filters: [['highpass', 1400]], attack: 0.001, peak: 0.5 * p.gain, release: 0.03 }));
  // Holzgriff klappert nach
  end = Math.max(end, tone(ac, out, t + 0.075, { type: 'triangle', f0: 330, f1: 300, glide: 0.04, attack: 0.002, peak: 0.18 * p.gain, release: 0.07 }));
  return { end };
}

function teletypeStrike(ac, out, p, t, rng) {
  let end = burst(ac, out, t, rng, { filters: [['highpass', 3200]], attack: 0.001, peak: 0.35 * p.gain, release: 0.012 });
  end = Math.max(end, burst(ac, out, t + 0.004, rng, {
    filters: [['bandpass', between(rng, 1400, 2100), 6]], attack: 0.002, peak: 0.6 * p.gain, release: 0.05,
  }));
  end = Math.max(end, tone(ac, out, t + 0.002, { f0: 95, attack: 0.002, peak: 0.25 * p.gain, release: 0.05 }));
  return end;
}

function teletype(ac, out, p, t, rng) {
  const count = Number.isFinite(p.count) ? Math.max(1, Math.min(80, Math.floor(p.count))) : 1;
  let end = t;
  let at = t;
  for (let i = 0; i < count; i++) {
    end = Math.max(end, teletypeStrike(ac, out, p, at, rng));
    at += between(rng, 0.07, 0.1);
  }
  // Glocke am Zeilenende (STOP)
  if (p.bell) {
    end = Math.max(end, tone(ac, out, at + 0.05, { f0: 2093, attack: 0.002, peak: 0.12 * p.gain, release: 0.9 }));
    end = Math.max(end, tone(ac, out, at + 0.05, { f0: 2093 * 2.76, attack: 0.002, peak: 0.03 * p.gain, release: 0.4 }));
  }
  return { end };
}

// Uhr ------------------------------------------------------------------------------------

function tickAt(ac, out, p, t, rng, high) {
  let end = burst(ac, out, t, rng, { filters: [['bandpass', high ? 3600 : 2900, 9]], attack: 0.001, peak: 0.7 * p.gain, release: 0.025 });
  end = Math.max(end, tone(ac, out, t, { f0: high ? 2300 : 1900, attack: 0.001, peak: 0.08 * p.gain, release: 0.03 }));
  return end;
}

function tick(ac, out, p, t, rng) {
  return { end: tickAt(ac, out, p, t, rng, !p.tock) };
}

// Einrasten: Ratsche beschleunigt, dann ein satter Schlag und ein leiser Nachklang der Feder
function clockLock(ac, out, p, t, rng) {
  let end = t;
  let at = t;
  let gap = 0.09;
  for (let i = 0; i < 6; i++) {
    end = Math.max(end, tickAt(ac, out, { gain: p.gain * (0.5 + i * 0.08) }, at, rng, i % 2 === 0));
    at += gap;
    gap *= 0.78;
  }
  end = Math.max(end, tone(ac, out, at, { f0: 240, f1: 110, glide: 0.08, attack: 0.002, peak: 0.7 * p.gain, release: 0.16 }));
  end = Math.max(end, burst(ac, out, at, rng, { filters: [['bandpass', 900, 2]], attack: 0.002, peak: 0.6 * p.gain, release: 0.08 }));
  end = Math.max(end, tone(ac, out, at + 0.01, { f0: 1318, attack: 0.003, peak: 0.06 * p.gain, release: 0.7 }));
  return { end };
}

// Front ----------------------------------------------------------------------------------

function artilleryFar(ac, out, p, t, rng) {
  const b = p.brightness;
  let end = burst(ac, out, t, rng, {
    kind: 'brown', filters: [['lowpass', 90 + 160 * b, 0.8]], attack: 0.03, peak: 1.1 * p.gain, hold: 0.06, release: between(rng, 1.8, 2.8),
  });
  end = Math.max(end, tone(ac, out, t, { f0: 52, f1: 34, glide: 0.5, attack: 0.02, peak: 0.45 * p.gain, release: 0.9 }));
  // Echo vom Hang
  const echo = t + between(rng, 0.35, 0.8);
  end = Math.max(end, burst(ac, out, echo, rng, {
    kind: 'brown', filters: [['lowpass', 80 + 60 * b, 0.7]], attack: 0.08, peak: 0.45 * p.gain, release: 1.6,
  }));
  return { end };
}

function impactNear(ac, out, p, t, rng) {
  const b = p.brightness;
  let end = t;
  let at = t;
  // heulendes Anfliegen, endet abrupt (aber knackfrei) beim Einschlag
  if (p.incoming !== false) {
    const fly = 1.1;
    const g = gainNode(ac, out);
    const o = osc(ac, 'sine', 1500, g, t, t + fly + 0.03);
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(420, t + fly);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06 * p.gain, t + fly * 0.6);
    g.gain.linearRampToValueAtTime(0.14 * p.gain, t + fly - 0.02);
    g.gain.linearRampToValueAtTime(0, t + fly + 0.01);
    at = t + fly;
  }
  end = Math.max(end, burst(ac, out, at, rng, {
    filters: [['lowpass', 1500 + 4000 * b, 0.6]], attack: 0.004, peak: 0.6 * p.gain, hold: 0.05, release: 1.1,
  }));
  end = Math.max(end, burst(ac, out, at, rng, {
    kind: 'brown', filters: [['lowpass', 260, 0.7]], attack: 0.006, peak: 0.7 * p.gain, hold: 0.1, release: 2.6,
  }));
  end = Math.max(end, tone(ac, out, at, { f0: 68, f1: 28, glide: 0.6, attack: 0.004, peak: 0.55 * p.gain, release: 1.0 }));
  // herabfallende Erde und Steine
  const pieces = 6 + Math.floor(rng() * 8);
  for (let i = 0; i < pieces; i++) {
    const tt = at + between(rng, 0.35, 2.0);
    end = Math.max(end, burst(ac, out, tt, rng, {
      filters: [['highpass', 900], ['bandpass', between(rng, 1200, 3500), 2]], attack: 0.002, peak: between(rng, 0.05, 0.18) * p.gain, release: between(rng, 0.02, 0.08),
    }));
  }
  return { end, impact: at };
}

function mgFar(ac, out, p, t, rng) {
  const b = p.brightness;
  const shots = Math.max(5, Math.round((8 + rng() * 12) * (0.5 + 0.5 * p.intensity)));
  let end = t;
  let at = t;
  for (let i = 0; i < shots; i++) {
    end = Math.max(end, burst(ac, out, at, rng, {
      filters: [['lowpass', 900 + 1100 * b, 0.7], ['bandpass', between(rng, 650, 1000), 1]],
      attack: 0.002, peak: between(rng, 0.45, 0.65) * p.gain, release: 0.07,
    }));
    at += 1 / 9.5 + between(rng, -0.008, 0.012);
  }
  end = Math.max(end, burst(ac, out, t + 0.05, rng, {
    kind: 'brown', filters: [['lowpass', 320, 0.7]], attack: 0.1, peak: 0.25 * p.gain, hold: at - t - 0.1, release: 0.9,
  }));
  return { end };
}

function rifle(ac, out, p, t, rng) {
  const b = p.brightness;
  let end = burst(ac, out, t, rng, { filters: [['highpass', 1800 + 1500 * b]], attack: 0.001, peak: 0.7 * p.gain, release: 0.025 });
  end = Math.max(end, burst(ac, out, t, rng, { filters: [['bandpass', 700, 1.2]], attack: 0.002, peak: 0.6 * p.gain, release: 0.12 }));
  end = Math.max(end, burst(ac, out, t + 0.01, rng, { kind: 'brown', filters: [['lowpass', 600, 0.7]], attack: 0.02, peak: 0.4 * p.gain, release: 0.9 }));
  end = Math.max(end, burst(ac, out, t + between(rng, 0.2, 0.35), rng, {
    filters: [['lowpass', 900, 0.7]], attack: 0.01, peak: 0.12 * p.gain, release: 0.7,
  }));
  return { end };
}

// Trillerpfeife: Ton um 2,7 kHz, die Kugel in der Pfeife moduliert ihn schnell
function whistleBlast(ac, out, p, t, len) {
  const g = gainNode(ac, out);
  const end = envelope(g.gain, t, 0.02, 0.22 * p.gain, len, 0.06);
  const o = osc(ac, 'sine', 2750, g, t, end + 0.02);
  const lfo = osc(ac, 'sine', 27, null, t, end + 0.02);
  const depth = ac.createGain();
  depth.gain.value = 170;
  lfo.connect(depth);
  depth.connect(o.frequency);
  return end;
}

function whistle(ac, out, p, t, rng) {
  let end = whistleBlast(ac, out, p, t, 0.35);
  end = Math.max(end, whistleBlast(ac, out, p, t + 0.55, 0.95));
  end = Math.max(end, burst(ac, out, t, rng, { filters: [['bandpass', 2700, 3]], attack: 0.02, peak: 0.05 * p.gain, hold: 1.5, release: 0.1 }));
  return { end };
}

function flare(ac, out, p, t, rng) {
  let end = tone(ac, out, t, { f0: 210, f1: 80, glide: 0.09, attack: 0.002, peak: 0.5 * p.gain, release: 0.12 });
  end = Math.max(end, burst(ac, out, t, rng, { filters: [['highpass', 1200]], attack: 0.001, peak: 0.3 * p.gain, release: 0.03 }));
  // aufsteigendes Zischen
  const g = gainNode(ac, out);
  const bp = filter(ac, 'bandpass', 800, 2, g);
  const riseEnd = envelope(g.gain, t + 0.05, 0.3, 0.2 * p.gain, 0.8, 0.15);
  noise(ac, 'white', bp, t + 0.05, riseEnd + 0.02, rng);
  bp.frequency.setValueAtTime(800, t + 0.05);
  bp.frequency.exponentialRampToValueAtTime(3200, t + 1.2);
  end = Math.max(end, riseEnd);
  // Oeffnen und Brennen am Fallschirm
  const open = t + 1.35;
  end = Math.max(end, burst(ac, out, open, rng, { filters: [['bandpass', 1500, 3]], attack: 0.002, peak: 0.12 * p.gain, release: 0.05 }));
  end = Math.max(end, burst(ac, out, open + 0.05, rng, {
    filters: [['highpass', 1400], ['lowpass', 6500]], attack: 0.4, peak: 0.1 * p.gain, hold: 2.6, release: 1.6,
  }));
  return { end };
}

// Wetter als Einzelklang (die Dauerschichten liegen in ambience.js) ---------------------

function rain(ac, out, p, t, rng) {
  let end = burst(ac, out, t, rng, { filters: [['highpass', 500], ['lowpass', 7000]], attack: 1.0, peak: 0.35 * p.gain, hold: 1.6, release: 1.4 });
  for (let i = 0; i < 10; i++) end = Math.max(end, drip(ac, out, { gain: p.gain * 0.6 }, t + between(rng, 0.3, 3.5), rng).end);
  return { end };
}

function wind(ac, out, p, t, rng) {
  const g = gainNode(ac, out);
  const bp = filter(ac, 'bandpass', 300, 0.9, g);
  const end = envelope(g.gain, t, 1.4, 0.7 * p.gain, 1.0, 2.0);
  noise(ac, 'brown', bp, t, end + 0.02, rng);
  bp.frequency.setValueAtTime(260, t);
  bp.frequency.exponentialRampToValueAtTime(700 + 400 * p.brightness, t + 1.8);
  bp.frequency.exponentialRampToValueAtTime(240, end);
  return { end };
}

// Etappe ---------------------------------------------------------------------------------

function lore(ac, out, p, t, rng) {
  const dur = 3.4;
  let end = burst(ac, out, t, rng, { kind: 'brown', filters: [['lowpass', 420, 0.8]], attack: 0.7, peak: 0.6 * p.gain, hold: dur - 1.7, release: 1.0 });
  end = Math.max(end, burst(ac, out, t, rng, { filters: [['bandpass', 240, 3]], attack: 0.7, peak: 0.2 * p.gain, hold: dur - 1.7, release: 1.0 }));
  // Schienenstoesse: zwei Achsen je Stoss, das Tempo bleibt gleich
  for (let at = t + 0.35; at < t + dur - 0.3; at += 0.62) {
    const loud = Math.min(1, (at - t) / 0.8, (t + dur - at) / 0.8);
    for (const off of [0, 0.13]) {
      end = Math.max(end, burst(ac, out, at + off, rng, { filters: [['bandpass', 1100, 4]], attack: 0.002, peak: 0.45 * loud * p.gain, release: 0.06 }));
      end = Math.max(end, tone(ac, out, at + off, { f0: 2700 + rng() * 300, attack: 0.002, peak: 0.03 * loud * p.gain, release: 0.12 }));
    }
  }
  // die Lore faehrt am Hoerer vorbei
  if (p.panParam) {
    const c = p.pan;
    p.panParam.setValueAtTime(Math.max(-1, c - 0.6), t);
    p.panParam.linearRampToValueAtTime(Math.min(1, c + 0.6), t + dur);
  }
  return { end };
}

function steps(ac, out, p, t, rng) {
  const count = Number.isFinite(p.count) ? Math.max(1, Math.min(12, Math.floor(p.count))) : 4;
  let end = t;
  let at = t;
  for (let i = 0; i < count; i++) {
    // Einsinken
    const g = gainNode(ac, out);
    const lp = filter(ac, 'lowpass', 900, 1.5, g);
    const e = envelope(g.gain, at, 0.012, 0.7 * p.gain, 0.03, 0.17);
    noise(ac, 'brown', lp, at, e + 0.02, rng);
    lp.frequency.setValueAtTime(900, at);
    lp.frequency.exponentialRampToValueAtTime(180, at + 0.2);
    // Herausziehen: der Schlamm schmatzt
    const g2 = gainNode(ac, out);
    const bp = filter(ac, 'bandpass', 400, 4, g2);
    const pull = at + between(rng, 0.16, 0.24);
    const e2 = envelope(g2.gain, pull, 0.02, 0.22 * p.gain, 0.02, 0.1);
    noise(ac, 'white', bp, pull, e2 + 0.02, rng);
    bp.frequency.setValueAtTime(400, pull);
    bp.frequency.exponentialRampToValueAtTime(1500, pull + 0.12);
    end = Math.max(end, e, e2);
    at += between(rng, 0.52, 0.66);
  }
  return { end };
}

// Einzelklaenge der Umgebung -------------------------------------------------------------

function crow(ac, out, p, t, rng) {
  let end = t;
  const calls = 1 + Math.floor(rng() * 3);
  let at = t;
  for (let i = 0; i < calls; i++) {
    const g = gainNode(ac, out);
    const bp = filter(ac, 'bandpass', 1250, 3, g);
    const lp = filter(ac, 'lowpass', 2200, 0.7, bp);
    const e = envelope(g.gain, at, 0.02, 0.16 * p.gain, between(rng, 0.1, 0.18), 0.1);
    const o = osc(ac, 'sawtooth', 560, lp, at, e + 0.02);
    o.frequency.setValueAtTime(560, at);
    o.frequency.exponentialRampToValueAtTime(430, e);
    end = Math.max(end, e);
    at = e + between(rng, 0.15, 0.3);
  }
  return { end };
}

function cricket(ac, out, p, t, rng) {
  let end = t;
  const f = between(rng, 4200, 4700);
  for (let i = 0; i < 3; i++) {
    end = Math.max(end, tone(ac, out, t + i * 0.055, { f0: f, attack: 0.004, peak: 0.05 * p.gain, release: 0.03 }));
  }
  return { end };
}

function drip(ac, out, p, t, rng) {
  const f = between(rng, 1400, 2400);
  return { end: tone(ac, out, t, { f0: f, f1: f * 0.55, glide: 0.04, attack: 0.002, peak: 0.07 * p.gain, release: 0.06 }) };
}

// Ohrensausen nach nahem Einschlag
function tinnitus(ac, out, p, t) {
  return { end: tone(ac, out, t, { f0: 3900, attack: 0.08, peak: 0.03 * p.gain, hold: 0.5, release: 2.6 }) };
}

// Register: Name -> Funktion. Namen sind die API von playSfx.
export const SOUNDS = {
  paper, pencil, stamp, teletype, tick,
  'clock-lock': clockLock,
  'artillery-far': artilleryFar,
  'impact-near': impactNear,
  'mg-far': mgFar,
  rifle, whistle, flare, rain, wind, lore, steps,
  crow, cricket, drip, tinnitus,
};

// Beschriftungen fuer Demo und spaetere Einstellungen. group ordnet die Knoepfe.
export const CATALOG = [
  { name: 'paper', label: 'Papier rascheln', group: 'Schreibstube' },
  { name: 'pencil', label: 'Bleistift kratzen', group: 'Schreibstube' },
  { name: 'stamp', label: 'Stempel', group: 'Schreibstube' },
  { name: 'teletype', label: 'Fernschreiber', group: 'Schreibstube', opts: { count: 14, bell: true } },
  { name: 'tick', label: 'Uhr ticken', group: 'Uhr' },
  { name: 'clock-lock', label: 'Uhr rastet ein', group: 'Uhr' },
  { name: 'artillery-far', label: 'Ferne Artillerie', group: 'Front' },
  { name: 'impact-near', label: 'Naher Einschlag', group: 'Front' },
  { name: 'mg-far', label: 'MG in der Ferne', group: 'Front' },
  { name: 'rifle', label: 'Gewehrschuss', group: 'Front' },
  { name: 'whistle', label: 'Pfeife zum Sturm', group: 'Front' },
  { name: 'flare', label: 'Leuchtkugel', group: 'Front' },
  { name: 'rain', label: 'Regen', group: 'Wetter' },
  { name: 'wind', label: 'Wind', group: 'Wetter' },
  { name: 'lore', label: 'Lore auf Schienen', group: 'Etappe' },
  { name: 'steps', label: 'Schlamm-Schritte', group: 'Etappe' },
];
