\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values ('55555555-5555-5555-5555-555555555555','erin@test'),('66666666-6666-6666-6666-666666666666','frank@test') on conflict do nothing;
create temp table hresults(name text, ok boolean);
create temp table htok(who text, t text);
grant all on hresults, htok to anon, authenticated;

-- Эрин получает ключ, у Фрэнка есть свои данные о здоровье
set role authenticated; set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
insert into public.items(col,id,data) values ('health', to_char((now() at time zone 'Europe/Moscow')::date,'YYYY-MM-DD'), '{"steps":111}');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into public.items(col,id,data) values ('health', to_char((now() at time zone 'Europe/Moscow')::date,'YYYY-MM-DD'), '{"water":5,"mood":4,"sleep":6}');
insert into htok select 'erin', public.health_token_new();
insert into hresults select 'Ключ выдаётся и длинный', length(t) = 54 from htok;
insert into hresults select 'Видно, что автозагрузка включена', public.health_token_info() ? 'created';
do $$ begin perform 1 from private.health_tokens; insert into hresults values ('Таблица ключей закрыта для пользователей', false); exception when insufficient_privilege then insert into hresults values ('Таблица ключей закрыта для пользователей', true); end $$;
do $$ begin insert into public.items(user_id,col,id,data) values ('66666666-6666-6666-6666-666666666666','health','2020-01-01','{}'); insert into hresults select 'Пользователь не пишет в чужой кабинет (user_id подменяется)', (select user_id from public.items where id='2020-01-01') = '55555555-5555-5555-5555-555555555555'; end $$;

-- команда iPhone (гость с ключом) присылает данные
set role anon; reset request.jwt.claim.sub;
select public.health_ingest(token := (select t from htok), steps := '"8 342"', sleep := '"7:30"', weight := '"82,4"');
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into hresults select 'Шаги, сон и вес записались Эрин', data->>'steps'='8342' and data->>'sleep'='7.50' and data->>'weight'='82.4' from public.items where col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date,'YYYY-MM-DD');
insert into hresults select 'Вода и настроение не стёрлись', data->>'water'='5' and data->>'mood'='4' from public.items where col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date,'YYYY-MM-DD');
insert into hresults select 'Видно время последней загрузки', public.health_token_info()->>'used' is not null;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
insert into hresults select 'Данные Фрэнка не тронуты', (select data from public.items where col='health')::text = '{"steps": 111}';
set role anon; reset request.jwt.claim.sub;
-- разные форматы чисел
select public.health_ingest(token := (select t from htok), steps := '[3000, 2500]', sleep := '27000', day := to_char((now() at time zone 'Europe/Moscow')::date - 1,'YYYY-MM-DD'));
select public.health_ingest(token := (select t from htok), sleep := '450', day := to_char((now() at time zone 'Europe/Moscow')::date - 2,'DD.MM.YYYY'));
select public.health_ingest(token := (select t from htok), sleep := '"7 ч 30 мин"', day := to_char((now() at time zone 'Europe/Moscow')::date - 3,'YYYY-MM-DD'));
select public.health_ingest(token := (select t from htok), sleep := '"6h 45m"', day := to_char((now() at time zone 'Europe/Moscow')::date - 4,'YYYY-MM-DD'));
reset role;
insert into hresults select 'Сон текстом «7 ч 30 мин»', data->>'sleep'='7.50' from public.items where user_id='55555555-5555-5555-5555-555555555555' and col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date - 3,'YYYY-MM-DD');
insert into hresults select 'Сон текстом «6h 45m»', data->>'sleep'='6.75' from public.items where user_id='55555555-5555-5555-5555-555555555555' and col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date - 4,'YYYY-MM-DD');
insert into hresults select 'Список шагов складывается, сон в секундах переводится в часы', data->>'steps'='5500' and data->>'sleep'='7.50' from public.items where user_id='55555555-5555-5555-5555-555555555555' and col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date - 1,'YYYY-MM-DD');
insert into hresults select 'Сон в минутах и дата ДД.ММ.ГГГГ', data->>'sleep'='7.50' from public.items where user_id='55555555-5555-5555-5555-555555555555' and col='health' and id=to_char((now() at time zone 'Europe/Moscow')::date - 2,'YYYY-MM-DD');
set role anon;
do $$ begin perform public.health_ingest(token := 'pulse_wrong', steps := '100'); insert into hresults values ('Неверный ключ отклоняется', false); exception when invalid_authorization_specification then insert into hresults values ('Неверный ключ отклоняется', true); end $$;
do $$ begin perform public.health_ingest(token := null, steps := '100'); insert into hresults values ('Пустой ключ отклоняется', false); exception when invalid_authorization_specification then insert into hresults values ('Пустой ключ отклоняется', true); end $$;
do $$ begin perform public.health_ingest(token := (select t from htok), steps := '"abc"', weight := '5000'); insert into hresults values ('Мусор и нереальные значения не записываются', false); exception when invalid_parameter_value then insert into hresults values ('Мусор и нереальные значения не записываются', true); end $$;
do $$ begin perform public.health_ingest(token := (select t from htok), steps := '100', day := '2001-01-01'); insert into hresults values ('Старые даты не принимаются', false); exception when invalid_parameter_value then insert into hresults values ('Старые даты не принимаются', true); end $$;
do $$ begin perform 1 from public.items; insert into hresults values ('Гость не читает данные', false); exception when insufficient_privilege then insert into hresults values ('Гость не читает данные', true); end $$;
do $$ begin insert into public.items(user_id,col,id,data) values ('55555555-5555-5555-5555-555555555555','health','x','{}'); insert into hresults values ('Гость не пишет напрямую', false); exception when insufficient_privilege then insert into hresults values ('Гость не пишет напрямую', true); end $$;
do $$ begin perform public.health_token_new(); insert into hresults values ('Гость не получает ключ', false); exception when insufficient_privilege then insert into hresults values ('Гость не получает ключ', true); end $$;
-- лимит частоты
reset role; update private.health_tokens set win_calls = 60, win_start = now() where user_id = '55555555-5555-5555-5555-555555555555'; set role anon;
do $$ begin perform public.health_ingest(token := (select t from htok), steps := '100'); insert into hresults values ('Не больше 60 загрузок в час', false); exception when program_limit_exceeded then insert into hresults values ('Не больше 60 загрузок в час', true); end $$;
-- новый ключ отменяет старый, отключение удаляет ключ
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select public.health_token_new();
set role anon; reset request.jwt.claim.sub;
do $$ begin perform public.health_ingest(token := (select t from htok), steps := '100'); insert into hresults values ('Старый ключ перестаёт работать после замены', false); exception when invalid_authorization_specification then insert into hresults values ('Старый ключ перестаёт работать после замены', true); end $$;
set role authenticated; set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select public.health_token_revoke();
insert into hresults select 'Отключение удаляет ключ', public.health_token_info() is null;
reset role; reset request.jwt.claim.sub;

\pset footer off
select case when ok then 'OK  ' else 'FAIL' end as "итог", name as "проверка" from hresults;
select count(*) filter (where ok) as passed, count(*) filter (where not ok or ok is null) as failed from hresults;
\set ON_ERROR_STOP 1
do $$ begin if exists (select 1 from hresults where ok is not true) or (select count(*) from hresults) < 20 then raise exception 'health test failed'; end if; end $$;
