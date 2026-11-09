// Phasenfilm als Oberflaeche (P07, Plan 3.4 Punkt 4, 7.5, Bild feature-02): Reiter je Phase, "Weiter" pro
// Phase, Durchlaufen, Ueberspringen und eine Zeitleiste zum Scrubbing. Die Zwischenstaende rechnet js/film.js
// aus dem Startzustand neu; hier nur Abspielen, Darstellung und Tastatur.
// requestAnimationFrame und performance.now dienen nur der Optik.
import { phasesFor } from '../phases/registry.js';
import { replayTo, tracksBetween, trackPos, trackUpTo, sectionAt, transitionAt, clockDuring, linesUntil, nextStop, TIMING } from '../film.js';
import { viewFor } from '../view.js';
import { applyTheme, themeAt } from '../theme.js';
import { clockText } from './labels.js';
import { esc, reducedMotion } from './dom.js';
import { cueEvents, cueSection } from '../audio/director.js';

/**
 * Haken fuer den Tag-Nacht-Uebergang in der letzten Sekunde des Films (Plan 7.7).
 * P10 tauscht die Optik mit setTransitionHook(fn) aus. fn({ t, from, to }) wird mit t von 0 bis 1 gerufen,
 * from/to sind die Dunkelheit vor und nach der Runde. t = 1 kommt immer genau einmal am Ende.
 */
let transitionHook = ({ t, from, to }) => applyTheme(themeAt(from + (to - from) * t));
export function setTransitionHook(fn) {
  transitionHook = fn;
}

const AUTO_KEY = 'lehmfront.film.auto';
function readAuto() {
  try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; }
}
function writeAuto(v) {
  try { localStorage.setItem(AUTO_KEY, v ? '1' : '0'); } catch { /* egal */ }
}

/** Bewegung laeuft in den ersten 85 % eines Abschnitts, danach steht das Bild kurz */
const MOVE_SHARE = 0.85;

/**
 * createFilmPlayer(root, { onFrame(frame), onEnd(), onLines(n, typing) })
 * frame = { state, groups: [Gruppe mit pos (Kommastellen)], trails, t, section, f }
 */
export function createFilmPlayer(root, { onFrame, onEnd, onLines }) {
  const el = document.createElement('section');
  el.className = 'film card';
  el.hidden = true;
  el.setAttribute('aria-label', 'Phasenfilm');
  root.append(el);

  let film = null, input = null, result = null, side = 'a';
  let snaps = new Map(), tracks = new Map();
  let t = 0, playing = false, stopAt = 0, raf = 0, last = 0, auto = readAuto();
  let trans = null, lastK = 0, lastLines = -1, lastSection = -1, title = '';

  function snap(n) {
    if (!snaps.has(n)) snaps.set(n, replayTo(input, n).state);
    return snaps.get(n);
  }
  // Ein Abschnitt beginnt dort, wo der vorige gezeigte endete: weggelassene Phasen ohne sichtbares
  // Ereignis laufen im naechsten Abschnitt mit, damit nichts springt.
  const startOf = (i) => (i === 0 ? 0 : film.sections[i - 1].upto);
  function sectionStates(i) {
    return { a: snap(startOf(i)), b: snap(film.sections[i].upto) };
  }
  function sectionTracks(i) {
    if (!tracks.has(i)) {
      const { a, b } = sectionStates(i);
      const ids = new Set(phasesFor(input.state.turnKind, input.env?.phases).slice(startOf(i), film.sections[i].upto).map((p) => p.id));
      const events = result.log.filter((e) => ids.has(e.phase));
      tracks.set(i, tracksBetween(a, b, events, [...input.ordersA, ...input.ordersB]));
    }
    return tracks.get(i);
  }

  function frameAt(time) {
    const { index, f } = sectionAt(film.sections, time);
    const { a, b } = sectionStates(index);
    const fm = Math.min(1, f / MOVE_SHARE);
    const base = f >= 1 ? b : a;
    const vis = viewFor(fm >= 0.5 ? b : a, [], side, input.env ?? {});
    const shownIds = new Set(vis.groups.map((g) => g.id));
    const cur = sectionTracks(index);
    // Fremde Gruppen nur so viel wie in der normalen Sicht (viewFor): Ort und Art, keine Staerke
    const groups = base.groups.filter((g) => shownIds.has(g.id)).map((g) => {
      const tr = cur.get(g.id);
      const shown = g.side === side ? g
        : { id: g.id, side: g.side, type: g.type, pos: g.pos, status: g.status, inDugout: g.inDugout, seen: true };
      return tr ? { ...shown, pos: trackPos(tr, fm) } : shown;
    });
    // Spuren nur der eigenen Gruppen (fremde Wege verraten, wo der Gegner ungesehen war):
    // alle bisherigen Abschnitte ganz, der laufende bis jetzt
    const own = new Set(base.groups.filter((g) => g.side === side).map((g) => g.id));
    const trails = new Map();
    for (let i = 0; i <= index; i++) {
      for (const [id, tr] of sectionTracks(i)) {
        if (!own.has(id)) continue;
        const part = i < index ? tr : trackUpTo(tr, fm);
        const g = base.groups.find((x) => x.id === id);
        const prev = trails.get(id);
        trails.set(id, { id, side: g?.side ?? 'a', pts: prev ? [...prev.pts, ...part.slice(1)] : part });
      }
    }
    return { state: base, groups, trails: [...trails.values()], t: time, section: index, f };
  }

  function render() {
    if (!film) return;
    const fr = frameAt(t);
    onFrame(fr);
    const n = linesUntil(film, t);
    if (n !== lastLines) {
      // Klang nur beim Abspielen, nicht beim Scrubbing (P19)
      if (playing && lastLines >= 0 && n > lastLines) cueEvents(film.lines.slice(lastLines, n), { side, state: fr.state });
      onLines(n, playing);
      lastLines = n;
    }
    // Uebergang in der letzten Sekunde
    // (auch beim Zurueckspulen: dann wieder Richtung Ausgangszustand)
    if (trans) {
      const k = transitionAt(film.total, t) ?? 0;
      if (k !== lastK) { transitionHook({ t: k, ...trans }); lastK = k; }
    }
    updateBar(fr);
  }

  function updateBar(fr) {
    const s = film.sections[fr.section];
    if (fr.section !== lastSection) {
      if (playing && lastSection >= 0) cueSection(s.key);
      el.querySelectorAll('.film-tab').forEach((b, i) => {
        b.classList.toggle('on', i === fr.section);
        b.setAttribute('aria-selected', String(i === fr.section));
      });
      lastSection = fr.section;
    }
    el.querySelector('.film-phase').textContent = `Phase: ${s.label}`;
    el.querySelector('.film-clock').textContent = clockText(clockDuring(film.clockBefore, film.clockAfter, film.total, t));
    const range = el.querySelector('.scrub');
    range.value = String(Math.round(t));
    range.style.setProperty('--p', `${film.total ? (t / film.total) * 100 : 100}%`);
    const play = el.querySelector('.play');
    const atEnd = t >= film.total;
    play.textContent = playing ? 'Pause' : atEnd ? 'Zur Karte' : t <= 0 ? 'Abspielen' : 'Weiter';
    play.setAttribute('aria-keyshortcuts', 'Enter Space');
  }

  function tick(ts) {
    raf = 0;
    if (!playing) return;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    t = Math.min(stopAt, t + dt);
    if (t >= stopAt) playing = false;
    render();
    if (playing) raf = requestAnimationFrame(tick);
    else if (t >= film.total) finish();
  }

  function playTo(target) {
    if (!film) return;
    stopAt = target;
    if (reducedMotion()) {
      t = target;
      playing = false;
      render();
      if (t >= film.total) finish();
      return;
    }
    playing = true;
    last = 0;
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function next() {
    if (!film) return;
    if (playing) { pause(); return; }
    if (t >= film.total) { finish(); return; }
    playTo(auto ? film.total : nextStop(film, t));
  }

  function pause() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    render();
  }

  function seek(time) {
    pause();
    t = Math.max(0, Math.min(film.total, time));
    render();
  }

  /** Ueberspringen: direkt zur letzten Sekunde, der Uebergang laeuft trotzdem sichtbar ab */
  function skip() {
    if (!film) return;
    const start = Math.max(t, film.total - TIMING.transition);
    seek(start);
    playTo(film.total);
  }

  function finish() {
    if (!film) return;
    if (trans && lastK !== 1) transitionHook({ t: 1, ...trans });
    onLines(film.lines.length, false);
    close();
    onEnd();
  }

  function close() {
    playing = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    film = null;
    el.hidden = true;
    window.removeEventListener('keydown', onKey, true);
  }

  function onKey(e) {
    if (!film || e.ctrlKey || e.metaKey || e.altKey) return;
    const tgt = e.target;
    if (tgt && /^(INPUT|TEXTAREA|SELECT)$/.test(tgt.tagName) && !tgt.classList.contains('scrub')) return;
    // Fokussierte Knoepfe (Filmleiste, Telegrammzeilen) behalten Enter und Leertaste fuer sich
    const onButton = tgt && tgt.tagName === 'BUTTON';
    if ((e.key === 'Enter' || e.key === ' ') && !onButton) {
      e.preventDefault(); e.stopPropagation();
      if (!e.repeat) next();
    } else if (e.key === 'Escape' && !tgt?.closest?.('.telegram')) {
      e.preventDefault(); e.stopPropagation();
      skip();
    } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !tgt?.classList?.contains('scrub')) {
      e.preventDefault(); e.stopPropagation();
      const { index } = sectionAt(film.sections, t);
      const s = film.sections;
      if (e.key === 'ArrowRight') seek(index + 1 < s.length ? s[index + 1].start : film.total);
      else seek(t > s[index].start + 50 ? s[index].start : s[Math.max(0, index - 1)].start);
    }
  }

  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.film-tab');
    if (tab) {
      const i = Number(tab.dataset.i);
      if (i >= film.sections.length) { seek(film.total); return; }
      seek(film.sections[i].start);
      playTo(nextStop(film, film.sections[i].start));
      return;
    }
    if (e.target.closest('.play')) next();
    else if (e.target.closest('.skip')) skip();
    else if (e.target.closest('.auto')) {
      auto = !auto;
      writeAuto(auto);
      e.target.closest('.auto').setAttribute('aria-pressed', String(auto));
      if (playing && auto) playTo(film.total);
    }
  });
  el.addEventListener('input', (e) => {
    if (e.target.classList.contains('scrub')) seek(Number(e.target.value));
  });

  return {
    el,
    get open() { return !!film; },
    get time() { return t; },
    /**
     * Film starten. f = planFilm(...), inp = Eingabe der Runde, res = Ergebnis (state, log),
     * opts = { title, transition: { from, to } | null, start: Zeit in ms, paused }
     */
    play(f, inp, res, sd, opts = {}) {
      close();
      film = f; input = inp; result = res; side = sd;
      snaps = new Map(); tracks = new Map();
      trans = opts.transition && opts.transition.from !== opts.transition.to ? opts.transition : null;
      lastK = 0;
      lastLines = -1; lastSection = -1;
      title = opts.title ?? '';
      t = Math.max(0, Math.min(f.total, opts.start ?? 0));
      el.innerHTML = `
        <div class="film-head"><b class="film-title">${esc(title)}</b><span class="film-phase"></span><span class="film-clock" aria-label="Spieluhr"></span></div>
        <div class="film-tabs" role="tablist" aria-label="Phasen">${f.sections.map((s, i) =>
          `<button type="button" class="film-tab" role="tab" data-i="${i}">${esc(s.label)}</button>`).join('')}
          <button type="button" class="film-tab end" role="tab" data-i="${f.sections.length}">Telegramm</button></div>
        <div class="film-ctrl">
          <button type="button" class="btn play"></button>
          <input class="scrub" type="range" min="0" max="${f.total}" step="10" value="0" aria-label="Zeitleiste der Runde">
          <button type="button" class="btn auto" aria-pressed="${auto}" title="Ohne Halt bei jeder Phase">Durchlaufen</button>
          <button type="button" class="btn skip" aria-keyshortcuts="Escape">Überspringen <kbd>Esc</kbd></button>
        </div>`;
      el.hidden = false;
      window.addEventListener('keydown', onKey, true);
      render();
      if (!opts.paused) playTo(auto ? f.total : nextStop(f, t));
      el.querySelector('.play').focus({ preventScroll: true });
    },
    seek,
    pause,
    skip,
    next,
    /** Film abbrechen ohne Ende-Rueckruf (z. B. Szenenwechsel) */
    stop() { close(); },
  };
}
