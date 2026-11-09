// Anschluss der Szene "gefecht" an Wiedergabe und Online-Gefecht (P20). Haelt gefecht.js klein:
//   setupOnline(params, ctx) -> null | { kind: 'replay', resumed, record } | { kind: 'match', side, state, carry, ... }
// Wiedergabe (wiedergabe=1, Protokoll im Anker): alle Runden lokal nachrechnen, das Gefecht steht danach am Ende,
//   jede Runde liegt im Protokoll (Taste P) als Film. Weiterspielen geht, gespeichert wird nichts.
// Online-Gefecht (match=<id>): Zustand aus der eigenen Sicht (match_views), Befehle gehen an den Stab.
import { replayRounds, carryOrders } from './replay.js';
import { recordFromHash } from './link.js';
import { stateFromView, turnState } from './match.js';
import { esc, ensureCss } from '../ui/dom.js';
import { candle } from '../ui/candle.js';

/**
 * ctx: { map, start, seed, info }
 */
export async function setupOnline(params, { map, start, seed, info }) {
  if (params.get('wiedergabe') === '1') {
    const rec = await recordFromHash();
    if (!rec) return { kind: 'replay', broken: true };
    const r = replayRounds(start, rec.r, { map, seed, limit: info?.limit ?? 0, stopAtEnd: false });
    return {
      kind: 'replay',
      record: rec,
      rounds: r.played,
      resumed: { state: r.state, archive: r.archive, lastLog: r.lastLog, aiMemory: undefined, rules: { tally: r.tally }, replay: true, reload: true },
    };
  }
  const id = params.get('match');
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const net = await import('../net.js');
  const got = await net.loadMatch(id);
  if (!got.ok || !got.view) return { kind: 'match', broken: true, why: got.why ?? 'Das Gefecht hat noch keine Lage. Wartet es noch auf die Gegenseite?' };
  const state = stateFromView(start, got.view);
  const carry = carryOrders(state, got.view.log ?? [])[got.side];
  return { kind: 'match', id, net, side: got.side, match: got.match, submitted: got.submitted, state, carry, log: got.view.log ?? [] };
}

/** Hinweis, wenn Link oder Gefecht nicht ladbar sind */
export function brokenText(online) {
  if (online.kind === 'replay') return 'Der Wiedergabe-Link ist unvollständig oder beschädigt. Das Gefecht beginnt von vorn.';
  return online.why || 'Das Online-Gefecht ist nicht erreichbar.';
}

/**
 * Online-Gefecht: Befehle abgeben und auf die Gegenseite warten. ui = Knoten der Bedienung.
 * Zeigt ein Blatt mit Kerze (Frist) und laedt die Seite neu, sobald der Stab die Runde gerechnet hat.
 */
export function attachMatch(ui, online, { onBlock = () => {}, onUnblock = () => {} } = {}) {
  ensureCss('css/fernamt.css');
  let sheet = null;
  let stop = () => {};
  let poll = null;
  const turn = online.state.turn;

  function show(text, { busy = false, retry = false } = {}) {
    onBlock();
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'fa-wait-back';
      ui.append(sheet);
    }
    const m = online.match;
    const late = m.deadline && Date.parse(m.deadline) < Date.now();
    sheet.innerHTML = `<section class="fa-wait card" role="dialog" aria-modal="true" aria-label="Befehle beim Stab">
      <header><span class="fa-kicker">Zweikampf · Runde ${online.state.turn}</span><b>Befehle versiegelt</b></header>
      <div class="fa-wait-body">${candle(m.deadline, m.turn_kind)}<p>${esc(text)}</p></div>
      <footer>
        ${late && !busy ? '<button type="button" class="btn fa-nudge">Frist verstrichen: Runde rechnen</button>' : ''}
        ${retry ? '<button type="button" class="btn fa-retry">Neu laden</button>' : ''}
        <a class="btn" href="?scene=fernamt">Zum Fernsprechamt</a>
      </footer></section>`;
    sheet.querySelector('.fa-nudge')?.addEventListener('click', async () => {
      show('Der Stab rechnet die Runde ...', { busy: true });
      const r = await online.net.nudgeMatch(online.id);
      if (!r.ok) show(r.why);
      else check();
    });
    sheet.querySelector('.fa-retry')?.addEventListener('click', () => location.reload());
    sheet.querySelector('a.btn')?.focus({ preventScroll: true });
  }

  async function check() {
    const got = await online.net.loadMatch(online.id);
    if (got.ok && got.view && got.view.turn !== turn) location.reload();
    else if (got.ok && got.match.status === 'finished') location.reload();
    else if (got.ok) online.match = got.match;
  }

  async function wait() {
    show('Die Befehle liegen beim Stab. Drüben wird noch überlegt. Sobald beide Seiten abgegeben haben, wird die Runde gerechnet.');
    stop = await online.net.watchMatch(online.id, () => check());
    poll = setInterval(check, 45000);
  }

  function showEnd() {
    onBlock();
    const m = online.match;
    const won = m.winner === online.side, draw = !m.winner || m.winner === 'draw';
    const stamp = draw ? 'Ohne Entscheidung' : won ? 'Behauptet' : 'Durchbrochen';
    const line = draw ? 'Keine Seite hat etwas gewonnen, das sich halten ließe.' : won ? 'Der Abschnitt ist behauptet.' : 'Der Abschnitt ist nicht zu halten gewesen.';
    sheet = sheet ?? Object.assign(document.createElement('div'), { className: 'fa-wait-back' });
    ui.append(sheet);
    sheet.innerHTML = `<section class="fa-wait card" role="dialog" aria-modal="true" aria-label="Zweikampf beendet">
      <header><span class="fa-kicker">Zweikampf · beendet</span><b>${esc(stamp)}</b></header>
      <p>${esc(line)} Jetzt sind auch die Befehle von drüben und der Seed offen: die Wiedergabe zeigt das ganze Gefecht.</p>
      <footer>${m.record ? '<button type="button" class="btn fa-replay">Wiedergabe</button>' : ''}<button type="button" class="btn fa-look">Karte ansehen</button><a class="btn" href="?scene=fernamt">Zum Fernsprechamt</a></footer></section>`;
    sheet.querySelector('.fa-look').addEventListener('click', () => { sheet.remove(); sheet = null; onUnblock(); });
    sheet.querySelector('.fa-replay')?.addEventListener('click', async () => {
      const { replayUrl } = await import('./link.js');
      location.href = await replayUrl(m.record);
    });
    sheet.querySelector('.btn')?.focus({ preventScroll: true });
  }

  return {
    get finished() { return online.match.status === 'finished'; },
    showEnd,
    /** Schon abgegeben? Dann gleich warten */
    get waiting() { return turnState(online.match, online.side, online.submitted) !== 'yours'; },
    async submit(orders) {
      if (online.match.status === 'finished') { showEnd(); return false; }
      show('Die Befehle gehen an den Stab ...', { busy: true });
      const r = await online.net.submitOrders(online.id, turn, orders);
      if (!r.ok) { show(r.why, { retry: true }); return false; }
      if (r.turn && r.turn !== turn) { location.reload(); return true; }
      await wait();
      return true;
    },
    wait,
    destroy() { stop(); if (poll) clearInterval(poll); sheet?.remove(); },
  };
}
