// Szene "feldzug" (P14): die Kampagne. Feldzugskarte zwischen den Missionen, Prolog, Rueckkehr aus dem Einsatz
// (Abrechnung, Gefallenenliste, Post, Entscheidungen), vorzeitige Enden, Aufbruch zum naechsten Einsatz.
// Aufruf: index.html?scene=feldzug
//   &seed=n             Seed eines neuen Feldzugs
//   &demo=mitte|tief|hoch|ende   Beispielstand fuer Screenshots (wird nicht gespeichert)
//   &stempel=befolgen|umdeuten|verweigern   im Beispielstand den Befehl gleich abstempeln
//   &bericht=<id>       im Beispielstand einen Erfahrungsbericht aufschlagen
import { ensureCss } from '../ui/dom.js';
import { loadTexts, loadNarrativeStyles } from '../ui/narrative/load.js';
import { playPrologue, playInterlude, showJournal } from '../ui/narrative/index.js';
import { playSteps } from '../ui/narrative/reader.js';
import { diarySheet } from '../narrative/sheets.js';
import { fillSheet, storyValues } from '../narrative/interlude.js';
import { MISSIONS, pickSlot } from '../narrative/texts.js';
import { loadMap } from '../map.js';
import { audio, playSfx, setAmbience } from '../audio/engine.js';
import { newCampaign, normalizeCampaign, finishMission, afterInterlude, stampOrder, replyBand } from '../campaign.js';
import { scenarioForMission } from '../config/missions.js';
import { createBoard, telegramLines } from '../ui/campaign/board.js';
import {
  loadCampaign, saveCampaign, clearCampaign, saveMissionStart, loadMissionReturn, clearMissionReturn,
} from '../ui/campaign/store.js';

const fetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error('Datei fehlt: ' + url); return r.json(); });

/** Seed einer Mission aus Kampagnen-Seed und Missionsnummer */
export function missionSeed(campaign, mission) {
  return ((Math.imul((campaign.seed >>> 0) || 1, 2654435761) ^ (MISSIONS.indexOf(mission) + 1) * 40503) >>> 0) || 1;
}

/** Beispielstaende fuer Screenshots und zum Ausprobieren */
export function demoCampaign(kind) {
  const c = newCampaign({ seed: 214, ansehen: 50, vertrauen: 50 });
  const step = (m, outcome, a, v, front) => {
    c.outcomes[m] = outcome;
    c.history.push({ mission: m, ansehen: a, vertrauen: v, outcome });
    c.front.push(front);
    c.ansehen = a;
    c.vertrauen = v;
  };
  step('a1m1', 'sieg', 57, 52, 1);
  step('a1m2', 'niederlage', 49, 46, 0);
  step('a1m3', 'sieg', 58, 50, 1);
  c.mission = 'a1m4';
  c.stamps = { a1m1: 'befolgen', a1m2: 'befolgen', a1m3: 'umdeuten' };
  c.counters = { faschinenbau: 131, feuerwalze: 1, stahlhelme: 22, kochkisten: 7, sanitaetsloren: 9, grabenkeulen: 1, doppelleitung: 1, lattenroste: 2 };
  c.reports = ['doppelleitung', 'lattenroste'];
  c.fresh = ['lattenroste'];
  c.ledger = [{ mission: 'a1m3', stage: 'mission', outcome: 'sieg', changes: [
    { axis: 'ansehen', amount: 3, key: 'befehl', reason: 'Stabsbefehl S-9/03 erfüllt (umgedeutet, halbe Wirkung).' },
    { axis: 'ansehen', amount: 4, key: 'gelaende_gewonnen', reason: '4 Grabenfelder genommen.' },
    { axis: 'vertrauen', amount: 2, key: 'mahlzeiten', reason: '9 warme Mahlzeiten vorn.' },
    { axis: 'vertrauen', amount: 1, key: 'verwundete', reason: '5 Verwundete zurückgebracht.' },
    { axis: 'vertrauen', amount: -2, key: 'verluste', reason: '11 Ausfälle in dieser Mission.' },
    { axis: 'vertrauen', amount: -1, key: 'truppe', reason: 'Ablösungen, Gruppen zu lange vorn, liegen gelassene Verwundete.' },
  ] }];
  c.reply = { mission: 'a1m3', outcome: 'sieg', band: replyBand(c.ansehen) };
  if (kind === 'hoch') {
    c.ansehen = 82;
    c.vertrauen = 64;
    c.history.push({ mission: 'a1m3', ansehen: 82, vertrauen: 64, outcome: 'sieg' });
    c.reply.band = replyBand(82);
  }
  if (kind === 'tief' || kind === 'ende') {
    step('a1m4', 'niederlage', 31, 41, 0);
    step('a1m5', 'sieg', 19, 33, 1);
    c.mission = 'a1m6';
    c.threat = { mission: 'a1m5' };
    c.withheld = ['traversen'];
    c.counters.traversen = 1;
    c.fresh = [];
    c.reply = { mission: 'a1m5', outcome: 'sieg', band: replyBand(c.ansehen) };
    c.ledger.push({ mission: 'a1m5', stage: 'mission', outcome: 'sieg', changes: [
      { axis: 'ansehen', amount: 2, key: 'befehl', reason: 'Stabsbefehl S-19/05 erfüllt (umgedeutet, halbe Wirkung).' },
      { axis: 'ansehen', amount: -14, key: 'stempel', reason: 'Stabsbefehl verweigert.' },
      { axis: 'vertrauen', amount: 4, key: 'stempel', reason: 'Die Truppe hört, dass Sie Nein gesagt haben.' },
      { axis: 'vertrauen', amount: -8, key: 'verluste', reason: '27 Ausfälle in dieser Mission.' },
      { axis: 'vertrauen', amount: -3, key: 'sturm_verlust', reason: 'Sturm, der mehr als die Hälfte der Leute gekostet hat.' },
    ] });
  }
  if (kind === 'ende') {
    c.ansehen = 8;
    c.history.push({ mission: 'a1m5', ansehen: 8, vertrauen: 33, outcome: 'sieg' });
    c.ended = 'vorzeitig_abgeloest';
    c.mission = 'a1m5';
  }
  return c;
}

/** Schritte eines vorzeitigen Endes (data/texts/enden.json, ende = vorzeitig_*) fuer den Tisch der Erzaehlung */
export function endingSteps(index, key, values) {
  return index.list
    .filter((e) => e.art === 'ende' && e.ende === key)
    .sort((a, b) => (a.seite ?? 0) - (b.seite ?? 0))
    .map((e) => {
      const sheet = e.blatt === 'telegramm'
        ? { id: e.id, kind: 'telegram', heading: 'STABSTELEGRAMM', number: '', urgent: true, fields: [], lines: telegramLines(e.text), footer: [], typed: true }
        : diarySheet(e, { title: e.titel });
      return { kind: e.blatt === 'telegramm' ? 'order' : 'diary', id: e.id, sheet: fillSheet(sheet, values), entry: e.id, about: e.titel };
    });
}

export async function mount(root, params) {
  root.innerHTML = '';
  await Promise.all([
    ensureCss('css/gefecht.css'),
    ensureCss('css/feldzug.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "IBM Plex Mono"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const [index] = await Promise.all([loadTexts(), loadNarrativeStyles()]);
  audio.init();
  document.title = 'Lehmfront · Feldzugskarte';

  const demo = /^(mitte|tief|hoch|ende)$/.test(params.get('demo') ?? '') ? params.get('demo') : null;
  const save = (c) => { if (!demo) saveCampaign(c); };
  let campaign;
  let board = null;
  let fromMission = false;

  async function playEnding(c) {
    const values = storyValues({}, null, c.storyValues);
    const steps = endingSteps(index, c.ended, values);
    if (!steps.length) return;
    const r = playSteps({ steps, title: c.ended === 'vorzeitig_meuterei' ? 'Meuterei' : 'Abgelöst', finishLabel: 'Zur Feldzugskarte' });
    await r.done;
  }

  async function processReturn(ret) {
    const order = index.list.find((e) => e.art === 'befehl' && e.mission === ret.mission) ?? null;
    const f = finishMission(campaign, {
      mission: ret.mission, outcome: ret.outcome, orderMet: ret.orderMet, rounds: ret.rounds ?? [],
      finalState: ret.finalState ?? null, order, start: ret.start ?? null,
    });
    let c = f.campaign;
    if (!c.ended) {
      let map = null;
      try {
        const scen = await fetchJson(`data/scenarios/${scenarioForMission(ret.mission)}.json`);
        map = loadMap(await fetchJson(`data/maps/${scen.map}.json`));
      } catch { map = null; }
      const r = await playInterlude({
        campaign: c, mission: ret.mission, outcome: c.outcomes[ret.mission], rounds: ret.rounds ?? [],
        finalState: ret.finalState ?? null, map, seed: missionSeed(c, ret.mission),
      });
      c = afterInterlude(r.campaign);
    }
    campaign = c;
    save(campaign);
    clearMissionReturn();
    fromMission = true;
    if (campaign.ended) await playEnding(campaign);
  }

  if (demo) {
    campaign = demoCampaign(demo);
    const st = params.get('stempel');
    if (/^(befolgen|umdeuten|verweigern)$/.test(st ?? '') && !campaign.ended) {
      const order = index.list.find((e) => e.art === 'befehl' && e.mission === campaign.mission);
      campaign = stampOrder(campaign, campaign.mission, st, order);
    }
  } else {
    const stored = loadCampaign();
    campaign = stored ? normalizeCampaign(stored) : null;
    const ret = loadMissionReturn();
    if (campaign && ret && ret.mission === campaign.mission && !campaign.ended) await processReturn(ret);
    else if (ret) clearMissionReturn();
    if (!campaign) {
      const seed = (Number(params.get('seed')) >>> 0) || ((Date.now() % 1000000007) >>> 0) || 1;
      campaign = newCampaign({ seed, side: 'a', faction: 'kaldern' });
      save(campaign);
      const r = await playPrologue({ campaign, mission: campaign.mission });
      campaign = afterInterlude({ ...normalizeCampaign(r.campaign), mission: campaign.mission });
      save(campaign);
    }
  }

  // Umgebung im Gefechtsstand: fernes Grollen, gedaempft
  setAmbience({ darkness: 0.55, battle: 0.05, rain: 0, wind: 0.1 });

  board = createBoard(root, {
    campaign, index, openLedger: fromMission || !!demo,
    onStamp(stamp) {
      const m = campaign.mission;
      const order = index.list.find((e) => e.art === 'befehl' && e.mission === m) ?? null;
      campaign = stampOrder(campaign, m, stamp, order);
      save(campaign);
      playSfx('stamp', { intensity: stamp === 'verweigern' ? 0.9 : 0.6 });
      board.update(campaign);
      if (stamp !== 'befolgen') {
        const t = pickSlot(index, `stab.stempel.${stamp}`, { ansehen: campaign.ansehen, vertrauen: campaign.vertrauen });
        if (t) playSfx('teletype', { count: Math.min(40, t.text.split(/\s+/).length * 2), bell: true, delay: 0.5 });
      }
      if (campaign.ended) playEnding(campaign).then(() => board.update(campaign));
    },
    onStart() {
      if (demo || campaign.ended) return;
      const m = campaign.mission;
      if (!campaign.stamps?.[m]) {
        const order = index.list.find((e) => e.art === 'befehl' && e.mission === m) ?? null;
        campaign = stampOrder(campaign, m, 'befolgen', order);
      }
      const seed = missionSeed(campaign, m);
      const scenario = scenarioForMission(m);
      campaign = { ...campaign, fresh: [], reply: null };
      save(campaign);
      saveMissionStart({ mission: m, seed, scenario });
      playSfx('paper', { intensity: 0.6 });
      location.href = `${location.pathname}?scene=gefecht&scenario=${encodeURIComponent(scenario)}&campaign=1&seed=${seed}`;
    },
    onJournal() {
      playSfx('paper', { intensity: 0.5 });
      showJournal({ campaign });
    },
    onNew() {
      if (demo) return;
      clearCampaign();
      location.href = `${location.pathname}?scene=feldzug`;
    },
  });

  // Die Antwort des Stabs kommt ueber den Fernschreiber: je knapper der Text, desto kuerzer das Rattern
  if (fromMission && campaign.reply) {
    const t = pickSlot(index, 'stab.antwort', { ansehen: campaign.ansehen, vertrauen: campaign.vertrauen, outcome: campaign.reply.outcome });
    if (t) playSfx('teletype', { count: Math.max(2, Math.min(48, t.text.split(/\s+/).length * 2)), bell: true });
  }
  const rep = params.get('bericht');
  if (demo && rep) board.el.querySelector(`[data-report="${CSS.escape(rep)}"]`)?.click();
}
