\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111','alice@test'),('22222222-2222-2222-2222-222222222222','bob@test');
create temp table results(name text, ok boolean) ;
grant all on results to anon, authenticated;

-- Алиса пишет свои данные
set role authenticated; set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.items(col,id,data) values ('notes','n1','{"title":"секрет Алисы"}'), ('money','m1','{"amount":100}');
insert into results select 'Алиса видит свои 2 записи', count(*)=2 from public.items;

-- Боб пытается прочитать, изменить, удалить, подделать владельца
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into results select 'Боб НЕ видит записи Алисы', count(*)=0 from public.items;
insert into results select 'Боб НЕ находит заметку Алисы по ключу', count(*)=0 from public.items where user_id='11111111-1111-1111-1111-111111111111';
with u as (update public.items set data='{"title":"взлом"}' where user_id='11111111-1111-1111-1111-111111111111' returning 1) insert into results select 'Боб НЕ может изменить записи Алисы', count(*)=0 from u;
with d as (delete from public.items where user_id='11111111-1111-1111-1111-111111111111' returning 1) insert into results select 'Боб НЕ может удалить записи Алисы', count(*)=0 from d;
-- подделка user_id при вставке: триггер должен переписать владельца на Боба
insert into public.items(user_id,col,id,data) values ('11111111-1111-1111-1111-111111111111','notes','fake','{"title":"подкинуто"}');
insert into results select 'Подделка владельца при вставке не срабатывает', (select user_id from public.items where id='fake')='22222222-2222-2222-2222-222222222222';
-- попытка «передать» свою запись Алисе через update
update public.items set user_id='11111111-1111-1111-1111-111111111111' where id='fake';
insert into results select 'Нельзя переписать свою запись на чужой аккаунт', (select user_id from public.items where id='fake')='22222222-2222-2222-2222-222222222222';
-- upsert поверх ключа Алисы
insert into public.items(col,id,data) values ('notes','n1','{"title":"затираю"}') on conflict (user_id,col,id) do update set data=excluded.data;
reset role; 
insert into results select 'Заметка Алисы не затёрта upsert-ом Боба', (select data->>'title' from public.items where user_id='11111111-1111-1111-1111-111111111111' and id='n1')='секрет Алисы';

-- Не вошедший гость
set role anon; reset request.jwt.claim.sub;
do $$ begin perform 1 from public.items; insert into results values ('Гость НЕ читает таблицу', false); exception when insufficient_privilege then insert into results values ('Гость НЕ читает таблицу', true); end $$;
do $$ begin insert into public.items(col,id,data) values ('notes','x','{}'); insert into results values ('Гость НЕ пишет в таблицу', false); exception when insufficient_privilege then insert into results values ('Гость НЕ пишет в таблицу', true); end $$;

-- Вошедший, но без идентификатора (битый токен)
set role authenticated; reset request.jwt.claim.sub;
insert into results select 'Без id в токене ничего не видно', count(*)=0 from public.items;
do $$ begin insert into public.items(col,id,data) values ('notes','y','{}'); insert into results values ('Без id в токене запись запрещена', false); exception when others then insert into results values ('Без id в токене запись запрещена', true); end $$;

-- Ограничения на данные
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin insert into public.items(col,id,data) values ('evil','z','{}'); insert into results values ('Неизвестный раздел отклоняется', false); exception when check_violation then insert into results values ('Неизвестный раздел отклоняется', true); end $$;
do $$ begin insert into public.items(col,id,data) values ('notes','<script>','{}'); insert into results values ('Опасный id отклоняется', false); exception when check_violation then insert into results values ('Опасный id отклоняется', true); end $$;
do $$ begin insert into public.items(col,id,data) values ('notes','big', jsonb_build_object('t', repeat(md5(random()::text), 3000))); insert into results values ('Слишком большая запись отклоняется', false); exception when check_violation then insert into results values ('Слишком большая запись отклоняется', true); end $$;
do $$ begin insert into public.items(col,id,data) values ('notes','arr','[1,2]'); insert into results values ('Не-объект в data отклоняется', false); exception when check_violation then insert into results values ('Не-объект в data отклоняется', true); end $$;

-- Удаление аккаунта удаляет его данные
reset role;
delete from auth.users where id='22222222-2222-2222-2222-222222222222';
insert into results select 'Удаление аккаунта стирает его данные', count(*)=0 from public.items where user_id='22222222-2222-2222-2222-222222222222';

\pset footer off
select case when ok then 'OK  ' else 'FAIL' end as "итог", name as "проверка" from results;
select count(*) filter (where ok) as passed, count(*) filter (where not ok or ok is null) as failed from results;

\set ON_ERROR_STOP 1
do $$ begin if exists (select 1 from results where ok is not true) then raise exception 'RLS test failed'; end if; end $$;
