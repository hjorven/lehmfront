// Klangregie, reiner Teil (P19): welche Ereignisse wie klingen und wie laut die Front im Hintergrund grollt.
// Rein: kein DOM, kein Date, kein Math.random. Abspielen erledigt js/audio/director.js.
//
// Ereignis-Haken fuer spaetere Pakete: registerCue(type, fn) mit
//   fn(event, ctx) -> [{ name, opts?, delay? }] | null
// ctx = { side, width, own: [{x,y}] }: side = die Seite, die zuhoert, width = Kartenbreite (Stereo),
// own = Orte der eigenen Gruppen (fuer "nah" oder "fern"). name ist ein Klang aus js/audio/sounds.js
// oder 'hush' (Front verstummt kurz). Ein Paket mit neuer Mechanik meldet seine Klaenge in seinem eigenen
// Modul an, statt diese Datei zu aendern.

const CUES = new Map();

/** Klang fuer einen Ereignistyp anmelden (ersetzt eine fruehere Anmeldung desselben Typs) */
export function registerCue(type, fn) {
  if (typeof fn !== 'function') throw new Error('registerCue braucht eine Funktion');
  CUES.set(type, fn);
}

export function hasCue(type) {
  return CUES.has(type);
}

/** Hoechstens so viele Klaenge je Schwung, desselben Klangs hoechstens MAX_SAME */
export const MAX_CUES = 5;
export const MAX_SAME = 2;
/** Versatz in Sekunden zwischen Klaengen eines Schwungs, damit nichts als ein Knall zusammenfaellt */
export const STAGGER = 0.11;

const clamp01 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** Kleinster Abstand (Felder, Schachbrett) von at zu einer der eigenen Gruppen, Infinity ohne Gruppen */
export function distanceToOwn(at, own) {
  let best = Infinity;
  if (!at || !own) return best;
  for (const p of own) best = Math.min(best, Math.max(Math.abs(p.x - at.x), Math.abs(p.y - at.y)));
  return best;
}

/** Einschlag: bis 3 Felder an eigenen Gruppen nah (mit Taubheit ab 0,55), sonst fern */
export function shellCue(e, ctx, base = 0.6) {
  const d = distanceToOwn(e.at, ctx.own);
  if (d <= 3) return [{ name: 'impact-near', opts: { intensity: clamp01(base + 0.3 - d * 0.12) } }];
  return [{ name: 'artillery-far', opts: { intensity: clamp01(base - Math.min(0.35, d * 0.015)) } }];
}

/**
 * Klaenge fuer eine Reihe von Ereignissen, die gleichzeitig erscheinen (z. B. neue Telegrammzeilen).
 * Liefert [{ name, opts, delay }] mit opts.x/opts.width fuer Stereo. Gekappt und versetzt.
 */
export function planCues(events, ctx = {}) {
  const out = [];
  const count = new Map();
  const c = { side: ctx.side ?? 'a', width: ctx.width ?? 60, own: ctx.own ?? [] };
  for (const e of events ?? []) {
    if (!e || out.length >= MAX_CUES) break;
    const fn = CUES.get(e.type);
    if (!fn) continue;
    let list;
    try { list = fn(e, c); } catch { list = null; }
    if (!Array.isArray(list)) continue;
    for (const cue of list) {
      if (!cue || typeof cue.name !== 'string' || out.length >= MAX_CUES) continue;
      const n = count.get(cue.name) ?? 0;
      if (n >= MAX_SAME) continue;
      count.set(cue.name, n + 1);
      const opts = { ...(cue.opts ?? {}) };
      if (e.at && Number.isFinite(e.at.x) && opts.pan === undefined && opts.x === undefined) {
        opts.x = e.at.x + 0.5;
        opts.width = c.width;
      }
      const delay = Math.max(0, Number(cue.delay) || 0) + out.length * STAGGER;
      out.push({ name: cue.name, opts, delay: Math.round(delay * 1000) / 1000 });
    }
  }
  return out;
}

/** Abschnittswechsel im Phasenfilm: die Uhr tickt, wenn die Runde zur Uhrphase kommt */
export function sectionCues(key) {
  if (key === 'clock') return [{ name: 'tick', opts: { intensity: 0.5 }, delay: 0 }, { name: 'tick', opts: { tock: true, intensity: 0.5 }, delay: 0.5 }];
  return [];
}

const RAIN_BY_KIND = { rain: 0.55, storm: 0.85, snow: 0.1 };

/**
 * Pegel der Umgebung fuer setAmbience aus Tageszeit, Wetter und der letzten Runde.
 * input = { darkness, weather, kind ('position'|'battle'), log, side }
 */
export function ambienceFor({ darkness = 0, weather = null, kind = 'position', log = [], side = 'a' } = {}) {
  const w = weather ?? {};
  const rain = Number.isFinite(w.rain) && w.rain > 0 ? clamp01(w.rain) : RAIN_BY_KIND[w.kind] ?? 0;
  const speed = Number.isFinite(w.wind?.speed) ? w.wind.speed : 1;
  const wind = clamp01((speed - 1) / 4 + (w.kind === 'storm' ? 0.45 : 0) + rain * 0.15);
  let battle = kind === 'battle' ? 0.45 : 0.12;
  for (const e of log ?? []) {
    if (e.type === 'fire') battle += 0.03;
    else if (e.type === 'losses') battle += e.side === side ? 0.06 : 0.03;
    else if (e.type === 'group_lost') battle += 0.08;
    else if (hasCue(e.type) && /artillery|barrage|shell|assault/.test(e.type)) battle += 0.05;
  }
  return { darkness: clamp01(darkness), rain, wind, battle: clamp01(Math.min(0.95, battle)) };
}

// ---------- Vorbelegung fuer die Ereignisse, die es schon gibt ----------

const own = (e, ctx) => e.side === ctx.side;

registerCue('move', (e, ctx) => (e.steps > 0 && own(e, ctx) ? [{ name: 'steps', opts: { count: Math.min(6, 1 + e.steps), intensity: 0.35 } }] : null));
registerCue('redeploy', (e, ctx) => (e.steps > 0 && own(e, ctx) ? [{ name: 'steps', opts: { count: Math.min(5, 1 + (e.steps >> 2)), intensity: 0.25 } }] : null));
registerCue('fire', (e, ctx) => {
  const mg = e.ammo === 2;
  const near = own(e, ctx) ? 0.55 : 0.4;
  return [{ name: mg ? 'mg-far' : 'rifle', opts: { intensity: e.blind ? near - 0.15 : near } }];
});
// Aufgerieben: die Front verstummt kurz, dann ein einzelner Schlag der Uhr (director.js)
registerCue('group_lost', () => [{ name: 'hush' }]);
registerCue('nightfall', () => [{ name: 'flare', opts: { intensity: 0.45 }, delay: 0.8 }]);
registerCue('daybreak', () => [{ name: 'crow', opts: { intensity: 0.4 }, delay: 0.4 }]);
registerCue('ghost_cleared', () => [{ name: 'pencil', opts: { count: 2, intensity: 0.3 } }]);
registerCue('order_invalid', () => [{ name: 'paper', opts: { intensity: 0.3 } }]);

// Vorbelegung fuer kommende Mechanik (P06 Sturm, P08 Versorgung, P09 Artillerie, P10 Nacht).
// Die Pakete duerfen sie mit registerCue in ihrem eigenen Modul ersetzen.
registerCue('assault', (e, ctx) => (own(e, ctx)
  ? [{ name: 'steps', opts: { count: 6, intensity: 0.7 } }, { name: 'rifle', opts: { intensity: 0.6 }, delay: 0.3 }]
  : [{ name: 'whistle', opts: { intensity: 0.35 } }]));
for (const t of ['artillery', 'barrage', 'shell', 'shelling', 'impact']) registerCue(t, (e, ctx) => shellCue(e, ctx));
registerCue('mine', (e, ctx) => shellCue(e, ctx, 0.75));
registerCue('flare', () => [{ name: 'flare', opts: { intensity: 0.5 } }]);
for (const t of ['supply', 'cart', 'lore', 'carts_arrived']) registerCue(t, () => [{ name: 'lore', opts: { intensity: 0.4 } }]);
registerCue('weather', (e) => (e.weather?.kind === 'rain' || e.weather?.kind === 'storm' ? [{ name: 'rain', opts: { intensity: 0.5 } }] : null));
