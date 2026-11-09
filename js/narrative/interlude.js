// Ablauf zwischen zwei Missionen (Plan 2.5, data/texts/README.md "Reihenfolge zwischen den Missionen"):
// Gefallenenliste, Tagebuch, Briefe (brief, dann lask), generierte Feldpost, Fundstuecke, Entscheidungen,
// bei Aktwechsel Zeitungen und Aktkarte, dann Briefing und Stabsbefehl der naechsten Mission.
// Rein: kein DOM, kein Date, kein Math.random. Die Oberflaeche dazu steht in js/ui/narrative/.
//
// Kampagnenzustand (reines JSON, P14 haelt ihn):
//   { side, faction, ansehen, vertrauen, flags: [], outcomes: { a1m1: 'sieg' }, seed,
//     book: { fallen: [], diary: [], letters: [], finds: [], decisions: {} } }
import { matches, resolveEntries, actOf, actRoman, nextMission, fill, MISSIONS } from './texts.js';
import { rollCasualties, fixedDeathsAfter, groupInfoFrom } from './casualties.js';
import { missionStats } from './stats.js';
import { generateFieldPost, weatherWord, stainsFor } from '../letters.js';
import * as S from './sheets.js';

export function createCampaign(over = {}) {
  return {
    side: 'a',
    faction: 'kaldern',
    ansehen: 50,
    vertrauen: 50,
    flags: [],
    outcomes: {},
    seed: 1,
    book: { fallen: [], diary: [], letters: [], finds: [], decisions: {} },
    ...structuredClone(over),
  };
}

/** Wer in festen Texten faellt, wenn eine Mission ein Flag setzt (README: Harms a1m6, Vell a2m5) */
const FLAG_DEATHS = {
  harms_gefallen: { name: 'Otto Harms', home: 'Ostmoor', groupLabel: 'Feldwebel', causeText: 'gefallen' },
  vell_gefallen: { name: 'Jost Vell', home: 'Haverstadt', groupLabel: 'Leutnant, 1. Zug', causeText: 'beim Sturm gefallen' },
};

function textCtx(campaign, extra = {}) {
  return {
    ansehen: campaign.ansehen,
    vertrauen: campaign.vertrauen,
    flags: campaign.flags,
    fraktion: campaign.faction,
    ...extra,
  };
}

/** Platzhalter in allen Texten eines Blatts fuellen (feste Texte nennen {gruppe} und {gruppenfuehrer}) */
export function fillSheet(sheet, values) {
  const walk = (v) => (typeof v === 'string' ? fill(v, values) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(sheet);
}

/**
 * Werte fuer Platzhalter in festen Texten: eine lebende eigene Gruppe (die erste nach ID), sonst neutral.
 * P14/P16 duerfen input.storyValues mitgeben (z. B. die Gruppe, die in der Mission betroffen ist).
 */
export function storyValues(groups, finalState, over = {}) {
  const alive = Object.keys(groups).sort().filter((id) => finalState?.groups?.find((g) => g.id === id)?.status !== 'lost');
  const g = groups[alive[0]] ?? null;
  const leader = g?.leader ?? 'Unteroffizier Wessel';
  return {
    gruppe: g?.label ?? 'der 2. Gruppe',
    gruppenfuehrer: leader,
    gruppenfuehrer_nachname: leader.slice(leader.lastIndexOf(' ') + 1),
    abschnitt: 'Asse-Nord',
    tag: String(finalState?.clock?.day ?? 1),
    ...over,
  };
}

function step(kind, sheet, entry = null, more = {}) {
  return { kind, id: sheet.id, sheet, entry: entry ? entry.id : null, ...more };
}

/** Titel einer Mission aus ihrem Briefing */
export function missionTitle(index, mission) {
  const b = index.list.find((e) => e.art === 'briefing' && e.mission === mission);
  return b?.titel ?? mission;
}

/** Bloecke vor einer Mission: Zeitungen und Aktkarte beim Aktwechsel, Briefing, Stabsbefehl, Entscheidungen in der Mission */
export function beforeMission(index, campaign, mission, { fromMission = null } = {}) {
  const steps = [];
  const ctx = textCtx(campaign);
  const act = actOf(mission);
  const about = missionTitle(index, mission);
  if (!fromMission || actOf(fromMission) !== act) {
    const key = act === 1 ? 'vor-a1' : `a${act - 1}-a${act}`;
    const between = act === 1 ? 'Vor dem Feldzug' : `Zwischen Akt ${actRoman(act - 1)} und ${actRoman(act)}`;
    for (const e of resolveEntries(index, (x) => x.art === 'zeitung' && x.zwischen === key, ctx)) steps.push(step('newspaper', S.newspaperSheet(e), e, { about: between }));
    const card = index.byId.get(`a${act}.titel`);
    if (card) steps.push(step('actcard', S.actSheet(card), card, { about: 'Akt ' + actRoman(act) }));
  }
  for (const e of resolveEntries(index, (x) => x.art === 'briefing' && x.mission === mission, ctx)) steps.push(step('briefing', S.briefingSheet(e), e, { about }));
  for (const e of resolveEntries(index, (x) => x.art === 'befehl' && x.mission === mission, ctx)) steps.push(step('order', S.orderSheet(e), e, { about }));
  for (const e of resolveEntries(index, (x) => x.art === 'entscheidung' && x.mission === mission, ctx)) {
    steps.push(step('decision', S.decisionSheet(e, (w) => matches(w, ctx)), e, { about }));
  }
  return steps;
}

/** Prolog vor a1m1 (oder Einstieg in eine beliebige Mission): Zeitungen, Aktkarte, Briefing, Befehl */
export function buildPrologue(index, campaign, mission = MISSIONS[0]) {
  const values = storyValues({}, null, campaign.storyValues);
  const steps = beforeMission(index, campaign, mission).map((s) => ({ ...s, sheet: fillSheet(s.sheet, values) }));
  return { mission: null, next: mission, steps, values, followUps: followUpsFor(index) };
}

function followUpsFor(index) {
  const out = {};
  for (const e of index.list) {
    if (!e.nach_entscheidung) continue;
    (out[e.nach_entscheidung] ??= []).push(e.id);
  }
  return out;
}

/**
 * Alles zwischen dem Ende von input.mission und dem Start der naechsten.
 * input: { campaign, mission, outcome: 'sieg'|'niederlage', rounds (archive.rounds), finalState, map, seed,
 *          finds: [ids], letterCount, groups?, sector?, weather?, night? }
 * Liefert { mission, next, stats, casualties, fieldpost, steps, followUps, book }.
 */
export function buildInterlude(index, input) {
  const { campaign, mission, outcome } = input;
  const side = campaign.side ?? 'a';
  const faction = campaign.faction ?? 'kaldern';
  const seed = input.seed ?? campaign.seed ?? 0;
  const rounds = input.rounds ?? [];
  const fs = input.finalState ?? null;
  const groups = input.groups ?? (fs ? groupInfoFrom(fs, side) : {});
  const weather = weatherWord(input.weather ?? fs?.weather?.kind);
  const lastRound = rounds.length ? rounds[rounds.length - 1] : null;
  const night = input.night ?? fs?.night ?? lastRound?.night ?? false;
  const sector = input.sector ?? 'Asse-Nord';
  const title = missionTitle(index, mission);

  const casualties = rollCasualties(rounds, {
    side, faction, seed, mission, groups,
    used: campaign.book.fallen.map((f) => f.name),
  });
  // Erzaehlte Tote und Hauptfiguren, die in dieser Mission gefallen sind
  const known = new Set(campaign.book.fallen.map((f) => f.name));
  for (const d of fixedDeathsAfter(mission)) if (!known.has(d.name)) casualties.fallen.push(d);
  for (const [flag, d] of Object.entries(FLAG_DEATHS)) {
    if (campaign.flags.includes(flag) && !known.has(d.name)) casualties.fallen.push({ ...d, group: null, turn: null, at: null, story: true });
  }
  const stats = missionStats({ rounds, side, casualties, finalState: fs });
  const ctx = textCtx(campaign, { outcome, werte: stats, wetter: weather, tageszeit: night ? 'nacht' : 'tag' });
  const day = fs?.clock?.day ?? null;

  const steps = [];
  steps.push(step('casualties', S.casualtySheet({
    id: `liste-${mission}`, mission, missionTitle: title, sector, day, fallen: casualties.fallen, wounded: casualties.wounded.length,
  })));
  for (const e of resolveEntries(index, (x) => x.art === 'tagebuch' && x.nach === mission && !x.nach_entscheidung, ctx)) {
    steps.push(step('diary', S.diarySheet(e, { weather, title }), e));
  }
  // Auch die festen Briefe tragen Wetter und Tageszeit der Mission als Flecken; Lasks Briefe kommen als Abschrift
  const stains = stainsFor(weather, night);
  for (const e of resolveEntries(index, (x) => x.art === 'brief' && x.nach === mission, ctx)) {
    steps.push(step('letter', S.letterSheet(e, { fields: { stains, crooked: night, seed: e.id } }), e));
  }
  for (const e of resolveEntries(index, (x) => x.art === 'lask' && x.nach === mission, ctx)) steps.push(step('lask', S.letterSheet(e, { title: 'Abgefangener Brief' }), e));

  const templates = index.list.filter((e) => e.art === 'feldpost' || e.art === 'ereignis' || e.art === 'anrede');
  const fieldpost = generateFieldPost({
    templates, side, faction, groups, state: fs, rounds, casualties,
    trust: campaign.vertrauen, reputation: campaign.ansehen, flags: campaign.flags, werte: stats,
    weather, night, act: actOf(mission), map: input.map ?? null, sector, seed, mission,
    count: input.letterCount ?? 3,
  });
  for (const fp of fieldpost) steps.push(step('fieldpost', S.fieldPostSheet(fp), null, { tone: fp.tone }));

  // Fundstuecke dieser Mission, Abschluss einer Kette, wenn alle vier beisammen sind
  const found = new Set(campaign.book.finds);
  for (const id of [...(input.finds ?? [])].sort()) {
    const e = index.byId.get(id);
    if (!e || found.has(id)) continue;
    found.add(id);
    steps.push(step('find', S.findSheet(e), e));
    steps.push(step('findnote', { id: e.id + '-notiz', kind: 'diary', date: e.fundort ?? '', title: e.titel ?? '', body: e.text, signature: 'I. B.', sketch: false }, e));
    const chain = index.list.filter((x) => x.art === 'fundstueck' && x.kette === e.kette);
    const end = index.list.find((x) => x.art === 'fundstueck-kette' && x.kette === e.kette);
    if (end && chain.length && chain.every((x) => found.has(x.id))) steps.push(step('findchain', S.findChainSheet(end), end));
  }

  for (const e of resolveEntries(index, (x) => x.art === 'entscheidung' && x.nach === mission, ctx)) {
    steps.push(step('decision', S.decisionSheet(e, (w) => matches(w, ctx)), e));
  }

  for (const s of steps) s.about ??= title;
  const next = nextMission(mission);
  if (next) for (const s of beforeMission(index, campaign, next, { fromMission: mission })) steps.push(s);
  const values = storyValues(groups, fs, input.storyValues);
  for (const s of steps) s.sheet = fillSheet(s.sheet, values);

  return {
    mission, outcome, next, stats, casualties, fieldpost, steps, values, followUps: followUpsFor(index),
    book: {
      fallen: casualties.fallen.map((c) => ({ ...c, mission, missionTitle: title })),
      diary: steps.filter((s) => s.kind === 'diary').map((s) => s.entry),
      letters: [
        ...steps.filter((s) => s.kind === 'letter' || s.kind === 'lask').map((s) => ({ id: s.entry, mission })),
        ...fieldpost.map((fp) => ({ id: fp.id, mission, fieldpost: fp })),
      ],
      finds: steps.filter((s) => s.kind === 'find').map((s) => s.entry),
    },
  };
}

const clamp = (v) => Math.max(0, Math.min(100, v));

/** Entscheidung anwenden: Folgen auf Ansehen und Vertrauen, Flags setzen, Wahl im Buch merken */
export function applyChoice(campaign, index, decisionId, optionId) {
  const d = index.byId.get(decisionId);
  const o = d?.optionen?.find((x) => x.id === optionId);
  if (!o) throw new Error(`Unbekannte Wahl ${optionId} in ${decisionId}`);
  const c = structuredClone(campaign);
  c.ansehen = clamp(c.ansehen + (o.folgen?.ansehen ?? 0));
  c.vertrauen = clamp(c.vertrauen + (o.folgen?.vertrauen ?? 0));
  for (const f of o.setzt ?? []) if (!c.flags.includes(f)) c.flags.push(f);
  c.book.decisions[decisionId] = optionId;
  return c;
}

/** Tagebuch direkt nach einer Entscheidung (nach_entscheidung), mit den Flags nach der Wahl */
export function followUpSteps(index, campaign, built, decisionId) {
  const ids = built.followUps?.[decisionId] ?? [];
  const ctx = textCtx(campaign, { outcome: built.outcome, werte: built.stats });
  return ids
    .map((id) => index.byId.get(id))
    .filter((e) => e && matches(e.wann, ctx))
    .map((e) => step('diary', fillSheet(S.diarySheet(e, { title: missionTitle(index, built.mission) }), built.values ?? {}), e, { about: missionTitle(index, built.mission) }));
}

/** Ergebnis einer Zwischenszene ins Kampagnenbuch uebernehmen (ohne Entscheidungen, die macht applyChoice) */
export function recordInterlude(campaign, built, { extraDiary = [] } = {}) {
  const c = structuredClone(campaign);
  if (built.mission) c.outcomes[built.mission] = built.outcome;
  const seenFallen = new Set(c.book.fallen.map((f) => f.name));
  for (const f of built.book.fallen) if (!seenFallen.has(f.name)) c.book.fallen.push(f);
  for (const id of [...built.book.diary, ...extraDiary]) if (!c.book.diary.includes(id)) c.book.diary.push(id);
  const seenLetters = new Set(c.book.letters.map((l) => l.id));
  for (const l of built.book.letters) if (!seenLetters.has(l.id)) c.book.letters.push(l);
  for (const id of built.book.finds) if (!c.book.finds.includes(id)) c.book.finds.push(id);
  return c;
}
