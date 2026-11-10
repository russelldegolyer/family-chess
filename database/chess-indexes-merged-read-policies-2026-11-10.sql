-- 2026-11-10: indexes for chess foreign keys, and one read policy per table
-- (merges *_read and *_watch_live with OR; same access as before). Applied live.
create index if not exists chess_challenges_game_id_idx on public.chess_challenges (game_id);
create index if not exists chess_chat_messages_sender_id_idx on public.chess_chat_messages (sender_id);
create index if not exists chess_clock_actions_actor_id_idx on public.chess_clock_actions (actor_id);
create index if not exists chess_games_white_player_id_idx on public.chess_games (white_player_id);
create index if not exists chess_games_black_player_id_idx on public.chess_games (black_player_id);
create index if not exists chess_moves_player_id_idx on public.chess_moves (player_id);
create index if not exists chess_spectator_messages_sender_id_idx on public.chess_spectator_messages (sender_id);

drop policy if exists chess_games_read on public.chess_games;
drop policy if exists chess_games_watch_live on public.chess_games;
create policy chess_games_read on public.chess_games for select to authenticated using (
  white_player_id = (select auth.uid())
  or black_player_id = (select auth.uid())
  or ((select auth.uid()) is not null and black_player_id is not null
      and (status = 'active' or (status = 'finished' and updated_at > now() - interval '1 hour')))
);

drop policy if exists chess_moves_read on public.chess_moves;
drop policy if exists chess_moves_watch_live on public.chess_moves;
create policy chess_moves_read on public.chess_moves for select to authenticated using (
  exists (select 1 from public.chess_games g where g.id = chess_moves.game_id and (
    g.white_player_id = (select auth.uid())
    or g.black_player_id = (select auth.uid())
    or ((select auth.uid()) is not null and g.black_player_id is not null
        and (g.status = 'active' or (g.status = 'finished' and g.updated_at > now() - interval '1 hour')))
  ))
);
