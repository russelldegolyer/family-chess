-- Timed chess: 60-second turns, per-player pause, and pawn-for-time actions.
-- Events are saved separately so existing UCI move history stays intact.
begin;

alter table public.chess_profiles drop constraint if exists chess_profile_clock_preference_check;
alter table public.chess_games drop constraint if exists chess_game_clock_mode_check;
update public.chess_profiles set clock_preference='move60' where clock_preference='move3';
update public.chess_games set clock_mode='move60',
  clock_white_ms=60000,clock_black_ms=60000 where clock_mode='move3';
alter table public.chess_profiles add constraint chess_profile_clock_preference_check
  check (clock_preference in ('off','10m','12m','15m','move60'));
alter table public.chess_games add constraint chess_game_clock_mode_check
  check (clock_mode in ('off','10m','12m','15m','move60'));
alter table public.chess_games
  add column if not exists clock_state text not null default 'running',
  add column if not exists clock_paused_by uuid,
  add column if not exists clock_penalty_side text,
  add column if not exists clock_white_bonus_ms bigint not null default 0,
  add column if not exists clock_black_bonus_ms bigint not null default 0;
alter table public.chess_games add constraint chess_game_clock_state_check
  check (clock_state in ('running','paused','penalty'));
alter table public.chess_games add constraint chess_game_penalty_side_check
  check (clock_penalty_side is null or clock_penalty_side in ('w','b'));
alter table public.chess_games add constraint chess_game_bonus_check
  check (clock_white_bonus_ms>=0 and clock_black_bonus_ms>=0);

create table if not exists public.chess_clock_actions (
  id bigint generated always as identity primary key,
  game_id uuid not null references public.chess_games(id) on delete cascade,
  actor_id uuid not null references auth.users(id),
  after_ply integer not null check(after_ply>=0),
  kind text not null check(kind in ('sacrifice','penalty','waiver')),
  square text,
  fen_after text not null,
  created_at timestamptz not null default now(),
  constraint chess_clock_action_square_check
    check((kind='waiver' and square is null) or
          (kind<>'waiver' and square ~ '^[a-h][1-8]$'))
);
create index if not exists chess_clock_actions_game_sequence_idx
  on public.chess_clock_actions(game_id,id);
alter table public.chess_clock_actions enable row level security;
drop policy if exists chess_clock_actions_read on public.chess_clock_actions;
create policy chess_clock_actions_read on public.chess_clock_actions
for select to authenticated using (
 exists(select 1 from public.chess_games g where g.id=game_id
   and ((select auth.uid()) in (g.white_player_id,g.black_player_id)
     or (g.black_player_id is not null and
         (g.status='active' or (g.status='finished' and g.updated_at>now()-interval '1 hour')))))
);
grant select on public.chess_clock_actions to authenticated;

create or replace function public.chess_clock_initialize()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_mode text; v_ms bigint;
begin
  if tg_op='INSERT' then
    select clock_preference into v_mode from public.chess_profiles where id=new.white_player_id;
    new.clock_mode:=coalesce(v_mode,'off');
    v_ms:=case new.clock_mode when '10m' then 600000 when '12m' then 720000
      when '15m' then 900000 when 'move60' then 60000 else 0 end;
    new.clock_white_ms:=v_ms;new.clock_black_ms:=v_ms;
    new.clock_state:='running';
    new.clock_turn_started_at:=case when new.status='active'
      and new.black_player_id is not null and new.clock_mode<>'off'
      then pg_catalog.clock_timestamp() else null end;
  elsif old.status='waiting' and new.status='active' and new.black_player_id is not null then
    if new.clock_mode<>'off' then
      new.clock_state:='running';
      new.clock_turn_started_at:=pg_catalog.clock_timestamp();
    end if;
  end if;
  return new;
end;$$;

-- Switches either player's pause state, freezing elapsed time on the server.
create or replace function public.chess_toggle_clock_pause(p_game_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare g public.chess_games%rowtype; u uuid:=(select auth.uid());
  at_ts timestamptz; side text; elapsed bigint; remain bigint;
begin
  if u is null then raise exception 'Sign in first'; end if;
  select * into g from public.chess_games where id=p_game_id for update;
  if not found or (g.white_player_id is distinct from u and g.black_player_id is distinct from u)
    then raise exception 'Only a player can pause the game'; end if;
  if g.status<>'active' or g.black_player_id is null then
    raise exception 'Game must be active'; end if;
  if g.clock_state='penalty' then raise exception 'Opponent must choose a pawn first'; end if;
  at_ts:=pg_catalog.clock_timestamp();
  if g.clock_state='paused' then
    update public.chess_games set clock_state='running',clock_paused_by=null,
      clock_turn_started_at=case when g.clock_mode='off' then null else at_ts end,
      updated_at=at_ts where id=p_game_id;
    return 'running';
  end if;
  if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
    side:=split_part(g.current_fen,' ',2);
    elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
    remain:=greatest(0,(case when side='w' then g.clock_white_ms else g.clock_black_ms end)-elapsed);
    if remain=0 then
      update public.chess_games set clock_state='penalty',clock_penalty_side=side,
        clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
        clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
        clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
      return 'penalty';
    end if;
    update public.chess_games set clock_state='paused',clock_paused_by=u,
      clock_white_ms=case when side='w' then remain else g.clock_white_ms end,
      clock_black_ms=case when side='b' then remain else g.clock_black_ms end,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  else
    update public.chess_games set clock_state='paused',clock_paused_by=u,
      clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
  end if;
  return 'paused';
end;$$;
revoke all on function public.chess_toggle_clock_pause(uuid) from public,anon;
grant execute on function public.chess_toggle_clock_pause(uuid) to authenticated;

-- Expiration no longer awards a win. It freezes the clocks for opponent's choice.
create or replace function public.chess_claim_timeout(p_game_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare g public.chess_games%rowtype; v_uid uuid:=(select auth.uid());
        side text;elapsed bigint;remaining bigint;at_ts timestamptz;
begin
 if v_uid is null then raise exception 'Sign in first';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or (g.white_player_id is distinct from v_uid and g.black_player_id is distinct from v_uid)
   then raise exception 'Only players in this match can claim a timeout'; end if;
 if g.status<>'active' or g.clock_mode='off' or g.clock_state<>'running'
   or g.clock_turn_started_at is null or g.black_player_id is null then return false;end if;
 at_ts:=pg_catalog.clock_timestamp();
 side:=split_part(g.current_fen,' ',2);
 if side not in ('w','b') then return false;end if;
 elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
 remaining:=case when side='w' then g.clock_white_ms else g.clock_black_ms end;
 if elapsed<remaining then return false;end if;
 update public.chess_games set clock_state='penalty',clock_penalty_side=side,
   clock_white_ms=case when side='w' then 0 else g.clock_white_ms end,
   clock_black_ms=case when side='b' then 0 else g.clock_black_ms end,
   clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
 return true;
end;$$;
revoke all on function public.chess_claim_timeout(uuid) from public,anon;
grant execute on function public.chess_claim_timeout(uuid) to authenticated;

-- Compute pawn-removal FEN inside Postgres; never trust a client's suggested board.
create or replace function public.chess_clock_remove_pawn_fen(
  p_fen text,p_square text,p_side text,p_pass boolean
) returns text language plpgsql immutable security invoker set search_path='' as $$
declare parts text[];ranks text[];row text;newrow text;chunk text;ch text;
  col integer;ri integer;i integer;j integer;empty_count integer;
  expected_piece text;
begin
  if p_square !~ '^[a-h][1-8]$' then raise exception 'Invalid pawn square';end if;
  parts:=string_to_array(p_fen,' ');
  if array_length(parts,1)<>6 then raise exception 'Invalid chess position';end if;
  ranks:=string_to_array(parts[1],'/');
  if array_length(ranks,1)<>8 then raise exception 'Invalid chess board';end if;
  ri:=9-substring(p_square,2,1)::int;
  col:=ascii(substring(p_square,1,1))-96;
  row:='';
  for i in 1..length(ranks[ri]) loop
    ch:=substring(ranks[ri],i,1);
    if ch ~ '^[1-8]$' then row:=row||repeat('.',ch::int);
    else row:=row||ch;end if;
  end loop;
  if length(row)<>8 then raise exception 'Invalid chess rank';end if;
  expected_piece:=case when p_side='w' then 'P' else 'p' end;
  if substring(row,col,1)<>expected_piece then raise exception 'Select a pawn belonging to the correct player';end if;
  row:=overlay(row placing '.' from col for 1);
  newrow:='';empty_count:=0;
  for i in 1..8 loop
    ch:=substring(row,i,1);
    if ch='.' then empty_count:=empty_count+1;
    else
      if empty_count>0 then newrow:=newrow||empty_count::text;empty_count:=0;end if;
      newrow:=newrow||ch;
    end if;
  end loop;
  if empty_count>0 then newrow:=newrow||empty_count::text;end if;
  ranks[ri]:=newrow;
  parts[1]:=array_to_string(ranks,'/');
  parts[4]:='-';parts[5]:='0';
  if p_pass then
    parts[2]:=case when p_side='w' then 'b' else 'w' end;
    if p_side='b' then parts[6]:=(parts[6]::int+1)::text;end if;
  end if;
  return array_to_string(parts,' ');
end;$$;
revoke all on function public.chess_clock_remove_pawn_fen(text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.chess_clock_remove_pawn_fen(text,text,text,boolean) to service_role;

-- Service-only atomic event; called via chess-clock-action Edge Function after chess.js checks.
create or replace function public.chess_commit_clock_action(
 p_game_id uuid,p_player_id uuid,p_kind text,p_square text,p_expected_fen text,p_next_fen text
) returns bigint language plpgsql security invoker set search_path='' as $$
declare g public.chess_games%rowtype; actor_side text;turn_side text;victim text;
  at_ts timestamptz;elapsed bigint;remaining bigint;nextfen text;
  pawnchar text;payload_kind text;next_ply integer;action_id bigint;
  cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;
begin
 if current_user<>'service_role' then raise exception 'Not authorized';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or g.status<>'active' or g.black_player_id is null then raise exception 'Game not active';end if;
 if g.current_fen is distinct from p_expected_fen then raise exception 'Board changed; refresh';end if;
 if p_player_id=g.white_player_id then actor_side:='w';
 elsif p_player_id=g.black_player_id then actor_side:='b';
 else raise exception 'Only a player can use a pawn action';end if;
 turn_side:=split_part(g.current_fen,' ',2);
 if turn_side not in ('w','b') then raise exception 'Invalid turn';end if;
 at_ts:=pg_catalog.clock_timestamp();
 cw:=g.clock_white_ms;cb:=g.clock_black_ms;
 bonus_w:=g.clock_white_bonus_ms;bonus_b:=g.clock_black_bonus_ms;
 if p_kind='sacrifice' then
   if g.clock_mode='off' or g.clock_state<>'running' or actor_side<>turn_side
      or g.clock_turn_started_at is null then raise exception 'Not your timed turn';end if;
   elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
   remaining:=greatest(0,(case when actor_side='w' then cw else cb end)-elapsed);
   if remaining=0 then
     update public.chess_games set clock_state='penalty',clock_penalty_side=turn_side,
       clock_white_ms=case when turn_side='w' then 0 else cw end,
       clock_black_ms=case when turn_side='b' then 0 else cb end,
       clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
     return 0;
   end if;
   if remaining>=30000 then raise exception 'You may trade a pawn only below 30 seconds';end if;
   nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,actor_side,true);
   if g.clock_mode='move60' then
     if actor_side='w' then cw:=150000;bonus_w:=90000;cb:=60000+bonus_b;bonus_b:=0;
     else cb:=150000;bonus_b:=90000;cw:=60000+bonus_w;bonus_w:=0;end if;
   else
     if actor_side='w' then cw:=remaining+90000;
     else cb:=remaining+90000;end if;
   end if;
   payload_kind:='sacrifice';
 elsif p_kind='penalty' then
   if g.clock_state<>'penalty' or g.clock_penalty_side is null then
     raise exception 'No pending pawn penalty';end if;
   victim:=g.clock_penalty_side;
   if actor_side=victim or turn_side<>victim then raise exception 'Only the opponent chooses the pawn';end if;
   if p_square is null then
     -- No pawn remains: restore play, without penalizing a different piece.
     if g.current_fen ~ (case when victim='w' then 'P' else 'p' end) then
       raise exception 'Choose an available pawn';end if;
     nextfen:=g.current_fen;payload_kind:='waiver';
   else
     nextfen:=public.chess_clock_remove_pawn_fen(g.current_fen,p_square,victim,false);
     payload_kind:='penalty';
   end if;
   if victim='w' then cw:=180000;else cb:=180000;end if;
 else raise exception 'Unknown pawn action';end if;
 if p_next_fen is distinct from nextfen then raise exception 'Pawn result does not match the validated board';end if;
 select count(*)::int into next_ply from public.chess_moves where game_id=p_game_id;
 update public.chess_games set current_fen=nextfen,clock_state='running',
   clock_penalty_side=null,clock_paused_by=null,clock_turn_started_at=at_ts,
   clock_white_ms=cw,clock_black_ms=cb,
   clock_white_bonus_ms=bonus_w,clock_black_bonus_ms=bonus_b,
   updated_at=at_ts where id=p_game_id;
 insert into public.chess_clock_actions(game_id,actor_id,after_ply,kind,square,fen_after)
 values(p_game_id,p_player_id,next_ply,payload_kind,p_square,nextfen)
 returning id into action_id;
 return action_id;
end;$$;
revoke all on function public.chess_commit_clock_action(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.chess_commit_clock_action(uuid,uuid,text,text,text,text) to service_role;

-- Keep the existing legal-move pipeline atomic while respecting pauses, penalties, and bonuses.
create or replace function public.chess_commit_validated_move(
 p_game_id uuid,p_player_id uuid,p_expected_fen text,p_move_uci text,p_move_san text,
 p_next_fen text,p_finished boolean,p_result text
) returns integer language plpgsql security invoker set search_path='' as $$
declare g public.chess_games%rowtype;side text;at_ts timestamptz;elapsed bigint;
  remaining bigint;cw bigint;cb bigint;bonus_w bigint;bonus_b bigint;next_ply integer;
begin
 if current_user<>'service_role' then raise exception 'Not authorized';end if;
 select * into g from public.chess_games where id=p_game_id for update;
 if not found or g.status<>'active' then raise exception 'Game not active';end if;
 if g.clock_state<>'running' then raise exception 'Game paused; cannot move';end if;
 if g.current_fen is distinct from p_expected_fen then raise exception 'Position changed: refresh before moving';end if;
 side:=split_part(p_expected_fen,' ',2);
 if (side='w' and g.white_player_id is distinct from p_player_id)
   or (side='b' and g.black_player_id is distinct from p_player_id)
   or side not in ('w','b') then raise exception 'Not your turn';end if;
 if p_move_uci !~ '^[a-h][1-8][a-h][1-8][qrbn]?$'
   or length(p_move_san) not between 2 and 24
   or length(p_next_fen) not between 20 and 110 then raise exception 'Invalid move';end if;
 if p_finished and p_result not in ('1-0','0-1','1/2-1/2') then raise exception 'Invalid game result';end if;
 if not p_finished and p_result is not null then raise exception 'Nonterminal move cannot set result';end if;
 at_ts:=pg_catalog.clock_timestamp();cw:=g.clock_white_ms;cb:=g.clock_black_ms;
 bonus_w:=g.clock_white_bonus_ms;bonus_b:=g.clock_black_bonus_ms;
 if g.clock_mode<>'off' and g.clock_turn_started_at is not null then
   elapsed:=greatest(0,floor(extract(epoch from at_ts-g.clock_turn_started_at)*1000)::bigint);
   remaining:=greatest(0,(case when side='w' then cw else cb end)-elapsed);
   if remaining=0 then
     update public.chess_games set clock_state='penalty',clock_penalty_side=side,
       clock_white_ms=case when side='w' then 0 else cw end,
       clock_black_ms=case when side='b' then 0 else cb end,
       clock_turn_started_at=null,updated_at=at_ts where id=p_game_id;
     return 0;
   end if;
   if side='w' then cw:=remaining;else cb:=remaining;end if;
   if g.clock_mode='move60' then
     if side='w' then cb:=60000+bonus_b;bonus_b:=0;
     else cw:=60000+bonus_w;bonus_w:=0;end if;
   end if;
 end if;
 select count(*)::int+1 into next_ply from public.chess_moves where game_id=p_game_id;
 update public.chess_games set current_fen=p_next_fen,
   status=case when p_finished then 'finished' else 'active' end,
   result=p_result,updated_at=at_ts,
   clock_white_ms=cw,clock_black_ms=cb,
   clock_white_bonus_ms=bonus_w,clock_black_bonus_ms=bonus_b,
   clock_turn_started_at=case when p_finished or g.clock_mode='off' then null else at_ts end
 where id=p_game_id;
 insert into public.chess_moves(game_id,player_id,ply,move_uci,move_san,fen_after)
 values(p_game_id,p_player_id,next_ply,p_move_uci,p_move_san,p_next_fen);
 return next_ply;
end;$$;
revoke all on function public.chess_commit_validated_move(uuid,uuid,text,text,text,text,boolean,text)
 from public,anon,authenticated;
grant execute on function public.chess_commit_validated_move(uuid,uuid,text,text,text,text,boolean,text) to service_role;
commit;