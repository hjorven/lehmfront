// Demo der Erzaehlung (P15): der Tisch zwischen den Missionen, Prolog mit Aktkarte, Tagebuch der Kommandantin.
// Die Mission ist erfunden (Protokoll wie aus P05/P08), Texte, Feldpost und Gefallenenliste sind echt erzeugt.
// Aufruf: index.html?scene=erzaehlung
//   &ansicht=zwischen|prolog|tagebuch   (Standard zwischen)
//   &nach=a1m1 .. a4m5                  Mission, nach der der Tisch gedeckt wird
//   &ausgang=sieg|niederlage  &wetter=trocken|regen|schlamm|nebel|frost|schnee  &nacht=1
//   &vertrauen=0..100 &ansehen=0..100 &moral=0..100 &seed=n
//   &schritt=n        gleich auf Seite n aufschlagen (fuer Screenshots)
//   &wahl=<option>    Entscheidung auf dieser Seite gleich treffen
//   &tab=tagebuch|buch|funde|briefe     Lesezeichen im Tagebuch
import { loadTexts, loadNarrativeStyles } from '../ui/narrative/load.js';
import { playSteps } from '../ui/narrative/reader.js';
import { openJournal } from '../ui/narrative/journal.js';
import { buildInterlude, buildPrologue, applyChoice, followUpSteps, recordInterlude, createCampaign, missionTitle, tailSteps } from '../narrative/interlude.js';
import { MISSIONS } from '../narrative/texts.js';

const WEATHER_KIND = { trocken: 'clear', regen: 'rain', schlamm: 'mud', nebel: 'fog', frost: 'frost', schnee: 'snow' };

/** Erfundene Mission: drei Gruppen, Laengsfeuer, ein Verwundeter, warmes Essen, nachts ein Feuerueberfall */
export function demoMission(mission, { weather = 'regen', night = false, morale = 55, outcome = 'sieg' } = {}) {
  const groups = {
    a01: { label: '1. Gruppe', leader: 'Wiebke Albers', home: 'Ostmoor', type: 'rifles' },
    a02: { label: '2. Gruppe', leader: 'Dirk Lohmann', home: 'Wessel', type: 'rifles' },
    a03: { label: '3. Gruppe', leader: 'Remmer Siebels', home: 'Brookdorp', type: 'rifles' },
    a04: { label: 'MG-Trupp', leader: 'Arend Janssen', home: 'Kelling', type: 'mg' },
  };
  const heavy = outcome === 'niederlage';
  const rounds = [
    { turn: 2, night: false, kind: 'position', log: [
      { type: 'warm_meal', side: 'a', section: 'A', reason: 'Abschnitt A: warmes Essen.', at: { x: 29, y: 6 } },
      { type: 'losses', side: 'a', group: 'a02', amount: heavy ? 4 : 2, cause: 'enfilade', reason: 'Gruppe Lohmann: Verluste, Längsfeuer.', at: { x: 33, y: 14 } },
      { type: 'wounded', side: 'a', group: 'a02', count: 1, reason: 'Ein Verwundeter wartet.', at: { x: 33, y: 14 } },
    ] },
    { turn: 3, night: true, kind: 'battle', log: [
      { type: 'losses', side: 'a', group: 'a04', amount: heavy ? 3 : 1, cause: 'mg', reason: 'MG-Trupp Janssen: Verlust.', at: { x: 34, y: 30 } },
      { type: 'losses', side: 'a', group: 'a01', amount: 1, cause: 'artillery', reason: 'Gruppe Albers: Verlust.', at: { x: 46, y: 31 } },
      { type: 'wounded', side: 'a', group: 'a01', count: 1, reason: 'Verwundet.', at: { x: 46, y: 31 } },
      { type: 'supply_delivered', side: 'a', section: 'B', wounded: 2, reason: 'Abschnitt B: 2 Loren, 2 Verwundete zurück.', at: { x: 30, y: 15 } },
    ] },
    { turn: 4, night: false, kind: 'position', log: [] },
  ];
  const finalState = {
    groups: Object.keys(groups).map((id) => ({ id, side: 'a', morale: id === 'a02' ? morale - 25 : id === 'a04' ? morale - 10 : morale + 10, status: 'front' })),
    clock: { day: 3 + MISSIONS.indexOf(mission) * 4 },
    weather: { kind: WEATHER_KIND[weather] ?? 'rain' },
    night,
  };
  return { groups, rounds, finalState };
}

/** Kampagne bis vor `mission` durchgespielt: jede Entscheidung mit der ersten Wahl, Fundstuecke reihum */
export function demoCampaign(index, mission, base = {}) {
  let c = createCampaign({ seed: 7, ...base });
  const finds = index.list.filter((e) => e.art === 'fundstueck').map((e) => e.id);
  const upto = MISSIONS.indexOf(mission);
  for (let i = 0; i < upto; i++) {
    const m = MISSIONS[i];
    const d = demoMission(m, { weather: i % 2 ? 'regen' : 'trocken', night: i % 3 === 2 });
    const built = buildInterlude(index, { campaign: c, mission: m, outcome: i % 4 === 3 ? 'niederlage' : 'sieg', ...d, seed: c.seed, finds: finds.filter((_, k) => k % 6 === i % 6 || (i === 0 && k < 4)) });
    for (const s of built.steps) {
      if (s.kind !== 'decision') continue;
      const opt = s.sheet.options[0];
      if (opt) c = applyChoice(c, index, s.entry, opt.id);
    }
    c = recordInterlude(c, built);
  }
  return c;
}

export async function mount(root, params) {
  document.body.classList.add('menu');
  const [index] = await Promise.all([loadTexts(), loadNarrativeStyles()]);
  const map = await fetch(new URL('../../data/maps/asse.json', import.meta.url)).then((r) => r.json());
  root.innerHTML = '';

  const view = params.get('ansicht') ?? 'zwischen';
  const mission = MISSIONS.includes(params.get('nach')) ? params.get('nach') : 'a1m1';
  const weather = params.get('wetter') ?? 'regen';
  const night = params.get('nacht') === '1';
  const num = (k, d) => (params.has(k) && Number.isFinite(+params.get(k)) ? Math.max(0, Math.min(100, +params.get(k))) : d);
  const outcome = params.get('ausgang') === 'niederlage' ? 'niederlage' : 'sieg';
  const seed = Number(params.get('seed') ?? 42) >>> 0;
  let campaign = demoCampaign(index, mission, { vertrauen: num('vertrauen', 50), ansehen: num('ansehen', 50), seed });
  campaign.vertrauen = num('vertrauen', campaign.vertrauen);
  campaign.ansehen = num('ansehen', campaign.ansehen);

  const menu = document.createElement('div');
  menu.className = 'title';
  root.append(menu);
  const showMenu = (text) => {
    menu.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = 'Erzählung';
    const p = document.createElement('p');
    p.className = 'sub';
    p.textContent = text;
    const list = document.createElement('div');
    list.className = 'menu-list';
    const btn = (label, fn) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', fn);
      list.append(b);
    };
    btn('Zwischen den Missionen', () => interlude());
    btn('Prolog mit Aktkarte', () => prologue());
    btn('Tagebuch öffnen', () => openJournal({ campaign, index, tab: params.get('tab') }));
    menu.append(h, p, list);
  };

  function interlude(startAt) {
    const d = demoMission(mission, { weather, night, morale: num('moral', 55), outcome });
    const built = buildInterlude(index, {
      campaign, mission, outcome, ...d, map, seed,
      finds: params.get('fund') ? [params.get('fund')] : [index.list.find((e) => e.art === 'fundstueck' && !campaign.book.finds.includes(e.id))?.id].filter(Boolean),
    });
    let c = campaign;
    const extra = [];
    let fresh = built.book.fallen.map((f) => f.name);
    let journal = null;
    const r = playSteps({
      steps: built.steps,
      title: 'Nach dem Einsatz: ' + missionTitle(index, mission),
      startAt,
      finishLabel: built.next ? 'Zum Einsatz' : 'Schließen',
      stats: () => ({ ansehen: c.ansehen, vertrauen: c.vertrauen }),
      onChoice(id, opt) {
        c = applyChoice(c, index, id, opt);
        const more = followUpSteps(index, c, built, id);
        extra.push(...more.map((s) => s.entry));
        return { extra: more, tail: tailSteps(index, c, built) };
      },
      onJournal() {
        if (journal) return;
        journal = openJournal({ campaign: recordInterlude(c, built, { extraDiary: extra }), index, fresh, onClose: () => (journal = null) });
        fresh = [];
      },
    });
    if (params.get('wahl')) r.choose(params.get('wahl'));
    r.done.then(() => {
      campaign = recordInterlude(c, built, { extraDiary: extra });
      showMenu(`Nach ${missionTitle(index, mission)}: Ansehen ${campaign.ansehen}, Vertrauen ${campaign.vertrauen}, ${campaign.book.fallen.length} Namen im Buch des Abschnitts.`);
    });
    return r;
  }

  function prologue(startAt) {
    const built = buildPrologue(index, campaign, mission);
    const r = playSteps({ steps: built.steps, title: 'Vor dem Einsatz', startAt, finishLabel: 'Zum Einsatz' });
    r.done.then(() => showMenu('Prolog gelesen.'));
    return r;
  }

  showMenu('Briefe, Tagebuch, Feldpost und Gefallenenliste zwischen den Missionen.');
  const start = params.has('schritt') ? Number(params.get('schritt')) : undefined;
  if (view === 'zwischen') interlude(start);
  else if (view === 'prolog') prologue(start);
  else if (view === 'tagebuch') {
    const d = demoMission(mission, { weather, night });
    const built = buildInterlude(index, { campaign, mission, outcome, ...d, map, seed, finds: [] });
    const c = recordInterlude(campaign, built);
    openJournal({ campaign: c, index, fresh: built.book.fallen.map((f) => f.name), tab: params.get('tab') });
  }
}
