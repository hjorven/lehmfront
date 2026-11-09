// Gefecht laden je nach Modus (P17). Liest die Query-Parameter der Szene "gefecht":
//   karte=zufall|asse|velde|kraehenholz|schacht, kseed=<Kartenseed>, fraktion=kaldern|morrow, ki=rekrut|veteran|lask,
//   mode=hotseat, endlos=1 (Frontabschnitt, P22), runden=<Stellungsrunden bis zur Abschlussmeldung, 0 = offen>, tageslage=<JJJJMMTT>.
// Ohne karte und tageslage bleibt alles wie vorher (scenario=<id> aus data/scenarios/).
import { battleMap } from '../config/battlemaps.js';
import {
  FACTION_IDS, DIFFICULTY_IDS, validDayKey, mapJsonFor, skirmishScenario, adaptFixedScenario, dailyBrief, dailyMap,
} from './skirmish.js';

const num = (v, d) => (v === null || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/**
 * Liefert { scenario, mapJson, scenId, seed?, mode: { kind, limit, key?, label } }.
 * fetchJson(url) laedt eine Datei (wirft bei Fehlern).
 */
export async function loadBattle(params, fetchJson) {
  const tl = params.get('tageslage');
  const karte = params.get('karte');
  const hotseat = params.get('mode') === 'hotseat';
  const endlos = params.has('endlos'); // P22: Woche im Frontabschnitt; der Zustand kommt aus dem Speicher des Laufs
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
    : { kind: hotseat ? 'hotseat' : 'frei', limit, label: hotseat ? 'Hotseat' : 'Gefecht frei', faction, difficulty };
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
