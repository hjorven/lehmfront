// Edge Function submit-daily (P20, Plan 11.1): rechnet die Tageslage aus dem Befehlsprotokoll nach und traegt
// das Ergebnis in die Bestenliste ein. Clients schreiben nie selbst in daily_results.
import { serve, admin, json, fail } from '../_lib/http.ts';
import { replayDaily } from '../_lib/logic.ts';

/** JJJJMMTT eines Zeitpunkts in UTC */
function keyOf(ms: number): number {
  const d = new Date(ms);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

serve(async (body, uid) => {
  const day = Number(body.day);
  // Zeitzonen der Spieler: gestern, heute und morgen (UTC) gelten; spaeter nachgereicht zaehlt nicht mehr
  const now = Date.now();
  const allowed = [keyOf(now - 86400000), keyOf(now), keyOf(now + 86400000)];
  if (!allowed.includes(day)) return fail(400, 'Diese Tageslage ist abgelaufen.');
  const rounds = Array.isArray(body.rounds) ? body.rounds.map((a) => ({ a })) : null;
  if (!rounds) return fail(400, 'Kein Befehlsprotokoll');

  const r = replayDaily(day, rounds);
  if (!r.ok || typeof r.points !== 'number') return fail(422, `Nachrechnen ergibt kein Ergebnis: ${r.why}.`);
  const points: number = r.points;
  if (Number.isFinite(body.points) && body.points !== points) {
    console.warn('Punkte weichen ab', uid, day, body.points, points);
  }

  const db = admin();
  const { data: old } = await db.from('daily_results').select('score').eq('day', day).eq('user_id', uid).maybeSingle();
  const better = !old || points > old.score;
  if (better) {
    const row = { day, user_id: uid, score: points, weeks_held: r.held ? 1 : 0, faction: r.faction, rounds: r.played };
    const a = await db.from('daily_results').upsert(row);
    if (a.error) throw a.error;
    const b = await db.from('daily_orders').upsert({ day, user_id: uid, orders: body.rounds });
    if (b.error) throw b.error;
  }
  return json({ ok: true, points, held: r.held, best: better ? points : old!.score, improved: better });
});
