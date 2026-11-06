import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const require = createRequire(import.meta.url);
const qrFactory = require("../vendor/qr/qrcode-generator.js");
const scannerModule = require("../vendor/qr/jsQR.js");
const scanQr = scannerModule.default || scannerModule.jsQR || scannerModule;
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
const apiUrl = `data:text/javascript;base64,${Buffer.from(apiSource).toString("base64")}`;
const { onRequest } = await import(apiUrl);
const sourceFunction = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`function ${escaped}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected UI helper ${name} to exist`);
  return match[0];
};

for (const [index, script] of [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).filter(script => script.trim()).entries()) {
  try { new Function(script); }
  catch (error) { throw new Error(`Storefront script ${index + 1} has a syntax error: ${error.message}`); }
}

assert.match(html, /\["inventory","▦",ownerDashboardText\("QR Code"/, "QR inventory must be reachable from the Owner dashboard menu");
assert.match(html, /\["analytics","◴",ownerDashboardText\("Analytics"/, "Owner analytics must be reachable from the dashboard menu");
assert.match(html, /inventory:\{panel:"inventory",nav:"inventory"\}/, "the Owner dashboard QR menu should map to the existing inventory section");
assert.match(html, /if\(!isOwner\(\)\)return;[\s\S]*?async function renderOwnerInventory/, "client inventory actions should check the Owner session");
assert.match(html, /requireAuthentication\(\{type:"product"/, "product purchase actions should capture a guest's exact variant before showing login");
assert.match(html, /id="profileGuestAccess"[\s\S]*?beginProfileAuthentication\('login'\)[\s\S]*?beginProfileAuthentication\('signup'\)/, "guest Profile navigation should offer Login and Sign Up before opening either form");
assert.match(html, /resumeAuthenticationIntent\(\);/, "successful authentication should resume the stored guest intent");
assert.match(html, /if\(!currentUser&&!cloudAccount\)\{[\s\S]*?Sign in before placing an order/, "placing an order must require authentication");
assert.match(apiSource, /if \(!staffHasPermission\(account, "inventory"\)\) return error\("Inventory permission is required to manage stock\.", 403\);/, "the server must require inventory permission before allowing QR stock access");
assert.match(apiSource, /UPDATE shop_state SET value=\?, updated_at=\? WHERE key=\? AND value=\? AND EXISTS/, "stock adjustments must compare the D1 inventory value before saving");
assert.match(apiSource, /INVENTORY_OPERATION_PREFIX/, "inventory operations must use a shared idempotency record");
assert.doesNotMatch(apiSource, /CREATE TABLE|DROP TABLE|ALTER TABLE/, "QR inventory must use the existing database schema");
for (const marker of ["ownerInventorySearch", "ownerInventoryStockFilter", "selectVisibleOwnerInventoryQrs", "printSelectedVariantQrs", "downloadSelectedVariantQrSheet", "downloadAllVariantQrSheet", "data-qr-stock", "data-qr-search", "Product ID:", "owner-qr-product-image"]) {
  assert.ok(html.includes(marker), `the Owner QR inventory should support ${marker}`);
}
for (const marker of ["ownerInventoryProductGrid", "ownerInventoryDetailView", "Product QR Details", "Variant ID:", "Print all for this product", "Download all for this product", "closeOwnerInventoryProductDetails()", "data-qr-product"]) assert.ok(html.includes(marker), `product-first QR inventory should include ${marker}`);
const inventoryRenderSource = sourceFunction("renderOwnerInventory");
assert.doesNotMatch(inventoryRenderSource, /Start camera scanner|Stop camera|ownerInventoryVideo|ownerInventoryCanvas|ownerInventoryResult|ownerInventoryQuantity|ownerInventorySale|ownerInventoryRestock|ownerInventoryPending|Scan a product variant/, "the QR product list must not render the scanner or stock-action panel");
assert.doesNotMatch(html, /\.owner-inventory-scanner/, "scanner-only layout styles should be removed with the panel");
assert.match(html, /ownerQrSvgById\.set\(item\.id,svg\)/, "download and print controls use the same persistent variant QR ID generated for the shared database record");
const qrView = runInNewContext(`${sourceFunction("inventoryVariantViewForClient")}\n({inventoryVariantViewForClient})`, {
  normalizeHexColor: value => String(value || "").toLowerCase(),
  productPhotos: product => product.images || (product.image ? [{ src: product.image }] : []),
  getProductPricing: product => ({ originalPrice: product.price, finalPrice: product.price * (100 - product.discount) / 100, discountPercent: product.discount }),
  safeImageUrl: value => value,
  getProductName: product => product.name,
});
const variantView = qrView.inventoryVariantViewForClient({ id: 7, name: "Dress", colors: ["#f00"], colorNames: ["Ruby"], images: [{ src: "/dress.webp", color: "#f00" }], price: 10000, discount: 30 }, { qrId: "stable-qr-id", color: "#f00", size: "M", stock: 4 });
assert.deepEqual(JSON.parse(JSON.stringify({ productId: variantView.productId, colorName: variantView.colorName, size: variantView.size, stock: variantView.stock, image: variantView.image, price: variantView.price, finalPrice: variantView.finalPrice, discountPercent: variantView.discountPercent })), { productId: 7, colorName: "Ruby", size: "M", stock: 4, image: "/dress.webp", price: 10000, finalPrice: 7000, discountPercent: 30 }, "QR cards display the linked product image, color-size stock, and actual saved price/discount");
const scanResultElement = { innerHTML: "" };
const scanSaleButton = { disabled: true };
const scanRestockButton = { disabled: true };
const scanRenderer = runInNewContext(`${sourceFunction("inventoryVariantViewForClient")}\n${sourceFunction("renderOwnerInventoryScanResult")}\n({renderOwnerInventoryScanResult})`, {
  ownerInventoryScannedVariant: { qrId: "stable-qr-id", productId: 7, productName: "Dress", colorName: "Ruby", size: "M", stock: 4 },
  products: [{ id: 7, name: "Dress", colors: ["#f00"], colorNames: ["Ruby"], images: [{ src: "/dress.webp", color: "#f00" }], price: 10000, discount: 30 }],
  normalizeHexColor: value => String(value || "").toLowerCase(),
  productPhotos: product => product.images || [],
  getProductPricing: product => ({ originalPrice: product.price, finalPrice: product.price * (100 - product.discount) / 100, discountPercent: product.discount }),
  safeImageUrl: value => value,
  getProductName: product => product.name,
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  formatPrice: value => `IQD ${value}`,
  document: { getElementById: id => ({ ownerInventoryResult: scanResultElement, ownerInventorySale: scanSaleButton, ownerInventoryRestock: scanRestockButton })[id] || null },
});
scanRenderer.renderOwnerInventoryScanResult();
assert.match(scanResultElement.innerHTML, /Product ID: 7/);
assert.match(scanResultElement.innerHTML, /Variant ID: stable-qr-id/);
assert.match(scanResultElement.innerHTML, /Ruby · M/);
assert.match(scanResultElement.innerHTML, /IQD 7000/);
assert.match(scanResultElement.innerHTML, /-30%/);
assert.match(scanResultElement.innerHTML, /src="\/dress.webp"/);
assert.equal(scanSaleButton.disabled, false);
const productRecords = [{ id: 7, name: "Dress" }, { id: 8, name: "Jacket" }, { id: 9, name: "No variants" }];
const inventoryRecords = [
  { qrId: "dress-ruby-s", productId: 7, productName: "Dress", color: "#a00", colorName: "Ruby", size: "S", stock: 0 },
  { qrId: "dress-ruby-m", productId: 7, productName: "Dress", color: "#a00", colorName: "Ruby", size: "M", stock: 4 },
  { qrId: "dress-blue-s", productId: 7, productName: "Dress", color: "#00a", colorName: "Blue", size: "S", stock: 2 },
  { qrId: "jacket-black-l", productId: 8, productName: "Jacket", color: "#000", colorName: "Black", size: "L", stock: 0 },
];
const productFirstUi = runInNewContext(`${sourceFunction("ownerInventoryVariantsForProduct")}\n${sourceFunction("ownerInventoryProductSummaries")}\n${sourceFunction("ownerInventoryColorGroups")}\n({ownerInventoryVariantsForProduct,ownerInventoryProductSummaries,ownerInventoryColorGroups})`, {
  products: productRecords, ownerInventoryVariants: inventoryRecords, getProductName: product => product.name,
});
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryVariantsForProduct(7).map(item => item.qrId))), ["dress-ruby-s", "dress-ruby-m", "dress-blue-s"], "details include only variants linked to the selected product ID");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryProductSummaries().map(item => [item.product.id, item.variantCount]))), [[7, 3], [8, 1], [9, 0]], "product cards show real variant counts without dropping unconfigured products");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryProductSummaries("blue").map(item => item.product.id))), [7], "search matches a product's saved color names");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryProductSummaries("m").map(item => item.product.id))), [7], "search matches a product's saved sizes");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryProductSummaries("", "in-stock").map(item => item.product.id))), [7], "in-stock filter includes products with any stocked variant");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryProductSummaries("", "out-of-stock").map(item => item.product.id))), [8], "out-of-stock filter includes only products whose variants are all out of stock");
assert.deepEqual(JSON.parse(JSON.stringify(productFirstUi.ownerInventoryColorGroups(productFirstUi.ownerInventoryVariantsForProduct(7)).map(group => [group.colorName, group.variants.map(item => item.size)]))), [["Ruby", ["S", "M"]], ["Blue", ["S"]]], "product details group every size under its exact color");

const qrCards = ["dress-ruby-s", "dress-ruby-m", "dress-blue-s"].map(qrCard => ({ dataset: { qrCard }, hidden: false }));
const qrCheckboxes = qrCards.map(card => ({ value: card.dataset.qrCard, checked: false }));
const qrUiElements = { ownerInventorySelectionStatus: { textContent: "" }, ownerInventoryPrintSelected: { disabled: true }, ownerInventoryDownloadSelected: { disabled: true } };
const qrUiDocument = { getElementById: id => qrUiElements[id] || null, querySelectorAll: selector => selector.includes(":not([hidden])") ? qrCards.flatMap((card, index) => card.hidden ? [] : [qrCheckboxes[index]]) : selector.includes(":checked") ? qrCheckboxes.filter(input => input.checked) : qrCards };
const inventoryUi = runInNewContext(`${sourceFunction("ownerInventorySelectedIds")}\n${sourceFunction("ownerInventorySavedSelection")}\n${sourceFunction("updateOwnerInventorySelection")}\n${sourceFunction("selectVisibleOwnerInventoryQrs")}\n({ownerInventorySelectedIds,ownerInventorySavedSelection,updateOwnerInventorySelection,selectVisibleOwnerInventoryQrs})`, { isOwner: () => true, ownerInventorySelectedProductId: 7, ownerInventorySelectedQrIdsByProduct: new Map(), document: qrUiDocument });
inventoryUi.selectVisibleOwnerInventoryQrs(true);
assert.deepEqual(JSON.parse(JSON.stringify(inventoryUi.ownerInventorySelectedIds())), ["dress-ruby-s", "dress-ruby-m", "dress-blue-s"], "select-all operates on the product's exact displayed variant QR IDs");
assert.equal(qrUiElements.ownerInventoryPrintSelected.disabled, false);
assert.deepEqual(JSON.parse(JSON.stringify([...inventoryUi.ownerInventorySavedSelection(7)])), ["dress-ruby-s", "dress-ruby-m", "dress-blue-s"], "variant selection is saved by product so it survives Back and reopening details");
inventoryUi.selectVisibleOwnerInventoryQrs(false);
assert.equal(inventoryUi.ownerInventorySelectedIds().length, 0, "clearing selection does not affect saved inventory");
assert.equal(inventoryUi.ownerInventorySavedSelection(7).size, 0, "clearing a product selection is retained when returning to details");

const detailList = { hidden: false };
const detailView = { hidden: true };
const ownerView = { scrollTop: 41, classList: { contains: () => true } };
const searchInput = { value: "dress" };
const stockFilter = { value: "out-of-stock" };
const rootStyle = { scrollBehavior: "smooth" };
const pendingFrames = [];
const scrollCalls = [];
let renderedProductId = null;
const detailNavigation = runInNewContext(`${sourceFunction("readShopViewPosition")}\n${sourceFunction("restoreOwnerScrollPosition")}\n${sourceFunction("openOwnerInventoryProduct")}\n${sourceFunction("closeOwnerInventoryProductDetails")}\n({openOwnerInventoryProduct,closeOwnerInventoryProductDetails})`, {
  isOwner: () => true, ownerPanel: "inventory", ownerInventorySelectedProductId: null, ownerInventoryListPosition: { windowY: 0, viewTop: 0, authTop: 0 }, products: productRecords,
  renderOwnerInventoryProductQrDetails: id => { renderedProductId = id; },
  document: { getElementById: id => ({ ownerView, ownerInventoryListView: detailList, ownerInventoryDetailView: detailView, ownerInventorySearch: searchInput, ownerInventoryStockFilter: stockFilter })[id] || null, documentElement: { scrollTop: 0, style: rootStyle }, body: { scrollTop: 0 } },
  window: { scrollY: 684, scrollTo: (...args) => scrollCalls.push(args) }, requestAnimationFrame: callback => pendingFrames.push(callback),
});
detailNavigation.openOwnerInventoryProduct("7");
assert.equal(renderedProductId, 7);
assert.equal(detailList.hidden, true);
assert.equal(detailView.hidden, false);
assert.equal(ownerView.scrollTop, 0, "details open at the top in the Owner view scroll container");
detailNavigation.closeOwnerInventoryProductDetails();
assert.equal(detailList.hidden, false, "Back reveals the existing list DOM, retaining search and filters");
assert.equal(detailView.hidden, true);
assert.equal(searchInput.value, "dress", "Back preserves the list search query");
assert.equal(stockFilter.value, "out-of-stock", "Back preserves the selected stock filter");
pendingFrames.pop()();
assert.deepEqual(scrollCalls[0], [0, 0], "a dedicated detail page opens at the top");
assert.equal(ownerView.scrollTop, 41, "Back restores the exact nested Owner view scroll position");
assert.deepEqual(scrollCalls.at(-1), [0, 684], "Back restores the exact window scroll position");

const variantMarkup = runInNewContext(`${sourceFunction("ownerInventoryVariantCardMarkup")}\n({ownerInventoryVariantCardMarkup})`, {
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  formatPrice: value => `IQD ${value}`,
});
const exactVariantMarkup = variantMarkup.ownerInventoryVariantCardMarkup({ ...inventoryRecords[1], image: "/dress-ruby.webp", price: 10000, finalPrice: 9000, discountPercent: 10 }, "/dress.webp", true);
for (const marker of ['data-qr-card="dress-ruby-m"', 'data-qr-image="dress-ruby-m"', "Variant ID: dress-ruby-m", "Color: Ruby", "Size: M", "4 in stock", "Download QR", "Print QR", 'src="/dress-ruby.webp"']) assert.ok(exactVariantMarkup.includes(marker), `variant card should include ${marker}`);
assert.match(exactVariantMarkup, /<input type="checkbox" value="dress-ruby-m" checked/);
assert.ok(!exactVariantMarkup.includes("dress-blue-s"), "a variant QR card must not contain another color or size identity");
const inspectVariant = runInNewContext(`${sourceFunction("inspectOwnerInventoryVariant")}\n({inspectOwnerInventoryVariant})`, { isOwner: () => true, ownerInventoryVariants: inventoryRecords, showToast: () => {} });
assert.equal(inspectVariant.inspectOwnerInventoryVariant("dress-ruby-m").size, "M", "clicking a QR resolves its exact stable variant ID");
assert.equal(inspectVariant.inspectOwnerInventoryVariant("unknown-qr"), null, "an unknown QR never falls back to another variant");

const makeQr = payload => {
  const qr = qrFactory(0, "M");
  qr.addData(payload);
  qr.make();
  const modules = qr.getModuleCount();
  const margin = 4;
  const scale = 6;
  const side = (modules + margin * 2) * scale;
  const rgba = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const row = Math.floor(y / scale) - margin;
    const column = Math.floor(x / scale) - margin;
    const dark = row >= 0 && column >= 0 && row < modules && column < modules && qr.isDark(row, column);
    const offset = (y * side + x) * 4;
    rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = dark ? 0 : 255;
    rgba[offset + 3] = 255;
  }
  return scanQr(rgba, side, side, { inversionAttempts: "dontInvert" });
};

class InventoryD1 {
  shop = new Map();
  userState = new Map();
  orders = new Map();
  accounts = new Map();
  sessions = new Map();
  batchQueue = Promise.resolve();

  prepare(sql) {
    const statement = { sql, values: [], bind: (...values) => { statement.values = values; return statement; } };
    statement.first = async () => this.first(statement.sql, statement.values);
    statement.all = async () => this.all(statement.sql, statement.values);
    statement.run = async () => this.run(statement.sql, statement.values);
    return statement;
  }

  async first(sql, values) {
    if (sql.includes("FROM sessions s JOIN accounts a")) {
      const [token, timestamp] = values;
      const session = this.sessions.get(token);
      if (!session || session.expiresAt <= timestamp) return null;
      const account = this.accounts.get(session.accountId);
      return account ? { id: account.id, identifier: account.identifier, name: account.name, role: account.role } : null;
    }
    if (sql.includes("FROM shop_state WHERE key=?") || sql.includes("FROM shop_state WHERE key='shivan_shop_products'")) {
      const value = this.shop.get(sql.includes("key='shivan_shop_products'") ? "shivan_shop_products" : values[0]);
      return value === undefined ? null : { value };
    }
    if (sql.includes("FROM user_state WHERE account_id=? AND key=?")) {
      const value = this.userState.get(`${values[0]}\n${values[1]}`);
      return value === undefined ? null : { value };
    }
    if (sql.includes("FROM orders WHERE id=?")) {
      const row = this.orders.get(values[0]);
      return row ? { account_id: row.account_id } : null;
    }
    return null;
  }

  async all() { return { results: [] }; }

  async run(sql, values) {
    const changed = n => { this.lastChanges = n; return { success: true, meta: { changes: n } }; };
    if (sql.includes("INSERT INTO user_state") && sql.includes("SELECT") && sql.includes("WHERE changes()=1")) {
      if (this.lastChanges !== 1) return changed(0);
      const [accountId, key, value] = values;
      const dbKey = `${accountId}\n${key}`;
      if (this.userState.has(dbKey)) return changed(0);
      this.userState.set(dbKey, value);
      return changed(1);
    }
    if (sql.includes("INSERT INTO user_state") && sql.includes("VALUES")) {
      const [accountId, key, value] = values;
      const dbKey = `${accountId}\n${key}`;
      if (this.userState.has(dbKey)) return changed(0);
      this.userState.set(dbKey, value);
      return changed(1);
    }
    if (sql.includes("INSERT INTO orders") && sql.includes("SELECT") && sql.includes("WHERE EXISTS")) {
      const [id, accountId, payload, createdAt, updatedAt, markerAccount, markerKey, markerValue] = values;
      if (this.userState.get(`${markerAccount}\n${markerKey}`) !== markerValue || this.orders.has(id)) return changed(0);
      this.orders.set(id, { id, account_id: accountId, payload, created_at: createdAt, updated_at: updatedAt });
      return changed(1);
    }
    if (sql.includes("UPDATE shop_state SET value=?") && sql.includes("EXISTS (SELECT 1 FROM user_state")) {
      const [nextValue, , key, previousValue, accountId, operationKey, pendingToken] = values;
      const marker = this.userState.get(`${accountId}\n${operationKey}`);
      if (this.shop.get(key) !== previousValue || marker !== pendingToken) return changed(0);
      this.shop.set(key, nextValue);
      return changed(1);
    }
    if (sql.includes("UPDATE shop_state SET value=?") && sql.includes("AND value=?")) {
      const [nextValue, , key, previousValue] = sql.includes("key='shivan_shop_products'")
        ? [values[0], values[1], "shivan_shop_products", values[2]]
        : values;
      if (this.shop.get(key) !== previousValue) return changed(0);
      this.shop.set(key, nextValue);
      return changed(1);
    }
    if (sql.includes("UPDATE user_state SET value=?")) {
      const [nextValue, , accountId, key, pendingToken, productsKey, expectedProducts] = values;
      const dbKey = `${accountId}\n${key}`;
      if (this.userState.get(dbKey) !== pendingToken || this.shop.get(productsKey) !== expectedProducts) return changed(0);
      this.userState.set(dbKey, nextValue);
      return changed(1);
    }
    if (sql.includes("DELETE FROM user_state")) {
      const [accountId, key, expected] = values;
      const dbKey = `${accountId}\n${key}`;
      if (this.userState.get(dbKey) !== expected) return changed(0);
      this.userState.delete(dbKey);
      return changed(1);
    }
    return changed(0);
  }

  batch(statements) {
    const run = this.batchQueue.then(async () => {
      const previousShop = new Map(this.shop);
      const previousUserState = new Map(this.userState);
      const previousOrders = new Map(this.orders);
      const previousChanges = this.lastChanges;
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        return results;
      } catch (error) {
        this.shop = previousShop;
        this.userState = previousUserState;
        this.orders = previousOrders;
        this.lastChanges = previousChanges;
        throw error;
      }
    });
    this.batchQueue = run.catch(() => {});
    return run;
  }
}

const DB = new InventoryD1();
const env = { DB };
const accountId = "owner-test-account";
const customerId = "customer-test-account";
const ownerToken = "offline-owner-session";
const customerToken = "offline-customer-session";
const toBase64Url = bytes => Buffer.from(bytes).toString("base64url");
const tokenHash = async value => toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
DB.accounts.set(accountId, { id: accountId, identifier: "07502342153", name: "Test owner", role: "owner" });
DB.accounts.set(customerId, { id: customerId, identifier: "customer@example.test", name: "Test customer", role: "customer" });
DB.sessions.set(await tokenHash(ownerToken), { accountId, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
DB.sessions.set(await tokenHash(customerToken), { accountId: customerId, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
const ownerCookie = `shivan_session=${ownerToken}`;
const customerCookie = `shivan_session=${customerToken}`;
const context = request => onRequest({ request, env });
const post = (route, cookie, body) => context(new Request(`https://shop.test/api/${route}`, {
  method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie, Origin: "https://shop.test" }, body: JSON.stringify(body),
}));
const id = suffix => `aaaaaaaa-aaaa-4aaa-8aaa-${String(suffix).padStart(12, "0")}`;

const originalProducts = [
  { id: 21, name: "Jacket", names: { en: "Jacket" }, price: 12000, colors: ["#f00", "#00f"], colorNames: ["Red", "Blue"], sizes: ["S", "M"], variants: [
    { color: "#f00", size: "S", stock: 2 }, { color: "#f00", size: "M", stock: 0 },
    { color: "#00f", size: "S", stock: 4 }, { color: "#00f", size: "M", stock: 1 },
  ] },
  { id: 22, name: "Dress", price: 18000, colors: ["#f00"], sizes: ["S"], variants: [{ color: "#f00", size: "S", stock: 1 }] },
  { id: 23, name: "Legacy top", price: 9000, colors: ["#0f0", "#00f"], sizes: ["S", "M"], stock: 5 },
];
const originalRaw = JSON.stringify(originalProducts);
DB.shop.set("shivan_shop_products", originalRaw);

const unauthorizedEnsure = await post("inventory/qr/ensure", customerCookie, {});
assert.equal(unauthorizedEnsure.status, 403, "the API must prevent customer accounts from creating or managing QR inventory");
const unauthenticatedVariant = await context(new Request("https://shop.test/api/inventory/variant?qr=x"));
assert.equal(unauthenticatedVariant.status, 401, "inventory details must require owner authentication");

const ensuredResponse = await post("inventory/qr/ensure", ownerCookie, {});
assert.equal(ensuredResponse.status, 200, "the owner should be able to backfill QR IDs without a migration");
const ensured = await ensuredResponse.json();
assert.equal(ensured.variantCount, 9, "every existing color-size variant receives an identifier, including a legacy product without variant rows");
assert.equal(ensured.changed, true);
const allVariants = ensured.products.flatMap(product => product.variants.map(variant => ({ product, variant })));
const qrIds = allVariants.map(item => item.variant.qrId);
assert.equal(new Set(qrIds).size, qrIds.length, "QR identifiers must be unique across products and variants");
assert.match(qrIds[0], /^[0-9a-f-]{36}$/i);
assert.deepEqual(ensured.products[0].variants.map(variant => variant.stock), [2, 0, 4, 1], "QR preparation must preserve current stock values");
assert.equal(ensured.products[2].variants.reduce((sum, variant) => sum + variant.stock, 0), 5, "backfilling a legacy product must preserve its total stock");
assert.equal(ensured.products[2].variants.length, 4, "legacy products receive one variant for every color and size pair");
assert.deepEqual([...DB.shop.keys()], ["shivan_shop_products"], "no duplicate database or extra table is used");
const stableEnsure = await (await post("inventory/qr/ensure", ownerCookie, {})).json();
assert.equal(stableEnsure.changed, false, "existing QR identifiers remain stable on later visits");
assert.deepEqual(stableEnsure.products.map(product => product.variants.map(variant => variant.qrId)), ensured.products.map(product => product.variants.map(variant => variant.qrId)));

const target = allVariants.find(item => item.product.id === 21 && item.variant.color === "#ff0000" && item.variant.size === "S");
const qrRoute = await context(new Request(`https://shop.test/api/inventory/variant?qr=${encodeURIComponent(`SHIVAN-VARIANT:1:${target.variant.qrId}`)}`, { headers: { Cookie: ownerCookie } }));
assert.equal(qrRoute.status, 200, "the scanner endpoint should resolve a variant QR payload");
const exact = (await qrRoute.json()).variant;
assert.equal(exact.productId, 21);
assert.equal(exact.color, "#ff0000");
assert.equal(exact.size, "S");
assert.equal(exact.stock, 2);
const decodedQr = makeQr(exact.qr);
assert.equal(decodedQr?.data, exact.qr, "the local QR image encodes the exact variant payload and can be decoded offline");

const stockBeforeSale = JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock;
const operationId = id(1);
const saleResponse = await post("inventory/adjust", ownerCookie, { qrId: target.variant.qrId, action: "sale", quantity: 1, operationId });
assert.equal(saleResponse.status, 200, "the owner can record a sale against one exact variant");
const saleData = await saleResponse.json();
assert.equal(saleData.variant.stock, stockBeforeSale - 1);
assert.equal(saleData.variant.productId, 21);
const duplicateSale = await post("inventory/adjust", ownerCookie, { qrId: target.variant.qrId, action: "sale", quantity: 1, operationId });
assert.equal(duplicateSale.status, 200);
assert.equal((await duplicateSale.json()).duplicate, true, "replaying one scan request ID must not subtract stock twice");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants[0].stock, stockBeforeSale - 1);

const restock = await post("inventory/adjust", ownerCookie, { qrId: target.variant.qrId, action: "restock", quantity: 3, operationId: id(2) });
assert.equal(restock.status, 200, "the owner can add received quantity to the exact variant");
assert.equal((await restock.json()).variant.stock, stockBeforeSale + 2);
const zeroVariant = ensured.products[0].variants.find(variant => variant.stock === 0);
const outOfStock = await post("inventory/adjust", ownerCookie, { qrId: zeroVariant.qrId, action: "sale", quantity: 1, operationId: id(3) });
assert.equal(outOfStock.status, 409, "a sale must be rejected when that exact variant has no stock");
assert.match((await outOfStock.json()).error, /out of stock/i);
const negativeStock = await post("inventory/adjust", ownerCookie, { qrId: target.variant.qrId, action: "sale", quantity: 999, operationId: id(4) });
assert.equal(negativeStock.status, 409, "stock must never become negative");
const invalidQuantity = await post("inventory/adjust", ownerCookie, { qrId: target.variant.qrId, action: "restock", quantity: 0, operationId: id(5) });
assert.equal(invalidQuantity.status, 400, "zero or non-whole stock quantities must be rejected");
const forbiddenAdjustment = await post("inventory/adjust", customerCookie, { qrId: target.variant.qrId, action: "sale", quantity: 1, operationId: id(6) });
assert.equal(forbiddenAdjustment.status, 403, "customer accounts must not change stock through a forged API request");

const concurrencyProduct = JSON.parse(DB.shop.get("shivan_shop_products"));
const concurrencyVariant = concurrencyProduct[1].variants[0];
const simultaneous = await Promise.all(Array.from({ length: 6 }, (_, index) => post("inventory/adjust", ownerCookie, {
  qrId: concurrencyVariant.qrId, action: "sale", quantity: 1, operationId: id(100 + index),
})));
const simultaneousData = await Promise.all(simultaneous.map(async response => ({ status: response.status, body: await response.json() })));
assert.equal(simultaneousData.filter(item => item.status === 200).length, 1, "simultaneous scans against one remaining item must permit only one sale");
assert.equal(simultaneousData.filter(item => item.status === 409).length, 5, "all competing scans must receive a clear conflict response");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[1].variants[0].stock, 0, "concurrent adjustments must not oversell the shared D1 stock");

const orderVariant = JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants.find(variant => variant.color === "#0000ff" && variant.size === "M");
const orderProductId = JSON.parse(DB.shop.get("shivan_shop_products"))[0].id;
const initialOrderStock = orderVariant.stock;
const submitOrder = (orderId, cookie=customerCookie) => context(new Request("https://shop.test/api/sync", {
  method: "PUT", headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ key: "shivan_shop_orders", value: JSON.stringify([{
    id: orderId, userId: customerId, name: "Offline customer", phone: "0000000000", city: "Test city", area: "Test area",
    paymentMethod: "cash", date: new Date().toISOString(), items: [{ productId: orderProductId, size: orderVariant.size, color: orderVariant.color, qty: 1 }],
  }]) }),
}));
const concurrentOrders = await Promise.all([submitOrder("offline-order-1"), submitOrder("offline-order-2")]);
const concurrentOrderData = await Promise.all(concurrentOrders.map(async response => ({ status: response.status, body: await response.json() })));
assert.equal(concurrentOrderData.filter(item => item.status === 200).length, 1, "simultaneous checkouts against the same inventory version must persist only one sale");
assert.equal(concurrentOrderData.filter(item => item.status === 409).length, 1, "the losing checkout must get a refresh-and-retry response");
assert.equal(DB.orders.size, 1, "a rejected inventory race must not leave an order without deducted stock");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants.find(variant => variant.qrId === orderVariant.qrId).stock, initialOrderStock - 1);
const repeatedOrderId = [...DB.orders.keys()][0];
const repeatedOrder = await submitOrder(repeatedOrderId);
assert.equal(repeatedOrder.status, 200, "retrying an already saved order remains idempotent");
assert.equal(JSON.parse(DB.shop.get("shivan_shop_products"))[0].variants.find(variant => variant.qrId === orderVariant.qrId).stock, initialOrderStock - 1, "a saved order retry must not deduct stock twice");

const guestCheckoutSource = html.match(/function openCheckout\(\)\{[\s\S]*?\n\}/)?.[0] || "";
const guestPurchaseSource = html.match(/function addDetailToCart\(\)\{[\s\S]*?\n\}/)?.[0] || "";
assert.match(guestCheckoutSource, /requireAuthentication\(\{type:"checkout",cart:guestCart\}\)/, "guest checkout must require login and keep its cart intent");
assert.match(guestPurchaseSource, /requireAuthentication\(\{type:"product",productId:currentProduct\.id,size:selectedSize,color:selectedColor,quantity:currentQty\}\)/, "a guest product buy action must retain its selected variant");
assert.match(html, /getUserMedia\(\{video:\{facingMode:\{ideal:"environment"\}/, "Owner QR scanning should request the device rear camera only after the owner starts it");
assert.match(html, /setTimeout\(scanOwnerInventoryFrame,250\)/, "camera QR decoding should be throttled on mobile instead of blocking every animation frame");
assert.match(html, /Print all for this product/);
assert.match(html, /downloadVariantQr\('/);

const guestFlowNames = ["requireAuthentication", "resumeAuthenticationIntent"];
const extractFunction = name => {
  const source = html.match(new RegExp(`function ${name}\\([^\\n]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(source, `website should define ${name}`);
  return source;
};
const guestElements = new Map([["mainApp", { style: { display: "block" } }], ["authPage", { style: { display: "none" }, classList: { toggle() {}, contains() { return false; } } }], ["loginMsg", { textContent: "" }]]);
let shownAuth = "";
let hiddenOnboarding = false;
let guestModalOpened = false;
const guestAuthContext = {
  currentUser: null, cloudAccount: null, pendingAuthenticationIntent: null,
  hideShopOnboarding() { hiddenOnboarding = true; },
  document: { querySelector: () => ({ classList: { add() {} } }), getElementById: id => guestElements.get(id) },
  showAuth(type) { shownAuth = type; },
  openGuestAuthenticationModal(intent) { guestModalOpened = true; shownAuth = "login"; guestAuthContext.pendingAuthenticationIntent = { ...intent }; return true; },
};
const guestAuth = runInNewContext(`${extractFunction(guestFlowNames[0])}\n({requireAuthentication,pending:()=>pendingAuthenticationIntent})`, guestAuthContext);
const pendingProductIntent = { type: "product", productId: 21, size: "S", color: "#f00", quantity: 1 };
assert.equal(guestAuth.requireAuthentication(pendingProductIntent), true, "a guest purchase attempt should open the existing auth modal");
assert.equal(shownAuth, "login");
assert.equal(guestModalOpened, true);
assert.equal(hiddenOnboarding, false, "the guest purchase modal does not replace the product/shop page");
assert.equal(guestElements.get("mainApp").style.display, "block", "guest purchase authentication keeps the shop visible");
assert.equal(guestElements.get("authPage").style.display, "none", "guest purchase authentication does not show the full-page auth route");
assert.deepEqual(JSON.parse(JSON.stringify(guestAuth.pending())), pendingProductIntent, "the exact product, size, color, and quantity must be retained until authentication succeeds");

let resumedProduct = null;
let addedVariant = null;
let resumedView = "";
let resumeState = { index: 0 };
const resumeSource = extractFunction("resumeAuthenticationIntent");
const resumedState = runInNewContext(`${resumeSource}\nresumeAuthenticationIntent();({selectedSize,selectedColor,currentQty,pending:pendingAuthenticationIntent})`, {
  pendingAuthenticationIntent: pendingProductIntent,
  products: [{ id: 21, variants: [{ color: "#f00", size: "S", stock: 2 }] }],
  openView(view) { resumedView = view; },
  openProduct(productId) { resumedProduct = productId; },
  get currentUser() { return { id: "signed-in" }; },
  currentProduct: null, selectedSize: "", selectedColor: "", currentQty: 1,
  getActiveShopView: () => "home",
  normalizeHexColor: value => String(value).toLowerCase(), renderSizeOptions() {}, renderColorOptions() {}, updateDetailAvailability() {},
  variantStock: (_product, color, size) => color === "#f00" && size === "S" ? 2 : 0,
  cartVariantCount: () => 0,
  addDetailToCart() { addedVariant = true; },
  showToast() {},
});
assert.equal(resumedView, "home", "authentication resumes navigation through the shop");
assert.equal(resumedProduct, 21, "authentication returns to the exact selected product");
assert.deepEqual([resumedState.selectedSize,resumedState.selectedColor,resumedState.currentQty], ["S","#f00",1], "authentication restores the exact selected variant and quantity");
assert.equal(addedVariant, true, "authentication resumes the selected variant's add-to-cart action");
assert.equal(resumedState.pending, null, "the pending intent is consumed once after authentication");

console.log("QR inventory offline tests passed: product-first navigation, scanner-panel removal, retained search/filter/selection, exact scroll restoration, unique variant codes, QR decode, owner permissions, shared stock, duplicate protection, concurrency, and guest authentication return flow.");
