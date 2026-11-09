// Bausteine fuer den KI-Kommandanten (P23). Neue Mechaniken (Stollen, Stosstrupp, Sappe ...) melden hier eigene
// Entscheidungen an, statt decide() in js/ai.js umzuschreiben. Rein: kein DOM, kein Date, kein Math.random.
//
// registerAiBlock({ id, order?, run(b) }): laeuft vor den Grundregeln der KI, damit ein Baustein seine Gruppen
// zuerst bekommt. b = { view, map, side, sit, kind, isNight, doc, diff, rng, memory, opts, give, taken, outside }
//   give(group, order, reason, tag) prueft den Befehl und vergibt die Gruppe (false, wenn ungueltig oder vergeben).
const blocks = new Map();

export function registerAiBlock(block) {
  if (!block?.id || typeof block.run !== 'function') throw new Error('KI-Baustein braucht id und run(b)');
  blocks.set(block.id, { order: 100, ...block });
}

export function unregisterAiBlock(id) {
  blocks.delete(id);
}

export function runAiBlocks(b) {
  const list = [...blocks.values()].sort((p, q) => p.order - q.order || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  for (const blk of list) blk.run(b);
}
