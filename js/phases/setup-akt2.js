// Szenario-Felder fuer Akt 2 in den Anfangszustand legen (P23). Rein: kein DOM, kein Date, kein Math.random.
//   scenario.cells: [{ x, y, ...Feldzustand }]          vorbereitete Sappen, Wasser, Krater (z. B. Sappe aus a2m1)
//   sides[s].groups[i].officer / traits / deeds         Offiziere und Veteranen
//   sides[s].tunnels: [{ group, path, dug?, status? }]  Stollen, die schon laufen (a2m2: Morrow graebt)
//   sides[s].doctrine: 'tiefe' | 'infiltration' | 'material'
import { registerScenarioSetup, SIDES } from '../state.js';
import { PLAYER_DOCTRINES } from '../config/akt2.js';

registerScenarioSetup('akt2', (state, map, scenario) => {
  for (const c of Array.isArray(scenario.cells) ? scenario.cells : []) {
    if (!Number.isInteger(c.x) || !Number.isInteger(c.y) || c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height) continue;
    const { x, y, ...patch } = c;
    const k = x + ',' + y;
    state.cells[k] = { ...(state.cells[k] ?? {}), ...structuredClone(patch) };
  }
  for (const side of SIDES) {
    const s = scenario.sides?.[side];
    if (!s) continue;
    (s.groups ?? []).forEach((spec, i) => {
      const id = spec.id ?? side + String(i + 1).padStart(2, '0');
      const g = state.groups.find((x) => x.id === id);
      if (!g) return;
      if (spec.officer) g.officer = { rank: 'Leutnant', ...structuredClone(spec.officer) };
      if (Array.isArray(spec.traits)) g.traits = [...spec.traits];
      if (spec.deeds) g.deeds = { ...spec.deeds };
    });
    if (Array.isArray(s.tunnels) && s.tunnels.length) {
      state.sides[side].tunnels = s.tunnels.map((t, i) => ({
        id: side + 't' + (i + 1), group: t.group, path: t.path.map((p) => ({ x: p.x, y: p.y })),
        dug: Math.max(0, Math.min(t.path.length, t.dug ?? 0)), work: 0, status: t.status ?? 'digging', turn: 0,
        ...(t.status === 'charged' ? { chargedTurn: 0 } : {}),
      }));
    }
    if (s.doctrine && PLAYER_DOCTRINES[s.doctrine]) state.sides[side].doctrine = s.doctrine;
  }
});
