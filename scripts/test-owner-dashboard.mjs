import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functionSource = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`function ${escaped}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected function ${name} to exist`);
  return match[0];
};

const requiredFunctions = [
  "ownerDashboardText", "ownerPanelRoute", "ownerDashboardNavItems", "ownerDashboardShellMarkup",
  "ownerCancelledOrder", "ownerConfirmedSalesOrder", "ownerPendingOrder", "ownerDashboardStats", "ownerActiveTimedOfferCount",
  "renderOwnerDashboard", "renderOwnerCustomers",
];
const sources = requiredFunctions.map(functionSource).join("\n");
const now = Date.parse("2026-11-02T18:00:00.000Z");
const sourceData = {
  orders: [
    { id: "delivered", total: 500, status: "گەهشت" },
    { id: "paid", total: 900, paymentStatus: "PAID" },
    { id: "pending", total: 1000, status: "لە چاوەڕوانی" },
  ],
  products: [
    { id: 1, discount: 20, discountTimerEnabled: true, discountEndsAt: "2099-11-02T18:00:00.000Z" },
    { id: 2, discount: 10, discountTimerEnabled: true, discountEndsAt: new Date(now - 60000).toISOString() },
    { id: 3, discount: 0, discountTimerEnabled: true, discountEndsAt: new Date(now + 60000).toISOString() },
    { id: 4 },
  ],
  accounts: [
    { id: "owner", role: "owner", identifier: "owner@example.test" },
    { id: "a", role: "customer", identifier: "a@example.test", name: "A Customer", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "b", role: "customer", identifier: "5550001", name: "B Customer" },
  ],
  categories: ["Dresses", "Outerwear", "Accessories"],
};
const baseline = JSON.stringify(sourceData);
const context = {
  activeLanguage: "en",
  ownerAnalyticsSelection: { period: "daily", date: "", month: "", year: "" },
  ownerReportSelection: { preset: "month", start: "", end: "" },
  OWNER_IDENTIFIER: "owner@example.test",
  isOwner: () => true,
  products: sourceData.products,
  ownerAppearance: { storeName: "Shivan Shop Test" },
  getOrders: () => sourceData.orders,
  getAccounts: () => sourceData.accounts,
  getAllCategories: () => sourceData.categories,
  productDiscountPercent: product => Number(product.discount) >= 1 && Number(product.discount) <= 99 ? Number(product.discount) : 0,
  formatPrice: value => `IQD ${value}`,
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
};
const runtime = runInNewContext(`${sources}\n({${requiredFunctions.join(",")}})`, context);

assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerDashboardStats())), {
  orders: 3, products: 4, categories: 3, customers: 2, sales: 1400, confirmedOrders: 2,
}, "dashboard statistics are calculated from saved orders, products, categories, and customer accounts");
assert.equal(runtime.ownerActiveTimedOfferCount(now), 1, "only discounted offers with a future end time are counted as active");
assert.equal(runtime.ownerConfirmedSalesOrder({ status: "لە چاوەڕوانی", total: 100 }), false, "pending orders are not counted as confirmed sales");
assert.equal(runtime.ownerConfirmedSalesOrder({ paymentStatus: "PAID", total: 100 }), true, "paid orders count as confirmed sales");

assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("categories"))), { panel: "products", nav: "categories" }, "Categories opens the existing category manager");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("colors"))), { panel: "appearance", nav: "colors", focus: "ownerAppearanceForm" }, "Colors & Font opens the existing appearance editor");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("store-settings"))), { panel: "appearance", nav: "store-settings", focus: "ownerAppearanceForm" }, "Store Settings reuses the existing store appearance editor");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("backup"))), { panel: "appearance", nav: "backup", focus: "ownerBackupSync" }, "Backup & Sync opens the existing backup controls");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("analytics"))), { panel: "analytics", nav: "analytics" }, "Analytics opens its owner-only report view");
assert.deepEqual(JSON.parse(JSON.stringify(runtime.ownerPanelRoute("discounts"))), { panel: "products", nav: "discounts" }, "Discounts reuse the existing product editor and stored settings");

const dashboard = { innerHTML: "" };
runtime.renderOwnerDashboard(dashboard);
assert.match(dashboard.innerHTML, /Shivan Shop Test/);
assert.match(dashboard.innerHTML, /IQD 1400/);
assert.match(dashboard.innerHTML, /Create Discount/);
assert.match(dashboard.innerHTML, /Create Ad/);
assert.match(dashboard.innerHTML, /Limited-Time Discount/);
assert.match(dashboard.innerHTML, /Create Offer/);
assert.match(dashboard.innerHTML, /1 active timed offer/);

const customers = { innerHTML: "" };
runtime.renderOwnerCustomers(customers);
assert.match(customers.innerHTML, /A Customer/);
assert.match(customers.innerHTML, /a@example\.test/);
assert.match(customers.innerHTML, /B Customer/);
assert.doesNotMatch(customers.innerHTML, /owner@example\.test/);

const shell = runtime.ownerDashboardShellMarkup();
assert.match(shell, /class="owner-sidebar"/);
assert.match(shell, /id="ownerMobileNavigation"/);
assert.match(shell, /id="ownerMobileToolbar" class="owner-mobile-toolbar" hidden/, "mobile section navigation starts hidden on the Dashboard");
assert.doesNotMatch(shell, /owner-visit-mobile/, "the redundant mobile Visit Store button is removed");
assert.match(shell, /Visit Store/);
for (const label of ["Dashboard", "Product List", "Categories", "Discounts &amp; Offers", "Orders", "Customers", "Colors &amp; Font", "QR Code", "Analytics", "Reports", "Backup &amp; Sync", "Store Settings"]) {
  assert.ok(shell.includes(label), `desktop and mobile navigation should expose ${label}`);
}

assert.match(html, /@media\(max-width:760px\)\{\.owner-admin-shell\{display:block\}/, "the dashboard switches from a sidebar to compact mobile navigation");
assert.match(html, /@media\(prefers-reduced-motion:reduce\)\{\.owner-dashboard-nav-item/, "dashboard controls respect reduced motion");
const ownerViewMarkup = html.match(/<!-- OWNER -->([\s\S]*?)<!-- PRODUCT DETAIL -->/)?.[1];
assert.ok(ownerViewMarkup, "the Owner view markup is present");
assert.doesNotMatch(ownerViewMarkup, /owner-view-head|Store management|openView\('profile'\)/, "the visible Store management heading and Back button are removed");
assert.match(functionSource("renderOwnerPanel"), /mobileToolbar\.hidden=route\.panel==="dashboard"/, "mobile route navigation remains available on Owner subpages but is hidden on the Dashboard");
assert.match(html, /\.owner-mobile-toolbar\[hidden\]\{display:none!important\}/, "the Dashboard toolbar stays hidden at mobile breakpoints");
assert.match(functionSource("renderOwnerPanel"), /if\(!isOwner\(\)\)/, "dashboard sections remain Owner-only");
assert.match(functionSource("renderOwnerPanel"), /renderOwnerProducts\(sectionBox\)[\s\S]*?renderOwnerAds\(sectionBox\)[\s\S]*?renderOwnerOrders\(sectionBox\)[\s\S]*?renderOwnerInventory\(sectionBox\)[\s\S]*?renderOwnerAppearance\(sectionBox\)/, "existing product, ad, order, QR, and appearance editors remain connected");
assert.match(html, /id="ownerBackupSync"/, "Backup & Sync points to the existing backup controls");
assert.equal(JSON.stringify(sourceData), baseline, "dashboard rendering and statistics do not mutate store records");

const protectedRuntime = runInNewContext(`${functionSource("renderOwnerDashboard")}\n${functionSource("renderOwnerCustomers")}\n({renderOwnerDashboard,renderOwnerCustomers})`, {
  isOwner: () => false,
});
for (const render of Object.values(protectedRuntime)) {
  const protectedBox = { textContent: "" };
  render(protectedBox);
  assert.match(protectedBox.textContent, /Only the store owner/);
}

console.log("Owner dashboard regression checks passed: real statistics, active offers, customer filtering, existing section routes, mobile navigation, reduced motion, and read-only rendering.");
