// Edge Function resolve (P20, Plan 11.3): rechnet die Runde, sobald beide Seiten Befehle abgegeben haben
// oder die Frist verstrichen ist (dann haelt, wer nichts geschickt hat; begonnene Wege laufen weiter).
//
// Reihenfolge (absturzfest): erst die Runde rechnen, dann mit EINEM bedingten Update von matches die Runde
// weiterzaehlen und Frist, Rundenart und Ende setzen (nur wer das schafft, schreibt weiter), dann die Befehle
// noch einmal lesen (eine Abgabe kurz vor dem Weiterzaehlen zaehlt noch), dann Zustand und Sichten schreiben.
// Bricht es nach dem Weiterzaehlen ab, steht matches.turn eine Runde vor match_states; der naechste Aufruf
// rechnet diese Runde nach 90 Sekunden neu (die Befehle dieser Runde sind dann eingefroren).
import { serve, admin, json, fail } from '../_lib/http.ts';
import { resolveMatch, deadlineMs, matchRecord } from '../_shared/js/online/match.js';

const STALE_MS = 90 * 1000;

serve(async (body, uid) => {
  const matchId = String(body.matchId ?? '');
  if (!/^[0-9a-f-]{36}$/.test(matchId)) return fail(400, 'Unbekanntes Gefecht');
  const db = admin();
  const { data: match } = await db.from('matches').select('*').eq('id', matchId).maybeSingle();
  if (!match || ![match.player_a, match.player_b].includes(uid)) return fail(403, 'Nicht dein Gefecht');
  if (match.status === 'waiting') return json({ ok: true, status: match.status });

  const { data: row } = await db.from('match_states').select('state, updated_at').eq('match_id', matchId).maybeSingle();
  if (!row) {
    // join ist nach dem Beitreten abgebrochen: Gefecht wieder freigeben, damit der Code weiter gilt
    if (match.status === 'active' && Date.now() - Date.parse(match.updated_at) > STALE_MS) {
      await db.from('match_views').delete().eq('match_id', matchId);
      await db.from('matches').update({ player_b: null, status: 'waiting', deadline: null, turn: 1, updated_at: new Date().toISOString() })
        .eq('id', matchId).eq('status', 'active');
      return json({ ok: true, status: 'waiting', reset: true });
    }
    return json({ ok: true, busy: true });
  }
  const ms = row.state;
  const turn = ms.state.turn;
  if (match.status === 'finished' && match.turn === turn) return json({ ok: true, status: 'finished' });

  const readOrders = async () => {
    const { data } = await db.from('match_orders').select('user_id, orders').eq('match_id', matchId).eq('turn', turn);
    const of = (u: string) => data?.find((o) => o.user_id === u)?.orders ?? null;
    return { a: of(match.player_a), b: of(match.player_b) };
  };
  const finish = (r: ReturnType<typeof resolveMatch>, now: string) => ({
    turn: r.ms.state.turn,
    turn_kind: r.turnKind,
    status: r.finished ? 'finished' : 'active',
    winner: r.finished ? (r.winner ?? 'draw') : null,
    seed: r.finished ? ms.seed : null,
    record: r.finished ? matchRecord(r.ms, matchId) : null,
    deadline: r.finished ? null : new Date(Date.now() + deadlineMs(r.turnKind)).toISOString(),
    updated_at: now,
  });

  let orders = await readOrders();
  let r = resolveMatch(ms, orders);
  if (match.turn === turn) {
    const late = match.deadline && Date.parse(match.deadline) < Date.now();
    if ((!orders.a || !orders.b) && !late) return json({ ok: true, waiting: true });
    // Doppelaufruf absichern: nur wer die Runde als Erster weiterzaehlt, rechnet
    const { data: claimed } = await db.from('matches').update(finish(r, new Date().toISOString()))
      .eq('id', matchId).eq('turn', turn).select('id');
    if (!claimed || claimed.length === 0) return json({ ok: true, busy: true });
    // Ab jetzt nimmt die Datenbank fuer diese Runde nichts mehr an; kam kurz vorher noch etwas, zaehlt es
    const again = await readOrders();
    if (JSON.stringify(again) !== JSON.stringify(orders)) {
      orders = again;
      r = resolveMatch(ms, orders);
      await db.from('matches').update(finish(r, new Date().toISOString())).eq('id', matchId);
    }
  } else if (match.turn === turn + 1) {
    // haengengebliebene Runde: matches ist schon weiter, Zustand noch nicht
    if (Date.now() - Date.parse(match.updated_at) < STALE_MS) return json({ ok: true, busy: true });
    await db.from('matches').update(finish(r, new Date().toISOString())).eq('id', matchId);
  } else {
    return fail(500, 'Gefecht aus dem Takt');
  }

  const now = new Date().toISOString();
  const vw = await db.from('match_views').upsert([
    { match_id: matchId, user_id: match.player_a, side: 'a', turn: r.ms.state.turn, view: r.views.a, updated_at: now },
    { match_id: matchId, user_id: match.player_b, side: 'b', turn: r.ms.state.turn, view: r.views.b, updated_at: now },
  ]);
  if (vw.error) throw vw.error;
  // Zustand zuletzt: erst wenn er steht, gilt die Runde als fertig gerechnet
  const up = await db.from('match_states').update({ state: r.ms, updated_at: now }).eq('match_id', matchId);
  if (up.error) throw up.error;

  return json({ ok: true, turn: r.ms.state.turn, finished: r.finished, late: !orders.a || !orders.b });
});
