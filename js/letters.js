// Generierte Feldpost (Plan 2.5): Briefe der Soldaten nach Hause aus data/letters/templates.json, mit
// Platzhaltern und einem echten Ereignis aus dem Protokoll der letzten Mission, in drei Tonlagen.
// Rein: kein DOM, kein Date, kein Math.random. Zufall nur ueber createRng aus Seed und Mission;
// dieselbe Mission ergibt dieselben Briefe. Vorschlag aus data/texts/README.md "Feldpost erzeugen".
//
//   generateFieldPost({ templates, side, faction, groups, state, rounds, casualties, trust, weather, night,
//                       map, seed, mission, count }) -> [brief, ...]
//
// Jeder Brief traegt Wetter und Tageszeit der Runde, in der er geschrieben wurde: die Papierebene malt
// daraus Wasserraender, Lehmfinger, Wachstropfen (Ueberraschung des Pakets P15).
import { createRng } from './rng.js';
import { matches, fill, numberWord, placeholdersIn, hashText } from './narrative/texts.js';
import { makeSoldierName, blockLeaders } from './narrative/casualties.js';
import { placePhrase } from './narrative/places.js';

export const TONES = ['zuversichtlich', 'erschoepft', 'verbittert'];

/** Tonlage aus Moral der Gruppe und Vertrauen der Truppe (README: Feldpost erzeugen, Schritt 1) */
export function toneFor(morale, trust) {
  if (morale < 35 || trust < 30) return 'verbittert';
  if (morale >= 60 && trust >= 50) return 'zuversichtlich';
  return 'erschoepft';
}

/** Wetter des Spielzustands (state.weather.kind) im Vokabular der Texte */
const WEATHER_WORD = { clear: 'trocken', overcast: 'trocken', dry: 'trocken', rain: 'regen', storm: 'regen', mud: 'schlamm', fog: 'nebel', frost: 'frost', snow: 'schnee' };
export function weatherWord(kind) {
  if (['trocken', 'regen', 'schlamm', 'nebel', 'frost', 'schnee'].includes(kind)) return kind;
  return WEATHER_WORD[kind] ?? 'trocken';
}

const WEATHER_NOUN = { trocken: 'die Trockenheit', regen: 'der Regen', schlamm: 'der Schlamm', nebel: 'der Nebel', frost: 'der Frost', schnee: 'der Schnee' };
const SEASON = { 1: 'der Sommer', 2: 'der Herbst', 3: 'der Winter', 4: 'das Frühjahr' };
export function seasonOf(act) {
  return SEASON[act] ?? 'der Herbst';
}

/** Flecken auf dem Papier: Wetter und Tageszeit beim Schreiben */
export function stainsFor(weather, night) {
  const out = [];
  if (weather === 'regen') out.push('wasser');
  else if (weather === 'schlamm') out.push('lehm');
  else if (weather === 'nebel') out.push('feucht');
  else if (weather === 'frost' || weather === 'schnee') out.push('frost');
  else out.push('staub');
  if (night) out.push('wachs');
  return out;
}

// ---------- Ereignisse -> Kategorien ----------

/** Wichtigkeit: wer etwas Schweres erlebt hat, schreibt davon, nicht vom Essen */
export const CATEGORY_RANK = [
  'verluste', 'verwundet', 'sturm_abgewehrt', 'sturm_eigen', 'gefangene', 'artillerie', 'verwundete_geborgen',
  'stollen', 'nacht', 'mangel', 'abloesung', 'warme_mahlzeit', 'versorgung', 'post', 'graben_gebaut',
  'schlamm', 'regen', 'ruhig',
];

const EVENT_CATEGORY = new Map();

/**
 * Ereignisart des Protokolls einer Kategorie zuordnen. Spaetere Pakete (P06 Sturm, P09 Artillerie,
 * P04 Graben, P23 Stollen) melden ihre Ereignisse hier an. fn darf auch eine Funktion (event) -> Kategorie|null sein.
 */
export function registerLetterCategory(type, category) {
  EVENT_CATEGORY.set(type, category);
}

for (const [t, c] of Object.entries({
  assault_repelled: 'sturm_abgewehrt', assault_held: 'sturm_abgewehrt',
  assault: 'sturm_eigen', assault_success: 'sturm_eigen', trench_taken: 'sturm_eigen',
  prisoners: 'gefangene',
  artillery: 'artillerie', barrage: 'artillerie', shell: 'artillerie', shelled: 'artillerie',
  wounded_rescued: 'verwundete_geborgen',
  mine: 'stollen', tunnel: 'stollen', listening: 'stollen',
  flare: 'nacht', raid: 'nacht',
  depot_empty: 'mangel', iron_ration: 'mangel', hunger: 'mangel', ammo_short: 'mangel', supply_blocked: 'mangel',
  relief: 'abloesung', relief_late: 'abloesung',
  warm_meal: 'warme_mahlzeit',
  supply_delivered: 'versorgung',
  mail: 'post',
  dig: 'graben_gebaut', trench_built: 'graben_gebaut', trench_dug: 'graben_gebaut', works: 'graben_gebaut',
})) registerLetterCategory(t, c);

function categoryOf(e) {
  const c = EVENT_CATEGORY.get(e.type);
  return typeof c === 'function' ? c(e) : c ?? null;
}

/**
 * Was eine Gruppe in der Mission erlebt hat: Kategorie -> { event?, count, fallen?, wounded?, night }
 * Ereignisse ohne Gruppe (Abschnitt, Depot) gelten fuer alle Gruppen der Seite.
 */
export function experiencesOf(groupId, { rounds = [], side, casualties = { fallen: [], wounded: [] }, weather }) {
  const out = new Map();
  const put = (cat, data) => {
    const cur = out.get(cat);
    if (!cur) out.set(cat, { count: data.count ?? 1, ...data });
    else cur.count += data.count ?? 1;
  };
  const fallen = casualties.fallen.filter((c) => c.group === groupId);
  if (fallen.length) put('verluste', { count: fallen.length, fallen: fallen[fallen.length - 1], at: fallen[fallen.length - 1].at });
  const wounded = casualties.wounded.filter((c) => c.group === groupId);
  if (wounded.length) put('verwundet', { count: wounded.length, wounded: wounded[0], at: wounded[0].at });
  for (const r of [...rounds].sort((a, b) => a.turn - b.turn)) {
    for (const e of r.log ?? []) {
      if (e.side !== side) continue;
      if (e.group && e.group !== groupId) continue;
      const cat = categoryOf(e);
      if (!cat) continue;
      put(cat, { count: Number(e.count ?? e.wounded ?? 1) || 1, event: e, turn: r.turn, at: e.at ?? null, night: !!r.night });
    }
    // Feuer bei Nacht auf diese Gruppe: davon schreibt man
    if (r.night && (r.log ?? []).some((e) => e.side === side && e.group === groupId && (e.type === 'losses' || e.type === 'suppressed'))) {
      const e = r.log.find((x) => x.side === side && x.group === groupId && (x.type === 'losses' || x.type === 'suppressed'));
      put('nacht', { event: e, turn: r.turn, at: e.at ?? null, night: true });
    }
  }
  if (weather === 'regen') put('regen', {});
  if (weather === 'schlamm') put('schlamm', {});
  if (!out.size) put('ruhig', {});
  return out;
}

// ---------- Auswahl ----------

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];

function sentenceFits(entry, tone, exp) {
  if (entry.ton && entry.ton !== tone) return false;
  const ph = placeholdersIn(entry.text);
  if (ph.includes('anzahl') && !(exp.count >= 2)) return false;
  if (ph.includes('gefallener') && !exp.fallen) return false;
  if (ph.includes('ort') && !exp.at) return false;
  return true;
}

function surname(n) {
  const i = String(n ?? '').lastIndexOf(' ');
  return i < 0 ? String(n ?? '') : n.slice(i + 1);
}

/**
 * Feldpost einer Mission.
 * opts: {
 *   templates: Eintraege aus templates.json (Liste),
 *   side, faction, groups: { id: { label, leader, home, type } } (z. B. groupInfoFrom),
 *   state: Endzustand (Moral der Gruppen, Tag), rounds: Archiv-Runden [{ turn, night, log }],
 *   casualties: Ergebnis von rollCasualties, trust, reputation, flags, werte,
 *   weather: Wetterwort oder state.weather.kind, night, act, map, sector, seed, mission, count (Standard 3)
 * }
 */
export function generateFieldPost(opts) {
  const {
    templates = [], side = 'a', faction = 'kaldern', groups = {}, state = null, rounds = [],
    casualties = { fallen: [], wounded: [] }, trust = 50, reputation = 50, flags = [], werte = {},
    act = 1, map = null, sector = 'Asse-Nord', seed = 0, mission = '', count = 3,
  } = opts;
  const weather = weatherWord(opts.weather ?? state?.weather?.kind);
  const night = opts.night ?? state?.night ?? false;
  const rng = createRng(hashText(`feldpost|${seed}|${mission}|${side}`));
  // Vergeben: Namen dieser Mission, frueher Gefallene (opts.used, Buch des Abschnitts), Gruppenfuehrer
  const used = new Set([...(opts.used ?? []), ...casualties.fallen.map((c) => c.name), ...casualties.wounded.map((c) => c.name)]);
  blockLeaders(used, groups);

  const anreden = templates.filter((e) => e.art === 'anrede' && (!e.fraktion || e.fraktion === faction)).sort(byId);
  const sentences = templates.filter((e) => e.art === 'ereignis').sort(byId);
  const letters = templates.filter((e) => e.art === 'feldpost' && (!e.fraktion || e.fraktion === faction)).sort(byId);
  const tageszeit = night ? 'nacht' : 'tag';
  const ctx = { wetter: weather, tageszeit, flags, fraktion: faction, vertrauen: trust, ansehen: reputation, werte };

  // Schreibende Gruppen: lebende eigene Gruppen, gemischt; bei mehr Briefen als Gruppen reihum
  const alive = Object.keys(groups).sort().filter((id) => {
    const g = state?.groups?.find((x) => x.id === id);
    return !g || g.status !== 'lost';
  });
  if (!alive.length) return [];
  const order = [...alive];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  const usedTemplates = new Set();
  const usedAnreden = new Set();
  const usedSentences = new Set();
  const usedCats = new Map();
  const out = [];
  for (let n = 0; n < count; n++) {
    const gid = order[n % order.length];
    const info = groups[gid] ?? {};
    const g = state?.groups?.find((x) => x.id === gid);
    const tone = toneFor(g?.morale ?? 60, trust);
    const exps = experiencesOf(gid, { rounds, side, casualties, weather });

    // Kategorie: die wichtigste, die in diesem Stapel noch nicht so oft vorkam
    const cats = CATEGORY_RANK.filter((c) => exps.has(c));
    cats.sort((a, b) => (usedCats.get(a) ?? 0) - (usedCats.get(b) ?? 0) || CATEGORY_RANK.indexOf(a) - CATEGORY_RANK.indexOf(b));
    let cat = null;
    let sentence = null;
    for (const c of [...cats, 'ruhig']) {
      const exp = exps.get(c) ?? { count: 1 };
      const pool = sentences.filter((s) => s.kategorie === c && sentenceFits(s, tone, exp));
      const fresh = pool.filter((s) => !usedSentences.has(s.id));
      const pickFrom = fresh.length ? fresh : pool;
      if (!pickFrom.length) continue;
      // Saetze mit passender Tonlage zuerst
      const toned = pickFrom.filter((s) => s.ton === tone);
      sentence = pickOne(rng, toned.length && rng() < 0.7 ? toned : pickFrom);
      cat = c;
      break;
    }
    const exp = exps.get(cat) ?? { count: 1 };
    usedCats.set(cat, (usedCats.get(cat) ?? 0) + 1);
    usedSentences.add(sentence.id);

    // Vorlage der Tonlage, deren wann gilt; nicht zweimal dieselbe im Stapel
    const fitting = letters.filter((t) => t.ton === tone && matches(t.wann, ctx));
    const special = fitting.filter((t) => t.wann && !usedTemplates.has(t.id));
    const fresh = fitting.filter((t) => !usedTemplates.has(t.id));
    const template = special.length && rng() < 0.6 ? pickOne(rng, special) : pickOne(rng, fresh.length ? fresh : fitting);
    usedTemplates.add(template.id);

    const writer = makeSoldierName(rng, faction, used);
    const comrade = exp.wounded && cat === 'verwundet' ? { name: exp.wounded.name } : makeSoldierName(rng, faction, used);
    const freshAnreden = anreden.filter((a) => !usedAnreden.has(a.id));
    const anrede = pickOne(rng, freshAnreden.length ? freshAnreden : anreden);
    usedAnreden.add(anrede.id);
    const place = placePhrase(map, exp.at);
    // Die Pruefstelle schwaerzt militaerische Orte, bei verbitterten Briefen jeden Ort
    const censorPlace = place.sensitive || (tone === 'verbittert' && !!place.name);
    const values = {
      ort: censorPlace ? `[[${place.text}]]` : place.text,
      anzahl: numberWord(exp.count ?? 1),
      gefallener: exp.fallen?.name,
      kamerad: comrade.name,
      kamerad_nachname: surname(comrade.name),
      gruppenfuehrer: info.leader ?? '',
      gruppenfuehrer_nachname: surname(info.leader),
      gruppe: info.label ?? '',
      heimatort: writer.home,
      wetter: WEATHER_NOUN[weather],
      jahreszeit: seasonOf(act),
      tag: String(state?.clock?.day ?? 1),
      abschnitt: sector,
    };
    const event = fill(sentence.text, values);
    const text = fill(template.text, {
      ...values,
      anrede: anrede.text,
      empfaenger: anrede.empfaenger,
      absender: writer.name.split(' ')[0],
      ereignis: event,
    });
    out.push({
      id: `feldpost-${mission || 'x'}-${n + 1}`,
      tone,
      group: gid,
      groupLabel: info.label ?? gid,
      writer,
      recipient: anrede.empfaenger,
      templateId: template.id,
      sentenceId: sentence.id,
      category: cat,
      event: exp.event ? { type: exp.event.type, turn: exp.turn ?? null, reason: exp.event.reason ?? '' } : null,
      text,
      weather,
      night,
      censored: text.includes('[['),
      stains: stainsFor(weather, night),
      day: state?.clock?.day ?? null,
    });
  }
  return out;
}
