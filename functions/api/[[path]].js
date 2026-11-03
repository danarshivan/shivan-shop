const OWNER_IDENTIFIER = "07502342153";
const COOKIE_NAME = "shivan_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const SHOP_KEYS = new Set([
  "shivan_shop_products",
  "shivan_shop_ads",
  "shivan_shop_ios_onboarding_images",
  "shivan_shop_owner_appearance",
  "shivan_shop_owner_alerts",
  "shivan_shop_categories",
  "shivan_shop_category_meta",
  "shivan_shop_category_renames",
  "shivan_shop_deleted_categories",
]);
const USER_KEYS = new Set(["cart", "favorites", "settings", "support"]);
const PRODUCTS_KEY = "shivan_shop_products";
const INVENTORY_OPERATION_PREFIX = "inventory-op:";
// D1's row limit is 2,000,000 bytes. Base64 adds roughly one third, so leave
// room for JSON, key, and timestamp bytes instead of approaching the hard cap.
const MAX_SHOP_IMAGE_BYTES = 1_300_000;
const MAX_RECEIPT_IMAGE_BYTES = 1_000_000;

const json = (value, status = 200, extraHeaders = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders },
});

const error = (message, status = 400) => json({ error: message }, status);

const OWNER_SAVE_LOG_FIELDS = new Set([
  "method", "mime", "bytes", "payloadBytes", "productCount", "imageCount", "status", "code", "elapsedMs", "d1Success",
]);

function ownerSaveRequestId(request) {
  const supplied = String(request.headers.get("X-Client-Request-ID") || "");
  return /^[A-Za-z0-9_-]{12,80}$/.test(supplied) ? supplied : crypto.randomUUID();
}

function logOwnerSave(stage, requestId, details = {}) {
  if (!requestId) return;
  const safeDetails = Object.fromEntries(Object.entries(details).filter(([key, value]) =>
    OWNER_SAVE_LOG_FIELDS.has(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean"),
  ));
  console.info("[shivan-shop-owner-save]", JSON.stringify({ stage, requestId, ...safeDetails }));
}

function d1FailureCode(exception) {
  const code = String(exception?.code || "").toUpperCase();
  if (/^SQLITE_(?:TOOBIG|FULL|BUSY|LOCKED|READONLY|CONSTRAINT)$/.test(code)) return `D1_${code.slice(7)}`;
  const message = String(exception?.message || "");
  if (/SQLITE_TOOBIG|too big|too large/i.test(message)) return "D1_VALUE_TOO_LARGE";
  if (/SQLITE_FULL|database or disk is full/i.test(message)) return "D1_STORAGE_FULL";
  if (/SQLITE_BUSY|database is locked/i.test(message)) return "D1_BUSY";
  if (/SQLITE_CONSTRAINT/i.test(message)) return "D1_CONSTRAINT";
  if (exception instanceof RangeError) return "IMAGE_LIMIT_EXCEEDED";
  return "D1_WRITE_FAILED";
}

function isD1Conflict(exception) {
  return /SQLITE_CONSTRAINT|unique constraint|already exists/i.test(String(exception?.code || "") + " " + String(exception?.message || ""));
}

function tracedError(message, status, requestId, code, stage) {
  return json({ error: message, requestId, code, stage }, status, { "X-Request-ID": requestId });
}

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

function productDiscountTimerDetails(product, discountPercent) {
  const invalid = () => {
    const exception = new Error("Product discount timer is invalid.");
    exception.code = "INVALID_PRODUCT_DISCOUNT_TIMER";
    return exception;
  };
  const hasEnabled = Object.prototype.hasOwnProperty.call(product || {}, "discountTimerEnabled");
  if (hasEnabled && typeof product.discountTimerEnabled !== "boolean") throw invalid();
  const enabled = product?.discountTimerEnabled === true;
  const rawEnd = product?.discountEndsAt;
  const hasEnd = rawEnd !== undefined && rawEnd !== null && rawEnd !== "";
  if (enabled !== hasEnd) throw invalid();
  if (enabled) {
    if (!discountPercent || typeof rawEnd !== "string") throw invalid();
    const endTime = Date.parse(rawEnd);
    if (!Number.isFinite(endTime) || new Date(endTime).toISOString() !== rawEnd) throw invalid();
  }
  return { discountTimerEnabled: enabled, discountEndsAt: enabled ? rawEnd : "" };
}

function productPriceDetails(product) {
  const invalid = () => {
    const exception = new Error("Product price or discount is invalid.");
    exception.code = "INVALID_PRODUCT_PRICING";
    return exception;
  };
  const parseWholeNumber = value => {
    if (typeof value === "number") return Number.isSafeInteger(value) ? value : NaN;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
    return NaN;
  };
  const originalPrice = parseWholeNumber(product?.price);
  if (!product || typeof product !== "object" || Array.isArray(product) || !Number.isSafeInteger(originalPrice) || originalPrice < 0) throw invalid();
  const hasDiscount = Object.prototype.hasOwnProperty.call(product, "discount") && product.discount !== null && product.discount !== "";
  const discountPercent = hasDiscount ? parseWholeNumber(product.discount) : 0;
  if (hasDiscount && (!Number.isInteger(discountPercent) || discountPercent < 1 || discountPercent > 99)) throw invalid();
  const discountTimer = productDiscountTimerDetails(product, discountPercent);
  const finalPrice = Number((BigInt(originalPrice) * BigInt(100 - discountPercent) + 50n) / 100n);
  if (!Number.isSafeInteger(finalPrice) || finalPrice < 0) throw invalid();
  return { originalPrice, discountPercent, finalPrice, ...discountTimer };
}

function validateProductPriceDetails(products) {
  for (const product of products) productPriceDetails(product);
}

function createVariantQrId(used = new Set()) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = crypto.randomUUID().toLowerCase();
    if (!used.has(id)) { used.add(id); return id; }
  }
  throw new Error("A unique variant QR code could not be generated.");
}

function normalizeVariantColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return /^#[0-9a-f]{3}$/.test(color) ? `#${color.slice(1).split("").map(char => char + char).join("")}` : color;
}

function completeProductVariants(product) {
  const sizes = Array.isArray(product?.sizes) && product.sizes.length ? product.sizes.map(value => String(value)) : ["One Size"];
  const colors = Array.isArray(product?.colors) && product.colors.length
    ? product.colors.map(value => normalizeVariantColor(typeof value === "object" ? value?.value : value)).filter(Boolean)
    : ["#111111"];
  const pairs = colors.flatMap(color => sizes.map(size => ({ color, size })));
  const current = Array.isArray(product?.variants) ? product.variants : [];
  let variants;
  if (!current.length) {
    let remaining = Math.max(0, Math.floor(Number(product?.stock) || 0));
    variants = pairs.map((pair, index) => {
      const stock = index === pairs.length - 1 ? remaining : Math.floor(remaining / (pairs.length - index));
      remaining -= stock;
      return { ...pair, stock };
    });
  } else {
    variants = current.map(item => ({
      ...item,
      color: normalizeVariantColor(item?.color),
      size: String(item?.size || ""),
      stock: Math.max(0, Math.floor(Number(item?.stock) || 0)),
    }));
    for (const pair of pairs) {
      if (!variants.some(item => item.color === pair.color && item.size === pair.size)) variants.push({ ...pair, stock: 0 });
    }
  }
  const totalStock = variants.reduce((sum, item) => sum + item.stock, 0);
  return { ...product, sizes, colors, variants, stock: totalStock };
}

function normalizeProductQrIds(products, previousProducts = []) {
  if (!Array.isArray(products)) throw new Error("Shop inventory is invalid.");
  const priorById = new Map(previousProducts.map(product => [String(product?.id), product]));
  const used = new Set();
  return products.map(rawProduct => {
    const product = completeProductVariants(rawProduct);
    const previous = priorById.get(String(product?.id));
    const previousVariants = Array.isArray(previous?.variants) ? previous.variants : [];
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const normalizedVariants = variants.map(variant => {
      const color = normalizeVariantColor(variant?.color);
      const size = String(variant?.size || "").trim();
      const previousVariant = previousVariants.find(item =>
        normalizeVariantColor(item?.color) === color && String(item?.size || "").trim() === size,
      );
      const oldId = String(previousVariant?.qrId || "").toLowerCase();
      let qrId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(oldId) && !used.has(oldId)
        ? oldId
        : "";
      if (!qrId) qrId = createVariantQrId(used);
      else used.add(qrId);
      return { ...variant, qrId };
    });
    return { ...product, variants: normalizedVariants };
  });
}

function inventoryQrPayload(qrId) {
  return `SHIVAN-VARIANT:1:${qrId}`;
}

function parseInventoryQrId(value) {
  const match = String(value || "").match(/^(?:SHIVAN-VARIANT:1:)?([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i);
  return match ? match[1].toLowerCase() : "";
}

function findVariantByQrId(products, qrId) {
  for (const product of products) {
    const variant = Array.isArray(product?.variants) ? product.variants.find(item => String(item?.qrId || "").toLowerCase() === qrId) : null;
    if (variant) return { product, variant };
  }
  return null;
}

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

async function pushHubRequest(env, path, body) {
  if (!env.SYNC_HUB) throw new Error("Owner push delivery is not connected.");
  const id = env.SYNC_HUB.idFromName("shivan-shop");
  const hub = env.SYNC_HUB.get(id);
  const response = await hub.fetch(`https://sync-hub.internal${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

function publicPushConfiguration(result) {
  if (!result.response.ok) return error("Push notifications are not configured yet.", result.response.status || 503);
  const publicKey = typeof result.payload?.publicKey === "string" ? result.payload.publicKey : "";
  if (!publicKey) return error("The public push key is unavailable.", 503);
  return json({ ok: true, publicKey }, 200, { "Cache-Control": "no-store" });
}

async function queueOwnerPushEvent(env, ownerId, event) {
  if (!env.SYNC_HUB) return false;
  try {
    const result = await pushHubRequest(env, "/push/event", { ownerId, event });
    if (!result.response.ok) console.warn("Owner push event queue rejected.", { status: result.response.status, code: String(result.payload?.code || "PUSH_QUEUE_FAILED") });
    return result.response.ok;
  } catch (exception) {
    console.warn("Owner push event could not be queued.", { code: String(exception?.name || "PUSH_QUEUE_FAILED") });
    return false;
  }
}

function customerPushImage(product) {
  const values = [product?.image, ...(Array.isArray(product?.images) ? product.images : [])];
  for (const value of values) {
    const image = String(typeof value === "object" ? value?.url || value?.src || "" : value || "");
    if (/^\/api\/media\/shop\/[A-Za-z0-9_-]{43}\.(?:jpg|png|webp|gif)$/i.test(image)) return image;
  }
  return "";
}

function customerProductDiscount(product) {
  const value = Number(product?.discount ?? product?.discountPercent ?? product?.discount_percent ?? 0);
  if (!Number.isInteger(value) || value < 1 || value > 99) return 0;
  if (product?.discountTimerEnabled === true) {
    const endAt = Date.parse(String(product?.discountEndsAt || ""));
    if (!Number.isFinite(endAt) || endAt <= Date.now()) return 0;
  }
  return value;
}

async function queueCustomerProductEvents(env, ownerId, previousProducts, nextProducts, requestId = crypto.randomUUID()) {
  if (!env.SYNC_HUB || !Array.isArray(previousProducts) || !Array.isArray(nextProducts)) return;
  const previousById = new Map(previousProducts.map(product => [String(product?.id ?? ""), product]).filter(([id]) => id));
  for (const product of nextProducts) {
    const id = String(product?.id ?? "").slice(0, 100);
    if (!id) continue;
    const name = String(product?.name || product?.names?.en || "New fashion model").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 100) || "New fashion model";
    const previous = previousById.get(id);
    const image = customerPushImage(product);
    const url = `/?customerPush=product&productId=${encodeURIComponent(id)}`;
    const events = [];
    if (!previous) {
      events.push({ eventId: `new-arrival:${encodeURIComponent(id)}:${encodeURIComponent(requestId)}`, type: "new_arrival", title: `New arrival: ${name}`, body: "A new fashion model is now available at Shivan Shop.", url, productId: id, image });
    }
    const before = previous ? customerProductDiscount(previous) : 0;
    const after = customerProductDiscount(product);
    const beforeEnd = previous?.discountTimerEnabled === true ? String(previous.discountEndsAt || "") : "";
    const afterEnd = product?.discountTimerEnabled === true ? String(product.discountEndsAt || "") : "";
    if (after && (!previous || before !== after || beforeEnd !== afterEnd)) {
      const endSignature = afterEnd || "ongoing";
      events.push({ eventId: `discount:${encodeURIComponent(id)}:${after}:${encodeURIComponent(endSignature)}:${encodeURIComponent(requestId)}`, type: "discount", title: `${after}% off: ${name}`, body: `A new ${after}% offer is available at Shivan Shop.`, url, productId: id, image });
    }
    for (const event of events) {
      try {
        const result = await pushHubRequest(env, "/push/customer-event", { ownerId: String(ownerId), event });
        if (!result.response.ok) console.warn("Customer product notification queue rejected.", { status: result.response.status, type: event.type });
      } catch (exception) {
        console.warn("Customer product notification could not be queued.", { code: String(exception?.name || "CUSTOMER_PUSH_QUEUE_FAILED"), type: event.type });
      }
    }
  }
}

async function queueNewOrderPush(env, orderId) {
  try {
    const owner = await env.DB.prepare("SELECT id FROM accounts WHERE role='owner' LIMIT 1").first();
    if (!owner?.id) return false;
    const id = String(orderId || "").slice(0, 100);
    if (!id) return false;
    return queueOwnerPushEvent(env, String(owner.id), {
      eventId: `order:${encodeURIComponent(id)}`,
      type: "new_order",
      title: "New order received",
      body: `Order #${id} is ready to review.`,
      url: `/?ownerPush=orders&order=${encodeURIComponent(id)}`,
    });
  } catch {
    console.warn("Owner order push could not resolve its recipient.");
    return false;
  }
}

function compactPushProducts(products) {
  return (Array.isArray(products) ? products : []).slice(0, 10000).map(product => ({
    id: String(product?.id || "").slice(0, 100),
    name: String(product?.name || product?.names?.en || "Product").slice(0, 100),
    discount: product?.discount,
    discountPercent: product?.discountPercent,
    discount_percent: product?.discount_percent,
    discountTimerEnabled: product?.discountTimerEnabled === true,
    discountEndsAt: product?.discountEndsAt,
    stock: product?.stock,
    variants: (Array.isArray(product?.variants) ? product.variants : []).slice(0, 120).map(variant => ({
      qrId: String(variant?.qrId || "").slice(0, 140),
      color: String(variant?.color || "").slice(0, 40),
      size: String(variant?.size || "").slice(0, 40),
      stock: variant?.stock,
    })),
  }));
}

async function syncOwnerPushProductEvents(env, ownerId, products) {
  if (!env.SYNC_HUB || !ownerId) return;
  const compact = compactPushProducts(products);
  for (const [path, key] of [["/push/stock-snapshot", "products"], ["/push/discounts", "products"]]) {
    try {
      const result = await pushHubRequest(env, path, { ownerId, [key]: compact });
      if (!result.response.ok) console.warn("Owner push state sync rejected.", { path, status: result.response.status });
    } catch (exception) {
      console.warn("Owner push state sync failed.", { path, code: String(exception?.name || "PUSH_SYNC_FAILED") });
    }
  }
}

async function syncCurrentOwnerPushProducts(env, ownerId, { strict = false } = {}) {
  try {
    const row = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
    const products = asJson(row?.value, []);
    if (!Array.isArray(products)) throw new Error("Shared product data is unavailable.");
    await syncOwnerPushProductEvents(env, ownerId, products);
  } catch (exception) {
    console.warn("Owner push inventory state could not be synchronized.", { code: String(exception?.name || "PUSH_SYNC_FAILED") });
    if (strict) throw exception;
  }
}

async function handleOwnerPush(request, env, account, route, url) {
  const denied = requireOwner(account);
  if (denied) return denied;
  if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return error("Cross-origin push settings are not allowed.", 403);
  if (route === "push/customer-broadcasts" && request.method === "GET") {
    try {
      const result = await pushHubRequest(env, "/push/customer-broadcasts");
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("Customer notification history is temporarily unavailable.", 503); }
  }
  if (route === "push/customer-broadcast" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 5000) return error("The customer notification is too large.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const title = String(body?.title || "").trim().slice(0, 100);
    const message = String(body?.message || "").trim().slice(0, 220);
    const requestId = String(body?.requestId || "");
    if (!title || !message || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return error("Add a title and message before sending the customer offer.");
    const productId = String(body?.productId || "").trim().slice(0, 100);
    let product = null;
    if (productId) {
      try {
        const row = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
        const products = asJson(row?.value, null);
        if (!Array.isArray(products)) return error("Saved product data could not be checked. The notification was not sent.", 503);
        product = products.find(item => String(item?.id ?? "") === productId) || null;
      } catch { return error("Saved product data could not be checked. The notification was not sent.", 503); }
      if (!product) return error("That product is not saved in the shared catalog. Save and publish it before sending an offer.", 409);
    }
    const eventId = `special-offer:${requestId}`;
    const path = product ? `/?customerPush=product&productId=${encodeURIComponent(productId)}` : `/?customerPush=offers&offerId=${encodeURIComponent(eventId)}`;
    const event = {
      eventId, type: "special_offer", title, body: message,
      url: path, productId, image: product ? customerPushImage(product) : "",
    };
    try {
      const result = await pushHubRequest(env, "/push/customer-broadcast", { ownerId: String(account.id), event });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("The offer could not be queued. Check the connection and try again.", 503); }
  }
  if (route === "push/config" && request.method === "GET") {
    try {
      const result = await pushHubRequest(env, "/push/config");
      return publicPushConfiguration(result);
    } catch {
      return error("Owner push notifications are not connected yet.", 503);
    }
  }
  if (route === "push/subscription/status" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 5000) return error("The device push subscription is invalid.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const endpoint = String(body?.endpoint || "");
    if (endpoint.length > 4096) return error("The device push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/subscription-status", { ownerId: String(account.id), endpoint });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch {
      return error("This device notification status could not be checked.", 503);
    }
  }
  if (route === "push/test" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 5000) return error("The test request is too large.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const endpoint = String(body?.endpoint || "");
    const requestId = String(body?.requestId || "");
    if (!endpoint || endpoint.length > 4096 || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return error("A registered device and valid test request are required.");
    try {
      const result = await pushHubRequest(env, "/push/test", { ownerId: String(account.id), endpoint, requestId });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch {
      return error("The one-device test notification could not be submitted. Check the device before retrying.", 503);
    }
  }
  if (route === "push/subscription" && request.method === "POST") {
    const contentLength = Number(request.headers.get("Content-Length") || 0);
    if (contentLength > 16000) return error("Push subscription is too large.", 413);
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 16000) return error("Push subscription is too large.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (!body?.subscription || typeof body.subscription !== "object") return error("The browser push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/subscription", { ownerId: String(account.id), subscription: body.subscription, previousEndpoint: String(body.previousEndpoint || "") });
      if (result.response.ok) {
        try { await syncCurrentOwnerPushProducts(env, String(account.id), { strict: true }); }
        catch {
          await pushHubRequest(env, "/push/unsubscribe", { ownerId: String(account.id), endpoint: String(body.subscription.endpoint || "") }).catch(() => {});
          return error("The device subscription could not be prepared with the current store offers. Try enabling notifications again.", 503);
        }
      }
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch {
      return error("The device could not be registered for Owner notifications.", 503);
    }
  }
  if (route === "push/subscription" && request.method === "DELETE") {
    const body = await request.json().catch(() => null);
    const endpoint = String(body?.endpoint || "");
    if (!endpoint || endpoint.length > 4096) return error("The device push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/unsubscribe", { ownerId: String(account.id), endpoint });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch {
      return error("This device could not be removed from Owner notifications.", 503);
    }
  }
  return error("Owner push route not found.", 404);
}

async function handleCustomerPush(request, env, account, route, url) {
  if (!account) return error("Sign in to manage customer notifications.", 401);
  if (account.role !== "customer") return error("Customer notifications are available to customer accounts only.", 403);
  if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return error("Cross-origin notification settings are not allowed.", 403);
  if (route === "customer-push/config" && request.method === "GET") {
    try {
      const result = await pushHubRequest(env, "/push/config");
      return publicPushConfiguration(result);
    } catch { return error("Customer notifications are not connected yet.", 503); }
  }
  if (route === "customer-push/subscription" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 16000) return error("Push subscription is too large.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    if (!body?.subscription || typeof body.subscription !== "object") return error("The browser push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/customer-subscription", {
        customerId: String(account.id), subscription: body.subscription,
        preferences: body.preferences, previousEndpoint: String(body.previousEndpoint || ""),
      });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("This device could not be registered for customer notifications.", 503); }
  }
  if (route === "customer-push/subscription/status" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 5000) return error("The device push subscription is invalid.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const endpoint = String(body?.endpoint || "");
    if (!endpoint || endpoint.length > 4096) return error("The device push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/customer-subscription-status", { customerId: String(account.id), endpoint });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("This device notification status could not be checked.", 503); }
  }
  if (route === "customer-push/preferences" && request.method === "POST") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 2000) return error("Notification preferences are too large.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const endpoint = String(body?.endpoint || "");
    if (endpoint.length > 4096) return error("The device push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/customer-preferences", { customerId: String(account.id), endpoint, preferences: body.preferences });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("Notification preferences could not be saved.", 503); }
  }
  if (route === "customer-push/subscription" && request.method === "DELETE") {
    const raw = await request.text().catch(() => "");
    if (new TextEncoder().encode(raw).byteLength > 5000) return error("The device push subscription is invalid.", 413);
    const body = (() => { try { return JSON.parse(raw); } catch { return null; } })();
    const endpoint = String(body?.endpoint || "");
    if (!endpoint || endpoint.length > 4096) return error("The device push subscription is invalid.");
    try {
      const result = await pushHubRequest(env, "/push/customer-unsubscribe", { customerId: String(account.id), endpoint });
      return json(result.payload, result.response.status, { "Cache-Control": "no-store" });
    } catch { return error("This device could not be removed from customer notifications.", 503); }
  }
  return error("Customer notification route not found.", 404);
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
  const result = await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, accountId, Math.floor(Date.now() / 1000) + SESSION_SECONDS).run();
  requireD1WriteSuccess(result, "Session storage");
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

async function getShopState(env, includeOwnerPrivate = false) {
  // Media is stored as separate D1 rows. Never include those large values in
  // bootstrap or realtime sync responses; shop records contain only URLs.
  const result = await env.DB.prepare("SELECT key, value FROM shop_state WHERE key < 'media:' OR key >= 'media;'").all();
  return Object.fromEntries((result.results || []).filter(row => includeOwnerPrivate || row.key !== "shivan_shop_owner_alerts").map(row => [row.key, row.value]));
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
  const requestId = ownerSaveRequestId(request);
  const startedAt = Date.now();
  const mime = String(request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  logOwnerSave("image.upload.received", requestId, {
    method: request.method,
    mime,
    bytes: Number(request.headers.get("Content-Length")) || 0,
  });
  if (request.method !== "POST") return tracedError("Method not allowed.", 405, requestId, "METHOD_NOT_ALLOWED", "image.upload.method");
  if (request.headers.get("Origin") !== url.origin) return tracedError("Cross-origin image uploads are not allowed.", 403, requestId, "ORIGIN_REJECTED", "image.upload.origin");
  if (!account) {
    logOwnerSave("image.upload.auth_rejected", requestId, { status: 401, code: "AUTH_REQUIRED" });
    return tracedError("Sign in to continue.", 401, requestId, "AUTH_REQUIRED", "image.upload.auth");
  }
  if (account.role !== "owner") {
    logOwnerSave("image.upload.auth_rejected", requestId, { status: 403, code: "OWNER_REQUIRED" });
    return tracedError("Only the store owner can upload shop images.", 403, requestId, "OWNER_REQUIRED", "image.upload.auth");
  }
  if (!Object.hasOwn({ "image/jpeg": true, "image/png": true, "image/webp": true, "image/gif": true }, mime)) {
    return tracedError("Upload a JPEG, PNG, WebP, or GIF image.", 415, requestId, "UNSUPPORTED_IMAGE_TYPE", "image.upload.validate");
  }
  let bytes;
  try { bytes = await readImageUpload(request); }
  catch (exception) {
    const tooLarge = exception instanceof RangeError;
    const code = tooLarge ? "IMAGE_LIMIT_EXCEEDED" : "IMAGE_READ_FAILED";
    logOwnerSave("image.upload.read_failed", requestId, { code, status: tooLarge ? 413 : 400 });
    return tracedError(tooLarge
      ? "Image upload exceeds the 1.3 MB compressed-image limit. Crop or reduce the image and try again."
      : "Image upload could not be read.", tooLarge ? 413 : 400, requestId, code, "image.upload.read");
  }
  if (!bytes.byteLength || !imageMatchesMime(bytes, mime)) {
    logOwnerSave("image.upload.validation_failed", requestId, { mime, bytes: bytes.byteLength, status: 415, code: "INVALID_IMAGE_BYTES" });
    return tracedError("The uploaded file is not a valid image of the declared type.", 415, requestId, "INVALID_IMAGE_BYTES", "image.upload.validate");
  }
  const key = `shop/${await digestBytes(bytes)}.${mediaExtension(mime)}`;
  try {
    const value = JSON.stringify({ mime, data: toBase64(bytes) });
    logOwnerSave("image.upload.d1_write_started", requestId, { mime, bytes: bytes.byteLength });
    const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
      .bind(`media:${key}`, value, now()).run();
    requireD1WriteSuccess(result, "Image storage");
  } catch (exception) {
    const code = d1FailureCode(exception);
    logOwnerSave("image.upload.d1_write_failed", requestId, {
      mime, bytes: bytes.byteLength, status: 503, code, elapsedMs: Date.now() - startedAt, d1Success: false,
    });
    return tracedError("The image could not be saved to shared cloud storage.", 503, requestId, code, "image.upload.d1_write");
  }
  logOwnerSave("image.upload.d1_write_confirmed", requestId, {
    mime, bytes: bytes.byteLength, status: 201, elapsedMs: Date.now() - startedAt, d1Success: true,
  });
  return json({ url: `/api/media/${key}`, persisted: true, requestId }, 201, { "X-Request-ID": requestId });
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
  if (bytes.byteLength > MAX_RECEIPT_IMAGE_BYTES) throw new RangeError("The receipt image exceeds the 1 MB upload limit.");
  if (!bytes.byteLength || !imageMatchesMime(bytes, mime)) throw new Error("The FIB receipt image is invalid.");
  const hash = await digestBytes(bytes);
  const key = `receipts/${hash}.${mediaExtension(mime)}`;
  const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING")
    .bind(`media:${key}`, JSON.stringify({ mime, data: toBase64(bytes) }), now()).run();
  requireD1WriteSuccess(result, "Receipt image storage");
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
    let pricing;
    try { pricing = productPriceDetails(product); }
    catch { return error("A product price or discount is invalid. Refresh the shop and try again.", 409); }
    amount += pricing.finalPrice * quantity;
    if (!Number.isSafeInteger(amount)) return error("The payment total is invalid.", 409);
  }
  if (amount <= 250) return error("FIB requires a payment amount greater than 250 IQD.");

  const existing = await env.DB.prepare("SELECT payment_id, amount, app_link, status, valid_until FROM fib_payments WHERE account_id=? AND order_id=? ORDER BY created_at DESC LIMIT 1")
    .bind(account.id, orderId).first();
  if (existing) {
    if (Number(existing.amount) !== amount) return error("The cart total changed. Reopen checkout before creating a new FIB payment.", 409);
    let status;
    try {
      const statusData = await fibPaymentStatus(env, existing.payment_id);
      status = verifiedFibPaymentStatus(statusData, existing.amount);
    } catch (exception) {
      return error(exception.message || "Could not check the existing FIB payment.", 502);
    }
    try {
      const result = await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), existing.payment_id).run();
      requireD1WriteSuccess(result, "FIB payment status storage");
    } catch { return error("The shared database could not confirm the FIB payment status.", 503); }
    if (["UNPAID", "PAID"].includes(status) && existing.app_link) return json({ paymentId: existing.payment_id, personalAppLink: existing.app_link, amount, status, validUntil: existing.valid_until });
  }

  let payment;
  try {
    payment = await fibApi(env, "", { method: "POST", body: {
      monetaryValue: { amount: String(amount), currency: "IQD" },
      description: `Shivan Shop ${orderId}`.slice(0, 50),
    } });
  } catch (exception) {
    return error(exception.message || "Could not create a FIB payment.", 502);
  }
  const paymentId = String(payment.paymentId || "");
  const appLink = payment.personalAppLink || payment.businessAppLink || payment.corporateAppLink || "";
  if (!paymentId || !isFibAppLink(appLink)) return error("FIB did not return a valid mobile app payment link.", 502);
  const status = String(payment.status || "UNPAID").toUpperCase();
  try {
    const result = await env.DB.prepare("INSERT INTO fib_payments (payment_id, account_id, order_id, amount, app_link, status, valid_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(paymentId, account.id, orderId, amount, appLink, status, String(payment.validUntil || ""), now(), now()).run();
    requireD1WriteSuccess(result, "FIB payment storage");
  } catch { return error("The FIB payment was created, but its details could not be saved. Do not pay again; contact the store owner.", 503); }
  return json({ paymentId, personalAppLink: appLink, amount, status, validUntil: payment.validUntil || "" });
}

async function handleFibPaymentStatus(request, env, account) {
  if (request.method !== "POST") return error("Method not allowed.", 405);
  if (!account) return error("Sign in to continue.", 401);
  const body = await request.json().catch(() => null);
  const paymentId = String(body?.paymentId || "").slice(0, 100);
  if (!paymentId) return error("Payment reference is missing.");
  const payment = await env.DB.prepare("SELECT payment_id, account_id, order_id, amount, status FROM fib_payments WHERE payment_id=?").bind(paymentId).first();
  if (!payment || (account.role !== "owner" && payment.account_id !== account.id)) return error("FIB payment was not found.", 404);
  let status;
  try {
    const statusData = await fibPaymentStatus(env, paymentId);
    status = verifiedFibPaymentStatus(statusData, payment.amount);
  } catch (exception) {
    return error(exception.message || "Could not verify the FIB payment.", 502);
  }
  try {
    const result = await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), paymentId).run();
    requireD1WriteSuccess(result, "FIB payment status storage");
  } catch { return error("The shared database could not confirm the FIB payment status.", 503); }
  return json({ paymentId, orderId: payment.order_id, amount: Number(payment.amount), status });
}

async function saveShopValue(env, key, rawValue, requestId = "") {
  if (!SHOP_KEYS.has(key)) throw new Error("Unsupported shop data key.");
  let value = String(rawValue ?? "");
  if (key === "shivan_shop_ios_onboarding_images") {
    const images = asJson(value, null);
    if (!Array.isArray(images) || images.length !== 3 || !images.every(validPromotionalImageUrl)) {
      const validationError = new Error("Exactly three secure promotional image URLs are required.");
      validationError.code = "INVALID_PROMOTIONAL_IMAGES";
      throw validationError;
    }
    value = JSON.stringify(images);
  }
  if (key === "shivan_shop_products" || key === "shivan_shop_ads") {
    const parsed = asJson(value);
    if (!Array.isArray(parsed)) throw new Error("Shop data must be a list.");
    if (key === PRODUCTS_KEY) {
      validateProductPriceDetails(parsed);
      const previousRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
      const previousProducts = asJson(previousRow?.value, []);
      value = JSON.stringify(normalizeProductQrIds(parsed, Array.isArray(previousProducts) ? previousProducts : []));
    }
    const normalized = asJson(value, parsed);
    const mediaWrites = new Map();
    value = JSON.stringify(await persistImages(normalized, env, mediaWrites));
    const statements = [...mediaWrites.values()];
    // Keep batches small for predictable free-tier resource use. Each chunk is
    // atomic, and the shop record is written only after all referenced media.
    for (let index = 0; index < statements.length; index += 20) {
      logOwnerSave("shop.images.d1_batch_started", requestId, { imageCount: Math.min(20, statements.length - index) });
      const results = await env.DB.batch(statements.slice(index, index + 20));
      requireD1WriteSuccess(results, "Shop image storage");
      logOwnerSave("shop.images.d1_batch_confirmed", requestId, { imageCount: Math.min(20, statements.length - index), d1Success: true });
    }
  }
  logOwnerSave("shop.data.d1_write_started", requestId, {
    payloadBytes: new TextEncoder().encode(value).byteLength,
    productCount: key === "shivan_shop_products" ? (asJson(value, []).length || 0) : 0,
  });
  const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
    .bind(key, value, now()).run();
  requireD1WriteSuccess(result, "Shop data storage");
  logOwnerSave("shop.data.d1_write_confirmed", requestId, { payloadBytes: new TextEncoder().encode(value).byteLength, d1Success: true });
  return value;
}

function requireOwner(account) {
  if (!account) return error("Sign in with the store owner account to manage inventory.", 401);
  if (account.role !== "owner") return error("Only the store owner can manage inventory.", 403);
  return null;
}

function inventoryVariantView(match) {
  if (!match) return null;
  const { product, variant } = match;
  return {
    qrId: variant.qrId,
    qr: inventoryQrPayload(variant.qrId),
    productId: product.id,
    productName: String(product.name || product.names?.en || "Product"),
    color: variant.color,
    colorName: (product.colorNames || [])[Math.max(0, (product.colors || []).indexOf(variant.color))] || String(variant.color || ""),
    size: String(variant.size || ""),
    stock: Math.max(0, Math.floor(Number(variant.stock) || 0)),
  };
}

async function handleInventory(request, env, account, route) {
  const denied = requireOwner(account);
  if (denied) return denied;
  const url = new URL(request.url);
  if (request.headers.get("Origin") && request.headers.get("Origin") !== url.origin) return error("Cross-origin inventory changes are not allowed.", 403);

  if (route === "inventory/qr/ensure" && request.method === "POST") {
    const row = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
    if (typeof row?.value !== "string") return json({ ok: true, changed: false, products: [] });
    const previous = asJson(row.value, null);
    if (!Array.isArray(previous)) return error("Shop inventory is invalid.", 409);
    const products = normalizeProductQrIds(previous, previous);
    const nextValue = JSON.stringify(products);
    let changed = nextValue !== row.value;
    if (changed) {
      const result = await env.DB.prepare("UPDATE shop_state SET value=?, updated_at=? WHERE key=? AND value=?")
        .bind(nextValue, now(), PRODUCTS_KEY, row.value).run();
      requireD1WriteSuccess(result, "Variant QR code storage");
      if (Number(result?.meta?.changes) !== 1) return error("Inventory changed while QR codes were being prepared. Refresh and try again.", 409);
      await broadcastSync(env);
    }
    const variantCount = products.reduce((sum, product) => sum + (product.variants?.length || 0), 0);
    return json({ ok: true, changed, variantCount, products });
  }

  if (route === "inventory/variant" && request.method === "GET") {
    const qrId = parseInventoryQrId(url.searchParams.get("qr"));
    if (!qrId) return error("That QR code is not a Shivan Shop product variant.");
    const row = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
    const products = asJson(row?.value, []);
    const match = Array.isArray(products) ? findVariantByQrId(products, qrId) : null;
    if (!match) return error("This product variant was not found in the shared inventory.", 404);
    return json({ ok: true, variant: inventoryVariantView(match) });
  }

  if (route === "inventory/operation" && request.method === "GET") {
    const operationId = String(url.searchParams.get("operationId") || "").toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) return error("The inventory operation reference is invalid.");
    const row = await env.DB.prepare("SELECT value FROM user_state WHERE account_id=? AND key=?").bind(account.id, `${INVENTORY_OPERATION_PREFIX}${operationId}`).first();
    if (!row) return json({ ok: true, found: false });
    const operation = asJson(row.value, {});
    if (operation.state !== "complete") return json({ ok: true, found: true, pending: true }, 202);
    return json({ ok: true, found: true, pending: false, operation });
  }

  if (route === "inventory/adjust" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const qrId = parseInventoryQrId(body?.qrId);
    const action = String(body?.action || "");
    const quantity = Number(body?.quantity);
    const operationId = String(body?.operationId || "").toLowerCase();
    if (!qrId || !["sale", "restock"].includes(action) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999999) return error("Choose a valid variant, action, and whole quantity.");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)) return error("The inventory operation reference is invalid.");
    const operationKey = `${INVENTORY_OPERATION_PREFIX}${operationId}`;
    const previousOperation = await env.DB.prepare("SELECT value FROM user_state WHERE account_id=? AND key=?").bind(account.id, operationKey).first();
    if (previousOperation) {
      const saved = asJson(previousOperation.value, {});
      if (saved.state === "complete") return json({ ok: true, duplicate: true, variant: saved.variant, action: saved.action, quantity: saved.quantity });
      return error("This inventory change is already being processed. Wait briefly, then scan again.", 409);
    }

    const productRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
    const products = asJson(productRow?.value, null);
    if (!Array.isArray(products)) return error("Shared inventory is unavailable.", 503);
    const match = findVariantByQrId(products, qrId);
    if (!match) return error("This product variant was not found in the shared inventory.", 404);
    const stock = Math.max(0, Math.floor(Number(match.variant.stock) || 0));
    if (action === "sale" && quantity > stock) return error(stock === 0 ? "This variant is out of stock." : "There is not enough stock for that sale.", 409);
    if (action === "restock" && stock + quantity > 1000000) return error("The resulting stock is above the supported limit.", 400);
    const nextStock = action === "sale" ? stock - quantity : stock + quantity;
    match.variant.stock = nextStock;
    match.product.stock = (match.product.variants || []).reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.stock) || 0)), 0);
    const nextProductsValue = JSON.stringify(products);
    const pendingToken = `pending:${crypto.randomUUID()}`;
    const resultVariant = { ...inventoryVariantView(match), stock: nextStock };
    const completedValue = JSON.stringify({ state: "complete", action, quantity, variant: resultVariant, completedAt: now() });
    const statements = [
      env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, key) DO NOTHING")
        .bind(account.id, operationKey, pendingToken, now()),
      env.DB.prepare("UPDATE shop_state SET value=?, updated_at=? WHERE key=? AND value=? AND EXISTS (SELECT 1 FROM user_state WHERE account_id=? AND key=? AND value=?)")
        .bind(nextProductsValue, now(), PRODUCTS_KEY, productRow.value, account.id, operationKey, pendingToken),
      env.DB.prepare("UPDATE user_state SET value=?, updated_at=? WHERE account_id=? AND key=? AND value=? AND EXISTS (SELECT 1 FROM shop_state WHERE key=? AND value=?)")
        .bind(completedValue, now(), account.id, operationKey, pendingToken, PRODUCTS_KEY, nextProductsValue),
      env.DB.prepare("DELETE FROM user_state WHERE account_id=? AND key=? AND value=?")
        .bind(account.id, operationKey, pendingToken),
    ];
    let results;
    try {
      results = await env.DB.batch(statements);
      requireD1WriteSuccess(results, "Inventory adjustment");
    } catch {
      return error("The shared database could not confirm this stock change. Check the current stock before trying again.", 503);
    }
    if (Number(results?.[0]?.meta?.changes) !== 1) {
      const racedOperation = await env.DB.prepare("SELECT value FROM user_state WHERE account_id=? AND key=?").bind(account.id, operationKey).first();
      const saved = asJson(racedOperation?.value, {});
      if (saved.state === "complete") return json({ ok: true, duplicate: true, variant: saved.variant, action: saved.action, quantity: saved.quantity });
      return error("Inventory changed on another device. Refresh the variant and try again.", 409);
    }
    if (Number(results?.[1]?.meta?.changes) !== 1 || Number(results?.[2]?.meta?.changes) !== 1) return error("The stock change could not be confirmed. Refresh the inventory before retrying.", 503);
    await broadcastSync(env);
    await syncCurrentOwnerPushProducts(env, String(account.id));
    return json({ ok: true, duplicate: false, variant: resultVariant, action, quantity });
  }
  return error("Inventory route not found.", 404);
}

function validPromotionalImageUrl(value) {
  if (typeof value !== "string" || value.length > 2048) return false;
  if (/^\/api\/media\/shop\/[A-Za-z0-9_-]{43}\.(?:jpg|png|webp|gif)$/i.test(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
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
      const result = await env.DB.prepare("INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'owner', ?, ?, ?)")
        .bind(id, identifier, name, salt, hash, now()).run();
      requireD1WriteSuccess(result, "Owner account storage");
    } catch (exception) {
      return isD1Conflict(exception) ? error("An account already uses that phone number.", 409) : error("The owner account could not be saved to the shared database.", 503);
    }
    let setCookie;
    try { setCookie = await createSession(env, id, secure); }
    catch { return error("The owner account was saved, but sign-in could not be started. Please sign in again.", 503); }
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
      const result = await env.DB.prepare("INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
        .bind(id, identifier, name, salt, hash, now()).run();
      requireD1WriteSuccess(result, "Customer account storage");
    } catch (exception) {
      return isD1Conflict(exception) ? error("An account with that email or phone number already exists.", 409) : error("The account could not be saved to the shared database.", 503);
    }
    let setCookie;
    try { setCookie = await createSession(env, id, secure); }
    catch { return error("The account was saved, but sign-in could not be started. Please sign in again.", 503); }
    return json({ account: { id, identifier, name, role: "customer" } }, 201, { "Set-Cookie": setCookie });
  }

  if (route === "auth/login" && request.method === "POST") {
    const body = await request.json().catch(() => null);
    const identifier = String(body?.identifier || "").trim().toLowerCase();
    const password = String(body?.password || "");
    if (!identifier || !password) return error("Enter your email or phone and password.");
    const row = await env.DB.prepare("SELECT * FROM accounts WHERE identifier=? COLLATE NOCASE").bind(identifier).first();
    if (!row || await passwordHash(password, row.password_salt) !== row.password_hash) return error("The email/phone number or password is incorrect.", 401);
    let setCookie;
    try { setCookie = await createSession(env, row.id, secure); }
    catch { return error("Sign-in could not be completed. Please try again.", 503); }
    return json({ account: accountView(row) }, 200, { "Set-Cookie": setCookie });
  }

  if (route === "auth/me" && request.method === "GET") {
    return json({ account: await currentAccount(request, env) });
  }

  if (route === "auth/logout" && request.method === "POST") {
    const token = cookieValue(request, COOKIE_NAME);
    if (token) {
      try {
        const result = await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await digest(token)).run();
        requireD1WriteSuccess(result, "Session removal");
      } catch {
        return json({ error: "The session could not be revoked from the shared database." }, 503, { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}` });
      }
    }
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
    try {
      const result = await env.DB.prepare("UPDATE accounts SET password_salt=?, password_hash=? WHERE id=?").bind(salt, hash, account.id).run();
      requireD1WriteSuccess(result, "Password storage");
    } catch { return error("The password change could not be saved to the shared database.", 503); }
    return json({ ok: true });
  }

  return error("Not found.", 404);
}

async function handleSync(request, env, account) {
  if (request.method === "GET") {
    const shop = await getShopState(env, account?.role === "owner");
    if (!account) return json({ shop, user: null, account: null });
    const result = await env.DB.prepare("SELECT key, value FROM user_state WHERE account_id=? AND key NOT LIKE 'inventory-op:%'").bind(account.id).all();
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
      const requestId = ownerSaveRequestId(request);
      if (account.role !== "owner") {
        logOwnerSave("shop.sync.auth_rejected", requestId, { status: 403, code: "OWNER_REQUIRED" });
        return tracedError("Only the store owner can change shop settings.", 403, requestId, "OWNER_REQUIRED", "shop.sync.delete.auth");
      }
      try {
        const result = await env.DB.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, '', ?) ON CONFLICT(key) DO UPDATE SET value='', updated_at=excluded.updated_at").bind(key, now()).run();
        requireD1WriteSuccess(result, "Shop data removal");
      } catch (exception) {
        const code = d1FailureCode(exception);
        logOwnerSave("shop.sync.d1_delete_failed", requestId, { status: 503, code, d1Success: false });
        return tracedError("The shared database could not confirm this shop change.", 503, requestId, code, "shop.sync.delete");
      }
      await broadcastSync(env);
      logOwnerSave("shop.sync.d1_delete_confirmed", requestId, { status: 200, d1Success: true });
      return json({ ok: true, key, persisted: true, requestId }, 200, { "X-Request-ID": requestId });
    }
    const userKey = key === "shivan_shop_support" ? "support" : key === "shivan_shop_settings" ? "settings" : key.startsWith("shivan_shop_cart_") ? "cart" : key.startsWith("shivan_shop_favorites_") ? "favorites" : "";
    if (!USER_KEYS.has(userKey)) return error("Unsupported sync key.");
    try {
      const result = await env.DB.prepare("DELETE FROM user_state WHERE account_id=? AND key=?").bind(account.id, userKey).run();
      requireD1WriteSuccess(result, "User data removal");
    } catch { return error("The shared database could not confirm removing this saved data.", 503); }
    await broadcastSync(env);
    return json({ ok: true });
  }
  if (request.method !== "PUT") return error("Method not allowed.", 405);
  const requestId = ownerSaveRequestId(request);
  if (!account) {
    logOwnerSave("shop.sync.auth_rejected", requestId, { status: 401, code: "AUTH_REQUIRED" });
    return tracedError("Sign in to save changes across devices.", 401, requestId, "AUTH_REQUIRED", "shop.sync.auth");
  }
  const body = await request.json().catch(() => null);
  const key = String(body?.key || "");
  const value = String(body?.value ?? "");
  if (SHOP_KEYS.has(key)) {
    const isProductSave = key === "shivan_shop_products";
    if (account.role !== "owner") {
      logOwnerSave(isProductSave ? "product.sync.auth_rejected" : "shop.sync.auth_rejected", requestId, { status: 403, code: "OWNER_REQUIRED" });
      return tracedError("Only the store owner can change shop settings.", 403, requestId, "OWNER_REQUIRED", isProductSave ? "product.sync.auth" : "shop.sync.auth");
    }
    const productList = isProductSave ? asJson(value, []) : [];
    let previousProductList = null;
    if (isProductSave) {
      try {
        const previousRow = await env.DB.prepare("SELECT value FROM shop_state WHERE key=?").bind(PRODUCTS_KEY).first();
        const previous = asJson(previousRow?.value, []);
        if (Array.isArray(previous)) previousProductList = previous;
      } catch (exception) {
        console.warn("Customer product notifications skipped because the previous shared catalog could not be read.", { code: d1FailureCode(exception) });
      }
    }
    if (isProductSave) logOwnerSave("product.sync.request_received", requestId, {
      method: request.method,
      payloadBytes: new TextEncoder().encode(value).byteLength,
      productCount: Array.isArray(productList) ? productList.length : 0,
      imageCount: Array.isArray(productList) ? productList.reduce((sum, product) => sum + (Array.isArray(product?.images) ? product.images.length : product?.image ? 1 : 0), 0) : 0,
    });
    let persistedValue = value;
    try { persistedValue = await saveShopValue(env, key, value, requestId); }
    catch (exception) {
      if (exception?.code === "INVALID_PROMOTIONAL_IMAGES") {
        return tracedError(exception.message, 400, requestId, exception.code, "shop.sync.validate");
      }
      if (exception?.code === "INVALID_PRODUCT_PRICING") {
        return tracedError("Product price or discount is invalid. Use a whole nonnegative IQD price and a discount from 1% to 99%.", 400, requestId, exception.code, "shop.sync.validate");
      }
      if (exception?.code === "INVALID_PRODUCT_DISCOUNT_TIMER") {
        return tracedError("Limited-time discounts need a valid 1% to 99% discount and an exact ISO end date and time.", 400, requestId, exception.code, "shop.sync.validate");
      }
      const tooLarge = exception instanceof RangeError;
      const code = tooLarge ? "IMAGE_LIMIT_EXCEEDED" : d1FailureCode(exception);
      logOwnerSave(isProductSave ? "product.sync.d1_write_failed" : "shop.sync.d1_write_failed", requestId, {
        payloadBytes: new TextEncoder().encode(value).byteLength,
        productCount: Array.isArray(productList) ? productList.length : 0,
        status: tooLarge ? 413 : 503,
        code,
        d1Success: false,
      });
      if (tooLarge) return tracedError(exception.message || "Shop images exceed the shared storage limit.", 413, requestId, code, isProductSave ? "product.sync.validate" : "shop.sync.validate");
      return tracedError(isProductSave
        ? "The shared database could not confirm this product save. Your device will keep it queued for retry."
        : "The shared database could not confirm this shop update. Your device will keep it queued for retry.", 503, requestId, code, isProductSave ? "product.sync.d1_write" : "shop.sync.d1_write");
    }
    await broadcastSync(env);
    if (isProductSave) {
      if (previousProductList) await queueCustomerProductEvents(env, String(account.id), previousProductList, asJson(persistedValue, []), requestId);
      await syncCurrentOwnerPushProducts(env, String(account.id));
      logOwnerSave("product.sync.d1_write_confirmed", requestId, {
        payloadBytes: new TextEncoder().encode(value).byteLength,
        productCount: Array.isArray(productList) ? productList.length : 0,
        status: 200,
        d1Success: true,
      });
      return json({ ok: true, key, persisted: true, requestId }, 200, { "X-Request-ID": requestId });
    }
    logOwnerSave("shop.sync.d1_write_confirmed", requestId, { payloadBytes: new TextEncoder().encode(value).byteLength, d1Success: true });
    return json({ ok: true, key, persisted: true, requestId }, 200, { "X-Request-ID": requestId });
  }

  if (key === "shivan_shop_orders") {
    const list = asJson(value);
    if (!Array.isArray(list)) return error("Order data is invalid.");
    const updates = [];
    const customerOrderWrites = [];
    const submittedOrderIds = new Set();
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
      if (submittedOrderIds.has(orderId)) return error("An order was submitted more than once in this request.", 409);
      submittedOrderIds.add(orderId);
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
          let pricing;
          try { pricing = productPriceDetails(product); }
          catch { return error("A product price or discount is invalid. Refresh the shop and try again.", 409); }
          const trustedItem = { ...item, productId, size, color, qty: quantity, price: pricing.finalPrice, originalPrice: pricing.originalPrice };
          delete trustedItem.discount;
          if (pricing.discountPercent) trustedItem.discount = pricing.discountPercent;
          trustedItems.push(trustedItem);
          trustedTotal += pricing.finalPrice * quantity;
          if (!Number.isSafeInteger(trustedTotal)) return error("The order total is invalid.", 409);
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
          try {
            const result = await env.DB.prepare("UPDATE fib_payments SET status=?, updated_at=? WHERE payment_id=?").bind(status, now(), fibPaymentId).run();
            requireD1WriteSuccess(result, "FIB payment status storage");
          } catch { return error("The shared database could not confirm the FIB payment status. The order was not saved.", 503); }
          if (status !== "PAID") return error("FIB has not confirmed the payment yet.", 409);
          paymentStatus="PAID";
        }
        trustedOrder = { ...order, items: trustedItems, total: trustedTotal, paymentMethod, fibPaymentId, paymentStatus, userId: account.id };
      }
      try { trustedOrder = { ...trustedOrder, receiptImage: await persistReceiptImage(trustedOrder.receiptImage, env) }; }
      catch (exception) {
        const tooLarge = exception instanceof RangeError;
        return error(tooLarge ? exception.message : "The transfer receipt could not be saved to the shared database.", tooLarge ? 413 : 503);
      }
      const orderUserId = account.role === "owner" ? orderAccountId : account.id;
      const payload = { ...trustedOrder, userId: orderUserId };
      savedOrders.push({ id: orderId, receiptImage: payload.receiptImage || "", paymentStatus: payload.paymentStatus || "", fibPaymentId: payload.fibPaymentId || "" });
      const orderInsert = env.DB.prepare("INSERT INTO orders (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, updated_at=excluded.updated_at")
        .bind(orderId, orderUserId, JSON.stringify(payload), String(order.date || now()), now());
      if (account.role === "owner") updates.push(orderInsert);
      else customerOrderWrites.push({ orderInsert, values: [orderId, orderUserId, JSON.stringify(payload), String(order.date || now()), now()] });
    }
    if (inventoryChanged) {
      const operationKey = `inventory-txn:${crypto.randomUUID()}`;
      const pendingToken = `pending:${crypto.randomUUID()}`;
      const productValue = JSON.stringify(products);
      const markerValue = JSON.stringify({ state: "pending", createdAt: now() });
      const transaction = [
        env.DB.prepare("UPDATE shop_state SET value=?, updated_at=? WHERE key='shivan_shop_products' AND value=?")
          .bind(productValue, now(), productRow.value),
        env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) SELECT ?, ?, ?, ? WHERE changes()=1 ON CONFLICT(account_id, key) DO NOTHING")
          .bind(account.id, operationKey, pendingToken, now()),
      ];
      for (const entry of customerOrderWrites) {
        transaction.push(env.DB.prepare("INSERT INTO orders (id, account_id, payload, created_at, updated_at) SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM user_state WHERE account_id=? AND key=? AND value=?) ON CONFLICT(id) DO NOTHING")
          .bind(...entry.values, account.id, operationKey, pendingToken));
      }
      transaction.push(env.DB.prepare("DELETE FROM user_state WHERE account_id=? AND key=? AND value=?").bind(account.id, operationKey, pendingToken));
      try {
        const results = await env.DB.batch(transaction);
        requireD1WriteSuccess(results, "Order and inventory storage");
        if (Number(results?.[0]?.meta?.changes) !== 1) return error("Inventory changed on another device. Refresh your cart and submit the order again.", 409);
        if (Number(results?.[1]?.meta?.changes) !== 1) return error("The shared database could not confirm the order transaction.", 503);
        if (customerOrderWrites.some((_, index) => Number(results?.[index + 2]?.meta?.changes) !== 1)) return error("The shared database could not confirm every order item.", 503);
      } catch { return error("The order could not be confirmed by the shared database. Inventory was not confirmed as changed.", 503); }
      await broadcastSync(env);
      if (account.role !== "owner") {
        for (const saved of savedOrders) await queueNewOrderPush(env, saved.id);
      }
      if (inventoryChanged) {
        const owner = await env.DB.prepare("SELECT id FROM accounts WHERE role='owner' LIMIT 1").first().catch(() => null);
        if (owner?.id) await syncCurrentOwnerPushProducts(env, String(owner.id));
      }
      return json({ ok: true, savedOrders });
    }
    if (updates.length) {
      try {
        const results = await env.DB.batch(updates);
        requireD1WriteSuccess(results, "Order and inventory storage");
      } catch { return error("The order could not be confirmed by the shared database. Inventory was not confirmed as changed.", 503); }
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
  try {
    const result = await env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .bind(account.id, userKey, value, now()).run();
    requireD1WriteSuccess(result, "User data storage");
  } catch { return error("The shared database could not confirm saving this data.", 503); }
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
    const result = await env.DB.prepare("UPDATE accounts SET name=?, identifier=? WHERE id=?").bind(name, identifier, account.id).run();
    requireD1WriteSuccess(result, "Profile storage");
  } catch (exception) {
    return isD1Conflict(exception) ? error("That email or phone number is already in use.", 409) : error("The shared database could not confirm this profile change.", 503);
  }
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
    const result = await env.DB.prepare("INSERT OR IGNORE INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
      .bind(id, identifier, String(item.name || "Customer").slice(0, 80), String(item.passwordSalt), String(item.passwordHash), String(item.createdAt || now())).run();
    requireD1WriteSuccess(result, "Imported account storage");
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
      const result = await env.DB.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(account_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
        .bind(accountId, key, savedValue, now()).run();
      requireD1WriteSuccess(result, "Imported user data storage");
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
    const result = await env.DB.prepare("INSERT OR IGNORE INTO orders (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, accountId, JSON.stringify(payload), String(order.date || now()), now()).run();
    requireD1WriteSuccess(result, "Imported order storage");
  }
  await broadcastSync(env);
  return json({ ok: true, accountsImported: accounts.length, ordersImported: orders.length });
}

function nextOwnerOrderWorkflowStatus(status) {
  const value = String(status || "").trim().toLocaleLowerCase();
  if (/cancel|canceled|cancelled|هەڵوەشاندنەوە|ملغي|إلغاء|گەهشت|delivered|complete|completed|fulfilled/.test(value)) return "";
  if (/پێچرا|هاتە ناردن|process|ship|transit|dispatched/.test(value)) return "گەهشت";
  return "پێچرا";
}

async function handleNextOwnerOrderStatus(request, env, account, route) {
  if (request.method !== "PATCH") return error("Method not allowed.", 405);
  if (!account) return error("Sign in to continue.", 401);
  if (account.role !== "owner") return error("Only the store owner can update orders.", 403);

  let orderId;
  try { orderId = decodeURIComponent(route.slice("orders/".length, -"/next-status".length)); }
  catch { return error("The order number is invalid."); }
  if (!orderId || orderId.length > 100 || orderId.includes("/")) return error("The order number is invalid.");

  const body = await request.json().catch(() => null);
  if (!body || typeof body.expectedStatus !== "string") return error("The current order status is required.");
  let row;
  try { row = await env.DB.prepare("SELECT payload FROM orders WHERE id=?").bind(orderId).first(); }
  catch { return error("The shared database could not read this order status. Try again.", 503); }
  if (!row) return error("This order is no longer available.", 404);
  const order = asJson(row.payload);
  if (!order || String(order.id || "") !== orderId) return error("Saved order data is invalid.", 409);
  const currentStatus = String(order.status || "");
  if (body.expectedStatus !== currentStatus) return json({ error: "This order changed elsewhere. Refresh its status and try again.", code: "ORDER_STATUS_CHANGED" }, 409);
  const nextStatus = nextOwnerOrderWorkflowStatus(currentStatus);
  if (!nextStatus) return json({ error: "This order has no further status step.", code: "ORDER_STATUS_FINAL" }, 409);

  try {
    const result = await env.DB.prepare("UPDATE orders SET payload=json_set(payload, '$.status', ?) WHERE id=? AND payload=?")
      .bind(nextStatus, orderId, String(row.payload)).run();
    requireD1WriteSuccess(result, "Order status storage");
    if (Number(result?.meta?.changes) !== 1) return json({ error: "This order changed elsewhere. Refresh its status and try again.", code: "ORDER_STATUS_CHANGED" }, 409);
  } catch {
    return error("The shared database could not confirm this order status update. The order was not changed.", 503);
  }

  try { await broadcastSync(env); } catch { /* The confirmed D1 status remains available through the normal refresh path. */ }
  return json({ ok: true, persisted: true, orderId, status: nextStatus });
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
  if (route === "customer-push/offer" && request.method === "GET") {
    const eventId = String(url.searchParams.get("eventId") || "").slice(0, 300);
    if (!eventId) return error("Offer not found.", 404);
    try {
      const result = await pushHubRequest(env, `/push/customer-offer?eventId=${encodeURIComponent(eventId)}`);
      return json(result.payload, result.response.status, { "Cache-Control": "public, max-age=60" });
    } catch { return error("This offer is temporarily unavailable.", 503); }
  }
  if (route.startsWith("auth/")) return handleAuth(request, env, route, secure);
  const account = await currentAccount(request, env);
  if (route.startsWith("push/")) return handleOwnerPush(request, env, account, route, url);
  if (route.startsWith("customer-push/")) return handleCustomerPush(request, env, account, route, url);
  if (route.startsWith("inventory/")) return handleInventory(request, env, account, route);
  if (route.startsWith("orders/") && route.endsWith("/next-status")) return handleNextOwnerOrderStatus(request, env, account, route);
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
