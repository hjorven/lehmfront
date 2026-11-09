// Befehlsarten (Plan 3.3). Reine Daten; die Pruefung steht in js/orders.js.
// kind: in welcher Rundenart der Befehl erlaubt ist.
// target: 'cell' = braucht ein Zielfeld {x,y}; 'path' = braucht einen Weg [{x,y},...]; null = kein Ziel.
// night: nur nachts erlaubt.
// scope: 'side' = Befehl der ganzen Seite ohne Gruppe (Lorenplan). Hoechstens einer je Art und Seite;
//   die Phase liest ihn mit ctx.planOf(side, type).

export const ORDER_TYPES = {
  hold:        { id: 'hold',        label: 'Halten',          kind: 'both',     target: null },

  dig:         { id: 'dig',         label: 'Graben',          kind: 'position', target: 'path' },
  build:       { id: 'build',       label: 'Bauen',           kind: 'position', target: 'cell' },
  rebuild:     { id: 'rebuild',     label: 'Umbauen',         kind: 'position', target: 'path' },
  wire:        { id: 'wire',        label: 'Draht',           kind: 'position', target: 'path' },
  relieve:     { id: 'relieve',     label: 'Ablösen',         kind: 'position', target: null },
  refill:      { id: 'refill',      label: 'Auffüllen',       kind: 'position', target: null },
  supply_plan: { id: 'supply_plan', label: 'Lorenplan',       kind: 'position', target: null, scope: 'side' },
  etappe:      { id: 'etappe',      label: 'Etappe',          kind: 'position', target: null, scope: 'side' },
  fire_plan:   { id: 'fire_plan',   label: 'Feuerplan',       kind: 'position', target: null, scope: 'side' },
  harass:      { id: 'harass',      label: 'Störfeuer',       kind: 'position', target: 'cell' },
  sap:         { id: 'sap',         label: 'Sappe',           kind: 'position', target: 'path' },
  tunnel:      { id: 'tunnel',      label: 'Stollen',         kind: 'position', target: 'path' },
  raid:        { id: 'raid',        label: 'Stoßtrupp',       kind: 'position', target: 'cell', night: true },
  attack:      { id: 'attack',      label: 'Angriff ansetzen', kind: 'position', target: 'path' },
  observe:     { id: 'observe',     label: 'Beobachten',      kind: 'position', target: 'cell' },
  redeploy:    { id: 'redeploy',    label: 'Verlegen',        kind: 'position', target: 'path' },
  sector:      { id: 'sector',      label: 'Feuersektor',     kind: 'both',     target: 'cell' },
  drain:       { id: 'drain',       label: 'Entwässern',      kind: 'position', target: 'cell' },
  flare:       { id: 'flare',       label: 'Leuchtkugel',     kind: 'both',     target: 'cell', night: true },
  // P24 (Akt 3): Gas, Flieger, Scheinbatterien und Tarnnetze, Waffenruhe, Bergen draussen
  gas:         { id: 'gas',         label: 'Gas abblasen',    kind: 'position', target: null },
  gas_shell:   { id: 'gas_shell',   label: 'Gasgranaten',     kind: 'position', target: null, scope: 'side' },
  recon:       { id: 'recon',       label: 'Flieger',         kind: 'position', target: null, scope: 'side' },
  decoy:       { id: 'decoy',       label: 'Tarnen',          kind: 'position', target: null, scope: 'side' },
  truce:       { id: 'truce',       label: 'Waffenruhe',      kind: 'position', target: null, scope: 'side' },
  recover:     { id: 'recover',     label: 'Bergen',          kind: 'position', target: 'cell' },
  // P26 (Akt 4): Pionierbruecke ueber Wasser, mit Feldbahngleis darauf
  bridge:      { id: 'bridge',      label: 'Brücke bauen',    kind: 'position', target: 'path' },

  move:        { id: 'move',        label: 'Bewegen',         kind: 'battle',   target: 'path' },
  fire:        { id: 'fire',        label: 'Feuern',          kind: 'battle',   target: 'cell' },
  dugout:      { id: 'dugout',      label: 'Deckung',         kind: 'battle',   target: null },
  assault:     { id: 'assault',     label: 'Sturm',           kind: 'battle',   target: 'path' },
  shift_fire:  { id: 'shift_fire',  label: 'Feuer verlegen',  kind: 'battle',   target: 'cell' },
  cease_fire:  { id: 'cease_fire',  label: 'Feuer einstellen', kind: 'battle',  target: null },
  flame:       { id: 'flame',       label: 'Flammenstoß',     kind: 'battle',   target: 'cell' },
};
