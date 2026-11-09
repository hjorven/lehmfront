// Ziele fuer Puzzle-Lagen und selbstgebaute Missionen (P25). Rein: kein DOM, kein Date, kein Math.random.
//
// Ziel (goal) als Daten, Koordinaten 0-basiert, Seite a ist der Spieler:
//   { type: 'take', cells: [[x,y],...] }        Grabenfelder in eigener Hand, kein Feind daneben
//   { type: 'destroy', groups: ['b01'] | 'all' } feindliche Gruppen aufgerieben oder gefangen
//   { type: 'reach', cells: [[x,y],...], group?, unseen? }  eine (bestimmte) Gruppe steht auf einem der Felder;
//                                                 unseen: kein Feind darf sie am Ende einer Runde gesehen haben
//   { type: 'hold', cells: [[x,y],...] }         die Felder bis zum Ende der Frist halten
//   { type: 'dig', from: [x,y], to: [x,y], maxRun? }  durchgehender eigener Graben von A nach B, keine Gerade
//                                                 laenger als maxRun (Laengsfeuer, Standard ENFILADE_RUN - 1)
// Zusaetzlich: limit (Runden), maxLosses (eigene Ausfaelle in Mann), keep: ['a01'] (muessen leben).
// par: { rounds, losses } fuer den Stempel "Sauber gelöst".
import { cellAt, cellLabel, distance } from '../map.js';
import { visibleEnemies } from '../sight.js';
import { straightRuns, ENFILADE_RUN } from '../trench.js';

const toXY = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });
const alive = (g) => g && g.status !== 'lost';

/** Graben eines Feldes mit Zustand (state.cells ueberschreibt die Karte) */
export function liveTrench(state, map, x, y) {
  const o = state.cells[x + ',' + y];
  if (o && Object.hasOwn(o, 'trench')) return o.trench;
  return cellAt(map, x, y)?.trench ?? null;
}

/** Eigene Ausfaelle (Mann) seit dem Start: Staerke vorher minus jetzt, Gruppen nach ID */
export function lossesSince(start, state, side = 'a') {
  let n = 0;
  for (const g0 of start.groups) {
    if (g0.side !== side) continue;
    const g = state.groups.find((x) => x.id === g0.id);
    n += Math.max(0, g0.strength - (g ? g.strength : 0));
  }
  return n;
}

function cellsHeld(state, map, cells, side = 'a', strict = true) {
  const ms = side === 'a' ? 'own' : 'enemy';
  const foes = state.groups.filter((g) => g.side !== side && alive(g));
  const own = state.groups.filter((g) => g.side === side && alive(g));
  return cells.map(toXY).every((c) => {
    const t = liveTrench(state, map, c.x, c.y);
    const occupied = own.some((g) => g.pos.x === c.x && g.pos.y === c.y);
    const ours = t ? t.side === ms : occupied;
    // strict (Nehmen): kein Feind daneben; Halten: nur kein Feind auf dem Feld
    return ours && (occupied || t) && !foes.some((f) => distance(f.pos, c) <= (strict ? 1 : 0));
  });
}

/** Eigene Grabenfelder (8er-Nachbarn) von A nach B verbunden? Liefert die Feldfolge (BFS, feste Reihenfolge) oder null */
export function trenchPath(state, map, from, to, side = 'a') {
  const ms = side === 'a' ? 'own' : 'enemy';
  const a = toXY(from), b = toXY(to);
  const ok = (x, y) => { const t = liveTrench(state, map, x, y); return t && t.side === ms && !t.captured; };
  if (!ok(a.x, a.y) || !ok(b.x, b.y)) return null;
  const prev = new Map([[a.x + ',' + a.y, null]]);
  const queue = [a];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    if (c.x === b.x && c.y === b.y) {
      const path = [];
      for (let k = c.x + ',' + c.y; k; k = prev.get(k)) { const [x, y] = k.split(',').map(Number); path.unshift({ x, y }); }
      return path;
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      const x = c.x + dx, y = c.y + dy;
      const k = x + ',' + y;
      if (prev.has(k) || !ok(x, y)) continue;
      prev.set(k, c.x + ',' + c.y);
      queue.push({ x, y });
    }
  }
  return null;
}

/** Laengste Gerade aus Feuergraben-Feldern der Seite (alle vier Achsen), fuer das Graben-Ziel */
export function longestFireRun(state, map, side = 'a') {
  const ms = side === 'a' ? 'own' : 'enemy';
  const fire = (x, y) => { const t = liveTrench(state, map, x, y); return t && t.side === ms && t.kind === 'fire'; };
  let best = 0;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!fire(x, y)) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        if (fire(x - dx, y - dy)) continue; // nur am Anfang einer Geraden zaehlen
        let n = 0;
        while (fire(x + dx * n, y + dy * n)) n++;
        best = Math.max(best, n);
      }
    }
  }
  return best;
}

/** Text des Ziels fuer Briefing und Kaertchen */
export function goalText(goal) {
  const cells = (goal.cells ?? []).map(toXY);
  const where = cells.length === 1 ? `Feld ${cellLabel(cells[0].x, cells[0].y)}` : `${cells.length} Felder`;
  switch (goal.type) {
    case 'take': return `Grabenstück nehmen: ${where}, kein Feind daneben.`;
    case 'destroy': return goal.groups === 'all' ? 'Alle feindlichen Gruppen ausschalten.' : `${goal.groups.length === 1 ? 'Die markierte Gruppe' : 'Die markierten Gruppen'} ausschalten.`;
    case 'reach': return `${goal.unseen ? 'Ungesehen ' : ''}${where} erreichen.`;
    case 'hold': return `${where} bis zum Ende halten.`;
    case 'dig': return `Graben von ${cellLabel(toXY(goal.from).x, toXY(goal.from).y)} nach ${cellLabel(toXY(goal.to).x, toXY(goal.to).y)} ziehen, keine Gerade über ${goal.maxRun ?? ENFILADE_RUN - 1} Felder.`;
    default: return 'Ziel unbekannt.';
  }
}

/** Ist das Ziel jetzt erfuellt? (ohne Frist und Nebenbedingungen) */
export function goalMet(goal, { state, map }) {
  switch (goal.type) {
    case 'take': return cellsHeld(state, map, goal.cells);
    case 'destroy': {
      const foes = state.groups.filter((g) => g.side === 'b');
      const ids = goal.groups === 'all' ? foes.map((g) => g.id) : goal.groups;
      return ids.every((id) => !alive(foes.find((g) => g.id === id)));
    }
    case 'reach': {
      const cells = goal.cells.map(toXY);
      return state.groups.some((g) => g.side === 'a' && alive(g) && (!goal.group || g.id === goal.group)
        && cells.some((c) => c.x === g.pos.x && c.y === g.pos.y));
    }
    case 'hold': return false; // erst am Ende der Frist
    case 'dig': {
      const path = trenchPath(state, map, goal.from, goal.to);
      if (!path) return false;
      const max = goal.maxRun ?? ENFILADE_RUN - 1;
      return straightRuns(path).every((r) => r.length <= max) && longestFireRun(state, map) <= max;
    }
    default: return false;
  }
}

/**
 * Stand einer Lage nach einer Runde.
 * p: Lage mit goal, limit, maxLosses?, keep?, par?; start: Startzustand; state: jetzt; rounds: aufgeloeste Runden;
 * seen: wurde eine eigene Gruppe bisher gesehen? (fuer unseen; der Aufrufer fuehrt es mit seenNow fort)
 * Rueckgabe { status: 'running'|'won'|'lost', why, losses, rounds, clean }
 */
export function judgeGoal(p, { start, state, map, rounds, seen = false }) {
  const goal = p.goal;
  const losses = lossesSince(start, state, 'a');
  const base = { losses, rounds };
  const own = state.groups.filter((g) => g.side === 'a');
  if (!own.some(alive)) return { ...base, status: 'lost', why: 'Alle eigenen Gruppen sind ausgefallen.' };
  for (const id of p.keep ?? []) {
    const g = own.find((x) => x.id === id);
    if (!alive(g)) return { ...base, status: 'lost', why: `${id === p.keepName?.id ? p.keepName.text : 'Eine Gruppe, auf die es ankam,'} ist ausgefallen.` };
  }
  if (Number.isFinite(p.maxLosses) && losses > p.maxLosses) {
    return { ...base, status: 'lost', why: `Zu hohe Verluste: ${losses} Mann, erlaubt waren ${p.maxLosses}.` };
  }
  if (goal.type === 'reach' && goal.unseen && seen) return { ...base, status: 'lost', why: 'Der Gegner hat die Gruppe gesehen. Die Überraschung ist dahin.' };
  // Halten ist auch erfuellt, wenn vom Gegner niemand mehr steht
  const foesLeft = state.groups.some((g) => g.side === 'b' && alive(g));
  const held = () => cellsHeld(state, map, goal.cells, 'a', false);
  const met = goal.type === 'hold' ? (rounds >= p.limit || !foesLeft) && held() : goalMet(goal, { state, map });
  if (met) {
    const par = p.par ?? {};
    const clean = (!Number.isFinite(par.rounds) || rounds <= par.rounds) && (!Number.isFinite(par.losses) || losses <= par.losses);
    return { ...base, status: 'won', why: p.wonText ?? 'Ziel erreicht.', clean };
  }
  if (goal.type === 'hold' && !cellsHeld(state, map, goal.cells, 'a', false)) return { ...base, status: 'lost', why: 'Die Stellung ist verloren.' };
  if (rounds >= p.limit) return { ...base, status: 'lost', why: `Die Frist ist um: ${p.limit} ${p.limit === 1 ? 'Runde' : 'Runden'}, das Ziel ist nicht erreicht.` };
  return { ...base, status: 'running', why: '' };
}

/** Sieht der Gegner (Seite b) am Ende dieser Runde eine eigene Gruppe? (fuer unseen) */
export function seenNow(goal, state, map) {
  if (goal.type !== 'reach' || !goal.unseen) return false;
  const vis = new Set(visibleEnemies(state, map, 'b'));
  return state.groups.some((g) => g.side === 'a' && alive(g) && (!goal.group || g.id === goal.group) && vis.has(g.id));
}
