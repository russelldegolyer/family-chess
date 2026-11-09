
-- Authenticated family members may watch active games; only players can submit moves.
drop policy if exists chess_games_read on public.chess_games;
create policy chess_games_read on public.chess_games for select to authenticated
using (white_player_id=(select auth.uid()) or black_player_id=(select auth.uid())
       or (status='active' and black_player_id is not null));
drop policy if exists chess_moves_read on public.chess_moves;
create policy chess_moves_read on public.chess_moves for select to authenticated
using (exists(select 1 from public.chess_games g
  where g.id=chess_moves.game_id
    and (g.white_player_id=(select auth.uid()) or g.black_player_id=(select auth.uid())
         or (g.status='active' and g.black_player_id is not null))));

create table if not exists public.chess_challenges (
 id uuid primary key default gen_random_uuid(),
 challenger_id uuid not null references auth.users(id) on delete cascade,
 target_id uuid not null references auth.users(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','declined','canceled','expired')),
 game_id uuid references public.chess_games(id) on delete set null,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '60 seconds'),
 responded_at timestamptz,
 constraint chess_challenge_not_self check(challenger_id<>target_id)
);
create index if not exists chess_challenge_target_pending_idx on public.chess_challenges(target_id,expires_at desc) where status='pending';
create index if not exists chess_challenge_challenger_idx on public.chess_challenges(challenger_id,created_at desc);
alter table public.chess_challenges enable row level security;
drop policy if exists chess_challenges_read_party on public.chess_challenges;
create policy chess_challenges_read_party on public.chess_challenges for select to authenticated
using(challenger_id=(select auth.uid()) or target_id=(select auth.uid()));
revoke all on public.chess_challenges from anon,authenticated;
grant select on public.chess_challenges to authenticated;

create table if not exists public.chess_push_subscriptions (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 endpoint text not null unique check(length(endpoint)<=2048 and endpoint like 'https://%'),
 p256dh text not null check(length(p256dh) between 30 and 400),
 auth text not null check(length(auth) between 10 and 200),
 created_at timestamptz not null default now()
);
create index if not exists chess_push_owner_idx on public.chess_push_subscriptions(user_id);
alter table public.chess_push_subscriptions enable row level security;
drop policy if exists chess_push_owned on public.chess_push_subscriptions;
create policy chess_push_owned on public.chess_push_subscriptions for all to authenticated
using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
revoke all on public.chess_push_subscriptions from anon,authenticated;
grant select,insert,update,delete on public.chess_push_subscriptions to authenticated;

create or replace function public.chess_send_challenge(p_target uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); v_id uuid;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 if caller = p_target or p_target is null then raise exception 'Choose another player'; end if;
 if not exists (select 1 from public.chess_profiles where id=p_target) then raise exception 'Player not found'; end if;
 if not exists (select 1 from public.chess_profiles where id=caller) then raise exception 'Set up your player name first'; end if;
 -- The user can only have one outgoing unanswered challenge at a time.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(caller::text)::bigint);
 update public.chess_challenges set status='expired',responded_at=now()
 where status='pending' and expires_at<=now() and (challenger_id=caller or target_id=caller);
 if exists(select 1 from public.chess_challenges
  where challenger_id=caller and status='pending' and expires_at>now()) then
  raise exception 'You already have a pending challenge'; end if;
 if exists(select 1 from public.chess_games
  where status='active' and (white_player_id=caller or black_player_id=caller)) then
  raise exception 'Finish your current game before sending another challenge'; end if;
 insert into public.chess_challenges(challenger_id,target_id)
 values(caller,p_target) returning id into v_id;
 return v_id;
end $$;

create or replace function public.chess_respond_challenge(p_id uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); c public.chess_challenges%rowtype; new_game uuid;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 select * into c from public.chess_challenges where id=p_id for update;
 if not found or c.target_id<>caller then raise exception 'Challenge not found'; end if;
 if c.status<>'pending' then raise exception 'Challenge is no longer available'; end if;
 if c.expires_at <= clock_timestamp() then
  update public.chess_challenges set status='expired',responded_at=now() where id=p_id;
  return null;
 end if;
 if not p_accept then
  update public.chess_challenges set status='declined',responded_at=now() where id=p_id;
  return null;
 end if;
 -- Serialize acceptance across different invitations targeting this account.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(caller::text)::bigint);
 if exists(select 1 from public.chess_games g
  where g.status='active' and (g.white_player_id in (caller,c.challenger_id) or g.black_player_id in(caller,c.challenger_id))) then
  raise exception 'A player is already in an active match';
 end if;
 insert into public.chess_games(white_player_id,black_player_id,status)
 values(c.challenger_id,caller,'active') returning id into new_game;
 update public.chess_challenges set status='accepted',game_id=new_game,responded_at=now() where id=p_id;
 return new_game;
end $$;

create or replace function public.chess_cancel_challenge(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
 update public.chess_challenges set status='canceled',responded_at=now()
 where id=p_id and challenger_id=(select auth.uid()) and status='pending';
 return found;
end $$;
revoke all on function public.chess_send_challenge(uuid), public.chess_respond_challenge(uuid,boolean),public.chess_cancel_challenge(uuid) from public,anon;
grant execute on function public.chess_send_challenge(uuid), public.chess_respond_challenge(uuid,boolean),public.chess_cancel_challenge(uuid) to authenticated;

do $$
begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chess_challenges') then
  alter publication supabase_realtime add table public.chess_challenges;
 end if;
end $$;
