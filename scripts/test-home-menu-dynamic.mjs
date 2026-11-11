import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
function block(source, name) {
  const match = source.match(new RegExp("(?:async\\s+)?function " + name + "\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}", "m"));
  assert.ok(match, "expected " + name + " implementation");
  return match[0];
}
function line(source, name) {
  const found = source.split(/\r?\n/).find(value => value.startsWith("function " + name + "("));
  assert.ok(found, "expected " + name + " implementation");
  return found;
}
const saveOwnerProduct = block(html, "saveOwnerProduct");
assert.match(saveOwnerProduct, /if\(index<0&&isOwner\(\)\)record\.isNewModel=true;/, "a new published product saved by the Owner joins New model");
assert.match(saveOwnerProduct, /else if\(isOwner\(\)\)record\.isNewModel=document\.getElementById\("ownerProductNewModel"\)\?\.checked===true;/, "the Main Owner can remove or restore a saved product");
assert.match(saveOwnerProduct, /else if\(Object\.hasOwn\(previous\|\|\{\},"isNewModel"\)\)record\.isNewModel=previous\.isNewModel;/, "staff product edits preserve the existing membership value");
const ownerProductRenderer = block(html, "renderOwnerProducts");
assert.match(ownerProductRenderer, /ownerProductNewModel/, "the product editor exposes New model control");
assert.match(ownerProductRenderer, /isOwner\(\)\?\(product\?/, "New model controls are Owner-only");
assert.match(html, /\.home-menu-panel\{[^\n]*width:min\(80vw,320px\)/, "the drawer stays within the requested mobile width");
assert.match(html, /homeMenuCollection1Label[\s\S]*homeMenuCollection2Label[\s\S]*homeMenuDiscountLabel[\s\S]*homeMenuNewModelLabel[\s\S]*homeMenuShopLabel[\s\S]*homeMenuSearchLabel[\s\S]*homeMenuCartLabel[\s\S]*homeMenuOrdersLabel[\s\S]*homeMenuProfileLabel/, "the drawer keeps the approved menu ordering");

assert.ok(html.includes('id="newModelView" class="view page shop-menu-collection-view"'), "New model is a dedicated view");
assert.ok(html.includes('id="newModelProductsGrid" class="products shop-collection-products"'), "New model reuses the Shop product-card grid");
assert.ok(html.includes('id="discountView" class="view page shop-menu-collection-view"'), "Discount is a separate dedicated view");
assert.ok(html.includes('id="discountProductsGrid" class="products shop-collection-products"'), "Discount reuses the Shop product-card grid");
assert.ok(html.includes('grid-template-columns:repeat(3,minmax(0,1fr))'), "the shared mobile Shop grid uses three columns");
assert.ok(html.includes('id="newModelView"') && html.includes('class="shop-collection-brand"') && html.includes('id="newModelHeroBadge"') && html.includes('id="newModelHeroSubtitle"'), "New model has its own branded header, NEW hero, and subtitle");
assert.ok(html.includes('id="discountView"') && html.includes('id="discountPageHeading"') && html.includes('discount-hero-icon') && html.includes('id="discountHeroSubtitle"'), "Discount has its own branded hero, icon, and subtitle");
assert.ok(html.includes("setHomeMenuSort('newModel',this.value)") && html.includes("setHomeMenuSort('discount',this.value)"), "each page has a functional sort control");
assert.ok(html.includes('.products.shop-collection-products{grid-template-columns:repeat(3,minmax(0,1fr))'), "both dedicated pages keep three columns in the shared product grid");
assert.ok(html.includes('class="product-new-badge"') && html.includes('target==="newModelProductsGrid"&&p.isNewModel===true'), "only New model cards receive the purple New badge");
assert.ok(block(html, "renderVisibleProductGrid").includes('browseView==="newModel"||browseView==="discount"'), "product synchronization refreshes an active dedicated collection");

const openedMenuViews = [];
const renderedMenuCollections = [];
const menuContext = vm.createContext({
  closeHomeMenu() {},
  openView(view) { openedMenuViews.push(view); },
  renderHomeMenuProductCollection(mode) { renderedMenuCollections.push(mode); },
  homeFavoritesOnly: false,
  homeMenuFilterMode: "all",
  currentCategory: "all",
});
vm.runInContext(block(html, "openHomeMenuCollection"), menuContext);
assert.equal(menuContext.openHomeMenuCollection("newModel"), true);
assert.equal(menuContext.openHomeMenuCollection("discount"), true);
assert.deepEqual(openedMenuViews, ["newModel", "discount"], "menu actions open separate pages instead of filtering Home");
assert.deepEqual(renderedMenuCollections, ["newModel", "discount"], "each menu route renders its matching collection");

let historyBackCalls = 0;
const collectionBackContext = vm.createContext({
  getActiveShopView: () => "newModel",
  window: { history: { state: { __shivanShopView: "newModel" }, length: 2, back() { historyBackCalls++; } } },
  shopViewScrollPositions: new Map(),
  writeShopViewHistory() {},
  openView() {},
});
vm.runInContext(block(html, "goBackFromShopCollection"), collectionBackContext);
assert.equal(collectionBackContext.goBackFromShopCollection(), true);
assert.equal(historyBackCalls, 1, "the page Back button uses the originating Shop history entry");

const fallbackPosition = { windowY: 320, viewTop: 0, authTop: 0 };
let fallbackRoute = "";
const fallbackBackContext = vm.createContext({
  getActiveShopView: () => "discount",
  window: { history: { state: null, length: 1, back() { throw new Error("history fallback should not call back"); } } },
  shopViewScrollPositions: new Map([["home", fallbackPosition]]),
  writeShopViewHistory(view, options) { fallbackRoute = "history:" + view + ":" + String(options.replace); },
  openView(view, options) { fallbackRoute += "|open:" + view + ":" + String(options.historyRestore) + ":" + String(options.restorePosition.windowY); },
});
vm.runInContext(block(html, "goBackFromShopCollection"), fallbackBackContext);
assert.equal(fallbackBackContext.goBackFromShopCollection(), true);
assert.equal(fallbackRoute, "history:home:true|open:home:true:320", "the no-history Back fallback restores Home scroll");

let clockNow = Date.now();
class TestDate extends Date { static now() { return clockNow; } }
const timers = [];
const refreshedIds = [];
const appContext = vm.createContext({
  Date: TestDate,
  homeMenuFilterMode: "all",
  homeMenuDiscountExpiryTimer: 0,
  products: [],
  customerUiText: english => english,
  productDiscountPercent: product => appContext.getProductPricing(product)?.discountPercent || 0,
  window: {
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  },
  renderProducts(list) { refreshedIds.push(appContext.filterHomeMenuProducts(list, "discount").map(product => product.id)); },
});
const appFunctions = [
  block(html, "homeMenuCollectionValues"),
  line(html, "homeMenuNormalizeCollection"),
  block(html, "homeMenuProductIsPublished"),
  block(html, "homeMenuProductHasActiveDiscount"),
  block(html, "filterHomeMenuProducts"),
  block(html, "homeMenuEmptyMessage"),
  block(html, "scheduleHomeMenuDiscountExpiry"),
  block(html, "getProductPricing"),
  line(html, "productDiscountPercent"),
].join("\n");
vm.runInContext(appFunctions + "\nthis.filterHomeMenuProducts=filterHomeMenuProducts;this.homeMenuProductHasActiveDiscount=homeMenuProductHasActiveDiscount;this.getProductPricing=getProductPricing;this.scheduleHomeMenuDiscountExpiry=scheduleHomeMenuDiscountExpiry;", appContext);
assert.equal(appContext.homeMenuEmptyMessage("newModel"), "There are no products in New model right now.", "New model has its own empty state");
assert.equal(appContext.homeMenuEmptyMessage("discount"), "There are no products with active discounts right now.", "Discount has its own empty state");

const past = new Date(clockNow - 5000).toISOString();
const future = new Date(clockNow + 50000).toISOString();
const newModel = { id: "new", isNewModel: true, createdAt: "2010-01-01T00:00:00Z", price: 100000 };
const unmarkedRecent = { id: "unmarked-recent", createdAt: new Date(clockNow).toISOString(), price: 100000 };
const removedNewModel = { id: "removed", isNewModel: false, createdAt: "2030-01-01T00:00:00Z", price: 100000 };
const unpublishedNewModel = { id: "unpublished", isNewModel: true, published: false, price: 100000 };
const draftNewModel = { id: "draft", isNewModel: true, status: "draft", price: 100000 };
appContext.products = [newModel, unmarkedRecent, removedNewModel, unpublishedNewModel, draftNewModel];
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts(appContext.products, "newModel"), product => product.id), ["new"], "New model follows saved membership rather than guessed dates or age");
newModel.isNewModel = false;
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts(appContext.products, "newModel"), product => product.id), [], "Owner removal immediately hides membership without deleting the product");
newModel.isNewModel = true;
const refreshedProducts = JSON.parse(JSON.stringify(appContext.products));
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts(refreshedProducts, "newModel"), product => product.id), ["new"], "membership survives product refresh serialization");

const assignedOne = { id: "collection-one", category: "Shivan Shop 1" };
const assignedTwo = { id: "collection-two", collections: [{ name: "Shivan Shop 2" }] };
const notAssigned = { id: "collection-other", category: "Shivan Shop 10" };
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts([assignedOne, assignedTwo, notAssigned], "collection1"), product => product.id), ["collection-one"], "collection 1 uses explicit existing assignments only");
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts([assignedOne, assignedTwo, notAssigned], "collection2"), product => product.id), ["collection-two"], "collection 2 uses explicit existing assignments only");

const activeDiscount = { id: "active", price: 100000, discount: 25 };
const timedDiscount = { id: "timed", price: 100000, discount: 30, discountTimerEnabled: true, discountEndsAt: future };
const expiredDiscount = { id: "expired", price: 100000, discount: 40, discountTimerEnabled: true, discountEndsAt: past };
const removedDiscount = { id: "removed-discount", price: 100000 };
const hiddenDiscount = { id: "hidden-discount", price: 100000, discount: 15, published: false };
appContext.products = [activeDiscount, timedDiscount, expiredDiscount, removedDiscount, hiddenDiscount];
assert.deepEqual(Array.from(appContext.filterHomeMenuProducts(appContext.products, "discount"), product => product.id), ["active", "timed"], "Discount includes all and only published active offers");
const collectionProductRows = [];
const sortRows = [
  { id: "expensive", name: "Zeta", price: 120000, discount: 10, isNewModel: true },
  { id: "cheapest", name: "Alpha", price: 50000, discount: 30, isNewModel: true },
  { id: "middle", name: "Mira", price: 80000, discount: 20, isNewModel: true },
];
const sortControls = new Map([
  ["newModelSortControl", { value: "price-low" }],
  ["discountSortControl", { value: "discount-high" }],
]);
const collectionProductContext = vm.createContext({
  products: sortRows,
  filterHomeMenuProducts: appContext.filterHomeMenuProducts,
  productDiscountPercent: product => Number(product.discount) || 0,
  getProductPricing: product => ({ finalPrice: Math.round(product.price * (1 - (Number(product.discount) || 0) / 100)) }),
  getProductName: product => product.name,
  activeLanguage: "en",
  document: { getElementById: id => sortControls.get(id) },
  renderProducts(list, target, append, preserveOrder) { collectionProductRows.push({ target, ids: list.map(product => product.id), append, preserveOrder }); },
});
vm.runInContext(block(html, "sortHomeMenuProducts"), collectionProductContext);
vm.runInContext(block(html, "renderHomeMenuProductCollection"), collectionProductContext);
vm.runInContext(block(html, "setHomeMenuSort"), collectionProductContext);
assert.equal(collectionProductContext.setHomeMenuSort("newModel", "price-low"), true, "New model accepts its supported sort choice");
assert.equal(collectionProductContext.setHomeMenuSort("discount", "discount-high"), true, "Discount accepts highest-discount sorting");
assert.equal(collectionProductContext.setHomeMenuSort("newModel", "discount-high"), false, "New model rejects a sort option that belongs only to Discount");
assert.deepEqual(collectionProductRows, [
  { target: "newModelProductsGrid", ids: ["cheapest", "middle", "expensive"], append: false, preserveOrder: true },
  { target: "discountProductsGrid", ids: ["cheapest", "middle", "expensive"], append: false, preserveOrder: true },
], "sorting renders each matching published set into its own page and preserves the selected order");
assert.deepEqual(
  [appContext.getProductPricing(activeDiscount).finalPrice, appContext.getProductPricing(activeDiscount).discountPercent],
  [75000, 25],
  "active Discount cards retain correct price and percentage",
);
assert.deepEqual(
  [appContext.getProductPricing(expiredDiscount).finalPrice, appContext.getProductPricing(expiredDiscount).discountPercent],
  [100000, 0],
  "expired offers return to original price and no discount badge",
);
const expiringSoon = { id: "expires-soon", price: 100000, discount: 20, discountTimerEnabled: true, discountEndsAt: new Date(clockNow + 50).toISOString() };
appContext.products = [expiringSoon];
appContext.homeMenuFilterMode = "discount";
appContext.scheduleHomeMenuDiscountExpiry();
assert.equal(timers.length, 1, "the Discount view schedules a refresh for the next expiry");
clockNow = Date.parse(expiringSoon.discountEndsAt) + 1;
timers[0].callback();
assert.deepEqual(refreshedIds.at(-1), [], "the scheduled refresh removes an expired offer automatically");

const apiFunctions = [
  block(api, "applyProductFieldGroup"),
  block(api, "prepareStaffProductWrite"),
  block(api, "customerProductInventoryView"),
  block(api, "customerProductsValue"),
  block(api, "validateProductStoreAvailability"),
  block(api, "getShopState"),
  block(api, "saveShopValue"),
].join("\n");
const stored = new Map();
const db = {
  prepare(sql) {
    const statement = {
      params: [],
      bind(...params) { this.params = params; return this; },
      async first() { return { value: stored.get(this.params[0]) }; },
      async run() { stored.set(this.params[0], this.params[1]); return { success: true, meta: { changes: 1 } }; },
      async all() { return { results: Array.from(stored, ([key, value]) => ({ key, value })) }; },
    };
    return statement;
  },
};
const apiContext = vm.createContext({
  TextEncoder,
  PRODUCT_PRICE_FIELDS: ["price", "discount", "discountPercent", "discountTimerEnabled", "discountEndsAt"],
  PRODUCT_INVENTORY_FIELDS: ["stock", "variants", "sizes", "colors", "colorNames"],
  PRODUCTS_KEY: "shivan_shop_products",
  SHOP_KEYS: new Set(["shivan_shop_products"]),
  OWNER_APPEARANCE_KEY: "shivan_shop_owner_appearance",
  OWNER_NOTIFICATION_PREFERENCES_KEY: "shivan_shop_owner_notification_preferences",
  OWNER_SMART_ALERTS_KEY: "shivan_shop_owner_alerts",
  asJson(value, fallback = null) { try { return JSON.parse(value); } catch { return fallback; } },
  normalizeProductQrIds(products) { return products; },
  validateProductPriceDetails() {},
  persistImages(products) { return products; },
  persistShopImages() {},
  requireD1WriteSuccess() {},
  logOwnerSave() {},
  now() { return "2026-11-10T00:00:00.000Z"; },
  shopValidationError(code, message) { return Object.assign(new Error(message), { code }); },
  staffHasPermission(account, permission) { return account?.role === "owner" || account?.permissions?.includes(permission); },
  productGroupHasConfiguredValues() { return true; },
  completeProductVariants(product) { return { ...product, variants: (product.variants || []).map(variant => ({ ...variant })) }; },
  customerProductInventoryView: undefined,
  customerProductsValue: undefined,
  env: { DB: db },
});
vm.runInContext(apiFunctions + "\nthis.prepareStaffProductWrite=prepareStaffProductWrite;this.saveShopValue=saveShopValue;this.getShopState=getShopState;", apiContext);
const ownerProduct = { id: "owner-product", name: "Owner saved", price: 100000, stock: 3, variants: [{ size: "M", color: "black", stock: 3 }], isNewModel: true };
await apiContext.saveShopValue(apiContext.env, "shivan_shop_products", JSON.stringify([ownerProduct]), "test-write");
const firstDeviceState = await apiContext.getShopState(apiContext.env, null);
const firstDeviceProducts = JSON.parse(firstDeviceState.shivan_shop_products);
assert.equal(firstDeviceProducts[0].isNewModel, true, "shared reads on another device preserve New model membership");
assert.equal(Object.hasOwn(firstDeviceProducts[0], "stock"), false, "customer sync still hides exact stock");
assert.equal(Object.hasOwn(firstDeviceProducts[0].variants[0], "stock"), false, "customer sync still hides exact variant stock");

const staff = { role: "staff", permissions: ["products", "prices", "inventory"] };
const previousProducts = [
  { id: "kept-out", name: "Existing", price: 100000, isNewModel: false },
  { id: "kept-in", name: "Existing new", price: 100000, isNewModel: true },
];
const staffEnv = { DB: { prepare() { return { bind() { return { first: async () => ({ value: JSON.stringify(previousProducts) }) }; } }; } } };
const attemptedStaffWrite = [
  { ...previousProducts[0], isNewModel: true },
  { ...previousProducts[1], isNewModel: false },
  { id: "staff-created", name: "Staff created", price: 100000, isNewModel: true },
];
const prepared = await apiContext.prepareStaffProductWrite(staffEnv, JSON.stringify(attemptedStaffWrite), staff);
assert.equal(prepared.response, undefined, "a fully permitted staff product edit remains accepted");
const safeStaffProducts = JSON.parse(prepared.value);
assert.equal(safeStaffProducts[0].isNewModel, false, "staff cannot promote an existing product into New model");
assert.equal(safeStaffProducts[1].isNewModel, true, "staff cannot remove existing New model membership");
assert.equal(Object.hasOwn(safeStaffProducts[2], "isNewModel"), false, "staff-created products cannot self-grant membership");

await apiContext.saveShopValue(apiContext.env, "shivan_shop_products", JSON.stringify([{ ...ownerProduct, isNewModel: false }]), "owner-remove");
const afterOwnerRemoval = JSON.parse((await apiContext.getShopState(apiContext.env, null)).shivan_shop_products);
assert.equal(afterOwnerRemoval[0].isNewModel, false, "Owner removal persists through shared reads");
await apiContext.saveShopValue(apiContext.env, "shivan_shop_products", JSON.stringify([{ ...ownerProduct, isNewModel: true }]), "owner-restore");
const afterOwnerRestore = JSON.parse((await apiContext.getShopState(apiContext.env, null)).shivan_shop_products);
assert.equal(afterOwnerRestore[0].isNewModel, true, "Owner restore persists through shared reads");

console.log("Home menu dynamic checks passed: Owner additions and toggles, explicit membership, active/expired discounts, refresh persistence, cross-device shared reads, staff protection, and hidden customer stock.");
