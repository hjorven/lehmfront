// Namen fuer die Gefallenenliste (Plan 2.5) aus dem Ereignisprotokoll einer Mission.
// Rein: kein DOM, kein Date, kein Math.random. Gleiche Mission, gleicher Seed -> dieselben Namen.
//
// Das Spiel fuehrt Gruppen mit Staerke und nur den Gruppenfuehrer mit Namen. Fuer die Liste bekommt jeder
// Ausfall einen Namen aus data/names.json, deterministisch aus Seed, Runde, Gruppe und laufender Nummer.
//   - 'losses' (P05 Feuer, spaeter Nahkampf, Artillerie): amount Ausfaelle; davon sind 'wounded' derselben
//     Gruppe und Runde (P08) verwundet, der Rest gefallen
//   - 'group_lost': die Gruppe ist aufgerieben, der Gruppenfuehrer ist der letzte Name der Gruppe
//   - 'wounded_waiting' mit died (P08): Verwundete, die im Unterstand sterben
// Neue Ereignisarten melden sich mit registerCasualtySource an.
import { createRng } from '../rng.js';
import { NAMES } from '../config/names.js';
import { hashText } from './texts.js';

/** Hauptfiguren und erzaehlte Tote werden nie zufaellig vergeben */
const STORY_NAMES = new Set(['Ilse Brandt', 'Otto Harms', 'Jost Vell', 'Tjark Boysen', 'Folkert Ubben', 'Hinrich Tiedemann', 'Maren Tiedemann', 'Teodor Lask', 'Ruta Lask', 'Mira Selin']);
// Nachnamen von Figuren der Geschichte: ein zufaelliger "Maren Boysen" waere eine falsche Spur
const STORY_SURNAMES = new Set(['Brandt', 'Harms', 'Vell', 'Lask', 'Selin', 'Boysen', 'Ubben', 'Tiedemann', 'Fedders', 'Aurach', 'Kalnis']);

const CAUSES = {
  enfilade: 'Längsfeuer',
  reversed: 'Feuer in den eroberten Graben',
  mg: 'MG-Feuer',
  fire: 'Gewehrfeuer',
  artillery: 'Granatsplitter',
  shell: 'Granatsplitter',
  melee: 'Nahkampf',
  gas: 'Gas',
  mine: 'Sprengung',
  wounds: 'Verwundung, keine Lore',
  lost: 'aufgerieben',
};

export function causeText(cause) {
  return CAUSES[cause] ?? 'gefallen';
}

const sources = new Map();

/**
 * Weitere Ereignisart als Quelle von Gefallenen: fn(event, helpers) -> [{ group, count, cause }]
 * helpers.woundedFor(group) liefert die Verwundeten derselben Runde.
 */
export function registerCasualtySource(type, fn) {
  sources.set(type, fn);
}

registerCasualtySource('losses', (e, h) => {
  if (!(e.amount > 0) || !e.group) return [];
  const wounded = Math.min(e.amount, h.takeWounded(e.group));
  return [
    { group: e.group, count: e.amount - wounded, cause: e.cause ?? 'fire', kind: 'fallen' },
    { group: e.group, count: wounded, cause: e.cause ?? 'fire', kind: 'wounded' },
  ];
});
registerCasualtySource('wounded_waiting', (e) => (e.died > 0 ? [{ group: e.group ?? null, count: e.died, cause: 'wounds', kind: 'fallen' }] : []));

function surnameOf(n) {
  const i = n.lastIndexOf(' ');
  return i < 0 ? n : n.slice(i + 1);
}

/** Erzeugt einen Soldatennamen, der noch nicht vergeben ist */
export function makeSoldierName(rng, factionId, used) {
  const pool = NAMES[factionId] ?? NAMES.kaldern;
  const first = [...pool.first, ...(pool.firstWomen ?? [])];
  const lasts = [...pool.last, ...(pool.soldierLast ?? [])];
  for (let i = 0; i < 60; i++) {
    const last = lasts[Math.floor(rng() * lasts.length)];
    const name = first[Math.floor(rng() * first.length)] + ' ' + last;
    if (STORY_NAMES.has(name) || STORY_SURNAMES.has(last) || (pool.reserved ?? []).includes(name) || used.has(name)) continue;
    used.add(name);
    return { name, home: pool.homes[Math.floor(rng() * pool.homes.length)] };
  }
  const name = first[Math.floor(rng() * first.length)] + ' ' + lasts[Math.floor(rng() * lasts.length)] + ' (' + (used.size + 1) + ')';
  used.add(name);
  return { name, home: pool.homes[Math.floor(rng() * pool.homes.length)] };
}

/**
 * Gefallene und Verwundete einer Mission mit Namen.
 * rounds: [{ turn, log }] (z. B. archive.rounds), opts: { side, faction, seed, mission, groups: { id: { label, leader, home } }, used? }
 * Liefert { fallen: [...], wounded: [...] }, je { name, home, group, groupLabel, turn, cause, causeText, at, leader? }
 */
export function rollCasualties(rounds, opts) {
  const { side, faction = 'kaldern', seed = 0, mission = '', groups = {} } = opts;
  const used = new Set(opts.used ?? []);
  for (const g of Object.values(groups)) if (g.leader) used.add(g.leader);
  const fallen = [];
  const wounded = [];
  const sorted = [...rounds].sort((a, b) => a.turn - b.turn);
  for (const r of sorted) {
    const log = (r.log ?? []).filter((e) => e.side === side);
    // Verwundete dieser Runde je Gruppe (aus P08), werden beim passenden 'losses' abgezogen
    const woundedLeft = new Map();
    for (const e of log) if (e.type === 'wounded' && e.group) woundedLeft.set(e.group, (woundedLeft.get(e.group) ?? 0) + (e.count ?? 0));
    const helpers = {
      takeWounded(group) {
        const n = woundedLeft.get(group) ?? 0;
        woundedLeft.set(group, 0);
        return n;
      },
    };
    const lostGroups = new Set(log.filter((e) => e.type === 'group_lost').map((e) => e.group));
    log.forEach((e, idx) => {
      const fn = sources.get(e.type);
      if (!fn) return;
      for (const c of fn(e, helpers)) {
        if (!(c.count > 0)) continue;
        const g = groups[c.group] ?? {};
        const rng = createRng(hashText(`${seed}|${mission}|${r.turn}|${idx}|${c.group}|${c.kind}`));
        for (let i = 0; i < c.count; i++) {
          const isLast = c.kind === 'fallen' && lostGroups.has(c.group) && i === c.count - 1 && g.leader && !used.has('#' + c.group);
          let person;
          if (isLast) {
            used.add('#' + c.group);
            person = { name: g.leader, home: g.home ?? '', leader: true };
          } else person = makeSoldierName(rng, faction, used);
          const entry = {
            ...person,
            group: c.group,
            groupLabel: g.label ?? (c.group ? c.group : 'Abschnitt'),
            turn: r.turn,
            cause: c.cause,
            causeText: causeText(c.cause),
            at: e.at ? { x: e.at.x, y: e.at.y } : null,
          };
          (c.kind === 'wounded' ? wounded : fallen).push(entry);
        }
      }
    });
    // Aufgeriebene Gruppe ohne eigenes 'losses' in dieser Runde: Fuehrer trotzdem eintragen
    for (const id of [...lostGroups].sort()) {
      if (used.has('#' + id)) continue;
      const g = groups[id] ?? {};
      if (!g.leader) continue;
      used.add('#' + id);
      const ev = log.find((e) => e.type === 'group_lost' && e.group === id);
      fallen.push({ name: g.leader, home: g.home ?? '', leader: true, group: id, groupLabel: g.label ?? id, turn: r.turn, cause: 'lost', causeText: causeText('lost'), at: ev?.at ?? null });
    }
  }
  return { fallen, wounded };
}

/** Gruppen-Steckbriefe fuer rollCasualties aus einem Spielzustand (Nummern wie in der Oberflaeche) */
export function groupInfoFrom(state, side) {
  const own = state.groups.filter((g) => g.side === side).map((g) => g.id).sort();
  const out = {};
  for (const g of state.groups) {
    if (g.side !== side) continue;
    out[g.id] = { label: `${own.indexOf(g.id) + 1}. Gruppe`, leader: g.leader?.name ?? null, home: g.leader?.home ?? '', type: g.type };
  }
  return out;
}

/** Erzaehlte Tote aus festen Texten (data/texts/README.md: Boysen und Ubben in a2m2) */
export const FIXED_DEATHS = [
  { after: 'a2m2', name: 'Tjark Boysen', home: 'Wessel', groupLabel: '2. Gruppe', cause: 'mine', causeText: 'Stollen eingestürzt' },
  { after: 'a2m2', name: 'Folkert Ubben', home: 'Kelling', groupLabel: 'Pioniere', cause: 'mine', causeText: 'Stollen eingestürzt' },
];

export function fixedDeathsAfter(missionId) {
  return FIXED_DEATHS.filter((d) => d.after === missionId).map((d) => ({ ...d, group: null, turn: null, at: null, story: true }));
}
