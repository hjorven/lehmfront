// Gefecht laden je nach Modus (P17). Liest die Query-Parameter der Szene "gefecht":
//   karte=zufall|asse|velde|kraehenholz|schacht, kseed=<Kartenseed>, fraktion=kaldern|morrow, ki=rekrut|veteran|lask,
//   mode=hotseat, endlos=1 (Frontabschnitt, P22), runden=<Stellungsrunden bis zur Abschlussmeldung, 0 = offen>, tageslage=<JJJJMMTT>.
// Ohne karte und tageslage bleibt alles wie vorher (scenario=<id> aus data/scenarios/).
// P25: puzzle=<datei> (Puzzle-Lage aus data/puzzles/), lage=<Code> (selbstgebaute Lage aus der Werkstatt),
//   mode=koop (zwei Kommandos teilen Seite a gegen die KI, sonst wie Gefecht frei).
import { battleMap } from '../config/battlemaps.js';
import { puzzleFile } from '../config/puzzles.js';
import { puzzleMapJson, puzzleScenario, preparePuzzleState, scriptedOrders } from './puzzle.js';
import { decodeLage } from './lage-code.js';
import {
  FACTION_IDS, DIFFICULTY_IDS, validDayKey, mapJsonFor, skirmishScenario, adaptFixedScenario, dailyBrief, dailyMap,
} from './skirmish.js';

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/**
 * Liefert { scenario, mapJson, scenId, seed?, mode: { kind, limit, key?, label } }.
 * fetchJson(url) laedt eine Datei (wirft bei Fehlern).
 */
export async function loadBattle(params, fetchJson) {
  const extra = await loadLage(params, fetchJson);
  if (extra) return extra;
  const tl = params.get('tageslage');
  const karte = params.get('karte');
  const hotseat = params.get('mode') === 'hotseat';
  const endlos = params.has('endlos'); // P22: Woche im Frontabschnitt; der Zustand kommt aus dem Speicher des Laufs
  const koop = !endlos && params.get('mode') === 'koop';
  if (tl && validDayKey(tl)) {
    const brief = dailyBrief(Number(tl));
    const mapJson = dailyMap(brief);
    const scenario = skirmishScenario(mapJson, { faction: brief.faction, difficulty: brief.difficulty, seed: brief.seed });
    scenario.id = 'tageslage-' + tl;
    scenario.name = 'Tageslage';
    return {
      scenario, mapJson, scenId: scenario.id, seed: brief.seed,
      mode: { kind: 'tageslage', limit: brief.rounds, key: brief.key, label: 'Tageslage', faction: brief.faction },
    };
  }
  if (!karte) {
    const scenId = /^[a-z0-9-]+$/.test(params.get('scenario') || '') ? params.get('scenario') : 'asse-frei';
    // Kampagnenmissionen (P16 ff.) liegen unter data/missions/akt<n>-m<n>.json
    const dir = /^akt\d+-m\d+$/.test(scenId) ? 'missions' : 'scenarios';
    const scenario = await fetchJson(`data/${dir}/${scenId}.json`);
    const mapJson = await fetchJson(`data/maps/${scenario.map}.json`);
    return { scenario, mapJson, scenId, mode: { kind: hotseat ? 'hotseat' : 'frei', limit: num(params.get('runden'), 0) } };
  }
  const faction = FACTION_IDS.includes(params.get('fraktion')) ? params.get('fraktion') : 'kaldern';
  const difficulty = DIFFICULTY_IDS.includes(params.get('ki')) ? params.get('ki') : 'veteran';
  const limit = Math.max(0, Math.min(60, num(params.get('runden'), 0) | 0));
  const mode = endlos
    ? { kind: 'endlos', limit: 0, label: 'Frontabschnitt', faction, difficulty }
    : { kind: hotseat ? 'hotseat' : koop ? 'koop' : 'frei', limit, label: hotseat ? 'Hotseat' : koop ? 'Koop' : 'Gefecht frei', faction, difficulty };
  if (karte === 'zufall') {
    const mapSeed = (num(params.get('kseed'), 1) >>> 0) || 1;
    const mapJson = mapJsonFor({ map: 'zufall', mapSeed, faction });
    const scenario = skirmishScenario(mapJson, { faction, difficulty, seed: mapSeed, hotseat });
    return { scenario, mapJson, scenId: scenario.id, mode: { ...mode, map: 'zufall', mapSeed } };
  }
  const bm = battleMap(karte);
  if (!bm) throw new Error('Unbekannte Karte: ' + karte);
  if (bm.kind === 'file') {
    const base = await fetchJson(`data/scenarios/${bm.scenario}.json`);
    const scenario = adaptFixedScenario(base, { faction, difficulty, hotseat });
    const mapJson = await fetchJson(`data/maps/${scenario.map}.json`);
    return { scenario, mapJson, scenId: bm.scenario, mode: { ...mode, map: bm.id } };
  }
  const mapJson = mapJsonFor({ map: bm.id, faction });
  const scenario = skirmishScenario(mapJson, { faction, difficulty, seed: bm.spec.seed, hotseat });
  return { scenario, mapJson, scenId: scenario.id, mode: { ...mode, map: bm.id } };
}

/**
 * P25: Puzzle-Lage oder selbstgebaute Lage. Liefert wie loadBattle, dazu
 * lage (Lage mit Ziel fuer js/ui/lage-rules.js), lageKind ('puzzle' | 'mission'), prepare(state) und
 * ordersB(state) (Drehbuch statt KI). null, wenn die Abfrage keine solche Lage nennt.
 */
export async function loadLage(params, fetchJson) {
  const pz = params.get('puzzle');
  if (pz) {
    const file = puzzleFile(pz);
    if (!file) throw new Error('Unbekannte Puzzle-Lage: ' + pz);
    const p = await fetchJson(file);
    const mapJson = puzzleMapJson(p);
    const scenario = puzzleScenario(p);
    return {
      scenario, mapJson, scenId: scenario.id, seed: p.seed ?? 1,
      prepare: (state) => preparePuzzleState(p, state),
      ordersB: (state) => scriptedOrders(p, state),
      lage: p, lageKind: 'puzzle',
      mode: { kind: 'puzzle', limit: 0, label: 'Puzzle-Lage' },
    };
  }
  const code = params.get('lage');
  if (code) {
    const l = await decodeLage(code);
    const scenario = structuredClone(l.scenario);
    scenario.id = 'lage-eigen';
    scenario.name = l.title || 'Eigene Lage';
    const holds = scenario.sides.b.control !== 'ai';
    const out = {
      scenario, mapJson: l.map, scenId: scenario.id, seed: l.seed ?? 1,
      mode: { kind: 'frei', limit: l.goal ? 0 : num(l.limit, 0), label: 'Eigene Lage' },
    };
    if (l.kind === 'battle') out.prepare = (state) => (state.battle ? state : { ...state, turnKind: 'battle', battle: { round: 1 } });
    if (holds) out.ordersB = () => [];
    if (l.goal) {
      out.lage = { id: 'eigen', title: l.title || 'Eigene Lage', brief: l.brief ?? '', goal: l.goal, limit: num(l.limit, 8),
        maxLosses: Number.isFinite(l.maxLosses) ? l.maxLosses : undefined, lesson: l.author ? 'von ' + l.author : '' };
      out.lageKind = 'mission';
    }
    return out;
  }
  return null;
}
