// Papierebene: Blaetter liegen ueber der Karte, kippen mit Maus oder Neigungssensor, kommen beim Antippen
// nach vorn, lassen sich verschieben, wegwischen (landen in der Ablage) und, wenn sie eine Rueckseite haben,
// umdrehen. Telegramme koennen Zeile fuer Zeile getippt erscheinen; Hooks fuer den Klang (K1).
//
//   const paper = createPaperLayer(hostElement, { hooks: { onKey, onLine, onStamp } });
//   paper.add({ id: 'befehl-214', kind: 'telegram', ... }, { typed: true });
//
// Das Datenformat steht in js/ui/paper/README.md.
import { getKind, el } from './registry.js';
import './kinds/builtin.js';
import { placeSheet, clampToStage, tiltFromPointer, tiltFromOrientation, flingDecision, bringToFront, typingSchedule, visibleChars } from './layout.js';
import { paintAll } from './art.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createPaperLayer(host, opts = {}) {
  const hooks = opts.hooks || {};
  const call = (name, arg) => {
    try {
      hooks[name]?.(arg);
    } catch (e) {
      console.warn('Papierebene: Hook ' + name + ' fehlgeschlagen', e);
    }
  };
  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  const mqDark = matchMedia('(prefers-color-scheme: dark)');
  const still = () => opts.reducedMotion ?? mqReduce.matches;

  const layer = el('div', 'paper-layer');
  layer.setAttribute('role', 'region');
  layer.setAttribute('aria-label', 'Papiere');
  const pile = el('button', 'paper-pile', [el('span', 'paper-pile-stack'), el('span', 'paper-pile-label', 'Ablage'), el('span', 'paper-pile-count', '0')]);
  pile.type = 'button';
  pile.hidden = true;
  layer.append(pile);
  host.append(layer);

  const sheets = new Map();
  let order = [];
  const filed = []; // weggewischte Blaetter, zuletzt abgelegtes oben
  let placed = 0;
  let light = opts.light || 'auto';

  const stage = () => ({ w: layer.clientWidth, h: layer.clientHeight });

  function applyLight() {
    const night = light === 'night' || (light === 'auto' && mqDark.matches);
    layer.dataset.light = night ? 'night' : 'day';
    paintAll(layer);
  }
  const onScheme = () => light === 'auto' && applyLight();
  mqDark.addEventListener('change', onScheme);
  applyLight();

  function apply(s) {
    const st = s.node.style;
    st.setProperty('--x', s.pos.x + 'px');
    st.setProperty('--y', s.pos.y + 'px');
    st.setProperty('--rot', s.pos.rot + 'deg');
    st.setProperty('--rx', s.tilt.rx + 'deg');
    st.setProperty('--ry', s.tilt.ry + 'deg');
  }

  function restack() {
    order.forEach((id, i) => {
      const s = sheets.get(id);
      s.node.style.zIndex = String(10 + i);
      s.node.classList.toggle('is-front', i === order.length - 1);
    });
  }

  function updatePile() {
    pile.hidden = filed.length === 0;
    pile.querySelector('.paper-pile-count').textContent = String(filed.length);
    const last = filed[filed.length - 1];
    pile.setAttribute('aria-label', filed.length ? `Ablage, ${filed.length} Blätter. Antippen holt „${last.title}“ zurück` : 'Ablage leer');
    pile.dataset.count = String(Math.min(filed.length, 3));
  }

  function add(data, o = {}) {
    if (!data || !data.id) throw new Error('Blatt ohne id');
    if (sheets.has(data.id)) {
      front(data.id);
      return data.id;
    }
    // Liegt das Blatt in der Ablage, wird es von dort genommen statt verdoppelt
    const inPile = filed.findIndex((f) => f.data.id === data.id);
    if (inPile >= 0) {
      filed.splice(inPile, 1);
      updatePile();
    }
    const kind = getKind(data.kind);
    if (!kind) throw new Error('Unbekannte Blattart: ' + data.kind);
    const r = kind.render(data);
    const node = el('article', 'paper-sheet paper-' + data.kind);
    node.tabIndex = 0;
    node.dataset.id = data.id;
    node.setAttribute('aria-label', r.title || kind.label || data.kind);
    const inner = el('div', 'paper-inner', [el('div', 'paper-face paper-front', r.front)]);
    if (r.back) {
      inner.append(el('div', 'paper-face paper-back', r.back));
      node.classList.add('has-back');
      node.setAttribute('aria-description', 'Rückseite: Eingabetaste oder erneut antippen');
    }
    node.append(inner);
    layer.insertBefore(node, pile);
    paintAll(node);

    const size = { w: node.offsetWidth, h: node.offsetHeight };
    const auto = placeSheet(data.id, placed++, stage(), size);
    const pos = {
      x: o.x ?? auto.x,
      y: o.y ?? auto.y,
      rot: o.rot ?? auto.rot,
    };
    const s = { id: data.id, data, title: r.title, node, inner, size, pos, tilt: { rx: 0, ry: 0 }, flipped: false, typing: null, lines: r.typedLines || [] };
    sheets.set(data.id, s);
    order = [...order, data.id];
    apply(s);
    restack();
    bind(s);
    if (!still() && o.animate !== false) node.classList.add('paper-arrive');
    if (o.typed ?? data.typed) startTyping(s);
    call('onAdd', { sheetId: data.id, kind: data.kind });
    return data.id;
  }

  // ---------- Tippen ----------
  function startTyping(s) {
    if (!s.lines.length) return;
    if (still()) {
      call('onTyped', { sheetId: s.id });
      return;
    }
    const texts = s.lines.map((l) => l.dataset.text);
    const plan = typingSchedule(texts, { cps: opts.cps || 28 });
    const shown = plan.map(() => 0);
    s.lines.forEach((l) => {
      l.textContent = '';
      l.classList.add('is-typing');
    });
    s.node.classList.add('stamp-wait');
    const t0 = performance.now();
    const typing = { raf: 0, finish, stop };
    s.typing = typing;
    function frame(now) {
      const elapsed = now - t0;
      let all = true;
      plan.forEach((item, i) => {
        const n = visibleChars(item, elapsed);
        if (n > shown[i]) {
          for (let k = shown[i]; k < n; k++) call('onKey', { sheetId: s.id, char: item.text[k], line: i });
          s.lines[i].textContent = item.text.slice(0, n);
          s.lines[i].classList.toggle('is-caret', n < item.text.length);
          if (n === item.text.length) {
            s.lines[i].classList.remove('is-typing', 'is-caret');
            call('onLine', { sheetId: s.id, index: i, text: item.text });
          }
          shown[i] = n;
        }
        if (shown[i] < item.text.length) all = false;
      });
      if (all) finish();
      else typing.raf = requestAnimationFrame(frame);
    }
    // Abbrechen ohne Hooks, wenn das Blatt weggenommen wird (kein Stempelklang beim Wegwischen)
    function stop() {
      cancelAnimationFrame(typing.raf);
      if (s.typing === typing) s.typing = null;
    }
    function finish() {
      cancelAnimationFrame(typing.raf);
      if (s.typing !== typing) return;
      s.typing = null;
      s.lines.forEach((l) => {
        l.textContent = l.dataset.text;
        l.classList.remove('is-typing', 'is-caret');
      });
      s.node.classList.remove('stamp-wait');
      if (s.node.querySelector('.paper-stamp')) {
        s.node.classList.add('stamp-in');
        call('onStamp', { sheetId: s.id });
      }
      call('onTyped', { sheetId: s.id });
    }
    typing.raf = requestAnimationFrame(frame);
  }

  // ---------- Bedienung ----------
  function bind(s) {
    const { node } = s;
    let drag = null;

    node.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || drag) return;
      const wasFront = order[order.length - 1] === s.id;
      front(s.id);
      try {
        node.setPointerCapture(e.pointerId);
      } catch {}
      drag = { pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: s.pos.x, oy: s.pos.y, moved: false, wasFront, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    });

    node.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.pid) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (!drag.moved && dx * dx + dy * dy > 64) {
          drag.moved = true;
          node.classList.add('is-dragging');
        }
        drag.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
        while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 90) drag.samples.shift();
        if (!drag.moved) return;
        s.pos = { ...s.pos, x: drag.ox + dx, y: drag.oy + dy };
        // Das Blatt neigt sich in Zugrichtung, wie Papier, das durch die Luft gezogen wird
        if (!still()) {
          const a = drag.samples[0], b = drag.samples[drag.samples.length - 1];
          const ms = Math.max(16, b.t - a.t);
          s.tilt = { rx: clamp(((-(b.y - a.y) / ms) * 8) | 0, -14, 14), ry: clamp((((b.x - a.x) / ms) * 8) | 0, -14, 14) };
        }
        apply(s);
        return;
      }
      if (e.pointerType === 'mouse' && !still() && !drag) {
        const r = node.getBoundingClientRect();
        s.tilt = tiltFromPointer((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
        apply(s);
      }
    });

    const end = (e, cancelled) => {
      if (!drag || e.pointerId !== drag.pid) return;
      const d = drag;
      drag = null;
      node.classList.remove('is-dragging');
      if (e.pointerType !== 'mouse') askSensor(); // iOS: Erlaubnis nur aus einer abgeschlossenen Beruehrung
      if (!sheets.has(s.id)) return; // waehrend des Ziehens per Code abgelegt
      if (d.moved) {
        const a = d.samples[0], b = d.samples[d.samples.length - 1];
        const st = stage();
        const decision = cancelled
          ? { dismiss: false }
          : flingDecision({
              recent: { dx: b.x - a.x, dy: b.y - a.y, ms: e.timeStamp - a.t },
              center: { x: s.pos.x + s.size.w / 2, y: s.pos.y + s.size.h / 2 },
              stage: st,
            });
        if (decision.dismiss) {
          dismiss(s.id, { dirX: decision.dirX, dirY: decision.dirY });
          return;
        }
        s.pos = clampToStage(s.pos, st, s.size);
        s.tilt = { rx: 0, ry: 0 };
        apply(s);
        call('onMove', { sheetId: s.id, x: s.pos.x, y: s.pos.y });
        return;
      }
      if (cancelled) return;
      if (s.typing) s.typing.finish();
      else if (d.wasFront && s.node.classList.contains('has-back')) flip(s.id);
    };
    node.addEventListener('pointerup', (e) => end(e, false));
    node.addEventListener('pointercancel', (e) => end(e, true));
    node.addEventListener('pointerleave', () => {
      if (drag) return;
      s.tilt = { rx: 0, ry: 0 };
      apply(s);
    });

    // Mit Tab gewaehltes Blatt kommt nach vorn, sonst laege der Fokusrahmen auf einem verdeckten Blatt
    node.addEventListener('focus', () => {
      if (!drag && order[order.length - 1] !== s.id) front(s.id);
    });

    node.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 48 : 16;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const wasFront = order[order.length - 1] === s.id;
        front(s.id);
        if (s.typing) s.typing.finish();
        else if (wasFront && node.classList.contains('has-back')) flip(s.id);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dismiss(s.id, { dirX: 0, dirY: 1 });
        const next = order[order.length - 1];
        if (next) sheets.get(next).node.focus({ preventScroll: true });
        else pile.focus();
      } else if (moves[e.key]) {
        e.preventDefault();
        s.pos = clampToStage({ ...s.pos, x: s.pos.x + moves[e.key][0], y: s.pos.y + moves[e.key][1] }, stage(), s.size);
        apply(s);
      }
    });
  }

  // ---------- Neigungssensor ----------
  let sensorAsked = false, sensorOn = false, sensorRaf = 0, lastOrient = null;
  function onOrient(e) {
    lastOrient = e;
    if (sensorRaf) return;
    sensorRaf = requestAnimationFrame(() => {
      sensorRaf = 0;
      const t = still() ? { rx: 0, ry: 0 } : tiltFromOrientation(lastOrient.beta, lastOrient.gamma, 6, 40, screen.orientation?.angle ?? 0);
      layer.style.setProperty('--srx', t.rx + 'deg');
      layer.style.setProperty('--sry', t.ry + 'deg');
    });
  }
  function listenSensor() {
    if (sensorOn || opts.tiltSensor === false) return;
    sensorOn = true;
    addEventListener('deviceorientation', onOrient);
  }
  function askSensor() {
    if (sensorAsked || opts.tiltSensor === false || typeof DeviceOrientationEvent === 'undefined') return;
    // iOS fragt nach Erlaubnis, und nur aus einer Nutzeraktion; bei Fehler beim naechsten Antippen erneut
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      sensorAsked = true;
      DeviceOrientationEvent.requestPermission()
        .then((r) => (r === 'granted' ? listenSensor() : null))
        .catch(() => {
          sensorAsked = false;
        });
    }
  }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission !== 'function') listenSensor();

  // ---------- Aktionen ----------
  function front(id) {
    if (!sheets.has(id)) return;
    order = bringToFront(order, id);
    restack();
    call('onFront', { sheetId: id });
  }

  function flip(id) {
    const s = sheets.get(id);
    if (!s || !s.node.classList.contains('has-back')) return;
    s.flipped = !s.flipped;
    s.inner.classList.toggle('is-flipped', s.flipped);
    call('onFlip', { sheetId: id, flipped: s.flipped });
  }

  function detach(s) {
    if (s.typing) s.typing.stop();
    sheets.delete(s.id);
    order = order.filter((x) => x !== s.id);
    restack();
  }

  // Wegwischen: Blatt fliegt in Wurfrichtung hinaus und liegt danach in der Ablage
  function dismiss(id, dir = { dirX: 0, dirY: 1 }) {
    const s = sheets.get(id);
    if (!s) return;
    detach(s);
    filed.push({ data: s.data, title: s.title });
    updatePile();
    call('onDismiss', { sheetId: id, kind: s.data.kind });
    if (still()) {
      s.node.remove();
      return;
    }
    const st = stage();
    const far = Math.max(st.w, st.h) * 0.9;
    s.node.classList.add('paper-leave');
    s.pos = { x: s.pos.x + dir.dirX * far, y: s.pos.y + dir.dirY * far, rot: s.pos.rot + dir.dirX * 25 };
    s.tilt = { rx: -dir.dirY * 20, ry: dir.dirX * 20 };
    apply(s);
    setTimeout(() => s.node.remove(), 450);
  }

  function remove(id) {
    const s = sheets.get(id);
    if (!s) return;
    detach(s);
    s.node.remove();
  }

  function restore() {
    const item = filed.pop();
    updatePile();
    if (!item) return null;
    return add(item.data, { animate: true });
  }

  pile.addEventListener('click', () => {
    const id = restore();
    if (id) sheets.get(id)?.node.focus({ preventScroll: true });
  });

  function clear() {
    [...sheets.values()].forEach((s) => {
      detach(s);
      s.node.remove();
    });
    filed.length = 0;
    placed = 0;
    updatePile();
  }

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
        const st = stage();
        sheets.forEach((s) => {
          s.size = { w: s.node.offsetWidth, h: s.node.offsetHeight };
          // Nach dem Drehen des Handys moeglichst ganz sichtbar halten, nicht nur einen Rest
          const full = {
            ...s.pos,
            x: Math.max(0, Math.min(s.pos.x, st.w - s.size.w)),
            y: Math.max(0, Math.min(s.pos.y, st.h - s.size.h)),
          };
          s.pos = clampToStage(full, st, s.size);
          apply(s);
        });
      })
    : null;
  ro?.observe(layer);

  return {
    element: layer,
    add,
    remove,
    dismiss: (id) => dismiss(id),
    front,
    flip,
    restore,
    clear,
    ids: () => order.slice(),
    pileCount: () => filed.length,
    setLight(v) {
      light = v;
      applyLight();
    },
    destroy() {
      clear();
      ro?.disconnect();
      mqDark.removeEventListener('change', onScheme);
      if (sensorOn) removeEventListener('deviceorientation', onOrient);
      layer.remove();
    },
  };
}
