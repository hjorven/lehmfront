// Laedt alle Spieltexte (data/texts, data/letters) und die Stile der Erzaehlung. Der Browser kann keine
// Ordner auflisten, darum stehen die Dateien hier; test/narrative.test.js prueft, dass keine fehlt.
import { indexTexts } from '../../narrative/texts.js';
import { loadPaperStyles } from '../paper/index.js';

export const TEXT_FILES = [
  'texts/akt1.json', 'texts/akt2.json', 'texts/akt3.json', 'texts/akt4.json',
  'texts/berichte.json', 'texts/enden.json', 'texts/endlos.json', 'texts/erfolge.json',
  'texts/fundstuecke.json', 'texts/tutorial.json', 'texts/zeitungen.json',
  'letters/briefe-akt1-2.json', 'letters/briefe-akt3-4.json', 'letters/templates.json',
];

let textsPromise = null;
let cssPromise = null;

export function loadTexts() {
  textsPromise ??= Promise.all(
    TEXT_FILES.map((f) =>
      fetch(new URL('../../../data/' + f, import.meta.url)).then((r) => {
        if (!r.ok) throw new Error('Text fehlt: data/' + f);
        return r.json();
      }),
    ),
  ).then(indexTexts);
  return textsPromise;
}

export function loadNarrativeStyles() {
  cssPromise ??= Promise.all([
    loadPaperStyles(),
    new Promise((resolve) => {
      const href = new URL('../../../css/narrative.css', import.meta.url).href;
      if ([...document.querySelectorAll('link[rel=stylesheet]')].some((l) => l.href === href)) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => {
        console.error('Erzählung: css/narrative.css fehlt');
        resolve();
      };
      document.head.append(link);
    }),
  ]);
  return cssPromise;
}
