// Etappenfenster: links das drehbare Pappmodell, rechts (Handy: unten) die Bauoptionen mit Ertragsvorschau.
//
// Schnittstelle (fuer P11):
//   const win = renderEtappe(root, { fields, buildings, selected, onSelect, onBuild });
//   win.update({ ...neue Props });  win.setView({ tilt, spin });  win.destroy();
// Pflicht: fields [{x,y,ground,height}], buildings [{id,type,x,y,remaining?,damaged?}],
//          selected {x,y}|null, onSelect(x,y), onBuild(x,y,type)
// Optional: rewards {level: id}, onChooseReward(level, id), onRepair(id), act (Standard 1), material (Zahl, sonst ungeprueft), night (bool)
//           best (hoechste erreichte Stufe), onCancel(id) fuer Gebaeude mit planned ('build'|'repair'); spotted markiert Aufgeklaertes
// Wichtig: Daten unveraenderlich uebergeben. Das Modell baut nur neu, wenn sich die Referenz von fields oder buildings aendert.
import { createModel } from './model.js';
import { createPanel } from './panel.js';
import { fieldName } from '../../etappe.js';

let cssLoaded = false;
function loadCss() {
  if (cssLoaded || document.querySelector('link[data-e3]')) { cssLoaded = true; return; }
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../../css/etappe3d.css', import.meta.url).href;
  l.dataset.e3 = '1';
  document.head.append(l);
  cssLoaded = true;
}

export function renderEtappe(root, initial) {
  loadCss();
  let props = { ...initial };
  let pick = null;

  const wrap = document.createElement('div');
  wrap.className = 'e3';
  const stage = document.createElement('div');
  stage.className = 'e3-stage';
  const aside = document.createElement('aside');
  aside.className = 'e3-panel';
  const live = document.createElement('div');
  live.className = 'e3-sr';
  live.setAttribute('aria-live', 'polite');
  wrap.append(stage, aside, live);
  root.append(wrap);

  const model = createModel(stage, {
    onTap: (x, y) => select(x, y),
    onKeyMove: (dx, dy) => {
      const s = props.selected;
      if (!s) { if (props.fields.length) select(props.fields[0].x, props.fields[0].y); return; }
      const nx = s.x + dx, ny = s.y + dy;
      if (props.fields.some((f) => f.x === nx && f.y === ny)) select(nx, ny);
    },
  });
  const panel = createPanel(aside, {
    onPick: (type) => { pick = type; renderPanel(); },
    onBuild: (x, y, type) => props.onBuild && props.onBuild(x, y, type),
    onChooseReward: (level, id) => props.onChooseReward && props.onChooseReward(level, id),
    onRepair: (id) => props.onRepair && props.onRepair(id),
    onCancel: (id) => props.onCancel && props.onCancel(id),
  });

  function select(x, y) {
    if (props.onSelect) props.onSelect(x, y);
  }

  function etappe() {
    return { fields: props.fields, buildings: props.buildings, rewards: props.rewards || {}, best: props.best || 1 };
  }

  function renderPanel() {
    const out = panel.render({ etappe: etappe(), selected: props.selected, pick, act: props.act || 1, material: props.material });
    model.setMarks(props.selected, out.highlight);
  }

  let lastFields = null, lastBuildings = null;
  function update(next) {
    const prevSel = props.selected;
    props = { ...props, ...next };
    if (!prevSel || !props.selected || prevSel.x !== props.selected.x || prevSel.y !== props.selected.y) {
      pick = null;
      if (props.selected) live.textContent = 'Feld ' + fieldName(props.selected.x, props.selected.y);
    }
    wrap.classList.toggle('night', !!props.night);
    if (props.fields !== lastFields || props.buildings !== lastBuildings) {
      model.build(props.fields, props.buildings);
      lastFields = props.fields; lastBuildings = props.buildings;
    }
    renderPanel();
  }

  update({});
  return {
    update,
    setView: (v) => model.setView(v),
    getView: () => model.getView(),
    destroy: () => { model.destroy(); wrap.remove(); },
  };
}
