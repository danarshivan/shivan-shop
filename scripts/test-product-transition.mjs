import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /<div class="product" onclick="openProduct\(\$\{p\.id\}\)">/, "every shared-renderer card should use the common product opener");
assert.match(html, /#mainApp\.detail-mode #detailView\.active\.product-detail-entering\{animation:shopMotionProductOpen 190ms/, "product opening should retain its current 190 ms animation");
assert.match(html, /\.detail-toolbar \.back\{[^}]*touch-action:manipulation/, "the Back button should avoid tap-gesture delay");
assert.match(html, /html\{scrollbar-gutter:stable\}/, "the page scrollbar width should remain reserved while detail scrolling is locked");
assert.match(html, /body\.detail-view-open\{display:flex;justify-content:center\}/, "the previous centered layout should remain stable while details are open");
assert.match(html, /html\.detail-view-open,body\.detail-view-open\{[^}]*overflow:hidden/, "the background page should remain fixed during the Back animation");
assert.match(html, /<button class="back" type="button" onclick="goBack\(\)" aria-label="Back" title="Back"><svg[\s\S]*?<path d="m14\.5 5-7 7 7 7"\/>/, "the detail toolbar should use an accessible iPhone-style chevron Back button");
assert.doesNotMatch(html, /<button class="back"[^>]*>×<\/button>/, "the product-detail close glyph should be removed");
assert.match(html, /id="detailBackEdge"[^>]*onpointerdown="beginProductBackSwipe\(event\)"[^>]*onpointermove="moveProductBackSwipe\(event\)"[^>]*onpointerup="endProductBackSwipe\(event\)"[^>]*onpointercancel="cancelProductBackSwipe\(event\)"/, "the detail view should wire a dedicated edge-swipe gesture area");
assert.match(html, /\.app\.detail-mode #detailBackEdge\{[^}]*width:18px;[^}]*touch-action:pan-y/, "the swipe region should be narrow and preserve normal vertical page scrolling");
assert.match(html, /\.detail-gallery-track\{[^}]*touch-action:pan-x pan-y pinch-zoom/, "the Back gesture must leave horizontal image-gallery swiping intact");
assert.match(html, /#mainApp #detailView\.product-detail-leaving\.product-detail-back-ready\{transition:transform 200ms/, "the product page should slide out in 200 ms after its fixed overlay is laid out");
assert.match(html, /#mainApp #detailView\.product-detail-leaving\.product-detail-swipe-snapback\{transition:transform 180ms/, "a canceled edge drag should snap back smoothly");
assert.match(html, /#mainApp #detailView\.product-detail-leaving\{[^}]*transition:none/, "the fixed overlay should settle without a coordinate jump before the slide begins");
assert.match(html, /#mainApp #detailView\.product-detail-leaving\.product-detail-back-sliding\{transform:translate3d\(calc\(-50% \+ 100vw\),0,0\)\}/, "Back should move details right to reveal the underlying list");
assert.match(html, /#mainApp \.view\.active\.product-backdrop-revealed[^}]*animation:none!important/, "the revealed list should keep its existing pixels stable during Back");
assert.match(html, /\.app\.detail-mode\.product-back-navigation \.view\.product-backdrop-revealed\{pointer-events:none\}/, "the revealed list should not accept competing taps before the Back slide completes");
assert.match(html, /\.app\.detail-mode\.product-back-navigation \.topbar\{display:flex\}[\s\S]*?\.app\.detail-mode\.product-back-navigation \.bottom-nav\{display:grid;pointer-events:none\}/, "the original shop header and grid navigation should be revealed without accepting a competing route mid-transition");
assert.match(html, /prefers-reduced-motion:reduce\)\{#mainApp #detailView\.product-detail-leaving,[\s\S]*?transition:none!important/, "the Back transition should respect reduced-motion preferences");
assert.doesNotMatch(html, /product-list-returning|shopMotionProductListReturn/, "the previous close fade should not stack with the new slide Back transition");

const helperStart = html.indexOf("function prefersReducedProductMotion(){");
const openStart = html.indexOf("function openProduct(id){", helperStart);
const navigationStart = html.indexOf("function prepareProductBackNavigation(destinationView,");
const navigationEnd = html.indexOf("function isFavorite(id){", navigationStart);
assert.ok(helperStart >= 0 && openStart > helperStart, "product motion helpers should exist");
assert.ok(navigationStart > openStart && navigationEnd > navigationStart, "the Back button and edge-swipe flow should be present");
const helpers = html.slice(helperStart, openStart).trim();
const openEnd = html.indexOf("function detailPhotosForProduct(){", openStart);
assert.ok(openEnd > openStart, "the product opener should remain available");
const openProductSource = html.slice(openStart, openEnd).trim();
const navigationSource = html.slice(navigationStart, navigationEnd).trim();
assert.doesNotMatch(openProductSource, /startViewTransition|requestAnimationFrame|setTimeout|await /, "opening must remain immediate and unchanged");
assert.match(openProductSource, /previousView=\["home","search"\][\s\S]*?previousViewScrollY=Math\.max\(0,Number\(window\.scrollY\|\|document\.documentElement\.scrollTop\|\|document\.body\.scrollTop\|\|0\)\)/, "opening should remember whether Home or Search was active and its exact scroll position");
assert.match(navigationSource, /openView\(destinationView,\{preserveProductReturn:true\}\)[\s\S]*?window\.scrollTo\(0,previousViewScrollY\)/, "finishing Back should restore the same route and scroll position");
assert.match(navigationSource, /!\['home','search'\]\.includes\(destinationView\)/, "Back should refuse an invalid route instead of unexpectedly navigating Home");
assert.match(navigationSource, /productDetailClosing\|\|!destination/, "double taps must not start duplicate Back transitions");
assert.match(html, /function openView\(view,options=\{\}\)\{[\s\S]*?if\(productDetailClosing&&!options\.preserveProductReturn\)return;/, "keyboard or route actions cannot interrupt an in-flight Back transition");

function classListFor(classes) {
  return {
    contains: name => classes.has(name),
    add: (...names) => names.forEach(name => classes.add(name)),
    remove: (...names) => names.forEach(name => classes.delete(name)),
    toggle(name, force) { if (force === undefined) { if (classes.has(name)) classes.delete(name); else classes.add(name); } else if (force) classes.add(name); else classes.delete(name); },
  };
}

function createHarness({ reducedMotion = false, width = 390, height = 844 } = {}) {
  const state = { openedViews: [], scrollY: 421, scrollCalls: [], timers: new Map(), nextTimer: 1, now: 10, transitionHandler: null, prevented: false, cart: [{ productId: 77, size: "M", color: "#112233", qty: 2 }] };
  const makeView = initial => { const classes = new Set(initial); return { classes, classList: classListFor(classes) }; };
  const detailView = makeView([]);
  detailView.scrollTop = 0;
  detailView.offsetWidth = 390;
  detailView.style = { values: new Map(), setProperty(name, value) { this.values.set(name, value); }, removeProperty(name) { this.values.delete(name); } };
  detailView.addEventListener = (name, handler) => { if (name === "transitionend") state.transitionHandler = handler; };
  detailView.removeEventListener = (name, handler) => { if (name === "transitionend" && state.transitionHandler === handler) state.transitionHandler = null; };
  const homeView = makeView(["active"]);
  const searchView = makeView([]);
  const app = makeView([]);
  const root = { scrollTop: 0, style: { scrollBehavior: "smooth" } };
  const body = { scrollTop: 0, classList: classListFor(new Set()) };
  root.classList = classListFor(new Set());
  const edge = { setPointerCapture() {}, releasePointerCapture() {} };
  const navItems = Array.from({ length: 5 }, () => makeView([]));
  const elements = new Map([["detailView", detailView], ["detailName", { textContent: "" }], ["detailPrice", { textContent: "" }], ["detailDescription", { textContent: "" }], ["homeView", homeView], ["searchView", searchView], ["detailBackEdge", edge], ["navHome", navItems[0]], ["navSearch", navItems[1]]]);
  const document = {
    getElementById: id => elements.get(id),
    querySelector: selector => selector === ".app" ? app : null,
    querySelectorAll: selector => selector === ".nav-item" ? navItems : selector === ".product-backdrop-revealed" ? [homeView, searchView].filter(view => view.classes.has("product-backdrop-revealed")) : [],
    documentElement: root,
    body,
  };
  const product = { id: 1, name: "Purple Dress", image: "https://images.example/purple-dress.webp", variants: [{ size: "M", color: "#112233", stock: 4 }], sizes: ["M"], colors: ["#112233"], price: 12000, description: "A test product" };
  const secondProduct = { ...product, id: 2, name: "Blue Coat", price: 18000 };
  const context = {
    document,
    window: {
      matchMedia: () => ({ matches: reducedMotion }), innerWidth: width, innerHeight: height,
      get scrollY() { return state.scrollY; },
      scrollTo(...args) { state.scrollCalls.push(args); state.scrollY = typeof args[0] === "number" ? Number(args[1]) || 0 : Number(args[0]?.top) || 0; root.scrollTop = state.scrollY; body.scrollTop = state.scrollY; },
    },
    performance: { now: () => state.now },
    console,
    products: [product, secondProduct], currentProduct: null, currentQty: 0, selectedSize: "", selectedColor: "", previousView: "home", previousViewScrollY: 0,
    productDetailCloseTimer: 0, productDetailClosing: false, productBackSwipe: null, productBackSwipeSnapTimer: 0, productBackTransitionHandler: null, productBackScrollBehavior: "", productBackPrepared: false, productBackPreparedView: "",
    getProductName: item => item.name, formatPrice: price => String(price), renderDetailGallery() {}, renderSizeOptions() {}, renderColorOptions() {}, updateDetailAvailability() {}, renderDetailReviews() {}, resetDetailRecommendations() {},
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
    },
    setTimeout(callback, delay) { const id = state.nextTimer++; state.timers.set(id, { callback, delay }); state.lastTimer = id; return id; },
    clearTimeout(id) { state.timers.delete(id); },
    activateSearch() { homeView.classList.remove("active"); searchView.classList.add("active"); },
    state, edge, homeView, searchView, detailView, app,
  };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  vm.runInContext(navigationSource, context);
  const openProduct = vm.runInContext(`(${openProductSource})`, context);
  return {
    state, products: [product, secondProduct], context, product, homeView, searchView, detailView, app, edge, openProduct,
    closeProductDetails: context.closeProductDetails,
    finishTransition() { assert.ok(state.transitionHandler, "the animated detail view should register its completion handler"); state.transitionHandler({ target: detailView, propertyName: "transform" }); },
    runTimer(id = state.lastTimer) { const timer = state.timers.get(id); assert.ok(timer, "the expected cleanup timer should be scheduled"); state.timers.delete(id); timer.callback(); },
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
  assert.equal(harness.detailView.classList.contains("product-detail-back-sliding"), true, "the detail view should slide to the right");
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
assert.equal(swipe.homeView.classList.contains("active"), true, "the exact previous list should appear underneath while the finger drags");
assert.equal(swipe.app.classList.contains("product-back-navigation"), true, "the page layout should be locked into the stable Back-preview state while dragging");
assert.equal(swipe.detailView.style.values.get("--product-back-offset"), "32px", "the product page should track the edge gesture directly");
swipe.context.endProductBackSwipe(pointerEvent(105, 108, 140));
assert.equal(swipe.context.productDetailClosing, true, "a qualifying left-edge swipe should start the Back slide");
assert.equal(swipe.detailView.classList.contains("product-detail-back-sliding"), true, "the edge swipe should use the same right-slide transition as the button");
assert.equal(swipe.state.scrollY, 286, "edge-swipe Back should preserve the Home scroll position");
swipe.finishTransition();
assert.equal(swipe.homeView.classList.contains("active"), true, "edge-swipe Back should return to Home");

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
assert.equal(reduced.state.scrollY, 290, "reduced-motion navigation should restore the previous scroll position");
assert.equal(reduced.context.document.documentElement.style.scrollBehavior, "smooth", "reduced-motion navigation should restore the previous scroll behavior after an instant switch");
assert.equal(reduced.state.timers.size, 0, "reduced-motion navigation should not schedule an animation timer");

const invalidRoute = createHarness();
invalidRoute.openProduct(1);
invalidRoute.context.previousView = "cart";
invalidRoute.closeProductDetails();
assert.equal(invalidRoute.context.productDetailClosing, false, "an unexpected source route should not trigger fallback navigation");
assert.equal(invalidRoute.state.openedViews.length, 1, "Back must not unexpectedly send the user to Home or another page");

console.log("Product Back navigation tests passed: accessible chevron; 200 ms right slide; Home and Search state/scroll restoration on mobile and desktop; repeated Back cycles; edge-swipe commit, vertical-scroll preservation and snapback; gallery gesture preservation; reduced motion; double-tap protection; and cart preservation.");
