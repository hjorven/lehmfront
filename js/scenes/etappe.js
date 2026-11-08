// Demo des Etappenfensters mit einer Beispiel-Etappe. Aufruf: index.html?scene=etappe
// Parameter fuer reproduzierbare Screenshots:
//   &sel=H4        gewaehltes Feld        &night=1       Nachtfarben
//   &view=55,-20   Kippen und Drehen      &act=2         Gebaeude spaeterer Akte zeigen
//   &material=40   Material im Depot
import { renderEtappe } from '../ui/etappe3d/index.js';
import { placeBuilding, advanceConstruction, chooseReward, etappeYield, repairBuilding } from '../etappe.js';

// 10 x 6 Felder hinter der eigenen Linie. Zeichen: w Wiese, l Lehm, k Kreide, f Fels, d Dorf, W Wald, s Sumpf, ~ Wasser
const GROUND = {
  w: 'wiese', l: 'lehm', k: 'kreide', f: 'fels', d: 'dorf', W: 'wald', s: 'sumpf', '~': 'wasser',
};
const MAP = [
  'wlldwwWWWW',
  'wllwwwwWWW',
  'llwwwwwwWw',
  'lwwwwwlllf',
  'wwddwwlwkf',
  'ss~dwwwkkf',
];
const HEIGHT = [
  '0000000011',
  '0000000011',
  '0000000001',
  '0000000112',
  '0000000122',
  '0000000122',
];

function sampleFields() {
  const fields = [];
  MAP.forEach((row, y) => [...row].forEach((c, x) => fields.push({ x, y, ground: GROUND[c], height: Number(HEIGHT[y][x]) })));
  return fields;
}

function sampleBuildings() {
  const list = [
    ['b01', 'depot', 2, 1], ['b02', 'feldbahnhof', 3, 1],
    ['b10', 'feldkueche', 5, 3], ['b11', 'ruhelager', 6, 3], ['b12', 'feldlazarett', 6, 4],
    ['b13', 'saegewerk', 6, 1], ['b14', 'ziegelei', 1, 3], ['b15', 'werkstatt', 2, 3, { damaged: true }],
    ['b16', 'beobachtungsturm', 9, 4], ['b17', 'fernmeldestelle', 8, 4],
    ['b18', 'batteriestellung', 8, 3, { remaining: 2 }], ['b19', 'feldpost', 3, 4],
  ];
  // Gleis von links nach rechts durch Zeile 3 (y 2)
  for (let x = 0; x <= 7; x++) list.push(['r' + String(x).padStart(2, '0'), 'gleis', x, 2]);
  return list.map(([id, type, x, y, extra]) => ({ id, type, x, y, ...(extra || {}) }));
}

function parseField(s) {
  const m = /^([A-Za-z])(\d+)$/.exec(s || '');
  if (!m) return null;
  return { x: m[1].toUpperCase().charCodeAt(0) - 65, y: Number(m[2]) - 1 };
}

export function mount(root, params) {
  root.style.cssText = 'position:fixed;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr)';
  const night = params.get('night') === '1';
  const act = Number(params.get('act')) || 1;
  let material = params.has('material') ? Number(params.get('material')) : 40;
  let round = 3;
  let etappe = { fields: sampleFields(), buildings: sampleBuildings(), rewards: {} };
  let selected = parseField(params.get('sel')) || { x: 7, y: 3 };

  // Kopfzeile: Demo-Steuerung (im Spiel uebernimmt das der Rundenmotor aus P11)
  const bar = document.createElement('header');
  bar.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:2px 10px;align-items:center;padding:6px 12px;border-bottom:var(--border);background:var(--card);font:13px var(--font-ui)';
  const title = document.createElement('div');
  title.style.cssText = 'font:16px var(--font-head)';
  title.textContent = 'Etappe · Abschnitt Asse';
  const status = document.createElement('div');
  status.style.cssText = 'font:12px var(--font-num);color:var(--ink2)';
  const next = document.createElement('button');
  next.className = 'btn';
  next.style.cssText = 'padding:6px 10px';
  next.textContent = 'Stellungsrunde beenden';
  const left = document.createElement('div');
  left.append(title, status);
  bar.append(left, next);
  // Nachtfarben kommen als Token aus css/etappe3d.css (.e3-night), damit auch die Kopfzeile mitzieht
  if (night) root.classList.add('e3-night');
  root.style.background = 'var(--paper)';
  root.style.color = 'var(--ink)';

  const host = document.createElement('div');
  host.style.cssText = 'min-height:0;position:relative';
  root.append(bar, host);

  const props = () => ({
    fields: etappe.fields, buildings: etappe.buildings, rewards: etappe.rewards,
    selected, act, material, night,
  });

  const showStatus = () => { status.textContent = `Stellungsrunde ${round} · Material ${material}`; };

  const win = renderEtappe(host, {
    ...props(),
    onSelect: (x, y) => { selected = { x, y }; win.update({ selected }); },
    onBuild: (x, y, type) => {
      const r = placeBuilding(etappe, x, y, type, { act, material });
      if (!r.ok) return;
      material -= r.cost;
      etappe = r.etappe;
      showStatus();
      win.update(props());
    },
    onRepair: (id) => {
      const r = repairBuilding(etappe, id, { material });
      if (!r.ok) return;
      material -= r.cost;
      etappe = r.etappe;
      showStatus();
      win.update(props());
    },
    onChooseReward: (level, id) => {
      const r = chooseReward(etappe, level, id);
      if (!r.ok) return;
      etappe = r.etappe;
      win.update(props());
    },
  });

  next.addEventListener('click', () => {
    const s = advanceConstruction(etappe);
    etappe = s.etappe;
    material += etappeYield(etappe).total.material || 0;
    round++;
    showStatus();
    win.update(props());
  });

  const view = (params.get('view') || '').split(',').map(Number);
  if (view.length === 2 && view.every(Number.isFinite)) win.setView({ tilt: view[0], spin: view[1] });
  showStatus();
}
