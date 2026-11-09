// Ortsnamen fuer Zufallskarten (P17) in der Namenssprache der Fraktion (Plan 2.3, data/texts/welt.md).
// Kaldern klingt niederlaendisch und niederdeutsch angehaucht (Ostervenn, Weddersiel, Brookdorp),
// Morrow baltisch und slawisch (Raudas, Zelva-Wald, Lenartovo). Rein: Zufall nur ueber den uebergebenen rng.
import { NAMES } from './config/names.js';

// Silben, keine echten Orte: Wurzeln und Endungen werden frei kombiniert.
const LANG = {
  kaldern: {
    roots: ['Oster', 'Wester', 'Brook', 'Wedder', 'Lütt', 'Hooge', 'Moor', 'Grau', 'Holler', 'Tjark', 'Fenn', 'Aal',
      'Ellern', 'Warf', 'Bunt', 'Olden', 'Kolk', 'Riet', 'Siel', 'Deich', 'Haver', 'Ubben', 'Wiebe', 'Jüm', 'Eilt',
      'Garrel', 'Torf', 'Krai', 'Hamm', 'Möwen', 'Reet', 'Klei'],
    village: ['venn', 'husen', 'dorp', 'siel', 'warf', 'brügge', 'fehn', 'horst', 'wold', 'kamp', 'hude', 'um', 'zand', 'moor', 'hörn'],
    wood: ['holt', 'busch', 'loh', 'hagen'],
    hill: ['kopp', 'berg', 'höchte', 'bült'],
    water: ['Au', 'Tief', 'Fleet', 'Leide'],
    farm: 'Hof',
    mill: (n) => `${adj(n)} Mühle`,
  },
  morrow: {
    roots: ['Rau', 'Zel', 'Dra', 'Sar', 'Kur', 'Tol', 'Zir', 'Ozo', 'Bra', 'Len', 'Mir', 'Dau', 'Var', 'Lie', 'Jur',
      'Ves', 'Rad', 'Gir', 'Pel', 'Ruk', 'Zal', 'Kel', 'Dzin', 'Vel', 'Ram', 'Sil', 'Ug', 'Lap', 'Dub', 'Mez'],
    mid: ['va', 'ne', 'li', 'ma', 'ra', 'ki', 'sa', 'to', 'du', 've', 'la', 'ge', ''],
    end: ['s', 'sk', 'ai', 'ava', 'ovo', 'ija', 'ena', 'ely', 'uva', 'ane', 'iny', 'is', 'as'],
    wood: (n) => `${n}-Wald`,
    hill: (n) => `${n}kalns`,
    water: (n) => n,
    farm: 'Gut',
    mill: (n) => `Mühle ${n}`,
  },
};

const RESERVED = new Set(['Brandt', 'Harms', 'Vell', 'Lask']);
const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Ortsadjektiv: "Wessel" -> "Wesseler", "Ubbenbrügge" -> "Ubbenbrügger", "Holler" bleibt "Holler"
const adj = (n) => (n.endsWith('er') ? n : n.endsWith('e') ? n + 'r' : n + 'er');

// Silben verbinden, ohne dass Vokale aufeinanderprallen ("Tolra" + "ava" wird "Tolrava")
const VOWEL = /[aeiouy]/;
function join(a, b) {
  if (!b) return a;
  if (VOWEL.test(a.slice(-1)) && VOWEL.test(b[0])) return a + b.slice(1);
  if (!VOWEL.test(a.slice(-1)) && !VOWEL.test(b[0]) && !VOWEL.test(a.slice(-2, -1))) return a + 'a' + b;
  return a + b;
}

function morrowStem(rng) {
  const l = LANG.morrow;
  return join(pick(rng, l.roots), pick(rng, l.mid));
}

function rawName(rng, lang, kind) {
  if (lang === 'morrow') {
    const l = LANG.morrow;
    const stem = morrowStem(rng);
    switch (kind) {
      case 'wood': return l.wood(cap(join(stem, pick(rng, ['va', 'na', 'ne', 'la']))));
      case 'hill': return l.hill(cap(join(stem, pick(rng, ['', 'n', 's']))));
      case 'water': return l.water(cap(join(pick(rng, l.roots), pick(rng, ['ava', 'una', 'ija', 'ena']))));
      case 'farm': return `${l.farm} ${pick(rng, NAMES.morrow.last.filter((n) => !RESERVED.has(n)))}`;
      case 'mill': return l.mill(cap(join(stem, pick(rng, l.end))));
      default: return cap(join(stem, pick(rng, l.end)));
    }
  }
  const l = LANG.kaldern;
  const root = pick(rng, l.roots);
  switch (kind) {
    case 'wood': return root + pick(rng, l.wood);
    case 'hill': return root + pick(rng, l.hill);
    case 'water': return `${adj(root)} ${pick(rng, l.water)}`;
    case 'farm': return `${l.farm} ${pick(rng, NAMES.kaldern.last.filter((n) => !RESERVED.has(n) && !n.includes(' ')))}`;
    case 'mill': return l.mill(root + pick(rng, l.village));
    default: {
      const end = pick(rng, l.village);
      // "Moorumoor" vermeiden: Endung nicht wie die Wurzel
      return root.toLowerCase().endsWith(end) ? root + 'dorp' : root + end;
    }
  }
}

/**
 * Ein Namensgeber fuer eine Karte: merkt sich vergebene Namen, damit kein Ort zweimal vorkommt.
 * kind: village | wood | hill | water | farm | mill. lang: kaldern | morrow (Fraktions-ID).
 */
export function createNamer(rng) {
  const used = new Set();
  return function name(lang, kind = 'village') {
    const l = LANG[lang] ? lang : 'kaldern';
    for (let i = 0; i < 20; i++) {
      const n = rawName(rng, l, kind);
      if (!used.has(n)) { used.add(n); return n; }
    }
    const n = rawName(rng, l, kind) + ' ' + (used.size + 1);
    used.add(n);
    return n;
  };
}

/** Sprachen fuer Tests und Anzeige */
export const PLACE_LANGS = Object.keys(LANG);
