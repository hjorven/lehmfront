// Kopf-Kaertchen, Hinweis, Rundenende-Checkliste, Overlays-Schalter (Plan 7.2).
// Desktop: Kaertchen an den Raendern wie Stil 01. Handy (hochkant): eine Leiste oben, die sich zur
// Seitenleiste wie Stil 07 aufklappt.
import { esc } from './dom.js';

export function createHud(root, { onToggleList, onToggleOverlay, onCheck, onToggleSheet, onRoundAction = () => {} }) {
  const el = document.createElement('div');
  el.className = 'hud';
  el.innerHTML = `
    <button class="hud-strip card" type="button" aria-expanded="false" aria-controls="hud-sheet">
      <span class="strip-vals"></span><span class="strip-clock" aria-hidden="true"></span><span class="strip-round"></span>
    </button>
    <div class="hud-sheet" id="hud-sheet">
      <div class="res-row">
        <section class="card res" data-k="carts"><span class="k">Loren</span><b class="v"></b></section>
        <section class="card res" data-k="ammo"><span class="k">Munition</span><b class="v"></b></section>
        <section class="card res" data-k="material"><span class="k">Material</span><b class="v"></b></section>
        <section class="card res" data-k="morale"><span class="k">Moral</span><b class="v"></b></section>
      </div>
      <section class="card axes" aria-label="Ansehen und Vertrauen">
        <div class="axis"><span>Ansehen beim Stab</span><b class="rep"></b><i class="bar"><i class="fill own"></i></i></div>
        <div class="axis"><span>Vertrauen der Truppe</span><b class="tru"></b><i class="bar"><i class="fill accent"></i></i></div>
      </section>
      <section class="card round" aria-live="polite"><span class="round-clock"></span><div class="round-text"><b class="round-title"></b><span class="round-sub"></span>
        <button type="button" class="btn round-act" hidden></button></div></section>
      <section class="card overlays" aria-label="Overlays">
        <span class="k">Overlays</span>
        <div class="ov-list"></div>
      </section>
      <section class="card check" aria-label="Vor der Runde">
        <span class="k">Vor der Runde</span>
        <ul class="check-list"></ul>
      </section>
    </div>
    <div class="hud-right">
      <button class="btn list-btn" type="button" aria-keyshortcuts="Tab"><span>Befehle</span> <b class="n"></b></button>
      <button class="btn ov-btn" type="button" aria-expanded="false" aria-haspopup="true">Overlays</button>
      <div class="card ov-pop" hidden><div class="ov-list"></div></div>
    </div>
    <section class="card hint" role="status" aria-live="polite" hidden><b class="hint-title"></b><span class="hint-text"></span></section>`;
  root.append(el);
  const $ = (s) => el.querySelector(s);

  const strip = $('.hud-strip');
  strip.addEventListener('click', () => onToggleSheet());
  $('.list-btn').addEventListener('click', () => onToggleList());
  $('.round-act').addEventListener('click', () => onRoundAction());
  const ovBtn = $('.ov-btn'), pop = $('.ov-pop');
  ovBtn.addEventListener('click', () => {
    pop.hidden = !pop.hidden;
    ovBtn.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) pop.querySelector('button')?.focus();
  });
  el.addEventListener('click', (e) => {
    const ov = e.target.closest('[data-ov]');
    if (ov) onToggleOverlay(Number(ov.dataset.ov));
    const ck = e.target.closest('[data-check]');
    if (ck) onCheck(Number(ck.dataset.check));
  });

  let lastChecks = [];
  let lastClock = null;
  const prev = {}, was = {}, wasTimer = {};
  const WAS_MS = 2600;
  let lastSide;
  return {
    el,
    closePopover() { pop.hidden = true; ovBtn.setAttribute('aria-expanded', 'false'); },
    get popoverOpen() { return !pop.hidden; },
    setSheet(open) {
      el.classList.toggle('open', open);
      strip.setAttribute('aria-expanded', String(open));
    },
    update(m) {
      const s = m.supplies;
      // Hotseat: die andere Seite darf die Zahlen der ersten nicht durchgestrichen sehen
      if (m.side !== lastSide) { lastSide = m.side; for (const k of Object.keys(prev)) delete prev[k]; for (const k of Object.keys(was)) delete was[k]; }
      // Bleistiftkorrektur (P19): aendert sich ein Wert, steht der alte kurz durchgestrichen davor
      const set = (k, v, num) => {
        const now = performance.now();
        if (num !== undefined && prev[k] !== undefined && prev[k] !== num) was[k] = { old: prev[k], t0: now };
        prev[k] = num;
        const w = was[k];
        const age = w ? now - w.t0 : Infinity;
        if (w && age >= WAS_MS) delete was[k];
        const mark = age < WAS_MS ? `<s class="was" aria-hidden="true" style="animation-delay:-${Math.round(age)}ms">${esc(w.old)}</s>` : '';
        el.querySelector(`.res[data-k="${k}"] .v`).innerHTML = mark + v;
        if (mark) { clearTimeout(wasTimer[k]); wasTimer[k] = setTimeout(() => el.querySelector(`.res[data-k="${k}"] .was`)?.remove(), WAS_MS - age); }
      };
      set('carts', `${esc(s.carts ?? 0)}<small>/${esc(s.cartsTotal ?? s.carts ?? 0)}</small>`);
      set('ammo', esc(s.ammo ?? 0), s.ammo ?? 0);
      set('material', esc(s.material ?? 0), s.material ?? 0);
      set('morale', esc(m.morale), m.morale);
      $('.rep').textContent = m.reputation;
      $('.tru').textContent = m.trust;
      el.querySelectorAll('.axis .fill')[0].style.width = Math.max(0, Math.min(100, m.reputation)) + '%';
      el.querySelectorAll('.axis .fill')[1].style.width = Math.max(0, Math.min(100, m.trust)) + '%';
      $('.round-title').textContent = m.roundTitle;
      $('.round-sub').textContent = m.roundSub;
      $('.strip-vals').innerHTML = `Loren <b>${esc(s.carts ?? 0)}/${esc(s.cartsTotal ?? s.carts ?? 0)}</b> · Mun <b>${esc(s.ammo ?? 0)}</b> · Mat <b>${esc(s.material ?? 0)}</b> · Moral <b>${esc(m.morale)}</b>`;
      $('.strip-round').textContent = m.stripRound;
      // Uhr (P06): nur neu setzen, wenn sie sich aendert, sonst startet das Einrasten bei jedem Neuzeichnen neu
      if (m.clock && m.clock.big !== lastClock) {
        lastClock = m.clock.big;
        $('.round-clock').innerHTML = m.clock.big;
        $('.strip-clock').innerHTML = m.clock.small;
        $('.round').classList.toggle('battle', m.clock.mode === 'battle');
        strip.classList.toggle('battle', m.clock.mode === 'battle');
      }
      const act = $('.round-act');
      act.hidden = !m.roundAction;
      if (m.roundAction) act.textContent = m.roundAction;
      $('.list-btn .n').textContent = m.orderCount;
      $('.list-btn').setAttribute('aria-label', `Befehlsliste, ${m.orderCount} Befehle`);
      const ovHtml = m.overlays.map((o) => `<button type="button" class="ov${o.active ? ' on' : ''}" data-ov="${o.slot}" aria-pressed="${o.active}">
        <kbd>${o.slot}</kbd><span>${esc(o.label)}</span>${o.empty ? '<small>in Arbeit</small>' : ''}</button>`).join('');
      el.querySelectorAll('.ov-list').forEach((l) => { l.innerHTML = ovHtml; });
      lastChecks = m.checklist;
      $('.check-list').innerHTML = m.checklist.map((c, i) => `<li class="${c.tone}">${c.group || c.at
        ? `<button type="button" data-check="${i}">${esc(c.text)}</button>` : `<span>${esc(c.text)}</span>`}</li>`).join('');
      const hint = $('.hint');
      hint.hidden = !m.hint;
      if (m.hint) {
        hint.className = 'card hint' + (m.hint.tone ? ' t-' + m.hint.tone : '');
        $('.hint-title').textContent = m.hint.title ?? 'Hinweis';
        $('.hint-text').textContent = m.hint.text;
      }
    },
    checkAt(i) { return lastChecks[i]; },
    /** Uhr einrasten lassen (Wechsel Stellungs- und Gefechtsrunde) */
    snapClock() {
      for (const c of el.querySelectorAll('.round-clock, .strip-clock')) {
        c.classList.remove('snap');
        void c.offsetWidth;
        c.classList.add('snap');
      }
    },
  };
}
