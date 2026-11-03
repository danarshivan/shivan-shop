import { base64UrlToBytes, createVapidAuthorization, isAllowedPushEndpoint, sendWebPush } from "./webpush.mjs";

const encoder = new TextEncoder();
const SUBSCRIPTION_PREFIX = "shivan-push:subscription:";
const EVENT_PREFIX = "shivan-push:event:";
const DISCOUNT_PREFIX = "shivan-push:discount:";
const OWNER_TEST_PREFIX = "shivan-push:owner-test:";
const CUSTOMER_SUBSCRIPTION_PREFIX = "shivan-push:customer-subscription:";
const CUSTOMER_EVENT_PREFIX = "shivan-push:customer-event:";
const CUSTOMER_PREFERENCE_PREFIX = "shivan-push:customer-preferences:";
const EVENT_TYPES = new Set(["new_order", "low_stock", "out_of_stock", "discount_expiring", "discount_expired"]);
const CUSTOMER_EVENT_TYPES = new Set(["new_arrival", "discount", "special_offer"]);
const CUSTOMER_PREFERENCE_KEYS = ["newArrivals", "discounts", "specialOffers"];
const MAX_RETRIES = 8;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_BATCH_SIZE = 100;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function validOwnerId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function validCustomerPreferences(value) {
  const preferences = Object.fromEntries(CUSTOMER_PREFERENCE_KEYS.map(key => [key, value?.[key] === true]));
  return { preferences, enabled: Object.values(preferences).some(Boolean) };
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
    this.send = options.send || ((subscription, payload) => sendWebPush(subscription, payload, {
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    }));
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
      return this.saveCustomerSubscription(body.customerId, body.subscription, body.preferences, body.previousEndpoint);
    }
    if (url.pathname === "/push/customer-subscription-status") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.customerSubscriptionStatus(body.customerId, body.endpoint);
    }
    if (url.pathname === "/push/customer-preferences") {
      if (!validOwnerId(body?.customerId)) return json({ error: "Invalid customer reference." }, 400);
      return this.updateCustomerPreferences(body.customerId, body.endpoint, body.preferences);
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
    if (url.pathname === "/push/event") return this.enqueueEvent(body.ownerId, body.event);
    if (url.pathname === "/push/stock-snapshot") return this.updateStockSnapshot(body.ownerId, body.products);
    if (url.pathname === "/push/discounts") return this.syncDiscounts(body.ownerId, body.products);
    return json({ error: "Push route not found." }, 404);
  }

  async saveCustomerSubscription(customerId, subscription, rawPreferences, previousEndpoint = "") {
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = String(subscription?.keys?.p256dh || "");
    const auth = String(subscription?.keys?.auth || "");
    const { preferences, enabled } = validCustomerPreferences(rawPreferences);
    let p256dhBytes, authBytes;
    try { p256dhBytes = base64UrlToBytes(p256dh); authBytes = base64UrlToBytes(auth); } catch {}
    if (!enabled) return json({ error: "Choose at least one customer notification preference." }, 400);
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || p256dhBytes?.length !== 65 || p256dhBytes[0] !== 4 || authBytes?.length !== 16) return json({ error: "This browser returned an unsupported push subscription." }, 400);
    const key = CUSTOMER_SUBSCRIPTION_PREFIX + await digestKey(endpoint);
    const preferenceKey = CUSTOMER_PREFERENCE_PREFIX + await digestKey(customerId);
    const oldKey = isAllowedPushEndpoint(previousEndpoint) && previousEndpoint !== endpoint ? CUSTOMER_SUBSCRIPTION_PREFIX + await digestKey(previousEndpoint) : "";
    const result = await this.storage.transaction(async transaction => {
      const current = await transaction.get(key);
      const old = oldKey ? await transaction.get(oldKey) : null;
      const prefix = await transaction.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
      const owned = [...prefix.entries()].filter(([storedKey, record]) => storedKey !== oldKey && record?.customerId === customerId);
      if (current?.customerId && current.customerId !== customerId) return { conflict: true };
      if (!current && owned.length >= 10) return { full: true };
      if (old?.customerId === customerId) await transaction.delete(oldKey);
      for (const [storedKey, record] of prefix) if (record?.customerId === customerId) await transaction.put(storedKey, { ...record, preferences, updatedAt: this.clock() });
      await transaction.put(preferenceKey, { customerId, preferences, updatedAt: this.clock() });
      await transaction.put(key, {
        customerId,
        subscription: { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh, auth } },
        preferences,
        createdAt: current?.createdAt || this.clock(),
        updatedAt: this.clock(),
        failures: 0,
      });
      return { renewed: Boolean(current) };
    });
    if (result.conflict) return json({ error: "This browser subscription is already linked to another customer account." }, 409);
    if (result.full) return json({ error: "This customer account already has the maximum of 10 enabled devices." }, 429);
    await this.armNext();
    return json({ ok: true, registered: true, renewed: result.renewed });
  }

  async customerSubscriptionStatus(customerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid subscription status request." }, 400);
    const record = await this.storage.get(CUSTOMER_SUBSCRIPTION_PREFIX + await digestKey(endpoint));
    const savedPreferences = await this.storage.get(CUSTOMER_PREFERENCE_PREFIX + await digestKey(customerId));
    return json({ ok: true, registered: record?.customerId === customerId, preferences: savedPreferences?.preferences || (record?.customerId === customerId ? record.preferences : { newArrivals: false, discounts: false, specialOffers: false }) });
  }

  async updateCustomerPreferences(customerId, endpointValue, rawPreferences) {
    if (rawPreferences?.action === "get") {
      const saved = await this.storage.get(CUSTOMER_PREFERENCE_PREFIX + await digestKey(customerId));
      return json({ ok: true, preferences: saved?.preferences || { newArrivals: false, discounts: false, specialOffers: false } });
    }
    const endpoint = String(endpointValue || "");
    if (endpoint && (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096)) return json({ error: "Invalid push endpoint." }, 400);
    const { preferences, enabled } = validCustomerPreferences(rawPreferences);
    const preferenceKey = CUSTOMER_PREFERENCE_PREFIX + await digestKey(customerId);
    const all = await this.storage.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
    const key = endpoint ? CUSTOMER_SUBSCRIPTION_PREFIX + await digestKey(endpoint) : "";
    const record = endpoint ? await this.storage.get(key) : null;
    if (endpoint && record?.customerId !== customerId) return json({ error: "This device is not linked to this customer account." }, 404);
    await this.storage.transaction(async transaction => {
      await transaction.put(preferenceKey, { customerId, preferences, updatedAt: this.clock() });
      for (const [storedKey, stored] of all) if (stored?.customerId === customerId) await transaction.put(storedKey, { ...stored, preferences, updatedAt: this.clock() });
    });
    if (!enabled) await this.armNext();
    return json({ ok: true, preferences, notificationsEnabled: enabled });
  }

  async removeCustomerSubscription(customerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid push endpoint." }, 400);
    const key = CUSTOMER_SUBSCRIPTION_PREFIX + await digestKey(endpoint);
    const record = await this.storage.get(key);
    if (record?.customerId === customerId) await this.storage.delete(key);
    await this.armNext();
    return json({ ok: true, removed: record?.customerId === customerId });
  }

  async enqueueCustomerEvent(ownerId, rawEvent, { manual = false } = {}) {
    const eventId = cleanText(rawEvent?.eventId, 300);
    const type = String(rawEvent?.type || "");
    const title = cleanText(rawEvent?.title, 100);
    const body = cleanText(rawEvent?.body, 220);
    const url = String(rawEvent?.url || "");
    const preference = type === "new_arrival" ? "newArrivals" : type === "discount" ? "discounts" : type === "special_offer" ? "specialOffers" : "";
    if (!CUSTOMER_EVENT_TYPES.has(type) || !preference || !eventId || !title || !validLocalTarget(url)) return json({ error: "Invalid customer notification." }, 400);
    if (manual && type !== "special_offer") return json({ error: "Owner broadcasts must be special offers." }, 400);
    if (rawEvent?.image && !validCustomerImage(rawEvent.image)) return json({ error: "The promotional image must use saved public shop media." }, 400);
    const key = CUSTOMER_EVENT_PREFIX + await digestKey(eventId);
    const record = {
      eventId, type, preference, title, body, url,
      image: validCustomerImage(rawEvent?.image) ? rawEvent.image : "",
      productId: cleanText(rawEvent?.productId, 100),
      audience: "Subscribed customers · " + preference,
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
    if (!record || record.type !== "special_offer") return json({ error: "Offer not found." }, 404);
    return json({ ok: true, offer: { eventId: record.eventId, type: record.type, title: record.title, body: record.body, image: record.image || "", createdAt: record.createdAt } });
  }

  async saveSubscription(ownerId, subscription, previousEndpoint = "") {
    const endpoint = String(subscription?.endpoint || "");
    const p256dh = String(subscription?.keys?.p256dh || "");
    const auth = String(subscription?.keys?.auth || "");
    let p256dhBytes, authBytes;
    try { p256dhBytes = base64UrlToBytes(p256dh); authBytes = base64UrlToBytes(auth); } catch {}
    if (!isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || p256dhBytes?.length !== 65 || p256dhBytes[0] !== 4 || authBytes?.length !== 16) return json({ error: "This browser returned an unsupported push subscription." }, 400);
    const key = SUBSCRIPTION_PREFIX + await digestKey(endpoint);
    const oldKey = isAllowedPushEndpoint(previousEndpoint) && previousEndpoint !== endpoint
      ? SUBSCRIPTION_PREFIX + await digestKey(previousEndpoint)
      : "";
    const result = await this.storage.transaction(async transaction => {
      const current = await transaction.get(key);
      const old = oldKey ? await transaction.get(oldKey) : null;
      const prefix = await transaction.list({ prefix: SUBSCRIPTION_PREFIX });
      const owned = [...prefix.entries()].filter(([storedKey, record]) => storedKey !== oldKey && record?.ownerId === ownerId);
      if (current?.ownerId && current.ownerId !== ownerId) return { ownerConflict: true };
      if (!current && owned.length >= 10) return { full: true };
      if (old?.ownerId === ownerId) await transaction.delete(oldKey);
      const record = {
        ownerId,
        subscription: { endpoint, expirationTime: subscription.expirationTime || null, keys: { p256dh, auth } },
        createdAt: current?.createdAt || this.clock(),
        updatedAt: this.clock(),
        failures: 0,
      };
      await transaction.put(key, record);
      return { renewed: Boolean(current) };
    });
    if (result.ownerConflict) return json({ error: "This browser subscription is already linked to another Owner account." }, 409);
    if (result.full) return json({ error: "This Owner account already has the maximum of 10 enabled devices." }, 429);
    await this.armNext();
    return json({ ok: true, registered: true, renewed: result.renewed });
  }

  async subscriptionStatus(ownerId, endpointValue) {
    const endpoint = String(endpointValue || "");
    if (!validOwnerId(ownerId) || !isAllowedPushEndpoint(endpoint) || endpoint.length > 4096) return json({ error: "Invalid subscription status request." }, 400);
    const record = await this.storage.get(SUBSCRIPTION_PREFIX + await digestKey(endpoint));
    return json({ ok: true, registered: record?.ownerId === ownerId });
  }

  async sendOwnerTest(ownerId, endpointValue, requestIdValue) {
    const endpoint = String(endpointValue || "");
    const requestId = String(requestIdValue || "");
    if (!validOwnerId(ownerId) || !isAllowedPushEndpoint(endpoint) || endpoint.length > 4096 || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
      return json({ error: "Invalid one-device test request." }, 400);
    }
    const endpointHash = await digestKey(endpoint);
    const testKey = OWNER_TEST_PREFIX + await digestKey(`${ownerId}\0${requestId}`);
    const reserved = await this.storage.transaction(async transaction => {
      const existing = await transaction.get(testKey);
      if (existing) {
        if (existing.ownerId !== ownerId || existing.endpointHash !== endpointHash) return { conflict: true };
        return { existing };
      }
      const stored = await transaction.get(SUBSCRIPTION_PREFIX + endpointHash);
      if (stored?.ownerId !== ownerId || !stored.subscription) return { notRegistered: true };
      const record = { ownerId, endpointHash, requestId, status: "sending", createdAt: this.clock() };
      await transaction.put(testKey, record);
      return { record, subscription: stored.subscription };
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
    if (!isAllowedPushEndpoint(endpoint)) return json({ error: "Invalid push endpoint." }, 400);
    const key = SUBSCRIPTION_PREFIX + await digestKey(endpoint);
    const current = await this.storage.get(key);
    if (current?.ownerId === ownerId) await this.storage.delete(key);
    await this.armNext();
    return json({ ok: true, removed: Boolean(current?.ownerId === ownerId) });
  }

  async enqueueEvent(ownerId, event) {
    const eventId = cleanText(event?.eventId, 1200);
    const type = String(event?.type || "");
    const title = cleanText(event?.title, 100);
    const body = cleanText(event?.body, 220);
    const url = String(event?.url || "");
    if (!EVENT_TYPES.has(type) || !eventId || !title || !validLocalTarget(url)) return json({ error: "Invalid Smart Alert event." }, 400);
    const key = EVENT_PREFIX + await digestKey(eventId);
    const eventRecord = { ownerId, eventId, type, title, body, url, createdAt: this.clock(), nextAttemptAt: this.clock(), attempts: 0, delivered: [], status: "pending" };
    const queued = await this.storage.transaction(async transaction => {
      if (await transaction.get(key)) return false;
      await transaction.put(key, eventRecord);
      return true;
    });
    await this.armNext();
    if (!queued) return json({ ok: true, duplicate: true });
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
    const now = this.clock();
    for (const product of products) {
      const id = String(product?.id || "").slice(0, 100);
      const endAt = Date.parse(String(product?.discountEndsAt || ""));
      if (!id || product?.discountTimerEnabled !== true || !discountPercent(product) || !Number.isFinite(endAt)) continue;
      const discountId = `discount:${encodeURIComponent(id)}:${endAt}`;
      const name = cleanText(product.name || product.names?.en || `Product ${id}`, 100) || `Product ${id}`;
      const schedules = [];
      if (endAt > now) {
        const warning = discountEvent(product, "discount_expiring", endAt);
        schedules.push({ id: warning.eventId, dueAt: Math.max(now + 1000, endAt - 24 * 60 * 60 * 1000), event: warning });
      }
      const expired = discountEvent(product, "discount_expired", endAt);
      schedules.push({ id: expired.eventId, dueAt: Math.max(now + 1000, endAt), event: expired });
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

    const subscriptions = await this.storage.list({ prefix: SUBSCRIPTION_PREFIX });
    const events = await this.storage.list({ prefix: EVENT_PREFIX });
    for (const [key, event] of events) {
      if (Number(event?.createdAt) < now - RETENTION_MS && event?.status !== "pending") {
        await this.storage.delete(key);
        continue;
      }
      if (event?.status !== "pending" || Number(event.nextAttemptAt) > now) continue;
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
        try { result = await this.send(stored.subscription, { title: event.title, body: event.body, tag: event.eventId, data: { eventId: event.eventId, type: event.type, url: event.url } }); }
        catch { result = { ok: false, status: 0 }; }
        if (result?.ok) {
          delivered.add(subscriptionKey);
          await this.storage.put(subscriptionKey, { ...stored, failures: 0, lastSuccessAt: now });
          continue;
        }
        if (result?.remove) {
          await this.storage.delete(subscriptionKey);
          permanentFailure = true;
          continue;
        }
        if (Number(result?.status) === 0 || Number(result?.status) === 429 || Number(result?.status) >= 500) {
          transientFailure = true;
          await this.storage.put(subscriptionKey, { ...stored, failures: (Number(stored.failures) || 0) + 1, lastFailureAt: now });
          continue;
        }
        // Authentication or malformed responses are not retried forever.
        permanentFailure = true;
        await this.storage.put(subscriptionKey, { ...stored, lastFailureAt: now, lastFailureStatus: Number(result?.status) || 0 });
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
    const subscriptions = await this.storage.list({ prefix: CUSTOMER_SUBSCRIPTION_PREFIX });
    const events = await this.storage.list({ prefix: CUSTOMER_EVENT_PREFIX });
    for (const [key, event] of events) {
      if (Number(event?.createdAt) < now - RETENTION_MS && event?.status !== "pending") {
        await this.storage.delete(key);
        continue;
      }
      if (event?.status !== "pending" || Number(event.nextAttemptAt) > now) continue;
      const targets = [...subscriptions.entries()].filter(([, stored]) => stored?.preferences?.[event.preference] === true);
      if (!targets.length) {
        await this.storage.put(key, { ...event, status: "no_subscribers", completedAt: now });
        continue;
      }
      const delivered = new Set(event.delivered || []);
      const failed = new Set(event.failed || []);
      const pending = targets.filter(([subscriptionKey]) => !delivered.has(subscriptionKey) && !failed.has(subscriptionKey));
      if (!pending.length) {
        const status = Number(event.failedCount) ? (delivered.size ? "partial" : "failed") : event.skippedAfterOptOut && !delivered.size ? "no_subscribers" : "sent";
        await this.storage.put(key, { ...event, status, completedAt: now });
        continue;
      }
      const batch = pending.slice(0, DELIVERY_BATCH_SIZE);
      const moreRemain = pending.length > batch.length;
      let transientFailure = false;
      let permanentFailure = false;
      let skippedAfterOptOut = Boolean(event.skippedAfterOptOut);
      for (const [subscriptionKey, stored] of batch) {
        const latest = await this.storage.get(subscriptionKey);
        if (!latest || latest.customerId !== stored.customerId || latest.preferences?.[event.preference] !== true) {
          skippedAfterOptOut = true;
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
          await this.storage.put(subscriptionKey, { ...stored, failures: 0, lastSuccessAt: now });
          continue;
        }
        if (result?.remove) {
          await this.storage.delete(subscriptionKey);
          permanentFailure = true;
          failed.add(subscriptionKey);
          continue;
        }
        if (Number(result?.status) === 0 || Number(result?.status) === 429 || Number(result?.status) >= 500) {
          transientFailure = true;
          await this.storage.put(subscriptionKey, { ...stored, failures: (Number(stored.failures) || 0) + 1, lastFailureAt: now });
          continue;
        }
        permanentFailure = true;
        failed.add(subscriptionKey);
        await this.storage.put(subscriptionKey, { ...stored, lastFailureAt: now, lastFailureStatus: Number(result?.status) || 0 });
      }

      if (transientFailure && Number(event.attempts) + 1 < MAX_RETRIES) {
        const attempts = Number(event.attempts) + 1;
        const waitMs = Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(attempts, 7)));
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterOptOut, attempts, nextAttemptAt: now + waitMs, lastAttemptAt: now });
      } else if (moreRemain) {
        if (transientFailure && Number(event.attempts) + 1 >= MAX_RETRIES) for (const [subscriptionKey] of batch) if (!delivered.has(subscriptionKey)) failed.add(subscriptionKey);
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterOptOut, attempts: Number(event.attempts) + (transientFailure ? 1 : 0), nextAttemptAt: now + (transientFailure ? Math.min(60 * 60 * 1000, 30 * 1000 * (2 ** Math.min(Number(event.attempts) + 1, 7))) : 1000), lastAttemptAt: now });
      } else {
        if (transientFailure) for (const [subscriptionKey] of batch) if (!delivered.has(subscriptionKey)) failed.add(subscriptionKey);
        const status = transientFailure || permanentFailure || failed.size ? (delivered.size ? "partial" : "failed") : skippedAfterOptOut && !delivered.size ? "no_subscribers" : "sent";
        await this.storage.put(key, { ...event, delivered: [...delivered], failed: [...failed], failedCount: failed.size, skippedAfterOptOut, attempts: Number(event.attempts) + 1, nextAttemptAt: 0, status, completedAt: now });
      }
    }
  }
}
