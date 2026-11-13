-- Voice chat handshake runs on a PRIVATE realtime channel named chess-voice:<userA>:<userB> (ids sorted).
-- Only those two signed-in players, and only while they are friends, can listen to or send on it.
-- Scoped to the chess-voice: prefix, so no other realtime use in this shared project is affected.
create policy chess_voice_pair_listen on realtime.messages for select to authenticated
using (
  realtime.topic() like 'chess-voice:%'
  and (select auth.uid())::text in (split_part(realtime.topic(), ':', 2), split_part(realtime.topic(), ':', 3))
  and public.chess_are_friends(split_part(realtime.topic(), ':', 2)::uuid, split_part(realtime.topic(), ':', 3)::uuid)
);
create policy chess_voice_pair_send on realtime.messages for insert to authenticated
with check (
  realtime.topic() like 'chess-voice:%'
  and (select auth.uid())::text in (split_part(realtime.topic(), ':', 2), split_part(realtime.topic(), ':', 3))
  and public.chess_are_friends(split_part(realtime.topic(), ':', 2)::uuid, split_part(realtime.topic(), ':', 3)::uuid)
);
