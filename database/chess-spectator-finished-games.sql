-- Keep spectator access through checkmate so live viewers can see the final position.
drop policy if exists chess_games_read on public.chess_games;
create policy chess_games_read on public.chess_games for select to authenticated
using (white_player_id=(select auth.uid()) or black_player_id=(select auth.uid())
       or (status in ('active','finished') and black_player_id is not null));
drop policy if exists chess_moves_read on public.chess_moves;
create policy chess_moves_read on public.chess_moves for select to authenticated
using (exists(select 1 from public.chess_games g where g.id=chess_moves.game_id
  and (g.white_player_id=(select auth.uid()) or g.black_player_id=(select auth.uid())
       or (g.status in ('active','finished') and g.black_player_id is not null))));
