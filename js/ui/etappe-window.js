// Etappenfenster im Gefecht (Plan 6, Mockup __f1): links das Pappmodell, rechts die Bauoptionen (Baustein aus E1,
// js/ui/etappe3d/). Hier nur der Rahmen: Arbeitskopie der Auftraege dieser Runde, Uebernehmen und Verwerfen.
// Die Auftraege werden erst in der naechsten Stellungsrunde ausgefuehrt (Phase etappe, js/phases/build.js).
import { esc } from './dom.js';
import { renderEtappe } from './etappe3d/index.js';
import { planView, plotName } from '../etappe-map.js';
import { BUILDINGS } from '../config/buildings.js';
import { MAX_BUILDS } from '../phases/build.js';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Fenster oeffnen. opts: { state, side, plan, focus?: {x,y}, night, title, onApply(plan), onClose() }
 * plan: { builds, repairs, reward } (Arbeitskopie wird angelegt). Liefert { close, el, win }.
 */
export function openEtappeWindow(root, { state, side, plan, focus = null, night = false, title = 'Etappe', onApply, onClose }) {
  const et = state.sides[side].etappe;
  const material = state.sides[side].supplies.material ?? 0;
  const act = (state.act | 0) || 1;
  let work = { builds: [...(plan?.builds ?? [])], repairs: [...(plan?.repairs ?? [])], reward: plan?.reward ?? null };
  let view = planView(et, work, material);
  let selected = focus && et.fields.some((f) => f.x === focus.x && f.y === focus.y) ? focus : defaultField(et);
  let note = '';
  const prevFocus = document.activeElement;

  const back = document.createElement('div');
  back.className = 'modal-back etappe-back';
  back.innerHTML = `<section class="modal card etw" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="etw-title">
    <header class="etw-head"><b id="etw-title">${esc(title)}</b><span class="etw-sub"></span>
      <button type="button" class="x" aria-label="Schließen ohne Übernehmen">×</button></header>
    <div class="etw-body"></div>
    <footer class="etw-foot">
      <span class="etw-orders" aria-live="polite"></span>
      <button type="button" class="btn etw-cancel">Verwerfen <small>Esc</small></button>
      <button type="button" class="btn etw-apply">Aufträge übernehmen <small>Enter</small></button>
    </footer>
  </section>`;
  root.append(back);
  const box = back.firstElementChild;
  const $ = (s) => box.querySelector(s);

  const win = renderEtappe($('.etw-body'), {
    ...props(),
    selected, act, night,
    onSelect: (x, y) => { selected = { x, y }; win.update({ selected }); },
    onBuild: (x, y, type) => {
      if (work.builds.length >= MAX_BUILDS) { note = `Höchstens ${MAX_BUILDS} Bauaufträge je Runde.`; changed(); return; }
      work = { ...work, builds: [...work.builds, { type, x, y }] };
      note = `${BUILDINGS[type].name} auf ${plotName(x, y)} vorgemerkt.`;
      changed();
    },
    onRepair: (id) => {
      if (work.repairs.includes(id)) return;
      work = { ...work, repairs: [...work.repairs, id] };
      note = 'Reparatur vorgemerkt.';
      changed();
    },
    onCancel: (id) => {
      if (id.startsWith('plan-')) {
        const i = Number(id.slice(5));
        work = { ...work, builds: work.builds.filter((_, k) => k !== i) };
      } else {
        work = { ...work, repairs: work.repairs.filter((r) => r !== id) };
      }
      note = 'Auftrag gestrichen.';
      changed();
    },
    onChooseReward: (level, id) => {
      work = { ...work, reward: { level, id } };
      note = 'Belohnung gewählt. Sie gilt ab der nächsten Stellungsrunde.';
      changed();
    },
  });

  function props() {
    return { fields: view.fields, buildings: view.buildings, rewards: view.rewards, best: view.best, material: view.material };
  }

  function changed() {
    view = planView(et, work, material);
    win.update(props());
    summary();
  }

  function summary() {
    const n = work.builds.length + work.repairs.length;
    $('.etw-sub').textContent = `Stellungsrunde ${state.turn} · Material im Depot ${material}`;
    const parts = [];
    if (work.builds.length) parts.push(plural(work.builds.length, 'Bauauftrag', 'Bauaufträge'));
    if (work.repairs.length) parts.push(plural(work.repairs.length, 'Reparatur', 'Reparaturen'));
    if (work.reward) parts.push('Belohnung');
    const text = n || work.reward ? `${parts.join(', ')} · ${view.cost} Material, bleiben ${view.material}` : 'Noch keine Aufträge. Feld antippen, Gebäude wählen.';
    $('.etw-orders').textContent = note ? `${note} ${text}` : text;
  }

  let closed = false;
  function close(apply) {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    win.destroy();
    back.remove();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus?.({ preventScroll: true });
    if (apply) onApply(work);
    else onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
    const t = e.target instanceof Element ? e.target : null;
    if (e.key === 'Tab') {
      // Fokus bleibt im Fenster (aria-modal)
      const list = [...box.querySelectorAll('button:not([disabled]), summary, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!list.length) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && (t === first || !box.contains(t))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (t === last || !box.contains(t))) { e.preventDefault(); first.focus(); }
      return;
    }
    // Enter uebernimmt, ausser auf Knoepfen und im Modell (dort waehlt Enter ein Feld)
    if (e.key === 'Enter' && !(t && t.closest('button, input, select, textarea, summary, a, .e3-stage'))) {
      e.preventDefault(); e.stopPropagation(); close(true);
    }
  }
  document.addEventListener('keydown', onKey, true);
  $('.x').addEventListener('click', () => close(false));
  $('.etw-cancel').addEventListener('click', () => close(false));
  $('.etw-apply').addEventListener('click', () => close(true));
  // Klick neben das Fenster schliesst nur, solange nichts vorgemerkt ist (sonst gingen Auftraege verloren)
  back.addEventListener('pointerdown', (e) => {
    if (e.target !== back) return;
    if (!work.builds.length && !work.repairs.length && !work.reward) close(false);
    else { note = 'Aufträge übernehmen oder verwerfen.'; summary(); }
  });
  summary();
  // Fokus aufs Modell: Pfeiltasten waehlen sofort ein Feld
  (box.querySelector('.e3-stage') ?? box).focus({ preventScroll: true });
  return { close: () => close(false), apply: () => close(true), el: box, win };
}

/** Erstes freies, baubares Feld nahe dem Depot (sonst das erste Feld) */
function defaultField(et) {
  const depot = et.buildings.find((b) => b.type === 'depot');
  if (!depot) return { x: et.fields[0].x, y: et.fields[0].y };
  const taken = new Set(et.buildings.map((b) => b.x + ',' + b.y));
  const free = et.fields.filter((f) => !taken.has(f.x + ',' + f.y) && !['wald', 'sumpf', 'wasser'].includes(f.ground));
  free.sort((a, b) => (Math.abs(a.x - depot.x) + Math.abs(a.y - depot.y)) - (Math.abs(b.x - depot.x) + Math.abs(b.y - depot.y)) || a.y - b.y || a.x - b.x);
  return free[0] ? { x: free[0].x, y: free[0].y } : { x: depot.x, y: depot.y };
}
