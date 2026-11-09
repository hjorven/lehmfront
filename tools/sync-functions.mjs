#!/usr/bin/env node
// Spiellogik fuer die Edge Functions (P20, Plan 11.3). Die Functions importieren die reinen Module des Spiels
// ueber supabase/functions/_lib/logic.ts von jsDelivr, fest auf einen Commit gepinnt; Supabase buendelt sie
// beim Deploy. So bleibt die Logik eine einzige Quelle, und der Server rechnet genau den gepinnten Stand.
//
//   node tools/sync-functions.mjs --list               # Dateien, die die Functions brauchen (nur relative Importe)
//   node tools/sync-functions.mjs --pin <commit>       # logic.ts auf einen Commit von main umstellen
//   node tools/sync-functions.mjs --mcp join           # Dateien einer Function als JSON fuer den Supabase-MCP
//
// Der Commit muss auf GitHub liegen (jsDelivr laedt von dort). Danach alle drei Functions neu deployen:
//   supabase functions deploy join resolve submit-daily --project-ref trxetnkronmurxqcrhit --no-verify-jwt
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['js/online/replay.js', 'js/online/match.js'];
const LOGIC = join(ROOT, 'supabase/functions/_lib/logic.ts');
const CDN = 'https://cdn.jsdelivr.net/gh/hjorven/lehmfront@';
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

/** Alle Dateien, die von den Einstiegen aus importiert werden (relativ zur Wurzel, sortiert) */
export function closure(entries = ENTRIES) {
  const seen = new Set();
  const todo = [...entries];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (!f.endsWith('.js')) continue;
    const src = readFileSync(join(ROOT, f), 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec.startsWith('.')) throw new Error(`${f}: nur relative Importe erlaubt (${spec})`);
      todo.push(relative(ROOT, resolve(dirname(join(ROOT, f)), spec)).split('\\').join('/'));
    }
  }
  return [...seen].sort();
}

function functionFiles(name) {
  const fnDir = join(ROOT, 'supabase/functions');
  const files = [{ name: 'index.ts', content: readFileSync(join(fnDir, name, 'index.ts'), 'utf8') }];
  for (const f of ['http.ts', 'logic.ts']) {
    files.push({ name: '../_lib/' + f, content: readFileSync(join(fnDir, '_lib', f), 'utf8') });
  }
  return files;
}

/** Gepinnter Commit aus logic.ts */
export function pinnedCommit(src = readFileSync(LOGIC, 'utf8')) {
  const pins = new Set([...src.matchAll(/lehmfront@([0-9a-f]{40})\//g)].map((m) => m[1]));
  if (pins.size !== 1) throw new Error('logic.ts: genau ein gepinnter Commit erwartet');
  return [...pins][0];
}

/** logic.ts auf einen anderen Commit umschreiben */
export function repin(src, sha) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('Commit als volle 40-stellige SHA angeben');
  return src.split(pinnedCommit(src)).join(sha);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    console.log(closure().join('\n'));
  } else if (args.includes('--mcp')) {
    const name = args[args.indexOf('--mcp') + 1];
    if (!name || !existsSync(join(ROOT, 'supabase/functions', name, 'index.ts'))) {
      console.error('Unbekannte Function: ' + name);
      process.exit(1);
    }
    console.log(JSON.stringify(functionFiles(name)));
  } else if (args.includes('--pin')) {
    const sha = args[args.indexOf('--pin') + 1] ?? '';
    writeFileSync(LOGIC, repin(readFileSync(LOGIC, 'utf8'), sha));
    console.log(`logic.ts gepinnt auf ${sha} (${CDN}${sha}/). Jetzt die Functions neu deployen.`);
  } else {
    console.log(`Gepinnter Stand: ${pinnedCommit()}`);
  }
}
