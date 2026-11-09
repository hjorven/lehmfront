// Grundausbildung im Gefecht (?scene=gefecht&ausbildung=1): ein Zettel fuehrt Schritt fuer Schritt durch die
// erste Partie. Die Schritte stehen in js/config/drill.js; hier nur der Zettel, der Bleistiftkringel um das
// Bedienelement und das Weiterschalten, sobald der Schritt auf der Karte geschafft ist.
import { ensureCss, esc } from './dom.js';
import { playSfx } from '../audio/engine.js';
import { DRILL_STEPS, DRILL_LEVEL, drillUnlocks, readDrill, writeDrill } from '../config/drill.js';
import { raiseLevel, UNLOCK_SEEN_KEY } from '../unlocks.js';

const TICK_MS = 350;

function snapshot(api) {
  return { turn: api.state.turn, cam: { x: api.cam.x, y: api.cam.y, zoom: api.cam.zoom } };
}

/**
 * attachDrill({ ui, root, api, steps?, startAt? }) haengt den Zettel ein (startAt: Schritt ab 0, fuer Bilder). api ist die Schnittstelle des Gefechts
 * (state, book, side, selected, cam, toolInfo, plans). Rueckgabe { get index, go(i), destroy() }.
 */
export function attachDrill({ ui, root, api, steps = DRILL_STEPS, startAt = null }) {
  ensureCss('css/drill.css');
  root.classList.add('drilling');
  const saved = readDrill();
  // Fortsetzen: die Grundausbildung beginnt immer mit einem frischen Gefecht. Schritte, die einen Spielstand
  // voraussetzen (nach "Runde ausfuehren"), gelten dann nicht mehr: zurueck bis vor den ersten davon.
  const firstNeedsTurn = steps.findIndex((s) => s.id === 'runde');
  let index = Number.isInteger(startAt) ? Math.min(startAt, steps.length - 1)
    : saved && !saved.done && Number.isInteger(saved.step) ? Math.min(saved.step, firstNeedsTurn >= 0 ? firstNeedsTurn : steps.length - 1, steps.length - 1) : 0;
  let start = snapshot(api);
  let marked = null;
  let passing = false;

  const card = document.createElement('section');
  card.className = 'card dr-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Grundausbildung');
  ui.append(card);

  function mark(sel) {
    marked?.classList.remove('dr-target');
    marked = null;
    if (!sel) return;
    const el = ui.querySelector(sel) ?? root.querySelector(sel);
    if (el && el.getClientRects().length) { el.classList.add('dr-target'); marked = el; }
  }

  // Befehle und Kaertchen erscheinen erst, wenn der Zettel sie vorstellt
  function unlock() {
    const u = drillUnlocks(steps, index);
    api.allowTools?.(u.tools);
    for (const k of ['check', 'lehrling']) root.classList.toggle('dr-show-' + k, u.show.includes(k));
    try {
      const seen = JSON.parse(localStorage.getItem(UNLOCK_SEEN_KEY) ?? '[]');
      localStorage.setItem(UNLOCK_SEEN_KEY, JSON.stringify([...new Set([...(Array.isArray(seen) ? seen : []), ...u.tools])]));
    } catch { /* ohne Speicher */ }
    if (steps[index].final) raiseLevel(DRILL_LEVEL);
  }

  function render() {
    const s = steps[index];
    unlock();
    const auto = !s.manual && !s.final && s.done;
    card.innerHTML = `<header><span class="dr-k">Grundausbildung · ${index + 1} von ${steps.length}</span>
        <button type="button" class="dr-mini" aria-label="Zettel ein- oder ausklappen" aria-expanded="${!card.classList.contains('dr-min')}">${card.classList.contains('dr-min') ? '+' : '–'}</button>
        <button type="button" class="dr-x" aria-label="Grundausbildung beenden" title="Beenden">×</button></header>
      <b class="dr-title">${esc(s.title)}</b>
      <p class="dr-text">${esc(s.text)}</p>
      <span class="dr-from">– ${esc(s.von)}</span>
      <div class="dr-progress" aria-hidden="true">${steps.map((_, i) => `<i class="${i < index ? 'done' : i === index ? 'now' : ''}"></i>`).join('')}</div>
      <footer>${index > 0 ? '<button type="button" class="btn dr-back">Voriger Schritt</button>' : ''}
        ${s.final
          ? `<a class="btn dr-go" href="?scene=feldzug">Zur Kampagne</a><a class="btn" href="?scene=handbuch">Handbuch</a><button type="button" class="btn dr-stay">Weiterspielen</button>`
          : auto ? `<span class="dr-wait">Auf der Karte erledigen</span><button type="button" class="btn dr-skip">Überspringen</button>`
            : '<button type="button" class="btn dr-next dr-go">Weiter</button>'}</footer>`;
    mark(s.anchor);
    place();
    writeDrill({ step: index, done: !!(saved?.done || s.final) });
  }

  function go(i) {
    index = Math.max(0, Math.min(steps.length - 1, i));
    start = snapshot(api);
    passing = false;
    render();
  }

  card.addEventListener('click', (e) => {
    if (e.target.closest('.dr-x')) { close(); return; }
    if (e.target.closest('.dr-mini')) { card.classList.toggle('dr-min'); render(); return; }
    if (e.target.closest('.dr-back')) { go(index - 1); return; }
    if (e.target.closest('.dr-next') || e.target.closest('.dr-skip')) { playSfx('paper', { intensity: 0.3 }); go(index + 1); return; }
    if (e.target.closest('.dr-stay')) { writeDrill({ step: index, done: true }); close(); }
  });
  // Enter gehoert dem Gefecht ("Runde ausfuehren"); der Zettel reagiert nur auf Klicks und Tippen

  // Schmale Schirme: das Schild der Gruppe dockt unten an; der Zettel setzt sich darueber statt auf die Karte oben
  function place() {
    const shield = ui.querySelector('.shield');
    const narrow = ui.clientWidth <= 700;
    const box = ui.getBoundingClientRect();
    if (!narrow) {
      // Breit: Werkzeughinweise und Meldungen stehen oben links (.hint); der Zettel rutscht darunter
      const hint = ui.querySelector('.hint');
      const hb = hint && !hint.hidden && hint.getClientRects().length ? hint.getBoundingClientRect() : null;
      card.style.top = hb ? `${Math.round(hb.bottom - box.top + 8)}px` : '';
      card.style.bottom = '';
      return;
    }
    card.style.top = '';
    if (!shield || shield.hidden || !shield.getClientRects().length) { card.style.bottom = ''; return; }
    const top = shield.getBoundingClientRect().top - box.top;
    card.style.bottom = `${Math.max(88, ui.clientHeight - top + 6)}px`;
  }

  const timer = setInterval(() => {
    place();
    const s = steps[index];
    if (passing || !s?.done || s.final || s.manual) return; // Schritte mit "Weiter" schaltet nur der Spieler
    let ok = false;
    try { ok = !!s.done(api, start); } catch { ok = false; }
    if (!ok) return;
    // geschafft: kurzer Haken mit Bleistift, dann der naechste Schritt
    passing = true;
    card.classList.add('dr-passed');
    card.classList.remove('dr-min');
    playSfx('pencil', { count: 2, intensity: 0.25 });
    setTimeout(() => { card.classList.remove('dr-passed'); go(index + 1); }, 700);
  }, TICK_MS);

  // Kringel nachziehen, wenn sich die Werkzeugreihe neu aufbaut
  const remark = setInterval(() => { const s = steps[index]; if (s?.anchor && (!marked || !marked.isConnected)) mark(s.anchor); }, 1000);

  function close() {
    clearInterval(timer);
    clearInterval(remark);
    marked?.classList.remove('dr-target');
    card.remove();
    root.classList.remove('drilling');
  }

  render();
  return { get index() { return index; }, go, destroy: close };
}
