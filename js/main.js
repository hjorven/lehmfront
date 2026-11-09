// Einstieg. Bis die Spielansichten stehen: Titelbild mit gezeichneter Lagekarte im Hintergrund.
import './boot.js'; // P18: Einstellungen, Service Worker
import { createRng } from './rng.js';
import { audio, playSfx } from './audio/engine.js';
import { dayKey, dayLabel } from './modes/skirmish.js';
import { boardFor } from './modes/board.js';
import { AFTERMATH, campaignAftermath } from './aftermath.js';

export const VERSION = '1.5.0';
const FIELD_DAY_KEY = 'lehmfront.berichtigt'; // Druckvermerk auf dem Titelblatt (P21)
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// Ueberraschung P27: das Titelblatt erinnert sich an den Ausgang des Feldzugs (js/aftermath.js)
const CAMPAIGN_KEY = 'lehmfront-campaign';
function readAftermath() {
  try { return campaignAftermath(localStorage.getItem(CAMPAIGN_KEY)); } catch { return null; }
}

function drawBackground(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(document.body);
  const v = (k) => cs.getPropertyValue('--' + k).trim();
  ctx.fillStyle = v('paper');
  ctx.fillRect(0, 0, w, h);

  // Hoehenlinien wie auf der Generalstabskarte, deterministisch zittern
  const rng = createRng(214);
  ctx.strokeStyle = v('line');
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1;
  const cx = w * 0.72, cy = h * 0.42;
  for (let r = 40; r < Math.max(w, h); r += 34) {
    ctx.beginPath();
    for (let a = 0; a <= 64; a++) {
      const t = (a / 64) * Math.PI * 2;
      const j = 1 + (rng() - 0.5) * 0.05;
      const x = cx + Math.cos(t) * r * 1.4 * j, y = cy + Math.sin(t) * r * 0.8 * j;
      a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  // Eigener Graben als Rechteckwelle (blau), feindlicher (rot)
  const after = readAftermath();
  const look = after ? AFTERMATH[after.ended] : { own: 'solid', enemy: 'solid' };
  const crenel = (x0, color, how = 'solid') => {
    ctx.globalAlpha = how === 'faint' ? 0.22 : 0.55;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(how === 'dashed' ? [6, 7] : []);
    ctx.beginPath();
    let x = x0;
    ctx.moveTo(x, 0);
    for (let y = 0; y < h; y += 28) {
      const o = (y / 28) % 2 ? 10 : -10;
      ctx.lineTo(x, y + 14);
      ctx.lineTo(x + o, y + 14);
      ctx.lineTo(x + o, y + 28);
      x += o;
    }
    ctx.stroke();
  };
  crenel(w * (look.own === 'forward' ? 0.8 : 0.58), v('own'), look.own === 'forward' ? 'solid' : look.own);
  crenel(w * 0.86, v('enemy'), look.enemy);
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  if (!after) return;
  // Bleistiftvermerk neben dem eigenen Graben, leicht schief
  // Breit: rechts neben dem eigenen Graben, frei vom Menue. Schmal: oben ueber dem Titel.
  const wide = w >= 900;
  const x = wide ? w * 0.58 + 24 : 22, y = wide ? h * 0.8 : 34;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.035);
  ctx.fillStyle = v('ink2') || v('ink');
  ctx.globalAlpha = 0.85;
  ctx.textAlign = 'left';
  const size = Math.max(16, Math.min(22, w / 48));
  ctx.font = `${size}px Caveat, cursive`;
  ctx.fillText(look.note, 0, 0);
  ctx.fillText(after.fallen ? `${after.fallen} ${after.fallen === 1 ? 'Name' : 'Namen'} auf der Liste.` : 'Kein Name auf der Liste.', 0, size * 1.15);
  ctx.restore();
}

// Szenen: ?scene=<name> laedt js/scenes/<name>.js und ruft dessen mount(root, params) auf.
// Jedes Paket legt seine Demo- und Spielansichten als eigene Szene an, ohne main.js zu aendern.
const params = new URLSearchParams(location.search);
const scene = params.get('scene');

async function mountScene(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('Ungueltiger Szenenname: ' + name);
  const mod = await import(`./scenes/${name}.js`);
  document.body.classList.remove('menu');
  document.body.dataset.scene = name;
  markFieldDay();
  const root = document.createElement('div');
  root.id = 'scene';
  document.body.replaceChildren(root);
  await mod.mount(root, params);
}

if (scene) {
  mountScene(scene).catch((e) => {
    console.error(e);
    document.body.textContent = 'Szene konnte nicht geladen werden: ' + scene;
  });
} else {
  const canvas = document.getElementById('bg');
  const redraw = () => drawBackground(canvas);
  redraw();
  if (readAftermath()) document.fonts?.load('20px Caveat').then(redraw).catch(() => {});
  addEventListener('resize', redraw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  showImprint();
  menuSound();
  menuToday();
  import('./ui/menu-akte.js').then((m) => m.mountMenuAkte(params)).catch((e) => console.error(e));
}

// Klang im Hauptmenue (P17, Hinweis aus P19): ferne Front, Wind, karge Musik, sobald jemand tippt.
// Fahren die Finger ueber die Eintraege, raschelt Papier; der Knopf unten schaltet den Ton.
function menuSound() {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  audio.init();
  audio.setAmbience({ darkness: dark ? 0.85 : 0.2, wind: 0.3, rain: 0, battle: 0.06 });
  audio.startMusic();
  for (const b of document.querySelectorAll('.menu-list .btn:not([disabled])')) {
    b.addEventListener('pointerenter', () => playSfx('paper', { intensity: 0.18 }));
    b.addEventListener('click', () => playSfx('stamp', { intensity: 0.5 }));
  }
  const btn = document.getElementById('menu-sound');
  if (!btn) return;
  const show = (s) => {
    btn.textContent = !s.ready ? 'Ton: tippen zum Wecken' : s.muted ? 'Ton: aus' : 'Ton: an';
    btn.setAttribute('aria-pressed', String(s.ready && !s.muted));
  };
  audio.onChange(show);
  show(audio.init());
  btn.addEventListener('click', () => { if (audio.init().ready) audio.setMuted(!audio.isMuted()); });
}

// Ueberraschung P21: Wie auf einer echten Generalstabskarte steht unten ein Druckvermerk. "Berichtigt bis" ist der
// letzte Tag, an dem auf diesem Geraet gespielt wurde; wer lange fort war, sieht, wie alt sein Blatt geworden ist.
function markFieldDay() {
  const d = new Date();
  try { localStorage.setItem(FIELD_DAY_KEY, [d.getFullYear(), d.getMonth() + 1, d.getDate()].join('-')); } catch { /* ohne Speicher */ }
}
function showImprint() {
  const el = document.getElementById('version');
  let last = null;
  try { last = localStorage.getItem(FIELD_DAY_KEY); } catch { /* ohne Speicher */ }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(last ?? '');
  const head = `Ausgabe ${VERSION}`;
  if (!m) { el.textContent = head; return; }
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const now = new Date();
  const days = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(y, mo - 1, da)) / 86400000);
  const when = `${da}. ${MONTHS[mo - 1] ?? ''}${y !== now.getFullYear() ? ' ' + y : ''}`;
  el.textContent = `${head} · berichtigt bis ${when}`;
  if (days >= 14) el.title = `Seit ${days} Tagen nicht nachgetragen. Die Front hat nicht gewartet.`;
  el.classList.toggle('stale', days >= 14);
}

// Tageslage im Menue: heutiges Datum und der beste Eintrag im Wachbuch dieses Geraets
function menuToday() {
  const a = document.getElementById('menu-tageslage');
  if (!a) return;
  const d = new Date();
  const key = dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
  const best = boardFor(key)[0];
  a.querySelector('small').textContent = best ? `${dayLabel(key)} · bisher ${best.points}` : dayLabel(key);
}
