// Klang-Einstellungen im Spiel (P19): Knopf mit Klappkarte (Desktop) und Karte in der Seitenleiste (Handy).
// Dieselben Regler kann spaeter das Einstellungsmenue (P18) mit soundPanel() einbauen.
import { audio } from '../audio/engine.js';
import { esc, ensureCss } from './dom.js';

const BUSES = [
  ['master', 'Gesamt'],
  ['sfx', 'Geräusche'],
  ['ambience', 'Front und Wetter'],
  ['music', 'Musik'],
];

const pct = (v) => `${Math.round(v * 100)} %`;

function stateWord(s) {
  if (!s.ready) return 'schläft';
  return s.muted ? 'aus' : 'an';
}

/** Regler-Block als Element. Bleibt mit der Engine im Gleichlauf (auch wenn andere Stellen etwas aendern). */
export function soundPanel({ idPrefix = 'snd' } = {}) {
  ensureCss('css/sound.css');
  const el = document.createElement('div');
  el.className = 'snd-panel';
  el.innerHTML = `
    <p class="snd-state" aria-live="polite"></p>
    ${BUSES.map(([bus, label]) => `
      <label class="snd-row" for="${idPrefix}-${bus}"><span>${esc(label)}</span><output></output>
        <input id="${idPrefix}-${bus}" type="range" min="0" max="100" step="5" data-bus="${bus}"></label>`).join('')}
    <div class="snd-toggles">
      <button type="button" class="btn snd-mute" aria-pressed="false">Stumm</button>
      <button type="button" class="btn snd-deaf" aria-pressed="true" title="Nach einem nahen Einschlag kurz dumpf hören">Taubheit</button>
    </div>`;
  const sync = (s) => {
    el.querySelector('.snd-state').textContent = s.ready
      ? (s.muted ? 'Klang ist stumm geschaltet.' : 'Klang läuft.')
      : 'Klang schläft. Das erste Tippen weckt ihn.';
    for (const input of el.querySelectorAll('input[data-bus]')) {
      const v = s.volumes[input.dataset.bus];
      if (document.activeElement !== input) input.value = String(Math.round(v * 100));
      input.closest('.snd-row').querySelector('output').textContent = pct(v);
      input.setAttribute('aria-valuetext', pct(v));
    }
    const mute = el.querySelector('.snd-mute');
    mute.setAttribute('aria-pressed', String(s.muted));
    el.querySelector('.snd-deaf').setAttribute('aria-pressed', String(s.options.shellshock));
  };
  el.addEventListener('input', (e) => {
    const bus = e.target.dataset?.bus;
    if (bus) audio.setVolume(bus, Number(e.target.value) / 100);
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('.snd-mute')) { audio.unlock(); audio.setMuted(!audio.isMuted()); }
    else if (e.target.closest('.snd-deaf')) audio.setOption('shellshock', !audio.state().options.shellshock);
  });
  const off = audio.onChange(sync);
  sync(audio.state());
  return { el, sync: () => sync(audio.state()), destroy: () => { off(); el.remove(); } };
}

/**
 * Klang-Knopf mit Klappkarte (fuer die rechte Leiste) und, falls sheet angegeben, eine Karte fuer die
 * Seitenleiste auf dem Handy. Liefert { button, pop, card, close }.
 */
export function mountSoundControls({ bar, sheet = null }) {
  ensureCss('css/sound.css');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn snd-btn';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'true');
  const pop = document.createElement('div');
  pop.className = 'card snd-pop';
  pop.hidden = true;
  pop.setAttribute('role', 'group');
  pop.setAttribute('aria-label', 'Klang');
  const panel = soundPanel({ idPrefix: 'snd-pop' });
  pop.append(panel.el);
  bar.append(button, pop);

  let card = null;
  let sheetPanel = null;
  if (sheet) {
    card = document.createElement('section');
    card.className = 'card snd-card';
    card.setAttribute('aria-label', 'Klang');
    card.innerHTML = '<span class="k">Klang</span>';
    sheetPanel = soundPanel({ idPrefix: 'snd-sheet' });
    card.append(sheetPanel.el);
    sheet.append(card);
  }

  // Nur den Text tauschen: ein neu gebautes Kind wuerde mitten im Tippen (das den Klang weckt) den Klick verlieren
  button.innerHTML = 'Ton <small></small>';
  const word = button.querySelector('small');
  const label = (s) => { word.textContent = stateWord(s); };
  const offLabel = audio.onChange(label);
  label(audio.state());

  function close() {
    if (pop.hidden) return;
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  }
  button.addEventListener('click', () => {
    audio.unlock();
    pop.hidden = !pop.hidden;
    button.setAttribute('aria-expanded', String(!pop.hidden));
    if (!pop.hidden) pop.querySelector('input')?.focus({ preventScroll: true });
  });
  const outside = (e) => {
    if (!pop.hidden && !pop.contains(e.target) && !button.contains(e.target)) close();
  };
  document.addEventListener('pointerdown', outside, true);
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); button.focus(); }
  });
  function destroy() {
    offLabel(); panel.destroy(); sheetPanel?.destroy();
    document.removeEventListener('pointerdown', outside, true);
    button.remove(); pop.remove(); card?.remove();
  }
  return { button, pop, card, close, destroy };
}
