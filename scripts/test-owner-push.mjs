import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { PushCoordinator } from "../sync-hub/push.mjs";
import { base64UrlToBytes, bytesToBase64Url, createVapidAuthorization, encryptWebPush, sendWebPush } from "../sync-hub/webpush.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const b64 = bytes => bytesToBase64Url(bytes);
const decode = value => base64UrlToBytes(value);
const hexHash = async value => [...new Uint8Array(await webcrypto.subtle.digest("SHA-256", encoder.encode(String(value))))].map(byte => byte.toString(16).padStart(2, "0")).join("");

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = 0; this.lock = Promise.resolve(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async list({ prefix = "" } = {}) { return new Map([...this.values].filter(([key]) => String(key).startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)])); }
  async transaction(callback) {
    const previous = this.lock;
    let release;
    this.lock = new Promise(resolve => { release = resolve; });
    await previous;
    const draft = new Map([...this.values].map(([key, value]) => [key, structuredClone(value)]));
    const tx = {
      get: async key => draft.get(key),
      put: async (key, value) => draft.set(key, structuredClone(value)),
      delete: async key => draft.delete(key),
      list: async ({ prefix = "" } = {}) => new Map([...draft].filter(([key]) => String(key).startsWith(prefix))),
    };
    try {
      const result = await callback(tx);
      this.values = draft;
      return result;
    } finally { release(); }
  }
  async setAlarm(value) { this.alarmAt = Number(value); }
  async deleteAlarm() { this.alarmAt = 0; }
}

class MemoryOwnerPushD1 {
  rows = new Map();
  customerRows = new Map();
  customerPreferences = new Map();
  shopState = new Map();
  failNextWrite = false;

  prepare(sql) {
    const statement = {
      sql, values: [],
      bind: (...values) => { statement.values = values; return statement; },
      first: async () => this.first(statement.sql, statement.values),
      all: async () => this.all(statement.sql, statement.values),
      run: async () => this.run(statement.sql, statement.values),
    };
    return statement;
  }

  async first(sql, values) {
    if (sql.includes("FROM shop_state WHERE key=?")) return this.shopState.has(String(values[0])) ? { key: String(values[0]), value: this.shopState.get(String(values[0])) } : null;
    if (sql.includes("FROM customer_push_subscriptions s LEFT JOIN")) {
      const row = this.customerRows.get(String(values[0]));
      return row ? { ...row, ...(this.customerPreferences.get(row.customer_id) || {}) } : null;
    }
    if (sql.includes("FROM customer_push_subscriptions") && sql.includes("WHERE customer_id=?")) return [...this.customerRows.values()].find(row => row.customer_id === String(values[0])) || null;
    if (sql.includes("FROM customer_push_subscriptions")) return this.customerRows.get(String(values[0])) || null;
    if (sql.includes("FROM customer_push_preferences")) return this.customerPreferences.get(String(values[0])) || null;
    if (!sql.includes("owner_push_subscriptions")) return null;
    if (sql.includes("WHERE endpoint_hash=?")) return this.rows.get(String(values[0])) || null;
    return null;
  }

  async all(sql, values) {
    if (sql.includes("FROM customer_push_subscriptions s LEFT JOIN")) return { success: true, results: [...this.customerRows.values()].map(row => ({ ...row, ...(this.customerPreferences.get(row.customer_id) || {}) })) };
    if (sql.includes("FROM customer_push_subscriptions")) return { success: true, results: [...this.customerRows.values()].filter(row => !sql.includes("WHERE customer_id=?") || row.customer_id === String(values[0])).map(row => structuredClone(row)) };
    if (!sql.includes("owner_push_subscriptions")) return { success: true, results: [] };
    const rows = [...this.rows.values()].filter(row => !sql.includes("WHERE owner_id=?") || row.owner_id === String(values[0]));
    return { success: true, results: structuredClone(rows) };
  }

  async run(sql, values) {
    if (sql.startsWith("INSERT INTO customer_push_preferences")) {
      if (this.failNextWrite) { this.failNextWrite = false; throw new Error("Simulated D1 customer preference write failure"); }
      const [customer_id, new_arrivals, discounts, special_offers, announcements, updated_at] = values;
      this.customerPreferences.set(customer_id, { customer_id, new_arrivals, discounts, special_offers, announcements, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("INSERT INTO customer_push_subscriptions")) {
      if (this.failNextWrite) { this.failNextWrite = false; throw new Error("Simulated D1 customer subscription write failure"); }
      const [endpoint_hash, customer_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at] = values;
      const existing = this.customerRows.get(endpoint_hash);
      if (existing && existing.customer_id !== customer_id) return { success: true, meta: { changes: 0 } };
      this.customerRows.set(endpoint_hash, { endpoint_hash, customer_id, endpoint, p256dh, auth_secret, expiration_time, created_at: existing?.created_at || created_at, updated_at, failures: 0, last_success_at: null, last_failure_at: null, last_failure_status: null });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM customer_push_subscriptions")) {
      const [endpoint_hash, customer_id, replacementHash, replacementCustomerId] = values;
      const row = this.customerRows.get(endpoint_hash);
      if (!row || row.customer_id !== customer_id) return { success: true, meta: { changes: 0 } };
      if (values.length === 4) { const replacement = this.customerRows.get(replacementHash); if (!replacement || replacement.customer_id !== replacementCustomerId) return { success: true, meta: { changes: 0 } }; }
      this.customerRows.delete(endpoint_hash);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE customer_push_subscriptions")) {
      const [failures, last_success_at, last_failure_at, last_failure_status, updated_at, endpoint_hash, customer_id] = values;
      const row = this.customerRows.get(endpoint_hash);
      if (!row || row.customer_id !== customer_id) return { success: true, meta: { changes: 0 } };
      this.customerRows.set(endpoint_hash, { ...row, failures, last_success_at, last_failure_at, last_failure_status, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    if (!sql.includes("owner_push_subscriptions")) return { success: true, meta: { changes: 0 } };
    if (this.failNextWrite) { this.failNextWrite = false; throw new Error("Simulated D1 owner push write failure"); }
    if (sql.startsWith("INSERT INTO owner_push_subscriptions")) {
      const [endpoint_hash, owner_id, endpoint, p256dh, auth_secret, expiration_time, created_at, updated_at] = values;
      const existing = this.rows.get(endpoint_hash);
      if (existing && existing.owner_id !== owner_id) return { success: true, meta: { changes: 0 } };
      this.rows.set(endpoint_hash, {
        endpoint_hash, owner_id, endpoint, p256dh, auth_secret, expiration_time,
        created_at: existing?.created_at || created_at, updated_at, failures: 0,
        last_success_at: null, last_failure_at: null, last_failure_status: null,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("DELETE FROM owner_push_subscriptions")) {
      const [endpoint_hash, owner_id] = values;
      const row = this.rows.get(endpoint_hash);
      if (!row || row.owner_id !== owner_id) return { success: true, meta: { changes: 0 } };
      if (values.length === 4) {
        const [,, replacementHash, replacementOwnerId] = values;
        const replacement = this.rows.get(replacementHash);
        if (!replacement || replacement.owner_id !== replacementOwnerId) return { success: true, meta: { changes: 0 } };
      }
      this.rows.delete(endpoint_hash);
      return { success: true, meta: { changes: 1 } };
    }
    if (sql.startsWith("UPDATE owner_push_subscriptions")) {
      const [failures, last_success_at, last_failure_at, last_failure_status, updated_at, endpoint_hash, owner_id] = values;
      const row = this.rows.get(endpoint_hash);
      if (!row || row.owner_id !== owner_id) return { success: true, meta: { changes: 0 } };
      this.rows.set(endpoint_hash, { ...row, failures, last_success_at, last_failure_at, last_failure_status, updated_at });
      return { success: true, meta: { changes: 1 } };
    }
    return { success: true, meta: { changes: 0 } };
  }

  async batch(statements) {
    const snapshot = new Map([...this.rows].map(([key, row]) => [key, structuredClone(row)]));
    const customerSnapshot = new Map([...this.customerRows].map(([key, row]) => [key, structuredClone(row)]));
    const preferenceSnapshot = new Map([...this.customerPreferences].map(([key, row]) => [key, structuredClone(row)]));
    try {
      const results = [];
      for (const statement of statements) results.push(await this.run(statement.sql, statement.values));
      if (results.some(result => result?.success === false)) throw new Error("Simulated D1 batch failure");
      return results;
    } catch (error) {
      this.rows = snapshot;
      this.customerRows = customerSnapshot;
      this.customerPreferences = preferenceSnapshot;
      throw error;
    }
  }
}

function createHarness({ now = 1_800_000_000_000, send = async () => ({ ok: true, status: 201 }), env = {} } = {}) {
  const storage = new MemoryStorage();
  const ctx = { storage, getWebSockets: () => [] };
  const db = env.DB || new MemoryOwnerPushD1();
  const workerEnv = { ...env, DB: db };
  let clock = now;
  const coordinator = new PushCoordinator(ctx, workerEnv, { clock: () => clock, send });
  return { storage, ctx, db, coordinator, setNow: value => { clock = value; } };
}

function fakeSubscription(endpoint = "https://fcm.googleapis.com/fcm/send/test-endpoint") {
  return { endpoint, expirationTime: null, keys: { p256dh: b64(new Uint8Array([4, ...new Uint8Array(64).fill(7)])), auth: b64(new Uint8Array(16).fill(8)) } };
}

async function call(coordinator, path, { method = "GET", body, search = "" } = {}) {
  return coordinator.handle(new Request(`https://sync-hub.internal${path}${search}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined }));
}

async function listPrefix(storage, prefix) { return [...(await storage.list({ prefix })).values()]; }

async function testWebPushCrypto() {
  const vapidPair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const vapidJwk = await webcrypto.subtle.exportKey("jwk", vapidPair.privateKey);
  const vapidPublic = new Uint8Array(await webcrypto.subtle.exportKey("raw", vapidPair.publicKey));
  const vapidConfig = { publicKey: b64(vapidPublic), privateKey: b64(decode(vapidJwk.d)), subject: "mailto:shop-owner@example.test" };
  const configured = createHarness({ env: { VAPID_PUBLIC_KEY: vapidConfig.publicKey, VAPID_PRIVATE_KEY: vapidConfig.privateKey, VAPID_SUBJECT: vapidConfig.subject } });
  const publicConfig = await (await call(configured.coordinator, "/push/config")).json();
  assert.deepEqual(Object.keys(publicConfig).sort(), ["ok", "publicKey"], "the Worker configuration response contains only its status and public key");
  assert.equal(publicConfig.publicKey, vapidConfig.publicKey);
  assert.equal(JSON.stringify(publicConfig).includes(vapidConfig.privateKey), false, "the config endpoint never returns the VAPID private key");
  const workerSource = await readFile(new URL("../sync-hub/push.mjs", import.meta.url), "utf8");
  for (const variable of ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]) assert.ok(workerSource.includes(`env.${variable}`), `the Worker reads the exact ${variable} binding`);
  const endpoint = "https://fcm.googleapis.com/fcm/send/local-only";
  const authorization = await createVapidAuthorization(endpoint, vapidConfig, 1_800_000_000_000);
  const [header, claims, signature] = authorization.token.split(".");
  const publicJwk = { kty: "EC", crv: "P-256", x: b64(vapidPublic.slice(1, 33)), y: b64(vapidPublic.slice(33, 65)), ext: true, key_ops: ["verify"] };
  const verifyKey = await webcrypto.subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await webcrypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, verifyKey, decode(signature), encoder.encode(`${header}.${claims}`)), true, "VAPID JWT uses a valid ES256 signature");
  const parsedClaims = JSON.parse(decoder.decode(decode(claims)));
  assert.equal(parsedClaims.aud, "https://fcm.googleapis.com");
  assert.equal(parsedClaims.sub, vapidConfig.subject);

  const receiver = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const receiverPublic = new Uint8Array(await webcrypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = webcrypto.getRandomValues(new Uint8Array(16));
  const subscription = { endpoint, keys: { p256dh: b64(receiverPublic), auth: b64(auth) } };
  const payload = { title: "New order received", body: "Order #test-1 is ready.", tag: "order:test-1" };
  const encrypted = await encryptWebPush(subscription, payload);
  const salt = encrypted.slice(0, 16);
  const keyLength = encrypted[20];
  const senderPublic = encrypted.slice(21, 21 + keyLength);
  const senderKey = await webcrypto.subtle.importKey("raw", senderPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await webcrypto.subtle.deriveBits({ name: "ECDH", public: senderKey }, receiver.privateKey, 256));
  const keyInfo = new Uint8Array(13 + receiverPublic.length + senderPublic.length);
  keyInfo.set(encoder.encode("WebPush: info\0"));
  keyInfo.set(receiverPublic, 13);
  keyInfo.set(senderPublic, 13 + receiverPublic.length);
  const hkdf = async (ikm, hkdfSalt, info, length) => {
    const key = await webcrypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await webcrypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: hkdfSalt, info }, key, length * 8));
  };
  const ikm = await hkdf(shared, auth, keyInfo, 32);
  const cek = await hkdf(ikm, salt, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode("Content-Encoding: nonce\0"), 12);
  const contentKey = await webcrypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plaintext = new Uint8Array(await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, contentKey, encrypted.slice(21 + keyLength)));
  assert.equal(plaintext[plaintext.length - 1], 2, "RFC 8291 record terminator is present");
  assert.deepEqual(JSON.parse(decoder.decode(plaintext.slice(0, -1))), payload, "push payload decrypts with the subscriber keys");

  let sentRequest;
  const sent = await sendWebPush(subscription, payload, vapidConfig, async (url, options) => {
    sentRequest = { url, options };
    return new Response(null, { status: 201 });
  }, 1_800_000_000_000);
  assert.equal(sent.ok, true);
  assert.equal(sentRequest.options.headers["Content-Encoding"], "aes128gcm");
  assert.match(sentRequest.options.headers.Authorization, /^vapid t=/);
  assert.equal((await sendWebPush(subscription, payload, vapidConfig, async () => new Response(null, { status: 410 }))).remove, true, "expired push endpoints are identified for pruning");
  assert.equal((await sendWebPush({ ...subscription, endpoint: "https://attacker.example/push" }, payload, vapidConfig)).remove, true, "unapproved endpoints are never called");
}

async function testSubscriptionsAndAuthorization() {
  const h = createHarness({ env: { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private", VAPID_SUBJECT: "mailto:owner@example.test" } });
  assert.equal((await call(createHarness().coordinator, "/push/config")).status, 503, "missing VAPID configuration is reported honestly");
  assert.equal((await call(h.coordinator, "/push/config")).status, 503, "malformed server key is not exposed as a usable config");

  const base = "https://fcm.googleapis.com/fcm/send/device-";
  const first = fakeSubscription(base + "1");
  const firstRegistration = await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: first } });
  assert.equal(firstRegistration.status, 200);
  assert.equal(h.db.rows.size, 1, "new Owner push subscriptions are persisted in the shared D1 table");
  const savedSubscription = [...h.db.rows.values()][0];
  assert.equal(savedSubscription.owner_id, "owner-A");
  assert.equal(savedSubscription.endpoint, first.endpoint);
  assert.equal(savedSubscription.p256dh, first.keys.p256dh);
  assert.equal(savedSubscription.auth_secret, first.keys.auth);
  assert.equal((await firstRegistration.clone().json()).registered, true);
  assert.equal(JSON.stringify(await firstRegistration.json()).includes(first.endpoint), false, "subscription responses never disclose the saved endpoint");
  assert.equal((await listPrefix(h.storage, "shivan-push:subscription:")).length, 0, "new Owner subscriptions are not duplicated into Durable Object storage");
  assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-B", subscription: first } })).status, 409, "a second owner cannot claim an existing browser endpoint");
  const status = async (ownerId, endpoint) => call(h.coordinator, "/push/subscription-status", { method: "POST", body: { ownerId, endpoint } });
  assert.equal((await (await status("owner-A", first.endpoint)).json()).registered, true);
  assert.equal((await (await status("owner-B", first.endpoint)).json()).registered, false, "subscription status is isolated by owner");
  assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: { ...first, endpoint: "https://attacker.example/steal" } } })).status, 400);

  const renewed = fakeSubscription(base + "renewed");
  assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: renewed, previousEndpoint: first.endpoint } })).status, 200);
  assert.equal((await (await status("owner-A", first.endpoint)).json()).registered, false, "renewal removes the old endpoint");
  assert.equal((await (await status("owner-A", renewed.endpoint)).json()).registered, true);
  for (let i = 2; i <= 10; i++) {
    const sub = fakeSubscription(base + i);
    assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: sub } })).status, 200);
  }
  assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: fakeSubscription(base + "11") } })).status, 429, "device subscription cap is enforced");
  const wrongOwnerDelete = await call(h.coordinator, "/push/unsubscribe", { method: "POST", body: { ownerId: "owner-B", endpoint: renewed.endpoint } });
  assert.equal((await wrongOwnerDelete.json()).removed, false, "one owner cannot delete another owner's subscription");
  const removed = await call(h.coordinator, "/push/unsubscribe", { method: "POST", body: { ownerId: "owner-A", endpoint: renewed.endpoint } });
  assert.equal((await removed.json()).removed, true);
  assert.equal([...h.db.rows.values()].some(row => row.endpoint === renewed.endpoint), false, "unsubscribe removes the authenticated Owner device from D1");

  const failedStorage = createHarness();
  failedStorage.db.failNextWrite = true;
  const storageFailure = await call(failedStorage.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: first } });
  assert.equal(storageFailure.status, 503, "D1 write failures are reported instead of claiming registration succeeded");
  assert.equal(failedStorage.db.rows.size, 0);

  const failedCustomerStorage = createHarness();
  failedCustomerStorage.db.failNextWrite = true;
  const customerStorageFailure = await call(failedCustomerStorage.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: first } });
  assert.equal(customerStorageFailure.status, 503, "customer D1 failures are reported without claiming registration succeeded");
  assert.equal(failedCustomerStorage.db.customerRows.size, 0);
  assert.equal(failedCustomerStorage.db.customerPreferences.size, 0, "customer registration never writes per-topic preference records");
}

async function testCrossAudienceEndpointExclusivity() {
  const endpoint = "https://fcm.googleapis.com/fcm/send/shared-audience-endpoint";
  const ownerSubscription = fakeSubscription(endpoint);
  const customerSubscription = fakeSubscription(endpoint);
  const ownerFirst = createHarness();
  assert.equal((await call(ownerFirst.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSubscription } })).status, 200);
  const customerAfterOwner = await call(ownerFirst.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: customerSubscription } });
  assert.equal(customerAfterOwner.status, 409, "a customer cannot claim a D1 endpoint already registered to the Owner");
  assert.equal(ownerFirst.db.rows.size, 1, "rejecting a cross-audience claim preserves the Owner subscription");
  assert.equal(ownerFirst.db.customerRows.size, 0, "a rejected cross-audience claim creates no customer row");

  const customerFirst = createHarness();
  assert.equal((await call(customerFirst.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: customerSubscription } })).status, 200);
  const ownerAfterCustomer = await call(customerFirst.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSubscription } });
  assert.equal(ownerAfterCustomer.status, 409, "the Owner cannot claim a D1 endpoint already registered to a customer");
  assert.equal(customerFirst.db.customerRows.size, 1, "rejecting the Owner claim preserves the customer subscription");
  assert.equal(customerFirst.db.rows.size, 0, "a rejected Owner claim creates no Owner row");

  const endpointHash = await hexHash(endpoint);
  const legacyOwner = createHarness();
  await legacyOwner.storage.put(`shivan-push:subscription:${endpointHash}`, { ownerId: "owner-A", subscription: ownerSubscription });
  assert.equal((await call(legacyOwner.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: customerSubscription } })).status, 409, "legacy Owner Durable Object subscriptions also block customer registration");
  assert.equal((await legacyOwner.storage.get(`shivan-push:subscription:${endpointHash}`)).ownerId, "owner-A", "legacy Owner records are preserved on conflict");

  const legacyCustomer = createHarness();
  await legacyCustomer.storage.put(`shivan-push:customer-subscription:${endpointHash}`, { customerId: "customer-A", subscription: customerSubscription, preferences: { newArrivals: false, discounts: false, specialOffers: false, announcements: false } });
  assert.equal((await call(legacyCustomer.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSubscription } })).status, 409, "legacy customer Durable Object subscriptions also block Owner registration");
  assert.equal((await legacyCustomer.storage.get(`shivan-push:customer-subscription:${endpointHash}`)).customerId, "customer-A", "legacy customer records are preserved on conflict");

  const preexistingConflict = createHarness();
  preexistingConflict.db.rows.set(endpointHash, { endpoint_hash: endpointHash, owner_id: "owner-A", endpoint, created_at: 1 });
  preexistingConflict.db.customerRows.set(endpointHash, { endpoint_hash: endpointHash, customer_id: "customer-A", endpoint, created_at: 1 });
  assert.equal((await call(preexistingConflict.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSubscription } })).status, 409, "a pre-existing cross-audience D1 collision is detected without overwriting either row");
  assert.equal((await call(preexistingConflict.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: customerSubscription } })).status, 409);
  assert.equal(preexistingConflict.db.rows.size, 1, "a pre-existing Owner row is preserved");
  assert.equal(preexistingConflict.db.customerRows.size, 1, "a pre-existing customer row is preserved");

  const raced = createHarness();
  const [ownerRace, customerRace] = await Promise.all([
    call(raced.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSubscription } }),
    call(raced.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: customerSubscription } }),
  ]);
  assert.deepEqual([ownerRace.status, customerRace.status].sort(), [200, 409], "concurrent Owner/customer registration of one endpoint has exactly one winner");
  assert.equal(raced.db.rows.size + raced.db.customerRows.size, 1, "the endpoint lock prevents a cross-audience race from writing both tables");
  assert.equal(raced.db.rows.has(endpointHash) && raced.db.customerRows.has(endpointHash), false, "one endpoint hash never exists in both D1 audience tables");
}

async function testLegacyOwnerSubscriptionsRemainDeliverable() {
  const sent = [];
  const h = createHarness({ send: async (subscription, payload) => { sent.push({ endpoint: subscription.endpoint, payload }); return { ok: true, status: 201 }; } });
  const current = fakeSubscription("https://fcm.googleapis.com/fcm/send/current-device");
  const oldDevice = fakeSubscription("https://fcm.googleapis.com/fcm/send/legacy-device");
  await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: current } });
  const currentHash = await hexHash(current.endpoint);
  await h.storage.put(`shivan-push:subscription:${currentHash}`, { ownerId: "owner-A", subscription: fakeSubscription(current.endpoint), failures: 0 });
  await h.storage.put(`shivan-push:subscription:${await hexHash(oldDevice.endpoint)}`, { ownerId: "owner-A", subscription: oldDevice, failures: 0 });
  const event = { eventId: "order:legacy-migration", type: "new_order", title: "New order received", body: "Order is ready.", url: "/?ownerPush=orders" };
  await call(h.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event } });
  await h.coordinator.alarm();
  assert.deepEqual(sent.map(item => item.endpoint).sort(), [current.endpoint, oldDevice.endpoint].sort(), "D1 and existing Durable Object subscriptions are both delivered without duplicate sends");
  assert.equal((await listPrefix(h.storage, "shivan-push:event:"))[0].status, "sent");
}

async function testOwnerSingleDeviceTestNotification() {
  const sent = [];
  const h = createHarness({ send: async (subscription, payload) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    sent.push({ endpoint: subscription.endpoint, payload });
    return { ok: true, status: 201 };
  } });
  const ownerPhone = fakeSubscription("https://fcm.googleapis.com/fcm/send/owner-phone");
  const ownerLaptop = fakeSubscription("https://fcm.googleapis.com/fcm/send/owner-laptop");
  const customerPhone = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-phone");
  for (const subscription of [ownerPhone, ownerLaptop]) {
    assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription } })).status, 200);
  }
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: {
    customerId: "customer-A", subscription: customerPhone,
  } })).status, 200);

  const requestId = "one-device-test-123";
  const request = () => call(h.coordinator, "/push/test", { method: "POST", body: {
    ownerId: "owner-A", endpoint: ownerPhone.endpoint, requestId,
  } });
  const concurrent = await Promise.all([request(), request()]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409], "concurrent duplicate taps send only one test");
  assert.equal(sent.length, 1, "exactly one push send is attempted");
  assert.equal(sent[0].endpoint, ownerPhone.endpoint, "the test goes only to the requested registered Owner device");
  assert.equal(sent[0].payload.title, "Shivan Shop push test");
  assert.equal(sent[0].payload.data.audience, "owner");
  assert.equal(sent[0].payload.data.type, "test");
  assert.equal(sent[0].payload.data.url, "/?ownerPush=alerts");
  assert.equal((await request()).status, 200, "a later retry with the same request ID returns the prior accepted result");
  assert.equal(sent.length, 1, "retry does not send a second notification");
  assert.equal((await call(h.coordinator, "/push/test", { method: "POST", body: {
    ownerId: "owner-A", endpoint: ownerLaptop.endpoint, requestId,
  } })).status, 409, "the same request ID cannot be redirected to another Owner device");
  assert.equal((await call(h.coordinator, "/push/test", { method: "POST", body: {
    ownerId: "owner-A", endpoint: customerPhone.endpoint, requestId: "customer-target-123",
  } })).status, 404, "a customer subscription cannot be used as an Owner test target");
  assert.equal(sent.some(item => item.endpoint === ownerLaptop.endpoint || item.endpoint === customerPhone.endpoint), false);

  let failedSends = 0;
  const failed = createHarness({ send: async () => { failedSends++; return { ok: false, status: 503 }; } });
  await call(failed.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerPhone } });
  const failedBody = { ownerId: "owner-A", endpoint: ownerPhone.endpoint, requestId: "failed-test-request-1" };
  assert.equal((await call(failed.coordinator, "/push/test", { method: "POST", body: failedBody })).status, 502, "delivery rejection is reported as failure");
  assert.equal((await call(failed.coordinator, "/push/test", { method: "POST", body: failedBody })).status, 409, "a failed request is not silently resent under the same id");
  assert.equal(failedSends, 1, "a failed test requires a new explicit request ID before another attempt");
}

async function testCustomerSubscriptionsGlobalBroadcasts() {
  const sent = [];
  const h = createHarness({ send: async (subscription, payload) => { sent.push({ endpoint: subscription.endpoint, payload }); return { ok: true, status: 201 }; } });
  h.db.shopState.set("shivan_shop_products", JSON.stringify([
    { id: "dress-7", name: "Dress 7", published: true },
    { id: "dress-8", name: "Dress 8", discount: 25, published: true },
  ]));
  const oldPreferences = new Map([
    ["customer-A", { customer_id: "customer-A", new_arrivals: 0, discounts: 0, special_offers: 0, announcements: 0, updated_at: 1 }],
    ["customer-B", { customer_id: "customer-B", new_arrivals: 0, discounts: 0, special_offers: 0, announcements: 0, updated_at: 2 }],
    ["customer-D", { customer_id: "customer-D", new_arrivals: 0, discounts: 0, special_offers: 0, announcements: 0, updated_at: 3 }],
  ]);
  h.db.customerPreferences = new Map([...oldPreferences].map(([key, row]) => [key, structuredClone(row)]));
  const preferencesBefore = new Map([...h.db.customerPreferences].map(([key, row]) => [key, structuredClone(row)]));
  const arrivalSub = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-arrival");
  const discountSub = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-discount");
  const discountSubSecondDevice = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-discount-second");
  const announcementSub = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-announcement");
  const ownerSub = fakeSubscription("https://fcm.googleapis.com/fcm/send/owner-only-device");
  const noTopicSub = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-no-topics");
  assert.equal((await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: ownerSub } })).status, 200);
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: arrivalSub } })).status, 200, "permission plus a valid subscription is sufficient to opt in to every shop notification");
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-B", subscription: discountSub, preferences: { discounts: false } } })).status, 200, "legacy per-topic request fields are ignored");
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-B", subscription: discountSubSecondDevice } })).status, 200);
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-D", subscription: announcementSub } })).status, 200);
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-C", subscription: noTopicSub } })).status, 200, "customer subscriptions no longer require topic selection");
  assert.equal(h.db.customerRows.size, 5, "customer subscriptions are stored in their own D1 table, separate from Owner devices");
  assert.equal(h.db.rows.size, 1, "Owner devices remain in their separate subscription table");
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-C", subscription: arrivalSub } })).status, 409, "one customer cannot claim another customer's endpoint");
  assert.deepEqual(h.db.customerPreferences, preferencesBefore, "subscription changes leave historical preference records untouched");
  const status = await call(h.coordinator, "/push/customer-subscription-status", { method: "POST", body: { customerId: "customer-A", endpoint: arrivalSub.endpoint } });
  assert.equal((await status.json()).registered, true);
  const notificationStatus = await call(h.coordinator, "/push/customer-notification-status", { method: "POST", body: { customerId: "customer-A", preferences: { action: "get" } } });
  const notificationStatusBody = await notificationStatus.json();
  assert.equal(notificationStatusBody.notificationsEnabled, true, "compatibility status reports whether the account has a subscribed device");
  assert.equal(Object.hasOwn(notificationStatusBody, "preferences"), false, "customer status no longer exposes topic settings");
  const ignoredOldPreferences = await call(h.coordinator, "/push/customer-notification-status", { method: "POST", body: { customerId: "customer-B", preferences: { newArrivals: false, discounts: false, specialOffers: false, announcements: false } } });
  assert.equal((await ignoredOldPreferences.json()).notificationsEnabled, true, "old clients cannot disable broadcasts through topic settings");
  assert.deepEqual(h.db.customerPreferences, preferencesBefore, "compatibility status never overwrites stored preference records");

  const arrival = { eventId: "new-arrival:dress-7", type: "new_arrival", title: "New arrival: Dress 7", body: "A new fashion model is here.", url: "/?customerPush=product&productId=dress-7", productId: "dress-7", image: "/api/media/shop/" + "a".repeat(43) + ".webp" };
  const discount = { eventId: "discount:dress-8:25:ongoing", type: "discount", title: "25% off: Dress 8", body: "A new 25% offer is available.", url: "/?customerPush=product&productId=dress-8", productId: "dress-8" };
  const offer = { eventId: "special-offer:campaign-12345", type: "special_offer", title: "Weekend offer", body: "A special offer is ready.", url: "/?customerPush=offers&offerId=special-offer%3Acampaign-12345" };
  const announcement = { eventId: "announcement:store-update-12345", type: "announcement", title: "Store update", body: "New opening hours start Monday.", url: "/?customerPush=offers&offerId=announcement%3Astore-update-12345" };
  const duplicates = await Promise.all(Array.from({ length: 6 }, () => call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: arrival } })));
  assert.equal(duplicates.filter(response => response.status === 202).length, 1, "concurrent duplicate arrival events queue once");
  assert.equal((await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: discount } })).status, 202);
  assert.equal((await call(h.coordinator, "/push/customer-broadcast", { method: "POST", body: { ownerId: "owner-A", event: offer } })).status, 202);
  assert.equal((await call(h.coordinator, "/push/customer-broadcast", { method: "POST", body: { ownerId: "owner-A", event: announcement } })).status, 202);
  const queuedArrival = (await listPrefix(h.storage, "shivan-push:customer-event:")).find(item => item.eventId === arrival.eventId);
  assert.equal(queuedArrival.audience, "All subscribed customer devices");
  assert.equal(Object.hasOwn(queuedArrival, "preference"), false, "queued customer events do not retain topic filters");
  assert.equal((await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: { ...arrival, eventId: "new-arrival:deleted", productId: "not-in-catalog" } } })).status, 409, "unpublished or deleted products cannot be queued for customers");
  assert.equal((await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: { ...discount, eventId: "discount:no-longer-active", productId: "dress-7" } } })).status, 409, "a discount event is rejected when the saved product has no active discount");
  assert.equal((await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: { ...offer, eventId: "bad-image-offer", image: "data:image/png;base64,private" } } })).status, 400, "only saved shop image URLs can accompany notifications");
  await h.coordinator.alarm();
  const customerEndpoints = [arrivalSub, discountSub, discountSubSecondDevice, announcementSub, noTopicSub].map(item => item.endpoint).sort();
  assert.equal(sent.length, 20, "all four event types reach all five opted-in customer devices regardless of historic topic settings");
  for (const type of ["new_arrival", "discount", "special_offer", "announcement"]) {
    assert.deepEqual(sent.filter(row => row.payload.data.type === type).map(row => row.endpoint).sort(), customerEndpoints, `${type} reaches every eligible customer device`);
  }
  assert.equal(sent.some(row => row.endpoint === ownerSub.endpoint), false, "customer broadcasts never reach Owner-only subscriptions");
  assert.equal(sent.find(row => row.payload.data.type === "new_arrival").payload.image, arrival.image, "supported product image path is included");
  assert.equal(sent.find(row => row.payload.data.type === "new_arrival").payload.data.url, arrival.url, "new-arrival click target identifies the exact product");
  const history = await call(h.coordinator, "/push/customer-broadcasts");
  const rows = (await history.json()).broadcasts;
  assert.equal(rows.length, 4, "Owner history includes customer notifications, announcements, and automatic product events");
  assert.equal(JSON.stringify(rows).includes(arrivalSub.endpoint), false, "Owner history never exposes subscription endpoints");
  assert.equal(JSON.stringify(rows).includes("customer-A"), false, "Owner history never exposes customer account IDs");
  const publicOffer = await call(h.coordinator, "/push/customer-offer", { search: `?eventId=${encodeURIComponent(offer.eventId)}` });
  assert.equal((await publicOffer.json()).offer.title, offer.title, "promotion click can retrieve the public offer content without subscription details");
  const publicAnnouncement = await call(h.coordinator, "/push/customer-offer", { search: `?eventId=${encodeURIComponent(announcement.eventId)}` });
  assert.equal((await publicAnnouncement.json()).offer.type, "announcement", "important announcement click opens only its sanitized public message");

  const allDevicesStatus = await call(h.coordinator, "/push/customer-notification-status", { method: "POST", body: { customerId: "customer-B", endpoint: discountSub.endpoint, preferences: { newArrivals: false, discounts: false, specialOffers: false, announcements: false } } });
  assert.equal((await allDevicesStatus.json()).registered, true, "topic fields cannot turn off an active device subscription");
  assert.deepEqual(h.db.customerPreferences, preferencesBefore, "customer broadcasts never modify legacy preference rows");
  await call(h.coordinator, "/push/customer-unsubscribe", { method: "POST", body: { customerId: "customer-A", endpoint: arrivalSub.endpoint } });
  await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: { ...offer, eventId: "special-offer:after-unsubscribe" } } });
  await h.coordinator.alarm();
  const followup = sent.filter(row => row.payload.data.eventId === "special-offer:after-unsubscribe");
  assert.equal(followup.length, 4, "explicitly unsubscribed devices stop receiving later notifications");
  assert.equal(followup.some(row => row.endpoint === arrivalSub.endpoint), false);
  assert.equal((await (await call(h.coordinator, "/push/customer-subscription-status", { method: "POST", body: { customerId: "customer-A", endpoint: arrivalSub.endpoint } })).json()).registered, false, "customers can remove their device subscription");
  assert.equal((await listPrefix(h.storage, "shivan-push:subscription:")).length, 0, "customer subscriptions remain separate from Owner subscriptions");

  let fail = true;
  const retry = createHarness({ send: async () => fail ? { ok: false, status: 503 } : { ok: true, status: 201 } });
  await call(retry.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: arrivalSub } });
  await call(retry.coordinator, "/push/customer-broadcast", { method: "POST", body: { ownerId: "owner-A", event: offer } });
  await retry.coordinator.alarm();
  assert.equal((await listPrefix(retry.storage, "shivan-push:customer-event:"))[0].status, "pending", "customer delivery failures are retried");
  fail = false;retry.setNow((await listPrefix(retry.storage, "shivan-push:customer-event:"))[0].nextAttemptAt + 1);await retry.coordinator.alarm();
  assert.equal((await listPrefix(retry.storage, "shivan-push:customer-event:"))[0].status, "sent");
  const gone = createHarness({ send: async () => ({ ok: false, status: 410, remove: true }) });
  gone.db.shopState.set("shivan_shop_products", JSON.stringify([{ id: "dress-7", published: true }]));
  await call(gone.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: arrivalSub } });
  await call(gone.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: arrival } });await gone.coordinator.alarm();
  assert.equal((await listPrefix(gone.storage, "shivan-push:customer-subscription:")).length, 0, "expired customer endpoints are pruned");
  assert.equal(gone.db.customerRows.size, 0, "expired customer endpoints are pruned from D1");
}

async function testLegacyCustomerSubscriptionCompatibilityAndDeletedProductGuard() {
  const sent = [];
  const h = createHarness({ send: async (subscription, payload) => { sent.push({ endpoint: subscription.endpoint, payload }); return { ok: true, status: 201 }; } });
  h.db.shopState.set("shivan_shop_products", JSON.stringify([{ id: "dress-9", name: "Dress 9", published: true }]));
  const current = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-current");
  const legacy = fakeSubscription("https://fcm.googleapis.com/fcm/send/customer-legacy");
  assert.equal((await call(h.coordinator, "/push/customer-subscription", { method: "POST", body: { customerId: "customer-A", subscription: current, preferences: { newArrivals: true } } })).status, 200);
  const currentHash = await hexHash(current.endpoint);
  await h.storage.put(`shivan-push:customer-subscription:${currentHash}`, { customerId: "customer-A", subscription: current, preferences: { newArrivals: false }, failures: 0 });
  const legacyHash = await hexHash(legacy.endpoint);
  await h.storage.put(`shivan-push:customer-subscription:${legacyHash}`, { customerId: "customer-B", subscription: legacy, preferences: { newArrivals: true }, failures: 0 });
  const event = { eventId: "new-arrival:migration-compat", type: "new_arrival", title: "New arrival: Dress 9", body: "Available now.", url: "/?customerPush=product&productId=dress-9", productId: "dress-9" };
  await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event } });
  await h.coordinator.alarm();
  assert.deepEqual(sent.map(row => row.endpoint).sort(), [current.endpoint, legacy.endpoint].sort(), "existing customer subscriptions continue receiving notifications while D1 subscriptions are added");
  assert.equal(sent.filter(row => row.endpoint === current.endpoint).length, 1, "a D1 device and its legacy duplicate receive only one event");

  const pending = { ...event, eventId: "new-arrival:removed-before-delivery" };
  await call(h.coordinator, "/push/customer-event", { method: "POST", body: { ownerId: "owner-A", event: pending } });
  h.db.shopState.set("shivan_shop_products", JSON.stringify([]));
  await h.coordinator.alarm();
  const cancelled = (await listPrefix(h.storage, "shivan-push:customer-event:")).find(item => item.eventId === pending.eventId);
  assert.equal(cancelled.status, "cancelled_unpublished_product", "a product deleted before dispatch is not pushed to customers");
  assert.equal(sent.length, 2, "deleted product events do not cause any customer delivery");
}

async function testEventDeliveryAndFailures() {
  let calls = 0;
  const deliveredPayloads = [];
  const h = createHarness({ send: async (_subscription, payload) => { calls++; deliveredPayloads.push(payload); return { ok: true, status: 201 }; } });
  const subscription = fakeSubscription();
  await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription } });
  const event = { eventId: "order:local-42", type: "new_order", title: "New order received", body: "Order #local-42 is ready.", url: "/?ownerPush=orders&order=local-42" };
  const duplicateResults = await Promise.all(Array.from({ length: 8 }, () => call(h.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event } })));
  assert.equal(duplicateResults.filter(result => result.status === 202).length, 1, "concurrent duplicate alert events queue once");
  assert.equal(duplicateResults.filter(result => result.status === 200).length, 7);
  await h.coordinator.alarm();
  assert.equal(calls, 1, "an alert is delivered once to a subscription");
  assert.equal(deliveredPayloads[0].data.audience, "owner", "private Smart Alerts are explicitly labeled for the Owner service-worker audience");
  assert.equal((await listPrefix(h.storage, "shivan-push:event:"))[0].status, "sent");

  let fail = true;
  const retry = createHarness({ now: 1_800_000_000_000, send: async () => fail ? { ok: false, status: 503 } : { ok: true, status: 201 } });
  await call(retry.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription } });
  await call(retry.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event: { ...event, eventId: "stock:retry", type: "low_stock", url: "/?ownerPush=alerts" } } });
  await retry.coordinator.alarm();
  const pending = (await listPrefix(retry.storage, "shivan-push:event:"))[0];
  assert.equal(pending.status, "pending", "temporary delivery failures are retried");
  assert.ok(pending.nextAttemptAt > 1_800_000_000_000, "retry is scheduled with exponential backoff");
  fail = false;
  retry.setNow(pending.nextAttemptAt + 1);
  await retry.coordinator.alarm();
  assert.equal((await listPrefix(retry.storage, "shivan-push:event:"))[0].status, "sent");

  const gone = createHarness({ send: async () => ({ ok: false, status: 410, remove: true }) });
  await call(gone.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription } });
  await call(gone.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event: { ...event, eventId: "out:gone", type: "out_of_stock", url: "/?ownerPush=alerts" } } });
  await gone.coordinator.alarm();
  assert.equal(gone.db.rows.size, 0, "410 endpoints are removed from D1");
  assert.equal((await listPrefix(gone.storage, "shivan-push:event:"))[0].status, "failed");

  const noSubscribers = createHarness();
  await call(noSubscribers.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event } });
  await noSubscribers.coordinator.alarm();
  assert.equal((await listPrefix(noSubscribers.storage, "shivan-push:event:"))[0].status, "no_subscribers");
  assert.equal((await call(noSubscribers.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event: { ...event, url: "https://phishing.test" } } })).status, 400, "external notification navigation URLs are rejected");
}

async function testOwnerNotificationPreferences() {
  const sent = [];
  const h = createHarness({ send: async (_subscription, payload) => { sent.push(payload); return { ok: true, status: 201 }; } });
  await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: fakeSubscription() } });
  const savePreferences = preferences => call(h.coordinator, "/push/preferences", { method: "POST", body: { ownerId: "owner-A", preferences } });
  const preferences = { new_order: { inApp: true, push: false }, low_stock: { inApp: true, push: true }, out_of_stock: { inApp: true, push: true }, discount_expiring: { inApp: true, push: false }, discount_expired: { inApp: true, push: false } };
  assert.equal((await savePreferences(preferences)).status, 200, "the coordinator stores validated Owner push choices");
  const suppressed = await call(h.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event: { eventId: "order:disabled", type: "new_order", title: "New order", body: "Order ready", url: "/?ownerPush=orders" } } });
  assert.equal((await suppressed.json()).suppressed, true, "disabled Owner push events are suppressed when queued");
  await call(h.coordinator, "/push/event", { method: "POST", body: { ownerId: "owner-A", event: { eventId: "stock:pending", type: "low_stock", title: "Low stock", body: "Stock low", url: "/?ownerPush=alerts" } } });
  preferences.low_stock.push = false;
  assert.equal((await savePreferences(preferences)).status, 200);
  assert.equal((await listPrefix(h.storage, "shivan-push:event:")).find(event => event.eventId === "stock:pending").status, "suppressed", "turning off push cancels matching pending Owner alerts");
  const timed = { id: "preference-discount", name: "Test discount", discount: 20, discountTimerEnabled: true, discountEndsAt: new Date(h.coordinator.clock() + 30 * 60 * 60 * 1000).toISOString() };
  await call(h.coordinator, "/push/discounts", { method: "POST", body: { ownerId: "owner-A", products: [timed] } });
  assert.equal((await listPrefix(h.storage, "shivan-push:discount:")).length, 0, "disabled timed-discount push notices are not scheduled");
  const customerBroadcast = await call(h.coordinator, "/push/customer-broadcast", { method: "POST", body: { ownerId: "owner-A", event: { eventId: "special-offer:owner-prefs-test", type: "special_offer", title: "New offer", body: "Offer details", url: "/?customerPush=offers&offerId=special-offer%3Aowner-prefs-test" } } });
  assert.equal(customerBroadcast.status, 202, "Owner alert preferences do not prevent customer offer broadcasts");
  assert.equal((await listPrefix(h.storage, "shivan-push:customer-event:")).length, 1, "customer notifications retain their independent queue");
  await h.coordinator.alarm();
  assert.equal(sent.length, 0, "disabled Owner events do not reach subscribed devices");
}

async function testStockAndDiscountScheduling() {
  const sent = [];
  const h = createHarness({ send: async (_sub, payload) => { sent.push(payload); return { ok: true, status: 201 }; } });
  await call(h.coordinator, "/push/subscription", { method: "POST", body: { ownerId: "owner-A", subscription: fakeSubscription() } });
  const product = { id: "dress-9", name: "Evening Dress", variants: [{ qrId: "dress-9-red-S", color: "Red", size: "S", stock: 12 }] };
  await call(h.coordinator, "/push/stock-snapshot", { method: "POST", body: { ownerId: "owner-A", products: [product] } });
  await call(h.coordinator, "/push/stock-snapshot", { method: "POST", body: { ownerId: "owner-A", products: [{ ...product, variants: [{ ...product.variants[0], stock: 5 }] }] } });
  await h.coordinator.alarm();
  assert.equal(sent.at(-1).title, "Product variant low on stock");
  await call(h.coordinator, "/push/stock-snapshot", { method: "POST", body: { ownerId: "owner-A", products: [{ ...product, variants: [{ ...product.variants[0], stock: 0 }] }] } });
  await h.coordinator.alarm();
  assert.equal(sent.at(-1).title, "Product variant out of stock");
  const lowEventCount = (await listPrefix(h.storage, "shivan-push:event:")).length;
  await call(h.coordinator, "/push/stock-snapshot", { method: "POST", body: { ownerId: "owner-A", products: [{ ...product, variants: [{ ...product.variants[0], stock: 0 }] }] } });
  assert.equal((await listPrefix(h.storage, "shivan-push:event:")).length, lowEventCount, "unchanged stock state does not duplicate an alert");

  const endAt = h.coordinator.clock() + 30 * 60 * 60 * 1000;
  const timed = { ...product, discount: 25, discountTimerEnabled: true, discountEndsAt: new Date(endAt).toISOString() };
  await call(h.coordinator, "/push/discounts", { method: "POST", body: { ownerId: "owner-A", products: [timed] } });
  h.setNow(endAt - 24 * 60 * 60 * 1000 + 1000);
  await h.coordinator.alarm();
  assert.equal(sent.at(-1).title, "Timed discount ending soon");
  assert.equal(sent.at(-1).data.url, "/?ownerPush=alerts");
  h.setNow(endAt + 1000);
  await h.coordinator.alarm();
  assert.equal(sent.at(-1).title, "Timed discount expired");
  const counts = (await listPrefix(h.storage, "shivan-push:event:")).length;
  await call(h.coordinator, "/push/discounts", { method: "POST", body: { ownerId: "owner-A", products: [timed] } });
  assert.equal((await listPrefix(h.storage, "shivan-push:event:")).length, counts, "discount warning and expiry identifiers deduplicate");
}

async function testPagesOwnerAuthorization() {
  const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
  const { onRequest } = await import(apiUrl);
  const token = "local-owner-session-token";
  const tokenHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", encoder.encode(token))).toString("base64url");
  const ownerToken = "local-owner-session-token", customerToken = "local-customer-session-token";
  const hashToken = async value => Buffer.from(await webcrypto.subtle.digest("SHA-256", encoder.encode(value))).toString("base64url");
  const accountByRole = role => ({ id: role === "owner" ? "owner-account-1" : "customer-account-1", identifier: "local@example.test", name: "Offline Test", role });
  const internalCalls = [];
  const env = {
    DB: { prepare(sql) { return { bind(...args) { return { first: async () => {
      if (sql.includes("FROM sessions s JOIN accounts a")) return args[0] === tokenHash ? { ...accountByRole("owner"), expires_at: Math.floor(Date.now() / 1000) + 3600 } : args[0] === await hashToken(customerToken) ? { ...accountByRole("customer"), expires_at: Math.floor(Date.now() / 1000) + 3600 } : null;
      if (sql.includes("FROM shop_state")) return { value: args[0] === "shivan_shop_owner_notification_preferences" ? "{}" : "[]" };
      return null;
    } }; } }; } },
    SYNC_HUB: { idFromName: name => name, get: () => ({ fetch: async (input, options = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url); const method = options.method || input.method || "GET"; const body = method === "POST" ? JSON.parse(options.body || await input.text()) : null;
      internalCalls.push({ path: url.pathname, search: url.search, body });
      return Response.json(url.pathname === "/push/config" ? { ok: true, publicKey: "PUBLIC_ONLY", privateKey: "TEST_SENTINEL_MUST_BE_STRIPPED", unexpected: "TEST_SENTINEL_MUST_BE_STRIPPED" } : url.pathname === "/push/test" ? { ok: true, status: "sent", acceptedByPushService: true } : { ok: true, registered: true });
    } }) },
  };
  const request = (path, role = "owner", origin = "https://shop.example.test") => new Request(`https://shop.example.test/api/${path}`, { headers: { ...(role === "owner" ? { cookie: `shivan_session=${encodeURIComponent(token)}` } : role === "customer" ? { cookie: `shivan_session=${encodeURIComponent(customerToken)}` } : {}), ...(origin ? { origin } : {}) } });
  const ownerResult = await onRequest({ request: request("push/config"), env });
  assert.equal(ownerResult.status, 200, `authorized Owner can load public VAPID configuration: ${await ownerResult.clone().text()}`);
  const ownerPublicConfig = await ownerResult.json();
  assert.deepEqual(Object.keys(ownerPublicConfig).sort(), ["ok", "publicKey"], "the Pages API whitelists only the public key response");
  assert.equal(ownerPublicConfig.publicKey, "PUBLIC_ONLY", "private VAPID material is never returned to the browser");
  assert.equal(JSON.stringify(ownerPublicConfig).includes("TEST_SENTINEL"), false);
  const customer = await onRequest({ request: request("push/config", "customer", ""), env });
  assert.equal(customer.status, 403, "customers cannot read Owner push config");
  const guest = await onRequest({ request: new Request("https://shop.example.test/api/push/config"), env });
  assert.equal(guest.status, 401, "guests must authenticate before reading Owner push config");
  const crossOrigin = await onRequest({ request: request("push/config", "owner", "https://attacker.example"), env });
  assert.equal(crossOrigin.status, 403, "cross-origin subscription management is rejected");
  const customerConfig = await onRequest({ request: request("customer-push/config", "customer"), env });
  assert.equal(customerConfig.status, 200, "authenticated customers can request only the public VAPID key");
  const customerPublicConfig = await customerConfig.json();
  assert.deepEqual(Object.keys(customerPublicConfig).sort(), ["ok", "publicKey"]);
  assert.equal(JSON.stringify(customerPublicConfig).includes("TEST_SENTINEL"), false, "the customer config also strips every non-public upstream field");
  assert.equal((await onRequest({ request: request("customer-push/config", "owner"), env })).status, 403, "Owner accounts cannot register as customers");
  assert.equal((await onRequest({ request: new Request("https://shop.example.test/api/customer-push/config"), env })).status, 401, "guests cannot manage customer push subscriptions");
  const customerSubscription = await onRequest({ request: new Request("https://shop.example.test/api/customer-push/subscription", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(customerToken)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ customerId: "attacker-selected-id", subscription: fakeSubscription("https://fcm.googleapis.com/fcm/send/api-customer"), preferences: { discounts: false } }) }), env });
  assert.equal(customerSubscription.status, 200);
  const forwardedCustomerSubscription = internalCalls.find(item => item.path === "/push/customer-subscription");
  assert.equal(forwardedCustomerSubscription?.body?.customerId, "customer-account-1", "the API derives customer identity from the authenticated session, not request input");
  assert.equal(Object.hasOwn(forwardedCustomerSubscription?.body || {}, "preferences"), false, "the API no longer forwards customer topic preferences");
  const customerPreferences = await onRequest({ request: new Request("https://shop.example.test/api/customer-push/preferences", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(customerToken)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ preferences: { action: "get" } }) }), env });
  assert.equal(customerPreferences.status, 200);
  const statusRequest = internalCalls.find(item => item.path === "/push/customer-notification-status");
  assert.equal(statusRequest?.body?.customerId, "customer-account-1", "the compatibility route checks global subscription status only");
  assert.equal(Object.hasOwn(statusRequest?.body || {}, "preferences"), false, "legacy topic data is not forwarded to the push service");
  assert.equal((await onRequest({ request: request("push/customer-broadcasts", "customer"), env })).status, 403, "customers cannot view Owner broadcast controls");
  assert.equal((await onRequest({ request: request("push/customer-broadcasts", "owner"), env })).status, 200, "only the Owner can view sanitized customer notification history");
  const broadcastRequest = new Request("https://shop.example.test/api/push/customer-broadcast", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ title: "Special offer", message: "A saved shop offer.", requestId: "campaign-request-123" }) });
  assert.equal((await onRequest({ request: broadcastRequest, env })).status, 200, "Owner may send an optional special-offer campaign");
  assert.equal(internalCalls.some(item => item.path === "/push/customer-broadcast" && item.body?.ownerId === "owner-account-1" && item.body?.event?.type === "special_offer"), true, "manual campaign uses the separate customer broadcast event route");
  const announcementRequest = new Request("https://shop.example.test/api/push/customer-broadcast", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ type: "announcement", title: "Store update", message: "New opening hours.", requestId: "announcement-123" }) });
  assert.equal((await onRequest({ request: announcementRequest, env })).status, 200, "Owner can queue a separate important-announcement campaign");
  assert.equal(internalCalls.some(item => item.path === "/push/customer-broadcast" && item.body?.ownerId === "owner-account-1" && item.body?.event?.type === "announcement"), true, "announcement delivery uses the customer broadcast audience");
  const unsavedProductBroadcast = new Request("https://shop.example.test/api/push/customer-broadcast", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ title: "Unsaved", message: "Not yet saved.", productId: "missing-product", requestId: "campaign-request-234" }) });
  assert.equal((await onRequest({ request: unsavedProductBroadcast, env })).status, 409, "Owner cannot send a product offer for an item absent from the saved catalog");
  assert.equal((await onRequest({ request: new Request("https://shop.example.test/api/customer-push/offer?eventId=special-offer%3Atest-campaign") , env })).status, 200, "public campaign details do not expose subscriber information");
  const registered = await onRequest({ request: new Request("https://shop.example.test/api/push/subscription", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ subscription: fakeSubscription() }) }), env });
  assert.equal(registered.status, 200);
  assert.equal(internalCalls.some(item => item.path === "/push/subscription" && item.body?.ownerId === "owner-account-1"), true, "the server derives the push owner from the session, never the request body");
  assert.equal(internalCalls.some(item => item.path === "/push/stock-snapshot"), true, "current shared product state is synchronized after subscription");
  const statusCheck = await onRequest({ request: new Request("https://shop.example.test/api/push/subscription/status", { method: "POST", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, origin: "https://shop.example.test", "content-type": "application/json" }, body: JSON.stringify({ endpoint: fakeSubscription().endpoint }) }), env });
  assert.equal(statusCheck.status, 200);
  assert.equal(internalCalls.some(item => item.path === "/push/subscription-status" && item.search === "" && item.body?.ownerId === "owner-account-1"), true, "push endpoint values stay in authenticated request bodies, not URLs");
  const testRequestBody = { ownerId: "attacker-selected-owner", endpoint: fakeSubscription("https://fcm.googleapis.com/fcm/send/test-phone").endpoint, requestId: "owner-device-test-123" };
  const testRequest = (role = "owner", origin = "https://shop.example.test", body = testRequestBody) => new Request("https://shop.example.test/api/push/test", { method: "POST", headers: { ...(role === "owner" ? { cookie: `shivan_session=${encodeURIComponent(ownerToken)}` } : role === "customer" ? { cookie: `shivan_session=${encodeURIComponent(customerToken)}` } : {}), ...(origin ? { origin } : {}), "content-type": "application/json" }, body: JSON.stringify(body) });
  const ownerTest = await onRequest({ request: testRequest(), env });
  assert.equal(ownerTest.status, 200, "the Owner can request a one-device test notification");
  assert.equal((await ownerTest.json()).acceptedByPushService, true);
  const testCall = internalCalls.findLast(item => item.path === "/push/test");
  assert.equal(testCall.body.ownerId, "owner-account-1", "test delivery owner comes from the authenticated session, not request input");
  assert.equal(testCall.body.endpoint, testRequestBody.endpoint, "only the explicitly selected registered-device endpoint is forwarded");
  assert.equal(testCall.body.requestId, testRequestBody.requestId);
  assert.equal(testCall.search, "", "device endpoints are never put in the internal request URL");
  assert.equal((await onRequest({ request: testRequest("guest"), env })).status, 401, "guests cannot trigger a push test");
  assert.equal((await onRequest({ request: testRequest("customer"), env })).status, 403, "customers cannot trigger the Owner push test");
  assert.equal((await onRequest({ request: testRequest("owner", "https://attacker.example"), env })).status, 403, "cross-origin requests cannot trigger a push test");
  assert.equal((await onRequest({ request: testRequest("owner", "https://shop.example.test", { ...testRequestBody, requestId: "bad" }), env })).status, 400, "invalid idempotency tokens are rejected before delivery");
  assert.equal(internalCalls.filter(item => item.path === "/push/test").length, 1, "unauthorized and invalid requests never reach the Worker");
  assert.match(apiSource, /route === "push\/test" && request\.method === "POST"/, "the Pages route matches the Owner interface endpoint");
  assert.match(apiSource, /queueNewOrderPush\(env, saved\.id\)/, "confirmed customer orders enqueue the existing Smart Alert identifier for push");
  assert.match(apiSource, /await syncCurrentOwnerPushProducts\(env, String\(account\.id\)\)/, "confirmed stock and product writes refresh server-side Smart Alert state");
  assert.ok(apiSource.indexOf("persistedValue = await saveShopValue(env, key, value, requestId)") < apiSource.indexOf("if (previousProductList) await queueCustomerProductEvents(env, String(account.id)"), "arrival and discount broadcasts are queued only after the product data write is confirmed");
}

async function testProductSaveBroadcastOrdering() {
  const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
  const { onRequest } = await import(`data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`);
  const token = "product-save-owner-session";
  const tokenHash = Buffer.from(await webcrypto.subtle.digest("SHA-256", encoder.encode(token))).toString("base64url");
  const state = { products: "[]", writes: 0, failWrite: false };
  const calls = [];
  const env = {
    DB: {
      prepare(sql) { return { bind(...args) { return {
        first: async () => {
          if (sql.includes("FROM sessions s JOIN accounts a")) return args[0] === tokenHash ? { id: "owner-account-1", identifier: "owner@example.test", name: "Owner", role: "owner" } : null;
          if (sql.includes("FROM shop_state") && sql.includes("SELECT value")) return { value: state.products };
          return null;
        },
        run: async () => {
          if (sql.includes("INSERT INTO shop_state")) {
            if (state.failWrite) throw new Error("simulated D1 failure");
            state.products = args[1];state.writes++;
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 1 } };
        },
      }; } }; },
      batch: async () => [],
    },
    SYNC_HUB: { idFromName: name => name, get: () => ({ fetch: async (input, options = {}) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const method = options.method || input.method || "GET";
      const body = method === "POST" ? JSON.parse(options.body || await input.text()) : null;
      if (url.pathname === "/push/customer-event") calls.push({ path: url.pathname, event: body.event, writesAtQueue: state.writes });
      return Response.json({ ok: true, queued: true, broadcasts: [] }, { status: url.pathname === "/push/customer-event" ? 202 : 200 });
    } }) },
  };
  const save = (products, requestId) => onRequest({ request: new Request("https://shop.example.test/api/sync", { method: "PUT", headers: { cookie: `shivan_session=${encodeURIComponent(token)}`, "content-type": "application/json", origin: "https://shop.example.test", "X-Client-Request-ID": requestId }, body: JSON.stringify({ key: "shivan_shop_products", value: JSON.stringify(products) }) }), env });
  const first = { id: 77, name: "Test Dress", price: 10000, discount: 20, stock: 4, colors: ["#111111"], sizes: ["M"] };
  assert.equal((await save([first], "save-request-001")).status, 200, "new product successfully persists before customer notifications are queued");
  assert.equal(calls.filter(item => item.event.type === "new_arrival").length, 1);
  assert.equal(calls.filter(item => item.event.type === "discount").length, 1, "a newly published discounted product reports both its arrival and discount");
  assert.ok(calls.every(item => item.writesAtQueue === 1), "no automatic customer notification is queued before D1 confirms the product save");
  const updated = { ...first, discount: 30 };
  assert.equal((await save([updated], "save-request-002")).status, 200);
  assert.equal(calls.filter(item => item.event.type === "discount").length, 2, "a changed active discount queues a new customer notice");
  const { discount: _removedDiscount, ...regularProduct } = updated;
  assert.equal((await save([regularProduct], "save-request-003")).status, 200, "removing a discount does not send an active discount notice");
  assert.equal(calls.filter(item => item.event.type === "discount").length, 2);
  assert.equal((await save([{ ...regularProduct, discount: 20 }], "save-request-004")).status, 200, "reactivating a previous discount queues a fresh notice");
  assert.equal(calls.filter(item => item.event.type === "discount").length, 3, "different activation cycles have distinct dedupe keys");
  assert.equal((await save([{ ...regularProduct, discount: 20 }], "save-request-004")).status, 200, "a duplicate save with the same request identifier remains idempotent");
  assert.equal(calls.filter(item => item.event.type === "discount").length, 3);
  state.failWrite = true;
  const before = calls.length;
  assert.equal((await save([{ ...updated, id: 78, name: "Unsaved Dress" }], "save-request-005")).status, 503, "failed shared writes return a real error");
  assert.equal(calls.length, before, "a failed product write never queues customer notifications");
}

async function testServiceWorkerAndOwnerControls() {
  const source = await readFile(new URL("../service-worker.js", import.meta.url), "utf8");
  const listeners = new Map();
  const savedSettings = new Map();
  savedSettings.set("audience", "owner");
  const notifications = [];
  const opened = [];
  const posted = [];
  let subscriptionCalls = 0;
  let apiPostBody = null;
  const registration = {
    showNotification: async (title, options) => notifications.push({ title, options }),
    pushManager: { subscribe: async options => { subscriptionCalls++; assert.equal(options.userVisibleOnly, true); return { toJSON: () => fakeSubscription().toJSON?.() || fakeSubscription(), unsubscribe: async () => true }; } },
  };
  const db = {
    createObjectStore() {}, close() {},
    transaction(_store, mode) { const transaction = { objectStore() { return {
      get(key) { const request = {}; queueMicrotask(() => { request.result = savedSettings.get(key); request.onsuccess?.(); }); return request; },
      put(value, key) { const request = {}; queueMicrotask(() => { savedSettings.set(key, value); request.onsuccess?.(); }); return request; },
    }; } }; Object.defineProperty(transaction, "oncomplete", { set(handler) { queueMicrotask(() => handler?.()); } }); return transaction; },
  };
  const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = db; if (!savedSettings.has("__dbCreated")) { savedSettings.set("__dbCreated", true); request.onupgradeneeded?.(); } request.onsuccess?.(); }); return request; } };
  const client = { url: "https://shop.example.test/", focus: async () => { focused = true; }, postMessage: message => posted.push(message) };
  let focused = false;
  const workerSelf = {
    location: { origin: "https://shop.example.test" }, registration,
    skipWaiting: async () => {}, clients: { claim: async () => {}, matchAll: async () => [client], openWindow: async url => opened.push(url) },
    addEventListener: (type, callback) => { const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); },
  };
  const fetchCalls = [];
  const notificationApi = { permission: "granted" };
  const fetchImpl = async (url, options = {}) => {
    fetchCalls.push(String(url));
    if (options.method === "POST") apiPostBody = JSON.parse(options.body);
    return Response.json(String(url).includes("config") ? { publicKey: b64(new Uint8Array([4, ...new Uint8Array(64).fill(7)])) } : { ok: true });
  };
  runInNewContext(source, { self: workerSelf, indexedDB, Notification: notificationApi, URL, Uint8Array, Promise, atob, fetch: fetchImpl, Response, setTimeout, clearTimeout, console });
  const dispatch = async (type, event) => {
    for (const callback of listeners.get(type) || []) callback(event);
    await event.waitPromise;
  };
  const pushEvent = { data: { json: () => ({ title: "New order received", body: "Order #x is ready.", tag: "order:x", data: { audience: "owner", eventId: "order:x", type: "new_order", url: "/?ownerPush=orders&order=x" } }) }, waitUntil(promise) { this.waitPromise = promise; } };
  await dispatch("push", pushEvent);
  assert.equal(notifications[0].title, "SHIVAN SHOP · New order received");
  assert.equal(notifications[0].options.tag, "order:x");
  let clickPromise;
  await dispatch("notificationclick", { notification: { data: notifications[0].options.data, close() {} }, waitUntil(promise) { clickPromise = promise; } });
  await clickPromise;
  assert.equal(focused, true);
  assert.equal(posted[0].target.url, "https://shop.example.test/?ownerPush=orders&order=x");

  savedSettings.set("audience", "customer");
  const visibleBeforeOwnerMismatch = notifications.length;
  await dispatch("push", pushEvent);
  assert.equal(notifications.length, visibleBeforeOwnerMismatch, "an Owner payload is suppressed while this service worker is in customer audience mode");

  const customerImage = "/api/media/shop/" + "b".repeat(43) + ".webp";
  const customerPush = { data: { json: () => ({ title: "New arrival: Dress", body: "A new fashion model is available.", tag: "new-arrival:dress-1", image: customerImage, data: { audience: "customer", eventId: "new-arrival:dress-1", type: "new_arrival", productId: "dress-1", url: "/?customerPush=product&productId=dress-1" } }) }, waitUntil(promise) { this.waitPromise = promise; } };
  await dispatch("push", customerPush);
  assert.equal(notifications[1].title, "SHIVAN SHOP · New arrival: Dress", "customer notifications show Shivan Shop branding");
  assert.equal(notifications[1].options.image, customerImage, "customer push displays a saved product image where supported");
  await dispatch("notificationclick", { notification: { data: notifications[1].options.data, close() {} }, waitUntil(promise) { clickPromise = promise; } });
  await clickPromise;
  assert.equal(posted[1].type, "shivan-customer-push-open");
  assert.equal(posted[1].target.url, "https://shop.example.test/?customerPush=product&productId=dress-1", "customer notification opens its exact product route");

  savedSettings.set("audience", "owner");
  const visibleBeforeCustomerMismatch = notifications.length;
  await dispatch("push", customerPush);
  assert.equal(notifications.length, visibleBeforeCustomerMismatch, "a customer payload is suppressed while this service worker is in Owner audience mode");
  const untypedPush = { data: { json: () => ({ title: "Unexpected alert", body: "No audience label.", data: { type: "new_order", url: "/?ownerPush=alerts" } }) }, waitUntil(promise) { this.waitPromise = promise; } };
  await dispatch("push", untypedPush);
  assert.equal(notifications.length, visibleBeforeCustomerMismatch, "push payloads without an explicit audience fail closed");

  await dispatch("message", { data: { type: "shivan-push-disable" }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(savedSettings.get("disabled"), true);
  await dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/old" }, waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(subscriptionCalls, 0, "a disabled device does not silently renew push");
  await dispatch("message", { data: { type: "shivan-push-enable" }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(savedSettings.get("disabled"), false);
  await dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/old" }, waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(subscriptionCalls, 1, "enabled subscriptions renew when the browser reports expiry");
  assert.equal(apiPostBody.previousEndpoint, "https://fcm.googleapis.com/fcm/send/old");
  assert.equal(fetchCalls.includes("/api/push/config"), true);

  await dispatch("message", { data: { type: "shivan-customer-push-enable", preferences: { discounts: false } }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(savedSettings.get("customerDisabled"), false);
  assert.equal(savedSettings.get("audience"), "customer", "customer opt-in selects the customer notification audience");
  assert.equal(savedSettings.has("customerPreferences"), false, "the service worker does not store customer topic choices");
  assert.equal(savedSettings.get("disabled"), false, "customer push settings do not alter Owner push state");
  await dispatch("message", { data: { type: "shivan-customer-push-disable" }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  const visibleBeforeDisable = notifications.length;
  await dispatch("push", customerPush);
  assert.equal(notifications.length, visibleBeforeDisable, "a customer-disabled device suppresses customer push locally");
  assert.equal(savedSettings.get("disabled"), false, "disabling customer messages does not turn off Owner alerts");
  notificationApi.permission="denied";
  await dispatch("push", customerPush);
  assert.equal(notifications.length, visibleBeforeDisable, "revoked browser permission suppresses customer push display");
  notificationApi.permission="granted";
  await dispatch("message", { data: { type: "shivan-customer-push-enable" }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  await dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://fcm.googleapis.com/fcm/send/old-customer" }, waitUntil(promise) { this.waitPromise = promise; } });
  assert.equal(subscriptionCalls, 2, "an enabled customer subscription renews separately");
  assert.equal(fetchCalls.includes("/api/customer-push/config"), true);
  assert.equal(Object.hasOwn(apiPostBody, "preferences"), false, "subscription renewal never restores per-topic preferences");

  await dispatch("message", { data: { type: "shivan-push-enable" }, ports: [{ postMessage: message => { assert.equal(message.ok, true); } }], waitUntil(promise) { this.waitPromise = promise; } });
  const ownerTestPush = { data: { json: () => ({ title: "Shivan Shop push test", body: "Push notifications are working on this device.", tag: "owner-push-test:local-only", data: { audience: "owner", eventId: "local-only", type: "test", url: "/?ownerPush=alerts" } }) }, waitUntil(promise) { this.waitPromise = promise; } };
  await dispatch("push", ownerTestPush);
  assert.equal(notifications.at(-1).title, "Shivan Shop push test", "the service worker displays the one-device Owner test");
  assert.equal(notifications.at(-1).options.data.audience, "owner", "the test notification remains in the Owner audience");
  assert.equal(notifications.at(-1).options.data.url, "/?ownerPush=alerts");
  await dispatch("notificationclick", { notification: { data: notifications.at(-1).options.data, close() {} }, waitUntil(promise) { clickPromise = promise; } });
  await clickPromise;
  assert.equal(posted.at(-1).target.url, "https://shop.example.test/?ownerPush=alerts", "tapping the test returns to the Owner Smart Alerts section");

  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const workerConfig = await readFile(new URL("../sync-hub/wrangler.toml", import.meta.url), "utf8");
const ownerPushMigration = await readFile(new URL("../migrations/0003_owner_push_subscriptions.sql", import.meta.url), "utf8");
const customerPushMigration = await readFile(new URL("../migrations/0004_customer_push_subscriptions.sql", import.meta.url), "utf8");
assert.match(workerConfig, /binding\s*=\s*"DB"[\s\S]*database_name\s*=\s*"shivan-shop-db"[\s\S]*database_id\s*=\s*"bc9da050-3780-428f-aeee-b42bb82b95c0"/, "SyncHub is configured to use the existing shared D1 database");
for (const column of ["endpoint_hash", "owner_id", "endpoint", "p256dh", "auth_secret", "expiration_time", "failures"]) assert.match(ownerPushMigration, new RegExp(`\\b${column}\\b`), `the additive Owner subscription table includes ${column}`);
assert.match(ownerPushMigration, /REFERENCES accounts\(id\) ON DELETE CASCADE/, "Owner subscriptions follow the authorized account lifecycle");
assert.doesNotMatch(ownerPushMigration, /DROP\s+TABLE|DELETE\s+FROM/i, "the push migration never removes existing data");
for (const table of ["customer_push_subscriptions", "customer_push_preferences"]) assert.match(customerPushMigration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`), `customer subscriptions use a separate D1 table: ${table}`);
for (const column of ["endpoint_hash", "customer_id", "endpoint", "p256dh", "auth_secret", "new_arrivals", "discounts", "special_offers", "announcements"]) assert.match(customerPushMigration, new RegExp(`\\b${column}\\b`), `customer push storage includes ${column}`);
assert.match(customerPushMigration, /REFERENCES accounts\(id\) ON DELETE CASCADE/);
assert.doesNotMatch(customerPushMigration, /DROP\s+TABLE|DELETE\s+FROM/i, "customer push migration is additive and preserves current rows");
  assert.equal((html.match(/Notification\.requestPermission\(/g) || []).length, 2, "permission is requested only from explicit Owner and customer enable handlers");
  assert.match(html, /function enableOwnerPushNotifications\(\)/);
  assert.match(html, /if\(!isOwner\(\)\)return false/);
  assert.match(html, /function enableCustomerPushNotifications\(\)/);
  const customerPushPanel = html.match(/<section id="customerPushSettings"[\s\S]*?<\/section>/)?.[0] || "";
  assert.ok(customerPushPanel, "authenticated customers have a push notification controls panel");
  assert.doesNotMatch(customerPushPanel, /type="checkbox"|New arrivals|Discounts|Special offers|Important shop announcements/, "the customer panel has no per-topic checkboxes");
  assert.match(customerPushPanel, /Receive new arrivals, discounts, special offers, and important shop announcements/i, "the customer panel explains global notification opt-in");
  assert.match(customerPushPanel, /Enable notifications/);
  assert.doesNotMatch(html, /customerPushNewArrivals|customerPushDiscounts|customerPushSpecialOffers|customerPushAnnouncements|saveCustomerPushPreferences|customer-push-preferences/, "customer topic selectors and save controls are removed");
  const customerRefresh = html.slice(html.indexOf("async function refreshCustomerPushControls()"), html.indexOf("async function enableCustomerPushNotifications()"));
  assert.doesNotMatch(customerRefresh, /Notification\.requestPermission|method:"DELETE"|\.unsubscribe\(/, "refreshing profile status neither requests permission nor removes subscriptions");
  const customerDisable = html.slice(html.indexOf("async function disableCustomerPushNotifications()"), html.indexOf("function updateProfile()"));
  assert.match(customerDisable, /customer-push\/subscription\/status/);
  assert.match(customerDisable, /not linked to your customer account, so it was left unchanged/, "a customer cannot remove a subscription registered to another audience");
  assert.match(html, /id="ownerCustomerBroadcastType"/);
  assert.match(html, /customer-push\/subscription/);
  assert.match(html, /id="ownerPushTest"[^>]*onclick="sendOwnerPushTestNotification\(\)"/);
  assert.match(html, /function sendOwnerPushTestNotification\(\)/);
  assert.match(html, /\/api\/push\/test/);
  assert.doesNotMatch(html, /\/api\/push\/test-notification/, "the Owner test action uses the routed Pages endpoint");
  assert.match(html, /renderOwnerCustomerNotifications\(sectionBox\)/);
  assert.match(html, /navigator\.serviceWorker\.register\("\/service-worker\.js"/);
  assert.match(html, /openOwnerOrderDetail\(orderId\)/);
}

await testWebPushCrypto();
await testSubscriptionsAndAuthorization();
await testCrossAudienceEndpointExclusivity();
await testLegacyOwnerSubscriptionsRemainDeliverable();
await testOwnerSingleDeviceTestNotification();
await testEventDeliveryAndFailures();
await testOwnerNotificationPreferences();
await testStockAndDiscountScheduling();
await testCustomerSubscriptionsGlobalBroadcasts();
await testLegacyCustomerSubscriptionCompatibilityAndDeletedProductGuard();
await testPagesOwnerAuthorization();
await testProductSaveBroadcastOrdering();
await testServiceWorkerAndOwnerControls();
console.log("Push regression tests passed (cross-audience endpoint exclusion and races, Owner one-device test authorization and deduplication, Owner Smart Alerts, global customer opt-in and broadcasts, published-product checks, saved-product ordering, retries, failure pruning, notification clicks, and renewal).");
