// Bleistiftnotizen aus dem Protokoll (Idee aus P02, docs/ideen.md): Geht in einer Runde etwas schief, das man
// beim naechsten Mal anders machen kann, schreibt jemand mit Bleistift an die Stelle, was gefehlt hat
// ("Traverse fehlt!" mit Pfeil). Die Notizen bleiben fuer die Mission auf dem Blatt, weil sie aus dem
// Protokoll-Archiv entstehen (auch nach dem Laden). Gut fuer Anfaenger: die Karte erklaert die Begruendungen.
//
// marginNotes(rounds, side) ist rein (rounds = archive.rounds oder [{ turn, log }]), marginOverlay(...) zeichnet.
import { FONTS } from '../render/map-layer.js';

/** Regeln: Ereignis der eigenen Seite -> kurze Notiz mit Werkzeughinweis */
export const NOTE_RULES = [
  { kind: 'traverse', when: (e) => e.type === 'losses' && e.cause === 'enfilade', text: 'Traverse fehlt! (Graben G)' },
  { kind: 'reversed', when: (e) => e.type === 'losses' && e.cause === 'reversed', text: 'erst umbauen (U)' },
  { kind: 'wire', when: (e) => e.type === 'assault' && !!e.wire, text: 'Draht! Erst Gasse schneiden', at: (e) => e.wire },
  { kind: 'flood', when: (e) => e.type === 'flood', text: 'Wasser: entwässern (W)' },
  { kind: 'blocked', when: (e) => e.type === 'supply_blocked', text: 'Weg zu: Loren kommen nicht durch' },
  { kind: 'hunger', when: (e) => e.type === 'iron_ration' || e.type === 'ammo_short', text: 'Lorenplan prüfen (L)' },
  { kind: 'open', when: (e) => e.type === 'losses' && e.cause === 'artillery' && e.open, text: 'ohne Deckung: eingraben (G)' },
  { kind: 'friendly', when: (e) => e.type === 'losses' && e.cause === 'friendly_fire', text: 'eigene Walze zu dicht!' },
];

/** So viele Notizen hoechstens; gleiche Art in der Naehe wird zusammengefasst (die juengste bleibt) */
export const MAX_NOTES = 6;
export const MERGE_RANGE = 4;

/**
 * Notizen fuer eine Seite aus den Runden des Archivs. Liefert [{ kind, text, x, y, turn }] (juengste zuletzt).
 * Nur Ereignisse der eigenen Seite (fremde Geheimnisse bleiben verborgen).
 */
export function marginNotes(rounds, side, { max = MAX_NOTES } = {}) {
  const out = [];
  for (const r of rounds ?? []) {
    for (const e of r.log ?? []) {
      if (e.side !== side) continue;
      const rule = NOTE_RULES.find((n) => n.when(e));
      if (!rule) continue;
      const at = rule.at ? rule.at(e) : e.at;
      if (!at || !Number.isFinite(at.x) || !Number.isFinite(at.y)) continue;
      const i = out.findIndex((n) => n.kind === rule.kind && Math.abs(n.x - at.x) + Math.abs(n.y - at.y) <= MERGE_RANGE);
      if (i >= 0) out.splice(i, 1);
      out.push({ kind: rule.kind, text: rule.text, x: at.x, y: at.y, turn: r.turn ?? 0 });
    }
  }
  return out.slice(-max);
}

/** Overlay fuer die dynamische Ebene: kurzer Pfeil zum Feld, Notiz schraeg daneben */
export function marginOverlay(getNotes) {
  return {
    draw(ctx, { theme: th, px }) {
      const notes = getNotes();
      if (!notes.length) return;
      ctx.save();
      ctx.font = `600 ${17 * px}px ${FONTS.hand}`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      notes.forEach((n, i) => {
        const cx = n.x + 0.5, cy = n.y + 0.5;
        // abwechselnd oben rechts und unten rechts, damit benachbarte Notizen sich weniger ueberdecken
        const up = i % 2 === 0;
        const tx = cx + 34 * px, ty = cy + (up ? -26 : 30) * px;
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = th.pencil;
        ctx.lineWidth = 1.4 * px;
        ctx.beginPath();
        ctx.moveTo(tx - 4 * px, ty + (up ? 4 : -14) * px);
        ctx.quadraticCurveTo(cx + 18 * px, cy + (up ? -6 : 6) * px, cx + 7 * px, cy + (up ? -3 : 3) * px);
        ctx.stroke();
        // Pfeilspitze
        ctx.beginPath();
        ctx.moveTo(cx + 7 * px, cy + (up ? -3 : 3) * px);
        ctx.lineTo(cx + 13 * px, cy + (up ? -9 : 9) * px - 1 * px);
        ctx.moveTo(cx + 7 * px, cy + (up ? -3 : 3) * px);
        ctx.lineTo(cx + 15 * px, cy + (up ? -2 : 2) * px);
        ctx.stroke();
        ctx.strokeStyle = th.paper;
        ctx.lineWidth = 4 * px;
        ctx.strokeText(n.text, tx, ty);
        ctx.fillStyle = th.pencil;
        ctx.fillText(n.text, tx, ty);
      });
      ctx.restore();
    },
  };
}
