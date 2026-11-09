// Start jeder Seite (P18): Einstellungen anwenden, Service Worker anmelden, Hinweis auf neue Feldausgabe.
// main.js importiert diese Datei zuerst; Szenen muessen nichts dafuer tun.
import './render/text-fix.js'; // kleine Schrift auf der skalierten Karte (Chrome)
import { applySettings } from './settings.js';
import { ensureCss, esc } from './ui/dom.js';

applySettings();
ensureCss('css/einstellungen.css');

/** Kleiner Fernschreiberstreifen oben: neue Ausgabe liegt bereit */
function showUpdate(worker) {
  if (document.querySelector('.update-note')) return;
  const el = document.createElement('section');
  el.className = 'card update-note';
  el.setAttribute('role', 'status');
  el.innerHTML = `<p>${esc('Neue Feldausgabe eingetroffen STOP')}</p>
    <button type="button" class="btn">Neu laden</button>
    <button type="button" class="x" aria-label="Hinweis schließen">×</button>`;
  el.querySelector('.btn').addEventListener('click', () => {
    worker.postMessage({ type: 'skip-waiting' });
  });
  el.querySelector('.x').addEventListener('click', () => el.remove());
  document.body.append(el);
}

function registerWorker() {
  const sw = navigator.serviceWorker;
  if (!sw || !window.isSecureContext || new URLSearchParams(location.search).has('nosw')) return;
  // Relativ: Pages liegt unter /lehmfront/, lokal unter /
  sw.register('sw.js').then((reg) => {
    const watch = (w) => {
      if (!w) return;
      w.addEventListener('statechange', () => {
        // Nur wenn schon ein alter Worker die Seite haelt, ist es ein Update (sonst Erstinstallation)
        if (w.state === 'installed' && sw.controller) showUpdate(w);
      });
    };
    if (reg.waiting && sw.controller) showUpdate(reg.waiting);
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
  }).catch((e) => console.warn('Offline-Modus nicht verfuegbar:', e.message));
  // Erstinstallation uebernimmt die Seite still (clients.claim); neu geladen wird nur nach einem Update
  const hadController = !!sw.controller;
  let reloading = false;
  sw.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

registerWorker();
