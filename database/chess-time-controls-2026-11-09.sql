-- Chess time controls. Existing games stay untimed; new games inherit the challenger's profile setting.
begin;
alter table public.chess_profiles
  add column if not exists clock_preference text not null default 'off'
  constraint chess_profile_clock_preference_check check (clock_preference in ('off','10m','12m','15m','move3'));
alter table public.chess_games
  add column if not exists clock_mode text not null default 'off'
  constraint chess_game_clock_mode_check check (clock_mode in ('off','10m','12m','15m','move3')),
  add column if not exists clock_white_ms bigint not null default 0
  constraint chess_game_clock_white_check check (clock_white_ms >= 0),
  add column if not exists clock_black_ms bigint not null default 0
  constraint chess_game_clock_black_check check (clock_black_ms >= 0),
  add column if not exists clock_turn_started_at timestamptz;

-- Insert paths include private invitations and direct person-to-person challenges.
create or replace function public.chess_clock_initialize()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_mode text; v_ms bigint;
begin
  if tg_op = 'INSERT' then
    select clock_preference into v_mode from public.chess_profiles where id=new.white_player_id;
    new.clock_mode := coalesce(v_mode,'off');
    v_ms := case new.clock_mode
      when '10m' then 600000 when '12m' then 720000 when '15m' then 900000
      when 'move3' then 180000 else 0 end;
    new.clock_white_ms := v_ms;
    new.clock_black_ms := v_ms;
    new.clock_turn_started_at := case when new.status='active'
      and new.black_player_id is not null and new.clock_mode<>'off'
      then pg_catalog.clock_timestamp() else null end;
  elsif old.status='waiting' and new.status='active' and new.black_player_id is not null then
    -- Do not start white's clock while the invitation is still waiting.
    if new.clock_mode<>'off' then new.clock_turn_started_at:=pg_catalog.clock_timestamp(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists chess_clock_initialize_trigger on public.chess_games;
create trigger chess_clock_initialize_trigger
before insert or update on public.chess_games for each row
execute function public.chess_clock_initialize();

-- Called only by the existing server-side move-validator using a service-role connection.
-- On an expired move, return 0 and persist a timeout loss in the same locked transaction.
create or replace function public.chess_commit_validated_move(
  p_game_id uuid, p_player_id uuid, p_expected_fen text, p_move_uci text,
  p_move_san text, p_next_fen text, p_finished boolean, p_result text
)
returns integer language plpgsql set search_path = '' as $$
declare
  game_row public.chess_games%rowtype;
  next_ply integer;
  next_status text;
  turn_side text;
  elapsed bigint;
  remaining bigint;
  now_ts timestamptz;
  clock_w bigint;
  clock_b bigint;
begin
  if current_user <> 'service_role' then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  select * into game_row from public.chess_games where id=p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if game_row.status <> 'active' then raise exception 'Game is not active'; end if;
  if game_row.current_fen is distinct from p_expected_fen then
    raise exception 'Position changed: refresh before moving';
  end if;
  turn_side := split_part(p_expected_fen,' ',2);
  if (turn_side='w' and game_row.white_player_id is distinct from p_player_id)
     or (turn_side='b' and game_row.black_player_id is distinct from p_player_id)
     or turn_side not in ('w','b') then
    raise exception 'It is not your turn';
  end if;
  if p_move_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$'
     or length(p_move_san) not between 2 and 24
     or length(p_next_fen) not between 20 and 110 then
    raise exception 'Invalid move';
  end if;
  if p_finished and p_result not in ('1-0','0-1','1/2-1/2') then
    raise exception 'Invalid game result';
  end if;
  if not p_finished and p_result is not null then
    raise exception 'Nonterminal moves cannot have a result';
  end if;
  now_ts := pg_catalog.clock_timestamp();
  clock_w := game_row.clock_white_ms;
  clock_b := game_row.clock_black_ms;
  if game_row.clock_mode <> 'off' and game_row.clock_turn_started_at is not null then
    elapsed := greatest(0,
      floor(extract(epoch from now_ts-game_row.clock_turn_started_at)*1000)::bigint);
    remaining := greatest(0, (case when turn_side='w' then clock_w else clock_b end)-elapsed);
    if remaining=0 then
      update public.chess_games
      set status='finished',end_reason='timeout',result=case when turn_side='w' then '0-1' else '1-0' end,
          clock_white_ms=case when turn_side='w' then 0 else clock_w end,
          clock_black_ms=case when turn_side='b' then 0 else clock_b end,
          clock_turn_started_at=null,updated_at=now_ts
      where id=p_game_id;
      return 0;
    end if;
    if turn_side='w' then
      clock_w := remaining;
      if game_row.clock_mode='move3' then clock_b:=180000; end if;
    else
      clock_b := remaining;
      if game_row.clock_mode='move3' then clock_w:=180000; end if;
    end if;
  end if;
  select count(*)::integer+1 into next_ply from public.chess_moves where game_id=p_game_id;
  next_status:=case when p_finished then 'finished' else 'active' end;
  update public.chess_games
  set current_fen=p_next_fen,status=next_status,result=p_result,updated_at=now_ts,
      clock_white_ms=clock_w,clock_black_ms=clock_b,
      clock_turn_started_at=case when p_finished or game_row.clock_mode='off' then null else now_ts end
  where id=p_game_id;
  insert into public.chess_moves (game_id,player_id,ply,move_uci,move_san,fen_after)
    values(p_game_id,p_player_id,next_ply,p_move_uci,p_move_san,p_next_fen);
  return next_ply;
end;
$$;

-- Either participant can finalize an expired clock; the deadline is checked using database time.
create or replace function public.chess_claim_timeout(p_game_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare g public.chess_games%rowtype; v_uid uuid:=(select auth.uid());
        side text; elapsed bigint; remaining bigint; at_ts timestamptz;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id<>v_uid and g.black_player_id is distinct from v_uid)
    then raise exception 'Only players in this match can claim a timeout'; end if;
  if g.status<>'active' or g.clock_mode='off' or g.clock_turn_started_at is null
     or g.black_player_id is null then return false; end if;
  at_ts:=pg_catalog.clock_timestamp();
  side:=split_part(g.current_fen,' ',2);
  if side not in ('w','b') then return false; end if;
  elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
  remaining:=case when side='w' then g.clock_white_ms else g.clock_black_ms end;
  if elapsed<remaining then return false; end if;
  update public.chess_games
  set status='finished',end_reason='timeout',result=case when side='w' then '0-1' else '1-0' end,
      clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
      clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
      clock_turn_started_at=null,updated_at=at_ts
  where id=p_game_id;
  return true;
end;
$$;
revoke all on function public.chess_claim_timeout(uuid) from public,anon;
grant execute on function public.chess_claim_timeout(uuid) to authenticated;
commit;
