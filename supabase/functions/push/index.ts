// Pulse: отправка напоминаний о задачах и привычках на телефон (Web Push).
// action=vapid — открытый ключ для подписки; action=test — проверочное уведомление себе; action=tick — раз в минуту по расписанию.
import { generateVapid, sendPush, ENDPOINT_RE } from "./webpush.ts";
import { dueReminders, local } from "./reminders.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUBJECT = "mailto:pulse-app@users.noreply.github.com";
const ORIGINS = ["https://danuhappy.github.io"];

const cors = (req: Request) => {
  const o = req.headers.get("origin") ?? "";
  return { "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0], "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Vary": "Origin" };
};
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`rest ${path.split("?")[0]} ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
async function config() {
  let c = await rest("rpc/push_admin_config", { method: "POST", body: "{}" });
  if (!c.vapid_public) { const v = await generateVapid(); const s = await rest("rpc/push_admin_set_vapid", { method: "POST", body: JSON.stringify({ p_public: v.publicKey, p_private: v.privateJwk }) }); c = { ...c, ...s }; }
  return c as { vapid_public: string; vapid_private: JsonWebKey; cron_secret: string };
}
const eq = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };

// отметка «отправлено»: вернёт true только при первой попытке — так одно напоминание не придёт дважды
async function claim(user_id: string, key: string) {
  const rows = await rest("push_sent?on_conflict=user_id,key", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([{ user_id, key }]) });
  return Array.isArray(rows) && rows.length === 1;
}
type Sub = { id: number; user_id: string; endpoint: string; p256dh: string; auth: string; tz: string };
async function deliver(subs: Sub[], msg: Record<string, unknown>, c: Awaited<ReturnType<typeof config>>) {
  let sent = 0;
  for (const s of subs) {
    if (!ENDPOINT_RE.test(s.endpoint)) continue;
    try {
      const r = await sendPush(s, msg, { publicKey: c.vapid_public, privateJwk: c.vapid_private, subject: SUBJECT });
      if (r.status === 404 || r.status === 410) await rest(`push_subs?id=eq.${s.id}`, { method: "DELETE" });
      else if (r.status < 300) sent++;
      else console.log("push error", r.status, r.text);
    } catch (e) { console.log("push fail", String(e)); }
  }
  return sent;
}

async function tick(c: Awaited<ReturnType<typeof config>>) {
  const subs: Sub[] = await rest("push_subs?select=id,user_id,endpoint,p256dh,auth,tz");
  if (!subs.length) return { users: 0, sent: 0 };
  const byUser = new Map<string, Sub[]>(); subs.forEach(s => byUser.set(s.user_id, [...(byUser.get(s.user_id) || []), s]));
  const ids = [...byUser.keys()];
  const items: any[] = await rest(`items?select=user_id,col,id,data&col=in.(tasks,habits)&user_id=in.(${ids.join(",")})`);
  let sent = 0;
  for (const [uid, us] of byUser) {
    const L = local(us[us.length - 1].tz || "Europe/Moscow");
    for (const r of dueReminders(items.filter(i => i.user_id === uid), L)) {
      if (await claim(uid, r.key)) sent += await deliver(us, r.msg, c);
    }
  }
  return { users: ids.length, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  try {
    const url = new URL(req.url);
    let body: any = {}; if (req.method === "POST") { try { body = await req.json(); } catch { body = {}; } }
    const action = body.action || url.searchParams.get("action");
    if (action === "vapid") { const c = await config(); return json(req, { key: c.vapid_public }); }
    if (action === "tick") {
      const c = await config();
      if (!eq(req.headers.get("x-cron-secret") ?? "", c.cron_secret)) return json(req, { error: "forbidden" }, 403);
      return json(req, await tick(c));
    }
    if (action === "test") {
      const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
      const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON || SERVICE, Authorization: `Bearer ${token}` } });
      if (!u.ok) return json(req, { error: "unauthorized" }, 401);
      const uid = (await u.json()).id as string;
      if (!/^[0-9a-f-]{36}$/.test(uid)) return json(req, { error: "unauthorized" }, 401);
      const c = await config();
      if (!(await claim(uid, `test:${Math.floor(Date.now() / 20000)}`))) return json(req, { error: "too_often" }, 429);
      const subs: Sub[] = await rest(`push_subs?select=id,user_id,endpoint,p256dh,auth,tz&user_id=eq.${uid}`);
      if (!subs.length) return json(req, { error: "no_devices" }, 404);
      const sent = await deliver(subs, { title: "Pulse", body: "Уведомления работают ✅ Напоминания о задачах и привычках будут приходить сюда.", tag: "test", url: "#home" }, c);
      return json(req, { sent, devices: subs.length });
    }
    return json(req, { error: "unknown action" }, 400);
  } catch (e) {
    console.log("error", String(e));
    return json(req, { error: "server" }, 500);
  }
});
