// Schild am gewaehlten Objekt (Plan 7.2): kleines Kaertchen ueber der Gruppe, folgt der Kamera.
export function createShield(root) {
  const el = document.createElement('section');
  el.className = 'card shield';
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  root.append(el);
  let anchor = null;

  function place() {
    if (!anchor || el.hidden) return;
    const vw = root.clientWidth, vh = root.clientHeight;
    // P18: Reicht der Platz zwischen Kopfleiste und Telegramm nicht, zeigt das Schild nur Kopf und Befehl
    el.classList.remove('compact');
    if (el.offsetHeight > vh - anchor.safeTop - anchor.safeBottom) el.classList.add('compact');
    const w = el.offsetWidth, h = el.offsetHeight;
    const gap = 12;
    let left = Math.round(anchor.x - w / 2);
    left = Math.max(8, Math.min(vw - w - 8, left));
    let top = Math.round(anchor.y - anchor.h / 2 - gap - h);
    let below = false;
    if (top < anchor.safeTop) {
      top = Math.round(anchor.y + anchor.h / 2 + gap + 6);
      below = true;
    }
    top = Math.max(anchor.safeTop, Math.min(vh - h - anchor.safeBottom, top));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.classList.toggle('below', below);
    // Zeiger zeigt auf die Gruppe, auch wenn das Schild am Rand anliegt
    el.style.setProperty('--tip', Math.max(14, Math.min(w - 14, anchor.x - left)) + 'px');
    // Liegt die Gruppe ausserhalb des Bildes, Zeiger weglassen
    el.classList.toggle('far', anchor.x < 0 || anchor.x > vw || anchor.y < 0 || anchor.y > vh);
  }

  return {
    el,
    show(markup, a) {
      el.innerHTML = markup;
      el.hidden = false;
      anchor = a;
      place();
    },
    move(a) { anchor = a; place(); },
    hide() { el.hidden = true; anchor = null; },
    get visible() { return !el.hidden; },
  };
}
