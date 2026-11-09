// Blaetter am Wochentisch des Frontabschnitts (P22, Plan 8.3, Texte data/texts/endlos.json von T2):
// Gefallenenliste der Woche, Wochenmeldung mit Punkten, Feldpost, Wochenanfang mit Jahreszeit, Stabsbefehl der
// naechsten Woche als Telegramm und der Stempel als Entscheidung. Am Ende der Schluss des Abschnitts.
// Rein: kein DOM, kein Date, kein Math.random. Die Oberflaeche dazu ist js/ui/narrative/reader.js (playSteps).
import { matches, pickSlot, fill, numberWord } from './texts.js';
import { groupInfoFrom } from './casualties.js';
import { storyValues, fillSheet } from './interlude.js';
import { consequenceText, casualtySheet, fieldPostSheet } from './sheets.js';
import { generateFieldPost, weatherWord } from '../letters.js';
import { SEASONS } from '../config/seasons.js';
import { seasonOf, isSeasonStart, actOfWeek, stampCost, SCORE } from '../modes/endless.js';

const SIGN = '−';
const signed = (n) => (n > 0 ? '+' + n : n < 0 ? SIGN + Math.abs(n) : '0');

const step = (kind, sheet, more = {}) => ({ kind, id: sheet.id, sheet, entry: null, ...more });

/** Platzhalter fuer die Texte des Endlosmodus */
export function weekValues(run, state, extra = {}) {
  const groups = state ? groupInfoFrom(state, 'a', run.faction) : {};
  const season = SEASONS[seasonOf(run.week)];
  return storyValues(groups, state, {
    woche: String(run.week),
    jahreszeit: season.article,
    abschnitt: extra.sector ?? 'der Abschnitt',
    ...extra,
  });
}

/** Stabsbefehl als Telegramm (Stil 03) */
export function weekOrderSheet(order, { sector = '', faction = 'kaldern' } = {}) {
  const lines = String(order.text ?? '').split(/\s*STOP\s*/).map((s) => s.trim()).filter(Boolean).map((s) => s + ' STOP');
  const f = order.folgen ?? {};
  return {
    id: `befehl-w${order.week}`,
    kind: 'telegram',
    heading: 'STABSBEFEHL',
    number: order.nr ?? '',
    urgent: !!order.eilt,
    fields: [['Von', order.von ?? ''], ['An', faction === 'morrow' ? 'ROTTENFÜHRUNG ABSCHNITT' : 'ABSCHNITTSFÜHRUNG'], ['Abschnitt', sector], ['Frist', order.frist ?? '']],
    lines,
    footer: [['Erfüllt', consequenceText(f.erfuellt)], ['Verfehlt', consequenceText(f.verfehlt)]],
    typed: true,
  };
}

/** Der Stempel auf dem Stabsbefehl als Entscheidung: befolgen, umdeuten, verweigern (sofortige Folgen wie in der Kampagne) */
export function stampSheet(order) {
  const um = stampCost(order, 'umdeuten'), ver = stampCost(order, 'verweigern');
  return {
    id: `stempel-w${order.week}`,
    kind: 'decision',
    title: `Stempel auf Befehl ${order.nr}`,
    body: 'Ein Stempel je Woche. Er lässt sich nicht zurücknehmen.',
    options: [
      { id: 'befolgen', label: 'Befolgen', text: '', consequence: 'Volle Folgen am Ende der Woche' },
      { id: 'umdeuten', label: 'Umdeuten', text: '', consequence: `Sofort ${consequenceText(um)}, danach halbe Folgen` },
      { id: 'verweigern', label: 'Verweigern', text: '', consequence: `Sofort ${consequenceText(ver)}, danach keine Folgen` },
    ],
  };
}

/** Wochenmeldung: wie die Woche ausging, was sich bei Ansehen und Vertrauen geaendert hat, Punkte */
export function weekReportSheet(record, changes, run, { sector = '' } = {}) {
  const season = SEASONS[record.season];
  const body = [];
  if (record.order) body.push(`Stabsbefehl „${record.order.titel}“: ${record.order.met ? 'erfüllt' : 'verfehlt'}. ${record.order.why}`);
  body.push(record.fell ? 'Der Abschnitt ist gefallen.' : record.held ? 'Der Abschnitt hat die Woche gehalten.' : `Der Abschnitt steht, aber ${record.lostGround} eigene Grabenfelder sind drüben.`);
  const lines = changes.map((c) => `${c.axis === 'ansehen' ? 'Ansehen' : 'Vertrauen'} ${signed(c.amount)}: ${c.reason}`);
  if (lines.length) body.push(lines.join('\n'));
  const pts = (record.held ? SCORE.week : 0) + record.gained * SCORE.field + record.rescued * SCORE.rescued + record.fallen * SCORE.fallen;
  body.push(`Punkte dieser Woche ${signed(pts)} (gehalten ${record.held ? SCORE.week : 0}, Felder ${record.gained} × ${SCORE.field}, geborgen ${record.rescued} × ${SCORE.rescued}, gefallen ${record.fallen} × ${SIGN}${Math.abs(SCORE.fallen)}). Insgesamt ${record.points}.`);
  return {
    id: `meldung-w${record.week}`,
    kind: 'briefing',
    title: `Wochenmeldung ${record.week}`,
    place: sector,
    time: `${season.name}, Woche ${record.week}`,
    mission: `Woche ${record.week}`,
    body: body.join('\n\n'),
    goals: [],
  };
}

/** Wochenanfang und Jahreszeit als Tagebuchseite der Kommandantin */
export function weekStartSheet(index, run, state, { lastFallen = null, arrivals = 0 } = {}) {
  const week = run.week;
  const season = seasonOf(week);
  const wetter = weatherWord(state?.weather?.kind);
  const flags = [];
  if (isSeasonStart(week)) flags.push('jahreszeit_wechsel');
  if (arrivals > 0) flags.push('ersatz_eingetroffen');
  const ctx = { ansehen: run.ansehen, vertrauen: run.vertrauen, flags, fraktion: run.faction, wetter, werte: lastFallen == null ? {} : { gefallene: lastFallen } };
  const paras = [];
  if (week > 1) {
    const e = pickSlot(index, 'endlos.woche', ctx);
    if (e) paras.push(e.text);
  }
  const of = (teil) => index.list.filter((x) => x.art === 'jahreszeit' && x.jahreszeit === season && x.teil === teil);
  if (week === 1 || isSeasonStart(week)) {
    const e = of('wechsel')[0];
    if (e) paras.push(e.text);
  } else {
    const list = of('wetter');
    const e = list.find((x) => x.wann && matches(x.wann, ctx)) ?? list.find((x) => !x.wann);
    if (e) paras.push(e.text);
  }
  return {
    id: `woche-${week}`,
    kind: 'diary',
    date: `Woche ${week}, ${SEASONS[season].name}`,
    title: '',
    body: paras.join('\n\n'),
    signature: 'I. B.',
    sketch: wetter === 'regen' || wetter === 'schlamm' ? 'regen' : 'huegel',
    seed: `woche-${week}`,
  };
}

/** Schluss des Abschnitts: Text nach Grund, beim Abloesen als Telegramm */
export function endSheet(index, run, values) {
  const grund = run.ended === 'wochenlage' ? null : run.ended;
  if (!grund) {
    return {
      id: 'ende-wochenlage', kind: 'briefing', title: 'Wochenlage beendet', place: values.abschnitt ?? '', time: `Woche ${run.endWeek}`,
      mission: 'Wochenlage', body: `Vier Wochen im selben Graben. Der Abschnitt wird an die nächste Einheit übergeben.\n\nPunkte: ${run.score.points}.`, goals: [],
    };
  }
  const e = index.list.find((x) => x.art === 'endlos-ende' && x.grund === grund);
  const text = fill(e?.text ?? 'Der Abschnitt ist verloren.', { ...values, woche: String(run.endWeek ?? run.week) });
  if (grund === 'abgeloest') {
    return {
      id: 'ende-abgeloest', kind: 'telegram', heading: 'STABSBEFEHL', number: 'ENDE', urgent: true,
      fields: [['An', 'ABSCHNITTSFÜHRUNG'], ['Abschnitt', values.abschnitt ?? '']],
      lines: text.split(/\s*STOP\s*/).map((s) => s.trim()).filter(Boolean).map((s) => s + ' STOP'), footer: [], typed: true,
    };
  }
  return { id: 'ende-' + grund, kind: 'diary', date: `Woche ${run.endWeek ?? run.week}`, title: '', body: text, signature: 'I. B.', sketch: 'regen', seed: 'ende-' + grund };
}

/**
 * Alle Schritte am Wochentisch.
 * input: { run (nach finishWeek; run.week = naechste Woche), record (null in Woche 1), changes, casualties,
 *          rounds, endState (Zustand am Ende der Woche), state (Zustand zu Beginn der naechsten Woche), map, sector }
 */
export function buildWeekSteps(index, input) {
  const { run, record = null, changes = [], casualties = { fallen: [], wounded: [] }, rounds = [], endState = null, state = null, map = null } = input;
  const sector = input.sector ?? map?.name ?? '';
  const steps = [];
  const valuesEnd = weekValues(run, endState ?? state, { sector, abschnitt: sector, stab: (index.list.find((x) => x.art === 'endlos-stab' && x.fraktion === run.faction)?.text) ?? 'STAB' });
  if (record) {
    const about = `Woche ${record.week}`;
    steps.push(step('casualties', casualtySheet({
      id: `liste-w${record.week}`, mission: about, missionTitle: about, sector, day: endState?.clock?.day ?? null, fallen: casualties.fallen, wounded: casualties.wounded.length,
    }), { section: 'Nach der Woche', about }));
    steps.push(step('briefing', weekReportSheet(record, changes, run, { sector }), { section: 'Wochenmeldung', about }));
    if (!run.ended || run.ended === 'wochenlage') {
      const templates = index.list.filter((e) => e.art === 'feldpost' || e.art === 'ereignis' || e.art === 'anrede');
      const fp = generateFieldPost({
        templates, side: 'a', faction: run.faction, groups: groupInfoFrom(endState, 'a', run.faction), state: endState, rounds, casualties,
        trust: run.vertrauen, reputation: run.ansehen, flags: run.flags, werte: { gefallene: record.fallen },
        act: actOfWeek(record.week), map, sector, seed: run.seed, mission: 'w' + record.week, count: 2,
        used: run.book.fallen.map((f) => f.name),
      });
      for (const f of fp) steps.push(step('fieldpost', fieldPostSheet(f), { section: 'Feldpost', about }));
    }
  }
  if (run.ended) {
    steps.push(step(run.ended === 'abgeloest' ? 'order' : 'diary', endSheet(index, run, valuesEnd), { section: 'Ende des Abschnitts' }));
    return steps.map((s) => ({ ...s, sheet: fillSheet(s.sheet, valuesEnd) }));
  }
  const about = `Woche ${run.week}`;
  const values = weekValues(run, state, { sector, abschnitt: sector, anzahl: numberWord(record?.fallen ?? 0) });
  steps.push(step('diary', fillSheet(weekStartSheet(index, run, state, { lastFallen: record ? record.fallen : null, arrivals: state?.endless?.arrivals?.length ?? 0 }), values), { section: `Woche ${run.week} beginnt`, about }));
  if (run.order) {
    steps.push(step('order', weekOrderSheet(run.order, { sector, faction: run.faction }), { section: `Stabsbefehl, Woche ${run.week}`, about }));
    if (!run.stamps?.['w' + run.week]) steps.push(step('decision', stampSheet(run.order), { section: 'Stempel', about }));
  }
  return steps.map((s) => (s.kind === 'diary' ? s : { ...s, sheet: fillSheet(s.sheet, valuesEnd) }));
}

