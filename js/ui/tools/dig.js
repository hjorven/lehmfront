// Werkzeug Graben (Taste G, Plan 4.1 Nr. 1 bis 3, 7.4, Mockup Feature 03).
// Linie mit Finger oder Maus ziehen; das Spiel zerlegt sie in Felder, zeigt Dauer in Stellungsrunden,
// warnt bei geraden Abschnitten (Laengsfeuer) und fuegt auf Knopfdruck Traversen ein. Stufe, Art
// (Feuer- oder Laufgraben) und Feuerrichtung lassen sich im Kaertchen umstellen.
// Zeichnet ausserdem: geplante Graeben (Befehle), angefangene Felder, frischen Aufwurf und eroberte Graeben.
import { registerTool } from '../tools.js';
import { startLineDraw } from '../linedraw.js';
import { registerDecor, registerOrderPainter } from '../../render/decor.js';
import { cellAt, cellLabel, distance, DIR } from '../../map.js';
import { unitType } from '../../config/units.js';
import {
  LEVELS, cellsFromPoints, enfiladeRuns, longestRun, insertTraverses, defaultFacings, mapSideOf, enemyDir,
  oppositeDir, levelName,
} from '../../trench.js';
import { digBlocker, digEstimate, digRate, concreteAllowed, DIG_REACH, MAX_DIG_CELLS, SPOIL_AGE } from '../../phases/dig.js';
import { groupName, plural } from '../labels.js';
import { esc, ensureCss } from '../dom.js';
import { FONTS } from '../../render/map-layer.js';

/** Laufender Entwurf fuer die Vorschau (nur eine Zeichnung zur Zeit) */
let draft = null; // { group, cells, facings, kind, level, bad: Set('x,y'), runs }

export function setDraft(d) { draft = d; }
export function getDraft() { return draft; }

// ------------------------------------------------------------------------------------------- Zeichnen

const center = (c) => [c.x + 0.5, c.y + 0.5];

function strokeCells(ctx, cells) {
  ctx.beginPath();
  cells.forEach((c, i) => (i ? ctx.lineTo(c.x + 0.5, c.y + 0.5) : ctx.moveTo(c.x + 0.5, c.y + 0.5)));
  if (cells.length === 1) ctx.lineTo(cells[0].x + 0.51, cells[0].y + 0.5);
  ctx.stroke();
}

/** Doppellinie wie im Mockup: aussen Farbe, innen Papier */
function doubleLine(ctx, cells, color, paper, px, { width = 6, dash = null, alpha = 0.95 } = {}) {
  ctx.save();
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.globalAlpha = alpha;
  if (dash) ctx.setLineDash(dash.map((v) => v * px));
  ctx.strokeStyle = color;
  ctx.lineWidth = width * px;
  strokeCells(ctx, cells);
  ctx.strokeStyle = paper;
  ctx.lineWidth = Math.max(1, width / 3) * px;
  strokeCells(ctx, cells);
  ctx.restore();
}

/** Kleine Striche zur Feuerrichtung (Schuetzenauftritt) */
function facingTicks(ctx, cells, facings, color, px) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6 * px;
  ctx.lineCap = 'round';
  ctx.beginPath();
  cells.forEach((c, i) => {
    const d = DIR[facings[i]];
    if (!d) return;
    const len = d.dx && d.dy ? 0.7 : 1;
    const [x, y] = center(c);
    ctx.moveTo(x + d.dx * 0.16 * len, y + d.dy * 0.16 * len);
    ctx.lineTo(x + d.dx * 0.36 * len, y + d.dy * 0.36 * len);
  });
  ctx.stroke();
  ctx.restore();
}

/** Schusslinie eines gedachten MG am Ende eines geraden Abschnitts (Laengsfeuer sichtbar machen) */
function enfiladeSweep(ctx, cells, run, th, px) {
  const a = cells[run.from], b = cells[run.to];
  const dx = Math.sign(b.x - a.x), dy = Math.sign(b.y - a.y);
  const gx = b.x + dx * 3 + 0.5, gy = b.y + dy * 3 + 0.5;
  ctx.save();
  ctx.strokeStyle = th.danger;
  ctx.fillStyle = th.danger;
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.beginPath();
  ctx.moveTo(gx, gy);
  ctx.lineTo(a.x + 0.5 - dx * 0.4, a.y + 0.5 - dy * 0.4);
  ctx.stroke();
  ctx.setLineDash([]);
  // MG als kleiner Kreis mit Kreuz, Bleistiftnotiz daneben
  ctx.beginPath();
  ctx.arc(gx, gy, 0.22, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = `700 ${15 * px}px ${FONTS.hand}`;
  ctx.textBaseline = 'middle';
  ctx.fillText('MG?', gx + 0.3, gy + (dy ? 0 : -0.35));
  ctx.restore();
}

registerDecor({
  id: 'dig-draft',
  order: 50,
  draw(ctx, d) {
    if (!draft || !draft.cells.length) return;
    const th = d.theme, px = d.px;
    const { cells, bad } = draft;
    // Felder hinterlegen
    ctx.save();
    for (const c of cells) {
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = bad.has(c.x + ',' + c.y) ? th.danger : th.accent;
      ctx.fillRect(c.x, c.y, 1, 1);
    }
    ctx.restore();
    const good = cells.filter((c) => !bad.has(c.x + ',' + c.y));
    doubleLine(ctx, good.length ? cells : cells, bad.size ? th.danger : th.accent, th.paper, px, { width: draft.kind === 'comm' ? 4.5 : 6 });
    if (draft.kind === 'fire') facingTicks(ctx, cells, draft.facings, th.ink, px);
    for (const r of draft.runs) enfiladeSweep(ctx, cells, r, th, px);
    // Reichweite: Kreis um die Gruppe, wenn der Anfang zu weit weg ist
    if (draft.tooFar) {
      ctx.save();
      ctx.strokeStyle = th.danger;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.lineWidth = 1.5 * px;
      const g = draft.group.pos;
      ctx.strokeRect(g.x - DIG_REACH, g.y - DIG_REACH, DIG_REACH * 2 + 1, DIG_REACH * 2 + 1);
      ctx.restore();
    }
  },
});

/** Geplanter Graben als Befehl: Bleistift-Doppellinie, gestrichelt, mit Rundenzahl am Ende */
registerOrderPainter('dig', (ctx, { group, order, th, px, progress, d }) => {
  const cells = order.path;
  const n = Math.max(1, Math.ceil(cells.length * Math.min(1, progress)));
  const shown = cells.slice(0, n);
  ctx.save();
  ctx.strokeStyle = th.pencil;
  ctx.lineWidth = 1.2 * px;
  ctx.setLineDash([3 * px, 3 * px]);
  ctx.beginPath();
  ctx.moveTo(group.pos.x + 0.5, group.pos.y + 0.5);
  ctx.lineTo(cells[0].x + 0.5, cells[0].y + 0.5);
  ctx.stroke();
  ctx.restore();
  doubleLine(ctx, shown, th.pencil, th.paper, px, { width: order.kind === 'comm' ? 4 : 5.5, dash: [7, 4], alpha: 0.9 });
  if (order.kind !== 'comm' && order.facing) facingTicks(ctx, shown, order.facing, th.pencil, px);
  if (progress >= 1 && d.state && d.map) {
    const g = d.state.groups.find((x) => x.id === group.id);
    const est = g ? digEstimate(d.map, d.state, g, cells, order.level ?? 2) : null;
    if (est && Number.isFinite(est.rounds) && est.rounds > 0) {
      const end = cells[cells.length - 1];
      ctx.save();
      ctx.fillStyle = th.pencil;
      ctx.font = `700 ${16 * px}px ${FONTS.hand}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${est.rounds} R`, end.x + 0.9, end.y + 0.5);
      ctx.restore();
    }
  }
  return true;
});

/** Zustand der Graeben: angefangene Felder, frischer Aufwurf, eroberte Graeben mit falscher Richtung */
registerDecor({
  id: 'trench-state',
  order: 10,
  draw(ctx, d) {
    const st = d.state;
    if (!st?.cells) return;
    const th = d.theme, px = d.px;
    const now = st.turn - 1;
    const z = 1 / px;
    for (const k of Object.keys(st.cells).sort()) {
      const c = st.cells[k];
      const [x, y] = k.split(',').map(Number);
      // Angefangen, noch kein Loch: abgesteckt mit Pflock-Strichen
      if (c.dig && !c.trench) {
        ctx.save();
        ctx.strokeStyle = th.pencil;
        ctx.lineWidth = 1.2 * px;
        ctx.setLineDash([3 * px, 3 * px]);
        ctx.strokeRect(x + 0.18, y + 0.18, 0.64, 0.64);
        ctx.restore();
      }
      // Aufwurf: Lehmhaufen auf der Feindseite des Grabens, verblasst nach SPOIL_AGE Runden
      if (Number.isFinite(c.fresh) && now - c.fresh < SPOIL_AGE && now >= c.fresh) {
        const f = DIR[c.trench?.facing] ?? enemyDir(c.dig?.side ?? 'own');
        const age = now - c.fresh;
        ctx.save();
        ctx.globalAlpha = age ? 0.45 : 0.85;
        ctx.fillStyle = th.crater;
        ctx.strokeStyle = th.ink;
        ctx.lineWidth = 0.8 * px;
        const cx = x + 0.5 + f.dx * 0.42, cy = y + 0.5 + f.dy * 0.42;
        // drei Kluempchen, Lage aus dem Feld abgeleitet (kein Zufall)
        const s = (x * 7 + y * 13) % 5;
        const blobs = [[-0.2, 0.05, 0.16], [0.05, -0.12 + s * 0.02, 0.13], [0.18, 0.12, 0.11]];
        for (const [ox, oy, r] of blobs) {
          const bx = cx + (f.dx ? oy * 0.6 : ox), by = cy + (f.dx ? ox : oy * 0.6);
          ctx.beginPath();
          ctx.arc(bx, by, r, 0, Math.PI * 2);
          ctx.fill();
          if (z >= 18) ctx.stroke();
        }
        ctx.restore();
      }
      // Erobert: Auftritt zeigt falsch herum, halbe Deckung
      if (c.trench?.captured) {
        const f = DIR[c.trench.facing];
        if (!f) continue;
        ctx.save();
        ctx.strokeStyle = th.danger;
        ctx.fillStyle = th.danger;
        ctx.lineWidth = 1.6 * px;
        const [cx, cy] = [x + 0.5, y + 0.5];
        ctx.beginPath();
        ctx.moveTo(cx - f.dx * 0.1, cy - f.dy * 0.1);
        ctx.lineTo(cx + f.dx * 0.38, cy + f.dy * 0.38);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + f.dx * 0.38, cy + f.dy * 0.38, 0.06, 0, Math.PI * 2);
        ctx.fill();
        if (z >= 22) {
          ctx.font = `700 ${14 * px}px ${FONTS.hand}`;
          ctx.textBaseline = 'middle';
          ctx.fillText('½', cx - f.dx * 0.45 - 0.08, cy - f.dy * 0.45);
        }
        ctx.restore();
      }
    }
  },
});

// ------------------------------------------------------------------------------------------- Kaertchen

/**
 * Kaertchen fuer Zeichenwerkzeuge (auch Umbauen). Gibt { el, set(model), destroy } zurueck.
 * model = { tone: 'warn'|'good'|'', title, text, meta, chips: [{ id, label, pressed? }], actions: [{ id, label, primary?, disabled? }] }
 */
export function createDrawPanel(host, onAction) {
  ensureCss('css/graben.css');
  const el = document.createElement('div');
  el.className = 'card dig-panel';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-live', 'polite');
  host.append(el);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (b && !b.disabled) onAction(b.dataset.act);
  });
  return {
    el,
    set(m) {
      el.className = `card dig-panel${m.tone ? ' ' + m.tone : ''}`;
      el.innerHTML = `<div class="dp-note"><b class="dp-title">${esc(m.title)}</b><span class="dp-text">${esc(m.text)}</span></div>
        ${m.meta ? `<div class="dp-meta">${m.meta.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        ${m.chips?.length ? `<div class="dp-chips">${m.chips.map((c) => `<button type="button" class="chip" data-act="${esc(c.id)}"${c.pressed !== undefined ? ` aria-pressed="${c.pressed}"` : ''}>${esc(c.label)}</button>`).join('')}</div>` : ''}
        <div class="dp-actions">${m.actions.map((a) => `<button type="button" class="sbtn${a.primary ? ' primary' : ''}" data-act="${esc(a.id)}"${a.disabled ? ' disabled' : ''}>${esc(a.label)}</button>`).join('')}</div>`;
    },
    destroy() { el.remove(); },
  };
}

// ------------------------------------------------------------------------------------------- Werkzeug

const KIND_LABEL = { fire: 'Feuergraben', comm: 'Laufgraben' };

/** Faktoren als kurze Zeile: "Pioniere ×2 · Regen −20 %" */
export function factorLine(factors) {
  return factors.map((f) => {
    if (f.id === 'einheit') return f.pct === 100 ? null : `${f.label} ×${(f.pct / 100).toLocaleString('de-DE')}`;
    const d = f.pct - 100;
    if (Math.abs(d) < 5) return null;
    return `${f.label} ${d > 0 ? '+' : '−'}${Math.abs(d)} %`;
  }).filter(Boolean).join(' · ');
}

/** Dauer im Vergleich: eigene Gruppe und die andere Truppe (Schuetzen oder Pioniere) */
function compareEstimate(map, state, group, cells, level) {
  const other = group.type === 'pioneers' ? 'rifles' : 'pioneers';
  const twin = { ...group, type: other };
  return { own: digEstimate(map, state, group, cells, level), other: digEstimate(map, state, twin, cells, level), otherName: unitType(other).name === 'Pioniere' ? 'Pioniere' : 'Schützen' };
}

/** Linie pruefen und kuerzen: alles ab dem ersten unzulaessigen Feld ist "bad" (rot) */
export function judgeLine(map, state, group, cells) {
  const bad = new Set();
  let why = null, whyAt = null;
  for (const c of cells) {
    const cell = cellAt(map, c.x, c.y);
    const w = why ? 'x' : digBlocker(map, cell, group.side);
    if (w) { bad.add(c.x + ',' + c.y); if (!why) { why = w; whyAt = c; } }
  }
  const tooFar = cells.length > 0 && distance(group.pos, cells[0]) > DIG_REACH;
  return { bad, why, whyAt, tooFar };
}

registerTool({
  id: 'dig',
  key: 'g',
  label: 'Graben',
  order: 10,
  orderTypes: ['dig'],
  describe(o, g, state, map) {
    const e = digEstimate(map, state, g, o.path, o.level ?? 2);
    const what = o.kind === 'comm' ? 'Laufgraben' : LEVELS[o.level ?? 2].name;
    return `${what} ${plural(o.path.length, 'Feld', 'Felder')} · ${Number.isFinite(e.rounds) ? plural(Math.max(1, e.rounds), 'Runde', 'Runden') : 'kein Fortschritt'}`;
  },
  icon: '<path d="M4 18 H8 V13 H12 V18 H16 V13 H20"/><path d="M14 4 L18 8"/><path d="M16 6 L10 12"/>',
  canUse(group, state) {
    if (group.status === 'lost') return 'Gruppe ist aufgerieben';
    if (state.turnKind !== 'position') return 'Graben nur in Stellungsrunden';
    if (!(unitType(group.type).digRate > 0)) return `${unitType(group.type).name} gräbt nicht`;
    return true;
  },
  begin(ctx) {
    const { group, state } = ctx;
    const map = ctx.map;
    const ms = mapSideOf(group.side);
    const s = { cells: [], kind: 'fire', level: 2, flip: false, traversed: false, userLevel: false };
    const okCell = (x, y) => !digBlocker(map, cellAt(map, x, y), group.side);
    const rear = (() => { const e = enemyDir(ms); return { dx: -e.dx, dy: -e.dy }; })();

    const facingsOf = (cells) => {
      const f = defaultFacings(cells, ms);
      return s.flip ? f.map(oppositeDir) : f;
    };

    function update() {
      const cells = s.cells;
      const j = judgeLine(map, state, group, cells);
      const runs = enfiladeRuns(cells, s.kind);
      setDraft(cells.length ? { group, cells, facings: facingsOf(cells), kind: s.kind, level: s.level, bad: j.bad, runs, tooFar: j.tooFar } : null);
      const n = cells.length;
      const est = n ? compareEstimate(map, state, group, cells, s.level) : null;
      const supplies = state.sides[group.side]?.supplies ?? {};
      const meta = [];
      const chips = [
        { id: 'kind', label: KIND_LABEL[s.kind], pressed: s.kind === 'comm' },
        { id: 'level', label: `Stufe: ${LEVELS[s.level].short}` },
      ];
      if (s.kind === 'fire') chips.push({ id: 'flip', label: s.flip ? 'Richtung: hinten' : 'Richtung: Feind', pressed: s.flip });
      let tone = '', title, text;
      let canGo = n > 0;
      if (!n) {
        title = 'Graben zeichnen';
        text = `Mit Finger oder Maus eine Linie ziehen, nah bei ${groupName(state, group)}. Antippen gibt ein Schützenloch.`;
      } else if (j.tooFar) {
        tone = 'warn'; canGo = false;
        title = 'Zu weit weg';
        text = `Der Graben muss höchstens ${DIG_REACH} Felder neben ${groupName(state, group)} beginnen.`;
      } else if (j.why) {
        tone = 'warn'; canGo = false;
        title = 'Hier nicht';
        text = `Ab Feld ${cellLabel(j.whyAt.x, j.whyAt.y)}: ${j.why}. Linie kürzer ziehen.`;
      } else if (n > MAX_DIG_CELLS) {
        tone = 'warn'; canGo = false;
        title = 'Zu lang';
        text = `Höchstens ${MAX_DIG_CELLS} Felder auf einmal, das sind ${n}.`;
      } else if (est.own.todo === 0) {
        tone = ''; canGo = false;
        title = 'Steht schon';
        text = `Der Graben hat hier schon mindestens die Stufe ${levelName(s.level)}.`;
      } else if (runs.length) {
        tone = 'warn';
        const worst = runs.reduce((m, r) => Math.max(m, r.length), 0);
        title = 'Längsfeuer-gefährdet';
        text = `${worst} Felder in gerader Linie. Ein MG am Ende bestreicht den ganzen Abschnitt.`;
      } else if (s.traversed) {
        tone = 'good';
        title = 'Traversen eingefügt';
        text = `${plural(n, 'Feld', 'Felder')}, längste Gerade ${longestRun(cells)}. Kein Abschnitt kann bestrichen werden.`;
      } else {
        tone = 'good';
        title = s.kind === 'comm' ? 'Laufgraben' : n === 1 ? 'Schützenloch' : 'Gute Führung';
        text = s.kind === 'comm'
          ? `${plural(n, 'Feld', 'Felder')} Verbindung nach hinten. Laufgräben haben keinen Schützenauftritt.`
          : n === 1 ? 'Ein Loch für zwei Mann, schnell gegraben, wenig Deckung.' : `${plural(n, 'Feld', 'Felder')}, längste Gerade ${longestRun(cells)}.`;
      }
      if (est && canGo) {
        const r = est.own.rounds;
        meta.push(`Dauer: ${Number.isFinite(r) ? plural(r, 'Stellungsrunde', 'Stellungsrunden') : 'nie'} · ${est.otherName} ${Number.isFinite(est.other.rounds) ? est.other.rounds : '–'}`);
        if (est.own.material) meta.push(`Material ${est.own.material} von ${supplies.material ?? 0}`);
        const fl = factorLine(digRate(state, group, map).factors);
        if (fl) meta.push(fl);
        if (est.own.material > (supplies.material ?? 0)) {
          tone = 'warn';
          text += ' Das Material reicht nicht für alle Felder.';
        }
      }
      const actions = [];
      if (runs.length && canGo) actions.push({ id: 'traverse', label: 'Traversen einfügen', primary: true });
      actions.push({ id: 'go', label: 'Graben befehlen', primary: !runs.length, disabled: !canGo });
      if (n) actions.push({ id: 'clear', label: 'Neu zeichnen' });
      actions.push({ id: 'cancel', label: 'Abbrechen' });
      panel.set({ tone, title, text, meta, chips, actions });
      ctx.redraw();
    }

    const panel = createDrawPanel(ctx.ui, (act) => {
      if (act === 'cancel') { ctx.cancel(); return; }
      if (act === 'clear') { s.cells = []; s.traversed = false; if (!s.userLevel) s.level = 2; }
      else if (act === 'kind') { s.kind = s.kind === 'fire' ? 'comm' : 'fire'; if (s.kind === 'comm' && !s.userLevel) s.level = 2; }
      else if (act === 'level') {
        const max = concreteAllowed(state, group.side) ? 4 : 3;
        s.level = s.level >= max ? 1 : s.level + 1;
        s.userLevel = true;
      } else if (act === 'flip') s.flip = !s.flip;
      else if (act === 'traverse') {
        const t = insertTraverses(s.cells, { ok: okCell, rear });
        if (longestRun(t) >= longestRun(s.cells)) ctx.hint('Hier ist kein Platz für Traversen.');
        s.cells = t;
        s.traversed = true;
      } else if (act === 'go') {
        const cells = s.cells;
        ctx.setOrder({ group: group.id, type: 'dig', path: cells.map((c) => ({ x: c.x, y: c.y })), level: s.level, kind: s.kind, facing: facingsOf(cells) });
        ctx.cancel();
        return;
      }
      update();
    });

    const surface = startLineDraw(ctx.ui, ctx.cam, {
      label: 'Graben zeichnen',
      onCamera: () => ctx.redraw(true),
      onDraw(points, done) {
        if (!points) return;
        s.cells = cellsFromPoints(points);
        s.traversed = false;
        if (!s.userLevel) s.level = s.cells.length === 1 && s.kind === 'fire' ? 1 : 2;
        update();
        if (done && s.cells.length) panel.el.querySelector('.sbtn.primary:not([disabled])')?.focus({ preventScroll: true });
      },
    });

    ctx.onCancel(() => { surface.destroy(); panel.destroy(); setDraft(null); ctx.redraw(); });
    // Fuer Demo und Tests: Linie von aussen setzen
    ctx.expose?.({
      draw(points) { s.cells = cellsFromPoints(points); s.traversed = false; if (!s.userLevel) s.level = s.cells.length === 1 ? 1 : 2; update(); },
      act(id) { panel.el.querySelector(`[data-act="${id}"]`)?.click(); },
    });
    update();
  },
});

