-- раз в минуту будим функцию отправки напоминаний (секрет берётся из закрытой таблицы)
select cron.unschedule(jobid) from cron.job where jobname = 'pulse-push-tick';
select cron.schedule('pulse-push-tick', '* * * * *', $job$
  select net.http_post(
    url := 'https://xhvamuaxrhshfouztqfn.supabase.co/functions/v1/push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select cron_secret from private.push_config where id = 1)),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 25000)
$job$);
-- журнал отправок старше 3 дней не нужен
select cron.unschedule(jobid) from cron.job where jobname = 'pulse-push-cleanup';
select cron.schedule('pulse-push-cleanup', '17 3 * * *', $job$ delete from public.push_sent where sent_at < now() - interval '3 days' $job$);
