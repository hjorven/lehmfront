// Ueberraschung P27 (rein, ohne DOM): Das Titelblatt erinnert sich, wie der Feldzug ausgegangen ist. Die Graeben im Hintergrund
// stehen danach so, wie die Front am letzten Tag stand, und am Rand steht ein Bleistiftvermerk.
export const AFTERMATH = {
  haelt: { own: 'solid', enemy: 'solid', note: 'Gehalten. Bis zum letzten Tag.' },
  waffenstillstand: { own: 'faint', enemy: 'faint', note: 'Vierzehn Uhr. Dann war es still.' },
  durchbruch: { own: 'forward', enemy: 'dashed', note: 'Die zweite Linie. Was sie gekostet hat, steht darunter.' },
  abgeloest: { own: 'dashed', enemy: 'solid', note: 'Abgelöst. Andere halten jetzt den Graben.' },
  vorzeitig_abgeloest: { own: 'dashed', enemy: 'solid', note: 'Vom Kommando entbunden. Der Graben blieb.' },
  vorzeitig_meuterei: { own: 'dashed', enemy: 'solid', note: 'Die Truppe ist nicht mehr gegangen.' },
};
/** Ausgang des Feldzugs auf diesem Geraet: { ended, fallen } oder null */
export function campaignAftermath(raw) {
  try {
    const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!c || !Object.hasOwn(AFTERMATH, c.ended)) return null;
    return { ended: c.ended, fallen: Array.isArray(c.book?.fallen) ? c.book.fallen.length : 0 };
  } catch { return null; }
}
