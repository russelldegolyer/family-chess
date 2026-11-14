-- Typed clocks + "when time runs out" (2026-11-13).
-- Modes: 'off', 'm<N>' = N minutes each (1-180), 's<N>' = N seconds per move (5-600).
-- Legacy '10m','12m','15m','move60' stay valid for games already stored.
-- clock_expiry: 'end' (game ends), 'sec60' (switch to 60 s per move), 'pawn' (opponent removes a pawn, +3:00).
-- Pawn trade (your own pawn for +1:30) is allowed at 10 seconds or less, only with a minutes clock + pawn rule.

create or replace function public.chess_clock_valid(m text) returns boolean
 language sql immutable set search_path to '' as $$
  select coalesce(m ~ '^(off|10m|12m|15m|move60|m([1-9]|[1-9][0-9]|1[0-7][0-9]|180)|s([5-9]|[1-9][0-9]|[1-5][0-9][0-9]|600))$', false)
$$;
create or replace function public.chess_clock_total_ms(m text) returns bigint
 language sql immutable set search_path to '' as $$
  select case when m in ('10m','12m','15m') then left(m,2)::bigint*60000
              when m ~ '^m[0-9]+$' then substr(m,2)::bigint*60000 else null end
$$;
create or replace function public.chess_clock_move_ms(m text) returns bigint
 language sql immutable set search_path to '' as $$
  select case when m='move60' then 60000::bigint
              when m ~ '^s[0-9]+$' then substr(m,2)::bigint*1000 else null end
$$;

alter table public.chess_profiles add column if not exists clock_expiry text not null default 'pawn';
alter table public.chess_games add column if not exists clock_expiry text not null default 'pawn';
alter table public.chess_profiles drop constraint if exists chess_profile_clock_preference_check;
alter table public.chess_profiles add constraint chess_profile_clock_preference_check check (public.chess_clock_valid(clock_preference));
alter table public.chess_profiles drop constraint if exists chess_profile_clock_expiry_check;
alter table public.chess_profiles add constraint chess_profile_clock_expiry_check check (clock_expiry in ('end','sec60','pawn'));
alter table public.chess_games drop constraint if exists chess_game_clock_mode_check;
alter table public.chess_games add constraint chess_game_clock_mode_check check (public.chess_clock_valid(clock_mode));
alter table public.chess_games drop constraint if exists chess_game_clock_expiry_check;
alter table public.chess_games add constraint chess_game_clock_expiry_check check (clock_expiry in ('end','sec60','pawn'));

-- One place decides what happens when the side to move runs out of time (row already locked by the caller).
create or replace function public.chess_clock_expire(p_game_id uuid, p_side text, p_at timestamptz) returns text
 language plpgsql security definer set search_path to '' as $$
declare g public.chess_games%rowtype;
begin
  select * into g from public.chess_games where id=p_game_id;
  if public.chess_clock_move_ms(g.clock_mode) is not null or g.clock_expiry='end' then
    update public.chess_games set status='finished',result=case when p_side='w' then '0-1' else '1-0' end,
      end_reason='timeout',clock_state='running',clock_paused_by=null,clock_penalty_side=null,
      clock_white_ms=case when p_side='w' then 0 else g.clock_white_ms end,
      clock_black_ms=case when p_side='b' then 0 else g.clock_black_ms end,
      clock_white_bonus_ms=0,clock_black_bonus_ms=0,clock_turn_started_at=null,updated_at=p_at where id=p_game_id;
    return 'timeout';
  end if;
  if g.clock_expiry='sec60' then
    update public.chess_games set clock_mode='s60',clock_state='running',clock_paused_by=null,clock_penalty_side=null,
      clock_white_ms=60000,clock_black_ms=60000,clock_white_bonus_ms=0,clock_black_bonus_ms=0,
      clock_turn_started_at=p_at,updated_at=p_at where id=p_game_id;
    return 'switched';
  end if;
  update public.chess_games set clock_state='penalty',clock_penalty_side=p_side,
    clock_white_ms=case when p_side='w' then 0 else g.clock_white_ms end,
    clock_black_ms=case when p_side='b' then 0 else g.clock_black_ms end,
    clock_turn_started_at=null,updated_at=p_at where id=p_game_id;
  return 'penalty';
end;$$;
revoke all on function public.chess_clock_expire(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.chess_clock_expire(uuid,text,timestamptz) to service_role;

create or replace function public.chess_clock_initialize()
 returns trigger language plpgsql set search_path to '' as $function$
declare v_mode text; v_exp text; v_ms bigint;
begin
  if tg_op='INSERT' then
    select clock_preference, clock_expiry into v_mode, v_exp from public.chess_profiles where id=coalesce(new.white_player_id,new.black_player_id);
    new.clock_mode:=case when public.chess_clock_valid(v_mode) then v_mode else 'off' end;
    new.clock_expiry:=coalesce(v_exp,'pawn');
    v_ms:=coalesce(public.chess_clock_total_ms(new.clock_mode),public.chess_clock_move_ms(new.clock_mode),0);
    new.clock_white_ms:=v_ms;new.clock_black_ms:=v_ms;
    new.clock_state:='running';
    new.clock_turn_started_at:=null;   -- starts with the first move
  elsif old.status='waiting' and new.status='active' and new.black_player_id is not null and new.white_player_id is not null then
    if new.clock_mode<>'off' then new.clock_state:='running'; new.clock_turn_started_at:=null; end if;
  end if;
  return new;
end;$function$;

create or replace function public.chess_claim_timeout(p_game_id uuid)
 returns boolean language plpgsql security definer set search_path to '' as $function$
declare g public.chess_games%rowtype; v_uid uuid:=(select auth.uid()); side text;elapsed bigint;remaining bigint;at_ts timestamptz;
begin
 if v_uid is null then raise exception 'Sign in first';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or (g.white_player_id is distinct from v_uid and g.black_player_id is distinct from v_uid)
   then raise exception 'Only players in this match can claim a timeout'; end if;
 if g.status<>'active' or g.clock_mode='off' or g.clock_state<>'running'
   or g.clock_turn_started_at is null or g.black_player_id is null then return false;end if;
 at_ts:=pg_catalog.clock_timestamp();
 side:=split_part(g.current_fen,' ',2);
 if side not in ('w','b') then return false;end if;
 elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
 remaining:=case when side='w' then g.clock_white_ms else g.clock_black_ms end;
 if elapsed<remaining then return false;end if;
 perform public.chess_clock_expire(p_game_id, side, at_ts);
 return true;
end;$function$;

create or replace function public.chess_commit_validated_move(p_game_id uuid, p_player_id uuid, p_expected_fen text, p_move_uci text, p_move_san text, p_next_fen text, p_finished boolean, p_result text)
 returns integer language plpgsql set search_path to '' as $function$
declare g public.chess_games%rowtype;side text;at_ts timestamptz;elapsed bigint;
  remaining bigint;cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;next_ply integer;per_move bigint;
begin
 if current_user<>'service_role' then raise exception 'Not authorized';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or g.status<>'active' then raise exception 'Game not active';end if;
 if g.clock_state<>'running' then raise exception 'Game paused; cannot move';end if;
 if g.current_fen is distinct from p_expected_fen then raise exception 'Position changed: refresh before moving';end if;
 side:=split_part(p_expected_fen,' ',2);
 if (side='w' and g.white_player_id is distinct from p_player_id)
   or (side='b' and g.black_player_id is distinct from p_player_id)
   or side not in ('w','b') then raise exception 'Not your turn';end if;
 if p_move_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$'
   or length(p_move_san) not between 2 and 24
   or length(p_next_fen) not between 20 and 110 then raise exception 'Invalid move';end if;
 if p_finished and p_result not in ('1-0','0-1','1/2-1/2') then raise exception 'Invalid game result';end if;
 if not p_finished and p_result is not null then raise exception 'Nonterminal move cannot set result';end if;
 at_ts:=pg_catalog.clock_timestamp();cw:=g.clock_white_ms;cb:=g.clock_black_ms;
 bonus_w:=g.clock_white_bonus_ms;bonus_b:=g.clock_black_bonus_ms;
 per_move:=public.chess_clock_move_ms(g.clock_mode);
 if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
   elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
   remaining:=greatest(0,(case when side='w' then cw else cb end)-elapsed);
   if remaining=0 then perform public.chess_clock_expire(p_game_id, side, at_ts); return 0; end if;
   if side='w' then cw:=remaining;else cb:=remaining;end if;
 end if;
 if per_move is not null then
   if side='w' then cb:=per_move;else cw:=per_move;end if;
   bonus_w:=0;bonus_b:=0;
 end if;
 select count(*)::int+1 into next_ply from public.chess_moves where game_id=p_game_id;
 update public.chess_games set current_fen=p_next_fen,
   status=case when p_finished then 'finished' else 'active' end,
   result=p_result,updated_at=at_ts,
   clock_white_ms=cw,clock_black_ms=cb,
   clock_white_bonus_ms=bonus_w,clock_black_bonus_ms=bonus_b,
   clock_turn_started_at=case when p_finished or g.clock_mode='off' then null else at_ts end
 where id=p_game_id;
 insert into public.chess_moves(game_id,player_id,ply,move_uci,move_san,fen_after)
 values(p_game_id,p_player_id,next_ply,p_move_uci,p_move_san,p_next_fen);
 return next_ply;
end;$function$;

create or replace function public.chess_toggle_clock_pause(p_game_id uuid)
 returns text language plpgsql security definer set search_path to '' as $function$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid()); at_ts timestamptz; side text; elapsed bigint; remain bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can pause the game'; end if;
  if g.status<>'active' or g.black_player_id is null then raise exception 'Game must be active'; end if;
  if g.clock_state='penalty' then raise exception 'Opponent must choose a pawn first'; end if;
  at_ts:=pg_catalog.clock_timestamp();
  if g.clock_state='paused' then
    update public.chess_games set clock_state='running',clock_paused_by=null,
      clock_turn_started_at=case when g.clock_mode='off' or not public.chess_game_has_moves(p_game_id) then null else at_ts end,
      updated_at=at_ts where id=p_game_id;
    return 'running';
  end if;
  if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
    side:=split_part(g.current_fen,' ',2);
    elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
    remain:=greatest(0,(case when side='w' then g.clock_white_ms else g.clock_black_ms end)-elapsed);
    if remain=0 then return public.chess_clock_expire(p_game_id, side, at_ts); end if;
    update public.chess_games set clock_state='paused',clock_paused_by=u,
      clock_white_ms=case when side='w' then remain else g.clock_white_ms end,
      clock_black_ms=case when side='b' then remain else g.clock_black_ms end,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  else
    update public.chess_games set clock_state='paused',clock_paused_by=u,clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  end if;
  return 'paused';
end;$function$;

drop function if exists public.chess_change_clock(uuid,text);
create or replace function public.chess_change_clock(p_game_id uuid, p_mode text, p_expiry text default null)
 returns text language plpgsql security definer set search_path to '' as $function$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid());
  at_ts timestamptz:=pg_catalog.clock_timestamp(); side text; elapsed bigint:=0;
  w bigint; b bigint; old_total bigint; new_total bigint; new_move bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if not public.chess_clock_valid(p_mode) then raise exception 'Invalid clock selection'; end if;
  if p_expiry is not null and p_expiry not in ('end','sec60','pawn') then raise exception 'Invalid time-out rule'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can change the clock'; end if;
  if g.status<>'active' then raise exception 'Game must be active'; end if;
  if g.clock_state='penalty' then raise exception 'Finish the pawn choice first'; end if;
  if p_expiry is not null and p_expiry<>g.clock_expiry then
    update public.chess_games set clock_expiry=p_expiry, updated_at=at_ts where id=p_game_id;
  end if;
  if g.clock_mode=p_mode then return p_mode; end if;
  side:=split_part(g.current_fen,' ',2);
  w:=coalesce(g.clock_white_ms,0); b:=coalesce(g.clock_black_ms,0);
  if g.clock_mode<>'off' and g.clock_state='running' and g.clock_turn_started_at is not null then
    elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
    if side='w' then w:=greatest(0,w-elapsed); else b:=greatest(0,b-elapsed); end if;
  end if;
  old_total:=public.chess_clock_total_ms(g.clock_mode);
  new_total:=public.chess_clock_total_ms(p_mode);
  new_move:=public.chess_clock_move_ms(p_mode);
  if old_total is not null and new_total is not null then
    w:=greatest(1000,w+new_total-old_total); b:=greatest(1000,b+new_total-old_total);
  elsif new_move is not null then w:=new_move; b:=new_move;
  elsif new_total is not null then w:=new_total; b:=new_total;
  else w:=null; b:=null; end if;
  update public.chess_games set clock_mode=p_mode, clock_white_ms=w, clock_black_ms=b,
    clock_turn_started_at=case when p_mode='off' or g.clock_state<>'running' or not public.chess_game_has_moves(p_game_id) then null else at_ts end,
    updated_at=at_ts where id=p_game_id;
  return p_mode;
end;$function$;
revoke all on function public.chess_change_clock(uuid,text,text) from public, anon;
grant execute on function public.chess_change_clock(uuid,text,text) to authenticated;

-- Pawn trade: minutes clock + pawn rule only, at 10 seconds or less. Saves accept the typed modes.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.chess_commit_clock_action(uuid,uuid,text,text,text,text)'::regprocedure);
  d := replace(d, $r$if g.clock_mode not in ('10m','12m','15m') then raise exception 'Pawn exchanges require a normal timed game';end if;$r$,
                  $r$if public.chess_clock_total_ms(g.clock_mode) is null or g.clock_expiry<>'pawn' then raise exception 'Pawn trades need a minutes clock with the pawn rule';end if;$r$);
  d := replace(d, $r$if remaining>=30000 then raise exception 'You may trade a pawn only below 30 seconds';end if;$r$,
                  $r$if remaining>10000 then raise exception 'You can trade a pawn at 10 seconds or less';end if;$r$);
  if position('chess_clock_total_ms' in d)=0 or position('remaining>10000' in d)=0 then raise exception 'pawn patch did not apply'; end if;
  execute d;
  d := pg_get_functiondef('public.chess_save_local_game(text,text[],text[],text,text,integer,text,text,uuid,text,jsonb,jsonb)'::regprocedure);
  d := replace(d, $r$not (p_clock->>'mode' in ('off','10m','12m','15m','move60'))$r$, $r$not public.chess_clock_valid(p_clock->>'mode')$r$);
  if position('chess_clock_valid' in d)=0 then raise exception 'local save patch did not apply'; end if;
  execute d;
  d := pg_get_functiondef('public.chess_save_online_game(uuid,uuid)'::regprocedure);
  d := replace(d, $r$jsonb_build_object('mode',g.clock_mode,'w',w,'b',b)$r$, $r$jsonb_build_object('mode',g.clock_mode,'w',w,'b',b,'expiry',g.clock_expiry)$r$);
  if position('''expiry''' in d)=0 then raise exception 'online save patch did not apply'; end if;
  execute d;
end $$;
