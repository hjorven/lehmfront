// Screenshots: node shoot.mjs [quick|styles|features|gif|all]
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { mkdirSync } from 'node:fs';

const mode = process.argv[2] || 'quick';
const HTML = pathToFileURL('lehmfront-ui.html').href;
const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

const STYLES = ['karte','blaupause','telegramm','nacht','sandkasten','aquarell','hud','linolschnitt','kriegsraum','zeitung'];
const browser = await chromium.launch();
const scale = mode === 'quick' ? 1 : 2;
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: scale });
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await page.goto(HTML);
await page.evaluate(() => document.body.classList.add('shot'));
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

async function setStyle(s) { await page.evaluate(s => window.__setStyle(s), s); await page.waitForTimeout(150); }
async function setView(v) { await page.evaluate(v => window.__setView(v), v); await page.waitForTimeout(150); }

if (mode === 'quick') {
  await setView('battle'); await setStyle('karte');
  await page.screenshot({ path: `${OUT}/quick-battle.png` });
  await setView('features');
  await page.evaluate(() => { window.__f8open(); window.__f9set(.62); window.__f3trav(); });
  await page.waitForTimeout(150);
  for (const id of ['f1','f2','f3','f4','f5','f6','f7','f8','f9','f10']) {
    await page.locator('#' + id).scrollIntoViewIfNeeded();
    await page.locator('#' + id).screenshot({ path: `${OUT}/quick-${id}.png` });
  }
}

if (mode === 'styles' || mode === 'all') {
  await setView('battle');
  for (const [i, s] of STYLES.entries()) {
    await setStyle(s);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/style-${String(i + 1).padStart(2, '0')}-${s}.png` });
    console.log('style', s);
  }
}

if (mode === 'features' || mode === 'all') {
  await setView('features'); await setStyle('karte');
  await page.evaluate(() => { window.__f8open(); window.__f9set(.62); window.__f3trav(); window.__f1set(58, -28); window.__f10tilt(1, -6, 9); window.__f5set(true); });
  await page.waitForTimeout(200);
  for (const [i, id] of ['f1','f2','f3','f4','f5','f6','f7','f8','f9','f10'].entries()) {
    const loc = page.locator('#' + id);
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(80);
    await loc.screenshot({ path: `${OUT}/feat-${String(i + 1).padStart(2, '0')}.png` });
    console.log('feature', id);
  }
}

if (mode === 'gif' || mode === 'all') {
  // Bildfolge für das 3D-Etappenfenster
  await setView('features'); await setStyle('karte');
  const loc = page.locator('#f1 .demo');
  await loc.scrollIntoViewIfNeeded();
  mkdirSync(`${OUT}/gif`, { recursive: true });
  const N = 28;
  for (let k = 0; k < N; k++) {
    const spin = -60 + k * (120 / (N - 1));
    const tilt = 58 - Math.sin(k / (N - 1) * Math.PI) * 25;
    await page.evaluate(([t, s]) => window.__f1set(t, s), [tilt, spin]);
    await page.waitForTimeout(30);
    await loc.screenshot({ path: `${OUT}/gif/f-${String(k).padStart(2, '0')}.png` });
  }
  console.log('gif frames', N);
}

if (mode === 'daynight' || mode === 'all') {
  await setView('battle'); await setStyle('karte');
  const states = [[0,'tag'],[0.42,'abend'],[0.72,'daemmerung'],[1,'nacht']];
  for (const [t, n] of states) {
    await page.evaluate(t => window.__setDayNight(t), t);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${OUT}/tagnacht-${n}.png` });
  }
  await page.evaluate(() => window.__setDayNight(0));
  console.log('daynight');
}

await browser.close();
