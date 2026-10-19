-- Пульт: схема базы для Supabase.
-- Вставить целиком в Supabase → SQL Editor → Run. Скрипт можно запускать повторно.
--
-- Модель безопасности:
--   * все данные пользователя лежат в одной таблице public.items;
--   * у каждой строки есть владелец user_id = id аккаунта Supabase Auth;
--   * Row Level Security (RLS) включена и принудительна: база сама отдаёт
--     и меняет только строки, где user_id = auth.uid() из токена входа;
--   * роль anon (не вошедший посетитель) не имеет к таблице никаких прав;
--   * user_id при записи всегда подставляется сервером из токена, подделать его нельзя.

create table if not exists public.items (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  col        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, col, id),
  constraint items_col_allowed check (col in ('tasks','habits','health','money','subs','notes','board','meta')),
  constraint items_id_format   check (id ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  constraint items_data_object check (jsonb_typeof(data) = 'object'),
  constraint items_data_size   check (pg_column_size(data) <= 32768)
);

alter table public.items enable row level security;
alter table public.items force row level security;

-- Права: анонимам ничего, вошедшим — только CRUD (дальше решают политики RLS).
revoke all on table public.items from public, anon, authenticated;
grant select, insert, update, delete on table public.items to authenticated;

drop policy if exists items_select_own on public.items;
drop policy if exists items_insert_own on public.items;
drop policy if exists items_update_own on public.items;
drop policy if exists items_delete_own on public.items;

create policy items_select_own on public.items
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy items_insert_own on public.items
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy items_update_own on public.items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy items_delete_own on public.items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Владелец строки всегда берётся из токена, даже если клиент прислал другой user_id,
-- updated_at ставит сервер, и у одного аккаунта не больше 20 000 записей.
create or replace function public.items_before_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n bigint;
begin
  -- доверенные функции базы (владелец postgres, например автозагрузка здоровья) пишут от имени владельца ключа
  if current_user = 'postgres' and auth.uid() is null and new.user_id is not null then
    null;
  elsif auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  else
    new.user_id := auth.uid();
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    select count(*) into n from public.items where user_id = new.user_id;
    if n >= 20000 then
      raise exception 'item limit reached' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.items_before_write() from public, anon, authenticated;

drop trigger if exists items_before_write on public.items;
create trigger items_before_write
  before insert or update on public.items
  for each row execute function public.items_before_write();
