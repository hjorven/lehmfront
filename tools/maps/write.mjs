// Schreibt Karten-JSON lesbar: Zeilenfelder eine Zeile pro Reihe, Listen ein Objekt pro Zeile.
import { writeFileSync } from 'node:fs';

export function writeMapJson(file, map) {
  const lines = ['{'];
  const keys = Object.keys(map);
  keys.forEach((k, i) => {
    const v = map[k];
    const comma = i < keys.length - 1 ? ',' : '';
    if (Array.isArray(v)) {
      if (!v.length) { lines.push(`  ${JSON.stringify(k)}: []${comma}`); return; }
      lines.push(`  ${JSON.stringify(k)}: [`);
      v.forEach((e, j) => lines.push('    ' + JSON.stringify(e) + (j < v.length - 1 ? ',' : '')));
      lines.push('  ]' + comma);
    } else {
      lines.push(`  ${JSON.stringify(k)}: ${JSON.stringify(v)}${comma}`);
    }
  });
  lines.push('}');
  writeFileSync(file, lines.join('\n') + '\n');
}
