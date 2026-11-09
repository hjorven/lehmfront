// Kampagnenrahmen (Plan 2.4, 2.6, 3.1, 4.3, P14): Ansehen beim Stab und Vertrauen der Truppe mit allen Ausloesern
// und Wirkungen, Stabsbefehle mit Stempel (befolgen, umdeuten, verweigern), Erfahrungsberichte aus dem Protokoll,
// Ersatz und Nachschub nach Ansehen, Abloesung der Kommandantin unter 10, Meuterei unter 10.
//
// Der Kampagnenzustand ist reines JSON und erweitert createCampaign aus js/narrative/interlude.js (P15):
//   { side, faction, ansehen, vertrauen, flags, outcomes, seed, book,                       <- P15
//     mission, counters: { <bericht>: n }, reports: [ids], withheld: [ids], fresh: [ids],
//     stamps: { <mission>: 'befolgen'|'umdeuten'|'verweigern' }, ledger: [{ mission, changes }],
//     history: [{ mission, ansehen, vertrauen, outcome }], front: [Zahl je Mission], threat: null|{ mission },
//     ended: null|'vorzeitig_abgeloest'|'vorzeitig_meuterei', reply: null|{ mission, outcome, band } }
//
// Rein: kein DOM, kein Date, kein Math.random. Alle Werte ganze Zahlen.
import { createCampaign } from './narrative/interlude.js';
import { MISSIONS, actOf, nextMission } from './narrative/texts.js';
import { REPORTS, battlesOf, battleOutcome, attackedIn, lossesIn, assaultStrength } from './config/reports.js';
import { faction } from './config/factions.js';
import { DEFAULT_INCOME } from './config/supply.js';
import { REPLACEMENTS_CAP } from './config/morale.js';

/** Schwellen aus Plan 2.6 */
export const LIMITS = {
  THREAT: 25,    // Ansehen darunter: der Stab droht mit Abloesung, Berichte bleiben beim Stab liegen
  RELIEF: 10,    // Ansehen darunter: Brandt wird abgeloest, die Kampagne endet
  REFUSE: 25,    // Vertrauen darunter: Gruppen koennen in Akt 4 Sturmbefehle verweigern (Regel in P26)
  MUTINY: 10,    // Vertrauen darunter: Meuterei, Mission verloren, die Kampagne endet
};

/** Kappen je Mission, damit eine einzelne Mission die Achsen nicht umwirft */
export const CAPS = {
  groundWon: 6, groundLost: 8, prisoners: 4,
  meals: 3, post: 2, wounded: 4, cheapAttack: 4, heavyLosses: 10, bledAssault: 6,
};

const clamp = (v) => Math.max(0, Math.min(100, Math.trunc(v)));
/** Haelfte, zur Null hin gerundet, aber nie 0, wenn etwas da war */
const half = (n) => (n === 0 ? 0 : n > 0 ? Math.max(1, Math.floor(n / 2)) : -Math.max(1, Math.floor(-n / 2)));

/** Neue Kampagne (P15-Zustand plus die Felder des Kampagnenrahmens) */
export function newCampaign(over = {}) {
  const base = createCampaign(over);
  return {
    mission: MISSIONS[0],
    counters: {},
    reports: [],
    withheld: [],
    fresh: [],
    stamps: {},
    ledger: [],
    history: [{ mission: null, ansehen: base.ansehen, vertrauen: base.vertrauen, outcome: null }],
    front: [],
    threat: null,
    ended: null,
    reply: null,
    ...base,
  };
}

/** Fehlende Felder nachtragen (Kampagne aus P15 oder aelterer Spielstand) */
export function normalizeCampaign(c) {
  const n = newCampaign({});
  const out = structuredClone(c);
  for (const [k, v] of Object.entries(n)) if (out[k] === undefined) out[k] = structuredClone(v);
  out.book = { ...n.book, ...(out.book ?? {}) };
  return out;
}

// ------------------------------------------------------------------ Wirkungen der Achsen

/** Nachschub je Stellungsrunde in Prozent: 60 bei Ansehen 0, 100 bei 50, 140 bei 100 */
export function supplyPct(ansehen) {
  return 60 + Math.floor((clamp(ansehen) * 4) / 5);
}

/** Ersatz zwischen zwei Missionen (Mann, gruen): ab Ansehen 18 einer, je 8 Punkte mehr einer dazu */
export function replacementsFor(ansehen) {
  return Math.max(0, Math.floor((clamp(ansehen) - 10) / 8));
}

/** Munition der Batterien in Prozent: unter 25 die Haelfte, ab 75 ein Viertel mehr */
export function batteryPct(ansehen) {
  if (ansehen < LIMITS.THREAT) return 50;
  if (ansehen >= 75) return 125;
  return 100;
}

/** Moralerholung in Prozent: zwischen 40 und 60 Vertrauen neutral, darunter langsamer, darueber schneller */
export function recoveryPct(vertrauen) {
  const t = clamp(vertrauen);
  if (t >= 40 && t <= 60) return 100;
  return 70 + Math.floor((t * 3) / 5);
}

/** Grabgeschwindigkeit in Prozent (dieselbe Formel wie der Grabfaktor "vertrauen" in js/phases/dig.js) */
export function digPct(vertrauen) {
  return 80 + Math.floor((clamp(vertrauen) * 2) / 5);
}

/** Alles, was die beiden Werte gerade bewirken, als Zahlen und Worte fuer die Feldzugskarte */
export function axisEffects(campaign, act = actOf(campaign.mission ?? MISSIONS[0])) {
  const a = campaign.ansehen, v = campaign.vertrauen;
  return {
    supplyPct: supplyPct(a),
    replacements: replacementsFor(a),
    batteryPct: batteryPct(a),
    reportsHeld: a < LIMITS.THREAT,
    threat: a < LIMITS.THREAT,
    recoveryPct: recoveryPct(v),
    digPct: digPct(v),
    refuse: v < LIMITS.REFUSE && act >= 4,
    refuseSoon: v < LIMITS.REFUSE && act < 4,
  };
}

// ------------------------------------------------------------------ Ausloeser einer Mission

const ownLog = (rounds, side) => rounds.flatMap((r) => (r.log ?? []).filter((e) => e.side === side));
const foeLog = (rounds, side) => rounds.flatMap((r) => (r.log ?? []).filter((e) => e.side && e.side !== side));
const n = (list, type) => list.filter((e) => e.type === type).length;
const sum = (list, type, key) => list.filter((e) => e.type === type).reduce((m, e) => m + (Number(e[key]) || 0), 0);

/** Zahlen einer Mission, aus denen die Ausloeser rechnen (alles aus dem Protokoll) */
export function missionCounts(rounds, side) {
  const own = ownLog(rounds, side);
  const foe = foeLog(rounds, side);
  const battles = battlesOf(rounds);
  let cheap = 0, bled = 0;
  for (const b of battles) {
    if (!attackedIn(b, side)) continue;
    const out = battleOutcome(b, side);
    const lost = lossesIn(b, side);
    const strength = assaultStrength(b, side);
    if (out === 'taken' && lost <= Math.max(2, Math.floor(strength / 5))) cheap++;
    if ((out === 'stuck' || out === 'broken') && strength > 0 && lost * 2 > strength) bled++;
  }
  return {
    won: n(own, 'breach') + n(own, 'trench_taken'),
    lost: n(foe, 'breach') + n(own, 'trench_lost'),
    prisoners: foe.filter((e) => e.type === 'group_captured').reduce((m, e) => m + (Number(e.count) || 0), 0) + sum(own, 'prisoners', 'count'),
    meals: n(own, 'warm_meal'),
    post: rounds.filter((r) => (r.log ?? []).some((e) => e.type === 'feldpost' && (!e.side || e.side === side))).length,
    woundedSaved: sum(own, 'supply_delivered', 'wounded'),
    losses: sum(own, 'losses', 'amount'),
    cheapAttacks: cheap,
    bledAssaults: bled,
    mutiny: own.some((e) => e.type === 'mutiny'),
  };
}

/** Folgen des Stabsbefehls nach Stempel: befolgen voll, umdeuten halb, verweigern nichts (schon beim Stempeln bezahlt) */
export function orderConsequence(order, fulfilled, stamp = 'befolgen') {
  const f = fulfilled ? order?.folgen?.erfuellt : order?.folgen?.verfehlt;
  if (!f || stamp === 'verweigern') return { ansehen: 0, vertrauen: 0 };
  if (stamp === 'umdeuten') return { ansehen: half(f.ansehen ?? 0), vertrauen: half(f.vertrauen ?? 0) };
  return { ansehen: f.ansehen ?? 0, vertrauen: f.vertrauen ?? 0 };
}

/**
 * Alle Aenderungen der beiden Achsen nach einer Mission, jede mit deutscher Begruendung.
 * input: { rounds, side, faction, outcome, order (Befehl-Eintrag aus den Texten), orderMet (bool, Standard: Sieg),
 *          stamp, start: { reputation, trust } (Werte zu Beginn der Mission), end: { reputation, trust } (am Ende) }
 * Liefert [{ axis: 'ansehen'|'vertrauen', amount, key, reason }], ohne Nullen, in fester Reihenfolge.
 */
export function missionAxes(input) {
  const side = input.side ?? 'a';
  const f = faction(input.faction ?? 'kaldern');
  const repPct = Math.round((f.losses?.reputation ?? 1) * 100);
  const trustPct = Math.round((f.losses?.trust ?? 1) * 100);
  const c = missionCounts(input.rounds ?? [], side);
  const out = [];
  const add = (axis, amount, key, reason) => { if (amount) out.push({ axis, amount: Math.trunc(amount), key, reason }); };
  const met = input.orderMet ?? input.outcome === 'sieg';

  // Ansehen beim Stab
  if (input.order) {
    const k = orderConsequence(input.order, met, input.stamp);
    const what = met ? 'erfüllt' : 'verfehlt';
    const how = input.stamp === 'umdeuten' ? ' (umgedeutet, halbe Wirkung)' : '';
    add('ansehen', k.ansehen, 'befehl', `Stabsbefehl ${input.order.nr ?? ''} ${what}${how}.`.replace('  ', ' '));
    add('vertrauen', k.vertrauen, 'befehl', `Stabsbefehl ${what}.`);
  }
  if (input.start && input.end) {
    add('ansehen', (input.end.reputation ?? 50) - (input.start.reputation ?? 50), 'gefecht', 'Gegenstöße im Gefecht befohlen oder versäumt.');
  }
  add('ansehen', Math.min(CAPS.groundWon, c.won), 'gelaende_gewonnen', `${c.won} ${c.won === 1 ? 'Grabenfeld' : 'Grabenfelder'} genommen.`);
  if (c.lost) add('ansehen', -Math.min(CAPS.groundLost, Math.ceil((c.lost * repPct) / 100)), 'gelaende_verloren', `${c.lost} ${c.lost === 1 ? 'Grabenfeld' : 'Grabenfelder'} verloren.`);
  add('ansehen', Math.min(CAPS.prisoners, Math.floor(c.prisoners / 2)), 'gefangene', `${c.prisoners} Gefangene eingebracht.`);

  // Vertrauen der Truppe
  if (input.start && input.end) {
    add('vertrauen', (input.end.trust ?? 50) - (input.start.trust ?? 50), 'truppe', 'Ablösungen, Gruppen zu lange vorn, liegen gelassene Verwundete.');
  }
  add('vertrauen', Math.min(CAPS.meals, Math.floor(c.meals / 4)), 'mahlzeiten', `${c.meals} warme Mahlzeiten vorn.`);
  add('vertrauen', Math.min(CAPS.post, c.post), 'post', 'Die Feldpost kam durch.');
  add('vertrauen', Math.min(CAPS.wounded, Math.floor(c.woundedSaved / 4)), 'verwundete', `${c.woundedSaved} Verwundete zurückgebracht.`);
  add('vertrauen', Math.min(CAPS.cheapAttack, c.cheapAttacks * 2), 'angriff_billig', 'Angriff mit geringen Verlusten.');
  const heavy = Math.floor((Math.floor(Math.max(0, c.losses - 4) / 3) * trustPct) / 100);
  if (heavy) add('vertrauen', -Math.min(CAPS.heavyLosses, heavy), 'verluste', `${c.losses} Ausfälle in dieser Mission.`);
  if (c.bledAssaults) add('vertrauen', -Math.min(CAPS.bledAssault, c.bledAssaults * 3), 'sturm_verlust', 'Sturm, der mehr als die Hälfte der Leute gekostet hat.');
  return out;
}

// ------------------------------------------------------------------ Stabsbefehl mit Stempel

/** Sofortige Folgen eines Stempels auf dem Stabsbefehl */
export function stampCost(order, stamp) {
  if (stamp === 'umdeuten') return { ansehen: -1, vertrauen: 2 };
  if (stamp === 'verweigern') {
    const base = Math.abs(order?.folgen?.verfehlt?.ansehen ?? 6) + 2;
    return { ansehen: -(order?.eilt ? base + 2 : base), vertrauen: 4 };
  }
  return { ansehen: 0, vertrauen: 0 };
}

/**
 * Stabsbefehl abstempeln. Ein Stempel je Mission, er kann nicht zurueckgenommen werden.
 * Liefert die neue Kampagne (mit ledger-Eintrag und Pruefung der Schwellen).
 */
export function stampOrder(campaign, mission, stamp, order) {
  if (!['befolgen', 'umdeuten', 'verweigern'].includes(stamp)) throw new Error('Unbekannter Stempel: ' + stamp);
  if (campaign.stamps?.[mission]) return campaign;
  const c = normalizeCampaign(campaign);
  c.stamps[mission] = stamp;
  const k = stampCost(order, stamp);
  const changes = [];
  if (k.ansehen) changes.push({ axis: 'ansehen', amount: k.ansehen, key: 'stempel', reason: stamp === 'verweigern' ? 'Stabsbefehl verweigert.' : 'Rückfrage beim Stab, Befehl umgedeutet.' });
  if (k.vertrauen) changes.push({ axis: 'vertrauen', amount: k.vertrauen, key: 'stempel', reason: stamp === 'verweigern' ? 'Die Truppe hört, dass Sie Nein gesagt haben.' : 'Die Truppe merkt, dass Sie nachfragen.' });
  applyChanges(c, changes);
  if (changes.length) c.ledger.push({ mission, stage: 'stempel', changes });
  return checkThresholds(c, mission);
}

// ------------------------------------------------------------------ Erfahrungsberichte

/**
 * Zaehler einer Mission addieren. Erreichte Berichte des aktuellen oder eines frueheren Akts kommen an;
 * liegt das Ansehen unter 25, bleiben sie beim Stab liegen (withheld) und kommen, sobald es wieder steigt.
 */
export function countReports(campaign, rounds, side, act) {
  const c = structuredClone(campaign);
  c.counters ??= {};
  c.reports ??= [];
  c.withheld ??= [];
  const reached = [];
  for (const r of REPORTS) {
    const add = r.count(rounds, side) | 0;
    if (add > 0) c.counters[r.id] = (c.counters[r.id] ?? 0) + add;
    if (r.act > act) continue;
    if (c.reports.includes(r.id) || c.withheld.includes(r.id)) continue;
    if ((c.counters[r.id] ?? 0) >= r.need) reached.push(r.id);
  }
  return { campaign: c, reached };
}

function deliverReports(c, ids) {
  for (const id of ids) {
    if (c.ansehen < LIMITS.THREAT) {
      if (!c.withheld.includes(id)) c.withheld.push(id);
    } else if (!c.reports.includes(id)) {
      c.reports.push(id);
      c.fresh.push(id);
    }
  }
}

// ------------------------------------------------------------------ Schwellen

function applyChanges(c, changes) {
  for (const ch of changes) c[ch.axis] = clamp(c[ch.axis] + ch.amount);
}

/** Schwellen pruefen: Abloesung und Meuterei beenden die Kampagne, unter 25 droht der Stab, Berichte kommen nach */
export function checkThresholds(campaign, mission = campaign.mission) {
  const c = structuredClone(campaign);
  if (c.ended) return c;
  if (c.ansehen < LIMITS.RELIEF) c.ended = 'vorzeitig_abgeloest';
  else if (c.vertrauen < LIMITS.MUTINY) c.ended = 'vorzeitig_meuterei';
  if (c.ansehen < LIMITS.THREAT) {
    if (!c.threat) c.threat = { mission };
  } else {
    c.threat = null;
    if (c.withheld?.length) {
      const back = c.withheld.slice().sort();
      c.withheld = [];
      deliverReports(c, back);
    }
  }
  return c;
}

// ------------------------------------------------------------------ Mission abschliessen

/**
 * Ende einer Mission in die Kampagne buchen (vor playInterlude, damit Tagebuch und Briefe die neuen Werte lesen).
 * input: { mission, outcome: 'sieg'|'niederlage', rounds (archive.rounds), finalState, order, orderMet?, flags?,
 *          start: { reputation, trust } (Werte, mit denen die Mission begann) }
 * Liefert { campaign, changes, reached, ended }.
 */
export function finishMission(campaign, input) {
  let c = normalizeCampaign(campaign);
  const side = c.side ?? 'a';
  const mission = input.mission ?? c.mission;
  const rounds = input.rounds ?? [];
  const sideState = input.finalState?.sides?.[side] ?? null;
  const counts = missionCounts(rounds, side);
  const mutiny = counts.mutiny || !!sideState?.mutiny;
  const outcome = mutiny ? 'niederlage' : input.outcome === 'sieg' ? 'sieg' : 'niederlage';

  const changes = missionAxes({
    rounds, side, faction: c.faction, outcome, order: input.order ?? null, orderMet: mutiny ? false : input.orderMet,
    stamp: c.stamps[mission] ?? 'befolgen',
    start: input.start ?? null,
    end: sideState ? { reputation: sideState.reputation ?? 50, trust: sideState.trust ?? 50 } : null,
  });
  applyChanges(c, changes);
  c.ledger.push({ mission, stage: 'mission', outcome, changes });
  // Flags der Mission (harms_gefallen, velde_verloren ...), die das Missionsziel meldet
  for (const f of [...(input.flags ?? [])].sort()) if (typeof f === 'string' && !c.flags.includes(f)) c.flags.push(f);
  c.outcomes[mission] = outcome;

  // Front auf der Feldzugskarte: Sieg schiebt sie ein Stueck vor, Niederlage zurueck
  const prev = c.front.length ? c.front[c.front.length - 1] : 0;
  c.front.push(Math.max(-3, Math.min(3, prev + (outcome === 'sieg' ? 1 : -1))));

  const act = actOf(mission);
  const r = countReports(c, rounds, side, act);
  c = r.campaign;
  c.fresh = [];
  deliverReports(c, r.reached);

  c.reply = { mission, outcome, band: replyBand(c.ansehen) };
  if (mutiny) c.ended = 'vorzeitig_meuterei';
  c = checkThresholds(c, mission);
  c.history.push({ mission, ansehen: c.ansehen, vertrauen: c.vertrauen, outcome });
  c.mission = c.ended ? mission : nextMission(mission) ?? mission;
  return { campaign: c, changes, reached: r.reached, ended: c.ended };
}

/** Nach den Entscheidungen der Zwischenszene (playInterlude) erneut pruefen und den Verlauf nachtragen */
export function afterInterlude(campaign) {
  let c = normalizeCampaign(campaign);
  c = checkThresholds(c, c.mission);
  const last = c.history[c.history.length - 1];
  if (last && (last.ansehen !== c.ansehen || last.vertrauen !== c.vertrauen)) {
    c.history[c.history.length - 1] = { ...last, ansehen: c.ansehen, vertrauen: c.vertrauen };
  }
  return c;
}

// ------------------------------------------------------------------ Antwort des Stabs (Ueberraschung)

/** Je tiefer das Ansehen, desto knapper der Stab: 'herzlich' ab 75, 'sachlich' ab 50, 'knapp' ab 25, 'kalt' darunter */
export function replyBand(ansehen) {
  if (ansehen >= 75) return 'herzlich';
  if (ansehen >= 50) return 'sachlich';
  if (ansehen >= LIMITS.THREAT) return 'knapp';
  return 'kalt';
}

// ------------------------------------------------------------------ Mission starten

/**
 * Kampagne auf den Startzustand einer Mission legen (nach createInitialState und initEtappen):
 * Ansehen und Vertrauen, Berichte, Nachschub, Batteriemunition, Ersatz. Gibt einen neuen Zustand zurueck.
 */
export function applyCampaignToState(state, campaign, side = campaign.side ?? 'a') {
  const s = structuredClone(state);
  const st = s.sides[side];
  if (!st) return s;
  const fx = axisEffects(campaign, actOf(campaign.mission ?? MISSIONS[0]));
  st.reputation = clamp(campaign.ansehen);
  st.trust = clamp(campaign.vertrauen);
  st.reports = [...(campaign.reports ?? [])].sort();
  st.campaign = {
    mission: campaign.mission ?? null,
    supplyPct: fx.supplyPct,
    replacementPct: fx.supplyPct,
    batteryPct: fx.batteryPct,
    act: actOf(campaign.mission ?? MISSIONS[0]),
    refuse: fx.refuse,
  };
  st.supplies = { ...(st.supplies ?? {}) };
  const income = { ...DEFAULT_INCOME, ...(st.supplies.income ?? {}) };
  st.supplies.income = Object.fromEntries(Object.keys(income).sort().map((k) => [k, Math.floor((income[k] * fx.supplyPct) / 100)]));
  for (const k of ['ammo', 'food', 'material']) {
    if (Number.isFinite(st.supplies[k])) st.supplies[k] = Math.floor((st.supplies[k] * fx.supplyPct) / 100);
  }
  for (const b of st.artillery?.batteries ?? []) {
    if (Number.isFinite(b.ammo)) b.ammo = Math.floor((b.ammo * fx.batteryPct) / 100);
  }
  const men = Math.min(REPLACEMENTS_CAP, fx.replacements);
  st.replacements = { tenths: Math.min(REPLACEMENTS_CAP * 10, (st.replacements?.tenths ?? 0) + men * 10) };
  return s;
}

/** Werte, mit denen eine Mission beginnt (fuer finishMission: start) */
export function startAxes(state, side = 'a') {
  return { reputation: state.sides[side]?.reputation ?? 50, trust: state.sides[side]?.trust ?? 50 };
}

// ------------------------------------------------------------------ Ausgang einer Mission

const judges = new Map();

/**
 * Missionsziel anmelden (P16 ff.): fn({ state, rounds, side, counts }) -> { outcome: 'sieg'|'niederlage', orderMet? } | null.
 * null heisst "noch nicht entschieden" (die Mission laeuft weiter); beim Beenden gilt dann die Standardwertung.
 */
export function registerMissionJudge(mission, fn) {
  judges.set(mission, fn);
}

/** Standardwertung ohne eigenes Missionsziel: verloren bei Meuterei oder mehr verlorenem als gewonnenem Graben */
export function defaultJudge({ rounds, side }) {
  const c = missionCounts(rounds, side);
  if (c.mutiny) return { outcome: 'niederlage', orderMet: false, why: 'Meuterei' };
  if (c.lost > c.won) return { outcome: 'niederlage', orderMet: false, why: 'Gelände verloren' };
  return { outcome: 'sieg', orderMet: true, why: c.won ? 'Gelände gewonnen' : 'Linie gehalten' };
}

/** Ausgang einer Mission: angemeldetes Ziel, sonst Standardwertung. final = true beim Beenden durch die Spielerin. */
export function judgeMission(mission, { state, rounds, side = 'a', final = false }) {
  const counts = missionCounts(rounds, side);
  if (counts.mutiny || state?.sides?.[side]?.mutiny) return { outcome: 'niederlage', orderMet: false, why: 'Meuterei', done: true };
  if (state?.result) {
    const won = state.result.winner === side;
    return { outcome: won ? 'sieg' : 'niederlage', orderMet: won, why: state.result.reason, done: true };
  }
  const fn = judges.get(mission);
  const r = fn ? fn({ state, rounds, side, counts }) : null;
  if (r) return { ...r, done: true };
  if (!final) return null;
  return { ...defaultJudge({ rounds, side }), done: true };
}

/** Archiv fuer den Rueckweg zur Feldzugskarte verschlanken: Protokoll und die Staerken zu Beginn jeder Runde */
export function slimRounds(rounds) {
  return rounds.map((r) => ({
    turn: r.turn, kind: r.kind, battleRound: r.battleRound ?? null, night: !!r.night, clock: r.clock ?? null,
    start: { groups: (r.start?.groups ?? []).map((g) => ({ id: g.id, side: g.side, type: g.type, strength: g.strength })) },
    log: r.log ?? [],
  }));
}
