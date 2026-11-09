// Edge Function resolve (P20, Plan 11.3): rechnet die Runde, sobald beide Seiten Befehle abgegeben haben
// oder die Frist verstrichen ist (dann haelt, wer nichts geschickt hat; begonnene Wege laufen weiter).
import { serve, admin, json, fail } from '../_lib/http.ts';
import { resolveMatch, deadlineMs, matchRecord } from '../_shared/js/online/match.js';

const STALE_MS = 90 * 1000; // haengengebliebene Runde (Absturz nach dem Weiterzaehlen) neu rechnen

serve(async (body, uid) => {
  const matchId = String(body.matchId ?? '');
  if (!/^[0-9a-f-]{36}$/.test(matchId)) return fail(400, 'Unbekanntes Gefecht');
  const db = admin();
  const { data: match } = await db.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (!match || ![match.player_a, match.player_b].includes(uid)) return fail(403, 'Nicht dein Gefecht');
  if (match.status !== 'active') return json({ ok: true, status: match.status });

  const { data: row } = await db.from('match_states').select('state, updated_at').eq('match_id', matchId).single();
  const ms = row!.state;
  const turn = ms.state.turn;
  const { data: orders } = await db.from('match_orders').select('user_id, orders').eq('match_id', matchId).eq('turn', turn);
  const of = (u: string) => orders?.find((o) => o.user_id === u)?.orders ?? null;
  const ordersA = of(match.player_a), ordersB = of(match.player_b);
  const late = match.deadline && Date.parse(match.deadline) < Date.now();
  if ((!ordersA || !ordersB) && !late) return json({ ok: true, waiting: true });

  if (match.turn === turn) {
    // Doppelaufruf absichern: nur wer die Runde als Erster weiterzaehlt, rechnet
    const { data: claimed } = await db.from('matches').update({ turn: turn + 1, updated_at: new Date().toISOString() })
      .eq('id', matchId).eq('turn', turn).select('id');
    if (!claimed || claimed.length === 0) return json({ ok: true, busy: true });
  } else if (match.turn === turn + 1) {
    if (Date.now() - Date.parse(match.updated_at) < STALE_MS) return json({ ok: true, busy: true });
  } else {
    return fail(500, 'Gefecht aus dem Takt');
  }

  const r = resolveMatch(ms, { a: ordersA, b: ordersB });
  const now = new Date().toISOString();
  const up = await db.from('match_states').update({ state: r.ms, updated_at: now }).eq('match_id', matchId);
  if (up.error) throw up.error;
  const vw = await db.from('match_views').upsert([
    { match_id: matchId, user_id: match.player_a, side: 'a', turn: r.ms.state.turn, view: r.views.a, updated_at: now },
    { match_id: matchId, user_id: match.player_b, side: 'b', turn: r.ms.state.turn, view: r.views.b, updated_at: now },
  ]);
  if (vw.error) throw vw.error;
  await db.from('matches').update({
    turn: r.ms.state.turn,
    turn_kind: r.turnKind,
    status: r.finished ? 'finished' : 'active',
    winner: r.finished ? (r.winner ?? 'draw') : null,
    seed: r.finished ? ms.seed : null,
    record: r.finished ? matchRecord(r.ms, matchId) : null,
    deadline: r.finished ? null : new Date(Date.now() + deadlineMs(r.turnKind)).toISOString(),
    updated_at: now,
  }).eq('id', matchId);

  return json({ ok: true, turn: r.ms.state.turn, finished: r.finished, late: !!late && (!ordersA || !ordersB) });
});
