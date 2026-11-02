import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const sourceOf = (pattern, label) => {
  const source = html.match(pattern)?.[0] || "";
  assert.ok(source, `Could not find ${label}.`);
  return source;
};

const apply = sourceOf(/function applyCloudData\(data\)\{[\s\S]*?\n\}/, "cloud data application");
const refresh = sourceOf(/async function refreshCloudData\(\)\{[\s\S]*?\n\}/, "background refresh");
const storageListener = sourceOf(/window\.addEventListener\("storage",event=>\{[\s\S]*?\n\}\);/, "cross-tab storage listener");
const ownerDraftGuard = sourceOf(/function ownerPanelHasPendingWork\(\)\{[\s\S]*?\n\}/, "Owner draft guard");
const safeOwnerRefresh = sourceOf(/function refreshOwnerPanelIfSafe\(\)\{[\s\S]*?\n\}/, "safe Owner refresh");
const visibleGrid = sourceOf(/function renderVisibleProductGrid\(\)\{[\s\S]*?\n\}/, "active product grid refresh");
const searchRenderer = sourceOf(/function searchProducts\(value,forceTarget=""\)\{[\s\S]*?\n\}/, "search result renderer");

assert.doesNotMatch(refresh, /openMain\(|openView\(|location\.reload\(/, "a background refresh must never route or reload the app");
assert.match(apply, /if\(productsChanged\|\|favoritesChanged\)renderVisibleProductGrid\(\)/, "sync should redraw the active product-list context");
assert.match(storageListener, /if\(productsChanged\|\|favoritesChanged\)renderVisibleProductGrid\(\)/, "cross-tab changes should redraw the active product-list context");
assert.match(apply, /if\(changedKeys\.has\(ORDERS_KEY\)\)renderOrders\(\)/, "only changed order data should replace the order list");
assert.match(searchRenderer, /renderProducts\(result,forceTarget\|\|\(searchIsOpen\?"searchGrid":"productsGrid"\)\)/, "a detail view opened from Search must keep refreshing the hidden Search grid");

const gridCalls = { searches: [], lists: [] };
const gridSandbox = {
  previousView: "home", currentCategory: "All",
  products: [{ id: "dress", category: "Dresses" }, { id: "coat", category: "Coats" }],
  document: { getElementById: id => id === "searchPageInput" ? { value: "silk" } : null },
  getActiveShopView: () => "search",
  searchProducts: (query, target) => gridCalls.searches.push({ query, target }),
  resolveCategoryName: value => value,
  getAllCategories: () => ["Dresses", "Coats"],
  renderProducts: list => gridCalls.lists.push(list.map(product => product.id)),
};
runInNewContext(`${visibleGrid}\nglobalThis.refreshGrid=renderVisibleProductGrid;`, gridSandbox);
gridSandbox.refreshGrid();
assert.deepEqual(gridCalls.searches, [{ query: "silk", target: "searchGrid" }], "Search sync keeps its query and targets the Search results element");
gridSandbox.getActiveShopView = () => "detail";
gridSandbox.previousView = "search";
gridSandbox.refreshGrid();
assert.deepEqual(gridCalls.searches[1], { query: "silk", target: "searchGrid" }, "product details retain Search as their underlying browsing state");
gridSandbox.getActiveShopView = () => "home";
gridSandbox.currentCategory = "Dresses";
gridSandbox.refreshGrid();
assert.deepEqual(gridCalls.lists, [["dress"]], "a Home refresh keeps the selected category filter");
gridSandbox.getActiveShopView = () => "owner";
gridSandbox.refreshGrid();
assert.equal(gridCalls.lists.length, 1, "Owner refreshes do not redraw the hidden storefront grid");

const ownerStored = new Map([["shivan_shop_ads", "old"]]);
let ownerDraftActive = true;
let ownerPanelRenderCount = 0;
let orderRenderCount = 0;
const ownerDraftForm = { dataset: { shivanDraftDirty: "true" } };
const ownerPanelContent = { querySelector: () => ownerDraftActive ? ownerDraftForm : null };
const ownerSandbox = {
  PRODUCTS_KEY: "shivan_shop_products", ADS_KEY: "shivan_shop_ads",
  OWNER_APPEARANCE_KEY: "shivan_shop_owner_appearance", SHOP_ONBOARDING_IMAGES_KEY: "shivan_shop_onboarding_images",
  OWNER_CATEGORIES_KEY: "shivan_shop_categories", OWNER_CATEGORY_META_KEY: "shivan_shop_category_meta",
  OWNER_CATEGORY_RENAMES_KEY: "shivan_shop_category_renames", OWNER_CATEGORY_DELETED_KEY: "shivan_shop_deleted_categories",
  FAVORITES_KEY: "shivan_shop_favorites", CART_KEY: "shivan_shop_cart", SETTINGS_KEY: "shivan_shop_settings",
  SUPPORT_KEY: "shivan_shop_support", ORDERS_KEY: "shivan_shop_orders", ACCOUNT_KEY: "shivan_shop_accounts",
  CLOUD_OWNER_KEYS: new Set(["shivan_shop_products", "shivan_shop_ads", "shivan_shop_onboarding_images", "shivan_shop_owner_appearance", "shivan_shop_categories", "shivan_shop_category_meta", "shivan_shop_category_renames", "shivan_shop_deleted_categories"]),
  cloudAccount: { id: "offline-owner", role: "owner" }, cloudHydrating: false,
  ownerPanel: "ads", ownerProductMode: "menu", ownerProductWorkflowId: "", ownerPanelRefreshPending: false,
  pendingImageCrop: null, ownerProductImageQueue: null,
  localStorage: { getItem: key => ownerStored.get(key) ?? null },
  originalStorageSetItem: { call: (_storage, key, value) => ownerStored.set(key, String(value)) },
  readCloudOutbox: () => ({}), cloudStorageKey: key => key,
  document: { getElementById: id => id === "ownerPanelContent" ? ownerPanelContent : { style: { display: "block" } } },
  isOwner: () => true,
  renderOwnerPanel: () => { ownerPanelRenderCount++; },
  loadProducts() {}, loadOwnerAppearance() {}, getAdvertisements: () => [], renderAdvertisements() {},
  renderCategoryButtons() {}, renderVisibleProductGrid() {}, renderShopOnboardingSlide() {}, updateCartBadge() {},
  renderOrders: () => { orderRenderCount++; }, updateProfile() {},
};
runInNewContext(`${ownerDraftGuard}\n${safeOwnerRefresh}\n${apply}\nglobalThis.applyRemote=applyCloudData;`, ownerSandbox);
ownerSandbox.applyRemote({ shop: { shivan_shop_ads: "remote-1" }, user: {} });
assert.equal(ownerPanelRenderCount, 0, "background sync keeps an in-progress Owner banner editor mounted");
assert.equal(ownerSandbox.ownerPanelRefreshPending, true, "deferred refresh remains queued while the Owner draft is active");
assert.equal(orderRenderCount, 0, "an unrelated banner refresh does not close or replace the order list");
ownerDraftActive = false;
ownerSandbox.applyRemote({ shop: { shivan_shop_ads: "remote-2" }, user: {} });
assert.equal(ownerPanelRenderCount, 1, "the Owner panel refreshes once it is safe to replace the draft");
assert.equal(ownerSandbox.ownerPanelRefreshPending, false, "the deferred Owner refresh is cleared after redraw");
ownerSandbox.applyRemote({ shop: {}, user: { shivan_shop_orders: "[]" } });
assert.equal(orderRenderCount, 1, "a genuine order update refreshes the order list");

let shouldFail = true;
let requestCount = 0;
let routeCallCount = 0;
const refreshSandbox = {
  cloudMode: true, cloudRefreshPromise: null,
  cloudAccount: { id: "offline-customer", role: "customer" }, currentUser: { id: "offline-customer" },
  flushCloudWrites: async () => true,
  cloudRequest: async () => { requestCount++; if (shouldFail) throw new Error("offline retry test"); return { shop: {}, user: {} }; },
  applyCloudData() {}, openMain() { routeCallCount++; }, openView() { routeCallCount++; },
};
runInNewContext(`${refresh}\nglobalThis.refresh=refreshCloudData;`, refreshSandbox);
await assert.rejects(refreshSandbox.refresh(), /offline retry test/);
assert.equal(refreshSandbox.cloudRefreshPromise, null, "the failed request releases the refresh lock for a retry");
assert.equal(refreshSandbox.cloudAccount.id, "offline-customer", "a failed refresh preserves the current account");
assert.equal(routeCallCount, 0, "a failed refresh never changes the current route");
shouldFail = false;
await refreshSandbox.refresh();
assert.equal(requestCount, 2, "the user can retry after network recovery");
assert.equal(routeCallCount, 0, "a successful quiet refresh also leaves navigation alone");

console.log("Offline lifecycle resilience checks passed: Search/category/detail context survives shared refresh, unrelated updates preserve Owner drafts and expanded order UI, failed sync retains sessions and retries without routing, and no background refresh reloads the app.");
