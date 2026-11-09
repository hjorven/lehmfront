// Einstellungen (P18): Animationstempo, reduzierte Bewegung, Textgroesse, farbunabhaengige Signaturen,
// hoher Kontrast. Liegen im localStorage dieses Geraets; ohne Speicher (privater Modus, Node) gelten die
// Vorgaben. Lautstaerke verwaltet die Klang-Engine selbst (js/audio/engine.js), das Menue zeigt sie nur.
// normalizeSettings ist rein und getestet; applySettings setzt Attribute an <html>, die CSS liest.

export const SETTINGS_KEY = 'lehmfront.settings';

/** Erlaubte Werte je Einstellung, erster Wert = Vorgabe */
export const SETTING_CHOICES = {
  speed: [1, 0.5, 1.5, 2],              // Tempo von Phasenfilm, Fernschreiber und Kaertchen
  motion: ['auto', 'reduce'],           // auto = wie das System, reduce = immer still
  text: [1, 0.9, 1.15, 1.3],            // Groesse der Kaertchen-Texte
  signs: [false, true],                 // Signaturen zusaetzlich zur Farbe (Doppelrahmen, Zeichen)
  contrast: [false, true],              // kraeftigere Linien und Hilfstexte
  tap: ['confirm', 'direct'],           // Ziel mit dem Finger: erst vormerken, dann setzen, oder sofort setzen
  hud: ['auto', 'tidy', 'full'],        // Kaertchen im Gefecht: nach Geraet, aufgeraeumt (Kopfleiste) oder alle offen
};

export const DEFAULT_SETTINGS = Object.freeze(
  Object.fromEntries(Object.entries(SETTING_CHOICES).map(([k, v]) => [k, v[0]])),
);

/** Unbekannte Schluessel weg, unbekannte Werte auf Vorgabe. Rein. */
export function normalizeSettings(raw) {
  const out = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(SETTING_CHOICES).sort()) {
    if (SETTING_CHOICES[k].includes(raw[k])) out[k] = raw[k];
  }
  return out;
}

function read() {
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let current = read();
const listeners = new Set();

export function getSettings() {
  return current;
}

export function getSetting(k) {
  return current[k];
}

/** Teilweise setzen; meldet an alle Zuhoerer und speichert. Liefert die neuen Einstellungen. */
export function setSettings(patch) {
  const next = normalizeSettings({ ...current, ...patch });
  if (Object.keys(next).every((k) => next[k] === current[k])) return current;
  current = next;
  try { globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(current)); } catch { /* ohne Speicher */ }
  applySettings();
  for (const fn of [...listeners]) {
    try { fn(current); } catch (e) { console.error(e); }
  }
  return current;
}

export function resetSettings() {
  return setSettings({ ...DEFAULT_SETTINGS });
}

/** fn(settings) bei jeder Aenderung. Liefert die Abmeldung. */
export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Einstellungen als Attribute und Variablen an <html> (css/einstellungen.css liest sie) */
export function applySettings(doc = globalThis.document) {
  const html = doc?.documentElement;
  if (!html) return;
  const s = current;
  html.dataset.speed = String(s.speed);
  html.dataset.motion = s.motion;
  html.dataset.signs = s.signs ? 'on' : 'off';
  html.dataset.contrast = s.contrast ? 'high' : 'normal';
  html.style.setProperty('--text-scale', String(s.text));
  html.style.setProperty('--speed', String(s.speed));
}

// Fremde Tabs: Aenderungen aus einem anderen Fenster uebernehmen
globalThis.addEventListener?.('storage', (e) => {
  if (e.key !== SETTINGS_KEY) return;
  current = read();
  applySettings();
  for (const fn of [...listeners]) fn(current);
});
