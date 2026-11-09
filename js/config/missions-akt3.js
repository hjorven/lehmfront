// Akt 3 "Materialschlacht" (Plan 8.1, 8.2, Paket P24): Szenario je Mission (mit Varianten nach Flags),
// Missionsziele und was der Feldzug vor dem Einsatz auf den Zustand legt. Rein: kein DOM, kein Date.
//
// a3m1 Kalte Rohre         halten, waehrend beide Seiten einschiessen; drei Feuerplaene (Walze lernen)
// a3m2 Gelber Nebel        die Gruppe im Sappenkopf aus dem Gas holen, Verwundete per Lore zurueck
// a3m3 Augen am Himmel     zwei Scheinbatterien, die Lask beschiesst; das Depot bleibt unentdeckt
// a3m4 Befehl 117          Gehoeft nehmen (befolgt), Graben vortreiben (umgedeutet) oder halten (verweigert)
// a3m5 Die laengste Nacht  Waffenruhe angenommen, geduldet oder abgelehnt
// a3m6 Die Walze           erste Linie nehmen und halten; Gas-Entscheidung wirkt (Batterien, Gaswolke)
import { registerMissionJudge } from '../campaign.js';
import { lineCells, distance } from '../map.js';
import { lyingCount } from '../truce.js';

/** Szenario je Mission: fester Name oder { base, flags: { flag: Szenario } } (erste passende Flag gewinnt) */
export const AKT3_SCENARIOS = {
  a3m1: 'akt3-m1',
  a3m2: 'akt3-m2',
  a3m3: 'akt3-m3',
  a3m4: { base: 'akt3-m4', flags: { befehl117_umgedeutet: 'akt3-m4-graben', befehl117_verweigert: 'akt3-m4-halten' } },
  a3m5: { base: 'akt3-m5', flags: { waffenruhe_angenommen: 'akt3-m5-ruhe', waffenruhe_abgelehnt: 'akt3-m5-halten' } },
  a3m6: 'akt3-m6',
};

/** Grenzen in Stellungsrunden */
export const LIMITS = { a3m1: 6, a3m2: 6, a3m3: 6, a3m4: 6, a3m5: 2, a3m6: 4 };

export const KRONING = [];
for (let y = 25; y <= 27; y++) for (let x = 34; x <= 36; x++) KRONING.push({ x, y });
export const KRONING_CENTER = { x: 35, y: 26 };
export const RESCUE_ID = 'a01';

/** Morrows erste Linie vor dem Abschnitt (Feuergraben, wie in tools/maps/kroning.mjs) */
export const FIRST_LINE = (() => {
  const pts = [[41, 1], [41, 9], [42, 11], [42, 22], [41, 24], [41, 30], [42, 32], [42, 38]];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < pts.length - 1; i++) {
    for (const [x, y] of lineCells(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])) {
      const k = x + ',' + y;
      if (seen.has(k) || y < 10 || y > 30) continue;
      seen.add(k);
      out.push({ x, y });
    }
  }
  return out;
})();

// ------------------------------------------------------------------ Hilfen (rein)

const positionRounds = (rounds) => rounds.filter((r) => r.kind === 'position').length;
const ownLog = (rounds, side, type) => rounds.flatMap((r) => (r.log ?? []).filter((e) => e.type === type && e.side === side));
const sum = (list, k = 'count') => list.reduce((n, e) => n + (Number(e[k]) || 0), 0);
const ms = (side) => (side === 'a' ? 'own' : 'enemy');
const trenchSide = (state, p) => state?.cells?.[p.x + ',' + p.y]?.trench?.side ?? null;
const groupsAt = (state, cells, side) => (state?.groups ?? []).filter((g) => g.status !== 'lost' && g.side === side && cells.some((c) => c.x === g.pos.x && c.y === g.pos.y));
const foeOf = (side) => (side === 'a' ? 'b' : 'a');

/** Eigene Grabenfelder der vorderen Linie, die der Gegner genommen hat */
export function frontLost(state, side) {
  const foe = ms(foeOf(side));
  let n = 0;
  for (const k of Object.keys(state?.cells ?? {})) {
    const x = Number(k.split(',')[0]);
    const inFront = side === 'a' ? x >= 28 && x <= 30 : x >= 41 && x <= 42;
    if (inFront && state.cells[k]?.trench?.side === foe && state.cells[k].trench.captured) n++;
  }
  return n;
}

/** Anteil der in dieser Mission verlorenen Leute (0..1): Verluste aus dem Protokoll gegen die Staerke am Anfang */
export function lossRatio(state, side, rounds = []) {
  const lost = rounds.reduce((n, r) => n + (r.log ?? []).filter((e) => e.type === 'losses' && e.side === side).reduce((m, e) => m + (Number(e.amount) || 0), 0), 0);
  let left = 0;
  for (const g of state?.groups ?? []) if (g.side === side && g.status !== 'lost') left += g.strength;
  const start = left + lost;
  return start ? lost / start : 0;
}

// ------------------------------------------------------------------ Vorbereitung

/**
 * Vor dem Einsatz (nach prepareAkt2): Feuerwalze ist ab Akt 3 bekannt, zur Walze gibt es Stahlhelme; die
 * Gas-Entscheidung nach a3m3 wirkt in a3m6. Gibt einen neuen Zustand zurueck.
 */
export function prepareAkt3(mission, state, campaign, side = 'a') {
  const s = structuredClone(state);
  const st = s.sides[side];
  if (!st) return s;
  const add = (r) => { if (!(st.reports ?? []).includes(r)) st.reports = [...(st.reports ?? []), r].sort(); };
  add('feuerwalze');
  if (mission === 'a3m6') add('stahlhelme');
  const flags = campaign?.flags ?? [];
  const foe = foeOf(side);
  if (mission === 'a3m6' && flags.includes('gas_batterien')) {
    // Die Batterien im Zelva-Wald haben das Gas abbekommen: weniger Munition, weniger Kanoniere
    // (die Feldhaubitzen im Zelva-Wald schweigen die ersten Runden, ihr Lager ist halb leer)
    for (const b of s.sides[foe].artillery?.batteries ?? []) {
      if (b.type !== 'feldhaubitzen') continue;
      if (Number.isFinite(b.ammo)) b.ammo = Math.floor(b.ammo / 2);
      b.silenced = Math.max(b.silenced | 0, 2);
    }
    s.sides[foe].gasHit = 'batterien';
  }
  if (mission === 'a3m6' && flags.includes('gas_abgeblasen')) {
    // Die Gruppen in Morrows erster Linie haben das abgeblasene Gas abbekommen. Die Karte erinnert sich.
    for (const g of s.groups) {
      if (g.side !== foe || g.status === 'lost' || g.pos.x > 43) continue;
      g.strength = Math.max(1, g.strength - 2);
      g.morale = Math.max(10, g.morale - 12);
    }
    for (const p of FIRST_LINE) {
      const k = p.x + ',' + p.y;
      s.cells[k] = { ...(s.cells[k] ?? {}), gasStain: 0 };
    }
    s.sides[foe].gasHit = 'graeben';
  }
  return s;
}

// ------------------------------------------------------------------ Missionsziele

/** a3m1: den vorderen Graben bis Runde 12 halten, dabei einen Feuerplan mit drei Abschnitten anlegen */
export function judgeA3m1({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const lost = frontLost(state, side);
  if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder des vorderen Grabens verloren` };
  const three = rounds.some((r) => (r.log ?? []).filter((e) => e.type === 'fire_plan' && e.side === side).length >= 3);
  if ((state?.turn ?? 0) > 12 || positionRounds(rounds) >= LIMITS.a3m1 || final) {
    if (lost) return { outcome: 'sieg', orderMet: false, why: `Graben gehalten, aber ${lost === 1 ? 'ein Feld' : lost + ' Felder'} verloren` };
    return { outcome: 'sieg', orderMet: three, why: three ? 'Graben gehalten, Feuerplan mit drei Abschnitten angelegt' : 'Graben gehalten, aber kein Feuerplan mit drei Abschnitten' };
  }
  return null;
}

/** Verwundete, die in den Abschnitten noch auf eine Lore warten */
function waitingWounded(state, side) {
  let n = 0;
  for (const sec of Object.values(state?.sides?.[side]?.supply?.sections ?? {})) {
    for (const v of Object.values(sec?.wounded ?? {})) n += Number(v) || 0;
  }
  return n;
}

/** a3m2: die Gruppe im Sappenkopf in den Hauptgraben zurueck, die Haelfte der Verwundeten per Lore */
export function judgeA3m2({ state, rounds, side, final }) {
  const g = (state?.groups ?? []).find((x) => x.id === RESCUE_ID && x.side === side);
  if (!g || g.status === 'lost') return { outcome: 'niederlage', orderMet: false, why: 'Die Gruppe im Sappenkopf ist im Gas geblieben' };
  if (state?.turnKind === 'battle' && !final) return null;
  const home = g.pos.x <= 30 && trenchSide(state, g.pos) !== ms(foeOf(side));
  const n = positionRounds(rounds);
  const wounded = sum(ownLog(rounds, side, 'wounded'));
  const carried = state?.sides?.[side]?.supply?.stats?.woundedCarried ?? 0;
  const half = carried * 2 >= wounded;
  if (home) {
    // Zurueck ist die Gruppe; die Mission endet, wenn die Loren gefahren sind (oder die Zeit um ist)
    if ((n < 2 || (!half && waitingWounded(state, side) > 0)) && n < LIMITS.a3m2 && !final) return null;
    return { outcome: 'sieg', orderMet: half, why: half ? 'Gruppe zurück, die Verwundeten fahren mit der Lore' : `Gruppe zurück, aber erst ${carried} von ${wounded} Verwundeten auf der Lore` };
  }
  if (n >= LIMITS.a3m2 || final) return { outcome: 'niederlage', orderMet: false, why: 'Die Gruppe sitzt noch im Sappenkopf' };
  return null;
}

/** a3m3: Depot bleibt unentdeckt, zwei Scheinbatterien werden beschossen */
export function judgeA3m3({ state, rounds, side, final }) {
  const st = state?.sides?.[side];
  if (st?.depotSpotted) return { outcome: 'niederlage', orderMet: false, why: 'Der feindliche Flieger hat das Depot gefunden' };
  const shelled = (st?.decoys ?? []).filter((d) => (d.hits | 0) > 0).length;
  const known = Object.keys(st?.artillery?.known ?? {}).filter((id) => /^mb/.test(id)).length;
  const flags = known ? ['zelva_aufgeklaert'] : [];
  const n = positionRounds(rounds);
  if (shelled >= 2 && n >= 3) return { outcome: 'sieg', orderMet: true, why: 'Lask schießt auf Holz und Ofenrohr, das Depot ist sicher', flags };
  if (n >= LIMITS.a3m3 || final) {
    if (shelled >= 1) return { outcome: 'sieg', orderMet: false, why: 'Eine Attrappe beschossen, das Depot ist sicher', flags };
    return { outcome: 'niederlage', orderMet: false, why: 'Lask hat keine Attrappe beschossen', flags };
  }
  return null;
}

/** a3m4: je nach Entscheidung Gehoeft nehmen, Graben vortreiben oder halten */
export function judgeA3m4({ state, rounds, side, final }) {
  const id = state?.scenario?.id ?? 'akt3-m4';
  const n = positionRounds(rounds);
  if (state?.turnKind === 'battle' && !final) return null;
  const ratio = lossRatio(state, side, rounds);
  if (id === 'akt3-m4-graben') {
    // Der Graben muss bis an den Hof heran (ein Feld davor) und bis zur dritten Runde stehen
    const near = Object.keys(state?.cells ?? {}).some((k) => {
      const t = state.cells[k]?.trench;
      if (!t || t.side !== ms(side)) return false;
      const [x, y] = k.split(',').map(Number);
      return KRONING.some((c) => distance({ x, y }, c) <= 1);
    });
    if (near && n >= 3) return { outcome: 'sieg', orderMet: ratio < 1 / 3, why: ratio < 1 / 3 ? 'Graben bis vor das Gehöft vorgetrieben und gehalten' : 'Graben bis vor das Gehöft, aber mit schweren Verlusten' };
    if (n >= LIMITS.a3m4 || final) return { outcome: 'niederlage', orderMet: false, why: near ? 'Der Graben vor dem Gehöft ist nicht zu halten' : 'Der Graben ist nicht bis zum Gehöft gekommen' };
    return null;
  }
  if (id === 'akt3-m4-halten') {
    const lost = frontLost(state, side);
    if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder des vorderen Grabens verloren` };
    if (n >= LIMITS.a3m4 || final) return { outcome: 'sieg', orderMet: !lost && ratio < 1 / 3, why: lost ? 'Abschnitt gehalten, mit Verlust an Graben' : 'Abschnitt gehalten, ohne das Gehöft' };
    return null;
  }
  const ours = groupsAt(state, KRONING, side).length;
  const theirs = groupsAt(state, KRONING, foeOf(side)).length;
  if (ours && !theirs) {
    const cheap = ratio < 1 / 3;
    return { outcome: 'sieg', orderMet: cheap, why: cheap ? 'Gehöft Kroning genommen' : 'Gehöft Kroning genommen, um einen hohen Preis', flags: cheap ? [] : ['kroning_teuer'] };
  }
  if (n >= LIMITS.a3m4 || final) return { outcome: 'niederlage', orderMet: false, why: 'Das Gehöft bleibt bei Morrow' };
  return null;
}

/** a3m5: Waffenruhe angenommen, geduldet oder abgelehnt */
export function judgeA3m5({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const id = state?.scenario?.id ?? 'akt3-m5';
  const st = state?.sides?.[side] ?? {};
  const n = positionRounds(rounds);
  const got = st.recovered | 0;
  const total = got + (st.lyingDied | 0) + lyingCount(state, side);
  const t = st.truce ?? null;
  const flags = [];
  if (t?.brokenBy === side) flags.push('waffenruhe_gebrochen');
  if (t?.abusedBy === side) flags.push('waffenruhe_ausgenutzt');
  if (id === 'akt3-m5-halten') {
    const lost = frontLost(state, side);
    const missing = sum(ownLog(rounds, side, 'men_captured'));
    if (lost >= 2 || missing >= 3) return { outcome: 'niederlage', orderMet: false, why: lost >= 2 ? 'Graben verloren in der längsten Nacht' : `${missing} Vermisste an Morrow verloren`, flags };
    if (n >= LIMITS.a3m5 || final) return { outcome: 'sieg', orderMet: true, why: got ? `Stellung gehalten, ${got} Verwundete trotzdem hereingeholt` : 'Stellung gehalten. Draußen ist es still geworden', flags };
    return null;
  }
  const done = total > 0 && got >= total;
  if (done && n >= 1) return { outcome: 'sieg', orderMet: true, why: `Alle ${got} Verwundeten geborgen`, flags };
  if (n >= LIMITS.a3m5 || final) {
    if (got * 2 >= total) return { outcome: 'sieg', orderMet: false, why: `${got} von ${total} Verwundeten geborgen, die anderen blieben draußen`, flags };
    return { outcome: 'niederlage', orderMet: false, why: `Nur ${got} von ${total} Verwundeten geborgen`, flags };
  }
  return null;
}

/** a3m6: mit der Walze die erste Linie nehmen und bis Runde 16 halten */
export function judgeA3m6({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const held = FIRST_LINE.filter((p) => trenchSide(state, p) === ms(side)).length;
  const n = positionRounds(rounds);
  const verdict = () => (held >= 3
    ? { outcome: 'sieg', orderMet: held >= 8, why: held >= 8 ? `${held} Felder der ersten Linie genommen und gehalten` : `${held} Felder der ersten Linie gehalten, der Stab wollte den Durchbruch` }
    : { outcome: 'niederlage', orderMet: false, why: held ? 'Nur ein Fuß in der ersten Linie, der Gegenstoß hat sie zurückgeholt' : 'Die erste Linie ist nicht genommen' });
  if ((state?.turn ?? 0) >= 16 && held >= 3) return verdict();
  if (n >= LIMITS.a3m6 || final) return verdict();
  return null;
}

export const AKT3_JUDGES = { a3m1: judgeA3m1, a3m2: judgeA3m2, a3m3: judgeA3m3, a3m4: judgeA3m4, a3m5: judgeA3m5, a3m6: judgeA3m6 };
for (const [m, fn] of Object.entries(AKT3_JUDGES)) registerMissionJudge(m, fn);
