// Настройки подключения к Supabase.
// Сюда кладутся ТОЛЬКО публичные значения: адрес проекта и publishable (anon) ключ.
// Они видны всем по замыслу — данные защищены правилами базы (RLS), см. supabase/schema.sql.
// НИКОГДА не вставляйте сюда service_role / secret ключ.
window.PULT_CONFIG = Object.freeze({
  url: "",   // например "https://abcd1234.supabase.co"
  key: ""    // publishable / anon key
});
