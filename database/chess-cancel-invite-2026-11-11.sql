-- 2026-11-11: cancel your own invitation that nobody has joined yet. The game is marked replaced,
-- which the chess_games_drop_replaced trigger deletes; any pending challenge pointing at it is cancelled.
create or replace function public.chess_cancel_invite(p_game_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare caller uuid := (select auth.uid());
begin
  if caller is null then raise exception 'Sign in first'; end if;
  update public.chess_challenges set status='canceled', responded_at=now()
    where game_id=p_game_id and challenger_id=caller and status='pending';
  update public.chess_games set status='finished', end_reason='replaced', updated_at=now()
    where id=p_game_id and white_player_id=caller and black_player_id is null and status='waiting';
  return found;
end $$;
revoke all on function public.chess_cancel_invite(uuid) from public, anon;
grant execute on function public.chess_cancel_invite(uuid) to authenticated;
