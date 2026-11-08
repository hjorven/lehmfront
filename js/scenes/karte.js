// Szene "karte": die Lagekarte bildschirmfuellend (P02).
// Parameter: map=asse, night=0..1 (darkness), x, y, zoom (Kamera fuer Screenshots), ui=0 blendet Kaertchen aus.
// Antippen waehlt ein Feld; ein zweites Feld zeigt Weg (A*) und Sichtlinie vom ersten aus.
import { loadMap, cellAt, cellLabel, findPath, lineOfSight, TERRAIN, ZONE_NAMES, DIR } from '../map.js';
import { themeAt, applyTheme, currentTheme, onThemeChange, animateDarkness, NIGHT_FROM } from '../theme.js';
import { visibilityFromDarkness } from '../rules.js';
import {
  createCamera, resizeCamera, attachCameraControls, screenToCell, applyCameraTransform, centerOn, fitZoom, zoomAt,
} from '../render/camera.js';
import { createMapLayer, sheetBounds, FONTS } from '../render/map-layer.js';

function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
  return new Promise((ok) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = l.onerror = () => ok();
    document.head.append(l);
  });
}

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const SIDE = { own: 'eigen', enemy: 'feindlich' };

export async function mount(root, params) {
  const mapId = /^[a-z0-9-]+$/.test(params.get('map') || '') ? params.get('map') : 'asse';
  const [json] = await Promise.all([
    fetch(`data/maps/${mapId}.json`).then((r) => { if (!r.ok) throw new Error('Karte fehlt: ' + mapId); return r.json(); }),
    ensureCss('css/karte.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "IBM Plex Mono"', '16px "Caveat"', '16px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const map = loadMap(json);

  root.className = 'karte';
  root.innerHTML = `
    <canvas class="karte-static" aria-label="Lagekarte ${map.name}"></canvas>
    <canvas class="karte-dyn" aria-hidden="true"></canvas>
    <section class="karte-info card" aria-live="polite">
      <div class="karte-info-head"><b class="karte-title"></b><span class="karte-time"></span></div>
      <div class="karte-cell"></div>
    </section>
    <div class="karte-tools">
      <button class="btn karte-zoom" data-z="in" aria-label="Hineinzoomen">+</button>
      <button class="btn karte-zoom" data-z="out" aria-label="Herauszoomen">−</button>
      <button class="btn karte-daynight" aria-label="Tageszeit wechseln"></button>
    </div>`;
  if (params.get('ui') === '0') root.classList.add('no-ui');
  const $ = (s) => root.querySelector(s);
  const staticCv = $('.karte-static'), dynCv = $('.karte-dyn');
  $('.karte-title').textContent = map.sheet?.title || map.name;

  // Tageszeit
  let darkness = Math.max(0, Math.min(1, num(params.get('night'), 0)));
  applyTheme(themeAt(darkness));

  // Kamera: Desktop zeigt das ganze Blatt, Handy startet auf der eigenen Stellung
  const cam = createCamera({ bounds: sheetBounds(map), maxZoom: 110 });
  const vw = root.clientWidth, vh = root.clientHeight;
  resizeCamera(cam, vw, vh);
  // Hochkant: Blatt fuellt die Hoehe, Ausschnitt liegt auf der eigenen Stellung und dem Niemandsland
  if (vw < 700) centerOn(cam, map.width * 0.55, map.height * 0.5, Math.max(fitZoom(cam), vw / 24, vh / cam.bounds.h));
  if (params.has('zoom') || params.has('x') || params.has('y')) {
    centerOn(cam, num(params.get('x'), cam.x), num(params.get('y'), cam.y), num(params.get('zoom'), cam.zoom));
  }

  const layer = createMapLayer(staticCv, map, { getCamera: () => cam, getTheme: currentTheme });
  const dctx = dynCv.getContext('2d');
  let dpr = 1;
  let hover = null, selected = null, target = null, plan = null;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = root.clientWidth, h = root.clientHeight;
    resizeCamera(cam, w, h);
    layer.resize(w, h, dpr);
    dynCv.width = Math.round(w * dpr);
    dynCv.height = Math.round(h * dpr);
    dynCv.style.width = w + 'px';
    dynCv.style.height = h + 'px';
    drawDyn();
  }

  let dynPending = 0;
  function drawDyn() {
    if (dynPending) return;
    dynPending = requestAnimationFrame(() => { dynPending = 0; drawDynNow(); });
  }
  function drawDynNow() {
    const th = currentTheme();
    dctx.setTransform(1, 0, 0, 1, 0, 0);
    dctx.clearRect(0, 0, dynCv.width, dynCv.height);
    applyCameraTransform(dctx, cam, dpr);
    const px = 1 / cam.zoom;
    dctx.lineJoin = dctx.lineCap = 'round';
    if (plan?.path) {
      dctx.strokeStyle = th.ink;
      dctx.lineWidth = 2 * px;
      dctx.setLineDash([5 * px, 4 * px]);
      dctx.beginPath();
      plan.path.path.forEach((p, i) => (i ? dctx.lineTo(p.x + 0.5, p.y + 0.5) : dctx.moveTo(p.x + 0.5, p.y + 0.5)));
      dctx.stroke();
      dctx.setLineDash([]);
    }
    if (plan) {
      const a = plan.from, b = plan.to;
      const end = plan.los.blockedAt || b;
      dctx.strokeStyle = th.own;
      dctx.lineWidth = 2.5 * px;
      dctx.beginPath(); dctx.moveTo(a.x + 0.5, a.y + 0.5); dctx.lineTo(end.x + 0.5, end.y + 0.5); dctx.stroke();
      if (plan.los.blockedAt) {
        dctx.strokeStyle = th.danger;
        dctx.setLineDash([3 * px, 4 * px]);
        dctx.beginPath(); dctx.moveTo(end.x + 0.5, end.y + 0.5); dctx.lineTo(b.x + 0.5, b.y + 0.5); dctx.stroke();
        dctx.setLineDash([]);
        const s = 0.28;
        dctx.lineWidth = 3 * px;
        dctx.beginPath();
        dctx.moveTo(end.x + 0.5 - s, end.y + 0.5 - s); dctx.lineTo(end.x + 0.5 + s, end.y + 0.5 + s);
        dctx.moveTo(end.x + 0.5 + s, end.y + 0.5 - s); dctx.lineTo(end.x + 0.5 - s, end.y + 0.5 + s);
        dctx.stroke();
      }
    }
    const box = (c, color, w) => {
      if (!c) return;
      dctx.strokeStyle = color;
      dctx.lineWidth = w * px;
      dctx.strokeRect(c.x + 0.04, c.y + 0.04, 0.92, 0.92);
    };
    box(hover, th.ink, 1.5);
    box(target, th.ink, 2.5);
    box(selected, th.accent, 3);
  }

  function describe(c) {
    if (!c) return '';
    const parts = [`<span class="k">Feld</span> <b>${cellLabel(c.x, c.y)}</b>`, `${TERRAIN[c.terrain].name}`, `Höhe ${c.height}`, ZONE_NAMES[c.zone] + (c.side ? ' (' + SIDE[c.side] + ')' : '')];
    if (c.trench) parts.push(`${c.trench.kind === 'fire' ? 'Feuergraben' : 'Laufgraben'} Stufe ${c.trench.level}, Front nach ${DIR[c.trench.facing].name}`);
    if (c.wire) parts.push('Draht');
    if (c.crater) parts.push(c.crater === 2 ? 'großer Krater' : 'Krater');
    if (c.rail) parts.push('Gleis');
    if (c.building) parts.push(map.buildings.find((b) => b.id === c.building)?.label || 'Unterstand');
    return parts.join(' · ');
  }

  function updateInfo() {
    const el = $('.karte-cell');
    const c = target ? null : selected || hover;
    if (plan) {
      const path = plan.path ? `Weg ${plan.path.path.length - 1} Felder, Kosten ${(plan.path.cost / 10).toFixed(1)}` : 'kein Weg';
      const los = plan.los.visible ? 'Sicht frei' : `Sicht verdeckt bei ${cellLabel(plan.los.blockedAt.x, plan.los.blockedAt.y)}`;
      el.innerHTML = `<span class="k">Von</span> <b>${cellLabel(plan.from.x, plan.from.y)}</b> <span class="k">nach</span> <b>${cellLabel(plan.to.x, plan.to.y)}</b> · ${path} · ${los}`;
    } else if (c) el.innerHTML = describe(c);
    else el.innerHTML = '<span class="k">Ziehen, Rad oder zwei Finger bewegen die Karte. Antippen zeigt ein Feld.</span>';
  }

  function updateTime() {
    const night = darkness >= NIGHT_FROM;
    const vis = Math.round(visibilityFromDarkness(darkness) * 100);
    $('.karte-time').textContent = `${night ? 'Nacht' : darkness > 0.15 ? 'Dämmerung' : 'Tag'} · Sicht ${vis} %`;
    $('.karte-daynight').textContent = night ? 'Tag' : 'Nacht';
    $('.karte-daynight').setAttribute('aria-label', night ? 'Zum Tag wechseln' : 'Zur Nacht wechseln');
  }

  onThemeChange(() => { layer.invalidate(); drawDyn(); });

  attachCameraControls(dynCv, cam, {
    onChange: () => { layer.invalidate(); drawDyn(); },
    onHover: (p) => {
      const c = p ? screenToCell(cam, p.x, p.y) : null;
      const cell = c ? cellAt(map, c.x, c.y) : null;
      if (cell === hover) return;
      hover = cell;
      updateInfo();
      drawDyn();
    },
    onTap: (p) => {
      const c = screenToCell(cam, p.x, p.y);
      const cell = cellAt(map, c.x, c.y);
      if (!cell) { selected = target = plan = null; }
      else if (!selected || target || cell === selected) { selected = cell === selected && !target ? null : cell; target = plan = null; }
      else {
        target = cell;
        plan = { from: selected, to: target, path: findPath(map, selected, target), los: lineOfSight(map, selected, target) };
      }
      updateInfo();
      drawDyn();
    },
  });

  root.querySelectorAll('.karte-zoom').forEach((b) => b.addEventListener('click', () => {
    const f = b.dataset.z === 'in' ? 1.4 : 1 / 1.4;
    zoomAt(cam, f, cam.viewW / 2, cam.viewH / 2);
    layer.invalidate();
    drawDyn();
  }));

  let stopAnim = null;
  $('.karte-daynight').addEventListener('click', () => {
    if (stopAnim) stopAnim();
    const from = darkness, to = darkness >= NIGHT_FROM ? 0 : 1;
    stopAnim = animateDarkness(from, to, { onDone: () => { stopAnim = null; } });
  });
  onThemeChange((th) => { darkness = th.darkness; updateTime(); });

  new ResizeObserver(resize).observe(root);
  resize();
  updateInfo();
  updateTime();
  layer.drawNow();
  drawDynNow();

  // Fuer Screenshots und Tests: Zustand von aussen setzen
  window.__karte = { map, cam, layer, select: (x, y) => { selected = cellAt(map, x, y); target = plan = null; updateInfo(); drawDynNow(); },
    plan: (a, b) => { selected = cellAt(map, a[0], a[1]); target = cellAt(map, b[0], b[1]); plan = { from: selected, to: target, path: findPath(map, selected, target), los: lineOfSight(map, selected, target) }; updateInfo(); drawDynNow(); } };
  return { map, cam, layer, fonts: FONTS };
}
