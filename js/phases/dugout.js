// Unterstand (Plan 4.1 Nr. 4, 10.6 Gefechtsrunde Schritt 3). Rein: kein DOM, kein Date, kein Math.random.
//
// Der Wettlauf zum Grabenrand:
// - Gruppen in einem eigenen Graben ab Stufe 2 (Schuetzengraben, nicht erobert) haben einen Unterstand.
// - Wer unter Beschuss steht (niedergehalten aus der Vorrunde oder in dieser Runde von Artillerie getroffen,
//   g.shelled, setzt die Artillerie aus P09 vor dieser Phase), geht von selbst hinein, ausser er hat einen Befehl zu laufen oder zu
//   feuern. Befehl "dugout" (Deckung) schickt ausdruecklich hinein.
// - Im Unterstand: unerreichbar fuer Feuer, sieht und wird nur aus dem Nachbarfeld gesehen, feuert nicht,
//   bewegt sich nicht (sight.js, rules.js, fire.js, move.js beachten inDugout).
// - Herauskommen dauert eine Gefechtsrunde: In der Runde, in der der Beschuss aufhoert (oder ein anderer Befehl
//   kommt), steigt die Gruppe die Stufen hinauf (dugout = 'leaving', weiter inDugout). Erst in der Runde danach
//   steht sie an der Brustwehr und kann feuern. Hoert die Feuerwalze zu frueh auf, ist der Verteidiger oben,
//   bevor der Sturm ankommt.
// Zustand je Gruppe: inDugout (bool), dugout: 'in' | 'leaving' | undefined.
import { registerPhase, ORDER } from './registry.js';
import { flagFor } from '../modifiers.js';
import { registerOrderValidator } from '../orders.js';
import { cellLabel } from '../map.js';
import { trenchAt, PINNED } from '../sight.js';
import { surname } from './hold.js';

/** Unterstaende gibt es ab dieser Grabenstufe */
export const DUGOUT_MIN_LEVEL = 2;

/** Befehle, mit denen eine Gruppe unter Beschuss trotzdem oben bleibt */
export const STAY_UP = new Set(['move', 'assault', 'fire', 'sector']);

const mapSideOf = (side) => (side === 'a' ? 'own' : 'enemy');

/** Hat die Gruppe an ihrer Stelle einen Unterstand? (eigener, nicht eroberter Graben ab Stufe 2) */
export function hasDugout(state, map, pos, side) {
  const t = trenchAt(state, map, pos.x, pos.y);
  return !!t && t.side === mapSideOf(side) && !t.captured && (t.level ?? 0) >= DUGOUT_MIN_LEVEL;
}

/** Steht die Gruppe unter Beschuss, der sie in den Unterstand treibt? */
export function threatened(group) {
  return !!group.shelled || (group.suppressed ?? 0) >= PINNED;
}

registerOrderValidator('dugout', (order, group, state, env) => {
  if (group.inDugout) return null;
  if (!hasDugout(state, env.map ?? null, group.pos, group.side)) return 'hier gibt es keinen Unterstand (eigener Graben ab Stufe 2)';
  return null;
});

function runDugout(ctx) {
  const map = ctx.map;
  for (const g of ctx.groups()) {
    const o = ctx.orderFor(g.id);
    const type = o?.type ?? 'hold';
    const name = 'Gruppe ' + surname(g.leader.name);
    const hot = threatened(g);
    const ev = (t, reason, extra = {}) => ctx.emit(t, { side: g.side, group: g.id, secret: true, reason, at: { ...g.pos }, ...extra });
    if (g.inDugout) {
      const stay = type === 'dugout' || (hot && !STAY_UP.has(type));
      if (g.dugout === 'leaving') {
        if (stay) {
          g.dugout = 'in';
          ev('dugout_back', hot
            ? `${name} muss zurück in den Unterstand: das Feuer liegt wieder auf dem Graben.`
            : `${name} bleibt auf Befehl im Unterstand.`);
        } else {
          g.inDugout = false;
          delete g.dugout;
          ev('dugout_out', `${name} ist oben und steht an der Brustwehr.`, { minor: false });
        }
      } else if (!stay && flagFor('exit', { state: ctx.state, group: g })) {
        // P23: wachsame Gruppen (Veteranen) sind sofort oben
        g.inDugout = false;
        delete g.dugout;
        ev('dugout_out', `${name} ist sofort oben: die Gruppe schläft mit dem Gewehr im Arm.`, { minor: false });
      } else if (!stay) {
        g.dugout = 'leaving';
        ev('dugout_leave', `${name} kommt aus dem Unterstand. Bis alle an der Brustwehr stehen, vergeht eine Runde.`);
      } else {
        ev('dugout_stay', `${name} wartet im Unterstand${g.shelled ? ', über ihr schlägt es ein' : ''}.`, { minor: true });
      }
    } else {
      const want = type === 'dugout' || (hot && !STAY_UP.has(type));
      if (!want) continue;
      if (!hasDugout(ctx.state, map, g.pos, g.side)) {
        if (type === 'dugout') ev('dugout_none', `${name} findet bei ${cellLabel(g.pos.x, g.pos.y)} keinen Unterstand und duckt sich in die Deckung.`, { minor: true });
        continue;
      }
      g.inDugout = true;
      g.dugout = 'in';
      ev('dugout_in', type === 'dugout'
        ? `${name} geht in den Unterstand bei ${cellLabel(g.pos.x, g.pos.y)}.`
        : `${name} flüchtet unter Beschuss in den Unterstand bei ${cellLabel(g.pos.x, g.pos.y)}.`);
    }
  }
  // g.shelled loescht die Phase 'shelled' aus js/phases/artillery.js nach der Bewegung
}

registerPhase({ id: 'dugout', kind: 'battle', order: ORDER.battle.dugout, run: runDugout });
