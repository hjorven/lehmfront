// Werkzeugreihe unten (Plan 7.2) und Knopf "Runde ausfuehren". Liest das Werkzeug-Register.
import { allTools } from './tools.js';
import { esc, icon } from './dom.js';
import { TOOL_HELP } from '../unlocks.js';

const UNDO_ICON = '<path d="M9 7 L4 12 L9 17"/><path d="M4 12 H15 A5 5 0 0 1 15 22"/>';

export function createToolbar(root, { onTool, onUndo, onExec }) {
  const el = document.createElement('div');
  el.className = 'bottom';
  el.innerHTML = `<div class="tb-wrap"><div class="toolbar" role="toolbar" aria-label="Befehle"></div>
    <button class="tb-more prev" type="button" tabindex="-1" aria-label="Weitere Werkzeuge links" hidden>‹</button>
    <button class="tb-more next" type="button" tabindex="-1" aria-label="Weitere Werkzeuge rechts" hidden>› <small></small></button></div>
    <button type="button" class="tool undo" data-undo aria-keyshortcuts="Control+Z" title="Letzten Befehl zurücknehmen (Strg+Z)">${icon(UNDO_ICON)}<span class="lbl">Zurück</span><kbd>Strg+Z</kbd></button>
    <button class="exec" type="button" aria-keyshortcuts="Enter"><span class="exec-label">Runde ausführen</span> <b class="n"></b></button>`;
  root.append(el);
  const bar = el.querySelector('.toolbar');
  const exec = el.querySelector('.exec');
  const undo = el.querySelector('.undo');
  // P21: "Zurück" steht fest neben der Reihe, damit es nie hinter der Lasche verschwindet
  undo.addEventListener('click', () => { if (undo.getAttribute('aria-disabled') !== 'true') onUndo(); });
  const prev = el.querySelector('.tb-more.prev'), next = el.querySelector('.tb-more.next');
  // P21: Mit Akt 2 sind es bis zu 16 Werkzeuge. Passt die Reihe nicht, zeigen Laschen an den Enden, dass es weitergeht
  // (Zahl der verdeckten Werkzeuge rechts), und blaettern beim Antippen um eine Handbreit.
  const narrowMq = typeof matchMedia === 'function' ? matchMedia('(max-width: 699px)') : null;
  function edges() {
    const max = bar.scrollWidth - bar.clientWidth;
    prev.hidden = !(max > 2 && bar.scrollLeft > 2);
    next.hidden = !(max > 2 && bar.scrollLeft < max - 2);
    if (!next.hidden) {
      const right = bar.getBoundingClientRect().right;
      const hiddenN = [...bar.children].filter((b) => b.getBoundingClientRect().right > right + 4).length;
      next.querySelector('small').textContent = hiddenN ? String(hiddenN) : '';
    }
  }
  const page = (dir) => bar.scrollBy({ left: dir * Math.max(120, bar.clientWidth * 0.7), behavior: 'smooth' });
  prev.addEventListener('click', () => page(-1));
  next.addEventListener('click', () => page(1));
  bar.addEventListener('scroll', edges, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(edges).observe(bar);
  let lastActive = null, lastModel = null;
  // Handy gedreht oder Fenster schmaler: Reihenfolge (moegliche Befehle vorn) neu setzen
  narrowMq?.addEventListener?.('change', () => { if (lastModel) api.update(lastModel); });
  exec.addEventListener('click', () => onExec());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-disabled') === 'true') {
      if (b?.dataset.tool) onTool(b.dataset.tool, true);
      return;
    }
    if (b.dataset.tool) onTool(b.dataset.tool, false);
  });

  const api = {
    el,
    /** m = { tools: [{ tool, ok, why }], active, canUndo, count, label } */
    update(m) {
      // Handy: was jetzt geht, steht vorn (ohne gewaehlte Gruppe die Befehle der Seite, mit Gruppe ihre Befehle).
      // Die Reihenfolge innerhalb beider Teile bleibt die des Registers.
      const tools = narrowMq?.matches ? [...m.tools.filter((t) => t.ok), ...m.tools.filter((t) => !t.ok)] : m.tools;
      bar.innerHTML = tools.map(({ tool, ok, why }) => `<button type="button" class="tool${m.active === tool.id ? ' active' : ''}"
          data-tool="${esc(tool.id)}" aria-keyshortcuts="${esc(tool.key.toUpperCase())}" aria-pressed="${m.active === tool.id}"
          aria-disabled="${!ok}" title="${esc(ok ? tool.label + ' (' + tool.key.toUpperCase() + ')' + (TOOL_HELP[tool.id] ? ': ' + TOOL_HELP[tool.id] : '') : why)}">
          ${icon(tool.icon)}<span class="lbl">${esc(tool.label)}</span><kbd>${esc(tool.key.toUpperCase())}</kbd></button>`).join('')
;
      undo.setAttribute('aria-disabled', String(!m.canUndo));
      exec.querySelector('.n').textContent = m.count;
      exec.querySelector('.exec-label').textContent = m.label;
      exec.setAttribute('aria-label', `${m.label}, ${m.count} Befehle`);
      // Aktives Werkzeug (auch per Taste oder Kreis gewaehlt) in die sichtbare Reihe holen, nur wenn es wechselt
      if (m.active && m.active !== lastActive) bar.querySelector('.tool.active')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      lastActive = m.active ?? null;
      lastModel = m;
      edges();
    },
    focusTool(id) { bar.querySelector(`[data-tool="${id}"]`)?.focus(); },
  };
  return api;
}
