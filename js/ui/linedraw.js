// Linie auf der Karte zeichnen (P04, Plan 7.4 "Graben zeichnen"). Wiederverwendbar fuer Graben, Umbauen,
// spaeter Draht und Feuerwalze. Legt eine Zeichenflaeche ueber die Karte (unter alle Kaertchen):
// ein Finger oder die Maus zeichnet, zwei Finger verschieben und zoomen, das Mausrad zoomt.
//   const s = startLineDraw(host, cam, { onDraw(points, done), onCamera() })
//   points: Weltkoordinaten [{x,y}], done: true beim Loslassen. s.destroy() entfernt die Flaeche.
import { screenToWorld, zoomAt, panBy } from '../render/camera.js';

export function startLineDraw(host, cam, { onDraw = () => {}, onCamera = () => {}, label = 'Linie zeichnen' } = {}) {
  const el = document.createElement('div');
  el.className = 'ld-surface';
  el.setAttribute('aria-label', label);
  host.prepend(el);
  const pointers = new Map();
  let points = null, pinch = null, started = false;
  const local = (e) => { const r = el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  };
  const down = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, local(e));
    if (pointers.size === 1) {
      // Erst melden, wenn sich der Finger bewegt oder losgelassen wird: ein zweiter Finger (Pinch)
      // soll die vorige Linie nicht durch ein einzelnes Feld ersetzen
      const p = local(e);
      points = [screenToWorld(cam, p.x, p.y)];
      started = false;
    } else if (pointers.size === 2) {
      // Zweiter Finger: Strich verwerfen, Karte bewegen
      if (started) onDraw(null, false);
      points = null;
      started = false;
      pinch = pinchState();
    }
  };
  const move = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, local(e));
    if (pointers.size >= 2 && pinch) {
      const now = pinchState();
      zoomAt(cam, now.dist / pinch.dist, now.mid.x, now.mid.y);
      panBy(cam, now.mid.x - pinch.mid.x, now.mid.y - pinch.mid.y);
      pinch = now;
      onCamera();
      return;
    }
    if (points) {
      const p = local(e);
      const w = screenToWorld(cam, p.x, p.y);
      const last = points[points.length - 1];
      if (Math.abs(w.x - last.x) + Math.abs(w.y - last.y) > 0.08) {
        points.push(w);
        if (started || Math.abs(w.x - points[0].x) + Math.abs(w.y - points[0].y) > 0.35) {
          started = true;
          onDraw(points, false);
        }
      }
    }
  };
  const up = (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0 && points) {
      const done = points;
      points = null;
      started = false;
      if (e.type === 'pointerup') onDraw(done, true);
      else onDraw(null, false);
    }
  };
  const wheel = (e) => {
    e.preventDefault();
    const p = local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || Number.isInteger(e.deltaY) && !e.deltaX) zoomAt(cam, Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.0015)), p.x, p.y);
    else panBy(cam, -e.deltaX, -e.deltaY);
    onCamera();
  };
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return {
    el,
    destroy() { el.remove(); },
  };
}
