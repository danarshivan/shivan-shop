import { base64UrlToBytes, createVapidAuthorization, isAllowedPushEndpoint, sendWebPush } from "./webpush.mjs";

const encoder = new TextEncoder();
const SUBSCRIPTION_PREFIX = "shivan-push:subscription:";
const EVENT_PREFIX = "shivan-push:event:";
const DISCOUNT_PREFIX = "shivan-push:discount:";
const OWNER_TEST_PREFIX = "shivan-push:owner-test:";
const CUSTOMER_SUBSCRIPTION_PREFIX = "shivan-push:customer-subscription:";
const CUSTOMER_EVENT_PREFIX = "shivan-push:customer-event:";
const OWNER_PREFERENCES_PREFIX = "shivan-push:owner-preferences:";
const PRODUCTS_KEY = "shivan_shop_products";
const EVENT_TYPES = new Set(["new_order", "low_stock", "out_of_stock", "discount_expiring", "discount_expired"]);
const CUSTOMER_EVENT_TYPES = new Set(["new_arrival", "discount", "special_offer", "announcement"]);
const MAX_RETRIES = 8;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_BATCH_SIZE = 100;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function normalizeOwnerNotificationPreferences(value){
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const result={version:1};
  for(const type of EVENT_TYPES){
    const row=value[type]===undefined?{}:value[type];
    if(!row||typeof row!=="object"||Array.isArray(row))return null;
    for(const channel of ["inApp","push"])if(row[channel]!==undefined&&typeof row[channel]!=="boolean")return null;
    result[type]={inApp:row.inApp!==false,push:row.push!==false};
  }
  return result;
}

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validOwnerId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validCustomerImage(value) {
  return typeof value === "string" && value.length <= 700 && /^\/api\/media\/shop\/[A-Za-z0-9_-]{43}\.(?:jpg|png|webp|gif)$/i.test(value);
}

function validLocalTarget(value) {
  if (typeof value !== "string" || !value.startsWith("/" ) || value.startsWith("//") || value.length > 700) return false;
  try { return new URL(value, "https://shivan.invalid").origin === "https://shivan.invalid"; }
  catch { return false; }
}

async function digestKey(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function discountPercent(product) {
  const value = Number(product?.discount ?? product?.discountPercent ?? product?.discount_percent ?? 0);
  return Number.isInteger(value) && value >= 1 && value <= 99 ? value : 0;
}

function stockStatus(quantity) {
  const qty = Math.max(0, Math.floor(Number(quantity) || 0));
  return qty === 0 ? "out" : qty <= 5 ? "low" : "normal";
}

function discountEvent(product, type, endAt) {
  const productId = String(product.id);
  const name = cleanText(product.name || product.names?.en || `Product ${productId}`, 100) || `Product ${productId}`;
  const endingText = new Date(endAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
  const expiring = type === "discount_expiring";
  return {
    eventId: `discount:${expiring ? "expiring" : "expired"}:${encodeURIComponent(productId)}:${endAt}`,
    type,
    title: expiring ? "Timed discount ending soon" : "Timed discount expired",
    body: `${name} · ${endingText}`,
    url: "/?ownerPush=alerts",
  };
}

export class PushCoordinator {
  constructor(ctx, env, options = {}) {
    this.ctx = ctx;
    this.storage = ctx.storage;
    this.env = env;
    this.clock = options.clock || (() => Date.now());
    this.endpointRegistrationLocks = new Map();
    this.send = options.send || ((subscription, payload) => sendWebPush(subscription, payload, {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    }));
  }

  withEndpointRegistrationLock(endpointHash, callback) {
    const locks = this.endpointRegistrationLocks;
    const previous = locks.get(endpointHash) || Promise.resolve();
    let release;
    const hold = new Promise(resolve => { release = resolve; });
    const queued = previous.then(() => hold);
    locks.set(endpointHash, queued);
    return previous.catch(() => {}).then(callback).finally(() => {
      release();
      if (locks.get(endpointHash) === queued) locks.delete(endpointHash);
    });
  }

  async handle(request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/push/config") {
      if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY || !this.env.VAPID_SUBJECT) return json({ error: "Push notifications are not configured on the server.", code: "PUSH_NOT_CONFIGURED" }, 503);
      try {
        const key = base64UrlToBytes(this.env.VAPID_PUBLIC_KEY);
        if (key.length !== 65 || key[0] !== 4) throw new Error("Invalid public key");
        await createVapidAuthorization("https://fcm.googleapis.com/fcm/send/config-check", { publicKey: this.env.VAPID_PUBLIC_KEY, privateKey: this.env.VAPID_PRIVATE_KEY, subject: this.env.VAPID_SUBJECT }, this.clock());
      }
      catch { return json({ error: "The server push key is invalid.", code: "PUSH_CONFIG_INVALID" }, 503); }
      return json({ ok: true, publicKey: this.env.VAPID_PUBLIC_KEY });
    }
    if (request.method === "GET" && url.pathname === "/push/customer-broadcasts") return this.listCustomerBroadcasts();
    if (request.method === "GET" && url.pathname === "/push/customer-offer") return this.customerOffer(url.searchParams.get("eventId"));
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
    let body;
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    if (url.pathname === "/push/customer-subscription") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.saveCustomerSubscription(body.customerId, body.subscription, body.previousEndpoint);
    }
    if (url.pathname === "/push/customer-subscription-status") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.customerSubscriptionStatus(body.customerId, body.endpoint);
    }
    if (url.pathname === "/push/customer-notification-status") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.customerNotificationStatus(body.customerId, body.endpoint);
    }
    if (url.pathname === "/push/customer-unsubscribe") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.removeCustomerSubscription(body.customerId, body.endpoint);
    }
    if (url.pathname === "/push/customer-event") {
      if (!validOwnerId(body?.ownerId)) return json({ error: "Invalid Owner reference." }, 400);
      return this.enqueueCustomerEvent(body.ownerId, body.event);
    }
    if (url.pathname === "/push/customer-broadcast") {
      if (!validOwnerId(body?.ownerId)) return json({ error: "Invalid Owner reference." }, 400);
      return this.enqueueCustomerEvent(body.ownerId, body.event, { manual: true });
    }
    if (!validOwnerId(body?.ownerId)) return json({ error: "Invalid owner reference." }, 400);

    if (url.pathname === "/push/subscription") return this.saveSubscription(body.ownerId, body.subscription, body.previousEndpoint);
    if (url.pathname === "/push/subscription-status") return this.subscriptionStatus(body.ownerId, body.endpoint);
    if (url.pathname === "/push/test") return this.sendOwnerTest(body.ownerId, body.endpoint, body.requestId);
    if (url.pathname === "/push/unsubscribe") return this.removeSubscription(body.ownerId, body.endpoint);
    if (url.pathname === "/push/preferences") return this.saveOwnerPreferences(body.ownerId, body.preferences);
    if (url.pathname === "/push/event") return this.enqueueEvent(body.ownerId, body.event);
    if (url.pathname === "/push/stock-snapshot") return this.updateStockSnapshot(body.ownerId, body.products);
    if (url.pathname === "/push/discounts") return this.syncDiscounts(body.ownerId, body.products);
    return json({ error: "Push route not found." }, 404);
  }

  async saveCustomerSubscription(customerId, subscription, previousEndpoint = "") {
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = String(subscription?.keys?.p256dh || "");
    const auth = String(subscription?.keys?.auth || "");
    let p256dhBytes, authBytes;
    try { p256dhBytes = base64UrlToBytes(p256dh); authBytes = base64UrlToBytes(auth); } catch {}
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || p256dhBytes?.length !== 65 || p256dhBytes[0] !== 4 || authBytes?.length !== 16) return json({ error: "This browser returned an unsupported push subscription." }, 400);
    if (!this.env.DB) return json({ error: "Customer push subscription storage is unavailable." }, 503);
    const endpointHash = await digestKey(endpoint);
    return this.withEndpointRegistrationLock(endpointHash, () => this.saveCustomerSubscriptionLocked(
      customerId, subscription, endpoint, p256dh, auth, endpointHash, previousEndpoint,
    ));
  }

  async saveCustomerSubscriptionLocked(customerId, subscription, endpoint, p256dh, auth, endpointHash, previousEndpoint) {
    const previousHash = isAllowedPushEndpoint(previousEndpoint) && previousEndpoint !== endpoint ? await digestKey(previousEndpoint) : "";
    const currentKey = CUSTOMER_SUBSCRIPTION_PREFIX + endpointHash;
    let current, old, ownedRows, legacy, ownerCurrent, ownerLegacy;
    try {
      current = await this.env.DB.prepare("SELECT endpoint_hash, customer_id, created_at FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      old = previousHash ? await this.env.DB.prepare("SELECT endpoint_hash, customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(previousHash).first() : null;
      ownerCurrent = await this.env.DB.prepare("SELECT owner_id FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const result = await this.env.DB.prepare("SELECT endpoint_hash FROM customer_push_subscriptions WHERE customer_id=?").bind(customerId).all();
      if (result?.success === false) throw new Error("D1 customer subscription query failed.");
      ownedRows = result?.results || [];
      legacy = await this.storage.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
      ownerLegacy = await this.storage.get(SUBSCRIPTION_PREFIX + endpointHash);
    } catch { return json({ error: "Customer notification storage could not be checked." }, 503); }
    const currentLegacy = await this.storage.get(currentKey);
    if (ownerCurrent || ownerLegacy) return json({ error: "This device is already registered for Owner notifications. Turn those off on this device before enabling customer notifications." }, 409);
    if ((current?.customer_id && current.customer_id !== customerId) || (currentLegacy?.customerId && currentLegacy.customerId !== customerId)) return json({ error: "This browser subscription is already linked to another customer account." }, 409);
    const ownedHashes = new Set(ownedRows.map(row => String(row.endpoint_hash || "")));
    for (const [key, record] of legacy) if (record?.customerId === customerId) ownedHashes.add(key.slice(CUSTOMER_SUBSCRIPTION_PREFIX.length));
    if (previousHash && old?.customer_id === customerId) ownedHashes.delete(previousHash);
    const oldLegacyKey = previousHash ? CUSTOMER_SUBSCRIPTION_PREFIX + previousHash : "";
    const oldLegacy = oldLegacyKey ? await this.storage.get(oldLegacyKey) : null;
    if (previousHash && oldLegacy?.customerId === customerId) ownedHashes.delete(previousHash);
    if (!ownedHashes.has(endpointHash) && ownedHashes.size >= 10) return json({ error: "This customer account already has the maximum of 10 enabled devices." }, 429);

    const timestamp = this.clock();
    const subscriptionWrite = this.env.DB.prepare(`INSERT INTO customer_push_subscriptions
      (endpoint_hash, customer_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at, failures)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(endpoint_hash) DO UPDATE SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth_secret=excluded.auth_secret,
        expiration_time=excluded.expiration_time, updated_at=excluded.updated_at, failures=0, last_failure_at=NULL, last_failure_status=NULL
      WHERE customer_push_subscriptions.customer_id=excluded.customer_id`)
      .bind(endpointHash, customerId, endpoint, p256dh, auth, Number(subscription.expirationTime) || null, Number(current?.created_at || currentLegacy?.createdAt) || timestamp, timestamp);
    try {
      const results = await this.env.DB.batch([subscriptionWrite, ...(previousHash ? [
        this.env.DB.prepare(`DELETE FROM customer_push_subscriptions WHERE endpoint_hash=? AND customer_id=? AND EXISTS (
          SELECT 1 FROM customer_push_subscriptions WHERE endpoint_hash=? AND customer_id=?
        )`).bind(previousHash, customerId, endpointHash, customerId),
      ] : [])]);
      if (!Array.isArray(results) || results.length < 1 || results.some(result => result?.success === false)) throw new Error("D1 customer subscription batch failed.");
      if (Number(results[0]?.meta?.changes) !== 1) {
        const saved = await this.env.DB.prepare("SELECT customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
        if (saved?.customer_id && saved.customer_id !== customerId) return json({ error: "This browser subscription is already linked to another customer account." }, 409);
        throw new Error("D1 did not confirm the customer subscription write.");
      }
    } catch { return json({ error: "The customer device subscription could not be saved securely." }, 503); }

    if (oldLegacy?.customerId === customerId && oldLegacyKey) await this.storage.delete(oldLegacyKey);
    if (currentLegacy?.customerId === customerId) await this.storage.delete(currentKey);
    await this.armNext();
    return json({ ok: true, registered: true, renewed: Boolean(current || currentLegacy) });
  }

  async customerSubscriptionStatus(customerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid subscription status request." }, 400);
    if (!this.env.DB) return json({ error: "Customer push subscription storage is unavailable." }, 503);
    try {
      const endpointHash = await digestKey(endpoint);
      const row = await this.env.DB.prepare("SELECT customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const legacy = await this.storage.get(CUSTOMER_SUBSCRIPTION_PREFIX + endpointHash);
      return json({ ok: true, registered: row?.customer_id === customerId || (!row && legacy?.customerId === customerId) });
    } catch { return json({ error: "This device notification status could not be checked." }, 503); }
  }

  async customerNotificationStatus(customerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (endpoint && (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096)) return json({ error: "Invalid push endpoint." }, 400);
    if (!this.env.DB) return json({ error: "Customer push subscription storage is unavailable." }, 503);
    try {
      let registered = false;
      if (endpoint) {
        const endpointHash = await digestKey(endpoint);
        const row = await this.env.DB.prepare("SELECT customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
        const legacy = await this.storage.get(CUSTOMER_SUBSCRIPTION_PREFIX + endpointHash);
        registered = row?.customer_id === customerId || (!row && legacy?.customerId === customerId);
      } else {
        const row = await this.env.DB.prepare("SELECT endpoint_hash FROM customer_push_subscriptions WHERE customer_id=? LIMIT 1").bind(customerId).first();
        const legacy = await this.storage.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
        registered = Boolean(row || [...legacy.values()].some(item => item?.customerId === customerId && item?.subscription));
      }
      return json({ ok: true, registered, notificationsEnabled: registered });
    } catch { return json({ error: "Customer notification status could not be checked." }, 503); }
  }

  async removeCustomerSubscription(customerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid push endpoint." }, 400);
    if (!this.env.DB) return json({ error: "Customer push subscription storage is unavailable." }, 503);
    const endpointHash = await digestKey(endpoint);
    const key = CUSTOMER_SUBSCRIPTION_PREFIX + endpointHash;
    try {
      const row = await this.env.DB.prepare("SELECT customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const legacy = await this.storage.get(key);
      let removed = false;
      if (row?.customer_id === customerId) {
        const result = await this.env.DB.prepare("DELETE FROM customer_push_subscriptions WHERE endpoint_hash=? AND customer_id=?").bind(endpointHash, customerId).run();
        if (result?.success === false) throw new Error("D1 customer subscription removal failed.");
        removed = Number(result?.meta?.changes) > 0;
      }
      if (legacy?.customerId === customerId) removed = await this.storage.delete(key) || removed;
      await this.armNext();
      return json({ ok: true, removed });
    } catch { return json({ error: "This device could not be removed from customer notifications." }, 503); }
  }

  async customerProductIsPublished(productId, { requireActiveDiscount = false } = {}) {
    const id = cleanText(productId, 100);
    if (!id || !this.env.DB) return false;
    const row = await this.env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
    let products;
    try { products = JSON.parse(String(row?.value || "[]")); } catch { return false; }
    if (!Array.isArray(products)) return false;
    const product = products.find(item => String(item?.id ?? "") === id);
    if (!product || product.published === false || product.isPublished === false || product.deleted === true || product.isDeleted === true || ["draft", "unpublished", "deleted"].includes(String(product.status || "").toLowerCase())) return false;
    if (requireActiveDiscount) {
      const discount = Number(product.discount ?? product.discountPercent ?? product.discount_percent ?? 0);
      if (!Number.isInteger(discount) || discount < 1 || discount > 99) return false;
      if (product.discountTimerEnabled === true) {
        const endAt = Date.parse(String(product.discountEndsAt || ""));
        if (!Number.isFinite(endAt) || endAt <= this.clock()) return false;
      }
    }
    return true;
  }

  async listCustomerSubscriptions() {
    if (!this.env.DB) throw new Error("Customer push subscription storage is unavailable.");
    const result = await this.env.DB.prepare(`SELECT s.endpoint_hash, s.customer_id, s.endpoint, s.p256dh, s.auth_secret, s.expiration_time,
        s.created_at, s.updated_at, s.failures
      FROM customer_push_subscriptions s`).all();
    if (result?.success === false) throw new Error("D1 customer subscription read failed.");
    const subscriptions = new Map();
    for (const row of result?.results || []) {
      const hash = String(row.endpoint_hash || "");
      if (!/^[a-f0-9]{64}$/i.test(hash) || !validOwnerId(row.customer_id)) continue;
      subscriptions.set(CUSTOMER_SUBSCRIPTION_PREFIX + hash, {
        customerId: row.customer_id,
        subscription: { endpoint: row.endpoint, expirationTime: row.expiration_time || null, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
        createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0,
        failures: Number(row.failures) || 0, endpointHash: hash, d1: true,
      });
    }
    const legacy = await this.storage.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
    for (const [key, stored] of legacy) if (!subscriptions.has(key) && stored?.customerId && stored?.subscription) subscriptions.set(key, {
      customerId: stored.customerId, subscription: stored.subscription,
      createdAt: Number(stored.createdAt) || 0, updatedAt: Number(stored.updatedAt) || 0,
      failures: Number(stored.failures) || 0, endpointHash: key.slice(CUSTOMER_SUBSCRIPTION_PREFIX.length), d1: false,
    });
    return subscriptions;
  }

  async getCustomerSubscription(key, customerId) {
    const endpointHash = key.slice(CUSTOMER_SUBSCRIPTION_PREFIX.length);
    const row = await this.env.DB.prepare(`SELECT s.endpoint_hash, s.customer_id, s.endpoint, s.p256dh, s.auth_secret, s.expiration_time,
        s.created_at, s.updated_at, s.failures
      FROM customer_push_subscriptions s WHERE s.endpoint_hash=?`).bind(endpointHash).first();
    if (row) return row.customer_id === customerId ? {
      customerId: row.customer_id, subscription: { endpoint: row.endpoint, expirationTime: row.expiration_time || null, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
      createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0,
      failures: Number(row.failures) || 0, endpointHash, d1: true,
    } : null;
    const legacy = await this.storage.get(key);
    if (legacy?.customerId !== customerId) return null;
    return {
      customerId: legacy.customerId, subscription: legacy.subscription,
      createdAt: Number(legacy.createdAt) || 0, updatedAt: Number(legacy.updatedAt) || 0,
      failures: Number(legacy.failures) || 0, endpointHash, d1: false,
    };
  }

  async updateCustomerSubscription(key, stored, fields) {
    if (!stored?.d1) return this.storage.put(key, { ...stored, ...fields });
    const updated = { ...stored, ...fields };
    const result = await this.env.DB.prepare(`UPDATE customer_push_subscriptions SET failures=?, last_success_at=?, last_failure_at=?, last_failure_status=?, updated_at=?
      WHERE endpoint_hash=? AND customer_id=?`).bind(Number(updated.failures) || 0, Number(updated.lastSuccessAt) || null,
      Number(updated.lastFailureAt) || null, Number(updated.lastFailureStatus) || null, this.clock(), stored.endpointHash, stored.customerId).run();
    if (result?.success === false) throw new Error("D1 customer delivery status update failed.");
  }

  async deleteCustomerSubscription(key, stored) {
    if (!stored?.d1) return this.storage.delete(key);
    const result = await this.env.DB.prepare("DELETE FROM customer_push_subscriptions WHERE endpoint_hash=? AND customer_id=?").bind(stored.endpointHash, stored.customerId).run();
    if (result?.success === false) throw new Error("D1 customer subscription removal failed.");
    return Number(result?.meta?.changes) > 0;
  }

  async enqueueCustomerEvent(ownerId, rawEvent, { manual = false } = {}) {
    const eventId = cleanText(rawEvent?.eventId, 300);
    const type = String(rawEvent?.type || "");
    const title = cleanText(rawEvent?.title, 100);
    const body = cleanText(rawEvent?.body, 220);
    const url = String(rawEvent?.url || "");
    const productId = cleanText(rawEvent?.productId, 100);
    if (!CUSTOMER_EVENT_TYPES.has(type) || !eventId || !title || !validLocalTarget(url)) return json({ error: "Invalid customer notification." }, 400);
    if (manual && !["special_offer", "announcement"].includes(type)) return json({ error: "Owner broadcasts must be offers or important announcements." }, 400);
    if (rawEvent?.image && !validCustomerImage(rawEvent.image)) return json({ error: "The promotional image must use saved public shop media." }, 400);
    if ((type === "new_arrival" || type === "discount") && !productId) return json({ error: "Product notifications need a saved product reference." }, 400);
    if (productId) {
      try {
        if (!await this.customerProductIsPublished(productId, { requireActiveDiscount: type === "discount" })) return json({ error: "This product is no longer published or eligible for this notification." }, 409);
      } catch { return json({ error: "Saved product status could not be verified; no notification was queued." }, 503); }
    }
    const key = CUSTOMER_EVENT_PREFIX + await digestKey(eventId);
    const record = {
      eventId, type, title, body, url,
      image: validCustomerImage(rawEvent?.image) ? rawEvent.image : "",
      productId,
      audience: "All subscribed customer devices",
      ownerId,
      createdAt: this.clock(), nextAttemptAt: this.clock(), attempts: 0,
      delivered: [], status: "pending",
    };
    const queued = await this.storage.transaction(async transaction => {
      if (await transaction.get(key)) return false;
      await transaction.put(key, record);
      return true;
    });
    await this.armNext();
    if (!queued) return json({ ok: true, duplicate: true, eventId, status: "already_queued" });
    return json({ ok: true, duplicate: false, queued: true, eventId, status: "queued" }, 202);
  }

  async listCustomerBroadcasts() {
    const records = await this.storage.list({ prefix: CUSTOMER_EVENT_PREFIX });
    const items = [...records.values()].sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0)).slice(0, 40).map(event => ({
      eventId: event.eventId, type: event.type, title: event.title, body: event.body,
      audience: event.audience, status: event.status, createdAt: event.createdAt,
      sentCount: Number(event.delivered?.length || 0), attempts: Number(event.attempts || 0),
    }));
    return json({ ok: true, broadcasts: items });
  }

  async customerOffer(eventIdValue) {
    const eventId = cleanText(eventIdValue, 300);
    if (!eventId) return json({ error: "Offer not found." }, 404);
    const record = await this.storage.get(CUSTOMER_EVENT_PREFIX + await digestKey(eventId));
    if (!record || !["special_offer", "announcement"].includes(record.type)) return json({ error: "Offer not found." }, 404);
    return json({ ok: true, offer: { eventId: record.eventId, type: record.type, title: record.title, body: record.body, image: record.image || "", createdAt: record.createdAt } });
  }

  async saveSubscription(ownerId, subscription, previousEndpoint = "") {
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = String(subscription?.keys?.p256dh || "");
    const auth = String(subscription?.keys?.auth || "");
    let p256dhBytes, authBytes;
    try { p256dhBytes = base64UrlToBytes(p256dh); authBytes = base64UrlToBytes(auth); } catch {}
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || p256dhBytes?.length !== 65 || p256dhBytes[0] !== 4 || authBytes?.length !== 16) return json({ error: "This browser returned an unsupported push subscription." }, 400);
    if (!this.env.DB) return json({ error: "Owner push subscription storage is unavailable." }, 503);
    const endpointHash = await digestKey(endpoint);
    return this.withEndpointRegistrationLock(endpointHash, () => this.saveOwnerSubscriptionLocked(
      ownerId, subscription, endpoint, p256dh, auth, endpointHash, previousEndpoint,
    ));
  }

  async saveOwnerSubscriptionLocked(ownerId, subscription, endpoint, p256dh, auth, endpointHash, previousEndpoint) {
    const previousHash = isAllowedPushEndpoint(previousEndpoint) && previousEndpoint !== endpoint ? await digestKey(previousEndpoint) : "";
    let current;
    let old;
    let ownedRows;
    let customerCurrent;
    let customerLegacy;
    try {
      current = await this.env.DB.prepare("SELECT endpoint_hash, owner_id, created_at FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      old = previousHash ? await this.env.DB.prepare("SELECT endpoint_hash, owner_id FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(previousHash).first() : null;
      customerCurrent = await this.env.DB.prepare("SELECT customer_id FROM customer_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const result = await this.env.DB.prepare("SELECT endpoint_hash FROM owner_push_subscriptions WHERE owner_id=?").bind(ownerId).all();
      if (result?.success === false) throw new Error("D1 subscription query failed.");
      ownedRows = result?.results || [];
      customerLegacy = await this.storage.get(CUSTOMER_SUBSCRIPTION_PREFIX + endpointHash);
    } catch {
      return json({ error: "Owner push subscription storage could not be checked." }, 503);
    }
    if (customerCurrent || customerLegacy) return json({ error: "This device is already registered for customer notifications. Turn those off on this device before enabling Owner notifications." }, 409);
    if (current?.owner_id && current.owner_id !== ownerId) return json({ error: "This browser subscription is already linked to another Owner account." }, 409);
    const legacy = await this.storage.list({ prefix: SUBSCRIPTION_PREFIX });
    const ownedHashes = new Set(ownedRows.map(row => String(row.endpoint_hash || "")));
    for (const [key, record] of legacy) if (record?.ownerId === ownerId) ownedHashes.add(key.slice(SUBSCRIPTION_PREFIX.length));
    if (previousHash && old?.owner_id === ownerId) ownedHashes.delete(previousHash);
    if (!current && !ownedHashes.has(endpointHash) && ownedHashes.size >= 10) return json({ error: "This Owner account already has the maximum of 10 enabled devices." }, 429);
    const timestamp = this.clock();
    try {
      const statements = [this.env.DB.prepare(`INSERT INTO owner_push_subscriptions
        (endpoint_hash, owner_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at, failures)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(endpoint_hash) DO UPDATE SET endpoint=excluded.endpoint, p256dh=excluded.p256dh, auth_secret=excluded.auth_secret,
          expiration_time=excluded.expiration_time, updated_at=excluded.updated_at, failures=0, last_failure_at=NULL, last_failure_status=NULL
        WHERE owner_push_subscriptions.owner_id=excluded.owner_id`)
        .bind(endpointHash, ownerId, endpoint, p256dh, auth, Number(subscription.expirationTime) || null, Number(current?.created_at) || timestamp, timestamp)];
      if (previousHash && previousHash !== endpointHash) statements.push(this.env.DB.prepare(`DELETE FROM owner_push_subscriptions
        WHERE endpoint_hash=? AND owner_id=? AND EXISTS (
          SELECT 1 FROM owner_push_subscriptions WHERE endpoint_hash=? AND owner_id=?
        )`).bind(previousHash, ownerId, endpointHash, ownerId));
      const results = await this.env.DB.batch(statements);
      if (!Array.isArray(results) || results.length !== statements.length || results.some(result => result?.success === false)) throw new Error("D1 subscription write failed.");
      if (Number(results[0]?.meta?.changes) !== 1) {
        const saved = await this.env.DB.prepare("SELECT owner_id FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
        if (saved?.owner_id && saved.owner_id !== ownerId) return json({ error: "This browser subscription is already linked to another Owner account." }, 409);
        throw new Error("D1 did not confirm the subscription write.");
      }
      if (previousHash && previousHash !== endpointHash) {
        const legacyOldKey = SUBSCRIPTION_PREFIX + previousHash;
        const legacyOld = await this.storage.get(legacyOldKey);
        if (legacyOld?.ownerId === ownerId) await this.storage.delete(legacyOldKey);
      }
      const legacyCurrentKey = SUBSCRIPTION_PREFIX + endpointHash;
      const legacyCurrent = await this.storage.get(legacyCurrentKey);
      if (legacyCurrent?.ownerId === ownerId) await this.storage.delete(legacyCurrentKey);
    } catch {
      return json({ error: "The device subscription could not be saved securely." }, 503);
    }
    await this.armNext();
    return json({ ok: true, registered: true, renewed: Boolean(current) });
  }

  async subscriptionStatus(ownerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!validOwnerId(ownerId) || !isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid subscription status request." }, 400);
    if (!this.env.DB) return json({ error: "Owner push subscription storage is unavailable." }, 503);
    try {
      const endpointHash = await digestKey(endpoint);
      const row = await this.env.DB.prepare("SELECT owner_id FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const legacy = await this.storage.get(SUBSCRIPTION_PREFIX + endpointHash);
      return json({ ok: true, registered: row?.owner_id === ownerId || (!row && legacy?.ownerId === ownerId) });
    } catch { return json({ error: "This device notification status could not be checked." }, 503); }
  }

  async findOwnerSubscription(ownerId, endpointHash) {
    const row = await this.env.DB.prepare(`SELECT endpoint_hash, owner_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at, failures
      FROM owner_push_subscriptions WHERE endpoint_hash=?`).bind(endpointHash).first();
    if (row) return row.owner_id === ownerId ? {
      ownerId: row.owner_id,
      subscription: { endpoint: row.endpoint, expirationTime: row.expiration_time || null, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
      createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0, failures: Number(row.failures) || 0,
      endpointHash, d1: true,
    } : null;
    const legacy = await this.storage.get(SUBSCRIPTION_PREFIX + endpointHash);
    return legacy?.ownerId === ownerId ? { ...legacy, endpointHash, d1: false } : null;
  }

  async listOwnerSubscriptions() {
    if (!this.env.DB) throw new Error("Owner push subscription storage is unavailable.");
    const result = await this.env.DB.prepare(`SELECT endpoint_hash, owner_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at, failures
      FROM owner_push_subscriptions`).all();
    if (result?.success === false) throw new Error("D1 subscription read failed.");
    const subscriptions = new Map();
    for (const row of result?.results || []) {
      const endpointHash = String(row.endpoint_hash || "");
      if (!/^[a-f0-9]{64}$/i.test(endpointHash) || !validOwnerId(row.owner_id)) continue;
      subscriptions.set(SUBSCRIPTION_PREFIX + endpointHash, {
        ownerId: row.owner_id,
        subscription: { endpoint: row.endpoint, expirationTime: row.expiration_time || null, keys: { p256dh: row.p256dh, auth: row.auth_secret } },
        createdAt: Number(row.created_at) || 0, updatedAt: Number(row.updated_at) || 0, failures: Number(row.failures) || 0,
        endpointHash, d1: true,
      });
    }
    // Deliver to existing Durable Object subscriptions until those devices
    // renew or unsubscribe. This avoids dropping already-enabled devices.
    const legacy = await this.storage.list({ prefix: SUBSCRIPTION_PREFIX });
    for (const [key, record] of legacy) if (!subscriptions.has(key) && record?.ownerId && record?.subscription) subscriptions.set(key, { ...record, endpointHash: key.slice(SUBSCRIPTION_PREFIX.length), d1: false });
    return subscriptions;
  }

  async updateOwnerSubscription(key, stored, fields) {
    if (!stored?.d1) return this.storage.put(key, { ...stored, ...fields });
    const endpointHash = stored.endpointHash || key.slice(SUBSCRIPTION_PREFIX.length);
    const ownerId = stored.ownerId;
    const updated = { ...stored, ...fields };
    const result = await this.env.DB.prepare(`UPDATE owner_push_subscriptions SET failures=?, last_success_at=?, last_failure_at=?, last_failure_status=?, updated_at=?
      WHERE endpoint_hash=? AND owner_id=?`).bind(
      Number(updated.failures) || 0, Number(updated.lastSuccessAt) || null, Number(updated.lastFailureAt) || null,
      Number(updated.lastFailureStatus) || null, this.clock(), endpointHash, ownerId,
    ).run();
    if (result?.success === false) throw new Error("D1 subscription status update failed.");
  }

  async deleteOwnerSubscription(key, stored) {
    if (!stored?.d1) return this.storage.delete(key);
    const endpointHash = stored.endpointHash || key.slice(SUBSCRIPTION_PREFIX.length);
    const result = await this.env.DB.prepare("DELETE FROM owner_push_subscriptions WHERE endpoint_hash=? AND owner_id=?").bind(endpointHash, stored.ownerId).run();
    if (result?.success === false) throw new Error("D1 subscription removal failed.");
    return Number(result?.meta?.changes) > 0;
  }

  async sendOwnerTest(ownerId, endpointValue, requestIdValue) {
    const endpoint = String(endpointValue || "");
    const requestId = String(requestIdValue || "");
    if (!validOwnerId(ownerId) || !isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
      return json({ error: "Invalid one-device test request." }, 400);
    }
    const endpointHash = await digestKey(endpoint);
    const testKey = OWNER_TEST_PREFIX + await digestKey(`${ownerId}\0${requestId}`);
    let registered;
    try { registered = await this.findOwnerSubscription(ownerId, endpointHash); }
    catch { return json({ error: "This device notification status could not be checked." }, 503); }
    if (!registered?.subscription) return json({ error: "Enable Owner notifications on this device before sending a test." }, 404);
    const reserved = await this.storage.transaction(async transaction => {
      const existing = await transaction.get(testKey);
      if (existing) {
        if (existing.ownerId !== ownerId || existing.endpointHash !== endpointHash) return { conflict: true };
        return { existing };
      }
      const record = { ownerId, endpointHash, requestId, status: "sending", createdAt: this.clock() };
      await transaction.put(testKey, record);
      return { record, subscription: registered.subscription };
    });
    if (reserved.conflict) return json({ error: "This test request was already used for a different device." }, 409);
    if (reserved.notRegistered) return json({ error: "Enable Owner notifications on this device before sending a test." }, 404);
    if (reserved.existing) {
      const previous = reserved.existing;
      return json({ ok: previous.status === "sent", status: previous.status, duplicate: true, message: previous.status === "sent" ? "This one-device test was already accepted." : "This test request was already attempted; it was not sent again." }, previous.status === "sent" ? 200 : 409);
    }

    let delivery;
    try {
      delivery = await this.send(reserved.subscription, {
        title: "Shivan Shop push test",
        body: "Push notifications are working on this device.",
        tag: `owner-push-test:${requestId}`,
        data: { audience: "owner", type: "test", eventId: requestId, url: "/?ownerPush=alerts" },
      });
    } catch {
      delivery = { ok: false, status: 0 };
    }
    const sent = delivery?.ok === true;
    const finalRecord = { ...reserved.record, status: sent ? "sent" : "failed", providerStatus: Number(delivery?.status) || 0, completedAt: this.clock() };
    await this.storage.put(testKey, finalRecord);
    return sent
      ? json({ ok: true, status: "sent", acceptedByPushService: true, duplicate: false })
      : json({ ok: false, status: "failed", acceptedByPushService: false, providerStatus: Number(delivery?.status) || 0, retryWithNewRequest: true }, 502);
  }

  async removeSubscription(ownerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!validOwnerId(ownerId) || !isAllowedPushEndpoint(endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    if (!this.env.DB) return json({ error: "Owner push subscription storage is unavailable." }, 503);
    const endpointHash = await digestKey(endpoint);
    const key = SUBSCRIPTION_PREFIX + endpointHash;
    try {
      const row = await this.env.DB.prepare("SELECT owner_id FROM owner_push_subscriptions WHERE endpoint_hash=?").bind(endpointHash).first();
      const legacy = await this.storage.get(key);
      let removed = false;
      if (row?.owner_id === ownerId) {
        const result = await this.env.DB.prepare("DELETE FROM owner_push_subscriptions WHERE endpoint_hash=? AND owner_id=?").bind(endpointHash, ownerId).run();
        if (result?.success === false) throw new Error("D1 subscription removal failed.");
        removed = Number(result?.meta?.changes) > 0;
      }
      if (legacy?.ownerId === ownerId) removed = await this.storage.delete(key) || removed;
      await this.armNext();
      return json({ ok: true, removed });
    } catch { return json({ error: "This device could not be removed from Owner notifications." }, 503); }
  }

  async saveOwnerPreferences(ownerId, rawPreferences) {
    if (!validOwnerId(ownerId)) return json({ error: "Invalid Owner account." }, 400);
    const preferences = normalizeOwnerNotificationPreferences(rawPreferences);
    if (!preferences) return json({ error: "Invalid Owner notification preferences." }, 400);
    await this.storage.put(OWNER_PREFERENCES_PREFIX + ownerId, preferences);
    const events = await this.storage.list({ prefix: EVENT_PREFIX });
    for (const [key, event] of events) {
      if (event?.ownerId !== ownerId || event?.status !== "pending" || preferences[event.type]?.push !== false) continue;
      await this.storage.put(key, { ...event, status: "suppressed", completedAt: this.clock() });
    }
    const schedules = await this.storage.list({ prefix: DISCOUNT_PREFIX });
    for (const [key, item] of schedules) if (item?.ownerId === ownerId && preferences[item.event?.type]?.push === false) await this.storage.delete(key);
    await this.armNext();
    return json({ ok: true, preferences });
  }



  async enqueueEvent(ownerId, event) {
    const eventId = cleanText(event?.eventId, 1200);
    const type = String(event?.type || "");
    const title = cleanText(event?.title, 100);
    const body = cleanText(event?.body, 220);
    const url = String(event?.url || "");
    if (!EVENT_TYPES.has(type) || !eventId || !title || !validLocalTarget(url)) return json({ error: "Invalid Smart Alert event." }, 400);
    const key = EVENT_PREFIX + await digestKey(eventId);
    const preferences = await this.storage.get(OWNER_PREFERENCES_PREFIX + ownerId);
    const suppressed = preferences?.[type]?.push === false;
    const eventRecord = { ownerId, eventId, type, title, body, url, createdAt: this.clock(), nextAttemptAt: this.clock(), attempts: 0, delivered: [], status: suppressed ? "suppressed" : "pending", ...(suppressed ? { completedAt: this.clock() } : {}) };
    const queued = await this.storage.transaction(async transaction => {
      if (await transaction.get(key)) return false;
      await transaction.put(key, eventRecord);
      return true;
    });
    await this.armNext();
    if (!queued) return json({ ok: true, duplicate: true });
    if (suppressed) return json({ ok: true, duplicate: false, suppressed: true }, 202);
    return json({ ok: true, duplicate: false, queued: true }, 202);
  }

  async updateStockSnapshot(ownerId, products) {
    if (!Array.isArray(products) || products.length > 10000) return json({ error: "Invalid inventory snapshot." }, 400);
    const stateKey = `shivan-push:stock-state:${ownerId}`;
    const state = await this.storage.get(stateKey) || { initialized: false, variants: {} };
    const current = {};
    const events = [];
    for (const product of products) {
      const productId = String(product?.id || "").slice(0, 100);
      if (!productId) continue;
      const variants = Array.isArray(product.variants) && product.variants.length ? product.variants : [{ color: "", size: "", stock: product.stock }];
      for (const variant of variants) {
        const color = String(variant?.color || "").slice(0, 40);
        const size = String(variant?.size || "").slice(0, 40);
        const variantId = String(variant?.qrId || "").slice(0, 140);
        const variantKey = `${productId}|${variantId || `${productId}|${color}|${size}`}`;
        const quantity = Math.max(0, Math.floor(Number(variant?.stock) || 0));
        const status = stockStatus(quantity);
        const previous = state.variants?.[variantKey];
        let cycle = Math.max(0, Number(previous?.cycle) || 0);
        if (!previous) {
          if (state.initialized && status !== "normal") cycle++;
        } else if (previous.status !== status) {
          cycle++;
        }
        current[variantKey] = { status, cycle };
        if (previous && previous.status !== status && status !== "normal" || !previous && state.initialized && status !== "normal") {
          const type = status === "out" ? "out_of_stock" : "low_stock";
          const name = cleanText(product.name || product.names?.en || `Product ${productId}`, 100) || `Product ${productId}`;
          const eventId = `stock:${encodeURIComponent(variantKey)}:${status}:${cycle}`;
          events.push({
            eventId, type,
            title: status === "out" ? "Product variant out of stock" : "Product variant low on stock",
            body: `${name} · ${color || "—"} · ${size || "—"} · ${quantity} left`,
            url: "/?ownerPush=alerts",
          });
        }
      }
    }
    await this.storage.put(stateKey, { initialized: true, variants: current, updatedAt: this.clock() });
    for (const event of events) await this.enqueueEvent(ownerId, event);
    return json({ ok: true, eventsQueued: events.length });
  }

  async syncDiscounts(ownerId, products) {
    if (!Array.isArray(products) || products.length > 10000) return json({ error: "Invalid discount snapshot." }, 400);
    const active = new Map();
    const preferences = await this.storage.get(OWNER_PREFERENCES_PREFIX + ownerId) || {};
    const now = this.clock();
    for (const product of products) {
      const id = String(product?.id || "").slice(0, 100);
      const endAt = Date.parse(String(product?.discountEndsAt || ""));
      if (!id || product?.discountTimerEnabled !== true || !discountPercent(product) || !Number.isFinite(endAt)) continue;
      const discountId = `discount:${encodeURIComponent(id)}:${endAt}`;
      const name = cleanText(product.name || product.names?.en || `Product ${id}`, 100) || `Product ${id}`;
      const schedules = [];
      if (endAt > now && preferences.discount_expiring?.push !== false) {
        const warning = discountEvent(product, "discount_expiring", endAt);
        schedules.push({ id: warning.eventId, dueAt: Math.max(now + 1000, endAt - 24 * 60 * 60 * 1000), event: warning });
      }
      if (preferences.discount_expired?.push !== false) {
        const expired = discountEvent(product, "discount_expired", endAt);
        schedules.push({ id: expired.eventId, dueAt: Math.max(now + 1000, endAt), event: expired });
      }
      active.set(discountId, schedules);
    }

    const existing = await this.storage.list({ prefix: DISCOUNT_PREFIX });
    const activeScheduleIds = new Set([...active.values()].flat().map(item => item.id));
    for (const [key, item] of existing) {
      if (!activeScheduleIds.has(item?.id)) await this.storage.delete(key);
    }
    for (const schedules of active.values()) {
      for (const item of schedules) {
        const key = DISCOUNT_PREFIX + await digestKey(item.id);
        const eventKey = EVENT_PREFIX + await digestKey(item.id);
        if (await this.storage.get(eventKey)) continue;
        await this.storage.put(key, { ownerId, ...item });
      }
    }

    const events = await this.storage.list({ prefix: EVENT_PREFIX });
    for (const [key, event] of events) {
      if (event?.ownerId === ownerId && event.type.startsWith("discount_") && event.status === "pending" && !activeScheduleIds.has(event.eventId)) await this.storage.delete(key);
    }
    await this.armNext();
    return json({ ok: true, scheduled: [...active.values()].reduce((count, list) => count + list.length, 0) });
  }

  async armNext() {
    const now = this.clock();
    const schedules = await this.storage.list({ prefix: DISCOUNT_PREFIX });
    const events = await this.storage.list({ prefix: EVENT_PREFIX });
    const customerEvents = await this.storage.list({ prefix: CUSTOMER_EVENT_PREFIX });
    const dueTimes = [
      ...[...schedules.values()].map(item => Number(item?.dueAt)),
      ...[...events.values()].filter(item => item?.status === "pending").map(item => Number(item?.nextAttemptAt)),
      ...[...customerEvents.values()].filter(item => item?.status === "pending").map(item => Number(item?.nextAttemptAt)),
    ].filter(time => Number.isFinite(time) && time > 0);
    if (!dueTimes.length) {
      await this.storage.deleteAlarm();
      return;
    }
    const next = Math.max(now + 1000, Math.min(...dueTimes));
    await this.storage.setAlarm(next);
  }

  async alarm() {
    const now = this.clock();
    const due = await this.storage.list({ prefix: DISCOUNT_PREFIX });
    for (const [key, item] of due) {
      if (Number(item?.dueAt) > now) continue;
      await this.storage.delete(key);
      await this.enqueueEvent(item.ownerId, item.event);
    }

    const subscriptions = await this.listOwnerSubscriptions();
    const events = await this.storage.list({ prefix: EVENT_PREFIX });
    for (const [key, event] of events) {
      if (Number(event?.createdAt) < now - RETENTION_MS && event?.status !== "pending") {
        await this.storage.delete(key);
        continue;
      }
      if (event?.status !== "pending" || Number(event.nextAttemptAt) > now) continue;
      const preferences = await this.storage.get(OWNER_PREFERENCES_PREFIX + event.ownerId);
      if (preferences?.[event.type]?.push === false) {
        await this.storage.put(key, { ...event, status: "suppressed", completedAt: now });
        continue;
      }
      const targets = [...subscriptions.entries()].filter(([, sub]) => sub?.ownerId === event.ownerId);
      if (!targets.length) {
        await this.storage.put(key, { ...event, status: "no_subscribers", completedAt: now });
        continue;
      }
      let transientFailure = false;
      let permanentFailure = false;
      const delivered = new Set(event.delivered || []);
      for (const [subscriptionKey, stored] of targets) {
        if (delivered.has(subscriptionKey)) continue;
        let result;
        try { result = await this.send(stored.subscription, { title: event.title, body: event.body, tag: event.eventId, data: { audience: "owner", eventId: event.eventId, type: event.type, url: event.url } }); }
        catch { result = { ok: false, status: 0 }; }
        if (result?.ok) {
          delivered.add(subscriptionKey);
          try { await this.updateOwnerSubscription(subscriptionKey, stored, { failures: 0, lastSuccessAt: now }); } catch {}
          continue;
        }
        if (result?.remove) {
          try { await this.deleteOwnerSubscription(subscriptionKey, stored); } catch {}
          permanentFailure = true;
          continue;
        }
        if (Number(result?.status) === 0 || Number(result?.status) === 429 || Number(result?.status) >= 500) {
          transientFailure = true;
          try { await this.updateOwnerSubscription(subscriptionKey, stored, { failures: (Number(stored.failures) || 0) + 1, lastFailureAt: now }); } catch {}
          continue;
        }
        // Authentication or malformed responses are not retried forever.
        permanentFailure = true;
        try { await this.updateOwnerSubscription(subscriptionKey, stored, { lastFailureAt: now, lastFailureStatus: Number(result?.status) || 0 }); } catch {}
      }
      if (transientFailure && Number(event.attempts) + 1 < MAX_RETRIES) {
        const attempts = Number(event.attempts) + 1;
        const waitMs = Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attempts, 7)));
        await this.storage.put(key, { ...event, delivered: [...delivered], attempts, nextAttemptAt: now + waitMs, lastAttemptAt: now });
      } else {
        await this.storage.put(key, { ...event, delivered: [...delivered], attempts: Number(event.attempts) + 1, nextAttemptAt: 0, status: transientFailure || permanentFailure ? (delivered.size ? "partial" : "failed") : "sent", completedAt: now });
      }
    }
    await this.deliverCustomerEvents(now);
    await this.armNext();
  }

  async deliverCustomerEvents(now) {
    const subscriptions = await this.listCustomerSubscriptions();
    const events = await this.storage.list({ prefix: CUSTOMER_EVENT_PREFIX });
    for (const [key, event] of events) {
      if (Number(event?.createdAt) < now - RETENTION_MS && event?.status !== "pending") {
        await this.storage.delete(key);
        continue;
      }
      if (event?.status !== "pending" || Number(event.nextAttemptAt) > now) continue;
      if (event.productId && !await this.customerProductIsPublished(event.productId, { requireActiveDiscount: event.type === "discount" })) {
        await this.storage.put(key, { ...event, status: "cancelled_unpublished_product", completedAt: now });
        continue;
      }
      const targets = [...subscriptions.entries()].filter(([, stored]) => stored?.customerId && stored?.subscription?.endpoint);
      if (!targets.length) {
        await this.storage.put(key, { ...event, status: "no_subscribers", completedAt: now });
        continue;
      }
      const delivered = new Set(event.delivered || []);
      const failed = new Set(event.failed || []);
      const pending = targets.filter(([subscriptionKey]) => !delivered.has(subscriptionKey) && !failed.has(subscriptionKey));
      if (!pending.length) {
        const status = Number(event.failedCount) ? (delivered.size ? "partial" : "failed") : (event.skippedAfterUnsubscribe || event.skippedAfterOptOut) && !delivered.size ? "no_subscribers" : "sent";
        await this.storage.put(key, { ...event, status, completedAt: now });
        continue;
      }
      const batch = pending.slice(0, DELIVERY_BATCH_SIZE);
      const moreRemain = pending.length > batch.length;
      let transientFailure = false;
      let permanentFailure = false;
      let skippedAfterUnsubscribe = Boolean(event.skippedAfterUnsubscribe || event.skippedAfterOptOut);
      for (const [subscriptionKey, stored] of batch) {
        let latest;
        try { latest = await this.getCustomerSubscription(subscriptionKey, stored.customerId); }
        catch { throw new Error("Customer subscription status could not be refreshed safely."); }
        if (!latest || latest.customerId !== stored.customerId) {
          skippedAfterUnsubscribe = true;
          continue;
        }
        let result;
        const data = { eventId: event.eventId, type: event.type, audience: "customer", url: event.url, productId: event.productId || "" };
        const payload = { title: event.title, body: event.body, tag: event.eventId, data };
        if (event.image) payload.image = event.image;
        try { result = await this.send(latest.subscription, payload); }
        catch { result = { ok: false, status: 0 }; }
        if (result?.ok) {
          delivered.add(subscriptionKey);
          try { await this.updateCustomerSubscription(subscriptionKey, latest, { failures: 0, lastSuccessAt: now }); } catch {}
          continue;
        }
        if (result?.remove) {
          try { await this.deleteCustomerSubscription(subscriptionKey, latest); } catch {}
          permanentFailure = true;
          failed.add(subscriptionKey);
          continue;
        }
        if (Number(result?.status) === 0 || Number(result?.status) === 429 || Number(result?.status) >= 500) {
          transientFailure = true;
          try { await this.updateCustomerSubscription(subscriptionKey, latest, { failures: (Number(stored.failures) || 0) + 1, lastFailureAt: now }); } catch {}
          continue;
        }
        permanentFailure = true;
        failed.add(subscriptionKey);
        try { await this.updateCustomerSubscription(subscriptionKey, latest, { lastFailureAt: now, lastFailureStatus: Number(result?.status) || 0 }); } catch {}
      }

      if (transientFailure && Number(event.attempts) + 1 < MAX_RETRIES) {
        const attempts = Number(event.attempts) + 1;
        const waitMs = Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attempts, 7)));
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterUnsubscribe, attempts, nextAttemptAt: now + waitMs, lastAttemptAt: now });
      } else if (moreRemain) {
        if (transientFailure && Number(event.attempts) + 1 >= MAX_RETRIES) for (const [subscriptionKey] of batch) if (!delivered.has(subscriptionKey)) failed.add(subscriptionKey);
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterUnsubscribe, attempts: Number(event.attempts) + (transientFailure ? 1 : 0), nextAttemptAt: now + (transientFailure ? Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(Number(event.attempts) + 1, 7))) : 1000), lastAttemptAt: now });
      } else {
        if (transientFailure) for (const [subscriptionKey] of batch) if (!delivered.has(subscriptionKey)) failed.add(subscriptionKey);
        const status = transientFailure || permanentFailure || failed.size ? (delivered.size ? "partial" : "failed") : skippedAfterUnsubscribe && !delivered.size ? "no_subscribers" : "sent";
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterUnsubscribe, attempts: Number(event.attempts) + 1, nextAttemptAt: 0, status, completedAt: now });
      }
    }
  }
}
