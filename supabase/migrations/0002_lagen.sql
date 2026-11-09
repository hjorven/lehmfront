-- Lageaustausch (Werkstatt, Folgearbeit aus P25): eigene Lagen als Code ins Netz stellen, fremde laden.
-- Eine Lage ist der Code aus js/modes/lage-code.js ("L1." + base64url(deflate-raw(JSON))). Der Server prueft nur
-- Form und Groesse; ob die Lage spielbar ist, prueft der Client (lageProblems) vor dem Spielen und Oeffnen.
--  * Lesen darf jeder (auch ohne Anmeldung), Anlegen und Loeschen nur der Verfasser, Aendern niemand.
--  * Hoechstens 20 Lagen je Erkennungsmarke (Trigger), damit niemand die Liste zuschuettet.
--  * Titel und Verfasser ohne spitze Klammern und Anfuehrungszeichen (der Client maskiert ohnehin).

create table public.lagen (
  id text primary key default public.lf_code(6),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60 and title !~ '[<>&"]'),
  author text check (author is null or (char_length(author) <= 30 and author !~ '[<>&"]')),
  code text not null check (code like 'L1.%' and char_length(code) between 10 and 60000),
  created_at timestamptz not null default now()
);

create index lagen_created_idx on public.lagen (created_at desc);
create index lagen_user_idx on public.lagen (user_id);

alter table public.lagen enable row level security;

create policy "lagen lesbar" on public.lagen for select using (true);
create policy "eigene lagen anlegen" on public.lagen for insert to authenticated with check (user_id = (select auth.uid()));
create policy "eigene lagen loeschen" on public.lagen for delete to authenticated using (user_id = (select auth.uid()));

revoke update on public.lagen from anon, authenticated;
revoke insert, delete on public.lagen from anon;

create or replace function public.lf_lagen_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.lagen where user_id = new.user_id) >= 20 then
    raise exception 'Höchstens 20 Lagen je Erkennungsmarke. Nimm eine alte aus dem Netz.';
  end if;
  return new;
end
$$;

revoke execute on function public.lf_lagen_limit() from public, anon, authenticated;

create trigger lagen_limit before insert on public.lagen for each row execute function public.lf_lagen_limit();
