-- 2026-11-10: abandoned matches (closed because a player opened a newer invite or
-- challenge) are not kept. Applied live; existing ones were deleted once.
create or replace function public.chess_drop_replaced_game()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chess_games where id = new.id;
  return null;
end $$;
revoke all on function public.chess_drop_replaced_game() from public, anon, authenticated;

drop trigger if exists chess_games_drop_replaced on public.chess_games;
create trigger chess_games_drop_replaced
  after update of end_reason on public.chess_games
  for each row when (new.end_reason = 'replaced')
  execute function public.chess_drop_replaced_game();

delete from public.chess_games where end_reason = 'replaced';
