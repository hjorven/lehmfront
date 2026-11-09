// Feldzugskarte zwischen den Missionen (P14, Plan 3.1, 2.6, 4.3, Stil 09 Kriegsraum):
// Kartentisch mit Front und Missionen, Ansehen und Vertrauen mit Wirkung und Verlauf, Stabsbefehl zum Abstempeln
// (befolgen, umdeuten, verweigern), Antwort des Stabs, Karteikasten der Erfahrungsberichte, Aufbruch zum Einsatz.
import { esc, html } from '../dom.js';
import { applyWarRoom } from '../../theme.js';
import { playSfx } from '../../audio/engine.js';
import { pickSlot, fill, actOf, actRoman } from '../../narrative/texts.js';
import { missionTitle } from '../../narrative/interlude.js';
import { axisEffects, stampCost, LIMITS, orderConsequence } from '../../campaign.js';
import { REPORTS } from '../../config/reports.js';
import { missionBuilt } from '../../config/missions.js';
import { drawWarMap, missionShort } from './warmap.js';

const STAMP_LABEL = { befolgen: 'Befolgen', umdeuten: 'Umdeuten', verweigern: 'Verweigern' };
const STAMP_MARK = { befolgen: 'VERSTANDEN', umdeuten: 'RÜCKFRAGE', verweigern: 'VERWEIGERT' };
const sign = (n) => (n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '±0');

/** Telegrammtext in Zeilen (ein Satz je Zeile, mit STOP) */
export function telegramLines(text) {
  return String(text ?? '').split(/\s*STOP\s*/).map((s) => s.trim()).filter(Boolean).map((s) => s + ' STOP');
}

function telegram({ cls = '', heading, nr = '', fields = [], lines = [], mark = null, sig = '', eilt = false }) {
  return `<article class="fz-tele ${cls}">
    <header><span class="fz-tele-h">${esc(heading)}</span>${nr ? `<span class="fz-tele-nr">${esc(nr)}</span>` : ''}${eilt ? '<span class="fz-eilt">EILT</span>' : ''}</header>
    ${fields.length ? `<dl>${fields.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
    <div class="fz-tele-body">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}</div>
    ${sig ? `<footer>${esc(sig)}</footer>` : ''}
    ${mark ? `<div class="fz-stamp ${esc(mark.cls)}" aria-label="Stempel ${esc(mark.text)}">${esc(mark.text)}</div>` : ''}
  </article>`;
}

/** Strichliste fuer den Fortschritt eines Berichts: hoechstens 20 Striche, in Fuenfergruppen */
export function tally(n, need) {
  const strokes = Math.max(0, Math.min(20, Math.floor((Math.min(n, need) * 20) / need)));
  const groups = [];
  for (let i = 0; i < strokes; i += 5) groups.push(Math.min(5, strokes - i));
  return groups;
}

function tallySvg(n, need) {
  const groups = tally(n, need);
  if (!groups.length) return '<span class="fz-tally-none">noch nichts</span>';
  const parts = groups.map((k, gi) => {
    const x0 = gi * 22;
    let s = '';
    for (let i = 0; i < Math.min(4, k); i++) s += `<path d="M${x0 + 2 + i * 4} 2 L${x0 + 1 + i * 4} 15"/>`;
    if (k === 5) s += `<path d="M${x0} 12 L${x0 + 17} 4"/>`;
    return s;
  });
  return `<svg class="fz-tally" width="${groups.length * 22}" height="17" viewBox="0 0 ${groups.length * 22} 17" aria-hidden="true">${parts.join('')}</svg>`;
}

function spark(history, key, w = 132, h = 26) {
  const pts = history.map((p, i) => [history.length > 1 ? (i * w) / (history.length - 1) : w / 2, h - ((p[key] ?? 50) * h) / 100]);
  if (!pts.length) return '';
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const t25 = h - (LIMITS.THREAT * h) / 100, t10 = h - (LIMITS.RELIEF * h) / 100;
  return `<svg class="fz-spark" width="${w}" height="${h}" viewBox="-2 -2 ${w + 4} ${h + 4}" aria-hidden="true">
    <path class="lim" d="M0 ${t25} H${w}"/><path class="lim hard" d="M0 ${t10} H${w}"/>
    <polyline points="${line}"/>${pts.length ? `<circle cx="${pts[pts.length - 1][0]}" cy="${pts[pts.length - 1][1]}" r="2.6"/>` : ''}</svg>`;
}

/**
 * Feldzugskarte aufbauen. opts: { campaign, index, next (Mission oder null), ended, onStamp(stamp), onStart(),
 *   onJournal(), onNew(), demo }. Rueckgabe: { update(campaign), revealReply(), destroy() }
 */
export function createBoard(root, opts) {
  const { index } = opts;
  let campaign = opts.campaign;
  let armed = null; // Verweigern muss zweimal getippt werden
  const el = html(`<div class="fz" data-daytime="night">
    <canvas class="fz-map" aria-label="Feldzugskarte des Abschnitts Asse-Nord"></canvas>
    <div class="fz-tip" hidden></div>
    <header class="fz-head card"></header>
    <section class="fz-axes card" aria-label="Ansehen und Vertrauen"></section>
    <section class="fz-desk" aria-label="Stabsbefehl und Telegramme"></section>
    <section class="fz-reports card" aria-label="Erfahrungsberichte"></section>
    <footer class="fz-actions"></footer>
  </div>`);
  applyWarRoom(el);
  root.append(el);
  const $ = (s) => el.querySelector(s);
  const canvas = $('.fz-map');
  let hits = [];
  let hover = null;

  const next = () => (campaign.ended ? null : campaign.mission);
  const orderOf = (m) => index.list.find((e) => e.art === 'befehl' && e.mission === m) ?? null;
  const ctxOf = (extra = {}) => ({ ansehen: campaign.ansehen, vertrauen: campaign.vertrauen, flags: campaign.flags, fraktion: campaign.faction, ...extra });
  const sector = 'Asse-Nord';

  /** Hat die Mission eine eigene Entscheidung befolgen/umdeuten/verweigern? Dann stempelt man nur den Eingang. */
  function decidedElsewhere(m) {
    return index.list.some((e) => e.art === 'entscheidung' && e.mission === m && (e.optionen ?? []).some((o) => o.id === 'verweigern' || o.id === 'umdeuten'));
  }

  function drawMap() {
    hits = drawWarMap(canvas, { campaign, next: next(), ended: campaign.ended, highlight: hover });
  }

  function renderHead() {
    const m = next();
    const last = campaign.history.length > 1 ? campaign.history[campaign.history.length - 1].mission : null;
    const act = actOf(m ?? last ?? 'a1m1');
    const actCard = index.byId.get(`a${act}.titel`);
    const title = m ? missionTitle(index, m) : '';
    $('.fz-head').innerHTML = `<span class="k">Feldzugskarte · Abschnitt ${esc(sector)}</span>
      <b class="fz-title">Akt ${actRoman(act)}${actCard?.titel ? ' · ' + esc(actCard.titel) : ''}</b>
      <span class="fz-sub">${campaign.ended ? 'Der Feldzug ist für Brandt zu Ende.' : m ? `Nächster Einsatz ${missionShort(m)}: ${esc(title)}${missionBuilt(m) ? '' : ' <i>(Übungslage an der Asse)</i>'}` : 'Alle Einsätze gespielt.'}</span>`;
  }

  function renderAxes() {
    const fx = axisEffects(campaign, actOf(next() ?? campaign.mission));
    const bar = (label, v, cls) => `<div class="fz-axis ${cls}${v < LIMITS.THREAT ? ' low' : ''}">
      <div class="fz-axis-row"><span>${label}</span><b>${v}</b></div>
      <div class="fz-bar" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${v}" aria-label="${label}">
        <i style="width:${Math.max(0, Math.min(100, v))}%"></i><s style="left:${LIMITS.RELIEF}%"></s><s style="left:${LIMITS.THREAT}%"></s></div>
      ${spark(campaign.history, cls === 'rep' ? 'ansehen' : 'vertrauen')}</div>`;
    const lastLedger = [...campaign.ledger].reverse().find((l) => l.stage === 'mission');
    const lines = (lastLedger?.changes ?? []).slice(0, 8);
    $('.fz-axes').innerHTML = `
      ${bar('Ansehen beim Stab', campaign.ansehen, 'rep')}
      <ul class="fz-fx">
        <li><span>Nachschub je Runde</span><b>${fx.supplyPct} %</b></li>
        <li><span>Ersatz vor dem Einsatz</span><b>${fx.replacements} Mann</b></li>
        <li><span>Munition der Batterien</span><b>${fx.batteryPct} %</b></li>
        <li class="${fx.reportsHeld ? 'warn' : ''}"><span>Erfahrungsberichte</span><b>${fx.reportsHeld ? 'liegen beim Stab' : 'kommen an'}</b></li>
      </ul>
      ${bar('Vertrauen der Truppe', campaign.vertrauen, 'tru')}
      <ul class="fz-fx">
        <li><span>Moralerholung</span><b>${fx.recoveryPct} %</b></li>
        <li><span>Grabgeschwindigkeit</span><b>${fx.digPct} %</b></li>
        <li class="${fx.refuse ? 'warn' : ''}"><span>Bereitschaft zum Sturm</span><b>${fx.refuse ? 'Gruppen können verweigern' : fx.refuseSoon ? 'brüchig' : 'gegeben'}</b></li>
      </ul>
      ${lines.length ? `<details class="fz-ledger"${opts.openLedger ? ' open' : ''}><summary>Abrechnung des letzten Einsatzes</summary><ul>${lines.map((c) => `<li><b class="${c.amount < 0 ? 'neg' : 'pos'}">${sign(c.amount)}</b> <span>${c.axis === 'ansehen' ? 'Ansehen' : 'Vertrauen'}: ${esc(c.reason)}</span></li>`).join('')}</ul></details>` : ''}
      <p class="fz-limits">Unter ${LIMITS.THREAT}: Der Stab droht. Unter ${LIMITS.RELIEF}: Ablösung bzw. Meuterei.</p>`;
  }

  function stampHtml(m, order) {
    const stamped = campaign.stamps?.[m];
    if (stamped || campaign.ended) return '';
    const only = decidedElsewhere(m);
    const opt = (s) => {
      const k = stampCost(order, s);
      const f1 = orderConsequence(order, true, s), f0 = orderConsequence(order, false, s);
      const now = [k.ansehen ? `Ansehen ${sign(k.ansehen)}` : '', k.vertrauen ? `Vertrauen ${sign(k.vertrauen)}` : ''].filter(Boolean).join(', ');
      const later = s === 'verweigern' ? 'danach keine Folgen des Befehls' : `erfüllt ${sign(f1.ansehen)}, verfehlt ${sign(f0.ansehen)}`;
      return `<button type="button" class="fz-stamp-btn s-${s}" data-stamp="${s}"><b>${STAMP_LABEL[s]}</b><small>${now ? esc(now) + ' sofort · ' : ''}${esc(later)}</small></button>`;
    };
    if (only) return `<div class="fz-stamps"><button type="button" class="fz-stamp-btn s-befolgen" data-stamp="befolgen"><b>Eingang bestätigen</b><small>Die Entscheidung zu diesem Befehl fällt im Einsatz.</small></button></div>`;
    return `<div class="fz-stamps" role="group" aria-label="Stabsbefehl abstempeln">${['befolgen', 'umdeuten', 'verweigern'].map(opt).join('')}</div>
      <p class="fz-armed" aria-live="polite"></p>`;
  }

  function renderDesk() {
    const m = next();
    const out = [];
    // Stabsbefehl des naechsten Einsatzes mit Stempel
    if (m) {
      const order = orderOf(m);
      if (order) {
        const stamped = campaign.stamps?.[m];
        const mark = stamped ? { cls: stamped === 'verweigern' ? 'red' : stamped === 'umdeuten' ? 'blue' : 'ink', text: STAMP_MARK[stamped] } : null;
        out.push(`<div class="fz-order">${telegram({
          cls: 't-order', heading: 'STABSBEFEHL', nr: order.nr, eilt: order.eilt,
          fields: [['Von', order.von ?? ''], ['An', order.an ?? ''], ['Frist', order.frist ?? '']],
          lines: telegramLines(order.text), mark,
        })}${stampHtml(m, order)}</div>`);
        if (stamped && stamped !== 'befolgen') {
          const t = pickSlot(index, `stab.stempel.${stamped}`, ctxOf());
          if (t) out.push(telegram({ cls: 't-reply t-small', heading: 'STAB · ANTWORT', lines: telegramLines(t.text) }));
        }
      }
    }
    // Drohung unter 25 (rot gerandet)
    if (campaign.threat && !campaign.ended) {
      const t = pickSlot(index, 'stab.drohung', ctxOf());
      if (t) out.push(telegram({ cls: 't-threat', heading: 'STAB · PERSÖNLICH', lines: telegramLines(fill(t.text, { abschnitt: sector.toUpperCase() })), mark: { cls: 'red', text: 'VERTRAULICH' } }));
    }
    // Antwort auf den letzten Einsatz: je tiefer das Ansehen, desto knapper (Ueberraschung)
    if (campaign.reply) {
      const r = campaign.reply;
      const t = pickSlot(index, 'stab.antwort', ctxOf({ outcome: r.outcome, ansehen: campaign.ansehen }));
      if (t) {
        const band = t.band ?? r.band;
        const sig = band === 'herzlich' ? 'gez. van Aurach, Oberst' : band === 'sachlich' ? 'van Aurach' : '';
        out.push(telegram({
          cls: 't-reply band-' + band, heading: `ANTWORT DES STABS · ${missionShort(r.mission)}`,
          lines: telegramLines(fill(t.text, { abschnitt: sector.toUpperCase() })), sig,
          mark: band === 'kalt' ? { cls: 'blue', text: 'Z. D. A.' } : null,
        }));
      }
    }
    if (campaign.withheld?.length && !campaign.ended) {
      const t = pickSlot(index, 'stab.berichte', ctxOf());
      if (t) out.push(telegram({ cls: 't-reply t-small', heading: 'STAB · ERFAHRUNGSBERICHTE', lines: telegramLines(t.text), mark: { cls: 'blue', text: `${campaign.withheld.length} LIEGEN HIER` } }));
    }
    $('.fz-desk').innerHTML = out.join('');
  }

  function renderReports() {
    const act = actOf(next() ?? campaign.mission);
    const list = REPORTS.filter((r) => r.act <= act || campaign.reports.includes(r.id));
    const cards = list.map((r) => {
      const e = index.byId.get('bericht.' + r.id);
      const got = campaign.reports.includes(r.id);
      const held = campaign.withheld?.includes(r.id);
      const fresh = campaign.fresh?.includes(r.id);
      const n = campaign.counters?.[r.id] ?? 0;
      const state = got ? 'got' : held ? 'held' : 'open';
      return `<button type="button" class="fz-card ${state}${fresh ? ' fresh' : ''}" data-report="${r.id}" aria-label="${esc(e?.titel ?? r.id)}${got ? ', eingegangen' : held ? ', liegt beim Stab' : ''}">
        <b>${esc(e?.titel ?? r.id)}</b>
        ${got ? `<span class="fz-card-fx">${esc(e?.wirkung ?? '')}${r.live ? '' : ' <i>(wirkt, sobald es die Technik gibt)</i>'}</span>`
          : `<span class="fz-card-trig">${esc(e?.ausloeser ?? '')}</span>${tallySvg(n, r.need)}`}
        ${got ? `<span class="fz-card-stamp">${fresh ? 'NEU' : 'EINGEGANGEN'}</span>` : held ? '<span class="fz-card-stamp held">BEIM STAB</span>' : ''}
      </button>`;
    });
    const got = campaign.reports.length;
    $('.fz-reports').innerHTML = `<header><span class="k">Erfahrungsberichte</span><span class="fz-count">${got} von ${REPORTS.length} eingegangen</span></header>
      <div class="fz-cards">${cards.join('')}</div>`;
  }

  function renderActions() {
    const m = next();
    $('.fz-actions').innerHTML = `
      <button type="button" class="btn fz-new">Neuer Feldzug</button>
      <button type="button" class="btn fz-journal" aria-keyshortcuts="T">Tagebuch <kbd>T</kbd></button>
      ${m ? `<button type="button" class="btn fz-go" aria-keyshortcuts="Enter">Zum Einsatz ${esc(missionShort(m))} <kbd>Enter</kbd></button>` : ''}`;
  }

  function render() {
    renderHead();
    renderAxes();
    renderDesk();
    renderReports();
    renderActions();
    drawMap();
  }

  function openReport(id) {
    const r = REPORTS.find((x) => x.id === id);
    const e = index.byId.get('bericht.' + id);
    if (!r || !e) return;
    const got = campaign.reports.includes(id);
    const back = html(`<div class="fz-modal" role="dialog" aria-modal="true" aria-label="Erfahrungsbericht ${esc(e.titel)}">
      ${telegram({
        cls: 't-report', heading: 'ERFAHRUNGSBERICHT', nr: e.titel,
        fields: [['Auslöser', e.ausloeser ?? ''], ['Wirkung', e.wirkung ?? ''], ['Stand', got ? 'eingegangen' : `${Math.min(campaign.counters?.[id] ?? 0, r.need)} von ${r.need} ${r.unit}`]],
        lines: [e.text], mark: got ? { cls: 'ink', text: 'EINGEGANGEN' } : null,
      })}
      <button type="button" class="btn fz-close">Zurück an den Tisch</button></div>`);
    el.append(back);
    playSfx('paper', { intensity: 0.5 });
    const close = () => { back.remove(); el.querySelector(`[data-report="${id}"]`)?.focus({ preventScroll: true }); };
    back.querySelector('.fz-close').addEventListener('click', close);
    back.addEventListener('pointerdown', (ev) => { if (ev.target === back) close(); });
    back.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } });
    back.querySelector('.fz-close').focus({ preventScroll: true });
  }

  el.addEventListener('click', (ev) => {
    const s = ev.target.closest('[data-stamp]');
    if (s) {
      const stamp = s.dataset.stamp;
      if (stamp === 'verweigern' && armed !== 'verweigern') {
        armed = 'verweigern';
        const note = el.querySelector('.fz-armed');
        if (note) note.textContent = 'Noch einmal tippen, um den Befehl wirklich zu verweigern.';
        s.classList.add('armed');
        playSfx('pencil', { count: 1, intensity: 0.4 });
        return;
      }
      armed = null;
      opts.onStamp?.(stamp);
      return;
    }
    if (ev.target.closest('.fz-new')) {
      if (armed !== 'new') {
        armed = 'new';
        ev.target.closest('.fz-new').textContent = 'Wirklich neu beginnen?';
        return;
      }
      armed = null;
      opts.onNew?.();
      return;
    }
    if (armed) { armed = null; render(); }
    const card = ev.target.closest('[data-report]');
    if (card) { openReport(card.dataset.report); return; }
    if (ev.target.closest('.fz-go')) opts.onStart?.();
    else if (ev.target.closest('.fz-journal')) opts.onJournal?.();
  });

  const tip = $('.fz-tip');
  function hitAt(e) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return hits.find((h) => Math.abs(h.x - x) <= h.r && Math.abs(h.y - y) <= h.r) ?? null;
  }
  function showTip(h) {
    if (!h) { tip.hidden = true; return; }
    const out = campaign.outcomes?.[h.m];
    const order = orderOf(h.m);
    const stamp = campaign.stamps?.[h.m];
    tip.innerHTML = `<b>${missionShort(h.m)} · ${esc(missionTitle(index, h.m))}</b>
      <span>${out ? (out === 'sieg' ? 'Gehalten bzw. genommen' : 'Verloren') : h.m === next() ? 'Nächster Einsatz' : 'Kommt noch'}${stamp ? ' · Befehl ' + esc(STAMP_LABEL[stamp].toLowerCase()) : ''}</span>
      ${order ? `<span class="fz-tip-nr">${esc(order.nr)}</span>` : ''}`;
    const cr = canvas.getBoundingClientRect(), er = el.getBoundingClientRect();
    tip.hidden = false;
    const left = Math.max(8, Math.min(er.width - tip.offsetWidth - 8, cr.left - er.left + h.x + 16));
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, cr.top - er.top + h.y - 12) + 'px';
  }
  canvas.addEventListener('pointermove', (e) => {
    const h = hitAt(e);
    if ((h?.m ?? null) !== hover) { hover = h?.m ?? null; drawMap(); }
    showTip(h);
  });
  canvas.addEventListener('pointerleave', () => { hover = null; tip.hidden = true; drawMap(); });
  canvas.addEventListener('click', (e) => { const h = hitAt(e); showTip(h); if (h) playSfx('pencil', { count: 1, intensity: 0.3 }); });

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea') || el.querySelector('.fz-modal') || document.querySelector('.narr, .journal, .modal-back')) return;
    if (e.key === 't' || e.key === 'T') { e.preventDefault(); opts.onJournal?.(); }
    else if (e.key === 'Enter' && !e.target.closest?.('button')) { if (next()) { e.preventDefault(); opts.onStart?.(); } }
  };
  addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => drawMap());
  ro.observe(canvas);

  render();
  return {
    el,
    update(c) { campaign = c; render(); },
    destroy() { removeEventListener('keydown', onKey); ro.disconnect(); el.remove(); },
  };
}

