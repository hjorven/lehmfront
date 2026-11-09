// Tageszeit als Stilwechsel (Plan 7.7): Tag = Stil 01 Generalstabskarte, Nacht = Stil 04.
// Ein Faktor darkness 0..1 steuert Canvas-Thema und CSS-Variablen gleichzeitig.
// Reine Optik: hier ist Math.sin erlaubt. Spielregeln lesen darkness ueber rules.visibilityFromDarkness.

/** Schluessel, die als CSS-Variablen (--name) auf die Kaertchen wirken. */
export const CSS_KEYS = ['paper', 'card', 'ink', 'ink2', 'line', 'track', 'own', 'enemy', 'accent', 'danger'];

/**
 * Diese Farben springen spaet und schnell um, damit Text nie den Kontrast verliert (Plan 7.7).
 * Abweichung vom Plan: Im Mockup wandert die Tinte zwischen 0,45 und 0,7 linear, nachgemessen faellt
 * der Kontrast Tinte/Papier dabei bis auf 1,1 : 1, weil die Tinte genau durch den Papierton laeuft.
 * Hier springt jede Farbe innerhalb dieses Fensters an ihrem eigenen Kreuzungspunkt, also dort, wo die
 * Nachtfarbe auf dem dann gueltigen Papier besser lesbar wird als die Tagfarbe. So bleibt Tinte auf
 * Papier immer ueber 3 : 1. Im Zwei-Sekunden-Uebergang wirkt das wie Tinte, die aufleuchtet.
 */
export const LATE_KEYS = ['ink', 'ink2', 'line', 'own', 'enemy', 'accent', 'danger', 'wire', 'rail', 'pencil', 'frame', 'village', 'forestLine', 'marsh', 'rock', 'mud'];
/**
 * Kaertchen springen zusammen mit der Tinte (Review P02): ein Kaertchen in mittlerem Braun ist mit keiner
 * Tinte lesbar. Bis zum Sprung wird es nur leicht abgedunkelt und angewaermt, danach ist es Nachtkarte.
 */
export const CARD_WITH = 'ink';
/** Fenster aus Plan 7.7, in dem die Spruenge liegen. */
export const LATE_FROM = 0.45;
export const LATE_TO = 0.7;
/** Ab hier gilt die Karte als Nacht (fuer Kaertchen und data-daytime). */
export const NIGHT_FROM = 0.6;

export const DAY = {
  // Kaertchen
  paper: '#efe6cf', card: '#f8f2e3', ink: '#2a2420', ink2: '#6e6253', line: '#8a7d66', track: '#d9cfb6',
  own: '#1f4e9c', enemy: '#a3271f', accent: '#c99a1a', danger: '#a3271f',
  // Karte
  faint: '#cbbf9f', contour: '#b79b6a', forest: '#7f8f5c', forestLine: '#46552c', water: '#7fa0b8', wire: '#4a4036', crater: '#a89470',
  rail: '#3a3128', marsh: '#3f6680', chalk: '#9a8e70', rock: '#5c5244', village: '#3b332c',
  pencil: '#4a4540', stain: '#8a5a2b', fold: '#a8987a', frame: '#3a3128', desk: '#3a3027', shade: '#000000',
  // Wetter (P10): Schlammsignatur, Nebelgrau, Licht der Leuchtkugel, Wasser auf dem Papier
  mud: '#6b4f30', fog: '#aaa69a', flareLight: '#f3c66a', wetPaper: '#d9ccab',
  jitter: 0.045, shadeAlpha: 0.22, foldAlpha: 0.35, stainAlpha: 0.22,
};

export const NIGHT = {
  paper: '#0b0d0a', card: '#15180f', ink: '#d8d2b8', ink2: '#8f8a73', line: '#3a3f2c', track: '#262a1e',
  own: '#7fa4e6', enemy: '#e2645a', accent: '#ffbf47', danger: '#e2645a',
  faint: '#1d2118', contour: '#3d4532', forest: '#4a6a3a', forestLine: '#8fb07a', water: '#2a4553', wire: '#8a826a', crater: '#2b2e24',
  rail: '#8a846f', marsh: '#7aa4bd', chalk: '#5a5c4c', rock: '#8a8270', village: '#a49e88',
  pencil: '#b3ae9a', stain: '#5a4630', fold: '#2a2e22', frame: '#a8a28c', desk: '#050605', shade: '#000000',
  mud: '#9a8260', fog: '#4b4f47', flareLight: '#ffcf73', wetPaper: '#1a1d16',
  jitter: 0.03, shadeAlpha: 0.5, foldAlpha: 0.45, stainAlpha: 0.18,
};

// Daemmerungsschimmer: Papier und Kaertchen ziehen zur Mitte hin Richtung Braunorange
const DUSK = { paper: ['#9c7a4f', 0.35], card: ['#8a6a44', 0.12], faint: ['#7a5c3a', 0.3], desk: ['#4a3420', 0.25] };

function hexToRgb(h) {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r) {
  return '#' + r.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
export function mix(a, b, t) {
  if (typeof a !== 'string' || typeof b !== 'string' || a[0] !== '#' || b[0] !== '#') return t < 0.5 ? a : b;
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));
// Papier ohne Tinte, um die Kreuzungspunkte zu finden
function paperAt(t) {
  return mix(mix(DAY.paper, NIGHT.paper, t), DUSK.paper[0], Math.sin(Math.PI * t) * DUSK.paper[1]);
}

/** Kreuzungspunkte je Schluessel, einmal beim Laden berechnet (Schritte von 0,01). */
export const CROSSOVER = Object.fromEntries(LATE_KEYS.map((k) => {
  for (let i = 0; i <= 100; i++) {
    const t = i / 100, p = paperAt(t);
    if (contrast(NIGHT[k], p) >= contrast(DAY[k], p)) return [k, Math.max(LATE_FROM, Math.min(LATE_TO, t))];
  }
  return [k, LATE_TO];
}));
// Schrift und Rahmen auf Kaertchen springen mit dem Kaertchen
CROSSOVER.ink2 = CROSSOVER.line = CROSSOVER[CARD_WITH];

/** Kaertchen: bis zum Sprung nur leicht abgedunkelt, danach Nachtkarte mit leichtem Resttag. */
function cardAt(t) {
  const c = CROSSOVER[CARD_WITH];
  return t < c ? mix(DAY.card, NIGHT.card, t * 0.3) : mix(NIGHT.card, DAY.card, (1 - t) * 0.25);
}

/** Spaetes Umspringen einer Farbe: 0 = Tagfarbe, 1 = Nachtfarbe. */
export function lateFactor(t, key = 'ink') {
  return t >= (CROSSOVER[key] ?? 0.56) ? 1 : 0;
}

/** Zwischenthema fuer darkness t (0 Tag, 1 Nacht). */
export function lerpTheme(day, night, t) {
  t = clamp01(Number(t) || 0);
  const out = {};
  for (const k of Object.keys(day)) {
    const a = day[k], b = night[k] ?? a;
    const f = LATE_KEYS.includes(k) ? lateFactor(t, k) : t;
    if (typeof a === 'string') out[k] = mix(a, b, f);
    else if (typeof a === 'number' && typeof b === 'number') out[k] = a + (b - a) * t;
    else out[k] = t < 0.5 ? a : b;
  }
  if (day === DAY && night === NIGHT) out.card = cardAt(t);
  const dusk = Math.sin(Math.PI * t);
  for (const [k, [c, w]] of Object.entries(DUSK)) out[k] = mix(out[k], c, dusk * w);
  out.darkness = t;
  out.dark = t > 0.5;
  out.flare = t > 0.5; // Leuchtkugeln erst, wenn es dunkel genug ist (P10)
  return out;
}

export function themeAt(darkness) {
  return lerpTheme(DAY, NIGHT, darkness);
}

/** Relative Leuchtdichte und Kontrast nach WCAG, fuer Tests und Pruefungen. */
export function contrast(a, b) {
  const lum = (h) => {
    const [r, g, bl] = hexToRgb(h).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const la = lum(a), lb = lum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

let current = themeAt(0);
const listeners = new Set();

export function currentTheme() {
  return current;
}

/** Wird bei jedem applyTheme aufgerufen (Renderer zeichnen dann neu). Gibt eine Abmeldefunktion zurueck. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Setzt die CSS-Variablen der Kaertchen und meldet das Canvas-Thema an alle Renderer. */
export function applyTheme(theme, el = typeof document !== 'undefined' ? document.body : null) {
  current = theme;
  if (el) {
    for (const k of CSS_KEYS) el.style.setProperty('--' + k, theme[k]);
    el.style.setProperty('--shadow', theme.dark ? '0 2px 6px rgba(0,0,0,.6)' : '0 1px 2px rgba(40,30,10,.18)');
    el.dataset.daytime = theme.darkness >= NIGHT_FROM ? 'nacht' : theme.darkness > 0.15 ? 'daemmerung' : 'tag';
  }
  for (const fn of listeners) fn(theme);
  return theme;
}

/** Bequemer Weg: darkness setzen. */
export function applyDarkness(darkness, el) {
  return applyTheme(themeAt(darkness), el);
}

/**
 * Uebergang ueber etwa zwei Sekunden (Plan 7.7). Laeuft ueber requestAnimationFrame,
 * gibt eine Funktion zum Abbrechen zurueck. Glaettung ease-in-out.
 */
export function animateDarkness(from, to, { duration = 2000, el, onDone } = {}) {
  let start = null, raf = 0;
  const step = (ts) => {
    if (start === null) start = ts;
    const p = clamp01((ts - start) / duration);
    const e = p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    applyDarkness(from + (to - from) * e, el);
    if (p < 1) raf = requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * Stil 02 Blaupause (Plan 7.8): verworfen als Spielfeld, aber der Feuerplan-Editor (P09) legt ihn ueber die Karte,
 * solange man eine Walze plant. Technische Zeichnung: weisse Linien auf Preussischblau, ohne Zittern.
 * blueprintTheme(base) behaelt darkness der Spielzeit (Regeln und Vorschau rechnen weiter mit der echten Sicht).
 */
export const BLUEPRINT = {
  paper: '#173b7c', card: '#1b4589', ink: '#f3f6fc', ink2: '#bccbe8', line: '#7d97cb', track: '#2b5299',
  own: '#ffffff', enemy: '#ffb36b', accent: '#ffd45c', danger: '#ff9a7a',
  faint: '#2c58a3', contour: '#5d80c2', forest: '#3866b0', forestLine: '#dce6f7', water: '#4473be', wire: '#dce6f7', crater: '#24498f',
  rail: '#eef3fb', marsh: '#a8c0e8', chalk: '#3c64ab', rock: '#cfdcf2', village: '#eef3fb',
  pencil: '#ffffff', stain: '#10306a', fold: '#2f5ca8', frame: '#dce6f7', desk: '#0b1d42', shade: '#000000',
  mud: '#9fb6e0', fog: '#2f5597', flareLight: '#ffd45c', wetPaper: '#143470',
  jitter: 0, shadeAlpha: 0.3, foldAlpha: 0.25, stainAlpha: 0,
};

export function blueprintTheme(base = current) {
  return { ...BLUEPRINT, darkness: base?.darkness ?? 0, dark: true, flare: false, blueprint: true };
}
