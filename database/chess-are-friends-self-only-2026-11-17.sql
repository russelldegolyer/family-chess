-- chess_are_friends answers only about the caller's own friendships (2026-11-17).
-- Signed-in callers must be one of the two ids; server-side callers (no auth.uid()) are unchanged.
create or replace function public.chess_are_friends(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path to '' as $function$
  select p_a is not null and p_b is not null
    and ((select auth.uid()) is null or (select auth.uid()) in (p_a, p_b))
    and exists(select 1 from public.chess_friendships
      where user_a=least(p_a,p_b) and user_b=greatest(p_a,p_b) and status='accepted');
$function$;
