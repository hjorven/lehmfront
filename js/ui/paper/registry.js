// Register der Blattarten. Spaetere Pakete melden neue Arten hier an, statt den Baustein umzubauen:
//   import { registerKind } from './js/ui/paper/registry.js';
//   registerKind('flugblatt', { render(data, h) { ... return { front, back } } });
// render bekommt die Blattdaten und die Helfer h (el, text, art) und liefert die Vorderseite
// (HTMLElement) und optional die Rueckseite. Eigenschaften:
//   style: CSS-Klasse fuer das Blatt (Standard: paper-<name>)
//   typed: Liste der Elemente, die Zeile fuer Zeile getippt werden duerfen (siehe telegram.js)
const kinds = new Map();

export function registerKind(name, def) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Ungueltiger Name fuer Blattart: ' + name);
  if (!def || typeof def.render !== 'function') throw new Error('Blattart ohne render: ' + name);
  kinds.set(name, def);
}

export function getKind(name) {
  return kinds.get(name);
}

export function kindNames() {
  return [...kinds.keys()].sort();
}

// Kleiner DOM-Helfer: el('div', 'klasse', 'Text' | [Kinder])
export function el(tag, cls, content) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (content == null) return n;
  if (Array.isArray(content)) n.append(...content.filter((c) => c != null && c !== false));
  else if (content instanceof Node) n.append(content);
  else n.textContent = String(content);
  return n;
}
