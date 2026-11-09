// Wetter und Tageszeit im Gefechtsbildschirm (P10): Wetterebene einhaengen, Klang nachfuehren,
// Tag-Nacht-Uebergang am Ende des Phasenfilms (Haken aus P07), Szenen-Parameter fuer Screenshots.
// Parameter: weather=clear|overcast|rain|storm|fog, wet=0..3 (Naesse, fuellt auch Graeben in Senken),
//   flares=x,y;x,y (Leuchtkugeln dieser Runde, 1-basiert wie auf der Karte).
import { createWeatherLayer } from '../render/weather-layer.js';
import { setAmbience } from '../audio/engine.js';
import { themeAt, applyTheme } from '../theme.js';
import { setTransitionHook } from './film.js';
import { reducedMotion } from './dom.js';
import { patchCell } from '../state.js';
import { isSink, WEATHER_KINDS, FLARE_RADIUS } from '../weather.js';
import { trenchCells } from '../phases/weather.js';

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t));

/** Szenen-Parameter auf einen frischen Zustand anwenden (nur Demo und Screenshots) */
export function applyWeatherParams(state, map, params) {
  const kind = params.get('weather');
  if (WEATHER_KINDS.includes(kind)) {
    state.weather = {
      ...state.weather, kind, fixed: true,
      rain: kind === 'storm' ? 1 : kind === 'rain' ? 0.6 : 0,
      fog: kind === 'fog' ? 0.8 : 0,
      wind: kind === 'storm' ? { dir: 'w', speed: 3 } : state.weather.wind,
    };
  }
  if (params.has('wet')) {
    const wet = Math.max(0, Math.min(3, Number(params.get('wet')) | 0));
    state.weather = { ...state.weather, wet };
    // Graeben laufen nach Naesse voll, Senken zuerst
    for (const c of trenchCells(state, map)) {
      const h = map.cells[c.y * map.width + c.x].height;
      const w = Math.max(0, Math.min(3, wet + (isSink(map, c.x, c.y) ? 1 : 0) - h));
      if (w) patchCell(state, c.x, c.y, { water: w });
    }
  }
  if (params.has('flares')) {
    state.flares = String(params.get('flares')).split(';').map((p) => p.split(',').map(Number))
      .filter(([x, y]) => Number.isInteger(x) && Number.isInteger(y))
      .map(([x, y]) => ({ x: x - 1, y: y - 1, r: FLARE_RADIUS, side: 'a', auto: false }));
  }
}

/**
 * attachWeather({ root, before, map, seed, cam, staticCanvas, getTheme, still })
 * Legt ein Canvas vor `before` (die dynamische Ebene) und gibt { update(state, side), frame(state), resize, invalidate } zurueck.
 */
export function attachWeather({ root, before, map, seed, cam, staticCanvas, getTheme, still = false }) {
  const cv = document.createElement('canvas');
  cv.className = 'g-weather';
  cv.setAttribute('aria-hidden', 'true');
  cv.style.pointerEvents = 'none';
  root.insertBefore(cv, before);
  const quiet = still || reducedMotion();
  const layer = createWeatherLayer(cv, { map, seed, getCamera: () => cam, getTheme, staticCanvas });

  // Uebergang am Filmende: etwa zwei Sekunden, weich beschleunigt und abgebremst (Plan 7.7)
  setTransitionHook(({ t, from, to }) => applyTheme(themeAt(from + (to - from) * ease(t))));

  let lastAmb = '';
  function ambience(state, darkness) {
    const w = state.weather ?? {};
    const amb = {
      darkness,
      rain: w.kind === 'storm' ? 1 : w.kind === 'rain' ? w.rain ?? 0.6 : 0,
      wind: Math.min(1, (w.wind?.speed ?? 1) / 3),
      battle: state.turnKind === 'battle' ? 0.7 : 0.15,
    };
    const key = JSON.stringify(amb);
    if (key === lastAmb) return;
    lastAmb = key;
    try { setAmbience(amb); } catch { /* Klang ist Beiwerk */ }
  }

  return {
    update(state, side) {
      layer.setState(state, { side, still: quiet });
      ambience(state, getTheme().darkness ?? 0);
    },
    frame(state) { layer.setState(state, { still: quiet }); },
    resize: (w, h, dpr) => layer.resize(w, h, dpr),
    invalidate: () => layer.invalidate(),
    layer,
  };
}
