// Tagebuch der Kommandantin (P15, Stil 06): ein Buch mit vier Lesezeichen.
//   Tagebuch            Brandts Eintraege nach jeder Mission, mit Aquarellskizze
//   Buch des Abschnitts alle Gefallenen der Kampagne; neue Namen werden beim Oeffnen mit Bleistift eingetragen
//   Fundstuecke         sechs Ketten zu vier Plaetzen, gefundene Stuecke eingeklebt
//   Briefe              alle gelesenen Briefe und die Feldpost, Antippen legt sie auf den Tisch
//
//   const j = openJournal({ campaign, index, fresh: ['Name', ...], tab: 'buch' });  j.close();  await j.closed;
import { el } from '../paper/registry.js';
import { artCanvas, paintAll } from '../paper/art.js';
import { createPaperLayer } from '../paper/index.js';
import { paperHooks } from '../../audio/director.js';
import { playSfx } from '../../audio/engine.js';
import { missionTitle } from '../../narrative/interlude.js';
import { actOf, actRoman } from '../../narrative/texts.js';
import { letterSheet, fieldPostSheet, findSheet } from '../../narrative/sheets.js';
import './kinds.js';

export const TABS = [
  ['tagebuch', 'Tagebuch'],
  ['buch', 'Buch des Abschnitts'],
  ['funde', 'Fundstücke'],
  ['briefe', 'Briefe'],
];

const LEDGER_ROWS = 11;

function paras(text) {
  return String(text ?? '').split(/\n\s*\n/).filter((p) => p.trim()).map((p) => el('p', null, p));
}

function missionLabel(index, m) {
  if (!m) return '';
  return `Akt ${actRoman(actOf(m))} · ${missionTitle(index, m)}`;
}

/** Seiten je Lesezeichen: Liste von Funktionen, die einen Seiteninhalt bauen */
function pagesFor(tab, { campaign, index, fresh, openSheets }) {
  const book = campaign.book;
  if (tab === 'tagebuch') {
    const entries = book.diary.map((id) => index.byId.get(id)).filter(Boolean);
    if (!entries.length) return [() => [el('h3', null, 'Tagebuch'), el('p', 'journal-empty', 'Noch keine Einträge.')]];
    return entries.map((e) => () => [
      el('h3', null, e.titel ?? ''),
      el('p', 'journal-meta', missionLabel(index, e.nach ?? e.mission)),
      artCanvas('wash:' + (/Regen|regn|nass|Wasser/.test(e.text) ? 'regen' : 'huegel'), e.id, 280, 110, 'Aquarellskizze'),
      ...paras(e.text),
      el('p', 'journal-meta', 'I. B.'),
    ]);
  }
  if (tab === 'buch') {
    const freshSet = new Set(fresh);
    const rows = [];
    let lastMission = null;
    for (const f of book.fallen) {
      if (f.mission !== lastMission) {
        rows.push({ head: missionLabel(index, f.mission) || 'Ohne Einsatz' });
        lastMission = f.mission;
      }
      rows.push({ f });
    }
    const pages = [];
    const intro = [el('h3', null, 'Buch des Abschnitts'), el('p', 'journal-count', `Abschnitt Asse-Nord · ${book.fallen.length} ${book.fallen.length === 1 ? 'Name' : 'Namen'}`)];
    if (!rows.length) return [() => [...intro, el('p', 'journal-empty', 'Noch ist kein Name eingetragen.')]];
    for (let i = 0; i < rows.length; i += LEDGER_ROWS) pages.push(rows.slice(i, i + LEDGER_ROWS));
    let freshIdx = 0;
    return pages.map((chunk, p) => () => {
      const out = p === 0 ? [...intro] : [];
      const box = el('div', 'journal-ledger');
      let list = null;
      for (const r of chunk) {
        if (r.head) {
          box.append(el('h4', null, r.head));
          list = null;
          continue;
        }
        if (!list) box.append((list = el('ol')));
        const f = r.f;
        const li = el('li', f.story ? 'is-story' : null, [
          el('span', 'n', f.name),
          el('span', 'h', [f.home, f.groupLabel].filter(Boolean).join(', ')),
          el('span', 'c', [f.causeText, f.turn ? `Runde ${f.turn}` : ''].filter(Boolean).join(', ')),
        ]);
        if (freshSet.has(f.name)) {
          li.classList.add('is-fresh');
          li.style.setProperty('--i', String(freshIdx++));
        }
        list.append(li);
      }
      out.push(box);
      return out;
    });
  }
  if (tab === 'funde') {
    const found = new Set(book.finds);
    const chains = [];
    for (const e of index.list) {
      if (e.art !== 'fundstueck') continue;
      let c = chains.find((x) => x.id === e.kette);
      if (!c) chains.push((c = { id: e.kette, items: [] }));
      c.items.push(e);
    }
    for (const c of chains) c.items.sort((a, b) => a.kette_nr - b.kette_nr);
    const total = chains.reduce((n, c) => n + c.items.filter((i) => found.has(i.id)).length, 0);
    const perPage = 3;
    const pages = [];
    for (let i = 0; i < chains.length; i += perPage) pages.push(chains.slice(i, i + perPage));
    return pages.map((chunk, p) => () => {
      const out = p === 0 ? [el('h3', null, 'Fundstücke'), el('p', 'journal-count', `${total} von ${chains.reduce((n, c) => n + c.items.length, 0)} gefunden`)] : [];
      const wrap = el('div', 'journal-finds');
      for (const c of chunk) {
        const end = index.list.find((x) => x.art === 'fundstueck-kette' && x.kette === c.id);
        const have = c.items.filter((i) => found.has(i.id)).length;
        const complete = have === c.items.length;
        const slots = c.items.map((it) => {
          if (!found.has(it.id)) {
            const b = el('button', 'journal-slot is-empty', el('span', null, '?'));
            b.type = 'button';
            b.disabled = true;
            b.setAttribute('aria-label', `Fundstück ${it.kette_nr}, noch nicht gefunden`);
            return b;
          }
          const sh = findSheet(it);
          const art = sh.motif === 'karte' ? 'flur' : sh.motif === 'postkarte' ? 'postcard' : 'photo:' + sh.motif;
          const b = el('button', 'journal-slot', [artCanvas(art, it.id, 220, 160, it.bild ?? it.titel), el('b', null, it.titel)]);
          b.type = 'button';
          b.addEventListener('click', () => openSheets([
            sh,
            { id: it.id + '-notiz', kind: 'diary', date: it.fundort ?? '', title: it.titel ?? '', body: it.text, sketch: false, signature: 'I. B.' },
          ]));
          return b;
        });
        // Der Name einer Spur zeigt sich erst, wenn sie vollstaendig ist
        const heading = el('h4', null, [complete && end ? end.titel : `Spur ${chains.indexOf(c) + 1}`, el('small', null, `${have} / ${c.items.length}`)]);
        const chainEl = el('div', 'journal-chain', [heading, el('div', 'journal-slots', slots)]);
        if (complete && end) {
          const b = el('button', 'journal-more', 'Wie es ausging');
          b.type = 'button';
          b.addEventListener('click', () => openSheets([{ id: end.id, kind: 'diary', date: 'Nachtrag', title: end.titel, body: end.text, sketch: false }]));
          chainEl.append(b);
        }
        wrap.append(chainEl);
      }
      out.push(wrap);
      return out;
    });
  }
  // Briefe
  const items = book.letters.map((l) => {
    if (l.fieldpost) return { l, label: `Feldpost von ${l.fieldpost.writer.name}`, meta: l.fieldpost.groupLabel, sheet: () => fieldPostSheet(l.fieldpost) };
    const e = index.byId.get(l.id);
    if (!e) return null;
    const label = `${e.absender} an ${e.empfaenger}`;
    const meta = e.art === 'lask' ? 'abgefangen' : `Brief ${e.nr ?? ''}`;
    return { l, label, meta, sheet: () => letterSheet(e, e.art === 'lask' ? { title: 'Abgefangener Brief' } : {}) };
  }).filter(Boolean);
  if (!items.length) return [() => [el('h3', null, 'Briefe'), el('p', 'journal-empty', 'Noch keine Post.')]];
  const per = 9;
  const pages = [];
  for (let i = 0; i < items.length; i += per) pages.push(items.slice(i, i + per));
  return pages.map((chunk, p) => () => {
    const out = p === 0 ? [el('h3', null, 'Briefe'), el('p', 'journal-count', `${items.length} Briefe`)] : [];
    const ul = el('ul', 'journal-letters');
    let last = null;
    for (const it of chunk) {
      if (it.l.mission !== last) {
        last = it.l.mission;
        ul.append(el('li', null, el('p', 'journal-meta', missionLabel(index, last))));
      }
      const b = el('button', null, [el('span', null, it.label), el('small', null, it.meta)]);
      b.type = 'button';
      b.addEventListener('click', () => openSheets([it.sheet()]));
      ul.append(el('li', null, b));
    }
    out.push(ul);
    return out;
  });
}

export function openJournal({ campaign, index, fresh = [], tab = null, onClose = null } = {}) {
  let current = tab ?? (fresh.length ? 'buch' : 'tagebuch');
  let page = 0;
  let resolveClosed;
  const closed = new Promise((r) => (resolveClosed = r));

  const title = el('h2', null, 'Tagebuch · Major Ilse Brandt');
  const closeBtn = el('button', 'journal-close', 'Schließen');
  closeBtn.type = 'button';
  const top = el('div', 'journal-top', [title, closeBtn]);
  const tabs = el('div', 'journal-tabs');
  tabs.setAttribute('role', 'tablist');
  const spread = el('div', 'journal-spread');
  const prev = el('button', null, 'Zurück');
  const next = el('button', null, 'Weiter');
  prev.type = next.type = 'button';
  const count = el('span');
  const nav = el('div', 'journal-nav', [prev, count, next]);
  const bookEl = el('div', 'journal-book', [top, tabs, spread, nav]);
  const root = el('div', 'journal', bookEl);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Tagebuch der Kommandantin');
  // Blaetter aus dem Tagebuch liegen in einer eigenen, scrollbaren Ebene: lange Briefe passen auf dem Handy nicht
  // auf den Schirm. Tippen neben die Blaetter legt sie weg.
  const paperHost = el('div', 'journal-paper-host');
  const paperScroll = el('div', 'journal-paper', paperHost);
  const putAway = el('button', 'narr-btn', 'Blätter weglegen');
  putAway.type = 'button';
  putAway.hidden = true;
  Object.assign(putAway.style, { position: 'fixed', left: '50%', bottom: '12px', transform: 'translateX(-50%)', zIndex: 76, pointerEvents: 'auto', background: 'var(--bar)', color: 'var(--bar-ink)' });
  root.append(paperScroll, putAway);
  // Was unter dem Tagebuch liegt (der Tisch), ist fuer Tastatur und Vorleser gesperrt, solange es offen ist
  const under = [...document.body.children].filter((n) => n !== root && !n.inert);
  const returnFocus = document.activeElement;
  under.forEach((n) => (n.inert = true));
  document.body.append(root);
  const setOpen = (open) => {
    putAway.hidden = !open;
    paperScroll.classList.toggle('is-open', open);
    if (!open) paperHost.style.minHeight = '';
  };
  const paper = createPaperLayer(paperHost, { light: 'auto', hooks: paperHooks({ onDismiss: () => queueMicrotask(() => setOpen(paper.ids().length > 0)) }) });
  const nodeOf = (id) => [...paperHost.querySelectorAll('.paper-sheet')].find((n) => n.dataset.id === id);

  function openSheets(list) {
    paper.clear();
    setOpen(true);
    paperScroll.scrollTop = 0;
    const w = paperScroll.clientWidth || innerWidth;
    const narrow = w < 720;
    // Platz schaffen, damit die Ebene untereinander gelegte Blaetter nicht an den Rand klemmt
    paperHost.style.minHeight = list.length * 1400 + 'px';
    let y = 60;
    let bottom = 0;
    list.forEach((s, i) => {
      const sw = Math.min(s.kind === 'photo' ? 240 : 320, w - 24);
      // Handy: untereinander statt uebereinander, Desktop: nebeneinander
      const x = narrow ? (w - sw) / 2 + (i % 2 ? 6 : -6) : w / 2 - sw - 10 + i * (sw + 20) * (list.length > 1 ? 1 : 0.5);
      paper.add(s, { x: Math.max(8, x), y: narrow ? y : 60, rot: i % 2 ? 1.5 : -1.5 });
      const h = nodeOf(s.id)?.offsetHeight ?? 400;
      if (narrow) y += h + 24;
      bottom = Math.max(bottom, (narrow ? y : 60 + h + 24));
    });
    // Unten Luft fuer den Knopf "Blätter weglegen"
    paperHost.style.minHeight = Math.max(paperScroll.clientHeight, bottom + 80) + 'px';
  }
  putAway.addEventListener('click', () => {
    paper.clear();
    setOpen(false);
  });
  paperScroll.addEventListener('click', (e) => {
    if (e.target === paperScroll || e.target === paperHost) {
      paper.clear();
      setOpen(false);
    }
  });

  const tabBtns = TABS.map(([id, label]) => {
    const b = el('button', 'journal-tab', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.tab = id;
    b.addEventListener('click', () => {
      current = id;
      page = 0;
      render();
    });
    tabs.append(b);
    return b;
  });

  const single = () => (root.clientWidth || innerWidth) < 720;

  let built = [];
  // Neue Namen schreibt der Bleistift nur beim ersten Aufschlagen ein, nicht bei jedem Blaettern
  let freshNow = fresh;
  let wasSingle = single();
  function render() {
    paper.clear();
    setOpen(false);
    wasSingle = single();
    tabBtns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === current)));
    built = pagesFor(current, { campaign, index, fresh: freshNow, openSheets });
    const per = single() ? 1 : 2;
    // Neue Namen: gleich auf der Seite mit dem letzten Eintrag aufschlagen
    if (page === 'end') page = Math.max(0, built.length - per);
    page = Math.max(0, Math.min(page, Math.max(0, built.length - 1)));
    if (per === 2 && page % 2) page -= 1;
    spread.classList.toggle('is-single', per === 1);
    const shown = [];
    for (let i = page; i < Math.min(built.length, page + per); i++) shown.push(i);
    spread.replaceChildren(...shown.map((i) => el('section', 'journal-page', built[i]())));
    if (per === 2 && shown.length === 1) spread.append(el('section', 'journal-page'));
    paintAll(spread);
    // Bleistift kratzt, waehrend die neuen Namen eingetragen werden
    const freshRows = spread.querySelectorAll('.is-fresh').length;
    if (freshRows && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      for (let i = 0; i < Math.min(freshRows, 6); i++) playSfx('pencil', { delay: 0.3 + i * 0.45 });
    }
    if (freshRows) freshNow = [];
    count.textContent = built.length > per ? `Seite ${page + 1}${per === 2 && shown.length > 1 ? '–' + (page + 2) : ''} von ${built.length}` : '';
    prev.disabled = page === 0;
    next.disabled = page + per >= built.length;
  }

  prev.addEventListener('click', () => {
    page = Math.max(0, page - (single() ? 1 : 2));
    render();
  });
  next.addEventListener('click', () => {
    page += single() ? 1 : 2;
    render();
  });

  // Handy gedreht: zwischen Doppelseite und Einzelseite wechseln
  function onResize() {
    if (single() !== wasSingle) render();
  }
  addEventListener('resize', onResize);

  function close() {
    removeEventListener('keydown', onKey);
    removeEventListener('resize', onResize);
    paper.destroy();
    root.remove();
    under.forEach((n) => (n.inert = false));
    returnFocus?.focus?.({ preventScroll: true });
    onClose?.();
    resolveClosed();
  }
  closeBtn.addEventListener('click', close);
  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (paper.ids().length) {
        paper.clear();
        setOpen(false);
      } else close();
    } else if (e.key === 'ArrowRight' && !next.disabled && !e.target.closest?.('.paper-sheet')) next.click();
    else if (e.key === 'ArrowLeft' && !prev.disabled && !e.target.closest?.('.paper-sheet')) prev.click();
  }
  addEventListener('keydown', onKey);

  if (current === 'buch' && fresh.length) page = 'end';
  render();
  closeBtn.focus({ preventScroll: true });
  return { close, closed, element: root, show: (t) => { current = t; page = 0; render(); } };
}
