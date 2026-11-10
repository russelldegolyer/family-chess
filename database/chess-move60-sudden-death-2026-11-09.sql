-- Chess clock rules: pawn +1:30 and pawn -3:00 penalties are exclusive
-- to 10m/12m/15m games. Each move60 turn is exactly 60s; expiry is a loss.
-- Applied to Supabase on 2026-11-09, retained here for version control.
-- chess_claim_timeout
CREATE OR REPLACE FUNCTION public.chess_claim_timeout(p_game_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.chess_games%rowtype; v_uid uuid:=(select auth.uid());
        side text;elapsed bigint;remaining bigint;at_ts timestamptz;
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
 if g.clock_mode='move60' then
  update public.chess_games set status='finished',result=case when side='w' then '0-1' else '1-0' end,
 end_reason='timeout',clock_state='running',clock_paused_by=null,clock_penalty_side=null,
 clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
 clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
 clock_white_bonus_ms=0,clock_black_bonus_ms=0,clock_turn_started_at=null,updated_at=at_ts
 where id=p_game_id;
  return true;
 end if;
 update public.chess_games set clock_state='penalty',clock_penalty_side=side,
   clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
   clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
   clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
 return true;
end;$function$;

-- chess_commit_clock_action
CREATE OR REPLACE FUNCTION public.chess_commit_clock_action(p_game_id uuid, p_player_id uuid, p_kind text, p_square text, p_expected_fen text, p_next_fen text)
 RETURNS bigint
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.chess_games%rowtype; actor_side text;turn_side text;victim text;
  at_ts timestamptz;elapsed bigint;remaining bigint;nextfen text;
  pawnchar text;payload_kind text;next_ply integer;action_id bigint;
  cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;
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
 if g.clock_mode not in ('10m','12m','15m') then raise exception 'Pawn exchanges require a normal timed game';end if;
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
   if remaining>=30000 then raise exception 'You may trade a pawn only below 30 seconds';end if;
   nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,actor_side,true);
   if actor_side='w' then cw:=remaining+90000;
   else cb:=remaining+90000;end if;
   payload_kind:='sacrifice';
 elsif p_kind='penalty' then
   if g.clock_state<>'penalty' or g.clock_penalty_side is null then
     raise exception 'No pending pawn penalty';end if;
   victim:=g.clock_penalty_side;
   if actor_side=victim or turn_side<>victim then raise exception 'Only the opponent chooses the pawn';end if;
   if p_square is null then
     -- No pawn remains: restore play, without penalizing a different piece.
     if g.current_fen ~ (case when victim='w' then 'P' else 'p' end) then
       raise exception 'Choose an available pawn';end if;
     nextfen:=g.current_fen;payload_kind:='waiver';
   else
     nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,victim,false);
     payload_kind:='penalty';
   end if;
   if victim='w' then cw:=180000;else cb:=180000;end if;
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

-- chess_commit_validated_move
CREATE OR REPLACE FUNCTION public.chess_commit_validated_move(p_game_id uuid, p_player_id uuid, p_expected_fen text, p_move_uci text, p_move_san text, p_next_fen text, p_finished boolean, p_result text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.chess_games%rowtype;side text;at_ts timestamptz;elapsed bigint;
  remaining bigint;cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;next_ply integer;
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
 if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
   elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
   remaining:=greatest(0,(case when side='w' then cw else cb end)-elapsed);
   if remaining=0 then
     if g.clock_mode='move60' then
       update public.chess_games set status='finished',result=case when side='w' then '0-1' else '1-0' end,
 end_reason='timeout',clock_state='running',clock_paused_by=null,clock_penalty_side=null,
 clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
 clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
 clock_white_bonus_ms=0,clock_black_bonus_ms=0,clock_turn_started_at=null,updated_at=at_ts
 where id=p_game_id;
       return 0;
     end if;
     update public.chess_games set clock_state='penalty',clock_penalty_side=side,
       clock_white_ms=case when side='w' then 0 else cw end,
       clock_black_ms=case when side='b' then 0 else cb end,
       clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
     return 0;
   end if;
   if side='w' then cw:=remaining;else cb:=remaining;end if;
   if g.clock_mode='move60' then
     if side='w' then cb:=60000;else cw:=60000;end if;
     bonus_w:=0;bonus_b:=0;
   end if;
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

-- chess_toggle_clock_pause
CREATE OR REPLACE FUNCTION public.chess_toggle_clock_pause(p_game_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid());
  at_ts timestamptz; side text; elapsed bigint; remain bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can pause the game'; end if;
  if g.status<>'active' or g.black_player_id is null then
    raise exception 'Game must be active'; end if;
  if g.clock_state='penalty' then raise exception 'Opponent must choose a pawn first'; end if;
  at_ts:=pg_catalog.clock_timestamp();
  if g.clock_state='paused' then
    update public.chess_games set clock_state='running',clock_paused_by=null,
      clock_turn_started_at=case when g.clock_mode='off' then null else at_ts end,
      updated_at=at_ts where id=p_game_id;
    return 'running';
  end if;
  if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
    side:=split_part(g.current_fen,' ',2);
    elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
    remain:=greatest(0,(case when side='w' then g.clock_white_ms else g.clock_black_ms end)-elapsed);
    if remain=0 then
      if g.clock_mode='move60' then
        update public.chess_games set status='finished',result=case when side='w' then '0-1' else '1-0' end,
 end_reason='timeout',clock_state='running',clock_paused_by=null,clock_penalty_side=null,
 clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
 clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
 clock_white_bonus_ms=0,clock_black_bonus_ms=0,clock_turn_started_at=null,updated_at=at_ts
 where id=p_game_id;
        return 'timeout';
      end if;
      update public.chess_games set clock_state='penalty',clock_penalty_side=side,
        clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
        clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
        clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
      return 'penalty';
    end if;
    update public.chess_games set clock_state='paused',clock_paused_by=u,
      clock_white_ms=case when side='w' then remain else g.clock_white_ms end,
      clock_black_ms=case when side='b' then remain else g.clock_black_ms end,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  else
    update public.chess_games set clock_state='paused',clock_paused_by=u,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  end if;
  return 'paused';
end;$function$;
