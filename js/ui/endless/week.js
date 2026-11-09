// Eine Woche im Frontabschnitt (P22) im Gefecht: ?scene=gefecht&endlos=1&karte=...&fraktion=...&ki=...&seed=...
// Der Zustand kommt aus dem Speicher des Laufs (Wochenbeginn), nicht aus dem Szenario: dieselben Leute, derselbe
// Graben, Woche fuer Woche. Nach 14 Stellungsrunden (ein laufendes Gefecht wird zu Ende gefuehrt), wenn der
// Abschnitt aufgerieben ist oder die Truppe meutert, geht die Meldung an den Wochentisch (?scene=frontabschnitt).
//
// In js/scenes/gefecht.js (wie campaignMission, gleiche Schnittstelle):
//   const campaignRun = campaignMission(params) ?? endlessWeek(params, map);
//   suffix(state), overlays() fuer Rundentitel und Zielfeld auf der Karte.
import { slimRounds } from '../../campaign.js';
import { weekRounds, weekOver, WEEK_ROUNDS, seasonOf, fallLimit } from '../../modes/endless.js';
import { groundHeld } from '../../ai/match.js';
import { SEASONS } from '../../config/seasons.js';
import { FONTS } from '../../render/map-layer.js';
import { playSfx } from '../../audio/engine.js';
import { esc, ensureCss } from '../dom.js';
import { loadRun, loadWeekStart, saveWeekReturn } from './store.js';

const KIND_WORD = {
  halten: 'Halten', feld_nehmen: 'Feld nehmen', stosstrupp: 'Stoßtrupp', gefangene: 'Gefangene', graben_zuruecknehmen: 'Graben zurücknehmen',
};

export function endlessWeek(params, map = null) {
  if (!params.has('endlos')) return null;
  const run = loadRun();
  const start = loadWeekStart();
  if (!run || !start || run.ended || start.endless?.week !== run.week) {
    // Keine laufende Woche (schon gemeldet, Zurueck-Taste, anderes Geraet): zum Wochentisch statt still ein freies Gefecht
    location.replace(location.pathname + '?scene=frontabschnitt');
    return null;
  }
  const order = run.order;
  let ended = false;
  let pending = null;
  let dialogOpen = false;
  let setModal = () => {};
  let card = null;

  function finish(why, state, archive, ui) {
    if (ended) return;
    const rounds = slimRounds(archive.rounds);
    const base = { week: run.week, why, finalState: state };
    let ok = saveWeekReturn({ ...base, rounds });
    if (!ok) ok = saveWeekReturn({ ...base, rounds: rounds.map((r) => ({ ...r, start: { groups: [] } })) });
    if (!ok) ok = saveWeekReturn({ ...base, rounds: [] });
    if (!ok) {
      dialog(ui, {
        title: 'Meldung nicht gespeichert',
        text: 'Der Browser nimmt die Wochenmeldung nicht an (Speicher voll oder gesperrt). Bitte Speicher freigeben und erneut melden.',
        confirm: 'Verstanden', onConfirm: () => {},
      });
      return;
    }
    ended = true;
    location.href = location.pathname + '?scene=frontabschnitt';
  }

  function dialog(ui, { title, text, rows = [], confirm, onConfirm }) {
    if (dialogOpen) return;
    dialogOpen = true;
    setModal(true);
    const back = document.createElement('div');
    back.className = 'modal-back fz-end ew-end';
    back.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <b class="ho-title">${esc(title)}</b><p>${esc(text)}</p>
      ${rows.length ? `<dl class="ew-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      <div class="fz-end-actions"><button type="button" class="btn go">${esc(confirm)}</button></div></div>`;
    ui.append(back);
    back.querySelector('.go').addEventListener('click', () => { back.remove(); dialogOpen = false; setModal(false); onConfirm(); });
    back.querySelector('.go').focus({ preventScroll: true });
  }

  function cardHtml(state) {
    const left = Math.max(0, WEEK_ROUNDS - weekRounds(state));
    const season = SEASONS[seasonOf(run.week)];
    return `<header><span>Woche ${run.week} · ${esc(season.name)}</span><button type="button" class="ew-x" aria-label="Schließen">×</button></header>
      ${order ? `<b class="ew-title">${esc(order.titel)}${order.eilt ? ' <em>EILT</em>' : ''}</b>
      <p class="ew-text">${esc(order.text)}</p>
      <dl class="ew-rows"><div><dt>Befehl</dt><dd>${esc(KIND_WORD[order.befehlsart] ?? order.befehlsart)}${order.target ? ' · Feld ' + esc(order.feld) : ''}</dd></div>
      <div><dt>Stempel</dt><dd>${esc(run.stamps?.['w' + run.week] ?? 'befolgen')}</dd></div>
      <div><dt>Noch</dt><dd>${left} ${left === 1 ? 'Stellungsrunde' : 'Stellungsrunden'}</dd></div></dl>` : '<p class="ew-text">Kein Befehl für diese Woche.</p>'}
      <small>Das Zielfeld ist auf der Karte mit Bleistift umrandet. Die Woche endet von selbst.</small>`;
  }

  return {
    endless: true,
    run,
    prepare() {
      // Der Wochenbeginn aus dem Speicher ersetzt den Anfangszustand des Szenarios
      return structuredClone(start);
    },
    mount(ui, { getState, isBusy = () => false, setModal: sm }) {
      if (sm) setModal = sm;
      ensureCss('css/feldzug.css');
      ensureCss('css/frontabschnitt.css');
      const host = ui.querySelector('.hud-right');
      if (!host) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn ew-btn';
      btn.textContent = `Woche ${run.week}`;
      btn.title = 'Stabsbefehl der Woche ansehen';
      host.append(btn);
      card = document.createElement('section');
      card.className = 'ew-card card';
      card.hidden = true;
      card.setAttribute('aria-label', 'Stabsbefehl der Woche');
      ui.append(card);
      const close = () => { card.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => {
        if (isBusy() && card.hidden) return;
        if (!card.hidden) { close(); return; }
        card.innerHTML = cardHtml(getState());
        card.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        card.querySelector('.ew-x').addEventListener('click', close);
        playSfx('paper', { intensity: 0.4 });
      });
      card.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } });
    },
    suffix(state) {
      if (ended || pending) return ` · Woche ${run.week} · vorbei`;
      const left = Math.max(0, WEEK_ROUNDS - weekRounds(state));
      return state.turnKind === 'battle' ? ` · Woche ${run.week}` : ` · Woche ${run.week} · noch ${left}`;
    },
    /** Zielfeld des Stabsbefehls: mit Bleistift umrandet, daneben die Befehlsart */
    overlays() {
      if (!order?.target) return [];
      const t = order.target;
      return [{
        draw(ctx, { theme: th, px }) {
          const x = t.x + 0.5, y = t.y + 0.5;
          ctx.save();
          ctx.strokeStyle = th.pencil ?? th.ink2;
          ctx.lineWidth = Math.max(1.6 * px, 0.05);
          ctx.globalAlpha = 0.9;
          ctx.setLineDash([0.32, 0.18]);
          ctx.strokeRect(x - 0.78, y - 0.78, 1.56, 1.56);
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(x - 0.95, y + 0.95);
          ctx.lineTo(x + 1.1, y + 1.05);
          ctx.stroke();
          ctx.fillStyle = th.pencil ?? th.ink;
          ctx.font = `700 ${Math.max(0.8, 15 * px)}px ${FONTS.hand}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(`W${run.week}: ${KIND_WORD[order.befehlsart] ?? ''}`, x + 1.0, y + 0.9);
          ctx.restore();
        },
      }];
    },
    /** Nach jeder Runde: Woche um, Abschnitt aufgerieben, gefallen oder Meuterei? Vormerken fuer das Ende des Films */
    afterRound(state, archive) {
      if (ended || pending) return;
      const alive = state.groups.some((g) => g.side === 'a' && g.status !== 'lost');
      let why = null;
      if (state.sides.a?.mutiny || (state.result && state.result.winner !== 'a')) why = state.sides.a?.mutiny ? 'meuterei' : 'gefallen';
      else if (!alive) why = 'gefallen';
      else if (map && groundHeld(state, map, 'b') >= fallLimit(map, 'a')) why = 'gefallen';
      else if (weekOver(state)) why = 'woche';
      if (why) pending = { why, state, archive };
    },
    afterFilm(ui) {
      if (ended) return true;
      if (!pending || dialogOpen) return !!pending;
      const { why, state, archive } = pending;
      const TEXT = {
        woche: ['Die Woche ist um', `Vierzehn Stellungsrunden. Woche ${run.week} geht als Meldung an den Stab. Am Tisch liegen dann Liste, Post und der nächste Befehl.`],
        gefallen: ['Der Abschnitt hält nicht mehr', 'Die Linie ist nicht mehr zu halten. Die Meldung geht trotzdem hinaus.'],
        meuterei: ['Die Truppe geht nicht mehr', 'Die Gruppen bleiben in den Unterständen. Sie halten den Graben, aber sie gehen nirgends mehr hin.'],
      }[why];
      card && (card.hidden = true);
      playSfx('teletype', { count: 6, intensity: 0.4 });
      dialog(ui, {
        title: TEXT[0], text: TEXT[1],
        rows: [['Woche', String(run.week)], ['Stellungsrunden', String(Math.min(WEEK_ROUNDS, weekRounds(state)))]],
        confirm: 'Zum Wochentisch',
        onConfirm: () => finish(why, state, archive, ui),
      });
      return true;
    },
  };
}
