// Akt 4 "Das letzte Fruehjahr" (Plan 2.6, 4.2 Nr. 23 und 24, Paket P26): Szenario je Mission (mit Varianten nach
// Flags und nach dem Ende, auf das der Feldzug zulaeuft), Missionsziele und was der Feldzug vor dem Einsatz auf den
// Zustand legt. Rein: kein DOM, kein Date.
//
// a4m1 Tauwetter          Lasks geraeumte vordere Linie besetzen; er hat Fallen hinterlassen
// a4m2 Der Kasten         den Panzerwagen K1 bis an die zweite Linie bringen (sonst bleibt er als Wrack liegen)
// a4m3 Unter dem Huegel   die grosse Mine haelt bis zur Zuendung (gewarnt: der Huegel ist leer; geflutet: halten)
// a4m4 Geruechte          Sturm auf den Bahndamm, Gruppen verweigern; vier Fassungen nach der Entscheidung
// a4m5 Die Bruecke        Pionierbruecke mit Gleis ueber die Asse, unter Stoerfeuer
// a4m6 Der letzte Tag     vier Fassungen nach dem Ende: haelt, Waffenstillstand, Durchbruch, abgeloest
import { registerMissionJudge, endingFor } from '../campaign.js';
import { figureFallen, registerGoalLines } from '../missions/goals.js';
import { mineLeft } from '../phases/mine.js';
import { bridgeCellDone } from '../bridge.js';

export const ENDING_SCENARIOS = {
  haelt: 'akt4-m6-haelt',
  waffenstillstand: 'akt4-m6-waffenstillstand',
  durchbruch: 'akt4-m6-durchbruch',
  abgeloest: 'akt4-m6-abgeloest',
};

/** Szenario je Mission: fester Name oder { base, flags: { flag: Szenario } } (erste passende Flag gewinnt) */
export const AKT4_SCENARIOS = {
  a4m1: 'akt4-m1',
  a4m2: 'akt4-m2',
  a4m3: { base: 'akt4-m3', flags: { mine_geflutet: 'akt4-m3-geflutet', mine_gewarnt: 'akt4-m3-leer' } },
  a4m4: {
    base: 'akt4-m4',
    flags: {
      verweigerung_mitgegangen: 'akt4-m4-brandt', verweigerung_harms: 'akt4-m4-harms',
      verweigerung_gemeldet: 'akt4-m4-gemeldet', verweigerung_aufgehoben: 'akt4-m4-halten',
    },
  },
  // Ohne Flag (alter Spielstand) waehlt scenarioForMission das Ende aus Ansehen und Vertrauen (ending: true)
  a4m6: { base: ENDING_SCENARIOS.abgeloest, ending: true, flags: Object.fromEntries(Object.entries(ENDING_SCENARIOS).map(([k, id]) => ['ende_' + k, id])) },
  a4m5: 'akt4-m5',
};

/** Grenzen in Stellungsrunden */
export const LIMITS = { a4m1: 6, a4m2: 5, a4m3: 7, a4m4: 5, a4m5: 6, a4m6: 2, durchbruch: 4, abgeloest: 3 };

export const HARMS_NAME = 'Otto Harms';
/** Wer Harms' Gruppe fuehrt, wenn er gefallen ist */
export const HARMS_SUCCESSOR = { name: 'Maren Ubben', home: 'Kelling' };
/** Wo der Kasten liegen bleibt, wenn er in a4m2 nicht durchkommt (Niemandsland an der Strasse) */
export const WRECK = { x: 29, y: 20 };
/** Raudas: Linien (Spalten) wie in tools/maps/akt4.mjs */
export const RAUDAS_LINES = { first: [33, 34], second: [39, 40], damm: 47, town: { x0: 52, x1: 58, y0: 9, y1: 30 } };
/** So viele Felder des Bahndamms (Graben x 47, y 12 bis 28) muessen genommen sein */
export const DAMM_CELLS = 3;
/** Felder der Bruecke am Faehrhaus (Wasser auf Hoehe des Gleises) */
export const BRIDGE_CELLS = [16, 17, 18, 19, 20].map((x) => ({ x, y: 20 }));

// ------------------------------------------------------------------ Hilfen (rein)

const positionRounds = (rounds) => rounds.filter((r) => r.kind === 'position').length;
const ms = (side) => (side === 'a' ? 'own' : 'enemy');
const foeOf = (side) => (side === 'a' ? 'b' : 'a');
const alive = (state, side) => (state?.groups ?? []).filter((g) => g.side === side && g.status !== 'lost');
const plural = (n, one, many) => `${n === 1 ? 'ein' : n} ${n === 1 ? one : many}`;

/** Grabenfelder in diesen Spalten, die jetzt der Seite gehoeren (aus den Zellen des Zustands) */
export function heldIn(state, side, xs, { y0 = 0, y1 = 999 } = {}) {
  let n = 0;
  for (const k of Object.keys(state?.cells ?? {})) {
    const [x, y] = k.split(',').map(Number);
    if (!xs.includes(x) || y < y0 || y > y1) continue;
    if (state.cells[k]?.trench?.side === ms(side)) n++;
  }
  return n;
}

/** Eigene Grabenfelder in diesen Spalten, die der Gegner genommen hat */
export function lostIn(state, side, xs) {
  let n = 0;
  for (const k of Object.keys(state?.cells ?? {})) {
    const x = Number(k.split(',')[0]);
    const t = state.cells[k]?.trench;
    if (xs.includes(x) && t?.side === ms(foeOf(side)) && t.captured) n++;
  }
  return n;
}

function waitingWounded(state, side) {
  let n = 0;
  for (const sec of Object.values(state?.sides?.[side]?.supply?.sections ?? {})) {
    for (const v of Object.values(sec?.wounded ?? {})) n += Number(v) || 0;
  }
  return n;
}

/** Flags, die jede Mission in Akt 4 mitgibt: Harms gefallen */
function commonFlags(state, rounds) {
  const had = (state?.groups ?? []).some((g) => g.leader?.name === HARMS_NAME);
  return had && figureFallen(state, rounds, HARMS_NAME) ? ['harms_gefallen'] : [];
}

// ------------------------------------------------------------------ Vorbereitung

/**
 * Vor dem Einsatz (nach prepareAkt3): Harms fehlt, wenn er gefallen ist; der Kasten liegt als Wrack im
 * Niemandsland vor Raudas, wenn er in a4m2 liegen blieb; ist er durchgekommen, faehrt er am letzten Tag wieder.
 */
export function prepareAkt4(mission, state, campaign, side = 'a') {
  const s = structuredClone(state);
  const flags = campaign?.flags ?? [];
  const st = s.sides[side];
  if (!st) return s;
  if (flags.includes('harms_gefallen')) {
    const g = s.groups.find((x) => x.side === side && x.leader?.name === HARMS_NAME);
    if (g) g.leader = { ...HARMS_SUCCESSOR };
    delete st.harms;
  }
  if (s.map?.id === 'raudas' && mission !== 'a4m1' && mission !== 'a4m2' && flags.includes('kasten_liegen')) {
    const k = WRECK.x + ',' + WRECK.y;
    s.cells[k] = { ...(s.cells[k] ?? {}), wreck: { by: side, since: 'a4m2', label: 'K1' } };
  }
  if (mission === 'a4m6' && flags.includes('kasten_durch')) {
    const t = s.groups.filter((g) => g.side === side && g.type === 'tank').sort((p, q) => (p.id < q.id ? -1 : 1))[0];
    if (t) t.callsign = 'K1';
  }
  return s;
}

// ------------------------------------------------------------------ Missionsziele

/** a4m1: die geraeumte vordere Linie besetzen (mindestens vier Felder), acht fuer den Stab */
export function judgeA4m1({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const held = heldIn(state, side, RAUDAS_LINES.first);
  const n = positionRounds(rounds);
  const flags = commonFlags(state, rounds);
  if (held >= 10 && n >= 3) return { outcome: 'sieg', orderMet: true, why: `${held} Felder von Lasks alter Linie besetzt`, flags };
  if (n >= LIMITS.a4m1 || final) {
    if (held >= 4) return { outcome: 'sieg', orderMet: held >= 8, why: held >= 8 ? `${held} Felder von Lasks alter Linie besetzt` : `Nur ${held} Felder der alten Linie besetzt, der Stab wollte die ganze`, flags };
    return { outcome: 'niederlage', orderMet: false, why: held ? `Nur ${plural(held, 'Feld', 'Felder')} der alten Linie gehalten` : 'Lasks alte Linie ist leer geblieben', flags };
  }
  return null;
}

/** Ist der Wagen an der zweiten Linie (hoechstens ein Feld vor ihrem Graben an der Strasse)? */
export function tankThrough(g) {
  return !!g && g.status !== 'lost' && g.pos.x >= RAUDAS_LINES.second[0] - 1 && g.pos.y >= 16 && g.pos.y <= 24;
}

/** a4m2: der Kasten erreicht die zweite Linie */
export function judgeA4m2({ state, rounds, side, final }) {
  const flags = commonFlags(state, rounds);
  const tank = (state?.groups ?? []).filter((g) => g.side === side && g.type === 'tank').sort((p, q) => (p.id < q.id ? -1 : 1))[0];
  if (!tank || tank.status === 'lost') return { outcome: 'niederlage', orderMet: false, why: 'Der Kasten ist ausgefallen. Er bleibt im Niemandsland liegen.', flags: [...flags, 'kasten_liegen'] };
  if (state?.turnKind === 'battle' && !final) return null;
  const n = positionRounds(rounds);
  if (tankThrough(tank)) {
    const whole = tank.strength * 2 >= (tank.size ?? tank.strength);
    return { outcome: 'sieg', orderMet: whole, why: whole ? 'Der Kasten steht an der zweiten Linie' : 'Der Kasten ist an der zweiten Linie, die Besatzung halb verloren', flags: [...flags, 'kasten_durch'] };
  }
  if (n >= LIMITS.a4m2 || final) return { outcome: 'niederlage', orderMet: false, why: tank.stuck ? 'Der Kasten steckt fest. Er bleibt im Niemandsland liegen.' : 'Der Kasten ist nicht durchgekommen', flags: [...flags, 'kasten_liegen'] };
  return null;
}

/** a4m3: die Mine geht hoch (oder, geflutet: den Hang halten) */
export function judgeA4m3({ state, rounds, side, final }) {
  const id = state?.scenario?.id ?? 'akt4-m3';
  const flags = commonFlags(state, rounds);
  const n = positionRounds(rounds);
  if (id === 'akt4-m3-geflutet') {
    if (state?.turnKind === 'battle' && !final) return null;
    const lost = lostIn(state, side, [29, 30]);
    if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder am Hang verloren`, flags };
    if (n >= 4 || final) return { outcome: n >= 4 ? 'sieg' : 'niederlage', orderMet: !lost && n >= 4, why: n < 4 ? 'Vor dem Ende gemeldet' : lost ? 'Hang gehalten, mit Verlust an Graben' : 'Hang gehalten. Unter dem Hügel steht Wasser.', flags };
    return null;
  }
  const m = state?.sides?.[side]?.mine;
  if (m?.status === 'blown') {
    return { outcome: 'sieg', orderMet: true, why: id === 'akt4-m3-leer' ? 'Die Mine ist hochgegangen. Auf dem Hügel war fast niemand mehr.' : 'Die Mine ist hochgegangen. Hügel 214 ist ein Trichter.', flags };
  }
  if (m?.status === 'lost') return { outcome: 'niederlage', orderMet: false, why: m.lostBy === 'camouflet' ? 'Lasks Quetschladung hat die Galerie verschüttet' : 'Lasks Mineure sind in die Galerie durchgebrochen', flags };
  if (state?.turnKind === 'battle' && !final) return null;
  if (n >= LIMITS.a4m3 || final) return { outcome: 'niederlage', orderMet: false, why: 'Vor der Zündung gemeldet', flags };
  return null;
}

/** a4m4: Bahndamm nehmen (halten: die neue Linie halten) */
export function judgeA4m4({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const id = state?.scenario?.id ?? 'akt4-m4';
  const flags = commonFlags(state, rounds);
  const n = positionRounds(rounds);
  const refused = state?.sides?.[side]?.refusals | 0;
  if (refused) flags.push('verweigerung_damm');
  if (id === 'akt4-m4-halten') {
    const lost = lostIn(state, side, RAUDAS_LINES.second);
    if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder der neuen Linie verloren`, flags };
    if (n >= 4 || final) return { outcome: n >= 4 ? 'sieg' : 'niederlage', orderMet: n >= 4 && !lost, why: n < 4 ? 'Vor dem Ende gemeldet' : lost ? 'Linie gehalten, mit Verlust an Graben' : 'Linie gehalten. Den Bahndamm hat niemand gestürmt.', flags };
    return null;
  }
  const damm = heldIn(state, side, [RAUDAS_LINES.damm], { y0: 12, y1: 28 });
  if (damm >= DAMM_CELLS) {
    const fast = n <= 3;
    return { outcome: 'sieg', orderMet: fast, why: fast ? `Bahndamm genommen (${damm} Felder)` : `Bahndamm genommen, aber spät (${damm} Felder)`, flags };
  }
  if (n >= LIMITS.a4m4 || final) {
    return { outcome: 'niederlage', orderMet: false, why: refused ? `Bahndamm nicht genommen. ${refused === 1 ? 'Eine Gruppe hat' : refused + ' Gruppen haben'} den Sturm verweigert.` : 'Bahndamm nicht genommen', flags };
  }
  return null;
}

/** a4m5: die Bruecke steht mit Gleis */
export function judgeA4m5({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const flags = commonFlags(state, rounds);
  const n = positionRounds(rounds);
  // Die Bruecke zaehlt auf jeder Zeile, die gerade ueber die Asse fuehrt (nicht nur auf der des Gleises)
  const h = state?.map?.height ?? 40;
  let done = 0;
  for (let y = 0; y < h; y++) done = Math.max(done, BRIDGE_CELLS.filter((p) => bridgeCellDone(state, { x: p.x, y })).length);
  const east = alive(state, side).filter((g) => g.pos.x > 20).length;
  if (!east) return { outcome: 'niederlage', orderMet: false, why: 'Der Abschnitt östlich der Asse ist verloren', flags };
  if (done === BRIDGE_CELLS.length) {
    const fast = n <= 4;
    return { outcome: 'sieg', orderMet: fast, why: fast ? 'Die Brücke steht, die erste Lore rollt über die Asse' : 'Die Brücke steht, spät', flags };
  }
  if (n >= LIMITS.a4m5 || final) return { outcome: 'niederlage', orderMet: false, why: `Die Brücke ist nicht fertig (${done} von ${BRIDGE_CELLS.length} Feldern mit Gleis)`, flags };
  return null;
}

/** Felder in Raudas, auf denen eigene Gruppen stehen */
function inTown(state, side) {
  const T = RAUDAS_LINES.town;
  return alive(state, side).filter((g) => g.pos.x >= T.x0 && g.pos.x <= T.x1 && g.pos.y >= T.y0 && g.pos.y <= T.y1).length;
}

/** a4m6: je nach Ende */
export function judgeA4m6({ state, rounds, side, final }) {
  if (state?.turnKind === 'battle' && !final) return null;
  const id = state?.scenario?.id ?? ENDING_SCENARIOS.abgeloest;
  const flags = commonFlags(state, rounds);
  const n = positionRounds(rounds);
  const lost = lostIn(state, side, RAUDAS_LINES.second);
  if (id === ENDING_SCENARIOS.durchbruch) {
    // Der Stab will Raudas; der Bahndamm ist das, was am Abend auf der Karte steht
    const town = inTown(state, side);
    const damm = heldIn(state, side, [RAUDAS_LINES.damm], { y0: 12, y1: 28 });
    if (town >= 2) return { outcome: 'sieg', orderMet: true, why: `In Raudas, ${town} Gruppen zwischen den Häusern`, flags };
    if (n >= LIMITS.durchbruch || final) {
      if (damm >= DAMM_CELLS) return { outcome: 'sieg', orderMet: false, why: 'Bahndamm genommen. Raudas nicht.', flags };
      return { outcome: 'niederlage', orderMet: false, why: 'Der Durchbruch ist am Bahndamm liegen geblieben', flags };
    }
    return null;
  }
  if (id === ENDING_SCENARIOS.waffenstillstand) {
    const t = state?.sides?.[side]?.truce ?? null;
    if (t?.brokenBy === side) return { outcome: 'niederlage', orderMet: false, why: 'Nach zwölf Uhr ist auf unserer Seite geschossen worden', flags: [...flags, 'waffenstillstand_gebrochen'] };
    if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder verloren, wenige Stunden vor zwölf`, flags };
    if (n >= LIMITS.a4m6 || final) return { outcome: n >= LIMITS.a4m6 ? 'sieg' : 'niederlage', orderMet: n >= LIMITS.a4m6 && !lost, why: n < LIMITS.a4m6 ? 'Vor zwölf Uhr gemeldet' : 'Zwölf Uhr. Es ist still.', flags };
    return null;
  }
  if (id === ENDING_SCENARIOS.abgeloest) {
    if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder vor der Übergabe verloren`, flags };
    if (state?.day?.handover) {
      const left = waitingWounded(state, side);
      return { outcome: 'sieg', orderMet: !left, why: left ? `Abschnitt übergeben, ${left} Verwundete warten noch auf die Lore` : 'Abschnitt übergeben, niemand bleibt liegen', flags };
    }
    if (n >= LIMITS.abgeloest || final) return { outcome: 'niederlage', orderMet: false, why: 'Vor der Übergabe gemeldet', flags };
    return null;
  }
  // Der Abschnitt haelt
  if (lost >= 3) return { outcome: 'niederlage', orderMet: false, why: `${lost} Felder in Lasks letztem Angriff verloren`, flags };
  if (n >= LIMITS.a4m6 || final) return { outcome: n >= LIMITS.a4m6 ? 'sieg' : 'niederlage', orderMet: n >= LIMITS.a4m6 && !lost, why: n < LIMITS.a4m6 ? 'Vor dem Morgen gemeldet' : lost ? 'Der Abschnitt hält, knapp' : 'Der Abschnitt hält', flags };
  return null;
}

export const AKT4_JUDGES = { a4m1: judgeA4m1, a4m2: judgeA4m2, a4m3: judgeA4m3, a4m4: judgeA4m4, a4m5: judgeA4m5, a4m6: judgeA4m6 };
for (const [m, fn] of Object.entries(AKT4_JUDGES)) registerMissionJudge(m, (ctx) => fn(ctx));

/** Szenario des letzten Tages ohne Flag: aus Ansehen und Vertrauen (wie ende.wahl) */
export function endingScenario(campaign) {
  return ENDING_SCENARIOS[endingFor(campaign?.ansehen ?? 50, campaign?.vertrauen ?? 50)];
}

// ------------------------------------------------------------------ Auftragszettel (dieselben Pruefungen wie oben)

const rest = (limit, n) => {
  const left = Math.max(0, limit - n);
  return left ? `noch ${left} ${left === 1 ? 'Stellungsrunde' : 'Stellungsrunden'}` : 'Frist erreicht';
};

registerGoalLines('a4m1', ({ state, rounds, side }) => {
  const held = heldIn(state, side, RAUDAS_LINES.first), n = positionRounds(rounds);
  return [
    { text: `Lasks alte Linie besetzen: ${held} Felder (4 nötig, 8 für den Stab)`, done: held >= 8 },
    { text: `Frist: ${rest(LIMITS.a4m1, n)}`, done: held >= 8, warn: held < 4 && LIMITS.a4m1 - n <= 1 },
  ];
});
registerGoalLines('a4m2', ({ state, rounds, side }) => {
  const tank = (state?.groups ?? []).filter((g) => g.side === side && g.type === 'tank').sort((p, q) => (p.id < q.id ? -1 : 1))[0];
  const through = tankThrough(tank), n = positionRounds(rounds);
  return [
    { text: !tank || tank.status === 'lost' ? 'Der Kasten ist ausgefallen' : tank.stuck ? 'Der Kasten steckt fest: Pioniere heran' : 'Den Kasten an die zweite Linie bringen', done: through, warn: !tank || tank.status === 'lost' || !!tank.stuck },
    { text: `Frist: ${rest(LIMITS.a4m2, n)}`, done: through },
  ];
});
registerGoalLines('a4m3', ({ state, rounds, side }) => {
  const n = positionRounds(rounds);
  if (state?.scenario?.id === 'akt4-m3-geflutet') {
    const lost = lostIn(state, side, [29, 30]);
    return [
      { text: lost ? `${lost} Felder am Hang verloren (3 sind zu viel)` : 'Den Hang halten', done: !lost && n >= 4, warn: !!lost },
      { text: `Halten: ${rest(4, n)}`, done: n >= 4 && lost < 3 },
    ];
  }
  const m = state?.sides?.[side]?.mine;
  const left = m && m.status !== 'blown' && m.status !== 'lost' ? mineLeft(m) : 0;
  return [
    { text: m?.status === 'blown' ? 'Die Mine ist hochgegangen' : m?.status === 'lost' ? 'Die Galerie ist verloren' : `Galerie halten bis zur Zündung (in ${left})`, done: m?.status === 'blown', warn: m?.status === 'lost' },
  ];
});
registerGoalLines('a4m4', ({ state, rounds, side }) => {
  const n = positionRounds(rounds);
  if (state?.scenario?.id === 'akt4-m4-halten') {
    const lost = lostIn(state, side, RAUDAS_LINES.second);
    return [
      { text: lost ? `${lost} Felder der neuen Linie verloren (3 sind zu viel)` : 'Die neue Linie halten', done: !lost && n >= 4, warn: !!lost },
      { text: `Halten: ${rest(4, n)}`, done: n >= 4 && lost < 3 },
    ];
  }
  const damm = heldIn(state, side, [RAUDAS_LINES.damm], { y0: 12, y1: 28 });
  return [
    { text: `Bahndamm nehmen: ${damm} von ${DAMM_CELLS} Feldern`, done: damm >= DAMM_CELLS },
    { text: `Frist: ${rest(LIMITS.a4m4, n)}`, done: damm >= DAMM_CELLS, warn: damm < DAMM_CELLS && LIMITS.a4m4 - n <= 1 },
  ];
});
registerGoalLines('a4m5', ({ state, rounds }) => {
  const n = positionRounds(rounds);
  const h = state?.map?.height ?? 40;
  let done = 0;
  for (let y = 0; y < h; y++) done = Math.max(done, BRIDGE_CELLS.filter((p) => bridgeCellDone(state, { x: p.x, y })).length);
  return [
    { text: `Brücke mit Gleis über die Asse: ${done} von ${BRIDGE_CELLS.length} Feldern (Werkzeug Brücke, Taste 8)`, done: done === BRIDGE_CELLS.length },
    { text: `Frist: ${rest(LIMITS.a4m5, n)}`, done: done === BRIDGE_CELLS.length, warn: done < BRIDGE_CELLS.length && LIMITS.a4m5 - n <= 1 },
  ];
});
registerGoalLines('a4m6', ({ state, rounds, side }) => {
  const id = state?.scenario?.id ?? '', n = positionRounds(rounds);
  if (id === ENDING_SCENARIOS.durchbruch) {
    return [{ text: `Nach Raudas hinein (2 Gruppen zwischen den Häusern): ${inTown(state, side)}`, done: inTown(state, side) >= 2 }, { text: `Frist: ${rest(LIMITS.durchbruch, n)}`, done: false }];
  }
  const lost = lostIn(state, side, RAUDAS_LINES.second);
  const line = { text: lost ? `${lost} Felder verloren (3 sind zu viel)` : 'Die Linie halten', done: false, warn: !!lost };
  if (id === ENDING_SCENARIOS.waffenstillstand) return [line, { text: 'Nach zwölf Uhr kein Schuss mehr', done: false, warn: state?.sides?.[side]?.truce?.brokenBy === side }];
  if (id === ENDING_SCENARIOS.abgeloest) return [line, { text: state?.day?.handover ? 'Der Abschnitt ist übergeben' : 'Bis zur Übergabe am Mittag halten', done: !!state?.day?.handover }];
  return [line, { text: `Halten: ${rest(LIMITS.a4m6, n)}`, done: n >= LIMITS.a4m6 && lost < 3 }];
});
