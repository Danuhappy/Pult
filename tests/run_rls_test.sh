#!/usr/bin/env bash
# Поднимает временный PostgreSQL, эмулирует Supabase, накатывает schema.sql и гоняет rls_test.sql.
set -euo pipefail
BIN=$(ls -d /usr/lib/postgresql/*/bin | tail -1)
D=$(mktemp -d); PORT=55433
cd "$(dirname "$0")/.."
"$BIN/initdb" -D "$D" -U postgres -A trust >/dev/null
"$BIN/pg_ctl" -D "$D" -o "-p $PORT -k $D -c listen_addresses=''" -l "$D/log" start >/dev/null
trap '"$BIN/pg_ctl" -D "$D" stop -m fast >/dev/null; rm -rf "$D"' EXIT
P="psql -X -q -h $D -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1"
$P -f tests/supabase_emulation.sql
$P -f supabase/schema.sql
$P -f supabase/schema.sql   # повторный запуск не должен ломаться
psql -X -h "$D" -p $PORT -U postgres -d postgres -f tests/rls_test.sql
# пуш-уведомления (pg_net и pg_cron есть только в Supabase — здесь их пропускаем)
grep -v '^create extension if not exists pg_' supabase/push.sql > "$D/push.sql"
$P -f "$D/push.sql"; $P -f "$D/push.sql"   # повторный запуск не должен ломаться
psql -X -h "$D" -p $PORT -U postgres -d postgres -f tests/push_rls_test.sql
# автозагрузка здоровья из «Команд» iPhone
$P -f supabase/health.sql; $P -f supabase/health.sql   # повторный запуск не должен ломаться
psql -X -h "$D" -p $PORT -U postgres -d postgres -f tests/health_rls_test.sql
