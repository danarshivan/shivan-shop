const encoder = new TextEncoder();

export function base64UrlToBytes(value) {
  const text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new TypeError("Invalid base64url value.");
  const binary = atob(text.padEnd(Math.ceil(text.length / 4) * 4, "="));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function bytesToBase64Url(value) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function isAllowedPushEndpoint(value) {
  try {
    const url = new URL(String(value || ""));
    const host = url.hostname.toLowerCase();
    const allowed = host === "fcm.googleapis.com"
      || host === "push.services.mozilla.com"
      || host.endsWith(".push.services.mozilla.com")
      || host.endsWith(".push.apple.com")
      || host.endsWith(".notify.windows.com");
    return url.protocol === "https:" && allowed && !url.username && !url.password && (!url.port || url.port === "443");
  } catch {
    return false;
  }
}

async function hkdf(ikmBytes, salt, info, length, webcrypto = crypto) {
  const key = await webcrypto.subtle.importKey("raw", ikmBytes, "HKDF", false, ["deriveBits"]);
  const bits = await webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

export async function encryptWebPush(subscription, payload, webcrypto = crypto) {
  const receiverPublic = base64UrlToBytes(subscription?.keys?.p256dh);
  const authSecret = base64UrlToBytes(subscription?.keys?.auth);
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || authSecret.length !== 16) throw new TypeError("Invalid push subscription encryption keys.");

  const receiverKey = await webcrypto.subtle.importKey("raw", receiverPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const senderKeys = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const senderPublic = new Uint8Array(await webcrypto.subtle.exportKey("raw", senderKeys.publicKey));
  const shared = new Uint8Array(await webcrypto.subtle.deriveBits({ name: "ECDH", public: receiverKey }, senderKeys.privateKey, 256));

  const keyInfo = new Uint8Array(13 + receiverPublic.length + senderPublic.length);
  keyInfo.set(encoder.encode("WebPush: info\0"), 0);
  keyInfo.set(receiverPublic, 13);
  keyInfo.set(senderPublic, 13 + receiverPublic.length);
  const inputKeyMaterial = await hkdf(shared, authSecret, keyInfo, 32, webcrypto);
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(inputKeyMaterial, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16, webcrypto);
  const nonce = await hkdf(inputKeyMaterial, salt, encoder.encode("Content-Encoding: nonce\0"), 12, webcrypto);

  const clearText = encoder.encode(JSON.stringify(payload));
  if (clearText.length > 3000) throw new RangeError("Push notification payload is too large.");
  const record = new Uint8Array(clearText.length + 1);
  record.set(clearText);
  record[clearText.length] = 2;
  const contentKey = await webcrypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await webcrypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, contentKey, record));

  const header = new Uint8Array(16 + 4 + 1 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  const body = new Uint8Array(header.length + ciphertext.length);
  body.set(header);
  body.set(ciphertext, header.length);
  return body;
}

function vapidJwk(publicBytes, privateBytes) {
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new TypeError("VAPID keys must be P-256 raw base64url values.");
  return {
    kty: "EC", crv: "P-256", x: bytesToBase64Url(publicBytes.slice(1, 33)),
    y: bytesToBase64Url(publicBytes.slice(33, 65)), d: bytesToBase64Url(privateBytes),
    ext: true, key_ops: ["sign"],
  };
}

export async function createVapidAuthorization(endpoint, config, now = Date.now(), webcrypto = crypto) {
  if (!isAllowedPushEndpoint(endpoint)) throw new TypeError("Push endpoint is not an approved provider.");
  const publicBytes = base64UrlToBytes(config?.publicKey);
  const privateBytes = base64UrlToBytes(config?.privateKey);
  const subject = String(config?.subject || "");
  if (!/^(mailto:|https:\/\/)/i.test(subject)) throw new TypeError("VAPID subject must be a mailto: or https: URL.");
  const key = await webcrypto.subtle.importKey("jwk", vapidJwk(publicBytes, privateBytes), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const audience = new URL(endpoint).origin;
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = bytesToBase64Url(encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(now / 1000) + 12 * 60 * 60, sub: subject })));
  const signingInput = `${header}.${claims}`;
  const signature = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(signingInput)));
  if (signature.length !== 64) throw new Error("The runtime returned an unsupported ES256 signature format.");
  return { token: `${signingInput}.${bytesToBase64Url(signature)}`, publicKey: config.publicKey };
}

export async function sendWebPush(subscription, payload, config, fetchImpl = fetch, now = Date.now(), webcrypto = crypto) {
  const endpoint = String(subscription?.endpoint || "");
  if (!isAllowedPushEndpoint(endpoint)) return { ok: false, remove: true, status: 400 };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 10_000) : null;
  try {
    const [authorization, body] = await Promise.all([
      createVapidAuthorization(endpoint, config, now, webcrypto),
      encryptWebPush(subscription, payload, webcrypto),
    ]);
    const response = await fetchImpl(endpoint, {
      method: "POST", redirect: "manual", body,
      ...(controller ? { signal: controller.signal } : {}),
      headers: {
        Authorization: `vapid t=${authorization.token}, k=${authorization.publicKey}`,
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "86400",
        Urgency: "high",
      },
    });
    return { ok: response.status >= 200 && response.status < 300, remove: response.status === 404 || response.status === 410, status: response.status };
  } catch {
    return { ok: false, remove: false, status: 0 };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
