-- Chess: live clock changes, Last online, and Training persistence.
-- PREPARED ONLY (2026-11-11). Not applied. Review, then apply as one migration before deploying the
-- matching front end. Touches public.chess_* objects only (shared project with League Lab).

---------------------------------------------------------------------------------------------------
-- 1. Change the time control of an active online game (either player). Row-locked, server time.
--    total -> total: both clocks shift by the difference (never below 0; 0 = existing penalty rules).
--    -> move60: per-move countdown starts fresh for the side to move. move60/off -> total: both clocks
--    start at the new total. A paused game stays paused.
---------------------------------------------------------------------------------------------------
create or replace function public.chess_change_clock(p_game_id uuid, p_mode text)
returns text language plpgsql security definer set search_path='' as $$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid());
  at_ts timestamptz:=pg_catalog.clock_timestamp(); side text; elapsed bigint:=0;
  w bigint; b bigint; old_total bigint; new_total bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if p_mode not in ('off','10m','12m','15m','move60') then raise exception 'Invalid clock selection'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can change the clock'; end if;
  if g.status<>'active' then raise exception 'Game must be active'; end if;
  if g.clock_state='penalty' then raise exception 'Finish the pawn choice first'; end if;
  if g.clock_mode=p_mode then return p_mode; end if;
  side:=split_part(g.current_fen,' ',2);
  w:=coalesce(g.clock_white_ms,0); b:=coalesce(g.clock_black_ms,0);
  if g.clock_mode<>'off' and g.clock_state='running' and g.clock_turn_started_at is not null then
    elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
    if side='w' then w:=greatest(0,w-elapsed); else b:=greatest(0,b-elapsed); end if;
  end if;
  old_total:=case g.clock_mode when '10m' then 600000 when '12m' then 720000 when '15m' then 900000 else null end;
  new_total:=case p_mode when '10m' then 600000 when '12m' then 720000 when '15m' then 900000 else null end;
  if old_total is not null and new_total is not null then
    w:=greatest(0,w+new_total-old_total); b:=greatest(0,b+new_total-old_total);
  elsif p_mode='move60' then w:=60000; b:=60000;
  elsif new_total is not null then w:=new_total; b:=new_total;
  else w:=null; b:=null; end if;
  update public.chess_games set clock_mode=p_mode, clock_white_ms=w, clock_black_ms=b,
    clock_turn_started_at=case when p_mode='off' or g.clock_state<>'running' then null else at_ts end,
    updated_at=at_ts where id=p_game_id;
  return p_mode;
end;$$;
revoke all on function public.chess_change_clock(uuid,text) from public,anon;
grant execute on function public.chess_change_clock(uuid,text) to authenticated;

---------------------------------------------------------------------------------------------------
-- 2. Last online. Presence (realtime) still decides "Online"; this keeps a server-time heartbeat.
---------------------------------------------------------------------------------------------------
alter table public.chess_profiles add column if not exists last_seen_at timestamptz;
create or replace function public.chess_touch_last_seen()
returns timestamptz language sql security definer set search_path='' as $$
  update public.chess_profiles set last_seen_at=pg_catalog.now() where id=(select auth.uid())
  returning last_seen_at;
$$;
revoke all on function public.chess_touch_last_seen() from public,anon;
grant execute on function public.chess_touch_last_seen() to authenticated;

---------------------------------------------------------------------------------------------------
-- 3. Puzzles (Lichess puzzle database, CC0). Loaded by tools/import-lichess-puzzles.py, never by the app.
--    rnd gives cheap random picks inside a rating band without scanning.
---------------------------------------------------------------------------------------------------
create table if not exists public.chess_puzzles (
  id text primary key,
  fen text not null,
  moves text not null,               -- UCI, space separated; first move is the opponent's
  rating integer not null,
  rating_deviation integer,
  popularity integer,
  nb_plays integer,
  themes text[] not null default '{}',
  rnd double precision not null default random()
);
create index if not exists chess_puzzles_rating_rnd on public.chess_puzzles (rating, rnd);
create index if not exists chess_puzzles_themes on public.chess_puzzles using gin (themes);
alter table public.chess_puzzles enable row level security;
drop policy if exists chess_puzzles_read on public.chess_puzzles;
create policy chess_puzzles_read on public.chess_puzzles for select to authenticated using (true);

-- One random puzzle in a rating band, optionally with a theme, skipping recently seen ids.
create or replace function public.chess_next_puzzle(p_min integer, p_max integer, p_theme text default null,
  p_exclude text[] default '{}')
returns setof public.chess_puzzles language sql stable security invoker set search_path='' as $$
  with pick as (select pg_catalog.random() as r)
  (select p.* from public.chess_puzzles p, pick
    where p.rating between p_min and p_max and p.rnd >= pick.r
      and (p_theme is null or p.themes @> array[p_theme]) and not (p.id = any(p_exclude))
    order by p.rnd limit 1)
  union all
  (select p.* from public.chess_puzzles p, pick
    where p.rating between p_min and p_max and p.rnd < pick.r
      and (p_theme is null or p.themes @> array[p_theme]) and not (p.id = any(p_exclude))
    order by p.rnd desc limit 1)
  limit 1;
$$;
grant execute on function public.chess_next_puzzle(integer,integer,text,text[]) to authenticated;

---------------------------------------------------------------------------------------------------
-- 4. Training progress (per profile) and puzzle attempts.
---------------------------------------------------------------------------------------------------
create table if not exists public.chess_training_progress (
  user_id uuid primary key references public.chess_profiles(id) on delete cascade,
  puzzle_rating integer not null default 1200,
  puzzle_rating_peak integer not null default 1200,
  data jsonb not null default '{}'::jsonb,   -- counts, streaks, categories, lessons, challenges, settings
  updated_at timestamptz not null default now()
);
alter table public.chess_training_progress enable row level security;
drop policy if exists chess_training_progress_own on public.chess_training_progress;
create policy chess_training_progress_own on public.chess_training_progress for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));

create table if not exists public.chess_puzzle_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.chess_profiles(id) on delete cascade,
  puzzle_id text not null,
  solved boolean not null,
  hints smallint not null default 0,
  rated boolean not null default false,
  rating_before integer,
  rating_after integer,
  created_at timestamptz not null default now()
);
create index if not exists chess_puzzle_attempts_user on public.chess_puzzle_attempts (user_id, created_at desc);
alter table public.chess_puzzle_attempts enable row level security;
drop policy if exists chess_puzzle_attempts_own on public.chess_puzzle_attempts;
create policy chess_puzzle_attempts_own on public.chess_puzzle_attempts for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
