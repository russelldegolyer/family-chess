-- Pawn rule for the per-move ("Seconds") clock too. Applied live 2026-11-14.
-- Per-move clock (s<N>):
--   pawn trade: allowed at min(10 s, half the move time) or less; trading a pawn passes the turn and the
--               next move starts with the full per-move time (it's how you avoid losing on time).
--   time runs out with the pawn rule: the opponent removes one of your pawns, then you get the full
--               per-move time to make your move.   (Game ends rule: still a loss on time.)
-- Minutes clocks are unchanged (+1:30 trade at 10 s, back to 3:00 after a penalty; '60s a move' option).
create or replace function public.chess_clock_expire(p_game_id uuid, p_side text, p_at timestamp with time zone)
 returns text language plpgsql security definer set search_path to '' as $function$
declare g public.chess_games%rowtype;
begin
  select * into g from public.chess_games where id=p_game_id;
  if g.clock_expiry='end' or (public.chess_clock_move_ms(g.clock_mode) is not null and g.clock_expiry<>'pawn') then
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
end;$function$;

create or replace function public.chess_commit_clock_action(p_game_id uuid, p_player_id uuid, p_kind text, p_square text, p_expected_fen text, p_next_fen text)
 returns bigint language plpgsql set search_path to '' as $function$
declare g public.chess_games%rowtype; actor_side text;turn_side text;victim text;
  at_ts timestamptz;elapsed bigint;remaining bigint;nextfen text;
  payload_kind text;next_ply integer;action_id bigint;
  cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;mv bigint;win bigint;
begin
 if current_user<>'service_role' then raise exception 'Not authorized';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or g.status<>'active' or g.black_player_id is null then raise exception 'Game not active';end if;
 if g.current_fen is distinct from p_expected_fen then raise exception 'Board changed; refresh';end if;
 if p_player_id=g.white_player_id then actor_side:='w';
 elsif p_player_id=g.black_player_id then actor_side:='b';
 else raise exception 'Only a player can use a pawn action';end if;
 turn_side:=split_part(g.current_fen,' ',2);
 if turn_side not in ('w','b') then raise exception 'Invalid turn';end if;
 at_ts:=pg_catalog.clock_timestamp();
 cw:=g.clock_white_ms;cb:=g.clock_black_ms;
 bonus_w:=g.clock_white_bonus_ms;bonus_b:=g.clock_black_bonus_ms;
 mv:=public.chess_clock_move_ms(g.clock_mode);            -- per-move clock (null for minutes clocks)
 if g.clock_expiry<>'pawn' or (mv is null and public.chess_clock_total_ms(g.clock_mode) is null) then
   raise exception 'Pawn trades need a timer with the pawn rule';end if;
 win:=case when mv is null then 10000 else least(10000,mv/2) end;
 if p_kind='sacrifice' then
   if g.clock_mode='off' or g.clock_state<>'running' or actor_side<>turn_side
      or g.clock_turn_started_at is null then raise exception 'Not your timed turn';end if;
   elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
   remaining:=greatest(0,(case when actor_side='w' then cw else cb end)-elapsed);
   if remaining=0 then
     update public.chess_games set clock_state='penalty',clock_penalty_side=turn_side,
       clock_white_ms=case when turn_side='w' then 0 else cw end,
       clock_black_ms=case when turn_side='b' then 0 else cb end,
       clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
     return 0;
   end if;
   if remaining>win then raise exception 'You can trade a pawn at % seconds or less', win/1000;end if;
   nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,actor_side,true);
   if mv is not null then cw:=mv;cb:=mv;                  -- per-move: the next move starts fresh
   elsif actor_side='w' then cw:=remaining+90000;
   else cb:=remaining+90000;end if;
   payload_kind:='sacrifice';
 elsif p_kind='penalty' then
   if g.clock_state<>'penalty' or g.clock_penalty_side is null then
     raise exception 'No pending pawn penalty';end if;
   victim:=g.clock_penalty_side;
   if actor_side=victim or turn_side<>victim then raise exception 'Only the opponent chooses the pawn';end if;
   if p_square is null then
     if g.current_fen ~ (case when victim='w' then 'P' else 'p' end) then
       raise exception 'Choose an available pawn';end if;
     nextfen:=g.current_fen;payload_kind:='waiver';
   else
     nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,victim,false);
     payload_kind:='penalty';
   end if;
   if victim='w' then cw:=coalesce(mv,180000);else cb:=coalesce(mv,180000);end if;
 else raise exception 'Unknown pawn action';end if;
 if p_next_fen is distinct from nextfen then raise exception 'Pawn result does not match the validated board';end if;
 select count(*)::int into next_ply from public.chess_moves where game_id=p_game_id;
 update public.chess_games set current_fen=nextfen,clock_state='running',
   clock_penalty_side=null,clock_paused_by=null,clock_turn_started_at=at_ts,
   clock_white_ms=cw,clock_black_ms=cb,
   clock_white_bonus_ms=bonus_w,clock_black_bonus_ms=bonus_b,
   updated_at=at_ts where id=p_game_id;
 insert into public.chess_clock_actions(game_id,actor_id,after_ply,kind,square,fen_after)
 values(p_game_id,p_player_id,next_ply,payload_kind,p_square,nextfen)
 returning id into action_id;
 return action_id;
end;$function$;
