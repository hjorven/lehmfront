-- Lageaustausch haerten (Review zu 0002):
--  * Anlegen nur mit title, author, code: id und created_at setzt der Server (sonst stuende eine Lage mit
--    created_at in der Zukunft dauerhaft oben in der Liste).
--  * Der Code besteht nur aus "L1." und base64url-Zeichen; er wandert ungeprueft in Adressen.
--  * user_id bleibt lesbar: Postgres verlangt Leserecht auf die Spalten, die eine Policy beim Anlegen prueft.
--    Der Client fragt user_id nicht ab und merkt sich eigene Lagen selbst.

revoke insert on public.lagen from authenticated;
grant insert (title, author, code) on public.lagen to authenticated;

-- Teilversuch rueckgaengig (falls eingespielt): volles Leserecht wie in 0002
grant select on public.lagen to anon, authenticated;

alter table public.lagen add constraint lagen_code_zeichen check (code ~ '^L1\.[A-Za-z0-9_-]+$');
