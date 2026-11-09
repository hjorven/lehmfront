// Szene "gefecht": der spielbare Gefechtsbildschirm (P03, Plan 3.4, 7.2, 7.3, 7.6).
// Gefecht laden, Gruppen waehlen, Befehle geben (Werkzeugreihe, radiales Menue, Tastatur), Runde ausfuehren.
// Parameter: scenario=asse-frei, mode=frei|hotseat, seed=<Zahl>, night=0..1 (erzwingt Dunkelheit),
//   kind=battle (Gefechtsrunde testen), x, y, zoom (Kamera), demo=<Zustand fuer Screenshots>.
import { loadMap, cellAt, cellLabel, applyCellState } from '../map.js';
import { SEASONS } from '../config/seasons.js';
import { captureTrench } from '../trench.js';
import { initEtappen, withEtappe, etappeOf, plotAt } from '../etappe-map.js';
import { createInitialState, groupsOf, getGroup, otherSide } from '../state.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { sightLine, coverAt, PINNED, darknessOf } from '../sight.js';
import { faction } from '../config/factions.js';
import { themeAt, applyTheme, currentTheme, baseTheme, onThemeChange, blueprintTheme } from '../theme.js';
import {
  createCamera, resizeCamera, attachCameraControls, screenToWorld, worldToScreen, centerOn, fitZoom,
} from '../render/camera.js';
import { createMapLayer, sheetBounds, FONTS } from '../render/map-layer.js';
import { drawBattle, hitUnit, unitBox } from '../render/units-layer.js';
import { playSfx, audio } from '../audio/engine.js';
import { getSetting } from '../settings.js';
import { frontAmbience } from '../audio/director.js';
import { mountSoundControls } from '../ui/sound.js';
import { decide } from '../ai.js';
import { maybeIntercept, noteFromDecision } from '../ai/notes.js';
import { attachLehrling } from '../ui/lehrling.js';
import { createLaskNote, laskNoteOverlay } from '../ui/lask-note.js';
import {
  createOrderBook, setOrder, clearOrder, undo, canUndo, listOrders, orderOf, seal, nextRound,
} from '../ui/orderbook.js';
import { summarize, checklist, HOLD_TYPES } from '../ui/summary.js';
import { allTools, shownTools, toolByKey, usable } from '../ui/tools.js';
import '../ui/tools/index.js';
import { overlaySlots } from '../ui/overlays.js';
import '../ui/overlays/index.js';
import { planMove, pathRounds } from '../ui/tools/move.js';
import { currentWagons } from '../ui/tools/supply.js';
import { planAssault } from '../ui/tools/assault.js';
import { moraleRows, listNote } from '../ui/tools/relieve.js';
import { freeRestCell } from '../morale.js';
import { capacityOf, addWounded } from '../supply.js';
import {
  groupName, groupMark, typeName, leaderShort, fatigueWord, weatherName, clockText, roundTitle, orderLabel, plural,
} from '../ui/labels.js';
import { darknessAt } from '../ui/daytime.js';
import { esc, ensureCss, reducedMotion } from '../ui/dom.js';
import { createHud } from '../ui/hud.js';
import { clockModel, clockSvg, clockLabel } from '../ui/clock.js';
import { isAttacker, BATTLE_ROUNDS, BATTLE_MINUTES } from '../phases/battle.js';
import { createToolbar } from '../ui/toolbar.js';
import { createShield } from '../ui/shield.js';
import { createRadial } from '../ui/radial.js';
import { createOrderList } from '../ui/orderlist.js';
import { showSummary, showHandover } from '../ui/commit.js';
import { planFilm, replayTo } from '../film.js';
import { createArchive, archiveRound, inputOf, entryTitle } from '../archive.js';
import { phasesFor } from '../phases/registry.js';
import { createFilmPlayer } from '../ui/film.js';
import { attachWeather, applyWeatherParams } from '../ui/weather-fx.js';
import { mudAt, MUD_WORDS, waterAt, WATER_WORDS } from '../weather.js';
import { drawArtilleryMap, burnSpot } from '../render/artillery-layer.js';
import { hashSeed } from '../render/geometry.js';
import { createTelegram } from '../ui/telegram.js';
import { createArchiveView } from '../ui/archive.js';
import { drawFilmTrails } from '../render/film-layer.js';
import { loadBattle } from '../modes/load.js';
import { attachModeRules } from '../ui/result.js';
import { attachGameMenu, resumeGame } from '../ui/gamemenu.js';
import { saveQuery } from '../savegame.js';
import { campaignMission } from '../ui/campaign/mission.js';
import { endlessWeek } from '../ui/endless/week.js';
import { prepareMission, missionAi, withMissionOrders } from '../missions/script.js';
import { attachMissionUi } from '../ui/mission.js';
import { carryOrders, recordFrom } from '../online/replay.js';
import { setupOnline, attachMatch, brokenText, blockMatch, telegramLines } from '../online/session.js';
import { attachLageRules } from '../ui/lage-rules.js';
import { createKoop } from '../ui/koop.js';

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const LONG_PRESS_MS = 430;
const NARROW = 700;
// Finger als Hauptzeiger (Tablet, Handy): Hinweise sprechen von Antippen statt Klicken und Tasten
const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

export async function mount(root, params) {
  const fetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('Datei fehlt: ' + url); return r.json(); });
  // P17: Modus aus der URL (Gefecht frei mit Karte, Zufallskarte, Hotseat, Tageslage), sonst scenario=<id>
  const [battle] = await Promise.all([
    loadBattle(params, fetchJson),
    ensureCss('css/gefecht.css'),
    ensureCss('css/film.css'),
    ensureCss('css/feuerplan.css'), // P09: Editor und Zittern der Karte bei Einschlaegen
    ensureCss('css/uhr.css'),
    ensureCss('css/motion.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "IBM Plex Mono"', '16px "Caveat"', '700 16px "Caveat"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const { scenario, mapJson, scenId, mode: modeInfo } = battle;
  const map = loadMap(mapJson);
  const mode = modeInfo?.kind === 'hotseat' ? 'hotseat' : 'frei';
  // Tageslage: fuer alle dieselbe Lage, darum keine URL-Eingriffe in Wetter, Rundenart oder Gegner
  const fixed = modeInfo?.kind === 'tageslage' || modeInfo?.kind === 'endlos';
  const seed = battle.seed ?? ((num(params.get('seed'), 1917) >>> 0) || 1);
  // P20: Wiedergabe eines Online-Gefechts: Startzustand aus dem oeffentlichen Seed (iseed), Wuerfe aus seed
  let state = createInitialState(map, scenario, params.has('iseed') ? (num(params.get('iseed'), seed) >>> 0) : seed);
  state.seed = seed;
  state = initEtappen(state, map, scenario); // P11: Etappe mit Grundausbau aus dem Szenario
  state = prepareMission(state, scenario); // P16: Ablaufplan einer Kampagnenmission (Lask, Wetter), sonst unveraendert
  // P14: Einsatz aus der Kampagne (Ansehen, Vertrauen, Berichte, Nachschub, Ersatz), sonst null
  // P22: oder eine Woche im Frontabschnitt (Zustand aus dem Speicher des Laufs)
  const campaignRun = campaignMission(params) ?? endlessWeek(params, map);
  if (campaignRun) state = campaignRun.prepare(state, map);
  // P25: Puzzle-Lage oder eigene Lage legt ihren Startzustand fest (Gefechtsrunde, eroberte Graeben)
  if (battle.prepare) state = battle.prepare(state);
  // Tageslage und Puzzle-Lagen (P25: die Loesung gilt fuer feste Bedingungen) nehmen keine Vorgaben aus der Adresse
  const locked = fixed || modeInfo?.kind === 'puzzle';
  if (!locked && params.get('kind') === 'battle') { state.turnKind = 'battle'; state.battle = { round: 1 }; }
  if (!locked) applyWeatherParams(state, map, params);
  // P18: Spielstand aus ?slot= ersetzt den Startzustand; Archiv und KI-Gedaechtnis folgen weiter unten
  const startState = structuredClone(state);
  let resumed = await resumeGame(params);
  // P20: Wiedergabe-Link (wiedergabe=1, Protokoll im Anker) oder Online-Gefecht (match=<id>)
  const online = await setupOnline(params, { map, start: startState, seed, info: modeInfo });
  if (online?.resumed) resumed = online.resumed;
  if (online?.kind === 'match') resumed = null; // Online gilt nur die Sicht vom Stab, nie ein lokaler Stand
  if (online?.state) state = online.state;
  if (resumed) state = resumed.state;
  const humans = online?.side ? [online.side] : mode === 'hotseat' ? ['a', 'b'] : ['a'];
  // P25: Koop, zwei Kommandos teilen Seite a (js/ui/koop.js)
  const koop = modeInfo?.kind === 'koop' && !online ? createKoop(state, map) : null;
  let lageOverlays = () => []; // P25: Ziel und Plan des Gegners, gesetzt, sobald die Wertung steht
  const env = { map };
  // KI-Kommandant (P13): Doktrin und Schwierigkeit aus dem Szenario (sides.b.ai), per URL &doktrin= &ki=.
  // Mit Marschbefehl (karte=) steckt die Wahl schon im Szenario; die Tageslage nimmt gar keine URL-Eingriffe an.
  const sai = scenario.sides.b.ai ?? {};
  const urlAi = { doctrine: params.get('doktrin') || undefined, difficulty: params.get('ki') || undefined };
  let aiCfg;
  if (fixed) aiCfg = { doctrine: sai.doctrine, difficulty: sai.difficulty };
  else if (modeInfo?.map) aiCfg = { doctrine: sai.doctrine ?? urlAi.doctrine, difficulty: sai.difficulty ?? urlAi.difficulty };
  else aiCfg = { doctrine: urlAi.doctrine ?? sai.doctrine, difficulty: urlAi.difficulty ?? sai.difficulty };
  if (sai.goals) aiCfg.goals = sai.goals; // P24: Szenarioziele der KI (z. B. Fliegerziele in Akt 3)
  let aiMemory;                 // Gedaechtnis der KI ueber die Runden
  let aiNext = null;            // { turn, decision }: Lasks naechster Zug, schon nach der Runde gerechnet (Notizen)
  let pendingNote = null;       // abgefangene Notiz, erscheint nach dem Phasenfilm
  let noteMark = null;          // Bleistiftkringel der letzten Notiz auf der Karte
  // Karte mit Graeben, Kratern usw. aus dem Spielzustand (Anzeige und Werkzeuge); env.map bleibt die Grundkarte
  // Nur Felder, die die planende Seite kennt (Nebel des Krieges fuer Graeben, Aufwurf usw.)
  let seenCells = viewFor(state, [], humans[0], env).cells; // Seite a plant zuerst (online: die eigene Seite)
  // P11: Etappengebaeude aus dem Spielzustand ersetzen die Kartengebaeude der Etappe (withEtappe)
  let liveMap = withEtappe(applyCellState(map, seenCells), state, humans[0]);
  const updateLiveMap = () => { seenCells = viewFor(state, [], side, env).cells; liveMap = withEtappe(applyCellState(map, seenCells), state, side); layer.setMap(liveMap); };

  // Planungszustand
  let side = humans[0];
  let book = createOrderBook();
  let decor = null;            // Zeichnung eines offenen Editors (Feuerplan, P09), unter den Gruppen
  let burns = [];              // Brandloecher am Kartenrand nach Einschlaegen (P09, nur Optik)
  let shelledSeen = shelledCount(state); // Einschlaege, die der Film schon gezeigt hat (Papier vibriert bei neuen)
  let sidePlans = { a: {}, b: {} };  // Seitenbefehle dieser Runde nach Art (Lorenplan), nicht im Befehlsbuch
  let plannerWindow = null;
  let selectedId = null;
  let tool = null;              // { def, group, pick, preview, hoverCell }
  let anim = null;              // { group, progress }
  let overlaysOn = new Set();
  let transient = null;         // { text, tone, until }
  let lastLog = [];
  let lastRound = null;         // { input, result } der zuletzt aufgeloesten Runde (Phasenfilm)
  let archive = createArchive(scenId);
  let filmFrame = null;         // Bild des laufenden Phasenfilms, sonst null
  let pendingDark = null;       // { from, to }: Tag-Nacht-Uebergang, den der naechste Film zeigt
  let helpShown = false;
  let suppressTap = false;
  let modalOpen = false;
  if (resumed) { archive = resumed.archive ?? archive; aiMemory = resumed.aiMemory; lastLog = resumed.lastLog; if (resumed.book) book = resumed.book; if (resumed.decor) burns = resumed.decor.burns; }
  if (online?.kind === 'match' && online.state) { lastLog = online.log; book = nextRound(book, { a: [], b: [], [online.side]: online.carry }); }
  const forcedDark = params.has('night') && !fixed ? Math.max(0, Math.min(1, num(params.get('night'), 0))) : null;
  // Erzwungene Nacht auch fuer die Regeln (Sichtweite, Trefferchance): Uhr auf 22 Uhr stellen
  if (forcedDark !== null && forcedDark >= 0.5 && !state.night) { state.clock = { ...state.clock, hour: 22, minute: 0 }; state.night = true; }
  let hoverSight = null;       // Sichtlinie der gewaehlten Gruppe zum Feld unter der Maus (P05)

  root.className = 'gefecht';
  root.innerHTML = `
    <canvas class="g-static" aria-hidden="true"></canvas>
    <canvas class="g-dyn" tabindex="0" aria-label="Lagekarte ${esc(map.name)}. Leertaste wählt die nächste Gruppe ohne Befehl."></canvas>
    <div class="g-ui"></div>`;
  const $ = (s) => root.querySelector(s);
  const staticCv = $('.g-static'), dynCv = $('.g-dyn'), ui = $('.g-ui');
  const narrow = () => root.clientWidth < NARROW;

  // Tageszeit aus der Uhr
  let darkness = forcedDark ?? darknessAt(state.clock, state.turnKind, state.night);
  applyTheme(themeAt(darkness));

  // Kamera: Desktop zeigt die Front mit Etappe, Handy startet auf der Stellung der planenden Seite
  const sheet = sheetBounds(map);
  const cam = createCamera({ bounds: { ...sheet, h: sheet.h + 4 }, maxZoom: 110 });
  resizeCamera(cam, root.clientWidth, root.clientHeight);
  function homeView() {
    const own = groupsOf(state, side);
    // Szenario darf den Blick vorgeben (z. B. a4m5: das Ufer, nicht die Front), sonst Mitte der eigenen Gruppen
    const cx = Number.isFinite(scenario.view?.x) ? scenario.view.x - (side === 'a' ? 4 : -4) : own.length ? own.reduce((s, g) => s + g.pos.x, 0) / own.length : map.width / 2;
    const vw = root.clientWidth, vh = root.clientHeight;
    if (vw < NARROW) centerOn(cam, side === 'a' ? cx + 4 : cx - 4, map.height * 0.42, Math.max(fitZoom(cam), vw / 20));
    // Tablet hochkant: Karte fuellt die Hoehe, Ausschnitt um die eigene Stellung bis ins Niemandsland
    else if (vh > vw * 1.15) centerOn(cam, side === 'a' ? cx + 5 : cx - 5, map.height * 0.5, Math.max(fitZoom(cam), Math.min(vw / 26, vh / 38)));
    else centerOn(cam, map.width * 0.5, map.height * 0.5 + 1, Math.max(fitZoom(cam), Math.min(vw / 50, vh / 34)));
  }
  homeView();
  if (params.has('zoom') || params.has('x') || params.has('y')) {
    centerOn(cam, num(params.get('x'), cam.x), num(params.get('y'), cam.y), num(params.get('zoom'), cam.zoom));
  }

  const layer = createMapLayer(staticCv, liveMap, { getCamera: () => cam, getTheme: currentTheme });
  const weather = attachWeather({ root, before: dynCv, map, seed, cam, staticCanvas: staticCv, getTheme: currentTheme, still: params.has('demo') });
  if (resumed?.decor?.stains?.length) weather.layer.importStains(resumed.decor.stains); // Tropfenflecken aus der Akte (P21)
  const dctx = dynCv.getContext('2d');
  let dpr = 1;

  // ---------- Modell fuer Anzeige ----------
  const ordersNow = () => listOrders(book, side);
  const groupLabel = (g) => groupName(state, g);
  function shownGroups() {
    const v = viewFor(state, [], side, env);
    return { groups: v.groups.map((g) => ({ ...g, mark: groupMark(state, getGroup(state, g.id) ?? g) })), ghosts: v.ghosts };
  }
  const reachOf = (g, o) => (o?.path?.length ? pathRounds(map, state, g, o.path).reach : 0);
  function orderText(g, o) {
    if (!o) return 'Halten (Standard)';
    const desc = allTools().find((t) => t.describe && t.orderTypes?.includes(o.type));
    if (desc) return desc.describe(o, g, state, liveMap) + (o.carried ? ' · läuft weiter' : '');
    if (o.type === 'hold') return 'Halten';
    const dest = o.path?.length ? o.path[o.path.length - 1] : o.target;
    let t = orderLabel(o.type) + (dest ? ` nach ${cellLabel(dest.x, dest.y)}` : '');
    if (o.path?.length) t += ` · ${plural(pathRounds(map, state, g, o.path).rounds, 'Runde', 'Runden')}`;
    if (o.carried) t += ' · läuft weiter';
    return t;
  }

  // ---------- Zeichnen ----------
  let dynPending = 0;
  let animTimer = 0;
  function drawDyn() {
    if (dynPending) return;
    dynPending = requestAnimationFrame(() => { dynPending = 0; drawDynNow(); });
  }
  function drawDynNow() {
    if (filmFrame) { drawFilmNow(); placeShield(); return; }
    const { groups, ghosts } = shownGroups();
    const orders = new Map(ordersNow().map((o) => [o.group, o]));
    const reach = new Map();
    for (const g of groups) {
      const o = orders.get(g.id);
      if (o?.path) reach.set(g.id, reachOf(getGroup(state, g.id), o));
    }
    const prev = tool?.preview;
    drawBattle(dctx, cam, dpr, currentTheme(), {
      state, map: liveMap, cells: seenCells, side, groups, ghosts, orders, reach, selectedId, planning: !modalOpen, anim,
      hover: tool?.pick ? tool.hoverCell : null,
      armed: tool?.pick ? tool.armed ?? null : null,
      preview: prev ? { ...prev, group: tool.group.id, cell: tool.hoverCell, ok: prev.ok ?? !!prev.path } : null,
      sightLine: !tool && hoverSight ? hoverSight : null,
      overlays: [artilleryOverlay(state), ...(decor ? [{ draw: decor }] : []), ...activeOverlays(),
        ...(noteMark ? [laskNoteOverlay(noteMark)] : []), ...lehrling.overlays(), ...(missionUi?.overlays(state) ?? []), ...(campaignRun?.overlays?.() ?? []),
        ...lageOverlays(), ...(koop ? [koop.overlay(() => state.groups)] : [])],
      plans: sidePlans[side],
      time: performance.now(),
    });
    placeShield();
    // Bewegte Overlays (Loren im Versorgungs-Overlay) zeichnen weiter, solange sie an sind
    // gedrosselt auf etwa 30 Bilder je Sekunde, angehalten, solange ein Fenster offen ist
    if (!animTimer && !modalOpen && !reducedMotion() && !params.has('demo') && activeOverlays().some((o) => o.animated)) {
      animTimer = setTimeout(() => { animTimer = 0; drawDyn(); }, 33);
    }
  }

  // Artillerie (P09): scharfe Feuerplaene, durchtrennte Leitungen, frische Trichter, Brandloecher am Rand
  function artilleryOverlay(st) {
    return { draw: (ctx, o) => drawArtilleryMap(ctx, { ...o, state: st, pending: decor ? [] : sidePlans[side].fire_plan?.plans ?? null, burns }) };
  }
  function shelledCount(st) {
    let n = 0;
    for (const k in st.cells) n += st.cells[k].shelled ?? 0;
    return n;
  }
  /** Ueberraschung P09: neue Einschlaege lassen das Papier kurz vibrieren und brennen Loecher in den Kartenrand */
  function feelImpacts(st) {
    const n = shelledCount(st);
    if (n <= shelledSeen) { shelledSeen = Math.min(shelledSeen, n); return; }
    shelledSeen = n;
    const imp = (lastRound?.result.log ?? []).filter((e) => e.type === 'impacts');
    const turn = lastRound?.input.state.turn ?? state.turn;
    for (const e of imp) {
      const seed = hashSeed('brand', turn, e.at.x, e.at.y);
      if (burns.some((b) => b.seed === seed)) continue;
      burns.push({ ...burnSpot(map, e.at, seed), age: 0, turn });
    }
    burns = burns.slice(-14).map((b) => ({ ...b, age: b.turn === turn ? 0 : 1 }));
    // Klang kommt ueber die Ereignis-Haken (impacts, js/ui/tools/artillery.js)
    if (!reducedMotion()) {
      root.classList.remove('shake');
      void root.offsetWidth;
      root.classList.add('shake');
      setTimeout(() => root.classList.remove('shake'), 600);
      if (navigator.vibrate && navigator.userActivation?.hasBeenActive !== false) try { navigator.vibrate([18, 40, 12]); } catch { /* egal */ }
    }
  }

  function activeOverlays() {
    return overlaySlots().filter((o) => overlaysOn.has(o.slot) && o.draw);
  }

  // Phasenfilm: Zwischenstand aus dem Film, Spuren als Overlay unter den Gruppen
  function drawFilmNow() {
    const fr = filmFrame;
    const groups = fr.groups.map((g) => ({ ...g, mark: groupMark(fr.state, g) }));
    drawBattle(dctx, cam, dpr, currentTheme(), {
      state: fr.state, map, side, groups, ghosts: [], orders: new Map(), selectedId, planning: false,
      overlays: [artilleryOverlay(fr.state), { draw: (ctx, o) => drawFilmTrails(ctx, o, fr.trails) }, ...(missionUi?.overlays(fr.state) ?? [])],
    });
    feelImpacts(fr.state);
  }

  // ---------- Oberflaeche ----------
  const hud = createHud(ui, {
    onToggleList: () => toggleList(),
    onToggleOverlay: (slot) => toggleOverlay(slot),
    onCheck: (i) => { const c = hud.checkAt(i); if (c?.group) select(c.group, { center: true }); else if (c?.at) centerOn(cam, c.at.x + 0.5, c.at.y + 0.5); refresh(); },
    onToggleSheet: () => { root.classList.toggle('sheet-open'); hud.setSheet(root.classList.contains('sheet-open')); },
    onRoundAction: () => callOffAttack(),
  });
  // Klang (P19): Knopf rechts, auf dem Handy als Karte in der Seitenleiste
  mountSoundControls({ bar: ui.querySelector('.hud-right'), sheet: ui.querySelector('.hud-sheet') });
  // P17: Rundengrenze und Abschlussmeldung (Gefecht frei, Hotseat, Tageslage)
  const matchLink = online?.kind === 'match' && online.state
    ? attachMatch(ui, online, {
      onBlock: () => { cancelTool(false); radial.hide(); modalOpen = true; refresh(); },
      onUnblock: () => { modalOpen = false; refresh(); dynCv.focus({ preventScroll: true }); },
    }) : null;
  // P25: Puzzle-Lagen und eigene Lagen mit Ziel bringen ihre eigene Wertung mit (js/ui/lage-rules.js)
  const rules = (battle.lage ? attachLageRules : attachModeRules)({
    ui, info: modeInfo, map, start: startState, scenario, humans, aiCfg, lage: battle.lage, kind: battle.lageKind, resumed: !!resumed,
    // P20: Befehlsprotokoll fuer Wiedergabe-Link und Nachrechnen der Tageslage (nicht fuer Kampagne und Online)
    // Mit erzwungener Nacht (night=, nur Ansicht) liesse sich die Partie nicht genau nachrechnen
    record: () => (campaignRun || online?.kind === 'match' || params.has('night') ? null
      : recordFrom(archive, { query: saveQuery(params), seed, title: map.name })),
    onOpen: () => { modalOpen = true; cancelTool(false); radial.hide(); refresh(); },
    onClose: () => { modalOpen = false; refresh(); dynCv.focus({ preventScroll: true }); },
  });
  if (resumed) rules.restore(resumed.rules, state);
  if (resumed && koop) koop.restore(resumed.rules?.koop);
  if (rules.overlays) lageOverlays = () => rules.overlays(state);
  // P18: Dienstbuch (Einstellungen, Spielstaende, Klang, Tasten) und laufende Akte nach jeder Runde
  const gameMenu = attachGameMenu({
    ui, params,
    snapshot: () => ({ state, map: liveMap, archive, aiMemory, lastLog, rules: { ...rules.snapshot(), ...(koop ? { koop: koop.snapshot() } : {}) }, side, book,
      decor: { burns: burns.map(({ x, y, r, seed, turn }) => ({ x, y, r, seed, turn })), stains: weather.layer.exportStains?.() ?? [] } }),
    busy: () => (online?.kind === 'match' ? 'Online-Gefechte liegen beim Stab, nicht in der Kartentasche.'
      : online?.kind === 'replay' ? 'Eine Wiedergabe steckt im Link, nicht in der Kartentasche.'
      : filmFrame || book.a?.sealed || book.b?.sealed ? 'Während der Ausführung oder Übergabe kann nicht abgelegt werden.' : rules.ended ? 'Die Partie ist beendet.' : null),
    canOpen: () => !modalOpen && !filmFrame,
    ended: () => rules.ended,
    onOpen: () => { cancelTool(false); radial.hide(); modalOpen = true; refresh(); },
    onClose: () => { modalOpen = false; refresh(); },
  });
  // Taktik-Lehrling (P13, Taste T) und abgefangene Notizen von Lask
  // P16: Auftragszettel, Hinweise der Figuren, in Mission 1 die Karte, die sich erst zeichnet (null ohne Mission)
  const missionUi = attachMissionUi({ ui, scenario, map, params, getArchive: () => archive, onChange: () => refresh() });
  const lehrling = attachLehrling({
    ui, bar: ui.querySelector('.hud-right'), sheet: ui.querySelector('.hud-sheet'), decide, viewFor, map, env, seed, cfg: aiCfg,
    now: () => ({ state, side, log: lastLog, orderOf: (id) => orderOf(book, side, id), plans: sidePlans[side] }),
    canOpen: () => { if (book[side]?.sealed || filmFrame) { flash('Der Lehrling hilft beim Planen, nicht jetzt.'); return false; } return true; },
    adopt: (o) => { if (book[side]?.sealed) return; book = setOrder(book, side, o); helpShown = true; playSfx('pencil', { count: 2, intensity: 0.5 }); },
    adoptPlan: (o) => {
      if (book[side]?.sealed) return;
      // Feuerplaene nach ID zusammenfuehren, damit eigene Plaene des Spielers bleiben
      const have = sidePlans[side][o.type]?.plans ?? [];
      const plans = [...have.filter((p) => !o.plans.some((q) => q.id === p.id)), ...o.plans];
      sidePlans[side] = { ...sidePlans[side], [o.type]: { ...o, plans } };
      flash(have.length ? 'Feuerplan des Lehrlings zu den eigenen Plänen gelegt.' : 'Feuerplan des Lehrlings übernommen.');
    },
    label: (g) => groupLabel(g), mark: (g) => groupMark(state, g), describe: (g, o) => orderText(g, o),
    focus: ({ group, at }) => {
      const p = group ? getGroup(state, group)?.pos : at;
      if (group) select(group);
      // Auf dem Handy liegt das Kaertchen unten: das Ziel ins obere Drittel holen
      if (p) { centerOn(cam, p.x + 0.5, p.y + 0.5 + (narrow() ? (root.clientHeight * 0.2) / cam.zoom : 0)); onCamera(); refresh(); }
    },
    beforeOpen: () => { cancelTool(false); if (orderList.open) closeList(); report.hide(); playSfx('paper', { intensity: 0.4 }); },
    changed: () => refresh(),
  });
  const laskNote = createLaskNote(ui, {
    onJump: (at) => { laskNote.hide(); centerOn(cam, at.x + 0.5, at.y + 0.5, Math.max(cam.zoom, narrow() ? 24 : 20)); onCamera(); refresh(); dynCv.focus({ preventScroll: true }); },
    onClose: () => { laskNote.hide(); playSfx('paper', { intensity: 0.3 }); dynCv.focus({ preventScroll: true }); },
  });
  function showNote(note) {
    noteMark = note;
    laskNote.show(note);
    playSfx('paper', { intensity: 0.7 });
  }
  campaignRun?.mount(ui, { getState: () => state, getArchive: () => archive, isBusy: () => modalOpen, setModal: (on) => { modalOpen = on; refresh(); } });
  const toolbar = createToolbar(ui, {
    onTool: (id, disabled) => {
      const def = allTools().find((t) => t.id === id);
      const g = selectedOwn();
      if (disabled) { flash(usable(def, g, state, env).why || `${def.label} geht gerade nicht`, 'warn'); return; }
      startTool(def, g);
    },
    onUndo: () => doUndo(),
    onExec: () => openSummary(),
  });
  const shield = createShield(ui);
  const orderList = createOrderList(ui, {
    onJump: (id) => { select(id, { center: true }); if (narrow()) closeList(); },
    onClear: (id) => {
      const g = getGroup(state, id);
      if (koop && g && !koop.owns(g)) { flash(`Gehört zu ${koop.ownerName(g)}. Pfeile sehen, aber nicht ändern.`); return; }
      book = clearOrder(book, side, id); playSfx('paper'); refresh();
    },
    onClose: () => closeList(),
  });
  // Telegramm, Phasenfilm und Protokoll-Archiv (P07)
  function jumpTo(l) {
    if (!l?.at) return;
    // Auf dem Handy deckt das Protokoll die Karte ganz ab: erst schliessen, dann springen
    if (archiveView.open && narrow()) closeArchive();
    centerOn(cam, l.at.x + 0.5, l.at.y + 0.5 + (narrow() ? 3 : 0), Math.max(cam.zoom, narrow() ? 26 : 22));
    if (player.open) player.seek(l.time);
    else if (l.group && !archiveView.open) selectedId = l.group;
    playSfx('paper', { intensity: 0.25 });
    onCamera();
    refresh();
  }
  const report = createTelegram(ui, {
    onJump: jumpTo,
    onFilm: () => { if (lastRound) startFilm(lastRound.input, lastRound.result, { title: filmTitle(lastRound.input.state) }); },
    onArchive: () => openArchive(),
  });
  const player = createFilmPlayer(ui, {
    onFrame: (fr) => { filmFrame = fr; weather.frame(fr.state); drawDyn(); },
    onLines: (n, typing) => report.setCount(n, typing),
    onEnd: () => endFilm(),
  });
  const archiveView = createArchiveView(ui, {
    onJump: jumpTo,
    onReplay: (entry) => {
      archiveView.hide();
      const input = inputOf(entry, env);
      startFilm(input, replayTo(input, phasesFor(entry.kind, env.phases).length), { title: entryTitle(entry) + ' · Protokoll', replay: true });
    },
    onClose: () => closeArchive(),
  });
  const radial = createRadial(ui, {
    onPick: (it) => { radial.hide(); dynCv.focus({ preventScroll: true }); if (it.id === '__clear') { book = clearOrder(book, side, it.group); refresh(); } else startTool(it.def, getGroup(state, it.group)); },
    onClose: () => { radial.hide(); dynCv.focus({ preventScroll: true }); },
  });

  function selectedOwn() {
    const g = selectedId ? getGroup(state, selectedId) : null;
    return g && g.side === side && g.status !== 'lost' && (!koop || koop.owns(g)) ? g : null;
  }

  function flash(text, tone = '') {
    transient = { text, tone, until: performance.now() + 4000 };
    refresh();
    setTimeout(() => { if (transient && performance.now() >= transient.until) { transient = null; refresh(); } }, 4100);
  }

  function currentHint() {
    if (tool?.pick) return { title: tool.pick.title ?? tool.def.label, text: tool.pickHint, tone: 'tool' };
    if (transient && performance.now() < transient.until) return { title: 'Hinweis', text: transient.text, tone: transient.tone };
    if (!helpShown && !ordersNow().length && state.turn === 1) {
      return { title: 'Hinweis', text: narrow()
        ? 'Gruppe antippen und Befehl wählen, oder lang drücken für Befehle im Kreis.'
        : (coarse() ? 'Gruppe antippen, dann Bewegen oder Halten wählen. Lang drücken öffnet die Befehle im Kreis.' : 'Gruppe anklicken, dann Bewegen (B) oder Halten (H). Lang drücken oder Rechtsklick öffnet die Befehle im Kreis.') };
    }
    return null;
  }

  function hudModel() {
    const s = state.sides[side];
    const own = groupsOf(state, side);
    const morale = own.length ? Math.round(own.reduce((a, g) => a + g.morale, 0) / own.length) : 0;
    const daytime = state.night ? 'Nacht' : 'Tag';
    // Jahreszeit im Kartentitel nach dem Wetter der Lage (P26: Huegel 214 im Fruehjahr statt im Herbst)
    const season = SEASONS[state.weather?.season]?.name;
    const sector = (map.sheet?.title?.replace(/^Lagekarte\s*/i, '') || map.name).replace(/(Frühjahr|Frühling|Sommer|Herbst|Winter)$/, (m) => season ?? m);
    const orders = ordersNow();
    const battleNow = state.turnKind === 'battle';
    const clk = clockModel(state);
    const attacking = isAttacker(state, side);
    return {
      side,
      supplies: { ...s.supplies, carts: currentWagons(map, state, side, sidePlans[side]).length, cartsTotal: capacityOf(state, side) }, morale, reputation: s.reputation, trust: s.trust,
      roundTitle: roundTitle(state) + (mode === 'hotseat' ? ` · ${faction(s.faction).short}` : koop ? ` · ${koop.title()}` : '') + rules.suffix(state) + (campaignRun?.suffix?.(state) ?? ''),
      roundSub: battleNow
        ? `Minute ${clk.minutes} von ${BATTLE_ROUNDS * BATTLE_MINUTES} · ${clockText(state.clock)} Uhr · ${attacking ? 'Sturm läuft' : 'Der Gegner greift an'}`
        : `${daytime} · ${clockText(state.clock)} Uhr · ${weatherName(state.weather)} · Abschnitt ${sector}`,
      stripRound: (battleNow ? `G${clk.round} · ${clk.minutes}/${BATTLE_ROUNDS * BATTLE_MINUTES} Min` : `R${state.turn} · ${daytime}`) + (koop ? ` · ${koop.short()}` : ''),
      clock: clockView(),
      roundAction: battleNow && attacking && !state.battle?.outcome?.[side] && !book[side]?.sealed && assaultersOf(side).length ? 'Angriff abbrechen' : null,
      orderCount: orders.length,
      overlays: overlaySlots().map((o) => ({ slot: o.slot, label: o.label, empty: !!o.empty, active: overlaysOn.has(o.slot) })),
      checklist: checklist({ state, side, orders, map, plans: sidePlans[side], only: koop ? koop.owns : null }),
      hint: currentHint(),
    };
  }

  // Uhr (P06): waehrend des Phasenfilms zeigt sie noch die alte Runde, danach rastet sie ein
  function clockView() {
    const st = player.open && lastRound ? lastRound.input.state : state;
    const m = clockModel(st);
    const label = clockLabel(m);
    return { mode: m.mode, big: clockSvg(m, { title: label }), small: clockSvg(m, { title: label }) };
  }
  let clockSnapDue = false;
  function snapClock() {
    clockSnapDue = false;
    hud.snapClock();
    playSfx('clock-lock', { intensity: 1 });
    if (reducedMotion()) return;
    root.classList.remove('jolt');
    void root.offsetWidth;
    root.classList.add('jolt');
    setTimeout(() => root.classList.remove('jolt'), 500);
  }
  /** Sturmgruppen der Seite, die noch angreifen */
  function assaultersOf(s) {
    return (state.battle?.assaulters?.[s] ?? []).map((id) => getGroup(state, id)).filter((g) => g && g.status !== 'lost');
  }
  /** "Angriff abbrechen": alle Sturmgruppen halten; ist die Runde ausgefuehrt, endet das Gefecht (Angriff steckt) */
  function callOffAttack() {
    if (book[side]?.sealed || modalOpen) return;
    for (const g of assaultersOf(side)) book = setOrder(book, side, { group: g.id, type: 'hold' });
    playSfx('pencil', { count: 2, intensity: 0.5 });
    flash('Die Sturmgruppen bleiben liegen. Mit dieser Runde wird der Angriff abgebrochen.', 'warn');
  }

  function refresh() {
    root.classList.toggle('picking', !!tool?.pick);
    hud.update(hudModel());
    const g = selectedOwn();
    toolbar.update({
      tools: shownTools(state).map((t) => ({ tool: t, ...usable(t, g, state, env) })),
      active: tool?.def.id ?? null,
      canUndo: canUndo(book, side),
      count: ordersNow().length,
      label: mode === 'hotseat' && side === 'a' && !book.b?.sealed ? 'Befehle versiegeln' : koop ? koop.button() : 'Runde ausführen',
    });
    if (orderList.open) updateList();
    lehrling.sync();
    missionUi?.sync({ state, orders: ordersNow(), selected: g, tool: tool?.def.id ?? null, busy: modalOpen || !!filmFrame });
    updateShield();
    if (!filmFrame) weather.update(state, side);
    drawDyn();
  }

  function updateList() {
    const rows = groupsOf(state, side).map((g) => {
      const o = orderOf(book, side, g.id);
      return { id: g.id, name: groupLabel(g), mark: groupMark(state, g), text: !o && g.status === 'rest' ? 'Ruht im Ruhelager' : orderText(g, o), set: !!o, resting: !o && g.status === 'rest', carried: !!o?.carried, note: o?.type === 'relieve' ? null : listNote(map, state, g) };
    });
    const n = rows.filter((r) => r.set).length;
    orderList.update(rows, `${n} von ${rows.length} mit Befehl`);
  }

  // ---------- Schild ----------
  function shieldAnchor(g) {
    const p = worldToScreen(cam, g.pos.x + 0.5, g.pos.y + 0.5);
    const b = unitBox(cam);
    const n = narrow();
    let safeBottom = n ? 96 : 92;
    // P18: Auf dem Handy liegt das Telegramm unten quer; das Schild bleibt darueber statt es zu verdecken
    if (n && report.open) safeBottom = Math.max(safeBottom, root.clientHeight - report.el.offsetTop + 8);
    return { x: p.x, y: p.y, h: b.h * cam.zoom + 8, safeTop: n ? 60 : 12, safeBottom };
  }
  function updateShield() {
    const g = selectedId ? getGroup(state, selectedId) : null;
    const visible = g && shownGroups().groups.some((x) => x.id === g.id);
    if (!g || !visible || g.status === 'lost' || radial.open || filmFrame || tool?.cleanup) { shield.hide(); return; }
    if (g.side !== side) {
      shield.show(`<header><b>Feind</b><span>${esc(typeName(g))}</span></header>
        <div class="rows"><div><span>Feld</span><b>${cellLabel(g.pos.x, g.pos.y)}</b></div><div><span>Deckung</span><b>${esc(coverAt(state, map, g.pos, g.side).label)}</b></div></div>
        <footer><span>Gesichtet</span><b>diese Runde</b></footer>`, shieldAnchor(g));
      return;
    }
    const o = orderOf(book, side, g.id);
    const prev = tool?.group?.id === g.id && tool.pick ? tool.preview : null;
    shield.show(`<header><b>${esc(groupLabel(g))}</b><span>${esc(leaderShort(g))}</span></header>
      <div class="type">${esc(typeName(g))}</div>
      <div class="rows">
        <div><span>Stärke</span><b>${g.strength} / ${g.size}</b></div>
        <div><span>Moral</span><b>${g.morale}</b></div>
        <div><span>Erschöpfung</span><b>${fatigueWord(g.fatigue)}</b></div>
        <div><span>Erfahrung</span><b>${g.experience} / 4</b></div>
        ${groundRow(g)}
        ${moraleRows(map, state, g).map((r) => `<div${r.warn ? ' class="warn"' : ''}><span>${esc(r.label)}</span><b>${esc(r.value)}</b></div>`).join('')}
        ${g.suppressed >= 0.3 ? `<div class="warn"><span>Unter Feuer</span><b>${g.suppressed >= PINNED ? 'niedergehalten' : 'geduckt'}</b></div>` : ''}
      </div>
      <footer><span>Befehl</span><b>${esc(orderText(g, o))}</b></footer>
      ${prev?.text ? `<div class="preview${(prev.ok ?? !!prev.path) ? '' : ' bad'}">${esc(prev.text)}</div>` : ''}
      ${prev && tool.armed ? '<div class="armed">Noch einmal antippen: Befehl setzen</div>' : ''}`, shieldAnchor(g));
  }
  // Boden unter der Gruppe (P10): Schlamm oder Wasser im Graben
  function groundRow(g) {
    const w = waterAt(state, g.pos.x, g.pos.y), m = mudAt(state, map, g.pos.x, g.pos.y);
    if (!w && !m) return '';
    const text = w >= 2 ? WATER_WORDS[w] : MUD_WORDS[m];
    return `<div${m >= 2 ? ' class="warn"' : ''}><span>Boden</span><b>${esc(text)}</b></div>`;
  }
  function placeShield() {
    const g = selectedId ? getGroup(state, selectedId) : null;
    if (g && shield.visible) shield.move(shieldAnchor(g));
  }

  // ---------- Auswahl und Werkzeuge ----------
  function sightLabel(sl) {
    const label = !sl.visible ? (sl.blockedAt ? 'Sicht verdeckt' : `zu weit (Sicht ${sl.range})`)
      : sl.d > sl.hidden ? `${plural(sl.d, 'Feld', 'Felder')} · frei, Deckung erst ab ${sl.hidden}` : `${plural(sl.d, 'Feld', 'Felder')} · frei`;
    return { ...sl, blockedAt: sl.blockedAt, label };
  }
  function select(id, { center = false } = {}) {
    if (tool) cancelTool(false);
    hoverSight = null;
    radial.hide();
    selectedId = id;
    const g = id ? getGroup(state, id) : null;
    if (g && center) {
      centerOn(cam, g.pos.x + 0.5, g.pos.y + 0.5 - (narrow() ? 2 : 0), Math.max(cam.zoom, narrow() ? 24 : 18));
      onCamera();
    }
    if (g) playSfx('paper', { intensity: 0.25 });
    refresh();
  }

  function startTool(def, g, extra = {}) {
    if (!def) return;
    if (book[side]?.sealed || modalOpen) return;
    const u = usable(def, g, state, env);
    if (!u.ok) { flash(u.why, 'warn'); return; }
    cancelTool(false);
    radial.hide();
    lehrling.close();
    helpShown = true;
    if (g) selectedId = g.id;
    tool = { def, group: g, pick: null, preview: null, hoverCell: null, pickHint: '' };
    const t = tool;
    def.begin({
      group: g, state, map: liveMap, side, cam,
      setOrder: (o) => placeOrder(o),
      pickCell: (req) => { if (tool !== t) return; t.pick = req; t.armed = null; t.pickHint = req.hint; refresh(); },
      hint: (text) => flash(text, 'warn'),
      cancel: () => { if (tool === t) cancelTool(); },
      ui,
      plans: () => sidePlans[side],
      setSidePlan: (o) => { sidePlans[side] = { ...sidePlans[side], [o.type]: o }; helpShown = true; playSfx('lore'); refresh(); },
      setModal: (on) => { modalOpen = on; if (!on) { plannerWindow = null; dynCv.focus({ preventScroll: true }); } refresh(); },
      onWindow: (w) => { plannerWindow = w; },
      // Fuer Zeichenwerkzeuge (P04): Aufraeumen beim Abbrechen, Neuzeichnen, Demo-Zugriff
      onCancel: (fn) => { t.cleanup = fn; },
      redraw: (camera = false) => { if (camera) onCamera(); else drawDyn(); },
      expose: (a) => { t.api = a; },
      // Fuer Editoren auf der Karte (Feuerplan, P09)
      root, cam,
      setDecor: (fn) => { decor = fn; drawDyn(); },
      onEnd: (fn) => { t.onEnd = fn; },
      marks: () => Object.fromEntries(groupsOf(state, side).map((x) => [x.id, groupMark(state, x)])),
      blueprint: (on, base) => {
        if (on) { const b = baseTheme(); applyTheme(blueprintTheme(b)); playSfx('paper', { intensity: 0.6 }); return b; }
        applyTheme(base && !base.blueprint ? base : themeAt(darkness));
        return null;
      },
      ...extra,
    });
    refresh();
  }

  function cancelTool(doRefresh = true) {
    const t = tool;
    tool = null;
    if (t?.cleanup) try { t.cleanup(); } catch (err) { console.error(err); }
    if (t?.onEnd) try { t.onEnd(); } catch (err) { console.error(err); }
    if (doRefresh) refresh();
  }

  function placeOrder(o) {
    const before = book;
    book = setOrder(book, side, o);
    if (book === before) return;
    helpShown = true;
    if (o.path?.length) {
      // Ueberraschung: der Bleistift zeichnet den Pfeil sichtbar nach, mit Kratzen
      playSfx('pencil', { count: Math.min(6, 1 + Math.floor(o.path.length / 3)) });
      if (!reducedMotion()) {
        const dur = Math.max(380, Math.min(1100, o.path.length * 70));
        let t0 = 0;
        anim = { group: o.group, progress: 0 };
        const step = (ts) => {
          if (!anim || anim.group !== o.group || anim.frozen) return;
          if (!t0) t0 = ts;
          anim.progress = Math.min(1, (ts - t0) / dur);
          drawDynNow();
          if (anim.progress < 1) requestAnimationFrame(step); else { anim = null; drawDyn(); }
        };
        requestAnimationFrame(step);
      }
    } else {
      playSfx('pencil', { count: 1, intensity: 0.5 });
    }
    refresh();
  }

  function doUndo() {
    if (tool) { cancelTool(); return; }
    // P25 Koop: nur eigene Eintraege zuruecknehmen, nie die des anderen Kommandos
    const lastG = book[side]?.history?.at(-1)?.group;
    const lastOwner = lastG ? getGroup(state, lastG) : null;
    if (koop && lastOwner && !koop.owns(lastOwner)) { flash(`Der letzte Eintrag stammt von ${koop.ownerName(lastOwner)}. Den nimmst du nicht zurück.`); return; }
    const r = undo(book, side);
    if (!r.group) { flash('Nichts zurückzunehmen.'); return; }
    book = r.book;
    anim = null;
    selectedId = r.group;
    playSfx('paper', { intensity: 0.4 });
    refresh();
  }

  function nextIdle() {
    const idle = groupsOf(state, side).filter((g) => !orderOf(book, side, g.id) && g.status !== 'rest' && (!koop || koop.owns(g)));
    if (!idle.length) { flash('Alle Gruppen haben einen Befehl. Enter führt die Runde aus.'); return; }
    const i = idle.findIndex((g) => g.id === selectedId);
    select(idle[(i + 1) % idle.length].id, { center: true });
  }

  function toggleOverlay(slot) {
    const o = overlaySlots().find((x) => x.slot === slot);
    if (!o) return;
    if (o.empty) { flash(`Overlay ${o.label}: in Arbeit.`); return; }
    if (overlaysOn.has(slot)) overlaysOn.delete(slot); else overlaysOn.add(slot);
    refresh();
  }

  function toggleList() { if (orderList.open) closeList(); else openList(); }
  function openList() {
    report.hide();
    lehrling.close();
    if (archiveView.open) closeArchive(false);
    updateList();
    orderList.show();
    root.classList.add('list-open');
    playSfx('paper', { intensity: 0.3 });
  }
  function closeList() {
    orderList.hide();
    root.classList.remove('list-open');
    dynCv.focus({ preventScroll: true });
  }

  // ---------- Runde ausfuehren ----------
  function openSummary(preset = 0) {
    if (modalOpen) return;
    if (state.result) { flash(state.result.reason); return; }
    if (rules.ended) { rules.show(); return; }
    cancelTool(false);
    radial.hide();
    const orders = ordersNow();
    const s = summarize({ state, side, orders, map, plans: sidePlans[side], only: koop ? koop.owns : null });
    modalOpen = true;
    refresh();
    showSummary(ui, s, {
      title: `${roundTitle(state)} · Zusammenfassung`,
      sub: mode === 'hotseat' ? faction(state.sides[side].faction).name : koop ? `${koop.title()}: was du einzeichnest` : 'Was du gleich abschickst',
      preset, action: koop ? koop.button() : undefined,
      onCancel: () => { modalOpen = false; refresh(); dynCv.focus({ preventScroll: true }); },
      onCommit: () => { modalOpen = false; commitSide(); },
    });
  }

  function commitSide() {
    // P25 Koop: Nord gibt an Sued weiter (mit Zettel), erst Sued fuehrt die Runde aus
    if (koop && !koop.last()) {
      selectedId = null; closeList(); modalOpen = true; refresh();
      koop.handover(ui, state.turn, (went) => {
        modalOpen = false;
        if (went) { homeView(); onCamera(); const n = koop.takeNote(); if (n) flash(`Zettel von Nord: ${n}`); }
        refresh(); dynCv.focus({ preventScroll: true });
      });
      return;
    }
    // Sturm: nach dem Halten des Rings geht die Pfeife
    const storm = listOrders(book, side).some((o) => HOLD_TYPES.has(o.type));
    book = seal(book, side);
    playSfx('stamp');
    if (storm) playSfx('whistle', { delay: 0.45 });
    selectedId = null;
    hoverSight = null;
    closeList();
    report.hide();
    overlaysOn = new Set();
    transient = null;
    // P20: Online-Gefecht: Befehle gehen an den Stab, gerechnet wird dort
    if (matchLink) {
      matchLink.submit([...listOrders(book, side), ...Object.keys(sidePlans[side]).sort().map((k) => sidePlans[side][k])]);
      return;
    }
    const waiting = humans.find((s) => !book[s].sealed);
    if (waiting) {
      modalOpen = true;
      refresh();
      showHandover(ui, {
        title: 'Befehle versiegelt',
        text: `Die Befehle von ${faction(state.sides[side].faction).name} sind verschlossen. Gib das Gerät an ${faction(state.sides[waiting].faction).name} weiter.`,
        button: `Weiter als ${faction(state.sides[waiting].faction).short}`,
        to: faction(state.sides[waiting].faction).name, from: faction(state.sides[side].faction).name, note: state.turn,
        onGo: () => {
          modalOpen = false; side = waiting; updateLiveMap(); homeView(); onCamera();
          if (reportDue.has(side)) showReport();
          refresh(); dynCv.focus({ preventScroll: true });
        },
      });
      return;
    }
    resolveNow();
  }

  // Nach der Runde: Phasenfilm mit Telegramm fuer die planende Seite, jede Seite sieht nur ihr eigenes (Hotseat)
  let reportDue = new Set();
  const filmTitle = (st) => roundTitle(st);
  function showReport() {
    reportDue.delete(side);
    if (!lastRound) return;
    const tr = pendingDark;
    pendingDark = null;
    startFilm(lastRound.input, lastRound.result, { title: filmTitle(lastRound.input.state), transition: tr });
  }

  function startFilm(input, result, { title, transition = null, replay = false, start = 0, paused = false }) {
    const film = planFilm(input, result, side);
    cancelTool(false);
    radial.hide();
    closeList();
    archiveView.hide();
    selectedId = null;
    modalOpen = true;
    root.classList.add('filming');
    report.show({ title: `Telegramm · ${title}`, sub: `${film.lines.length} ${film.lines.length === 1 ? 'Zeile' : 'Zeilen'}`, lines: film.lines });
    report.setFilmActive(true);
    filmReplay = replay;
    player.play(film, input, result, side, { title, transition, start, paused });
    refresh();
  }

  let filmReplay = false;
  function endFilm() {
    filmFrame = null;
    feelImpacts(state);
    modalOpen = false;
    root.classList.remove('filming');
    report.setFilmActive(false);
    // Grundton der Front nach der Runde: Tageszeit, Wetter, wie heftig es war
    // (nur was die eigene Seite mitbekommt: fremde, ungesehene Gefechte verraten sich nicht im Klang)
    frontAmbience({ state, darkness, log: viewFor(state, lastLog, side, env).log, side });
    if (state.result && !filmReplay) flash(state.result.reason);
    else if (!filmReplay) {
      // Ende des Gefechts: die eigene Begruendung als Hinweis
      const end = lastLog.find((e) => e.type === 'battle_end' && e.side === side);
      if (end) flash(end.reason, end.outcome === 'taken' || end.outcome === 'defended' ? '' : 'warn');
      if (pendingNote) { showNote(pendingNote); pendingNote = null; }
    }
    refresh();
    if (clockSnapDue && !filmReplay) snapClock();
    drawDynNow();
    dynCv.focus({ preventScroll: true });
    // P14: im Einsatz aus der Kampagne meldet der Kampagnendialog das Ende (sonst die Abschlussmeldung von P17)
    if (!filmReplay) missionUi?.afterFilm(state, lastLog);
    if (!filmReplay && !campaignRun?.afterFilm(ui)) rules.afterFilm();
  }

  function openArchive() {
    if (player.open) return;
    if (archiveView.open) { closeArchive(); return; }
    const rounds = archive.rounds.map((e) => {
      const key = e.turn + side;
      if (!archiveLines.has(key)) {
        const input = inputOf(e, env);
        archiveLines.set(key, planFilm(input, replayTo(input, phasesFor(e.kind, env.phases).length), side).lines);
      }
      const film = { lines: archiveLines.get(key) };
      return {
        entry: e, title: entryTitle(e), short: `R${e.turn}`,
        sub: `${clockText(e.clock)} bis ${clockText(e.endClock)} Uhr · ${film.lines.length} Zeilen`, lines: film.lines,
      };
    });
    cancelTool(false);
    closeList();
    report.hide();
    modalOpen = true;
    archiveView.show(rounds);
    playSfx('paper', { intensity: 0.5 });
    refresh();
  }

  const archiveLines = new Map(); // Telegrammzeilen alter Runden je Seite, einmal gerechnet
  function closeArchive(focusMap = true) {
    archiveView.hide();
    modalOpen = false;
    refresh();
    if (focusMap) dynCv.focus({ preventScroll: true });
  }

  function resolveNow() {
    const withPlans = (s, list) => [...list, ...Object.keys(sidePlans[s]).sort().map((k) => sidePlans[s][k])];
    const ordersA = withPlans('a', listOrders(book, 'a'));
    let ordersB;
    if (humans.includes('b')) ordersB = withPlans('b', listOrders(book, 'b'));
    else if (battle.ordersB) {
      // P25: Drehbuch der Puzzle-Lage oder eine Gegenseite, die nur haelt; Restbefehle (Sturm) laufen weiter
      const fresh = battle.ordersB(state);
      const have = new Set(fresh.map((o) => o.group));
      ordersB = [...fresh, ...listOrders(book, 'b').filter((o) => o.carried && !have.has(o.group))];
    } else {
      const d = aiNext?.turn === state.turn ? aiNext.decision : decide(viewFor(state, lastLog, 'b', env), { map, seed, ...aiCfg, ...missionAi(state), memory: aiMemory });
      aiMemory = d.memory;
      const fresh = new Set(d.orders.map((o) => o.group).filter(Boolean));
      ordersB = withMissionOrders([...d.orders, ...listOrders(book, 'b').filter((o) => o.carried && !fresh.has(o.group))], state);
    }
    const input = { state, ordersA, ordersB, seed, turn: state.turn, env };
    const r = resolveTurn(state, ordersA, ordersB, seed, state.turn, env);
    const before = state;
    state = r.state;
    rules.afterResolve(before, state, r.log);
    if (before.turnKind !== state.turnKind) clockSnapDue = true;
    hoverSight = null;
    lastLog = r.log;
    lastRound = { input, result: r };
    // P13: Lasks naechsten Zug schon jetzt rechnen; manchmal faellt dabei eine Notiz in die eigenen Haende
    aiNext = null;
    if (!humans.includes('b') && !battle.ordersB && !state.result) {
      const lv = viewFor(state, lastLog, 'b', env);
      const d = decide(lv, { map, seed, ...aiCfg, ...missionAi(state), memory: aiMemory });
      aiNext = { turn: state.turn, decision: d };
      pendingNote = maybeIntercept({ decision: d, laskView: lv, playerView: viewFor(state, lastLog, 'a', env), seed, difficulty: d.difficulty });
    }
    lehrling.afterRound(humans);
    archive = archiveRound(archive, input, r);
    campaignRun?.afterRound(state, archive);
    // Unvollendete Wege laufen als Befehl weiter, solange die Rundenart passt (P20: rein in js/online/replay.js)
    const carry = carryOrders(state, r.log);
    book = nextRound(book, carry);
    gameMenu.autosave(); // nach dem Weitertragen, damit laufende Wege und Graben mit in die Akte kommen
    sidePlans = { a: {}, b: {} }; // der Lorenplan steht danach im Zustand und gilt weiter
    side = humans[0];
    koop?.reset();
    updateLiveMap();
    playSfx('clock-lock');
    // Der Tag-Nacht-Uebergang laeuft in der letzten Sekunde des Films (Plan 7.7)
    const target = forcedDark ?? darknessAt(state.clock, state.turnKind, state.night);
    pendingDark = target !== darkness ? { from: darkness, to: target } : null;
    reportDue = new Set(humans);
    if (humans.length > 1) {
      modalOpen = true;
      refresh();
      showHandover(ui, {
        title: `Runde ${before.turn} ausgeführt`,
        text: `Das Telegramm liegt bereit. ${faction(state.sides[side].faction).name} sieht zuerst den Film der Runde.`,
        button: `Weiter als ${faction(state.sides[side].faction).short}`,
        to: faction(state.sides[side].faction).name, from: 'Fernschreibstelle', note: state.turn,
        onGo: () => { modalOpen = false; homeView(); onCamera(); showReport(); refresh(); },
      });
    } else {
      showReport();
    }
  }

  // ---------- Radiales Menue ----------
  function openRadial(g, clientX, clientY) {
    if (!g || g.side !== side || modalOpen || book[side]?.sealed || root.classList.contains('fp-open') || (koop && !koop.owns(g))) return false;
    cancelTool(false);
    selectedId = g.id;
    const r = root.getBoundingClientRect();
    const items = shownTools(state).map((t) => ({ id: t.id, def: t, label: t.label, icon: t.icon, group: g.id, ...usable(t, g, state, env) }));
    if (orderOf(book, side, g.id)) {
      items.push({ id: '__clear', label: 'Löschen', icon: '<path d="M6 6 L18 18"/><path d="M18 6 L6 18"/>', group: g.id, ok: true, why: '' });
    }
    radial.show(items, clientX - r.left, clientY - r.top, groupMark(state, g));
    playSfx('paper', { intensity: 0.35 });
    refresh();
    return true;
  }

  // ---------- Eingabe auf der Karte ----------
  function cellFromScreen(p) {
    const w = screenToWorld(cam, p.x, p.y);
    return { w, cell: cellAt(map, Math.floor(w.x), Math.floor(w.y)) };
  }
  function groupAtScreen(p) {
    const { w } = cellFromScreen(p);
    const { groups } = shownGroups();
    // eigene Gruppen zuerst, dann die kleinste Entfernung
    const hits = groups.filter((g) => g.status !== 'lost' && hitUnit(cam, g, w.x, w.y));
    hits.sort((a, b) => (a.side === side ? 0 : 1) - (b.side === side ? 0 : 1)
      || Math.abs(a.pos.x + 0.5 - w.x) + Math.abs(a.pos.y + 0.5 - w.y) - Math.abs(b.pos.x + 0.5 - w.x) - Math.abs(b.pos.y + 0.5 - w.y));
    return hits[0] ? getGroup(state, hits[0].id) : null;
  }

  function onCamera() {
    layer.invalidate();
    weather.invalidate();
    drawDyn();
  }

  // Pfeiltasten und +/- nur, wenn kein Dialog offen ist
  const keyTarget = {
    addEventListener: (t, fn) => window.addEventListener(t, (e) => { if (!modalOpen) fn(e); }),
    removeEventListener: () => {},
  };
  attachCameraControls(dynCv, cam, {
    keyTarget,
    onChange: onCamera,
    onHover: (p) => {
      if (!tool?.pick) {
        const g = selectedOwn();
        const cell = p && g && !modalOpen ? cellFromScreen(p).cell : null;
        const next = cell && (cell.x !== g.pos.x || cell.y !== g.pos.y) ? sightLabel(sightLine(map, g, cell, darknessOf(state), state)) : null;
        const k = (s) => (s ? `${s.to.x},${s.to.y},${s.from.x},${s.from.y}` : '');
        if (k(next) !== k(hoverSight)) { hoverSight = next; drawDyn(); }
        return;
      }
      const cell = p ? cellFromScreen(p).cell : null;
      if (cell === tool.hoverCell) return;
      tool.hoverCell = cell;
      if (tool.armed && cell !== tool.armed) tool.armed = null; // Maus nach Finger (Tablet mit Maus): Vormerkung verfaellt
      tool.preview = cell ? tool.pick.preview(cell) : null;
      updateShield();
      drawDyn();
    },
    onTap: (p) => {
      if (suppressTap) { suppressTap = false; return; }
      if (modalOpen) return;
      if (radial.open) { radial.hide(); refresh(); return; }
      // Ein Tippen, das nur etwas schliesst, oeffnet nichts Neues (P11: sonst ginge das Etappenfenster auf)
      let closedSomething = hud.popoverOpen;
      hud.closePopover();
      if (root.classList.contains('sheet-open')) { root.classList.remove('sheet-open'); hud.setSheet(false); closedSomething = true; }
      const { cell } = cellFromScreen(p);
      if (tool?.pick) {
        if (!cell) return;
        tool.hoverCell = cell;
        tool.preview = tool.pick.preview(cell);
        // Finger haben kein Hover: das erste Antippen merkt das Ziel mit Bleistift vor und zeigt Weg und Kosten,
        // das zweite auf dasselbe Feld setzt den Befehl (Dienstbuch: "Ziel antippen")
        if (p.touch && tool.preview && (tool.preview.ok ?? !!tool.preview.path) && tool.pick.confirm !== false && getSetting('tap') === 'confirm' && tool.armed !== cell) {
          tool.armed = cell;
          playSfx('pencil', { count: 1, intensity: 0.2 });
          refresh();
          return;
        }
        tool.armed = null;
        const t = tool;
        if (t.pick.pick(cell)) { if (tool === t) cancelTool(); }
        else refresh();
        return;
      }
      const g = groupAtScreen(p);
      if (g) {
        select(g.id);
        if (koop && g.side === side && !koop.owns(g)) flash(`Gehört zu ${koop.ownerName(g)}. Pfeile sehen, aber nicht ändern.`);
      }
      else if (selectedId) select(null);
      else if (cell && !closedSomething && state.turnKind === 'position' && !book[side]?.sealed) {
        // P11: Antippen eines Gebaeudes oder vorgemerkten Baus der eigenen Etappe (ohne gewaehlte Gruppe)
        // oeffnet das Etappenfenster auf diesem Feld
        const et = etappeOf(state, side);
        const plot = plotAt(et, cell.x, cell.y);
        const hit = plot && ([...et.buildings, ...(sidePlans[side].etappe?.builds ?? [])]
          .some((b) => b.x === plot.x && b.y === plot.y && b.type !== 'gleis'));
        if (hit) startTool(allTools().find((t) => t.id === 'etappe'), null, { focus: plot });
      }
    },
  });

  // Langer Druck (Touch und Maus) und Rechtsklick oeffnen das radiale Menue
  let press = null;
  const down = new Set();
  const forget = (e) => { down.delete(e.pointerId); };
  dynCv.addEventListener('pointerup', forget);
  dynCv.addEventListener('pointercancel', forget);
  dynCv.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted) return;
    down.add(e.pointerId);
    suppressTap = false; // falls ein frueheres Loslassen nie ankam
    if (press) { clearTimeout(press.timer); press = null; return; } // zweiter Finger: Pinch
    if (modalOpen || down.size > 1) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const r = root.getBoundingClientRect();
    const p = { x: e.clientX - r.left, y: e.clientY - r.top };
    const g = groupAtScreen(p);
    if (!g || g.side !== side) return;
    press = {
      id: e.pointerId, x: e.clientX, y: e.clientY, g, open: false,
      timer: setTimeout(() => {
        if (!press) return;
        if (openRadial(press.g, press.x, press.y)) {
          press.open = true;
          suppressTap = true;
          if (navigator.vibrate) try { navigator.vibrate(12); } catch { /* egal */ }
          // Kamera loslassen, damit das Weiterziehen den Befehl waehlt statt die Karte zu schieben
          dynCv.dispatchEvent(new PointerEvent('pointercancel', { pointerId: press.id, bubbles: false }));
        }
      }, LONG_PRESS_MS),
    };
  });
  dynCv.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (press.open) { radial.hover(e.clientX, e.clientY); return; }
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 5) { clearTimeout(press.timer); press = null; }
  });
  const pressEnd = (e) => {
    if (!press || e.pointerId !== press.id || !e.isTrusted) return;
    clearTimeout(press.timer);
    if (press.open) {
      const it = radial.itemAt(e.clientX, e.clientY);
      if (it && it.ok && Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 20) {
        radial.hide();
        if (it.id === '__clear') { book = clearOrder(book, side, it.group); refresh(); } else startTool(it.def, getGroup(state, it.group));
      }
      // Kamera hat den Finger schon losgelassen und meldet kein Antippen mehr
      suppressTap = false;
    }
    press = null;
  };
  dynCv.addEventListener('pointerup', pressEnd);
  dynCv.addEventListener('pointercancel', pressEnd);
  dynCv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (press?.open) return;
    const r = root.getBoundingClientRect();
    const g = groupAtScreen({ x: e.clientX - r.left, y: e.clientY - r.top });
    if (g) openRadial(g, e.clientX, e.clientY);
  });

  // ---------- Tastatur (Plan 7.6) ----------
  window.addEventListener('keydown', (e) => {
    if (modalOpen || e.defaultPrevented) return;
    const t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const onMap = t === document.body || t === dynCv || t === document.documentElement;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
      e.preventDefault();
      doUndo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (radial.open) { radial.hide(); refresh(); dynCv.focus({ preventScroll: true }); }
      else if (tool) cancelTool();
      else if (laskNote.open) { laskNote.hide(); playSfx('paper', { intensity: 0.3 }); dynCv.focus({ preventScroll: true }); }
      else if (lehrling.open) lehrling.close();
      else if (hud.popoverOpen) hud.closePopover();
      else if (orderList.open) closeList();
      else if (root.classList.contains('sheet-open')) { root.classList.remove('sheet-open'); hud.setSheet(false); }
      else if (report.open) report.hide();
      else if (selectedId) select(null);
      return;
    }
    // Feuerplan-Editor offen: keine Werkzeugtasten, sonst gingen die ungespeicherten Plaene verloren
    if (root.classList.contains('fp-open')) return;
    if (e.key === 'Tab' && !e.shiftKey && (onMap || orderList.el.contains(t))) {
      // Tab auf der Karte oeffnet die Befehlsliste; in der Liste wird normal weitergesprungen
      if (onMap) { e.preventDefault(); toggleList(); }
      return;
    }
    // Ab hier nur, wenn kein Knopf den Tastendruck selbst braucht
    const onButton = t && t.tagName === 'BUTTON';
    if ((e.key === ' ' || e.key === 'Enter') && e.repeat) { e.preventDefault(); return; }
    if (e.key === ' ' && !onButton) { e.preventDefault(); if (!tool) nextIdle(); return; }
    if (e.key === 'Enter' && !onButton) { e.preventDefault(); openSummary(); return; }
    if (/^[1-4]$/.test(e.key)) { toggleOverlay(Number(e.key)); return; }
    if ((e.key === 'p' || e.key === 'P') && !toolByKey(e.key)) { e.preventDefault(); openArchive(); return; }
    if ((e.key === 't' || e.key === 'T') && !toolByKey(e.key)) { e.preventDefault(); lehrling.toggle(); return; }
    if ((e.key === 'o' || e.key === 'O') && !toolByKey(e.key)) { e.preventDefault(); gameMenu.open(); return; }
    if (e.key.length === 1) {
      const def = toolByKey(e.key);
      if (!def) return;
      e.preventDefault();
      const g = selectedOwn();
      if (!g && def.needsGroup !== false) { flash(`${def.label}: erst eine Gruppe wählen (Leertaste).`, 'warn'); return; }
      startTool(def, g);
    }
  });

  // Zielwahl per Tastatur: Pfeile verschieben die Karte, Enter waehlt das Feld in der Bildmitte
  dynCv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tool?.pick && !modalOpen) {
      e.preventDefault();
      e.stopPropagation();
      const cell = cellAt(map, Math.floor(cam.x), Math.floor(cam.y));
      if (cell) { const t = tool; t.armed = null; if (t.pick.pick(cell)) { if (tool === t) cancelTool(); } else refresh(); }
    }
  });

  // ---------- Groesse und Thema ----------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth, h = root.clientHeight;
    resizeCamera(cam, w, h);
    layer.resize(w, h, dpr);
    weather.resize(w, h, dpr);
    dynCv.width = Math.round(w * dpr);
    dynCv.height = Math.round(h * dpr);
    dynCv.style.width = w + 'px';
    dynCv.style.height = h + 'px';
    drawDynNow();
  }
  onThemeChange((th) => { darkness = th.darkness; layer.invalidate(); weather.invalidate(); drawDyn(); });
  new ResizeObserver(resize).observe(root);
  audio.init?.();
  // Grundton der Front und karge Musik; beides wartet still auf das erste Tippen
  frontAmbience({ state, darkness, side });
  audio.startMusic();
  resize();
  refresh();
  layer.drawNow();
  drawDynNow();
  dynCv.focus({ preventScroll: true });
  // Geladener Slot wird zur laufenden Akte; ohne slot= in der Adresse nimmt ein Neuladen diese Akte wieder auf
  // Neues Gefecht: gleich als laufende Akte ablegen, damit ein Neuladen nie eine fremde alte Akte aufnimmt
  if (!resumed || !resumed.reload) {
    gameMenu.autosave();
  }
  if (resumed && !resumed.reload) {
    const u = new URL(location.href);
    u.searchParams.delete('slot');
    history.replaceState(history.state, '', u);
  }
  if (online?.broken && online.kind === 'match') blockMatch(ui, brokenText(online), () => { cancelTool(false); modalOpen = true; refresh(); });
  else if (online?.broken) flash(brokenText(online), 'warn');
  else if (online?.kind === 'replay') {
    flash(`Wiedergabe: ${online.rounds} Runden nachgerechnet. Das Protokoll (P) zeigt jede Runde als Film.`);
    if (!params.has('demo')) setTimeout(() => { if (!modalOpen) openArchive(); }, 600);
  } else if (matchLink?.finished) matchLink.showEnd();
  else if (matchLink?.waiting) matchLink.wait();
  else if (online?.kind === 'match') {
    flash(`Zweikampf, ${roundTitle(state)}: deine Befehle.`);
    // Telegramm der letzten Runde aus der eigenen Sicht (ein Film geht nicht: der volle Zustand bleibt beim Stab)
    const tl = telegramLines(online.log);
    if (tl.length) { report.show({ title: `Telegramm · vor ${roundTitle(state)}`, sub: `${tl.length} ${tl.length === 1 ? 'Zeile' : 'Zeilen'}`, lines: tl, actions: false }); report.setCount(tl.length, false); }
  }
  else if (resumed) flash(resumed.reload ? `Akte wieder aufgenommen: ${roundTitle(state)}.` : `Spielstand geladen: ${roundTitle(state)}.`);

  // ---------- Demo-Zustaende fuer Screenshots und Tests ----------
  const api = {
    get state() { return state; }, get book() { return book; }, map, cam,
    select: (id) => select(id, { center: false }),
    order: (o) => placeOrder(o),
    get toolInfo() { return tool ? { id: tool.def.id, armed: tool.armed ?? null, preview: tool.preview, hover: tool.hoverCell, group: tool.group?.id ?? null } : null; },
    tool: (id, extra) => startTool(allTools().find((t) => t.id === id), selectedOwn(), extra),
    hover: (x, y) => { if (tool?.pick) { tool.hoverCell = cellAt(map, x, y); tool.preview = tool.pick.preview(tool.hoverCell); refresh(); } },
    radial: (id) => { const g = getGroup(state, id); const p = worldToScreen(cam, g.pos.x + 0.5, g.pos.y + 0.5); const r = root.getBoundingClientRect(); openRadial(g, p.x + r.left, p.y + r.top); },
    summary: (preset) => openSummary(preset),
    list: () => openList(),
    overlay: (slot) => toggleOverlay(slot),
    commit: () => commitSide(),
    get player() { return player; },
    get side() { return side; },
    archive: () => openArchive(),
    finishAnim: () => { anim = null; drawDynNow(); },
    get plans() { return sidePlans; },
    get plannerWindow() { return plannerWindow; },
  };
  window.__gefecht = api;
  const demo = params.get('demo');
  if (demo) {
    const own = groupsOf(state, side);
    const pathTo = (g, x, y) => planMove(map, state, g, { x, y })?.path;
    const plan = () => {
      api.order({ group: own[0].id, type: state.turnKind === 'battle' ? 'move' : 'redeploy', path: pathTo(own[0], 24, 9) });
      api.order({ group: own[2].id, type: 'hold' });
      anim = null;
    };
    if (demo === 'befehle') { plan(); api.select(own[1].id); api.tool('move'); api.hover(28, 19); }
    else if (demo === 'liste') { plan(); api.list(); }
    else if (demo === 'radial') { api.radial(own[1].id); }
    else if (demo === 'zusammenfassung') { plan(); api.summary(); }
    else if (demo === 'sturm') {
      state.turnKind = 'battle'; state.battle = { round: 1 };
      book = setOrder(book, side, { group: own[0].id, type: 'assault', path: [{ x: own[0].pos.x + 1, y: own[0].pos.y }] });
      api.summary(0.62);
    } else if (demo === 'film' || demo === 'telegramm' || demo === 'bericht' || demo === 'archiv') {
      // P07: Film mitten in der Bewegung angehalten, Telegramm nach dem Film, Protokoll nach zwei Runden
      plan();
      commitSide();
      if (demo === 'archiv') {
        player.seek(1e9); player.next();
        book = setOrder(book, side, { group: own[1].id, type: 'redeploy', path: pathTo(own[1], 22, 24) });
        commitSide();
        player.seek(1e9); player.next();
        report.finishTyping();
        openArchive();
      } else if (!lastRound) {
        // Hotseat: die Runde ist erst nach beiden Seiten aufgeloest
      } else if (demo === 'film') {
        const fl = planFilm(lastRound.input, lastRound.result, side);
        const mv = fl.sections.find((x) => x.key === 'movement');
        player.seek(mv.start + mv.dur * 0.45);
      } else {
        player.seek(1e9); player.next();
        report.finishTyping();
        if (humans.length === 1) api.select(own[0].id);
      }
    } else if (demo === 'uebergabe') { plan(); commitSide(); }
    else if (demo === 'ende') {
      // P17: Abschlussmeldung nach der letzten Stellungsrunde (Tageslage: 14)
      const foe = groupsOf(state, otherSide(side));
      foe[0].strength = Math.max(1, foe[0].strength - 4);
      rules.forceEnd(state, { positionRounds: modeInfo.limit || 12, battles: 2, losses: { a: 6, b: 9 }, wounded: { a: 3, b: 4 }, returned: { a: 2, b: 0 } });
    }
    else if (demo === 'zeichnen') {
      api.select(own[1].id);
      placeOrder({ group: own[1].id, type: 'redeploy', path: pathTo(own[1], 25, 21) });
      anim = { group: own[1].id, progress: 0.55, frozen: true };
    } else if (demo === 'overlays') { api.overlay(3); api.overlay(4); }
    else if (demo === 'feuer' || demo === 'sektor' || demo === 'feuerrunde') {
      // P05: Gefechtsrunde, die 1. Gruppe ist ins Niemandsland vorgegangen
      state.turnKind = 'battle'; state.battle = { round: 1 };
      own[0].pos = { x: 40, y: 10 };
      if (demo === 'feuer') { api.select(own[0].id); api.tool('fire'); api.hover(45, 9); }
      else if (demo === 'sektor') { api.select(own[1].id); api.tool('fire'); api.hover(41, 14); }
      else {
        placeOrder({ group: own[0].id, type: 'fire', target: { x: 45, y: 9 } });
        placeOrder({ group: own[1].id, type: 'sector', target: { x: 42, y: 14 } });
        anim = null;
        commitSide();
      }
    } else if (demo === 'bedrohung') { api.overlay(2); }
    else if (demo === 'lehrling' || demo === 'lehrling-nimm') {
      // P13: Taktik-Lehrling; "-nimm" uebernimmt den ersten Vorschlag
      lehrling.toggle();
      if (demo === 'lehrling-nimm') ui.querySelector('.lr-take')?.click();
    } else if (demo === 'notiz') {
      // P13: abgefangene Notiz aus Lasks echtem naechsten Zug (hier ohne Wurf erzwungen)
      const lv = viewFor(state, [], 'b', env);
      const d = decide(lv, { map, seed, ...aiCfg, posture: params.get('lage') || undefined });
      const note = noteFromDecision(d, lv, { seed, difficulty: d.difficulty });
      showNote({ ...note, found: 'von einem Beobachter aus dem Niemandsland geholt' });
    }
    else if (demo === 'sichtlinie') { api.select(own[0].id); hoverSight = sightLabel(sightLine(map, own[0], { x: 41, y: 12 }, darknessOf(state))); }
    else if (demo === 'lorenplan' || demo === 'versorgung') {
      // Lage fuer Screenshots: Verwundete in B und C, Abschnitt A durch verschuettete Graeben abgeschnitten
      state = structuredClone(state);
      addWounded(state, map, 'a', own[1].pos, 3, own[1].id);
      addWounded(state, map, 'a', own[2].pos, 1, own[2].id);
      for (const k of ['27,12', '27,13', '28,13', '26,12', '32,13', '33,14', '32,14', '33,13']) state.cells[k] = { ...(state.cells[k] ?? {}), trenchBlocked: true };
      if (demo === 'lorenplan') api.tool('supply');
      else { api.overlay(1); centerOn(cam, 20, 15, Math.max(cam.zoom, narrow() ? 20 : 26)); onCamera(); }
    }
    else if (demo === 'abloesung' || demo === 'abloesung-liste' || demo === 'ruhelager') {
      // P12: eine Gruppe zu lange vorn, eine ruht im Ruhelager, einem Trupp ist der Gruppenfuehrer gefallen
      state = structuredClone(state);
      const g = (i) => getGroup(state, own[i].id);
      Object.assign(g(0), { frontTurns: 7, fatigue: 78, morale: 46 });
      Object.assign(g(1), { frontTurns: 4, fatigue: 40 });
      const rest = freeRestCell(map, state, side, { x: 12, y: 12 });
      if (rest) Object.assign(g(4), { pos: { ...rest.cell }, restAt: { ...rest.cell }, status: 'rest', fatigue: 30, frontTurns: 0 });
      Object.assign(g(3), { leaderFell: { name: g(3).leader.name, home: g(3).leader.home, turns: 2 }, leader: { name: 'Jost Wendler', home: g(3).leader.home }, morale: 41 });
      Object.assign(g(2), { greenTurns: 2, strength: g(2).size, experience: 0 });
      if (demo === 'abloesung') {
        api.select(own[0].id);
        api.tool('relieve');
        api.hover(g(4).pos.x, g(4).pos.y);
      } else if (demo === 'abloesung-liste') {
        api.order({ group: own[2].id, type: 'hold' });
        api.list();
      } else {
        // Ruhelager: die Melder sind unterbesetzt, Auffuellen mit gruenem Ersatz senkt die Erfahrung
        Object.assign(g(4), { strength: Math.max(1, g(4).size - 2), experience: 2 });
        state.sides[side].replacements = { tenths: 40 };
        centerOn(cam, g(4).pos.x + 4, g(4).pos.y + 2, Math.max(cam.zoom, narrow() ? 22 : 26)); onCamera();
        api.select(own[4].id);
        api.tool('relieve');
        api.hover(g(4).pos.x, g(4).pos.y);
      }
    }
    else if (demo === 'graben' || demo === 'traversen' || demo === 'grabenplan') {
      // P04: Pioniere ziehen einen geraden Graben zwischen den Linien, Warnung Laengsfeuer
      const pi = own[2];
      api.select(pi.id);
      centerOn(cam, narrow() ? 29.5 : 30, narrow() ? 26 : 28.5, Math.max(cam.zoom, narrow() ? 26 : 30));
      api.tool('dig');
      tool?.api?.draw([{ x: 30.5, y: 24.5 }, { x: 30.5, y: 33.5 }]);
      if (demo !== 'graben') tool?.api?.act('traverse');
      if (demo === 'grabenplan') {
        tool?.api?.act('go');
        anim = null;
        api.order({ group: own[0].id, type: 'redeploy', path: pathTo(own[0], 24, 9) });
        anim = null;
        commitSide();
        api.select(null);
        api.finishAnim();
      }
    } else if (demo === 'umbauen') {
      // P04: eroberter Feindgraben, halbe Deckung, Umbauen zeichnen
      const g = own[0];
      g.pos = { x: 44, y: 7 };
      for (const e of groupsOf(state, otherSide(side))) if (e.pos.x === 45 && e.pos.y <= 12) e.pos = { x: 48, y: e.pos.y };
      for (let y = 4; y <= 12; y++) captureTrench(state, map, 45, y, side);
      updateLiveMap();
      api.select(g.id);
      centerOn(cam, 45, narrow() ? 5 : 8.5, Math.max(cam.zoom, narrow() ? 26 : 30));
      api.tool('rebuild');
      tool?.api?.draw([{ x: 45.5, y: 5.5 }, { x: 45.5, y: 12.5 }]);
    } else if (demo === 'etappe' || demo === 'etappe-plan' || demo === 'etappe-karte' || demo === 'etappe-schaden') {
      // P11: Etappenfenster mit Bauauftrag; Lagekarte nach einer Runde (Kueche zu weit vorn, Rauch verraet sie)
      const builds = [{ type: 'saegewerk', x: 4, y: 2 }, { type: 'gleis', x: 3, y: 5 }, { type: 'verbandsplatz', x: 2, y: 7 }];
      if (demo === 'etappe') api.tool('etappe', { focus: { x: 4, y: 5 } });
      else if (demo === 'etappe-plan') {
        sidePlans[side] = { ...sidePlans[side], etappe: { type: 'etappe', builds, repairs: [], reward: null } };
        centerOn(cam, 11, 15, Math.max(cam.zoom, narrow() ? 18 : 24));
      } else {
        sidePlans[side] = { ...sidePlans[side], etappe: { type: 'etappe', builds, repairs: [], reward: { level: 2, id: 'zweite-gleisstrecke' } } };
        // Eine zweite Feldkueche steht schon weit vorn: am Tag sieht der Gegner ihren Rauch
        state = structuredClone(state);
        state.sides[side].etappe.buildings.push({ id: 'g099', type: 'feldkueche', x: 6, y: 4 });
        if (demo === 'etappe-schaden') state.cells['7,16'] = { ...(state.cells['7,16'] ?? {}), buildingDamaged: true };
        commitSide();
        if (lastRound) { player.seek(1e9); player.next(); report.finishTyping(); report.hide(); }
        if (demo === 'etappe-schaden') {
          sidePlans[side] = {};
          api.tool('etappe', { focus: { x: 2, y: 5 } });
        } else {
          api.select(null);
          centerOn(cam, 11, 15, Math.max(cam.zoom, narrow() ? 18 : 24));
        }
      }
    } else if (demo === 'sturmplan') {
      // P06: Angriff ansetzen in der Stellungsrunde, Vorschau mit Draht und Einbruch
      api.select(own[0].id);
      centerOn(cam, narrow() ? 40 : 39, 9, Math.max(cam.zoom, narrow() ? 22 : 24));
      api.tool('assault');
      api.hover(45, 10);
    } else if (demo === 'draht') {
      api.select(own[0].id);
      centerOn(cam, 35, narrow() ? 7 : 8.5, Math.max(cam.zoom, narrow() ? 26 : 30));
      api.tool('wire');
      tool?.api?.draw([{ x: 34.5, y: 5.5 }, { x: 34.5, y: 11.5 }]);
    } else if (demo === 'umschalten' || demo === 'gefechtsrunde' || demo === 'nahkampf' || demo === 'unterstand') {
      // P06: Angriff ansetzen und ausfuehren; danach Gefechtsrunden mit Stoppuhr
      const a = own[0];
      const foe = groupsOf(state, otherSide(side)).find((g) => g.pos.x === 45 && g.pos.y === 9);
      if (demo !== 'umschalten') { a.pos = { x: 43, y: 9 }; if (demo === 'unterstand' && foe) { foe.suppressed = 0.9; } }
      const p = planAssault(map, state, a, { x: 46, y: 9 });
      placeOrder({ group: a.id, type: state.turnKind === 'battle' ? 'assault' : 'attack', path: p.path });
      anim = null;
      commitSide();
      player.seek(1e9); player.next();
      report.finishTyping();
      if (demo !== 'umschalten') {
        // Zweite Runde: Gefechtsrunde, der Sturm laeuft auf den Graben
        const o = orderOf(book, side, a.id);
        if (demo === 'nahkampf' || demo === 'unterstand') {
          if (!o) placeOrder({ group: a.id, type: 'assault', path: planAssault(map, state, getGroup(state, a.id), { x: 46, y: 9 })?.path ?? [] });
          anim = null;
          commitSide();
          if (demo === 'nahkampf') { player.seek(1e9); player.next(); report.finishTyping(); }
          else { const fl = planFilm(lastRound.input, lastRound.result, side); const sec = fl.sections.find((x) => x.key === 'dugout') ?? fl.sections[0]; player.seek(sec.start + sec.dur * 0.6); }
        }
      }
      centerOn(cam, narrow() ? 44 : 41, 10, 22);
    }
    else if (demo === 'feuerplan' || demo === 'walze' || demo === 'verlegen' || demo === 'einschlag') {
      // P09: Walze vor Abschnitt A, Vorbereitungsfeuer auf den Graben vor Abschnitt B
      const walze = { id: 'w1', kind: 'creep', batteries: ['batterie1', 'batterie2'], a: { x: 38, y: 4 }, b: { x: 38, y: 12 }, dir: 'E', step: 1, rounds: 6, start: 1 };
      const prep = { id: 'v1', kind: 'prep', batteries: ['batterie2'], a: { x: 45, y: 16 }, b: { x: 45, y: 21 }, dir: 'E', rounds: 2, start: 1 };
      if (demo === 'feuerplan') {
        sidePlans.a = { ...sidePlans.a, fire_plan: { type: 'fire_plan', plans: [walze, prep] } };
        centerOn(cam, narrow() ? 38 : 36, narrow() ? 10 : 13, Math.max(fitZoom(cam), narrow() ? 17 : 24));
        onCamera();
        api.tool('fireplan');
      } else {
        state = structuredClone(state);
        state.turnKind = 'battle'; state.battle = { round: 1 };
        state.sides.a.artillery.plans = [walze, prep];
        if (demo === 'einschlag') {
          centerOn(cam, narrow() ? 40 : 36, 12, Math.max(fitZoom(cam), narrow() ? 17 : 20));
          onCamera();
          commitSide();
          if (lastRound) { player.seek(1e9); player.next(); report.finishTyping(); }
        } else {
          for (let i = 0; i < 2; i++) state = resolveTurn(state, [], [], seed, state.turn, env).state;
          lastRound = null;
          if (demo === 'verlegen') state.sides.a.artillery.lines.find((l) => l.to === 'B-Stelle Mitte').cut = { x: 25, y: 16 };
          const obs = groupsOf(state, side).find((g) => g.type === 'observers');
          centerOn(cam, narrow() ? 38 : 36, 10, Math.max(fitZoom(cam), narrow() ? 17 : 24));
          onCamera();
          if (demo === 'verlegen') {
            api.select(obs.id);
            api.tool('shift');
            api.hover(42, 10);
          }
        }
      }
    }
    onCamera();
    refresh();
    drawDynNow();
  }
  return { map, cam, layer, fonts: FONTS, api };
}
