// Uebersetzt Spieltexte (data/texts/README.md) in Blaetter der Papierebene (js/ui/paper/README.md).
// Rein: kein DOM. Jede Funktion liefert ein Blatt-Objekt { id, kind, ... }.
import { actRoman, actOf, numberWord } from './texts.js';

const SIGN = '−'; // echtes Minuszeichen in Folgen

/** "Ansehen +8, Vertrauen −4" */
export function consequenceText(f) {
  if (!f) return '';
  const parts = [];
  for (const [k, label] of [['ansehen', 'Ansehen'], ['vertrauen', 'Vertrauen']]) {
    const v = f[k];
    if (!v) continue;
    parts.push(`${label} ${v > 0 ? '+' + v : SIGN + Math.abs(v)}`);
  }
  return parts.join(', ') || 'keine';
}

/**
 * Handschriftlichen Text in Anrede, Absaetze, Gruss und Unterschrift teilen.
 * Erste Zeile mit Komma am Ende ist die Anrede; der letzte kurze Absatz ohne Satzende ist der Gruss
 * ("Dein Hinrich", "Mit Gruß\nMira Selin").
 */
export function splitLetter(text) {
  const paras = String(text ?? '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let salutation = '';
  let closing = '';
  let signature = '';
  if (paras.length && /,$/.test(paras[0]) && paras[0].length < 60 && !paras[0].includes('\n')) salutation = paras.shift();
  if (paras.length > 1) {
    const last = paras[paras.length - 1];
    if (last.length < 60 && !/[.!?:]$/.test(last)) {
      paras.pop();
      const lines = last.split('\n');
      if (lines.length > 1) {
        closing = lines.slice(0, -1).join(' ');
        signature = lines[lines.length - 1];
      } else signature = last;
    }
  }
  return { salutation, body: paras, closing, signature };
}

export function letterSheet(e, extra = {}) {
  const parts = splitLetter(e.text);
  return {
    id: extra.id ?? e.id,
    kind: 'letter',
    place: e.ort ?? '',
    date: extra.date ?? '',
    salutation: parts.salutation,
    body: parts.body,
    closing: parts.closing,
    signature: parts.signature,
    title: extra.title ?? (e.absender ? `Brief von ${e.absender}` : 'Brief'),
    ...(e.vermerk ? { note: e.vermerk, noteTitle: 'Vermerk der Fernmeldestelle' } : {}),
    ...(e.art === 'lask' ? { examined: true, examinedBy: 'Abgefangen · Fernmeldestelle Ostervenn', foreign: true } : {}),
    ...extra.fields,
  };
}

/** Generierte Feldpost (js/letters.js) als Brief mit Flecken nach Wetter und Tageszeit */
export function fieldPostSheet(fp) {
  const parts = splitLetter(fp.text);
  return {
    id: fp.id,
    kind: 'letter',
    place: 'Im Felde',
    date: fp.day ? `Tag ${fp.day}` : '',
    salutation: parts.salutation,
    body: parts.body,
    closing: parts.closing,
    signature: parts.signature,
    title: `Feldpost von ${fp.writer.name}, ${fp.groupLabel}`,
    stains: fp.stains,
    crooked: !!fp.night,
    seed: fp.id,
    tone: fp.tone,
  };
}

export function diarySheet(e, { weather, title } = {}) {
  return {
    id: e.id,
    kind: 'diary',
    date: e.titel ?? '',
    title: title ?? '',
    body: e.text,
    signature: 'I. B.',
    sketch: weather === 'regen' || weather === 'schlamm' ? 'regen' : 'huegel',
    seed: e.id,
  };
}

/** Stabsbefehl als Telegramm (Stil 03): Saetze enden mit STOP und stehen je auf einer Zeile */
export function orderSheet(e) {
  const lines = String(e.text ?? '')
    .split(/\s*STOP\s*/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + ' STOP');
  const f = e.folgen ?? {};
  return {
    id: e.id,
    kind: 'telegram',
    heading: 'STABSBEFEHL',
    number: e.nr ?? '',
    urgent: !!e.eilt,
    fields: [['Von', e.von ?? ''], ['An', e.an ?? ''], ['Abschnitt', e.abschnitt ?? ''], ['Frist', e.frist ?? '']],
    lines,
    footer: [['Erfüllt', consequenceText(f.erfuellt)], ['Verfehlt', consequenceText(f.verfehlt)]],
    typed: true,
  };
}

export function briefingSheet(e) {
  return {
    id: e.id,
    kind: 'briefing',
    title: e.titel ?? '',
    place: e.ort ?? '',
    time: e.zeit ?? '',
    mission: e.mission ?? '',
    body: e.text,
    goals: e.ziele ?? [],
  };
}

export function decisionSheet(e, ctxMatches) {
  const options = (e.optionen ?? []).filter((o) => !o.wann || ctxMatches(o.wann));
  return {
    id: e.id,
    kind: 'decision',
    title: e.titel ?? 'Entscheidung',
    body: e.text,
    options: options.map((o) => ({ id: o.id, label: o.label, text: o.text, consequence: consequenceText(o.folgen) })),
  };
}

/** Gefallenenliste einer Mission (Formblatt) */
export function casualtySheet({ id, mission, missionTitle, sector, day, fallen, wounded = 0 }) {
  const entries = fallen.map((c) => ({ name: c.name, group: c.groupLabel ?? '', turn: c.turn ?? '', cause: c.causeText ?? '' }));
  const notes = [];
  if (!entries.length) notes.push('Keine Gefallenen in diesem Einsatz.');
  if (wounded) notes.push(`Verwundet gemeldet: ${wounded === 1 ? 'eine Person' : numberWord(wounded) + ' Personen'}.`);
  if (entries.length) notes.push('Angehörige über Ortsbehörde benachrichtigen.');
  return {
    id,
    kind: 'casualties',
    title: 'Gefallenenliste',
    sector: sector ?? 'Asse-Nord',
    mission: missionTitle || mission,
    date: day ? `Tag ${day}` : '',
    entries,
    note: notes.join(' '),
    signedBy: 'Brandt, Major',
  };
}

export function newspaperSheet(e) {
  return {
    id: e.id,
    kind: 'newspaper',
    masthead: e.zeitung ?? 'Zeitung',
    date: e.datum ?? '',
    issue: e.fraktion === 'morrow' ? 'erbeutet' : '',
    price: '',
    headline: e.titel ?? '',
    subhead: e.unterzeile ?? '',
    columns: e.text,
    margin: e.randnotiz ?? '',
    seed: e.id,
    picture: e.fraktion !== 'morrow',
  };
}

const PHOTO_MOTIF = [
  [/Gruppe|Männer|Leute|Soldat|Frau|Kind|Paar|Familie|Mann/, 'gruppe'],
  [/Dorf|Hof|Gehöft|Kirche|Mühle|Haus|Straße/, 'dorf'],
];

export function findSheet(e) {
  let motif = 'graben';
  if (e.typ === 'karte') motif = 'karte';
  else if (e.typ === 'feldpostkarte') motif = 'postkarte';
  else for (const [re, m] of PHOTO_MOTIF) if (re.test(e.bild ?? '')) { motif = m; break; }
  return {
    id: e.id,
    kind: 'photo',
    motif,
    caption: e.titel ?? '',
    back: e.rueckseite ?? '',
    printer: e.typ === 'karte' ? 'Fundort: ' + (e.fundort ?? '') : e.typ === 'feldpostkarte' ? 'Feldpostkarte · gefunden ' + (e.fundort ?? '') : undefined,
    alt: e.bild ?? '',
    seed: e.id,
  };
}

export function findChainSheet(e) {
  return { id: e.id, kind: 'diary', date: 'Nachtrag', title: e.titel ?? '', body: e.text, signature: '', sketch: false, seed: e.id };
}

const LINO = { 1: 'sonne', 2: 'leuchtkugel', 3: 'leuchtkugel', 4: 'sonne' };

export function actSheet(e) {
  const act = Number(/^a(\d)/.exec(e.id)?.[1] ?? actOf(e.mission) ?? 1);
  const title = String(e.titel ?? '').replace(/^Akt \d+:\s*/, '');
  return {
    id: e.id,
    kind: 'actcard',
    act: 'Akt ' + actRoman(act),
    title,
    subtitle: e.zeit ?? e.untertitel ?? '',
    text: e.text ?? '',
    motif: LINO[act] ?? 'sonne',
    seed: e.id,
  };
}

/** Passendes Blatt zu einem Eintrag, nach art */
export function sheetFor(e, opts = {}) {
  switch (e.art) {
    case 'brief':
    case 'lask':
      return letterSheet(e);
    case 'tagebuch':
      return diarySheet(e, opts);
    case 'befehl':
      return orderSheet(e);
    case 'briefing':
      return briefingSheet(e);
    case 'entscheidung':
      return decisionSheet(e, opts.matches ?? (() => true));
    case 'zeitung':
      return newspaperSheet(e);
    case 'fundstueck':
      return findSheet(e);
    case 'fundstueck-kette':
      return findChainSheet(e);
    case 'akt':
      return actSheet(e);
    default:
      return { id: e.id, kind: 'diary', date: '', title: e.titel ?? '', body: e.text, sketch: false };
  }
}
