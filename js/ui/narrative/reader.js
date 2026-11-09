// Der Tisch zwischen den Missionen (P15): Blaetter kommen eins nach dem anderen auf die Schreibunterlage,
// "Weiter" legt das gelesene in die Ablage. Entscheidungen halten den Ablauf an, bis gewaehlt ist.
//
//   const r = playSteps({ steps, title, onChoice, onJournal, finishLabel, hooks, startAt });
//   const { choices } = await r.done;
//
// steps: aus js/narrative/interlude.js ({ kind, id, sheet, entry }). Zeitungen hintereinander liegen als
// ein Aufschlag gemeinsam auf dem Tisch. onChoice(decisionId, optionId) darf weitere Schritte liefern
// (Tagebuch nach einer Entscheidung), die direkt danach kommen.
import { createPaperLayer } from '../paper/index.js';
import { el } from '../paper/registry.js';
import { paperHooks } from '../../audio/director.js';
import { playSfx, audio } from '../../audio/engine.js';
import './kinds.js';

const SECTION = {
  casualties: 'Nach dem Einsatz',
  diary: 'Aus dem Tagebuch der Kommandantin',
  letter: 'Post aus dem Abschnitt',
  lask: 'Abgefangen',
  fieldpost: 'Feldpost',
  find: 'Fundstück',
  findchain: 'Fundstück',
  decision: 'Entscheidung',
  newspaper: 'Was die Zeitungen schreiben',
  actcard: 'Ein neuer Akt',
  briefing: 'Nächster Einsatz',
  order: 'Nächster Einsatz',
};

const KIND_W = { letter: 310, telegram: 350, diary: 310, casualties: 350, newspaper: 340, photo: 240, actcard: 300, briefing: 370, decision: 380 };

/** Schritte zu Seiten: aufeinanderfolgende Zeitungen bilden einen Aufschlag */
export function paginate(steps) {
  const pages = [];
  for (const s of steps) {
    const last = pages[pages.length - 1];
    if ((s.kind === 'newspaper' && last?.kind === 'newspaper') || (s.kind === 'findnote' && last?.kind === 'find')) last.steps.push(s);
    else pages.push({ kind: s.kind, steps: [s] });
  }
  return pages;
}

function jitter(id, span) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return (((h >>> 0) % 1000) / 1000 - 0.5) * span;
}

export function playSteps(opts) {
  const { title = '', onChoice = null, onJournal = null, finishLabel = 'Weiter', hooks = {}, stats = null } = opts;
  let pages = paginate(opts.steps ?? []);
  const choices = {};
  let idx = -1;
  let pending = null; // offene Entscheidung
  let resolveDone;
  const done = new Promise((r) => (resolveDone = r));

  const section = el('span', 'narr-section');
  const sub = el('span', 'narr-sub');
  // Ansehen und Vertrauen stehen mit Bleistift am Rand; nach einer Entscheidung die Aenderung daneben
  const axes = el('span', 'narr-axes');
  const startStats = stats ? stats() : null;
  function renderAxes() {
    if (!stats) return;
    const now = stats();
    const part = (label, k) => {
      const d = now[k] - startStats[k];
      return el('span', null, [label + ' ', el('b', null, String(now[k])), d ? el('em', d > 0 ? 'up' : 'down', (d > 0 ? ' +' : ' −') + Math.abs(d)) : null]);
    };
    axes.replaceChildren(part('Ansehen', 'ansehen'), part('Vertrauen', 'vertrauen'));
  }
  renderAxes();
  const hint = el('span', 'narr-hint');
  const head = el('header', 'narr-head', [section, stats ? axes : null, sub, hint]);
  const host = el('div', 'narr-host', [el('div', 'narr-blotter')]);
  const stage = el('div', 'narr-stage', host);
  const pileBtn = el('button', 'narr-btn narr-pile', 'Abgelegt');
  pileBtn.type = 'button';
  const journalBtn = onJournal ? el('button', 'narr-btn', 'Tagebuch') : null;
  if (journalBtn) journalBtn.type = 'button';
  const progress = el('div', 'narr-progress');
  progress.setAttribute('aria-hidden', 'true');
  const nextBtn = el('button', 'narr-btn narr-btn-main', 'Weiter');
  nextBtn.type = 'button';
  const bar = el('footer', 'narr-bar', [pileBtn, journalBtn, progress, nextBtn]);
  const root = el('div', 'narr', [head, stage, bar]);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', title || 'Zwischen den Missionen');
  document.body.append(root);
  // Zwischen den Missionen: nur die karge Musik, keine Front (Klang wartet auf das erste Tippen)
  try {
    audio.init();
    audio.startMusic();
  } catch (e) {
    console.warn('Erzählung: Klang nicht verfügbar', e);
  }

  const updatePile = () => {
    const n = paper.pileCount();
    pileBtn.textContent = n ? `Abgelegt (${n})` : 'Abgelegt';
    pileBtn.disabled = n === 0;
  };
  const paper = createPaperLayer(host, {
    light: 'auto',
    hooks: paperHooks({
      ...hooks,
      onDismiss: (a) => {
        hooks.onDismiss?.(a);
        queueMicrotask(updatePile);
      },
    }),
  });

  pileBtn.addEventListener('click', () => {
    paper.restore();
    updatePile();
  });
  journalBtn?.addEventListener('click', () => onJournal());

  function renderProgress() {
    progress.replaceChildren(
      ...pages.map((p, i) => {
        const tick = el('i');
        if (i < idx) tick.className = 'is-done';
        if (i === idx) tick.className = 'is-now';
        if (p.kind === 'decision') tick.classList.add('is-decision');
        return tick;
      }),
    );
  }

  function layout(page) {
    const w = host.clientWidth || innerWidth;
    const narrow = w < 900;
    const out = [];
    const n = page.steps.length;
    page.steps.forEach((s, i) => {
      const title = page.kind === 'actcard';
      const sw = Math.min(title ? 380 : KIND_W[s.sheet.kind] ?? 320, w - 24);
      let x = (w - sw) / 2 + jitter(s.id, 24);
      let y = 18 + Math.abs(jitter(s.id + 'y', 12));
      let rot = jitter(s.id + 'r', 3.2);
      if (n > 1) {
        if (narrow) {
          y = 14 + i * (page.kind === 'find' ? 232 : 64);
          x = (w - sw) / 2 + (i % 2 ? 8 : -8);
        } else {
          const span = Math.min(w - 40, 1120) - sw;
          x = (w - Math.min(w - 40, 1120)) / 2 + (span * i) / (n - 1);
          y = 20 + (i % 2) * 46;
        }
        rot = (i % 2 ? 2.4 : -2.4) + jitter(s.id, 1.2);
      }
      out.push({ x: Math.max(8, Math.round(x)), y: Math.round(y), rot });
    });
    return out;
  }

  function sheetNode(id) {
    return [...host.querySelectorAll('.paper-sheet')].find((n) => n.dataset.id === id) ?? null;
  }

  function fitHost(page, pos) {
    let bottom = 0;
    page.steps.forEach((s, i) => {
      const node = sheetNode(s.id);
      if (node) bottom = Math.max(bottom, pos[i].y + node.offsetHeight);
    });
    host.style.minHeight = Math.max(stage.clientHeight, bottom + 48) + 'px';
  }

  function show(i) {
    idx = i;
    const page = pages[i];
    for (const id of paper.ids()) paper.dismiss(id);
    root.classList.toggle('is-title', page.kind === 'actcard');
    section.textContent = SECTION[page.kind] ?? '';
    const about = page.steps[0].about;
    sub.textContent = (about ? about + ' · ' : '') + `${i + 1} / ${pages.length}`;
    hint.textContent = page.steps.length > 1 ? 'Antippen holt ein Blatt nach vorn.' : '';
    const pos = layout(page);
    page.steps.forEach((s, k) => paper.add(s.sheet, { ...pos[k], typed: s.kind === 'order' }));
    fitHost(page, pos);
    stage.scrollTop = 0;
    pending = page.kind === 'decision' && !choices[page.steps[0].entry ?? page.steps[0].id] ? page.steps[0] : null;
    nextBtn.disabled = !!pending;
    nextBtn.textContent = i === pages.length - 1 ? finishLabel : 'Weiter';
    renderProgress();
    updatePile();
  }

  function next() {
    if (pending) return;
    if (idx >= pages.length - 1) return finish();
    show(idx + 1);
  }

  function choose(stepObj, optionId) {
    const node = sheetNode(stepObj.id);
    const id = stepObj.entry ?? stepObj.id;
    if (choices[id]) return;
    choices[id] = optionId;
    const opt = stepObj.sheet.options.find((o) => o.id === optionId);
    if (node) {
      node.querySelectorAll('.narr-option').forEach((b) => {
        b.disabled = true;
        if (b.dataset.option === optionId) b.classList.add('is-chosen');
      });
      const res = node.querySelector('.narr-dec-result');
      if (res && opt?.text) res.textContent = opt.text;
    }
    // Hoehe hat sich geaendert: Tisch nachziehen
    const page = pages[idx];
    fitHost(page, layout(page));
    playSfx('stamp');
    const extra = onChoice ? onChoice(id, optionId) ?? [] : [];
    if (extra.length) pages = [...pages.slice(0, idx + 1), ...paginate(extra), ...pages.slice(idx + 1)];
    pending = null;
    renderAxes();
    nextBtn.disabled = false;
    nextBtn.textContent = idx === pages.length - 1 ? finishLabel : 'Weiter';
    renderProgress();
    nextBtn.focus({ preventScroll: true });
  }

  // Wahlknoepfe liegen auf einem Blatt: das Blatt soll sie nicht als Ziehen verstehen
  host.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.narr-option')) e.stopPropagation();
  }, true);
  host.addEventListener('click', (e) => {
    const b = e.target.closest?.('.narr-option');
    if (!b || b.disabled) return;
    const sheetEl = b.closest('.paper-sheet');
    const st = pages[idx].steps.find((s) => s.id === sheetEl?.dataset.id);
    if (st) choose(st, b.dataset.option);
  });
  nextBtn.addEventListener('click', next);

  function onKey(e) {
    if (!root.isConnected || e.defaultPrevented) return;
    if (document.querySelector('.journal')) return; // Tagebuch liegt obenauf
    if (pending && /^[1-9]$/.test(e.key)) {
      const opt = pending.sheet.options[Number(e.key) - 1];
      if (opt) {
        e.preventDefault();
        choose(pending, opt.id);
      }
      return;
    }
    const onControl = e.target.closest?.('button, .paper-sheet, input, a');
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && (!onControl || e.target === nextBtn)) {
      if (e.target === nextBtn && e.key !== 'ArrowRight') return; // Klick des Knopfes reicht
      e.preventDefault();
      next();
    }
  }
  addEventListener('keydown', onKey);

  function destroy() {
    removeEventListener('keydown', onKey);
    paper.destroy();
    root.remove();
  }

  function finish() {
    destroy();
    resolveDone({ choices });
  }

  if (pages.length) show(Math.max(0, Math.min(pages.length - 1, opts.startAt ?? 0)));
  else queueMicrotask(finish);

  return {
    done,
    destroy,
    goTo: (n) => show(Math.max(0, Math.min(pages.length - 1, n))),
    pages: () => pages.slice(),
    choose: (optionId) => pending && choose(pending, optionId),
    element: root,
  };
}
