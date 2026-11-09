// Taktik-Lehrling (Plan 7.5, Paket P13): Die KI zeigt auf Wunsch, was sie an deiner Stelle tun wuerde, und
// erklaert warum. Dieselbe KI wie der Gegner (js/ai.js, advisor: true); der Lehrling hat Lasks Art zu planen
// gelernt und schreibt seine Vorschlaege mit Bleistift auf die Karte, nummeriert wie im Kaertchen.
// Ein Vorschlag laesst sich einzeln oder alle auf einmal uebernehmen; uebernommene Befehle landen im Befehlsbuch.
import { esc, ensureCss } from './dom.js';
import { FONTS } from '../render/map-layer.js';

/**
 * Kaertchen mit den Vorschlaegen.
 * handlers: { onAdopt(i), onAdoptAll(), onJump(i), onClose() }
 * Liefert { el, open, show(model), update(model), hide() }.
 * model: { posture, reason, doctrine, items: [{ name, mark, what, why, adopted }] }
 */
export function createLehrling(root, { onAdopt, onAdoptAll, onJump, onClose }) {
  ensureCss('css/lehrling.css');
  const el = document.createElement('section');
  el.className = 'card lehrling';
  el.hidden = true;
  el.setAttribute('aria-label', 'Taktik-Lehrling');
  el.innerHTML = `
    <header><b>Taktik-Lehrling</b><span class="sub"></span><button type="button" class="x" aria-label="Taktik-Lehrling schließen">×</button></header>
    <p class="lr-lage"></p>
    <ol class="lr-list"></ol>
    <footer><button type="button" class="btn lr-all">Alle übernehmen</button><span class="lr-foot"></span></footer>`;
  root.append(el);
  el.querySelector('.x').addEventListener('click', () => onClose());
  el.querySelector('.lr-all').addEventListener('click', () => onAdoptAll());
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-adopt]');
    if (a) { onAdopt(Number(a.dataset.adopt)); return; }
    const j = e.target.closest('[data-jump]');
    if (j) onJump(Number(j.dataset.jump));
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
  });

  function update(m) {
    el.querySelector('.sub').textContent = m.doctrine ? `nach Lasks Art · ${m.doctrine}` : 'nach Lasks Art';
    el.querySelector('.lr-lage').innerHTML = `<b>Lage ${esc(m.posture)}.</b> ${esc(m.reason)}`;
    const list = el.querySelector('.lr-list');
    list.innerHTML = m.items.length
      ? m.items.map((it, i) => `<li class="${it.adopted ? 'done' : ''}">
          <button type="button" class="lr-row" data-jump="${i}"><span class="lr-n" aria-hidden="true">${i + 1}</span>
            <span class="lr-who">${esc(it.name)}${it.mark ? ` <small>${esc(it.mark)}</small>` : ''}</span>
            <span class="lr-what">${esc(it.what)}</span><span class="lr-why">${esc(it.why)}</span></button>
          <button type="button" class="lr-take" data-adopt="${i}" ${it.adopted ? 'disabled' : ''} aria-label="${it.adopted ? 'übernommen' : `Vorschlag ${i + 1} übernehmen`}">${it.adopted ? '✓' : 'nehmen'}</button>
        </li>`).join('')
      : '<li class="lr-empty">Nichts zu ändern. Der Lehrling würde alle Gruppen halten lassen.</li>';
    const open = m.items.filter((it) => !it.adopted && !it.taken).length;
    const all = el.querySelector('.lr-all');
    all.disabled = open === 0;
    all.textContent = open ? `Alle übernehmen (${open})` : 'Alles übernommen';
    el.querySelector('.lr-foot').textContent = m.items.length ? 'Bleistift auf der Karte: dieselben Nummern.' : '';
  }

  return {
    el,
    get open() { return !el.hidden; },
    show(m) { update(m); el.hidden = false; (el.querySelector('.lr-take:not([disabled])') ?? el.querySelector('.x')).focus({ preventScroll: true }); },
    update,
    hide() { el.hidden = true; },
  };
}

/** Knopf "Lehrling" in der rechten Leiste und, auf dem Handy, eine Karte in der Seitenleiste */
export function mountLehrlingButton({ bar, sheet = null, onClick }) {
  ensureCss('css/lehrling.css');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn lr-btn';
  button.setAttribute('aria-keyshortcuts', 'T');
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = 'Lehrling <kbd>T</kbd>';
  button.addEventListener('click', () => onClick());
  bar.append(button);
  let card = null;
  if (sheet) {
    card = document.createElement('section');
    card.className = 'card lr-card';
    card.innerHTML = `<span class="k">Taktik-Lehrling</span><p>Was würde Lask an deiner Stelle tun?</p><button type="button" class="btn">Vorschläge zeigen</button>`;
    card.querySelector('button').addEventListener('click', () => onClick());
    sheet.append(card);
  }
  return {
    button, card,
    setActive(on) { button.setAttribute('aria-pressed', String(!!on)); button.classList.toggle('on', !!on); },
  };
}

// ---------- Bleistift auf der Karte ----------

const center = (p) => ({ x: p.x + 0.5, y: p.y + 0.5 });

function wobble(seed, i) {
  // kleine, feste Abweichung, damit der Strich nach Hand aussieht (ohne Zufall)
  const h = Math.imul(seed ^ (i * 0x45d9f3b), 0x27d4eb2d) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.12;
}

function numberTag(ctx, p, n, th, px, done) {
  const r = Math.max(0.36, 11 * px);
  ctx.save();
  ctx.setLineDash([]);
  ctx.globalAlpha = done ? 0.55 : 1;
  ctx.fillStyle = th.paper;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = Math.max(1.6 * px, 0.06);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = th.ink;
  ctx.font = `700 ${r * 1.5}px ${FONTS.hand}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(done ? '✓' : String(n), p.x, p.y + r * 0.06);
  ctx.restore();
}

/**
 * Overlay fuer drawBattle: nummerierte Bleistift-Vorschlaege. items: [{ order, from: {x,y}|null, adopted }]
 */
export function lehrlingOverlay(items) {
  return {
    draw(ctx, { theme: th, px }) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      items.forEach((it, i) => {
        const o = it.order;
        const seed = (i + 1) * 977;
        ctx.strokeStyle = th.accent;
        ctx.globalAlpha = it.adopted ? 0.4 : 0.95;
        ctx.lineWidth = Math.max(2.2 * px, 0.07);
        ctx.setLineDash([7 * px, 5 * px]);
        let tag = null;
        if (o.path?.length && it.from) {
          ctx.beginPath();
          const s = center(it.from);
          ctx.moveTo(s.x, s.y);
          o.path.forEach((p, k) => { const c = center(p); ctx.lineTo(c.x + wobble(seed, k), c.y + wobble(seed + 1, k)); });
          ctx.stroke();
          tag = center(o.path[o.path.length - 1]);
        } else if (o.target && it.from) {
          const s = center(it.from), t = center(o.target);
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(t.x, t.y);
          ctx.stroke();
          ctx.setLineDash([]);
          const k = 0.3;
          ctx.beginPath();
          ctx.moveTo(t.x - k, t.y - k); ctx.lineTo(t.x + k, t.y + k);
          ctx.moveTo(t.x + k, t.y - k); ctx.lineTo(t.x - k, t.y + k);
          ctx.stroke();
          tag = t;
        } else if (o.type === 'fire_plan') {
          for (const p of o.plans ?? []) {
            if (p.a && p.b) {
              ctx.beginPath();
              ctx.moveTo(p.a.x + 0.5, p.a.y + 0.5);
              ctx.lineTo(p.b.x + 0.5, p.b.y + 0.5);
              ctx.stroke();
              tag ??= { x: (p.a.x + p.b.x) / 2 + 0.5, y: (p.a.y + p.b.y) / 2 + 0.5 };
            } else if (p.target) {
              const t = center(p.target);
              ctx.beginPath();
              ctx.arc(t.x, t.y, 2, 0, Math.PI * 2);
              ctx.stroke();
              tag ??= t;
            }
          }
        } else if (it.from) {
          tag = { x: it.from.x + 0.5, y: it.from.y - 0.4 };
        }
        if (tag) numberTag(ctx, { x: tag.x + 0.55, y: tag.y - 0.55 }, i + 1, th, px, it.adopted);
      });
      ctx.restore();
    },
  };
}

// ---------- Steuerung im Gefecht ----------

const sameOrder = (p, q) => !!p && !!q && JSON.stringify({ ...p, carried: undefined }) === JSON.stringify({ ...q, carried: undefined });

/**
 * Taktik-Lehrling an den Gefechtsbildschirm haengen. Die Szene reicht nur Zugriffe herein, damit sie klein bleibt.
 * api: {
 *   ui, bar, sheet, decide, viewFor, map, env, seed, cfg: { doctrine, difficulty },
 *   now(): { state, side, log, orderOf(groupId), plans }, adopt(order), adoptPlan(order),
 *   label(group), mark(group), describe(group, order), focus({ group?, at? }), beforeOpen(), changed()
 * }
 * Liefert { toggle, close, open, overlays(), sync(), afterRound(state, log) }.
 */
export function attachLehrling(api) {
  let decision = null;
  const memory = {};
  const carry = {};
  const panel = createLehrling(api.ui, {
    onAdopt: (i) => adopt([i]),
    onAdoptAll: () => adopt(decision ? decision.advice.map((_, i) => i) : []),
    onJump: (i) => { const a = decision?.advice[i]; if (a) api.focus(a.group ? { group: a.group } : { at: planAt(a.order) }); },
    onClose: () => close(),
  });
  const btn = mountLehrlingButton({ bar: api.bar, sheet: api.sheet, onClick: () => toggle() });

  function planAt(o) {
    const p = o.plans?.[0];
    return p?.a ?? p?.target ?? null;
  }

  function compute() {
    const { state, side, log } = api.now();
    decision = api.decide(api.viewFor(state, log, side, api.env), {
      map: api.map, seed: api.seed, doctrine: api.cfg.doctrine, difficulty: 'lask', advisor: true, memory: memory[side],
    });
  }

  function isAdopted(a) {
    const n = api.now();
    if (!a.group) {
      const have = n.plans?.[a.order.type]?.plans ?? [];
      return (a.order.plans ?? []).every((p) => have.some((q) => sameOrder(p, q)));
    }
    const cur = n.orderOf(a.group);
    return sameOrder(cur, a.order);
  }

  function model() {
    const { state } = api.now();
    const items = decision.advice.map((a) => {
      const g = a.group ? state.groups.find((x) => x.id === a.group) : null;
      return {
        name: g ? api.label(g) : 'Artillerie',
        mark: g ? api.mark(g) : '',
        what: g ? api.describe(g, a.order) : `Feuerplan: ${(a.order.plans ?? []).length} ${(a.order.plans ?? []).length === 1 ? 'Plan' : 'Pläne'}`,
        // Der Name steht schon in der Zeile darueber: "Gruppe Janssen richtet ..." wird zu "richtet ..."
        why: g ? a.reason.replace(/^Gruppe \S+ /, '') : a.reason.replace(/^Artillerie: /, ''),
        adopted: isAdopted(a),
        taken: !!a.group && !isAdopted(a) && !!api.now().orderOf(a.group), // Spieler hat schon anders befohlen
      };
    });
    return { posture: decision.postureLabel, reason: decision.postureReason, doctrine: null, items };
  }

  function adopt(list) {
    if (!decision) return;
    const all = list.length > 1;
    const { orderOf } = api.now();
    for (const i of list) {
      const a = decision.advice[i];
      if (!a || isAdopted(a)) continue;
      // "Alle uebernehmen" ueberschreibt keine Befehle, die der Spieler schon gegeben hat
      if (all && a.group && orderOf(a.group)) continue;
      if (a.group) api.adopt(structuredClone(a.order)); else api.adoptPlan(structuredClone(a.order));
    }
    panel.update(model());
    api.changed();
  }

  function open() {
    if (api.canOpen && !api.canOpen()) return;
    api.beforeOpen();
    compute();
    panel.show(model());
    btn.setActive(true);
    api.changed();
  }
  function close() {
    if (!panel.open) return;
    panel.hide();
    btn.setActive(false);
    api.changed();
  }
  function toggle() { if (panel.open) close(); else open(); }

  return {
    toggle, close,
    get open() { return panel.open; },
    /** Overlays fuer drawBattle, solange das Kaertchen offen ist */
    overlays() {
      if (!panel.open || !decision) return [];
      const { state } = api.now();
      return [lehrlingOverlay(decision.advice.map((a) => ({
        order: a.order, from: a.group ? state.groups.find((g) => g.id === a.group)?.pos ?? null : null, adopted: isAdopted(a),
      })))];
    },
    /** Haken "drin" nachziehen, wenn der Spieler selbst Befehle aendert */
    sync() { if (panel.open && decision) panel.update(model()); },
    /** Nach jeder Runde: Gedaechtnis des Lehrlings fortschreiben (zaehlt Vorbereitung wie Lask) */
    afterRound(sides) {
      const { state, log } = api.now();
      // memory[s] = Gedaechtnis bis zur letzten Runde; die Entscheidung fuer diese Runde gilt erst ab der naechsten
      for (const s of sides) {
        if (carry[s]) memory[s] = carry[s];
        carry[s] = api.decide(api.viewFor(state, log, s, api.env), { map: api.map, seed: api.seed, doctrine: api.cfg.doctrine, difficulty: 'lask', advisor: true, memory: memory[s] }).memory;
      }
      close();
    },
  };
}
