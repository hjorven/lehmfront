// Ortsangaben fuer Briefe ({ort}, "an der Velder Mühle") aus einem Kartenfeld. Rein, ohne DOM.
// Soldaten schreiben keine Feldnummern nach Hause: genommen wird der naechste benannte Ort der Karte
// (Beschriftung oder Gebaeude), sonst die Zone (vorn im Graben, draussen auf der Weide, hinten in der Etappe).

/** Praepositionen fuer bekannte Ortsnamen; unbekannte Namen bekommen "bei" */
const PREP = {
  'Hügel 214': 'am Hügel 214',
  Kalkhof: 'beim Kalkhof',
  Velde: 'in Velde',
  'Velder Mühle': 'an der Velder Mühle',
  Krähenholz: 'am Krähenholz',
  Lehmkuhle: 'an der Lehmkuhle',
  Ostervenn: 'in Ostervenn',
  'Schacht Drei': 'am Schacht Drei',
  Raudas: 'vor Raudas',
  Asse: 'an der Asse',
  Depot: 'am Depot',
  Feldbahnhof: 'am Feldbahnhof',
  Feldküche: 'bei der Feldküche',
  Ruhelager: 'im Ruhelager',
  Lazarett: 'beim Lazarett',
  Fernmeldestelle: 'bei der Fernmeldestelle',
  Werkstatt: 'bei der Werkstatt',
};

/** Ortsnamen, die nach Militaer klingen: die Pruefstelle schwaerzt sie in der Feldpost */
const SENSITIVE = /^(Hügel \d+|Batterie|Abschnitt|Schacht|Depot|Feldbahnhof|Fernmelde)/;

const ZONE_PHRASE = {
  E: 'hinten in der Etappe',
  S: 'vorn im Graben',
  N: 'draußen auf der Weide',
  s: 'drüben im Graben',
  e: 'weit drüben',
};

function namedPlaces(map) {
  const out = [];
  for (const l of map?.labels ?? []) {
    if (!l.text || /^[A-ZÄÖÜ ]+$/.test(l.text) || /^Abschnitt|×/.test(l.text)) continue; // Grossbeschriftungen und Hinweise nicht
    out.push({ name: l.text, x: l.x, y: l.y });
  }
  for (const b of map?.buildings ?? []) if (b.label) out.push({ name: b.label, x: b.x + (b.w ?? 1) / 2, y: b.y + (b.h ?? 1) / 2 });
  return out;
}

/**
 * Ortsangabe mit Praeposition, klein. Liefert { text, name, sensitive }.
 * maxDist: Felder, bis zu denen ein benannter Ort gilt.
 */
export function placePhrase(map, at, { maxDist = 6 } = {}) {
  if (!at) return { text: 'hier vorn', name: null, sensitive: false };
  let best = null;
  let bestD = Infinity;
  for (const p of namedPlaces(map)) {
    const dx = p.x - at.x, dy = p.y - at.y;
    const d = dx * dx + dy * dy;
    if (d < bestD || (d === bestD && best && p.name < best.name)) {
      best = p;
      bestD = d;
    }
  }
  if (best && bestD <= maxDist * maxDist) {
    return { text: PREP[best.name] ?? 'bei ' + best.name, name: best.name, sensitive: SENSITIVE.test(best.name) };
  }
  const zone = map?.zones?.[at.y]?.[at.x];
  return { text: ZONE_PHRASE[zone] ?? 'hier vorn', name: null, sensitive: false };
}
