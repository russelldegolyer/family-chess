-- Chess: resigning in the first 3 moves (6 half-moves or fewer) removes the game instead of scoring it;
-- invitations stay open 70 s (notification still says 60 s, to cover delivery delay).
-- Applied 2026-11-12 as migration chess_early_resign_invite_70s. Touches public.chess_* only.
create or replace function public.chess_resign_game(p_game_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_uid uuid := (select auth.uid()); v_game public.chess_games%rowtype; v_result text; v_plies int;
begin
  if v_uid is null then raise exception 'Sign in to resign a game'; end if;
  select * into v_game from public.chess_games where id=p_game_id for update;
  if not found then raise exception 'Game not found'; end if;
  if v_game.status <> 'active' or v_game.black_player_id is null or v_game.white_player_id is null then
    raise exception 'Only an active two-player game can be resigned';
  end if;
  if v_uid <> v_game.white_player_id and v_uid <> v_game.black_player_id then
    raise exception 'Only a player in this match can resign';
  end if;
  select count(*) into v_plies from public.chess_moves where game_id=p_game_id;
  if v_plies <= 6 then
    delete from public.chess_games where id=p_game_id;
    return 'deleted';
  end if;
  v_result := case when v_uid=v_game.white_player_id then '0-1' else '1-0' end;
  update public.chess_games set status='finished', result=v_result, end_reason='resignation', updated_at=now()
  where id=p_game_id and status='active';
  return v_result;
end;$$;

alter table public.chess_challenges alter column expires_at set default (now() + interval '70 seconds');

-- One-time cleanup: earlier games resigned within the first 3 moves never count.
delete from public.chess_games g where g.status='finished' and g.end_reason='resignation'
  and (select count(*) from public.chess_moves m where m.game_id=g.id) <= 6;
