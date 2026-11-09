// Dienstbuch (P18): Einstellungen, Spielstaende, Klang und Tastenbelegung in einem Dialog.
// Im Hauptmenue und im Gefecht derselbe Dialog; im Gefecht kommt "Hier ablegen" dazu (game.save).
// Spielstaende liegen als Kartentaschen nebeneinander, jede mit einer Bleistiftskizze der Front.
// Barrierefreiheit: role=dialog mit aria-modal, Registerreiter als tablist (Pfeiltasten), Fokus bleibt im
// Dialog (Tab kreist), Esc schliesst und gibt den Fokus an den ausloesenden Knopf zurueck.
import { esc, ensureCss } from './dom.js';
import { soundPanel } from './sound.js';
import { getSettings, setSettings, resetSettings, onSettingsChange, SETTING_CHOICES } from '../settings.js';
import { createSaveStore, exportSave, inspectSave } from '../save.js';
import { SLOTS, AUTO_SLOT, freeSlot, exportName, slotTitle, loadHref } from '../savegame.js';
import { playSfx } from '../audio/engine.js';
import { packBackup, readBackup, collectLocal, restoreLocal, BACKUP_MAX } from '../backup.js';

export const TABS = [
  ['akten', 'Spielstände'],
  ['klang', 'Klang'],
  ['ansicht', 'Darstellung'],
  ['tasten', 'Tasten'],
];

const LABELS = {
  speed: ['Animationstempo', { 0.5: 'langsam', 1: 'normal', 1.5: 'zügig', 2: 'schnell' }, 'Phasenfilm, Fernschreiber und Kärtchen.'],
  motion: ['Bewegung', { auto: 'wie das Gerät', reduce: 'reduziert' }, 'Reduziert: keine Erschütterung, kein Wind, der Film springt von Halt zu Halt.'],
  text: ['Textgröße', { 0.9: 'klein', 1: 'normal', 1.15: 'groß', 1.3: 'sehr groß' }, 'Kärtchen, Telegramm, Protokoll und Menüs.'],
  signs: ['Signaturen', { false: 'nur Farbe', true: 'Farbe und Form' }, 'Gegner mit Doppelrahmen, Warnzeilen mit Zeichen. Hilft bei Farbsehschwäche.'],
  contrast: ['Kontrast', { false: 'normal', true: 'hoch' }, 'Kräftigere Linien und Hilfstexte, auch in der Dämmerung.'],
  tap: ['Ziel antippen', { confirm: 'vormerken, dann setzen', direct: 'sofort setzen' }, 'Nur mit dem Finger: Das erste Antippen zeichnet das Ziel mit Bleistift vor und zeigt Weg und Kosten, das zweite setzt den Befehl.'],
  hud: ['Kärtchen im Gefecht', { auto: 'nach Gerät', tidy: 'aufgeräumt', full: 'alle offen' }, 'Aufgeräumt: Vorräte, Runde und Prüfliste stecken in einer Kopfleiste, die Karte bleibt frei. Nach Gerät heißt aufgeräumt auf Tablets.'],
};

// Feste Tasten (Plan 7.6); die Werkzeuge melden ihre Tasten selbst im Register an
export const FIXED_KEYS = [
  ['Gefecht', [
    ['Leertaste', 'nächste Gruppe ohne Befehl'],
    ['Enter', 'Runde ausführen (Übersicht)'],
    ['Tab', 'Befehlsliste'],
    ['1 bis 4', 'Overlays schalten'],
    ['P', 'Protokoll der Mission'],
    ['T', 'Taktik-Lehrling'],
    ['O', 'dieses Dienstbuch'],
    ['^', 'Karte frei (Kärtchen beiseiteschieben)'],
    ['Strg + Z', 'letzten Befehl zurücknehmen'],
    ['Pfeile', 'Karte schieben; bei der Zielwahl Enter für das Feld in der Mitte'],
    ['Esc', 'schließen, abbrechen, Auswahl aufheben'],
  ]],
  ['Phasenfilm', [
    ['Enter oder Leertaste', 'weiter zur nächsten Phase'],
    ['Pfeil links und rechts', 'Phase zurück oder vor'],
    ['Esc', 'Film überspringen'],
  ]],
];

// Gegenstuecke der Tasten fuer Touch (Handy, Tablet)
export const TOUCH = [
  ['Gruppe antippen', 'wählen; Befehl unten in der Werkzeugreihe'],
  ['Lang drücken', 'Befehle der Gruppe im Kreis'],
  ['Ziel antippen', 'vormerken (Bleistift), noch einmal antippen setzt den Befehl'],
  ['Ziehen, zwei Finger', 'Karte schieben und zoomen'],
  ['Lasche an der Werkzeugreihe', 'weitere Befehle; die Zahl sagt, wie viele noch verdeckt sind'],
  ['„Vor der Runde“', 'Prüfpunkt antippen springt zur Gruppe (wie Leertaste)'],
  ['Befehle, Overlays, Lehrling, Menü', 'Knöpfe oben rechts (wie Tab, 1 bis 4, T, O)'],
];

let open = null;

/**
 * openSettings({ tab, game, container, opener, onClose })
 * game (nur im Gefecht): { canSave() -> null | Grund, save(slot) -> Promise }
 */
export function openSettings({ tab = 'akten', game = null, container = document.body, opener = document.activeElement, onClose = () => {} } = {}) {
  if (open) { open.select(tab); return open; }
  ensureCss('css/einstellungen.css');
  ensureCss('css/sound.css');
  const store = createSaveStore();
  const back = document.createElement('div');
  back.className = 'set-back';
  back.innerHTML = `
    <section class="card settings" role="dialog" aria-modal="true" aria-labelledby="set-title">
      <header class="set-head">
        <h2 id="set-title">Dienstbuch</h2>
        <span class="set-sub">Einstellungen und Akten</span>
        <button type="button" class="x" aria-label="Dienstbuch schließen">×</button>
      </header>
      <nav class="set-tabs" role="tablist" aria-label="Abschnitte">
        ${TABS.map(([id, label]) => `<button type="button" role="tab" id="set-tab-${id}" aria-controls="set-panel-${id}" data-tab="${id}">${esc(label)}</button>`).join('')}
      </nav>
      ${TABS.map(([id]) => `<div class="set-panel" role="tabpanel" id="set-panel-${id}" aria-labelledby="set-tab-${id}" tabindex="0" hidden></div>`).join('')}
      <p class="set-status" role="status" aria-live="polite"></p>
    </section>`;
  container.append(back);
  const dlg = back.querySelector('.settings');
  const $ = (s) => dlg.querySelector(s);
  const status = $('.set-status');
  let current = null;
  let sound = null;
  const cleanups = [];

  function say(text, tone = '') {
    status.textContent = text;
    status.className = 'set-status' + (tone ? ' ' + tone : '');
  }

  function select(id, focus = false) {
    if (!TABS.some(([t]) => t === id)) id = 'akten';
    current = id;
    for (const b of dlg.querySelectorAll('[role="tab"]')) {
      const on = b.dataset.tab === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const p of dlg.querySelectorAll('.set-panel')) p.hidden = p.id !== 'set-panel-' + id;
    const panel = $('#set-panel-' + id);
    if (id === 'akten') renderSaves(panel);
    else if (id === 'klang' && !sound) { sound = soundPanel({ idPrefix: 'set-snd' }); panel.append(sound.el); }
    else if (id === 'ansicht') renderView(panel);
    else if (id === 'tasten' && !panel.childElementCount) renderKeys(panel);
  }

  // ---------- Spielstaende ----------
  async function renderSaves(panel) {
    const reason = game ? game.canSave() : null;
    let list = [];
    try { list = await store.list(); } catch (e) { say('Die Ablage ist nicht erreichbar: ' + e.message, 'warn'); }
    const bySlot = new Map(list.map((x) => [x.slot, x]));
    const extra = list.filter((x) => !SLOTS.includes(x.slot));
    panel.innerHTML = `
      <p class="set-note">${game
        ? (reason ? esc(reason) : 'Abgelegt wird die Lage mit allen Befehlen, die schon eingetragen sind.')
        : 'Die laufende Akte schreibt sich nach jeder Runde selbst. Drei Kartentaschen nehmen Stände von Hand auf.'}</p>
      <ul class="set-slots">${[...SLOTS, ...extra.map((x) => x.slot)].map((slot) => slotHtml(slot, bySlot.get(slot), !!game && !reason)).join('')}</ul>
      <div class="set-row">
        <label class="btn set-import">Spielstand einlesen<input type="file" accept=".json,application/json" hidden></label>
      </div>
      <h3 class="set-sub-h">Dienstbuch sichern</h3>
      <p class="set-note">Feldzug, Frontabschnitt, Lehrgangsmappe, Wachbuch, Werkstatt und Einstellungen liegen nur in diesem Browser. Die Sicherung nimmt sie als eine Datei mit, etwa auf ein anderes Gerät.</p>
      <div class="set-row">
        <button type="button" class="btn" data-act="backup">Sicherung speichern</button>
        <label class="btn set-import">Sicherung einlesen<input type="file" data-kind="backup" accept=".json,application/json" hidden></label>
      </div>`;
    for (const cv of panel.querySelectorAll('canvas[data-slot]')) drawSketch(cv, bySlot.get(cv.dataset.slot)?.meta?.sketch);
  }

  function slotHtml(slot, info, canSave) {
    const auto = slot === AUTO_SLOT;
    const name = auto ? 'Laufende Akte' : `Kartentasche ${slot.replace(/\D+/g, '') || slot}`;
    const empty = !info;
    const broken = info?.error;
    const when = info?.meta?.savedAt ? stampDate(info.meta.savedAt) : '';
    const hand = info && !broken ? (info.meta?.title || '') : '';
    const sub = broken ? 'unlesbar' : empty ? 'leer' : `${info.meta?.turnKind === 'battle' ? 'Gefecht' : 'Runde'} ${info.turn}${when ? ' · ' + when : ''}`;
    const tamper = info?.stamp === 'beschaedigt' ? '<span class="set-stamp warn">Stempel verletzt</span>' : '';
    return `<li class="set-slot${empty ? ' empty' : ''}" data-slot="${esc(slot)}">
      <canvas data-slot="${esc(slot)}" width="96" height="64" aria-hidden="true"></canvas>
      <div class="set-slot-text">
        <b>${esc(name)}</b>
        ${hand ? `<span class="set-hand">${esc(hand)}</span>` : ''}
        <span class="set-meta">${esc(sub)}</span>${tamper}
      </div>
      <div class="set-slot-acts">
        ${canSave && !auto ? `<button type="button" class="btn" data-act="save" data-slot="${esc(slot)}">Hier ablegen</button>` : ''}
        ${info && !broken ? `<button type="button" class="btn" data-act="load" data-slot="${esc(slot)}">Laden</button>
          <button type="button" class="btn" data-act="export" data-slot="${esc(slot)}">Exportieren</button>` : ''}
        ${info ? `<button type="button" class="btn quiet" data-act="del" data-slot="${esc(slot)}" aria-label="${esc(name)} leeren">Leeren</button>` : ''}
      </div>
    </li>`;
  }

  // Zweimal tippen bei allem, was etwas ueberschreibt oder verwirft
  let armed = null;
  function confirmTwice(btn, text) {
    if (armed === btn) { armed = null; return true; }
    if (armed) { armed.textContent = armed.dataset.was; armed.classList.remove('armed'); }
    armed = btn;
    btn.dataset.was = btn.textContent;
    btn.textContent = text;
    btn.classList.add('armed');
    return false;
  }

  async function slotAction(btn) {
    const slot = btn.dataset.slot, act = btn.dataset.act;
    const occupied = !btn.closest('.set-slot').classList.contains('empty');
    try {
      if (act === 'save') {
        if (occupied && !confirmTwice(btn, 'Überschreiben?')) return;
        await game.save(slot);
        playSfx('stamp', { intensity: 0.5 });
        say('Abgelegt in der Kartentasche.');
        renderSaves($('#set-panel-akten'));
      } else if (act === 'load') {
        // Laden ersetzt die laufende Akte: im Gefecht und bei belegter Akte erst nachfragen
        const autoBusy = slot !== AUTO_SLOT && !dlg.querySelector(`.set-slot[data-slot="${AUTO_SLOT}"]`)?.classList.contains('empty');
        if ((game || autoBusy) && !confirmTwice(btn, game ? 'Laufende Lage verlassen?' : 'Laufende Akte ersetzen?')) return;
        const loaded = await store.load(slot);
        if (!loaded) { say('Der Slot ist leer.', 'warn'); return; }
        location.href = loadHref(loaded.meta?.query, slot);
      } else if (act === 'export') {
        const loaded = await store.load(slot);
        if (!loaded) return;
        download(exportName(slot, loaded.state), exportSave(loaded.state, loaded.meta));
        say('Spielstand als Datei gespeichert.');
      } else if (act === 'del') {
        if (!confirmTwice(btn, 'Wirklich leeren?')) return;
        await store.remove(slot);
        say('Slot geleert.');
        renderSaves($('#set-panel-akten'));
      }
    } catch (e) {
      say('Das hat nicht geklappt: ' + e.message, 'warn');
    }
  }

  async function importFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      const info = inspectSave(text); // wirft bei fremden oder kaputten Daten
      const slot = freeSlot(await store.list());
      if (!slot) { say('Alle Kartentaschen sind belegt. Erst eine leeren.', 'warn'); return; }
      const meta = { ...info.meta, title: info.meta?.title || slotTitle(info.state), imported: true };
      await store.save(slot, info.state, meta);
      const stampText = { ok: 'Zensurstempel unversehrt.', fehlt: 'Ohne Zensurstempel.', beschaedigt: 'Der Zensurstempel ist verletzt: der Stand wurde unterwegs verändert.' }[info.stamp];
      say(`Eingelesen in Kartentasche ${slot.replace(/\D+/g, '')}. ${stampText}`, info.stamp === 'beschaedigt' ? 'warn' : '');
      playSfx('paper', { intensity: 0.4 });
      renderSaves($('#set-panel-akten'));
    } catch (e) {
      say('Nicht lesbar: ' + e.message, 'warn');
    }
  }

  // ---------- Sicherung des ganzen Dienstbuchs (P27) ----------
  let pendingBackup = null;
  function saveBackup() {
    const entries = collectLocal();
    if (!Object.keys(entries).length) { say('Noch nichts zu sichern.', 'warn'); return; }
    const d = new Date();
    const day = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-');
    download(`lehmfront-dienstbuch-${day}.json`, packBackup(entries, { savedAt: d.toISOString() }));
    playSfx('stamp', { intensity: 0.4 });
    say('Dienstbuch als Datei gesichert.');
  }

  async function inspectBackup(file) {
    if (!file) return;
    try {
      if (file.size > BACKUP_MAX) throw new Error('die Datei ist zu groß für eine Sicherung');
      const info = readBackup(await file.text());
      pendingBackup = info;
      const what = [info.campaign ? 'Feldzug' : '', info.endless ? 'Frontabschnitt' : ''].filter(Boolean).join(' und ') || 'Einstellungen und Listen';
      const row = $('#set-panel-akten .set-restore') ?? Object.assign(document.createElement('div'), { className: 'set-row set-restore' });
      row.innerHTML = `<button type="button" class="btn" data-act="restore">Sicherung übernehmen (${esc(what)})</button>`;
      $('#set-panel-akten').append(row);
      say(`${info.count} Einträge gelesen. ${info.stamp === 'ok' ? 'Zensurstempel unversehrt.' : 'Der Zensurstempel ist verletzt: die Datei wurde verändert.'} Übernehmen ersetzt Feldzug und Läufe in diesem Browser und lädt das Titelblatt neu.`, info.stamp === 'ok' ? '' : 'warn');
    } catch (e) {
      pendingBackup = null;
      $('#set-panel-akten .set-restore')?.remove();
      say('Nicht lesbar: ' + e.message, 'warn');
    }
  }

  function restoreBackup(btn) {
    if (!pendingBackup) return;
    if (!confirmTwice(btn, 'Wirklich ersetzen?')) return;
    try {
      restoreLocal(pendingBackup.entries);
      pendingBackup = null;
      btn.closest('.set-restore')?.remove();
      playSfx('paper', { intensity: 0.5 });
      say('Sicherung übernommen. Das Blatt wird neu geladen.');
      // Eine laufende Szene haelt Feldzug oder Lauf im Speicher und schriebe sie sonst gleich wieder zurueck
      setTimeout(() => location.assign(location.pathname), 900);
    } catch (e) {
      say('Das hat nicht geklappt: ' + e.message, 'warn');
    }
  }

  // ---------- Darstellung ----------
  function renderView(panel) {
    const s = getSettings();
    panel.innerHTML = `
      ${Object.keys(LABELS).map((k) => {
        const [title, names, help] = LABELS[k];
        const values = [...SETTING_CHOICES[k]].sort((a, b) => (typeof a === 'number' ? a - b : 0));
        return `<fieldset class="set-choice">
          <legend>${esc(title)}</legend>
          <div class="set-seg">${values.map((v) => `<label><input type="radio" name="set-${k}" value="${esc(String(v))}"${s[k] === v ? ' checked' : ''}><span>${esc(names[String(v)])}</span></label>`).join('')}</div>
          <p class="set-help">${esc(help)}</p>
        </fieldset>`;
      }).join('')}
      <div class="set-sample" aria-hidden="true">
        <span class="set-unit own">MG</span><span class="set-unit enemy">Gr</span>
        <span class="set-line warn"><span class="tg-head">06:20 · FEUER · 31/18</span><span class="tg-text">Gruppe 2 unter Beschuss STOP</span></span>
      </div>
      <div class="set-row"><button type="button" class="btn quiet" data-act="reset">Alles zurücksetzen</button></div>`;
  }

  // ---------- Tasten ----------
  async function renderKeys(panel) {
    let tools = [];
    try {
      await import('./tools/index.js');
      const { allTools } = await import('./tools.js');
      tools = allTools().filter((t) => t.key).map((t) => [t.key.toUpperCase(), t.label]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    } catch { /* ohne Werkzeuge nur die festen Tasten */ }
    const block = (title, rows) => `<section class="set-keys"><h3>${esc(title)}</h3><dl>${rows.map(([k, v]) =>
      `<div><dt>${k.split(' ').map((p) => (/^(oder|bis|und|\+)$/.test(p) ? esc(p) : `<kbd>${esc(p)}</kbd>`)).join(' ')}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`;
    panel.innerHTML = block('Befehle', tools) + FIXED_KEYS.map(([t, rows]) => block(t, rows)).join('')
      + `<section class="set-keys"><h3>Mit dem Finger</h3><dl>${TOUCH.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl></section>`
      + '<p class="set-hand"><a class="btn" href="?scene=handbuch" target="_blank" rel="noopener">Handbuch: alle Begriffe erklärt</a></p>';
  }

  // ---------- Ereignisse ----------
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('.x')) { close(); return; }
    const tab = e.target.closest('[role="tab"]');
    if (tab) { select(tab.dataset.tab); return; }
    const act = e.target.closest('[data-act]');
    if (!act) return;
    if (act.dataset.act === 'backup') { saveBackup(); return; }
    if (act.dataset.act === 'restore') { restoreBackup(act); return; }
    if (act.dataset.act === 'reset') { resetSettings(); renderView($('#set-panel-ansicht')); say('Darstellung zurückgesetzt.'); return; }
    slotAction(act);
  });
  dlg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.type === 'file') { (t.dataset.kind === 'backup' ? inspectBackup : importFile)(t.files?.[0]); t.value = ''; return; }
    const m = /^set-(\w+)$/.exec(t.name || '');
    if (!m || !(m[1] in SETTING_CHOICES)) return;
    const v = SETTING_CHOICES[m[1]].find((x) => String(x) === t.value);
    setSettings({ [m[1]]: v });
    playSfx('pencil', { count: 1, intensity: 0.3 });
  });
  back.addEventListener('pointerdown', (e) => { if (e.target === back) close(); });

  function focusables() {
    return [...dlg.querySelectorAll('button, input, [tabindex="0"], label.btn')].filter((n) => !n.closest('[hidden]') && !n.disabled && n.offsetParent !== null);
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const f = focusables();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      e.stopPropagation();
      return;
    }
    const tab = e.target.closest?.('[role="tab"]');
    if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) {
      e.preventDefault();
      const ids = TABS.map(([t]) => t);
      const i = ids.indexOf(tab.dataset.tab);
      const n = e.key === 'Home' ? 0 : e.key === 'End' ? ids.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length;
      select(ids[n], true);
    }
    // Spieltasten (Werkzeuge, Overlays) duerfen hinter dem Dialog nichts ausloesen
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  cleanups.push(onSettingsChange(() => { if (current === 'ansicht') { /* Werte stehen schon in den Knoepfen */ } }));

  function close() {
    if (!open) return;
    open = null;
    window.removeEventListener('keydown', onKey, true);
    for (const c of cleanups) c();
    sound?.destroy();
    back.remove();
    playSfx('paper', { intensity: 0.25 });
    if (opener && opener.isConnected) opener.focus?.({ preventScroll: true });
    onClose();
  }

  select(tab);
  playSfx('paper', { intensity: 0.4 });
  $(`[data-tab="${current}"]`).focus({ preventScroll: true });
  open = { close, select: (t) => select(t, true), el: dlg };
  return open;
}

export function settingsOpen() {
  return !!open;
}

function stampDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}.${d.getMonth() + 1}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function download(name, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Bleistiftskizze der Front: Graeben als Striche, eigene Gruppen als Punkte (Farben aus den Token) */
export function drawSketch(cv, sk) {
  const ctx = cv.getContext('2d');
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const W = 96, H = 64;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(cv);
  const v = (k) => cs.getPropertyValue('--' + k).trim() || '#888';
  ctx.fillStyle = v('paper');
  ctx.fillRect(0, 0, W, H);
  if (!sk || !(sk.w > 0)) {
    ctx.strokeStyle = v('line');
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(6.5, 6.5, W - 13, H - 13);
    return;
  }
  const s = Math.min((W - 8) / sk.w, (H - 8) / sk.h);
  const ox = (W - sk.w * s) / 2, oy = (H - sk.h * s) / 2;
  const dot = (i, r) => { const x = i % sk.w, y = (i - x) / sk.w; ctx.fillRect(ox + x * s, oy + y * s, r, r); };
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = v('own');
  for (const i of sk.a ?? []) dot(i, Math.max(1, s));
  ctx.fillStyle = v('enemy');
  for (const i of sk.b ?? []) dot(i, Math.max(1, s));
  ctx.globalAlpha = 1;
  ctx.fillStyle = v('ink');
  for (const i of sk.g ?? []) { const x = i % sk.w, y = (i - x) / sk.w; ctx.beginPath(); ctx.arc(ox + (x + 0.5) * s, oy + (y + 0.5) * s, 2, 0, 6.283); ctx.fill(); }
  ctx.strokeStyle = v('line');
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}
