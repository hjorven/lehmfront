// Szenario-Felder fuer Akt 4 in den Anfangszustand legen (P26). Rein: kein DOM, kein Date, kein Math.random.
//   sides[s].refusal: true                    Gruppen dieser Seite verweigern Stuerme mit hohen Verlusten (a4m4)
//   sides[s].groups[i].harms: true            Feldwebel Harms fuehrt diese Gruppe (vermittelt einmal je Mission)
//   sides[s].harmsUsed: true                  Harms hat schon vermittelt (a4m4 "Harms sprechen lassen")
//   sides[s].groups[i].brandt: true           Brandt selbst als Gruppe auf der Karte (a4m4 "Selbst vorgehen")
//   sides[s].groups[i].callsign: 'K1'         Name eines Panzerwagens
//   sides[s].mine: { label, place, time, gallery, chamber, fuse, status? }   grosse Mine (a4m3)
//   day: { ceasefireAfter?, handoverAfter? }  Stunden nach Beginn: Waffenstillstand bzw. Uebergabe (a4m6)
// Fallen, Wracks und Brueckenfelder kommen wie in Akt 2 ueber scenario.cells.
import { registerScenarioSetup, SIDES } from '../state.js';
import { MINE } from '../config/akt4.js';

registerScenarioSetup('akt4', (state, map, scenario) => {
  for (const side of SIDES) {
    const s = scenario.sides?.[side];
    const st = state.sides[side];
    if (!s || !st) continue;
    if (s.refusal === true) st.refusal = true;
    (s.groups ?? []).forEach((spec, i) => {
      const id = spec.id ?? side + String(i + 1).padStart(2, '0');
      const g = state.groups.find((x) => x.id === id);
      if (!g) return;
      if (spec.harms) st.harms = { group: id, used: s.harmsUsed === true };
      if (spec.brandt) g.brandt = true;
      if (typeof spec.callsign === 'string') g.callsign = spec.callsign;
    });
    if (s.mine?.chamber) {
      const m = s.mine;
      st.mine = {
        id: m.id ?? 'mine', label: m.label ?? 'Mine', place: m.place ?? 'der Hügel', time: m.time ?? '04:10',
        gallery: (m.gallery ?? []).map((p) => ({ x: p.x, y: p.y })), chamber: { x: m.chamber.x, y: m.chamber.y },
        fuse: Math.max(1, m.fuse | 0), rounds: 0, status: m.status ?? 'ready', radius: m.radius ?? MINE.radius,
      };
    }
  }
  if (scenario.day && typeof scenario.day === 'object') {
    state.day = {
      start: { day: state.clock.day, hour: state.clock.hour },
      ...(Number.isInteger(scenario.day.ceasefireAfter) ? { ceasefireAfter: scenario.day.ceasefireAfter } : {}),
      ...(Number.isInteger(scenario.day.handoverAfter) ? { handoverAfter: scenario.day.handoverAfter } : {}),
    };
  }
});
