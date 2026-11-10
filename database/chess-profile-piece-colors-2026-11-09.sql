-- Store each signed-in player's preferred computer/practice piece color.
-- The existing piece_color column stores that player's own pieces.
-- Existing UPDATE RLS restricts writes to auth.uid() = chess_profiles.id.
ALTER TABLE public.chess_profiles
  ADD COLUMN IF NOT EXISTS practice_opponent_color text;

ALTER TABLE public.chess_profiles
  ADD CONSTRAINT chess_profiles_practice_opponent_color_hex
  CHECK (practice_opponent_color IS NULL OR practice_opponent_color ~ '^#[0-9A-Fa-f]{6}$');
