// Проверка шифрования Web Push: шифруем как сервер, расшифровываем как телефон (RFC 8291), и проверяем подпись VAPID.
import { encrypt, generateVapid, b64u, unb64u, sendPush, ENDPOINT_RE } from "../../supabase/functions/push/webpush.ts";
const te = new TextEncoder(), td = new TextDecoder();
let fails = 0; const ok = (c: boolean, n: string) => { console.log((c ? "OK   " : "FAIL ") + n); if (!c) fails++; };
const cat = (...a: Uint8Array[]) => { const o = new Uint8Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) { const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8)); }
// «телефон»
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
const uaPub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
const msg = JSON.stringify({ title: "Задача: Позвонить клиенту", body: "Сегодня в 09:30 ✅", url: "#tasks" });
const body = await encrypt(te.encode(msg), b64u(uaPub), b64u(auth));
async function decrypt(b: Uint8Array) {
  const salt = b.slice(0, 16), rs = new DataView(b.buffer, b.byteOffset + 16, 4).getUint32(0), idlen = b[20], asPub = b.slice(21, 21 + idlen), ct = b.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(te.encode("WebPush: info\0"), uaPub, asPub), 32);
  const cek = await hkdf(salt, ikm, te.encode("Content-Encoding: aes128gcm\0"), 16), nonce = await hkdf(salt, ikm, te.encode("Content-Encoding: nonce\0"), 12);
  const k = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, k, ct));
  return { rs, idlen, text: td.decode(pt.slice(0, pt.length - 1)), delim: pt[pt.length - 1] };
}
const d = await decrypt(body);
ok(d.text === msg && d.delim === 2 && d.rs === 4096 && d.idlen === 65, "Телефон расшифровывает уведомление (кириллица и эмодзи на месте)");
const body2 = await encrypt(te.encode(msg), b64u(uaPub), b64u(auth));
ok(b64u(body) !== b64u(body2), "Каждое уведомление шифруется заново (разные ключи и соль)");
let bad = false; try { await encrypt(te.encode("x"), b64u(uaPub.slice(1)), b64u(auth)); } catch { bad = true; }
ok(bad, "Повреждённые ключи подписки отклоняются");
// VAPID: подпись проверяется открытым ключом
const v = await generateVapid();
let captured: any = null;
(globalThis as any).fetch = async (url: string, init: any) => { captured = { url, init }; return new Response("", { status: 201 }); };
const r = await sendPush({ endpoint: "https://web.push.apple.com/QGuZ", p256dh: b64u(uaPub), auth: b64u(auth) }, { title: "t" }, { ...v, subject: "mailto:test@example.com" });
const authz: string = captured.init.headers.Authorization; const jwt = authz.match(/t=([^,]+)/)![1], k = authz.match(/k=(\S+)/)![1];
const [h, p, s] = jwt.split("."); const claims = JSON.parse(td.decode(unb64u(p)));
const pubKey = await crypto.subtle.importKey("raw", unb64u(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pubKey, unb64u(s), te.encode(h + "." + p));
ok(r.status === 201 && valid && claims.aud === "https://web.push.apple.com" && claims.exp > Date.now() / 1000 && k === v.publicKey, "Подпись VAPID верна, адресат — сервис Apple");
ok(captured.init.headers["Content-Encoding"] === "aes128gcm" && captured.init.headers.TTL === "3600", "Заголовки запроса по стандарту");
ok(ENDPOINT_RE.test("https://web.push.apple.com/abc") && ENDPOINT_RE.test("https://fcm.googleapis.com/fcm/send/x") && !ENDPOINT_RE.test("https://evil.com/web.push.apple.com/") && !ENDPOINT_RE.test("http://web.push.apple.com/x"), "Отправка только на настоящие push-сервисы");
console.log(fails ? `FAILED ${fails}` : "ALL OK"); if (fails) process.exit(1);
