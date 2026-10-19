# Независимая расшифровка (Python cryptography) — сверка с официальным примером RFC 8291 и с нашим шифрованием.
import base64, json, sys
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
def ub(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
def hkdf(salt, ikm, info, n): return HKDF(algorithm=hashes.SHA256(), length=n, salt=salt, info=info).derive(ikm)
def decrypt(body, ua_priv_d, auth):
    priv = ec.derive_private_key(int.from_bytes(ua_priv_d, "big"), ec.SECP256R1())
    ua_pub = priv.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    salt, idlen = body[:16], body[20]; as_pub = body[21:21+idlen]; ct = body[21+idlen:]
    shared = priv.exchange(ec.ECDH(), ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), as_pub))
    ikm = hkdf(auth, shared, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16); nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    pt = AESGCM(cek).decrypt(nonce, ct, None); assert pt[-1] == 2; return pt[:-1].decode()
rfc = decrypt(ub("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"),
              ub("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"), ub("BTBZMqHH6r4Tts7J_aSIgg"))
print("OK   Пример из RFC 8291 расшифрован:", rfc)
d = json.loads(sys.stdin.read())
out = decrypt(ub(d["body"]), ub(d["d"]), ub(d["auth"]))
assert out == d["msg"], out
print("OK   Наше уведомление расшифровано независимой библиотекой:", out)
