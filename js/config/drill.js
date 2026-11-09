// Grundausbildung (Einstieg fuer Anfaenger): Schritt fuer Schritt durch die erste Partie an der Asse.
// Jeder Schritt hat einen Text im Ton des Spiels, optional einen Anker (Bedienelement, das mit Bleistift umkringelt
// wird) und eine Bedingung done(a, start), die auf der Schnittstelle des Gefechts (window.__gefecht) prueft, ob der
// Schritt geschafft ist. Schritte mit manual: true gehen mit "Weiter". Reine Daten und Pruefungen, kein DOM.
import { listOrders } from '../ui/orderbook.js';

export const DRILL_KEY = 'lehmfront.ausbildung';
/** Gefecht fuer die Grundausbildung: Asse-Nord, schwacher Gegner, ohne Rundenlimit, Seed fest */
export const DRILL_PATH = '?scene=gefecht&karte=asse&ki=rekrut&runden=0&seed=1917&ausbildung=1';

const ownOrders = (a) => listOrders(a.book, a.side).filter((o) => o.group);
const hasOrder = (a, types) => ownOrders(a).some((o) => types.includes(o.type));
const selectedOwn = (a) => {
  const g = a.selected ? a.state.groups.find((x) => x.id === a.selected) : null;
  return !!g && g.side === a.side;
};

export const DRILL_STEPS = [
  {
    id: 'karte', von: 'Harms', title: 'Die Lagekarte',
    text: 'Das ist unser Abschnitt an der Asse. Blau sind unsere Gräben und Gruppen, rot die von drüben. Schieb die Karte mit Maus oder Finger, zoom mit dem Mausrad oder mit zwei Fingern.',
    manual: true,
  },
  {
    id: 'waehlen', von: 'Harms', title: 'Eine Gruppe wählen',
    text: 'Tipp auf ein blaues Kästchen, zum Beispiel die „1“. Jede Gruppe hat acht bis zwölf Mann und einen Gruppenführer mit Namen.',
    done: (a) => selectedOwn(a),
  },
  {
    id: 'schild', von: 'Harms', title: 'Das Schild',
    text: 'Am Schild steht alles über die Gruppe: Stärke, Moral, Erschöpfung, Erfahrung und der Befehl. Ohne Befehl hält sie. Das ist erlaubt und oft richtig.',
    anchor: '.shield', manual: true,
  },
  {
    id: 'bewegen', von: 'Harms', title: 'Bewegen',
    text: 'Wähl eine Gruppe, dann „Bewegen“ (Taste B), und tipp ein Ziel an. Mit dem Finger merkt das erste Tippen das Ziel vor, das zweite setzt es. Der Pfeil zeigt, wie weit sie in dieser Runde kommt.',
    anchor: '[data-tool="move"]', done: (a) => hasOrder(a, ['move', 'redeploy']),
  },
  {
    id: 'zurueck', von: 'Harms', title: 'Nichts ist endgültig',
    text: 'Bis zum Ausführen lässt sich alles ändern. „Zurück“ (Strg+Z) nimmt den letzten Befehl zurück, die Befehlsliste (Tab) zeigt alle Befehle auf einen Blick.',
    anchor: '[data-undo]', manual: true,
  },
  {
    id: 'graben', von: 'Selin', title: 'Graben',
    text: 'Wähl eine Gruppe und „Graben“ (G), dann zieh eine Linie. Lange gerade Stücke kann ein MG von der Seite bestreichen. Das Kärtchen bietet dann „Traversen einfügen“ an: fast immer eine gute Idee.',
    anchor: '[data-tool="dig"]', done: (a) => hasOrder(a, ['dig']),
  },
  {
    id: 'mg', von: 'Harms', title: 'Das MG',
    text: 'Wähl den MG-Trupp (Kästchen „MG“) und „Feuern“ (F). Beim MG legst du einen Feuerkegel: Wer dort durchläuft, wird niedergehalten, auch wenn niemand fällt.',
    anchor: '[data-tool="fire"]', done: (a) => hasOrder(a, ['sector', 'fire']),
  },
  {
    id: 'liste', von: 'Harms', title: 'Vor der Runde',
    text: 'Das Kärtchen „Vor der Runde“ sammelt, was noch offen ist: Gruppen ohne Befehl, Versorgung, Leitungen. Antippen springt zur Stelle. Nichts davon ist Pflicht.',
    anchor: '.check', manual: true,
  },
  {
    id: 'runde', von: 'Harms', title: 'Runde ausführen',
    text: 'Steht der Plan, tipp „Runde ausführen“ (Enter). Drüben plant Hauptmann Lask zur selben Zeit. Dann laufen beide Befehlslisten gleichzeitig ab: zwölf Stunden in einer Stellungsrunde.',
    anchor: '.exec', done: (a, s) => a.state.turn > s.turn,
  },
  {
    id: 'film', von: 'Harms', title: 'Film und Telegramm',
    text: 'Die Runde läuft als Film in Phasen. „Weiter“ zeigt die nächste Phase, „Überspringen“ springt ans Ende. Im Telegramm steht jede Meldung mit Begründung; antippen springt zur Stelle.',
    manual: true,
  },
  {
    id: 'loren', von: 'Selin', title: 'Die Loren',
    text: 'Alles muss mit der Feldbahn nach vorn. „Lorenplan“ (L) zeigt den Zug: tipp einen Wagen an, um die Ladung zu wechseln. Verwundete fahren auf denselben Wagen zurück, sonst bleiben sie liegen.',
    anchor: '[data-tool="supply"]', done: (a) => a.toolInfo?.id === 'supply' || !!a.plans?.[a.side]?.supply_plan,
  },
  {
    id: 'lehrling', von: 'Harms', title: 'Der Taktik-Lehrling',
    text: 'Unsicher? Der „Lehrling“ (T) rechnet, was Lask an deiner Stelle täte, und schreibt dazu, warum. Einzelne Vorschläge oder alle übernehmen, wie du magst.',
    anchor: '.lr-btn', manual: true,
  },
  {
    id: 'bleistift', von: 'Selin', title: 'Bleistift auf der Karte',
    text: 'Geht etwas schief, steht es mit Bleistift an der Stelle: „Traverse fehlt!“, „Draht!“, „Lorenplan prüfen“. Und wenn du eine Gruppe gewählt hast, zeigt die Karte beim Zeigen oder Antippen, wie weit sie sieht.',
    manual: true,
  },
  {
    id: 'fertig', von: 'Harms', title: 'Ausgebildet',
    text: 'Das reicht für den Anfang, Frau Major. Spiel hier weiter, solange du magst. Akt 1 der Kampagne bringt jede Mechanik einzeln, das Handbuch erklärt alle Begriffe.',
    final: true,
  },
];

/** Index des ersten Schritts, der noch nicht geschafft ist (ab from) */
export function nextStep(steps, a, start, from = 0) {
  for (let i = from; i < steps.length; i++) {
    const s = steps[i];
    if (s.final || s.manual || !s.done) return i;
    if (!s.done(a, start)) return i;
  }
  return steps.length - 1;
}

/** Fortschritt lesen und schreiben (localStorage, ohne Speicher stumm) */
export function readDrill(storage = globalThis.localStorage) {
  try { const v = JSON.parse(storage?.getItem(DRILL_KEY) ?? 'null'); return v && typeof v === 'object' ? v : null; } catch { return null; }
}
export function writeDrill(v, storage = globalThis.localStorage) {
  try { storage?.setItem(DRILL_KEY, JSON.stringify(v)); } catch { /* ohne Speicher */ }
}
