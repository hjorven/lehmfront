// Ablaufplan einer Mission (P16): Wetter nach Plan statt gewuerfelt. Laeuft in der Stellungsrunde vor dem Wetter,
// setzt state.weather.kind fest; die Wetter-Phase rechnet danach Naesse, Wasser und Schlamm wie immer.
// Ohne state.mission (freies Gefecht) tut die Phase nichts.
import { registerPhase, ORDER } from './registry.js';
import { entryAt, missionRound } from '../missions/script.js';
import { WEATHER_KINDS } from '../weather.js';

registerPhase({
  id: 'mission',
  kind: 'position',
  order: ORDER.position.weather - 5,
  run(ctx) {
    const plan = ctx.state.mission?.weather;
    if (!plan?.length) return;
    // Am Ende von Runde n gilt schon das Wetter von Runde n + 1: die Uhr zeigt es beim Planen
    const e = entryAt(plan, missionRound(ctx.state) + 1);
    if (!e || !WEATHER_KINDS.includes(e.kind)) return;
    const w = ctx.state.weather ?? {};
    // rain/fog neu berechnen lassen, wenn das Wetter wechselt
    const next = { ...w, kind: e.kind, fixed: true };
    if (e.kind !== w.kind) { delete next.rain; delete next.fog; }
    ctx.state.weather = next;
  },
});
