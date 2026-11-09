// Szene "frontabschnitt": Endlosmodus und Wochenlage (P22, Plan 8.3). Der Wochentisch im Unterstand:
// links die Karte des Abschnitts mit dem Zielfeld der Woche und darunter das Kerbholz (jede Woche eine Kerbe im
// Balken, Jahreszeiten angeschrieben, Punkte fuer die Namen der Woche), rechts Lage, Befehl, Stempel, die Leute.
// Nach einer Woche liegen Gefallenenliste, Wochenmeldung, Feldpost, Wochenanfang und der neue Befehl auf dem Tisch.
// Parameter: demo=neu|tisch|woche|ende (Beispielstaende ohne Speichern, fuer Screenshots), woche=<n> (Demo-Woche).
import { loadMap, applyCellState } from '../map.js';
import { createInitialState } from '../state.js';
import { initEtappen } from '../etappe-map.js';
import { createCamera, resizeCamera, centerOn, fitZoom, worldToScreen } from '../render/camera.js';
import { createMapLayer, sheetBounds } from '../render/map-layer.js';
import { themeAt, applyTheme, currentTheme } from '../theme.js';
import { FACTIONS } from '../config/factions.js';
import { BATTLE_MAPS } from '../config/battlemaps.js';
import { DIFFICULTIES } from '../config/doctrines.js';
import { SEASONS } from '../config/seasons.js';
import { unitType } from '../config/units.js';
import { FACTION_IDS, dayKey, dayLabel } from '../modes/skirmish.js';
import { loadBattle } from '../modes/load.js';
import {
  newRun, normalizeRun, baseOf, prepareWeek, generateOrder, finishWeek, stampWeek, checkRunEnd, seasonOf, isSeasonStart, enemyDifficulty,
  scoreParts, rosterOf, wochenlageBrief, weekLimit, WEEK_ROUNDS, SEASON_WEEKS,
} from '../modes/endless.js';
import { buildWeekSteps, endSheet, weekValues } from '../narrative/endless.js';
import { makeSoldierName } from '../narrative/casualties.js';
import { createRng } from '../rng.js';
import { loadTexts, loadNarrativeStyles } from '../ui/narrative/load.js';
import { playSteps } from '../ui/narrative/reader.js';
import {
  weekQuery, loadRun, saveRun, loadWeekStart, saveWeekStart, loadWeekReturn, clearWeekReturn, clearRun, bestRuns, addBestRun, weeklyBoard, addWeeklyEntry,
} from '../ui/endless/store.js';
import { esc, ensureCss } from '../ui/dom.js';
import { audio, playSfx } from '../audio/engine.js';

const fetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('Datei fehlt: ' + url); return r.json(); });
const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const newSeed = () => 1 + Math.floor(Math.random() * 99999); // nur Vorschlag im Menue, das Spiel bleibt rein
const SPIEGEL = BATTLE_MAPS.filter((m) => m.kind === 'spec');
const KIND_WORD = { halten: 'Halten', feld_nehmen: 'Feld nehmen', stosstrupp: 'Stoßtrupp', gefangene: 'Gefangene', graben_zuruecknehmen: 'Graben zurücknehmen' };
const STAMP_WORD = { befolgen: 'befolgt', umdeuten: 'umgedeutet', verweigern: 'verweigert' };
const END_WORD = {
  abschnitt_gefallen: 'Abschnitt gefallen', abgeloest: 'Abgelöst', meuterei: 'Meuterei', wochenlage: 'Wochenlage beendet', abgegeben: 'Abschnitt abgegeben',
};

/** Montag der laufenden Woche als JJJJMMTT (nur hier liest das Spiel die Uhr) */
function mondayKey(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

async function battleFor(run) {
  const b = await loadBattle(weekQuery(run), fetchJson);
  return { ...b, map: loadMap(b.mapJson) };
}

/** Neuer Lauf bis zum ersten Wochenbeginn: Anfangszustand, Grundwerte, Woche 1, Befehl */
async function startRun(choice, index) {
  const run = newRun(choice);
  const { scenario, map } = await battleFor(run);
  const fresh = initEtappen(createInitialState(map, scenario, run.seed), map, scenario);
  run.base = baseOf(fresh);
  const state = prepareWeek(fresh, run, map);
  run.order = generateOrder(index.list, run, state, map);
  return { run, state, map };
}

/** Beispielstand fuer Screenshots: ein Lauf in Woche n mit erfundenen Wochen, ohne zu spielen */
async function demoRun(index, kind, week) {
  const { run, state, map } = await startRun({ faction: 'kaldern', map: 'velde', mapSeed: 1, seed: 4242 }, index);
  const rng = createRng(77);
  const used = new Set();
  let pts = 0;
  for (let w = 1; w < week; w++) {
    const fallen = Math.floor(rng() * 4) + (w % 4 === 0 ? 3 : 0);
    const held = w % 5 !== 3;
    const gained = Math.floor(rng() * 3);
    const rescued = Math.floor(rng() * 6);
    const names = Array.from({ length: fallen }, () => makeSoldierName(rng, 'kaldern', used).name);
    for (const n of names) run.book.fallen.push({ name: n, home: '', groupLabel: '', causeText: 'gefallen', mission: 'w' + w, missionTitle: `Woche ${w}` });
    run.score.weeks += held ? 1 : 0; run.score.gained += gained; run.score.rescued += rescued; run.score.fallen += fallen;
    pts = run.score.weeks * 100 + run.score.gained * 5 + run.score.rescued * 2 - run.score.fallen * 3;
    run.score.points = pts;
    run.weeks.push({ week: w, season: seasonOf(w), held, fell: false, fallen, gained, rescued, names, points: pts, order: { titel: 'Lage unverändert', met: held, befehlsart: 'halten' }, ansehen: 50, vertrauen: 50 });
  }
  run.week = week;
  run.ansehen = 46; run.vertrauen = 58;
  const st = prepareWeek(state, run, map);
  run.order = generateOrder(index.list, run, st, map);
  if (kind === 'ende') { run.ended = 'abschnitt_gefallen'; run.endWeek = week; }
  return { run, state: st, map };
}

export async function mount(root, params) {
  await Promise.all([
    ensureCss('css/modi.css'),
    ensureCss('css/frontabschnitt.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '16px "Caveat"', '700 16px "Caveat"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();
  const index = await loadTexts();
  const demo = params.get('demo');
  root.className = 'fa';

  let run = null, state = null, map = null;
  let lastPlayed = {};
  let saveFailed = false;
  let starting = false;
  let observer = null;

  // ------------------------------------------------------------------ Woche buchen und Tisch

  async function processWeek(r0, start, ret, m) {
    const f = finishWeek(r0, { start, end: ret.finalState, rounds: ret.rounds ?? [], map: m });
    let r = f.run;
    let next = ret.finalState;
    if (!r.ended) {
      next = prepareWeek(ret.finalState, r, m);
      r.order = generateOrder(index.list, r, next, m);
    }
    // Erst der Lauf, dann der Wochenbeginn (am Ende: der Endzustand fuer die Karte). Die Meldung bleibt liegen, bis
    // beides gespeichert ist: fehlt der Wochenbeginn, baut ihn der naechste Besuch aus der Meldung neu (rein, gleich).
    const okRun = saveRun(r);
    const okStart = okRun && saveWeekStart(next);
    if (okRun && okStart) clearWeekReturn();
    else saveFailed = true;
    if (!okRun) { lastPlayed = {}; return { run: r0, state: start }; }
    lastPlayed = { record: f.record, changes: f.changes, casualties: f.casualties, rounds: ret.rounds ?? [], endState: ret.finalState };
    return { run: r, state: next };
  }

  async function playTable(input) {
    await loadNarrativeStyles();
    const steps = buildWeekSteps(index, { ...input, sector: input.map.name });
    if (!steps.length) return;
    const reader = playSteps({
      steps,
      title: input.record ? `Nach Woche ${input.record.week}` : `Frontabschnitt ${input.map.name}`,
      finishLabel: run.ended ? 'Zum Abschluss' : `Zum Wochentisch`,
      stats: () => ({ ansehen: run.ansehen, vertrauen: run.vertrauen }),
      onChoice(id, opt) {
        if (!id.startsWith('stempel-')) return [];
        run = checkRunEnd(stampWeek(run, opt));
        if (!demo) saveRun(run);
        playSfx('stamp');
        return [];
      },
    });
    await reader.done;
  }

  // ------------------------------------------------------------------ Darstellung

  function render() {
    if (!run) return renderNew();
    if (run.ended) return renderEnd();
    return renderHub();
  }

  function mapPane(title, sub) {
    return `<div class="mb-map fa-map">
      <div class="mb-sheet"><canvas aria-hidden="true"></canvas><span class="fa-ring" hidden></span></div>
      <div class="mb-cap"><span>${esc(title)}</span><span>${esc(sub)}</span></div>
      ${run ? kerbholz(run) : ''}
    </div>`;
  }

  async function drawMap(base, cells = null, target = null) {
    const sheet = root.querySelector('.mb-sheet');
    if (!sheet) return;
    const m = cells ? applyCellState(base, cells) : base;
    const cam = createCamera({ bounds: sheetBounds(m), maxZoom: 60 });
    const layer = createMapLayer(sheet.querySelector('canvas'), m, { getCamera: () => cam, getTheme: currentTheme });
    const ring = sheet.querySelector('.fa-ring');
    const fit = () => {
      const w = sheet.clientWidth, h = sheet.clientHeight;
      if (!w || !h) return;
      resizeCamera(cam, w, h);
      centerOn(cam, m.width / 2, m.height / 2, fitZoom(cam));
      layer.resize(w, h, Math.min(2, window.devicePixelRatio || 1));
      if (target && ring) {
        const p = worldToScreen(cam, target.x + 0.5, target.y + 0.5);
        const r = Math.max(14, cam.zoom * 1.6);
        Object.assign(ring.style, { left: `${p.x - r}px`, top: `${p.y - r}px`, width: `${2 * r}px`, height: `${2 * r}px` });
        ring.hidden = false;
      }
    };
    observer?.disconnect();
    observer = new ResizeObserver(fit);
    observer.observe(sheet);
    fit();
  }

  /** Kerbholz: jede Woche eine Kerbe im Balken des Unterstands; fuenfte Kerbe quer, Jahreszeiten angeschrieben */
  function kerbholz(r) {
    const weeks = r.weeks;
    const n = Math.max(weeks.length + (r.ended ? 0 : 1), 6);
    const step = 14, pad = 18, w = pad * 2 + n * step, h = 80;
    let marks = '';
    weeks.forEach((wk, i) => {
      const x = pad + i * step + step / 2;
      const deep = wk.held ? 22 : 12;
      const cross = (i + 1) % 5 === 0;
      marks += cross
        ? `<line class="kb-cut${wk.held ? '' : ' kb-weak'}" x1="${x - 5 * step}" y1="${36 + deep}" x2="${x + 2}" y2="${30}"/>`
        : `<line class="kb-cut${wk.held ? '' : ' kb-weak'}" x1="${x}" y1="${28}" x2="${x}" y2="${28 + deep}"/>`;
      if (wk.fallen) {
        const dots = Math.min(8, wk.fallen);
        for (let k = 0; k < dots; k++) marks += `<circle class="kb-dot" cx="${x - 3 + (k % 2) * 6}" cy="${61 + Math.floor(k / 2) * 4.2}" r="1.7"/>`;
      }
      if (i === 0 || isSeasonStart(wk.week)) marks += `<text class="kb-season" x="${x - 4}" y="18">${esc(SEASONS[wk.season].name)}</text>`;
    });
    if (!r.ended) {
      const x = pad + weeks.length * step + step / 2;
      marks += `<line class="kb-next" x1="${x}" y1="28" x2="${x}" y2="50"/>`;
      if (!weeks.length || isSeasonStart(r.week)) marks += `<text class="kb-season" x="${x - 4}" y="18">${esc(SEASONS[seasonOf(r.week)].name)}</text>`;
    }
    return `<figure class="fa-kerb" aria-label="Kerbholz: ${weeks.length} ${weeks.length === 1 ? 'Woche' : 'Wochen'}, ${r.book.fallen.length} Namen">
      <div class="fa-kerb-scroll"><svg viewBox="0 0 ${w} ${h}" width="${Math.round(w * 1.5)}" height="${Math.round(h * 1.5)}" aria-hidden="true">
        <rect class="kb-beam" x="4" y="24" width="${w - 8}" height="32" rx="3"/>
        <line class="kb-grain" x1="10" y1="33" x2="${w - 12}" y2="34"/><line class="kb-grain" x1="14" y1="47" x2="${w - 20}" y2="46"/>
        ${marks}
      </svg></div>
      <figcaption>Kerbholz im Unterstand: eine Kerbe je Woche, tief wenn gehalten. Punkte darunter: die Namen der Woche.</figcaption>
    </figure>`;
  }

  function axes() {
    const bar = (label, v, cls) => `<div class="fa-axis ${cls}"><span>${label}</span><span class="fa-track"><i style="width:${v}%"></i></span><b>${v}</b></div>`;
    return `<div class="fa-axes">${bar('Ansehen', run.ansehen, v(run.ansehen))}${bar('Vertrauen', run.vertrauen, v(run.vertrauen))}</div>`;
    function v(x) { return x < 25 ? 'low' : ''; }
  }

  function rosterHtml() {
    const rows = rosterOf(state, run);
    const unit = run.faction === 'morrow' ? 'Rotte' : 'Gruppe';
    return `<details class="fa-roster" open><summary>Die Leute <small>${rows.length} ${rows.length === 1 ? unit : unit === 'Rotte' ? 'Rotten' : 'Gruppen'}</small></summary>
      <ul>${rows.map((g) => `<li><span class="fa-r-l">${esc(g.label)}</span><span class="fa-r-n">${esc(g.leader)}</span>
        <span class="fa-r-t">${esc(unitType(g.type).short)} · ${g.strength}/${g.size}</span>
        <span class="fa-r-w${g.since === 1 && run.week > 4 ? ' old' : g.since === run.week && run.week > 1 ? ' new' : ''}">${g.since === run.week && run.week > 1 ? 'neu' : g.since === 1 ? `seit Woche 1` : `seit Woche ${g.since}`}</span></li>`).join('')}</ul></details>`;
  }

  function bookHtml(open = false) {
    const names = run.book.fallen;
    return `<details class="fa-book"${open ? ' open' : ''}><summary>Buch des Abschnitts <small>${names.length} ${names.length === 1 ? 'Name' : 'Namen'}</small></summary>
      ${names.length ? `<ol>${names.map((f) => `<li><span>${esc(f.name)}</span><small>${esc(f.missionTitle ?? '')}</small></li>`).join('')}</ol>` : '<p class="wb-empty">Noch kein Name.</p>'}</details>`;
  }

  function orderHtml() {
    const o = run.order;
    if (!o) return '';
    const stamp = run.stamps?.['w' + run.week];
    return `<section class="fa-order" aria-label="Stabsbefehl der Woche">
      <header><b>STABSBEFEHL ${esc(o.nr)}</b>${o.eilt ? '<em>EILT</em>' : ''}<span>${esc(o.frist)}</span></header>
      <p class="fa-tele">${esc(o.text)}</p>
      <p class="fa-o-meta">${esc(KIND_WORD[o.befehlsart] ?? '')}${o.target ? ` · Ziel Feld ${esc(o.feld)}` : ''} · erfüllt ${esc(cons(o.folgen?.erfuellt))}, verfehlt ${esc(cons(o.folgen?.verfehlt))}</p>
      ${stamp ? `<div class="fa-stamp s-${stamp}" aria-label="Stempel">${esc(STAMP_WORD[stamp])}</div>`
        : `<div class="fa-stamps" role="group" aria-label="Stempel wählen">
          <button type="button" class="btn" data-stamp="befolgen">Befolgen</button>
          <button type="button" class="btn" data-stamp="umdeuten">Umdeuten</button>
          <button type="button" class="btn" data-stamp="verweigern">Verweigern</button></div>
          <p class="fa-hint">Ohne Stempel gilt der Befehl als befolgt. Verweigern zweimal tippen.</p>`}
    </section>`;
  }
  const cons = (f) => {
    if (!f) return 'nichts';
    const p = [];
    if (f.ansehen) p.push(`Ansehen ${f.ansehen > 0 ? '+' : '−'}${Math.abs(f.ansehen)}`);
    if (f.vertrauen) p.push(`Vertrauen ${f.vertrauen > 0 ? '+' : '−'}${Math.abs(f.vertrauen)}`);
    return p.join(', ') || 'nichts';
  };

  function scoreTable() {
    const parts = scoreParts(run.score);
    return `<table class="rm-points"><tbody>${parts.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.count} × ${p.per > 0 ? p.per : '−' + -p.per}</td><td>${p.count * p.per < 0 ? '−' + -(p.count * p.per) : p.count * p.per}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="2">Punkte</td><td>${run.score.points}</td></tr></tfoot></table>`;
  }

  function renderHub() {
    const season = SEASONS[seasonOf(run.week)];
    const nextSeason = SEASONS[seasonOf(run.week + SEASON_WEEKS - ((run.week - 1) % SEASON_WEEKS))];
    const left = SEASON_WEEKS - ((run.week - 1) % SEASON_WEEKS);
    const wl = run.mode === 'wochenlage';
    const f = FACTIONS[run.faction];
    root.innerHTML = `
      ${mapPane(map.sheet?.title || map.name, `${f.short} · Seed ${run.map === 'zufall' ? run.mapSeed : run.seed}`)}
      <section class="mb-form card fa-card" aria-label="Frontabschnitt">
        <div class="fa-head"><span class="mb-sub">${wl ? `Wochenlage · ${esc(dayLabel(run.key))}` : 'Frontabschnitt'}</span>
          <h1>Woche ${run.week}${wl ? ` von ${weekLimit(run)}` : ''}</h1>
          <p class="fa-season">${esc(season.name)}${wl ? `, noch ${weekLimit(run) - run.week + 1} ${weekLimit(run) - run.week + 1 === 1 ? 'Woche' : 'Wochen'} bis zur Übergabe` : left > 1 ? `, noch ${left} Wochen bis zum ${esc(nextSeason.name)}` : `, letzte Woche vor dem ${esc(nextSeason.name)}`}</p></div>
        ${axes()}
        <dl class="fa-facts">
          <div><dt>Punkte</dt><dd>${run.score.points}</dd></div>
          <div><dt>Gehalten</dt><dd>${run.score.weeks} von ${run.weeks.length}</dd></div>
          <div><dt>Drüben</dt><dd>${esc(DIFFICULTIES[enemyDifficulty(run.week)].label)}</dd></div>
          <div><dt>Namen</dt><dd>${run.book.fallen.length}</dd></div>
        </dl>
        ${saveFailed ? '<p class="fa-warn" role="alert">Der Browser nimmt den Stand nicht an (Speicher voll oder gesperrt). Bitte Speicher freigeben und die Seite neu laden, sonst geht die Woche verloren.</p>' : ''}
        ${orderHtml()}
        <div class="mb-go fa-go">
          <a class="btn mb-start fa-start" href="?${esc(weekQuery(run).toString())}">Zur Woche ${run.week} <small>${WEEK_ROUNDS} Stellungsrunden</small></a>
        </div>
        ${rosterHtml()}
        ${bookHtml()}
        <div class="fa-foot">
          <button type="button" class="btn fa-giveup">Abschnitt abgeben</button>
          <a class="mb-back" href="./">Zurück zum Hauptmenü</a>
        </div>
      </section>`;
    drawMap(map, state?.cells ?? null, run.order?.target ?? null);
    bindHub();
  }

  function bindHub() {
    let armed = null;
    for (const b of root.querySelectorAll('[data-stamp]')) {
      b.addEventListener('click', () => {
        const s = b.dataset.stamp;
        if (s === 'verweigern' && armed !== s) {
          armed = s;
          b.textContent = 'Wirklich verweigern?';
          playSfx('paper', { intensity: 0.4 });
          return;
        }
        run = checkRunEnd(stampWeek(run, s));
        if (!demo) saveRun(run);
        playSfx('stamp');
        render();
      });
    }
    let giving = false;
    root.querySelector('.fa-giveup').addEventListener('click', (e) => {
      if (!giving) { giving = true; e.target.textContent = 'Wirklich abgeben? Der Lauf endet.'; return; }
      run = { ...run, ended: 'abgegeben', endWeek: run.week };
      if (!demo) saveRun(run);
      playSfx('stamp');
      render();
    });
    root.querySelector('.fa-start').addEventListener('click', (e) => {
      if (demo) { e.preventDefault(); return; }
      playSfx('stamp');
    });
  }

  function renderEnd() {
    const wl = run.mode === 'wochenlage';
    const values = weekValues(run, state, { abschnitt: map.name, stab: index.list.find((x) => x.art === 'endlos-stab' && x.fraktion === run.faction)?.text ?? 'STAB' });
    const sheet = run.ended === 'abgegeben'
      ? { body: `Nach ${run.weeks.length} ${run.weeks.length === 1 ? 'Woche' : 'Wochen'} übergibt die Abschnittsführung an die nächste Einheit.` }
      : endSheet(index, run, values);
    const text = sheet.body ?? (sheet.lines ?? []).join(' ');
    const board = wl ? weeklyBoard(run.key) : bestRuns();
    const signed = run.signed;
    root.innerHTML = `
      ${mapPane(map.sheet?.title || map.name, `${run.weeks.length} ${run.weeks.length === 1 ? 'Woche' : 'Wochen'}`)}
      <section class="mb-form card fa-card fa-end" aria-label="Ende des Abschnitts">
        <div class="fa-head"><span class="mb-sub">${wl ? `Wochenlage · ${esc(dayLabel(run.key))}` : 'Frontabschnitt'}</span>
          <h1>Ende in Woche ${run.endWeek ?? run.week}</h1></div>
        <div class="rm-stamp fa-end-stamp s-${run.ended === 'wochenlage' || run.ended === 'abgegeben' ? 'won' : 'lost'}" aria-hidden="true">${esc(END_WORD[run.ended] ?? 'Ende')}</div>
        <p class="fa-endtext">${esc(text)}</p>
        ${scoreTable()}
        <div class="wachbuch"><b class="wb-title">${wl ? `Wochenbuch, ${esc(dayLabel(run.key))}` : 'Die längsten Abschnitte'}</b>
          ${board.length ? `<ol>${board.slice(0, 8).map((e, i) => `<li${e.at === signed ? ' class="new"' : ''}><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${e.weeks ?? ''} W.</span><b>${e.points}</b></li>`).join('')}</ol>` : '<p class="wb-empty">Noch kein Eintrag auf diesem Gerät.</p>'}
          ${signed || demo ? '' : `<form class="rm-sign"><label>Unterschrift <input name="n" maxlength="24" autocomplete="nickname"></label><button class="btn" type="submit">Eintragen</button></form>`}
          <small class="wb-hint">Nur auf diesem Gerät. Eine Bestenliste für alle gibt es erst, wenn der Server die Befehle nachrechnet.</small></div>
        <section class="fa-names" aria-label="Buch des Abschnitts">
          <b>Buch des Abschnitts</b>
          ${run.book.fallen.length ? `<p class="fa-names-list">${run.book.fallen.map((f) => esc(f.name)).join(' · ')}</p><p class="fa-names-sum">${run.book.fallen.length}</p>` : '<p class="wb-empty">Kein Name.</p>'}
        </section>
        <div class="fa-foot">
          <button type="button" class="btn fa-new">Neuen Abschnitt übernehmen</button>
          <a class="mb-back" href="./">Zurück zum Hauptmenü</a>
        </div>
      </section>`;
    drawMap(map, state?.cells ?? null, null);
    root.querySelector('.rm-sign')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = e.target.querySelector('input').value.trim() || 'Ohne Namen';
      const at = Date.now();
      const entry = { name, points: run.score.points, faction: run.faction, weeks: run.weeks.length, at };
      if (wl) addWeeklyEntry(run.key, entry); else addBestRun(entry);
      run = { ...run, signed: at };
      saveRun(run);
      playSfx('pencil', { count: 5, intensity: 0.5 });
      render();
    });
    root.querySelector('.fa-new').addEventListener('click', () => {
      if (!demo) clearRun();
      run = null; state = null;
      render();
    });
  }

  // ------------------------------------------------------------------ Neuer Abschnitt

  function renderNew() {
    const key = mondayKey();
    const brief = wochenlageBrief(key);
    const wb = weeklyBoard(key);
    const best = bestRuns();
    const choice = {
      map: ['zufall', ...SPIEGEL.map((m) => m.id)].includes(params.get('karte')) ? params.get('karte') : 'velde',
      mapSeed: (num(params.get('kseed'), 0) >>> 0) || newSeed(),
      faction: FACTION_IDS.includes(params.get('fraktion')) ? params.get('fraktion') : 'kaldern',
    };
    const opts = [...SPIEGEL.map((m) => ({ id: m.id, label: m.name, sub: 'handgezeichnet' })), { id: 'zufall', label: 'Zufallskarte', sub: 'aus einem Seed' }];
    const radio = (name, list, cur) => list.map((o) => `<label class="mb-opt"><input type="radio" name="${name}" value="${esc(o.id)}"${String(o.id) === String(cur) ? ' checked' : ''}><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</label>`).join('');
    root.innerHTML = `
      <div class="mb-map fa-map">
        <div class="mb-sheet"><canvas aria-hidden="true"></canvas></div>
        <div class="mb-cap"><span class="mb-name"></span><span>Derselbe Abschnitt, Woche um Woche</span></div>
        <p class="mb-blurb">Dieselben Leute, derselbe Graben. Alle sechs Wochen eine neue Jahreszeit, drüben wird es jede Woche schwerer. Es endet, wenn der Abschnitt fällt, der Stab die Abschnittsführung ablöst oder die Truppe nicht mehr geht.</p>
      </div>
      <div class="fa-side">
      <form class="mb-form card fa-new-form" aria-label="Frontabschnitt übernehmen">
        <h1>Frontabschnitt</h1>
        <p class="mb-sub">Endlosmodus. Eine Woche sind 14 Stellungsrunden, danach liegen Liste, Post und der nächste Stabsbefehl auf dem Tisch.</p>
        <fieldset class="mb-field"><legend>Abschnitt</legend><div class="mb-opts">${radio('karte', opts, choice.map)}</div>
          <div class="mb-seed"${choice.map === 'zufall' ? '' : ' hidden'}><input type="text" inputmode="numeric" maxlength="9" aria-label="Seed der Zufallskarte" value="${choice.mapSeed}"><button type="button" class="btn mb-roll">Neu würfeln</button></div>
        </fieldset>
        <fieldset class="mb-field"><legend>Du führst</legend><div class="mb-opts">${radio('fraktion', FACTION_IDS.map((id) => ({ id, label: FACTIONS[id].name, sub: id === 'kaldern' ? 'wenig Ersatz, präzise Artillerie' : 'viel Ersatz, zäh, Artillerie streut' })), choice.faction)}</div></fieldset>
        <p class="fa-score-rule">Punkte: Woche gehalten 100, Grabenfeld gewonnen 5, Verwundeter geborgen 2, Gefallener −3.</p>
        ${best.length ? `<div class="wachbuch"><b class="wb-title">Die längsten Abschnitte</b><ol>${best.slice(0, 5).map((e, i) => `<li><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${e.weeks} W.</span><b>${e.points}</b></li>`).join('')}</ol></div>` : ''}
        <div class="mb-go">
          <button type="submit" class="btn mb-start">Abschnitt übernehmen</button>
        </div>
      </form>
      <section class="mb-form card fa-weekly" aria-label="Wochenlage">
        <div class="tl-head"><span class="mb-sub" style="margin:0">Wochenlage</span><b class="tl-date">ab ${esc(dayLabel(key))}</b></div>
        <p class="mb-sub" style="margin:0">Vier Wochen im selben Abschnitt, für alle dieselbe Lage: ${esc(FACTIONS[brief.faction].name)}, Zufallskarte ${brief.mapSeed}.</p>
        ${wb.length ? `<div class="wachbuch"><ol>${wb.slice(0, 5).map((e, i) => `<li><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${e.weeks} W.</span><b>${e.points}</b></li>`).join('')}</ol></div>` : '<p class="wb-empty">Diese Woche hat noch niemand auf diesem Gerät gemeldet.</p>'}
        <button type="button" class="btn fa-weekly-go">Wochenlage annehmen</button>
      </section>
      <a class="mb-back fa-back" href="./">Zurück zum Hauptmenü</a>
      </div>`;
    const form = root.querySelector('.fa-new-form');
    const seedBox = root.querySelector('.mb-seed');
    const seedInput = seedBox.querySelector('input');
    let token = 0;
    const preview = async () => {
      const my = ++token;
      const r0 = newRun({ ...choice, mode: 'endlos' });
      const b = await battleFor(r0);
      if (my !== token) return;
      root.querySelector('.mb-name').textContent = b.map.sheet?.title || b.map.name;
      const sheet = root.querySelector('.mb-sheet');
      const old = sheet.querySelector('canvas');
      const cv = document.createElement('canvas');
      cv.setAttribute('aria-hidden', 'true');
      old.replaceWith(cv);
      await drawMap(b.map);
    };
    form.addEventListener('change', (e) => {
      const t = e.target;
      if (t.name === 'karte') { choice.map = t.value; seedBox.hidden = choice.map !== 'zufall'; } else if (t.name === 'fraktion') choice.faction = t.value; else return;
      playSfx('paper', { intensity: 0.3 });
      preview();
    });
    seedInput.addEventListener('change', () => {
      choice.mapSeed = (Number(seedInput.value.replace(/\D/g, '')) >>> 0) || 1;
      seedInput.value = String(choice.mapSeed);
      preview();
    });
    root.querySelector('.mb-roll').addEventListener('click', () => {
      choice.mapSeed = newSeed();
      seedInput.value = String(choice.mapSeed);
      playSfx('pencil', { count: 2, intensity: 0.4 });
      preview();
    });
    const begin = async (c) => {
      if (demo || starting) return;
      starting = true;
      for (const b of root.querySelectorAll('.mb-start, .fa-weekly-go')) b.disabled = true;
      playSfx('stamp');
      const s = await startRun({ ...c, runId: Date.now() % 1e9 }, index);
      run = s.run; state = s.state; map = s.map;
      saveWeekStart(state);
      saveRun(run);
      await playTable({ run, state, map });
      render();
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (choice.map === 'zufall') choice.mapSeed = (Number(seedInput.value.replace(/\D/g, '')) >>> 0) || 1;
      begin({ mode: 'endlos', faction: choice.faction, map: choice.map, mapSeed: choice.mapSeed, seed: newSeed() * 7 + 3 });
    });
    root.querySelector('.fa-weekly-go').addEventListener('click', () => begin(brief));
    preview();
  }

  // ------------------------------------------------------------------ Start
  if (demo === 'tisch' || demo === 'ende' || demo === 'woche') {
    ({ run, state, map } = await demoRun(index, demo, Math.max(2, Math.min(40, num(params.get('woche'), 9)))));
    if (demo === 'woche') {
      // Tisch nach einer Woche: Liste, Meldung, Feldpost, Wochenanfang, Befehl, Stempel
      const record = { ...run.weeks[run.weeks.length - 1], order: { titel: 'Lage unverändert', met: true, why: 'Kein Feld aufgegeben.' }, lostGround: 0, points: run.score.points };
      const casualties = { fallen: record.names.map((name, i) => ({ name, groupLabel: `${i + 1}. Gruppe`, turn: 3 + i, causeText: 'gefallen' })), wounded: [] };
      const changes = [{ axis: 'ansehen', amount: 4, reason: 'Stabsbefehl W8 erfüllt.' }, { axis: 'vertrauen', amount: -3, reason: 'Ablösungen, Gruppen zu lange vorn, liegen gelassene Verwundete.' }];
      await playTable({ run, state, map, record, changes, casualties, rounds: [], endState: state });
    }
  } else if (demo !== 'neu') {
    const stored = loadRun();
    if (stored) {
      run = normalizeRun(stored);
      state = loadWeekStart();
      map = (await battleFor(run)).map;
      if (!state && !run.ended) { clearRun(); run = null; } // Wochenbeginn verloren (Speicher geleert): neu anfangen
      const ret = loadWeekReturn();
      // Lauf gebucht, Wochenbeginn aber nicht gespeichert: aus der liegengebliebenen Meldung neu bauen
      if (run && ret && ret.week === run.week - 1 && state?.endless?.week !== run.week) {
        state = run.ended ? ret.finalState : prepareWeek(ret.finalState, run, map);
        if (saveWeekStart(state)) clearWeekReturn(); else saveFailed = true;
      }
      if (run && ret && !run.ended && ret.week === run.week && state?.endless?.week === run.week) {
        ({ run, state } = await processWeek(run, state, ret, map));
        if (lastPlayed.record) await playTable({ run, state, map, ...lastPlayed });
      } else if (run && ret && ret.week !== run.week - 1 && (run.ended || ret.week !== run.week)) clearWeekReturn(); // alte Meldung
    }
  }
  render();
}
