const OWNER_IDENTIFIER = "07502342153";
const COOKIE_NAME = "shivan_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const SHOP_KEYS = new Set([
  "shivan_shop_products",
  "shivan_shop_ads",
  "shivan_shop_owner_appearance",
  "shivan_shop_categories",
  "shivan_shop_category_meta",
  "shivan_shop_category_renames",
  "shivan_shop_deleted_categories",
]);
const USER_KEYS = new Set(["cart", "favorites", "settings", "support"]);
// D1's row limit is 2,000,000 bytes. Base64 adds roughly one third, so leave
// room for JSON, key, and timestamp bytes instead of approaching the hard cap.
const MAX_SHOP_IMAGE_BYTES = 1_300_000;
const MAX_RECEIPT_IMAGE_BYTES = 1_000_000;

const json = (value, status = 200, extraHeaders = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
});

const error = (message, status = 400) => json({ error: message }, status);

function requireD1WriteSuccess(result, operation) {
  const results = Array.isArray(result) ? result : [result];
  if (!results.length || results.some(item => item?.success !== true)) {
    const detail = results.find(item => item?.success === false)?.error;
    throw new Error(`${operation} was not confirmed by D1${detail ? `: ${detail}` : ""}.`);
  }
}
const now = () => new Date().toISOString();
const asJson = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

async function broadcastSync(env) {
  if (!env.SYNC_HUB) return;
  try {
    const id = env.SYNC_HUB.idFromName("shivan-shop");
    const hub = env.SYNC_HUB.get(id);
    await hub.fetch("https://sync-hub.internal/broadcast", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "sync" }),
    });
  } catch (exception) {
    console.error("Realtime sync notification failed.", exception);
  }
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function digest(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function digestBytes(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", value)));
}

async function passwordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  // Cloudflare Workers rejects Web Crypto PBKDF2 iteration counts above 100,000.
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: fromBase64(salt), iterations: 100000, hash: "SHA-256" }, material, 256);
  return base64url(new Uint8Array(bits));
}

function cookieValue(request, name) {
  const header = request.headers.get("Cookie") || "";
  const entry = header.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function sessionCookie(token, secure = true) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${secure ? "; Secure" : ""}`;
}

async function createSession(env, accountId, secure) {
  const token = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, accountId, Math.floor(Date.now() / 1000) + SESSION_SECONDS).run();
  return sessionCookie(token, secure);
}

async function currentAccount(request, env) {
  const token = cookieValue(request, COOKIE_NAME);
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT a.id, a.identifier, a.name, a.role FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?"
  ).bind(await digest(token), Math.floor(Date.now() / 1000)).first();
  return row ? { id: row.id, identifier: row.identifier, name: row.name, role: row.role } : null;
}

async function ensureSession(request, env) {
  const account = await currentAccount(request, env);
  return account ? { account } : { response: error("Sign in to continue.", 401) };
}

async function ownerExists(env) {
  const row = await env.DB.prepare("SELECT id FROM accounts WHERE role='owner' LIMIT 1").first();
  return Boolean(row);
}

async function getShopState(env) {
  // Media is stored as separate D1 rows. Never include those large values in
  // bootstrap or realtime sync responses; shop records contain only URLs.
  const result = await env.DB.prepare("SELECT key, value FROM shop_state WHERE key < 'media:' OR key >= 'media;'").all();
  return Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
}

function mediaExtension(type) {
  return ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" })[type] || "bin";
}

async function readImageUpload(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Image upload is empty.");
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_SHOP_IMAGE_BYTES) {
        await reader.cancel();
        throw new RangeError("Image upload exceeds the 1.3 MB compressed-image limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function imageMatchesMime(bytes, mime) {
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mime === "image/webp") return bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
  if (mime === "image/gif") return bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(ascii(0, 6));
  return false;
}

async function handleMediaUpload(request, env, account, url) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  if (request.headers.get("Origin") !== url.origin) return error("Cross-origin image uploads are not allowed.", 403);
  if (!account) return error("Sign in to continue.", 401);
  if (account.role !== "owner") return error("Only the store owner can upload shop images.", 403);
  const mime = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (!Object.hasOwn({ "image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true }, mime)) {
    return error("Upload a JPEG, PNG, WebP, or GIF image.", 415);
  }
  let bytes;
  try { bytes = await readImageUpload(request); }
  catch (exception) {
    return exception instanceof RangeError
      ? error("Image upload exceeds the 1.3 MB compressed-image limit. Crop or reduce the image and try again.", 413)
      : error("Image upload could not be read.", 400);
  }
  if (!bytes.byteLength || !imageMatchesMime(bytes, mime)) return error("The uploaded file is not a valid image of the declared type.", 415);
  const key = `shop/${await digestBytes(bytes)}.${mediaExtension(mime)}`;
  try {
    const value = JSON.stringify({ mime, data: toBase64(bytes) });
    const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
      .bind(`media:${key}`, value, now()).run();
    requireD1WriteSuccess(result, "Image storage");
  } catch (exception) {
    console.error("Could not persist owner shop image to D1.", exception);
    return error("The image could not be saved to shared cloud storage.", 503);
  }
  return json({ url: `/api/media/${key}` }, 201);
}

function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function persistImages(value, env, mediaWrites = new Map()) {
  if (typeof value === "string") {
    const match = value.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([a-z0-9+/=]+)$/i);
    if (!match) return value;
    if (match[2].length > Math.ceil(MAX_SHOP_IMAGE_BYTES * 4 / 3) + 4) throw new RangeError("An image is larger than the 1.3 MB compressed-image limit.");
    const mime = match[1].toLowerCase();
    const bytes = fromBase64(match[2]);
    if (bytes.byteLength > MAX_SHOP_IMAGE_BYTES) throw new RangeError("An image is larger than the 1.3 MB compressed-image limit.");
    const hash = await digestBytes(bytes);
    const key = `shop/${hash}.${mediaExtension(mime)}`;
    mediaWrites.set(key, env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
      .bind(`media:${key}`, JSON.stringify({ mime, data: toBase64(bytes) }), now()));
    return `/api/media/${key}`;
  }
  if (Array.isArray(value)) return Promise.all(value.map(item => persistImages(item, env, mediaWrites)));
  if (value && typeof value === "object") {
    const entries = await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await persistImages(child, env, mediaWrites)]));
    return Object.fromEntries(entries);
  }
  return value;
}

async function persistReceiptImage(value, env) {
  const receipt = String(value || "");
  if (!receipt) return "";
  if (/^\/api\/media\/receipts\/[A-Za-z0-9_-]{40,50}\.(?:jpg|png|webp)$/i.test(receipt)) return receipt;
  const match = receipt.match(/^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) throw new Error("The FIB receipt image is invalid.");
  const mime = match[1].toLowerCase();
  const bytes = fromBase64(match[2]);
  if (bytes.byteLength > MAX_RECEIPT_IMAGE_BYTES) throw new Error("The receipt image exceeds the 1 MB upload limit.");
  const hash = await digestBytes(bytes);
  const key = `receipts/${hash}.${mediaExtension(mime)}`;
  await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(`media:${key}`, JSON.stringify({ mime, data: toBase64(bytes) }), now()).run();
  return `/api/media/${key}`;
}

function fibBaseUrl(env) {
  const environment = String(env.FIB_ENV || "stage").toLowerCase();
  return ({
    dev: "https://fib.dev.fib.iq",
    stage: "https://fib.stage.fib.iq",
    prod: "https://fib.prod.fib.iq",
  })[environment] || "https://fib.stage.fib.iq";
}

async function fibApi(env, path, { method = "GET", body = null } = {}) {
  if (!env.FIB_CLIENT_ID || !env.FIB_CLIENT_SECRET) throw new Error("FIB online payments are not configured. Add the FIB merchant credentials to the hosted site.");
  const baseUrl = fibBaseUrl(env);
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: env.FIB_CLIENT_ID,
    client_secret: env.FIB_CLIENT_SECRET,
  });
  const authResponse = await fetch(`${baseUrl}/auth/realms/fib-online-shop/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const authData = await authResponse.json().catch(() => ({}));
  if (!authResponse.ok || !authData.access_token) throw new Error("FIB authentication failed. Check the configured FIB credentials.");
  const response = await fetch(`${baseUrl}/protected/v1/payments${path}`, {
    method,
    headers: { Authorization: `Bearer ${authData.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `FIB payment request failed (${response.status}).`);
  return data;
}

async function fibPaymentStatus(env, paymentId) {
  return fibApi(env, `/${encodeURIComponent(paymentId)}/status`);
}

function verifiedFibPaymentStatus(data, expectedAmount) {
  const status = String(data?.status || "").toUpperCase();
  const monetaryValue = data?.amount;
  const amount = Number(monetaryValue?.amount);
  const currency = String(monetaryValue?.currency || "").toUpperCase();
  if (!["PAID", "UNPAID", "DECLINED"].includes(status)) throw new Error("FIB returned an unknown payment status.");
  if (!Number.isFinite(amount) || amount !== Number(expectedAmount) || currency !== "IQD") throw new Error("FIB returned a missing or mismatched payment amount.");
  return status;
}

function isFibAppLink(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && ["fib.iq", "first-iraqi-bank.co"].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}

async function handleCreateFibPayment(request, env, account) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  if (!account) return error("Sign in to continue.", 401);
  const body = await request.json().catch(() => null);
  const orderId = String(body?.orderId || "").slice(0, 100);
  const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : [];
  if (!/^S[a-zA-Z0-9_-]{8,96}$/.test(orderId) || !items.length) return error("Checkout details are invalid.");
  const productRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").first();
  const products = asJson(productRow?.value, []);
  if (!Array.isArray(products)) return error("Shop inventory is not available.", 409);
  const requested = new Map();
  let amount = 0;
  for (const item of items) {
    const productId = Number(item?.productId);
    const size = String(item?.size || "");
    const color = String(item?.color || "").toLowerCase();
    const quantity = Math.floor(Number(item?.qty) || 0);
    if (!Number.isFinite(productId) || !size || !/^#[0-9a-f]{3,6}$/.test(color) || quantity < 1 || quantity > 99) return error("Cart item details are invalid.");
    const key = JSON.stringify([productId, size, color]);
    requested.set(key, (requested.get(key) || 0) + quantity);
    const product = products.find(entry => Number(entry.id) === productId);
    const variant = product?.variants?.find(entry => String(entry.size) === size && String(entry.color).toLowerCase() === color);
    if (!variant || Number(variant.stock) < (requested.get(key) || quantity)) return error("A selected size or color is no longer available.", 409);
    amount += Math.max(0, Math.floor(Number(product.price) || 0)) * quantity;
  }
  if (amount <= 250) return error("FIB requires a payment amount greater than 250 IQD.");

  const existing = await env.DB.prepare("SELECT payment_id, amount, app_link, status, valid_until FROM fib_payments WHERE account_id=? AND order_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(account.id, orderId).first();
  if (existing) {
    if (Number(existing.amount) !== amount) return error("The cart total changed. Reopen checkout before creating a new FIB payment.", 409);
    try {
      const statusData = await fibPaymentStatus(env, existing.payment_id);
      const status = verifiedFibPaymentStatus(statusData, existing.amount);
      await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), existing.payment_id).run();
      if (["UNPAID", "PAID"].includes(status) && existing.app_link) return json({ paymentId: existing.payment_id, personalAppLink: existing.app_link, amount, status, validUntil: existing.valid_until });
    } catch (exception) {
      return error(exception.message || "Could not check the existing FIB payment.", 502);
    }
  }

  try {
    const payment = await fibApi(env, "", { method: "POST", body: {
      monetaryValue: { amount: String(amount), currency: "IQD" },
      description: `Shivan Shop ${orderId}`.slice(0, 50),
    } });
    const paymentId = String(payment.paymentId || "");
    const appLink = payment.personalAppLink || payment.businessAppLink || payment.corporateAppLink || "";
    if (!paymentId || !isFibAppLink(appLink)) throw new Error("FIB did not return a valid mobile app payment link.");
    const status = String(payment.status || "UNPAID").toUpperCase();
    await env.DB.prepare("INSERT INTO fib_payments (payment_id, account_id, order_id, amount, app_link, status, valid_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(paymentId, account.id, orderId, amount, appLink, status, String(payment.validUntil || ""), now(), now()).run();
    return json({ paymentId, personalAppLink: appLink, amount, status, validUntil: payment.validUntil || "" });
  } catch (exception) {
    return error(exception.message || "Could not create a FIB payment.", 502);
  }
}

async function handleFibPaymentStatus(request, env, account) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  if (!account) return error("Sign in to continue.", 401);
  const body = await request.json().catch(() => null);
  const paymentId = String(body?.paymentId || "").slice(0, 100);
  if (!paymentId) return error("Payment reference is missing.");
  const payment = await env.DB.prepare("SELECT payment_id, account_id, order_id, amount, status FROM fib_payments WHERE payment_id=?").bind(paymentId).first();
  if (!payment || (account.role !== "owner" && payment.account_id !== account.id)) return error("FIB payment was not found.", 404);
  try {
    const statusData = await fibPaymentStatus(env, paymentId);
    const status = verifiedFibPaymentStatus(statusData, payment.amount);
    await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), paymentId).run();
    return json({ paymentId, orderId: payment.order_id, amount: Number(payment.amount), status });
  } catch (exception) {
    return error(exception.message || "Could not verify the FIB payment.", 502);
  }
}

async function saveShopValue(env, key, rawValue) {
  if (!SHOP_KEYS.has(key)) throw new Error("Unsupported shop data key.");
  let value = String(rawValue ?? "");
  if (key === "shivan_shop_products" || key === "shivan_shop_ads") {
    const parsed = asJson(value);
    if (!Array.isArray(parsed)) throw new Error("Shop data must be a list.");
    const mediaWrites = new Map();
    value = JSON.stringify(await persistImages(parsed, env, mediaWrites));
    const statements = [...mediaWrites.values()];
    // Keep batches small for predictable free-tier resource use. Each chunk is
    // atomic, and the shop record is written only after all referenced media.
    for (let index = 0; index < statements.length; index += 20) {
      const results = await env.DB.batch(statements.slice(index, index + 20));
      requireD1WriteSuccess(results, "Shop image storage");
    }
  }
  const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, value, now()).run();
  requireD1WriteSuccess(result, "Shop data storage");
}

function accountView(row) {
  return { id: row.id, name: row.name, identifier: row.identifier, role: row.role, createdAt: row.created_at };
}

async function handleAuth(request, env, route, secure) {
  if (route === "auth/setup-owner" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body || !env.OWNER_SETUP_TOKEN || body.setupToken !== env.OWNER_SETUP_TOKEN) return error("Owner setup code is incorrect.", 403);
    if (await ownerExists(env)) return error("The store owner account is already set up.", 409);
    const name = String(body.name || "Shivan Shop").trim().slice(0, 80);
    const identifier = String(body.identifier || OWNER_IDENTIFIER).trim().toLowerCase();
    const password = String(body.password || "");
    if (identifier !== OWNER_IDENTIFIER) return error("Use the store owner phone number for this account.");
    if (password.length < 10) return error("Choose a password with at least 10 characters.");
    const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    const id = crypto.randomUUID();
    try {
      await env.DB.prepare("INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'owner', ?, ?, ?)")
        .bind(id, identifier, name, salt, hash, now()).run();
    } catch { return error("An account already uses that phone number.", 409); }
    const setCookie = await createSession(env, id, secure);
    return json({ account: { id, identifier, name, role: "owner" } }, 201, { "Set-Cookie": setCookie });
  }

  if (route === "auth/signup" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    if (!body) return error("Invalid sign-up details.");
    const name = String(body.name || "").trim().slice(0, 80);
    const identifier = String(body.identifier || "").trim().toLowerCase().slice(0, 160);
    const password = String(body.password || "");
    if (!name || !identifier || password.length < 8) return error("Enter your name and contact, and use a password with at least 8 characters.");
    if (identifier === OWNER_IDENTIFIER) return error("That phone number is reserved for the store owner.");
    const id = crypto.randomUUID();
    const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(password, salt);
    try {
      await env.DB.prepare("INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
        .bind(id, identifier, name, salt, hash, now()).run();
    } catch { return error("An account with that email or phone number already exists.", 409); }
    const setCookie = await createSession(env, id, secure);
    return json({ account: { id, identifier, name, role: "customer" } }, 201, { "Set-Cookie": setCookie });
  }

  if (route === "auth/login" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const identifier = String(body?.identifier || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!identifier || !password) return error("Enter your email or phone and password.");
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE identifier=? COLLATE NOCASE").bind(identifier).first();
    if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) return error("The email/phone number or password is incorrect.", 401);
    const setCookie = await createSession(env, row.id, secure);
    return json({ account: accountView(row) }, 200, { "Set-Cookie": setCookie });
  }

  if (route === "auth/me" && request.method === "GET") {
    return json({ account: await currentAccount(request, env) });
  }

  if (route === "auth/logout" && request.method === "POST") {
    const token = cookieValue(request, COOKIE_NAME);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}` });
  }

  if (route === "auth/password" && request.method === "POST") {
    const { account, response } = await ensureSession(request, env);
    if (response) return response;
    const body = await request.json().catch(() => null);
    const oldPassword = String(body?.oldPassword || "");
    const newPassword = String(body?.newPassword || "");
    const row = await env.DB.prepare("SELECT password_salt, password_hash FROM accounts WHERE id=?").bind(account.id).first();
    if (!row || await passwordHash(oldPassword, row.password_salt) !== row.password_hash) return error("Current password is incorrect.", 401);
    if (newPassword.length < 10) return error("Choose a password with at least 10 characters.");
    const salt = base64url(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await passwordHash(newPassword, salt);
    await env.DB.prepare("UPDATE accounts SET password_salt=?, password_hash=? WHERE id=?").bind(salt, hash, account.id).run();
    return json({ ok: true });
  }

  return error("Not found.", 404);
}

async function handleSync(request, env, account) {
  if (request.method === "GET") {
    const shop = await getShopState(env);
    if (!account) return json({ shop, user: null, account: null });
    const result = await env.DB.prepare("SELECT key, value FROM user_state WHERE account_id=?").bind(account.id).all();
    const user = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
    const orderRows = account.role === "owner"
      ? await env.DB.prepare("SELECT payload FROM orders ORDER BY created_at DESC").all()
      : await env.DB.prepare("SELECT payload FROM orders WHERE account_id=? ORDER BY created_at DESC").bind(account.id).all();
    const orders = (orderRows.results || []).map(row => row.payload);
    user.shivan_shop_orders = JSON.stringify(orders.map(value => asJson(value, {})));
    if (account.role === "owner") {
      const supportRows = await env.DB.prepare("SELECT value FROM user_state WHERE key='support'").all();
      user.shivan_shop_support = JSON.stringify((supportRows.results || []).flatMap(row => asJson(row.value, [])));
      const accounts = await env.DB.prepare("SELECT id, identifier, name, role, created_at FROM accounts WHERE role='customer' ORDER BY created_at DESC").all();
      user.accounts = JSON.stringify((accounts.results || []).map(accountView));
    }
    return json({ shop, user, account });
  }

  if (request.method === "DELETE") {
    if (!account) return error("Sign in to continue.", 401);
    const key = String(new URL(request.url).searchParams.get("key") || "");
    if (SHOP_KEYS.has(key)) {
      if (account.role !== "owner") return error("Only the store owner can change shop settings.", 403);
      await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, '', ?) ON CONFLICT(key) DO UPDATE SET value='', updated_at=excluded.updated_at").bind(key, now()).run();
      await broadcastSync(env);
      return json({ ok: true, key });
    }
    const userKey = key === "shivan_shop_support" ? "support" : key === "shivan_shop_settings" ? "settings" : key.startsWith("shivan_shop_cart_") ? "cart" : key.startsWith("shivan_shop_favorites_") ? "favorites" : "";
    if (!USER_KEYS.has(userKey)) return error("Unsupported sync key.");
    await env.DB.prepare("DELETE FROM user_state WHERE account_id=? AND key=?").bind(account.id, userKey).run();
    await broadcastSync(env);
    return json({ ok: true });
  }
  if (request.method !== "PUT") return error("Method not allowed.", 405);
  if (!account) return error("Sign in to save changes across devices.", 401);
  const body = await request.json().catch(() => null);
  const key = String(body?.key || "");
  const value = String(body?.value ?? "");
  if (SHOP_KEYS.has(key)) {
    if (account.role !== "owner") return error("Only the store owner can change shop settings.", 403);
    try { await saveShopValue(env, key, value); }
    catch (exception) {
      if (exception instanceof RangeError) return error(exception.message || "Shop images exceed the shared storage limit.", 413);
      console.error("Could not persist owner shop data to D1.", exception);
      return error("The shared database could not confirm this shop update. Your device will keep it queued for retry.", 503);
    }
    await broadcastSync(env);
    return json({ ok: true, key, persisted: true });
  }

  if (key === "shivan_shop_orders") {
    const list = asJson(value);
    if (!Array.isArray(list)) return error("Order data is invalid.");
    const updates = [];
    const productRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").first();
    const products = asJson(productRow?.value, []);
    if (!Array.isArray(products)) return error("Shop inventory is invalid.", 409);
    let inventoryChanged = false;
    const savedOrders = [];
    for (const order of list.slice(0, 2000)) {
      const orderId = String(order?.id || "").slice(0, 100);
      const orderAccountId = String(order?.userId || "");
      if (!orderId || !orderAccountId) continue;
      if (account.role !== "owner" && orderAccountId !== account.id) continue;
      let trustedOrder = order;
      if (account.role !== "owner") {
        const existing = await env.DB.prepare("SELECT account_id FROM orders WHERE id=?").bind(orderId).first();
        if (existing?.account_id === account.id) continue;
        if (existing) return error("This order number is already in use.", 409);
        const paymentMethod = String(order.paymentMethod || "");
        const fibPaymentId = String(order.fibPaymentId || "").slice(0, 100);
        if (!["fib", "visa", "cash"].includes(paymentMethod)) return error("Choose a valid payment method.");
        if (paymentMethod !== "fib" && (order.receiptImage || fibPaymentId)) return error("FIB payment information can only be attached to an FIB order.");
        if (!Array.isArray(order.items) || !order.items.length) return error("Order items are invalid.");
        const requested = new Map();
        const trustedItems = [];
        let trustedTotal = 0;
        for (const item of order.items) {
          const productId = Number(item?.productId);
          const size = String(item?.size || "");
          const color = String(item?.color || "").toLowerCase();
          const quantity = Math.floor(Number(item?.qty) || 0);
          if (!Number.isFinite(productId) || !size || !/^#[0-9a-f]{3,6}$/.test(color) || quantity < 1 || quantity > 99) return error("Order item details are invalid.");
          const itemKey = JSON.stringify([productId, size, color]);
          requested.set(itemKey, (requested.get(itemKey) || 0) + quantity);
          const product = products.find(entry => Number(entry.id) === productId);
          if (!product) return error("A selected product is no longer available.", 409);
          const price = Math.max(0, Math.floor(Number(product.price) || 0));
          trustedItems.push({ ...item, productId, size, color, qty: quantity, price });
          trustedTotal += price * quantity;
        }
        for (const [itemKey, quantity] of requested) {
          const [productId, size, color] = JSON.parse(itemKey);
          const product = products.find(item => Number(item.id) === productId);
          const variant = product?.variants?.find(item => String(item.size) === size && String(item.color).toLowerCase() === color);
          if (!variant || Number(variant.stock) < quantity) return error("One or more selected sizes or colors are no longer available.", 409);
          variant.stock = Math.max(0, Math.floor(Number(variant.stock) - quantity));
          product.stock = (product.variants || []).reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.stock) || 0)), 0);
          inventoryChanged = true;
        }
        let paymentStatus="";
        if (paymentMethod === "fib") {
          if (!fibPaymentId) return error("Create a FIB gateway payment before placing this order.", 409);
          const linkedPayment = await env.DB.prepare("SELECT amount FROM fib_payments WHERE payment_id=? AND account_id=? AND order_id=?").bind(fibPaymentId, account.id, orderId).first();
          if (!linkedPayment || Number(linkedPayment.amount) !== trustedTotal) return error("The FIB payment does not match this order.", 409);
          let statusData;
          try { statusData = await fibPaymentStatus(env, fibPaymentId); }
          catch (exception) { return error(exception.message || "Could not verify the FIB payment.", 502); }
          let status;
          try { status = verifiedFibPaymentStatus(statusData, trustedTotal); }
          catch (exception) { return error(exception.message || "Could not verify the FIB payment amount.", 409); }
          await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), fibPaymentId).run();
          if (status !== "PAID") return error("FIB has not confirmed the payment yet.", 409);
          paymentStatus="PAID";
        }
        trustedOrder = { ...order, items: trustedItems, total: trustedTotal, paymentMethod, fibPaymentId, paymentStatus, userId: account.id };
      }
      try { trustedOrder = { ...trustedOrder, receiptImage: await persistReceiptImage(trustedOrder.receiptImage, env) }; }
      catch (exception) { return error(exception.message || "Could not save the transfer receipt.", 413); }
      const orderUserId = account.role === "owner" ? orderAccountId : account.id;
      const payload = { ...trustedOrder, userId: orderUserId };
      savedOrders.push({ id: orderId, receiptImage: payload.receiptImage || "", paymentStatus: payload.paymentStatus || "", fibPaymentId: payload.fibPaymentId || "" });
      updates.push(env.DB.prepare("INSERT INTO orders (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
        .bind(orderId, orderUserId, JSON.stringify(payload), String(order.date || now()), now()));
    }
    if (inventoryChanged) updates.push(env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES ('shivan_shop_products', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at").bind(JSON.stringify(products), now()));
    if (updates.length) {
      await env.DB.batch(updates);
      await broadcastSync(env);
    }
    return json({ ok: true, savedOrders });
  }

  let userKey = "";
  if (key === "shivan_shop_support") userKey = "support";
  else if (key === "shivan_shop_settings") userKey = "settings";
  else if (key.startsWith("shivan_shop_cart_")) userKey = "cart";
  else if (key.startsWith("shivan_shop_favorites_")) userKey = "favorites";
  if (!USER_KEYS.has(userKey)) return error("Unsupported sync key.");
  const parsed = asJson(value);
  if (parsed === null) return error("Saved data is invalid.");
  if (userKey === "support" && (!Array.isArray(parsed) || parsed.some(item => String(item?.userId) !== account.id))) return error("Support data does not belong to this account.", 403);
  await env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(account.id, userKey, value, now()).run();
  await broadcastSync(env);
  return json({ ok: true });
}

async function handleProfile(request, env, account) {
  if (!account || request.method !== "PUT") return error("Sign in to update your profile.", 401);
  const body = await request.json().catch(() => null);
  const name = String(body?.name || "").trim().slice(0, 80);
  const identifier = String(body?.identifier || "").trim().toLowerCase().slice(0, 160);
  if (!name || !identifier) return error("Enter your name and contact information.");
  if (account.role === "owner" && identifier !== OWNER_IDENTIFIER) return error("The store owner phone number cannot be changed.", 403);
  if (account.role !== "owner" && identifier === OWNER_IDENTIFIER) return error("That phone number is reserved for the store owner.", 403);
  try {
    await env.DB.prepare("UPDATE accounts SET name=?, identifier=? WHERE id=?").bind(name, identifier, account.id).run();
  } catch { return error("That email or phone number is already in use.", 409); }
  await broadcastSync(env);
  return json({ account: { ...account, name, identifier } });
}

async function handleMigration(request, env, account) {
  if (!account || account.role !== "owner") return error("Only the store owner can import the saved shop.", 403);
  const body = await request.json().catch(() => null);
  if (body?.format !== "shivan-shop-cloud-v1") return error("This backup file is not supported.");
  const shop = body.shop && typeof body.shop === "object" ? body.shop : {};
  for (const key of SHOP_KEYS) {
    if (typeof shop[key] === "string") await saveShopValue(env, key, shop[key]);
  }
  const accounts = Array.isArray(body.accounts) ? body.accounts.slice(0, 5000) : [];
  for (const item of accounts) {
    const identifier = String(item?.identifier || "").trim().toLowerCase();
    const id = String(item?.id || "");
    if (!id || !identifier || identifier === OWNER_IDENTIFIER || item.role === "owner" || !item.passwordSalt || !item.passwordHash) continue;
    await env.DB.prepare("INSERT OR IGNORE INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
      .bind(id, identifier, String(item.name || "Customer").slice(0, 80), String(item.passwordSalt), String(item.passwordHash), String(item.createdAt || now())).run();
  }
  const userState = body.userState && typeof body.userState === "object" ? body.userState : {};
  for (const [accountId, entries] of Object.entries(userState)) {
    const exists = await env.DB.prepare("SELECT id FROM accounts WHERE id=? AND role='customer'").bind(accountId).first();
    if (!exists || !entries || typeof entries !== "object") continue;
    for (const [key, value] of Object.entries(entries)) {
      if (!USER_KEYS.has(key) || typeof value !== "string") continue;
      let savedValue = value;
      if (key === "support") {
        const messages = asJson(value, []);
        savedValue = JSON.stringify(Array.isArray(messages) ? messages.map(message => ({ ...message, userId: accountId })) : []);
      }
      await env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(accountId, key, savedValue, now()).run();
    }
  }
  const orders = Array.isArray(body.orders) ? body.orders.slice(0, 10000) : [];
  for (const order of orders) {
    const id = String(order?.id || "");
    const accountId = String(order?.userId || "");
    if (!id || !accountId) continue;
    const exists = await env.DB.prepare("SELECT id FROM accounts WHERE id=?").bind(accountId).first();
    if (!exists) continue;
    const payload = { ...order, userId: accountId };
    await env.DB.prepare("INSERT OR IGNORE INTO orders (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, accountId, JSON.stringify(payload), String(order.date || now()), now()).run();
  }
  await broadcastSync(env);
  return json({ ok: true, accountsImported: accounts.length, ordersImported: orders.length });
}

export async function onRequest({ request, env }) {
  if (!env.DB) return error("Cloud database is not connected yet.", 503);
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");
  const secure = url.protocol === "https:";

  if (route === "media/upload") return handleMediaUpload(request, env, await currentAccount(request, env), url);

  if (route.startsWith("media/") && request.method === "GET") {
    const key = route.slice("media/".length).split("/").map(segment => decodeURIComponent(segment)).join("/");
    const privateReceipt = key.startsWith("receipts/");
    const mediaMatch = key.match(/^(shop|receipts)\/([A-Za-z0-9_-]{43})\.(jpg|png|webp|gif)$/i);
    if (!mediaMatch || (privateReceipt !== (mediaMatch[1] === "receipts"))) return new Response("Not found", { status: 404 });
    if (privateReceipt) {
      const mediaAccount = await currentAccount(request, env);
      if (mediaAccount?.role !== "owner") return error("Only the store owner can view payment receipts.", 403);
    }
    const mediaRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(`media:${key}`).first();
    if (mediaRow) {
      const media = asJson(mediaRow.value);
      if (!media || !/^image\/(?:jpeg|png|webp|gif)$/.test(media.mime) || typeof media.data !== "string") return error("Stored image data is invalid.", 500);
      const bytes = fromBase64(media.data);
      const headers = new Headers({
        "Content-Type": media.mime,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": privateReceipt ? "private, no-store" : "public, max-age=31536000, immutable",
      });
      return new Response(bytes, { headers });
    }
    // Preserve legacy R2 URLs for existing products and receipts, but never
    // write new images to R2. A missing binding simply means legacy media 404s.
    if (env.MEDIA) {
      const object = await env.MEDIA.get(key);
      if (object) {
        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Cache-Control", privateReceipt ? "private, no-store" : "public, max-age=31536000, immutable");
        return new Response(object.body, { headers });
      }
    }
    return new Response("Not found", { status: 404 });
  }

  if (route === "bootstrap" && request.method === "GET") {
    return json({ ownerSetupRequired: !(await ownerExists(env)), shop: await getShopState(env) });
  }
  if (route.startsWith("auth/")) return handleAuth(request, env, route, secure);
  const account = await currentAccount(request, env);
  if (route === "realtime") {
    if (request.method !== "GET" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return error("WebSocket connection required.", 426);
    if (!account) return error("Sign in to connect live sync.", 401);
    if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return error("Cross-origin sync is not allowed.", 403);
    if (!env.SYNC_HUB) return error("Realtime sync is not configured yet.", 503);
    const id = env.SYNC_HUB.idFromName("shivan-shop");
    return env.SYNC_HUB.get(id).fetch(request);
  }
  if (route === "sync") return handleSync(request, env, account);
  if (route === "fib/create-payment") return handleCreateFibPayment(request, env, account);
  if (route === "fib/payment-status") return handleFibPaymentStatus(request, env, account);
  if (route === "profile") return handleProfile(request, env, account);
  if (route === "migrate" && request.method === "POST") return handleMigration(request, env, account);
  return error("Not found.", 404);
}
