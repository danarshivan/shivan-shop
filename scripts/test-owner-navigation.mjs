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

const ledgerSources = ["ownerNavigationIdentity", "createOwnerNavigationLedger"].map(functionSource).join("\n");
const restoredView = { scrollTop: 0 };
const root = { style: { scrollBehavior: "smooth" } };
let restoredWindowY = -1;
const context = {
  window: {
    history: { state: { existingState: "preserved" } },
    scrollTo: (_x, y) => { restoredWindowY = y; },
  },
  document: {
    documentElement: root,
    getElementById: id => id === "ownerView" ? restoredView : null,
  },
};
const runtime = runInNewContext(`${ledgerSources}\n${functionSource("ownerNavigationHistoryState")}\n${functionSource("restoreOwnerScrollPosition")}\n({createOwnerNavigationLedger,ownerNavigationHistoryState,restoreOwnerScrollPosition})`, context);

const ledger = runtime.createOwnerNavigationLedger();
const position = (windowY, viewTop = 0) => ({ windowY, viewTop, authTop: 0 });
const state = (panel, nav, savedPosition, extra = {}) => ({
  panel,
  nav,
  productMode: extra.productMode || (panel === "products" ? "list" : "menu"),
  editingProductId: extra.editingProductId ?? null,
  editingAdIndex: Number.isInteger(extra.editingAdIndex) ? extra.editingAdIndex : null,
  analyticsSelection: { period: "daily", date: "", month: "", year: "" },
  reportSelection: { preset: "month", start: "", end: "" },
  position: savedPosition,
});

const initial = ledger.start(state("dashboard", "dashboard", position(640)));
assert.equal(initial.position.windowY, 640, "the initial Owner page scroll position is saved");
const routes = [
  ["products", "products"], ["products", "categories"], ["ads", "ads"], ["orders", "orders"],
  ["customers", "customers"], ["inventory", "inventory"], ["analytics", "analytics"],
  ["products", "discounts"], ["appearance", "colors"], ["appearance", "store-settings"],
  ["appearance", "backup"], ["reports", "reports"], ["onboarding", "onboarding"],
];
const visited = [initial];
for (const [panel, nav] of routes) {
  const nextPosition = position(140 + visited.length * 37, visited.length * 3);
  const result = ledger.navigate(state(panel, nav, nextPosition));
  assert.equal(result.changed, true, `${nav} creates a distinct Owner history entry`);
  ledger.updatePosition(nextPosition);
  visited.push(ledger.current());
}

ledger.restore(visited[4].id);
const browserForward = ledger.restore(visited[6].id);
assert.equal(browserForward.id, visited[6].id, "browser and device Forward restore the next Owner screen");
assert.deepEqual(JSON.parse(JSON.stringify(browserForward.position)), JSON.parse(JSON.stringify(visited[6].position)), "Forward restores the saved scroll coordinates");
ledger.restore(visited.at(-1).id);

for (let index = visited.length - 2; index >= 0; index -= 1) {
  const expected = visited[index];
  const restored = ledger.restore(expected.id);
  assert.equal(restored.id, expected.id, "Back restores the immediately previous Owner screen");
  assert.deepEqual(JSON.parse(JSON.stringify(restored.position)), JSON.parse(JSON.stringify(expected.position)), "Back restores that screen's exact saved scroll coordinates");
  assert.equal(ledger.current().id, expected.id, "the browser history ledger selects the previous Owner screen");
}

const productList = ledger.navigate(state("products", "products", position(520), { productMode: "list" })).entry;
const newProduct = ledger.navigate(state("products", "products", position(23), { productMode: "form" })).entry;
const editProduct = ledger.navigate(state("products", "products", position(29), { productMode: "form", editingProductId: "product-23" })).entry;
assert.notEqual(newProduct.id, editProduct.id, "New Product and Edit Product have distinct navigation identities");
assert.equal(ledger.back().id, newProduct.id, "Back from a product edit returns to the previous product form");
assert.equal(ledger.back().id, productList.id, "Back from New Product returns to the prior product list");
const productMenu = ledger.navigate(state("products", "products", position(61), { productMode: "menu" })).entry;
const productCategories = ledger.navigate(state("products", "products", position(85), { productMode: "categories" })).entry;
assert.equal(ledger.restore(productMenu.id).productMode, "menu", "Back restores the product-management menu mode");
const categoryAgain = ledger.navigate(state("products", "products", position(85), { productMode: "categories" })).entry;
const duplicateCategory = ledger.navigate(state("products", "products", position(85), { productMode: "categories" }));
assert.notEqual(categoryAgain.id, productCategories.id, "forward navigation after Back receives a fresh history identity");
assert.equal(duplicateCategory.entry.id, categoryAgain.id, "rerendering the same nested category state does not create a duplicate history entry");

const adList = ledger.navigate(state("ads", "ads", position(410))).entry;
const adEdit = ledger.navigate(state("ads", "ads", position(17), { editingAdIndex: 2 })).entry;
assert.notEqual(adList.id, adEdit.id, "editing an advertisement is a distinct nested screen");
assert.equal(ledger.back().id, adList.id, "Back from advertisement editing returns to the prior advertisement list");

const draftForm = ledger.navigate(state("products", "products", position(38), { productMode: "form" })).entry;
const cancelledList = ledger.replaceCurrent(state("products", "products", position(520), { productMode: "list" }));
assert.equal(cancelledList.id, draftForm.id, "Cancel replaces the current form entry instead of leaving it in browser history");
assert.equal(ledger.get(draftForm.id).productMode, "list", "the canceled form entry now represents the product list");
assert.equal(ledger.back().id, adList.id, "Back after Cancel does not reopen the canceled form");

ledger.updateContext({
  analyticsSelection: { period: "monthly", month: "2026-10" },
  reportSelection: { preset: "custom", start: "2026-10-01", end: "2026-10-31" },
  position: position(845, 21),
});
assert.equal(ledger.current().position.windowY, 845, "scroll changes made after opening a section update its stored position");
assert.equal(ledger.current().analyticsSelection.period, "monthly", "active analytics filters are preserved in the Owner route snapshot");
assert.equal(ledger.current().reportSelection.start, "2026-10-01", "active report date ranges are preserved in the Owner route snapshot");
const historyState = runtime.ownerNavigationHistoryState(adEdit);
assert.equal(historyState.existingState, "preserved", "Owner history keeps any existing browser state");
assert.equal(historyState.__shivanOwnerNavigationId, adEdit.id, "Owner entries are identified for browser/device Back handling");

runtime.restoreOwnerScrollPosition(position(912, 33));
assert.equal(restoredWindowY, 912, "window scroll restores synchronously without smooth scrolling");
assert.equal(restoredView.scrollTop, 33, "Owner view scroll restores independently");
assert.equal(root.style.scrollBehavior, "smooth", "the user's prior scroll behavior setting is restored afterward");

const renderSource = functionSource("renderOwnerPanel");
assert.doesNotMatch(renderSource, /scrollOwnerTo\(["']ownerView["']\)/, "Owner route changes no longer scroll the whole page to its top");
assert.match(renderSource, /ownerNavigationLedger\.navigate\(navigationSnapshot\)/, "Owner screens are recorded as route history entries");
assert.match(renderSource, /ownerNavigationLedger\.updateContext/, "scroll and selected report context are saved before rerender");
assert.match(renderSource, /restoreOwnerScrollPosition\(restorePosition\)/, "same-screen renders preserve the saved position");
assert.match(renderSource, /ownerNavigationHeaderMarkup\(\)/, "Owner routes render a visible Back control");
assert.match(functionSource("installOwnerNavigationPopHandler"), /addEventListener\?\.\("popstate"/, "browser and device Back events restore Owner history");
assert.match(functionSource("ownerNavigateBack"), /window\.history\.back\(\)/, "the visible Back button uses browser history when available");
assert.match(functionSource("ownerNavigationHasUnsavedDraft"), /data-shivan-draft-dirty/, "Back does not discard an edited Owner form");
assert.match(functionSource("openView"), /__shivanOwnerExitView/, "leaving Owner creates a neutral history entry so later Shop navigation still returns correctly");
assert.match(functionSource("ensureProductHistoryListener"), /if\(state\.__shivanOwnerNavigationId\)return/, "product-detail Back does not consume an Owner history entry");
assert.match(html, /\.owner-route-header\{position:sticky/, "the Back control remains reachable while scrolling a long section");
assert.match(html, /\.owner-route-back:focus-visible/, "the Back button has a visible keyboard-focus state");

const integrationFunctionNames = [
  "ownerNavigationIdentity", "createOwnerNavigationLedger", "captureOwnerNavigationSnapshot", "ownerNavigationHistoryState",
  "writeOwnerNavigationHistory", "restoreOwnerScrollPosition", "ownerNavigationHasUnsavedDraft", "ownerNavigationHeaderMarkup",
  "restoreOwnerNavigationEntry", "installOwnerNavigationPopHandler", "ownerNavigateBack", "renderOwnerPanel",
  "ownerPanelRoute", "ownerDashboardText", "ownerDashboardNavItems",
];
const integrationFunctions = integrationFunctionNames.map(functionSource).join("\n");

function createOwnerNavigationRuntime(){
  const historyEntries = [{ state: null }];
  let historyIndex = 0;
  let position = { windowY: 0, viewTop: 0, authTop: 0 };
  let dirtyDraft = false;
  const windowListeners = {};
  const scrollListeners = [];
  const history = {
    get state(){ return historyEntries[historyIndex]?.state ?? null; },
    pushState(state){ historyEntries.splice(historyIndex + 1); historyEntries.push({ state }); historyIndex += 1; },
    replaceState(state){ historyEntries[historyIndex] = { state }; },
    back(){ if(historyIndex>0){historyIndex-=1;windowListeners.popstate?.({state:this.state});} },
    forward(){ if(historyIndex<historyEntries.length-1){historyIndex+=1;windowListeners.popstate?.({state:this.state});} },
  };
  const ownerView = { scrollTop: 0, classList: { contains: value => value === "active" } };
  const dashboard = { innerHTML: "", hidden: false, insertAdjacentHTML(_where, value){ this.innerHTML = value + this.innerHTML; } };
  const section = { innerHTML: "", hidden: true, insertAdjacentHTML(_where, value){ this.innerHTML = value + this.innerHTML; } };
  const content = { innerHTML: "", querySelector(){ return dirtyDraft ? { dataset: { shivanDraftDirty: "true" } } : null; } };
  const mobileToolbar = { hidden: true };
  const mobileSelect = { value: "" };
  const elements = {
    ownerView, ownerDashboardPage: dashboard, ownerPanelSectionContent: section,
    ownerPanelContent: content, ownerMobileToolbar: mobileToolbar, ownerMobileNavigation: mobileSelect,
  };
  const window = {
    history,
    addEventListener(name, handler){ windowListeners[name] = handler; },
    scrollTo(_x, y){ position.windowY = y; },
  };
  const document = {
    documentElement: { style: { scrollBehavior: "smooth" } },
    getElementById(id){ return elements[id] || null; },
    querySelectorAll(){ return []; },
    addEventListener(name, handler){ if(name === "scroll")scrollListeners.push(handler); },
  };
  const context = {
    window, document, activeLanguage: "en", ownerPanel: "dashboard", ownerDashboardNavKey: "dashboard",
    ownerProductMode: "menu", editingProductId: null, editingAdIndex: null,
    ownerAnalyticsSelection: { period: "daily", date: "", month: "", year: "" },
    ownerReportSelection: { preset: "month", start: "", end: "" },
    ownerNavigationLedger: null, ownerNavigationPopHandler: null, ownerNavigationRestoring: false,
    ownerPanelRefreshPending: false, ownerProductWorkflowId: "", ownerAdWorkflowId: "", ownerInventoryDraft: new Map(),
    pendingImageCrop: false, ownerProductImageQueue: false,
    isOwner: () => true, ownerPanelHasPendingWork: () => false,
    readShopViewPosition: () => ({ windowY: position.windowY, viewTop: ownerView.scrollTop, authTop: 0 }),
    showToast: () => {}, createOwnerSaveRequestId: () => "test-save-id",
    ensureOwnerDashboardShell: () => {}, stopOwnerQrScanner: () => {}, renderOwnerDashboard: box => { box.innerHTML = "dashboard"; },
    renderOwnerProducts: box => { box.innerHTML = "products"; }, renderOwnerAds: box => { box.innerHTML = "ads"; },
    renderOwnerOrders: box => { box.innerHTML = "orders"; }, renderOwnerInventory: box => { box.innerHTML = "inventory"; },
    renderOwnerAppearance: box => { box.innerHTML = "appearance"; },
    renderOwnerSettingsHub: box => { box.innerHTML = "settings"; }, renderOwnerStoreInformation: box => { box.innerHTML = "settings-information"; },
    renderOwnerNotificationSettings: box => { box.innerHTML = "settings-notifications"; }, renderOwnerDeliverySettings: box => { box.innerHTML = "settings-delivery"; },
    renderOwnerSecuritySettings: box => { box.innerHTML = "settings-security"; }, renderOwnerBackupSync: box => { box.innerHTML = "settings-backup"; },
    renderShopOnboardingOwnerEditor: box => { box.innerHTML = "onboarding"; },
    renderOwnerCustomers: box => { box.innerHTML = "customers"; }, renderOwnerAnalytics: box => { box.innerHTML = "analytics"; },
    renderOwnerReports: box => { box.innerHTML = "reports"; }, renderOwnerDashboardNavigation: () => {},
    scrollOwnerTo: () => {}, escapeHtml: value => String(value), requestAnimationFrame: callback => { callback(); return 1; },
    openView: () => {},
  };
  context.setDirtyDraft = value => { dirtyDraft = value; };
  context.readHistoryEntries = () => historyEntries.map(entry => entry.state);
  context.setViewportPosition = (windowY, viewTop) => { position = { windowY, viewTop, authTop: 0 }; ownerView.scrollTop = viewTop; };
  context.readViewportPosition = () => ({ windowY: position.windowY, viewTop: ownerView.scrollTop, authTop: 0 });
  context.readRenderedHeader = () => dashboard.innerHTML + section.innerHTML;
  const source = `
    let ownerPanel="dashboard", ownerDashboardNavKey="dashboard", ownerProductMode="menu", editingProductId=null, editingAdIndex=null;
    let ownerAnalyticsSelection={period:"daily",date:"",month:"",year:""}, ownerReportSelection={preset:"month",start:"",end:""}, ownerOrdersSelection={tab:"all",query:"",status:"",date:""}, ownerOrderDetailId="";
    let ownerNavigationRestoring=false, ownerPanelRefreshPending=false, ownerProductWorkflowId="", ownerAdWorkflowId="", ownerInventoryDraft=new Map();
    let ownerNavigationLedger=createOwnerNavigationLedger(), ownerNavigationPopHandler=null;
    ${integrationFunctions}
    ({
      renderOwnerPanel, ownerNavigateBack, history:window.history, get current(){return ownerNavigationLedger.current();},
      get route(){return {panel:ownerPanel,nav:ownerDashboardNavKey,productMode:ownerProductMode,editingProductId,editingAdIndex};},
      get scroll(){return readViewportPosition();}, get header(){return readRenderedHeader();},
      setPosition(windowY,viewTop=0){setViewportPosition(windowY,viewTop);},
      setNestedState(values){if("productMode" in values)ownerProductMode=values.productMode;if("editingProductId" in values)editingProductId=values.editingProductId;if("editingAdIndex" in values)editingAdIndex=values.editingAdIndex;},
      setDirtyDraft(value){setDirtyDraft(value);},
      get historyEntries(){return readHistoryEntries();},
    })`;
  const runtime = runInNewContext(source, context);
  return runtime;
}

for (const viewport of [{name:"iPhone-sized", width:390, height:844, baseY:517}, {name:"desktop", width:1440, height:900, baseY:1320}]) {
  const ui = createOwnerNavigationRuntime();
  ui.renderOwnerPanel("dashboard");
  assert.match(ui.historyEntries.at(-1)?.__shivanOwnerNavigationId || "", /^owner-/, `${viewport.name}: Owner dashboard is registered in browser history`);
  const sectionRoutes = ["products", "categories", "ads", "orders", "customers", "inventory", "analytics", "discounts", "colors", "store-settings", "settings-appearance", "settings-information", "settings-notifications", "settings-delivery", "settings-security", "settings-backup", "reports", "onboarding"];
  const saved = [{ id: ui.current.id, route: { panel: "dashboard", nav: "dashboard" }, position: { windowY: viewport.baseY, viewTop: 7 } }];
  for (let index = 0; index < sectionRoutes.length; index += 1) {
    const before = ui.current;
    const beforePosition = { windowY: viewport.baseY + index * 19, viewTop: index * 2 };
    ui.setPosition(beforePosition.windowY, beforePosition.viewTop);
    saved[saved.length - 1].position = beforePosition;
    ui.renderOwnerPanel(sectionRoutes[index]);
    saved.push({ id: ui.current.id, route: { panel: ui.route.panel, nav: ui.route.nav }, position: beforePosition });
    assert.match(ui.header, /owner-route-back/, `${viewport.name}: ${sectionRoutes[index]} shows a Back control`);
  }
  for (let index = saved.length - 2; index >= 0; index -= 1) {
    ui.history.back();
    assert.equal(ui.route.panel, saved[index].route.panel, `${viewport.name}: Back restores ${saved[index].route.nav}`);
    assert.equal(ui.route.nav, saved[index].route.nav, `${viewport.name}: Back restores the active Owner section`);
    assert.equal(ui.scroll.windowY, saved[index].position.windowY, `${viewport.name}: Back restores the exact window scroll position`);
    assert.equal(ui.scroll.viewTop, saved[index].position.viewTop, `${viewport.name}: Back restores the Owner view scroll position`);
  }
  ui.history.forward();
  assert.equal(ui.route.nav, saved[1].route.nav, `${viewport.name}: Forward restores the next Owner section`);
}

const nestedUi = createOwnerNavigationRuntime();
nestedUi.renderOwnerPanel("dashboard");
nestedUi.renderOwnerPanel("products");
nestedUi.setNestedState({ productMode: "menu" });
nestedUi.renderOwnerPanel("products");
nestedUi.setNestedState({ productMode: "form", editingProductId: null });
nestedUi.renderOwnerPanel("products");
nestedUi.setNestedState({ editingProductId: "product-7" });
nestedUi.renderOwnerPanel("products");
nestedUi.ownerNavigateBack();
assert.deepEqual(JSON.parse(JSON.stringify(nestedUi.route)), { panel: "products", nav: "products", productMode: "form", editingProductId: null, editingAdIndex: null }, "Back from Edit Product restores the previous New Product screen");
nestedUi.ownerNavigateBack();
assert.equal(nestedUi.route.productMode, "menu", "Back from New Product restores the Product management menu");
nestedUi.renderOwnerPanel("ads");
nestedUi.setNestedState({ editingAdIndex: 1 });
nestedUi.renderOwnerPanel("ads");
nestedUi.ownerNavigateBack();
assert.equal(nestedUi.route.editingAdIndex, null, "Back from banner editing restores the banner list");
nestedUi.setNestedState({ productMode: "form" });
nestedUi.setDirtyDraft(true);
const blockedBackScreen = { ...nestedUi.route };
assert.equal(nestedUi.ownerNavigateBack(), false, "Back is blocked while an Owner form has unsaved edits");
assert.deepEqual(JSON.parse(JSON.stringify(nestedUi.route)), JSON.parse(JSON.stringify(blockedBackScreen)), "the unsaved Owner form remains open after blocked Back");

console.log("Owner navigation regression checks passed: all Owner routes, nested product and ad screens, desktop/mobile scroll snapshots, browser Back/Forward integration, and protection for unsaved drafts.");
