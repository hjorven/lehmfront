// Szene "fernamt": Feldfernsprechamt, der Online-Teil von Lehmfront (P20, Plan 9 und 11).
// Anschluss (anonym oder Zugangslink per E-Mail), Erkennungsmarke, Zweikampf als Klappenschrank (jede Partie
// eine Klappe, die faellt, wenn du am Zug bist; die Frist brennt als Kerze herunter), Kartentaschen in der
// Etappe (Cloud-Spielstand) und das Wachbuch der Front (Tageslage, vom Server nachgerechnet).
// Ohne eingerichtetes Projekt: "Leitung nicht geschaltet", alles Offline bleibt wie es ist.
// Parameter: demo=an|aus (Screenshots ohne Netz: angeschlossen mit Beispieldaten bzw. ohne Leitung).
import { esc, ensureCss } from '../ui/dom.js';
import { themeAt, applyTheme } from '../theme.js';
import { candle } from '../ui/candle.js';
import { MATCH_MAPS, matchQuery, normalizeCode, turnState, parseMapId } from '../online/match.js';
import { battleMap } from '../config/battlemaps.js';
import { dayKey, dayLabel } from '../modes/skirmish.js';
import { FACTIONS } from '../config/factions.js';
import { SLOTS } from '../savegame.js';
import { createSaveStore, exportSave, inspectSave } from '../save.js';
import { replayUrl } from '../online/link.js';
import { audio, playSfx } from '../audio/engine.js';
import * as realNet from '../net.js';
import { demoNet } from '../online/demo.js';

const SLOT_NAMES = { auto: 'Laufende Akte', 'tasche-1': 'Kartentasche 1', 'tasche-2': 'Kartentasche 2', 'tasche-3': 'Kartentasche 3' };

function mapName(id) {
  const p = parseMapId(id);
  if (!p) return id;
  if (p.map === 'zufall') return `Zufallsblatt ${p.mapSeed}`;
  return battleMap(p.map)?.name ?? id;
}

function statusLine(m) {
  const t = turnState(m, m.side, m.submitted ?? []);
  if (t === 'waiting') return { text: `Wartet auf die Gegenseite. Code ${m.code}`, drop: false };
  if (t === 'finished') {
    const w = m.winner === 'draw' || !m.winner ? 'Ohne Entscheidung' : m.winner === m.side ? 'Behauptet' : 'Durchbrochen';
    return { text: `Beendet: ${w}`, drop: false };
  }
  if (t === 'yours') return { text: 'Deine Befehle fehlen', drop: true };
  if (t === 'resolving') return { text: 'Der Stab rechnet', drop: false };
  return { text: 'Drüben wird überlegt', drop: false };
}

export async function mount(root, params) {
  await Promise.all([
    ensureCss('css/fernamt.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "Caveat"', '16px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();
  const demo = params.get('demo');
  const net = demo ? demoNet(demo === 'an') : realNet;
  const store = createSaveStore();
  const on = net.onlineEnabled();
  const today = (() => { const d = demo ? new Date(2026, 10, 9) : new Date(); return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate()); })();

  root.className = on ? 'fa' : 'fa off';
  root.innerHTML = `
    <header class="fa-head">
      <a class="fa-back" href="./">Hauptmenü</a>
      <h1>Feldfernsprechamt</h1>
      <p class="fa-line ${on ? 'ok' : 'off'}"><span class="fa-lamp" aria-hidden="true"></span>${on ? 'Leitung zum Stab steht' : 'Leitung zum Stab ist nicht geschaltet'}</p>
    </header>
    <div class="fa-grid">
      <section class="card fa-card fa-anschluss" aria-labelledby="fa-h1"><h2 id="fa-h1">Anschluss</h2><div class="fa-body"></div></section>
      <section class="card fa-card fa-zweikampf" aria-labelledby="fa-h2"><h2 id="fa-h2">Zweikampf <small>1 gegen 1, über Tage</small></h2><div class="fa-body"></div></section>
      <section class="card fa-card fa-taschen" aria-labelledby="fa-h3"><h2 id="fa-h3">Kartentaschen in der Etappe</h2><div class="fa-body"></div></section>
      <section class="card fa-card fa-front" aria-labelledby="fa-h4"><h2 id="fa-h4">Wachbuch der Front <small>${esc(dayLabel(today))}</small></h2><div class="fa-body"></div></section>
    </div>
    <p class="fa-note" aria-live="polite"></p>`;
  const $ = (s) => root.querySelector(s);
  const note = (text) => { $('.fa-note').textContent = text; };

  let user = null, profile = null;

  async function refreshAll() {
    if (on) {
      const u = await net.currentUser();
      user = u.ok ? u.user : null;
      profile = user ? (await net.myProfile()).profile ?? null : null;
    }
    renderAnschluss();
    renderZweikampf();
    renderTaschen();
    renderFront();
  }

  // ---------- Anschluss ----------
  function renderAnschluss() {
    const el = $('.fa-anschluss .fa-body');
    if (!on) {
      el.innerHTML = `<p>Für dieses Spiel ist noch kein Online-Dienst eingerichtet. Gefecht frei, Hotseat, Kampagne und Tageslage gehen ohne Leitung wie gewohnt.</p>
        <p class="fa-hand">Wiedergabe-Links gehen trotzdem: Sie tragen das ganze Gefecht in sich und brauchen keinen Stab.</p>`;
      return;
    }
    if (!user) {
      el.innerHTML = `<p>Ohne Anschluss bleibt alles auf diesem Gerät. Mit Anschluss: Zweikampf über Tage, Kartentaschen auf jedem Gerät, Wachbuch der Front.</p>
        <button type="button" class="btn fa-anon">Ohne Namen anschließen</button>
        <form class="fa-mail"><label>Oder per Zugangslink <input type="email" required autocomplete="email" placeholder="adresse@beispiel.de"></label><button class="btn" type="submit">Link schicken</button></form>`;
      el.querySelector('.fa-anon').addEventListener('click', async () => {
        const r = await net.signInAnon();
        note(r.ok ? 'Angeschlossen.' : r.why);
        if (r.ok) { playSfx('stamp', { intensity: 0.5 }); refreshAll(); }
      });
      el.querySelector('.fa-mail').addEventListener('submit', async (e) => {
        e.preventDefault();
        const r = await net.signInEmail(e.currentTarget.querySelector('input').value.trim());
        note(r.ok ? 'Der Zugangslink ist unterwegs. Er führt zurück ins Fernsprechamt.' : r.why);
      });
      return;
    }
    el.innerHTML = `<div class="fa-marke" aria-label="Erkennungsmarke"><span>Erkennungsmarke</span><b>${esc(profile?.code ?? '········')}</b></div>
      <form class="fa-name"><label>Name im Wachbuch <input maxlength="20" autocomplete="nickname" value="${esc(profile?.username ?? '')}"></label><button class="btn" type="submit">Eintragen</button></form>
      ${user.anonymous ? `<form class="fa-link"><label>Ohne E-Mail gilt der Anschluss nur auf diesem Gerät. <input type="email" required autocomplete="email" placeholder="E-Mail hinterlegen"></label><button class="btn" type="submit">Sichern</button></form>` : `<p class="fa-small">Angeschlossen als ${esc(user.email ?? '')}</p>`}
      <button type="button" class="btn fa-out">Abmelden</button>`;
    el.querySelector('.fa-name').addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await net.setUsername(e.currentTarget.querySelector('input').value);
      note(r.ok ? `Eingetragen als ${r.username}.` : r.why);
      if (r.ok) playSfx('pencil', { count: 3, intensity: 0.5 });
    });
    el.querySelector('.fa-link')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const r = await net.linkEmail(e.currentTarget.querySelector('input').value.trim());
      note(r.ok ? 'Bitte den Link in der E-Mail bestätigen.' : r.why);
    });
    el.querySelector('.fa-out').addEventListener('click', async () => {
      await net.signOut();
      note('Abgemeldet.');
      refreshAll();
    });
  }

  // ---------- Zweikampf ----------
  async function renderZweikampf() {
    const el = $('.fa-zweikampf .fa-body');
    const dis = on && user ? '' : ' disabled';
    const opts = MATCH_MAPS.map((m) => `<option value="${m}">${esc(m === 'zufall' ? 'Zufallsblatt' : battleMap(m).name)}</option>`).join('');
    el.innerHTML = `<p class="fa-small">Beide geben ihre Befehle ab, wann sie können. Sind beide da, rechnet der Stab die Runde. Eine Stellungsrunde hat 48 Stunden, eine Gefechtsrunde 12. Wer die Frist verstreichen lässt, hält.</p>
      <div class="fa-new">
        <form class="fa-create"><label>Abschnitt <select${dis}>${opts}</select></label><button class="btn" type="submit"${dis}>Leitung legen</button></form>
        <form class="fa-join"><label>Einladungscode <input maxlength="7" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="K7QX2M"${dis}></label><button class="btn" type="submit"${dis}>Verbinden</button></form>
      </div>
      <div class="fa-code" hidden></div>
      <ul class="fa-board" aria-label="Klappenschrank"></ul>`;
    const board = el.querySelector('.fa-board');
    if (!on || !user) {
      board.innerHTML = `<li class="fa-empty">${on ? 'Erst anschließen, dann Leitungen legen.' : 'Ohne Leitung kein Zweikampf. Zu zweit an einem Gerät geht Hotseat.'}</li>`;
      return;
    }
    el.querySelector('.fa-create').addEventListener('submit', async (e) => {
      e.preventDefault();
      let id = e.currentTarget.querySelector('select').value;
      if (id === 'zufall') id = 'zufall-' + (1 + Math.floor(Math.random() * 99999));
      const r = await net.createMatch(id);
      if (!r.ok) { note(r.why); return; }
      playSfx('stamp', { intensity: 0.6 });
      const box = el.querySelector('.fa-code');
      box.hidden = false;
      box.innerHTML = `<span>Gib diesen Code weiter:</span><b>${esc(r.match.code)}</b><small>Sobald drüben jemand verbindet, beginnt das Gefecht.</small>`;
      listMatches();
    });
    el.querySelector('.fa-join').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = normalizeCode(e.currentTarget.querySelector('input').value);
      if (!code) { note('Der Code hat sechs Zeichen, zum Beispiel K7QX2M.'); return; }
      const r = await net.joinMatch(code);
      if (!r.ok) { note(r.why); return; }
      playSfx('stamp', { intensity: 0.6 });
      location.href = '?' + matchQuery(r.mapId, r.matchId);
    });
    listMatches();
  }

  async function listMatches() {
    const board = $('.fa-board');
    if (!board) return;
    const r = await net.listMatches();
    if (!r.ok) { board.innerHTML = `<li class="fa-empty">${esc(r.why)}</li>`; return; }
    if (!r.matches.length) { board.innerHTML = '<li class="fa-empty">Noch keine Leitung gelegt.</li>'; return; }
    board.innerHTML = r.matches.map((m) => {
      const st = statusLine(m);
      const foe = FACTIONS[m.side === 'a' ? 'morrow' : 'kaldern']?.short ?? '';
      return `<li class="fa-row${st.drop ? ' due' : ''}" data-id="${esc(m.id)}">
        <span class="fa-klappe${st.drop ? ' down' : ''}" aria-hidden="true"><i></i></span>
        <span class="fa-what"><b>${esc(mapName(m.map_id))}</b><small>${m.status === 'waiting' ? 'Neue Leitung' : `Runde ${m.turn}, gegen ${esc(foe)}`} · ${esc(st.text)}</small></span>
        ${m.status === 'active' ? candle(m.deadline, m.turn_kind) : ''}
        <span class="fa-acts">
          ${m.status === 'active' ? `<a class="btn" href="?${esc(matchQuery(m.map_id, m.id))}">${st.drop ? 'Befehle geben' : 'Ansehen'}</a>` : ''}
          ${m.status === 'waiting' ? '<button type="button" class="btn fa-drop">Zurückziehen</button>' : ''}
          ${m.status === 'finished' && m.record ? '<button type="button" class="btn fa-replay">Wiedergabe</button>' : ''}
        </span></li>`;
    }).join('');
    for (const b of board.querySelectorAll('.fa-drop')) {
      b.addEventListener('click', async () => {
        const r2 = await net.withdrawMatch(b.closest('li').dataset.id);
        note(r2.ok ? 'Leitung zurückgezogen.' : r2.why);
        listMatches();
      });
    }
    for (const b of board.querySelectorAll('.fa-replay')) {
      b.addEventListener('click', async () => {
        const m = r.matches.find((x) => x.id === b.closest('li').dataset.id);
        location.href = await replayUrl(m.record);
      });
    }
  }

  // ---------- Kartentaschen (Cloud-Spielstand) ----------
  async function renderTaschen() {
    const el = $('.fa-taschen .fa-body');
    let local = [];
    try { local = demo ? net.demoLocal() : await store.list(); } catch { /* ohne Speicher */ }
    const cloud = on && user ? await net.cloudList() : { ok: false, saves: [] };
    const cl = new Map((cloud.saves ?? []).map((s) => [s.slot, s]));
    const dis = on && user ? '' : ' disabled';
    el.innerHTML = `<p class="fa-small">${on && user ? 'Hier liegt jede Tasche ein zweites Mal beim Stab. Auf einem anderen Gerät mit demselben Anschluss holst du sie ab.' : 'Mit Anschluss lassen sich Spielstände beim Stab ablegen und auf einem anderen Gerät abholen.'}</p>
      <ul class="fa-slots">${SLOTS.map((slot, i) => {
        const l = local.find((x) => x.slot === slot && !x.error);
        const c = cl.get(i + 1);
        const when = c ? new Date(c.updated_at).toLocaleString('de-DE', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
        return `<li data-slot="${slot}" data-n="${i + 1}"><b>${SLOT_NAMES[slot]}</b>
          <small>Hier: ${l ? esc(l.meta?.title || `Runde ${l.turn}`) : 'leer'} · Beim Stab: ${c ? esc(c.label || 'abgelegt') + ', ' + esc(when) : 'leer'}</small>
          <span class="fa-acts"><button type="button" class="btn fa-up"${l ? dis : ' disabled'}>Hinschicken</button><button type="button" class="btn fa-down"${c ? dis : ' disabled'}>Abholen</button></span></li>`;
      }).join('')}</ul>`;
    for (const b of el.querySelectorAll('.fa-up')) {
      b.addEventListener('click', async () => {
        const li = b.closest('li');
        const loaded = await store.load(li.dataset.slot);
        if (!loaded) return;
        const env = JSON.parse(exportSave(loaded.state, loaded.meta));
        const r = await net.cloudPut(Number(li.dataset.n), env, loaded.meta?.title || SLOT_NAMES[li.dataset.slot]);
        note(r.ok ? `${SLOT_NAMES[li.dataset.slot]} liegt beim Stab.` : r.why);
        if (r.ok) { playSfx('paper', { intensity: 0.5 }); renderTaschen(); }
      });
    }
    for (const b of el.querySelectorAll('.fa-down')) {
      b.addEventListener('click', async () => {
        const li = b.closest('li');
        const has = local.find((x) => x.slot === li.dataset.slot && !x.error);
        if (has && !confirm(`${SLOT_NAMES[li.dataset.slot]} auf diesem Gerät überschreiben?`)) return;
        const r = await net.cloudGet(Number(li.dataset.n));
        if (!r.ok) { note(r.why); return; }
        try {
          const got = inspectSave(JSON.stringify(r.envelope));
          if (got.stamp === 'beschaedigt') { note('Die Tasche ist beim Transport beschädigt worden. Nicht übernommen.'); return; }
          await store.save(li.dataset.slot, got.state, got.meta);
          note(`${SLOT_NAMES[li.dataset.slot]} abgeholt.`);
          playSfx('paper', { intensity: 0.5 });
          renderTaschen();
        } catch (e) { note('Die Tasche ist nicht lesbar: ' + e.message); }
      });
    }
  }

  // ---------- Wachbuch der Front ----------
  async function renderFront() {
    const el = $('.fa-front .fa-body');
    const r = on ? await net.dailyBoard(today, 10) : { ok: false };
    const rows = r.ok && r.list.length
      ? `<ol class="fa-wb">${r.list.map((x, i) => `<li${user && x.user === user.id ? ' class="me"' : ''}><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(x.name)}</span><small>${esc(x.code)}</small><span class="wb-f">${esc(FACTIONS[x.faction]?.short ?? '')}</span><b>${x.points}</b></li>`).join('')}</ol>`
      : `<p class="fa-small">${on ? (r.ok ? 'Heute hat noch niemand gemeldet.' : esc(r.why ?? '')) : 'Ohne Leitung steht im Wachbuch nur, was auf diesem Gerät gemeldet wurde.'}</p>`;
    el.innerHTML = `${rows}<p class="fa-small">Nur nachgerechnete Wochen: Der Stab spielt jede gemeldete Woche aus den Befehlen nach, bevor sie hier steht.</p>
      <a class="btn" href="?scene=tageslage">Zur Tageslage</a>`;
  }

  await refreshAll();
}
