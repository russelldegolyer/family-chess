-- Players can keep chatting after a game ends (e.g. "good game", "rematch?"); spectators unchanged.
drop policy if exists chess_chat_messages_players_send on public.chess_chat_messages;
create policy chess_chat_messages_players_send on public.chess_chat_messages for insert to authenticated
with check (
  sender_id = (select auth.uid()) and exists (
    select 1 from public.chess_games game
     where game.id = chess_chat_messages.game_id
       and game.status in ('active', 'finished')
       and game.black_player_id is not null and game.white_player_id is not null
       and ((select auth.uid()) = game.white_player_id or (select auth.uid()) = game.black_player_id)));
