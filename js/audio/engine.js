// Klang-Engine: ein AudioContext, erst nach der ersten Nutzerinteraktion.
// Busse: sfx, ambience, music -> Gehoer (Tiefpass fuer Taubheit) -> master -> Hintergrund-Ducking
// -> Begrenzer -> Ausgang. Der nahe Einschlag selbst laeuft am Gehoer vorbei (sfxDirect).
//
// API (siehe auch js/audio/README.md):
//   playSfx(name, { x, width, pan, intensity, delay, ...Optionen }) -> true wenn gespielt
//   setAmbience({ darkness, rain, wind, battle })  startet die Umgebung und blendet weich
//   stopAmbience(), startMusic(), stopMusic(), stopAll()
//   setVolume(bus, v) mit bus in master|music|sfx|ambience, v 0..1; getVolume(bus)
//   setMuted(bool), isMuted(), setOption('shellshock', bool)
//   unlock() fuer einen eigenen Knopf; sonst passiert es beim ersten Tippen/Tastendruck
// Ohne Browser (node) ist alles ein stiller No-op.

import {
  BUSES, DEFAULT_VOLUMES, BACKGROUND_GAIN, RAMP, sliderToGain, sfxParams, clamp01,
  muffleCutoff, muffleStrength, MUFFLE, shouldDropVoice, MAX_VOICES,
} from './logic.js';
import { SOUNDS } from './sounds.js';
import { createAmbience } from './ambience.js';
import { createMusic } from './music.js';
import { createRng } from '../rng.js';

const STORE_KEY = 'lehmfront.klang';
const TICK_MS = 250;
const LOOKAHEAD = 0.6;

function loadSettings() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : null;
  } catch { return null; }
}

function saveSettings(s) {
  try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* privat oder voll */ }
}

export function createAudioEngine({ win = globalThis.window, seed = 7 } = {}) {
  const saved = loadSettings();
  const volumes = { ...DEFAULT_VOLUMES };
  if (saved?.volumes) for (const b of BUSES) if (Number.isFinite(saved.volumes[b])) volumes[b] = clamp01(saved.volumes[b]);
  let muted = !!saved?.muted;
  const options = { shellshock: saved?.shellshock !== false };

  let ac = null;
  let nodes = null;
  let ambience = null;
  let music = null;
  let timer = null;
  let voices = 0;
  let listening = false;
  let pendingAmbience = null;
  let wantMusic = false;
  let unlockedAt = -Infinity;
  const listeners = new Set();
  const rng = createRng(seed);

  const hidden = () => !!win?.document && win.document.visibilityState === 'hidden';
  let persistTimer = null;
  const persist = () => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => saveSettings({ volumes, muted, shellshock: options.shellshock }), 300);
  };
  const emit = () => { for (const fn of listeners) { try { fn(state()); } catch (e) { console.error(e); } } };

  function state() {
    return {
      ready: !!ac && ac.state === 'running',
      contextState: ac ? ac.state : 'none',
      muted, volumes: { ...volumes }, options: { ...options },
      ambience: ambience ? ambience.active : !!pendingAmbience,
      music: music ? music.active : wantMusic,
      voices,
    };
  }

  function busGain(bus) {
    if (bus === 'master') return muted ? 0 : sliderToGain(volumes.master);
    return sliderToGain(volumes[bus]);
  }

  function build() {
    const Ctx = win.AudioContext || win.webkitAudioContext;
    if (!Ctx) return false;
    ac = new Ctx({ latencyHint: 'interactive' });
    const g = (v) => { const n = ac.createGain(); n.gain.value = v; return n; };
    const n = {};
    n.limiter = ac.createDynamicsCompressor();
    n.limiter.threshold.value = -6;
    n.limiter.knee.value = 4;
    n.limiter.ratio.value = 12;
    n.limiter.attack.value = 0.003;
    n.limiter.release.value = 0.25;
    n.analyser = ac.createAnalyser();
    n.analyser.fftSize = 1024;
    n.limiter.connect(n.analyser);
    n.analyser.connect(ac.destination);
    n.duck = g(hidden() ? BACKGROUND_GAIN : 1);
    n.duck.connect(n.limiter);
    n.master = g(busGain('master'));
    n.master.connect(n.duck);
    n.ear = ac.createBiquadFilter();
    n.ear.type = 'lowpass';
    n.ear.frequency.value = MUFFLE.open;
    n.ear.Q.value = 0.5;
    n.ear.connect(n.master);
    for (const b of ['sfx', 'ambience', 'music']) { n[b] = g(busGain(b)); n[b].connect(n.ear); }
    n.sfxDirect = g(busGain('sfx'));
    n.sfxDirect.connect(n.master);
    nodes = n;

    ambience = createAmbience(ac, n.ambience, (name, when, opts) => play(name, opts, when, n.ambience), createRng(seed + 1));
    music = createMusic(ac, n.music, createRng(seed + 2));
    if (pendingAmbience) { ambience.set(pendingAmbience); ambience.start(); music.setBattle(pendingAmbience.battle ?? 0); pendingAmbience = null; }
    if (wantMusic) music.start();
    // iOS unterbricht den Kontext (Anruf, Hintergrund): dann wieder auf eine Geste lauschen
    ac.onstatechange = () => { if (ac.state !== 'running') listen(); emit(); };
    // Safari 16.4+: Klang auch bei aktivem Stummschalter, wie bei einem Spiel erwartet
    try { if (win.navigator?.audioSession) win.navigator.audioSession.type = 'playback'; } catch { /* egal */ }
    win.document?.addEventListener('visibilitychange', onVisibility);
    syncTimer();
    return true;
  }

  function onVisibility() {
    if (!ac) return;
    if (!hidden() && ac.state !== 'running') ac.resume().catch(() => listen());
    nodes.duck.gain.setTargetAtTime(hidden() ? BACKGROUND_GAIN : 1, ac.currentTime, RAMP.duck);
  }

  function onGesture() {
    unlock();
  }

  function listen() {
    if (listening || !win?.addEventListener) return;
    listening = true;
    for (const ev of ['pointerdown', 'keydown', 'touchend']) win.addEventListener(ev, onGesture, { capture: true, passive: true });
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    for (const ev of ['pointerdown', 'keydown', 'touchend']) win.removeEventListener(ev, onGesture, { capture: true });
  }

  // Muss innerhalb einer Nutzerinteraktion aufgerufen werden (Browser-Regel fuer Autoplay)
  function unlock() {
    if (!win) return false;
    unlockedAt = performance.now();
    if (!ac && !build()) return false;
    if (ac.state !== 'running') {
      ac.resume().then(() => { unlisten(); emit(); }, () => {});
    } else unlisten();
    emit();
    return true;
  }

  // Der Takt laeuft nur, solange Umgebung oder Musik aktiv sind: keine Schleife ohne Stop.
  function syncTimer() {
    const need = !!ac && ((ambience && ambience.active) || (music && music.active));
    if (need && !timer) timer = setInterval(tick, TICK_MS);
    if (!need && timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    if (!ac || ac.state !== 'running') return;
    const now = ac.currentTime;
    const h = hidden();
    // getrennt absichern, damit ein Fehler in der Umgebung die Musik nicht anhaelt
    try { ambience?.tick(now, LOOKAHEAD, h); } catch (e) { console.error(e); }
    try { music?.tick(now, LOOKAHEAD, h); } catch (e) { console.error(e); }
  }

  function deafen(at, strength) {
    if (!options.shellshock || strength <= 0) return;
    const f = nodes.ear.frequency;
    // laufende Erholung eines frueheren Einschlags festhalten statt sie zu verwerfen
    if (f.cancelAndHoldAtTime) f.cancelAndHoldAtTime(at);
    else { f.cancelScheduledValues(ac.currentTime); f.setValueAtTime(f.value, ac.currentTime); }
    f.setValueAtTime(muffleCutoff(0, strength), at + 0.02);
    const steps = 12;
    const total = MUFFLE.hold + MUFFLE.recover;
    for (let i = 1; i <= steps; i++) {
      const dt = (total * i) / steps;
      f.exponentialRampToValueAtTime(muffleCutoff(dt, strength), at + 0.02 + dt);
    }
    play('tinnitus', { intensity: 0.4 + 0.6 * strength }, at + 0.05, nodes.sfxDirect);
  }

  function play(name, opts = {}, when, bus) {
    const fn = SOUNDS[name];
    if (!fn) { console.warn('Unbekannter Klang:', name); return false; }
    // Nach unlock() ist der Kontext oft noch kurz 'suspended': Planen ist trotzdem erlaubt,
    // der Klang erklingt mit dem Fortsetzen. So klingt auch das erste Tippen selbst.
    if (!ac || ac.state === 'closed') return false;
    // aber nur kurz nach unlock(), sonst stauen sich Klaenge und erklingen spaeter auf einen Schlag
    if (ac.state !== 'running' && performance.now() - unlockedAt > 1500) return false;
    // Effekte des Spielers haben eine Reserve, die Umgebung darf sie nicht aufbrauchen
    if (shouldDropVoice(voices, bus === nodes.ambience ? MAX_VOICES - 6 : MAX_VOICES)) return false;
    const p = { ...opts, ...sfxParams(opts) };
    const t = Number.isFinite(when) ? when : ac.currentTime + 0.01 + Math.max(0, Number(opts.delay) || 0);
    const pan = ac.createStereoPanner ? ac.createStereoPanner() : null;
    const out = ac.createGain();
    out.gain.value = 1;
    if (pan) { pan.pan.value = p.pan; out.connect(pan); pan.connect(bus); p.panParam = pan.pan; } else out.connect(bus);
    let res;
    try { res = fn(ac, out, p, t, rng); } catch (e) { console.error(e); out.disconnect(); pan?.disconnect(); return false; }
    voices++;
    const end = res?.end ?? t + 1;
    setTimeout(() => { voices--; out.disconnect(); pan?.disconnect(); }, Math.max(0, end - ac.currentTime + 0.25) * 1000);
    if (Number.isFinite(res?.impact)) deafen(res.impact, muffleStrength(p.intensity));
    return true;
  }

  const api = {
    init() { listen(); return state(); },
    unlock,
    state,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get analyser() { return nodes?.analyser ?? null; },

    playSfx(name, opts = {}) {
      listen();
      const bus = name === 'impact-near' ? nodes?.sfxDirect : nodes?.sfx;
      return play(name, opts, undefined, bus);
    },

    setAmbience(input = {}) {
      listen();
      if (!ambience) { pendingAmbience = { ...(pendingAmbience || {}), ...input }; emit(); return; }
      ambience.set(input);
      ambience.start();
      if ('battle' in input) music.setBattle(input.battle);
      syncTimer();
      emit();
    },

    // Gefechtslage nur fuer die Musik, wenn die Umgebung aus ist
    setMusicBattle(battle) {
      music?.setBattle(clamp01(battle));
    },

    stopAmbience() {
      pendingAmbience = null;
      ambience?.stop();
      // ohne Umgebung kein Gefecht: die Musik darf zurueckkommen
      music?.setBattle(0);
      syncTimer();
      emit();
    },

    startMusic() {
      listen();
      wantMusic = true;
      music?.start();
      syncTimer();
      emit();
    },

    stopMusic() {
      wantMusic = false;
      music?.stop();
      syncTimer();
      emit();
    },

    stopAll() {
      api.stopAmbience();
      api.stopMusic();
    },

    setVolume(bus, v) {
      if (!BUSES.includes(bus)) throw new Error('Unbekannter Bus: ' + bus);
      volumes[bus] = clamp01(v);
      persist();
      if (nodes) {
        const t = ac.currentTime;
        nodes[bus].gain.setTargetAtTime(busGain(bus), t, RAMP.volume);
        if (bus === 'sfx') nodes.sfxDirect.gain.setTargetAtTime(busGain(bus), t, RAMP.volume);
      }
      emit();
    },

    getVolume(bus) { return volumes[bus]; },

    setMuted(m) {
      muted = !!m;
      persist();
      if (nodes) nodes.master.gain.setTargetAtTime(busGain('master'), ac.currentTime, RAMP.volume);
      emit();
    },

    isMuted() { return muted; },

    setOption(key, value) {
      if (!(key in options)) throw new Error('Unbekannte Klang-Option: ' + key);
      options[key] = !!value;
      persist();
      emit();
    },
  };
  return api;
}

// Gemeinsame Instanz fuer das ganze Spiel
export const audio = createAudioEngine();
export const playSfx = (name, opts) => audio.playSfx(name, opts);
export const setAmbience = (input) => audio.setAmbience(input);
export const setVolume = (bus, v) => audio.setVolume(bus, v);
