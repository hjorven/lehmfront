// Demo der Papierebene (Paket Z1): alle Blattarten ueber einer Lagekarte.
// Aufruf: index.html?scene=papier
//   &nur=<art>      nur eine Blattart zeigen (letter, telegram, diary, casualties, newspaper, photo, actcard)
//   &licht=nacht    Papier wie nachts unter der Lampe (sonst folgt es dem Systemmodus)
//   &getippt=1      Telegramme beim Start tippen lassen
//   &umgedreht=<id> dieses Blatt beim Start umdrehen (z. B. demo-foto-gruppe)
// Der Systemmodus (hell/dunkel) gilt hier wie bei Briefen zwischen den Missionen (Plan 7.7).
import { createRng } from '../rng.js';
import { loadPaperStyles, createPaperLayer } from '../ui/paper/index.js';

const LABELS = {
  letter: 'Brief',
  telegram: 'Telegramm',
  diary: 'Tagebuch',
  casualties: 'Gefallene',
  newspaper: 'Zeitung',
  photo: 'Fundstück',
  actcard: 'Aktkarte',
};

export async function mount(root, params) {
  document.body.classList.add('menu'); // Systemfarben wie im Menue (Plan 7.7)
  const [, demo] = await Promise.all([
    loadPaperStyles(),
    fetch(new URL('../../data/paper/demo.json', import.meta.url)).then((r) => r.json()),
  ]);

  root.innerHTML = '';
  root.className = 'papier-demo';
  const style = document.createElement('style');
  style.textContent = CSS;
  root.append(style);

  const bar = document.createElement('header');
  bar.className = 'papier-bar';
  bar.innerHTML = `<h1>Papierebene</h1><p class="papier-hint">Bewegen kippt das Blatt. Antippen holt es nach vorn, nochmal antippen dreht Fotos um. Wegwischen legt es ab.</p>`;
  const stageWrap = document.createElement('div');
  stageWrap.className = 'papier-stage';
  const map = document.createElement('canvas');
  map.className = 'papier-map';
  map.setAttribute('aria-hidden', 'true');
  stageWrap.append(map);
  const tools = document.createElement('nav');
  tools.className = 'papier-tools';
  tools.setAttribute('aria-label', 'Blätter hinzufügen');
  root.append(bar, stageWrap, tools);

  const lightParam = params.get('licht');
  const light = lightParam === 'nacht' ? 'night' : lightParam === 'tag' ? 'day' : 'auto';
  const paper = createPaperLayer(stageWrap, {
    light,
    hooks: {
      // Hier haengt spaeter K1 den Klang ein (Tastenanschlag, Wagenruecklauf, Stempel)
      onStamp: ({ sheetId }) => stageWrap.dispatchEvent(new CustomEvent('papier-stempel', { detail: sheetId })),
    },
  });

  const only = params.get('nur');
  const typed = params.get('getippt') === '1';
  const all = demo.sheets.filter((s) => !only || s.kind === only);
  const showAll = () => all.forEach((s) => paper.add(s, { typed: typed && s.kind === 'telegram', animate: false }));

  const drawMap = () => drawBackground(map);
  drawMap();
  addEventListener('resize', drawMap);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawMap);

  showAll();
  const flipped = params.get('umgedreht');
  if (flipped) {
    paper.front(flipped);
    paper.flip(flipped);
  }

  // Werkzeugleiste: jede Blattart einzeln, ein neues getipptes Telegramm, aufraeumen
  let extra = 0;
  const btn = (label, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn papier-btn ' + cls;
    b.textContent = label;
    b.addEventListener('click', fn);
    tools.append(b);
    return b;
  };
  btn('Neues Telegramm', () => {
    const t = demo.extra[0];
    extra++;
    paper.add({ ...t, id: t.id + '-' + extra, number: `${231 + extra}/14` }, { typed: true });
  }, 'papier-btn-main');
  for (const s of demo.sheets) {
    btn(LABELS[s.kind] || s.kind, () => {
      if (paper.ids().includes(s.id)) paper.front(s.id);
      else paper.add(s);
    });
  }
  btn('Alle ablegen', () => [...paper.ids()].reverse().forEach((id) => paper.dismiss(id)));
  btn('Neu auslegen', () => {
    paper.clear();
    showAll();
  });
}

function drawBackground(canvas) {
  const dpr = devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(canvas);
  const v = (k) => cs.getPropertyValue('--' + k).trim();
  ctx.fillStyle = v('paper');
  ctx.fillRect(0, 0, w, h);
  const rng = createRng(77);
  ctx.strokeStyle = v('line');
  ctx.globalAlpha = 0.4;
  for (const [cx, cy] of [[w * 0.25, h * 0.3], [w * 0.8, h * 0.75]]) {
    for (let r = 30; r < 260; r += 30) {
      ctx.beginPath();
      for (let a = 0; a <= 48; a++) {
        const t = (a / 48) * Math.PI * 2, j = 1 + (rng() - 0.5) * 0.06;
        const x = cx + Math.cos(t) * r * 1.3 * j, y = cy + Math.sin(t) * r * 0.8 * j;
        a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }
  const crenel = (x0, color) => {
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, 0);
    for (let y = 0; y < h; y += 26) {
      const o = (y / 26) % 2 ? 9 : -9;
      ctx.lineTo(x, y + 13);
      ctx.lineTo(x + o, y + 13);
      ctx.lineTo(x + o, y + 26);
      x += o;
    }
    ctx.stroke();
  };
  crenel(w * 0.42, v('own'));
  crenel(w * 0.7, v('enemy'));
  ctx.globalAlpha = 1;
}

const CSS = `
.papier-demo{position:fixed;inset:0;display:grid;grid-template-rows:auto 1fr auto;background:var(--paper);color:var(--ink)}
.papier-bar{display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;padding:10px 16px;border-bottom:var(--border);background:var(--card);position:relative;z-index:30}
.papier-bar h1{margin:0;font:400 22px/1.1 var(--font-head)}
.papier-hint{margin:0;color:var(--ink2);font-size:13px}
.papier-stage{position:relative;overflow:hidden;min-height:0}
.papier-map{position:absolute;inset:0;width:100%;height:100%;display:block}
.papier-tools{display:flex;gap:8px;padding:10px 16px calc(10px + env(safe-area-inset-bottom));overflow-x:auto;border-top:var(--border);background:var(--card);position:relative;z-index:30;scrollbar-width:thin}
.papier-btn{flex:0 0 auto;min-height:44px;padding:8px 14px;white-space:nowrap}
.papier-btn-main{border-color:var(--ink);font-weight:700}
@media (max-width:600px){.papier-bar{padding:8px 16px}.papier-bar h1{font-size:19px}.papier-hint{font-size:12px}}
`;
