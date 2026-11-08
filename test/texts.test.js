// Prueft alle Spieltexte unter data/texts/ und data/letters/ (Format siehe data/texts/README.md).
// Neue JSON-Dateien werden automatisch gefunden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIRS = ['data/texts', 'data/letters'];

function listJson(dir) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    const p = join(abs, name);
    if (statSync(p).isDirectory()) out.push(...listJson(join(dir, name)));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

const files = DIRS.flatMap(listJson);
const rel = (p) => relative(ROOT, p);
const PLACEHOLDER_FILE = join(ROOT, 'data/texts/placeholders.json');

function load(p) {
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Alle Dateien einmal laden; Fehler sammelt der erste Test.
const parsed = new Map();
const parseErrors = [];
for (const f of files) {
  try {
    parsed.set(f, load(f));
  } catch (e) {
    parseErrors.push(`${rel(f)}: ${e.message}`);
  }
}

const known = new Set((parsed.get(PLACEHOLDER_FILE)?.platzhalter ?? []).map((p) => p.name));
const textFiles = [...parsed.entries()].filter(([f]) => f !== PLACEHOLDER_FILE);
const entries = textFiles.flatMap(([f, data]) =>
  (Array.isArray(data.eintraege) ? data.eintraege : []).map((e) => ({ file: rel(f), e }))
);

const TONES = ['zuversichtlich', 'erschoepft', 'verbittert'];
const BLAETTER = ['brief', 'telegramm', 'tagebuch', 'gefallenenliste', 'zeitung', 'foto', 'aktkarte'];
const RANGE_KEYS = ['ansehen', 'vertrauen'];
const STATS = [
  'gefallene', 'verwundete', 'verwundete_geborgen', 'verwundete_liegen', 'gefangene',
  'felder_gewonnen', 'felder_verloren', 'moral', 'runden', 'depot_leer', 'ablosung_verspaetet',
];
const WETTER = ['trocken', 'regen', 'schlamm', 'nebel', 'frost', 'schnee'];
const MISSION_RE = /^a[1-4]m[1-6]$/;
const ID_RE = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;

// Alle Strings eines Werts (rekursiv) mit Pfad.
function strings(v, path = '', out = []) {
  if (typeof v === 'string') out.push([path, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v).sort()) strings(v[k], `${path}.${k}`, out);
  return out;
}

function checkRange(r, where, errs) {
  if (!r || typeof r !== 'object') return errs.push(`${where}: Bereich muss Objekt sein`);
  for (const k of Object.keys(r)) {
    if (k !== 'min' && k !== 'max') errs.push(`${where}: unbekannte Grenze ${k}`);
    else if (!Number.isInteger(r[k])) errs.push(`${where}.${k}: keine ganze Zahl`);
  }
}

function oneOrList(v, allowed, where, errs) {
  const list = Array.isArray(v) ? v : [v];
  for (const x of list) if (!allowed.includes(x)) errs.push(`${where}: unbekannter Wert ${x}`);
}

function checkWann(w, where, errs) {
  if (!w || typeof w !== 'object' || Array.isArray(w)) return errs.push(`${where}: wann muss Objekt sein`);
  for (const k of Object.keys(w)) {
    const v = w[k];
    const at = `${where}.${k}`;
    if (k === 'ausgang') oneOrList(v, ['sieg', 'niederlage'], at, errs);
    else if (RANGE_KEYS.includes(k)) checkRange(v, at, errs);
    else if (k === 'werte') {
      for (const s of Object.keys(v)) {
        if (!STATS.includes(s)) errs.push(`${at}: unbekannte Statistik ${s}`);
        checkRange(v[s], `${at}.${s}`, errs);
      }
    } else if (k === 'flags' || k === 'ohne') {
      if (!Array.isArray(v) || v.some((f) => !/^[a-z0-9_]+$/.test(f))) errs.push(`${at}: Liste von Flags erwartet`);
    } else if (k === 'fraktion') oneOrList(v, ['kaldern', 'morrow'], at, errs);
    else if (k === 'wetter') oneOrList(v, WETTER, at, errs);
    else if (k === 'tageszeit') oneOrList(v, ['tag', 'nacht'], at, errs);
    else if (k === 'oder') {
      if (!Array.isArray(v) || v.length < 2) errs.push(`${at}: Liste mit mindestens zwei Bedingungen erwartet`);
      else v.forEach((x, i) => checkWann(x, `${at}[${i}]`, errs));
    } else errs.push(`${at}: unbekannte Bedingung`);
  }
}

function checkFolgen(f, where, errs) {
  if (!f || typeof f !== 'object') return errs.push(`${where}: folgen fehlt`);
  for (const k of Object.keys(f)) {
    if (!RANGE_KEYS.includes(k)) errs.push(`${where}: unbekannte Folge ${k}`);
    else if (!Number.isInteger(f[k]) || Math.abs(f[k]) > 30) errs.push(`${where}.${k}: ganze Zahl zwischen -30 und 30 erwartet`);
  }
}

function collect(fn) {
  const errs = [];
  for (const { file, e } of entries) fn(e, `${file} ${e?.id ?? '(ohne id)'}`, errs);
  return errs;
}

test('alle Text-Dateien sind gueltiges JSON', () => {
  assert.deepEqual(parseErrors, []);
  assert.ok(files.length > 0, 'keine Text-Dateien gefunden');
});

test('Platzhalter-Liste ist vollstaendig beschrieben und eindeutig', () => {
  const list = parsed.get(PLACEHOLDER_FILE)?.platzhalter;
  assert.ok(Array.isArray(list) && list.length > 0, 'data/texts/placeholders.json fehlt');
  const names = list.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'Platzhalter doppelt');
  for (const p of list) {
    assert.match(p.name, /^[a-z_]+$/);
    assert.ok(p.beschreibung && p.beispiel, `${p.name}: Beschreibung und Beispiel fehlen`);
  }
});

test('jede Datei hat format, beschreibung und eintraege', () => {
  const errs = [];
  for (const [f, data] of textFiles) {
    const keys = Object.keys(data).sort().join(',');
    if (keys !== 'beschreibung,eintraege,format') errs.push(`${rel(f)}: Schluessel ${keys}`);
    if (data.format !== 1) errs.push(`${rel(f)}: format muss 1 sein`);
    if (!Array.isArray(data.eintraege)) errs.push(`${rel(f)}: eintraege ist keine Liste`);
  }
  assert.deepEqual(errs, []);
});

test('IDs sind gueltig und ueber alle Dateien eindeutig', () => {
  const seen = new Map();
  const errs = [];
  for (const { file, e } of entries) {
    if (typeof e.id !== 'string' || !ID_RE.test(e.id)) errs.push(`${file}: ungueltige id ${e.id}`);
    else if (seen.has(e.id)) errs.push(`${file}: id ${e.id} schon in ${seen.get(e.id)}`);
    else seen.set(e.id, file);
    for (const o of e.optionen ?? []) if (!ID_RE.test(o.id ?? '')) errs.push(`${file} ${e.id}: ungueltige Options-id`);
  }
  assert.deepEqual(errs, []);
});

test('Pflichtfelder und Wertebereiche', () => {
  const errs = collect((e, at, errs) => {
    if (typeof e.art !== 'string' || !e.art) errs.push(`${at}: art fehlt`);
    if (typeof e.text !== 'string' || !e.text.trim()) errs.push(`${at}: text fehlt`);
    if (e.ton !== undefined && !TONES.includes(e.ton)) errs.push(`${at}: unbekannte Tonlage ${e.ton}`);
    if (e.blatt !== undefined && !BLAETTER.includes(e.blatt)) errs.push(`${at}: unbekannte Blattart ${e.blatt}`);
    for (const k of ['mission', 'nach']) if (e[k] !== undefined && !MISSION_RE.test(e[k])) errs.push(`${at}: ${k} ${e[k]} ist keine Missions-ID`);
    if (e.wann !== undefined) checkWann(e.wann, `${at} wann`, errs);
    if (e.fraktion !== undefined) oneOrList(e.fraktion, ['kaldern', 'morrow'], `${at} fraktion`, errs);
  });
  assert.deepEqual(errs, []);
});

test('nur bekannte Platzhalter, keine kaputten Klammern', () => {
  const errs = collect((e, at, errs) => {
    for (const [path, s] of strings(e)) {
      for (const m of s.matchAll(/\{([^{}]*)\}/g)) {
        if (!known.has(m[1])) errs.push(`${at}${path}: unbekannter Platzhalter {${m[1]}}`);
      }
      const rest = s.replace(/\{[a-z_]+\}/g, '');
      if (/[{}]/.test(rest)) errs.push(`${at}${path}: einzelne geschweifte Klammer`);
    }
  });
  assert.deepEqual(errs, []);
});

test('keine Emojis und keine ASCII-Umschreibung von Umlauten im Spieltext', () => {
  const errs = collect((e, at, errs) => {
    for (const [path, s] of strings(e)) {
      if (/\p{Extended_Pictographic}/u.test(s)) errs.push(`${at}${path}: Emoji`);
    }
    // Typische Ersatzschreibungen, die im Spiel nicht vorkommen sollen.
    for (const k of ['text', 'titel', 'label']) {
      const s = e[k];
      if (typeof s === 'string' && /\b(fuer|ueber|koennen|muessen|waere|hoeren|Gruesse|schoen)\b/.test(s)) errs.push(`${at}.${k}: Umlaut ausgeschrieben`);
    }
  });
  assert.deepEqual(errs, []);
});

test('Varianten: jeder Slot endet mit genau einem Rueckfall ohne Bedingung', () => {
  const slots = new Map();
  for (const { file, e } of entries) {
    if (!e.slot) continue;
    if (!slots.has(e.slot)) slots.set(e.slot, []);
    slots.get(e.slot).push({ file, e });
  }
  const errs = [];
  for (const [slot, list] of [...slots.entries()].sort()) {
    const files = new Set(list.map((x) => x.file));
    if (files.size > 1) errs.push(`${slot}: Varianten ueber mehrere Dateien verteilt`);
    const fallbacks = list.filter((x) => x.e.wann === undefined);
    if (fallbacks.length !== 1) errs.push(`${slot}: ${fallbacks.length} Eintraege ohne wann, erwartet genau 1`);
    if (list[list.length - 1].e.wann !== undefined) errs.push(`${slot}: letzter Eintrag muss der Rueckfall ohne wann sein`);
  }
  assert.deepEqual(errs, []);
});

test('Stabsbefehle im Telegrammstil', () => {
  const errs = collect((e, at, errs) => {
    if (e.art !== 'befehl') return;
    if (e.text !== e.text.toUpperCase()) errs.push(`${at}: nicht in Grossbuchstaben`);
    if (/ß/.test(e.text)) errs.push(`${at}: ß im Telegramm, SS schreiben`);
    if (!/ STOP$/.test(e.text.trim())) errs.push(`${at}: endet nicht mit STOP`);
    for (const k of ['nr', 'von', 'an', 'abschnitt', 'frist']) if (!e[k]) errs.push(`${at}: ${k} fehlt`);
    if (typeof e.eilt !== 'boolean') errs.push(`${at}: eilt muss true oder false sein`);
    checkFolgen(e.folgen?.erfuellt, `${at} folgen.erfuellt`, errs);
    checkFolgen(e.folgen?.verfehlt, `${at} folgen.verfehlt`, errs);
  });
  assert.deepEqual(errs, []);
});

test('Entscheidungen haben mindestens zwei Optionen mit Folgen', () => {
  const errs = collect((e, at, errs) => {
    if (e.art !== 'entscheidung') return;
    if (!e.titel) errs.push(`${at}: titel fehlt`);
    const opts = e.optionen ?? [];
    if (opts.length < 2) errs.push(`${at}: weniger als zwei Optionen`);
    const ids = opts.map((o) => o.id);
    if (new Set(ids).size !== ids.length) errs.push(`${at}: Options-id doppelt`);
    for (const o of opts) {
      if (!o.label || !o.text) errs.push(`${at} ${o.id}: label oder text fehlt`);
      checkFolgen(o.folgen, `${at} ${o.id}`, errs);
      if (o.setzt !== undefined && (!Array.isArray(o.setzt) || o.setzt.some((f) => !/^[a-z0-9_]+$/.test(f)))) errs.push(`${at} ${o.id}: setzt muss Liste von Flags sein`);
    }
  });
  assert.deepEqual(errs, []);
});

test('handgeschriebene Briefe: Nummern 1 bis 24, jede Nummer nur einmal (Varianten teilen sich eine)', () => {
  const byNr = new Map();
  const errs = collect((e, at, errs) => {
    if (e.art !== 'brief') return;
    if (!Number.isInteger(e.nr) || e.nr < 1 || e.nr > 24) errs.push(`${at}: nr ${e.nr} ausserhalb 1 bis 24`);
    for (const k of ['absender', 'empfaenger']) if (!e[k]) errs.push(`${at}: ${k} fehlt`);
    const key = e.slot ?? e.id;
    if (byNr.has(e.nr) && byNr.get(e.nr) !== key) errs.push(`${at}: nr ${e.nr} schon vergeben`);
    byNr.set(e.nr, key);
  });
  assert.deepEqual(errs, []);
});

test('Feldpost-Vorlagen haben eine Tonlage', () => {
  const errs = collect((e, at, errs) => {
    if (e.art === 'feldpost' && !TONES.includes(e.ton)) errs.push(`${at}: ton fehlt`);
    if (e.art === 'ereignis' && !e.kategorie) errs.push(`${at}: kategorie fehlt`);
    if (e.art === 'ereignis' && e.text.includes('{ereignis}')) errs.push(`${at}: Ereignis darf sich nicht selbst enthalten`);
  });
  assert.deepEqual(errs, []);
});
