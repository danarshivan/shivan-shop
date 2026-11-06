import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);
const names = [
  "normalizeOwnerSmartAlertState", "mergeOwnerSmartAlertStates", "readOwnerSmartAlertState", "ownerSmartAlertUnreadCount",
  "recordOwnerSmartAlert", "writeOwnerSmartAlertState", "ownerSmartAlertDetails", "ownerSmartAlertItemMarkup",
  "ownerSmartAlertDashboardSummaryMarkup", "updateOwnerSmartAlertBadges", "refreshOwnerSmartAlertView",
  "markOwnerSmartAlertRead", "clearOwnerSmartAlert", "markAllOwnerSmartAlertsRead", "reconcileOwnerSmartAlerts",
  "renderOwnerSmartAlerts", "normalizeOwnerNotificationPreferences", "readOwnerNotificationPreferences", "ownerNotificationPreferenceEnabled",
];
function functionSource(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Expected ${name} to exist`);
  const end = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, end < 0 ? html.length : end).trim();
}
const sources = names.map(functionSource).join("\n");
const storage = new Map();
let isOwner = true;
let orders = [{ id: "order-old" }];
let products = [
  { id: "dress-1", name: "Evening Dress", variants: [{ qrId: "variant-s-black", color: "#111111", size: "S", stock: 12 }] },
  { id: "dress-2", name: "Party Dress", stock: 8, discount: 20, discountTimerEnabled: true, discountEndsAt: "2026-11-05T12:00:00.000Z" },
];
const now = Date.parse("2026-11-03T12:00:00.000Z");
const elements = [];
const context = {
  OWNER_SMART_ALERTS_KEY: "shivan_shop_owner_alerts",
  OWNER_NOTIFICATION_PREFERENCES_KEY: "shivan_shop_owner_notification_preferences",
  OWNER_NOTIFICATION_EVENT_TYPES: ["new_order", "low_stock", "out_of_stock", "discount_expiring", "discount_expired"],
  OWNER_SMART_ALERT_LOW_STOCK: 5,
  OWNER_SMART_ALERT_EXPIRING_MS: 24 * 60 * 60 * 1000,
  localStorage: {
    getItem(key) { return storage.has(key) ? storage.get(key) : null; },
    setItem(key, value) { storage.set(key, String(value)); },
  },
  document: {
    querySelectorAll() { return []; },
    querySelector() { return null; },
  },
  products,
  getOrders: () => orders,
  productDiscountPercent: product => Number(product?.discount) >= 1 && Number(product?.discount) <= 99 ? Number(product.discount) : 0,
  isOwner: () => isOwner,
  ownerDashboardText: english => english,
  ownerPanel: "alerts",
  escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  updateOwnerSmartAlertBadges() {},
  ownerPushControlMarkup: () => '<section class="owner-push-controls">Push notification controls</section>',
  refreshOwnerPushControls() {},
  scheduleOwnerSmartAlertEvaluation() {},
  showToast(message) { elements.push(String(message)); },
};
const runtime = runInNewContext(`${sources}\n({${names.join(",")}})`, context);

const baseline = runtime.reconcileOwnerSmartAlerts({ now, notify: false });
assert.equal(baseline.created.length, 0, "first use establishes a quiet baseline for existing orders and stock");
assert.equal(runtime.ownerSmartAlertUnreadCount(), 0);

orders = [...orders, { id: "order-new" }];
let result = runtime.reconcileOwnerSmartAlerts({ now: now + 1000, notify: false });
assert.deepEqual(Array.from(result.created, alert => alert.type), ["new_order"], "a newly observed order creates an alert");
result = runtime.reconcileOwnerSmartAlerts({ now: now + 2000, notify: false });
assert.equal(result.created.length, 0, "the same order does not create duplicate alerts on refresh");
assert.equal(runtime.ownerSmartAlertUnreadCount(), 1);

products[0].variants[0].stock = 5;
result = runtime.reconcileOwnerSmartAlerts({ now: now + 3000, notify: false });
assert.deepEqual(Array.from(result.created, alert => alert.type), ["low_stock"], "crossing the 5-unit threshold creates a low-stock alert for that exact variant");
result = runtime.reconcileOwnerSmartAlerts({ now: now + 4000, notify: false });
assert.equal(result.created.length, 0, "unchanged low stock does not create repeats");
products[0].variants[0].stock = 0;
result = runtime.reconcileOwnerSmartAlerts({ now: now + 5000, notify: false });
assert.deepEqual(Array.from(result.created, alert => alert.type), ["out_of_stock"], "a variant reaching zero creates an out-of-stock alert");

const expiresAt = Date.parse(products[1].discountEndsAt);
result = runtime.reconcileOwnerSmartAlerts({ now: expiresAt - 12 * 60 * 60 * 1000, notify: false });
assert.ok(result.created.some(alert => alert.type === "discount_expiring"), "a timed discount within 24 hours creates a warning");
result = runtime.reconcileOwnerSmartAlerts({ now: expiresAt + 1000, notify: false });
assert.ok(result.created.some(alert => alert.type === "discount_expired"), "an ended timed discount creates an expired alert");
result = runtime.reconcileOwnerSmartAlerts({ now: expiresAt + 2000, notify: false });
assert.equal(result.created.length, 0, "discount warning and expiration alerts are deduplicated");

const savedBeforeRead = runtime.readOwnerSmartAlertState();
const newOrderAlert = savedBeforeRead.alerts.find(alert => alert.type === "new_order");
assert.ok(runtime.markOwnerSmartAlertRead(newOrderAlert.id), "an Owner can mark an alert as read");
assert.equal(runtime.ownerSmartAlertUnreadCount(), savedBeforeRead.alerts.length - 1, "read status updates the unread count");
const persistedAfterRead = JSON.parse(storage.get("shivan_shop_owner_alerts"));
assert.ok(persistedAfterRead.alerts.find(alert => alert.id === newOrderAlert.id)?.readAt, "read status is persisted in the shared alert record");

const lowAlert = runtime.readOwnerSmartAlertState().alerts.find(alert => alert.type === "low_stock");
assert.ok(runtime.clearOwnerSmartAlert(lowAlert.id), "an Owner can clear one alert");
assert.ok(runtime.readOwnerSmartAlertState().clearedIds.includes(lowAlert.id), "cleared IDs are persisted as duplicate-prevention tombstones");
assert.ok(!runtime.readOwnerSmartAlertState().alerts.some(alert => alert.id === lowAlert.id), "cleared alert is removed from the visible list");
const duplicate = { id: lowAlert.id, type: "low_stock", entityId: "dress-1" };
assert.equal(runtime.recordOwnerSmartAlert(runtime.readOwnerSmartAlertState(), duplicate, now), false, "cleared alert events cannot be recreated");

const ownerAlertsBox = { textContent: "", innerHTML: "" };
runtime.renderOwnerSmartAlerts(ownerAlertsBox, false);
assert.match(ownerAlertsBox.innerHTML, /owner-smart-alert-panel/);
assert.match(ownerAlertsBox.innerHTML, /New order received/);
assert.match(ownerAlertsBox.innerHTML, /Timed discount expired/);
assert.match(ownerAlertsBox.innerHTML, /owner-smart-alert-count/);
assert.match(ownerAlertsBox.innerHTML, /owner-push-controls/, "the Owner Smart Alerts screen includes the device push controls");
assert.match(runtime.ownerSmartAlertDashboardSummaryMarkup(), /View all alerts/);
assert.match(runtime.ownerSmartAlertDashboardSummaryMarkup(), /Smart Alerts/);

const remote = JSON.parse(storage.get("shivan_shop_owner_alerts"));
remote.alerts.push({ ...newOrderAlert, readAt: "" });
const merged = runtime.mergeOwnerSmartAlertStates(remote, JSON.parse(storage.get("shivan_shop_owner_alerts")));
assert.equal(merged.alerts.filter(alert => alert.id === newOrderAlert.id).length, 1, "merging two device snapshots keeps one record per event ID");
assert.ok(merged.alerts.find(alert => alert.id === newOrderAlert.id)?.readAt, "a read status is preserved while device snapshots merge");

const persistedRuntime = runInNewContext(`${sources}\n({readOwnerSmartAlertState,ownerSmartAlertUnreadCount})`, { ...context });
assert.equal(persistedRuntime.readOwnerSmartAlertState().alerts.length, runtime.readOwnerSmartAlertState().alerts.length, "alert records remain available after creating a fresh runtime");
assert.ok(persistedRuntime.readOwnerSmartAlertState().alerts.find(alert => alert.id === newOrderAlert.id)?.readAt, "read status survives reload");
assert.ok(runtime.markAllOwnerSmartAlertsRead(), "the Owner can mark all alerts read");
assert.equal(runtime.ownerSmartAlertUnreadCount(), 0, "mark-all-read clears the unread count");

isOwner = false;
const guestBox = { textContent: "", innerHTML: "" };
runtime.renderOwnerSmartAlerts(guestBox);
assert.match(guestBox.textContent, /Only the store owner/, "non-Owners cannot render the alert list");
assert.equal(runtime.reconcileOwnerSmartAlerts({ now: now + 5000 }).created.length, 0, "non-Owners cannot generate or mutate shared alerts");
isOwner = true;

assert.match(apiSource, /"shivan_shop_owner_alerts"/, "the existing shared shop-state API recognizes the alert key");
assert.match(apiSource, /includeOwnerPrivate \|\| !\["shivan_shop_owner_alerts", OWNER_NOTIFICATION_PREFERENCES_KEY\]\.includes\(row\.key\)/, "guest/customer sync responses exclude Owner alerts and private preferences");

const shared = new Map([["shivan_shop_owner_alerts", JSON.stringify({ alerts: [{ id: "private-alert", type: "new_order", entityId: "order-secret", createdAt: new Date(now).toISOString() }] })], ["shivan_shop_owner_notification_preferences", JSON.stringify({ version: 1, new_order: { inApp: false, push: true } })]]);
let accountRole = "";
const db = {
  prepare(sql) {
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async first() {
        if (sql.includes("SELECT a.id, a.identifier, a.name, a.role FROM sessions")) return accountRole ? { id: accountRole + "-id", identifier: accountRole + "@test.invalid", name: accountRole, role: accountRole } : null;
        return null;
      },
      async all() {
        if (sql.includes("FROM shop_state")) return { results: [...shared].map(([key, value]) => ({ key, value })) };
        return { results: [] };
      },
      async run() {
        if (sql.includes("INSERT INTO shop_state")) shared.set(String(params[0]), String(params[1]));
        return { success: true, meta: { changes: 1 } };
      },
    };
  },
};
const env = { DB: db };
const callApi = async (role, method = "GET", body = null) => {
  accountRole = role;
  const request = new Request("https://shop.test/api/sync", {
    method,
    headers: { ...(role ? { Cookie: "shivan_session=offline-test" } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return onRequest({ request, env });
};
let response = await callApi("");
let payload = await response.json();
assert.equal(response.status, 200);
assert.equal(payload.shop.shivan_shop_owner_alerts, undefined, "guest bootstrap sync never reveals Owner alerts");
assert.equal(payload.shop.shivan_shop_owner_notification_preferences, undefined, "guest bootstrap never reveals Owner preferences");
response = await callApi("customer");
payload = await response.json();
assert.equal(response.status, 200);
assert.equal(payload.shop.shivan_shop_owner_alerts, undefined, "customer sync never reveals Owner alerts");
assert.equal(payload.shop.shivan_shop_owner_notification_preferences, undefined, "customer sync never reveals Owner preferences");
response = await callApi("customer", "PUT", { key: "shivan_shop_owner_notification_preferences", value: "{}" });
assert.equal(response.status, 403, "customer accounts cannot save Owner notification preferences");
response = await callApi("owner", "PUT", { key: "shivan_shop_owner_notification_preferences", value: JSON.stringify({ new_order: { inApp: false, push: true } }) });
assert.equal(response.status, 200, "Owner can save notification preferences through the authenticated shared settings API");
const normalizedPreferences = JSON.parse(shared.get("shivan_shop_owner_notification_preferences"));
assert.equal(normalizedPreferences.new_order.inApp, false);
assert.equal(normalizedPreferences.low_stock.push, true, "unspecified Owner notification choices default on");
response = await callApi("owner", "PUT", { key: "shivan_shop_owner_notification_preferences", value: JSON.stringify({ new_order: { inApp: "false" } }) });
assert.equal(response.status, 400, "invalid notification preference values are rejected");
response = await callApi("customer", "PUT", { key: "shivan_shop_owner_alerts", value: "{}" });
assert.equal(response.status, 403, "customer accounts cannot save Owner alerts");
response = await callApi("owner", "PUT", { key: "shivan_shop_owner_alerts", value: JSON.stringify({ version: 1, alerts: [] }) });
assert.equal(response.status, 200, "Owner can persist alerts using the existing D1 shop-state API");
payload = await response.json();
assert.equal(payload.persisted, true);
response = await callApi("owner");
payload = await response.json();
assert.equal(payload.shop.shivan_shop_owner_alerts, JSON.stringify({ version: 1, alerts: [] }), "Owner sync retrieves the persisted alerts for another session/device");
assert.equal(JSON.parse(payload.shop.shivan_shop_owner_notification_preferences).new_order.inApp, false, "Owner sync can retrieve private notification preferences");

const preferenceStorage = new Map([["shivan_shop_owner_notification_preferences", JSON.stringify({ new_order: { inApp: false }, low_stock: { inApp: false }, out_of_stock: { inApp: false }, discount_expiring: { inApp: false }, discount_expired: { inApp: false } })]]);
const preferenceProducts = [{ id: "pref-product", variants: [{ color: "#000", size: "S", stock: 10 }] }, { id: "pref-discount", discount: 20, discountTimerEnabled: true, discountEndsAt: new Date(now + 12 * 60 * 60 * 1000).toISOString() }];
let preferenceOrders = [{ id: "pref-existing" }];
const preferenceContext = { ...context, products: preferenceProducts, getOrders: () => preferenceOrders, localStorage: { getItem(key) { return preferenceStorage.has(key) ? preferenceStorage.get(key) : null; }, setItem(key, value) { preferenceStorage.set(key, String(value)); } } };
const preferenceRuntime = runInNewContext(`${sources}\n({reconcileOwnerSmartAlerts,ownerSmartAlertUnreadCount})`, preferenceContext);
preferenceRuntime.reconcileOwnerSmartAlerts({ now, notify: false });
preferenceOrders = [...preferenceOrders, { id: "pref-new" }];
assert.equal(preferenceRuntime.reconcileOwnerSmartAlerts({ now: now + 1000, notify: false }).created.length, 0, "disabled in-app new-order alerts are suppressed");
preferenceProducts[0].variants[0].stock = 4;
assert.equal(preferenceRuntime.reconcileOwnerSmartAlerts({ now: now + 2000, notify: false }).created.length, 0, "disabled in-app low-stock alerts are suppressed");
preferenceProducts[0].variants[0].stock = 0;
assert.equal(preferenceRuntime.reconcileOwnerSmartAlerts({ now: now + 3000, notify: false }).created.length, 0, "disabled in-app out-of-stock alerts are suppressed");
const preferenceExpiry = Date.parse(preferenceProducts[1].discountEndsAt);
assert.equal(preferenceRuntime.reconcileOwnerSmartAlerts({ now: preferenceExpiry - 6 * 60 * 60 * 1000, notify: false }).created.length, 0, "disabled in-app discount warning alerts are suppressed");
assert.equal(preferenceRuntime.reconcileOwnerSmartAlerts({ now: preferenceExpiry + 1000, notify: false }).created.length, 0, "disabled in-app discount expiration alerts are suppressed");
assert.equal(preferenceRuntime.ownerSmartAlertUnreadCount(), 0, "disabled alert types do not leave hidden in-app records");

console.log("Owner Smart Alerts checks passed: event detection and deduplication, all five in-app preference gates, read/clear persistence, Owner-only UI, private preference sync, and mocked D1/API authorization.");
