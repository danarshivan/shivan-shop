import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /<div class="product \$\{productDiscountPercent\(p\)\?"has-discount":""\}" onclick="openProduct\(\$\{p\.id\}\)">/, "discount presentation classes must preserve the shared product opener");
assert.match(html, /\.product\.has-discount \.discount-price-layout\{display:flex;width:100%;justify-content:flex-start;text-align:left;direction:ltr\}/, "discounted card prices should fill and align at the left edge");
assert.match(html, /\.product\.has-discount \.discounted-price\{color:inherit\}/, "discounted card prices should use the same purple accent as the card price");
assert.match(html, /\.product\.has-discount \.stock-line\{text-align:left;direction:ltr\}/, "discounted card stock text should remain left aligned");
assert.match(html, /\.products\{[^}]*display:grid;[^}]*align-items:stretch;/, "product cards should stretch to a consistent grid-row height");
assert.match(html, /\.product\{[^}]*display:flex;[^}]*flex-direction:column;/, "each product card should use a vertical flexible layout");
assert.match(html, /\.product-info\{[^}]*display:flex;[^}]*flex:1 1 auto;[^}]*flex-direction:column;/, "variable product content should expand above the bottom controls");
assert.match(html, /\.product-bottom\{[^}]*align-items:flex-end;[^}]*direction:ltr;[^}]*margin-top:auto;[^}]*padding-top:8px;/, "the wrapped color rows and cart buttons should share a left-to-right bottom baseline");
assert.match(html, /\.colors\{[^}]*flex-wrap:wrap;[^}]*align-content:flex-end;[^}]*overflow:visible;/, "different color counts should wrap into visible rows without clipping");
assert.match(html, /\.color-dot\{[^}]*flex:0 0 13px;/, "color circles should keep a consistent desktop size instead of shrinking");
assert.match(html, /\.add-mini\{[^}]*flex:0 0 34px;/, "the cart button should reserve a separate fixed-width column beside the colors");
assert.match(html, /\.product-bottom\{direction:ltr;margin-top:auto;padding-top:6px;gap:3px\}/, "the compact mobile card layout should retain the shared bottom alignment");
assert.match(html, /#mainApp\.detail-mode #detailView\.active\.product-detail-entering\{animation:shopMotionProductOpen 190ms/, "product opening should retain its current 190 ms animation");
assert.match(html, /\.detail-toolbar \.back\{[^}]*touch-action:manipulation/, "the Back button should avoid tap-gesture delay");
assert.match(html, /html\{scrollbar-gutter:stable\}/, "the page scrollbar width should remain reserved while detail scrolling is locked");
assert.match(html, /<button class="back" type="button" onclick="goBack\(\)" aria-label="Back" title="Back"><svg[\s\S]*?<path d="m14\.5 5-7 7 7 7"\/>/, "the detail toolbar should keep its accessible iPhone-style Back button");
assert.match(html, /function productHistoryStateFor\(productId,depth,returnView,returnScrollY\)/, "each detail entry should carry a browser-history product target");
assert.match(html, /function snapshotProductDetail\(\)[\s\S]*?detailScrollTop:[\s\S]*?galleryIndex:[\s\S]*?quantity:/, "nested navigation should remember the full prior detail context");
assert.match(html, /function ensureProductHistoryListener\(\)[\s\S]*?addEventListener\?\.\("popstate"/, "browser Back and Forward should use the product history handler");
assert.match(html, /product-detail-history-preview/, "a previous detail snapshot should be revealed under the outgoing product");
assert.match(html, /function openProduct\(id,options=\{\}\)[\s\S]*?productDetailHistoryStack\.push\(snapshotProductDetail\(\)\)/, "opening a product from another product should save the predecessor");
assert.match(html, /window\.history\.back\(\)/, "the visible Back action should update browser history");
assert.match(html, /#mainApp #detailView\.product-detail-leaving\.product-detail-back-ready\{transition:transform 200ms/, "the existing smooth rightward transition should remain 200 ms");

function classListFor(classes) {
  return {
    contains: name => classes.has(name),
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    toggle(name, force) { if (force === undefined) { if (classes.has(name)) classes.delete(name); else classes.add(name); } else if (force) classes.add(name); else classes.delete(name); },
  };
}

function createHarness({ reducedMotion = false, width = 390, height = 844, initialHistoryState = { page: "shop" } } = {}) {
  const state = { openedViews: [], scrollY: 421, scrollCalls: [], timers: new Map(), nextTimer: 1, now: 10, transitionHandler: null, popHandler: null, backCalls: 0, forwardCalls: 0, cart: [{ productId: 77, size: "M", color: "#112233", qty: 2 }] };
  const makeView = initial => {
    const classes = new Set(initial);
    const element = {
      classes, classList: classListFor(classes), scrollTop: 0, offsetWidth: width, children: [], parentNode: null,
      style: { values: new Map(), setProperty(name, value) { this.values.set(name, value); }, removeProperty(name) { this.values.delete(name); } },
      addEventListener(name, handler) { if (name === "transitionend") state.transitionHandler = handler; },
      removeEventListener(name, handler) { if (name === "transitionend" && state.transitionHandler === handler) state.transitionHandler = null; },
      setAttribute() {}, querySelector() { return edge; }, querySelectorAll() { return []; },
      cloneNode() { const clone = makeView([...classes]); clone.scrollTop = element.scrollTop; clone.setAttribute = () => {}; clone.querySelector = () => ({ style: {} }); return clone; },
      remove() { if (this.parentNode) { this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; } },
    };
    return element;
  };
  const detailView = makeView([]);
  const homeView = makeView(["active"]);
  const searchView = makeView([]);
  const app = makeView([]);
  const root = { scrollTop: 0, style: { scrollBehavior: "smooth" } };
  const body = { scrollTop: 0, classList: classListFor(new Set()) };
  root.classList = classListFor(new Set());
  const edge = { style: {}, setPointerCapture() {}, releasePointerCapture() {} };
  const mainApp = { children: [homeView, searchView, detailView], appendChild(node) { this.children.push(node); node.parentNode = this; } };
  detailView.parentNode = mainApp;
  homeView.parentNode = mainApp;
  searchView.parentNode = mainApp;
  const navItems = Array.from({ length: 5 }, () => makeView([]));
  const elements = new Map([["detailView", detailView], ["detailName", { textContent: "" }], ["detailPrice", { textContent: "" }], ["detailDescription", { textContent: "" }], ["homeView", homeView], ["searchView", searchView], ["detailBackEdge", edge], ["navHome", navItems[0]], ["navSearch", navItems[1]], ["navCart", navItems[2]], ["navProfile", navItems[3]], ["ownerPanelButton", navItems[4]]]);
  const document = {
    getElementById: id => elements.get(id),
    querySelector: selector => selector === ".app" ? app : null,
    querySelectorAll: selector => selector === ".nav-item" ? navItems : selector === ".product-backdrop-revealed" ? [homeView, searchView].filter(view => view.classes.has("product-backdrop-revealed")) : [],
    documentElement: root,
    body,
  };
  const product = { id: 1, name: "Purple Dress", image: "https://images.example/purple-dress.webp", variants: [{ size: "M", color: "#112233", stock: 4 }], sizes: ["M"], colors: ["#112233"], price: 12000, description: "A test product" };
  const secondProduct = { ...product, id: 2, name: "Blue Coat", image: "https://images.example/blue-coat.webp", price: 18000 };
  const thirdProduct = { ...product, id: 3, name: "Black Dress", image: "https://images.example/black-dress.webp", price: 21000 };
  const entries = [{ state: initialHistoryState, url: "http://127.0.0.1:4173/" }];
  let historyIndex = 0;
  const history = {
    get state() { return entries[historyIndex]?.state||null; },
    pushState(next, _title, url) { entries.splice(historyIndex + 1); entries.push({ state: next, url }); historyIndex++; },
    replaceState(next, _title, url) { entries[historyIndex] = { state: next, url }; },
    back() { state.backCalls++; if (historyIndex <= 0) return; historyIndex--; state.popHandler?.({ state: history.state }); },
    forward() { state.forwardCalls++; if (historyIndex >= entries.length - 1) return; historyIndex++; state.popHandler?.({ state: history.state }); },
  };
  const context = {
    document,
    window: {
      history, location: { href: "http://127.0.0.1:4173/" },
      addEventListener(name, handler) { if (name === "popstate") state.popHandler = handler; },
      matchMedia: () => ({ matches: reducedMotion }), innerWidth: width, innerHeight: height,
      get scrollY() { return state.scrollY; },
      scrollTo(...args) { state.scrollCalls.push(args); state.scrollY = typeof args[0] === "number" ? Number(args[1]) || 0 : Number(args[0]?.top) || 0; root.scrollTop = state.scrollY; body.scrollTop = state.scrollY; },
    },
    performance: { now: () => state.now },
    console,
    products: [product, secondProduct, thirdProduct], currentProduct: null, currentQty: 0, selectedSize: "", selectedColor: "", currentGalleryImages: ["photo-1", "photo-2"], currentGalleryIndex: 0, previousView: "home", previousViewScrollY: 0,
    productDetailCloseTimer: 0, productDetailClosing: false, productBackSwipe: null, productBackSwipeSnapTimer: 0, productBackTransitionHandler: null, productBackScrollBehavior: "", productBackPrepared: false, productBackPreparedView: "", productBackPreparedPreview: null,
    productDetailHistoryStack: [], productHistoryBackPending: false, productHistoryBackFromSwipe: false, productHistoryPopHandler: null,
    getProductName: item => item.name, formatPrice: price => String(price), renderProductPricing: item => String(item.price), renderDetailGallery() {}, refreshDiscountCountdownBadges() {}, renderSizeOptions() {}, renderColorOptions() {}, updateDetailAvailability() {}, renderDetailReviews() {}, resetDetailRecommendations() {}, syncDetailPhotoTracks() {},
    openView(view, options = {}) {
      state.openedViews.push({ view, options });
      if (!options.preserveProductReturn) { homeView.classList.remove("product-backdrop-revealed"); searchView.classList.remove("product-backdrop-revealed"); }
      detailView.classList.remove("active"); homeView.classList.remove("active"); searchView.classList.remove("active");
      if (view === "detail") detailView.classList.add("active");
      if (view === "home") homeView.classList.add("active");
      if (view === "search") searchView.classList.add("active");
      app.classList.toggle("detail-mode", view === "detail");
      root.classList.toggle("detail-view-open", view === "detail"); body.classList.toggle("detail-view-open", view === "detail");
      state.scrollCalls.push([0, 0]); state.scrollY = 0; root.scrollTop = 0; body.scrollTop = 0;
      if (view === "detail") detailView.scrollTop = 0;
    },
    setTimeout(callback, delay) { const id = state.nextTimer++; state.timers.set(id, { callback, delay }); state.lastTimer = id; return id; },
    clearTimeout(id) { state.timers.delete(id); },
    activateSearch() { homeView.classList.remove("active"); searchView.classList.add("active"); },
    state, edge, homeView, searchView, detailView, app, mainApp, historyEntries: entries,
  };
  vm.createContext(context);
  const helperStart = html.indexOf("function prefersReducedProductMotion(){");
  const openStart = html.indexOf("function openProduct(id,options={}){", helperStart);
  const navigationStart = html.indexOf("function productBackTarget(historyTargetProductId=");
  const navigationEnd = html.indexOf("function isFavorite(id){", navigationStart);
  const openEnd = html.indexOf("function detailPhotosForProduct(){", openStart);
  assert.ok(helperStart >= 0 && openStart > helperStart && navigationStart > openStart && navigationEnd > navigationStart && openEnd > openStart, "product open and Back functions should remain extractable for the offline harness");
  const helpers = html.slice(helperStart, openStart).trim();
  const openProductSource = html.slice(openStart, openEnd).trim();
  const navigationSource = html.slice(navigationStart, navigationEnd).trim();
  vm.runInContext(helpers, context);
  vm.runInContext(navigationSource, context);
  vm.runInContext(openProductSource, context);
  const openProduct = context.openProduct;
  return {
    state, products: [product, secondProduct, thirdProduct], context, product, homeView, searchView, detailView, app, edge, openProduct, historyEntries: entries,
    closeProductDetails: context.closeProductDetails,
    finishTransition() { assert.ok(state.transitionHandler, "the animated detail view should register its completion handler"); state.transitionHandler({ target: detailView, propertyName: "transform" }); },
    runTimer(id = state.lastTimer) { const timer = state.timers.get(id); assert.ok(timer, "the expected cleanup timer should be scheduled"); state.timers.delete(id); timer.callback(); },
    browserBack() { history.back(); }, browserForward() { history.forward(); },
  };
}

function assertAnimatedReturn(harness, route, scrollY) {
  harness.state.scrollY = scrollY;
  harness.openProduct(1);
  assert.equal(harness.context.previousView, route, `${route} should be remembered as the source route`);
  assert.equal(harness.context.previousViewScrollY, scrollY, `${route} should remember its exact scroll offset`);
  assert.equal(harness.detailView.classList.contains("product-detail-entering"), true, "the existing opening animation should remain active");
  assert.deepEqual(harness.state.cart, [{ productId: 77, size: "M", color: "#112233", qty: 2 }], "opening must preserve the cart");

  harness.context.goBack();
  const destination = route === "home" ? harness.homeView : harness.searchView;
  assert.equal(harness.context.productDetailClosing, true, "the detail view should stay mounted during the slide");
  assert.equal(destination.classList.contains("active"), true, "the exact prior list should be revealed underneath details");
  assert.equal(destination.classList.contains("product-backdrop-revealed"), true, "the revealed list should avoid re-render and entry animation");
  assert.equal(harness.detailView.classList.contains("product-detail-back-ready"), true, "the fixed detail overlay should settle before motion begins");
  assert.equal(harness.detailView.classList.contains("product-detail-back-sliding"), true, "the detail page should slide to the right");
  assert.equal(harness.state.scrollY, scrollY, "the previous list position should be restored before the visual transition");
  assert.equal(harness.state.timers.get(harness.state.lastTimer).delay, 230, "a short fallback should complete if transitionend is unavailable");
  const viewCount = harness.state.openedViews.length;
  harness.context.goBack();
  assert.equal(harness.state.openedViews.length, viewCount, "a double tap should not initiate a second navigation");
  harness.finishTransition();
  assert.equal(harness.context.productDetailClosing, false, "the close state should clear after the transition");
  assert.equal(harness.state.openedViews.at(-1).view, route, "Back should finish on the exact previous route");
  assert.equal(harness.state.openedViews.at(-1).options.preserveProductReturn, true, "the return should preserve the visible list state");
  assert.equal(harness.state.scrollY, scrollY, "the exact scroll position should remain after the transition");
  assert.equal(destination.classList.contains("active"), true, "the previous list should remain active");
  assert.equal(harness.detailView.classList.contains("active"), false, "the detail page should be removed after the slide completes");
  assert.equal(harness.context.document.documentElement.style.scrollBehavior, "smooth", "the prior scroll behavior should be restored");
  assert.deepEqual(harness.state.cart, [{ productId: 77, size: "M", color: "#112233", qty: 2 }], "closing must preserve the cart");
}

const mobileHome = createHarness();
assertAnimatedReturn(mobileHome, "home", 421);
mobileHome.state.scrollY = 836;
mobileHome.openProduct(2);
mobileHome.closeProductDetails();
mobileHome.finishTransition();
assert.equal(mobileHome.state.scrollY, 836, "repeated Home product open/Back cycles should preserve each scroll location");

const mobileSearch = createHarness();
mobileSearch.context.activateSearch();
assertAnimatedReturn(mobileSearch, "search", 638);
mobileSearch.state.scrollY = 910;
mobileSearch.openProduct(2);
mobileSearch.closeProductDetails();
mobileSearch.finishTransition();
assert.equal(mobileSearch.state.scrollY, 910, "repeated Search product open/Back cycles should preserve each scroll location");

const nested = createHarness();
nested.state.scrollY = 444;
nested.openProduct(1);
nested.context.selectedSize = "M";
nested.context.selectedColor = "#112233";
nested.context.currentQty = 3;
nested.detailView.scrollTop = 287;
nested.context.currentGalleryIndex = 1;
nested.openProduct(2);
assert.equal(nested.context.previousView, "home", "opening a related product should preserve the original browsing route");
assert.equal(nested.context.productDetailHistoryStack.length, 1, "the first product should be kept in the nested history stack");
nested.context.goBack();
assert.equal(nested.context.productDetailClosing, true, "Back from Product B should animate out of its details");
assert.equal(nested.context.productBackPreparedView, "detail", "Product A should be the revealed destination under Product B");
assert.equal(nested.context.productBackPreparedPreview?.classList.contains("product-detail-history-preview"), true, "the prior product detail should be visible beneath the outgoing one");
nested.finishTransition();
assert.equal(nested.context.currentProduct.id, 1, "Product B Back must return to Product A, not the shop list");
assert.equal(nested.context.selectedSize, "M", "the prior size selection should be restored");
assert.equal(nested.context.selectedColor, "#112233", "the prior color selection should be restored");
assert.equal(nested.context.currentQty, 3, "the prior quantity selection should be restored");
assert.equal(nested.detailView.scrollTop, 287, "the previous product detail scroll position should be restored");
assert.equal(nested.context.currentGalleryIndex, 1, "the previous product gallery position should be restored");
assert.equal(nested.context.productDetailHistoryStack.length, 0, "returning to Product A should pop only Product B from history");
nested.context.goBack();
nested.finishTransition();
assert.equal(nested.homeView.classList.contains("active"), true, "Back from Product A should then return to the original Home list");
assert.equal(nested.state.scrollY, 444, "the original Home scroll position should be restored after nested navigation");

const multiProduct = createHarness();
multiProduct.openProduct(1);
multiProduct.openProduct(2);
multiProduct.openProduct(3);
multiProduct.context.goBack();
multiProduct.finishTransition();
assert.equal(multiProduct.context.currentProduct.id, 2, "Product C Back should return to Product B");
multiProduct.context.goBack();
multiProduct.finishTransition();
assert.equal(multiProduct.context.currentProduct.id, 1, "the next Back should return to Product A");
multiProduct.context.goBack();
multiProduct.finishTransition();
assert.equal(multiProduct.homeView.classList.contains("active"), true, "only the final Back should return to the original list");

const browserHistory = createHarness();
browserHistory.openProduct(1);
browserHistory.openProduct(2);
browserHistory.browserBack();
assert.equal(browserHistory.context.productDetailClosing, true, "browser Back should close Product B through the same transition");
browserHistory.finishTransition();
assert.equal(browserHistory.context.currentProduct.id, 1, "browser Back should return from Product B to Product A");
browserHistory.browserForward();
assert.equal(browserHistory.context.currentProduct.id, 2, "browser Forward should reopen the product entry it returns to");
browserHistory.browserBack();
browserHistory.finishTransition();
assert.equal(browserHistory.context.currentProduct.id, 1, "browser history should repeatedly restore the correct prior product");
browserHistory.browserBack();
browserHistory.finishTransition();
assert.equal(browserHistory.homeView.classList.contains("active"), true, "browser Back should reach the original list only after leaving Product A");

const refreshedHistory = createHarness({ initialHistoryState: { __shivanProductDetail: true, __shivanProductId: "1", __shivanProductDepth: 1, __shivanProductReturnView: "home", __shivanProductReturnScrollY: 333, unrelatedState: "preserve" } });
assert.equal(refreshedHistory.historyEntries[0].state.__shivanProductDetail, undefined, "a page refresh should normalize the stale product detail state before the app opens at Home");
assert.equal(refreshedHistory.historyEntries[0].state.unrelatedState, "preserve", "normalizing product history should preserve unrelated browser state");
refreshedHistory.openProduct(2);
refreshedHistory.browserBack();
assert.equal(refreshedHistory.context.productDetailClosing, true, "Back after opening a product from the refreshed list should close to that list");
refreshedHistory.finishTransition();
assert.equal(refreshedHistory.homeView.classList.contains("active"), true, "a stale pre-refresh product must not be reopened as the Back destination");

const desktopHome = createHarness({ width: 1440, height: 960 });
assertAnimatedReturn(desktopHome, "home", 512);
const desktopSearch = createHarness({ width: 1440, height: 960 });
desktopSearch.context.activateSearch();
assertAnimatedReturn(desktopSearch, "search", 934);

const swipe = createHarness();
swipe.state.scrollY = 286;
swipe.openProduct(1);
const pointerEvent = (x, y, time, edge = swipe.edge) => ({ pointerId: 7, isPrimary: true, button: 0, clientX: x, clientY: y, timeStamp: time, cancelable: true, currentTarget: edge, preventDefault() { swipe.state.prevented = true; } });
swipe.context.beginProductBackSwipe(pointerEvent(2, 100, 10));
swipe.context.moveProductBackSwipe(pointerEvent(34, 103, 65));
assert.equal(swipe.homeView.classList.contains("active"), true, "the exact prior list should appear underneath while the finger drags");
assert.equal(swipe.app.classList.contains("product-back-navigation"), true, "the page layout should be locked into the stable Back-preview state while dragging");
assert.equal(swipe.detailView.style.values.get("--product-back-offset"), "32px", "the product page should track the edge gesture directly");
swipe.context.endProductBackSwipe(pointerEvent(105, 108, 140));
assert.equal(swipe.context.productDetailClosing, true, "a qualifying left-edge swipe should start the Back slide");
assert.equal(swipe.detailView.classList.contains("product-detail-back-sliding"), true, "the edge swipe should use the same right-slide transition as the button");
assert.equal(swipe.state.scrollY, 286, "edge-swipe Back should preserve the Home scroll position");
swipe.finishTransition();
assert.equal(swipe.homeView.classList.contains("active"), true, "edge-swipe Back should return to Home");

const nestedSwipe = createHarness();
nestedSwipe.openProduct(1);
nestedSwipe.openProduct(2);
nestedSwipe.context.beginProductBackSwipe(pointerEvent(2, 100, 10, nestedSwipe.edge));
nestedSwipe.context.moveProductBackSwipe(pointerEvent(34, 103, 65, nestedSwipe.edge));
assert.equal(nestedSwipe.context.productBackPreparedView, "detail", "edge-swipe should reveal the prior product rather than the list");
nestedSwipe.context.endProductBackSwipe(pointerEvent(105, 108, 140, nestedSwipe.edge));
nestedSwipe.finishTransition();
assert.equal(nestedSwipe.context.currentProduct.id, 1, "edge-swipe Back should restore the prior product in a nested flow");

const shortSwipe = createHarness();
shortSwipe.openProduct(1);
shortSwipe.context.beginProductBackSwipe(pointerEvent(2, 100, 10, shortSwipe.edge));
shortSwipe.context.moveProductBackSwipe(pointerEvent(30, 100, 70, shortSwipe.edge));
shortSwipe.context.endProductBackSwipe(pointerEvent(33, 101, 210, shortSwipe.edge));
assert.equal(shortSwipe.detailView.classList.contains("product-detail-swipe-snapback"), true, "a short drag should smoothly return to the detail page");
assert.equal(shortSwipe.detailView.style.values.get("--product-back-offset"), "0px", "a canceled edge gesture should restore the detail page to its starting position");
shortSwipe.runTimer();
assert.equal(shortSwipe.detailView.classList.contains("product-detail-swipe-snapback"), false, "the canceled gesture state should clean up");

const verticalGesture = createHarness();
verticalGesture.openProduct(1);
verticalGesture.context.beginProductBackSwipe(pointerEvent(2, 100, 10, verticalGesture.edge));
verticalGesture.context.moveProductBackSwipe(pointerEvent(5, 140, 55, verticalGesture.edge));
assert.equal(verticalGesture.context.productBackSwipe, null, "a vertical drag at the edge should remain a normal scroll gesture");
assert.equal(verticalGesture.context.productDetailClosing, false, "vertical scrolling must not trigger Back");

const timeoutFallback = createHarness();
timeoutFallback.state.scrollY = 173;
timeoutFallback.openProduct(1);
timeoutFallback.closeProductDetails();
timeoutFallback.runTimer();
assert.equal(timeoutFallback.homeView.classList.contains("active"), true, "the transition timeout should safely finish Back if transitionend is unavailable");
assert.equal(timeoutFallback.state.scrollY, 173, "the fallback should preserve the same Home scroll position");

const reduced = createHarness({ reducedMotion: true });
reduced.state.scrollY = 290;
reduced.openProduct(1);
reduced.closeProductDetails();
assert.equal(reduced.context.productDetailClosing, false, "reduced-motion users should navigate immediately");
assert.equal(reduced.state.openedViews.at(-1).view, "home", "reduced-motion Back should return to Home");
assert.equal(reduced.state.scrollY, 290, "reduced-motion navigation should restore the previous list scroll position");
assert.equal(reduced.context.document.documentElement.style.scrollBehavior, "smooth", "reduced-motion navigation should restore the prior scroll behavior");
assert.equal(reduced.state.timers.size, 0, "reduced-motion navigation should not schedule an animation timer");

const invalidRoute = createHarness();
invalidRoute.openProduct(1);
invalidRoute.context.previousView = "cart";
invalidRoute.context.closeProductDetails({ fromHistory: true });
assert.equal(invalidRoute.context.productDetailClosing, false, "an unexpected source route should not trigger fallback navigation");
assert.equal(invalidRoute.state.openedViews.length, 1, "Back must not unexpectedly send the user to Home or another page");

console.log("Product Back navigation tests passed: Home/Search restoration; nested A→B→Back→A and A→B→C sequences; browser Back/Forward; exact product, variant, gallery, detail scroll and list scroll restoration; mobile and desktop; edge-swipe; reduced motion; cart preservation; and transition fallback.");
