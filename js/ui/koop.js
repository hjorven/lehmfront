// Koop gegen KI (P25, Plan 9): zwei Kommandos teilen Seite a, Depot und Loren. Nord plant zuerst, dann Sued;
// beide sehen die Bleistiftpfeile des anderen. Gruppen gehoeren dem Kommando ihrer Kartenhaelfte beim Start.
// Lorenplan, Feuerplan und Etappe sind gemeinsam: wer zuletzt plant, sieht, was der andere eingetragen hat.
// Ueberraschung: beim Weitergeben schreibt das Kommando einen Zettel fuer den Kameraden; er liegt beim
// naechsten Planen oben auf der Karte.
import { esc, ensureCss } from './dom.js';
import { playSfx } from '../audio/engine.js';
import { FONTS } from '../render/map-layer.js';

export const COMMANDS = [
  { id: 1, name: 'Kommando Nord', short: 'Nord', mark: 'N' },
  { id: 2, name: 'Kommando Süd', short: 'Süd', mark: 'S' },
];

/** Zuteilung der Gruppen: obere Kartenhaelfte Nord, untere Sued; bei Gleichstand nach ID abwechselnd */
export function splitGroups(groups, height) {
  const own = groups.filter((g) => g.side === 'a').sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  const mid = height / 2;
  const out = {};
  for (const g of own) out[g.id] = g.pos.y + 0.5 < mid ? 1 : 2;
  // Keine Seite ohne Gruppe: notfalls die naechste an der Mitte hinueber
  for (const want of [1, 2]) {
    if (own.length < 2 || Object.values(out).includes(want)) continue;
    const pick = own.slice().sort((p, q) => Math.abs(p.pos.y - mid) - Math.abs(q.pos.y - mid) || (p.id < q.id ? -1 : 1))[0];
    out[pick.id] = want;
  }
  return out;
}

export function createKoop(state, map) {
  // Weitergabe-Karte nutzt die Blattstile der Modi (css/modi.css) und den Zettel (css/werkstatt.css)
  ensureCss('css/modi.css');
  ensureCss('css/werkstatt.css');
  const owner = splitGroups(state.groups, map.height);
  let cmd = 1;
  let note = { 1: '', 2: '' };   // Zettel an das jeweilige Kommando
  const ownerOf = (g) => owner[g.id] ?? (g.pos.y + 0.5 < map.height / 2 ? 1 : 2);
  const C = (id) => COMMANDS[id - 1];

  return {
    get cmd() { return cmd; },
    owns: (g) => ownerOf(g) === cmd,
    ownerName: (g) => C(ownerOf(g)).name,
    title: () => C(cmd).name,
    /** Text fuer den Knopf "Runde ausfuehren" */
    button: () => (cmd === 1 ? `An ${C(2).short} übergeben` : 'Runde ausführen'),
    last: () => cmd === 2,
    reset() { cmd = 1; },
    /** Zettel, der auf das aktuelle Kommando wartet (einmal lesen) */
    takeNote() { const n = note[cmd]; note[cmd] = ''; return n; },
    snapshot: () => ({ cmd, note: { ...note }, owner: { ...owner } }),
    restore(s) {
      if (!s) return;
      cmd = s.cmd === 2 ? 2 : 1;
      note = { 1: String(s.note?.[1] ?? ''), 2: String(s.note?.[2] ?? '') };
      Object.assign(owner, s.owner ?? {});
    },
    /** Uebergabe an Sued mit Zettel. onGo() nach dem Weitergeben. */
    handover(ui, turn, onGo) {
      const back = document.createElement('div');
      back.className = 'rm-back koop-back';
      back.innerHTML = `<section class="rm card koop-hand" role="dialog" aria-modal="true" aria-label="Übergabe an ${esc(C(2).name)}">
        <header class="rm-head"><span class="rm-kind">Runde ${turn} · Koop</span><b>Weiter an ${esc(C(2).name)}</b></header>
        <p class="rm-line">${esc(C(1).name)} hat eingezeichnet. Gib das Gerät weiter: ${esc(C(2).name)} sieht die Pfeile und plant den Süden.</p>
        <label class="koop-note">Zettel für ${esc(C(2).short)} <textarea maxlength="120" rows="2" placeholder="z. B. Ich halte den Hügel, sichere du die Mühle."></textarea></label>
        <footer class="rm-foot"><button type="button" class="btn koop-back-btn">Noch nicht</button><button type="button" class="btn koop-go">Weitergeben</button></footer>
      </section>`;
      ui.append(back);
      const ta = back.querySelector('textarea');
      const close = () => back.remove();
      back.querySelector('.koop-back-btn').addEventListener('click', () => { close(); onGo(false); });
      back.querySelector('.koop-go').addEventListener('click', () => {
        note[2] = ta.value.trim().slice(0, 120);
        cmd = 2;
        close();
        playSfx('paper', { intensity: 0.6 });
        if (note[2]) playSfx('pencil', { count: 3, intensity: 0.5 });
        onGo(true);
      });
      back.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); onGo(false); } });
      ta.focus({ preventScroll: true });
    },
    /** Kennbuchstabe N oder S an jeder eigenen Gruppe, fremde Gruppen blasser */
    overlay(groups) {
      return {
        draw(ctx, { theme: th, px }) {
          ctx.save();
          ctx.font = `700 ${Math.max(0.6, 13 * px)}px ${FONTS.hand}`;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          for (const g of groups()) {
            if (g.side !== 'a' || g.status === 'lost') continue;
            const mine = ownerOf(g) === cmd;
            ctx.globalAlpha = mine ? 0.95 : 0.5;
            ctx.fillStyle = mine ? th.own : th.pencil ?? th.ink2;
            ctx.fillText(C(ownerOf(g)).mark, g.pos.x + 0.95, g.pos.y + 0.1);
          }
          ctx.restore();
        },
      };
    },
  };
}
