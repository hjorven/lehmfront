// Screenshots fuer die Pruefung nach UI-Aenderungen.
// Aufrufe:
//   node tools/shot.mjs                          Startseite, Desktop und Handy, nach shots/
//   node tools/shot.mjs --path "/?debug=1" --name gefecht
//   node tools/shot.mjs --dark                   zusaetzlich mit prefers-color-scheme: dark
//   node tools/shot.mjs --check                  nur pruefen: keine Konsolenfehler, keine 404 (fuer CI)
// Playwright ist im Container vorinstalliert; lokal sonst: npm i -D playwright && npx playwright install chromium
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const path = opt('--path', '/');
const name = opt('--name', 'start');
const check = args.includes('--check');
const dark = args.includes('--dark');
const port = 8000 + Math.floor(Math.random() * 900);

const server = await startServer(port);
const browser = await chromium.launch();
const errors = [];
const viewports = [
  { label: 'desktop', viewport: { width: 1280, height: 800 } },
  { label: 'handy', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];
const schemes = dark ? ['light', 'dark'] : ['light'];
mkdirSync('shots', { recursive: true });

for (const vp of viewports) {
  for (const scheme of schemes) {
    const ctx = await browser.newContext({ viewport: vp.viewport, isMobile: vp.isMobile, hasTouch: vp.hasTouch, deviceScaleFactor: 1, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.label}] console: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${vp.label}] pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${vp.label}] HTTP ${r.status()} ${r.url()}`); });
    await page.goto(`http://localhost:${port}${path}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    if (!check) {
      const file = `shots/${name}-${vp.label}${scheme === 'dark' ? '-dunkel' : ''}.png`;
      await page.screenshot({ path: file });
      console.log('Screenshot:', file);
    }
    await ctx.close();
  }
}

await browser.close();
server.close();
if (errors.length) {
  console.error('Fehler gefunden:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(check ? 'Pruefung ok: keine Konsolenfehler, keine fehlenden Dateien' : 'fertig');
