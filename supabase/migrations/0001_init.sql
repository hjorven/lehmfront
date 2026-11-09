-- Lehmfront Online (P20, Plan 11.2). Abweichungen vom Plan, alle zugunsten des verdeckten Zustands:
--  * Der Seed einer Partie liegt nur in match_states (Service-Role). Mit Seed, Startlage und den Befehlen
--    beider Seiten liesse sich sonst der volle Zustand im Browser nachrechnen. matches.seed wird erst nach
--    dem Ende eingetragen (fuer den Replay-Link).
--  * Fremde Befehle sind erst nach dem Ende der Partie lesbar, nicht schon nach der Runde (gleicher Grund).
--  * Wartende Partien sieht nur, wer sie angelegt hat. Beitreten geht nur mit Einladungscode ueber die
--    Edge Function join, eine Liste offener Partien gibt es nicht.
--  * Tageslage: die Bestenliste zeigt Punkte, nicht die Befehle (sonst koennte man die beste Woche des Tages
--    abschreiben). Die Befehle liegen in daily_orders ohne Policy.
--  * matches.record traegt nach dem Ende die tatsaechlich gerechneten Befehle beider Seiten (auch die nach
--    verstrichener Frist weitergetragenen), damit der Replay-Link genau dieselbe Partie zeigt.
--  * lf_turn_status verraet nur, ob die Gegenseite fuer die laufende Runde schon abgegeben hat, nicht was.
--  * Profile entstehen per Trigger bei der Anmeldung (auch anonym) und tragen eine Erkennungsmarke (code).

-- Zufallscode aus Zeichen ohne Verwechslungsgefahr (ohne 0/O, 1/I/L)
create or replace function public.lf_code(n integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::integer, 1), '')
  from generate_series(1, n)
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username is null or (char_length(username) between 3 and 20 and username !~ '[<>&"]')),
  code text not null unique default public.lf_code(8),
  created_at timestamptz not null default now()
);

create table public.saves (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  slot smallint not null check (slot between 1 and 5),
  version integer not null default 1,
  label text check (label is null or char_length(label) <= 80),
  data jsonb not null check (pg_column_size(data) <= 3000000),
  updated_at timestamptz not null default now(),
  primary key (user_id, slot)
);

create table public.matches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default public.lf_code(6),
  map_id text not null check (map_id ~ '^(velde|kraehenholz|schacht|zufall-[1-9][0-9]{0,5})$'),
  player_a uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  player_b uuid references public.profiles(id) on delete cascade,
  turn integer not null default 1,
  turn_kind text not null default 'position' check (turn_kind in ('position', 'battle')),
  deadline timestamptz,
  status text not null default 'waiting' check (status in ('waiting', 'active', 'finished')),
  winner text check (winner in ('a', 'b', 'draw')),
  seed bigint,
  record jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (player_b is null or player_b <> player_a)
);
create index matches_player_a on public.matches (player_a);
create index matches_player_b on public.matches (player_b);

-- Voller Zustand inklusive verdeckter Einheiten und Seed: nur die Edge Functions (Service-Role)
create table public.match_states (
  match_id uuid primary key references public.matches(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

-- Gefilterte Sicht pro Spieler (Nebel des Krieges), per Realtime an den Client
create table public.match_views (
  match_id uuid not null references public.matches(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  side text not null check (side in ('a', 'b')),
  turn integer not null,
  view jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id)
);
create index match_views_user on public.match_views (user_id);

create table public.match_orders (
  match_id uuid not null references public.matches(id) on delete cascade,
  turn integer not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  orders jsonb not null check (jsonb_typeof(orders) = 'array' and pg_column_size(orders) <= 200000),
  created_at timestamptz not null default now(),
  primary key (match_id, turn, user_id)
);
create index match_orders_user on public.match_orders (user_id);

-- Tageslage: Ergebnis traegt nur die Edge Function submit-daily nach dem Nachrechnen ein
create table public.daily_results (
  day integer not null check (day between 20000101 and 99991231),
  user_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null,
  weeks_held integer not null check (weeks_held between 0 and 1),
  faction text not null check (faction in ('kaldern', 'morrow')),
  rounds integer not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
create index daily_results_rank on public.daily_results (day, score desc);

create table public.daily_orders (
  day integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  orders jsonb not null,
  created_at timestamptz not null default now(),
  primary key (day, user_id)
);
create index daily_orders_user on public.daily_orders (user_id);

alter table public.profiles      enable row level security;
alter table public.saves         enable row level security;
alter table public.matches       enable row level security;
alter table public.match_states  enable row level security;
alter table public.match_views   enable row level security;
alter table public.match_orders  enable row level security;
alter table public.daily_results enable row level security;
alter table public.daily_orders  enable row level security;

-- Profile
create policy "profil lesbar" on public.profiles for select using (true);
create policy "eigenes profil aendern" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke insert, update, delete on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

create or replace function public.lf_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end
$$;
revoke execute on function public.lf_new_user() from public, anon, authenticated;
create trigger lf_on_auth_user after insert on auth.users
  for each row execute function public.lf_new_user();

-- Cloud-Spielstand
create policy "eigene saves" on public.saves for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Offene Einladungen des Aufrufers (security definer, sonst rekursive Policy auf matches)
create or replace function public.lf_open_invites()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.matches where player_a = (select auth.uid()) and status = 'waiting'
$$;
revoke execute on function public.lf_open_invites() from public, anon;
grant execute on function public.lf_open_invites() to authenticated;

-- Partien: nur Teilnehmer sehen sie
create policy "teilnehmer sehen match" on public.matches for select to authenticated
  using ((select auth.uid()) in (player_a, player_b));
create policy "match anlegen" on public.matches for insert to authenticated
  with check (
    player_a = (select auth.uid())
    and player_b is null and status = 'waiting' and turn = 1 and turn_kind = 'position'
    and winner is null and seed is null and deadline is null and record is null
    and public.lf_open_invites() < 5
  );
create policy "wartendes match zurueckziehen" on public.matches for delete to authenticated
  using (player_a = (select auth.uid()) and status = 'waiting');
revoke update on public.matches from anon, authenticated;

-- match_states bekommt absichtlich keine Policy und keine Rechte
revoke all on public.match_states from anon, authenticated;
revoke all on public.daily_orders from anon, authenticated;

create policy "eigene sicht" on public.match_views for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete on public.match_views from anon, authenticated;

-- Eigene Befehle immer, fremde erst nach dem Ende der Partie
create policy "befehle lesen" on public.match_orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.matches m
      where m.id = match_orders.match_id
        and (select auth.uid()) in (m.player_a, m.player_b)
        and m.status = 'finished'
    )
  );
create policy "eigene befehle abgeben" on public.match_orders for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.matches m
      where m.id = match_orders.match_id
        and m.status = 'active'
        and m.turn = match_orders.turn
        and (select auth.uid()) in (m.player_a, m.player_b)
    )
  );
revoke update, delete on public.match_orders from anon, authenticated;

-- Hat die Gegenseite schon abgegeben? (Umschlag im Fernsprechamt), nur fuer Teilnehmer
create or replace function public.lf_turn_status(p_match uuid)
returns table (side text, submitted boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select s.side, exists (
    select 1 from public.match_orders o
    where o.match_id = m.id and o.turn = m.turn
      and o.user_id = case s.side when 'a' then m.player_a else m.player_b end
  )
  from public.matches m
  cross join (values ('a'), ('b')) as s(side)
  where m.id = p_match and (select auth.uid()) in (m.player_a, m.player_b)
$$;
revoke execute on function public.lf_turn_status(uuid) from public, anon;
grant execute on function public.lf_turn_status(uuid) to authenticated;

create policy "bestenliste lesbar" on public.daily_results for select using (true);
revoke insert, update, delete on public.daily_results from anon, authenticated;

alter publication supabase_realtime add table public.matches, public.match_views;
