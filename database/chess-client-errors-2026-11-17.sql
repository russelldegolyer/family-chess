-- Crash reports from the app (2026-11-17). Written only through chess_report_error; read in the Supabase dashboard:
--   select created_at, message, source, page, app_version from public.chess_client_errors order by id desc limit 50;
create table if not exists public.chess_client_errors(
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  message text not null check (length(message) <= 500),
  source text check (length(source) <= 300),
  stack text check (length(stack) <= 2000),
  page text check (length(page) <= 200),
  agent text check (length(agent) <= 300),
  app_version text check (length(app_version) <= 40)
);
alter table public.chess_client_errors enable row level security;
revoke all on public.chess_client_errors from anon, authenticated;

create or replace function public.chess_report_error(p_message text, p_source text, p_stack text, p_page text, p_agent text, p_version text)
returns void language plpgsql security definer set search_path to '' as $$
declare u uuid:=(select auth.uid());
begin
  if u is null then return; end if;
  if (select count(*) from public.chess_client_errors where user_id=u and created_at>now()-interval '1 hour')>=30 then return; end if;
  insert into public.chess_client_errors(user_id,message,source,stack,page,agent,app_version)
  values(u,left(coalesce(p_message,'?'),500),left(p_source,300),left(p_stack,2000),left(p_page,200),left(p_agent,300),left(p_version,40));
  delete from public.chess_client_errors where created_at<now()-interval '60 days';
end $$;
revoke all on function public.chess_report_error(text,text,text,text,text,text) from public, anon;
grant execute on function public.chess_report_error(text,text,text,text,text,text) to authenticated;
create index if not exists chess_client_errors_user_time on public.chess_client_errors(user_id, created_at);
