// Spiellogik fuer die Edge Functions (P20): dieselben reinen Module wie im Browser, fest auf einen Commit
// gepinnt und beim Deploy gebuendelt. So rechnet der Server genau die Regeln dieses Stands, bis neu deployt
// wird. Neuer Stand: node tools/sync-functions.mjs --pin <commit> und die Functions neu deployen.
// pin: d79a0ed935ac7963c18de5e0ddb11902eaa14464
export {
  startMatch, resolveMatch, deadlineMs, matchRecord, normalizeCode, initSeedFor,
} from 'https://cdn.jsdelivr.net/gh/hjorven/lehmfront@d79a0ed935ac7963c18de5e0ddb11902eaa14464/js/online/match.js';
export { replayDaily } from 'https://cdn.jsdelivr.net/gh/hjorven/lehmfront@d79a0ed935ac7963c18de5e0ddb11902eaa14464/js/online/replay.js';
