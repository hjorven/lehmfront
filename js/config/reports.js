// Erfahrungsberichte (Plan 4.3): Technik kommt, wenn die Truppe etwas erlebt hat. Reine Daten und reine Zaehler.
// Texte, Ausloeser in Worten und Wirkung stehen in data/texts/berichte.json (id "bericht.<id>").
// Jeder Zaehler liest das Protokoll-Archiv einer Mission (archive.rounds, P07) und gibt eine ganze Zahl zurueck;
// die Kampagne (js/campaign.js) addiert die Zaehler ueber alle Missionen und schaltet den Bericht ab "need" frei.
//
// Wirkung im Spiel: Die Kampagne legt die freigeschalteten Berichte als state.sides[side].reports (Liste) in den
// Spielzustand. Phasen fragen mit hasReport (Bonus nur mit Bericht) oder reportOpen (Sperre nur in der Kampagne,
// im freien Gefecht ist alles offen). Berichte fuer Mechaniken, die es noch nicht gibt (Stollen, Sappen ...),
// zaehlen schon mit; die Pakete dieser Mechaniken lesen dann hasReport.
//
// Rein: kein DOM, kein Date, kein Math.random.

const own = (r, side) => (r.log ?? []).filter((e) => e.side === side);
const foe = (r, side) => (r.log ?? []).filter((e) => e.side && e.side !== side);
const countType = (rounds, side, type) => rounds.reduce((n, r) => n + own(r, side).filter((e) => e.type === type).length, 0);
const sumType = (rounds, side, type, key) => rounds.reduce((n, r) => n + own(r, side).filter((e) => e.type === type).reduce((m, e) => m + (Number(e[key]) || 0), 0), 0);

/** Gefechte einer Mission: Runden von battle_start bis battle_end, je Gefecht eine Liste von Runden */
export function battlesOf(rounds) {
  const out = [];
  let cur = null;
  for (const r of rounds) {
    const log = r.log ?? [];
    if (!cur && (r.kind === 'battle' || log.some((e) => e.type === 'battle_start'))) cur = [];
    if (cur) cur.push(r);
    if (cur && log.some((e) => e.type === 'battle_end')) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur?.length) out.push(cur);
  return out;
}

/** Ergebnis eines Gefechts fuer eine Seite: 'taken', 'stuck', 'broken', 'time', 'defended' oder null */
export function battleOutcome(battle, side) {
  for (const r of battle) {
    const e = own(r, side).find((x) => x.type === 'battle_end');
    if (e) return e.outcome ?? null;
  }
  return null;
}

/** Hat die Seite in diesem Gefecht angegriffen? (Sturmstellung bezogen oder gestuermt) */
export function attackedIn(battle, side) {
  return battle.some((r) => own(r, side).some((e) => e.type === 'attack_set' || e.type === 'assault'));
}

/** Eigene Ausfaelle in einem Gefecht */
export function lossesIn(battle, side) {
  return battle.reduce((n, r) => n + own(r, side).filter((e) => e.type === 'losses').reduce((m, e) => m + (Number(e.amount) || 0), 0), 0);
}

/** Staerke der Gruppen, die in diesem Gefecht stuermten, zu Beginn (aus dem Startzustand der ersten Runde) */
export function assaultStrength(battle, side) {
  const ids = new Set();
  for (const r of battle) for (const e of own(r, side)) if (e.type === 'attack_set' || e.type === 'assault') ids.add(e.group);
  const start = battle[0]?.start?.groups ?? [];
  let n = 0;
  for (const g of start) if (ids.has(g.id)) n += g.strength ?? 0;
  return n;
}

/** Nahkaempfe, die die Seite gewonnen hat (als Angreifer genommen oder als Verteidiger abgewiesen) */
export function meleeWins(rounds, side) {
  let n = 0;
  for (const r of rounds) {
    for (const e of r.log ?? []) {
      if (e.type !== 'melee') continue;
      if (e.side === side && e.outcome === 'taken') n++;
      else if (e.side !== side && e.outcome === 'repelled') n++;
    }
  }
  return n;
}

/**
 * Die Berichte. id = Schluessel ohne "bericht.", act = ab welchem Akt der Stab ihn annimmt,
 * need = Schwelle, count(rounds, side) = Zaehler fuer eine Mission, perk = Kurzwort fuer die Wirkung im Spiel.
 * live = die Wirkung ist schon in den Regeln eingebaut (sonst wartet sie auf das Paket der Mechanik).
 */
export const REPORTS = [
  {
    id: 'faschinenbau', act: 1, need: 200, unit: 'Felder Graben', live: true,
    count: (rounds, side) => sumType(rounds, side, 'dig', 'cells'),
  },
  {
    id: 'traversen', act: 1, need: 1, unit: 'Verlust durch Längsfeuer', live: false,
    count: (rounds, side) => rounds.reduce((n, r) => n + own(r, side).filter((e) => e.type === 'losses' && e.cause === 'enfilade').length, 0),
  },
  {
    id: 'lattenroste', act: 1, need: 1, unit: 'Runde mit Wasser im Graben', live: true,
    count: (rounds, side) => rounds.filter((r) => own(r, side).some((e) => e.type === 'flood' || e.type === 'mud_morale')).length,
  },
  {
    id: 'tiefer_unterstand', act: 1, need: 1, unit: 'Unterstand im Vorbereitungsfeuer', live: false,
    count: (rounds, side) => {
      let n = 0;
      for (const r of rounds) {
        const prep = foe(r, side).some((e) => e.type === 'shelling' && e.kind === 'prep');
        if (!prep) continue;
        const hit = new Set(own(r, side).filter((e) => e.type === 'losses').map((e) => e.group));
        if (own(r, side).some((e) => e.type === 'dugout_stay' && !hit.has(e.group))) n++;
      }
      return n;
    },
  },
  {
    id: 'drahtscheren', act: 1, need: 1, unit: 'Sturm am Draht gescheitert', live: true,
    count: (rounds, side) => battlesOf(rounds).filter((b) => {
      const out = battleOutcome(b, side);
      return (out === 'stuck' || out === 'broken') && b.some((r) => own(r, side).some((e) => e.type === 'assault' && e.wire));
    }).length,
  },
  {
    id: 'feuerwalze', act: 1, need: 3, unit: 'Vorbereitungsfeuer', live: true,
    count: (rounds, side) => {
      const plans = new Set();
      for (const r of rounds) for (const e of own(r, side)) if (e.type === 'shelling' && e.kind === 'prep') plans.add(String(e.plan));
      return plans.size;
    },
  },
  {
    id: 'doppelleitung', act: 1, need: 1, unit: 'durchtrennte Leitung', live: false,
    count: (rounds, side) => countType(rounds, side, 'line_cut'),
  },
  {
    id: 'stahlhelme', act: 1, need: 50, unit: 'Ausfälle durch Artillerie', live: true,
    count: (rounds, side) => rounds.reduce((n, r) => n + own(r, side).filter((e) => e.type === 'losses' && e.cause === 'artillery').reduce((m, e) => m + (Number(e.amount) || 0), 0), 0),
  },
  {
    id: 'leichtes_mg', act: 1, need: 1, unit: 'Sturm vom MG abgewiesen', live: false,
    count: (rounds, side) => battlesOf(rounds).filter((b) => battleOutcome(b, side) === 'defended'
      && b.some((r) => foe(r, side).some((e) => e.type === 'losses' && e.cause === 'mg'))).length,
  },
  {
    id: 'grabenkeulen', act: 1, need: 3, unit: 'gewonnene Nahkämpfe', live: true,
    count: (rounds, side) => meleeWins(rounds, side),
  },
  {
    id: 'sanitaetsloren', act: 1, need: 20, unit: 'Verwundete per Lore', live: true,
    count: (rounds, side) => sumType(rounds, side, 'supply_delivered', 'wounded'),
  },
  {
    id: 'feldbahn_ausbauen', act: 1, need: 2, unit: 'Mal Depot leer', live: false,
    count: (rounds, side) => countType(rounds, side, 'depot_empty'),
  },
  {
    id: 'kochkisten', act: 1, need: 10, unit: 'warme Mahlzeiten', live: false,
    count: (rounds, side) => countType(rounds, side, 'warm_meal'),
  },
  {
    id: 'grabenpumpe', act: 2, need: 3, unit: 'Wasser trotz Entwässerung', live: false,
    count: (rounds, side) => countType(rounds, side, 'drain_failed') + countType(rounds, side, 'flood_drained'),
  },
  {
    id: 'horchgeraet', act: 2, need: 1, unit: 'entdeckter Stollen', live: false,
    count: (rounds, side) => countType(rounds, side, 'tunnel_detected'),
  },
  {
    id: 'leuchtpistolen', act: 2, need: 5, unit: 'Nachtgefechte', live: false,
    count: (rounds, side) => rounds.filter((r) => r.night && own(r, side).some((e) => e.type === 'battle_start' || e.type === 'flare')).length,
  },
  {
    id: 'sappenkopf', act: 2, need: 100, unit: 'Felder Sappe', live: false,
    count: (rounds, side) => sumType(rounds, side, 'sap', 'cells'),
  },
  {
    id: 'tarnung', act: 2, need: 2, unit: 'getroffene Batterien', live: false,
    count: (rounds, side) => countType(rounds, side, 'battery_hit'),
  },
  {
    id: 'lichtsignale', act: 2, need: 5, unit: 'durchtrennte Leitungen', live: false,
    count: (rounds, side) => countType(rounds, side, 'line_cut'),
  },
  {
    id: 'gefangenenbefragung', act: 2, need: 10, unit: 'Gefangene', live: false,
    count: (rounds, side) => rounds.reduce((n, r) => n + foe(r, side).filter((e) => e.type === 'group_captured').reduce((m, e) => m + (Number(e.count) || 0), 0)
      + own(r, side).filter((e) => e.type === 'prisoners').reduce((m, e) => m + (Number(e.count) || 0), 0), 0),
  },
];

export const REPORT_IDS = REPORTS.map((r) => r.id);

/** Wirkungen in Zahlen, die Phasen lesen (nur mit Bericht) */
export const REPORT_EFFECTS = {
  stahlhelme: { artilleryLossPct: 75 },   // Ausfaelle durch Splitter auf drei Viertel
  grabenkeulen: { meleePct: 115 },        // Kampfkraft im Nahkampf
  sanitaetsloren: { woundedFactor: 2 },   // steht in js/supply.js (woundedPerWagon)
};

/** Bericht vorhanden? Bonus nur in der Kampagne mit Bericht. */
export function hasReport(state, side, id) {
  const r = state?.sides?.[side]?.reports;
  return Array.isArray(r) ? r.includes(id) : !!r?.[id];
}

/** Freigeschaltet? Im freien Gefecht (keine Berichtsliste) ist alles offen, in der Kampagne nur mit Bericht. */
export function reportOpen(state, side, id) {
  const r = state?.sides?.[side]?.reports;
  if (r === undefined || r === null) return true;
  return Array.isArray(r) ? r.includes(id) : !!r[id];
}
