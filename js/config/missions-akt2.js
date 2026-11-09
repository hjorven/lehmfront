// Akt 2 "Lehm und Regen" (Plan 8.1, 8.2, Paket P23): Szenario je Mission (mit Varianten nach Flags),
// Missionsziele und was der Feldzug vor dem Einsatz auf den Zustand legt. Rein: kein DOM, kein Date.
//
// a2m1 Wasser im Graben   Sappe bis zum Heuwagen, Lattenroste in der Senke
// a2m2 Unter Huegel 214   Horchposten, Gegenstollen, feindlichen Stollen verschuetten (Variante: stollen_frueh)
// a2m3 Leuchtkugeln       drei Naechte gegen Morrows Stosstrupps, keine Gefangenen verlieren
// a2m4 Stosstrupp         eigener Stosstrupp mit Vell bei Nacht, Gefangene einbringen
// a2m5 Morgennebel        Vell greift an (vell_angriff) oder Gegenstoss in der Sappe
// a2m6 Der Trichter       Trichter vor der Kuppe besetzen, Rand ausbauen, halten (Variante: stollen_frueh)
import { registerMissionJudge } from '../campaign.js';
import { DOCTRINE_FLAGS, PLAYER_DOCTRINES } from './akt2.js';

/** Szenario je Mission: fester Name oder { base, flags: { flag: Szenario } } (erste passende Flag gewinnt) */
export const AKT2_SCENARIOS = {
  a2m1: 'akt2-m1',
  a2m2: { base: 'akt2-m2', flags: { stollen_frueh: 'akt2-m2-frueh' } },
  a2m3: 'akt2-m3',
  a2m4: 'akt2-m4',
  a2m5: { base: 'akt2-m5', flags: { vell_angriff: 'akt2-m5-angriff' } },
  a2m6: { base: 'akt2-m6', flags: { stollen_frueh: 'akt2-m6-frueh' } },
};

export const HEUWAGEN = { x: 35, y: 21 };
export const HILL_FOOT = [16, 17, 18, 19, 20, 21, 22].map((y) => ({ x: 40, y }));
export const SAP_TAIL = [33, 34, 35].map((x) => ({ x, y: 21 }));
export const CRATER = [];
for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) CRATER.push({ x: 40 + dx, y: 18 + dy });

/** Grenzen in Stellungsrunden (12 Stunden je Runde) */
export const LIMITS = { a2m1: 8, a2m2: 10, a2m3: 6, a2m4: 4, a2m5: 6, a2m6: 6 };

// ------------------------------------------------------------------ Hilfen (rein)

const positionRounds = (rounds) => rounds.filter((r) => r.kind === 'position').length;
const ownLog = (rounds, side, type) => rounds.flatMap((r) => (r.log ?? []).filter((e) => e.type === type && e.side === side));
const sum = (list, k = 'count') => list.reduce((n, e) => n + (Number(e[k]) || 0), 0);
const ms = (side) => (side === 'a' ? 'own' : 'enemy');
const trenchSide = (state, p) => state?.cells?.[p.x + ',' + p.y]?.trench?.side ?? null;
const groupsAt = (state, cells, side) => (state?.groups ?? []).filter((g) => g.status !== 'lost' && (side === null || g.side === side) && cells.some((c) => c.x === g.pos.x && c.y === g.pos.y));

export function officerFell(state, side, id) {
  return (state?.sides?.[side]?.officersFallen ?? []).includes(id);
}

/** Doktrin aus den Flags der Kampagne (die letzte Entscheidung gilt) */
export function doctrineFromFlags(flags = []) {
  let d = null;
  for (const f of flags) if (DOCTRINE_FLAGS[f]) d = DOCTRINE_FLAGS[f];
  return d;
}

/**
 * Vor dem Einsatz (nach applyCampaignToState): Doktrin aus der Entscheidung "Wie wir kämpfen", in Akt 2 kommen
 * Lattenroste mit dem Regen (Erfahrungsbericht gilt als bekannt). Gibt einen neuen Zustand zurueck.
 */
export function prepareAkt2(state, campaign, side = 'a') {
  const s = structuredClone(state);
  const st = s.sides[side];
  if (!st) return s;
  if (Array.isArray(st.reports) && !st.reports.includes('lattenroste')) st.reports = [...st.reports, 'lattenroste'].sort();
  // Gefallene Offiziere kommen nicht wieder: die Gruppe fuehrt dann ihr Gruppenfuehrer
  if ((campaign?.flags ?? []).includes('vell_gefallen')) {
    for (const g of s.groups) if (g.side === side && g.officer?.id === 'vell') delete g.officer;
  }
  const doc = doctrineFromFlags(campaign?.flags ?? []);
  if (doc) {
    st.doctrine = doc;
    const d = PLAYER_DOCTRINES[doc];
    if (d.ammoPct) for (const b of st.artillery?.batteries ?? []) if (Number.isFinite(b.ammo)) b.ammo = Math.floor((b.ammo * d.ammoPct) / 100);
    if (d.carts && st.supplies) {
      st.supplies.carts = Math.max(1, (st.supplies.carts ?? 0) + d.carts);
    }
    if (d.extra) {
      // Infiltration: die erste Schuetzengruppe ohne Offizier wird zum Stosstrupp ausgebildet
      const g = s.groups.filter((x) => x.side === side && x.type === 'rifles' && !x.officer && x.status !== 'lost').sort((p, q) => (p.id < q.id ? -1 : 1))[0];
      if (g) g.type = d.extra;
    }
  }
  return s;
}

// ------------------------------------------------------------------ Missionsziele

/** a2m1: Sappe bis zum Heuwagen und drei entwaesserte Grabenfelder, in acht Stellungsrunden */
export function judgeA2m1({ state, rounds, side, final }) {
  const sap = trenchSide(state, HEUWAGEN) === ms(side);
  // Nur eigene Lattenroste zaehlen (aus den eigenen Meldungen), jedes Feld einmal
  const drained = new Set(ownLog(rounds, side, 'drain').filter((e) => !e.blocked).flatMap((e) => (e.cells ?? []).map((c) => c.x + ',' + c.y))).size;
  if (sap && drained >= 3) return { outcome: 'sieg', orderMet: true, why: 'Sappe am Heuwagen, Senke entwässert' };
  const n = positionRounds(rounds);
  if (n >= LIMITS.a2m1 || final) {
    if (sap) return { outcome: 'sieg', orderMet: true, why: `Sappe am Heuwagen, aber nur ${drained} Felder entwässert` };
    return { outcome: 'niederlage', orderMet: false, why: n >= LIMITS.a2m1 ? 'Sappe nicht rechtzeitig am Heuwagen' : 'Sappe noch nicht am Heuwagen' };
  }
  return null;
}

/** a2m2: feindlichen Stollen verschuetten, bevor er unter der eigenen Linie zuendet */
export function judgeA2m2({ state, rounds, side, final }) {
  const foe = side === 'a' ? 'b' : 'a';
  const blown = rounds.flatMap((r) => (r.log ?? []).filter((e) => e.type === 'mine_blown' && e.by === foe && !e.camouflet));
  if (blown.length) return { outcome: 'niederlage', orderMet: false, why: 'Morrow hat zuerst gesprengt' };
  const enemy = state?.sides?.[foe]?.tunnels ?? [];
  if (enemy.length && enemy.every((t) => t.status === 'collapsed' || t.status === 'blown')) {
    return { outcome: 'sieg', orderMet: true, why: 'Feindlicher Stollen verschüttet' };
  }
  if (positionRounds(rounds) >= LIMITS.a2m2 || final) return { outcome: 'niederlage', orderMet: false, why: 'Der feindliche Stollen gräbt weiter' };
  return null;
}

/** a2m3: drei Naechte, nicht mehr als drei Vermisste; ohne Vermisste ist der Befehl erfuellt */
export function judgeA2m3({ state, rounds, side, final }) {
  const missing = sum(ownLog(rounds, side, 'men_captured'));
  if (missing >= 4) return { outcome: 'niederlage', orderMet: false, why: `${missing} Vermisste an Morrow verloren` };
  const n = positionRounds(rounds);
  if (n >= LIMITS.a2m3) return { outcome: 'sieg', orderMet: missing === 0, why: missing ? `${missing} Vermisste, die Posten halten` : 'Kein Posten verloren' };
  if (final) return { outcome: 'niederlage', orderMet: false, why: 'Zu früh gemeldet: drei Nächte stehen aus' };
  return null;
}

/** a2m4: mindestens zwei Gefangene (Befehl), einer reicht fuer den Erfolg; der Trupp darf nicht verloren gehen */
export function judgeA2m4({ state, rounds, side, final }) {
  const got = sum(ownLog(rounds, side, 'prisoners'));
  const raiders = (state?.groups ?? []).filter((g) => g.side === side && g.type === 'stormtroops');
  if (raiders.length && raiders.every((g) => g.status === 'lost')) return { outcome: 'niederlage', orderMet: false, why: 'Der Stoßtrupp kommt nicht zurück' };
  if (got >= 2) return { outcome: 'sieg', orderMet: true, why: `${got} Gefangene eingebracht` };
  if (positionRounds(rounds) >= LIMITS.a2m4 || final) {
    return got >= 1 ? { outcome: 'sieg', orderMet: false, why: 'Ein Gefangener, der Stab wollte zwei' } : { outcome: 'niederlage', orderMet: false, why: 'Keine Gefangenen' };
  }
  return null;
}

/** a2m5: Angriff (vell_angriff) nimmt den Graben am Hangfuss und haelt ihn; sonst Gegenstoss in der Sappe */
export function judgeA2m5({ state, rounds, side, final }) {
  const flags = officerFell(state, side, 'vell') ? ['vell_gefallen'] : [];
  const attack = state?.scenario?.id === 'akt2-m5-angriff';
  const n = positionRounds(rounds);
  const fighting = state?.turnKind === 'battle';
  if (attack) {
    const held = HILL_FOOT.filter((p) => trenchSide(state, p) === ms(side)).length;
    const verdict = () => (held >= 1
      ? { outcome: 'sieg', orderMet: held >= 2, why: held >= 2 ? `${held} Grabenfelder am Hang gehalten` : 'Ein Grabenfeld am Hang gehalten, der Stab wollte mehr', flags }
      : { outcome: 'niederlage', orderMet: false, why: 'Der Hang ist nicht genommen', flags });
    if (!fighting && held >= 2 && n >= 3) return verdict();
    if (n >= LIMITS.a2m5 || final) return verdict();
    return null;
  }
  const back = SAP_TAIL.every((p) => trenchSide(state, p) === ms(side)) && !groupsAt(state, SAP_TAIL, side === 'a' ? 'b' : 'a').length;
  if (back && !fighting) return { outcome: 'sieg', orderMet: true, why: 'Sappe bis zum Heuwagen zurückgenommen', flags };
  if (n >= LIMITS.a2m5 || final) return { outcome: 'niederlage', orderMet: false, why: 'Die Sappe bleibt in Morrows Hand', flags };
  return null;
}

/** a2m6: Trichter besetzen, Rand ausbauen, bis zur Daemmerung halten */
export function judgeA2m6({ state, rounds, side, final }) {
  const foe = side === 'a' ? 'b' : 'a';
  const n = positionRounds(rounds);
  if (state?.turnKind === 'battle' && !final) return null;
  const ours = groupsAt(state, CRATER, side).length;
  const theirs = groupsAt(state, CRATER, foe).length;
  const rim = CRATER.filter((p) => trenchSide(state, p) === ms(side)).length;
  if (n >= LIMITS.a2m6 || final) {
    if (ours && !theirs) {
      return { outcome: 'sieg', orderMet: rim >= 2, why: rim >= 2 ? 'Trichter besetzt und ausgebaut' : 'Trichter besetzt, der Rand ist nicht ausgebaut', flags: ['trichter_gehalten'] };
    }
    return { outcome: 'niederlage', orderMet: false, why: theirs ? 'Der Trichter gehört Morrow' : 'Niemand hält den Trichter' };
  }
  if (ours && !theirs && rim >= 3 && n >= 3) return { outcome: 'sieg', orderMet: true, why: 'Trichter besetzt, ausgebaut und gehalten', flags: ['trichter_gehalten'] };
  return null;
}

export const AKT2_JUDGES = { a2m1: judgeA2m1, a2m2: judgeA2m2, a2m3: judgeA2m3, a2m4: judgeA2m4, a2m5: judgeA2m5, a2m6: judgeA2m6 };
for (const [m, fn] of Object.entries(AKT2_JUDGES)) registerMissionJudge(m, fn);
