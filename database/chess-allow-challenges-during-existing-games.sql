create or replace function public.chess_send_challenge(p_target uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); v_id uuid;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 if caller = p_target or p_target is null then raise exception 'Choose another player'; end if;
 if not exists (select 1 from public.chess_profiles where id=p_target) then raise exception 'Player not found'; end if;
 if not exists (select 1 from public.chess_profiles where id=caller) then raise exception 'Set up your player name first'; end if;
 -- The user can only have one outgoing unanswered challenge at a time.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(caller::text)::bigint);
 update public.chess_challenges set status='expired',responded_at=now()
 where status='pending' and expires_at<=now() and (challenger_id=caller or target_id=caller);
 if exists(select 1 from public.chess_challenges
  where challenger_id=caller and status='pending' and expires_at>now()) then
  raise exception 'You already have a pending challenge'; end if;
 -- Active games remain intact; players may start a separate challenge match.
 insert into public.chess_challenges(challenger_id,target_id)
 values(caller,p_target) returning id into v_id;
 return v_id;
end $$;

create or replace function public.chess_respond_challenge(p_id uuid,p_accept boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); c public.chess_challenges%rowtype; new_game uuid;
begin
 if caller is null then raise exception 'Sign in first'; end if;
 select * into c from public.chess_challenges where id=p_id for update;
 if not found or c.target_id<>caller then raise exception 'Challenge not found'; end if;
 if c.status<>'pending' then raise exception 'Challenge is no longer available'; end if;
 if c.expires_at <= clock_timestamp() then
  update public.chess_challenges set status='expired',responded_at=now() where id=p_id;
  return null;
 end if;
 if not p_accept then
  update public.chess_challenges set status='declined',responded_at=now() where id=p_id;
  return null;
 end if;
 -- Serialize acceptance across different invitations targeting this account.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(caller::text)::bigint);
 -- The newly accepted game does not alter other active matches.
 insert into public.chess_games(white_player_id,black_player_id,status)
 values(c.challenger_id,caller,'active') returning id into new_game;
 update public.chess_challenges set status='accepted',game_id=new_game,responded_at=now() where id=p_id;
 return new_game;
end $$;


revoke all on function public.chess_send_challenge(uuid),public.chess_respond_challenge(uuid,boolean) from public,anon;
grant execute on function public.chess_send_challenge(uuid),public.chess_respond_challenge(uuid,boolean) to authenticated;
