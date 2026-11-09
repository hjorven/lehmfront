// Verbindung zum Online-Dienst (P20, Supabase). Nur die oeffentliche URL und der anon/publishable Key gehoeren
// hierher, nie der Service-Role-Key. Leer = Online-Modus aus (Fernsprechamt zeigt "Leitung nicht geschaltet").
// Zum Ausprobieren mit einem eigenen Projekt ohne Commit: im Browser
//   localStorage.setItem('lehmfront.online', JSON.stringify({ url: 'https://<ref>.supabase.co', key: 'sb_publishable_...' }))
// Abschalten fuer eine Seite: ?online=aus
export const ONLINE = {
  url: '',
  key: '',
};

/** Datei der Bibliothek unter vendor/ (UMD, setzt window.supabase) */
export const SUPABASE_UMD = 'vendor/supabase-2.118.0.js';
