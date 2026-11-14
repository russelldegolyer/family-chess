-- "End" a game (2026-11-13): either player can end a waiting or active game. It never counts as a win,
-- loss or draw. It is marked end_reason='ended' (result null) so the other player's app sees it end at once,
-- then ended/replaced games are deleted on the next End (moves and chat go with them via ON DELETE CASCADE).
create or replace function public.chess_end_game(p_game_id uuid) returns boolean
 language plpgsql security definer set search_path to '' as $$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid());
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found then return false; end if;
  if g.white_player_id is distinct from u and g.black_player_id is distinct from u then raise exception 'Only a player can end this game'; end if;
  if g.status='finished' and g.end_reason is distinct from 'ended' then raise exception 'This game is already over'; end if;
  update public.chess_games set status='finished', result=null, end_reason='ended', clock_turn_started_at=null,
    clock_state='running', clock_penalty_side=null, clock_paused_by=null, updated_at=pg_catalog.clock_timestamp() where id=p_game_id;
  update public.chess_challenges set status='canceled', responded_at=pg_catalog.clock_timestamp() where game_id=p_game_id and status='pending';
  delete from public.chess_games where end_reason in ('ended','replaced') and result is null
    and updated_at < pg_catalog.clock_timestamp() - interval '2 minutes'
    and (white_player_id=u or black_player_id=u);
  return true;
end $$;
revoke all on function public.chess_end_game(uuid) from public, anon;
grant execute on function public.chess_end_game(uuid) to authenticated;
