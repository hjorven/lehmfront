// Schlusssequenz des Feldzugs (Paket P26, data/texts/README.md "Enden"). Rein: kein DOM, kein Date, kein Math.random.
// Baut die Schritte fuer den Tisch der Erzaehlung (js/ui/narrative/reader.js playSteps):
//   1. alle Seiten des Endes (art "ende", nach seite; mehrere Eintraege je Seite sind ein Slot ende.<key>.<seite>),
//      Blattart nach "blatt": telegramm, tagebuch, zeitung, brief, gefallenenliste (die ganze Liste der Kampagne)
//   2. das Nachwort (Slots ende.nachwort.* und Eintraege art "nachwort" ohne Slot), ein Absatz je Figur
//   3. Brief 24 als letzte Seite (nur bei den vier regulaeren Enden, er hat ein wann auf ende_*)
// Die vorzeitigen Enden (vorzeitig_abgeloest, vorzeitig_meuterei) haben nur Seiten, kein Nachwort und keinen Brief.
import { matches, numberWord, hashText } from './texts.js';
import { fillSheet } from './interlude.js';
import * as S from './sheets.js';
import { NAMES } from '../config/names.js';

/** Ueberschrift des Tisches je Ende */
export const ENDING_TITLES = {
  haelt: 'Der Abschnitt hält',
  waffenstillstand: 'Waffenstillstand im Abschnitt',
  durchbruch: 'Durchbruch um jeden Preis',
  abgeloest: 'Abgelöst',
  vorzeitig_abgeloest: 'Abgelöst',
  vorzeitig_meuterei: 'Meuterei',
};

/** Telegrammtext in Zeilen: jeder Satz endet mit STOP */
export function telegramLines(text) {
  return String(text ?? '').split(/\s*STOP\s*/).map((s) => s.trim()).filter(Boolean).map((s) => s + ' STOP');
}

/**
 * Die letzte Person auf der Liste im Ende "abgeloest" (README: gefallen in der letzten Runde vor dem
 * Waffenstillstand). Name aus dem Kampagnen-Seed, nie eine Hauptfigur, nie ein Name, der schon auf der Liste steht.
 */
export function lastFallen(campaign) {
  const pool = NAMES.kaldern;
  const used = new Set((campaign?.book?.fallen ?? []).map((f) => f.name));
  const h = hashText('letzte-granate-' + (campaign?.seed ?? 1));
  for (let i = 0; i < pool.first.length * 4; i++) {
    const first = pool.first[(h + i) % pool.first.length];
    const last = (pool.soldierLast ?? pool.last)[(h + i * 7) % (pool.soldierLast ?? pool.last).length];
    const name = first + ' ' + last;
    if (used.has(name) || pool.reserved.includes(name)) continue;
    return { name, home: pool.homes[(h >>> 3) % pool.homes.length], groupLabel: '', turn: '', causeText: '13:50 Uhr, zehn Minuten vor dem Waffenstillstand' };
  }
  return { name: 'Unbekannt', home: '', groupLabel: '', turn: '', causeText: '13:50 Uhr' };
}

/** Kontext fuer die Bedingungen (wann) */
function ctxOf(campaign) {
  return { ansehen: campaign.ansehen, vertrauen: campaign.vertrauen, flags: campaign.flags ?? [], fraktion: campaign.faction };
}

/** Seiten eines Endes, Slots aufgeloest, nach seite sortiert */
export function endingPages(index, key, ctx) {
  const pages = new Map();
  for (const e of index.list) {
    if (e.art !== 'ende' || e.ende !== key) continue;
    const n = e.seite ?? 0;
    if (!pages.has(n)) pages.set(n, []);
    pages.get(n).push(e);
  }
  const out = [];
  for (const n of [...pages.keys()].sort((a, b) => a - b)) {
    const list = pages.get(n);
    const pick = list.find((e) => matches(e.wann, ctx)) ?? null;
    if (pick) out.push(pick);
  }
  return out;
}

/** Absaetze des Nachworts (Slots ende.nachwort.* in Dateireihenfolge, Eintraege ohne Slot nur wenn wann gilt) */
export function afterword(index, ctx) {
  const out = [];
  const done = new Set();
  for (const e of index.list) {
    if (e.art !== 'nachwort') continue;
    if (e.slot) {
      if (done.has(e.slot)) continue;
      done.add(e.slot);
      const pick = (index.slots.get(e.slot) ?? []).filter((x) => x.art === 'nachwort').find((x) => matches(x.wann, ctx));
      if (pick) out.push(pick);
    } else if (matches(e.wann, ctx)) out.push(e);
  }
  return out;
}

function pageStep(e, campaign, fallen, values) {
  const about = e.titel ?? '';
  switch (e.blatt) {
    case 'telegramm': {
      const sheet = { id: e.id, kind: 'telegram', heading: 'STABSTELEGRAMM', number: '', urgent: true, fields: [], lines: telegramLines(e.text), footer: [], typed: true };
      return { kind: 'order', id: e.id, sheet: fillSheet(sheet, values), entry: e.id, about };
    }
    case 'zeitung':
      return { kind: 'newspaper', id: e.id, sheet: fillSheet(S.newspaperSheet(e), values), entry: e.id, about };
    case 'brief':
      return { kind: 'letter', id: e.id, sheet: fillSheet(S.letterSheet(e, { title: e.titel }), values), entry: e.id, about };
    case 'gefallenenliste': {
      const sheet = S.casualtySheet({ id: e.id, mission: e.titel, missionTitle: e.titel, sector: 'Asse-Nord', day: null, fallen });
      sheet.title = e.titel ?? 'Gefallenenliste';
      sheet.note = fill(e.text, values);
      sheet.final = true;
      return { kind: 'casualties', id: e.id, sheet, entry: e.id, about, locked: true };
    }
    default:
      return { kind: 'diary', id: e.id, sheet: fillSheet(S.diarySheet(e, { title: '' }), values), entry: e.id, about };
  }
}

const fill = (text, values) => String(text ?? '').replace(/\{(\w+)\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));

/**
 * Schritte der Schlusssequenz. campaign: Kampagnenzustand (flags, book.fallen, seed, Werte), key: Ende
 * (haelt, waffenstillstand, durchbruch, abgeloest oder vorzeitig_*), values: Platzhalter (storyValues).
 */
export function endingSteps(index, campaign, key, values = {}) {
  const ctx = ctxOf(campaign);
  const fallen = (campaign?.book?.fallen ?? []).slice();
  const v = { ...values };
  if (key === 'abgeloest') {
    const last = lastFallen(campaign);
    fallen.push(last);
    v.gefallener = `${last.name} aus ${last.home}`;
  }
  v.anzahl = numberWord(fallen.length);
  const steps = endingPages(index, key, ctx).map((e) => pageStep(e, campaign, fallen, v));
  if (/^vorzeitig_/.test(key)) return steps;
  const words = afterword(index, ctx);
  if (words.length) {
    const body = words.map((e) => fill(e.text, v)).join('\n\n');
    steps.push({ kind: 'diary', id: 'ende.nachwort', sheet: { id: 'ende.nachwort', kind: 'diary', date: 'Nachwort', title: 'Was aus ihnen wurde', body, signature: '', sketch: 'huegel', seed: 'nachwort' }, entry: null, about: 'Nachwort' });
  }
  const brief = index.byId.get('brief.24');
  if (brief && matches(brief.wann, ctx)) steps.push({ kind: 'letter', id: brief.id, sheet: fillSheet(S.letterSheet(brief, { title: 'Brief 24' }), v), entry: brief.id, about: 'Brief 24' });
  return steps;
}
