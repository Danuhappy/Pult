# Pulse

Личный кабинет на каждый день: задачи, привычки, календарь, здоровье, финансы с аналитикой и обязательными платежами (подписки, кредиты, ипотека), заметки с группами и стикерами, доски на обзоре.
У каждого пользователя свой аккаунт и свои данные — другие их не видят.

**Сайт:** https://danuhappy.github.io/Pult/

## Из чего состоит

- `index.html`, `app.js`, `style.css` — сам сайт (без сторонних библиотек).
- `bank.js` — разбор выписок любых банков (PDF, CSV, Excel) прямо в браузере; `vendor/pdfjs/` — чтение PDF.
- `config.js` — публичный адрес базы Supabase и publishable-ключ.
- `supabase/schema.sql` — таблица и правила доступа (RLS).
- `tests/` — проверки безопасности.
- `SECURITY.md` — как защищены аккаунты и что проверено.

## Как запустить свою копию

1. Создать проект на [supabase.com](https://supabase.com).
2. SQL Editor → вставить `supabase/schema.sql` → Run.
3. Authentication → URL Configuration → Site URL = адрес сайта.
4. Вписать в `config.js` Project URL и publishable/anon key.
5. Settings → Pages → Source: GitHub Actions. Каждый push в `main` публикует сайт.

## Проверки

```bash
bash tests/run_rls_test.sh            # изоляция аккаунтов на PostgreSQL
python3 -m http.server 8099 &         # затем
PW=<путь к playwright> node tests/e2e.cjs   # сквозной тест в браузере
```
