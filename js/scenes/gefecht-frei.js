// Szene "gefecht-frei": Marschbefehl fuer Gefecht frei und Hotseat (P17, Plan 8 und 9).
// Karte waehlen (vier handgebaute oder Zufallskarte mit Seed), Fraktion, Gegner, Dauer. Links liegt die Karte als
// Vorschau; beim Wechsel der Fraktion schreiben sich die Ortsnamen in deren Sprache um.
// Parameter: mode=hotseat, karte, kseed, fraktion, ki, runden (Vorauswahl, auch fuer Screenshots).
import { loadMap } from '../map.js';
import { createCamera, resizeCamera, centerOn, fitZoom } from '../render/camera.js';
import { createMapLayer, sheetBounds } from '../render/map-layer.js';
import { themeAt, applyTheme, currentTheme } from '../theme.js';
import { BATTLE_MAPS } from '../config/battlemaps.js';
import { FACTIONS } from '../config/factions.js';
import { DIFFICULTIES } from '../config/doctrines.js';
import { FACTION_IDS, DIFFICULTY_IDS, mapJsonFor, otherFaction } from '../modes/skirmish.js';
import { esc, ensureCss } from '../ui/dom.js';
import { audio, playSfx } from '../audio/engine.js';

const DIFF_TEXT = {
  rekrut: 'sieht wenig, schätzt grob, verschläft Befehle',
  veteran: 'liest die Lage, merkt sich, was er gesehen hat',
  lask: 'Lask selbst: nichts entgeht ihm, er plant die Walze',
};
const ROUNDS = [
  { n: 8, label: '8 Runden', sub: 'vier Tage' },
  { n: 14, label: '14 Runden', sub: 'eine Woche' },
  { n: 24, label: '24 Runden', sub: 'zwölf Tage' },
  { n: 0, label: 'Offen', sub: 'bis eine Seite fällt' },
];

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));
const newSeed = () => 1 + Math.floor(Math.random() * 99999); // nur Vorschlag im Menue, das Spiel bleibt rein

export async function mount(root, params) {
  const hotseat = params.get('mode') === 'hotseat';
  const koop = !hotseat && params.get('mode') === 'koop'; // P25: zwei Kommandos teilen Seite a gegen die KI
  await Promise.all([
    ensureCss('css/modi.css'),
    Promise.all(['16px "Special Elite"', '16px "IBM Plex Mono"', '700 16px "Caveat"', '16px "IBM Plex Sans"', '700 16px "IBM Plex Sans"']
      .map((f) => document.fonts.load(f))).catch(() => {}),
  ]);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(themeAt(dark ? 1 : 0));
  audio.init();

  const choice = {
    map: ['zufall', ...BATTLE_MAPS.map((m) => m.id)].includes(params.get('karte')) ? params.get('karte') : 'velde',
    mapSeed: (num(params.get('kseed'), 0) >>> 0) || newSeed(),
    faction: FACTION_IDS.includes(params.get('fraktion')) ? params.get('fraktion') : 'kaldern',
    difficulty: DIFFICULTY_IDS.includes(params.get('ki')) ? params.get('ki') : 'veteran',
    rounds: ROUNDS.some((r) => r.n === num(params.get('runden'), -1)) ? num(params.get('runden'), 14) : 14,
  };

  const mapOpts = [...BATTLE_MAPS.map((m) => ({ id: m.id, label: m.name, sub: m.kind === 'file' ? 'Kampagnenkarte' : 'handgezeichnet' })),
    { id: 'zufall', label: 'Zufallskarte', sub: 'aus einem Seed' }];
  const radio = (name, list, cur) => list.map((o) => `<label class="mb-opt"><input type="radio" name="${name}" value="${esc(o.id)}"${String(o.id) === String(cur) ? ' checked' : ''}><b>${esc(o.label)}</b>${o.sub ? `<small>${esc(o.sub)}</small>` : ''}</label>`).join('');

  root.className = 'mb';
  root.innerHTML = `
    <div class="mb-map">
      <div class="mb-sheet"><canvas aria-hidden="true"></canvas></div>
      <div class="mb-cap"><span class="mb-name"></span><span class="mb-size"></span></div>
      <p class="mb-blurb"></p>
    </div>
    <form class="mb-form card" aria-label="${hotseat ? 'Hotseat einrichten' : 'Gefecht frei einrichten'}">
      <h1>Marschbefehl</h1>
      <p class="mb-sub">${hotseat ? 'Hotseat: zwei Kommandos an einem Gerät. Wer gerade nicht dran ist, schaut weg.' : koop ? 'Koop: Kommando Nord und Kommando Süd teilen Abschnitt, Depot und Loren gegen die KI. Nord plant zuerst und schreibt Süd einen Zettel.' : 'Gefecht frei gegen das Kommando von drüben.'}</p>
      <fieldset class="mb-field"><legend>Abschnitt</legend><div class="mb-opts">${radio('karte', mapOpts, choice.map)}</div>
        <div class="mb-seed"${choice.map === 'zufall' ? '' : ' hidden'}><input type="text" inputmode="numeric" maxlength="9" aria-label="Seed der Zufallskarte" value="${choice.mapSeed}"><button type="button" class="btn mb-roll">Neu würfeln</button></div>
      </fieldset>
      <fieldset class="mb-field"><legend>${hotseat ? 'Im Westen führt' : 'Du führst'}</legend><div class="mb-opts">${radio('fraktion', FACTION_IDS.map((id) => ({ id, label: FACTIONS[id].name, sub: id === 'kaldern' ? 'wenige Leute, präzise Artillerie' : 'große Gruppen, zäh, Artillerie streut' })), choice.faction)}</div></fieldset>
      ${hotseat ? '' : `<fieldset class="mb-field"><legend>Gegner</legend><div class="mb-opts">${radio('ki', DIFFICULTY_IDS.map((id) => ({ id, label: DIFFICULTIES[id].label, sub: DIFF_TEXT[id] })), choice.difficulty)}</div></fieldset>`}
      <fieldset class="mb-field"><legend>Dauer</legend><div class="mb-opts">${radio('runden', ROUNDS.map((r) => ({ id: r.n, label: r.label, sub: r.sub })), choice.rounds)}</div></fieldset>
      <div class="mb-go">
        <div class="mb-sigline">gez.<span class="mb-sig" aria-hidden="true"></span></div>
        <button type="submit" class="btn mb-start">Befehl unterschreiben</button>
        <a class="mb-back" href="./">Zurück zum Hauptmenü</a>
      </div>
    </form>`;
  const $ = (s) => root.querySelector(s);
  const form = $('.mb-form');
  const canvas = $('.mb-sheet canvas');
  const seedBox = $('.mb-seed');
  const seedInput = seedBox.querySelector('input');

  // Kartenvorschau: dieselbe statische Ebene wie im Gefecht, ganzes Blatt
  let asseJson = null;
  let map = null, layer = null, cam = null;
  async function currentJson() {
    if (choice.map === 'asse') {
      asseJson ??= await fetch('data/maps/asse.json').then((r) => r.json());
      return asseJson;
    }
    return mapJsonFor(choice);
  }
  function fit() {
    if (!cam) return;
    const box = $('.mb-sheet');
    const w = box.clientWidth, h = box.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    resizeCamera(cam, w, h);
    centerOn(cam, map.width / 2, map.height / 2, fitZoom(cam));
    layer.resize(w, h, dpr);
  }
  let token = 0;
  async function preview() {
    const my = ++token;
    const json = await currentJson();
    if (my !== token) return;
    map = loadMap(json);
    if (!layer) {
      cam = createCamera({ bounds: sheetBounds(map), maxZoom: 60 });
      layer = createMapLayer(canvas, map, { getCamera: () => cam, getTheme: currentTheme });
    } else {
      cam.bounds = sheetBounds(map);
      layer.setMap(map);
    }
    fit();
    const bm = BATTLE_MAPS.find((m) => m.id === choice.map);
    $('.mb-name').textContent = map.sheet?.title || map.name;
    $('.mb-size').textContent = `${map.width} × ${map.height} Felder${json.symmetry ? (json.symmetry === 'punkt' ? ' · punktgespiegelt' : ' · gespiegelt') : ''}`;
    const other = FACTIONS[otherFaction(choice.faction)].short;
    $('.mb-blurb').textContent = bm?.blurb ?? `Erzeugt aus Seed ${choice.mapSeed}. Beide Seiten haben dasselbe Gelände; drüben heißt jeder Ort so, wie ${other} ihn nennt.`;
  }
  new ResizeObserver(() => { fit(); }).observe($('.mb-sheet'));

  form.addEventListener('change', (e) => {
    const t = e.target;
    if (t.name === 'karte') { choice.map = t.value; seedBox.hidden = choice.map !== 'zufall'; }
    else if (t.name === 'fraktion') choice.faction = t.value;
    else if (t.name === 'ki') choice.difficulty = t.value;
    else if (t.name === 'runden') choice.rounds = Number(t.value);
    else return;
    playSfx('paper', { intensity: 0.3 });
    if (t.name === 'karte' || t.name === 'fraktion') preview();
  });
  seedInput.addEventListener('change', () => {
    const v = (Number(seedInput.value.replace(/\D/g, '')) >>> 0) || 1;
    seedInput.value = String(v);
    choice.mapSeed = v;
    preview();
  });
  $('.mb-roll').addEventListener('click', () => {
    choice.mapSeed = newSeed();
    seedInput.value = String(choice.mapSeed);
    playSfx('pencil', { count: 2, intensity: 0.4 });
    preview();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // Enter im Seed-Feld loest kein change aus: den Wert hier noch einmal lesen
    if (choice.map === 'zufall') choice.mapSeed = (Number(seedInput.value.replace(/\D/g, '')) >>> 0) || 1;
    const q = new URLSearchParams({ scene: 'gefecht', karte: choice.map, fraktion: choice.faction, runden: String(choice.rounds) });
    if (choice.map === 'zufall') q.set('kseed', String(choice.mapSeed));
    if (hotseat) q.set('mode', 'hotseat');
    else q.set('ki', choice.difficulty);
    if (koop) q.set('mode', 'koop');
    // Unterschrift mit Bleistift, dann geht es los
    const sig = $('.mb-sig');
    sig.textContent = hotseat ? 'beide Kommandos' : koop ? 'Nord und Süd' : FACTIONS[choice.faction].short + ', Abschnittsführung';
    playSfx('pencil', { count: 6, intensity: 0.6 });
    playSfx('stamp', { delay: 0.5 });
    $('.mb-start').disabled = true;
    setTimeout(() => { location.href = '?' + q.toString(); }, 650);
  });

  await preview();
}
