// Beispielszene: zeigt das Muster fuer eigene Szenen. Aufruf: index.html?scene=beispiel
export function mount(root, params) {
  root.innerHTML = '';
  const p = document.createElement('p');
  p.style.cssText = 'padding:24px;font-family:var(--font-head)';
  p.textContent = 'Beispielszene. Parameter: ' + (params.toString() || 'keine');
  root.append(p);
}
