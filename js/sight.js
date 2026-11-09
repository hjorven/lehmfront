// Sicht, Deckung und Feuersektoren (Plan 4.1 Nr. 5 und 7, 7.4, 10.6). Rein: kein DOM, kein Date, kein Math.random.
// Grundlage fuer view.js (Nebel des Krieges), js/phases/fire.js (Feuer) und die Vorschau im Werkzeug Feuern.
//
// Regeln (erste Fassung, Werte in Feldern zu 10 Metern):
// - Sichtweite am Tag 12 Felder (Beobachter 14). Wer hoeher steht als das Ziel, sieht je Stufe 1 Feld weiter,
//   Beobachter 3 Felder (Plan: "Hoehe gibt Beobachtern Reichweite").
// - Dunkelheit kuerzt die Sichtweite mit demselben Faktor wie die Trefferchance (rules.visibilityFromDarkness).
// - Wer in Deckung liegt (Graben, Krater, Wald, Dorf) und sich in dieser Runde nicht bewegt hat, wird nur auf
//   zwei Drittel der Sichtweite erkannt und zeigt ueber Hindernisse weniger Profil.
// - Muendungsfeuer verraet: wer in dieser Runde gefeuert hat, ist auf volle Tagessicht erkennbar, auch nachts.
// - Im Unterstand sieht eine Gruppe nur das Nachbarfeld und wird nur von dort erkannt.
// - Sichtlinie mit Hoehe ueber map.lineOfSight. Ohne Gelaende (Testkarten ohne cells) zaehlt nur die Entfernung.
import { unitType } from './config/units.js';
import { cellAt, lineOfSight, distance, TERRAIN, DIRS } from './map.js';
import { COVER, visibilityFromDarkness } from './rules.js';
import { darknessAt } from './ui/daytime.js';
import { groupsOf, otherSide, getCell } from './state.js';
import { sightDarkness, flareAt } from './weather.js';

export const BASE_SIGHT = 12;
export const HEIGHT_SIGHT = 1;
export const OBSERVER_HEIGHT_SIGHT = 3;
/** Ab dieser Unterdrueckung gilt eine Gruppe als niedergehalten (feuert nicht von selbst, halbe Bewegung) */
export const PINNED = 0.75;

/** Grabenstufe -> Deckungsart (Stufe 0 = Schuetzenloch, P04 kann sie anlegen) */
export const TRENCH_COVER = ['foxhole', 'trench', 'trench_improved', 'trench_concrete'];

export const COVER_NAMES = {
  open: 'offenes Feld',
  crater: 'Trichter',
  foxhole: 'Schützenloch',
  trench: 'Graben',
  trench_improved: 'ausgebauter Graben',
  trench_concrete: 'betonierter Graben',
};

function hasTerrain(map) {
  return !!(map && Array.isArray(map.cells));
}

/**
 * Dunkelheit 0..1 fuer die Sichtregeln: Tageszeit (dieselbe Zahl wie die Optik, Plan 7.7) plus Wetter.
 * Bei klarem Wetter ist sie gleich der Tageszeit; Nebel und Regen kuerzen die Sicht zusaetzlich (js/weather.js).
 */
export function darknessOf(state) {
  return sightDarkness(darknessAt(state.clock, state.turnKind, state.night), state.weather);
}

/** Dunkelheit an einem Feld: im Kreis einer Leuchtkugel ist es taghell (nur das Wetter bleibt) */
export function darknessAtCell(state, p, darkness) {
  return state && flareAt(state, p) ? Math.min(darkness, sightDarkness(0, state.weather)) : darkness;
}

export function heightOf(map, p) {
  const c = hasTerrain(map) ? cellAt(map, p.x, p.y) : null;
  return c ? c.height : 0;
}

/** Kartenseite einer Spielseite: Seite a spielt die eigene ("own") Kartenhaelfte */
function mapSide(side) {
  return side === 'a' ? 'own' : 'enemy';
}

/** Graben eines Feldes: Spielzustand vor Karte (P04 legt neue Graeben in state.cells an, null = zugeschuettet) */
export function trenchAt(state, map, x, y) {
  const s = state ? getCell(state, x, y) : null;
  if (s && Object.hasOwn(s, 'trench')) return s.trench;
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  return c?.trench ?? null;
}

function craterAt(state, map, x, y) {
  const s = state ? getCell(state, x, y) : null;
  if (s && Object.hasOwn(s, 'crater')) return s.crater > 0;
  const c = hasTerrain(map) ? cellAt(map, x, y) : null;
  return (c?.crater ?? 0) > 0;
}

/**
 * Deckung auf einem Feld fuer eine Gruppe der Seite side.
 * Liefert { cover, reversed, label, trench }: die beste Deckung des Feldes. reversed = eroberter Graben
 * (Schuetzenauftritt zeigt zum falschen Gegner, halbe Deckung bis "Umbauen").
 */
export function coverAt(state, map, pos, side) {
  let best = { cover: 'open', reversed: false, label: COVER_NAMES.open, trench: null };
  const better = (cover, extra) => {
    if ((COVER[cover] ?? 0) > (COVER[best.cover] ?? 0)) best = { cover, reversed: false, label: COVER_NAMES[cover], trench: null, ...extra };
  };
  const c = hasTerrain(map) ? cellAt(map, pos.x, pos.y) : null;
  if (c) {
    const t = TERRAIN[c.terrain];
    if (t && t.cover !== 'open') better(t.cover, { label: t.name });
  }
  if (craterAt(state, map, pos.x, pos.y)) better('crater');
  // Minentrichter (P23): der aufgeworfene Rand eines Sprengtrichters deckt wie ein Schuetzenloch
  if (state?.cells?.[pos.x + ',' + pos.y]?.trichter) better('foxhole', { label: 'Trichterrand' });
  const tr = trenchAt(state, map, pos.x, pos.y);
  if (tr) {
    // Stufen 1 bis 4 (P04: Schuetzenloch, Graben, ausgebaut, betoniert)
    const level = Math.max(1, Math.min(4, tr.level ?? 2));
    const cover = TRENCH_COVER[level - 1];
    // Fremder Graben oder eroberter, noch nicht umgebauter (P04: captured) gibt halbe Deckung
    const reversed = side != null && tr.side != null && (tr.side !== mapSide(side) || tr.captured === true);
    // Ein eroberter Graben zaehlt mit seiner halben Deckung gegen Krater und Wald
    const eff = (COVER[cover] ?? 0) * (reversed ? 0.5 : 1);
    if (eff > (COVER[best.cover] ?? 0) * (best.reversed ? 0.5 : 1)) {
      best = { cover, reversed, label: COVER_NAMES[cover] + (reversed ? ' (erobert, nicht umgebaut)' : ''), trench: tr };
    }
  }
  return best;
}

/** Liegt die Gruppe verborgen in Deckung? (nicht bewegt, nicht im offenen Feld) */
export function isConcealed(state, map, group) {
  if (group.moved) return false;
  return coverAt(state, map, group.pos, group.side).cover !== 'open';
}

/**
 * Sichtweite eines Beobachters auf ein Ziel in Feldern.
 * opts: concealed (Ziel in Deckung), flash (Ziel hat gefeuert), dugout (Ziel im Unterstand)
 */
export function sightRange(map, viewer, targetPos, darkness, { concealed = false, flash = false, dugout = false } = {}) {
  if (viewer.inDugout || (dugout && !flash)) return 1;
  const t = unitType(viewer.type);
  let r = t.sight ?? BASE_SIGHT;
  const dh = heightOf(map, viewer.pos) - heightOf(map, targetPos);
  if (dh > 0) r += dh * (viewer.type === 'observers' ? OBSERVER_HEIGHT_SIGHT : HEIGHT_SIGHT);
  if (concealed && !flash) r = Math.floor((r * 2) / 3);
  const vis = flash ? 1 : visibilityFromDarkness(darkness);
  return Math.max(1, Math.floor(r * vis));
}

/**
 * Sieht viewer die Gruppe target? Liefert { visible, d, range, blockedAt, cells }.
 */
export function spot(state, map, viewer, target, darkness) {
  const d = distance(viewer.pos, target.pos);
  const concealed = isConcealed(state, map, target);
  const dk = darknessAtCell(state, target.pos, darkness);
  const range = sightRange(map, viewer, target.pos, dk, { concealed, flash: !!target.fired, dugout: !!target.inDugout });
  if (d > range) return { visible: false, d, range, blockedAt: null, cells: [] };
  if (d <= 1 || !hasTerrain(map)) return { visible: true, d, range, blockedAt: null, cells: [] };
  const los = lineOfSight(map, viewer.pos, target.pos, { eye: 1, target: concealed ? 0 : 1 });
  return { visible: los.visible, d, range, blockedAt: los.blockedAt, cells: los.cells };
}

/**
 * Sieht viewer das Feld p? concealed: so tief schauen, dass auch eine Gruppe in Deckung dort erkannt wuerde.
 */
export function seesCellFrom(map, viewer, p, darkness, { concealed = false } = {}) {
  const d = distance(viewer.pos, p);
  const range = sightRange(map, viewer, p, darkness, { concealed });
  if (d > range) return false;
  if (d <= 1 || !hasTerrain(map)) return true;
  return lineOfSight(map, viewer.pos, p, { eye: 1, target: concealed ? 0 : 1 }).visible;
}

/** Sieht irgendeine einsatzfaehige Gruppe der Seite das Feld p? */
export function sideSeesCell(state, map, side, p, darkness = darknessOf(state), opts = {}) {
  const dk = darknessAtCell(state, p, darkness);
  return groupsOf(state, side).some((g) => seesCellFrom(map, g, p, dk, opts));
}

/** IDs aller feindlichen Gruppen, die die Seite sieht (sortiert) */
export function visibleEnemies(state, map, side, darkness = darknessOf(state)) {
  const own = groupsOf(state, side);
  return groupsOf(state, otherSide(side))
    .filter((t) => own.some((v) => spot(state, map, v, t, darkness).visible))
    .map((t) => t.id);
}

/**
 * Sichtbare Felder einer Seite als Uint8Array (Index y * width + x). Fuer das Sicht-Overlay.
 */
export function visibleCells(state, map, side, darkness = darknessOf(state)) {
  const w = map.width, h = map.height;
  const out = new Uint8Array(w * h);
  for (const g of groupsOf(state, side)) {
    // Mit Leuchtkugeln reicht der Blick in deren Kreis so weit wie am Tag
    const scan = state?.flares?.length ? Math.min(darkness, sightDarkness(0, state.weather)) : darkness;
    const r = sightRange(map, g, g.pos, scan) + (g.type === 'observers' ? 3 * OBSERVER_HEIGHT_SIGHT : 3);
    for (let y = Math.max(0, g.pos.y - r); y <= Math.min(h - 1, g.pos.y + r); y++) {
      for (let x = Math.max(0, g.pos.x - r); x <= Math.min(w - 1, g.pos.x + r); x++) {
        const i = y * w + x;
        if (!out[i] && seesCellFrom(map, g, { x, y }, darknessAtCell(state, { x, y }, darkness))) out[i] = 1;
      }
    }
  }
  return out;
}

// ---------- Richtungen ----------

/** Grobe Himmelsrichtung von a nach b (8 Richtungen, ganzzahlig), null bei gleichem Feld */
export function directionOf(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!dx && !dy) return null;
  const ax = Math.abs(dx), ay = Math.abs(dy);
  let ix = 0, iy = 0;
  const sx = (dx > 0) - (dx < 0), sy = (dy > 0) - (dy < 0);
  if (ax > 2 * ay) ix = sx;
  else if (ay > 2 * ax) iy = sy;
  else { ix = sx; iy = sy; }
  return DIRS.find((d) => d.dx === ix && d.dy === iy);
}

// ---------- Feuersektor (MG) ----------

/** cos^2 des halben Kegelwinkels als Bruch [Zaehler, Nenner], damit der Test ohne Winkelfunktionen auskommt */
// Schluessel = halber Kegelwinkel in Grad
const COS2_HALF = { 15: [0.9330127018922193, 1], 22.5: [0.8535533905932737, 1], 30: [3, 4], 45: [1, 2], 60: [1, 4] };

/** Zielpunkt des Feuersektors: gesetzter Sektor, sonst geradeaus in Blickrichtung */
export function sectorOf(group) {
  const t = unitType(group.type);
  if (!t.sector) return null;
  const width = t.sector;
  if (group.sector && Number.isInteger(group.sector.x) && Number.isInteger(group.sector.y)
    && (group.sector.x !== group.pos.x || group.sector.y !== group.pos.y)) {
    return { aim: { x: group.sector.x, y: group.sector.y }, width, range: t.range };
  }
  const f = String(group.facing ?? (group.side === 'a' ? 'e' : 'w')).toUpperCase();
  const d = DIRS.find((x) => x.id === f) ?? DIRS[2];
  return { aim: { x: group.pos.x + d.dx * t.range, y: group.pos.y + d.dy * t.range }, width, range: t.range };
}

/** Liegt p im Kegel von from Richtung aim (Breite in Grad, Reichweite in Feldern)? */
export function inCone(from, aim, p, width, range = Infinity) {
  const vx = aim.x - from.x, vy = aim.y - from.y;
  const wx = p.x - from.x, wy = p.y - from.y;
  if (!wx && !wy) return false;
  if (wx * wx + wy * wy > range * range) return false;
  const dot = vx * wx + vy * wy;
  if (dot <= 0) return false;
  const [n, m] = COS2_HALF[width / 2] ?? COS2_HALF[30];
  return dot * dot * m >= n * (vx * vx + vy * vy) * (wx * wx + wy * wy);
}

/** Sichtlinie fuer die Anzeige beim Zeigen: { from, to, blockedAt, d, range, visible } */
export function sightLine(map, viewer, p, darkness, state = null) {
  darkness = darknessAtCell(state, p, darkness);
  const d = distance(viewer.pos, p);
  const range = sightRange(map, viewer, p, darkness);
  const los = hasTerrain(map) && d > 1 ? lineOfSight(map, viewer.pos, p, { eye: 1, target: 1 }) : { visible: true, blockedAt: null };
  const hidden = sightRange(map, viewer, p, darkness, { concealed: true });
  return { from: { ...viewer.pos }, to: { x: p.x, y: p.y }, blockedAt: los.blockedAt, d, range, hidden, visible: los.visible && d <= range };
}
