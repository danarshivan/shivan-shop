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

const orderHelpers = [
  "ownerOrderStatusCategory", "ownerOrderCategoryLabel", "ownerOrderDisplayStatus", "ownerOrderDateValue", "ownerOrderDateTime",
  "ownerOrderProductImage", "ownerOrderImageMarkup", "ownerOrderStatusBadge", "ownerOrderStatusOptions", "ownerOrderStatusSelect",
  "ownerOrderAddress", "ownerOrderDetailMarkup", "ownerOrderCardMarkup", "ownerOrderFilteredOrders", "ownerOrderMetrics",
  "updateOwnerOrdersFilter", "setOwnerOrdersTab", "applyOwnerOrdersFilters", "openOwnerOrderDetail", "renderOwnerOrders", "updateOrderStatus",
].map(name => `${name === "updateOrderStatus" ? "async " : ""}${functionSource(name)}`).join("\n");

const records = [
  { id: "S100", name: "A Customer", phone: "+9647500000100", city: "Erbil", area: "Center", address: "Erbil, Center", paymentMethod: "cash", total: 12000, status: "گەهشت", date: "2026-10-29", createdAt: "2026-10-29T11:30:00.000Z", items: [{ productId: 1, name: "Purple Dress", image: "/api/media/shop/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", colorName: "Violet", size: "M", qty: 1, price: 12000 }, { productId: 2, name: "Scarf", color: "Black", size: "One Size", qty: 1, price: 0 }] },
  { id: "S101", name: "B Customer", phone: "+9647500000101", address: "Duhok, Center", paymentMethod: "visa", total: 5000, status: "هاتە ناردن", date: "2026-10-31", createdAt: "2026-10-31T11:30:00.000Z", items: [{ productId: 2, name: "Coat", image: "https://images.example.test/coat.webp", color: "#000000", size: "L", qty: 2, price: 2500 }] },
  { id: "S102", name: "C Customer", phone: "+9647500000102", address: "Erbil", paymentMethod: "cash", total: 10000, status: "لە چاوەڕوانی", date: "2026-11-01", createdAt: "2026-11-01T11:30:00.000Z", items: [{ productId: 1, name: "Dress", color: "Red", size: "S", qty: 1, price: 10000 }] },
  { id: "S103", name: "D Customer", phone: "+9647500000103", total: 9000, status: "هەڵوەشاندنەوە", date: "2026-11-02", createdAt: "2026-11-02T11:30:00.000Z", items: [] },
];
const baselineRecords = JSON.stringify(records);
const cards = records.map(order => ({
  dataset: {
    orderSearch: [order.id, order.name, order.phone].join(" ").toLocaleLowerCase(),
    orderCategory: /cancel|canceled|cancelled|هەڵوەشاندنەوە|ملغي|إلغاء/i.test(order.status) ? "cancelled" : /گەهشت|delivered|complete|completed|fulfilled/i.test(order.status) ? "completed" : /پێچرا|هاتە ناردن|process|ship|transit|dispatched/i.test(order.status) ? "processing" : "new",
    orderStatusValue: order.status,
    orderDate: `${new Date(order.createdAt).getFullYear()}-${String(new Date(order.createdAt).getMonth() + 1).padStart(2, "0")}-${String(new Date(order.createdAt).getDate()).padStart(2, "0")}`,
  },
  hidden: false,
}));
const tabButtons = ["all", "new", "processing", "completed", "cancelled"].map(tab => ({ dataset: { ownerOrderTab: tab }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
const emptyState = { hidden: true };
const resultState = { textContent: "" };
const workspace = {
  innerHTML: "",
  querySelectorAll(selector) {
    if (selector === "[data-owner-order-card]") return cards;
    if (selector === "[data-owner-order-tab]") return tabButtons;
    return [];
  },
  querySelector(selector) {
    if (selector === "[data-owner-orders-empty]") return emptyState;
    if (selector === "[data-owner-orders-results]") return resultState;
    return null;
  },
};
const savedWrites = [];
const notices = [];
let confirmResult = true;
let confirmOptions = null;
let flushResult = true;
let flushCalls = 0;
let renderCalls = 0;
let currentOwner = true;
const context = {
  activeLanguage: "en",
  records,
  products: [{ id: 1, name: "Purple Dress", image: "/api/media/shop/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp" }, { id: 2, name: "Coat", image: "/api/media/shop/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.webp" }],
  ownerOrdersSelection: { tab: "all", query: "", status: "", date: "" },
  ownerOrderDetailId: "",
  ownerOrderStatusSavingId: "",
  ownerPanel: "orders",
  ownerNavigationLedger: { updates: [], updateContext(value) { this.updates.push(value); } },
  isOwner: () => currentOwner,
  getOrders: () => records,
  ownerCancelledOrder: order => /cancel|canceled|cancelled|هەڵوەشاندنەوە|ملغي|إلغاء/i.test(String(order?.status || "")),
  ownerConfirmedSalesOrder: order => !/cancel|canceled|cancelled|هەڵوەشاندنەوە|ملغي|إلغاء/i.test(String(order?.status || "")) && (String(order?.paymentStatus || "").toUpperCase() === "PAID" || /گەهشت|delivered|completed|complete/i.test(String(order?.status || ""))),
  ownerDashboardText: (en, ku = en, ar = en) => context.activeLanguage === "ar" ? ar : context.activeLanguage === "ku" ? ku : en,
  ownerRecordDate: order => {
    const value = order?.createdAt || order?.created_at || order?.date;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  },
  ownerDateInputValue: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
  safeImageUrl: value => /^(https?:\/\/|data:image\/|\/api\/media\/)/i.test(String(value || "")) ? String(value) : "",
  getCartItemName: item => String(item?.name || context.products.find(product => String(product.id) === String(item?.productId))?.name || "Item"),
  renderOrderItemPrice: item => `IQD ${Number(item?.price) || 0}`,
  paymentMethodLabel: method => ({ cash: "Cash", visa: "Visa", fib: "FIB" }[method] || ""),
  formatPrice: value => `IQD ${Number(value).toLocaleString("en-US")}`,
  escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char])),
  translateText: value => String(value ?? ""),
  safeReceiptUrl: value => String(value || "").startsWith("/api/media/receipts/") ? String(value) : "",
  localStorage: { setItem(key, value) { savedWrites.push({ key, value }); } },
  ORDERS_KEY: "shivan_shop_orders",
  cloudMode: true,
  cloudAccount: { role: "owner" },
  flushCloudWrites: async () => { flushCalls++; return flushResult; },
  showOwnerConfirm: async (_message, options) => { confirmOptions = options; return confirmResult; },
  showToast: message => notices.push(String(message)),
  renderOrders: () => {},
  renderOwnerPanel: () => { renderCalls++; return true; },
  ownerNavigationRestoring: false,
  document: {
    getElementById(id) { return id === "ownerOrdersWorkspace" ? workspace : null; },
  },
};
const functionNames = Object.keys(context).filter(name => typeof context[name] === "function");
const wrapped = runInNewContext(`
  let ownerOrdersSelection={tab:"all",query:"",status:"",date:""}, ownerOrderDetailId="", ownerOrderStatusSavingId="", ownerPanel="orders";
  ${orderHelpers}
  ({${functionNames.join(",")},
    ownerOrderStatusCategory,ownerOrderCategoryLabel,ownerOrderDisplayStatus,ownerOrderDateValue,ownerOrderDateTime,
    ownerOrderDetailMarkup,ownerOrderCardMarkup,ownerOrderFilteredOrders,ownerOrderMetrics,updateOwnerOrdersFilter,setOwnerOrdersTab,
    applyOwnerOrdersFilters,openOwnerOrderDetail,renderOwnerOrders,updateOrderStatus,
    get selection(){return {...ownerOrdersSelection}},get detailId(){return ownerOrderDetailId},get savingId(){return ownerOrderStatusSavingId},
    set detail(value){ownerOrderDetailId=String(value||"")},set selection(value){ownerOrdersSelection={...ownerOrdersSelection,...value}},
  })`, context);

const orderLedgerRuntime = runInNewContext(`${functionSource("ownerNavigationIdentity")}\n${functionSource("createOwnerNavigationLedger")}\n({createOwnerNavigationLedger})`, {});
const orderLedger = orderLedgerRuntime.createOwnerNavigationLedger();
const listRoute = {
  panel: "orders", nav: "orders", orderDetailId: "", productMode: "menu", editingProductId: null, editingAdIndex: null,
  ordersSelection: { tab: "processing", query: "S101", status: "هاتە ناردن", date: "2026-10-31" },
  position: { windowY: 806, viewTop: 52, authTop: 0 },
};
const listEntry = orderLedger.start(listRoute);
orderLedger.updateContext({ ordersSelection: listRoute.ordersSelection, position: listRoute.position });
const detailEntry = orderLedger.navigate({ ...listRoute, orderDetailId: "S101", position: { windowY: 0, viewTop: 0, authTop: 0 } }).entry;
assert.notEqual(detailEntry.id, listEntry.id, "opening the order detail pushes a separate browser history entry");
const listAfterBack = orderLedger.back();
assert.equal(listAfterBack.orderDetailId, "", "Back returns from order detail to the list route");
assert.deepEqual(JSON.parse(JSON.stringify(listAfterBack.ordersSelection)), listRoute.ordersSelection, "Back restores the selected status tab, query, exact status, and date");
assert.deepEqual(JSON.parse(JSON.stringify(listAfterBack.position)), listRoute.position, "Back restores the exact previous order-list scroll position");

assert.deepEqual(JSON.parse(JSON.stringify(wrapped.ownerOrderMetrics(records))), { totalOrders: 4, totalSales: 12000, new: 1, processing: 1, completed: 1, cancelled: 1 }, "dashboard totals are calculated from actual saved order records");
assert.deepEqual(wrapped.ownerOrderFilteredOrders(records).map(order => order.id), ["S103", "S102", "S101", "S100"], "orders are sorted newest first without mutating saved order order");
assert.equal(JSON.stringify(records), baselineRecords, "metrics, sorting, and rendering do not mutate order records");
assert.equal(wrapped.ownerOrderStatusCategory(records[0]), "completed");
assert.equal(wrapped.ownerOrderStatusCategory(records[1]), "processing", "shipped orders are included in the Processing tab");
assert.equal(wrapped.ownerOrderStatusCategory(records[2]), "new");
assert.equal(wrapped.ownerOrderStatusCategory(records[3]), "cancelled");
assert.equal(wrapped.ownerOrderFilteredOrders(records, { tab: "processing" })[0].id, "S101");
assert.equal(wrapped.ownerOrderFilteredOrders(records, { query: "s101" })[0].id, "S101", "search matches the order number");
assert.equal(wrapped.ownerOrderFilteredOrders(records, { query: "b customer" })[0].id, "S101", "search matches the customer name");
assert.equal(wrapped.ownerOrderFilteredOrders(records, { query: "+9647500000102" })[0].id, "S102", "search matches the customer phone");
assert.equal(wrapped.ownerOrderFilteredOrders(records, { status: "هاتە ناردن" })[0].id, "S101", "exact status filtering uses existing saved statuses");
const dateFilter = wrapped.ownerOrderDateValue(records[2]);
assert.equal(wrapped.ownerOrderFilteredOrders(records, { date: dateFilter })[0].id, "S102", "date filtering matches the saved order date");

const listBox = { innerHTML: "" };
wrapped.renderOwnerOrders(listBox);
assert.match(listBox.innerHTML, /Total Orders/);
assert.match(listBox.innerHTML, /Total Sales/);
assert.match(listBox.innerHTML, /New Orders/);
assert.match(listBox.innerHTML, /Processing/);
assert.match(listBox.innerHTML, /Completed/);
assert.match(listBox.innerHTML, /Cancelled/);
assert.match(listBox.innerHTML, /S103/);
assert.match(listBox.innerHTML, /owner-orders-tabs/);
assert.match(listBox.innerHTML, /type="date"/);
assert.match(listBox.innerHTML, /owner-order-card/);
wrapped.setOwnerOrdersTab("processing");
assert.ok(context.ownerNavigationLedger.updates.length > 0, "search and filters can persist into Owner navigation snapshots");
assert.equal(tabButtons.find(button => button.dataset.ownerOrderTab === "processing").attributes["aria-pressed"], "true", "the selected status tab is announced accessibly");
assert.equal(cards.find(card => card.dataset.orderSearch.startsWith("s101")).hidden, false, "the processing tab keeps matching orders visible");
assert.equal(emptyState.hidden, true, "the no-results message stays hidden while results exist");
wrapped.updateOwnerOrdersFilter("query", "not-a-real-order");
assert.equal(cards.every(card => card.hidden), true, "search hides cards that do not match without rerendering the filter controls");
assert.equal(emptyState.hidden, false, "an empty filtered result shows a clear message");
assert.equal(wrapped.selection.query, "not-a-real-order");

wrapped.detail = "S101";
const detailBox = { innerHTML: "" };
wrapped.renderOwnerOrders(detailBox);
assert.match(detailBox.innerHTML, /B Customer/);
assert.match(detailBox.innerHTML, /\+9647500000101/);
assert.match(detailBox.innerHTML, /Duhok, Center/);
assert.match(detailBox.innerHTML, /Visa/);
assert.match(detailBox.innerHTML, /Coat/);
assert.match(detailBox.innerHTML, /#000000/);
assert.match(detailBox.innerHTML, /owner-order-status-control/);
assert.match(detailBox.innerHTML, /https:\/\/images\.example\.test\/coat\.webp/);
assert.match(html, /\.owner-orders-grid\{display:grid;grid-template-columns:repeat\(auto-fit/ , "desktop order cards use a responsive auto-fit grid");
assert.match(html, /@media\(max-width:960px\)\{\.owner-orders-stat-grid\{grid-template-columns:repeat\(3/ , "order metrics reflow at tablet widths");
assert.match(html, /@media\(max-width:760px\)\{\.owner-orders-heading,[\s\S]*?\.owner-orders-controls\{grid-template-columns:1fr\}/, "the mobile Orders layout stacks controls and headings without horizontal overflow");
assert.match(html, /@media\(max-width:390px\)\{\.owner-order-card-head[\s\S]*?\.owner-order-detail-item-price\{grid-column:2;text-align:start\}/, "narrow phone widths keep card and item details readable");
assert.match(functionSource("ownerNavigationHeaderMarkup"), /ownerPanel==="orders"&&ownerOrderDetailId/, "order details show the existing Owner Back header and contextual title");
assert.match(functionSource("captureOwnerNavigationSnapshot"), /orderDetailId:String\(ownerOrderDetailId\|\|""\).*ordersSelection:\{\.\.\.ownerOrdersSelection\}/, "the Owner history snapshot records the current order detail and list filters");

wrapped.detail = "";
assert.equal(wrapped.openOwnerOrderDetail("S101"), true, "opening details is Owner-protected and finds a real saved order");
assert.equal(wrapped.detailId, "S101");
assert.equal(renderCalls, 1, "opening a detail route uses the existing Owner router");
assert.equal(wrapped.openOwnerOrderDetail("missing"), false, "a missing order is not fabricated");

confirmResult = false;
const beforeCancel = records.find(order => order.id === "S101").status;
assert.equal(await wrapped.updateOrderStatus("S101", "گەهشت"), false, "declining the status confirmation cancels the update");
assert.equal(records.find(order => order.id === "S101").status, beforeCancel, "declining confirmation preserves the existing order status");

confirmResult = true;
flushResult = true;
assert.equal(await wrapped.updateOrderStatus("S101", "گەهشت"), true, "a confirmed status change saves through the shared sync queue");
assert.equal(records.find(order => order.id === "S101").status, "گەهشت");
assert.equal(savedWrites.at(-1).key, "shivan_shop_orders");
assert.equal(flushCalls, 1, "the Owner waits for the existing shared backend write queue");
assert.equal(confirmOptions.danger, false, "routine status changes use a non-destructive confirmation style");

flushResult = false;
const priorStatus = records.find(order => order.id === "S102").status;
assert.equal(await wrapped.updateOrderStatus("S102", "پێچرا"), false, "failed shared sync is not reported as success");
assert.notEqual(records.find(order => order.id === "S102").status, priorStatus, "the offline draft remains saved locally for the existing retry queue");
assert.match(notices.at(-1), /sync is pending/i, "a failed sync shows a clear pending-sync message");

flushResult = true;
assert.equal(await wrapped.updateOrderStatus("S102", "هەڵوەشاندنەوە"), true, "a cancellation status is confirmed and synced through the shared workflow");
assert.equal(confirmOptions.cancelled, true);
assert.equal(confirmOptions.danger, true, "cancelling uses the destructive confirmation treatment");

currentOwner = false;
const writeCount = savedWrites.length;
assert.equal(await wrapped.updateOrderStatus("S100", "پێچرا"), false, "non-owner status changes are rejected");
assert.equal(savedWrites.length, writeCount, "non-owner status attempts never write order data");

console.log("Owner Orders checks passed: real-record metrics, newest-first sorting, search/status/date filters, status tabs, full order details, nested Owner routing, confirmation, shared-sync success/failure, and Owner authorization.");
