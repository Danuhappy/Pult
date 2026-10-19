import { encrypt, b64u } from "../../supabase/functions/push/webpush.ts";
const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey)), jwk: any = await crypto.subtle.exportKey("jwk", ua.privateKey), auth = crypto.getRandomValues(new Uint8Array(16));
const msg = "Привычка: Выпить омегу в обед 💊";
console.log(JSON.stringify({ body: b64u(await encrypt(new TextEncoder().encode(msg), b64u(pub), b64u(auth))), d: jwk.d, auth: b64u(auth), msg }));
