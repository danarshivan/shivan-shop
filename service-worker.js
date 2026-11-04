const PUSH_SETTINGS_DB = "shivan-shop-push-settings";
const PUSH_SETTINGS_STORE = "state";

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

function openSettingsDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUSH_SETTINGS_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(PUSH_SETTINGS_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readPushSetting(key) {
  const db = await openSettingsDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(PUSH_SETTINGS_STORE, "readonly").objectStore(PUSH_SETTINGS_STORE).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

async function writePushSettings(values) {
  const db = await openSettingsDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(PUSH_SETTINGS_STORE, "readwrite");
      const store = transaction.objectStore(PUSH_SETTINGS_STORE);
      for (const [key, value] of Object.entries(values)) store.put(value, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

function safeLocalPath(value, fallback) {
  try {
    const url = new URL(String(value || fallback), self.location.origin);
    if (url.origin !== self.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}

self.addEventListener("message", event => {
  const type = event.data?.type;
  if (!["shivan-push-enable", "shivan-push-disable", "shivan-customer-push-enable", "shivan-customer-push-disable"].includes(type)) return;
  event.waitUntil((async () => {
    if (type.startsWith("shivan-customer-push-")) {
      const enabled = type === "shivan-customer-push-enable";
      await writePushSettings({ customerDisabled: !enabled, audience: "customer" });
    } else {
      await writePushSettings({ disabled: type === "shivan-push-disable", audience: "owner" });
    }
    event.ports?.[0]?.postMessage({ ok: true });
  })());
});

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let data = {};
    try { data = event.data?.json() || {}; } catch { data = { title: "Shivan Shop", body: event.data?.text() || "A new store alert is ready." }; }
    const rawTitle = String(data.title || "shop alert").slice(0, 100);
    const title = (/shivan\s+shop/i.test(rawTitle) ? rawTitle : `SHIVAN SHOP · ${rawTitle}`).slice(0, 100);
    const audience = data.data?.audience;
    if (audience !== "customer" && audience !== "owner") return;
    if (await readPushSetting("audience") !== audience) return;
    if (Notification.permission !== "granted" || await readPushSetting(audience === "customer" ? "customerDisabled" : "disabled") === true) return;
    const body = String(data.body || (audience === "customer" ? "A new Shivan Shop update is ready." : "Open Owner Smart Alerts to review.")).slice(0, 220);
    const eventId = String(data.tag || data.data?.eventId || "shivan-shop-alert").slice(0, 400);
    const fallback = audience === "customer" ? "/" : "/?ownerPush=alerts";
    const safeUrl = safeLocalPath(data.data?.url, fallback);
    const notification = {
      body,
      icon: "/push-icon.svg",
      badge: "/push-icon.svg",
      tag: eventId,
      renotify: false,
      data: { audience, eventId, type: String(data.data?.type || ""), productId: String(data.data?.productId || ""), url: safeUrl },
    };
    if (audience === "customer") {
      const image = String(data.image || "");
      if (image.startsWith("/api/media/shop/") && new URL(image, self.location.origin).origin === self.location.origin) notification.image = image;
    }
    await self.registration.showNotification(title, notification);
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const data = event.notification.data || {};
  const audience = data.audience === "customer" ? "customer" : "owner";
  const target = new URL(safeLocalPath(data.url, audience === "customer" ? "/" : "/?ownerPush=alerts"), self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = clients.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.focus();
      existing.postMessage({ type: audience === "customer" ? "shivan-customer-push-open" : "shivan-owner-push-open", target: { type: data.type, audience, eventId: data.eventId, productId: data.productId, url: target } });
      return;
    }
    await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", event => {
  event.waitUntil((async () => {
    const audience = await readPushSetting("audience") === "customer" ? "customer" : "owner";
    const disabled = await readPushSetting(audience === "customer" ? "customerDisabled" : "disabled");
    if (disabled === true || Notification.permission !== "granted") return;
    const customer = audience === "customer";
    const prefix = customer ? "/api/customer-push" : "/api/push";
    const response = await fetch(`${prefix}/config`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return;
    const config = await response.json();
    const key = String(config.publicKey || "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(key.padEnd(Math.ceil(key.length / 4) * 4, "="));
    const applicationServerKey = Uint8Array.from(binary, character => character.charCodeAt(0));
    const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const save = await fetch(`${prefix}/subscription`, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON(), previousEndpoint: event.oldSubscription?.endpoint || "" }),
    });
    if (!save.ok) await subscription.unsubscribe();
  })());
});
