// Boeden der Etappe (Plan 3.2 und Mockup). Reine Daten.
// buildable: ob auf diesem Boden ueberhaupt Gebaeude stehen koennen.
export const GROUNDS = {
  wiese:  { label: 'Wiese',     buildable: true },
  lehm:   { label: 'Lehmboden', buildable: true },
  kreide: { label: 'Kreide',    buildable: true },
  fels:   { label: 'Fels',      buildable: true },
  dorf:   { label: 'Dorf',      buildable: true },
  wald:   { label: 'Wald',      buildable: false, why: 'Im Wald kann nicht gebaut werden' },
  sumpf:  { label: 'Sumpf',     buildable: false, why: 'Sumpf trägt kein Fundament' },
  wasser: { label: 'Wasser',    buildable: false, why: 'Auf Wasser kann nicht gebaut werden' },
};
