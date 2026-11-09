// Abgefangene Notizen von Lask (Ueberraschung P13). Rein: kein DOM, kein Date, kein Math.random.
//
// Die Notiz entsteht aus der echten naechsten Entscheidung der KI (decide aus js/ai.js): Lage, Ziel, Tageszeit,
// Feuerplan. Sie luegt nicht, ist aber bruchstueckhaft: je nach Schwierigkeit sind Teile verwischt ({{...}}).
// Ob eine Notiz abgefangen wird, haengt davon ab, was die Spielerseite getan hat (Aufklaerung nah am Feind,
// Gefangene, eingebrochene Graeben) und vom Zufall der Runde.
import { cellLabel, distance } from '../map.js';
import { aiRng } from '../ai.js';

/** Grundchance in Prozent je Stellungsrunde */
export const NOTE_BASE = 18;
/** Zuschlag, wenn ein eigener Beobachter oder Melder nah am Feind steht */
export const NOTE_SCOUT = 22;
/** Verwischte Woerter je Schwierigkeit in Prozent */
export const SMUDGE = { rekrut: 10, veteran: 25, lask: 40 };

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/**
 * Wird in dieser Runde eine Notiz abgefangen? playerView = Sicht der Spielerseite nach der Runde.
 * Liefert { chance, why } (chance 0..100).
 */
export function interceptChance(playerView) {
  const side = playerView.side;
  const log = playerView.log ?? [];
  if (log.some((e) => e.type === 'group_captured' && e.side && e.side !== side)) return { chance: 100, why: 'bei einem Gefangenen gefunden' };
  if (log.some((e) => e.type === 'breach' && e.side === side)) return { chance: 100, why: 'im genommenen Graben gefunden' };
  const foes = playerView.groups.filter((g) => g.side !== side && g.status !== 'lost');
  const ghosts = playerView.ghosts ?? [];
  const scouts = playerView.groups.filter((g) => g.side === side && g.status !== 'lost' && (g.type === 'observers' || g.type === 'runners'));
  const near = scouts.some((s) => [...foes, ...ghosts].some((f) => distance(f.pos, s.pos) <= 10));
  if (near) return { chance: NOTE_BASE + NOTE_SCOUT, why: 'von einem Beobachter aus dem Niemandsland geholt' };
  return { chance: NOTE_BASE, why: 'von einer Streife am Draht aufgelesen' };
}

/** Uhrzeit-Wort fuer die Notiz (die naechste Stellungsrunde beginnt dort, wo die Uhr steht) */
function timeWord(view) {
  const h = view.clock?.hour ?? 6;
  if (view.night) return h >= 18 ? 'heute Nacht' : 'vor dem Morgengrauen';
  return h < 12 ? 'im Laufe des Tages' : 'gegen Abend';
}

function smudge(rng, text, rate) {
  // Einzelne Woerter verwischen, nie das erste und nie Feldangaben ganz (die Notiz soll lesbar bleiben)
  return text.split(' ').map((w, i) => (i > 0 && !/\d/.test(w) && w.length > 3 && rng() * 100 < rate ? `{{${w}}}` : w)).join(' ');
}

/**
 * Notiz aus einer Entscheidung. decision = Rueckgabe von decide fuer Lasks Seite; view = Lasks Sicht, aus der sie kam.
 * Liefert { id, posture, lines: [text], signature, hint, at } oder null.
 * hint ist der Klartext fuer Bildschirmleser und das Protokoll (ohne Verwischungen).
 */
export function noteFromDecision(decision, view, { seed = 1, difficulty = 'veteran' } = {}) {
  if (!decision) return null;
  const rng = aiRng(seed, view.side, view.turn, 'notiz');
  const it = decision.intent ?? {};
  const obj = it.objective ? cellLabel(it.objective.x, it.objective.y) : null;
  const n = it.groups?.length ?? 0;
  const rotten = n === 1 ? 'einer Rotte' : `${n} Rotten`;
  const when = timeWord(view);
  const lines = [];
  let hint;
  switch (decision.posture) {
    case 'sturm':
      lines.push(pick(rng, ['An Ozols:', 'An die Halbschwadron:', 'Kalnis, bitte weitergeben:']));
      lines.push(obj ? `${cap(when)} ${n === 1 ? 'geht eine Rotte' : `gehen ${n} Rotten`} auf ${obj}.` : `${cap(when)} wird angegriffen.`);
      if (it.fire?.includes('creep')) lines.push('Die Walze vorneweg, fünf Felder Abstand. Wer schneller läuft, läuft in die eigenen Granaten.');
      else if (it.fire?.includes('prep')) lines.push('Vorher schießt die Batterie. Keine Pfeife, bevor es still wird.');
      else lines.push('Ohne Artillerie. Leise bis an den Draht.');
      lines.push(pick(rng, ['Ein Bauer, der zögert, ist ein verlorener Bauer.', 'Drüben schläft man auch nicht. Trotzdem.', 'Ich will die Namen heute Abend.']));
      hint = obj ? `Lask greift ${when} mit ${rotten} bei ${obj} an.` : `Lask greift ${when} an.`;
      break;
    case 'vorbereiten':
      lines.push(pick(rng, ['Notiz für den Stab:', 'An Leutnant Ozols:', 'Für mich selbst:']));
      lines.push(obj ? `Die Krämer sind bei ${obj} dünn. Dort setzen wir an.` : 'Wir suchen die dünne Stelle drüben.');
      if (it.fire?.includes('harass')) lines.push('Bis dahin Störfeuer, damit sie nicht schlafen.');
      if (it.fire?.includes('counter')) lines.push('Erst ihre Batterie zum Schweigen bringen.');
      lines.push(pick(rng, ['Noch nicht. Erst die Figuren stellen.', 'Geduld ist auch eine Waffe, sagt Ruta.', 'Der Zug kommt, wenn die Diagonale offen ist.']));
      hint = obj ? `Lask bereitet einen Angriff bei ${obj} vor.` : 'Lask bereitet einen Angriff vor.';
      break;
    case 'gegenstoss':
      lines.push('An alle Rotten im Abschnitt:');
      lines.push(obj ? `Der Graben bei ${obj} wird zurückgeholt, bevor sie sich eingraben.` : 'Was verloren ist, holen wir zurück.');
      lines.push('Ich warte nicht auf den Stab.');
      hint = obj ? `Lask will den Graben bei ${obj} im Gegenstoß zurückholen.` : 'Lask plant einen Gegenstoß.';
      break;
    default:
      lines.push(pick(rng, ['An die Halbschwadron:', 'Notiz für den Stab:', 'Kalnis, bitte weitergeben:']));
      lines.push('Wir bleiben im Graben. Wer den Kopf hebt, verliert ihn.');
      if (it.fire?.includes('barrage')) lines.push('Das Sperrfeuer liegt vor dem Draht. Wenn sie kommen, kommen sie da durch.');
      lines.push(pick(rng, ['Wir warten, bis drüben jemand ungeduldig wird.', 'Remis ist kein Verlust.', 'Hier vorn sind alle Felder schwarz.']));
      hint = 'Lask hält die Linie und wartet ab.';
  }
  const rate = SMUDGE[difficulty] ?? SMUDGE.veteran;
  const shown = lines.map((l, i) => (i === 0 ? l : smudge(rng, l, rate)));
  const at = it.objective ?? (view.groups.find((g) => g.side === view.side)?.pos ?? { x: 0, y: 0 });
  return { id: `notiz-${view.turn}`, turn: view.turn, posture: decision.posture, lines: shown, signature: 'L.', hint, at: { x: at.x, y: at.y } };
}

/**
 * Notiz abfangen oder nicht: deterministisch aus Seed und Runde.
 * Liefert die Notiz mit found (wo sie gefunden wurde) oder null.
 */
export function maybeIntercept({ decision, laskView, playerView, seed = 1, difficulty = 'veteran' }) {
  if (!decision || !laskView || !playerView) return null;
  if (laskView.turnKind !== 'position') return null; // im Gefecht schreibt niemand Notizen
  const { chance, why } = interceptChance(playerView);
  const rng = aiRng(seed, playerView.side, playerView.turn, 'abfangen');
  if (rng() * 100 >= chance) return null;
  const note = noteFromDecision(decision, laskView, { seed, difficulty });
  return note ? { ...note, found: why } : null;
}

/** Text in Teile zerlegen: [{ text, smudged }] (fuer die Anzeige) */
export function noteParts(line) {
  const out = [];
  const re = /\{\{(.*?)\}\}/g;
  let last = 0, m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), smudged: false });
    out.push({ text: m[1], smudged: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), smudged: false });
  return out;
}
