// Kampagnenstand im Browser (P14): der Feldzug und die Rueckmeldung einer Mission an die Feldzugskarte.
// localStorage mit Rueckfall in den Speicher (privates Fenster, gesperrter Speicher). Reines JSON.

const KEY = 'lehmfront-campaign';
const START = 'lehmfront-campaign-start';
const RETURN = 'lehmfront-campaign-return';
const mem = new Map();

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw != null) return JSON.parse(raw);
  } catch { /* gesperrt oder kaputt: Speicher im RAM */ }
  return mem.has(key) ? structuredClone(mem.get(key)) : null;
}

function write(key, value) {
  mem.set(key, structuredClone(value));
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadCampaign = () => read(KEY);
export const saveCampaign = (c) => write(KEY, c);
export const clearCampaign = () => { write(KEY, null); write(START, null); write(RETURN, null); };

/** Beim Aufbruch zur Mission: { mission, seed, scenario, start: { reputation, trust } } */
export const loadMissionStart = () => read(START);
export const saveMissionStart = (s) => write(START, s);

/** Rueckmeldung nach der Mission: { mission, outcome, orderMet, why, rounds, finalState, start } */
export const loadMissionReturn = () => read(RETURN);
export const saveMissionReturn = (r) => write(RETURN, r);
export const clearMissionReturn = () => { write(RETURN, null); write(START, null); };
