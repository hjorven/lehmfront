// Selbstgebaute Lagen als teilbarer Code (P25, Missionseditor). Eine Lage ist JSON:
//   { v: 1, title, author?, brief?, map: <Kartenblatt>, scenario: <Szenario>, goal?, limit?, maxLosses?, kind? }
// Der Code ist "L1." + base64url(deflate-raw(JSON)). Kein Server noetig: der Code passt in eine Adresse
// (?scene=gefecht&lage=<code>). Teilen ueber Supabase kommt mit P20 dazu.
// Rein bis auf CompressionStream (Browser und Node ab 18), kein DOM.
import { loadMap } from '../map.js';
import { createInitialState } from '../state.js';

export const LAGE_VERSION = 1;
export const CODE_PREFIX = 'L1.';
/** Groesste Karte im Editor (Felder je Seite), damit Codes und Handys mitkommen */
export const MAX_SIDE = 60;

function toB64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function fromB64url(text) {
  const b = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

async function pipe(bytes, stream) {
  const res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Lage pruefen: Karte laedt, Szenario passt (Gruppen auf der Karte, auf begehbaren Feldern, je Seite mindestens eine).
 * Liefert eine Liste deutscher Fehler (leer = in Ordnung).
 */
export function lageProblems(lage) {
  const out = [];
  if (!lage || typeof lage !== 'object') return ['Keine Lage.'];
  let map = null;
  try { map = loadMap(lage.map); } catch (e) { out.push(e.message); return out; }
  if (map.width > MAX_SIDE || map.height > MAX_SIDE) out.push(`Karte zu groß (höchstens ${MAX_SIDE} × ${MAX_SIDE}).`);
  const sc = lage.scenario;
  for (const s of ['a', 'b']) {
    const list = sc?.sides?.[s]?.groups ?? [];
    if (!list.length) out.push(s === 'a' ? 'Die eigene Seite hat keine Gruppe.' : 'Drüben steht niemand.');
    for (const g of list) {
      if (!Number.isInteger(g?.pos?.x) || !Number.isInteger(g?.pos?.y)) { out.push('Eine Gruppe hat keinen Standort.'); continue; }
      const c = g.pos.x >= 0 && g.pos.x < map.width ? map.cells[g.pos.y * map.width + g.pos.x] : null;
      if (!c) { out.push(`Gruppe außerhalb der Karte bei ${g.pos.x + 1}/${g.pos.y + 1}.`); continue; }
      if (c.terrain === 'wasser' || c.building) out.push(`Gruppe auf unbegehbarem Feld ${g.pos.x + 1}/${g.pos.y + 1}.`);
    }
    const keys = new Set(list.map((g) => g?.pos?.x + ',' + g?.pos?.y));
    if (keys.size !== list.length) out.push('Zwei Gruppen stehen auf demselben Feld.');
  }
  if (out.length) return out;
  try { createInitialState(map, sc, 1); } catch (e) { out.push(e.message); }
  if (lage.goal) out.push(...goalProblems(lage.goal, map));
  if (lage.goal && !(lage.limit >= 1)) out.push('Ein Ziel braucht eine Frist.');
  return out;
}

const GOAL_NEEDS_CELLS = new Set(['take', 'hold', 'reach']);

/** Ziel einer eigenen Lage pruefen (Formate js/modes/goals.js; dig bleibt den Puzzle-Lagen vorbehalten) */
function goalProblems(goal, map) {
  if (typeof goal !== 'object') return ['Das Ziel ist unlesbar.'];
  if (goal.type === 'destroy') {
    return goal.groups === 'all' || (Array.isArray(goal.groups) && goal.groups.length && goal.groups.every((g) => typeof g === 'string'))
      ? [] : ['Beim Aufreiben fehlt, wer aufgerieben werden soll.'];
  }
  if (!GOAL_NEEDS_CELLS.has(goal.type)) return ['Unbekannte Zielart.'];
  const cells = Array.isArray(goal.cells) ? goal.cells : [];
  if (!cells.length) return ['Das Ziel braucht mindestens ein Feld.'];
  const inMap = (c) => {
    const x = Array.isArray(c) ? c[0] : c?.x, y = Array.isArray(c) ? c[1] : c?.y;
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.width && y < map.height;
  };
  return cells.every(inMap) ? [] : ['Ein Zielfeld liegt außerhalb der Karte.'];
}

/** Lage -> Code */
export async function encodeLage(lage) {
  const json = JSON.stringify({ ...lage, v: LAGE_VERSION });
  const bytes = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return CODE_PREFIX + toB64url(bytes);
}

/** Code -> Lage (wirft mit deutscher Meldung) */
export async function decodeLage(code) {
  const text = String(code ?? '').trim();
  if (!text.startsWith(CODE_PREFIX)) throw new Error('Das ist kein Lage-Code (er beginnt mit L1.).');
  let lage;
  try {
    const bytes = await pipe(fromB64url(text.slice(CODE_PREFIX.length)), new DecompressionStream('deflate-raw'));
    lage = JSON.parse(new TextDecoder().decode(bytes));
  } catch { throw new Error('Der Lage-Code ist beschädigt oder unvollständig.'); }
  if (lage?.v !== LAGE_VERSION) throw new Error('Diese Lage stammt aus einer anderen Fassung des Spiels.');
  const bad = lageProblems(lage);
  if (bad.length) throw new Error('Lage ungültig: ' + bad[0]);
  return lage;
}
