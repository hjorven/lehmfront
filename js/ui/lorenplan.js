// Lorenplan als Zug (Plan 7.4, Bild feature-04-lorenplan). Ein Fenster mit der Feldbahn: so viele Wagen,
// wie Loren je Stellungsrunde fahren. Antippen des Wagens wechselt die Ladung, der Kreis das Ziel.
// Verwundete fahren auf denselben Wagen zurueck (roter Kreis mit Pfeil).
// Ueberraschung: Die Wagen tragen Kreideaufschriften mit den Namen der Gruppen, die sie beliefern,
// und wer abgeschnitten ist, dem schreibt jemand "Weg zu" an den Wagen.
// Die Rechnung kommt aus planPreview (js/supply.js, rein); hier nur Anzeige und Eingabe.
import { esc, reducedMotion } from './dom.js';
import { LOADS, LOAD_CYCLE, CART_LOAD } from '../config/supply.js';
import { planPreview, sectionsOf, suggestPlan, capacityOf } from '../supply.js';
import { cellLabel } from '../map.js';

const RES = { ammo: 'Munition', food: 'Verpflegung', material: 'Material' };

function pl(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

/** Naechste Ladung im Fenster: nach der Sanitaetslore kommt "frei" (Wagen bleibt stehen) */
export function cycleLoad(w, firstSection) {
  if (!w) return { load: LOAD_CYCLE[0], to: firstSection };
  const i = LOAD_CYCLE.indexOf(w.load);
  return i === LOAD_CYCLE.length - 1 ? null : { ...w, load: LOAD_CYCLE[i + 1] };
}

/** Kreideaufschrift eines Wagens: wen er beliefert, wen er zurueckholt */
export function chalkFor(w, sec) {
  if (!w) return 'frei';
  if (w.blocked) return 'Weg zu';
  if (w.load === 'medic') return w.wounded ? `holt ${w.wounded} Verw.` : 'leer zurück';
  if (w.empty) return 'Depot leer';
  const names = sec.groups.map((g) => g.name).filter(Boolean);
  if (!names.length) return 'für ' + sec.id;
  return 'für ' + (names.length > 2 ? names.slice(0, 2).join(', ') + ' …' : names.join(', '));
}

/**
 * Fenster oeffnen. opts: { map, state, side, wagons, turn, onApply(wagons), onClose() }
 * Liefert { close, el }.
 */
export function openLorenplan(root, { map, state, side, wagons, onApply, onClose }) {
  const ids = sectionsOf(map).map((s) => s.id);
  const cap = capacityOf(state, side);
  // Arbeitskopie: genau cap Plaetze, null = Wagen bleibt stehen
  let slots = Array.from({ length: cap }, (_, i) => (wagons[i] ? { load: wagons[i].load, to: wagons[i].to } : null));
  const prevFocus = document.activeElement;

  const back = document.createElement('div');
  back.className = 'modal-back lorenplan-back';
  back.innerHTML = `<section class="modal card lorenplan" role="dialog" aria-modal="true" aria-labelledby="lp-title">
    <header class="lp-head"><b id="lp-title">Lorenplan</b><span class="lp-sub"></span>
      <button type="button" class="x" aria-label="Schließen ohne Übernehmen">×</button></header>
    <div class="lp-scroll">
      <div class="lp-yard">
        <div class="lp-stations" aria-hidden="true"></div>
        <ol class="lp-train" aria-label="Zug der Feldbahn"></ol>
        <div class="lp-rail" aria-hidden="true"></div>
      </div>
    </div>
    <div class="lp-cards"></div>
    <p class="lp-note"></p>
    <footer class="lp-foot">
      <button type="button" class="btn lp-suggest" aria-keyshortcuts="V">Vorschlag <small>V</small></button>
      <span class="lp-gap"></span>
      <button type="button" class="btn lp-cancel">Verwerfen <small>Esc</small></button>
      <button type="button" class="btn lp-apply">Plan übernehmen <small>Enter</small></button>
    </footer>
  </section>`;
  root.append(back);
  const box = back.firstElementChild;
  const $ = (s) => box.querySelector(s);
  const train = $('.lp-train');

  let closed = false;
  function close(apply) {
    if (closed) return;
    closed = true;
    back.remove();
    if (prevFocus && prevFocus.isConnected) prevFocus.focus?.({ preventScroll: true });
    if (apply) onApply(slots.filter(Boolean));
    else onClose();
  }

  function render(focus) {
    const pv = planPreview(map, state, side, slots.filter(Boolean));
    const secById = new Map(pv.sections.map((s) => [s.id, s]));
    // Planwagen den Plaetzen zuordnen (Luecken ueberspringen)
    let k = 0;
    const view = slots.map((w) => (w ? { ...pv.wagons[k++] } : null));
    $('.lp-sub').textContent = `${pl(cap, 'Lore', 'Loren')} je Stellungsrunde · ${CART_LOAD} Einheiten je Lore`;

    $('.lp-stations').innerHTML = `<span>Depot</span>` + pv.sections.map((s) => `<span class="${s.connected ? '' : 'cut'}">${esc(s.label)}</span>`).join('');

    train.innerHTML = `<li class="loco" aria-label="Feldbahn, ${pl(cap, 'Lore', 'Loren')}"><i class="stack"></i><b>Feldbahn</b><span>${pv.used}/${cap}</span><i class="wh"></i><i class="wh"></i></li>`
      + view.map((w, i) => {
        const n = i + 1;
        if (!w) {
          return `<li class="wagon free"><button type="button" class="w-body" data-i="${i}" aria-label="Lore ${n}: steht. Antippen belädt sie.">
            <b>frei</b></button><span class="chalk">steht</span><i class="wh"></i><i class="wh"></i></li>`;
        }
        const sec = secById.get(w.to);
        const L = LOADS[w.load];
        const back = w.wounded ? `<span class="w-back" title="${esc(pl(w.wounded, 'Verwundeter', 'Verwundete'))} zurück">←${esc(w.to)}</span>` : '';
        const label = `Lore ${n}: ${L.label}${w.blocked ? ', kommt nicht durch' : ''}${w.empty ? ', Depot leer' : ''}. Antippen wechselt die Ladung.`;
        return `<li class="wagon l-${w.load}${w.blocked ? ' blocked' : ''}${w.empty ? ' empty' : ''}">
          <button type="button" class="w-body" data-i="${i}" aria-label="${esc(label)}"><b>${esc(L.short)}</b></button>
          <button type="button" class="w-to" data-to="${i}" aria-label="Lore ${n}, Ziel ${esc(sec.label)}. Antippen wechselt das Ziel.">${esc(w.to)}</button>
          ${back}<span class="chalk${w.blocked ? ' strike' : ''}">${esc(chalkFor(w, sec))}</span><i class="wh"></i><i class="wh"></i></li>`;
      }).join('');

    $('.lp-cards').innerHTML = pv.sections.map((s) => {
      const parts = ['ammo', 'food', 'material'].map((r) => [r, s.delivered[r] ? Math.ceil(s.delivered[r] / CART_LOAD) : 0])
        .filter(([, c]) => c).map(([r, c]) => `${c} ${RES[r]}`);
      const blocked = s.blockedCarts ? `<p class="bad">${pl(s.blockedCarts, 'Lore kommt', 'Loren kommen')} nicht durch</p>` : '';
      const cut = s.connected ? '' : `<p class="bad cut">Abgeschnitten${s.cutAt ? ' bei ' + cellLabel(s.cutAt.x, s.cutAt.y) : ''}: ${esc(s.cutWhy)}</p>`;
      const rounds = s.upkeep.groups
        ? `<p class="lp-rounds">Vorrat reicht: Verpf. <b class="${s.rounds.food < 2 ? 'low' : ''}">${roundsText(s.rounds.food)}</b> · Mun. <b class="${s.rounds.ammo < 2 ? 'low' : ''}">${roundsText(s.rounds.ammo)}</b></p>`
        : '<p class="lp-rounds quiet">Keine Gruppe im Abschnitt</p>';
      const wnd = s.wounded
        ? `<p class="${s.woundedLeft ? 'bad' : 'red'}">${s.woundedBack ? pl(s.woundedBack, 'Verwundeter', 'Verwundete') + ' zurück' : ''}${s.woundedBack && s.woundedLeft ? ', ' : ''}${s.woundedLeft ? s.woundedLeft + ' ' + (s.woundedLeft === 1 ? 'wartet' : 'warten') + ' weiter' : ''}</p>` : '';
      return `<section class="card lp-card${s.connected ? '' : ' is-cut'}"><b class="lp-ct">${esc(s.label)}</b>
        <p>${parts.length ? esc(parts.join(' · ')) : '<span class="quiet">nichts geplant</span>'}${s.medicCarts ? ` <span class="red">· ${pl(s.medicCarts, 'Sanitätslore', 'Sanitätsloren')}</span>` : ''}</p>
        ${cut}${blocked}${wnd}${rounds}</section>`;
    }).join('') + `<section class="card lp-card cap"><b class="lp-ct">Kapazität</b>
        <p><b class="num">${pv.used} / ${cap}</b> Loren</p>
        <p>${pv.returning ? pl(pv.returning, 'zurück mit Verwundeten', 'zurück mit Verwundeten') : 'keine Verwundeten an Bord'}</p>
        <p class="lp-rounds">Depot danach: Mun. ${Math.max(0, pv.depot.ammo ?? 0)} · Verpf. ${Math.max(0, pv.depot.food ?? 0)} · Mat. ${Math.max(0, pv.depot.material ?? 0)}</p></section>`;

    const waiting = pv.sections.reduce((n, s) => n + s.woundedLeft, 0);
    $('.lp-note').textContent = `Kapazität dieser Stellungsrunde: ${pl(cap, 'Lore', 'Loren')}. Was nicht fährt, fehlt vorne.`
      + (waiting ? ` ${pl(waiting, 'Verwundeter bleibt', 'Verwundete bleiben')} liegen, das kostet Vertrauen.` : ' Verwundete, die nicht fahren, kosten Vertrauen.');

    if (focus) train.querySelector(focus)?.focus({ preventScroll: false });
  }

  function roundsText(n) {
    if (n === null) return '–';
    return n === 0 ? 'nicht mehr' : pl(n, 'Runde', 'Runden');
  }

  function wiggle(i) {
    if (reducedMotion()) return;
    const li = train.children[i + 1];
    li?.animate?.([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(2px)' }, { transform: 'translateX(0)' }], { duration: 220 });
  }

  train.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.i !== undefined) {
      const i = Number(b.dataset.i);
      slots[i] = cycleLoad(slots[i], ids[0]);
      render(`[data-i="${i}"]`);
      wiggle(i);
    } else if (b.dataset.to !== undefined) {
      const i = Number(b.dataset.to);
      const w = slots[i];
      if (!w) return;
      slots[i] = { ...w, to: ids[(ids.indexOf(w.to) + 1) % ids.length] };
      render(`[data-to="${i}"]`);
      wiggle(i);
    }
  });
  $('.x').addEventListener('click', () => close(false));
  $('.lp-cancel').addEventListener('click', () => close(false));
  $('.lp-apply').addEventListener('click', () => close(true));
  $('.lp-suggest').addEventListener('click', () => suggest());
  function suggest() {
    const s = suggestPlan(map, state, side);
    slots = Array.from({ length: cap }, (_, i) => s[i] ?? null);
    render();
  }

  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(false); });
  back.addEventListener('keydown', (e) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); return; }
    // Enter uebernimmt den Plan (auch auf einem Wagen; dort wechselt die Leertaste die Ladung),
    // nur auf Vorschlag, Verwerfen und Schliessen loest Enter den Knopf selbst aus
    const footBtn = e.target.closest?.('.lp-foot, .lp-head') && !e.target.classList.contains('lp-apply');
    if (e.key === 'Enter' && !footBtn) { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if ((e.key === 'v' || e.key === 'V' || e.key === 'l' || e.key === 'L') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'v' || e.key === 'V') suggest(); else close(false);
      return;
    }
    // Pfeile springen zwischen den Wagen
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && train.contains(e.target)) {
      e.preventDefault();
      const all = [...train.querySelectorAll('button')];
      const i = all.indexOf(e.target);
      all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
      return;
    }
    if (e.key === 'Tab') {
      const f = [...box.querySelectorAll('button:not([disabled])')];
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
    e.stopPropagation();
  });

  render();
  (train.querySelector('.w-body') ?? $('.lp-apply')).focus({ preventScroll: true });
  return { el: back, close: () => close(false), apply: () => close(true), suggest };
}
