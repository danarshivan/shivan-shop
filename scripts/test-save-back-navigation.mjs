import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const functionSource = name => {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`(?:async\\s+)?function ${escaped}\\([^\\n]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
  assert.ok(match, `Expected function ${name} to exist`);
  return match[0];
};

const shopSources = ["shopViewHistoryState", "writeShopViewHistory", "installShopViewNavigation"].map(functionSource).join("\n");
const shopHistoryEntries = [{ state: { existingState: "kept" } }];
let shopHistoryIndex = 0;
let activeShopView = "home";
const shopWindowListeners = {};
const restoredShopViews = [];
const shopHistory = {
  get state() { return shopHistoryEntries[shopHistoryIndex]?.state ?? null; },
  pushState(state) { shopHistoryEntries.splice(shopHistoryIndex + 1); shopHistoryEntries.push({ state }); shopHistoryIndex += 1; },
  replaceState(state) { shopHistoryEntries[shopHistoryIndex] = { state }; },
  back() { if (shopHistoryIndex > 0) { shopHistoryIndex -= 1; shopWindowListeners.popstate?.({ state: this.state }); } },
  forward() { if (shopHistoryIndex < shopHistoryEntries.length - 1) { shopHistoryIndex += 1; shopWindowListeners.popstate?.({ state: this.state }); } },
};
const shopPositions = { home: { windowY: 420, viewTop: 7, authTop: 0 }, search: { windowY: 0, viewTop: 19, authTop: 0 } };
const shopContext = {
  window: {
    history: shopHistory,
    addEventListener(name, handler) { shopWindowListeners[name] = handler; },
  },
  document: { addEventListener() {} },
  SHOP_HISTORY_VIEWS: new Set(["home", "search", "cart", "profile", "owner"]),
  getActiveShopView: () => activeShopView,
  readShopViewPosition: view => shopPositions[view] || { windowY: 0, viewTop: 0, authTop: 0 },
  isOwner: () => true,
  isStaffSession: () => false,
  openView(view, options) { activeShopView = view; restoredShopViews.push({ view, options }); },
};
const shopRuntime = runInNewContext(`let shopViewNavigationPopHandler=null,shopViewNavigationScrollHandler=null;${shopSources}\n({writeShopViewHistory,installShopViewNavigation})`, shopContext);
shopRuntime.installShopViewNavigation();
assert.equal(shopRuntime.writeShopViewHistory("home", { replace: true, position: shopPositions.home }), true, "the initial customer view is attached to the current history entry");
assert.equal(shopHistory.state.existingState, "kept", "Shop history keeps unrelated browser state");
assert.equal(shopRuntime.writeShopViewHistory("search", { position: shopPositions.search }), true, "a customer view change creates a history entry");
assert.equal(shopHistory.state.__shivanShopView, "search", "the current customer view is identified in browser history");
shopHistory.back();
assert.equal(activeShopView, "home", "browser Back returns from Search to the previous Shop view");
assert.deepEqual(JSON.parse(JSON.stringify(restoredShopViews.at(-1).options.restorePosition)), shopPositions.home, "Back restores the prior view's saved scroll position");
assert.equal(restoredShopViews.at(-1).options.historyRestore, true, "history restoration does not create another navigation entry");
shopHistory.forward();
assert.equal(activeShopView, "search", "browser Forward restores the next Shop view");
activeShopView = "owner";
shopHistory.pushState({ __shivanOwnerNavigationId: "owner-route-1", __shivanShopView: "cart" }, "");
shopHistory.pushState({ __shivanShopView: "cart" }, "");
shopHistory.back();
assert.equal(activeShopView, "owner", "the shared Shop handler leaves Owner route entries to the Owner ledger");
activeShopView = "detail";
shopHistory.pushState({ __shivanProductDetail: true, __shivanProductId: "p-1", __shivanShopView: "home" }, "");
shopHistory.pushState({ __shivanShopView: "home" }, "");
shopHistory.back();
assert.equal(activeShopView, "detail", "the shared Shop handler leaves product-detail entries to the product history handler");

const ownerSources = ["ownerNavigationIdentity", "createOwnerNavigationLedger", "ownerNavigationHistoryState", "completeOwnerNestedEditNavigation"].map(functionSource).join("\n");
function makeOwnerSaveRuntime(){
  const historyEntries = [{ state: null }];
  let historyIndex = 0;
  const context = { renderOwnerPanel: () => { throw new Error("The parent route should be restored from its existing history entry."); } };
  context.window = {
    history: {
      get state() { return historyEntries[historyIndex]?.state ?? null; },
      pushState(state) { historyEntries.splice(historyIndex + 1); historyEntries.push({ state }); historyIndex += 1; },
      back() {
        if (historyIndex > 0) {
          historyIndex -= 1;
          const id = historyEntries[historyIndex]?.state?.__shivanOwnerNavigationId;
          if (id) context.currentOwnerLedger.restore(id);
        }
      },
    },
  };
  const source = `let ownerNavigationLedger=createOwnerNavigationLedger();${ownerSources}\n({ledger:ownerNavigationLedger,ownerNavigationHistoryState,completeOwnerNestedEditNavigation})`;
  const runtime = runInNewContext(source, context);
  context.currentOwnerLedger = runtime.ledger;
  const position = { windowY: 100, viewTop: 12, authTop: 0 };
  const route = (panel, nav, productMode = "menu", extra = {}) => ({
    panel, nav, productMode, productEditorTab: "photos", editingProductId: extra.editingProductId ?? null,
    editingAdIndex: Number.isInteger(extra.editingAdIndex) ? extra.editingAdIndex : null,
    orderDetailId: "", analyticsSelection: {}, reportSelection: {}, ordersSelection: {}, position,
  });
  const push = snapshot => {
    const entry = runtime.ledger.navigate(snapshot).entry;
    context.window.history.pushState(runtime.ownerNavigationHistoryState(entry), "");
    return entry;
  };
  const dashboard = push(route("dashboard", "dashboard"));
  return { runtime, context, route, push, dashboard, historyEntries, get historyIndex() { return historyIndex; } };
}

for (const kind of ["product", "discount", "advertisement"]) {
  const scenario = makeOwnerSaveRuntime();
  const parentRoute = kind === "advertisement"
    ? scenario.push(scenario.route("ads", "ads"))
    : scenario.push(scenario.route("products", kind === "discount" ? "discounts" : "products", "list"));
  const formEntry = kind === "advertisement"
    ? scenario.push(scenario.route("ads", "ads", "menu", { editingAdIndex: 2 }))
    : scenario.push(scenario.route("products", kind === "discount" ? "discounts" : "products", "form", { editingProductId: kind === "discount" ? "product-2" : "product-1" }));
  const parentSnapshot = kind === "advertisement" ? scenario.route("ads", "ads") : scenario.route("products", kind === "discount" ? "discounts" : "products", "list");
  const form = { dataset: { saving: "true", shivanDraftDirty: "true" } };
  assert.equal(scenario.context.window.history.state.__shivanOwnerNavigationId, formEntry.id, `${kind}: the edit form is the current history entry before save`);
  assert.equal(scenario.runtime.completeOwnerNestedEditNavigation(parentSnapshot, form), true, `${kind}: confirmed save returns to its parent list`);
  assert.equal(scenario.historyIndex, scenario.historyEntries.findIndex(entry => entry.state?.__shivanOwnerNavigationId === parentRoute.id), `${kind}: the parent list is the current browser history entry`);
  assert.equal(scenario.runtime.ledger.current().id, parentRoute.id, `${kind}: the Owner ledger and browser history point to the same parent entry`);
  assert.equal(form.dataset.shivanDraftDirty, "false", `${kind}: a confirmed save clears the old form's dirty state before Back restoration`);
  scenario.context.window.history.back();
  assert.equal(scenario.runtime.ledger.current().id, scenario.dashboard.id, `${kind}: Back from the saved parent continues to the preceding route instead of reopening the saved form`);
}

const profileSource = functionSource("saveProfile");
const profileInputs = { editName: { value: "Updated Customer" }, editIdentifier: { value: "customer@example.com" } };
let profileRequestCount = 0;
let rejectProfileRequest;
let failProfileRequest = true;
let profileModalOpen = true;
const profileNotices = [];
const profileButton = { disabled: false, attributes: {}, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
const profileContext = {
  cloudMode: true,
  cloudAccount: { id: "customer-1", role: "customer", name: "Customer" },
  currentUser: { id: "customer-1", role: "customer", name: "Customer" },
  OWNER_IDENTIFIER: "owner@example.com",
  isOwner: () => false,
  document: {
    getElementById(id) { return profileInputs[id] || null; },
    querySelector() { return profileButton; },
  },
  cloudRequest() {
    profileRequestCount += 1;
    if (failProfileRequest) return new Promise((_resolve, reject) => { rejectProfileRequest = reject; });
    return Promise.resolve({ account: { id: "customer-1", role: "customer", name: "Updated Customer", identifier: "customer@example.com" } });
  },
  closeModal() { profileModalOpen = false; },
  updateProfile() {},
  showToast(message) { profileNotices.push(message); },
};
const profileRuntime = runInNewContext(`let profileSavePending=false;${profileSource}\n({saveProfile})`, profileContext);
const failedProfileSave = profileRuntime.saveProfile();
assert.equal(profileButton.disabled, true, "Profile Save locks while the server is processing the request");
assert.equal(await profileRuntime.saveProfile(), false, "a second Profile submission is rejected while the first is pending");
assert.equal(profileRequestCount, 1, "duplicate Profile submissions issue only one API request");
rejectProfileRequest(new Error("The profile service is temporarily unavailable."));
assert.equal(await failedProfileSave, false, "a failed server save is reported as a failure");
assert.equal(profileModalOpen, true, "a failed Profile save leaves the edit form open");
assert.equal(profileInputs.editName.value, "Updated Customer", "a failed Profile save preserves the entered name");
assert.equal(profileInputs.editIdentifier.value, "customer@example.com", "a failed Profile save preserves the entered identifier");
assert.equal(profileButton.disabled, false, "the Profile Save button unlocks for retry after failure");
assert.match(profileNotices.at(-1), /temporarily unavailable/, "the Profile form receives a meaningful server error");
failProfileRequest = false;
assert.equal(await profileRuntime.saveProfile(), true, "a server-confirmed Profile save succeeds");
assert.equal(profileModalOpen, false, "a confirmed Profile save returns to the Profile screen");
assert.match(profileNotices.at(-1), /updated and synced/, "Profile success is announced only after server confirmation");

const openViewSource = functionSource("openView");
assert.match(openViewSource, /installShopViewNavigation\(\)/, "all Shop view changes install shared Back and Forward handling");
assert.match(openViewSource, /writeShopViewHistory\(previousView/,
  "the current customer view and its scroll position are saved before navigating");
assert.match(openViewSource, /writeShopViewHistory\(view/,
  "the destination customer view is added to browser history");
assert.doesNotMatch(openViewSource, /__shivanOwnerExitView/, "switching away from Owner does not add a duplicate neutral entry");

console.log("Save and Back navigation regression checks passed: customer view history and scroll restore, Owner Product/Discount/Ad save return, Profile failure recovery, server-confirmed success, and duplicate submission protection.");
