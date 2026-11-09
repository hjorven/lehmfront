// mulberry32: klein, schnell, deterministisch (Plan 10.4)
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rundenzufall aus Partie-Seed und Rundennummer ableiten, damit jede Runde einzeln nachrechenbar ist (Plan 10.6)
export function rngForTurn(seed, turn) {
  return createRng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(turn >>> 0, 0x85ebca6b)) >>> 0);
}

// Ruhige Wuerfel fuer Puzzle-Lagen (P25): van-der-Corput-Folge zur Basis 2 (0,5 0,25 0,75 0,125 ...).
// Kein Zufall: jede Aussicht ueber der Haelfte gelingt beim ersten Wurf, viele Wuerfe treffen fast genau den
// Erwartungswert. So ist eine Lage mit voller Information auch im Ausgang vorhersehbar.
export function createSteadyRng() {
  let i = 0;
  return function next() {
    i++;
    let n = i, f = 0.5, v = 0;
    while (n > 0) {
      if (n & 1) v += f;
      n >>>= 1;
      f *= 0.5;
    }
    return v;
  };
}
