-- Chess: saved games. Save a position mid-game, keep it (or let it vanish once resumed), and resume it
-- against the computer or send it to a family member, who picks it up from the same move.
-- Applied 2026-11-12 as migration chess_saved_games_2026_11_12. Touches public.chess_* objects only.

---------------------------------------------------------------------------------------------------
-- 1. Saved games: one row per owner. An online save writes one row for each player (same group_id).
---------------------------------------------------------------------------------------------------
create table if not exists public.chess_saved_games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null default gen_random_uuid(),
  source text not null check (source in ('online','computer','local')),
  source_game_id uuid,
  owner_side text not null check (owner_side in ('w','b')),
  opponent_id uuid references auth.users(id) on delete set null,
  white_name text not null default 'White',
  black_name text not null default 'Black',
  moves text[] not null default '{}',
  sans text[] not null default '{}',
  actions jsonb not null default '[]'::jsonb,   -- pawn-for-time board changes copied from an online game
  fen text not null,
  level smallint,
  keep boolean not null default false,
  created_at timestamptz not null default now(),
  constraint chess_saved_moves_size check (cardinality(moves) between 1 and 1000)
);
create index if not exists chess_saved_games_owner on public.chess_saved_games (owner_id, created_at desc);
create index if not exists chess_saved_games_group on public.chess_saved_games (group_id);
alter table public.chess_saved_games enable row level security;
drop policy if exists chess_saved_games_read_own on public.chess_saved_games;
create policy chess_saved_games_read_own on public.chess_saved_games for select to authenticated
  using (owner_id=(select auth.uid()));
drop policy if exists chess_saved_games_delete_own on public.chess_saved_games;
create policy chess_saved_games_delete_own on public.chess_saved_games for delete to authenticated
  using (owner_id=(select auth.uid()));
-- No insert/update policies: rows are written only by the functions below.

alter table public.chess_games add column if not exists resumed_plies integer not null default 0;
alter table public.chess_games add column if not exists saved_group uuid;
alter table public.chess_challenges add column if not exists kind text not null default 'play';
do $$ begin
  if not exists (select 1 from pg_constraint where conname='chess_challenges_kind_check') then
    alter table public.chess_challenges add constraint chess_challenges_kind_check check (kind in ('play','saved'));
  end if;
end $$;

-- Save the live online game for BOTH players (server moves are the source of truth).
create or replace function public.chess_save_online_game(p_game_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); g public.chess_games%rowtype; grp uuid:=gen_random_uuid();
  mv text[]; sn text[]; acts jsonb; wn text; bn text;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can save this game'; end if;
  if g.black_player_id is null or g.white_player_id is null then raise exception 'Both players must be in the game'; end if;
  if g.status<>'active' then raise exception 'Only a game in progress can be saved'; end if;
  select coalesce(array_agg(move_uci order by ply),'{}'), coalesce(array_agg(move_san order by ply),'{}')
    into mv, sn from public.chess_moves where game_id=p_game_id;
  if cardinality(mv)=0 then raise exception 'Play a move before saving'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('after_ply',after_ply,'kind',kind,'square',square,'fen_after',fen_after,
      'side',case when actor_id=g.white_player_id then 'w' else 'b' end) order by id),'[]'::jsonb)
    into acts from public.chess_clock_actions where game_id=p_game_id;
  select coalesce(display_name,'White') into wn from public.chess_profiles where id=g.white_player_id;
  select coalesce(display_name,'Black') into bn from public.chess_profiles where id=g.black_player_id;
  -- Saving the same game again replaces the earlier unkept save of it.
  delete from public.chess_saved_games where source_game_id=p_game_id and keep=false;
  insert into public.chess_saved_games(owner_id,group_id,source,source_game_id,owner_side,opponent_id,white_name,black_name,moves,sans,actions,fen)
  values (g.white_player_id,grp,'online',p_game_id,'w',g.black_player_id,coalesce(wn,'White'),coalesce(bn,'Black'),mv,sn,acts,g.current_fen),
         (g.black_player_id,grp,'online',p_game_id,'b',g.white_player_id,coalesce(wn,'White'),coalesce(bn,'Black'),mv,sn,acts,g.current_fen);
  return grp;
end;$$;
revoke all on function public.chess_save_online_game(uuid) from public,anon;
grant execute on function public.chess_save_online_game(uuid) to authenticated;

-- Save a game played on this device (against the computer, or two players on one screen) for the caller.
-- Moves are re-checked with chess.js by the chess-saved-game Edge Function before they ever reach a shared game.
create or replace function public.chess_save_local_game(p_source text, p_moves text[], p_sans text[], p_fen text,
  p_side text, p_level integer, p_white text, p_black text)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid:=(select auth.uid()); new_id uuid;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if p_source not in ('computer','local') or p_side not in ('w','b') then raise exception 'Invalid save'; end if;
  if cardinality(p_moves) not between 1 and 1000 or cardinality(p_sans)<>cardinality(p_moves) then raise exception 'Invalid moves'; end if;
  if exists (select 1 from unnest(p_moves) m where m !~ '^[a-h][1-8][a-h][1-8][qrbn]?$') then raise exception 'Invalid moves'; end if;
  if p_fen is null or length(p_fen)>100 then raise exception 'Invalid position'; end if;
  if (select count(*) from public.chess_saved_games where owner_id=u)>=60 then raise exception 'Too many saved games. Delete a few first.'; end if;
  insert into public.chess_saved_games(owner_id,source,owner_side,white_name,black_name,moves,sans,fen,level)
  values (u,p_source,p_side,left(coalesce(nullif(p_white,''),'White'),40),left(coalesce(nullif(p_black,''),'Black'),40),
    p_moves,p_sans,p_fen,case when p_source='computer' then greatest(1,least(5,coalesce(p_level,2))) else null end)
  returning id into new_id;
  return new_id;
end;$$;
revoke all on function public.chess_save_local_game(text,text[],text[],text,text,integer,text,text) from public,anon;
grant execute on function public.chess_save_local_game(text,text[],text[],text,text,integer,text,text) to authenticated;

-- Keep forever (or not).
create or replace function public.chess_saved_set_keep(p_id uuid, p_keep boolean)
returns boolean language sql security definer set search_path='' as $$
  update public.chess_saved_games set keep=coalesce(p_keep,false) where id=p_id and owner_id=(select auth.uid()) returning keep;
$$;
revoke all on function public.chess_saved_set_keep(uuid,boolean) from public,anon;
grant execute on function public.chess_saved_set_keep(uuid,boolean) to authenticated;

-- Resumed against the computer / on this screen: an unkept save disappears.
create or replace function public.chess_saved_consume(p_id uuid)
returns boolean language sql security definer set search_path='' as $$
  delete from public.chess_saved_games where id=p_id and owner_id=(select auth.uid()) and keep=false returning true;
$$;
revoke all on function public.chess_saved_consume(uuid) from public,anon;
grant execute on function public.chess_saved_consume(uuid) to authenticated;

---------------------------------------------------------------------------------------------------
-- 2. A resumed game's waiting row may hold the inviter in EITHER seat; joining fills the empty one.
---------------------------------------------------------------------------------------------------
create or replace function public.chess_join_game(p_game_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); game_row public.chess_games%rowtype;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 perform pg_catalog.pg_advisory_xact_lock(61742,pg_catalog.hashtext(caller::text));
 select * into game_row from public.chess_games where id=p_game_id for update;
 if not found or game_row.status<>'waiting'
   or (game_row.white_player_id is null) = (game_row.black_player_id is null)
   or caller in (coalesce(game_row.white_player_id,'00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(game_row.black_player_id,'00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Invitation expired, replaced, or already joined';
 end if;
 update public.chess_games set status='finished',end_reason='replaced',updated_at=now()
  where status in ('waiting','active') and id<>p_game_id and (white_player_id=caller or black_player_id=caller);
 update public.chess_challenges set status='canceled',responded_at=now() where challenger_id=caller and status='pending';
 if game_row.black_player_id is null then
   update public.chess_games set black_player_id=caller,status='active',updated_at=now() where id=p_game_id and status='waiting';
 else
   update public.chess_games set white_player_id=caller,status='active',updated_at=now() where id=p_game_id and status='waiting';
 end if;
 -- A resumed save that nobody chose to keep disappears once the game is picked up.
 if game_row.saved_group is not null then
   delete from public.chess_saved_games where group_id=game_row.saved_group and keep=false;
 end if;
 return p_game_id;
end $$;

create or replace function public.chess_respond_challenge(p_id uuid, p_accept boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); c public.chess_challenges%rowtype; new_game uuid;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 select * into c from public.chess_challenges where id=p_id for update;
 if not found or c.target_id<>caller then raise exception 'Challenge not found'; end if;
 if c.status<>'pending' then raise exception 'Challenge is no longer available'; end if;
 if c.expires_at<=clock_timestamp() then
  update public.chess_challenges set status='expired',responded_at=now() where id=p_id; return null;
 end if;
 if not p_accept then
  update public.chess_challenges set status='declined',responded_at=now() where id=p_id; return null;
 end if;
 if caller::text<c.challenger_id::text then
  perform pg_catalog.pg_advisory_xact_lock(61742,pg_catalog.hashtext(caller::text));
  perform pg_catalog.pg_advisory_xact_lock(61742,pg_catalog.hashtext(c.challenger_id::text));
 else
  perform pg_catalog.pg_advisory_xact_lock(61742,pg_catalog.hashtext(c.challenger_id::text));
  perform pg_catalog.pg_advisory_xact_lock(61742,pg_catalog.hashtext(caller::text));
 end if;
 if c.game_id is not null then
  if not exists(select 1 from public.chess_games where id=c.game_id and status='waiting'
     and ((white_player_id=c.challenger_id and black_player_id is null)
       or (black_player_id=c.challenger_id and white_player_id is null))) then
    update public.chess_challenges set status='canceled',responded_at=now() where id=p_id;
    raise exception 'This invitation was replaced or joined already';
  end if;
  new_game:=public.chess_join_game(c.game_id);
 else
  update public.chess_games set status='finished',end_reason='replaced',updated_at=now()
    where status in ('waiting','active')
      and (white_player_id in (caller,c.challenger_id) or black_player_id in (caller,c.challenger_id));
  update public.chess_challenges set status='canceled',responded_at=now()
    where id<>p_id and status='pending' and challenger_id in (caller,c.challenger_id);
  insert into public.chess_games(white_player_id,black_player_id,status)
   values(c.challenger_id,caller,'active') returning id into new_game;
 end if;
 update public.chess_challenges set status='accepted',game_id=new_game,responded_at=now() where id=p_id;
 return new_game;
end $$;

create or replace function public.chess_cancel_invite(p_game_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null then raise exception 'Sign in first'; end if;
  update public.chess_challenges set status='canceled', responded_at=now()
    where game_id=p_game_id and challenger_id=caller and status='pending';
  update public.chess_games set status='finished', end_reason='replaced', updated_at=now()
    where id=p_game_id and status='waiting'
      and ((white_player_id=caller and black_player_id is null) or (black_player_id=caller and white_player_id is null));
  return found;
end $$;

-- The clock preference comes from whoever opened the game (white normally; black for a resumed save).
create or replace function public.chess_clock_initialize()
returns trigger language plpgsql set search_path='' as $$
declare v_mode text; v_ms bigint;
begin
  if tg_op='INSERT' then
    select clock_preference into v_mode from public.chess_profiles where id=coalesce(new.white_player_id,new.black_player_id);
    new.clock_mode:=coalesce(v_mode,'off');
    v_ms:=case new.clock_mode when '10m' then 600000 when '12m' then 720000
      when '15m' then 900000 when 'move60' then 60000 else 0 end;
    new.clock_white_ms:=v_ms;new.clock_black_ms:=v_ms;
    new.clock_state:='running';
    new.clock_turn_started_at:=case when new.status='active'
      and new.black_player_id is not null and new.white_player_id is not null and new.clock_mode<>'off'
      then pg_catalog.clock_timestamp() else null end;
  elsif old.status='waiting' and new.status='active' and new.black_player_id is not null and new.white_player_id is not null then
    if new.clock_mode<>'off' then
      new.clock_state:='running';
      new.clock_turn_started_at:=pg_catalog.clock_timestamp();
    end if;
  end if;
  return new;
end;$$;

-- Follow-up migration chess_saved_games_open_white_seat (same day): a resumed game can wait with only Black seated.
alter table public.chess_games alter column white_player_id drop not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='chess_games_one_seat_filled') then
    alter table public.chess_games add constraint chess_games_one_seat_filled check (white_player_id is not null or black_player_id is not null);
  end if;
end $$;
