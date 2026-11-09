// Panzerwagen (Plan 4.2 Nr. 24, Paket P26). Rein: kein DOM, kein Date, kein Math.random. Regeln in js/tank.js.
// Phasen:
//   tank-drive (vor der Bewegung) Je Feld auf dem Weg, das der Wagen in dieser Runde erreicht, ein Wurf: bleibt er
//              stecken, endet sein Weg dort.
//   tank       (nach der Bewegung) Steckt er fest, steht das im Protokoll. Feinde neben einem fahrenden Wagen
//              erschrecken (Unterdrueckung, Moral, einmal je Gefecht). In der Stellungsrunde bergen Pioniere daneben
//              einen festsitzenden Wagen mit etwas Glueck.
// Ausserdem: Panzerung gegen Gewehre und MG (Register 'armor'), Wucht im Nahkampf (Register 'melee'),
// ein festsitzender Wagen nimmt keine Fahrbefehle an.
import { registerPhase, ORDER } from './registry.js';
import { registerOrderValidator } from '../orders.js';
import { registerModifier } from '../modifiers.js';
import { cellLabel, distance } from '../map.js';
import { otherSide } from '../state.js';
import { roundsAlong } from './move.js';
import { isTank, stuckChance, armorPct } from '../tank.js';
import { TANK } from '../config/akt4.js';
import { groupLabel } from '../harm.js';

registerModifier('armor', 'tank', ({ state, shooter, target }) => armorPct(state, shooter, target));
registerModifier('melee', 'tank', ({ group }) => (isTank(group) ? TANK.meleePct : null));

const DRIVE = new Set(['move', 'assault', 'attack', 'redeploy']);
for (const type of DRIVE) {
  registerOrderValidator(type, (order, group) => (isTank(group) && group.stuck ? 'Der Panzerwagen sitzt fest. Erst Pioniere daneben, dann fährt er wieder' : null));
}

const label = (g) => 'Panzerwagen ' + (g.callsign ?? 'K1');

function movesNow(type, kind) {
  return kind === 'battle' ? type === 'move' || type === 'assault' : type === 'redeploy';
}

function runDrive(ctx) {
  const { state, map } = ctx;
  for (const g of ctx.groups().filter(isTank)) {
    delete g.stuckAt;
    const o = ctx.orderFor(g.id);
    if (!o || !movesNow(o.type, ctx.kind) || !o.path?.length || g.stuck) continue;
    const reach = Math.max(1, roundsAlong(map, state, g, o.path, ctx.kind, o.type).reach);
    for (let i = 0; i < Math.min(reach, o.path.length); i++) {
      const p = o.path[i];
      const pct = stuckChance(map, state, p);
      if (ctx.rng() * 100 < pct) {
        g.stuckAt = { x: p.x, y: p.y, pct };
        o.path = o.path.slice(0, i + 1);
        break;
      }
    }
    // Getriebe: auf langen Fahrten hinter der Linie
    if (!g.stuckAt && ctx.kind === 'position' && ctx.rng() * 100 < TANK.breakdownPct) {
      const p = o.path[Math.min(reach, o.path.length) - 1];
      g.stuckAt = { x: p.x, y: p.y, pct: TANK.breakdownPct, gearbox: true };
    }
  }
}

function runTank(ctx) {
  const { state } = ctx;
  const battleId = state.battle?.startTurn ?? ctx.turn;
  for (const g of ctx.groups().filter(isTank)) {
    const moved = ctx.log.some((e) => e.group === g.id && e.from && e.to && (e.from.x !== e.to.x || e.from.y !== e.to.y));
    if (g.stuckAt) {
      const at = g.stuckAt;
      delete g.stuckAt;
      if (g.pos.x === at.x && g.pos.y === at.y) {
        g.stuck = ctx.turn;
        const c = state.cells?.[at.x + ',' + at.y];
        const why = at.gearbox ? 'das Getriebe kreischt und schweigt' : (c?.crater ?? 0) > 0 ? 'im Trichter, schräg, eine Kette in der Luft' : 'der Lehm hält die Ketten fest';
        ctx.emit('tank_stuck', {
          side: g.side, group: g.id, public: true, chance: at.pct,
          reason: `${label(g)} bleibt bei ${cellLabel(at.x, at.y)} liegen: ${why}. Er schießt noch, aber er fährt nicht mehr.`,
          at: { ...g.pos },
        });
      }
    }
    if (ctx.kind === 'battle' && moved) {
      for (const f of ctx.groups(otherSide(g.side)).filter((x) => distance(x.pos, g.pos) <= TANK.shockRadius && x.tankShock !== battleId)) {
        f.tankShock = battleId;
        f.suppressed = Math.min(1, Math.floor(((f.suppressed ?? 0) + TANK.shockSuppression) * 100 + 0.5) / 100);
        f.morale = Math.max(0, (f.morale ?? 70) - TANK.shockMorale);
        ctx.emit('tank_shock', {
          side: f.side, group: f.id, public: true, tank: g.id,
          reason: `${groupLabel(f)} sieht den Kasten auf sich zukommen. Nichts, was sie haben, hilft dagegen. Die Gruppe duckt sich.`,
          at: { ...f.pos },
        });
      }
    }
    // Bergen in der Stellungsrunde: Pioniere daneben, die nichts anderes tun
    if (ctx.kind === 'position' && g.stuck && g.stuck < ctx.turn) {
      const crew = ctx.groups(g.side).filter((x) => x.type === 'pioneers' && distance(x.pos, g.pos) <= 1 && !x.inDugout)
        .filter((x) => { const o = ctx.orderFor(x.id); return !o || o.type === 'hold'; });
      if (!crew.length) continue;
      if (ctx.rng() * 100 < TANK.freePct) {
        delete g.stuck;
        ctx.emit('tank_freed', {
          side: g.side, group: g.id, secret: true, by: crew[0].id,
          reason: `${groupLabel(crew[0])} gräbt ${label(g)} frei, Bohlen unter die Ketten, Seile an den Haken. Er fährt wieder.`,
          at: { ...g.pos },
        });
      } else {
        ctx.emit('tank_dig', {
          side: g.side, group: g.id, secret: true, minor: true, by: crew[0].id,
          reason: `${groupLabel(crew[0])} gräbt die ganze Nacht um ${label(g)} herum. Er sitzt noch fest.`,
          at: { ...g.pos },
        });
      }
    }
  }
}

registerPhase({ id: 'tank-drive', kind: 'both', order: { position: ORDER.position.movement - 2, battle: ORDER.battle.movement - 2 }, run: runDrive });
registerPhase({ id: 'tank', kind: 'both', order: { position: ORDER.position.movement + 2, battle: ORDER.battle.movement + 2 }, run: runTank });
