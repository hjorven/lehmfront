// Einsatz aus der Kampagne im Gefecht (P14): ?scene=gefecht&campaign=1 legt Ansehen, Vertrauen, Berichte,
// Nachschub und Ersatz auf den Startzustand, zeigt den Knopf "Einsatz melden" und bringt Archiv und Endzustand
// zur Feldzugskarte zurueck. Meuterei oder ein erreichtes Missionsziel beenden den Einsatz von selbst.
//
// In js/scenes/gefecht.js:
//   const mission = campaignMission(params);              // null ohne campaign=1
//   if (mission) state = mission.prepare(state);          // nach createInitialState/initEtappen
//   mission?.mount(ui, { getState, getArchive, isBusy }); // Knopf in der Kopfleiste
//   mission?.afterRound(state, archive);                  // nach jeder aufgeloesten Runde (merkt sich das Ende)
//   mission?.afterFilm(ui);                               // nach dem Phasenfilm: zeigt den Enddialog, falls entschieden
import { applyCampaignToState, judgeMission, slimRounds, startAxes, normalizeCampaign } from '../../campaign.js';
import { registerCue } from '../../audio/cues.js';
import { playSfx } from '../../audio/engine.js';
import { esc, ensureCss } from '../dom.js';
import { loadCampaign, loadMissionStart, saveMissionReturn } from './store.js';

// Klang der neuen Ereignisse im Phasenfilm
registerCue('mutiny', () => [{ name: 'hush' }, { name: 'paper', opts: { intensity: 0.6 }, delay: 0.4 }]);
registerCue('staff_threat', () => [{ name: 'teletype', opts: { count: 9, bell: true, intensity: 0.5 } }]);

/** Endzustand ohne Kartenfelder (die braucht die Feldzugskarte nicht, sie sind aber gross) */
export function slimState(state) {
  const { cells, ...rest } = state;
  const sides = {};
  for (const [k, s] of Object.entries(rest.sides ?? {})) {
    const { artillery, etappe, ...keep } = s;
    sides[k] = keep;
  }
  return { ...rest, sides };
}

export function campaignMission(params) {
  if (!params.has('campaign')) return null;
  const stored = loadCampaign();
  const start = loadMissionStart();
  if (!stored || !start) {
    // Kein laufender Einsatz (schon gemeldet, Zurueck-Taste, anderer Browser): zurueck zur Feldzugskarte statt still ein freies Gefecht
    location.replace(location.pathname + '?scene=feldzug');
    return null;
  }
  const campaign = normalizeCampaign(stored);
  const mission = start.mission ?? campaign.mission;
  const side = campaign.side ?? 'a';
  let startValues = null;
  let ended = false;
  let bar = null;
  let pending = null;          // entschiedenes Ende, wartet auf das Ende des Phasenfilms
  let dialogOpen = false;
  let setModal = () => {};

  function finish(result, state, archive, ui) {
    if (ended) return;
    const base = {
      mission, outcome: result.outcome, orderMet: result.orderMet ?? result.outcome === 'sieg', why: result.why ?? '', flags: result.flags ?? [],
      start: startValues,
    };
    const rounds = slimRounds(archive.rounds);
    // Erst vollstaendig, dann ohne Startstaerken und Endzustand (der Speicher des Browsers ist begrenzt)
    let ok = saveMissionReturn({ ...base, rounds, finalState: slimState(state) });
    if (!ok) ok = saveMissionReturn({ ...base, rounds: rounds.map((r) => ({ ...r, start: { groups: [] } })), finalState: null });
    if (!ok) {
      dialog(ui, {
        title: 'Meldung nicht gespeichert',
        text: 'Der Browser nimmt die Meldung nicht an (Speicher voll oder gesperrt). Ohne sie kann die Feldzugskarte den Einsatz nicht werten. Bitte Speicher freigeben und erneut melden.',
        confirm: 'Verstanden',
        onConfirm: () => {},
      });
      return;
    }
    ended = true;
    location.href = location.pathname + '?scene=feldzug';
  }

  function dialog(ui, { title, text, verdict, confirm, cancel, onConfirm }) {
    if (dialogOpen) return;
    dialogOpen = true;
    setModal(true);
    const back = document.createElement('div');
    back.className = 'modal-back fz-end';
    back.innerHTML = `<div class="modal card" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <b class="ho-title">${esc(title)}</b><p>${esc(text)}</p>
      ${verdict ? `<p class="fz-verdict"><span>Wertung</span> <b>${esc(verdict)}</b></p>` : ''}
      <div class="fz-end-actions">${cancel ? `<button type="button" class="btn no">${esc(cancel)}</button>` : ''}
      <button type="button" class="btn go">${esc(confirm)}</button></div></div>`;
    ui.append(back);
    const close = () => { back.remove(); dialogOpen = false; setModal(false); };
    back.querySelector('.no')?.addEventListener('click', close);
    back.querySelector('.go').addEventListener('click', () => { close(); onConfirm(); });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cancel) { e.preventDefault(); e.stopPropagation(); close(); } });
    back.querySelector('.go').focus({ preventScroll: true });
  }

  const word = (r) => (r.outcome === 'sieg' ? 'Erfolg' : 'Misserfolg') + (r.why ? ` (${r.why})` : '');

  return {
    mission,
    campaign,
    prepare(state) {
      const s = applyCampaignToState(state, { ...campaign, mission }, side);
      startValues = startAxes(s, side);
      return s;
    },
    mount(ui, { getState, getArchive, isBusy = () => false, setModal: sm }) {
      if (sm) setModal = sm;
      const host = ui.querySelector('.hud-right');
      if (!host) return;
      ensureCss('css/feldzug.css'); // Stil des Meldedialogs
      bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'btn fz-report-btn';
      bar.textContent = 'Einsatz melden';
      bar.title = 'Den Einsatz beenden und an den Stab melden. Danach geht es zur Feldzugskarte.';
      host.append(bar);
      bar.addEventListener('click', () => {
        if (isBusy() || ended || dialogOpen) return;
        const state = getState();
        const archive = getArchive();
        const r = judgeMission(mission, { state, rounds: archive.rounds, side, final: true });
        playSfx('paper', { intensity: 0.5 });
        dialog(ui, {
          title: 'Einsatz melden',
          text: archive.rounds.length
            ? `Nach ${archive.rounds.length} ${archive.rounds.length === 1 ? 'Runde' : 'Runden'} geht die Meldung an den Stab. Danach kommen Gefallenenliste, Post und die Feldzugskarte.`
            : 'Es ist noch keine Runde gespielt. Ohne Gefecht meldet der Abschnitt nur, dass er steht.',
          verdict: word(r),
          confirm: 'Melden',
          cancel: 'Weiter kämpfen',
          onConfirm: () => finish(r, state, archive, ui),
        });
      });
    },
    /** Nach jeder Runde: ist der Einsatz entschieden, wird das fuer das Ende des Phasenfilms vorgemerkt */
    afterRound(state, archive) {
      if (ended || pending) return;
      const r = judgeMission(mission, { state, rounds: archive.rounds, side, final: false });
      if (r?.done) pending = { r, state, archive };
    },
    /** Nach dem Phasenfilm: der Enddialog (die Spielerin sieht erst, wie es ausging) */
    afterFilm(ui) {
      if (ended || !pending || dialogOpen) return;
      const { r, state, archive } = pending;
      const mutiny = r.why === 'Meuterei';
      dialog(ui, {
        title: mutiny ? 'Die Truppe geht nicht mehr' : 'Einsatz beendet',
        text: mutiny
          ? 'Die Gruppen bleiben in den Unterständen. Sie halten den Graben, aber sie gehen nirgends mehr hin.'
          : 'Das Ziel des Einsatzes ist entschieden.',
        verdict: word(r),
        confirm: 'Zur Feldzugskarte',
        onConfirm: () => finish(r, state, archive, ui),
      });
    },
  };
}
