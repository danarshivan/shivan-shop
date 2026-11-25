import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const migration = await readFile(new URL("../migrations/0006_pos_sales.sql", import.meta.url), "utf8");
for (const [index, script] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim()).entries()) {
  try { new Function(script); } catch (exception) { throw new Error(`Storefront script ${index + 1} has a syntax error: ${exception.message}`); }
}

assert.match(html, /dashboard\.insertAdjacentHTML\("afterbegin",ownerPosPrimaryActionMarkup\(\)\)/, "Scan & Sell is inserted before the Owner Dashboard content");
assert.match(html, /if\(section==="pos-sell"&&!isOwner\(\)\)/, "staff and customer accounts cannot open the POS route");
assert.match(html, /getUserMedia\(\{video:\{facingMode:\{ideal:"environment"\}/, "camera permission is requested immediately when the owner opens Scan & Sell");
assert.match(html, /Confirm Sale/, "a sale requires an explicit confirmation control");
assert.match(html, /ownerPosSaving\|\|ownerPosSaleConfirmed/, "duplicate confirm clicks are disabled while a save is active and after confirmation");
assert.ok(html.includes("/api/pos/sales"), "the UI records POS sales through the dedicated API route");
assert.match(html, /In-store sales · Scan & Sell/, "analytics and reports distinguish POS sales from online orders");
assert.match(html, /if\(previousPanel==="pos-sell"&&route\.panel!=="pos-sell"\)\{stopOwnerPosScanner\(\)/, "leaving Scan & Sell stops its camera without changing QR Inventory behavior");
assert.match(apiSource, /if \(route\.startsWith\("pos\/"\)\) return handlePos\(request, env, account, route\);/, "POS is routed separately from QR Inventory and online Orders");
assert.match(apiSource, /function requireOwnerRole\(account\)/, "the POS write path requires an authenticated owner account");
assert.match(apiSource, /UPDATE shop_state SET value=\?, updated_at=\? WHERE key=\? AND value=\?/, "stock updates use compare-and-swap against the shared product JSON");
assert.match(apiSource, /INSERT INTO pos_sales[\s\S]*?WHERE changes\(\)=1/, "a POS ledger row is inserted only if the inventory update succeeded");
assert.match(migration, /operation_id TEXT NOT NULL UNIQUE/, "D1 enforces unique sale operation IDs");
assert.match(migration, /CREATE TABLE IF NOT EXISTS pos_sales/, "POS sales use a separate additive D1 table");
assert.doesNotMatch(migration, /DROP TABLE|DELETE FROM|UPDATE orders|ALTER TABLE orders/i, "the migration does not alter orders or existing records");

const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);
const owner = { id: "owner-pos", identifier: "owner@example.test", name: "Store Owner", role: "owner" };
const customer = { id: "customer-pos", identifier: "customer@example.test", name: "Customer", role: "customer" };
const staff = { id: "staff-pos", identifier: "staff@example.test", name: "Staff", role: "staff" };
const qrA = "11111111-1111-4111-8111-111111111111";
const qrB = "22222222-2222-4222-8222-222222222222";
const saleId = number => `aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`;
const tokenHash = async token => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString("base64url");

class PosD1 {
  shop = new Map(); sessions = new Map(); accounts = new Map(); sales = new Map(); orders = new Map();
  lastChanges = 0; queue = Promise.resolve(); failNextInsert = false; broadcasts = 0;
  constructor(products) {
    this.shop.set("shivan_shop_products", JSON.stringify(products));
    for (const account of [owner, customer, staff]) this.accounts.set(account.id, account);
  }
  prepare(sql) {
    const statement = { sql, values: [], bind: (...values) => { statement.values = values; return statement; } };
    statement.first = async () => this.first(statement.sql, statement.values);
    statement.all = async () => this.all(statement.sql, statement.values);
    statement.run = async () => this.run(statement.sql, statement.values);
    return statement;
  }
  async first(sql, values) {
    if (sql.includes("FROM sessions s JOIN accounts a")) {
      const [hash, now] = values; const session = this.sessions.get(hash);
      if (!session || session.expiresAt <= now) return null;
      const account = this.accounts.get(session.accountId);
      return account ? { id: account.id, identifier: account.identifier, name: account.name, role: account.role } : null;
    }
    if (sql.includes("FROM staff_sessions s JOIN staff_accounts a")) return null;
    if (sql.includes("FROM shop_state WHERE key=?")) {
      const value = this.shop.get(values[0]); return value === undefined ? null : { value };
    }
    if (sql.includes("FROM pos_sales WHERE operation_id=?")) {
      const row = [...this.sales.values()].find(item => item.operation_id === values[0]); return row ? { ...row } : null;
    }
    if (sql.includes("COUNT(*) AS sale_count")) {
      const rows = this.inRange(values[0], values[1]);
      return { sale_count: rows.length, units_sold: rows.reduce((sum, row) => sum + row.quantity, 0), revenue_iqd: rows.reduce((sum, row) => sum + row.total_iqd, 0) };
    }
    return null;
  }
  inRange(from, to) { return [...this.sales.values()].filter(row => row.created_at >= from && row.created_at <= to).sort((a, b) => b.created_at.localeCompare(a.created_at)); }
  async all(sql, values) { return { results: sql.includes("FROM pos_sales") ? this.inRange(values[0], values[1]).slice(0, 25).map(row => ({ ...row })) : [] }; }
  changed(count) { this.lastChanges = count; return { success: true, meta: { changes: count } }; }
  async run(sql, values) {
    if (sql.startsWith("UPDATE shop_state SET value=?") && sql.includes("AND value=?")) {
      const [next, , key, previous] = values;
      if (this.shop.get(key) !== previous) return this.changed(0);
      this.shop.set(key, next); return this.changed(1);
    }
    if (sql.startsWith("INSERT INTO pos_sales")) {
      if (this.lastChanges !== 1) return this.changed(0);
      if (this.failNextInsert) { this.failNextInsert = false; throw new Error("SQLITE_CONSTRAINT: simulated sale persistence failure"); }
      const [id, operation_id, owner_id, product_id, product_name, variant_qr_id, image_url, color, size, quantity, unit_price_iqd, original_unit_price_iqd, discount_percent, total_iqd, created_at] = values;
      if ([...this.sales.values()].some(row => row.operation_id === operation_id)) throw new Error("UNIQUE constraint failed: pos_sales.operation_id");
      const row = { id, operation_id, owner_id, product_id, product_name, variant_qr_id, image_url, color, size, quantity, unit_price_iqd, original_unit_price_iqd, discount_percent, total_iqd, created_at };
      this.sales.set(id, row); return this.changed(1);
    }
    return this.changed(0);
  }
  batch(statements) {
    const work = this.queue.then(async () => {
      const shop = new Map(this.shop); const sales = new Map(this.sales); const lastChanges = this.lastChanges;
      try { const results = []; for (const statement of statements) results.push(await statement.run()); return results; }
      catch (exception) { this.shop = shop; this.sales = sales; this.lastChanges = lastChanges; throw exception; }
    });
    this.queue = work.catch(() => {}); return work;
  }
}

const products = [
  { id: "dress-1", name: "Ruby Dress", price: 10000, discount: 25, image: "/api/media/shop/" + "a".repeat(43) + ".jpg", colors: ["#aa0011"], colorNames: ["Ruby"], sizes: ["M"], variants: [{ qrId: qrA, color: "#aa0011", size: "M", stock: 5 }] },
  { id: "top-2", name: "Blue Top", price: 8000, discount: 20, discountTimerEnabled: true, discountEndsAt: "2000-01-01T00:00:00.000Z", colors: ["#0011aa"], colorNames: ["Blue"], sizes: ["S"], variants: [{ qrId: qrB, color: "#0011aa", size: "S", stock: 1 }] },
];
const DB = new PosD1(products);
const tokens = new Map();
for (const [identity, account] of [["pos-owner-token", owner], ["pos-customer-token", customer], ["pos-staff-token", staff]]) {
  const hash = await tokenHash(identity); DB.sessions.set(hash, { accountId: account.id, expiresAt: Math.floor(Date.now() / 1000) + 3600 }); tokens.set(account.id, identity);
}
const env = { DB, SYNC_HUB: { idFromName: () => "shop", get: () => ({ fetch: async () => { DB.broadcasts++; return new Response("ok"); } }) } };
const call = (route, account, { method = "GET", body, query = "" } = {}) => onRequest({ request: new Request(`https://shop.test/api/${route}${query}`, { method, headers: { Cookie: account ? `shivan_session=${tokens.get(account.id)}` : "", ...(body ? { "Content-Type": "application/json", Origin: "https://shop.test" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), env });
const json = async response => ({ status: response.status, body: await response.json() });

let result = await json(await call("pos/variant", null, { query: `?qr=${qrA}` }));
assert.equal(result.status, 401, "customers and guests cannot use the POS variant API");
result = await json(await call("pos/variant", customer, { query: `?qr=${qrA}` }));
assert.equal(result.status, 403, "customer accounts cannot read POS scanner details");
result = await json(await call("pos/variant", owner, { query: `?qr=SHIVAN-VARIANT%3A1%3A${qrA}` }));
assert.equal(result.status, 200);
assert.deepEqual({ productId: result.body.variant.productId, productName: result.body.variant.productName, size: result.body.variant.size, colorName: result.body.variant.colorName, price: result.body.variant.originalPrice, discount: result.body.variant.discountPercent, unit: result.body.variant.unitPrice, stock: result.body.variant.stock }, { productId: "dress-1", productName: "Ruby Dress", size: "M", colorName: "Ruby", price: 10000, discount: 25, unit: 7500, stock: 5 }, "variant lookup returns saved catalog details and current IQD price");
assert.equal(result.body.variant.image, products[0].image, "variant lookup uses its real product image");
result = await json(await call("pos/variant", owner, { query: "?qr=not-a-shivan-code" }));
assert.equal(result.status, 400, "unrecognized QR payloads are rejected");
result = await json(await call("pos/variant", owner, { query: `?qr=${qrB}` }));
assert.equal(result.status, 200);
assert.equal(result.body.variant.discountPercent, 0, "expired timed discounts are not charged at the old offer price");
assert.equal(result.body.variant.unitPrice, 8000);

const op1 = saleId(1);
result = await json(await call("pos/sales", customer, { method: "POST", body: { qrId: qrA, quantity: 2, operationId: op1 } }));
assert.equal(result.status, 403, "customer accounts cannot confirm in-store sales");
assert.equal(DB.sales.size, 0, "an unauthorized write records no sale");
result = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 2, operationId: op1 } }));
assert.equal(result.status, 200);
assert.equal(result.body.confirmed, true);
assert.equal(result.body.sale.quantity, 2);
assert.equal(result.body.sale.unitPrice, 7500);
assert.equal(result.body.sale.total, 15000);
assert.equal(result.body.remainingStock, 3);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock, 3, "confirmed sales deduct the shared variant stock");
assert.equal(DB.orders.size, 0, "POS sales never enter the online Orders collection");
assert.equal(DB.broadcasts, 1, "confirmed stock changes broadcast shared inventory sync");

const repeated = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 2, operationId: op1 } }));
assert.equal(repeated.status, 200);
assert.equal(repeated.body.duplicate, true, "retries return the already confirmed sale");
assert.equal(DB.sales.size, 1, "the same operation is never recorded twice");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock, 3, "a duplicate confirmation does not deduct stock twice");
const alteredReplay = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 1, operationId: op1 } }));
assert.equal(alteredReplay.status, 409, "an idempotency key cannot be replayed with a different quantity");

const overSale = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 4, operationId: saleId(2) } }));
assert.equal(overSale.status, 409, "a sale cannot exceed available stock");
assert.equal(DB.sales.size, 1);
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock, 3);
const invalidSale = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 0, operationId: saleId(3) } }));
assert.equal(invalidSale.status, 400, "zero or fractional quantities are rejected");
const unknownVariant = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: "33333333-3333-4333-8333-333333333333", quantity: 1, operationId: saleId(4) } }));
assert.equal(unknownVariant.status, 404);

const beforeFailure = DB.shop.get("shivan_shop_products");
DB.failNextInsert = true;
const failedConfirm = await json(await call("pos/sales", owner, { method: "POST", body: { qrId: qrA, quantity: 1, operationId: saleId(5) } }));
assert.equal(failedConfirm.status, 503, "an unconfirmed D1 ledger write reports failure");
assert.equal(DB.shop.get("shivan_shop_products"), beforeFailure, "stock rollbacks if D1 cannot write its POS ledger row");
assert.equal(DB.sales.size, 1);

const concurrent = await Promise.all([
  call("pos/sales", owner, { method: "POST", body: { qrId: qrB, quantity: 1, operationId: saleId(6) } }).then(json),
  call("pos/sales", owner, { method: "POST", body: { qrId: qrB, quantity: 1, operationId: saleId(7) } }).then(json),
]);
assert.deepEqual(concurrent.map(item => item.status).sort(), [200, 409], "two simultaneous sales cannot consume the same final unit");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[1].variants[0].stock, 0, "concurrent sales never produce negative stock");
assert.equal(DB.sales.size, 2, "only the successful concurrent confirmation is recorded");

const summary = await json(await call("pos/sales", owner, { query: "?from=2000-01-01T00%3A00%3A00.000Z&to=2099-12-31T23%3A59%3A59.999Z" }));
assert.equal(summary.status, 200);
assert.equal(summary.body.summary.sales, 2);
assert.equal(summary.body.summary.units, 3);
assert.equal(summary.body.summary.revenue, 23000);
assert.equal(summary.body.recent.length, 2);
assert.equal(summary.body.recent[0].productName, "Blue Top");
const hiddenSummary = await json(await call("pos/sales", customer, { query: "?from=2000-01-01&to=2099-12-31" }));
assert.equal(hiddenSummary.status, 403, "customers cannot read owner POS reports");

console.log("Scan & Sell POS regression checks passed.");
