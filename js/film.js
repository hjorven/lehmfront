// Phasenfilm (Plan 3.4 Punkt 4 und 5, 7.5): eine aufgeloeste Runde als kurzer Film in Phasen.
// Rein: kein DOM, kein Date, kein Math.random. Die Oberflaeche dazu steht in js/ui/film.js.
//
// Idee: Der Film speichert keine Zwischenstaende, sondern rechnet sie bei Bedarf aus dem Startzustand neu
// (resolveTurn mit den ersten n Phasen). Jede Phase hat ihren eigenen Zufallsstrom (rngForPhase), also ist
// der Zustand nach n Phasen genau der, den die volle Runde an dieser Stelle hatte. Damit geht Scrubbing
// vor und zurueck, ohne dass eine Phase etwas fuer den Film tun muss.
//
// Zeitachse: Phasen mit gleicher Abteilung in ORDER (z. B. move und hold unter "movement") bilden einen
// Abschnitt mit einem Reiter. Abschnitte ohne sichtbares Ereignis fallen weg, Bewegung und der letzte
// Abschnitt (Uhr) bleiben immer. In der letzten Sekunde laeuft der Tag-Nacht-Uebergang (transitionAt).
import { resolveTurn } from './resolve.js';
import { phasesFor, ORDER, phaseOrder } from './phases/registry.js';
import { viewFor } from './view.js';
import { advanceClock } from './phases/clock.js';
import { cellLabel } from './map.js';
import { compareId } from './state.js';

export const TIMING = {
  base: 1500,       // ms je Abschnitt
  perEvent: 650,    // ms je sichtbarem Ereignis
  max: 5200,
  last: 1600,       // letzter Abschnitt (Uhr), enthaelt den Uebergang
  transition: 1000, // letzte Sekunde des Films: Tag-Nacht-Uebergang
};

/** Deutsche Namen der Abteilungen fuer die Reiter */
export const SECTION_LABELS = {
  orders: 'Befehle', weather: 'Wetter', artillery: 'Artillerie', works: 'Bauen', tunnels: 'Stollen',
  movement: 'Bewegung', supply: 'Versorgung', morale: 'Moral', attack: 'Angriff', clock: 'Uhr',
  dugout: 'Unterstand', fire: 'Feuer', melee: 'Nahkampf', end: 'Lage',
};

/** Abteilung einer Phase: groesster ORDER-Eintrag, der nicht hinter der Phase liegt */
export function sectionOf(order, kind) {
  let best = 'orders', bestN = -Infinity;
  for (const [key, n] of Object.entries(ORDER[kind])) {
    if (n <= order && n > bestN) { best = key; bestN = n; }
  }
  return best;
}

/**
 * Abschnitte einer Runde. phases: Phasenliste in Ausfuehrungsreihenfolge, log: sichtbares Protokoll.
 * Liefert [{ key, label, phaseIds, upto, events, start, dur }]. upto = Anzahl Phasen, die nach dem Abschnitt
 * gelaufen sind (fuer replay). Ereignisse der Befehlspruefung (phase 'orders') bilden den Abschnitt "Befehle".
 */
export function planSections(kind, phases, log) {
  const sections = [];
  const ordersEvents = log.filter((e) => e.phase === 'orders');
  if (ordersEvents.length) sections.push({ key: 'orders', phaseIds: [], upto: 0, events: ordersEvents });
  phases.forEach((p, i) => {
    const key = sectionOf(phaseOrder(p, kind), kind);
    let s = sections[sections.length - 1];
    if (!s || s.key !== key || s.upto === 0) {
      s = { key, phaseIds: [], upto: 0, events: [] };
      sections.push(s);
    }
    s.phaseIds.push(p.id);
    s.upto = i + 1;
    for (const e of log) if (e.phase === p.id) s.events.push(e);
  });
  const lastIdx = sections.length - 1;
  const kept = sections.filter((s, i) => s.events.length > 0 || s.key === 'movement' || i === lastIdx);
  let t = 0;
  return kept.map((s, i) => {
    const last = i === kept.length - 1;
    const dur = last
      ? Math.max(TIMING.last, Math.min(TIMING.max, TIMING.base + s.events.length * TIMING.perEvent))
      : Math.min(TIMING.max, TIMING.base + s.events.length * TIMING.perEvent);
    const out = { ...s, label: SECTION_LABELS[s.key] ?? s.key, start: t, dur };
    t += dur;
    return out;
  });
}

/** Zustand nach den ersten n Phasen der Runde (n = 0: nur Befehle geprueft). Deterministisch. */
export function replayTo(input, n) {
  const { state, ordersA, ordersB, seed, turn, env = {} } = input;
  const list = phasesFor(state.turnKind, env.phases).slice(0, n);
  return resolveTurn(state, ordersA, ordersB, seed, turn, { ...env, phases: list });
}

/**
 * Wege der Gruppen zwischen zwei Zustaenden. Bewegungsereignisse liefern den gegangenen Weg
 * (from + die ersten steps Felder des Befehls), sonst eine gerade Linie, wenn sich der Ort geaendert hat.
 * Liefert Map(groupId -> [{x,y}, ...]) nur fuer Gruppen, die sich bewegt haben.
 */
export function tracksBetween(before, after, events, orders) {
  const byGroup = new Map(orders.map((o) => [o.group, o]));
  const tracks = new Map();
  for (const e of events) {
    if (!e.group || !e.from || !e.to || !(e.steps > 0)) continue;
    const o = byGroup.get(e.group);
    const walked = o?.path ? o.path.slice(0, e.steps) : [];
    const last = walked[walked.length - 1];
    const pts = last && last.x === e.to.x && last.y === e.to.y ? [e.from, ...walked] : [e.from, e.to];
    tracks.set(e.group, pts.map((p) => ({ x: p.x, y: p.y })));
  }
  const prev = new Map(before.groups.map((g) => [g.id, g.pos]));
  for (const g of [...after.groups].sort((a, b) => compareId(a.id, b.id))) {
    if (tracks.has(g.id)) continue;
    const p = prev.get(g.id);
    if (p && (p.x !== g.pos.x || p.y !== g.pos.y)) tracks.set(g.id, [{ ...p }, { ...g.pos }]);
  }
  return tracks;
}

/** Ort auf einem Weg bei f (0..1), gleichmaessig je Schritt. Liefert {x, y} mit Kommastellen. */
export function trackPos(pts, f) {
  if (pts.length === 1 || f <= 0) return { x: pts[0].x, y: pts[0].y };
  if (f >= 1) return { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y };
  const s = f * (pts.length - 1);
  const i = Math.floor(s);
  const t = s - i;
  const a = pts[i], b = pts[i + 1];
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Teilweg bis f (fuer Spuren): Punkte bis zur aktuellen Stelle */
export function trackUpTo(pts, f) {
  if (f >= 1) return pts.map((p) => ({ ...p }));
  const s = Math.max(0, f) * (pts.length - 1);
  const i = Math.floor(s);
  return [...pts.slice(0, i + 1).map((p) => ({ ...p })), trackPos(pts, f)];
}

/** Abschnitt und Anteil zur Zeit t (ms) */
export function sectionAt(sections, t) {
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    if (t < s.start + s.dur || i === sections.length - 1) {
      return { index: i, f: Math.max(0, Math.min(1, (t - s.start) / s.dur)) };
    }
  }
  return { index: 0, f: 0 };
}

/** Zeitpunkt (ms), zu dem das i-te Ereignis eines Abschnitts im Telegramm erscheint */
export function eventTime(section, i) {
  const n = section.events.length;
  return section.start + Math.floor((section.dur * (i + 1)) / (n + 1));
}

/** Uebergang Tag-Nacht in der letzten Sekunde: t 0..1 oder null davor */
export function transitionAt(total, t) {
  const start = total - TIMING.transition;
  if (t < start) return null;
  return Math.max(0, Math.min(1, (t - start) / TIMING.transition));
}

/** Spieluhr waehrend des Films: linear zwischen Uhr vorher und nachher, auf Minuten abgerundet */
export function clockDuring(before, after, total, t) {
  const toMin = (c) => c.day * 1440 + c.hour * 60 + c.minute;
  const span = Math.max(0, toMin(after) - toMin(before));
  const f = total > 0 ? Math.max(0, Math.min(1, t / total)) : 1;
  return advanceClock(before, Math.floor(span * f));
}

const WARN_TYPES = new Set(['order_invalid', 'losses', 'lost', 'wire_cut', 'line_cut']);

/** Ton einer Telegrammzeile: warn (rot), quiet (grau) oder '' */
export function toneOf(e) {
  if (WARN_TYPES.has(e.type) || e.blocked) return 'warn';
  if (e.minor || e.type === 'hold') return 'quiet';
  return '';
}

/** Begruendung im Fernschreiberstil: Satzende wird zu STOP */
export function stopText(reason) {
  const s = String(reason).trim().replace(/[.!]+$/, '');
  return s + ' STOP';
}

function hhmm(c) {
  return String(c.hour).padStart(2, '0') + String(c.minute).padStart(2, '0');
}

/**
 * Ganzen Film einer Runde fuer eine Seite planen.
 * input = { state (vorher), ordersA, ordersB, seed, turn, env }, result = { state, log } aus resolveTurn.
 * Liefert { side, kind, turn, sections, total, lines, before, after, darkness? }.
 * lines: Telegrammzeilen in Filmreihenfolge [{ id, time, section, head, text, tone, at, group, event }].
 */
export function planFilm(input, result, side) {
  const kind = input.state.turnKind;
  const phases = phasesFor(kind, input.env?.phases);
  const visible = viewFor(result.state, result.log, side, input.env ?? {}).log;
  // Ereignisse nur der eigenen Befehlspruefung zeigen (wie bisher im Meldungen-Kaertchen)
  const log = visible.filter((e) => e.phase !== 'orders' || e.side === side);
  const sections = planSections(kind, phases, log);
  const last = sections[sections.length - 1];
  const total = last ? last.start + last.dur : 0;
  const lines = [];
  sections.forEach((s, si) => {
    s.events.forEach((e, i) => {
      const time = eventTime(s, i);
      const clock = clockDuring(input.state.clock, result.state.clock, total, time);
      lines.push({
        id: `${input.turn}-${lines.length}`,
        time,
        section: si,
        // Ereignisse ohne Seite (Uhr, Wetter) betreffen den ganzen Abschnitt: ohne Feldangabe
        head: `${hhmm(clock)} ${s.label.toUpperCase()}` + (e.side ? ` · FELD ${cellLabel(e.at.x, e.at.y)}` : ''),
        text: stopText(e.reason),
        tone: toneOf(e),
        at: { ...e.at },
        group: e.side === side ? e.group ?? null : null,
        type: e.type,
      });
    });
  });
  return {
    side, kind, turn: input.turn, sections, total, lines,
    clockBefore: { ...input.state.clock }, clockAfter: { ...result.state.clock },
  };
}

/** Wie viele Telegrammzeilen sind zur Zeit t schon da? */
export function linesUntil(film, t) {
  let n = 0;
  while (n < film.lines.length && film.lines[n].time <= t) n++;
  return n;
}

/** Anfang des naechsten Abschnitts nach t (fuer "Weiter"), oder total */
export function nextStop(film, t) {
  for (const s of film.sections) if (s.start + s.dur > t + 1) return s.start + s.dur;
  return film.total;
}
