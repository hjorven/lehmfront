// Befehlsarten (Plan 3.3). Reine Daten; die Pruefung steht in js/orders.js.
// kind: in welcher Rundenart der Befehl erlaubt ist.
// target: 'cell' = braucht ein Zielfeld {x,y}; 'path' = braucht einen Weg [{x,y},...]; null = kein Ziel.
// night: nur nachts erlaubt.

export const ORDER_TYPES = {
  hold:        { id: 'hold',        label: 'Halten',          kind: 'both',     target: null },

  dig:         { id: 'dig',         label: 'Graben',          kind: 'position', target: 'path' },
  build:       { id: 'build',       label: 'Bauen',           kind: 'position', target: 'cell' },
  rebuild:     { id: 'rebuild',     label: 'Umbauen',         kind: 'position', target: 'path' },
  wire:        { id: 'wire',        label: 'Draht',           kind: 'position', target: 'path' },
  relieve:     { id: 'relieve',     label: 'Ablösen',         kind: 'position', target: null },
  supply_plan: { id: 'supply_plan', label: 'Lorenplan',       kind: 'position', target: null },
  fire_plan:   { id: 'fire_plan',   label: 'Feuerplan',       kind: 'position', target: null },
  harass:      { id: 'harass',      label: 'Störfeuer',       kind: 'position', target: 'cell' },
  tunnel:      { id: 'tunnel',      label: 'Stollen',         kind: 'position', target: 'path' },
  raid:        { id: 'raid',        label: 'Stoßtrupp',       kind: 'position', target: 'cell', night: true },
  observe:     { id: 'observe',     label: 'Beobachten',      kind: 'position', target: 'cell' },
  redeploy:    { id: 'redeploy',    label: 'Verlegen',        kind: 'position', target: 'path' },
  sector:      { id: 'sector',      label: 'Feuersektor',     kind: 'both',     target: 'cell' },

  move:        { id: 'move',        label: 'Bewegen',         kind: 'battle',   target: 'path' },
  fire:        { id: 'fire',        label: 'Feuern',          kind: 'battle',   target: 'cell' },
  dugout:      { id: 'dugout',      label: 'Deckung',         kind: 'battle',   target: null },
  assault:     { id: 'assault',     label: 'Sturm',           kind: 'battle',   target: 'path' },
  shift_fire:  { id: 'shift_fire',  label: 'Feuer verlegen',  kind: 'battle',   target: 'cell' },
  cease_fire:  { id: 'cease_fire',  label: 'Feuer einstellen', kind: 'battle',  target: null },
};
