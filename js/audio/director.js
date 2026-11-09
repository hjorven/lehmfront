// Klangregie (P19): verbindet Spielereignisse und Ansichten mit der Klang-Engine.
// Was wie klingt, steht rein und getestet in js/audio/cues.js; hier wird nur abgespielt.
import { audio, playSfx } from './engine.js';
import { planCues, sectionCues, ambienceFor } from './cues.js';
import { groupsOf } from '../state.js';

const HUSH_SECONDS = 3.2;

/** Orte der eigenen, noch kaempfenden Gruppen (fuer nah oder fern) */
export function ownPositions(state, side) {
  if (!state) return [];
  return groupsOf(state, side).filter((g) => g.status !== 'lost').map((g) => ({ x: g.pos.x, y: g.pos.y }));
}

/** Front verstummt kurz, danach schlaegt die Uhr einmal */
export function hushFront() {
  if (audio.hush?.(HUSH_SECONDS)) playSfx('tick', { tock: true, intensity: 0.55, delay: HUSH_SECONDS * 0.6 });
}

function playList(list) {
  for (const c of list) {
    if (c.name === 'hush') hushFront();
    else playSfx(c.name, { ...c.opts, delay: c.delay });
  }
}

/**
 * Klaenge zu Ereignissen abspielen. events = Protokoll-Ereignisse (oder Telegrammzeilen mit .event),
 * ctx = { side, state } oder schon fertig { side, width, own }.
 */
export function cueEvents(events, ctx = {}) {
  const list = (events ?? []).map((e) => e?.event ?? e).filter(Boolean);
  if (!list.length) return [];
  const st = ctx.state;
  const c = {
    side: ctx.side ?? 'a',
    width: ctx.width ?? st?.map?.width ?? 60,
    own: ctx.own ?? ownPositions(st, ctx.side ?? 'a'),
  };
  const cues = planCues(list, c);
  playList(cues);
  return cues;
}

/** Abschnittswechsel im Phasenfilm */
export function cueSection(key) {
  playList(sectionCues(key));
}

/** Grundton der Front: Tageszeit, Wetter, Rundenart und die letzte Runde */
export function frontAmbience({ state, darkness, log = [], side = 'a' }) {
  const amb = ambienceFor({ darkness, weather: state?.weather, kind: state?.turnKind, log, side });
  audio.setAmbience(amb);
  return amb;
}

/**
 * Klang-Haken fuer die Papierebene (js/ui/paper, Z1). Weitere Haken in extra werden zusaetzlich gerufen.
 * Fernschreiber tippt anschlagweise, Stempel, Rascheln beim Auflegen, Umdrehen und Ablegen.
 */
export function paperHooks(extra = {}) {
  let lastKey = 0;
  const wrap = (name, fn) => (info) => { fn(info); extra[name]?.(info); };
  return {
    ...extra,
    onAdd: wrap('onAdd', () => playSfx('paper', { intensity: 0.35 })),
    onKey: wrap('onKey', ({ char }) => {
      // Schnell getippte Zeichen zusammenfassen: hoechstens ein Anschlag je 45 ms
      const now = globalThis.performance?.now?.() ?? 0;
      if (char === ' ' || now - lastKey < 45) return;
      lastKey = now;
      playSfx('teletype', { count: 1, intensity: 0.4 });
    }),
    onLine: wrap('onLine', () => playSfx('teletype', { count: 2, bell: true, intensity: 0.35 })),
    onStamp: wrap('onStamp', () => playSfx('stamp')),
    onFlip: wrap('onFlip', () => playSfx('paper', { intensity: 0.5 })),
    onFront: wrap('onFront', () => playSfx('paper', { intensity: 0.2 })),
    onDismiss: wrap('onDismiss', () => playSfx('paper', { intensity: 0.55 })),
  };
}
