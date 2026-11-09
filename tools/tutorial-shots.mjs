// Bilder fuer docs/tutorial.md (Anleitung fuer Einsteiger). Reproduzierbar ueber die Demo-Zustaende der Szenen.
//   node tools/tutorial-shots.mjs            alle Bilder nach docs/bilder/tutorial/ (JPEG, klein genug fuers Repo)
//   node tools/tutorial-shots.mjs --only 05  nur Bilder, deren Name so beginnt
// Playwright wie bei tools/shot.mjs (npm i --no-save playwright && npx playwright install chromium).
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const OUT = 'docs/bilder/tutorial';
const DRILL = '/?scene=gefecht&karte=asse&ki=rekrut&runden=0&seed=1917&ausbildung=';

const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const HANDY = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

// name, Pfad, Geraet, optional Vorbereitung im Browser
const SHOTS = [
  ['01-hauptmenue', '/', DESK],
  ['02-grundausbildung', DRILL + '1', DESK],
  ['03-grundausbildung-handy', DRILL + '4', HANDY],
  ['04-gruppe-bewegen', '/?scene=gefecht&demo=befehle', DESK],
  ['05-befehlskreis', '/?scene=gefecht&demo=radial', DESK],
  ['06-graben-traversen', '/?scene=gefecht&demo=traversen', DESK],
  ['07-mg-sektor', '/?scene=gefecht&demo=sektor', DESK],
  ['08-sichtlinie', '/?scene=gefecht&demo=sichtlinie', DESK],
  ['09-zusammenfassung', '/?scene=gefecht&demo=zusammenfassung', DESK],
  ['10-phasenfilm', '/?scene=gefecht&demo=film', DESK],
  ['11-telegramm', '/?scene=gefecht&demo=telegramm', DESK],
  ['12-bleistiftnotizen', '/?scene=gefecht&demo=notizen', DESK],
  ['13-lorenplan', '/?scene=gefecht&demo=lorenplan', DESK],
  ['14-feuerplan', '/?scene=gefecht&demo=walze', DESK],
  ['15-sturm-halten', '/?scene=gefecht&demo=sturm', DESK],
  ['16-gefechtsrunde', '/?scene=gefecht&demo=gefechtsrunde', DESK],
  ['17-lehrling', '/?scene=gefecht&demo=lehrling', DESK],
  ['18-etappe', '/?scene=gefecht&demo=etappe', DESK],
  ['19-abloesung', '/?scene=gefecht&demo=abloesung', DESK],
  ['20-nacht', '/?scene=gefecht&night=1&demo=bedrohung', DESK],
  ['21-schnee', '/?scene=gefecht&weather=snow&snow=2', DESK],
  ['22-feldzug', '/?scene=feldzug&demo=mitte', DESK],
  ['23-handbuch', '/?scene=handbuch', DESK],
  ['24-handy-gefecht', '/?scene=gefecht&demo=befehle', HANDY],
  ['25-erste-befehle', '/?scene=gefecht&karte=velde&ki=rekrut', DESK],
  ['26-schnee-akt3', '/?scene=gefecht&scenario=akt3-m1&seed=5', DESK],
];

mkdirSync(OUT, { recursive: true });
const port = 8000 + Math.floor(Math.random() * 900);
const server = await startServer(port);
const browser = await chromium.launch();
let bad = 0;
try {
  for (const [name, path, device] of SHOTS) {
    if (only && !name.startsWith(only)) continue;
    const ctx = await browser.newContext(device);
    // frischer Browser ohne Fortschritt: Grundausbildung gilt als neu, Hinweise erscheinen
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const sep = path.includes('?') ? '&' : '?';
    await page.goto(`http://localhost:${port}${path}${sep}nosw`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 78 });
    console.log(`${name}.jpg${errors.length ? '  FEHLER: ' + errors.join(' | ') : ''}`);
    if (errors.length) bad++;
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close?.();
}
process.exit(bad ? 1 : 0);
