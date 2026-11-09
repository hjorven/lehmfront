// Szene "gefecht": der spielbare Gefechtsbildschirm (P03, Plan 3.4, 7.2, 7.3, 7.6).
// Gefecht laden, Gruppen waehlen, Befehle geben (Werkzeugreihe, radiales Menue, Tastatur), Runde ausfuehren.
// Parameter: scenario=asse-frei, mode=frei|hotseat, seed=<Zahl>, night=0..1 (erzwingt Dunkelheit),
//   kind=battle (Gefechtsrunde testen), x, y, zoom (Kamera), demo=<Zustand fuer Screenshots>.
import { loadMap, cellAt, cellLabel } from '../map.js';
import { createInitialState, groupsOf, getGroup, otherSide } from '../state.js';
import { resolveTurn } from '../resolve.js';
import { viewFor } from '../view.js';
import { sightLine, coverAt, PINNED, darknessOf } from '../sight.js';
import { faction } from '../config/factions.js';
import { themeAt, applyTheme, currentTheme, onThemeChange } from '../theme.js';
import {
  createCamera, resizeCamera, attachCameraControls, screenToWorld, worldToScreen, centerOn, fitZoom,
} from '../render/camera.js';
import { createMapLayer, sheetBounds, FONTS } from '../render/map-layer.js';
import { drawBattle, hitUnit, unitBox } from '../render/units-layer.js';
import { playSfx, audio } from '../audio/engine.js';
import { planOrders } from '../ai/dummy.js';
import {
  createOrderBook, setOrder, clearOrder, undo, canUndo, listOrders, orderOf, seal, nextRound,
} from '../ui/orderbook.js';
import { summarize, checklist } from '../ui/summary.js';
import { allTools, toolByKey, usable } from '../ui/tools.js';
import '../ui/tools/index.js';
import { overlaySlots } from '../ui/overlays.js';
import '../ui/overlays/index.js';
import { planMove, pathRounds } from '../ui/tools/move.js';
import {
  groupName, groupMark, typeName, leaderShort, fatigueWord, weatherName, clockText, roundTitle, orderLabel, plural,
} from '../ui/labels.js';
import { darknessAt } from '../ui/daytime.js';
import { esc, ensureCss, reducedMotion } from '../ui/dom.js';
import { createHud } from '../ui/hud.js';
import { createToolbar } from '../ui/toolbar.js';
import { createShield } from '../ui/shield.js';
import { createRadial } from '../ui/radial.js';
import { createOrderList } from '../ui/orderlist.js';
import { showSummary, showHandover } from '../ui/commit.js';
import { planFilm, replayTo } from '../film.js';
import { createArchive, archiveRound, inputOf, entryTitle } from '../archive.js';
import { phasesFor } from '../phases/registry.js';
import { createFilmPlayer } from '../ui/film.js';
import { createTelegram } from '../ui/telegram.js';
import { createArchiveView } from '../ui/archive.js';
import { drawFilmTrails } from '../render/film-layer.js';

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const LONG_PRESS_MS = 430;
const NARROW = 700;

export async function mount(root, params) {
  const scenId = /^[a-z0-9-]+$/.test(params.get('scenario') || '') ? params.get('scenario') : 'asse-frei';
  const fetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('Datei fehlt: ' + url); return r.json(); });
  const scenario = await fetchJson(`data/scenarios/${scenId}.json`);
  const [mapJson] = await Promise.all([
    fetchJson(`data/maps/${scenario.map}.json`),
    ensureCss('css/gefecht.css'),
    ensureCss('css/film.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "IBM Plex Mono"', '700 16px "Caveat"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const map = loadMap(mapJson);
  const mode = params.get('mode') === 'hotseat' ? 'hotseat' : 'frei';
  const seed = (num(params.get('seed'), 1917) >>> 0) || 1;
  let state = createInitialState(map, scenario, seed);
  if (params.get('kind') === 'battle') { state.turnKind = 'battle'; state.battle = { round: 1 }; }
  const humans = mode === 'hotseat' ? ['a', 'b'] : ['a'];
  const env = { map };

  // Planungszustand
  let side = 'a';
  let book = createOrderBook();
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
  const forcedDark = params.has('night') ? Math.max(0, Math.min(1, num(params.get('night'), 0))) : null;
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
    const cx = own.length ? own.reduce((s, g) => s + g.pos.x, 0) / own.length : map.width / 2;
    const vw = root.clientWidth, vh = root.clientHeight;
    if (vw < NARROW) centerOn(cam, side === 'a' ? cx + 4 : cx - 4, map.height * 0.42, Math.max(fitZoom(cam), vw / 20));
    else centerOn(cam, map.width * 0.5, map.height * 0.5 + 1, Math.max(fitZoom(cam), Math.min(vw / 50, vh / 34)));
  }
  homeView();
  if (params.has('zoom') || params.has('x') || params.has('y')) {
    centerOn(cam, num(params.get('x'), cam.x), num(params.get('y'), cam.y), num(params.get('zoom'), cam.zoom));
  }

  const layer = createMapLayer(staticCv, map, { getCamera: () => cam, getTheme: currentTheme });
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
    if (o.type === 'hold') return 'Halten';
    const dest = o.path?.length ? o.path[o.path.length - 1] : o.target;
    let t = orderLabel(o.type) + (dest ? ` nach ${cellLabel(dest.x, dest.y)}` : '');
    if (o.path?.length) t += ` · ${plural(pathRounds(map, state, g, o.path).rounds, 'Runde', 'Runden')}`;
    if (o.carried) t += ' · läuft weiter';
    return t;
  }

  // ---------- Zeichnen ----------
  let dynPending = 0;
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
      state, map, side, groups, ghosts, orders, reach, selectedId, planning: !modalOpen, anim,
      hover: tool?.pick ? tool.hoverCell : null,
      preview: prev ? { ...prev, group: tool.group.id, cell: tool.hoverCell, ok: prev.ok ?? !!prev.path } : null,
      sightLine: !tool && hoverSight ? hoverSight : null,
      overlays: overlaySlots().filter((o) => overlaysOn.has(o.slot) && o.draw),
    });
    placeShield();
  }

  // Phasenfilm: Zwischenstand aus dem Film, Spuren als Overlay unter den Gruppen
  function drawFilmNow() {
    const fr = filmFrame;
    const groups = fr.groups.map((g) => ({ ...g, mark: groupMark(fr.state, g) }));
    drawBattle(dctx, cam, dpr, currentTheme(), {
      state: fr.state, map, side, groups, ghosts: [], orders: new Map(), selectedId, planning: false,
      overlays: [{ draw: (ctx, o) => drawFilmTrails(ctx, o, fr.trails) }],
    });
  }

  // ---------- Oberflaeche ----------
  const hud = createHud(ui, {
    onToggleList: () => toggleList(),
    onToggleOverlay: (slot) => toggleOverlay(slot),
    onCheck: (i) => { const c = hud.checkAt(i); if (c?.group) select(c.group, { center: true }); else if (c?.at) centerOn(cam, c.at.x + 0.5, c.at.y + 0.5); refresh(); },
    onToggleSheet: () => { root.classList.toggle('sheet-open'); hud.setSheet(root.classList.contains('sheet-open')); },
  });
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
    onClear: (id) => { book = clearOrder(book, side, id); playSfx('paper'); refresh(); },
    onClose: () => closeList(),
  });
  // Telegramm, Phasenfilm und Protokoll-Archiv (P07)
  function jumpTo(l) {
    if (!l?.at) return;
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
    onFrame: (fr) => { filmFrame = fr; drawDyn(); },
    onLines: (n, typing) => report.setCount(n, typing),
    onEnd: () => endFilm(),
  });
  const archiveView = createArchiveView(ui, {
    onJump: jumpTo,
    onReplay: (entry) => {
      archiveView.hide();
      const input = inputOf(entry, env);
      startFilm(input, replayTo(input, phasesFor(entry.kind).length), { title: entryTitle(entry) + ' · Protokoll', replay: true });
    },
    onClose: () => { archiveView.hide(); modalOpen = false; refresh(); dynCv.focus({ preventScroll: true }); },
  });
  const radial = createRadial(ui, {
    onPick: (it) => { radial.hide(); dynCv.focus({ preventScroll: true }); if (it.id === '__clear') { book = clearOrder(book, side, it.group); refresh(); } else startTool(it.def, getGroup(state, it.group)); },
    onClose: () => { radial.hide(); dynCv.focus({ preventScroll: true }); },
  });

  function selectedOwn() {
    const g = selectedId ? getGroup(state, selectedId) : null;
    return g && g.side === side && g.status !== 'lost' ? g : null;
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
        : 'Gruppe anklicken, dann Bewegen (B) oder Halten (H). Lang drücken oder Rechtsklick öffnet die Befehle im Kreis.' };
    }
    return null;
  }

  function hudModel() {
    const s = state.sides[side];
    const own = groupsOf(state, side);
    const morale = own.length ? Math.round(own.reduce((a, g) => a + g.morale, 0) / own.length) : 0;
    const daytime = state.night ? 'Nacht' : 'Tag';
    const sector = map.sheet?.title?.replace(/^Lagekarte\s*/i, '') || map.name;
    const orders = ordersNow();
    return {
      supplies: s.supplies, morale, reputation: s.reputation, trust: s.trust,
      roundTitle: roundTitle(state) + (mode === 'hotseat' ? ` · ${faction(s.faction).short}` : ''),
      roundSub: `${daytime} · ${clockText(state.clock)} Uhr · ${weatherName(state.weather)} · Abschnitt ${sector}`,
      stripRound: `R${state.turn} · ${daytime}`,
      orderCount: orders.length,
      overlays: overlaySlots().map((o) => ({ slot: o.slot, label: o.label, empty: !!o.empty, active: overlaysOn.has(o.slot) })),
      checklist: checklist({ state, side, orders, map }),
      hint: currentHint(),
    };
  }

  function refresh() {
    root.classList.toggle('picking', !!tool?.pick);
    hud.update(hudModel());
    const g = selectedOwn();
    toolbar.update({
      tools: allTools().map((t) => ({ tool: t, ...usable(t, g, state, env) })),
      active: tool?.def.id ?? null,
      canUndo: canUndo(book, side),
      count: ordersNow().length,
      label: mode === 'hotseat' && side === 'a' && !book.b?.sealed ? 'Befehle versiegeln' : 'Runde ausführen',
    });
    if (orderList.open) updateList();
    updateShield();
    drawDyn();
  }

  function updateList() {
    const rows = groupsOf(state, side).map((g) => {
      const o = orderOf(book, side, g.id);
      return { id: g.id, name: groupLabel(g), mark: groupMark(state, g), text: orderText(g, o), set: !!o, carried: !!o?.carried };
    });
    const n = rows.filter((r) => r.set).length;
    orderList.update(rows, `${n} von ${rows.length} mit Befehl`);
  }

  // ---------- Schild ----------
  function shieldAnchor(g) {
    const p = worldToScreen(cam, g.pos.x + 0.5, g.pos.y + 0.5);
    const b = unitBox(cam);
    const n = narrow();
    return { x: p.x, y: p.y, h: b.h * cam.zoom + 8, safeTop: n ? 60 : 12, safeBottom: n ? 96 : 92 };
  }
  function updateShield() {
    const g = selectedId ? getGroup(state, selectedId) : null;
    const visible = g && shownGroups().groups.some((x) => x.id === g.id);
    if (!g || !visible || g.status === 'lost' || radial.open || filmFrame) { shield.hide(); return; }
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
        ${g.suppressed >= 0.3 ? `<div class="warn"><span>Unter Feuer</span><b>${g.suppressed >= PINNED ? 'niedergehalten' : 'geduckt'}</b></div>` : ''}
      </div>
      <footer><span>Befehl</span><b>${esc(orderText(g, o))}</b></footer>
      ${prev?.text ? `<div class="preview${(prev.ok ?? !!prev.path) ? '' : ' bad'}">${esc(prev.text)}</div>` : ''}`, shieldAnchor(g));
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

  function startTool(def, g) {
    if (!def) return;
    if (book[side]?.sealed) return;
    const u = usable(def, g, state, env);
    if (!u.ok) { flash(u.why, 'warn'); return; }
    cancelTool(false);
    radial.hide();
    helpShown = true;
    selectedId = g.id;
    tool = { def, group: g, pick: null, preview: null, hoverCell: null, pickHint: '' };
    const t = tool;
    def.begin({
      group: g, state, map, side,
      setOrder: (o) => placeOrder(o),
      pickCell: (req) => { if (tool !== t) return; t.pick = req; t.pickHint = req.hint; refresh(); },
      hint: (text) => flash(text, 'warn'),
      cancel: () => { if (tool === t) cancelTool(); },
    });
    refresh();
  }

  function cancelTool(doRefresh = true) {
    tool = null;
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
    const r = undo(book, side);
    if (!r.group) { flash('Nichts zurückzunehmen.'); return; }
    book = r.book;
    anim = null;
    selectedId = r.group;
    playSfx('paper', { intensity: 0.4 });
    refresh();
  }

  function nextIdle() {
    const idle = groupsOf(state, side).filter((g) => !orderOf(book, side, g.id));
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
    archiveView.hide();
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
    cancelTool(false);
    radial.hide();
    const orders = ordersNow();
    const s = summarize({ state, side, orders, map });
    modalOpen = true;
    refresh();
    showSummary(ui, s, {
      title: `${roundTitle(state)} · Zusammenfassung`,
      sub: mode === 'hotseat' ? faction(state.sides[side].faction).name : 'Was du gleich abschickst',
      preset,
      onCancel: () => { modalOpen = false; refresh(); dynCv.focus({ preventScroll: true }); },
      onCommit: () => { modalOpen = false; commitSide(); },
    });
  }

  function commitSide() {
    book = seal(book, side);
    playSfx('stamp');
    selectedId = null;
    hoverSight = null;
    closeList();
    report.hide();
    overlaysOn = new Set();
    transient = null;
    const waiting = humans.find((s) => !book[s].sealed);
    if (waiting) {
      modalOpen = true;
      refresh();
      showHandover(ui, {
        title: 'Befehle versiegelt',
        text: `Die Befehle von ${faction(state.sides[side].faction).name} sind verschlossen. Gib das Gerät an ${faction(state.sides[waiting].faction).name} weiter.`,
        button: `Weiter als ${faction(state.sides[waiting].faction).short}`,
        onGo: () => {
          modalOpen = false; side = waiting; homeView(); onCamera();
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
    modalOpen = false;
    root.classList.remove('filming');
    report.setFilmActive(false);
    if (state.result && !filmReplay) flash(state.result.reason);
    refresh();
    drawDynNow();
    dynCv.focus({ preventScroll: true });
  }

  function openArchive() {
    if (player.open) return;
    if (archiveView.open) { archiveView.hide(); modalOpen = false; refresh(); return; }
    const rounds = archive.rounds.map((e) => {
      const input = inputOf(e, env);
      const film = planFilm(input, replayTo(input, phasesFor(e.kind).length), side);
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

  function resolveNow() {
    const ordersA = listOrders(book, 'a');
    const ordersB = humans.includes('b') ? listOrders(book, 'b') : planOrders(viewFor(state, [], 'b', env), { map, seed });
    const input = { state, ordersA, ordersB, seed, turn: state.turn, env };
    const r = resolveTurn(state, ordersA, ordersB, seed, state.turn, env);
    const before = state;
    state = r.state;
    hoverSight = null;
    lastLog = r.log;
    lastRound = { input, result: r };
    archive = archiveRound(archive, input, r);
    // Unvollendete Wege laufen als Befehl weiter, solange die Rundenart passt
    const carry = { a: [], b: [] };
    for (const e of r.log) {
      if ((e.type === 'move' || e.type === 'redeploy') && e.rest?.length && !e.blocked) {
        const g = getGroup(state, e.group);
        const type = state.turnKind === 'battle' ? 'move' : 'redeploy';
        if (g && g.status !== 'lost' && e.type === type) carry[g.side].push({ group: g.id, type, path: e.rest, carried: true });
      }
    }
    book = nextRound(book, carry);
    side = humans[0];
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
        onGo: () => { modalOpen = false; homeView(); onCamera(); showReport(); refresh(); },
      });
    } else {
      showReport();
    }
  }

  // ---------- Radiales Menue ----------
  function openRadial(g, clientX, clientY) {
    if (!g || g.side !== side || modalOpen || book[side]?.sealed) return false;
    cancelTool(false);
    selectedId = g.id;
    const r = root.getBoundingClientRect();
    const items = allTools().map((t) => ({ id: t.id, def: t, label: t.label, icon: t.icon, group: g.id, ...usable(t, g, state, env) }));
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
        const next = cell && (cell.x !== g.pos.x || cell.y !== g.pos.y) ? sightLabel(sightLine(map, g, cell, darknessOf(state))) : null;
        const k = (s) => (s ? `${s.to.x},${s.to.y},${s.from.x},${s.from.y}` : '');
        if (k(next) !== k(hoverSight)) { hoverSight = next; drawDyn(); }
        return;
      }
      const cell = p ? cellFromScreen(p).cell : null;
      if (cell === tool.hoverCell) return;
      tool.hoverCell = cell;
      tool.preview = cell ? tool.pick.preview(cell) : null;
      updateShield();
      drawDyn();
    },
    onTap: (p) => {
      if (suppressTap) { suppressTap = false; return; }
      if (modalOpen) return;
      if (radial.open) { radial.hide(); refresh(); return; }
      hud.closePopover();
      if (root.classList.contains('sheet-open')) { root.classList.remove('sheet-open'); hud.setSheet(false); }
      const { cell } = cellFromScreen(p);
      if (tool?.pick) {
        if (!cell) return;
        tool.hoverCell = cell;
        tool.preview = tool.pick.preview(cell);
        const t = tool;
        if (t.pick.pick(cell)) { if (tool === t) cancelTool(); }
        else refresh();
        return;
      }
      const g = groupAtScreen(p);
      if (g) select(g.id);
      else if (selectedId) select(null);
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
      else if (hud.popoverOpen) hud.closePopover();
      else if (orderList.open) closeList();
      else if (root.classList.contains('sheet-open')) { root.classList.remove('sheet-open'); hud.setSheet(false); }
      else if (report.open) report.hide();
      else if (archiveView.open) archiveView.hide();
      else if (selectedId) select(null);
      return;
    }
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
    if (e.key.length === 1) {
      const def = toolByKey(e.key);
      if (!def) return;
      e.preventDefault();
      const g = selectedOwn();
      if (!g) { flash(`${def.label}: erst eine Gruppe wählen (Leertaste).`, 'warn'); return; }
      startTool(def, g);
    }
  });

  // Zielwahl per Tastatur: Pfeile verschieben die Karte, Enter waehlt das Feld in der Bildmitte
  dynCv.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && tool?.pick && !modalOpen) {
      e.preventDefault();
      e.stopPropagation();
      const cell = cellAt(map, Math.floor(cam.x), Math.floor(cam.y));
      if (cell) { const t = tool; if (t.pick.pick(cell)) { if (tool === t) cancelTool(); } }
    }
  });

  // ---------- Groesse und Thema ----------
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth, h = root.clientHeight;
    resizeCamera(cam, w, h);
    layer.resize(w, h, dpr);
    dynCv.width = Math.round(w * dpr);
    dynCv.height = Math.round(h * dpr);
    dynCv.style.width = w + 'px';
    dynCv.style.height = h + 'px';
    drawDynNow();
  }
  onThemeChange((th) => { darkness = th.darkness; layer.invalidate(); drawDyn(); });
  new ResizeObserver(resize).observe(root);
  audio.init?.();
  resize();
  refresh();
  layer.drawNow();
  drawDynNow();
  dynCv.focus({ preventScroll: true });

  // ---------- Demo-Zustaende fuer Screenshots und Tests ----------
  const api = {
    get state() { return state; }, get book() { return book; }, map, cam,
    select: (id) => select(id, { center: false }),
    order: (o) => placeOrder(o),
    tool: (id) => startTool(allTools().find((t) => t.id === id), selectedOwn()),
    hover: (x, y) => { if (tool?.pick) { tool.hoverCell = cellAt(map, x, y); tool.preview = tool.pick.preview(tool.hoverCell); refresh(); } },
    radial: (id) => { const g = getGroup(state, id); const p = worldToScreen(cam, g.pos.x + 0.5, g.pos.y + 0.5); const r = root.getBoundingClientRect(); openRadial(g, p.x + r.left, p.y + r.top); },
    summary: (preset) => openSummary(preset),
    list: () => openList(),
    overlay: (slot) => toggleOverlay(slot),
    commit: () => commitSide(),
    get player() { return player; },
    archive: () => openArchive(),
    finishAnim: () => { anim = null; drawDynNow(); },
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
    else if (demo === 'sichtlinie') { api.select(own[0].id); hoverSight = sightLabel(sightLine(map, own[0], { x: 41, y: 12 }, darknessOf(state))); }
    refresh();
    drawDynNow();
  }
  return { map, cam, layer, fonts: FONTS, api };
}
