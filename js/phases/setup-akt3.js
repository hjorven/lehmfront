// Szenario-Felder fuer Akt 3 in den Anfangszustand legen (P24). Rein: kein DOM, kein Date, kein Math.random.
//   sides[s].masks: true                       Gasmasken (ab Akt 3 Standard, wenn das Szenario Gas kennt)
//   sides[s].gas: { cylinders, shells }        Gasflaschen im Graben, Gas-Salven im Depot
//   sides[s].air: { planes } | Zahl            Flieger
//   sides[s].decoys: [{ x, y }]                Scheinbatterien, die schon stehen
//   sides[s].groups[i].gassed: true            Gruppe sitzt schon im Gas (Masken zu spaet, niedergehalten)
//   truce: { status: 'active'|'tolerated'|'offered', by: 'b', rounds? }   Waffenruhe ab Runde 1 (a3m5)
//   weather.windForecast                       erste Vorhersage, sonst der jetzige Wind mit der ueblichen Sicherheit
// Verwundete draussen (lying) und angesengte Felder kommen wie in Akt 2 ueber scenario.cells.
import { registerScenarioSetup, SIDES } from '../state.js';
import { GAS_STOCK, DECOY, WIND } from '../config/akt3.js';
import { setTruce } from '../truce.js';
import { windOf } from '../gas.js';

registerScenarioSetup('akt3', (state, map, scenario) => {
  const f = Array.isArray(scenario.features) ? scenario.features : [];
  for (const side of SIDES) {
    const s = scenario.sides?.[side];
    const st = state.sides[side];
    if (!s || !st) continue;
    if (s.masks === true || (s.masks !== false && f.includes('gas') && (scenario.act ?? 0) >= 3)) st.masks = true;
    if (s.gas) st.gas = { ...GAS_STOCK, cylinders: s.gas.cylinders | 0, shells: s.gas.shells | 0 };
    else if (f.includes('gas')) st.gas = { ...GAS_STOCK };
    if (s.air !== undefined) st.air = { planes: typeof s.air === 'number' ? s.air : s.air.planes | 0 };
    // Gruppen, die schon im Gas sitzen (a3m2): Masken zu spaet aufgesetzt, niedergehalten
    (s.groups ?? []).forEach((spec, i) => {
      if (!spec.gassed) return;
      const g = state.groups.find((x) => x.id === (spec.id ?? side + String(i + 1).padStart(2, '0')));
      if (g) { g.gasTurn = 0; g.suppressed = Math.max(g.suppressed ?? 0, 0.5); }
    });
    if (Array.isArray(s.decoys)) {
      st.decoys = s.decoys.map((d, i) => ({ id: 'attrappe' + (i + 1), pos: { x: d.x, y: d.y }, w: DECOY.size, h: DECOY.size, built: 0, hits: 0 }));
      st.decoyCount = st.decoys.length;
    }
  }
  if (scenario.truce?.status) {
    const t = scenario.truce;
    setTruce(state, {
      status: t.status, by: t.by === 'a' ? 'a' : 'b', turn: 0,
      ...(t.status === 'offered' ? {} : { until: Math.max(1, t.rounds ?? 1) }),
    });
    if (t.status !== 'offered') state.sides[t.by === 'a' ? 'a' : 'b'].truceOffered = true;
  }
  if (f.includes('gas') && !state.weather.windForecast) {
    state.weather.windForecast = { ...windOf(state), sure: scenario.weather?.windFixed || scenario.weather?.fixed ? 100 : WIND.surePosition };
  }
});
