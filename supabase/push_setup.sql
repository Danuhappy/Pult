-- Pulse: включение пуш-уведомлений (то же, что части 1–3). Supabase → SQL Editor → Run.
create extension if not exists pg_net;
create extension if not exists pg_cron;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.push_config (id int primary key default 1 check (id = 1), vapid_public text, vapid_private jsonb, cron_secret text not null default encode(extensions.gen_random_bytes(32), 'hex'));
insert into private.push_config (id) values (1) on conflict do nothing;
alter table private.push_config enable row level security;
revoke all on private.push_config from public, anon, authenticated;
create table if not exists public.push_subs (id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique check (length(endpoint) < 1000 and endpoint ~ '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'), p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'), auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'), tz text not null default 'Europe/Moscow' check (length(tz) < 64 and tz ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'), created_at timestamptz not null default now());
create index if not exists push_subs_user on public.push_subs(user_id);
alter table public.push_subs enable row level security;
alter table public.push_subs force row level security;
revoke all on public.push_subs from anon;
revoke insert, update on public.push_subs from authenticated;
grant select, delete on public.push_subs to authenticated;
drop policy if exists push_subs_select on public.push_subs;
drop policy if exists push_subs_delete on public.push_subs;
create policy push_subs_select on public.push_subs for select to authenticated using (user_id = (select auth.uid()));
create policy push_subs_delete on public.push_subs for delete to authenticated using (user_id = (select auth.uid()));
create table if not exists public.push_sent (user_id uuid not null references auth.users(id) on delete cascade, key text not null check (length(key) < 200), sent_at timestamptz not null default now(), primary key (user_id, key));
alter table public.push_sent enable row level security;
alter table public.push_sent force row level security;
revoke all on public.push_sent from anon, authenticated;
select 'Часть 1 готова' as result;
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_tz text) returns void language plpgsql security definer set search_path = '' as $f$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if (select count(*) from public.push_subs where user_id = auth.uid() and endpoint <> p_endpoint) >= 10 then raise exception 'too many devices' using errcode = '54000'; end if;
  insert into public.push_subs (user_id, endpoint, p256dh, auth, tz) values (auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_tz, ''), 'Europe/Moscow'))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, tz = excluded.tz, created_at = now();
end $f$;
revoke all on function public.push_subscribe(text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(text, text, text, text) to authenticated;
create or replace function public.push_admin_config() returns jsonb language sql security definer set search_path = '' as $f$ select jsonb_build_object('vapid_public', vapid_public, 'vapid_private', vapid_private, 'cron_secret', cron_secret) from private.push_config where id = 1 $f$;
create or replace function public.push_admin_set_vapid(p_public text, p_private jsonb) returns jsonb language sql security definer set search_path = '' as $f$ update private.push_config set vapid_public = coalesce(vapid_public, p_public), vapid_private = coalesce(vapid_private, p_private) where id = 1 returning jsonb_build_object('vapid_public', vapid_public, 'vapid_private', vapid_private) $f$;
revoke all on function public.push_admin_config() from public, anon, authenticated;
revoke all on function public.push_admin_set_vapid(text, jsonb) from public, anon, authenticated;
grant execute on function public.push_admin_config() to service_role;
grant execute on function public.push_admin_set_vapid(text, jsonb) to service_role;
select 'Часть 2 готова' as result;
select cron.unschedule(jobid) from cron.job where jobname in ('pulse-push-tick', 'pulse-push-cleanup');
select cron.schedule('pulse-push-tick', '* * * * *', $j$ select net.http_post(url := 'https://xhvamuaxrhshfouztqfn.supabase.co/functions/v1/push', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from private.push_config where id = 1)), body := '{"action":"tick"}'::jsonb, timeout_milliseconds := 25000) $j$);
select cron.schedule('pulse-push-cleanup', '17 3 * * *', $j$ delete from public.push_sent where sent_at < now() - interval '3 days' $j$);
select 'Часть 3 готова: уведомления настроены' as result;
