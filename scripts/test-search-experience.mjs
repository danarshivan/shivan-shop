import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const source = (name) => {
  const match = html.match(new RegExp(`(?:async\\s+)?function ${name}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`, "m"));
  assert.ok(match, `Expected ${name} implementation.`);
  return match[0];
};

assert.match(html, /body\.search-page-open #mainApp>\.topbar\{display:none!important\}/, "Search hides the legacy logo header");
assert.match(html, /body\.search-page-open>\.language-switcher\{display:none!important\}/, "Search hides the global language selector");
assert.match(html, /id="searchPageInput"[^>]*placeholder="Search women’s fashion…"/, "Search uses the approved women’s fashion placeholder");
assert.match(html, /class="search-page-brand"[^>]*>Shivan Shop<\/div>/, "Search has a centered Shivan Shop wordmark");
assert.match(html, /id="searchCategoryFilter"[\s\S]*?id="searchSortControl"[\s\S]*?id="searchGrid" class="products shop-collection-products search-products-grid"/, "Search offers category and sort controls with the shared product card grid");
assert.match(html, /\.search-page\{[^}]*overflow-x:hidden/, "the Search view clips accidental horizontal overflow on narrow devices");
assert.match(html, /@media\(max-width:350px\)\{\.search-page-header/, "the Search controls have a compact layout for 320px iPhones");
assert.match(html, /\.products\.shop-collection-products\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "Search reuses the three-column mobile product grid at 375px and 390px");
assert.match(source("renderProducts"), /<div class="product-store-location"[\s\S]*?productStoreAvailabilityLabel\(p\)[\s\S]*?<div class="product-bottom">/, "all product cards show explicit store assignment below the image");
const cardRenderer = source("renderProducts");
assert.match(cardRenderer, /class="heart \$\{isFavorite\(p\.id\)\?/, "Search cards keep the shared Favorite control");
assert.match(cardRenderer, /renderProductPricing\(p\)/, "Search cards use live IQD pricing");
assert.match(cardRenderer, /product-discount-badge[\s\S]*?renderTimedDiscountBadge\(p\)/, "Search cards retain discount percentages and timed countdowns");
assert.match(source("renderProducts"), /renderTimedDiscountBadge\(p\)[\s\S]*?productHasAvailableInventory\(p\)[\s\S]*?quickAdd\(\$\{p\.id\}\)/, "Search cards retain timed discounts, availability and add-to-cart controls");
assert.match(source("openView"), /if\(view==="search"&&previousView!=="search"&&previousView!=="detail"\)shopSearchReturnView=previousView/, "Search remembers its originating route");
assert.match(source("openView"), /document\.body\?\.classList\.toggle\("search-page-open",view==="search"\)/, "the Search header state follows route navigation");
assert.match(source("applyCloudData"), /updateHomeHeaderCountBadges\(\)/, "account-specific Home badges refresh after cloud synchronization");
assert.match(source("renderOrders"), /updateHomeHeaderCountBadges\(\)/, "order creation or status updates refresh the Home order badge");

class SelectControl {
  constructor(value = "") { this.value = value; this.options = []; }
  set innerHTML(value) {
    this.options = [...String(value).matchAll(/<option value="([^"]*)">/g)].map(match => ({ value: match[1] }));
    if (!this.options.some(option => option.value === this.value)) this.value = this.options[0]?.value || "";
  }
}
const storage = new Map();
const elements = new Map();
const controls = {
  searchView: { classList: { contains: name => name === "active" } },
  searchPageInput: { value: "", placeholder: "", setAttribute() {} },
  searchClearButton: { hidden: true, setAttribute() {} },
  searchCategoryCards: { innerHTML: "", querySelectorAll: () => [] },
  searchResultsSummary: { textContent: "" },
  searchCategoryFilter: new SelectControl(""),
  searchSizeFilter: new SelectControl(""),
  searchColorFilter: new SelectControl(""),
  searchSortControl: new SelectControl("newest"),
  searchMinPrice: { value: "" },
  searchMaxPrice: { value: "" },
  searchDiscountOnly: { checked: false },
  homeFavoritesBadge: { textContent: "", hidden: true, setAttribute(name, value) { this[name] = value; } },
  homeOrdersBadge: { textContent: "", hidden: true, setAttribute(name, value) { this[name] = value; } },
  homeFavoritesButton: { setAttribute(name, value) { this[name] = value; }, title: "" },
  homeOrdersButton: { setAttribute(name, value) { this[name] = value; }, title: "" },
};
for (const [id, element] of Object.entries(controls)) elements.set(id, element);

const products = [
  { id: 1, name: "Silk Dress", names: { en: "Silk Dress" }, category: "Dresses", description: "Evening wear", price: 40000, discount: 20, createdAt: "2026-03-01T00:00:00Z", colors: ["#a00040"], colorNames: ["Burgundy"], sizes: ["S", "M"], variants: [{ color: "#a00040", size: "S", stock: 1 }, { color: "#a00040", size: "M", stock: 0 }], collection: ["Shivan Shop 1"], storeAvailability: "shop1" },
  { id: 2, name: "Cotton Blouse", names: { en: "Cotton Blouse" }, category: "Tops", description: "Casual cotton shirt", price: 25000, createdAt: "2026-05-01T00:00:00Z", colors: ["#ffffff"], colorNames: ["White"], sizes: ["M", "L"], variants: [{ color: "#ffffff", size: "M", stock: 3 }], collection: ["Shivan Shop 2"] },
  { id: 3, name: "Classic Skirt", category: "Skirts", description: "Classic black style", price: 18000, discount: 15, discountTimerEnabled: true, discountEndsAt: "2000-01-01T00:00:00.000Z", colors: ["#000000"], colorNames: ["Black"], sizes: ["S"], stock: 2 },
  { id: 4, name: "Evening Coat", category: "Coats", description: "Tailored evening coat", price: 60000, colors: ["#333333"], sizes: ["L"], stock: 2, collections: ["Shivan Shop 1", "Shivan Shop 2"], storeAvailability: "both" },
];
let accountOrders = [];
let rendered = [];
const context = vm.createContext({
  products,
  currentUser: { id: "customer-a", role: "customer" },
  cloudAccount: { id: "customer-a", role: "customer" },
  activeLanguage: "en",
  FAVORITES_KEY: "shivan_shop_favorites",
  localStorage: { getItem(key) { return storage.get(String(key)) ?? null; }, setItem(key, value) { storage.set(String(key), String(value)); } },
  document: { getElementById(id) { return elements.get(id) || null; } },
  isOwner: () => false,
  isStaffSession: () => false,
  getOrders: () => accountOrders,
  getAllCategories: () => ["Dresses", "Tops", "Skirts", "Coats"],
  categoryLabel: value => value,
  categoryEmoji: () => "◇",
  getProductName: product => product.name,
  translateText: value => String(value || ""),
  customerUiText: en => en,
  renderSearchFilterOptions() {},
  renderSearchCategoryCards() {},
  colorLabelForValue: value => value,
  productHasAvailableInventory: product => (product.variants || []).some(variant => Number(variant.stock) > 0) || Number(product.stock) > 0,
  variantStock: (product, color, size) => Number(product.variants?.find(variant => variant.color === color && variant.size === size)?.stock || 0),
  renderProducts(list) { rendered = list.map(product => product.id); },
  safeImageUrl: value => value || "",
  productPhotos: product => product.images || [],
  escapeHtml: value => String(value ?? ""),
});
const functions = [
  "homeMenuCollectionValues", "homeMenuNormalizeCollection", "searchProductSizes", "searchProductColors",
  "productStoreAvailabilityLabel",
  "searchProductMatchesQuery", "searchProductTimestamp", "searchProductPrice", "searchProductStoreLocationLabel",
  "sortSearchProducts", "searchProductMatchesFilters", "customerOrderBadgeCategory", "favoritesStorageKey",
  "updateHomeHeaderCountBadges", "getProductPricing", "productDiscountPercent", "searchProducts",
].map(source).join("\n");
vm.runInContext(`${functions}\nthis.searchProducts=searchProducts;this.updateHomeHeaderCountBadges=updateHomeHeaderCountBadges;this.sortSearchProducts=sortSearchProducts;this.searchProductMatchesQuery=searchProductMatchesQuery;this.searchProductMatchesFilters=searchProductMatchesFilters;this.searchProductStoreLocationLabel=searchProductStoreLocationLabel;this.productStoreAvailabilityLabel=productStoreAvailabilityLabel;`, context);

assert.equal(context.searchProductMatchesQuery(products[0], "burgundy"), true, "color names are searchable");
assert.equal(context.searchProductMatchesQuery(products[0], "evening wear"), true, "product details are searchable");
assert.equal(context.searchProductMatchesQuery(products[0], "dresses"), true, "category names are searchable");
assert.equal(context.searchProductMatchesQuery(products[0], "M"), false, "unavailable sizes do not become searchable availability matches");
assert.deepEqual(Array.from(context.sortSearchProducts(products, "newest"), product => product.id), [2, 1, 3, 4], "Newest uses real dates and leaves undated products after dated products");
assert.deepEqual(Array.from(context.sortSearchProducts(products, "price-low"), product => product.id), [3, 2, 1, 4], "price sorting uses live discounted pricing");
assert.equal(context.searchProductStoreLocationLabel(products[0]), "Shivan Shop 1", "a single existing Shop 1 assignment is labeled accurately");
assert.equal(context.searchProductStoreLocationLabel(products[3]), "Shivan Shop 1 + Shivan Shop 2", "Both Shops displays both explicit store names");
assert.match(context.searchProductStoreLocationLabel(products[2]), /not specified/i, "unknown store assignments are not invented");
assert.match(context.searchProductStoreLocationLabel(products[1]), /not specified/i, "old collection labels never guess Store Availability");

elements.get("searchCategoryFilter").value = "Dresses";
assert.equal(context.searchProductMatchesFilters(products[0]), true, "matching category remains included");
assert.equal(context.searchProductMatchesFilters(products[1]), false, "category filter removes other categories");
elements.get("searchCategoryFilter").value = "";
elements.get("searchSizeFilter").value = "M";
assert.equal(context.searchProductMatchesFilters(products[0]), false, "size filter excludes an unavailable size");
assert.equal(context.searchProductMatchesFilters(products[1]), true, "size filter includes an available size");
elements.get("searchSizeFilter").value = "";
elements.get("searchDiscountOnly").checked = true;
assert.equal(context.searchProductMatchesFilters(products[0]), true, "active discounts can be filtered");
assert.equal(context.searchProductMatchesFilters(products[2]), false, "expired discounts are excluded using existing price logic");
elements.get("searchDiscountOnly").checked = false;

elements.get("searchPageInput").value = "silk";
const result = context.searchProducts("silk", "searchGrid");
assert.deepEqual(Array.from(result, product => product.id), [1], "typing a query immediately returns matching catalog products");
assert.deepEqual(rendered, [1], "Search renders matching products into its own grid");
assert.equal(elements.get("searchClearButton").hidden, false, "clear-search appears while a query is present");

storage.set("shivan_shop_favorites_customer-a", "[1,2]");
accountOrders = [
  { userId: "customer-a", status: "لە چاوەڕوانی" },
  { userId: "customer-a", status: "پێچرا" },
  { userId: "customer-a", status: "گەهشت" },
  { userId: "customer-a", status: "هەڵوەشاندنەوە" },
  { userId: "customer-b", status: "New" },
];
assert.deepEqual(JSON.parse(JSON.stringify(context.updateHomeHeaderCountBadges())), { favorites: 2, orders: 2 }, "Home badges count this customer's favorites and only active orders");
assert.equal(elements.get("homeFavoritesBadge").hidden, false);
assert.equal(elements.get("homeOrdersBadge").hidden, false);
context.cloudAccount = { id: "customer-b", role: "customer" };
context.currentUser = context.cloudAccount;
storage.set("shivan_shop_favorites_customer-b", "[3]");
accountOrders = [{ userId: "customer-b", status: "New" }];
assert.deepEqual(JSON.parse(JSON.stringify(context.updateHomeHeaderCountBadges())), { favorites: 1, orders: 1 }, "switching accounts reads only the active account's favorite and order data");
context.cloudAccount = { id: "owner-1", role: "owner" };
context.currentUser = context.cloudAccount;
assert.deepEqual(JSON.parse(JSON.stringify(context.updateHomeHeaderCountBadges())), { favorites: 0, orders: 0 }, "Owner sessions do not leak customer count badges");

console.log("PASS: Search page behavior, product filters, collection labels, and customer-scoped Home count badges.");
