// Oeffentliche Schnittstelle der Papierebene. Nutzung:
//   import { loadPaperStyles, createPaperLayer } from '../ui/paper/index.js';
//   await loadPaperStyles();            // CSS und Schriften, damit Blaetter richtig vermessen werden
//   const paper = createPaperLayer(host, { hooks });
export { createPaperLayer } from './layer.js';
export { registerKind, kindNames } from './registry.js';

let loading = null;

export function loadPaperStyles() {
  if (loading) return loading;
  const href = new URL('../../../css/paper.css', import.meta.url).href;
  const css = [...document.querySelectorAll('link[rel=stylesheet]')].find((l) => l.href === href)
    ? Promise.resolve()
    : new Promise((resolve) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.onload = () => resolve();
        link.onerror = () => {
          console.error('Papierebene: css/paper.css fehlt');
          resolve();
        };
        document.head.append(link);
      });
  const fonts = document.fonts
    ? Promise.all(['19px Caveat', '700 19px Caveat', '13px "Special Elite"', '12px "IBM Plex Mono"', '700 14px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {})
    : Promise.resolve();
  loading = Promise.all([css, fonts]).then(() => {});
  return loading;
}
