// Der letzte Tag (Paket P26, Mission a4m6). Rein: kein DOM, kein Date, kein Math.random.
// Nach dem Weiterstellen der Uhr: Ist die Stunde des Waffenstillstands da (state.day.ceasefireAfter Stunden nach
// Beginn), gilt ab jetzt eine Waffenruhe ohne Ende (js/truce.js); wer danach schiesst, bricht sie. Ist die Stunde der
// Uebergabe da (handoverAfter), wird der Abschnitt uebergeben: das Missionsziel liest state.day.handover.
import { registerPhase, ORDER } from './registry.js';
import { setTruce } from '../truce.js';

/** Stunden seit Beginn der Mission */
export function hoursSince(state) {
  const s = state?.day?.start;
  if (!s) return 0;
  return (state.clock.day - s.day) * 24 + state.clock.hour - s.hour + Math.floor((state.clock.minute ?? 0) / 60);
}

const mid = (state) => ({ x: Math.floor(state.map.width / 2), y: Math.floor(state.map.height / 2) });

function runLastDay(ctx) {
  const s = ctx.state;
  const d = s.day;
  if (!d) return;
  const h = hoursSince(s);
  if (Number.isInteger(d.ceasefireAfter) && !d.ceasefire && h >= d.ceasefireAfter) {
    d.ceasefire = ctx.turn;
    // Der Waffenstillstand gilt immer, auch wenn vorher eine Waffenruhe gebrochen wurde: neu ansetzen
    setTruce(s, { status: 'active', by: 'b', turn: ctx.turn, until: 9999, accepted: ctx.turn, ceasefire: true });
    ctx.emit('ceasefire', {
      public: true,
      reason: 'Zwölf Uhr. Auf beiden Seiten schlägt jemand mit dem Spaten gegen eine leere Granathülse. Ab jetzt fällt zwischen den Linien kein Schuss mehr.',
      at: mid(s),
    });
  }
  if (Number.isInteger(d.handoverAfter) && !d.handover && h >= d.handoverAfter) {
    d.handover = ctx.turn;
    ctx.emit('handover', {
      public: true,
      reason: 'Mittag. Major Kuiper kommt mit seinem Stab durch den Laufgraben. Der Abschnitt wird übergeben.',
      at: mid(s),
    });
  }
}

registerPhase({ id: 'lastday', kind: 'both', order: { position: ORDER.position.clock + 1, battle: ORDER.battle.clock + 1 }, run: runLastDay });
