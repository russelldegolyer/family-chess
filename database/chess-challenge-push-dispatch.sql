alter table public.chess_challenges add column if not exists push_sent_at timestamptz;
-- Do not permit even authenticated clients to modify push_sent_at:
revoke insert, update, delete on public.chess_challenges from authenticated,anon;
