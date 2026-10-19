// Функция отправки целиком, но с подставным сервером (без интернета): расписание, дубли, чужие, «мёртвые» телефоны.
let f = 0; const ok = (c: boolean, n: string) => { console.log((c ? "OK   " : "FAIL ") + n); if (!c) f++; };
let handler: (r: Request) => Promise<Response>;
(globalThis as any).Deno = { env: { get: (k: string) => ({ SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service", SUPABASE_ANON_KEY: "anon" } as any)[k] }, serve: (h: any) => { handler = h; } };
const ALICE = "11111111-1111-1111-1111-111111111111", BOB = "22222222-2222-2222-2222-222222222222";
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
const { b64u } = await import("../../supabase/functions/push/webpush.ts");
const p256dh = b64u(await crypto.subtle.exportKey("raw", ua.publicKey)), auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
const db: any = { config: { vapid_public: null, vapid_private: null, cron_secret: "s".repeat(64) }, sent: new Set<string>(),
  subs: [{ id: 1, user_id: ALICE, endpoint: "https://web.push.apple.com/alice", p256dh, auth, tz: "Europe/Moscow" },
         { id: 2, user_id: ALICE, endpoint: "https://web.push.apple.com/gone", p256dh, auth, tz: "Europe/Moscow" },
         { id: 3, user_id: BOB, endpoint: "https://fcm.googleapis.com/fcm/send/bob", p256dh, auth, tz: "Europe/Moscow" }], items: [] as any[] };
const pushes: string[] = [];
(globalThis as any).fetch = async (u: string, init: any = {}) => {
  const url = new URL(u), m = init.method || "GET", J = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s });
  if (url.host === "proj.supabase.co") {
    if (init.headers?.apikey !== "service" && !url.pathname.startsWith("/auth/")) return J({ msg: "no" }, 401);
    const p = url.pathname.replace("/rest/v1/", "");
    if (p === "rpc/push_admin_config") return J(db.config);
    if (p === "rpc/push_admin_set_vapid") { const b = JSON.parse(init.body); if (!db.config.vapid_public) { db.config.vapid_public = b.p_public; db.config.vapid_private = b.p_private; } return J(db.config); }
    if (p === "push_subs" && m === "GET") { const uid = url.searchParams.get("user_id"); return J(db.subs.filter((s: any) => !uid || s.user_id === uid.slice(3))); }
    if (p === "push_subs" && m === "DELETE") { const id = Number(url.searchParams.get("id")!.slice(3)); db.subs = db.subs.filter((s: any) => s.id !== id); return new Response(null, { status: 204 }); }
    if (p === "items") { const ids = url.searchParams.get("user_id")!.slice(4, -1).split(","); return J(db.items.filter((i: any) => ids.includes(i.user_id))); }
    if (p === "push_sent") { const [r] = JSON.parse(init.body), k = r.user_id + "|" + r.key; if (db.sent.has(k)) return J([]); db.sent.add(k); return J([r], 201); }
    if (url.pathname === "/auth/v1/user") return (init.headers.Authorization === "Bearer good-alice") ? J({ id: ALICE }) : J({ msg: "bad" }, 401);
    return J({ msg: "?" + p }, 404);
  }
  pushes.push(url.pathname); if (url.pathname === "/gone") return new Response("", { status: 410 });
  return new Response("", { status: 201 });
};
await import("../../supabase/functions/push/index.ts");
const call = (body: any, headers: any = {}) => handler(new Request("https://proj.supabase.co/functions/v1/push", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://danuhappy.github.io", ...headers }, body: JSON.stringify(body) }));
// ключ VAPID создаётся сам
const v = await (await call({ action: "vapid" })).json();
ok(typeof v.key === "string" && v.key.length === 87 && db.config.vapid_private?.d, "Ключи VAPID создаются сами при первом запуске, открытый ключ отдаётся телефону");
const v2 = await (await call({ action: "vapid" })).json(); ok(v2.key === v.key, "Ключи не меняются при повторном запросе");
// задача Алисы на текущую минуту по Москве
const now = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).reduce((a: any, p) => (a[p.type] = p.value, a), {});
db.items.push({ user_id: ALICE, col: "tasks", id: "t1", data: { title: "Секрет Алисы", date: `${now.year}-${now.month}-${now.day}`, time: `${now.hour}:${now.minute}`, done: false } });
ok((await call({ action: "tick" })).status === 403 && (await call({ action: "tick" }, { "x-cron-secret": "s".repeat(63) + "x" })).status === 403, "Без секрета расписания запуск отклоняется");
const r1 = await (await call({ action: "tick" }, { "x-cron-secret": "s".repeat(64) })).json();
ok(r1.sent === 1 && pushes.includes("/alice") && !pushes.includes("/fcm/send/bob"), "Напоминание пришло на телефон Алисы и не пришло Бобу");
ok(!db.subs.some((s: any) => s.endpoint.endsWith("/gone")), "Отключённый телефон (ответ 410) удаляется из подписок");
const before = pushes.length; const r2 = await (await call({ action: "tick" }, { "x-cron-secret": "s".repeat(64) })).json();
ok(r2.sent === 0 && pushes.length === before, "Повторный запуск в ту же минуту не присылает дубль");
// проверочное уведомление
ok((await call({ action: "test" }, { authorization: "Bearer bad" })).status === 401, "Проверочное уведомление без входа запрещено");
const t = await call({ action: "test" }, { authorization: "Bearer good-alice" });
ok(t.status === 200 && (await t.json()).sent === 1, "Проверочное уведомление приходит на свой телефон");
ok((await call({ action: "test" }, { authorization: "Bearer good-alice" })).status === 429, "Защита от слишком частых проверок");
ok(t.headers.get("access-control-allow-origin") === "https://danuhappy.github.io", "Сайт Pulse может обращаться к функции (CORS)");
ok((await call({ action: "nope" })).status === 400, "Неизвестная команда отклоняется");
console.log(f ? `FAILED ${f}` : "ALL OK"); if (f) process.exit(1);
