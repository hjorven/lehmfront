// Abschlussmeldung fuer Gefecht frei, Hotseat und Tageslage (P17).
// Die Szene "gefecht" meldet jede aufgeloeste Runde (afterResolve) und das Ende des Phasenfilms (afterFilm).
// Ist die Rundengrenze erreicht oder hat eine Seite keine Gruppe mehr, liegt die Meldung auf dem Tisch:
// Wertung, Verluste, und bei der Tageslage die Punkte nach Plan 8.3 mit Eintrag ins Wachbuch (lokale Bestenliste).
import { esc, ensureCss } from './dom.js';
import { faction } from '../config/factions.js';
import { DOCTRINES, DIFFICULTIES } from '../config/doctrines.js';
import { playSfx } from '../audio/engine.js';
import { emptyTally, tallyLog, finalReport, limitReached, dayLabel } from '../modes/skirmish.js';

export { dayLabel };
import { addEntry, boardFor, lastName, rememberName } from '../modes/board.js';

/** Kurzname einer Fraktion; unbekannte Werte aus altem Speicher zeigen nichts statt abzustuerzen */
function factionShort(id) {
  try { return id ? faction(id).short : ''; } catch { return ''; }
}

const VERDICT = {
  won: { stamp: 'Behauptet', line: 'Der Abschnitt ist behauptet.' },
  lost: { stamp: 'Durchbrochen', line: 'Der Abschnitt ist nicht zu halten gewesen.' },
  draw: { stamp: 'Ohne Entscheidung', line: 'Keine Seite hat etwas gewonnen, das sich halten ließe.' },
};
// Tageslage: zaehlt nur, ob der Abschnitt die Woche gehalten hat (Plan 8.3), nicht die Wertung gegen die KI
const HELD = {
  true: { key: 'won', stamp: 'Gehalten', line: 'Der Abschnitt hat die Woche gehalten.' },
  false: { key: 'lost', stamp: 'Nicht gehalten', line: 'Der Abschnitt hat die Woche nicht gehalten.' },
};

/**
 * opts: { ui, info: { kind, limit, key?, label, map?, mapSeed? }, map, start, scenario, humans, aiCfg, params }
 * Rueckgabe: { ended, afterResolve(before, after, log), afterFilm(state), suffix(state), show() }
 */
export function attachModeRules({ ui, info, map, start, scenario, humans, aiCfg, onOpen = () => {}, onClose = () => {} }) {
  let tally = emptyTally();
  let ended = false;
  let report = null;
  let sheet = null;
  let entered = -1;
  let enteredList = null; // Liste direkt nach dem Eintragen (gilt auch, wenn der Speicher voll oder gesperrt ist)
  let unsaved = false;
  let last = start;

  function over(state) {
    if (limitReached(state, tally, info.limit)) return true;
    const alive = (s) => state.groups.some((g) => g.side === s && g.status !== 'lost');
    return !alive('a') || !alive('b');
  }

  function verdictFor(side) {
    if (!report) return 'draw';
    if (side === 'a') return report.verdict;
    return report.verdict === 'won' ? 'lost' : report.verdict === 'lost' ? 'won' : 'draw';
  }

  function close() {
    sheet?.remove();
    sheet = null;
    onClose();
  }

  function render() {
    const a = faction(last.sides.a.faction), b = faction(last.sides.b.faction);
    const tl = info.kind === 'tageslage';
    const hot = humans.length > 1;
    const v = tl ? HELD[!!report.held] : { key: verdictFor('a'), ...VERDICT[verdictFor('a')] };
    const mapName = map.name;
    const doc = scenario.sides.b.ai?.doctrine ?? aiCfg?.doctrine;
    const diff = scenario.sides.b.ai?.difficulty ?? aiCfg?.difficulty;
    const head = tl ? `Tageslage vom ${dayLabel(info.key)}` : hot ? 'Hotseat' : 'Gefecht frei';
    const rows = [
      ['Stellungsrunden', `${report.rounds}${info.limit ? ` von ${info.limit}` : ''}`],
      ['Angriffe', String(report.battles)],
      [`Ausfälle ${a.short}`, `${report.losses.a} Mann`],
      [`Ausfälle ${b.short}`, `${report.losses.b} Mann`],
      [`Gräben genommen ${a.short}`, String(report.ground.a)],
      [`Gräben genommen ${b.short}`, String(report.ground.b)],
      ['Wertung', `${report.score.a} zu ${report.score.b}`],
    ];
    const winner = report.winner ? faction(last.sides[report.winner].faction).name : null;
    const loser = report.winner ? faction(last.sides[report.winner === 'a' ? 'b' : 'a'].faction).name : null;
    let verdictLine = v.line;
    if (hot && !winner) verdictLine = VERDICT.draw.line;
    else if (hot && report.why === 'Wertung') verdictLine = `${winner} behauptet sich nach Wertung.`;
    else if (hot) verdictLine = `${loser} hat keine Gruppe mehr im Abschnitt. ${winner} behauptet sich.`;
    let points = '';
    if (tl) {
      points = `<table class="rm-points"><tbody>${report.parts.map((p) => `<tr><td>${esc(p.label)}</td><td>${p.count} × ${p.per > 0 ? p.per : '−' + -p.per}</td><td>${p.count * p.per}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="2">Punkte</td><td>${report.points}</td></tr></tfoot></table>`;
    }
    const enemyNote = !hot && doc && DOCTRINES[doc]
      ? `<p class="rm-note">Aus Gefangenenaussagen: drüben führte man nach „${esc(DOCTRINES[doc].label)}“${diff && DIFFICULTIES[diff] ? `, Gegner ${esc(DIFFICULTIES[diff].label)}` : ''}.</p>` : '';
    const book = tl ? wachbuch() : '';
    sheet.innerHTML = `<section class="rm card" role="dialog" aria-modal="true" aria-label="Abschlussmeldung">
      <header class="rm-head"><span class="rm-kind">${esc(head)} · ${esc(mapName)}</span><b>Abschlussmeldung</b></header>
      <div class="rm-stamp s-${hot ? (report.winner === 'a' ? 'won' : report.winner ? 'lost' : 'draw') : v.key}" aria-hidden="true">${esc(hot ? (winner ? faction(last.sides[report.winner].faction).short + ' behauptet' : VERDICT.draw.stamp) : v.stamp)}</div>
      <p class="rm-line">${esc(verdictLine)}</p>
      <dl class="rm-rows">${rows.map(([k, x]) => `<div><dt>${esc(k)}</dt><dd>${esc(x)}</dd></div>`).join('')}</dl>
      ${points}
      ${enemyNote}
      ${book}
      <footer class="rm-foot">
        <button type="button" class="btn rm-look">Karte ansehen</button>
        <a class="btn rm-again" href="${esc(againHref())}">${tl ? 'Neu beginnen' : 'Noch einmal'}</a>
        <a class="btn rm-menu" href="./">Hauptmenü</a>
      </footer>
    </section>`;
    sheet.querySelector('.rm-look').addEventListener('click', close);
    const form = sheet.querySelector('.rm-sign');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = form.querySelector('input').value.trim() || 'Ohne Namen';
        rememberName(name);
        const r = addEntry(info.key, { name, points: report.points, faction: last.sides.a.faction, held: report.held, at: Date.now() });
        entered = r.index;
        enteredList = r.list;
        unsaved = !r.saved;
        playSfx('pencil', { count: 5, intensity: 0.5 });
        render();
      });
    }
    // Auf dem Handy nicht ins Eingabefeld springen, sonst schiebt die Bildschirmtastatur die Meldung weg
    const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 699px)').matches;
    sheet.querySelector(enteredList || !form || narrow ? '.rm-look' : '.rm-sign input')?.focus({ preventScroll: true });
  }

  function wachbuch() {
    const list = enteredList ?? boardFor(info.key);
    const sign = !enteredList
      ? `<form class="rm-sign"><label>Unterschrift <input name="n" maxlength="24" autocomplete="nickname" value="${esc(lastName())}"></label><button class="btn" type="submit">Ins Wachbuch</button></form>`
      : '';
    const rows = list.slice(0, 10).map((e, i) => `<li class="${i === entered ? 'new' : ''}"><span class="wb-n">${i + 1}.</span><span class="wb-name">${esc(e.name)}</span><span class="wb-f">${esc(factionShort(e.faction))}</span><b>${e.points}</b></li>`).join('');
    return `<div class="wachbuch"><b class="wb-title">Wachbuch, ${esc(dayLabel(info.key))}</b>
      ${rows ? `<ol>${rows}</ol>` : '<p class="wb-empty">Noch kein Eintrag an diesem Tag.</p>'}
      ${entered >= 0 && entered < 10 ? '' : entered >= 0 ? `<p class="wb-empty">Platz ${entered + 1}, außerhalb der ersten zehn.</p>` : ''}
      ${entered < 0 && enteredList ? '<p class="wb-empty">Der Eintrag reicht nicht für die zwanzig Plätze dieses Tages.</p>' : ''}
      ${unsaved ? '<p class="wb-empty wb-warn">Dieses Gerät erlaubt kein Speichern. Der Eintrag gilt nur bis zum Schließen.</p>' : ''}
      ${sign}<small class="wb-hint">Nur auf diesem Gerät. Morgen gibt es eine neue Lage.</small></div>`;
  }

  function againHref() {
    const p = new URLSearchParams(location.search);
    p.delete('demo');
    return '?' + p.toString();
  }

  async function show() {
    await ensureCss('css/modi.css');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'rm-back';
      ui.append(sheet);
      sheet.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        // Fokus bleibt in der Meldung (aria-modal)
        const f = [...sheet.querySelectorAll('a[href],button:not([disabled]),input')];
        if (!f.length) return;
        const first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
      });
    }
    onOpen();
    render();
    playSfx('stamp', { delay: 0.2 });
  }

  return {
    get ended() { return ended; },
    get report() { return report; },
    get tally() { return tally; },
    /** Spielstand (P18): Zaehler sichern und wiederherstellen; ended ergibt sich beim Laden neu */
    snapshot() { return { tally }; },
    restore(snap, state) {
      if (snap?.tally) tally = { ...emptyTally(), ...snap.tally };
      last = state;
      if (!ended && over(state)) { ended = true; report = finalReport({ start, end: state, map, tally }); }
    },
    afterResolve(before, after, log) {
      tally = tallyLog(tally, log, { before: before.turnKind, after: after.turnKind });
      last = after;
      if (!ended && over(after)) {
        ended = true;
        report = finalReport({ start, end: after, map, tally });
      }
    },
    /** nach dem Film: Meldung zeigen, wenn die Partie vorbei ist */
    afterFilm() {
      if (!ended) return false;
      show();
      return true;
    },
    suffix(state) {
      if (!info.limit || ended) return ended ? ' · beendet' : '';
      const left = Math.max(0, info.limit - tally.positionRounds);
      return state.turnKind === 'battle' ? '' : ` · noch ${left}`;
    },
    show,
    /** Fuer Screenshots: Partie sofort beenden */
    forceEnd(state, extra = {}) {
      tally = { ...tally, ...extra };
      last = state;
      ended = true;
      report = finalReport({ start, end: state, map, tally });
      return show();
    },
  };
}

