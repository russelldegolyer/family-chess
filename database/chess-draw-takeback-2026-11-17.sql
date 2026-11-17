-- Online draw offers and takeback requests (2026-11-17).
-- One pending offer of each kind per game, cleared by any move. All writes go through these RPCs.
alter table public.chess_games add column if not exists draw_offer_by uuid;
alter table public.chess_games add column if not exists takeback_by uuid;

create or replace function public.chess_offer(p_game_id uuid, p_kind text)
returns text language plpgsql security definer set search_path to '' as $$
declare u uuid:=(select auth.uid()); g public.chess_games%rowtype; last_mover uuid; n int;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('draw','takeback') then raise exception 'Unknown offer'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or g.status<>'active' or g.black_player_id is null then raise exception 'This game is not active'; end if;
  if u<>g.white_player_id and u<>g.black_player_id then raise exception 'Only a player can do that'; end if;
  if g.clock_state='penalty' then raise exception 'Finish the pawn choice first'; end if;
  if p_kind='draw' then
    if g.draw_offer_by is not null and g.draw_offer_by<>u then
      -- both offered: that is an agreement
      update public.chess_games set status='finished',result='1/2-1/2',end_reason='agreement',draw_offer_by=null,takeback_by=null,
        clock_turn_started_at=null,updated_at=pg_catalog.clock_timestamp() where id=p_game_id;
      return 'agreed';
    end if;
    update public.chess_games set draw_offer_by=u,updated_at=pg_catalog.clock_timestamp() where id=p_game_id;
    return 'offered';
  end if;
  select count(*)::int into n from public.chess_moves where game_id=p_game_id;
  if n=0 or n<=coalesce(g.resumed_plies,0) then raise exception 'There is no move to take back'; end if;
  select player_id into last_mover from public.chess_moves where game_id=p_game_id and ply=n;
  if last_mover is distinct from u then raise exception 'You can take back only your own last move, before your opponent replies'; end if;
  if exists(select 1 from public.chess_clock_actions where game_id=p_game_id and after_ply>=n) then
    raise exception 'A pawn was traded after that move, so it can''t be taken back'; end if;
  update public.chess_games set takeback_by=u,updated_at=pg_catalog.clock_timestamp() where id=p_game_id;
  return 'offered';
end $$;

create or replace function public.chess_answer_offer(p_game_id uuid, p_kind text, p_accept boolean)
returns text language plpgsql security definer set search_path to '' as $$
declare u uuid:=(select auth.uid()); g public.chess_games%rowtype; n int; prev text; at_ts timestamptz:=pg_catalog.clock_timestamp();
  side text; per_move bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('draw','takeback') then raise exception 'Unknown offer'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or g.status<>'active' then raise exception 'This game is not active'; end if;
  if u<>g.white_player_id and u<>g.black_player_id then raise exception 'Only a player can do that'; end if;
  if p_kind='draw' then
    if g.draw_offer_by is null then return 'gone'; end if;
    if g.draw_offer_by=u then
      update public.chess_games set draw_offer_by=null,updated_at=at_ts where id=p_game_id; return 'withdrawn'; end if;
    if not p_accept then update public.chess_games set draw_offer_by=null,updated_at=at_ts where id=p_game_id; return 'declined'; end if;
    update public.chess_games set status='finished',result='1/2-1/2',end_reason='agreement',draw_offer_by=null,takeback_by=null,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
    return 'agreed';
  end if;
  if g.takeback_by is null then return 'gone'; end if;
  if g.takeback_by=u then update public.chess_games set takeback_by=null,updated_at=at_ts where id=p_game_id; return 'withdrawn'; end if;
  if not p_accept then update public.chess_games set takeback_by=null,updated_at=at_ts where id=p_game_id; return 'declined'; end if;
  select count(*)::int into n from public.chess_moves where game_id=p_game_id;
  if n=0 or (select player_id from public.chess_moves where game_id=p_game_id and ply=n) is distinct from g.takeback_by
     or exists(select 1 from public.chess_clock_actions where game_id=p_game_id and after_ply>=n) then
    update public.chess_games set takeback_by=null,updated_at=at_ts where id=p_game_id; return 'gone'; end if;
  prev:=coalesce((select fen_after from public.chess_moves where game_id=p_game_id and ply=n-1),
                 g.start_fen,'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  -- the last clock action before that move may have changed the board: use it when it is newer
  prev:=coalesce((select fen_after from public.chess_clock_actions where game_id=p_game_id and after_ply=n-1 order by id desc limit 1),prev);
  side:=split_part(prev,' ',2);
  per_move:=public.chess_clock_move_ms(g.clock_mode);
  delete from public.chess_moves where game_id=p_game_id and ply=n;
  update public.chess_games set current_fen=prev,takeback_by=null,draw_offer_by=null,updated_at=at_ts,
    clock_white_ms=case when per_move is not null and side='w' then per_move else clock_white_ms end,
    clock_black_ms=case when per_move is not null and side='b' then per_move else clock_black_ms end,
    clock_turn_started_at=case when clock_mode='off' or clock_state<>'running' then clock_turn_started_at else at_ts end
  where id=p_game_id;
  return 'taken';
end $$;

revoke all on function public.chess_offer(uuid,text) from public, anon;
revoke all on function public.chess_answer_offer(uuid,text,boolean) from public, anon;
grant execute on function public.chess_offer(uuid,text) to authenticated;
grant execute on function public.chess_answer_offer(uuid,text,boolean) to authenticated;

create or replace function public.chess_clear_offers_on_move() returns trigger language plpgsql set search_path to '' as $$
begin
  -- a takeback request ends with any move; a draw offer stays open until the other player moves
  update public.chess_games set takeback_by=null,
    draw_offer_by=case when draw_offer_by=new.player_id then draw_offer_by else null end
   where id=new.game_id and (draw_offer_by is not null or takeback_by is not null);
  return new;
end $$;
drop trigger if exists chess_moves_clear_offers on public.chess_moves;
create trigger chess_moves_clear_offers after insert on public.chess_moves for each row execute function public.chess_clear_offers_on_move();
