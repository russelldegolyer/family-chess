-- Online clocks wait for the first move (2026-11-13). Before, the turn timer started the moment both
-- players were seated, so White lost time before anyone had moved. Now clock_turn_started_at stays null
-- until a move is committed (chess_commit_validated_move then starts the other side's clock), and
-- resuming a pause or changing the clock before the first move leaves it stopped.

create or replace function public.chess_clock_initialize()
 returns trigger language plpgsql set search_path to '' as $function$
declare v_mode text; v_ms bigint;
begin
  if tg_op='INSERT' then
    select clock_preference into v_mode from public.chess_profiles where id=coalesce(new.white_player_id,new.black_player_id);
    new.clock_mode:=coalesce(v_mode,'off');
    v_ms:=case new.clock_mode when '10m' then 600000 when '12m' then 720000
      when '15m' then 900000 when 'move60' then 60000 else 0 end;
    new.clock_white_ms:=v_ms;new.clock_black_ms:=v_ms;
    new.clock_state:='running';
    new.clock_turn_started_at:=null;   -- starts with the first move
  elsif old.status='waiting' and new.status='active' and new.black_player_id is not null and new.white_player_id is not null then
    if new.clock_mode<>'off' then
      new.clock_state:='running';
      new.clock_turn_started_at:=null; -- starts with the first move
    end if;
  end if;
  return new;
end;$function$;

create or replace function public.chess_game_has_moves(p_game_id uuid)
 returns boolean language sql stable set search_path to '' as $$
  select exists(select 1 from public.chess_moves where game_id=p_game_id)
$$;
revoke all on function public.chess_game_has_moves(uuid) from public, anon, authenticated;

-- Pause/resume and clock changes: the timer only (re)starts once a move has been played.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.chess_toggle_clock_pause(uuid)'::regprocedure);
  d := replace(d, $r$clock_turn_started_at=case when g.clock_mode='off' then null else at_ts end,$r$,
                  $r$clock_turn_started_at=case when g.clock_mode='off' or not public.chess_game_has_moves(p_game_id) then null else at_ts end,$r$);
  if position('chess_game_has_moves' in d) = 0 then raise exception 'pause patch did not apply'; end if;
  execute d;
  d := pg_get_functiondef('public.chess_change_clock(uuid,text)'::regprocedure);
  d := replace(d, $r$clock_turn_started_at=case when p_mode='off' or g.clock_state<>'running' then null else at_ts end,$r$,
                  $r$clock_turn_started_at=case when p_mode='off' or g.clock_state<>'running' or not public.chess_game_has_moves(p_game_id) then null else at_ts end,$r$);
  if position('chess_game_has_moves' in d) = 0 then raise exception 'change patch did not apply'; end if;
  execute d;
end $$;
