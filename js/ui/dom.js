// Kleine DOM-Helfer fuer die Kaertchen des Gefechtsbildschirms.
import { getSetting } from '../settings.js';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text fuer innerHTML sicher machen (Namen kommen aus Daten) */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Element aus HTML-Text */
export function html(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

/** SVG-Symbol im 24er-Raster (Werkzeuge) */
export function icon(paths, size = 22) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

export function ensureCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return Promise.resolve();
  return new Promise((ok) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = l.onerror = () => ok();
    document.head.append(l);
  });
}

/** Bevorzugt der Nutzer reduzierte Bewegung? (Systemeinstellung oder Dienstbuch, P18) */
export function reducedMotion() {
  if (getSetting('motion') === 'reduce') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Animationstempo aus dem Dienstbuch: 0,5 langsam bis 2 schnell (Phasenfilm, Fernschreiber) */
export function animSpeed() {
  return getSetting('speed') || 1;
}
