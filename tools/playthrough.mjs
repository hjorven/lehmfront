#!/usr/bin/env node
// Durchspielen im Browser (P21): Spielmodi laden, Runden ohne eigene Befehle ausfuehren (die KI handelt), Phasenfilm
// ueberspringen, Uebergaben bestaetigen. Meldet Konsolenfehler, Rundenzeiten und wie die Partie endet.
//
//   node tools/playthrough.mjs                       alle Modi, Desktop
//   node tools/playthrough.mjs --handy --throttle 4  Handy 390 x 844, CPU 4x gedrosselt (Leistung)
//   node tools/playthrough.mjs --only hotseat --rounds 6 --shots
//
// Startet einen eigenen Server (Port 8093, mit --port aenderbar). Die Bildzeit misst ein volles Neuzeichnen je Bild
// (Kamera verschoben plus resize), also eher den schlechtesten Fall beim Ziehen der Karte.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const flag = (k) => argv.includes('--' + k);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const PORT = Number(opt('port', 8093));
const ROUNDS = Number(opt('rounds', 12));
const THROTTLE = Number(opt('throttle', 1));
const HANDY = flag('handy');
const SHOTS = flag('shots');

const MODES = [
  { id: 'frei', path: '/?scene=gefecht&seed=11' },
  { id: 'zufall', path: '/?scene=gefecht&karte=zufall&kseed=7&seed=7&runden=8' },
  { id: 'hotseat', path: '/?scene=gefecht&karte=zufall&kseed=3&seed=3&mode=hotseat&runden=6' },
  { id: 'tageslage', path: '/?scene=gefecht&tageslage=20261109' },
  { id: 'akt1', path: '/?scene=gefecht&scenario=akt1-m1&campaign=1&seed=4' },
  { id: 'feldzug', path: '/?scene=feldzug&neu=1' },
  { id: 'akt2', path: '/?scene=gefecht&scenario=akt2-m2&seed=4' },
];
const only = opt('only', null);
// evaluate, das einen Seitenwechsel (Mission zu Ende, zurueck zur Feldzugskarte) als Ergebnis meldet statt zu werfen
const ev = async (page, fn, arg) => { try { return await page.evaluate(fn, arg); } catch (e) { if (/destroyed|navigation/i.test(e.message)) return 'navigiert'; throw e; } };

const server = spawn(process.execPath, ['tools/serve.mjs', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));
const browser = await chromium.launch();
const results = [];
try {
  for (const m of MODES.filter((x) => !only || x.id === only)) {
    const ctx = await browser.newContext(HANDY
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 }
      : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
    if (THROTTLE > 1) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }); }
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}${m.path}`);
    // Kampagne: Zeitungen, Briefing und Stabsbefehl durchblaettern, bis die Lagekarte steht
    const steps = [];
    for (let k = 0; k < 60; k++) {
      await page.waitForTimeout(400);
      const did = await ev(page, () => {
        if (window.__gefecht) return null;
        const vis = [...document.querySelectorAll('button, a.btn')].filter((b) => b.offsetParent !== null && !b.disabled);
        const pick = vis.find((b) => /^(Weiter|Zum Einsatz|Einsatz beginnen|Beginnen|Befolgen|Annehmen|Los|Zur Lage|Lesen beendet|Ablegen)/i.test(b.textContent.trim()));
        if (!pick) return '';
        pick.click();
        return pick.textContent.trim().slice(0, 30);
      });
      if (did === null) break;
      if (did) steps.push(did);
    }
    try { await page.waitForFunction(() => !!window.__gefecht, null, { timeout: 30000 }); } catch {
      if (SHOTS) await page.screenshot({ path: `shots/durchlauf-${m.id}-haengt.png` });
      results.push({ mode: m.id, loadMs: Date.now() - t0, rounds: 0, ended: false, avgRoundMs: 0, maxRoundMs: 0, frameMs: 0, frameP95: 0, turn: 0, errors: [...errors, 'Szene nicht geladen'] });
      await ctx.close();
      continue;
    }
    const loadMs = Date.now() - t0;
    const times = [];
    let ended = false, rounds = 0, endedBy = '';
    for (; rounds < ROUNDS && !ended; rounds++) {
      const turn = await ev(page, () => window.__gefecht?.state.turn ?? 'navigiert');
      if (turn === 'navigiert') { ended = true; break; }
      const s = Date.now();
      await ev(page, () => window.__gefecht.commit());
      // bis die naechste Runde steht: Film ueberspringen, Uebergaben bestaetigen
      for (let k = 0; k < 400; k++) {
        await page.waitForTimeout(100);
        const st = await ev(page, (TURN) => {
          const vis = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent !== null);
          const skip = vis('.film .skip');
          if (skip) { skip.click(); return 'film'; }
          const hand = vis('.handover .go');
          if (hand && !hand.dataset.pt) {
            // Siegel halten (700 ms) wie ein Mensch: Taste druecken, spaeter loslassen
            hand.dataset.pt = '1';
            hand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            return 'handover';
          }
          if (hand) return 'handover';
          const g = window.__gefecht;
          if (g.state.result || vis('.rm, .mission-end, .ms-end')) return 'ende';
          // Hotseat: nach der Uebergabe plant die andere Seite; ohne Befehle gleich weiter
          const sideNow = g.side ?? 'a';
          if (!document.querySelector('.modal-back') && g.book?.[sideNow] && !g.book[sideNow].sealed && g.state.turn === TURN && !vis('.film')) { g.commit(); return 'commit'; }
          return g.state.turn;
        }, turn);
        if (st === 'ende' || st === 'navigiert') { ended = true; endedBy = st; break; }
        if (typeof st === 'number' && st > turn && !(await ev(page, () => !!document.querySelector('.film:not([hidden])')))) break;
      }
      times.push(Date.now() - s);
      if (ended) break;
    }
    if (endedBy === 'navigiert') await page.waitForTimeout(1500);
    // Bildwiederholung beim Verschieben der Karte (Leistung)
    const fpsRaw = (await ev(page, async () => {
      if (!window.__gefecht) return [];
      const g = window.__gefecht; const frames = []; let last = performance.now();
      const cv = document.querySelector('.g-dyn');
      const r = cv.getBoundingClientRect();
      return await new Promise((res) => {
        let i = 0;
        const step = (t) => {
          frames.push(t - last); last = t;
          g.cam.x += 0.15; cv.dispatchEvent(new Event('lf-camera'));
          window.dispatchEvent(new Event('resize'));
          if (++i < 60) requestAnimationFrame(step); else res(frames.slice(5));
        };
        requestAnimationFrame(step);
      });
    }));
    const fps = Array.isArray(fpsRaw) ? fpsRaw : [];
    const avg = (a) => Math.round(a.reduce((s, v) => s + v, 0) / Math.max(1, a.length));
    const p95 = (a) => Math.round([...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0);
    if (SHOTS) { mkdirSync('shots', { recursive: true }); await page.screenshot({ path: `shots/durchlauf-${m.id}${HANDY ? '-handy' : ''}.png` }); }
    const state = (await ev(page, () => ({ turn: window.__gefecht?.state.turn ?? 0, scene: new URLSearchParams(location.search).get('scene') }))) || {};
    results.push({ mode: m.id, steps, loadMs, rounds, ended, endedBy, scene: state.scene, avgRoundMs: avg(times), maxRoundMs: Math.max(0, ...times), frameMs: avg(fps), frameP95: p95(fps), turn: state.turn, errors });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
let bad = 0;
for (const r of results) {
  console.log(`${r.mode.padEnd(10)} geladen ${r.loadMs} ms, ${r.rounds} Runden${r.ended ? ` (Ende: ${r.endedBy === 'navigiert' ? 'weiter zu ' + r.scene : 'Abschlussmeldung'})` : ''}, Runde im Mittel ${r.avgRoundMs} ms (max ${r.maxRoundMs}), Bild ${r.frameMs} ms (p95 ${r.frameP95}), Zug ${r.turn}`);
  if (r.steps?.length) console.log('   Blätter: ' + r.steps.join(' > '));
  for (const e of [...new Set(r.errors)].slice(0, 8)) { console.log('   ' + e); bad++; }
}
process.exit(bad ? 1 : 0);
