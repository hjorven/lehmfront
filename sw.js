// Service Worker (P18): Lehmfront offline spielbar. Alle Pfade relativ zum Ort dieser Datei, weil GitHub Pages
// unter /lehmfront/ liegt und lokal unter /.
// Strategie: Netz zuerst (online immer die frische Ausgabe, kein Mischmasch aus alten und neuen Modulen).
// Nur die Seite selbst faellt nach kurzer Wartezeit auf den Cache zurueck; Module, Stile und Daten nur ohne Netz. Bei der Installation wird die ganze Liste vorgeladen;
// danach frischt der Worker sie hoechstens stuendlich im Hintergrund auf, damit offline alles zusammenpasst.
// Die Liste unten schreibt `node tools/precache.mjs` (ein Test prueft, dass sie zum Stand der Dateien passt).
// VERSION haengt an der Liste: neue oder entfernte Dateien ergeben einen neuen Cache und den Update-Hinweis.

// precache:start
const VERSION = 'b228fd4b';
const FILES = [
  'assets/fonts/caveat-latin-400-normal.woff2',
  'assets/fonts/caveat-latin-700-normal.woff2',
  'assets/fonts/ibm-plex-mono-latin-400-normal.woff2',
  'assets/fonts/ibm-plex-mono-latin-700-normal.woff2',
  'assets/fonts/ibm-plex-sans-latin-400-normal.woff2',
  'assets/fonts/ibm-plex-sans-latin-700-normal.woff2',
  'assets/fonts/special-elite-latin-400-normal.woff2',
  'assets/icons/lehmfront-192.png',
  'assets/icons/lehmfront-512-maskable.png',
  'assets/icons/lehmfront-512.png',
  'css/debug-state.css',
  'css/einstellungen.css',
  'css/etappe-window.css',
  'css/etappe3d.css',
  'css/feldzug.css',
  'css/feuerplan.css',
  'css/film.css',
  'css/gefecht.css',
  'css/graben.css',
  'css/karte.css',
  'css/klang.css',
  'css/lehrling.css',
  'css/lorenplan.css',
  'css/mission.css',
  'css/modi.css',
  'css/motion.css',
  'css/narrative.css',
  'css/paper.css',
  'css/sound.css',
  'css/style.css',
  'css/uhr.css',
  'data/letters/briefe-akt1-2.json',
  'data/letters/briefe-akt3-4.json',
  'data/letters/templates.json',
  'data/maps/akt1-m1.json',
  'data/maps/akt1-m2.json',
  'data/maps/akt1-m3.json',
  'data/maps/akt1-m4.json',
  'data/maps/akt1-m5.json',
  'data/maps/akt1-m6.json',
  'data/maps/asse.json',
  'data/missions/akt1-m1.json',
  'data/missions/akt1-m2.json',
  'data/missions/akt1-m3.json',
  'data/missions/akt1-m4.json',
  'data/missions/akt1-m5.json',
  'data/missions/akt1-m6.json',
  'data/names.json',
  'data/paper/demo.json',
  'data/scenarios/asse-frei.json',
  'data/texts/akt1.json',
  'data/texts/akt2.json',
  'data/texts/akt3.json',
  'data/texts/akt4.json',
  'data/texts/berichte.json',
  'data/texts/enden.json',
  'data/texts/endlos.json',
  'data/texts/erfolge.json',
  'data/texts/fundstuecke.json',
  'data/texts/placeholders.json',
  'data/texts/stab.json',
  'data/texts/tutorial.json',
  'data/texts/zeitungen.json',
  'index.html',
  'js/ai.js',
  'js/ai/match.js',
  'js/ai/notes.js',
  'js/archive.js',
  'js/artillery.js',
  'js/audio/ambience.js',
  'js/audio/cues.js',
  'js/audio/director.js',
  'js/audio/engine.js',
  'js/audio/logic.js',
  'js/audio/music.js',
  'js/audio/sounds.js',
  'js/boot.js',
  'js/campaign.js',
  'js/config/artillery.js',
  'js/config/battlemaps.js',
  'js/config/buildings.js',
  'js/config/campaign-map.js',
  'js/config/doctrines.js',
  'js/config/factions.js',
  'js/config/grounds.js',
  'js/config/missions.js',
  'js/config/morale.js',
  'js/config/names.js',
  'js/config/orders.js',
  'js/config/reports.js',
  'js/config/supply.js',
  'js/config/units.js',
  'js/etappe-map.js',
  'js/etappe.js',
  'js/events.js',
  'js/film.js',
  'js/letters.js',
  'js/main.js',
  'js/map.js',
  'js/mapgen.js',
  'js/missions/akt1.js',
  'js/missions/goals.js',
  'js/missions/index.js',
  'js/missions/run.js',
  'js/missions/script.js',
  'js/modes/board.js',
  'js/modes/load.js',
  'js/modes/skirmish.js',
  'js/morale.js',
  'js/narrative/casualties.js',
  'js/narrative/interlude.js',
  'js/narrative/places.js',
  'js/narrative/sheets.js',
  'js/narrative/stats.js',
  'js/narrative/texts.js',
  'js/orders.js',
  'js/phases/artillery.js',
  'js/phases/battle.js',
  'js/phases/build.js',
  'js/phases/campaign.js',
  'js/phases/clock.js',
  'js/phases/dig.js',
  'js/phases/dugout.js',
  'js/phases/fire.js',
  'js/phases/hold.js',
  'js/phases/index.js',
  'js/phases/intel.js',
  'js/phases/melee.js',
  'js/phases/mission.js',
  'js/phases/morale.js',
  'js/phases/move.js',
  'js/phases/rebuild.js',
  'js/phases/registry.js',
  'js/phases/supply.js',
  'js/phases/weather.js',
  'js/phases/wire.js',
  'js/placenames.js',
  'js/render/artillery-layer.js',
  'js/render/camera.js',
  'js/render/decor.js',
  'js/render/film-layer.js',
  'js/render/fire-layer.js',
  'js/render/geometry.js',
  'js/render/map-layer.js',
  'js/render/units-layer.js',
  'js/render/weather-layer.js',
  'js/resolve.js',
  'js/rng.js',
  'js/rules.js',
  'js/save.js',
  'js/savegame.js',
  'js/scenes/beispiel.js',
  'js/scenes/debug-state.js',
  'js/scenes/erzaehlung.js',
  'js/scenes/etappe.js',
  'js/scenes/feldzug.js',
  'js/scenes/gefecht-frei.js',
  'js/scenes/gefecht.js',
  'js/scenes/karte.js',
  'js/scenes/klang.js',
  'js/scenes/papier.js',
  'js/scenes/tageslage.js',
  'js/settings.js',
  'js/sight.js',
  'js/state.js',
  'js/supply.js',
  'js/theme.js',
  'js/trench.js',
  'js/ui/archive.js',
  'js/ui/campaign/board.js',
  'js/ui/campaign/mission.js',
  'js/ui/campaign/store.js',
  'js/ui/campaign/warmap.js',
  'js/ui/clock.js',
  'js/ui/commit.js',
  'js/ui/daytime.js',
  'js/ui/dom.js',
  'js/ui/etappe-window.js',
  'js/ui/etappe3d/index.js',
  'js/ui/etappe3d/model.js',
  'js/ui/etappe3d/panel.js',
  'js/ui/film.js',
  'js/ui/fireplan.js',
  'js/ui/gamemenu.js',
  'js/ui/hud.js',
  'js/ui/labels.js',
  'js/ui/lask-note.js',
  'js/ui/lehrling.js',
  'js/ui/linedraw.js',
  'js/ui/lorenplan.js',
  'js/ui/menu-akte.js',
  'js/ui/mission.js',
  'js/ui/narrative/index.js',
  'js/ui/narrative/journal.js',
  'js/ui/narrative/kinds.js',
  'js/ui/narrative/load.js',
  'js/ui/narrative/reader.js',
  'js/ui/orderbook.js',
  'js/ui/orderlist.js',
  'js/ui/overlays.js',
  'js/ui/overlays/height.js',
  'js/ui/overlays/index.js',
  'js/ui/overlays/sight.js',
  'js/ui/overlays/supply.js',
  'js/ui/overlays/threat.js',
  'js/ui/paper/art.js',
  'js/ui/paper/index.js',
  'js/ui/paper/kinds/builtin.js',
  'js/ui/paper/layer.js',
  'js/ui/paper/layout.js',
  'js/ui/paper/registry.js',
  'js/ui/radial.js',
  'js/ui/result.js',
  'js/ui/settings.js',
  'js/ui/shield.js',
  'js/ui/sound.js',
  'js/ui/summary.js',
  'js/ui/telegram.js',
  'js/ui/toolbar.js',
  'js/ui/tools.js',
  'js/ui/tools/artillery.js',
  'js/ui/tools/assault.js',
  'js/ui/tools/dig.js',
  'js/ui/tools/drain.js',
  'js/ui/tools/etappe.js',
  'js/ui/tools/fire.js',
  'js/ui/tools/flare.js',
  'js/ui/tools/hold.js',
  'js/ui/tools/index.js',
  'js/ui/tools/move.js',
  'js/ui/tools/rebuild.js',
  'js/ui/tools/relieve.js',
  'js/ui/tools/supply.js',
  'js/ui/tools/wire.js',
  'js/ui/weather-fx.js',
  'js/view.js',
  'js/weather.js',
  'manifest.webmanifest',
];
// precache:end

const CACHE = 'lehmfront-' + VERSION;
const NETWORK_WAIT_MS = 4000;
const REFRESH_MS = 60 * 60 * 1000;
const STAMP = '__aufgefrischt';

const url = (p) => new URL(p, self.registration.scope).href;

async function fill(cache, mode) {
  // Einzeln statt addAll: eine fehlende Datei soll nicht die ganze Installation kippen
  await Promise.all(['./', ...FILES].map(async (p) => {
    try {
      const res = await fetch(new Request(url(p), { cache: mode }));
      if (res.ok) await cache.put(url(p), res);
    } catch { /* offline oder fehlt: beim naechsten Mal */ }
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => fill(c, 'reload')));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lehmfront-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
    await (await caches.open(CACHE)).put(url(STAMP), new Response(String(Date.now())));
  })());
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'skip-waiting') self.skipWaiting();
});

// Zeitpunkt im Cache, nicht in einer Variablen: der Browser beendet den Worker nach kurzer Ruhe
async function refreshLater() {
  const c = await caches.open(CACHE);
  const last = Number(await (await c.match(url(STAMP)))?.text() ?? 0);
  if (Date.now() - last < REFRESH_MS) return;
  await c.put(url(STAMP), new Response(String(Date.now())));
  await fill(c, 'no-cache');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin || !u.href.startsWith(self.registration.scope)) return;
  const nav = req.mode === 'navigate';
  // Seiten mit Abfrage (?scene=...) teilen sich index.html; Dateien ohne Abfrage
  const key = nav ? url('./') : u.origin + u.pathname;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const net = fetch(req).then((res) => {
      if (res.ok && res.type === 'basic') cache.put(key, res.clone());
      return res;
    });
    net.catch(() => {}); // Fehler wird unten behandelt
    if (nav) e.waitUntil(refreshLater().catch(() => {}));
    let timer;
    const late = nav ? new Promise((ok) => { timer = setTimeout(ok, NETWORK_WAIT_MS); }) : new Promise(() => {});
    try {
      const res = await Promise.race([net, late.then(() => null)]);
      if (res) return res;
    } catch { /* ohne Netz */ } finally { clearTimeout(timer); }
    const hit = await cache.match(key);
    if (hit) return hit;
    return net.catch(() => new Response('Offline und nicht im Speicher: ' + u.pathname, { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } }));
  })());
});
