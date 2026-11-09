#!/usr/bin/env node
// Kopiert die reine Spiellogik, die die Edge Functions brauchen, nach supabase/functions/_shared/ (P20, Plan 11.3).
// Der Deploy buendelt nur, was unter supabase/functions/ liegt; die Kopie wird nicht eingecheckt (.gitignore).
//
//   node tools/sync-functions.mjs              # Kopie schreiben
//   node tools/sync-functions.mjs --list       # nur die Dateiliste ausgeben
//   node tools/sync-functions.mjs --mcp join   # Dateien einer Function als JSON fuer den Supabase-MCP (deploy_edge_function)
//
// Danach mit der CLI:  supabase functions deploy join resolve submit-daily --project-ref <ref>
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRIES = ['js/online/replay.js', 'js/online/match.js'];
const OUT = join(ROOT, 'supabase/functions/_shared');
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
  files.push({ name: '../_lib/http.ts', content: readFileSync(join(fnDir, '_lib/http.ts'), 'utf8') });
  for (const f of closure()) files.push({ name: '../_shared/' + f, content: readFileSync(join(ROOT, f), 'utf8') });
  return files;
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
  } else {
    rmSync(OUT, { recursive: true, force: true });
    const files = closure();
    for (const f of files) {
      const to = join(OUT, f);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, readFileSync(join(ROOT, f)));
    }
    console.log(`supabase/functions/_shared: ${files.length} Dateien kopiert`);
  }
}
