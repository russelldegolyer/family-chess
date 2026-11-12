-- Accuracy per player (0-100), worked out on a player's device after the game and saved once.
alter table public.chess_games
  add column if not exists accuracy_white numeric(4,1) check (accuracy_white between 0 and 100),
  add column if not exists accuracy_black numeric(4,1) check (accuracy_black between 0 and 100);

-- Either player may record the scores for a finished game; the first values saved stay.
create or replace function public.chess_set_game_accuracy(p_game_id uuid, p_white numeric, p_black numeric)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare u uuid := (select auth.uid()); g public.chess_games;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id = p_game_id;
  if g.id is null or u not in (coalesce(g.white_player_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(g.black_player_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'Not your game';
  end if;
  if g.status <> 'finished' then return false; end if;
  if p_white is not null and (p_white < 0 or p_white > 100) then raise exception 'Bad value'; end if;
  if p_black is not null and (p_black < 0 or p_black > 100) then raise exception 'Bad value'; end if;
  update public.chess_games
     set accuracy_white = coalesce(accuracy_white, round(p_white, 1)),
         accuracy_black = coalesce(accuracy_black, round(p_black, 1))
   where id = p_game_id;
  return true;
end;
$$;
revoke all on function public.chess_set_game_accuracy(uuid, numeric, numeric) from public, anon;
grant execute on function public.chess_set_game_accuracy(uuid, numeric, numeric) to authenticated;
