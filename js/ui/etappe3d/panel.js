// Bauleiste neben (Desktop) bzw. unter (Handy) dem Modell: Etappenstufe, Belohnungswahl, Bauoptionen mit Ertragsvorschau.
import { BUILDINGS } from '../../config/buildings.js';
import { GROUNDS } from '../../config/grounds.js';
import {
  fieldName, formatAmount, buildOptions, buildingYield, etappeYield, etappeLevel, pendingRewards, repairCost,
} from '../../etappe.js';

const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

function yieldLine(total, every) {
  const parts = Object.keys(total).filter((r) => total[r]).map((r) => formatAmount(r, total[r]));
  if (!parts.length) return 'kein eigener Ertrag';
  return parts.join(' · ') + (every > 1 ? ` alle ${every} Runden` : ' / Runde');
}

const rounds = (n) => `${n} ${n === 1 ? 'Stellungsrunde' : 'Stellungsrunden'}`;

export function createPanel(aside, { onPick, onBuild, onChooseReward, onRepair, onCancel }) {
  aside.setAttribute('aria-label', 'Bauoptionen');
  let openTotals = null;

  // Das Panel wird bei jeder Aenderung neu aufgebaut; der Tastaturfokus wird ueber data-fk wiederhergestellt.
  function render(args) {
    const a = document.activeElement;
    const fk = a && aside.contains(a) ? a.dataset.fk || 'head' : null;
    const scroll = aside.scrollTop;
    const out = draw(args);
    aside.scrollTop = scroll;
    if (fk) {
      const t = aside.querySelector(`[data-fk="${CSS.escape(fk)}"]`) || aside.querySelector('[data-fk="head"]');
      if (t) t.focus({ preventScroll: true });
    }
    return out;
  }

  function draw({ etappe, selected, pick, act, material }) {
    aside.textContent = '';
    const y = etappeYield(etappe);
    const lv = etappeLevel(y.levelLoren);

    // Stand der Etappe
    const sum = h('div', 'e3-sum');
    const head = h('div', 'lv');
    head.append(h('span', null, `Etappe · Stufe ${lv.level}`), h('small', null, `${y.total.loren || 0} Loren / Runde`));
    sum.append(head);
    const bar = h('div', 'e3-bar');
    const fill = h('i');
    const span = lv.next == null ? 1 : (lv.next - lv.minLoren);
    fill.style.width = (lv.next == null ? 100 : Math.round(100 * ((lv.loren - lv.minLoren) / span))) + '%';
    bar.append(fill);
    sum.append(bar);
    sum.append(h('div', 'tot', lv.next == null ? 'Höchste Stufe erreicht.' : `Stufe ${lv.level + 1} ab ${lv.next} Loren aus eigenen Gebäuden.`));
    const totals = Object.keys(y.total).filter((r) => r !== 'loren').map((r) => formatAmount(r, y.total[r]));
    for (const p of y.periodic) totals.push(`${formatAmount(p.res, p.amount)} alle ${p.every} Runden`);
    if (totals.length) {
      // Auf dem Handy eingeklappt, damit die Bauoptionen sichtbar bleiben
      const det = h('details', 'tot');
      det.open = openTotals ?? !matchMedia('(max-width: 760px)').matches;
      det.addEventListener('toggle', () => { openTotals = det.open; });
      det.append(h('summary', null, 'Ertrag pro Runde'), document.createTextNode(totals.join(' · ')));
      sum.append(det);
    }
    if (material != null) sum.append(h('div', 'tot', `Material im Depot: ${material}`));

    for (const p of pendingRewards(etappe)) {
      const box = h('div', 'e3-reward');
      box.append(h('p', null, `Stufe ${p.level} erreicht. Wähle eine Belohnung:`));
      const row = h('div', 'row');
      for (const r of p.rewards) {
        const b = h('button');
        b.type = 'button';
        b.dataset.fk = 'rw-' + r.id;
        b.append(h('b', null, r.name), h('span', null, r.text));
        b.addEventListener('click', () => onChooseReward(p.level, r.id));
        row.append(b);
      }
      box.append(row);
      sum.append(box);
      break; // immer nur die naechste offene Stufe
    }
    aside.append(sum);

    if (!selected) {
      aside.append(h('h4', null, 'Kein Feld gewählt'), h('p', 'e3-muted', 'Tippe ein Feld im Modell an, um zu sehen, was dort gebaut werden kann.'));
      return { highlight: [] };
    }
    const field = etappe.fields.find((f) => f.x === selected.x && f.y === selected.y);
    if (!field) return { highlight: [] };
    const g = GROUNDS[field.ground];
    const title = h('h4');
    title.tabIndex = -1;
    title.dataset.fk = 'head';
    aside.append(title);
    title.textContent = (`Feld ${fieldName(field.x, field.y)} · ${g ? g.label : field.ground}${field.height ? ' · Höhe ' + field.height : ''}`);

    // bei doppelt belegtem Feld gilt wie in der Logik das Gebaeude mit der kleinsten ID
    const there = etappe.buildings.filter((b) => b.x === field.x && b.y === field.y).sort((p, q) => (p.id < q.id ? -1 : 1))[0];
    if (there) {
      const def = BUILDINGS[there.type];
      const yb = buildingYield(etappe, there);
      const info = h('div', 'e3-info');
      info.append(h('b', null, def ? def.name : there.type));
      if (def) info.append(h('p', null, def.effect));
      if (there.planned) info.append(h('p', 'st', there.planned === 'repair' ? 'Reparatur geplant: beginnt mit der nächsten Stellungsrunde.' : `Bauauftrag: beginnt mit der nächsten Stellungsrunde, fertig in ${rounds(there.remaining)}.`));
      else if (yb.blocked) info.append(h('p', 'st', yb.blocked));
      info.append(h('p', null, yieldLine(yb.blocked ? yb.base : yb.total, yb.every)));
      for (const bo of yb.bonus) info.append(h('em', null, bo.reason));
      for (const m of yb.missing) info.append(h('em', 'no', m));
      if (there.spotted) info.append(h('p', 'st', there.spottedBy === 'smoke' ? 'Vom Gegner aufgeklärt: Er hat den Rauch gesehen.' : 'Vom Gegner aufgeklärt.'));
      aside.append(info);
      if (there.planned && onCancel) {
        const no = h('button', 'e3-go', there.planned === 'repair' ? 'Reparatur streichen' : 'Bauauftrag streichen');
        no.type = 'button';
        no.dataset.fk = 'cancel';
        no.style.marginTop = '8px';
        no.addEventListener('click', () => onCancel(there.id));
        aside.append(no);
      } else if (there.damaged && onRepair) {
        const cost = repairCost(there.type);
        const can = material == null || cost <= material;
        const rep = h('button', 'e3-go', can ? `Reparieren · Material ${cost} · 1 Stellungsrunde` : `Reparatur braucht ${cost} Material`);
        rep.type = 'button';
        rep.dataset.fk = 'repair';
        rep.disabled = !can;
        rep.style.marginTop = '8px';
        rep.addEventListener('click', () => onRepair(there.id));
        aside.append(rep);
      }
      const hl = [];
      for (const bo of yb.bonus) hl.push(...bo.from);
      return { highlight: hl };
    }

    const opts = buildOptions(etappe, field.x, field.y, { act, material });
    const g0 = GROUNDS[field.ground];
    if (g0 && !g0.buildable) {
      aside.append(h('p', 'e3-muted', g0.why + '.'));
      return { highlight: [] };
    }
    let current = opts.find((o) => o.type === pick) || opts.find((o) => o.ok) || opts[0];
    const ul = h('ul', 'e3-opts');
    for (const o of opts) {
      const li = h('li');
      const btn = h('button', 'e3-opt' + (o.ok ? '' : ' off'));
      btn.type = 'button';
      btn.dataset.fk = 'opt-' + o.type;
      btn.setAttribute('aria-pressed', String(o === current));
      btn.append(h('b', null, o.name));
      btn.append(h('span', 'y', yieldLine(o.own.base, o.own.every)));
      for (const bo of o.own.bonus) btn.append(h('em', null, bo.reason));
      for (const m of o.own.missing) btn.append(h('em', 'no', m));
      if (o.own.blocked) btn.append(h('em', 'no', o.own.blocked));
      for (const n of o.neighbors) for (const line of n.lines) btn.append(h('em', 'nb', 'Nachbar ' + line));
      if (o.levelAfter > o.levelBefore) btn.append(h('em', null, `hebt die Etappe auf Stufe ${o.levelAfter}`));
      // Die Vorschau zeigt den Stand nach der Fertigstellung
      btn.append(h('i', null, `Material ${o.cost} · fertig in ${rounds(o.buildTime)}`));
      if (!o.ok) btn.append(h('i', 'why', o.reason));
      btn.addEventListener('click', () => onPick(o.type));
      li.append(btn);
      if (o === current) {
        const go = h('button', 'e3-go', o.ok ? `${o.name} bauen` : 'Hier nicht baubar');
        go.type = 'button';
        go.dataset.fk = 'go';
        go.disabled = !o.ok;
        go.addEventListener('click', () => onBuild(field.x, field.y, o.type));
        li.append(go);
      }
      ul.append(li);
    }
    aside.append(ul);
    aside.append(h('p', 'e3-muted', 'Blau: Nachbarboni. Gestrichelte Felder geben oder bekommen den Bonus.'));
    return { highlight: current ? current.highlight : [] };
  }

  return { render };
}
