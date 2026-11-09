// Spiellogik fuer die Edge Functions (P20): dieselben reinen Module wie im Browser, fest auf einen Commit
// gepinnt und beim Deploy gebuendelt. So rechnet der Server genau die Regeln dieses Stands, bis neu deployt
// wird. Neuer Stand: node tools/sync-functions.mjs --pin <commit> und die Functions neu deployen.
// pin: 9d47b15e1c606d0dd357bef6ffca4076544625ab
export {
  startMatch, resolveMatch, deadlineMs, matchRecord, normalizeCode, initSeedFor,
} from 'https://cdn.jsdelivr.net/gh/hjorven/lehmfront@9d47b15e1c606d0dd357bef6ffca4076544625ab/js/online/match.js';
export { replayDaily } from 'https://cdn.jsdelivr.net/gh/hjorven/lehmfront@9d47b15e1c606d0dd357bef6ffca4076544625ab/js/online/replay.js';
