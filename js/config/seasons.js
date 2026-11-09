// Jahreszeiten fuer den Endlosmodus "Frontabschnitt" (P22, Plan 8.3): alle sechs Wochen eine neue.
// Wettertabellen je Jahreszeit (Hundertstel, Zeile = altes Wetter, Spalten wie WEATHER_KINDS in js/weather.js),
// Grabgeschwindigkeit (Frost macht den Lehm zu Stein) und Sonnenstand fuer die Erzaehlung.
// state.weather.season = 'sommer' | 'herbst' | 'winter' | 'fruehling' schaltet die Tabelle um; ohne bleibt alles wie vorher.

export const SEASON_IDS = ['sommer', 'herbst', 'winter', 'fruehling'];

export const SEASONS = {
  sommer: {
    id: 'sommer', name: 'Sommer', article: 'der Sommer', digPct: 100,
    weather: {
      clear:    { clear: 65, overcast: 22, rain: 4,  storm: 2,  fog: 7 },
      overcast: { clear: 40, overcast: 32, rain: 18, storm: 6,  fog: 4 },
      rain:     { clear: 25, overcast: 35, rain: 25, storm: 10, fog: 5 },
      storm:    { clear: 30, overcast: 35, rain: 25, storm: 5,  fog: 5 },
      fog:      { clear: 55, overcast: 25, rain: 5,  storm: 0,  fog: 15 },
    },
  },
  herbst: {
    id: 'herbst', name: 'Herbst', article: 'der Herbst', digPct: 100,
    weather: {
      clear:    { clear: 30, overcast: 35, rain: 15, storm: 5,  fog: 15 },
      overcast: { clear: 10, overcast: 30, rain: 45, storm: 7,  fog: 8 },
      rain:     { clear: 3,  overcast: 22, rain: 55, storm: 12, fog: 8 },
      storm:    { clear: 3,  overcast: 22, rain: 55, storm: 15, fog: 5 },
      fog:      { clear: 15, overcast: 35, rain: 25, storm: 0,  fog: 25 },
    },
  },
  winter: {
    id: 'winter', name: 'Winter', article: 'der Winter', digPct: 60,
    weather: {
      clear:    { clear: 50, overcast: 30, rain: 3,  storm: 2,  fog: 15 },
      overcast: { clear: 20, overcast: 50, rain: 12, storm: 8,  fog: 10 },
      rain:     { clear: 10, overcast: 45, rain: 25, storm: 10, fog: 10 },
      storm:    { clear: 10, overcast: 40, rain: 25, storm: 20, fog: 5 },
      fog:      { clear: 25, overcast: 40, rain: 5,  storm: 0,  fog: 30 },
    },
  },
  fruehling: {
    id: 'fruehling', name: 'Frühling', article: 'der Frühling', digPct: 85,
    weather: {
      clear:    { clear: 45, overcast: 30, rain: 10, storm: 2,  fog: 13 },
      overcast: { clear: 20, overcast: 30, rain: 35, storm: 5,  fog: 10 },
      rain:     { clear: 10, overcast: 30, rain: 40, storm: 5,  fog: 15 },
      storm:    { clear: 10, overcast: 30, rain: 45, storm: 10, fog: 5 },
      fog:      { clear: 35, overcast: 30, rain: 15, storm: 0,  fog: 20 },
    },
  },
};

/** Wettertabelle einer Jahreszeit oder null (dann gilt WEATHER_TABLE) */
export function seasonWeather(id) {
  return SEASONS[id]?.weather ?? null;
}
