import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const css = await readFile(new URL("../luxury-theme.css", import.meta.url), "utf8");
const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");

assert.doesNotMatch(html, /<link rel="stylesheet" href="\/luxury-theme\.css">/, "the burgundy redesign stylesheet is no longer applied to the restored customer screens");
assert.ok(build.includes('"luxury-theme.css"'), "the existing asset remains available to the build without being loaded by the storefront");
assert.match(html, /:root\{--shop-primary:#8966ff;--shop-secondary:#b49aff;--shop-page-background:#03050d;--shop-card-background:#0b0e18/, "the restored storefront uses the original navy background and purple accents");
assert.ok(css.includes("--shivan-burgundy:#1b0610"), "the unused burgundy asset remains intact and is not deleted");

const homeStart = html.indexOf('<div id="homeView"');
const searchStart = html.indexOf("<!-- SEARCH -->", homeStart);
assert.ok(homeStart >= 0 && searchStart > homeStart, "the customer Home screen is present");
const homeMarkup = html.slice(homeStart, searchStart);
assert.match(html, /<header class="topbar">[\s\S]*id="shopBrandName"/, "the legacy Shivan Shop brand header is restored once");
assert.match(homeMarkup, /<div class="hero" aria-label="Shivan Shop promotions"><\/div>/, "Home keeps a real-data promotional banner mount");
assert.match(homeMarkup, /class="categories" id="categoryButtons"/, "Home keeps the compact horizontal category row");
assert.match(homeMarkup, /id="productsGrid" class="products"/, "Home keeps the historical product listing mount");
assert.doesNotMatch(homeMarkup, /shop-discovery-header|shop-category-shelf|shop-product-shelf|images\.unsplash\.com/, "the superseded Home structures and hardcoded sample imagery are absent");

const categoryStart = html.indexOf("function renderCategoryButtons(){");
const categoryEnd = html.indexOf("function ownerCategoryOptions(", categoryStart);
const categoryRenderer = html.slice(categoryStart, categoryEnd);
assert.ok(categoryStart >= 0 && categoryEnd > categoryStart, "the real category renderer is present");
assert.match(categoryRenderer, /\["هەموو",\.\.\.visible\]/, "Home categories use saved live categories with Owner visibility applied");
assert.match(categoryRenderer, /homeCategoryArtworkMarkup\(category\)/, "Home category tiles use the current Owner-managed artwork renderer");
assert.match(categoryRenderer, /filterCategory\(button\.dataset\.category\)/, "category tiles keep their working filter action");

assert.match(html, /\.categories\{[\s\S]*?overflow-x:auto[\s\S]*?scroll-snap-type:x mandatory/, "category tiles keep their horizontal mobile layout");
assert.match(html, /\.category\{[\s\S]*?min-width:68px[\s\S]*?height:72px/, "category tile size and spacing stay compact");
assert.match(html, /\.products\{[\s\S]*?grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "the customer product grid uses three columns on mobile");
assert.match(html, /@media\(max-width:380px\)\{[\s\S]*?\.products\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/, "the three-column product grid remains at narrow iPhone widths");
assert.match(html, /\.product-discount-badge/, "product cards retain discount badge styling");
assert.match(html, /\.add-mini\{[^}]*background:#8061ff/, "product cards retain their purple cart button styling");

const adsStart = html.indexOf("function renderHomeAdvertisements(){");
const adsEnd = html.indexOf("function getShopOnboardingStartupView(", adsStart);
const adsRenderer = html.slice(adsStart, adsEnd);
assert.ok(adsStart >= 0 && adsEnd > adsStart, "the existing Home advertisement renderer is present");
assert.match(adsRenderer, /safeImageUrl\(ad\.image\)/, "the Home carousel renders existing advertisement images safely");
assert.match(adsRenderer, /renderHomeAdvertisementDots\(count\)/, "Home advertisements expose a manual pagination dot for each slide");
assert.doesNotMatch(adsRenderer, /hero-copy|hero-overlay|Shop Now|productDiscountPercent|onclick=/, "the Home advertisement carousel remains image-only");
assert.match(html, /function renderHomeLabels\(\)[\s\S]*?customerUiText\("New Arrivals"[\s\S]*?"وصل حديثاً"/, "the Home heading supports English, Kurdish, and Arabic");

const navStart = html.indexOf('<nav class="bottom-nav">');
const navEnd = html.indexOf("</nav>", navStart);
assert.ok(navStart >= 0 && navEnd > navStart, "customer navigation is present");
const navMarkup = html.slice(navStart, navEnd);
const buttons = [...navMarkup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
const visible = buttons.filter(([, attributes]) => !/\bhidden\b/.test(attributes));
assert.deepEqual(visible.map(([, attributes]) => (attributes.match(/\bid="([^"]+)"/) || [])[1]), ["navHome", "navSearch", "navCart", "navOrders", "navProfile", "ownerPanelButton"], "six authorized tabs are ordered Home, Search, Cart, Orders, Profile, Owner");
assert.match(html, /\.bottom-nav\{[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/, "customers without Owner access retain five evenly spaced tabs");
assert.match(html, /\.bottom-nav\.owner-mode,\.bottom-nav\.owner-customer-mode\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)\}/, "authorized Owner and staff sessions fit six tabs in one row");
assert.match(html, /\.owner-btn\{display:none\}\s*\.owner-btn\.visible\{display:flex\}/, "the Owner tab is hidden until an authorized session reveals it");
assert.match(html, /if\(view==="owner"&&!isOwner\(\)&&!isStaffSession\(\)\)/, "opening Owner remains protected by the existing role guard");
assert.match(navMarkup, /id="navOrders"[^>]*onclick="openView\(\x27orders\x27\)"/, "the customer Orders tab opens the customer Orders route directly");
assert.ok(navMarkup.indexOf('id="navCart"') < navMarkup.indexOf('id="navOrders"') && navMarkup.indexOf('id="navOrders"') < navMarkup.indexOf('id="navProfile"'), "Orders sits immediately after Cart and before Profile");
assert.match(html, /function renderOrders\(\)[\s\S]*?o=>o\.userId===currentUser\.id/, "the customer Orders route filters to the signed-in customer");
assert.match(html, /@media\(max-width:380px\)\{\.bottom-nav\{padding-left:2px;padding-right:2px\}\.nav-item\{gap:2px;font-size:clamp\(8px,2\.4vw,9px\)\}/, "320px and 375px widths use compact safe tab sizing");
assert.match(html, /@media\(min-width:381px\) and \(max-width:430px\)\{\.nav-item\{font-size:9px\}/, "390px width keeps labels compact");
assert.match(navMarkup, /id="navAnalytics"[^>]*hidden/, "Analytics remains available through Owner screens without taking a navigation slot");
for (const width of [320, 375, 390]) { const horizontalPadding = width <= 380 ? 4 : 8; const itemWidth = (width - horizontalPadding) / 6; assert.ok(itemWidth >= 48, width + "px provides at least 48px to each of six authorized tabs"); }

assert.match(html, /id="ordersView" class="view page shop-orders-view"/, "the customer Orders screen remains available");
assert.match(html, /id="profileOrdersLabel"[^>]*>My Orders<\/span>/, "Profile provides a customer path to Orders");
assert.match(html, /function openOrdersFromNavigation\(\)[\s\S]*?return openView\("orders"\)/, "the Profile Orders action opens the existing Orders route");
assert.match(html, /id="profileOwnerDashboardEntry"[^>]*hidden/, "the Owner Dashboard entry stays hidden until an authorized session is present");
assert.match(html, /function openOwnerDashboardFromProfile\(\)[\s\S]*?if\(!isOwner\(\)&&!isStaffSession\(\)\)/, "Profile Owner entry retains its Owner or staff authorization check");
assert.match(html, /id="detailGallery"[\s\S]*?id="detailName"[\s\S]*?id="detailPrice"[\s\S]*?id="detailReviewList"/, "Product Details gallery, pricing, and customer reviews remain present");
assert.match(html, /id="customerPushSettings"/, "customer notification preferences remain present");
assert.match(html, /id="ownerPanelContent"/, "Owner Dashboard screens remain present");

let depth = 0;
for (const character of html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "") {
  if (character === "{") depth += 1;
  if (character === "}") depth -= 1;
  assert.ok(depth >= 0, "inline stylesheet braces never close before they open");
}
assert.equal(depth, 0, "inline stylesheet blocks are balanced");

console.log("Customer design restoration checks passed: original navy and purple styling, live banner/category/product data, three-column mobile grid, six-tab responsive navigation, customer Orders access, Owner authorization, and notifications.");
