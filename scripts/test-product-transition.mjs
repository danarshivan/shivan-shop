import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const requireSource = (pattern, message) => {
  const match = html.match(pattern);
  assert.ok(match, message);
  return match[0];
};

assert.match(html, /<div class="product" onclick="openProduct\(\$\{p\.id\},event\)">/, "all shared-renderer product cards should pass the clicked card event into the detail opener");
assert.match(html, /#detailView\.active #detailName\{animation:shopMotionDetailIn/, "product titles should enter with the detail stagger");
assert.match(html, /#detailView\.active #detailPrice\{animation:shopMotionDetailIn/, "product prices should enter with the detail stagger");
assert.match(html, /#detailView\.active \.detail-options \.detail-box:last-child\{animation:shopMotionDetailIn/, "variant controls should enter with the detail stagger");
assert.match(html, /::view-transition-group\(shivan-product-image\)/, "supported browsers should animate the clicked product image as a shared element");
assert.match(html, /#detailView\.product-detail-closing\{animation:shopMotionDetailOut/, "unsupported browsers should have a smooth detail-close fallback");
assert.match(html, /prefers-reduced-motion:reduce[\s\S]*?::view-transition-group\(shivan-product-image\).*?animation-duration:\.01ms!important/, "shared-image motion should respect reduced-motion settings");

const helperStart = html.indexOf("function productViewTransitionEnabled(){");
const openStart = html.indexOf("function openProduct(id,event=null){", helperStart);
assert.ok(helperStart >= 0 && openStart > helperStart, "view-transition helpers should exist");
const helpers = html.slice(helperStart, openStart).trim();
const openEnd = html.indexOf("function detailPhotosForProduct(){", openStart);
assert.ok(openEnd > openStart, "the shared product opener should remain available");
const openProductSource = html.slice(openStart, openEnd).trim();
const closeStart = html.indexOf("function closeProductDetails(){");
const backStart = html.indexOf("function goBack(){", closeStart);
assert.ok(closeStart >= 0 && backStart > closeStart, "the detail close flow should remain available");
const closeProductSource = html.slice(closeStart, backStart).trim();
assert.match(openProductSource, /runProductViewTransition\(openDetails,sharedSource/, "opening a product should use the shared view-transition helper");
assert.match(closeProductSource, /runProductViewTransition\(\(\)=>openView\(destinationView\)/, "closing a product should animate back to the previous view");
assert.match(html, /function goBack\(\)\{\s*closeProductDetails\(\);/, "the existing back control should use the animated close path");

function createHarness({ nativeTransitions = true, reducedMotion = false } = {}) {
  const state = {
    transitions: [],
    transitionElements: [],
    openedViews: [],
    detailView: null,
    animationEnd: null,
    imageTarget: { style: {}, complete: true, naturalWidth: 120, currentSrc: "" },
    cart: [{ productId: 77, size: "M", color: "#112233", qty: 2 }],
  };
  const classes = new Set(["active"]);
  const classList = {
    contains: name => classes.has(name),
    toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
    add: name => classes.add(name),
    remove: name => classes.delete(name),
  };
  const elements = new Map();
  for (const id of ["detailView", "detailName", "detailPrice", "detailDescription", "detailImage", "homeView", "searchView"]) {
    elements.set(id, { id, classList: id.endsWith("View") ? { ...classList, contains: name => id === "homeView" ? name === "active" : false } : undefined, style: {}, textContent: "" });
  }
  const detailView = elements.get("detailView");
  detailView.classList = classList;
  detailView.addEventListener = (type, handler) => { if (type === "animationend") state.animationEnd = handler; };
  detailView.removeEventListener = (type, handler) => { if (type === "animationend" && state.animationEnd === handler) state.animationEnd = null; };
  state.detailView = detailView;
  elements.get("detailImage").style = state.imageTarget.style;
  const document = {
    getElementById: id => id === "detailImage" ? state.imageTarget : elements.get(id),
  };
  if (nativeTransitions) {
    document.startViewTransition = callback => {
      const transition = { before: state.transitionElements.map(element => element.style.viewTransitionName || ""), finish: null };
      callback();
      transition.after = state.transitionElements.map(element => element.style.viewTransitionName || "");
      transition.finished = new Promise(resolve => { transition.finish = resolve; });
      state.transitions.push(transition);
      return { finished: transition.finished, updateCallbackDone: Promise.resolve() };
    };
  }
  const product = {
    id: 1,
    name: "Purple Dress",
    image: "https://images.example/purple-dress.webp",
    variants: [{ size: "M", color: "#112233", stock: 4 }],
    sizes: ["M"],
    colors: ["#112233"],
    price: 12000,
    description: "A test product",
  };
  const context = {
    document,
    window: { matchMedia: () => ({ matches: reducedMotion }), scrollTo() {} },
    console,
    Promise,
    setTimeout: callback => { state.pendingClose = callback; return 1; },
    clearTimeout: () => { state.pendingClose = null; },
    products: [product],
    currentProduct: null,
    currentQty: 0,
    selectedSize: "",
    selectedColor: "",
    previousView: "home",
    detailOriginImage: null,
    productTransitionCleanup: null,
    getProductName: item => item.name,
    formatPrice: price => String(price),
    renderDetailGallery(_reset, _color) { state.imageTarget.currentSrc = product.image; },
    renderSizeOptions() {},
    renderColorOptions() {},
    updateDetailAvailability() {},
    renderDetailReviews() {},
    resetDetailRecommendations() {},
    openView(view) { state.openedViews.push(view); },
    state,
  };
  vm.createContext(context);
  vm.runInContext(`${helpers};`, context);
  const openProduct = vm.runInContext(`(${openProductSource})`, context);
  const closeProductDetails = vm.runInContext(`(${closeProductSource})`, context);
  return { state, context, openProduct, closeProductDetails, product };
}

const native = createHarness();
const originImage = { style: {}, isConnected: true, complete: true, naturalWidth: 120, currentSrc: native.product.image };
native.state.transitionElements.push(originImage, native.state.imageTarget);
const card = { isConnected: true, closest: () => card, querySelector: () => originImage };
native.openProduct(1, { currentTarget: card });
assert.equal(native.context.currentProduct, native.product, "the clicked product should open");
assert.equal(native.context.selectedSize, "M", "the existing default available size should remain selected");
assert.equal(native.context.selectedColor, "#112233", "the existing default available color should remain selected");
assert.deepEqual(native.state.cart, [{ productId: 77, size: "M", color: "#112233", qty: 2 }], "opening product details must preserve the cart");
assert.deepEqual(native.state.transitions[0].before, ["shivan-product-image", ""], "the clicked card image should be named in the outgoing view");
assert.deepEqual(native.state.transitions[0].after, ["none", "shivan-product-image"], "the larger detail image should receive the shared transition name");
assert.deepEqual(native.state.openedViews, ["detail"], "opening the card should retain the existing detail route");

native.closeProductDetails();
assert.equal(native.state.transitions.length, 2, "both open and close should use native transitions when supported");
assert.deepEqual(native.state.transitions[1].before, ["", "shivan-product-image"], "closing should start from the detail image");
assert.deepEqual(native.state.transitions[1].after, ["shivan-product-image", "none"], "closing should return the image to its original card");
assert.deepEqual(native.state.openedViews, ["detail", "home"], "closing should return to the previous view");

const fallback = createHarness({ nativeTransitions: false });
fallback.openProduct(1);
assert.equal(fallback.context.currentProduct, fallback.product, "programmatic opens should still work without View Transitions");
assert.deepEqual(fallback.state.openedViews, ["detail"], "the CSS fallback should preserve the existing detail route");
assert.equal(fallback.state.transitions.length, 0, "unsupported browsers should not call the native transition API");
fallback.closeProductDetails();
assert.equal(fallback.state.detailView.classList.contains("product-detail-closing"), true, "unsupported browsers should begin the CSS closing animation");
fallback.state.animationEnd({ target: fallback.state.detailView, animationName: "shopMotionDetailOut" });
assert.equal(fallback.state.detailView.classList.contains("product-detail-closing"), false, "the CSS closing state should clear after animation");
assert.deepEqual(fallback.state.openedViews, ["detail", "home"], "the CSS close fallback should return to the previous view");

const reduced = createHarness({ reducedMotion: true });
const reducedOrigin = { style: {}, isConnected: true, complete: true, naturalWidth: 120, currentSrc: reduced.product.image };
reduced.openProduct(1, { currentTarget: { closest: () => null, querySelector: () => reducedOrigin } });
reduced.closeProductDetails();
assert.equal(reduced.state.transitions.length, 0, "reduced-motion users should bypass native animated transitions");
assert.deepEqual(reduced.state.openedViews, ["detail", "home"], "reduced-motion users should keep immediate open and close navigation");

for (const transition of native.state.transitions) transition.finish();
await new Promise(resolve => setImmediate(resolve));
assert.equal(originImage.style.viewTransitionName || "", "", "temporary shared-element names should be cleaned after the transition");
assert.equal(native.state.imageTarget.style.viewTransitionName || "", "", "detail transition styles should be cleaned after the transition");

console.log("Product transition tests passed: shared card-to-detail image, close return, CSS fallback, reduced motion, variant defaults, and cart preservation.");
