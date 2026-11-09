// Schild am gewaehlten Objekt (Plan 7.2): kleines Kaertchen ueber der Gruppe, folgt der Kamera.
// Mit Finger (anchor.dock) liegt es angedockt am linken Rand statt ueber oder unter der Gruppe, damit die
// Felder noerdlich und suedlich frei bleiben; es weicht nach oben oder rechts aus, wenn die Gruppe dahinter liegt.
// anchor.compact: nur Kopf, Befehl und Vorschau (beim Zielen sind Staerke und Moral Nebensache).
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
    el.classList.toggle('compact', !!anchor.compact);
    if (!anchor.compact && el.offsetHeight > vh - anchor.safeTop - anchor.safeBottom) el.classList.add('compact');
    el.classList.toggle('docked', !!anchor.dock);
    if (anchor.dock) { dock(vw, vh); return; }
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

  // Angedockt: unten links ueber der Werkzeugreihe; liegt die Gruppe oder ein Kaertchen (anchor.avoid) dahinter,
  // oben links, dann rechts. Der Abstand zur Gruppe waechst mit dem Zoom, damit ihre Nachbarfelder frei bleiben.
  function dock(vw, vh) {
    const w = el.offsetWidth, h = el.offsetHeight;
    const m = Math.max(36, anchor.h);
    const onGroup = (l, t) => anchor.x > l - m && anchor.x < l + w + m && anchor.y > t - m && anchor.y < t + h + m;
    const onCard = (l, t) => (anchor.avoid ?? []).some((r) => l < r.right && l + w > r.left && t < r.bottom && t + h > r.top);
    const lowTop = Math.max(anchor.safeTop, vh - h - anchor.safeBottom);
    // Liegt ein Kaertchen unten quer (Missionsnotiz auf dem Handy), darf das Schild direkt darueber sitzen
    const band = Math.min(...(anchor.avoid ?? []).filter((r) => r.top > vh / 2).map((r) => r.top));
    const aboveBand = Number.isFinite(band) ? Math.max(anchor.safeTop, band - h - 8) : lowTop;
    const spots = [[8, lowTop], [8, aboveBand], [8, anchor.safeTop], [vw - w - 8, lowTop], [vw - w - 8, aboveBand], [vw - w - (anchor.safeRight ?? 8), anchor.safeTop]];
    const [left, top] = spots.find(([l, t]) => !onGroup(l, t) && !onCard(l, t)) ?? spots.find(([l, t]) => !onGroup(l, t)) ?? spots[0];
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.classList.remove('below', 'far');
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
