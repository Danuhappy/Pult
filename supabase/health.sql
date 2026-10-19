-- Pulse: автозагрузка из Apple Здоровье через «Команды» iPhone.
-- Команда шлёт шаги/сон/вес с личным ключом. В базе хранится только хэш ключа.
-- Ключ даёт право ТОЛЬКО дописать шаги, сон и вес в свой день здоровья — читать данные им нельзя.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.health_tokens (user_id uuid primary key references auth.users(id) on delete cascade, token_hash text not null unique, created_at timestamptz not null default now(), used_at timestamptz, win_start timestamptz not null default now(), win_calls int not null default 0);
alter table private.health_tokens enable row level security;
revoke all on private.health_tokens from public, anon, authenticated;

-- запись в items: обычные пользователи — только от своего имени; доверенные функции базы (владелец postgres) — от имени владельца ключа
create or replace function public.items_before_write() returns trigger language plpgsql security invoker set search_path = '' as $f$
declare n bigint;
begin
  if current_user = 'postgres' and auth.uid() is null and new.user_id is not null then null;
  elsif auth.uid() is null then raise exception 'not authenticated' using errcode = '42501';
  else new.user_id := auth.uid(); end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    select count(*) into n from public.items where user_id = new.user_id;
    if n >= 20000 then raise exception 'item limit reached' using errcode = '54000'; end if;
  end if;
  return new;
end $f$;
revoke all on function public.items_before_write() from public, anon, authenticated;

-- число из того, что прислала команда: 8342 / "8 342" / "7,5" / "7:30" / список чисел (sum=true — сложить)
create or replace function private.health_num(v jsonb, sum boolean) returns numeric language plpgsql immutable set search_path = '' as $f$
declare s text; m text[]; t numeric := 0; e jsonb; x numeric;
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'array' then
    for e in select * from jsonb_array_elements(v) loop x := private.health_num(e, false); if x is not null then if not sum then return x; end if; t := t + x; end if; end loop;
    return nullif(t, 0);
  end if;
  if jsonb_typeof(v) = 'number' then return (v #>> '{}')::numeric; end if;
  if jsonb_typeof(v) <> 'string' then return null; end if;
  s := replace(regexp_replace(v #>> '{}', '[[:space:]\u00a0\u202f]', '', 'g'), ',', '.');
  m := regexp_match(s, '^([0-9]{1,2}):([0-9]{2})(:[0-9]{2})?$');
  if m is not null then return m[1]::numeric + m[2]::numeric / 60; end if;
  m := regexp_match(lower(s), '^(?:([0-9]+(?:\.[0-9]+)?)(?:ч|час[а-я]*|h|hr|hours?))?(?:([0-9]+)(?:мин[а-я]*|м|min|m))?');
  if m[1] is not null or m[2] is not null then return coalesce(m[1]::numeric, 0) + coalesce(m[2]::numeric, 0) / 60; end if;
  return substring(s from '^[0-9]+(?:\.[0-9]+)?')::numeric;
exception when others then return null;
end $f$;
revoke all on function private.health_num(jsonb, boolean) from public, anon, authenticated;

create or replace function public.health_token_new() returns text language plpgsql security definer set search_path = '' as $f$
declare t text := 'pulse_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '42501'; end if;
  insert into private.health_tokens (user_id, token_hash) values (auth.uid(), encode(extensions.digest(t, 'sha256'), 'hex'))
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), used_at = null, win_calls = 0, win_start = now();
  return t;
end $f$;
create or replace function public.health_token_info() returns jsonb language sql stable security definer set search_path = '' as $f$
  select jsonb_build_object('created', created_at, 'used', used_at) from private.health_tokens where user_id = auth.uid()
$f$;
create or replace function public.health_token_revoke() returns void language sql security definer set search_path = '' as $f$
  delete from private.health_tokens where user_id = auth.uid()
$f$;
revoke all on function public.health_token_new() from public, anon;
revoke all on function public.health_token_info() from public, anon;
revoke all on function public.health_token_revoke() from public, anon;
grant execute on function public.health_token_new() to authenticated;
grant execute on function public.health_token_info() to authenticated;
grant execute on function public.health_token_revoke() to authenticated;

create or replace function public.health_ingest(token text, steps jsonb default null, sleep jsonb default null, weight jsonb default null, day text default null) returns jsonb language plpgsql security definer set search_path = '' as $f$
declare r private.health_tokens; d date := (now() at time zone 'Europe/Moscow')::date; k text; cur jsonb; upd jsonb := '{}'; x numeric;
begin
  select * into r from private.health_tokens where token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if not found then raise exception 'Неверный ключ Pulse' using errcode = '28000'; end if;
  if r.win_start < now() - interval '1 hour' then update private.health_tokens set win_start = now(), win_calls = 1 where user_id = r.user_id;
  elsif r.win_calls >= 60 then raise exception 'Слишком часто, не больше 60 раз в час' using errcode = '54000';
  else update private.health_tokens set win_calls = win_calls + 1 where user_id = r.user_id; end if;
  if day ~ '^\d{4}-\d{2}-\d{2}$' then d := day::date; elsif day ~ '^\d{2}\.\d{2}\.\d{4}$' then d := to_date(day, 'DD.MM.YYYY'); end if;
  if d < (now() at time zone 'Europe/Moscow')::date - 7 or d > (now() at time zone 'Europe/Moscow')::date + 1 then raise exception 'Дата вне последней недели' using errcode = '22023'; end if;
  x := round(private.health_num(steps, true));
  if x > 0 and x <= 200000 then upd := upd || jsonb_build_object('steps', x::int); end if;
  x := private.health_num(sleep, true);
  if x > 24 and x <= 1440 then x := x / 60; elsif x > 1440 then x := x / 3600; end if;
  if x > 0 and x <= 24 then upd := upd || jsonb_build_object('sleep', round(x, 2)); end if;
  x := private.health_num(weight, false);
  if x >= 20 and x <= 400 then upd := upd || jsonb_build_object('weight', round(x, 1)); end if;
  if upd = '{}' then raise exception 'Нет данных: проверьте шаги, сон и вес в команде' using errcode = '22023'; end if;
  k := to_char(d, 'YYYY-MM-DD');
  select data into cur from public.items where user_id = r.user_id and col = 'health' and id = k;
  insert into public.items (user_id, col, id, data) values (r.user_id, 'health', k, coalesce(cur, '{}') || upd)
  on conflict (user_id, col, id) do update set data = excluded.data;
  update private.health_tokens set used_at = now() where user_id = r.user_id;
  return jsonb_build_object('ok', true, 'day', k) || upd;
end $f$;
revoke all on function public.health_ingest(text, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.health_ingest(text, jsonb, jsonb, jsonb, text) to anon, authenticated;
