// Baut lehmfront-ui.html: bettet die Schriften aus den fontsource-Paketen als Base64 ein.
import { readFileSync, writeFileSync } from 'node:fs';

const fonts = [
  ['Special Elite', 'special-elite', [400]],
  ['IBM Plex Sans', 'ibm-plex-sans', [400, 700]],
  ['IBM Plex Mono', 'ibm-plex-mono', [400, 700]],
  ['Caveat', 'caveat', [400, 700]],
  ['Playfair Display', 'playfair-display', [400, 700]],
  ['Old Standard TT', 'old-standard-tt', [400, 700]],
  ['Architects Daughter', 'architects-daughter', [400]],
  ['Bebas Neue', 'bebas-neue', [400]],
  ['Stardos Stencil', 'stardos-stencil', [400, 700]],
  ['UnifrakturCook', 'unifrakturcook', [700]],
  ['Oswald', 'oswald', [400, 700]],
];

let css = '';
for (const [family, pkg, weights] of fonts) {
  for (const w of weights) {
    const file = `node_modules/@fontsource/${pkg}/files/${pkg}-latin-${w}-normal.woff2`;
    const b64 = readFileSync(file).toString('base64');
    css += `@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${b64}) format("woff2");}\n`;
  }
}

const tpl = readFileSync('template.html', 'utf8');
const out = tpl.replace('/*FONTS*/', css);
const target = process.argv[2] || 'lehmfront-ui.html';
writeFileSync(target, out);
console.log(`geschrieben: ${target} (${(out.length / 1024).toFixed(0)} KB, Schriften ${(css.length / 1024).toFixed(0)} KB)`);
