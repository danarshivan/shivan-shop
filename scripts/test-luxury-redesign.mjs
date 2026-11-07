import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../luxury-theme.css", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");

assert.match(html, /<link rel="stylesheet" href="\/luxury-theme\.css">/, "the storefront loads the redesign stylesheet");
assert.ok(build.includes('"luxury-theme.css"'), "the production build copies the redesign stylesheet");
for (const token of ["--shivan-burgundy:#1b0610", "--shivan-plum:#2b0a1b", "--shivan-wine:#4a1029", "--shivan-pink:#ff9fc2"]) {
  assert.ok(css.includes(token), `the reference palette includes ${token}`);
}
for (const selector of [
  ".shop-startup-splash", ".shop-promo-onboarding", "#authPage.auth", ".topbar", ".hero", ".categories", ".products", ".detail-gallery",
  ".cart-item", ".order-card", ".profile-card", ".owner-admin-shell", ".owner-dashboard-banner", ".owner-product-editor",
  ".owner-category-manager", ".owner-orders-controls", ".owner-inventory-scroll", ".owner-settings-form", ".owner-staff-account-card",
  ".owner-smart-alert-panel", ".owner-customer-notifications", "[dir=\"rtl\"] .hero-overlay", "[dir=\"rtl\"] .owner-dashboard-nav-item.active",
]) assert.ok(css.includes(selector), `redesign styling covers ${selector}`);
assert.match(css, /@media\s*\(max-width:760px\)/, "mobile layout rules are present");
assert.match(css, /@media\s*\(min-width:900px\)/, "wide-screen layouts are present");
assert.match(css, /prefers-reduced-motion:reduce/, "the redesign respects reduced-motion preferences");
assert.match(css, /overflow:clip/, "the redesigned app frame prevents accidental horizontal overflow");

const homeStart = html.indexOf('<div id="homeView"');
const searchStart = html.indexOf('<!-- SEARCH -->', homeStart);
assert.ok(homeStart >= 0 && searchStart > homeStart, "the home screen has a distinct redesigned section");
const homeMarkup = html.slice(homeStart, searchStart);
assert.match(homeMarkup, /shop-discovery-header/, "the storefront has a branded discovery header");
assert.match(homeMarkup, /shop-brand-lockup/, "the redesigned home header contains one dynamic Shivan Shop wordmark");
assert.match(homeMarkup, /id="homeBackButton"[^>]*onclick="goBackFromHome\(\)"/, "the compact Home header has a functioning Back control");
assert.match(homeMarkup, /id="homeNotificationsButton"[^>]*onclick="openCustomerNotifications\(\)"/, "the Home header keeps a notification entry point");
assert.match(homeMarkup, /<div class="logo-small"[^>]*><svg[^>]*viewBox="0 0 48 44"/, "the Home wordmark uses the Shivan crown mark");
assert.doesNotMatch(homeMarkup, /shop-discovery-profile|DISCOVER YOUR STYLE|THE SHIVAN EDIT|New Arrivals/, "the obsolete Home header and editorial labels are removed");
assert.doesNotMatch(html, /<header class="topbar">/, "the legacy duplicate global header is removed");
assert.match(homeMarkup, /shop-category-shelf/, "categories are presented as a dedicated discovery shelf");
assert.match(homeMarkup, /id="homeCategoryToggle"[^>]*onclick="toggleHomeCategories\(\)"/, "the category grid can expand without replacing its real categories");
assert.match(homeMarkup, /id="homeProductsToggle"[^>]*onclick="showAllHomeProducts\(\)"/, "Trending Now keeps a working See All action");
assert.match(homeMarkup, /id="shopProductsHeading">باوترین بەرهەم/, "the obsolete New Arrivals title is replaced by Trending Now");
assert.match(homeMarkup, /shop-product-shelf/, "the real product catalog has its own collection section");
assert.doesNotMatch(homeMarkup, /images\.unsplash\.com/, "the storefront does not hardcode mock fashion imagery");
const homeCategoryRendererStart = html.indexOf("function renderCategoryButtons(){");
const homeCategoryRendererEnd = html.indexOf("function ownerCategoryOptions(", homeCategoryRendererStart);
const homeCategoryRenderer = html.slice(homeCategoryRendererStart, homeCategoryRendererEnd);
assert.match(homeCategoryRenderer, /getAllCategories\(\)/, "Home category tiles come from saved and real product categories");
assert.match(homeCategoryRenderer, /allCategories\.slice\(0,4\)/, "the default category shelf displays four compact tiles");
assert.match(homeCategoryRenderer, /products\.find\(product=>product\.category===category&&product\.image\)/, "category imagery comes from real catalog photos");
assert.match(html, /function renderHomeLabels\(\)[\s\S]*?customerUiText\("Categories"[\s\S]*?customerUiText\("Trending Now"/, "Home labels support Kurdish, Arabic, and English");
assert.match(html, /function renderHomeLabels\(\)[\s\S]*?profileOwnerDashboardLabel[\s\S]*?customerUiText\("Owner Dashboard"/, "the Profile Owner entry follows the selected language");
assert.match(html, /function renderHomeAdvertisements\(\)[\s\S]*?advertisementsFromCatalog\?products\.filter\(product=>product&&product\.image\)[\s\S]*?productDiscountPercent\(product\)[\s\S]*?New Collection/, "the Home promotion uses real banners or real product photos and only configured discounts");
assert.match(html, /function openCustomerNotifications\(\)[\s\S]*?openView\("profile"\)/, "the notification bell uses the existing customer Profile preferences");
assert.match(html, /id="profileOwnerDashboardEntry"[^>]*hidden/, "the Owner workspace entry is hidden by default in Profile");
assert.match(html, /function openOwnerDashboardFromProfile\(\)[\s\S]*?if\(!isOwner\(\)&&!isStaffSession\(\)\)[\s\S]*?openView\("owner"\)/, "Profile access checks the authenticated Owner or staff session and keeps the existing route guard");
assert.match(html, /function updateProfile\(\)[\s\S]*?profileOwnerEntry\.hidden=!canOpenOwnerWorkspace/, "the Owner Profile entry is shown only for an authorized session");
assert.match(html, /id="shopTagline" aria-hidden="true"/, "the saved store tagline binding remains available without cluttering Home");
const bottomNavStart = html.indexOf('<nav class="bottom-nav">');
const bottomNavEnd = html.indexOf("</nav>", bottomNavStart);
const bottomNavMarkup = html.slice(bottomNavStart, bottomNavEnd);
assert.deepEqual([...bottomNavMarkup.matchAll(/id="(navHome|navSearch|navCart|navOrders|navProfile)"/g)].map(([, id]) => id), ["navHome", "navSearch", "navCart", "navOrders", "navProfile"], "the five customer destinations remain Shop, Search, Cart, Orders, and Profile");
assert.match(css, /\.bottom-nav:not\(\.owner-mode\)\s*#ownerPanelButton[^}]*display:none!important/, "the Owner tab is hidden in the customer bottom navigation");
assert.match(css, /\.bottom-nav:not\(\.owner-mode\)\s*\{grid-template-columns:repeat\(5,minmax\(0,1fr\)\)\}/, "customer bottom navigation has exactly five columns");
assert.match(css, /#mainApp #homeView #categoryButtons\{display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, "the Home categories use a four-tile mobile grid");
assert.match(css, /#mainApp #homeView #productsGrid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "Trending Now uses a two-column phone product grid");
assert.match(css, /#mainApp #homeView \.shop-home-promo\{width:100%;height:clamp\(166px,46vw,210px\)/, "the Home banner stays compact at phone sizes");
assert.match(html, /id="ordersView" class="view page shop-orders-view"/, "customers have a dedicated Orders screen");
assert.match(html, /id="navOrders"/, "the shopping navigation includes Orders");
assert.match(html, /const SHOP_HISTORY_VIEWS=new Set\(\["home","search","cart","orders","profile","owner"\]\)/, "Orders participates in the existing browser history state model");
assert.match(html, /function openOrdersFromNavigation\(\)[\s\S]*?openView\("orders"\)/, "customer Orders navigation opens the authenticated Orders view");
assert.match(html, /function resumeAuthenticationIntent\(\)[\s\S]*?intent\.type==="cart"\|\|intent\.type==="orders"\|\|intent\.type==="profile"/, "sign-in resumes a pending Orders destination");
const productRendererStart = html.indexOf("function renderProducts(list, target=\"productsGrid\", append=false){");
const productRendererEnd = html.indexOf("function renderVisibleProductGrid(){", productRendererStart);
assert.ok(productRendererStart >= 0 && productRendererEnd > productRendererStart, "the shared product card renderer is present");
const productRenderer = html.slice(productRendererStart, productRendererEnd);
assert.match(productRenderer, /product-image-open/, "product cards provide an accessible image-to-detail action");
assert.match(productRenderer, /renderProductPricing\(p\)/, "product cards display live store pricing");
assert.match(productRenderer, /quickAdd\(\$\{p\.id\}\)/, "product cards keep the existing quick-add behavior");
assert.match(productRenderer, /data-product-name-id/, "product card names continue to follow the selected language");
assert.match(html, /owner-dashboard-banner owner-dashboard-masthead/, "the Owner dashboard has the new store identity masthead");
assert.match(html, /owner-product-editor-intro/, "the three-tab product editor has a redesigned overview");
assert.match(html, /shopBrandName/, "the new branded header keeps the saved store name binding");
assert.match(html, /shopTagline/, "the new branded header keeps the saved store tagline binding");
for (const selector of [
  ".shop-discovery-header", ".shop-editorial-hero", ".shop-category-shelf", ".product-image-open", ".cart-shopping-layout",
  ".customer-order-card", ".shop-profile-identity", ".detail-toolbar-brand", ".owner-dashboard-masthead", ".owner-product-editor-intro",
  ".shop-brand-lockup", ".shop-header-icon", ".owner-quick-actions", ".owner-management-grid", ".owner-product-tab-panel", ".owner-photo-list"
]) assert.ok(css.includes(selector), `screen composition styling covers ${selector}`);
assert.match(css, /\.bottom-nav\.owner-mode #navSearch,\.bottom-nav\.owner-mode #navCart/, "Owner navigation retains its five primary destinations without changing customer navigation");
assert.match(css, /@media\s*\(max-width:430px\)/, "the redesign has narrow-phone layout rules");

const detailStart = html.indexOf('<div id="detailView"');
const detailEnd = html.indexOf('<!-- BOTTOM NAV -->', detailStart);
assert.ok(detailStart >= 0 && detailEnd > detailStart, "the customer Product Details screen is present");
const detailMarkup = html.slice(detailStart, detailEnd);
assert.ok(detailMarkup.indexOf('id="detailGallery"') < detailMarkup.indexOf('class="detail-summary"'), "product information remains directly after the image gallery");
assert.ok(detailMarkup.indexOf('id="detailName"') < detailMarkup.indexOf('id="detailPrice"'), "the product name precedes the current and original price display");
assert.ok(detailMarkup.indexOf('class="detail-actions-row"') < detailMarkup.indexOf('id="detailReviewSummary"'), "purchase controls stay in document flow before Reviews");
assert.match(html, /getElementById\("detailPrice"\)\.innerHTML=renderProductPricing\(p,\{badge:true\}\)/, "Product Details retains the real price, original price, and discount renderer");
assert.match(css, /#mainApp\.detail-mode #detailView\.active \.detail-toolbar\{[^}]*width:calc\(100% - 112px\)/, "the iPhone toolbar reserves space for the independent Language control");
assert.match(css, /body:has\(#mainApp\.detail-mode\)>\.language-switcher/, "the Language control is compacted and separated while Product Details is open");
assert.match(css, /#mainApp #detailView\.active \.detail-gallery \.detail-image\{[^}]*object-fit:contain/, "the Product Details image uses its original aspect ratio without stretching");
assert.match(css, /#mainApp #detailView\.active \.detail-gallery\{width:calc\(100% \+ 24px\);height:clamp\(240px,42svh,340px\)/, "the iPhone product gallery has a shorter viewport-aware height");
assert.match(css, /#mainApp #detailView\.active \.detail-actions-row\{position:static;inset:auto;z-index:auto;/, "Add to Cart and quantity controls no longer stick over product content");
assert.match(css, /#mainApp #detailView\.active \.detail-options #sizeOptions \.option\.active/, "size selection has a clear selected state");
assert.match(css, /#mainApp #detailView\.active \.detail-options #colorOptions \.detail-color-option\.active/, "color selection has a clear selected state");
assert.match(css, /#mainApp #detailView\.active \.detail-recommendation-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/, "recommended products use a two-column phone grid");
assert.match(css, /@media\(min-width:1100px\)[\s\S]*?detail-recommendation-grid\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/, "recommended product cards expand responsively on desktop");

let depth = 0;
for (const character of css) {
  if (character === "{") depth += 1;
  if (character === "}") depth -= 1;
  assert.ok(depth >= 0, "stylesheet braces never close before they open");
}
assert.equal(depth, 0, "stylesheet blocks are balanced");

console.log("Luxury redesign checks passed: premium screen composition, real catalog presentation, dedicated Orders navigation, responsive Product Details and purchase controls, all-screen styling, RTL rules, reduced motion, and production asset copy.");
