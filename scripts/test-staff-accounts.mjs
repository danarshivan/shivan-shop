import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function assertPublicInventoryRedacted(productsValue, source) {
  const products = typeof productsValue === "string" ? JSON.parse(productsValue) : productsValue;
  if (!Array.isArray(products)) throw new TypeError(`${source} should return a product list`);
  for (const product of products) {
    assert.equal(Object.hasOwn(product, "stock"), false, `${source} must not expose exact product stock`);
    assert.equal(typeof product.inStock, "boolean", `${source} should expose only product availability`);
    for (const variant of product.variants || []) {
      assert.equal(Object.hasOwn(variant, "stock"), false, `${source} must not expose exact variant stock`);
      assert.equal(typeof variant.inStock, "boolean", `${source} should expose only variant availability`);
    }
  }
  assert.doesNotMatch(JSON.stringify(products), /\"stock\"\s*:/, `${source} must not contain a nested stock quantity`);
}

const migration = async name => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
const db = new DatabaseSync(":memory:");
db.exec("PRAGMA foreign_keys=ON");
db.exec(await migration("0001_shared_store.sql"));

const timestamp = new Date().toISOString();
const customerId = "customer-existing-1";
const variantQrId = webcrypto.randomUUID();
const product = {
  id: 101,
  name: "Sample shirt",
  names: { en: "Sample shirt", ku: "کراسێ نموونە", ar: "قميص تجريبي" },
  price: 12000,
  discount: 10,
  stock: 4,
  variants: [{ color: "#000000", size: "M", stock: 4, qrId: variantQrId }],
  sizes: ["M"],
  colors: ["#000000"],
  colorNames: ["Black"],
  category: "shirts",
  storeAvailability: "shop1",
  image: "",
  images: [],
  description: "Original product description",
};
const existingOrder = {
  id: "order-existing-1",
  userId: customerId,
  name: "Private Customer",
  email: "private@example.com",
  phone: "07500000000",
  city: "Erbil",
  area: "Private area",
  address: "Private address",
  customerName: "Private Customer Alias",
  customerPhone: "07500000000",
  receiptImage: `/api/media/receipts/${"a".repeat(43)}.jpg`,
  fibPaymentId: "private-fib-reference",
  items: [{ productId: 101, name: "Sample shirt", price: 10800, originalPrice: 12000, qty: 1, size: "M", color: "#000000" }],
  total: 10800,
  paymentMethod: "cash",
  paymentStatus: "",
  status: "pending",
};

db.prepare("INSERT INTO accounts (id, identifier, name, role, password_salt, password_hash, created_at) VALUES (?, ?, ?, 'customer', ?, ?, ?)")
  .run(customerId, "customer@example.com", "Existing Customer", "legacy-salt", "legacy-hash", timestamp);
db.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?)")
  .run("shivan_shop_products", JSON.stringify([product]), timestamp);
db.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?)")
  .run("shivan_shop_owner_alerts", JSON.stringify({ initialized: true, alerts: [] }), timestamp);
db.prepare("INSERT INTO shop_state (key, value, updated_at) VALUES (?, ?, ?)")
  .run("shivan_shop_owner_notification_preferences", JSON.stringify({}), timestamp);
db.prepare("INSERT INTO user_state (account_id, key, value, updated_at) VALUES (?, 'support', ?, ?)")
  .run(customerId, JSON.stringify([{ id: "support-existing-1", userId: customerId, message: "Existing customer support message" }]), timestamp);
db.prepare("INSERT INTO orders (id, account_id, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .run(existingOrder.id, customerId, JSON.stringify(existingOrder), timestamp, timestamp);

db.exec(await migration("0005_staff_accounts.sql"));
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM accounts WHERE id=?").get(customerId).count, 1, "the staff migration preserves existing customer accounts");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE id=?").get(existingOrder.id).count, 1, "the staff migration preserves existing customer orders");
assert.equal(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value, JSON.stringify([product]), "the staff migration leaves product data unchanged");

class MemoryD1 {
  constructor(database) { this.database = database; }
  prepare(sql) {
    let values = [];
    return {
      bind(...bound) { values = bound; return this; },
      first: () => {
        const row = this.database.prepare(sql).get(...values);
        return row ? { ...row } : null;
      },
      all: () => ({ results: this.database.prepare(sql).all(...values).map(row => ({ ...row })) }),
      run: () => {
        const result = this.database.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  }
  batch(statements) {
    this.database.exec("BEGIN");
    try {
      const results = statements.map(statement => statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (exception) {
      this.database.exec("ROLLBACK");
      throw exception;
    }
  }
}

const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);
const env = { DB: new MemoryD1(db), OWNER_SETUP_TOKEN: "test-owner-setup-token" };

async function request(path, { method = "GET", body, cookie = "" } = {}) {
  const headers = new Headers();
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (cookie) headers.set("Cookie", `shivan_session=${cookie}`);
  const response = await onRequest({
    request: new Request(`https://shop.test/api/${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }),
    env,
  });
  return { response, data: await response.json().catch(() => ({})) };
}

function sessionFrom(response) {
  const value = response.headers.get("Set-Cookie") || "";
  const match = value.match(/(?:^|;\s*)shivan_session=([^;]+)/);
  assert.ok(match, "successful authentication should set a session cookie");
  return decodeURIComponent(match[1]);
}

const setup = await request("auth/setup-owner", {
  method: "POST",
  body: { setupToken: env.OWNER_SETUP_TOKEN, name: "Main Owner", password: "main-owner-password-123" },
});
assert.equal(setup.response.status, 201, "the existing Main Owner setup flow remains available");
assert.equal(setup.data.account.role, "owner");
assert.equal(setup.data.account.identifier, "07502342153");
const ownerCookie = sessionFrom(setup.response);
assert.match(setup.response.headers.get("Set-Cookie"), /HttpOnly/);
assert.match(setup.response.headers.get("Set-Cookie"), /SameSite=Lax/);
assert.match(setup.response.headers.get("Set-Cookie"), /Secure/);

const ownerLogin = await request("auth/login", {
  method: "POST",
  body: { identifier: "07502342153", password: "main-owner-password-123" },
});
assert.equal(ownerLogin.response.status, 200, "the Main Owner can still sign in with the primary credentials");
const ownerSession = sessionFrom(ownerLogin.response);
const ownerProductSync = await request("sync", { cookie: ownerSession });
const ownerProducts = JSON.parse(ownerProductSync.data.shop.shivan_shop_products);
assert.equal(ownerProducts[0].stock, 4, "the Main Owner receives exact aggregate inventory quantities");
assert.equal(ownerProducts[0].variants[0].stock, 4, "the Main Owner receives exact variant inventory quantities");

async function createStaff(name, identifier, permissions, password = "staff-secure-password-123") {
  const result = await request("staff-accounts", {
    method: "POST",
    cookie: ownerSession,
    body: { name, identifier, permissions, password },
  });
  assert.equal(result.response.status, 201, `the Main Owner can create ${name}`);
  assert.equal(result.data.account.name, name);
  assert.deepEqual([...result.data.account.permissions].sort(), [...permissions].sort());
  assert.equal("passwordHash" in result.data.account, false, "staff account responses never expose password hashes");
  assert.equal("passwordSalt" in result.data.account, false, "staff account responses never expose password salts");
  return result.data.account;
}

const productStaff = await createStaff("Product Staff", "products@example.com", ["products"]);
const priceStaff = await createStaff("Price Staff", "prices@example.com", ["prices"]);
const inventoryStaff = await createStaff("Inventory Staff", "07501112222", ["inventory"]);
const orderStaff = await createStaff("Order Staff", "orders@example.com", ["orders"]);
const reportStaff = await createStaff("Report Staff", "reports@example.com", ["reports"]);
const customerInfoStaff = await createStaff("Customer Info Staff", "customer-info@example.com", ["customer_information"]);
const notificationStaff = await createStaff("Notification Staff", "notifications@example.com", ["notifications"]);
const unprivilegedStaff = await createStaff("Unprivileged Staff", "staff@example.com", []);

const storedStaff = db.prepare("SELECT password_salt, password_hash FROM staff_accounts WHERE id=?").get(productStaff.id);
assert.ok(storedStaff.password_salt && storedStaff.password_hash, "staff credentials use a stored salt and hash");
assert.notEqual(storedStaff.password_hash, "staff-secure-password-123", "staff passwords are not stored as plaintext");
assert.notEqual(storedStaff.password_hash, storedStaff.password_salt);

const staffLogin = await request("auth/login", {
  method: "POST",
  body: { identifier: "products@example.com", password: "staff-secure-password-123" },
});
assert.equal(staffLogin.response.status, 200, "staff credentials authenticate independently of the Owner account");
assert.equal(staffLogin.data.account.role, "staff");
assert.deepEqual(staffLogin.data.account.permissions, ["products"]);
assert.match(staffLogin.response.headers.get("Set-Cookie"), /HttpOnly/);
assert.match(staffLogin.response.headers.get("Set-Cookie"), /SameSite=Lax/);
assert.match(staffLogin.response.headers.get("Set-Cookie"), /Secure/);
const productCookie = sessionFrom(staffLogin.response);
const productMe = await request("auth/me", { cookie: productCookie });
assert.equal(productMe.data.account.role, "staff");
assert.deepEqual(productMe.data.account.permissions, ["products"]);
const productOnlySync = await request("sync", { cookie: productCookie });
const productOnlyProducts = JSON.parse(productOnlySync.data.shop.shivan_shop_products);
assert.equal(Object.hasOwn(productOnlyProducts[0], "stock"), false, "staff without inventory permission receive no exact product quantity");
assert.equal(productOnlyProducts[0].inStock, true, "staff without inventory permission can still see product availability");
assert.equal(Object.hasOwn(productOnlyProducts[0].variants[0], "stock"), false, "staff without inventory permission receive no exact variant quantity");
assert.equal(productOnlyProducts[0].variants[0].inStock, true, "staff without inventory permission can still see variant availability");
assert.doesNotMatch(JSON.stringify(productOnlyProducts), /\"stock\"\s*:/, "the product-only staff API response contains no exact stock fields");

const ownerStaffList = await request("staff-accounts", { cookie: ownerSession });
assert.equal(ownerStaffList.response.status, 200);
assert.equal(ownerStaffList.data.accounts.length, 8);
assert.ok(ownerStaffList.data.accounts.every(account => !("passwordHash" in account) && !("passwordSalt" in account)));
assert.equal((await request("staff-accounts", { cookie: productCookie })).response.status, 403, "staff cannot list staff accounts");
assert.equal((await request("staff-accounts", { method: "POST", cookie: productCookie, body: { name: "Escalated", identifier: "escalated@example.com", password: "staff-secure-password-123", permissions: ["orders"], role: "owner" } })).response.status, 403, "staff cannot create accounts or grant permissions");
assert.equal((await request(`staff-accounts/${productStaff.id}`, { method: "PATCH", cookie: productCookie, body: { permissions: ["orders"] } })).response.status, 403, "staff cannot grant themselves permissions");
assert.equal((await request(`staff-accounts/${productStaff.id}/password`, { method: "POST", cookie: productCookie, body: { password: "another-secure-password-123" } })).response.status, 403, "staff cannot reset another staff credential");
assert.equal((await request("auth/owner-password", { method: "POST", cookie: productCookie, body: { oldPassword: "", newPassword: "attacker-password-123" } })).response.status, 403, "staff cannot change Main Owner credentials");
assert.equal((await request("migrate", { method: "POST", cookie: productCookie, body: { format: "shivan-shop-cloud-v1" } })).response.status, 403, "staff cannot import or overwrite store data");
assert.equal((await request("auth/login", { method: "POST", body: { identifier: "07502342153", password: "staff-secure-password-123" } })).response.status, 401, "staff credentials cannot authenticate as the Main Owner");

const escalationAttempt = await request("profile", {
  method: "PUT",
  cookie: productCookie,
  body: { name: "Product Staff", identifier: "products@example.com", role: "owner", permissions: ["orders", "customer_information"] },
});
assert.equal(escalationAttempt.response.status, 200, "profile updates may still change staff profile fields");
assert.equal(escalationAttempt.data.account.role, "staff", "profile input cannot promote a staff account");
assert.deepEqual(escalationAttempt.data.account.permissions, ["products"], "profile input cannot grant permissions");
assert.equal((await request("profile", { method: "PUT", cookie: productCookie, body: { name: "Product Staff", identifier: "07502342153", role: "owner" } })).response.status, 403, "staff cannot take the Main Owner login identifier");

const productsRead = await request("sync", { cookie: productCookie });
const productsPayload = JSON.parse(productsRead.data.shop.shivan_shop_products);
assert.equal(productsPayload[0].inventoryAvailabilityOnly, true, "product-only staff receive a write-safe availability marker");
productsPayload[0].description = "Updated by Product Staff";
productsPayload[0].storeAvailability = "shop2";
const productMetadataSave = await request("sync", { method: "PUT", cookie: productCookie, body: { key: "shivan_shop_products", value: JSON.stringify(productsPayload) } });
assert.equal(productMetadataSave.response.status, 200, "products permission allows product detail edits");
assert.equal(JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value)[0].price, 12000, "product detail edits preserve the protected price");
assert.equal(JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value)[0].storeAvailability, "shop1", "staff product edits cannot change the Main Owner store assignment");
assert.equal(JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value)[0].variants[0].stock, 4, "product detail edits preserve exact inventory when staff lack inventory permission");

const latestProducts = JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value);
const priceChangeWithoutPermission = structuredClone(latestProducts);
priceChangeWithoutPermission[0].price = 15000;
const rejectedPriceChange = await request("sync", { method: "PUT", cookie: productCookie, body: { key: "shivan_shop_products", value: JSON.stringify(priceChangeWithoutPermission) } });
assert.equal(rejectedPriceChange.response.status, 403, "products permission alone cannot change prices");
const inventoryChangeWithoutPermission = structuredClone(latestProducts);
inventoryChangeWithoutPermission[0].variants[0].stock = 3;
inventoryChangeWithoutPermission[0].stock = 3;
const rejectedInventoryChange = await request("sync", { method: "PUT", cookie: productCookie, body: { key: "shivan_shop_products", value: JSON.stringify(inventoryChangeWithoutPermission) } });
assert.equal(rejectedInventoryChange.response.status, 403, "products permission alone cannot change inventory");

const priceLogin = await request("auth/login", { method: "POST", body: { identifier: "prices@example.com", password: "staff-secure-password-123" } });
const priceCookie = sessionFrom(priceLogin.response);
const priceOnlyProducts = JSON.parse((await request("sync", { cookie: priceCookie })).data.shop.shivan_shop_products);
priceOnlyProducts[0].price = 13000;
const priceSave = await request("sync", { method: "PUT", cookie: priceCookie, body: { key: "shivan_shop_products", value: JSON.stringify(priceOnlyProducts) } });
assert.equal(priceSave.response.status, 200, "prices permission allows price changes");
const detailChangeWithoutPermission = JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value);
detailChangeWithoutPermission[0].description = "Unauthorized description change";
const rejectedDetailChange = await request("sync", { method: "PUT", cookie: priceCookie, body: { key: "shivan_shop_products", value: JSON.stringify(detailChangeWithoutPermission) } });
assert.equal(rejectedDetailChange.response.status, 403, "prices permission alone cannot edit product details");
assert.equal((await request("sync", { method: "PUT", cookie: priceCookie, body: { key: "shivan_shop_ads", value: "[]" } })).response.status, 403, "product price permissions do not grant access to advertisements");

const inventoryLogin = await request("auth/login", { method: "POST", body: { identifier: "07501112222", password: "staff-secure-password-123" } });
const inventoryCookie = sessionFrom(inventoryLogin.response);
const inventoryStaffSync = await request("sync", { cookie: inventoryCookie });
const inventoryStaffProducts = JSON.parse(inventoryStaffSync.data.shop.shivan_shop_products);
assert.equal(inventoryStaffProducts[0].stock, 4, "inventory-authorized staff receive exact aggregate quantities");
assert.equal(inventoryStaffProducts[0].variants[0].stock, 4, "inventory-authorized staff receive exact variant quantities");
assert.equal((await request(`inventory/variant?qr=${encodeURIComponent(variantQrId)}`, { cookie: inventoryCookie })).response.status, 200, "inventory permission allows shared variant reads");
assert.equal((await request("push/config", { cookie: inventoryCookie })).response.status, 403, "inventory permission does not grant Owner push access");
assert.equal((await request("customer-push/config", { cookie: inventoryCookie })).response.status, 403, "staff cannot use customer notification endpoints");
const inventoryAdjustment = await request("inventory/adjust", {
  method: "POST",
  cookie: inventoryCookie,
  body: { qrId: variantQrId, action: "restock", quantity: 2, operationId: webcrypto.randomUUID() },
});
assert.equal(inventoryAdjustment.response.status, 200, "inventory permission allows validated stock adjustments");
assert.equal(inventoryAdjustment.data.variant.stock, 6);
const inventoryStaffSyncAfterAdjustment = await request("sync", { cookie: inventoryCookie });
const inventoryStaffProductsAfterAdjustment = JSON.parse(inventoryStaffSyncAfterAdjustment.data.shop.shivan_shop_products);
assert.equal(inventoryStaffProductsAfterAdjustment[0].stock, 6, "inventory-authorized staff can still view the updated aggregate quantity");
assert.equal(inventoryStaffProductsAfterAdjustment[0].variants[0].stock, 6, "inventory-authorized staff can still view the updated variant quantity");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM staff_state WHERE staff_id=?").get(inventoryStaff.id).count, 1, "inventory idempotency state is stored separately from customer state");

const orderLogin = await request("auth/login", { method: "POST", body: { identifier: "orders@example.com", password: "staff-secure-password-123" } });
const orderCookie = sessionFrom(orderLogin.response);
const orderSync = await request("sync", { cookie: orderCookie });
const staffOrders = JSON.parse(orderSync.data.user.shivan_shop_orders);
assert.equal(staffOrders.length, 1, "orders permission allows staff to view orders");
for (const key of ["name", "email", "phone", "city", "area", "address", "customerName", "customerPhone", "userId", "receiptImage", "fibPaymentId"]) {
  assert.equal(Object.hasOwn(staffOrders[0], key), false, `customer information permission is required before returning order field ${key}`);
}
assert.equal((await request("orders/order-existing-1/next-status", { method: "PATCH", cookie: orderCookie, body: { expectedStatus: "pending" } })).response.status, 200, "orders permission allows order status management");
assert.equal((await request("orders/order-existing-1/next-status", { method: "PATCH", cookie: productCookie, body: {} })).response.status, 403, "products permission cannot update order status");
assert.equal((await request("sync", { method: "PUT", cookie: orderCookie, body: { key: "shivan_shop_orders", value: "[]" } })).response.status, 403, "orders permission does not allow replacing customer order records");

const reportLogin = await request("auth/login", { method: "POST", body: { identifier: "reports@example.com", password: "staff-secure-password-123" } });
const reportSync = await request("sync", { cookie: sessionFrom(reportLogin.response) });
assert.equal(JSON.parse(reportSync.data.user.shivan_shop_orders).length, 1, "reports permission allows aggregate report data");
assert.equal(Object.hasOwn(reportSync.data.user, "accounts"), false, "reports permission does not grant customer account access");

const customerInfoLogin = await request("auth/login", { method: "POST", body: { identifier: "customer-info@example.com", password: "staff-secure-password-123" } });
const customerInfoSync = await request("sync", { cookie: sessionFrom(customerInfoLogin.response) });
assert.equal(JSON.parse(customerInfoSync.data.user.accounts)[0].identifier, "customer@example.com", "customer information permission allows customer contact access");
assert.match(customerInfoSync.data.user.shivan_shop_support, /Existing customer support message/, "customer information permission allows support history access");
assert.equal(Object.hasOwn(customerInfoSync.data.user, "shivan_shop_orders"), false, "customer information permission alone does not grant orders or reports");

const notificationLogin = await request("auth/login", { method: "POST", body: { identifier: "notifications@example.com", password: "staff-secure-password-123" } });
const notificationCookie = sessionFrom(notificationLogin.response);
const ownerAlertFixture = { version: 1, initialized: true, stockInitialized: true, seenOrderIds: [], stockState: {}, discountState: {}, clearedIds: [], alerts: [{ id: "stock:test:low", type: "low_stock", entityId: "101", quantity: 4 }] };
db.prepare("UPDATE shop_state SET value=? WHERE key='shivan_shop_owner_alerts'").run(JSON.stringify(ownerAlertFixture));
const ownerAlertSync = await request("sync", { cookie: ownerSession });
assert.equal(JSON.parse(ownerAlertSync.data.shop.shivan_shop_owner_alerts).alerts[0].quantity, 4, "the Main Owner retains exact stock alert details");
const notificationSync = await request("sync", { cookie: notificationCookie });
assert.ok(notificationSync.data.shop.shivan_shop_owner_alerts, "notifications permission allows in-app Smart Alerts");
assert.equal(Object.hasOwn(JSON.parse(notificationSync.data.shop.shivan_shop_owner_alerts).alerts[0], "quantity"), false, "notifications-only staff do not receive exact stock quantities in alert responses");
assert.equal(Object.hasOwn(notificationSync.data.shop, "shivan_shop_owner_notification_preferences"), false, "staff cannot read Main Owner push preferences");
assert.equal((await request("sync", { method: "PUT", cookie: notificationCookie, body: { key: "shivan_shop_owner_alerts", value: JSON.stringify({ initialized: true, alerts: [] }) } })).response.status, 200, "notifications permission allows Smart Alert state updates");
assert.equal((await request("sync", { method: "PUT", cookie: notificationCookie, body: { key: "shivan_shop_owner_notification_preferences", value: JSON.stringify({}) } })).response.status, 403, "notifications permission does not grant Main Owner or Customer Push preferences");
assert.equal((await request("push/config", { cookie: notificationCookie })).response.status, 403, "notifications permission does not grant Owner push endpoints");

const noPermissionLogin = await request("auth/login", { method: "POST", body: { identifier: "staff@example.com", password: "staff-secure-password-123" } });
const noPermissionCookie = sessionFrom(noPermissionLogin.response);
const noPermissionSync = await request("sync", { cookie: noPermissionCookie });
assert.equal(Object.hasOwn(noPermissionSync.data.user, "shivan_shop_orders"), false, "unprivileged staff receive no order data");
assertPublicInventoryRedacted(noPermissionSync.data.shop.shivan_shop_products, "unprivileged staff sync");
assert.equal((await request(`inventory/variant?qr=${encodeURIComponent(variantQrId)}`, { cookie: noPermissionCookie })).response.status, 403, "unprivileged staff cannot access inventory endpoints");
assert.equal((await request("sync", { method: "PUT", cookie: noPermissionCookie, body: { key: "shivan_shop_owner_appearance", value: "{}" } })).response.status, 403, "staff cannot change Owner store settings");
assert.equal((await request("sync", { method: "PUT", cookie: noPermissionCookie, body: { key: "shivan_shop_support", value: "[]" } })).response.status, 403, "staff cannot change customer support data");

const regrant = await request(`staff-accounts/${productStaff.id}`, {
  method: "PATCH",
  cookie: ownerSession,
  body: { name: "Product and Price Staff", permissions: ["products", "prices"] },
});
assert.equal(regrant.response.status, 200, "the Main Owner can edit staff account permissions");
const updatedProductList = JSON.parse(db.prepare("SELECT value FROM shop_state WHERE key='shivan_shop_products'").get().value);
updatedProductList[0].price = 14000;
const afterGrantSave = await request("sync", { method: "PUT", cookie: productCookie, body: { key: "shivan_shop_products", value: JSON.stringify(updatedProductList) } });
assert.equal(afterGrantSave.response.status, 200, "permission changes apply immediately to an already-authenticated staff session");

const ownerOnlyWrite = await request("sync", { method: "PUT", cookie: productCookie, body: { key: "shivan_shop_owner_appearance", value: "{}" } });
assert.equal(ownerOnlyWrite.response.status, 403, "a staff member with product and price permissions still cannot change Store Settings");

const passwordReset = await request(`staff-accounts/${unprivilegedStaff.id}`, {
  method: "PATCH",
  cookie: ownerSession,
  body: { password: "staff-updated-password-456" },
});
assert.equal(passwordReset.response.status, 200, "the Main Owner can reset staff credentials");
assert.equal((await request("auth/me", { cookie: noPermissionCookie })).data.account, null, "Owner password reset revokes existing staff sessions");
assert.equal((await request("auth/login", { method: "POST", body: { identifier: "staff@example.com", password: "staff-secure-password-123" } })).response.status, 401, "the old staff password stops authenticating after a reset");
const updatedPasswordLogin = await request("auth/login", { method: "POST", body: { identifier: "staff@example.com", password: "staff-updated-password-456" } });
assert.equal(updatedPasswordLogin.response.status, 200, "the replacement staff password authenticates");
const updatedPasswordCookie = sessionFrom(updatedPasswordLogin.response);

const disabled = await request(`staff-accounts/${unprivilegedStaff.id}`, { method: "PATCH", cookie: ownerSession, body: { disabled: true } });
assert.equal(disabled.response.status, 200, "the Main Owner can disable a staff account");
assert.equal(disabled.data.account.disabled, true);
assert.equal((await request("auth/me", { cookie: updatedPasswordCookie })).data.account, null, "disabled staff sessions stop authenticating immediately");
assert.equal((await request("auth/login", { method: "POST", body: { identifier: "staff@example.com", password: "staff-updated-password-456" } })).response.status, 401, "disabled staff cannot sign in");
const enabled = await request(`staff-accounts/${unprivilegedStaff.id}`, { method: "PATCH", cookie: ownerSession, body: { disabled: false } });
assert.equal(enabled.response.status, 200, "the Main Owner can re-enable a staff account");

const finalCustomer = { ...db.prepare("SELECT id, identifier, role FROM accounts WHERE id=?").get(customerId) };
assert.deepEqual(finalCustomer, { id: customerId, identifier: "customer@example.com", role: "customer" }, "customer records remain unchanged by staff account operations");
assert.equal(db.prepare("SELECT COUNT(*) AS count FROM orders WHERE id=?").get(existingOrder.id).count, 1, "existing order records remain present after staff operations");

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /settings-staff-accounts/, "Staff Accounts is linked from Store Settings");
assert.ok(html.includes('name="staffPermission" value="\'+key+\'"'), "the staff form renders one checkbox for each permission option");
for (const permission of ["orders", "products", "inventory", "prices", "reports", "customer_information", "notifications"]) {
  assert.match(html, new RegExp(`\\["${permission}",`), `the staff form includes the ${permission} permission`);
}
assert.match(html, /@media\(max-width:620px\)\{\.owner-staff-permissions\{grid-template-columns:minmax\(0,1fr\)\}/, "Staff Accounts uses a single-column mobile permission layout");
assert.match(html, /if\(route==="products"\)return staffHasPermission\("products"\)\|\|staffHasPermission\("prices"\);/, "staff product routes are scoped by their assigned permissions");
assert.match(apiSource, /Only the Main Owner can manage staff accounts and permissions/, "the account management API is Main Owner-only");

console.log("PASS staff account creation, authentication, scoped permissions, Owner-only controls, session revocation, and migration preservation");
db.close();
