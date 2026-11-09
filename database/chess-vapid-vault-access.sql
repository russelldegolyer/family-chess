-- VAPID credentials are encrypted in Supabase Vault, never committed to git.
-- This narrowly scoped getter is callable by the service role only.
create or replace function public.chess_vapid_config()
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare payload jsonb;
begin
 if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
   raise exception 'not authorized' using errcode='42501';
 end if;
 select pg_catalog.jsonb_build_object(
  'publicKey',(select decrypted_secret from vault.decrypted_secrets where name='chess_web_push_public_v1'),
  'privateKey',(select decrypted_secret from vault.decrypted_secrets where name='chess_web_push_private_v1')
 ) into payload;
 return payload;
end $$;
revoke all on function public.chess_vapid_config() from public,anon,authenticated;
grant execute on function public.chess_vapid_config() to service_role;
