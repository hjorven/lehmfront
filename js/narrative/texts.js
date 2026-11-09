// Spieltexte auswerten (Format: data/texts/README.md). Rein: kein DOM, kein Date, kein Math.random.
// Index ueber alle Dateien, Bedingungen (wann), Varianten (slot), Platzhalter fuellen.

/** Alle Eintraege aller Dateien in einen Index. files: [{ eintraege: [...] }, ...] in fester Reihenfolge */
export function indexTexts(files) {
  const list = [];
  for (const f of files) for (const e of f?.eintraege ?? []) list.push(e);
  const byId = new Map();
  const slots = new Map();
  for (const e of list) {
    byId.set(e.id, e);
    if (e.slot) {
      if (!slots.has(e.slot)) slots.set(e.slot, []);
      slots.get(e.slot).push(e);
    }
  }
  return { list, byId, slots };
}

const inRange = (v, r) => typeof v === 'number' && (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
const oneOf = (v, want) => (Array.isArray(want) ? want.includes(v) : v === want);

/**
 * Gilt die Bedingung? ctx: { outcome, ansehen, vertrauen, werte, flags (Set oder Liste), fraktion, wetter, tageszeit }
 * Unbekannte Werte (z. B. fehlende Statistik) gelten als nicht erfuellt, damit der Rueckfall greift.
 */
export function matches(wann, ctx = {}) {
  if (!wann) return true;
  const flags = ctx.flags instanceof Set ? ctx.flags : new Set(ctx.flags ?? []);
  for (const key of Object.keys(wann)) {
    const want = wann[key];
    switch (key) {
      case 'ausgang':
        if (!oneOf(ctx.outcome, want)) return false;
        break;
      case 'ansehen':
        if (!inRange(ctx.ansehen, want)) return false;
        break;
      case 'vertrauen':
        if (!inRange(ctx.vertrauen, want)) return false;
        break;
      case 'werte':
        for (const k of Object.keys(want)) if (!inRange(ctx.werte?.[k], want[k])) return false;
        break;
      case 'flags':
        if (!want.every((f) => flags.has(f))) return false;
        break;
      case 'ohne':
        if (want.some((f) => flags.has(f))) return false;
        break;
      case 'fraktion':
        if (!oneOf(ctx.fraktion, want)) return false;
        break;
      case 'wetter':
        if (!oneOf(ctx.wetter, want)) return false;
        break;
      case 'tageszeit':
        if (!oneOf(ctx.tageszeit, want)) return false;
        break;
      case 'oder':
        if (!want.some((w) => matches(w, ctx))) return false;
        break;
      default:
        return false; // unbekannte Bedingung: lieber nicht zeigen als falsch zeigen
    }
  }
  return true;
}

/** Erste gueltige Variante eines Slots (README: der letzte Eintrag ist der Rueckfall) */
export function pickSlot(index, slot, ctx) {
  const list = index.slots.get(slot) ?? [];
  return list.find((e) => matches(e.wann, ctx)) ?? null;
}

/**
 * Eintraege nach einem Filter, Varianten aufgeloest: pro Slot die erste gueltige, ohne Slot nur wenn wann gilt.
 * Reihenfolge wie in den Dateien (erstes Auftreten des Slots).
 */
export function resolveEntries(index, filter, ctx) {
  const out = [];
  const doneSlots = new Set();
  for (const e of index.list) {
    if (!filter(e)) continue;
    if (e.slot) {
      if (doneSlots.has(e.slot)) continue;
      doneSlots.add(e.slot);
      const pick = index.slots.get(e.slot).filter(filter).find((x) => matches(x.wann, ctx));
      if (pick) out.push(pick);
    } else if (matches(e.wann, ctx)) out.push(e);
  }
  return out;
}

const WORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf'];

/** Zahl als Wort (zwei bis zwölf), sonst Ziffer (README Platzhalter anzahl) */
export function numberWord(n) {
  return n >= 2 && n <= 12 ? WORDS[n] : String(n);
}

/** Platzhalter in geschweiften Klammern ersetzen. Fehlende bleiben stehen (Tests finden sie). */
export function fill(text, values) {
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (m, k) => (values[k] != null ? String(values[k]) : m));
}

/** Namen der Platzhalter in einem Text */
export function placeholdersIn(text) {
  return [...String(text ?? '').matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]);
}

/** Stabile Zahl aus einer Zeichenkette (FNV-1a), fuer Seeds aus IDs */
export function hashText(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Missionsfolge der Kampagne: a1m1 .. a4m6 */
export const MISSIONS = [1, 2, 3, 4].flatMap((a) => [1, 2, 3, 4, 5, 6].map((m) => `a${a}m${m}`));

export function actOf(missionId) {
  const m = /^a(\d)m\d$/.exec(missionId ?? '');
  return m ? Number(m[1]) : null;
}

export function nextMission(missionId) {
  const i = MISSIONS.indexOf(missionId);
  return i >= 0 && i < MISSIONS.length - 1 ? MISSIONS[i + 1] : null;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV'];
export function actRoman(act) {
  return ROMAN[act] ?? String(act);
}
