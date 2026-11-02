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
  "ownerOrderNextStatus", "ownerOrderNextButtonMarkup", "ownerOrderAddress", "ownerOrderDetailMarkup", "ownerOrderCardMarkup", "ownerOrderFilteredOrders", "ownerOrderMetrics",
  "updateOwnerOrdersFilter", "setOwnerOrdersTab", "applyOwnerOrdersFilters", "openOwnerOrderDetail", "renderOwnerOrders", "refreshOwnerOrderStatusView", "advanceOwnerOrderStatus", "updateOrderStatus",
].map(name => `${["advanceOwnerOrderStatus", "updateOrderStatus"].includes(name) ? "async " : ""}${functionSource(name)}`).join("\n");

const records = [
  { id: "S100", name: "A Customer", phone: "+9647500000100", city: "Erbil", area: "Center", address: "Erbil, Center", paymentMethod: "cash", total: 12000, status: "گەهشت", date: "2026-10-29", createdAt: "2026-10-29T11:30:00.000Z", items: [{ productId: 1, name: "Purple Dress", image: "/api/media/shop/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp", colorName: "Violet", size: "M", qty: 1, price: 12000 }, { productId: 2, name: "Scarf", color: "Black", size: "One Size", qty: 1, price: 0 }] },
  { id: "S101", name: "B Customer", phone: "+9647500000101", address: "Duhok, Center", paymentMethod: "visa", total: 5000, status: "هاتە ناردن", date: "2026-10-31", createdAt: "2026-10-31T11:30:00.000Z", items: [{ productId: 2, name: "Coat", image: "https://images.example.test/coat.webp", color: "#000000", size: "L", qty: 2, price: 2500 }] },
  { id: "S102", name: "C Customer", phone: "+9647500000102", address: "Erbil", paymentMethod: "cash", total: 10000, status: "لە چاوەڕوانی", date: "2026-11-01", createdAt: "2026-11-01T11:30:00.000Z", items: [{ productId: 1, name: "Dress", color: "Red", size: "S", qty: 1, price: 10000 }] },
  { id: "S103", name: "D Customer", phone: "+9647500000103", total: 9000, status: "هەڵوەشاندنەوە", date: "2026-11-02", createdAt: "2026-11-02T11:30:00.000Z", items: [] },
];
const baselineRecords = JSON.stringify(records);
function makeCard(order) {
  const badge = { className: "owner-order-status", textContent: order.status };
  const next = { disabled: false, removed: false, textContent: "Next", remove() { this.removed = true; } };
  return {
  dataset: {
    orderId: order.id,
    orderSearch: [order.id, order.name, order.phone].join(" ").toLocaleLowerCase(),
    orderCategory: /cancel|canceled|cancelled|هەڵوەشاندنەوە|ملغي|إلغاء/i.test(order.status) ? "cancelled" : /گەهشت|delivered|complete|completed|fulfilled/i.test(order.status) ? "completed" : /پێچرا|هاتە ناردن|process|ship|transit|dispatched/i.test(order.status) ? "processing" : "new",
    orderStatusValue: order.status,
    orderDate: `${new Date(order.createdAt).getFullYear()}-${String(new Date(order.createdAt).getMonth() + 1).padStart(2, "0")}-${String(new Date(order.createdAt).getDate()).padStart(2, "0")}`,
  },
  hidden: false,
  badge,
  next,
  querySelector(selector) { return selector === ".owner-order-status" ? this.badge : selector === "[data-owner-order-next]" && !this.next.removed ? this.next : null; },
  };
}
const cards = records.map(makeCard);
const tabButtons = ["all", "new", "processing", "completed", "cancelled"].map(tab => ({ dataset: { ownerOrderTab: tab }, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; } }));
const emptyState = { hidden: true };
const resultState = { textContent: "" };
const metricNodes = Object.fromEntries(["all", "sales", "new", "processing", "completed", "cancelled"].map(key => [key, { textContent: "" }]));
const detailBadge = { className: "owner-order-status", textContent: "" };
const detailNext = { disabled: false, removed: false, textContent: "Next", remove() { this.removed = true; } };
const detailSelect = { value: "" };
const detailElement = { dataset: { ownerOrderDetail: "" }, querySelector(selector) { return selector === ".owner-order-status" ? detailBadge : selector === ".owner-order-status-control select" ? detailSelect : selector === "[data-owner-order-next]" && !detailNext.removed ? detailNext : null; } };
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
    if (selector === "#ownerOrderDetail") return detailElement;
    const metric = selector.match(/^\[data-order-metric="([^"]+)"\]$/);
    if (metric) return metricNodes[metric[1]] || null;
    return null;
  },
};
const savedWrites = [];
const directStorageWrites = [];
const notices = [];
const apiCalls = [];
const scrollRestores = [];
const remoteOrders = new Map(records.map(order => [order.id, { ...order }]));
let cloudRequestHandler = async (path, options) => {
  apiCalls.push({ path, options });
  const id = decodeURIComponent(path.split("/").at(-2));
  const expectedStatus = JSON.parse(options.body).expectedStatus;
  const remote = remoteOrders.get(id);
  if (!remote || remote.status !== expectedStatus) throw Object.assign(new Error("Order status changed on the server."), { status: 409 });
  const nextStatus = /پێچرا|هاتە ناردن|process|ship|transit|dispatched/i.test(remote.status) ? "گەهشت" : "پێچرا";
  remote.status = nextStatus;
  return { ok: true, persisted: true, orderId: id, status: nextStatus };
};
const cloudRequest = (path, options) => cloudRequestHandler(path, options);
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
  originalStorageSetItem: { call(_storage, key, value) { directStorageWrites.push({ key, value }); } },
  ORDERS_KEY: "shivan_shop_orders",
  readCloudOutbox: () => ({}),
  clearAcknowledgedCloudWrite: () => {},
  cloudRequest,
  readShopViewPosition: () => ({ windowY: 812, viewTop: 64, authTop: 0 }),
  restoreOwnerScrollPosition: position => scrollRestores.push({ ...position }),
  requestAnimationFrame: callback => callback(),
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
    applyOwnerOrdersFilters,openOwnerOrderDetail,renderOwnerOrders,refreshOwnerOrderStatusView,advanceOwnerOrderStatus,updateOrderStatus,
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
assert.match(detailBox.innerHTML, /data-owner-order-next="S101"/, "a selected processing order exposes its own Next action");
assert.doesNotMatch(wrapped.ownerOrderDetailMarkup(records[0]), /data-owner-order-next/, "completed orders do not render a Next action");
assert.doesNotMatch(wrapped.ownerOrderDetailMarkup(records[3]), /data-owner-order-next/, "cancelled orders do not render a Next action");
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

const newFlowOrder = { id: "S104", name: "Next Flow Customer", phone: "+9647500000104", status: "لە چاوەڕوانی", total: 4500, items: [{ productId: 2, name: "Coat", qty: 1, price: 4500 }] };
const processingFlowOrder = { id: "S105", name: "Detail Flow Customer", phone: "+9647500000105", status: "پێچرا", total: 3800, items: [{ productId: 1, name: "Dress", qty: 1, price: 3800 }] };
const completedFlowOrder = { id: "S106", name: "Completed Flow Customer", status: "گەهشت", total: 1000, items: [] };
const failedFlowOrder = { id: "S107", name: "Retry Flow Customer", status: "لە چاوەڕوانی", total: 2000, items: [] };
const duplicateFlowOrder = { id: "S108", name: "Duplicate Flow Customer", status: "لە چاوەڕوانی", total: 3000, items: [] };
for (const order of [newFlowOrder, processingFlowOrder, completedFlowOrder, failedFlowOrder, duplicateFlowOrder]) { records.push(order); remoteOrders.set(order.id, { ...order }); cards.push(makeCard(order)); }
assert.match(wrapped.ownerOrderCardMarkup(newFlowOrder), /data-owner-order-next="S104"/, "new orders display a Next control scoped to that order ID");
assert.match(wrapped.ownerOrderCardMarkup(processingFlowOrder), /data-owner-order-next="S105"/, "processing orders display a Next control");
assert.doesNotMatch(wrapped.ownerOrderCardMarkup(completedFlowOrder), /data-owner-order-next/, "completed order cards have no Next control");
wrapped.selection = { tab: "all", query: "S104", status: "", date: "" };
wrapped.applyOwnerOrdersFilters();
const nextRenderCount = renderCalls;
const unrelatedStatusBefore = records.find(order => order.id === "S105").status;
const nextWriteCount = directStorageWrites.length;
assert.equal(await wrapped.advanceOwnerOrderStatus("S104"), true, "Next saves a new order as Processing");
assert.equal(records.find(order => order.id === "S104").status, "پێچرا");
assert.equal(records.find(order => order.id === "S105").status, unrelatedStatusBefore, "advancing one order leaves other local orders unchanged");
assert.equal(apiCalls.at(-1).path, "/api/orders/S104/next-status", "Next calls the single-order status endpoint");
assert.equal(apiCalls.at(-1).options.method, "PATCH");
assert.deepEqual(JSON.parse(apiCalls.at(-1).options.body), { expectedStatus: "لە چاوەڕوانی" });
assert.equal(directStorageWrites.length, nextWriteCount + 1, "a confirmed status updates the local order snapshot once without queuing another bulk write");
assert.equal(directStorageWrites.at(-1).key, "shivan_shop_orders");
assert.equal(wrapped.selection.query, "S104", "in-place refresh preserves the current search query");
assert.equal(wrapped.selection.tab, "all", "in-place refresh preserves the selected order tab");
assert.equal(cards.find(card => card.dataset.orderId === "S104").dataset.orderCategory, "processing");
assert.equal(cards.find(card => card.dataset.orderId === "S104").hidden, false, "the filtered selected order stays visible when it still matches");
assert.equal(renderCalls, nextRenderCount, "Next does not navigate or rerender the whole Owner page");
assert.deepEqual(scrollRestores.at(-1), { windowY: 812, viewTop: 64, authTop: 0 }, "the exact Orders scroll position is restored after saving");
assert.match(notices.at(-1), /updated/i, "successful API confirmation shows success feedback");

detailElement.dataset.ownerOrderDetail = "S105";
detailSelect.value = "پێچرا";
const detailNextCalls = renderCalls;
assert.equal(await wrapped.advanceOwnerOrderStatus("S105"), true, "Next advances the selected order detail from Processing to Completed");
assert.equal(records.find(order => order.id === "S105").status, "گەهشت");
assert.equal(detailSelect.value, "گەهشت", "the selected order detail status refreshes in place");
assert.equal(detailNext.removed, true, "the selected order's Next action disappears after completion");
assert.equal(renderCalls, detailNextCalls, "advancing from details keeps the user on that same detail screen");
detailElement.dataset.ownerOrderDetail = "";

const failedOrderBefore = JSON.stringify(failedFlowOrder);
cloudRequestHandler = async (path, options) => { apiCalls.push({ path, options }); throw Object.assign(new Error("The shared API could not save this order."), { status: 503 }); };
assert.equal(await wrapped.advanceOwnerOrderStatus("S107"), false, "a failed server response does not report success");
assert.equal(JSON.stringify(failedFlowOrder), failedOrderBefore, "a failed save keeps the order status unchanged");
assert.equal(cards.find(card => card.dataset.orderId === "S107").next.disabled, false, "the failed order action unlocks for a retry");
assert.match(notices.at(-1), /could not save/i, "a failed API request shows its error feedback");

let finishDuplicateRequest;
cloudRequestHandler = (path, options) => { apiCalls.push({ path, options }); return new Promise(resolve => { finishDuplicateRequest = resolve; }); };
const duplicateCallsBefore = apiCalls.length;
const firstDuplicateAdvance = wrapped.advanceOwnerOrderStatus("S108");
assert.equal(wrapped.savingId, "S108", "the selected Next button enters a saving lock");
assert.equal(cards.find(card => card.dataset.orderId === "S108").next.disabled, true, "duplicate taps are blocked while the server save is pending");
assert.equal(await wrapped.advanceOwnerOrderStatus("S108"), false, "a simultaneous duplicate call is rejected");
assert.equal(apiCalls.length, duplicateCallsBefore + 1, "only one server request is sent for duplicate taps");
remoteOrders.get("S108").status = "پێچرا";
finishDuplicateRequest({ ok: true, persisted: true, orderId: "S108", status: "پێچرا" });
assert.equal(await firstDuplicateAdvance, true, "the original in-flight status update completes normally");
assert.equal(wrapped.savingId, "", "the saving lock clears after completion");

currentOwner = false;
const writeCount = savedWrites.length;
assert.equal(await wrapped.updateOrderStatus("S100", "پێچرا"), false, "non-owner status changes are rejected");
assert.equal(savedWrites.length, writeCount, "non-owner status attempts never write order data");

console.log("Owner Orders checks passed: real-record metrics, newest-first sorting, search/status/date filters, status tabs, full order details, nested Owner routing, confirmation, shared-sync success/failure, and Owner authorization.");
