import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = await readFile(resolve(root, "index.html"), "utf8");
const start = html.indexOf("function customerPushFriendlyError(error){");
const end = html.indexOf("\nasync function disableCustomerPushNotifications(){", start);
assert.ok(start >= 0 && end > start, "customer push setup functions exist in the Profile flow");
const setupSource = html.slice(start, end);

function createHarness({
  permission = "default",
  permissionResult = "granted",
  supported = true,
  ios = false,
  installed = true,
  saveResult = { ok: true, registered: true },
  saveError = null,
  workerAck = true,
} = {}) {
  const calls = [];
  const statuses = [];
  const toasts = [];
  const openedViews = [];
  const buttons = new Map();
  let unsubscribeCalls = 0;
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/offline-test",
    toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/offline-test", keys: { p256dh: "offline", auth: "offline" } }),
    unsubscribe: async () => { unsubscribeCalls += 1; return true; },
  };
  const registration = {
    scope: "https://shop.test/",
    active: { state: "activated" },
    pushManager: {
      getSubscription: async () => { calls.push("push.get-subscription"); return null; },
      subscribe: async options => { calls.push("push.subscribe"); assert.equal(options.userVisibleOnly, true); assert.equal(options.applicationServerKey.length, 65); return subscription; },
    },
  };
  const notification = {
    permission,
    requestPermission: async () => { calls.push("permission.request"); return permissionResult; },
  };
  const sandbox = {
    cloudAccount: { id: "offline-customer", role: "customer" },
    currentUser: null,
    customerPushActionPending: false,
    isOwner: () => false,
    ownerPushIsSupported: () => supported,
    Notification: notification,
    navigator: {
      userAgent: ios ? "iPhone" : "Offline test browser",
      standalone: installed,
      serviceWorker: {
        register: async (path, options) => { calls.push("service-worker.register"); assert.equal(path, "/service-worker.js"); assert.equal(options.scope, "/"); return registration; },
        get ready() { calls.push("service-worker.ready"); return Promise.resolve(registration); },
      },
    },
    window: { matchMedia: () => ({ matches: installed }) },
    document: { getElementById: id => { if (!buttons.has(id)) buttons.set(id, { hidden: false, disabled: false }); return buttons.get(id); } },
    setCustomerPushStatus: message => statuses.push(message),
    showToast: message => toasts.push(message),
    openView: view => openedViews.push(view),
    pushApplicationServerKey: key => { calls.push("push.key"); assert.equal(key, "offline-public-key"); const bytes = new Uint8Array(65); bytes[0] = 4; return bytes; },
    cloudRequest: async (path, options = {}) => {
      const method = String(options.method || "GET").toUpperCase();
      calls.push(method === "GET" ? "api.public-key" : "api.save-subscription");
      if (path === "/api/customer-push/config") return { publicKey: "offline-public-key" };
      if (path === "/api/customer-push/subscription" && method === "POST") {
        assert.equal(JSON.parse(options.body).subscription.endpoint, subscription.endpoint);
        if (saveError) throw saveError;
        return saveResult;
      }
      throw new Error("Unexpected offline API request.");
    },
    postPushWorkerSetting: async (_registration, type) => { calls.push("service-worker.customer-enabled"); assert.equal(type, "shivan-customer-push-enable"); return workerAck; },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${setupSource}\nglobalThis.runCustomerPushSetup = enableCustomerPushNotifications;`, sandbox);
  return { run: () => sandbox.runCustomerPushSetup(), calls, statuses, toasts, openedViews, get unsubscribeCalls() { return unsubscribeCalls; } };
}

{
  const h = createHarness();
  assert.equal(await h.run(), true, "successful permission completes setup");
  assert.deepEqual(h.calls, ["permission.request", "service-worker.register", "service-worker.ready", "api.public-key", "push.key", "push.get-subscription", "push.subscribe", "api.save-subscription", "service-worker.customer-enabled"], "the user action completes the full setup in order");
  assert.equal(h.statuses.at(-1), "Notifications enabled successfully!");
  assert.equal(h.toasts.at(-1), "Notifications enabled successfully!");
  assert.deepEqual(h.openedViews, ["home"], "confirmed setup continues into Shop / Models");
  assert.equal(h.unsubscribeCalls, 0, "successful subscription is retained");
}

{
  const h = createHarness({ ios: true, installed: true });
  assert.equal(await h.run(), true, "an installed iPhone Home Screen web app can complete the same setup");
  assert.equal(h.calls[0], "permission.request", "the genuine iOS permission request remains first in the tap flow");
  assert.deepEqual(h.openedViews, ["home"], "successful iPhone setup continues to Shop / Models");
}

{
  const h = createHarness({ permissionResult: "denied" });
  assert.equal(await h.run(), false, "denied permission does not complete setup");
  assert.deepEqual(h.calls, ["permission.request"], "no service worker or API setup happens without permission");
  assert.match(h.toasts.at(-1), /permission was not granted/i);
  assert.deepEqual(h.openedViews, [], "a failed setup does not claim success or redirect");
}

{
  const h = createHarness({ ios: true, installed: false });
  assert.equal(await h.run(), false, "iOS browser without Home Screen installation is blocked");
  assert.deepEqual(h.calls, [], "unsupported iOS context does not request permission or create a subscription");
  assert.match(h.toasts.at(-1), /Home Screen/i);
}

{
  const h = createHarness({ saveResult: { ok: true, registered: false } });
  assert.equal(await h.run(), false, "an unconfirmed server save is not treated as success");
  assert.equal(h.calls.includes("service-worker.customer-enabled"), false, "local customer audience activates only after server confirmation");
  assert.deepEqual(h.openedViews, [], "unconfirmed persistence does not redirect to the Shop");
  assert.doesNotMatch(h.toasts.at(-1), /enabled successfully/i);
}

{
  const h = createHarness({ saveError: Object.assign(new Error("This device is already registered for Owner notifications. Turn those off on this device before enabling customer notifications."), { status: 409 }) });
  assert.equal(await h.run(), false, "server audience conflict is handled as a setup failure");
  assert.match(h.toasts.at(-1), /Owner notifications/i);
  assert.equal(h.unsubscribeCalls, 0, "a server failure does not invalidate a browser endpoint that may belong to Owner notifications");
  assert.equal(h.calls.includes("service-worker.customer-enabled"), false);
  assert.deepEqual(h.openedViews, []);
}

{
  const h = createHarness({ workerAck: false });
  assert.equal(await h.run(), false, "a missing service worker activation acknowledgement is not reported as success");
  assert.deepEqual(h.openedViews, [], "incomplete local activation does not redirect as a completed setup");
  assert.doesNotMatch(h.toasts.at(-1), /enabled successfully/i);
}

console.log("Customer push setup tests passed (7 scenarios).");
