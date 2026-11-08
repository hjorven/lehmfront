// Ereignisprotokoll (Plan 10.6). Jedes Ereignis traegt phase, type, reason (deutsch) und at {x,y}.
// Rein: kein DOM, kein Date, kein Math.random.

const REQUIRED = ['phase', 'type', 'reason', 'at'];

/**
 * Ereignis anlegen und pruefen. Wirft bei fehlenden Pflichtfeldern, damit Luecken sofort im Test auffallen.
 * Weitere Felder (group, side, amount, from, cause, ...) werden unveraendert uebernommen.
 */
export function makeEvent(fields) {
  for (const k of REQUIRED) {
    if (fields[k] === undefined || fields[k] === null || fields[k] === '') {
      throw new Error(`Ereignis ohne Pflichtfeld "${k}": ${JSON.stringify(fields)}`);
    }
  }
  const { at } = fields;
  if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) {
    throw new Error('Ereignis mit ungueltigem Ort at: ' + JSON.stringify(at));
  }
  if (typeof fields.reason !== 'string') throw new Error('reason muss ein deutscher Text sein');
  return { ...fields, at: { x: at.x, y: at.y } };
}

/** Pruefen, ohne zu werfen (fuer Importe und Tests) */
export function isValidEvent(e) {
  try { makeEvent(e); return true; } catch { return false; }
}
