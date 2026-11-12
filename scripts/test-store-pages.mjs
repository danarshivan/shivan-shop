import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
function functionSource(name) {
  const start = html.indexOf("function " + name + "(");
  assert.notEqual(start, -1, "source contains " + name);
  const next = html.indexOf("\nfunction ", start + 1);
  return html.slice(start, next < 0 ? html.length : next).trim();
}
function contextWithFunctions(functions, context = {}) {
  const sandbox = vm.createContext(context);
  const exports = functions.map(name => "this." + name + "=" + name + ";").join("\n");
  vm.runInContext(functions.map(functionSource).join("\n") + "\n" + exports, sandbox);
  return sandbox;
}

assert.match(html, /id="storeView" class="view page shop-menu-collection-view store-page-view"/);
assert.match(html, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "store pages use a two-column product grid");
assert.match(html, /id="storePageGridButton"[\s\S]*id="storePageListButton"/, "store page offers grid and list layouts");
assert.match(html, /id="storePageCategoryFilters"[\s\S]*id="storePageSortControl"[\s\S]*id="storePageFilterButton"/, "store page includes category, sorting, and filter controls");
assert.match(html, /options\.preserveProductReturn\|\|options\.historyRestore\)[^;]*mainApp\.scrollTop/, "history Back restores the saved app scroll position");
assert.match(html, /"home","search","store","newModel","discount","favorites"/, "Product Details can return to its originating store page");

const fixture = [
  { id: 101, name: "Dress One", category: "Dress", storeAvailability: "shop1", price: 12000, discount: 25, stock: 2 },
  { id: 102, name: "Top Two", category: "Top", storeAvailability: "shop2", price: 15000, stock: 1 },
  { id: 103, name: "Both Dress", category: "Dress", storeAvailability: "both", price: 18000, stock: 3 },
  { id: 104, name: "Unspecified", category: "Dress", price: 99000, stock: 5 },
  { id: 105, name: "Draft", category: "Dress", storeAvailability: "shop1", status: "draft", price: 7000, stock: 1 },
  { id: 106, name: "Unavailable One", category: "Top", storeAvailability: "shop1", price: 8000, stock: 0 },
  { id: 107, name: "Shop Two Offer", category: "Dress", storeAvailability: "shop2", price: 22000, discount: 20, expired: true, stock: 4 },
];
const app = contextWithFunctions(["filterStorePageProducts", "storePageSortProducts"], {
  storePageStore: "shop1", storePageSortMode: "newest",
  homeMenuProductIsPublished: p => p?.status !== "draft" && p?.published !== false,
  homeMenuProductHasActiveDiscount: p => Number(p?.discount) > 0 && p?.expired !== true,
  productHasAvailableInventory: p => Number(p?.stock) > 0,
  resolveCategoryName: name => name,
  sortSearchProducts: (rows, mode) => mode === "newest" ? [...rows].reverse() : [...rows],
  sortHomeMenuProducts: (rows, mode, sort) => sort === "name" ? [...rows].sort((a,b) => a.name.localeCompare(b.name)) : [...rows],
});
assert.deepEqual(Array.from(app.filterStorePageProducts(fixture, "shop1"), p => p.id), [101, 103, 106], "Shop 1 shows only explicit Shop 1 and Both assignments");
assert.deepEqual(Array.from(app.filterStorePageProducts(fixture, "shop2"), p => p.id), [102, 103, 107], "Shop 2 shows only explicit Shop 2 and Both assignments");
assert.deepEqual(Array.from(app.filterStorePageProducts(fixture, "shop1", { category: "dress" }), p => p.id), [101, 103], "category filters match the real category relationship");
assert.deepEqual(Array.from(app.filterStorePageProducts(fixture, "shop1", { availableOnly: true }), p => p.id), [101, 103], "availability filtering hides unavailable products without exposing quantities");
assert.deepEqual(Array.from(app.filterStorePageProducts(fixture, "shop2", { discountedOnly: true }), p => p.id), [], "expired discounts do not enter the filtered results");
const menuRoutes = [];
const menu = contextWithFunctions(["openStorePage", "openHomeMenuCollection"], {
  storePageStore: "shop1", storePageCategory: "", storePageSortMode: "newest", storePageViewMode: "grid",
  storePageDiscountedOnly: false, storePageAvailableOnly: false, storePageFiltersOpen: false,
  closeHomeMenu() {}, openView(view) { menuRoutes.push({ view, store: menu.storePageStore }); },
  renderHomeMenuProductCollection() {},
});
assert.equal(menu.openHomeMenuCollection("collection1"), true);
assert.deepEqual(menuRoutes.at(-1), { view: "store", store: "shop1" }, "Shop Menu 1 opens the dedicated reusable store page");
assert.equal(menu.openHomeMenuCollection("collection2"), true);
assert.deepEqual(menuRoutes.at(-1), { view: "store", store: "shop2" }, "Shop Menu 2 opens the same page with Shop 2 data");
assert.equal(menu.openHomeMenuCollection("unknown"), false, "unknown menu entries do not open a store page");

let historyBackCalls = 0;
const back = contextWithFunctions(["goBackFromShopCollection"], {
  getActiveShopView: () => "store",
  window: { history: { state: { __shivanShopView: "store" }, length: 3, back() { historyBackCalls++; } } },
  shopViewScrollPositions: new Map(), writeShopViewHistory() {}, openView() {},
});
assert.equal(back.goBackFromShopCollection(), true);
assert.equal(historyBackCalls, 1, "store Back uses the originating navigation entry");
const fallbackCalls = [];
const fallback = contextWithFunctions(["goBackFromShopCollection"], {
  getActiveShopView: () => "store",
  window: { history: { state: null, length: 1, back() { throw new Error("fallback must not call history.back"); } } },
  shopViewScrollPositions: new Map([["home", { windowY: 0, appTop: 326, viewTop: 0, authTop: 0 }]]),
  writeShopViewHistory(view, options) { fallbackCalls.push(["history", view, options.position.appTop]); },
  openView(view, options) { fallbackCalls.push(["view", view, options.restorePosition.appTop]); },
});
assert.equal(fallback.goBackFromShopCollection(), true);
assert.deepEqual(fallbackCalls, [["history", "home", 326], ["view", "home", 326]], "Back fallback restores Home's saved app scroll position");

const nodes = new Map();
const span = { textContent: "" };
const countNode = { querySelector: () => span };
const gridNode = { classList: { value: "", toggle(name, value) { this.value = value ? name : ""; } } };
for (const id of ["storePageTitle", "storePageSubtitle", "storePageCategoryFilters", "storePageSortControl", "storePageFilterLabel", "storePageDiscountFilterLabel", "storePageAvailableFilterLabel", "storePageDiscountedOnly", "storePageAvailableOnly", "storePageFilterPanel", "storePageFilterButton", "storePageProductsGrid", "storePageGridButton", "storePageListButton", "storePageProductCount"]) nodes.set(id, {});
nodes.set("storePageProductCount", countNode);
nodes.set("storePageProductsGrid", gridNode);
nodes.set("storePageSortControl", { value: "", innerHTML: "" });
nodes.set("storePageFilterPanel", { hidden: true });
nodes.set("storePageFilterButton", { setAttribute(name, value) { this[name] = value; } });
nodes.set("storePageGridButton", { setAttribute(name, value) { this[name] = value; } });
nodes.set("storePageListButton", { setAttribute(name, value) { this[name] = value; } });
nodes.set("storePageDiscountedOnly", {});nodes.set("storePageAvailableOnly", {});
nodes.get("storePageCategoryFilters").innerHTML = "";
let renderedStoreRows = [];
const page = contextWithFunctions(["filterStorePageProducts", "storePageSortProducts", "renderStorePage"], {
  storePageStore: "shop2", storePageCategory: "", storePageSortMode: "newest", storePageViewMode: "list",
  storePageDiscountedOnly: false, storePageAvailableOnly: true, storePageFiltersOpen: true,
  products: fixture,
  document: { getElementById: id => nodes.get(id) || null },
  getAllCategories: () => ["Dress", "Top"], categoryLabel: value => value,
  customerUiText: en => en, escapeHtml: value => String(value),
  homeMenuProductIsPublished: p => p?.status !== "draft" && p?.published !== false,
  homeMenuProductHasActiveDiscount: p => Number(p?.discount) > 0 && p?.expired !== true,
  productHasAvailableInventory: p => Number(p?.stock) > 0,
  resolveCategoryName: name => name,
  sortSearchProducts: (rows, mode) => mode === "newest" ? [...rows].reverse() : [...rows],
  sortHomeMenuProducts: rows => rows,
  renderStoreProductCards(rows) { renderedStoreRows = rows; }, scheduleStorePageDiscountRefresh() {},
});
assert.equal(page.renderStorePage(), 3, "page count uses actual assigned, published, available products");
assert.equal(nodes.get("storePageTitle").textContent, "Shivan Shop 2");
assert.match(nodes.get("storePageCategoryFilters").innerHTML, /Dress[\s\S]*Top/, "category filters use existing category names");
assert.equal(nodes.get("storePageSortControl").value, "newest", "newest is the default sort");
assert.equal(nodes.get("storePageFilterPanel").hidden, false);
assert.equal(nodes.get("storePageAvailableOnly").checked, true);
assert.equal(gridNode.classList.value, "is-list");
assert.deepEqual(Array.from(renderedStoreRows, p => p.id), [107, 103, 102], "newest sorting preserves the store page's filtered products");

let cardHtml = "";
const cardContext = contextWithFunctions(["renderStoreProductCards"], {
  document: { getElementById: () => ({ set innerHTML(value) { cardHtml = value; }, get innerHTML() { return cardHtml; } }) },
  customerUiText: en => en, escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;"),
  getProductName: p => p.name, productDiscountPercent: p => p.discount || 0, isFavorite: () => false,
  productHasAvailableInventory: () => true, searchProductSizes: () => ["S", "M"],
  searchProductColors: () => [{ value: "#aabbcc", label: "Blue" }], safeImageUrl: value => value,
  renderTimedDiscountBadge: () => "", renderProductPricing: () => "<del>20,000 IQD</del><strong>15,000 IQD</strong>",
  productStoreAvailabilityLabel: () => "Shivan Shop 1 + Shivan Shop 2", refreshDiscountCountdownBadges() {},
});
const cardProduct = { id: 777, name: "Dress & Coat", image: "/real-dress.jpg", discount: 25, stock: 987654 };
assert.equal(cardContext.renderStoreProductCards([cardProduct]), true);
assert.match(cardHtml, /src="\/real-dress\.jpg"/);
assert.match(cardHtml, /-25%/);
assert.match(cardHtml, /20,000 IQD[\s\S]*15,000 IQD/);
assert.match(cardHtml, /Dress &amp; Coat/);
assert.match(cardHtml, /Shivan Shop 1 \+ Shivan Shop 2/);
assert.match(cardHtml, /store-product-size-chip[\s\S]*>S</);
assert.match(cardHtml, /background:#aabbcc/);
assert.match(cardHtml, /quickAdd\(777\)/);
assert.match(cardHtml, /toggleFavorite\(777\)/);
assert.doesNotMatch(cardHtml, /987654/, "customer product cards never render exact inventory quantities");
assert.equal(cardContext.renderStoreProductCards([]), true);
assert.match(cardHtml, /No products in this store yet/, "empty store collections have a dedicated empty state");

console.log("test-store-pages.mjs passed: store assignment isolation, filtering, sorting, routing, Back scroll, cards, and empty state.");
