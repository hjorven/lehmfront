// Kamera der Lagekarte: Zoom und Verschieben, Grenzen, Bildschirm <-> Feld.
// Weltkoordinaten sind Felder (1 = ein Feld, 10 Meter). zoom = Bildschirmpixel (CSS) pro Feld.
// Die Rechenfunktionen sind DOM-frei und getestet; attachCameraControls haengt Maus, Rad, Tasten und Touch an.

/**
 * bounds: sichtbarer Weltbereich, ueber den die Kamera nicht hinaus darf, z. B. Karte plus Blattrand.
 * Wird der Ausschnitt groesser als bounds, wird zentriert.
 */
export function createCamera({ bounds, maxZoom = 120, minZoom = null, viewW = 1, viewH = 1 } = {}) {
  const cam = {
    x: bounds.x + bounds.w / 2,
    y: bounds.y + bounds.h / 2,
    zoom: 16,
    viewW,
    viewH,
    bounds: { ...bounds },
    maxZoom,
    fixedMinZoom: minZoom,
  };
  cam.zoom = fitZoom(cam);
  return cam;
}

/** Zoom, bei dem der ganze Bereich gerade hineinpasst. */
export function fitZoom(cam) {
  return Math.min(cam.viewW / cam.bounds.w, cam.viewH / cam.bounds.h);
}

export function minZoomOf(cam) {
  return cam.fixedMinZoom ?? fitZoom(cam);
}

/** Haelt Zoom und Mittelpunkt in den Grenzen. Veraendert cam und gibt es zurueck. */
export function clampCamera(cam) {
  const minZ = Math.min(minZoomOf(cam), cam.maxZoom);
  cam.zoom = Math.max(minZ, Math.min(cam.maxZoom, cam.zoom));
  const halfW = cam.viewW / cam.zoom / 2, halfH = cam.viewH / cam.zoom / 2;
  const b = cam.bounds;
  if (halfW * 2 >= b.w) cam.x = b.x + b.w / 2;
  else cam.x = Math.max(b.x + halfW, Math.min(b.x + b.w - halfW, cam.x));
  if (halfH * 2 >= b.h) cam.y = b.y + b.h / 2;
  else cam.y = Math.max(b.y + halfH, Math.min(b.y + b.h - halfH, cam.y));
  return cam;
}

export function resizeCamera(cam, w, h) {
  cam.viewW = Math.max(1, w);
  cam.viewH = Math.max(1, h);
  return clampCamera(cam);
}

export function worldToScreen(cam, wx, wy) {
  return { x: (wx - cam.x) * cam.zoom + cam.viewW / 2, y: (wy - cam.y) * cam.zoom + cam.viewH / 2 };
}

export function screenToWorld(cam, sx, sy) {
  return { x: (sx - cam.viewW / 2) / cam.zoom + cam.x, y: (sy - cam.viewH / 2) / cam.zoom + cam.y };
}

/** Feld unter einem Bildschirmpunkt (ganzzahlig, kann ausserhalb der Karte liegen). */
export function screenToCell(cam, sx, sy) {
  const w = screenToWorld(cam, sx, sy);
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

/** Sichtbarer Weltausschnitt. */
export function visibleRect(cam) {
  const w = cam.viewW / cam.zoom, h = cam.viewH / cam.zoom;
  return { x: cam.x - w / 2, y: cam.y - h / 2, w, h };
}

/** Um Bildschirmpixel verschieben (Ziehen nach rechts bewegt die Karte nach rechts). */
export function panBy(cam, dx, dy) {
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
  return clampCamera(cam);
}

/** Zoomen um Faktor, der Weltpunkt unter (sx, sy) bleibt stehen. */
export function zoomAt(cam, factor, sx, sy) {
  const before = screenToWorld(cam, sx, sy);
  cam.zoom *= factor;
  clampCamera(cam);
  const after = screenToWorld(cam, sx, sy);
  cam.x += before.x - after.x;
  cam.y += before.y - after.y;
  return clampCamera(cam);
}

/** Auf einen Weltpunkt zentrieren, optional mit Zoom. */
export function centerOn(cam, wx, wy, zoom = cam.zoom) {
  cam.x = wx;
  cam.y = wy;
  cam.zoom = zoom;
  return clampCamera(cam);
}

/** Canvas-Transformation fuer Weltkoordinaten (dpr = Geraetepixel pro CSS-Pixel). */
export function applyCameraTransform(ctx, cam, dpr = 1) {
  const z = cam.zoom * dpr;
  ctx.setTransform(z, 0, 0, z, (cam.viewW / 2 - cam.x * cam.zoom) * dpr, (cam.viewH / 2 - cam.y * cam.zoom) * dpr);
}

/**
 * Bedienung: Ziehen (Maus, Finger), Pinch mit zwei Fingern, Mausrad und Trackpad-Pinch (ctrlKey),
 * Pfeiltasten und + / - (am Element oder am Fenster), Doppelklick zoomt hinein (mit der Maus; mit dem Finger nicht). Nach dem Loslassen gleitet die Karte kurz nach.
 * onChange() wird nach jeder Kamerabewegung gerufen, onTap({x,y,touch}) bei Antippen ohne Ziehen (Bildschirmkoordinaten,
 * touch = mit dem Finger, also ohne vorheriges Hover),
 * onHover({x,y}|null) bei Mausbewegung.
 */
export function attachCameraControls(el, cam, { onChange = () => {}, onTap = () => {}, onHover = () => {}, keyTarget = window } = {}) {
  const pointers = new Map();
  let pinch = null, dragMoved = 0, last = null, vel = { x: 0, y: 0 }, glide = 0, downAt = null;
  let lastType = 'mouse';
  const local = (e) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const stopGlide = () => { if (glide) cancelAnimationFrame(glide); glide = 0; };
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };

  const down = (e) => {
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    stopGlide();
    lastType = e.pointerType;
    el.setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) { dragMoved = 0; last = { ...p, t: e.timeStamp }; vel = { x: 0, y: 0 }; downAt = { ...p, touch: e.pointerType === 'touch' || e.pointerType === 'pen' }; }
    if (pointers.size === 2) { pinch = pinchState(); dragMoved = 99; vel = { x: 0, y: 0 }; }
  };
  const move = (e) => {
    const p = local(e);
    if (!pointers.has(e.pointerId)) { if (e.pointerType === 'mouse') onHover(p); return; }
    pointers.set(e.pointerId, p);
    if (pointers.size >= 2 && pinch) {
      const now = pinchState();
      zoomAt(cam, now.dist / pinch.dist, now.mid.x, now.mid.y);
      panBy(cam, now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
      pinch = now;
      onChange();
      return;
    }
    if (pointers.size === 1 && last) {
      const dx = p.x - last.x, dy = p.y - last.y;
      dragMoved += Math.abs(dx) + Math.abs(dy);
      if (dragMoved > 6) {
        panBy(cam, dx, dy);
        const dt = Math.max(1, e.timeStamp - last.t);
        vel = { x: (dx / dt) * 0.6 + vel.x * 0.4, y: (dy / dt) * 0.6 + vel.y * 0.4 };
        onChange();
      }
      last = { ...p, t: e.timeStamp };
      if (e.pointerType === 'mouse') onHover(p);
    }
  };
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) { pinch = null; vel = { x: 0, y: 0 }; const [p] = pointers.values(); last = { ...p, t: e.timeStamp }; return; }
    if (pointers.size === 2) pinch = pinchState(); // von drei auf zwei Finger: neues Paar
    if (pointers.size > 0) return;
    // Wer vor dem Loslassen stillhaelt, will nicht gleiten
    if (last && e.timeStamp - last.t > 80) vel = { x: 0, y: 0 };
    pinch = null;
    if (e.type === 'pointerup' && dragMoved <= 6 && downAt) onTap(downAt);
    else if (Math.hypot(vel.x, vel.y) > 0.15 && e.type === 'pointerup') {
      // Nachgleiten, klingt in etwa 300 ms ab
      const sp = Math.hypot(vel.x, vel.y) * 16, k = sp > 40 ? 40 / sp : 1;
      let v = { x: vel.x * 16 * k, y: vel.y * 16 * k };
      const step = () => {
        v = { x: v.x * 0.88, y: v.y * 0.88 };
        panBy(cam, v.x, v.y);
        onChange();
        glide = Math.hypot(v.x, v.y) > 0.4 ? requestAnimationFrame(step) : 0;
      };
      glide = requestAnimationFrame(step);
    }
    last = null;
    downAt = null;
  };
  // Rad: Maus (ganze Schritte, keine Seitwaerts-Bewegung) zoomt, Trackpad (Bruchteile oder seitwaerts) verschiebt,
  // Strg oder Trackpad-Pinch zoomt immer. Die Art wird je Geste einmal bestimmt und 200 ms beibehalten.
  let wheelMode = null, wheelAt = 0;
  const wheel = (e) => {
    e.preventDefault();
    stopGlide();
    const p = local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.timeStamp - wheelAt > 200) wheelMode = null;
    wheelAt = e.timeStamp;
    if (e.ctrlKey) zoomAt(cam, Math.exp(-e.deltaY * unit * 0.01), p.x, p.y);
    else {
      if (!wheelMode) wheelMode = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY)) ? 'pan' : 'zoom';
      if (wheelMode === 'pan') panBy(cam, -e.deltaX, -e.deltaY);
      else zoomAt(cam, Math.exp(-e.deltaY * unit * 0.0015), p.x, p.y);
    }
    onChange();
  };
  const dbl = (e) => {
    // Mit dem Finger heisst zweimal Tippen "Ziel bestaetigen" (Gefecht), gezoomt wird dort mit zwei Fingern
    if (lastType === 'touch' || lastType === 'pen') return;
    const p = local(e);
    zoomAt(cam, e.shiftKey ? 0.5 : 2, p.x, p.y);
    onChange();
  };
  const key = (e) => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return; // Browser-Zoom und Kuerzel nicht schlucken
    const stepPx = 60;
    const c = { x: cam.viewW / 2, y: cam.viewH / 2 };
    switch (e.key) {
      case 'ArrowLeft': panBy(cam, stepPx, 0); break;
      case 'ArrowRight': panBy(cam, -stepPx, 0); break;
      case 'ArrowUp': panBy(cam, 0, stepPx); break;
      case 'ArrowDown': panBy(cam, 0, -stepPx); break;
      case '+': case '=': zoomAt(cam, 1.25, c.x, c.y); break;
      case '-': case '_': zoomAt(cam, 0.8, c.x, c.y); break;
      default: return;
    }
    e.preventDefault();
    onChange();
  };
  const leave = (e) => { if (e.pointerType === 'mouse') onHover(null); }; // ein abgehobener Finger 'verlaesst' das Element, ohne zu hovern

  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('dblclick', dbl);
  keyTarget.addEventListener('keydown', key);
  return () => {
    stopGlide();
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('dblclick', dbl);
    keyTarget.removeEventListener('keydown', key);
  };
}
