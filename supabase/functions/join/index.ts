// Edge Function join (P20, Plan 11.2): Partie per Einladungscode beitreten. Setzt player_b, wuerfelt den
// geheimen Seed, legt den vollen Startzustand (match_states) und die Sicht beider Seiten (match_views) an.
import { serve, admin, json, fail, secretSeed } from '../_lib/http.ts';
import { startMatch, normalizeCode, deadlineMs } from '../_shared/js/online/match.js';

serve(async (body, uid) => {
  const code = normalizeCode(body.code);
  if (!code) return fail(400, 'Der Code hat sechs Zeichen.');
  const db = admin();
  const { data: match } = await db.from('matches').select('*').eq('code', code).maybeSingle();
  if (!match) return fail(404, 'Unter diesem Code wartet kein Gefecht.');
  if (match.player_a === uid) return fail(409, 'Das ist dein eigenes Gefecht. Gib den Code weiter.');
  if (match.status !== 'waiting' || match.player_b) {
    if (match.player_b === uid) return json({ ok: true, matchId: match.id, mapId: match.map_id, side: 'b', again: true });
    return fail(409, 'Dieses Gefecht hat schon zwei Teilnehmer.');
  }
  // Nur wer zuerst kommt, wird Seite b
  const deadline = new Date(Date.now() + deadlineMs('position')).toISOString();
  const { data: claimed } = await db.from('matches')
    .update({ player_b: uid, status: 'active', deadline, updated_at: new Date().toISOString() })
    .eq('id', match.id).eq('status', 'waiting').is('player_b', null).select('id');
  if (!claimed || claimed.length === 0) return fail(409, 'Jemand anderes war schneller.');

  const { ms, views } = startMatch(match.map_id, secretSeed());
  const st = await db.from('match_states').insert({ match_id: match.id, state: ms });
  const vw = await db.from('match_views').upsert([
    { match_id: match.id, user_id: match.player_a, side: 'a', turn: ms.state.turn, view: views.a },
    { match_id: match.id, user_id: uid, side: 'b', turn: ms.state.turn, view: views.b },
  ]);
  if (st.error || vw.error) {
    // Zuruecksetzen, damit der Code weiter gilt
    await db.from('match_states').delete().eq('match_id', match.id);
    await db.from('matches').update({ player_b: null, status: 'waiting', deadline: null }).eq('id', match.id);
    console.error(st.error ?? vw.error);
    return fail(500, 'Die Leitung ist gestört. Später noch einmal.');
  }
  return json({ ok: true, matchId: match.id, mapId: match.map_id, side: 'b' });
});
