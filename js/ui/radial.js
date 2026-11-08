// Radiales Befehlsmenue (Plan 7.3, Bild feature-08): lang druecken auf eine Gruppe oeffnet die Befehle im
// Kreis um den Finger. Finger zum Befehl ziehen und loslassen waehlt ihn, ebenso spaeter Antippen.
import { esc, icon } from './dom.js';

export const RADIUS = 74;
export const ITEM = 66;

/** Positionen der Eintraege: oben beginnend im Uhrzeigersinn, Mittelpunkt bleibt im Bild */
export function radialLayout(n, cx, cy, vw, vh, r = RADIUS, item = ITEM) {
  const pad = r + item / 2 + 6;
  const x = Math.max(pad, Math.min(vw - pad, cx));
  const y = Math.max(pad, Math.min(vh - pad, cy));
  const out = [];
  const start = n === 2 ? -Math.PI * 0.75 : -Math.PI / 2;
  const step = n === 2 ? Math.PI / 2 : (Math.PI * 2) / Math.max(1, n);
  for (let i = 0; i < n; i++) {
    const a = start + i * step;
    out.push({ x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
  }
  return { x, y, items: out };
}

export function createRadial(root, { onPick, onClose }) {
  const el = document.createElement('div');
  el.className = 'radial';
  el.hidden = true;
  el.setAttribute('role', 'menu');
  root.append(el);
  let items = [];

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.close !== undefined) { onClose(); return; }
    const it = items[Number(b.dataset.i)];
    if (it && it.ok) onPick(it);
  });

  function itemAt(clientX, clientY) {
    const hit = document.elementFromPoint(clientX, clientY)?.closest('.radial-item');
    return hit && el.contains(hit) ? items[Number(hit.dataset.i)] : null;
  }

  return {
    el,
    get open() { return !el.hidden; },
    /** list: [{ id, label, icon, ok, why }] */
    show(list, cx, cy, center) {
      items = list;
      const L = radialLayout(list.length, cx, cy, root.clientWidth, root.clientHeight);
      el.style.left = L.x + 'px';
      el.style.top = L.y + 'px';
      el.setAttribute('aria-label', 'Befehle für ' + center);
      el.innerHTML = `<button type="button" class="radial-center" data-close aria-label="Schließen">${esc(center)}</button>`
        + list.map((it, i) => `<button type="button" role="menuitem" class="radial-item${it.ok ? '' : ' off'}${it.dark ? ' dark' : ''}" data-i="${i}"
          style="--dx:${L.items[i].x}px;--dy:${L.items[i].y}px" aria-disabled="${!it.ok}" title="${esc(it.ok ? it.label : it.why)}">
          ${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
      el.hidden = false;
      requestAnimationFrame(() => el.classList.add('shown'));
      el.querySelector('.radial-item:not(.off)')?.focus({ preventScroll: true });
    },
    hide() { el.hidden = true; el.classList.remove('shown'); items = []; },
    /** Waehrend der Finger noch liegt: Eintrag unter dem Finger hervorheben */
    hover(clientX, clientY) {
      const it = itemAt(clientX, clientY);
      el.querySelectorAll('.radial-item').forEach((b) => b.classList.toggle('hot', it != null && items[Number(b.dataset.i)] === it));
      return it;
    },
    itemAt,
  };
}
