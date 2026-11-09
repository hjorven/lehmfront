// Einhaengung der Erzaehlung fuer die Kampagne (P14). P14 ruft nur diese Funktionen auf:
//
//   import { playInterlude, playPrologue, showJournal } from './js/ui/narrative/index.js';
//
//   // Vor der ersten Mission: Zeitungen, Aktkarte, Lage und Stabsbefehl von a1m1
//   campaign = (await playPrologue({ campaign })).campaign;
//
//   // Nach jeder Mission: Gefallenenliste, Tagebuch, Briefe, Feldpost, Fundstuecke, Entscheidungen,
//   // beim Aktwechsel Zeitungen und Aktkarte, dann Lage und Befehl der naechsten Mission
//   const r = await playInterlude({ campaign, mission: 'a1m3', outcome: 'sieg', archive, finalState, map, finds: [] });
//   campaign = r.campaign;             // Ansehen, Vertrauen, Flags, Buch des Abschnitts fortgeschrieben
//
//   showJournal({ campaign });         // Tagebuch jederzeit oeffnen (z. B. Taste T auf der Feldzugskarte)
//
// Der Kampagnenzustand ist reines JSON (Aufbau in js/narrative/interlude.js, createCampaign).
import { loadTexts, loadNarrativeStyles } from './load.js';
import { playSteps } from './reader.js';
import { openJournal } from './journal.js';
import { buildInterlude, buildPrologue, applyChoice, followUpSteps, recordInterlude, createCampaign, missionTitle } from '../../narrative/interlude.js';

export { createCampaign, loadTexts };

/**
 * Zwischen zwei Missionen. input: { campaign, mission, outcome, archive | rounds, finalState, map, seed, finds,
 * letterCount, startAt, hooks }. Liefert { campaign, built, choices }.
 */
export async function playInterlude(input) {
  const [index] = await Promise.all([loadTexts(), loadNarrativeStyles()]);
  const rounds = input.rounds ?? input.archive?.rounds ?? [];
  const built = buildInterlude(index, { ...input, rounds });
  let campaign = input.campaign;
  const extraDiary = [];
  const snapshot = () => recordInterlude(campaign, built, { extraDiary });
  const fresh = built.book.fallen.map((f) => f.name);
  let journal = null;
  const reader = playSteps({
    steps: built.steps,
    title: 'Nach dem Einsatz: ' + missionTitle(index, input.mission),
    startAt: input.startAt,
    hooks: input.hooks,
    finishLabel: built.next ? 'Zum Einsatz' : 'Schließen',
    stats: () => ({ ansehen: campaign.ansehen, vertrauen: campaign.vertrauen }),
    onChoice(decisionId, optionId) {
      campaign = applyChoice(campaign, index, decisionId, optionId);
      const more = followUpSteps(index, campaign, built, decisionId);
      for (const s of more) extraDiary.push(s.entry);
      return more;
    },
    onJournal() {
      if (journal) return;
      journal = openJournal({ campaign: snapshot(), index, fresh, onClose: () => (journal = null) });
    },
  });
  const { choices } = await reader.done;
  journal?.close();
  return { campaign: snapshot(), built, choices };
}

/** Vor der ersten Mission (oder beim Einstieg in eine spaetere): Zeitungen, Aktkarte, Lage, Befehl */
export async function playPrologue({ campaign = createCampaign(), mission = 'a1m1', startAt, hooks } = {}) {
  const [index] = await Promise.all([loadTexts(), loadNarrativeStyles()]);
  const built = buildPrologue(index, campaign, mission);
  let c = campaign;
  const reader = playSteps({
    steps: built.steps,
    title: 'Vor dem Einsatz',
    startAt,
    hooks,
    finishLabel: 'Zum Einsatz',
    stats: () => ({ ansehen: c.ansehen, vertrauen: c.vertrauen }),
    onChoice(decisionId, optionId) {
      c = applyChoice(c, index, decisionId, optionId);
      return followUpSteps(index, c, built, decisionId);
    },
  });
  const { choices } = await reader.done;
  return { campaign: c, choices };
}

/** Tagebuch oeffnen. fresh: Namen, die beim Oeffnen eingetragen werden. Liefert { close, closed } */
export async function showJournal({ campaign, fresh = [], tab = null } = {}) {
  const [index] = await Promise.all([loadTexts(), loadNarrativeStyles()]);
  return openJournal({ campaign, index, fresh, tab });
}
