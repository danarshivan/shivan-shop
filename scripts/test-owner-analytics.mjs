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

const names = [
  "ownerRecordDate", "ownerDateInputValue", "ownerLocalDateRange", "ownerAnalyticsRange", "ownerReportDateRange",
  "ownerCancelledOrder", "ownerConfirmedSalesOrder", "ownerPendingOrder", "ownerStoreMetrics", "ownerAnalyticsSeries",
  "ownerAnalyticsMetricCards", "ownerAnalyticsChartMarkup", "renderOwnerAnalytics", "renderOwnerReports",
];
const sources = names.map(functionSource).join("\n");
const dateAt = (day, hour = 12) => new Date(2026, 10, day, hour, 0, 0, 0).toISOString();
const data = {
  orders: [
    { id: "paid", createdAt: dateAt(2, 10), status: "لە چاوەڕوانی", paymentStatus: "PAID", total: 100, items: [{ productId: 1, qty: 2 }] },
    { id: "delivered", createdAt: dateAt(2, 14), status: "delivered", total: 200, items: [{ productId: 2, qty: 1 }] },
    { id: "pending", createdAt: dateAt(2, 15), status: "لە چاوەڕوانی", total: 900, items: [{ productId: 1, qty: 10 }] },
    { id: "cancelled", createdAt: dateAt(2, 16), status: "cancelled", paymentStatus: "PAID", total: 500, items: [{ productId: 2, qty: 8 }] },
    { id: "older", createdAt: new Date(2026, 9, 31, 10, 0, 0, 0).toISOString(), status: "completed", total: 50, items: [{ productId: 1, qty: 1 }] },
  ],
  accounts: [
    { id: "owner", role: "owner", identifier: "owner@example.test", createdAt: dateAt(2) },
    { id: "new", role: "customer", identifier: "new@example.test", createdAt: dateAt(2, 9) },
    { id: "old", role: "customer", identifier: "old@example.test", createdAt: new Date(2026, 9, 31, 10, 0, 0, 0).toISOString() },
  ],
  products: [{ id: 1, name: "Dress" }, { id: 2, name: "Jacket" }],
};
const baseline = JSON.stringify(data);
const frozenNow = new Date(2026, 10, 2, 18, 0, 0, 0);
const TestDate = class extends Date {
  constructor(...args) {
    if (args.length) super(...args);
    else super(frozenNow.getTime());
  }
  static now() { return frozenNow.getTime(); }
};
assert.equal(new TestDate().toISOString(), frozenNow.toISOString(), "the renderer clock stays fixed to the saved November 2 order fixtures");
const context = {
  Date: TestDate,
  OWNER_IDENTIFIER: "owner@example.test",
  ownerAnalyticsSelection: { period: "daily", date: "", month: "", year: "" },
  ownerDashboardText: value => value,
  escapeHtml: value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"),
  formatPrice: value => `IQD ${Number(value).toLocaleString("en-US")}`,
  getOrders: () => data.orders,
  getAccounts: () => data.accounts,
  getProductName: product => product.name,
  products: data.products,
  isOwner: () => true,
};
const runtime = runInNewContext(`${sources}\n({${names.join(",")}})`, context);
const now = new Date(2026, 10, 2, 18, 0, 0, 0);
const daily = runtime.ownerAnalyticsRange("daily", { date: "2026-11-02" }, now);
const metrics = runtime.ownerStoreMetrics(daily.start, daily.end);

assert.deepEqual(JSON.parse(JSON.stringify({
  totalOrders: metrics.totalOrders,
  confirmedOrders: metrics.confirmedOrders,
  pendingOrders: metrics.pendingOrders,
  cancelledOrders: metrics.cancelledOrders,
  sales: metrics.sales,
  unitsSold: metrics.unitsSold,
  newCustomers: metrics.newCustomers,
})), {
  totalOrders: 4, confirmedOrders: 2, pendingOrders: 1, cancelledOrders: 1,
  sales: 300, unitsSold: 3, newCustomers: 1,
}, "daily metrics count actual saved records and exclude pending/cancelled value from sales");
assert.equal(metrics.bestSellers[0].name, "Dress");
assert.equal(metrics.bestSellers[0].quantity, 2);
assert.equal(runtime.ownerConfirmedSalesOrder(data.orders[3]), false, "a cancellation overrides a stale paid marker");
assert.equal(runtime.ownerPendingOrder(data.orders[2]), true);

const monthly = runtime.ownerAnalyticsRange("monthly", { month: "2026-11" }, now);
assert.equal(runtime.ownerStoreMetrics(monthly.start, monthly.end).totalOrders, 4, "monthly selection includes the complete selected month");
const yearly = runtime.ownerAnalyticsRange("yearly", { year: "2026" }, now);
assert.equal(yearly.end.getMonth(), 11);
assert.equal(yearly.end.getDate(), 31);
assert.equal(runtime.ownerStoreMetrics(yearly.start, yearly.end).totalOrders, 5, "year selection includes the full final day");
const series = runtime.ownerAnalyticsSeries("daily", {}, daily, metrics.orders);
assert.equal(series.length, 24);
assert.equal(series[10].value, 100);
assert.equal(series[14].value, 200);
assert.equal(series[16].value, 0, "cancelled orders do not inflate chart sales");

const customInvalid = runtime.ownerReportDateRange({ preset: "custom", start: "2026-11-04", end: "2026-11-01" }, now);
assert.equal(customInvalid.valid, false, "reports reject an end date that precedes the start date");
assert.equal(runtime.ownerReportDateRange({ preset: "custom", start: "", end: "" }, now).valid, false, "custom reports require both dates instead of silently substituting today");
const report = runtime.ownerReportDateRange({ preset: "today" }, now);
assert.equal(runtime.ownerStoreMetrics(report.start, report.end).totalOrders, 4);

const analyticsBox = { innerHTML: "" };
runtime.renderOwnerAnalytics(analyticsBox, { period: "daily", date: "2026-11-02" });
assert.match(analyticsBox.innerHTML, /Sales Analytics/);
assert.match(analyticsBox.innerHTML, /ownerAnalyticsPeriod/);
assert.match(analyticsBox.innerHTML, /Best-selling products/);
assert.match(analyticsBox.innerHTML, /Confirmed sales by hour/);
assert.match(analyticsBox.innerHTML, /IQD 300/);
assert.match(html, /owner-analytics-controls label\[hidden\].*display:none!important/, "inactive analytics period controls stay hidden despite the control label layout styles");
const reportsBox = { innerHTML: "" };
runtime.renderOwnerReports(reportsBox, { preset: "today" });
assert.match(reportsBox.innerHTML, /This month/);
assert.match(reportsBox.innerHTML, /Date range/);
assert.match(reportsBox.innerHTML, /ownerReportStart/);
assert.match(reportsBox.innerHTML, /IQD 300/);
assert.equal(JSON.stringify(data), baseline, "analytics and reports do not mutate saved store records");

const protectedRuntime = runInNewContext(`${functionSource("renderOwnerAnalytics")}\n${functionSource("renderOwnerReports")}\n({renderOwnerAnalytics,renderOwnerReports})`, {
  isOwner: () => false,
  staffHasPermission: () => false,
  ownerAnalyticsSelection: { period: "daily", date: "", month: "", year: "" },
  ownerReportSelection: { preset: "month", start: "", end: "" },
});
for (const render of Object.values(protectedRuntime)) {
  const protectedBox = { textContent: "" };
  render(protectedBox);
  assert.match(protectedBox.textContent, /Reports permission is required/);
}

console.log("Owner analytics/report checks passed: daily/monthly/yearly ranges, date presets/custom validation, sales status accounting, saved-record totals, units, top products, customer counts, responsive chart markup, read-only behavior, and Owner gating.");
