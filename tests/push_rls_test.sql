\set ON_ERROR_STOP 0
\set QUIET 1
insert into auth.users values ('33333333-3333-3333-3333-333333333333','carol@test'),('44444444-4444-4444-4444-444444444444','dave@test');
create temp table presults(name text, ok boolean);
grant all on presults to anon, authenticated, service_role;
\set P256 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'

-- Кэрол подписывает свой телефон
set role authenticated; set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select public.push_subscribe('https://web.push.apple.com/carol-device', :'P256', 'BTBZMqHH6r4Tts7J_aSIgg', 'Europe/Moscow');
insert into presults select 'Кэрол видит свою подписку', count(*)=1 from public.push_subs;
insert into presults select 'Владелец подписки — Кэрол', (select user_id from public.push_subs)='33333333-3333-3333-3333-333333333333';
do $$ begin insert into public.push_subs(user_id,endpoint,p256dh,auth) values ('44444444-4444-4444-4444-444444444444','https://web.push.apple.com/x','BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4','BTBZMqHH6r4Tts7J_aSIgg'); insert into presults values ('Нельзя вставить подписку напрямую (в обход функции)', false); exception when insufficient_privilege then insert into presults values ('Нельзя вставить подписку напрямую (в обход функции)', true); end $$;
do $$ begin perform public.push_subscribe('https://evil.example.com/steal', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', 'UTC'); insert into presults values ('Чужой адрес вместо push-сервиса отклоняется', false); exception when check_violation then insert into presults values ('Чужой адрес вместо push-сервиса отклоняется', true); end $$;

-- Дэйв не видит и не удаляет подписку Кэрол
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
insert into presults select 'Дэйв НЕ видит подписку Кэрол', count(*)=0 from public.push_subs;
with d as (delete from public.push_subs returning 1) insert into presults select 'Дэйв НЕ может удалить подписку Кэрол', count(*)=0 from d;
do $$ begin perform 1 from public.push_sent; insert into presults values ('Журнал отправок закрыт для пользователей', false); exception when insufficient_privilege then insert into presults values ('Журнал отправок закрыт для пользователей', true); end $$;
do $$ begin perform public.push_admin_config(); insert into presults values ('Ключи VAPID недоступны пользователю', false); exception when insufficient_privilege then insert into presults values ('Ключи VAPID недоступны пользователю', true); end $$;
do $$ begin perform public.push_admin_set_vapid('x','{}'); insert into presults values ('Пользователь не может подменить ключи', false); exception when insufficient_privilege then insert into presults values ('Пользователь не может подменить ключи', true); end $$;
do $$ begin perform 1 from private.push_config; insert into presults values ('Закрытая схема недоступна пользователю', false); exception when insufficient_privilege then insert into presults values ('Закрытая схема недоступна пользователю', true); end $$;

-- гость
set role anon; reset request.jwt.claim.sub;
do $$ begin perform public.push_subscribe('https://web.push.apple.com/g', 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg', 'UTC'); insert into presults values ('Гость не может подписаться', false); exception when insufficient_privilege then insert into presults values ('Гость не может подписаться', true); end $$;
do $$ begin perform 1 from public.push_subs; insert into presults values ('Гость не читает подписки', false); exception when insufficient_privilege then insert into presults values ('Гость не читает подписки', true); end $$;

-- сервер (service_role) читает ключи; секрет расписания создан
set role service_role;
insert into presults select 'Сервер получает настройки и секрет расписания', length(public.push_admin_config()->>'cron_secret') = 64;
select public.push_admin_set_vapid('PUB1', '{"d":"1"}');
select public.push_admin_set_vapid('PUB2', '{"d":"2"}');
insert into presults select 'Ключи VAPID нельзя перезаписать после создания', public.push_admin_config()->>'vapid_public' = 'PUB1';

-- удаление аккаунта удаляет подписки
reset role; delete from auth.users where id='33333333-3333-3333-3333-333333333333';
insert into presults select 'Удаление аккаунта удаляет его подписки', count(*)=0 from public.push_subs;

\pset footer off
select case when ok then 'OK  ' else 'FAIL' end as "итог", name as "проверка" from presults;
select count(*) filter (where ok) as passed, count(*) filter (where not ok or ok is null) as failed from presults;
\set ON_ERROR_STOP 1
do $$ begin if exists (select 1 from presults where ok is not true) then raise exception 'push RLS test failed'; end if; end $$;
