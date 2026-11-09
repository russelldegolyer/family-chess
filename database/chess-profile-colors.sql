alter table public.chess_profiles
  add column if not exists piece_color text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chess_profiles_piece_color_hex' and conrelid = 'public.chess_profiles'::regclass
  ) then
    alter table public.chess_profiles
      add constraint chess_profiles_piece_color_hex
      check (piece_color is null or piece_color ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;