// Wachposten fuer Plan 10.7: reine Spiellogik ohne Zufall von aussen, Uhrzeit, DOM oder transzendente Mathematik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../js/', import.meta.url);
const files = ['rules.js', 'resolve.js', 'state.js', 'orders.js', 'view.js', 'events.js', 'map.js', 'supply.js', 'artillery.js', 'etappe.js', 'sight.js', 'weather.js', 'ui/daytime.js', 'film.js', 'archive.js', 'trench.js', 'morale.js', 'audio/cues.js', 'letters.js', 'ai.js', 'ai/match.js', 'ai/notes.js', 'config/doctrines.js', 'mapgen.js', 'placenames.js', 'modes/skirmish.js', 'modes/endless.js', 'config/seasons.js', 'config/battlemaps.js', 'campaign.js', 'config/reports.js', 'missions/goals.js', 'missions/script.js', 'missions/akt1.js', 'missions/run.js', 'underground.js', 'veterans.js', 'modifiers.js', 'harm.js', 'ai/blocks.js', 'ai/akt2.js', 'ai/mission-match.js', 'config/akt2.js', 'config/missions-akt2.js']
  .filter((f) => existsSync(new URL(f, root)))
  .concat(readdirSync(new URL('phases/', root)).filter((f) => f.endsWith('.js')).map((f) => 'phases/' + f))
  .concat(readdirSync(new URL('narrative/', root)).filter((f) => f.endsWith('.js')).map((f) => 'narrative/' + f));

const FORBIDDEN = [
  [/Math\.random/, 'Math.random'],
  [/\bDate\b/, 'Date'],
  [/\bperformance\.now/, 'performance.now'],
  [/Math\.(sin|cos|tan|exp|log|atan2?|asin|acos|pow|cbrt|hypot)\b/, 'transzendente Funktion'],
  [/\*\*\s*0?\.\d/, 'Bruchexponent'],
  [/\b(document|window|localStorage|indexedDB)\b/, 'DOM/Browser-Speicher'],
  [/localeCompare/, 'localeCompare (geraeteabhaengig)'],
];

for (const f of files) {
  test(`rein: js/${f}`, () => {
    const src = readFileSync(new URL(f, root), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [re, what] of FORBIDDEN) assert.ok(!re.test(src), `${what} in js/${f}`);
  });
}
