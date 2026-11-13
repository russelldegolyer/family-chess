-- Either player can switch sides before the first move of an online game (a fresh game, not a resumed save).
create or replace function public.chess_swap_sides(p_game_id uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare u uuid := (select auth.uid()); g public.chess_games;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id = p_game_id for update;
  if g.id is null or u not in (coalesce(g.white_player_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(g.black_player_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Not your game';
  end if;
  if g.status not in ('active', 'waiting') then raise exception 'This game is over'; end if;
  if coalesce(g.resumed_plies, 0) > 0 or g.start_fen is not null then raise exception 'Sides are fixed in a saved game'; end if;
  if exists (select 1 from public.chess_moves where game_id = p_game_id)
     or exists (select 1 from public.chess_clock_actions where game_id = p_game_id) then
    raise exception 'Sides can only be switched before the first move';
  end if;
  update public.chess_games
     set white_player_id = g.black_player_id, black_player_id = g.white_player_id, updated_at = now()
   where id = p_game_id;
  return case when g.white_player_id = u then 'b' else 'w' end;
end;
$$;
revoke all on function public.chess_swap_sides(uuid) from public, anon;
grant execute on function public.chess_swap_sides(uuid) to authenticated;
