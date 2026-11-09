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

// Kurz halten: ein Gedanke je Schritt. tools: Befehle, die mit diesem Schritt dazukommen (vorher gibt es keine).
// show: Kaertchen, die ab hier sichtbar sind (check = "Vor der Runde", lehrling = Knopf Lehrling).
export const DRILL_STEPS = [
  {
    id: 'karte', von: 'Harms', title: 'Deine Front',
    text: 'Blau bist du, rot ist der Gegner. Zum Verschieben die Karte ziehen, zum Zoomen Mausrad oder zwei Finger.',
    manual: true,
  },
  {
    id: 'waehlen', von: 'Harms', title: 'Gruppe wählen',
    text: 'Tipp auf ein blaues Kästchen, zum Beispiel die „1“. Das ist eine Gruppe von etwa zehn Mann.',
    done: (a) => selectedOwn(a),
  },
  {
    id: 'schild', von: 'Harms', title: 'Die Karte der Gruppe',
    text: 'Hier steht, wie es der Gruppe geht. Ohne Befehl bleibt sie einfach stehen. Das ist in Ordnung.',
    anchor: '.shield', manual: true,
  },
  {
    id: 'bewegen', von: 'Harms', title: 'Erster Befehl: Bewegen',
    text: 'Unten ist jetzt „Bewegen“ (B). Gruppe wählen, Bewegen antippen, dann ein Feld hinter dem blauen Graben.',
    anchor: '[data-tool="move"]', tools: ['move', 'hold'], done: (a) => hasOrder(a, ['move', 'redeploy']),
  },
  {
    id: 'zurueck', von: 'Harms', title: 'Vertippt?',
    text: '„Zurück“ nimmt den letzten Befehl zurück. Bis du die Runde startest, kannst du alles ändern.',
    anchor: '[data-undo]', manual: true,
  },
  {
    id: 'graben', von: 'Selin', title: 'Neuer Befehl: Graben',
    text: 'Gruppe wählen, „Graben“ (G) antippen und eine Linie ziehen. Bietet das Kärtchen „Traversen einfügen“ an: ja.',
    anchor: '[data-tool="dig"]', tools: ['dig'], done: (a) => hasOrder(a, ['dig']),
  },
  {
    id: 'mg', von: 'Harms', title: 'Neuer Befehl: Feuern',
    text: 'Wähl das Kästchen „MG“, dann „Feuern“ (F), dann ein Feld vor dem Graben. Das MG hält dort jeden nieder.',
    anchor: '[data-tool="fire"]', tools: ['fire'], done: (a) => hasOrder(a, ['sector', 'fire']),
  },
  {
    id: 'runde', von: 'Harms', title: 'Los geht es',
    text: 'Tipp „Runde ausführen“. Der Gegner plant gleichzeitig, dann passiert alles auf einmal.',
    anchor: '.exec', done: (a, s) => a.state.turn > s.turn,
  },
  {
    id: 'film', von: 'Harms', title: 'Was passiert ist',
    text: 'Die Runde lief als kurzer Film. Im Telegramm steht jede Meldung mit Grund. Antippen zeigt die Stelle.',
    manual: true,
  },
  {
    id: 'liste', von: 'Harms', title: 'Was noch offen ist',
    text: '„Vor der Runde“ zeigt, was du noch tun könntest. Nichts davon ist Pflicht. Auf dem Handy: oben auf die Leiste tippen.',
    anchor: '.check', show: ['check'], manual: true,
  },
  {
    id: 'loren', von: 'Selin', title: 'Neuer Befehl: Lorenplan',
    text: 'Die Feldbahn bringt Munition und Essen nach vorn. Öffne „Lorenplan“ (L) und sieh ihn dir an.',
    anchor: '[data-tool="supply"]', tools: ['supply'], done: (a) => a.toolInfo?.id === 'supply' || !!a.plans?.[a.side]?.supply_plan,
  },
  {
    id: 'lehrling', von: 'Harms', title: 'Hilfe holen',
    text: 'Nicht sicher? Der „Lehrling“ (T) schlägt vor, was du tun könntest. Auf dem Handy steht er in der Leiste oben.',
    anchor: '.lr-btn', show: ['lehrling'], manual: true,
  },
  {
    id: 'fertig', von: 'Harms', title: 'Geschafft',
    text: 'Spiel ruhig weiter. Die Kampagne bringt die übrigen Befehle nach und nach, jeden mit einer kurzen Erklärung.',
    final: true,
  },
];

/** Stufe nach der Grundausbildung (js/unlocks.js): Bewegen, Graben, Feuer, Draht, Deckung, Versorgung */
export const DRILL_LEVEL = 3;

/** Befehle und Kaertchen bis einschliesslich Schritt i */
export function drillUnlocks(steps, i) {
  const upto = steps.slice(0, Math.max(0, i) + 1);
  return { tools: upto.flatMap((s) => s.tools ?? []), show: upto.flatMap((s) => s.show ?? []) };
}

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
