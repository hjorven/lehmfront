// Tonpult: Demo-Szene fuer die Klang-Engine (Paket K1). Aufruf: index.html?scene=klang
// Knoepfe fuer jeden Klang, Regler fuer Tageszeit und Wetter, Mischpult, Musik.
// Oben ein Schreibstreifen wie bei einem Seismographen: er zeichnet mit, was die Engine ausgibt.
import { audio } from '../audio/engine.js';
import { CATALOG } from '../audio/sounds.js';

const AMB = [
  { key: 'darkness', label: 'Tageszeit', fmt: (v) => (v < 0.3 ? 'Tag' : v < 0.7 ? 'Dämmerung' : 'Nacht') },
  { key: 'rain', label: 'Regen', fmt: (v) => (v < 0.05 ? 'trocken' : v < 0.5 ? 'Niesel' : 'Guss') },
  { key: 'wind', label: 'Wind', fmt: (v) => (v < 0.05 ? 'still' : v < 0.5 ? 'Brise' : 'Sturm') },
  { key: 'battle', label: 'Gefecht', fmt: (v) => (v < 0.05 ? 'Ruhe' : v < 0.5 ? 'Störfeuer' : 'Trommelfeuer') },
];
const BUS_LABEL = { master: 'Gesamt', music: 'Musik', sfx: 'Effekte', ambience: 'Umgebung' };
const pct = (v) => Math.round(v * 100) + ' %';

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  e.append(...kids);
  return e;
}

function slider(id, label, value, fmt, onInput) {
  const out = el('output', { for: id }, fmt(value));
  const input = el('input', { type: 'range', id, min: '0', max: '1', step: '0.01', value: String(value), 'aria-valuetext': fmt(value) });
  input.addEventListener('input', () => {
    const v = Number(input.value);
    out.textContent = fmt(v);
    input.setAttribute('aria-valuetext', fmt(v));
    onInput(v);
  });
  return el('div', { class: 'tp-row' }, el('label', { for: id }, label), input, out);
}

function toggle(label, pressed, onClick) {
  const b = el('button', { class: 'tp-toggle', type: 'button', 'aria-pressed': String(pressed) }, label);
  b.addEventListener('click', () => onClick(b));
  return b;
}

export function mount(root, params) {
  // Das Tonpult ist ein Menue: Systemmodus hell/dunkel gilt (Plan 7.1)
  document.body.classList.add('menu');
  if (!document.querySelector('link[href="css/klang.css"]')) {
    document.head.append(el('link', { rel: 'stylesheet', href: 'css/klang.css' }));
  }
  audio.init();

  const amb = {};
  for (const a of AMB) amb[a.key] = Math.min(1, Math.max(0, Number(params.get(a.key === 'darkness' ? 'night' : a.key)) || 0));
  const fx = { pan: 0, intensity: 0.7 };

  // Nur der Zustand ist Live-Region, die Stimmenzahl wechselt zu oft fuer Bildschirmleser
  const lampText = el('span', { role: 'status' }, '');
  const voiceText = el('span', { 'aria-hidden': 'true' }, '');
  const status = el('div', { class: 'tp-status' }, el('span', { class: 'lamp', 'aria-hidden': 'true' }), lampText, voiceText);
  const seismo = el('canvas', { class: 'seismo', 'aria-hidden': 'true' });

  // Klaenge, gruppiert
  const sounds = el('section', { class: 'tp-card' }, el('h2', {}, 'Klänge', el('small', {}, CATALOG.length + ' prozedural')));
  let group = null;
  let grid = null;
  for (const c of CATALOG) {
    if (c.group !== group) {
      group = c.group;
      grid = el('div', { class: 'tp-grid' });
      sounds.append(el('div', { class: 'tp-group' }, group), grid);
    }
    const b = el('button', { class: 'tp-btn', type: 'button', 'data-sound': c.name }, c.label);
    b.addEventListener('click', () => {
      audio.unlock();
      if (audio.playSfx(c.name, { ...c.opts, pan: fx.pan, intensity: fx.intensity })) {
        b.classList.add('played');
        setTimeout(() => b.classList.remove('played'), 300);
      }
    });
    grid.append(b);
  }
  sounds.append(
    slider('fx-pan', 'Richtung', fx.pan * 0.5 + 0.5, (v) => (v < 0.4 ? 'links' : v > 0.6 ? 'rechts' : 'Mitte'), (v) => { fx.pan = v * 2 - 1; }),
    slider('fx-int', 'Stärke', fx.intensity, pct, (v) => { fx.intensity = v; }),
  );

  // Umgebung
  const ambOn = toggle('Umgebung an', false, (b) => {
    audio.unlock();
    const on = b.getAttribute('aria-pressed') !== 'true';
    if (on) audio.setAmbience({ ...amb }); else audio.stopAmbience();
  });
  const musicOn = toggle('Musik an', false, (b) => {
    audio.unlock();
    const on = b.getAttribute('aria-pressed') !== 'true';
    if (on) audio.startMusic(); else audio.stopMusic();
  });
  const ambience = el('section', { class: 'tp-card' }, el('h2', {}, 'Umgebung', el('small', {}, 'weich überblendet')));
  for (const a of AMB) {
    ambience.append(slider('amb-' + a.key, a.label, amb[a.key], a.fmt, (v) => {
      amb[a.key] = v;
      if (audio.state().ambience) audio.setAmbience({ [a.key]: v });
      else if (a.key === 'battle') audio.setMusicBattle(v);
    }));
  }
  ambience.append(el('div', { class: 'tp-toggles' }, ambOn, musicOn),
    el('p', { class: 'tp-note' }, 'Unter Beschuss verstummt die Musik und kommt erst zögernd wieder.'));

  // Mischpult
  const mixer = el('section', { class: 'tp-card' }, el('h2', {}, 'Mischpult'));
  for (const bus of ['master', 'music', 'sfx', 'ambience']) {
    mixer.append(slider('vol-' + bus, BUS_LABEL[bus], audio.getVolume(bus), pct, (v) => audio.setVolume(bus, v)));
  }
  const mute = toggle('Stumm', audio.isMuted(), () => { audio.unlock(); audio.setMuted(!audio.isMuted()); });
  const deaf = toggle('Taubheit nach nahem Einschlag', audio.state().options.shellshock, () => {
    audio.setOption('shellshock', !audio.state().options.shellshock);
  });
  mixer.append(el('div', { class: 'tp-toggles' }, mute, deaf));

  root.append(el('div', { class: 'tonpult' },
    el('header', {}, el('h1', {}, 'Tonpult'), el('p', {}, 'Jeder Klang entsteht im Moment, nichts ist aufgenommen.')),
    status, seismo, sounds, el('div', { class: 'tp-two' }, ambience, mixer)));

  const sync = (s) => {
    status.dataset.ready = s.ready ? '1' : '0';
    const lamp = s.ready ? (s.muted ? 'Klang läuft, stumm' : 'Klang läuft') : 'Klang schläft. Das erste Tippen weckt ihn.';
    if (lampText.textContent !== lamp) lampText.textContent = lamp;
    const vt = s.ready ? `· ${s.voices} ${s.voices === 1 ? 'Stimme' : 'Stimmen'}` : '';
    if (voiceText.textContent !== vt) voiceText.textContent = vt;
    ambOn.setAttribute('aria-pressed', String(s.ambience));
    musicOn.setAttribute('aria-pressed', String(s.music));
    mute.setAttribute('aria-pressed', String(s.muted));
    deaf.setAttribute('aria-pressed', String(s.options.shellshock));
  };
  audio.onChange(sync);
  sync(audio.state());
  setInterval(() => sync(audio.state()), 500);

  drawSeismo(seismo);
}

// Schreibstreifen: Bleistift auf Papier, laeuft nach links weg. Ohne Klang eine ruhige Grundlinie.
function drawSeismo(canvas) {
  const ctx = canvas.getContext('2d');
  const hist = new Float32Array(240);
  let data = null;
  let pos = 0;
  const frame = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cs = getComputedStyle(canvas);
    const v = (k) => cs.getPropertyValue('--' + k).trim();
    ctx.fillStyle = v('paper');
    ctx.fillRect(0, 0, w, h);
    // Raster wie Millimeterpapier
    ctx.strokeStyle = v('track');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = (w - (pos % 24) * (w / hist.length)) % 24; x < w; x += 24) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = h / 4; y < h; y += h / 4) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();

    const an = audio.analyser;
    let level = 0;
    if (an) {
      if (!data || data.length !== an.fftSize) data = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      level = Math.sqrt(sum / data.length);
    }
    pos++;
    hist.copyWithin(0, 1);
    // Ausschlag abwechselnd nach oben und unten, wie eine Nadel, die zittert
    hist[hist.length - 1] = Math.min(1, level * 4) * (pos % 2 ? 1 : -1);
    ctx.strokeStyle = v('ink');
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i < hist.length; i++) {
      const x = (i / (hist.length - 1)) * w;
      const y = h / 2 + hist[i] * (h / 2 - 6);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    requestAnimationFrame(frame);
  };
  frame();
}
