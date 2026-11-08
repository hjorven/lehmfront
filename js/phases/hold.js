// Beispiel-Phase: Halten (Standardbefehl, Plan 3.4). Zaehlt, wie lange eine Gruppe am selben Platz haelt.
// holdTurns ist der Haken fuer spaetere Pakete (P12: "zu lange vorn", Vertrauen, Ablösung).
// Die Begruendungen werden mit der Dauer ruhiger und muerber: die Truppe richtet sich ein.
import { registerPhase, ORDER } from './registry.js';

export function surname(leaderName) {
  const i = leaderName.indexOf(' ');
  return i < 0 ? leaderName : leaderName.slice(i + 1);
}

// Je Dauerstufe mehrere Saetze, gewaehlt mit dem Phasen-Zufall (deterministisch)
const POSITION_LINES = [
  [ // 1. Runde
    'hält die Stellung.',
    'hält die Stellung, Posten sind eingeteilt.',
  ],
  [ // 2 bis 3
    'hält. Die Posten wechseln stündlich.',
    'hält. Sandsäcke werden nachgestopft.',
    'hält. Im Unterstand wird Kaffee gekocht, der nach Lehm schmeckt.',
  ],
  [ // 4 bis 6
    'hält seit {n} Runden und kennt inzwischen jeden Sandsack.',
    'hält seit {n} Runden. Jemand hat ein Namensschild an den Unterstand genagelt.',
    'hält seit {n} Runden. Die Ratten haben sich an die Gruppe gewöhnt.',
  ],
  [ // ab 7
    'hält seit {n} Runden. Es wird nach Ablösung gefragt.',
    'hält seit {n} Runden. Die Briefe nach Hause werden kürzer.',
  ],
];

const BATTLE_LINES = [
  'hält und wartet.',
  'hält, die Gewehre auf der Brustwehr.',
];

function stage(n) {
  return n <= 1 ? 0 : n <= 3 ? 1 : n <= 6 ? 2 : 3;
}

export function holdReason(rng, group, implicit, kind) {
  const who = 'Gruppe ' + surname(group.leader.name);
  const n = group.holdTurns;
  const lines = kind === 'battle' ? BATTLE_LINES : POSITION_LINES[stage(n)];
  const line = lines[Math.floor(rng() * lines.length)].replace('{n}', String(n));
  return implicit ? `${who} hat keinen Befehl und ${line}` : `${who} ${line}`;
}

registerPhase({
  id: 'hold',
  kind: 'both',
  // direkt nach der Bewegung: wer sich bewegt hat, haelt nicht
  order: { position: ORDER.position.movement + 5, battle: ORDER.battle.movement + 5 },
  run(ctx) {
    for (const g of ctx.groups()) {
      const o = ctx.orderFor(g.id);
      if (!o || o.type !== 'hold') {
        g.holdTurns = 0;
        continue;
      }
      g.holdTurns += 1;
      ctx.emit('hold', {
        side: g.side,
        group: g.id,
        implicit: o.implicit === true,
        holdTurns: g.holdTurns,
        minor: true,
        reason: holdReason(ctx.rng, g, o.implicit === true, ctx.kind),
        at: g.pos,
      });
    }
  },
});
