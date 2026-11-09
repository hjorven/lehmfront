// Schreibt die Dateiliste des Service Workers (sw.js zwischen precache:start und precache:end).
// Aufruf nach jedem neuen oder entfernten Spiel-File: node tools/precache.mjs
// Mit --check nur pruefen (Exit 1, wenn die Liste veraltet ist).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const DIRS = ['css', 'js', 'data', 'assets', 'vendor'];
const TOP = ['index.html', 'manifest.webmanifest'];
const EXT = /\.(js|css|json|woff2|png|svg|webp|jpg|html|webmanifest|ogg|mp3)$/;

function walk(dir, out) {
  let names;
  try { names = readdirSync(dir); } catch { return out; }
  for (const n of names.sort()) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.test(n)) out.push(relative(ROOT, p).split('\\').join('/'));
  }
  return out;
}

/** Alle Dateien, die offline gebraucht werden, sortiert */
export function precacheFiles() {
  const files = TOP.filter((f) => { try { return statSync(join(ROOT, f)).isFile(); } catch { return false; } });
  for (const d of DIRS) walk(join(ROOT, d), files);
  return [...new Set(files)].sort();
}

/** FNV-1a ueber die Liste */
export function listVersion(files) {
  let h = 0x811c9dc5;
  const s = files.join('\n');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function renderBlock(files) {
  return `// precache:start\nconst VERSION = '${listVersion(files)}';\nconst FILES = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];\n// precache:end`;
}

const RE = /\/\/ precache:start[\s\S]*?\/\/ precache:end/;

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const swPath = join(ROOT, 'sw.js');
  const src = readFileSync(swPath, 'utf8');
  const next = src.replace(RE, renderBlock(precacheFiles()));
  if (process.argv.includes('--check')) {
    if (next !== src) { console.error('sw.js: Dateiliste veraltet. Bitte `node tools/precache.mjs` ausfuehren.'); process.exit(1); }
    console.log('sw.js: Dateiliste aktuell');
  } else {
    writeFileSync(swPath, next);
    console.log(`sw.js: ${precacheFiles().length} Dateien, Version ${listVersion(precacheFiles())}`);
  }
}
