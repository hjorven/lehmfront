// Das drehbare Pappmodell der Etappe in CSS-3D. Nur Darstellung und Eingabe, keine Spielregeln.
// Ziehen dreht und kippt, Doppelklick oder Doppeltippen setzt zurueck, Rad oder zwei Finger zoomen,
// Tippen waehlt ein Feld. Tastatur: Pfeile waehlen, Q/E drehen, W/S kippen, +/- zoomen, 0 zuruecksetzen.
import { BUILDINGS } from '../../config/buildings.js';

const T = 56;        // Feldgroesse in Pixeln
const H = 9;         // Pixel je Hoehenstufe
export const DEFAULT_VIEW = { tilt: 55, spin: -20 };
// Hochkant (Handy): das Brett steht laengs im Bild, damit die Felder gross genug zum Antippen sind
export const PORTRAIT_VIEW = { tilt: 50, spin: -68 };

const key = (x, y) => x + ',' + y;
const el = (cls, parent) => { const d = document.createElement('div'); d.className = cls; if (parent) parent.append(d); return d; };
// kleine deterministische Streuung fuer Baumpositionen
const hash = (x, y, i) => { let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(i + 1, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function createModel(stage, { onTap, onKeyMove }) {
  const cam = el('e3-cam', stage);
  const plane = el('e3-plane', cam);
  plane.style.setProperty('--t', T + 'px');
  const hint = el('e3-hint', stage);
  const coarse = matchMedia('(pointer: coarse)').matches;
  hint.textContent = coarse
    ? 'Ziehen: drehen · Doppeltippen: zurück · Zwei Finger: zoomen'
    : 'Ziehen: drehen und kippen · Doppelklick: zurücksetzen · Rad: zoomen';

  let view = { ...DEFAULT_VIEW }, userZoom = 1, fitZoom = 1, touched = false;
  const portrait = () => stage.clientHeight > stage.clientWidth * 1.05 && cols > rows;
  const defaultView = () => (portrait() ? PORTRAIT_VIEW : DEFAULT_VIEW);
  let cols = 1, rows = 1, maxBox = 0;
  let tiles = new Map();
  let known = null; // IDs der Gebaeude aus dem letzten Aufbau (fuer das Aufklappen neuer Kaesten)

  const apply = () => {
    plane.style.setProperty('--tilt', view.tilt + 'deg');
    plane.style.setProperty('--spin', view.spin + 'deg');
    cam.style.setProperty('--zoom', (fitZoom * userZoom).toFixed(4));
  };

  function fit() {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    if (!sw || !sh) return;
    const W = cols * T, Hh = rows * T;
    const dv = defaultView();
    if (!touched) view = { ...dv };
    const s = dv.spin * Math.PI / 180, t = dv.tilt * Math.PI / 180;
    const cs = Math.abs(Math.cos(s)), sn = Math.abs(Math.sin(s));
    const projW = W * cs + Hh * sn + 24;
    const projH = (W * sn + Hh * cs) * Math.cos(t) + (maxBox + 30) * Math.sin(t) + 24;
    fitZoom = Math.min(sw * 0.88 / projW, (sh - 34) * 0.9 / projH, 1.6);
    apply();
  }

  function build(fields, buildings) {
    plane.textContent = '';
    tiles = new Map();
    cols = 1; rows = 1; maxBox = 0;
    for (const f of fields) { cols = Math.max(cols, f.x + 1); rows = Math.max(rows, f.y + 1); }
    plane.style.width = cols * T + 'px';
    plane.style.height = rows * T + 'px';
    plane.style.left = -cols * T / 2 + 'px';
    plane.style.top = -rows * T / 2 + 'px';

    const base = el('e3-base', plane);
    for (const s of ['n', 's', 'w', 'e']) el('e3-edge ' + s, base);

    const fieldAt = new Map(fields.map((f) => [key(f.x, f.y), f]));
    const bAt = new Map();
    for (const b of [...buildings].sort((a, c) => (a.id < c.id ? -1 : 1))) if (!bAt.has(key(b.x, b.y))) bAt.set(key(b.x, b.y), b);
    const isRail = (x, y) => { const b = bAt.get(key(x, y)); return !!b && b.type === 'gleis'; };
    const hOf = (x, y) => { const f = fieldAt.get(key(x, y)); return f ? f.height | 0 : 0; };

    for (const f of [...fields].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const t = el('e3-tile g-' + f.ground, plane);
      t.style.left = f.x * T + 'px';
      t.style.top = f.y * T + 'px';
      const z = (f.height | 0) * H;
      t.style.setProperty('--z', z + 'px');
      t.dataset.x = f.x; t.dataset.y = f.y;
      tiles.set(key(f.x, f.y), t);
      // Seitenwaende zu tieferen Nachbarn (und am Rand bis zum Brett)
      for (const [s, dx, dy] of [['n', 0, -1], ['s', 0, 1], ['w', -1, 0], ['e', 1, 0]]) {
        const nf = fieldAt.get(key(f.x + dx, f.y + dy));
        const d = z - (nf ? hOf(f.x + dx, f.y + dy) * H : 0);
        if (d > 0) { const sk = el('e3-skirt ' + s, t); sk.style.setProperty('--d', d + 'px'); }
      }
      if (f.ground === 'wald') {
        for (let i = 0; i < 3; i++) {
          const tr = el('e3-stand e3-tree' + (i % 2 ? ' alt' : ''), t);
          tr.style.left = (8 + hash(f.x, f.y, i) * (T - 32)) + 'px';
          tr.style.top = (6 + i * 13 + hash(f.y, f.x, i) * 6) + 'px';
        }
      }
      const b = bAt.get(key(f.x, f.y));
      if (!b) continue;
      const def = BUILDINGS[b.type];
      if (!def) continue;
      if (def.kind === 'rail') {
        const hz = isRail(f.x - 1, f.y) || isRail(f.x + 1, f.y);
        const vt = isRail(f.x, f.y - 1) || isRail(f.x, f.y + 1);
        if (hz || !vt) el('e3-rail h', t);
        if (vt) el('e3-rail v', t);
        continue;
      }
      const box = el('e3-box', t);
      box.style.setProperty('--in', def.model.inset + 'px');
      box.style.setProperty('--h', def.model.h + 'px');
      maxBox = Math.max(maxBox, def.model.h + z);
      for (const face of ['front', 'back', 'left', 'right', 'top']) el('e3-f ' + face, box);
      const roof = box.lastChild;
      const label = document.createElement('span');
      if (b.remaining > 0) { box.classList.add('bau'); label.textContent = b.remaining + ''; box.title = 'im Bau'; }
      else label.textContent = def.letter;
      if (b.damaged) box.classList.add('kaputt');
      // P11: Bauauftrag dieser Runde (noch nicht begonnen) und vom Gegner aufgeklaerte Gebaeude
      if (b.planned) { box.classList.add('plan'); box.title = b.planned === 'repair' ? 'Reparatur geplant' : 'Bauauftrag'; }
      if (b.spotted) { el('e3-spot', box); box.title = (box.title ? box.title + ', ' : '') + 'vom Gegner aufgeklärt'; }
      roof.append(label);
      if (def.smoke && !(b.remaining > 0) && !b.damaged) {
        el('e3-chimney', box);
        for (let i = 0; i < 3; i++) el('e3-puff', box);
      }
      if (known && !known.has(b.id)) {
        box.classList.add('fold');
        requestAnimationFrame(() => requestAnimationFrame(() => box.classList.remove('fold')));
      }
    }
    buildWalkers(buildings, bAt, hOf);
    known = new Set(buildings.map((b) => b.id));
    fit();
  }

  // Laeufer: zwischen benachbarten fertigen Gebaeuden, die sich gegenseitig einen Bonus geben
  // oder Depot und Bahnhof verbinden. Hoechstens sechs, Reihenfolge nach ID.
  function buildWalkers(buildings, bAt, hOf) {
    const ok = (b) => !!b && !(b.remaining > 0) && !b.damaged && !!BUILDINGS[b.type];
    // wie in js/etappe.js: ein Gebaeude laeuft nur, wenn sein Pflicht-Nachbar da ist (Bahnhof braucht Gleis)
    const running = (b) => {
      const need = BUILDINGS[b.type].needs;
      if (!need) return true;
      return [[1, 0], [0, 1], [-1, 0], [0, -1]].some(([dx, dy]) => { const n = bAt.get(key(b.x + dx, b.y + dy)); return ok(n) && need.building.includes(n.type); });
    };
    const active = [...buildings].filter((b) => ok(b) && BUILDINGS[b.type].kind !== 'rail' && bAt.get(key(b.x, b.y)) === b && running(b))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const linked = (a, b) => (BUILDINGS[a.type].bonus || []).some((r) => r.per.building && r.per.building.includes(b.type));
    let n = 0;
    for (const a of active) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const b = bAt.get(key(a.x + dx, a.y + dy));
        if (!b || !active.includes(b) || b.id <= a.id) continue;
        if (!linked(a, b) && !linked(b, a)) continue;
        if (n >= 6) return;
        const w = el('e3-walk', plane);
        w.style.setProperty('--ax', (a.x + 0.5) * T + 'px');
        w.style.setProperty('--ay', (a.y + 0.5) * T + 'px');
        w.style.setProperty('--bx', (b.x + 0.5) * T + 'px');
        w.style.setProperty('--by', (b.y + 0.5) * T + 'px');
        w.style.setProperty('--z', Math.max(hOf(a.x, a.y), hOf(b.x, b.y)) * H + 'px');
        const r = hash(a.x, b.y, n);
        w.style.setProperty('--dur', (7 + r * 4).toFixed(2) + 's');
        w.style.setProperty('--delay', (-r * 6).toFixed(2) + 's');
        const carries = a.type === 'depot' || b.type === 'depot' || a.type === 'feldkueche' || b.type === 'feldkueche';
        el('e3-stand e3-fig' + (carries ? ' crate' : ''), w);
        n++;
      }
    }
  }

  function setMarks(selected, highlight) {
    for (const t of tiles.values()) t.classList.remove('sel', 'hl');
    for (const p of highlight || []) { const t = tiles.get(key(p.x, p.y)); if (t) t.classList.add('hl'); }
    if (selected) { const t = tiles.get(key(selected.x, selected.y)); if (t) { t.classList.remove('hl'); t.classList.add('sel'); } }
  }

  // Eingabe: Zeiger
  const pointers = new Map();
  let drag = null, pinch = null, lastTap = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = { d: Math.hypot(p.x - q.x, p.y - q.y) || 1, z: userZoom };
      drag = null;
    }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [p, q] = [...pointers.values()];
      userZoom = Math.max(0.6, Math.min(2.5, pinch.z * Math.hypot(p.x - q.x, p.y - q.y) / pinch.d));
      apply();
      return;
    }
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 5) { drag.moved = true; stage.classList.add('dragging'); }
    if (!drag.moved) return;
    touched = true;
    view.spin += (e.clientX - drag.x) * 0.4;
    view.tilt = Math.max(15, Math.min(80, view.tilt - (e.clientY - drag.y) * 0.3));
    drag.x = e.clientX; drag.y = e.clientY;
    apply();
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    stage.classList.remove('dragging');
    if (pinch) { if (pointers.size < 2) pinch = null; drag = null; return; }
    if (drag && !drag.moved && e.type === 'pointerup') {
      const now = performance.now();
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const t = hit && hit.closest('.e3-tile');
      const tile = t && stage.contains(t) ? t : null;
      // Doppeltippen nur auf dasselbe Feld (oder daneben ins Leere) setzt zurueck; zwei schnelle Taps auf Nachbarfelder waehlen beide
      if (lastTap && now - lastTap.t < 330 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24 && lastTap.tile === tile) {
        reset();
        lastTap = null;
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY, tile };
        if (tile) onTap(Number(tile.dataset.x), Number(tile.dataset.y));
      }
    }
    drag = null;
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    userZoom = Math.max(0.6, Math.min(2.5, userZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    apply();
  }, { passive: false });

  // Eingabe: Tastatur
  stage.tabIndex = 0;
  stage.setAttribute('role', 'application');
  stage.setAttribute('aria-label', 'Etappe als Modell. Pfeiltasten wählen ein Feld, Q und E drehen, W und S kippen, Null setzt zurück.');
  stage.addEventListener('keydown', (e) => {
    const k = e.key;
    const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (moves[k]) {
      // Pfeile folgen der Bildschirmrichtung: Richtung um die Drehung des Modells (auf 90 Grad gerundet) zurueckdrehen
      const quarter = ((Math.round(view.spin / 90) % 4) + 4) % 4;
      let [dx, dy] = moves[k];
      for (let i = 0; i < quarter; i++) [dx, dy] = [dy, -dx];
      onKeyMove(dx, dy);
      e.preventDefault();
      return;
    }
    if (k === 'q' || k === 'Q') view.spin -= 15;
    else if (k === 'e' || k === 'E') view.spin += 15;
    else if (k === 'w' || k === 'W') view.tilt = Math.min(80, view.tilt + 5);
    else if (k === 's' || k === 'S') view.tilt = Math.max(15, view.tilt - 5);
    else if (k === '+' || k === '=') userZoom = Math.min(2.5, userZoom * 1.1);
    else if (k === '-') userZoom = Math.max(0.6, userZoom / 1.1);
    else if (k === '0') { reset(); e.preventDefault(); return; }
    else return;
    touched = true;
    e.preventDefault();
    apply();
  });

  function reset() { touched = false; view = { ...defaultView() }; userZoom = 1; apply(); }

  const ro = new ResizeObserver(fit);
  ro.observe(stage);
  apply();

  return {
    build, setMarks, reset,
    setView(v) { touched = true; view = { tilt: Math.max(15, Math.min(80, v.tilt ?? view.tilt)), spin: v.spin ?? view.spin }; apply(); },
    getView() { return { ...view, zoom: userZoom }; },
    destroy() { ro.disconnect(); stage.textContent = ''; },
  };
}
