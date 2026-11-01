import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
assert.match(html, /<div class="product" onclick="openProduct\(\$\{p\.id\}\)">/, "every shared-renderer product card should use the same direct opener");
assert.match(html, /#mainApp\.detail-mode #detailView\.active\.product-detail-entering\{animation:shopMotionProductOpen 190ms/, "product details should fade and slide in within the requested fast range");
assert.match(html, /#mainApp\.detail-mode #detailView\.active\.product-detail-closing\{animation:shopMotionProductClose 170ms/, "product details should close in the same fast range");
assert.match(html, /@keyframes shopMotionProductOpen\{from\{opacity:0;transform:translate3d\(0,5px,0\)\}to\{opacity:1;transform:none\}\}/, "opening should use only a short, subtle slide with a fade");
assert.match(html, /prefers-reduced-motion:reduce\)\{#mainApp\.detail-mode #detailView\.active\.product-detail-entering,[\s\S]*?animation:none!important/, "the product detail transition should respect reduced-motion settings");
assert.doesNotMatch(html, /view-transition-name:shivan-product-image|startViewTransition|runProductViewTransition|shopMotionDetailIn|shopMotionDetailImageIn/, "the prior shared-image and staggered product transition should be removed");

const helperStart = html.indexOf("function prefersReducedProductMotion(){");
const openStart = html.indexOf("function openProduct(id){", helperStart);
assert.ok(helperStart >= 0 && openStart > helperStart, "product motion helpers should exist");
const helpers = html.slice(helperStart, openStart).trim();
const openEnd = html.indexOf("function detailPhotosForProduct(){", openStart);
assert.ok(openEnd > openStart, "the product opener should remain available");
const openProductSource = html.slice(openStart, openEnd).trim();
const closeStart = html.indexOf("function closeProductDetails(){");
const backStart = html.indexOf("function goBack(){", closeStart);
assert.ok(closeStart >= 0 && backStart > closeStart, "the product close flow should remain available");
const closeProductSource = html.slice(closeStart, backStart).trim();
assert.doesNotMatch(openProductSource, /startViewTransition|requestAnimationFrame|setTimeout|await /, "opening must remain immediate and must not wait for an animation callback");
assert.match(openProductSource, /currentProduct=p;[\s\S]*?openView\("detail"\);[\s\S]*?classList\.add\("product-detail-entering"\)/, "the existing product detail state should open immediately before its brief animation");
assert.match(closeProductSource, /classList\.add\("product-detail-closing"\)/, "closing should start the brief fade-and-slide exit");
assert.match(closeProductSource, /animationName!=="shopMotionProductClose"/, "closing should finish on its own animation event");
assert.match(html, /function goBack\(\)\{\s*closeProductDetails\(\);/, "the existing back control should use the product close flow");

function createHarness({ reducedMotion = false } = {}) {
  const state = {
    openedViews: [],
    detailView: null,
    animationEnd: null,
    pendingClose: null,
    cart: [{ productId: 77, size: "M", color: "#112233", qty: 2 }],
  };
  const detailClasses = new Set();
  const detailClassList = {
    contains: name => detailClasses.has(name),
    add: name => detailClasses.add(name),
    remove: (...names) => names.forEach(name => detailClasses.delete(name)),
    toggle(name, force) { if (force) detailClasses.add(name); else detailClasses.delete(name); },
  };
  const homeClasses = new Set(["active"]);
  const searchClasses = new Set();
  const detailView = {
    classList: detailClassList,
    addEventListener(type, handler) { if (type === "animationend") state.animationEnd = handler; },
    removeEventListener(type, handler) { if (type === "animationend" && state.animationEnd === handler) state.animationEnd = null; },
  };
  state.detailView = detailView;
  const elements = new Map([
    ["detailView", detailView],
    ["detailName", { textContent: "" }],
    ["detailPrice", { textContent: "" }],
    ["detailDescription", { textContent: "" }],
    ["homeView", { classList: { contains: name => homeClasses.has(name) } }],
    ["searchView", { classList: { contains: name => searchClasses.has(name) } }],
  ]);
  const document = { getElementById: id => elements.get(id) };
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
    products: [product],
    currentProduct: null,
    currentQty: 0,
    selectedSize: "",
    selectedColor: "",
    previousView: "home",
    productDetailCloseTimer: 0,
    productDetailCloseHandler: null,
    getProductName: item => item.name,
    formatPrice: price => String(price),
    renderDetailGallery() {},
    renderSizeOptions() {},
    renderColorOptions() {},
    updateDetailAvailability() {},
    renderDetailReviews() {},
    resetDetailRecommendations() {},
    openView(view) {
      state.openedViews.push(view);
      detailClasses.delete("active");
      if (view === "detail") { detailClasses.add("active"); homeClasses.delete("active"); searchClasses.delete("active"); }
      if (view === "home") { homeClasses.add("active"); searchClasses.delete("active"); }
      if (view === "search") { searchClasses.add("active"); homeClasses.delete("active"); }
    },
    setTimeout(callback) { state.pendingClose = callback; return 1; },
    clearTimeout() { state.pendingClose = null; },
    state,
    activateSearch() { homeClasses.delete("active"); searchClasses.add("active"); },
  };
  vm.createContext(context);
  vm.runInContext(`${helpers};`, context);
  return {
    state,
    context,
    product,
    activateSearch: context.activateSearch,
    openProduct: vm.runInContext(`(${openProductSource})`, context),
    closeProductDetails: vm.runInContext(`(${closeProductSource})`, context),
  };
}

const standard = createHarness();
standard.openProduct(1);
assert.equal(standard.context.currentProduct, standard.product, "the selected product should open immediately");
assert.equal(standard.context.selectedSize, "M", "the original default available size should remain selected");
assert.equal(standard.context.selectedColor, "#112233", "the original default available color should remain selected");
assert.deepEqual(standard.state.cart, [{ productId: 77, size: "M", color: "#112233", qty: 2 }], "opening details must preserve cart contents");
assert.deepEqual(standard.state.openedViews, ["detail"], "opening a product should keep the existing detail route");
assert.equal(standard.state.detailView.classList.contains("product-detail-entering"), true, "the single brief entrance state should run after immediate navigation");

standard.closeProductDetails();
assert.equal(standard.state.detailView.classList.contains("product-detail-closing"), true, "closing should begin its matching brief exit");
standard.state.animationEnd({ target: standard.state.detailView, animationName: "shopMotionProductClose" });
assert.equal(standard.state.detailView.classList.contains("product-detail-closing"), false, "the exit state should clear when its animation finishes");
assert.deepEqual(standard.state.openedViews, ["detail", "home"], "closing should return to the same previous view");

const search = createHarness();
search.activateSearch();
search.openProduct(1);
assert.equal(search.context.previousView, "search", "a product opened from Search should remember Search as its return route");
search.closeProductDetails();
search.state.pendingClose();
assert.deepEqual(search.state.openedViews, ["detail", "search"], "the timeout fallback should close safely back to Search if animationend does not fire");

const reduced = createHarness({ reducedMotion: true });
reduced.openProduct(1);
assert.equal(reduced.state.detailView.classList.contains("product-detail-entering"), false, "reduced-motion users should skip the entrance animation");
reduced.closeProductDetails();
assert.deepEqual(reduced.state.openedViews, ["detail", "home"], "reduced-motion users should navigate back immediately");

console.log("Product transition tests passed: immediate detail opening, 190 ms fade/slide, 170 ms close, reduced motion, existing variant defaults, and cart preservation.");
