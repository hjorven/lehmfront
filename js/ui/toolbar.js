// Werkzeugreihe unten (Plan 7.2) und Knopf "Runde ausfuehren". Liest das Werkzeug-Register.
import { allTools } from './tools.js';
import { esc, icon } from './dom.js';

const UNDO_ICON = '<path d="M9 7 L4 12 L9 17"/><path d="M4 12 H15 A5 5 0 0 1 15 22"/>';

export function createToolbar(root, { onTool, onUndo, onExec }) {
  const el = document.createElement('div');
  el.className = 'bottom';
  el.innerHTML = `<div class="toolbar" role="toolbar" aria-label="Befehle"></div>
    <button class="exec" type="button" aria-keyshortcuts="Enter"><span class="exec-label">Runde ausführen</span> <b class="n"></b></button>`;
  root.append(el);
  const bar = el.querySelector('.toolbar');
  const exec = el.querySelector('.exec');
  exec.addEventListener('click', () => onExec());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.getAttribute('aria-disabled') === 'true') {
      if (b?.dataset.tool) onTool(b.dataset.tool, true);
      return;
    }
    if (b.dataset.tool) onTool(b.dataset.tool, false);
    else if (b.dataset.undo !== undefined) onUndo();
  });

  return {
    el,
    /** m = { tools: [{ tool, ok, why }], active, canUndo, count, label } */
    update(m) {
      bar.innerHTML = m.tools.map(({ tool, ok, why }) => `<button type="button" class="tool${m.active === tool.id ? ' active' : ''}"
          data-tool="${esc(tool.id)}" aria-keyshortcuts="${esc(tool.key.toUpperCase())}" aria-pressed="${m.active === tool.id}"
          aria-disabled="${!ok}" title="${esc(ok ? tool.label + ' (' + tool.key.toUpperCase() + ')' : why)}">
          ${icon(tool.icon)}<span class="lbl">${esc(tool.label)}</span><kbd>${esc(tool.key.toUpperCase())}</kbd></button>`).join('')
        + `<button type="button" class="tool undo" data-undo aria-keyshortcuts="Control+Z" aria-disabled="${!m.canUndo}"
          title="Letzten Befehl zurücknehmen (Strg+Z)">${icon(UNDO_ICON)}<span class="lbl">Zurück</span><kbd>Strg+Z</kbd></button>`;
      exec.querySelector('.n').textContent = m.count;
      exec.querySelector('.exec-label').textContent = m.label;
      exec.setAttribute('aria-label', `${m.label}, ${m.count} Befehle`);
    },
    focusTool(id) { bar.querySelector(`[data-tool="${id}"]`)?.focus(); },
  };
}
