import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const api = await readFile(new URL("../functions/api/[[path]].js", import.meta.url), "utf8");
function block(source, name) {
  const match = source.match(new RegExp("function " + name + "\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}", "m"));
  assert.ok(match, "expected " + name + " implementation");
  return match[0];
}

assert.ok(html.includes('id="homeFavoritesButton"') && html.includes('onclick="openHomeFavorites()"'), "the Home heart opens Favorites");
assert.match(html, /function openHomeFavorites\(\)[\s\S]*?openView\("favorites"\)[\s\S]*?renderFavoritesPage\(\)/, "the Home heart opens and renders a dedicated Favorites route");
assert.match(html, /id="favoritesView" class="view page[^"]*"[\s\S]*?id="favoritesPageHeading"[^>]*>Favorites[\s\S]*?id="favoritesHeroSubtitle"[^>]*>Your liked products in one place[\s\S]*?id="favoritesProductCount"[^>]*aria-live="polite"[\s\S]*?id="favoritesSortControl"[\s\S]*?id="favoritesProductsGrid" class="products shop-collection-products"/, "Favorites has its own branded page, subtitle, live product count, sorting, and shared product grid");
assert.ok(html.includes('class="favorites-empty"') && html.includes("No favorites yet") && html.includes('class="favorites-explore-button"') && html.includes("exploreProductsFromFavorites()"), "Favorites has a shopping-bag empty state and Explore Products action");
assert.ok(html.includes('aria-pressed="${isFavorite(p.id)}"') && html.includes('event.stopPropagation();toggleFavorite(${p.id})'), "product-card hearts report their state and do not open Product Details");
assert.match(html, /\.products \.heart\{[^}]*width:34px;height:34px;[^}]*border-radius:11px;[^}]*backdrop-filter:blur/, "product-card hearts use a compact translucent rounded-square background");
assert.match(html, /\.products \.heart\.liked\{[^}]*linear-gradient\(145deg,[^}]*animation:product-favorite-pop/, "saved product hearts use a purple gradient and subtle animation");
assert.match(html, /\.products\.shop-collection-products\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "Favorites uses the existing three-column mobile product grid");
assert.match(html, /@media\(max-width:350px\)\{\.products \.heart\{[^}]*width:31px;height:31px/, "the card heart scales down for 320px phones while remaining tappable");
assert.match(html, /\.favorites-controls\{display:grid;grid-template-columns:minmax\(0,1fr\) auto minmax\(0,min\(190px,52%\)\)/, "count and sort controls can compress inside narrow mobile widths");
assert.match(html, /function renderVisibleProductGrid\(\)[\s\S]*?if\(browseView==="favorites"\)\{\s*renderFavoritesPage\(\)/, "favorite changes and remote refreshes rerender the dedicated page");
assert.match(html, /function openView\(view,options=\{\}\)[\s\S]*?"favoritesView"[\s\S]*?view==="favorites"/, "Favorites participates in normal Shop routing and bottom navigation");
assert.match(html, /const SHOP_HISTORY_VIEWS=new Set\(\[[^\]]*"favorites"/ , "Favorites participates in saved route history");
assert.match(html, /function openProduct\(id,options=\{\}\)[\s\S]*?previousView=\["favorites"/, "opening a product from Favorites remembers the source page");
assert.match(html, /function prepareProductBackNavigation\([\s\S]*?"favorites"\]\.includes/, "Product Details can reveal Favorites underneath during Back navigation");
assert.match(html, /function goBackFromFavorites\(\)[\s\S]*?window\.history\.back\(\)/, "Favorites Back uses the existing page history when available");
assert.ok(html.includes('id="detailFavoriteButton"') && html.includes("toggleCurrentProductFavorite()"), "Product Details keeps its own favorite control");

const tick = String.fromCharCode(96);
assert.ok(html.includes("favorites:" + tick + "${FAVORITES_KEY}_${cloudAccount.id}" + tick), "cloud hydration restores favorites under the signed-in account key");
assert.ok(html.includes('outbox[key]={accountId:String(cloudAccount.id),remove:value===null}'), "cloud favorite writes are tagged to the active account");
assert.ok(api.includes('key.startsWith("shivan_shop_favorites_") ? "favorites"'), "the API recognizes the existing account-scoped favorite key");
assert.ok(api.includes("ON CONFLICT(account_id, key) DO UPDATE SET value=excluded.value") && api.includes(".bind(account.id, userKey, value, now())"), "the server stores favorites against the authenticated account id");

const saved = new Map();
const routeRenders = [];
const favoriteRenders = [];
const openedViews = [];
const countElement = { textContent: "" };
const sortControl = { value: "featured" };
const detailButton = {
  classes: new Set(),
  classList: { toggle(name, force) { if (force) detailButton.classes.add(name); else detailButton.classes.delete(name); } },
  attributes: new Map(),
  setAttribute(name, value) { detailButton.attributes.set(name, value); },
  textContent: "♡",
  title: "",
};
const elements = new Map([["detailFavoriteButton", detailButton], ["favoritesProductCount", countElement], ["favoritesSortControl", sortControl]]);
const context = vm.createContext({
  FAVORITES_KEY: "shivan_shop_favorites",
  currentUser: { id: "customer-a" },
  cloudAccount: { id: "customer-a" },
  currentProduct: { id: 11 },
  products: [
    { id: 11, name: "Purple Dress", price: 12000 },
    { id: 12, name: "Blue Coat", price: 18000 },
    { id: 13, name: "Black Skirt", price: 8000 },
  ],
  activeLanguage: "en",
  homeMenuFilterMode: "discount",
  currentCategory: "category",
  shopViewScrollPositions: new Map([["home", { windowY: 170, viewTop: 0, authTop: 0 }]]),
  localStorage: {
    getItem(key) { return saved.has(key) ? saved.get(key) : null; },
    setItem(key, value) { saved.set(String(key), String(value)); },
  },
  document: { getElementById(id) { return elements.get(id) || null; } },
  window: { history: { state: { __shivanShopView: "favorites" }, length: 2, backCalls: 0, back() { this.backCalls++; } }, scrollTo() {} },
  customerUiText(english) { return english; },
  getActiveShopView() { return context.activeRoute; },
  getProductPricing(product) { return { finalPrice: product.price }; },
  getProductName(product) { return product.name; },
  openView(view, options = {}) { openedViews.push({ view, options }); context.activeRoute = view; },
  renderVisibleProductGrid() { routeRenders.push(context.activeRoute); },
  renderProducts(list, target) { favoriteRenders.push({ ids: list.map(product => product.id), target }); },
  renderHomeLabels() {},
  renderCategoryButtons() {},
  writeShopViewHistory(view, options) { openedViews.push({ view, options }); },
  showToast() {},
});
context.activeRoute = "home";
vm.runInContext([
  block(html, "favoritesStorageKey"),
  block(html, "toggleFavorite"),
  block(html, "isFavorite"),
  block(html, "renderDetailFavoriteButton"),
  block(html, "toggleCurrentProductFavorite"),
  block(html, "sortHomeMenuProducts"),
  block(html, "setFavoritesSort"),
  block(html, "renderFavoritesPage"),
  block(html, "openHomeFavorites"),
  block(html, "goBackFromFavorites"),
  block(html, "exploreProductsFromFavorites"),
].join("\n"), context);

assert.equal(context.isFavorite(11), false, "a new customer starts with no saved favorites");
assert.equal(context.toggleFavorite(11), true, "tapping an outline heart adds the product immediately");
assert.equal(context.isFavorite("11"), true, "favorite ids remain stable when read as strings or numbers");
assert.equal(detailButton.textContent, "♥", "Product Details shows the filled heart for a saved product");
assert.equal(detailButton.attributes.get("aria-pressed"), "true", "Product Details exposes its saved state accessibly");
assert.equal(context.toggleFavorite("11"), false, "tapping the filled heart removes the product without duplicating ids");
assert.equal(context.isFavorite(11), false, "removal updates the saved state immediately");

assert.equal(context.toggleFavorite(11), true, "a removed product can be saved again");
for (const route of ["home", "search", "newModel", "discount", "favorites", "detail"]) {
  context.activeRoute = route;
  assert.equal(context.toggleFavorite(12), true, "add works from " + route);
  assert.equal(routeRenders.at(-1), route, "the active " + route + " view is re-rendered after a favorite change");
  assert.equal(context.isFavorite(12), true, "the same account sees one favorite state on " + route);
  assert.equal(context.toggleFavorite(12), false, "remove works from " + route);
}

context.activeRoute = "detail";
context.currentUser = { id: "customer-b" };
context.cloudAccount = { id: "customer-b" };
assert.equal(context.isFavorite(11), false, "a second customer cannot read the first customer's favorites");
assert.equal(context.toggleFavorite(22), true, "the second customer's favorite is stored separately");
context.currentUser = { id: "customer-a" };
context.cloudAccount = { id: "customer-a" };
assert.equal(context.isFavorite(11), true, "saved favorites persist in storage after a refresh");
assert.equal(context.isFavorite(22), false, "one account's favorites never appear for another account");
assert.equal(context.renderDetailFavoriteButton(), true, "restored account state updates the detail heart");
assert.equal(detailButton.textContent, "♥", "the detail heart remains consistent after account restoration");

const refreshContext = vm.createContext({ FAVORITES_KEY: "shivan_shop_favorites", currentUser: { id: "customer-a" }, cloudAccount: { id: "customer-a" }, localStorage: { getItem(key) { return saved.has(key) ? saved.get(key) : null; } } });
vm.runInContext(block(html, "favoritesStorageKey") + "\n" + block(html, "isFavorite"), refreshContext);
assert.equal(refreshContext.isFavorite(11), true, "favorite data survives a fresh page context");

context.activeRoute = "home";
context.homeMenuFilterMode = "discount";
context.currentCategory = "category";
assert.equal(context.openHomeFavorites(), true, "the Home heart opens Favorites successfully");
assert.equal(openedViews.at(-1).view, "favorites", "Favorites is a distinct route, not a Home filter");
assert.equal(context.homeMenuFilterMode, "discount", "opening Favorites leaves Home's selected catalog filter intact");
assert.equal(context.currentCategory, "category", "opening Favorites leaves Home's selected category intact");
assert.equal(countElement.textContent, "1 saved product", "the page count reflects the current account's actual catalog favorites");
assert.equal(favoriteRenders.at(-1).target, "favoritesProductsGrid", "the saved catalog renders into the dedicated Favorites grid");
assert.deepEqual(favoriteRenders.at(-1).ids, [11], "the page shows saved products only");

context.toggleFavorite(12);
context.toggleFavorite(13);
sortControl.value = "price-low";
assert.equal(context.setFavoritesSort("price-low"), true, "the Favorites sort control accepts a supported order");
assert.deepEqual(favoriteRenders.at(-1).ids, [13, 11, 12], "sorting uses the current IQD product prices");
assert.equal(countElement.textContent, "3 saved products", "the saved product count updates when favorites change");
assert.equal(context.setFavoritesSort("newest"), false, "unsupported sort modes are rejected");
assert.equal(context.goBackFromFavorites(), true, "the Favorites Back control returns through browser history");
assert.equal(context.window.history.backCalls, 1, "Back uses the existing Home-to-Favorites history entry");

context.activeRoute = "favorites";
assert.equal(context.exploreProductsFromFavorites(), true, "the empty-state action returns to Shop");
assert.equal(openedViews.at(-1).view, "home", "Explore Products opens the normal Home catalog");
assert.equal(context.homeMenuFilterMode, "all", "Explore Products restores the complete Home catalog");

console.log("Favorites checks passed: dedicated route, add/remove, saved count and sorting, Home return, refresh persistence, account isolation, cloud account scoping, and product-grid behavior.");
