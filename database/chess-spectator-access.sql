-- Spectators must be signed in. Waiting games and archived private history
-- remain participants-only; an active game is visible to other signed-in
-- members. Results remain visible for one hour after completion.
-- Move submissions remain protected by the chess-submit-move server function.
create policy chess_games_watch_live on public.chess_games
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and black_player_id is not null
    and (
      status='active'
      or (status='finished' and updated_at > now() - interval '1 hour')
    )
  );

create policy chess_moves_watch_live on public.chess_moves
  for select to authenticated
  using (
    (select auth.uid()) is not null
    and exists (
      select 1 from public.chess_games g
      where g.id = chess_moves.game_id
        and g.black_player_id is not null
        and (
          g.status='active'
          or (g.status='finished' and g.updated_at > now() - interval '1 hour')
        )
    )
  );
