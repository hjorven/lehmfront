// Puzzle-Lagen und selbstgebaute Missionen im Gefecht (P25). Gleiche Schnittstelle wie attachModeRules
// (js/ui/result.js): { ended, afterResolve, afterFilm, suffix, show, snapshot, restore }.
// - Uebungsblatt (Briefing) beim Start und auf Knopfdruck, mit Bleistift-Hinweisen, eins nach dem anderen
// - Ziel, Frist und Verlustgrenze nach jeder Runde (js/modes/goals.js)
// - Auf der Karte: Ziel umkringelt, der bekannte Plan des Gegners als rote Bleistiftpfeile mit Rundennummer
// - Ergebnis mit Stempel und der Randbemerkung des Ausbilders; "Loesung ansehen" zeichnet die Loesung ein
// Ueberraschung: der Ausbilder schreibt an den Rand, was er von der Loesung haelt, und jede geloeste Lage wandert
// mit seiner Note in die Lehrgangsmappe (Uebersicht ?scene=puzzle).
import { esc, ensureCss } from './dom.js';
import { cellLabel } from '../map.js';
import { playSfx } from '../audio/engine.js';
import { FONTS } from '../render/map-layer.js';
import { judgeGoal, goalText, seenNow } from '../modes/goals.js';
import { normOrder } from '../modes/puzzle.js';
import { PUZZLES } from '../config/puzzles.js';

const KEY = 'lehmfront.lehrgang.v1';
const toXY = (p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y });

/** Lehrgangsmappe lesen: { [id]: { solved, clean, tries, rounds, losses, grade } } */
export function readProgress() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function writeProgress(id, entry) {
  try {
    const all = readProgress();
    all[id] = { ...(all[id] ?? {}), ...entry };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* ohne Speicher: die Mappe bleibt leer */ }
}

/** Randbemerkung des Ausbilders (Caveat) */
export function instructorNote(verdict, p) {
  if (verdict.status === 'won') {
    if (verdict.clean && verdict.losses === 0) return 'Ohne einen Mann Verlust. So steht es im Lehrbuch, und fast nie draußen.';
    if (verdict.clean) return 'Sauber. Genau so.';
    if (Number.isFinite(p.par?.rounds) && verdict.rounds > p.par.rounds) return 'Gelöst, aber zu langsam. Draußen wartet keiner.';
    return 'Gelöst. Es ging auch billiger.';
  }
  const why = verdict.why ?? '';
  if (/Verluste/.test(why)) return 'Zu teuer. Die Leute sind keine Münzen.';
  if (/gesehen/.test(why)) return 'Gesehen heißt beschossen. Noch einmal, tiefer.';
  if (/Frist/.test(why)) return 'Zu zögerlich. Die Uhr ist auch ein Gegner.';
  if (/Stellung/.test(why)) return 'Die Stellung ist weg. Wer hat wohin geschaut?';
  return 'Noch nicht. Lies die Lage noch einmal.';
}

/** Note fuer die Mappe: sehr gut, gut, bestanden */
export function gradeOf(verdict) {
  if (verdict.status !== 'won') return null;
  if (verdict.clean && verdict.losses === 0) return 'sehr gut';
  return verdict.clean ? 'gut' : 'bestanden';
}

/** Drehbuch der Gegenseite fuer die naechsten Runden (ab state.turn), fuer den roten Plan */
export function enemyPlan(p, state, rounds = 4) {
  const out = [];
  for (let t = state.turn; t < state.turn + rounds; t++) {
    for (const o of p.script?.[String(t)] ?? []) {
      const g = state.groups.find((x) => x.id === o.group);
      if (!g || g.status === 'lost') continue;
      out.push({ turn: t, now: t === state.turn, order: normOrder(o), from: { ...g.pos } });
    }
  }
  return out;
}

/** Bleistiftpfeil entlang eines Weges (Weltkoordinaten), mit Rundennummer am Ende */
function drawPath(ctx, from, path, { color, px, dash = null, label = '', alpha = 0.9 }) {
  if (!path?.length) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2 * px, 0.07);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash.map((d) => d * px));
  ctx.beginPath();
  ctx.moveTo(from.x + 0.5, from.y + 0.5);
  for (const c of path) ctx.lineTo(c.x + 0.5, c.y + 0.5);
  ctx.stroke();
  ctx.setLineDash([]);
  const end = path[path.length - 1];
  const prev = path.length > 1 ? path[path.length - 2] : from;
  const dx = end.x - prev.x, dy = end.y - prev.y;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / len, uy = dy / len;
  const ex = end.x + 0.5, ey = end.y + 0.5;
  ctx.beginPath();
  ctx.moveTo(ex, ey);
  ctx.lineTo(ex - ux * 0.55 - uy * 0.32, ey - uy * 0.55 + ux * 0.32);
  ctx.lineTo(ex - ux * 0.55 + uy * 0.32, ey - uy * 0.55 - ux * 0.32);
  ctx.closePath();
  ctx.fill();
  if (label) {
    ctx.font = `700 ${Math.max(0.7, 15 * px)}px ${FONTS.hand}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, ex + 0.45, ey - 0.35);
  }
  ctx.restore();
}

function drawTarget(ctx, c, { color, px, text }) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(1.8 * px, 0.06);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(c.x + 0.5, c.y + 0.5, 0.95, 0.8, -0.2, 0.3, Math.PI * 2 + 0.5);
  ctx.stroke();
  if (text) {
    ctx.font = `700 ${Math.max(0.75, 15 * px)}px ${FONTS.hand}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, c.x - 0.25, c.y + 1.15);
  }
  ctx.restore();
}

/** Ziel als Liste von Feldern zum Umkringeln */
function goalCells(goal) {
  if (goal.type === 'dig') return [toXY(goal.from), toXY(goal.to)];
  return (goal.cells ?? []).map(toXY);
}

/** Text des Ziels im Briefing, {ziel} wird durch die Feldnummer ersetzt */
export function briefText(p) {
  const cells = goalCells(p.goal);
  const where = cells.length ? (cells.length === 1 ? cellLabel(cells[0].x, cells[0].y) : cells.map((c) => cellLabel(c.x, c.y)).join(', ')) : 'das Ziel';
  return String(p.brief ?? '').replaceAll('{ziel}', where);
}

/**
 * opts wie attachModeRules plus lage: Lage (Puzzle oder Mission mit goal), kind: 'puzzle' | 'mission',
 * resumed: Spielstand geladen (kein Uebungsblatt beim Start).
 */
export function attachLageRules({ ui, map, start, lage: p, kind = 'puzzle', resumed = false, onOpen = () => {}, onClose = () => {} }) {
  const cssReady = Promise.all([ensureCss('css/modi.css'), ensureCss('css/werkstatt.css')]);
  let ended = false;
  let verdict = { status: 'running', rounds: 0, losses: 0 };
  let rounds = 0;
  let seen = false;
  let hintsShown = 0;
  let sheet = null;
  let showSolution = false;
  const puzzle = kind === 'puzzle';
  const idx = puzzle ? PUZZLES.findIndex((f) => f.endsWith('-' + p.id)) : -1;
  const next = idx >= 0 && idx + 1 < PUZZLES.length ? PUZZLES[idx + 1] : null;

  // Knopf "Übungsblatt" rechts (Desktop) und Karte in der Seitenleiste (Handy)
  const label = puzzle ? 'Übungsblatt' : 'Lagebefehl';
  const mk = (cls, inner) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.setAttribute('aria-haspopup', 'dialog');
    b.innerHTML = inner;
    b.addEventListener('click', () => (ended ? show() : openBrief()));
    return b;
  };
  ui.querySelector('.hud-right')?.prepend(mk('lage-btn', esc(label)));
  ui.querySelector('.hud-sheet')?.append(mk('lage-card', `${esc(label)} <small>${esc(p.title ?? 'Lage')}</small>`));

  function back() {
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.className = 'rm-back lage-back';
      ui.append(sheet);
      sheet.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (e.key !== 'Tab') return;
        const f = [...sheet.querySelectorAll('a[href],button:not([disabled])')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });
    }
    return sheet;
  }
  function close() {
    sheet?.remove();
    sheet = null;
    onClose();
  }

  function rulesLine() {
    const parts = [`Frist: ${p.limit} ${p.limit === 1 ? 'Runde' : 'Runden'}`];
    if (Number.isFinite(p.maxLosses)) parts.push(`höchstens ${p.maxLosses} Mann Verlust`);
    if (p.keep?.length) parts.push('die markierte Gruppe muss durchkommen');
    return parts.join(' · ');
  }

  function hintsHtml() {
    const hints = p.hints ?? [];
    if (!hints.length) return '';
    const shown = hints.slice(0, hintsShown).map((h, i) => `<li style="--r:${(i % 2 ? 0.8 : -0.6)}deg">${esc(h)}</li>`).join('');
    const more = hintsShown < hints.length
      ? `<button type="button" class="btn lage-hint">Bleistift: Hinweis ${hintsShown + 1} von ${hints.length}</button>` : '';
    return `<div class="lage-hints">${shown ? `<ol>${shown}</ol>` : ''}${more}</div>`;
  }

  async function openBrief() {
    if (sheet) return;
    await cssReady;
    if (sheet) return;
    onOpen();
    renderBrief();
    playSfx('paper', { intensity: 0.6 });
  }

  function renderBrief() {
    const s = back();
    const head = puzzle ? `Puzzle-Lage ${p.num ?? ''} von ${PUZZLES.length}` : 'Eigene Lage';
    s.innerHTML = `<section class="rm card lage-sheet" role="dialog" aria-modal="true" aria-label="${esc(label)}">
      <header class="rm-head"><span class="rm-kind">${esc(head)}${p.lesson ? ' · ' + esc(p.lesson) : ''}</span><b>${esc(p.title ?? 'Lage')}</b></header>
      ${p.brief ? `<p class="rm-line">${esc(briefText(p))}</p>` : ''}
      <p class="lage-goal"><span>Auftrag</span>${esc(p.goalText ?? goalText(p.goal))}</p>
      <p class="lage-rules">${esc(rulesLine())}</p>
      ${puzzle ? `<p class="lage-fine">Volle Information: Du siehst jede Gruppe, und der Plan von drüben steht rot auf der Karte. Es wird nicht gewürfelt: Jede Aussicht über die Hälfte gelingt, Treffer fallen, wie man sie erwarten muss.</p>` : ''}
      ${hintsHtml()}
      <footer class="rm-foot">
        ${puzzle ? '<a class="btn" href="?scene=puzzle">Lehrgangsmappe</a>' : '<a class="btn" href="?scene=werkstatt">Werkstatt</a>'}
        <button type="button" class="btn rm-look lage-go">${rounds ? 'Weiter' : 'Anfangen'}</button>
      </footer>
    </section>`;
    s.querySelector('.lage-go').addEventListener('click', close);
    s.querySelector('.lage-hint')?.addEventListener('click', () => {
      hintsShown++;
      playSfx('pencil', { count: 3, intensity: 0.5 });
      renderBrief();
      s.querySelector('.lage-hint, .lage-go')?.focus({ preventScroll: true });
    });
    s.querySelector('.lage-go').focus({ preventScroll: true });
  }

  function renderResult() {
    const s = back();
    const won = verdict.status === 'won';
    const grade = gradeOf(verdict);
    const stamp = won ? (verdict.clean ? 'Sauber gelöst' : 'Gelöst') : 'Nicht gelöst';
    const again = new URLSearchParams(location.search);
    again.delete('demo'); again.delete('slot');
    const rows = [
      ['Runden', `${verdict.rounds} von ${p.limit}`],
      ['Eigene Verluste', `${verdict.losses} Mann${Number.isFinite(p.maxLosses) ? ` (höchstens ${p.maxLosses})` : ''}`],
    ];
    if (Number.isFinite(p.par?.rounds)) rows.push(['Lehrbuch', `${p.par.rounds} Runden, ${p.par.losses ?? 0} Mann`]);
    s.innerHTML = `<section class="rm card lage-sheet" role="dialog" aria-modal="true" aria-label="Ergebnis der Lage">
      <header class="rm-head"><span class="rm-kind">${esc(puzzle ? `Puzzle-Lage ${p.num ?? ''}` : 'Eigene Lage')} · ${esc(p.lesson ?? map.name)}</span><b>${esc(p.title ?? 'Lage')}</b></header>
      <div class="rm-stamp s-${won ? 'won' : 'lost'}" aria-hidden="true">${esc(stamp)}</div>
      <p class="rm-line">${esc(won ? (p.wonText ?? verdict.why) : verdict.why)}</p>
      <dl class="rm-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <p class="rm-note lage-note">${esc(instructorNote(verdict, p))}${grade ? ` <span class="lage-grade">Note: ${esc(grade)}</span>` : ''}</p>
      ${showSolution && p.solutionText ? `<p class="lage-solution"><span>Lösung des Ausbilders</span>${esc(p.solutionText)}</p>` : ''}
      <footer class="rm-foot">
        <button type="button" class="btn rm-look">Karte ansehen</button>
        ${p.solutionText && !showSolution ? '<button type="button" class="btn lage-sol">Lösung ansehen</button>' : ''}
        <a class="btn rm-again" href="?${esc(again.toString())}">Noch einmal</a>
        ${puzzle && won && next ? `<a class="btn lage-next" href="?scene=gefecht&amp;puzzle=${esc(next)}">Nächste Lage</a>` : ''}
        <a class="btn" href="${puzzle ? '?scene=puzzle' : '?scene=werkstatt'}">${puzzle ? 'Lehrgangsmappe' : 'Werkstatt'}</a>
      </footer>
    </section>`;
    s.querySelector('.rm-look').addEventListener('click', close);
    s.querySelector('.lage-sol')?.addEventListener('click', () => {
      showSolution = true;
      playSfx('pencil', { count: 6, intensity: 0.5 });
      renderResult();
    });
    (s.querySelector('.lage-next') ?? s.querySelector('.rm-again')).focus({ preventScroll: true });
  }

  async function show() {
    await cssReady;
    if (sheet) { sheet.remove(); sheet = null; }
    onOpen();
    renderResult();
    playSfx('stamp', { delay: 0.2 });
  }

  // Beim Start das Uebungsblatt (nicht bei geladenem Stand und nicht bei Screenshots mit demo=)
  const demo = new URLSearchParams(location.search).get('demo');
  if (!resumed && !demo) setTimeout(openBrief, 350);

  function judge(state) {
    seen = seen || seenNow(p.goal, state, map);
    verdict = judgeGoal(p, { start, state, map, rounds, seen });
    if (verdict.status !== 'running' && !ended) {
      ended = true;
      if (puzzle) {
        const old = readProgress()[p.id] ?? {};
        const g = gradeOf(verdict);
        const better = verdict.status === 'won' && (!old.solved || (verdict.clean && !old.clean) || verdict.losses < (old.losses ?? 1e9));
        writeProgress(p.id, {
          tries: (old.tries ?? 0) + 1,
          ...(better ? { solved: true, clean: !!verdict.clean, rounds: verdict.rounds, losses: verdict.losses, grade: g } : {}),
        });
      }
    }
  }

  return {
    get ended() { return ended; },
    get verdict() { return verdict; },
    snapshot() { return { rounds, seen, hintsShown }; },
    restore(snap, state) {
      rounds = snap?.rounds ?? 0;
      seen = !!snap?.seen;
      hintsShown = snap?.hintsShown ?? 0;
      if (rounds) judge(state);
    },
    afterResolve(before, after) {
      if (ended) return;
      rounds++;
      judge(after);
    },
    afterFilm() {
      if (!ended) return false;
      show();
      return true;
    },
    suffix() {
      if (ended) return verdict.status === 'won' ? ' · gelöst' : ' · beendet';
      const left = Math.max(0, p.limit - rounds);
      return ` · noch ${left}`;
    },
    show,
    openBrief,
    /** Overlays fuer die Karte: Ziel, Plan des Gegners, auf Wunsch die Loesung */
    overlays(state) {
      return [{
        draw(ctx, { theme: th, px }) {
          for (const c of goalCells(p.goal)) drawTarget(ctx, c, { color: th.accent ?? th.ink, px, text: 'Ziel' });
          for (const e of enemyPlan(p, state)) {
            const o = e.order;
            const lbl = e.now ? 'jetzt' : 'R' + e.turn;
            if (o.path?.length) drawPath(ctx, e.from, o.path, { color: th.enemy, px, dash: e.now ? null : [7, 6], label: lbl, alpha: e.now ? 0.95 : 0.6 });
            else if (o.target) drawTarget(ctx, o.target, { color: th.enemy, px, text: lbl });
          }
          if (showSolution && p.solution) {
            const pos = new Map(start.groups.map((g) => [g.id, { ...g.pos }]));
            for (const t of Object.keys(p.solution).map(Number).sort((a, b) => a - b)) {
              for (const raw of p.solution[String(t)]) {
                const o = normOrder(raw);
                const from = pos.get(o.group);
                if (!from) continue;
                if (o.path?.length) {
                  drawPath(ctx, from, o.path, { color: th.pencil ?? th.ink2, px, dash: [3, 4], label: 'L' + t, alpha: 0.85 });
                  pos.set(o.group, { ...o.path[o.path.length - 1] });
                } else if (o.target) drawTarget(ctx, o.target, { color: th.pencil ?? th.ink2, px, text: 'L' + t });
              }
            }
          }
        },
      }];
    },
  };
}
