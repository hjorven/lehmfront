// Feuerplan-Editor (Plan 4.1 Nr. 8, 7.4, 7.8 Stil 02 Blaupause, Bild feature-06-feuerwalze).
// Solange er offen ist, wird die Lagekarte zur Blaupause: technische Zeichnung, weisse Linien auf Blau.
// Startlinie direkt auf der Karte ziehen, Griffe fuer Linienenden, Lage und Schrittweite, Zeitbaender je Gefechtsrunde,
// Sturmgruppen als Geister entlang ihres Wegs hinter der Walze. Rechts (Handy: unten) das Planblatt mit Batterien,
// Runden, Beginn, Munitionskosten und "Munition danach".
import { esc } from './dom.js';
import { screenToWorld, worldToScreen } from '../render/camera.js';
import { DIR, DIRS, cellLabel, distance } from '../map.js';
import { PLAN_KINDS } from '../config/artillery.js';
import {
  artilleryOf, normalizePlan, validatePlan, ammoAfter, planCost, stormGhosts, batteryLinked, batteryCenter, MAX_PLANS, planClashes,
  planCellsAt, centerOf,
} from '../artillery.js';
import { directionOf } from '../sight.js';
import {
  drawPlan, drawLine, drawBattery, drawRange, drawStormGhosts, drawHandle, planHandles, HANDLE_RADIUS, roundClock, drawBand,
} from '../render/artillery-layer.js';
import { FONTS } from '../render/map-layer.js';

const KIND_ORDER = ['creep', 'prep', 'barrage', 'harass', 'counter'];
const DEFAULT_LEN = 8;

/** Richtung senkrecht zur Linie a-b, zum Gegner hin (Seite a nach Osten, b nach Westen) */
export function normalDir(a, b, side) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const want = side === 'a' ? 1 : -1;
  let nx = -vy, ny = vx;
  if (!nx && !ny) return side === 'a' ? 'E' : 'W';
  if (nx * want < 0 || (nx === 0 && ny < 0)) { nx = -nx; ny = -ny; }
  return directionOf({ x: 0, y: 0 }, { x: nx, y: ny })?.id ?? (side === 'a' ? 'E' : 'W');
}

function flip(dir) {
  const d = DIR[dir];
  return DIRS.find((x) => x.dx === -d.dx && x.dy === -d.dy).id;
}

function nextId(plans, kind) {
  const pre = { creep: 'w', prep: 'v', barrage: 's', harass: 'st', counter: 'g' }[kind];
  let i = 1;
  while (plans.some((p) => p.id === pre + i)) i++;
  return pre + i;
}

/** Text der Kopfzeile wie im Mockup: "Feuerwalze · 2 Batterien" / "6 Runden · Schritt 1 Feld · 144 Schuss · Munition danach 196" */
export function planSummary(plan, plans, art, factionId) {
  const k = PLAN_KINDS[plan.kind];
  const n = plan.batteries.length;
  const cost = [...planCost(plan, art, factionId).values()].reduce((a, b) => a + b, 0);
  const after = ammoAfter(plans, art, factionId).after;
  const parts = [];
  if (k.round === 'battle') parts.push(`${plan.rounds} ${plan.rounds === 1 ? 'Runde' : 'Runden'}${plan.kind === 'barrage' ? ' auf Abruf' : ''}`);
  else parts.push('diese Stellungsrunde');
  if (k.moves) parts.push(`Schritt ${plan.step} ${plan.step === 1 ? 'Feld' : 'Felder'}`);
  parts.push(`${cost} Schuss`);
  parts.push(`Munition danach ${after}`);
  return { title: `${k.label} · ${n} ${n === 1 ? 'Batterie' : 'Batterien'}`, line: parts.join(' · '), after };
}

/**
 * Editor oeffnen. opts: { ui, root, cam, map, state, side, plans (Startliste), marks: { groupId: Kuerzel },
 *   redraw(), onApply(plans), onClose(), hint(text) }
 * Liefert { close(), draw(ctx, view), tap(cell) -> false, model }.
 */
export function openFirePlanEditor(opts) {
  const { ui, root, cam, map, state, side } = opts;
  const art = artilleryOf(state, side);
  const fid = state.sides[side].faction;
  const m = {
    plans: (opts.plans ?? []).map((p) => normalizePlan(p)),
    sel: null,
    drawing: null,       // { a, b } beim Ziehen einer neuen Linie
    drag: null,          // { what: 'a'|'b'|'step'|'mid'|'new', from, plan }
    wantLine: false,     // naechstes Ziehen legt die Linie neu
  };
  m.sel = m.plans[0]?.id ?? null;

  const el = document.createElement('section');
  el.className = 'fp card';
  el.setAttribute('aria-label', 'Feuerplan');
  ui.append(el);
  root.classList.add('fp-open');

  function sel() { return m.plans.find((p) => p.id === m.sel) ?? null; }

  function addPlan(kind, { wantLine = false } = {}) {
    if (m.plans.length >= MAX_PLANS) { opts.hint?.(`Höchstens ${MAX_PLANS} Feuerpläne je Runde.`); return; }
    const k = PLAN_KINDS[kind];
    const free = art.batteries.filter((b) => !b.silenced).map((b) => b.id);
    const bats = kind === 'harass' ? free.slice(0, 1) : free;
    const p = { id: nextId(m.plans, kind), kind, batteries: bats.length ? bats : art.batteries.slice(0, 1).map((b) => b.id) };
    // Vorschlag: Linie vor der feindlichen Stellung in Kartenmitte
    const cx = side === 'a' ? Math.floor(map.width * 0.6) : Math.floor(map.width * 0.4);
    const cy = Math.floor(map.height / 2);
    if (k.line) {
      p.a = { x: cx, y: cy - DEFAULT_LEN / 2 };
      p.b = { x: cx, y: cy + DEFAULT_LEN / 2 - 1 };
      p.dir = side === 'a' ? 'E' : 'W';
      p.start = 1;
      p.rounds = kind === 'creep' ? 6 : kind === 'prep' ? 2 : 3;
      if (k.moves) p.step = 1;
    }
    if (k.target) p.target = { x: cx + (side === 'a' ? 6 : -6), y: cy };
    if (k.battery) {
      const known = Object.keys(art.known ?? {}).sort();
      if (!known.length) { opts.hint?.('Gegenbatteriefeuer braucht eine aufgeklärte feindliche Batterie.'); return; }
      p.battery = known[0];
    }
    m.plans.push(normalizePlan(p));
    m.sel = p.id;
    m.wantLine = wantLine && !!k.line;
    render();
  }

  // ---------- Planblatt ----------
  function batteryChips(p) {
    return art.batteries.map((b) => {
      const on = p.batteries.includes(b.id);
      const link = batteryLinked(art, b);
      const sub = [`${b.ammo} Gr.`, b.silenced ? 'schweigt' : '', link ? '' : 'ohne Leitung'].filter(Boolean).join(' · ');
      return `<button type="button" class="chip${on ? ' on' : ''}${link ? '' : ' warn'}" data-bat="${esc(b.id)}" aria-pressed="${on}">
        <b>${esc(b.label)}</b><span>${esc(sub)}</span></button>`;
    }).join('');
  }

  function stepper(name, label, value, unit) {
    return `<div class="stp"><span>${esc(label)}</span>
      <button type="button" data-dec="${name}" aria-label="${esc(label)} weniger">−</button>
      <b>${esc(String(value))}${unit ? ' ' + esc(unit) : ''}</b>
      <button type="button" data-inc="${name}" aria-label="${esc(label)} mehr">+</button></div>`;
  }

  function warnings(p) {
    const out = [];
    const why = validatePlan(p, state, side, map);
    if (why) out.push(why);
    for (const [id, n] of planCost(p, art, fid)) {
      const b = art.batteries.find((x) => x.id === id);
      const per = ammoAfter(m.plans, art, fid).perBattery.get(id);
      if (per && per.after < 0) out.push(`${b.label}: Munition reicht nicht (${per.cost} von ${per.before} Granaten)`);
      if (b.silenced) out.push(`${b.label} schweigt noch`);
      void n;
    }
    if (p.kind === 'creep') for (const g of stormGhosts(map, state, side, p)) if (g.warn) out.push(g.warn);
    for (const c of planClashes(m.plans)) {
      if (!c.plans.includes(p.id)) continue;
      const b = art.batteries.find((x) => x.id === c.battery);
      const other = m.plans.find((x) => x.id === (c.plans[0] === p.id ? c.plans[1] : c.plans[0]));
      const first = c.plans[0] === p.id;
      out.push(`${b?.label ?? c.battery} steht ab Runde ${c.round} auch in ${PLAN_KINDS[other.kind].short} und schießt ${first ? 'hier zuerst' : 'dort zuerst, hier nicht'}`);
    }
    return [...new Set(out)];
  }

  function render() {
    const p = sel();
    const tabs = m.plans.map((x) => `<button type="button" class="tab${x.id === m.sel ? ' on' : ''}" data-sel="${esc(x.id)}">${esc(PLAN_KINDS[x.kind].short)} ${esc(x.id.replace(/^\D+/, ''))}</button>`).join('');
    const known = Object.keys(art.known ?? {}).length;
    const adds = KIND_ORDER.map((k) => `<button type="button" class="add" data-add="${k}"${k === 'counter' && !known ? ' disabled title="Keine feindliche Batterie aufgeklärt"' : ''}>+ ${esc(PLAN_KINDS[k].short)}</button>`).join('');
    let body = '<p class="empty">Noch kein Feuerplan. Art wählen, dann die Linie auf der Karte ziehen.</p>';
    let invalid = false;
    if (p) {
      const k = PLAN_KINDS[p.kind];
      const s = planSummary(p, m.plans, art, fid);
      const warn = warnings(p);
      invalid = m.plans.some((x) => validatePlan(x, state, side, map));
      const geo = k.line
        ? `<div class="row">${stepper('rounds', p.kind === 'barrage' ? 'Runden Munition' : 'Dauer', p.rounds, p.rounds === 1 ? 'Runde' : 'Runden')}
            ${stepper('start', 'Beginn', 'R' + p.start + ' · ' + roundClock(state.clock, p.start, state.battle?.round ?? 1), '')}
            ${k.moves ? stepper('step', 'Schritt', p.step, p.step === 1 ? 'Feld' : 'Felder') : ''}</div>
           <div class="row act"><button type="button" data-redraw>Linie neu ziehen</button><button type="button" data-flip>Richtung ${esc(DIR[p.dir].name)} umkehren</button></div>`
        : k.target ? `<p class="note">Ziel antippen. Jetzt: ${esc(cellLabel(p.target.x, p.target.y))}</p>`
          : `<p class="note">Ziel: ${esc(art.known[p.battery]?.label ?? p.battery)}, aufgeklärt am Mündungsblitz.</p>`;
      body = `<header class="sum"><b>${esc(s.title)}</b><span>${esc(s.line)}</span></header>
        <div class="bats" role="group" aria-label="Batterien">${batteryChips(p)}</div>
        ${geo}
        ${warn.length ? `<ul class="warn">${warn.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
        <div class="row act"><button type="button" class="del" data-del>Plan streichen</button></div>`;
    }
    const help = m.wantLine ? 'Startlinie auf der Karte ziehen.' : p && PLAN_KINDS[p.kind].line
      ? 'Griffe ziehen: Linienenden, Lage (Mitte) und Schrittweite.' : '';
    el.innerHTML = `<div class="fp-head"><b>Feuerplan</b><span>Blaupause · Stellungsrunde ${state.turn}</span>
        <button type="button" class="x" data-close aria-label="Schließen ohne zu übernehmen">×</button></div>
      <div class="tabs">${tabs}</div>
      <div class="adds">${adds}</div>
      ${body}
      ${help ? `<p class="help">${esc(help)}</p>` : ''}
      <div class="fp-foot"><button type="button" data-cancel>Verwerfen</button>
        <button type="button" class="go" data-apply${invalid ? ' disabled' : ''}>Übernehmen</button></div>`;
    opts.redraw();
  }

  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const p = sel();
    if (b.dataset.close !== undefined || b.dataset.cancel !== undefined) { opts.onClose(); return; }
    if (b.dataset.apply !== undefined) { opts.onApply(m.plans.map((x) => normalizePlan(x))); return; }
    if (b.dataset.add) { addPlan(b.dataset.add, { wantLine: true }); return; }
    if (b.dataset.sel) { m.sel = b.dataset.sel; m.wantLine = false; render(); return; }
    if (!p) return;
    if (b.dataset.bat) {
      const id = b.dataset.bat;
      const has = p.batteries.includes(id);
      if (has && p.batteries.length === 1) { opts.hint?.('Ein Plan braucht mindestens eine Batterie.'); return; }
      p.batteries = has ? p.batteries.filter((x) => x !== id) : [...p.batteries, id].sort();
    } else if (b.dataset.inc || b.dataset.dec) {
      const f = b.dataset.inc || b.dataset.dec, d = b.dataset.inc ? 1 : -1;
      const k = PLAN_KINDS[p.kind];
      if (f === 'rounds') p.rounds = Math.max(k.rounds[0], Math.min(k.rounds[1], p.rounds + d));
      if (f === 'start') p.start = Math.max(1, Math.min(12, p.start + d));
      if (f === 'step') p.step = Math.max(k.steps[0], Math.min(k.steps[1], p.step + d));
    } else if (b.dataset.flip !== undefined) {
      p.dir = flip(p.dir);
    } else if (b.dataset.redraw !== undefined) {
      m.wantLine = true;
    } else if (b.dataset.del !== undefined) {
      m.plans = m.plans.filter((x) => x.id !== p.id);
      m.sel = m.plans[0]?.id ?? null;
      m.wantLine = false;
    }
    render();
  });

  // ---------- Karte: Ziehen ----------
  const local = (e) => {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const cellOf = (w) => ({ x: Math.max(0, Math.min(map.width - 1, Math.floor(w.x))), y: Math.max(0, Math.min(map.height - 1, Math.floor(w.y))) });

  function handleAt(sp) {
    const p = sel();
    if (!p || !PLAN_KINDS[p.kind].line) return null;
    const h = planHandles(p);
    let best = null;
    for (const what of ['step', 'a', 'b', 'mid']) {
      if (!h[what]) continue;
      const q = worldToScreen(cam, h[what].x, h[what].y);
      const d = Math.hypot(q.x - sp.x, q.y - sp.y);
      if (d <= HANDLE_RADIUS + 8 && (!best || d < best.d)) best = { what, d };
    }
    return best?.what ?? null;
  }

  const pointers = new Set();
  function onDown(e) {
    if (!e.isPrimary && m.drag) {
      // zweiter Finger: Ziehen abbrechen, Plan wie vor dem Ziehen
      const d = m.drag;
      if (d.plan) { const i = m.plans.findIndex((x) => x.id === d.plan.id); if (i >= 0) m.plans[i] = d.plan; }
      m.drag = null; m.drawing = null; render(); opts.redraw(); return;
    }
    pointers.add(e.pointerId);
    if (pointers.size > 1 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target.closest && e.target.closest('.fp, .hud, .bottom, .card, button')) return;
    const sp = local(e);
    const w = screenToWorld(cam, sp.x, sp.y);
    const p = sel();
    const what = handleAt(sp);
    if (what) {
      m.drag = { what, from: cellOf(w), plan: structuredClone(p), id: e.pointerId };
    } else if (p && PLAN_KINDS[p.kind].line && m.wantLine) {
      const c = cellOf(w);
      m.drag = { what: 'new', from: c, id: e.pointerId };
      m.drawing = { a: c, b: c };
    } else {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    opts.redraw();
  }
  function onMove(e) {
    if (!m.drag || e.pointerId !== m.drag.id) return;
    const sp = local(e);
    const w = screenToWorld(cam, sp.x, sp.y);
    const c = cellOf(w);
    const p = sel();
    const d = m.drag;
    if (d.what === 'new') {
      // hoechstens 25 Felder lang
      const dx = Math.max(-24, Math.min(24, c.x - d.from.x)), dy = Math.max(-24, Math.min(24, c.y - d.from.y));
      m.drawing = { a: d.from, b: { x: d.from.x + dx, y: d.from.y + dy } };
    } else if (d.what === 'a' || d.what === 'b') {
      p[d.what] = c;
      if (distance(p.a, p.b) > 24) p[d.what] = d.plan[d.what];
    } else if (d.what === 'mid') {
      const dx = c.x - d.from.x, dy = c.y - d.from.y;
      const move = (q) => ({ x: Math.max(0, Math.min(map.width - 1, q.x + dx)), y: Math.max(0, Math.min(map.height - 1, q.y + dy)) });
      p.a = move(d.plan.a);
      p.b = move(d.plan.b);
    } else if (d.what === 'step') {
      const h = planHandles({ ...p, step: 0 });
      const dir = DIR[p.dir];
      const t = ((w.x - h.base.x) * dir.dx + (w.y - h.base.y) * dir.dy) / (dir.dx * dir.dx + dir.dy * dir.dy);
      const k = PLAN_KINDS[p.kind];
      p.step = Math.max(k.steps[0], Math.min(k.steps[1], Math.round(t)));
    }
    e.stopPropagation();
    opts.redraw();
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (!m.drag || e.pointerId !== m.drag.id) return;
    const p = sel();
    if (m.drag.what === 'new' && m.drawing) {
      let { a, b } = m.drawing;
      if (a.x === b.x && a.y === b.y) {
        // Nur angetippt: Linie der Standardlaenge quer zur Richtung
        const dir = DIR[p.dir];
        const half = DEFAULT_LEN / 2;
        a = { x: a.x + dir.dy * half, y: a.y - dir.dx * half };
        b = { x: m.drawing.a.x - dir.dy * (half - 1), y: m.drawing.a.y + dir.dx * (half - 1) };
        const clamp = (q) => ({ x: Math.max(0, Math.min(map.width - 1, q.x)), y: Math.max(0, Math.min(map.height - 1, q.y)) });
        a = clamp(a); b = clamp(b);
      } else {
        p.dir = normalDir(a, b, side);
      }
      p.a = a; p.b = b;
      m.wantLine = false;
      m.drawing = null;
    }
    m.drag = null;
    e.stopPropagation();
    render();
  }
  root.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);

  /** Antippen (aus der Zielwahl des Gefechtsbildschirms): Stoerfeuer-Ziel, Gegenbatterie, Plan waehlen */
  function tap(cell) {
    const p = sel();
    if (p && PLAN_KINDS[p.kind].target) { p.target = { x: cell.x, y: cell.y }; render(); return false; }
    if (p && PLAN_KINDS[p.kind].battery) {
      const hit = Object.entries(art.known ?? {}).find(([, e]) => cell.x >= e.pos.x && cell.y >= e.pos.y && cell.x < e.pos.x + (e.w ?? 2) && cell.y < e.pos.y + (e.h ?? 2));
      if (hit) { p.battery = hit[0]; render(); }
      return false;
    }
    // Plan unter dem Finger waehlen
    const round = (q) => q.start;
    const under = m.plans.find((q) => q.id !== m.sel && PLAN_KINDS[q.kind].line && planCellsAt({ ...q, fired: 0 }, round(q), map).some((c) => c.x === cell.x && c.y === cell.y));
    if (under) { m.sel = under.id; m.wantLine = false; render(); }
    return false;
  }

  // ---------- Zeichnen (Weltkoordinaten, unter den Gruppen) ----------
  function draw(ctx, { theme: th, px }) {
    // Feines Raster wie auf Transparentpapier
    ctx.save();
    ctx.strokeStyle = th.ink;
    ctx.globalAlpha = 0.07;
    ctx.lineWidth = 1 * px;
    ctx.beginPath();
    for (let x = 0; x <= map.width; x++) { ctx.moveTo(x, 0); ctx.lineTo(x, map.height); }
    for (let y = 0; y <= map.height; y++) { ctx.moveTo(0, y); ctx.lineTo(map.width, y); }
    ctx.stroke();
    ctx.restore();

    const p = sel();
    for (const l of art.lines) drawLine(ctx, l, { th, px, emph: true, map });
    for (const b of art.batteries) {
      drawBattery(ctx, b, art, { th, px, selected: !!p?.batteries.includes(b.id) });
    }
    for (const [id, e] of Object.entries(art.known ?? {}).sort()) {
      ctx.save();
      ctx.strokeStyle = th.enemy;
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(e.pos.x, e.pos.y, e.w ?? 2, e.h ?? 2);
      ctx.restore();
      void id;
    }
    if (p) for (const id of p.batteries) {
      const b = art.batteries.find((x) => x.id === id);
      if (b) drawRange(ctx, b, { color: th.ink2, px, alpha: 0.5 });
    }
    for (const q of m.plans) {
      if (q.id === m.sel) continue;
      drawPlan(ctx, q, { th, px, map, state, side, faint: true, timeBands: false, color: th.ink2 });
    }
    if (p) {
      drawPlan(ctx, p, { th, px, map, state, side, selected: true, timeBands: true, clock: state.clock, currentRound: state.battle?.round ?? 1 });
      if (p.kind === 'creep') drawStormGhosts(ctx, stormGhosts(map, state, side, p), { th, px, marks: opts.marks });
      if (PLAN_KINDS[p.kind].line && !m.wantLine) {
        const h = planHandles(p);
        ctx.save();
        ctx.strokeStyle = th.accent;
        ctx.lineWidth = 2.5 * px;
        ctx.beginPath();
        ctx.moveTo(h.a.x, h.a.y); ctx.lineTo(h.b.x, h.b.y);
        ctx.stroke();
        if (h.step) {
          // Lineal fuer die Schrittweite: Striche je Feld bis zum Griff
          const d = DIR[p.dir];
          ctx.lineWidth = 1.5 * px;
          ctx.setLineDash([3 * px, 3 * px]);
          ctx.beginPath();
          ctx.moveTo(h.b.x, h.b.y); ctx.lineTo(h.base.x, h.base.y);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineWidth = 2.5 * px;
          ctx.beginPath();
          ctx.moveTo(h.base.x, h.base.y); ctx.lineTo(h.base.x + d.dx * 3, h.base.y + d.dy * 3);
          ctx.globalAlpha = 0.45;
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath();
          for (let i = 0; i <= 3; i++) {
            const x = h.base.x + d.dx * i, y = h.base.y + d.dy * i;
            ctx.moveTo(x - d.dy * 0.25, y + d.dx * 0.25); ctx.lineTo(x + d.dy * 0.25, y - d.dx * 0.25);
          }
          ctx.stroke();
        }
        ctx.restore();
        const active = m.drag?.what;
        drawHandle(ctx, h.a.x, h.a.y, 'Start', { th, px, active: active === 'a' });
        drawHandle(ctx, h.b.x, h.b.y, '', { th, px, active: active === 'b' });
        if (h.mid) drawHandle(ctx, h.mid.x, h.mid.y, '', { th, px, active: active === 'mid' });
        if (h.step) drawHandle(ctx, h.step.x, h.step.y, 'Schritt', { th, px, active: active === 'step' });
      }
    }
    if (m.drawing) {
      const cells = [];
      const { a, b } = m.drawing;
      const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (let i = 0; i <= n; i++) cells.push({ x: Math.round(a.x + ((b.x - a.x) * i) / (n || 1)), y: Math.round(a.y + ((b.y - a.y) * i) / (n || 1)) });
      drawBand(ctx, cells, { color: th.accent, px, fill: 0.25 });
      const c = centerOf(cells);
      ctx.save();
      ctx.font = `700 ${12 * px}px ${FONTS.num}`;
      ctx.fillStyle = th.accent;
      ctx.fillText(`${n + 1} Felder`, c.x + 1.2, c.y + 0.5);
      ctx.restore();
    }
  }

  function close() {
    root.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onUp, true);
    root.classList.remove('fp-open');
    el.remove();
  }

  // Ohne Plan beginnt der Editor mit einer Feuerwalze, deren Linie man gleich zieht. Erst hier, wenn das Planblatt
  // (el) und alle Funktionen stehen; vorher stuerzte das Oeffnen ohne vorhandenen Plan ab.
  if (!m.plans.length && art.batteries.length) addPlan('creep', { wantLine: true });
  else render();
  return { close, draw, tap, model: m, el, center: () => centerOf(planCellsAt({ ...(sel() ?? {}), fired: 0 }, sel()?.start ?? 1, map)) };
}

export { batteryCenter };
